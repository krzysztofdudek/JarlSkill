// Where a loop is: its root, its directory and its issues, a path as the record stores it and as the disk holds it,
// and the clock of its lines.

import { existsSync, realpathSync } from 'node:fs';
import { join, resolve, dirname, basename, isAbsolute } from 'node:path';
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
