// close never removes deferred work without saying so: in the default mode it refuses while an issue is deferred and names
// the two ways forward, archive and close --force; --force says what it removed; a permanent loop keeps its directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { jarl, jarlResult, loop as makeLoop, refuses } from './helpers.mjs';

// A loop with four issues, the fourth deferred and the others dropped, so nothing is open.
function deferredLoop(initFlags = []) {
  const root = makeLoop({ prefix: 'jarl-close-deferred-', via: 'cli', initFlags });
  for (let k = 1; k <= 4; k += 1) jarl(root, 'new', `issue ${k}`, '--acceptance', 'it works');
  for (const id of [1, 2, 3]) jarl(root, 'set', String(id), 'dropped', 'not needed');
  jarl(root, 'set', '4', 'deferred', 'waits for the owner');
  return root;
}
const archives = (root) => (existsSync(join(root, '.jarl', 'archive')) ? readdirSync(join(root, '.jarl', 'archive')) : []);

test('close in the default mode refuses while an issue is deferred, names it and the two ways forward, and removes nothing', () => {
  const root = deferredLoop();
  const said = refuses(root, 'close');
  assert.match(said, /004/);
  assert.match(said, /archive/);
  assert.match(said, /close --force/);
  assert.ok(existsSync(join(root, '.jarl')), 'the loop is still on disk');
  assert.match(jarl(root, 'show', '4'), /deferred/, 'issue 4 is still on disk');
});

test('close --force removes the loop and names the deferred issues as removed, never as still waiting', () => {
  const root = deferredLoop();
  const out = jarlResult(root, ['close', '--force']);
  assert.match(out.stdout, /^removed /);
  assert.match(out.stdout, /1 deferred removed with the loop: 004/);
  assert.doesNotMatch(`${out.stdout}\n${out.stderr}`, /still waiting/);
  assert.equal(existsSync(join(root, '.jarl')), false);
});

test('archive keeps the deferred issue under .jarl/archive, and init and close of a later loop leave the archive in place', () => {
  const root = deferredLoop();
  jarl(root, 'archive', 'first round');
  const [name] = archives(root);
  assert.match(name, /^\d{4}\.\d{2}\.\d{2}-first-round$/);
  assert.ok(readdirSync(join(root, '.jarl', 'archive', name, 'issues')).some((f) => f.startsWith('004-')), 'issue 4 is in the archive');
  jarl(root, 'init', 'second round');
  assert.deepEqual(archives(root), [name], 'init leaves the archive in place');
  const out = jarl(root, 'close');
  assert.match(out, /^removed .*archive\/ is left in place/);
  assert.deepEqual(archives(root), [name], 'close leaves the archive in place');
  assert.ok(readdirSync(join(root, '.jarl', 'archive', name, 'issues')).some((f) => f.startsWith('004-')), 'issue 4 is still in the archive');
  assert.equal(existsSync(join(root, '.jarl', 'goal.md')), false, 'the live loop is gone');
});

test('a default-mode loop with no deferred issue closes as it did', () => {
  const root = makeLoop({ prefix: 'jarl-close-plain-', via: 'cli' });
  jarl(root, 'new', 'one', '--acceptance', 'it works');
  jarl(root, 'set', '1', 'dropped', 'not needed');
  const out = jarl(root, 'close');
  assert.match(out, /^removed \S+\.jarl$/);
  assert.equal(existsSync(join(root, '.jarl')), false);
});

test('a permanent loop with a deferred issue keeps its directory and says the issue still waits', () => {
  const root = deferredLoop(['--permanent']);
  const out = jarl(root, 'close');
  assert.match(out, /closed as a permanent record/);
  assert.match(out, /1 deferred still waiting: 004/);
  assert.ok(existsSync(join(root, '.jarl')));
});
