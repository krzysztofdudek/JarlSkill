// jarl-lib.mjs — the implementation behind jarl.mjs and record.mjs. Internal: its exports are not a contract and
// change without notice. The stable surface other tools may vendor is record.mjs (RECORD_API), and only that;
// the command line is jarl.mjs, a CLI over this module.
//
// Markdown is the source of truth: the loop's goal and decisions, the dated log and one
// .jarl/issues/NNN-slug.md per issue. This module only reads and writes those files, so anything
// it does can be checked by opening them. Zero dependencies, Node 22+.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, realpathSync, statSync, renameSync, openSync, closeSync, writeSync, unlinkSync, linkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve, dirname, basename, relative, isAbsolute } from 'node:path';

// The built-in statuses, kinds and tiers: what a loop with no profile uses (see "the profile" below).
export const STATUSES = ['open', 'in-progress', 'done', 'dropped', 'deferred'];
export const KINDS = ['bug', 'gap', 'cleanup', 'docs', 'test', 'research', 'process'];
export const PRIORITIES = ['1', '2', '3'];
// Weakest first: the order of the list is the order of strength, which is how a loop's model lines rank its models.
export const TIERS = ['light', 'standard', 'strong'];
export const TIER_DEFAULT = 'standard';
export const ASK_KINDS = ['stop', 'stuck', 'lower', 'charter', 'ratify'];
export const CI_STATES = ['pending', 'green', 'red', 'none'];
export const ROUNDS_BEFORE_TAKEOVER = 3;
// A lease (Worker, Worktree, Since on an in-progress issue) whose branch saw no commit for this long is shown
// as idle; --stale-hours on status and branches changes it. It is only ever shown, never acted on.
export const STALE_HOURS = 6;
// A handoff file written more than this before the loop's last log line is read as stale (status --json).
export const HANDOFF_STALE_MS = 60 * 60_000;
// The lease fields: written by set in-progress, removed when the issue leaves in-progress. Branch stays: it
// is where the work was, which branches and check --branch still read after done.
const LEASE_FIELDS = ['Worker', 'Model', 'Worktree', 'Since'];


// ---- git: the one place a process is run ----------------------------------------------------------

// Every process Jarl starts goes through exec: git, and the gh that tips asks about CI. A binary ending in .js, .mjs or
// .cjs is run by process.execPath, so a stub works the same on every OS: Windows runs no shebang script, and no .cmd shim
// without a shell.
function exec(bin, args, opts) {
  return /\.[cm]?js$/i.test(bin) ? execFileSync(process.execPath, [bin, ...args], opts) : execFileSync(bin, args, opts);
}
// What git prints in `root`, trimmed; null when it fails.
function git(root, args) {
  try { return exec('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}
// git run for its result and its refusal: { ok, out } or { ok: false, err } with the first line of what git said.
function gitRun(cwd, args) {
  try { return { ok: true, out: exec('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }; }
  catch (e) { return { ok: false, err: String(e.stderr || e.message).trim().split('\n')[0] }; }
}
// The variables that point git at another repository than the one its working directory is in (git sets them for
// a hook it runs): the loop's repository is always the one its directory is in.
const REPOSITORY_OVERRIDES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_PREFIX', 'GIT_NAMESPACE'];
function gitHere(dir, args) {
  const env = { ...process.env };
  for (const name of REPOSITORY_OVERRIDES) delete env[name];
  try { return exec('git', args, { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}
const runGh = exec;

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
  const common = git(dir, ['rev-parse', '--git-common-dir']);
  if (common === null) return null;
  const commonDir = resolve(dir, common);
  const main = basename(commonDir) === '.git' ? dirname(commonDir) : null;
  // canonical on both sides: git prints C:/x/.git where the path module spells C:\x, and a drive letter's case may differ.
  return main && canonical(main) !== canonical(dir) && existsSync(jarlDir(main)) ? main : null;
}
// The directory holding a loop's record. An archived loop is a directory that holds what this one holds (goal, log,
// issues); readLoop reads either by its directory.
export function jarlDir(root) { return join(root, '.jarl'); }
export function issuesDir(root) { return join(jarlDir(root), 'issues'); }

function today() { return new Date().toISOString().slice(0, 10); }
function stamp() { return new Date().toISOString().replace('T', ' ').slice(0, 16); }

// ---- one writer at a time ------------------------------------------------------------------------

// Workers, reviewers and the merger all write through this tool with the same --root, often at the same
// moment. Every command that writes therefore runs under .jarl/.lock, taken with the exclusive-create flag
// so exactly one process holds it; the owner's pid, host and start time are written inside it. A lock
// whose owner is gone is broken and taken over (see lockIsStale); a caller that cannot get it within
// LOCK_WAIT_MS fails loudly, naming the owner, rather than writing without it. And every file is written
// whole to a temporary file beside it and renamed into place, so a reader that takes no lock (list, show)
// never sees half a file.
export const LOCK_STALE_MS = 30_000;          // a lock from another host, or one whose owner cannot be read
export const LOCK_REUSED_PID_MS = 10 * 60_000; // a lock on this host whose pid runs, against pid reuse
export const LOCK_EMPTY_MS = 2_000;            // a lock with nothing in it: its owner died between create and write
export const LOCK_BREAK_STALE_MS = 5_000;      // a breaker's own lock (below), left by a breaker that died
export const LOCK_WAIT_MS = Number(process.env.JARL_LOCK_WAIT_MS) || 20_000;   // the variable is a test knob
const SLEEPER = new Int32Array(new SharedArrayBuffer(4));
function sleep(ms) { Atomics.wait(SLEEPER, 0, 0, ms); }
function lockPath(root) { return join(jarlDir(root), '.lock'); }
// Re-entrant per loop, never across loops: a command that calls another write on the same loop takes that loop's lock
// once, and a write to another loop from inside it takes the other loop's own lock. Keyed by the loop's directory
// with symlinks resolved, so two spellings of one root are one lock.
const HELD = new Map();
function lockKey(root) { try { return realpathSync.native(jarlDir(root)); } catch { return resolve(jarlDir(root)); } }
// fn runs synchronously under the lock. A function that returns a promise would run its awaited part after the lock
// is released, so it is refused: an async function before it runs, any other that hands back a promise when it does.
const ASYNC_REFUSAL = 'withLock takes a synchronous function: the lock is released when it returns, so an async function (or one returning a promise) would write after the release — do the async work first, then call withLock with the writes';
function isThenable(v) { return v !== null && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function'; }
function runSync(fn) {
  const out = fn();
  if (isThenable(out)) throw new Error(ASYNC_REFUSAL);
  return out;
}

// Stale: empty for longer than LOCK_EMPTY_MS; on this host, an owner whose pid does not run (or, against pid
// reuse, one held for longer than LOCK_REUSED_PID_MS); from another host (a shared checkout) or with an unreadable
// owner, one held for longer than LOCK_STALE_MS.
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

// Breaking a stale lock is itself serialized, behind .jarl/.lock.break (exclusive create): only its owner
// may remove .lock, and only when .lock still holds exactly the content judged stale. A live lock is never
// moved or renamed, so a fresh owner that took the lock meanwhile keeps it. A breaker that died leaves
// .lock.break behind; it is removed after LOCK_BREAK_STALE_MS (breaking takes milliseconds).
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
    try { now = readText(lockPath(root)); } catch { /* released meanwhile */ }
    if (now === stale) unlinkSync(lockPath(root));
  } catch { /* released meanwhile */ } finally {
    try { if (readText(brk) === mine) unlinkSync(brk); } catch { /* gone */ }
  }
}

// Waiting for a lock held elsewhere blocks the whole thread (Atomics.wait), for up to LOCK_WAIT_MS (20 s): the
// tool is synchronous by design, so a caller with an event loop to keep alive should call it off that loop.
export function withLock(root, fn) {
  if (typeof fn !== 'function' || fn.constructor?.name === 'AsyncFunction') throw new Error(ASYNC_REFUSAL);
  // Before init there is no .jarl/ to guard and nothing in it to lose: init runs unguarded.
  if (!existsSync(jarlDir(root))) return runSync(fn);
  const key = lockKey(root);
  if (HELD.get(key) > 0) return runSync(fn);
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
      // Windows: a lock just released is "delete pending" while another process still has it open (a waiter reading
      // it), and creating it again is refused with EPERM until that handle closes — a busy lock, not an error.
      if (!(e.code === 'EEXIST' || (process.platform === 'win32' && RENAME_BUSY.has(e.code)))) throw e;
    }
    let text = ''; let mtimeMs = Date.now();
    try { text = readText(path); mtimeMs = statSync(path).mtimeMs; } catch {   // released meanwhile
      if (Date.now() > until) throw new Error(`.jarl/.lock could not be taken within ${LOCK_WAIT_MS} ms — nothing was written; retry`);
      sleep(1 + Math.floor(Math.random() * 5));
      continue;
    }
    if (lockIsStale(text, mtimeMs)) { breakStaleLock(root, text); sleep(1 + Math.floor(Math.random() * 5)); continue; }
    if (Date.now() > until) throw new Error(`.jarl/.lock is held by another jarl.mjs (${text.trim() || 'holder unknown'}) — nothing was written; retry, or remove ${path} if that process is gone`);
    sleep(10 + Math.floor(Math.random() * 40));
  }
  HELD.set(key, 1);
  try {
    const out = runSync(fn);
    // A committed loop that has no narrow ignore file gets it here: under the lock, and only
    // after a command that wrote (a refused one writes nothing). close may have removed .jarl/ meanwhile.
    const ignore = join(jarlDir(root), '.gitignore');
    if (existsSync(jarlDir(root)) && !existsSync(ignore)) writeAtomic(ignore, JARL_GITIGNORE_COMMITTED);
    // Likewise the merge setup (.jarl/.gitattributes and the decisions driver), once: a loop that has the file is set.
    if (existsSync(jarlDir(root)) && !existsSync(join(jarlDir(root), '.gitattributes'))) ensureLoopMerge(root);
    return out;
  } finally {
    HELD.delete(key);
    // Release only a lock that is still this one: close removes .jarl/ with it, and a lock broken as stale
    // may already belong to someone else.
    try { if (readText(path) === mine) unlinkSync(path); } catch { /* removed with .jarl/ */ }
  }
}

// Whether argv1 (process.argv[1]) names the script self: compared as real paths, and without case on Windows, so a
// plugin root spelled with another drive-letter case (c:\ against C:\), or reached through a symlink or a junction,
// still counts as this script. The CLI and the MCP server both start only when this holds.
export function isEntry(argv1, self, platform = process.platform) {
  if (!argv1) return false;
  const real = (p) => { try { return realpathSync.native(p); } catch { return resolve(p); } };
  const [a, b] = [real(resolve(argv1)), real(self)];
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// Every text file the loop keeps is read with its line endings as LF: a loop is committed, and a Windows checkout
// with core.autocrlf (or an editor there) hands it back with CRLF, which every line-based parser here would misread.
export function readText(path) { return readFileSync(path, 'utf8').replace(/\r\n?/g, '\n'); }

// Windows refuses a rename onto (or of) a file another process holds open — a reader without the lock, a virus
// scanner, the search indexer — with EPERM, EACCES or EBUSY, for the moment that handle stays open. Such a rename
// is retried for up to RENAME_RETRY_MS before the error is let through; everywhere else the first error is final.
export const RENAME_RETRY_MS = 2_000;
const RENAME_BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);
export function renameRetry(from, to, rename = renameSync, platform = process.platform) {
  const until = Date.now() + RENAME_RETRY_MS;
  for (let wait = 5; ; wait = Math.min(wait * 2, 100)) {
    try { rename(from, to); return; } catch (e) {
      if (platform !== 'win32' || !RENAME_BUSY.has(e.code) || Date.now() > until) throw e;
      sleep(wait);
    }
  }
}

// Written whole beside the target, then renamed over it: a reader sees the old file or the new one.
export function writeAtomic(path, text) {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(tmp, text);
  try { renameRetry(tmp, path); } catch (e) { try { unlinkSync(tmp); } catch { /* gone */ } throw e; }
}
function appendAtomic(path, header, text) {
  writeAtomic(path, (existsSync(path) ? readText(path) : header) + text);
}

// ---- ids: the one grammar of the number of an issue, a question and a branch ----------------------------------------

// The number of an issue (and of a question, a-NNN): three or more digits. Below 1000 a number is padded to three (007,
// 195); from 1000 it has the digits it needs. Every reader and writer of an id, a range of ids or the id in a branch
// name is here, and ids are compared as numbers, never as strings (999 comes before 1000). The first id of 1000 or
// more raises the record format, because a reader of format 1 skips such a file in silence.
export const ID_SRC = '\\d{3,}';
// A pattern with `{id}` where an issue number stands: the one way another section embeds the grammar.
function idRe(source, flags) { return new RegExp(source.replaceAll('{id}', ID_SRC), flags); }
export function padId(raw) {
  const s = String(raw).trim().replace(/^#/, '');
  return /^\d+$/.test(s) ? s.replace(/^0+/, '').padStart(3, '0') : s;
}
export const cmpId = (a, b) => Number(a) - Number(b);
export const needsRaisedFormat = (id) => /^\d+$/.test(String(id)) && Number(id) >= 1000;
// The number of a question as the command line gives it: 12, #12 or a-12.
function askNumber(raw) { return padId(String(raw).replace(/^a-/, '')); }

// One id, or several as a comma list with ranges: `12,13,14` or `203-206,209` (no spaces: one argument, like --tags a,b).
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
      for (let n = a; n <= b; n += 1) out.push(padId(n));
    } else {
      need(/^\d+$/.test(part), `not an issue id: "${part}" — ids are numbers, several as a comma list with ranges: 12,13 or 203-206,209`);
      out.push(padId(part));
    }
  }
  return [...new Set(out)];
}
function isBulk(raw) { return /[,-]/.test(String(raw ?? '')); }

// An issue number of the loop standing alone in a text: no letter or digit touches it, so a sha (1b066c7) or a longer
// number never reads as one, while reviewer-450, raport-398 and (024) do. Dates (2026-10-15, 2026-10) and dotted
// version numbers are set aside first, and only a number that is an id the loop holds (`held`, a Set or Map of ids) counts, so a
// year or a count never becomes an issue in a loop of thousands.
export function idsNamed(text, held) {
  const plain = String(text || '').replace(/(?<![0-9])\d{4}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?(?:[ T]\d{2}:\d{2})?(?![0-9])/g, ' ').replace(/\d+(?:\.\d+)+/g, ' ');
  // A range (998-1002, low-high like expandIds reads it) names every id the loop holds inside it; a lone id names itself.
  const heldIds = [...held.keys ? held.keys() : held].map(String);
  const out = [];
  for (const m of plain.matchAll(idRe('(?<![0-9A-Za-z])({id})(?:-#?({id}))?(?![0-9A-Za-z])', 'g'))) {
    if (m[2] !== undefined && Number(m[1]) <= Number(m[2])) out.push(...heldIds.filter((id) => Number(id) >= Number(m[1]) && Number(id) <= Number(m[2])).sort((a, b) => Number(a) - Number(b)));
    else for (const raw of m[2] === undefined ? [m[1]] : [m[1], m[2]]) if (held.has(padId(raw))) out.push(padId(raw));
  }
  return out;
}

// The number a branch name carries: `jarl/NNN-…`, `jarl/<who>/NNN-…` or `<who>/jarl/NNN-…`. Null when it carries none.
function branchIssueId(name) {
  return idRe('^jarl/(?:[^/]+/)?({id})-').exec(name)?.[1] || idRe('^[^/]+/jarl/({id})-').exec(name)?.[1] || null;
}
// The branch names git is asked for that carry an issue's number (the globs `branchIssueId` reads).
function branchGlobsFor(id) { return [`jarl/${id}-*`, `jarl/*/${id}-*`]; }

// ---- the profile: what a loop's issues carry and what its statuses mean ----------------------------

// A loop may be opened with a profile (init --profile <file>), stored as .jarl/profile.json. It is data only: the
// statuses an issue moves through and what each one means to the tool, the header fields its issues carry (with
// the values each may take), extra sections, and the heading its acceptance lives under. Jarl reads the profile's
// keys and flags; it never reads meaning into a name the profile chose. A loop with no profile runs on the built-in
// one below, which is the whole of what a loop without a profile does.
//
// What a status means is said by its flags, never by its name:
// - dispatchable        next offers an issue in it (built-in: open);
// - holds-claim         an issue in it holds its files against the others, and carries the lease: set writes Since
//                       (and Branch, Worker, Worktree when given) on a move into it, and leaving it removes the lease
//                       (built-in: in-progress);
// - settles-dependents  an issue in it does not hold back the issues that wait on it with After (built-in: done,
//                       dropped);
// - terminal            the issue is finished business for the loop: list hides it by default, and close and archive
//                       do not wait for it (built-in: done, dropped, deferred);
// - closes-record       moving into it passes the done gate — evidence and a live approve — and review, report and
//                       status count it as done work (built-in: done);
// - needs-reason        a move into it needs a reason, written under Evidence as "<Status>: <why>" (built-in: dropped,
//                       deferred).
// A status is at most one of dispatchable, holds-claim and terminal; closes-record is terminal too.
export const STATUS_FLAGS = Object.freeze(['dispatchable', 'holds-claim', 'settles-dependents', 'terminal', 'closes-record', 'needs-reason']);
export const BUILTIN_STATUSES = {
  open: ['dispatchable'],
  'in-progress': ['holds-claim'],
  done: ['settles-dependents', 'terminal', 'closes-record'],
  dropped: ['settles-dependents', 'terminal', 'needs-reason'],
  deferred: ['terminal', 'needs-reason'],
};
export const PROFILE_VERSION = 1;
// The keys a profile file may hold. A key this list does not name is refused, so a profile written for a later
// Jarl fails loudly here instead of being half-read.
export const PROFILE_KEYS = ['jarl-profile', 'format', 'name', 'statuses', 'initial', 'fields', 'sections', 'acceptance-heading', 'external-scheduler', 'done-gate', 'lifecycle'];
export const PROFILE_FIELD_KEYS = ['enum', 'default', 'required'];
// A status written as an object instead of a list of flags: { "flags": [...], "set-by": "record" | "any" }.
export const PROFILE_STATUS_KEYS = ['flags', 'set-by'];
// Who may move an issue into a status: anyone ('any', the default), or only a library call through record.mjs
// ('record') — the command line and the MCP tools are refused, so a composer's own gate (a veto held by one of its roles) cannot
// be walked around with a set.
export const SET_BY = ['any', 'record'];
// Who may end the loop itself: "lifecycle": { "close": "any" | "record", "archive": "any" | "record", "command": "<the
// composer's own command>" }. 'record' refuses jarl close / jarl archive and their MCP tools (caller 'cli') and names the
// command, so the record of a loop a composer keeps (Horde's mission) is never removed or moved out from under it by
// Jarl's own lifecycle; a library caller (caller 'record') still may. The same two words as "set-by".
export const LIFECYCLE_KEYS = ['close', 'archive', 'command'];
export const LIFECYCLE_OPS = ['close', 'archive'];
export const DEFAULT_LIFECYCLE = Object.freeze({ close: 'any', archive: 'any', command: null });
// The format of the record (the issue files, the log, the rulings) this Jarl reads and writes. A profile may state the
// format it was written for; one this Jarl does not know is refused before anything else, so a vendored copy and an
// installed Jarl that drifted apart stop loudly instead of half-reading each other's loop.
// Format 1 is a loop whose profile names no format, or that has no profile. Format 2 is raised, by raiseFormat, by the
// first write of an element a reader that knows only format 1 would misread in silence (a repository name in Repo, an
// id of 1000 or more, a retraction line); such a reader refuses the loop instead. Both are the contract jarl-record/1.
export const RECORD_FORMAT = 1;
export const RECORD_FORMATS = Object.freeze([1, 2]);
export const RECORD_FORMAT_RAISED = 2;
// The done gate a loop runs on: the built-in one (approve: fresh — a live approve by someone other than the worker,
// from a fresh reviewer when the issue carries code) and no merge required. A profile may ask for a landed merge
// (requires-merged) and, only with it, give up the approve (approve: none): the merge gate that landed it is then the
// check, and Jarl records what it did.
export const DONE_GATE_KEYS = ['approve', 'requires-merged'];
export const DONE_GATE_APPROVE = ['fresh', 'none'];
export const DEFAULT_DONE_GATE = Object.freeze({ approve: 'fresh', 'requires-merged': false });
// Header fields the tool itself writes and reads: a profile cannot declare them. Kind and Tier are built in too, but
// a profile may declare them to replace their values (an enum, and a default).
export const TOOL_FIELDS = ['Status', 'Priority', 'Tags', 'Files', 'Repo', 'After', 'Found by', 'Source', 'Where', 'Branch', 'Worker', 'Worktree', 'Since', 'Merged', 'CI', 'Resources'];
export const BUILTIN_SECTIONS = ['What', 'Why', 'Acceptance', 'Changelog', 'Evidence'];
export const PROFILE_FIELD_RE = /^[A-Za-z][A-Za-z0-9 -]{0,39}$/;
export const PROFILE_STATUS_RE = /^[a-z][a-z0-9-]{0,39}$/;
// Names a status may not take: the words status and resume already print for something else (the counts line's
// "waiting", "ready", "in flight", "questions", "to ratify") and the lower-case keys of status --json, so a count and a
// view can never be read for one another.
export const RESERVED_STATUS_NAMES = ['waiting', 'ready', 'in-flight', 'questions', 'ratify', 'to-ratify', 'goal', 'opened', 'archived', 'stale', 'handoff', 'reviews', 'uncommitted', 'by', 'statuses'];
const PROFILE_SECTION_RE = /^[A-Za-z][A-Za-z0-9 _-]{0,59}$/;
const PROFILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export function profilePath(root) { return join(jarlDir(root), 'profile.json'); }

// A profile file checked whole against the schema above; every problem is named at once. Returns the profile as
// the tool uses it (see makeProfile).
export function validateProfile(json, where = 'the profile') {
  const bad = [];
  const say = (m) => bad.push(m);
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const oneLine = (v) => typeof v === 'string' && v.trim() !== '' && !/[\r\n]/.test(v);
  if (!isObj(json)) throw new Error(`${where} is not a JSON object`);
  // The record format first, and alone: a profile written for another format may mean anything by its other keys.
  if (json.format !== undefined && !RECORD_FORMATS.includes(json.format)) {
    throw new Error(`${where} is written for record format ${JSON.stringify(json.format)}, and this Jarl reads format ${RECORD_FORMATS.join(', ')} — nothing was read or written; use the Jarl the loop was opened with (a vendored copy and the installed one must agree), or upgrade this one`);
  }
  // The format marker: a profile that holds only jarl-profile and format changes nothing in how the loop behaves (the
  // built-in profile, declared: false); it only says which format the record was written in.
  if (Object.keys(json).length === 2 && json['jarl-profile'] === PROFILE_VERSION && json.format !== undefined) {
    return makeProfile({ name: 'built-in', statuses: Object.entries(BUILTIN_STATUSES), initial: 'open', declared: false, format: json.format });
  }
  for (const k of Object.keys(json)) if (!PROFILE_KEYS.includes(k)) say(`unknown key "${k}" — a profile takes ${PROFILE_KEYS.join(', ')}`);
  if (json['jarl-profile'] !== PROFILE_VERSION) say(`"jarl-profile" must be ${PROFILE_VERSION} (the profile format this Jarl reads)`);
  if (json.name !== undefined && !(typeof json.name === 'string' && PROFILE_NAME_RE.test(json.name))) say('"name" is letters, digits and . _ - (starting with a letter or digit, at most 80 characters)');
  // statuses: { "<name>": ["<flag>", ...] }, in the order they are shown.
  // A status is a list of flags, or { "flags": [...], "set-by": "record" } when it says who may move an issue into it.
  const statuses = [];
  const flagsOf = new Map();
  const setBy = new Map();
  if (!isObj(json.statuses) || !Object.keys(json.statuses).length) say('"statuses" must be an object naming at least one status: { "<status>": ["<flag>", ...] }');
  else {
    for (const [name, spec] of Object.entries(json.statuses)) {
      if (!PROFILE_STATUS_RE.test(name)) { say(`status "${name}" must be lower-case letters, digits and - (starting with a letter, at most 40 characters)`); continue; }
      if (RESERVED_STATUS_NAMES.includes(name)) { say(`status "${name}" is a name the views use for something else — the reserved names are ${RESERVED_STATUS_NAMES.join(', ')}`); continue; }
      let flags = spec;
      if (isObj(spec)) {
        const unknown = Object.keys(spec).filter((k) => !PROFILE_STATUS_KEYS.includes(k));
        if (unknown.length) { say(`status "${name}": unknown key "${unknown[0]}" — a status written as an object takes ${PROFILE_STATUS_KEYS.join(', ')}`); continue; }
        if (spec['set-by'] !== undefined && !SET_BY.includes(spec['set-by'])) { say(`status "${name}": "set-by" is one of ${SET_BY.join(', ')} (record: only a library call through record.mjs moves an issue into it, never jarl set)`); continue; }
        flags = spec.flags === undefined ? [] : spec.flags;
        setBy.set(name, spec['set-by'] || 'any');
      }
      if (!Array.isArray(flags) || !flags.every((f) => typeof f === 'string')) { say(`status "${name}" takes a list of flags (${STATUS_FLAGS.join(', ')}), [] for none — or { "flags": [...], "set-by": "record" }`); continue; }
      for (const f of flags) if (!STATUS_FLAGS.includes(f)) say(`status "${name}": unknown flag "${f}" — the flags are ${STATUS_FLAGS.join(', ')}`);
      if (new Set(flags).size !== flags.length) say(`status "${name}" names a flag twice`);
      const set = new Set(flags);
      if (['dispatchable', 'holds-claim', 'terminal'].filter((f) => set.has(f)).length > 1) say(`status "${name}" is at most one of dispatchable, holds-claim and terminal`);
      if (set.has('closes-record') && !set.has('terminal')) say(`status "${name}" is closes-record, so it must be terminal too`);
      statuses.push(name);
      flagsOf.set(name, set);
    }
    const some = (f) => statuses.some((s) => flagsOf.get(s).has(f));
    if (statuses.length && !some('dispatchable')) say('no status is dispatchable — next would never offer anything');
    if (statuses.length && !some('holds-claim')) say('no status holds-claim — no issue could ever be worked on');
    if (statuses.length && !some('terminal')) say('no status is terminal — the loop could never close');
    if (statuses.length && !some('settles-dependents')) say('no status settles-dependents — an issue waiting on another with After would wait for good');
  }
  let initial = statuses[0];
  if (json.initial !== undefined) {
    if (!statuses.includes(json.initial)) say(`"initial" must name one of the statuses (${statuses.join(', ')})`);
    else initial = json.initial;
  }
  if (initial && flagsOf.get(initial) && (flagsOf.get(initial).has('terminal') || flagsOf.get(initial).has('holds-claim'))) say(`a new issue starts in "${initial}", which is ${flagsOf.get(initial).has('terminal') ? 'terminal' : 'holds-claim'} — name another with "initial"`);
  // fields: { "<Name>": { enum?, default?, required? } }
  const fields = [];
  if (json.fields !== undefined && !isObj(json.fields)) say('"fields" must be an object: { "<Field>": { "enum": [...], "default": "...", "required": true } }');
  for (const [name, spec] of Object.entries(isObj(json.fields) ? json.fields : {})) {
    if (!PROFILE_FIELD_RE.test(name) || name !== name.trim()) { say(`field "${name}" must be letters, digits, spaces and - (starting with a letter, at most 40 characters)`); continue; }
    if (TOOL_FIELDS.some((t) => t.toLowerCase() === name.toLowerCase())) { say(`field "${name}" is one the tool writes itself — a profile cannot declare it; rename the field in the profile, because the tool writes ${name} itself`); continue; }
    if (statuses.includes(name.toLowerCase())) { say(`field "${name}" has the name of a status — set <id> ${name.toLowerCase()} would be ambiguous`); continue; }
    if (fields.some((f) => f.key === name.toLowerCase())) { say(`field "${name}" is declared twice (names are compared without case)`); continue; }
    if (!isObj(spec)) { say(`field "${name}" takes an object: { "enum": [...], "default": "...", "required": true } ({} for a free one-line value)`); continue; }
    for (const k of Object.keys(spec)) if (!PROFILE_FIELD_KEYS.includes(k)) say(`field "${name}": unknown key "${k}" — a field takes ${PROFILE_FIELD_KEYS.join(', ')}`);
    const builtin = ['kind', 'tier'].includes(name.toLowerCase());
    let values = null;
    if (spec.enum !== undefined) {
      if (!Array.isArray(spec.enum) || !spec.enum.length || !spec.enum.every(oneLine) || spec.enum.some((v) => v.includes(','))) say(`field "${name}": "enum" is a non-empty list of one-line values without commas`);
      else if (new Set(spec.enum).size !== spec.enum.length) say(`field "${name}": "enum" names a value twice`);
      else values = spec.enum.map((v) => v.trim());
    } else if (builtin) say(`field "${name}" is built in: declaring it means giving its values — "enum": [...]`);
    if (spec.default !== undefined) {
      if (!oneLine(spec.default)) say(`field "${name}": "default" is a one-line value`);
      else if (values && !values.includes(spec.default.trim())) say(`field "${name}": "default" "${spec.default}" is not one of its enum values`);
    }
    if (spec.required !== undefined && typeof spec.required !== 'boolean') say(`field "${name}": "required" is true or false`);
    if (builtin && spec.required !== undefined) say(`field "${name}" is built in and always written — "required" has no meaning for it`);
    fields.push({ name: builtin ? name.charAt(0).toUpperCase() + name.slice(1).toLowerCase() : name, key: name.toLowerCase(), enum: values, default: oneLine(spec.default) ? spec.default.trim() : null, required: spec.required === true, builtin });
  }
  // sections: ["<Heading>", ...] beyond What, Why, Acceptance, Changelog and Evidence.
  const sections = [];
  if (json.sections !== undefined && !(Array.isArray(json.sections) && json.sections.every((s) => typeof s === 'string'))) say('"sections" must be a list of headings');
  for (const s of Array.isArray(json.sections) ? json.sections.filter((x) => typeof x === 'string') : []) {
    if (!PROFILE_SECTION_RE.test(s) || s !== s.trim()) say(`section "${s}" must be letters, digits, spaces, _ and - (starting with a letter, at most 60 characters)`);
    else if (BUILTIN_SECTIONS.some((b) => b.toLowerCase() === s.toLowerCase())) say(`section "${s}" is built in — declare only the extra ones`);
    else if (sections.some((x) => x.toLowerCase() === s.toLowerCase())) say(`section "${s}" is declared twice (headings are compared without case)`);
    else sections.push(s);
  }
  // acceptance-heading: the heading this loop's issues keep their acceptance under, read as ## Acceptance is.
  let acceptance = null;
  if (json['acceptance-heading'] !== undefined) {
    const h = json['acceptance-heading'];
    if (!oneLine(h) || h !== h.trim() || /^#/.test(h) || h.length > 80) say('"acceptance-heading" is a one-line heading (without the ##, at most 80 characters)');
    else if ([...BUILTIN_SECTIONS.filter((b) => b !== 'Acceptance'), ...sections].some((b) => b.toLowerCase() === h.toLowerCase())) say(`"acceptance-heading" "${h}" is already the heading of another section`);
    else if (h.toLowerCase() !== 'acceptance') acceptance = h;
  }
  // external-scheduler: the command the loop's own scheduler is run by, shown in place of what next and queue compute.
  let scheduler = null;
  if (json['external-scheduler'] !== undefined) {
    const x = json['external-scheduler'];
    if (!oneLine(x) || x.length > 200) say('"external-scheduler" is the one-line command that schedules this loop\'s work (at most 200 characters), shown by next, queue, status and resume in place of their own ready list');
    else scheduler = x.trim();
  }
  // done-gate: { "approve": "fresh" | "none", "requires-merged": true | false }.
  let doneGate = DEFAULT_DONE_GATE;
  if (json['done-gate'] !== undefined) {
    const g = json['done-gate'];
    if (!isObj(g)) say('"done-gate" is an object: { "approve": "fresh" | "none", "requires-merged": true | false }');
    else {
      const before = bad.length;
      for (const k of Object.keys(g)) if (!DONE_GATE_KEYS.includes(k)) say(`"done-gate": unknown key "${k}" — it takes ${DONE_GATE_KEYS.join(', ')}`);
      if (g.approve !== undefined && !DONE_GATE_APPROVE.includes(g.approve)) say(`"done-gate": "approve" is one of ${DONE_GATE_APPROVE.join(', ')}`);
      if (g['requires-merged'] !== undefined && typeof g['requires-merged'] !== 'boolean') say('"done-gate": "requires-merged" is true or false');
      const gate = { approve: g.approve ?? DEFAULT_DONE_GATE.approve, 'requires-merged': g['requires-merged'] ?? DEFAULT_DONE_GATE['requires-merged'] };
      if (gate.approve === 'none' && gate['requires-merged'] !== true) say('"done-gate": "approve": "none" is allowed only with "requires-merged": true — with neither an approve nor a landed merge, nothing would stand behind a closed issue');
      if (bad.length === before) doneGate = Object.freeze(gate);
    }
  }
  // lifecycle: { "close": "any" | "record", "archive": "any" | "record", "command": "<one line>" }.
  let lifecycle = DEFAULT_LIFECYCLE;
  if (json.lifecycle !== undefined) {
    const l = json.lifecycle;
    if (!isObj(l)) say('"lifecycle" is an object: { "close": "any" | "record", "archive": "any" | "record", "command": "<the composer\'s command that closes or archives this loop>" }');
    else {
      const before = bad.length;
      for (const k of Object.keys(l)) if (!LIFECYCLE_KEYS.includes(k)) say(`"lifecycle": unknown key "${k}" — it takes ${LIFECYCLE_KEYS.join(', ')}`);
      for (const op of LIFECYCLE_OPS) if (l[op] !== undefined && !SET_BY.includes(l[op])) say(`"lifecycle": "${op}" is one of ${SET_BY.join(', ')} (record: jarl ${op} and its MCP tool refuse, and the composer does it with its own command)`);
      if (l.command !== undefined && (!oneLine(l.command) || l.command.length > 200)) say('"lifecycle": "command" is the one-line command (at most 200 characters) that closes or archives this loop instead, named by the refusal');
      if (bad.length === before) lifecycle = Object.freeze({ close: l.close ?? 'any', archive: l.archive ?? 'any', command: l.command === undefined ? null : l.command.trim() });
    }
  }
  if (bad.length) throw new Error(`${where} is not a valid profile:\n- ${bad.join('\n- ')}`);
  return makeProfile({ name: json.name || 'custom', statuses: statuses.map((s) => [s, [...flagsOf.get(s)]]), initial, fields, sections, acceptance, declared: true, setBy, scheduler, doneGate, lifecycle, format: json.format ?? RECORD_FORMAT });
}

// The profile as the tool reads it: flags looked up by status, the values Kind and Tier may take and their defaults,
// the declared fields in order.
function makeProfile({ name, statuses, initial, fields = [], sections = [], acceptance = null, declared, setBy = new Map(), scheduler = null, doneGate = DEFAULT_DONE_GATE, lifecycle = DEFAULT_LIFECYCLE, format = RECORD_FORMAT }) {
  const flags = new Map(statuses.map(([s, f]) => [s, new Set(f)]));
  const kind = fields.find((f) => f.key === 'kind');
  const tier = fields.find((f) => f.key === 'tier');
  const kinds = kind ? kind.enum : KINDS;
  const tiers = tier ? tier.enum : TIERS;
  const p = {
    name, declared, initial, sections, acceptance,
    // The record format, the command of an external scheduler (null: next and queue compute their own), the done gate.
    format, scheduler, doneGate,
    // Who may close and archive the loop ('any', or 'record': never jarl close / archive), and the composer's command.
    lifecycle,
    statuses: statuses.map(([s]) => s),
    kinds, kindDefault: kind && kind.default ? kind.default : kinds[0],
    tiers, tierDefault: tier ? (tier.default || tiers[0]) : TIER_DEFAULT,
    // The fields the profile adds to the header (Kind and Tier are written in their fixed places).
    fields: fields.filter((f) => !f.builtin),
    declaredFields: fields,
    is: (status, flag) => Boolean(flags.get(status)?.has(flag)),
    with: (flag) => statuses.map(([s]) => s).filter((s) => flags.get(s).has(flag)),
    flagsOf: (status) => [...(flags.get(status) || [])],
    // Who may move an issue into the status: 'any', or 'record' (a library call only, never jarl set).
    setBy: (status) => setBy.get(status) || 'any',
  };
  // In play: offered or worked on (built-in: open, in-progress).
  p.active = (s) => p.is(s, 'dispatchable') || p.is(s, 'holds-claim');
  // Not finished: a status the profile names that is not terminal — in play, or one an issue waits in (a proposal
  // not yet accepted, a block). A status the profile does not name (a hand-edited file) is neither.
  p.unfinished = (s) => flags.has(s) && !flags.get(s).has('terminal');
  p.field = (name) => fields.find((f) => f.key === String(name).toLowerCase()) || null;
  return p;
}

// Frozen, with every list it holds: it is shared by every loop without a profile, and record.mjs hands it out.
export const DEFAULT_PROFILE = freezeProfile(makeProfile({ name: 'built-in', statuses: Object.entries(BUILTIN_STATUSES), initial: 'open', declared: false }));
function freezeProfile(p) {
  for (const v of Object.values(p)) if (Array.isArray(v)) { v.forEach((x) => (x && typeof x === 'object' ? Object.freeze(x) : x)); Object.freeze(v); }
  return Object.freeze(p);
}

// The loop's profile: .jarl/profile.json when there is one, else the built-in. Read once per state of the file (a
// command reads it many times). A profile file that does not validate is a refusal, never a silent fallback.
const PROFILES = new Map();
export function loadProfile(root) { return profileAt(jarlDir(root)); }
// The profile of the record held in `dir` (a loop's .jarl/, or an archived loop's directory).
export function profileAt(dir) {
  const path = join(dir, 'profile.json');
  let st;
  try { st = statSync(path); } catch { return DEFAULT_PROFILE; }
  const key = `${st.mtimeMs} ${st.size}`;
  const hit = PROFILES.get(path);
  if (hit && hit.key === key) return hit.profile;
  let json;
  try { json = JSON.parse(readText(path)); } catch (e) { throw new Error(`${path} is not JSON: ${e.message}`); }
  const profile = validateProfile(json, path);
  PROFILES.set(path, { key, profile });
  return profile;
}
// Raises the loop to a record format (default: RECORD_FORMAT_RAISED), before the write that needs it and under the same
// lock: .jarl/profile.json becomes the marker (jarl-profile and format only) when the loop has none, and a declared
// profile gets its "format" key set. One function, called by every write of an element a reader of format 1 would
// misread in silence; it never lowers the format, and it refuses a loop already in a format this Jarl does not read (loadProfile
// throws). Returns true when it wrote.
export function raiseFormat(root, to = RECORD_FORMAT_RAISED) {
  need(RECORD_FORMATS.includes(to), `record format ${to} is not one this Jarl writes`);
  if (!existsSync(jarlDir(root))) return false;
  return withLock(root, () => {
    if (loadProfile(root).format >= to) return false;
    const path = profilePath(root);
    const json = existsSync(path) ? JSON.parse(readText(path)) : { 'jarl-profile': PROFILE_VERSION };
    json.format = to;
    writeAtomic(path, `${JSON.stringify(json, null, 2)}\n`);
    return true;
  });
}
export function readProfileFile(file) {
  need(typeof file === 'string' && file.trim(), '--profile needs the path of a profile file');
  need(existsSync(file), `no such profile file: ${file}`);
  let json;
  try { json = JSON.parse(readText(file)); } catch (e) { throw new Error(`${file} is not JSON: ${e.message}`); }
  return { json, profile: validateProfile(json, file) };
}

// The profile described, for `profile` and for a reader deciding whether a file is right.
export function describeProfile(p) {
  return {
    name: p.name, declared: p.declared, initial: p.initial,
    statuses: p.statuses.map((s) => ({ name: s, flags: p.flagsOf(s), ...(p.setBy(s) !== 'any' ? { setBy: p.setBy(s) } : {}) })),
    fields: p.declaredFields ? p.declaredFields.map((f) => ({ name: f.name, enum: f.enum, default: f.default, required: f.required })) : [],
    kinds: p.kinds, tiers: p.tiers, sections: p.sections, acceptanceHeading: p.acceptance || 'Acceptance',
    format: p.format, externalScheduler: p.scheduler, doneGate: { ...p.doneGate }, lifecycle: { ...p.lifecycle },
  };
}
export function renderProfile(d) {
  const lines = [`profile ${d.name}${d.declared ? '' : ' (no .jarl/profile.json: the built-in one)'}`, 'statuses:'];
  for (const s of d.statuses) lines.push(`  ${s.name}${s.name === d.initial ? ' (initial)' : ''}${s.flags.length ? `  ${s.flags.join(', ')}` : ''}${s.setBy === 'record' ? '  (set by the record only, never jarl set)' : ''}`);
  lines.push(`kind: ${d.kinds.join(' | ')}`, `tier: ${d.tiers.join(' | ')}`);
  const own = d.fields.filter((f) => !['kind', 'tier'].includes(f.name.toLowerCase()));
  if (own.length) lines.push('fields:', ...own.map((f) => `  ${f.name}${f.enum ? `: ${f.enum.join(' | ')}` : ''}${f.default ? ` (default ${f.default})` : ''}${f.required ? ' (required)' : ''}`));
  if (d.sections.length) lines.push(`sections: ${d.sections.join(', ')}`);
  if (d.acceptanceHeading !== 'Acceptance') lines.push(`acceptance heading: ${d.acceptanceHeading}`);
  if (d.externalScheduler) lines.push(`external scheduler: ${d.externalScheduler} (next and queue show it instead of their own list)`);
  if (d.doneGate.approve !== 'fresh' || d.doneGate['requires-merged']) lines.push(`done gate: approve ${d.doneGate.approve}${d.doneGate['requires-merged'] ? ' · requires a merge in the base' : ''}`);
  const kept = LIFECYCLE_OPS.filter((op) => d.lifecycle[op] === 'record');
  if (kept.length) lines.push(`lifecycle: ${kept.join(' and ')} by the record only, never jarl ${kept.join(' / ')}${d.lifecycle.command ? ` — ${d.lifecycle.command}` : ''}`);
  lines.push(`record format: ${d.format}`);
  return lines.join('\n');
}
export function cmdProfile(root, file) {
  if (file !== undefined) return { file, ...describeProfile(readProfileFile(file).profile) };
  return describeProfile(existsSync(jarlDir(root)) ? loadProfile(root) : DEFAULT_PROFILE);
}

// ---- issues ------------------------------------------------------------------------------------

// Letters Unicode does not decompose into a base letter and an accent (ł, ø, đ, ß, æ, þ...) would be
// dropped as punctuation and leave a hole in the name ("gałęzi" -> "ga-ezi"), so they are spelled out first.
const UNDECOMPOSED = {
  'ł': 'l', 'ø': 'o', 'đ': 'd', 'ð': 'd', 'ħ': 'h', 'ı': 'i', 'ŧ': 't', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'þ': 'th',
};
export function slugify(title) {
  return title.toLowerCase().replace(/[łøđðħıŧßæœþ]/g, (c) => UNDECOMPOSED[c]).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').slice(0, 60).replace(/^-+|-+$/g, '') || 'issue';
}

// A header field: **Name:** value. A name is letters, digits, spaces and dashes, so a profile's fields (Area-2) read
// as fields; the built-in ones are letters and spaces only.
const FIELD_RE = /^\*\*([A-Za-z0-9 -]+):\*\*\s*(.*)$/;

export function parseIssue(text, file) {
  const lines = text.split('\n');
  const head = idRe('^#\\s+({id})\\s+·\\s+(.*)$').exec(lines[0] || '');
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
  // Both fields are optional: an issue without them reads as waiting on nothing and filed from no finding.
  issue.after = splitList(issue.fields.after).map(padId);
  // The exclusive resources it holds while its lease lasts (names, loop-wide, never files); only next reads them.
  issue.resources = splitList(issue.fields.resources);
  issue.sources = splitList(issue.fields.source);
  return issue;
}

const ISSUE_FILE_RE = idRe('^({id})-.*\\.md$');
export function loadIssues(root) {
  if (!existsSync(issuesDir(root))) return [];
  return issuesAt(jarlDir(root), loadProfile(root));
}
// The issues of the record held in `recordDir`, read under `profile`.
function issuesAt(recordDir, profile) {
  const dir = join(recordDir, 'issues');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => ISSUE_FILE_RE.test(f)).sort((a, b) => cmpId(ISSUE_FILE_RE.exec(a)[1], ISSUE_FILE_RE.exec(b)[1]) || (a < b ? -1 : a > b ? 1 : 0))
    .map((f) => withProfile(parseIssue(readText(join(dir, f)), join(dir, f)), profile));
}
// An issue read under the loop's profile: one written with no Status starts where the profile's issues start.
// Its acceptance is read under the profile's heading as under ## Acceptance, so every view that counts acceptance
// lines (next, status, done, review) sees it.
function withProfile(issue, profile) {
  if (!profile.declared) return issue;
  if (issue.fields.status === undefined) issue.status = profile.initial;
  const alias = profile.acceptance && profile.acceptance.toLowerCase();
  if (alias && issue.sections[alias] !== undefined && issue.sections.acceptance === undefined) issue.sections.acceptance = issue.sections[alias];
  return issue;
}
// The heading an issue's acceptance is written under: the one the file already has, else the profile's.
function acceptanceHeading(issue, profile) {
  if (profile.acceptance && issue.sections[profile.acceptance.toLowerCase()] !== undefined) return profile.acceptance;
  if (/^##\s+Acceptance\s*$/m.test(readText(issue.file))) return 'Acceptance';
  return profile.acceptance || 'Acceptance';
}

// A declared field's value, checked: one line, one of its enum values when it has them. Kind and Tier are checked
// against the profile's values the same way.
export function fieldValue(profile, field, raw) {
  const v = fieldText(raw);
  const f = typeof field === 'string' ? profile.field(field) : field;
  if (f && f.enum && v !== '') need(f.enum.includes(v), `${f.name} must be one of: ${f.enum.join(', ')} (got "${v}")`);
  return v;
}
// Name=value pairs from a repeatable flag (--field, --section), each name one the profile declares.
function namedPairs(list, flag, known, what) {
  const out = new Map();
  for (const item of [].concat(list ?? [])) {
    const at = String(item).indexOf('=');
    need(at > 0, `--${flag} takes <name>=<value> (got "${item}")`);
    const name = String(item).slice(0, at).trim();
    const hit = known.find((k) => k.toLowerCase() === name.toLowerCase());
    need(hit, known.length ? `${name} is not a ${what} this loop's profile declares — it declares ${known.join(', ')}` : `this loop's profile declares no ${what}s — --${flag} names one (see: jarl.mjs profile)`);
    need(!out.has(hit), `--${flag} names ${hit} twice`);
    out.set(hit, String(item).slice(at + 1));
  }
  return out;
}

export function findIssue(root, rawId) {
  const id = padId(rawId);
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
    // Compared without case, as parseIssue reads names: **status:** written by hand is the Status field, not a second one.
    if (f[1].toLowerCase() === name.toLowerCase()) { lines[i] = `**${name}:** ${value}`; return lines.join('\n'); }
    last = i;
  }
  // insert after the last field line of the header
  lines.splice(last + 1, 0, `**${name}:** ${value}`);
  return lines.join('\n');
}

// Remove the first line `**<Name>:** …`, in exactly that case, wherever it stands (what after --clear and repo --clear remove).
function removeFirstField(text, name) { return text.replace(new RegExp(`^\\*\\*${name}:\\*\\*.*\\n`, 'm'), ''); }

// Remove header fields (only the header: a section line that looks like a field is text). A field that is
// not there is left alone.
function removeFields(text, names) {
  const lines = text.split('\n');
  const out = [lines[0]];
  let inHeader = true;
  for (const line of lines.slice(1)) {
    if (line.startsWith('## ')) inHeader = false;
    const f = inHeader ? FIELD_RE.exec(line) : null;
    if (f && names.some((n) => n.toLowerCase() === f[1].toLowerCase())) continue;
    out.push(line);
  }
  return out.join('\n');
}

function setSection(text, name, body) {
  // A heading may hold any character (a profile's "Acceptance — evidence"): it is matched as it is written.
  const re = new RegExp(`(^##\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$\\n)([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'mi');
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
// A text for What, Why or a section that holds a matched opening and closing tag named after one of the issue's own
// fields (<why>…</why>) is a call whose fields all went into one parameter: the other fields would be filed empty.
// Refused, naming the field. Code is not looked at — a fenced block or a code span may name such a tag — and a lone
// tag is only text.
const FIELD_TAGS = ['what', 'why', 'acceptance', 'prio', 'tags', 'files', 'kind'];
const FIELD_FLAG = { what: '--what', why: '--why', acceptance: '--acceptance', prio: '--prio', tags: '--tags', files: '--files', kind: '--kind' };
export function needNoFieldTags(text, where) {
  let fence = null;
  const kept = [];
  for (const line of String(text ?? '').split('\n')) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; continue; }
    if (f) { fence = f[1]; continue; }
    kept.push(line);
  }
  const outsideCode = kept.join('\n').replace(/(`+)[\s\S]*?\1/g, ' ');
  for (const tag of FIELD_TAGS) {
    if (new RegExp(`<${tag}\\s*>[\\s\\S]*?</${tag}\\s*>`, 'i').test(outsideCode)) {
      throw new Error(`${where} holds a <${tag}>…</${tag}> pair: a field goes in its own parameter (${FIELD_FLAG[tag]}), never inside another text — nothing was written; pass each field on its own, or put the tags in backticks if you mean to write them`);
    }
  }
}
// What a new issue was filed with, read back from its file: for new's reply, which lists what was parsed and what was
// left empty, each empty field with the command that fills it.
const FILL_WITH = {
  why: (id) => `jarl.mjs body ${id} --why "<why>"`,
  acceptance: (id) => `jarl.mjs body ${id} --acceptance "<line>"`,
  files: (id) => `jarl.mjs files ${id} p,q`,
  after: (id) => `jarl.mjs after ${id} <ids>`,
  where: (id) => `jarl.mjs body ${id} --where "<where>"`,
  'found by': () => 'only at filing: new --found-by <who>',
};
export function describeNew(file) {
  const issue = parseIssue(readText(file), file);
  const len = (k) => (issue.sections[k] || '').trim().length;
  const parsed = { priority: issue.priority, tier: issue.tier, kind: issue.kind, tags: issue.tags, acceptanceLines: acceptanceLineCount(issue), whatChars: len('what'), whyChars: len('why') };
  const empty = [
    ['why', len('why') === 0], ['acceptance', acceptanceLineCount(issue) === 0], ['files', issue.files.length === 0],
    ['after', issue.after.length === 0], ['where', !fieldText(issue.fields.where)], ['found by', !fieldText(issue.fields['found by'])],
  ].filter(([, e]) => e).map(([k]) => ({ field: k, fill: FILL_WITH[k](issue.id) }));
  return { parsed, empty };
}
export function renderNewReply(out) {
  const { parsed: p, empty } = out;
  const lines = [`filed ${out.id} · ${out.file}`,
    `parsed: priority ${p.priority} · tier ${p.tier} · kind ${p.kind} · tags ${p.tags.length ? p.tags.join(',') : '(none)'} · ${p.acceptanceLines} acceptance line${p.acceptanceLines === 1 ? '' : 's'} · What ${p.whatChars} characters · Why ${p.whyChars} characters`];
  if (empty.length) lines.push(`left empty: ${empty.map((e) => `${e.field} (${e.fill})`).join(' · ')}`);
  return lines.join('\n');
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

// fields: the profile's declared fields, [name, value] in its order, each written after Where (empty when not given).
// sections: the profile's extra sections, [heading, body], written after Acceptance. acceptanceHeading: the heading the
// acceptance goes under. Without them the file holds the built-in fields and sections only.
export function renderIssue({ id, title, status = 'open', kind, priority, tier, tags, files, repo, foundBy, where = '', what = '', why = '', acceptance = '', source = [], after = [], changelog = '', fields = [], sections = [], acceptanceHeading = 'Acceptance' }) {
  const body = (t) => (t ? `${t}\n` : '\n');
  const declared = fields.map(([n, v]) => `**${n}:**${v ? ` ${v}` : ''}\n`).join('');
  const extra = sections.map(([h, t]) => `## ${h}\n${body(t)}\n`).join('');
  return `# ${id} · ${fieldText(title)}

**Status:** ${status}
**Kind:** ${kind}
**Priority:** ${priority}
**Tier:** ${tier}
**Tags:** ${tags.join(', ')}
**Files:** ${files.join(', ')}
${repo ? `**Repo:** ${repo}\n` : ''}${after.length ? `**After:** ${after.join(', ')}\n` : ''}**Found by:** ${fieldText(foundBy)}
${source.length ? `**Source:** ${source.join(', ')}\n` : ''}**Where:**${where ? ` ${fieldText(where)}` : ''}
${declared}
## What
${body(what)}
## Why
${body(why)}
## ${acceptanceHeading}
${body(acceptance)}
${extra}${changelog ? `## Changelog\n${changelog}\n\n` : ''}## Evidence

`;
}

// ---- journal and decisions ----------------------------------------------------------------------

// The files of the record held in `dir`, named here and nowhere else. Only appendLogLines writes the log and only
// loopEvents reads it; the goal is read by goalLines, the decisions by decisionsAt and the questions by asksAt.
const LOG_FILE = 'log.md';
const GOAL_FILE = 'goal.md';
const DECISIONS_FILE = 'decisions.md';
const ASKS_FILE = 'asks.md';
// A journal stamp, as the log and the loop's other dated lines write it: YYYY-MM-DD HH:MM (UTC).
const STAMP_SRC = '\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}';
export function logPath(dir) { return join(dir, LOG_FILE); }
// A stamp in milliseconds; null for a text that is no stamp.
function parseStamp(s) {
  const m = new RegExp(`^(\\d{4}-\\d{2}-\\d{2}) (\\d{2}:\\d{2})$`).exec(String(s || '').trim());
  return m ? Date.parse(`${m[1]}T${m[2]}:00Z`) : null;
}
function goalPath(dir) { return join(dir, GOAL_FILE); }
function decisionsPath(dir) { return join(dir, DECISIONS_FILE); }
function asksPath(dir) { return join(dir, ASKS_FILE); }
export function appendLog(root, event) {
  appendLogLines(root, [event]);
}
// Several lines in one write: a bulk command's lines land together or not at all.
export function appendLogLines(root, events) {
  const at = stamp();
  appendAtomic(logPath(jarlDir(root)), '# Log\n\n', events.map((e) => `- ${at} · ${oneLine(e)}\n`).join(''));
}

// The log is one event per line: a text with line breaks never reaches it raw. A command that keeps the whole text
// elsewhere writes its first line and a pointer (firstLine); any other text that gets here has its lines joined by
// " ⏎ ", so nothing is cut.
function oneLine(event) {
  return String(event).replace(/\r\n?/g, '\n').trim().split('\n').map((l) => l.trim()).filter(Boolean).join(' ⏎ ');
}
// The first line of a text, and when there are more, how many and where the whole is kept.
export function firstLine(text, where) {
  const lines = String(text).replace(/\r\n?/g, '\n').trim().split('\n');
  const first = lines[0].trim();
  return lines.length > 1 ? `${first} (+${lines.length - 1} more lines, whole text in ${where})` : first;
}

// A ruling's slug names it for good: letters, digits, and . _ - inside, at most 80 characters. It is compared
// as a string, never read as a pattern, so `q.r` and `qxr` are two slugs and a slug with any character in it
// cannot break the reading.
export const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const DECISION_HEAD = /^## (\d{4}-\d{2}-\d{2}) · (.+?)\s*$/;

// The decisions read back: one entry per `## <date> · <slug>` heading, with its ruling, who ruled (**By:**, none
// on a ruling that records no author), what it supersedes and what superseded it.
export function loadDecisions(root) { return decisionsAt(jarlDir(root)); }
// The rulings of the record held in `dir`.
function decisionsAt(dir) {
  const path = decisionsPath(dir);
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readText(path).split('\n')) {
    const h = DECISION_HEAD.exec(line);
    if (h) { out.push({ date: h[1], slug: h[2], body: [] }); continue; }
    if (out.length) out[out.length - 1].body.push(line);
  }
  // A ruling's own fields (By, Supersedes, Superseded by, Settles) are the block the tool writes at the end of its
  // section — the trailing lines that are such a field or blank. A line of the ruling's text that happens to start
  // with **By:** is text.
  const META = DECISION_META;
  return out.map((d) => {
    let cut = d.body.length;
    while (cut > 0 && (d.body[cut - 1].trim() === '' || META.test(d.body[cut - 1]))) cut -= 1;
    const meta = d.body.slice(cut).map((l) => META.exec(l)).filter(Boolean);
    const field = (name) => meta.filter((m) => m[1] === name).map((m) => m[2].trim());
    const ruling = d.body.slice(0, cut).join('\n').trim();
    const sup = field('Superseded by').pop();
    const reach = field('Reach').pop();
    const typeLog = /^(\S+) · (\S+)/.exec(field('Type log').pop() || '');
    const ruleLog = /^(\S+) · (\S+)/.exec(field('Rule log').pop() || '');
    const first = (name) => (field(name).pop() || '').split(/\s/)[0] || null;
    return {
      date: d.date, slug: d.slug, ruling, by: field('By').pop() || null, supersedes: field('Supersedes').pop() || null, supersededBy: sup ? sup.split(/\s/)[0] : null, settles: splitList(field('Settles').pop()),
      area: field('Area').pop() || null, reach: reach !== undefined && /^\d+$/.test(reach) ? Number(reach) : null, rule: field('Rule').pop() || null,
      ratified: first('Ratified'), rejected: first('Rejected'), typeLog: typeLog ? { type: typeLog[1], datetime: typeLog[2] } : null,
      ruleLog: ruleLog ? { rule: ruleLog[1], datetime: ruleLog[2] } : null,
    };
  });
}
// The fields the tool writes into a ruling's closing block. Area, Reach and Rule come with the ruling (decide --area,
// --reach, --rule); Superseded by, Ratified, Rejected, Type log and Rule log are added to an earlier ruling in place, later.
const DECISION_META = /^\*\*(By|Supersedes|Superseded by|Settles|Area|Reach|Rule|Ratified|Rejected|Type log|Rule log):\*\*\s*(.*)$/;

// A field line added at the end of one ruling's own section, by lines: the text is never read as a pattern.
// Given `text` (the decisions as they will be written), it returns the marked text and writes nothing; without it, it marks
// the decisions of the loop in `root` and writes them once.
function markDecision(root, slug, line, { text: given } = {}) {
  const path = decisionsPath(jarlDir(root));
  const lines = (given ?? readText(path)).split('\n');
  const at = lines.findIndex((l) => { const h = DECISION_HEAD.exec(l); return h && h[2] === slug; });
  need(at !== -1, `no ruling ${slug} in ${DECISIONS_FILE}`);
  let end = lines.findIndex((l, n) => n > at && l.startsWith('## '));
  if (end === -1) end = lines.length;
  while (end - 1 > at && lines[end - 1].trim() === '') end -= 1;
  lines.splice(end, 0, line);
  if (given !== undefined) return lines.join('\n');
  writeAtomic(path, lines.join('\n'));
  return undefined;
}

export function appendDecision(root, slug, ruling, { by, supersedes, area, reach, rule } = {}) {
  need(typeof slug === 'string' && SLUG_RE.test(slug), `a ruling's slug is letters, digits and . _ - (starting with a letter or digit, at most 80 characters) — not "${slug}"; e.g. ${slugify(String(slug || 'ruling'))}`);
  const path = decisionsPath(jarlDir(root));
  const existing = existsSync(path) ? readText(path) : '# Decisions\n';
  const all = loadDecisions(root);
  need(!all.some((d) => d.slug === slug), `duplicate slug: ${slug} — a ruling that replaces it takes a new slug and --supersedes ${slug}`);
  let text = existing;
  if (supersedes !== undefined) {
    need(typeof supersedes === 'string' && supersedes !== slug, '--supersedes names the slug of an earlier ruling');
    const old = all.find((d) => d.slug === supersedes);
    need(old, `no ruling ${supersedes} in ${DECISIONS_FILE} to supersede`);
    need(!old.supersededBy, `${supersedes} is already superseded by ${old.supersededBy} — supersede that one instead`);
    text = markDecision(root, supersedes, `**Superseded by:** ${slug} (${today()})`, { text });
  }
  const meta = [by ? `**By:** ${fieldText(by)}` : null, supersedes !== undefined ? `**Supersedes:** ${supersedes}` : null, area ? `**Area:** ${area}` : null, reach !== undefined && reach !== null ? `**Reach:** ${reach}` : null, rule ? `**Rule:** ${rule}` : null].filter(Boolean).join('\n');
  writeAtomic(path, `${text.replace(/\s*$/, '')}\n\n## ${today()} · ${slug}\n${bodyText(ruling)}\n${meta ? `\n${meta}\n` : ''}`);
}

// The goal of the record held in `dir`, as text; null when it has none.
function readGoal(dir) {
  const path = goalPath(dir);
  return existsSync(path) ? readText(path) : null;
}
// The one grammar of a line the goal carries for the tool: `Check: <what runs>`, `Check (<repository>): <what runs>`,
// `Model (<tier>): <model>[, <model>…]` and `Coordinators: <name>[, <name>…]`, each as a plain line, a list item, or in
// bold. goalLines reads them all in one pass, so no other reader of the goal
// repeats the pattern. It returns
//   goal           the first line of the goal, or null where the loop has none
//   checks         every command the goal names, the loop's own first
//   checksByRepo   { bare: the loop's own commands, repos: { <repository>: its commands } }
//   models         [{ tier, models }] in the order written, `tier` as written
//   coordinators   the names written on Coordinators lines
const GOAL_LINE = /^\s*(?:[-*]\s+)?(?:\*\*)?(coordinators|check|model)(?:\s*\(([^)]+)\))?:(?:\*\*)?\s*(.+)$/i;
export function goalLines(text) {
  const out = { goal: null, checks: [], checksByRepo: { bare: [], repos: {} }, models: [], coordinators: [] };
  if (text == null) return out;
  const lines = text.split('\n');
  out.goal = lines.slice(2).find((l) => l.trim()) || '';
  for (const line of lines) {
    const m = GOAL_LINE.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[3].replace(/\*\*/g, '');
    const qualifier = m[2] && fieldText(m[2]);
    if (key === 'coordinators' && !m[2]) out.coordinators.push(...value.split(',').map((n) => fieldText(n)).filter(Boolean));
    else if (key === 'model' && m[2]) out.models.push({ tier: qualifier, models: value.split(',').map((s) => fieldText(s).replace(/^`(.*)`$/, '$1')).filter(Boolean) });
    else if (key === 'check') {
      const command = fieldText(value).replace(/^`(.*)`$/, '$1');
      if (!command) continue;
      if (qualifier) (out.checksByRepo.repos[qualifier] = out.checksByRepo.repos[qualifier] || []).push(command); else out.checksByRepo.bare.push(command);
    }
  }
  out.checks = [...out.checksByRepo.bare, ...Object.values(out.checksByRepo.repos).flat()];
  return out;
}

// ---- commands ----------------------------------------------------------------------------------

export function need(cond, msg) { if (!cond) throw new Error(msg); }

// By default the loop stays out of git: .jarl/.gitignore ignores everything under .jarl/, itself
// included, so the loop never shows in the branch's history, diffs or merges. --committed writes the
// narrow ignore file below instead and the loop is committed with the work. --permanent is committed the
// same way — a permanent record must be committed to survive — and additionally writes .jarl/.permanent, so a
// later session can tell the mode from the loop itself without being told: close (below) reads that
// marker and keeps the directory instead of removing it. Only init decides any of this: a loop keeps the mode it was
// opened in.
//
// A committed or permanent loop still gets a narrow .jarl/.gitignore: it ignores only the lock and the
// temporary files a write leaves for a moment (see withLock), so a `git add .jarl` made while a call runs
// never commits them. init writes it; a committed loop that lacks it is given it by its first
// write under the lock. The mode is read from what the file ignores, not from whether it exists: only the
// default mode's file ignores everything (a line `*`).
export const JARL_GITIGNORE = '*\n**/*\n';
export const JARL_GITIGNORE_COMMITTED = '# jarl: the loop is committed; only the write lock and half-written temporary files stay out of git\n/.lock\n/.lock.break\n.*.tmp\n';
export function outOfGit(root) {
  const path = join(jarlDir(root), '.gitignore');
  return existsSync(path) && readText(path).split('\n').some((l) => l.trim() === '*');
}
export const PERMANENT_MARKER = 'This loop is a permanent record: it is not tied to a feature branch, and `close` never removes this directory. See SKILL.md.\n';

export function cmdInit(root, goal, flags = {}) {
  need(flags.committed === undefined || flags.committed === true, '--committed takes no value — put the goal first: init "<goal>" --committed');
  need(flags.permanent === undefined || flags.permanent === true, '--permanent takes no value — put the goal first: init "<goal>" --permanent');
  need(goal, 'init requires "<goal>"');
  need(!hasLiveLoop(root), '.jarl/ already exists here with a live loop — resume it, or archive it first: jarl.mjs archive "<slug>"');
  // The profile is read and checked before anything is written: a bad one leaves no half-opened loop behind.
  const prof = flags.profile !== undefined ? readProfileFile(flags.profile) : null;
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
  writeAtomic(goalPath(jarlDir(root)), `# Goal\n\n${goal.trim()}\n\n## Assumptions\n\n## Rules that apply here\n`);
  writeAtomic(decisionsPath(jarlDir(root)), '# Decisions\n');
  writeAtomic(logPath(jarlDir(root)), '# Log\n\n');
  if (prof) writeAtomic(profilePath(root), `${JSON.stringify(prof.json, null, 2)}\n`);
  if (committed) ensureLoopMerge(root);
  appendLog(root, `opened · ${goal.trim()}${prof ? ` · profile ${prof.profile.name}` : ''}`);
  // Said once, on the command line: a goal that names no check lands its merges on testimony until a merge records one.
  const noCheck = flags.caller === 'cli' && declaredChecks(root).length === 0;
  return { dir: jarlDir(root), committed, permanent, ...(prof ? { profile: prof.profile.name } : {}), ...(noCheck ? { note: 'the goal names no check (a "Check: <command>" line, or "Check (<repo>): <command>" for one repository) — this loop lands on testimony alone until a merge records the check that decided it: merged <ids> --sha <sha> --ran "<check>" --saw "<summary>"' } : {}) };
}

// A live loop is one with a goal; a .jarl/ holding only archive/ and the mode markers has none.
export function hasLiveLoop(root) {
  return existsSync(goalPath(jarlDir(root)));
}

// The refusal for a command that needs a live loop: no .jarl/ at all, or one holding only archives.
function needLiveLoop(root, next) {
  need(existsSync(jarlDir(root)), `no .jarl/ here${next}`);
  need(hasLiveLoop(root), `no live loop here — .jarl/ holds only archived loops${next}`);
}

// What stays in .jarl/ when a loop is archived: the archive itself, the markers that say how the loop lives in
// git, so the next loop opened here keeps the same mode, and the issue templates, which belong to the place, not
// to one loop.
const ARCHIVE_KEEPS = new Set(['archive', 'templates', '.gitignore', '.gitattributes', '.permanent', '.lock', '.lock.break']);

// archive "<slug>" — put the current loop away under .jarl/archive/<yyyy.mm.dd>-<slug>/ so a new one
// can be opened here with init. Everything but the archive and the mode markers moves: issues, goal,
// decisions, log, handoff. Open work is not a refusal (archiving is how a session sets old work
// aside), but the result names it, and the loop's own log records the move before it goes.
export function cmdArchive(root, slug, flags = {}) {
  need(slug, 'archive requires "<slug>" — a short name for the loop being put away');
  need(hasLiveLoop(root), existsSync(jarlDir(root)) ? 'no loop to archive here — .jarl/ holds only earlier archives; open one with: jarl.mjs init "<goal>"' : 'no .jarl/ here');
  needLifecycle(root, 'archive', flags.caller);
  const name = `${today().replace(/-/g, '.')}-${slugify(slug)}`;
  const dest = join(jarlDir(root), 'archive', name);
  need(!existsSync(dest), `.jarl/archive/${name} already exists — pick another slug`);
  const profile = loadProfile(root);
  const left = loadIssues(root).filter((i) => profile.unfinished(i.status)).map((i) => i.id);
  appendLog(root, `archived → .jarl/archive/${name}${left.length ? ` · ${left.length} still open or in progress: ${left.join(', ')}` : ''}`);
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(jarlDir(root))) {
    if (ARCHIVE_KEEPS.has(entry)) continue;
    renameRetry(join(jarlDir(root), entry), join(dest, entry));
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
  const raw = readText(path);
  const t = parseIssue(FIELD_RE.test(raw.split('\n')[0]) ? `# template\n${raw}` : raw, path);
  const section = (k) => (t.sections[k] !== undefined && t.sections[k].trim() ? t.sections[k].trim() : undefined);
  return {
    kind: t.fields.kind || undefined, prio: t.fields.priority || undefined, tier: t.fields.tier || undefined,
    tags: t.fields.tags || undefined, files: t.fields.files || undefined,
    what: section('what'), why: section('why'), acceptance: section('acceptance'), changelog: section('changelog'),
    // Every field and section as read, for the ones a loop's profile declares (see cmdNew).
    allFields: t.fields, section,
  };
}

// Where a loop's directory stands among the worktrees of its git repository, read-only (git rev-parse and the
// worktrees git lists). Null outside git. `main` is the main checkout (null for a bare repository), `mainRoot` the same
// directory of the loop in it, `linked` whether `root` is inside a linked worktree rather than the main checkout, and
// `copies` the loop's directory in every worktree, the main checkout first. The one helper that finds the main checkout
// through git's own list of worktrees; the commands that must act on the main checkout's loop reuse it.
export function mainCheckoutOf(root) {
  const top = git(root, ['rev-parse', '--show-toplevel']);
  const entries = top === null ? null : worktreesOf(root);
  if (entries === null) return null;
  const here = canonical(top);
  const rel = relative(here, canonical(root));
  const main = entries.length && !entries[0].bare ? canonical(entries[0].path) : null;
  return {
    main, mainRoot: main === null ? null : join(main, rel), linked: main !== null && main !== here,
    copies: entries.filter((e) => !e.bare).map((e) => join(canonical(e.path), rel)),
  };
}
// The one lookup of a worktree's state, asked of git first (the worktrees git lists in `repo`). It finds the worktree
// holding the lease's `branch`, and, for a lease that stored a path, the worktree at `stored`. The states:
//   here       the worktree's directory is on this machine;
//   elsewhere  git lists it locked (`reason` when it has one) and its directory is not visible from here — a container's;
//   invisible  git lists it but its directory is not visible from here: not marked prunable, or prunable with its parent
//              directory missing too (a whole directory tree on another machine) — not gone;
//   gone       its directory is missing while the parent directory is here: removed under a live lease;
//   none       no worktree holds the branch (and `stored`, when given, is neither listed nor a directory here).
// The fallback for a stored path git does not list: a directory here is `here`, a missing one with an existing parent is
// `gone`, a missing one whose parent is missing too is `invisible`. Returns { state, path, reason? }; `path` is null for none.
export function worktreeState(repo, branch, stored) {
  const sameAs = (a, b) => canonical(dirname(a)) === canonical(dirname(b)) && basename(a) === basename(b);
  const entries = (repo && worktreesOf(repo)) || [];
  const found = (branch && entries.find((e) => e.branch === branch)) || (stored && entries.find((e) => sameAs(e.path, stored)));
  if (found) {
    if (existsSync(found.path)) return { state: 'here', path: found.path };
    if (found.locked) return { state: 'elsewhere', path: found.path, ...(found.reason ? { reason: found.reason } : {}) };
    if (found.prunable && existsSync(dirname(found.path))) return { state: 'gone', path: found.path };
    return { state: 'invisible', path: found.path };
  }
  if (!stored) return { state: 'none', path: null };
  if (existsSync(stored)) return { state: 'here', path: stored };
  return { state: existsSync(dirname(stored)) ? 'gone' : 'invisible', path: stored };
}
// The highest issue number any copy of this loop holds (the main checkout and every linked worktree), 0 when none.
function highestAcrossWorktrees(root) {
  const found = mainCheckoutOf(root);
  let top = 0;
  for (const copy of found ? found.copies : []) {
    const dir = issuesDir(copy);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) { const m = ISSUE_FILE_RE.exec(f); if (m) top = Math.max(top, Number(m[1])); }
  }
  return top;
}

// When a tier is light, standard or strong: the criteria the skill gives, as a prior the measurements then refine.
export const TIER_CRITERIA = {
  light: 'a check or test decides, the scope is written down, nothing that protects changes',
  standard: 'a clear acceptance and a known place in the code',
  strong: 'unknown cause (a flaky test too), a design, a record format or contract, security or data integrity, anything that weakens a protection, a takeover after three rounds, finishing another worker\'s uncommitted work',
};
function tierNote(profile, tier) {
  const builtIn = profile.tiers.length === TIERS.length && profile.tiers.every((t, k) => t === TIERS[k]);
  return `note: no --tier given, so tier ${tier} was recorded${builtIn ? ` — ${TIERS.map((t) => `${t}: ${TIER_CRITERIA[t]}`).join('; ')}` : ' (this loop\'s default)'}; name it with --tier`;
}

export function cmdNew(root, title, rawFlags) {
  need(title, 'new requires "<title>"');
  // A title is the heading line of the issue: line breaks in it become spaces, so the lines after the first are not lost to the heading.
  if (/[\r\n]/.test(title)) title = String(title).split(/\r\n?|\n/).map((l) => l.trim()).filter(Boolean).join(' ');
  needLiveLoop(root, ' — run: jarl.mjs init "<goal>"');
  // A linked worktree of a committed loop holds only the copy it was cut with, so a number taken there may already be used
  // in the main checkout: file from the main checkout.
  const placed = mainCheckoutOf(root);
  need(!placed || !placed.linked || !existsSync(jarlDir(placed.mainRoot)), `${root} is a linked worktree of ${placed?.mainRoot}, which holds this loop: its copy here may lag, and the number would be used twice — file from the main checkout: pass --root ${placed?.mainRoot}`);
  let flags = rawFlags;
  let fromTemplate = {};
  if (rawFlags.template !== undefined) {
    const t = readTemplate(root, rawFlags.template);
    fromTemplate = t;
    flags = { ...rawFlags };
    for (const k of ['kind', 'prio', 'tier', 'tags', 'files', 'what', 'why']) if (flags[k] === undefined && t[k] !== undefined) flags[k] = t[k];
  }
  const profile = loadProfile(root);
  // The profile's fields and sections: a flag's value, else the template's, else the field's default. A required
  // field with none of them is refused; a value outside a field's enum is refused.
  const given = namedPairs(flags.field, 'field', profile.fields.map((f) => f.name), 'field');
  const fields = profile.fields.map((f) => {
    const raw = given.has(f.name) ? given.get(f.name) : fromTemplate.allFields?.[f.key] || f.default || '';
    const v = fieldValue(profile, f, raw);
    need(!f.required || v, `${f.name} is required by this loop's profile — give it: --field "${f.name}=<value>"${f.enum ? ` (one of: ${f.enum.join(', ')})` : ''}`);
    return [f.name, v];
  });
  const givenSections = namedPairs(flags.section, 'section', profile.sections, 'section');
  needNoFieldTags(flags.what, 'the What text');
  needNoFieldTags(flags.why, 'the Why text');
  for (const [h, v] of givenSections) needNoFieldTags(v, `the ${h} text`);
  const sections = profile.sections.map((h) => [h, givenSections.has(h) ? bodyText(givenSections.get(h)) : bodyText(fromTemplate.section?.(h.toLowerCase()))]);
  if (profile.acceptance && fromTemplate.acceptance === undefined && fromTemplate.section) fromTemplate.acceptance = fromTemplate.section(profile.acceptance.toLowerCase());
  const kind = flags.kind || profile.kindDefault;
  need(profile.kinds.includes(kind), `--kind must be one of: ${profile.kinds.join(', ')}`);
  const priority = String(flags.prio || '2');
  need(PRIORITIES.includes(priority), '--prio must be 1, 2 or 3');
  const tier = String(flags.tier || profile.tierDefault);
  need(profile.tiers.includes(tier), `--tier must be one of: ${profile.tiers.join(', ')} — the tier of model the worker is raised on, mapped to a model by the platform running the loop`);
  const repos = flags.repo !== undefined ? repoList(root, flags.repo) : [];
  const source = sourceList(flags.source);
  const after = flags.after !== undefined ? afterList(root, null, flags.after) : [];
  // The number is claimed by creating the file with a link, which never overwrites: when another
  // writer got there first (the lock makes that rare, not impossible — a hand-made file, a stale
  // lock broken early), the next number is tried instead of two issues sharing one.
  const dir = issuesDir(root);
  const taken = () => readdirSync(dir).map((f) => ISSUE_FILE_RE.exec(f)).filter(Boolean).map((m) => Number(m[1]));
  // The highest number over this loop and its copies in every other worktree (read-only), so a lagging copy cannot hand
  // out a number already used elsewhere. The issue files stay the only source: there is no counter file.
  const elsewhere = highestAcrossWorktrees(root);
  let n = Math.max(taken().reduce((m, x) => Math.max(m, x), 0), elsewhere) + 1;
  for (let tries = 0; ; tries += 1) {
    const id = padId(n);
    // The first issue of 1000 or more is a file a reader that knows only format 1 would skip in silence: the format is raised first.
    if (needsRaisedFormat(id)) raiseFormat(root);
    const file = join(dir, `${id}-${slugify(title)}.md`);
    const tmp = join(dir, `.${id}.${process.pid}.tmp`);
    writeFileSync(tmp, renderIssue({
      id, title, status: profile.initial, kind, priority, tier, fields, sections, acceptanceHeading: profile.acceptance || 'Acceptance',
      tags: splitList(flags.tags), files: pathList(flags.files), repo: repos.join(', '), foundBy: flags['found-by'] || 'jarl',
      where: flags.where, what: bodyText(flags.what), why: bodyText(flags.why), source, after,
      // A template's Acceptance and Changelog are taken as written (a list already); a flag replaces them.
      acceptance: flags.acceptance !== undefined ? acceptanceText(flags.acceptance) : bodyText(fromTemplate.acceptance),
      changelog: flags.changelog !== undefined ? changelogText(flags.changelog) : bodyText(fromTemplate.changelog),
    }));
    let claimed = !taken().includes(n);
    if (claimed) { try { claimed = claimFile(tmp, file); } catch (e) { unlinkSync(tmp); throw e; } }
    unlinkSync(tmp);
    if (claimed) {
      appendLog(root, `filed ${id} · ${title}${rawFlags.template !== undefined ? ` · template ${rawFlags.template}` : ''}`);
      // Said on the command line only (a library caller gets none, and its result does not change): the tier it used.
      const note = rawFlags.caller === 'cli' && rawFlags.tier === undefined ? { note: tierNote(profile, tier) } : {};
      return { id, file, ...(rawFlags.template !== undefined ? { template: rawFlags.template } : {}), ...note };
    }
    need(tries < 100, 'could not claim a free issue number after 100 tries');
    n = Math.max(n + 1, taken().reduce((m, x) => Math.max(m, x), 0) + 1);
  }
}

function splitList(v) { return String(v || '').split(',').map((s) => s.trim()).filter(Boolean); }
// A path written into an issue (Files, Repo) is read on every OS the loop is checked out on, and git names files with
// '/' everywhere: a path given on Windows is stored with '/' (C:\a\b → C:/a/b, which Windows reads the same). Elsewhere a
// backslash is an ordinary file-name character and is kept.
export function portablePath(p, platform = process.platform) { return platform === 'win32' ? p.replace(/\\/g, '/') : p; }
function pathList(v) { return splitList(v).map((p) => portablePath(p)); }

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

// The After issues not yet settled: an issue in a settles-dependents status settles (built-in: done and dropped);
// any other does not (open, in progress, deferred). An After id with no issue behind it (removed by hand) holds
// nothing back.
export function waitingOn(issue, byId, profile = DEFAULT_PROFILE) {
  return issue.after.filter((id) => byId.has(id) && !profile.is(byId.get(id).status, 'settles-dependents'));
}

// body <id> — the Where field and the What, Why and Acceptance sections, set or replaced. Evidence is never
// written here: it is the record of what was done, appended by evidence, never replaced.
export function cmdBody(root, rawId, flags) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  const profile = loadProfile(root);
  const parts = ['title', 'where', 'what', 'why', 'acceptance', 'changelog', 'section'].filter((k) => flags[k] !== undefined);
  need(parts.length, 'body needs at least one of --title, --where, --what, --why, --acceptance, --changelog, --section');
  const title = flags.title === undefined ? null : fieldText(flags.title);
  need(flags.title === undefined || title, '--title needs a title');
  const sections = namedPairs(flags.section, 'section', profile.sections, 'section');
  needNoFieldTags(flags.what, 'the What text');
  needNoFieldTags(flags.why, 'the Why text');
  for (const [h, v] of sections) needNoFieldTags(v, `the ${h} text`);
  let text = readText(issue.file);
  // The title is the heading's text; the file keeps its name, so the number and the slug a branch was cut from stay.
  if (title) text = text.replace(idRe('^(#\\s+{id}\\s+·\\s+).*$', 'm'), (_, head) => `${head}${title}`);
  if (flags.where !== undefined) text = setField(text, 'Where', fieldText(flags.where));
  if (flags.what !== undefined) text = setSection(text, 'What', bodyText(flags.what));
  if (flags.why !== undefined) text = setSection(text, 'Why', bodyText(flags.why));
  if (flags.acceptance !== undefined) text = setSection(text, acceptanceHeading(issue, profile), acceptanceText(flags.acceptance));
  for (const [h, v] of sections) text = setSection(text, h, bodyText(v));
  if (flags.changelog !== undefined) text = setSection(text, 'Changelog', changelogText(flags.changelog));
  writeAtomic(issue.file, text);
  const named = parts.flatMap((k) => (k === 'section' ? [...sections.keys()] : [k]));
  appendLog(root, `${issue.id} body · ${named.join(', ')}${title ? ` · title was "${issue.title}"` : ''}`);
  return { id: issue.id, set: named };
}

export function cmdSource(root, rawId, list) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  const sources = sourceList(list);
  need(sources.length, 'source requires <report dir>#<finding id>[,...]');
  writeAtomic(issue.file, setField(readText(issue.file), 'Source', sources.join(', ')));
  appendLog(root, `${issue.id} source · ${sources.join(', ')}`);
  return { id: issue.id, sources };
}

export function cmdAfter(root, rawId, raw, { clear = false } = {}) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  if (clear) {
    need(raw === undefined, 'after takes either <ids> or --clear, not both');
    need(issue.fields.after !== undefined, `${issue.id} has no After field to clear`);
    writeAtomic(issue.file, removeFirstField(readText(issue.file), 'After'));
    appendLog(root, `${issue.id} after · cleared`);
    return { id: issue.id, after: [], cleared: true };
  }
  need(raw !== undefined, 'after requires <ids> — the issues this one waits on (or --clear)');
  const ids = afterList(root, issue.id, raw);
  writeAtomic(issue.file, setField(readText(issue.file), 'After', ids.join(', ')));
  appendLog(root, `${issue.id} after ${ids.join(', ')}`);
  return { id: issue.id, after: ids };
}

export function cmdList(root, flags) {
  const profile = loadProfile(root);
  let rows = loadIssues(root);
  // Finished business (terminal: done, dropped, and deferred work, which waits) is not in the default list:
  // --status or --all shows it.
  if (!flags.all && !flags.status) rows = rows.filter((i) => profile.unfinished(i.status));
  if (flags.status) rows = rows.filter((i) => i.status === flags.status);
  if (flags.kind) rows = rows.filter((i) => i.kind === flags.kind);
  if (flags.tag) rows = rows.filter((i) => i.tags.includes(flags.tag));
  if (flags.prio) rows = rows.filter((i) => i.priority === String(flags.prio));
  // --match <field>=<value> (repeatable, all must hold): any header field — the tool's own, Kind, Tier or one the
  // profile declares — compared as written, without case in the name. An empty value matches an empty field.
  for (const w of [].concat(flags.match ?? [])) {
    const at = String(w).indexOf('=');
    need(at > 0, `--match takes <field>=<value> (got "${w}")`);
    const name = String(w).slice(0, at).trim().toLowerCase();
    const known = [...TOOL_FIELDS, 'Kind', 'Tier', ...profile.fields.map((f) => f.name)];
    need(known.some((k) => k.toLowerCase() === name), `--match names a header field — one of: ${known.join(', ')} (got "${name}")`);
    const value = fieldText(String(w).slice(at + 1));
    rows = rows.filter((i) => (name === 'status' ? i.status : fieldText(i.fields[name])) === value);
  }
  if (flags.grep) {
    const re = new RegExp(flags.grep, 'i');
    rows = rows.filter((i) => re.test(readText(i.file)));
  }
  return rows.sort((a, b) => a.priority.localeCompare(b.priority) || cmpId(a.id, b.id));
}

// Bulk ids: evidence, review, set, tag and prio take one id or several (see expandIds). Every id is resolved and every
// precondition checked before anything is written, so a call either lands on all of them or on none;
// each issue still gets its own log line.
function issuesFor(root, rawIds, readOnly = false) {
  const ids = expandIds(rawIds);
  const all = loadIssues(root);
  const missing = ids.filter((id) => !all.some((i) => i.id === id));
  need(missing.length === 0, `no such issue: ${missing.join(', ')}${ids.length > 1 ? ' — nothing was written' : ''}`);
  if (!readOnly && ids.some(needsRaisedFormat)) raiseFormat(root);
  return ids.map((id) => all.find((i) => i.id === id));
}
// One id in, the same object as always out; a list in, an array of them.
function oneOrMany(rawIds, results) { return isBulk(rawIds) ? results : results[0]; }

// The refusal for a move into a needs-reason status given without one; the built-in two say what the status is for.
const REASON_TEXT = {
  dropped: 'dropped needs a reason: jarl.mjs set <id> dropped "<why>"',
  deferred: 'deferred needs a reason: jarl.mjs set <id> deferred "<why>" — work that waits, not work that is gone',
};
// The line a needs-reason status writes under Evidence: its name with a capital, then the reason (Dropped: …).
export function reasonWord(status) { return status.charAt(0).toUpperCase() + status.slice(1); }

// Who asked for the move: 'cli' — the command line and the MCP tools over it, which always say so — or 'record', a
// library call through record.mjs (the default). A status the profile marks "set-by": "record" refuses 'cli'.
export const SET_CALLERS = ['cli', 'record'];

// Where `set <ids> <name> …` goes, decided here and nowhere else: a field the profile declares (Kind and Tier too, when it
// declares them) and that is no status, the built-in Resources field, or a move into a status.
function setRoute(profile, name) {
  if (name === undefined || profile.statuses.includes(name)) return 'status';
  if (profile.field(name)) return 'field';
  return String(name).toLowerCase() === 'resources' ? 'resources' : 'status';
}
// The lease flags (--branch, --worker, --model, --worktree) a call gives. They belong to a move into a status that holds
// a claim; a call that writes a field refuses them.
const LEASE_FLAGS = ['branch', 'worker', 'model', 'worktree'];
function leaseFlagsGiven(flags) { return LEASE_FLAGS.filter((k) => flags[k] !== undefined); }
function needNoLeaseFlags(flags, what) {
  const lease = leaseFlagsGiven(flags);
  need(!lease.length, `--${lease[0]} goes with a status, not with ${what}`);
}
// set with the name taken as a status (record.setStatus), or as a field the profile declares (record.setField): the
// refusal of a name that is the other kind, in the command line's own words.
export function cmdSetStatus(root, rawIds, status, why, flags = {}) {
  const profile = loadProfile(root);
  need(profile.statuses.includes(status) || !profile.field(status), `${status} is a field this loop's profile declares, not a status — setField writes it`);
  return cmdSet(root, rawIds, status, why, flags);
}
export function cmdSetField(root, rawIds, field, value, flags = {}) {
  const profile = loadProfile(root);
  need(profile.field(field) && !profile.statuses.includes(field), `${field} is not a field this loop's profile declares${profile.declaredFields.length ? ` — it declares ${profile.declaredFields.map((f) => f.name).join(', ')}` : ''}`);
  return cmdSet(root, rawIds, field, value, flags);
}

export function cmdSet(root, rawIds, status, why, flags = {}) {
  const caller = flags.caller ?? 'record';
  need(SET_CALLERS.includes(caller), `caller must be one of: ${SET_CALLERS.join(', ')} (got "${caller}")`);
  const profile = loadProfile(root);
  const route = setRoute(profile, status);
  if (route === 'field') return setDeclaredField(root, rawIds, profile.field(status), why, flags);
  if (route === 'resources') return setResources(root, rawIds, why, flags);
  // ready and the review words are views, not statuses: say which view answers the question the worker was asking.
  need(profile.statuses.includes(status) || !/^(ready|review|in[-_ ]?review|ready[-_ ]for[-_ ]review|reviewing)$/i.test(String(status ?? '')), `${status} is a view here, not a status: \`next\` lists the issues ready to start, and \`status\` and \`resume\` mark each in-flight issue with what the record says (no evidence rows yet; rows and no verdict, so it waits for a reviewer; changes requested; approved and queued). Nothing needs setting: record the rows with \`evidence\`, and the reviewer's verdict with \`review\`. A loop that wants an explicit review status can declare one in its profile. Statuses here: ${profile.statuses.join(', ')}`);
  need(profile.statuses.includes(status), `status must be one of: ${profile.statuses.join(', ')}${profile.declaredFields.length ? ` — or a field this loop's profile declares: ${profile.declaredFields.map((f) => f.name).join(', ')}` : ''}`);
  need(caller !== 'cli' || profile.setBy(status) !== 'record', `${status} is set by the record only — this loop's profile (${profile.name}) marks it "set-by": "record", so jarl set and the MCP tools cannot move an issue into it; the tool that runs the loop does${profile.scheduler ? ` (${profile.scheduler})` : ''}`);
  const holds = profile.is(status, 'holds-claim');
  const lease = leaseFlagsGiven(flags);
  need(!lease.length || holds, `--${lease[0]} goes with ${profile.with('holds-claim').join(' or ')} only — it records who works on the issue and where`);
  for (const k of lease) need(typeof flags[k] === 'string' && fieldText(flags[k]), `--${k} needs a value`);
  const model = flags.model !== undefined ? modelValue(flags.model) : undefined;
  // A name is one value: with the log's own separator in it, the lease line would carry a field the caller did not give.
  for (const k of ['worker', 'branch']) need(flags[k] === undefined || !` ${fieldText(flags[k])} `.includes(' · '), `--${k} is one name — not a phrase with " · " in it (got "${fieldText(flags[k])}")`);
  const issues = issuesFor(root, rawIds);
  need(!profile.is(status, 'needs-reason') || why, REASON_TEXT[status] || `${status} needs a reason: jarl.mjs set <id> ${status} "<why>"`);
  const nothing = issues.length > 1 ? ' — nothing was written' : '';
  // base: the branch the composer landed the merge into, for the done gate's requires-merged (else the branch checked
  // out). A library call only: the command line has no --base, and dispatch never passes one through.
  need(flags.base === undefined || caller === 'record', 'base is named by a library call through record.mjs only — the command line checks against the branch checked out');
  need(flags.base === undefined || (typeof flags.base === 'string' && fieldText(flags.base) !== '' && !flags.base.startsWith('-')), 'base names a branch or ref — the one the merge landed in');
  if (profile.is(status, 'closes-record')) {
    const loop = readLoop(jarlDir(root));
    for (const issue of issues) { const refusal = doneRefusalIn(root, loop, issue, flags.base); need(!refusal, `${refusal}${nothing}`); }
  }
  // One lease for the whole call: every issue in a package gets the same Branch, Worker, Worktree and Since.
  // A relative worktree path is read from the loop's root, like --repo, so it means the same from anywhere.
  const since = stamp();
  const worktree = flags.worktree !== undefined ? resolve(root, fieldText(flags.worktree)) : undefined;
  const writes = issues.map((issue) => {
    let text = readText(issue.file);
    text = setField(text, 'Status', status);
    if (holds) {
      if (flags.branch !== undefined) text = setField(text, 'Branch', fieldText(flags.branch));
      if (flags.worker !== undefined) text = setField(text, 'Worker', fieldText(flags.worker));
      // The model belongs to the worker it was raised for: a new worker named without one does not inherit the last one's.
      if (model !== undefined) text = setField(text, 'Model', model);
      else if (flags.worker !== undefined) text = removeFields(text, ['Model']);
      if (worktree !== undefined) text = setField(text, 'Worktree', worktree);
      text = setField(text, 'Since', since);
    } else {
      text = removeFields(text, LEASE_FIELDS);
    }
    // What was already written under Evidence stays: a drop or a deferral is one more line in the history,
    // not a reset of it.
    if (profile.is(status, 'needs-reason')) {
      const written = (issue.sections.evidence || '').trim();
      const line = `${reasonWord(status)}: ${why}`;
      text = setSection(text, 'Evidence', written ? `${written}\n\n${line}` : line);
    }
    return { issue, text };
  });
  for (const w of writes) writeAtomic(w.issue.file, w.text);
  // The model goes before the worker: the worker is read as the text after "· worker " up to "· worktree " or the end of
  // the line, so a model written after it would become part of the worker's name.
  const leaseNote = [flags.branch !== undefined && `branch ${fieldText(flags.branch)}`, model !== undefined && `model ${model}`, flags.worker !== undefined && `worker ${fieldText(flags.worker)}`, worktree !== undefined && `worktree ${worktree}`].filter(Boolean).join(' · ');
  // The reason is free text in front of the lease's fields: on a lease its own " · " is neutralised, so no reason can be
  // read as a branch, a model or a worker.
  const reason = holds && why ? String(why).replace(/ +· +/g, ' - ') : why;
  appendLogLines(root, issues.map((issue) => `${issue.id} → ${status}${reason ? ` · ${reason}` : ''}${leaseNote ? ` · ${leaseNote}` : ''}`));
  // Said on the command line only, and only in a loop that declares model lines: a lease with no model (once per call).
  const leaseNoModel = caller === 'cli' && holds && model === undefined && modelLines(root).declared ? 'no --model on this lease — the loop declares its models, and a model that is not recorded can never be recovered' : null;
  return oneOrMany(rawIds, issues.map((issue, n) => ({ id: issue.id, status, ...(holds ? { since, ...(flags.branch !== undefined ? { branch: fieldText(flags.branch) } : {}), ...(flags.worker !== undefined ? { worker: fieldText(flags.worker) } : {}), ...(model !== undefined ? { model } : {}), ...(worktree !== undefined ? { worktree } : {}) } : {}), ...(profile.is(status, 'closes-record') ? doneNote(issue, root) : {}), ...(leaseNoModel && n === 0 ? { note: leaseNoModel } : {}) })));
}

// set <ids> <field> <value>: one declared field written on every issue in the call (checked against its enum first),
// with one log line each. An empty value clears it, unless the field is required (or is Kind or Tier).
function setDeclaredField(root, rawIds, field, value, flags) {
  needNoLeaseFlags(flags, `the field ${field.name}`);
  need(value !== undefined, `set <ids> ${field.name} "<value>" — the value is required${field.enum ? ` (one of: ${field.enum.join(', ')})` : ''}`);
  const profile = loadProfile(root);
  const v = fieldValue(profile, field, value);
  need(v || (!field.required && !field.builtin), `${field.name} cannot be empty${field.enum ? ` — one of: ${field.enum.join(', ')}` : ''}`);
  const issues = issuesFor(root, rawIds);
  for (const issue of issues) writeAtomic(issue.file, setField(readText(issue.file), field.name, v));
  appendLogLines(root, issues.map((issue) => `${issue.id} field ${field.name} · ${v || '(cleared)'}`));
  return oneOrMany(rawIds, issues.map((issue) => ({ id: issue.id, field: field.name, value: v })));
}

// set <ids> resources "a, b": the exclusive resources an issue holds for the whole life of its lease (a port, a database
// server, the machine's load), loop-wide and not files. Names are single words; an empty value clears the field. Only next
// reads it: check, queue and the file rules do not.
function setResources(root, rawIds, value, flags) {
  needNoLeaseFlags(flags, 'the field Resources');
  need(value !== undefined, 'set <ids> resources "<name>[, <name>...]" — the value is required (an empty one clears the field)');
  const names = [];
  for (const n of splitList(fieldText(value))) {
    need(/^[A-Za-z0-9._:/-]+$/.test(n), `resource names are single words of letters, digits and . _ : / - ("${n}" is not): name the thing, e.g. gate, db-server, port-8080`);
    if (!names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
  }
  const issues = issuesFor(root, rawIds);
  for (const issue of issues) writeAtomic(issue.file, setField(readText(issue.file), 'Resources', names.join(', ')));
  appendLogLines(root, issues.map((issue) => `${issue.id} field Resources · ${names.join(', ') || '(cleared)'}`));
  return oneOrMany(rawIds, issues.map((issue) => ({ id: issue.id, field: 'Resources', value: names.join(', ') })));
}

// Why an issue may not go done, or null when it may: at least one --ran/--saw evidence row logged since the issue
// last went in progress (or was reopened, or — never in progress — was filed; free-text notes never count alone), and a live approve by someone
// other than its worker (see gateState) — by a fresh reviewer when the issue carries code (a Branch or Merged field;
// see carriesCode). It gates only the record: nothing here stops code from landing.
// A profile's done-gate changes the last two: requires-merged also asks for a recorded merge whose sha is in the base
// (see mergeRefusal), and approve: none (allowed only with requires-merged) drops the approve — the gate that landed
// the merge stands behind the issue instead of a reviewer. The evidence rows are asked for either way.
// doneRefusal reads the loop for one issue; a caller checking several issues reads it once and asks doneRefusalIn.
export function doneRefusal(root, issue) { return doneRefusalIn(root, readLoop(jarlDir(root)), issue, undefined); }
// `base`: the branch or ref the merge landed in, when the caller names one.
function doneRefusalIn(root, loop, issue, base) {
  const { profile } = loop;
  const g = gateOf(loop, issue.id);
  const how = `jarl.mjs evidence ${issue.id} --ran "<command>" --saw "<what it printed>"`;
  if (g.unresolvedRetractions.length) return `${issue.id} records a retraction of evidence row ${g.unresolvedRetractions.join(', ')} that matches no evidence line of the log, so which row it retracts is unknown and a retracted row might be counted — done refuses until that log line is repaired`;
  if (!workEvidence(issue, profile)) return `${issue.id} has no evidence yet — record it first: ${how}`;
  if (!g.tracked && !evidenceRows(issue).length) return `${issue.id} has no --ran/--saw evidence row — a free-text note alone is not proof of the work: ${how}`;
  if (g.tracked && !g.rowsSince) return `${issue.id} has no --ran/--saw evidence row recorded since it was ${g.anchor.what === 'filed' ? 'filed' : `moved → ${g.anchor.what}`} (${g.anchor.at}) — a free-text note, or a row written before that (before a start or a reopen), is not proof of the work: ${how}`;
  if (profile.doneGate['requires-merged']) { const m = mergeRefusal(root, issue, base); if (m) return m; }
  if (profile.doneGate.approve === 'none') return null;
  const code = carriesCode(issue);
  if (g.selfApproved) return `${issue.id}'s live approve is by a worker of this issue or its branch — a self-approve does not count as review: jarl.mjs review ${issue.id} approve --by <${code ? 'fresh reviewer' : 'fresh reviewer|jarl'}> "<findings>"`;
  if (!g.approved) return `${issue.id} has no approving review newer than its last round${g.tracked ? ' or reopen' : ''} — a fresh reviewer reads the issue and the diff first: jarl.mjs review ${issue.id} approve|changes --by <reviewer> "<findings>"`;
  if (code && !g.fresh) return `${issue.id} ${freshRuleText(issue, g.live)}: jarl.mjs review ${issue.id} approve|changes --by <fresh reviewer> "<findings>"`;
  return null;
}

// The done gate's requires-merged: the issue records a merge (merged --sha) and that commit is in the base — the branch
// checked out where the merge was recorded (Merged's "in <repo>", else the issue's Repo, else the loop's own
// repository), or the branch a library caller names as opts.base (a composer that lands into a branch nobody has
// checked out, such as a team branch, names it). A sha the repository does not know, or one not reachable from the
// base, is refused: a merge recorded is not a merge landed until the base holds it.
function mergeRefusal(root, issue, base) {
  const m = mergedOf(issue);
  const gate = 'this loop\'s profile closes an issue only on a landed merge (done-gate "requires-merged": true)';
  if (!m) return `${issue.id} records no merge — ${gate}: jarl.mjs merged ${issue.id} --sha <sha> once it has landed`;
  const repos = issueRepoPaths(root, issue, m.repo ? [m.repo] : undefined).filter(isGitRepo);
  if (!repos.length) return `${issue.id} records Merged ${m.sha}, but no repository it names is a git repository here — ${gate}, and the merge cannot be checked`;
  const ref = base === undefined ? 'HEAD' : base;
  if (base !== undefined && repos.every((r) => git(r, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]) === null)) return `${issue.id}: the base ${base} is not a branch or commit in ${repos.join(' or ')} — ${gate}, and the merge cannot be checked`;
  const landed = repos.some((r) => git(r, ['merge-base', '--is-ancestor', m.sha, ref]) !== null);
  if (landed) return null;
  const where = repos.map((r) => `${base === undefined ? defaultBase(r) : base} in ${r}`).join(' or ');
  return `${issue.id} records Merged ${m.sha}, which is not in the base (${where}) — ${gate}; merge it, or record the sha that landed: jarl.mjs merged ${issue.id} --sha <sha>`;
}

// The fresh-review rule, said the same way by done, review and merged: an issue that carries code (a Branch or a
// Merged field) needs its live approve from a fresh reviewer — an agent that neither wrote the code nor runs the loop.
function freshRuleText(issue, live) {
  const who = live && live.by ? `${live.by} (${live.kind})` : 'a reviewer not recorded (an approve from before --by)';
  return `carries code (${issue.fields.merged ? 'Merged' : 'Branch'} is recorded) and its live approve is by ${who} — the fresh-review rule: a code issue needs an approve from a fresh reviewer, an agent that neither wrote the code nor runs the loop; a coordinator's approve does not clear it`;
}

// Said, never refused: done closes an issue whose acceptance is missing, or has more lines than the
// --ran/--saw rows recorded, or that was merged while its CI is not green yet, but the output says so, so
// the gap is seen by whoever closed it.
function doneNote(issue, root) {
  const notes = [];
  const lines = acceptanceLineCount(issue);
  if (!lines) notes.push('no acceptance line on file');
  else {
    const rows = evidenceRows(issue).length;
    if (rows < lines) notes.push(`${lines} acceptance line(s), ${rows} --ran/--saw row(s)`);
  }
  const m = mergedOf(issue);
  // A merge that carries its check (a passing row, or the red it landed on) needs no CI state to be told apart from an unrecorded one.
  const decided = () => { const line = lastMerge(journalById(root).get(issue.id) || []); return Boolean(line && (line.check || line.red)); };
  if (m && m.ci !== 'green' && m.ci !== 'none' && !(m.ci === null && decided())) notes.push(`merged ${m.sha}, CI ${m.ci || 'not recorded'} — record it when known: jarl.mjs merged ${issue.id} --ci green|red`);
  return notes.length ? { note: notes.join('; ') } : {};
}

// The merge an issue records: **Merged:** <sha>[ in <repo>] and **CI:** pending|green|red|none. Null when
// the issue records none.
export function mergedOf(issue) {
  const m = /^(\S+)(?: in (.+))?$/.exec(issue.fields.merged || '');
  if (!m) return null;
  const ci = CI_STATES.includes(issue.fields.ci) ? issue.fields.ci : null;
  return { sha: m[1], repo: m[2] || null, ci };
}

// merged <ids> --sha <sha> [--ran "<check>" --saw "<summary>" | --red <id>] [--ci pending|green|red|none] [--repo <path>]
// — the merge as a field, not as prose: the sha, where it landed, the check that decided it and the CI state. --ran and
// --saw record the check's evidence row on every issue of the call and name the check in the merge line; --red <id> records
// a merge that landed while its check was red for a cause outside the branch, which issue <id> tracks, and is never counted
// as a passing check. The CI state is recorded only when given, except for a library call, which keeps pending as the
// default. --ci alone, on issues that already record a merge, moves only the CI state. A sha the repository does not know
// is noted, never refused (the merge may be in a clone not fetched here). It records; it never decides whether anything
// may land.
export function cmdMerged(root, rawIds, flags) {
  const cli = flags.caller === 'cli';
  need(flags.sha !== undefined || flags.ci !== undefined, 'merged needs --sha <sha> (and optionally --ci), or --ci alone on issues that already record a merge');
  if (flags.sha !== undefined) need(/^[0-9a-f]{4,64}$/i.test(String(flags.sha)), `--sha is a commit id, 4 to 64 hex characters (got "${flags.sha}")`);
  if (flags.ci !== undefined) need(CI_STATES.includes(flags.ci), `--ci must be one of: ${CI_STATES.join(', ')} — none means the repository has no CI to wait for`);
  need(flags.repo === undefined || flags.sha !== undefined, '--repo names where --sha landed; give it with --sha');
  const rows = flags.ran !== undefined || flags.saw !== undefined ? rowsOf(flags) : null;
  need(!rows || flags.sha !== undefined, '--ran and --saw record the check that decided the merge; give them with --sha');
  need(flags.red === undefined || flags.sha !== undefined, '--red names the issue that tracks why the merge landed on a red check; give it with --sha');
  need(!(rows && flags.red !== undefined), 'a merge landed on red carries no passing check: give --ran/--saw for a green check, or --red <id> for a red one, not both');
  const issues = issuesFor(root, rawIds);
  const nothing = issues.length > 1 ? ' — nothing was written' : '';
  let cause = null;
  if (flags.red !== undefined) {
    need(typeof flags.red === 'string' && fieldText(flags.red), '--red needs the id of the issue that tracks the cause');
    const tracked = findIssue(root, fieldText(flags.red));
    need(tracked, `--red names an issue that does not exist: ${flags.red}${nothing}`);
    need(!issues.some((i) => i.id === tracked.id), `--red names the issue that tracks the cause of a red check outside the branch; ${tracked.id} is the issue being merged${nothing}`);
    cause = tracked.id;
  }
  if (flags.sha === undefined) for (const issue of issues) need(mergedOf(issue), `${issue.id} records no merge yet — give --sha: jarl.mjs merged ${issue.id} --sha <sha> --ci ${flags.ci}${nothing}`);
  const repoPath = flags.repo !== undefined ? repoOf(root, flags.repo) : null;
  const sha = flags.sha !== undefined ? String(flags.sha).toLowerCase() : null;
  const ci = flags.ci ?? (sha && !cli ? 'pending' : undefined);
  // The check as the merge line names it: the commands that ran, one line, never the log's own separator.
  const checkText = rows ? fieldText(rows.map((r) => r.ran).join(' ; ')).replace(/ +· +/g, ' - ').slice(0, 200) : null;
  const notes = [];
  if (sha) {
    // Where the sha should be: --repo, else each issue's Repo, else the loop's own repository.
    // An issue naming several repositories is noted only when the sha is in none of them.
    const checked = new Set();
    for (const issue of issues) {
      const repos = (repoPath ? [repoPath] : issueRepoPaths(root, issue)).filter(isGitRepo);
      const key = repos.join('\n');
      if (!repos.length || checked.has(key)) continue;
      checked.add(key);
      if (repos.every((r) => git(r, ['cat-file', '-e', `${sha}^{commit}`]) === null)) notes.push(`${sha} is not a commit in ${repos.join(' or ')} (yet) — recorded as given`);
    }
  }
  // Said, never refused: a merge is a fact, and recording it is not the place to stop it. A merge whose issue holds
  // no fresh approve went in without the fresh review the rule asks for, and the note says so loudly.
  // Under a done gate with no approve (approve: none), the merge gate stands behind the issue, and no reviewer is owed.
  if (sha && loadProfile(root).doneGate.approve !== 'none') {
    const loop = readLoop(jarlDir(root));
    for (const issue of issues) {
      const g = gateOf(loop, issue.id);
      if (!g.fresh) notes.push(`MERGED WITHOUT A FRESH REVIEW — ${issue.id} ${g.live ? freshRuleText({ fields: { merged: sha } }, g.live) : 'holds no live approve at all (none, or spent by a later round, restart or reopen) — the fresh-review rule: a code issue needs an approve from a fresh reviewer before it merges'}; recorded as given, get the fresh review now: jarl.mjs review ${issue.id} approve|changes --by <fresh reviewer> "<findings>"`);
    }
  }
  // The evidence rows go in first, like evidence writes them: one row per --ran/--saw pair on every issue of the call.
  if (rows) cmdEvidence(root, issues.map((i) => i.id).join(','), undefined, { ran: flags.ran, saw: flags.saw });
  for (const issue of issues) {
    let text = readText(issue.file);
    if (sha) text = setField(text, 'Merged', `${sha}${flags.repo !== undefined ? ` in ${fieldText(flags.repo)}` : ''}`);
    text = ci ? setField(text, 'CI', ci) : removeFields(text, ['CI']);
    writeAtomic(issue.file, text);
  }
  const named = `${flags.repo !== undefined ? ` in ${fieldText(flags.repo)}` : ''}${checkText ? ` · check ${checkText}` : ''}${cause ? ` · landed red, cause ${cause}` : ''}${ci ? ` · CI ${ci}` : ''}`;
  appendLogLines(root, issues.map((issue) => (sha ? `${issue.id} merged ${sha}${named}` : `${issue.id} CI ${ci}`)));
  // The cleanup comes last, after the merge is on the record, and only on the command line and in the tools.
  const cleanup = sha && cli && flags.keep !== true ? cleanUpAfterMerge(root, issues, sha, repoPath) : [];
  return { ids: issues.map((i) => i.id), sha: sha || null, ci: ci ?? null, ...(checkText ? { check: checkText } : {}), ...(cause ? { red: cause } : {}), ...(cleanup.length ? { cleanup } : {}), notes };
}

// ---- the cleanup a recorded merge makes redundant -------------------------------------------------------------------
//
// Right after merged records a sha, the issue's worktree and its local branch are redundant. Jarl removes them when that is
// safe and keeps everything, naming the condition, when it is not. It is the only place Jarl changes git, and only after a
// recorded merge: `git worktree remove` and `git branch -d`, never a force, never a file removed by any other means, nothing
// pushed and no remote branch touched. It runs for the command line and the tools (--keep skips it), never for a library call.
// The branch is kept unless every condition holds: it is not the base, a release branch or a trunk name; its tip is in the
// base or in the recorded merge; no other unfinished issue holds a lease on it (a package); its worktree, when it has one,
// is on this machine, is the one the lease names, is not the main checkout nor the one the loop or this command lives in,
// and holds nothing uncommitted and nothing untracked; and git itself accepts the removal and the delete.
const TRUNK_NAME = /^(?:HEAD|main|master|trunk|develop|release\/.+)$/;
// A word safe to paste into a shell: single-quoted unless it is plainly safe.
export const shellWord = (s) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);
const sameDir = (a, b) => canonical(a) === canonical(b);
// The one wording for a worktree git lists whose directory is not there. Git marks such a worktree prunable or not
// depending on how the directory went missing, and the lookup reads that as gone or as invisible; both are the same fact here.
const missingWorktreeReason = () => 'git lists its worktree but its directory is missing here';
const insideDir = (dir, path) => { const r = relative(canonical(dir), canonical(path)); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

function cleanUpAfterMerge(root, issues, sha, repoPath) {
  const profile = loadProfile(root);
  const everyone = loadIssues(root);
  const called = new Set(issues.map((i) => i.id));
  const groups = new Map();
  for (const issue of issues) {
    const branch = fieldText(issue.fields.branch);
    if (!branch) continue;
    for (const repo of repoPath ? [canonical(repoPath)] : issueRepos(root, issue)) {
      const key = `${repo}\n${branch}`;
      if (!groups.has(key)) groups.set(key, { repo, branch, on: [] });
      groups.get(key).on.push(issue);
    }
  }
  const results = [];
  for (const { repo, branch, on } of groups.values()) {
    if (!isGitRepo(repo) || git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]) === null) continue;
    const base = defaultBase(repo);
    const result = { repo: repoLabel(repo), branch };
    const keep = (reason, extra = {}) => results.push({ ...result, ...extra, kept: reason });
    if (TRUNK_NAME.test(branch) || branch === base) { keep('it is the base or a release branch'); continue; }
    const others = everyone.filter((i) => !called.has(i.id) && fieldText(i.fields.branch) === branch && profile.unfinished(i.status) && issueRepos(root, i).includes(repo)).map((i) => i.id);
    if (others.length) { keep(`${others.join(', ')} still hold${others.length === 1 ? 's' : ''} a lease on it`); continue; }
    if (git(repo, ['merge-base', '--is-ancestor', branch, base]) === null && git(repo, ['merge-base', '--is-ancestor', branch, sha]) === null) { keep(`its tip is neither in ${base} nor in the merge ${sha}`); continue; }
    const stored = on.map((i) => i.fields.worktree).find(Boolean);
    // Only the worktree git lists on exactly this branch is Jarl's to remove; the path the lease names is looked at to say
    // what it is when it is not that one, and is never removed.
    const ws = worktreeState(repo, branch, undefined);
    if (ws.state === 'none' && stored) {
      const listed = (worktreesOf(repo) || []).find((w) => sameDir(w.path, stored));
      keep(!listed ? `the path the lease names (${stored}) is not a worktree git lists` : listed.branch ? `the path the lease names (${stored}) is a worktree on ${listed.branch}, not on this branch` : `the path the lease names (${stored}) is a detached worktree`);
      continue;
    }
    let removed = null;
    if (ws.state === 'elsewhere') { keep('its worktree is not on this machine'); continue; }
    if (ws.state === 'gone' || ws.state === 'invisible') { keep(missingWorktreeReason()); continue; }
    if (ws.state === 'here') {
      const main = mainCheckoutOf(repo);
      if (main && main.main && canonical(ws.path) === main.main) { keep('it is checked out in the main checkout'); continue; }
      if (stored && existsSync(stored) && canonical(stored) !== canonical(ws.path)) { keep('it is checked out in another worktree than the one the lease names'); continue; }
      if (insideDir(ws.path, root) || insideDir(ws.path, process.cwd())) { keep('the loop or this command lives in its worktree'); continue; }
      // Asked explicitly, whatever the user's git configuration hides (status.showUntrackedFiles, ignore settings).
      const status = git(ws.path, ['-c', 'status.showUntrackedFiles=all', 'status', '--porcelain', '--untracked-files=all', '--ignored']);
      if (status === null) { keep('the state of its worktree cannot be read'); continue; }
      const lines = status.split('\n').filter(Boolean);
      const changed = lines.filter((l) => !l.startsWith('!!'));
      if (changed.length) { keep(`its worktree holds ${changed.length} uncommitted or untracked file(s)`); continue; }
      // A second, independent look, so that no single mechanism that hides a change from `status` slips through: files an
      // index flag hides (assume-unchanged shows as a lowercase tag in ls-files -v, skip-worktree as S), the working files
      // against HEAD, and the untracked files not ignored.
      const flagged = (git(ws.path, ['-c', 'core.fsmonitor=false', 'ls-files', '-v']) || '').split('\n').filter((l) => l && (/^[a-z]/.test(l) || l.startsWith('S ')));
      if (flagged.length) { keep(`its worktree hides changes from git status behind assume-unchanged or skip-worktree marks: ${flagged.slice(0, 5).map((l) => l.slice(2)).join(', ')}${flagged.length > 5 ? `, and ${flagged.length - 5} more` : ''}`); continue; }
      if (!gitRun(ws.path, ['diff', '--quiet', 'HEAD', '--']).ok) { keep('its worktree differs from its HEAD'); continue; }
      const others = git(ws.path, ['ls-files', '--others', '--exclude-standard']);
      if (others === null || others !== '') { keep('its worktree holds untracked files'); continue; }
      // git deletes ignored files together with a worktree, so a worktree that holds any is left for a person to look at.
      const ignored = lines.map((l) => l.slice(3));
      if (ignored.length) {
        keep(`its worktree holds ignored files: ${ignored.slice(0, 5).join(', ')}${ignored.length > 5 ? `, and ${ignored.length - 5} more` : ''}`, { commands: [`git -C ${shellWord(repo)} worktree remove --force ${shellWord(ws.path)}`, `git -C ${shellWord(repo)} branch -d ${shellWord(branch)}`] });
        continue;
      }
      const gone = gitRun(repo, ['worktree', 'remove', ws.path]);
      if (!gone.ok) { keep(`git worktree remove refused: ${gone.err}`); continue; }
      removed = ws.path;
    }
    const dropped = gitRun(repo, ['branch', '-d', branch]);
    if (!dropped.ok) { keep(`git branch -d refused: ${dropped.err}`, removed ? { worktree: removed } : {}); continue; }
    results.push({ ...result, ...(removed ? { worktree: removed } : {}), removed: true });
  }
  return results;
}

export function cmdTag(root, rawIds, ops) {
  const issues = issuesFor(root, rawIds);
  for (const op of ops) need(/^[+-]./.test(op), `tags are +name or -name, not "${op}"`);
  const results = issues.map((issue) => {
    const tags = new Set(issue.tags);
    for (const op of ops) { if (op.startsWith('+')) tags.add(op.slice(1)); else tags.delete(op.slice(1)); }
    return { issue, tags: [...tags].sort() };
  });
  for (const r of results) writeAtomic(r.issue.file, setField(readText(r.issue.file), 'Tags', r.tags.join(', ')));
  return oneOrMany(rawIds, results.map((r) => ({ id: r.issue.id, tags: r.tags })));
}

export function cmdPrio(root, rawIds, prio) {
  need(PRIORITIES.includes(String(prio)), 'priority is 1, 2 or 3');
  const issues = issuesFor(root, rawIds);
  for (const issue of issues) writeAtomic(issue.file, setField(readText(issue.file), 'Priority', String(prio)));
  return oneOrMany(rawIds, issues.map((issue) => ({ id: issue.id, priority: String(prio) })));
}

export function cmdFiles(root, rawId, list) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  const files = pathList(list);
  writeAtomic(issue.file, setField(readText(issue.file), 'Files', files.join(', ')));
  return { id: issue.id, files };
}

export function cmdRepo(root, rawId, path, { clear = false } = {}) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  if (clear) {
    need(issue.fields.repo, `${issue.id} has no Repo field to clear`);
    const text = removeFirstField(readText(issue.file), 'Repo');
    writeAtomic(issue.file, text);
    return { id: issue.id, repo: null, cleared: true };
  }
  need(path !== undefined, 'repo requires <path> — the checkout of the repository the issue\'s code lives in, several as one comma list (or --clear to remove the field)');
  const repos = repoList(root, path);
  writeAtomic(issue.file, setField(readText(issue.file), 'Repo', repos.join(', ')));
  return { id: issue.id, repo: repos.join(', '), repos };
}

// ---- issues: the rows of an Evidence section -------------------------------------------------------

// The checkable rows of an Evidence section, each with its ordinal n counted over the whole section (a retracted
// row keeps its number, so a number never moves), the lines it spans (start..end, a row is its first line and the
// indented lines under it) and whether it is retracted (struck through: `- ~~**ran:** … **saw:** …~~`). The one
// numbering: show prints it, evidence --retract takes it, the done gate counts by it.
const ROW_START = /^- (~~)?\*\*ran:\*\*/;
// Which journal line each file row wrote, by position in the file: a row's journal line keeps the first line of its
// command (`<id> evidence row · <first line>`, with a pointer suffix when the command has more lines), so it matches
// when that is the row's whole first line (a command of several lines) or is followed by the saw marker. Each journal
// line is taken once, the earliest still free, so lines in another order, equal commands and commands that hold the
// saw marker themselves all resolve; a row no journal line fits is null.
const MORE_LINES = / \(\+\d+ more lines, whole text in [^)]*\)$/;
export function alignRows(id, rows, journalRows) {
  const prefix = `${id} evidence row · `;
  const used = new Set();
  return rows.map((row) => {
    const hit = journalRows.find((j) => {
      if (used.has(j) || !j.text.startsWith(prefix)) return false;
      const l = j.text.slice(prefix.length).replace(MORE_LINES, '');
      return row.first === l || row.first.startsWith(`${l} · **saw:**`);
    });
    if (hit) used.add(hit);
    return hit || null;
  });
}
export function evidenceTable(text) {
  const lines = String(text || '').split('\n');
  const rows = [];
  for (let i = 0; i < lines.length; i += 1) {
    const s = ROW_START.exec(lines[i]);
    if (!s) continue;
    let end = i;
    while (end + 1 < lines.length && /^ {2}\S/.test(lines[end + 1])) end += 1;
    const retracted = Boolean(s[1]);
    let body = lines.slice(i, end + 1).map((l) => l.trim()).join(' ').replace(/^- (~~)?\*\*ran:\*\*\s*/, '');
    if (retracted) body = body.replace(/~~$/, '');
    const cut = body.indexOf(' · **saw:**');
    // The row's first physical line after the marker: what alignRows matches the journal's row line against.
    const first = lines[i].replace(/^- (~~)?\*\*ran:\*\*\s*/, '').trim();
    rows.push({ n: rows.length + 1, start: i, end, retracted, first, ran: (cut === -1 ? body : body.slice(0, cut)).trim(), saw: cut === -1 ? '' : body.slice(cut + ' · **saw:**'.length).trim() });
    i = end;
  }
  return { lines, rows };
}
// The rows that count as evidence: the ones with a --saw and not retracted.
export function evidenceRows(issue) {
  return evidenceTable(issue.sections.evidence).rows.filter((r) => !r.retracted && r.saw !== '').map((r) => ({ ran: r.ran, saw: r.saw }));
}

// A finding's proposal copied in by import is not yet an acceptance line: it waits to be made checkable.
export const PROPOSED = 'Proposed by the finding';
export function acceptanceLineCount(issue) {
  const text = issue.sections.acceptance || '';
  return text.split('\n').map((l) => l.trim().replace(/^- /, '')).filter((l) => l.length > 0 && !l.startsWith(PROPOSED)).length;
}

// ---- commands: evidence ------------------------------------------------------------------------------

// What counts as evidence of the work for done: not a ruling written in by decide or answer, and not the
// reason of an earlier move into a needs-reason status (a drop or a deferral).
export function workEvidence(issue, profile = DEFAULT_PROFILE) {
  // Status names are lower-case letters, digits and dashes: nothing in them is read as a pattern.
  const skip = new RegExp(`^\\s*(Ruling\\b${profile.with('needs-reason').map((st) => `|${reasonWord(st)}:`).join('')})`);
  return (issue.sections.evidence || '').split('\n').filter((l) => !skip.test(l)).join('\n').trim();
}

// evidence <id> "<text>" appends free text (a merge sha, a one-line note); evidence <id> --ran
// "<command>" --saw "<what it printed>" appends one checkable row per pair instead — repeat the pair,
// in one call or across calls, one row per acceptance line. Both append to the same section, never
// replace it: the merger's free-text note lands after the worker's rows. `set done` needs the section
// non-empty, rows or not (not every issue's proof is a command).
//
// evidence <id> --retract <n> --by <who> "<reason>" retracts the n-th row (numbered over the whole Evidence section, as
// show prints it) by an appended entry: the row stays, struck through, the entry names who retracted it and why, and
// the done gate stops counting it. It only tightens: a row is taken away, never added or revived.
// The --ran/--saw rows of a call, checked: each --ran has its --saw, each with a value.
function rowsOf(flags) {
  const rans = [].concat(flags.ran ?? []);
  const saws = [].concat(flags.saw ?? []);
  need(rans.length && saws.length && [...rans, ...saws].every((v) => typeof v === 'string' && v.trim()), 'a row needs both --ran "<command>" and --saw "<what it printed>", each with a value');
  need(rans.length === saws.length, `--ran and --saw must repeat the same number of times (got ${rans.length} --ran, ${saws.length} --saw)`);
  return rans.map((ran, i) => ({ ran, saw: saws[i] }));
}
export function cmdEvidence(root, rawIds, text, flags) {
  if (flags && flags.retract !== undefined) return retractEvidence(root, rawIds, text, flags);
  let rows = null;
  if (flags && (flags.ran !== undefined || flags.saw !== undefined)) {
    rows = rowsOf(flags);
    need(text === undefined, `evidence takes free text or --ran/--saw rows, not both (got "${text}" as well) — a value starting with -- goes after a bare --`);
  } else {
    need(text, 'evidence requires "<what was run and what it printed>", or --ran "<command>" --saw "<what it printed>"');
  }
  const issues = issuesFor(root, rawIds);
  // A row is one list item: the lines of a multi-line command or output after the first are indented under it.
  const indented = (v) => String(v).replace(/\r\n?/g, '\n').trim().split('\n').join('\n  ');
  const added = rows ? rows.map((r) => `- **ran:** ${indented(r.ran)} · **saw:** ${indented(r.saw)}`).join('\n') : text;
  for (const issue of issues) {
    const current = (issue.sections.evidence || '').trim();
    writeAtomic(issue.file, setSection(readText(issue.file), 'Evidence', current ? `${current}${rows ? '\n' : '\n\n'}${added}` : added));
  }
  appendLogLines(root, issues.flatMap((issue) => (rows ? rows.map((r) => `${issue.id} evidence row · ${firstLine(r.ran, "the issue's Evidence section")}`) : [`${issue.id} evidence · ${firstLine(text, "the issue's Evidence section")}`])));
  return oneOrMany(rawIds, issues.map((issue) => (rows ? { id: issue.id, rows } : { id: issue.id })));
}

// A text a reviewer or a retracting hand gives must say something: at least two letters or digits (not "", "-", "x").
const REVIEW_MIN_WORDS = 3;
function needSaid(text, what) {
  const said = (String(text ?? '').match(/[\p{L}\p{N}]/gu) || []).length;
  need(said >= 2, `${what} needs words — what was read and what was found, or why; got "${String(text ?? '').trim().slice(0, 20)}"`);
}
function retractedBy(flags, what) {
  need(flags.by !== undefined && fieldText(flags.by), `${what} needs --by <who> — whoever retracts it is recorded with the reason`);
  return fieldText(flags.by);
}
const struck = (line) => line.replace(/^- /, '- ~~');

function retractEvidence(root, rawIds, reason, flags) {
  need(!isBulk(rawIds), 'evidence --retract names one issue and one row');
  need(flags.ran === undefined && flags.saw === undefined, 'evidence --retract takes a row number and a reason, not a new --ran/--saw row');
  const raw = String(flags.retract);
  need(/^\d+$/.test(raw) && Number(raw) >= 1, `--retract takes the number of an evidence row as show prints it (1, 2, …); got "${raw}"`);
  const n = Number(raw);
  const by = retractedBy(flags, 'a retraction');
  needSaid(reason, 'a retraction');
  const [issue] = issuesFor(root, rawIds);
  const text = readText(issue.file);
  const table = evidenceTable(parseIssue(text, issue.file).sections.evidence);
  need(table.rows.length > 0, `${issue.id} has no evidence row to retract`);
  const row = table.rows[n - 1];
  need(row, `${issue.id} has ${table.rows.length} evidence row${table.rows.length === 1 ? '' : 's'}: there is no row ${n}`);
  need(!row.retracted, `row ${n} of ${issue.id} is retracted already`);
  const journalRows = (journalById(root).get(issue.id) || []).filter((e) => e.type === 'row');
  need(journalRows.length === 0 || journalRows.length === table.rows.length, `${issue.id} holds ${table.rows.length} evidence row${table.rows.length === 1 ? '' : 's'} and its log ${journalRows.length}, so the row numbers cannot be matched to the log; nothing was written`);
  need(journalRows.length === 0 || alignRows(issue.id, table.rows, journalRows)[n - 1], `row ${n} of ${issue.id} matches no evidence line of the log, so its retraction could not be told from another row's; nothing was written`);
  // The first retraction of a loop raises the record format, before its line is written: a reader of format 1 does not
  // read a retraction and would go on counting the row, so it must refuse the loop instead.
  raiseFormat(root);
  const lines = table.lines.slice();
  lines[row.start] = struck(lines[row.start]);
  lines[row.end] = `${lines[row.end].trimEnd()}~~`;
  const entry = `- **retracted:** row ${n} · by ${by} · ${stamp().slice(0, 10)}\n${bodyText(reason).split('\n').map((l) => (l ? `  ${l}` : '')).join('\n')}`;
  writeAtomic(issue.file, setSection(text, 'Evidence', `${lines.join('\n').trim()}\n${entry}`));
  appendLog(root, `${issue.id} evidence retract · row ${n} · by ${by} · ${firstLine(reason, "the issue's Evidence section")}`);
  return { id: issue.id, retracted: n, by };
}

// show <id>: the issue as the done gate sees it. The header, What, Why, Acceptance, Changelog and any section of the
// profile in full; of Reviews and Evidence only the gate's window — every verdict and every --ran/--saw row since
// the last start or reopen — plus every "changes" finding no later approve has answered, and one line for each
// earlier verdict; last, the exact call that prints everything. The window is read from the journal, where the file's
// entries are matched to the log's lines in order: when the file and the log do not agree on how many there are (an
// issue written by hand, a loop without a Reviews section) nothing is cut. Every evidence row carries its
// ordinal [n], counted over the whole section, the number evidence --retract takes; --full prints the file with them.
export function issueView(root, issue, { full = false } = {}) {
  const pieces = [];
  let cur = { name: null, lines: [] };
  for (const l of readText(issue.file).split('\n')) {
    const h = /^##\s+(.*)$/.exec(l);
    if (h) { pieces.push(cur); cur = { name: h[1].trim().toLowerCase(), lines: [l] }; } else cur.lines.push(l);
  }
  pieces.push(cur);
  const numbered = (body, rows) => body.map((l, i) => { const r = rows.find((x) => x.start === i); return r ? l.replace(/^- /, `- [${r.n}] `) : l; });
  const g = full ? null : gateState(root, issue.id);
  const out = [];
  for (const p of pieces) {
    if (p.name !== 'evidence' && p.name !== 'reviews') { out.push(...p.lines); continue; }
    const body = p.lines.slice(1);
    if (p.name === 'evidence') {
      const t = evidenceTable(body.join('\n'));
      const earlier = !full && g.anchorN >= 0 && g.rowLog.length === t.rows.length ? g.rowLog.filter((r) => r.n <= g.anchorN).length : 0;
      out.push(p.lines[0]);
      if (earlier > 0) {
        out.push(`(evidence rows 1-${earlier} came before the last start or reopen and are not shown; ${earlier === t.rows.length ? 'none since' : `rows ${earlier + 1}-${t.rows.length} follow`})`);
        out.push(...numbered(body, t.rows).slice(t.rows[earlier - 1].end + 1));
      } else out.push(...numbered(body, t.rows));
      continue;
    }
    const t = reviewEntries(body.join('\n'));
    out.push(p.lines[0]);
    if (full || !t.entries.length || t.entries.length !== g.trail.length) { out.push(...body); continue; }
    out.push(...body.slice(0, t.entries[0].start));
    t.entries.forEach((e, i) => {
      const open = e.verdict === 'changes' && !t.entries.slice(i + 1).some((x) => x.verdict === 'approve' && !x.retracted);
      if (g.trail[i].n > g.anchorN || open) { out.push(...body.slice(e.start, e.end + 1)); return; }
      const first = body.slice(e.start + 1, e.end + 1).map((l) => l.trim()).find(Boolean);
      const line = `- earlier: ${body[e.start].replace(/^- /, '')}${first ? ` · ${first}` : ''}`;
      out.push(line.length > 200 ? `${line.slice(0, 197)}...` : line);
    });
  }
  if (full) return out.join('\n');
  return `${out.join('\n').replace(/\s+$/, '')}\n\nThe whole issue, with every earlier round and row: jarl.mjs show ${issue.id} --full\n`;
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
  const list = pathList(v);
  need(list.length, '--repo needs a path');
  for (const r of list) repoOf(root, r);
  return list;
}

// The words next, queue, status and resume say in place of what they would compute, on a loop whose profile names an
// external scheduler: Jarl does not know that scheduler's edges (ports, leases, holds), so a ready list of its own would
// offer work the loop's real scheduler holds back.
export function schedulerNote(cmd) { return `scheduling is led by the composer: ${cmd}`; }

// next — on a loop with an external scheduler, { scheduler, note } and no list: Jarl computes nothing it cannot know.
// By default the issues ready to start and nothing else; --all adds the others, each row carrying its group:
// ready, held-by-file (a file an in-progress or earlier-offered issue holds), waiting-after (After not settled) or
// held-by-question (an open stuck or stop question names the issue). A library caller reads the full list through
// nextRows and filters it itself.
export const NEXT_GROUPS = ['ready', 'held-by-file', 'held-by-resource', 'waiting-after', 'held-by-question'];
export function cmdNext(root, flags) {
  const profile = loadProfile(root);
  if (profile.scheduler) return { scheduler: profile.scheduler, note: schedulerNote(profile.scheduler) };
  const rows = nextRows(root, flags);
  return flags.all ? rows : rows.filter((r) => r.ready);
}

// The model of a ready issue as next and resume show it: the tier's default, and the suggestion with its numbers.
const modelText = (m) => (m && m.default ? `  [model ${m.default}${m.suggested ? ` · suggest ${m.suggested}: ${m.basis}` : ''}]` : '');

const NEXT_HEADERS = { ready: 'Ready', 'held-by-file': 'Held by a file another issue holds', 'held-by-resource': 'Held by a resource another issue holds', 'waiting-after': 'Waiting on After', 'held-by-question': 'Held by an open question' };
export function renderNext(rows, all, held = 0) {
  const line = (r) => {
    const note = r.group === 'ready' ? [r.noAcceptance && 'no acceptance yet', r.noFiles && 'no files declared']
      : r.group === 'waiting-after' ? [`after ${r.after.join(', ')}`]
        : r.group === 'held-by-question' ? [`question ${r.questions.map((q) => `a-${q}`).join(', ')}`]
          : [`waits on ${[...r.waitsOn, ...(r.resources || []).map((x) => `resource ${x}`)].join(', ')}, held by ${r.heldBy.join(', ')}`];
    return `${r.id}  P${r.priority}  ${r.title}${note.filter(Boolean).map((n) => `  (${n})`).join('')}${modelText(r.model)}`;
  };
  if (!all) {
    if (rows.length) return rows.map(line).join('\n');
    return held ? `(nothing is ready to start; ${held} open issue(s) are held or waiting — jarl next --all shows which and why)` : '(nothing open)';
  }
  if (!rows.length) return '(nothing open)';
  return NEXT_GROUPS.map((g) => [g, rows.filter((r) => r.group === g)]).filter(([, list]) => list.length)
    .map(([g, list]) => `${NEXT_HEADERS[g]} (${list.length})\n${list.map(line).join('\n')}`).join('\n\n');
}

export function nextRows(root, flags = {}) {
  const profile = loadProfile(root);
  const issues = loadIssues(root);
  // An open question of kind stuck (the default) or stop that names an issue holds that issue back until it is answered.
  const asked = new Map();
  for (const a of loadAsks(root)) {
    if (a.state !== 'open' || !a.issue || !['stuck', 'stop', null].includes(a.kind)) continue;
    asked.set(a.issue, [...(asked.get(a.issue) || []), a.id]);
  }
  // Files are compared as (repository, path) pairs: the same path in two repositories never holds
  // an issue back, the same file in one repository always does, however its Repo path is spelled.
  const keysOf = (i) => i.files.map((f) => { const at = fileAt(root, i, f); return { f, key: `${at.repo}\n${at.path}` }; });
  // Each taken file with the issue holding it: one in a holds-claim status (in progress), or a dispatchable (open)
  // one offered earlier in this list.
  const taken = new Map(issues.filter((i) => profile.is(i.status, 'holds-claim')).flatMap((i) => keysOf(i).map((k) => [k.key, i.id])));
  // Exclusive resources: names, loop-wide (no repository in the key), held by an issue for its lease's whole life. Resources
  // is a field the tool writes itself, so no profile declares a field of that name and the name has one meaning.
  const resourcesOf = (i) => i.resources.map((name) => ({ name, key: name.toLowerCase() }));
  const takenRes = new Map(issues.filter((i) => profile.is(i.status, 'holds-claim')).flatMap((i) => resourcesOf(i).map((r) => [r.key, i.id])));
  const byId = new Map(issues.map((i) => [i.id, i]));
  const out = [];
  for (const i of issues.filter((x) => profile.is(x.status, 'dispatchable')).sort((a, b) => a.priority.localeCompare(b.priority) || cmpId(a.id, b.id))) {
    // An issue whose After issues are not all settled (done or dropped) is never offered, whatever its files.
    const after = waitingOn(i, byId, profile);
    const base = { id: i.id, title: i.title, priority: i.priority, ...(i.files.length ? {} : { noFiles: true }) };
    if (after.length) { out.push({ ...base, group: 'waiting-after', after, waitsOn: [] }); continue; }
    if (asked.has(i.id)) { out.push({ ...base, group: 'held-by-question', questions: asked.get(i.id), waitsOn: [], after: [] }); continue; }
    const keys = keysOf(i);
    const held = keys.filter((k) => taken.has(k.key));
    const heldRes = resourcesOf(i).filter((r) => takenRes.has(r.key));
    if (held.length || heldRes.length) {
      out.push({
        ...base, group: held.length ? 'held-by-file' : 'held-by-resource', waitsOn: held.map((k) => k.f),
        ...(heldRes.length ? { resources: heldRes.map((r) => r.name) } : {}),
        heldBy: [...new Set([...held.map((k) => taken.get(k.key)), ...heldRes.map((r) => takenRes.get(r.key))])], after: [],
      });
      continue;
    }
    keys.forEach((k) => taken.set(k.key, i.id));
    resourcesOf(i).forEach((r) => takenRes.set(r.key, i.id));
    // Offered, but flagged: a worker raised on an issue with no acceptance line has nothing to prove, and
    // the reviewer nothing to check it against. Fill it with body --acceptance before raising one.
    out.push({ ...base, group: 'ready', files: i.files, ready: true, waitsOn: [], after: [], ...(acceptanceLineCount(i) ? {} : { noAcceptance: true }) });
  }
  const limit = Number(flags.limit) || Infinity;
  let n = 0;
  const kept = out.filter((r) => { if (!r.ready) return true; n += 1; return n <= limit; });
  // In a loop that declares model lines, a ready issue shows the model of its tier and what the record suggests.
  const marks = modelMarks(root, kept.filter((r) => r.ready).map((r) => byId.get(r.id)));
  return kept.map((r) => (marks.has(r.id) ? { ...r, model: marks.get(r.id) } : r));
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
  // Each line is "XY path"; the output comes back trimmed, so the first line may have lost X's leading space.
  return out.split('\n').filter(Boolean).map((l) => l.replace(/^[ MTADRCU?!]{1,2} /, '')).sort();
}

export function cmdStatus(root, flags = {}) { return statusOf(root, readLoop(jarlDir(root)), flags); }
// The status of a loop already read: a view that shows more than the status reads the loop once for all of it.
function statusOf(root, loop, flags) {
  const hours = staleHours(flags);
  const { profile } = loop;
  // The count per status. Without a profile the five built-in counts are top-level keys; under a
  // profile they live under their own key, statuses, so no status name can overwrite a key of the view (waiting,
  // ready, stale...). countOf reads either.
  const counts = Object.fromEntries(profile.statuses.map((st) => [st, 0]));
  const c = profile.declared ? { statuses: counts } : counts;
  const every = loop.issues;
  // --tag: every section below is computed over the issues carrying that tag only; an After issue outside the tag is
  // still read for what it is (byId holds them all), so waiting means the same thing in the scope as in the whole.
  if (flags.tag !== undefined) need(typeof flags.tag === 'string' && flags.tag && every.some((i) => i.tags.includes(flags.tag)), `no issue carries the tag ${flags.tag}`);
  const issues = flags.tag === undefined ? every : every.filter((i) => i.tags.includes(flags.tag));
  for (const i of issues) counts[i.status] = (counts[i.status] || 0) + 1;
  // Each status keeps its own count; waiting is the part of those in play (open, in progress) whose After issues
  // are not settled yet, so "in flight" in the text line means someone is working on it.
  const { byId } = loop;
  const unfinished = issues.filter((i) => profile.active(i.status));
  c.waitingIds = unfinished.filter((i) => waitingOn(i, byId, profile).length).map((i) => i.id);
  c.waiting = c.waitingIds.length;
  c.inFlight = unfinished.filter((i) => profile.is(i.status, 'holds-claim') && !c.waitingIds.includes(i.id)).length;
  // Ready is Jarl's own reckoning (dispatchable, After settled); under an external scheduler it is not Jarl's to count:
  // null, and scheduler names who counts it.
  c.ready = profile.scheduler ? null : unfinished.filter((i) => profile.is(i.status, 'dispatchable') && !c.waitingIds.includes(i.id)).length;
  if (profile.scheduler) c.scheduler = profile.scheduler;
  c.noAcceptance = issues.filter((i) => profile.is(i.status, 'holds-claim') && !acceptanceLineCount(i)).map((i) => i.id);
  const inScope = new Set(issues.map((i) => i.id));
  const asks = loop.asks.filter((a) => a.state === 'open' && (flags.tag === undefined || (a.issue && inScope.has(a.issue))));
  // A ratify item blocks nothing, so it is not counted among the questions the loop waits on.
  c.questions = asks.filter((a) => a.kind !== 'ratify').length;
  c.toRatify = asks.filter((a) => a.kind === 'ratify');
  c.ratify = c.toRatify.length;
  // What a session needs to decide between continuing this loop and archiving it: the goal, when the
  // loop was opened, and when anything last happened in it — all read from its own files.
  c.goal = loop.goalLines.goal !== null ? loop.goalLines.goal.trim() : null;
  const log = loop.events;
  c.opened = log.length ? log[0].at : null;
  c.lastActivity = log.length ? log[log.length - 1].at : null;
  const archiveDir = join(jarlDir(root), 'archive');
  c.archived = existsSync(archiveDir) ? readdirSync(archiveDir).length : 0;
  // Leases that look wrong (worktree gone, branch gone, idle), merges waiting on CI, the age of a handoff file left in the loop (JSON only) and the
  // loop files nobody committed: all shown, none acted on.
  c.stale = issues.filter((i) => profile.is(i.status, 'holds-claim')).map((i) => ({ id: i.id, problems: leaseProblems(root, i, hours) })).filter((x) => x.problems.length);
  const live = issues.filter((i) => i.status !== 'dropped');
  c.ciPending = live.filter((i) => mergedOf(i)?.ci === 'pending').map((i) => i.id);
  c.ciRed = live.filter((i) => mergedOf(i)?.ci === 'red').map((i) => i.id);
  c.handoff = handoffAge(root, c.lastActivity);
  c.reviews = reviewSplit(flags.tag === undefined ? loop : scopedLoop(loop, issues));
  c.inFlightRows = inFlightRows(loop, issues);
  c.closedGate = closedGateFlags(flags.tag === undefined ? loop : scopedLoop(loop, issues));
  const files = uncommittedLoopFiles(root);
  c.uncommitted = files === null ? null : files.length;
  // --by: the same five counts per repository, tag, kind or priority — a dashboard's table, read from the issues.
  if (flags.by !== undefined) {
    // Or a field the profile declares: one group per value it holds.
    const declared = profile.fields.find((f) => f.key === String(flags.by).toLowerCase());
    need(STATUS_BY.includes(flags.by) || declared, `--by is one of: ${[...STATUS_BY, ...profile.fields.map((f) => f.key)].join(', ')} (got "${flags.by}")`);
    const keysOf = declared ? (i) => [fieldText(i.fields[declared.key]) || '(none)'] : { repo: (i) => repoNames(root, i), tag: (i) => (i.tags.length ? i.tags : ['(none)']), kind: (i) => [i.kind || '(none)'], prio: (i) => [i.priority] }[flags.by];
    const groups = {};
    for (const i of issues) for (const k of keysOf(i)) {
      const g = (groups[k] = groups[k] || Object.fromEntries(profile.statuses.map((st) => [st, 0])));
      if (Object.hasOwn(g, i.status)) g[i.status] += 1;
    }
    c.by = { key: declared ? declared.key : flags.by, groups: Object.fromEntries(Object.keys(groups).sort().map((k) => [k, groups[k]])) };
  }
  // Last, so every key status --json carried before keeps its place.
  if (flags.tag !== undefined) c.tag = flags.tag;
  c.check = checkState(loop);
  return c;
}
export const STATUS_BY = ['repo', 'tag', 'kind', 'prio'];

// What the record says about one in-flight issue, as one fact and the step it points to (never a status, never stored):
// no evidence rows since the start; rows and no verdict since the last restart or round; changes requested; approved
// (the merge comes next, and then done). A self approve is not a verdict that counts, so it reads as no verdict.
export const IN_FLIGHT_MARKS = {
  'no-rows': 'no evidence rows since the start — the worker has recorded no proof yet',
  'rows-no-verdict': 'evidence rows recorded, no verdict since the last start or round — it waits for a reviewer',
  'changes-requested': 'changes requested — it is back with the worker, who fixes it and records new rows',
  approved: 'approved and queued for the merge — next the merger lands it, then set it done',
  'approved-not-fresh': 'approved by a coordinator only, and it carries code — neither the merge queue nor done accepts that: it waits for a fresh reviewer\'s approve',
  merged: 'merged — nothing is left to land: set it done',
  'merged-ci': 'merged, CI not green yet — next record the CI result (merged <id> --ci green|red), then set it done',
};
export function inFlightMark(loop, issue) {
  const g = gateOf(loop, issue.id);
  if (g.approved) {
    // The same rule the done gate and the merge queue apply: an issue that carries code is cleared by a fresh approve only.
    if (carriesCode(issue) && !g.fresh) return 'approved-not-fresh';
    const m = mergedOf(issue);
    if (!m) return 'approved';
    return m.ci === 'pending' || m.ci === 'red' ? 'merged-ci' : 'merged';
  }
  const verdicts = g.trail.filter((r) => r.n > g.cut && !r.retracted && (r.verdict === 'approve' || r.verdict === 'changes'));
  if (verdicts.length && verdicts[verdicts.length - 1].verdict === 'changes') return 'changes-requested';
  return g.rowsSince === 0 ? 'no-rows' : 'rows-no-verdict';
}
// The rows for the in-flight `issues` of a loop (its own issues, or the ones a view is scoped to).
export function inFlightRows(loop, issues) {
  const { profile, byId } = loop;
  return issues.filter((i) => profile.is(i.status, 'holds-claim') && !waitingOn(i, byId, profile).length).map((i) => {
    const mark = inFlightMark(loop, i);
    return { id: i.id, title: i.title, branch: i.fields.branch || null, worker: i.fields.worker || null, model: i.fields.model || null, since: i.fields.since || null, mark, next: IN_FLIGHT_MARKS[mark] };
  });
}

// A loop opened in the default mode, or opened --committed, has no way to become the
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

// A loop whose profile keeps close or archive to the record ("lifecycle") refuses them from the command line and the
// MCP tools (caller 'cli'), naming the composer's command; a library caller ('record', the default) passes.
export function needLifecycle(root, op, caller = 'record') {
  need(SET_CALLERS.includes(caller), `caller must be one of: ${SET_CALLERS.join(', ')} (got "${caller}")`);
  if (caller !== 'cli') return;
  const profile = loadProfile(root);
  need(profile.lifecycle[op] !== 'record', `this loop is ${op === 'close' ? 'closed' : 'archived'} by the tool that runs it, never by jarl ${op} — its profile (${profile.name}) marks "lifecycle": { "${op}": "record" }, so jarl ${op} and the MCP tools refuse, and nothing was ${op === 'close' ? 'closed or removed' : 'moved'}${profile.lifecycle.command ? `; run: ${profile.lifecycle.command}` : ''}`);
}

export function cmdClose(root, flags = {}) {
  needLiveLoop(root, '');
  needLifecycle(root, 'close', flags.caller);
  // --batch files the ratification batch and closes nothing, so the user can answer it before the loop goes.
  if (flags.batch) return { closed: false, batch: ratificationBatch(root) };
  const profile = loadProfile(root);
  const left = loadIssues(root).filter((i) => profile.unfinished(i.status));
  need(flags.force || left.length === 0, `${left.length} issue(s) still open or in progress: ${left.map((i) => i.id).join(', ')} — set each ${profile.with('terminal').filter((st) => profile.is(st, 'settles-dependents') || profile.is(st, 'closes-record')).join(' or ') || profile.with('terminal').join(' or ')}, or report them to the user and run with --force`);
  // A permanent loop is a record, not a stage cleared before a merge: close leaves the directory in
  // place and logs the close instead of removing it, so --root still finds the loop afterwards.
  // Deferred work is not open, so it does not hold the close — but the close says it leaves it waiting.
  const deferred = loadIssues(root).filter((i) => i.status === 'deferred').map((i) => i.id);
  // The ratification batch is assembled here and never holds the close: in a permanent loop its items stay open for
  // the user's word; in a loop on a branch the rulings no one ratified leave with the directory, rulings of that loop.
  const batch = ratificationBatch(root);
  // A committed loop's files git never saw are named, not refused: in the permanent mode they (and the closing
  // line) wait for a commit; in the committed mode the removal below is itself the change to commit.
  if (existsSync(join(jarlDir(root), '.permanent'))) {
    appendLog(root, `closed · kept as a permanent record${deferred.length ? ` · ${deferred.length} deferred still waiting: ${deferred.join(', ')}` : ''}`);
    const files = uncommittedLoopFiles(root);
    return { closed: true, removed: null, kept: jarlDir(root), leftOpen: left.map((i) => i.id), deferred, uncommitted: files === null ? null : files.length, batch };
  }
  const files = uncommittedLoopFiles(root);
  rmSync(jarlDir(root), { recursive: true, force: true });
  return { closed: true, removed: jarlDir(root), kept: null, leftOpen: left.map((i) => i.id), deferred, uncommitted: files === null ? null : files.length, batch };
}


// ---- review and the done gate --------------------------------------------------------------------

// ---- the log: one reader ---------------------------------------------------------------------------
//
// The log is one dated line per event. This is the only place that reads the file and the only place that knows a
// line's grammar: parseEvent types one line, loopEvents reads the file and types them all, and everything else that
// needs a fact about the log (the done gate, the metrics, models, the rounds, tips, the timestamps status and resume
// print) takes it from the typed event. A line kind is taught here once.
//
// An event is { n, at, text, id, type, … } with n the line's index in the file and id the issue the line is about
// (null for a line about the loop). The types and what they add:
//   filed          the issue's filing
//   move           a status change: from (null when the log names no status before the line), to, lease — { worker, model, branch }
//                  for a move into a status that holds the claim and names a worker, else null — and model, the model a
//                  lease line names (null without one)
//   round          one red round
//   row            one --ran/--saw evidence row
//   verdict        a review: verdict (approve|changes), by, kind (as recorded), model, relayed
//   retract-row    a retracted evidence row: row, its number
//   retract-review a retracted approve
//   merged         a recorded merge: sha, repo, check, red, ci
//   ci             a CI state recorded alone: state
//   body           a body change
//   other          any other line
const LOG_LINE = new RegExp(`^- (${STAMP_SRC}) · ([^\\n]*)$`);
const LEADING_ID = idRe('^(?:filed )?({id})\\b');
const RETRACT_ROW_LINE = idRe('^{id} evidence retract · row (\\d+)\\b');
const WORKER_FIELD = / · worker (.+?)(?: · worktree |$)/;
const MODEL_FIELD = / · model (.+?)(?: · worker | · worktree |$)/;
const BRANCH_FIELD = / · branch (\S+)/;
// The model of a lease line: the last " · model " field, which sits in the fields after the free-text reason.
function leaseModelOf(text) { const at = text.lastIndexOf(' · model '); return at < 0 ? null : (MODEL_FIELD.exec(text.slice(at)) || [])[1] || null; }

// One log line as an event, without its place in the file. `from` is the status the issue was in before the line.
export function parseEvent(id, text, profile, from = null) {
  return eventParser(profile)(id, text, from);
}
function eventParser(profile) {
  const moved = movesInto(profile.statuses);
  const claims = (st) => profile.is(st, 'holds-claim');
  return (id, text, from) => {
    if (text.startsWith(`filed ${id} `)) return { type: 'filed' };
    if (!text.startsWith(`${id} `) && text !== id) return { type: 'other' };
    const mv = moved.exec(text);
    if (mv) {
      const to = mv[1];
      const named = claims(to) ? WORKER_FIELD.exec(text) : null;
      const model = claims(to) ? leaseModelOf(text) : null;
      return { type: 'move', from, to, lease: named ? { worker: fieldText(named[1]), model, branch: (BRANCH_FIELD.exec(text) || [])[1] || null } : null, model };
    }
    if (text.startsWith(`${id} round `)) return { type: 'round' };
    const r = REVIEW_LINE.exec(text);
    if (r) {
      const rest = text.slice(r[0].length);
      const mm = /^model (.+?) · /.exec(rest);
      return { type: 'verdict', verdict: r[1], by: r[2] || null, kind: r[3] || null, model: mm ? mm[1] : null, relayed: /^relayed · /.test(mm ? rest.slice(mm[0].length) : rest) };
    }
    if (text.startsWith(`${id} review retract`) && !/^\w/.test(text.slice(`${id} review retract`.length))) return { type: 'retract-review' };
    const rr = RETRACT_ROW_LINE.exec(text);
    if (rr) return { type: 'retract-row', row: Number(rr[1]) };
    if (text.startsWith(`${id} evidence row · `)) return { type: 'row' };
    if (text.startsWith(`${id} merged `)) {
      const line = mergeLineOf(id, text);
      if (line) return { type: 'merged', ...line };
    }
    if (text.startsWith(`${id} CI `) && CI_STATES.includes(text.slice(`${id} CI `.length))) return { type: 'ci', state: text.slice(`${id} CI `.length) };
    if (text.startsWith(`${id} body · `)) return { type: 'body' };
    return { type: 'other' };
  };
}

// Every dated line of the loop's log under `dir` (the directory holding the goal, the log and issues/), in order, as
// typed events. An issue's events carry the status it moved from, replayed from its own filing and moves.
export function loopEvents(dir, profile) {
  const path = logPath(dir);
  if (!existsSync(path)) return [];
  const parse = eventParser(profile);
  const lastStatus = new Map();
  const events = [];
  readText(path).split('\n').forEach((l, n) => {
    const m = LOG_LINE.exec(l);
    if (!m) return;
    const id = LEADING_ID.exec(m[2])?.[1] ?? null;
    const body = id === null ? { type: 'other' } : parse(id, m[2], lastStatus.get(id) ?? null);
    if (body.type === 'filed') lastStatus.set(id, profile.initial);
    else if (body.type === 'move') lastStatus.set(id, body.to);
    events.push({ n, at: m[1], text: m[2], id, ...body });
  });
  return events;
}
// The events of the issues, by the issue each line is about.
export function eventsById(events) {
  const map = new Map();
  for (const e of events) {
    if (e.id === null) continue;
    if (!map.has(e.id)) map.set(e.id, []);
    map.get(e.id).push(e);
  }
  return map;
}
// The journal as the done gate and the views read it: the events by issue.
export function journalById(root) {
  return eventsById(loopEvents(jarlDir(root), loadProfile(root)));
}

// ---- the loaded loop -------------------------------------------------------------------------------
//
// A command reads the loop once, into one value, and hands it to the gate, the views and models; nothing a function
// needs about the record is looked up again or kept in a module-level table. The value of readLoop(dir), with `dir`
// the directory holding the record (a loop's .jarl/, or an archived loop's directory):
//   dir, root     the record's directory, and the directory whose name is the loop's own (the one holding .jarl/, or
//                 the archive directory itself)
//   profile       the loop's profile
//   issues        every issue, in order; byId, the same by id
//   events        every dated line of the log, typed (see parseEvent); eventsById, the events of each issue
//   goal          the text of the goal, or null; goalLines, what it carries for the tool (see goalLines)
//   asks          the questions; decisions, the rulings
//   coordinators  the names that review as the loop's director
//   branchWorkers every worker leased on each Branch, across every issue that records it
// goal, goalLines, asks, decisions, coordinators and branchWorkers are read on first use.
export function readLoop(dir) {
  const root = basename(dir) === '.jarl' ? dirname(dir) : dir;
  const profile = profileAt(dir);
  return makeLoop({ dir, root, profile, issues: issuesAt(dir, profile), events: loopEvents(dir, profile) });
}
function makeLoop({ dir, root, profile, issues, events }) {
  const loop = { dir, root, profile, issues, byId: new Map(issues.map((i) => [i.id, i])), events, eventsById: eventsById(events) };
  const once = (make) => { let made = false; let value; return () => { if (!made) { value = make(); made = true; } return value; }; };
  const reads = {
    goal: once(() => readGoal(dir)),
    goalLines: once(() => goalLines(loop.goal)),
    asks: once(() => asksAt(dir)),
    decisions: once(() => decisionsAt(dir)),
    coordinators: once(() => coordinatorsIn(root, loop.goalLines)),
    branchWorkers: once(() => branchWorkersOf(loop)),
  };
  for (const [key, read] of Object.entries(reads)) Object.defineProperty(loop, key, { enumerable: true, get: read });
  return loop;
}
// The same loop over some of its issues (the ones a view is scoped to): the gate looks up an issue and the branch it
// shares with others among these, as the view does.
function scopedLoop(loop, issues) { return makeLoop({ dir: loop.dir, root: loop.root, profile: loop.profile, issues, events: loop.events }); }

// Who reviewed, as a kind: the word self, or anyone who has ever held the issue's lease — its own worker across
// every takeover, and the worker of any other issue sharing its Branch (a package, or an issue folded into the
// same branch later) — is self too; the loop's own director — coordinator, jarl, reeve, the loop's own name (the
// directory holding .jarl/) and any name the goal declares on a `Coordinators: a, b` line (coordinator); anyone
// else (fresh). A name is compared without case and surrounding space. `worker` is a name, or a set of them.
export const BASE_COORDINATORS = ['coordinator', 'jarl', 'reeve'];
export function reviewerKind(by, worker, coordinators = BASE_COORDINATORS) {
  const b = fieldText(by).toLowerCase();
  const workers = worker == null ? [] : typeof worker === 'string' ? [worker] : [...worker];
  if (b === 'self' || workers.some((w) => b === fieldText(w).toLowerCase())) return 'self';
  if (coordinators.some((c) => fieldText(c).toLowerCase() === b)) return 'coordinator';
  return 'fresh';
}
// The names that review as the loop's director in this loop: the fixed three, the loop's own name, and the names
// a `Coordinators:` line of the goal lists (see goalLines).
export function coordinatorNames(root) { return coordinatorsIn(root, goalLines(readGoal(jarlDir(root)))); }
function coordinatorsIn(root, lines) { return [...BASE_COORDINATORS, basename(resolve(root)), ...lines.coordinators]; }
const KIND_WEIGHT = { fresh: 0, coordinator: 1, self: 2 };
// An issue carries code when it records a branch or a merge. Only then does done (and the merge queue) need a
// fresh approve; an issue with neither — a ruling, a note, a hub document — is still cleared by the coordinator.
export function carriesCode(issue) { return Boolean(fieldText(issue.fields.branch) || fieldText(issue.fields.merged)); }
const REVIEW_LINE = idRe('^{id} review (approve|changes) · (?:by (.+?) \\((fresh|coordinator|self)\\) · )?');

// A journal line that moves an issue into one of the statuses named: `NNN → <status>`, the status followed by the end
// of the line or a space. Longest names first, so no status is read as a shorter one.
function movesInto(statuses) {
  const names = [...statuses].sort((a, b) => b.length - a.length);
  return idRe(`^{id} → (${names.join('|')})(?= |$)`);
}

// Every worker one issue's own journal has ever named on an in-progress move — a takeover replaces Worker but
// is still the same issue, so every lease across every round counts, not only the latest.
function leaseWorkers(events) {
  const workers = new Set();
  for (const e of events) if (e.type === 'move' && e.lease) workers.add(e.lease.worker);
  return workers;
}

// Every worker ever leased on a Branch, across every issue of the loop that records it (a package leased once for
// several issues, or one folded into the branch later by a bare `set <ids> in-progress --branch <b>` with no
// --worker of its own, is still one branch). The loop holds it, built once on first use.
function branchWorkersOf(loop) {
  const map = new Map();
  for (const i of loop.issues) {
    const branch = fieldText(i.fields.branch);
    if (!branch) continue;
    const set = map.get(branch) || new Set();
    for (const w of leaseWorkers(loop.eventsById.get(i.id) || [])) set.add(w);
    if (i.fields.worker) set.add(fieldText(i.fields.worker));
    map.set(branch, set);
  }
  return map;
}

// The full self scope for one issue: everyone its own lease has ever named, plus everyone named on another issue
// that shares its Branch (see branchWorkersOf). Self-review is refused for any of them, not only the id's own
// latest lease. Pure and cheap: no I/O, so it costs nothing extra when called once per issue in a loop.
function selfWorkers(events, issue, branches) {
  const self = leaseWorkers(events);
  if (issue && issue.fields.worker) self.add(fieldText(issue.fields.worker));
  const branch = issue && fieldText(issue.fields.branch);
  if (branch && branches.has(branch)) for (const w of branches.get(branch)) self.add(w);
  return self;
}

// The done gate, read from the journal for one issue. Replaying its lines in order:
// - the window (gateWindow) holds the anchor and the cut; only --ran/--saw rows logged after the anchor count for done
//   (a free-text note never does), so nothing written before a start, a reopen or the filing is proof of the work;
// - an approve by anyone who has ever held the issue's lease (self — see selfWorkers) never counts;
// - the live approve is the strongest one (fresh over coordinator over self) among those since whatever last
//   reset the issue — the cut of the window (a round, a reopen, a start), or a later "changes" verdict still
//   waiting on its own approve. A later, weaker approve never spends an earlier, still-live one: only those
//   resets do — a coordinator's approve recorded after a live fresh one does not undo it;
// - `tracked` is false for an issue the journal has no filing and no status move for (a hand-made file, a
//   loop whose log does not hold it): the gate then needs a --ran/--saw row in its Evidence section.
//
// gateState reads the loop for one call; a view that reads the gate for many issues reads the loop once and asks
// gateOf of it.
export function gateState(root, id) { return gateOf(readLoop(jarlDir(root)), id); }
// The one window of the done gate, from the issue's own events in order: `anchor` is the event after which a --ran/--saw
// row counts as proof, `cut` the log line number at or before which an approve is spent. The flags of the profile say what
// resets them. A filing, a start (a move into a status that holds the claim from one that does not), a reopen (a move into
// a dispatchable status from one that closes the record or holds the claim, and any move out of a status that closes the
// record) reset both, so a close rests only on proof and review recorded after the last of them. A red round
// resets the cut alone: it spends the approve, while the rows the worker logged stay true.
export function gateWindow(profile, events) {
  let anchor = null; let cut = -1;
  for (const e of events) {
    if (e.type === 'filed') { anchor = e; cut = e.n; continue; }
    if (e.type === 'round') { cut = e.n; continue; }
    if (e.type !== 'move') continue;
    const { from, to } = e;
    const start = profile.is(to, 'holds-claim') && !profile.is(from, 'holds-claim');
    const reopen = profile.is(to, 'dispatchable') && (profile.is(from, 'closes-record') || profile.is(from, 'holds-claim'));
    const leavesClose = profile.is(from, 'closes-record') && !profile.is(to, 'closes-record');
    if (start || reopen || leavesClose) { anchor = e; cut = e.n; }
  }
  return { anchor, cut };
}
export function gateOf(loop, id) {
  const { profile, coordinators } = loop;
  const events = loop.eventsById.get(id) || [];
  const issue = loop.issues.find((i) => i.id === id) || null;
  const self = selfWorkers(events, issue, loop.branchWorkers);
  const { anchor, cut } = gateWindow(profile, events);
  const evidence = []; const allReviews = [];
  const trail = [];   // every review line in order (approve, changes, retract), for the issue view
  const retractedRows = [];
  for (const e of events) {
    if (e.type === 'verdict') {
      // The kind is the one recorded, or the one today's names give, whichever is stricter: a name the goal
      // declares as a coordinator after its approve was logged as fresh does not stay fresh, and a name that
      // turns out to have ever held the lease (self) does not stay fresh or coordinator either.
      let kind = e.kind;
      if (kind && e.by) { const now = reviewerKind(e.by, self, coordinators); if (KIND_WEIGHT[now] > KIND_WEIGHT[kind]) kind = now; }
      const review = { n: e.n, at: e.at, verdict: e.verdict, by: e.by, kind, retracted: false };
      allReviews.push(review);
      trail.push(review);
      continue;
    }
    // A retraction takes away the newest approve not yet retracted, and only that: it never touches a changes verdict.
    if (e.type === 'retract-review') {
      const target = [...allReviews].reverse().find((x) => x.verdict === 'approve' && !x.retracted);
      if (target) target.retracted = true;
      trail.push({ n: e.n, at: e.at, verdict: 'retract', retracted: false });
      continue;
    }
    if (e.type === 'retract-row') { retractedRows.push(e.row); continue; }
    if (e.type === 'row') evidence.push({ ...e, retracted: false });
  }
  // A retraction names a row by its file-wide ordinal (evidenceTable: the one numbering show prints), and the journal's
  // row lines are matched to the file's rows (alignRows), so journal lines that merged in another order cannot retract
  // the wrong row. A retraction that cannot be resolved to exactly one row is never ignored: it is returned, and done
  // refuses while one stands, so a retracted row can never count again unseen.
  const unresolvedRetractions = [];
  if (retractedRows.length) {
    const rows = issue ? evidenceTable(issue.sections.evidence).rows : [];
    const aligned = alignRows(id, rows, evidence);
    for (const n of retractedRows) {
      if (aligned[n - 1]) aligned[n - 1].retracted = true;
      else if (evidence.length) unresolvedRetractions.push(n);
    }
  }
  const reviews = allReviews.filter((r) => !r.retracted);
  const last = reviews[reviews.length - 1] || null;
  // Only approves logged after the last "changes" verdict are even candidates — a changes still needs its own
  // approve. Among those, and past cut, the strongest kind wins, tie-broken by the more recent.
  let sinceChanges = reviews;
  for (let i = reviews.length - 1; i >= 0; i -= 1) { if (reviews[i].verdict === 'changes') { sinceChanges = reviews.slice(i + 1); break; } }
  let live = null;
  for (const r of sinceChanges) {
    if (r.verdict !== 'approve' || r.n <= cut) continue;
    const rw = KIND_WEIGHT[r.kind] ?? Infinity;
    const lw = live ? (KIND_WEIGHT[live.kind] ?? Infinity) : Infinity;
    if (!live || rw < lw || (rw === lw && r.n > live.n)) live = r;
  }
  return {
    tracked: anchor !== null,
    anchor: anchor ? { at: anchor.at, what: anchor.type === 'filed' ? 'filed' : anchor.to } : null,
    unresolvedRetractions,
    rowsSince: anchor ? evidence.filter((e) => e.n > anchor.n && !e.retracted).length : evidence.filter((e) => !e.retracted).length,
    // What the issue view windows by: where the gate's window starts in the log, and the log's rows and review lines in order.
    cut, anchorN: anchor ? anchor.n : -1, rowLog: evidence, trail,
    lastReview: last ? last.verdict : null,
    lastApprove: [...reviews].reverse().find((r) => r.verdict === 'approve') || null,
    approved: Boolean(live && live.kind !== 'self'),
    selfApproved: Boolean(live && live.kind === 'self'),
    fresh: Boolean(live && live.kind === 'fresh'),
    live,
    workers: self,
  };
}

// Who reviewed the done issues: the kind of each one's last approve, and how many carry no reviewer at all
// (an approve recorded without --by). Shown by status and report, never acted on.
export function reviewSplit(loop) {
  const split = { fresh: 0, coordinator: 0, self: 0, unrecorded: 0 };
  for (const i of loop.issues.filter((x) => loop.profile.is(x.status, 'closes-record'))) {
    const kind = approveKind(gateOf(loop, i.id));
    if (kind === 'retracted') split.retracted = (split.retracted || 0) + 1; else split[kind] += 1;
  }
  return split;
}
// The kind of the approve that stands behind an issue — the live one, the one that actually cleared it, not simply the
// last one recorded: a later coordinator (or self) approve does not make an already-cleared issue read as coordinator- or
// self-reviewed. `retracted` when the approve was taken back and none stands; `unrecorded` for an approve without --by.
function approveKind(g) {
  if (g.live) return g.live.kind || 'unrecorded';
  return g.trail.some((r) => r.verdict === 'approve' && r.retracted && r.n > g.cut) ? 'retracted' : 'unrecorded';
}

// The closed issues whose done gate does not hold on the record as it stands, each with its reason and the command that
// repairs it. Read from the journal the gate reads, never stored: the gate refuses at the move, and the record can change
// after it (an approve or a proof row retracted, a merge recorded later, a restart that spent the approve). Every issue
// in a finished status is read: a closing one against the gate's own conditions, any other against the merge it records.
export function closedGateFlags(loop) {
  const { profile } = loop;
  const flags = [];
  for (const issue of loop.issues) {
    if (!profile.is(issue.status, 'terminal')) continue;
    const id = issue.id;
    const events = loop.eventsById.get(id) || [];
    const merges = events.filter((e) => e.type === 'merged');
    const reasons = []; const repairs = [];
    const flag = (reason, repair) => { reasons.push(reason); if (!repairs.includes(repair)) repairs.push(repair); };
    const reopen = `jarl.mjs set ${id} open`;
    if (!profile.is(issue.status, 'closes-record')) {
      if (merges.length || mergedOf(issue)) flag(`a merge is recorded on a ${issue.status} issue`, reopen);
    } else {
      const g = gateOf(loop, id);
      if (!g.tracked) continue;
      const code = carriesCode(issue);
      if (!g.rowsSince) flag(g.rowLog.some((r) => r.retracted && r.n > g.anchorN) ? 'its proof row was retracted' : `no --ran/--saw row since it was ${g.anchor.what === 'filed' ? 'filed' : `moved → ${g.anchor.what}`}`, `jarl.mjs evidence ${id} --ran "<command>" --saw "<what it printed>"`);
      if (profile.doneGate.approve !== 'none') {
        const fresh = `jarl.mjs review ${id} approve --by <fresh reviewer> "<findings>"`;
        const kind = approveKind(g);
        if (g.selfApproved) flag('its live approve is by a worker of this issue or its branch', fresh);
        else if (!g.approved) flag(kind === 'retracted' ? 'its approve was retracted' : g.trail.some((r) => r.verdict === 'approve') ? 'its approve is spent by a later round, restart, reopen or changes verdict' : 'it holds no approve', fresh);
        else if (code && !g.fresh) flag(`it carries code and holds no fresh approve (the live one is by ${g.live.by || 'a reviewer not recorded'}, ${g.live.kind || 'unrecorded'})`, fresh);
      }
      const doneAt = Math.max(-1, ...events.filter((e) => e.type === 'move' && profile.is(e.to, 'closes-record')).map((e) => e.n));
      if (merges.some((m) => m.n > doneAt)) flag('a merge was recorded after it went done', reopen);
      if (fieldText(issue.fields.branch) && !merges.length && !mergedOf(issue)) flag('a code issue done with no merge recorded', reopen);
    }
    if (reasons.length) flags.push({ id, reason: reasons.join('; '), repair: repairs.join(' ; ') });
  }
  return flags;
}
const closedGateLine = (x) => `closed, gate does not hold: ${x.id} · ${x.reason} — repair: ${x.repair}`;
// Who stands behind the closed issues: the reviewers, by kind — or, under a done gate with no approve, the merge that
// landed each one, with whatever reviews were recorded all the same.
function gateLine(profile, split, label) {
  if (profile.doneGate.approve !== 'none') return `${label}: ${renderSplit(split)}`;
  return `closed on a merge in the base, no approve required (this loop's done gate) · reviews recorded: ${renderSplit(split)}`;
}
function renderSplit(s) { return `fresh ${s.fresh} · coordinator ${s.coordinator} · self ${s.self}${s.retracted ? ` · retracted ${s.retracted}` : ''}${s.unrecorded ? ` · unrecorded ${s.unrecorded}` : ''}`; }

// ---- the check a loop lands on, and the loop's metrics (report --json) ----------------------------------------------

// The check a loop declares: every `Check: <what runs>` line of the goal is the command of the whole loop; a
// `Check (<name>): <what runs>` line is the command of the repository <name>, written as its Files prefix writes it
// (see goalLines). Jarl never runs it: the line says what the check is, and the merge rows say whether a landing passed
// it. Where the repository has a check, the check decides what lands; a review can only stop a change and is recorded
// as testimony.
export function declaredChecksByRepo(root) { return goalLines(readGoal(jarlDir(root))).checksByRepo; }
// Every command the goal names, bare lines first.
export function declaredChecks(root) { return goalLines(readGoal(jarlDir(root))).checks; }

// The merge a log line records: `<id> merged <sha>[ in <repo>]`, then the fields it names in any order — `check <what
// ran>` for a merge landed on a passing check row, `landed red, cause <id>` for one landed while its check was red for a
// cause outside the branch, and `CI <state>`. Null for any other line.
export function mergeLineOf(id, text) {
  const parts = text.split(' · ');
  const head = new RegExp(`^${id} merged (\\S+)(?: in (.+))?$`).exec(parts[0]);
  if (!head) return null;
  const line = { sha: head[1], repo: head[2] || null, check: null, red: null, ci: null };
  for (const p of parts.slice(1)) {
    let m;
    if ((m = /^check (.+)$/.exec(p))) line.check = m[1];
    else if ((m = /^landed red, cause (\S+)$/.exec(p))) line.red = m[1];
    else if ((m = /^CI (pending|green|red|none)$/.exec(p))) line.ci = m[1];
  }
  return line;
}

// The last merge an issue's events record, or null.
function lastMerge(events) {
  let line = null;
  for (const e of events) if (e.type === 'merged') line = e;
  return line;
}

// What the merges say about the check, from the log: every merged issue counts once, by its last merge line, as landed
// on the declared check (its --ran text equals a command the repository's Check lines declare, after trimming), on red
// (with the issue that tracks the cause), or on neither (no check row, or a row that is not the declared check). Per
// repository, an issue naming several counts in each. A repository's declared check is its own `Check (<repo>)` lines,
// else the loop's `Check:` lines. A repository lands on its check (`check`) when every merge carries it, on
// testimony (`testimony`) when none does or none is declared, and is `partial` between: k is the merges carrying the
// declared check, n all its merges.
export function checkState(loop) {
  const { root, issues } = loop;
  const declared = loop.goalLines.checksByRepo;
  const checks = loop.goalLines.checks;
  const declaredFor = (name) => (declared.repos[name] && declared.repos[name].length ? declared.repos[name] : declared.bare);
  const byRepo = {};
  const repo = (name) => (byRepo[name] = byRepo[name] || { repo: name, merges: 0, withCheck: 0, noCheck: 0, red: [], declared: declaredFor(name), landsOn: 'testimony' });
  for (const name of Object.keys(declared.repos)) repo(name);
  const total = { merges: 0, withCheck: 0, noCheck: 0, red: [] };
  for (const i of issues) {
    // A merge on work that was dropped or deferred is no landing of the loop's work: closedGateFlags names it instead.
    if (loop.profile.is(i.status, 'terminal') && !loop.profile.is(i.status, 'closes-record')) continue;
    const line = lastMerge(loop.eventsById.get(i.id) || []);
    if (!line && !mergedOf(i)) continue;
    const names = repoNames(root, i);
    const kindIn = (name) => (line && line.red ? 'red' : carriesDeclared(line, repo(name).declared) ? 'withCheck' : 'noCheck');
    for (const name of names) {
      const r = repo(name);
      r.merges += 1;
      if (kindIn(name) === 'red') r.red.push({ id: i.id, cause: line.red }); else r[kindIn(name)] += 1;
    }
    const kind = line && line.red ? 'red' : names.some((n) => kindIn(n) === 'withCheck') ? 'withCheck' : 'noCheck';
    total.merges += 1;
    if (kind === 'red') total.red.push({ id: i.id, cause: line.red }); else total[kind] += 1;
  }
  const lands = (t) => (t.merges > 0 && t.withCheck === t.merges ? 'check' : t.withCheck === 0 ? 'testimony' : 'partial');
  for (const r of Object.values(byRepo)) { r.landsOn = lands(r); r.k = r.withCheck; r.n = r.merges; }
  return { declared: checks.length > 0, checks, landsOn: lands(total), merges: total, byRepo: Object.fromEntries(Object.keys(byRepo).sort().map((k) => [k, byRepo[k]])) };
}
// Whether a merge line's check text names one of the declared commands: the text is the --ran commands of the call
// joined by " ; " (see cmdMerged), compared with each declared command after trimming.
function carriesDeclared(line, commands) {
  if (!line || !line.check || !commands.length) return false;
  const norm = (s) => fieldText(s).replace(/ +· +/g, ' - ').slice(0, 200);
  const wanted = commands.map(norm);
  return line.check.split(' ; ').some((part) => wanted.includes(part.trim()));
}
export const TESTIMONY_NOTE = 'no merge carries the declared check — this loop lands on testimony alone: a review is recorded as testimony, not proof (a merge carries the check when its --ran text equals a command a Check line of the goal declares: merged <ids> --sha <sha> --ran "<check>" --saw "<summary>")';
// The landing banner: the testimony mark while no merge carries the declared check, then one line per repository, the count
// of its merges that carry the declared check, or the mark that it declares none.
export function checkLines(c) {
  const lines = c.landsOn === 'testimony' ? [TESTIMONY_NOTE] : [];
  for (const [name, r] of Object.entries(c.byRepo)) {
    if (!r.merges && !r.declared.length) continue;
    lines.push(r.declared.length ? `check ${name}: ${r.k} of ${r.n} merges carry the declared check · declared ${r.declared.join(' · ')}` : `check ${name}: no check declared — ${r.n} merge(s) land on testimony alone`);
  }
  return lines;
}
// One line per repository: its merges by what they carry, the red ones with their cause.
export function mergeCheckLines(c) {
  const names = Object.keys(c.byRepo).filter((n) => c.byRepo[n].merges || c.byRepo[n].declared.length);
  if (!names.length) return [];
  const width = Math.max(...names.map((n) => n.length));
  return names.map((n) => {
    const r = c.byRepo[n];
    return `  ${n.padEnd(width)}  ${r.merges} merge(s) · with the declared check ${r.withCheck} · without it ${r.noCheck} · landed on red ${r.red.length}${r.red.length ? ` (${r.red.map((x) => `${x.id}, cause ${x.cause}`).join('; ')})` : ''}${r.declared.length ? ` · declared ${r.declared.join(' · ')}` : ''}`;
  });
}

// A journal stamp (YYYY-MM-DD HH:MM, UTC) in milliseconds.
function stampMs(at) { return Date.parse(`${at.replace(' ', 'T')}:00Z`); }
const HOUR = 3600000;
const DAY = 24 * HOUR;
const round1 = (x) => Math.round(x * 10) / 10;
const share = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 1000 : null);
const pct = (s) => `${round1(s * 100)}%`;
function spread(values) {
  if (!values.length) return { n: 0, medianHours: null, p90Hours: null, maxHours: null };
  const v = [...values].sort((a, b) => a - b);
  const at = (q) => v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)];
  const mid = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  return { n: v.length, medianHours: round1(mid / HOUR), p90Hours: round1(at(0.9) / HOUR), maxHours: round1(v[v.length - 1] / HOUR) };
}

// The loop's metrics, read from its record alone — the journal and the issue files — never from git or a network. Each
// metric carries n (how many issues it was read from) and, where the record holds nothing to read it from, noData with
// the reason and null values instead of a zero: an approve logged without --by has no kind, a loop with no merge
// has no CI after a merge, and a zero there would claim something the record never said.
//
// - cycleTime: first move into a status that holds the claim (in progress) → last move into one that closes the record
//   (done), per closed issue; leadTime the same from its filing. Hours, median, p90, max.
// - rounds: `round` lines and `changes` verdicts per closed issue the journal tracks.
// - reopenings: moves out of a status that closes the record (done back to open or in progress), on any issue the
//   journal tracks; deferred or dropped work brought back is not a reopening — nothing was closed as finished.
// - freshReviews: the kind of the live approve that cleared each closed issue (see gateState), its share among those
//   with a recorded kind, the same for closed issues carrying code, and who the fresh reviewers were.
// - redCiAfterMerge: issues whose CI was recorded red at any point after their merge, among merges whose CI settled
//   (green or red); pending and none (no CI to wait for) are counted apart.
// - followUps: issues filed within 7 days after a closed issue first closed whose Found by names its number. A closed
//   research issue is left out: the issues filed from its findings are what it was for, not defects it left behind.
export const FOLLOW_UP_DAYS = 7;
// When each issue was filed and when it first moved into a status that closes the record, by issue, from its events.
function filedAndClosed(issues, journal, profile) {
  const filed = new Map();
  const firstClose = new Map();
  for (const i of issues) {
    for (const e of journal.get(i.id) || []) {
      if (e.type === 'filed' && !filed.has(i.id)) filed.set(i.id, e.at);
      if (e.type === 'move' && profile.is(e.to, 'closes-record') && !firstClose.has(i.id)) firstClose.set(i.id, e.at);
    }
  }
  return { filed, firstClose };
}
// The follow-up rule, once: the issues filed within FOLLOW_UP_DAYS after another issue first closed, whose Found by
// names it, by the issue they follow. An issue follows only a closed issue that has its close in the journal, and not a
// research one: the issues filed from a research issue's findings are what it was for, not defects it left behind.
function followUpsOf(issues, filed, firstClose, profile) {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const followable = (i) => i.kind !== 'research' && firstClose.has(i.id);
  const found = new Map();
  for (const y of issues) {
    if (!filed.has(y.id)) continue;
    for (const x of new Set(idsNamed(y.fields['found by'], byId))) {
      if (x === y.id || !byId.has(x) || !followable(byId.get(x)) || !profile.is(byId.get(x).status, 'closes-record')) continue;
      const gap = stampMs(filed.get(y.id)) - stampMs(firstClose.get(x));
      if (gap >= 0 && gap <= FOLLOW_UP_DAYS * DAY) found.set(x, [...(found.get(x) || []), y.id]);
    }
  }
  return found;
}
// loopMetrics reads the loop for one call, at `now` (its fourth argument); metricsOf takes a loop already read.
export function loopMetrics(root, issues, events, now) { return metricsOf(readLoop(jarlDir(root)), now ?? Date.now()); }
export function metricsOf(loop, now) {
  const { profile, issues } = loop;
  const journal = loop.eventsById;
  const closes = (st) => profile.is(st, 'closes-record');
  const claims = (st) => profile.is(st, 'holds-claim');
  const { filed: filedAt, firstClose: firstCloseAt } = filedAndClosed(issues, journal, profile);
  // One pass over each issue's journal: the moves, rounds, changes, merges and CI states.
  const facts = new Map();
  for (const i of issues) {
    const f = { filed: filedAt.get(i.id) || null, firstClaim: null, firstClose: firstCloseAt.get(i.id) || null, lastClose: null, rounds: 0, changes: 0, reopens: 0, merged: false, ci: [], tracked: false };
    for (const e of journal.get(i.id) || []) {
      if (e.type === 'filed') { f.tracked = true; continue; }
      if (e.type === 'move') {
        const prev = e.from; const status = e.to; f.tracked = true;
        if (claims(status) && !f.firstClaim) f.firstClaim = e.at;
        if (closes(status)) f.lastClose = e.at;
        if (prev && closes(prev) && !closes(status)) f.reopens += 1;
        continue;
      }
      if (e.type === 'round') { f.rounds += 1; continue; }
      if (e.type === 'verdict' && e.verdict === 'changes') { f.changes += 1; continue; }
      if (e.type === 'merged') { f.merged = true; if (e.ci) f.ci.push(e.ci); continue; }
      if (e.type === 'ci' && f.merged) f.ci.push(e.state);
    }
    // A merge recorded on the issue with no journal line for it (a hand-made file): its CI field as the one reading.
    if (!f.merged && mergedOf(i)) { f.merged = true; if (mergedOf(i).ci) f.ci.push(mergedOf(i).ci); }
    facts.set(i.id, f);
  }
  const closed = issues.filter((i) => closes(i.status));
  const noData = (cond, why) => (cond ? why : null);

  const cycle = closed.map((i) => facts.get(i.id)).filter((f) => f.firstClaim && f.lastClose && stampMs(f.lastClose) >= stampMs(f.firstClaim)).map((f) => stampMs(f.lastClose) - stampMs(f.firstClaim));
  const cycleTime = { ...spread(cycle), of: closed.length, noData: noData(!cycle.length, closed.length ? 'no closed issue has a move into progress and a later close in the journal' : 'nothing closed yet') };
  const lead = closed.map((i) => facts.get(i.id)).filter((f) => f.filed && f.lastClose).map((f) => stampMs(f.lastClose) - stampMs(f.filed));
  const leadTime = { ...spread(lead), of: closed.length, noData: noData(!lead.length, closed.length ? 'no closed issue has its filing and its close in the journal' : 'nothing closed yet') };

  const trackedClosed = closed.filter((i) => facts.get(i.id).tracked);
  const withRounds = trackedClosed.filter((i) => facts.get(i.id).rounds);
  const withChanges = trackedClosed.filter((i) => facts.get(i.id).changes);
  const rounds = {
    n: trackedClosed.length,
    rounds: trackedClosed.length ? withRounds.reduce((s, i) => s + facts.get(i.id).rounds, 0) : null,
    issuesWithRounds: trackedClosed.length ? withRounds.map((i) => i.id) : null,
    changes: trackedClosed.length ? withChanges.reduce((s, i) => s + facts.get(i.id).changes, 0) : null,
    issuesWithChanges: trackedClosed.length ? withChanges.map((i) => i.id) : null,
    noData: noData(!trackedClosed.length, closed.length ? 'the journal tracks no closed issue' : 'nothing closed yet'),
  };

  const tracked = issues.filter((i) => facts.get(i.id).tracked);
  const reopened = tracked.filter((i) => facts.get(i.id).reopens);
  const reopenings = { n: tracked.length, times: tracked.length ? reopened.reduce((s, i) => s + facts.get(i.id).reopens, 0) : null, issues: tracked.length ? reopened.map((i) => i.id) : null, noData: noData(!tracked.length, 'the journal tracks no issue') };

  const kinds = { fresh: 0, coordinator: 0, self: 0, unrecorded: 0 };
  const code = { fresh: 0, coordinator: 0, self: 0, unrecorded: 0 };
  const reviewers = {};
  for (const i of closed) {
    const g = gateOf(loop, i.id);
    const k = approveKind(g);
    kinds[k] = (kinds[k] || 0) + 1;
    if (carriesCode(i)) code[k] = (code[k] || 0) + 1;
    if (k === 'fresh') reviewers[g.live.by] = (reviewers[g.live.by] || 0) + 1;
  }
  const recorded = kinds.fresh + kinds.coordinator + kinds.self;
  const codeRecorded = code.fresh + code.coordinator + code.self;
  const freshReviews = {
    n: closed.length, recorded, ...kinds, share: share(kinds.fresh, recorded),
    code: { n: codeRecorded + code.unrecorded + (code.retracted || 0), recorded: codeRecorded, ...code, share: share(code.fresh, codeRecorded) },
    reviewers: Object.fromEntries(Object.entries(reviewers).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    noData: noData(!recorded, closed.length ? `no closed issue's approve records who gave it (${kinds.unrecorded} from before --by)` : 'nothing closed yet'),
  };

  const mergedIssues = issues.filter((i) => facts.get(i.id).merged);
  const red = mergedIssues.filter((i) => facts.get(i.id).ci.includes('red'));
  const settled = mergedIssues.filter((i) => facts.get(i.id).ci.some((c) => c === 'green' || c === 'red'));
  const lastCi = (i) => facts.get(i.id).ci[facts.get(i.id).ci.length - 1] || null;
  const redCiAfterMerge = {
    n: mergedIssues.length, settled: settled.length, red: settled.length ? red.length : null, issues: settled.length ? red.map((i) => i.id) : null, share: share(red.length, settled.length),
    pending: mergedIssues.filter((i) => lastCi(i) === 'pending').map((i) => i.id), none: mergedIssues.filter((i) => lastCi(i) === 'none').map((i) => i.id),
    noData: noData(!settled.length, mergedIssues.length ? 'no merge has a CI recorded green or red yet' : 'no merge recorded'),
  };

  // Follow-ups: the closed issues that have a close time in the journal, and every issue filed within the window after
  // it that names its number in Found by. The window of a close less than 7 days ago is still open: counted apart.
  const anyFoundBy = issues.some((i) => fieldText(i.fields['found by']));
  const closedAt = closed.filter((i) => i.kind !== 'research' && facts.get(i.id).firstClose);
  const found = followUpsOf(issues, filedAt, firstCloseAt, profile);
  // The share is taken over the closes whose window has passed: a close from yesterday with no follow-up yet has not
  // shown it has none, so counting it would pull the share toward a zero the record cannot back.
  const windowClosed = closedAt.filter((i) => now - stampMs(facts.get(i.id).firstClose) >= FOLLOW_UP_DAYS * DAY);
  const windowClosedWith = windowClosed.filter((i) => found.has(i.id)).length;
  const followUps = {
    windowDays: FOLLOW_UP_DAYS, n: closedAt.length, windowOpen: closedAt.length - windowClosed.length,
    withFollowUps: anyFoundBy && closedAt.length ? found.size : null,
    windowClosed: windowClosed.length, windowClosedWithFollowUps: anyFoundBy && windowClosed.length ? windowClosedWith : null,
    share: anyFoundBy ? share(windowClosedWith, windowClosed.length) : null,
    followUps: anyFoundBy ? [...found.keys()].sort(cmpId).map((id) => ({ id, followUps: found.get(id) })) : null,
    noData: noData(!anyFoundBy || !closedAt.length, !anyFoundBy ? 'no issue records Found by, so no follow-up can be traced to what it follows' : closed.length ? 'no closed issue outside research has its close in the journal' : 'nothing closed yet'),
  };

  return { check: checkState(loop), cycleTime, leadTime, rounds, reopenings, freshReviews, redCiAfterMerge, followUps };
}

export function renderMetrics(m) {
  const nd = (x) => `no data (${x.noData})`;
  const time = (x) => (x.noData ? nd(x) : `median ${x.medianHours} h · p90 ${x.p90Hours} h · max ${x.maxHours} h · n ${x.n} of ${x.of} closed`);
  const list = (ids) => (ids.length ? `: ${ids.join(', ')}` : '');
  const f = m.freshReviews;
  return [
    '## Loop metrics',
    ...checkLines(m.check),
    ...(m.check.merges.merges ? ['merges by repository:', ...mergeCheckLines(m.check)] : []),
    `cycle time (in progress → closed): ${time(m.cycleTime)}`,
    `lead time (filed → closed): ${time(m.leadTime)}`,
    `rounds: ${m.rounds.noData ? nd(m.rounds) : `${m.rounds.rounds} on ${m.rounds.issuesWithRounds.length} issue(s) · changes verdicts ${m.rounds.changes} on ${m.rounds.issuesWithChanges.length} issue(s) · n ${m.rounds.n} closed`}`,
    `reopened: ${m.reopenings.noData ? nd(m.reopenings) : `${m.reopenings.issues.length} issue(s), ${m.reopenings.times} time(s)${list(m.reopenings.issues)} · n ${m.reopenings.n}`}`,
    `fresh reviews of closed work: ${f.noData ? nd(f) : `${f.fresh} of ${f.recorded} with a recorded reviewer (${pct(f.share)}) · coordinator ${f.coordinator} · self ${f.self}${f.retracted ? ` · retracted ${f.retracted}` : ''}${f.unrecorded ? ` · no data for ${f.unrecorded} (approved before --by)` : ''}${f.code.recorded ? ` · carrying code: ${f.code.fresh} of ${f.code.recorded} (${pct(f.code.share)})` : ''}`}`,
    ...(Object.keys(f.reviewers).length ? [`fresh reviewers: ${Object.keys(f.reviewers).length}${Object.keys(f.reviewers).length > 5 ? ', most often' : ''} ${Object.entries(f.reviewers).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(' · ')}`] : []),
    `red CI after merge: ${m.redCiAfterMerge.noData ? nd(m.redCiAfterMerge) : `${m.redCiAfterMerge.red} of ${m.redCiAfterMerge.settled} settled (${pct(m.redCiAfterMerge.share)})${list(m.redCiAfterMerge.issues)}`}${m.redCiAfterMerge.pending.length ? ` · pending ${m.redCiAfterMerge.pending.length}` : ''}${m.redCiAfterMerge.none.length ? ` · no CI ${m.redCiAfterMerge.none.length}` : ''}`,
    `follow-ups within ${m.followUps.windowDays} days (Found by names the closed issue): ${m.followUps.noData ? nd(m.followUps) : `${m.followUps.withFollowUps} of ${m.followUps.n} closed${m.followUps.followUps.length ? `: ${m.followUps.followUps.map((x) => `${x.id} ← ${x.followUps.join(', ')}`).join('; ')}` : ''} · ${m.followUps.windowClosed ? `share ${m.followUps.windowClosedWithFollowUps} of ${m.followUps.windowClosed} whose ${m.followUps.windowDays} days have passed (${pct(m.followUps.share)})` : `share: no data (no close is ${m.followUps.windowDays} days old yet)`}${m.followUps.windowOpen ? ` · window still open for ${m.followUps.windowOpen}` : ''}`}`,
  ].join('\n');
}

// ---- the model of every worker and reviewer ------------------------------------------------------------------------
//
// The record names who worked and who reviewed; the model is the one missing fact. It rides the two calls that name the
// agent anyway (set in-progress --model, review --model), is stored as given (the platform's model id, with @<effort> where
// the platform has that lever, so the calibrated unit is the pair), and Jarl keeps no list of models. Everything derived
// from it is read-only and only ever suggests: Jarl never refuses, reroutes or changes anything by model.

export const MODEL_MIN_N = 5;
// A finding that opens like a field would read as one: its line gets a lead-in, so no free text is ever a model or a relay mark.
const loggedFinding = (line) => (/^(model |relayed( ·|$))/i.test(line) ? `findings: ${line}` : line);

// A --model value: the platform's model id as given, trimmed. One value, and never the log's own separator.
function modelValue(raw) {
  const m = fieldText(raw);
  need(typeof raw === 'string' && m, '--model needs a value — the platform\'s model id, with @<effort> where the platform has a reasoning-effort lever');
  need(!m.includes(' · '), `--model is one value, the model id as the platform names it — not a phrase with " · " in it (got "${m}")`);
  return m;
}
const baseModelId = (m) => String(m).split('@')[0];

// The model lines of the goal: `Model (<tier>): <model>[, <model>…]` (see goalLines). The first model of a line is the
// tier's default; the order of the profile's tiers, weakest first, ranks the models; a model on no line is unplaced and
// ranks below every placed one. The same id at another effort sits where the id sits.
export function modelLines(root) { return modelLinesIn(goalLines(readGoal(jarlDir(root))), loadProfile(root)); }
function modelLinesIn(lines, profile) {
  const byTier = {};
  for (const line of lines.models) {
    const tier = profile.tiers.find((t) => t.toLowerCase() === line.tier.toLowerCase());
    if (!tier) continue;
    byTier[tier] = [...(byTier[tier] || []), ...line.models];
  }
  const exact = new Map();
  const base = new Map();
  profile.tiers.forEach((t, k) => (byTier[t] || []).forEach((m) => {
    exact.set(m, Math.max(k, exact.get(m) ?? -1));
    base.set(baseModelId(m), Math.max(k, base.get(baseModelId(m)) ?? -1));
  }));
  const rank = (model) => (model == null ? -1 : exact.has(model) ? exact.get(model) : base.get(baseModelId(model)) ?? -1);
  return {
    declared: Object.keys(byTier).length > 0, byTier, tiers: profile.tiers, rank,
    defaultOf: (tier) => (byTier[tier] || [])[0] || null,
    placedTier: (model) => (rank(model) >= 0 ? profile.tiers[rank(model)] : null),
  };
}

// Every model an issue was leased on, from its own journal (a takeover adds one).
function leaseModels(events) {
  return events.filter((e) => e.type === 'move' && e.model).map((e) => e.model);
}

// The notes a verdict gets on the command line in a loop that declares model lines: never a refusal.
function reviewModelNotes(issue, verdict, model, lines, events) {
  if (model === undefined) return [`${issue.id}: no --model on this verdict — the loop declares its models; record the model this reviewer was raised on`];
  if (verdict !== 'approve') return [];
  const workers = [...new Set(leaseModels(events))];
  if (!workers.length) return [];
  if (workers.includes(model)) return [`${issue.id}: an approve by the same model as the worker's (${model}) — a fresh instance is still a fresh reviewer, but the correlation risk is real; the approve that clears an issue comes from another model, not a lower-ranked one, until \`models\` says otherwise`];
  const top = Math.max(...workers.map(lines.rank));
  if (top >= 0 && lines.rank(model) < top) return [`${issue.id}: ${model} ranks below the worker's model (${workers.find((w) => lines.rank(w) === top)})${lines.rank(model) < 0 ? ' — it is on no model line, and an unplaced model ranks below every placed one' : ''}; the approve that clears an issue comes from a model of at least the worker's rank, until \`models\` says it may clear`];
  return [];
}

const issueRepoLabels = (dir, issue) => {
  const named = reposNamed(issue);
  return named.length ? [...new Set(named.map((n) => repoLabel(n, dir)))] : [repoLabel(resolve(dir))];
};

// What one loop's record shows of its workers (one row per unit: one worker on one branch, which is one issue or one
// package leased in one call; a takeover starts a new unit) and of its verdicts, each with the model beside the name.
function modelFacts(loop, label, lines) {
  const { profile, issues, byId } = loop;
  const dir = loop.root;
  const journal = loop.eventsById;
  const closes = (st) => profile.is(st, 'closes-record');
  const claims = (st) => profile.is(st, 'holds-claim');
  const eventsOf = (id) => journal.get(id) || [];
  const { filed, firstClose } = filedAndClosed(issues, journal, profile);
  const follow = followUpsOf(issues, filed, firstClose, profile);

  // The units: every lease that names a worker, grouped by branch, worker and model.
  const unitMap = new Map();
  for (const { id } of issues) {
    for (const e of eventsOf(id)) {
      if (e.type !== 'move' || !e.lease) continue;
      const key = `${e.lease.branch || id}\n${e.lease.worker}\n${e.lease.model || ''}`;
      const u = unitMap.get(key) || { worker: e.lease.worker, model: e.lease.model, issues: new Map() };
      if (!u.issues.has(id)) u.issues.set(id, e.n);
      unitMap.set(key, u);
    }
  }
  // One issue inside one unit: from its lease to the next lease of another worker or model on it (a handover), or the end.
  const inUnit = (id, from, worker, model) => {
    const ev = eventsOf(id);
    const handover = ev.find((e) => e.n > from && e.type === 'move' && e.lease && (e.lease.worker !== worker || (e.lease.model && e.lease.model !== model)));
    const win = ev.filter((e) => e.n > from && (!handover || e.n < handover.n));
    let status = 'in-progress';
    let closed = false;
    for (const e of win) if (e.type === 'move') { status = e.to; if (closes(status)) closed = true; }
    const verdicts = win.filter((e) => e.type === 'verdict');
    const first = verdicts[0] || null;
    const firstApprove = verdicts.find((v) => v.verdict === 'approve');
    const rounds = win.filter((e) => e.type === 'round');
    const active = !closed && !handover && claims(status);
    return {
      closed, handedOver: Boolean(handover), active, ended: !closed && !handover && !active,
      changes: verdicts.filter((v) => v.verdict === 'changes').length, rounds: rounds.length,
      redAfterApprove: Boolean(firstApprove && rounds.some((r) => r.n > firstApprove.n)),
      rowsBeforeReview: win.filter((e) => e.type === 'row' && (!first || e.n < first.n)).length, reviewed: verdicts.length > 0,
    };
  };
  const units = [];
  for (const u of unitMap.values()) {
    const per = [...u.issues].map(([id, from]) => ({ id, ...inUnit(id, from, u.worker, u.model) }));
    if (per.some((p) => p.active)) continue;
    const lead = byId.get([...u.issues.keys()].sort(cmpId)[0]);
    const reviewed = per.some((p) => p.reviewed);
    const settled = per.every((p) => p.closed || p.handedOver);
    units.push({
      loop: label, model: u.model, worker: u.worker, kind: lead.kind || '(none)', tier: lead.tier, repos: issueRepoLabels(dir, lead), tags: lead.tags,
      ended: !settled, reviewed,
      clean: per.every((p) => p.closed && !p.changes && !p.rounds && !p.handedOver),
      changes: per.reduce((s, p) => s + p.changes, 0), rounds: per.reduce((s, p) => s + p.rounds, 0),
      redAfterApprove: per.some((p) => p.redAfterApprove), handedOver: per.some((p) => p.handedOver),
      rowsBefore: per.filter((p) => p.reviewed).every((p) => p.rowsBeforeReview > 0) && reviewed,
      followUps: per.reduce((s, p) => s + (follow.get(p.id) || []).length, 0),
    });
  }

  // The verdicts: per approve, whether a later reviewer of another model checked it, whether it missed, and whether it
  // is the approve that cleared the issue on the worker's own model or a lower-ranked one.
  const verdicts = [];
  for (const issue of issues) {
    const { id } = issue;
    const ev = eventsOf(id);
    const workers = [...new Set(leaseModels(ev))];
    const top = Math.max(-1, ...workers.map(lines.rank));
    const ownOrLower = (m) => m != null && workers.length > 0 && (workers.includes(m) || (top >= 0 && lines.rank(m) < top));
    const seq = ev.filter((e) => e.type === 'verdict' && e.by || e.type === 'round' || e.type === 'move');
    let lastDone = -1;
    seq.forEach((e, k) => { if (e.type === 'move' && closes(e.to)) lastDone = k; });
    let clearing = -1;
    seq.forEach((e, k) => { if (k < lastDone && e.type === 'verdict' && e.verdict === 'approve' && e.kind !== 'self') clearing = k; });
    seq.forEach((e, k) => {
      if (e.type !== 'verdict') return;
      const row = {
        loop: label, model: e.model, by: e.by, relayed: e.relayed, verdict: e.verdict, kind: issue.kind || '(none)', tier: issue.tier,
        repos: issueRepoLabels(dir, issue), tags: issue.tags, checked: false, miss: false, ownOrLower: false, clearing: false, lowChecked: false,
      };
      if (e.verdict === 'approve') {
        row.ownOrLower = ownOrLower(e.model);
        row.clearing = k === clearing && row.ownOrLower;
        for (const y of seq.slice(k + 1)) {
          if (y.type === 'round') { row.miss = true; break; }
          if (y.type === 'move') {
            if (y.from != null && closes(y.from) && !closes(y.to)) { row.miss = true; break; }
            if (!closes(y.to) && !(y.from != null && claims(y.from) && claims(y.to))) break;
            continue;
          }
          const same = y.model != null && e.model != null ? y.model === e.model : y.by === e.by;
          if (same) continue;
          row.checked = true;
          if (y.verdict === 'changes') row.miss = true;
          row.lowChecked = row.ownOrLower && y.model != null && !ownOrLower(y.model);
          break;
        }
      }
      verdicts.push(row);
    });
  }
  return { label, issues: issues.length, units, verdicts };
}

// Worker rows: one per model, one cell per kind of task (Kind · Tier); work with no model is grouped by tier alone.
const cellKey = (r) => (r.model == null ? `tier ${r.tier}` : `${r.kind} · ${r.tier}`);
const byLabel = (a, b) => (a.model == null) - (b.model == null) || String(a.model).localeCompare(String(b.model));
function workerCell(key, rows, extra = {}) {
  const n = rows.filter((r) => !r.ended);
  const c = (f) => n.filter(f).length;
  return {
    key, kind: rows[0].model == null ? null : rows[0].kind, tier: rows[0].tier,
    units: n.length, reviewed: c((r) => r.reviewed), clean: c((r) => r.clean), share: n.length >= MODEL_MIN_N ? share(c((r) => r.clean), n.length) : null,
    changes: n.reduce((s, r) => s + r.changes, 0), rounds: n.reduce((s, r) => s + r.rounds, 0), redAfterApprove: c((r) => r.redAfterApprove), handedOver: c((r) => r.handedOver),
    endedBeforeReview: rows.filter((r) => r.ended && !r.reviewed).length, endedAfterReview: rows.filter((r) => r.ended && r.reviewed).length, rowsBeforeReview: c((r) => r.rowsBefore),
    rowsShare: n.length >= MODEL_MIN_N ? share(c((r) => r.rowsBefore), n.length) : null, followUps: n.reduce((s, r) => s + r.followUps, 0),
    word: null, rollup: false, ...extra,
  };
}
const groupBy = (list, f) => { const g = new Map(); for (const x of list) { const k = f(x); g.set(k, [...(g.get(k) || []), x]); } return g; };
const atLeastShare = (a, b) => a.clean * b.units >= b.clean * a.units;   // a's clean share is at least b's, without rounding

function workerTable(unitRows, lines) {
  const baseline = new Map([...groupBy(unitRows.filter((r) => !r.ended), (r) => `${r.kind} · ${r.tier}`)].map(([k, rs]) => [k, { key: k, units: rs.length, clean: rs.filter((r) => r.clean).length }]));
  const tierBase = new Map([...groupBy(unitRows.filter((r) => !r.ended), (r) => r.tier)].map(([k, rs]) => [k, { key: `all kinds · ${k}`, units: rs.length, clean: rs.filter((r) => r.clean).length }]));
  const rows = [...groupBy(unitRows, (r) => r.model ?? '')].map(([model, rs]) => {
    const cells = [...groupBy(rs, cellKey)].map(([key, list]) => workerCell(key, list)).sort((a, b) => a.key.localeCompare(b.key));
    if (model !== '') {
      for (const c of cells) if (c.units >= MODEL_MIN_N) c.word = atLeastShare(c, baseline.get(c.key)) ? 'fits' : 'below';
      // Below five units in a cell the view falls back once, to the model's numbers across the kinds at that tier.
      for (const [tier, list] of groupBy(cells, (c) => c.tier)) {
        if (list.length < 2) continue;
        const roll = workerCell(`all kinds · ${tier}`, rs.filter((r) => r.tier === tier), { rollup: true, kind: null });
        if (roll.units >= MODEL_MIN_N) roll.word = atLeastShare(roll, tierBase.get(tier)) ? 'fits' : 'below';
        cells.push(roll);
      }
    }
    return {
      model: model === '' ? null : model, label: model === '' ? '(not recorded)' : model, tier: model === '' ? null : lines.placedTier(model),
      placed: model !== '' && lines.rank(model) >= 0, unplaced: model !== '' && lines.declared && lines.rank(model) < 0,
      new: model !== '' && cells.every((c) => c.units < MODEL_MIN_N), loops: new Set(rs.map((r) => r.loop)).size, cells,
    };
  }).sort(byLabel);
  return { rows, baselines: [...baseline.values()].sort((a, b) => a.key.localeCompare(b.key)).map((b) => ({ ...b, share: b.units >= MODEL_MIN_N ? share(b.clean, b.units) : null })) };
}

function reviewerTable(verdictRows) {
  return [...groupBy(verdictRows, (r) => r.model ?? '')].map(([model, rs]) => {
    const cells = [...groupBy(rs, cellKey)].map(([key, list]) => {
      const approves = list.filter((r) => r.verdict === 'approve');
      const lowChecked = approves.filter((r) => r.lowChecked).length;
      const lowMisses = approves.filter((r) => r.ownOrLower && r.miss).length;
      return {
        key, kind: model === '' ? null : list[0].kind, tier: list[0].tier, verdicts: list.length, changes: list.length - approves.length, approves: approves.length,
        checked: approves.filter((r) => r.checked).length, misses: approves.filter((r) => r.miss).length, relayed: list.filter((r) => r.relayed).length,
        clearingOwnOrLower: approves.filter((r) => r.clearing).length, lowChecked, lowMisses,
        word: model !== '' && lowChecked >= MODEL_MIN_N && lowMisses === 0 ? `may clear ${key}` : null,
      };
    }).sort((a, b) => a.key.localeCompare(b.key));
    return { model: model === '' ? null : model, label: model === '' ? '(not recorded)' : model, loops: new Set(rs.map((r) => r.loop)).size, cells };
  }).sort(byLabel);
}

// The loops models reads: this one (when it has a live record), its own archives when asked (--archives), and every
// --with <root> (a root, or an archive directory under .jarl/archive/). A path that is not a loop is refused with a
// message. Read-only: no lock is taken and nothing is written.
function loopShape(path) {
  if (existsSync(logPath(join(path, '.jarl'))) && existsSync(join(path, '.jarl', 'issues'))) return 'root';
  if (existsSync(logPath(path)) && existsSync(join(path, 'issues'))) return 'archive';
  return null;
}
export function cmdModels(root, flags = {}) {
  need(flags.by === undefined || ['repo', 'tag'].includes(flags.by), `--by is one of: repo, tag (got "${flags.by}")`);
  need(flags.archives === undefined || flags.archives === true, '--archives takes no value');
  const lines = modelLines(root);
  const sources = [];
  const seen = new Set();
  const add = (label, path, shape) => { const key = canonical(path); if (!seen.has(key)) { seen.add(key); sources.push({ label, path, shape }); } };
  if (loopShape(root) === 'root') add('this loop', root, 'root');
  if (flags.archives === true) {
    const dir = join(jarlDir(root), 'archive');
    if (existsSync(dir)) for (const name of readdirSync(dir).sort()) if (loopShape(join(dir, name)) === 'archive') add(`archive ${name}`, join(dir, name), 'archive');
  }
  for (const p of [].concat(flags.with ?? [])) {
    need(typeof p === 'string' && p, '--with takes a loop: the directory holding .jarl/, or an archived loop under .jarl/archive/');
    let path = resolve(p);
    // A root's own .jarl/ is the same loop as the root.
    if (basename(path) === '.jarl' && loopShape(dirname(path)) === 'root') path = dirname(path);
    const shape = loopShape(path);
    need(shape, `${p} is not a loop: it holds no .jarl/ with a log and issues, and is not an archived loop (an archive directory holds ${LOG_FILE} and issues/) — nothing was read`);
    add(p, path, shape);
  }
  need(sources.length, `no loop to read here: ${root} holds no live loop — name one with --with <root>, or its archives with --archives`);
  const facts = sources.map((s) => modelFacts(readLoop(s.shape === 'archive' ? s.path : jarlDir(s.path)), s.label, lines));
  const unitRows = facts.flatMap((f) => f.units);
  const verdictRows = facts.flatMap((f) => f.verdicts);
  const tables = (u, v) => { const w = workerTable(u, lines); return { workers: w.rows, reviewers: reviewerTable(v), baselines: w.baselines }; };
  const out = {
    loops: facts.map((f) => ({ label: f.label, issues: f.issues, units: f.units.length, verdicts: f.verdicts.length })),
    by: flags.by ?? null, minN: MODEL_MIN_N, modelLines: { declared: lines.declared, byTier: lines.byTier },
  };
  if (flags.by === undefined) return { ...out, ...tables(unitRows, verdictRows) };
  const of = (r) => (flags.by === 'repo' ? r.repos : r.tags.length ? r.tags : ['(none)']);
  const values = [...new Set([...unitRows, ...verdictRows].flatMap(of))].sort();
  return { ...out, slices: values.map((value) => ({ value, ...tables(unitRows.filter((r) => of(r).includes(value)), verdictRows.filter((r) => of(r).includes(value))) })) };
}

const countOfN = (k, n) => `${k} of ${n}`;
export function renderModels(m) {
  const pc = (s) => (s == null ? '' : ` (${Math.round(s * 100)}%)`);
  const workerLine = (c, lead) => `  ${lead}  units ${c.units} · clean first pass ${countOfN(c.clean, c.units)}${pc(c.share)} · changes ${c.changes} · rounds ${c.rounds} · red after approve ${c.redAfterApprove} · handed over ${c.handedOver} · rows before review ${countOfN(c.rowsBeforeReview, c.units)}${pc(c.rowsShare)} · follow-ups ${c.followUps}${c.endedBeforeReview ? ` · ended before any review ${c.endedBeforeReview} (not in the units)` : ''}${c.endedAfterReview ? ` · ended after a review without closing ${c.endedAfterReview} (not in the units)` : ''}${c.word ? ` · ${c.word}` : ''}${c.rollup ? ' (all kinds at that tier)' : ''}`;
  const reviewerLine = (c, lead) => `  ${lead}  verdicts ${c.verdicts} (changes ${c.changes}, approves ${c.approves}) · approves checked by a later reviewer of another model ${c.checked} of ${c.approves} · misses ${c.misses} · relayed ${c.relayed} · clearing approves on its own or a lower-ranked model ${c.clearingOwnOrLower}${c.word ? ` · ${c.word}` : ''}`;
  const heading = (r) => `${r.label}${r.model == null ? '' : `${r.tier ? ` (${r.tier})` : ''}${r.unplaced ? ' [unplaced]' : ''}${r.new ? ' [new]' : ''}`}${r.loops > 1 ? ` · from ${r.loops} loops` : ''}`;
  const block = (t) => [
    '## As worker',
    ...(t.workers.length ? t.workers.flatMap((r) => [heading(r),...r.cells.map((c) => workerLine(c, r.model == null ? `(not recorded) · ${c.key}` : c.key))]) : ['(no unit of work yet)']),
    '', '## As reviewer',
    ...(t.reviewers.length ? t.reviewers.flatMap((r) => [heading({ ...r, tier: null }),...r.cells.map((c) => reviewerLine(c, r.model == null ? `(not recorded) · ${c.key}` : c.key))]) : ['(no verdict yet)']),
  ];
  return [
    `# Models · ${m.loops.map((l) => `${l.label} (${l.issues} issues, ${l.units} units, ${l.verdicts} verdicts)`).join(' · ')}`,
    `Grouped by the model as recorded; a kind of task is Kind · Tier. Every count carries its n and a share appears only from n >= ${m.minN}; fits and below compare a model's clean share with its kind's own baseline; may clear needs ${m.minN} approves by a lower-ranked or same-model reviewer that a reviewer able to clear checked afterwards, with no miss. Compare inside a kind: a model is measured on the work it was given, and a worker's clean share is only as strict as its reviewers. Not derived: whether a finding was right, cost, and every slip that never reached the record. Suggestions only; nothing here refuses or changes anything.`,
    m.modelLines.declared ? `Model lines: ${Object.entries(m.modelLines.byTier).map(([t, ms]) => `${t}: ${ms.join(', ')}`).join(' · ')}` : `This loop declares no Model (<tier>) lines in ${GOAL_FILE}, so no model is placed and no rank is known.`,
    '',
    ...(m.slices ? m.slices.flatMap((s) => [`# By ${m.by}: ${s.value}`, ...block(s), '']) : block(m)),
  ].join('\n').replace(/\n+$/, '');
}

// The tier default and the suggestion for a ready issue, in a loop that declares model lines. A model suggested is a
// lower-ranked, placed one that fits the issue's kind (its own cell, else its numbers across the kinds at that tier)
// while the default does no better there.
export function modelMarkFor(table, lines, issue) {
  const def = lines.defaultOf(issue.tier);
  const none = { default: def, suggested: null, basis: null };
  if (!def) return none;
  const key = `${issue.kind} · ${issue.tier}`;
  const pick = (row) => {
    if (!row) return null;
    const own = row.cells.find((c) => c.key === key && !c.rollup && c.units >= MODEL_MIN_N);
    if (own) return own;
    return row.cells.find((c) => c.rollup && c.tier === issue.tier && c.units >= MODEL_MIN_N) || null;
  };
  const defCell = pick(table.workers.find((r) => r.model === def));
  let best = null;
  for (const row of table.workers) {
    if (row.model == null || lines.rank(row.model) < 0 || lines.rank(row.model) >= lines.rank(def)) continue;
    const c = pick(row);
    if (!c || c.word !== 'fits') continue;
    // The default "does no better there": the candidate's share is at least as good as the default's.
    if (defCell && c.clean * defCell.units < defCell.clean * c.units) continue;
    if (!best || c.clean * best.cell.units > best.cell.clean * c.units || (c.clean * best.cell.units === best.cell.clean * c.units && c.units > best.cell.units)) best = { row, cell: c };
  }
  if (!best) return none;
  const c = best.cell;
  return { default: def, suggested: best.row.model, basis: `${best.row.model} first pass clean ${c.clean} of ${c.units} on ${c.key}${c.rollup ? ' (its numbers across the kinds at that tier)' : ''}; ${def} ${defCell ? `${defCell.clean} of ${defCell.units}` : 'has no data there'}` };
}
// What next and resume show per ready issue, or nothing in a loop without model lines.
export function modelMarks(root, rows) {
  const lines = modelLines(root);
  if (!lines.declared || !rows.length) return new Map();
  const table = cmdModels(root, {});
  return new Map(rows.map((r) => [r.id, modelMarkFor(table, lines, r)]));
}

const SEVERITIES = ['Critical', 'Important', 'Minor'];

// A "changes" verdict names at least one Critical or Important finding — Minor alone never bounces
// a branch back to a worker, it goes to evidence and the branch still merges (the review discipline's
// own rule, enforced here rather than left to a reviewer's judgement).
//
// --by names the reviewer, and every verdict needs it: the line records the name and its kind (fresh, coordinator,
// self). An approve by the issue's own worker — its Worker field, or the worker of its last lease — is refused:
// a self-approve is not a review.
//
// review <id> retract --by <who> "<reason>" retracts the newest approve not yet retracted, by an appended entry: the
// approve stays in the issue, struck through, and the done gate and the metrics stop counting it. It only tightens:
// a "changes" verdict is never retracted (that would revive an earlier acceptance) and a retraction is never retracted.

// ---- issues: the entries of a Reviews section ---------------------------------------------------------

const REVIEW_ENTRY = /^- (~~)?\*\*(approve|changes|retract)\*\*(?: · by (.+?) \((fresh|coordinator|self)\))?(?: · (\d{4}-\d{2}-\d{2}))?/;
// The entries of a Reviews section in file order, each with the lines it spans.
export function reviewEntries(text) {
  const lines = String(text || '').split('\n');
  const entries = [];
  lines.forEach((l, i) => {
    const m = REVIEW_ENTRY.exec(l);
    if (m) entries.push({ start: i, retracted: Boolean(m[1]), verdict: m[2], by: m[3] || null, kind: m[4] || null, day: m[5] || null });
  });
  entries.forEach((e, k) => { e.end = k + 1 < entries.length ? entries[k + 1].start - 1 : lines.length - 1; });
  return { lines, entries };
}

// ---- commands: review ---------------------------------------------------------------------------------

function retractReview(root, rawIds, reason, flags) {
  need(!isBulk(rawIds), 'review retract names one issue');
  const by = retractedBy(flags, 'a retraction');
  needSaid(reason, 'a retraction');
  const [issue] = issuesFor(root, rawIds);
  const loop = readLoop(jarlDir(root));
  const { coordinators } = loop;
  const g = gateOf(loop, issue.id);
  const text = readText(issue.file);
  const table = reviewEntries(parseIssue(text, issue.file).sections.reviews);
  let target = null;
  for (let k = table.entries.length - 1; k >= 0; k -= 1) { const e = table.entries[k]; if (e.verdict === 'approve' && !e.retracted) { target = e; break; } }
  need(g.lastApprove || target, `${issue.id} has no approve to retract — a retraction takes away the newest approve, never a "changes" verdict`);
  const who = g.lastApprove || target;
  const kind = reviewerKind(by, g.workers, coordinators);
  // The first retraction of a loop raises the record format, before its line is written: a reader of format 1 does not
  // read a retraction and would go on counting the approve, so it must refuse the loop instead.
  raiseFormat(root);
  const lines = table.lines.slice();
  if (target) lines[target.start] = `${struck(lines[target.start])}~~`;
  const named = `${who.by ? `by ${who.by}${who.kind ? ` (${who.kind})` : ''}` : 'with no reviewer recorded'}${(who.at || who.day) ? ` of ${(who.at || who.day).slice(0, 10)}` : ''}`;
  const entry = `- **retract** · by ${by} (${kind}) · ${stamp().slice(0, 10)}\n  retracts the approve ${named}\n${bodyText(reason).split('\n').map((l) => (l ? `  ${l}` : '')).join('\n')}`;
  const current = lines.join('\n').trim();
  writeAtomic(issue.file, setSection(text, 'Reviews', current ? `${current}\n${entry}` : entry));
  appendLog(root, `${issue.id} review retract · by ${by} (${kind}) · retracts the approve ${named} · ${firstLine(reason, "the issue's Reviews section")}`);
  return { id: issue.id, verdict: 'retract', by, kind, retracted: named, severities: [], acceptance: (issue.sections.acceptance || '').trim() };
}
export function cmdReview(root, rawIds, verdict, findings, flags = {}) {
  need(verdict === 'approve' || verdict === 'changes' || verdict === 'retract', 'review requires approve|changes|retract');
  if (verdict === 'retract') return retractReview(root, rawIds, findings, flags);
  need(findings, 'review requires "<findings>" — what was read and what was found, even when nothing');
  const words = String(findings).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  need(words >= REVIEW_MIN_WORDS, `the findings of a review need at least ${REVIEW_MIN_WORDS} words — what was read and what was found, even when nothing (got ${words} word${words === 1 ? '' : 's'}: "${String(findings).trim().slice(0, 40)}")`);
  need(flags.by === undefined || fieldText(flags.by), '--by needs a value — the reviewer\'s name');
  need(flags.by !== undefined, `a verdict needs --by <reviewer> — who read the diff: a fresh reviewer's name, or jarl when the loop's director reviewed it`);
  const issues = issuesFor(root, rawIds);
  const severities = SEVERITIES.filter((s) => findings.includes(s));
  if (verdict === 'changes') {
    need(severities.length > 0, `"changes" needs at least one finding ranked ${SEVERITIES.join('/')} — name the severity, not just the problem`);
    need(severities.some((s) => s !== 'Minor'), '"changes" needs a Critical or Important finding — Minor alone goes to evidence on an approve, it never bounces a branch');
  }
  const by = flags.by !== undefined ? fieldText(flags.by) : null;
  const model = flags.model !== undefined ? modelValue(flags.model) : undefined;
  need(flags.relayed === undefined || flags.relayed === true, '--relayed takes no value');
  const relayed = flags.relayed === true;
  // The whole loop, not just the issues under review: a sibling elsewhere on the same Branch still counts for self.
  const loop = by ? readLoop(jarlDir(root)) : null;
  const kinds = issues.map((issue) => {
    if (!by) return null;
    // Self is everyone who has ever held this issue's lease — its own worker across every takeover, and the
    // worker of any other issue sharing its Branch (a package) — not only its current Worker field.
    const self = [...gateOf(loop, issue.id).workers];
    const kind = reviewerKind(by, self, loop.coordinators);
    const who = self.length === 1 ? `${self[0]} is the issue's worker` : self.length > 1 ? `${self.join(', ')} have all held ${issue.id}'s lease` : '';
    need(verdict !== 'approve' || kind !== 'self', `${issue.id}: an approve by ${by} is a self-approve${who ? ` (${who})` : ''} and does not count as review — a fresh reviewer, or the jarl, reads the diff${issues.length > 1 ? ' — nothing was written' : ''}`);
    return kind;
  });
  // The whole findings go under the issue's ## Reviews (before Evidence, which stays last); the log keeps the verdict
  // line the gate reads, the first line of the findings and a pointer.
  const day = stamp().slice(0, 10);
  for (const [n, issue] of issues.entries()) {
    const text = readText(issue.file);
    const current = (parseIssue(text, issue.file).sections.reviews || '').trim();
    const entry = `- **${verdict}** · ${by ? `by ${by} (${kinds[n]}) · ` : ''}${day}${model !== undefined ? ` · model ${model}` : ''}${relayed ? ' · relayed' : ''}\n${bodyText(findings).split('\n').map((l) => (l ? `  ${l}` : '')).join('\n')}`;
    writeAtomic(issue.file, setSection(text, 'Reviews', current ? `${current}\n${entry}` : entry));
  }
  // The model and the relay mark come after the kind: a reader that parses only the name and the kind ignores what follows.
  const marks = `${model !== undefined ? `model ${model} · ` : ''}${relayed ? 'relayed · ' : ''}`;
  appendLogLines(root, issues.map((issue, n) => `${issue.id} review ${verdict} · ${by ? `by ${by} (${kinds[n]}) · ` : ''}${marks}${loggedFinding(firstLine(findings, "the issue's Reviews section"))}`));
  // Recorded, never refused: a coordinator's approve on a code issue is a fact of the record, but it does not clear
  // the issue for done or the merge queue — the output says so at once. On the command line, in a loop that declares
  // its models, the model notes join it (see reviewModelNotes).
  const lines = flags.caller === 'cli' ? modelLines(root) : null;
  const noteOf = (issue, n) => {
    const said = [
      verdict === 'approve' && kinds[n] === 'coordinator' && carriesCode(issue) ? `${issue.id} carries code and ${by} is a coordinator — the fresh-review rule: this approve is recorded but does not clear it for done or the merge queue; a fresh reviewer's approve does` : null,
      ...(lines && lines.declared ? reviewModelNotes(issue, verdict, model, lines, loop.eventsById.get(issue.id) || []) : []),
    ].filter(Boolean);
    return said.length ? { note: said.join('; ') } : {};
  };
  // The verdict comes back with the acceptance it was given against, so a reviewer (and the merger reading
  // the output) sees what the approve claims is met — or that there was nothing to meet.
  return oneOrMany(rawIds, issues.map((issue, n) => ({ id: issue.id, verdict, ...(by ? { by, kind: kinds[n] } : {}), ...(model !== undefined ? { model } : {}), ...(relayed ? { relayed } : {}), severities, acceptance: (issue.sections.acceptance || '').trim(), ...(flags.caller === 'cli' ? { next: nextAfterVerdict(issue, verdict, kinds[n]) } : {}), ...noteOf(issue, n) })));
}

// The one step a verdict leaves, named in its reply so nobody has to know the flow: an approve is followed by the merge
// (the merger lands it and records it with one call) and then done, which a worker never sets; changes are followed by a
// round, which sends the work back to a worker raised again. A coordinator's approve on code does not clear it: a fresh
// reviewer's approve is the next step.
function nextAfterVerdict(issue, verdict, kind) {
  if (verdict === 'changes') return `the jarl records the round — jarl.mjs round ${issue.id} "<what failed>" — and a worker is raised again to fix it`;
  if (carriesCode(issue) && kind === 'coordinator') return `a fresh reviewer's approve is next — jarl.mjs review ${issue.id} approve|changes --by <fresh reviewer> "<findings>" — then the merger lands it`;
  if (carriesCode(issue)) return `the merger merges the branch and records it with one call — jarl.mjs merged ${issue.id} --sha <sha> --ran "<check>" --saw "<summary>" — then jarl.mjs set ${issue.id} done; a worker never sets done`;
  return `jarl.mjs set ${issue.id} done once its evidence rows are recorded; a worker never sets done`;
}

// ---- rounds, branches, checks ------------------------------------------------------------------

// The worktrees of the repository `dir` is in, as `git worktree list --porcelain` gives them: { path, branch (null when detached), bare, locked,
// reason (of the lock), prunable }, the main checkout first. Null where git does not answer. The one place the list is
// split into entries.
function worktreesOf(dir) {
  const text = git(dir, ['worktree', 'list', '--porcelain']);
  if (text === null) return null;
  return text.split(/\n\s*\n/).map((b) => ({
    path: /^worktree (.+)$/m.exec(b)?.[1], branch: /^branch refs\/heads\/(.+)$/m.exec(b)?.[1] || null, bare: /^bare$/m.test(b),
    locked: /^locked(?: |$)/m.test(b), reason: /^locked (.+)$/m.exec(b)?.[1], prunable: /^prunable(?: |$)/m.test(b),
  })).filter((e) => e.path);
}

// Read once per run: whether a directory is in a git repository, and every local branch of a repository with its
// tip, upstream (null when none is set or its remote branch is gone), ahead/behind against that upstream and the
// time of its last commit — one git process per repository instead of several per branch, which is what keeps the
// read-only views (status, tips, resume) fast on a loop of hundreds of issues. jarl moves a ref only in the cleanup
// that ends a recorded merge, after which the command is over, so nothing read here goes stale while it runs. The caches live for one command: dispatch empties them (resetCaches) before
// each one. Only what was found is kept — a directory that is not a repository, like a Repo path that did not
// resolve, is asked again, so a refusal always names the current state.
const IS_REPO = new Set();
function isGitRepo(dir) {
  if (IS_REPO.has(dir)) return true;
  const ok = git(dir, ['rev-parse', '--git-dir']) !== null;
  if (ok) IS_REPO.add(dir);
  return ok;
}
const REFS = new Map();
export function refsIn(repo) {
  if (REFS.has(repo)) return REFS.get(repo);
  const map = new Map();
  const out = git(repo, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(committerdate:unix)', 'refs/heads']);
  for (const line of (out || '').split('\n').filter(Boolean)) {
    const [ref, sha, up, track, ct] = line.split('\0');
    const gone = track === 'gone';
    map.set(ref.replace(/^refs\/heads\//, ''), {
      sha, upstream: up && !gone ? up : null,
      ahead: up && !gone ? Number(/ahead (\d+)/.exec(track)?.[1] || 0) : null,
      behind: up && !gone ? Number(/behind (\d+)/.exec(track)?.[1] || 0) : null,
      committedMs: Number(ct) * 1000 || null,
    });
  }
  REFS.set(repo, map);
  return map;
}

// Where git runs for an issue's code. A loop may keep its issues in one repository while its workers
// change another; that other repository is named by --repo on the command or by the issue's Repo
// field. A relative path is read from the loop's root, not the caller's directory, because workers,
// reviewers and the merger call the tool from different checkouts with the same --root. Naming
// nothing keeps git where the loop lives.
//
// A repository that resolved once resolves the same for the rest of the run: a loop of hundreds of issues names a
// handful of repositories, and each check costs two git processes. A path that failed is checked again, so its
// refusal always names the current state.
const RESOLVED = new Map();
export function repoOf(root, named) {
  if (named === undefined || named === '') return root;
  need(typeof named === 'string', '--repo takes one path — the checkout of the repository the code lives in');
  const key = `${root}\n${named}`;
  if (RESOLVED.has(key)) return RESOLVED.get(key);
  const repo = resolve(root, named);
  need(isGitRepo(repo), `not a git repository: ${repo} (a relative --repo or Repo path is read from the loop's root, ${root})`);
  // A subdirectory of a repository is not the repository: the paths git reports are relative to its root, so a
  // declared file or a removed test would be read from the wrong place and go unseen.
  const top = git(repo, ['rev-parse', '--show-toplevel']);
  need(top !== null && canonical(top) === canonical(repo), `${repo} is inside the repository at ${top}, not its root — name the root: ${portablePath(relative(canonical(root), canonical(top || repo))) || '.'}`);
  RESOLVED.set(key, repo);
  return repo;
}

export function roundsOf(root, id) {
  return (journalById(root).get(id) || []).filter((e) => e.type === 'round').length;
}

export function cmdRound(root, rawId, what) {
  need(what, 'round requires "<what failed>"');
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  const n = roundsOf(root, issue.id) + 1;
  appendLog(root, `${issue.id} round ${n} · ${what}`);
  const takeover = n >= ROUNDS_BEFORE_TAKEOVER;
  const log = (journalById(root).get(issue.id) || []).filter((e) => e.type !== 'filed').map((e) => `- ${e.at} · ${e.text}`).join('\n');
  // The fresh worker is raised one tier up, or on another model than the one that failed (the lease names it).
  const failed = fieldText(issue.fields.model);
  const raise = `For whoever raises the fresh worker: raise it one tier up from ${issue.tier}, or on a model other than ${failed || 'the one that failed'}${failed ? '' : ' (its lease did not record one)'} — the same model at the same tier has failed this ${n} times.`;
  const block = takeover ? `## Takeover\n\n${raise}\n\nA prior worker attempted issue ${issue.id} ${n} times; the issue is yours now. Its rounds so far:\n\n\`\`\`\n${log}\n\`\`\`\n` : null;
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
    const profile = loadProfile(root);
    pkg = loadIssues(root).filter((i) => i.fields.branch === flags.branch && (profile.is(i.status, 'holds-claim') || profile.is(i.status, 'closes-record')));
    need(pkg.length, `no issue records branch ${flags.branch} — name one (check <id> --branch ${flags.branch}), or record the package: set <ids> in-progress --branch ${flags.branch}`);
    if (flags.repo === undefined) {
      const repos = new Map();
      for (const i of pkg) for (const n of namedRepos(reposNamed(i))) { const r = canonical(resolve(root, n ?? '.')); repos.set(r, [...(repos.get(r) || []), i.id]); }
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

const DONE_BRANCH = { delete: '  DONE → delete', dirty: '  DONE (worktree dirty)', unknown: '  DONE (worktree state unknown)', unverified: '  DONE (merged by record, branch not in base) — verify' };
function renderBranchWorktree(b) {
  if (!b.worktree) return '(no worktree)';
  const state = b.worktreeGone ? ' (gone)'
    : b.worktreeState === 'elsewhere' ? ` (elsewhere${b.worktreeReason ? `: ${b.worktreeReason}` : ''})`
    : b.worktreeState === 'invisible' ? ' (not visible from here)'
    : b.dirty ? ` (${b.dirty} uncommitted)` : ' (clean)';
  return `${b.worktree}${state}`;
}
// branches: one line per branch, in a repository other than the loop's own prefixed with its name.
export function renderBranches(rows, root) {
  if (!rows.length) return '(no worker branches)';
  return rows.map((b) => [
    b.repo !== repoLabel(root) ? `[${b.repo}] ` : '', b.branch, b.issues.length ? ` → ${b.issues.join(', ')}` : '', '  ',
    b.missing ? 'GONE' : `+${b.ahead ?? '?'}  ${renderBranchWorktree(b)}`,
    b.unnamed ? '  UNNAMED — rename to jarl/NNN-slug before merging' : '', DONE_BRANCH[b.done] || '', b.stale.length ? `  STALE: ${b.stale.join('; ')}` : '',
  ].join('')).join('\n');
}

function staleHours(flags) {
  if (flags['stale-hours'] === undefined) return STALE_HOURS;
  const h = Number(flags['stale-hours']);
  need(Number.isFinite(h) && h > 0, `--stale-hours takes a positive number of hours (got "${flags['stale-hours']}")`);
  return h;
}

// The loop's own repository, every repository an open or in-progress issue names, and every one an issue
// records a Branch in (a done package's branch waits there to be deleted).
function loopRepos(root, issues) {
  const seen = new Map([[canonical(root), root]]);
  const profile = loadProfile(root);
  for (const issue of issues) {
    const unfinished = profile.unfinished(issue.status);
    if (!unfinished && !(issue.fields.branch && issue.status !== 'dropped')) continue;
    for (const repo of issueRepoPaths(root, issue)) {   // a Repo path that does not resolve is not the boot's to refuse
      const real = canonical(repo);
      if (!seen.has(real)) seen.set(real, repo);
    }
  }
  return [...seen.values()];
}

// The repository an issue's code lives in, canonical; empty when its Repo path does not resolve. Resolved
// once per spelling of the path in a run: a loop of hundreds of issues names a handful of repositories.
const REPO_OF = new Map();
function issueRepos(root, issue) {
  const key = `${root}\n${issue.fields.repo || ''}`;
  if (!REPO_OF.has(key)) REPO_OF.set(key, issueRepoPaths(root, issue).map(canonical));
  return REPO_OF.get(key);
}
// The one resolver of the repositories an issue names: the checkouts its Repo field gives, as repoOf resolves them, or
// the loop's own repository where it names none. `names` stands in for the Repo field where something else names the
// repository (a recorded merge). A name that does not resolve is left out: a Repo path that is gone is no refusal here.
function issueRepoPaths(root, issue, names = reposNamed(issue)) {
  const out = [];
  for (const n of namedRepos(names)) { try { out.push(repoOf(root, n)); } catch { /* not a repository here */ } }
  return out;
}
// The names to resolve: the ones given, or undefined (the loop's own repository) where there are none.
function namedRepos(names) { return names.length ? names : [undefined]; }
// What a repository is called wherever the tool shows one: the name of its directory.
function repoLabel(dir, fallback = dir) { return basename(String(dir).replace(/[\\/]+$/, '')) || basename(resolve(fallback)); }

// The issues a branch carries in one repository: those that record it as their Branch, and — for an issue
// that records no Branch — the one whose number the branch's jarl/NNN-* name carries.
function issuesOnBranch(root, issues, realRepo, name) {
  const legacy = branchIssueId(name);
  return issues.filter((i) => issueRepos(root, i).includes(realRepo) && (i.fields.branch ? i.fields.branch === name : i.id === legacy));
}

export function ago(ms) {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// What looks wrong with an in-progress issue's lease — shown, never acted on (no expiry, no takeover): its
// recorded worktree is gone, its recorded branch is gone, or the lease has lasted more than `hours` and its branch
// has no commit that recent either. An issue that records no lease fields has none of them and reads clean.
export function leaseProblems(root, issue, hours = STALE_HOURS, now = Date.now()) {
  if (!loadProfile(root).is(issue.status, 'holds-claim')) return [];
  const f = issue.fields;
  const out = [];
  let lastCommit = null;
  // Outside a git repository there is no branch to find, gone or not. An issue naming several repositories
  // keeps its branch while any of them has it.
  const repos = f.branch || f.worktree ? issueRepoPaths(root, issue).filter(isGitRepo) : [];
  // The worktree is asked of git, by the lease's branch (and the stored path of a lease that has one): only 'gone' is a problem.
  if (f.branch || f.worktree) {
    const states = (repos.length ? repos : [null]).map((r) => worktreeState(r, f.branch, f.worktree));
    const seen = states.find((s) => s.state !== 'gone' && s.state !== 'none');
    const gone = states.find((s) => s.state === 'gone');
    if (!seen && gone) out.push(`worktree gone: ${gone.path}`);
  }
  if (f.branch) {
    const having = repos.filter((r) => refsIn(r).has(f.branch));
    if (repos.length && !having.length) out.push(`branch gone: ${f.branch}`);
    for (const r of having) { const t = refsIn(r).get(f.branch).committedMs; if (t && (!lastCommit || t > lastCommit)) lastCommit = t; }
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
function doneMark(repo, base, name, on, dirty, profile = DEFAULT_PROFILE, unknown = false) {
  const closed = (i) => profile.is(i.status, 'closes-record');
  // Given up: finished, settling what waits on it, without closing the record (built-in: dropped). A status that is
  // finished but settles nothing (deferred) is work that waits, and keeps its branch.
  const givenUp = (i) => profile.is(i.status, 'terminal') && profile.is(i.status, 'settles-dependents') && !closed(i);
  const settled = on.length > 0 && on.every((i) => closed(i) || givenUp(i)) && on.some(closed);
  if (!settled) return null;
  const inBase = git(repo, ['merge-base', '--is-ancestor', name, base]) !== null;
  let byRecord = false;
  if (!inBase) {
    const recorded = on.every((i) => i.fields.branch === name);
    const done = on.filter(closed);
    if (!recorded || !done.every((i) => mergedOf(i))) return null;
    byRecord = done.every((i) => git(repo, ['merge-base', '--is-ancestor', name, mergedOf(i).sha]) !== null);
    if (!byRecord) return 'unverified';
  }
  // A worktree git lists but this machine cannot inspect has an unknown number of uncommitted changes: never 'delete'.
  return dirty ? 'dirty' : unknown ? 'unknown' : 'delete';
}

function branchesIn(root, repo, flags, issues, hours = STALE_HOURS) {
  const base = flags.base || defaultBase(repo);
  const real = canonical(repo);
  const named = (git(repo, ['branch', '--list', 'jarl/*', '--format=%(refname:short)']) || '').split('\n').filter(Boolean);
  const worktrees = (worktreesOf(repo) || []).filter((w) => w.branch);
  const mainPath = git(repo, ['rev-parse', '--show-toplevel']);
  // A branch some issue records as its Branch is listed whatever its name: a package's shared branch.
  const leased = [...new Set(issues.filter((i) => i.fields.branch && i.status !== 'dropped' && issueRepos(root, i).includes(real)).map((i) => i.fields.branch))];
  const exists = (b) => git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]) !== null;
  const recorded = leased.filter((b) => !named.includes(b) && b !== base && exists(b));
  const extra = worktrees.filter((w) => w.branch !== base && !named.includes(w.branch) && !recorded.includes(w.branch) && w.path !== mainPath).map((w) => w.branch);
  const rows = [...named, ...recorded, ...extra].map((name) => {
    const mb = git(repo, ['merge-base', base, name]);
    const ahead = mb ? Number(git(repo, ['rev-list', '--count', `${mb}..${name}`]) || 0) : null;
    const on = issuesOnBranch(root, issues, real, name);
    // The worktree is asked of git by the branch (and the stored path of a lease that has one), through the one lookup.
    const ws = worktreeState(repo, name, on.map((i) => i.fields.worktree).find(Boolean));
    const wtGone = ws.state === 'gone';
    const status = ws.state === 'here' ? git(ws.path, ['status', '--porcelain']) : null;
    const dirty = status === null ? null : status.split('\n').filter(Boolean).length;
    // Uncommitted changes that cannot be counted: a worktree git lists but this machine cannot see, or one that would not answer.
    const unknown = ws.state === 'elsewhere' || ws.state === 'invisible' || (ws.state === 'here' && dirty === null);
    const stale = on.flatMap((i) => leaseProblems(root, i, hours).map((p) => `${i.id} ${p}`));
    // Done → delete: every issue it carries is done or dropped (at least one done), and its work is in the
    // base — the branch is an ancestor of it, or every done issue records its merge.
    const done = doneMark(repo, base, name, on, dirty, loadProfile(root), unknown);
    return { repo: repoLabel(repo), branch: name, ahead, worktree: ws.path, worktreeState: ws.state, ...(ws.reason ? { worktreeReason: ws.reason } : {}), ...(wtGone ? { worktreeGone: true } : {}), dirty, unnamed: !name.startsWith('jarl/') && !leased.includes(name), issues: on.map((i) => i.id), stale, done, deletable: done === 'delete' };
  });
  // An in-progress issue whose recorded branch is not in the repository any more: a lease with nothing under it.
  const gone = leased.filter((b) => !exists(b)).map((name) => {
    const on = issuesOnBranch(root, issues, real, name);
    const stale = on.flatMap((i) => leaseProblems(root, i, hours).map((p) => `${i.id} ${p}`));
    return { repo: repoLabel(repo), branch: name, ahead: null, worktree: null, dirty: null, unnamed: false, issues: on.map((i) => i.id), stale, done: null, deletable: false, missing: true };
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
// says nothing about CI rather than guessing. A JARL_GH ending in .js, .mjs or .cjs is run by process.execPath, so a stub
// works the same on every OS: Windows runs no shebang script, and no .cmd shim without a shell.
let GH;
// Every cache a command fills, emptied before the next one (see dispatch).
export function resetCaches() {
  for (const m of [IS_REPO, REFS, RESOLVED, REPO_OF, TOP_OF]) m.clear();
  GH = undefined;
}
function ghBin() {
  if (GH !== undefined) return GH;
  const bin = process.env.JARL_GH || 'gh';
  try { runGh(bin, ['--version'], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 10_000 }); GH = bin; } catch { GH = null; }
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
    runs = JSON.parse(runGh(bin, ['run', 'list', '--commit', sha, '--json', 'conclusion,status,databaseId,workflowName', '--limit', '20'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 }));
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
export function cmdTips(root, { ci: askCi = true } = {}) {
  const loop = readLoop(jarlDir(root));
  const { issues, profile } = loop;
  const now = Date.now();
  const recent = (i) => {
    const m = mergedOf(i);
    if (!m || i.status === 'dropped') return false;
    if (m.ci === 'pending' || m.ci === 'red') return true;
    const line = lastMerge(loop.eventsById.get(i.id) || []);
    const at = line ? parseStamp(line.at) : null;
    return at !== null && now - at <= TIPS_RECENT_MS;
  };
  const named = issues.filter((i) => profile.unfinished(i.status) || recent(i));
  const repos = new Map([[topOf(root), root]]);
  for (const i of named) {
    const m = mergedOf(i);
    for (const r of issueRepoPaths(root, i, [...reposNamed(i), ...(m && m.repo ? [m.repo] : [])])) if (!repos.has(topOf(r))) repos.set(topOf(r), r);
  }
  const out = [];
  for (const [real, repo] of repos) {
    if (!isGitRepo(repo)) continue;
    const current = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const refs = refsIn(repo);
    const exists = (b) => refs.has(b);
    const main = ['main', 'master'].find(exists) || null;
    const flight = issues.filter((i) => profile.is(i.status, 'holds-claim') && i.fields.branch && issueTops(root, i).includes(real));
    // A worker branch of an issue naming several repositories lives in one or some of them: it is shown where it
    // is, and GONE only when none of them has it.
    const hasBranch = (dir, b) => isGitRepo(dir) && refsIn(dir).has(b);
    const elsewhere = (b) => flight.filter((i) => i.fields.branch === b).some((i) => issueRepos(root, i).some((r) => topOf(r) !== real && hasBranch(r, b)));
    const feature = [...new Set(flight.map((i) => i.fields.branch))].filter((b) => exists(b) || !elsewhere(b));
    const wanted = [...feature.map((b) => ({ role: 'feature', branch: b })), ...(current && current !== 'HEAD' ? [{ role: 'release', branch: current }] : []), ...(main ? [{ role: 'main', branch: main }] : [])];
    const seen = new Set();
    const rows = [];
    for (const w of wanted) {
      if (seen.has(w.branch)) continue;
      seen.add(w.branch);
      if (!exists(w.branch)) { rows.push({ ...w, sha: null, missing: true }); continue; }
      const ref = refs.get(w.branch);
      const sha = ref.sha;
      // A worker branch cut with tracking of the release branch has no upstream of its own: only a remote branch
      // of the same name counts as where it was pushed.
      let upstream = ref.upstream;
      if (upstream && w.role === 'feature' && !upstream.endsWith(`/${w.branch}`)) upstream = null;
      let ahead = null; let behind = null; let against = null;
      if (upstream) {
        ahead = ref.ahead; behind = ref.behind; against = upstream;
      } else if (w.role === 'feature' && current && current !== 'HEAD' && current !== w.branch) {
        const lr = (git(repo, ['rev-list', '--left-right', '--count', `${w.branch}...${current}`]) || '').split(/\s+/).map(Number);
        [ahead, behind] = lr; against = current;
      }
      const on = w.role === 'feature' ? flight.filter((i) => i.fields.branch === w.branch).map((i) => i.id) : [];
      // CI runs on what was pushed: only a tip its upstream already holds (nothing ahead) is asked about.
      const pushed = Boolean(upstream) && ahead === 0;
      const ci = pushed && askCi ? ciOf(repo, sha) : null;
      rows.push({ ...w, sha: sha.slice(0, 12), upstream: upstream || null, against, ahead, behind, pushed, ...(on.length ? { issues: on } : {}), ...(ci ? { ci } : {}) });
    }
    const merged = named.filter((i) => mergedOf(i) && issueTops(root, i).includes(real)).map((i) => ({ id: i.id, sha: mergedOf(i).sha, ci: mergedOf(i).ci }));
    out.push({ repo: basename(real), path: repo, rows, ...(merged.length ? { merged } : {}) });
  }
  return { gh: askCi ? ghBin() !== null : null, ci: askCi, repos: out };
}

export function renderTips(o) {
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
// by a fresh reviewer (the done gate's reading for an issue that carries code) — and the branch has commits its base does
// not, so it is not merged yet. Rows are ordered by approval (the latest live approve on the branch, then the log's
// order) and, per repository, cut into batches the way the merger's brief batches: a branch joins the current batch
// while its declared files share none with it, and starts the next one otherwise. It computes, holds no lock and
// writes nothing; it runs no check and refuses no merge — that is Horde's land.
export function cmdQueue(root, flags = {}) {
  const profile = loadProfile(root);
  // Under an external scheduler the merge order is its own (and with approve: none no fresh approve would ever queue
  // anything): { scheduler, note, repos: [] }.
  if (profile.scheduler) return { scheduler: profile.scheduler, note: schedulerNote(profile.scheduler), repos: [] };
  const loop = readLoop(jarlDir(root));
  const { issues } = loop;
  // Only work in play (offered or worked on): an issue waiting in a status with no such flag (a proposal, a block) is
  // never queued for merge.
  const unsettled = issues.filter((i) => profile.active(i.status));
  const gate = new Map(unsettled.map((i) => [i.id, gateOf(loop, i.id)]));
  // Every issue in the queue sits on a branch, so it carries code: only a fresh approve puts it there (the
  // fresh-review rule). One cleared by a coordinator alone waits, listed with its package as waiting for review.
  const approved = unsettled.filter((i) => gate.get(i.id).fresh);
  const repos = flags.repo !== undefined ? [repoOf(root, flags.repo)] : loopRepos(root, issues);
  const out = [];
  for (const repo of repos) {
    if (!isGitRepo(repo)) continue;
    const real = canonical(repo);
    const base = flags.base || defaultBase(repo);
    const exists = (b) => refsIn(repo).has(b);
    // The branch an approved issue is on: its Branch field, else — for an issue that records none — the one
    // jarl/NNN-* branch carrying its number.
    const branchOf = (i) => {
      if (i.fields.branch) return exists(i.fields.branch) ? i.fields.branch : null;
      const legacy = (git(repo, ['branch', '--list', ...branchGlobsFor(i.id), '--format=%(refname:short)']) || '').split('\n').filter(Boolean);
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
      // The live approve, not simply the last one recorded: a later coordinator approve does not spend an
      // earlier, still-live fresh approve, so the row still credits the fresh reviewer who actually cleared it.
      const approves = on.map((i) => gate.get(i.id).live);
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

export function renderQueue(o) {
  if (o.scheduler) return o.note;
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
  const issues = issuesFor(root, rawIds, true);
  // --repo is matched by the repository itself (its resolved root), never by its directory name alone.
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

// A ratify item the close's batch filed names the area ruling it asks about: `· ruling <slug>`.
const ASK_RE = idRe('^- \\*\\*a-({id})\\*\\* \\((open|answered)\\)(?: · (stop|stuck|lower|charter|ratify))?(?: · target (\\S+))?(?: · issue ({id}))?(?: · ruling ([A-Za-z0-9][A-Za-z0-9._-]{0,79}))? · (.*)$');

export function loadAsks(root) { return asksAt(jarlDir(root)); }
// The questions of the record held in `dir`.
function asksAt(dir) {
  const path = asksPath(dir);
  if (!existsSync(path)) return [];
  // A question of several lines is the item line and its next lines indented by two spaces (blank ones are two spaces
  // alone); the item line alone still reads as a question.
  const out = [];
  let last = null;
  for (const line of readText(path).split('\n')) {
    const m = ASK_RE.exec(line);
    if (m) { last = { id: m[1], state: m[2], kind: m[3] || null, target: m[4] || null, issue: m[5] || null, ...(m[6] ? { ruling: m[6] } : {}), question: m[7] }; out.push(last); continue; }
    if (last && line.startsWith('  ')) last.question += `\n${line.slice(2)}`;
    else last = null;
  }
  for (const a of out) a.question = a.question.replace(/\s+$/, '');
  return out;
}

export function cmdAsk(root, question, flags) {
  need(question, 'ask requires "<question>"');
  const kind = String(flags.kind || 'stuck');
  need(ASK_KINDS.includes(kind), `--kind must be one of: ${ASK_KINDS.join(', ')} — stop (halt everything), stuck (this issue only), lower (weaken something protected, needs a target), charter (the goal itself), ratify (a choice already made under a mandate, awaiting the user's word; blocks nothing)`);
  if (flags.issue !== undefined) need(findIssue(root, flags.issue), `no such issue: ${flags.issue}`);
  need(kind !== 'lower' || flags.target, '--target is required for kind lower — nothing to weaken without naming it');
  need(kind === 'lower' || !flags.target, `--target has no meaning for kind "${kind}" — only lower names something to weaken`);
  const asks = loadAsks(root);
  const id = padId(asks.reduce((m, a) => Math.max(m, Number(a.id)), 0) + 1);
  // The first question a-1000 or more, or one naming an issue of 1000 or more, raises the record format first.
  if (needsRaisedFormat(id) || (flags.issue !== undefined && needsRaisedFormat(padId(flags.issue)))) raiseFormat(root);
  const path = asksPath(jarlDir(root));
  const target = kind === 'lower' ? ` · target ${flags.target}` : '';
  // flags.ruling is not a flag of the command line: the close's ratification batch passes it, and so may a composer
  // filing its own batch (record.mjs ask). It names an area ruling in force that no item has asked about yet.
  if (flags.ruling !== undefined) {
    need(kind === 'ratify', `a question naming a ruling is that ruling's ratification item — kind ratify (got "${kind}")`);
    const d = loadDecisions(root).find((x) => x.slug === String(flags.ruling));
    need(d && d.area, `no area ruling ${flags.ruling} in ${DECISIONS_FILE} to put to ratification`);
    need(!d.supersededBy && !d.ratified && !d.rejected, `${flags.ruling} is ${d.supersededBy ? `superseded by ${d.supersededBy}` : d.ratified ? 'already ratified' : 'already rejected'} — nothing to ratify`);
    need(!loadAsks(root).some((x) => x.ruling === d.slug), `${flags.ruling} has been put to ratification already`);
  }
  const ruling = kind === 'ratify' && flags.ruling ? ` · ruling ${flags.ruling}` : '';
  const asked = String(question).replace(/\r\n?/g, '\n').trim().split('\n');
  appendAtomic(path, '# Questions to the user\n\n', `- **a-${id}** (open) · ${kind}${target}${flags.issue ? ` · issue ${padId(flags.issue)}` : ''}${ruling} · ${asked[0]}\n${asked.slice(1).map((l) => `  ${l}\n`).join('')}`);
  appendLog(root, `asked a-${id} (${kind}) · ${firstLine(question, ASKS_FILE)}`);
  return { id, question: asked.join('\n'), kind };
}

// The one word that answers a ratification: the first word of the answer, without case or trailing punctuation.
// "no" is not among them: it is English no and colloquial Polish yes ("no tak", "no"), so it decides nothing alone —
// the word after it decides ("no tak" ratifies, "no nie" rejects), and a bare "no" is refused with a request for
// tak or nie rather than read as a rejection the user may not have meant.
export const RATIFY_WORDS = ['yes', 'ok', 'ratify', 'ratified', 'accept', 'accepted', 'approve', 'approved', 'tak'];
export const REJECT_WORDS = ['reject', 'rejected', 'nie'];
export const AMBIGUOUS_WORDS = ['no'];
function ratifyVerdict(answer) {
  const words = String(answer).trim().split(/\s+/).map((w) => w.toLowerCase().replace(/[.,;:!?]+$/, ''));
  const verdict = (w) => (RATIFY_WORDS.includes(w) ? 'ratified' : REJECT_WORDS.includes(w) ? 'rejected' : null);
  return AMBIGUOUS_WORDS.includes(words[0]) ? verdict(words[1] || '') : verdict(words[0]);
}
function ratifyRefusal(id, ruling, answer) {
  const first = String(answer).trim().split(/\s+/)[0].toLowerCase().replace(/[.,;:!?]+$/, '');
  if (AMBIGUOUS_WORDS.includes(first)) return `a-${id} ratifies ruling ${ruling}: "${first}" is English no and colloquial Polish yes, so it decides nothing — answer tak or nie (yes or reject)`;
  return `a-${id} ratifies ruling ${ruling}: the answer starts with one word — ${RATIFY_WORDS.join(', ')} to ratify it, ${REJECT_WORDS.join(', ')} to reject it`;
}

export function cmdAnswer(root, rawId, answer, flags = {}) {
  need(answer, 'answer requires "<answer>"');
  need(flags.by === undefined || fieldText(flags.by), '--by needs a value — who answered: owner or a name');
  const by = flags.by === undefined ? null : fieldText(flags.by);
  const id = askNumber(rawId);
  const ask = loadAsks(root).find((a) => a.id === id);
  need(ask, `no such question: a-${id}`);
  need(ask.state === 'open', `a-${id} is already answered`);
  // A batch item asks about one area ruling, and its answer says one word first: yes or reject (tak or nie).
  const rulings = ask.ruling ? loadDecisions(root) : [];
  const ruling = ask.ruling ? rulings.find((d) => d.slug === ask.ruling) : null;
  const verdict = ask.ruling ? ratifyVerdict(answer) : null;
  need(!ask.ruling || verdict, ask.ruling && !verdict ? ratifyRefusal(id, ask.ruling, answer) : '');
  need(!ask.ruling || ruling, `a-${id} ratifies ruling ${ask.ruling}, which is no longer in ${DECISIONS_FILE}`);
  appendDecision(root, `ask-${id}`, `**Question:** ${ask.question}\n**Answer:** ${answer}`, { by: by || 'owner' });
  const path = asksPath(jarlDir(root));
  // The item line only: a continuation line of an earlier question is never the one marked.
  writeAtomic(path, readText(path).split('\n').map((l) => (l.startsWith(`- **a-${id}** (open)`) ? l.replace('(open)', '(answered)') : l)).join('\n'));
  appendLog(root, `answered a-${id} · ${firstLine(answer, `${DECISIONS_FILE}, ruling ask-${id}`)}`);
  // The issue the question was about carries the answer too, so reading the issue is enough: its first line and, when
  // there is more, a pointer to the whole ruling.
  const issue = ask.issue ? findIssue(root, ask.issue) : null;
  if (issue) appendRuling(root, [issue], `Ruling ask-${id}${ask.kind ? ` (${ask.kind})` : ''}: ${firstLine(answer, `${DECISIONS_FILE}, ruling ask-${id}`)}`);
  const out = { id, answer, ...(issue ? { issue: issue.id } : {}) };
  if (ruling) Object.assign(out, ratify(root, ruling, rulings, verdict, id, by));
  return out;
}

// A ratification answered: the ruling is marked in place. A ratified area ruling hands back the entry for the type's
// decision log (typeDecision: { type, text, supersedes }) and, when it names a rule of the graph (decide --rule), the
// ratification of that rule (ruleRatification: { rule, text }, with by when answer --by named who gave it) — what the command line writes through yg-edge.mjs,
// the one place in Jarl that reaches another tool, and what a composer standing on record.mjs may write with its own
// code. This module never writes either: it reads and writes the loop's files only.
function ratify(root, ruling, rulings, verdict, askId, by = null) {
  markDecision(root, ruling.slug, `**${verdict === 'ratified' ? 'Ratified' : 'Rejected'}:** a-${askId} (${today()})`);
  appendLog(root, `${verdict} ${ruling.slug} · a-${askId}${ruling.area ? ` · area ${ruling.area}` : ''}`);
  const out = { ruling: ruling.slug, verdict, typeDecision: null, typeLog: null, ruleRatification: null, ruleLog: null };
  if (verdict !== 'ratified' || !ruling.area) return out;
  if (ruling.supersededBy) {
    const skipped = { state: 'skipped', reason: `superseded by ${ruling.supersededBy}, whose own item asks about it` };
    return { ...out, typeLog: skipped, ...(ruling.rule ? { ruleLog: skipped } : {}) };
  }
  // The ruling it replaces, when its entry is in the same type's log, is replaced there too.
  const prior = ruling.supersedes ? rulings.find((d) => d.slug === ruling.supersedes) : null;
  const supersedes = prior && prior.typeLog && prior.typeLog.type === ruling.area ? prior.typeLog.datetime : null;
  const text = `${ruling.ruling}\n\n(ratified: ${ruling.slug}, a-${askId})`;
  return { ...out, typeDecision: { type: ruling.area, text, supersedes }, ...(ruling.rule ? { ruleRatification: { rule: ruling.rule, text, ...(by ? { by } : {}) } } : {}) };
}

// What became of a ratified area ruling's entry in the type's decision log, recorded: a written one marks the ruling
// **Type log:** <type> · <datetime> (what a later ruling superseding it replaces); a failed one is a log line. Either
// way the ruling stays in the decisions.
export function recordTypeLog(root, slug, decision, result) {
  if (result.state === 'written') {
    markDecision(root, slug, `**Type log:** ${decision.type} · ${result.datetime || 'unknown'}`);
    appendLog(root, `${slug} written into the decision log of type ${decision.type}${decision.supersedes ? ` · supersedes ${decision.supersedes}` : ''}`);
  } else if (result.state === 'failed') {
    appendLog(root, `${slug} NOT written into the decision log of type ${decision.type} · ${result.reason}`);
  }
}

// What became of a ratified ruling's rule ratification in the rule's own log, recorded the same way: a written one
// marks the ruling **Rule log:** <rule> · <datetime>; a failed one is a log line.
export function recordRuleLog(root, slug, ratification, result) {
  if (result.state === 'written') {
    markDecision(root, slug, `**Rule log:** ${ratification.rule} · ${result.datetime || 'unknown'}`);
    appendLog(root, `${slug} ratified rule ${ratification.rule} in its own log · by ${result.by}`);
  } else if (result.state === 'failed') {
    appendLog(root, `${slug} did NOT ratify rule ${ratification.rule} in its own log · ${result.reason}`);
  }
}

// A ruling written into issues' Evidence, after what is there, with one log line each. The status is left
// alone: a ruling may settle the question and still leave work, and done keeps its own preconditions.
function appendRuling(root, issues, line) {
  for (const issue of issues) {
    const text = readText(issue.file);
    const current = (parseIssue(text, issue.file).sections.evidence || '').trim();
    writeAtomic(issue.file, setSection(text, 'Evidence', current ? `${current}\n\n${line}` : line));
  }
  appendLogLines(root, issues.map((issue) => `${issue.id} evidence · ${line}`));
}

// decide <slug> "<ruling>" [--by who] [--supersedes <slug>] [--settles <ids>]: the ruling, who ruled (the owner
// unless --by says otherwise: jarl for a choice the loop made under a mandate), the earlier ruling it replaces —
// marked **Superseded by:** in place, so a reader of the decisions, and decisions --live, see it is not in
// force — and the issues it settles.
export function cmdDecide(root, slug, ruling, flags = {}) {
  need(slug && ruling, 'decide requires <slug> "<ruling>"');
  need(flags.by === undefined || fieldText(flags.by), '--by needs a value — who ruled: owner, jarl, or a name');
  need(flags.area === undefined || AREA_RE.test(String(flags.area)), `--area names the type of code the ruling reaches, as the repository's graph names it: one word of letters, digits and . _ - (got "${flags.area}")`);
  need(flags.reach === undefined || flags.area !== undefined, '--reach counts the files of the --area type — it needs --area');
  need(flags.reach === undefined || /^\d+$/.test(String(flags.reach)), `--reach is how many files the area holds, a whole number (got "${flags.reach}")`);
  need(flags.rule === undefined || flags.area !== undefined, '--rule names the rule of the graph the ruling admits on the --area type — it needs --area');
  need(flags.rule === undefined || RULE_RE.test(String(flags.rule)), `--rule names a rule as the repository's graph names it: its id, segments of letters, digits and . _ - joined by / (got "${flags.rule}")`);
  const by = flags.by !== undefined ? fieldText(flags.by) : 'owner';
  const settles = flags.settles !== undefined ? issuesFor(root, flags.settles) : [];
  const area = flags.area !== undefined ? String(flags.area) : null;
  const reach = flags.reach !== undefined ? Number(flags.reach) : null;
  const rule = flags.rule !== undefined ? String(flags.rule) : null;
  appendDecision(root, slug, settles.length ? `${ruling.trim()}\n\n**Settles:** ${settles.map((i) => i.id).join(', ')}` : ruling, { by, supersedes: flags.supersedes, area, reach, rule });
  appendLog(root, `decided ${slug} · by ${by}${flags.supersedes !== undefined ? ` · supersedes ${flags.supersedes}` : ''}${area ? ` · area ${area}${reach !== null ? ` (${reach} files)` : ''}${rule ? ` · rule ${rule}` : ''}` : ''}`);
  if (settles.length) appendRuling(root, settles, `Ruling ${slug}: ${firstLine(ruling, `${DECISIONS_FILE}, ruling ${slug}`)}`);
  return { slug, by, supersedes: flags.supersedes ?? null, settles: settles.map((i) => i.id), ...(area ? { area, reach, ...(rule ? { rule } : {}) } : {}) };
}

// A type name as the repository's graph takes it for a log: one path segment.
export const AREA_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
// A rule id as the graph names it: path segments of the same letters, none of them . or .., joined by /.
export const RULE_RE = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

// ---- the ratification batch: area rulings the user admits when the loop closes -----------------------------

// At most this many area rulings wait for the user's word at once; the rest wait for the next close.
export const RATIFY_BATCH = 10;
// A ruling's first sentence, as the batch quotes it.
function firstSentence(text) {
  const line = String(text).split('\n').map((l) => l.trim()).find(Boolean) || '';
  const s = /^.+?[.!?](?=\s|$)/.exec(line)?.[0] || line;
  return s.length > 200 ? `${s.slice(0, 199)}…` : s;
}

// The batch: every open ratify item that asks about an area ruling, and new ones filed for the area rulings in force
// that no item has asked about yet — the widest reach first (a ruling with no count last, then oldest first) — up to
// RATIFY_BATCH open in all. A ruling already ratified or rejected is never asked again. Nothing here blocks anything.
export function ratificationBatch(root) {
  const asks = loadAsks(root);
  const asked = new Set(asks.filter((a) => a.ruling).map((a) => a.ruling));
  const pending = asks.filter((a) => a.ruling && a.state === 'open');
  const rulings = loadDecisions(root);
  const candidates = rulings
    .filter((d) => d.area && !d.supersededBy && !d.ratified && !d.rejected && !asked.has(d.slug))
    .map((d, n) => ({ d, n }))
    .sort((a, b) => (b.d.reach ?? -1) - (a.d.reach ?? -1) || a.n - b.n)
    .map((x) => x.d);
  const room = Math.max(0, RATIFY_BATCH - pending.length);
  const filed = candidates.slice(0, room).map((d) => {
    const reach = d.reach !== null ? `${d.reach} file${d.reach === 1 ? '' : 's'}` : 'files not counted';
    // A rule's ratification admits it, as it stands now, on every type the graph has it reach — Yggdrasil reads them,
    // not Jarl — so the question says so: a yes about one area must not pass for consent to less than it gives.
    const scope = d.rule ? `, and to ratify rule ${d.rule} as it stands now on every type the graph has it reach (not only ${d.area})` : '';
    return cmdAsk(root, `area ${d.area}${d.rule ? ` · rule ${d.rule}` : ''} · ${reach} · ${d.slug}: "${firstSentence(d.ruling)}" — yes (tak) to admit it into the type's decisions${scope}, reject (nie) to leave it a ruling of this loop`, { kind: 'ratify', ruling: d.slug }).id;
  });
  const bySlug = new Map(rulings.map((d) => [d.slug, d]));
  const items = loadAsks(root).filter((a) => a.ruling && a.state === 'open').map((a) => {
    const d = bySlug.get(a.ruling);
    return { ask: `a-${a.id}`, ruling: a.ruling, area: d?.area ?? null, reach: d?.reach ?? null, rule: d?.rule ?? null, question: a.question };
  });
  return { items, filed: filed.map((id) => `a-${id}`), waiting: candidates.length - filed.length };
}

// decisions [--live]: the rulings, oldest first, each with who ruled and what superseded it; --live leaves out
// the superseded ones — what a session reads at boot as the rulings in force.
export function cmdDecisions(root, flags = {}) {
  const all = loadDecisions(root);
  return flags.live ? all.filter((d) => !d.supersededBy) : all;
}
// decide: what was ruled, and what the ruling did to the others.
export function renderDecide(out) {
  const area = out.area ? ` · area ${out.area}${out.reach !== null ? ` (${out.reach} file${out.reach === 1 ? '' : 's'})` : ''}${out.rule ? ` · rule ${out.rule}` : ''} · put to ratification at close` : '';
  return `decided ${out.slug} · by ${out.by}${out.supersedes ? ` · supersedes ${out.supersedes}` : ''}${out.settles.length ? ` · written into ${out.settles.join(', ')}` : ''}${area}`;
}
// decisions: one line per ruling, its first line cut at 160 characters.
export function renderDecisions(rows) {
  if (!rows.length) return '(no rulings)';
  return rows.map((d) => {
    const area = d.area ? ` · area ${d.area}${d.rule ? ` · rule ${d.rule}` : ''}${d.ratified ? ' ratified' : d.rejected ? ' rejected' : ''}` : '';
    return `${d.date} · ${d.slug}${d.by ? ` · by ${d.by}` : ''}${area}${d.supersededBy ? ` · SUPERSEDED by ${d.supersededBy}` : ''}${d.supersedes ? ` · supersedes ${d.supersedes}` : ''} — ${(d.ruling.split('\n').find((l) => l.trim()) || '').slice(0, 160)}`;
  }).join('\n');
}

// ---- resume: the state a session picks the loop up from, assembled live -------------------------------

// The loop has no hand-written handoff: everything a new session needs is in the loop's own files — the goal, the
// rulings, the issues with their leases and After, the asks, the log — and in the repositories they name. resume
// reads it all live, so nothing can be stale and nothing has to be written before a session ends (a session that
// gets cut leaves nothing half-said). Intent lives in the order of the priorities and After, and the reasons in the
// rulings and the issues' bodies. A handoff.md left in a loop is read as history only.
function handoffPath(root) { return join(jarlDir(root), 'handoff.md'); }

// How old a handoff file left in the loop is, against the clock and against the loop's last log line: stale when the loop
// moved on for more than HANDOFF_STALE_MS after it was written. Null when there is no handoff file.
export function handoffAge(root, lastActivity, now = Date.now()) {
  if (!existsSync(handoffPath(root))) return null;
  const text = readText(handoffPath(root));
  const at = new RegExp(`^\\*\\*At:\\*\\* (${STAMP_SRC})`, 'm').exec(text)?.[1] || null;
  const atMs = parseStamp(at);
  if (atMs === null) return { at: null, ageMs: null, staleByMs: null, stale: false };
  const last = parseStamp(lastActivity);
  const staleByMs = last !== null && last - atMs > HANDOFF_STALE_MS ? last - atMs : 0;
  return { at, ageMs: now - atMs, staleByMs, stale: staleByMs > 0 };
}

export const RESUME_LOG_LINES = 15;
export const RESUME_READY = 10;
const RESUME_TITLE = 160;
const short = (t, n = RESUME_TITLE) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
function countFlag(flags, name, dflt) {
  if (flags[name] === undefined) return dflt;
  const n = Number(flags[name]);
  need(Number.isInteger(n) && n >= 0, `--${name} takes a whole number, 0 or more (got "${flags[name]}")`);
  return n;
}

// resume [--log n] [--ready n] [--ci] — read-only, no lock: the goal and where the loop stands (status), the
// rulings in force, in flight with leases, waiting on After, the questions and the ratify items, the next ready
// issues and the merge queue, the merges whose CI is pending or red, the tips of every repository the loop's
// issues name, the loop files git has not committed, and the last n log lines. Nothing goes to the network
// unless --ci asks gh for the CI of each pushed tip.
export function cmdResume(root, flags = {}) {
  need(existsSync(jarlDir(root)), `no loop here: ${jarlDir(root)} does not exist — open one with jarl.mjs init "<goal>", or pass --root <the directory holding .jarl/>`);
  const logN = countFlag(flags, 'log', RESUME_LOG_LINES);
  const readyN = countFlag(flags, 'ready', RESUME_READY);
  const loop = readLoop(jarlDir(root));
  const status = statusOf(root, loop, {});
  const { profile, issues, byId } = loop;
  const stale = new Map(status.stale.map((x) => [x.id, x.problems]));
  const marks = new Map(status.inFlightRows.map((x) => [x.id, x.mark]));
  const rulings = loop.decisions.filter((d) => !d.supersededBy).map((d) => ({ date: d.date, slug: d.slug, by: d.by, line: (d.ruling.split('\n').find((l) => l.trim()) || '').trim() }));
  // In flight and waiting split the unfinished issues the way status counts them: an issue whose After is not
  // settled is waiting, in progress or not, so each section's count is the number on the counts line.
  const unsettled = (i) => waitingOn(i, byId, profile).length > 0;
  const holds = (i) => profile.is(i.status, 'holds-claim');
  // Under a profile that declares fields, each row carries the ones the issue holds (fields: { Name: value }).
  const declared = (i) => (profile.fields.length ? { fields: Object.fromEntries(profile.fields.map((f) => [f.name, fieldText(i.fields[f.key])]).filter(([, v]) => v)) } : {});
  const inFlight = issues.filter((i) => holds(i) && !unsettled(i)).map((i) => ({
    id: i.id, title: i.title, branch: i.fields.branch || null, worker: i.fields.worker || null, model: i.fields.model || null, since: i.fields.since || null,
    stale: stale.get(i.id) || [], mark: marks.get(i.id), ...declared(i),
  }));
  const waiting = issues.filter((i) => profile.active(i.status) && unsettled(i)).map((i) => ({
    id: i.id, title: i.title, status: i.status, after: waitingOn(i, byId, profile),
    ...(holds(i) ? { branch: i.fields.branch || null, worker: i.fields.worker || null, model: i.fields.model || null, since: i.fields.since || null, stale: stale.get(i.id) || [] } : {}),
  }));
  const asks = loop.asks.filter((a) => a.state === 'open');
  const scheduled = profile.scheduler !== null;
  const next = scheduled ? [] : nextRows(root, {});
  const ready = next.filter((r) => r.ready);
  // Open, not waiting on After, and still not offered: a file it declares is taken by work in flight (or by a ready
  // issue ahead of it), or an open question names it. Ready and held together are the open count on the status line.
  const held = next.filter((r) => !r.ready && !r.after.length).map((r) => ({ id: r.id, title: r.title, priority: r.priority, files: r.waitsOn, heldBy: r.heldBy || [], ...(r.questions ? { questions: r.questions } : {}), ...(r.resources ? { resources: r.resources } : {}) }));
  const merged = issues.filter((i) => status.ciPending.includes(i.id) || status.ciRed.includes(i.id)).map((i) => ({ id: i.id, title: i.title, ...mergedOf(i) }));
  const logLines = loop.events;
  const legacy = handoffAge(root, status.lastActivity);
  return {
    goal: status.goal, opened: status.opened, lastActivity: status.lastActivity, archived: status.archived, status,
    rulings, inFlight, waiting,
    questions: asks.filter((a) => a.kind !== 'ratify'), ratify: asks.filter((a) => a.kind === 'ratify'),
    held, next: ready.slice(0, readyN).map((r) => ({ id: r.id, title: r.title, priority: r.priority, ...(r.noAcceptance ? { noAcceptance: true } : {}), ...(r.model ? { model: r.model } : {}), ...declared(byId.get(r.id)) })), readyTotal: scheduled ? null : ready.length,
    ...(scheduled ? { scheduler: profile.scheduler } : {}),
    queue: cmdQueue(root), merged, tips: cmdTips(root, { ci: flags.ci === true }),
    uncommitted: uncommittedLoopFiles(root),
    log: logN ? logLines.slice(-logN).map((e) => `${e.at} · ${e.text}`) : null,
    legacyHandoff: legacy ? { path: handoffPath(root), at: legacy.at, ageMs: legacy.ageMs } : null,
  };
}

export function renderResume(o, profile = DEFAULT_PROFILE) {
  const shownFields = (x) => (x.fields && Object.keys(x.fields).length ? ` · ${Object.entries(x.fields).map(([n, v]) => `${n}=${v}`).join(' ')}` : '');
  const sec = (title, lines, none) => (lines.length ? [`## ${title}`, ...lines, ''] : none === undefined ? [] : [`## ${title}`, none, '']);
  const lease = (x) => [x.branch && `branch ${x.branch}`, x.worker && `worker ${x.worker}`, x.worker && x.model !== undefined && (x.model ? `model ${x.model}` : 'model not recorded'), x.since && `since ${x.since}`].filter(Boolean).join(' · ');
  const st = o.status;
  const head = [
    `# Resume${o.goal ? ` · ${o.goal}` : ''}`,
    `opened ${o.opened || '?'} · last activity ${o.lastActivity || '?'}${o.archived ? ` · ${o.archived} archived loop(s)` : ''}${profile.declared ? ` · profile ${profile.name}` : ''}`,
    countsLine(st, profile),
    '',
  ];
  // The tips and the merge queue as their own views print them; the merges still waiting on CI have a section of their own here.
  const tips = o.tips.repos.length ? renderTips({ repos: o.tips.repos.map((r) => ({ ...r, merged: [] })) }).split('\n') : [];
  const waiting = o.queue.repos.filter((r) => r.rows.length);
  const queue = waiting.length ? renderQueue({ repos: waiting }).split('\n') : [];
  const files = o.uncommitted || [];
  return [
    ...head,
    ...sec(`Rulings in force (${o.rulings.length})`, o.rulings.map((d) => `- ${d.date} · ${d.slug}${d.by ? ` · by ${d.by}` : ''} — ${short(d.line)}`), '- (none)'),
    ...sec(`Closed, gate does not hold (${(st.closedGate || []).length})`, (st.closedGate || []).map(closedGateLine)),
    ...sec(`In flight (${o.inFlight.length})`, o.inFlight.map((x) => `- ${x.id} ${short(x.title)}${shownFields(x)}${lease(x) ? ` · ${lease(x)}` : ''}${x.stale.length ? ` · STALE: ${x.stale.join('; ')}` : ''}${x.mark ? `\n  → ${IN_FLIGHT_MARKS[x.mark]}` : ''}`), '- (nothing)'),
    ...sec(`Waiting — After not settled (${o.waiting.length})`, o.waiting.map((x) => `- ${x.id} ${short(x.title)} (after ${x.after.join(', ')})${x.stale !== undefined ? ` · ${x.status === 'in-progress' ? 'in progress' : x.status}${lease(x) ? ` · ${lease(x)}` : ''}${x.stale.length ? ` · STALE: ${x.stale.join('; ')}` : ''}` : ''}`)),
    ...sec(`Questions to the user (${o.questions.length})`, o.questions.map((a) => `- a-${a.id} (${a.kind || 'stuck'})${a.issue ? ` issue ${a.issue}` : ''} · ${a.question}`), '- (nothing)'),
    ...sec(`To ratify (${o.ratify.length})`, o.ratify.map((a) => `- a-${a.id}${a.issue ? ` (issue ${a.issue})` : ''} · ${a.question}`)),
    ...sec(`Held — files in flight (${o.held.length})`, o.held.map((x) => `- ${x.id}  P${x.priority}  ${short(x.title)} (${x.questions ? `open question ${x.questions.map((q) => `a-${q}`).join(', ')}` : `${[...x.files, ...(x.resources || []).map((n) => `resource ${n}`)].join(', ')} held by ${x.heldBy.join(', ')}`})`)),
    ...(o.scheduler ? sec('Next ready and merge queue', [`- ${schedulerNote(o.scheduler)}`]) : [
      ...sec(`Next ready (${o.next.length} of ${o.readyTotal})`, o.next.map((r) => `- ${r.id}  P${r.priority}  ${short(r.title)}${shownFields(r)}${r.noAcceptance ? '  (no acceptance yet)' : ''}${modelText(r.model)}`), '- (nothing ready)'),
      ...sec('Merge queue', queue, '- (nothing approved waits to be merged)'),
    ]),
    ...sec(`Merged, CI pending or red (${o.merged.length})`, o.merged.map((m) => `- ${m.id} ${m.sha}${m.repo ? ` in ${m.repo}` : ''} · CI ${m.ci}`)),
    ...sec(`Tips${o.tips.ci ? '' : ' (CI not asked — --ci asks gh)'}`, tips),
    ...(files.length ? sec(`Loop files not committed (${files.length}) — commit .jarl/`, [...files.slice(0, 20).map((f) => `- ${f}`), ...(files.length > 20 ? [`- … ${files.length - 20} more`] : [])]) : []),
    ...(o.log ? sec(`Last ${o.log.length} log line(s)`, o.log.map((l) => `- ${l}`), '- (empty log)') : []),
    ...(o.legacyHandoff ? [`(a handoff file from before resume is kept at .jarl/handoff.md${o.legacyHandoff.at ? `, written ${o.legacyHandoff.at}` : ''} — history, not the state; handoff read prints it)`] : []),
  ].join('\n').replace(/\n+$/, '');
}

// handoff read — resume, then the .jarl/handoff.md left in the loop, if there is one, as history: its headings one level
// down under a heading that says how old it is, so its snapshot is never read as the state.
export function cmdHandoffRead(root, flags = {}) {
  const out = cmdResume(root, flags);
  if (!existsSync(handoffPath(root))) return { ...out, history: null, text: renderResume(out, loadProfile(root)) };
  const written = readText(handoffPath(root));
  const body = written.split('\n').filter((l) => !/^#\s+Handoff\s*$/.test(l)).map((l) => (/^#{1,5}\s/.test(l) ? `#${l}` : l)).join('\n').trim();
  const h = out.legacyHandoff;
  const when = h && h.at ? `written ${h.at}, ${ago(h.ageMs)} ago` : 'written at an unknown time';
  const text = `${renderResume(out, loadProfile(root))}\n\n## Earlier handoff — history, ${when}; not the current state\n${body}`;
  return { ...out, history: written, text };
}

// handoff write — the state is assembled live by resume, so there is nothing to write. The command is accepted (with
// its flags) so a script that calls it does not fail; it writes nothing — no file, no log line — and says so; exit 0.
export const HANDOFF_RETIRED = 'handoff write is retired: nothing written. The state a session resumes from is assembled live — run jarl.mjs resume. Put intent where it lives: order in priorities and After (prio, after), reasons in rulings (decide) and issue bodies (body).';
export function cmdHandoffWrite() {
  return { retired: true, wrote: null, note: HANDOFF_RETIRED };
}

// The reason an issue was dropped or deferred: the last "Dropped: ..." / "Deferred: ..." line of its Evidence,
// whatever notes were written before it. Evidence with no such line is read whole.
function statusReason(evidence, word) {
  const text = (evidence || '').trim();
  const last = [...text.matchAll(new RegExp(`^${word}:\\s*(.*)$`, 'gm'))].pop();
  return last ? last[1].trim() : text;
}

// The repository an issue's work counts under in the report: the directory name of each repository it names,
// or the loop's own.
function repoNames(root, issue) {
  const named = reposNamed(issue);
  return named.length ? [...new Set(named.map((n) => repoLabel(topOf(canonical(resolve(root, n))))))] : [repoLabel(topOf(root))];
}

// report [--found]: done (per repository when the done work spans more than one — an issue naming several is
// listed under each, for each repository's changelog), dropped, deferred, still open, and who reviewed the done
// work; --found adds the issues someone other than the jarl found.
export function cmdReport(root, flags = {}) {
  const loop = readLoop(jarlDir(root));
  const { profile, issues } = loop;
  const done = issues.filter((i) => profile.is(i.status, 'closes-record'));
  const dropped = issues.filter((i) => i.status === 'dropped');
  const deferred = issues.filter((i) => i.status === 'deferred');
  const left = issues.filter((i) => profile.unfinished(i.status));
  // Every other finished status gets its own section after Done, in the profile's order (built-in: Dropped, then
  // Deferred), with the reason a needs-reason status carries.
  const closedOther = profile.statuses.filter((st) => profile.is(st, 'terminal') && !profile.is(st, 'closes-record'));
  const found = issues.filter((i) => i.fields['found by'] && !/^jarl\b/i.test(i.fields['found by']));
  const goal = loop.goalLines.goal ?? '';
  const byRepo = {};
  for (const i of done) for (const r of repoNames(root, i)) (byRepo[r] = byRepo[r] || []).push(i);
  const row = (i) => `- ${i.id} ${i.title} (${i.kind})${mergedOf(i) ? ` · merged ${mergedOf(i).sha}${mergedOf(i).repo ? ` in ${mergedOf(i).repo}` : ''}` : ''}`;
  const repos = Object.keys(byRepo).sort();
  const doneLines = repos.length > 1 ? repos.flatMap((r) => ['', `### ${r} (${byRepo[r].length})`, ...byRepo[r].map(row)]) : done.map(row);
  const split = reviewSplit(loop);
  // One row per issue, for a host that renders its own dashboard from --json: the same fields a reader of the
  // issue would look up, with the live approve (who, which kind, when) — the one that actually cleared it, not
  // simply the last one recorded.
  const rows = issues.map((i) => {
    const m = mergedOf(i);
    const a = gateOf(loop, i.id).live;
    return { id: i.id, title: i.title, status: i.status, kind: i.kind, priority: i.priority, tier: i.tier, tags: i.tags, repos: repoNames(root, i), branch: i.fields.branch || null, after: i.after, sources: i.sources, merged: m ? m.sha : null, ci: m ? m.ci : null, review: a ? { by: a.by, kind: a.kind, at: a.at } : null };
  });
  const metrics = metricsOf(loop, Date.now());
  const closedGate = closedGateFlags(loop);
  const lines = [`# Report`, '', goal, '', ...(metrics.check.landsOn === 'testimony' ? [TESTIMONY_NOTE, ''] : []), `## Done (${done.length})`, ...(done.length ? [gateLine(profile, split, 'Reviewed by')] : []), ...doneLines,
    ...closedOther.flatMap((st) => {
      const on = issues.filter((i) => i.status === st);
      return ['', `## ${reasonWord(st)} (${on.length})`, ...on.map((i) => `- ${i.id} ${i.title}${profile.is(st, 'needs-reason') ? ` — ${statusReason(i.sections.evidence, reasonWord(st))}` : ''}`)];
    }),
    ...(closedGate.length ? ['', `## Closed, gate does not hold (${closedGate.length})`, ...closedGate.map(closedGateLine)] : []),
    '', `## Still open (${left.length})`, ...left.map((i) => `- ${i.id} ${i.title} (${i.status})`),
    ...(flags.found ? ['', `## Found along the way (${found.length})`, ...found.map((i) => `- ${i.id} ${i.title} — ${i.fields['found by']}`)] : []),
    '', renderMetrics(metrics)];
  return { done: done.length, dropped: dropped.length, deferred: deferred.length, left: left.length, found: found.length, reviews: split,
    ...(profile.declared ? { statuses: Object.fromEntries(profile.statuses.map((st) => [st, issues.filter((i) => i.status === st).length])) } : {}),
    byRepo: Object.fromEntries(repos.map((r) => [r, byRepo[r].map((i) => i.id)])), issues: rows, text: lines.join('\n') + '\n', check: metrics.check, metrics, closedGate };
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
  // On Windows a path on another drive has no relative spelling: relative() gives it back absolute.
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : basename(dir);
}

function readFindings(file, flags = {}) {
  need(file, 'a findings file is required: jarl.mjs import <findings.json>');
  need(existsSync(file), `no such file: ${file}`);
  let json;
  try { json = JSON.parse(readText(file)); } catch (e) { throw new Error(`${file} is not JSON: ${e.message}`); }
  const dir = flags.source !== undefined ? String(flags.source).replace(/\/+$/, '') : reportDirOf(file);
  need(dir && !/[\s,#]/.test(dir), `--source is the report directory alone, with no space, comma or # in it (got "${dir}")`);
  return { dir, findings: findingsOf(json) };
}

// An issue that records no Source often names its finding. That issue is found, never guessed at, and
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
  const { dir, findings: read } = readFindings(file, flags);
  const profile = loadProfile(root);
  if (flags.kind !== undefined) need(profile.kinds.includes(flags.kind), `--kind must be one of: ${profile.kinds.join(', ')}`);
  if (flags.prio !== undefined) need(PRIORITIES.includes(String(flags.prio)), '--prio must be 1, 2 or 3');
  if (flags.tier !== undefined) need(profile.tiers.includes(String(flags.tier)), `--tier must be one of: ${profile.tiers.join(', ')}`);
  // A finding's kind is mapped onto the built-in kinds; under a profile with kinds of its own, one it does not
  // name is filed under the profile's default kind.
  const findings = profile.declared ? read.map((f) => (profile.kinds.includes(f.kind) ? f : { ...f, kind: profile.kindDefault })) : read;
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
  // One issue may name several findings (a package of minor ones): its Source gets all of them, once.
  const adopt = new Map();
  for (const a of out.adopted) adopt.set(a.issue, [...(adopt.get(a.issue) || []), a.key]);
  for (const [id, keys] of adopt) cmdSource(root, id, [...(findIssue(root, id).sources), ...keys].join(','));
  for (const { f, key } of toFile) {
    const r = cmdNew(root, f.title, {
      kind: flags.kind || f.kind, prio: flags.prio || f.priority, tier: flags.tier, tags: flags.tags, repo: flags.repo,
      field: flags.field, 'found-by': flags['found-by'] || `research ${dir}`, where: f.where, what: f.what, why: f.why, acceptance: f.acceptance || undefined, source: key,
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


// The counts line of status and resume: the issues ready (in the dispatchable status — built-in: open) and in flight
// (holds-claim), less those waiting on After, then every other status by its own name, then the questions.
// One status's count from a status object, with or without a profile (see cmdStatus).
function countOf(o, st) { return (o.statuses || o)[st] || 0; }
function countsLine(o, profile) {
  const ready = profile.with('dispatchable');
  const rest = profile.statuses.filter((st) => !profile.active(st)).map((st) => ` · ${st} ${countOf(o, st)}`).join('');
  // Under an external scheduler Jarl does not reckon readiness: each dispatchable status by its own count instead.
  const head = o.scheduler ? ready.map((st) => `${st} ${countOf(o, st)}`).join(' · ') : `${ready.length === 1 ? ready[0] : 'ready'} ${o.ready}`;
  return `${head} · in flight ${o.inFlight}${o.waiting ? ` · waiting ${o.waiting}` : ''}${rest} · questions ${o.questions}${o.ratify ? ` · to ratify ${o.ratify}` : ''}${o.ciPending.length ? ` · merged, CI pending ${o.ciPending.length}` : ''}${o.ciRed.length ? ` · CI red ${o.ciRed.length}` : ''}`;
}
const statusLabel = (st) => (st === 'in-progress' ? 'in flight' : st);

export function renderStatus(o, profile = DEFAULT_PROFILE) {
  const head = o.goal ? `goal: ${o.goal}\nopened ${o.opened || '?'} · last activity ${o.lastActivity || '?'}${o.archived ? ` · ${o.archived} archived loop(s)` : ''}${profile.declared ? ` · profile ${profile.name}` : ''}\n` : '';
  const line = countsLine(o, profile);
  const width = o.by ? Math.max(...Object.keys(o.by.groups).map((k) => k.length), 1) : 0;
  const by = o.by ? [`by ${o.by.key}:`, ...Object.entries(o.by.groups).map(([k, g]) => `  ${k.padEnd(width)}  ${profile.statuses.map((st) => `${statusLabel(st)} ${g[st]}`).join(' · ')}`)] : [];
  const more = [
    ...(o.tag !== undefined ? [`scoped to the issues tagged ${o.tag} — the counts above and the lists below are theirs only`] : []),
    ...(o.check ? checkLines(o.check) : []),
    ...(o.scheduler ? [schedulerNote(o.scheduler)] : []),
    ...by,
    ...(o.by && o.by.key === 'repo' && o.check ? ['merges by repository, with the check that decided each:', ...mergeCheckLines(o.check)] : []),
    ...o.stale.map((x) => `stale ${x.id} · ${x.problems.join('; ')}`),
    ...(o.ciPending.length ? [`merged, CI pending: ${o.ciPending.join(', ')}`] : []),
    ...(o.ciRed.length ? [`merged, CI red: ${o.ciRed.join(', ')}`] : []),
    ...(profile.with('closes-record').some((st) => countOf(o, st)) ? [gateLine(profile, o.reviews, 'done reviewed by')] : []),
    ...(o.uncommitted ? [`${o.uncommitted} loop file(s) not committed — commit .jarl/ in the loop's repository`] : []),
    ...o.toRatify.map((a) => `ratify a-${a.id}${a.issue ? ` (issue ${a.issue})` : ''} · ${a.question}`),
    ...(o.waiting ? [`waiting (After not settled): ${o.waitingIds.join(', ')}`] : []),
    ...(o.noAcceptance.length ? [`in flight with no acceptance line: ${o.noAcceptance.join(', ')}`] : []),
    ...(o.closedGate || []).map(closedGateLine),
    ...(o.inFlightRows || []).map((x) => `in flight ${x.id} · ${x.next}`),
  ];
  return `${head}${line}${more.length ? `\n${more.join('\n')}` : ''}`;
}

export function renderImport(o) {
  const head = `${o.source}: ${o.findings} finding(s)${o.considered !== o.findings ? `, ${o.considered} chosen` : ''} · ${o.dryRun ? 'would file' : 'filed'} ${o.filed.length} · already filed ${o.already.length}${o.adopted.length ? ` · adopted ${o.adopted.length}` : ''}${o.mentioned.length ? ` · named by an issue without Source ${o.mentioned.length} (--adopt links them)` : ''}${o.ambiguous.length ? ` · ambiguous ${o.ambiguous.length}` : ''}`;
  const rows = [
    ...o.filed.map((f) => `${o.dryRun ? 'would file' : `filed ${f.id}`} · ${f.finding} · ${f.kind} P${f.priority} · ${f.title}`),
    ...o.adopted.map((a) => `adopted ${a.issue} · ${a.finding}`),
    ...o.mentioned.map((m) => `named by ${m.issue} · ${m.finding}`),
    ...o.ambiguous.map((m) => `ambiguous · ${m.finding} · named by ${m.issues.join(', ')}`),
  ];
  return [head, ...rows].join('\n');
}

export function renderSources(reports) {
  if (!reports.length) return '(no issue carries a Source, and no findings file was given)';
  return reports.map((r) => {
    const st = Object.entries(r.issues).map(([k, v]) => `${k} ${v}`).join(', ');
    const head = `${r.source} · ${r.findings === null ? '' : `${r.findings} finding(s) · `}${r.filed} filed${r.mentioned ? ` · ${r.mentioned} named by an issue without Source` : ''}${r.findings === null ? '' : ` · ${r.unfiled} unfiled`}${st ? ` · issues: ${st}` : ''}`;
    const rows = r.rows.map((x) => `  ${x.finding}  ${x.issues.length ? x.issues.map((i) => `${i.id} ${i.status}`).join(', ') : x.mentionedBy ? `named by ${x.mentionedBy.join(', ')} (no Source)` : 'unfiled'}`);
    return [head, ...rows].join('\n');
  }).join('\n\n');
}

// The profile's declared fields an issue holds a value for, as Name=value — shown by list and resume.
function declaredShown(i, profile) {
  return profile.fields.map((f) => [f.name, fieldText(i.fields[f.key])]).filter(([, v]) => v).map(([n, v]) => `${n}=${v}`).join(' ');
}
export function renderList(rows, profile = DEFAULT_PROFILE) {
  if (rows.length === 0) return '(none)';
  return rows.map((i) => { const d = declaredShown(i, profile); return `${i.id}  P${i.priority}  ${i.status.padEnd(11)} ${i.kind.padEnd(8)} ${i.title}${i.tags.length ? `  [${i.tags.join(', ')}]` : ''}${d ? `  ${d}` : ''}`; }).join('\n');
}


// ---- git merges the loop's own files ----------------------------------------------------------------
//
// A committed loop travels with the branches, so git merges its files whenever two of them meet. The journal is one
// dated line per event, so a union of both sides is its merge. The decisions are never a union: a union joins lines,
// and a ruling is a block whose closing fields (Superseded by, Ratified, …) are added in place later — a union can
// pin a `**Superseded by:**` line to the wrong ruling and let two rulings each supersede one ruling. They get a
// driver of their own, mergeDecisionsTexts, run by git as `jarl.mjs merge-driver decisions %O %A %B`.

const SINGLE_VALUED = new Set(['By', 'Supersedes', 'Superseded by', 'Area', 'Reach', 'Ratified', 'Rejected', 'Type log']);

// The decisions as blocks: the text before the first ruling, then one block per `## <date> · <slug>` heading — the
// same reading loadDecisions makes — each with its ruling text and its closing field lines kept apart.
function decisionBlocks(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const pre = [];
  const blocks = [];
  for (const line of lines) {
    const h = DECISION_HEAD.exec(line);
    if (h) { blocks.push({ slug: h[2], head: line, body: [] }); continue; }
    (blocks.length ? blocks[blocks.length - 1].body : pre).push(line);
  }
  const trimEnd = (a) => { const out = [...a]; while (out.length && out[out.length - 1].trim() === '') out.pop(); return out; };
  return {
    pre: trimEnd(pre).join('\n'),
    blocks: blocks.map((b) => {
      const body = trimEnd(b.body);
      let cut = body.length;
      while (cut > 0 && (body[cut - 1].trim() === '' || DECISION_META.test(body[cut - 1]))) cut -= 1;
      const meta = body.slice(cut).filter((l) => l.trim() !== '');
      return { slug: b.slug, head: b.head, ruling: trimEnd(body.slice(0, cut)).join('\n'), meta, text: [b.head, ...body].join('\n') };
    }),
  };
}

// One ruling both sides changed since the base: mergeable only when both kept the heading and the ruling text and
// only added closing fields — their union, base's first, then ours', then theirs'. A field that holds one value
// (Superseded by, Ratified, …) given two different values is a conflict, and two successors is the double
// supersession this driver exists to refuse.
function mergeRuling(b, o, t) {
  if (o.head !== t.head || o.ruling !== t.ruling || (b && (b.head !== o.head || b.ruling !== o.ruling))) return { conflict: `${o.slug}: both sides changed the ruling's text` };
  const meta = [...(b ? b.meta : [])];
  for (const line of [...o.meta, ...t.meta]) if (!meta.includes(line)) meta.push(line);
  const byField = new Map();
  for (const line of meta) {
    const m = DECISION_META.exec(line);
    if (!m || !SINGLE_VALUED.has(m[1])) continue;
    const value = m[1] === 'Superseded by' ? m[2].trim().split(/\s/)[0] : m[2].trim();
    const seen = byField.get(m[1]);
    if (seen !== undefined && seen !== value) {
      return { conflict: m[1] === 'Superseded by' ? `${o.slug} is superseded on both sides — by ${seen} and by ${value}` : `${o.slug}: both sides wrote **${m[1]}:** with different values` };
    }
    byField.set(m[1], value);
  }
  return { text: [o.head, ...(o.ruling ? [o.ruling] : []), ...(meta.length ? ['', ...meta] : [])].join('\n') };
}

// What git's decisions driver writes: { ok: true, text } for a clean merge, or { ok: false, text, conflicts } with
// every conflicting ruling between conflict markers (ours, then theirs) and every other ruling merged, so the person
// resolving sees each conflict where it is. Refused: a ruling both sides superseded (two successors in force), a slug
// both sides added with different rulings, a ruling both sides rewrote, and one side changed while the other removed
// it. Blocks keep ours' order, then theirs' new ones; a ruling one side changed and the other did not takes the change.
export function mergeDecisionsTexts(base, ours, theirs) {
  const B = decisionBlocks(base);
  const O = decisionBlocks(ours);
  const T = decisionBlocks(theirs);
  const index = (d) => new Map(d.blocks.map((b) => [b.slug, b]));
  const [bi, oi, ti] = [index(B), index(O), index(T)];
  const conflicts = [];
  const out = [];
  const marked = (o, t, why) => { conflicts.push(why); out.push(`<<<<<<< ours\n${o ? o.text : ''}\n=======\n${t ? t.text : ''}\n>>>>>>> theirs`); };
  const one = (b, o, t) => {
    const same = (x, y) => (x ? x.text : null) === (y ? y.text : null);
    if (same(o, t)) { if (o) out.push(o.text); return; }
    if (same(o, b)) { if (t) out.push(t.text); return; }
    if (same(t, b)) { if (o) out.push(o.text); return; }
    if (!o || !t) { marked(o, t, `${(o || t).slug}: one side changed the ruling, the other removed it`); return; }
    if (!b) { marked(o, t, `${o.slug}: both sides added a ruling with this slug`); return; }
    const r = mergeRuling(b, o, t);
    if (r.conflict) marked(o, t, r.conflict); else out.push(r.text);
  };
  for (const o of O.blocks) one(bi.get(o.slug), o, ti.get(o.slug));
  for (const t of T.blocks) if (!oi.has(t.slug)) one(bi.get(t.slug), undefined, t);
  // Two new rulings that each supersede the same one: caught above when both marked it, and here when a side's mark
  // is missing (a hand edit), since a merge must never leave two successors of one ruling in force.
  const successors = new Map();
  for (const [side, d] of [['ours', O], ['theirs', T]]) {
    for (const b of d.blocks) {
      if (bi.has(b.slug)) continue;
      const m = b.meta.map((l) => DECISION_META.exec(l)).find((x) => x && x[1] === 'Supersedes');
      if (!m) continue;
      const target = m[2].trim();
      const was = successors.get(target);
      if (was && was.side !== side && was.slug !== b.slug) conflicts.push(`${target} is superseded on both sides — by ${was.slug} and by ${b.slug}`);
      else successors.set(target, { side, slug: b.slug });
    }
  }
  let pre = O.pre;
  if (O.pre !== T.pre) {
    if (O.pre === B.pre) pre = T.pre;
    else if (T.pre !== B.pre) { conflicts.push('both sides changed the text before the first ruling'); pre = `<<<<<<< ours\n${O.pre}\n=======\n${T.pre}\n>>>>>>> theirs`; }
  }
  const text = `${[pre, ...out].filter((s) => s !== '').join('\n\n')}\n`;
  if (!conflicts.length) return { ok: true, text };
  // A conflict found only by the successor scan leaves no marker of its own: mark the whole merge, so git stops.
  const line = (x) => (x === '' || x.endsWith('\n') ? x : `${x}\n`);
  return { ok: false, conflicts, text: text.includes('\n<<<<<<< ours\n') || text.startsWith('<<<<<<< ours\n') ? text : `<<<<<<< ours\n${line(ours)}=======\n${line(theirs)}>>>>>>> theirs\n` };
}

// The command git runs for the decisions driver, as the loop's repository records it in its local configuration.
// It names this runtime and this script by absolute path, and falls back to git's own text merge with conflict
// markers when either is gone: a driver configured whose program cannot start leaves the file conflicted with ours
// alone and no markers, and staging that drops theirs without a word. Git runs it through its own POSIX shell on
// every platform (Git for Windows ships one); a Windows path is written with forward slashes, which that shell reads.
export function decisionsDriverCommand(runtime = process.execPath, script = JARL_SCRIPT) {
  const q = (p) => `"${String(p).replace(/\\/g, '/').replace(/(["$`])/g, '\\$1')}"`;
  return `if [ -f ${q(runtime)} ] && [ -f ${q(script)} ]; then ${guardedDriver(`${q(runtime)} ${q(script)} merge-driver decisions %O %A %B`)}; else ${TEXT_MERGE}; fi`;
}

// git's own three-way text merge with conflict markers, over %A: what git does with no driver.
const TEXT_MERGE = 'git merge-file -L ours -L base -L theirs %A %O %B';

// A driver program run so that it can never leave ours alone as the answer: a program that is there but does not
// start (a runtime too old for it, a half-finished upgrade, a Yggdrasil CLI with no merge-driver command) exits
// non-zero without writing, and git would keep ours with no markers. A non-zero exit that left no conflict markers in
// %A therefore gets git's text merge; a driver's own refusal writes its markers first and is kept. POSIX sh and grep,
// which git's shell has on every platform.
function guardedDriver(run) {
  return `${run}; s=$?; if [ $s -ne 0 ] && ! grep -q '^<<<<<<< ' %A; then ${TEXT_MERGE}; exit 1; fi; exit $s`;
}
export const JARL_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'jarl.mjs');

// How git merges a committed loop's files, in .jarl/.gitattributes (paths relative to .jarl/): the journal by union,
// the decisions by the jarl-decisions driver. A clone that never configured the driver merges the decisions with
// plain conflict markers — the fallback, never a silent union.
export const JARL_GITATTRIBUTES = `# jarl: how git merges the loop (see SKILL.md): the journal by union, ${DECISIONS_FILE} by its own driver\n/${LOG_FILE} merge=union\n/${DECISIONS_FILE} merge=jarl-decisions\n`;

// A committed loop's merge setup: .jarl/.gitattributes, and the jarl-decisions driver in the local configuration of
// the repository the loop is in (a driver is a local command, never committed). Idempotent; returns what it
// changed. A loop out of git, or outside a repository, is left alone.
export function ensureLoopMerge(root) {
  const changed = [];
  if (!existsSync(jarlDir(root)) || outOfGit(root)) return changed;
  const attrs = join(jarlDir(root), '.gitattributes');
  if (!existsSync(attrs) || readText(attrs) !== JARL_GITATTRIBUTES) { writeAtomic(attrs, JARL_GITATTRIBUTES); changed.push('.jarl/.gitattributes'); }
  if (gitHere(jarlDir(root), ['rev-parse', '--is-inside-work-tree']) !== 'true') return changed;
  for (const [key, value] of [['merge.jarl-decisions.name', `Jarl's ${DECISIONS_FILE} (rulings merged block by block)`], ['merge.jarl-decisions.driver', decisionsDriverCommand()]]) {
    if (gitHere(jarlDir(root), ['config', '--local', '--get', key]) === value) continue;
    if (gitHere(jarlDir(root), ['config', '--local', key, value]) !== null) changed.push(key);
  }
  return changed;
}

// The `-c` settings a merger passes on every `git merge`, so the drivers run whatever the clone's own configuration
// holds: the decisions driver always, and Yggdrasil's log and lock drivers when a Yggdrasil command is given (a
// repository with a graph). One shell-quoted line, ready to put between `git` and `merge`.
export function mergeFlags({ yg } = {}) {
  const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const pairs = [['merge.jarl-decisions.name', `jarl ${DECISIONS_FILE}`], ['merge.jarl-decisions.driver', decisionsDriverCommand()]];
  if (yg) {
    for (const kind of ['log', 'lock']) {
      pairs.push([`merge.yg-${kind}.name`, `Yggdrasil ${kind}`], [`merge.yg-${kind}.driver`, guardedDriver(`${yg} merge-driver ${kind} %O %A %B %P`)]);
    }
  }
  return pairs.map(([k, v]) => `-c ${sq(`${k}=${v}`)}`).join(' ');
}

// jarl.mjs merge-driver decisions <base> <ours> <theirs> — what git runs. The result always replaces <ours> before a
// clean exit; a refusal writes the markers and exits 1 so git stops on the file; anything unexpected hands the file
// to git's own text merge with markers, so ours is never left alone as if it were the answer.
export function runDecisionsDriver(basePath, oursPath, theirsPath) {
  try {
    const r = mergeDecisionsTexts(readText(basePath), readText(oursPath), readText(theirsPath));
    writeFileSync(oursPath, r.text);
    if (r.ok) return { code: 0, conflicts: [] };
    return { code: 1, conflicts: r.conflicts };
  } catch (e) {
    git(process.cwd(), ['merge-file', '-L', 'ours', '-L', 'base', '-L', 'theirs', oursPath, basePath, theirsPath]);   // merge-file exits with the number of conflicts
    return { code: 1, conflicts: [`the decisions driver failed (${e.message}); git's text merge with markers was written instead`] };
  }
}
