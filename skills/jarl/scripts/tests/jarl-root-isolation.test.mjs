// A shell that exports JARL_ROOT reaches no test: the shared helpers take the variable out of the environment of every test
// process, so a call a test makes without --root reaches the loop of the checkout it runs in, and never the loop the
// variable names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPAWN_TIMEOUT } from './helpers.mjs';
import * as R from '../record.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/no-root-calls.mjs', import.meta.url));
const checkoutWithLoop = (goal) => { const dir = mkdtempSync(join(tmpdir(), 'jarl-isolation-')); mkdirSync(join(dir, '.git')); R.initLoop(dir, goal); return dir; };
const issues = (root) => (existsSync(join(root, '.jarl', 'issues')) ? readdirSync(join(root, '.jarl', 'issues')).length : 0);

test('a call a test makes without --root, in a process whose shell exports JARL_ROOT, reaches the loop of its checkout and leaves the decoy untouched', () => {
  const decoy = checkoutWithLoop('the decoy');
  const work = checkoutWithLoop('the work');
  const decoyLog = readFileSync(join(decoy, '.jarl', 'log.md'), 'utf8');
  const r = spawnSync(process.execPath, [FIXTURE, work], { encoding: 'utf8', timeout: SPAWN_TIMEOUT, env: { ...process.env, JARL_ROOT: decoy } });
  assert.equal(r.status, 0, r.stderr);
  const seen = JSON.parse(r.stdout);
  assert.equal(seen.inherited, null, 'the helpers took JARL_ROOT out of the environment');
  assert.equal(seen.spawned, 0);
  assert.equal(seen.tool, false);
  assert.equal(issues(work), process.platform === 'win32' ? 2 : 3, 'every call filed into the loop of its checkout');
  assert.equal(readFileSync(join(decoy, '.jarl', 'log.md'), 'utf8'), decoyLog, 'the decoy\'s log is untouched');
  assert.equal(issues(decoy), 0, 'the decoy holds no issue');
});
