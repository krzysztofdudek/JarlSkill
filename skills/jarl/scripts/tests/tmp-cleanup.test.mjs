import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPAWN_TIMEOUT } from './helpers.mjs';
import { importSpecifier } from './portable.mjs';

const PRELOAD = fileURLToPath(new URL('./tmp-cleanup.mjs', import.meta.url));
const SUITE = fileURLToPath(new URL('./suite.mjs', import.meta.url));
const PACKAGE = fileURLToPath(new URL('../package.json', import.meta.url));
const CLEAN_FIXTURE = fileURLToPath(new URL('./fixtures/tmp-clean-suite.mjs', import.meta.url));
const LEAKING_FIXTURE = fileURLToPath(new URL('./fixtures/tmp-leaking-suite.mjs', import.meta.url));
const LOCKED_FIXTURE = fileURLToPath(new URL('./fixtures/tmp-locked-suite.mjs', import.meta.url));

// A scratch temporary directory of its own for a child process, removed after the test whatever the test did.
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-tmp-cleanup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
// The environment of a child process whose temporary directory is `tmp`; it is not a child of a test runner, so a
// `node --test` it starts reports on its own.
function envWith(tmp) {
  const env = { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp };
  delete env.NODE_TEST_CONTEXT;
  return env;
}
// A child process with the cleanup imported and `tmp` as its temporary directory; `body` runs in it.
function child(tmp, body) {
  return spawnSync(process.execPath, ['--import', importSpecifier(PRELOAD), '--input-type=module', '-e', body], { encoding: 'utf8', timeout: SPAWN_TIMEOUT, env: envWith(tmp) });
}

test('npm test runs the suite through the runner that fails on anything left in an empty temporary directory', () => {
  const script = JSON.parse(readFileSync(PACKAGE, 'utf8')).scripts.test;
  assert.equal(script, 'node tests/suite.mjs');
});

test('a process that made temporary directories and ended normally leaves none', (t) => {
  const tmp = scratch(t);
  const r = child(tmp, `import { mkdtempSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
    for (const p of ['jarl-a-', 'report-b-']) writeFileSync(join(mkdtempSync(join(tmpdir(), p)), 'x'), 'x');`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(tmp), []);
});

test('directories made without mkdtemp, by a child process or by git are removed with the process', (t) => {
  const tmp = scratch(t);
  const r = child(tmp, `import { execFileSync } from 'node:child_process'; import { mkdirSync } from 'node:fs'; import { tmpdir } from 'node:os';
    mkdirSync(tmpdir() + '/plain'); mkdirSync(tmpdir() + '/plain/nested', { recursive: true });
    execFileSync(process.execPath, ['-e', "require('node:fs').mkdirSync(require('node:os').tmpdir() + '/by-child')"], { timeout: 60000 });
    execFileSync('git', ['init', '--quiet', tmpdir() + '/by-git'], { timeout: 60000 });`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(tmp), []);
});

test('a process that made siblings of its directories leaves none of them, and an entry that was there before is kept', (t) => {
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

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  test(`a process stopped by ${signal} leaves no temporary directory and exits with 128 plus the signal number`, { skip: process.platform === 'win32' && 'Windows ends a process that signals itself at once, without running a handler, and has no SIGHUP' }, (t) => {
    const tmp = scratch(t);
    const r = child(tmp, `import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
      mkdtempSync(join(tmpdir(), 'jarl-signal-')); process.kill(process.pid, '${signal}'); setTimeout(() => {}, 10000);`);
    assert.equal(r.status, 128 + constants.signals[signal], r.stderr);
    assert.deepEqual(readdirSync(tmp), []);
  });
}

test('a directory a test left unreadable is removed with the process', (t) => {
  const tmp = scratch(t);
  const r = child(tmp, `import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os';
    mkdirSync(tmpdir() + '/locked'); writeFileSync(tmpdir() + '/locked/f', 'f'); chmodSync(tmpdir() + '/locked', 0o000);`);
  assert.equal(r.status, 0, r.stderr);
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

test('a test file run on its own with a bare node --test leaves nothing in an empty temporary directory', (t) => {
  const tmp = scratch(t);
  const r = spawnSync(process.execPath, ['--test', CLEAN_FIXTURE], { encoding: 'utf8', timeout: SPAWN_TIMEOUT, env: envWith(tmp) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /pass 1/);
  assert.deepEqual(readdirSync(tmp), []);
});

test('the suite runner passes a suite that leaves nothing and leaves nothing itself', (t) => {
  const tmp = scratch(t);
  const r = spawnSync(process.execPath, [SUITE, CLEAN_FIXTURE], { encoding: 'utf8', timeout: SPAWN_TIMEOUT, env: envWith(tmp) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(readdirSync(tmp), []);
});

test('the suite runner fails a suite that leaves an entry in the empty temporary directory, names it, and cleans up', (t) => {
  const tmp = scratch(t);
  const r = spawnSync(process.execPath, [SUITE, LEAKING_FIXTURE], { encoding: 'utf8', timeout: SPAWN_TIMEOUT, env: envWith(tmp) });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /the suite left 1 entry in an empty temporary directory: fixture-leaked-/);
  assert.deepEqual(readdirSync(tmp), []);
});

test('the shards of the Windows job together run every test file once, each through the runner that guards leftovers', (t) => {
  const tmp = scratch(t);
  const dir = scratch(t);
  const names = Array.from({ length: 11 }, (_, i) => `file-${String(i).padStart(2, '0')}`);
  for (const name of names) writeFileSync(join(dir, `${name}.test.mjs`), `import test from 'node:test'; test('ran ${name}', () => {});`);
  const ran = [1, 2, 3].map((shard) => {
    const r = spawnSync(process.execPath, [SUITE, '--test-reporter=spec', `--test-shard=${shard}/3`], { cwd: dir, encoding: 'utf8', timeout: SPAWN_TIMEOUT, env: envWith(tmp) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return [...r.stdout.matchAll(/ran (file-\d+)/g)].map((m) => m[1]);
  });
  assert.deepEqual(ran.flat().sort(), names, 'every file once');
  assert.ok(ran.every((files) => files.length >= 3), JSON.stringify(ran));
  assert.deepEqual(readdirSync(tmp), [], 'each shard leaves nothing');
  const job = readFileSync(new URL('../../../../.github/workflows/ci.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n').split('\n  test-windows:\n')[1].split('\n\n  # ')[0];
  assert.match(job, /^ {8}shard: \[1, 2, 3\]$/m);
  assert.match(job, /^ {8}run: npm test -- --test-shard=\$\{\{ matrix\.shard \}\}\/3$/m);
  assert.match(job, /^ {6}fail-fast: false$/m);
});

test('the suite runner passes the failing exit status of the suite through', (t) => {
  const tmp = scratch(t);
  const failing = join(tmp, 'failing.mjs');
  writeFileSync(failing, "import test from 'node:test'; test('fails', () => { throw new Error('no'); });");
  const r = spawnSync(process.execPath, [SUITE, failing], { encoding: 'utf8', timeout: SPAWN_TIMEOUT, env: envWith(tmp) });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.doesNotMatch(r.stderr, /the suite left/);
});

const NOT_STOPPED = process.platform === 'win32' ? 'a read-only directory does not stop a removal on Windows' : process.getuid?.() === 0 ? 'a removal running as root is not stopped by a read-only directory' : false;
test('the suite runner names the leftovers before it removes them, and a removal that fails still fails the run', { skip: NOT_STOPPED }, (t) => {
  const tmp = scratch(t);
  const r = spawnSync(process.execPath, [SUITE, LOCKED_FIXTURE], { encoding: 'utf8', timeout: SPAWN_TIMEOUT, env: envWith(tmp) });
  for (const name of readdirSync(tmp)) {
    const locked = join(tmp, name, 'fixture-locked');
    if (existsSync(locked)) chmodSync(locked, 0o700);
  }
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const named = r.stderr.indexOf('the suite left 1 entry in an empty temporary directory: fixture-locked');
  assert.ok(named >= 0, r.stderr);
  assert.ok(r.stderr.indexOf('the suite could not remove its temporary directory') > named, r.stderr);
});
