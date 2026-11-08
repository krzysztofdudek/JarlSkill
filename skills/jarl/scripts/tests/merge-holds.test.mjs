// Recording a merge says, loudly and without refusing, when the recorded commit does not contain the tip of the issue's
// branch, or does not contain the base as it stands while the commit is not yet in it; and a merge recorded with neither a
// check nor a red cause is shown by status, resume and show as waiting for its check, until the check or the red cause is recorded;
// and it says, never refusing, when the approve the gate stands on was recorded on another tip of the branch than the one merged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { jarl, refuses, run, SPAWN_TIMEOUT } from './helpers.mjs';
import { BUILTIN_STATUSES } from '../jarl-lib.mjs';
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
  jarl(repo, 'new', 'issue one', '--acceptance', '[read] it works');
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

// A loop in `hub` whose first issue names the repository `tool` (a name), leased on jarl/1-x with one commit of its own.
// The tool checkout stays on main, which has not gained what the branch `release` has: the declared base is release.
function declaredBaseFixture(initFlags = []) {
  const parent = mkdtempSync(join(tmpdir(), 'jarl-holds-base-'));
  const [hub, tool] = ['hub', 'tool'].map((name) => join(parent, name));
  for (const dir of [hub, tool]) { mkdirSync(dir); git(dir, 'init', '-q', '-b', 'main'); commit(dir, 'a.txt', 'a\n'); }
  jarl(hub, 'init', 'goal', ...initFlags);
  jarl(hub, 'new', 'issue one', '--repo', '../tool', '--acceptance', '[read] it works');
  git(tool, 'checkout', '-q', '-b', 'release');
  commit(tool, 'r.txt', 'r\n');
  git(tool, 'checkout', '-q', '-b', 'jarl/1-x', 'main');
  commit(tool, 'b.txt', 'b\n');
  git(tool, 'checkout', '-q', 'main');
  jarl(hub, 'set', '1', 'in-progress', 'start', '--branch', 'jarl/1-x', '--worker', 'w-one');
  // A result that holds the branch and main, and lacks release.
  git(tool, 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x');
  return { hub, tool, sha: git(tool, 'rev-parse', 'HEAD') };
}

test('the base is the repository\'s declared base, not the branch its main checkout has open', () => {
  const { hub, tool, sha } = declaredBaseFixture();
  assert.doesNotMatch(said(hub, 'merged', '1', '--sha', sha, '--keep'), /MERGE WITHOUT/, 'no base is declared as release yet: the open branch is the base');
  jarl(hub, 'base', 'tool', 'release');
  assert.equal(git(tool, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  const out = said(hub, 'merged', '1', '--sha', sha, '--keep');
  assert.match(out, /MERGE WITHOUT THE BASE — [0-9a-f]+ does not contain release as it stands/);
  assert.doesNotMatch(out, /MERGE WITHOUT THE BRANCH/);
});

test('a result that holds the declared base is recorded without a note, whatever branch the main checkout has open', () => {
  const { hub, tool } = declaredBaseFixture();
  jarl(hub, 'base', 'tool', 'release');
  git(tool, 'checkout', '-q', 'release');
  git(tool, 'merge', '-q', '--no-ff', '-m', 'merge 1 into release', 'jarl/1-x');
  const sha = git(tool, 'rev-parse', 'HEAD');
  git(tool, 'checkout', '-q', 'main');
  assert.doesNotMatch(said(hub, 'merged', '1', '--sha', sha, '--keep'), /MERGE WITHOUT/);
});

test('a declared base the repository does not hold falls back to the branch the main checkout has open', () => {
  const { hub, sha } = declaredBaseFixture();
  jarl(hub, 'base', 'tool', 'no-such-branch');
  assert.doesNotMatch(said(hub, 'merged', '1', '--sha', sha, '--keep'), /MERGE WITHOUT/);
});

test('scope, branches and the merge queue of resume read the declared base, as the merge note does, whatever branch the main checkout has open', () => {
  const { hub } = declaredBaseFixture();
  const views = () => {
    // A scope that finds no commit beyond its base exits with a failure, and still prints what it read.
    const scope = JSON.parse(run(hub, ['scope', '1', '--branch', 'jarl/1-x', '--json']).stdout);
    const row = JSON.parse(jarl(hub, 'branches', '--json')).find((b) => b.branch === 'jarl/1-x');
    const queue = JSON.parse(jarl(hub, 'resume', '--json')).queue.repos.find((r) => r.repo === 'tool');
    return { scope: [scope.base, scope.items.find((i) => i.name === 'commits beyond base').ok], ahead: row.ahead, queue: [queue.base, queue.rows.map((r) => r.branch)] };
  };
  jarl(hub, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'all green');
  jarl(hub, 'review', '1', 'approve', '--by', 'rev-fresh', 'read the diff, nothing found');
  assert.deepEqual(views(), { scope: ['main', false], ahead: 0, queue: ['main', []] }, 'no base is declared: the open branch, which holds the merge, is the base');
  jarl(hub, 'base', 'tool', 'release');
  assert.deepEqual(views(), { scope: ['release', true], ahead: 1, queue: ['release', ['jarl/1-x']] }, 'the declared base does not hold the branch');
  assert.equal(JSON.parse(run(hub, ['scope', '1', '--branch', 'jarl/1-x', '--base', 'main', '--json']).stdout).base, 'main', '--base still names the base of one call');
});

// A profile whose done gate closes an issue only on a merge that landed in the base, with the default approve.
function landedGateProfile() {
  const file = join(mkdtempSync(join(tmpdir(), 'jarl-holds-profile-')), 'profile.json');
  writeFileSync(file, JSON.stringify({ 'jarl-profile': 1, format: 1, name: 'landed-gate', statuses: BUILTIN_STATUSES, 'done-gate': { 'requires-merged': true } }));
  return ['--profile', file];
}
const readyToClose = (hub) => {
  jarl(hub, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'all green');
  jarl(hub, 'review', '1', 'approve', '--by', 'rev-fresh', 'read the diff, nothing found');
};

test('the done gate\'s landed merge reads the declared base, as the merge note does, whatever branch the main checkout has open', () => {
  const { hub, tool } = declaredBaseFixture(landedGateProfile());
  jarl(hub, 'base', 'tool', 'release');
  git(tool, 'checkout', '-q', 'release');
  git(tool, 'merge', '-q', '--no-ff', '-m', 'merge 1 into release', 'jarl/1-x');
  const sha = git(tool, 'rev-parse', 'HEAD');
  git(tool, 'checkout', '-q', 'main');
  assert.doesNotMatch(said(hub, 'merged', '1', '--sha', sha, '--keep'), /MERGE WITHOUT/, 'the note finds the merge in the declared base');
  readyToClose(hub);
  assert.equal(jarl(hub, 'set', '1', 'done', 'landed in release'), '1 → done', 'the gate finds it there too');
});

test('the done gate refuses a merge that landed only in the branch the main checkout has open, naming the declared base', () => {
  const { hub, sha } = declaredBaseFixture(landedGateProfile());
  jarl(hub, 'base', 'tool', 'release');
  assert.match(said(hub, 'merged', '1', '--sha', sha, '--keep'), /MERGE WITHOUT THE BASE — [0-9a-f]+ does not contain release as it stands/);
  readyToClose(hub);
  const out = refuses(hub, 'set', '1', 'done', 'landed in main');
  assert.match(out, new RegExp(`^1 records Merged ${sha}, which is not in the base \\(release in [^)]*tool\\)`), out);
  assert.match(out, /\njarl\.mjs merged "<ids>" --sha "<sha>"\n$/, out);
});

test('the cleanup after a merge keeps the declared base when an issue is leased on it, whatever branch the main checkout has open', () => {
  const { hub, tool } = declaredBaseFixture();
  git(tool, 'checkout', '-q', '-b', 'integration', 'main');
  commit(tool, 'i.txt', 'i\n');
  git(tool, 'checkout', '-q', 'main');
  jarl(hub, 'new', 'issue two', '--repo', '../tool', '--acceptance', '[read] it works');
  jarl(hub, 'set', '2', 'in-progress', 'start', '--branch', 'integration', '--worker', 'w-two');
  jarl(hub, 'base', 'tool', 'integration');
  git(tool, 'merge', '-q', '--no-ff', '-m', 'merge integration', 'integration');
  const out = JSON.parse(run(hub, ['merged', '2', '--sha', git(tool, 'rev-parse', 'HEAD'), '--json']).stdout);
  assert.deepEqual(out.cleanup.map((c) => [c.branch, c.kept]), [['integration', 'it is the base or a release branch']]);
  assert.equal(git(tool, 'rev-parse', '--verify', '--quiet', 'refs/heads/integration').length > 0, true, 'the declared base is still there');
});

test('a squash merge is named a squash or rebase merge, not a merge without the branch', () => {
  const { repo } = fixture();
  git(repo, 'merge', '-q', '--squash', 'jarl/1-x');
  git(repo, 'commit', '-qm', 'squash 1');
  const out = said(repo, 'merged', '1', '--sha', git(repo, 'rev-parse', 'HEAD'), '--keep');
  assert.match(out, /SQUASH OR REBASE MERGE — [0-9a-f]+ does not contain the commits of jarl\/1-x/);
  assert.doesNotMatch(out, /MERGE WITHOUT/);
});

test('a rebase merge onto a base that moved on is named a squash or rebase merge', () => {
  const { repo, tip } = fixture();
  commit(repo, 'c.txt', 'c\n');
  git(repo, 'cherry-pick', tip);
  const out = said(repo, 'merged', '1', '--sha', git(repo, 'rev-parse', 'HEAD'), '--keep');
  assert.match(out, /SQUASH OR REBASE MERGE/);
  assert.doesNotMatch(out, /MERGE WITHOUT/);
});

test('a commit that holds some files of the branch but not as the branch has them is a merge without the branch', () => {
  const { repo } = fixture();
  commit(repo, 'b.txt', 'another b\n');
  const out = said(repo, 'merged', '1', '--sha', git(repo, 'rev-parse', 'HEAD'), '--keep');
  assert.match(out, /MERGE WITHOUT THE BRANCH — [0-9a-f]+ does not contain the tip of jarl\/1-x/);
  assert.doesNotMatch(out, /SQUASH OR REBASE/);
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

test('an issue closed on a merge that never recorded a check is named by status, until the check is recorded', () => {
  const { repo } = approved();
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x');
  const sha = git(repo, 'rev-parse', 'HEAD');
  jarl(repo, 'merged', '1', '--sha', sha, '--keep');
  jarl(repo, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'all green');
  assert.doesNotMatch(jarl(repo, 'status'), /closed with no check/, 'an open issue is waiting for its check, not closed without one');
  assert.equal(jarl(repo, 'set', '1', 'done', 'merged'), '1 → done');
  assert.doesNotMatch(jarl(repo, 'status'), /waiting for its check/);
  assert.match(jarl(repo, 'status'), new RegExp(`closed with no check recorded on the merge: 1 \\(${sha}\\) — if its check ran, record it: jarl\\.mjs merged "<id>" --sha "<sha>" --ran`));
  assert.deepEqual(JSON.parse(jarl(repo, 'status', '--json')).closedNoCheck, [{ id: '1', sha }]);
  jarl(repo, 'merged', '1', '--sha', sha, '--ran', 'npm test', '--saw', 'all green', '--keep');
  assert.doesNotMatch(jarl(repo, 'status'), /closed with no check/);
  assert.deepEqual(JSON.parse(jarl(repo, 'status', '--json')).closedNoCheck, []);
});

test('a merge recorded on a red check with its cause is not shown as waiting for its check', () => {
  const { repo } = fixture();
  jarl(repo, 'new', 'the cause', '--acceptance', '[read] it is found');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x');
  jarl(repo, 'merged', '1', '--sha', git(repo, 'rev-parse', 'HEAD'), '--red', '2', '--keep');
  assert.doesNotMatch(jarl(repo, 'status'), /waiting for its check/);
});

test('merged without --sha is refused naming the head of the branch the lease records, and the sha that landed is left for the caller to give', () => {
  const { repo, tip } = fixture();
  const out = refuses(repo, 'merged', '1', '--ci', 'green');
  assert.match(out, /records no merge yet/);
  assert.ok(out.includes(`the head of jarl/1-x, the branch its lease records, is ${tip}`), out);
  assert.ok(out.includes("give the sha that landed: jarl.mjs merged 1 --sha \"<sha>\" --ci \"<ci-state>\""), out);
  assert.ok(!out.includes(`--sha ${tip}`), `no command is composed with the head as the sha: ${out}`);
  assert.doesNotMatch(jarl(repo, 'show', '1'), /Merged:/);
});

test('merged without --sha on an issue whose lease records no branch says so, and gives the command with a sha to fill in', () => {
  const repo = join(mkdtempSync(join(tmpdir(), 'jarl-holds-')), 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  commit(repo, 'a.txt', 'a\n');
  jarl(repo, 'init', 'goal');
  jarl(repo, 'new', 'issue one', '--acceptance', '[read] it works');
  const out = refuses(repo, 'merged', '1', '--ci', 'green');
  assert.match(out, /records no merge yet/);
  assert.match(out, /its lease records no branch, so no head is offered/);
  assert.ok(out.includes("jarl.mjs merged 1 --sha \"<sha>\" --ci \"<ci-state>\""), out);
  assert.doesNotMatch(jarl(repo, 'show', '1'), /Merged:/);
});

// ---- the approve's tip against the tip being merged -------------------------------------------------------------------

const APPROVED_ELSEWHERE = /APPROVED ON ANOTHER TIP/;
// The commands the note gives to see what changed between two tips in a repository: the branch's commits along its first
// parents, merges included, and the whole difference; the path as the shell takes it.
const seeing = (dir, a, b) => {
  const at = realpathSync.native(dir);
  const word = /^[A-Za-z0-9_@%+=:,./-]+$/.test(at) ? at : `'${at}'`;
  return `git -C ${word} log --oneline --first-parent ${a}..${b} and git -C ${word} diff ${a} ${b}`;
};
// The fixture with its issue approved by a fresh reviewer on the branch as it stands, and a helper that adds a commit on
// the branch after that approve.
function approved() {
  const f = fixture();
  jarl(f.repo, 'review', '1', 'approve', '--by', 'rev-fresh', 'read the diff, nothing found');
  const later = (file) => { git(f.repo, 'checkout', '-q', 'jarl/1-x'); commit(f.repo, file, `${file}\n`); git(f.repo, 'checkout', '-q', 'main'); return git(f.repo, 'rev-parse', 'jarl/1-x'); };
  return { ...f, later };
}

test('a merge of a branch that gained a commit after its approve names both tips and the commands, and is still recorded', () => {
  const { repo, tip, later } = approved();
  const now = later('late.txt');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x');
  const sha = git(repo, 'rev-parse', 'HEAD');
  const out = said(repo, 'merged', '1', '--sha', sha, '--keep');
  assert.match(out, APPROVED_ELSEWHERE);
  const [a, b] = [tip.slice(0, 12), now.slice(0, 12)];
  assert.ok(out.includes(`approve by rev-fresh (fresh) was recorded on jarl/1-x at ${a}, and the branch stands at ${b} at this merge`), out);
  assert.ok(out.includes(`see it: ${seeing(repo, a, b)}`), out);
  assert.ok(out.includes("jarl.mjs review 1 \"<verdict>\" --by \"<a-fresh-reviewer>\" \"<text>\""), out);
  assert.doesNotMatch(out, /MERGE WITHOUT/);
  assert.match(jarl(repo, 'show', '1'), new RegExp(`Merged:\\*\\* ${sha}`));
});

test('a merge of the tip the approve was recorded on says nothing about the approve', () => {
  const { repo } = approved();
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x');
  assert.doesNotMatch(said(repo, 'merged', '1', '--sha', git(repo, 'rev-parse', 'HEAD'), '--keep'), APPROVED_ELSEWHERE);
});

test('a fast-forward to a branch that gained a commit after its approve is noted; a fast-forward to the approved tip is not', () => {
  const { repo, later } = approved();
  const now = later('late.txt');
  git(repo, 'merge', '-q', '--ff-only', 'jarl/1-x');
  assert.match(said(repo, 'merged', '1', '--sha', now, '--keep'), APPROVED_ELSEWHERE);
  const second = approved();
  git(second.repo, 'merge', '-q', '--ff-only', 'jarl/1-x');
  assert.doesNotMatch(said(second.repo, 'merged', '1', '--sha', second.tip, '--keep'), APPROVED_ELSEWHERE);
});

test('a merge of the approved tip, while the branch has moved on, lands what was reviewed: only the merge without the branch is noted', () => {
  const { repo, tip, later } = approved();
  later('late.txt');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge the approved tip', tip);
  const out = said(repo, 'merged', '1', '--sha', git(repo, 'rev-parse', 'HEAD'), '--keep');
  assert.match(out, /MERGE WITHOUT THE BRANCH/);
  assert.doesNotMatch(out, APPROVED_ELSEWHERE);
});

test('a merge of a commit made after the approve, while the branch moved on again before it was recorded, names the commit that landed and not the later one', () => {
  const { repo, tip, later } = approved();
  const landed = later('late.txt');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge a commit after the approve', landed);
  const now = later('later.txt');
  const out = said(repo, 'merged', '1', '--sha', git(repo, 'rev-parse', 'HEAD'), '--keep');
  assert.match(out, /MERGE WITHOUT THE BRANCH/);
  assert.match(out, APPROVED_ELSEWHERE);
  const [a, c, d] = [tip, landed, now].map((s) => s.slice(0, 12));
  assert.ok(out.includes(`recorded on jarl/1-x at ${a}, and this merge holds the branch up to ${c} (it stands at ${d} now), so what changed from ${a} to ${c} landed without that review`), out);
  assert.ok(out.includes(`see it: ${seeing(repo, a, c)}`), out);
  assert.doesNotMatch(out, new RegExp(`${d} at this merge`));
});

// The fixture with a.txt changed on the branch and approved there, then changed otherwise on the base, and the base merged
// into the branch with the conflict resolved by a line of new code.
function approvedThenBaseMerged() {
  const f = fixture();
  git(f.repo, 'checkout', '-q', 'jarl/1-x');
  commit(f.repo, 'a.txt', 'branch\n');
  git(f.repo, 'checkout', '-q', 'main');
  const tip = git(f.repo, 'rev-parse', 'jarl/1-x');
  jarl(f.repo, 'review', '1', 'approve', '--by', 'rev-fresh', 'read the diff, nothing found');
  commit(f.repo, 'a.txt', 'base\n');
  git(f.repo, 'checkout', '-q', 'jarl/1-x');
  spawnSync('git', ['merge', '-q', 'main'], { cwd: f.repo, encoding: 'utf8', timeout: SPAWN_TIMEOUT });
  writeFileSync(join(f.repo, 'a.txt'), 'branch and base\nnew code written in the conflict fix\n');
  git(f.repo, 'add', 'a.txt');
  git(f.repo, 'commit', '-qm', 'merge the base into the branch');
  git(f.repo, 'checkout', '-q', 'main');
  return { ...f, tip, now: git(f.repo, 'rev-parse', 'jarl/1-x') };
}

test('a merge of the base into the branch after the approve is noted, and the commands show that merge and the code its conflict fix added', () => {
  const { repo, tip, now } = approvedThenBaseMerged();
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x');
  const out = said(repo, 'merged', '1', '--sha', git(repo, 'rev-parse', 'HEAD'), '--keep');
  assert.match(out, APPROVED_ELSEWHERE);
  const [a, b] = [tip.slice(0, 12), now.slice(0, 12)];
  assert.ok(out.includes(`see it: ${seeing(repo, a, b)}`), out);
  assert.match(git(repo, 'log', '--oneline', '--first-parent', `${a}..${b}`), /merge the base into the branch/);
  assert.match(git(repo, 'diff', a, b), /\+new code written in the conflict fix/);
});

test('a merge of only the approved tip, after the base was merged into the branch, says nothing about the approve', () => {
  const { repo, tip } = approvedThenBaseMerged();
  spawnSync('git', ['merge', '-q', '--no-ff', '-m', 'merge the approved tip', tip], { cwd: repo, encoding: 'utf8', timeout: SPAWN_TIMEOUT });
  writeFileSync(join(repo, 'a.txt'), 'resolved by the merger\n');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '-qm', 'merge the approved tip');
  assert.doesNotMatch(said(repo, 'merged', '1', '--sha', git(repo, 'rev-parse', 'HEAD'), '--keep'), APPROVED_ELSEWHERE);
});

test('a recorded commit that is not in the repository is noted as not found here, never as landed', () => {
  const { repo, tip, later } = approved();
  const now = later('late.txt');
  const out = said(repo, 'merged', '1', '--sha', 'abcdef1234567', '--keep');
  assert.match(out, APPROVED_ELSEWHERE);
  assert.ok(out.includes(`at ${tip.slice(0, 12)}, and the branch stands at ${now.slice(0, 12)}; abcdef123456 is not found here, so what it holds cannot be read`), out);
  assert.doesNotMatch(out, /landed without that review/);
});

test('a squash merge is noted when the branch moved after its approve, and not when it did not', () => {
  const { repo, later } = approved();
  later('late.txt');
  git(repo, 'merge', '-q', '--squash', 'jarl/1-x');
  git(repo, 'commit', '-qm', 'squash 1');
  assert.match(said(repo, 'merged', '1', '--sha', git(repo, 'rev-parse', 'HEAD'), '--keep'), APPROVED_ELSEWHERE);
  const second = approved();
  git(second.repo, 'merge', '-q', '--squash', 'jarl/1-x');
  git(second.repo, 'commit', '-qm', 'squash 1');
  assert.doesNotMatch(said(second.repo, 'merged', '1', '--sha', git(second.repo, 'rev-parse', 'HEAD'), '--keep'), APPROVED_ELSEWHERE);
});

test('an approve that carries no tip, as one recorded before the branch existed, is not compared', () => {
  const repo = join(mkdtempSync(join(tmpdir(), 'jarl-holds-')), 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  commit(repo, 'a.txt', 'a\n');
  jarl(repo, 'init', 'goal');
  jarl(repo, 'new', 'issue one', '--acceptance', '[read] it works');
  jarl(repo, 'set', '1', 'in-progress', 'start', '--branch', 'jarl/1-x', '--worker', 'w-one');
  jarl(repo, 'review', '1', 'approve', '--by', 'rev-fresh', 'read the plan, nothing found');
  git(repo, 'checkout', '-q', '-b', 'jarl/1-x');
  commit(repo, 'b.txt', 'b\n');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x');
  assert.doesNotMatch(readFileSync(join(repo, '.jarl', 'log.md'), 'utf8'), / · 1 tip /, 'the approve carries no tip');
  assert.doesNotMatch(said(repo, 'merged', '1', '--sha', git(repo, 'rev-parse', 'HEAD'), '--keep'), APPROVED_ELSEWHERE);
});

test('a review recorded after the note is the approve the gate stands on, and done closes the issue', () => {
  const { repo, later } = approved();
  later('late.txt');
  jarl(repo, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'all green');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x');
  assert.match(said(repo, 'merged', '1', '--sha', git(repo, 'rev-parse', 'HEAD'), '--keep'), APPROVED_ELSEWHERE);
  jarl(repo, 'review', '1', 'approve', '--by', 'rev-fresh-2', 'read the late commit, nothing found');
  assert.equal(jarl(repo, 'set', '1', 'done', 'merged'), '1 → done');
});

test('an issue of several repositories is noted per repository whose tip moved after the approve: landed where the merge is, not in this merge elsewhere, nothing where it did not move', () => {
  const parent = mkdtempSync(join(tmpdir(), 'jarl-holds-multi-'));
  const dirs = {};
  for (const name of ['hub', 'tool', 'lib', 'doc']) {
    dirs[name] = join(parent, name);
    mkdirSync(dirs[name]);
    git(dirs[name], 'init', '-q', '-b', 'main');
    commit(dirs[name], 'a.txt', 'a\n');
  }
  const { hub, tool, lib, doc } = dirs;
  jarl(hub, 'init', 'goal');
  jarl(hub, 'new', 'cross', '--repo', '../tool,../lib,../doc', '--acceptance', '[read] it works');
  for (const r of [tool, lib, doc]) { git(r, 'checkout', '-q', '-b', 'jarl/1-x'); commit(r, 'b.txt', 'b\n'); git(r, 'checkout', '-q', 'main'); }
  jarl(hub, 'set', '1', 'in-progress', 'start', '--branch', 'jarl/1-x', '--worker', 'w-one');
  jarl(hub, 'review', '1', 'approve', '--by', 'rev-fresh', 'read the diff, nothing found');
  const moved = (r) => { const was = git(r, 'rev-parse', 'jarl/1-x'); git(r, 'checkout', '-q', 'jarl/1-x'); commit(r, 'late.txt', 'late\n'); git(r, 'checkout', '-q', 'main'); return [was, git(r, 'rev-parse', 'jarl/1-x')].map((s) => s.slice(0, 12)); };
  const [libWas, libNow] = moved(lib);
  const [toolWas, toolNow] = moved(tool);
  git(lib, 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x');
  const out = said(hub, 'merged', '1', '--sha', git(lib, 'rev-parse', 'HEAD'), '--keep');
  assert.match(out, APPROVED_ELSEWHERE);
  assert.ok(out.includes(`in lib ${libWas} → ${libNow}, which this merge holds without that review, see it: ${seeing(lib, libWas, libNow)}`), out);
  assert.ok(out.includes(`in tool ${toolWas} → ${toolNow}, not in this merge, see it: ${seeing(tool, toolWas, toolNow)}`), out);
  assert.doesNotMatch(out, /in doc /);
});

// Two repositories beside a hub loop, the issue's branch with one commit in each, approved there by a fresh reviewer, and
// then a commit on tool's branch after the approve. Each repository's merge is made and recorded on its own.
function twoRepositoriesMovedInTool() {
  const parent = mkdtempSync(join(tmpdir(), 'jarl-holds-two-'));
  const dirs = {};
  for (const name of ['hub', 'tool', 'lib']) {
    dirs[name] = join(parent, name);
    mkdirSync(dirs[name]);
    git(dirs[name], 'init', '-q', '-b', 'main');
    commit(dirs[name], 'a.txt', 'a\n');
  }
  const { hub, tool, lib } = dirs;
  jarl(hub, 'init', 'goal');
  jarl(hub, 'new', 'cross', '--repo', '../tool,../lib', '--acceptance', '[read] it works');
  for (const r of [tool, lib]) { git(r, 'checkout', '-q', '-b', 'jarl/1-x'); commit(r, 'b.txt', 'b\n'); git(r, 'checkout', '-q', 'main'); }
  jarl(hub, 'set', '1', 'in-progress', 'start', '--branch', 'jarl/1-x', '--worker', 'w-one');
  jarl(hub, 'review', '1', 'approve', '--by', 'rev-fresh', 'read the diff, nothing found');
  const was = git(tool, 'rev-parse', 'jarl/1-x').slice(0, 12);
  git(tool, 'checkout', '-q', 'jarl/1-x'); commit(tool, 'late.txt', 'late\n'); git(tool, 'checkout', '-q', 'main');
  const now = git(tool, 'rev-parse', 'jarl/1-x').slice(0, 12);
  const merge = (r) => { git(r, 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x'); return git(r, 'rev-parse', 'HEAD'); };
  return { hub, tool, lib, was, now, merge };
}

test('two repositories recorded one after the other: the cleanup of the first one\'s branch does not silence the note on the second', () => {
  const { hub, tool, lib, was, now, merge } = twoRepositoriesMovedInTool();
  assert.doesNotMatch(said(hub, 'merged', '1', '--sha', merge(lib), '--repo', '../lib'), /landed without|in lib /, "lib's tip did not move, and tool is not in this merge");
  assert.equal(git(lib, 'branch', '--list', 'jarl/1-x'), '', "the cleanup deleted lib's branch");
  const out = said(hub, 'merged', '1', '--sha', merge(tool), '--repo', '../tool');
  assert.match(out, APPROVED_ELSEWHERE);
  assert.ok(out.includes(`in tool ${was} → ${now}, which this merge holds without that review, see it: ${seeing(tool, was, now)}`), out);
  assert.doesNotMatch(out, /in lib /);
});

test('two repositories recorded one after the other with their branches kept: the repository merged first is said to be not in this merge, never not merged yet', () => {
  const { hub, tool, lib, was, now, merge } = twoRepositoriesMovedInTool();
  assert.match(said(hub, 'merged', '1', '--sha', merge(tool), '--repo', '../tool', '--keep'), new RegExp(`in tool ${was} → ${now}, which this merge holds without that review`));
  const out = said(hub, 'merged', '1', '--sha', merge(lib), '--repo', '../lib', '--keep');
  assert.ok(out.includes(`in tool ${was} → ${now}, not in this merge, see it: ${seeing(tool, was, now)}`), out);
  assert.doesNotMatch(out, /not merged yet|landed without/);
});

// Two repositories beside a hub loop with the issue approved on a branch in each, and then the lib checkout moved out of
// the place the issue's Repo field points to, as a repository that is missing from this machine.
function twoRepositoriesOneAway() {
  const parent = mkdtempSync(join(tmpdir(), 'jarl-holds-away-'));
  const dirs = {};
  for (const name of ['hub', 'tool', 'lib']) {
    dirs[name] = join(parent, name);
    mkdirSync(dirs[name]);
    git(dirs[name], 'init', '-q', '-b', 'main');
    commit(dirs[name], 'a.txt', 'a\n');
  }
  const { hub, tool, lib } = dirs;
  jarl(hub, 'init', 'goal');
  jarl(hub, 'new', 'cross', '--repo', '../tool,../lib', '--acceptance', '[read] it works');
  for (const r of [tool, lib]) { git(r, 'checkout', '-q', '-b', 'jarl/1-x'); commit(r, 'b.txt', 'b\n'); git(r, 'checkout', '-q', 'main'); }
  jarl(hub, 'set', '1', 'in-progress', 'start', '--branch', 'jarl/1-x', '--worker', 'w-one');
  jarl(hub, 'review', '1', 'approve', '--by', 'rev-fresh', 'read the diff, nothing found');
  const was = git(tool, 'rev-parse', 'jarl/1-x').slice(0, 12);
  renameSync(lib, join(parent, 'lib-moved-away'));
  const merge = () => { git(tool, 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x'); return git(tool, 'rev-parse', 'HEAD'); };
  return { hub, tool, was, merge };
}

test('a repository that is missing from this machine keeps the note silent when another repository\'s branch did not move', () => {
  const { hub, merge } = twoRepositoriesOneAway();
  assert.doesNotMatch(said(hub, 'merged', '1', '--sha', merge(), '--repo', '../tool', '--keep'), APPROVED_ELSEWHERE);
});

test('a repository that is missing from this machine does not silence the note for the repository that is, when its branch moved', () => {
  const { hub, tool, was, merge } = twoRepositoriesOneAway();
  git(tool, 'checkout', '-q', 'jarl/1-x');
  commit(tool, 'late.txt', 'late\n');
  git(tool, 'checkout', '-q', 'main');
  const now = git(tool, 'rev-parse', 'jarl/1-x').slice(0, 12);
  const out = said(hub, 'merged', '1', '--sha', merge(), '--repo', '../tool', '--keep');
  assert.match(out, APPROVED_ELSEWHERE);
  assert.ok(out.includes(`recorded on jarl/1-x at ${was}, and the branch stands at ${now} at this merge`), out);
  assert.ok(out.includes(`see it: ${seeing(tool, was, now)}`), out);
});
