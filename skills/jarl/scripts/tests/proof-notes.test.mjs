// An issue keeps its Proof (the worker's --ran/--saw rows) apart from its Notes (free text, rulings, reasons, retraction
// entries), and the merger's check lives in the merge record (the Merge check field and the merge line), where the done
// gate never reads it as proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as R from '../record.mjs';
import { jarl, refuses, run, loop as makeLoop } from './helpers.mjs';
import { FINDINGS } from './findings.mjs';

const L = await import('../jarl-lib.mjs');

const log = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const issueFile = (root, id) => { const dir = join(root, '.jarl', 'issues'); return join(dir, readdirSync(dir).find((f) => f.startsWith(`${String(id).padStart(3, '0')}-`))); };
const issueText = (root, id) => readFileSync(issueFile(root, id), 'utf8');
// The Evidence section of an issue file, from its heading to the end.
const evidence = (root, id) => issueText(root, id).slice(issueText(root, id).indexOf('## Evidence'));

// A loop with `n` code issues in progress on a branch, worked by w1, each approved by a fresh reviewer and holding no row.
function approved(n = 1) {
  const root = makeLoop({ prefix: 'jarl-proofnotes-', via: 'cli' });
  for (let k = 1; k <= n; k += 1) {
    jarl(root, 'new', `issue ${k}`, '--acceptance', 'it works');
    jarl(root, 'set', String(k), 'in-progress', 'go', '--branch', `jarl/${k}-x`, '--worker', 'w1');
    jarl(root, 'review', String(k), 'approve', '--by', 'rev-fresh', FINDINGS);
  }
  return root;
}

test('an issue with no worker row, merged with --ran and --saw, is refused by done for the missing proof, and the refusal says the merge check does not stand in for the row', () => {
  const root = approved();
  jarl(root, 'merged', '1', '--sha', 'abc1234', '--ran', 'npm test', '--saw', '3 pass', '--keep');
  const why = refuses(root, 'set', '1', 'done');
  assert.match(why, /001 has no evidence yet/);
  assert.match(why, /the merge records a check \(npm test\)/);
  assert.match(why, /does not stand in for the worker's row/);
  assert.match(why, /jarl\.mjs evidence 001 --ran "<command>" --saw "<what it printed>"/);
  assert.doesNotMatch(log(root), /001 evidence row/, 'the merge wrote no row line');
  assert.doesNotMatch(issueText(root, 1), /\*\*ran:\*\*/, 'the merge wrote no row');
});

test('a worker row written after the merge lets done through', () => {
  const root = approved();
  jarl(root, 'merged', '1', '--sha', 'abc1234', '--ran', 'npm test', '--saw', '3 pass', '--keep');
  jarl(root, 'evidence', '1', '--ran', 'npm test -- probe', '--saw', 'red before, green after');
  assert.match(jarl(root, 'set', '1', 'done'), /001 → done/);
});

test('the merge check lands in the merge record: the Merge check field beside Merged and CI, and the merge line', () => {
  const root = approved();
  assert.equal(jarl(root, 'merged', '1', '--sha', 'abc1234', '--ran', 'npm test', '--saw', '3 pass', '--ci', 'green', '--keep'), '001 merged abc1234 · check npm test · CI green');
  assert.match(issueText(root, 1), /^\*\*Merged:\*\* abc1234\n\*\*Merge check:\*\* npm test · saw 3 pass\n\*\*CI:\*\* green$/m);
  assert.match(log(root), /^- \S+ \S+ · 001 merged abc1234 · check npm test · saw 3 pass · CI green$/m);
});

test('a merge without a check removes the Merge check of the earlier merge; a CI line alone leaves it', () => {
  const root = approved();
  jarl(root, 'merged', '1', '--sha', 'abc1234', '--ran', 'npm test', '--saw', '3 pass', '--keep');
  jarl(root, 'merged', '1', '--ci', 'green');
  assert.match(issueText(root, 1), /^\*\*Merge check:\*\* npm test · saw 3 pass$/m);
  jarl(root, 'merged', '1', '--sha', 'def5678', '--keep');
  assert.doesNotMatch(issueText(root, 1), /Merge check/);
});

test('several --ran/--saw pairs are one Merge check line, and a separator in them is neutralised', () => {
  const root = approved();
  jarl(root, 'merged', '1', '--sha', 'abc1234', '--ran', 'npm test', '--saw', 'pass · 3', '--ran', 'lint', '--saw', 'clean', '--keep');
  assert.match(issueText(root, 1), /^\*\*Merge check:\*\* npm test ; lint · saw pass - 3 ; clean$/m);
});

test('the merge reply says when the issue holds no Proof row, and names the command that records it', () => {
  const root = approved(2);
  jarl(root, 'evidence', '2', '--ran', 'npm test', '--saw', 'pass');
  const r = run(root, ['merged', '1,2', '--sha', 'abc1234', '--ran', 'npm test', '--saw', '3 pass', '--keep']);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /note: NO PROOF FROM THE WORKER — 001 holds no Proof row since it was moved → in-progress/);
  assert.match(r.stderr, /the merge check is recorded in the merge record and is not proof/);
  assert.doesNotMatch(r.stderr, /NO PROOF FROM THE WORKER — 002/);
});

test('the review reply of an approve names Proof, and says so when the issue holds no Proof row', () => {
  const root = makeLoop({ prefix: 'jarl-proofnotes-', via: 'cli' });
  jarl(root, 'new', 'one', '--acceptance', 'it works');
  jarl(root, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/1-x', '--worker', 'w1');
  const r = run(root, ['review', '1', 'approve', '--by', 'rev-fresh', FINDINGS]);
  assert.match(r.stdout, /which needs a Proof row from the worker/);
  assert.match(r.stderr, /001 holds no Proof row since the gate's window opened/);
});

test('Merge check is a field the tool writes: a profile cannot declare it', () => {
  assert.ok(L.TOOL_FIELDS.includes('Merge check'));
});

test('a stale Merge check in a header is reported like a stale Merged or CI, and set --header writes it back from the log', () => {
  const root = approved();
  jarl(root, 'merged', '1', '--sha', 'abc1234', '--ran', 'npm test', '--saw', '3 pass', '--keep');
  const file = issueFile(root, 1);
  writeFileSync(file, readFileSync(file, 'utf8').replace('npm test · saw 3 pass', 'npm test · saw 99 pass'));
  const shown = jarl(root, 'show', '1');
  assert.match(shown, /record: 001 Merge check reads npm test · saw 99 pass in the file and npm test · saw 3 pass in the log/);
  jarl(root, 'set', '1', 'in-progress', '--header');
  assert.match(issueText(root, 1), /^\*\*Merge check:\*\* npm test · saw 3 pass$/m);
  assert.doesNotMatch(jarl(root, 'show', '1'), /record: 001 Merge check/);
});

test('a library merge with ran and saw writes no row either; a Horde-shaped close (merge, then the composer\'s own row) still closes', () => {
  const root = makeLoop({ prefix: 'jarl-proofnotes-', via: 'cli' });
  jarl(root, 'new', 'one', '--acceptance', 'it works');
  R.recordMerged(root, '1', { sha: 'abc1234', ci: 'green', ran: 'npm test', saw: '3 pass' });
  assert.doesNotMatch(issueText(root, 1), /\*\*ran:\*\*/);
  R.addEvidence(root, '1', undefined, { ran: 'composer gate', saw: 'green' });
  assert.match(issueText(root, 1), /^- \*\*ran:\*\* composer gate · \*\*saw:\*\* green$/m);
});
