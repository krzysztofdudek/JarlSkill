// The MCP server is the CLI over another wire: one tool per command, one field per argument and flag, generated
// from the CLI's own tables and run through its dispatch. These tests hold the two together — a command, an
// argument or a flag the tools do not carry fails here — and run the server the way a host starts it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../jarl-mcp.mjs', import.meta.url));
const CLI_SOURCE = readFileSync(fileURLToPath(new URL('../jarl.mjs', import.meta.url)), 'utf8');
const PLUGIN = fileURLToPath(new URL('../../../../', import.meta.url));
const { COMMAND_ARGS, COMMAND_FLAGS, GLOBAL_FLAGS, MUTATING, parseArgs } = await import('../jarl.mjs');
const mcp = await import('../jarl-mcp.mjs');

const TOOLS = mcp.buildTools();
const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

// The commands dispatch actually runs, read from its switch — not from the tables the tools are built from.
function dispatchedCommands() {
  const body = CLI_SOURCE.slice(CLI_SOURCE.indexOf('export function dispatch('));
  return [...body.slice(0, body.indexOf('default:')).matchAll(/case '([a-z]+)':/g)].map((m) => m[1]).sort();
}

test('parity: every command dispatch runs has its tables, its usage block and exactly one tool', () => {
  const commands = dispatchedCommands();
  assert.ok(commands.length >= 30, `read ${commands.length} commands from dispatch`);
  assert.deepEqual(Object.keys(COMMAND_FLAGS).sort(), commands, 'COMMAND_FLAGS names the commands dispatch runs');
  assert.deepEqual(Object.keys(COMMAND_ARGS).sort(), commands, 'COMMAND_ARGS names the commands dispatch runs');
  assert.deepEqual(Object.keys(mcp.usageBlocks()).sort(), commands, 'USAGE describes the commands dispatch runs');
  assert.deepEqual(TOOLS.map((t) => t.name).sort(), [...commands.map(mcp.toolName), 'jarl_help'].sort(), 'one tool per command, and help');
  for (const w of MUTATING) assert.ok(commands.includes(w), `MUTATING names ${w}, which dispatch does not run`);
});

test('parity: the tool set is the one this release documents — adding or removing a tool is a deliberate edit here', () => {
  assert.deepEqual(TOOLS.map((t) => t.name).sort(), [
    'after', 'answer', 'archive', 'ask', 'body', 'branches', 'changelog', 'check', 'close', 'decide', 'decisions',
    'evidence', 'files', 'handoff', 'help', 'import', 'init', 'list', 'log', 'merged', 'mode', 'new', 'next', 'prio',
    'profile', 'queue', 'repo', 'report', 'resume', 'review', 'round', 'set', 'show', 'source', 'sources', 'status', 'tag', 'tips',
  ].map(mcp.toolName));
});

test('parity: each tool has one field per argument and per flag, under the CLI name, of the matching type', () => {
  const blocks = mcp.usageBlocks();
  for (const cmd of Object.keys(COMMAND_FLAGS)) {
    const t = byName[mcp.toolName(cmd)];
    const props = t.inputSchema.properties;
    const args = COMMAND_ARGS[cmd].map(mcp.argName);
    const flags = Object.keys(COMMAND_FLAGS[cmd]);
    for (const a of args) assert.ok(!flags.includes(a) && !Object.hasOwn(GLOBAL_FLAGS, a), `${cmd}: argument "${a}" clashes with a flag`);
    assert.deepEqual(Object.keys(props).sort(), [...args, ...flags, 'json', 'root'].sort(), `${cmd}: the fields are its arguments, its flags, json and root`);
    for (const [f, kind] of Object.entries(COMMAND_FLAGS[cmd])) {
      assert.equal(props[f].type, { bool: 'boolean', many: 'array', value: 'string' }[kind], `${cmd} --${f} is ${kind}`);
    }
    // Both ways against the usage text, read on its own: every flag it shows is a field, and every flag in the
    // table is shown there.
    const shown = new Set([...blocks[cmd].synopsis.matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1]));
    for (const f of shown) assert.ok(props[f], `${cmd}: usage shows --${f}, the tool has no field for it`);
    for (const f of flags) assert.ok(shown.has(f), `${cmd}: --${f} is in COMMAND_FLAGS but its usage does not show it`);
    assert.equal(t.inputSchema.additionalProperties, false);
    assert.equal(t.annotations.readOnlyHint, !MUTATING.has(cmd));
    assert.match(t.description, MUTATING.has(cmd) ? /^WRITES the loop/ : /^Read-only/, `${cmd}: the description says plainly whether it writes`);
  }
});

test('parity: every field reaches the CLI parser as the flag or argument it names', () => {
  for (const cmd of Object.keys(COMMAND_FLAGS)) {
    const input = {};
    const wantPos = [];
    for (const a of COMMAND_ARGS[cmd]) {
      const n = mcp.argName(a);
      const abs = ['file', 'files'].includes(n) ? '/' : '';   // the findings paths must be absolute
      if (a.endsWith('...')) { input[n] = [`${abs}${n}-1`, `${abs}--${n}-2`]; wantPos.push(...input[n]); } else { input[n] = `${abs}--${n} value`; wantPos.push(input[n]); }
    }
    const wantFlags = {};
    for (const [f, kind] of Object.entries(COMMAND_FLAGS[cmd])) {
      // A flag naming a file on disk must be absolute, like the findings paths.
      const v = (mcp.PATH_FIELDS[cmd] || []).includes(f) ? '/--v=1' : '--v=1';
      if (kind === 'bool') { input[f] = true; wantFlags[f] = true; } else if (kind === 'many') { input[f] = ['--a', 'b=c']; wantFlags[f] = ['--a', 'b=c']; } else { input[f] = v; wantFlags[f] = v; }
    }
    input.json = true; wantFlags.json = true;
    const { positional, flags } = parseArgs(mcp.argvFor(cmd, input));
    assert.deepEqual(positional, [cmd, ...wantPos], `${cmd}: arguments`);
    assert.deepEqual(flags, wantFlags, `${cmd}: flags`);
  }
});

test('a field the command does not take, a wrong type, or an argument after a missing one is refused as invalid params', () => {
  assert.throws(() => mcp.argvFor('set', { ids: '1', bogus: 1 }), /unknown field "bogus"/);
  assert.throws(() => mcp.argvFor('list', { all: 'yes' }), /"all" must be true or false/);
  assert.throws(() => mcp.argvFor('after', { ids: '2', clear: true }), /"id" is required/);
  assert.throws(() => mcp.argvFor('handoff', { next: 'x', action: undefined, bogus: 1 }), /unknown field/);
  assert.deepEqual(mcp.argvFor('prio', { ids: 3, priority: 1 }), ['prio', '--', '3', '1'], 'numbers are taken as their text');
  assert.deepEqual(mcp.argvFor('evidence', { ids: '1', ran: 'npm test', saw: 'ok' }), ['evidence', '--ran=npm test', '--saw=ok', '--', '1'], 'a single string for a repeatable flag is one item');
});

test('the loop root: the field, else JARL_ROOT, else the loop found from the working directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-mcp-root-'));
  mkdirSync(join(dir, '.git'));
  mkdirSync(join(dir, 'sub'));
  assert.equal(mcp.rootFor({ root: '/x/y' }, { JARL_ROOT: '/a' }, dir), '/x/y');
  assert.equal(mcp.rootFor({}, { JARL_ROOT: '/a' }, dir), '/a');
  assert.equal(mcp.rootFor({}, {}, join(dir, 'sub')), dir);
});

for (const [label, value] of [['a bare relative path', 'some/loop'], ['./ itself', '.'], ['../ up one', '../elsewhere']]) {
  test(`a relative JARL_ROOT (${label}) is refused, not resolved against the server's cwd`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarl-mcp-relroot-'));
    refusedAsInvalid(() => mcp.rootFor({}, { JARL_ROOT: value }, dir), /JARL_ROOT must be an absolute path/);
    refusedAsInvalid(() => mcp.callTool('jarl_status', {}, { JARL_ROOT: value }, dir), /JARL_ROOT must be an absolute path/);
  });
}

// ---- the server over stdio, as a host starts it ----

function startServer(env = {}, cwd = undefined) {
  const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env }, cwd });
  let buf = '';
  const waiting = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    }
  });
  let next = 1;
  const request = (method, params) => new Promise((res) => {
    const id = next++;
    waiting.set(id, res);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const notify = (method) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  const call = async (name, args) => (await request('tools/call', { name, arguments: args })).result;
  const stop = () => new Promise((res) => { child.on('close', res); child.stdin.end(); });
  return { request, notify, call, stop };
}

test('smoke: initialize, tools/list, status and a writing command on a temporary loop, over stdio', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-mcp-'));
  mkdirSync(join(root, '.git'));
  const s = startServer();
  try {
    const init = await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    assert.equal(init.result.serverInfo.name, 'jarl');
    assert.deepEqual(init.result.capabilities, { tools: {} });
    s.notify('notifications/initialized');
    const list = await s.request('tools/list', {});
    assert.equal(list.result.tools.length, TOOLS.length);

    const opened = await s.call('jarl_init', { goal: 'make the export command handle every fixture', root });
    assert.equal(opened.isError, false, opened.content[0].text);
    const filed = await s.call('jarl_new', { title: '--odd title', kind: 'bug', prio: '1', acceptance: ['one', '--two'], root, json: true });
    assert.equal(filed.isError, false, filed.content[0].text);
    assert.equal(JSON.parse(filed.content[0].text).id, '001');
    const issue = readFileSync(join(root, '.jarl', 'issues', readdirSync(join(root, '.jarl', 'issues'))[0]), 'utf8');
    assert.match(issue, /^# 001 · --odd title/);
    assert.match(issue, /- one\n- --two/);
    assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /filed 001/);

    const status = await s.call('jarl_status', { root });
    assert.equal(status.isError, false);
    assert.match(status.content[0].text, /^goal: make the export command handle every fixture/);
    assert.match(status.content[0].text, /open 1 · in flight 0/);
    const statusJson = await s.call('jarl_status', { root, json: true });
    assert.equal(JSON.parse(statusJson.content[0].text).open, 1);

    // A refusal is the CLI's exit 1: isError, with the text it would print, and nothing written.
    const refused = await s.call('jarl_set', { ids: '1', status: 'done', root });
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /no evidence yet/);
    assert.match((await s.call('jarl_show', { id: '1', root })).content[0].text, /\*\*Status:\*\* open/);

    // The CLI's stderr notes come back as a second block.
    await s.call('jarl_evidence', { ids: '1', ran: 'npm test', saw: 'ok', root });
    await s.call('jarl_review', { ids: '1', verdict: 'approve', findings: 'fine', by: 'jarl', root });
    const done = await s.call('jarl_set', { ids: '1', status: 'done', why: 'finished', root });
    assert.equal(done.isError, false, done.content[0].text);
    assert.match(done.content[0].text, /001 → done/);
    assert.match(done.content[1]?.text || '', /^note: 001 /, 'two acceptance lines, one evidence row: the note the CLI prints on stderr');

    // An invalid field is a protocol error, not a tool result.
    const bad = await s.request('tools/call', { name: 'jarl_set', arguments: { ids: '1', nope: true } });
    assert.equal(bad.error.code, -32602);
    const unknown = await s.request('tools/call', { name: 'jarl_nope', arguments: {} });
    assert.equal(unknown.error.code, -32602);
    const help = await s.call('jarl_help', {});
    assert.match(help.content[0].text, /^usage: jarl\.mjs/);
  } finally { await s.stop(); }
});

test('smoke: JARL_ROOT in the server config names the loop when a call gives no root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-mcp-env-'));
  mkdirSync(join(root, '.git'));
  const s = startServer({ JARL_ROOT: root }, tmpdir());
  try {
    await s.request('initialize', {});
    assert.equal((await s.call('jarl_init', { goal: 'g' })).isError, false);
    assert.ok(existsSync(join(root, '.jarl', 'goal.md')));
    assert.match((await s.call('jarl_log', { event: 'from the server' })).content[0].text, /logged/);
    assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /from the server/);
  } finally { await s.stop(); }
});

test('a check that fails is the CLI exit 2: isError, with the items', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-mcp-check-'));
  execSync('git init -q -b feature && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null && echo 1 > a.mjs && git add -A && git commit -qm base', { cwd: root });
  mcp.callTool('jarl_init', { goal: 'g', root });
  mcp.callTool('jarl_new', { title: 't', files: 'a.mjs', root });
  execSync('git checkout -q -b jarl/001-t && echo 2 > b.mjs && git add -A && git commit -qm change && git checkout -q feature', { cwd: root });
  const r = mcp.callTool('jarl_check', { id: '1', branch: 'jarl/001-t', root });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /✗/);
});

test('the plugin starts the server by itself: .mcp.json and the portable mcp.json name the same guarded server', () => {
  const claude = JSON.parse(readFileSync(join(PLUGIN, '.mcp.json'), 'utf8')).mcpServers.jarl;
  const portable = JSON.parse(readFileSync(join(PLUGIN, 'mcp.json'), 'utf8'));
  assert.equal(portable.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  const p = portable.mcpServers.jarl;
  assert.equal(claude.command, 'node');
  assert.equal(p.command, 'node');
  assert.equal(claude.args[0], '-e');
  assert.equal(claude.args[1], p.args[1], 'the same guard');
  assert.equal(claude.args[2], '${CLAUDE_PLUGIN_ROOT}/skills/jarl/scripts/jarl-mcp.mjs');
  assert.equal(p.args[2], '${PLUGIN_ROOT}/skills/jarl/scripts/jarl-mcp.mjs');
  assert.ok(existsSync(join(PLUGIN, 'skills/jarl/scripts/jarl-mcp.mjs')));
  // A plugin path the environment cannot reach (a host path inside a container): one stderr line, exit 0.
  const out = execSync(`"${process.execPath}" -e '${claude.args[1].replace(/'/g, "'\\''")}' /no/such/jarl-mcp.mjs 2>&1; echo "exit $?"`, { encoding: 'utf8' });
  assert.match(out, /^jarl: \/no\/such\/jarl-mcp\.mjs is not reachable from this environment/);
  assert.match(out, /exit 0/);
});

test('concurrent writes: calls sent at once to one server, and to two servers on one loop, lose nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-mcp-lock-'));
  mkdirSync(join(root, '.git'));
  const a = startServer({ JARL_ROOT: root });
  const b = startServer({ JARL_ROOT: root });
  try {
    await Promise.all([a.request('initialize', {}), b.request('initialize', {})]);
    assert.equal((await a.call('jarl_init', { goal: 'g' })).isError, false);
    const calls = [];
    for (let i = 0; i < 8; i += 1) { calls.push(a.call('jarl_new', { title: `a ${i}`, json: true })); calls.push(b.call('jarl_new', { title: `b ${i}`, json: true })); }
    const results = await Promise.all(calls);
    for (const r of results) assert.equal(r.isError, false, r.content[0].text);
    const ids = results.map((r) => JSON.parse(r.content[0].text).id);
    assert.equal(new Set(ids).size, 16, `every issue got its own number: ${ids.join(' ')}`);
    assert.equal(readdirSync(join(root, '.jarl', 'issues')).length, 16);
    assert.equal(readFileSync(join(root, '.jarl', 'log.md'), 'utf8').split('\n').filter((l) => / filed \d{3}/.test(l)).length, 16);
    assert.ok(!existsSync(join(root, '.jarl', '.lock')), 'the lock is released after the last write');
  } finally { await Promise.all([a.stop(), b.stop()]); }
});

test('SKILL.md names every argument field the tools take, and sends the agent to the tools first', () => {
  const skill = readFileSync(fileURLToPath(new URL('../../SKILL.md', import.meta.url)), 'utf8');
  const line = Object.entries(COMMAND_ARGS).filter(([, a]) => a.length).map(([c, a]) => `\`${c}\` ${a.map(mcp.argName).join(', ')}`).join(' · ');
  assert.ok(skill.includes(line), `SKILL.md lists the argument fields as:\n${line}`);
  const flagLine = Object.entries(COMMAND_FLAGS).filter(([, f]) => Object.keys(f).length).map(([c, f]) => `\`${c}\` ${Object.keys(f).join(', ')}`).join(' · ');
  assert.ok(skill.includes(`The flag fields: ${flagLine};`), `SKILL.md lists the flag fields as:\n${flagLine}`);
  assert.match(skill, /\*\*Call it through its MCP tools\.\*\*/);
  assert.match(skill, /### The CLI, when the tools are not there/);
});


// ---- what the server refuses, and what it says without being asked ----

function loopDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, '.git'));
  mcp.callTool('jarl_init', { goal: 'g', root: dir });
  return dir;
}
const issuesIn = (dir) => readdirSync(join(dir, '.jarl', 'issues')).length;
function refusedAsInvalid(fn, re) {
  let e;
  try { fn(); } catch (x) { e = x; }
  assert.ok(e, 'expected a refusal');
  assert.equal(e.code, -32602, e.message);
  if (re) assert.match(e.message, re);
}

for (const [label, root] of [['a number', 123], ['an empty string', ''], ['whitespace', '   '], ['a relative path', 'some/loop'], ['null', null]]) {
  test(`root given as ${label} is refused as invalid params, and nothing is written anywhere`, () => {
    const cwdLoop = loopDir('jarl-mcp-badroot-');
    refusedAsInvalid(() => mcp.callTool('jarl_new', { title: 't', root }, {}, cwdLoop), /"root" must be the absolute path/);
    assert.equal(issuesIn(cwdLoop), 0, 'the loop the server runs in got nothing');
    assert.deepEqual(mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'jarl_status', arguments: { root } } }).error?.code, -32602);
  });
}

test('import and sources take only absolute findings paths', () => {
  const root = loopDir('jarl-mcp-paths-');
  refusedAsInvalid(() => mcp.callTool('jarl_import', { file: 'findings.json', root }), /"file" must be an absolute path/);
  refusedAsInvalid(() => mcp.callTool('jarl_sources', { files: ['/abs/f.json', 'rel/f.json'], root }), /"files" must be an absolute path/);
  const r = mcp.callTool('jarl_sources', { files: [join(root, 'missing.json')], root });
  assert.equal(r.isError, true, 'an absolute path goes through to the CLI, which answers for itself');
  assert.match(byName.jarl_import.inputSchema.properties.file.description, /absolute path/);
});

test('a missing required field is refused as invalid params, as the schema declares it', () => {
  const root = loopDir('jarl-mcp-required-');
  refusedAsInvalid(() => mcp.callTool('jarl_new', { root }), /"title" is required/);
  refusedAsInvalid(() => mcp.callTool('jarl_set', { ids: '1', root }), /"status" is required/);
  refusedAsInvalid(() => mcp.callTool('jarl_review', { ids: '1', verdict: 'approve', root }), /"findings" is required/);
  for (const t of TOOLS) for (const f of t.inputSchema.required || []) assert.ok(t.inputSchema.properties[f], `${t.name}: required ${f} is a field`);
  assert.equal(mcp.callTool('jarl_check', { branch: 'x', root }).isError, true, 'an optional argument left out goes through');
});

test('with no root, every answer ends by naming the loop it reached and where that came from', () => {
  const a = loopDir('jarl-mcp-env-note-');
  const viaEnv = mcp.callTool('jarl_new', { title: 'from env' }, { JARL_ROOT: a }, tmpdir());
  assert.equal(viaEnv.isError, false);
  assert.match(viaEnv.content.at(-1).text, new RegExp(`^loop: ${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(no root given — from JARL_ROOT\\)`));
  assert.equal(issuesIn(a), 1);
  const viaCwd = mcp.callTool('jarl_status', {}, {}, a);
  assert.match(viaCwd.content.at(-1).text, /\(no root given — found from the server's working directory /);
  const refused = mcp.callTool('jarl_show', { id: '9' }, {}, a);
  assert.equal(refused.isError, true);
  assert.match(refused.content.at(-1).text, /^loop: /, 'a refusal names the loop too');
  const named = mcp.callTool('jarl_status', { root: a });
  assert.ok(!named.content.some((c) => c.text.startsWith('loop: ')), 'a call that named its root is not told');
});

test('with json: true, the answer is exactly one text block holding the JSON, whatever else there is to say', () => {
  const a = loopDir('jarl-mcp-json-meta-');

  // No root given: the loop note would have been a second block; it goes into _meta instead.
  const viaEnv = mcp.callTool('jarl_status', { json: true }, { JARL_ROOT: a }, tmpdir());
  assert.equal(viaEnv.isError, false);
  assert.equal(viaEnv.content.length, 1, 'exactly one text block');
  assert.deepEqual(JSON.parse(viaEnv.content[0].text).open, 0);
  assert.match(viaEnv._meta['jarl/loop'], new RegExp(`^loop: ${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(no root given — from JARL_ROOT\\)`));
  assert.ok(!('jarl/warn' in viaEnv._meta));

  // A call that named its root gets no _meta at all: nothing left over to say.
  const named = mcp.callTool('jarl_status', { root: a, json: true });
  assert.equal(named.content.length, 1);
  assert.equal(named._meta, undefined);

  // A command that notes something on stderr (set's evidence note) still comes back as one block, the note in _meta.
  mcp.callTool('jarl_new', { title: 't', root: a });
  mcp.callTool('jarl_evidence', { ids: '1', ran: 'npm test', saw: 'ok', root: a });
  mcp.callTool('jarl_review', { ids: '1', verdict: 'approve', findings: 'fine', by: 'jarl', root: a });
  const withNote = mcp.callTool('jarl_set', { ids: '1', status: 'done', why: 'finished', root: a, json: true });
  assert.equal(withNote.isError, false, withNote.content[0].text);
  assert.equal(withNote.content.length, 1);
  assert.match(withNote._meta['jarl/warn'], /^note: 001 /);

  // A refusal (the CLI's exit 1) with json: true is still one block; the loop note goes to _meta, not a second block.
  const refused = mcp.callTool('jarl_show', { id: '9', json: true }, {}, a);
  assert.equal(refused.isError, true);
  assert.equal(refused.content.length, 1);
  assert.match(refused._meta['jarl/loop'], /^loop: /);

  // check's exit 2 (a failed check) with json: true: still one block, isError true, the JSON with its items.
  const c = mkdtempSync(join(tmpdir(), 'jarl-mcp-json-check-'));
  execSync('git init -q -b feature && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null && echo 1 > a.mjs && git add -A && git commit -qm base', { cwd: c });
  mcp.callTool('jarl_init', { goal: 'g', root: c });
  mcp.callTool('jarl_new', { title: 't', files: 'a.mjs', root: c });
  execSync('git checkout -q -b jarl/001-t && echo 2 > b.mjs && git add -A && git commit -qm change && git checkout -q feature', { cwd: c });
  const failedCheck = mcp.callTool('jarl_check', { id: '1', branch: 'jarl/001-t', root: c, json: true });
  assert.equal(failedCheck.isError, true);
  assert.equal(failedCheck.content.length, 1);
  assert.ok(JSON.parse(failedCheck.content[0].text).ok === false);
});

test('initialize answers with the client\'s protocol version when it speaks it, else with its own', () => {
  const v = (asked) => mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: asked ? { protocolVersion: asked } : {} }).result.protocolVersion;
  for (const known of mcp.PROTOCOL_VERSIONS) assert.equal(v(known), known);
  assert.equal(v('1999-01-01'), mcp.PROTOCOL_VERSION);
  assert.equal(v(undefined), mcp.PROTOCOL_VERSION);
});

test('a JSON-RPC response from the client gets no answer; a malformed request still does', () => {
  const lines = [
    { jsonrpc: '2.0', id: 90, result: {} },
    { jsonrpc: '2.0', id: 91, error: { code: 1, message: 'x' } },
    { jsonrpc: '2.0', id: 92 },
    { jsonrpc: '2.0', id: 93, method: 'ping' },
  ].map((m) => JSON.stringify(m)).join('\n');
  const out = execSync(`"${process.execPath}" "${SERVER}"`, { input: `${lines}\n`, encoding: 'utf8' }).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(out.map((m) => m.id), [92, 93]);
  assert.equal(out[0].error.code, -32600);
  assert.deepEqual(out[1].result, {});
});

test('jarl_set says that its status field may name a declared field, with why as the value', () => {
  assert.match(byName.jarl_set.description, /The "status" field may instead name a field the loop's profile declares \(see jarl_profile\), and "why" is then that field's value/);
});
