// How a loop's own files sit in git: the ignore file of each mode, and the merge setup of a committed loop.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { gitHere } from './git.mjs';
import { jarlDir } from './where.mjs';
import { readText, writeAtomic } from './files.mjs';
import { DECISIONS_FILE, LOG_FILE } from './journal.mjs';

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

export const JARL_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'jarl.mjs');

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

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { guardedDriver };
