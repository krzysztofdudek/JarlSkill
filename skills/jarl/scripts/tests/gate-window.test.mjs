// One window for the done gate: the evidence anchor and the approve cut reset on the same events. A filing, a start and a
// reopen reset both; a red round resets the approve alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { jarl, loop as makeLoop, refuses } from './helpers.mjs';

const L = await import('../jarl-lib.mjs');

const loop = (n) => {
  const root = makeLoop({ prefix: 'jarl-window-', via: 'cli' });
  for (let k = 1; k <= n; k += 1) jarl(root, 'new', `issue ${k}`, '--acceptance', 'it works');
  return root;
};
const row = (root, id, saw = 'pass') => jarl(root, 'evidence', String(id), '--ran', 'npm test', '--saw', saw);
const approve = (root, id) => jarl(root, 'review', String(id), 'approve', '--by', 'jarl', 'read the diff, nothing found');
const gate = (root, id) => L.gateState(root, String(id));

test('an issue closed, deferred and closed again is refused for the missing row after the reopen, and passes with one', () => {
  const root = loop(2);
  row(root, 2); approve(root, 2); jarl(root, 'set', '2', 'done');
  jarl(root, 'set', '2', 'deferred', 'waits for the owner');
  approve(root, 2);
  const said = refuses(root, 'set', '2', 'done');
  assert.match(said, /no --ran\/--saw evidence row recorded since it was moved → deferred/);
  row(root, 2, 'pass again');
  jarl(root, 'set', '2', 'done');
  assert.match(jarl(root, 'show', '2'), /Status:\*\* done/);
});

test('a start resets the rows and the approve; a round spends the approve and leaves the rows counting', () => {
  const root = loop(1);
  row(root, 1); approve(root, 1);
  assert.deepEqual([gate(root, 1).rowsSince, gate(root, 1).approved], [1, true]);
  jarl(root, 'round', '1', 'the test was red');
  assert.deepEqual([gate(root, 1).rowsSince, gate(root, 1).approved], [1, false], 'a round: the row stays, the approve is spent');
  approve(root, 1);
  jarl(root, 'set', '1', 'in-progress', '--worker', 'w1');
  assert.deepEqual([gate(root, 1).rowsSince, gate(root, 1).approved], [0, false], 'a start: both reset');
});

test('a reopen from done resets the rows and the approve, to open and to any other status', () => {
  for (const to of ['open', 'deferred', 'in-progress']) {
    const root = loop(1);
    row(root, 1); approve(root, 1); jarl(root, 'set', '1', 'done');
    assert.deepEqual([gate(root, 1).rowsSince, gate(root, 1).approved], [1, true]);
    jarl(root, 'set', '1', to, ...(to === 'deferred' ? ['waits'] : to === 'in-progress' ? ['--worker', 'w1'] : []));
    assert.deepEqual([gate(root, 1).rowsSince, gate(root, 1).approved], [0, false], `done → ${to}`);
  }
});

test('the filing of an issue never in progress opens the window', () => {
  const root = loop(1);
  assert.deepEqual([gate(root, 1).rowsSince, gate(root, 1).approved, gate(root, 1).anchor.what], [0, false, 'filed']);
  row(root, 1); approve(root, 1);
  assert.deepEqual([gate(root, 1).rowsSince, gate(root, 1).approved], [1, true]);
});

// The window as one function of the profile and the issue's events: the same value for the rows and for the approves.
const move = (n, from, to) => ({ type: 'move', n, from, to });
test('gateWindow gives the anchor and the cut for every event, from each closing status', () => {
  const profile = {
    is: (st, flag) => ({ 'closes-record': ['done', 'shipped'], 'holds-claim': ['in-progress'], dispatchable: ['open'] }[flag] || []).includes(st),
  };
  const w = (...events) => L.gateWindow(profile, events);
  assert.deepEqual(w({ type: 'filed', n: 0 }), { anchor: { type: 'filed', n: 0 }, cut: 0 });
  const filed = { type: 'filed', n: 0 };
  assert.equal(w(filed, move(3, 'open', 'in-progress')).anchor.n, 3, 'a start');
  assert.equal(w(filed, move(3, 'open', 'in-progress')).cut, 3);
  const round = w(filed, move(3, 'open', 'in-progress'), { type: 'round', n: 5 });
  assert.deepEqual([round.anchor.n, round.cut], [3, 5], 'a round resets the cut alone');
  for (const closing of ['done', 'shipped']) {
    for (const to of ['open', 'deferred', 'in-progress', 'dropped']) {
      const win = w(filed, move(4, 'in-progress', closing), move(9, closing, to));
      assert.deepEqual([win.anchor.n, win.cut], [9, 9], `${closing} → ${to} resets both`);
    }
    const stay = w(filed, move(4, 'in-progress', closing), move(9, closing, 'shipped'));
    assert.deepEqual([stay.anchor.n, stay.cut], [0, 0],`${closing} → another closing status keeps the window`);
  }
});

// A copy of a real loop (the directory that holds its .jarl), named by JARL_LIVE_LOOP: the gate is replayed over it, and
// every close that rests on a row from before a reopen is listed.
const LIVE = process.env.JARL_LIVE_LOOP || '';
test('a copy of a real loop: every close resting on a row from before a reopen is listed, and no other issue changes', { skip: !(LIVE && existsSync(join(LIVE, '.jarl'))) && 'JARL_LIVE_LOOP is unset, or names no loop' }, () => {
  const loopValue = L.readLoop(join(LIVE, '.jarl'));
  const listed = [];
  for (const issue of loopValue.issues) {
    const events = loopValue.eventsById.get(issue.id) || [];
    const g = L.gateOf(loopValue, issue.id);
    // The window the gate kept when a move out of a closing status reset the approve alone.
    let before = null;
    for (const e of events) {
      if (e.type === 'filed') before = e;
      if (e.type === 'move') {
        const { profile } = loopValue;
        if ((profile.is(e.to, 'holds-claim') && !profile.is(e.from, 'holds-claim')) || (profile.is(e.to, 'dispatchable') && (profile.is(e.from, 'closes-record') || profile.is(e.from, 'holds-claim')))) before = e;
      }
    }
    const rowsBefore = g.rowLog.filter((r) => before && r.n > before.n && !r.retracted).length;
    if (rowsBefore !== g.rowsSince) listed.push(`${issue.id}: ${rowsBefore} row(s) counted before, ${g.rowsSince} now`);
  }
  console.log(`rows differing: ${listed.length}${listed.length ? `\n${listed.join('\n')}` : ''}`);
  for (const line of listed) assert.match(line, /\d+ row\(s\) counted before, 0 now/, 'a differing issue is one whose rows all come from before a reopen');
});
