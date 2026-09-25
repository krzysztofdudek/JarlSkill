import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
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
    assert.match(jarl(hub, 'branches'), /^\[tool\] jarl\/001-change-a  \+1 /, mode);
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
