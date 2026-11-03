// The command line and the server of one install report the version of that install: the one its plugin manifest names,
// which sits three directories above the scripts. Two installs with two versions show that each install reports its own
// number.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCRIPT, SPAWN_TIMEOUT, loop } from './helpers.mjs';

const SCRIPTS = fileURLToPath(new URL('../', import.meta.url));
const SERVER = join(SCRIPTS, 'jarl-mcp.mjs');

// What the command line prints for --version, trimmed. A run that fails fails the test with what it said on stderr.
function cliVersion(cli) {
  const r = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8', timeout: SPAWN_TIMEOUT });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

// The version the server reports in its answer to initialize.
function serverVersion(server) {
  const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  const r = spawnSync(process.execPath, [server], { encoding: 'utf8', input: `${init}\n`, timeout: SPAWN_TIMEOUT });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.split('\n')[0]).result.serverInfo.version;
}

// A copy of the skill's scripts under home/skills/jarl/scripts. The plugin manifest at home names `version`; without a
// version the copy has no manifest, as a drop-in copy has none.
function install(home, version) {
  const scripts = join(home, 'skills', 'jarl', 'scripts');
  mkdirSync(scripts, { recursive: true });
  cpSync(SCRIPTS, scripts, { recursive: true, filter: (src) => basename(src) !== 'tests' });
  if (version !== undefined) writeFileSync(join(home, 'plugin.json'), JSON.stringify({ name: 'jarl', version }));
  return { cli: join(scripts, 'jarl.mjs'), server: join(scripts, 'jarl-mcp.mjs') };
}

test('the command line prints the version the server reports', () => {
  const version = cliVersion(SCRIPT);
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(version, serverVersion(SERVER));
});

test('two installs with two versions: each command line and server reports the version of its own install', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'jarl-version-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const first = install(join(home, 'first'), '1.2.3');
  const second = install(join(home, 'second'), '4.5.6');
  assert.equal(cliVersion(first.cli), '1.2.3');
  assert.equal(serverVersion(first.server), '1.2.3');
  assert.equal(cliVersion(second.cli), '4.5.6');
  assert.equal(serverVersion(second.server), '4.5.6');
});

test('a copy with no plugin manifest reports the fallback version on both the command line and the server', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'jarl-version-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const copy = install(join(home, 'copy'));
  assert.equal(cliVersion(copy.cli), '0.0.0');
  assert.equal(serverVersion(copy.server), '0.0.0');
});

// A scratch plugin root. Its manifest names `version`, or holds `body` as written; with neither, the root has no manifest.
function pluginRoot(t, { version, body } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-plugin-root-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (body !== undefined) writeFileSync(join(dir, 'plugin.json'), body);
  else if (version !== undefined) writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ name: 'jarl', version }));
  return dir;
}

// A loop of its own, removed after the test.
function scratchLoop(t) {
  const root = loop({ prefix: 'jarl-version-loop-' });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// The text the command line prints for resume on a loop, with the variable set to `plugin`, or unset when it is undefined.
function resumeText(loopRoot, plugin) {
  const env = { ...process.env };
  delete env.CLAUDE_PLUGIN_ROOT;
  if (plugin !== undefined) env.CLAUDE_PLUGIN_ROOT = plugin;
  const r = spawnSync(process.execPath, [SCRIPT, 'resume', '--root', loopRoot], { encoding: 'utf8', timeout: SPAWN_TIMEOUT, env });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

// The lines of a resume text that carry the plugin note.
const pluginNotes = (text) => text.split('\n').filter((line) => line.startsWith('note: the plugin at CLAUDE_PLUGIN_ROOT'));

test('resume prints one line naming both versions when the plugin at the variable reports another version', (t) => {
  const script = cliVersion(SCRIPT);
  const notes = pluginNotes(resumeText(scratchLoop(t), pluginRoot(t, { version: '4.5.6' })));
  assert.deepEqual(notes, [`note: the plugin at CLAUDE_PLUGIN_ROOT, whose server runs the Jarl tools, is version 4.5.6; this script is version ${script}.`]);
});

test('resume prints no plugin note when the plugin at the variable reports the same version', (t) => {
  assert.deepEqual(pluginNotes(resumeText(scratchLoop(t), pluginRoot(t, { version: cliVersion(SCRIPT) }))), []);
});

test('resume prints no plugin note when the variable is unset', (t) => {
  assert.deepEqual(pluginNotes(resumeText(scratchLoop(t), undefined)), []);
});

test('resume prints no plugin note, and never fails, when the variable is empty or names no readable manifest', (t) => {
  const loopRoot = scratchLoop(t);
  const cases = [
    '',
    join(pluginRoot(t), 'missing'),
    pluginRoot(t),
    pluginRoot(t, { body: '{ not json' }),
    pluginRoot(t, { body: JSON.stringify({ name: 'jarl' }) }),
    pluginRoot(t, { body: JSON.stringify({ version: 4 }) }),
  ];
  for (const plugin of cases) assert.deepEqual(pluginNotes(resumeText(loopRoot, plugin)), [], `the variable set to ${plugin}`);
});
