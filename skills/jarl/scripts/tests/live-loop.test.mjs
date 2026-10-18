// The read commands print the same bytes on a frozen copy of a real loop as they printed when the golden files were
// written. JARL_LIVE_LOOP names the copy (the directory that holds its .jarl) and JARL_LIVE_GOLDEN the directory of
// golden files, one per command, named as in COMMANDS; without both the test is skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

for (const [file, args] of Object.entries(COMMANDS)) {
  test(`${args.join(' ')} prints the golden bytes on the live loop copy`, { skip }, () => {
    const out = spawnSync(process.execPath, [SCRIPT, ...args, '--root', LIVE], { encoding: 'utf8', timeout: 120_000 });
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.stdout, readFileSync(join(GOLDEN, file), 'utf8'));
  });
}
