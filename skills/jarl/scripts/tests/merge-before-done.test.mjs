// A code issue is merged before it is done: done refuses an issue whose lease records a Branch while no merge is
// recorded, ending with the form of merged, and status flags a closed one that holds no merge by the same rule. The
// approve's reply names the same order. An issue with no Branch, such as one in a loop with no repository, has nothing
// to merge and closes on its proof and its approve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jarl, refuses, loop as makeLoop } from './helpers.mjs';

const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const files = (root) => Object.fromEntries(readdirSync(join(root, '.jarl'), { recursive: true }).filter((f) => /\.md$/.test(f)).map((f) => [f, readFileSync(join(root, '.jarl', f), 'utf8')]));
const ready = (root, { branch, dotGit = true } = {}) => {
  const root2 = root ?? makeLoop({ prefix: 'jarl-merge-before-done-', via: 'cli', dotGit });
  jarl(root2, 'new', 'the fix', '--acceptance', 'it works');
  jarl(root2, 'set', '1', 'in-progress', '--worker', 'w1', ...(branch ? ['--branch', branch] : []), '--by', 'jarl');
  jarl(root2, 'evidence', '1', '--ran', 'npm test', '--saw', '12 pass, 0 fail', '--by', 'w1');
  return root2;
};

test('done refuses a code issue with no merge recorded, ending with the form of merged, and writes nothing', () => {
  const root = ready(undefined, { branch: 'jarl/1-fix' });
  const approve = json(root, 'review', '1', 'approve', '--by', 'rev-fresh', 'read the diff and the test, nothing found');
  assert.match(approve.next, /merged 1 --sha "<sha>".* — then .*set 1 done/, 'the reply names the merge before done');
  const before = files(root);
  const said = refuses(root, 'set', '1', 'done', 'all green', '--by', 'jarl');
  assert.match(said, /^1 carries code \(its lease records Branch jarl\/1-fix\) and records no merge — a code issue is merged before it is done/, said);
  assert.match(said, /\njarl\.mjs merged "<ids>" --sha "<sha>"\n$/, said);
  assert.deepEqual(files(root), before, 'a refused done writes nothing');
  jarl(root, 'merged', '1', '--sha', 'abc1234', '--by', 'jarl');
  jarl(root, 'set', '1', 'done', 'merged and green', '--by', 'jarl');
  assert.deepEqual(json(root, 'status').closedGate, [], 'status and done agree: a merged code issue closes clean');
});

test('an issue with no Branch in a loop with no repository has nothing to merge: done closes it on its proof and its approve', () => {
  const root = ready(undefined, { dotGit: false });
  jarl(root, 'review', '1', 'approve', '--by', 'jarl', 'read the change and the row, nothing found');
  jarl(root, 'set', '1', 'done', 'the row and the approve are there', '--by', 'jarl');
  assert.equal(json(root, 'show', '1').status, 'done');
  assert.deepEqual(json(root, 'status').closedGate, []);
});

test('a code issue with a branch in a loop with no repository is merged before it is done too', () => {
  const root = ready(undefined, { branch: 'jarl/1-fix', dotGit: false });
  jarl(root, 'review', '1', 'approve', '--by', 'rev-fresh', 'read the diff and the test, nothing found');
  assert.match(refuses(root, 'set', '1', 'done', 'all green', '--by', 'jarl'), /records no merge — a code issue is merged before it is done/);
  jarl(root, 'merged', '1', '--sha', 'abc1234', '--by', 'jarl');
  jarl(root, 'set', '1', 'done', 'merged', '--by', 'jarl');
  assert.deepEqual(json(root, 'status').closedGate, []);
});
