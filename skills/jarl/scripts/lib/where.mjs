// Where a loop is: its root, its directory and its issues, a path as the record stores it and as the disk holds it,
// and the clock of its lines.

import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, dirname, basename, isAbsolute, relative, sep, win32 } from 'node:path';
import { echoWord, hole, jarlLine, need, printable, refuse, shellWord } from './base.mjs';
import { git } from './git.mjs';

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
// The loops under a project, by a bounded walk from its root: each directory that holds .jarl/, at most LOOP_WALK_DEPTH
// directories below the root, as a path relative to the root with / between its parts ('.' for the root itself), in name
// order. The walk never enters a directory that is not the loop's to hold: a hidden one (.git, .jarl, a tool's own), one
// named node_modules or vendor (installed or vendored copies), and one that holds a .git entry of its own (another
// checkout: a worktree, a submodule, a cloned repository); it follows no link, and it stops after LOOP_WALK_DIRS
// directories, saying so in `stopped`. Read-only.
export const LOOP_WALK_DEPTH = 4;
export const LOOP_WALK_DIRS = 5000;
const NOT_WALKED = new Set(['node_modules', 'vendor']);
export function loopsUnder(project, { depth = LOOP_WALK_DEPTH, limit = LOOP_WALK_DIRS } = {}) {
  const loops = [];
  let seen = 0;
  let stopped = false;
  let level = [[resolve(project), []]];
  for (let d = 0; d <= depth && level.length && !stopped; d += 1) {
    const below = [];
    for (const [dir, parts] of level) {
      if (seen >= limit) { stopped = true; break; }
      seen += 1;
      if (existsSync(jarlDir(dir))) loops.push(parts.length ? parts.join('/') : '.');
      if (d === depth) continue;
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.') || NOT_WALKED.has(e.name)) continue;
        const child = join(dir, e.name);
        if (existsSync(join(child, '.git'))) continue;
        below.push([child, [...parts, e.name]]);
      }
    }
    level = below;
  }
  return { loops: loops.sort((a, b) => (a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b))), stopped, depth };
}
// The loops a text names, the first few, with the count of the rest: `use` with no path lists them all.
const LOOPS_SHOWN = 10;
const loopsText = (list) => `${list.slice(0, LOOPS_SHOWN).join(', ')}${list.length > LOOPS_SHOWN ? `, and ${list.length - LOOPS_SHOWN} more` : ''}`;
const stoppedText = (walk) => (walk.stopped ? ` (the walk stopped after ${LOOP_WALK_DIRS} directories; there may be more)` : '');

// The loop a call reaches when it names none (no --root, no JARL_ROOT, no loop a session chose with use): the loop at the
// root of the checkout it starts in (findRoot), never one below it. The loops under that checkout are listed by the
// bounded walk: where its root holds a loop, that loop is reached and `note` names the others; where it holds none and
// loops are below, the call is refused with the list, since which one was meant is the caller's to say; where there is
// none at all, the root is reached, as a call that opens a loop there needs. { root, note }.
export function discoverLoop(cwd = process.cwd()) {
  const project = findRoot(cwd);
  const walk = loopsUnder(project);
  const below = walk.loops.filter((l) => l !== '.');
  if (!below.length) return { root: project, note: null };
  if (walk.loops.includes('.')) {
    return { root: project, note: `the call named no loop and reached the one at the root of this checkout; ${below.length} more ${below.length === 1 ? 'is' : 'are'} below it: ${loopsText(below)}${stoppedText(walk)} — another is reached with --root or JARL_ROOT, or for the calls that follow with ${jarlLine('use', hole('<path>'))}` };
  }
  return refuse(`the call names no loop, this checkout holds none at its root, and ${below.length} ${below.length === 1 ? 'loop is' : 'loops are'} below it: ${loopsText(below)}${stoppedText(walk)} — which one is meant is the caller's to say, with --root or JARL_ROOT, or for the calls that follow with ${jarlLine('use', hole('<path>'))}; nothing was read or written`, { flag: '--root', value: hole('<loop-root>') });
}

// use [<path>]: with no path, the loops under the checkout (`project`) as the walk finds them; with one, the loop the
// calls that follow reach: a path relative to the checkout, as the list prints it, or absolute, which must hold .jarl/
// (a loop's own .jarl/ names the same loop). The command line keeps nothing between runs, so it prints the JARL_ROOT
// setting for each shell; the MCP server holds the choice for its session (jarl-mcp.mjs). Neither writes the record.
export function cmdUse(project, path) {
  const walk = loopsUnder(project);
  if (path === undefined) return { loops: walk.loops, stopped: walk.stopped, depth: walk.depth };
  need(typeof path === 'string' && path.trim() !== '', 'use names the loop the calls that follow reach: its path, as use with no path lists it', () => ({ arg: 0, value: hole('<path>') }));
  let target = isAbsolute(path.trim()) ? resolve(path.trim()) : resolve(project, path.trim());
  if (basename(target) === '.jarl' && existsSync(target)) target = dirname(target);
  need(existsSync(jarlDir(target)), `${echoWord(path)} holds no loop: there is no .jarl/ there — the loops under this checkout: ${walk.loops.length ? loopsText(walk.loops) : 'none'}${stoppedText(walk)}`, () => ({ arg: 0, value: hole('<path>') }));
  const inside = relative(project, target);
  const shown = inside === '' ? '.' : !inside.startsWith('..') && !isAbsolute(inside) ? inside.split(sep).join('/') : path.trim();
  return { root: target, path: shown, loops: walk.loops };
}
// The JARL_ROOT setting of a loop for each shell a form of Jarl's is pasted into, each line saying which it is for.
export function renderUse(o) {
  if (o.root === undefined) {
    if (!o.loops.length) return `no loop under this checkout, down to ${o.depth} levels — open one with ${jarlLine('init', hole('<goal>'))}`;
    return [`loops under this checkout (${o.loops.length}, down to ${o.depth} levels)${o.stopped ? ` — the walk stopped after ${LOOP_WALK_DIRS} directories; there may be more` : ''}:`, ...o.loops.map((l) => `- ${l}${l === '.' ? ' (the root: a call that names no loop reaches it)' : ''}`), `the calls that follow reach one: ${jarlLine('use', hole('<path>'))}`].join('\n');
  }
  const ps = `'${o.root.replace(/'/g, "''")}'`;
  return [
    `use ${o.path}: the command line keeps nothing between runs, so set JARL_ROOT in this shell, and every call that names no --root reaches this loop until JARL_ROOT is changed or unset:`,
    `  POSIX shell (sh, bash, zsh): export JARL_ROOT=${shellWord(o.root, 'posix')}`,
    `  PowerShell: $env:JARL_ROOT = ${ps}`,
    printable(o.root, 'windows') && !o.root.includes('"') ? `  cmd: set "JARL_ROOT=${o.root}"` : '  cmd: this path holds a character cmd cannot carry in a setting; use PowerShell or --root',
  ].join('\n');
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

// The clock every stamp Jarl writes and every age it reads is taken from. setClock is the tests' seam: a test sets the
// moment (milliseconds since the epoch) to write and read a loop at times it names, and null puts the real clock back.
// No command and no library call sets it.
let clockMs = null;
export function setClock(ms) { clockMs = ms ?? null; }
export function nowMs() { return clockMs ?? Date.now(); }
function today() { return new Date(nowMs()).toISOString().slice(0, 10); }
function stamp() { return new Date(nowMs()).toISOString().replace('T', ' ').slice(0, 16); }

// A path written into an issue (Files, Repo) is read on every OS the loop is checked out on, and git names files with
// '/' everywhere: a path given on Windows is stored with '/' (C:\a\b → C:/a/b, which Windows reads the same). Elsewhere a
// backslash is an ordinary file-name character and is kept.
export function portablePath(p, platform = process.platform) { return platform === 'win32' ? p.replace(/\\/g, '/') : p; }
// A path git printed, as the platform names it to a person: git writes C:/a/b on Windows, where the name is C:\\a\\b.
export function nativePath(p, platform = process.platform) { return platform === 'win32' ? win32.normalize(p) : p; }

// A file path as one key: portable (see portablePath), without a leading ./, a . segment, a doubled slash or a trailing
// slash, so ./src/a.mjs, src//a.mjs, src/./a.mjs and src/a.mjs are one file. A .. segment is kept as written: what it
// reaches depends on the file system. A path of Windows that starts with two slashes (a share) keeps them.
export function normalPath(p, platform = process.platform) {
  const text = portablePath(String(p ?? '').trim(), platform);
  const share = platform === 'win32' && text.startsWith('//') && !text.startsWith('///') ? '//' : '';
  const root = share || (text.startsWith('/') ? '/' : '');
  const kept = text.split('/').filter((s) => s !== '' && s !== '.');
  return root + (kept.length ? kept.join('/') : root ? '' : '.');
}

// A path as an attachment may name it: relative to the loop root, in plain segments, without whitespace.
function plainRelative(file) {
  const text = String(file ?? '');
  if (text === '') return 'is empty';
  if (/[\s\x00-\x1f]/.test(text)) return 'holds whitespace, which a row cannot carry';
  if (isAbsolute(text) || text.startsWith('/') || text.startsWith('\\') || /^[A-Za-z]:/.test(text)) return 'is not a path relative to the loop root';
  if (text.includes('\\')) return 'holds a backslash: a path is written with /';
  const parts = text.split('/');
  if (parts.includes('..')) return 'climbs out of the loop root with ..';
  if (parts.some((p) => p === '' || p === '.')) return 'is not a plain path: it holds an empty or a . segment';
  return null;
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

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { plainRelative, stamp, today };
