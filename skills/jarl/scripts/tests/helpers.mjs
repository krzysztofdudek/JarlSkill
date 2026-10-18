// What the test files share: one spawn of the command line, the calls built on it, and the loops and repositories a
// test sets up. Every spawn carries an explicit timeout, so a hung process fails the test instead of waiting for it.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../record.mjs';
import { NO_EXCLUDES } from './portable.mjs';

export const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
export const SPAWN_TIMEOUT = 120_000;

// One run of the command line against the loop in `root`: the result of spawnSync, both streams as written. `env` is
// added to the environment of the process.
export function spawnJarl(root, args, { env, timeout = SPAWN_TIMEOUT } = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8', timeout, ...(env ? { env: { ...process.env, ...env } } : {}) });
}
// The same, as { status, stdout, stderr } with both streams trimmed.
export function run(root, args, opts) {
  const r = spawnJarl(root, args, opts);
  return { status: r.status, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}
// The result of a call that succeeded; a failure throws with what it said, and carries its status, stdout and stderr.
export function jarlResult(root, args, opts) {
  const r = run(root, args, opts);
  if (r.status !== 0) throw Object.assign(new Error(`jarl ${args.join(' ')} failed: ${r.stderr}`), r);
  return r;
}
// What the command prints, trimmed.
export function jarl(root, ...args) { return jarlResult(root, args).stdout; }
// What the command says when it refuses, as written (with its closing newline); a call that succeeds fails the test.
export function refuses(root, ...args) {
  const r = spawnJarl(root, args);
  assert.notEqual(r.status, 0, `expected a refusal: ${args.join(' ')}`);
  return r.stderr ?? '';
}

// A directory with a loop in it. `dotGit` makes it a checkout (an empty .git); `via` opens the loop through the library
// (the default) or through the command line.
export function loop({ prefix = 'jarl-loop-', goal = 'goal', dotGit = true, via = 'library', initFlags = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  if (dotGit) mkdirSync(join(root, '.git'));
  if (via === 'cli') jarl(root, 'init', goal, ...initFlags);
  else R.initLoop(root, goal);
  return root;
}

// A git repository with one commit (a.txt), on `branch`; `g` runs git in it and returns what it prints.
export function gitRepo({ prefix = 'jarl-git-', branch = 'feature' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: SPAWN_TIMEOUT });
  g('init', '-q', '-b', branch);
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  g('config', 'core.excludesFile', NO_EXCLUDES);
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  g('add', '-A'); g('commit', '-qm', 'base');
  return { dir, g };
}
