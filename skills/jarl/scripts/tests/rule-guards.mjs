// Removes each rule's guard on a scratch copy of the skill and runs the test the table names for it, which must then fail.
// Prints one line per rule, `<id> red <test file>` or `<id> GREEN <test file>: the test passed without the guard`, and ends
// with a count; the process fails if any guard does not bite. --only <id> runs one rule; the scratch copy is removed at the end.
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES } from './rule-table.mjs';

const SKILL = fileURLToPath(new URL('../../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'jarl-rule-guards-'));
cpSync(SKILL, join(scratch, 'jarl'), { recursive: true });
const scripts = join(scratch, 'jarl', 'scripts');

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const rows = RULES.filter((r) => r.guard && (only === null || r.id === only));
if (only !== null && !rows.length) { process.stderr.write(`no rule with a guard has the id ${only}\n`); process.exit(2); }

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function run(row) {
  const target = join(scripts, row.guard.file);
  const original = readFileSync(target, 'utf8');
  const at = original.indexOf(row.guard.find);
  if (at === -1 || original.indexOf(row.guard.find, at + 1) !== -1) return { state: 'NO-GUARD', why: `the guard's text is not exactly once in ${row.guard.file}` };
  writeFileSync(target, original.slice(0, at) + row.guard.to + original.slice(at + row.guard.find.length));
  const empty = mkdtempSync(join(scratch, 'tmp-'));
  try {
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', `--test-name-pattern=^${escapeRe(row.test)}`, join('tests', row.file)],
      { cwd: scripts, encoding: 'utf8', timeout: 300_000, env: { ...process.env, TMPDIR: empty, TMP: empty, TEMP: empty } });
    const out = `${r.stdout}${r.stderr}`;
    const named = out.includes(`✖ ${row.test}`);
    if (r.status !== 0 && named) return { state: 'red' };
    if (r.status === 0) return { state: 'GREEN', why: 'the test passed without the guard' };
    return { state: 'BROKEN', why: `the run failed elsewhere: ${out.split('\n').filter((l) => l.trim()).slice(0, 2).join(' | ').slice(0, 200)}` };
  } finally {
    writeFileSync(target, original);
    rmSync(empty, { recursive: true, force: true });
  }
}

let bad = 0;
for (const row of rows) {
  const result = run(row);
  if (result.state !== 'red') bad += 1;
  process.stdout.write(`${row.id} ${result.state} ${row.file}${result.why ? `: ${result.why}` : ''}\n`);
}
rmSync(scratch, { recursive: true, force: true });
process.stdout.write(`${rows.length - bad} of ${rows.length} guards removed made their test fail\n`);
process.exit(bad === 0 ? 0 : 1);
