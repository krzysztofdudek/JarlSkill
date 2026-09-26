#!/usr/bin/env node
// jarl.mjs — the one tool the jarl skill's state moves through.
//
// Markdown is the source of truth: .jarl/goal.md, .jarl/decisions.md, .jarl/log.md and one
// .jarl/issues/NNN-slug.md per issue. This script only reads and writes those files, so anything
// it does can be checked by opening them. Zero dependencies, Node 18+.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, realpathSync, statSync, renameSync, openSync, closeSync, writeSync, unlinkSync, linkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { join, resolve, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATUSES = ['open', 'in-progress', 'done', 'dropped', 'deferred'];
export const KINDS = ['bug', 'gap', 'cleanup', 'docs', 'test', 'research', 'process'];
export const PRIORITIES = ['1', '2', '3'];
export const TIERS = ['standard', 'strong'];
export const ASK_KINDS = ['stop', 'stuck', 'lower', 'charter', 'ratify'];
export const CI_STATES = ['pending', 'green', 'red', 'none'];
const ROUNDS_BEFORE_TAKEOVER = 3;
// A lease (Worker, Worktree, Since on an in-progress issue) whose branch saw no commit for this long is shown
// as idle; --stale-hours on status and branches changes it. It is only ever shown, never acted on.
export const STALE_HOURS = 6;
// A handoff older than the loop's last log line by more than this is read as stale.
export const HANDOFF_STALE_MS = 60 * 60_000;
// The lease fields: written by set in-progress, removed when the issue leaves in-progress. Branch stays: it
// is where the work was, which branches and check --branch still read after done.
const LEASE_FIELDS = ['Worker', 'Worktree', 'Since'];

const USAGE = `usage: jarl.mjs <command> [options]

commands:
  init "<goal>" [--committed] [--permanent]      create .jarl/ with the goal; by default it also writes .jarl/.gitignore
                                                 (* and **/*) so git never sees the loop, and every role working
                                                 outside the main checkout passes --root <main checkout>;
                                                 --committed ignores only the write lock and temporary files: the loop
                                                 is committed with the work; --permanent is committed too, marks it with
                                                 .jarl/.permanent, and is not tied to a feature branch: close (below)
                                                 keeps the directory instead of removing it
  new "<title>" [--kind k] [--prio 1|2|3] [--tier standard|strong] [--tags a,b] [--files p,q] [--repo <path>] [--found-by who]
      [--where "<w>"] [--what "<w>"] [--why "<w>"] [--acceptance "<line>"]... [--changelog "<entry>"]...
      [--source <dir>#<id>,...] [--after <ids>] [--template <name>]
                                                 file an issue under the next free number; --repo names the repository
                                                 its code lives in when that is not the loop's own, several as one comma
                                                 list (see --repo below);
                                                 --what, --why and --acceptance (one per line, repeatable) write the body,
                                                 --source names the finding(s) it comes from, --after the issues it waits on;
                                                 --changelog (repeatable) is the issue's changelog entry, "Added: …" etc.;
                                                 --template reads .jarl/templates/<name>.md: its Kind, Priority, Tier, Tags
                                                 and Files are defaults and its What, Why, Acceptance and Changelog the body,
                                                 each replaced by the flag when given
  body <id> [--where "<w>"] [--what "<w>"] [--why "<w>"] [--acceptance "<line>"]... [--changelog "<entry>"]...
                                                 set or replace the Where field and the What, Why, Acceptance and
                                                 Changelog sections
  import <findings.json> [--source <dir>] [--kind k] [--prio 1|2|3] [--tier t] [--tags a,b] [--repo <path>]
      [--found-by who] [--only <finding ids>] [--adopt] [--dry-run]
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
  list [--status s] [--kind k] [--tag t] [--prio p] [--grep re] [--all]
                                                 open and in-progress by default; --all for every status
  show <id>                                      print one issue
  set <ids> <status> "<why>" [--branch <b>] [--worker <name>] [--worktree <path>]
                                                 change status; writes the log line in the same move; in-progress
                                                 writes Since (and Branch, Worker, Worktree when given) — one lease
                                                 for every id, so a package shares it; leaving in-progress removes
                                                 Worker, Worktree and Since and keeps Branch; done notes a merge
                                                 whose CI is not green yet; done needs evidence logged since the issue
                                                 last went in progress (or was reopened, or — never in progress — was
                                                 filed) as a --ran/--saw row — a free-text note never counts alone —
                                                 and an approve not spent by a round, a restart or a reopen
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
                                                 (fresh; coordinator for jarl; self for the issue's worker — refused on
                                                 an approve); "done" needs an approve newer than the last round and reopen
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
  handoff write --summary "<s>" [--next "<n>"]... | read
                                                 the state of intent between sessions; the header records the loop's
                                                 head and the head of every repository an unfinished issue names;
                                                 read prints the summary and next as written, its age (STALE when
                                                 the loop moved on after it), what changed since, the heads that
                                                 moved, and in flight, waits, questions and ratify items read live
  log "<event>"                                  append one dated line to the journal
  decide <slug> "<ruling>" [--by who] [--supersedes <slug>] [--settles <ids>]
                                                 append a ruling (slug: letters, digits, . _ -); refuses a duplicate slug;
                                                 --by records who ruled (default owner); --supersedes marks the earlier
                                                 ruling "Superseded by" in place; --settles writes the ruling into each
                                                 named issue's evidence (its status is unchanged)
  decisions [--live]                             the rulings with who ruled and what superseded them; --live only
                                                 those still in force
  status [--stale-hours n] [--by repo|tag|kind|prio]
                                                 the goal, when the loop opened and last moved, the handoff's age,
                                                 then one line: open, in flight, waiting, done, dropped, deferred,
                                                 open questions, to ratify, merged with CI pending or red; then who
                                                 reviewed the done work (fresh, coordinator, self, unrecorded); then the
                                                 choices awaiting ratification, stale leases, the issues in flight
                                                 with no acceptance line, and — committed loops — the loop files
                                                 git has not committed; --by adds the five status counts per
                                                 repository, tag, kind or priority
  archive "<slug>"                               put the current loop away under .jarl/archive/<yyyy.mm.dd>-<slug>/,
                                                 keeping the archive, the mode markers and .jarl/templates/, so init
                                                 can open a new loop here in the same mode
  report [--found]                               what was done (per repository when it spans several), who reviewed it,
                                                 dropped, deferred and still open — ready for the changelog; --found adds
                                                 the issues found by someone other than the jarl; --json also carries
                                                 one row per issue (see SKILL.md, "Views for dashboards")
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
  close [--force]                                refuse while anything is open or in progress; else remove .jarl/
                                                 — a permanent loop (see init --permanent, or mode permanent) is
                                                 kept instead: it logs the close and the directory stays as the record

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

// ---- where -------------------------------------------------------------------------------------

// The checkout a run belongs to: the nearest directory with a `.git`. In the default mode the loop is out of
// git and lives only in the main checkout, which a worktree cannot see; so when that directory is a worktree
// (its `.git` is a file) that holds no loop of its own, and the repository's main checkout does, the main
// checkout is the root. An explicit --root never comes through here.
export function findRoot(from = process.cwd()) {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return mainCheckoutWithLoop(dir) || dir;
    const up = dirname(dir);
    if (up === dir) return resolve(from);
    dir = up;
  }
}
function mainCheckoutWithLoop(dir) {
  if (existsSync(jarlDir(dir))) return null;
  let common;
  try {
    common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch { return null; }
  const commonDir = resolve(dir, common);
  const main = basename(commonDir) === '.git' ? dirname(commonDir) : null;
  return main && main !== dir && existsSync(jarlDir(main)) ? main : null;
}
export function jarlDir(root) { return join(root, '.jarl'); }
export function issuesDir(root) { return join(jarlDir(root), 'issues'); }

function today() { return new Date().toISOString().slice(0, 10); }
function stamp() { return new Date().toISOString().replace('T', ' ').slice(0, 16); }

// ---- one writer at a time ------------------------------------------------------------------------

// Workers, reviewers and the merger all write through this tool with the same --root, often at the same
// moment. Every command that writes therefore runs under .jarl/.lock, taken with the exclusive-create flag
// so exactly one process holds it; the holder's pid, host and start time are written inside it. A lock
// whose holder is gone is broken and taken over (see lockIsStale); a caller that cannot get it within
// LOCK_WAIT_MS fails loudly, naming the holder, rather than writing without it. And every file is written
// whole to a temporary file beside it and renamed into place, so a reader that takes no lock (list, show)
// never sees half a file.
export const LOCK_STALE_MS = 30_000;          // a lock from another host, or one whose holder cannot be read
export const LOCK_REUSED_PID_MS = 10 * 60_000; // a lock on this host whose pid runs, against pid reuse
export const LOCK_EMPTY_MS = 2_000;            // a lock with nothing in it: its holder died between create and write
export const LOCK_BREAK_STALE_MS = 5_000;      // a breaker's own lock (below), left by a breaker that died
export const LOCK_WAIT_MS = Number(process.env.JARL_LOCK_WAIT_MS) || 20_000;   // the variable is a test knob
const SLEEPER = new Int32Array(new SharedArrayBuffer(4));
function sleep(ms) { Atomics.wait(SLEEPER, 0, 0, ms); }
function lockPath(root) { return join(jarlDir(root), '.lock'); }
let held = 0;   // re-entrant within one process: a command that calls another write takes the lock once

// Stale: empty and older than LOCK_EMPTY_MS; on this host, a holder whose pid no longer runs (or, against pid
// reuse, one older than LOCK_REUSED_PID_MS); from another host (a shared checkout) or with an unreadable
// holder, one older than LOCK_STALE_MS.
function lockIsStale(text, mtimeMs) {
  const age = Date.now() - mtimeMs;
  if (!text.trim()) return age > LOCK_EMPTY_MS;
  const [pid, host] = text.split('\n')[0].split(' ');
  if (host === hostname() && Number(pid) > 0) {
    try { process.kill(Number(pid), 0); } catch (e) { if (e.code === 'ESRCH') return true; }
    return age > LOCK_REUSED_PID_MS;
  }
  return age > LOCK_STALE_MS;
}

// Breaking a stale lock is itself serialized, behind .jarl/.lock.break (exclusive create): only its holder
// may remove .lock, and only when .lock still holds exactly the content judged stale. A live lock is never
// moved or renamed, so a fresh holder that took the lock meanwhile keeps it. A breaker that died leaves
// .lock.break behind; it is removed once older than LOCK_BREAK_STALE_MS (breaking takes milliseconds).
function breakStaleLock(root, stale) {
  const brk = join(jarlDir(root), '.lock.break');
  const mine = `${process.pid} ${hostname()} ${new Date().toISOString()}\n`;
  try {
    const fd = openSync(brk, 'wx');
    try { writeSync(fd, mine); } finally { closeSync(fd); }
  } catch (e) {
    if (e.code !== 'EEXIST') return;
    try { if (Date.now() - statSync(brk).mtimeMs > LOCK_BREAK_STALE_MS) unlinkSync(brk); } catch { /* gone */ }
    return;
  }
  try {
    let now = null;
    try { now = readFileSync(lockPath(root), 'utf8'); } catch { /* released meanwhile */ }
    if (now === stale) unlinkSync(lockPath(root));
  } catch { /* released meanwhile */ } finally {
    try { if (readFileSync(brk, 'utf8') === mine) unlinkSync(brk); } catch { /* gone */ }
  }
}

export function withLock(root, fn) {
  // Before init there is no .jarl/ to guard and nothing in it to lose: init runs unguarded.
  if (held > 0 || !existsSync(jarlDir(root))) return fn();
  const path = lockPath(root);
  const mine = `${process.pid} ${hostname()} ${new Date().toISOString()}\n`;
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = openSync(path, 'wx');
      try { writeSync(fd, mine); } finally { closeSync(fd); }
      break;
    } catch (e) {
      if (e.code === 'ENOENT') throw new Error(`no .jarl/ here any more — the loop was closed or archived while this command waited (${jarlDir(root)})`);
      if (e.code !== 'EEXIST') throw e;
    }
    let text = ''; let mtimeMs = Date.now();
    try { text = readFileSync(path, 'utf8'); mtimeMs = statSync(path).mtimeMs; } catch { continue; }   // released meanwhile
    if (lockIsStale(text, mtimeMs)) { breakStaleLock(root, text); sleep(1 + Math.floor(Math.random() * 5)); continue; }
    if (Date.now() > until) throw new Error(`.jarl/.lock is held by another jarl.mjs (${text.trim() || 'holder unknown'}) — nothing was written; retry, or remove ${path} if that process is gone`);
    sleep(10 + Math.floor(Math.random() * 40));
  }
  held += 1;
  try {
    const out = fn();
    // A committed loop from before the narrow ignore file existed gets it here: under the lock, and only
    // after a command that wrote (a refused one writes nothing). close may have removed .jarl/ meanwhile.
    const ignore = join(jarlDir(root), '.gitignore');
    if (existsSync(jarlDir(root)) && !existsSync(ignore)) writeAtomic(ignore, JARL_GITIGNORE_COMMITTED);
    return out;
  } finally {
    held -= 1;
    // Release only a lock that is still this one: close removes .jarl/ with it, and a lock broken as stale
    // may already belong to someone else.
    try { if (readFileSync(path, 'utf8') === mine) unlinkSync(path); } catch { /* removed with .jarl/ */ }
  }
}

// Written whole beside the target, then renamed over it: a reader sees the old file or the new one.
export function writeAtomic(path, text) {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}
function appendAtomic(path, header, text) {
  writeAtomic(path, (existsSync(path) ? readFileSync(path, 'utf8') : header) + text);
}

// ---- issues ------------------------------------------------------------------------------------

// Letters Unicode does not decompose into a base letter and an accent (ł, ø, đ, ß, æ, þ...) would be
// dropped as punctuation and leave a hole in the name ("gałęzi" -> "ga-ezi"), so they are spelled out first.
const UNDECOMPOSED = {
  'ł': 'l', 'ø': 'o', 'đ': 'd', 'ð': 'd', 'ħ': 'h', 'ı': 'i', 'ŧ': 't', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'þ': 'th',
};
export function slugify(title) {
  return title.toLowerCase().replace(/[łøđðħıŧßæœþ]/g, (c) => UNDECOMPOSED[c]).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'issue';
}

const FIELD_RE = /^\*\*([A-Za-z ]+):\*\*\s*(.*)$/;

export function parseIssue(text, file) {
  const lines = text.split('\n');
  const head = /^#\s+(\d{3})\s+·\s+(.*)$/.exec(lines[0] || '');
  const issue = { file, id: head ? head[1] : null, title: head ? head[2].trim() : '', fields: {}, sections: {} };
  let section = null;
  for (const line of lines.slice(1)) {
    const f = FIELD_RE.exec(line);
    if (f && section === null) { issue.fields[f[1].toLowerCase()] = f[2].trim(); continue; }
    const h = /^##\s+(.*)$/.exec(line);
    if (h) { section = h[1].trim().toLowerCase(); issue.sections[section] = ''; continue; }
    if (section !== null) issue.sections[section] += line + '\n';
  }
  issue.status = issue.fields.status || 'open';
  issue.kind = issue.fields.kind || '';
  issue.priority = issue.fields.priority || '2';
  issue.tier = issue.fields.tier || 'standard';
  issue.tags = (issue.fields.tags || '').split(',').map((s) => s.trim()).filter(Boolean);
  issue.files = (issue.fields.files || '').split(',').map((s) => s.trim()).filter(Boolean);
  // Both fields are newer than most loops: an issue without them reads as waiting on nothing and filed from no finding.
  issue.after = splitList(issue.fields.after).map((x) => x.replace(/^#/, '').padStart(3, '0'));
  issue.sources = splitList(issue.fields.source);
  return issue;
}

export function loadIssues(root) {
  const dir = issuesDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^\d{3}-.*\.md$/.test(f)).sort()
    .map((f) => parseIssue(readFileSync(join(dir, f), 'utf8'), join(dir, f)));
}

export function findIssue(root, rawId) {
  const id = String(rawId).replace(/^#/, '').padStart(3, '0');
  return loadIssues(root).find((i) => i.id === id) || null;
}

function setField(text, name, value) {
  // Only the header holds fields: a line in a section body that looks like one (a pasted finding) is text.
  const lines = text.split('\n');
  let last = 0;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) break;
    const f = FIELD_RE.exec(lines[i]);
    if (!f) continue;
    if (f[1] === name) { lines[i] = `**${name}:** ${value}`; return lines.join('\n'); }
    last = i;
  }
  // insert after the last field line of the header
  lines.splice(last + 1, 0, `**${name}:** ${value}`);
  return lines.join('\n');
}

// Remove header fields (only the header: a section line that looks like a field is text). A field that is
// not there is left alone.
function removeFields(text, names) {
  const lines = text.split('\n');
  const out = [lines[0]];
  let inHeader = true;
  for (const line of lines.slice(1)) {
    if (line.startsWith('## ')) inHeader = false;
    const f = inHeader ? FIELD_RE.exec(line) : null;
    if (f && names.includes(f[1])) continue;
    out.push(line);
  }
  return out.join('\n');
}

function setSection(text, name, body) {
  const re = new RegExp(`(^##\\s+${name}\\s*$\\n)([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'mi');
  // A function replacer: user text is inserted as it is, never read for $1, $& or $' patterns.
  if (re.test(text)) return text.replace(re, (_, head) => `${head}${body.trim()}\n\n`);
  // A new section other than Evidence goes before Evidence, which stays last: the record of the work.
  const evidence = /^## Evidence\s*$/m.exec(text);
  if (name !== 'Evidence' && evidence) return `${text.slice(0, evidence.index)}## ${name}\n${body.trim()}\n\n${text.slice(evidence.index)}`;
  return `${text.replace(/\s*$/, '')}\n\n## ${name}\n${body.trim()}\n`;
}

// A body written into a section must not open a section of its own: a line starting with ## would end it
// early and the rest would land under a heading nobody reads. Such a line is escaped (\##), which renders
// the same and parses as text.
export function bodyText(v) {
  return String(v ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/^(\s*)(#+)(?=\s|$)/, (_, sp, h) => `${sp}\\${h}`)).join('\n').trim();
}
// A header field is one line.
function fieldText(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
// --acceptance repeats, one checkable line each; several become a list.
export function acceptanceText(v) {
  const lines = [].concat(v ?? []).map(bodyText).filter(Boolean);
  return lines.length > 1 ? lines.map((l) => `- ${l}`).join('\n') : (lines[0] || '');
}

// --changelog repeats, one entry each: the line the repository's changelog gets for this issue, optionally opened by
// its Keep a Changelog section (`Added: …`). An entry is one line, like a changelog bullet; several become a list.
export const CHANGELOG_SECTIONS = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];
export function changelogText(v) {
  const lines = [].concat(v ?? []).map(fieldText).filter(Boolean).map((l) => l.replace(/^-\s+/, ''));
  // A section with nothing after it would print an empty bullet under that heading: refused, not guessed at.
  for (const l of lines) need(!new RegExp(`^(${CHANGELOG_SECTIONS.join('|')}):\\s*$`, 'i').test(l), `changelog entry "${l}" has no text — write the line after the section: --changelog "${l.replace(/:\s*$/, '')}: <what changed>"`);
  return lines.map((l) => `- ${l}`).join('\n');
}
// The entries of an issue's ## Changelog section, each with its section: the one it opens with, else Fixed for a bug
// and Changed for anything else.
export function changelogEntries(issue) {
  const fallback = issue.kind === 'bug' ? 'Fixed' : 'Changed';
  return (issue.sections.changelog || '').split('\n').map((l) => l.trim().replace(/^-\s+/, '')).filter(Boolean).map((l) => {
    const m = new RegExp(`^(${CHANGELOG_SECTIONS.join('|')}):\\s*(.*)$`, 'i').exec(l);
    return m && m[2] ? { section: CHANGELOG_SECTIONS.find((x) => x.toLowerCase() === m[1].toLowerCase()), text: m[2] } : { section: fallback, text: l };
  });
}

export function renderIssue({ id, title, kind, priority, tier, tags, files, repo, foundBy, where = '', what = '', why = '', acceptance = '', source = [], after = [], changelog = '' }) {
  const body = (t) => (t ? `${t}\n` : '\n');
  return `# ${id} · ${fieldText(title)}

**Status:** open
**Kind:** ${kind}
**Priority:** ${priority}
**Tier:** ${tier}
**Tags:** ${tags.join(', ')}
**Files:** ${files.join(', ')}
${repo ? `**Repo:** ${repo}\n` : ''}${after.length ? `**After:** ${after.join(', ')}\n` : ''}**Found by:** ${fieldText(foundBy)}
${source.length ? `**Source:** ${source.join(', ')}\n` : ''}**Where:**${where ? ` ${fieldText(where)}` : ''}

## What
${body(what)}
## Why
${body(why)}
## Acceptance
${body(acceptance)}
${changelog ? `## Changelog\n${changelog}\n\n` : ''}## Evidence

`;
}

// ---- journal and decisions ----------------------------------------------------------------------

export function appendLog(root, event) {
  appendLogLines(root, [event]);
}
// Several lines in one write: a bulk command's lines land together or not at all.
export function appendLogLines(root, events) {
  const at = stamp();
  appendAtomic(join(jarlDir(root), 'log.md'), '# Log\n\n', events.map((e) => `- ${at} · ${e}\n`).join(''));
}

// A ruling's slug names it for good: letters, digits, and . _ - inside, at most 80 characters. It is compared
// as a string, never read as a pattern, so `q.r` and `qxr` are two slugs and a slug with any character in it
// cannot break the reading.
export const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const DECISION_HEAD = /^## (\d{4}-\d{2}-\d{2}) · (.+?)\s*$/;

// decisions.md read back: one entry per `## <date> · <slug>` heading, with its ruling, who ruled (**By:**, none
// on rulings from before the field), what it supersedes and what superseded it.
export function loadDecisions(root) {
  const path = join(jarlDir(root), 'decisions.md');
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const h = DECISION_HEAD.exec(line);
    if (h) { out.push({ date: h[1], slug: h[2], body: [] }); continue; }
    if (out.length) out[out.length - 1].body.push(line);
  }
  // A ruling's own fields (By, Supersedes, Superseded by, Settles) are the block the tool writes at the end of its
  // section — the trailing lines that are such a field or blank. A line of the ruling's text that happens to start
  // with **By:** is text.
  const META = /^\*\*(By|Supersedes|Superseded by|Settles):\*\*\s*(.*)$/;
  return out.map((d) => {
    let cut = d.body.length;
    while (cut > 0 && (d.body[cut - 1].trim() === '' || META.test(d.body[cut - 1]))) cut -= 1;
    const meta = d.body.slice(cut).map((l) => META.exec(l)).filter(Boolean);
    const field = (name) => meta.filter((m) => m[1] === name).map((m) => m[2].trim());
    const ruling = d.body.slice(0, cut).join('\n').trim();
    const sup = field('Superseded by').pop();
    return { date: d.date, slug: d.slug, ruling, by: field('By').pop() || null, supersedes: field('Supersedes').pop() || null, supersededBy: sup ? sup.split(/\s/)[0] : null, settles: splitList(field('Settles').pop()) };
  });
}

export function appendDecision(root, slug, ruling, { by, supersedes } = {}) {
  need(typeof slug === 'string' && SLUG_RE.test(slug), `a ruling's slug is letters, digits and . _ - (starting with a letter or digit, at most 80 characters) — not "${slug}"; e.g. ${slugify(String(slug || 'ruling'))}`);
  const path = join(jarlDir(root), 'decisions.md');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '# Decisions\n';
  const all = loadDecisions(root);
  need(!all.some((d) => d.slug === slug), `duplicate slug: ${slug} — a ruling that replaces it takes a new slug and --supersedes ${slug}`);
  let text = existing;
  if (supersedes !== undefined) {
    need(typeof supersedes === 'string' && supersedes !== slug, '--supersedes names the slug of an earlier ruling');
    const old = all.find((d) => d.slug === supersedes);
    need(old, `no ruling ${supersedes} in decisions.md to supersede`);
    need(!old.supersededBy, `${supersedes} is already superseded by ${old.supersededBy} — supersede that one instead`);
    // The mark goes at the end of the old ruling's own section, by lines: the text is never read as a pattern.
    const lines = text.split('\n');
    const at = lines.findIndex((l) => { const h = DECISION_HEAD.exec(l); return h && h[2] === supersedes; });
    let end = lines.findIndex((l, n) => n > at && l.startsWith('## '));
    if (end === -1) end = lines.length;
    while (end - 1 > at && lines[end - 1].trim() === '') end -= 1;
    lines.splice(end, 0, `**Superseded by:** ${slug} (${today()})`);
    text = lines.join('\n');
  }
  const meta = [by ? `**By:** ${fieldText(by)}` : null, supersedes !== undefined ? `**Supersedes:** ${supersedes}` : null].filter(Boolean).join('\n');
  writeAtomic(path, `${text.replace(/\s*$/, '')}\n\n## ${today()} · ${slug}\n${bodyText(ruling)}\n${meta ? `\n${meta}\n` : ''}`);
}

// ---- commands ----------------------------------------------------------------------------------

function need(cond, msg) { if (!cond) throw new Error(msg); }

// By default the loop stays out of git: .jarl/.gitignore ignores everything under .jarl/, itself
// included, so the loop never shows in the branch's history, diffs or merges. --committed writes the
// narrow ignore file below instead and the loop is committed with the work. --permanent is committed the
// same way — a permanent record must be committed to survive — and additionally writes .jarl/.permanent, so a
// later session can tell the mode from the loop itself without being told: close (below) reads that
// marker and keeps the directory instead of removing it. Only init decides any of this, so a loop opened
// before a mode existed keeps behaving as it did.
//
// A committed or permanent loop still gets a narrow .jarl/.gitignore: it ignores only the lock and the
// temporary files a write leaves for a moment (see withLock), so a `git add .jarl` made while a call runs
// never commits them. init writes it; a committed loop opened before it existed is given it by its first
// write under the lock. The mode is read from what the file ignores, not from whether it exists: only the
// default mode's file ignores everything (a line `*`).
export const JARL_GITIGNORE = '*\n**/*\n';
export const JARL_GITIGNORE_COMMITTED = '# jarl: the loop is committed; only the write lock and half-written temporary files stay out of git\n/.lock\n/.lock.break\n.*.tmp\n';
export function outOfGit(root) {
  const path = join(jarlDir(root), '.gitignore');
  return existsSync(path) && readFileSync(path, 'utf8').split('\n').some((l) => l.trim() === '*');
}
export const PERMANENT_MARKER = 'This loop is a permanent record: it is not tied to a feature branch, and `close` never removes this directory. See SKILL.md.\n';

export function cmdInit(root, goal, flags = {}) {
  need(flags.committed === undefined || flags.committed === true, '--committed takes no value — put the goal first: init "<goal>" --committed');
  need(flags.permanent === undefined || flags.permanent === true, '--permanent takes no value — put the goal first: init "<goal>" --permanent');
  need(goal, 'init requires "<goal>"');
  need(!hasLiveLoop(root), '.jarl/ already exists here with a live loop — resume it, or archive it first: jarl.mjs archive "<slug>"');
  // A .jarl/ left behind by `archive` holds only archive/ and the mode markers, and the new loop
  // keeps that mode: the markers are the loop's own record of how it lives in git.
  const archived = existsSync(jarlDir(root));
  let permanent = flags.permanent === true;
  let committed = flags.committed === true || permanent;
  if (archived) {
    const kept = existsSync(join(jarlDir(root), '.permanent')) ? 'permanent' : outOfGit(root) ? 'default' : 'committed';
    const asked = permanent ? 'permanent' : committed ? 'committed' : null;
    need(asked === null || asked === kept, `this .jarl/ keeps its archived loops in the ${kept} mode, and a new loop here keeps that mode — run init without --${asked}`);
    permanent = kept === 'permanent';
    committed = kept !== 'default';
  }
  mkdirSync(issuesDir(root), { recursive: true });
  if (!archived) writeAtomic(join(jarlDir(root), '.gitignore'), committed ? JARL_GITIGNORE_COMMITTED : JARL_GITIGNORE);
  if (!archived && permanent) writeAtomic(join(jarlDir(root), '.permanent'), PERMANENT_MARKER);
  writeAtomic(join(jarlDir(root), 'goal.md'), `# Goal\n\n${goal.trim()}\n\n## Assumptions\n\n## Rules that apply here\n`);
  writeAtomic(join(jarlDir(root), 'decisions.md'), '# Decisions\n');
  writeAtomic(join(jarlDir(root), 'log.md'), '# Log\n\n');
  appendLog(root, `opened · ${goal.trim()}`);
  return { dir: jarlDir(root), committed, permanent };
}

// A live loop is one with a goal; a .jarl/ holding only archive/ and the mode markers has none.
export function hasLiveLoop(root) {
  return existsSync(join(jarlDir(root), 'goal.md'));
}

// The refusal for a command that needs a live loop: no .jarl/ at all, or one holding only archives.
function needLiveLoop(root, next) {
  need(existsSync(jarlDir(root)), `no .jarl/ here${next}`);
  need(hasLiveLoop(root), `no live loop here — .jarl/ holds only archived loops${next}`);
}

// What stays in .jarl/ when a loop is archived: the archive itself, the markers that say how the loop lives in
// git, so the next loop opened here keeps the same mode, and the issue templates, which belong to the place, not
// to one loop.
const ARCHIVE_KEEPS = new Set(['archive', 'templates', '.gitignore', '.permanent', '.lock', '.lock.break']);

// archive "<slug>" — put the current loop away under .jarl/archive/<yyyy.mm.dd>-<slug>/ so a new one
// can be opened here with init. Everything but the archive and the mode markers moves: issues, goal,
// decisions, log, handoff. Open work is not a refusal (archiving is how a session sets old work
// aside), but the result names it, and the loop's own log records the move before it goes.
export function cmdArchive(root, slug) {
  need(slug, 'archive requires "<slug>" — a short name for the loop being put away');
  need(hasLiveLoop(root), existsSync(jarlDir(root)) ? 'no loop to archive here — .jarl/ holds only earlier archives; open one with: jarl.mjs init "<goal>"' : 'no .jarl/ here');
  const name = `${today().replace(/-/g, '.')}-${slugify(slug)}`;
  const dest = join(jarlDir(root), 'archive', name);
  need(!existsSync(dest), `.jarl/archive/${name} already exists — pick another slug`);
  const left = loadIssues(root).filter((i) => i.status === 'open' || i.status === 'in-progress').map((i) => i.id);
  appendLog(root, `archived → .jarl/archive/${name}${left.length ? ` · ${left.length} still open or in progress: ${left.join(', ')}` : ''}`);
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(jarlDir(root))) {
    if (ARCHIVE_KEEPS.has(entry)) continue;
    renameSync(join(jarlDir(root), entry), join(dest, entry));
  }
  return { archived: dest, leftOpen: left };
}

// Put a written temporary file in place under a name that must not exist yet: a hard link never overwrites,
// so it is the claim. On a file system without hard links, an exclusive create and a copy of the content
// do the same (the lock already keeps other writers out; readers may see the file an instant before it
// is complete). False when the name is taken.
const NO_LINKS = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV']);
export function claimFile(tmp, file, link = linkSync) {
  try { link(tmp, file); return true; } catch (e) {
    if (e.code === 'EEXIST') return false;
    if (!NO_LINKS.has(e.code)) throw e;
  }
  let fd;
  try { fd = openSync(file, 'wx'); } catch (e) { if (e.code === 'EEXIST') return false; throw e; }
  try { writeSync(fd, readFileSync(tmp)); } finally { closeSync(fd); }
  return true;
}

// A template is .jarl/templates/<name>.md: an issue file without a number — header fields (Kind, Priority, Tier, Tags,
// Files) as defaults and What, Why, Acceptance and Changelog sections as the body. A flag given on the call wins over
// the template, field by field and section by section. Templates are the loop's own and outlive it: archive keeps them.
export const TEMPLATE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export function templatesDir(root) { return join(jarlDir(root), 'templates'); }
export function readTemplate(root, name) {
  need(typeof name === 'string' && TEMPLATE_RE.test(name), `a template is named by letters, digits and . _ - (the file .jarl/templates/<name>.md) — not "${name}"`);
  const path = join(templatesDir(root), `${name}.md`);
  if (!existsSync(path)) {
    const have = existsSync(templatesDir(root)) ? readdirSync(templatesDir(root)).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)) : [];
    throw new Error(`no template ${name} in ${templatesDir(root)} — ${have.length ? `templates here: ${have.join(', ')}` : 'none here yet; write one as an issue file without a number (see SKILL.md, "Templates")'}`);
  }
  // The template is read as an issue whose title line may be anything: only its fields and sections count. A template
  // that starts straight with a field has no title line, so that first field is read as a field, not dropped.
  const raw = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
  const t = parseIssue(FIELD_RE.test(raw.split('\n')[0]) ? `# template\n${raw}` : raw, path);
  const section = (k) => (t.sections[k] !== undefined && t.sections[k].trim() ? t.sections[k].trim() : undefined);
  return {
    kind: t.fields.kind || undefined, prio: t.fields.priority || undefined, tier: t.fields.tier || undefined,
    tags: t.fields.tags || undefined, files: t.fields.files || undefined,
    what: section('what'), why: section('why'), acceptance: section('acceptance'), changelog: section('changelog'),
  };
}

export function cmdNew(root, title, rawFlags) {
  need(title, 'new requires "<title>"');
  needLiveLoop(root, ' — run: jarl.mjs init "<goal>"');
  let flags = rawFlags;
  let fromTemplate = {};
  if (rawFlags.template !== undefined) {
    const t = readTemplate(root, rawFlags.template);
    fromTemplate = t;
    flags = { ...rawFlags };
    for (const k of ['kind', 'prio', 'tier', 'tags', 'files', 'what', 'why']) if (flags[k] === undefined && t[k] !== undefined) flags[k] = t[k];
  }
  const kind = flags.kind || 'bug';
  need(KINDS.includes(kind), `--kind must be one of: ${KINDS.join(', ')}`);
  const priority = String(flags.prio || '2');
  need(PRIORITIES.includes(priority), '--prio must be 1, 2 or 3');
  const tier = String(flags.tier || 'standard');
  need(TIERS.includes(tier), `--tier must be one of: ${TIERS.join(', ')} — the tier of model the worker is raised on, mapped to a model by the platform running the loop`);
  const repos = flags.repo !== undefined ? repoList(root, flags.repo) : [];
  const source = sourceList(flags.source);
  const after = flags.after !== undefined ? afterList(root, null, flags.after) : [];
  // The number is claimed by creating the file with a link, which never overwrites: when another
  // writer got there first (the lock makes that rare, not impossible — a hand-made file, a stale
  // lock broken early), the next number is tried instead of two issues sharing one.
  const dir = issuesDir(root);
  const taken = () => readdirSync(dir).map((f) => /^(\d{3,})-.*\.md$/.exec(f)).filter(Boolean).map((m) => Number(m[1]));
  let n = taken().reduce((m, x) => Math.max(m, x), 0) + 1;
  for (let tries = 0; ; tries += 1) {
    const id = String(n).padStart(3, '0');
    const file = join(dir, `${id}-${slugify(title)}.md`);
    const tmp = join(dir, `.${id}.${process.pid}.tmp`);
    writeFileSync(tmp, renderIssue({
      id, title, kind, priority, tier,
      tags: splitList(flags.tags), files: splitList(flags.files), repo: repos.join(', '), foundBy: flags['found-by'] || 'jarl',
      where: flags.where, what: bodyText(flags.what), why: bodyText(flags.why), source, after,
      // A template's Acceptance and Changelog are taken as written (a list already); a flag replaces them.
      acceptance: flags.acceptance !== undefined ? acceptanceText(flags.acceptance) : bodyText(fromTemplate.acceptance),
      changelog: flags.changelog !== undefined ? changelogText(flags.changelog) : bodyText(fromTemplate.changelog),
    }));
    let claimed = !taken().includes(n);
    if (claimed) { try { claimed = claimFile(tmp, file); } catch (e) { unlinkSync(tmp); throw e; } }
    unlinkSync(tmp);
    if (claimed) { appendLog(root, `filed ${id} · ${title}${rawFlags.template !== undefined ? ` · template ${rawFlags.template}` : ''}`); return { id, file, ...(rawFlags.template !== undefined ? { template: rawFlags.template } : {}) }; }
    need(tries < 100, 'could not claim a free issue number after 100 tries');
    n = Math.max(n + 1, taken().reduce((m, x) => Math.max(m, x), 0) + 1);
  }
}

function splitList(v) { return String(v || '').split(',').map((s) => s.trim()).filter(Boolean); }

// A Source entry names one finding for good: the report's directory (dated, so unique) and the finding's id
// inside it, <dir>#<id>. Several are one comma list.
export function sourceList(v) {
  const list = splitList(v);
  for (const s of list) need(/^[^#\s]+#[^#\s]+$/.test(s), `a source is <report dir>#<finding id>, e.g. core/research/2026-09-25-jarl#jarl-2-B2 — not "${s}"`);
  return list;
}

// The issues one waits on: each must exist and not be the issue itself, and the chain must not come back to
// it — a cycle would leave every issue in it waiting for good with nothing to say so.
function afterList(root, selfId, raw) {
  const ids = expandIds(raw);
  const all = loadIssues(root);
  const missing = ids.filter((id) => !all.some((i) => i.id === id));
  need(missing.length === 0, `no such issue: ${missing.join(', ')}`);
  need(!selfId || !ids.includes(selfId), `${selfId} cannot wait on itself`);
  if (selfId) {
    const byId = new Map(all.map((i) => [i.id, i]));
    const seen = new Set();
    const stack = [...ids];
    while (stack.length) {
      const id = stack.pop();
      need(id !== selfId, `${selfId} after ${ids.join(', ')} would close a cycle: that chain of After already leads back to ${selfId}, so none of them would ever be offered`);
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(byId.get(id)?.after || []));
    }
  }
  return ids;
}

// The After issues not yet settled: done and dropped settle; open, in progress and deferred do not.
// An After id with no issue behind it (removed by hand) holds nothing back.
export function waitingOn(issue, byId) {
  return issue.after.filter((id) => byId.has(id) && !['done', 'dropped'].includes(byId.get(id).status));
}

// body <id> — the Where field and the What, Why and Acceptance sections, set or replaced. Evidence is never
// written here: it is the record of what was done, appended by evidence, never replaced.
export function cmdBody(root, rawId, flags) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  const parts = ['where', 'what', 'why', 'acceptance', 'changelog'].filter((k) => flags[k] !== undefined);
  need(parts.length, 'body needs at least one of --where, --what, --why, --acceptance, --changelog');
  let text = readFileSync(issue.file, 'utf8');
  if (flags.where !== undefined) text = setField(text, 'Where', fieldText(flags.where));
  if (flags.what !== undefined) text = setSection(text, 'What', bodyText(flags.what));
  if (flags.why !== undefined) text = setSection(text, 'Why', bodyText(flags.why));
  if (flags.acceptance !== undefined) text = setSection(text, 'Acceptance', acceptanceText(flags.acceptance));
  if (flags.changelog !== undefined) text = setSection(text, 'Changelog', changelogText(flags.changelog));
  writeAtomic(issue.file, text);
  appendLog(root, `${issue.id} body · ${parts.join(', ')}`);
  return { id: issue.id, set: parts };
}

export function cmdSource(root, rawId, list) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  const sources = sourceList(list);
  need(sources.length, 'source requires <report dir>#<finding id>[,...]');
  writeAtomic(issue.file, setField(readFileSync(issue.file, 'utf8'), 'Source', sources.join(', ')));
  appendLog(root, `${issue.id} source · ${sources.join(', ')}`);
  return { id: issue.id, sources };
}

export function cmdAfter(root, rawId, raw, { clear = false } = {}) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  if (clear) {
    need(raw === undefined, 'after takes either <ids> or --clear, not both');
    need(issue.fields.after !== undefined, `${issue.id} has no After field to clear`);
    writeAtomic(issue.file, readFileSync(issue.file, 'utf8').replace(/^\*\*After:\*\*.*\n/m, ''));
    appendLog(root, `${issue.id} after · cleared`);
    return { id: issue.id, after: [], cleared: true };
  }
  need(raw !== undefined, 'after requires <ids> — the issues this one waits on (or --clear)');
  const ids = afterList(root, issue.id, raw);
  writeAtomic(issue.file, setField(readFileSync(issue.file, 'utf8'), 'After', ids.join(', ')));
  appendLog(root, `${issue.id} after ${ids.join(', ')}`);
  return { id: issue.id, after: ids };
}

export function cmdList(root, flags) {
  let rows = loadIssues(root);
  // Deferred work waits, so the default list does not show it: --status deferred or --all does.
  if (!flags.all && !flags.status) rows = rows.filter((i) => i.status === 'open' || i.status === 'in-progress');
  if (flags.status) rows = rows.filter((i) => i.status === flags.status);
  if (flags.kind) rows = rows.filter((i) => i.kind === flags.kind);
  if (flags.tag) rows = rows.filter((i) => i.tags.includes(flags.tag));
  if (flags.prio) rows = rows.filter((i) => i.priority === String(flags.prio));
  if (flags.grep) {
    const re = new RegExp(flags.grep, 'i');
    rows = rows.filter((i) => re.test(readFileSync(i.file, 'utf8')));
  }
  return rows.sort((a, b) => a.priority.localeCompare(b.priority) || a.id.localeCompare(b.id));
}

// Bulk ids: evidence, review, set, tag and prio take one id or several — a comma list with ranges,
// `12,13,14` or `203-206,209` (no spaces: one argument, like --tags a,b). Every id is resolved and every
// precondition checked before anything is written, so a call either lands on all of them or on none;
// each issue still gets its own log line.
const MAX_BULK = 200;
export function expandIds(raw) {
  need(raw !== undefined && String(raw).trim() !== '', 'an issue id is required — one id, or several as a comma list with ranges: 12,13 or 203-206,209');
  const out = [];
  for (const part of String(raw).split(',').map((p) => p.trim().replace(/^#/, ''))) {
    const range = /^(\d+)-#?(\d+)$/.exec(part);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      need(a <= b, `range ${part} runs backwards — write it low-high`);
      need(b - a < MAX_BULK, `range ${part} spans more than ${MAX_BULK} issues`);
      for (let n = a; n <= b; n += 1) out.push(String(n).padStart(3, '0'));
    } else {
      need(/^\d+$/.test(part), `not an issue id: "${part}" — ids are numbers, several as a comma list with ranges: 12,13 or 203-206,209`);
      out.push(part.padStart(3, '0'));
    }
  }
  return [...new Set(out)];
}
function isBulk(raw) { return /[,-]/.test(String(raw ?? '')); }
function issuesFor(root, rawIds) {
  const ids = expandIds(rawIds);
  const all = loadIssues(root);
  const missing = ids.filter((id) => !all.some((i) => i.id === id));
  need(missing.length === 0, `no such issue: ${missing.join(', ')}${ids.length > 1 ? ' — nothing was written' : ''}`);
  return ids.map((id) => all.find((i) => i.id === id));
}
// One id in, the same object as always out; a list in, an array of them.
function oneOrMany(rawIds, results) { return isBulk(rawIds) ? results : results[0]; }

export function cmdSet(root, rawIds, status, why, flags = {}) {
  need(STATUSES.includes(status), `status must be one of: ${STATUSES.join(', ')}`);
  const lease = ['branch', 'worker', 'worktree'].filter((k) => flags[k] !== undefined);
  need(!lease.length || status === 'in-progress', `--${lease[0]} goes with in-progress only — it records who works on the issue and where`);
  for (const k of lease) need(typeof flags[k] === 'string' && fieldText(flags[k]), `--${k} needs a value`);
  const issues = issuesFor(root, rawIds);
  need(status !== 'dropped' || why, 'dropped needs a reason: jarl.mjs set <id> dropped "<why>"');
  need(status !== 'deferred' || why, 'deferred needs a reason: jarl.mjs set <id> deferred "<why>" — work that waits, not work that is gone');
  const nothing = issues.length > 1 ? ' — nothing was written' : '';
  if (status === 'done') {
    const journal = journalById(root);
    for (const issue of issues) need(!doneRefusal(root, issue, journal), `${doneRefusal(root, issue, journal)}${nothing}`);
  }
  // One lease for the whole call: every issue in a package gets the same Branch, Worker, Worktree and Since.
  // A relative worktree path is read from the loop's root, like --repo, so it means the same from anywhere.
  const since = stamp();
  const worktree = flags.worktree !== undefined ? resolve(root, fieldText(flags.worktree)) : undefined;
  const writes = issues.map((issue) => {
    let text = readFileSync(issue.file, 'utf8');
    text = setField(text, 'Status', status);
    if (status === 'in-progress') {
      if (flags.branch !== undefined) text = setField(text, 'Branch', fieldText(flags.branch));
      if (flags.worker !== undefined) text = setField(text, 'Worker', fieldText(flags.worker));
      if (worktree !== undefined) text = setField(text, 'Worktree', worktree);
      text = setField(text, 'Since', since);
    } else {
      text = removeFields(text, LEASE_FIELDS);
    }
    // What was already written under Evidence stays: a drop or a deferral is one more line in the history,
    // not a reset of it.
    if (status === 'dropped' || status === 'deferred') {
      const written = (issue.sections.evidence || '').trim();
      const line = `${status === 'dropped' ? 'Dropped' : 'Deferred'}: ${why}`;
      text = setSection(text, 'Evidence', written ? `${written}\n\n${line}` : line);
    }
    return { issue, text };
  });
  for (const w of writes) writeAtomic(w.issue.file, w.text);
  const leaseNote = [flags.branch !== undefined && `branch ${fieldText(flags.branch)}`, flags.worker !== undefined && `worker ${fieldText(flags.worker)}`, worktree !== undefined && `worktree ${worktree}`].filter(Boolean).join(' · ');
  appendLogLines(root, issues.map((issue) => `${issue.id} → ${status}${why ? ` · ${why}` : ''}${leaseNote ? ` · ${leaseNote}` : ''}`));
  return oneOrMany(rawIds, issues.map((issue) => ({ id: issue.id, status, ...(status === 'in-progress' ? { since, ...(flags.branch !== undefined ? { branch: fieldText(flags.branch) } : {}), ...(flags.worker !== undefined ? { worker: fieldText(flags.worker) } : {}), ...(worktree !== undefined ? { worktree } : {}) } : {}), ...(status === 'done' ? doneNote(issue) : {}) })));
}

// Why an issue may not go done, or null when it may: at least one --ran/--saw evidence row logged since the issue
// last went in progress (or was reopened, or — never in progress — was filed; free-text notes never count alone), and a live approve by someone
// other than its worker (see gateState). It gates only the record: nothing here stops code from landing.
export function doneRefusal(root, issue, journal = journalById(root)) {
  const g = gateState(root, issue.id, journal.get(issue.id) || []);
  const how = `jarl.mjs evidence ${issue.id} --ran "<command>" --saw "<what it printed>"`;
  if (!workEvidence(issue)) return `${issue.id} has no evidence yet — record it first: ${how}`;
  if (!g.tracked && !evidenceRows(issue).length) return `${issue.id} has no --ran/--saw evidence row — a free-text note alone is not proof of the work: ${how}`;
  if (g.tracked && !g.rowsSince) return `${issue.id} has no --ran/--saw evidence row recorded since it was ${g.anchor.what === 'filed' ? 'filed' : `moved → ${g.anchor.what}`} (${g.anchor.at}) — a free-text note, or a row written before that (before a start or a reopen), is not proof of the work: ${how}`;
  if (g.selfApproved) return `${issue.id}'s last approve is by its own worker — a self-approve does not count as review: jarl.mjs review ${issue.id} approve --by <fresh reviewer|jarl> "<findings>"`;
  if (!g.approved) return `${issue.id} has no approving review newer than its last round${g.tracked ? ' or reopen' : ''} — a fresh reviewer reads the issue and the diff first: jarl.mjs review ${issue.id} approve|changes --by <reviewer> "<findings>"`;
  return null;
}

// Said, never refused: done closes an issue whose acceptance is missing, or has more lines than the
// --ran/--saw rows recorded, or that was merged while its CI is not green yet, but the output says so, so
// the gap is seen by whoever closed it.
function doneNote(issue) {
  const notes = [];
  const lines = acceptanceLineCount(issue);
  if (!lines) notes.push('no acceptance line on file');
  else {
    const rows = evidenceRows(issue).length;
    if (rows < lines) notes.push(`${lines} acceptance line(s), ${rows} --ran/--saw row(s)`);
  }
  const m = mergedOf(issue);
  if (m && m.ci !== 'green' && m.ci !== 'none') notes.push(`merged ${m.sha}, CI ${m.ci || 'not recorded'} — record it when known: jarl.mjs merged ${issue.id} --ci green|red`);
  return notes.length ? { note: notes.join('; ') } : {};
}

// The merge an issue records: **Merged:** <sha>[ in <repo>] and **CI:** pending|green|red|none. Null when
// the issue records none (every issue from before the field).
export function mergedOf(issue) {
  const m = /^(\S+)(?: in (.+))?$/.exec(issue.fields.merged || '');
  if (!m) return null;
  const ci = CI_STATES.includes(issue.fields.ci) ? issue.fields.ci : null;
  return { sha: m[1], repo: m[2] || null, ci };
}

// merged <ids> --sha <sha> [--ci pending|green|red|none] [--repo <path>] — the merge as a field, not as prose:
// the sha, where it landed and the CI state. --ci alone, on issues that already record a merge, moves only
// the CI state. A sha the repository does not know is noted, never refused (the merge may be in a clone not
// fetched here). It records; it never decides whether anything may land.
export function cmdMerged(root, rawIds, flags) {
  need(flags.sha !== undefined || flags.ci !== undefined, 'merged needs --sha <sha> (and optionally --ci), or --ci alone on issues that already record a merge');
  if (flags.sha !== undefined) need(/^[0-9a-f]{4,64}$/i.test(String(flags.sha)), `--sha is a commit id, 4 to 64 hex characters (got "${flags.sha}")`);
  if (flags.ci !== undefined) need(CI_STATES.includes(flags.ci), `--ci must be one of: ${CI_STATES.join(', ')} — none means the repository has no CI to wait for`);
  need(flags.repo === undefined || flags.sha !== undefined, '--repo names where --sha landed; give it with --sha');
  const issues = issuesFor(root, rawIds);
  const nothing = issues.length > 1 ? ' — nothing was written' : '';
  if (flags.sha === undefined) for (const issue of issues) need(mergedOf(issue), `${issue.id} records no merge yet — give --sha: jarl.mjs merged ${issue.id} --sha <sha> --ci ${flags.ci}${nothing}`);
  const repoPath = flags.repo !== undefined ? repoOf(root, flags.repo) : null;
  const sha = flags.sha !== undefined ? String(flags.sha).toLowerCase() : null;
  const ci = flags.ci ?? (sha ? 'pending' : undefined);
  const notes = [];
  if (sha) {
    // Where the sha should be: --repo, else each issue's Repo, else the loop's own repository.
    // An issue naming several repositories is noted only when the sha is in none of them.
    const checked = new Set();
    for (const issue of issues) {
      let repos = repoPath ? [repoPath] : [];
      if (!repoPath) for (const n of (reposNamed(issue).length ? reposNamed(issue) : [undefined])) { try { repos.push(repoOf(root, n)); } catch { /* gone */ } }
      repos = repos.filter((r) => git(r, ['rev-parse', '--git-dir']) !== null);
      const key = repos.join('\n');
      if (!repos.length || checked.has(key)) continue;
      checked.add(key);
      if (repos.every((r) => git(r, ['cat-file', '-e', `${sha}^{commit}`]) === null)) notes.push(`${sha} is not a commit in ${repos.join(' or ')} (yet) — recorded as given`);
    }
  }
  for (const issue of issues) {
    let text = readFileSync(issue.file, 'utf8');
    if (sha) text = setField(text, 'Merged', `${sha}${flags.repo !== undefined ? ` in ${fieldText(flags.repo)}` : ''}`);
    text = setField(text, 'CI', ci);
    writeAtomic(issue.file, text);
  }
  appendLogLines(root, issues.map((issue) => (sha ? `${issue.id} merged ${sha}${flags.repo !== undefined ? ` in ${fieldText(flags.repo)}` : ''} · CI ${ci}` : `${issue.id} CI ${ci}`)));
  return { ids: issues.map((i) => i.id), sha: sha || null, ci, notes };
}

export function cmdTag(root, rawIds, ops) {
  const issues = issuesFor(root, rawIds);
  for (const op of ops) need(/^[+-]./.test(op), `tags are +name or -name, not "${op}"`);
  const results = issues.map((issue) => {
    const tags = new Set(issue.tags);
    for (const op of ops) { if (op.startsWith('+')) tags.add(op.slice(1)); else tags.delete(op.slice(1)); }
    return { issue, tags: [...tags].sort() };
  });
  for (const r of results) writeAtomic(r.issue.file, setField(readFileSync(r.issue.file, 'utf8'), 'Tags', r.tags.join(', ')));
  return oneOrMany(rawIds, results.map((r) => ({ id: r.issue.id, tags: r.tags })));
}

export function cmdPrio(root, rawIds, prio) {
  need(PRIORITIES.includes(String(prio)), 'priority is 1, 2 or 3');
  const issues = issuesFor(root, rawIds);
  for (const issue of issues) writeAtomic(issue.file, setField(readFileSync(issue.file, 'utf8'), 'Priority', String(prio)));
  return oneOrMany(rawIds, issues.map((issue) => ({ id: issue.id, priority: String(prio) })));
}

export function cmdFiles(root, rawId, list) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  const files = splitList(list);
  writeAtomic(issue.file, setField(readFileSync(issue.file, 'utf8'), 'Files', files.join(', ')));
  return { id: issue.id, files };
}

export function cmdRepo(root, rawId, path, { clear = false } = {}) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  if (clear) {
    need(issue.fields.repo, `${issue.id} has no Repo field to clear`);
    const text = readFileSync(issue.file, 'utf8').replace(/^\*\*Repo:\*\*.*\n/m, '');
    writeAtomic(issue.file, text);
    return { id: issue.id, repo: null, cleared: true };
  }
  need(path !== undefined, 'repo requires <path> — the checkout of the repository the issue\'s code lives in, several as one comma list (or --clear to remove the field)');
  const repos = repoList(root, path);
  writeAtomic(issue.file, setField(readFileSync(issue.file, 'utf8'), 'Repo', repos.join(', ')));
  return { id: issue.id, repo: repos.join(', '), repos };
}

export function evidenceRows(issue) {
  const text = (issue.sections.evidence || '');
  const rows = [];
  for (const line of text.split('\n')) {
    const m = /^- \*\*ran:\*\*\s*(.*?)\s*·\s*\*\*saw:\*\*\s*(.*)$/.exec(line.trim());
    if (m) rows.push({ ran: m[1], saw: m[2] });
  }
  return rows;
}

// A finding's proposal copied in by import is not yet an acceptance line: it waits to be made checkable.
export const PROPOSED = 'Proposed by the finding';
export function acceptanceLineCount(issue) {
  const text = issue.sections.acceptance || '';
  return text.split('\n').map((l) => l.trim().replace(/^- /, '')).filter((l) => l.length > 0 && !l.startsWith(PROPOSED)).length;
}

// What counts as evidence of the work for done: not a ruling written in by decide or answer, and not the
// reason of an earlier drop or deferral.
export function workEvidence(issue) {
  return (issue.sections.evidence || '').split('\n').filter((l) => !/^\s*(Ruling\b|Dropped:|Deferred:)/.test(l)).join('\n').trim();
}

// evidence <id> "<text>" appends free text (a merge sha, a one-line note); evidence <id> --ran
// "<command>" --saw "<what it printed>" appends one checkable row per pair instead — repeat the pair,
// in one call or across calls, one row per acceptance line. Both append to the same section, never
// replace it: the merger's free-text note lands after the worker's rows. `set done` needs the section
// non-empty, rows or not (not every issue's proof is a command).
export function cmdEvidence(root, rawIds, text, flags) {
  let rows = null;
  if (flags && (flags.ran !== undefined || flags.saw !== undefined)) {
    const rans = [].concat(flags.ran ?? []);
    const saws = [].concat(flags.saw ?? []);
    need(rans.length && saws.length && [...rans, ...saws].every((v) => typeof v === 'string' && v.trim()), 'a row needs both --ran "<command>" and --saw "<what it printed>", each with a value');
    need(rans.length === saws.length, `--ran and --saw must repeat the same number of times (got ${rans.length} --ran, ${saws.length} --saw)`);
    need(text === undefined, `evidence takes free text or --ran/--saw rows, not both (got "${text}" as well) — a value starting with -- goes after a bare --`);
    rows = rans.map((ran, i) => ({ ran, saw: saws[i] }));
  } else {
    need(text, 'evidence requires "<what was run and what it printed>", or --ran "<command>" --saw "<what it printed>"');
  }
  const issues = issuesFor(root, rawIds);
  const added = rows ? rows.map((r) => `- **ran:** ${r.ran} · **saw:** ${r.saw}`).join('\n') : text;
  for (const issue of issues) {
    const current = (issue.sections.evidence || '').trim();
    writeAtomic(issue.file, setSection(readFileSync(issue.file, 'utf8'), 'Evidence', current ? `${current}${rows ? '\n' : '\n\n'}${added}` : added));
  }
  appendLogLines(root, issues.flatMap((issue) => (rows ? rows.map((r) => `${issue.id} evidence row · ${r.ran}`) : [`${issue.id} evidence · ${text.split('\n')[0]}`])));
  return oneOrMany(rawIds, issues.map((issue) => (rows ? { id: issue.id, rows } : { id: issue.id })));
}

// A declared file is a repository and a path inside it. An issue that names no repository declares
// paths in the loop's own, as a single-repository loop always has. An issue that names one writes
// each file with that repository's directory name first — tool/src/a.mjs for Repo ../tool — so a
// reader of the Files line sees where each file lives and the same path in two repositories reads
// as two files; the name is dropped to get the path inside the repository. An entry that does not
// start with the name is taken as a path inside the repository already, so two spellings of one
// file still meet in next rather than passing each other.
//
// One case is ambiguous and is decided by a rule, not by a guess: a repository that has a directory of
// its own name inside it (repository `app` with `app/x.mjs`). There `app/x.mjs` already IS the path
// inside the repository, so the prefix is required — `app/app/x.mjs` is the same file written with it —
// and an entry starting with `app/` but not `app/app/` is never stripped.
//
// A repository is one repository however its path is spelled: the pair's repository is its canonical
// path (symlinks resolved, and the case the file system holds where it ignores case).
export function canonical(path) {
  try { return realpathSync.native(path); } catch { return resolve(path); }
}

export function fileAt(root, issue, declared) {
  const named = splitList(issue.fields.repo);
  if (!named.length) return { repo: root, path: declared };
  // Several repositories: the one whose name the entry starts with; an entry that starts with none of them is
  // a path in the first one named.
  for (const r of named) { const hit = prefixedIn(root, r, declared); if (hit) return hit; }
  return { repo: canonical(resolve(root, named[0])), path: declared };
}
function prefixedIn(root, named, declared) {
  const spelled = resolve(root, named);
  const repo = canonical(spelled);
  // The name written in front of a path is the repository's own directory name, or the name its Repo path
  // spells (a symlink or another case of it): either reads as the same prefix.
  const names = [...new Set([basename(repo), basename(spelled)].filter(Boolean))];
  for (const name of names) {
    let inner = false;
    try { inner = statSync(join(repo, name)).isDirectory(); } catch { inner = false; }
    if (inner) { if (declared.startsWith(`${name}/${name}/`)) return { repo, path: declared.slice(name.length + 1) }; continue; }
    if (declared.startsWith(`${name}/`)) return { repo, path: declared.slice(name.length + 1) };
  }
  return null;
}

// The repositories an issue names, as written: its Repo field, one path or a comma list. Empty for an issue
// whose code lives in the loop's own repository.
export function reposNamed(issue) { return splitList(issue.fields.repo); }
// A --repo value on new, import and repo: one path or a comma list, each the root of a git repository.
function repoList(root, v) {
  need(typeof v === 'string', '--repo takes one path, or several as one comma list');
  const list = splitList(v);
  need(list.length, '--repo needs a path');
  for (const r of list) repoOf(root, r);
  return list;
}

export function cmdNext(root, flags) {
  const issues = loadIssues(root);
  // Files are compared as (repository, path) pairs: the same path in two repositories never holds
  // an issue back, the same file in one repository always does, however its Repo path is spelled.
  const keysOf = (i) => i.files.map((f) => { const at = fileAt(root, i, f); return { f, key: `${at.repo}\n${at.path}` }; });
  const taken = new Set(issues.filter((i) => i.status === 'in-progress').flatMap((i) => keysOf(i).map((k) => k.key)));
  const byId = new Map(issues.map((i) => [i.id, i]));
  const out = [];
  for (const i of issues.filter((x) => x.status === 'open').sort((a, b) => a.priority.localeCompare(b.priority) || a.id.localeCompare(b.id))) {
    // An issue whose After issues are not all done or dropped is never offered, whatever its files.
    const after = waitingOn(i, byId);
    if (after.length) { out.push({ id: i.id, title: i.title, priority: i.priority, after, waitsOn: [] }); continue; }
    const keys = keysOf(i);
    const clash = keys.filter((k) => taken.has(k.key)).map((k) => k.f);
    if (clash.length) { out.push({ id: i.id, title: i.title, priority: i.priority, waitsOn: clash, after: [] }); continue; }
    keys.forEach((k) => taken.add(k.key));
    // Offered, but flagged: a worker raised on an issue with no acceptance line has nothing to prove, and
    // the reviewer nothing to check it against. Fill it with body --acceptance before raising one.
    out.push({ id: i.id, title: i.title, priority: i.priority, files: i.files, ready: true, waitsOn: [], after: [], ...(acceptanceLineCount(i) ? {} : { noAcceptance: true }) });
  }
  const limit = Number(flags.limit) || Infinity;
  let n = 0;
  return out.filter((r) => { if (!r.ready) return true; n += 1; return n <= limit; });
}

// The loop's own files git has not committed: in the committed and permanent modes the loop is part of the
// record, and a loop whose code lives in another repository has no merge in its own to ride on, so nothing
// commits it unless someone does. Null — and silent — in the default mode (git never sees the loop) and
// outside a git repository.
export function uncommittedLoopFiles(root) {
  if (!existsSync(jarlDir(root)) || outOfGit(root)) return null;
  if (git(root, ['rev-parse', '--git-dir']) === null) return null;
  const out = git(root, ['status', '--porcelain', '--untracked-files=all', '--', '.jarl']);
  if (out === null) return null;
  return out.split('\n').filter(Boolean).map((l) => l.slice(3));
}

export function cmdStatus(root, flags = {}) {
  const hours = staleHours(flags);
  const c = { open: 0, 'in-progress': 0, done: 0, dropped: 0, deferred: 0 };
  const issues = loadIssues(root);
  for (const i of issues) c[i.status] = (c[i.status] || 0) + 1;
  // open and in-progress stay the counts of those statuses; waiting is the part of them whose After issues
  // are not settled yet, so "in flight" in the text line means someone is working on it.
  const byId = new Map(issues.map((i) => [i.id, i]));
  const unfinished = issues.filter((i) => i.status === 'open' || i.status === 'in-progress');
  c.waitingIds = unfinished.filter((i) => waitingOn(i, byId).length).map((i) => i.id);
  c.waiting = c.waitingIds.length;
  c.inFlight = unfinished.filter((i) => i.status === 'in-progress' && !c.waitingIds.includes(i.id)).length;
  c.ready = unfinished.filter((i) => i.status === 'open' && !c.waitingIds.includes(i.id)).length;
  c.noAcceptance = issues.filter((i) => i.status === 'in-progress' && !acceptanceLineCount(i)).map((i) => i.id);
  const asks = loadAsks(root).filter((a) => a.state === 'open');
  // A ratify item blocks nothing, so it is not counted among the questions the loop waits on.
  c.questions = asks.filter((a) => a.kind !== 'ratify').length;
  c.toRatify = asks.filter((a) => a.kind === 'ratify');
  c.ratify = c.toRatify.length;
  // What a session needs to decide between continuing this loop and archiving it: the goal, when the
  // loop was opened, and when anything last happened in it — all read from its own files.
  const goalPath = join(jarlDir(root), 'goal.md');
  c.goal = existsSync(goalPath) ? (readFileSync(goalPath, 'utf8').split('\n').slice(2).find((l) => l.trim()) || '').trim() : null;
  const logPath = join(jarlDir(root), 'log.md');
  const stamps = existsSync(logPath) ? [...readFileSync(logPath, 'utf8').matchAll(/^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) · /gm)].map((m) => m[1]) : [];
  c.opened = stamps[0] || null;
  c.lastActivity = stamps[stamps.length - 1] || null;
  const archiveDir = join(jarlDir(root), 'archive');
  c.archived = existsSync(archiveDir) ? readdirSync(archiveDir).length : 0;
  // Leases that look wrong (worktree gone, branch gone, idle), merges waiting on CI, the handoff's age and the
  // loop files nobody committed: all shown, none acted on.
  c.stale = issues.filter((i) => i.status === 'in-progress').map((i) => ({ id: i.id, problems: leaseProblems(root, i, hours) })).filter((x) => x.problems.length);
  const live = issues.filter((i) => i.status !== 'dropped');
  c.ciPending = live.filter((i) => mergedOf(i)?.ci === 'pending').map((i) => i.id);
  c.ciRed = live.filter((i) => mergedOf(i)?.ci === 'red').map((i) => i.id);
  c.handoff = handoffAge(root, c.lastActivity);
  c.reviews = reviewSplit(root, issues);
  const files = uncommittedLoopFiles(root);
  c.uncommitted = files === null ? null : files.length;
  // --by: the same five counts per repository, tag, kind or priority — a dashboard's table, read from the issues.
  if (flags.by !== undefined) {
    need(STATUS_BY.includes(flags.by), `--by is one of: ${STATUS_BY.join(', ')} (got "${flags.by}")`);
    const keysOf = { repo: (i) => repoNames(root, i), tag: (i) => (i.tags.length ? i.tags : ['(none)']), kind: (i) => [i.kind || '(none)'], prio: (i) => [i.priority] }[flags.by];
    const groups = {};
    for (const i of issues) for (const k of keysOf(i)) {
      const g = (groups[k] = groups[k] || { open: 0, 'in-progress': 0, done: 0, dropped: 0, deferred: 0 });
      if (Object.hasOwn(g, i.status)) g[i.status] += 1;
    }
    c.by = { key: flags.by, groups: Object.fromEntries(Object.keys(groups).sort().map((k) => [k, groups[k]])) };
  }
  return c;
}
export const STATUS_BY = ['repo', 'tag', 'kind', 'prio'];

// A loop opened before the permanent mode existed, or opened --committed, has no way to become the
// permanent record other than this: init is the only command that writes .jarl/.permanent for a new
// loop, and mode is the only other one, for an existing one — it never turns the default mode's ignore-everything
// .jarl/.gitignore into the committed one, so a
// default-mode loop (out of git) cannot be switched in place: a permanent record must be committed,
// and only init decides that. Idempotent it is not: running it twice on an already-permanent loop
// refuses clearly instead of silently doing nothing, so a session never mistakes a no-op for a check.
export function cmdMode(root, mode) {
  need(mode, 'mode requires a target: jarl.mjs mode permanent');
  need(mode === 'permanent', `mode only supports "permanent" today: jarl.mjs mode permanent (got "${mode}")`);
  needLiveLoop(root, '');
  need(!outOfGit(root), 'this loop is out of git (default mode) — a permanent record must be committed, and only init decides .jarl/.gitignore, so there is no in-place switch. Start a fresh loop with: jarl.mjs init "<goal>" --permanent');
  need(!existsSync(join(jarlDir(root), '.permanent')), 'already a permanent record (.jarl/.permanent exists) — nothing to do');
  writeAtomic(join(jarlDir(root), '.permanent'), PERMANENT_MARKER);
  appendLog(root, 'mode → permanent · no longer tied to a feature branch; close now keeps the directory instead of removing it');
  return { permanent: true };
}

export function cmdClose(root, flags) {
  needLiveLoop(root, '');
  const left = loadIssues(root).filter((i) => i.status === 'open' || i.status === 'in-progress');
  need(flags.force || left.length === 0, `${left.length} issue(s) still open or in progress: ${left.map((i) => i.id).join(', ')} — set each done or dropped, or report them to the user and run with --force`);
  // A permanent loop is a record, not a stage cleared before a merge: close leaves the directory in
  // place and logs the close instead of removing it, so --root still finds the loop afterwards.
  // Deferred work is not open, so it does not hold the close — but the close says it leaves it waiting.
  const deferred = loadIssues(root).filter((i) => i.status === 'deferred').map((i) => i.id);
  // A committed loop's files git never saw are named, not refused: in the permanent mode they (and the closing
  // line) wait for a commit; in the committed mode the removal below is itself the change to commit.
  if (existsSync(join(jarlDir(root), '.permanent'))) {
    appendLog(root, `closed · kept as a permanent record${deferred.length ? ` · ${deferred.length} deferred still waiting: ${deferred.join(', ')}` : ''}`);
    const files = uncommittedLoopFiles(root);
    return { removed: null, kept: jarlDir(root), leftOpen: left.map((i) => i.id), deferred, uncommitted: files === null ? null : files.length };
  }
  const files = uncommittedLoopFiles(root);
  rmSync(jarlDir(root), { recursive: true, force: true });
  return { removed: jarlDir(root), kept: null, leftOpen: left.map((i) => i.id), deferred, uncommitted: files === null ? null : files.length };
}


// ---- review and the done gate --------------------------------------------------------------------

// The journal, one event per dated line, grouped by the issue each line is about (`NNN …`, or `filed NNN …`).
// Read once per command: the done gate, the review split and tips all read it.
export function journalById(root) {
  const path = join(jarlDir(root), 'log.md');
  const map = new Map();
  if (!existsSync(path)) return map;
  readFileSync(path, 'utf8').split('\n').forEach((l, n) => {
    const m = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) · (.*)$/.exec(l);
    if (!m) return;
    const id = /^(?:filed )?(\d{3})\b/.exec(m[2])?.[1];
    if (!id) return;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push({ n, at: m[1], text: m[2] });
  });
  return map;
}

// Who reviewed, as a kind: the loop's own director (jarl, coordinator), the issue's worker (self), anyone
// else (fresh). A name is compared without case and surrounding space.
export const REVIEWER_KINDS = ['fresh', 'coordinator', 'self'];
export function reviewerKind(by, worker) {
  const b = fieldText(by).toLowerCase();
  if (b === 'self' || (worker && b === fieldText(worker).toLowerCase())) return 'self';
  if (b === 'jarl' || b === 'coordinator' || b === 'reeve') return 'coordinator';
  return 'fresh';
}
const REVIEW_LINE = /^\d{3} review (approve|changes) · (?:by (.+?) \((fresh|coordinator|self)\) · )?/;

// The done gate, read from the journal for one issue. Replaying its lines in order:
// - the evidence anchor is the last move into in-progress from another status, or a reopen (done or
//   in-progress back to open), or — for an issue that never went in progress — its filing; only --ran/--saw
//   rows logged after it count for done (a free-text note never does), so nothing written when the issue was
//   filed, or before a restart or a reopen, is proof of the work;
// - an approve is spent by a later round, by any move out of done, by a reopen and by a (re)start into in-progress, and an approve by the
//   issue's own worker (self) never counts;
// - `tracked` is false for an issue the journal has no filing and no status move for (a hand-made file, a
//   loop older than the log format): the gate then needs a --ran/--saw row in its Evidence section.
export function gateState(root, id, events = journalById(root).get(id) || []) {
  let status = null; let anchor = null; let cut = -1; let worker = null;
  const evidence = []; const reviews = [];
  for (const e of events) {
    if (e.text.startsWith(`filed ${id} `)) { status = 'open'; anchor = e; continue; }
    const move = new RegExp(`^${id} → (${STATUSES.join('|')})\\b`).exec(e.text);
    if (move) {
      const prev = status; status = move[1];
      // A (re)start spends an earlier approve too: in progress → deferred → in progress needs a new review.
      if (status === 'in-progress' && prev !== 'in-progress') { anchor = e; cut = e.n; }
      if (status === 'open' && (prev === 'done' || prev === 'in-progress')) { anchor = e; cut = e.n; }
      if (prev === 'done' && status !== 'done') cut = e.n;
      if (status === 'in-progress') { const w = / · worker (.+?)(?: · worktree |$)/.exec(e.text); if (w) worker = w[1]; }
      continue;
    }
    if (e.text.startsWith(`${id} round `)) { cut = e.n; continue; }
    const r = REVIEW_LINE.exec(e.text);
    if (r) { reviews.push({ n: e.n, at: e.at, verdict: r[1], by: r[2] || null, kind: r[3] || null }); continue; }
    if (e.text.startsWith(`${id} evidence row · `)) evidence.push(e);
  }
  const last = reviews[reviews.length - 1] || null;
  const live = last && last.verdict === 'approve' && last.n > cut ? last : null;
  return {
    tracked: anchor !== null,
    anchor: anchor ? { at: anchor.at, what: anchor.text.startsWith('filed ') ? 'filed' : anchor.text.slice(id.length + 1).split(' · ')[0].replace(/^→ /, '') } : null,
    rowsSince: anchor ? evidence.filter((e) => e.n > anchor.n).length : evidence.length,
    lastReview: last ? last.verdict : null,
    lastApprove: [...reviews].reverse().find((r) => r.verdict === 'approve') || null,
    approved: Boolean(live && live.kind !== 'self'),
    selfApproved: Boolean(live && live.kind === 'self'),
    worker,
  };
}

// The latest review against the rounds and reopens after it (kept for callers of the older shape).
export function reviewState(root, id) {
  const g = gateState(root, id);
  return { approved: g.approved, lastReview: g.lastReview };
}

// Who reviewed the done issues: the kind of each one's last approve, and how many carry no reviewer at all
// (approved before --by existed). Shown by status and report, never acted on.
export function reviewSplit(root, issues = loadIssues(root), journal = journalById(root)) {
  const split = { fresh: 0, coordinator: 0, self: 0, unrecorded: 0 };
  for (const i of issues.filter((x) => x.status === 'done')) {
    const a = gateState(root, i.id, journal.get(i.id) || []).lastApprove;
    split[a && a.kind ? a.kind : 'unrecorded'] += 1;
  }
  return split;
}
function renderSplit(s) { return `fresh ${s.fresh} · coordinator ${s.coordinator} · self ${s.self}${s.unrecorded ? ` · unrecorded ${s.unrecorded}` : ''}`; }

const SEVERITIES = ['Critical', 'Important', 'Minor'];

// A "changes" verdict names at least one Critical or Important finding — Minor alone never bounces
// a branch back to a worker, it goes to evidence and the branch still merges (the review discipline's
// own rule, enforced here rather than left to a reviewer's judgement).
//
// --by names the reviewer, and every verdict needs it: the line records the name and its kind (fresh, coordinator,
// self). An approve by the issue's own worker — its Worker field, or the worker of its last lease — is refused:
// a self-approve is not a review.
export function cmdReview(root, rawIds, verdict, findings, flags = {}) {
  need(verdict === 'approve' || verdict === 'changes', 'review requires approve|changes');
  need(findings, 'review requires "<findings>" — what was read and what was found, even when nothing');
  need(flags.by === undefined || fieldText(flags.by), '--by needs a value — the reviewer\'s name');
  need(flags.by !== undefined, `a verdict needs --by <reviewer> — who read the diff: a fresh reviewer's name, or jarl when the loop's director reviewed it`);
  const issues = issuesFor(root, rawIds);
  const severities = SEVERITIES.filter((s) => findings.includes(s));
  if (verdict === 'changes') {
    need(severities.length > 0, `"changes" needs at least one finding ranked ${SEVERITIES.join('/')} — name the severity, not just the problem`);
    need(severities.some((s) => s !== 'Minor'), '"changes" needs a Critical or Important finding — Minor alone goes to evidence on an approve, it never bounces a branch');
  }
  const by = flags.by !== undefined ? fieldText(flags.by) : null;
  const journal = by ? journalById(root) : null;
  const kinds = issues.map((issue) => {
    if (!by) return null;
    const worker = issue.fields.worker || gateState(root, issue.id, journal.get(issue.id) || []).worker;
    const kind = reviewerKind(by, worker);
    need(verdict !== 'approve' || kind !== 'self', `${issue.id}: an approve by ${by} is a self-approve${worker ? ` (${worker} is the issue's worker)` : ''} and does not count as review — a fresh reviewer, or the jarl, reads the diff${issues.length > 1 ? ' — nothing was written' : ''}`);
    return kind;
  });
  appendLogLines(root, issues.map((issue, n) => `${issue.id} review ${verdict} · ${by ? `by ${by} (${kinds[n]}) · ` : ''}${findings.split('\n')[0]}`));
  // The verdict comes back with the acceptance it was given against, so a reviewer (and the merger reading
  // the output) sees what the approve claims is met — or that there was nothing to meet.
  return oneOrMany(rawIds, issues.map((issue, n) => ({ id: issue.id, verdict, ...(by ? { by, kind: kinds[n] } : {}), severities, acceptance: (issue.sections.acceptance || '').trim() })));
}

// ---- rounds, branches, checks ------------------------------------------------------------------

function git(root, args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

// Where git runs for an issue's code. A loop may keep its issues in one repository while its workers
// change another; that other repository is named by --repo on the command or by the issue's Repo
// field. A relative path is read from the loop's root, not the caller's directory, because workers,
// reviewers and the merger call the tool from different checkouts with the same --root. Naming
// nothing keeps git where the loop lives, as it always was.
export function repoOf(root, named) {
  if (named === undefined || named === '') return root;
  need(typeof named === 'string', '--repo takes one path — the checkout of the repository the code lives in');
  const repo = resolve(root, named);
  need(git(repo, ['rev-parse', '--git-dir']) !== null, `not a git repository: ${repo} (a relative --repo or Repo path is read from the loop's root, ${root})`);
  // A subdirectory of a repository is not the repository: the paths git reports are relative to its root, so a
  // declared file or a removed test would be read from the wrong place and go unseen.
  const top = git(repo, ['rev-parse', '--show-toplevel']);
  need(top !== null && canonical(top) === canonical(repo), `${repo} is inside the repository at ${top}, not its root — name the root: ${relative(canonical(root), canonical(top || repo)) || '.'}`);
  return repo;
}

export function roundsOf(root, id) {
  const path = join(jarlDir(root), 'log.md');
  if (!existsSync(path)) return 0;
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.includes(`· ${id} round `)).length;
}

export function cmdRound(root, rawId, what) {
  need(what, 'round requires "<what failed>"');
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  const n = roundsOf(root, issue.id) + 1;
  appendLog(root, `${issue.id} round ${n} · ${what}`);
  const takeover = n >= ROUNDS_BEFORE_TAKEOVER;
  const log = readFileSync(join(jarlDir(root), 'log.md'), 'utf8').split('\n').filter((l) => l.includes(`· ${issue.id} `)).join('\n');
  const block = takeover ? `## Takeover\n\nA prior worker attempted issue ${issue.id} ${n} times; the issue is yours now. Its rounds so far:\n\n\`\`\`\n${log}\n\`\`\`\n` : null;
  return { id: issue.id, round: n, takeover, block };
}

function defaultBase(root) {
  return git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'HEAD';
}

const ASSERT_RE = /\b(expect\(|assert\.|assert\(|assert |t\.(Error|Fatal|Errorf|Fatalf)\(|Assert\.|should\.|\.toBe|\.toEqual)/g;

function countAsserts(root, ref, files) {
  let n = 0;
  for (const f of files) {
    const text = git(root, ['show', `${ref}:${f}`]);
    if (text === null) continue;
    n += (text.match(ASSERT_RE) || []).length;
  }
  return n;
}

function isTestFile(f) { return /(^|\/)(test|tests|spec|__tests__)(\/|$)|\.(test|spec)\.[a-z]+$|_test\.[a-z]+$|Tests?\.[a-z]+$/.test(f); }

// check <id> --branch <b> bounds the diff by that issue's Files; check --branch <b> with no id bounds it by the
// union of Files over every issue that records Branch <b> (in progress or done) — a package on one shared
// branch passes in one call instead of failing each issue for the files of the others.
export function cmdCheck(root, rawId, flags) {
  need(flags.branch, 'check requires --branch <worker branch>');
  let pkg;
  if (rawId === undefined) {
    pkg = loadIssues(root).filter((i) => i.fields.branch === flags.branch && (i.status === 'in-progress' || i.status === 'done'));
    need(pkg.length, `no issue records branch ${flags.branch} — name one (check <id> --branch ${flags.branch}), or record the package: set <ids> in-progress --branch ${flags.branch}`);
    if (flags.repo === undefined) {
      const repos = new Map();
      for (const i of pkg) for (const n of (reposNamed(i).length ? reposNamed(i) : ['.'])) { const r = canonical(resolve(root, n)); repos.set(r, [...(repos.get(r) || []), i.id]); }
      need(repos.size === 1, `the issues on ${flags.branch} name different repositories (${[...repos.values()].map((ids) => ids.join(', ')).join(' | ')}) — check them one by one, or pass --repo`);
    }
  } else {
    const issue = findIssue(root, rawId);
    need(issue, `no such issue: ${rawId}`);
    pkg = [issue];
    need(flags.repo !== undefined || reposNamed(issue).length <= 1, `${issue.id} names several repositories (${reposNamed(issue).join(', ')}) — check one at a time with --repo <path>`);
  }
  const issue = pkg[0];
  const repo = repoOf(root, flags.repo ?? reposNamed(issue)[0]);
  const realRepo = canonical(repo);
  const where = repo === root ? '' : ` in ${repo}`;
  const base = flags.base || defaultBase(repo);
  const tip = git(repo, ['rev-parse', '--verify', flags.branch]);
  need(tip, `no such branch: ${flags.branch}${where}`);
  const mergeBase = git(repo, ['merge-base', base, flags.branch]);
  need(mergeBase, `no merge base between ${base} and ${flags.branch}${where}`);
  const commits = (git(repo, ['rev-list', '--count', `${mergeBase}..${flags.branch}`]) || '0');
  const changed = (git(repo, ['diff', '--name-only', `${mergeBase}..${flags.branch}`]) || '').split('\n').filter(Boolean);
  // A change proves itself with a test and announces itself in the changelog, so neither is ever
  // "outside" the issue: the scope check is about source, not about the two files every issue touches.
  const alwaysInScope = (f) => isTestFile(f) || /(^|\/)CHANGELOG\.md$/i.test(f);
  // A declared file may be repo-relative (the common case) or relative to some subdirectory the
  // issue itself is scoped to (e.g. a plugin's own skill body); a diff path matches either way —
  // as a root-relative prefix, or as a path suffix ending at a "/" boundary.
  const pathMatches = (f, d) => {
    const dd = d.replace(/\/+$/, '');
    return f === dd || f.startsWith(`${dd}/`) || f.endsWith(`/${dd}`);
  };
  // The diff's paths are inside the repository read, so a file the issue declares with its
  // repository's name first is matched by the path after that name.
  // `--repo` on the command reads the paths as the issue's own Repo field would.
  // An issue that names several repositories bounds the diff by the files it declares in the one read here.
  const listsRepo = (i) => reposNamed(i).some((n) => canonical(resolve(root, n)) === realRepo);
  const named = (i) => (flags.repo !== undefined && !listsRepo(i) ? { ...i, fields: { ...i.fields, repo: flags.repo } } : i);
  const here = pkg.flatMap((i) => i.files.map((d) => ({ d, at: fileAt(root, named(i), d) }))).filter((x) => canonical(x.at.repo) === realRepo);
  const declaredFiles = [...new Set(here.map((x) => x.d))];
  const declared = here.map((x) => x.at.path);
  const outside = declaredFiles.length ? changed.filter((f) => !alwaysInScope(f) && !declared.some((d) => pathMatches(f, d))) : [];
  const noFiles = pkg.length > 1 ? pkg.filter((i) => !here.some((x) => i.files.includes(x.d))).map((i) => i.id) : [];
  const testsBase = (git(repo, ['ls-tree', '-r', '--name-only', mergeBase]) || '').split('\n').filter(isTestFile);
  const testsTip = (git(repo, ['ls-tree', '-r', '--name-only', flags.branch]) || '').split('\n').filter(isTestFile);
  const removedTests = testsBase.filter((f) => !testsTip.includes(f));
  const touchedTests = changed.filter(isTestFile);
  const assertsBase = countAsserts(repo, mergeBase, [...new Set([...touchedTests, ...removedTests])]);
  const assertsTip = countAsserts(repo, flags.branch, touchedTests);
  const items = [
    { name: 'commits beyond base', ok: Number(commits) > 0, note: `${commits} commit(s) on ${flags.branch} beyond ${mergeBase.slice(0, 7)}` },
    { name: 'diff inside declared files', ok: outside.length === 0, note: (declaredFiles.length ? (outside.length ? `outside ${declaredFiles.join(', ')}: ${outside.join(', ')}` : `${changed.length} file(s), all inside`) : `no files declared on the ${pkg.length > 1 ? 'issues' : 'issue'} — nothing to bound the diff by`) + (noFiles.length ? ` (${noFiles.join(', ')} declare${noFiles.length === 1 ? 's' : ''} no files)` : '') },
    { name: 'test files', ok: removedTests.length === 0, note: removedTests.length ? `removed: ${removedTests.join(', ')}` : `${testsTip.length} on the branch, ${touchedTests.length} touched, none removed` },
    { name: 'assertions in touched tests', ok: assertsTip >= assertsBase, note: `${assertsBase} → ${assertsTip}` },
  ];
  return { id: rawId === undefined ? null : issue.id, ids: pkg.map((i) => i.id), branch: flags.branch, repo, base, mergeBase, changed, items, ok: items.every((i) => i.ok) };
}

// Every jarl/* branch, plus every branch some worktree has checked out that is not the base: a
// worker that never renamed its branch still did the work, and a listing that hides it would
// hide a report. Such a branch is marked unnamed so the merger renames it before merging.
// With --repo, all of it is read in that repository, for a loop whose workers change another one.
// Worker branches in one repository, or — with no --repo — in the loop's own repository and in every repository
// an open or in-progress issue names, each row carrying the repository's name. The boot reads this to see a worker
// branch with commits as a report, and in a loop whose issues point at other repositories that is where they are.
export function cmdBranches(root, flags) {
  const hours = staleHours(flags);
  const issues = loadIssues(root);
  const repos = flags.repo !== undefined ? [repoOf(root, flags.repo)] : loopRepos(root, issues);
  return repos.flatMap((repo) => branchesIn(root, repo, flags, issues, hours));
}

function staleHours(flags) {
  if (flags['stale-hours'] === undefined) return STALE_HOURS;
  const h = Number(flags['stale-hours']);
  need(Number.isFinite(h) && h > 0, `--stale-hours takes a positive number of hours (got "${flags['stale-hours']}")`);
  return h;
}

// The loop's own repository, every repository an open or in-progress issue names, and every one an issue
// records a Branch in (a done package's branch waits there to be deleted).
function loopRepos(root, issues = loadIssues(root)) {
  const seen = new Map([[canonical(root), root]]);
  for (const issue of issues) {
    const unfinished = issue.status === 'open' || issue.status === 'in-progress';
    if (!unfinished && !(issue.fields.branch && issue.status !== 'dropped')) continue;
    for (const named of reposNamed(issue)) {
      let repo;
      try { repo = repoOf(root, named); } catch { continue; }   // a Repo path that no longer resolves is not the boot's to refuse
      const real = canonical(repo);
      if (!seen.has(real)) seen.set(real, repo);
    }
  }
  return [...seen.values()];
}

// The repository an issue's code lives in, canonical; null when its Repo path no longer resolves. Resolved
// once per spelling of the path in a run: a loop of hundreds of issues names a handful of repositories.
const REPO_OF = new Map();
function issueRepos(root, issue) {
  const key = `${root}\n${issue.fields.repo || ''}`;
  if (!REPO_OF.has(key)) {
    const out = [];
    for (const n of (reposNamed(issue).length ? reposNamed(issue) : [undefined])) { try { out.push(canonical(repoOf(root, n))); } catch { /* no longer resolves */ } }
    REPO_OF.set(key, out);
  }
  return REPO_OF.get(key);
}

// The issues a branch carries in one repository: those that record it as their Branch, and — for an issue
// from before the field — the one whose number the branch's jarl/NNN-* name carries.
function issuesOnBranch(root, issues, realRepo, name) {
  const legacy = /^jarl\/(?:[^/]+\/)?(\d{3})-/.exec(name)?.[1] || /^[^/]+\/jarl\/(\d{3})-/.exec(name)?.[1];
  return issues.filter((i) => issueRepos(root, i).includes(realRepo) && (i.fields.branch ? i.fields.branch === name : i.id === legacy));
}

function parseStamp(s) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(String(s || '').trim());
  return m ? Date.parse(`${m[1]}T${m[2]}:00Z`) : null;
}
export function ago(ms) {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// What looks wrong with an in-progress issue's lease — shown, never acted on (no expiry, no takeover): its
// recorded worktree is gone, its recorded branch is gone, or the lease is older than `hours` and its branch
// has no commit that recent either. An issue from before the lease fields has none of them and reads clean.
export function leaseProblems(root, issue, hours = STALE_HOURS, now = Date.now()) {
  if (issue.status !== 'in-progress') return [];
  const f = issue.fields;
  const out = [];
  if (f.worktree && !existsSync(f.worktree)) out.push(`worktree gone: ${f.worktree}`);
  let lastCommit = null;
  if (f.branch) {
    // Outside a git repository there is no branch to find, gone or not. An issue naming several repositories
    // keeps its branch while any of them has it.
    const repos = [];
    for (const n of (reposNamed(issue).length ? reposNamed(issue) : [undefined])) { try { const r = repoOf(root, n); if (git(r, ['rev-parse', '--git-dir']) !== null) repos.push(r); } catch { /* gone */ } }
    const having = repos.filter((r) => git(r, ['rev-parse', '--verify', '--quiet', `refs/heads/${f.branch}`]) !== null);
    if (repos.length && !having.length) out.push(`branch gone: ${f.branch}`);
    for (const r of having) { const t = Number(git(r, ['log', '-1', '--format=%ct', f.branch])) * 1000 || null; if (t && (!lastCommit || t > lastCommit)) lastCommit = t; }
  }
  const since = parseStamp(f.since);
  const limit = hours * 3_600_000;
  if (since !== null && now - since > limit && !(lastCommit && now - lastCommit <= limit)) {
    out.push(`idle ${ago(now - since)}: lease since ${f.since}${lastCommit ? `, last commit ${ago(now - lastCommit)} ago` : ''}`);
  }
  return out;
}

// Whether a branch whose issues are all settled (done or dropped, at least one done) can go. 'delete': its tip
// is in the base — an ancestor of it, or of every merge sha its done issues record (a squash or a merge made
// elsewhere) — and its worktree holds nothing uncommitted. 'dirty': it would be, but its worktree has
// uncommitted files. 'unverified': its issues record merges but the branch has commits none of them contain
// (work after the merge, or a squash). A branch matched only by its jarl/NNN- number, with no Branch field
// behind it, is judged by ancestry alone: a number is too weak to trust a recorded merge for. Null otherwise.
function doneMark(repo, base, name, on, dirty) {
  const settled = on.length > 0 && on.every((i) => i.status === 'done' || i.status === 'dropped') && on.some((i) => i.status === 'done');
  if (!settled) return null;
  const inBase = git(repo, ['merge-base', '--is-ancestor', name, base]) !== null;
  let byRecord = false;
  if (!inBase) {
    const recorded = on.every((i) => i.fields.branch === name);
    const done = on.filter((i) => i.status === 'done');
    if (!recorded || !done.every((i) => mergedOf(i))) return null;
    byRecord = done.every((i) => git(repo, ['merge-base', '--is-ancestor', name, mergedOf(i).sha]) !== null);
    if (!byRecord) return 'unverified';
  }
  return dirty ? 'dirty' : 'delete';
}

function branchesIn(root, repo, flags, issues = loadIssues(root), hours = STALE_HOURS) {
  const base = flags.base || defaultBase(repo);
  const real = canonical(repo);
  const named = (git(repo, ['branch', '--list', 'jarl/*', '--format=%(refname:short)']) || '').split('\n').filter(Boolean);
  const worktrees = (git(repo, ['worktree', 'list', '--porcelain']) || '').split('\n\n').map((b) => {
    const path = /^worktree (.*)$/m.exec(b)?.[1];
    const branch = /^branch refs\/heads\/(.*)$/m.exec(b)?.[1];
    return { path, branch };
  }).filter((w) => w.branch);
  const mainPath = git(repo, ['rev-parse', '--show-toplevel']);
  // A branch some issue records as its Branch is listed whatever its name: a package's shared branch.
  const leased = [...new Set(issues.filter((i) => i.fields.branch && i.status !== 'dropped' && issueRepos(root, i).includes(real)).map((i) => i.fields.branch))];
  const exists = (b) => git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]) !== null;
  const recorded = leased.filter((b) => !named.includes(b) && b !== base && exists(b));
  const extra = worktrees.filter((w) => w.branch !== base && !named.includes(w.branch) && !recorded.includes(w.branch) && w.path !== mainPath).map((w) => w.branch);
  const rows = [...named, ...recorded, ...extra].map((name) => {
    const mb = git(repo, ['merge-base', base, name]);
    const ahead = mb ? Number(git(repo, ['rev-list', '--count', `${mb}..${name}`]) || 0) : null;
    const wt = worktrees.find((w) => w.branch === name);
    // git keeps listing a worktree whose directory was deleted under it (prunable) — that one is gone.
    const wtGone = Boolean(wt && !existsSync(wt.path));
    const dirty = wt && !wtGone ? (git(wt.path, ['status', '--porcelain']) || '').split('\n').filter(Boolean).length : null;
    const on = issuesOnBranch(root, issues, real, name);
    const stale = on.flatMap((i) => leaseProblems(root, i, hours).map((p) => `${i.id} ${p}`));
    // Done → delete: every issue it carries is done or dropped (at least one done), and its work is in the
    // base — the branch is an ancestor of it, or every done issue records its merge.
    const done = doneMark(repo, base, name, on, dirty);
    return { repo: basename(repo), branch: name, ahead, worktree: wt ? wt.path : null, ...(wtGone ? { worktreeGone: true } : {}), dirty, unnamed: !name.startsWith('jarl/') && !leased.includes(name), issues: on.map((i) => i.id), stale, done, deletable: done === 'delete' };
  });
  // An in-progress issue whose recorded branch is not in the repository any more: a lease with nothing under it.
  const gone = leased.filter((b) => !exists(b)).map((name) => {
    const on = issuesOnBranch(root, issues, real, name);
    const stale = on.flatMap((i) => leaseProblems(root, i, hours).map((p) => `${i.id} ${p}`));
    return { repo: basename(repo), branch: name, ahead: null, worktree: null, dirty: null, unnamed: false, issues: on.map((i) => i.id), stale, done: null, deletable: false, missing: true };
  }).filter((r) => r.stale.length);
  return [...rows, ...gone];
}

// ---- tips: where each repository's branches stand, and their CI -----------------------------------

// A directory's repository, as one key: the canonical root of the git repository holding it, so a loop kept in a
// subdirectory and a Repo path naming that repository's root (../../..) are one repository, not two.
const TOP_OF = new Map();
function topOf(dir) {
  if (!TOP_OF.has(dir)) TOP_OF.set(dir, canonical(git(dir, ['rev-parse', '--show-toplevel']) || dir));
  return TOP_OF.get(dir);
}
function issueTops(root, issue) { return issueRepos(root, issue).map(topOf); }

// A merge counts as recent for tips while its CI is pending or red, or for this long after its log line.
export const TIPS_RECENT_MS = 7 * 24 * 3_600_000;

// gh, when it is on PATH (JARL_GH names another binary: a test knob). Null when it cannot be run: tips then
// says nothing about CI rather than guessing.
let GH;
function ghBin() {
  if (GH !== undefined) return GH;
  const bin = process.env.JARL_GH || 'gh';
  try { execFileSync(bin, ['--version'], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 10_000 }); GH = bin; } catch { GH = null; }
  return GH;
}
// The CI runs for one commit, summed up: pending while any run is not completed, red when any concluded
// otherwise than success, skipped or neutral, green when all did, none when no run exists. Null without gh or
// when gh fails (not logged in, no remote on GitHub): unknown, never red.
export function ciOf(repo, sha) {
  const bin = ghBin();
  if (!bin) return null;
  let runs;
  try {
    runs = JSON.parse(execFileSync(bin, ['run', 'list', '--commit', sha, '--json', 'conclusion,status,databaseId,workflowName', '--limit', '20'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 }));
  } catch { return null; }
  if (!Array.isArray(runs)) return null;
  const pending = runs.filter((r) => r.status && r.status !== 'completed');
  const bad = runs.filter((r) => r.status === 'completed' && !['success', 'skipped', 'neutral'].includes(r.conclusion));
  const state = !runs.length ? 'none' : pending.length ? 'pending' : bad.length ? 'red' : 'green';
  const pick = bad[0] || pending[0] || runs[0];
  return { state, runs: runs.length, ...(pick ? { run: pick.databaseId ?? null, workflow: pick.workflowName ?? null, conclusion: pick.conclusion || pick.status || null } : {}) };
}

// tips — read-only: for the loop's own repository and every repository an open, in-progress or recently merged
// issue names, the tip of each branch that matters there — the feature branches its in-progress issues record,
// the branch its checkout is on (the release branch), and main — with ahead/behind against its upstream as last
// fetched (nothing is fetched), and, when gh is on PATH, the CI of that exact commit. It never gates anything.
export function cmdTips(root) {
  const issues = loadIssues(root);
  const journal = journalById(root);
  const now = Date.now();
  const recent = (i) => {
    const m = mergedOf(i);
    if (!m || i.status === 'dropped') return false;
    if (m.ci === 'pending' || m.ci === 'red') return true;
    const line = [...(journal.get(i.id) || [])].reverse().find((e) => e.text.startsWith(`${i.id} merged `));
    const at = line ? parseStamp(line.at) : null;
    return at !== null && now - at <= TIPS_RECENT_MS;
  };
  const named = issues.filter((i) => i.status === 'open' || i.status === 'in-progress' || recent(i));
  const repos = new Map([[topOf(root), root]]);
  for (const i of named) {
    const m = mergedOf(i);
    for (const n of [...reposNamed(i), ...(m && m.repo ? [m.repo] : [])]) { try { const r = repoOf(root, n); if (!repos.has(topOf(r))) repos.set(topOf(r), r); } catch { /* gone */ } }
  }
  const out = [];
  for (const [real, repo] of repos) {
    if (git(repo, ['rev-parse', '--git-dir']) === null) continue;
    const current = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const exists = (b) => git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]) !== null;
    const main = ['main', 'master'].find(exists) || null;
    const flight = issues.filter((i) => i.status === 'in-progress' && i.fields.branch && issueTops(root, i).includes(real));
    // A worker branch of an issue naming several repositories lives in one or some of them: it is shown where it
    // is, and GONE only when none of them has it.
    const hasBranch = (dir, b) => git(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]) !== null;
    const elsewhere = (b) => flight.filter((i) => i.fields.branch === b).some((i) => issueRepos(root, i).some((r) => topOf(r) !== real && hasBranch(r, b)));
    const feature = [...new Set(flight.map((i) => i.fields.branch))].filter((b) => exists(b) || !elsewhere(b));
    const wanted = [...feature.map((b) => ({ role: 'feature', branch: b })), ...(current && current !== 'HEAD' ? [{ role: 'release', branch: current }] : []), ...(main ? [{ role: 'main', branch: main }] : [])];
    const seen = new Set();
    const rows = [];
    for (const w of wanted) {
      if (seen.has(w.branch)) continue;
      seen.add(w.branch);
      if (!exists(w.branch)) { rows.push({ ...w, sha: null, missing: true }); continue; }
      const sha = git(repo, ['rev-parse', w.branch]);
      // A worker branch cut with tracking of the release branch has no upstream of its own: only a remote branch
      // of the same name counts as where it was pushed.
      let upstream = git(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${w.branch}@{upstream}`]);
      if (upstream && w.role === 'feature' && !upstream.endsWith(`/${w.branch}`)) upstream = null;
      let ahead = null; let behind = null; let against = null;
      if (upstream) {
        const lr = (git(repo, ['rev-list', '--left-right', '--count', `${w.branch}...${upstream}`]) || '').split(/\s+/).map(Number);
        [ahead, behind] = lr; against = upstream;
      } else if (w.role === 'feature' && current && current !== 'HEAD' && current !== w.branch) {
        const lr = (git(repo, ['rev-list', '--left-right', '--count', `${w.branch}...${current}`]) || '').split(/\s+/).map(Number);
        [ahead, behind] = lr; against = current;
      }
      const on = w.role === 'feature' ? flight.filter((i) => i.fields.branch === w.branch).map((i) => i.id) : [];
      // CI runs on what was pushed: only a tip its upstream already holds (nothing ahead) is asked about.
      const pushed = Boolean(upstream) && ahead === 0;
      const ci = pushed ? ciOf(repo, sha) : null;
      rows.push({ ...w, sha: sha.slice(0, 12), upstream: upstream || null, against, ahead, behind, pushed, ...(on.length ? { issues: on } : {}), ...(ci ? { ci } : {}) });
    }
    const merged = named.filter((i) => mergedOf(i) && issueTops(root, i).includes(real)).map((i) => ({ id: i.id, sha: mergedOf(i).sha, ci: mergedOf(i).ci }));
    out.push({ repo: basename(real), path: repo, rows, ...(merged.length ? { merged } : {}) });
  }
  return { gh: ghBin() !== null, repos: out };
}

function renderTips(o) {
  const lines = [];
  for (const r of o.repos) {
    lines.push(`[${r.repo}] ${r.path}`);
    for (const x of r.rows) {
      if (x.missing) { lines.push(`  ${x.role.padEnd(8)} ${x.branch}  GONE`); continue; }
      const ab = x.against ? `  ${x.ahead === 0 && x.behind === 0 ? `= ${x.against}` : `+${x.ahead}/-${x.behind} vs ${x.against}`}` : '  (no upstream)';
      const ci = x.ci ? `  ci ${x.ci.state}${x.ci.run ? ` (run ${x.ci.run}${x.ci.workflow ? ` ${x.ci.workflow}` : ''})` : ''}` : x.pushed ? '' : '  not pushed';
      lines.push(`  ${x.role.padEnd(8)} ${x.branch} ${x.sha}${ab}${ci}${x.issues ? `  → ${x.issues.join(', ')}` : ''}`);
    }
    for (const m of r.merged || []) lines.push(`  merged   ${m.id} ${m.sha} · CI ${m.ci || 'not recorded'}`);
  }
  return lines.join('\n') || '(no repository)';
}

// ---- the merge queue: derived, never stored --------------------------------------------------------

// queue [--repo <path>] [--base <b>] — read-only: the branches waiting for the merger. A branch is in the queue when
// an unsettled issue on it (open or in progress) holds a live approve — one no round, restart or reopen has spent,
// by someone other than its worker (the same reading as the done gate) — and the branch has commits its base does
// not, so it is not merged yet. Rows are ordered by approval (the latest live approve on the branch, then the log's
// order) and, per repository, cut into batches the way the merger's brief batches: a branch joins the current batch
// while its declared files share none with it, and starts the next one otherwise. It computes, holds no lock and
// writes nothing; it runs no check and refuses no merge — that is Horde's land.
export function cmdQueue(root, flags = {}) {
  const issues = loadIssues(root);
  const journal = journalById(root);
  const unsettled = issues.filter((i) => i.status === 'open' || i.status === 'in-progress');
  const gate = new Map(unsettled.map((i) => [i.id, gateState(root, i.id, journal.get(i.id) || [])]));
  const approved = unsettled.filter((i) => gate.get(i.id).approved);
  const repos = flags.repo !== undefined ? [repoOf(root, flags.repo)] : loopRepos(root, issues);
  const out = [];
  for (const repo of repos) {
    if (git(repo, ['rev-parse', '--git-dir']) === null) continue;
    const real = canonical(repo);
    const base = flags.base || defaultBase(repo);
    const exists = (b) => git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]) !== null;
    // The branch an approved issue is on: its Branch field, else — for an issue from before the field — the one
    // jarl/NNN-* branch carrying its number.
    const branchOf = (i) => {
      if (i.fields.branch) return exists(i.fields.branch) ? i.fields.branch : null;
      const legacy = (git(repo, ['branch', '--list', `jarl/${i.id}-*`, `jarl/*/${i.id}-*`, '--format=%(refname:short)']) || '').split('\n').filter(Boolean);
      return legacy.length === 1 ? legacy[0] : null;
    };
    const branches = new Map();
    for (const i of approved.filter((x) => issueRepos(root, x).includes(real))) {
      const b = branchOf(i);
      if (b && b !== base) branches.set(b, [...(branches.get(b) || []), i]);
    }
    const rows = [];
    for (const [branch, on] of branches) {
      const mb = git(repo, ['merge-base', base, branch]);
      const ahead = mb ? Number(git(repo, ['rev-list', '--count', `${mb}..${branch}`]) || 0) : null;
      if (!ahead) continue;   // nothing its base lacks: merged already, or never worked on
      const others = issuesOnBranch(root, unsettled, real, branch).filter((i) => !on.includes(i));
      const approves = on.map((i) => gate.get(i.id).lastApprove);
      const last = approves.reduce((a, b) => (!a || b.n > a.n ? b : a), null);
      const files = [...new Set(on.concat(others).flatMap((i) => i.files.map((f) => { const at = fileAt(root, i, f); return canonical(at.repo) === real ? at.path : null; }).filter(Boolean)))];
      rows.push({ branch, issues: on.map((i) => i.id), waitingReview: others.map((i) => i.id), ready: others.length === 0, ahead, approvedAt: last.at, by: last.by, files, n: last.n });
    }
    rows.sort((a, b) => a.n - b.n);
    // Batches: consecutive rows whose declared files do not meet. A row with no files declared rides alone —
    // nothing says what it touches.
    let batch = 0; let taken = null;
    for (const r of rows) {
      if (!taken || !r.files.length || r.files.some((f) => taken.has(f))) { batch += 1; taken = new Set(); }
      r.files.forEach((f) => taken.add(f));
      if (!r.files.length) taken = null;
      r.batch = batch;
      delete r.n;
    }
    out.push({ repo: basename(real), path: repo, base, rows });
  }
  return { repos: out };
}

function renderQueue(o) {
  const lines = [];
  for (const r of o.repos) {
    if (!r.rows.length && o.repos.length > 1) continue;
    lines.push(`[${r.repo}] into ${r.base}`);
    if (!r.rows.length) lines.push('  (nothing approved waits to be merged)');
    r.rows.forEach((x, n) => {
      lines.push(`  ${n + 1}. ${x.branch} → ${x.issues.join(', ')}  +${x.ahead}  approved ${x.approvedAt}${x.by ? ` by ${x.by}` : ''}  batch ${x.batch}${x.ready ? '' : `  (waiting for review: ${x.waitingReview.join(', ')})`}`);
    });
  }
  return lines.join('\n') || '(nothing approved waits to be merged)';
}

// ---- changelog fragments -----------------------------------------------------------------------------

// changelog <ids> [--repo <path>] — the ## Changelog entries of those issues, grouped by Keep a Changelog section in
// its order, ready to paste under [Unreleased] at merge time; one block per repository when the issues span several
// (an issue naming two is printed under each), or only the one --repo names. Workers record their line on the issue
// (new/body --changelog) instead of editing CHANGELOG.md, so parallel branches stop conflicting there; whoever merges
// writes the file once. Reads only.
export function cmdChangelog(root, rawIds, flags = {}) {
  need(rawIds !== undefined, 'changelog requires <ids> — the issues whose fragments to print, e.g. 284,288 or 203-206');
  const issues = issuesFor(root, rawIds);
  // --repo is matched by the repository itself (its resolved root), never by its folder name alone.
  const only = flags.repo !== undefined ? topOf(canonical(repoOf(root, flags.repo))) : null;
  const byRepo = {};
  const missing = [];
  for (const i of issues) {
    const entries = changelogEntries(i);
    if (!entries.length) { missing.push(i.id); continue; }
    if (only && !issueTops(root, i).includes(only)) continue;
    const names = only ? [basename(only)] : repoNames(root, i);
    for (const r of names) {
      const sec = (byRepo[r] = byRepo[r] || {});
      for (const e of entries) (sec[e.section] = sec[e.section] || []).push(e.text);
    }
  }
  const order = (sec) => Object.fromEntries(CHANGELOG_SECTIONS.filter((k) => sec[k]).map((k) => [k, sec[k]]));
  const repos = Object.keys(byRepo).sort();
  const block = (sec) => CHANGELOG_SECTIONS.filter((k) => sec[k]).map((k) => `### ${k}\n${sec[k].map((t) => `- ${t}`).join('\n')}`).join('\n\n');
  const text = repos.length > 1 ? repos.map((r) => `## ${r}\n\n${block(byRepo[r])}`).join('\n\n') : repos.length ? block(byRepo[repos[0]]) : '';
  return { ids: issues.map((i) => i.id), missing, repos: Object.fromEntries(repos.map((r) => [r, order(byRepo[r])])), ...(repos.length <= 1 ? { sections: repos.length ? order(byRepo[repos[0]]) : {} } : {}), text };
}

// ---- questions to the user and the handoff --------------------------------------------------

function asksPath(root) { return join(jarlDir(root), 'asks.md'); }
const ASK_RE = /^- \*\*a-(\d{3})\*\* \((open|answered)\)(?: · (stop|stuck|lower|charter|ratify))?(?: · target (\S+))?(?: · issue (\d{3}))? · (.*)$/;

export function loadAsks(root) {
  const path = asksPath(root);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').map((l) => ASK_RE.exec(l)).filter(Boolean)
    .map((m) => ({ id: m[1], state: m[2], kind: m[3] || null, target: m[4] || null, issue: m[5] || null, question: m[6] }));
}

export function cmdAsk(root, question, flags) {
  need(question, 'ask requires "<question>"');
  const kind = String(flags.kind || 'stuck');
  need(ASK_KINDS.includes(kind), `--kind must be one of: ${ASK_KINDS.join(', ')} — stop (halt everything), stuck (this issue only), lower (weaken something protected, needs a target), charter (the goal itself), ratify (a choice already made under a mandate, awaiting the user's word; blocks nothing)`);
  if (flags.issue !== undefined) need(findIssue(root, flags.issue), `no such issue: ${flags.issue}`);
  need(kind !== 'lower' || flags.target, '--target is required for kind lower — nothing to weaken without naming it');
  need(kind === 'lower' || !flags.target, `--target has no meaning for kind "${kind}" — only lower names something to weaken`);
  const asks = loadAsks(root);
  const id = String(asks.reduce((m, a) => Math.max(m, Number(a.id)), 0) + 1).padStart(3, '0');
  const path = asksPath(root);
  const target = kind === 'lower' ? ` · target ${flags.target}` : '';
  appendAtomic(path, '# Questions to the user\n\n', `- **a-${id}** (open) · ${kind}${target}${flags.issue ? ` · issue ${String(flags.issue).padStart(3, '0')}` : ''} · ${question}\n`);
  appendLog(root, `asked a-${id} (${kind}) · ${question}`);
  return { id, question, kind };
}

export function cmdAnswer(root, rawId, answer) {
  need(answer, 'answer requires "<answer>"');
  const id = String(rawId).replace(/^a-/, '').padStart(3, '0');
  const ask = loadAsks(root).find((a) => a.id === id);
  need(ask, `no such question: a-${id}`);
  need(ask.state === 'open', `a-${id} is already answered`);
  appendDecision(root, `ask-${id}`, `**Question:** ${ask.question}\n**Answer:** ${answer}`, { by: 'owner' });
  const path = asksPath(root);
  writeAtomic(path, readFileSync(path, 'utf8').replace(`- **a-${id}** (open)`, `- **a-${id}** (answered)`));
  appendLog(root, `answered a-${id} · ${answer.split('\n')[0]}`);
  // The issue the question was about carries the answer too, so reading the issue is enough.
  const issue = ask.issue ? findIssue(root, ask.issue) : null;
  if (issue) appendRuling(root, [issue], `Ruling ask-${id}${ask.kind ? ` (${ask.kind})` : ''}: ${answer.split('\n')[0]}`);
  return { id, answer, ...(issue ? { issue: issue.id } : {}) };
}

// A ruling written into issues' Evidence, after what is there, with one log line each. The status is left
// alone: a ruling may settle the question and still leave work, and done keeps its own preconditions.
function appendRuling(root, issues, line) {
  for (const issue of issues) {
    const text = readFileSync(issue.file, 'utf8');
    const current = (parseIssue(text, issue.file).sections.evidence || '').trim();
    writeAtomic(issue.file, setSection(text, 'Evidence', current ? `${current}\n\n${line}` : line));
  }
  appendLogLines(root, issues.map((issue) => `${issue.id} evidence · ${line}`));
}

// decide <slug> "<ruling>" [--by who] [--supersedes <slug>] [--settles <ids>]: the ruling, who ruled (the owner
// unless --by says otherwise: jarl for a choice the loop made under a mandate), the earlier ruling it replaces —
// marked **Superseded by:** in place, so a reader of decisions.md, and decisions --live, see it is no longer in
// force — and the issues it settles.
export function cmdDecide(root, slug, ruling, flags = {}) {
  need(slug && ruling, 'decide requires <slug> "<ruling>"');
  need(flags.by === undefined || fieldText(flags.by), '--by needs a value — who ruled: owner, jarl, or a name');
  const by = flags.by !== undefined ? fieldText(flags.by) : 'owner';
  const settles = flags.settles !== undefined ? issuesFor(root, flags.settles) : [];
  appendDecision(root, slug, settles.length ? `${ruling.trim()}\n\n**Settles:** ${settles.map((i) => i.id).join(', ')}` : ruling, { by, supersedes: flags.supersedes });
  appendLog(root, `decided ${slug} · by ${by}${flags.supersedes !== undefined ? ` · supersedes ${flags.supersedes}` : ''}`);
  if (settles.length) appendRuling(root, settles, `Ruling ${slug}: ${ruling.trim().split('\n')[0]}`);
  return { slug, by, supersedes: flags.supersedes ?? null, settles: settles.map((i) => i.id) };
}

// decisions [--live]: the rulings, oldest first, each with who ruled and what superseded it; --live leaves out
// the superseded ones — what a session reads at boot as the rulings in force.
export function cmdDecisions(root, flags = {}) {
  const all = loadDecisions(root);
  return flags.live ? all.filter((d) => !d.supersededBy) : all;
}

function handoffPath(root) { return join(jarlDir(root), 'handoff.md'); }

// The mechanical parts of a handoff — what is in flight, what waits, what the user is asked, what awaits
// ratification — are read from the issues and the asks. write records them as a snapshot; read computes them
// again, live, and keeps only the authored parts (the summary, next, anything else written by hand).
function handoffLive(root) {
  const issues = loadIssues(root);
  const byId = new Map(issues.map((i) => [i.id, i]));
  const lease = (i) => [i.fields.branch && `branch ${i.fields.branch}`, i.fields.worker && `worker ${i.fields.worker}`, i.fields.since && `since ${i.fields.since}`].filter(Boolean).join(' · ');
  const inFlight = issues.filter((i) => i.status === 'in-progress').map((i) => { const w = waitingOn(i, byId); const l = lease(i); return `${i.id} ${i.title}${w.length ? ` (waits on ${w.join(', ')})` : ''}${l ? ` · ${l}` : ''}`; });
  const waiting = issues.filter((i) => i.status === 'open' && waitingOn(i, byId).length).map((i) => `${i.id} ${i.title} (after ${waitingOn(i, byId).join(', ')})`);
  const asks = loadAsks(root).filter((a) => a.state === 'open');
  const open = asks.filter((a) => a.kind !== 'ratify').map((a) => `a-${a.id} ${a.question}`);
  const ratify = asks.filter((a) => a.kind === 'ratify').map((a) => `a-${a.id}${a.issue ? ` (issue ${a.issue})` : ''} ${a.question}`);
  return { issues, inFlight, waiting, open, ratify };
}
const list = (xs, none = '- (nothing)') => xs.map((x) => `- ${x}`).join('\n') || none;
function headOf(dir) { return `${git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']) || '?'}@${git(dir, ['rev-parse', '--short', 'HEAD']) || '?'}`; }

export function cmdHandoffWrite(root, flags) {
  need(typeof flags.summary === 'string' && flags.summary, 'handoff write requires --summary "<s>"');
  const { issues, inFlight, open, ratify } = handoffLive(root);
  const next = [].concat(flags.next || []).filter(Boolean);
  // Where each other repository an unfinished issue names stands, beside the loop's own head: in a
  // loop whose workers change another repository, that head is the one the next session resumes from.
  const repos = [...new Set(issues.filter((i) => i.status === 'open' || i.status === 'in-progress').flatMap(reposNamed))];
  const heads = repos.map((r) => ` · **Head in ${r}:** ${headOf(resolve(root, r))}`).join('');
  const text = `# Handoff\n\n**At:** ${stamp()} · **Head:** ${headOf(root)}${heads}\n\n## Summary\n${flags.summary}\n\n## In flight\n${list(inFlight)}\n\n## Waiting on the user\n${list(open)}\n\n${ratify.length ? `## Decided under mandate, awaiting ratification\n${list(ratify)}\n\n` : ''}## Next\n${list(next, '- (nothing recorded)')}\n`;
  writeAtomic(handoffPath(root), text);
  appendLog(root, `handoff · ${flags.summary.split('\n')[0]}`);
  const files = uncommittedLoopFiles(root);
  return { path: handoffPath(root), inFlight: inFlight.length, waiting: open.length, ratify: ratify.length, uncommitted: files === null ? null : files.length };
}

// How old the handoff is, against the clock and against the loop's last log line: stale when the loop moved
// on for more than HANDOFF_STALE_MS after it was written. Null when there is no handoff.
export function handoffAge(root, lastActivity, now = Date.now()) {
  if (!existsSync(handoffPath(root))) return null;
  const text = readFileSync(handoffPath(root), 'utf8');
  const at = /^\*\*At:\*\* (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/m.exec(text)?.[1] || null;
  const atMs = parseStamp(at);
  if (atMs === null) return { at: null, ageMs: null, staleByMs: null, stale: false };
  const last = parseStamp(lastActivity);
  const staleByMs = last !== null && last - atMs > HANDOFF_STALE_MS ? last - atMs : 0;
  return { at, ageMs: now - atMs, staleByMs, stale: staleByMs > 0 };
}

const LIVE_SECTIONS = new Set(['in flight', 'waiting on the user', 'decided under mandate, awaiting ratification', 'waiting (after not settled)']);

export function cmdHandoffRead(root) {
  if (!existsSync(handoffPath(root))) return { text: 'fresh start — no handoff recorded', handoff: null };
  const written = readFileSync(handoffPath(root), 'utf8');
  // The authored parts, as written: the header line and every section the tool does not compute.
  const lines = written.split('\n');
  const header = lines.find((l) => l.startsWith('**At:**')) || '';
  const sections = [];
  for (const l of lines) {
    const h = /^##\s+(.*)$/.exec(l);
    if (h) { sections.push({ name: h[1].trim(), body: [] }); continue; }
    if (sections.length) sections[sections.length - 1].body.push(l);
  }
  const authored = sections.filter((x) => !LIVE_SECTIONS.has(x.name.toLowerCase()));
  const summary = authored.filter((x) => x.name.toLowerCase() === 'summary');
  const rest = authored.filter((x) => x.name.toLowerCase() !== 'summary');
  const show = (x) => `## ${x.name}\n${x.body.join('\n').trim()}\n`;
  // The age: against the clock, and what happened in the log since it was written.
  const logPath = join(jarlDir(root), 'log.md');
  const logLines = existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').map((l) => /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) · (.*)$/.exec(l)).filter(Boolean) : [];
  const last = logLines.length ? logLines[logLines.length - 1][1] : null;
  const age = handoffAge(root, last);
  const atMs = parseStamp(age?.at);
  // What came after the handoff: the lines after its own `handoff · ` line (the last one stamped with its At);
  // a handoff with no such line (edited by hand, or from elsewhere) falls back to the lines stamped later.
  let own = -1;
  logLines.forEach((m, n) => { if (m[1] === age?.at && m[2].startsWith('handoff · ')) own = n; });
  const since = own >= 0 ? logLines.slice(own + 1) : atMs === null ? [] : logLines.filter((m) => parseStamp(m[1]) > atMs);
  const changed = new Set(since.map((m) => /^(?:filed |asked |answered )?(\d{3})\b/.exec(m[2])?.[1]).filter(Boolean));
  // The heads it recorded against where they stand now.
  const moved = [];
  const recorded = /\*\*Head:\*\* (\S+)/.exec(header)?.[1];
  if (recorded && git(root, ['rev-parse', '--git-dir']) !== null && headOf(root) !== recorded) moved.push(`. (${recorded} → ${headOf(root)})`);
  for (const m of header.matchAll(/\*\*Head in (.+?):\*\* (\S+)/g)) {
    const dir = resolve(root, m[1]);
    if (existsSync(dir) && git(dir, ['rev-parse', '--git-dir']) !== null && headOf(dir) !== m[2]) moved.push(`${m[1]} (${m[2]} → ${headOf(dir)})`);
  }
  const files = uncommittedLoopFiles(root);
  const ageLine = age && age.at
    ? `written ${ago(age.ageMs)} ago${age.stale ? ` · STALE by ${ago(age.staleByMs)}: last activity ${last}` : ''} · ${since.length} log line(s) and ${changed.size} issue(s) changed since${moved.length ? ` · heads moved: ${moved.join(', ')}` : ''}${files && files.length ? ` · ${files.length} loop file(s) not committed` : ''}`
    : 'written at an unknown time (no **At:** line)';
  // In flight, the waits, the questions and the ratify items below are read now, not copied from the file.
  const { inFlight, waiting, open, ratify } = handoffLive(root);
  const text = [`# Handoff`, '', header, ageLine, '', ...summary.map(show),
    `## In flight\n${list(inFlight)}\n`,
    ...(waiting.length ? [`## Waiting (After not settled)\n${list(waiting)}\n`] : []),
    `## Waiting on the user\n${list(open)}\n`,
    ...(ratify.length ? [`## Decided under mandate, awaiting ratification\n${list(ratify)}\n`] : []),
    ...rest.map(show)].join('\n');
  return { text, handoff: { ...age, logLinesSince: since.length, issuesChangedSince: changed.size, headsMoved: moved, inFlight: inFlight.length, waiting: open.length, ratify: ratify.length, uncommitted: files === null ? null : files.length } };
}

// The reason an issue was dropped or deferred: the last "Dropped: ..." / "Deferred: ..." line of its Evidence,
// whatever notes were written before it. Evidence with no such line (an older file) is read whole.
function statusReason(evidence, word) {
  const text = (evidence || '').trim();
  const last = [...text.matchAll(new RegExp(`^${word}:\\s*(.*)$`, 'gm'))].pop();
  return last ? last[1].trim() : text;
}

// The repository an issue's work counts under in the report: the directory name of each repository it names,
// or the loop's own.
function repoNames(root, issue) {
  const named = reposNamed(issue);
  return named.length ? [...new Set(named.map((n) => basename(topOf(canonical(resolve(root, n))))))] : [basename(topOf(root))];
}

// report [--found]: done (per repository when the done work spans more than one — an issue naming several is
// listed under each, for each repository's changelog), dropped, deferred, still open, and who reviewed the done
// work; --found adds the issues someone other than the jarl found.
export function cmdReport(root, flags = {}) {
  const issues = loadIssues(root);
  const done = issues.filter((i) => i.status === 'done');
  const dropped = issues.filter((i) => i.status === 'dropped');
  const deferred = issues.filter((i) => i.status === 'deferred');
  const left = issues.filter((i) => i.status === 'open' || i.status === 'in-progress');
  const found = issues.filter((i) => i.fields['found by'] && !/^jarl\b/i.test(i.fields['found by']));
  const goal = existsSync(join(jarlDir(root), 'goal.md')) ? readFileSync(join(jarlDir(root), 'goal.md'), 'utf8').split('\n').slice(2).find((l) => l.trim()) || '' : '';
  const byRepo = {};
  for (const i of done) for (const r of repoNames(root, i)) (byRepo[r] = byRepo[r] || []).push(i);
  const row = (i) => `- ${i.id} ${i.title} (${i.kind})${mergedOf(i) ? ` · merged ${mergedOf(i).sha}${mergedOf(i).repo ? ` in ${mergedOf(i).repo}` : ''}` : ''}`;
  const repos = Object.keys(byRepo).sort();
  const doneLines = repos.length > 1 ? repos.flatMap((r) => ['', `### ${r} (${byRepo[r].length})`, ...byRepo[r].map(row)]) : done.map(row);
  const journal = journalById(root);
  const split = reviewSplit(root, issues, journal);
  // One row per issue, for a host that renders its own dashboard from --json: the same fields a reader of the
  // issue would look up, with the last approve (who, which kind, when).
  const rows = issues.map((i) => {
    const m = mergedOf(i);
    const a = gateState(root, i.id, journal.get(i.id) || []).lastApprove;
    return { id: i.id, title: i.title, status: i.status, kind: i.kind, priority: i.priority, tier: i.tier, tags: i.tags, repos: repoNames(root, i), branch: i.fields.branch || null, after: i.after, sources: i.sources, merged: m ? m.sha : null, ci: m ? m.ci : null, review: a ? { by: a.by, kind: a.kind, at: a.at } : null };
  });
  const lines = [`# Report`, '', goal, '', `## Done (${done.length})`, ...(done.length ? [`Reviewed by: ${renderSplit(split)}`] : []), ...doneLines,
    '', `## Dropped (${dropped.length})`, ...dropped.map((i) => `- ${i.id} ${i.title} — ${statusReason(i.sections.evidence, 'Dropped')}`),
    '', `## Deferred (${deferred.length})`, ...deferred.map((i) => `- ${i.id} ${i.title} — ${statusReason(i.sections.evidence, 'Deferred')}`),
    '', `## Still open (${left.length})`, ...left.map((i) => `- ${i.id} ${i.title} (${i.status})`),
    ...(flags.found ? ['', `## Found along the way (${found.length})`, ...found.map((i) => `- ${i.id} ${i.title} — ${i.fields['found by']}`)] : [])];
  return { done: done.length, dropped: dropped.length, deferred: deferred.length, left: left.length, found: found.length, reviews: split,
    byRepo: Object.fromEntries(repos.map((r) => [r, byRepo[r].map((i) => i.id)])), issues: rows, text: lines.join('\n') + '\n' };
}

// ---- research findings into issues ----------------------------------------------------------------

// A research round leaves a findings.json beside its report. import turns each finding into one issue whose
// **Source:** is <report dir>#<finding id>: the report directory is dated, so the pair names that finding for
// good, and a re-run skips every finding whose Source an issue already carries. The mapping (SKILL.md, "From
// research to issues") reads three shapes: a flat array of findings; an array of angles, each with its
// surviving findings under `surviving`; and { results: [{ area, kept: [...] }] }. A finding without an id
// cannot be keyed, so the file is refused whole.
const KIND_OF = { defect: 'bug', inconsistency: 'bug', risk: 'gap', opportunity: 'gap' };
const PRIO_OF = { blocker: '1', critical: '1', high: '1', medium: '2', major: '2', important: '2', low: '3', minor: '3' };

export function findingsOf(json) {
  let list;
  // In the angles shape an id is unique only inside its angle (two angles may each have an F1), so the key
  // is <angle>/<id> there, always — never only when two collide, which would change a key once a later
  // edit of the file added a twin.
  if (Array.isArray(json) && json.some((x) => x && Array.isArray(x.surviving))) {
    list = json.flatMap((x) => (x.surviving || []).map((f) => (f && f.id !== undefined && x.angle ? { ...f, id: `${slugify(String(x.angle))}/${f.id}`, localId: String(f.id), angle: slugify(String(x.angle)) } : f)));
  } else if (Array.isArray(json)) list = json;
  else if (json && Array.isArray(json.results)) list = json.results.flatMap((r) => r.kept || []);
  else if (json && Array.isArray(json.findings)) list = json.findings;
  else throw new Error('not a findings file this tool reads: expected an array of findings, an array of angles with `surviving`, or { results: [{ kept }] } — see SKILL.md, "From research to issues"');
  const seen = new Set();
  const out = list.map((f, n) => {
    need(f && typeof f === 'object' && (typeof f.id === 'string' || typeof f.id === 'number') && String(f.id).trim(), `finding #${n + 1} has no id — every finding needs one to be filed once and only once; nothing was filed`);
    const id = String(f.id).trim();
    need(!/[\s,#]/.test(id), `finding id "${id}" holds a space, a comma or a # — it cannot be a Source key; nothing was filed`);
    need(!seen.has(id), `finding id ${id} appears twice in the file; nothing was filed`);
    seen.add(id);
    const claim = typeof f.claim === 'string' ? f.claim : '';
    const title = String(f.title || claim.split(/(?<=[.!?])\s/)[0] || id).replace(/\s+/g, ' ').trim();
    const kindRaw = String(f.kind || '').toLowerCase();
    const prioRaw = String(f.priority ?? f.severity ?? '').toLowerCase();
    const why = [f.impact, f.adopter_impact].filter((x) => typeof x === 'string' && x.trim()).join('\n\n');
    const proposal = [f.proposal, f.suggested_fix, f.fix].find((x) => typeof x === 'string' && x.trim());
    return {
      id,
      localId: f.localId || id,
      angle: f.angle || null,
      title: title.length > 140 ? `${title.slice(0, 139)}…` : title,
      kind: KINDS.includes(kindRaw) ? kindRaw : (KIND_OF[kindRaw] || 'bug'),
      priority: PRIORITIES.includes(prioRaw) ? prioRaw : (PRIO_OF[prioRaw] || '2'),
      where: String(f.where || f.surfaces || ''),
      what: [claim && `Claim: ${claim}`, typeof f.truth === 'string' && f.truth && `Truth: ${f.truth}`, typeof f.evidence === 'string' ? f.evidence : ''].filter(Boolean).join('\n\n'),
      why: [why, f.effort && `Effort (the finding's estimate): ${f.effort}`].filter(Boolean).join('\n\n'),
      acceptance: proposal ? `${PROPOSED} — make it checkable before a worker starts: ${proposal}` : '',
    };
  });
  return out;
}

// The report directory a findings file belongs to, as its Source spells it: the path from the root of the
// repository holding it (core/research/2026-09-25-jarl), so every loop that imports it writes the same key;
// the directory's own name outside a repository.
export function reportDirOf(file) {
  const dir = dirname(resolve(file));
  const top = git(dir, ['rev-parse', '--show-toplevel']);
  const rel = top ? relative(canonical(top), canonical(dir)).split('\\').join('/') : '';
  return rel && !rel.startsWith('..') ? rel : basename(dir);
}

function readFindings(file, flags = {}) {
  need(file, 'a findings file is required: jarl.mjs import <findings.json>');
  need(existsSync(file), `no such file: ${file}`);
  let json;
  try { json = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${file} is not JSON: ${e.message}`); }
  const dir = flags.source !== undefined ? String(flags.source).replace(/\/+$/, '') : reportDirOf(file);
  need(dir && !/[\s,#]/.test(dir), `--source is the report directory alone, with no space, comma or # in it (got "${dir}")`);
  return { dir, findings: findingsOf(json) };
}

// An issue filed before Source existed often names its finding. That issue is found, never guessed at, and
// mainly where an issue says what it is about: its title and its What, Why and Acceptance — never a header
// field (`**Priority:** 2` is not finding 2). Evidence (notes about other work, too) counts only under the
// strict rule in inEvidence below. An id that reads as unique
// on its own (jarl-2-B2: a dash, and at least 8 characters) is enough by itself. A short one (F1, C1, 2) or one
// from the angles shape needs its report named in the same issue too: the report directory's name, or the
// <angle>/<id> key. A title naming the finding wins, else the one issue whose body does; two candidates are
// reported as ambiguous and left alone.
function uniqueLooking(id) { return id.includes('-') && id.length >= 8; }
function tokenRe(s) { return new RegExp(`(^|[^A-Za-z0-9-])${s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^A-Za-z0-9-]|$)`); }
function mentionOf(issues, finding, dir) {
  const own = tokenRe(finding.id);
  const bare = tokenRe(finding.localId);
  const report = tokenRe(basename(dir));
  const named = (text) => {
    if (own.test(text) && finding.id !== finding.localId) return true;   // <angle>/<id> written out
    if (!bare.test(text)) return false;
    return !finding.angle && uniqueLooking(finding.localId);
  };
  const namedWithReport = (text) => named(text) || (bare.test(text) && report.test(text));
  const legacy = issues.filter((i) => i.fields.source === undefined);
  const bodyOf = (i) => [i.title, i.sections.what, i.sections.why, i.sections.acceptance].filter(Boolean).join('\n');
  const byTitle = legacy.filter((i) => named(i.title) || (bare.test(i.title) && report.test(bodyOf(i))));
  if (byTitle.length === 1) return { issue: byTitle[0] };
  if (byTitle.length > 1) return { ambiguous: byTitle.map((i) => i.id) };
  // Evidence counts under the strictest rule only: an id that reads as unique on its own, on an Evidence line
  // that also names the report (a package issue's "Source: <report dir>/report.md … Ids: a-b-01, a-b-02").
  const inEvidence = (i) => !finding.angle && uniqueLooking(finding.localId)
    && (i.sections.evidence || '').split('\n').some((l) => bare.test(l) && report.test(l));
  const byBody = legacy.filter((i) => namedWithReport(bodyOf(i)) || inEvidence(i));
  if (byBody.length === 1) return { issue: byBody[0] };
  return byBody.length ? { ambiguous: byBody.map((i) => i.id) } : {};
}

function bySource(issues) {
  const map = new Map();
  for (const i of issues) for (const s of i.sources) map.set(s, [...(map.get(s) || []), i]);
  return map;
}

export function cmdImport(root, file, flags) {
  needLiveLoop(root, ' — run: jarl.mjs init "<goal>"');
  const { dir, findings } = readFindings(file, flags);
  if (flags.kind !== undefined) need(KINDS.includes(flags.kind), `--kind must be one of: ${KINDS.join(', ')}`);
  if (flags.prio !== undefined) need(PRIORITIES.includes(String(flags.prio)), '--prio must be 1, 2 or 3');
  if (flags.tier !== undefined) need(TIERS.includes(String(flags.tier)), `--tier must be one of: ${TIERS.join(', ')}`);
  if (flags.repo !== undefined) repoList(root, flags.repo);
  let chosen = findings;
  if (flags.only !== undefined) {
    const only = splitList(flags.only);
    const unknown = only.filter((id) => !findings.some((f) => f.id === id));
    need(unknown.length === 0, `not in ${file}: ${unknown.join(', ')}`);
    chosen = findings.filter((f) => only.includes(f.id));
  }
  const issues = loadIssues(root);
  const filedAs = bySource(issues);
  const out = { source: dir, findings: findings.length, considered: chosen.length, filed: [], already: [], adopted: [], mentioned: [], ambiguous: [], dryRun: flags['dry-run'] === true };
  const toFile = [];
  for (const f of chosen) {
    const key = `${dir}#${f.id}`;
    if (filedAs.has(key)) { out.already.push({ finding: f.id, issues: filedAs.get(key).map((i) => i.id) }); continue; }
    const m = mentionOf(issues, f, dir);
    if (m.ambiguous) { out.ambiguous.push({ finding: f.id, issues: m.ambiguous }); continue; }
    if (m.issue) {
      if (flags.adopt === true) out.adopted.push({ finding: f.id, issue: m.issue.id, key });
      else out.mentioned.push({ finding: f.id, issue: m.issue.id });
      continue;
    }
    toFile.push({ f, key });
  }
  if (out.dryRun) {
    out.filed = toFile.map(({ f, key }) => ({ id: null, finding: f.id, source: key, title: f.title, kind: flags.kind || f.kind, priority: String(flags.prio || f.priority) }));
    return out;
  }
  // One older issue may name several findings (a package of minor ones): its Source gets all of them, once.
  const adopt = new Map();
  for (const a of out.adopted) adopt.set(a.issue, [...(adopt.get(a.issue) || []), a.key]);
  for (const [id, keys] of adopt) cmdSource(root, id, [...(findIssue(root, id).sources), ...keys].join(','));
  for (const { f, key } of toFile) {
    const r = cmdNew(root, f.title, {
      kind: flags.kind || f.kind, prio: flags.prio || f.priority, tier: flags.tier, tags: flags.tags, repo: flags.repo,
      'found-by': flags['found-by'] || `research ${dir}`, where: f.where, what: f.what, why: f.why, acceptance: f.acceptance || undefined, source: key,
    });
    out.filed.push({ id: r.id, finding: f.id, source: key, title: f.title, kind: flags.kind || f.kind, priority: String(flags.prio || f.priority) });
  }
  appendLog(root, `imported ${dir} · ${out.filed.length} filed, ${out.already.length} already filed${out.adopted.length ? `, ${out.adopted.length} adopted` : ''}${out.mentioned.length ? `, ${out.mentioned.length} named by an issue without Source` : ''}${out.ambiguous.length ? `, ${out.ambiguous.length} ambiguous` : ''}`);
  return out;
}

// sources — per report: its findings, the issues filed from them and where those stand. With findings files,
// every finding in them is listed, the unfiled ones too; without, only what the issues' Source fields name.
export function cmdSources(root, files, flags = {}) {
  const issues = loadIssues(root);
  const filedAs = bySource(issues);
  const reports = new Map();   // dir -> ordered finding ids
  const add = (dir, id) => { if (!reports.has(dir)) reports.set(dir, []); if (!reports.get(dir).includes(id)) reports.get(dir).push(id); };
  need(files.length <= 1 || flags.source === undefined, '--source names one report directory: give one findings file with it');
  const mentionKey = new Map();
  for (const file of files) { const { dir, findings } = readFindings(file, flags); findings.forEach((f) => { add(dir, f.id); mentionKey.set(`${dir}#${f.id}`, f); }); }
  for (const key of filedAs.keys()) { const at = key.indexOf('#'); add(key.slice(0, at), key.slice(at + 1)); }
  const fromFile = new Set();
  for (const file of files) fromFile.add(readFindings(file, flags).dir);
  return [...reports.entries()].map(([dir, ids]) => {
    const rows = ids.map((id) => {
      const on = filedAs.get(`${dir}#${id}`) || [];
      if (on.length) return { finding: id, issues: on.map((i) => ({ id: i.id, status: i.status })) };
      const m = mentionKey.has(`${dir}#${id}`) ? mentionOf(issues, mentionKey.get(`${dir}#${id}`), dir) : {};
      return { finding: id, issues: [], ...(m.issue ? { mentionedBy: [m.issue.id] } : m.ambiguous ? { mentionedBy: m.ambiguous } : {}) };
    });
    const distinct = [...new Map(rows.flatMap((r) => r.issues).map((i) => [i.id, i])).values()];
    const byStatus = {};
    for (const i of distinct) byStatus[i.status] = (byStatus[i.status] || 0) + 1;
    return {
      source: dir, findings: fromFile.has(dir) ? ids.length : null, filed: rows.filter((r) => r.issues.length).length,
      mentioned: rows.filter((r) => !r.issues.length && r.mentionedBy).length, unfiled: rows.filter((r) => !r.issues.length && !r.mentionedBy).length,
      issues: byStatus, rows,
    };
  });
}

// ---- main --------------------------------------------------------------------------------------

// Every flag a command accepts, and what it takes: 'bool' takes no value, 'value' takes exactly one,
// 'many' may repeat (one value each time). A value flag always consumes the next argument, whatever it
// starts with — `--ran "--help"` records a row whose command is --help — or takes it inline as
// --flag=value. A bare `--` ends the flags: everything after it is positional, so a free-text note or
// a title that starts with -- goes there. A flag the command does not know is an error that names the
// ones it does, never silently dropped.
const GLOBAL_FLAGS = { json: 'bool', help: 'bool', root: 'value' };
export const COMMAND_FLAGS = {
  init: { committed: 'bool', permanent: 'bool' },
  new: {
    kind: 'value', prio: 'value', tier: 'value', tags: 'value', files: 'value', repo: 'value', 'found-by': 'value',
    where: 'value', what: 'value', why: 'value', acceptance: 'many', source: 'value', after: 'value', changelog: 'many', template: 'value',
  },
  body: { where: 'value', what: 'value', why: 'value', acceptance: 'many', changelog: 'many' },
  import: {
    source: 'value', kind: 'value', prio: 'value', tier: 'value', tags: 'value', repo: 'value', 'found-by': 'value',
    only: 'value', adopt: 'bool', 'dry-run': 'bool',
  },
  sources: { source: 'value' },
  source: {},
  after: { clear: 'bool' },
  evidence: { ran: 'many', saw: 'many' },
  list: { status: 'value', kind: 'value', tag: 'value', prio: 'value', grep: 'value', all: 'bool' },
  show: {}, set: { branch: 'value', worker: 'value', worktree: 'value' }, tag: {}, prio: {}, files: {},
  repo: { clear: 'bool' },
  next: { limit: 'value' },
  review: { by: 'value' }, round: {},
  check: { branch: 'value', base: 'value', repo: 'value' },
  branches: { base: 'value', repo: 'value', 'stale-hours': 'value' },
  merged: { sha: 'value', ci: 'value', repo: 'value' },
  ask: { kind: 'value', target: 'value', issue: 'value' },
  answer: {},
  handoff: { summary: 'value', next: 'many' },
  log: {}, decide: { settles: 'value', by: 'value', supersedes: 'value' }, decisions: { live: 'bool' },
  status: { 'stale-hours': 'value', by: 'value' }, archive: {}, report: { found: 'bool' }, tips: {}, mode: {},
  queue: { repo: 'value', base: 'value' }, changelog: { repo: 'value' },
  close: { force: 'bool' },
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
// How many arguments each command reads after its name (tag takes any number of +a -b after the id).
const ARITY = {
  init: 1, new: 1, evidence: 2, list: 0, show: 1, set: 3, prio: 2, files: 2, repo: 2, next: 0, review: 3, round: 2,
  check: 1, branches: 0, ask: 1, answer: 2, handoff: 1, log: 1, decide: 2, decisions: 0, tips: 0, status: 0, archive: 1, report: 0, mode: 1, close: 0,
  body: 1, import: 1, source: 2, after: 2, merged: 1, queue: 0, changelog: 1,
};

function renderStatus(o) {
  const hand = o.handoff && o.handoff.at ? ` · handoff ${ago(o.handoff.ageMs)} old${o.handoff.stale ? ` (stale by ${ago(o.handoff.staleByMs)})` : ''}` : '';
  const head = o.goal ? `goal: ${o.goal}\nopened ${o.opened || '?'} · last activity ${o.lastActivity || '?'}${hand}${o.archived ? ` · ${o.archived} archived loop(s)` : ''}\n` : '';
  const line = `open ${o.ready} · in flight ${o.inFlight}${o.waiting ? ` · waiting ${o.waiting}` : ''} · done ${o.done} · dropped ${o.dropped} · deferred ${o.deferred} · questions ${o.questions}${o.ratify ? ` · to ratify ${o.ratify}` : ''}${o.ciPending.length ? ` · merged, CI pending ${o.ciPending.length}` : ''}${o.ciRed.length ? ` · CI red ${o.ciRed.length}` : ''}`;
  const width = o.by ? Math.max(...Object.keys(o.by.groups).map((k) => k.length), 1) : 0;
  const by = o.by ? [`by ${o.by.key}:`, ...Object.entries(o.by.groups).map(([k, g]) => `  ${k.padEnd(width)}  open ${g.open} · in flight ${g['in-progress']} · done ${g.done} · dropped ${g.dropped} · deferred ${g.deferred}`)] : [];
  const more = [
    ...by,
    ...o.stale.map((x) => `stale ${x.id} · ${x.problems.join('; ')}`),
    ...(o.ciPending.length ? [`merged, CI pending: ${o.ciPending.join(', ')}`] : []),
    ...(o.ciRed.length ? [`merged, CI red: ${o.ciRed.join(', ')}`] : []),
    ...(o.done ? [`done reviewed by: ${renderSplit(o.reviews)}`] : []),
    ...(o.uncommitted ? [`${o.uncommitted} loop file(s) not committed — commit .jarl/ in the loop's repository`] : []),
    ...o.toRatify.map((a) => `ratify a-${a.id}${a.issue ? ` (issue ${a.issue})` : ''} · ${a.question}`),
    ...(o.waiting ? [`waiting (After not settled): ${o.waitingIds.join(', ')}`] : []),
    ...(o.noAcceptance.length ? [`in flight with no acceptance line: ${o.noAcceptance.join(', ')}`] : []),
  ];
  return `${head}${line}${more.length ? `\n${more.join('\n')}` : ''}`;
}

function renderImport(o) {
  const head = `${o.source}: ${o.findings} finding(s)${o.considered !== o.findings ? `, ${o.considered} chosen` : ''} · ${o.dryRun ? 'would file' : 'filed'} ${o.filed.length} · already filed ${o.already.length}${o.adopted.length ? ` · adopted ${o.adopted.length}` : ''}${o.mentioned.length ? ` · named by an issue without Source ${o.mentioned.length} (--adopt links them)` : ''}${o.ambiguous.length ? ` · ambiguous ${o.ambiguous.length}` : ''}`;
  const rows = [
    ...o.filed.map((f) => `${o.dryRun ? 'would file' : `filed ${f.id}`} · ${f.finding} · ${f.kind} P${f.priority} · ${f.title}`),
    ...o.adopted.map((a) => `adopted ${a.issue} · ${a.finding}`),
    ...o.mentioned.map((m) => `named by ${m.issue} · ${m.finding}`),
    ...o.ambiguous.map((m) => `ambiguous · ${m.finding} · named by ${m.issues.join(', ')}`),
  ];
  return [head, ...rows].join('\n');
}

function renderSources(reports) {
  if (!reports.length) return '(no issue carries a Source, and no findings file was given)';
  return reports.map((r) => {
    const st = Object.entries(r.issues).map(([k, v]) => `${k} ${v}`).join(', ');
    const head = `${r.source} · ${r.findings === null ? '' : `${r.findings} finding(s) · `}${r.filed} filed${r.mentioned ? ` · ${r.mentioned} named by an issue without Source` : ''}${r.findings === null ? '' : ` · ${r.unfiled} unfiled`}${st ? ` · issues: ${st}` : ''}`;
    const rows = r.rows.map((x) => `  ${x.finding}  ${x.issues.length ? x.issues.map((i) => `${i.id} ${i.status}`).join(', ') : x.mentionedBy ? `named by ${x.mentionedBy.join(', ')} (no Source)` : 'unfiled'}`);
    return [head, ...rows].join('\n');
  }).join('\n\n');
}

function renderList(rows) {
  if (rows.length === 0) return '(none)';
  return rows.map((i) => `${i.id}  P${i.priority}  ${i.status.padEnd(11)} ${i.kind.padEnd(8)} ${i.title}${i.tags.length ? `  [${i.tags.join(', ')}]` : ''}`).join('\n');
}

// The commands that write: each runs under .jarl/.lock (see withLock).
const MUTATING = new Set(['init', 'new', 'body', 'import', 'source', 'after', 'set', 'merged', 'tag', 'prio', 'files', 'repo', 'evidence', 'review', 'round', 'ask', 'answer', 'handoff', 'log', 'decide', 'archive', 'mode', 'close']);

function main() {
  let parsed;
  try { parsed = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
  const { positional, flags } = parsed;
  const [cmd, ...rest] = positional;
  if (!cmd || flags.help) { console.log(USAGE); process.exit(cmd ? 0 : 1); }
  const root = flags.root ? resolve(flags.root) : findRoot();
  let out;
  let text;
  let warn = [];   // said on stderr, so a caller reading stdout sees the same lines as before
  const each = (o, f) => [].concat(o).map(f).join('\n');
  const writes = MUTATING.has(cmd) && !(cmd === 'handoff' && rest[0] !== 'write');
  try {
    (writes ? (fn) => withLock(root, fn) : (fn) => fn())(() => {
    switch (cmd) {
      case 'init': out = cmdInit(root, rest[0], flags); text = `opened ${out.dir} · ${out.permanent ? 'permanent record, no branch' : out.committed ? 'committed with the work' : 'kept out of git'}`; break;
      case 'new': out = cmdNew(root, rest[0], flags); text = `filed ${out.id} · ${out.file}`; break;
      case 'body': out = cmdBody(root, rest[0], flags); text = `${out.id} body: ${out.set.join(', ')}`; break;
      case 'source': out = cmdSource(root, rest[0], rest[1]); text = `${out.id} source: ${out.sources.join(', ')}`; break;
      case 'after': out = cmdAfter(root, rest[0], rest[1], { clear: flags.clear === true }); text = `${out.id} after: ${out.cleared ? 'cleared' : out.after.join(', ')}`; break;
      case 'import': out = cmdImport(root, rest[0], flags); text = renderImport(out); break;
      case 'sources': out = cmdSources(root, rest, flags); text = renderSources(out); break;
      case 'list': out = cmdList(root, flags); text = renderList(out); break;
      case 'show': { const i = findIssue(root, rest[0]); need(i, `no such issue: ${rest[0]}`); out = i; text = readFileSync(i.file, 'utf8'); break; }
      case 'set': out = cmdSet(root, rest[0], rest[1], rest[2], flags); text = each(out, (o) => `${o.id} → ${o.status}${o.branch ? ` · ${o.branch}` : ''}${o.worker ? ` · ${o.worker}` : ''}`); warn = [].concat(out).filter((o) => o.note).map((o) => `note: ${o.id} ${o.note}`); break;
      case 'tag': out = cmdTag(root, rest[0], rest.slice(1)); text = each(out, (o) => `${o.id} tags: ${o.tags.join(', ') || '(none)'}`); break;
      case 'prio': out = cmdPrio(root, rest[0], rest[1]); text = each(out, (o) => `${o.id} priority ${o.priority}`); break;
      case 'files': out = cmdFiles(root, rest[0], rest[1]); text = `${out.id} files: ${out.files.join(', ') || '(none)'}`; break;
      case 'repo': out = cmdRepo(root, rest[0], rest[1], { clear: flags.clear === true }); text = `${out.id} repo: ${out.cleared ? 'cleared' : out.repo}`; break;
      case 'evidence': out = cmdEvidence(root, rest[0], rest[1], flags); text = each(out, (o) => (o.rows ? `${o.id} evidence row${o.rows.length > 1 ? 's' : ''} recorded` : `${o.id} evidence recorded`)); break;
      case 'next': out = cmdNext(root, flags); text = out.length ? out.map((r) => (r.ready ? `${r.id}  P${r.priority}  ${r.title}${r.noAcceptance ? '  (no acceptance yet)' : ''}` : r.after.length ? `${r.id}  P${r.priority}  ${r.title}  (after ${r.after.join(', ')})` : `${r.id}  P${r.priority}  ${r.title}  (waits on ${r.waitsOn.join(', ')})`)).join('\n') : '(nothing open)'; break;
      case 'review': out = cmdReview(root, rest[0], rest[1], rest[2], flags); text = each(out, (o) => `${o.id} review ${o.verdict}${o.by ? ` by ${o.by} (${o.kind})` : ''} · acceptance: ${o.acceptance ? o.acceptance.split('\n').join(' / ') : '(none on file)'}`); break;
      case 'round': out = cmdRound(root, rest[0], rest[1]); text = out.takeover ? `${out.id} round ${out.round} — takeover:\n\n${out.block}` : `${out.id} round ${out.round} of ${ROUNDS_BEFORE_TAKEOVER} before a takeover`; break;
      case 'merged': out = cmdMerged(root, rest[0], flags); text = `${out.ids.join(', ')} ${out.sha ? `merged ${out.sha}` : 'merge'} · CI ${out.ci}`; warn = out.notes.map((n) => `note: ${n}`); break;
      case 'check': out = cmdCheck(root, rest[0], flags); text = `${out.id === null ? `package ${out.ids.join(', ')} on ${out.branch}\n` : ''}${out.repo === root ? '' : `in ${out.repo}\n`}${out.items.map((i) => `${i.ok ? '✓' : '✗'} ${i.name} — ${i.note}`).join('\n')}`; break;
      case 'branches': out = cmdBranches(root, flags); text = out.length ? out.map((b) => `${b.repo !== basename(root) ? `[${b.repo}] ` : ''}${b.branch}${b.issues.length ? ` → ${b.issues.join(', ')}` : ''}  ${b.missing ? 'GONE' : `+${b.ahead ?? '?'}  ${b.worktree ? `${b.worktree}${b.worktreeGone ? ' (gone)' : b.dirty ? ` (${b.dirty} uncommitted)` : ' (clean)'}` : '(no worktree)'}`}${b.unnamed ? '  UNNAMED — rename to jarl/NNN-slug before merging' : ''}${{ delete: '  DONE → delete', dirty: '  DONE (worktree dirty)', unverified: '  DONE (merged by record, branch not in base) — verify' }[b.done] || ''}${b.stale.length ? `  STALE: ${b.stale.join('; ')}` : ''}`).join('\n') : '(no worker branches)'; break;
      case 'ask': out = cmdAsk(root, rest[0], flags); text = out.kind === 'ratify' ? `filed a-${out.id} for ratification · blocks nothing` : `asked a-${out.id}`; break;
      case 'answer': out = cmdAnswer(root, rest[0], rest[1]); text = `answered a-${out.id}${out.issue ? ` · written into ${out.issue}` : ''}`; break;
      case 'handoff': if (rest[0] === 'write') { out = cmdHandoffWrite(root, flags); text = `handoff written · ${out.inFlight} in flight · ${out.waiting} waiting on the user${out.uncommitted ? ` · ${out.uncommitted} loop file(s) not committed` : ''}`; } else { out = cmdHandoffRead(root); text = out.text; } break;
      case 'report': out = cmdReport(root, flags); text = out.text; break;
      case 'log': need(rest[0], 'log requires "<event>"'); appendLog(root, rest[0]); out = { logged: rest[0] }; text = 'logged'; break;
      case 'decide': out = cmdDecide(root, rest[0], rest[1], flags); text = `decided ${out.slug} · by ${out.by}${out.supersedes ? ` · supersedes ${out.supersedes}` : ''}${out.settles.length ? ` · written into ${out.settles.join(', ')}` : ''}`; break;
      case 'decisions': out = cmdDecisions(root, flags); text = out.length ? out.map((d) => `${d.date} · ${d.slug}${d.by ? ` · by ${d.by}` : ''}${d.supersededBy ? ` · SUPERSEDED by ${d.supersededBy}` : ''}${d.supersedes ? ` · supersedes ${d.supersedes}` : ''} — ${(d.ruling.split('\n').find((l) => l.trim()) || '').slice(0, 160)}`).join('\n') : '(no rulings)'; break;
      case 'status': out = cmdStatus(root, flags); text = renderStatus(out); break;
      case 'tips': out = cmdTips(root); text = renderTips(out); break;
      case 'queue': out = cmdQueue(root, flags); text = renderQueue(out); break;
      case 'changelog': out = cmdChangelog(root, rest[0], flags); text = out.text || '(no changelog fragment on these issues)'; warn = out.missing.length ? [`note: no changelog fragment: ${out.missing.join(', ')} — record one with: jarl.mjs body <id> --changelog "Added: …"`] : []; break;
      case 'archive': out = cmdArchive(root, rest[0]); text = `archived → ${out.archived}${out.leftOpen.length ? ` · ${out.leftOpen.length} still open or in progress: ${out.leftOpen.join(', ')}` : ''} · open a new loop with: jarl.mjs init "<goal>"`; break;
      case 'mode': out = cmdMode(root, rest[0]); text = 'now permanent · no longer tied to a feature branch; close keeps the directory'; break;
      case 'close': out = cmdClose(root, flags); text = (out.kept ? `kept ${out.kept} · closed as a permanent record` : `removed ${out.removed}`) + (out.deferred.length ? ` · ${out.deferred.length} deferred still waiting: ${out.deferred.join(', ')}` : '') + (out.uncommitted ? ` · ${out.uncommitted} loop file(s) not committed${out.kept ? ' — commit .jarl/' : ' before the removal'}` : ''); break;
      default: throw new Error(`unknown command: ${cmd}\n${USAGE}`);
    }
    });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  console.log(flags.json ? JSON.stringify(out, null, 2) : text);
  for (const w of warn) console.error(w);
  if (cmd === 'check' && !out.ok) process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
