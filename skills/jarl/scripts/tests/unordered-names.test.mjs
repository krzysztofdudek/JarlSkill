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
  for (const t of ['first', 'second', 'third']) jarl(root, 'new', t, '--acceptance', '[read] it works', '--what', 'plain text');
  jarl(root, 'new', 'fourth', '--what', 'plain text', '--acceptance', '[read] works once issue 1 and #2 are in');
  return root;
}

test('only an explicit citation counts: a number after the word issue or task, after a hash sign, or alone in brackets', () => {
  const held = new Set(['1', '2', '5', '7', '12', '84', '85', '100', '101', '123', '184', '185', '285', '456', '1000', '1043', '128']);
  const ids = (text) => idsCited(text, held);
  assert.deepEqual(ids('needs issue 12 and 100'), ['12', '100']);
  assert.deepEqual(ids('Needs ISSUES 1, 2 and 12, or Task 100, or task 101.'), ['1', '2', '12', '100', '101']);
  assert.deepEqual(ids('issues 1, 2, and 12 & 100'), ['1', '2', '12', '100']);
  assert.deepEqual(ids('after #2, (101), (100, 1000) and (#285).'), ['2', '100', '101', '285', '1000']);
  assert.deepEqual(ids('(184, 185), (184 and 185) and (184 & 100)'), ['100', '184', '185']);
  assert.deepEqual(ids('issue 5 - 7 and issue 12 - 100'), ['5', '12'], 'a range cites the number before its hyphen, when spaces stand around the hyphen');
  assert.deepEqual(ids('issue 285.'), ['285']);
  assert.deepEqual(ids("issue 100's evidence"), ['100']);
  assert.deepEqual(ids('issue #12'), ['12']);
  assert.deepEqual(ids(''), []);
  assert.deepEqual(ids(undefined), []);
  assert.deepEqual(ids('issue 999'), [], 'an id the loop does not hold');
});

test('idsCited reads the set as it stands at each call, also when a change keeps the set size', () => {
  const held = new Map([['7', {}], ['8', {}]]);
  assert.deepEqual(idsCited('issue 7 and issue 8', held), ['7', '8']);
  held.delete('7');
  held.set('9', {});
  assert.equal(held.size, 2, 'the set keeps its size');
  assert.deepEqual(idsCited('issue 7 and issue 8', held), ['8'], 'an id that left the set is not cited');
  assert.deepEqual(idsCited('issue 9', held), ['9'], 'an id that joined the set is cited');
});

test('a plain amount, a position, an exit status or a part of a longer token is no citation', () => {
  const held = new Set(['1', '2', '3', '4', '12', '84', '85', '100', '101', '123', '128', '160', '184', '185', '285', '309', '456', '1000', '1043']);
  const ids = (text) => idsCited(text, held);
  // Amounts of something: a bare number with a unit after it, or in no explicit citation at all.
  assert.deepEqual(ids('309 lines, 160 characters, 41,043 bytes, 285 ms, 100 percent, 101 tests, 12 files, 100%'), []);
  assert.deepEqual(ids('(309 lines) and (160 characters) and (100 tests) and (101 times) and (285 ms) and (100%)'), []);
  assert.deepEqual(ids('#309 lines and #160 characters'), []);
  assert.deepEqual(ids('the file has 309 lines and the check exits with 128'), []);
  assert.deepEqual(ids('exits with (128), status (128), code (128), exit (128)'), []);
  assert.deepEqual(ids('status 128, code 128, 285 and 1000'), []);
  assert.deepEqual(ids('in rounds 100 and 101, lines 100 and 101, row 100, step 12, port 1000, version 101'), []);
  // A thousands group, a decimal, a version, a date, a time, a sha.
  assert.deepEqual(ids('issue 41,043 and issue 1,043 and issues 12,100'), []);
  assert.deepEqual(ids('issue 100.5, issue 1.0.0, version 6.2.1 and (100.5)'), []);
  assert.deepEqual(ids('on 2026-11-03 at 12:44 and issue 2026-11'), []);
  assert.deepEqual(ids('merged 1000a2f at 71ebc5b, then 2236405 and c1afa59, issue 100a'), []);
  // A hyphenated or slashed token, a file and line, a range, an id of another loop.
  assert.deepEqual(ids('see lib/verify.mjs:285 and verify.mjs:100'), []);
  assert.deepEqual(ids('issues 100-101 and issue 12/13 and issue 100/101'), []);
  assert.deepEqual(ids('ask-100, a-101, reviewer-285, rev-1000-opus, jarl/100-x and non-issue 12'), []);
  assert.deepEqual(ids('foo(100) and bar[101] and 100'), []);
  // A thousands group is no list, and a comma with no space is no join; a list of fewer than three digits is no bracket citation.
  assert.deepEqual(ids('(123,456), (100,000), (184,185), (123,456,184) and issues 3,4 and issue 5-7'), []);
  assert.deepEqual(ids('(84, 85) and (84,85) and (84 and 85)'), []);
});

test('sentences of a real loop name the issues they cite and none of the ids, counts and rulings they mention', () => {
  const held = new Set(['001', '004', '007', '039', '058', '084', '100', '128', '309']);
  const ids = (text) => idsCited(text, held);
  assert.deepEqual(ids('Map row fr-14; issue 004 adds an owner\'s waiver by ruling.'), ['004']);
  assert.deepEqual(ids('the owner\'s own looks are owner-only lines (039)'), ['039']);
  assert.deepEqual(ids('a limit the per-issue key of issue 084 removes'), ['084']);
  assert.deepEqual(ids('Map row fr-26: resume on the loop copy printed ask-001, and the owner did not follow the question (a-007).'), []);
  assert.deepEqual(ids('as a fix round did in the field (see 058\'s evidence)'), []);
  assert.deepEqual(ids('a 600-line refactor; the file grew to 309 lines, 160 characters wide; the check exits with 128'), []);
  assert.deepEqual(ids('Tested on a copy of the 6.2.0 loop at 71ebc5b on 2026-11-03: 41,043 bytes in 100 files'), []);
});

test('a deep After chain is walked without recursion, and an issue that cites the first of it is noted', async () => {
  const { unorderedNamings } = await import('../lib/loop.mjs');
  const { loadProfile } = await import('../lib/profile.mjs');
  const profile = loadProfile(makeLoop({ prefix: 'jarl-unordered-', via: 'cli' }));
  const issues = Array.from({ length: 1200 }, (_, k) => ({ id: String(k + 1), status: 'open', after: k === 0 ? [] : [String(k)], sections: { what: k === 0 ? '' : `builds on issue ${k}`, why: '', acceptance: '' } }));
  assert.deepEqual(unorderedNamings(issues, profile), [], 'each cites the one it waits on');
  issues[1199].sections.what = 'also needs issue 1 and issue 700';
  assert.deepEqual(unorderedNamings(issues, profile), [], 'both are in the chain of the last');
  issues[0].after = ['1200'];
  assert.deepEqual(unorderedNamings(issues, profile).map((n) => n.id), [], 'a cycle ends the walk');
  issues[0].after = [];
  issues[1199].after = [];
  assert.deepEqual(unorderedNamings(issues, profile).map((n) => `${n.id}:${n.names.join(',')}`), ['1200:1,700']);
});

test('verify notes each open issue whose text names an unordered open issue, naming both, and exits clean', () => {
  const root = named();
  const r = run(root, ['verify']);
  assert.equal(r.status, 0, 'a note is not a finding');
  assert.match(r.stdout, /^verify: clean/);
  assert.deepEqual(unordered(r.stdout).map((l) => l.replace(/ — .*$/, '')), ['note: issue 4: names issues 1, 2 in What, Why or Acceptance, which are neither done nor dropped, and no After orders them with 4']);
  assert.match(r.stdout, /if the text relies on them, order the two by adding them to After, which keeps what After holds: jarl\.mjs field 4 After "<ids-it-waits-on>" --add --by "<who>"$/m);
});

test('the command the note ends with adds to After and keeps what After held: run filled, an issue already waiting on another waits on both', () => {
  const root = makeLoop({ prefix: 'jarl-unordered-keep-', via: 'cli' });
  for (const t of ['first', 'second', 'third']) jarl(root, 'new', t, '--acceptance', '[read] it works', '--what', 'plain text');
  jarl(root, 'field', '3', 'After', '1');
  jarl(root, 'new', 'fourth', '--acceptance', '[read] it works', '--what', 'plain text');
  const said = run(root, ['field', '3', 'What', 'relies on issue 4 for its data']);
  assert.equal(said.status, 0, said.stderr);
  const note = unordered(`${said.stdout}\n${said.stderr}`)[0];
  const command = /: jarl\.mjs (field 3 After "<ids-it-waits-on>" --add --by "<who>")$/.exec(note ?? '');
  assert.ok(command, `the note ends with the command that adds: ${note}`);
  jarl(root, ...command[1].replace('"<ids-it-waits-on>"', '4').replace('"<who>"', 'jarl').split(' '));
  assert.deepEqual(R.findIssue(root, '3').after, ['1', '4'], 'the wait on 1 is kept, and 4 is added');
});

test('an After that orders the two, directly or through a chain, or a settled named issue, takes the note away', () => {
  const root = named();
  jarl(root, 'field', '4', 'After', '1');
  assert.deepEqual(unordered(run(root, ['verify']).stdout).map((l) => l.replace(/ — .*$/, '')), ['note: issue 4: names issue 2 in What, Why or Acceptance, which is neither done nor dropped, and no After orders it with 4']);
  jarl(root, 'field', '1', 'After', '2');
  assert.deepEqual(unordered(run(root, ['verify']).stdout), [], 'issue 2 is in the chain of 4 through issue 1');
  jarl(root, 'field', '1', 'After', '--clear');
  jarl(root, 'field', '4', 'After', '2');
  jarl(root, 'set', '1', 'dropped', 'not needed');
  assert.deepEqual(unordered(run(root, ['verify']).stdout), [], 'issue 1 is dropped, issue 2 is ordered');
});

test('a named issue that waits on the naming one is behind it and is not noted, nor is a naming issue that is done', () => {
  const root = named();
  jarl(root, 'field', '1', 'After', '4');
  jarl(root, 'field', '2', 'After', '4');
  assert.deepEqual(unordered(run(root, ['verify']).stdout), []);
  const other = named();
  jarl(other, 'set', '4', 'dropped', 'not needed');
  assert.deepEqual(unordered(run(other, ['verify']).stdout), []);
});

test('new and body print the same note on stderr as verify, once, and no other command or record line carries it', () => {
  const root = makeLoop({ prefix: 'jarl-unordered-', via: 'cli' });
  jarl(root, 'new', 'first', '--acceptance', '[read] it works', '--what', 'plain text');
  jarl(root, 'new', 'second', '--acceptance', '[read] it works', '--what', 'plain text');
  const filed = run(root, ['new', 'third', '--acceptance', '[read] it works', '--what', 'builds on issue 1', '--kind', 'gap', '--prio', '2', '--tier', 'standard']);
  assert.equal(filed.status, 0);
  assert.deepEqual(unordered(filed.stderr).map((l) => l.replace(/ — .*$/, '')), ['note: issue 3: names issue 1 in What, Why or Acceptance, which is neither done nor dropped, and no After orders it with 3']);
  const body = run(root, ['field', '3', 'Acceptance', '[read] issue 2 is merged first and issue 1 too']);
  assert.equal(body.status, 0);
  assert.equal(body.stdout, '3 Acceptance: [read] issue 2 is merged first and issue 1 too');
  const said = unordered(body.stderr);
  assert.equal(said.length, 1);
  assert.match(said[0], /^note: issue 3: names issues 1, 2 in What, Why or Acceptance, which are neither done nor dropped/);
  const verified = unordered(run(root, ['verify']).stdout);
  assert.equal(verified.length, 1);
  assert.equal(said[0], verified[0], 'the same line from body and verify');
  // The note is not a record line, and a body that leaves What, Why and Acceptance alone says none.
  assert.doesNotMatch(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /which are neither done nor dropped/);
  assert.deepEqual(unordered(run(root, ['field', '3', 'Title', 'third, renamed']).stderr), []);
  assert.deepEqual(unordered(run(root, ['field', '3', 'Changelog', 'Added: x']).stderr), []);
  assert.deepEqual(unordered(run(root, ['field', '3', 'After', '1,2']).stderr), []);
  assert.deepEqual(unordered(run(root, ['field', '3', 'Why', 'issue 2 first']).stderr), [], 'the order holds, so the note is gone');
});

test('a library call files and rewrites the same text with no note in its result', async () => {
  const root = makeLoop({ prefix: 'jarl-unordered-', via: 'library' });
  R.newIssue(root, 'first', { acceptance: '[read] it works', what: 'plain text' });
  const second = R.newIssue(root, 'second', { acceptance: '[read] it works', what: 'builds on issue 1' });
  assert.equal(second.note, undefined);
  const { cmdBody } = await import('../jarl-lib.mjs');
  assert.equal(cmdBody(root, second.id, { acceptance: '[read] issue 1 is in' }).note, undefined);
});
