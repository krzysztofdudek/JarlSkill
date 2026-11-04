// Two copies of one committed loop: two clones, or two branches of one checkout. A new issue takes its number over every
// local and remote-tracking branch of the clone, so a branch or a fetched clone that already filed a number is never
// given it again. Two clones that file before either sees the other still take one number each; after the merge the keys
// tell their lines apart, and renumber gives one of the two a free number without rewriting a line of the log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SPAWN_TIMEOUT, gitRepo, jarl, run } from './helpers.mjs';
import { NO_EXCLUDES } from './portable.mjs';

const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const issueFiles = (dir) => readdirSync(join(dir, '.jarl', 'issues')).filter((f) => f.endsWith('.md')).sort();

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
  const c = mkdtempSync(join(tmpdir(), 'jarl-copies-clone-'));
  const g = (...a) => execFileSync('git', a, { cwd: c, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: SPAWN_TIMEOUT });
  g('clone', '-q', dir, '.');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  g('config', 'core.excludesFile', NO_EXCLUDES);
  return { dir: c, g };
}
function fileAndCommit(at, title) {
  const out = json(at.dir, 'new', title, '--tier', 'light');
  at.g('add', '-A'); at.g('commit', '-qm', title);
  return out.id;
}

test('a clone that fetched the other clone\'s filing takes the next number, though it has not merged it', () => {
  const a = committedLoop();
  const b = cloneOf(a.dir);
  assert.equal(fileAndCommit(a, 'second on A'), '2');
  b.g('fetch', '-q', 'origin');
  assert.equal(fileAndCommit(b, 'second on B'), '3', 'origin/main holds 2');
  b.g('pull', '-q', '--no-rebase', '--no-edit', 'origin', 'main');
  assert.deepEqual(issueFiles(b.dir).map((f) => f.split('-')[0]), ['1', '2', '3']);
  assert.equal(run(b.dir, ['verify']).status, 0);
});

test('two branches of one checkout never take one number: the second branch sees the first one\'s filing', () => {
  const a = committedLoop();
  a.g('checkout', '-q', '-b', 'one');
  assert.equal(fileAndCommit(a, 'second on one'), '2');
  a.g('checkout', '-q', 'main'); a.g('checkout', '-q', '-b', 'two');
  assert.equal(fileAndCommit(a, 'second on two'), '3', 'branch one holds 2');
  a.g('merge', '-q', '--no-edit', 'one');
  assert.deepEqual(issueFiles(a.dir).map((f) => f.split('-')[0]), ['1', '2', '3']);
  const r = run(a.dir, ['verify']);
  assert.equal(r.status, 0, r.stdout);
});
