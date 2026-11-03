// Preloaded into every test process (`node --import`, set in package.json): every directory a test makes with mkdtemp in
// the system temporary directory is removed when the process ends, however it ends. A passing test, a failing one and a
// run stopped by a timeout or an interrupt all leave nothing behind, whatever the test did or forgot to do itself.
import fs, { rmSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

const made = new Set();
const realMkdtempSync = fs.mkdtempSync;
const base = resolve(tmpdir());

fs.mkdtempSync = function mkdtempSync(prefix, options) {
  const dir = realMkdtempSync.call(this, prefix, options);
  if (typeof dir === 'string' && resolve(dir).startsWith(base + sep)) made.add(resolve(dir));
  return dir;
};
syncBuiltinESMExports();

let swept = false;
export function sweep() {
  if (swept) return;
  swept = true;
  // A test also makes siblings of its directory (`<name>-wt`, `<name>-away`): worktrees and moved copies. The random
  // part of `<name>` is unique, so every entry that starts with `<name>-` belongs to the same test.
  let names = [];
  try { names = fs.readdirSync(base); } catch { /* the temporary directory is gone */ }
  const own = [...made].map((dir) => basename(dir));
  const doomed = new Set(made);
  for (const name of names) if (own.some((o) => name.startsWith(`${o}-`))) doomed.add(join(base, name));
  for (const dir of doomed) {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* a directory made unreadable by a test is the test's to restore */ }
  }
}

process.on('exit', sweep);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { sweep(); process.exit(128); });
}
