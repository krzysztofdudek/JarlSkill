// The coordinator's own slips as a statistic: report counts, per writer, the reopens after done and the retractions that
// writer recorded, read from the name each line of the log carries (the --by of its call), and says which writers are
// coordinators of the loop. A refused call writes nothing, so nothing of it is counted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jarl, refuses, loop as makeLoop } from './helpers.mjs';

const loop = () => makeLoop({ prefix: 'jarl-slips-', via: 'cli', dotGit: false });
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const logOf = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');

// Two issues carried to done, one reopened by a coordinator, rows and an approve retracted by three writers.
function loopWithSlips() {
  const root = loop();
  jarl(root, 'goal', '--set', 'Coordinators: odin');
  for (const t of ['one', 'two']) jarl(root, 'new', t, '--acceptance', `[read] ${t} is done`);
  for (const id of ['1', '2']) {
    jarl(root, 'set', id, 'in-progress', 'start', '--worker', `w${id}`, '--by', 'jarl');
    jarl(root, 'evidence', id, '--line', '1', '--ran', 'npm test', '--saw', 'ok');
    jarl(root, 'review', id, 'approve', 'read the change and the test, both fine', '--by', 'rev-a');
  }
  jarl(root, 'set', '1', 'done', 'proved and approved', '--by', 'jarl');
  jarl(root, 'set', '1', 'open', 'a case was missed', '--by', 'odin');
  jarl(root, 'retract', '1', '1', 'the row was run on the wrong branch', '--by', 'odin');
  jarl(root, 'retract', '2', 'review', 'the approve came before the last change', '--by', 'jarl');
  jarl(root, 'retract', '2', '1', 'the row was copied from another issue', '--by', 'rev-a');
  return root;
}

test('report counts the reopens after done and the retractions per writer, and marks a writer that is no coordinator', () => {
  const root = loopWithSlips();
  const { slips } = json(root, 'report').metrics;
  assert.deepEqual(slips.reopens, [{ writer: 'odin', coordinator: true, count: 1, issues: ['1'] }]);
  assert.deepEqual(slips.retractions, [
    { writer: 'jarl', coordinator: true, count: 1, issues: ['2'] },
    { writer: 'odin', coordinator: true, count: 1, issues: ['1'] },
    { writer: 'rev-a', coordinator: false, count: 1, issues: ['2'] },
  ]);
  const text = jarl(root, 'report', '--metrics');
  assert.match(text, /^reopened after done, per writer: odin 1 \(1\)$/m);
  assert.match(text, /^retracted, per writer: jarl 1 \(2\) · odin 1 \(1\) · rev-a 1 \(2\), not a coordinator$/m);
});

test('a refused reopen or retraction writes nothing and is not counted', () => {
  const root = loopWithSlips();
  const before = json(root, 'report').metrics.slips;
  const log = logOf(root);
  refuses(root, 'set', '2', 'open', '<why>', '--by', 'odin');
  refuses(root, 'retract', '2', '9', 'there is no ninth row', '--by', 'odin');
  refuses(root, 'retract', '1', 'review', 'the approve was spent by the reopen', '--by', '<who>');
  assert.equal(logOf(root), log, 'a refusal writes no log line');
  assert.deepEqual(json(root, 'report').metrics.slips, before);
});

test('a reopen or a retraction whose call named nobody is counted as unnamed, and a loop with neither says none', () => {
  const root = loop();
  jarl(root, 'new', 'one', '--acceptance', '[read] one is done');
  assert.match(jarl(root, 'report', '--metrics'), /^reopened after done, per writer: none$/m);
  assert.match(jarl(root, 'report', '--metrics'), /^retracted, per writer: none$/m);
  jarl(root, 'set', '1', 'in-progress', 'start', '--worker', 'w1');
  jarl(root, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'ok');
  jarl(root, 'review', '1', 'approve', 'read the change and the test, both fine', '--by', 'rev-a');
  jarl(root, 'set', '1', 'done', 'proved and approved');
  jarl(root, 'set', '1', 'open', 'a case was missed');
  assert.deepEqual(json(root, 'report').metrics.slips.reopens, [{ writer: null, coordinator: false, count: 1, issues: ['1'] }]);
  assert.match(jarl(root, 'report', '--metrics'), /^reopened after done, per writer: unnamed 1 \(1\)$/m);
});
