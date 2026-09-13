import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-'));
  mkdirSync(join(dir, '.git'));
  return dir;
}
function jarl(root, ...args) {
  return execFileSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8' }).trim();
}
function refuses(root, ...args) {
  try { jarl(root, ...args); } catch (e) { return String(e.stderr); }
  throw new Error('expected a refusal');
}

test('init, new, list, show', () => {
  const root = repo();
  jarl(root, 'init', 'make the export command handle every fixture');
  assert.ok(existsSync(join(root, '.jarl', 'goal.md')));
  const a = JSON.parse(jarl(root, 'new', 'parser refuses fixture three', '--kind', 'bug', '--prio', '1', '--tags', 'parser', '--files', 'src/parser.mjs', '--json'));
  const b = JSON.parse(jarl(root, 'new', 'docs promise a flag that does not exist', '--kind', 'docs', '--json'));
  assert.equal(a.id, '001'); assert.equal(b.id, '002');
  const rows = JSON.parse(jarl(root, 'list', '--json'));
  assert.deepEqual(rows.map((r) => r.id), ['001', '002']);
  assert.equal(JSON.parse(jarl(root, 'list', '--tag', 'parser', '--json')).length, 1);
  assert.equal(JSON.parse(jarl(root, 'list', '--grep', 'flag that does not', '--json')).length, 1);
  assert.match(jarl(root, 'show', '1'), /^# 001 · parser refuses fixture three/);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /filed 001/);
});

test('status moves only with a log line; done needs evidence; dropped needs a reason', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'thing');
  assert.match(refuses(root, 'set', '001', 'done'), /no evidence yet/);
  assert.match(refuses(root, 'set', '001', 'dropped'), /needs a reason/);
  jarl(root, 'set', '001', 'in-progress', 'worker raised');
  jarl(root, 'evidence', '001', 'npm test → 12 pass, 0 fail');
  assert.match(refuses(root, 'set', '001', 'done'), /no approving review/);
  jarl(root, 'review', '001', 'changes', 'Important: the new test never goes red');
  assert.match(refuses(root, 'set', '001', 'done'), /no approving review/);
  jarl(root, 'review', '001', 'approve', 'read the diff; test red before, green after');
  jarl(root, 'set', '001', 'done');
  const log = readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
  assert.match(log, /001 → in-progress · worker raised/);
  assert.match(log, /001 → done/);
  assert.match(readFileSync(join(root, '.jarl', 'issues', '001-thing.md'), 'utf8'), /\*\*Status:\*\* done/);
  assert.match(refuses(root, 'set', '001', 'verified'), /status must be one of/);
});

test('tags, priority and next respect file overlap', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'one', '--files', 'a.mjs', '--prio', '3');
  jarl(root, 'new', 'two', '--files', 'a.mjs,b.mjs', '--prio', '1');
  jarl(root, 'new', 'three', '--files', 'c.mjs');
  jarl(root, 'tag', '001', '+parser', '+docs', '-parser');
  assert.match(jarl(root, 'show', '001'), /\*\*Tags:\*\* docs/);
  jarl(root, 'prio', '003', '1');
  const next = JSON.parse(jarl(root, 'next', '--json'));
  assert.deepEqual(next.filter((r) => r.ready).map((r) => r.id), ['002', '003']);
  assert.deepEqual(next.find((r) => r.id === '001').waitsOn, ['a.mjs']);
  jarl(root, 'set', '002', 'in-progress', 'raised');
  assert.deepEqual(JSON.parse(jarl(root, 'next', '--json')).filter((r) => r.ready).map((r) => r.id), ['003']);
});

test('decide refuses a duplicate slug; close refuses while open, removes when clean', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'decide', 'no-new-constants', 'every number needs an origin');
  assert.match(refuses(root, 'decide', 'no-new-constants', 'again'), /duplicate slug/);
  jarl(root, 'new', 'thing');
  assert.match(refuses(root, 'close'), /still open/);
  jarl(root, 'set', '001', 'dropped', 'out of scope');
  assert.match(jarl(root, 'status'), /dropped 1/);
  jarl(root, 'close');
  assert.equal(existsSync(join(root, '.jarl')), false);
});

test('tier field, rounds and takeover, asks and answers, handoff, report', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  assert.match(refuses(root, 'new', 'x', '--tier', 'huge'), /--tier must be one of/);
  jarl(root, 'new', 'hard thing', '--tier', 'strong', '--found-by', 'tester, running the suite');
  assert.match(jarl(root, 'show', '001'), /\*\*Tier:\*\* strong/);
  assert.match(jarl(root, 'round', '001', 'suite red'), /round 1 of 3/);
  jarl(root, 'round', '001', 'still red');
  const r = JSON.parse(jarl(root, 'round', '001', 'red again', '--json'));
  assert.equal(r.takeover, true);
  assert.match(r.block, /attempted issue 001 3 times/);
  const a = JSON.parse(jarl(root, 'ask', 'keep the old flag?', '--issue', '1', '--json'));
  assert.equal(a.id, '001');
  assert.match(jarl(root, 'status'), /questions 1/);
  jarl(root, 'answer', 'a-001', 'yes, keep it');
  assert.match(readFileSync(join(root, '.jarl', 'decisions.md'), 'utf8'), /ask-001[\s\S]*yes, keep it/);
  assert.match(refuses(root, 'answer', '001', 'again'), /already answered/);
  assert.match(jarl(root, 'handoff', 'read'), /fresh start/);
  jarl(root, 'set', '001', 'in-progress', 'raised');
  jarl(root, 'handoff', 'write', '--summary', 'one in flight', '--next', 'merge 001', '--next', 'file the rest');
  const h = jarl(root, 'handoff', 'read');
  assert.match(h, /- 001 hard thing/);
  assert.match(h, /- merge 001\n- file the rest/);
  const rep = jarl(root, 'report');
  assert.match(rep, /Found along the way \(1\)/);
});

test('check reads a worker branch: commits, declared files, removed tests, assertions', () => {
  const root = repo();
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('rm', ['-rf', join(root, '.git')]);
  g('init', '-q', '-b', 'feature');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'tests'));
  execFileSync('bash', ['-c', `cd ${root} && echo 'export const a = 1;' > src/a.mjs && printf 'assert.equal(1,1);\\nassert.equal(2,2);\\n' > tests/a.test.mjs && git add -A && git commit -qm base`]);
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'change a', '--files', 'src/a.mjs,tests/a.test.mjs');
  execFileSync('bash', ['-c', `cd ${root} && git add -A && git commit -qm jarl && git checkout -qb jarl/001-change-a && echo 'export const a = 2;' > src/a.mjs && printf 'assert.equal(1,1);\\n' > tests/a.test.mjs && echo x > src/b.mjs && echo '- entry' >> CHANGELOG.md && echo 'export {};' > tests/new.test.mjs && git add -A && git commit -qm work && git checkout -q feature`]);
  let out;
  try { jarl(root, 'check', '001', '--branch', 'jarl/001-change-a', '--base', 'feature', '--json'); } catch (e) { out = JSON.parse(e.stdout); }
  assert.equal(out.ok, false);
  const byName = Object.fromEntries(out.items.map((i) => [i.name, i]));
  assert.equal(byName['commits beyond base'].ok, true);
  assert.match(byName['diff inside declared files'].note, /src\/b\.mjs/);
  assert.doesNotMatch(byName['diff inside declared files'].note, /CHANGELOG|new\.test/, 'changelog and tests are never outside scope');
  assert.equal(byName['assertions in touched tests'].note, '2 → 1');
  assert.equal(byName['test files'].ok, true);
});

test('a round after an approve spends the approve', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'thing');
  jarl(root, 'evidence', '001', 'suite green');
  jarl(root, 'review', '001', 'approve', 'fine');
  jarl(root, 'round', '001', 'merger: suite red after merge');
  assert.match(refuses(root, 'set', '001', 'done'), /no approving review/);
  assert.match(refuses(root, 'review', '001', 'maybe', 'x'), /approve\|changes/);
  jarl(root, 'review', '001', 'approve', 'fixed');
  jarl(root, 'set', '001', 'done');
});

test('branches lists a worktree branch a worker never renamed, marked unnamed', () => {
  const root = repo();
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('rm', ['-rf', join(root, '.git')]);
  g('init', '-q', '-b', 'feature'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  execFileSync('bash', ['-c', `cd ${root} && echo a > a.txt && git add -A && git commit -qm base`]);
  jarl(root, 'init', 'goal');
  execFileSync('bash', ['-c', `cd ${root} && git add -A && git commit -qm jarl && git worktree add -q -b worktree-agent-x ${root}/.wt-x && cd ${root}/.wt-x && echo b > b.txt && git add -A && git commit -qm work`]);
  const rows = JSON.parse(jarl(root, 'branches', '--base', 'feature', '--json'));
  const row = rows.find((r) => r.branch === 'worktree-agent-x');
  assert.ok(row, 'the unnamed worktree branch is listed');
  assert.equal(row.ahead, 1); assert.equal(row.unnamed, true);
  assert.match(jarl(root, 'branches', '--base', 'feature'), /UNNAMED/);
});

test('evidence accepts free text or structured rows; rows are readable back', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'thing');
  jarl(root, 'evidence', '001', '--ran', 'npm test', '--saw', '12 pass, 0 fail');
  jarl(root, 'evidence', '001', '--ran', 'node --test tests/a.test.mjs', '--saw', '3 pass');
  assert.match(jarl(root, 'show', '001'), /\*\*ran:\*\* npm test · \*\*saw:\*\* 12 pass, 0 fail/);
  assert.match(refuses(root, 'evidence', '001', '--ran', 'x'), /needs both --ran/);
  jarl(root, 'review', '001', 'approve', 'fine');
  jarl(root, 'set', '001', 'done');
});
