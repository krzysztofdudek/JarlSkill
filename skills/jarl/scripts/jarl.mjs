#!/usr/bin/env node
// jarl.mjs — the one tool the jarl skill's state moves through: the command line over record.mjs.
//
// Markdown is the source of truth: the loop's goal, decisions and log, and one
// .jarl/issues/7-slug.md per issue. This script only reads and writes those files, so anything
// it does can be checked by opening them. Zero dependencies, Node 22+.
//
// What is here: the usage text, the flag and argument tables, the parser and dispatch — one command, run and rendered.
// Every operation on the record goes through record.mjs, the stable surface another tool may vendor; the rest of the
// commands (the views over git, import, report and the like) come from jarl-lib.mjs, the implementation behind both.
// This module re-exports jarl-lib.mjs whole, but none of those exports is a contract: only
// record.mjs (RECORD_API) is.

import { fileURLToPath } from 'node:url';
import * as R from './record.mjs';
import {
  ROUNDS_BEFORE_TAKEOVER, need, resetCaches, withLock, readText, isEntry, cmdSet,
  cmdProfile, cmdArchive, cmdList, cmdNext, renderNext, cmdMode, cmdClose, cmdCheck, cmdBranches, cmdTips, cmdQueue,
  cmdChangelog, cmdHandoffRead, cmdHandoffWrite, cmdReport, cmdImport, cmdSources, cmdAnswer, cmdModels, renderModels,
  renderProfile, renderTips, renderQueue, renderResume, renderStatus, renderImport, renderSources, renderList, recordTypeLog, recordRuleLog,
  runDecisionsDriver, mergeFlags, describeNew, renderNewReply, issueView, evidenceTable, renderBranches, renderDecide, renderDecisions,
} from './jarl-lib.mjs';
import { writeAreaDecision, writeRuleRatification } from './yg-edge.mjs';

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
  new "<title>" [--kind k] [--prio 1|2|3] [--tier light|standard|strong] [--tags a,b] [--files p,q] [--repo <path>] [--found-by who]
      [--where "<w>"] [--what "<w>"] [--why "<w>"] [--acceptance "<line>"]... [--changelog "<entry>"]...
      [--source <dir>#<id>,...] [--after <ids>] [--template <name>] [--field "<Name>=<value>"]... [--section "<Heading>=<text>"]...
                                                 file an issue under the next free number; without --tier it records
                                                 standard and says so on stderr, with what each tier is for (light: a check
                                                 or test decides; strong: unknown cause, design, record format, security);
                                                 --repo names the repository
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
  body <id> [--title "<t>"] [--where "<w>"] [--what "<w>"] [--why "<w>"] [--acceptance "<line>"]... [--changelog "<entry>"]...
      [--section "<Heading>=<text>"]...
                                                 set or replace the title (the file keeps its name; the old title goes
                                                 into the log), the Where field and the What, Why, Acceptance and
                                                 Changelog sections, and a section the profile declares
  import <findings.json> [--source <dir>] [--kind k] [--prio 1|2|3] [--tier t] [--tags a,b] [--repo <path>]
      [--found-by who] [--only <finding ids>] [--adopt] [--dry-run] [--field "<Name>=<value>"]...
                                                 one issue per finding, with Source: <dir>#<finding id>; a finding
                                                 whose Source is already on an issue is skipped, so a re-run files
                                                 nothing twice; --dry-run prints what it would file; --adopt writes
                                                 Source onto an existing issue that names the finding id but has none
  sources [<findings.json>...] [--source <dir>]  per report: its findings, the issues filed from them and their
                                                 status; with a findings file, the findings nobody filed too
  source <id> <dir>#<id>,...                     set the Source field of an issue filed by hand
  after <id> <ids> | <id> --clear                the issues this one waits on: next does not offer it until each is
                                                 done or dropped, and status counts it as waiting
  evidence <ids> "<text>" | --ran "<command>" --saw "<what it printed>" | <id> --retract <n> --by <who> "<reason>"
                                                 append a free-text note (under ### Notes), or one checkable row per --ran/--saw
                                                 pair (repeatable; under ### Proof, after the last row);
                                                 --retract retracts the n-th evidence row (the number show prints before each row,
                                                 counted over the whole Evidence section) by an appended entry: the row
                                                 stays, struck through, and the done gate does not count it; the first
                                                 retraction of a loop raises its record format to 2, so a reader that
                                                 knows only format 1 refuses the loop instead of counting the row
  list [--status s] [--kind k] [--tag t] [--prio p] [--grep re] [--match "<field>=<value>"]... [--all]
                                                 the issues not finished (open and in-progress) by default; --all for
                                                 every status; --match keeps those whose header field holds the value
  show <id> [--full]                             print one issue as the done gate sees it: the header, What, Why,
                                                 Acceptance and Changelog, every Proof row (numbered [n]) and every
                                                 verdict in the done gate's window, Notes whole, every "changes" finding no later
                                                 approve answered, one line per earlier round; --full prints the whole
                                                 file; --json is complete; under the header, one line for each header
                                                 field that disagrees with the log (see status)
  set <ids> <status> "<why>" [--branch <b>] [--worker <name>] [--model <m>] [--worktree <path>] [--header] | <ids> <field> "<value>"
                                                 (<ids> <status-in-the-log> --header rewrites the header fields the log
                                                 renders from the log, writes no log line and is never a move)
                                                 (field resources "a, b": the exclusive resources the issue holds while
                                                 its lease lasts, loop-wide names; next never offers two issues holding one)
                                                 change status; writes the log line in the same move; in-progress
                                                 writes Since (and Branch, Worker, Model, Worktree when given) — one lease
                                                 for every id, so a package shares it; --model is the model the worker
                                                 was raised on, as the platform names it (with @<effort> where it has that
                                                 lever), stored as given; leaving in-progress removes Worker, Model,
                                                 Worktree and Since and keeps Branch; done notes a merge
                                                 whose CI is not green yet; done needs, inside one window (rows after
                                                 the last start, reopen or filing; approves after those or a red
                                                 round), a --ran/--saw row — a free-text note never counts alone —
                                                 and a live approve; with a
                                                 field the loop's profile declares in place of the status, writes
                                                 that field (checked against its values) on every id
  merged <ids> --sha <sha> [--ran "<check>" --saw "<summary>" | --red <id>] [--ci pending|green|red|none] [--repo <path>] [--keep] | <ids> --ci <state>
                                                 the merge as fields: Merged (sha, and where with --repo) and CI
                                                 (only when given; pending: a pushed commit whose CI will report;
                                                 none: no CI to wait for), and a log line. --ran/--saw record the
                                                 check that decided the merge and what it printed, in the merge
                                                 record (the Merge check field and the merge line): never as a Proof
                                                 row, because the merger's check is not the worker's proof (done
                                                 asks the worker for the row; the reply says when none is there).
                                                 --red <id> records a merge that
                                                 landed while its check was red for a cause outside the branch, which
                                                 issue <id> tracks; it is never counted as a passing check, and the
                                                 jarl rules on it first. --ci alone moves the CI of issues already
                                                 merged. After it records a sha it removes the issue's worktree and
                                                 local branch (git worktree remove, git branch -d, never a force)
                                                 when that is safe, and names why it kept them when it is not;
                                                 --keep skips it
  tag <ids> +a -b ...                            add and remove tags
  prio <ids> 1|2|3                               set priority
  files <id> p,q,...                             declare the files the issue touches
  repo <id> <path>[,<path>...] | <id> --clear    name the repository (its root) the issue's code lives in — several as one
                                                 comma list — or remove the field
  next [--limit n] [--all]                       the open issues ready to start: no file shared with an in-progress one, every
                                                 After issue done or dropped, no open stuck or stop question on it; a file is
                                                 its repository and its path (see --repo below); one with no acceptance line
                                                 or no declared files is marked; --all adds the others in groups (held by a
                                                 file and by whom, waiting on After, held by a question), --json rows carry a group
  review <ids> approve|changes --by <reviewer> [--model <m>] [--relayed] "<findings>"
                                                 the reviewer's verdict; --model is the model the reviewer was raised on
                                                 (stored as given); --relayed marks a verdict recorded by someone else in
                                                 the reviewer's name, for a reviewer that cannot be resumed to record its
                                                 own; --by is required, recorded with its kind
                                                 (self for the issue's worker or "self" — refused on an approve;
                                                 coordinator for coordinator, jarl, reeve, the loop's own name and
                                                 names on a "Coordinators:" line in goal.md; fresh for anyone else);
                                                 "done" needs an approve inside the gate's window, and a
                                                 fresh one when the issue carries code (a Branch or Merged field), and
                                                 the worker's Proof row; an approve on an issue with no Proof row says so;
                                                 findings need at least three words; "retract" in place of the verdict
                                                 (review <id> retract --by <who> "<reason>") retracts the newest approve
                                                 not yet retracted, by an appended entry: the approve stays, struck
                                                 through, and the done gate and the metrics stop counting it; never a
                                                 "changes" verdict; the first retraction of a loop raises its record
                                                 format to 2 (see evidence --retract)
  round <id> "<what failed>"                     one red round; after three prints the takeover block for a fresh worker,
                                                 with the advice to raise it one tier up or on another model
  models [--by repo|tag] [--with <root>]... [--archives]
                                                 read-only: per model as worker and as reviewer, per Kind · Tier, what the
                                                 record holds (units, clean first passes, changes, rounds, verdicts, checked
                                                 approves), every count with its n and a share only from n >= 5, with the
                                                 words fits, below, new and may clear; work with no recorded model
                                                 is grouped by tier; --by slices by repository or tag; --with reads another
                                                 loop (its root, or an archive directory) and --archives this loop's own
                                                 archives, merged into one table that names the loops it read; a path that
                                                 is not a loop is refused; suggestions only, no lock, nothing written
  check [<id>] --branch <b> [--base <feature-branch>] [--repo <path>]
                                                 commits beyond the base, diff inside the declared files, and the
                                                 change in test files and assertions — numbers, never a verdict;
                                                 read in --repo, else the issue's Repo, else the loop's own repository;
                                                 with no id, the diff is bounded by the union of Files of every issue
                                                 that records Branch <b> (a package on one branch, one call)
  branches [--base <feature-branch>] [--repo <path>] [--stale-hours n]
                                                 every jarl/7-* branch and every branch an issue records: the
                                                 issues on it, commits beyond the base, worktree state, STALE leases
                                                 (worktree gone, branch gone, idle over n hours, default 6) and
                                                 DONE → delete; shown only, never acted on; read in --repo, else the
                                                 loop's own repository and every repository its issues name
  ask "<question>" [--kind stop|stuck|lower|charter|ratify] [--target x] [--issue 7]
                                                 a question the user has to answer; lower needs --target;
                                                 listed at boot until answered; ratify is a choice already made
                                                 under a mandate, awaiting the user's word, and blocks nothing
  answer <id> "<answer>" [--by who]              records the answer as a ruling and closes the question; --by
                                                 records who answered (default owner) and, on a ratify item whose
                                                 ruling names a rule, is who the rule's ratification names
  resume [--log n] [--ready n] [--ci]            read-only, the boot: everything a session picks the loop up from,
                                                 assembled live — goal and counts, rulings in force, in flight with
                                                 leases (and stale ones), waiting on After, questions, ratify items,
                                                 the next ready issues (n, default 10), the merge queue, merges with
                                                 CI pending or red, the tips of every repository the issues name,
                                                 loop files not committed, and the last log lines (n, default 15);
                                                 no network unless --ci asks gh for the CI of each pushed tip
  handoff read [--log n] [--ready n] [--ci] | write [--summary s] [--next x]...
                                                 read: resume, then a .jarl/handoff.md, when one exists, as history;
                                                 write: retired — writes nothing, says so and exits 0 (the state is
                                                 assembled live; intent lives in priorities, After and rulings)
  log "<event>"                                  append one dated note to the journal; a line that reads as a filing, a move,
                                                 a round, a verdict, a retraction, an evidence row, a merge, a CI state or
                                                 a body change is refused, and the refusal names the command that writes it
  decide <slug> "<ruling>" [--by who] [--supersedes <slug>] [--settles <ids>] [--area <type> [--reach n] [--rule <id>]]
                                                 append a ruling (slug: letters, digits, . _ -); refuses a duplicate slug;
                                                 --by records who ruled (default owner); --supersedes marks the earlier
                                                 ruling "Superseded by" in place; --settles writes the ruling into each
                                                 named issue's evidence (its status is unchanged); --area marks a ruling
                                                 about a whole type of code, --reach how many files that type holds,
                                                 --rule the graph's rule it admits on that type (its id):
                                                 close puts it to the user for ratification
  decisions [--live]                             the rulings with who ruled and what superseded them; --live only
                                                 those still in force
  status [--stale-hours n] [--by repo|tag|kind|prio|<field>] [--tag <t>]
                                                 --tag computes every part of status over the issues carrying that tag only
                                                 the log is the record of an issue's status, lease, merge and CI; a header
                                                 that disagrees is never believed, and status prints one "record:" line
                                                 for it, with how to write the header back or make it the record (resume
                                                 and show print it too; --json carries disagreements when there are any)
                                                 the goal, when the loop opened and last moved,
                                                 then one line: open, in flight, waiting, done, dropped, deferred,
                                                 open questions, to ratify, merged with CI pending or red; then who
                                                 reviewed the done work (fresh, coordinator, self, unrecorded); then,
                                                 per repository, "k of n merges carry the declared check" (a merge
                                                 carries it when its --ran text equals a command a Check line of
                                                 goal.md declares), the testimony mark for a repository that declares
                                                 none and while no merge carries the declared check; then the choices awaiting ratification, stale
                                                 leases, the issues in flight with no acceptance line, and —
                                                 committed loops — the loop files
                                                 git has not committed; --by adds the status counts per
                                                 repository, tag, kind, priority or a field the profile declares
  archive "<slug>"                               put the current loop away under .jarl/archive/<yyyy.mm.dd>-<slug>/,
                                                 keeping the archive, the mode markers and .jarl/templates/, so init
                                                 can open a new loop here in the same mode; refused under a profile
                                                 whose "lifecycle" keeps archive to the record (it names the command)
  report [--found]                               what was done (per repository when it spans several), who reviewed it,
                                                 dropped, deferred and still open — ready for the changelog; --found adds
                                                 the issues found by someone other than the jarl; then the loop metrics
                                                 (cycle time, rounds, reopenings, the share of fresh reviews, red CI after
                                                 merge, follow-ups within 7 days — "no data" where the record holds none)
                                                 and the landing banner, per repository "k of n merges carry the declared
                                                 check", with the testimony mark as status shows it; --json also carries
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
  close [--force] [--batch]                      refuse while anything is open or in progress, and, where it removes .jarl/,
                                                 while anything is deferred (the refusal names archive "<slug>", which
                                                 keeps the loop under .jarl/archive/, and --force, which removes the
                                                 loop with its open and deferred issues, keeping no copy); else remove the live
                                                 loop (in the default mode close and init leave .jarl/archive/ in place;
                                                 in the committed mode close refuses while it holds anything, naming it —
                                                 move it out of the tree, or --force removes it with the loop)
                                                 — a permanent loop (see init --permanent, or mode permanent) is
                                                 kept instead: it logs the close and the directory stays as the record;
                                                 first it files the ratification batch — at most 10 area rulings, widest
                                                 reach first, each a ratify item answered yes or reject — and never waits
                                                 for it; --batch files the batch only and closes nothing; a ratified
                                                 area ruling is written into the type's decision log (yg log add
                                                 --type) when the repository has a graph and a working yg, and one
                                                 naming a rule also ratifies it (yg log add --aspect --ratify);
                                                 refused under a profile whose "lifecycle" keeps close to the record

options: --json  --help  --root <repo root>

git merges (not loop commands: no --root, no lock, no tool of the MCP server):
  merge-driver decisions <base> <ours> <theirs>  the driver git runs for .jarl/decisions.md (%O %A %B): the rulings of
                                                 both sides block by block, written over <ours>, exit 0; conflict
                                                 markers and exit 1 for a ruling both sides superseded, a slug both
                                                 sides added, a ruling both sides rewrote; .jarl/log.md merges by union
  merge-driver flags [--yg "<yg command>"]       the -c settings a merger puts between git and merge on every merge,
                                                 so the drivers run whatever the clone holds: the decisions driver, and
                                                 with --yg Yggdrasil's log and lock drivers too

<ids> (evidence, review, set, tag, prio, merged): one id, or several as one comma list with ranges — 12,13,14 or
203-206,209. Every id and every precondition is checked before anything is written, so the call lands on
all of them or on none, with one log line per issue.

An issue number is a plain number: 7, 195, 1000. A number written with leading zeros (007) or with a # (#7) is the
same issue as 7. Questions are numbered the same way (a-7, a-1000). Numbers are compared as numbers, so 999 comes
before 1000.

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
  body: { title: 'value', where: 'value', what: 'value', why: 'value', acceptance: 'many', changelog: 'many', section: 'many' },
  import: {
    source: 'value', kind: 'value', prio: 'value', tier: 'value', tags: 'value', repo: 'value', 'found-by': 'value',
    only: 'value', adopt: 'bool', 'dry-run': 'bool', field: 'many',
  },
  sources: { source: 'value' },
  source: {},
  after: { clear: 'bool' },
  evidence: { ran: 'many', saw: 'many', retract: 'value', by: 'value' },
  list: { status: 'value', kind: 'value', tag: 'value', prio: 'value', grep: 'value', match: 'many', all: 'bool' },
  show: { full: 'bool' }, set: { branch: 'value', worker: 'value', model: 'value', worktree: 'value', header: 'bool' }, tag: {}, prio: {}, files: {},
  repo: { clear: 'bool' },
  next: { limit: 'value', all: 'bool' },
  review: { by: 'value', model: 'value', relayed: 'bool' }, round: {},
  models: { by: 'value', with: 'many', archives: 'bool' },
  check: { branch: 'value', base: 'value', repo: 'value' },
  branches: { base: 'value', repo: 'value', 'stale-hours': 'value' },
  merged: { sha: 'value', ci: 'value', repo: 'value', ran: 'many', saw: 'many', red: 'value', keep: 'bool' },
  ask: { kind: 'value', target: 'value', issue: 'value' },
  answer: { by: 'value' },
  resume: { log: 'value', ready: 'value', ci: 'bool' },
  handoff: { summary: 'value', next: 'many', log: 'value', ready: 'value', ci: 'bool' },
  log: {}, decide: { settles: 'value', by: 'value', supersedes: 'value', area: 'value', reach: 'value', rule: 'value' }, decisions: { live: 'bool' },
  status: { 'stale-hours': 'value', by: 'value', tag: 'value' }, archive: {}, report: { found: 'bool' }, tips: {}, mode: {},
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
      throw new Error(`unknown flag ${a} ${where}. A value that starts with -- goes after a bare --, e.g. evidence 7 -- "--json prints ok"`);
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
  next: [], review: ['ids', 'verdict', 'findings'], round: ['id', 'what'], models: [], check: ['id?'], branches: [],
  ask: ['question'], answer: ['id', 'answer'], resume: [], handoff: ['action?'], log: ['event'],
  decide: ['slug', 'ruling'], decisions: [], status: [], archive: ['slug'], report: [], tips: [], queue: [],
  changelog: ['ids'], mode: ['mode'], close: [], profile: ['file?'],
};
// One sentence per command: what it does, the MCP tool's whole description after "WRITES the loop." or "Read-only.".
// The rest of what a command takes and does is its block of USAGE, which the jarl_help tool and --help print.
export const COMMAND_SUMMARY = {
  init: 'Open a loop: create .jarl/ with the goal, out of git by default, committed or permanent when asked.',
  new: 'File an issue under the next free number, with its fields and its What, Why and Acceptance.',
  body: 'Set or replace an issue\'s title, its Where field and its What, Why, Acceptance, Changelog and profile sections.',
  import: 'File one issue per finding of a findings file, skipping findings already filed.',
  sources: 'Per findings report: its findings, the issues filed from them and their status.',
  source: 'Set the Source field of an issue filed by hand.',
  after: 'Set or clear the issues this one waits on before next offers it.',
  evidence: 'Append a free-text note, or checkable rows of what ran and what it printed, to issues; or retract one row by number.',
  list: 'List the issues, the unfinished ones by default, filtered by status, kind, tag, priority or a field.',
  show: 'Print one issue as the done gate sees it (its current window, rows numbered), or the whole file with --full.',
  set: 'Change the status of issues, with the reason logged, or set a field the profile declares.',
  merged: 'Record a merge (sha, repository, the check that decided it, CI state) on issues and remove their finished worktree and branch when that is safe, or move the CI state of issues already merged.',
  tag: 'Add and remove tags on issues.',
  prio: 'Set the priority of issues.',
  files: 'Declare the files an issue touches.',
  repo: 'Name the repository (or several) an issue\'s code lives in, or clear it.',
  next: 'The open issues ready to start: no file shared with work in progress, every After issue settled, no open question on them; all adds the held and waiting ones in groups.',
  review: 'Record a reviewer\'s verdict (approve or changes) on issues, with the reviewer and the findings; or retract the newest approve.',
  round: 'Record one red round on an issue; after three it prints the takeover block for a fresh worker.',
  models: 'Per model as worker and as reviewer, per kind of task: the counts, clean first passes and verdicts the record holds, with the words fits, below, new and may clear; reads other loops and archives too.',
  check: 'Measure a worker branch against its base: commits, diff inside the declared files, test changes; numbers, never a verdict.',
  branches: 'Every worker branch with its issues, commits beyond the base, worktree state, stale leases and done branches.',
  ask: 'File a question the user has to answer (stop, stuck, lower, charter or ratify).',
  answer: 'Record the user\'s answer to a question as a ruling and close the question.',
  resume: 'The boot: everything a session picks the loop up from, assembled live.',
  handoff: 'read: resume plus an old handoff file as history; write: retired, writes nothing.',
  log: 'Append one dated note to the loop\'s journal; a line that reads as a move, a verdict or another line of state is refused.',
  decide: 'Append a ruling, optionally superseding one, settling issues or covering an area of code.',
  decisions: 'The rulings with who ruled and what superseded them.',
  status: 'The goal, the counts by status, the reviews, stale leases and what awaits ratification.',
  archive: 'Put the current loop away under .jarl/archive/ so a new one can open here.',
  report: 'What was done, dropped, deferred and still open, ready for the changelog, with the loop metrics.',
  tips: 'Per repository the loop names: the tips of worker, release and main branches, ahead/behind and CI; fetches nothing.',
  queue: 'The branches waiting for the merger, in approval order, cut into batches whose files do not overlap.',
  changelog: 'Print the issues\' changelog entries grouped by section, ready to paste under [Unreleased].',
  mode: 'Switch a committed loop to the permanent mode.',
  profile: 'The loop\'s profile (statuses, fields, sections), or a profile file checked against the schema.',
  close: 'Close the loop when nothing is open or in progress, filing the ratification batch first.',
};
const ARITY = Object.fromEntries(Object.entries(COMMAND_ARGS).filter(([, a]) => !a.some((n) => n.endsWith('...'))).map(([c, a]) => [c, a.length]));

// The commands that write: each runs under .jarl/.lock (see withLock).
export const MUTATING = new Set(['init', 'new', 'body', 'import', 'source', 'after', 'set', 'merged', 'tag', 'prio', 'files', 'repo', 'evidence', 'review', 'round', 'ask', 'answer', 'log', 'decide', 'archive', 'mode', 'close']);

// git's side of the loop: the merge driver git runs, and the settings a merger passes it. Neither reads a loop.
function mergeDriverMain(args) {
  const [what, ...rest] = args;
  if (what === 'decisions' && rest.length === 3) {
    const r = runDecisionsDriver(rest[0], rest[1], rest[2]);
    for (const c of r.conflicts) console.error(`jarl: decisions.md conflict — ${c}`);
    process.exit(r.code);
  }
  if (what === 'flags' && (rest.length === 0 || (rest.length === 2 && rest[0] === '--yg'))) {
    console.log(mergeFlags({ yg: rest[1] }));
    process.exit(0);
  }
  console.error('usage: jarl.mjs merge-driver decisions <base> <ours> <theirs> | merge-driver flags [--yg "<yg command>"]');
  process.exit(1);
}

const LONG_NOTE_CHARS = 600;
const LONG_NOTE_LINES = 6;
function main() {
  if (process.argv[2] === 'merge-driver') mergeDriverMain(process.argv.slice(3));
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
  // Said on the command line only, after the note is written whole: a long free-text note is hard to read back and
  // cannot be retracted by number; nothing is refused or cut.
  if (cmd === 'evidence' && flags.ran === undefined && flags.retract === undefined && typeof rest[1] === 'string' && (rest[1].length > LONG_NOTE_CHARS || rest[1].trim().split('\n').length > LONG_NOTE_LINES)) {
    warn.push(`note: that evidence note is long (${rest[1].trim().length} characters, ${rest[1].trim().split('\n').length} lines) and was written whole; only its first line reaches the log, and a note is not a row that can be retracted by number — for proof of work, record it as --ran "<command>" --saw "<what it printed>"`);
  }
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
function renderRuleLog(r, t) {
  if (!r || !t) return '';
  if (t.state === 'written') return ` · rule ${r.rule} ratified in its own log (by ${t.by}${t.datetime ? `, ${t.datetime}` : ''})`;
  if (t.state === 'skipped') return ` · rule ${r.rule} not ratified in its own log: ${t.reason}`;
  return ` · rule ${r.rule} NOT ratified in its own log: ${t.reason}`;
}
// A loop whose profile keeps close to the record belongs to the composer that runs it: what the answer says instead of
// a write, naming the composer and its command.
function composerOf(root) {
  const profile = R.loadProfile(root);
  if (profile.lifecycle.close !== 'record') return null;
  return { state: 'skipped', reason: `this loop is run by ${profile.name}, which writes it into the graph with its own code${profile.lifecycle.command ? ` — ${profile.lifecycle.command}` : ''}` };
}
function renderTypeLog(t) {
  if (!t) return '';
  if (t.state === 'written') return ` · written into the type's decision log${t.datetime ? ` (${t.datetime})` : ''}`;
  if (t.state === 'skipped') return ` · not written into a type log: ${t.reason}`;
  return ` · NOT written into the type log: ${t.reason}`;
}

// set <ids> <status> [why] or set <ids> <field> <value>: the library decides which one the name is (see setRoute). The
// command line (and the MCP tools, which run through dispatch) always sets as caller 'cli'.
function setCommand(root, ids, name, value, flags) { return cmdSet(root, ids, name, value, { ...flags, caller: 'cli' }); }

// One command, run: its result (what --json prints), its text and the notes said on stderr. Throws on a refusal.
// Every call starts from empty caches, so a caller that runs many commands in one process (a server) sees each
// time what is on disk and in git now, exactly as a fresh process would.
export function dispatch(root, cmd, rest, flags) {
  resetCaches();
  let out;
  let text;
  let warn = [];   // said on stderr, so a caller reading stdout sees the result alone
  const each = (o, f) => [].concat(o).map(f).join('\n');
  const writes = MUTATING.has(cmd);
  {
    (writes ? (fn) => withLock(root, fn) : (fn) => fn())(() => {
    switch (cmd) {
      case 'init': out = R.initLoop(root, rest[0], { ...flags, caller: 'cli' }); text = `opened ${out.dir} · ${out.permanent ? 'permanent record, no branch' : out.committed ? 'committed with the work' : 'kept out of git'}${out.profile ? ` · profile ${out.profile}` : ''}`; warn = out.note ? [`note: ${out.note}`] : []; break;
      // The command line says caller 'cli': the notes (the tier a new issue got) are for it, never for a library caller.
      case 'new': out = R.newIssue(root, rest[0], { ...flags, caller: 'cli', width: undefined }); out = { ...out, ...describeNew(out.file) }; text = renderNewReply(out); warn = out.note ? [out.note] : []; break;
      case 'body': out = R.setBody(root, rest[0], flags); text = `${out.id} body: ${out.set.join(', ')}`; break;
      case 'source': out = R.setSource(root, rest[0], rest[1]); text = `${out.id} source: ${out.sources.join(', ')}`; break;
      case 'after': out = R.setAfter(root, rest[0], rest[1], flags); text = `${out.id} after: ${out.cleared ? 'cleared' : out.after.join(', ')}`; break;
      case 'import': out = cmdImport(root, rest[0], flags); text = renderImport(out); break;
      case 'sources': out = cmdSources(root, rest, flags); text = renderSources(out); break;
      case 'list': out = cmdList(root, flags); text = renderList(out, R.loadProfile(root)); break;
      case 'show': { const i = R.findIssue(root, rest[0]); need(i, `no such issue: ${rest[0]}`); out = { ...i, evidenceRows: evidenceTable(i.sections.evidence).rows.map(({ n, ran, saw, retracted }) => ({ n, ran, saw, retracted })) }; text = issueView(root, i, { full: Boolean(flags.full) }); break; }
      case 'set': out = setCommand(root, rest[0], rest[1], rest[2], flags); text = each(out, (o) => (o.field ? `${o.id} ${o.field}: ${o.value || '(cleared)'}` : o.header ? `header of ${o.id} rewritten from the log: ${o.status}` : `${o.id} → ${o.status}${o.branch ? ` · ${o.branch}` : ''}${o.worker ? ` · ${o.worker}` : ''}`)); warn = [].concat(out).filter((o) => o.note).map((o) => `note: ${o.id} ${o.note}`); break;
      case 'tag': out = R.setTags(root, rest[0], rest.slice(1)); text = each(out, (o) => `${o.id} tags: ${o.tags.join(', ') || '(none)'}`); break;
      case 'prio': out = R.setPriority(root, rest[0], rest[1]); text = each(out, (o) => `${o.id} priority ${o.priority}`); break;
      case 'files': out = R.setFiles(root, rest[0], rest[1]); text = `${out.id} files: ${out.files.join(', ') || '(none)'}`; break;
      case 'repo': out = R.setRepo(root, rest[0], rest[1], flags); text = `${out.id} repo: ${out.cleared ? 'cleared' : out.repo}`; break;
      case 'evidence': out = R.addEvidence(root, rest[0], rest[1], flags); text = each(out, (o) => (o.retracted ? `${o.id} evidence row ${o.retracted} retracted by ${o.by}` : o.rows ? `${o.id} evidence row${o.rows.length > 1 ? 's' : ''} recorded` : `${o.id} evidence recorded`)); break;
      case 'next': out = cmdNext(root, flags); text = out.scheduler ? out.note : renderNext(out, flags.all === true, out.length ? 0 : cmdNext(root, { all: true }).length); break;
      case 'review': out = R.review(root, rest[0], rest[1], rest[2], { ...flags, caller: 'cli' }); text = each(out, (o) => o.retracted ? `${o.id} review retracted by ${o.by} (${o.kind}): the approve ${o.retracted}` : `${o.id} review ${o.verdict}${o.by ?` by ${o.by} (${o.kind})` : ''} · acceptance: ${o.acceptance ? o.acceptance.split('\n').join(' / ') : '(none on file)'}${o.next ? ` · next: ${o.next}` : ''}`); warn = [].concat(out).filter((o) => o.note).map((o) => `note: ${o.note}`); break;
      case 'models': out = cmdModels(root, flags); text = renderModels(out); break;
      case 'round': out = R.addRound(root, rest[0], rest[1]); text = out.takeover ? `${out.id} round ${out.round} — takeover:\n\n${out.block}` : `${out.id} round ${out.round} of ${ROUNDS_BEFORE_TAKEOVER} before a takeover`; break;
      case 'merged': out = R.recordMerged(root, rest[0], { ...flags, caller: 'cli' }); text = `${out.ids.join(', ')} ${out.sha ? `merged ${out.sha}` : 'merge'}${out.check ? ` · check ${out.check}` : ''}${out.red ? ` · landed red, cause ${out.red}` : ''}${out.ci ? ` · CI ${out.ci}` : ''}${(out.cleanup || []).map((c) => `\n${c.kept ? `kept ${c.branch}${c.worktree ? ` (worktree ${c.worktree} removed)` : ''} — ${c.kept}` : `removed ${c.worktree ? `the worktree ${c.worktree} and ` : ''}the branch ${c.branch}`}${(c.commands || []).length ? `\nafter looking at the files, remove them with:\n${c.commands.map((x) => `  ${x}`).join('\n')}` : ''}${out.cleanup.some((x) => x.repo !== c.repo) ? ` [${c.repo}]` : ''}`).join('')}`; warn = out.notes.map((n) => `note: ${n}`); break;
      case 'check': out = cmdCheck(root, rest[0], flags); text = `${out.id === null ? `package ${out.ids.join(', ')} on ${out.branch}\n` : ''}${out.repo === root ? '' : `in ${out.repo}\n`}${out.items.map((i) => `${i.ok ? '✓' : '✗'} ${i.name} — ${i.note}`).join('\n')}`; break;
      case 'branches': out = cmdBranches(root, flags); text = renderBranches(out, root); break;
      case 'ask': out = R.ask(root, rest[0], { ...flags, width: undefined }); text = out.kind === 'ratify' ? `filed a-${out.id} for ratification · blocks nothing` : `asked a-${out.id}`; break;
      // The library's answer (jarl-record/1) takes no opts: --by reaches the answer through jarl-lib.mjs, under the lock held here.
      case 'answer': out = cmdAnswer(root, rest[0], rest[1], flags); break;   // text below: the type log is written outside the lock
      case 'resume': out = R.resumeData(root, flags); text = renderResume(out, R.loadProfile(root)); break;
      case 'handoff':
        need(rest[0] === undefined || rest[0] === 'read' || rest[0] === 'write', `handoff takes read or write (got "${rest[0]}") — the state is assembled live by resume`);
        if (rest[0] === 'write') { out = cmdHandoffWrite(); text = out.note; } else { out = cmdHandoffRead(root, flags); text = out.text; }
        break;
      case 'report': out = cmdReport(root, flags); text = out.text; break;
      case 'log': out = R.appendLog(root, rest[0]); text = 'logged'; break;
      case 'decide': out = R.decide(root, rest[0], rest[1], flags); text = renderDecide(out); break;
      case 'decisions': out = R.decisions(root, flags); text = renderDecisions(out); break;
      case 'status': out = R.statusData(root, flags); text = renderStatus(out, R.loadProfile(root)); break;
      case 'tips': out = cmdTips(root); text = renderTips(out); break;
      case 'queue': out = cmdQueue(root, flags); text = renderQueue(out); break;
      case 'changelog': out = cmdChangelog(root, rest[0], flags); text = out.text || '(no changelog fragment on these issues)'; warn = out.missing.length ? [`note: no changelog fragment: ${out.missing.join(', ')} — record one with: jarl.mjs body <id> --changelog "Added: …"`] : []; break;
      case 'archive': out = cmdArchive(root, rest[0], { caller: 'cli' }); text = `archived → ${out.archived}${out.leftOpen.length ? ` · ${out.leftOpen.length} still open or in progress: ${out.leftOpen.join(', ')}` : ''} · open a new loop with: jarl.mjs init "<goal>"`; break;
      case 'mode': out = cmdMode(root, rest[0]); text = 'now permanent · not tied to a feature branch; close keeps the directory'; break;
      case 'profile': out = cmdProfile(root, rest[0]); text = renderProfile(out); break;
      case 'close': out = cmdClose(root, { ...flags, caller: 'cli' }); text = out.closed ? (out.kept ? `kept ${out.kept} · closed as a permanent record` : `removed ${out.removed}${out.archiveKept ? ' (the live loop; .jarl/archive/ is left in place)' : out.archiveRemoved ? ` (with .jarl/archive/: ${out.archiveRemoved.join(', ')})` : ''}`) + (out.deferred.length ? ` · ${out.deferred.length} deferred ${out.kept ? 'still waiting' : 'removed with the loop'}: ${out.deferred.join(', ')}` : '') + (out.uncommitted ? ` · ${out.uncommitted} loop file(s) not committed${out.kept ? ' — commit .jarl/' : ' before the removal'}` : '') + renderBatch(out.batch, out.kept ? 'kept' : 'removed') : renderBatch(out.batch, 'open').trimStart(); break;
      default: throw new Error(`unknown command: ${cmd}\n${USAGE}`);
    }
    });
  }
  // A ratified area ruling goes to the type's decision log after the answer is recorded and the lock let go: the
  // probe and the write run another tool, which may take a while, and other writers of the loop must not wait on it.
  // A loop run by a composer (its profile keeps close to the record) is written into the graph by that composer, with
  // its own code and into the tree it hands over: here the answer is recorded and nothing is sent, so no entry is ever
  // written twice, nor into a checkout the composer's work never reaches.
  if (cmd === 'answer') {
    const composer = (out.typeDecision || out.ruleRatification) ? composerOf(root) : null;
    if (out.typeDecision) {
      out.typeLog = composer || writeAreaDecision(root, out.typeDecision);
      try { withLock(root, () => recordTypeLog(root, out.ruling, out.typeDecision, out.typeLog)); } catch (e) { warn.push(`note: what became of ${out.ruling} in the type log was not recorded in the loop: ${e.message}`); }
    }
    // The rule's ratification is written after the type's decision, and independently of it: either may fail alone.
    if (out.ruleRatification) {
      out.ruleLog = composer || writeRuleRatification(root, out.ruleRatification);
      try { withLock(root, () => recordRuleLog(root, out.ruling, out.ruleRatification, out.ruleLog)); } catch (e) { warn.push(`note: what became of ${out.ruling} in the rule's log was not recorded in the loop: ${e.message}`); }
    }
    text = `answered a-${out.id}${out.issue ? ` · written into ${out.issue}` : ''}${out.verdict ? ` · ${out.ruling} ${out.verdict}${renderTypeLog(out.typeLog)}${renderRuleLog(out.ruleRatification, out.ruleLog)}` : ''}`;
    if (out.typeLog?.state === 'failed') warn.push(`note: ${out.ruling} stays a ruling of this loop; write it by hand in ${out.typeLog.repo}: ${out.typeLog.retry} (add --supersedes <datetime> or --adds when yg lists decisions in force)`);
    if (out.ruleLog?.state === 'failed') warn.push(`note: rule ${out.ruleRatification.rule} is not ratified in its own log; write it by hand in ${out.ruleLog.repo}: ${out.ruleLog.retry}`);
  }
  return { out, text, warn };
}

if (isEntry(process.argv[1], fileURLToPath(import.meta.url))) main();
