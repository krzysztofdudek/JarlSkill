// The writer of a write: every command whose --by is not part of what it records takes one per call and writes it into
// each log line of the call, right after the stamp, under record format 3. A call that names nobody writes no writer and
// raises nothing; a view shows an unnamed lease as unnamed where coordinators may lease; no server keeps a name of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jarl, refuses, run, loop as makeLoop } from './helpers.mjs';
import { fileAsFormatTwo, formatTwoJarl } from './old-jarl.mjs';
import * as mcp from '../jarl-mcp.mjs';
import * as L from '../jarl-lib.mjs';
import { WRITER_COMMANDS, COMMAND_FLAGS } from '../jarl.mjs';

const loop = () => makeLoop({ prefix: 'jarl-writer-', via: 'cli', dotGit: false });
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const logOf = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const formatOf = (root) => json(root, 'profile').format;
const STAMP = '\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}';

test('every command whose --by is not what it records takes one, and the table holds no other', () => {
  assert.deepEqual([...WRITER_COMMANDS].sort(), ['archive', 'ask', 'base', 'close', 'evidence', 'goal', 'import', 'init', 'log', 'merged', 'mode', 'new', 'renumber', 'round', 'set']);
  for (const c of WRITER_COMMANDS) assert.equal(COMMAND_FLAGS[c].by, 'value', c);
  // The commands whose --by is part of what they record: the author of a description change, the reviewer, who answered, ruled or retracted.
  for (const c of ['field', 'retract', 'review', 'answer', 'decide']) assert.ok(!WRITER_COMMANDS.includes(c), c);
});

test('a named write puts its writer after the stamp of every line it writes, and the first one raises the loop to format 3', () => {
  const root = loop();
  // Filed with no key (fileAsFormatTwo), which would raise the loop to 3 by itself.
  fileAsFormatTwo(root, 'one', { files: 'a.mjs' });
  jarl(root, 'log', 'nobody named');
  const before = formatOf(root);
  assert.ok(before < 3);
  assert.match(logOf(root), new RegExp(`^- ${STAMP} · nobody named$`, 'm'), 'an unnamed write names no writer');
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1', '--branch', 'jarl/1', '--by', 'odin');
  assert.equal(formatOf(root), 3);
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'green', '--by', 'w1');
  jarl(root, 'round', '1', 'the empty case fails', '--by', 'odin');
  jarl(root, 'merged', '1', '--sha', 'abc1234', '--ci', 'green', '--by', 'the merger');
  jarl(root, 'ask', 'which way?', '--issue', '1', '--by', 'odin');
  jarl(root, 'goal', '--set', 'Coordinators: odin', '--by', 'the jarl');
  jarl(root, 'new', 'two', '--files', 'b.mjs', '--by', 'odin');
  jarl(root, 'log', 'a named note', '--by', 'odin');
  const log = logOf(root);
  for (const [who, line] of [['odin', '1 → in-progress · go · branch jarl/1 · worker w1'], ['w1', '1 evidence row · npm test'], ['odin', '1 round 1 · '], ['the merger', '1 merged abc1234'], ['odin', 'asked a-1 (stuck) · which way?'], ['the jarl', 'goal line added · Coordinators: odin'], ['odin', 'filed 2 · two'], ['odin', 'a named note']]) {
    assert.match(log, new RegExp(`^- ${STAMP}(?: key \\S+)? by ${who} · ${line.replace(/[.*+?()[\]|\\]/g, '\\$&')}`, 'm'), line);
  }
  // The reader places every line, writer and all, and the views read the moves as before.
  const events = L.loopEvents(join(root, '.jarl'), L.loadProfile(root));
  assert.deepEqual(events.filter((e) => e.writer !== null).map((e) => e.writer), ['odin', 'w1', 'odin', 'the merger', 'odin', 'the jarl', 'odin', 'odin']);
  assert.equal(events.find((e) => e.type === 'move' && e.id === '1').lease.worker, 'w1');
  assert.equal(json(root, 'show', '1').status, 'in-progress');
  assert.match(run(root, ['verify']).stdout, /^verify: clean/m);
  assert.match(jarl(root, 'resume'), new RegExp(`^- ${STAMP} by odin · a named note$`, 'm'), 'the log tail of resume shows the writer');
});

test('a note cannot pose as a writer, and a writer is one name', () => {
  const root = loop();
  jarl(root, 'log', 'by mallory · the text after it');
  const events = L.loopEvents(join(root, '.jarl'), L.loadProfile(root));
  assert.deepEqual(events.map((e) => e.writer), [null, null]);
  assert.match(refuses(root, 'log', 'x', '--by', 'a · b'), /--by is one name — not a phrase with "·" in it/);
  assert.match(refuses(root, 'log', 'x', '--by', ' '), /--by needs a name/);
});

test('a lease shows who wrote it, and an unnamed one shows as unnamed where the goal names coordinators', () => {
  const root = loop();
  jarl(root, 'new', 'one', '--files', 'a.mjs');
  jarl(root, 'new', 'two', '--files', 'b.mjs');
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1', '--branch', 'jarl/1');
  assert.equal(json(root, 'status').inFlightRows[0].leasedBy, undefined, 'no coordinators: an unnamed write is the jarl\'s, and nothing is said');
  assert.doesNotMatch(jarl(root, 'status'), /leased by/);
  jarl(root, 'goal', '--set', 'Coordinators: odin, thor');
  jarl(root, 'set', '2', 'in-progress', 'go', '--worker', 'w2', '--branch', 'jarl/2', '--by', 'thor');
  assert.deepEqual(json(root, 'status').inFlightRows.map((x) => [x.id, x.leasedBy]), [['1', null], ['2', 'thor']]);
  assert.match(jarl(root, 'status'), /^in flight 1 · leased by \(unnamed\) · /m);
  assert.match(jarl(root, 'status'), /^in flight 2 · leased by thor · /m);
  assert.match(jarl(root, 'resume'), /^- 1 one · branch jarl\/1 · worker w1 · model not recorded · since [^·]+ · leased by \(unnamed\)$/m);
  assert.deepEqual(json(root, 'resume').inFlight.map((x) => x.leasedBy), [null, 'thor']);
});

test('where a composer keeps the format, --by is refused with nothing written, and an unnamed write goes on', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-writer-composed-'));
  mkdirSync(join(dir, '.git'));
  const file = join(mkdtempSync(join(tmpdir(), 'jarl-writer-profile-')), 'profile.json');
  writeFileSync(file, JSON.stringify({ 'jarl-profile': 1, name: 'composed', statuses: L.BUILTIN_STATUSES, 'external-scheduler': 'the composer tick' }));
  assert.match(refuses(dir, 'init', 'a mission', '--profile', file, '--by', 'odin'), /the writer of a write \(--by\) needs record format 3, and this loop stays at format 1: its profile names an external scheduler \(the composer tick\)/);
  jarl(dir, 'init', 'a mission', '--profile', file);
  jarl(dir, 'new', 'one', '--files', 'a.mjs');
  const log = logOf(dir);
  const issue = readFileSync(json(dir, 'show', '001').file, 'utf8');
  assert.match(refuses(dir, 'evidence', '001', 'a note', '--by', 'w1'), /the writer of a write \(--by\) needs record format 3, and this loop stays at format 1: its profile names an external scheduler \(the composer tick\), the composer that reads this record, so Jarl never raises its format; leave --by out there — nothing was written/);
  assert.equal(logOf(dir), log);
  assert.equal(readFileSync(json(dir, 'show', '001').file, 'utf8'), issue);
  jarl(dir, 'evidence', '001', 'a note');
  assert.equal(formatOf(dir), 1);
});

test('the frozen reader of formats 1 and 2 reads a loop with no writer and refuses one that names a writer', () => {
  const root = loop();
  fileAsFormatTwo(root, 'one', { files: 'a.mjs' });
  assert.equal(formatTwoJarl(root, 'list', {}).ok, true);
  jarl(root, 'log', 'named', '--by', 'odin');
  const two = formatTwoJarl(root, 'list', {});
  assert.equal(two.ok, false);
  assert.match(two.error, /written for record format 3/);
});

test('verify finds a writer in a loop that is not in record format 3', () => {
  const root = loop();
  jarl(root, 'new', 'one', '--files', 'a.mjs');
  jarl(root, 'log', 'named', '--by', 'odin');
  writeFileSync(join(root, '.jarl', 'profile.json'), JSON.stringify({ 'jarl-profile': 1, format: 2 }));
  assert.match(run(root, ['verify']).stdout, /log\.md line \d+: "named" names its writer \(odin\), which is written in record format 3, and this loop is not in it/);
});

test('the MCP tools take the writer per call, and the server keeps no name of its own', () => {
  const tools = Object.fromEntries(mcp.buildTools().map((t) => [t.name, t]));
  for (const c of WRITER_COMMANDS) assert.ok(tools[mcp.toolName(c)].inputSchema.properties.by, c);
  const root = loop();
  const env = { JARL_BY: 'server', JARL_WRITER: 'server', JARL_AS: 'server', USER: 'server' };
  mcp.callTool('jarl_new', { title: 'one', files: 'a.mjs', root }, env);
  mcp.callTool('jarl_log', { event: 'unnamed', root }, env);
  mcp.callTool('jarl_log', { event: 'named', by: 'w1', root }, env);
  mcp.callTool('jarl_log', { event: 'unnamed again', root }, env);
  const events = L.loopEvents(join(root, '.jarl'), L.loadProfile(root));
  assert.deepEqual(events.map((e) => [e.text, e.writer]).slice(-3), [['unnamed', null], ['named', 'w1'], ['unnamed again', null]], 'a writer lasts one call');
});
