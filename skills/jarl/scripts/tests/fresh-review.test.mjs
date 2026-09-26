// The fresh-review rule (issue 281): an issue that carries code — a Branch or a Merged field — goes done, and enters
// the merge queue, only on a live approve by a fresh reviewer; a coordinator's approve is recorded but does not clear
// it. An issue with neither field is still cleared by the coordinator. merged records a merge without a fresh review
// and says so loudly, never refusing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { reviewerKind, coordinatorNames, BASE_COORDINATORS } from '../jarl.mjs';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));

function run(root, args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}
function jarl(root, ...args) {
  const r = run(root, args);
  if (r.status !== 0) throw new Error(`jarl ${args.join(' ')} failed: ${r.stderr}`);
  return r;
}
function refuses(root, ...args) {
  const r = run(root, args);
  assert.notEqual(r.status, 0, `expected a refusal: ${args.join(' ')}`);
  return r.stderr;
}
const sh = (cwd, script) => execFileSync('bash', ['-c', script], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function loop() {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-fresh-'));
  sh(dir, 'git init -q -b feature && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null && echo 1 > a.mjs && git add -A && git commit -qm base');
  jarl(dir, 'init', 'goal');
  return dir;
}
// An in-progress issue on a branch, worked by w1, with one evidence row — ready for done but for its review.
function codeIssue(root, title = 'code') {
  const id = /filed (\d{3})/.exec(jarl(root, 'new', title, '--files', 'a.mjs').stdout)[1];
  jarl(root, 'set', id, 'in-progress', 'go', '--branch', `jarl/${id}-x`, '--worker', 'w1');
  jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'pass 1');
  return id;
}

test('reviewer kinds: self for the worker or "self"; coordinator for the fixed names, the loop\'s name and goal.md\'s names; fresh otherwise', () => {
  assert.equal(reviewerKind('Self', 'w1'), 'self');
  assert.equal(reviewerKind(' W1 ', 'w1'), 'self');
  for (const n of BASE_COORDINATORS) assert.equal(reviewerKind(n.toUpperCase(), 'w1'), 'coordinator');
  assert.equal(reviewerKind('opus-reviewer-7', 'w1'), 'fresh');
  const root = loop();
  const goal = join(root, '.jarl', 'goal.md');
  writeFileSync(goal, `${readFileSync(goal, 'utf8')}\n- **Coordinators:** Sigurd, odin-reeve\n`);
  const names = coordinatorNames(root);
  assert.ok(names.includes(basename(root)), 'the loop\'s own name is a coordinator');
  assert.equal(reviewerKind(basename(root), 'w1', names), 'coordinator');
  assert.equal(reviewerKind('sigurd', 'w1', names), 'coordinator');
  assert.equal(reviewerKind('odin-reeve', 'w1', names), 'coordinator');
  assert.equal(reviewerKind('opus-reviewer-7', 'w1', names), 'fresh');
  const id = codeIssue(root);
  assert.match(jarl(root, 'review', id, 'approve', '--by', 'Sigurd', 'read it').stdout, /by Sigurd \(coordinator\)/);
});

test('a code issue: a coordinator approve is recorded with a note, done refuses it naming the rule; a fresh approve clears it', () => {
  const root = loop();
  const id = codeIssue(root);
  const r = jarl(root, 'review', id, 'approve', '--by', 'jarl', 'looked at the diff');
  assert.match(r.stderr, /fresh-review rule/);
  const why = refuses(root, 'set', id, 'done');
  assert.match(why, /carries code \(Branch is recorded\)/);
  assert.match(why, /by jarl \(coordinator\)/);
  assert.match(why, /fresh-review rule/);
  assert.match(why, /--by <fresh reviewer>/);
  // Every coordinator name is refused the same way.
  for (const by of ['reeve', 'coordinator', basename(root)]) {
    jarl(root, 'review', id, 'approve', '--by', by, 'again');
    assert.match(refuses(root, 'set', id, 'done'), /fresh-review rule/);
  }
  assert.match(refuses(root, 'review', id, 'approve', '--by', 'self', 'mine'), /self-approve/);
  const ok = jarl(root, 'review', id, 'approve', '--by', 'opus-reviewer-1', 'Minor: a name');
  assert.doesNotMatch(ok.stderr, /fresh-review rule/);
  assert.match(jarl(root, 'set', id, 'done').stdout, new RegExp(`${id} → done`));
});

test('an issue with no Branch and no Merged field is still cleared by the coordinator', () => {
  const root = loop();
  const id = /filed (\d{3})/.exec(jarl(root, 'new', 'a ruling').stdout)[1];
  jarl(root, 'set', id, 'in-progress', 'go', '--worker', 'w1');
  jarl(root, 'evidence', id, '--ran', 'read decisions.md', '--saw', 'ruling recorded');
  const r = jarl(root, 'review', id, 'approve', '--by', 'jarl', 'fine');
  assert.doesNotMatch(r.stderr, /fresh-review rule/);
  assert.match(jarl(root, 'set', id, 'done').stdout, /→ done/);
});

test('a name goal.md declares a coordinator after its approve was logged as fresh no longer clears a code issue', () => {
  const root = loop();
  const id = codeIssue(root);
  jarl(root, 'review', id, 'approve', '--by', 'helga', 'ok');
  const goal = join(root, '.jarl', 'goal.md');
  writeFileSync(goal, `${readFileSync(goal, 'utf8')}\nCoordinators: helga\n`);
  assert.match(refuses(root, 'set', id, 'done'), /by helga \(coordinator\)/);
  const report = JSON.parse(jarl(root, 'status', '--json').stdout);
  assert.ok(report.reviews, 'status still reads');
});

test('queue: a coordinator approve alone keeps a branch out; a fresh approve puts it in', () => {
  const root = loop();
  const id = codeIssue(root);
  const wt = mkdtempSync(join(tmpdir(), 'jarl-wt-'));
  sh(root, `git worktree add -q -b jarl/${id}-x ${wt} feature`);
  sh(wt, 'echo change >> a.mjs && git add -A && git commit -qm work');
  jarl(root, 'review', id, 'approve', '--by', 'jarl', 'ok');
  assert.equal(JSON.parse(jarl(root, 'queue', '--json').stdout).repos[0].rows.length, 0);
  jarl(root, 'review', id, 'approve', '--by', 'opus-reviewer-2', 'ok');
  const rows = JSON.parse(jarl(root, 'queue', '--json').stdout).repos[0].rows;
  assert.deepEqual(rows.map((r) => r.issues), [[id]]);
  assert.equal(rows[0].by, 'opus-reviewer-2');
});

test('merged without a fresh approve is recorded and said loudly; with one, nothing is said', () => {
  const root = loop();
  const a = codeIssue(root, 'coordinated');
  const b = codeIssue(root, 'reviewed');
  jarl(root, 'review', a, 'approve', '--by', 'jarl', 'ok');
  jarl(root, 'review', b, 'approve', '--by', 'opus-reviewer-3', 'ok');
  const sha = sh(root, 'git rev-parse HEAD');
  const r = jarl(root, 'merged', a, '--sha', sha, '--ci', 'none');
  assert.match(r.stderr, /MERGED WITHOUT A FRESH REVIEW/);
  assert.match(r.stderr, /by jarl \(coordinator\)/);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), new RegExp(`${a} merged ${sha}`));
  const r2 = jarl(root, 'merged', b, '--sha', sha, '--ci', 'none');
  assert.doesNotMatch(r2.stderr, /MERGED WITHOUT A FRESH REVIEW/);
  // --ci alone moves the CI state and says nothing about the review.
  assert.doesNotMatch(jarl(root, 'merged', a, '--ci', 'green').stderr, /FRESH REVIEW/);
});
