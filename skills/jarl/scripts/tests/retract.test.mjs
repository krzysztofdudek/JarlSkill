// Retraction by an appended entry, a title change and a review with empty findings. The first retraction of
// a loop raises the record format, so the pinned frozen reader (tests/old-jarl.mjs) refuses the loop instead of counting
// the retracted approve or row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fileAsBefore, oldJarl } from './old-jarl.mjs';
import { noteHistories } from './note-writers.mjs';
import { SPAWN_TIMEOUT, jarl, refuses, loop as makeLoop } from './helpers.mjs';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const L = await import('../jarl-lib.mjs');
// Issues are filed with three digits and no key (fileAsBefore), so each loop stays format 1 until a retraction.
const R = await import('../record.mjs');

const loop = () => makeLoop({ prefix: 'jarl-retract-', goal: 'a goal', via: 'cli' });
// An issue in progress on a branch (a code issue), filed under 001 unless others exist, with its merge recorded, so the
// done gate stands on its rows and approves alone.
function started(root, title = 'thing to do') {
  const id = fileAsBefore(root, title, { acceptance: 'it works' });
  jarl(root, 'set', id, 'in-progress', '--worker', 'w-one', '--branch', `jarl/${id}-x`);
  jarl(root, 'merged', id, '--sha', 'abc1234', '--ci', 'none');
  return id;
}
const file = (root, id) => readFileSync(L.findIssue(root, id).file, 'utf8');
const log = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const profileFile = (root) => join(root, '.jarl', 'profile.json');
const doneRefusal = (root, id) => { try { jarl(root, 'set', id, 'done', 'merged'); return null; } catch (e) { return String(e.stderr); } };

test('retract <id> review: the newest approve is struck through and does not count, by an appended entry', () => {
  const root = loop();
  const id = started(root);
  jarl(root, 'evidence', id, '--line', '1', '--ran', 'npm test', '--saw', 'pass 5');
  jarl(root, 'review', id, 'approve', '--by', 'opus-reviewer-1', 'read the diff, nothing found');
  assert.equal(L.gateState(root, id).approved, true, 'before: the gate counts the approve');
  assert.equal(existsSync(profileFile(root)), false, 'no retraction yet: the record is still format 1');

  const said = jarl(root, 'retract', id, 'review', '--by', 'jarl', 'I approved the wrong branch');
  assert.match(said, /1 review retracted by jarl \(coordinator\): the approve by opus-reviewer-1 \(fresh\)/);
  assert.equal(L.gateState(root, id).approved, false, 'after: the gate does not count it');
  assert.match(doneRefusal(root, id), /no approving review/);

  const text = file(root, id);
  assert.match(text, /^- ~~\*\*approve\*\* · by opus-reviewer-1 \(fresh\) · \d{4}-\d{2}-\d{2}~~$/m, 'the original stays, struck through');
  assert.match(text, /^  read the diff, nothing found$/m, 'its findings stay');
  assert.match(text, /^- \*\*retract\*\* · by jarl \(coordinator\) · \d{4}-\d{2}-\d{2}\n  retracts the approve by opus-reviewer-1 \(fresh\) of \d{4}-\d{2}-\d{2}\n  I approved the wrong branch$/m, 'the retraction is an entry of its own');
  assert.match(log(root), /001 review retract · by jarl \(coordinator\) · retracts the approve by opus-reviewer-1 \(fresh\) of \d{4}-\d{2}-\d{2} · I approved the wrong branch$/m);
  assert.equal(JSON.parse(readFileSync(profileFile(root), 'utf8')).format, 2, 'the first retraction raised the format');
  // The approve that is not retracted still opens the gate.
  jarl(root, 'review', id, 'approve', '--by', 'opus-reviewer-2', 'second pair of eyes, nothing found');
  assert.equal(doneRefusal(root, id), null);
});

test('retract <id> review takes the newest approve not yet retracted, one at a time, and never a changes verdict', () => {
  const root = loop();
  const id = started(root);
  assert.match(refuses(root, 'retract', id, 'review', '--by', 'jarl', 'nothing to take back'), /no approve to retract/);
  assert.equal(existsSync(profileFile(root)), false, 'a refused retraction raises nothing');
  jarl(root, 'review', id, 'changes', '--by', 'rev-a', 'Important: the test never goes red');
  assert.match(refuses(root, 'retract', id, 'review', '--by', 'jarl', 'try to revive the acceptance'), /no approve to retract.*never a "changes" verdict/);
  jarl(root, 'round', id, 'the test goes red now');
  jarl(root, 'merged', id, '--sha', 'abc1234', '--ci', 'none');
  jarl(root, 'review', id, 'approve', '--by', 'rev-b', 'fixed, read it again');
  jarl(root, 'review', id, 'approve', '--by', 'rev-c', 'also read it');
  jarl(root, 'retract', id, 'review', '--by', 'jarl', 'rev-c read the wrong diff');
  assert.equal(L.gateState(root, id).live.by, 'rev-b', 'rev-c was the newest, rev-b is live again');
  jarl(root, 'retract', id, 'review', '--by', 'jarl', 'rev-b read the wrong diff too');
  assert.equal(L.gateState(root, id).live, null);
  assert.equal(L.gateState(root, id).lastReview, 'changes', 'what is left is the changes verdict: a retraction never overrides it');
  assert.match(refuses(root, 'retract', id, 'review', '--by', 'jarl', 'once more'), /no approve to retract/);
  assert.equal((file(root, id).match(/~~\*\*approve\*\*/g) || []).length, 2);
  assert.match(file(root, id), /\*\*changes\*\* · by rev-a \(fresh\)/, 'the changes entry is not struck');
  // The metrics do not count a retracted approve either.
  jarl(root, 'review', id, 'approve', '--by', 'rev-d', 'read it, nothing found');
  jarl(root, 'evidence', id, '--line', '1', '--ran', 'check', '--saw', 'green');
  jarl(root, 'set', id, 'done', 'merged');
  assert.equal(L.loopMetrics(root).freshReviews.reviewers['rev-d'], 1);
  assert.equal(L.loopMetrics(root).freshReviews.reviewers['rev-c'], undefined);
});

test('a retraction needs --by and a reason with words, and names one issue', () => {
  const root = loop();
  const id = started(root);
  jarl(root, 'review', id, 'approve', '--by', 'rev-a', 'read the diff');
  assert.match(refuses(root, 'retract', id, 'review', 'because'), /needs --by/);
  assert.match(refuses(root, 'retract', id, 'review', '--by', 'jarl', 'x'), /a retraction needs words/);
  assert.match(refuses(root, 'retract', '1,2', 'review', '--by', 'jarl', 'because I said so'), /names one issue/);
  assert.equal(existsSync(profileFile(root)), false, 'nothing was raised or written');
  assert.equal(L.gateState(root, id).approved, true);
});

test('retract <id> <n>: the n-th row of the whole section is struck through and the gate stops counting it', () => {
  const root = loop();
  const id = started(root);
  jarl(root, 'evidence', id, 'a free-text note first');
  jarl(root, 'field', id, 'Acceptance', '[test] it works');
  jarl(root, 'evidence', id, '--line', '1', '--ran', 'cmd one', '--saw', 'wrong result', '--by', 'w-one');
  jarl(root, 'evidence', id, '--line', '1', '--ran', 'cmd two', '--saw', 'second result', '--by', 'rev-a');
  jarl(root, 'review', id, 'approve', '--by', 'rev-a', 'read the diff');
  const refusal = () => L.doneRefusal(root, L.findIssue(root, id));
  const profileBefore = readFileSync(profileFile(root), 'utf8');
  assert.equal(refusal(), null, 'before: the rows and the approve open the gate');
  assert.deepEqual(L.evidenceTable(L.findIssue(root, id).sections.evidence).rows.map((r) => [r.n, r.ran, r.retracted]), [[1, 'cmd one', false], [2, 'cmd two', false]]);

  assert.match(refuses(root, 'retract', id, '3', '--by', 'jarl', 'no such row'), /has 2 evidence rows: there is no row 3/);
  assert.match(refuses(root, 'retract', id, 'two', '--by', 'jarl', 'not a number'), /retract takes review \(the newest approve\) or the number of an evidence row/);
  assert.match(refuses(root, 'retract', id, '1', 'because the row is wrong'), /needs --by/);
  assert.match(refuses(root, 'retract', id, '1', '--by', 'jarl', '-'), /a retraction needs words/);
  assert.match(refuses(root, 'retract', id, '1', '--by', 'jarl', 'x', '--ran', 'a', '--saw', 'b'), /unknown flag --ran for retract/);
  assert.equal(readFileSync(profileFile(root), 'utf8'), profileBefore, 'refused retractions raise nothing');

  assert.equal(jarl(root, 'retract', id, '2', '--by', 'jarl', 'cmd two was run in the wrong place'), '001 evidence row 2 retracted by jarl');
  assert.equal(L.gateState(root, id).rowsSince, 1, 'one row is left');
  assert.match(refusal(), /a counted row naming it by a name that has not held the lease/, 'the row by a name that has not held it is gone');
  const text = file(root, id);
  assert.match(text, /^- ~~\*\*ran(?: \(line [0-9a-f, ]+\))?:\*\* cmd two · \*\*saw:\*\* second result~~$/m);
  assert.match(text, /^- \*\*ran(?: \(line [0-9a-f, ]+\))?:\*\* cmd one · \*\*saw:\*\* wrong result$/m, 'another row is untouched');
  assert.match(text, /^- \*\*retracted:\*\* row 2 · by jarl · \d{4}-\d{2}-\d{2}\n  cmd two was run in the wrong place$/m);
  assert.match(log(root), /001 evidence retract · row 2 · by jarl · cmd two was run in the wrong place$/m);
  assert.match(refuses(root, 'retract', id, '2', '--by', 'jarl', 'again'), /row 2 of 001 is retracted already/);
  assert.equal(JSON.parse(readFileSync(profileFile(root), 'utf8')).format, 3);
  jarl(root, 'retract', id, '1', '--by', 'jarl', 'cmd one printed the wrong result');
  assert.equal(L.gateState(root, id).rowsSince, 0, 'every row is retracted');
  assert.match(refusal(), /line 1 \[test\] unproved/);
  // A row of the work, recorded again, counts; the numbering never moves, so it is row 3.
  jarl(root, 'evidence', id, '--line', '1', '--ran', 'cmd three', '--saw', 'third result', '--by', 'w-one');
  jarl(root, 'evidence', id, '--line', '1', '--ran', 'cmd four', '--saw', 'fourth result', '--by', 'rev-a');
  assert.deepEqual(L.evidenceTable(L.findIssue(root, id).sections.evidence).rows.map((r) => [r.n, r.retracted]), [[1, true], [2, true], [3, false], [4, false]]);
  assert.equal(refusal(), null);
});

test('a retraction strikes the row the file numbers, whatever order the journal lines are in', () => {
  const root = loop();
  const id = started(root);
  jarl(root, 'evidence', id, '--line', '1', '--ran', 'alpha check', '--saw', 'alpha result');
  jarl(root, 'evidence', id, '--line', '1', '--ran', 'beta check', '--saw', 'beta result');
  jarl(root, 'evidence', id, '--line', '1', '--ran', 'beta check', '--saw', 'beta result again');
  // The journal's two row lines come back in the other order, as lines of a committed loop can when branches merge.
  const logPath = join(root, '.jarl', 'log.md');
  const lines = readFileSync(logPath, 'utf8').split('\n');
  const [a, b, c] = lines.flatMap((l, i) => (l.includes(`${id} evidence row · `) ? [i] : []));
  [lines[a], lines[b], lines[c]] = [lines[b], lines[c], lines[a]];
  writeFileSync(logPath, lines.join('\n'));
  jarl(root, 'retract', id, '1', '--by', 'jarl', 'alpha ran in the wrong place');
  const state = L.gateState(root, id).rowLog.map((e) => [e.text.split(' · ').pop(), e.retracted]);
  assert.deepEqual(state.sort(), [['alpha check', true], ['beta check', false], ['beta check', false]], 'row 1 of the file is alpha, wherever its journal line is');
  jarl(root, 'retract', id, '3', '--by', 'jarl', 'the second beta ran in the wrong place');
  assert.equal(L.gateState(root, id).rowLog.filter((e) => e.retracted).length, 2);
  assert.equal(L.gateState(root, id).rowsSince, 1);
});

test('a retraction always finds its row: a command holding the saw marker, a command of several lines, and a retraction that cannot be resolved refuses done', () => {
  for (const [ran, saw] of [['echo one · **saw:** two', 'three'], ['first line\nsecond line', 'result'], ['first line\nsecond line · **saw:** x', 'result\nmore']]) {
    const root = loop();
    const id = started(root);
    jarl(root, 'field', id, 'Acceptance', '[test] it works');
    jarl(root, 'evidence', id, '--line', '1', '--ran', 'plain check', '--saw', 'plain result', '--by', 'w-one');
    jarl(root, 'evidence', id, '--line', '1', '--ran', ran, '--saw', saw, '--by', 'rev-a');
    jarl(root, 'review', id, 'approve', '--by', 'rev-a', 'read the diff twice');
    assert.equal(L.gateState(root, id).rowsSince, 2);
    jarl(root, 'retract', id, '2', '--by', 'jarl', 'wrong place entirely');
    jarl(root, 'retract', id, '1', '--by', 'jarl', 'also the wrong place');
    const g = L.gateState(root, id);
    assert.deepEqual(g.unresolvedRetractions, [], JSON.stringify(ran));
    assert.equal(g.rowsSince, 0, `both rows are retracted whatever they contain: ${JSON.stringify(ran)}`);
    assert.match(doneRefusal(root, id), /line 1 \[test\] unproved/, JSON.stringify(ran));
  }
  // A retraction line naming a row that no journal line fits (a log repaired by hand, merged badly): done refuses, loudly.
  const root = loop();
  const id = started(root);
  jarl(root, 'evidence', id, '--line', '1', '--ran', 'a check', '--saw', 'a result');
  jarl(root, 'review', id, 'approve', '--by', 'rev-a', 'read the diff twice');
  const refusal = () => L.doneRefusal(root, L.findIssue(root, id));
  assert.equal(refusal(), null, 'before the bad line the gate is open');
  appendFileSync(join(root, '.jarl', 'log.md'), `- 2026-10-18 20:00 · ${id} evidence retract · row 7 · by jarl · a row that is not there\n`);
  assert.match(refusal(), /records a retraction of evidence row 7 that matches no evidence line of the log/);
  assert.deepEqual(L.gateState(root, id).unresolvedRetractions, [7]);
});

test('the first retraction raises the format before its line is written; the pinned frozen reader refuses the loop loudly', () => {
  for (const retract of [
    (root, id) => jarl(root, 'retract', id, 'review', '--by', 'jarl', 'the approve was a mistake'),
    (root, id) => jarl(root, 'retract', id, '1', '--by', 'jarl', 'the row was a mistake'),
  ]) {
    const root = loop();
    const id = started(root);
    jarl(root, 'evidence', id, '--line', '1', '--ran', 'npm test', '--saw', 'pass');
    jarl(root, 'review', id, 'approve', '--by', 'rev-a', 'read it all');
    for (const command of ['list', 'status', 'next', 'queue']) assert.equal(oldJarl(root, command, {}).ok, true, `before: 6.1.0 reads the loop (${command})`);
    retract(root, id);
    for (const command of ['list', 'status', 'next', 'queue']) {
      const r = oldJarl(root, command, {});
      assert.equal(r.ok, false, command);
      assert.match(r.error, /written for record format 2, and this Jarl reads format 1/, command);
    }
    assert.match(jarl(root, 'list', '--all'), /thing to do/, 'this Jarl reads the same loop');
  }
});

test('a retraction that raises a format-1 loop keeps the raise\'s ./ form of a bare Repo path in the issue it writes', () => {
  for (const [what, retract] of [
    ['a verdict', (root, id) => jarl(root, 'retract', id, 'review', '--by', 'jarl', 'the approve was a mistake')],
    ['a row', (root, id) => jarl(root, 'retract', id, '1', '--by', 'jarl', 'the row was a mistake')],
    ['a note', (root, id) => jarl(root, 'retract', id, 'note-1', '--by', 'jarl', 'the note was a mistake')],
  ]) {
    const root = loop();
    mkdirSync(join(root, 'tool'));
    execFileSync('git', ['init', '-q'], { cwd: join(root, 'tool'), stdio: 'ignore', timeout: SPAWN_TIMEOUT });
    const id = fileAsBefore(root, 'thing to do', { acceptance: 'it works', repo: 'tool' });
    const other = fileAsBefore(root, 'other thing', { acceptance: 'it works', repo: 'tool' });
    jarl(root, 'evidence', id, 'a note');
    jarl(root, 'evidence', id, '--line', '1', '--ran', 'npm test', '--saw', 'pass');
    jarl(root, 'review', id, 'approve', '--by', 'rev-a', 'read it all');
    assert.match(file(root, id), /^\*\*Repo:\*\* tool$/m, `${what}: the format-1 reader writes the path bare`);
    retract(root, id);
    assert.notEqual(existsSync(profileFile(root)) && JSON.parse(readFileSync(profileFile(root), 'utf8')).format, false, `${what}: the retraction raised the format`);
    assert.match(file(root, other), /^\*\*Repo:\*\* \.\/tool$/m, `${what}: the raise wrote the other issue's path with ./`);
    assert.match(file(root, id), /^\*\*Repo:\*\* \.\/tool$/m, `${what}: the retracted issue keeps the raise's ./ form`);
    assert.match(file(root, id), /retracted|\*\*retract\*\*/, `${what}: and holds its retraction`);
  }
});

test('body --title changes the heading with a log entry; the file keeps its name', () => {
  const root = loop();
  const id = fileAsBefore(root, 'a wrong title');
  const before = L.findIssue(root, id).file;
  assert.match(jarl(root, 'field', id, 'Title', 'the right title'), /001 Title: the right title/);
  const issue = L.findIssue(root, id);
  assert.equal(issue.file, before, 'the file name is unchanged');
  assert.equal(issue.title, 'the right title');
  assert.match(readFileSync(before, 'utf8'), /^# 001 · the right title\n/);
  assert.match(log(root), /001 body · title · was "a wrong title"$/m);
  assert.match(jarl(root, 'list'), /the right title/);
  assert.match(refuses(root, 'field', id, 'Title', '  '), /^field Title needs a value, or --clear to empty it\njarl\.mjs field "<ids>" Title "<title>"\n$/);
  jarl(root, 'field', id, 'Title', 'two\nlines');
  jarl(root, 'field', id, 'What', 'and a body too');
  assert.equal(L.findIssue(root, id).title, 'two lines');
  assert.equal(oldJarl(root, 'list', {}).ok, true, 'a title change is nothing a 6.1.0 reader misreads');
});

test('a review with empty findings is rejected: no letters or digits, or too little to say', () => {
  const root = loop();
  const id = started(root);
  for (const findings of ['x', ' x ', '-', '   ', '...', '\n']) {
    assert.match(refuses(root, 'review', id, 'approve', '--by', 'rev-a', findings), /(need at least 3 words|requires)/, JSON.stringify(findings));
  }
  assert.match(refuses(root, 'review', id, 'changes', '--by', 'rev-a', 'x'), /need at least 3 words/);
  assert.doesNotMatch(file(root, id), /## Reviews/, 'nothing was written');
  for (const findings of ['ok', 'LGTM', 'fine', 'looks fine', 'ok - fine']) {
    assert.match(refuses(root, 'review', id, 'approve', '--by', 'rev-a', findings), /need at least 3 words.*\(got [12] words?:/, findings);
  }
  assert.doesNotMatch(file(root, id), /## Reviews/, 'nothing was written');
  assert.match(jarl(root, 'review', id, 'approve', '--by', 'rev-a', 'read it twice'), /review approve/);
});

test('a note is numbered as show prints it, retract takes it back with who and why, and the worker view leaves it out', () => {
  const root = loop();
  const id = started(root);
  jarl(root, 'evidence', id, 'the first note stays');
  jarl(root, 'evidence', id, '--line', '1', '--ran', 'npm test', '--saw', 'pass 5');
  jarl(root, 'evidence', id, 'the second note names a subject the worker must not see');
  jarl(root, 'evidence', id, 'the third note stays too');
  assert.match(jarl(root, 'show', id), /^\[note-2\] the second note names a subject/m, 'the note carries its number');
  assert.equal(existsSync(profileFile(root)), false, 'no retraction yet: the record is still format 1');

  assert.match(jarl(root, 'retract', id, 'note-2', '--by', 'jarl', 'the owner withdrew it'), /001 evidence note 2 retracted by jarl/);
  const text = file(root, id);
  assert.match(text, /^~~the second note names a subject the worker must not see~~$/m, 'the original stays, struck through');
  assert.match(text, /^- \*\*retracted:\*\* note 2 · by jarl · \d{4}-\d{2}-\d{2}\n  the owner withdrew it$/m, 'the retraction is an entry of its own');
  assert.match(log(root), /001 evidence retract · note 2 · by jarl · the owner withdrew it$/m);
  assert.equal(JSON.parse(readFileSync(profileFile(root), 'utf8')).format, 3, 'the first retraction raised the format');

  const worker = jarl(root, 'show', id);
  assert.doesNotMatch(worker, /second note|subject/, 'the view a worker reads leaves the retracted note out');
  assert.match(worker, /^\[note-1\] the first note stays$/m);
  assert.match(worker, /^\[note-3\] the third note stays too$/m, 'a note keeps its number');
  assert.doesNotMatch(worker, /retracted:\*\* note 2|withdrew/, 'the reason is hidden with the note');
  assert.match(worker, /^\(1 note retracted, not shown/m, 'the view says how many notes were retracted');
  assert.match(jarl(root, 'show', id, '--full'), /^\[note-2\] ~~the second note names a subject the worker must not see~~$/m, 'the full view keeps it struck through');
  assert.match(jarl(root, 'show', id, '--full'), /the owner withdrew it/, 'the reason stays in the full view');
  assert.match(refuses(root, 'retract', id, 'note-2', '--by', 'jarl', 'again'), /note 2 of 001 is retracted already/);
  assert.match(refuses(root, 'retract', id, 'note-9', '--by', 'jarl', 'no such note'), /has 3 evidence notes: there is no note 9/);
  assert.match(refuses(root, 'retract', id, 'note-1', 'no one says who'), /needs --by/);
  assert.match(refuses(root, 'retract', id, 'note-1', '--by', 'jarl', '-'), /needs words/);
});

test('show --json and resume leave a retracted note and the reason of its retraction out for a worker, say how many were retracted, and show --full keeps them', () => {
  const root = loop();
  const id = started(root);
  jarl(root, 'evidence', id, 'the first note stays');
  jarl(root, 'evidence', id, 'the second note names a subject the worker must not see');
  jarl(root, 'evidence', id, '--line', '1', '--ran', 'npm test', '--saw', 'pass 5');
  jarl(root, 'retract', id, 'note-2', '--by', 'jarl', 'the owner withdrew the subject');
  const worker = jarl(root, 'show', id, '--json');
  assert.doesNotMatch(worker, /second note|subject|withdrew|retracted:\*\*/, 'the data a worker reads leaves the retracted note and its reason out');
  const read = JSON.parse(worker);
  assert.match(read.sections.evidence, /the first note stays/, 'the other notes stay');
  assert.equal(read.retractedNotes, 1, 'it says how many notes were retracted');
  assert.equal(read.evidenceRows.length, 1, 'the rows are the same');
  const full = jarl(root, 'show', id, '--full', '--json');
  assert.match(full, /second note names a subject/, 'the full data keeps the note');
  assert.match(full, /the owner withdrew the subject/, 'and the reason');
  assert.equal(JSON.parse(full).retractedNotes, undefined);
  const resume = jarl(root, 'resume');
  assert.doesNotMatch(resume, /second note|subject|withdrew/, 'the log tail leaves out the line of the note and the line that retracts it');
  assert.match(resume, /^- [^\n]* · 001 evidence · the first note stays$/m, 'the other lines of the tail stay');
  assert.match(resume, /^\(1 note retracted, not shown; the reasons are in the log and in show --full\)$/m);
  const data = JSON.parse(jarl(root, 'resume', '--json'));
  assert.doesNotMatch(JSON.stringify(data.log), /second note|subject|withdrew/);
  assert.equal(data.logRetractedNotes, 1);
  assert.match(log(root), /001 evidence retract · note 2 · by jarl · the owner withdrew the subject$/m, 'the log itself keeps the reason');
  // A loop where no note was retracted shows its tail whole and says nothing of notes.
  const plain = loop();
  started(plain);
  assert.doesNotMatch(jarl(plain, 'resume'), /retracted, not shown/);
  assert.equal(JSON.parse(jarl(plain, 'resume', '--json')).logRetractedNotes, undefined);
});

// What resume (text and --json) and show (text and --json) each say of an issue's notes: the tail's note lines and the counts.
function seen(root, id) {
  const text = jarl(root, 'resume');
  const data = JSON.parse(jarl(root, 'resume', '--json'));
  const shown = JSON.parse(jarl(root, 'show', id, '--json'));
  const tail = (data.log || []).filter((l) => l.includes(`${id} evidence · `)).map((l) => l.replace(/^.* · (?=\d+ evidence · )/, ''));
  const said = /^\((\d+) notes? retracted, not shown/m.exec(text);
  return { tail, counted: data.logRetractedNotes || 0, said: said ? Number(said[1]) : 0, shownCount: shown.retractedNotes || 0, shownText: shown.sections.evidence };
}

test('a live note that starts with the words of a retracted note keeps its line in the tail, and every view counts one retracted note', () => {
  const root = loop();
  const id = started(root);
  jarl(root, 'evidence', id, 'the build');
  jarl(root, 'evidence', id, 'the build is green on every platform');
  jarl(root, 'retract', id, 'note-1', '--by', 'jarl', 'restated in the next note');
  const v = seen(root, id);
  assert.deepEqual(v.tail, [`${id} evidence · the build is green on every platform`], 'the longer live note stays; the retracted note and its reason are out');
  assert.match(v.shownText, /the build is green on every platform/);
  assert.doesNotMatch(v.shownText, /^the build$/m);
  assert.deepEqual([v.counted, v.said, v.shownCount], [1, 1, 1], 'resume, resume --json and show --json agree');
  assert.match(jarl(root, 'show', id), /^\(1 note retracted, not shown/m);
  // The other way round: the retracted note is the longer one.
  const other = loop();
  const oid = started(other);
  jarl(other, 'evidence', oid, 'the build is green on every platform');
  jarl(other, 'evidence', oid, 'the build');
  jarl(other, 'retract', oid, 'note-1', '--by', 'jarl', 'wrong platform list');
  const w = seen(other, oid);
  assert.deepEqual(w.tail, [`${oid} evidence · the build`]);
  assert.deepEqual([w.counted, w.said, w.shownCount], [1, 1, 1]);
});

test('of two notes with the same words the line hidden is the retracted note\'s own, by the order they were written', () => {
  for (const [retracted, kept] of [['note-1', 'same words'], ['note-2', 'same words\nand a second line']]) {
    const root = loop();
    const id = started(root);
    jarl(root, 'evidence', id, 'same words\nand a second line');
    jarl(root, 'evidence', id, 'same words');
    jarl(root, 'retract', id, retracted, '--by', 'jarl', 'the wrong one');
    const v = seen(root, id);
    const line = kept.includes('\n') ? `${id} evidence · same words (+1 more lines, whole text in the issue's Evidence section)` : `${id} evidence · same words`;
    assert.deepEqual(v.tail, [line], `${retracted} retracted: the other note's line stays`);
    assert.deepEqual([v.counted, v.said, v.shownCount], [1, 1, 1]);
  }
  // Two notes of identical text, one retracted: one line and one retraction are counted, not two.
  const root = loop();
  const id = started(root);
  jarl(root, 'evidence', id, 'identical');
  jarl(root, 'evidence', id, 'identical');
  jarl(root, 'retract', id, 'note-2', '--by', 'jarl', 'written twice');
  const v = seen(root, id);
  assert.deepEqual(v.tail, [`${id} evidence · identical`]);
  assert.deepEqual([v.counted, v.said, v.shownCount], [1, 1, 1]);
});

test('a retracted note of one issue hides nothing of another issue\'s notes with the same words', () => {
  const root = loop();
  const first = started(root, 'first thing');
  const second = started(root, 'second thing');
  jarl(root, 'evidence', first, 'the build');
  jarl(root, 'evidence', second, 'the build');
  jarl(root, 'evidence', second, 'the build is green');
  jarl(root, 'retract', first, 'note-1', '--by', 'jarl', 'wrong issue');
  const one = seen(root, first);
  const two = seen(root, second);
  assert.deepEqual(one.tail, []);
  assert.deepEqual(two.tail, [`${second} evidence · the build`, `${second} evidence · the build is green`]);
  assert.deepEqual([one.counted, one.said, one.shownCount], [1, 1, 1]);
  assert.equal(two.shownCount, 0);
});

test('a retracted ruling note of several lines, written by decide or by an answer, hides its own line and nothing that starts like it', () => {
  const root = loop();
  const id = started(root);
  jarl(root, 'decide', 'the-way', 'we go this way\nand not the other\n# a heading line', '--by', 'jarl', '--settles', id);
  jarl(root, 'ask', 'which way now?', '--issue', id);
  jarl(root, 'answer', 'a-1', 'this way\nfor now', '--by', 'jarl');
  jarl(root, 'evidence', id, 'Ruling the-way (by jarl): we go this way');
  jarl(root, 'retract', id, 'note-1', '--by', 'jarl', 'the ruling was written into the wrong issue');
  jarl(root, 'retract', id, 'note-2', '--by', 'jarl', 'the answer was written into the wrong issue');
  const v = seen(root, id);
  assert.deepEqual(v.tail, [`${id} evidence · Ruling the-way (by jarl): we go this way`], 'the live note that starts like the ruling keeps its line');
  assert.deepEqual([v.counted, v.said, v.shownCount], [2, 2, 2]);
});

test('a retracted note of several lines hides its own line and nothing that starts like it', () => {
  const root = loop();
  const id = started(root);
  jarl(root, 'evidence', id, 'checked on three platforms\nlinux passed\nmac passed');
  jarl(root, 'evidence', id, 'checked on three platforms and all passed');
  jarl(root, 'retract', id, 'note-1', '--by', 'jarl', 'the windows run was missing');
  const v = seen(root, id);
  assert.deepEqual(v.tail, [`${id} evidence · checked on three platforms and all passed`]);
  assert.deepEqual([v.counted, v.said, v.shownCount], [1, 1, 1]);
});

test('a retracted note that starts with a list bullet, one escaped when written, and one whose own words end like the pointer of a longer note hide their own line, and a live one alike keeps its', () => {
  const pointerWords = "the run is green (+2 more lines, whole text in the issue's Evidence section)";
  for (const text of ['- a list item', '# like a heading', '<<<<<<< like a conflict', '~~looks struck', '- ~~a bullet that looks struck', pointerWords, 'ends like a strike ~~']) {
    const root = loop();
    const id = started(root);
    jarl(root, 'evidence', id, text);
    jarl(root, 'evidence', id, `${text}\nand a second line`);
    jarl(root, 'evidence', id, 'a live note');
    jarl(root, 'retract', id, 'note-1', '--by', 'jarl', 'the wrong words');
    const v = seen(root, id);
    assert.deepEqual(v.tail, [`${id} evidence · ${text} (+1 more lines, whole text in the issue's Evidence section)`, `${id} evidence · a live note`], text);
    assert.deepEqual([v.counted, v.said, v.shownCount], [1, 1, 1], text);
    // The other note of the two retracted instead: the line of the one of one line stays.
    const other = loop();
    const oid = started(other);
    jarl(other, 'evidence', oid, text);
    jarl(other, 'evidence', oid, `${text}\nand a second line`);
    jarl(other, 'retract', oid, 'note-2', '--by', 'jarl', 'the wrong words');
    const w = seen(other, oid);
    assert.deepEqual(w.tail, [`${oid} evidence · ${text}`], text);
    assert.deepEqual([w.counted, w.said, w.shownCount], [1, 1, 1], text);
  }
});

// Every sequence of notes over words a note can open with, in an Evidence section in parts and in one with none (where a
// note written by hand stands first, with no log line), each with every set of its notes retracted: the log tail of resume
// leaves out exactly the lines the retracted notes wrote, in the order they were written, and counts them.
test('the lines of retracted notes, over every sequence of notes that open alike, escaped or not, are paired with their notes by the order they were written', () => {
  const root = loop();
  const id = started(root);
  const f = L.findIssue(root, id).file;
  const logFile = join(root, '.jarl', 'log.md');
  // The first retraction raises the record format; each history then starts from the issue and the log of before it.
  const [baseFile, baseLog] = [file(root, id), log(root)];
  jarl(root, 'evidence', id, 'raises the format');
  jarl(root, 'retract', id, 'note-1', '--by', 'jarl', 'raises the format once');
  const POOL = ['same', 'same\nwith more', '- same', '# same', '<<<<<<< same', '~~same', '### Notes', "same (+1 more lines, whole text in the issue's Evidence section)"];
  const logged = (t) => { const ls = t.split('\n'); return ls.length > 1 ? `${ls[0]} (+${ls.length - 1} more lines, whole text in the issue's Evidence section)` : ls[0]; };
  const words = (n) => (n === 0 ? [[]] : words(n - 1).flatMap((w) => POOL.map((p) => [...w, p])));
  const sequences = [...words(1), ...words(2), ...words(3).filter((s) => s.every((t) => ['same', 'same\nwith more', '- same'].includes(t)))];
  let histories = 0;
  for (const unsplit of [false, true]) {
    for (const notes of sequences) {
      for (let mask = 1; mask < 2 ** notes.length; mask += 1) {
        writeFileSync(f, baseFile.replace(/## Evidence\n[\s\S]*$/, unsplit ? '## Evidence\nsame\n' : '## Evidence\n'));
        writeFileSync(logFile, baseLog);
        for (const t of notes) R.addEvidence(root, id, t);
        const first = unsplit ? 2 : 1;
        notes.forEach((_, k) => { if (mask & (2 ** k)) R.addEvidence(root, id, 'taken back', { retract: `note-${k + first}`, by: 'jarl' }); });
        const data = R.resumeData(root, { log: 100 });
        const what = `${unsplit ? 'no parts' : 'parts'}: ${JSON.stringify(notes)}, retracted ${mask.toString(2)}`;
        assert.deepEqual(data.log.filter((l) => / · \d+ evidence · /.test(l)).map((l) => l.replace(/^.* · (?=\d+ evidence · )/, '')), notes.filter((_, k) => !(mask & (2 ** k))).map((t) => `${id} evidence · ${logged(t)}`), what);
        assert.ok(!data.log.some((l) => / evidence retract · /.test(l)), what);
        assert.equal(data.logRetractedNotes, notes.filter((_, k) => mask & (2 ** k)).length, what);
        histories += 1;
      }
    }
  }
  assert.equal(histories, 2 * (8 + 64 * 3 + 27 * 7));
});

test('notes written by this Jarl, by the pinned writer of record formats 1 and 2 and by the pinned first writer, in every order, each with every set of them retracted: the log tail hides exactly the retracted notes\' lines and counts them', async () => {
  const { histories, refused } = await noteHistories(R);
  assert.deepEqual(refused, [], 'every writer writes every history');
  assert.deepEqual(histories.filter((h) => h.wrong).map((h) => `${h.what} :: ${h.wrong}`), []);
  assert.equal(histories.length, 30 + 900 * 3 + 216 * 7);
});

test('a retracted note is read by neither the pinned frozen reader nor the done gate', () => {
  const root = loop();
  const id = started(root);
  jarl(root, 'evidence', id, 'a note');
  assert.equal(oldJarl(root, 'list', {}).ok, true, 'before: 6.1.0 reads the loop');
  jarl(root, 'retract', id, 'note-1', '--by', 'jarl', 'written on the wrong issue');
  const r = oldJarl(root, 'list', {});
  assert.equal(r.ok, false);
  assert.match(r.error, /written for record format 3, and this Jarl reads format 1/);
  assert.equal(L.workEvidence({ sections: { evidence: '~~a struck note~~\n\n- **ran:** a · **saw:** b' } }), '- **ran:** a · **saw:** b');
  assert.equal(L.workEvidence({ sections: { evidence: 'a live note\n\n~~a struck note~~' } }), 'a live note');
});

test('a note in a section with no sub-headings is numbered apart from its rows, and a note that starts with ~~ is escaped', () => {
  const root = loop();
  const id = started(root);
  const f = L.findIssue(root, id).file;
  writeFileSync(f, readFileSync(f, 'utf8').replace(/## Evidence\n[\s\S]*$/, '## Evidence\nan older note\n- **ran:** a · **saw:** b\n'));
  jarl(root, 'evidence', id, '~~not a retraction~~');
  assert.match(file(root, id), /^\\~~not a retraction~~$/m);
  const shown = jarl(root, 'show', id);
  assert.match(shown, /^\[note-1\] an older note$/m);
  assert.match(shown, /^- \[1\] \*\*ran(?: \(line [0-9a-f, ]+\))?:\*\* a/m, 'the row keeps its own number');
  assert.match(shown, /^\[note-2\] \\~~not a retraction~~$/m, 'a note that only looks struck is still a note');
  jarl(root, 'retract', id, 'note-1', '--by', 'jarl', 'superseded by the next note');
  assert.doesNotMatch(jarl(root, 'show', id), /an older note/);
  assert.match(file(root, id), /^~~an older note~~$/m);
  assert.match(jarl(root, 'verify', '--json'), /./, 'the record still reads');
});

test('a loop run by a composer refuses the retraction of a note and writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-retract-composed-'));
  mkdirSync(join(dir, '.git'));
  const profile = join(mkdtempSync(join(tmpdir(), 'jarl-retract-profile-')), 'profile.json');
  writeFileSync(profile, JSON.stringify({ 'jarl-profile': 1, name: 'composed', statuses: L.BUILTIN_STATUSES, 'external-scheduler': 'the composer tick' }, null, 2));
  jarl(dir, 'init', 'a composed goal', '--profile', profile);
  const id = R.newIssue(dir, 'first issue', { acceptance: '[read] it works' }).id;
  jarl(dir, 'evidence', id, 'a note');
  const before = file(dir, id);
  assert.match(refuses(dir, 'retract', id, 'note-1', '--by', 'jarl', 'wrong issue'), /the retraction of a note needs record format 3.*nothing was written/s);
  assert.equal(file(dir, id), before);
});
