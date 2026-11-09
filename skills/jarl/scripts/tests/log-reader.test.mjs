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
  assert.deepEqual(L.parseEvent('012', '012 round 2 · red', P), { type: 'round', number: 2 });
  assert.deepEqual(L.parseEvent('012', '012 round 3 (takeover 3 of 3) · red', P), { type: 'round', number: 3, standing: { takeover: true, count: 3, limit: 3 } });
  assert.deepEqual(L.parseEvent('012', '012 round 4 · takeover 1 of 1 · red', P), { type: 'round', number: 4 });
  assert.deepEqual(L.parseEvent('012', '012 evidence row · node --test', P), { type: 'row' });
  assert.deepEqual(L.parseEvent('012', '012 evidence · a free note', P), { type: 'other' });
  assert.deepEqual(L.parseEvent('012', '012 evidence retract · row 3 · by rev · wrong', P), { type: 'retract-row', row: 3, by: 'rev' });
  assert.deepEqual(L.parseEvent('012', '012 evidence retract · note 2 · by odin · wrong', P), { type: 'retract-note', note: 2, by: 'odin' });
  assert.deepEqual(L.parseEvent('012', '012 review retract · by rev (fresh) · retracts the approve by x · why', P), { type: 'retract-review', target: { by: 'x', kind: null }, by: 'rev' });
  assert.deepEqual(L.parseEvent('012', '012 body · what', P), { type: 'body', part: 'what', by: null });
  assert.deepEqual(L.parseEvent('012', '012 body · why · was "x" (1 characters) · by odin', P), { type: 'body', part: 'why', by: 'odin' });
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

test('a verdict carries its reviewer, kind, model, relay mark, batch and artifact', () => {
  assert.deepEqual(L.parseEvent('012', '012 review approve · by rev-a (fresh) · model m@low · relayed · all green', P),
    { type: 'verdict', verdict: 'approve', by: 'rev-a', kind: 'fresh', model: 'm@low', relayed: true, batch: null, artifact: null });
  assert.deepEqual(L.parseEvent('012', '012 review changes · by rev-a (coordinator) · fix it please', P),
    { type: 'verdict', verdict: 'changes', by: 'rev-a', kind: 'coordinator', model: null, relayed: false, batch: null, artifact: null });
  assert.deepEqual(L.parseEvent('012', '012 review approve · looks fine to me', P),
    { type: 'verdict', verdict: 'approve', by: null, kind: null, model: null, relayed: false, batch: null, artifact: null });
  assert.deepEqual(L.parseEvent('012', '012 review approve · by rev-a (fresh) · model m@low · relayed · batch 20261106T1910-abcd · all green', P),
    { type: 'verdict', verdict: 'approve', by: 'rev-a', kind: 'fresh', model: 'm@low', relayed: true, batch: '20261106T1910-abcd', artifact: null });
  assert.deepEqual(L.parseEvent('012', '012 review approve · by rev-a (fresh) · batch 20261106T1910-abcd · all green', P),
    { type: 'verdict', verdict: 'approve', by: 'rev-a', kind: 'fresh', model: null, relayed: false, batch: '20261106T1910-abcd', artifact: null });
  assert.deepEqual(L.parseEvent('012', '012 review approve · by rev-a (fresh) · model m@low · batch 20261106T1910-abcd · artifact renders/home page.png · all green', P),
    { type: 'verdict', verdict: 'approve', by: 'rev-a', kind: 'fresh', model: 'm@low', relayed: false, batch: '20261106T1910-abcd', artifact: 'renders/home page.png' });
  assert.deepEqual(L.parseEvent('012', '012 review changes · by rev-a (fresh) · findings: artifact renders/x.png · was read', P).artifact, null);
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
    '- 2026-10-01 09:00 by a-writer · opened · a goal',
    '- 2026-10-01 09:05 key 20260101T0000-aaaa by a-writer · filed 001 · first',
    '- 2026-10-01 09:06 key 20260101T0000-baaa by a-writer · filed 002 · second',
    'a stray line that is no event',
    '- 2026-10-01 09:10 key 20260101T0000-aaaa by a-writer · 001 → in-progress · start · worker w-1',
    '- 2026-10-01 09:20 key 20260101T0000-baaa by a-writer · 002 → in-progress · start',
    '- 2026-10-01 09:30 key 20260101T0000-aaaa by a-writer · 001 → done · merged',
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
  const { id } = R.newIssue(root, title, { tier: 'light', acceptance: '[read] it works' });
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
  appendToLog(root, `- 2030-01-01 00:00 key 20260101T0000-tstk by a-writer · ${id} evidence · ${note}`);
  const events = L.loopEvents(L.jarlDir(root), L.loadProfile(root));
  assert.equal(events[events.length - 1].text, `${id} evidence · ${note}`);
  assert.equal(L.cmdStatus(root).lastActivity, '2030-01-01 00:00');
  assert.equal(L.cmdResume(root, {}).log.at(-1), `2030-01-01 00:00 by a-writer · ${id} evidence · ${note}`);
});

test('a mention of another issue inside a note is not a round of that issue', () => {
  const root = loop();
  const a = worked(root, 'first', { worker: 'w-one', branch: 'jarl/a' });
  const b = worked(root, 'second', { worker: 'w-two', branch: 'jarl/b' });
  appendToLog(root, `- 2030-01-01 00:00 key 20260101T0000-tstk by a-writer · ${b} evidence · compare with ${a} · ${a} round 9 · not a round`);
  assert.equal(L.roundsOf(root, a), 0);
  L.cmdRound(root, a, 'red once');
  assert.equal(L.roundsOf(root, a), 1);
});

test('a hand-written line that is no verdict is not a changes verdict in the metrics', () => {
  const root = loop();
  const id = worked(root, 'closed work', { worker: 'w-one', branch: 'jarl/c' });
  R.addEvidence(root, id, undefined, { line: 1, ran: 'npm test', saw: 'pass' });
  R.review(root, id, 'approve', 'read the diff, nothing found', { by: 'rev-a' });
  R.recordMerged(root, id, { sha: 'abc1234' }); R.setStatus(root, id, 'done', 'merged', {});
  appendToLog(root, `- 2030-01-01 00:00 key 20260101T0000-tstk by a-writer · ${id} review changes needed more tests`);
  assert.equal(L.loopMetrics(root).rounds.changes, 0);
});

test('an archived loop is read by its directory', () => {
  const root = loop();
  const id = worked(root, 'archived work', { worker: 'w-one', branch: 'jarl/y' });
  R.addEvidence(root, id, undefined, { line: 1, ran: 'npm test', saw: 'pass' });
  R.review(root, id, 'approve', 'read the diff, nothing found', { by: 'rev-a' });
  R.recordMerged(root, id, { sha: 'abc1234' }); R.setStatus(root, id, 'done', 'merged', {});
  L.cmdArchive(root, 'done-loop');
  const dir = join(L.jarlDir(root), 'archive', readdirSync(join(L.jarlDir(root), 'archive'))[0]);
  const value = L.readLoop(dir);
  assert.equal(value.dir, dir);
  assert.equal(value.root, dir);
  assert.deepEqual(value.issues.map((i) => i.id), [id]);
  assert.equal(L.gateOf(value, id).fresh, true);
  assert.equal(L.cmdModels(root, { with: dir }).loops.length, 1);
});

// A line about one issue as this Jarl writes it, by hand, with its key.
const lineOf = (root, id, text, by = 'a-writer') => `- 2030-01-01 00:00 key ${R.findIssue(root, id).fields.key} by ${by} · ${id} ${text}\n`;
const logFile = (root) => join(root, '.jarl', 'log.md');

test('a line with no writer, and a line that names no key though it carries state, are not read: verify names each, and the record stays as it was', () => {
  const root = loop();
  const id = worked(root, 'first', { worker: 'w-one', branch: 'jarl/a' });
  appendFileSync(logFile(root), '- 2030-01-01 00:00 · a note in an older shape\n');
  appendFileSync(logFile(root), `- 2030-01-01 00:00 by a-writer · ${id} → done · closed by an older line\n`);
  assert.equal(R.findIssue(root, id).status, 'in-progress', 'a state line with no key changes nothing');
  const log = L.cmdVerify(root).checks.find((c) => c.name === 'log');
  assert.equal(log.findings.length, 2, JSON.stringify(log.findings));
  assert.match(log.findings[0].what, /not a line of the current shape/);
  assert.match(log.findings[1].what, /names no key/);
});

test('a note that opens with a number and names no key stays a note, with no finding', () => {
  const root = loop();
  worked(root, 'first', { worker: 'w-one', branch: 'jarl/a' });
  appendFileSync(logFile(root), '- 2030-01-01 00:00 by a-writer · 42 is a number a note may open with\n');
  assert.equal(L.cmdVerify(root).checks.find((c) => c.name === 'log').findings.length, 0);
});

test('a line with the writer unrecorded is read, and stands as no writer at all', () => {
  const root = loop();
  const id = worked(root, 'first', { worker: 'w-one', branch: 'jarl/a' });
  appendFileSync(logFile(root), lineOf(root, id, 'evidence · a note', 'unrecorded'));
  const events = L.loopEvents(L.jarlDir(root), P);
  assert.equal(events.at(-1).writer, null);
  assert.equal(L.cmdVerify(root).checks.find((c) => c.name === 'log').findings.length, 0);
});

test('a history row is read as a row that names no line: it counts for no line, and verify says nothing of it', () => {
  const root = loop();
  const id = worked(root, 'first', { worker: 'w-one', branch: 'jarl/a' });
  assert.equal(L.parseEvent('012', '012 evidence row (history) · npm test', P).history, true);
  appendFileSync(logFile(root), lineOf(root, id, 'evidence row (history) · npm test · saw pass', 'unrecorded'));
  assert.equal(L.cmdVerify(root).checks.find((c) => c.name === 'log').findings.length, 0);
  const row = L.loopEvents(L.jarlDir(root), P).at(-1);
  assert.equal(row.type, 'row');
  assert.equal(row.history, true);
  assert.equal(row.lines, undefined);
  assert.equal(L.evidenceTable('- **ran (history):** npm test · **saw:** pass').rows[0].lines.length, 0);
});

test('a row that names no line and is no history row is named by verify', () => {
  const root = loop();
  const id = worked(root, 'first', { worker: 'w-one', branch: 'jarl/a' });
  appendFileSync(logFile(root), lineOf(root, id, 'evidence row · npm test'));
  const log = L.cmdVerify(root).checks.find((c) => c.name === 'log');
  assert.match(log.findings[0].what, /names no acceptance line/);
});

test('an attachment row names no line and is no finding of verify', () => {
  assert.equal(L.parseEvent('012', `012 evidence row · attach before before.png sha256:${'a'.repeat(64)} size:1000`, P).type, 'row');
});

test('an issue closed before a converted line is not re-read against the gate; one closed after it is', () => {
  const root = loop();
  const old = R.newIssue(root, 'closed by an earlier gate', { tier: 'light', acceptance: '[read] it works' }).id;
  appendFileSync(logFile(root), lineOf(root, old, '→ done · merged', 'unrecorded'));
  appendFileSync(logFile(root), '- 2030-01-01 00:01 by the-converter · converted\n');
  assert.deepEqual(L.closedGateFlags(L.readLoop(L.jarlDir(root))), [], 'the issue closed before the line is left as it stands');
  assert.equal(L.loopEvents(L.jarlDir(root), P).at(-1).type, 'converted');
  const late = R.newIssue(root, 'closed after the conversion', { tier: 'light', acceptance: '[read] it works' }).id;
  appendFileSync(logFile(root), lineOf(root, late, '→ done · merged'));
  assert.deepEqual(L.closedGateFlags(L.readLoop(L.jarlDir(root))).map((f) => f.id), [late]);
});

test('the log command writes no converted line: only a conversion ends with one', () => {
  const root = loop();
  assert.throws(() => R.appendLog(root, 'converted'), /only a conversion writes it/);
});

test('an issue closed before a converted line is counted by the approve it closed on, even after a changes verdict no round spent', () => {
  const root = loop();
  const id = R.newIssue(root, 'closed by an earlier gate', { tier: 'light', acceptance: '[read] it works' }).id;
  R.review(root, id, 'changes', 'Important: the first reading', { by: 'rev-1' });
  R.review(root, id, 'approve', 'looks fine now', { by: 'rev-2' });
  appendFileSync(logFile(root), lineOf(root, id, '→ done · closed', 'unrecorded'));
  const read = () => L.reviewSplit(L.readLoop(L.jarlDir(root)));
  assert.equal(read().unrecorded, 1, 'a loop that was not converted reads the standing changes as it stands');
  appendFileSync(logFile(root), '- 2030-01-01 00:01 by the-converter · converted\n');
  assert.equal(read().fresh, 1);
  assert.equal(read().unrecorded, 0);
});
