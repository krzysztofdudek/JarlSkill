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
import { SCRIPT, SPAWN_TIMEOUT } from './helpers.mjs';

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
