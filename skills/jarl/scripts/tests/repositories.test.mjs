// A repository an issue names is a name or a path. The record holds the name (the directory git clone gives the repository)
// and the declaration in .jarl/repos.md, never a machine's path; the machine holds where the checkout is, and Jarl checks
// the root commits of a declared repository against it on demand. Each case builds throwaway git repositories under the
// OS temporary directory with an explicit identity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, renameSync, symlinkSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import * as R from '../record.mjs';
import { run, jarl, refuses, SPAWN_TIMEOUT } from './helpers.mjs';
import { oldJarl, oldJarlIsPinned } from './old-jarl.mjs';

const L = await import('../jarl-lib.mjs');

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', timeout: SPAWN_TIMEOUT });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const tmp = (prefix) => realpathSync(mkdtempSync(join(tmpdir(), prefix)));
const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
// A repository at `dir` on `branch` with one commit per entry of `commits` (a file name and its content).
function repoAt(dir, { branch = 'main', commits = [['a.txt', 'a\n']] } = {}) {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', branch);
  for (const [file, content] of commits) {
    writeFileSync(join(dir, file), content);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', `add ${file}`);
  }
  return dir;
}
// A directory holding the loop's repository `hub` (with a loop opened in it) and a repository beside it for each name.
function world(...names) {
  const parent = tmp('jarl-repos-');
  const hub = repoAt(join(parent, 'hub'));
  jarl(hub, 'init', 'goal');
  const repos = Object.fromEntries(names.map((n) => [n, repoAt(join(parent, n), { commits: [[`${n}.txt`, `${n}\n`], ['b.txt', 'b\n']] })]));
  const file = (id) => { const dir = join(hub, '.jarl', 'issues'); return join(dir, readdirSync(dir).find((f) => Number(f.slice(0, f.indexOf('-'))) === Number(id))); };
  return { parent, hub, ...repos, issue: (id) => readFileSync(file(id), 'utf8'), log: () => readFileSync(join(hub, '.jarl', 'log.md'), 'utf8'), decl: () => readFileSync(join(hub, '.jarl', 'repos.md'), 'utf8') };
}
// A command line run starts from empty caches; a call into the library does not, so a test that moves checkouts between
// two questions empties them itself.
const identity = (root, name) => { L.resetCaches(); return L.repoIdentity(root, name); };
const roots = (dir) => git(dir, 'rev-list', '--max-parents=0', 'HEAD').split('\n').sort();
const neu = (hub, title, ...rest) => run(hub, ['new', title, '--tier', 'light', ...rest]);

// ---- naming ------------------------------------------------------------------------------------------

test('two sibling repositories get names and a third that is not a sibling keeps its path, with a note saying why', () => {
  const w = world('tool', 'lib');
  const away = repoAt(join(tmp('jarl-away-'), 'tool'));
  const first = neu(w.hub, 'a', '--repo', '../tool');
  assert.equal(first.status, 0, first.stderr);
  assert.doesNotMatch(first.stderr, /stored as the path/, 'a name needs no note');
  assert.match(w.issue(1), /^\*\*Repo:\*\* tool$/m);
  assert.equal(neu(w.hub, 'b', '--repo', '../lib').status, 0);
  const third = neu(w.hub, 'c', '--repo', away);
  assert.equal(third.status, 0, third.stderr);
  assert.match(third.stderr, /note: .* is stored as the path .*: another repository stands at .*tool, where its name would resolve, so this one keeps its path/);
  assert.match(w.issue(3), new RegExp(`^\\*\\*Repo:\\*\\* ${escaped(away)}$`, 'm'));
  // Declared once, with every root commit, the origin as found and the base, and no path.
  const lines = w.decl().split('\n').filter((l) => l.startsWith('- **'));
  assert.deepEqual(lines, [
    `- **tool** · roots ${roots(w.tool).join(', ')} · origin none · base main`,
    `- **lib** · roots ${roots(w.lib).join(', ')} · origin none · base main`,
  ]);
  assert.doesNotMatch(w.decl(), new RegExp(escaped(w.parent)));
  assert.match(w.log(), /repo tool declared · roots [0-9a-f]{40} · origin none · base main/);
  assert.equal(neu(w.hub, 'again', '--repo', 'tool').status, 0);
  assert.equal(w.decl().split('\n').filter((l) => l.startsWith('- **')).length, 2, 'a repository is declared once');
  assert.equal((w.log().match(/repo tool declared/g) || []).length, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(w.hub, '.jarl', 'profile.json'), 'utf8')), { 'jarl-profile': 1, format: 2 });
});

test('an issue with no Repo is read in the root of the loop, and a loop that names no repository writes no declaration', () => {
  const w = world('tool');
  R.newIssue(w.hub, 'plain');
  assert.doesNotMatch(w.issue(1), /\*\*Repo:\*\*/);
  assert.equal(existsSync(join(w.hub, '.jarl', 'repos.md')), false);
  assert.equal(existsSync(join(w.hub, '.jarl', 'profile.json')), false);
  assert.deepEqual(R.statusData(w.hub, { by: 'repo' }).by.groups, { hub: { open: 1, 'in-progress': 0, done: 0, dropped: 0, deferred: 0 } });
  assert.deepEqual(L.whereOf(w.hub, L.findIssue(w.hub, '1')), { repos: [], worktrees: [] });
});

test('repo changes the Repo field and the base with a log line each, and a change to nothing writes nothing', () => {
  const w = world('tool', 'lib');
  neu(w.hub, 'a', '--repo', 'tool');
  assert.equal(jarl(w.hub, 'repo', '1', 'lib'), '1 repo: lib');
  assert.match(w.log(), /1 repo · lib · was tool/);
  assert.equal(jarl(w.hub, 'repo', '1', 'lib'), '1 repo: lib (unchanged)');
  assert.equal((w.log().match(/1 repo · /g) || []).length, 1);
  assert.equal(jarl(w.hub, 'repo', '1', '--clear'), '1 repo: cleared');
  assert.match(w.log(), /1 repo · cleared · was lib/);
  assert.equal(jarl(w.hub, 'repo', '--base', 'tool', 'release/9'), 'tool base: release/9 (was main)');
  assert.match(w.decl(), /^- \*\*tool\*\* · roots [0-9a-f]{40} · origin none · base release\/9$/m);
  assert.match(w.log(), /repo tool base · was main · now release\/9/);
  assert.equal(jarl(w.hub, 'repo', '--base', 'tool', 'release/9'), 'tool base: release/9 (unchanged)');
  assert.equal((w.log().match(/repo tool base/g) || []).length, 1);
  assert.match(refuses(w.hub, 'repo', '--base', 'ghost', 'x'), /ghost is not declared in this loop/);
  assert.match(refuses(w.hub, 'repo', '--base', 'tool', 'a b'), /is not a branch name git accepts/);
  assert.match(refuses(w.hub, 'repo', '--base', 'tool', 'a · b'), /one branch name on one line/);
});

test('a name is a plain token: letters, digits, dash, underscore and dot inside', () => {
  const w = world('my.repo-2_x');
  assert.equal(neu(w.hub, 'dotted', '--repo', 'my.repo-2_x').status, 0);
  assert.match(w.issue(1), /^\*\*Repo:\*\* my\.repo-2_x$/m);
  for (const bad of ['bad name', 'a;b', 'x$y', 'a"b']) assert.match(refuses(w.hub, 'new', 'x', '--tier', 'light', '--repo', bad), /neither a path .* nor a repository name/, bad);
  assert.equal(L.repoValueKind(w.hub, 'tool'), 'name');
  assert.equal(L.repoValueKind(w.hub, './tool'), 'path');
  assert.equal(L.repoValueKind(w.hub, '../tool'), 'path');
  assert.equal(L.repoValueKind(w.hub, '/abs/tool'), 'path');
  assert.equal(L.repoValueKind(w.hub, 'C:/work/tool'), 'path');
  assert.equal(L.repoValueKind(w.hub, 'C:\\work\\tool'), 'path');
});

test('--repo takes a name, a checkout, a worktree of it or a file inside it, all reduced to the main checkout', () => {
  const w = world('tool');
  const wt = join(tmp('jarl-wt-'), 'tool-wt');
  git(w.tool, 'worktree', 'add', '-q', '-b', 'side', wt);
  neu(w.hub, 'a');
  for (const given of ['tool', '../tool', w.tool, wt, join(wt, 'tool.txt'), join(w.tool, 'tool.txt')]) {
    const r = run(w.hub, ['repo', '1', given]);
    assert.equal(r.status, 0, `${given}: ${r.stderr}`);
    assert.match(w.issue(1), /^\*\*Repo:\*\* tool$/m, given);
  }
  assert.match(refuses(w.hub, 'repo', '1', join(tmp('jarl-none-'), 'nothing')), /not a git repository/);
});

test('two repositories that share a directory name stay apart: the second keeps its path', () => {
  const w = world('tool');
  const away = repoAt(join(tmp('jarl-away-'), 'tool'), { commits: [['other.txt', 'other\n']] });
  neu(w.hub, 'in sibling', '--repo', 'tool', '--files', 'tool/x.mjs');
  const r = neu(w.hub, 'in away', '--repo', away, '--files', 'tool/x.mjs');
  assert.match(r.stderr, /note: .* is stored as the path/);
  assert.match(r.stderr, new RegExp(`another repository stands at ${escaped(w.tool)}, where its name would resolve, so this one keeps its path`));
  assert.doesNotMatch(r.stderr, /put it, or a symlink to it, there/, 'it never advises putting a checkout where another stands');
  assert.match(w.issue(2), new RegExp(`^\\*\\*Repo:\\*\\* ${escaped(away)}$`, 'm'));
  const next = JSON.parse(jarl(w.hub, 'next', '--all', '--json'));
  assert.equal(next.find((x) => x.id === '2').ready, true, 'the same file name in two repositories of one directory name does not hold');
  jarl(w.hub, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/1-x');
  const after = JSON.parse(jarl(w.hub, 'next', '--all', '--json'));
  assert.equal(after.find((x) => x.id === '2').ready, true);
});

test('the format of the loop decides how a value is read: a bare word is a path in format 1 and a name in format 2', () => {
  const w = world('tool');
  const nested = repoAt(join(w.hub, 'tool'));
  R.newIssue(w.hub, 'a');
  writeFileSync(join(w.hub, '.jarl', 'issues', readdirSync(join(w.hub, '.jarl', 'issues'))[0]), w.issue(1).replace(/^(\*\*Files:\*\*.*)$/m, '$1\n**Repo:** tool'));
  assert.equal(L.loadProfile(w.hub).format, 1);
  assert.equal(L.repoOf(w.hub, 'tool'), nested, 'format 1: a path under the root of the loop');
  assert.equal(L.repoValueKind(w.hub, 'tool'), 'path');
  L.raiseFormat(w.hub);
  L.resetCaches();
  assert.equal(L.repoOf(w.hub, 'tool'), join(w.parent, 'tool'), 'format 2: the sibling of the loop\'s checkout');
  assert.equal(L.repoOf(w.hub, './tool'), nested, 'a leading dot is a path in both');
});

// ---- the first name raises the record format -------------------------------------------------------

test('the first name raises the record format under the lock, writes bare-word paths as ./<word>, and the frozen reader refuses the loop', () => {
  assert.ok(oldJarlIsPinned());
  const w = world('tool');
  const nested = repoAt(join(w.hub, 'sub'));
  R.newIssue(w.hub, 'nested');
  const file = join(w.hub, '.jarl', 'issues', readdirSync(join(w.hub, '.jarl', 'issues'))[0]);
  writeFileSync(file, w.issue(1).replace(/^(\*\*Files:\*\*.*)$/m, '$1\n**Repo:** sub, ./other'));
  assert.equal(oldJarl(w.hub, 'list', {}).ok, true, 'before the first name the frozen reader reads the loop');
  assert.equal(L.loadProfile(w.hub).format, 1);
  R.newIssue(w.hub, 'named', { repo: 'tool' });
  assert.equal(L.loadProfile(w.hub).format, 2);
  assert.match(w.issue(1), /^\*\*Repo:\*\* \.\/sub, \.\/other$/m, 'the bare-word path says the same place unambiguously');
  assert.match(w.log(), /repo paths written as \.\/<word> in 0*1 · the record format is raised/);
  assert.equal(L.repoOf(w.hub, './sub'), nested);
  for (const command of ['list', 'status', 'next', 'queue']) {
    const r = oldJarl(w.hub, command, {});
    assert.equal(r.ok, false, command);
    assert.match(r.error, /written for record format 2/, command);
  }
  assert.match(jarl(w.hub, 'list', '--all'), /named/);
  assert.match(w.decl(), /^- \*\*tool\*\* · roots /m);
});

test('a loop that holds only paths is read by the frozen reader unchanged, whatever the repo lines say', () => {
  const w = world();
  repoAt(join(w.hub, 'sub'));
  const away = repoAt(join(tmp('jarl-away-'), 'far'));
  R.newIssue(w.hub, 'one', { repo: './sub' });
  R.newIssue(w.hub, 'two', { repo: away });
  R.setRepo(w.hub, '001', away);
  R.setRepo(w.hub, '001', undefined, { clear: true });
  R.setRepo(w.hub, '002', './sub');
  assert.match(w.log(), /001 repo · /);
  assert.equal(existsSync(join(w.hub, '.jarl', 'repos.md')), false, 'no name, no declaration');
  assert.equal(existsSync(join(w.hub, '.jarl', 'profile.json')), false, 'no name, no raised format');
  for (const command of ['list', 'status', 'next', 'queue', 'report']) assert.equal(oldJarl(w.hub, command, {}).ok, true, command);
  const old = oldJarl(w.hub, 'list', {}).value;
  assert.deepEqual(old.map((r) => [r.id, r.status]), L.cmdList(w.hub, {}).map((r) => [r.id, r.status]));
  assert.match(jarl(w.hub, 'show', '2'), /^\*\*Repo:\*\* \.\/sub$/m);
});

test('a path-only loop reads the same after a lease that checks a worktree and stores none', () => {
  const w = world();
  const sub = repoAt(join(w.hub, 'sub'));
  R.newIssue(w.hub, 'one', { repo: './sub' });
  const wt = join(tmp('jarl-wt-'), 'sub-wt');
  git(sub, 'worktree', 'add', '-q', '-b', 'jarl/1-one', wt);
  jarl(w.hub, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/1-one', '--worker', 'w1', '--worktree', wt);
  assert.equal(L.loadProfile(w.hub).format, 1);
  for (const command of ['list', 'status', 'next', 'queue']) assert.equal(oldJarl(w.hub, command, {}).ok, true, command);
});

// ---- resolution --------------------------------------------------------------------------------------

test('a symlink beside the checkout of the loop resolves a name', () => {
  const w = world();
  const real = repoAt(join(tmp('jarl-real-'), 'checkout-of-tool'));
  symlinkSync(real, join(w.parent, 'tool'), 'dir');
  const r = neu(w.hub, 'linked', '--repo', 'tool');
  assert.equal(r.status, 0, r.stderr);
  assert.match(w.issue(1), /^\*\*Repo:\*\* tool$/m);
  assert.equal(L.repoOf(w.hub, 'tool'), join(w.parent, 'tool'));
  assert.match(jarl(w.hub, 'show', '1'), new RegExp(`^repository tool is at ${escaped(join(w.parent, 'tool'))}$`, 'm'));
  assert.deepEqual(JSON.parse(jarl(w.hub, 'branches', '--repo', 'tool', '--json')), []);
});

test('a name that does not resolve is shown with its fix, refused by the commands that act on it, and marked by the views', () => {
  const w = world('tool');
  neu(w.hub, 'named', '--repo', 'tool');
  renameSync(w.tool, join(w.parent, 'tool-moved'));
  const fix = `put its checkout, or a symlink to it, at ${join(w.parent, 'tool')}`;
  assert.match(jarl(w.hub, 'show', '1'), new RegExp(`^the repository tool is not on this machine — ${escaped(fix)}$`, 'm'));
  const where = JSON.parse(jarl(w.hub, 'show', '1', '--json')).where;
  assert.deepEqual(where.repos.map((r) => [r.value, r.name, r.state]), [['tool', 'tool', 'missing']]);
  assert.match(where.repos[0].fix, new RegExp(escaped(fix)));
  assert.match(jarl(w.hub, 'status', '--by', 'repo'), new RegExp(`^ {2}tool {2}the repository tool is not on this machine — ${escaped(fix)}$`, 'm'));
  for (const args of [['check', '1', '--branch', 'x'], ['new', 'x', '--tier', 'light', '--repo', 'tool'], ['repo', '1', 'tool'], ['merged', '1', '--sha', 'abcd', '--repo', 'tool'], ['branches', '--repo', 'tool']]) {
    assert.match(refuses(w.hub, ...args), new RegExp(escaped(fix)), args.join(' '));
  }
  for (const view of [['branches'], ['tips'], ['queue'], ['resume'], ['status'], ['next', '--all'], ['report']]) assert.equal(run(w.hub, view).status, 0, view.join(' '));
});

test('a loop opened in a linked worktree resolves its siblings beside the main checkout', () => {
  const parent = tmp('jarl-linked-');
  const hub = repoAt(join(parent, 'hub'));
  const tool = repoAt(join(parent, 'tool'));
  jarl(hub, 'init', 'goal', '--committed');
  jarl(hub, 'new', 'named', '--tier', 'light', '--repo', 'tool');
  git(hub, 'add', '-A');
  git(hub, 'commit', '-qm', 'loop');
  const elsewhere = tmp('jarl-elsewhere-');
  const wt = join(elsewhere, 'hub-wt');
  git(hub, 'worktree', 'add', '-q', '-b', 'side', wt);
  assert.equal(L.mainCheckoutOf(wt).main, hub);
  assert.equal(existsSync(join(elsewhere, 'tool')), false);
  assert.match(jarl(wt, 'show', '1'), new RegExp(`^repository tool is at ${escaped(tool)}$`, 'm'));
  assert.equal(L.repoOf(wt, 'tool'), tool);
});

// A superproject with the loop and a repository as submodules: git's directory for a submodule is inside the superproject's
// .git, and its working tree is where the submodule is checked out.
function submoduleWorld() {
  const parent = tmp('jarl-sub-');
  const sources = { hub: repoAt(join(parent, 'src-hub')), tool: repoAt(join(parent, 'src-tool'), { commits: [['tool.txt', 'tool\n']] }) };
  const sup = repoAt(join(parent, 'super'));
  for (const n of ['hub', 'tool']) git(sup, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sources[n], n);
  git(sup, 'commit', '-qm', 'submodules');
  return { sup, hub: join(sup, 'hub'), tool: join(sup, 'tool') };
}

test('a loop kept in a submodule finds a sibling submodule by name beside its working tree, not inside the superproject\'s git directory', () => {
  const w = submoduleWorld();
  jarl(w.hub, 'init', 'goal');
  const r = run(w.hub, ['new', 'a', '--tier', 'light', '--repo', '../tool']);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /stored as the path/);
  assert.match(readFileSync(join(w.hub, '.jarl', 'issues', readdirSync(join(w.hub, '.jarl', 'issues'))[0]), 'utf8'), /^\*\*Repo:\*\* tool$/m);
  assert.equal(L.mainCheckoutOf(w.hub).main, w.hub);
  assert.equal(L.repoOf(w.hub, 'tool'), w.tool);
  assert.match(jarl(w.hub, 'show', '1'), new RegExp(`^repository tool is at ${escaped(w.tool)}$`, 'm'));
  assert.deepEqual(JSON.parse(jarl(w.hub, 'branches', '--repo', 'tool', '--json')), []);
  assert.equal(run(w.hub, ['check', '1', '--branch', 'main']).stderr.includes('.git/modules'), false);
  assert.equal(L.repoIdentity(w.hub, 'tool').state, 'verified');
});

test('a linked worktree of a submodule loop resolves its siblings beside the submodule\'s working tree', () => {
  const w = submoduleWorld();
  jarl(w.hub, 'init', 'goal', '--committed');
  jarl(w.hub, 'new', 'a', '--tier', 'light', '--repo', 'tool');
  git(w.hub, 'add', '-A');
  git(w.hub, 'commit', '-qm', 'loop');
  const wt = join(tmp('jarl-elsewhere-'), 'hub-wt');
  git(w.hub, 'worktree', 'add', '-q', '-b', 'side', wt);
  assert.equal(L.mainCheckoutOf(wt).main, w.hub);
  assert.equal(L.mainCheckoutOf(wt).linked, true);
  assert.match(jarl(wt, 'show', '1'), new RegExp(`^repository tool is at ${escaped(w.tool)}$`, 'm'));
  // A linked worktree of the sibling submodule is reduced to the submodule's own working tree.
  const toolWt = join(tmp('jarl-elsewhere-'), 'tool-wt');
  git(w.tool, 'worktree', 'add', '-q', '-b', 'side', toolWt);
  assert.equal(L.repoFromInput(w.hub, toolWt).main, w.tool);
  assert.equal(L.repoFromInput(w.hub, toolWt).name, 'tool');
});

test('a bare repository under a name is refused as a bare repository', () => {
  const w = world();
  const bare = join(w.parent, 'tool');
  mkdirSync(bare);
  git(bare, 'init', '-q', '--bare');
  assert.match(refuses(w.hub, 'new', 'x', '--tier', 'light', '--repo', 'tool'), /tool is a bare repository: it has no working tree to act on/);
  R.newIssue(w.hub, 'a');
  assert.match(refuses(w.hub, 'repo', '1', '../tool'), /is a bare repository: it has no working tree to act on/);
  const file = join(w.hub, '.jarl', 'issues', readdirSync(join(w.hub, '.jarl', 'issues'))[0]);
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^(\*\*Files:\*\*.*)$/m, '$1\n**Repo:** ../tool'));
  assert.match(refuses(w.hub, 'check', '1', '--branch', 'main'), /is a bare repository: it has no working tree to act on/);
  assert.doesNotMatch(refuses(w.hub, 'check', '1', '--branch', 'main'), /at null/);
});

test('a loop outside git looks for a name beside its own directory', () => {
  const parent = tmp('jarl-plain-');
  const root = join(parent, 'loop');
  mkdirSync(root);
  const tool = repoAt(join(parent, 'tool'));
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'named', '--tier', 'light', '--repo', 'tool');
  assert.match(readFileSync(join(root, '.jarl', 'issues', readdirSync(join(root, '.jarl', 'issues'))[0]), 'utf8'), /^\*\*Repo:\*\* tool$/m);
  assert.equal(L.repoOf(root, 'tool'), tool);
});

// ---- identity ----------------------------------------------------------------------------------------

test('the root commits of a declared repository decide whether the checkout under its name is that repository', () => {
  const w = world('tool');
  neu(w.hub, 'named', '--repo', 'tool');
  const same = identity(w.hub, 'tool');
  assert.equal(same.state, 'verified');
  assert.deepEqual(same.found, roots(w.tool));
  assert.deepEqual(same.notes, []);
  // Another repository stands under the name.
  renameSync(w.tool, join(w.parent, 'tool-real'));
  repoAt(join(w.parent, 'tool'), { commits: [['other.txt', 'a different repository\n']] });
  const other = identity(w.hub, 'tool');
  assert.equal(other.state, 'mismatch');
  assert.match(other.fix, /is another repository than tool .* put the checkout of tool, or a symlink to it, there/);
  assert.notDeepEqual(other.found, other.roots);
  // The real one back under the name verifies again.
  renameSync(join(w.parent, 'tool'), join(w.parent, 'tool-impostor'));
  renameSync(join(w.parent, 'tool-real'), join(w.parent, 'tool'));
  assert.equal(identity(w.hub, 'tool').state, 'verified');
  // Nothing there, and nothing declared.
  renameSync(join(w.parent, 'tool'), join(w.parent, 'tool-gone'));
  const missing = identity(w.hub, 'tool');
  assert.equal(missing.state, 'missing');
  assert.match(missing.fix, /put its checkout, or a symlink to it, at /);
  assert.equal(identity(w.hub, 'never-declared').state, 'undeclared');
});

test('a checkout that holds any declared root commit is the repository, and every root commit is kept', () => {
  const w = world('tool');
  const first = roots(w.tool)[0];
  git(w.tool, 'checkout', '-q', '--orphan', 'second-root');
  writeFileSync(join(w.tool, 'second.txt'), 'second\n');
  git(w.tool, 'add', '-A');
  git(w.tool, 'commit', '-qm', 'a second root');
  git(w.tool, 'checkout', '-q', 'main');
  git(w.tool, 'merge', '-q', '--allow-unrelated-histories', '-m', 'join', 'second-root');
  neu(w.hub, 'named', '--repo', 'tool');
  const declared = L.declaredRepos(w.hub).get('tool');
  assert.equal(declared.roots.length, 2);
  assert.deepEqual(declared.roots, [...declared.roots].sort());
  assert.ok(declared.roots.includes(first));
  // A clone of the repository as it was before the second root was joined holds one of the two.
  renameSync(w.tool, join(w.parent, 'tool-full'));
  const partial = join(w.parent, 'tool');
  git(w.parent, 'clone', '-q', '--branch', 'second-root', join(w.parent, 'tool-full'), partial);
  assert.deepEqual(identity(w.hub, 'tool').found, declared.roots.filter((r) => r !== first));
  assert.equal(identity(w.hub, 'tool').state, 'verified');
});

test('a different origin is a note and never a finding, and an origin is recorded without credentials', () => {
  const w = world('tool');
  git(w.tool, 'remote', 'add', 'origin', 'https://user:secret@github.com/acme/tool.git');
  neu(w.hub, 'named', '--repo', 'tool');
  assert.match(w.decl(), /^- \*\*tool\*\* · roots [0-9a-f]{40} · origin github\.com\/acme\/tool · base main$/m);
  assert.doesNotMatch(w.decl() + w.log(), /secret|user:/);
  assert.deepEqual(identity(w.hub, 'tool').notes, []);
  git(w.tool, 'remote', 'set-url', 'origin', 'git@github.com:acme/tool.git');
  assert.deepEqual(identity(w.hub, 'tool').notes, [], 'ssh against https is the same origin');
  git(w.tool, 'remote', 'set-url', 'origin', 'git@github.com:fork/tool.git');
  const fork = identity(w.hub, 'tool');
  assert.equal(fork.state, 'verified');
  assert.deepEqual(fork.notes, ['its origin is github.com/fork/tool, the declaration holds github.com/acme/tool (a fork or a renamed repository)']);
});

test('a shallow checkout reads unverified, and a declaration made from one holds no root commits', () => {
  const w = world('tool');
  neu(w.hub, 'named', '--repo', 'tool');
  renameSync(w.tool, join(w.parent, 'tool-full'));
  git(w.parent, 'clone', '-q', '--depth', '1', `file://${join(w.parent, 'tool-full')}`, join(w.parent, 'tool'));
  assert.equal(git(join(w.parent, 'tool'), 'rev-parse', '--is-shallow-repository'), 'true');
  const shallow = identity(w.hub, 'tool');
  assert.equal(shallow.state, 'unverified');
  assert.equal(shallow.found, null);
  assert.deepEqual(shallow.notes, ['a shallow checkout cannot show its root commits']);
  // Declared from a shallow checkout: roots unknown, and a full checkout then reads unverified too.
  const fresh = world();
  const full = repoAt(join(tmp('jarl-full-'), 'deep'), { commits: [['a.txt', 'a\n'], ['b.txt', 'b\n']] });
  git(fresh.parent, 'clone', '-q', '--depth', '1', `file://${full}`, join(fresh.parent, 'deep'));
  neu(fresh.hub, 'named', '--repo', 'deep');
  assert.match(fresh.decl(), /^- \*\*deep\*\* · roots unknown · origin none · base main$/m);
  assert.equal(L.declaredRepos(fresh.hub).get('deep').roots, null);
  assert.equal(identity(fresh.hub, 'deep').state, 'unverified');
});

test('no command other than the identity check reads the root commits: a wrong checkout under the name does not stop the commands that act', () => {
  const w = world('tool');
  neu(w.hub, 'named', '--repo', 'tool');
  renameSync(w.tool, join(w.parent, 'tool-real'));
  repoAt(join(w.parent, 'tool'), { branch: 'feature', commits: [['other.txt', 'another repository\n']] });
  assert.equal(identity(w.hub, 'tool').state, 'mismatch');
  for (const args of [['branches', '--repo', 'tool'], ['repo', '1', 'tool'], ['new', 'again', '--tier', 'light', '--repo', 'tool'], ['tips'], ['status', '--by', 'repo']]) {
    const r = run(w.hub, args);
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
    assert.doesNotMatch(r.stdout + r.stderr, /root commit/, args.join(' '));
  }
});

test('origin and root spellings: credentials and schemes are dropped, local paths are no origin', () => {
  assert.equal(L.originSpelling('https://github.com/a/b.git'), 'github.com/a/b');
  assert.equal(L.originSpelling('https://user:pw@github.com:8443/a/b'), 'github.com/a/b');
  assert.equal(L.originSpelling('ssh://git@host.example/a/b.git/'), 'host.example/a/b');
  assert.equal(L.originSpelling('git@host.example:a/b.git'), 'host.example/a/b');
  assert.equal(L.originSpelling('/srv/git/b.git'), null);
  assert.equal(L.originSpelling('../b'), null);
  assert.equal(L.originSpelling('file:///srv/git/b.git'), null);
  assert.equal(L.originSpelling('C:\\work\\b'), null);
  assert.equal(L.originSpelling(''), null);
  assert.equal(L.originSpelling(null), null);
});

// ---- the worktree of a lease -----------------------------------------------------------------------------

test('a new lease stores no worktree, and set --worktree checks the path and stores nothing', () => {
  const w = world('tool');
  const wt = join(tmp('jarl-wt-'), 'tool-wt');
  git(w.tool, 'worktree', 'add', '-q', '-b', 'jarl/1-a', wt);
  neu(w.hub, 'a', '--repo', 'tool');
  const r = run(w.hub, ['set', '1', 'in-progress', 'go', '--branch', 'jarl/1-a', '--worker', 'w1', '--worktree', wt]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /note: 1 --worktree was checked and is not recorded/);
  assert.doesNotMatch(w.issue(1), /\*\*Worktree:\*\*/);
  assert.match(w.log(), /1 → in-progress · go · branch jarl\/1-a · worker w1\n/);
  assert.doesNotMatch(w.log(), /worktree/);
  assert.equal(JSON.parse(jarl(w.hub, 'show', '1', '--json')).where.worktrees[0].path, wt);
  assert.match(jarl(w.hub, 'show', '1'), new RegExp(`^worktree of tool on jarl/1-a: ${escaped(wt)}$`, 'm'));
});

test('set --worktree through the command line refuses a wrong path and writes nothing, while the record library accepts and stores nothing', () => {
  const w = world('tool');
  const parent = tmp('jarl-wt-');
  const good = join(parent, 'good');
  git(w.tool, 'worktree', 'add', '-q', '-b', 'jarl/1-a', good);
  const wrongBranch = join(parent, 'wrong-branch');
  git(w.tool, 'worktree', 'add', '-q', '-b', 'jarl/9-other', wrongBranch);
  const plain = join(parent, 'plain');
  mkdirSync(plain);
  neu(w.hub, 'a', '--repo', 'tool');
  const before = readFileSync(join(w.hub, '.jarl', 'log.md'), 'utf8');
  const lease = ['set', '1', 'in-progress', 'go', '--branch', 'jarl/1-a', '--worker', 'w1', '--worktree'];
  assert.match(refuses(w.hub, ...lease, plain), /--worktree .*plain is not a worktree of tool/);
  assert.match(refuses(w.hub, ...lease, wrongBranch), /--worktree .*wrong-branch has jarl\/9-other checked out, not jarl\/1-a, the branch of the lease/);
  assert.match(refuses(w.hub, ...lease, w.tool), /has main checked out, not jarl\/1-a/);
  assert.equal(readFileSync(join(w.hub, '.jarl', 'log.md'), 'utf8'), before, 'a refused call writes nothing');
  assert.match(w.issue(1), /^\*\*Status:\*\* open$/m);
  // A path that does not exist is not checked; the right worktree passes.
  assert.equal(run(w.hub, [...lease, join(parent, 'not-yet')]).status, 0);
  assert.equal(run(w.hub, [...lease, good]).status, 0);
  // The record library, which composers such as Horde call, accepts the key and stores nothing, with no refusal.
  R.setStatus(w.hub, '1', 'open', 'back', {});
  const out = R.setStatus(w.hub, '1', 'in-progress', 'again', { branch: 'jarl/1-a', worker: 'w2', worktree: plain });
  assert.equal(out.status, 'in-progress');
  assert.equal(out.worktree, undefined);
  assert.doesNotMatch(w.issue(1), /\*\*Worktree:\*\*/);
  assert.doesNotMatch(w.log(), /worktree/);
});

test('the worktree of a lease is found by its branch in every state git can report, including one it lists as prunable', () => {
  const w = world('tool');
  const parent = tmp('jarl-wt-');
  neu(w.hub, 'a', '--repo', 'tool');
  jarl(w.hub, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/1-a', '--worker', 'w1');
  const stateOf = () => JSON.parse(jarl(w.hub, 'show', '1', '--json')).where.worktrees[0];
  assert.equal(stateOf().state, 'none');
  assert.match(jarl(w.hub, 'show', '1'), /^no worktree of tool holds jarl\/1-a$/m);
  const wt = join(parent, 'wt');
  git(w.tool, 'worktree', 'add', '-q', '-b', 'jarl/1-a', wt);
  assert.deepEqual([stateOf().state, stateOf().path], ['here', wt]);
  // Its directory goes while the directory around it stays: git lists it as prunable, and it is gone.
  renameSync(wt, join(parent, 'wt-away'));
  assert.equal(stateOf().state, 'gone');
  assert.match(jarl(w.hub, 'show', '1'), new RegExp(`^worktree of tool on jarl/1-a: ${escaped(wt)} \\(gone\\)$`, 'm'));
  // The directory around it goes too: git lists it, and this machine cannot see it.
  const deep = join(parent, 'deep');
  const inner = join(deep, 'wt2');
  git(w.tool, 'worktree', 'prune');
  git(w.tool, 'worktree', 'add', '-q', '-f', inner, 'jarl/1-a');
  renameSync(deep, join(parent, 'deep-away'));
  assert.equal(stateOf().state, 'invisible');
  assert.match(jarl(w.hub, 'show', '1'), /\(listed by git, not visible from here\)$/m);
  // Locked with a reason, and out of sight: elsewhere.
  renameSync(join(parent, 'deep-away'), deep);
  git(w.tool, 'worktree', 'lock', '--reason', 'a container', inner);
  renameSync(deep, join(parent, 'deep-away'));
  const elsewhere = stateOf();
  assert.deepEqual([elsewhere.state, elsewhere.reason], ['elsewhere', 'a container']);
  assert.match(jarl(w.hub, 'show', '1'), /\(elsewhere: a container\)$/m);
});

test('a lease that holds a Worktree field keeps it and is read as it was written, until it ends', () => {
  const w = world('tool');
  const parent = tmp('jarl-wt-');
  const wt = join(parent, 'wt');
  git(w.tool, 'worktree', 'add', '-q', '-b', 'jarl/1-a', wt);
  neu(w.hub, 'a', '--repo', 'tool');
  jarl(w.hub, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/1-a', '--worker', 'w1');
  const file = join(w.hub, '.jarl', 'issues', readdirSync(join(w.hub, '.jarl', 'issues'))[0]);
  writeFileSync(file, w.issue(1).replace(/^(\*\*Since:\*\* .*)$/m, `$1\n**Worktree:** ${wt}`));
  assert.doesNotMatch(jarl(w.hub, 'show', '1'), /^worktree of /m, 'a stored worktree is the header\'s own line');
  jarl(w.hub, 'set', '1', 'in-progress', 'again', '--worker', 'w2');
  assert.match(w.issue(1), new RegExp(`^\\*\\*Worktree:\\*\\* ${escaped(wt)}$`, 'm'), 'a lease move that names no worktree keeps the field');
  renameSync(wt, join(parent, 'wt-away'));
  assert.match(jarl(w.hub, 'status'), new RegExp(`stale 1 · worktree gone: ${escaped(wt)}`));
  jarl(w.hub, 'set', '1', 'open', 'back');
  assert.doesNotMatch(w.issue(1), /\*\*Worktree:\*\*/, 'leaving in-progress removes it');
});

// ---- the views -------------------------------------------------------------------------------------

test('status --by repo prints where each repository is, its base and whether its checkout is on it, on stdout only, and writes nothing', () => {
  const w = world('tool', 'lib');
  neu(w.hub, 'a', '--repo', 'tool');
  neu(w.hub, 'b', '--repo', 'lib');
  neu(w.hub, 'c');
  git(w.lib, 'checkout', '-q', '-b', 'topic');
  const snapshot = () => ['log.md', 'repos.md', 'profile.json'].map((f) => readFileSync(join(w.hub, '.jarl', f), 'utf8')).concat(readdirSync(join(w.hub, '.jarl', 'issues')).map((f) => readFileSync(join(w.hub, '.jarl', 'issues', f), 'utf8')));
  const before = snapshot();
  const r = run(w.hub, ['status', '--by', 'repo']);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /^where each repository is on this machine:$/m);
  assert.match(r.stdout, new RegExp(`^ {2}tool {2}${escaped(w.tool)} · base main · on main$`, 'm'));
  assert.match(r.stdout, new RegExp(`^ {2}lib {2}${escaped(w.lib)} · base main · WARNING: its checkout is on topic, not on its base$`, 'm'));
  assert.match(r.stdout, new RegExp(`^ {2}hub {2}${escaped(w.hub)} · on main$`, 'm'));
  const json = JSON.parse(jarl(w.hub, 'status', '--by', 'repo', '--json')).by.where;
  assert.deepEqual(json.lib, { name: 'lib', path: w.lib, state: 'here', base: 'main', current: 'topic', onBase: false });
  assert.equal(json.tool.onBase, true);
  assert.equal(json.hub.base, null);
  assert.deepEqual(snapshot(), before, 'nothing resolved is written');
  assert.doesNotMatch(jarl(w.hub, 'status'), /where each repository/, 'only --by repo prints it');
});

test('show prints where a repository written as a name is, on stdout only, and writes nothing', () => {
  const w = world('tool');
  neu(w.hub, 'a', '--repo', 'tool');
  const before = w.log() + w.issue(1) + w.decl();
  const r = run(w.hub, ['show', '1']);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, new RegExp(`^repository tool is at ${escaped(w.tool)}$`, 'm'));
  assert.deepEqual(JSON.parse(run(w.hub, ['show', '1', '--json']).stdout).where, { repos: [{ value: 'tool', name: 'tool', path: w.tool, state: 'here' }], worktrees: [] });
  assert.equal(w.log() + w.issue(1) + w.decl(), before);
  // A repository written as a path says nothing more than its value.
  repoAt(join(w.hub, 'sub'));
  neu(w.hub, 'p', '--repo', './sub');
  assert.doesNotMatch(jarl(w.hub, 'show', '2'), /^repository /m);
});

test('merged names the repository the way the Repo field does, and the merge line follows it', () => {
  const w = world('tool');
  neu(w.hub, 'a', '--repo', 'tool');
  const sha = git(w.tool, 'rev-parse', '--short', 'HEAD');
  const r = run(w.hub, ['merged', '1', '--sha', sha, '--ci', 'none', '--keep', '--repo', join(w.tool, 'tool.txt')]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(w.issue(1), new RegExp(`^\\*\\*Merged:\\*\\* ${sha} in tool$`, 'm'));
  assert.match(w.log(), new RegExp(`1 merged ${sha} in tool · CI none`));
  assert.equal(L.mergedOf(L.findIssue(w.hub, '1')).repo, 'tool');
  assert.equal(L.repoOf(w.hub, L.mergedOf(L.findIssue(w.hub, '1')).repo), w.tool);
});

test('import --repo declares nothing on a dry run, and once when it files', () => {
  const w = world('tool');
  const dir = tmp('report-2026-10-01-');
  writeFileSync(join(dir, 'findings.json'), JSON.stringify([{ id: 'f-1', kind: 'defect', priority: 'high', title: 'a defect', where: 'x:1', evidence: 'e', proposal: 'p', effort: 'S' }]));
  const file = join(dir, 'findings.json');
  jarl(w.hub, 'import', file, '--source', 'core/research/2026-10-01-x', '--repo', 'tool', '--dry-run');
  assert.equal(existsSync(join(w.hub, '.jarl', 'repos.md')), false);
  assert.equal(existsSync(join(w.hub, '.jarl', 'profile.json')), false);
  jarl(w.hub, 'import', file, '--source', 'core/research/2026-10-01-x', '--repo', '../tool');
  assert.match(w.issue(1), /^\*\*Repo:\*\* tool$/m);
  assert.equal(w.decl().split('\n').filter((l) => l.startsWith('- **')).length, 1);
});

test('the files and the leases of a loop are never given a machine\'s path by a name', () => {
  const w = world('tool');
  neu(w.hub, 'a', '--repo', '../tool', '--files', 'tool/src/a.mjs');
  jarl(w.hub, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/1-a', '--worker', 'w1');
  const everything = [w.log(), w.decl(), w.issue(1), readFileSync(join(w.hub, '.jarl', 'profile.json'), 'utf8')].join('\n');
  assert.doesNotMatch(everything, new RegExp(escaped(w.parent)));
  assert.doesNotMatch(everything, new RegExp(escaped(dirname(w.parent))));
});

// ---- every raise of the format keeps a bare-word path pointing where it pointed ---------------------------------------

// A loop written by the frozen reader's library: a repository nested under the loop's root is written as the bare word
// api, its merge is recorded with that word, and a different repository named api stands beside the loop. A branch of the
// same name is in both, so a reader that picks the wrong one deletes the wrong branch.
function nestedWorld() {
  const w = world('lib');
  const api = repoAt(join(w.hub, 'api'), { commits: [['api.txt', 'api\n']] });
  git(api, 'checkout', '-q', '-b', 'jarl/1-x');
  writeFileSync(join(api, 'w.txt'), 'w\n');
  git(api, 'add', '-A');
  git(api, 'commit', '-qm', 'work');
  git(api, 'checkout', '-q', 'main');
  git(api, 'merge', '-q', '--no-ff', '-m', 'merge', 'jarl/1-x');
  const sha = git(api, 'rev-parse', '--short', 'HEAD');
  const sibling = repoAt(join(w.parent, 'api'), { commits: [['sibling.txt', 'sibling\n']] });
  git(sibling, 'branch', 'jarl/1-x');
  R.newIssue(w.hub, 'nested work');
  const first = join(w.hub, '.jarl', 'issues', readdirSync(join(w.hub, '.jarl', 'issues')).find((f) => f.startsWith('001-')));
  writeFileSync(first, readFileSync(first, 'utf8').replace(/^(\*\*Files:\*\*.*)$/m, '$1\n**Repo:** api'));
  R.setStatus(w.hub, '001', 'in-progress', '', { branch: 'jarl/1-x', worker: 'w1' });
  R.newIssue(w.hub, 'second');
  R.setStatus(w.hub, '002', 'in-progress', '', { branch: 'jarl/2-y', worker: 'w2' });
  R.addEvidence(w.hub, '002', undefined, { ran: 't', saw: 'ok' });
  R.review(w.hub, '002', 'approve', 'read the diff, nothing found here', { by: 'rev' });
  const merged = oldJarl(w.hub, 'merged', {}, ['001', { sha, ci: 'green', repo: 'api' }]);
  assert.equal(merged.ok, true, merged.error);
  assert.match(w.issue(1), new RegExp(`^\\*\\*Merged:\\*\\* ${sha} in api$`, 'm'));
  return { ...w, api, sibling, sha };
}
const branchesOf = (dir) => git(dir, 'branch', '--list', '--format=%(refname:short)').split('\n');
const TRIGGERS = {
  'a name': (w) => R.newIssue(w.hub, 'named', { repo: 'lib' }),
  'a plain issue number on new': (w) => jarl(w.hub, 'new', 'plain', '--tier', 'light'),
  'import': (w) => {
    const dir = tmp('report-2026-10-01-');
    writeFileSync(join(dir, 'findings.json'), JSON.stringify([{ id: 'f-1', kind: 'defect', priority: 'high', title: 'a defect', where: 'x:1', evidence: 'e', proposal: 'p', effort: 'S' }]));
    jarl(w.hub, 'import', join(dir, 'findings.json'), '--source', 'core/research/2026-10-01-x');
  },
  'a question': (w) => jarl(w.hub, 'ask', 'which way?'),
  'the retraction of a review': (w) => jarl(w.hub, 'review', '2', 'retract', '--by', 'x', 'the approve was wrong'),
  'the retraction of an evidence row': (w) => jarl(w.hub, 'evidence', '2', '--retract', '1', '--by', 'x', 'the row was wrong'),
};
for (const [trigger, raise] of Object.entries(TRIGGERS)) {
  test(`${trigger} raises the format and every bare-word path keeps addressing the nested repository, never the sibling of the same name`, () => {
    const w = nestedWorld();
    assert.equal(L.loadProfile(w.hub).format, 1);
    assert.equal(oldJarl(w.hub, 'list', {}).ok, true);
    raise(w);
    assert.equal(L.loadProfile(w.hub).format, 2);
    assert.match(w.issue(1), /^\*\*Repo:\*\* \.\/api$/m);
    assert.match(w.issue(1), new RegExp(`^\\*\\*Merged:\\*\\* ${w.sha} in \\./api$`, 'm'));
    assert.match(w.log(), new RegExp(`001 merged ${w.sha} in \\./api · CI green`));
    L.resetCaches();
    const issue = L.findIssue(w.hub, '001');
    assert.equal(L.mergedOf(issue).repo, './api');
    assert.equal(L.repoOf(w.hub, L.mergedOf(issue).repo), w.api, 'the done gate reads the merge where it landed');
    assert.equal(L.whereOf(w.hub, issue).repos[0].path, w.api);
    assert.equal(JSON.parse(jarl(w.hub, 'status', '--by', 'repo', '--json')).by.where.api.path, w.api);
    assert.equal(JSON.parse(run(w.hub, ['check', '1', '--branch', 'jarl/1-x', '--json']).stdout).repo, w.api);
    const tips = jarl(w.hub, 'tips');
    assert.match(tips, new RegExp(escaped(w.api)));
    assert.doesNotMatch(tips, new RegExp(`${escaped(w.sibling)}\\b`));
    assert.match(jarl(w.hub, 'branches'), /^\[api\] jarl\/1-x → 001 /m);
    assert.equal(run(w.hub, ['queue']).status, 0);
    // The merge's cleanup removes the branch in the nested repository and leaves the sibling's alone.
    jarl(w.hub, 'merged', '1', '--sha', w.sha, '--ci', 'green');
    assert.equal(branchesOf(w.api).includes('jarl/1-x'), false);
    assert.equal(branchesOf(w.sibling).includes('jarl/1-x'), true, 'a branch in the sibling is never touched');
    // A second raise changes nothing more: the rewrite is idempotent.
    const before = [w.issue(1), w.log()];
    L.withLock(w.hub, () => L.raiseFormat(w.hub));
    assert.deepEqual([w.issue(1), w.log()], before);
  });
}

test('a free note shaped like a merge line, and a merge line of no issue of the loop, are never rewritten by the format raise', () => {
  const w = nestedWorld();
  jarl(w.hub, 'log', `release merged ${w.sha} in api · CI green`);
  writeFileSync(join(w.hub, '.jarl', 'log.md'), `${w.log()}- 2026-10-01 10:00 · 77 merged ${w.sha} in api · CI green\n- 2026-10-01 10:01 · 001 merged ${w.sha} in api · odd segment\n`);
  jarl(w.hub, 'new', 'plain', '--tier', 'light');
  const log = w.log();
  assert.match(log, new RegExp(`001 merged ${w.sha} in \\./api · CI green`), 'the tool\'s own merge line is rewritten');
  assert.match(log, new RegExp(`release merged ${w.sha} in api · CI green`));
  assert.match(log, new RegExp(`77 merged ${w.sha} in api · CI green`));
  assert.match(log, new RegExp(`001 merged ${w.sha} in api · odd segment`));
});

test('every command that acts on a name that does not resolve refuses it with the fix, merged with and without --repo among them, and the views mark it', () => {
  const w = world('tool');
  neu(w.hub, 'a', '--repo', 'tool');
  jarl(w.hub, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/1-x', '--worker', 'w1');
  for (const emptyDirectoryThere of [false, true]) {
    renameSync(w.tool, `${w.tool}-moved`);
    if (emptyDirectoryThere) mkdirSync(w.tool);
    const fix = `put its checkout, or a symlink to it, at ${join(w.parent, 'tool')}`;
    const before = w.log() + w.issue(1);
    for (const args of [['merged', '1', '--sha', 'abcd1234', '--ci', 'green'], ['merged', '1', '--sha', 'abcd1234', '--repo', 'tool'], ['check', '1', '--branch', 'jarl/1-x'], ['branches', '--repo', 'tool'], ['queue', '--repo', 'tool']]) {
      assert.match(refuses(w.hub, ...args), new RegExp(escaped(fix)), args.join(' '));
    }
    assert.equal(w.log() + w.issue(1), before, 'a refused call writes nothing');
    for (const view of [['tips'], ['queue'], ['branches'], ['status', '--by', 'repo'], ['show', '1']]) assert.equal(run(w.hub, view).status, 0, view.join(' '));
    assert.match(jarl(w.hub, 'status', '--by', 'repo'), /the repository tool is not on this machine/);
    if (emptyDirectoryThere) renameSync(w.tool, `${w.tool}-empty`);
    renameSync(`${w.tool}-moved`, w.tool);
  }
});

test('the merge cleanup deletes only in a checkout whose root commits were compared and found equal', () => {
  // Verified: the branch goes.
  let w = world('tool');
  neu(w.hub, 'a', '--repo', 'tool');
  git(w.tool, 'branch', 'jarl/1-x');
  jarl(w.hub, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/1-x', '--worker', 'w1');
  assert.match(jarl(w.hub, 'merged', '1', '--sha', git(w.tool, 'rev-parse', '--short', 'HEAD')), /removed the branch jarl\/1-x/);
  assert.equal(branchesOf(w.tool).includes('jarl/1-x'), false);
  // A shallow clone of a different repository under the name: unverified, so nothing is deleted.
  w = world('tool');
  neu(w.hub, 'a', '--repo', 'tool');
  jarl(w.hub, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/1-x', '--worker', 'w1');
  renameSync(w.tool, join(w.parent, 'tool-real'));
  const full = repoAt(join(tmp('jarl-full-'), 'other'), { commits: [['o.txt', 'one\n'], ['p.txt', 'two\n']] });
  git(w.parent, 'clone', '-q', '--depth', '1', `file://${full}`, join(w.parent, 'tool'));
  git(w.tool, 'branch', 'jarl/1-x');
  const out = jarl(w.hub, 'merged', '1', '--sha', git(w.tool, 'rev-parse', '--short', 'HEAD'));
  assert.match(out, /kept jarl\/1-x — the checkout under the name tool is not verified as that repository \(unverified: a shallow checkout cannot show its root commits\), so nothing is deleted in it/);
  assert.equal(branchesOf(w.tool).includes('jarl/1-x'), true);
  // A shallow clone of the right repository is unverified too, and keeps everything.
  w = world('tool');
  neu(w.hub, 'a', '--repo', 'tool');
  jarl(w.hub, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/1-x', '--worker', 'w1');
  renameSync(w.tool, join(w.parent, 'tool-real'));
  git(w.parent, 'clone', '-q', '--depth', '1', `file://${join(w.parent, 'tool-real')}`, join(w.parent, 'tool'));
  git(w.tool, 'branch', 'jarl/1-x');
  assert.match(jarl(w.hub, 'merged', '1', '--sha', git(w.tool, 'rev-parse', '--short', 'HEAD')), /kept jarl\/1-x — .*not verified/);
  assert.equal(branchesOf(w.tool).includes('jarl/1-x'), true);
});

test('merged refuses to act when the checkout under a name holds none of the declared root commits, and deletes no branch', () => {
  const w = world('tool');
  neu(w.hub, 'a', '--repo', 'tool');
  git(w.tool, 'branch', 'jarl/1-x');
  jarl(w.hub, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/1-x', '--worker', 'w1');
  const sha = git(w.tool, 'rev-parse', '--short', 'HEAD');
  renameSync(w.tool, join(w.parent, 'tool-real'));
  const other = repoAt(join(w.parent, 'tool'), { commits: [['other.txt', 'another repository\n']] });
  git(other, 'branch', 'jarl/1-x');
  const before = w.log() + w.issue(1);
  assert.match(refuses(w.hub, 'merged', '1', '--sha', sha, '--ci', 'green'), /is another repository than tool/);
  assert.match(refuses(w.hub, 'merged', '1', '--sha', sha, '--ci', 'green', '--repo', 'tool'), /is another repository than tool/);
  assert.equal(w.log() + w.issue(1), before, 'nothing was written');
  assert.equal(branchesOf(other).includes('jarl/1-x'), true);
});

// ---- a value that names no repository is refused ----------------------------------------------------------------

test('a path that does not exist, and a value with a line break or the log\'s separator, are refused naming the value, and store nothing', () => {
  const w = world('tool');
  neu(w.hub, 'a');
  for (const [given, pattern] of [
    ['../alpha', /--repo "\.\.\/alpha"/],
    ['./subx', /--repo "\.\/subx"/],
    ['./tool\n./x', /--repo ".*\\n.*" is on more than one line/],
    ['tool · x', /--repo "tool · x" is on more than one line or holds the log's separator/],
  ]) {
    for (const args of [['repo', '1', given], ['new', 'b', '--tier', 'light', '--repo', given]]) {
      const said = refuses(w.hub, ...args);
      assert.match(said, pattern, JSON.stringify(given));
      assert.match(said, /not a git repository|more than one line/);
    }
  }
  assert.doesNotMatch(w.issue(1), /\*\*Repo:\*\*/);
  assert.equal(existsSync(join(w.hub, '.jarl', 'repos.md')), false);
  assert.equal(JSON.parse(jarl(w.hub, 'list', '--all', '--json')).length, 1, 'no issue was filed');
});

// ---- declarations -----------------------------------------------------------------------------------------------

test('the declaration file opens with its fixed text', () => {
  const w = world('tool');
  neu(w.hub, 'a', '--repo', 'tool');
  const text = readFileSync(join(w.hub, '.jarl', 'repos.md'), 'utf8');
  assert.ok(text.startsWith('# Repositories\n\nEach line declares a repository that an issue names by name: its root commits, its origin as found, its base branch, and no path. Jarl writes this file and nothing else does. A name stands for the checkout beside the main checkout of the loop.\n\n- **tool** · '));
  assert.equal(text, `${L.REPOS_HEADER}- **tool** · roots ${roots(w.tool).join(', ')} · origin none · base main\n`);
});

test('a checkout with no branch is declared with no base, and says so', () => {
  const w = world('tool');
  git(w.tool, 'checkout', '-q', '--detach');
  const r = neu(w.hub, 'a', '--repo', 'tool');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /note: tool has no branch checked out, so it is declared with no base — name one with repo --base tool <branch>/);
  assert.match(w.decl(), /^- \*\*tool\*\* · roots [0-9a-f]{40} · origin none · base none$/m);
  assert.equal(L.declaredRepos(w.hub).get('tool').base, null);
  assert.equal(jarl(w.hub, 'repo', '--base', 'tool', 'main'), 'tool base: main (was none)');
});

test('a name written in another case is the one declared name when the disk ignores case', (t) => {
  const w = world('tool');
  if (!existsSync(join(w.parent, 'TOOL'))) { t.skip('this disk tells TOOL from tool'); return; }
  neu(w.hub, 'a', '--repo', 'tool');
  const r = neu(w.hub, 'b', '--repo', 'TOOL');
  assert.equal(r.status, 0, r.stderr);
  assert.match(w.issue(2), /^\*\*Repo:\*\* tool$/m);
  assert.equal(w.decl().split('\n').filter((l) => l.startsWith('- **')).length, 1);
});
