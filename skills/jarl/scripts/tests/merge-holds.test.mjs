// Recording a merge says, loudly and without refusing, when the recorded commit does not contain the tip of the issue's
// branch, or does not contain the base as it stands while the commit is not yet in it; and a merge recorded with neither a
// check nor a red cause is shown by status, resume and show as waiting for its check, until the check or the red cause is recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { jarl, run, SPAWN_TIMEOUT } from './helpers.mjs';
const said = (repo, ...args) => run(repo, args).stderr;

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', timeout: SPAWN_TIMEOUT });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const commit = (repo, file, text) => { writeFileSync(join(repo, file), text); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', `add ${file}`); };

// A repository on main that is the loop's root, with its first issue leased on jarl/1-x, which holds one commit of its own.
function fixture() {
  const repo = join(mkdtempSync(join(tmpdir(), 'jarl-holds-')), 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  commit(repo, 'a.txt', 'a\n');
  jarl(repo, 'init', 'goal');
  jarl(repo, 'new', 'issue one', '--acceptance', 'it works');
  git(repo, 'checkout', '-q', '-b', 'jarl/1-x');
  commit(repo, 'b.txt', 'b\n');
  git(repo, 'checkout', '-q', 'main');
  jarl(repo, 'set', '1', 'in-progress', 'start', '--branch', 'jarl/1-x', '--worker', 'w-one');
  return { repo, tip: git(repo, 'rev-parse', 'jarl/1-x') };
}

test('a merge commit that holds the branch and the base is recorded without a note about either', () => {
  const { repo } = fixture();
  commit(repo, 'c.txt', 'c\n');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x');
  const out = said(repo, 'merged', '1', '--sha', git(repo, 'rev-parse', 'HEAD'), '--keep');
  assert.doesNotMatch(out, /MERGE WITHOUT/);
});

test('a commit recorded before it lands, made from the branch and the base as they stand, is recorded without a note', () => {
  const { repo } = fixture();
  commit(repo, 'c.txt', 'c\n');
  git(repo, 'checkout', '-q', '-b', 'result', 'jarl/1-x');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge base', 'main');
  const sha = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', 'main');
  assert.doesNotMatch(said(repo, 'merged', '1', '--sha', sha, '--keep'), /MERGE WITHOUT/);
});

test('a commit that lacks the base as it stands is noted loudly and still recorded', () => {
  const { repo, tip } = fixture();
  commit(repo, 'c.txt', 'c\n');
  const out = said(repo, 'merged', '1', '--sha', tip, '--keep');
  assert.match(out, /MERGE WITHOUT THE BASE — [0-9a-f]+ does not contain main as it stands/);
  assert.doesNotMatch(out, /MERGE WITHOUT THE BRANCH/);
  assert.match(jarl(repo, 'show', '1'), /Merged:\*\* [0-9a-f]+/);
});

test('a commit that lacks the branch tip is noted loudly and still recorded', () => {
  const { repo } = fixture();
  commit(repo, 'c.txt', 'c\n');
  const out = said(repo, 'merged', '1', '--sha', git(repo, 'rev-parse', 'HEAD'), '--keep');
  assert.match(out, /MERGE WITHOUT THE BRANCH — [0-9a-f]+ does not contain the tip of jarl\/1-x/);
  assert.doesNotMatch(out, /MERGE WITHOUT THE BASE/);
});

test('a merge landed in the base is not noted for the commits the base gained after it', () => {
  const { repo } = fixture();
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x');
  const sha = git(repo, 'rev-parse', 'HEAD');
  commit(repo, 'c.txt', 'c\n');
  assert.doesNotMatch(said(repo, 'merged', '1', '--sha', sha, '--keep'), /MERGE WITHOUT/);
});

test('a merge recorded with neither a check nor a red cause shows in status and show as waiting for its check, until the check is recorded', () => {
  const { repo } = fixture();
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x');
  const sha = git(repo, 'rev-parse', 'HEAD');
  jarl(repo, 'merged', '1', '--sha', sha, '--keep');
  const waiting = new RegExp(`waiting for its check: 1 \\(${sha.slice(0, 7)}[0-9a-f]*\\).*jarl\\.mjs merged 1 --sha ${sha}.* --ran`);
  assert.match(jarl(repo, 'status'), waiting);
  assert.match(jarl(repo, 'show', '1'), waiting);
  assert.match(jarl(repo, 'resume'), waiting);
  assert.deepEqual(JSON.parse(jarl(repo, 'status', '--json')).checkWaiting.map((w) => w.id), ['1']);
  jarl(repo, 'merged', '1', '--sha', sha, '--ran', 'npm test', '--saw', 'all green', '--keep');
  assert.doesNotMatch(jarl(repo, 'status'), /waiting for its check/);
  assert.doesNotMatch(jarl(repo, 'show', '1'), /waiting for its check/);
  assert.doesNotMatch(jarl(repo, 'resume'), /waiting for its check/);
  assert.deepEqual(JSON.parse(jarl(repo, 'status', '--json')).checkWaiting, []);
});

test('a merge recorded on a red check with its cause is not shown as waiting for its check', () => {
  const { repo } = fixture();
  jarl(repo, 'new', 'the cause', '--acceptance', 'it is found');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x');
  jarl(repo, 'merged', '1', '--sha', git(repo, 'rev-parse', 'HEAD'), '--red', '2', '--keep');
  assert.doesNotMatch(jarl(repo, 'status'), /waiting for its check/);
});
