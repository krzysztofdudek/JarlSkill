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
import { oldJarl } from './old-jarl.mjs';
import { jarl, refuses, loop as makeLoop } from './helpers.mjs';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const L = await import('../jarl-lib.mjs');
// Issues are filed by the library, whose number has three digits, so each loop stays format 1 until a retraction.
const R = await import('../record.mjs');

const loop = () => makeLoop({ prefix: 'jarl-retract-', goal: 'a goal', via: 'cli' });
// An issue in progress on a branch (a code issue), filed under 001 unless others exist.
function started(root, title = 'thing to do') {
  const id = R.newIssue(root, title, { acceptance: 'it works' }).id;
  jarl(root, 'set', id, 'in-progress', '--worker', 'w-one', '--branch', `jarl/${id}-x`);
  return id;
}
const file = (root, id) => readFileSync(L.findIssue(root, id).file, 'utf8');
const log = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const profileFile = (root) => join(root, '.jarl', 'profile.json');
const doneRefusal = (root, id) => { try { jarl(root, 'set', id, 'done', 'merged'); return null; } catch (e) { return String(e.stderr); } };

test('review retract: the newest approve is struck through and no longer counts, by an appended entry', () => {
  const root = loop();
  const id = started(root);
  jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'pass 5');
  jarl(root, 'review', id, 'approve', '--by', 'opus-reviewer-1', 'read the diff, nothing found');
  assert.equal(L.gateState(root, id).approved, true, 'before: the gate counts the approve');
  assert.equal(existsSync(profileFile(root)), false, 'no retraction yet: the record is still format 1');

  const said = jarl(root, 'review', id, 'retract', '--by', 'jarl', 'I approved the wrong branch');
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

test('review retract takes the newest approve not yet retracted, one at a time, and never a changes verdict', () => {
  const root = loop();
  const id = started(root);
  assert.match(refuses(root, 'review', id, 'retract', '--by', 'jarl', 'nothing to take back'), /no approve to retract/);
  assert.equal(existsSync(profileFile(root)), false, 'a refused retraction raises nothing');
  jarl(root, 'review', id, 'changes', '--by', 'rev-a', 'Important: the test never goes red');
  assert.match(refuses(root, 'review', id, 'retract', '--by', 'jarl', 'try to revive the acceptance'), /no approve to retract.*never a "changes" verdict/);
  jarl(root, 'review', id, 'approve', '--by', 'rev-b', 'fixed, read it again');
  jarl(root, 'review', id, 'approve', '--by', 'rev-c', 'also read it');
  jarl(root, 'review', id, 'retract', '--by', 'jarl', 'rev-c read the wrong diff');
  assert.equal(L.gateState(root, id).live.by, 'rev-b', 'rev-c was the newest, rev-b is live again');
  jarl(root, 'review', id, 'retract', '--by', 'jarl', 'rev-b read the wrong diff too');
  assert.equal(L.gateState(root, id).live, null);
  assert.equal(L.gateState(root, id).lastReview, 'changes', 'what is left is the changes verdict: a retraction never overrides it');
  assert.match(refuses(root, 'review', id, 'retract', '--by', 'jarl', 'once more'), /no approve to retract/);
  assert.equal((file(root, id).match(/~~\*\*approve\*\*/g) || []).length, 2);
  assert.match(file(root, id), /\*\*changes\*\* · by rev-a \(fresh\)/, 'the changes entry is not struck');
  // The metrics do not count a retracted approve either.
  jarl(root, 'review', id, 'approve', '--by', 'rev-d', 'read it, nothing found');
  jarl(root, 'evidence', id, '--ran', 'check', '--saw', 'green');
  jarl(root, 'set', id, 'done', 'merged');
  assert.equal(L.loopMetrics(root).freshReviews.reviewers['rev-d'], 1);
  assert.equal(L.loopMetrics(root).freshReviews.reviewers['rev-c'], undefined);
});

test('a retraction needs --by and a reason with words, and names one issue', () => {
  const root = loop();
  const id = started(root);
  jarl(root, 'review', id, 'approve', '--by', 'rev-a', 'read the diff');
  assert.match(refuses(root, 'review', id, 'retract', 'because'), /needs --by/);
  assert.match(refuses(root, 'review', id, 'retract', '--by', 'jarl', 'x'), /a retraction needs words/);
  assert.match(refuses(root, 'review', '1,2', 'retract', '--by', 'jarl', 'because I said so'), /names one issue/);
  assert.equal(existsSync(profileFile(root)), false, 'nothing was raised or written');
  assert.equal(L.gateState(root, id).approved, true);
});

test('evidence --retract: the n-th row of the whole section is struck through and the gate stops counting it', () => {
  const root = loop();
  const id = started(root);
  jarl(root, 'evidence', id, 'a free-text note first');
  jarl(root, 'evidence', id, '--ran', 'cmd one', '--saw', 'wrong result', '--ran', 'cmd two', '--saw', 'second result');
  jarl(root, 'review', id, 'approve', '--by', 'rev-a', 'read the diff');
  const refusal = () => L.doneRefusal(root, L.findIssue(root, id));
  assert.equal(refusal(), null, 'before: the rows and the approve open the gate');
  assert.deepEqual(L.evidenceTable(L.findIssue(root, id).sections.evidence).rows.map((r) => [r.n, r.ran, r.retracted]), [[1, 'cmd one', false], [2, 'cmd two', false]]);

  assert.match(refuses(root, 'evidence', id, '--retract', '3', '--by', 'jarl', 'no such row'), /has 2 evidence rows: there is no row 3/);
  assert.match(refuses(root, 'evidence', id, '--retract', 'two', '--by', 'jarl', 'not a number'), /takes the number of an evidence row/);
  assert.match(refuses(root, 'evidence', id, '--retract', '1', 'because the row is wrong'), /needs --by/);
  assert.match(refuses(root, 'evidence', id, '--retract', '1', '--by', 'jarl', '-'), /a retraction needs words/);
  assert.match(refuses(root, 'evidence', id, '--retract', '1', '--by', 'jarl', 'x', '--ran', 'a', '--saw', 'b'), /not a new --ran\/--saw row|takes at most/);
  assert.equal(existsSync(profileFile(root)) && JSON.parse(readFileSync(profileFile(root), 'utf8')).format, false, 'refused retractions raise nothing');

  assert.equal(jarl(root, 'evidence', id, '--retract', '2', '--by', 'jarl', 'cmd two was run in the wrong place'), '001 evidence row 2 retracted by jarl');
  assert.equal(L.gateState(root, id).rowsSince, 1, 'one row is left');
  assert.equal(refusal(), null);
  const text = file(root, id);
  assert.match(text, /^- ~~\*\*ran:\*\* cmd two · \*\*saw:\*\* second result~~$/m);
  assert.match(text, /^- \*\*ran:\*\* cmd one · \*\*saw:\*\* wrong result$/m, 'another row is untouched');
  assert.match(text, /^- \*\*retracted:\*\* row 2 · by jarl · \d{4}-\d{2}-\d{2}\n  cmd two was run in the wrong place$/m);
  assert.match(log(root), /001 evidence retract · row 2 · by jarl · cmd two was run in the wrong place$/m);
  assert.match(refuses(root, 'evidence', id, '--retract', '2', '--by', 'jarl', 'again'), /row 2 of 001 is retracted already/);
  assert.equal(JSON.parse(readFileSync(profileFile(root), 'utf8')).format, 2);
  jarl(root, 'evidence', id, '--retract', '1', '--by', 'jarl', 'cmd one printed the wrong result');
  assert.equal(L.gateState(root, id).rowsSince, 0, 'every row is retracted');
  assert.match(refusal(), /no --ran\/--saw evidence row recorded since/);
  // A row of the work, recorded again, counts; the numbering never moves, so it is row 3.
  jarl(root, 'evidence', id, '--ran', 'cmd three', '--saw', 'third result');
  assert.deepEqual(L.evidenceTable(L.findIssue(root, id).sections.evidence).rows.map((r) => [r.n, r.retracted]), [[1, true], [2, true], [3, false]]);
  assert.equal(refusal(), null);
});

test('a retraction strikes the row the file numbers, whatever order the journal lines are in', () => {
  const root = loop();
  const id = started(root);
  jarl(root, 'evidence', id, '--ran', 'alpha check', '--saw', 'alpha result');
  jarl(root, 'evidence', id, '--ran', 'beta check', '--saw', 'beta result');
  jarl(root, 'evidence', id, '--ran', 'beta check', '--saw', 'beta result again');
  // The journal's two row lines come back in the other order, as lines of a committed loop can when branches merge.
  const logPath = join(root, '.jarl', 'log.md');
  const lines = readFileSync(logPath, 'utf8').split('\n');
  const [a, b, c] = lines.flatMap((l, i) => (l.includes(`${id} evidence row · `) ? [i] : []));
  [lines[a], lines[b], lines[c]] = [lines[b], lines[c], lines[a]];
  writeFileSync(logPath, lines.join('\n'));
  jarl(root, 'evidence', id, '--retract', '1', '--by', 'jarl', 'alpha ran in the wrong place');
  const state = L.gateState(root, id).rowLog.map((e) => [e.text.split(' · ').pop(), e.retracted]);
  assert.deepEqual(state.sort(), [['alpha check', true], ['beta check', false], ['beta check', false]], 'row 1 of the file is alpha, wherever its journal line is');
  jarl(root, 'evidence', id, '--retract', '3', '--by', 'jarl', 'the second beta ran in the wrong place');
  assert.equal(L.gateState(root, id).rowLog.filter((e) => e.retracted).length, 2);
  assert.equal(L.gateState(root, id).rowsSince, 1);
});

test('a retraction always finds its row: a command holding the saw marker, a command of several lines, and a retraction that cannot be resolved refuses done', () => {
  for (const [ran, saw] of [['echo one · **saw:** two', 'three'], ['first line\nsecond line', 'result'], ['first line\nsecond line · **saw:** x', 'result\nmore']]) {
    const root = loop();
    const id = started(root);
    jarl(root, 'evidence', id, '--ran', 'plain check', '--saw', 'plain result');
    jarl(root, 'evidence', id, '--ran', ran, '--saw', saw);
    jarl(root, 'review', id, 'approve', '--by', 'rev-a', 'read the diff twice');
    assert.equal(L.gateState(root, id).rowsSince, 2);
    jarl(root, 'evidence', id, '--retract', '2', '--by', 'jarl', 'wrong place entirely');
    jarl(root, 'evidence', id, '--retract', '1', '--by', 'jarl', 'also the wrong place');
    const g = L.gateState(root, id);
    assert.deepEqual(g.unresolvedRetractions, [], JSON.stringify(ran));
    assert.equal(g.rowsSince, 0, `both rows are retracted whatever they contain: ${JSON.stringify(ran)}`);
    assert.match(doneRefusal(root, id), /no --ran\/--saw evidence row recorded since/, JSON.stringify(ran));
  }
  // A retraction line naming a row that no journal line fits (a log repaired by hand, merged badly): done refuses, loudly.
  const root = loop();
  const id = started(root);
  jarl(root, 'evidence', id, '--ran', 'a check', '--saw', 'a result');
  jarl(root, 'review', id, 'approve', '--by', 'rev-a', 'read the diff twice');
  const refusal = () => L.doneRefusal(root, L.findIssue(root, id));
  assert.equal(refusal(), null, 'before the bad line the gate is open');
  appendFileSync(join(root, '.jarl', 'log.md'), `- 2026-10-18 20:00 · ${id} evidence retract · row 7 · by jarl · a row that is not there\n`);
  assert.match(refusal(), /records a retraction of evidence row 7 that matches no evidence line of the log/);
  assert.deepEqual(L.gateState(root, id).unresolvedRetractions, [7]);
});

test('the first retraction raises the format before its line is written; the pinned frozen reader refuses the loop loudly', () => {
  for (const retract of [
    (root, id) => jarl(root, 'review', id, 'retract', '--by', 'jarl', 'the approve was a mistake'),
    (root, id) => jarl(root, 'evidence', id, '--retract', '1', '--by', 'jarl', 'the row was a mistake'),
  ]) {
    const root = loop();
    const id = started(root);
    jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'pass');
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

test('body --title changes the heading with a log entry; the file keeps its name', () => {
  const root = loop();
  const id = R.newIssue(root, 'a wrong title').id;
  const before = L.findIssue(root, id).file;
  assert.match(jarl(root, 'body', id, '--title', 'the right title'), /001 body: title/);
  const issue = L.findIssue(root, id);
  assert.equal(issue.file, before, 'the file name is unchanged');
  assert.equal(issue.title, 'the right title');
  assert.match(readFileSync(before, 'utf8'), /^# 001 · the right title\n/);
  assert.match(log(root), /001 body · title · title was "a wrong title"$/m);
  assert.match(jarl(root, 'list'), /the right title/);
  assert.match(refuses(root, 'body', id, '--title', '  '), /--title needs a title/);
  jarl(root, 'body', id, '--title', 'two\nlines', '--what', 'and a body too');
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
