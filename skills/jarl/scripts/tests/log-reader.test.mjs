// The log has one reader: parseEvent types a line, loopEvents reads the file. These tests hold the grammar of every
// line kind the done gate, the metrics, models, rounds, tips and the stamps of status and resume read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as R from '../record.mjs';
import { loop as makeLoop } from './helpers.mjs';

const L = await import('../jarl-lib.mjs');
const P = L.DEFAULT_PROFILE;

test('a filing, a round, an evidence row and the retractions are typed', () => {
  assert.deepEqual(L.parseEvent('012', 'filed 012 · a title', P), { type: 'filed' });
  assert.deepEqual(L.parseEvent('012', '012 round 2 · red', P), { type: 'round' });
  assert.deepEqual(L.parseEvent('012', '012 evidence row · node --test', P), { type: 'row' });
  assert.deepEqual(L.parseEvent('012', '012 evidence · a free note', P), { type: 'other' });
  assert.deepEqual(L.parseEvent('012', '012 evidence retract · row 3 · by rev · wrong', P), { type: 'retract-row', row: 3 });
  assert.deepEqual(L.parseEvent('012', '012 review retract · by rev (fresh) · retracts the approve by x · why', P), { type: 'retract-review', target: { by: 'x', kind: null } });
  assert.deepEqual(L.parseEvent('012', '012 body · what', P), { type: 'body' });
});

test('a line about another issue, or about the loop, is not an event of the issue', () => {
  assert.equal(L.parseEvent('012', '013 round 2 · red', P).type, 'other');
  assert.equal(L.parseEvent('012', 'opened · a goal', P).type, 'other');
  assert.equal(L.parseEvent('012', '0120 round 1 · red', P).type, 'other');
});

test('a move carries the status it left, the status it entered and its lease', () => {
  const lease = L.parseEvent('012', '012 → in-progress · start · branch jarl/012-x · model m@high · worker w-1 · worktree /p', P, 'open');
  assert.deepEqual(lease, { type: 'move', from: 'open', to: 'in-progress', lease: { worker: 'w-1', model: 'm@high', branch: 'jarl/012-x' }, model: 'm@high' });
  const bare = L.parseEvent('012', '012 → in-progress · start', P, 'open');
  assert.deepEqual(bare, { type: 'move', from: 'open', to: 'in-progress', lease: null, model: null });
  assert.deepEqual(L.parseEvent('012', '012 → done · merged', P, 'in-progress'), { type: 'move', from: 'in-progress', to: 'done', lease: null, model: null });
  assert.equal(L.parseEvent('012', '012 → nowhere · x', P, 'open').type, 'other', 'a status the profile does not name is no move');
});

test('a verdict carries its reviewer, kind, model and relay mark', () => {
  assert.deepEqual(L.parseEvent('012', '012 review approve · by rev-a (fresh) · model m@low · relayed · all green', P),
    { type: 'verdict', verdict: 'approve', by: 'rev-a', kind: 'fresh', model: 'm@low', relayed: true });
  assert.deepEqual(L.parseEvent('012', '012 review changes · by rev-a (coordinator) · fix it please', P),
    { type: 'verdict', verdict: 'changes', by: 'rev-a', kind: 'coordinator', model: null, relayed: false });
  assert.deepEqual(L.parseEvent('012', '012 review approve · looks fine to me', P),
    { type: 'verdict', verdict: 'approve', by: null, kind: null, model: null, relayed: false });
});

test('a merge and a CI state are typed', () => {
  assert.deepEqual(L.parseEvent('012', '012 merged abc123 in tool · check node --test · CI pending', P),
    { type: 'merged', sha: 'abc123', repo: 'tool', check: 'node --test', red: null, ci: 'pending' });
  assert.deepEqual(L.parseEvent('012', '012 CI green', P), { type: 'ci', state: 'green' });
  assert.equal(L.parseEvent('012', '012 CI purple', P).type, 'other');
});

test('loopEvents reads the file in order, with the line index, the stamp and the status each move left', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-log-reader-'));
  writeFileSync(join(dir, 'log.md'), [
    '# Log', '',
    '- 2026-10-01 09:00 · opened · a goal',
    '- 2026-10-01 09:05 · filed 001 · first',
    '- 2026-10-01 09:06 · filed 002 · second',
    'a stray line that is no event',
    '- 2026-10-01 09:10 · 001 → in-progress · start · worker w-1',
    '- 2026-10-01 09:20 · 002 → in-progress · start',
    '- 2026-10-01 09:30 · 001 → done · merged',
    '',
  ].join('\n'));
  const events = L.loopEvents(dir, P);
  assert.deepEqual(events.map((e) => [e.n, e.at, e.id, e.type]), [
    [2, '2026-10-01 09:00', null, 'other'], [3, '2026-10-01 09:05', '001', 'filed'], [4, '2026-10-01 09:06', '002', 'filed'],
    [6, '2026-10-01 09:10', '001', 'move'], [7, '2026-10-01 09:20', '002', 'move'], [8, '2026-10-01 09:30', '001', 'move'],
  ]);
  assert.deepEqual(events.filter((e) => e.type === 'move').map((e) => [e.id, e.from, e.to]), [['001', 'open', 'in-progress'], ['002', 'open', 'in-progress'], ['001', 'in-progress', 'done']]);
  const byIssue = L.eventsById(events);
  assert.deepEqual([...byIssue.keys()], ['001', '002']);
  assert.equal(byIssue.get('001').length, 3);
});

test('a directory without a log has no events', () => {
  assert.deepEqual(L.loopEvents(mkdtempSync(join(tmpdir(), 'jarl-log-reader-')), P), []);
});

const loop = () => makeLoop({ prefix: 'jarl-loaded-loop-', goal: 'a goal for the loaded loop' });
function worked(root, title, { worker, branch }) {
  const { id } = R.newIssue(root, title, { tier: 'light', acceptance: 'it works' });
  R.setStatus(root, id, 'in-progress', '', { branch, worker });
  return id;
}

test('readLoop reads a loop once into one value: profile, issues, events, goal, questions, rulings, coordinators', () => {
  const root = loop();
  const id = worked(root, 'first thing', { worker: 'w-one', branch: 'jarl/x' });
  R.ask(root, 'which way?', { kind: 'stuck' });
  const value = L.readLoop(L.jarlDir(root));
  assert.equal(value.dir, L.jarlDir(root));
  assert.equal(value.root, root);
  assert.equal(value.profile.name, 'built-in');
  assert.deepEqual(value.issues.map((i) => i.id), [id]);
  assert.equal(value.byId.get(id).title, 'first thing');
  assert.deepEqual(value.eventsById.get(id).map((e) => e.type), ['filed', 'move']);
  assert.match(value.goal, /a goal for the loaded loop/);
  assert.equal(value.asks.length, 1);
  assert.deepEqual(value.decisions, []);
  assert.ok(value.coordinators.includes('jarl'));
});

test('the gate of a loop value is the gate of the loop on disk, and a package shares its branch workers', () => {
  const root = loop();
  const a = worked(root, 'first', { worker: 'w-one', branch: 'jarl/shared' });
  const b = worked(root, 'second', { worker: 'w-two', branch: 'jarl/shared' });
  const value = L.readLoop(L.jarlDir(root));
  assert.deepEqual([...L.gateOf(value, a).workers].sort(), ['w-one', 'w-two']);
  assert.deepEqual([...L.gateOf(value, b).workers].sort(), ['w-one', 'w-two']);
  assert.deepEqual([...L.gateState(root, a).workers].sort(), [...L.gateOf(value, a).workers].sort());
});

test('the same call gives the same answer however many loops were read before it', () => {
  const a = loop();
  const b = loop();
  worked(a, 'only here', { worker: 'w-a', branch: 'jarl/a' });
  const before = JSON.stringify(L.cmdModels(a, {}));
  L.cmdModels(b, {});
  L.readLoop(L.jarlDir(b));
  assert.equal(JSON.stringify(L.cmdModels(a, {})), before);
  assert.equal(L.jarlDir(a), join(a, '.jarl'));
});

const appendToLog = (root, line) => appendFileSync(join(L.jarlDir(root), 'log.md'), `${line}\n`);

test('a log line holds any character but a newline: a pasted note with U+2028 is an event, and the last stamp', () => {
  const root = loop();
  const id = worked(root, 'with a pasted note', { worker: 'w-one', branch: 'jarl/z' });
  const note = `pasted${String.fromCharCode(0x2028)}note`;
  appendToLog(root, `- 2030-01-01 00:00 · ${id} evidence · ${note}`);
  const events = L.loopEvents(L.jarlDir(root), L.loadProfile(root));
  assert.equal(events[events.length - 1].text, `${id} evidence · ${note}`);
  assert.equal(L.cmdStatus(root).lastActivity, '2030-01-01 00:00');
  assert.equal(L.cmdResume(root, {}).log.at(-1), `2030-01-01 00:00 · ${id} evidence · ${note}`);
});

test('a mention of another issue inside a note is not a round of that issue', () => {
  const root = loop();
  const a = worked(root, 'first', { worker: 'w-one', branch: 'jarl/a' });
  const b = worked(root, 'second', { worker: 'w-two', branch: 'jarl/b' });
  appendToLog(root, `- 2030-01-01 00:00 · ${b} evidence · compare with ${a} · ${a} round 9 · not a round`);
  assert.equal(L.roundsOf(root, a), 0);
  L.cmdRound(root, a, 'red once');
  assert.equal(L.roundsOf(root, a), 1);
});

test('a hand-written line that is no verdict is not a changes verdict in the metrics', () => {
  const root = loop();
  const id = worked(root, 'closed work', { worker: 'w-one', branch: 'jarl/c' });
  R.addEvidence(root, id, undefined, { ran: 'npm test', saw: 'pass' });
  R.review(root, id, 'approve', 'read the diff, nothing found', { by: 'rev-a' });
  R.setStatus(root, id, 'done', 'merged', {});
  appendToLog(root, `- 2030-01-01 00:00 · ${id} review changes needed more tests`);
  assert.equal(L.loopMetrics(root).rounds.changes, 0);
});

test('an archived loop is read by its directory', () => {
  const root = loop();
  const id = worked(root, 'archived work', { worker: 'w-one', branch: 'jarl/y' });
  R.addEvidence(root, id, undefined, { ran: 'npm test', saw: 'pass' });
  R.review(root, id, 'approve', 'read the diff, nothing found', { by: 'rev-a' });
  R.setStatus(root, id, 'done', 'merged', {});
  L.cmdArchive(root, 'done-loop');
  const dir = join(L.jarlDir(root), 'archive', readdirSync(join(L.jarlDir(root), 'archive'))[0]);
  const value = L.readLoop(dir);
  assert.equal(value.dir, dir);
  assert.equal(value.root, dir);
  assert.deepEqual(value.issues.map((i) => i.id), [id]);
  assert.equal(L.gateOf(value, id).fresh, true);
  assert.equal(L.cmdModels(root, { with: dir }).loops.length, 1);
});
