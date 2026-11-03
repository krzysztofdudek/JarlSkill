import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPAWN_TIMEOUT } from './helpers.mjs';

const PRELOAD = fileURLToPath(new URL('./tmp-cleanup.mjs', import.meta.url));
const PACKAGE = fileURLToPath(new URL('../package.json', import.meta.url));

// A scratch temporary directory of its own for a child process, removed after the test whatever the test did.
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-tmp-cleanup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
// A child process with the cleanup preloaded and `tmp` as its temporary directory; `body` runs in it.
function child(tmp, body) {
  return spawnSync(process.execPath, ['--import', PRELOAD, '--input-type=module', '-e', body], { encoding: 'utf8', timeout: SPAWN_TIMEOUT, env: { ...process.env, TMPDIR: tmp } });
}

test('the suite runs every test process with the temporary-directory cleanup preloaded', () => {
  const script = JSON.parse(readFileSync(PACKAGE, 'utf8')).scripts.test;
  assert.match(script, /--import[ =]\.\/tests\/tmp-cleanup\.mjs/);
});

test('a process that made temporary directories and ended normally leaves none', (t) => {
  const tmp = scratch(t);
  const r = child(tmp, `import { mkdtempSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
    for (const p of ['jarl-a-', 'report-b-']) writeFileSync(join(mkdtempSync(join(tmpdir(), p)), 'x'), 'x');`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(tmp), []);
});

test('a process that made siblings of its temporary directory leaves none of them, and no unrelated entry is removed', (t) => {
  const tmp = scratch(t);
  mkdirSync(join(tmp, 'unrelated-wt'));
  const r = child(tmp, `import { mkdirSync, mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os';
    const d = mkdtempSync(tmpdir() + '/jarl-sib-'); mkdirSync(d + '-wt'); mkdirSync(d + '-away');`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(tmp), ['unrelated-wt']);
});

test('a process that failed, or threw, leaves no temporary directory', (t) => {
  const tmp = scratch(t);
  const r = child(tmp, `import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
    mkdtempSync(join(tmpdir(), 'jarl-fail-')); throw new Error('a failing test');`);
  assert.notEqual(r.status, 0);
  assert.deepEqual(readdirSync(tmp), []);
});

test('a process stopped by a signal leaves no temporary directory', (t) => {
  const tmp = scratch(t);
  const r = child(tmp, `import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
    mkdtempSync(join(tmpdir(), 'jarl-signal-')); process.kill(process.pid, 'SIGTERM'); setTimeout(() => {}, 10000);`);
  assert.notEqual(r.status, 0);
  assert.deepEqual(readdirSync(tmp), []);
});

test('a directory outside the temporary directory is never removed', (t) => {
  const tmp = scratch(t);
  const other = scratch(t);
  mkdirSync(join(other, 'keep'));
  writeFileSync(join(other, 'keep', 'f'), 'f');
  const r = child(tmp, `import { mkdtempSync } from 'node:fs'; mkdtempSync(${JSON.stringify(join(other, 'keep', 'made-'))});`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(other, 'keep', 'f'), 'utf8'), 'f');
  assert.equal(readdirSync(join(other, 'keep')).length, 2);
});
