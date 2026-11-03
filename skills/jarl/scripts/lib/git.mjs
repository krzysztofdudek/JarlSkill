// Git and gh: the one place the library runs a process.

import { execFileSync } from 'node:child_process';

// ---- git: the one place a process is run ----------------------------------------------------------

// Every process Jarl starts goes through exec: git, and the gh that tips asks about CI. A binary ending in .js, .mjs or
// .cjs is run by process.execPath, so a stub works the same on every OS: Windows runs no shebang script, and no .cmd shim
// without a shell.
function exec(bin, args, opts) {
  return /\.[cm]?js$/i.test(bin) ? execFileSync(process.execPath, [bin, ...args], opts) : execFileSync(bin, args, opts);
}
// What git prints in `root`, trimmed; null when it fails.
function git(root, args) {
  try { return exec('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: GIT_OUTPUT }).trim(); } catch { return null; }
}
// The most a git command may print to the library: a diff of a large branch is read whole.
const GIT_OUTPUT = 256 * 1024 * 1024;
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

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { git, gitHere, gitRun, runGh };
