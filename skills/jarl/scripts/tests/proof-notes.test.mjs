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
import { oldJarl } from './old-jarl.mjs';

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

// ---- where each kind of entry lands -----------------------------------------------------------------------------

// The two parts of an issue's Evidence section: the lines under ### Proof and under ### Notes (null when the heading is not there).
function parts(root, id) {
  const section = evidence(root, id).split('\n').slice(1).join('\n');
  const proof = /^### Proof\n([\s\S]*?)(?=^### Notes$|(?![\s\S]))/m.exec(section);
  const notes = /^### Notes\n([\s\S]*)$/m.exec(section);
  return { section, proof: proof ? proof[1] : null, notes: notes ? notes[1] : null };
}
const fresh = (n = 1) => {
  const root = makeLoop({ prefix: 'jarl-proofnotes-', via: 'cli' });
  for (let k = 1; k <= n; k += 1) jarl(root, 'new', `issue ${k}`, '--acceptance', 'it works');
  return root;
};

test('a row, a note, a ruling, an answer, a Deferred reason and a retraction each land under their heading', () => {
  const root = fresh(2);
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'red');
  jarl(root, 'evidence', '1', 'a free note');
  jarl(root, 'decide', 'probe-ruling', 'the probe settles on the split', '--settles', '1');
  jarl(root, 'ask', 'keep the split?', '--kind', 'ratify', '--issue', '1');
  jarl(root, 'answer', 'a-001', 'kept');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'green');
  jarl(root, 'evidence', '1', '--retract', '1', '--by', 'rev', 'the first run was on the wrong tree');
  jarl(root, 'set', '1', 'deferred', 'waits for the probe of 2');
  const { proof, notes } = parts(root, 1);
  assert.equal(proof.trim(), '- ~~**ran:** npm test · **saw:** red~~\n- **ran:** npm test · **saw:** green');
  const order = ['a free note', 'Ruling probe-ruling', 'Ruling ask-001', '- **retracted:** row 1', 'the first run was on the wrong tree', 'Deferred: waits for the probe of 2'];
  let at = -1;
  for (const piece of order) { const next = notes.indexOf(piece); assert.ok(next > at, `${piece} comes in order under Notes`); at = next; }
  assert.doesNotMatch(proof, /Ruling|free note|retracted|Deferred/);
  assert.doesNotMatch(notes, /\*\*ran:\*\*/);
  assert.equal((evidence(root, 1).match(/^### /gm) || []).length, 2, 'each heading is written once');
  assert.match(evidence(root, 1), /^## Evidence\n\n### Proof\n\n- ~~/, 'Proof comes first');
});

test('a first note opens Notes alone; a row written later opens Proof in front of it', () => {
  const root = fresh();
  jarl(root, 'evidence', '1', 'a first note');
  assert.equal(evidence(root, 1).trim(), '## Evidence\n\n### Notes\n\na first note');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'green');
  assert.equal(evidence(root, 1).trim(), '## Evidence\n\n### Proof\n\n- **ran:** npm test · **saw:** green\n\n### Notes\n\na first note');
  jarl(root, 'evidence', '1', '--ran', 'lint', '--saw', 'clean', '--ran', 'types', '--saw', 'ok');
  const { proof } = parts(root, 1);
  assert.equal(proof.trim(), '- **ran:** npm test · **saw:** green\n- **ran:** lint · **saw:** clean\n- **ran:** types · **saw:** ok');
});

test('a new issue file is what it was: an empty Evidence section until the first entry', () => {
  const root = fresh();
  assert.equal(evidence(root, 1), '## Evidence\n\n');
});

test('free text and a reason cannot hold a line that reads as a sub-heading or a section heading', () => {
  const root = fresh();
  jarl(root, 'evidence', '1', 'first line\n### Proof\n## Why not\ntail');
  const { section, notes } = parts(root, 1);
  assert.equal((section.match(/^### Notes$/gm) || []).length, 1);
  assert.doesNotMatch(section, /^### Proof$/m);
  assert.match(notes, /\\### Proof/);
  assert.match(notes, /\\## Why not/);
  jarl(root, 'set', '1', 'deferred', 'later\n### Notes');
  assert.equal((evidence(root, 1).match(/^### Notes$/gm) || []).length, 1);
  assert.match(evidence(root, 1), /Deferred: later\n\\### Notes/);
});

test('a row written under Notes by a writer that does not know the parts is followed by the next row, and the row numbers hold', () => {
  const root = fresh();
  jarl(root, 'evidence', '1', '--ran', 'one', '--saw', 'ok');
  jarl(root, 'evidence', '1', 'a note');
  // The writer that does not know the parts appends its row at the end of the section, under Notes.
  assert.equal(oldJarl(root, 'evidence', {}, ['1', null, { ran: 'two', saw: 'ok' }]).ok, true);
  assert.equal(parts(root, 1).notes.trim(), 'a note\n- **ran:** two · **saw:** ok');
  jarl(root, 'evidence', '1', '--ran', 'three', '--saw', 'ok');
  const rows = L.evidenceTable(L.findIssue(root, 1).sections.evidence).rows.map((r) => `${r.n}:${r.ran}`);
  assert.deepEqual(rows, ['1:one', '2:two', '3:three']);
  assert.equal(parts(root, 1).notes.trim(), 'a note\n- **ran:** two · **saw:** ok\n- **ran:** three · **saw:** ok', 'the row follows the last row, under Notes');
  // A retraction names the same row after the new one was written.
  jarl(root, 'evidence', '1', '--retract', '2', '--by', 'rev', 'two was the wrong run');
  assert.match(evidence(root, 1), /^- ~~\*\*ran:\*\* two · \*\*saw:\*\* ok~~$/m);
  assert.match(evidence(root, 1), /^- \*\*ran:\*\* one · \*\*saw:\*\* ok$/m);
});

test('a Proof entry that is not a row (an attachment) goes after the last row at the end of Proof, in front of Notes', () => {
  const root = fresh();
  jarl(root, 'evidence', '1', 'a note first');
  const text = L.placeEvidence(L.findIssue(root, 1).sections.evidence, 'proof', '- attachment', '\n');
  assert.equal(text, '### Proof\n\n- attachment\n\n### Notes\n\na note first');
  const withRow = L.placeEvidence('### Proof\n\n- **ran:** a · **saw:** b\n  second line\n\n### Notes\n\nn', 'proof', '- attachment', '\n');
  assert.equal(withRow, '### Proof\n\n- **ran:** a · **saw:** b\n  second line\n- attachment\n\n### Notes\n\nn');
});

test('a section that already holds content and no sub-heading is never converted: every writer appends at its end, as before', () => {
  const root = fresh(1);
  const file = issueFile(root, 1);
  writeFileSync(file, readFileSync(file, 'utf8').replace('## Evidence\n\n', '## Evidence\n\n- **ran:** old · **saw:** ok\n\nan old note\n'));
  // Both writers are the same here: the rows of the section, then the note.
  jarl(root, 'evidence', '1', '--ran', 'next', '--saw', 'ok');
  jarl(root, 'evidence', '1', 'another note');
  jarl(root, 'decide', 'u-ruling', 'a ruling', '--settles', '1');
  jarl(root, 'set', '1', 'deferred', 'wait');
  assert.equal(evidence(root, 1).trim(), '## Evidence\n\n- **ran:** old · **saw:** ok\n\nan old note\n- **ran:** next · **saw:** ok\n\nanother note\n\nRuling u-ruling: a ruling\n\nDeferred: wait');
  assert.doesNotMatch(evidence(root, 1), /^### /m);
});

// ---- the frozen reader --------------------------------------------------------------------------------------------

test('the frozen reader reads a loop in the split form right: done is refused on the merge check alone, accepted on a worker row, and the Deferred reason shows in report; the record format stays', () => {
  const root = approved(2);
  jarl(root, 'new', 'three', '--acceptance', 'it works');
  jarl(root, 'evidence', '2', '--ran', 'npm test', '--saw', 'pass');
  jarl(root, 'evidence', '2', 'a note under Notes');
  jarl(root, 'decide', 'split-ruling', 'the split is read right', '--settles', '2');
  for (const id of ['1', '2']) jarl(root, 'merged', id, '--sha', 'abc1234', '--ran', 'npm test', '--saw', '3 pass', '--keep');
  jarl(root, 'set', '3', 'deferred', 'waits for the probe of 2');
  assert.match(evidence(root, 2), /### Proof[\s\S]*### Notes/);
  assert.equal(L.workEvidence(L.findIssue(root, 1)), '', 'the merge check is not in the section');
  // Issue 1 holds the merge check only: the frozen gate finds no row line.
  const refused = oldJarl(root, 'set', {}, ['1', 'done', 'x', {}]);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /001 has no evidence yet/);
  // Issue 2 holds the worker's row under Proof.
  assert.equal(oldJarl(root, 'set', {}, ['2', 'done', 'x', {}]).ok, true);
  assert.equal(L.findIssue(root, 2).status, 'done');
  // The Deferred reason, under Notes, is the one the frozen report prints.
  const report = oldJarl(root, 'report', {});
  assert.equal(report.ok, true);
  assert.match(JSON.stringify(report.value), /waits for the probe of 2/);
  assert.equal(JSON.parse(jarl(root, 'profile', '--json')).format, 1, 'the split form does not raise the record format');
});

// ---- reading the parts ---------------------------------------------------------------------------------------------

test('show keeps both sub-headings across a reopen: the rows before it are replaced by one line, Notes is printed whole', () => {
  const root = fresh();
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1');
  jarl(root, 'evidence', '1', '--ran', 'first run', '--saw', 'red');
  jarl(root, 'evidence', '1', 'a note from the first round');
  jarl(root, 'set', '1', 'open', 'sent back');
  jarl(root, 'set', '1', 'in-progress', 'again', '--worker', 'w2');
  jarl(root, 'evidence', '1', '--ran', 'second run', '--saw', 'green');
  const shown = jarl(root, 'show', '1');
  assert.match(shown, /^### Proof$/m);
  assert.match(shown, /^### Notes$/m);
  assert.match(shown, /\(evidence rows 1-1 came before the last start or reopen and are not shown; rows 2-2 follow\)/);
  assert.doesNotMatch(shown, /first run/);
  assert.match(shown, /^- \[2\] \*\*ran:\*\* second run/m);
  assert.match(shown, /^a note from the first round$/m);
  const full = jarl(root, 'show', '1', '--full');
  assert.match(full, /^- \[1\] \*\*ran:\*\* first run/m);
  assert.match(full, /^- \[2\] \*\*ran:\*\* second run/m);
  assert.ok(shown.indexOf('### Proof') < shown.indexOf('### Notes'));
});

test('a note alone gives "has no evidence yet", and a sub-heading line is never read as evidence', () => {
  const root = fresh();
  jarl(root, 'evidence', '1', 'a note and nothing else');
  jarl(root, 'review', '1', 'approve', '--by', 'rev', FINDINGS);
  const why = refuses(root, 'set', '1', 'done');
  assert.match(why, /001 has no evidence yet/);
  assert.equal(L.workEvidence(L.findIssue(root, 1)), '');
  assert.equal(L.workEvidence({ sections: { evidence: '### Proof\n\n### Notes\n\nonly a note' } }), '');
  assert.equal(L.workEvidence({ sections: { evidence: '### Proof\n\n- **ran:** a · **saw:** b\n\n### Notes\n\nn\n\n- **ran:** c · **saw:** d' } }), '- **ran:** a · **saw:** b\n\n- **ran:** c · **saw:** d');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass');
  assert.match(jarl(root, 'set', '1', 'done'), /001 → done/);
});
