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
const ROUNDS_BEFORE_TAKEOVER = 3;

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
      [--where "<w>"] [--what "<w>"] [--why "<w>"] [--acceptance "<line>"]... [--source <dir>#<id>,...] [--after <ids>]
                                                 file an issue under the next free number; --repo names the repository
                                                 its code lives in when that is not the loop's own (see --repo below);
                                                 --what, --why and --acceptance (one per line, repeatable) write the body,
                                                 --source names the finding(s) it comes from, --after the issues it waits on
  body <id> [--where "<w>"] [--what "<w>"] [--why "<w>"] [--acceptance "<line>"]...
                                                 set or replace the Where field and the What, Why, Acceptance sections
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
  set <ids> <status> "<why>"                     change status; writes the log line in the same move
  tag <ids> +a -b ...                            add and remove tags
  prio <ids> 1|2|3                               set priority
  files <id> p,q,...                             declare the files the issue touches
  repo <id> <path> | <id> --clear                name the repository (its root) the issue's code lives in, or remove the field
  next [--limit n]                               open issues that do not share a file with any in-progress one and
                                                 whose After issues are done or dropped; a file is its repository and
                                                 its path (see --repo below); one with no acceptance line is marked
  review <ids> approve|changes "<findings>"      the reviewer's verdict; "done" needs an approve newer than the last round
  round <id> "<what failed>"                     one red round; after three prints the takeover block for a fresh worker
  check <id> --branch <b> [--base <feature-branch>] [--repo <path>]
                                                 commits beyond the base, diff inside the declared files, and the
                                                 change in test files and assertions — numbers, never a verdict;
                                                 read in --repo, else the issue's Repo, else the loop's own repository
  branches [--base <feature-branch>] [--repo <path>]
                                                 every jarl/NNN-* branch: commits beyond the base, worktree state;
                                                 read in --repo, else the loop's own repository
  ask "<question>" [--kind stop|stuck|lower|charter|ratify] [--target x] [--issue NNN]
                                                 a question the user has to answer; lower needs --target;
                                                 listed at boot until answered; ratify is a choice already made
                                                 under a mandate, awaiting the user's word, and blocks nothing
  answer <id> "<answer>"                         records the answer as a ruling and closes the question
  handoff write --summary "<s>" [--next "<n>"]... | read
                                                 the state of intent between sessions; the header records the loop's
                                                 head and the head of every repository an unfinished issue names
  log "<event>"                                  append one dated line to the journal
  decide <slug> "<ruling>" [--settles <ids>]    append a ruling; refuses a duplicate slug; --settles writes the
                                                 ruling into each named issue's evidence (its status is unchanged)
  status                                         the goal, when the loop opened and last moved, then one line:
                                                 open, in flight, waiting, done, dropped, deferred, open questions,
                                                 to ratify; then the choices awaiting ratification and the issues
                                                 in flight with no acceptance line
  archive "<slug>"                               put the current loop away under .jarl/archive/<yyyy.mm.dd>-<slug>/,
                                                 keeping the archive and the mode markers, so init can open a
                                                 new loop here in the same mode
  report                                         what was done, dropped, deferred and found — ready for the changelog
  mode permanent                                 switch an existing committed loop to the permanent mode, with a
                                                 log line; refuses a default-mode loop (out of git — a permanent
                                                 record must be committed) and an already-permanent one
  close [--force]                                refuse while anything is open or in progress; else remove .jarl/
                                                 — a permanent loop (see init --permanent, or mode permanent) is
                                                 kept instead: it logs the close and the directory stays as the record

options: --json  --help  --root <repo root>

<ids> (evidence, review, set, tag, prio): one id, or several as one comma list with ranges — 12,13,14 or
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
the same path in two repositories apart, and check matches the path after the name.`;

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

function setSection(text, name, body) {
  const re = new RegExp(`(^##\\s+${name}\\s*$\\n)([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'mi');
  if (re.test(text)) return text.replace(re, `$1${body.trim()}\n\n`);
  return `${text.replace(/\s*$/, '')}\n\n## ${name}\n${body.trim()}\n`;
}

// A body written into a section must not open a section of its own: a line starting with ## would end it
// early and the rest would land under a heading nobody reads. Such a line is escaped (\##), which renders
// the same and parses as text.
export function bodyText(v) {
  return String(v ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/^(\s*)(#+\s)/, '$1\\$2')).join('\n').trim();
}
// A header field is one line.
function fieldText(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
// --acceptance repeats, one checkable line each; several become a list.
export function acceptanceText(v) {
  const lines = [].concat(v ?? []).map(bodyText).filter(Boolean);
  return lines.length > 1 ? lines.map((l) => `- ${l}`).join('\n') : (lines[0] || '');
}

export function renderIssue({ id, title, kind, priority, tier, tags, files, repo, foundBy, where = '', what = '', why = '', acceptance = '', source = [], after = [] }) {
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
## Evidence

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

export function appendDecision(root, slug, ruling) {
  const path = join(jarlDir(root), 'decisions.md');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '# Decisions\n';
  if (new RegExp(`^## \\d{4}-\\d{2}-\\d{2} · ${slug}\\s*$`, 'm').test(existing)) throw new Error(`duplicate slug: ${slug}`);
  writeAtomic(path, `${existing.replace(/\s*$/, '')}\n\n## ${today()} · ${slug}\n${ruling.trim()}\n`);
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

// What stays in .jarl/ when a loop is archived: the archive itself and the markers that say how the
// loop lives in git, so the next loop opened here keeps the same mode.
const ARCHIVE_KEEPS = new Set(['archive', '.gitignore', '.permanent', '.lock', '.lock.break']);

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

export function cmdNew(root, title, flags) {
  need(title, 'new requires "<title>"');
  needLiveLoop(root, ' — run: jarl.mjs init "<goal>"');
  const kind = flags.kind || 'bug';
  need(KINDS.includes(kind), `--kind must be one of: ${KINDS.join(', ')}`);
  const priority = String(flags.prio || '2');
  need(PRIORITIES.includes(priority), '--prio must be 1, 2 or 3');
  const tier = String(flags.tier || 'standard');
  need(TIERS.includes(tier), `--tier must be one of: ${TIERS.join(', ')} — the tier of model the worker is raised on, mapped to a model by the platform running the loop`);
  if (flags.repo !== undefined) repoOf(root, flags.repo);
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
      tags: splitList(flags.tags), files: splitList(flags.files), repo: flags.repo, foundBy: flags['found-by'] || 'jarl',
      where: flags.where, what: bodyText(flags.what), why: bodyText(flags.why), acceptance: acceptanceText(flags.acceptance), source, after,
    }));
    let claimed = !taken().includes(n);
    if (claimed) { try { claimed = claimFile(tmp, file); } catch (e) { unlinkSync(tmp); throw e; } }
    unlinkSync(tmp);
    if (claimed) { appendLog(root, `filed ${id} · ${title}`); return { id, file }; }
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
  const parts = ['where', 'what', 'why', 'acceptance'].filter((k) => flags[k] !== undefined);
  need(parts.length, 'body needs at least one of --where, --what, --why, --acceptance');
  let text = readFileSync(issue.file, 'utf8');
  if (flags.where !== undefined) text = setField(text, 'Where', fieldText(flags.where));
  if (flags.what !== undefined) text = setSection(text, 'What', bodyText(flags.what));
  if (flags.why !== undefined) text = setSection(text, 'Why', bodyText(flags.why));
  if (flags.acceptance !== undefined) text = setSection(text, 'Acceptance', acceptanceText(flags.acceptance));
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

export function cmdSet(root, rawIds, status, why) {
  need(STATUSES.includes(status), `status must be one of: ${STATUSES.join(', ')}`);
  const issues = issuesFor(root, rawIds);
  need(status !== 'dropped' || why, 'dropped needs a reason: jarl.mjs set <id> dropped "<why>"');
  need(status !== 'deferred' || why, 'deferred needs a reason: jarl.mjs set <id> deferred "<why>" — work that waits, not work that is gone');
  const nothing = issues.length > 1 ? ' — nothing was written' : '';
  for (const issue of issues) {
    need(status !== 'done' || issue.sections.evidence?.trim(), `${issue.id} has no evidence yet — record it first: jarl.mjs evidence ${issue.id} "<what was run and what it printed>"${nothing}`);
    need(status !== 'done' || reviewState(root, issue.id).approved, `${issue.id} has no approving review newer than its last round — a fresh reviewer reads the issue and the diff first: jarl.mjs review ${issue.id} approve|changes "<findings>"${nothing}`);
  }
  const writes = issues.map((issue) => {
    let text = readFileSync(issue.file, 'utf8');
    text = setField(text, 'Status', status);
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
  appendLogLines(root, issues.map((issue) => `${issue.id} → ${status}${why ? ` · ${why}` : ''}`));
  return oneOrMany(rawIds, issues.map((issue) => ({ id: issue.id, status, ...(status === 'done' ? doneNote(issue) : {}) })));
}

// Said, never refused: done closes an issue whose acceptance is missing, or has more lines than the
// --ran/--saw rows recorded, but the output says so, so the gap is seen by whoever closed it.
function doneNote(issue) {
  const lines = acceptanceLineCount(issue);
  if (!lines) return { note: 'no acceptance line on file' };
  const rows = evidenceRows(issue).length;
  return rows && rows < lines ? { note: `${lines} acceptance line(s), ${rows} --ran/--saw row(s)` } : {};
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
  need(path !== undefined, 'repo requires <path> — the checkout of the repository the issue\'s code lives in (or --clear to remove the field)');
  repoOf(root, path);
  writeAtomic(issue.file, setField(readFileSync(issue.file, 'utf8'), 'Repo', path));
  return { id: issue.id, repo: path };
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

export function acceptanceLineCount(issue) {
  const text = issue.sections.acceptance || '';
  return text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0).length;
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
  if (!issue.fields.repo) return { repo: root, path: declared };
  const spelled = resolve(root, issue.fields.repo);
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
  return { repo, path: declared };
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
    if (after.length) { out.push({ id: i.id, title: i.title, priority: i.priority, after }); continue; }
    const keys = keysOf(i);
    const clash = keys.filter((k) => taken.has(k.key)).map((k) => k.f);
    if (clash.length) { out.push({ id: i.id, title: i.title, priority: i.priority, waitsOn: clash }); continue; }
    keys.forEach((k) => taken.add(k.key));
    // Offered, but flagged: a worker raised on an issue with no acceptance line has nothing to prove, and
    // the reviewer nothing to check it against. Fill it with body --acceptance before raising one.
    out.push({ id: i.id, title: i.title, priority: i.priority, files: i.files, ready: true, ...(acceptanceLineCount(i) ? {} : { noAcceptance: true }) });
  }
  const limit = Number(flags.limit) || Infinity;
  let n = 0;
  return out.filter((r) => { if (!r.ready) return true; n += 1; return n <= limit; });
}

export function cmdStatus(root) {
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
  return c;
}

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
  if (existsSync(join(jarlDir(root), '.permanent'))) {
    appendLog(root, `closed · kept as a permanent record${deferred.length ? ` · ${deferred.length} deferred still waiting: ${deferred.join(', ')}` : ''}`);
    return { removed: null, kept: jarlDir(root), leftOpen: left.map((i) => i.id), deferred };
  }
  rmSync(jarlDir(root), { recursive: true, force: true });
  return { removed: jarlDir(root), kept: null, leftOpen: left.map((i) => i.id), deferred };
}


// ---- review ----------------------------------------------------------------------------------

// The latest review and the latest round, by their position in the journal: a round after an
// approve means the approve is spent and the branch needs fresh eyes.
export function reviewState(root, id) {
  const path = join(jarlDir(root), 'log.md');
  if (!existsSync(path)) return { approved: false, lastReview: null };
  const lines = readFileSync(path, 'utf8').split('\n');
  let lastReview = null; let lastReviewAt = -1; let lastRoundAt = -1;
  lines.forEach((l, i) => {
    const m = new RegExp(`· ${id} review (approve|changes) · `).exec(l);
    if (m) { lastReview = m[1]; lastReviewAt = i; }
    if (l.includes(`· ${id} round `)) lastRoundAt = i;
  });
  return { approved: lastReview === 'approve' && lastReviewAt > lastRoundAt, lastReview };
}

const SEVERITIES = ['Critical', 'Important', 'Minor'];

// A "changes" verdict names at least one Critical or Important finding — Minor alone never bounces
// a branch back to a worker, it goes to evidence and the branch still merges (the review discipline's
// own rule, enforced here rather than left to a reviewer's judgement).
export function cmdReview(root, rawIds, verdict, findings) {
  need(verdict === 'approve' || verdict === 'changes', 'review requires approve|changes');
  need(findings, 'review requires "<findings>" — what was read and what was found, even when nothing');
  const issues = issuesFor(root, rawIds);
  const severities = SEVERITIES.filter((s) => findings.includes(s));
  if (verdict === 'changes') {
    need(severities.length > 0, `"changes" needs at least one finding ranked ${SEVERITIES.join('/')} — name the severity, not just the problem`);
    need(severities.some((s) => s !== 'Minor'), '"changes" needs a Critical or Important finding — Minor alone goes to evidence on an approve, it never bounces a branch');
  }
  appendLogLines(root, issues.map((issue) => `${issue.id} review ${verdict} · ${findings.split('\n')[0]}`));
  // The verdict comes back with the acceptance it was given against, so a reviewer (and the merger reading
  // the output) sees what the approve claims is met — or that there was nothing to meet.
  return oneOrMany(rawIds, issues.map((issue) => ({ id: issue.id, verdict, severities, acceptance: (issue.sections.acceptance || '').trim() })));
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

export function cmdCheck(root, rawId, flags) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  need(flags.branch, 'check requires --branch <worker branch>');
  const repo = repoOf(root, flags.repo ?? issue.fields.repo);
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
  const named = flags.repo !== undefined ? { ...issue, fields: { ...issue.fields, repo: flags.repo } } : issue;
  const declared = issue.files.map((d) => fileAt(root, named, d).path);
  const outside = issue.files.length ? changed.filter((f) => !alwaysInScope(f) && !declared.some((d) => pathMatches(f, d))) : [];
  const testsBase = (git(repo, ['ls-tree', '-r', '--name-only', mergeBase]) || '').split('\n').filter(isTestFile);
  const testsTip = (git(repo, ['ls-tree', '-r', '--name-only', flags.branch]) || '').split('\n').filter(isTestFile);
  const removedTests = testsBase.filter((f) => !testsTip.includes(f));
  const touchedTests = changed.filter(isTestFile);
  const assertsBase = countAsserts(repo, mergeBase, [...new Set([...touchedTests, ...removedTests])]);
  const assertsTip = countAsserts(repo, flags.branch, touchedTests);
  const items = [
    { name: 'commits beyond base', ok: Number(commits) > 0, note: `${commits} commit(s) on ${flags.branch} beyond ${mergeBase.slice(0, 7)}` },
    { name: 'diff inside declared files', ok: outside.length === 0, note: issue.files.length ? (outside.length ? `outside ${issue.files.join(', ')}: ${outside.join(', ')}` : `${changed.length} file(s), all inside`) : 'no files declared on the issue — nothing to bound the diff by' },
    { name: 'test files', ok: removedTests.length === 0, note: removedTests.length ? `removed: ${removedTests.join(', ')}` : `${testsTip.length} on the branch, ${touchedTests.length} touched, none removed` },
    { name: 'assertions in touched tests', ok: assertsTip >= assertsBase, note: `${assertsBase} → ${assertsTip}` },
  ];
  return { id: issue.id, branch: flags.branch, repo, base, mergeBase, changed, items, ok: items.every((i) => i.ok) };
}

// Every jarl/* branch, plus every branch some worktree has checked out that is not the base: a
// worker that never renamed its branch still did the work, and a listing that hides it would
// hide a report. Such a branch is marked unnamed so the merger renames it before merging.
// With --repo, all of it is read in that repository, for a loop whose workers change another one.
// Worker branches in one repository, or — with no --repo — in the loop's own repository and in every repository
// an open or in-progress issue names, each row carrying the repository's name. The boot reads this to see a worker
// branch with commits as a report, and in a loop whose issues point at other repositories that is where they are.
export function cmdBranches(root, flags) {
  const repos = flags.repo !== undefined ? [repoOf(root, flags.repo)] : loopRepos(root);
  return repos.flatMap((repo) => branchesIn(root, repo, flags));
}

function loopRepos(root) {
  const seen = new Map([[canonical(root), root]]);
  for (const issue of loadIssues(root)) {
    if (issue.status !== 'open' && issue.status !== 'in-progress') continue;
    const named = issue.fields.repo;
    if (!named) continue;
    let repo;
    try { repo = repoOf(root, named); } catch { continue; }   // a Repo path that no longer resolves is not the boot's to refuse
    const real = canonical(repo);
    if (!seen.has(real)) seen.set(real, repo);
  }
  return [...seen.values()];
}

function branchesIn(root, repo, flags) {
  const base = flags.base || defaultBase(repo);
  const named = (git(repo, ['branch', '--list', 'jarl/*', '--format=%(refname:short)']) || '').split('\n').filter(Boolean);
  const worktrees = (git(repo, ['worktree', 'list', '--porcelain']) || '').split('\n\n').map((b) => {
    const path = /^worktree (.*)$/m.exec(b)?.[1];
    const branch = /^branch refs\/heads\/(.*)$/m.exec(b)?.[1];
    return { path, branch };
  }).filter((w) => w.branch);
  const mainPath = git(repo, ['rev-parse', '--show-toplevel']);
  const extra = worktrees.filter((w) => w.branch !== base && !named.includes(w.branch) && w.path !== mainPath).map((w) => w.branch);
  return [...named, ...extra].map((name) => {
    const mb = git(repo, ['merge-base', base, name]);
    const ahead = mb ? Number(git(repo, ['rev-list', '--count', `${mb}..${name}`]) || 0) : null;
    const wt = worktrees.find((w) => w.branch === name);
    const dirty = wt ? (git(wt.path, ['status', '--porcelain']) || '').split('\n').filter(Boolean).length : null;
    return { repo: basename(repo), branch: name, ahead, worktree: wt ? wt.path : null, dirty, unnamed: !name.startsWith('jarl/') };
  });
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
  appendDecision(root, `ask-${id}`, `**Question:** ${ask.question}\n**Answer:** ${answer}`);
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

export function cmdDecide(root, slug, ruling, flags = {}) {
  need(slug && ruling, 'decide requires <slug> "<ruling>"');
  const settles = flags.settles !== undefined ? issuesFor(root, flags.settles) : [];
  appendDecision(root, slug, settles.length ? `${ruling.trim()}\n\n**Settles:** ${settles.map((i) => i.id).join(', ')}` : ruling);
  appendLog(root, `decided ${slug}`);
  if (settles.length) appendRuling(root, settles, `Ruling ${slug}: ${ruling.trim().split('\n')[0]}`);
  return { slug, settles: settles.map((i) => i.id) };
}

function handoffPath(root) { return join(jarlDir(root), 'handoff.md'); }

export function cmdHandoffWrite(root, flags) {
  need(typeof flags.summary === 'string' && flags.summary, 'handoff write requires --summary "<s>"');
  const inFlight = loadIssues(root).filter((i) => i.status === 'in-progress').map((i) => `${i.id} ${i.title}`);
  const byId = new Map(loadIssues(root).map((i) => [i.id, i]));
  const inFlightLines = loadIssues(root).filter((i) => i.status === 'in-progress').map((i) => { const w = waitingOn(i, byId); return `${i.id} ${i.title}${w.length ? ` (waits on ${w.join(', ')})` : ''}`; });
  const asks = loadAsks(root).filter((a) => a.state === 'open');
  const open = asks.filter((a) => a.kind !== 'ratify').map((a) => `a-${a.id} ${a.question}`);
  const ratify = asks.filter((a) => a.kind === 'ratify').map((a) => `a-${a.id}${a.issue ? ` (issue ${a.issue})` : ''} ${a.question}`);
  const next = [].concat(flags.next || []).filter(Boolean);
  const headOf = (dir) => `${git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']) || '?'}@${git(dir, ['rev-parse', '--short', 'HEAD']) || '?'}`;
  // Where each other repository an unfinished issue names stands, beside the loop's own head: in a
  // loop whose workers change another repository, that head is the one the next session resumes from.
  const repos = [...new Set(loadIssues(root).filter((i) => i.status === 'open' || i.status === 'in-progress').map((i) => i.fields.repo).filter(Boolean))];
  const heads = repos.map((r) => ` · **Head in ${r}:** ${headOf(resolve(root, r))}`).join('');
  const text = `# Handoff\n\n**At:** ${stamp()} · **Head:** ${headOf(root)}${heads}\n\n## Summary\n${flags.summary}\n\n## In flight\n${inFlightLines.map((s) => `- ${s}`).join('\n') || '- (nothing)'}\n\n## Waiting on the user\n${open.map((s) => `- ${s}`).join('\n') || '- (nothing)'}\n\n${ratify.length ? `## Decided under mandate, awaiting ratification\n${ratify.map((s) => `- ${s}`).join('\n')}\n\n` : ''}## Next\n${next.map((s) => `- ${s}`).join('\n') || '- (nothing recorded)'}\n`;
  writeAtomic(handoffPath(root), text);
  appendLog(root, `handoff · ${flags.summary.split('\n')[0]}`);
  return { path: handoffPath(root), inFlight: inFlight.length, waiting: open.length, ratify: ratify.length };
}

export function cmdHandoffRead(root) {
  return existsSync(handoffPath(root)) ? readFileSync(handoffPath(root), 'utf8') : 'fresh start — no handoff recorded';
}

// The reason an issue was dropped or deferred: the last "Dropped: ..." / "Deferred: ..." line of its Evidence,
// whatever notes were written before it. Evidence with no such line (an older file) is read whole.
function statusReason(evidence, word) {
  const text = (evidence || '').trim();
  const last = [...text.matchAll(new RegExp(`^${word}:\\s*(.*)$`, 'gm'))].pop();
  return last ? last[1].trim() : text;
}

export function cmdReport(root) {
  const issues = loadIssues(root);
  const done = issues.filter((i) => i.status === 'done');
  const dropped = issues.filter((i) => i.status === 'dropped');
  const deferred = issues.filter((i) => i.status === 'deferred');
  const left = issues.filter((i) => i.status === 'open' || i.status === 'in-progress');
  const found = issues.filter((i) => i.fields['found by'] && !/^jarl\b/i.test(i.fields['found by']));
  const goal = existsSync(join(jarlDir(root), 'goal.md')) ? readFileSync(join(jarlDir(root), 'goal.md'), 'utf8').split('\n').slice(2).find((l) => l.trim()) || '' : '';
  const lines = [`# Report`, '', goal, '', `## Done (${done.length})`, ...done.map((i) => `- ${i.id} ${i.title} (${i.kind})`),
    '', `## Dropped (${dropped.length})`, ...dropped.map((i) => `- ${i.id} ${i.title} — ${statusReason(i.sections.evidence, 'Dropped')}`),
    '', `## Deferred (${deferred.length})`, ...deferred.map((i) => `- ${i.id} ${i.title} — ${statusReason(i.sections.evidence, 'Deferred')}`),
    '', `## Still open (${left.length})`, ...left.map((i) => `- ${i.id} ${i.title} (${i.status})`),
    '', `## Found along the way (${found.length})`, ...found.map((i) => `- ${i.id} ${i.title} — ${i.fields['found by']}`)];
  return { done: done.length, dropped: dropped.length, deferred: deferred.length, left: left.length, found: found.length, text: lines.join('\n') + '\n' };
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
    list = json.flatMap((x) => (x.surviving || []).map((f) => (f && f.id !== undefined && x.angle ? { ...f, id: `${x.angle}/${f.id}`, localId: String(f.id) } : f)));
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
      title: title.length > 140 ? `${title.slice(0, 139)}…` : title,
      kind: KINDS.includes(kindRaw) ? kindRaw : (KIND_OF[kindRaw] || 'bug'),
      priority: PRIORITIES.includes(prioRaw) ? prioRaw : (PRIO_OF[prioRaw] || '2'),
      where: String(f.where || f.surfaces || ''),
      what: [claim && `Claim: ${claim}`, typeof f.truth === 'string' && f.truth && `Truth: ${f.truth}`, typeof f.evidence === 'string' ? f.evidence : ''].filter(Boolean).join('\n\n'),
      why: [why, f.effort && `Effort (the finding's estimate): ${f.effort}`].filter(Boolean).join('\n\n'),
      acceptance: proposal ? `Proposed by the finding — make it checkable before a worker starts: ${proposal}` : '',
    };
  });
  // What an older issue would have written to name the finding: its own id, or the bare id inside its angle
  // when no other angle uses the same one.
  const local = new Map();
  for (const f of out) local.set(f.localId, (local.get(f.localId) || 0) + 1);
  return out.map((f) => ({ ...f, mention: local.get(f.localId) === 1 ? f.localId : f.id }));
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

// An issue filed before Source existed often names its finding in the title or the evidence. That issue is
// found, never guessed at: a title naming the id wins, else the one body that names it; two candidates are
// reported as ambiguous and left alone.
function mentionOf(issues, id) {
  const re = new RegExp(`(^|[^A-Za-z0-9-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9-]|$)`);
  const legacy = issues.filter((i) => i.fields.source === undefined);
  const byTitle = legacy.filter((i) => re.test(i.title));
  if (byTitle.length === 1) return { issue: byTitle[0] };
  if (byTitle.length > 1) return { ambiguous: byTitle.map((i) => i.id) };
  const byBody = legacy.filter((i) => re.test(readFileSync(i.file, 'utf8')));
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
  if (flags.repo !== undefined) repoOf(root, flags.repo);
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
    const m = mentionOf(issues, f.mention);
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
  for (const file of files) { const { dir, findings } = readFindings(file, flags); findings.forEach((f) => { add(dir, f.id); mentionKey.set(`${dir}#${f.id}`, f.mention); }); }
  for (const key of filedAs.keys()) { const at = key.indexOf('#'); add(key.slice(0, at), key.slice(at + 1)); }
  const fromFile = new Set();
  for (const file of files) fromFile.add(readFindings(file, flags).dir);
  return [...reports.entries()].map(([dir, ids]) => {
    const rows = ids.map((id) => {
      const on = filedAs.get(`${dir}#${id}`) || [];
      if (on.length) return { finding: id, issues: on.map((i) => ({ id: i.id, status: i.status })) };
      const m = mentionKey.has(`${dir}#${id}`) ? mentionOf(issues, mentionKey.get(`${dir}#${id}`)) : {};
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
    where: 'value', what: 'value', why: 'value', acceptance: 'many', source: 'value', after: 'value',
  },
  body: { where: 'value', what: 'value', why: 'value', acceptance: 'many' },
  import: {
    source: 'value', kind: 'value', prio: 'value', tier: 'value', tags: 'value', repo: 'value', 'found-by': 'value',
    only: 'value', adopt: 'bool', 'dry-run': 'bool',
  },
  sources: { source: 'value' },
  source: {},
  after: { clear: 'bool' },
  evidence: { ran: 'many', saw: 'many' },
  list: { status: 'value', kind: 'value', tag: 'value', prio: 'value', grep: 'value', all: 'bool' },
  show: {}, set: {}, tag: {}, prio: {}, files: {},
  repo: { clear: 'bool' },
  next: { limit: 'value' },
  review: {}, round: {},
  check: { branch: 'value', base: 'value', repo: 'value' },
  branches: { base: 'value', repo: 'value' },
  ask: { kind: 'value', target: 'value', issue: 'value' },
  answer: {},
  handoff: { summary: 'value', next: 'many' },
  log: {}, decide: { settles: 'value' }, status: {}, archive: {}, report: {}, mode: {},
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
  check: 1, branches: 0, ask: 1, answer: 2, handoff: 1, log: 1, decide: 2, status: 0, archive: 1, report: 0, mode: 1, close: 0,
  body: 1, import: 1, source: 2, after: 2,
};

function renderStatus(o) {
  const head = o.goal ? `goal: ${o.goal}\nopened ${o.opened || '?'} · last activity ${o.lastActivity || '?'}${o.archived ? ` · ${o.archived} archived loop(s)` : ''}\n` : '';
  const line = `open ${o.ready} · in flight ${o.inFlight}${o.waiting ? ` · waiting ${o.waiting}` : ''} · done ${o.done} · dropped ${o.dropped} · deferred ${o.deferred} · questions ${o.questions}${o.ratify ? ` · to ratify ${o.ratify}` : ''}`;
  const more = [
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
const MUTATING = new Set(['init', 'new', 'body', 'import', 'source', 'after', 'set', 'tag', 'prio', 'files', 'repo', 'evidence', 'review', 'round', 'ask', 'answer', 'handoff', 'log', 'decide', 'archive', 'mode', 'close']);

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
      case 'set': out = cmdSet(root, rest[0], rest[1], rest[2]); text = each(out, (o) => `${o.id} → ${o.status}`); warn = [].concat(out).filter((o) => o.note).map((o) => `note: ${o.id} ${o.note}`); break;
      case 'tag': out = cmdTag(root, rest[0], rest.slice(1)); text = each(out, (o) => `${o.id} tags: ${o.tags.join(', ') || '(none)'}`); break;
      case 'prio': out = cmdPrio(root, rest[0], rest[1]); text = each(out, (o) => `${o.id} priority ${o.priority}`); break;
      case 'files': out = cmdFiles(root, rest[0], rest[1]); text = `${out.id} files: ${out.files.join(', ') || '(none)'}`; break;
      case 'repo': out = cmdRepo(root, rest[0], rest[1], { clear: flags.clear === true }); text = `${out.id} repo: ${out.cleared ? 'cleared' : out.repo}`; break;
      case 'evidence': out = cmdEvidence(root, rest[0], rest[1], flags); text = each(out, (o) => (o.rows ? `${o.id} evidence row${o.rows.length > 1 ? 's' : ''} recorded` : `${o.id} evidence recorded`)); break;
      case 'next': out = cmdNext(root, flags); text = out.length ? out.map((r) => (r.ready ? `${r.id}  P${r.priority}  ${r.title}${r.noAcceptance ? '  (no acceptance yet)' : ''}` : r.after ? `${r.id}  P${r.priority}  ${r.title}  (after ${r.after.join(', ')})` : `${r.id}  P${r.priority}  ${r.title}  (waits on ${r.waitsOn.join(', ')})`)).join('\n') : '(nothing open)'; break;
      case 'review': out = cmdReview(root, rest[0], rest[1], rest[2]); text = each(out, (o) => `${o.id} review ${o.verdict} · acceptance: ${o.acceptance ? o.acceptance.split('\n').join(' / ') : '(none on file)'}`); break;
      case 'round': out = cmdRound(root, rest[0], rest[1]); text = out.takeover ? `${out.id} round ${out.round} — takeover:\n\n${out.block}` : `${out.id} round ${out.round} of ${ROUNDS_BEFORE_TAKEOVER} before a takeover`; break;
      case 'check': out = cmdCheck(root, rest[0], flags); text = `${out.repo === root ? '' : `in ${out.repo}\n`}${out.items.map((i) => `${i.ok ? '✓' : '✗'} ${i.name} — ${i.note}`).join('\n')}`; break;
      case 'branches': out = cmdBranches(root, flags); text = out.length ? out.map((b) => `${b.repo !== basename(root) ? `[${b.repo}] ` : ''}${b.branch}  +${b.ahead ?? '?'}  ${b.worktree ? `${b.worktree}${b.dirty ? ` (${b.dirty} uncommitted)` : ' (clean)'}` : '(no worktree)'}${b.unnamed ? '  UNNAMED — rename to jarl/NNN-slug before merging' : ''}`).join('\n') : '(no worker branches)'; break;
      case 'ask': out = cmdAsk(root, rest[0], flags); text = out.kind === 'ratify' ? `filed a-${out.id} for ratification · blocks nothing` : `asked a-${out.id}`; break;
      case 'answer': out = cmdAnswer(root, rest[0], rest[1]); text = `answered a-${out.id}${out.issue ? ` · written into ${out.issue}` : ''}`; break;
      case 'handoff': if (rest[0] === 'write') { out = cmdHandoffWrite(root, flags); text = `handoff written · ${out.inFlight} in flight · ${out.waiting} waiting on the user`; } else { out = { text: cmdHandoffRead(root) }; text = out.text; } break;
      case 'report': out = cmdReport(root); text = out.text; break;
      case 'log': need(rest[0], 'log requires "<event>"'); appendLog(root, rest[0]); out = { logged: rest[0] }; text = 'logged'; break;
      case 'decide': out = cmdDecide(root, rest[0], rest[1], flags); text = `decided ${out.slug}${out.settles.length ? ` · written into ${out.settles.join(', ')}` : ''}`; break;
      case 'status': out = cmdStatus(root); text = renderStatus(out); break;
      case 'archive': out = cmdArchive(root, rest[0]); text = `archived → ${out.archived}${out.leftOpen.length ? ` · ${out.leftOpen.length} still open or in progress: ${out.leftOpen.join(', ')}` : ''} · open a new loop with: jarl.mjs init "<goal>"`; break;
      case 'mode': out = cmdMode(root, rest[0]); text = 'now permanent · no longer tied to a feature branch; close keeps the directory'; break;
      case 'close': out = cmdClose(root, flags); text = (out.kept ? `kept ${out.kept} · closed as a permanent record` : `removed ${out.removed}`) + (out.deferred.length ? ` · ${out.deferred.length} deferred still waiting: ${out.deferred.join(', ')}` : ''); break;
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
