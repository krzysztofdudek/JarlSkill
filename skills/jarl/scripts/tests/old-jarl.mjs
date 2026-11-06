// The Jarl 6.1.0 library, pinned from the v6.1.0 tag as tests/fixtures/jarl-6.1.0/jarl-lib.mjs, read-only: the hash
// below is checked before every run. It is the older reader a loop written by this Jarl must either be read right by
// or be refused loudly by. oldJarl(root, command, flags) runs one of its commands (list, status, next, queue) over a
// loop in a child process and returns { ok, value } or { ok: false, error }. A package that adds a line kind or a
// trigger of the record adds its case to a test that calls this; it does not build its own copy.
// The Jarl 6.2.0 library, pinned the same way from the v6.2.0 tag as tests/fixtures/jarl-6.2.0/jarl-lib.mjs, is the
// reader of record formats 1 and 2: formatTwoJarl runs it as oldJarl runs 6.1.0, for the lines of format 3.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const OLD_JARL_FILE = fileURLToPath(new URL('./fixtures/jarl-6.1.0/jarl-lib.mjs', import.meta.url));
export const OLD_JARL_SHA256 = '6c735ff50f3ed41123fa4ecc02be76b9bbc96c8bd8223f7bea7ea0b068f713f0';
export const FORMAT_TWO_JARL_FILE = fileURLToPath(new URL('./fixtures/jarl-6.2.0/jarl-lib.mjs', import.meta.url));
export const FORMAT_TWO_JARL_SHA256 = '90ef7a44927b24e40ba8cbfed26de290ff15bef4daacd78a3733a82ce598fd35';
const COMMANDS = { init: 'cmdInit', new: 'cmdNew', import: 'cmdImport', list: 'cmdList', status: 'cmdStatus', next: 'cmdNext', queue: 'cmdQueue', report: 'cmdReport', set: 'cmdSet', evidence: 'cmdEvidence', merged: 'cmdMerged', decisions: 'cmdDecisions', round: 'cmdRound', review: 'cmdReview' };

const pinned = (file, sha) => createHash('sha256').update(readFileSync(file)).digest('hex') === sha;
export function oldJarlIsPinned() { return pinned(OLD_JARL_FILE, OLD_JARL_SHA256); }
export function formatTwoJarlIsPinned() { return pinned(FORMAT_TWO_JARL_FILE, FORMAT_TWO_JARL_SHA256); }

// `args` are the arguments after the root, for the commands that take more than flags: init (goal, flags), new (title,
// flags), import (findings file, flags), set (ids, status, why, flags),
// evidence (ids, text, flags), merged (ids, flags), round (id, text) and review (ids, verdict, findings, flags). Without them the one argument is `flags`.
export function oldJarl(root, command, flags = {}, args = null) {
  if (!oldJarlIsPinned()) throw new Error('the pinned Jarl 6.1.0 library was changed: it is a fixture, read-only');
  return run(OLD_JARL_FILE, '6.1.0', root, command, flags, args);
}
export function formatTwoJarl(root, command, flags = {}, args = null) {
  if (!formatTwoJarlIsPinned()) throw new Error('the pinned Jarl 6.2.0 library was changed: it is a fixture, read-only');
  return run(FORMAT_TWO_JARL_FILE, '6.2.0', root, command, flags, args);
}
function run(file, version, root, command, flags, args) {
  if (!COMMANDS[command]) throw new Error(`oldJarl runs ${Object.keys(COMMANDS).join(', ')}`);
  const code = `import(${JSON.stringify(pathToFileURL(file).href)}).then((L) => {
    try { process.stdout.write(JSON.stringify({ ok: true, value: L.${COMMANDS[command]}(${JSON.stringify(root)}, ...${JSON.stringify(args ?? [flags])}.map((a) => (a === null ? undefined : a))) })); }
    catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: String(e.message) })); }
  });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) throw new Error(`the pinned Jarl ${version} did not run: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

// Files an issue in the loop at `root` as a loop filed before it held keys holds it: through the pinned Jarl 6.1.0, so its
// number has three digits and it carries no key. Returns the id. A test of what an older reader makes of a loop this Jarl
// writes into files its issues this way, because this Jarl's own filing writes a key, which raises the loop to format 3.
export function fileAsBefore(root, title, flags = {}) {
  const r = oldJarl(root, 'new', {}, [title, flags]);
  if (!r.ok) throw new Error(`the pinned Jarl 6.1.0 did not file "${title}": ${r.error}`);
  return r.value.id;
}
// The same through the pinned Jarl 6.2.0 (the reader of formats 1 and 2), which writes the number plain (2, not 002) and raises the loop to format 2 for it.
export function fileAsFormatTwo(root, title, flags = {}) {
  const r = formatTwoJarl(root, 'new', {}, [title, flags]);
  if (!r.ok) throw new Error(`the pinned Jarl 6.2.0 did not file "${title}": ${r.error}`);
  return r.value.id;
}
