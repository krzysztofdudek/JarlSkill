// The read commands print the same bytes on a frozen copy of a real loop as they printed when the golden files were
// written. JARL_LIVE_LOOP names the copy (the directory that holds its .jarl) and JARL_LIVE_GOLDEN the directory of
// golden files, one per command, named as in COMMANDS; without both the test is skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const LIVE = process.env.JARL_LIVE_LOOP || '';
const GOLDEN = process.env.JARL_LIVE_GOLDEN || '';
const COMMANDS = {
  'status.txt': ['status'], 'status.json': ['status', '--json'],
  'resume.txt': ['resume'], 'next.txt': ['next', '--all'], 'next.json': ['next', '--all', '--json'],
  'report.txt': ['report'], 'report.json': ['report', '--json'],
  'models.txt': ['models'], 'models.json': ['models', '--json'],
  'list.txt': ['list', '--all'], 'tips.txt': ['tips'], 'tips.json': ['tips', '--json'],
  'queue.txt': ['queue'], 'branches.txt': ['branches'],
};
const skip = !(LIVE && GOLDEN && existsSync(join(LIVE, '.jarl'))) && 'JARL_LIVE_LOOP (a copy of a real loop) and JARL_LIVE_GOLDEN (its golden outputs) are unset, or name nothing';

// JARL_LIVE_RECORD=1 writes the golden files instead of comparing with them.
const RECORD = process.env.JARL_LIVE_RECORD === '1';
function printed(args) {
  const out = spawnSync(process.execPath, [SCRIPT, ...args, '--root', LIVE], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout;
}
function matchesGolden(file, text) {
  if (RECORD) { mkdirSync(dirname(join(GOLDEN, file)), { recursive: true }); writeFileSync(join(GOLDEN, file), text); return; }
  assert.equal(text, readFileSync(join(GOLDEN, file), 'utf8'));
}

for (const [file, args] of Object.entries(COMMANDS)) {
  test(`${args.join(' ')} prints the golden bytes on the live loop copy`, { skip }, () => {
    matchesGolden(file, printed(args));
  });
}

test('show --full prints the golden bytes for every issue of the live loop copy', { skip }, () => {
  const ids = readdirSync(join(LIVE, '.jarl', 'issues')).filter((f) => /^\d+-.*\.md$/.test(f)).map((f) => String(Number(f.slice(0, f.indexOf('-')))));
  assert.ok(ids.length > 0);
  for (const id of ids) matchesGolden(join('show', `${id}.txt`), printed(['show', id, '--full']));
});
