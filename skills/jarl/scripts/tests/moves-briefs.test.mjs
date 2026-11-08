// The briefs of a lease: each holds everything its reader needs and nothing the reader must not see, under its word cap;
// the depth of a review comes from the lines, the deeper of as at the lease and as now; next --as carries each raise-move
// whole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitRepo, jarl, refuses, spawnJarl, loop as makeLoop } from './helpers.mjs';
import { sh } from './portable.mjs';
import { FINDINGS } from './findings.mjs';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const loop = () => makeLoop({ prefix: 'jarl-brief-moves-', via: 'cli', dotGit: false });
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const lease = (root, ids, worker, branch, model) => jarl(root, 'set', ids, 'in-progress', 'go', '--worker', worker, '--branch', branch, ...(model ? ['--model', model] : []), '--by', 'jarl');
const row = (root, id, line, by, ran = 'npm test', saw = 'pass 3') => jarl(root, 'evidence', id, '--line', String(line), '--ran', ran, '--saw', saw, '--by', by);
const words = (text) => text.split(/\s+/).filter(Boolean).length;

// A loop with a goal of one paragraph (and later lines), a parent with a purpose, a lease of two issues on different tiers.
function leased() {
  const { dir, g } = gitRepo({ prefix: 'jarl-brief-moves-git-', branch: 'feature' });
  jarl(dir, 'init', 'Make the export feature whole, end to end.');
  jarl(dir, 'goal', '--set', 'Check: npm test');
  jarl(dir, 'new', 'the export parent', '--tier', 'standard', '--why', 'Two callers import it by name', '--acceptance', '[read] the whole works');   // 1
  jarl(dir, 'new', 'export one', '--tier', 'light', '--what', 'Add export()', '--why', 'Needed', '--acceptance', '[test] calling export() returns the list', '--acceptance', '[check] the suite passes · by: npm test', '--files', 'a.txt');   // 2
  jarl(dir, 'new', 'export two', '--tier', 'strong', '--why', 'Needed', '--acceptance', '[compare] the report is unchanged · by: node report.mjs', '--files', 'b.txt');   // 3
  jarl(dir, 'field', '2,3', 'Parent', '1');
  jarl(dir, 'decide', 'workers-note', 'Every worker on this loop names the module it touched.', '--applies-to', 'role worker', '--by', 'jarl');
  g('branch', 'jarl/2-pack');
  const wt = mkdtempSync(join(tmpdir(), 'jarl-brief-moves-wt-'));
  sh(dir, `git worktree add -q ${wt} jarl/2-pack`);
  lease(dir, '2,3', 'w-7', 'jarl/2-pack', 'sonnet-x');
  return { dir, g, wt };
}

test('brief <ids> prints the complete worker\'s text: role, goal, purpose, lines with methods, branch and worktree from git, loop root, script, rules, three do-nots, every known value filled, what it reports', () => {
  const { dir, wt } = leased();
  const o = json(dir, 'brief', '2,3');
  const text = jarl(dir, 'brief', '2,3');
  assert.equal(o.role, 'worker');
  assert.deepEqual(o.ids, ['2', '3']);
  assert.equal(o.goal, 'Make the export feature whole, end to end.');
  assert.match(text, /^## The goal\nMake the export feature whole, end to end\.$/m);
  assert.deepEqual(o.parents.map((p) => [p.id, p.parent.id, p.parent.why]), [['2', '1', 'Two callers import it by name'], ['3', '1', 'Two callers import it by name']]);
  assert.match(text, /2 is part of 1 \(the export parent\): Two callers import it by name/);
  assert.match(text, /\[test\] calling export\(\) returns the list/);
  assert.match(text, /\[compare\] the report is unchanged · by: node report\.mjs/);
  assert.equal(o.lease.branch, 'jarl/2-pack');
  assert.equal(o.lease.worker, 'w-7');
  assert.equal(o.lease.repos[0].worktree, wt);
  assert.equal(o.lease.tier, 'strong', 'a lease carrying several tiers takes the highest');
  assert.match(text, /tier strong \(the highest of this lease\)/);
  assert.equal(o.root, dir);
  assert.equal(o.script, SCRIPT);
  assert.ok(text.includes(`Loop root: ${dir}`));
  assert.match(text, new RegExp(`Tool: \\S+ ${SCRIPT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.ok(o.rules.some((r) => r.slug === 'workers-note'));
  assert.equal(o.doNot.length, 3);
  assert.match(text, /^## You do not\n- widen the scope.*\n- weaken a test.*\n- approve anything/m);
  // Every known value filled: the issue, the worker's name, the absolute root and script; only what the worker supplies stays a placeholder.
  const raw = JSON.parse(spawnJarl(dir, ['brief', '2,3', '--json']).stdout);
  const evidence = raw.record.find((r) => r.what.includes('proof of a line of 2')).command;
  assert.ok(evidence.includes(SCRIPT), evidence);
  assert.ok(evidence.includes('evidence 2'), evidence);
  assert.ok(evidence.includes('--by w-7'), evidence);
  assert.ok(evidence.includes(`--root ${dir}`), evidence);
  assert.match(evidence, /--ran "<command>" --saw "<what-it-printed>" --line "<line-number>"/);
  assert.match(text, /^## What you report\nIn under 200 words/m);
});

test('a brief names one lease: two leases are refused, part of one is completed with a note, an unleased issue reads as what it is', () => {
  const { dir } = leased();
  jarl(dir, 'new', 'elsewhere', '--tier', 'light', '--why', 'x', '--acceptance', '[test] t', '--files', 'c.txt');   // 4
  lease(dir, '4', 'w-9', 'jarl/4-other');
  assert.match(refuses(dir, 'brief', '2,4'), /^2, 4 are not one lease: 2 holds branch jarl\/2-pack, worker w-7, and 4 holds branch jarl\/4-other, worker w-9/);
  assert.match(refuses(dir, 'brief', '2,4').trim().split('\n').pop(), /jarl\.mjs brief "<ids>"$/);
  const part = json(dir, 'brief', '2');
  assert.deepEqual(part.ids, ['2', '3'], 'the whole lease');
  assert.ok(part.notes.some((n) => /3 is on this lease too/.test(n)));
  jarl(dir, 'new', 'not started', '--tier', 'light', '--why', 'x', '--acceptance', '[test] t', '--files', 'd.txt');   // 5
  assert.deepEqual(json(dir, 'brief', '5').ids, ['5']);
  assert.equal(json(dir, 'brief', '5').lease.branch, null);
  assert.match(jarl(dir, 'brief', '5'), /Branch not leased yet/);
});

test('a takeover\'s brief says the tree may be dirty', () => {
  const { dir } = leased();
  jarl(dir, 'set', '2,3', 'in-progress', 'the worker is gone', '--worker', 'w-8', '--handover', '--by', 'jarl');
  const o = json(dir, 'brief', '2,3');
  assert.equal(o.takeover, true);
  assert.equal(o.lease.worker, 'w-8');
  assert.match(jarl(dir, 'brief', '2,3'), /A takeover: .*The tree may be dirty: keep what you can verify, discard the rest\./);
  const { dir: other } = leased();
  assert.doesNotMatch(jarl(other, 'brief', '2,3'), /tree may be dirty/);
});

test('the examiner\'s brief: the depth and tier, the six steps, the changes to the lines since the lease, the proof as commands to re-run, the Assumed notes, the previous findings after a round, and no free note or report', () => {
  const { dir } = leased();
  row(dir, '2', 1, 'w-7', 'npm test -- export', 'pass 4');
  row(dir, '2', 2, 'w-7');
  row(dir, '3', 1, 'w-7', 'node report.mjs', 'same');
  row(dir, '3', 1, 'w-7', 'node report.mjs', 'same');
  jarl(dir, 'evidence', '2', 'Assumed: an empty call means the empty list', '--by', 'w-7');
  jarl(dir, 'evidence', '2', 'I also tidied the helpers and it looks great', '--by', 'w-7');
  jarl(dir, 'field', '3', 'Acceptance', '--add', '[test] the header stays', '--by', 'w-7');
  let o = json(dir, 'brief', '2,3', '--role', 'reviewer');
  const text = () => jarl(dir, 'brief', '2,3', '--role', 'reviewer');
  assert.equal(o.role, 'reviewer');
  assert.equal(o.depth.row, 'strongest', 'an issue on the top tier');
  assert.equal(o.depth.tier, 'strong');
  assert.match(text(), /^Depth: an issue on the top tier/m);
  for (const step of ['1\\. Read every change', '2\\. Ask whether each method proves its line', '3\\. Run every \\[test\\], \\[check\\] and \\[compare\\] line again', '4\\. Judge the \\[read\\] lines', '5\\. Invent scenarios', '6\\. Check that nothing outside']) assert.match(text(), new RegExp(`^${step}`, 'm'), step);
  const changes = text().split('## Changes to the lines since the lease')[1].split('\n## ')[0];
  assert.match(changes, /by w-7/);
  assert.match(changes, /now: \[test\] the header stays/);
  assert.match(text(), /2 line 1 \[test\]: re-run npm test -- export \(saw: pass 4, by w-7\)/);
  assert.match(text(), /What the worker assumed\n- 2: Assumed: an empty call means the empty list/);
  assert.doesNotMatch(text(), /tidied the helpers/, 'no free note reaches the examiner');
  assert.ok(!o.issues.some((i) => /tidied/.test(i.text)));
  assert.doesNotMatch(text(), /## Findings of the reviews that sent it back/);
  jarl(dir, 'review', '2', 'changes', '--by', 'rev-1', 'Important: the empty case throws');
  jarl(dir, 'round', '2', 'the empty case');
  assert.match(text(), /## Findings of the reviews that sent it back \(1\)\n- [^\n]*Important: the empty case throws/);
  assert.match(text(), /^3\. Run every/m);
});

test('the merger\'s brief prints the whole procedure: the three cases of a red check, one writer per target branch, its own worktree, who commits .jarl', () => {
  const root = loop();
  const text = jarl(root, 'brief', '--role', 'merger');
  const o = json(root, 'brief', '--role', 'merger');
  assert.equal(o.role, 'merger');
  assert.match(text, /^## A red check\nRoll back with `git reset --keep ORIG_HEAD`/m);
  assert.match(text, /^1\. A batch went red: reset to before its first merge, and land the branches one at a time/m);
  assert.match(text, /^2\. One branch's work fails it.*two good branches break together.*gets a round.*examined again/m);
  assert.match(text, /^3\. The cause is outside the branch.*file the cause as its own issue.*lands on red only on the jarl's ruling/m);
  assert.match(text, /One writer per target branch/);
  assert.match(text, /a worktree of your own/);
  assert.match(text, /only the holder of the main checkout commits `\.jarl\/`/);
  assert.match(refuses(root, 'brief', '1', '--role', 'merger'), /brief --role merger is the merger's and takes no id/);
  // A slice's merger is briefed for its own target.
  jarl(root, 'goal', '--set', 'Coordinators: odin');
  jarl(root, 'goal', '--set', 'Merger (odin): mimir');
  const m = json(root, 'brief', '--role', 'merger', '--slice', 'odin');
  assert.equal(m.merger, 'mimir');
  assert.equal(m.target, 'jarl/slice-odin');
  assert.match(jarl(root, 'brief', '--role', 'merger', '--slice', 'odin'), /Your target: jarl\/slice-odin/);
});

test('a slice\'s merger is told when its integration branch does not exist yet, and that the work is the feature branch\'s merger\'s until then', () => {
  const { dir, g } = gitRepo({ prefix: 'jarl-brief-merger-slice-', branch: 'feature' });
  jarl(dir, 'init', 'goal');
  jarl(dir, 'goal', '--set', 'Coordinators: odin');
  jarl(dir, 'goal', '--set', 'Merger (odin): mimir');
  assert.match(jarl(dir, 'brief', '--role', 'merger', '--slice', 'odin'), /^note: jarl\/slice-odin does not exist yet: until it is cut, the slice's approved work is the feature branch's merger's/m);
  g('branch', 'jarl/slice-odin');
  assert.doesNotMatch(jarl(dir, 'brief', '--role', 'merger', '--slice', 'odin'), /does not exist yet/);
});

test('depth is computed from the lines as the table says, the deeper of as at the lease and as now, for every row of it', () => {
  const root = loop();
  const depth = (ids) => json(root, 'brief', ids, '--role', 'reviewer').depth;
  jarl(root, 'new', 'all compare', '--tier', 'standard', '--acceptance', '[compare] same · by: run');   // 1
  jarl(root, 'new', 'mechanical', '--tier', 'standard', '--acceptance', '[test] t', '--acceptance', '[check] c · by: x');   // 2
  jarl(root, 'new', 'read light', '--tier', 'light', '--acceptance', '[read] r');   // 3
  jarl(root, 'new', 'owner', '--tier', 'standard', '--acceptance', '[owner] looks right · material: m · check: c');   // 4
  jarl(root, 'new', 'strong', '--tier', 'strong', '--acceptance', '[compare] same · by: run');   // 5
  jarl(root, 'new', 'low worker mechanical', '--tier', 'light', '--acceptance', '[test] t');   // 6
  assert.deepEqual([depth('1').row, depth('1').tier], ['compare-only', 'light'], 'all compare: a light model is allowed');
  assert.deepEqual([depth('2').row, depth('2').tier], ['mechanical', 'standard'], 'test or check: at least standard, not below the worker');
  assert.deepEqual([depth('6').row, depth('6').tier], ['mechanical', 'standard'], 'a light worker\'s test line: at least standard');
  assert.deepEqual([depth('3').row, depth('3').tier], ['judged', 'standard'], 'a light worker\'s read line: one tier above, at least standard');
  assert.deepEqual([depth('4').row, depth('4').tier], ['judged', 'strong'], 'owner on standard: one tier above');
  assert.deepEqual([depth('5').row, depth('5').tier], ['strongest', 'strong'], 'Tier strong: the strongest, whatever the lines');
  // The deeper of as at the lease and as now: a read line edited away after the lease stays deep; a read line added stays deep too.
  jarl(root, 'new', 'lowered', '--tier', 'standard', '--acceptance', '[read] judged by eye', '--acceptance', '[test] t');   // 7
  jarl(root, 'set', '7', 'in-progress', 'go', '--worker', 'w-1', '--branch', 'jarl/7', '--by', 'jarl');
  jarl(root, 'field', '7', 'Acceptance', '[test] t', '--by', 'w-1');
  const lowered = depth('7');
  assert.deepEqual([lowered.row, lowered.atLease, lowered.now, lowered.tier], ['judged', 'judged', 'mechanical', 'strong'], 'the lease\'s lines decide');
  jarl(root, 'new', 'raised', '--tier', 'standard', '--acceptance', '[test] t');   // 8
  jarl(root, 'set', '8', 'in-progress', 'go', '--worker', 'w-2', '--branch', 'jarl/8', '--by', 'jarl');
  jarl(root, 'field', '8', 'Acceptance', '[read] new judged', '--add', '--by', 'jarl');
  assert.deepEqual(depth('8').row, 'judged', 'the lines as they are now decide too');
  // A second family where the Model line has one, on the strongest row.
  jarl(root, 'goal', '--set', 'Model (strong): opus-x, gpt-y');
  assert.equal(depth('5').secondFamily, 'gpt-y');
});

test('next --as --json gives each raise-move its role, default model, branch and the command that prints its brief', () => {
  const { dir, g } = gitRepo({ prefix: 'jarl-raise-', branch: 'feature' });
  jarl(dir, 'init', 'goal');
  jarl(dir, 'goal', '--set', 'Model (light): haiku-x');
  jarl(dir, 'goal', '--set', 'Model (standard): sonnet-x');
  jarl(dir, 'goal', '--set', 'Model (strong): opus-x');
  jarl(dir, 'new', 'to start', '--tier', 'light', '--why', 'w', '--acceptance', '[test] a', '--files', 'a.txt');   // 1
  jarl(dir, 'new', 'to examine', '--tier', 'light', '--why', 'w', '--acceptance', '[test] b', '--files', 'b.txt');   // 2
  jarl(dir, 'new', 'to merge', '--tier', 'light', '--why', 'w', '--acceptance', '[test] c', '--files', 'c.txt');   // 3
  jarl(dir, 'new', 'stuck', '--tier', 'light', '--why', 'w', '--acceptance', '[test] d', '--files', 'd.txt');   // 4
  jarl(dir, 'goal', '--set', 'Takeover: 1');
  lease(dir, '2', 'w2', 'jarl/2-examine');
  row(dir, '2', 1, 'w2');
  lease(dir, '3', 'w3', 'jarl/3-merge');
  row(dir, '3', 1, 'w3');
  jarl(dir, 'review', '3', 'approve', '--by', 'rev-1', FINDINGS);
  lease(dir, '4', 'w4', 'jarl/4-stuck');
  row(dir, '4', 1, 'w4');
  jarl(dir, 'round', '4', 'red');
  const rows = json(dir, 'next', '--as', 'jarl', '--all').rows;
  const of = (id, what) => rows.find((r) => r.id === id && r.what === what);
  assert.deepEqual(of('1', 'ready').raise, { role: 'worker', model: 'haiku-x', branch: 'jarl/1-to-start', command: 'jarl.mjs brief 1' });
  const review = rows.find((r) => r.what === 'review');
  assert.deepEqual(review.raise, { role: 'reviewer', model: 'sonnet-x', tier: 'standard', branch: 'jarl/2-examine', command: 'jarl.mjs brief 2 --role reviewer' });
  const merge = of('3', 'merge');
  assert.deepEqual(merge.raise, { role: 'merger', model: 'sonnet-x', branch: 'jarl/3-merge', command: 'jarl.mjs brief --role merger' });
  const takeover = of('4', 'takeover');
  assert.deepEqual(takeover.raise, { role: 'worker', model: 'haiku-x', branch: 'jarl/4-stuck', command: 'jarl.mjs brief 4' });
  const close = rows.find((r) => r.what !== 'review' && !r.raise && r.what === 'worker');
  assert.equal(close, undefined, 'no worker row stands here');
});

// A brief's own text, as the caps count it: without each issue's own block and without the sections of its record (rounds,
// findings, proof rows), which grow with the issue and not with the role.
const RECORD_SECTIONS = ['Proof to re-run', 'Rounds so far', 'Findings of the reviews', 'What the worker assumed'];
function ownWords(root, args) {
  const o = json(root, 'brief', ...args);
  let text = jarl(root, 'brief', ...args);
  for (const issue of o.issues || []) text = text.replace(issue.text, '');
  text = text.split('\n## ').filter((part, k) => k === 0 || !RECORD_SECTIONS.some((s) => part.startsWith(s))).join('\n## ');
  return words(text);
}
const LONG_GOAL = `${'The whole of the export work is to reach every caller without a break, and it says so at length. '.repeat(24)}The end.`;
function longLoop() {
  const { dir } = gitRepo({ prefix: 'jarl-brief-caps-', branch: 'feature' });
  jarl(dir, 'init', LONG_GOAL);
  const many = Array.from({ length: 20 }, (_, n) => ['--acceptance', `[test] behaviour number ${n + 1} of the export holds`]).flat();
  jarl(dir, 'new', 'many lines', '--tier', 'standard', '--why', 'Needed', '--files', 'a.txt', ...many);   // 1
  jarl(dir, 'new', 'its neighbour', '--tier', 'standard', '--why', 'Needed', '--files', 'b.txt', ...many);   // 2
  lease(dir, '1,2', 'w-7', 'jarl/1-pack', 'sonnet-x');
  for (let n = 1; n <= 20; n += 1) row(dir, '1', n, 'w-7', `npm test -- ${n}`, 'pass');
  return dir;
}

test('the briefs hold their word caps with a long goal and many lines, the issue\'s own record not counted: worker 700, examiner 500, merger 900', () => {
  const dir = longLoop();
  const counts = {
    workerOne: ownWords(dir, ['1,2']),
    examiner: ownWords(dir, ['1,2', '--role', 'reviewer']),
    merger: ownWords(dir, ['--role', 'merger']),
  };
  assert.ok(counts.workerOne <= 700, `worker ${counts.workerOne} words`);
  assert.ok(counts.examiner <= 500, `examiner ${counts.examiner} words`);
  assert.ok(counts.merger <= 900, `merger ${counts.merger} words`);
});

test('the goal\'s first paragraph is cut at a fixed length with the pointer to where the rest is', () => {
  const dir = longLoop();
  const o = json(dir, 'brief', '1,2');
  assert.ok(words(o.goal) <= 75, `${words(o.goal)} words`);
  assert.match(o.goal, /… \(the rest of the goal: .*goal\.md\)$/);
  assert.match(jarl(dir, 'brief', '--role', 'merger'), /the rest of the goal: .*goal\.md/);
  const { dir: short } = leased();
  assert.equal(json(short, 'brief', '2,3').goal, 'Make the export feature whole, end to end.', 'a short goal is whole');
});

test('a worker on an in-place issue is told it commits nothing', () => {
  const { dir } = gitRepo({ prefix: 'jarl-brief-in-place-', branch: 'feature' });
  jarl(dir, 'init', 'goal');
  jarl(dir, 'new', 'the guide', '--tier', 'light', '--why', 'w', '--tags', 'in-place', '--files', 'docs/guide.md', '--acceptance', '[read] it reads well');
  jarl(dir, 'set', '1', 'in-progress', 'go', '--worker', 'w1', '--by', 'jarl');
  const text = jarl(dir, 'brief', '1');
  assert.match(text, /you commit nothing/i);
  assert.doesNotMatch(text, /Commit at the failing test/);
  assert.doesNotMatch(text, /`git merge /);
});

test('the proof to re-run takes the rows themselves: each live row with its own command, none retracted, and a declared check the landing proves says so', () => {
  const root = loop();
  jarl(root, 'goal', '--set', 'Check: npm test');
  jarl(root, 'new', 'a compare', '--tier', 'standard', '--why', 'w', '--acceptance', '[compare] same · by: node r.mjs', '--acceptance', '[check] the suite passes', '--acceptance', '[test] t', '--files', 'a.mjs');
  lease(root, '1', 'w-1', 'jarl/1-a');
  row(root, '1', 1, 'w-1', 'node r.mjs --before', 'same');
  row(root, '1', 1, 'w-1', 'node r.mjs --after', 'same');
  row(root, '1', 3, 'w-1', 'npm test -- wrong', 'pass');
  jarl(root, 'retract', '1', '3', 'it was the wrong test', '--by', 'w-1');
  row(root, '1', 3, 'w-1', 'npm test -- right', 'pass');
  const text = jarl(root, 'brief', '1', '--role', 'reviewer');
  assert.match(text, /1 line 1 \[compare\]: re-run node r\.mjs --before \(saw: same, by w-1\) · node r\.mjs --after \(saw: same, by w-1\)/);
  assert.match(text, /1 line 3 \[test\]: re-run npm test -- right/);
  assert.doesNotMatch(text, /npm test -- wrong/, 'a retracted row is gone');
  assert.match(text, /1 line 2 \[check\]: on the declared check, which the landing proves: no row is owed/);
});

test('the merger\'s brief prints commands that run as printed, a commit step for its mode and a step for a worked-in-place issue', () => {
  const root = loop();
  const raw = JSON.parse(spawnJarl(root, ['brief', '--role', 'merger', '--json']).stdout);
  const flags = raw.record.find((r) => /merge drivers/.test(r.what)).command;
  assert.doesNotMatch(flags, /--root/, 'merge-driver flags names no loop');
  const words_ = flags.split(' ');
  const ran = spawnSync(process.execPath, words_.slice(1), { encoding: 'utf8', timeout: 60_000 });
  assert.equal(ran.status, 0, ran.stderr);
  const text = jarl(root, 'brief', '--role', 'merger');
  assert.match(text, /worked in place/);
  assert.match(text, /a commit of their own/);
  assert.match(text, /never commits? `\.jarl\/`/);
  const { dir } = gitRepo({ prefix: 'jarl-brief-committed-', branch: 'feature' });
  jarl(dir, 'init', 'goal', '--committed');
  const committed = jarl(dir, 'brief', '--role', 'merger');
  assert.match(committed, /the loop is committed/i);
  assert.match(committed, /commit `\.jarl\/` before each merge/i);
});

test('depth holds the tier at the lease too, and a line edited before a handover: the base is the first lease of the work, and the brief shows the change', () => {
  const root = loop();
  jarl(root, 'new', 'strong work', '--tier', 'strong', '--why', 'w', '--acceptance', '[test] t', '--files', 'a.mjs');   // 1
  lease(root, '1', 'w-1', 'jarl/1-a');
  jarl(root, 'field', '1', 'Tier', 'light', '--by', 'w-1');
  const lowered = json(root, 'brief', '1', '--role', 'reviewer');
  assert.deepEqual([lowered.depth.row, lowered.depth.tier], ['strongest', 'strong'], 'lowering the tier after the lease changes nothing');
  assert.match(jarl(root, 'brief', '1', '--role', 'reviewer'), /Tier was strong, now light/);
  jarl(root, 'new', 'judged', '--tier', 'standard', '--why', 'w', '--acceptance', '[read] by eye', '--files', 'b.mjs');   // 2
  lease(root, '2', 'w-2', 'jarl/2-b');
  jarl(root, 'field', '2', 'Acceptance', '[test] mechanical now', '--by', 'w-2');
  jarl(root, 'set', '2', 'in-progress', 'the worker is gone', '--worker', 'w-3', '--handover', '--by', 'jarl');
  const handed = json(root, 'brief', '2', '--role', 'reviewer');
  assert.deepEqual([handed.depth.row, handed.depth.atLease], ['judged', 'judged'], 'the base holds across the handover');
  const changes = jarl(root, 'brief', '2', '--role', 'reviewer').split('## Changes to the lines since the lease')[1].split('\n## ')[0];
  assert.match(changes, /by w-2 · was: \[read\] by eye · now: \[test\] mechanical now/);
});

test('a takeover on a lease of two tiers raises the highest of them, on the whole lease', () => {
  const root = loop();
  jarl(root, 'goal', '--set', 'Takeover: 1');
  jarl(root, 'goal', '--set', 'Model (light): haiku-x');
  jarl(root, 'goal', '--set', 'Model (strong): opus-x');
  jarl(root, 'new', 'light one', '--tier', 'light', '--why', 'w', '--acceptance', '[test] a', '--files', 'a.mjs');
  jarl(root, 'new', 'strong one', '--tier', 'strong', '--why', 'w', '--acceptance', '[test] b', '--files', 'b.mjs');
  lease(root, '1,2', 'w-1', 'jarl/1-pack');
  row(root, '1', 1, 'w-1');
  jarl(root, 'round', '1', 'red');
  const raise = json(root, 'next', '--as', 'jarl', '--all').rows.find((r) => r.what === 'takeover').raise;
  assert.equal(raise.model, 'opus-x');
  assert.equal(raise.command, 'jarl.mjs brief 1,2');
});

test('a director\'s stuck is under one holder in resume and next --as: resume lists it apart from the owner\'s questions', () => {
  const root = loop();
  jarl(root, 'new', 'stuck on it', '--tier', 'light', '--why', 'w', '--acceptance', '[test] a', '--files', 'a.mjs');
  lease(root, '1', 'w-1', 'jarl/1-a');
  jarl(root, 'ask', 'the guard must go, may I?', '--kind', 'stuck', '--issue', '1', '--by', 'w-1');
  jarl(root, 'ask', 'a question of the owner', '--kind', 'stuck');
  const r = json(root, 'resume');
  assert.deepEqual(r.questions.map((a) => a.question), ['a question of the owner']);
  assert.deepEqual(r.toDirector.map((a) => [a.question, a.holder]), [['the guard must go, may I?', 'jarl']]);
  const text = jarl(root, 'resume');
  assert.match(text, /## Questions to the owner \(1\)\n- a-\d+ \(stuck\) · a question of the owner/);
  assert.match(text, /## Questions to the director \(1\)\n- a-\d+ \(stuck\) issue 1 · on jarl · the guard must go, may I\?/);
});
