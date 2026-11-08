// The moves: a filing notes what it lacks, status counts per stage, a handover moves a whole lease, a stuck worker reaches
// its director, and next --as lists every move in the order the end of the line comes first, a due takeover and the work
// a review may be offered on included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loop as makeLoop, gitRepo, jarl, refuses, run } from './helpers.mjs';
import { sh } from './portable.mjs';
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

// A git repository on branch `feature` holding the loop, and a worker branch with one commit in a worktree beside it.
function repo() {
  const { dir, g } = gitRepo({ prefix: 'jarl-moves-git-', branch: 'feature' });
  jarl(dir, 'init', 'goal');
  return { dir, g };
}
function branchWith(dir, branch, file) {
  const wt = mkdtempSync(join(tmpdir(), 'jarl-moves-wt-'));
  sh(dir, `git worktree add -q -b ${branch} ${wt} feature`);
  sh(wt, `echo change >> ${file} && git add -A && git commit -qm "work on ${branch}"`);
  return wt;
}
const shaOf = (g, ref) => g('rev-parse', ref).trim();
const queue = (dir) => json(dir, 'resume').queue;
const nextGroups = (root) => json(root, 'next', '--all');

test('the four views of a scenario agree: a package partly sent back after its merge lists only the issue whose merge was spent', () => {
  const { dir, g } = repo();
  jarl(dir, 'new', 'one', '--tier', 'light', '--acceptance', '[test] a');
  jarl(dir, 'new', 'two', '--tier', 'light', '--acceptance', '[test] b');
  jarl(dir, 'set', '1,2', 'in-progress', 'go', '--worker', 'w1', '--branch', 'jarl/1-pack', '--by', 'jarl');
  branchWith(dir, 'jarl/1-pack', 'a.txt');
  jarl(dir, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'pass', '--by', 'w1');
  jarl(dir, 'evidence', '2', '--line', '1', '--ran', 'npm test', '--saw', 'pass', '--by', 'w1');
  jarl(dir, 'review', '1,2', 'approve', '--by', 'rev-1', FINDINGS);
  sh(dir, 'git merge -q --no-ff jarl/1-pack -m merge');
  jarl(dir, 'merged', '1,2', '--sha', shaOf(g, 'HEAD'), '--keep');
  jarl(dir, 'round', '1', 'red in the merged result');
  jarl(dir, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'pass', '--by', 'w1');
  jarl(dir, 'review', '1', 'approve', '--by', 'rev-2', FINDINGS);
  const row = queue(dir).repos[0].rows.find((r) => r.branch === 'jarl/1-pack');
  assert.deepEqual(row.issues, ['1'], 'only the issue whose merge was spent');
  const [one, two] = ['1', '2'].map((id) => rows(dir, 'jarl').find((r) => r.id === id));
  assert.match(one.says, /merge it again/);
  assert.equal(two.what, 'close');
  assert.ok(!nextGroups(dir).some((r) => r.id === '1' && r.ready), 'not offered as new');
});

test('the four views agree: an approved branch its base already holds, with no merge on record, is a row of the queue and a move to record the merge', () => {
  const { dir, g } = repo();
  jarl(dir, 'new', 'one', '--tier', 'light', '--acceptance', '[test] a');
  lease(dir, '1', 'w1', 'jarl/1-landed');
  branchWith(dir, 'jarl/1-landed', 'a.txt');
  jarl(dir, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'pass', '--by', 'w1');
  jarl(dir, 'review', '1', 'approve', '--by', 'rev-1', FINDINGS);
  sh(dir, 'git merge -q --no-ff jarl/1-landed -m merge');
  const row = queue(dir).repos[0].rows.find((r) => r.branch === 'jarl/1-landed');
  assert.deepEqual(row.issues, ['1']);
  assert.equal(row.recordOnly, true);
  assert.match(row.recordWhy, /no merge is on record/);
  const move = rows(dir, 'jarl').find((r) => r.id === '1');
  assert.equal(move.what, 'merge');
  assert.match(move.says, /its branch is in its base already, with no merge on record; record the merge/);
  assert.match(move.command, /^jarl\.mjs merged 1 --sha "<sha>" --ran "<command>" --saw "<what-it-printed>"/);
});

test('the four views agree: an open question on a parent whose sub-issues are all dropped holds it in every view', () => {
  const root = loop();
  jarl(root, 'new', 'the parent', '--tier', 'light', '--acceptance', '[read] the whole');
  jarl(root, 'new', 'its child', '--tier', 'light', '--acceptance', '[test] a');
  jarl(root, 'field', '2', 'Parent', '1');
  jarl(root, 'set', '2', 'dropped', 'not needed', '--by', 'jarl');
  jarl(root, 'ask', 'should this exist at all?', '--kind', 'stuck', '--issue', '1');
  assert.ok(nextGroups(root).some((r) => r.id === '1' && r.group === 'held-by-question'), 'next --all shows it held');
  assert.ok(!rows(root, 'jarl').some((r) => r.id === '1' && r.what === 'check'), 'next --as offers no check of it');
  assert.ok(rows(root, 'owner').some((r) => r.what === 'question' && r.holdsUp.includes('1')), 'the question holds it up');
});

test('the four views agree: a parent with an After and an open question shows both, and the question holds it up', () => {
  const root = loop();
  jarl(root, 'new', 'first', '--tier', 'light', '--acceptance', '[test] a', '--files', 'a.mjs');  // 1
  jarl(root, 'new', 'the parent', '--tier', 'light', '--acceptance', '[read] the whole', '--after', '1');  // 2
  jarl(root, 'new', 'its child', '--tier', 'light', '--acceptance', '[test] a', '--files', 'b.mjs');  // 3
  jarl(root, 'field', '3', 'Parent', '2');
  jarl(root, 'ask', 'do we still want this?', '--kind', 'stuck', '--issue', '2');
  const groups = nextGroups(root).filter((r) => r.id === '2').map((r) => r.group);
  assert.deepEqual(groups.sort(), ['held-by-question', 'waiting-after']);
  const question = rows(root, 'owner').find((r) => r.what === 'question');
  assert.ok(question.holdsUp.includes('2'), `holds up: ${question.holdsUp}`);
  assert.ok(!rows(root, 'jarl').some((r) => r.id === '2'), 'nothing offered while it waits');
});

test('a goal line Merger (<slice>): <name> is accepted and read: next --as and the merge queue give each merger the approved work of its target branch', () => {
  const { dir, g } = repo();
  jarl(dir, 'goal', '--set', 'Coordinators: odin');
  assert.match(jarl(dir, 'goal', '--set', 'Merger (odin): mimir'), /^goal line added: Merger \(odin\): mimir$/);
  assert.equal(jarl(dir, 'verify').includes('Merger (odin)'), false, 'verify reads it clean');
  jarl(dir, 'new', 'sliced', '--tier', 'light', '--acceptance', '[test] a', '--tags', 'slice:odin', '--files', 'a.txt');   // 1
  jarl(dir, 'new', 'plain', '--tier', 'light', '--acceptance', '[test] b', '--files', 'b.txt');                              // 2
  g('branch', 'jarl/slice-odin');
  lease(dir, '1', 'w1', 'jarl/1-sliced');
  lease(dir, '2', 'w2', 'jarl/2-plain');
  branchWith(dir, 'jarl/1-sliced', 'a.txt');
  branchWith(dir, 'jarl/2-plain', 'b.txt');
  for (const id of ['1', '2']) jarl(dir, 'evidence', id, '--line', '1', '--ran', 'npm test', '--saw', 'pass', '--by', id === '1' ? 'w1' : 'w2');
  jarl(dir, 'review', '1', 'approve', '--by', 'rev-1', FINDINGS);
  jarl(dir, 'review', '2', 'approve', '--by', 'rev-1', FINDINGS);
  assert.deepEqual(rows(dir, 'mimir').filter((r) => r.what === 'merge').map((r) => r.id), ['1'], 'the slice\'s merger takes the slice\'s work');
  assert.deepEqual(rows(dir, 'jarl').filter((r) => r.what === 'merge').map((r) => r.id), ['2'], 'the default merger takes the rest');
  const q = queue(dir);
  const into = (base) => q.repos.find((r) => r.base === base);
  assert.deepEqual(into('jarl/slice-odin').rows.map((r) => r.issues), [['1']]);
  assert.equal(into('jarl/slice-odin').merger, 'mimir');
  assert.equal(into('jarl/slice-odin').slice, 'odin');
  assert.deepEqual(into('feature').rows.map((r) => r.issues), [['2']]);
  assert.match(jarl(dir, 'resume'), /\[.*\] into jarl\/slice-odin \(merger mimir\)/);

  // The slice's merger lands the work on the integration branch, in a worktree of its own, and the integration branch then
  // goes to the feature branch as a merge with its check.
  const wt = mkdtempSync(join(tmpdir(), 'jarl-moves-wt-'));
  sh(dir, `git worktree add -q ${wt} jarl/slice-odin`);
  sh(wt, 'git merge -q --no-ff jarl/1-sliced -m merge');
  jarl(dir, 'merged', '1', '--sha', shaOf((...a) => execFileSync('git', a, { cwd: wt, encoding: 'utf8', timeout: 120_000 }), 'HEAD'), '--keep');
  assert.ok(!rows(dir, 'mimir').some((r) => r.what === 'merge'), 'nothing left for the slice merger');
  const integration = rows(dir, 'jarl').find((r) => r.integration);
  assert.ok(integration, 'the default merger gets the integration branch');
  assert.equal(integration.what, 'merge');
  assert.equal(integration.branch, 'jarl/slice-odin');
  assert.deepEqual(integration.ids, ['1']);
  assert.match(integration.says, /the integration branch of the slice odin .*merge it into feature and run its check/);
  assert.match(integration.command, /merged 1 --sha "<sha>" --ran "<command>" --saw "<what-it-printed>"/);
  const row = queue(dir).repos.find((r) => r.base === 'feature').rows.find((r) => r.branch === 'jarl/slice-odin');
  assert.equal(row.integration, true);
  assert.deepEqual(row.issues, ['1']);
  sh(dir, 'git merge -q --no-ff jarl/slice-odin -m "merge the slice"');
  assert.ok(!rows(dir, 'jarl').some((r) => r.integration), 'landed: nothing left to merge');
});

test('a Merger (<slice>) line for a slice the loop does not have is refused, and a bare Merger line still names one holder', () => {
  const root = loop();
  jarl(root, 'goal', '--set', 'Coordinators: odin');
  assert.match(refuses(root, 'goal', '--set', 'Merger (thor): mimir'), /^Merger \(thor\) names no slice of this loop: its slices are odin/);
  assert.match(refuses(root, 'goal', '--set', 'Merger (odin): a, b'), /a Merger line names one holder/);
});

test('while a slice\'s integration branch does not exist, its work is the feature branch\'s merger\'s alone, in next --as and the queue', () => {
  const { dir } = repo();
  jarl(dir, 'goal', '--set', 'Coordinators: odin');
  jarl(dir, 'goal', '--set', 'Merger (odin): mimir');
  jarl(dir, 'new', 'sliced', '--tier', 'light', '--acceptance', '[test] a', '--tags', 'slice:odin', '--files', 'a.txt');
  lease(dir, '1', 'w1', 'jarl/1-sliced');
  branchWith(dir, 'jarl/1-sliced', 'a.txt');
  jarl(dir, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'pass', '--by', 'w1');
  jarl(dir, 'review', '1', 'approve', '--by', 'rev-1', FINDINGS);
  assert.ok(!rows(dir, 'mimir').some((r) => r.what === 'merge'), 'not on the slice\'s merger');
  const move = rows(dir, 'jarl').find((r) => r.what === 'merge');
  assert.deepEqual([move.id, move.target, move.raise.command], ['1', undefined, 'jarl.mjs brief --role merger']);
  const q = queue(dir);
  assert.deepEqual(q.repos.map((r) => r.base), ['feature']);
  assert.deepEqual(q.repos[0].rows.map((r) => r.issues), [['1']]);
});

test('the idle row of a lease of several issues prints the form that moves the whole lease', async () => {
  const W = await import('../lib/where.mjs');
  const L = await import('../jarl-lib.mjs');
  const root = loop();
  jarl(root, 'new', 'one', '--tier', 'light', '--acceptance', '[test] a');
  jarl(root, 'new', 'two', '--tier', 'light', '--acceptance', '[test] b');
  jarl(root, 'set', '1,2', 'in-progress', 'go', '--worker', 'w1', '--branch', 'jarl/1-pack', '--by', 'jarl');
  W.setClock(Date.now() + 40 * 60_000);
  try {
    const row = L.cmdNextAs(root, { as: 'jarl', all: true }).rows.find((r) => r.what === 'idle');
    assert.match(row.command, /^jarl\.mjs set 1,2 in-progress /);
    assert.match(row.command, /--handover$/);
  } finally { W.setClock(null); }
});

test('an issue approved after the round limit is on the merger, not on a takeover, in next --as as in the queue', () => {
  const { dir } = repo();
  jarl(dir, 'goal', '--set', 'Takeover: 2');
  jarl(dir, 'new', 'hard', '--tier', 'light', '--acceptance', '[test] a');
  lease(dir, '1', 'w1', 'jarl/1-hard');
  branchWith(dir, 'jarl/1-hard', 'a.txt');
  proof(dir, '1', 1, 'w1');
  jarl(dir, 'round', '1', 'red');
  proof(dir, '1', 1, 'w1');
  jarl(dir, 'round', '1', 'red again');
  proof(dir, '1', 1, 'w1');
  jarl(dir, 'review', '1', 'approve', '--by', 'rev-1', FINDINGS);
  assert.deepEqual(rows(dir, 'jarl').filter((r) => r.id === '1').map((r) => r.what), ['merge']);
  assert.deepEqual(queue(dir).repos[0].rows.map((r) => r.branch), ['jarl/1-hard']);
});

test('an integration branch with commits and no recorded merge is in neither view', () => {
  const { dir, g } = repo();
  jarl(dir, 'goal', '--set', 'Coordinators: odin');
  jarl(dir, 'goal', '--set', 'Merger (odin): mimir');
  branchWith(dir, 'jarl/slice-odin', 'a.txt');
  jarl(dir, 'new', 'sliced', '--tier', 'light', '--acceptance', '[test] a', '--tags', 'slice:odin');
  assert.ok(!rows(dir, 'jarl').some((r) => r.integration));
  assert.ok(!queue(dir).repos[0].rows.some((r) => r.branch === 'jarl/slice-odin'), shaOf(g, 'jarl/slice-odin'));
});
