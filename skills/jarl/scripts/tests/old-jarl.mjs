// The Jarl 6.1.0 library, pinned from the v6.1.0 tag as tests/fixtures/jarl-6.1.0/jarl-lib.mjs, read-only: the hash
// below is checked before every run. It is the older reader a loop written by this Jarl must either be read right by
// or be refused loudly by. oldJarl(root, command, flags) runs one of its commands (list, status, next, queue) over a
// loop in a child process and returns { ok, value } or { ok: false, error }. A package that adds a line kind or a
// trigger of the record adds its case to a test that calls this; it does not build its own copy.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const OLD_JARL_FILE = fileURLToPath(new URL('./fixtures/jarl-6.1.0/jarl-lib.mjs', import.meta.url));
export const OLD_JARL_SHA256 = '6c735ff50f3ed41123fa4ecc02be76b9bbc96c8bd8223f7bea7ea0b068f713f0';
const COMMANDS = { list: 'cmdList', status: 'cmdStatus', next: 'cmdNext', queue: 'cmdQueue', report: 'cmdReport', set: 'cmdSet', evidence: 'cmdEvidence', merged: 'cmdMerged' };

export function oldJarlIsPinned() {
  return createHash('sha256').update(readFileSync(OLD_JARL_FILE)).digest('hex') === OLD_JARL_SHA256;
}

// `args` are the arguments after the root, for the commands that take more than flags: set (ids, status, why, flags),
// evidence (ids, text, flags) and merged (ids, flags). Without them the one argument is `flags`.
export function oldJarl(root, command, flags = {}, args = null) {
  if (!oldJarlIsPinned()) throw new Error('the pinned Jarl 6.1.0 library was changed: it is a fixture, read-only');
  if (!COMMANDS[command]) throw new Error(`oldJarl runs ${Object.keys(COMMANDS).join(', ')}`);
  const code = `import(${JSON.stringify(pathToFileURL(OLD_JARL_FILE).href)}).then((L) => {
    try { process.stdout.write(JSON.stringify({ ok: true, value: L.${COMMANDS[command]}(${JSON.stringify(root)}, ...${JSON.stringify(args ?? [flags])}.map((a) => (a === null ? undefined : a))) })); }
    catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: String(e.message) })); }
  });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) throw new Error(`the pinned Jarl 6.1.0 did not run: ${r.stderr}`);
  return JSON.parse(r.stdout);
}
