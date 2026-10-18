// A closed issue whose done gate does not hold on the record as it stands is flagged by status, report and resume: one
// line each, with its reason and the command that repairs it. Nothing is refused and the record does not change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jarl, loop as makeLoop } from './helpers.mjs';

const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const loop = (n) => {
  const root = makeLoop({ prefix: 'jarl-closed-gate-', via: 'cli' });
  for (let k = 1; k <= n; k += 1) jarl(root, 'new', `issue ${k}`, '--acceptance', 'it works');
  return root;
};
const row = (root, id) => jarl(root, 'evidence', String(id), '--ran', 'npm test', '--saw', 'pass');
const every = (root) => [jarl(root, 'status'), jarl(root, 'report'), jarl(root, 'resume')];
const flagsOf = (root) => ({ status: json(root, 'status').closedGate, report: json(root, 'report').closedGate, resume: json(root, 'resume').status.closedGate });
const files = (root) => Object.fromEntries(readdirSync(join(root, '.jarl'), { recursive: true }).filter((f) => /\.md$/.test(f)).map((f) => [f, readFileSync(join(root, '.jarl', f), 'utf8')]));

test('a done issue whose approve and proof row were retracted is flagged by every view, with the command that repairs each', () => {
  const root = loop(1);
  jarl(root, 'set', '1', 'in-progress', '--worker', 'w1');
  jarl(root, 'review', '1', 'approve', '--by', 'jarl', 'read the diff, nothing found');
  row(root, 1);
  jarl(root, 'set', '1', 'done');
  jarl(root, 'merged', '1', '--sha', 'abc1234');
  jarl(root, 'review', '1', 'retract', '--by', 'jarl', 'wrong diff was read');
  jarl(root, 'evidence', '1', '--retract', '1', '--by', 'jarl', 'wrong command');
  for (const text of every(root)) {
    const lines = text.split('\n').filter((l) => /\b001\b/.test(l) && /gate/.test(l));
    assert.equal(lines.length, 1, text);
    assert.match(lines[0], /approve was retracted/);
    assert.match(lines[0], /proof row was retracted/);
    assert.match(lines[0], /review 001 approve/);
    assert.match(lines[0], /evidence 001 --ran/);
  }
  const flags = flagsOf(root);
  for (const view of ['status', 'report', 'resume']) {
    assert.equal(flags[view].length, 1);
    assert.equal(flags[view][0].id, '001');
    assert.match(flags[view][0].reason, /approve was retracted/);
    assert.equal(typeof flags[view][0].repair, 'string');
  }
});

test('report names a retracted approve retracted and never counts it as unrecorded', () => {
  const root = loop(1);
  jarl(root, 'review', '1', 'approve', '--by', 'jarl', 'read the diff, nothing found');
  row(root, 1);
  jarl(root, 'set', '1', 'done');
  jarl(root, 'review', '1', 'retract', '--by', 'jarl', 'wrong');
  const report = json(root, 'report');
  assert.equal(report.reviews.retracted, 1);
  assert.equal(report.reviews.unrecorded, 0);
  assert.match(jarl(root, 'report'), /retracted 1/);
  assert.doesNotMatch(jarl(root, 'report'), /unrecorded/);
  assert.match(jarl(root, 'status'), /retracted 1/);
});

test('a merge recorded on a dropped issue is flagged, and report does not count it among the merges that carry a passing check row', () => {
  const root = loop(3);
  jarl(root, 'review', '1', 'approve', '--by', 'jarl', 'read the diff, nothing found'); row(root, 1); jarl(root, 'set', '1', 'done');
  jarl(root, 'merged', '1', '--sha', 'abc1234', '--ran', 'npm test', '--saw', 'pass');
  jarl(root, 'set', '3', 'dropped', 'not needed');
  jarl(root, 'merged', '3', '--sha', 'def5678', '--ran', 'npm test', '--saw', 'pass');
  const flags = flagsOf(root);
  for (const view of ['status', 'report', 'resume']) assert.ok(flags[view].some((x) => x.id === '003'), view);
  const three = flags.report.find((x) => x.id === '003');
  assert.match(three.reason, /merge is recorded on a dropped issue/);
  assert.match(three.repair, /set 003 open/);
  for (const text of every(root)) assert.match(text, /003 · .*merge is recorded on a dropped issue/);
  const report = json(root, 'report');
  assert.equal(report.check.merges.merges, 1);
  assert.equal(report.check.merges.withCheck, 1);
  assert.match(report.text, /1 of 1 merge\(s\) carry a passing check row/);
});

test('a code issue done with no merge recorded is flagged', () => {
  const root = loop(2);
  jarl(root, 'set', '2', 'in-progress', '--worker', 'w2', '--branch', 'jarl/2-x');
  jarl(root, 'review', '2', 'approve', '--by', 'fresh-reviewer', 'read the diff, nothing found'); row(root, 2);
  jarl(root, 'set', '2', 'done');
  for (const view of ['status', 'report', 'resume']) {
    const f = flagsOf(root)[view].find((x) => x.id === '002');
    assert.ok(f, view);
    assert.match(f.reason, /code issue done with no merge/);
    assert.match(f.repair, /set 002 open/);
  }
  for (const text of every(root)) assert.match(text, /002 · .*code issue done with no merge/);
});

test('a merge recorded on an issue that went done with only a coordinator approve is flagged as carrying code with no fresh approve', () => {
  const root = loop(1);
  jarl(root, 'review', '1', 'approve', '--by', 'jarl', 'read the diff, nothing found'); row(root, 1);
  jarl(root, 'set', '1', 'done');
  assert.deepEqual(flagsOf(root).status, []);
  jarl(root, 'merged', '1', '--sha', 'abc1234');
  for (const view of ['status', 'report', 'resume']) {
    const f = flagsOf(root)[view].find((x) => x.id === '001');
    assert.ok(f, view);
    assert.match(f.reason, /carries code and holds no fresh approve/);
    assert.match(f.reason, /merge was recorded after it went done/);
    assert.match(f.repair, /review 001 approve --by <fresh reviewer>/);
  }
});

test('a loop whose closed issues all hold their gate prints no such line and carries an empty array', () => {
  const root = loop(1);
  jarl(root, 'review', '1', 'approve', '--by', 'jarl', 'read the diff, nothing found'); row(root, 1);
  jarl(root, 'set', '1', 'done');
  assert.deepEqual(flagsOf(root), { status: [], report: [], resume: [] });
  for (const text of every(root)) assert.doesNotMatch(text, /does not hold/);
});

test('flagging refuses nothing and writes nothing', () => {
  const root = loop(1);
  jarl(root, 'review', '1', 'approve', '--by', 'jarl', 'read the diff, nothing found'); row(root, 1);
  jarl(root, 'set', '1', 'done');
  jarl(root, 'review', '1', 'retract', '--by', 'jarl', 'wrong');
  const before = files(root);
  every(root);
  assert.deepEqual(files(root), before);
});
