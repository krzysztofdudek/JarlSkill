// An issue's acceptance lines, each with the method that proves it: the mark at the head of a line, what done asks of each
// method, a proof row bound to the text of the line it names, the state of a line as show and status read it, a changes
// verdict that stands until a round or a new commit, and the lines as they were at a lease.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, jarl, loop as makeLoop, refuses, run } from './helpers.mjs';

const R = await import('../record.mjs');

const FORM = /"\[test\|check\|compare\|read\|owner\] <line>"/;
const loopOf = (...acceptance) => {
  const root = makeLoop({ prefix: 'jarl-methods-', via: 'cli' });
  jarl(root, 'new', 'the work', ...acceptance.flatMap((a) => ['--acceptance', a]));
  return root;
};
const leased = (...acceptance) => {
  const root = loopOf(...acceptance);
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1');
  return root;
};
const row = (root, by, saw = 'pass 3', line = '1') => jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', saw, '--line', line, '--by', by);
const approve = (root, by = 'rev1') => jarl(root, 'review', '1', 'approve', '--by', by, 'read the diff, nothing found');
const fileText = (root) => readFileSync(R.findIssue(root, '1').file, 'utf8');
const log = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const goal = (root, text) => appendFileSync(join(root, '.jarl', 'goal.md'), text);
const stateOf = (root, n = 1) => new RegExp(`^line ${n} \\[(\\w+)\\] (\\w+)`, 'm').exec(jarl(root, 'show', '1'));
const lastLine = (text) => text.trimEnd().split('\n').pop();
const OWNER_LINE = '[owner] the screen reads well · material: the render · check: does it read at a glance';

test('new and field take a line headed by one of the five methods, in the form [method] text · key: value', () => {
  for (const line of ['[test] calling export() returns the empty list', '[check] the suite passes', '[check] lint is clean · by: npm run lint', '[compare] the report is unchanged · by: node report.mjs', '[read] the docs describe the new default', OWNER_LINE]) {
    const root = loopOf(line);
    assert.match(jarl(root, 'show', '1'), new RegExp(`^${line.replace(/[()[\]·]/g, '.')}$`, 'm'), line);
    jarl(root, 'field', '1', 'Acceptance', line, '--add');
    jarl(root, 'field', '1', 'Acceptance', line);
  }
});

test('a line of any other form is refused by new and by field, the refusal naming the five and ending with the form that holds them', () => {
  const root = loopOf('[read] a line to keep');
  for (const bad of ['no mark at all', '[tests] a wrong method', '[] an empty mark', '[test]', '[test] · by: x', '[read] a part that is no pair · not a pair', '[test] a key this method does not take · material: x', '[compare] a placeholder · by: <command>']) {
    const onNew = refuses(root, 'new', 'x', '--acceptance', bad);
    const onField = refuses(root, 'field', '1', 'Acceptance', bad);
    for (const refusal of [onNew, onField]) {
      assert.match(refusal, /test, check, compare, read(,| or) owner/, bad);
      assert.match(lastLine(refusal), FORM, `${bad}: ${refusal}`);
    }
  }
  assert.equal(R.findIssue(root, '1').sections.acceptance.trim(), '[read] a line to keep', 'the refused field wrote nothing');
});

test('[compare] without · by: is refused, and [check] without · by: means the goal\'s declared check', () => {
  const root = loopOf('[read] a line to keep');
  const refusal = refuses(root, 'new', 'x', '--acceptance', '[compare] the report is unchanged');
  assert.match(refusal, /\[compare\][^\n]* · by: /);
  assert.match(lastLine(refusal), /by: <command>/);
  // A check line with no by is the declared check: the landing proves it, and it needs no command of its own.
  const leased2 = leased('[check] the suite passes');
  goal(leased2, '\nCheck: npm test\n');
  assert.match(jarl(leased2, 'merged', '1', '--sha', 'abc1234', '--ran', 'npm test', '--saw', 'pass 3', '--keep').trim(), /merged/);
  approve(leased2);
  assert.equal(jarl(leased2, 'set', '1', 'done', 'landed'), '001 → done');
});

test('a line with no mark reads as read, and import\'s Proposed line counts as no line', () => {
  const root = loopOf('[read] a marked line');
  const file = R.findIssue(root, '1').file;
  writeFileSync(file, fileText(root).replace('[read] a marked line', 'a line a conversion left unmarked'));
  assert.equal(stateOf(root)[1], 'read');
  jarl(root, 'review', '1', 'approve', '--by', 'rev1', 'read the diff, nothing found');
  assert.equal(jarl(root, 'set', '1', 'done', 'read and approved'), '001 → done');
  const proposed = makeLoop({ prefix: 'jarl-methods-', via: 'cli' });
  R.newIssue(proposed, 'from a finding', { acceptance: 'Proposed by the finding — make it checkable before a worker starts: something' });
  assert.equal(JSON.parse(jarl(proposed, 'status', '--json')).noAcceptance.length, 0, 'not leased yet');
  assert.match(refuses(proposed, 'set', '1', 'in-progress', 'go', '--worker', 'w1'), /no acceptance line/);
});

test('a lease on an issue with no line is refused, ending with the form that adds one', () => {
  const root = makeLoop({ prefix: 'jarl-methods-', via: 'cli' });
  jarl(root, 'new', 'no line yet');
  const refusal = refuses(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1');
  assert.match(refusal, /001 has no acceptance line/);
  assert.match(lastLine(refusal), /^jarl\.mjs field .* Acceptance /);
  assert.match(lastLine(refusal), FORM);
  assert.equal(R.findIssue(root, '1').status, 'open', 'nothing was written');
});

test('a [test] line asks for a counted row naming it by the holder of the lease and one by a name that has not held it', () => {
  const root = leased('[test] calling export() returns the empty list');
  row(root, 'w1');
  approve(root);
  const onlyHolder = refuses(root, 'set', '1', 'done', 'try');
  assert.match(onlyHolder, /line 1 \[test\]/);
  assert.match(onlyHolder, /a name that has not held/);
  assert.match(lastLine(onlyHolder), /evidence .*--line "<line-number>"/);
  row(root, 'rev1');
  assert.equal(jarl(root, 'set', '1', 'done', 'landed'), '001 → done');
  const otherOnly = leased('[test] x');
  row(otherOnly, 'rev1');
  approve(otherOnly);
  assert.match(refuses(otherOnly, 'set', '1', 'done', 'try'), /line 1 \[test\][^\n]*the holder/);
  const unnamed = leased('[test] x');
  jarl(unnamed, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3', '--line', '1');
  row(unnamed, 'rev1');
  approve(unnamed);
  assert.match(refuses(unnamed, 'set', '1', 'done', 'try'), /the holder/, 'a row that names nobody counts for no side');
});

test('a row counts only inside the window: a row before the start is not counted', () => {
  const root = loopOf('[test] x');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'before the start', '--line', '1', '--by', 'w1');
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1');
  row(root, 'rev1');
  approve(root);
  assert.match(refuses(root, 'set', '1', 'done', 'try'), /line 1 \[test\][^\n]*the holder/);
  row(root, 'w1');
  assert.equal(jarl(root, 'set', '1', 'done', 'landed'), '001 → done');
});

test('a [check] line on the declared command is proved by the landing, a stated command by the rows, and a landing on another command proves neither', () => {
  const declared = leased('[check] the suite passes');
  goal(declared, '\nCheck: npm test\n');
  jarl(declared, 'merged', '1', '--sha', 'abc1234', '--ran', 'npm run lint', '--saw', 'clean', '--keep');
  approve(declared);
  assert.match(refuses(declared, 'set', '1', 'done', 'try'), /line 1 \[check\]/);
  const named = leased('[check] the suite passes · by: npm test');
  goal(named, '\nCheck: npm test\n');
  jarl(named, 'merged', '1', '--sha', 'abc1234', '--ran', 'npm test', '--saw', 'pass', '--keep');
  approve(named);
  assert.equal(jarl(named, 'set', '1', 'done', 'landed'), '001 → done', 'a check that states the declared command is proved by the landing too');
  const stated = leased('[check] lint is clean · by: npm run lint');
  goal(stated, '\nCheck: npm test\n');
  row(stated, 'w1'); row(stated, 'rev1');
  approve(stated);
  assert.equal(jarl(stated, 'set', '1', 'done', 'landed'), '001 → done', 'a stated command that is not the declared one is proved by the rows');
});

test('a [compare] line asks for two rows of the holder with identical saw and a row by a name that has not held it', () => {
  const line = '[compare] the report is unchanged · by: node report.mjs';
  const twoSame = leased(line);
  row(twoSame, 'w1', 'same output'); row(twoSame, 'w1', 'same output'); row(twoSame, 'rev1', 'same output');
  approve(twoSame);
  assert.equal(jarl(twoSame, 'set', '1', 'done', 'landed'), '001 → done');
  const differs = leased(line);
  row(differs, 'w1', 'before'); row(differs, 'w1', 'after'); row(differs, 'rev1', 'after');
  approve(differs);
  assert.match(refuses(differs, 'set', '1', 'done', 'try'), /line 1 \[compare\][^\n]*identical/);
  const one = leased(line);
  row(one, 'w1', 'same output'); row(one, 'rev1', 'same output');
  approve(one);
  assert.match(refuses(one, 'set', '1', 'done', 'try'), /line 1 \[compare\][^\n]*identical/, 'one holder row and the examiner\'s are not the two the comparison asks for');
});

test('a [read] line needs a live approve, a waiver or a profile with no approve in its place, and no row', () => {
  const root = leased('[read] the docs describe the new default');
  assert.match(refuses(root, 'set', '1', 'done', 'try'), /no approving review/);
  approve(root);
  assert.equal(jarl(root, 'set', '1', 'done', 'read and approved'), '001 → done');
  const waived = leased('[read] the docs describe the new default');
  jarl(waived, 'decide', 'no-review-for-1', 'the owner reads it himself', '--by', 'owner', '--waives-review', '1');
  assert.equal(jarl(waived, 'set', '1', 'done', 'on the waiver'), '001 → done');
});

test('a [owner] line needs his tick', () => {
  const root = leased(OWNER_LINE);
  row(root, 'w1');
  approve(root);
  assert.match(refuses(root, 'set', '1', 'done', 'try'), /waits for the owner's sign-off/);
});

test('--without-rows is refused as an unknown flag, and no row is asked of a close but what each line\'s method asks', () => {
  const root = leased('[read] x');
  approve(root);
  assert.match(refuses(root, 'set', '1', 'done', 'try', '--without-rows', 'because'), /unknown flag.*--without-rows|--without-rows.*unknown|does not take --without-rows/i);
  const help = jarl(root, 'set', '--help');
  assert.doesNotMatch(help, /--without-rows/);
});

test('a row stores the digest of its line and not its number; after a rewording or an insertion it counts for no line other than the text it named', () => {
  const root = leased('[test] the export is written', '[test] the header is kept');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass', '--line', '2', '--by', 'w1');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass', '--line', '2', '--by', 'rev1');
  const file = fileText(root);
  assert.doesNotMatch(file, /\*\*ran \(line 2\):/, 'the number is not stored');
  assert.match(file, /\*\*ran \(line [0-9a-f]{12}\):\*\* npm test · \*\*saw:\*\* pass/);
  assert.match(log(root), /001 evidence row \(line [0-9a-f]{12}\) · npm test/);
  assert.match(jarl(root, 'show', '1'), /^- \[1\] \*\*ran \(line 2\):\*\* npm test/m, 'show maps the digest back to the line it names');
  // A line inserted before it moves its number: the rows follow the text.
  jarl(root, 'field', '1', 'Acceptance', '[test] a new first line', '--by', 'jarl');
  jarl(root, 'field', '1', 'Acceptance', '[test] the header is kept', '--add', '--by', 'jarl');
  assert.equal(stateOf(root, 1)[2], 'unproved', 'the new line holds no proof');
  assert.equal(stateOf(root, 2)[2], 'proved', 'the rows follow the text they named');
  assert.match(jarl(root, 'show', '1'), /^- \[1\] \*\*ran \(line 2\):\*\* npm test/m);
  // Reworded, it counts for nothing.
  const reworded = leased('[test] the header is kept');
  row(reworded, 'w1'); row(reworded, 'rev1');
  assert.equal(stateOf(reworded)[2], 'proved');
  jarl(reworded, 'field', '1', 'Acceptance', '[test] the header is kept and tested', '--by', 'jarl');
  assert.equal(stateOf(reworded)[2], 'unproved', 'a reworded line is a new requirement');
  approve(reworded);
  assert.match(refuses(reworded, 'set', '1', 'done', 'try'), /line 1 \[test\]/);
  assert.match(jarl(reworded, 'show', '1', '--full'), /\*\*ran \(line [0-9a-f]{12} not a line now\):/, 'a digest with no line says so');
});

test('evidence --ran --saw without --line is refused, ending with the form that names it, and a free note is still taken', () => {
  const root = leased('[test] x');
  const refusal = refuses(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass');
  assert.match(refusal, /--line/);
  assert.match(lastLine(refusal), /evidence .*--line "<line-number>"/);
  assert.equal(jarl(root, 'evidence', '1', 'a plain note about the work'), '001 evidence added');
});

test('a changes verdict stands until a round or a new commit: an approve by another reviewer after it does not clear the issue', () => {
  const root = leased('[read] x');
  jarl(root, 'review', '1', 'changes', '--by', 'rev1', 'Important: the docs are wrong');
  jarl(root, 'review', '1', 'approve', '--by', 'rev2', 'looked fine to me');
  const refusal = refuses(root, 'set', '1', 'done', 'try');
  assert.match(refusal, /changes verdict by rev1/);
  assert.match(refusal, /stands until a round or a new commit/);
  assert.equal(JSON.parse(jarl(root, 'status', '--json')).inFlightRows[0].mark, 'changes-requested');
  jarl(root, 'round', '1', 'the docs were wrong', '--by', 'jarl');
  approve(root, 'rev2');
  assert.equal(jarl(root, 'set', '1', 'done', 'approved after the round'), '001 → done');

  const { dir, g } = gitRepo({ prefix: 'jarl-methods-git-', branch: 'main' });
  jarl(dir, 'init', 'work');
  jarl(dir, 'new', 'the work', '--acceptance', '[read] x');
  g('checkout', '-qb', 'jarl/1-x');
  writeFileSync(join(dir, 'b.txt'), 'b\n'); g('add', 'b.txt'); g('commit', '-qm', 'first');
  g('checkout', '-q', 'main');
  jarl(dir, 'set', '1', 'in-progress', 'go', '--worker', 'w1', '--branch', 'jarl/1-x');
  jarl(dir, 'review', '1', 'changes', '--by', 'rev1', 'Important: wrong');
  jarl(dir, 'review', '1', 'approve', '--by', 'rev2', 'looked fine to me');
  assert.match(refuses(dir, 'set', '1', 'done', 'try'), /stands until a round or a new commit/);
  g('checkout', '-q', 'jarl/1-x');
  writeFileSync(join(dir, 'b.txt'), 'b2\n'); g('add', 'b.txt'); g('commit', '-qm', 'second');
  g('checkout', '-q', 'main');
  assert.notEqual(JSON.parse(jarl(dir, 'status', '--json')).inFlightRows[0].mark, 'changes-requested', 'a new commit leaves the changes standing no more');
  jarl(dir, 'review', '1', 'approve', '--by', 'rev2', 'read the new diff, nothing found');
  assert.equal(R.loadIssues(dir).length, 1);
  assert.equal(JSON.parse(jarl(dir, 'status', '--json')).inFlightRows[0].mark, 'approved', 'an approve after the commit clears it');
});

test('the log keeps the whole old text of the lines when they change, and the tool prints the lines as they were at the lease', () => {
  const root = leased('[test] the export is written · by: npm test', '[read] the docs say so');
  jarl(root, 'field', '1', 'Acceptance', '[test] the export is written quickly · by: npm test', '--by', 'jarl');
  jarl(root, 'field', '1', 'Acceptance', '[test] something else entirely', '--by', 'jarl');
  const lines = log(root).split('\n').filter((l) => / body · acceptance · was /.test(l));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /was "- \[test\] the export is written \\u00b7 by: npm test\\n- \[read\] the docs say so"/, 'the whole old section, on one line, with no separator of the log in it');
  assert.ok(JSON.parse(/ · was ("[^·]*")/.exec(lines[0])[1]).includes('the docs say so'));
  const atLease = jarl(root, 'show', '1', '--at-lease');
  assert.match(atLease, /^the lines as they were at the lease/m);
  assert.match(atLease, /^- \[test\] the export is written · by: npm test$/m);
  assert.match(atLease, /^- \[read\] the docs say so$/m);
  assert.match(atLease, /^the lines as they are now/m);
  assert.match(atLease, /^- \[test\] something else entirely$/m);
  const json = JSON.parse(jarl(root, 'show', '1', '--at-lease', '--json'));
  assert.deepEqual(json.atLease.lines, ['[test] the export is written · by: npm test', '[read] the docs say so']);
  assert.deepEqual(json.atLease.now, ['[test] something else entirely']);
  assert.equal(json.atLease.changed, true);
  const same = leased('[read] x');
  const unchanged = jarl(same, 'show', '1', '--at-lease');
  assert.match(unchanged, /unchanged since the lease/);
  const never = loopOf('[read] x');
  assert.match(jarl(never, 'show', '1', '--at-lease'), /holds no lease on record/);
});

test('show prints each line\'s state, and status counts lines by method and by state', () => {
  const root = leased('[test] a behaviour', '[check] the suite passes', '[compare] the output stays · by: node report.mjs', '[read] the docs say so', OWNER_LINE);
  const show = jarl(root, 'show', '1');
  assert.match(show, /^line 1 \[test\] unproved/m);
  assert.match(show, /^line 2 \[check\] unproved/m);
  assert.match(show, /^line 3 \[compare\] unproved/m);
  assert.match(show, /^line 4 \[read\] unproved/m);
  assert.match(show, /^line 5 \[owner\] unproved/m);
  const status = JSON.parse(jarl(root, 'status', '--json'));
  assert.deepEqual(status.lines.byMethod, { test: 1, check: 1, compare: 1, read: 1, owner: 1 });
  assert.deepEqual(status.lines.byState, { unproved: 5, proved: 0, judged: 0, ticked: 0 });
  assert.match(jarl(root, 'status'), /^lines: 1 test · 1 check · 1 compare · 1 read · 1 owner \(5 unproved, 0 proved, 0 judged, 0 ticked\)$/m);
  row(root, 'w1'); row(root, 'rev1');
  assert.match(jarl(root, 'show', '1'), /^line 1 \[test\] proved/m);
  approve(root);
  assert.match(jarl(root, 'show', '1'), /^line 4 \[read\] judged/m);
  assert.deepEqual(JSON.parse(jarl(root, 'status', '--json')).lines.byState, { unproved: 3, proved: 1, judged: 1, ticked: 0 });
  // A line the owner ticks reads ticked once he has.
  const owner = leased(OWNER_LINE);
  row(owner, 'w1'); row(owner, 'rev1');
  approve(owner);
  jarl(owner, 'tick', '1', '1', '--by', 'owner');
  assert.match(jarl(owner, 'show', '1'), /^line 1 \[owner\] ticked/m);
});

test('merged notes when --ran matches no declared check and prints the declared ones', () => {
  const root = leased('[check] the suite passes');
  goal(root, '\nCheck: npm test\nCheck: npm run e2e\n');
  const r = run(root, ['merged', '1', '--sha', 'abc1234', '--ran', 'npm run lint', '--saw', 'clean', '--keep']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /matches no declared check/);
  assert.match(r.stderr, /npm test/);
  assert.match(r.stderr, /npm run e2e/);
  const clean = run(root, ['merged', '1', '--sha', 'abc1234', '--ran', 'npm test', '--saw', 'pass', '--keep']);
  assert.doesNotMatch(clean.stderr, /declared check/);
});

test('a Check (<name>): line matches the repository\'s own name', () => {
  const root = makeLoop({ prefix: 'jarl-methods-', via: 'cli' });
  const name = root.split(/[\\/]/).pop();
  jarl(root, 'new', 'the work', '--acceptance', '[check] the suite passes');
  goal(root, `\nCheck (${name}): npm test\n`);
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1');
  const wrong = run(root, ['merged', '1', '--sha', 'abc1234', '--ran', 'npm run lint', '--saw', 'clean', '--keep']);
  assert.match(wrong.stderr, /matches no declared check/);
  assert.match(wrong.stderr, /npm test/);
  const right = run(root, ['merged', '1', '--sha', 'abc1234', '--ran', 'npm test', '--saw', 'pass', '--keep']);
  assert.doesNotMatch(right.stderr, /declared check/);
  approve(root);
  assert.equal(jarl(root, 'set', '1', 'done', 'landed on its check'), '001 → done', 'the landing on the repository\'s own Check line proves the line');
});
