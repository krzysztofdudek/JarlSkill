// Retraction by an appended entry (issue 245), a title change and a review with empty findings. The first retraction of
// a loop raises the record format, so the pinned Jarl 6.1.0 (tests/old-jarl.mjs) refuses the loop instead of counting
// the retracted approve or row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { oldJarl } from './old-jarl.mjs';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const L = await import('../jarl-lib.mjs');

function jarl(root, ...args) {
  return execFileSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function refuses(root, ...args) {
  try { jarl(root, ...args); } catch (e) { return String(e.stderr); }
  throw new Error(`expected a refusal: ${args.join(' ')}`);
}
function loop() {
  const root = mkdtempSync(join(tmpdir(), 'jarl-retract-'));
  mkdirSync(join(root, '.git'));
  jarl(root, 'init', 'a goal');
  return root;
}
// An issue in progress on a branch (a code issue), filed under id 001 unless others exist.
function started(root, title = 'thing to do') {
  const id = JSON.parse(jarl(root, 'new', title, '--acceptance', 'it works', '--json')).id;
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
  assert.match(said, /001 review retracted by jarl \(coordinator\): the approve by opus-reviewer-1 \(fresh\)/);
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

test('the first retraction raises the format before its line is written; the pinned Jarl 6.1.0 refuses the loop loudly', () => {
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
  const id = JSON.parse(jarl(root, 'new', 'a wrong title', '--json')).id;
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
    assert.match(refuses(root, 'review', id, 'approve', '--by', 'rev-a', findings), /(needs words|requires)/, JSON.stringify(findings));
  }
  assert.match(refuses(root, 'review', id, 'changes', '--by', 'rev-a', 'x'), /needs words/);
  assert.doesNotMatch(file(root, id), /## Reviews/, 'nothing was written');
  assert.match(jarl(root, 'review', id, 'approve', '--by', 'rev-a', 'ok'), /review approve/);
});
