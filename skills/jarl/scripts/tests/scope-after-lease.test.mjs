// An issue's scope does not grow once it is leased, and when it does, the record shows it. A change to the acceptance of a
// leased issue that adds or rewrites a line, through field or split alike, prints a note that names each line the scope
// grew by, and the change's log line carries the mark `grew after the lease: line <n>`; report counts those changes per
// writer, the --by of the call. A change that only takes lines away, or one on an issue no lease holds, carries no mark.
// The mark is a segment of the description line every reader already places, so the record format is not raised by it,
// and the frozen readers read a loop that holds one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jarl, run, loop as makeLoop } from './helpers.mjs';
import { fileAsBefore, formatTwoJarl, oldJarl } from './old-jarl.mjs';

const loop = () => makeLoop({ prefix: 'jarl-scope-', via: 'cli', dotGit: false });
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const logText = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const marker = (root) => join(root, '.jarl', 'profile.json');

// One issue with one acceptance line, leased.
function leased() {
  const root = loop();
  jarl(root, 'goal', '--set', 'Coordinators: odin');
  jarl(root, 'new', 'the export', '--acceptance', '[read] it writes csv');
  jarl(root, 'set', '1', 'in-progress', 'start', '--worker', 'w1');
  return root;
}

test('a line added to the acceptance of a leased issue prints a note naming it, and its log line carries the mark', () => {
  const root = leased();
  const r = run(root, ['field', '1', 'Acceptance', '[read] it writes json', '--add', '--by', 'odin']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '1 Acceptance: - it writes csv - it writes json');
  assert.match(r.stderr, /^note: 1 is leased \(in-progress\), and its scope grew after the lease: line 2 "it writes json" — an issue's scope does not grow once it is leased: a new ask is a new issue, jarl\.mjs new "<title>" --acceptance "<line>"$/m);
  assert.match(logText(root), /^- \S+ \S+ key \S+ · 1 body · acceptance · was "it writes csv" \(13 characters\) · grew after the lease: line 2 · by odin$/m);
});

test('a rewritten line counts as growth, a change that only takes lines away does not, and neither does a change before the lease', () => {
  const root = loop();
  jarl(root, 'new', 'the export', '--acceptance', '[read] it writes csv', '--acceptance', '[read] it writes json');
  const open = run(root, ['field', '1', 'Acceptance', '[read] it writes csv\n[read] it writes json\n[read] the docs name both']);
  assert.doesNotMatch(open.stderr, /grew after the lease/, 'an open issue is held by no lease');
  assert.doesNotMatch(logText(root), /grew after the lease/);
  jarl(root, 'set', '1', 'in-progress', 'start', '--worker', 'w1');
  const rewritten = run(root, ['field', '1', 'Acceptance', '[read] it writes csv with a header\n[read] it writes json\n[read] the docs name both']);
  assert.match(rewritten.stderr, /its scope grew after the lease: line 1 "it writes csv with a header"/);
  assert.match(logText(root), /· 1 body · acceptance · was "- it writes csv" \(\d+ characters\) · grew after the lease: line 1$/m);
  const lines = logText(root).split('\n').length;
  const narrowed = run(root, ['field', '1', 'Acceptance', '[read] it writes csv with a header\n[read] it writes json']);
  assert.doesNotMatch(narrowed.stderr, /grew after the lease/, 'a line taken away narrows the scope');
  assert.equal(logText(root).split('\n').length, lines + 1, 'the change is logged as any description change is');
  assert.doesNotMatch(logText(root).trim().split('\n').pop(), /grew after the lease/);
});

test('split moving a line to a leased sub-issue marks the sub-issue that grew, not the parent that gave it', () => {
  const root = loop();
  jarl(root, 'goal', '--set', 'Coordinators: odin');
  jarl(root, 'new', 'the export', '--acceptance', '[read] it writes csv', '--acceptance', '[read] it writes json');
  jarl(root, 'new', 'the json writer', '--acceptance', '[read] json is valid');
  jarl(root, 'set', '2', 'in-progress', 'start', '--worker', 'w2');
  const r = run(root, ['split', '1', '--line', '1=1', '--line', '2=2', '--by', 'odin']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^note: 2 is leased \(in-progress\), and its scope grew after the lease: line 2 "it writes json"/m);
  assert.match(logText(root), /· 2 body · acceptance · was "json is valid" \(13 characters\) · grew after the lease: line 2 · by odin$/m);
  assert.match(logText(root), /· 1 body · acceptance · was "- it writes csv" \(\d+ characters\) · by odin$/m);
});

test('report counts the changes that grew a scope after its lease per writer, and marks a writer that is no coordinator', () => {
  const root = leased();
  jarl(root, 'new', 'the import', '--acceptance', '[read] it reads csv');
  jarl(root, 'set', '2', 'in-progress', 'start', '--worker', 'w2');
  jarl(root, 'field', '1', 'Acceptance', '[read] it writes json', '--add', '--by', 'odin');
  jarl(root, 'field', '2', 'Acceptance', '[read] it reads json', '--add', '--by', 'odin');
  jarl(root, 'field', '1', 'Acceptance', '[read] it writes xml', '--add', '--by', 'w1');
  jarl(root, 'field', '2', 'Acceptance', '[read] it reads xml', '--add');
  assert.deepEqual(json(root, 'report').metrics.slips.scopeGrew, [
    { writer: 'odin', coordinator: true, count: 2, issues: ['1', '2'] },
    { writer: 'w1', coordinator: false, count: 1, issues: ['1'] },
    { writer: null, coordinator: false, count: 1, issues: ['2'] },
  ]);
  assert.match(jarl(root, 'report', '--metrics'), /^scope grew after the lease, per writer: odin 2 \(1, 2\) · w1 1 \(1\), not a coordinator · unnamed 1 \(2\)$/m);
  assert.match(jarl(loop(), 'report', '--metrics'), /^scope grew after the lease, per writer: none$/m);
});

test('the mark raises no record format: the frozen readers read a loop whose leased issue grew', () => {
  const root = loop();
  fileAsBefore(root, 'the export', { acceptance: 'it writes csv' });
  assert.equal(oldJarl(root, 'set', {}, ['001', 'in-progress', null, { branch: 'jarl/001-export', worker: 'w1' }]).ok, true);
  const r = run(root, ['field', '1', 'Acceptance', '[read] it writes json', '--add']);
  assert.match(r.stderr, /its scope grew after the lease: line 2 "it writes json"/);
  assert.match(logText(root), /· 001 body · acceptance · was "it writes csv" \(13 characters\) · grew after the lease: line 2$/m);
  assert.equal(existsSync(marker(root)), false, 'the loop stays in format 1');
  for (const [reader, read] of [['the reader of format 1', oldJarl], ['the reader of formats 1 and 2', formatTwoJarl]]) {
    for (const view of ['list', 'status', 'report']) {
      const v = read(root, view, {});
      assert.equal(v.ok, true, `${reader} reads the loop with ${view}: ${v.error}`);
    }
  }
});
