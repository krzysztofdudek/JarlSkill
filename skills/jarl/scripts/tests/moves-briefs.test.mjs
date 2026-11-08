// The briefs of a lease: each holds everything its reader needs and nothing the reader must not see, under its word cap;
// the depth of a review comes from the lines, the deeper of as at the lease and as now; next --as carries each raise-move
// whole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  assert.ok(text.includes(`Tool: node ${SCRIPT}`));
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

test('the briefs hold their word caps, the issue\'s own text not counted: worker 700, examiner 500, merger 900', () => {
  const { dir } = leased();
  row(dir, '2', 1, 'w-7', 'npm test -- export', 'pass 4');
  row(dir, '2', 2, 'w-7');
  row(dir, '3', 1, 'w-7', 'node report.mjs', 'same');
  row(dir, '3', 1, 'w-7', 'node report.mjs', 'same');
  jarl(dir, 'evidence', '2', 'Assumed: an empty call means the empty list', '--by', 'w-7');
  const counted = (args) => {
    const o = json(dir, 'brief', ...args);
    let text = jarl(dir, 'brief', ...args);
    for (const issue of o.issues || []) text = text.replace(issue.text, '');
    return { n: words(text), o };
  };
  const worker = counted(['2,3']);
  assert.ok(worker.n <= 700, `worker ${worker.n} words`);
  const single = counted(['2', '--role', 'worker']);
  assert.ok(single.n <= 700, `worker of one issue ${single.n} words`);
  const reviewer = counted(['2,3', '--role', 'reviewer']);
  assert.ok(reviewer.n <= 500, `examiner ${reviewer.n} words`);
  const merger = counted(['--role', 'merger']);
  assert.ok(merger.n <= 900, `merger ${merger.n} words`);
});
