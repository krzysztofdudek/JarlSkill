// Imported by every test file that makes anything in the system temporary directory (through `helpers.mjs` or on its own
// line): the process gets a temporary directory of its own, announced to everything it starts through the environment, and
// that directory is removed when the process ends, however it ends. Whatever a test makes under it, with mkdtemp, mkdir,
// a child process or git, is removed with it, so a test file run on its own leaves nothing behind, whether it passed,
// failed, timed out or was interrupted. The module is evaluated once per process, however many files import it.
import fs from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';

const outer = tmpdir();
const own = fs.mkdtempSync(join(outer, 'jarl-test-'));
for (const name of ['TMPDIR', 'TMP', 'TEMP']) process.env[name] = own;

// A test may leave a directory it made unreadable or read-only; the process makes its own directory writable again
// before it removes it, so that one test's permission scenario does not leave a tree behind.
function makeWritable(path) {
  let stat;
  try { stat = fs.lstatSync(path); } catch { return; }
  if (!stat.isDirectory()) return;
  try { fs.chmodSync(path, 0o700); } catch { /* the entry is gone or not ours */ }
  let names = [];
  try { names = fs.readdirSync(path); } catch { return; }
  for (const name of names) makeWritable(join(path, name));
}

let swept = false;
export function sweep() {
  if (swept) return;
  swept = true;
  try { fs.rmSync(own, { recursive: true, force: true, maxRetries: 3 }); } catch { /* retried below */ }
  if (!fs.existsSync(own)) return;
  makeWritable(own);
  try { fs.rmSync(own, { recursive: true, force: true, maxRetries: 3 }); } catch { /* reported below */ }
  if (fs.existsSync(own)) {
    process.stderr.write(`the test process could not remove its temporary directory ${own}\n`);
    process.exitCode = 1;
  }
}

process.on('exit', sweep);
// A signal ends the process the way the shell reports it: 128 plus the signal number.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { sweep(); process.exit(128 + constants.signals[signal]); });
}
