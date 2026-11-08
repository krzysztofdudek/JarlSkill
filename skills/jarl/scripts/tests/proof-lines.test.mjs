// A proof row names the acceptance lines it proves: evidence --line <n>, repeated or as a comma list. The numbers stand in
// the row's mark, in the issue file and in its log line, where no text of the row reaches; the first such row raises the
// loop to record format 3, and the frozen readers of the formats below it refuse the loop. From that row on, done lists the
// acceptance lines of an issue that no counted row names and closes it only with a reason, which it writes beside them; a
// loop that never names a line closes as it always did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jarl, loop as makeLoop, refuses, run } from './helpers.mjs';
import { fileAsBefore, formatTwoJarl, oldJarl } from './old-jarl.mjs';

const L = await import('../jarl-lib.mjs');
const R = await import('../record.mjs');

const LINES = ['the export writes csv', 'the header row is kept', 'an empty table writes an empty file'];
// A loop of record format 1: its issues filed by the pinned frozen reader, with three acceptance lines each.
function formatOne(n = 1) {
  const root = makeLoop({ prefix: 'jarl-lines-', via: 'cli' });
  for (let k = 1; k <= n; k += 1) fileAsBefore(root, `export ${k}`, { acceptance: LINES.join('\n') });
  return root;
}
const log = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const file = (root, id) => JSON.parse(jarl(root, 'show', id, '--json')).file;
const evidenceOf = (root, id) => readFileSync(file(root, id), 'utf8').split('## Evidence')[1];
const approve = (root, id) => jarl(root, 'review', id, 'approve', '--by', 'rev1', 'read the diff, nothing found');
const profileFile = (root) => join(root, '.jarl', 'profile.json');

test('a row names the acceptance lines it proves, by --line repeated or as a comma list, in its mark in the issue file and in its log line, and every view that reads rows reads them', () => {
  const root = formatOne();
  assert.equal(jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '3', '--line', '1'), '001 evidence row recorded for acceptance line 1, 3');
  jarl(root, 'evidence', '1', '--ran', 'npm run lint', '--saw', 'clean', '--line', '2,2');
  jarl(root, 'evidence', '1', '--ran', 'node check.mjs', '--saw', 'ok');
  assert.match(evidenceOf(root, '1'), /^- \*\*ran \(line 1, 3\):\*\* npm test · \*\*saw:\*\* pass 3$/m);
  assert.match(evidenceOf(root, '1'), /^- \*\*ran \(line 2\):\*\* npm run lint · \*\*saw:\*\* clean$/m);
  assert.match(evidenceOf(root, '1'), /^- \*\*ran:\*\* node check\.mjs · \*\*saw:\*\* ok$/m, 'a row with no --line keeps its plain mark');
  assert.match(log(root), /^- \S+ \S+ · 001 evidence row \(line 1, 3\) · npm test$/m);
  assert.match(log(root), /^- \S+ \S+ · 001 evidence row \(line 2\) · npm run lint$/m);
  assert.match(jarl(root, 'show', '1'), /^- \[1\] \*\*ran \(line 1, 3\):\*\* npm test/m, 'show prints the lines a row names');
  assert.deepEqual(JSON.parse(jarl(root, 'show', '1', '--json')).evidenceRows.map((r) => r.lines ?? null), [[1, 3], [2], null]);
  assert.deepEqual(R.evidenceRows(R.findIssue(root, '1')), [{ ran: 'npm test', saw: 'pass 3', lines: [1, 3] }, { ran: 'npm run lint', saw: 'clean', lines: [2] }, { ran: 'node check.mjs', saw: 'ok' }]);
  assert.match(jarl(root, 'brief', '1'), /^- \[1\] ran \(line 1, 3\): npm test · saw: pass 3$/m, 'the brief prints them');
  assert.match(jarl(root, 'brief', '1'), /evidence 001 --ran "<command>" --saw "<what-it-printed>" --line "<line>" --by "<who>"/, 'a worker of a loop that names lines is told to name them');
  const g = L.gateState(root, '1');
  assert.deepEqual(g.rowLog.map((r) => r.lines ?? null), [[1, 3], [2], null], 'the done gate reads them from the log');
  // A retraction matches a row that names lines to its own log line.
  jarl(root, 'retract', '1', '2', 'the lint ran on another branch', '--by', 'rev1');
  assert.match(evidenceOf(root, '1'), /^- ~~\*\*ran \(line 2\):\*\* npm run lint · \*\*saw:\*\* clean~~$/m);
  assert.equal(run(root, ['verify']).status, 0, 'verify places every line');
  // The record library takes the lines as the line key.
  R.addEvidence(root, '1', undefined, { ran: 'npm run e2e', saw: 'pass 1', line: [2] });
  assert.match(evidenceOf(root, '1'), /^- \*\*ran \(line 2\):\*\* npm run e2e · \*\*saw:\*\* pass 1$/m);
});

test('the first row that names a line raises a loop of record format 1 to 3, and the pinned frozen readers of format 1 and of formats 1 and 2 refuse it with their own message; a loop that never names one stays as it was', () => {
  const plain = formatOne();
  jarl(plain, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3');
  assert.equal(existsSync(profileFile(plain)), false, 'rows with no --line raise nothing');
  assert.equal(oldJarl(plain, 'status', {}).ok, true);
  const root = formatOne();
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1');
  assert.deepEqual(JSON.parse(readFileSync(profileFile(root), 'utf8')), { 'jarl-profile': 1, format: 3 });
  for (const command of ['list', 'status']) {
    const one = oldJarl(root, command, {});
    assert.equal(one.ok, false, command);
    assert.match(one.error, /written for record format 3, and this Jarl reads format 1 — /, command);
    const two = formatTwoJarl(root, command, {});
    assert.equal(two.ok, false, command);
    assert.match(two.error, /written for record format 3, and this Jarl reads format 1, 2 — nothing was read or written; the reader needs a Jarl that knows format 3/, command);
  }
});

test('a --line the issue has no line for, a number that is no line, a --line on a note and a --line on an issue with no acceptance line are refused with the form of the call, and nothing is written', () => {
  const root = formatOne(2);
  fileAsBefore(root, 'no acceptance yet', {});
  const before = () => [log(root), existsSync(profileFile(root)), readFileSync(file(root, '1'), 'utf8'), readFileSync(file(root, '2'), 'utf8')];
  const was = before();
  const over = refuses(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass', '--line', '1,4');
  assert.match(over, /^001 has 3 acceptance lines: there is no line 4\njarl\.mjs evidence "<ids>" --ran "<command>" --saw "<what-it-printed>" --line "<line>"\n$/);
  assert.match(refuses(root, 'evidence', '1,2', '--ran', 'npm test', '--saw', 'pass', '--line', '5'), /^001 has 3 acceptance lines: there is no line 5 — nothing was written\n/);
  for (const bad of ['0', 'two', '-1x']) assert.match(refuses(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass', `--line=${bad}`), /--line takes the number of an acceptance line, 1 for the first, got|an item cannot start with -/, bad);
  assert.match(refuses(root, 'evidence', '1', 'a note', '--line', '1'), /^--line names the acceptance lines a --ran\/--saw row proves, and a free-text note proves none: record the row, or leave --line out\njarl\.mjs evidence "<ids>" "<text>"\n$/);
  assert.match(refuses(root, 'evidence', '3', '--ran', 'npm test', '--saw', 'pass', '--line', '1'), /^003 has no acceptance line, so a row of it names none: leave --line out, or write the acceptance first, jarl\.mjs field 003 Acceptance "<line>"\njarl\.mjs evidence "<ids>" --ran "<command>" --saw "<what-it-printed>"\n$/);
  assert.deepEqual(before(), was, 'nothing was written and nothing raised');
});

test('a loop whose profile names an external scheduler refuses a row that names a line below record format 3, with nothing written', () => {
  const prof = join(mkdtempSync(join(tmpdir(), 'jarl-lines-profile-')), 'composed.json');
  writeFileSync(prof, JSON.stringify({ 'jarl-profile': 1, name: 'composed', statuses: L.BUILTIN_STATUSES, 'external-scheduler': 'the composer tick' }));
  const root = makeLoop({ prefix: 'jarl-lines-composed-', via: 'cli', initFlags: ['--profile', prof] });
  R.newIssue(root, 'export', { acceptance: LINES[0] });
  const was = log(root);
  assert.throws(() => R.addEvidence(root, '1', undefined, { ran: 'npm test', saw: 'pass', line: 1 }), /the acceptance lines an evidence row proves needs record format 3, and this loop stays at format 1: its profile names an external scheduler/);
  assert.equal(log(root), was);
  assert.doesNotMatch(readFileSync(R.findIssue(root, '1').file, 'utf8'), /\*\*ran/);
});

test('in a loop that names lines, done lists each acceptance line no counted row names and refuses without a reason, ending with the form of the close that gives one; with the reason it closes and writes the reason beside the lines', () => {
  const root = formatOne(2);
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1');
  jarl(root, 'evidence', '2', '--ran', 'npm test', '--saw', 'pass 3');
  approve(root, '1'); approve(root, '2');
  const said = refuses(root, 'set', '1', 'done');
  assert.match(said, /^001 has acceptance lines no Proof row names: line 2 "the header row is kept"; line 3 "an empty table writes an empty file" — this loop names the line a row proves, and a row with no --line names none: record a row that names each, jarl\.mjs evidence 001 --ran "<command>" --saw "<what-it-printed>" --line "<line>", or close it without one and say why: jarl\.mjs set 001 done "<why>"\njarl\.mjs set "<ids>" "<status>" "<why>"\n$/);
  assert.match(refuses(root, 'set', '2', 'done'), /^002 has acceptance lines no Proof row names: line 1 "the export writes csv"; line 2 .*; line 3 /, 'a row with no --line proves no line of an issue in such a loop');
  const done = run(root, ['set', '1', 'done', 'lines 2 and 3 are covered by the csv suite of issue 2']);
  assert.equal(done.status, 0, done.stderr);
  assert.equal(done.stdout, '001 → done');
  assert.match(done.stderr, /note: 001 closed without a row naming acceptance line 2, 3, on the reason written under Evidence/);
  assert.match(evidenceOf(root, '1'), /^Done without a row naming acceptance line 2, 3: lines 2 and 3 are covered by the csv suite of issue 2$/m);
  assert.match(jarl(root, 'show', '1'), /Done without a row naming acceptance line 2, 3: lines 2 and 3/, 'show shows it');
  assert.match(jarl(root, 'report'), /^- 001 export 1 \(\w+\) · closed without a row naming acceptance line 2, 3$/m, 'report says it');
  assert.deepEqual(JSON.parse(jarl(root, 'status', '--json')).closedGate, [], 'the closed gate holds');
  // A row that names every line closes with no reason, and the reply says nothing of lines.
  jarl(root, 'evidence', '2', '--ran', 'npm run csv', '--saw', 'pass 9', '--line', '1,2,3');
  const two = run(root, ['set', '2', 'done']);
  assert.equal(two.status, 0, two.stdout);
  assert.doesNotMatch(two.stderr, /acceptance/);
  assert.doesNotMatch(jarl(root, 'report'), /002 .*without a row/);
});

test('the rows done counts decide: a retracted row, or one from before a reopen, names no line, and a line only the owner ticks is proved by his tick', () => {
  const root = formatOne();
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1,2,3');
  jarl(root, 'evidence', '1', '--ran', 'npm run edge', '--saw', 'pass 1', '--line', '3');
  approve(root, '1');
  jarl(root, 'retract', '1', '1', 'it ran on another branch', '--by', 'rev1');
  assert.match(refuses(root, 'set', '1', 'done'), /^001 has acceptance lines no Proof row names: line 1 "the export writes csv"; line 2 "the header row is kept" — /);
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1,2');
  jarl(root, 'set', '1', 'done');
  jarl(root, 'set', '1', 'open', 'a gap came up');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1');
  approve(root, '1');
  assert.match(refuses(root, 'set', '1', 'done'), /no Proof row names: line 2 .*; line 3 /, 'rows from before the reopen name nothing');
  const owner = formatOne();
  jarl(owner, 'field', '1', 'Acceptance', `${LINES[0]}\n[owner] the chart reads well · material: the chart in the report · check: the axis labels are readable`);
  jarl(owner, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1');
  approve(owner, '1');
  const held = run(owner, ['set', '1', 'done']);
  assert.notEqual(held.status, 0, 'done waits for the owner\'s tick');
  assert.doesNotMatch(`${held.stdout}\n${held.stderr}`, /no Proof row names/, 'the owner line is his tick\'s to prove, not a row\'s');
});

test('a loop that names no line closes as before: fewer rows than acceptance lines are noted, never refused, and the closed issues of a loop keep their gate when it begins to name lines', () => {
  const root = formatOne(2);
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3');
  approve(root, '1');
  const closed = run(root, ['set', '1', 'done']);
  assert.equal(closed.status, 0);
  assert.match(closed.stderr, /note: 001 3 acceptance line\(s\), 1 --ran\/--saw row\(s\)/);
  const before = JSON.parse(jarl(root, 'status', '--json')).closedGate;
  const reportBefore = jarl(root, 'report');
  jarl(root, 'evidence', '2', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1');
  assert.deepEqual(JSON.parse(jarl(root, 'status', '--json')).closedGate, before, 'the first row that names a line leaves every closed issue\'s gate as it was');
  assert.match(jarl(root, 'report'), /^- 001 export 1 \(\w+\)$/m, 'an issue closed before the loop named lines is not said to lack them');
  assert.match(reportBefore, /^- 001 export 1 \(\w+\)$/m);
});

test('a rewritten acceptance keeps the numbers the rows named, and field says so where rows name any', () => {
  const root = formatOne();
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1,3');
  const said = run(root, ['field', '1', 'Acceptance', `a new first line\n${LINES.join('\n')}`]);
  assert.equal(said.status, 0, said.stderr);
  assert.match(`${said.stdout}\n${said.stderr}`, /note: 001's evidence rows name acceptance line 1, 3 by number, and a row keeps the number it named: check that each still names the line it proves, and record a row with --line for a line whose number moved/);
  approve(root, '1');
  assert.match(refuses(root, 'set', '1', 'done'), /no Proof row names: line 2 "the export writes csv"; line 4 "an empty table writes an empty file" — /, 'the rows name lines 1 and 3 as the acceptance holds them now');
  const quiet = formatOne();
  jarl(quiet, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3');
  const plain = run(quiet, ['field', '1', 'Acceptance', 'one line']);
  assert.doesNotMatch(`${plain.stdout}\n${plain.stderr}`, /keeps the number it named/, 'rows that name no line say nothing');
});

test('an approve in a loop that names lines says which acceptance lines no row names, and that done closes it only with a reason', () => {
  const root = formatOne();
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '2');
  const said = run(root, ['review', '1', 'approve', '--by', 'rev1', 'read the diff, nothing found']);
  assert.equal(said.status, 0, said.stderr);
  assert.match(said.stderr, /note: 001: no Proof row names acceptance line 1, 3, and done closes it only with a reason given: jarl\.mjs set 001 done "<why>", or a row that names each, jarl\.mjs evidence 001 --ran "<command>" --saw "<what-it-printed>" --line "<line>"/);
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1,3');
  assert.doesNotMatch(run(root, ['review', '1', 'approve', '--by', 'rev2', 'read the diff again, nothing found']).stderr, /no Proof row names/);
});
