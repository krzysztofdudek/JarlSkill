// Every write says who made it, and every lease and verdict what model it was made on: at the command line and through
// the tools a call that does not name them is refused, ending with the form, and the library takes the writer it is given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SCRIPT, TEST_MODEL, TEST_WRITER, jarl, loop as makeLoop, refuses, refusesBare, spawnJarl } from './helpers.mjs';
import { COMMAND_ARGS, MUTATING } from '../jarl.mjs';

const R = await import('../record.mjs');
const mcp = await import('../jarl-mcp.mjs');

const logOf = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const lastLine = (text) => text.trim().split('\n').pop();
const one = (root) => { jarl(root, 'new', 'one', '--files', 'a.mjs', '--acceptance', '[read] it works', '--why', 'because'); return root; };
const argsOf = (cmd) => (COMMAND_ARGS[cmd] || []).filter((a) => !/[?.]$/.test(a)).map((a) => ({ ids: '1', id: '1', status: 'open', verdict: 'approve', slug: 'a-slug', part: 'section', name: 'Extra', mode: 'permanent', line: '1', entry: 'review', branch: 'main', file: 'x', goal: 'g' }[a] ?? 'some text'));

test('every write at the command line without --by is refused, ending with the form, and writes nothing', () => {
  const root = one(makeLoop({ prefix: 'jarl-names-', via: 'cli' }));
  for (const cmd of MUTATING) {
    if (cmd === 'init' || cmd === 'goal') continue;
    const before = logOf(root);
    const said = refusesBare(root, cmd, ...argsOf(cmd));
    assert.match(lastLine(said), /--by "<(who|reviewer|the-owner-himself)>"/, `${cmd}: ${said}`);
    assert.equal(logOf(root), before, cmd);
  }
});

test('goal --set without --by is refused, ending with the form, and goal with no flag reads with none', () => {
  const root = makeLoop({ prefix: 'jarl-names-', via: 'cli' });
  assert.match(lastLine(refusesBare(root, 'goal', '--set', 'Check: npm test')), /--by "<who>"/);
  assert.equal(spawnJarl(root, ['goal'], { bare: true }).status, 0);
});

test('init without --by is refused, with no loop opened', () => {
  const root = makeLoop({ prefix: 'jarl-names-', via: 'cli' });
  const fresh = join(root, 'elsewhere');
  const r = spawnJarl(fresh, ['init', 'a goal'], { bare: true });
  assert.notEqual(r.status, 0);
  assert.match(lastLine(r.stderr), /--by "<who>"/);
  assert.equal(existsSync(fresh), false);
});

test('every writing tool of the server is required to name its writer', () => {
  const root = one(makeLoop({ prefix: 'jarl-names-', via: 'cli' }));
  const tools = Object.fromEntries(mcp.buildTools().map((t) => [t.name, t]));
  for (const cmd of MUTATING) {
    if (cmd === 'goal') continue;
    assert.ok(tools[mcp.toolName(cmd)].inputSchema.required.includes('by'), cmd);
  }
  const before = logOf(root);
  const r = mcp.callTool('jarl_log', { text: 'a note', root });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /"by" is required|--by/);
  assert.equal(logOf(root), before);
});

test('every line a write puts in the log names its writer, whatever the command', () => {
  const root = one(makeLoop({ prefix: 'jarl-names-', via: 'cli' }));
  jarl(root, 'set', '1', 'in-progress', 'start', '--worker', 'w1', '--model', 'm1', '--by', 'the-director');
  jarl(root, 'field', '1', 'Why', 'now it is known', '--by', 'the-director');
  jarl(root, 'review', '1', 'changes', 'Important: the thing is not done yet at all', '--by', 'rev-a', '--model', 'm2');
  const lines = logOf(root).split('\n').filter((l) => l.startsWith('- '));
  for (const l of lines) assert.match(l, / by [^·]+ · /, l);
  assert.ok(lines.some((l) => / by rev-a · 1 review changes · /.test(l)));
  assert.ok(lines.some((l) => / by the-director · 1 field Why · | by the-director · 1 body · why · /.test(l)));
});

test('a lease without a worker\'s name is refused, ending with the form', () => {
  const root = one(makeLoop({ prefix: 'jarl-names-', via: 'cli' }));
  const said = refusesBare(root, 'set', '1', 'in-progress', 'start', '--branch', 'jarl/1-one', '--model', TEST_MODEL, '--by', 'jarl');
  assert.match(said, /leased with no worker/);
  assert.match(lastLine(said), /--worker "<the-new-worker>"/);
  assert.throws(() => R.setStatus(root, '1', 'in-progress', 'start', { branch: 'jarl/1-one' }), /leased with no worker/);
});

test('a lease without --model is refused at the command line and through the tools, and a move that names no new holder keeps the lease\'s own', () => {
  const root = one(makeLoop({ prefix: 'jarl-names-', via: 'cli' }));
  const said = refusesBare(root, 'set', '1', 'in-progress', 'start', '--worker', 'w1', '--by', 'jarl');
  assert.match(said, /leased with no model/);
  assert.match(lastLine(said), /--model "<model-id>"/);
  const tool = mcp.callTool('jarl_set', { ids: '1', status: 'in-progress', text: 'start', worker: 'w1', by: 'jarl', root });
  assert.equal(tool.isError, true);
  assert.match(tool.content[0].text, /leased with no model/);
  jarl(root, 'set', '1', 'in-progress', 'start', '--worker', 'w1', '--model', 'm1', '--by', 'jarl');
  assert.equal(spawnJarl(root, ['set', '1', 'in-progress', 'still working', '--by', 'jarl'], { bare: true }).status, 0);
  assert.match(jarl(root, 'show', '1'), /\*\*Worker:\*\* w1/);
});

test('a verdict without --model is refused at the command line and through the tools; a bot\'s and the owner\'s name none', () => {
  const root = one(makeLoop({ prefix: 'jarl-names-', via: 'cli' }));
  const said = refusesBare(root, 'review', '1', 'approve', 'read the diff and found nothing', '--by', 'rev-a');
  assert.match(said, /--model/);
  assert.match(lastLine(said), /--model "<model-id>"/);
  const tool = mcp.callTool('jarl_review', { ids: '1', verdict: 'approve', text: 'read the diff and found nothing', by: 'rev-a', root });
  assert.equal(tool.isError, true);
  assert.equal(spawnJarl(root, ['review', '1', 'approve', 'read the diff and found nothing', '--by', 'owner'], { bare: true }).status, 0);
  assert.equal(spawnJarl(root, ['review', '1', 'changes', 'Important: the bot found a real defect here', '--by', 'coderabbit', '--bot'], { bare: true }).status, 0);
});

test('a value-taking flag with no value never reads the next flag as its value: --by --root leaves the call\'s loop as it was named', () => {
  const root = one(makeLoop({ prefix: 'jarl-names-', via: 'cli' }));
  const before = logOf(root);
  const r = spawnSync(process.execPath, [SCRIPT, 'log', 'a note', '--by', '--root', root], { encoding: 'utf8', timeout: 60_000, cwd: root });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--by needs a value/);
  assert.ok(r.stderr.includes(`--root ${root}`) || r.stderr.includes(`--root '${root}'`), `the form carries the call's --root: ${r.stderr}`);
  assert.equal(logOf(root), before);
  assert.deepEqual(readdirSync(root).filter((f) => f === '--root'), []);
  for (const flag of ['--by', '--worker', '--model']) {
    const said = spawnSync(process.execPath, [SCRIPT, 'set', '1', 'in-progress', 'start', flag, '--branch', 'x', '--root', root], { encoding: 'utf8', timeout: 60_000 });
    assert.notEqual(said.status, 0, flag);
    assert.match(said.stderr, new RegExp(`${flag} needs a value`), flag);
  }
});

test('--root with no value never reads the next flag as the root', () => {
  const root = one(makeLoop({ prefix: 'jarl-names-', via: 'cli' }));
  const r = spawnSync(process.execPath, [SCRIPT, 'status', '--root', '--json'], { encoding: 'utf8', timeout: 60_000, cwd: root });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--root needs a value/);
});

test('a name a value flag takes after a bare -- is untouched: only a word that starts with -- is the next flag', () => {
  const root = one(makeLoop({ prefix: 'jarl-names-', via: 'cli' }));
  assert.equal(spawnSync(process.execPath, [SCRIPT, 'log', '--by', 'jarl', '--root', root, '--', '--not-a-flag-really'], { encoding: 'utf8', timeout: 60_000 }).status, 0);
  assert.match(logOf(root), /· --not-a-flag-really/);
  assert.equal(spawnJarl(root, ['log', 'a note', '--by', 'writer-a'], { bare: true }).status, 0);
  assert.match(logOf(root), / by writer-a · a note/);
  const dashed = spawnJarl(root, ['evidence', '1', '--line', '1', '--ran', '--help', '--saw', 'printed the help'], { bare: true });
  assert.notEqual(dashed.status, 0);
  assert.match(dashed.stderr, /--by/);
  jarl(root, 'evidence', '1', '--line', '1', '--ran', '--help', '--saw', 'printed the help', '--by', TEST_WRITER);
});

test('unrecorded is no name a call may give', () => {
  const root = one(makeLoop({ prefix: 'jarl-names-', via: 'cli' }));
  assert.match(refuses(root, 'log', 'a note', '--by', 'unrecorded'), /never a name a call gives/);
  assert.match(refuses(root, 'log', 'a note', '--by', ' Unrecorded '), /never a name a call gives/);
});

test('the library takes the writer it is given, and a call that names nobody is written as unrecorded', () => {
  const root = makeLoop({ prefix: 'jarl-names-' });
  R.newIssue(root, 'one', { acceptance: '[read] it works', by: 'a-library-caller' });
  assert.match(logOf(root), /key \S+ by a-library-caller · filed 001 · one/);
  R.appendLog(root, 'a named note', { by: 'a-caller' });
  assert.match(logOf(root), / by a-caller · a named note/);
  R.appendLog(root, 'a note by nobody');
  assert.match(logOf(root), / by unrecorded · a note by nobody/);
  R.setPriority(root, '1', '1', { by: 'a-caller' });
  assert.match(logOf(root), / by a-caller · 001 field Priority · 1 · was 2/);
  assert.throws(() => R.appendLog(root, 'a note', { by: 'one\ntwo' }), /one name on one line/);
});

test('the writer of a write is written once, in the fixed place, and a tool\'s by reaches the line', () => {
  const root = one(makeLoop({ prefix: 'jarl-names-', via: 'cli' }));
  const r = mcp.callTool('jarl_log', { text: 'through the server', by: 'mcp-writer', root });
  assert.equal(r.isError, false, JSON.stringify(r));
  assert.match(logOf(root), / by mcp-writer · through the server/);
});

