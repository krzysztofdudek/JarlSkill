// One number, two issue files. The write lock hands out numbers within one checkout and its worktrees, so two clones of a
// committed loop, or two branches of one checkout, that each file an issue take the same number, and git merges the two
// files without a conflict. These tests hold what Jarl does then: verify names both files, the views say it in place of
// a header advice that would copy the log's state into a file it may not belong to, and every command that addresses an
// issue by that number is refused with both files named, writing nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as R from '../record.mjs';
import { SPAWN_TIMEOUT, gitRepo, jarl, refuses, run } from './helpers.mjs';
import { NO_EXCLUDES } from './portable.mjs';

const BOTH = /issues\/2-second-on-a\.md and issues\/2-second-on-b\.md/;

// A repository with a committed loop holding one issue, as git runs in it.
function committedLoop() {
  const { dir, g } = gitRepo({ branch: 'main' });
  jarl(dir, 'init', 'two drivers', '--committed');
  jarl(dir, 'new', 'filed before the split', '--tier', 'light');
  g('add', '-A'); g('commit', '-qm', 'loop');
  return { dir, g };
}
// A clone of `dir`, with git run in it the way gitRepo runs it.
function cloneOf(dir) {
  const c = mkdtempSync(join(tmpdir(), 'jarl-shared-clone-'));
  const g = (...a) => execFileSync('git', a, { cwd: c, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: SPAWN_TIMEOUT });
  g('clone', '-q', dir, '.');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  g('config', 'core.excludesFile', NO_EXCLUDES);
  return { dir: c, g };
}
// Files one issue titled `title` in `at` and commits it.
function fileAndCommit(at, title) {
  jarl(at.dir, 'new', title, '--tier', 'light');
  at.g('add', '-A'); at.g('commit', '-qm', title);
}
// The issue files and the log of a loop, to show that a refusal wrote nothing.
function snapshot(dir) {
  const issues = join(dir, '.jarl', 'issues');
  return { log: readFileSync(join(dir, '.jarl', 'log.md'), 'utf8'), files: readdirSync(issues).sort().map((f) => [f, readFileSync(join(issues, f), 'utf8')]) };
}

// Two clones that each file the second issue, the second clone merging the first: the merged checkout holds both files.
function twoClones() {
  const a = committedLoop();
  const b = cloneOf(a.dir);
  fileAndCommit(a, 'second on A');
  fileAndCommit(b, 'second on B');
  b.g('pull', '-q', '--no-rebase', '--no-edit', 'origin', 'main');
  return b.dir;
}
// Two branches of one checkout that each file the second issue, then merged.
function twoBranches() {
  const a = committedLoop();
  a.g('checkout', '-q', '-b', 'one');
  fileAndCommit(a, 'second on A');
  a.g('checkout', '-q', 'main'); a.g('checkout', '-q', '-b', 'two');
  fileAndCommit(a, 'second on B');
  a.g('merge', '-q', '--no-edit', 'one');
  return a.dir;
}

for (const [shape, make] of [['two clones of a committed loop', twoClones], ['two branches of one checkout', twoBranches]]) {
  test(`${shape} that each file an issue merge into one number held by two files, and verify names both`, () => {
    const dir = make();
    assert.deepEqual(readdirSync(join(dir, '.jarl', 'issues')).filter((f) => f.startsWith('2-')).sort(), ['2-second-on-a.md', '2-second-on-b.md'], 'git merged both files without a conflict');
    const r = run(dir, ['verify']);
    assert.equal(r.status, 2, `verify finds the shared number: ${r.stdout}`);
    const line = r.stdout.split('\n').find((l) => /carry the number 2/.test(l));
    assert.ok(line, `verify says the number is carried twice: ${r.stdout}`);
    assert.match(line, BOTH, 'both files are named');
    assert.match(r.stdout, /^issues\/: 1$/m, 'the finding is one, under the issue files');
    assert.match(r.stdout, /^issue headers: clean$/m, 'no header advice for either file');
  });
}

test('while two files carry one number, every command that addresses it is refused with both files named, and nothing is written', () => {
  const dir = twoClones();
  const before = snapshot(dir);
  const calls = [
    ['show', '2'],
    ['set', '2', 'in-progress', '--branch', 'jarl/2-x', '--worker', 'w1'],
    ['set', '2', 'dropped', 'not needed'],
    ['set', '1,2', 'deferred', 'later'],
    ['prio', '2', '1'],
    ['tag', '2', '+x'],
    ['body', '2', '--why', 'because'],
    ['files', '2', 'a.txt'],
    ['evidence', '2', 'a note'],
    ['review', '2', 'approve', '--by', 'stranger', 'read the diff and found nothing wrong'],
    ['round', '2', 'red'],
    ['after', '1', '2'],
    ['after', '2', '1'],
    ['new', 'third', '--tier', 'light', '--after', '2'],
    ['ask', 'which one?', '--issue', '2'],
    ['changelog', '2'],
  ];
  for (const args of calls) assert.match(refuses(dir, ...args), BOTH, args.join(' '));
  assert.deepEqual(snapshot(dir), before, 'no refusal wrote a line or a file');
  assert.match(jarl(dir, 'list', '--all'), /second on A[\s\S]*second on B/, 'list still shows both');
  assert.match(jarl(dir, 'set', '1', 'in-progress', '--branch', 'jarl/1-x', '--worker', 'w1'), /1 → in-progress/, 'another number moves as before');
});

test('an answer to a question about a number two files carry is refused before anything is written', () => {
  const a = committedLoop();
  jarl(a.dir, 'new', 'second on A', '--tier', 'light');
  jarl(a.dir, 'ask', 'which way?', '--issue', '2');
  a.g('add', '-A'); a.g('commit', '-qm', 'a asks');
  a.g('checkout', '-q', '-b', 'other', 'HEAD~1');
  fileAndCommit(a, 'second on B');
  a.g('checkout', '-q', 'main');
  a.g('merge', '-q', '--no-edit', 'other');
  const before = { ...snapshot(a.dir), asks: readFileSync(join(a.dir, '.jarl', 'asks.md'), 'utf8'), decisions: readFileSync(join(a.dir, '.jarl', 'decisions.md'), 'utf8') };
  assert.match(refuses(a.dir, 'answer', '1', 'this way', '--by', 'owner'), BOTH);
  assert.deepEqual({ ...snapshot(a.dir), asks: readFileSync(join(a.dir, '.jarl', 'asks.md'), 'utf8'), decisions: readFileSync(join(a.dir, '.jarl', 'decisions.md'), 'utf8') }, before);
});

test('status names both files of a shared number in place of a header advice, and a move made before the merge is not copied into the other file', () => {
  const a = committedLoop();
  const b = cloneOf(a.dir);
  fileAndCommit(a, 'second on A');
  jarl(a.dir, 'set', '2', 'dropped', 'not needed');
  a.g('add', '-A'); a.g('commit', '-qm', 'a drops its 2');
  fileAndCommit(b, 'second on B');
  b.g('pull', '-q', '--no-rebase', '--no-edit', 'origin', 'main');
  const out = jarl(b.dir, 'status');
  assert.match(out, BOTH, out);
  assert.doesNotMatch(out, /record: 2 Status/, 'no advice to write the log\'s status into either file');
  const disagreements = JSON.parse(jarl(b.dir, 'status', '--json')).disagreements;
  assert.deepEqual(disagreements.map((d) => [d.id, d.field, d.files]), [['2', 'number', ['issues/2-second-on-a.md', 'issues/2-second-on-b.md']]]);
  assert.match(readFileSync(join(b.dir, '.jarl', 'issues', '2-second-on-b.md'), 'utf8'), /\*\*Status:\*\* open/, 'the file nobody moved still reads open');
});

test('giving one of the two files a free number, as the finding says, settles it', () => {
  const dir = twoClones();
  const issues = join(dir, '.jarl', 'issues');
  const text = readFileSync(join(issues, '2-second-on-b.md'), 'utf8');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: SPAWN_TIMEOUT });
  g('mv', '.jarl/issues/2-second-on-b.md', '.jarl/issues/3-second-on-b.md');
  writeFileSync(join(issues, '3-second-on-b.md'), text.replace(/^# 2 ·/, '# 3 ·'));
  const r = run(dir, ['verify']);
  assert.doesNotMatch(r.stdout, /carry the number/);
  assert.match(jarl(dir, 'show', '3'), /second on B/);
  assert.match(jarl(dir, 'show', '2'), /second on A/);
});

test('the record library finds an issue as before, and refuses a number two files carry with both files named', () => {
  const dir = twoClones();
  assert.equal(R.findIssue(dir, '1').title, 'filed before the split');
  assert.equal(R.findIssue(dir, '9'), null);
  assert.throws(() => R.findIssue(dir, '2'), BOTH);
});
