// After merged records a sha, the issue's worktree and its local branch are removed when that is safe, and kept, with the
// reason named, when it is not: every condition that keeps them is exercised one by one in a throwaway repository under
// the OS temporary directory, with an explicit git identity. Jarl removes with `git worktree remove` and `git branch -d`
// only: no force, no remote branch. The command line and the tools do it, `--keep` skips it, a library caller never gets it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, renameSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as R from '../record.mjs';
import { spawnJarl, jarl, SPAWN_TIMEOUT } from './helpers.mjs';

const L = await import('../jarl-lib.mjs');
const SCRIPT =fileURLToPath(new URL('../jarl.mjs', import.meta.url));

const run = (root, ...args) => spawnJarl(root, args);
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', timeout: SPAWN_TIMEOUT });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const branches = (repo) => git(repo, 'branch', '--list', '--format=%(refname:short)').split('\n').filter(Boolean);
const worktrees = (repo) => git(repo, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9));

// A repository on `main` that is also the loop's root, with its first issue leased on jarl/1-x in a worktree beside it that holds
// one commit. `merge: true` merges the branch into main with a merge commit, the way the merger does.
function fixture({ merge = true, issues = 1, worktree = true } = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'jarl-clean-'));
  const repo = join(parent, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  jarl(repo, 'init', 'goal');
  for (let k = 1; k <= issues; k += 1) jarl(repo, 'new', `issue ${k}`, '--acceptance', 'it works');
  const wt = join(parent, 'wt-1');
  if (worktree) git(repo, 'worktree', 'add', '-q', '-b', 'jarl/1-x', wt);
  else git(repo, 'branch', 'jarl/1-x');
  const work = worktree ? wt : repo;
  if (worktree) {
    writeFileSync(join(wt, 'b.txt'), 'b\n');
    git(wt, 'add', '-A');
    git(wt, 'commit', '-qm', 'work');
  } else {
    git(repo, 'checkout', '-q', 'jarl/1-x');
    writeFileSync(join(repo, 'b.txt'), 'b\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'work');
    git(repo, 'checkout', '-q', 'main');
  }
  void work;
  jarl(repo, 'set', '1', 'in-progress', 'start', '--branch', 'jarl/1-x', '--worker', 'w-one', ...(worktree ? ['--worktree', wt] : []));
  if (merge) git(repo, 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x');
  return { parent, repo, wt, sha: git(repo, 'rev-parse', '--short', 'HEAD') };
}

// A lease that holds a Worktree field, as a lease can: set --worktree checks a path and stores nothing, so the field is written
// into the issue file directly.
function holdsWorktree(repo, id, path) {
  const dir = join(repo, '.jarl', 'issues');
  const file = join(dir, readdirSync(dir).find((f) => f.startsWith(`${id}-`)));
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^(\*\*Since:\*\* .*)$/m, `$1\n**Worktree:** ${path}`));
}

test('after merged on a branch whose tip is in the base, the worktree and the local branch are gone and the output says so', () => {
  const { repo, wt, sha } = fixture();
  const out = run(repo, 'merged', '1', '--sha', sha);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout.trim(), new RegExp(`^1 merged ${sha}\\nremoved the worktree .*wt-1 and the branch jarl/1-x$`));
  assert.equal(existsSync(wt), false);
  assert.deepEqual(branches(repo), ['main']);
  assert.deepEqual(worktrees(repo).length, 1);
  assert.match(readFileSync(join(repo, '.jarl', 'log.md'), 'utf8'), new RegExp(`1 merged ${sha}`), 'the merge is on the record');
});

test('a branch with no worktree is removed alone', () => {
  const { repo, sha } = fixture({ worktree: false });
  assert.match(jarl(repo, 'merged', '1', '--sha', sha), /\nremoved the branch jarl\/1-x$/);
  assert.deepEqual(branches(repo), ['main']);
});

test('--keep leaves the worktree and the branch', () => {
  const { repo, wt, sha } = fixture();
  assert.equal(jarl(repo, 'merged', '1', '--sha', sha, '--keep'), `1 merged ${sha}`);
  assert.equal(existsSync(wt), true);
  assert.deepEqual(branches(repo).sort(), ['jarl/1-x', 'main']);
});

test('a library call gets no cleanup', () => {
  const { repo, wt, sha } = fixture();
  const out = R.recordMerged(repo, '1', { sha });
  assert.equal('cleanup' in out, false);
  assert.equal(existsSync(wt), true);
  assert.deepEqual(branches(repo).sort(), ['jarl/1-x', 'main']);
});

test('uncommitted changes in the worktree keep both', () => {
  const { repo, wt, sha } = fixture();
  writeFileSync(join(wt, 'b.txt'), 'changed\n');
  const out = jarl(repo, 'merged', '1', '--sha', sha);
  assert.match(out, /\nkept jarl\/1-x — its worktree holds 1 uncommitted or untracked file\(s\)$/);
  assert.equal(existsSync(wt), true);
  assert.deepEqual(branches(repo).sort(), ['jarl/1-x', 'main']);
});

test('an untracked file in the worktree keeps both', () => {
  const { repo, wt, sha } = fixture();
  writeFileSync(join(wt, 'new.txt'), 'new\n');
  assert.match(jarl(repo, 'merged', '1', '--sha', sha), /\nkept jarl\/1-x — its worktree holds 1 uncommitted or untracked file\(s\)$/);
  assert.equal(existsSync(wt), true);
  assert.deepEqual(branches(repo).sort(), ['jarl/1-x', 'main']);
});

test('another issue that still holds a lease on the branch keeps both; once it is settled they go', () => {
  const { repo, wt, sha } = fixture({ issues: 2 });
  jarl(repo, 'set', '2', 'in-progress', 'start', '--branch', 'jarl/1-x', '--worker', 'w-one');
  assert.match(jarl(repo, 'merged', '1', '--sha', sha), /\nkept jarl\/1-x — 2 still holds a lease on it$/);
  assert.equal(existsSync(wt), true);
  assert.deepEqual(branches(repo).sort(), ['jarl/1-x', 'main']);
  // The package merged together is cleaned once.
  assert.match(jarl(repo, 'merged', '1,2', '--sha', sha), /\nremoved the worktree .*wt-1 and the branch jarl\/1-x$/);
  assert.deepEqual(branches(repo), ['main']);
});

test('a tip that is neither in the base nor in the recorded merge keeps both', () => {
  const { repo, wt, sha } = fixture({ merge: false });
  const out = jarl(repo, 'merged', '1', '--sha', sha);
  assert.match(out, new RegExp(`\\nkept jarl/1-x — its tip is neither in main nor in the merge ${sha}$`));
  assert.equal(existsSync(wt), true);
  assert.deepEqual(branches(repo).sort(), ['jarl/1-x', 'main']);
});

test('the base is kept, and so is a release branch', () => {
  const { repo, sha } = fixture({ worktree: false });
  jarl(repo, 'set', '1', 'in-progress', 'again', '--branch', 'main', '--worker', 'w-one');
  assert.match(jarl(repo, 'merged', '1', '--sha', sha), /\nkept main — it is the base or a release branch$/);
  assert.ok(branches(repo).includes('main'));
  git(repo, 'branch', 'release/1.0', 'jarl/1-x');
  jarl(repo, 'set', '1', 'in-progress', 'again', '--branch', 'release/1.0', '--worker', 'w-one');
  assert.match(jarl(repo, 'merged', '1', '--sha', sha), /\nkept release\/1\.0 — it is the base or a release branch$/);
  assert.ok(branches(repo).includes('release/1.0'));
});

test('a branch checked out in another worktree than the one the lease names keeps both', () => {
  const { parent, repo, wt, sha } = fixture();
  const named = join(parent, 'somewhere-else');
  mkdirSync(named);
  jarl(repo, 'set', '1', 'in-progress', 'again', '--branch', 'jarl/1-x', '--worker', 'w-one');
  holdsWorktree(repo, '1', named);
  assert.match(jarl(repo, 'merged', '1', '--sha', sha), /\nkept jarl\/1-x — it is checked out in another worktree than the one the lease names$/);
  assert.equal(existsSync(wt), true);
  assert.deepEqual(branches(repo).sort(), ['jarl/1-x', 'main']);
});

test('a worktree that is not on this machine (listed, locked, its directory out of sight) keeps both', () => {
  const { parent, repo, wt, sha } = fixture();
  git(repo, 'worktree', 'lock', '--reason', 'a container', wt);
  const away = join(parent, 'moved-away');
  renameSync(wt, away);
  assert.match(jarl(repo, 'merged', '1', '--sha', sha), /\nkept jarl\/1-x — its worktree is not on this machine$/);
  assert.deepEqual(branches(repo).sort(), ['jarl/1-x', 'main']);
  assert.equal(existsSync(away), true, 'nothing was touched');
});

test('a worktree git lists whose directory is gone keeps the branch', () => {
  const { parent, repo, wt, sha } = fixture();
  renameSync(wt, join(parent, 'moved-away'));
  const out = jarl(repo, 'merged', '1', '--sha', sha);
  assert.match(out, /\nkept jarl\/1-x — git lists its worktree but its directory is missing here$/);
  assert.deepEqual(branches(repo).sort(), ['jarl/1-x', 'main']);
});

test('a worktree holding an ignored file is kept, the reason names it and the git commands are printed; nothing is removed', () => {
  const { repo, wt, sha } = fixture();
  appendFileSync(join(repo, '.git', 'info', 'exclude'), '*.secret\n');
  writeFileSync(join(wt, 'token.secret'), 'x\n');
  const out = jarl(repo, 'merged', '1', '--sha', sha);
  assert.match(out, /\nkept jarl\/1-x — its worktree holds ignored files: token\.secret\nafter looking at the files, remove them with:\n {2}git -C '?.*repo'? worktree remove --force .*wt-1\n {2}git -C '?.*repo'? branch -d jarl\/1-x$/);
  assert.equal(readFileSync(join(wt, 'token.secret'), 'utf8'), 'x\n');
  assert.deepEqual(branches(repo).sort(), ['jarl/1-x', 'main']);
});

test('an untracked file is seen whatever the repository hides, and the printed commands are safe to paste', () => {
  const { repo, wt, sha } = fixture();
  git(repo, 'config', 'status.showUntrackedFiles', 'no');
  writeFileSync(join(wt, 'hidden.txt'), 'h\n');
  assert.match(jarl(repo, 'merged', '1', '--sha', sha), /\nkept jarl\/1-x — its worktree holds 1 uncommitted or untracked file\(s\)$/);
  assert.equal(readFileSync(join(wt, 'hidden.txt'), 'utf8'), 'h\n');
  assert.deepEqual(branches(repo).sort(), ['jarl/1-x', 'main']);
  // A word with a space, a quote or a metacharacter is quoted in the printed commands; a plain one is left as it is.
  const { shellWord } = L;
  assert.equal(shellWord('/tmp/a b'), "'/tmp/a b'");
  assert.equal(shellWord("it's;$(x)"), "'it'\\''s;$(x)'");
  assert.equal(shellWord('jarl/1-x'), 'jarl/1-x');
});

test('a tracked file edited and hidden with assume-unchanged or skip-worktree keeps the worktree and the branch', () => {
  for (const [flag, shown] of [['--assume-unchanged', /assume-unchanged or skip-worktree marks: a\.txt/], ['--skip-worktree', /assume-unchanged or skip-worktree marks: a\.txt/]]) {
    const { repo, wt, sha } = fixture();
    git(wt, 'update-index', flag, 'a.txt');
    writeFileSync(join(wt, 'a.txt'), 'edited\n');
    assert.equal(git(wt, 'status', '--porcelain'), '', 'git status sees nothing');
    assert.match(jarl(repo, 'merged', '1', '--sha', sha), new RegExp(`\\nkept jarl/1-x — its worktree hides changes from git status behind ${shown.source}$`));
    assert.equal(readFileSync(join(wt, 'a.txt'), 'utf8'), 'edited\n');
    assert.deepEqual(branches(repo).sort(), ['jarl/1-x', 'main']);
  }
});

test('core.excludesFile, an exclude entry and a worktree-local configuration hide nothing the check must see', () => {
  // A configured excludes file turns an untracked file into an ignored one: it is kept for that.
  let f = fixture();
  const excludes = join(f.parent, 'global-excludes');
  writeFileSync(excludes, '*.mine\n');
  git(f.repo, 'config', 'core.excludesFile', excludes);
  writeFileSync(join(f.wt, 'notes.mine'), 'x\n');
  assert.match(jarl(f.repo, 'merged', '1', '--sha', f.sha), /\nkept jarl\/1-x — its worktree holds ignored files: notes\.mine\n/);
  assert.equal(existsSync(join(f.wt, 'notes.mine')), true);
  // An entry in .git/info/exclude, the same.
  f = fixture();
  appendFileSync(join(f.repo, '.git', 'info', 'exclude'), '*.hide\n');
  writeFileSync(join(f.wt, 'a.hide'), 'x\n');
  assert.match(jarl(f.repo, 'merged', '1', '--sha', f.sha), /holds ignored files: a\.hide\n/);
  // A configuration local to the worktree that hides untracked files from status.
  f = fixture();
  git(f.repo, 'config', 'extensions.worktreeConfig', 'true');
  git(f.wt, 'config', '--worktree', 'status.showUntrackedFiles', 'no');
  writeFileSync(join(f.wt, 'hidden.txt'), 'h\n');
  assert.equal(git(f.wt, 'status', '--porcelain'), '', 'status hides it');
  assert.match(jarl(f.repo, 'merged', '1', '--sha', f.sha), /\nkept jarl\/1-x — its worktree holds 1 uncommitted or untracked file\(s\)$/);
  assert.equal(existsSync(join(f.wt, 'hidden.txt')), true);
  assert.deepEqual(branches(f.repo).sort(), ['jarl/1-x', 'main']);
});

test('the path a lease names is never removed unless git lists it on exactly the issue\'s branch', () => {
  // Another branch: the lease names the main checkout, which is on main.
  let f = fixture({ worktree: false });
  jarl(f.repo, 'set', '1', 'in-progress', 'again', '--branch', 'jarl/1-x', '--worker', 'w-one');
  holdsWorktree(f.repo, '1', f.repo);
  assert.match(jarl(f.repo, 'merged', '1', '--sha', f.sha), /\nkept jarl\/1-x — the path the lease names \(.*repo\) is a worktree on main, not on this branch$/);
  assert.equal(existsSync(join(f.repo, '.git')), true);
  assert.deepEqual(branches(f.repo).sort(), ['jarl/1-x', 'main']);
  // Another issue's live worktree, on its own branch.
  f = fixture({ worktree: false, issues: 2 });
  const live = join(f.parent, 'wt-9');
  git(f.repo, 'worktree', 'add', '-q', '-b', 'jarl/9-live', live);
  jarl(f.repo, 'set', '1', 'in-progress', 'again', '--branch', 'jarl/1-x', '--worker', 'w-one');
  holdsWorktree(f.repo, '1', live);
  assert.match(jarl(f.repo, 'merged', '1', '--sha', f.sha), /is a worktree on jarl\/9-live, not on this branch$/);
  assert.equal(existsSync(live), true);
  // Detached.
  f = fixture({ worktree: false });
  const detached = join(f.parent, 'wt-detached');
  git(f.repo, 'worktree', 'add', '-q', '--detach', detached);
  jarl(f.repo, 'set', '1', 'in-progress', 'again', '--branch', 'jarl/1-x', '--worker', 'w-one');
  holdsWorktree(f.repo, '1', detached);
  assert.match(jarl(f.repo, 'merged', '1', '--sha', f.sha), /is a detached worktree$/);
  assert.equal(existsSync(detached), true);
  // Not listed by git at all.
  f = fixture({ worktree: false });
  const plain = join(f.parent, 'plain');
  mkdirSync(plain);
  jarl(f.repo, 'set', '1', 'in-progress', 'again', '--branch', 'jarl/1-x', '--worker', 'w-one');
  holdsWorktree(f.repo, '1', plain);
  assert.match(jarl(f.repo, 'merged', '1', '--sha', f.sha), /is not a worktree git lists$/);
  assert.equal(existsSync(plain), true);
  assert.deepEqual(branches(f.repo).sort(), ['jarl/1-x', 'main']);
});

test('a loop that lives inside the issue\'s worktree keeps it', () => {
  const { parent, repo, wt, sha } = fixture({ worktree: true });
  const inner = join(wt, 'loop');
  mkdirSync(inner);
  jarl(inner, 'init', 'inner goal');
  jarl(inner, 'new', 'inner issue', '--acceptance', 'it works');
  jarl(inner, 'set', '1', 'in-progress', 'start', '--branch', 'jarl/1-x', '--worker', 'w-one', '--worktree', wt);
  const out = jarl(inner, 'merged', '1', '--sha', sha, '--repo', repo);
  assert.match(out, /\nkept jarl\/1-x — the loop or this command lives in its worktree$/);
  assert.equal(existsSync(wt), true);
  void parent;
});

test('a branch git would refuse to delete without a force is kept: there is no force', () => {
  const { repo, wt, sha } = fixture({ merge: false });
  // The merge was made on another branch, so the tip is in the recorded merge but not in the checked-out branch.
  git(repo, 'checkout', '-q', '-b', 'integration');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x');
  const onIntegration = git(repo, 'rev-parse', '--short', 'HEAD');
  git(repo, 'checkout', '-q', 'main');
  const out = jarl(repo, 'merged', '1', '--sha', onIntegration);
  assert.match(out, /\nkept jarl\/1-x \(worktree .*wt-1 removed\) — git branch -d refused: /);
  assert.equal(existsSync(wt), false, 'the clean worktree was removed by git worktree remove');
  assert.deepEqual(branches(repo).sort(), ['integration', 'jarl/1-x', 'main'], 'the branch is kept');
  const forced = run(repo, 'merged', '1', '--sha', onIntegration, '--force');
  assert.notEqual(forced.status, 0, 'no force option exists');
  assert.match(forced.stderr, /force/);
  void sha;
});

test('the cleanup touches no remote branch', () => {
  const { parent, repo, sha } = fixture();
  const remote = join(parent, 'remote.git');
  mkdirSync(remote);
  git(remote, 'init', '-q', '--bare', '-b', 'main');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-q', 'origin', 'main', 'jarl/1-x');
  jarl(repo, 'merged', '1', '--sha', sha);
  assert.deepEqual(branches(repo), ['main']);
  assert.match(git(remote, 'branch', '--list', '--format=%(refname:short)'), /jarl\/1-x/, 'the remote branch is still there');
});

test('an issue with no recorded Branch is left alone, and a CI-only call cleans nothing', () => {
  const { repo, wt, sha } = fixture();
  jarl(repo, 'merged', '1', '--sha', sha, '--keep');
  assert.equal(jarl(repo, 'merged', '1', '--ci', 'green'), '1 merge · CI green');
  assert.equal(existsSync(wt), true);
  jarl(repo, 'new', 'no branch', '--acceptance', 'it works');
  assert.equal(jarl(repo, 'merged', '2', '--sha', sha), `2 merged ${sha}`);
});
