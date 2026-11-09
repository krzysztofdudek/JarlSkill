// One verdict given on several issues is one review: each of its lines in the log carries the same batch id, and report shows each batch with its size and the rounds that came after it. A verdict on one
// issue carries no batch id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileThreeDigits } from './helpers.mjs';
import { jarl, loop as makeLoop } from './helpers.mjs';
import { FINDINGS } from './findings.mjs';
import { BUILTIN_STATUSES, gateState } from '../jarl-lib.mjs';
import * as R from '../record.mjs';

const BATCH = /^\d{8}T\d{4}-[a-z]{4}$/;
const log = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const marker = (root) => join(root, '.jarl', 'profile.json');
const formatOf = (root) => (existsSync(marker(root)) ? JSON.parse(readFileSync(marker(root), 'utf8')).format : 1);
const verdictLines = (root) => log(root).split('\n').filter((l) => / review (approve|changes) · /.test(l));
const batchOf = (line) => (/ · batch (\S+) · /.exec(line) || [])[1] ?? null;

// Four issues with three digits and no key, each in progress on its own branch with a proof row.
function fourInFlight() {
  const root = makeLoop({ prefix: 'jarl-batch-', via: 'cli' });
  for (const t of ['first', 'second', 'third', 'fourth']) {
    const id = fileThreeDigits(root, `${t} change`, { acceptance: '[read] it works' });
    jarl(root, 'set', id, 'in-progress', '--worker', `w-${t}`, '--branch', `jarl/${id}`);
    jarl(root, 'evidence', id, '--line', '1', '--ran', 'npm test', '--saw', 'pass 3, fail 0');
  }
  return root;
}

test('a verdict on one issue carries no batch id', () => {
  const root = fourInFlight();
  jarl(root, 'review', '001', 'approve', '--by', 'rev-a', FINDINGS);
  assert.deepEqual(verdictLines(root).map(batchOf), [null]);
});

test('one verdict on several issues writes one batch id on each of its lines', () => {
  const root = fourInFlight();
  const out = JSON.parse(jarl(root, 'review', '001,002,003', 'approve', '--by', 'rev-a', '--model', 'm-1', FINDINGS, '--json'));
  const lines = verdictLines(root);
  assert.equal(lines.length, 3);
  const ids = lines.map(batchOf);
  assert.match(ids[0], BATCH);
  assert.deepEqual(ids, [ids[0], ids[0], ids[0]], 'one id on each line of the one verdict');
  assert.match(lines[0], / review approve · by rev-a \(fresh\) · model m-1 · batch \S+ · read the diff, nothing found$/, 'the batch mark comes after the model mark and before the findings');
  assert.deepEqual(out.map((o) => o.batch), ids, 'the reply names the batch');
  assert.match(readFileSync(R.findIssue(root, '002').file, 'utf8'), new RegExp(`^- \\*\\*approve\\*\\* · by rev-a \\(fresh\\) · \\d{4}-\\d{2}-\\d{2} · model m-1 · batch ${ids[0]}$`, 'm'), 'the issue\'s Reviews entry names it too');
  // A second verdict on several issues is another batch.
  jarl(root, 'review', '004,001', 'changes', '--by', 'rev-b', 'Important: the edge case is not handled');
  const second = verdictLines(root).slice(3).map(batchOf);
  assert.equal(second[0], second[1]);
  assert.notEqual(second[0], ids[0]);
  // The brief gives the findings of a batched changes verdict as the reviewer wrote them, without the batch mark.
  assert.match(jarl(root, 'brief', '004'), /^- \d{4}-\d{2}-\d{2} · by rev-b \(fresh\) — Important: the edge case is not handled$/m);
});

test('the gate reads a batched verdict line as it reads any verdict: its reviewer, kind, model and relay mark', () => {
  const root = fourInFlight();
  jarl(root, 'review', '001,002', 'approve', '--by', 'rev-a', '--model', 'm-1', '--relayed', FINDINGS);
  const g = gateState(root, '002');
  assert.equal(g.approved, true);
  assert.equal(g.fresh, true);
  assert.equal(g.live.by, 'rev-a');
  assert.equal(g.live.model, 'm-1');
  // A finding that opens like the mark is written with a lead-in, so no text of the findings reads as a batch id.
  jarl(root, 'review', '003', 'approve', '--by', 'rev-a', 'batch 20261106T1910-abcd · read the diff, nothing found');
  assert.match(verdictLines(root).at(-1), / · findings: batch 20261106T1910-abcd · read the diff/);
  assert.equal(batchOf(verdictLines(root).at(-1)), null);
});

test('report shows each batch with its size, its verdict and the rounds that came after it', () => {
  const root = fourInFlight();
  jarl(root, 'review', '001,002,003', 'approve', '--by', 'rev-a', FINDINGS);
  jarl(root, 'round', '002', 'the check went red after the merge of 001');
  jarl(root, 'review', '004', 'approve', '--by', 'rev-b', FINDINGS);
  const report = jarl(root, 'report');
  assert.match(report, /^batched reviews: 1 batch over 3 issues · 001, 002, 003 \(3, approve by rev-a\): 1 round after it$/m);
  const m = JSON.parse(jarl(root, 'report', '--json')).metrics.batches;
  assert.equal(m.n, 1);
  assert.deepEqual(m.batches.map((b) => [b.size, b.issues, b.verdict, b.by, b.rounds]), [[3, ['001', '002', '003'], 'approve', 'rev-a', 1]]);
  assert.match(m.batches[0].id, BATCH);
});

test('a loop with no batched verdict says nothing about batches in report', () => {
  const root = fourInFlight();
  jarl(root, 'review', '001', 'approve', '--by', 'rev-a', FINDINGS);
  assert.doesNotMatch(jarl(root, 'report'), /batched reviews/);
  assert.deepEqual(JSON.parse(jarl(root, 'report', '--json')).metrics.batches, { n: 0, batches: [] });
});
