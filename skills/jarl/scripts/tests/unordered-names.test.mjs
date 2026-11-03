// An open issue whose What, Why or Acceptance names another unfinished issue that nothing orders with it gets a note from
// verify, new and body. The note never refuses, fails or writes a record line of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as R from '../record.mjs';
import { jarl, run, loop as makeLoop } from './helpers.mjs';

const { idsCited } = await import('../lib/ids.mjs');

const noteLines = (text) => text.split('\n').filter((l) => l.startsWith('note: '));
const unordered = (text) => noteLines(text).filter((l) => / in What, Why or Acceptance, which /.test(l));
// A loop of four issues; the fourth names the first two in its Acceptance.
function named() {
  const root = makeLoop({ prefix: 'jarl-unordered-', via: 'cli' });
  for (const t of ['first', 'second', 'third']) jarl(root, 'new', t, '--what', 'plain text');
  jarl(root, 'new', 'fourth', '--what', 'plain text', '--acceptance', 'works once issue 1 and #2 are in');
  return root;
}

test('a number counts as an issue when it stands alone as a word, and not inside a sha, a date, a version, a line number or a range', () => {
  const held = new Set(['1', '2', '12', '100', '101', '285', '1000']);
  const ids = (text) => idsCited(text, held);
  assert.deepEqual(ids('needs issue 12 and 100'), ['12', '100']);
  assert.deepEqual(ids('after #2, (101), 285. and 1000:'), ['2', '101', '285', '1000']);
  assert.deepEqual(ids('issues 1, 2 and 12'), ['1', '2', '12']);
  assert.deepEqual(ids("100's evidence, see 101's rows"), ['100', '101']);
  // A number of one or two digits is an issue only when introduced; free-standing it is a count.
  assert.deepEqual(ids('12 files and 2 tests'), []);
  // False positives: a sha, a date, a version, a line number, a range, a hyphenated or dotted name.
  assert.deepEqual(ids('merged 1000a2f at 71ebc5b, then 2236405 and c1afa59'), []);
  assert.deepEqual(ids('on 2026-11-03 at 12:44 and 2026-11'), []);
  assert.deepEqual(ids('Jarl 6.2.1, version 101, 1.0.0 and v100'), []);
  assert.deepEqual(ids('see lib/verify.mjs:285 and verify.mjs:100'), []);
  assert.deepEqual(ids('at line 285, lines 100 and 101, row 100, step 12, port 1000'), []);
  assert.deepEqual(ids('the range 100-101 and lines 285-300'), []);
  assert.deepEqual(ids('ask-100, a-101, reviewer-285, rev-1000-opus and jarl/100-x'), []);
  assert.deepEqual(ids(''), []);
  assert.deepEqual(ids(undefined), []);
});

test('verify notes each open issue whose text names an unordered open issue, naming both, and exits clean', () => {
  const root = named();
  const r = run(root, ['verify']);
  assert.equal(r.status, 0, 'a note is not a finding');
  assert.match(r.stdout, /^verify: clean/);
  assert.deepEqual(unordered(r.stdout).map((l) => l.replace(/ — .*$/, '')), ['note: issue 4: names issues 1, 2 in What, Why or Acceptance, which are neither done nor dropped, and no After orders them with 4']);
  assert.match(r.stdout, /if the text relies on them, order the two with: jarl\.mjs after/);
});

test('an After that orders the two, directly or through a chain, or a settled named issue, takes the note away', () => {
  const root = named();
  jarl(root, 'after', '4', '1');
  assert.deepEqual(unordered(run(root, ['verify']).stdout).map((l) => l.replace(/ — .*$/, '')), ['note: issue 4: names issue 2 in What, Why or Acceptance, which is neither done nor dropped, and no After orders it with 4']);
  jarl(root, 'after', '1', '2');
  assert.deepEqual(unordered(run(root, ['verify']).stdout), [], 'issue 2 is in the chain of 4 through issue 1');
  jarl(root, 'after', '1', '--clear');
  jarl(root, 'after', '4', '2');
  jarl(root, 'set', '1', 'dropped', 'not needed');
  assert.deepEqual(unordered(run(root, ['verify']).stdout), [], 'issue 1 is dropped, issue 2 is ordered');
});

test('a named issue that waits on the naming one is behind it and is not noted, nor is a naming issue that is done', () => {
  const root = named();
  jarl(root, 'after', '1', '4');
  jarl(root, 'after', '2', '4');
  assert.deepEqual(unordered(run(root, ['verify']).stdout), []);
  const other = named();
  jarl(other, 'set', '4', 'dropped', 'not needed');
  assert.deepEqual(unordered(run(other, ['verify']).stdout), []);
});

test('new and body print the same note on stderr as verify, once, and no other command or record line carries it', () => {
  const root = makeLoop({ prefix: 'jarl-unordered-', via: 'cli' });
  jarl(root, 'new', 'first', '--what', 'plain text');
  jarl(root, 'new', 'second', '--what', 'plain text');
  const filed = run(root, ['new', 'third', '--what', 'builds on issue 1', '--kind', 'gap', '--prio', '2', '--tier', 'standard']);
  assert.equal(filed.status, 0);
  assert.deepEqual(unordered(filed.stderr).map((l) => l.replace(/ — .*$/, '')), ['note: 3 names issue 1 in What, Why or Acceptance, which is neither done nor dropped, and no After orders it with 3']);
  const body = run(root, ['body', '3', '--acceptance', 'issue 2 is merged first and issue 1 too']);
  assert.equal(body.status, 0);
  assert.equal(body.stdout, '3 body: acceptance');
  const said = unordered(body.stderr);
  assert.equal(said.length, 1);
  assert.match(said[0], /^note: 3 names issues 1, 2 in What, Why or Acceptance, which are neither done nor dropped/);
  const verified = unordered(run(root, ['verify']).stdout);
  assert.equal(verified.length, 1);
  assert.equal(said[0].replace(/^note: 3 /, ''), verified[0].replace(/^note: issue 3: /, ''), 'the same words from body and verify');
  // The note is not a record line, and a body that leaves What, Why and Acceptance alone says none.
  assert.doesNotMatch(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /which are neither done nor dropped/);
  assert.deepEqual(unordered(run(root, ['body', '3', '--title', 'third, renamed', '--changelog', 'Added: x']).stderr), []);
  assert.deepEqual(unordered(run(root, ['after', '3', '1,2']).stderr), []);
  assert.deepEqual(unordered(run(root, ['body', '3', '--why', 'issue 2 first']).stderr), [], 'the order holds, so the note is gone');
});

test('a library call files and rewrites the same text with no note in its result', async () => {
  const root = makeLoop({ prefix: 'jarl-unordered-', via: 'library' });
  R.newIssue(root, 'first', { what: 'plain text' });
  const second = R.newIssue(root, 'second', { what: 'builds on issue 1' });
  assert.equal(second.note, undefined);
  const { cmdBody } = await import('../jarl-lib.mjs');
  assert.equal(cmdBody(root, second.id, { acceptance: 'issue 1 is in' }).note, undefined);
});
