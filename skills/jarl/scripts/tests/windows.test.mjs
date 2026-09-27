// What Windows does differently, tested on every OS (issue 481): a loop checked out with CRLF line endings reads
// the same as one with LF, a rename refused for a moment over an open file is retried there (and only there),
// and a JARL_GH that is a node script runs without a shebang.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readText, renameRetry, RENAME_RETRY_MS } from '../jarl.mjs';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const run = (root, ...args) => spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8' });

test('readText gives LF whatever the file holds', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'jarl-crlf-')), 'x.md');
  writeFileSync(f, 'a\r\nb\rc\n');
  assert.equal(readText(f), 'a\nb\nc\n');
});

test('a loop whose files came back with CRLF (a Windows checkout with core.autocrlf) reads and writes as with LF', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-crlf-loop-'));
  mkdirSync(join(root, '.git'));
  assert.equal(run(root, 'init', 'goal').status, 0);
  assert.equal(run(root, 'new', 'a thing', '--files', 'a.mjs', '--acceptance', 'it works').status, 0);
  const dir = join(root, '.jarl', 'issues');
  const crlf = (f) => writeFileSync(f, readFileSync(f, 'utf8').replace(/\n/g, '\r\n'));
  for (const f of readdirSync(dir)) crlf(join(dir, f));
  for (const f of ['log.md', 'goal.md']) crlf(join(root, '.jarl', f));
  const shown = JSON.parse(run(root, 'show', '1', '--json').stdout);
  assert.equal(shown.title, 'a thing');
  assert.equal(shown.status, 'open');
  assert.deepEqual(shown.fields.files, 'a.mjs');
  assert.equal(run(root, 'set', '1', 'in-progress', 'go').status, 0);
  assert.equal(run(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass').status, 0);
  const again = JSON.parse(run(root, 'show', '1', '--json').stdout);
  assert.equal(again.status, 'in-progress');
  assert.match(readFileSync(join(dir, readdirSync(dir)[0]), 'utf8'), /\*\*ran:\*\* npm test/);
  assert.match(run(root, 'status').stdout, /in flight 1/);
});

test('renameRetry: on win32 a busy rename is retried until it goes through; elsewhere, and for other errors, the first error stands', () => {
  const busy = (n, code = 'EPERM') => { let left = n; return () => { if (left-- > 0) { const e = new Error(code); e.code = code; throw e; } }; };
  let calls = 0; const counted = (f) => (...a) => { calls += 1; return f(...a); };
  renameRetry('a', 'b', counted(busy(3)), 'win32');
  assert.equal(calls, 4);
  for (const code of ['EACCES', 'EBUSY']) renameRetry('a', 'b', busy(2, code), 'win32');
  assert.throws(() => renameRetry('a', 'b', busy(1), 'linux'), { code: 'EPERM' });
  assert.throws(() => renameRetry('a', 'b', busy(1, 'ENOENT'), 'win32'), { code: 'ENOENT' });
  const t0 = Date.now();
  assert.throws(() => renameRetry('a', 'b', busy(Infinity), 'win32'), { code: 'EPERM' });
  assert.ok(Date.now() - t0 >= RENAME_RETRY_MS, 'a rename that never frees up fails after the retry window');
});

test('the MCP server knows it is the entry however its path is spelled: in another drive-letter case on Windows', async () => {
  const { isEntry } = await import('../jarl-mcp.mjs');
  const self = fileURLToPath(new URL('../jarl-mcp.mjs', import.meta.url));
  assert.equal(isEntry(self, self), true);
  assert.equal(isEntry(undefined, self), false);
  assert.equal(isEntry(SCRIPT, self), false);
  const fake = 'C:\\plugins\\jarl\\skills\\jarl\\scripts\\jarl-mcp.mjs';
  assert.equal(isEntry(fake.replace('C:', 'c:'), fake, 'win32'), true, 'drive-letter case does not matter on Windows');
  assert.equal(isEntry(fake.toUpperCase(), fake, 'linux'), false, 'elsewhere case does matter');
});
