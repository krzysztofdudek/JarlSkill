// The moves: a filing notes what it lacks, status counts per stage, a handover moves a whole lease, a stuck worker reaches
// its director, and next --as lists every move in the order the end of the line comes first, a due takeover and the work
// a review may be offered on included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loop as makeLoop, jarl, refuses, run } from './helpers.mjs';
import { FINDINGS } from './findings.mjs';

const loop = () => makeLoop({ prefix: 'jarl-moves-', via: 'cli', dotGit: false });
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const rows = (root, who) => json(root, 'next', '--as', who, '--all').rows;
const lease = (root, id, worker, branch) => jarl(root, 'set', id, 'in-progress', 'go', '--worker', worker, '--branch', branch, '--by', 'jarl');
const proof = (root, id, line, by) => jarl(root, 'evidence', id, '--line', String(line), '--ran', 'npm test', '--saw', 'ok', '--by', by);

test('new notes an empty Why and a light issue with a read line', () => {
  const root = loop();
  const said = run(root, ['new', 'a thing', '--tier', 'light', '--acceptance', '[read] the docs read well']);
  assert.equal(said.status, 0, said.stderr);
  assert.match(said.stderr, /note: no --why given, so the issue says nothing of why it matters — jarl\.mjs field 1 Why "<text>"/);
  assert.match(said.stderr, /note: 1 is on tier light and has a \[read\] line, which only judgement proves: a light model cannot be trusted with it/);
  const plain = run(root, ['new', 'another', '--tier', 'standard', '--why', 'it matters', '--acceptance', '[test] it works']);
  assert.doesNotMatch(plain.stderr, /no --why given|\[read\] line/);
});

test('status prints one count per stage', () => {
  const root = loop();
  jarl(root, 'new', 'waiting', '--tier', 'light', '--acceptance', '[test] a');            // 1, open
  jarl(root, 'new', 'in work', '--tier', 'light', '--acceptance', '[test] b');            // 2
  jarl(root, 'new', 'to examine', '--tier', 'light', '--acceptance', '[test] c');         // 3
  jarl(root, 'new', 'to merge', '--tier', 'light', '--acceptance', '[test] d');           // 4
  jarl(root, 'new', 'merged', '--tier', 'light', '--acceptance', '[test] e');             // 5
  lease(root, '2', 'w2', 'jarl/2-work');
  lease(root, '3', 'w3', 'jarl/3-work');
  proof(root, '3', 1, 'w3');
  lease(root, '4', 'w4', 'jarl/4-work');
  proof(root, '4', 1, 'w4');
  jarl(root, 'review', '4', 'approve', '--by', 'rev-1', FINDINGS);
  lease(root, '5', 'w5', 'jarl/5-work');
  proof(root, '5', 1, 'w5');
  jarl(root, 'review', '5', 'approve', '--by', 'rev-1', FINDINGS);
  jarl(root, 'merged', '5', '--sha', 'abc1234', '--keep');
  const o = json(root, 'status');
  assert.deepEqual(o.stages, { open: 1, 'in work': 1, 'to examine': 1, changes: 0, 'to merge': 1, merged: 1, done: 0, dropped: 0, deferred: 0 });
  assert.match(jarl(root, 'status'), /^stages: 1 open · 1 in work · 1 to examine · 0 changes · 1 to merge · 1 merged · 0 done · 0 dropped · 0 deferred$/m);
});

test('a handover of one issue of a lease is refused, and ends with the form that moves the whole lease', () => {
  const root = loop();
  jarl(root, 'new', 'one', '--tier', 'light', '--acceptance', '[test] a');
  jarl(root, 'new', 'two', '--tier', 'light', '--acceptance', '[test] b');
  jarl(root, 'set', '1,2', 'in-progress', 'go', '--worker', 'w1', '--branch', 'jarl/1-work', '--by', 'jarl');
  const said = refuses(root, 'set', '2', 'in-progress', 'the worker died', '--worker', 'w2', '--handover', '--by', 'jarl');
  assert.match(said, /^2 shares its lease with 1 \(worker w1, branch jarl\/1-work\): a handover moves the whole lease or nothing, or two workers would hold one branch/);
  assert.equal(said.trim().split('\n').pop(), 'jarl.mjs set "<ids>" in-progress "<why-the-worker-changed>" --worker "<the-new-worker>" --handover --by "<who>"');
  jarl(root, 'set', '1,2', 'in-progress', 'the worker died', '--worker', 'w2', '--handover', '--by', 'jarl');
  assert.equal(rows(root, 'jarl').find((r) => r.id === '1').doer, 'w2');
  assert.equal(rows(root, 'jarl').find((r) => r.id === '2').doer, 'w2');
});

test('a handover of a lease of one issue is taken, in one call or alone', () => {
  const root = loop();
  jarl(root, 'new', 'one', '--tier', 'light', '--acceptance', '[test] a');
  lease(root, '1', 'w1', 'jarl/1-work');
  jarl(root, 'set', '1', 'in-progress', 'the worker died', '--worker', 'w2', '--handover', '--by', 'jarl');
  assert.equal(rows(root, 'jarl').find((r) => r.id === '1').doer, 'w2');
});

test('a stuck question lands on the director of its issue\'s slice, on the jarl with no slice, and on the owner when the asker is the director', () => {
  const root = loop();
  jarl(root, 'goal', '--set', 'Coordinators: odin');
  jarl(root, 'new', 'sliced', '--tier', 'light', '--acceptance', '[test] a', '--tags', 'slice:odin', '--files', 'a.mjs');   // 1
  jarl(root, 'new', 'plain', '--tier', 'light', '--acceptance', '[test] b', '--files', 'b.mjs');                              // 2
  lease(root, '1', 'w1', 'jarl/1-work');
  lease(root, '2', 'w2', 'jarl/2-work');
  jarl(root, 'ask', 'how do I keep the old shape?', '--kind', 'stuck', '--issue', '1', '--by', 'w1');   // a-1
  jarl(root, 'ask', 'the guard must go, may I?', '--kind', 'stuck', '--issue', '2', '--by', 'w2');         // a-2
  jarl(root, 'ask', 'the slice needs a ruling', '--kind', 'stuck', '--issue', '1', '--by', 'odin');          // a-3
  jarl(root, 'ask', 'the loop needs a ruling', '--kind', 'stuck', '--issue', '2', '--by', 'jarl');          // a-4
  const on = (who) => rows(root, who).filter((r) => r.what === 'question').map((r) => r.ask);
  assert.deepEqual(on('odin'), ['1']);
  assert.deepEqual(on('jarl'), ['2']);
  assert.deepEqual(on('owner'), ['3', '4']);
  // The question holds its issue, whoever it is on.
  assert.equal(rows(root, 'odin').find((r) => r.ask === '1').holdsUp.length, 0);
  assert.match(jarl(root, 'next', '--as', 'jarl'), /question \(stuck\) on issue 2/);
});

test('after the round limit next --as shows a takeover as due, with the command that raises it, until one is recorded', () => {
  const root = loop();
  jarl(root, 'goal', '--set', 'Takeover: 2');
  jarl(root, 'new', 'hard', '--tier', 'standard', '--acceptance', '[test] a');
  lease(root, '1', 'w1', 'jarl/1-work');
  proof(root, '1', 1, 'w1');
  jarl(root, 'round', '1', 'red on the edge case');
  assert.equal(rows(root, 'jarl').find((r) => r.id === '1').what, 'worker');
  proof(root, '1', 1, 'w1');
  jarl(root, 'round', '1', 'red again');
  const row = rows(root, 'jarl').find((r) => r.id === '1');
  assert.equal(row.what, 'takeover');
  assert.match(row.says, /takeover is due/);
  assert.match(row.command, /^jarl\.mjs set 1 in-progress "<why-the-worker-changed>" --worker "<the-new-worker>" --model "<model-id>" --handover/);
  jarl(root, 'set', '1', 'in-progress', 'fresh worker, one tier up', '--worker', 'w2', '--handover', '--by', 'jarl');
  assert.notEqual(rows(root, 'jarl').find((r) => r.id === '1').what, 'takeover');
});

test('among moves of equal idleness and hold-up, next --as lists merge before review before rework before a new start', () => {
  const root = loop();
  jarl(root, 'new', 'new start', '--tier', 'light', '--acceptance', '[test] d', '--files', 'd.mjs');         // 1
  jarl(root, 'new', 'to rework', '--tier', 'light', '--acceptance', '[test] c', '--files', 'c.mjs');         // 2
  jarl(root, 'new', 'to review', '--tier', 'light', '--acceptance', '[test] b', '--files', 'b.mjs');         // 3
  jarl(root, 'new', 'to merge', '--tier', 'light', '--acceptance', '[test] a', '--files', 'a.mjs');          // 4
  lease(root, '4', 'w1', 'jarl/4-merge');
  proof(root, '4', 1, 'w1');
  jarl(root, 'review', '4', 'approve', '--by', 'rev-1', FINDINGS);
  lease(root, '3', 'w2', 'jarl/3-review');
  proof(root, '3', 1, 'w2');
  lease(root, '2', 'w3', 'jarl/2-rework');
  proof(root, '2', 1, 'w3');
  jarl(root, 'review', '2', 'changes', '--by', 'rev-1', 'Important: the edge case fails');
  assert.deepEqual(rows(root, 'jarl').map((r) => r.what), ['merge', 'review', 'changes', 'ready']);
});

test('next --as offers no lease for an issue with no line, and says to write one first', () => {
  const root = loop();
  jarl(root, 'new', 'a lined issue', '--tier', 'light', '--acceptance', '[test] a', '--files', 'a.mjs');    // 1
  jarl(root, 'new', 'an unlined issue', '--tier', 'light', '--files', 'b.mjs');                              // 2
  const found = rows(root, 'jarl');
  const [lined, unlined] = ['1', '2'].map((id) => found.find((r) => r.id === id));
  assert.equal(lined.what, 'ready');
  assert.equal(unlined.what, 'no-line');
  assert.match(unlined.says, /no acceptance line/);
  assert.match(unlined.command, /^jarl\.mjs field 2 Acceptance "<test-check-compare-read-or-owner-line>"/);
  assert.doesNotMatch(unlined.command, /in-progress/);
});

test('a review is offered for a branch only when every issue on it has the worker\'s rows for its test, compare and stated check lines', () => {
  const root = loop();
  const compare = '[compare] the report is unchanged · by: node report.mjs';
  jarl(root, 'new', 'one', '--tier', 'light', '--acceptance', '[test] a', '--files', 'a.mjs');                         // 1
  jarl(root, 'new', 'two', '--tier', 'light', '--acceptance', compare, '--acceptance', '[check] the suite passes · by: npm test', '--acceptance', '[check] the declared check', '--files', 'b.mjs');   // 2
  jarl(root, 'set', '1,2', 'in-progress', 'go', '--worker', 'w1', '--branch', 'jarl/1-pack', '--by', 'jarl');
  proof(root, '1', 1, 'w1');
  let found = rows(root, 'jarl');
  assert.ok(!found.some((r) => r.what === 'review'), 'no review while the package misses rows');
  assert.equal(found.find((r) => r.id === '1').what, 'worker');
  assert.match(found.find((r) => r.id === '1').says, /2's rows? .*line/);
  proof(root, '2', 2, 'w1');
  found = rows(root, 'jarl');
  assert.ok(!found.some((r) => r.what === 'review'), 'a compare line still misses its rows');
  assert.match(found.find((r) => r.id === '2').says, /lines? 1/);
  jarl(root, 'evidence', '2', '--line', '1', '--ran', 'node report.mjs', '--saw', 'same', '--by', 'w1');
  // The stated check has a row, the compare line one (two are the gate's ask, not the offer's), and the declared check asks for none.
  found = rows(root, 'jarl');
  const review = found.find((r) => r.what === 'review');
  assert.ok(review, 'offered once every issue has the worker\'s rows');
  assert.deepEqual(review.ids, ['1', '2']);
});
