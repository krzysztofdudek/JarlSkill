// The log has one reader: parseEvent types a line, loopEvents reads the file. These tests hold the grammar of every
// line kind the done gate, the metrics, models, rounds, tips and the stamps of status and resume read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const L = await import('../jarl-lib.mjs');
const P = L.DEFAULT_PROFILE;

test('a filing, a round, an evidence row and the retractions are typed', () => {
  assert.deepEqual(L.parseEvent('012', 'filed 012 · a title', P), { type: 'filed' });
  assert.deepEqual(L.parseEvent('012', '012 round 2 · red', P), { type: 'round' });
  assert.deepEqual(L.parseEvent('012', '012 evidence row · node --test', P), { type: 'row' });
  assert.deepEqual(L.parseEvent('012', '012 evidence · a free note', P), { type: 'other' });
  assert.deepEqual(L.parseEvent('012', '012 evidence retract · row 3 · by rev · wrong', P), { type: 'retract-row', row: 3 });
  assert.deepEqual(L.parseEvent('012', '012 review retract · by rev (fresh) · retracts the approve by x · why', P), { type: 'retract-review' });
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
