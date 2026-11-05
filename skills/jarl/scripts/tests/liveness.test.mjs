// Liveness: a lease whose issue saw no commit, no row and no log line for longer than the loop's threshold is idle, and
// so is a proof that waits that long for its verdict. The threshold is the goal's Liveness line in minutes (30 without
// one), and --stale-hours overrides it for one call. status, resume and next --as read it; the ages say which clone and
// which fetched refs they were read in; an idle lease or proof is on the list of its slice's coordinator (the jarl's in
// no slice) with the command to act; a held resource shows its holder and that holder's age. The tests set the clock
// through the library's test seam, so every stamp and every age is a moment the test names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as R from '../record.mjs';
import * as L from '../jarl-lib.mjs';
import * as W from '../lib/where.mjs';
import { jarl, refuses, gitRepo, loop as makeLoop, SPAWN_TIMEOUT } from './helpers.mjs';
import { oldJarl, formatTwoJarl } from './old-jarl.mjs';

const MIN = 60_000;
const T0 = Date.parse('2026-06-01T10:00:00Z');
// Runs `fn` with the clock at T0 + `minutes`, and puts the clock back whatever happens.
function at(minutes, fn) {
  W.setClock(T0 + minutes * MIN);
  try { return fn(); } finally { W.setClock(null); }
}
const resumeText = (root) => L.renderResume(R.resumeData(root), R.loadProfile(root));
const nextAs = (root, as) => L.renderNextAs(L.cmdNextAs(root, { as }));
const statusText = (root, opts = {}) => L.renderStatus(R.statusData(root, opts), R.loadProfile(root));

test('a lease with no commit, row or log line for longer than 30 minutes is idle in status, resume and next --as', () => {
  const root = at(0, () => {
    const r = makeLoop({ prefix: 'jarl-live-', dotGit: false });
    R.newIssue(r, 'one', { files: 'a.mjs', acceptance: 'a is done' });
    R.setStatus(r, '001', 'in-progress', 'w', { worker: 'w1' });
    return r;
  });
  at(29, () => {
    assert.deepEqual(R.statusData(root).stale, [], 'within the threshold nothing is idle');
    assert.doesNotMatch(resumeText(root), /STALE/);
    assert.match(nextAs(root, 'jarl'), /^- 001 one: with worker w1 since 2026-06-01 10:00, no proof yet; the worker records it — jarl\.mjs evidence 001/m);
  });
  at(31, () => {
    const idle = 'idle 31m (threshold 30m): last log line 31m ago, last row none, no branch, so no commit read';
    assert.deepEqual(R.statusData(root).stale, [{ id: '001', problems: [idle] }]);
    assert.match(statusText(root), new RegExp(`^stale 001 · ${idle.replace(/[()]/g, '\\$&')}$`, 'm'));
    assert.match(resumeText(root), /^- 001 one · worker w1 · model not recorded · since 2026-06-01 10:00 · STALE: idle 31m \(threshold 30m\)/m);
    const list = nextAs(root, 'jarl');
    assert.match(list, /^- 001 one: with worker w1 since 2026-06-01 10:00, no commit, row or log line for 31m \(threshold 30m\): ask the worker whether it waits on a prompt or a lock, or hand the lease over — jarl\.mjs set 001 in-progress "<why-the-worker-changed>" --worker "<the-new-worker>" --handover$/m);
    assert.equal(L.cmdNextAs(root, { as: 'jarl' }).rows[0].what, 'idle');
  });
});

test('a row resets the age, and a proof that waits past the threshold for its verdict is on the jarl\'s list', () => {
  const root = at(0, () => {
    const r = makeLoop({ prefix: 'jarl-live-', dotGit: false });
    R.newIssue(r, 'one', { files: 'a.mjs', acceptance: 'a is done' });
    R.setStatus(r, '001', 'in-progress', 'w', { worker: 'w1' });
    return r;
  });
  at(25, () => R.addEvidence(root, '001', undefined, { ran: 'npm test', saw: 'ok' }));
  at(50, () => {
    assert.deepEqual(R.statusData(root).stale, [], 'the row 25 minutes ago is the last activity');
    assert.match(nextAs(root, 'jarl'), /^- 001 one: proof recorded, no verdict; raise a reviewer \(worker w1\) — /m);
  });
  at(56, () => {
    assert.match(R.statusData(root).stale[0].problems[0], /^idle 31m \(threshold 30m\): last log line 31m ago, last row 31m ago, no branch/);
    assert.match(nextAs(root, 'jarl'), /^- 001 one: proof recorded, no verdict for 31m \(threshold 30m\); raise a reviewer \(worker w1\) — jarl\.mjs review 001 "<verdict>" --by "<reviewer>" "<text>"$/m);
  });
});

test('the goal\'s Liveness line sets the threshold in minutes, and --stale-hours overrides it for one call', () => {
  const root = at(0, () => {
    const r = makeLoop({ prefix: 'jarl-live-', dotGit: false });
    R.newIssue(r, 'one', { files: 'a.mjs', acceptance: 'a is done' });
    R.setStatus(r, '001', 'in-progress', 'w', { worker: 'w1' });
    L.cmdGoalSet(r, 'Liveness: 45');
    return r;
  });
  at(40, () => {
    assert.deepEqual(R.statusData(root).stale, []);
    assert.doesNotMatch(resumeText(root), /STALE/);
    assert.doesNotMatch(nextAs(root, 'jarl'), /no commit, row or log line/);
    assert.match(R.statusData(root, { 'stale-hours': 0.5 }).stale[0].problems[0], /^idle 40m \(threshold 30m\)/, '--stale-hours is the threshold of that one call');
    assert.equal(R.statusData(root).liveness.minutes, 45);
    assert.equal(R.statusData(root).liveness.from, 'goal');
    assert.equal(R.statusData(root, { 'stale-hours': 2 }).liveness.from, 'stale-hours');
  });
  at(46, () => {
    assert.match(R.statusData(root).stale[0].problems[0], /^idle 46m \(threshold 45m\)/);
    assert.match(resumeText(root), /STALE: idle 46m \(threshold 45m\)/);
    assert.match(nextAs(root, 'jarl'), /no commit, row or log line for 46m \(threshold 45m\)/);
  });
  at(47, () => L.cmdGoalSet(root, 'Liveness: 10'));
  at(48, () => assert.match(R.statusData(root).stale[0].problems[0], /^idle 48m \(threshold 10m\)/, 'the line in force is read at each call'));
});

test('in a sliced loop an idle lease is on its slice\'s coordinator, and one in no slice on the jarl', () => {
  const root = at(0, () => {
    const r = makeLoop({ prefix: 'jarl-live-', dotGit: false });
    L.cmdGoalSet(r, 'Coordinators: odin');
    R.newIssue(r, 'sliced', { files: 'a.mjs', acceptance: 'a is done', tags: 'slice:odin' });
    R.newIssue(r, 'plain', { files: 'b.mjs', acceptance: 'b is done' });
    R.setStatus(r, '001', 'in-progress', 'w', { worker: 'w1' });
    R.setStatus(r, '002', 'in-progress', 'w', { worker: 'w2' });
    return r;
  });
  at(31, () => {
    const odin = nextAs(root, 'odin');
    const jarlList = nextAs(root, 'jarl');
    assert.match(odin, /^- 001 sliced: with worker w1 since 2026-06-01 10:00, no commit, row or log line for 31m \(threshold 30m\)/m);
    assert.doesNotMatch(odin, /^- 002 /m);
    assert.match(jarlList, /^- 002 plain: with worker w2 since 2026-06-01 10:00, no commit, row or log line for 31m \(threshold 30m\)/m);
    assert.doesNotMatch(jarlList, /^- 001 /m);
    // resume --slice shows the slice's own idle lease.
    assert.match(L.renderResume(R.resumeData(root, { slice: 'odin' }), R.loadProfile(root)), /^- 001 sliced .*STALE: idle 31m/m);
  });
});

test('proofs of code that wait past the threshold for a verdict say how long each has waited, on their slice\'s coordinator', () => {
  const root = at(0, () => {
    const r = makeLoop({ prefix: 'jarl-live-', dotGit: false });
    L.cmdGoalSet(r, 'Coordinators: odin');
    R.newIssue(r, 'first', { files: 'a.mjs', acceptance: 'a is done', tags: 'slice:odin' });
    R.newIssue(r, 'second', { files: 'b.mjs', acceptance: 'b is done', tags: 'slice:odin' });
    R.setStatus(r, '001', 'in-progress', 'w', { worker: 'w1', branch: 'jarl/1-first' });
    R.setStatus(r, '002', 'in-progress', 'w', { worker: 'w2', branch: 'jarl/2-second' });
    return r;
  });
  at(5, () => R.addEvidence(root, '001', undefined, { ran: 'npm test', saw: 'ok' }));
  at(14, () => R.addEvidence(root, '002', undefined, { ran: 'npm test', saw: 'ok' }));
  at(40, () => {
    const odin = nextAs(root, 'odin');
    assert.match(odin, /^- 001, 002: proof recorded, no verdict for 35m on 001 \(threshold 30m\); raise a fresh reviewer for 001, 002;/m);
    assert.deepEqual(L.cmdNextAs(root, { as: 'odin' }).rows[0].idle, [{ id: '001', ageMs: 35 * MIN, minutes: 30 }]);
    assert.doesNotMatch(nextAs(root, 'jarl'), /^- 001/m);
  });
  at(50, () => assert.match(nextAs(root, 'odin'), /^- 001, 002: proof recorded, no verdict for 45m on 001, 36m on 002 \(threshold 30m\); raise a fresh reviewer/m));
});

test('the ages read the branch\'s commits in this clone and its fetched refs, and say which they read', () => {
  const { dir: root, g } = gitRepo({ prefix: 'jarl-live-git-', branch: 'main' });
  const commitAt = (minutes, file) => {
    writeFileSync(join(root, file), `${minutes}\n`);
    g('add', file);
    const when = new Date(T0 + minutes * MIN).toISOString();
    execFileSync('git', ['commit', '-qm', file], { cwd: root, env: { ...process.env, GIT_COMMITTER_DATE: when, GIT_AUTHOR_DATE: when }, timeout: SPAWN_TIMEOUT, stdio: 'ignore' });
  };
  at(0, () => {
    R.initLoop(root, 'goal');
    R.newIssue(root, 'one', { files: 'b.txt', acceptance: 'b is done' });
    R.setStatus(root, '001', 'in-progress', 'w', { worker: 'w1', branch: 'jarl/1-one' });
  });
  g('checkout', '-q', '-b', 'jarl/1-one');
  commitAt(5, 'b.txt');
  // A commit another clone pushed, seen here only as the fetched ref of a remote.
  g('remote', 'add', 'origin', 'https://example.invalid/repo.git');
  commitAt(20, 'c.txt');
  g('update-ref', 'refs/remotes/origin/jarl/1-one', 'HEAD');
  g('reset', '-q', '--hard', 'HEAD~1');
  g('checkout', '-q', 'main');
  at(45, () => assert.deepEqual(R.statusData(root).stale, [], 'the fetched commit 25 minutes ago is the last activity'));
  at(51, () => {
    const [problem] = R.statusData(root).stale[0].problems;
    assert.equal(problem, `idle 31m (threshold 30m): last log line 51m ago, last row none, last commit 31m ago on origin/jarl/1-one; read in the clone ${L.canonical(root)}: jarl/1-one, origin/jarl/1-one`);
    const lease = R.statusData(root).liveness.leases.find((x) => x.id === '001');
    assert.deepEqual(lease.read, [{ clone: L.canonical(root), refs: ['jarl/1-one', 'origin/jarl/1-one'] }]);
    assert.equal(lease.lastCommit.ref, 'origin/jarl/1-one');
  });
  // Without the fetched ref, the branch's own commit is the newest.
  g('update-ref', '-d', 'refs/remotes/origin/jarl/1-one');
  at(51, () => assert.equal(R.statusData(root).stale[0].problems[0], `idle 46m (threshold 30m): last log line 51m ago, last row none, last commit 46m ago on jarl/1-one; read in the clone ${L.canonical(root)}: jarl/1-one, no fetched ref`));
});

test('a held resource shows the issue that holds it and that holder\'s age', () => {
  const root = at(0, () => {
    const r = makeLoop({ prefix: 'jarl-live-', dotGit: false });
    R.newIssue(r, 'holder', { files: 'a.mjs', acceptance: 'a is done' });
    R.newIssue(r, 'waiter', { files: 'b.mjs', acceptance: 'b is done' });
    L.cmdField(r, '001', 'Resources', 'db');
    L.cmdField(r, '002', 'Resources', 'db');
    R.setStatus(r, '001', 'in-progress', 'w', { worker: 'w1' });
    return r;
  });
  at(10, () => {
    assert.match(resumeText(root), /^- 002  P2  waiter \(resource db held by 001, last active 10m ago\)$/m);
    assert.match(L.renderNext(L.cmdNext(root, { all: true }), true), /^002  P2  waiter  \(waits on resource db, held by 001, last active 10m ago\)$/m);
  });
  at(31, () => assert.match(resumeText(root), /^- 002  P2  waiter \(resource db held by 001, last active 31m ago, past the 30m threshold\)$/m));
});

test('goal --set takes a Liveness line of whole minutes, and the frozen readers read a goal that holds one', () => {
  const root = makeLoop({ prefix: 'jarl-live-', via: 'cli', dotGit: false });
  assert.match(jarl(root, 'goal', '--set', 'Liveness: 20'), /Liveness: 20/);
  assert.match(readFileSync(join(root, '.jarl', 'goal.md'), 'utf8'), /^Liveness: 20$/m);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /· goal line added · Liveness: 20$/m);
  for (const bad of ['Liveness: 0', 'Liveness: soon', 'Liveness: 2.5', 'Liveness (bug): 20']) assert.match(refuses(root, 'goal', '--set', bad), /Liveness/, bad);
  assert.equal(L.goalLines('# Goal\n\ngoal\n\nLiveness: 15\n').liveness, 15);
  const skipped = [];
  assert.equal(L.goalLines('# Goal\n\ngoal\n\nLiveness: never\n', skipped).liveness, null);
  assert.match(skipped[0].reason, /a Liveness line is "Liveness: <minutes>"/);
  // A reader that knows no Liveness line reads it as a line of the goal's text, and the goal stays the goal.
  const before = makeLoop({ prefix: 'jarl-live-old-', dotGit: false, via: 'library' });
  L.cmdGoalSet(before, 'Liveness: 20');
  for (const reader of [oldJarl, formatTwoJarl]) {
    const r = reader(before, 'status', {});
    assert.equal(r.ok, true, r.error);
    assert.equal(r.value.goal, 'goal');
  }
});

// The command line, on the real clock: the lease's log lines are dated 45 minutes back, as a worker stuck on a prompt
// leaves them, and resume, status and next --as name it at the default threshold.
test('resume, status and next --as show a lease idle for 45 minutes at the default threshold', () => {
  const root = makeLoop({ prefix: 'jarl-live-cli-', via: 'cli', dotGit: false });
  jarl(root, 'new', 'one', '--files', 'a.mjs', '--acceptance', 'a is done');
  jarl(root, 'set', '1', 'in-progress', 'w', '--worker', 'w1');
  const log = join(root, '.jarl', 'log.md');
  const back = new Date(Date.now() - 45 * MIN).toISOString().replace('T', ' ').slice(0, 16);
  writeFileSync(log, readFileSync(log, 'utf8').replace(/^- \d{4}-\d{2}-\d{2} \d{2}:\d{2}/gm, `- ${back}`));
  assert.match(jarl(root, 'resume'), /^- 1 one · .*STALE: idle 4[56]m \(threshold 30m\)/m);
  assert.match(jarl(root, 'status'), /^stale 1 · idle 4[56]m \(threshold 30m\)/m);
  assert.match(jarl(root, 'next', '--as', 'jarl'), /^- 1 one: with worker w1 since \S+ \S+, no commit, row or log line for 4[56]m \(threshold 30m\): .* — jarl\.mjs set 1 in-progress "<why-the-worker-changed>" --worker "<the-new-worker>" --handover$/m);
  jarl(root, 'goal', '--set', 'Liveness: 60');
  assert.doesNotMatch(jarl(root, 'resume'), /STALE/);
  assert.match(jarl(root, 'status', '--stale-hours', '0.5'), /^stale 1 · idle 4[56]m \(threshold 30m\)/m);
});
