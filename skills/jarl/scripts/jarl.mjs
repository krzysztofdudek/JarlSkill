#!/usr/bin/env node
// jarl.mjs — the one tool the jarl skill's state moves through: the command line over record.mjs.
//
// Markdown is the source of truth: .jarl/goal.md, .jarl/decisions.md, .jarl/log.md and one
// .jarl/issues/NNN-slug.md per issue. This script only reads and writes those files, so anything
// it does can be checked by opening them. Zero dependencies, Node 22+.
//
// What is here: the usage text, the flag and argument tables, the parser and dispatch — one command, run and rendered.
// Every operation on the record goes through record.mjs, the stable surface another tool may vendor; the rest of the
// commands (the views over git, import, report and the like) come from jarl-lib.mjs, the implementation behind both.
// This module re-exports jarl-lib.mjs whole for older importers, but none of those exports is a contract: only
// record.mjs (RECORD_API) is.

import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from './record.mjs';
import {
  ROUNDS_BEFORE_TAKEOVER, need, resetCaches, withLock, readText, isEntry,
  cmdProfile, cmdArchive, cmdList, cmdNext, cmdMode, cmdClose, cmdCheck, cmdBranches, cmdTips, cmdQueue,
  cmdChangelog, cmdHandoffRead, cmdHandoffWrite, cmdReport, cmdImport, cmdSources,
  renderProfile, renderTips, renderQueue, renderResume, renderStatus, renderImport, renderSources, renderList, recordTypeLog,
} from './jarl-lib.mjs';
import { writeAreaDecision } from './yg-edge.mjs';

export * from './jarl-lib.mjs';

export const USAGE = `usage: jarl.mjs <command> [options]

commands:
  init "<goal>" [--committed] [--permanent] [--profile <file>]
                                                 create .jarl/ with the goal; by default it also writes .jarl/.gitignore
                                                 (* and **/*) so git never sees the loop, and every role working
                                                 outside the main checkout passes --root <main checkout>;
                                                 --committed ignores only the write lock and temporary files: the loop
                                                 is committed with the work; --permanent is committed too, marks it with
                                                 .jarl/.permanent, and is not tied to a feature branch: close (below)
                                                 keeps the directory instead of removing it; --profile checks the
                                                 profile file (see profile below) and stores it as .jarl/profile.json
  new "<title>" [--kind k] [--prio 1|2|3] [--tier standard|strong] [--tags a,b] [--files p,q] [--repo <path>] [--found-by who]
      [--where "<w>"] [--what "<w>"] [--why "<w>"] [--acceptance "<line>"]... [--changelog "<entry>"]...
      [--source <dir>#<id>,...] [--after <ids>] [--template <name>] [--field "<Name>=<value>"]... [--section "<Heading>=<text>"]...
                                                 file an issue under the next free number; --repo names the repository
                                                 its code lives in when that is not the loop's own, several as one comma
                                                 list (see --repo below);
                                                 --what, --why and --acceptance (one per line, repeatable) write the body,
                                                 --source names the finding(s) it comes from, --after the issues it waits on;
                                                 --changelog (repeatable) is the issue's changelog entry, "Added: …" etc.;
                                                 --template reads .jarl/templates/<name>.md: its Kind, Priority, Tier, Tags
                                                 and Files are defaults and its What, Why, Acceptance and Changelog the body,
                                                 each replaced by the flag when given; --field and --section
                                                 (repeatable) write the fields and sections the loop's profile declares
                                                 (a field's default when not given; a required one must be given)
  body <id> [--where "<w>"] [--what "<w>"] [--why "<w>"] [--acceptance "<line>"]... [--changelog "<entry>"]...
      [--section "<Heading>=<text>"]...
                                                 set or replace the Where field and the What, Why, Acceptance and
                                                 Changelog sections, and a section the profile declares
  import <findings.json> [--source <dir>] [--kind k] [--prio 1|2|3] [--tier t] [--tags a,b] [--repo <path>]
      [--found-by who] [--only <finding ids>] [--adopt] [--dry-run] [--field "<Name>=<value>"]...
                                                 one issue per finding, with Source: <dir>#<finding id>; a finding
                                                 whose Source is already on an issue is skipped, so a re-run files
                                                 nothing twice; --dry-run prints what it would file; --adopt writes
                                                 Source onto an older issue that names the finding id but has none
  sources [<findings.json>...] [--source <dir>]  per report: its findings, the issues filed from them and their
                                                 status; with a findings file, the findings nobody filed too
  source <id> <dir>#<id>,...                     set the Source field of an issue filed by hand
  after <id> <ids> | <id> --clear                the issues this one waits on: next does not offer it until each is
                                                 done or dropped, and status counts it as waiting
  evidence <ids> "<text>" | --ran "<command>" --saw "<what it printed>"
                                                 append a free-text note, or one checkable row per --ran/--saw pair (repeatable)
  list [--status s] [--kind k] [--tag t] [--prio p] [--grep re] [--match "<field>=<value>"]... [--all]
                                                 the issues not finished (open and in-progress) by default; --all for
                                                 every status; --match keeps those whose header field holds the value
  show <id>                                      print one issue
  set <ids> <status> "<why>" [--branch <b>] [--worker <name>] [--worktree <path>] | <ids> <field> "<value>"
                                                 change status; writes the log line in the same move; in-progress
                                                 writes Since (and Branch, Worker, Worktree when given) — one lease
                                                 for every id, so a package shares it; leaving in-progress removes
                                                 Worker, Worktree and Since and keeps Branch; done notes a merge
                                                 whose CI is not green yet; done needs evidence logged since the issue
                                                 last went in progress (or was reopened, or — never in progress — was
                                                 filed) as a --ran/--saw row — a free-text note never counts alone —
                                                 and an approve not spent by a round, a restart or a reopen; with a
                                                 field the loop's profile declares in place of the status, writes
                                                 that field (checked against its values) on every id
  merged <ids> --sha <sha> [--ci pending|green|red|none] [--repo <path>] | <ids> --ci <state>
                                                 the merge as fields: Merged (sha, and where with --repo) and CI
                                                 (pending unless given; none: no CI to wait for), and a log line;
                                                 --ci alone moves the CI of issues already merged
  tag <ids> +a -b ...                            add and remove tags
  prio <ids> 1|2|3                               set priority
  files <id> p,q,...                             declare the files the issue touches
  repo <id> <path>[,<path>...] | <id> --clear    name the repository (its root) the issue's code lives in — several as one
                                                 comma list — or remove the field
  next [--limit n]                               open issues that do not share a file with any in-progress one and
                                                 whose After issues are done or dropped; a file is its repository and
                                                 its path (see --repo below); one with no acceptance line is marked
  review <ids> approve|changes --by <reviewer> "<findings>"
                                                 the reviewer's verdict; --by is required, recorded with its kind
                                                 (self for the issue's worker or "self" — refused on an approve;
                                                 coordinator for coordinator, jarl, reeve, the loop's own name and
                                                 names on a "Coordinators:" line in goal.md; fresh for anyone else);
                                                 "done" needs an approve newer than the last round and reopen, and a
                                                 fresh one when the issue carries code (a Branch or Merged field)
  round <id> "<what failed>"                     one red round; after three prints the takeover block for a fresh worker
  check [<id>] --branch <b> [--base <feature-branch>] [--repo <path>]
                                                 commits beyond the base, diff inside the declared files, and the
                                                 change in test files and assertions — numbers, never a verdict;
                                                 read in --repo, else the issue's Repo, else the loop's own repository;
                                                 with no id, the diff is bounded by the union of Files of every issue
                                                 that records Branch <b> (a package on one branch, one call)
  branches [--base <feature-branch>] [--repo <path>] [--stale-hours n]
                                                 every jarl/NNN-* branch and every branch an issue records: the
                                                 issues on it, commits beyond the base, worktree state, STALE leases
                                                 (worktree gone, branch gone, idle over n hours, default 6) and
                                                 DONE → delete; shown only, never acted on; read in --repo, else the
                                                 loop's own repository and every repository its issues name
  ask "<question>" [--kind stop|stuck|lower|charter|ratify] [--target x] [--issue NNN]
                                                 a question the user has to answer; lower needs --target;
                                                 listed at boot until answered; ratify is a choice already made
                                                 under a mandate, awaiting the user's word, and blocks nothing
  answer <id> "<answer>"                         records the answer as a ruling and closes the question
  resume [--log n] [--ready n] [--ci]            read-only, the boot: everything a session picks the loop up from,
                                                 assembled live — goal and counts, rulings in force, in flight with
                                                 leases (and stale ones), waiting on After, questions, ratify items,
                                                 the next ready issues (n, default 10), the merge queue, merges with
                                                 CI pending or red, the tips of every repository the issues name,
                                                 loop files not committed, and the last log lines (n, default 15);
                                                 no network unless --ci asks gh for the CI of each pushed tip
  handoff read [--log n] [--ready n] [--ci] | write [--summary s] [--next x]...
                                                 read: resume, then a .jarl/handoff.md from before as history;
                                                 write: retired — writes nothing, says so and exits 0 (the state is
                                                 assembled live; intent lives in priorities, After and rulings)
  log "<event>"                                  append one dated line to the journal
  decide <slug> "<ruling>" [--by who] [--supersedes <slug>] [--settles <ids>] [--area <type> [--reach n]]
                                                 append a ruling (slug: letters, digits, . _ -); refuses a duplicate slug;
                                                 --by records who ruled (default owner); --supersedes marks the earlier
                                                 ruling "Superseded by" in place; --settles writes the ruling into each
                                                 named issue's evidence (its status is unchanged); --area marks a ruling
                                                 about a whole type of code, --reach how many files that type holds:
                                                 close puts it to the user for ratification
  decisions [--live]                             the rulings with who ruled and what superseded them; --live only
                                                 those still in force
  status [--stale-hours n] [--by repo|tag|kind|prio|<field>]
                                                 the goal, when the loop opened and last moved,
                                                 then one line: open, in flight, waiting, done, dropped, deferred,
                                                 open questions, to ratify, merged with CI pending or red; then who
                                                 reviewed the done work (fresh, coordinator, self, unrecorded); then,
                                                 when goal.md has no "Check: <command>" line, that the loop lands on
                                                 testimony alone; then the choices awaiting ratification, stale
                                                 leases, the issues in flight with no acceptance line, and —
                                                 committed loops — the loop files
                                                 git has not committed; --by adds the status counts per
                                                 repository, tag, kind, priority or a field the profile declares
  archive "<slug>"                               put the current loop away under .jarl/archive/<yyyy.mm.dd>-<slug>/,
                                                 keeping the archive, the mode markers and .jarl/templates/, so init
                                                 can open a new loop here in the same mode
  report [--found]                               what was done (per repository when it spans several), who reviewed it,
                                                 dropped, deferred and still open — ready for the changelog; --found adds
                                                 the issues found by someone other than the jarl; then the loop metrics
                                                 (cycle time, rounds, reopenings, the share of fresh reviews, red CI after
                                                 merge, follow-ups within 7 days — "no data" where the record holds none)
                                                 and the testimony mark when no check is declared; --json also carries
                                                 one row per issue and the metrics (see SKILL.md, "Loop metrics")
  tips                                           read-only: per repository the loop's issues name (open, in progress,
                                                 recently merged), the tip of each worker branch in flight, the release
                                                 branch and main, ahead/behind their upstream as last fetched, and — when
                                                 gh is on PATH — the CI of a tip its upstream holds (else "not pushed");
                                                 nothing is fetched or written
  queue [--repo <path>] [--base <b>]             read-only: the branches waiting for the merger — an open or in-progress
                                                 issue on it holds a live approve and the branch is ahead of its base —
                                                 in the order they were approved, per repository, cut into batches whose
                                                 declared files do not overlap; it runs no check and refuses nothing
  changelog <ids> [--repo <path>]                print the issues' ## Changelog entries grouped by section (Added,
                                                 Changed, Deprecated, Removed, Fixed, Security), ready to paste under
                                                 [Unreleased]; per repository when they span several; reads only
  mode permanent                                 switch an existing committed loop to the permanent mode, with a
                                                 log line; refuses a default-mode loop (out of git — a permanent
                                                 record must be committed) and an already-permanent one
  profile [<file>]                               read-only: the loop's profile — its statuses and what each one means
                                                 (dispatchable, holds-claim, settles-dependents, terminal, closes-record,
                                                 needs-reason), the status a new issue starts in, the values of Kind and
                                                 Tier, the fields and sections its issues carry and the heading of their
                                                 acceptance; the built-in one when the loop has none; with a file, that
                                                 file checked against the profile schema instead
  close [--force] [--batch]                      refuse while anything is open or in progress; else remove .jarl/
                                                 — a permanent loop (see init --permanent, or mode permanent) is
                                                 kept instead: it logs the close and the directory stays as the record;
                                                 first it files the ratification batch — at most 10 area rulings, widest
                                                 reach first, each a ratify item answered yes or reject — and never waits
                                                 for it; --batch files the batch only and closes nothing; a ratified
                                                 area ruling is written into the type's decision log (yg log add
                                                 --type) when the repository has a graph and a working yg

options: --json  --help  --root <repo root>

<ids> (evidence, review, set, tag, prio, merged): one id, or several as one comma list with ranges — 12,13,14 or
203-206,209. Every id and every precondition is checked before anything is written, so the call lands on
all of them or on none, with one log line per issue.

Flags: a flag the command does not take is an error. A value flag takes the next argument whatever it
starts with (--ran "--help" records a row), or inline as --flag=value. A bare -- ends the flags: put a
note or a title that starts with -- after it, and every flag (--root too) before it. Words beyond what a
command reads are an error.

Writes: every command that writes holds .jarl/.lock while it runs (the holder's pid, host and time are
inside), so parallel calls from workers, reviewers and the merger queue instead of losing each other's
writes; a lock whose holder is gone is taken over, a live one that does not let go within 20 s fails the
call with nothing written. Files are replaced whole, never half-written.

--repo <path>: the checkout of another repository, for a loop that keeps its issues in one repository
while its workers change another. Branches, the base (that checkout's current branch), diffs and
assertions are then read there. A relative path is read from the loop's root (the directory holding
.jarl/), so it means the same from any worktree. An issue that names a repository writes each of its
files with that repository's directory name first (tool/src/a.mjs for Repo ../tool): next then keeps
the same path in two repositories apart, and check matches the path after the name. An issue may name
several repositories (Repo: ../tool, ../lib): each file then starts with the name of the one it is in
(one with no such name is in the first), and check on it takes --repo to say which one to read.`;
// ---- main --------------------------------------------------------------------------------------

// Every flag a command accepts, and what it takes: 'bool' takes no value, 'value' takes exactly one,
// 'many' may repeat (one value each time). A value flag always consumes the next argument, whatever it
// starts with — `--ran "--help"` records a row whose command is --help — or takes it inline as
// --flag=value. A bare `--` ends the flags: everything after it is positional, so a free-text note or
// a title that starts with -- goes there. A flag the command does not know is an error that names the
// ones it does, never silently dropped.
export const GLOBAL_FLAGS = { json: 'bool', help: 'bool', root: 'value' };
export const COMMAND_FLAGS = {
  init: { committed: 'bool', permanent: 'bool', profile: 'value' },
  new: {
    kind: 'value', prio: 'value', tier: 'value', tags: 'value', files: 'value', repo: 'value', 'found-by': 'value',
    where: 'value', what: 'value', why: 'value', acceptance: 'many', source: 'value', after: 'value', changelog: 'many', template: 'value',
    field: 'many', section: 'many',
  },
  body: { where: 'value', what: 'value', why: 'value', acceptance: 'many', changelog: 'many', section: 'many' },
  import: {
    source: 'value', kind: 'value', prio: 'value', tier: 'value', tags: 'value', repo: 'value', 'found-by': 'value',
    only: 'value', adopt: 'bool', 'dry-run': 'bool', field: 'many',
  },
  sources: { source: 'value' },
  source: {},
  after: { clear: 'bool' },
  evidence: { ran: 'many', saw: 'many' },
  list: { status: 'value', kind: 'value', tag: 'value', prio: 'value', grep: 'value', match: 'many', all: 'bool' },
  show: {}, set: { branch: 'value', worker: 'value', worktree: 'value' }, tag: {}, prio: {}, files: {},
  repo: { clear: 'bool' },
  next: { limit: 'value' },
  review: { by: 'value' }, round: {},
  check: { branch: 'value', base: 'value', repo: 'value' },
  branches: { base: 'value', repo: 'value', 'stale-hours': 'value' },
  merged: { sha: 'value', ci: 'value', repo: 'value' },
  ask: { kind: 'value', target: 'value', issue: 'value' },
  answer: {},
  resume: { log: 'value', ready: 'value', ci: 'bool' },
  handoff: { summary: 'value', next: 'many', log: 'value', ready: 'value', ci: 'bool' },
  log: {}, decide: { settles: 'value', by: 'value', supersedes: 'value', area: 'value', reach: 'value' }, decisions: { live: 'bool' },
  status: { 'stale-hours': 'value', by: 'value' }, archive: {}, report: { found: 'bool' }, tips: {}, mode: {},
  queue: { repo: 'value', base: 'value' }, changelog: { repo: 'value' },
  close: { force: 'bool', batch: 'bool' }, profile: {},
};

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  let cmd;
  let rest = false;
  const table = () => ({ ...GLOBAL_FLAGS, ...(COMMAND_FLAGS[cmd] || {}) });
  const named = (t) => Object.keys(t).map((k) => `--${k}`).join(', ');
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (rest || !a.startsWith('--') || a.length === 2) {
      if (a === '--' && !rest) { rest = true; continue; }
      positional.push(a);
      if (cmd === undefined) {
        cmd = a;
        need(COMMAND_FLAGS[cmd], `unknown command: ${cmd}\n${USAGE}`);
      }
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    const inline = eq === -1 ? undefined : a.slice(eq + 1);
    const t = table();
    const kind = Object.hasOwn(t, name) ? t[name] : undefined;
    if (kind === undefined) {
      const where = cmd === undefined ? `before the command — only ${named(GLOBAL_FLAGS)} may come before it` : `for ${cmd} — it takes ${named(t)}`;
      throw new Error(`unknown flag ${a} ${where}. A value that starts with -- goes after a bare --, e.g. evidence 001 -- "--json prints ok"`);
    }
    if (kind === 'bool') {
      need(inline === undefined, `--${name} takes no value`);
      flags[name] = true;
      continue;
    }
    let value = inline;
    if (value === undefined) {
      need(i + 1 < argv.length, `--${name} needs a value`);
      value = argv[i + 1];
      i += 1;
    }
    if (kind === 'many') flags[name] = flags[name] === undefined ? value : [].concat(flags[name], value);
    else {
      need(flags[name] === undefined, `--${name} given twice — it takes one value`);
      flags[name] = value;
    }
  }
  // Words beyond what the command reads are an error, not dropped: after a bare -- that is also where a
  // --root written last would land, and a call that silently lost its --root would write to another loop.
  if (cmd !== undefined && Object.hasOwn(ARITY, cmd)) {
    const extra = positional.slice(1 + ARITY[cmd]);
    need(extra.length === 0, `${cmd} takes at most ${ARITY[cmd]} argument${ARITY[cmd] === 1 ? '' : 's'} — unexpected: ${extra.map((x) => JSON.stringify(x)).join(' ')}${rest ? ' (everything after a bare -- is an argument, so flags such as --root go before it)' : ''}; several ids are one argument: 12,13 or 203-206`);
  }
  return { positional, flags };
}
// The arguments each command reads after its name, in order, named: the MCP server (jarl-mcp.mjs) turns each
// name into a field of that command's tool, so this table and COMMAND_FLAGS are the one source of both the
// CLI and the tools. A name ending in ? may be left out; one ending in ... takes any number of words (tag's
// +a -b, sources' findings files) and has no upper bound. A command's arity is how many names it has.
export const COMMAND_ARGS = {
  init: ['goal'], new: ['title'], body: ['id'], import: ['file'], sources: ['files...'], source: ['id', 'refs'],
  after: ['id', 'ids?'], evidence: ['ids', 'text?'], list: [], show: ['id'], set: ['ids', 'status', 'why?'],
  merged: ['ids'], tag: ['ids', 'ops...'], prio: ['ids', 'priority'], files: ['id', 'paths'], repo: ['id', 'path?'],
  next: [], review: ['ids', 'verdict', 'findings'], round: ['id', 'what'], check: ['id?'], branches: [],
  ask: ['question'], answer: ['id', 'answer'], resume: [], handoff: ['action?'], log: ['event'],
  decide: ['slug', 'ruling'], decisions: [], status: [], archive: ['slug'], report: [], tips: [], queue: [],
  changelog: ['ids'], mode: ['mode'], close: [], profile: ['file?'],
};
const ARITY = Object.fromEntries(Object.entries(COMMAND_ARGS).filter(([, a]) => !a.some((n) => n.endsWith('...'))).map(([c, a]) => [c, a.length]));

// The commands that write: each runs under .jarl/.lock (see withLock).
export const MUTATING = new Set(['init', 'new', 'body', 'import', 'source', 'after', 'set', 'merged', 'tag', 'prio', 'files', 'repo', 'evidence', 'review', 'round', 'ask', 'answer', 'log', 'decide', 'archive', 'mode', 'close']);

function main() {
  let parsed;
  try { parsed = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
  const { positional, flags } = parsed;
  const [cmd, ...rest] = positional;
  if (!cmd || flags.help) { console.log(USAGE); process.exit(cmd ? 0 : 1); }
  const root = R.resolveRoot(flags.root);
  let r;
  try { r = dispatch(root, cmd, rest, flags); } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const { out, text, warn } = r;
  console.log(flags.json ? JSON.stringify(out, null, 2) : text);
  for (const w of warn) console.error(w);
  if (cmd === 'check' && !out.ok) process.exit(2);
}

// The ratification batch as close prints it: one line per item, then what became of the ones nobody answered.
function renderBatch(batch, loop) {
  if (!batch.items.length && !batch.waiting) return loop === 'open' ? 'no area ruling awaits ratification' : '';
  const head = `\nto ratify (${batch.items.length}${batch.waiting ? `, ${batch.waiting} more at the next close` : ''}) — answer each with yes or reject (tak or nie): jarl.mjs answer <a-id> "yes"`;
  const tail = { open: 'nothing closed; the loop goes on', kept: 'unanswered items stay open in the record', removed: 'unanswered, they left with the loop as its own rulings' }[loop];
  return `${head}\n${batch.items.map((i) => `- ${i.ask} · ${i.question}`).join('\n')}\n${tail}`;
}
function renderTypeLog(t) {
  if (!t) return '';
  if (t.state === 'written') return ` · written into the type's decision log${t.datetime ? ` (${t.datetime})` : ''}`;
  if (t.state === 'skipped') return ` · not written into a type log: ${t.reason}`;
  return ` · NOT written into the type log: ${t.reason}`;
}

// set <ids> <status> [why] or set <ids> <field> <value>: a name the profile declares as a field (and not as a status)
// is a field; anything else is a status, refused by setStatus with the CLI's own words when it names neither.
function setCommand(root, ids, name, value, flags) {
  const profile = R.loadProfile(root);
  const field = name !== undefined && !profile.statuses.includes(name) && profile.field(name);
  // The command line (and the MCP tools, which run through dispatch) always sets as caller 'cli'.
  const opts = { ...flags, caller: 'cli' };
  return field ? R.setField(root, ids, name, value, opts) : R.setStatus(root, ids, name, value, opts);
}

// One command, run: its result (what --json prints), its text and the notes said on stderr. Throws on a refusal.
// Every call starts from empty caches, so a caller that runs many commands in one process (a server) sees each
// time what is on disk and in git now, exactly as a fresh process would.
export function dispatch(root, cmd, rest, flags) {
  resetCaches();
  let out;
  let text;
  let warn = [];   // said on stderr, so a caller reading stdout sees the same lines as before
  const each = (o, f) => [].concat(o).map(f).join('\n');
  const writes = MUTATING.has(cmd);
  {
    (writes ? (fn) => withLock(root, fn) : (fn) => fn())(() => {
    switch (cmd) {
      case 'init': out = R.initLoop(root, rest[0], flags); text = `opened ${out.dir} · ${out.permanent ? 'permanent record, no branch' : out.committed ? 'committed with the work' : 'kept out of git'}${out.profile ? ` · profile ${out.profile}` : ''}`; break;
      case 'new': out = R.newIssue(root, rest[0], flags); text = `filed ${out.id} · ${out.file}`; break;
      case 'body': out = R.setBody(root, rest[0], flags); text = `${out.id} body: ${out.set.join(', ')}`; break;
      case 'source': out = R.setSource(root, rest[0], rest[1]); text = `${out.id} source: ${out.sources.join(', ')}`; break;
      case 'after': out = R.setAfter(root, rest[0], rest[1], flags); text = `${out.id} after: ${out.cleared ? 'cleared' : out.after.join(', ')}`; break;
      case 'import': out = cmdImport(root, rest[0], flags); text = renderImport(out); break;
      case 'sources': out = cmdSources(root, rest, flags); text = renderSources(out); break;
      case 'list': out = cmdList(root, flags); text = renderList(out, R.loadProfile(root)); break;
      case 'show': { const i = R.findIssue(root, rest[0]); need(i, `no such issue: ${rest[0]}`); out = i; text = readText(i.file); break; }
      case 'set': out = setCommand(root, rest[0], rest[1], rest[2], flags); text = each(out, (o) => (o.field ? `${o.id} ${o.field}: ${o.value || '(cleared)'}` : `${o.id} → ${o.status}${o.branch ? ` · ${o.branch}` : ''}${o.worker ? ` · ${o.worker}` : ''}`)); warn = [].concat(out).filter((o) => o.note).map((o) => `note: ${o.id} ${o.note}`); break;
      case 'tag': out = R.setTags(root, rest[0], rest.slice(1)); text = each(out, (o) => `${o.id} tags: ${o.tags.join(', ') || '(none)'}`); break;
      case 'prio': out = R.setPriority(root, rest[0], rest[1]); text = each(out, (o) => `${o.id} priority ${o.priority}`); break;
      case 'files': out = R.setFiles(root, rest[0], rest[1]); text = `${out.id} files: ${out.files.join(', ') || '(none)'}`; break;
      case 'repo': out = R.setRepo(root, rest[0], rest[1], flags); text = `${out.id} repo: ${out.cleared ? 'cleared' : out.repo}`; break;
      case 'evidence': out = R.addEvidence(root, rest[0], rest[1], flags); text = each(out, (o) => (o.rows ? `${o.id} evidence row${o.rows.length > 1 ? 's' : ''} recorded` : `${o.id} evidence recorded`)); break;
      case 'next': out = cmdNext(root, flags); text = out.scheduler ? out.note : out.length ? out.map((r) => (r.ready ? `${r.id}  P${r.priority}  ${r.title}${r.noAcceptance ? '  (no acceptance yet)' : ''}` : r.after.length ? `${r.id}  P${r.priority}  ${r.title}  (after ${r.after.join(', ')})` : `${r.id}  P${r.priority}  ${r.title}  (waits on ${r.waitsOn.join(', ')})`)).join('\n') : '(nothing open)'; break;
      case 'review': out = R.review(root, rest[0], rest[1], rest[2], flags); text = each(out, (o) => `${o.id} review ${o.verdict}${o.by ? ` by ${o.by} (${o.kind})` : ''} · acceptance: ${o.acceptance ? o.acceptance.split('\n').join(' / ') : '(none on file)'}`); warn = [].concat(out).filter((o) => o.note).map((o) => `note: ${o.note}`); break;
      case 'round': out = R.addRound(root, rest[0], rest[1]); text = out.takeover ? `${out.id} round ${out.round} — takeover:\n\n${out.block}` : `${out.id} round ${out.round} of ${ROUNDS_BEFORE_TAKEOVER} before a takeover`; break;
      case 'merged': out = R.recordMerged(root, rest[0], flags); text = `${out.ids.join(', ')} ${out.sha ? `merged ${out.sha}` : 'merge'} · CI ${out.ci}`; warn = out.notes.map((n) => `note: ${n}`); break;
      case 'check': out = cmdCheck(root, rest[0], flags); text = `${out.id === null ? `package ${out.ids.join(', ')} on ${out.branch}\n` : ''}${out.repo === root ? '' : `in ${out.repo}\n`}${out.items.map((i) => `${i.ok ? '✓' : '✗'} ${i.name} — ${i.note}`).join('\n')}`; break;
      case 'branches': out = cmdBranches(root, flags); text = out.length ? out.map((b) => `${b.repo !== basename(root) ? `[${b.repo}] ` : ''}${b.branch}${b.issues.length ? ` → ${b.issues.join(', ')}` : ''}  ${b.missing ? 'GONE' : `+${b.ahead ?? '?'}  ${b.worktree ? `${b.worktree}${b.worktreeGone ? ' (gone)' : b.dirty ? ` (${b.dirty} uncommitted)` : ' (clean)'}` : '(no worktree)'}`}${b.unnamed ? '  UNNAMED — rename to jarl/NNN-slug before merging' : ''}${{ delete: '  DONE → delete', dirty: '  DONE (worktree dirty)', unverified: '  DONE (merged by record, branch not in base) — verify' }[b.done] || ''}${b.stale.length ? `  STALE: ${b.stale.join('; ')}` : ''}`).join('\n') : '(no worker branches)'; break;
      case 'ask': out = R.ask(root, rest[0], flags); text = out.kind === 'ratify' ? `filed a-${out.id} for ratification · blocks nothing` : `asked a-${out.id}`; break;
      case 'answer': out = R.answer(root, rest[0], rest[1]); break;   // text below: the type log is written outside the lock
      case 'resume': out = R.resumeData(root, flags); text = renderResume(out, R.loadProfile(root)); break;
      case 'handoff':
        need(rest[0] === undefined || rest[0] === 'read' || rest[0] === 'write', `handoff takes read or write (got "${rest[0]}") — the state is assembled live by resume`);
        if (rest[0] === 'write') { out = cmdHandoffWrite(); text = out.note; } else { out = cmdHandoffRead(root, flags); text = out.text; }
        break;
      case 'report': out = cmdReport(root, flags); text = out.text; break;
      case 'log': out = R.appendLog(root, rest[0]); text = 'logged'; break;
      case 'decide': out = R.decide(root, rest[0], rest[1], flags); text = `decided ${out.slug} · by ${out.by}${out.supersedes ? ` · supersedes ${out.supersedes}` : ''}${out.settles.length ? ` · written into ${out.settles.join(', ')}` : ''}${out.area ? ` · area ${out.area}${out.reach !== null ? ` (${out.reach} file${out.reach === 1 ? '' : 's'})` : ''} · put to ratification at close` : ''}`; break;
      case 'decisions': out = R.decisions(root, flags); text = out.length ? out.map((d) => `${d.date} · ${d.slug}${d.by ? ` · by ${d.by}` : ''}${d.area ? ` · area ${d.area}${d.ratified ? ' ratified' : d.rejected ? ' rejected' : ''}` : ''}${d.supersededBy ? ` · SUPERSEDED by ${d.supersededBy}` : ''}${d.supersedes ? ` · supersedes ${d.supersedes}` : ''} — ${(d.ruling.split('\n').find((l) => l.trim()) || '').slice(0, 160)}`).join('\n') : '(no rulings)'; break;
      case 'status': out = R.statusData(root, flags); text = renderStatus(out, R.loadProfile(root)); break;
      case 'tips': out = cmdTips(root); text = renderTips(out); break;
      case 'queue': out = cmdQueue(root, flags); text = renderQueue(out); break;
      case 'changelog': out = cmdChangelog(root, rest[0], flags); text = out.text || '(no changelog fragment on these issues)'; warn = out.missing.length ? [`note: no changelog fragment: ${out.missing.join(', ')} — record one with: jarl.mjs body <id> --changelog "Added: …"`] : []; break;
      case 'archive': out = cmdArchive(root, rest[0]); text = `archived → ${out.archived}${out.leftOpen.length ? ` · ${out.leftOpen.length} still open or in progress: ${out.leftOpen.join(', ')}` : ''} · open a new loop with: jarl.mjs init "<goal>"`; break;
      case 'mode': out = cmdMode(root, rest[0]); text = 'now permanent · no longer tied to a feature branch; close keeps the directory'; break;
      case 'profile': out = cmdProfile(root, rest[0]); text = renderProfile(out); break;
      case 'close': out = cmdClose(root, flags); text = out.closed ? (out.kept ? `kept ${out.kept} · closed as a permanent record` : `removed ${out.removed}`) + (out.deferred.length ? ` · ${out.deferred.length} deferred still waiting: ${out.deferred.join(', ')}` : '') + (out.uncommitted ? ` · ${out.uncommitted} loop file(s) not committed${out.kept ? ' — commit .jarl/' : ' before the removal'}` : '') + renderBatch(out.batch, out.kept ? 'kept' : 'removed') : renderBatch(out.batch, 'open').trimStart(); break;
      default: throw new Error(`unknown command: ${cmd}\n${USAGE}`);
    }
    });
  }
  // A ratified area ruling goes to the type's decision log after the answer is recorded and the lock let go: the
  // probe and the write run another tool, which may take a while, and other writers of the loop must not wait on it.
  if (cmd === 'answer') {
    if (out.typeDecision) {
      out.typeLog = writeAreaDecision(root, out.typeDecision);
      try { withLock(root, () => recordTypeLog(root, out.ruling, out.typeDecision, out.typeLog)); } catch (e) { warn.push(`note: what became of ${out.ruling} in the type log was not recorded in the loop: ${e.message}`); }
    }
    text = `answered a-${out.id}${out.issue ? ` · written into ${out.issue}` : ''}${out.verdict ? ` · ${out.ruling} ${out.verdict}${renderTypeLog(out.typeLog)}` : ''}`;
    if (out.typeLog?.state === 'failed') warn.push(`note: ${out.ruling} stays a ruling of this loop; write it by hand in ${out.typeLog.repo}: ${out.typeLog.retry} (add --supersedes <datetime> or --adds when yg lists decisions in force)`);
  }
  return { out, text, warn };
}

if (isEntry(process.argv[1], fileURLToPath(import.meta.url))) main();
