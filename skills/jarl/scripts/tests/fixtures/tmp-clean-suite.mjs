// A test file that makes temporary directories every way a test does and cleans none of them itself; it imports the
// cleanup, as every test file that touches the temporary directory does.
import '../tmp-cleanup.mjs';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('makes directories with mkdtemp, mkdir, a child process and git', () => {
  const made = mkdtempSync(join(tmpdir(), 'fixture-made-'));
  writeFileSync(join(made, 'file'), 'x');
  mkdirSync(join(tmpdir(), 'fixture-plain'));
  mkdirSync(`${made}-sibling`);
  execFileSync(process.execPath, ['-e', "require('node:fs').mkdirSync(require('node:os').tmpdir() + '/fixture-child')"], { timeout: 60000 });
  execFileSync('git', ['init', '--quiet', join(tmpdir(), 'fixture-repo')], { timeout: 60000 });
});
