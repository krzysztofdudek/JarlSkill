import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const { JARL_GITIGNORE_COMMITTED } = await import(new URL('../jarl.mjs', import.meta.url).href);

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

// In the default mode the loop lives in the main checkout and a worktree cannot see it. The tool used to need
// `--root <main checkout>` from every worktree; now a run in a worktree of a repository whose main checkout
// holds a loop finds that loop by itself, and an explicit --root still wins.
function gitRepoWithWorktree() {
  const main = mkdtempSync(join(tmpdir(), 'jarl-main-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
  git(main, 'init', '-q', '-b', 'feature');
  writeFileSync(join(main, 'a.txt'), 'a\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'init');
  const wt = join(mkdtempSync(join(tmpdir(), 'jarl-wt-')), 'worker');
  git(main, 'worktree', 'add', '-q', '-b', 'jarl/001-thing', wt);
  return { main, wt, git };
}
const jarlIn = (cwd, ...args) => execFileSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' }).trim();

test('a run in a worktree finds the loop in the main checkout by itself, and an explicit --root still wins', () => {
  const { main, wt, git } = gitRepoWithWorktree();
  jarl(main, 'init', 'goal');
  jarl(main, 'new', 'thing to fix');
  // No --root: the worktree has no .jarl/ of its own, the main checkout does.
  assert.match(jarlIn(wt, 'list'), /thing to fix/);
  assert.equal(JSON.parse(jarlIn(wt, 'show', '001', '--json')).title, 'thing to fix');
  jarlIn(wt, 'evidence', '001', 'ran it in the worktree');
  assert.match(jarl(main, 'show', '001'), /ran it in the worktree/, 'the write landed in the main checkout\'s loop');
  // check and branches read the repository from there too.
  git(wt, 'commit', '-q', '--allow-empty', '-m', 'worker change');
  assert.match(jarlIn(wt, 'branches'), /jarl\/001-thing/);
  const checked = JSON.parse(jarlIn(wt, 'check', '001', '--branch', 'jarl/001-thing', '--json'));
  assert.match(checked.items.find((i) => i.name === 'commits beyond base').note, /1 commit\(s\) on jarl\/001-thing beyond/);
  // Explicit --root wins, even one that has no loop.
  const elsewhere = repo();
  assert.match(String(refuses(elsewhere, 'new', 'x')), /no \.jarl\//);
  assert.match(execFileSync(process.execPath, [SCRIPT, 'list', '--root', main], { cwd: wt, encoding: 'utf8' }), /thing to fix/);
  // A worktree of a repository whose main checkout has no loop still says so plainly.
  const bare = gitRepoWithWorktree();
  assert.throws(() => execFileSync(process.execPath, [SCRIPT, 'new', 'x'], { cwd: bare.wt, encoding: 'utf8', stdio: 'pipe' }), (e) => /no \.jarl\//.test(String(e.stderr)));
});

test('a repository is named by its root, not a subdirectory of it, and the Repo field can be cleared', () => {
  const parent = mkdtempSync(join(tmpdir(), 'jarl-repo-'));
  const hub = join(parent, 'hub'); const tool = join(parent, 'tool');
  mkdirSync(hub); mkdirSync(join(tool, 'src'), { recursive: true });
  const sh = (cwd, script) => execFileSync('bash', ['-c', script], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const setup = (b) => `git init -q -b ${b} && git config user.email t@t && git config user.name t`;
  sh(hub, `${setup('main')} && echo notes > notes.md && git add -A && git commit -qm base`);
  sh(tool, `${setup('feature')} && echo 'x' > src/a.mjs && git add -A && git commit -qm base`);
  jarl(hub, 'init', 'goal');
  jarl(hub, 'new', 'change a', '--files', 'src/a.mjs');
  // A subdirectory of a repository is not the repository: its paths would be read from the wrong place, so a
  // removed test file would go unseen. Refused everywhere a repository is named, naming the root to give instead.
  assert.match(refuses(hub, 'repo', '001', '../tool/src'), /is inside the repository at .*tool, not its root — name the root: \.\.\/tool/);
  assert.match(refuses(hub, 'new', 'other', '--repo', '../tool/src'), /not its root/);
  assert.match(refuses(hub, 'branches', '--repo', '../tool/src'), /not its root/);
  assert.match(refuses(hub, 'check', '001', '--branch', 'feature', '--repo', '../tool/src'), /not its root/);
  // The root itself is fine, and the field can be cleared again.
  jarl(hub, 'repo', '001', '../tool');
  assert.match(jarl(hub, 'show', '001'), /^\*\*Repo:\*\* \.\.\/tool$/m);
  assert.match(jarl(hub, 'repo', '001', '--clear'), /001 repo: cleared/);
  assert.doesNotMatch(jarl(hub, 'show', '001'), /\*\*Repo:\*\*/);
  assert.match(refuses(hub, 'repo', '001', '--clear'), /no Repo field/);
});

// Files are compared as (repository, path) pairs; three ways the pair used to be read wrongly, each silently.
test('the repository name in Files: --repo strips it like the field does, an inner directory of the same name is not stripped, and a repository is one repository however its path is spelled', () => {
  const parent = mkdtempSync(join(tmpdir(), 'jarl-name-'));
  const hub = join(parent, 'hub'); const tool = join(parent, 'tool'); const app = join(parent, 'app');
  mkdirSync(hub); mkdirSync(join(tool, 'src'), { recursive: true }); mkdirSync(join(app, 'app'), { recursive: true });
  const sh = (cwd, script) => execFileSync('bash', ['-c', script], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const setup = (b) => `git init -q -b ${b} && git config user.email t@t && git config user.name t`;
  sh(hub, `${setup('main')} && echo notes > notes.md && git add -A && git commit -qm base`);
  sh(tool, `${setup('feature')} && echo x > src/a.mjs && git add -A && git commit -qm base`);
  sh(app, `${setup('feature')} && echo x > app/x.mjs && git add -A && git commit -qm base`);
  sh(tool, `git worktree add -q -b jarl/001-a ${parent}/wt-001 && cd ${parent}/wt-001 && echo y > src/a.mjs && git commit -qam change`);
  jarl(hub, 'init', 'goal');

  // 1. `check --repo` on an issue with no Repo field strips the name as the field would: tool/src/a.mjs is src/a.mjs.
  jarl(hub, 'new', 'change a', '--files', 'tool/src/a.mjs');
  const byRepoFlag = JSON.parse(jarl(hub, 'check', '001', '--branch', 'jarl/001-a', '--repo', '../tool', '--json'));
  const scope = byRepoFlag.items.find((i) => i.name === 'diff inside declared files');
  assert.equal(scope.ok, true, scope.note);

  // 2. In a repository that has a directory of its own name, the prefix is required: `app/app/x.mjs` is app/x.mjs
  // inside the repository app, and `app/x.mjs` already IS that path, so the two meet in next instead of passing.
  jarl(hub, 'new', 'first on app/x', '--files', 'app/app/x.mjs', '--repo', '../app');
  jarl(hub, 'new', 'second on app/x', '--files', 'app/x.mjs', '--repo', '../app');
  jarl(hub, 'set', '002', 'in-progress', 'worker raised');
  const next = JSON.parse(jarl(hub, 'next', '--json'));
  assert.deepEqual(next.find((r) => r.id === '003').waitsOn, ['app/x.mjs'], 'the same file in one repository always holds an issue back');

  // 3. One repository however its path is spelled: through a symlink, and (where the file system ignores case) in
  // another case.
  const spellings = ['../link'];
  execFileSync('ln', ['-s', tool, join(parent, 'link')]);
  if (existsSync(join(parent, 'TOOL'))) spellings.push('../TOOL');
  jarl(hub, 'new', 'holds src/a.mjs', '--files', 'tool/src/b.mjs', '--repo', '../tool');
  jarl(hub, 'set', '004', 'in-progress', 'worker raised');
  spellings.forEach((spelling, k) => {
    const id = String(5 + k).padStart(3, '0');
    jarl(hub, 'new', `spelled ${spelling}`, '--files', `${spelling.replace('../', '')}/src/b.mjs`, '--repo', spelling);
    const row = JSON.parse(jarl(hub, 'next', '--json')).find((r) => r.id === id);
    assert.ok(row && row.waitsOn, `${spelling}: the same repository, so the same file, so it waits`);
  });
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

test('init --committed ignores only the lock and temporary files, and git sees the loop', () => {
  const { dir: root, g } = gitRepo();
  const opened = JSON.parse(jarl(root, 'init', 'goal', '--committed', '--json'));
  assert.equal(opened.committed, true);
  // --committed takes no value, so the goal after it is the goal, not the flag's value.
  const before = gitRepo().dir;
  assert.equal(JSON.parse(jarl(before, 'init', '--committed', 'goal first', '--json')).committed, true);
  assert.match(readFileSync(join(before, '.jarl', 'goal.md'), 'utf8'), /goal first/);
  assert.match(refuses(gitRepo().dir, 'init', 'goal', '--committed=yes'), /--committed takes no value/);
  assert.equal(readFileSync(join(root, '.jarl', '.gitignore'), 'utf8'), JARL_GITIGNORE_COMMITTED);
  jarl(root, 'new', 'thing');
  jarl(root, 'evidence', '001', 'note');
  const seen = g('status', '--porcelain', '--untracked-files=all');
  assert.match(seen, /^\?\? \.jarl\/goal\.md$/m);
  assert.match(seen, /^\?\? \.jarl\/issues\/001-thing\.md$/m);
  g('add', '-A');
  assert.match(g('ls-files', '.jarl'), /\.jarl\/log\.md/);
  assert.match(refuses(root, 'init', 'again'), /already exists/);
  assert.equal(readFileSync(join(root, '.jarl', '.gitignore'), 'utf8'), JARL_GITIGNORE_COMMITTED, 'no command widens it to the default mode');
});

test('init --permanent commits the loop and marks it as a record; close then keeps the directory but still refuses while open', () => {
  const root = repo();
  const opened = JSON.parse(jarl(root, 'init', 'goal', '--permanent', '--json'));
  assert.equal(opened.committed, true, 'a permanent record is always committed, like --committed');
  assert.equal(opened.permanent, true);
  assert.equal(readFileSync(join(root, '.jarl', '.gitignore'), 'utf8'), JARL_GITIGNORE_COMMITTED, 'committed: only the lock and temporary files are ignored');
  assert.equal(existsSync(join(root, '.jarl', '.permanent')), true, 'the marker a later session reads to tell the mode');
  assert.equal(JSON.parse(jarl(repo(), 'init', '--permanent', 'goal', '--json')).permanent, true, 'the goal after --permanent is the goal');
  assert.match(refuses(repo(), 'init', 'goal', '--permanent=yes'), /--permanent takes no value/);
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
  assert.equal(readFileSync(join(root, '.jarl', '.gitignore'), 'utf8'), JARL_GITIGNORE_COMMITTED, 'still committed, as it always was');
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
    assert.equal(rows[0].repo, 'tool');
    // With no --repo, branches looks in the loop's own repository and in every repository an open issue names,
    // each row carrying the repository's name: the hub has no worker branches of its own, the tool repository has one.
    const all = JSON.parse(jarl(hub, 'branches', '--json'));
    assert.deepEqual(all.map((r) => [r.repo, r.branch]), [['tool', 'jarl/001-change-a']], `${mode}: the worker branch in the tool repository is seen from the hub`);
    assert.match(jarl(hub, 'branches'), /^\[tool\] jarl\/001-change-a → 001  \+1 /, mode);
    // Once nothing open or in progress names the tool repository any more, the hub is left with its own.
    jarl(hub, 'set', '001', 'dropped', 'not needed');
    jarl(hub, 'set', '002', 'dropped', 'not needed');
    assert.deepEqual(JSON.parse(jarl(hub, 'branches', '--json')), [], `${mode}: the hub itself has no worker branches`);
    jarl(hub, 'set', '001', 'open', 'back');
    jarl(hub, 'set', '002', 'open', 'back');

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

// A loop is put away with `archive`, not deleted, and a new one opens in its place. Everything but
// the archive and the mode markers moves, so the next loop keeps the same way of living in git.
test('archive puts the loop away under .jarl/archive/<date>-<slug>/, and init opens a new one in the same mode', () => {
  const root = repo();
  jarl(root, 'init', 'first goal');
  jarl(root, 'new', 'left unfinished');
  assert.match(refuses(root, 'init', 'second goal'), /archive it first: jarl\.mjs archive/);

  const out = JSON.parse(jarl(root, 'archive', 'first round', '--json'));
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  assert.equal(out.archived, join(root, '.jarl', 'archive', `${day}-first-round`));
  assert.deepEqual(out.leftOpen, ['001']);
  for (const f of ['goal.md', 'log.md', 'decisions.md', 'issues']) {
    assert.ok(existsSync(join(out.archived, f)), `${f} moved into the archive`);
    assert.ok(!existsSync(join(root, '.jarl', f)), `${f} is no longer live`);
  }
  assert.match(readFileSync(join(out.archived, 'log.md'), 'utf8'), /archived → \.jarl\/archive\/.*first-round · 1 still open or in progress: 001/);
  assert.equal(readFileSync(join(root, '.jarl', '.gitignore'), 'utf8'), '*\n**/*\n', 'the mode marker stays');

  assert.match(refuses(root, 'new', 'into nothing'), /no live loop here — \.jarl\/ holds only archived loops/);
  assert.match(refuses(root, 'close'), /no live loop here/);
  assert.match(refuses(root, 'archive', 'again'), /holds only earlier archives/);

  assert.match(jarl(root, 'init', 'second goal'), /kept out of git/);
  assert.match(jarl(root, 'new', 'fresh work'), /filed 001/);
  const status = jarl(root, 'status');
  assert.match(status, /^goal: second goal$/m);
  assert.match(status, /opened \d{4}-\d{2}-\d{2} \d{2}:\d{2} · last activity \d{4}-\d{2}-\d{2} \d{2}:\d{2} · 1 archived loop\(s\)/);
});

test('a new loop after an archive keeps the archived mode, and a flag that contradicts it is refused', () => {
  const root = repo();
  jarl(root, 'init', 'record', '--permanent');
  jarl(root, 'archive', 'one');
  assert.ok(existsSync(join(root, '.jarl', '.permanent')));
  assert.match(refuses(root, 'init', 'next', '--committed'), /keeps its archived loops in the permanent mode/);
  assert.match(jarl(root, 'init', 'next'), /permanent record/);
  assert.match(refuses(root, 'archive', 'one'), /pick another slug|already exists/);
});

// ---- concurrency: one writer at a time -------------------------------------------------------

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const jarlAsync = (root, ...args) => promisify(execFile)(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8' });

test('20 parallel evidence calls land 20 rows and 20 log lines; 10 parallel new calls get 10 distinct numbers', async () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'target');
  await Promise.all(Array.from({ length: 20 }, (_, n) => jarlAsync(root, 'evidence', '001', '--ran', `w${n}`, '--saw', 'ok')));
  const shown = jarl(root, 'show', '001');
  assert.equal((shown.match(/^- \*\*ran:\*\* w\d+ · \*\*saw:\*\* ok$/gm) || []).length, 20);
  const log = readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
  assert.equal((log.match(/· 001 evidence row · w\d+$/gm) || []).length, 20);
  const filed = await Promise.all(Array.from({ length: 10 }, (_, n) => jarlAsync(root, 'new', `parallel ${n}`, '--json')));
  const ids = filed.map((r) => JSON.parse(r.stdout).id);
  assert.equal(new Set(ids).size, 10, `distinct ids, got ${ids.join(' ')}`);
  assert.deepEqual([...ids].sort(), ['002', '003', '004', '005', '006', '007', '008', '009', '010', '011']);
  assert.equal(existsSync(join(root, '.jarl', '.lock')), false, 'the lock is released after every call');
  const { readdirSync } = await import('node:fs');
  assert.deepEqual(readdirSync(join(root, '.jarl', 'issues')).filter((f) => f.endsWith('.tmp')), [], 'no temporary file is left behind');
});

test('a lock left by a process that is gone is broken; a live holder makes the caller fail loudly, writing nothing', async () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'target');
  const lock = join(root, '.jarl', '.lock');
  const { hostname } = await import('node:os');
  // A pid that cannot be running (above the kernel's pid range).
  writeFileSync(lock, `99999999 ${hostname()} 2026-01-01T00:00:00.000Z\n`);
  jarl(root, 'evidence', '001', 'after a crash');
  assert.match(jarl(root, 'show', '001'), /after a crash/);
  assert.equal(existsSync(lock), false);
  // A live holder (this test's own process) that does not let go: the call waits out its limit, then refuses.
  const { withLock } = await import(new URL('../jarl.mjs', import.meta.url).href);
  writeFileSync(lock, `${process.pid} ${hostname()} ${new Date().toISOString()}\n`);
  const env = { ...process.env, JARL_LOCK_WAIT_MS: '300' };
  let err;
  try { execFileSync(process.execPath, [SCRIPT, 'evidence', '001', 'blocked', '--root', root], { encoding: 'utf8', env, stdio: 'pipe' }); } catch (e) { err = e; }
  assert.ok(err, 'a held lock refuses instead of writing without it');
  assert.match(String(err.stderr), new RegExp(`\\.jarl/\\.lock is held by another jarl\\.mjs \\(${process.pid} .*\\) — nothing was written`));
  assert.doesNotMatch(jarl(root, 'show', '001'), /blocked/);
  assert.equal(typeof withLock, 'function');
});

// ---- the argument parser ---------------------------------------------------------------------

test('a value flag takes the next argument whatever it starts with; -- ends the flags; unknown flags are refused', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'target');
  // --ran "--help" is a row, not a request for the usage text.
  assert.equal(jarl(root, 'evidence', '001', '--ran', '--help', '--saw', 'usage'), '001 evidence row recorded');
  jarl(root, 'evidence', '001', '--ran', 'yg check', '--saw', '--- FAIL: 3 pairs');
  jarl(root, 'evidence', '001', '--ran=go test ./...', '--saw=ok=all');
  const raw = (...args) => execFileSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8' }).trim();
  raw('evidence', '001', '--', '--json prints ok');
  // A --root written after the bare -- is an argument, and a surplus one is refused rather than dropped.
  assert.match(refuses(root, 'evidence', '001', '--', 'x'), /unexpected: "--root".*flags such as --root go before it/s);
  assert.match(refuses(root, 'set', '1', '2', 'done', 'why'), /set takes at most 3 arguments — unexpected: "why".*12,13/s);
  const shown = jarl(root, 'show', '001');
  assert.match(shown, /^- \*\*ran:\*\* --help · \*\*saw:\*\* usage$/m);
  assert.match(shown, /^- \*\*ran:\*\* yg check · \*\*saw:\*\* --- FAIL: 3 pairs$/m);
  assert.match(shown, /^- \*\*ran:\*\* go test \.\/\.\.\. · \*\*saw:\*\* ok=all$/m);
  assert.match(shown, /^--json prints ok$/m);
  assert.match(raw('new', '--', '--json output drops key'), /^filed 002 /);
  // Refused loudly, naming what the command takes.
  assert.match(refuses(root, 'new', 'd', '--kidn', 'gap'), /unknown flag --kidn for new — it takes .*--kind/);
  assert.match(refuses(root, 'evidence', '001', '--json prints ok'), /unknown flag --json prints ok for evidence.*bare --/s);
  assert.throws(() => raw('evidence', '001', '--ran'), (e) => /--ran needs a value/.test(String(e.stderr)));
  assert.match(refuses(root, 'new', 'x', '--kind', 'bug', '--kind', 'gap'), /--kind given twice/);
  assert.match(refuses(root, 'list', '--all=yes'), /--all takes no value/);
  assert.match(refuses(root, 'evidence', '001', 'note', '--ran', 'a', '--saw', 'b'), /not both/);
  assert.match(refuses(root, '--kind', 'bug', 'new', 'x'), /before the command/);
  assert.match(refuses(root, 'frobnicate'), /unknown command: frobnicate/);
  // Nothing refused above wrote anything.
  assert.equal(JSON.parse(jarl(root, 'list', '--all', '--json')).length, 2);
  // --help still prints the usage when it is a flag of its own.
  assert.match(jarl(root, 'list', '--help'), /^usage: jarl\.mjs/);
});

test('every flag the usage text names is one its command accepts', async () => {
  const { COMMAND_FLAGS } = await import(new URL('../jarl.mjs', import.meta.url).href);
  const usage = readFileSync(SCRIPT, 'utf8').split('const USAGE = `')[1].split('`;')[0];
  for (const line of usage.split('\n')) {
    const m = /^ {2}([a-z]+) /.exec(line);
    if (!m || !COMMAND_FLAGS[m[1]]) continue;
    for (const [, flag] of line.matchAll(/--([a-z][a-z-]*)/g)) {
      assert.ok(Object.hasOwn(COMMAND_FLAGS[m[1]], flag) || ['json', 'help', 'root'].includes(flag), `${m[1]} --${flag} is in the usage but not accepted`);
    }
  }
});

// ---- bulk ids ------------------------------------------------------------------------------------

test('evidence, review, set, tag and prio take a comma list with ranges, all or nothing, one log line per issue', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  for (const t of ['a', 'b', 'c', 'd', 'e']) jarl(root, 'new', t);
  // A four-issue package closes in four calls.
  assert.equal(jarl(root, 'evidence', '1-3,5', '--ran', 'npm test', '--saw', 'pass 40'), '001 evidence row recorded\n002 evidence row recorded\n003 evidence row recorded\n005 evidence row recorded');
  jarl(root, 'review', '1-3,5', 'approve', 'read the diff, nothing found');
  jarl(root, 'evidence', '001,002,003,005', 'merged abc1234');
  assert.equal(jarl(root, 'set', '1-3,5', 'done', 'merged abc1234'), '001 → done\n002 → done\n003 → done\n005 → done');
  const rows = JSON.parse(jarl(root, 'list', '--all', '--json'));
  assert.deepEqual(rows.filter((r) => r.status === 'done').map((r) => r.id), ['001', '002', '003', '005']);
  const log = readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
  assert.equal((log.match(/· 00[1235] → done · merged abc1234$/gm) || []).length, 4, 'one log line per issue');
  assert.equal((log.match(/· 00[1235] review approve · /gm) || []).length, 4);
  // tag and prio.
  jarl(root, 'tag', '4,5', '+later', '-none');
  jarl(root, 'prio', '4-5', '1');
  const [d, e] = ['004', '005'].map((id) => jarl(root, 'show', id));
  for (const t of [d, e]) { assert.match(t, /^\*\*Tags:\*\* later$/m); assert.match(t, /^\*\*Priority:\*\* 1$/m); }
  // A JSON caller gets an array for a list, the old object for one id.
  assert.ok(Array.isArray(JSON.parse(jarl(root, 'prio', '4,5', '2', '--json'))));
  assert.equal(JSON.parse(jarl(root, 'prio', '4', '3', '--json')).id, '004');
});

test('a bulk call with one bad id, or one issue failing its precondition, writes nothing at all', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  for (const t of ['a', 'b']) jarl(root, 'new', t);
  const before = () => [readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), jarl(root, 'show', '1'), jarl(root, 'show', '2')].join('\n');
  const snap = before();
  assert.match(refuses(root, 'evidence', '1,2,9', 'note'), /no such issue: 009 — nothing was written/);
  assert.match(refuses(root, 'tag', '1-3', '+x'), /no such issue: 003/);
  assert.match(refuses(root, 'set', '1,2', 'bogus'), /status must be one of/);
  // 001 is ready for done, 002 is not: neither moves.
  jarl(root, 'evidence', '1', 'proof');
  jarl(root, 'review', '1', 'approve', 'fine');
  assert.match(refuses(root, 'set', '1,2', 'done'), /002 has no evidence yet.*nothing was written/s);
  assert.match(jarl(root, 'show', '1'), /^\*\*Status:\*\* open$/m);
  assert.match(refuses(root, 'prio', '1,x', '1'), /not an issue id: "x"/);
  assert.match(refuses(root, 'prio', '5-2', '1'), /runs backwards/);
  assert.notEqual(before(), snap, 'the evidence and review above did land');
  assert.doesNotMatch(jarl(root, 'show', '2'), /note/);
});

test('a committed loop keeps the lock and temporary files out of git; an older committed loop is given the narrow ignore file by its first write', () => {
  for (const mode of ['--committed', '--permanent']) {
    const { dir: root, g } = gitRepo();
    jarl(root, 'init', 'goal', mode);
    jarl(root, 'new', 'thing');
    // What a `git add .jarl` sees in the middle of a call: the lock, a stale lock moved aside, temp files.
    writeFileSync(join(root, '.jarl', '.lock'), '1 host 2026-01-01\n');
    writeFileSync(join(root, '.jarl', '.lock.break'), '');
    writeFileSync(join(root, '.jarl', '.log.md.123.tmp'), '');
    writeFileSync(join(root, '.jarl', 'issues', '.002.123.tmp'), '');
    g('add', '-A');
    const staged = g('ls-files', '.jarl').split('\n');
    assert.ok(staged.includes('.jarl/.gitignore') && staged.includes('.jarl/issues/001-thing.md') && staged.includes('.jarl/log.md'), `${mode}: the loop is committed`);
    assert.deepEqual(staged.filter((f) => /lock|\.tmp$/.test(f)), [], `${mode}: the lock and temp files are not`);
  }
  // A committed loop opened before the narrow file existed has no ignore file at all.
  const root = repo();
  jarl(root, 'init', 'goal', '--committed');
  execFileSync('rm', [join(root, '.jarl', '.gitignore')]);
  jarl(root, 'new', 'thing');
  assert.equal(readFileSync(join(root, '.jarl', '.gitignore'), 'utf8'), JARL_GITIGNORE_COMMITTED);
  // The mode reads the same: still committed, so mode permanent works, and an archive keeps the mode.
  jarl(root, 'mode', 'permanent');
  jarl(root, 'set', '1', 'dropped', 'x');
  jarl(root, 'archive', 'first');
  assert.equal(JSON.parse(jarl(root, 'init', 'next', '--json')).permanent, true);
  // The default mode's file is still the ignore-everything one, and mode permanent still refuses it.
  const out = repo();
  jarl(out, 'init', 'goal');
  jarl(out, 'new', 'thing');
  assert.equal(readFileSync(join(out, '.jarl', '.gitignore'), 'utf8'), '*\n**/*\n');
  assert.match(refuses(out, 'mode', 'permanent'), /out of git/);
});

test('many callers on a lock left by a dead process: one breaks it, none loses a row; an empty lock is broken after two seconds', async () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'target');
  const { hostname } = await import('node:os');
  const { utimesSync, readdirSync } = await import('node:fs');
  const lock = join(root, '.jarl', '.lock');
  writeFileSync(lock, `99999999 ${hostname()} 2026-01-01T00:00:00.000Z\n`);
  await Promise.all(Array.from({ length: 20 }, (_, n) => jarlAsync(root, 'evidence', '001', '--ran', `b${n}`, '--saw', 'ok')));
  assert.equal((jarl(root, 'show', '001').match(/^- \*\*ran:\*\* b\d+ · /gm) || []).length, 20);
  assert.equal((readFileSync(join(root, '.jarl', 'log.md'), 'utf8').match(/· 001 evidence row · b\d+$/gm) || []).length, 20);
  assert.deepEqual(readdirSync(join(root, '.jarl')).filter((f) => f.startsWith('.lock')), [], 'neither the lock nor the breaker lock is left');
  // A holder that died between creating the lock and writing its name: empty, and broken once two seconds old.
  writeFileSync(lock, '');
  const old = new Date(Date.now() - 5_000);
  utimesSync(lock, old, old);
  const t0 = Date.now();
  jarl(root, 'evidence', '001', 'after an empty lock');
  assert.ok(Date.now() - t0 < 10_000, 'well inside the wait limit');
  assert.match(jarl(root, 'show', '001'), /after an empty lock/);
  // A breaker that died holding the breaker lock does not block for good.
  writeFileSync(lock, `99999999 ${hostname()} 2026-01-01T00:00:00.000Z\n`);
  writeFileSync(join(root, '.jarl', '.lock.break'), '');
  const older = new Date(Date.now() - 60_000);
  utimesSync(join(root, '.jarl', '.lock.break'), older, older);
  jarl(root, 'evidence', '001', 'after a dead breaker');
  assert.match(jarl(root, 'show', '001'), /after a dead breaker/);
});

test('new claims its file with a hard link, and without hard links falls back to an exclusive create', async () => {
  const { claimFile } = await import(new URL('../jarl.mjs', import.meta.url).href);
  const dir = mkdtempSync(join(tmpdir(), 'jarl-claim-'));
  const tmp = join(dir, '.tmp'); writeFileSync(tmp, 'body');
  const noLinks = () => { const e = new Error('no links'); e.code = 'EPERM'; throw e; };
  assert.equal(claimFile(tmp, join(dir, '001-a.md'), noLinks), true);
  assert.equal(readFileSync(join(dir, '001-a.md'), 'utf8'), 'body');
  assert.equal(claimFile(tmp, join(dir, '001-a.md'), noLinks), false, 'a taken name is not overwritten');
  assert.equal(claimFile(tmp, join(dir, '002-b.md')), true);
  assert.equal(claimFile(tmp, join(dir, '002-b.md')), false);
  const other = () => { const e = new Error('disk'); e.code = 'EIO'; throw e; };
  assert.throws(() => claimFile(tmp, join(dir, '003-c.md'), other), /disk/);
});

test('a command refused by the parser or its own checks does not backfill the ignore file', () => {
  const root = repo();
  jarl(root, 'init', 'goal', '--committed');
  execFileSync('rm', [join(root, '.jarl', '.gitignore')]);
  refuses(root, 'evidence', '001', '--bogus');
  assert.equal(existsSync(join(root, '.jarl', '.gitignore')), false, 'the parser refused before any lock');
  refuses(root, 'set', '999', 'done');
  assert.equal(existsSync(join(root, '.jarl', '.gitignore')), false, 'a command refused under the lock writes nothing');
  jarl(root, 'list');
  assert.equal(existsSync(join(root, '.jarl', '.gitignore')), false, 'a read takes no lock and writes nothing');
  jarl(root, 'new', 'thing');
  assert.equal(readFileSync(join(root, '.jarl', '.gitignore'), 'utf8'), JARL_GITIGNORE_COMMITTED, 'the first write that lands backfills it');
});

// ---- bodies, research import, ratify, After ----------------------------------------------------------

test('new writes the body at filing time, body replaces it later, and neither is required', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'with a body', '--where', 'src/a.mjs:12', '--what', 'the parser drops the last row', '--why', 'exports lose data',
    '--acceptance', 'npm test -- parser passes', '--acceptance', 'fixture 3 exports 10 rows');
  const shown = jarl(root, 'show', '001');
  assert.match(shown, /^\*\*Where:\*\* src\/a\.mjs:12$/m);
  assert.match(shown, /## What\nthe parser drops the last row\n\n## Why\nexports lose data\n\n## Acceptance\n- npm test -- parser passes\n- fixture 3 exports 10 rows\n\n## Evidence/);
  // A body line that looks like a heading stays inside its section.
  jarl(root, 'body', '1', '--what', 'line one\n## not a section');
  const issue = JSON.parse(jarl(root, 'show', '1', '--json'));
  assert.match(issue.sections.what, /line one\n\\## not a section/);
  assert.equal(Object.keys(issue.sections).join(','), 'what,why,acceptance,evidence');
  assert.match(refuses(root, 'body', '1'), /at least one of/);
  // A bare ## line is escaped too.
  jarl(root, 'body', '1', '--why', 'a\n##\nb');
  assert.match(JSON.parse(jarl(root, 'show', '1', '--json')).sections.why, /^a\n\\##\nb/);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /001 body · what/);
  // Without any of it, an issue reads exactly as before.
  jarl(root, 'new', 'bare');
  assert.match(jarl(root, 'show', '2'), /\*\*Where:\*\*\n\n## What\n\n\n## Why\n\n\n## Acceptance\n\n\n## Evidence$/);
});

test('next and status flag work with no acceptance line, done says so on stderr, review echoes the acceptance', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'no acceptance');
  jarl(root, 'new', 'has acceptance', '--acceptance', 'a', '--acceptance', 'b');
  const next = JSON.parse(jarl(root, 'next', '--json'));
  assert.equal(next[0].noAcceptance, true); assert.equal(next[1].noAcceptance, undefined);
  assert.match(jarl(root, 'next'), /001 {2}P2 {2}no acceptance {2}\(no acceptance yet\)/);
  jarl(root, 'set', '1,2', 'in-progress', 'raised');
  assert.match(jarl(root, 'status'), /in flight with no acceptance line: 001$/m);
  assert.match(jarl(root, 'review', '2', 'approve', 'fine'), /002 review approve · acceptance: - a \/ - b/);
  jarl(root, 'evidence', '2', '--ran', 'x', '--saw', 'y');
  const r = execFileSync(process.execPath, [SCRIPT, 'set', '2', 'done', 'merged', '--root', root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(r.trim(), '002 → done', 'stdout is unchanged');
  const child = (() => { try { return execFileSync('bash', ['-c', `node ${SCRIPT} review 1 approve ok --root ${root} >/dev/null && node ${SCRIPT} evidence 1 note --root ${root} >/dev/null && node ${SCRIPT} set 1 done m --root ${root} 2>&1 >/dev/null`], { encoding: 'utf8' }); } catch (e) { return String(e.stdout); } })();
  assert.match(child, /note: 001 no acceptance line on file/, 'done is never refused for it, only noted');
});

const FLAT = [
  { id: 'jarl-2-B2', kind: 'defect', priority: 'high', title: 'issues have no body', where: 'jarl.mjs:297', evidence: 'ran new, saw an empty What', proposal: 'add --what', effort: 'S' },
  { id: 'jarl-2-B5', kind: 'opportunity', priority: 'low', title: 'no After relation', where: 'jarl.mjs:478', evidence: 'e', proposal: 'p', effort: 'M' },
];

function findingsDir(json) {
  const dir = mkdtempSync(join(tmpdir(), 'report-2026-09-25-'));
  writeFileSync(join(dir, 'findings.json'), JSON.stringify(json));
  return join(dir, 'findings.json');
}

test('import files one issue per finding with a Source, never twice, and keeps Evidence empty', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  const file = findingsDir(FLAT);
  const dry = JSON.parse(jarl(root, 'import', file, '--source', 'core/research/2026-09-25-jarl', '--dry-run', '--json'));
  assert.equal(dry.filed.length, 2); assert.equal(JSON.parse(jarl(root, 'list', '--all', '--json')).length, 0, 'a dry run files nothing');
  const out = JSON.parse(jarl(root, 'import', file, '--source', 'core/research/2026-09-25-jarl', '--tags', 'research', '--json'));
  assert.deepEqual(out.filed.map((f) => [f.id, f.finding, f.kind, f.priority]), [['001', 'jarl-2-B2', 'bug', '1'], ['002', 'jarl-2-B5', 'gap', '3']]);
  const one = JSON.parse(jarl(root, 'show', '1', '--json'));
  assert.equal(one.fields.source, 'core/research/2026-09-25-jarl#jarl-2-B2');
  assert.equal(one.fields.where, 'jarl.mjs:297');
  assert.deepEqual(one.tags, ['research']);
  assert.match(one.sections.what, /ran new, saw an empty What/);
  assert.match(one.sections.why, /Effort \(the finding's estimate\): S/);
  assert.match(one.sections.acceptance, /Proposed by the finding .*add --what/);
  assert.equal(one.sections.evidence.trim(), '', 'nothing in Evidence: done still needs real evidence');
  // A re-run files nothing; a hand-filed issue with --source counts as filed too.
  assert.match(jarl(root, 'import', file, '--source', 'core/research/2026-09-25-jarl'), /filed 0 · already filed 2/);
  jarl(root, 'new', 'by hand', '--source', 'core/research/2026-09-25-other#X-1');
  assert.match(refuses(root, 'new', 'bad', '--source', 'no-hash'), /a source is <report dir>#<finding id>/);
  // Flags override the mapping.
  const file2 = findingsDir([{ id: 'Q-1', title: 'q', priority: 'high' }]);
  const o2 = JSON.parse(jarl(root, 'import', file2, '--source', 'r2', '--kind', 'docs', '--prio', '3', '--json'));
  assert.deepEqual([o2.filed[0].kind, o2.filed[0].priority], ['docs', '3']);
  const sources = jarl(root, 'sources', file, '--source', 'core/research/2026-09-25-jarl');
  assert.match(sources, /^core\/research\/2026-09-25-jarl · 2 finding\(s\) · 2 filed · 0 unfiled · issues: open 2$/m);
  assert.match(sources, /^ {2}jarl-2-B2 {2}001 open$/m);
  const all = JSON.parse(jarl(root, 'sources', '--json'));
  assert.deepEqual(all.map((r) => r.source).sort(), ['core/research/2026-09-25-jarl', 'core/research/2026-09-25-other', 'r2']);
});

test('import reads the angles shape and the results/kept shape; refuses a finding with no id or a repeated one', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  const angles = findingsDir([
    { angle: 'first-hour', summary: 's', surviving: [{ id: 'F1', title: 'a', severity: 'major', where: 'w', evidence: 'e', adopter_impact: 'hurts', suggested_fix: 'fix it' }], refuted: [] },
    { angle: 'ci', summary: 's', surviving: [{ id: 'F1', title: 'b', severity: 'minor' }], refuted: [] },
  ]);
  const a = JSON.parse(jarl(root, 'import', angles, '--source', 'r-angles', '--json'));
  assert.deepEqual(a.filed.map((f) => [f.finding, f.priority]), [['first-hour/F1', '2'], ['ci/F1', '3']]);
  assert.match(JSON.parse(jarl(root, 'show', '1', '--json')).sections.why, /hurts/);
  const kept = findingsDir({ results: [{ area: 'check', summary: 's', kept: [{ id: 'check-F1', severity: 'minor', surfaces: 'docs', claim: 'The gate is all-or-nothing. More text.', truth: 'It is per node.', evidence: 'docs:135', fix: 'reword' }], dropped: [] }] });
  const k = JSON.parse(jarl(root, 'import', kept, '--source', 'r-kept', '--json'));
  assert.equal(k.filed[0].title, 'The gate is all-or-nothing.');
  const shown = JSON.parse(jarl(root, 'show', k.filed[0].id, '--json'));
  assert.match(shown.sections.what, /Claim: The gate[\s\S]*Truth: It is per node\.[\s\S]*docs:135/);
  assert.equal(shown.fields.where, 'docs');
  assert.match(refuses(root, 'import', findingsDir([{ title: 'no id' }])), /has no id/);
  assert.match(refuses(root, 'import', findingsDir([{ id: 'A' }, { id: 'A' }])), /appears twice/);
  assert.match(refuses(root, 'import', findingsDir({ nope: 1 })), /not a findings file/);
});

test('import --adopt links older issues that name the finding, once, without filing a duplicate', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'Jarl: bodies (jarl-2-B2)');
  jarl(root, 'new', 'minor package');
  jarl(root, 'body', '2', '--what', 'covers jarl-2-B5 and jarl-9-Z9');
  const file = findingsDir([...FLAT, { id: 'jarl-9-Z9', title: 'z' }, { id: 'jarl-2-B20', title: 'no one names me' }]);
  assert.match(jarl(root, 'import', file, '--source', 'r'), /filed 1 · already filed 0 · named by an issue without Source 3/);
  const o = JSON.parse(jarl(root, 'import', file, '--source', 'r', '--adopt', '--json'));
  assert.deepEqual(o.adopted.map((a) => [a.finding, a.issue]), [['jarl-2-B2', '001'], ['jarl-2-B5', '002'], ['jarl-9-Z9', '002']]);
  assert.equal(JSON.parse(jarl(root, 'show', '2', '--json')).fields.source, 'r#jarl-2-B5, r#jarl-9-Z9');
  assert.match(jarl(root, 'import', file, '--source', 'r'), /filed 0 · already filed 4/);
});

test('ask --kind ratify blocks nothing, is listed in status and the handoff, and its answer lands on the issue', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'limit raised');
  jarl(root, 'set', '1', 'in-progress', 'w');
  assert.match(jarl(root, 'ask', 'raised the prompt limit to 96000 under the mandate', '--kind', 'ratify', '--issue', '1'), /filed a-001 for ratification · blocks nothing/);
  assert.match(refuses(root, 'ask', 'x', '--kind', 'ratify', '--issue', '9'), /no such issue: 9/);
  const st = jarl(root, 'status');
  assert.match(st, /questions 0 · to ratify 1/);
  assert.match(st, /^ratify a-001 \(issue 001\) · raised the prompt limit/m);
  jarl(root, 'handoff', 'write', '--summary', 's');
  assert.match(jarl(root, 'handoff', 'read'), /## Waiting on the user\n- \(nothing\)\n\n## Decided under mandate, awaiting ratification\n- a-001 \(issue 001\) raised/);
  // It holds nothing back: next, done.
  jarl(root, 'review', '1', 'approve', 'ok');
  jarl(root, 'evidence', '1', 'merged');
  jarl(root, 'set', '1', 'done', 'merged');
  jarl(root, 'answer', 'a-001', 'ratified');
  assert.match(jarl(root, 'show', '1'), /Ruling ask-001 \(ratify\): ratified/);
  assert.match(jarl(root, 'status'), /questions 0$/m);
});

test('After holds an issue out of next and counts it as waiting; decide --settles writes the ruling into issues', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  for (const t of ['release', 'cleanup', 'profile', 'numbers']) jarl(root, 'new', t);
  jarl(root, 'new', 'after the release', '--after', '1');
  jarl(root, 'set', '2,3', 'in-progress', 'raised');
  jarl(root, 'after', '2', '1'); jarl(root, 'after', '3', '1');
  assert.match(jarl(root, 'status'), /open 2 · in flight 0 · waiting 3 ·/);
  const st = JSON.parse(jarl(root, 'status', '--json'));
  assert.deepEqual([st.open, st['in-progress'], st.waiting], [3, 2, 3], 'the status counts stay counts of statuses');
  const next = jarl(root, 'next');
  assert.match(next, /^005 {2}P2 {2}after the release {2}\(after 001\)$/m);
  assert.match(next, /^001 {2}P2 {2}release/m);
  assert.match(refuses(root, 'after', '1', '5'), /would close a cycle/);
  assert.match(refuses(root, 'after', '1', '1'), /cannot wait on itself/);
  assert.match(refuses(root, 'new', 'x', '--after', '99'), /no such issue: 099/);
  jarl(root, 'set', '1', 'dropped', 'not this release');
  assert.match(jarl(root, 'status'), /in flight 2 · done/);
  assert.doesNotMatch(jarl(root, 'next'), /\(after/);
  jarl(root, 'after', '5', '--clear');
  assert.equal(JSON.parse(jarl(root, 'show', '5', '--json')).fields.after, undefined);
  // A ruling names what it settles: the ruling goes into each issue's evidence, the status stays.
  assert.match(jarl(root, 'decide', 'numbers', 'the core ships on one number', '--settles', '4'), /decided numbers · written into 004/);
  const four = JSON.parse(jarl(root, 'show', '4', '--json'));
  assert.equal(four.status, 'open');
  assert.match(four.sections.evidence, /Ruling numbers: the core ships on one number/);
  assert.match(readFileSync(join(root, '.jarl', 'decisions.md'), 'utf8'), /the core ships on one number\n\n\*\*Settles:\*\* 004/);
  assert.match(refuses(root, 'decide', 'other', 'x', '--settles', '4,77'), /no such issue: 077/);
  assert.doesNotMatch(readFileSync(join(root, '.jarl', 'decisions.md'), 'utf8'), /other/, 'a refused ruling writes nothing');
});

test('an issue file from before these fields reads and moves unchanged', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  const old = '# 001 · old one\n\n**Status:** open\n**Kind:** bug\n**Priority:** 1\n**Tier:** standard\n**Tags:** \n**Files:** a.mjs\n**Found by:** jarl\n**Where:**\n\n## What\n\n\n## Why\n\n\n## Acceptance\n\n\n## Evidence\n\n';
  writeFileSync(join(root, '.jarl', 'issues', '001-old-one.md'), old);
  const i = JSON.parse(jarl(root, 'show', '1', '--json'));
  assert.deepEqual([i.after, i.sources], [[], []]);
  assert.match(jarl(root, 'next'), /^001 {2}P1 {2}old one/);
  assert.match(jarl(root, 'status'), /open 1 · in flight 0 · done 0/);
  jarl(root, 'source', '1', 'r#A-1');
  assert.match(readFileSync(join(root, '.jarl', 'issues', '001-old-one.md'), 'utf8'), /\*\*Where:\*\*\n\*\*Source:\*\* r#A-1\n\n## What/);
});

test('replacement patterns in user text are written as they are: $1, $&, $\' and $` never expand', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'dollars', '--what', 'w');
  jarl(root, 'body', '1', '--why', "use $' here and $` and $& and $1");
  jarl(root, 'evidence', '1', "saw $' and $1");
  jarl(root, 'evidence', '1', "then $& too");
  const text = jarl(root, 'show', '1');
  assert.equal((text.match(/^## /gm) || []).length, 4, 'no section duplicated');
  const i = JSON.parse(jarl(root, 'show', '1', '--json'));
  assert.equal(i.sections.why.trim(), "use $' here and $` and $& and $1");
  assert.equal(i.sections.evidence.trim(), "saw $' and $1\n\nthen $& too");
});

test('done: a ruling or a drop reason alone is not evidence; a proposal is not an acceptance line; 0 rows is noted', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'settled', '--acceptance', 'npm test passes');
  jarl(root, 'decide', 'rule', 'keep it', '--settles', '1');
  jarl(root, 'review', '1', 'approve', 'ok');
  assert.match(refuses(root, 'set', '1', 'done', 'x'), /001 has no evidence yet/);
  jarl(root, 'evidence', '1', 'merged abc');
  const r = (() => { try { return execFileSync('bash', ['-c', `node ${SCRIPT} set 1 done m --root ${root} 2>&1`], { encoding: 'utf8' }); } catch (e) { return String(e.stdout); } })();
  assert.match(r, /note: 001 1 acceptance line\(s\), 0 --ran\/--saw row\(s\)/);
  const file = findingsDir([{ id: 'jarl-3-X1', title: 'x', proposal: 'do it' }]);
  const o = JSON.parse(jarl(root, 'import', file, '--source', 'r', '--json'));
  const next = JSON.parse(jarl(root, 'next', '--json')).find((x) => x.id === o.filed[0].id);
  assert.equal(next.noAcceptance, true, 'the copied proposal is not an acceptance line yet');
  assert.deepEqual([next.waitsOn, next.after], [[], []], 'every next row carries both lists');
});

test('import never takes a short id, a header field or Evidence for a mention of the finding', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'unrelated F1 in a title', '--what', 'see F4 and C1 here');   // short ids in prose, no report named
  jarl(root, 'new', 'another', '--prio', '2');                                    // **Priority:** 2
  jarl(root, 'new', 'notes');
  jarl(root, 'evidence', '3', 'also touches jarl-2-B2');                          // named only in Evidence
  jarl(root, 'new', 'package', '--what', 'from report-x: F7 and C9');              // short id with its report named
  const file = findingsDir([{ id: 'F1', title: 'a' }, { id: 'F4', title: 'b' }, { id: 'C1', title: 'c' }, { id: '2', title: 'd' }, { id: 'jarl-2-B2', title: 'e' }, { id: 'F7', title: 'f' }]);
  const o = JSON.parse(jarl(root, 'import', file, '--source', 'core/research/report-x', '--adopt', '--dry-run', '--json'));
  assert.deepEqual(o.adopted.map((a) => [a.finding, a.issue]), [['F7', '004']]);
  assert.deepEqual(o.filed.map((f) => f.finding), ['F1', 'F4', 'C1', '2', 'jarl-2-B2']);
  // The angles shape: a bare id needs its <angle>/<id> or its report; the angle name is slugified into the key.
  const angles = findingsDir([{ angle: 'First Hour', surviving: [{ id: 'prime-teaches-removed-verdict', title: 'p' }] }]);
  const a = JSON.parse(jarl(root, 'import', angles, '--source', 'r-angles', '--dry-run', '--json'));
  assert.equal(a.filed[0].finding, 'first-hour/prime-teaches-removed-verdict');
  jarl(root, 'new', 'names it', '--what', 'first-hour/prime-teaches-removed-verdict');
  const a2 = JSON.parse(jarl(root, 'import', angles, '--source', 'r-angles', '--dry-run', '--json'));
  assert.deepEqual(a2.mentioned.map((m) => m.issue), ['005']);
});

test('import adopts a package issue whose Evidence names the report and lists the ids; short ids and other lines never match there', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'minor package');
  jarl(root, 'evidence', '1', 'Source: core/research/2026-09-25-x-audit/report.md §3, findings.json area a. Ids: area-a-01, area-a-02, F1');
  jarl(root, 'new', 'other work');
  jarl(root, 'evidence', '2', 'touches area-a-03 as well');                                  // unique id, report not on the line
  jarl(root, 'evidence', '2', 'see core/research/2026-09-25-x-audit/report.md');
  const file = findingsDir([{ id: 'area-a-01', title: 'a' }, { id: 'area-a-02', title: 'b' }, { id: 'area-a-03', title: 'c' }, { id: 'F1', title: 'd' }]);
  const o = JSON.parse(jarl(root, 'import', file, '--source', 'core/research/2026-09-25-x-audit', '--adopt', '--json'));
  assert.deepEqual(o.adopted.map((x) => [x.finding, x.issue]), [['area-a-01', '001'], ['area-a-02', '001']]);
  assert.deepEqual(o.filed.map((f) => f.finding), ['area-a-03', 'F1']);
  assert.match(jarl(root, 'import', file, '--source', 'core/research/2026-09-25-x-audit'), /filed 0 · already filed 4/);
});

// ---- packages, leases, merges, record hygiene -------------------------------------------------------

function gitLoop(...initFlags) {
  const root = mkdtempSync(join(tmpdir(), 'jarl-pkg-'));
  const sh = (script, cwd = root) => execFileSync('bash', ['-c', script], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  sh('git init -q -b main && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null && echo a > a.txt && echo b > b.txt && echo c > c.txt && git add -A && git commit -qm base');
  jarl(root, 'init', 'goal', ...initFlags);
  return { root, sh };
}
function withStderr(root, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}
function editIssue(root, id, fn) {
  const dir = join(root, '.jarl', 'issues');
  const file = join(dir, readdirSync(dir).find((f) => f.startsWith(`${id}-`)));
  writeFileSync(file, fn(readFileSync(file, 'utf8')));
}

test('a package is one lease on one branch: set records it, check --branch bounds the diff by the union, branches maps it', () => {
  const { root, sh } = gitLoop();
  jarl(root, 'new', 'one', '--files', 'a.txt');
  jarl(root, 'new', 'two', '--files', 'b.txt');
  jarl(root, 'new', 'three', '--files', 'c.txt');
  const wt = join(root, '..', `${basename(root)}-wt`);
  assert.match(jarl(root, 'set', '1-2', 'in-progress', 'package raised', '--branch', 'jarl/001-pkg', '--worker', 'w1', '--worktree', wt), /^001 → in-progress · jarl\/001-pkg · w1\n002 → in-progress · jarl\/001-pkg · w1$/);
  const shown = jarl(root, 'show', '2');
  assert.match(shown, /^\*\*Branch:\*\* jarl\/001-pkg$/m);
  assert.match(shown, /^\*\*Worker:\*\* w1$/m);
  assert.match(shown, new RegExp(`^\\*\\*Worktree:\\*\\* ${wt.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`, 'm'));
  assert.match(shown, /^\*\*Since:\*\* \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/m);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /002 → in-progress · package raised · branch jarl\/001-pkg · worker w1 · worktree /);
  assert.match(refuses(root, 'set', '3', 'open', 'x', '--branch', 'b'), /--branch goes with in-progress only/);

  sh(`git worktree add -q -b jarl/001-pkg ${wt} && cd ${wt} && echo A > a.txt && echo B > b.txt && git commit -qam work`);
  // One issue alone still fails for the files of the other; the package passes in one call.
  const alone = withStderr(root, 'check', '001', '--branch', 'jarl/001-pkg');
  assert.equal(alone.status, 2);
  assert.match(alone.stdout, /✗ diff inside declared files — outside a\.txt: b\.txt/);
  const pkg = JSON.parse(jarl(root, 'check', '--branch', 'jarl/001-pkg', '--json'));
  assert.equal(pkg.ok, true, JSON.stringify(pkg.items));
  assert.deepEqual([pkg.id, pkg.ids], [null, ['001', '002']]);
  assert.match(jarl(root, 'check', '--branch', 'jarl/001-pkg'), /^package 001, 002 on jarl\/001-pkg\n/);
  assert.match(refuses(root, 'check', '--branch', 'jarl/none'), /no issue records branch jarl\/none/);

  const rows = JSON.parse(jarl(root, 'branches', '--json'));
  assert.deepEqual(rows.map((r) => [r.branch, r.issues, r.stale, r.deletable]), [['jarl/001-pkg', ['001', '002'], [], false]]);
  assert.match(jarl(root, 'branches'), /^jarl\/001-pkg → 001, 002  \+1 /);
  assert.doesNotMatch(jarl(root, 'status'), /stale/);
});

test('stale leases are shown, never acted on: worktree gone, branch gone, idle', () => {
  const { root, sh } = gitLoop();
  jarl(root, 'new', 'one', '--files', 'a.txt');
  jarl(root, 'new', 'two', '--files', 'b.txt');
  jarl(root, 'new', 'three', '--files', 'c.txt');
  const wt = join(root, '..', `${basename(root)}-wt`);
  jarl(root, 'set', '1', 'in-progress', 'w', '--branch', 'jarl/001-one', '--worker', 'w1', '--worktree', wt);
  sh(`git worktree add -q -b jarl/001-one ${wt} && cd ${wt} && echo A > a.txt && git commit -qam work`);
  jarl(root, 'set', '2', 'in-progress', 'w', '--branch', 'jarl/002-never-made');
  jarl(root, 'set', '3', 'in-progress', 'w');
  editIssue(root, '003', (t) => t.replace(/^\*\*Since:\*\* .*$/m, '**Since:** 2026-01-01 00:00'));
  // The 2026-09-21 loss: a worktree deleted under a live lease.
  rmSync(wt, { recursive: true, force: true });
  const st = JSON.parse(jarl(root, 'status', '--json'));
  assert.deepEqual(st.stale.map((x) => x.id), ['001', '002', '003']);
  assert.match(st.stale[0].problems[0], /^worktree gone: /);
  assert.match(st.stale[1].problems[0], /^branch gone: jarl\/002-never-made$/);
  assert.match(st.stale[2].problems[0], /^idle \d+d: lease since 2026-01-01 00:00$/);
  const text = jarl(root, 'status');
  assert.match(text, /^stale 001 · worktree gone: /m);
  assert.match(text, /^stale 003 · idle /m);
  // A lease younger than --stale-hours is not idle; the lease is only shown, the issue stays in progress.
  assert.equal(JSON.parse(jarl(root, 'status', '--stale-hours', '1000000', '--json')).stale.length, 2);
  assert.match(refuses(root, 'status', '--stale-hours', 'soon'), /--stale-hours takes a positive number/);
  const br = jarl(root, 'branches');
  assert.match(br, /^jarl\/001-one → 001  \+1  \S+ \(gone\)  STALE: 001 worktree gone: /m);
  assert.match(br, /^jarl\/002-never-made → 002  GONE  STALE: 002 branch gone: jarl\/002-never-made$/m);
  assert.equal(JSON.parse(jarl(root, 'show', '1', '--json')).status, 'in-progress');
  // Leaving in-progress removes the lease and keeps the branch.
  jarl(root, 'set', '3', 'open', 'back to the queue');
  const three = jarl(root, 'show', '3');
  assert.doesNotMatch(three, /\*\*(Worker|Worktree|Since):\*\*/);
});

test('merged records the sha and CI as fields; status counts CI pending; done notes it, never refuses; branches marks done → delete', () => {
  const { root, sh } = gitLoop();
  jarl(root, 'new', 'one', '--files', 'a.txt', '--acceptance', 'a is A');
  jarl(root, 'new', 'two', '--files', 'b.txt', '--acceptance', 'b is B');
  jarl(root, 'set', '1,2', 'in-progress', 'w', '--branch', 'jarl/001-pkg', '--worker', 'w1');
  sh('git checkout -q -b jarl/001-pkg && echo A > a.txt && echo B > b.txt && git commit -qam work && git checkout -q main && git merge -q --no-ff -m "merge 001-002" jarl/001-pkg');
  const sha = sh('git rev-parse --short HEAD');
  assert.match(refuses(root, 'merged', '1'), /merged needs --sha/);
  assert.match(refuses(root, 'merged', '1', '--sha', 'nothex!'), /--sha is a commit id/);
  assert.match(refuses(root, 'merged', '1', '--ci', 'green'), /001 records no merge yet/);
  assert.match(refuses(root, 'merged', '1', '--sha', sha, '--ci', 'blue'), /--ci must be one of: pending, green, red, none/);
  assert.equal(jarl(root, 'merged', '1,2', '--sha', sha), `001, 002 merged ${sha} · CI pending`);
  assert.match(jarl(root, 'show', '1'), new RegExp(`^\\*\\*Merged:\\*\\* ${sha}\\n\\*\\*CI:\\*\\* pending$`, 'm'));
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), new RegExp(`002 merged ${sha} · CI pending`));
  const st = jarl(root, 'status');
  assert.match(st, /· merged, CI pending 2/);
  assert.match(st, /^merged, CI pending: 001, 002$/m);
  // An unknown sha is recorded as given, with a note.
  assert.match(withStderr(root, 'merged', '1', '--sha', 'deadbeef').stderr, /deadbeef is not a commit in/);
  jarl(root, 'merged', '1', '--sha', sha);
  jarl(root, 'review', '1,2', 'approve', 'ok');
  jarl(root, 'evidence', '1,2', '--ran', 'check', '--saw', 'green');
  const done = withStderr(root, 'set', '1,2', 'done', 'merged');
  assert.equal(done.status, 0);
  assert.match(done.stderr, new RegExp(`note: 001 merged ${sha}, CI pending`));
  assert.doesNotMatch(jarl(root, 'show', '1'), /\*\*(Worker|Since):\*\*/, 'done ends the lease');
  assert.match(jarl(root, 'show', '1'), /^\*\*Branch:\*\* jarl\/001-pkg$/m, 'done keeps the branch');
  jarl(root, 'merged', '1,2', '--ci', 'green');
  assert.doesNotMatch(jarl(root, 'status'), /CI pending/);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /001 CI green/);
  assert.match(jarl(root, 'report'), new RegExp(`- 001 one \\(bug\\) · merged ${sha}`));
  assert.match(jarl(root, 'branches'), /^jarl\/001-pkg → 001, 002  \+0  \(no worktree\)  DONE → delete$/m);
  // A red CI is counted apart.
  jarl(root, 'merged', '2', '--ci', 'red');
  assert.match(jarl(root, 'status'), /· CI red 1/);
});

test('a committed loop names the loop files git has not committed in status, handoff and close; the default mode stays silent', () => {
  const { root, sh } = gitLoop('--permanent');
  sh('git add -A && git commit -qm loop');
  assert.equal(JSON.parse(jarl(root, 'status', '--json')).uncommitted, 0);
  assert.doesNotMatch(jarl(root, 'status'), /not committed/);
  jarl(root, 'new', 'one');
  assert.match(jarl(root, 'status'), /^2 loop file\(s\) not committed — commit \.jarl\/ in the loop's repository$/m);
  assert.match(jarl(root, 'handoff', 'write', '--summary', 's'), /· 3 loop file\(s\) not committed$/);
  jarl(root, 'set', '1', 'dropped', 'no');
  assert.match(jarl(root, 'close'), /closed as a permanent record · 3 loop file\(s\) not committed — commit \.jarl\//);
  sh('git add -A && git commit -qm record');
  assert.equal(JSON.parse(jarl(root, 'status', '--json')).uncommitted, 0);

  const dflt = gitLoop();
  jarl(dflt.root, 'new', 'one');
  assert.equal(JSON.parse(jarl(dflt.root, 'status', '--json')).uncommitted, null);
  const loose = repo();   // not a git repository at all
  jarl(loose, 'init', 'goal', '--committed');
  jarl(loose, 'new', 'one');
  assert.equal(JSON.parse(jarl(loose, 'status', '--json')).uncommitted, null);
});

test('handoff read computes the mechanical parts live and says how old the written part is', () => {
  const { root, sh } = gitLoop();
  jarl(root, 'new', 'one');
  jarl(root, 'new', 'two');
  jarl(root, 'handoff', 'write', '--summary', 'the plan', '--next', 'raise two');
  const fresh = jarl(root, 'handoff', 'read');
  assert.match(fresh, /^written \d+m ago · 0 log line\(s\) and 0 issue\(s\) changed since$/m);
  assert.doesNotMatch(fresh, /STALE/);
  // Written three days before the loop's last line: stale; what moved since is read now, not from the file.
  const path = join(root, '.jarl', 'handoff.md');
  writeFileSync(path, readFileSync(path, 'utf8').replace(/^\*\*At:\*\* \S+ \S+/m, '**At:** 2026-01-01 00:00'));
  jarl(root, 'set', '2', 'in-progress', 'raised', '--branch', 'jarl/002-two', '--worker', 'w2');
  jarl(root, 'ask', 'which way?', '--kind', 'stuck', '--issue', '1');
  sh('echo x > x.txt && git add x.txt && git commit -qm more');
  const h = jarl(root, 'handoff', 'read');
  assert.match(h, /^written \d+d ago · STALE by \d+d: last activity \S+ \S+ · \d+ log line\(s\) and 2 issue\(s\) changed since · heads moved: \. \(main@[0-9a-f]+ → main@[0-9a-f]+\)$/m);
  assert.match(h, /## Summary\nthe plan\n/);
  assert.match(h, /## In flight\n- 002 two · branch jarl\/002-two · worker w2 · since /);
  assert.match(h, /## Waiting on the user\n- a-001 which way\?/);
  assert.match(h, /## Next\n- raise two/);
  assert.equal(readFileSync(path, 'utf8').includes('002 two'), false, 'the file itself is not rewritten by a read');
  const st = JSON.parse(jarl(root, 'status', '--json'));
  assert.equal(st.handoff.stale, true);
  assert.match(jarl(root, 'status'), /last activity \S+ \S+ · handoff \d+d old \(stale by \d+d\)/);
  const js = JSON.parse(jarl(root, 'handoff', 'read', '--json'));
  assert.equal(js.handoff.issuesChangedSince, 2);
});

test('issues and handoffs from before leases and merges read unchanged', () => {
  const { root } = gitLoop();
  const old = '# 001 · old one\n\n**Status:** in-progress\n**Kind:** bug\n**Priority:** 1\n**Tier:** standard\n**Tags:** \n**Files:** a.txt\n**Found by:** jarl\n**Where:**\n\n## What\n\n\n## Why\n\n\n## Acceptance\n\n\n## Evidence\n\n';
  writeFileSync(join(root, '.jarl', 'issues', '001-old-one.md'), old);
  writeFileSync(join(root, '.jarl', 'handoff.md'), '# Handoff\n\n**At:** 2026-01-01 00:00 · **Head:** main@abc1234\n\n## Summary\nold\n\n## In flight\n- 999 gone\n\n## Waiting on the user\n- (nothing)\n\n## Next\n- (nothing recorded)\n');
  const st = JSON.parse(jarl(root, 'status', '--json'));
  assert.deepEqual([st.stale, st.ciPending, st.ciRed], [[], [], []]);
  assert.equal(readFileSync(join(root, '.jarl', 'issues', '001-old-one.md'), 'utf8'), old, 'reading never writes');
  const h = jarl(root, 'handoff', 'read');
  assert.match(h, /## In flight\n- 001 old one\n/);
  assert.doesNotMatch(h, /999 gone/);
  assert.deepEqual(JSON.parse(jarl(root, 'branches', '--json')), []);
});

test('DONE → delete needs the branch tip in the base, or in every recorded merge, and a clean worktree; a number-only match trusts ancestry alone', () => {
  const { root, sh } = gitLoop();
  const mark = (branch) => JSON.parse(jarl(root, 'branches', '--json')).find((r) => r.branch === branch)?.done ?? null;
  const close = (id) => { jarl(root, 'review', id, 'approve', 'ok'); jarl(root, 'evidence', id, 'merged'); jarl(root, 'set', id, 'done', 'merged'); };
  // Merged elsewhere (a release branch, not the base): the tip is in the recorded merge, so it can go.
  jarl(root, 'new', 'elsewhere', '--files', 'a.txt');
  jarl(root, 'set', '1', 'in-progress', 'w', '--branch', 'jarl/001-else');
  sh('git checkout -q -b jarl/001-else && echo A > a.txt && git commit -qam w && git checkout -q -b rel main && git merge -q --no-ff -m m jarl/001-else && git checkout -q main');
  jarl(root, 'merged', '1', '--sha', sh('git rev-parse rel'));
  close('1');
  assert.equal(mark('jarl/001-else'), 'delete');
  // A commit on the branch after the merge: the record no longer covers it.
  sh('git checkout -q jarl/001-else && echo AA > a.txt && git commit -qam later && git checkout -q main');
  assert.equal(mark('jarl/001-else'), 'unverified');
  assert.match(jarl(root, 'branches'), /^jarl\/001-else → 001 .*DONE \(merged by record, branch not in base\) — verify$/m);
  // A squash merge, then an extra commit: never taken as merged.
  jarl(root, 'new', 'squashed', '--files', 'b.txt');
  jarl(root, 'set', '2', 'in-progress', 'w', '--branch', 'jarl/002-sq');
  sh('git checkout -q -b jarl/002-sq && echo B > b.txt && git commit -qam w && git checkout -q main && git merge -q --squash jarl/002-sq && git commit -qm squash && git checkout -q jarl/002-sq && echo BB > b.txt && git commit -qam extra && git checkout -q main');
  jarl(root, 'merged', '2', '--sha', sh('git rev-parse HEAD'));
  close('2');
  assert.equal(mark('jarl/002-sq'), 'unverified');
  // An issue from before Branch, matched by the branch's number only: a recorded merge is not trusted there.
  jarl(root, 'new', 'legacy', '--files', 'c.txt');
  sh('git checkout -q -b jarl/003-legacy && echo C > c.txt && git commit -qam w && git checkout -q -b rel3 main && git merge -q --no-ff -m m jarl/003-legacy && git checkout -q main');
  jarl(root, 'merged', '3', '--sha', sh('git rev-parse rel3'));
  close('3');
  assert.equal(mark('jarl/003-legacy'), null);
  // In the base, but its worktree holds uncommitted files.
  jarl(root, 'new', 'dirty', '--files', 'd.txt');
  const wt = join(root, '..', `${basename(root)}-wt4`);
  jarl(root, 'set', '4', 'in-progress', 'w', '--branch', 'jarl/004-dirty', '--worktree', wt);
  sh(`git worktree add -q -b jarl/004-dirty ${wt} && cd ${wt} && echo D > d.txt && git add d.txt && git commit -qm w && echo scratch > notes.txt`);
  sh('git merge -q --no-ff -m m4 jarl/004-dirty');
  close('4');
  assert.equal(mark('jarl/004-dirty'), 'dirty');
  assert.match(jarl(root, 'branches'), /^jarl\/004-dirty → 004 .*\(1 uncommitted\)  DONE \(worktree dirty\)$/m);
  rmSync(join(wt, 'notes.txt'));
  assert.equal(mark('jarl/004-dirty'), 'delete');
});

test('outside a git repository a Branch lease is not reported gone; handoff read counts what came after its own log line', () => {
  const loose = repo();
  jarl(loose, 'init', 'goal');
  jarl(loose, 'new', 'one');
  jarl(loose, 'set', '1', 'in-progress', 'w', '--branch', 'jarl/001-one');
  assert.deepEqual(JSON.parse(jarl(loose, 'status', '--json')).stale, []);
  jarl(loose, 'handoff', 'write', '--summary', 's');
  jarl(loose, 'new', 'two');
  assert.match(jarl(loose, 'handoff', 'read'), /· 1 log line\(s\) and 1 issue\(s\) changed since/, 'a line in the same minute as the handoff still counts');
});
