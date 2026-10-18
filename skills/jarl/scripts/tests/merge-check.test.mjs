// A merge records the check that decided it: `merged <ids> --sha <sha> --ran "<check>" --saw "<summary>"` writes the
// evidence row and a merge line that names the check; `merged --red <id>` records a landing on a red check whose cause
// another issue tracks; no CI state is recorded unless it is given. `Check (<repo>): <command>` lines in goal.md name each
// repository's command, and status --by repo and report count, per repository, the merges that carry a passing check row,
// those that carry none and those landed on red. Every line written here is read by the pinned frozen reader
// (tests/old-jarl.mjs) without a refusal and without a silent misreading.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as R from '../record.mjs';
import { oldJarl } from './old-jarl.mjs';
import { spawnJarl, jarl, refuses, loop as makeLoop, SPAWN_TIMEOUT } from './helpers.mjs';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const L = await import('../jarl-lib.mjs');

const run = (root, ...args) => spawnJarl(root, args);
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const log = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const issueText = (root, id) => { const dir = join(root, '.jarl', 'issues'); return readFileSync(join(dir, readdirSync(dir).find((f) => f.startsWith(`${String(id).padStart(3, '0')}-`))), 'utf8'); };
const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8', timeout: SPAWN_TIMEOUT });

// A loop of one repository (the loop's own), with `n` issues filed.
const loop = (n = 0, goal = 'goal') => {
  const root = makeLoop({ prefix: 'jarl-mcheck-', goal, via: 'cli' });
  for (let k = 1; k <= n; k += 1) jarl(root, 'new', `issue ${k}`, '--acceptance', 'it works');
  return root;
};
// A loop of two repositories side by side: `app` (the loop's own) and `lib`; the issues named in `inLib` live in lib.
function twoRepos(n, inLib) {
  const parent = mkdtempSync(join(tmpdir(), 'jarl-mcheck-two-'));
  for (const name of ['app', 'lib']) { mkdirSync(join(parent, name)); git(join(parent, name), 'init', '-q', '-b', 'main'); }
  const root = join(parent, 'app');
  jarl(root, 'init', 'two repositories');
  for (let k = 1; k <= n; k += 1) jarl(root, 'new', `issue ${k}`, '--acceptance', 'it works');
  for (const id of inLib) jarl(root, 'repo', String(id), '../lib');
  return root;
}

test('Check (<repo>) lines name a repository\'s command; a bare Check line keeps meaning the whole loop\'s', () => {
  const root = loop();
  appendFileSync(join(root, '.jarl', 'goal.md'), '\nCheck: make all\n- **Check (lib):** `npm test`\nCheck (app): yg check\n');
  assert.deepEqual(L.declaredChecksByRepo(root), { bare: ['make all'], repos: { lib: ['npm test'], app: ['yg check'] } });
  assert.deepEqual(L.declaredChecks(root), ['make all', 'npm test', 'yg check']);
  const check = json(root, 'status').check;
  assert.equal(check.declared, true);
  assert.deepEqual(check.byRepo.lib.declared, ['npm test']);
  assert.deepEqual(check.byRepo.app.declared, ['yg check']);
});

test('merged --ran --saw records the evidence row and a merge line that names the check; no CI state is recorded unless given', () => {
  const root = loop(2);
  assert.equal(jarl(root, 'merged', '1,2', '--sha', 'abc1234', '--ran', 'npm test', '--saw', 'pass 12'), '001, 002 merged abc1234 · check npm test');
  for (const id of [1, 2]) {
    assert.match(issueText(root, id), /^- \*\*ran:\*\* npm test · \*\*saw:\*\* pass 12$/m);
    assert.match(issueText(root, id), /^\*\*Merged:\*\* abc1234$/m);
    assert.doesNotMatch(issueText(root, id), /\*\*CI:\*\*/);
  }
  assert.match(log(root), /^- \S+ \S+ · 001 evidence row · npm test$/m);
  assert.match(log(root), /^- \S+ \S+ · 002 merged abc1234 · check npm test$/m);
  assert.doesNotMatch(log(root), /merged abc1234.*CI/);
  const st = jarl(root, 'status');
  assert.doesNotMatch(st, /CI pending/);
  assert.doesNotMatch(st, /testimony/, 'a landing on a passing check row is not testimony');
  // With --ci too, the CI state follows the check in the line.
  jarl(root, 'merged', '2', '--sha', 'abc1234', '--ran', 'npm test', '--saw', 'pass 12', '--ci', 'pending');
  assert.match(log(root), /002 merged abc1234 · check npm test · CI pending$/m);
  // Free text in a command cannot add a field of its own.
  jarl(root, 'merged', '1', '--sha', 'abc1234', '--ran', 'npm test · CI red', '--saw', 'pass');
  assert.match(log(root), /001 merged abc1234 · check npm test - CI red$/m);
  assert.equal(L.mergeLineOf('001', '001 merged abc1234 · check npm test - CI red').ci, null);
});

test('merged --ran and --saw are checked before anything is written', () => {
  const root = loop(2);
  const before = log(root);
  assert.match(refuses(root, 'merged', '1', '--sha', 'abc1234', '--ran', 'npm test'), /a row needs both --ran/);
  assert.match(refuses(root, 'merged', '1', '--ran', 'npm test', '--saw', 'ok', '--ci', 'green'), /--ran and --saw record the check that decided the merge; give them with --sha/);
  assert.match(refuses(root, 'merged', '1,2', '--sha', 'abc1234', '--ran', 'a', '--ran', 'b', '--saw', 'ok'), /must repeat the same number of times/);
  assert.equal(log(root), before);
  assert.doesNotMatch(issueText(root, 1), /\*\*Merged:\*\*/);
});

test('a library call keeps pending as the default CI state of a merge; the command line records none', () => {
  const root = loop(2);
  const lib = R.recordMerged(root, '1', { sha: 'abc1234' });
  assert.equal(lib.ci, 'pending');
  assert.match(issueText(root, 1), /^\*\*CI:\*\* pending$/m);
  const cli = JSON.parse(jarl(root, 'merged', '2', '--sha', 'abc1234', '--json'));
  assert.equal(cli.ci, null);
  assert.doesNotMatch(issueText(root, 2), /\*\*CI:\*\*/);
});

test('merged --red <id> records a landing on a red check whose cause another issue tracks, never counted as a passing check', () => {
  const root = loop(3);
  assert.equal(jarl(root, 'merged', '1', '--sha', 'abc1234', '--red', '3'), '001 merged abc1234 · landed red, cause 003');
  assert.match(log(root), /^- \S+ \S+ · 001 merged abc1234 · landed red, cause 003$/m);
  assert.match(refuses(root, 'merged', '2', '--sha', 'abc1234', '--red', '99'), /does not exist/);
  assert.match(refuses(root, 'merged', '2', '--sha', 'abc1234', '--red', '2'), /is the issue being merged/);
  assert.match(refuses(root, 'merged', '2', '--sha', 'abc1234', '--red', '3', '--ran', 'npm test', '--saw', 'fail'), /not both/);
  assert.match(refuses(root, 'merged', '2', '--red', '3', '--ci', 'red'), /give it with --sha/);
  assert.doesNotMatch(issueText(root, 2), /\*\*Merged:\*\*/, 'a refusal writes nothing');
  const check = json(root, 'status').check;
  assert.deepEqual(check.merges, { merges: 1, withCheck: 0, noCheck: 0, red: [{ id: '001', cause: '003' }] });
  assert.equal(check.landsOn, 'testimony', 'a red landing is no passing check');
  // done notes nothing about an unrecorded CI for a merge that carries its check or its red.
  jarl(root, 'review', '1', 'approve', '--by', 'rev', 'read the diff and found nothing');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'fail in lib, tracked in 003');
  const done = run(root, 'set', '1', 'done', 'merged');
  assert.equal(done.status, 0);
  assert.doesNotMatch(done.stderr, /CI not recorded/);
});

test('done notes no unrecorded CI for a merge that carries a passing check row, and still notes one that carries none', () => {
  const root = loop(2);
  jarl(root, 'merged', '1', '--sha', 'abc1234', '--ran', 'npm test', '--saw', 'pass 3');
  jarl(root, 'merged', '2', '--sha', 'abc1234');
  for (const id of ['1', '2']) { jarl(root, 'review', id, 'approve', '--by', 'rev', 'read the diff and found nothing'); jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'pass 3'); }
  assert.doesNotMatch(run(root, 'set', '1', 'done', 'merged').stderr, /CI not recorded/);
  assert.match(run(root, 'set', '2', 'done', 'merged').stderr, /002 merged abc1234, CI not recorded/);
});

test('status --by repo and report count, per repository, merges with a passing check row, with none and landed on red', () => {
  const root = twoRepos(5, [3, 4, 5]);
  appendFileSync(join(root, '.jarl', 'goal.md'), '\nCheck (app): yg check\nCheck (lib): npm test\n');
  jarl(root, 'merged', '1', '--sha', 'abc1234', '--ran', 'yg check', '--saw', 'green');
  jarl(root, 'merged', '2', '--sha', 'abc1234');
  jarl(root, 'merged', '3', '--sha', 'abc1234', '--ran', 'npm test', '--saw', 'pass 9');
  jarl(root, 'merged', '4', '--sha', 'abc1234', '--red', '5');
  const status = json(root, 'status', '--by', 'repo');
  assert.deepEqual(status.check.byRepo.app, { merges: 2, withCheck: 1, noCheck: 1, red: [], declared: ['yg check'], landsOn: 'check' });
  assert.deepEqual(status.check.byRepo.lib, { merges: 2, withCheck: 1, noCheck: 0, red: [{ id: '004', cause: '005' }], declared: ['npm test'], landsOn: 'check' });
  assert.deepEqual(status.check.merges, { merges: 4, withCheck: 2, noCheck: 1, red: [{ id: '004', cause: '005' }] });
  const text = jarl(root, 'status', '--by', 'repo');
  assert.match(text, /^merges by repository, with the check that decided each:$/m);
  assert.match(text, /^ {2}app {2}2 merge\(s\) · passing check row 1 · no check row recorded 1 · landed on red 0 · declared yg check$/m);
  assert.match(text, /^ {2}lib {2}2 merge\(s\) · passing check row 1 · no check row recorded 0 · landed on red 1 \(004, cause 005\) · declared npm test$/m);
  assert.doesNotMatch(jarl(root, 'status'), /^merges by repository/m, 'only with --by repo');
  const report = jarl(root, 'report');
  assert.match(report, /^merges by repository:$/m);
  assert.match(report, /^ {2}lib {2}2 merge\(s\) · passing check row 1 · no check row recorded 0 · landed on red 1 \(004, cause 005\)/m);
  assert.deepEqual(json(root, 'report').check, status.check);
});

test('a loop whose merges carry no check row reads them as no check row recorded, never as failed', () => {
  const root = loop(3);
  // The merge records a loop wrote without a check: a Merged field and CI field, and its log lines.
  jarl(root, 'merged', '1', '--sha', 'abc1234', '--ci', 'green');
  jarl(root, 'merged', '2', '--sha', 'abc1234', '--ci', 'none');
  appendFileSync(join(root, '.jarl', 'goal.md'), '\nCheck: npm test\n');
  const check = json(root, 'status').check;
  assert.deepEqual(check.merges, { merges: 2, withCheck: 0, noCheck: 2, red: [] });
  assert.equal(check.landsOn, 'testimony', 'the declared line flips nothing');
  const m = json(root, 'report').metrics.redCiAfterMerge;
  assert.equal(m.settled, 1);
  assert.equal(m.red, 0, 'not read as failed');
  assert.deepEqual(m.none, ['002']);
  // A merge field with no log line at all (a file written by hand) counts as a merge with no check row.
  writeFileSync(join(root, '.jarl', 'log.md'), '# Log\n\n');
  const hand = json(root, 'status').check;
  assert.deepEqual(hand.merges, { merges: 2, withCheck: 0, noCheck: 2, red: [] });
});

test('the metrics count a merge line with no CI state as a merge whose CI is not recorded, and a pending one as pending', () => {
  const root = loop(2);
  jarl(root, 'merged', '1', '--sha', 'abc1234', '--ran', 'npm test', '--saw', 'pass');
  jarl(root, 'merged', '2', '--sha', 'abc1234', '--ci', 'pending');
  const m = json(root, 'report').metrics.redCiAfterMerge;
  assert.equal(m.n, 2);
  assert.equal(m.settled, 0);
  assert.deepEqual(m.pending, ['002']);
  assert.deepEqual(m.none, []);
  jarl(root, 'merged', '2', '--ci', 'green');
  assert.equal(json(root, 'report').metrics.redCiAfterMerge.settled, 1);
});

test('the pinned frozen reader reads a loop with merges carrying a check, a red landing and Check (<repo>) lines', () => {
  const root = loop(3);
  appendFileSync(join(root, '.jarl', 'goal.md'), '\nCheck (lib): npm test\n');
  jarl(root, 'merged', '1', '--sha', 'abc1234', '--ran', 'npm test', '--saw', 'pass 3');
  jarl(root, 'merged', '2', '--sha', 'abc1234', '--red', '3');
  jarl(root, 'merged', '3', '--sha', 'abc1234', '--ci', 'green');
  for (const command of ['list', 'status', 'next', 'queue']) assert.equal(oldJarl(root, command, {}).ok, true, command);
  const old = oldJarl(root, 'status', {}).value;
  assert.deepEqual(old.ciPending, [], 'no merge is pending');
  assert.deepEqual(old.ciRed, []);
  assert.equal(old.check.declared, false, 'a Check (<repo>) line is read as no check, the harmless direction');
  assert.match(JSON.stringify(oldJarl(root, 'list', {}).value), /Merged|abc1234|001/);
  // The frozen reader counts the merge lines through the Merged field: the lines it cannot match are still merges.
  const metrics = (root_) => L.loopMetrics(root_).redCiAfterMerge;
  assert.equal(metrics(root).n, 3);
});

test('init says once, on the command line, that a goal naming no check lands on testimony', () => {
  const bare = mkdtempSync(join(tmpdir(), 'jarl-mcheck-init-'));
  mkdirSync(join(bare, '.git'));
  const said = run(bare, 'init', 'a goal with no check');
  assert.equal(said.status, 0);
  assert.match(said.stderr, /note: the goal names no check .* lands on testimony alone until a merge records the check that decided it/);
  const named = mkdtempSync(join(tmpdir(), 'jarl-mcheck-init-'));
  mkdirSync(join(named, '.git'));
  assert.doesNotMatch(run(named, 'init', 'a goal\n\nCheck: npm test').stderr, /note:/);
  const lib = mkdtempSync(join(tmpdir(), 'jarl-mcheck-init-'));
  mkdirSync(join(lib, '.git'));
  assert.equal(R.initLoop(lib, 'a library goal').note, undefined, 'a library caller is told nothing');
});

// ---- the reply of review names the next step --------------------------------------------------------

const FINDINGS = 'read the diff and the tests, found nothing wrong';
const CHANGES = 'Important: the empty case is not handled';

test('the reply of review names the next step: an approve the merger\'s one merged call and done, changes the round', () => {
  const root = loop(2);
  jarl(root, 'set', '1', 'in-progress', 'start', '--branch', 'jarl/001-a', '--worker', 'w-one');
  const approve = jarl(root, 'review', '1', 'approve', '--by', 'rev-fresh', FINDINGS);
  assert.match(approve, /· next: the merger merges the branch and records it with one call — jarl\.mjs merged 001 --sha <sha> --ran "<check>" --saw "<summary>" — then jarl\.mjs set 001 done; a worker never sets done$/);
  const changes = jarl(root, 'review', '1', 'changes', '--by', 'rev-fresh', CHANGES);
  assert.match(changes, /· next: the jarl records the round — jarl\.mjs round 001 "<what failed>" — and a worker is raised again to fix it$/);
  // A coordinator's approve on code keeps its note and points at the fresh reviewer.
  const coordinator = run(root, 'review', '1', 'approve', '--by', 'jarl', FINDINGS);
  assert.match(coordinator.stderr, /carries code and jarl is a coordinator/);
  assert.match(coordinator.stdout, /· next: a fresh reviewer's approve is next/);
  // An issue with no code is closed by its evidence.
  assert.match(jarl(root, 'review', '2', 'approve', '--by', 'rev-fresh', FINDINGS), /· next: jarl\.mjs set 002 done once its evidence rows are recorded; a worker never sets done$/);
  // A package names the step for each issue; the JSON carries the same line.
  const both = json(root, 'review', '1,2', 'approve', '--by', 'rev-fresh', FINDINGS);
  assert.equal(both.length, 2);
  assert.match(both[0].next, /merged 001 --sha/);
  assert.match(both[1].next, /set 002 done/);
});

test('the same next step is in the reply of the MCP tool, and a library call keeps its reply as it is', async () => {
  const mcp = await import('../jarl-mcp.mjs');
  const root = loop(1);
  jarl(root, 'set', '1', 'in-progress', 'start', '--branch', 'jarl/001-a', '--worker', 'w-one');
  const r = mcp.callTool('jarl_review', { ids: '1', verdict: 'approve', findings: FINDINGS, by: 'rev-fresh', root });
  assert.match(r.content[0].text, /· next: the merger merges the branch and records it with one call/);
  const lib = R.review(root, '1', 'approve', FINDINGS, { by: 'rev-other' });
  assert.equal('next' in lib, false);
  const retract = jarl(root, 'review', '1', 'retract', '--by', 'jarl', 'the approve read the wrong diff');
  assert.doesNotMatch(retract, /next:/);
});
