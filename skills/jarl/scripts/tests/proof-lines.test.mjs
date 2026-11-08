// A proof row names the acceptance lines it proves: evidence --line <n>, repeated or as a comma list. The numbers stand in
// the row's mark, in the issue file and in its log line, where no text of the row reaches; the first such row raises the
// loop to record format 3, and the frozen readers of the formats below it refuse the loop. From that row on, done lists the
// acceptance lines of an issue that no counted row names and closes it only with a reason for those lines, given apart
// from the reason of the move (--without-rows), which it writes beside them, and status and report re-check a closed
// issue against the rule; a loop that never names a line closes as it always did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCRIPT, commandSpans, jarl, loop as makeLoop, refuses, run } from './helpers.mjs';
import { bashBin } from './portable.mjs';
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
const closedGate = (root) => JSON.parse(jarl(root, 'status', '--json')).closedGate;
// A printed command filled as a caller fills it: each placeholder, as Jarl prints it, replaced by a value quoted for a POSIX
// shell, then run through that shell against the loop (sh on macOS and Linux, Git for Windows' bash on Windows).
const unix = (p) => (process.platform === 'win32' ? p.replace(/\\/g, '/') : p);
function runFilled(root, line, fill) {
  let filled = line;
  for (const [hole, value] of Object.entries(fill)) filled = filled.split(`"${hole}"`).join(`'${value.replace(/'/g, `'\\''`)}'`);
  assert.doesNotMatch(filled, /<[a-z][^<>\s]*>/, `every placeholder is filled: ${filled}`);
  const shell = process.platform === 'win32' ? bashBin() : '/bin/sh';
  const r = spawnSync(shell, ['-c', `"$JARL_NODE" "$JARL_SCRIPT" --root "$JARL_LOOP" ${filled.slice('jarl.mjs '.length)}`], { encoding: 'utf8', env: { ...process.env, JARL_NODE: unix(process.execPath), JARL_SCRIPT: unix(SCRIPT), JARL_LOOP: unix(root) }, timeout: 120000 });
  assert.equal(r.status, 0, `${filled}\n${r.stderr}`);
  return r;
}
// The commands a text names, wherever they stand in it.
const printed = (text) => commandSpans(text).map((s) => s.raw);

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
  assert.match(jarl(root, 'brief', '1'), /evidence 001 --ran "<command>" --saw "<what-it-printed>" --line "<line-number>" --by "<who>"/, 'a worker of a loop that names lines is told to name them');
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
  assert.match(over, /^001 has 3 acceptance lines: there is no line 4\njarl\.mjs evidence "<ids>" --ran "<command>" --saw "<what-it-printed>" --line "<line-number>"\n$/);
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

// What done says of 001 of a loop of two issues whose rows name its line 1 alone.
const UNNAMED = '001 has acceptance lines no Proof row names: line 2 "the header row is kept"; line 3 "an empty table writes an empty file" — this loop names the line a row proves, and a row with no --line names none; the reason a move gives is the move\'s, and no reason for these lines: record a row that names each, jarl.mjs evidence 001 --ran "<command>" --saw "<what-it-printed>" --line "<line-number>", or close it without one and give the reason apart: jarl.mjs set 001 done "<why>" --without-rows "<why-no-row-names-the-lines>"';

test('in a loop that names lines, done lists each acceptance line no counted row names and refuses a close with no reason or with the reason of the move alone, ending with the form that gives the reason for those lines apart; with it, it closes and writes that reason beside the lines', () => {
  const root = formatOne(2);
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1');
  jarl(root, 'evidence', '2', '--ran', 'npm test', '--saw', 'pass 3');
  approve(root, '1'); approve(root, '2');
  const was = [log(root), readFileSync(file(root, '1'), 'utf8')];
  assert.equal(refuses(root, 'set', '1', 'done'), `${UNNAMED}\njarl.mjs set "<ids>" "<status>" --without-rows "<why-no-row-names-the-lines>"\n`);
  assert.equal(refuses(root, 'set', '1', 'done', 'merged into the release branch'), `${UNNAMED}\njarl.mjs set "<ids>" "<status>" "<why>" --without-rows "<why-no-row-names-the-lines>"\n`, 'the reason of the move is no reason for the lines');
  assert.deepEqual([log(root), readFileSync(file(root, '1'), 'utf8')], was, 'nothing was written');
  assert.match(refuses(root, 'set', '2', 'done', 'merged'), /^002 has acceptance lines no Proof row names: line 1 "the export writes csv"; line 2 .*; line 3 /, 'a row with no --line proves no line of an issue in such a loop');
  const done = run(root, ['set', '1', 'done', 'merged into the release branch', '--without-rows', 'lines 2 and 3 are covered by the csv suite of issue 2']);
  assert.equal(done.status, 0, done.stderr);
  assert.equal(done.stdout, '001 → done');
  assert.match(done.stderr, /note: 001 closed without a row naming acceptance line 2, 3, on the reason written under Evidence/);
  assert.match(evidenceOf(root, '1'), /^Done without a row naming acceptance line 2, 3: lines 2 and 3 are covered by the csv suite of issue 2$/m);
  assert.doesNotMatch(evidenceOf(root, '1'), /merged into the release branch/, 'the reason of the move stays the move\'s');
  assert.match(log(root), /^- \S+ \S+ · 001 → done · merged into the release branch$/m, 'the close is logged as any close is');
  assert.match(jarl(root, 'show', '1'), /Done without a row naming acceptance line 2, 3: lines 2 and 3/, 'show shows it');
  assert.match(jarl(root, 'report'), /^- 001 export 1 \(\w+\) · closed without a row naming acceptance line 2, 3$/m, 'report says it');
  assert.deepEqual(closedGate(root), [], 'the closed gate holds');
  // A row that names every line closes with no reason for lines, and the reply says nothing of lines.
  jarl(root, 'evidence', '2', '--ran', 'npm run csv', '--saw', 'pass 9', '--line', '1,2,3');
  const two = run(root, ['set', '2', 'done', 'merged']);
  assert.equal(two.status, 0, two.stdout);
  assert.doesNotMatch(two.stderr, /acceptance/);
  assert.doesNotMatch(jarl(root, 'report'), /002 .*without a row/);
});

test('the form a refusal for unnamed lines ends with, and the close the note after an approve names, filled and pasted into a shell, close the issue with the reason for the lines', () => {
  const root = formatOne(2);
  for (const id of ['1', '2']) jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'pass 3', '--line', '1');
  approve(root, '1');
  const form = refuses(root, 'set', '1', 'done', 'merged').trim().split('\n').at(-1);
  runFilled(root, form, { '<ids>': '1', '<status>': 'done', '<why>': 'merged', '<why-no-row-names-the-lines>': "lines 2 and 3 are the csv suite's, run in issue 2" });
  assert.match(evidenceOf(root, '1'), /^Done without a row naming acceptance line 2, 3: lines 2 and 3 are the csv suite's, run in issue 2$/m);
  const note = run(root, ['review', '2', 'approve', '--by', 'rev1', 'read the diff, nothing found']).stderr;
  const close = printed(note).find((c) => / set /.test(c));
  assert.equal(close, 'jarl.mjs set 002 done "<why>" --without-rows "<why-no-row-names-the-lines>"');
  runFilled(root, close, { '<why>': 'merged', '<why-no-row-names-the-lines>': 'the header and the empty table are checked by hand in the demo' });
  assert.match(evidenceOf(root, '2'), /^Done without a row naming acceptance line 2, 3: the header and the empty table are checked by hand in the demo$/m);
  // Pasted unfilled, each writes nothing.
  const fresh = formatOne();
  jarl(fresh, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1');
  approve(fresh, '1');
  const before = [log(fresh), readFileSync(file(fresh, '1'), 'utf8')];
  assert.match(refuses(fresh, 'set', '1', 'done', 'merged', '--without-rows', '<why-no-row-names-the-lines>'), /placeholder/);
  assert.deepEqual([log(fresh), readFileSync(file(fresh, '1'), 'utf8')], before);
});

test('--without-rows gives the reason for lines no row names, and is refused with nothing written where it gives a reason for nothing: on a move that does not close, in a loop that names no line, on issues whose every line a row names, and with no words', () => {
  const root = formatOne(3);
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1,2,3');
  jarl(root, 'evidence', '2', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1');
  approve(root, '1'); approve(root, '2');
  const was = () => [log(root), ...['1', '2', '3'].map((id) => readFileSync(file(root, id), 'utf8'))];
  const before = was();
  assert.equal(refuses(root, 'set', '3', 'deferred', 'later', '--without-rows', 'the lines wait too'), '--without-rows gives the reason a close leaves acceptance lines no row names, so it goes with done only, not with deferred\njarl.mjs set "<ids>" "<status>" "<why>"\n');
  assert.equal(refuses(root, 'set', '1', 'done', 'merged', '--without-rows', 'covered elsewhere'), 'every acceptance line of 001 is named by a counted row, so no line is left for a reason: leave --without-rows out\njarl.mjs set "<ids>" "<status>" "<why>"\n');
  assert.match(refuses(root, 'set', '1', 'done', 'merged', '--without-rows', '  '), /^--without-rows needs words: why no row names the acceptance lines the close leaves\njarl\.mjs set "<ids>" "<status>" "<why>" --without-rows "<why-no-row-names-the-lines>"\n$/);
  assert.deepEqual(was(), before, 'nothing was written');
  // On several issues, the reason goes to each issue that leaves lines without a row, and the others close as they would.
  const both = run(root, ['set', '1,2', 'done', 'merged', '--without-rows', 'lines 2 and 3 of issue 2 are checked in issue 1']);
  assert.equal(both.status, 0, both.stderr);
  assert.doesNotMatch(evidenceOf(root, '1'), /without a row/);
  assert.match(evidenceOf(root, '2'), /^Done without a row naming acceptance line 2, 3: lines 2 and 3 of issue 2 are checked in issue 1$/m);
  const plain = formatOne();
  jarl(plain, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3');
  approve(plain, '1');
  const plainBefore = [log(plain), readFileSync(file(plain, '1'), 'utf8')];
  assert.equal(refuses(plain, 'set', '1', 'done', 'merged', '--without-rows', 'covered elsewhere'), 'this loop names no acceptance line by a row (evidence --line), so a close asks no reason for one: leave --without-rows out\njarl.mjs set "<ids>" "<status>" "<why>"\n');
  assert.deepEqual([log(plain), readFileSync(file(plain, '1'), 'utf8')], plainBefore);
  assert.equal(existsSync(profileFile(plain)), false, 'the loop is not raised');
});

test('a close through the record library keeps its meaning: its reason is the move\'s, the reason for unnamed lines is the without-rows key, and a loop that names no line closes as before', () => {
  const root = formatOne();
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1');
  approve(root, '1');
  assert.throws(() => R.setStatus(root, '1', 'done', 'merged'), /^Error: 001 has acceptance lines no Proof row names: line 2 "the header row is kept"; line 3 "an empty table writes an empty file" — .*--without-rows "<why-no-row-names-the-lines>"/);
  assert.equal(R.findIssue(root, '1').status, 'open', 'nothing was written');
  assert.deepEqual(R.setStatus(root, '1', 'done', 'merged', { 'without-rows': 'the csv suite covers lines 2 and 3' }), { id: '001', status: 'done', note: 'closed without a row naming acceptance line 2, 3, on the reason written under Evidence' });
  assert.match(evidenceOf(root, '1'), /^Done without a row naming acceptance line 2, 3: the csv suite covers lines 2 and 3$/m);
  const plain = formatOne();
  jarl(plain, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3');
  approve(plain, '1');
  assert.deepEqual(R.setStatus(plain, '1', 'done', 'merged'), { id: '001', status: 'done', note: '3 acceptance line(s), 1 --ran/--saw row(s)' });
});

test('the owner closes an issue with a line only he ticks, and a waiver closes one without a review, each giving the reason for the lines no row names apart from the reason of the move', () => {
  const root = formatOne();
  jarl(root, 'field', '1', 'Acceptance', `${LINES[0]}\n${LINES[1]}\n[owner] the chart reads well · material: the chart in the report · check: the axis labels are readable`);
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1');
  approve(root, '1');
  jarl(root, 'tick', '1', '3', '--by', 'owner');
  assert.match(refuses(root, 'set', '1', 'done', 'I looked at it', '--by', 'owner'), /^001 has acceptance lines no Proof row names: line 2 "the header row is kept" — /, 'his tick proves his line, and no other');
  const owned = run(root, ['set', '1', 'done', 'I looked at it', '--without-rows', 'I checked the header myself', '--by', 'owner']);
  assert.equal(owned.status, 0, owned.stderr);
  assert.match(evidenceOf(root, '1'), /^Done without a row naming acceptance line 2: I checked the header myself$/m);
  const waived = formatOne();
  jarl(waived, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1,2');
  jarl(waived, 'decide', 'no-review-for-1', 'Issue 1 closes without a review: the export is a copy of the old one.', '--by', 'owner', '--quote', 'No review for that one.', '--waives-review', '1');
  assert.match(refuses(waived, 'set', '1', 'done', 'waived by the owner', '--by', 'jarl'), /^001 has acceptance lines no Proof row names: line 3 "an empty table writes an empty file" — /, 'the waiver stands in for the review, never for a row');
  const closed = run(waived, ['set', '1', 'done', 'waived by the owner', '--without-rows', 'the empty table is the old export\'s case, unchanged', '--by', 'jarl']);
  assert.equal(closed.status, 0, closed.stderr);
  assert.match(evidenceOf(waived, '1'), /^Done without a row naming acceptance line 3: the empty table is the old export's case, unchanged$/m);
});

test('a closed issue is read against the line rule again: a line a counted row named at the close and none names now is flagged in status and report until a row names it again, and a line the close gave its reason for is not', () => {
  const root = formatOne(3);
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1,3');
  jarl(root, 'evidence', '1', '--ran', 'npm run header', '--saw', 'pass 1', '--line', '2');
  approve(root, '1'); jarl(root, 'set', '1', 'done', 'merged');
  jarl(root, 'evidence', '2', '--ran', 'npm test', '--saw', 'pass 2', '--line', '1');
  jarl(root, 'evidence', '2', '--ran', 'npm run header', '--saw', 'pass 1', '--line', '2');
  approve(root, '2'); jarl(root, 'set', '2', 'done', 'merged', '--without-rows', 'line 3 is the empty table, checked by the csv suite');
  jarl(root, 'evidence', '3', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1,2,3');
  approve(root, '3'); jarl(root, 'set', '3', 'done', 'merged');
  assert.deepEqual(closedGate(root), []);
  jarl(root, 'retract', '1', '2', 'it ran on another branch', '--by', 'rev1');
  jarl(root, 'retract', '2', '1', 'it ran on another branch', '--by', 'rev1');
  const flagged = closedGate(root);
  // The repair is read from its start: it carries the call's --root, written as each platform writes it.
  assert.deepEqual(flagged.map(({ id, reason }) => ({ id, reason })), [
    { id: '001', reason: 'no counted row names acceptance line 2 now, and the close counted one and gave no reason for it' },
    { id: '002', reason: 'no counted row names acceptance line 1 now, and the close counted one and gave no reason for it' },
  ]);
  flagged.forEach((f) => assert.match(f.repair, new RegExp(`^jarl\\.mjs evidence ${f.id} --ran "<command>" --saw "<what-it-printed>" --line "<line-number>"`)));
  const report = jarl(root, 'report');
  assert.match(report, /^## Closed, gate does not hold \(2\)$/m);
  assert.match(report, /^- 001 export 1 \(\w+\)$/m, 'the line lost after the close is not one the close left without a row');
  assert.match(report, /^- 002 export 2 \(\w+\) · closed without a row naming acceptance line 3$/m, 'the line the close gave its reason for stays so');
  assert.match(jarl(root, 'status'), /001.*no counted row names acceptance line 2 now/);
  jarl(root, 'evidence', '1', '--ran', 'npm run header', '--saw', 'pass 1', '--line', '2');
  assert.deepEqual(closedGate(root).map((f) => f.id), ['002'], 'a row that names the line again repairs it');
});

test('the re-check after a close leaves every other closed issue as it read: in a loop that names no line, and for an issue closed ahead of the loop\'s first row that names one, a retraction after the close says what it said before', () => {
  const plain = formatOne();
  jarl(plain, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3');
  jarl(plain, 'evidence', '1', '--ran', 'npm run header', '--saw', 'pass 1');
  approve(plain, '1'); jarl(plain, 'set', '1', 'done', 'merged');
  jarl(plain, 'retract', '1', '2', 'it ran on another branch', '--by', 'rev1');
  assert.deepEqual(closedGate(plain), [], 'a counted row is left, and the loop names no line');
  jarl(plain, 'retract', '1', '1', 'it ran on another branch', '--by', 'rev1');
  assert.deepEqual(closedGate(plain).map((f) => f.reason), ['its proof row was retracted']);
  const before = formatOne(2);
  jarl(before, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3');
  jarl(before, 'evidence', '1', '--ran', 'npm run header', '--saw', 'pass 1');
  approve(before, '1'); jarl(before, 'set', '1', 'done', 'merged');
  jarl(before, 'evidence', '2', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1');
  jarl(before, 'retract', '1', '2', 'it ran on another branch', '--by', 'rev1');
  assert.deepEqual(closedGate(before), [], 'an issue closed before the rule keeps its gate');
  assert.match(jarl(before, 'report'), /^- 001 export 1 \(\w+\)$/m);
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

test('an approve in a loop that names lines says which acceptance lines no row names, and that done closes it only with a reason for them, given apart from the reason of the move', () => {
  const root = formatOne();
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '2');
  const said = run(root, ['review', '1', 'approve', '--by', 'rev1', 'read the diff, nothing found']);
  assert.equal(said.status, 0, said.stderr);
  assert.match(said.stderr, /note: 001: no Proof row names acceptance line 1, 3, and done closes it only with a reason for those lines, given apart from the reason of the move: jarl\.mjs set 001 done "<why>" --without-rows "<why-no-row-names-the-lines>", or a row that names each, jarl\.mjs evidence 001 --ran "<command>" --saw "<what-it-printed>" --line "<line-number>"/);
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1,3');
  assert.doesNotMatch(run(root, ['review', '1', 'approve', '--by', 'rev2', 'read the diff again, nothing found']).stderr, /no Proof row names/);
});

test('a split that moves or renumbers an acceptance line a row of the parent names says so, as field does, and one that leaves those numbers as they were says nothing', () => {
  const root = formatOne(4);
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1,3');
  const moved = run(root, ['split', '1', '--line', '1=1', '--line', '2=2', '--line', '3=1']);
  assert.equal(moved.status, 0, moved.stderr);
  assert.equal(moved.stderr, "note: 001's evidence rows name acceptance line 3 by number, and a row keeps the number it named: check that each still names the line it proves, and record a row with --line for a line whose number moved");
  assert.deepEqual(JSON.parse(jarl(root, 'show', '1', '--json')).evidenceRows.map((r) => r.lines), [[1, 3]], 'the row keeps the numbers it named');
  jarl(root, 'evidence', '3', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1,2');
  const kept = run(root, ['split', '3', '--line', '1=3', '--line', '2=3', '--line', '3=4']);
  assert.equal(kept.status, 0, kept.stderr);
  assert.doesNotMatch(kept.stderr, /keeps the number it named/, 'lines 1 and 2 keep their numbers');
});

test('the number of an acceptance line has a placeholder of its own, apart from the text of one: --line and tick print <line-number>, an acceptance line to write prints <line>', () => {
  assert.ok(L.PLACEHOLDERS.includes('<line-number>') && L.PLACEHOLDERS.includes('<line>'), 'both are in the registry');
  const root = formatOne();
  fileAsBefore(root, 'no acceptance yet', {});
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1');
  assert.match(refuses(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass', '--line', '4'), /\njarl\.mjs evidence "<ids>" --ran "<command>" --saw "<what-it-printed>" --line "<line-number>"\n$/);
  assert.match(refuses(root, 'evidence', '2', '--ran', 'npm test', '--saw', 'pass', '--line', '1'), /write the acceptance first, jarl\.mjs field 002 Acceptance "<line>"\n/);
  assert.match(refuses(root, 'tick', '1', 'two', '--by', 'owner'), /\njarl\.mjs tick "<id>" "<line-number>"/);
  assert.match(jarl(root, 'brief', '1'), /--line "<line-number>"/);
  assert.match(refuses(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass', '--line', '<line-number>'), /placeholder/, 'pasted unfilled, it writes nothing');
});
