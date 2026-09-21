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

test('slugify keeps the letters NFKD does not decompose: ł, ø, ß and the like become their plain-Latin spelling, not a hole', async () => {
  const { slugify } = await import(new URL('../jarl.mjs', import.meta.url).href);
  assert.equal(slugify('gałęzi całą dosłownie'), 'galezi-cala-doslownie');
  assert.equal(slugify('Øresund straße'), 'oresund-strasse');
  assert.equal(slugify('Ærø đường þing'), 'aero-duong-thing');
  assert.equal(slugify('plain ASCII stays'), 'plain-ascii-stays');
  assert.equal(slugify('ł'), 'l');
});

test('dropping an issue keeps the evidence already written, and the report prints only the reason', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'thing that goes away');
  jarl(root, 'evidence', '001', 'tried a fix, saw it hang');
  jarl(root, 'set', '001', 'dropped', 'the client said not now');
  const shown = jarl(root, 'show', '001');
  assert.match(shown, /tried a fix, saw it hang/, 'the evidence written before the drop is still there');
  assert.match(shown, /Dropped: the client said not now/);
  const report = jarl(root, 'report');
  assert.match(report, /## Dropped \(1\)\n- 001 thing that goes away — the client said not now/);
  assert.doesNotMatch(report, /tried a fix/, 'the report carries the reason, not the notes');
  // An issue with no evidence yet reads the same as before.
  jarl(root, 'new', 'never started');
  jarl(root, 'set', '002', 'dropped', 'duplicate of 001');
  assert.match(jarl(root, 'report'), /- 002 never started — duplicate of 001/);
});

test('deferred is its own status: it needs a reason, stays out of the default list, is counted apart and reported apart', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'waits for the client');
  jarl(root, 'new', 'still to do');
  jarl(root, 'new', 'gone for good');
  assert.match(refuses(root, 'set', '001', 'deferred'), /deferred needs a reason/);
  jarl(root, 'evidence', '001', 'half a fix on a branch');
  jarl(root, 'set', '001', 'deferred', 'the client wants to decide first');
  jarl(root, 'set', '003', 'dropped', 'duplicate');
  // Not in the default list, in --status deferred and in --all.
  assert.doesNotMatch(jarl(root, 'list'), /waits for the client/);
  assert.match(jarl(root, 'list', '--status', 'deferred'), /waits for the client/);
  assert.match(jarl(root, 'list', '--all'), /waits for the client/);
  // Counted apart from open and dropped.
  const status = JSON.parse(jarl(root, 'status', '--json'));
  assert.equal(status.deferred, 1);
  assert.equal(status.dropped, 1);
  assert.equal(status.open, 1);
  assert.match(jarl(root, 'status'), /deferred 1/);
  // Reported apart, with the reason, and the evidence already written stays.
  const report = jarl(root, 'report');
  assert.match(report, /## Deferred \(1\)\n- 001 waits for the client — the client wants to decide first/);
  assert.match(report, /## Dropped \(1\)\n- 003 gone for good — duplicate/);
  assert.match(jarl(root, 'show', '001'), /half a fix on a branch/);
  // A loop with only deferred work left can close, and says what it leaves waiting.
  jarl(root, 'set', '002', 'dropped', 'no longer needed');
  const closed = JSON.parse(jarl(root, 'close', '--json'));
  assert.deepEqual(closed.deferred, ['001']);
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
  jarl(root, 'init', 'goal', '--committed');
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

test('check matches a declared file relative to a subdirectory, not just the repo root', () => {
  const root = repo();
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('rm', ['-rf', join(root, '.git')]);
  g('init', '-q', '-b', 'feature');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  mkdirSync(join(root, 'skills', 'x'), { recursive: true });
  execFileSync('bash', ['-c', `cd ${root} && echo one > skills/x/SKILL.md && git add -A && git commit -qm base`]);
  jarl(root, 'init', 'goal', '--committed');
  jarl(root, 'new', 'change the skill body', '--files', 'SKILL.md');
  execFileSync('bash', ['-c', `cd ${root} && git add -A && git commit -qm jarl && git checkout -qb jarl/001-change-the-skill-body && echo two > skills/x/SKILL.md && git add -A && git commit -qm work && git checkout -q feature`]);
  const out = JSON.parse(jarl(root, 'check', '001', '--branch', 'jarl/001-change-the-skill-body', '--base', 'feature', '--json'));
  const byName = Object.fromEntries(out.items.map((i) => [i.name, i]));
  assert.equal(byName['diff inside declared files'].ok, true, byName['diff inside declared files'].note);
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
  jarl(root, 'init', 'goal', '--committed');
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

test('free-text evidence appends, it never overwrites earlier evidence', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'thing');
  jarl(root, 'evidence', '001', 'first note');
  jarl(root, 'evidence', '001', 'second note');
  const shown = jarl(root, 'show', '001');
  assert.ok(shown.indexOf('first note') > -1 && shown.indexOf('first note') < shown.indexOf('second note'), 'both notes kept, in order');
  jarl(root, 'new', 'merged thing');
  jarl(root, 'evidence', '002', '--ran', 'npm test', '--saw', '12 pass');
  jarl(root, 'evidence', '002', 'check green, merged abc1234');
  const merged = jarl(root, 'show', '002');
  assert.match(merged, /\*\*ran:\*\* npm test · \*\*saw:\*\* 12 pass/, "the worker's row survives the merger's note");
  assert.match(merged, /merged abc1234/);
});

test('repeated --ran/--saw in one call produce one row per pair, not a comma-joined mess', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'thing');
  jarl(root, 'evidence', '001', '--ran', 'cmd one', '--saw', 'result one', '--ran', 'cmd two', '--saw', 'result two');
  const shown = jarl(root, 'show', '001');
  assert.match(shown, /^- \*\*ran:\*\* cmd one · \*\*saw:\*\* result one$/m);
  assert.match(shown, /^- \*\*ran:\*\* cmd two · \*\*saw:\*\* result two$/m);
  const log = readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
  assert.match(log, /001 evidence row · cmd one$/m);
  assert.match(log, /001 evidence row · cmd two$/m);
  assert.match(refuses(root, 'evidence', '001', '--ran', 'a', '--ran', 'b', '--saw', 'only one'), /must repeat the same number of times/);
  assert.match(refuses(root, 'evidence', '001', '--ran', '--saw', 'x'), /needs both --ran/);
});

// A real repository, not the fake .git directory repo() makes: these tests ask git itself what it sees.
function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-git-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'feature');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  g('config', 'core.excludesFile', '/dev/null');
  execFileSync('bash', ['-c', `cd ${dir} && echo a > a.txt && git add -A && git commit -qm base`]);
  return { dir, g };
}

test('init keeps the loop out of git by default: .jarl/.gitignore holds exactly * and **/*', () => {
  const { dir: root, g } = gitRepo();
  jarl(root, 'init', 'goal');
  assert.equal(readFileSync(join(root, '.jarl', '.gitignore'), 'utf8'), '*\n**/*\n');
  jarl(root, 'new', 'thing', '--files', 'a.txt');
  jarl(root, 'evidence', '001', '--ran', 'npm test', '--saw', '1 pass');
  jarl(root, 'evidence', '001', 'merged abc1234');
  assert.equal(g('status', '--porcelain'), '', 'git status shows nothing from .jarl/');
  assert.equal(g('status', '--porcelain', '--untracked-files=all'), '', 'not even file by file');
  g('add', '-A');
  assert.equal(g('ls-files', '.jarl'), '', 'git add -A stages nothing from .jarl/');
});

test('init --committed writes no .gitignore and git sees the loop; an existing loop is never given one', () => {
  const { dir: root, g } = gitRepo();
  const opened = JSON.parse(jarl(root, 'init', 'goal', '--committed', '--json'));
  assert.equal(opened.committed, true);
  assert.match(refuses(gitRepo().dir, 'init', '--committed', 'goal'), /--committed takes no value/);
  assert.equal(existsSync(join(root, '.jarl', '.gitignore')), false);
  jarl(root, 'new', 'thing');
  jarl(root, 'evidence', '001', 'note');
  const seen = g('status', '--porcelain', '--untracked-files=all');
  assert.match(seen, /^\?\? \.jarl\/goal\.md$/m);
  assert.match(seen, /^\?\? \.jarl\/issues\/001-thing\.md$/m);
  g('add', '-A');
  assert.match(g('ls-files', '.jarl'), /\.jarl\/log\.md/);
  assert.match(refuses(root, 'init', 'again'), /already exists/);
  assert.equal(existsSync(join(root, '.jarl', '.gitignore')), false, 'no command after init adds the ignore file to a loop that has none');
});

test('init --permanent commits the loop and marks it as a record; close then keeps the directory but still refuses while open', () => {
  const root = repo();
  const opened = JSON.parse(jarl(root, 'init', 'goal', '--permanent', '--json'));
  assert.equal(opened.committed, true, 'a permanent record is always committed, like --committed');
  assert.equal(opened.permanent, true);
  assert.equal(existsSync(join(root, '.jarl', '.gitignore')), false);
  assert.equal(existsSync(join(root, '.jarl', '.permanent')), true, 'the marker a later session reads to tell the mode');
  assert.match(refuses(repo(), 'init', '--permanent', 'goal'), /--permanent takes no value/);
  jarl(root, 'new', 'thing');
  assert.match(refuses(root, 'close'), /still open/, 'the open-issue refusal is unchanged in the permanent mode');
  jarl(root, 'set', '001', 'dropped', 'out of scope');
  jarl(root, 'close');
  assert.equal(existsSync(join(root, '.jarl')), true, 'a permanent loop keeps its directory once clean');
  assert.equal(existsSync(join(root, '.jarl', 'issues', '001-thing.md')), true);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /closed · kept as a permanent record/);
});

test('mode permanent turns an existing committed loop into a permanent record; a committed loop becomes permanent and close then keeps it', () => {
  const root = repo();
  jarl(root, 'init', 'goal', '--committed');
  assert.equal(existsSync(join(root, '.jarl', '.permanent')), false, 'committed, not yet permanent');
  const out = JSON.parse(jarl(root, 'mode', 'permanent', '--json'));
  assert.equal(out.permanent, true);
  assert.equal(existsSync(join(root, '.jarl', '.permanent')), true);
  assert.equal(existsSync(join(root, '.jarl', '.gitignore')), false, 'still committed, as it always was');
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /mode → permanent/);
  jarl(root, 'new', 'thing');
  jarl(root, 'set', '001', 'dropped', 'out of scope');
  jarl(root, 'close');
  assert.equal(existsSync(join(root, '.jarl')), true, 'a loop switched to permanent keeps its directory on close, like one opened with init --permanent');
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /closed · kept as a permanent record/);
});

test('mode permanent refuses a default-mode loop (out of git) and explains why', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  assert.equal(existsSync(join(root, '.jarl', '.gitignore')), true);
  assert.match(refuses(root, 'mode', 'permanent'), /out of git.*must be committed/s);
  assert.equal(existsSync(join(root, '.jarl', '.permanent')), false, 'refused, nothing written');
});

test('mode permanent on an already permanent loop refuses clearly instead of silently repeating', () => {
  const root = repo();
  jarl(root, 'init', 'goal', '--permanent');
  assert.match(refuses(root, 'mode', 'permanent'), /already a permanent record/);
});

test('a branch loop, default or --committed, still removes the directory on close', () => {
  for (const args of [[], ['--committed']]) {
    const root = repo();
    jarl(root, 'init', 'goal', ...args);
    jarl(root, 'new', 'thing');
    jarl(root, 'set', '001', 'dropped', 'out of scope');
    jarl(root, 'close');
    assert.equal(existsSync(join(root, '.jarl')), false);
  }
});

// A loop that keeps its issues in one repository while its workers change another: two real
// repositories side by side, the loop in "hub" on main, the code and the worker branch in "tool" on feature.
test('check, branches and handoff read the repository an issue names, not the loop\'s own, in both loop modes', () => {
  for (const committed of [false, true]) {
    const parent = mkdtempSync(join(tmpdir(), 'jarl-two-'));
    const hub = join(parent, 'hub'); const tool = join(parent, 'tool');
    mkdirSync(hub); mkdirSync(tool);
    const sh = (cwd, script) => execFileSync('bash', ['-c', script], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const setup = (b) => `git init -q -b ${b} && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null`;
    sh(hub, `${setup('main')} && echo notes > notes.md && git add -A && git commit -qm base`);
    sh(tool, `${setup('feature')} && mkdir src tests && echo 'export const a = 1;' > src/a.mjs && printf 'assert.equal(1,1);\\n' > tests/a.test.mjs && git add -A && git commit -qm base`);
    jarl(hub, 'init', 'goal', ...(committed ? ['--committed'] : []));
    jarl(hub, 'new', 'change a', '--files', 'src/a.mjs,tests/a.test.mjs', '--repo', '../tool');
    jarl(hub, 'new', 'other', '--files', 'src/a.mjs');
    if (committed) sh(hub, 'git add -A && git commit -qm jarl');
    sh(tool, `git worktree add -q -b jarl/001-change-a ${parent}/wt-001 && cd ${parent}/wt-001 && echo 'export const a = 2;' > src/a.mjs && printf 'assert.equal(1,1);\\nassert.equal(2,2);\\n' > tests/a.test.mjs && git add -A && git commit -qm work`);
    const mode = committed ? 'committed' : 'default';

    // The issue's Repo field: the branch, its base and its files all come from the tool repository.
    const out = JSON.parse(jarl(hub, 'check', '001', '--branch', 'jarl/001-change-a', '--json'));
    const byName = Object.fromEntries(out.items.map((i) => [i.name, i]));
    assert.equal(out.base, 'feature', `${mode}: the base is the tool repository's current branch, not the hub's`);
    assert.equal(out.mergeBase, sh(tool, 'git rev-parse feature'), mode);
    assert.equal(byName['commits beyond base'].ok, true, byName['commits beyond base'].note);
    assert.match(byName['commits beyond base'].note, /^1 commit\(s\) on jarl\/001-change-a/);
    assert.deepEqual(out.changed, ['src/a.mjs', 'tests/a.test.mjs']);
    assert.equal(byName['diff inside declared files'].ok, true, byName['diff inside declared files'].note);
    assert.equal(byName['assertions in touched tests'].note, '1 → 2');
    assert.equal(out.ok, true, mode);
    assert.match(jarl(hub, 'show', '001'), /^\*\*Repo:\*\* \.\.\/tool$/m);
    assert.doesNotMatch(jarl(hub, 'show', '002'), /\*\*Repo:\*\*/, 'an issue that names no repository carries no Repo line');

    // --repo on the command does the same for an issue that names no repository; without it, the loop's own repository is read, as before.
    assert.match(refuses(hub, 'check', '002', '--branch', 'jarl/001-change-a'), /no such branch/);
    assert.equal(JSON.parse(jarl(hub, 'check', '002', '--branch', 'jarl/001-change-a', '--repo', '../tool', '--json')).ok, true, mode);
    assert.match(refuses(hub, 'check', '001', '--branch', 'jarl/001-change-a', '--repo', '../nowhere'), /not a git repository/);
    jarl(hub, 'repo', '002', '../tool');
    assert.match(jarl(hub, 'show', '002'), /^\*\*Repo:\*\* \.\.\/tool$/m);
    assert.equal(JSON.parse(jarl(hub, 'check', '002', '--branch', 'jarl/001-change-a', '--json')).base, 'feature', mode);

    // branches lists the worker branch in the tool repository, and the hub's own listing stays empty.
    const rows = JSON.parse(jarl(hub, 'branches', '--repo', '../tool', '--json'));
    assert.deepEqual(rows.map((r) => r.branch), ['jarl/001-change-a'], mode);
    assert.equal(rows[0].ahead, 1);
    assert.ok(rows[0].worktree.endsWith('wt-001'), rows[0].worktree);
    assert.equal(rows[0].dirty, 0);
    assert.deepEqual(JSON.parse(jarl(hub, 'branches', '--json')), [], `${mode}: the hub itself has no worker branches`);

    // The handoff records where the tool repository stands, beside the hub's own head.
    jarl(hub, 'set', '001', 'in-progress', 'worker raised in tool');
    jarl(hub, 'handoff', 'write', '--summary', 'one in flight in tool');
    assert.match(jarl(hub, 'handoff', 'read'), new RegExp(`\\*\\*Head:\\*\\* main@[0-9a-f]+ · \\*\\*Head in \\.\\./tool:\\*\\* feature@${sh(tool, 'git rev-parse --short feature')}`));

    assert.equal(sh(tool, 'git status --porcelain --untracked-files=all'), '', `${mode}: the loop never writes into the tool repository`);
  }
});

// Real repositories beside a hub that holds the loop; each is a git repository on its own branch.
function reposBeside(...names) {
  const parent = mkdtempSync(join(tmpdir(), 'jarl-many-'));
  const sh = (cwd, script) => execFileSync('bash', ['-c', script], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const dirs = {};
  for (const name of ['hub', ...names]) {
    const dir = join(parent, name);
    mkdirSync(dir, { recursive: true });
    sh(dir, `git init -q -b ${name === 'hub' ? 'main' : 'feature'} && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null && mkdir src tests && echo 'export const a = 1;' > src/a.mjs && echo 'export const b = 1;' > src/b.mjs && printf 'assert.equal(1,1);\\n' > tests/a.test.mjs && echo '# Changelog' > CHANGELOG.md && git add -A && git commit -qm base`);
    dirs[name] = dir;
  }
  return { parent, sh, ...dirs };
}

// In a loop over several repositories, an issue that names one writes its files with that
// repository's directory name first. A file is its repository and its path there.
test('next keeps the same path in two repositories apart and still holds a collision inside one', () => {
  const { hub } = reposBeside('tool', 'other', 'vendor/tool');
  jarl(hub, 'init', 'goal');
  jarl(hub, 'new', 'in flight in tool', '--repo', '../tool', '--files', 'tool/CHANGELOG.md,tool/src/a.mjs');
  jarl(hub, 'new', 'same changelog path, other repository', '--repo', '../other', '--files', 'other/CHANGELOG.md');
  jarl(hub, 'new', 'same changelog path, a second repository also named tool', '--repo', '../vendor/tool', '--files', 'tool/CHANGELOG.md');
  jarl(hub, 'new', 'same source file, same repository', '--repo', '../tool/', '--files', 'tool/src/a.mjs');
  jarl(hub, 'new', 'the hub\'s own changelog', '--files', 'CHANGELOG.md');
  jarl(hub, 'new', 'other repository again, behind the first one there', '--repo', '../other', '--files', 'other/CHANGELOG.md');
  jarl(hub, 'set', '001', 'in-progress', 'worker raised in tool');
  const rows = JSON.parse(jarl(hub, 'next', '--json'));
  assert.deepEqual(rows.filter((r) => r.ready).map((r) => r.id), ['002', '003', '005'], 'the same path in another repository never waits');
  assert.deepEqual(rows.find((r) => r.id === '004').waitsOn, ['tool/src/a.mjs'], 'the same file in the same repository still waits, however the Repo path is spelled');
  assert.deepEqual(rows.find((r) => r.id === '006').waitsOn, ['other/CHANGELOG.md'], 'two open issues on one file in one repository do not both run');
  assert.match(jarl(hub, 'next'), /^004 {2}P2 {2}same source file, same repository {2}\(waits on tool\/src\/a\.mjs\)$/m);
});

test('check matches a changed file against the files an issue declares in its own repository', () => {
  const { parent, sh, hub, tool } = reposBeside('tool');
  jarl(hub, 'init', 'goal');
  jarl(hub, 'new', 'change a in tool', '--repo', '../tool', '--files', 'tool/src/a.mjs');
  jarl(hub, 'new', 'change b in tool', '--repo', '../tool', '--files', 'tool/src/b.mjs');
  sh(tool, `git worktree add -q -b jarl/001-change-a-in-tool ${parent}/wt-001 && cd ${parent}/wt-001 && echo 'export const a = 2;' > src/a.mjs && printf 'assert.equal(1,1);\\nassert.equal(2,2);\\n' > tests/a.test.mjs && echo '- a' >> CHANGELOG.md && git add -A && git commit -qm work`);

  const out = JSON.parse(jarl(hub, 'check', '001', '--branch', 'jarl/001-change-a-in-tool', '--json'));
  const byName = Object.fromEntries(out.items.map((i) => [i.name, i]));
  assert.deepEqual(out.changed, ['CHANGELOG.md', 'src/a.mjs', 'tests/a.test.mjs']);
  assert.equal(byName['diff inside declared files'].ok, true, byName['diff inside declared files'].note);
  assert.equal(byName['diff inside declared files'].note, '3 file(s), all inside');
  assert.equal(out.ok, true);
  assert.match(jarl(hub, 'check', '001', '--branch', 'jarl/001-change-a-in-tool'), /^✓ diff inside declared files — 3 file\(s\), all inside$/m);

  // Dropping the name does not widen the scope: another file of the same repository stays outside.
  let other;
  try { jarl(hub, 'check', '002', '--branch', 'jarl/001-change-a-in-tool', '--json'); } catch (e) { other = JSON.parse(e.stdout); }
  const otherByName = Object.fromEntries(other.items.map((i) => [i.name, i]));
  assert.equal(otherByName['diff inside declared files'].ok, false);
  assert.equal(otherByName['diff inside declared files'].note, 'outside tool/src/b.mjs: src/a.mjs');
});

test('ask kinds are closed; lower needs a target', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  assert.match(refuses(root, 'ask', 'what now', '--kind', 'panic'), /--kind must be one of/);
  assert.match(refuses(root, 'ask', 'weaken what', '--kind', 'lower'), /--target is required for kind lower/);
  const a = JSON.parse(jarl(root, 'ask', 'drop this test?', '--kind', 'lower', '--target', 'coverage-check', '--json'));
  assert.equal(a.kind, 'lower');
  const asks = JSON.parse(jarl(root, 'ask', 'plain question', '--json'));
  assert.equal(asks.kind, 'stuck');
  assert.match(refuses(root, 'ask', 'x', '--kind', 'stop', '--target', 'y'), /--target has no meaning/);
});

test('review changes requires a Critical or Important finding; Minor alone is rejected', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'thing');
  assert.match(refuses(root, 'review', '001', 'changes', 'looks a bit off'), /needs at least one finding ranked/);
  assert.match(refuses(root, 'review', '001', 'changes', 'Minor: naming could be better'), /Minor alone goes to evidence/);
  jarl(root, 'review', '001', 'changes', 'Important: the new test never goes red');
  jarl(root, 'evidence', '001', 'fixed');
  jarl(root, 'review', '001', 'approve', 'Minor: could still tidy the naming, but fine to land');
  jarl(root, 'set', '001', 'done');
});
