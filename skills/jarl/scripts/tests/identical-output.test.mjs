// A change meant to alter nothing carries the tag identical-output and records its comparison of the output before and
// after as a proof row, the command and what it printed. It keeps its fresh review, which may be a light one that checks
// the comparison covers everything the change touched: an approve by a model below the worker's is said to be enough for
// it, where on any other issue it is said not to clear. The comparison never stands in for the review: done refuses such
// an issue with no approve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, jarl, refuses, run } from './helpers.mjs';

const logText = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');

// A loop with two model lines and two changes leased on the strong model, each with its comparison recorded as a proof row:
// the first tagged as meant to alter nothing, the second the same change without the tag.
function refactorLoop() {
  const { dir } = gitRepo({ prefix: 'jarl-identical-' });
  jarl(dir, 'init', 'g');
  jarl(dir, 'goal', '--set', 'Model (light): m-light');
  jarl(dir, 'goal', '--set', 'Model (strong): m-strong');
  for (const [title, file, tags] of [['split the renderer', 'render.mjs', ['--tags', 'identical-output']], ['split the parser', 'parse.mjs', []]]) {
    jarl(dir, 'new', title, '--tier', 'standard', '--files', file, '--acceptance', 'the output is byte for byte the same', ...tags);
  }
  for (const id of ['1', '2']) {
    jarl(dir, 'set', id, 'in-progress', 'go', '--branch', `jarl/${id}-split`, '--worker', `w${id}`, '--model', 'm-strong');
    jarl(dir, 'evidence', id, '--ran', 'node render.mjs > after.txt && cmp before.txt after.txt', '--saw', 'cmp printed nothing, exit 0');
  }
  return dir;
}

test('done refuses a change meant to alter nothing that holds its comparison and no approve, and writes nothing', () => {
  const root = refactorLoop();
  const before = logText(root);
  const said = refuses(root, 'set', '1', 'done', 'the output is the same');
  assert.match(said, /^1 has no approving review newer than its last round or reopen/);
  assert.match(said.trim().split('\n').pop(), /^jarl\.mjs review "<ids>" "<verdict>"/);
  assert.equal(logText(root), before);
});

test('a light approve of a change meant to alter nothing is said to be enough, and the same approve of any other change is not', () => {
  const root = refactorLoop();
  const tagged = run(root, ['review', '1', 'approve', '--by', 'rev-1', '--model', 'm-light', 'the comparison covers every file the change touched']);
  assert.equal(tagged.status, 0, tagged.stderr);
  assert.doesNotMatch(tagged.stderr, /ranks below the worker's model/);
  assert.match(tagged.stderr, /1: a change meant to alter nothing \(tag identical-output\): a light review may clear it, one that checks the comparison of the output before and after covers everything the change touched/);
  const plain = run(root, ['review', '2', 'approve', '--by', 'rev-2', '--model', 'm-light', 'the comparison covers every file the change touched']);
  assert.match(plain.stderr, /2: m-light ranks below the worker's model \(m-strong\)/);
});

test('the briefs of a change meant to alter nothing say what its worker records and what its reviewer checks', () => {
  const root = refactorLoop();
  assert.match(jarl(root, 'brief', '1'), /^note: 1 is a change meant to alter nothing \(tag identical-output\): its comparison of the output before and after is a proof row, the command and what it printed — jarl\.mjs evidence 1 --ran "<command>" --saw "<what-it-printed>"$/m);
  assert.match(jarl(root, 'brief', '1', '--role', 'reviewer'), /^note: 1 is a change meant to alter nothing \(tag identical-output\): its review may be a light one, and it checks that the comparison in its proof rows covers everything the change touched; the comparison never stands in for the review$/m);
  assert.doesNotMatch(jarl(root, 'brief', '2', '--role', 'reviewer'), /meant to alter nothing \(tag/);
});
