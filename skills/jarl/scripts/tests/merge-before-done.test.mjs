// A code issue is merged before it is done: done refuses an issue whose lease records a Branch while no merge is
// recorded, ending with the form of merged, and status flags a closed one that holds no merge by the same rule. The
// approve's reply names the same order. An issue with no Branch, such as one in a loop with no repository, has nothing
// to merge and closes on its proof and its approve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gitRepo, jarl, refuses, loop as makeLoop } from './helpers.mjs';
import { BUILTIN_STATUSES } from '../jarl-lib.mjs';

const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const files = (root) => Object.fromEntries(readdirSync(join(root, '.jarl'), { recursive: true }).filter((f) => /\.md$/.test(f)).map((f) => [f, readFileSync(join(root, '.jarl', f), 'utf8')]));
const ready = (root, { branch, dotGit = true } = {}) => {
  const root2 = root ?? makeLoop({ prefix: 'jarl-merge-before-done-', via: 'cli', dotGit });
  jarl(root2, 'new', 'the fix', '--acceptance', '[read] it works');
  jarl(root2, 'set', '1', 'in-progress', '--worker', 'w1', ...(branch ? ['--branch', branch] : []), '--by', 'jarl');
  jarl(root2, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', '12 pass, 0 fail', '--by', 'w1');
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

// ---- a merge counts for the code as it is now: one from before a reopen or a round, or of a tip the branch has moved past, does not ----

// A loop in a git repository on main whose first issue is leased on jarl/1-fix, with one commit, its row and a fresh approve.
// With approve false, the proof is recorded and no verdict: a loop whose done gate asks for none.
function codeIssue(initFlags = [], { approve = true } = {}) {
  const { dir: root, g } = gitRepo({ prefix: 'jarl-merge-now-', branch: 'main' });
  jarl(root, 'init', 'goal', ...initFlags);
  jarl(root, 'new', 'the fix', '--acceptance', '[read] it works');
  g('branch', 'jarl/1-fix');
  const work = (file) => { g('checkout', '-q', 'jarl/1-fix'); writeFileSync(join(root, file), `${file}\n`); g('add', file); g('commit', '-qm', file); g('checkout', '-q', 'main'); return g('rev-parse', 'jarl/1-fix').trim(); };
  const proved = () => { jarl(root, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', '12 pass, 0 fail'); if (approve) jarl(root, 'review', '1', 'approve', '--by', 'rev-fresh', 'read the diff and the test, nothing found'); };
  const merge = () => { g('merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-fix'); const sha = g('rev-parse', 'HEAD').trim(); jarl(root, 'merged', '1', '--sha', sha, '--keep'); return sha; };
  work('one.txt');
  jarl(root, 'set', '1', 'in-progress', 'start', '--branch', 'jarl/1-fix', '--worker', 'w1');
  proved();
  return { root, g, work, proved, merge };
}

test('a code issue merged once and never reopened closes on that merge, and status flags nothing', () => {
  const { root, merge } = codeIssue();
  merge();
  assert.equal(jarl(root, 'set', '1', 'done', 'merged'), '1 → done');
  assert.deepEqual(json(root, 'status').closedGate, []);
});

test('a code issue reopened after its merge and given a new commit is refused by done until the new tip\'s merge is recorded, with the form of merged', () => {
  const { root, work, proved, merge } = codeIssue();
  const first = merge();
  jarl(root, 'set', '1', 'done', 'merged');
  jarl(root, 'set', '1', 'open', 'the fix missed a case');
  jarl(root, 'set', '1', 'in-progress', 'again', '--branch', 'jarl/1-fix', '--worker', 'w1');
  work('two.txt');
  proved();
  const before = files(root);
  const said = refuses(root, 'set', '1', 'done', 'all green');
  assert.match(said, new RegExp(`^1 carries code \\(its lease records Branch jarl/1-fix\\) and its last merge, ${first} \\([^)]+\\), was recorded before its last start, reopen or red round, which spends a merge as it spends an approve — a code issue is merged before it is done`), said);
  assert.match(said, /\njarl\.mjs merged "<ids>" --sha "<sha>"\n$/, said);
  assert.deepEqual(files(root), before, 'a refused done writes nothing');
  merge();
  assert.equal(jarl(root, 'set', '1', 'done', 'merged again'), '1 → done');
  assert.deepEqual(json(root, 'status').closedGate, []);
});

test('a merge of a tip the branch has moved past does not count once the branch has a newer commit: done names both tips', () => {
  const { root, g, work, merge } = codeIssue();
  const merged = g('rev-parse', 'jarl/1-fix').trim();
  const first = merge();
  const now = work('late.txt');
  const said = refuses(root, 'set', '1', 'done', 'all green');
  assert.match(said, new RegExp(`and its last merge, ${first} \\([^)]+\\), was recorded on tip ${merged.slice(0, 12)} and the branch is at ${now.slice(0, 12)}, so the commits after it are not merged — `), said);
  merge();
  assert.equal(jarl(root, 'set', '1', 'done', 'merged with the late commit'), '1 → done');
});

// The row of next --as jarl and the in-flight step of resume for the fixture's one issue.
const rowOf = (root) => json(root, 'next', '--as', 'jarl', '--all').rows.find((r) => r.id === '1');
const stepOf = (root) => json(root, 'resume').inFlight.find((x) => x.id === '1');

test('next --as jarl and resume ask for the merge again, with the form of merged, when the branch has a commit after the merge', () => {
  const { root, work, merge } = codeIssue();
  merge();
  assert.equal(rowOf(root).says, 'merged; close it', 'a merge of the tip now: close it');
  work('late.txt');
  const row = rowOf(root);
  assert.equal(row.says, 'approved, and the branch has commits after its last merge; merge it again and record the merge');
  assert.equal(row.command, 'jarl.mjs merged 1 --sha "<sha>" --ran "<command>" --saw "<what-it-printed>"');
  const step = stepOf(root);
  assert.equal(step.mark, 'approved');
  assert.equal(step.next, 'approved, and the branch has commits after its last merge — next the merger lands it again and records the merge, then set it done');
  merge();
  assert.equal(rowOf(root).says, 'merged; close it');
});

test('next --as jarl asks for the merge again when a red round spent it, and a loop with no approve asks for it after the proof', () => {
  const { root, proved, merge } = codeIssue();
  merge();
  jarl(root, 'round', '1', 'the check went red on the merge');
  proved();
  assert.equal(rowOf(root).says, 'approved, and its last merge was spent by a later start, reopen or red round; merge it again and record the merge');
  const profile = join(mkdtempSync(join(tmpdir(), 'jarl-merge-now-profile-')), 'profile.json');
  writeFileSync(profile, JSON.stringify({ 'jarl-profile': 1, format: 1, name: 'landed-no-approve', statuses: BUILTIN_STATUSES, 'done-gate': { 'requires-merged': true, approve: 'none' } }));
  const bare = codeIssue(['--profile', profile], { approve: false });
  bare.merge();
  assert.equal(rowOf(bare.root).says, 'proof recorded; close it');
  bare.work('late.txt');
  assert.match(refuses(bare.root, 'set', '1', 'done', 'all green'), /so the commits after it are not merged/, 'done refuses the merge');
  const row = rowOf(bare.root);
  assert.equal(row.says, 'proof recorded, and the branch has commits after its last merge; merge it again and record the merge');
  assert.equal(row.command, 'jarl.mjs merged 1 --sha "<sha>" --ran "<command>" --saw "<what-it-printed>"');
});

test('a red round after a merge spends it as it spends the approve', () => {
  const { root, proved, merge } = codeIssue();
  merge();
  jarl(root, 'round', '1', 'the check went red on the merge');
  proved();
  assert.match(refuses(root, 'set', '1', 'done', 'all green'), /was recorded before its last start, reopen or red round/);
  merge();
  assert.equal(jarl(root, 'set', '1', 'done', 'merged again'), '1 → done');
});

test('a loop that closes only on a landed merge refuses a merge from before the reopen, though its commit is in the base', () => {
  const profile = join(mkdtempSync(join(tmpdir(), 'jarl-merge-now-profile-')), 'profile.json');
  writeFileSync(profile, JSON.stringify({ 'jarl-profile': 1, format: 1, name: 'landed-gate', statuses: BUILTIN_STATUSES, 'done-gate': { 'requires-merged': true } }));
  const { root, work, proved, merge } = codeIssue(['--profile', profile]);
  merge();
  jarl(root, 'set', '1', 'done', 'merged');
  jarl(root, 'set', '1', 'open', 'the fix missed a case');
  jarl(root, 'set', '1', 'in-progress', 'again', '--branch', 'jarl/1-fix', '--worker', 'w1');
  work('two.txt');
  proved();
  const said = refuses(root, 'set', '1', 'done', 'all green');
  assert.match(said, /was recorded before its last start, reopen or red round/, said);
  assert.match(said, /\njarl\.mjs merged "<ids>" --sha "<sha>"\n$/, said);
  merge();
  assert.equal(jarl(root, 'set', '1', 'done', 'merged again'), '1 → done');
});

test('status flags a code issue closed on a merge from before its reopen, naming the merge', () => {
  const { root, work, proved, merge } = codeIssue();
  const first = merge();
  jarl(root, 'set', '1', 'done', 'merged');
  jarl(root, 'set', '1', 'open', 'the fix missed a case');
  jarl(root, 'set', '1', 'in-progress', 'again', '--branch', 'jarl/1-fix', '--worker', 'w1');
  work('two.txt');
  proved();
  // Closed past the gate, as a hand edit or another tool can: the move line and the file's status.
  const log = join(root, '.jarl', 'log.md');
  const stamp = [...readFileSync(log, 'utf8').matchAll(/^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) · /gm)].pop()[1];
  writeFileSync(log, `${readFileSync(log, 'utf8')}- ${stamp} · 1 → done · closed by hand\n`);
  const file = join(root, '.jarl', 'issues', readdirSync(join(root, '.jarl', 'issues')).find((f) => f.startsWith('1-')));
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^\*\*Status:\*\* .*$/m, '**Status:** done'));
  const flags = json(root, 'status').closedGate;
  assert.equal(flags.length, 1, JSON.stringify(flags));
  assert.match(flags[0].reason, new RegExp(`a code issue done, and its last merge, ${first} \\([^)]+\\), was recorded before its last start, reopen or red round`));
});
