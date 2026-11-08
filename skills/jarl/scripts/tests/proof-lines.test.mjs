// A proof row names the acceptance lines it proves: evidence --line <n>, repeated or as a comma list. The caller names a
// line by its number and the row stores a digest of the line's text, in the row's mark in the issue file and in its log
// line, where no text of the row reaches; every view that reads rows reads them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { commandSpans, jarl, loop as makeLoop, refuses, run } from './helpers.mjs';

const L = await import('../jarl-lib.mjs');
const R = await import('../record.mjs');

const LINES = ['[test] the export writes csv', '[test] the header row is kept', '[read] an empty table writes an empty file'];
const makeRoot = () => {
  const root = makeLoop({ prefix: 'jarl-lines-', via: 'cli' });
  jarl(root, 'new', 'export 1', ...LINES.flatMap((l) => ['--acceptance', l]));
  return root;
};
const log = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const issueFile = (root, id) => JSON.parse(jarl(root, 'show', id, '--json')).file;
const evidenceOf = (root, id) => readFileSync(issueFile(root, id), 'utf8').split('## Evidence')[1];
const approve = (root, id) => jarl(root, 'review', id, 'approve', '--by', 'rev1', 'read the diff, nothing found');
const printed = (text) => commandSpans(text).map((s) => s.raw);
const digestOf = (root, n) => L.lineDigest(LINES[n - 1]);

test('a row names the acceptance lines it proves, by --line repeated or as a comma list, as the digest of each line in its mark in the issue file and in its log line, and every view that reads rows reads them', () => {
  const root = makeRoot();
  assert.equal(jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '3', '--line', '1'), '1 evidence row recorded for acceptance line 1, 3');
  jarl(root, 'evidence', '1', '--ran', 'npm run lint', '--saw', 'clean', '--line', '2,2');
  const one = digestOf(root, 1); const two = digestOf(root, 2); const three = digestOf(root, 3);
  assert.match(evidenceOf(root, '1'), new RegExp(`^- \\*\\*ran \\(line ${one}, ${three}\\):\\*\\* npm test · \\*\\*saw:\\*\\* pass 3$`, 'm'));
  assert.match(evidenceOf(root, '1'), new RegExp(`^- \\*\\*ran \\(line ${two}\\):\\*\\* npm run lint · \\*\\*saw:\\*\\* clean$`, 'm'));
  assert.match(log(root), new RegExp(`^- \\S+ \\S+(?: key \\S+)? · 1 evidence row \\(line ${one}, ${three}\\) · npm test$`, 'm'));
  assert.match(log(root), new RegExp(`^- \\S+ \\S+(?: key \\S+)? · 1 evidence row \\(line ${two}\\) · npm run lint$`, 'm'));
  assert.match(jarl(root, 'show', '1'), /^- \[1\] \*\*ran \(line 1, 3\):\*\* npm test/m, 'show prints the numbers the lines carry now');
  assert.deepEqual(JSON.parse(jarl(root, 'show', '1', '--json')).evidenceRows.map((r) => r.lines ?? null), [[one, three], [two]]);
  assert.deepEqual(R.evidenceRows(R.findIssue(root, '1')), [{ ran: 'npm test', saw: 'pass 3', lines: [one, three] }, { ran: 'npm run lint', saw: 'clean', lines: [two] }]);
  assert.match(jarl(root, 'brief', '1'), /^- \[1\] ran \(line 1, 3\): npm test · saw: pass 3$/m, 'the brief prints the numbers');
  assert.match(jarl(root, 'brief', '1'), /evidence 1 --ran "<command>" --saw "<what-it-printed>" --line "<line-number>" --by "<who>"/, 'a worker is told to name the line and who ran it');
  const g = L.gateState(root, '1');
  assert.deepEqual(g.rowLog.map((r) => r.lines ?? null), [[one, three], [two]], 'the done gate reads them from the log');
  // A retraction matches a row that names lines to its own log line.
  jarl(root, 'retract', '1', '2', 'the lint ran on another branch', '--by', 'rev1');
  assert.match(evidenceOf(root, '1'), new RegExp(`^- ~~\\*\\*ran \\(line ${two}\\):\\*\\* npm run lint · \\*\\*saw:\\*\\* clean~~$`, 'm'));
  assert.equal(run(root, ['verify']).status, 0, 'verify places every line');
  // The record library takes the lines as the line key, by number.
  R.addEvidence(root, '1', undefined, { ran: 'npm run e2e', saw: 'pass 1', line: [2] });
  assert.match(evidenceOf(root, '1'), new RegExp(`^- \\*\\*ran \\(line ${two}\\):\\*\\* npm run e2e · \\*\\*saw:\\*\\* pass 1$`, 'm'));
});

test('a --line the issue has no line for, a number that is no line, a --line on a note and a --line on an issue with no acceptance line are refused with the form of the call, and nothing is written', () => {
  const root = makeRoot();
  jarl(root, 'new', 'export 2', '--acceptance', '[read] one line');
  jarl(root, 'new', 'no acceptance yet');
  const before = () => [log(root), readFileSync(issueFile(root, '1'), 'utf8'), readFileSync(issueFile(root, '2'), 'utf8')];
  const was = before();
  const over = refuses(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass', '--line', '1,4');
  assert.match(over, /^1 has 3 acceptance lines: there is no line 4\njarl\.mjs evidence "<ids>" --ran "<command>" --saw "<what-it-printed>" --line "<line-number>"\n$/);
  assert.match(refuses(root, 'evidence', '1,2', '--ran', 'npm test', '--saw', 'pass', '--line', '5'), /^1 has 3 acceptance lines: there is no line 5 — nothing was written\n/);
  for (const bad of ['0', 'two', '-1x']) assert.match(refuses(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass', `--line=${bad}`), /--line takes the number of an acceptance line, 1 for the first, got|an item cannot start with -/, bad);
  assert.match(refuses(root, 'evidence', '1', 'a note', '--line', '1'), /^--line names the acceptance lines a --ran\/--saw row proves, and a free-text note or an attachment proves none: record the row, or leave --line out\njarl\.mjs evidence "<ids>" "<text>"\n$/);
  assert.match(refuses(root, 'evidence', '3', '--ran', 'npm test', '--saw', 'pass', '--line', '1'), /^3 has no acceptance line, so a row of it can name none: write the acceptance first, jarl\.mjs field 3 Acceptance "<line>"\njarl\.mjs field "<id>" Acceptance "<line>"\n$/);
  assert.deepEqual(before(), was, 'nothing was written');
});

test('the rows done counts decide: a retracted row, or one from before a reopen, names no line, and a line only the owner ticks is proved by his tick', () => {
  const root = makeRoot();
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1');
  for (const by of ['w1', 'rev1']) jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1,2', '--by', by);
  jarl(root, 'evidence', '1', '--ran', 'npm run edge', '--saw', 'pass 1', '--line', '2', '--by', 'w1');
  approve(root, '1');
  jarl(root, 'retract', '1', '1', 'it ran on another branch', '--by', 'rev1');
  assert.match(refuses(root, 'set', '1', 'done'), /line 1 \[test\] unproved/);
  for (const by of ['w1', 'rev1']) jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1,2', '--by', by);
  jarl(root, 'set', '1', 'done');
  jarl(root, 'set', '1', 'open', 'a gap came up');
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1');
  for (const by of ['w1', 'rev2']) jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1', '--by', by);
  approve(root, '1');
  assert.match(refuses(root, 'set', '1', 'done'), /line 2 \[test\] unproved/, 'rows from before the reopen name nothing');
  const owner = makeRoot();
  jarl(owner, 'field', '1', 'Acceptance', `${LINES[0]}\n[owner] the chart reads well · material: the chart in the report · check: the axis labels are readable`);
  for (const by of ['one', 'two']) jarl(owner, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1', '--by', by);
  approve(owner, '1');
  const held = run(owner, ['set', '1', 'done']);
  assert.notEqual(held.status, 0, 'done waits for the owner\'s tick');
  assert.match(`${held.stdout}\n${held.stderr}`, /waits for the owner's sign-off/, 'the owner line is his tick\'s to prove, not a row\'s');
});

test('a closed issue is read against what each line asks: a row taken back after the close leaves its line unproved, a line that is read needs none', () => {
  const root = makeRoot();
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1');
  for (const by of ['w1', 'rev1']) jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass', '--line', '1,2', '--by', by);
  approve(root, '1');
  jarl(root, 'set', '1', 'done');
  const flags = () => JSON.parse(jarl(root, 'status', '--json')).closedGate;
  assert.deepEqual(flags(), [], 'the closed gate holds');
  jarl(root, 'retract', '1', '1', 'it ran on another branch', '--by', 'rev1');
  assert.match(flags()[0].reason, /acceptance line 1 \[test\] unproved/);
});

test('a rewritten acceptance says which row it strands, and the row names the text it was made for, not its place', () => {
  const root = makeRoot();
  for (const by of ['one', 'two']) jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1', '--by', by);
  const moved = run(root, ['field', '1', 'Acceptance', `[read] a new first line\n${LINES.join('\n')}`]);
  assert.equal(moved.status, 0, moved.stderr);
  assert.doesNotMatch(moved.stderr, /no longer|this change rewrote/, 'a line that only moved is the same text: nothing is stranded');
  assert.equal(JSON.parse(jarl(root, 'show', '1', '--json')).evidenceRows.length, 2);
  approve(root, '1');
  // The row still names the text it proved, at its new number.
  assert.match(jarl(root, 'show', '1'), /^line 2 \[test\] proved/m);
  const reworded = run(root, ['field', '1', 'Acceptance', `[read] a new first line\n[test] the export writes csv quickly\n${LINES[1]}\n${LINES[2]}`]);
  assert.match(reworded.stderr, /note: 1 holds rows naming 1 acceptance line this change rewrote or removed: a row counts only for the text it named, so the new text needs its own proof/);
  assert.match(jarl(root, 'show', '1'), /^line 2 \[test\] unproved/m);
  const quiet = makeRoot();
  jarl(quiet, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1');
  const plain = run(quiet, ['field', '1', 'Acceptance', LINES[0]]);
  assert.doesNotMatch(`${plain.stdout}\n${plain.stderr}`, /this change rewrote or removed/, 'a line a row names that stands is not said');
});

test('an approve says which lines done still asks a row for, with the form that writes it', () => {
  const root = makeRoot();
  const said = run(root, ['review', '1', 'approve', '--by', 'rev1', 'read the diff, nothing found']);
  assert.equal(said.status, 0, said.stderr);
  assert.match(said.stderr, /note: 1: done asks of each line what its method asks, and line 1 \[test\] unproved[^\n]*; line 2 \[test\] unproved[^\n]*: jarl\.mjs evidence 1 --ran "<command>" --saw "<what-it-printed>" --line "<line-number>" --by "<who>"/);
  for (const by of ['one', 'two']) jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass', '--line', '1,2', '--by', by);
  assert.doesNotMatch(run(root, ['review', '1', 'approve', '--by', 'rev2', 'read the diff again, nothing found']).stderr, /done asks of each line/);
  assert.ok(printed(said.stderr).every((c) => !c.startsWith('jarl.mjs evidence') || c.includes('--line')), said.stderr);
});

test('a split that moves or rewrites an acceptance line a row of the parent names says so, as field does, and one that leaves those texts where they were says nothing', () => {
  const root = makeRoot();
  jarl(root, 'new', 'part 2', '--acceptance', '[read] a part');
  for (const by of ['one', 'two']) jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1,2', '--by', by);
  const moved = run(root, ['split', '1', '--line', '1=1', '--line', '2=2', '--line', '3=1']);
  assert.equal(moved.status, 0, moved.stderr);
  assert.match(moved.stderr, /^note: 1 holds rows naming 1 acceptance line this change rewrote or removed: a row counts only for the text it named, so the new text needs its own proof/m, 'line 2 went to the sub-issue, and its row stays behind');
  const kept = makeRoot();
  jarl(kept, 'new', 'other part', '--acceptance', '[read] a part');
  for (const by of ['one', 'two']) jarl(kept, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1', '--by', by);
  const same = run(kept, ['split', '1', '--line', '1=1', '--line', '2=1', '--line', '3=2']);
  assert.doesNotMatch(same.stderr, /this change rewrote or removed/, 'line 1 stays with its row');
});

test('the number of an acceptance line has a placeholder of its own, apart from the text of one: --line and tick print <line-number>, an acceptance line to write prints <line>', () => {
  assert.ok(L.PLACEHOLDERS.includes('<line-number>') && L.PLACEHOLDERS.includes('<line>'), 'both are in the registry');
  const root = makeRoot();
  jarl(root, 'new', 'no acceptance yet');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1');
  assert.match(refuses(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass', '--line', '4'), /\njarl\.mjs evidence "<ids>" --ran "<command>" --saw "<what-it-printed>" --line "<line-number>"\n$/);
  assert.match(refuses(root, 'evidence', '2', '--ran', 'npm test', '--saw', 'pass', '--line', '1'), /write the acceptance first, jarl\.mjs field 2 Acceptance "<line>"\n/);
  assert.match(refuses(root, 'tick', '1', 'two', '--by', 'owner'), /\njarl\.mjs tick "<id>" "<line-number>"/);
  assert.match(jarl(root, 'brief', '1'), /--line "<line-number>"/);
  assert.match(refuses(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass', '--line', '<line-number>'), /placeholder/, 'pasted unfilled, it writes nothing');
});

test('in a parent, done asks each mechanical line for rows since its last sub-issue closed, with the form that names the line', () => {
  const root = makeRoot();
  jarl(root, 'new', 'part 2', '--acceptance', '[read] a part');
  jarl(root, 'split', '1', '--line', '1=1', '--line', '2=2', '--line', '3=1');
  for (const by of ['one', 'two']) jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1', '--by', by);
  jarl(root, 'evidence', '2', '--ran', 'npm test', '--saw', 'pass 4', '--line', '1,2', '--by', 'one');
  jarl(root, 'evidence', '2', '--ran', 'npm test', '--saw', 'pass 4', '--line', '1,2', '--by', 'two');
  approve(root, '2');
  jarl(root, 'set', '2', 'done', 'merged');
  approve(root, '1');
  const said = refuses(root, 'set', '1', 'done', 'merged');
  assert.match(said, /line 1 \[test\] unproved/);
  assert.match(said, /rows count since its last sub-issue, 2, closed/);
  assert.match(said, /\njarl\.mjs evidence "<id>" --ran "<command>" --saw "<what-it-printed>" --line "<line-number>" --by "<who>"\n$/);
});
