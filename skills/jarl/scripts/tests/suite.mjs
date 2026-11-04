// `npm test`: the suite runs with `node --test` against an empty temporary directory of its own, and a suite that leaves
// anything in it fails. A test file that makes temporary directories without importing `tmp-cleanup.mjs`, or a directory
// the cleanup could not remove, shows up here as a named entry instead of as a full disk later. Arguments are passed to
// `node --test` (the files to run), so a single file runs the same way.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';

const empty = mkdtempSync(join(tmpdir(), 'jarl-suite-'));
const child = spawn(process.execPath, ['--test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, TMPDIR: empty, TMP: empty, TEMP: empty },
});

let stoppedBy = null;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { stoppedBy = signal; child.kill(signal); });
}

child.on('close', (code, signal) => {
  const left = readdirSync(empty);
  // The leftovers are named before anything is removed, and a removal that fails is reported without hiding the failure.
  if (left.length > 0) process.stderr.write(`the suite left ${left.length} ${left.length === 1 ? 'entry' : 'entries'} in an empty temporary directory: ${left.join(', ')}\n`);
  let removed = true;
  try { rmSync(empty, { recursive: true, force: true, maxRetries: 3 }); } catch (error) {
    removed = false;
    process.stderr.write(`the suite could not remove its temporary directory ${empty}: ${error.message}\n`);
  }
  const ended = signal ?? stoppedBy;
  if (ended) process.exit(128 + constants.signals[ended]);
  if (left.length > 0 || !removed) process.exit(code || 1);
  process.exit(code ?? 1);
});
