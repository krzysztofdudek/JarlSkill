// A worker building or waiting on a long run writes nothing to the record and commits nothing, but it changes files in
// its worktree: the newest modification time in a lease's worktree counts as activity for the idle check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, realpathSync, utimesSync, writeFileSync, lstatSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as R from '../record.mjs';
import * as L from '../jarl-lib.mjs';
import * as W from '../lib/where.mjs';
import { gitRepo, SPAWN_TIMEOUT } from './helpers.mjs';

const MIN = 60_000;
const T0 = Date.parse('2026-06-01T10:00:00Z');
function at(minutes, fn) {
  W.setClock(T0 + minutes * MIN);
  try { return fn(); } finally { W.setClock(null); }
}
// Every file and directory of the worktree (the .git entry apart) gets the modification time of the given minute.
function touchAll(dir, minutes) {
  const when = new Date(T0 + minutes * MIN);
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      utimesSync(p, when, when);
    }
    utimesSync(d, when, when);
  };
  walk(dir);
}
function leaseWithWorktree() {
  const { dir: root, g } = gitRepo({ prefix: 'jarl-live-wt-', branch: 'main' });
  at(0, () => {
    R.initLoop(root, 'goal');
    R.newIssue(root, 'one', { files: 'b.txt', acceptance: '[read] b is done' });
    R.setStatus(root, '001', 'in-progress', 'w', { worker: 'w1', branch: 'jarl/1-one' });
  });
  const parent = realpathSync.native(join(root, '..'));
  const worktree = join(parent, `${basename(root)}-wt`);
  g('worktree', 'add', '-q', '-b', 'jarl/1-one', worktree);
  const when = new Date(T0 + 5 * MIN).toISOString();
  writeFileSync(join(worktree, 'b.txt'), 'b\n');
  execFileSync('git', ['add', 'b.txt'], { cwd: worktree, timeout: SPAWN_TIMEOUT });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'b'], { cwd: worktree, env: { ...process.env, GIT_COMMITTER_DATE: when, GIT_AUTHOR_DATE: when }, timeout: SPAWN_TIMEOUT, stdio: 'ignore' });
  return { root, worktree };
}

test('the newest modification time in a lease\'s worktree counts as activity, so a worker busy in its worktree is not idle', () => {
  const { root, worktree } = leaseWithWorktree();
  touchAll(worktree, 5);
  at(51, () => assert.match(R.statusData(root).stale[0].problems[0], /^idle 46m \(threshold 30m\): .*last change in the worktree 46m ago/, 'nothing changed since minute 5: idle'));
  // A build writes a file deep in the tree at minute 40.
  mkdirSync(join(worktree, 'out', 'deep'), { recursive: true });
  writeFileSync(join(worktree, 'out', 'deep', 'result.log'), 'building\n');
  touchAll(worktree, 5);
  const when = new Date(T0 + 40 * MIN);
  utimesSync(join(worktree, 'out', 'deep', 'result.log'), when, when);
  at(51, () => {
    assert.deepEqual(R.statusData(root).stale, [], 'the file written 11 minutes ago is the last activity');
    const lease = R.statusData(root).liveness.leases.find((x) => x.id === '001');
    assert.equal(lease.lastWork.ageMs, 11 * MIN);
    assert.equal(lease.lastCommit.ageMs, 46 * MIN);
    assert.doesNotMatch(L.renderResume(R.resumeData(root), R.loadProfile(root)), /STALE/);
  });
  at(75, () => {
    const [problem] = R.statusData(root).stale[0].problems;
    assert.match(problem, /^idle 35m \(threshold 30m\): .*last commit 1h ago on jarl\/1-one.*last change in the worktree 35m ago/);
    assert.match(L.renderNextAs(L.cmdNextAs(root, { as: 'jarl' })), /no commit, row, log line or change in its worktree for 35m \(threshold 30m\)/);
  });
});

test('a lease whose worktree is not on this machine is aged by the record and the commits alone', () => {
  const { root, worktree } = leaseWithWorktree();
  touchAll(worktree, 40);
  const g = (...a) => execFileSync('git', a, { cwd: root, timeout: SPAWN_TIMEOUT, stdio: 'ignore' });
  g('worktree', 'remove', '--force', worktree);
  at(51, () => {
    const lease = R.statusData(root).liveness.leases.find((x) => x.id === '001');
    assert.equal(lease.lastWork, null);
    assert.ok(lstatSync(root).isDirectory());
  });
});
