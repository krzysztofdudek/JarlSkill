// The six scenarios of one loop, each driven through the role commands from start to end with no model in it: delegation
// to two coordinators, the replacement of a coordinator, a stuck worker, a loop worked on two machines, the owner coming
// back, and one agent alone. Each test plays one whole scenario; the single rules are tested where they are built.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as R from '../record.mjs';
import * as L from '../jarl-lib.mjs';
import * as W from '../lib/where.mjs';
import { SPAWN_TIMEOUT, gitRepo, jarl, loop as makeLoop, refuses, run } from './helpers.mjs';
import { NO_EXCLUDES } from './portable.mjs';

const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const ids = (rows) => rows.map((r) => (r.ids ? r.ids.join(',') : r.id ?? `a-${r.ask}`));
const APPROVE_TEXT = 'Ran every line again; nothing left open.';

// A repository on `feature` with a loop whose goal is one line, and a helper that puts one commit on a branch of an
// issue the way a worker's worktree does, leaving the checkout on `feature`.
function repoLoop(goal = 'Ship the backlog.', initFlags = []) {
  const { dir, g } = gitRepo({ prefix: 'jarl-scenario-', branch: 'feature' });
  jarl(dir, 'init', goal, ...initFlags);
  const commitOn = (branch, file) => {
    g('checkout', '-qb', branch);
    writeFileSync(join(dir, file), `${branch}\n`);
    g('add', file); g('commit', '-qm', `work on ${branch}`);
    g('checkout', '-q', 'feature');
  };
  return { dir, g, commitOn };
}

test('delegation: a backlog cut into two slices, each coordinator sees only its own, a second lease on one issue is refused, each list holds only its holder\'s, and one approve in each slice lands one merge at a time', () => {
  const { dir, g, commitOn } = repoLoop();
  // The jarl files the backlog, cuts it in two and names the two coordinators and the one merger.
  const file = (title, f) => jarl(dir, 'new', title, '--acceptance', '[read] it works', '--files', f, '--by', 'jarl');
  file('odin first', 'o1.txt'); file('odin second', 'o2.txt'); file('thor first', 't1.txt'); file('thor second', 't2.txt'); file('the jarl\'s own', 'j.txt');
  jarl(dir, 'field', '1,2', 'Tags', '--add', 'slice:odin', '--by', 'jarl');
  jarl(dir, 'field', '3,4', 'Tags', '--add', 'slice:thor', '--by', 'jarl');
  jarl(dir, 'goal', '--set', 'Coordinators: odin, thor', '--by', 'jarl');
  jarl(dir, 'goal', '--set', 'Merger: muninn', '--by', 'jarl');
  const rows = (who) => json(dir, 'next', '--as', who, '--all').rows;

  // Each coordinator's list covers its slice and nothing else; the jarl keeps what is in no slice.
  assert.deepEqual(ids(rows('odin')), ['1', '2']);
  assert.deepEqual(ids(rows('thor')), ['3', '4']);
  assert.deepEqual(ids(rows('jarl')), ['5']);

  // Both coordinators go for the same ready issue: the first takes the lease, the second is refused and writes nothing.
  jarl(dir, 'set', '1', 'in-progress', 'first', '--worker', 'w1', '--branch', 'jarl/1-odin', '--model', 'm', '--by', 'odin');
  const logBefore = readFileSync(join(dir, '.jarl', 'log.md'), 'utf8');
  assert.match(refuses(dir, 'set', '1', 'in-progress', 'mine too', '--worker', 'w2', '--branch', 'jarl/1-thor', '--model', 'm', '--by', 'thor'), /^1 is leased already \(worker w1, branch jarl\/1-odin/);
  assert.equal(readFileSync(join(dir, '.jarl', 'log.md'), 'utf8'), logBefore, 'the refused lease writes nothing');
  assert.equal(json(dir, 'show', '1').fields.worker, 'w1');

  // The owner's digest holds only what is on the owner; the jarl's list only what is on the jarl.
  jarl(dir, 'ask', 'is the backlog the right size?', '--kind', 'charter', '--by', 'jarl');
  for (const row of rows('jarl')) assert.equal(row.holder, 'jarl', JSON.stringify(row));
  const owner = rows('owner');
  assert.deepEqual(ids(owner), ['a-1']);
  for (const row of owner) assert.equal(row.holder, 'owner', JSON.stringify(row));
  assert.ok(!ids(rows('jarl')).includes('a-1'), 'the question on the owner is on no one else');

  // One approve in each slice, at once: both wait on the one merger, in one queue, and each landing leaves the other queued.
  jarl(dir, 'set', '3', 'in-progress', 'first', '--worker', 'w3', '--branch', 'jarl/3-thor', '--model', 'm', '--by', 'thor');
  commitOn('jarl/1-odin', 'o1.txt');
  commitOn('jarl/3-thor', 't1.txt');
  jarl(dir, 'review', '1', 'approve', '--by', 'rev-a', '--model', 'm2', APPROVE_TEXT);
  jarl(dir, 'review', '3', 'approve', '--by', 'rev-b', '--model', 'm2', APPROVE_TEXT);
  assert.deepEqual(ids(rows('odin')).includes('1'), false, 'an approved issue leaves its coordinator\'s list');
  assert.deepEqual(ids(rows('thor')).includes('3'), false);
  const merger = rows('muninn').filter((r) => r.what === 'merge');
  assert.deepEqual(ids(merger).sort(), ['1', '3'], 'one merger holds both');
  const queue = () => json(dir, 'resume').queue.repos.flatMap((q) => q.rows.map((row) => row.branch));
  assert.deepEqual(queue().sort(), ['jarl/1-odin', 'jarl/3-thor']);
  assert.match(jarl(dir, 'brief', '--role', 'merger'), /Each branch, serially/);
  g('merge', '-q', '--no-ff', '--no-edit', 'jarl/1-odin');
  jarl(dir, 'merged', '1', '--sha', g('rev-parse', 'HEAD').trim(), '--ran', 'npm test', '--saw', 'pass 3', '--by', 'muninn');
  assert.deepEqual(queue(), ['jarl/3-thor'], 'one landed, the other still waits its turn');
  g('merge', '-q', '--no-ff', '--no-edit', 'jarl/3-thor');
  jarl(dir, 'merged', '3', '--sha', g('rev-parse', 'HEAD').trim(), '--ran', 'npm test', '--saw', 'pass 3', '--by', 'muninn');
  assert.deepEqual(queue(), []);
});

test('replacement: a fresh coordinator\'s brief carries the slice\'s standing rule, its promise, its open question and its review in flight, and nothing of the other slice; what was never recorded is out of reach of this test', () => {
  const root = makeLoop({ prefix: 'jarl-scenario-', via: 'cli', dotGit: false });
  jarl(root, 'goal', '--set', 'Coordinators: odin, thor', '--by', 'jarl');
  // Recorded for the slice of odin: a rule, a promise, an open question and a review in flight. Recorded for thor: the same.
  jarl(root, 'decide', 'odin-standing', 'Odin keeps the screens together.', '--applies-to', 'slice odin', '--by', 'jarl');
  jarl(root, 'decide', 'thor-standing', 'Thor asks before touching the parser.', '--applies-to', 'slice thor', '--by', 'jarl');
  jarl(root, 'new', 'send the owner the render', '--kind', 'promise', '--found-by', 'odin', '--tags', 'slice:odin', '--acceptance', '[read] it was sent', '--files', 'p.txt', '--by', 'odin');
  jarl(root, 'new', 'the screen in review', '--tags', 'slice:odin', '--acceptance', '[test] the screen renders', '--files', 'a.txt', '--by', 'odin');
  jarl(root, 'new', 'hammer the parser', '--tags', 'slice:thor', '--acceptance', '[test] the parser reads it', '--files', 'b.txt', '--by', 'thor');
  for (const [id, worker] of [['2', 'w2'], ['3', 'w3']]) {
    jarl(root, 'set', id, 'in-progress', 'go', '--worker', worker, '--branch', `jarl/${id}`, '--model', 'm', '--by', 'jarl');
    jarl(root, 'evidence', id, '--line', '1', '--ran', 'npm test', '--saw', 'pass 3', '--by', worker);
  }
  jarl(root, 'ask', 'which screen goes first?', '--kind', 'escalation', '--slice', 'odin', '--by', 'odin');
  jarl(root, 'ask', 'does the parser keep its name?', '--kind', 'escalation', '--slice', 'thor', '--by', 'thor');

  // The coordinator that takes over slice odin reads its brief and nothing else. What the old coordinator only had in its
  // head was never recorded, so no brief can carry it: this test covers what the record holds.
  const brief = jarl(root, 'brief', '--slice', 'odin');
  const o = json(root, 'brief', '--slice', 'odin');
  assert.match(brief, /^- odin-standing · slice odin · by jarl — Odin keeps the screens together\.$/m);
  assert.deepEqual(o.issues.map((i) => i.id), ['1', '2']);
  assert.match(brief, /^- 1 open · promise · send the owner the render$/m);
  assert.deepEqual(o.questions.map((q) => [q.id, q.kind, q.question]), [['1', 'escalation', 'which screen goes first?']]);
  assert.match(brief, /^## Open questions of the slice \(1\)\n- a-1 \(escalation\) · which screen goes first\?$/m);
  assert.match(brief, /^- 2 in-progress · w2 · the screen in review · evidence rows recorded, no verdict since the last start or round — it waits for a reviewer$/m);
  // Nothing of the other slice reaches it.
  assert.doesNotMatch(brief, /thor-standing|Thor asks|hammer the parser|the parser keep its name/);
  // The other coordinator's brief is the mirror.
  assert.match(jarl(root, 'brief', '--slice', 'thor'), /^- thor-standing · slice thor · by jarl — Thor asks before touching the parser\.$/m);
});

// The clock of the tests' seam: every stamp and every age of these calls is a moment the test names.
const MIN = 60_000;
const T0 = Date.parse('2026-06-01T10:00:00Z');
function at(minutes, fn) {
  W.setClock(T0 + minutes * MIN);
  try { return fn(); } finally { W.setClock(null); }
}

test('stuck worker: a lease with no row, log line or commit past the loop\'s threshold in minutes shows in its coordinator\'s list with the command to act, and resume uses the same threshold', () => {
  const { dir: root, g } = gitRepo({ prefix: 'jarl-scenario-stuck-', branch: 'feature' });
  at(0, () => {
    R.initLoop(root, 'A loop with a stuck worker.');
    L.cmdGoalSet(root, 'Coordinators: odin');
    R.newIssue(root, 'the stuck one', { width: undefined, files: 'a.mjs', tags: 'slice:odin', acceptance: '[test] a works' });
    R.setStatus(root, '1', 'in-progress', 'go', { worker: 'w1', branch: 'jarl/1-stuck' });
  });
  // The worker's one commit, ten minutes in: the age is read from the newest of the row, the log line and the commit.
  const stamp = new Date(T0 + 10 * MIN).toISOString();
  execFileSync('git', ['commit', '--allow-empty', '-qm', 'work'], { cwd: root, env: { ...process.env, GIT_COMMITTER_DATE: stamp, GIT_AUTHOR_DATE: stamp }, timeout: SPAWN_TIMEOUT });
  g('branch', 'jarl/1-stuck');
  g('reset', '-q', '--hard', 'HEAD~1');
  const list = (who) => L.renderNextAs(L.cmdNextAs(root, { as: who }));
  const resume = () => L.renderResume(R.resumeData(root), R.loadProfile(root));
  at(39, () => {
    assert.deepEqual(R.statusData(root).stale, [], '29 minutes after the commit nothing is idle');
    assert.doesNotMatch(resume(), /STALE/);
    assert.doesNotMatch(list('odin'), /no commit, row or log line/);
  });
  at(41, () => {
    assert.match(list('odin'), /^- 1 the stuck one: with worker w1 since 2026-06-01 10:00, no commit, row or log line for 31m \(threshold 30m\): ask the worker whether it waits on a prompt or a lock, or hand the lease over — jarl\.mjs set 1 in-progress "<why-the-worker-changed>" --worker "<the-new-worker>" --model "<model-id>" --handover --by odin$/m);
    assert.equal(L.cmdNextAs(root, { as: 'odin' }).rows[0].what, 'idle');
    assert.match(resume(), /^- 1 the stuck one · branch jarl\/1-stuck · worker w1 · model not recorded · since 2026-06-01 10:00 · leased by \(unnamed\) · STALE: idle 31m \(threshold 30m\)/m);
  });
  // A goal line moves the threshold for both views at once.
  at(41, () => L.cmdGoalSet(root, 'Liveness: 45'));
  at(54, () => {
    assert.doesNotMatch(resume(), /STALE/, 'the goal line moved the threshold: the commit is 44 minutes old');
    assert.doesNotMatch(list('odin'), /no commit, row or log line/);
  });
  at(56, () => {
    assert.match(list('odin'), /no commit, row or log line for 46m \(threshold 45m\)/);
    assert.match(resume(), /STALE: idle 46m \(threshold 45m\)/);
  });
});

// Two copies of one committed loop, each worked before it sees the other.
function committedLoop() {
  const { dir, g } = gitRepo({ prefix: 'jarl-scenario-two-', branch: 'main' });
  jarl(dir, 'init', 'two drivers', '--committed');
  jarl(dir, 'new', 'filed before the split', '--acceptance', '[read] it works', '--tier', 'light', '--files', 'split.txt');
  g('add', '-A'); g('commit', '-qm', 'loop');
  return { dir, g };
}
function cloneOf(dir) {
  const c = mkdtempSync(join(tmpdir(), 'jarl-scenario-clone-'));
  const g = (...a) => execFileSync('git', a, { cwd: c, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: SPAWN_TIMEOUT });
  g('clone', '-q', dir, '.');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  g('config', 'core.excludesFile', NO_EXCLUDES);
  return { dir: c, g };
}
const issueFiles = (dir) => readdirSync(join(dir, '.jarl', 'issues')).filter((f) => f.endsWith('.md')).sort();
const keyIn = (dir, file) => /^\*\*Key:\*\* (\S+)$/m.exec(readFileSync(join(dir, '.jarl', 'issues', file), 'utf8'))[1];
function fileLeaseCommit(at, title, branch, worker, by) {
  const { id } = json(at.dir, 'new', title, '--tier', 'light', '--acceptance', '[read] it works', '--files', `${worker}.txt`, '--by', by);
  jarl(at.dir, 'set', id, 'in-progress', 'go', '--branch', branch, '--worker', worker, '--model', 'm', '--by', by);
  at.g('add', '-A'); at.g('commit', '-qm', `${title} filed and leased`);
  return id;
}

// One copy holds two files numbered 2, each worked: the number is told apart by the key, renumbered at the merge, and
// no move lands on both.
function assertTwoNumbersRepaired(dir) {
  assert.deepEqual(issueFiles(dir), ['1-filed-before-the-split.md', '2-second-on-a.md', '2-second-on-b.md']);
  const keyA = keyIn(dir, '2-second-on-a.md');
  const keyB = keyIn(dir, '2-second-on-b.md');
  assert.notEqual(keyA, keyB, 'the keys tell the two issues apart');
  const verify = run(dir, ['verify']);
  assert.equal(verify.status, 2, verify.stdout);
  assert.match(verify.stdout, /2 issue files carry the number 2/);
  assert.match(run(dir, ['set', '2', 'dropped', 'x', '--by', 'jarl']).stderr, /2 issue files carry the number 2/, 'no move lands on both');
  assert.deepEqual([keyIn(dir, '2-second-on-a.md'), keyIn(dir, '2-second-on-b.md')], [keyA, keyB]);
  assert.deepEqual(json(dir, 'renumber', '2', '--key', keyB, '--by', 'jarl').id, '3');
  assert.deepEqual(issueFiles(dir), ['1-filed-before-the-split.md', '2-second-on-a.md', '3-second-on-b.md']);
  assert.equal(run(dir, ['verify']).status, 0);
  assert.equal(json(dir, 'show', '2').fields.worker, 'wa');
  assert.equal(json(dir, 'show', '3').fields.worker, 'wb');
}

test('two machines, two clones: a number taken twice is told apart by the key and renumbered with no move landing on both, a lease taken in both clones is a conflict on the jarl\'s list, and verify refuses a file holding conflict markers', () => {
  const a = committedLoop();
  const b = cloneOf(a.dir);
  assert.equal(fileLeaseCommit(a, 'second on A', 'jarl/2-on-a', 'wa', 'coordinator A'), '2');
  assert.equal(fileLeaseCommit(b, 'second on B', 'jarl/2-on-b', 'wb', 'coordinator B'), '2', 'B has not seen A');
  b.g('pull', '-q', '--no-rebase', '--no-edit', 'origin', 'main');
  assertTwoNumbersRepaired(b.dir);
  b.g('add', '-A'); b.g('commit', '-qm', 'renumbered');

  // Both clones of a fresh loop lease the same issue. The merge of the two headers stops on a conflict, and verify refuses the file as it stands.
  const a2 = committedLoop();
  const b2 = cloneOf(a2.dir);
  jarl(a2.dir, 'set', '1', 'in-progress', 'mine', '--branch', 'jarl/1-on-a', '--worker', 'wa', '--model', 'm', '--by', 'coordinator A');
  a2.g('add', '-A'); a2.g('commit', '-qm', 'a leases 1');
  jarl(b2.dir, 'set', '1', 'in-progress', 'mine too', '--branch', 'jarl/1-on-b', '--worker', 'wb', '--model', 'm', '--by', 'coordinator B');
  b2.g('add', '-A'); b2.g('commit', '-qm', 'b leases 1');
  assert.throws(() => b2.g('pull', '-q', '--no-rebase', '--no-edit', 'origin', 'main'), 'the two headers conflict');
  const conflicted = readFileSync(join(b2.dir, '.jarl', 'issues', '1-filed-before-the-split.md'), 'utf8');
  assert.match(conflicted, /^<{7} /m, 'git left its markers in the issue file');
  const held = run(b2.dir, ['verify']);
  assert.equal(held.status, 2, held.stdout);
  assert.match(held.stdout, /issues\/1-filed-before-the-split\.md line \d+: "<<<<<<< HEAD" — a git conflict marker/);
  b2.g('checkout', '--theirs', '.jarl/issues/1-filed-before-the-split.md');
  b2.g('add', '-A'); b2.g('commit', '-qm', 'merge, keeping the first clone\'s file');
  const conflicts = json(b2.dir, 'next', '--as', 'jarl').rows.filter((r) => r.what === 'conflict');
  assert.deepEqual(ids(conflicts), ['1']);
  assert.match(conflicts[0].says, /wa/);
  assert.match(conflicts[0].says, /wb/);
});

test('two machines, two branches of one checkout: the same number taken apart is told apart by the key and renumbered at the merge', () => {
  const a = committedLoop();
  const c = cloneOf(a.dir);
  assert.equal(fileLeaseCommit(c, 'second on B', 'jarl/2-on-b', 'wb', 'coordinator B'), '2');
  a.g('checkout', '-q', '-b', 'one');
  assert.equal(fileLeaseCommit(a, 'second on A', 'jarl/2-on-a', 'wa', 'coordinator A'), '2', 'the other branch is not fetched yet');
  a.g('fetch', '-q', c.dir, 'main:two');
  a.g('merge', '-q', '--no-edit', 'two');
  assertTwoNumbersRepaired(a.dir);
});

test('owner returns: one command prints in one message every entry on the owner, most blocking first, each with what it holds up', () => {
  const root = makeLoop({ prefix: 'jarl-scenario-owner-', via: 'cli', dotGit: false });
  const file = (title, ...flags) => jarl(root, 'new', title, '--acceptance', '[read] it works', ...flags, '--by', 'jarl');
  file('the root of three');  // 1
  file('the second'); file('the third'); file('the fourth');    // 2 3 4
  jarl(root, 'field', '2,3,4', 'Parent', '1', '--by', 'jarl');
  file('alone');        // 5
  file('alone after', '--after', '5');   // 6
  file('a thing of his own');    // 7
  jarl(root, 'ask', 'which way?', '--issue', '5', '--by', 'jarl');                                      // a-1, stuck: holds 5 and 6
  jarl(root, 'ask', 'may the root go?', '--issue', '1', '--by', 'jarl');                                // a-2: holds 1 and its three
  jarl(root, 'ask', 'stop everything, the goal changes', '--kind', 'stop', '--issue', '7', '--by', 'jarl');  // a-3
  jarl(root, 'decide', 'a-provisional-call', 'The names stay as they are.', '--by', 'jarl');
  jarl(root, 'ask', 'ratify a-provisional-call', '--kind', 'ratify', '--by', 'jarl');                  // a-4
  const rows = json(root, 'next', '--as', 'owner', '--all').rows;
  assert.deepEqual(ids(rows), ['a-3', 'a-2', 'a-1', 'a-4'], 'the stop first, then by how much each holds up, what to ratify last');
  assert.deepEqual(rows.map((r) => r.holdsUp.length), [1, 3, 1, 0]);
  for (const row of rows) assert.equal(row.holder, 'owner');
  const digest = jarl(root, 'next', '--as', 'owner', '--all');
  assert.match(digest, /^On the owner \(4\)\n- a-3 /);
  assert.match(digest, /^- a-2 may the root go\?: .* · holds up 2, 3, 4$/m);
  assert.match(digest, /^- a-1 which way\?: .* · holds up 5$/m);
  assert.doesNotMatch(digest, /^and \d+ issue\(s\) waiting on the owner: .*next --as owner --all$/m, 'the whole digest is one message');
  assert.equal(json(root, 'next', '--as', 'jarl', '--all').rows.some((r) => r.ask !== undefined), false, 'none of these is on the jarl as well');
});

test('one agent alone: a loop runs from init to close with no goal line beyond the goal, and a code issue with proof and no verdict is a fresh session for the owner to start, naming the issues', () => {
  const { dir, g, commitOn } = repoLoop('Build the export.');
  const goalBefore = readFileSync(join(dir, '.jarl', 'goal.md'), 'utf8');
  jarl(dir, 'new', 'export keeps its name', '--why', 'Two callers import it by name', '--acceptance', '[test] calling export() returns the list', '--files', 'export.mjs', '--by', 'jarl');
  jarl(dir, 'new', 'the note on it', '--why', 'Say what it does', '--acceptance', '[read] the note says it', '--files', 'note.md', '--by', 'jarl');
  assert.deepEqual(json(dir, 'next').map((r) => r.id), ['1', '2'], 'next offers the work');
  jarl(dir, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/1-export', '--worker', 'me', '--model', 'm', '--by', 'jarl');
  commitOn('jarl/1-export', 'export.mjs');
  jarl(dir, 'evidence', '1', '--line', '1', '--ran', 'node --test', '--saw', 'pass 1', '--by', 'me');
  jarl(dir, 'decide', 'the-export-keeps-its-name', 'The name stays: two callers import it.', '--by', 'jarl');

  // The agent cannot approve its own code, and it cannot raise a fresh agent here: Jarl says so and names the ask.
  assert.match(refuses(dir, 'review', '1', 'approve', '--by', 'me', '--model', 'm', APPROVE_TEXT), /is a self-approve/);
  const mine = json(dir, 'next', '--as', 'jarl', '--all').rows.find((r) => r.id === '1' && r.what === 'review');
  assert.match(mine.command, /start a fresh session to review issues? 1/);
  jarl(dir, 'ask', 'start a fresh session to review issues 1', '--by', 'jarl');
  const owner = json(dir, 'next', '--as', 'owner', '--all').rows;
  assert.deepEqual(owner.map((r) => [`a-${r.ask}`, r.reviewing]), [['a-1', ['1']]], 'the code issue shows on the owner, naming it');
  assert.match(jarl(dir, 'next', '--as', 'owner', '--all'), /^- a-1 start a fresh session to review issues 1: question \(stuck\), the fresh review of 1 waits on it/m);

  // The owner starts the fresh session: its examiner runs the line again, approves, and the agent lands and closes.
  jarl(dir, 'evidence', '1', '--line', '1', '--ran', 'node --test', '--saw', 'pass 1', '--by', 'rev');
  jarl(dir, 'review', '1', 'approve', '--by', 'rev', '--model', 'm2', '[test] calling export() returns the list: ran it again, pass 1.');
  jarl(dir, 'answer', '1', 'started it, approved', '--by', 'owner');
  g('merge', '-q', '--no-ff', '--no-edit', 'jarl/1-export');
  jarl(dir, 'merged', '1', '--sha', g('rev-parse', 'HEAD').trim(), '--ran', 'node --test', '--saw', 'pass 1', '--by', 'jarl');
  jarl(dir, 'set', '1', 'done', 'landed', '--by', 'jarl');
  // An issue with no code closes on the agent's own approve.
  jarl(dir, 'review', '2', 'approve', '--by', 'jarl', '--model', 'm', '[read] the note says it: read it, it does.');
  jarl(dir, 'set', '2', 'done', 'the note reads right', '--by', 'jarl');
  assert.equal(readFileSync(join(dir, '.jarl', 'goal.md'), 'utf8'), goalBefore, 'no goal line beyond the goal');
  jarl(dir, 'close', '--by', 'jarl');
  assert.equal(existsSync(join(dir, '.jarl', 'log.md')), false, 'the loop is closed');
});
