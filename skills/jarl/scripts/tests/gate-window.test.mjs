// One window for the done gate: the evidence anchor and the approve cut reset on the same events. A filing, a start and a
// reopen reset both; a red round resets the approve alone. A pause and a resume on an unchanged branch tip spend neither.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { jarl, loop as makeLoop, refuses, gitRepo } from './helpers.mjs';
import { oldJarl, fileAsBefore } from './old-jarl.mjs';

const L = await import('../jarl-lib.mjs');
const R = await import('../record.mjs');

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

// A loop at the root of a git repository on main, its first issue leased on the branch jarl/1-x with one commit of its
// own, proved and approved by a fresh reviewer. `commit` adds a commit on the branch; `fresh` reads the gate as a new
// command does. With `library` the issue is filed by the library, as 001, so the loop stays in record format 1.
function leased({ library = false } = {}) {
  const { dir: root, g } = gitRepo({ prefix: 'jarl-pause-', branch: 'main' });
  jarl(root, 'init', 'goal');
  if (library) fileAsBefore(root, 'issue 1', { acceptance: 'it works' }); else jarl(root, 'new', 'issue 1', '--acceptance', 'it works');
  g('branch', 'jarl/1-x');
  const commit = (name) => { g('checkout', '-q', 'jarl/1-x'); writeFileSync(join(root, `${name}.txt`), `${name}\n`); g('add', `${name}.txt`); g('commit', '-qm', name); g('checkout', '-q', 'main'); };
  commit('work');
  jarl(root, 'set', '1', 'in-progress', '--branch', 'jarl/1-x', '--worker', 'w1');
  row(root, 1);
  jarl(root, 'review', '1', 'approve', '--by', 'rev1', 'read the diff, nothing found');
  const fresh = () => { L.resetCaches(); const s = L.gateState(root, '1'); return [s.rowsSince, s.approved]; };
  assert.deepEqual(fresh(), [1, true]);
  return { root, g, commit, fresh };
}
const resume = (root) => jarl(root, 'set', '1', 'in-progress', '--branch', 'jarl/1-x', '--worker', 'w1');

test('a pause and a resume on the same branch tip keep the rows and the approve, through open and through deferred', () => {
  for (const pause of [['open', 'reordered'], ['deferred', 'waits for the owner']]) {
    const { root, fresh } = leased();
    jarl(root, 'set', '1', ...pause);
    resume(root);
    assert.deepEqual(fresh(), [1, true], `in progress → ${pause[0]} → in progress`);
    assert.match(jarl(root, 'show', '1'), /npm test/, 'the kept row is shown in the window');
  }
  const { root, fresh } = leased();
  jarl(root, 'set', '1', 'open', 'reordered'); resume(root);
  jarl(root, 'set', '1', 'deferred', 'later'); jarl(root, 'set', '1', 'open', 'back'); resume(root);
  assert.deepEqual(fresh(), [1, true], 'several pauses in a row');
});

test('a new commit on the branch after a pause spends the rows and the approve; new ones count again', () => {
  const { root, commit, fresh } = leased();
  jarl(root, 'set', '1', 'open', 'reordered');
  resume(root);
  commit('more');
  assert.deepEqual(fresh(), [0, false]);
  assert.match(refuses(root, 'set', '1', 'done'), /no --ran\/--saw evidence row recorded since it was moved → in-progress/);
  row(root, 1, 'pass on the new tip');
  jarl(root, 'review', '1', 'approve', '--by', 'rev2', 'read the new commit, nothing found');
  assert.deepEqual(fresh(), [1, true]);
});

test('a round and a reopen from done still spend what they spend, pause or no pause', () => {
  const a = leased();
  jarl(a.root, 'set', '1', 'open', 'reordered'); resume(a.root);
  jarl(a.root, 'round', '1', 'the test was red');
  assert.deepEqual(a.fresh(), [1, false], 'a round spends the approve, the row stays');
  const b = leased();
  jarl(b.root, 'set', '1', 'open', 'reordered'); resume(b.root);
  b.g('merge', '-q', '--no-ff', 'jarl/1-x', '-m', 'merge');
  jarl(b.root, 'merged', '1', '--sha', b.g('rev-parse', 'HEAD').trim(), '--keep');
  jarl(b.root, 'set', '1', 'done');
  jarl(b.root, 'set', '1', 'open', 'found a gap');
  resume(b.root);
  assert.deepEqual(b.fresh(), [0, false], 'a reopen from done spends both, though the tip is the same');
});

test('the window no pause opens: the first start, a reopen from a closed status and the start after it still open it', () => {
  const profile = {
    is: (st, flag) => ({ 'closes-record': ['done'], 'holds-claim': ['in-progress'], dispatchable: ['open'] }[flag] || []).includes(st),
  };
  const firm = (...events) => L.gateWindow(profile, [{ type: 'filed', n: 0 }, ...events], { throughPauses: true });
  assert.equal(firm(move(3, 'open', 'in-progress')).anchor.n, 3, 'the first start');
  const paused = [move(3, 'open', 'in-progress'), move(5, 'in-progress', 'open'), move(7, 'open', 'in-progress'), move(8, 'in-progress', 'deferred'), move(9, 'deferred', 'in-progress')];
  assert.deepEqual([firm(...paused).anchor.n, firm(...paused).cut], [3, 3], 'pauses and resumes');
  assert.deepEqual([firm(...paused, { type: 'round', n: 10 }).anchor.n, firm(...paused, { type: 'round', n: 10 }).cut], [3, 10], 'a round');
  const reopened = [...paused, move(11, 'in-progress', 'done'), move(12, 'done', 'open')];
  assert.equal(firm(...reopened).anchor.n, 12, 'a reopen from done');
  assert.equal(firm(...reopened, move(14, 'open', 'in-progress')).anchor.n, 14, 'the start after a reopen from done');
  assert.equal(L.gateWindow(profile, [{ type: 'filed', n: 0 }, ...paused]).anchor.n, 9, 'without throughPauses every resume opens it');
});

test('a merge whose cleanup deleted the branch: done reads the tip the merge was recorded on', () => {
  const { root, g } = leased();
  jarl(root, 'set', '1', 'open', 'reordered'); resume(root);
  g('merge', '-q', '--no-ff', 'jarl/1-x', '-m', 'merge');
  jarl(root, 'merged', '1', '--sha', g('rev-parse', 'HEAD').trim());
  assert.equal(g('branch', '--list', 'jarl/1-x').trim(), '', 'the cleanup deleted the branch');
  assert.equal(jarl(root, 'set', '1', 'done'), '1 → done');
});

test('rows and verdicts that carry no tip are spent by a pause and a resume', () => {
  const { root, fresh } = leased();
  const log = join(root, '.jarl', 'log.md');
  writeFileSync(log, readFileSync(log, 'utf8').split('\n').filter((l) => !/ · 1 tip /.test(l)).join('\n'));
  assert.deepEqual(fresh(), [1, true], 'without a pause nothing changes');
  jarl(root, 'set', '1', 'open', 'reordered');
  resume(root);
  assert.deepEqual(fresh(), [0, false]);
});

test('a tip line is written by evidence, review and merged, right after their own line, and never by log', () => {
  const { root, g } = leased();
  const tip = g('rev-parse', 'jarl/1-x').trim();
  const lines = readFileSync(join(root, '.jarl', 'log.md'), 'utf8').split('\n').map((l) => l.replace(/^- \S+ \S+(?: key \S+)? · /, ''));
  const after = (re) => lines[lines.findIndex((l) => re.test(l)) + 1];
  assert.equal(after(/^1 evidence row · /), `1 tip ${tip}`);
  assert.equal(after(/^1 review approve · /), `1 tip ${tip}`);
  assert.match(refuses(root, 'log', `1 tip ${tip}`), /reads as a tip line/);
});

test('the pinned frozen reader reads a loop with tip lines at format 1, and its gate refuses a resumed issue this Jarl lets through', () => {
  const { root, g } = leased({ library: true });
  assert.equal(existsSync(join(root, '.jarl', 'profile.json')), false, 'no format raised');
  assert.equal(oldJarl(root, 'list', {}).ok, true);
  assert.equal(oldJarl(root, 'status', {}).ok, true);
  jarl(root, 'set', '1', 'open', 'reordered'); resume(root);
  const r = oldJarl(root, 'set', {}, ['1', 'done', null, {}]);
  assert.equal(r.ok, false);
  assert.match(r.error, /no --ran\/--saw evidence row recorded since it was moved → in-progress/);
  jarl(root, 'merged', '1', '--sha', g('rev-parse', 'jarl/1-x').trim(), '--ci', 'none', '--keep');
  assert.equal(jarl(root, 'set', '1', 'done'), '001 → done', 'this Jarl keeps the row and the approve of the unchanged tip');
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
