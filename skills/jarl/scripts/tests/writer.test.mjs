// The writer of a write: every command whose --by is not part of what it records takes one per call and writes it into
// each log line of the call, right after the stamp, under record format 3. A call that names nobody writes no writer and
// raises nothing; a view shows an unnamed lease as unnamed where coordinators may lease; no server keeps a name of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jarl, refuses, run, loop as makeLoop } from './helpers.mjs';
import { filePlain } from './helpers.mjs';
import * as mcp from '../jarl-mcp.mjs';
import * as L from '../jarl-lib.mjs';
import * as R from '../record.mjs';
import { COMMAND_FLAGS, MUTATING } from '../jarl.mjs';

const loop = () => makeLoop({ prefix: 'jarl-writer-', via: 'cli', dotGit: false });
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const logOf = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const formatOf = (root) => json(root, 'profile').format;
const STAMP = '\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}';

test('every command whose --by is not what it records takes one, and the table holds no other', () => {
  for (const c of MUTATING) assert.equal(COMMAND_FLAGS[c].by, 'value', c);
  // The commands whose --by is part of what they record: the author of a description change, the reviewer, who answered, ruled or retracted.
});

test('a named write puts its writer after the stamp of every line it writes', () => {
  const root = loop();
  // Filed with no key (filePlain), which would raise the loop to 3 by itself.
  filePlain(root, 'one', { files: 'a.mjs' });
  jarl(root, 'log', 'nobody named');
  assert.match(logOf(root), new RegExp(`^- ${STAMP} by test-writer · nobody named$`, 'm'), 'the writer of the call is in its place');
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1', '--branch', 'jarl/1', '--by', 'odin');
  jarl(root, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'green', '--by', 'w1');
  jarl(root, 'round', '1', 'the empty case fails', '--by', 'odin');
  jarl(root, 'merged', '1', '--sha', 'abc1234', '--ci', 'green', '--by', 'the merger');
  jarl(root, 'ask', 'which way?', '--issue', '1', '--by', 'odin');
  jarl(root, 'goal', '--set', 'Coordinators: odin', '--by', 'the jarl');
  jarl(root, 'new', 'two', '--acceptance', '[read] it works', '--files', 'b.mjs', '--by', 'odin');
  jarl(root, 'log', 'a named note', '--by', 'odin');
  const log = logOf(root);
  for (const [who, line] of [['odin', '1 → in-progress · go · branch jarl/1 · worker w1'], ['w1', '1 evidence row'], ['odin', '1 round 1 (count 1 of 3) · '], ['the merger', '1 merged abc1234'], ['odin', 'asked a-1 (stuck) · which way?'], ['the jarl', 'goal line added · Coordinators: odin'], ['odin', 'filed 2 · two'], ['odin', 'a named note']]) {
    assert.match(log, new RegExp(`^- ${STAMP}(?: key \\S+)? by ${who} · ${line.replace(/[.*+?()[\]|\\]/g, '\\$&')}`, 'm'), line);
  }
  // The reader places every line, writer and all, and the views read the moves as before.
  const events = L.loopEvents(join(root, '.jarl'), L.loadProfile(root));
  assert.deepEqual(events.filter((e) => e.writer !== null && e.writer !== 'test-writer').map((e) => e.writer), ['odin', 'w1', 'odin', 'the merger', 'odin', 'the jarl', 'odin', 'odin']);
  assert.equal(events.find((e) => e.type === 'move' && e.id === '1').lease.worker, 'w1');
  assert.equal(json(root, 'show', '1').status, 'in-progress');
  assert.match(run(root, ['verify']).stdout, /^verify: clean/m);
  assert.match(jarl(root, 'resume'), new RegExp(`^- ${STAMP} by odin · a named note$`, 'm'), 'the log tail of resume shows the writer');
});

test('a note cannot pose as a writer, and a writer is one name', () => {
  const root = loop();
  jarl(root, 'log', 'by mallory · the text after it');
  const events = L.loopEvents(join(root, '.jarl'), L.loadProfile(root));
  assert.deepEqual(events.map((e) => e.writer), ['test-writer', 'test-writer'], 'the words of the text never reach the writer\'s place');
  assert.match(refuses(root, 'log', 'x', '--by', 'a · b'), /--by is one name — not a phrase with "·" in it/);
  assert.match(refuses(root, 'log', 'x', '--by', ' '), /--by needs a name/);
});

test('a lease shows who wrote it, and an unnamed one shows as unnamed where the goal names coordinators', () => {
  const root = loop();
  jarl(root, 'new', 'one', '--acceptance', '[read] it works', '--files', 'a.mjs');
  jarl(root, 'new', 'two', '--acceptance', '[read] it works', '--files', 'b.mjs');
  R.setStatus(root, '1', 'in-progress', 'go', { worker: 'w1', branch: 'jarl/1' });
  assert.equal(json(root, 'status').inFlightRows[0].leasedBy, undefined, 'no coordinators: an unnamed write is the jarl\'s, and nothing is said');
  assert.doesNotMatch(jarl(root, 'status'), /leased by/);
  jarl(root, 'goal', '--set', 'Coordinators: odin, thor');
  jarl(root, 'set', '2', 'in-progress', 'go', '--worker', 'w2', '--branch', 'jarl/2', '--by', 'thor');
  assert.deepEqual(json(root, 'status').inFlightRows.map((x) => [x.id, x.leasedBy]), [['1', null], ['2', 'thor']]);
  assert.match(jarl(root, 'status'), /^in flight 1 · leased by \(unnamed\) · /m);
  assert.match(jarl(root, 'status'), /^in flight 2 · leased by thor · /m);
  assert.match(jarl(root, 'resume'), /^- 1 one · branch jarl\/1 · (?:model test-model · )?worker w1 · model not recorded · since [^·]+ · leased by \(unnamed\)$/m);
  assert.deepEqual(json(root, 'resume').inFlight.map((x) => x.leasedBy), [null, 'thor']);
});

test('the MCP tools take the writer per call, and the server keeps no name of its own', () => {
  const tools = Object.fromEntries(mcp.buildTools().map((t) => [t.name, t]));
  for (const c of MUTATING) assert.ok(tools[mcp.toolName(c)].inputSchema.properties.by, c);
  const root = loop();
  const env = { JARL_BY: 'server', JARL_WRITER: 'server', JARL_AS: 'server', USER: 'server' };
  mcp.callTool('jarl_new', { by: 'test-writer', title: 'one', files: 'a.mjs', root }, env);
  mcp.callTool('jarl_log', { by: 'w-a', text: 'first', root }, env);
  mcp.callTool('jarl_log', { by: 'w1', text: 'named', root }, env);
  mcp.callTool('jarl_log', { by: 'w-b', text: 'again', root }, env);
  const events = L.loopEvents(join(root, '.jarl'), L.loadProfile(root));
  assert.deepEqual(events.map((e) => [e.text, e.writer]).slice(-3), [['first', 'w-a'], ['named', 'w1'], ['again', 'w-b']], 'a writer lasts one call, whatever the server\'s environment names');
});
