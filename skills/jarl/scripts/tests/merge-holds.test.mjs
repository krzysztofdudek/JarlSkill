// Recording a merge says, loudly and without refusing, when the recorded commit does not contain the tip of the issue's
// branch, or does not contain the base as it stands while the commit is not yet in it; and a merge recorded with neither a
// check nor a red cause is shown by status, resume and show as waiting for its check, until the check or the red cause is recorded;
// and it says, never refusing, when the approve the gate stands on was recorded on another tip of the branch than the one merged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { jarl, refuses, run, SPAWN_TIMEOUT } from './helpers.mjs';
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

test('merged without --sha is refused with the ready command carrying the head of the branch the lease records', () => {
  const { repo, tip } = fixture();
  const out = refuses(repo, 'merged', '1', '--ci', 'green');
  assert.match(out, /records no merge yet/);
  assert.ok(out.includes(`the head of jarl/1-x, the branch its lease records, is ${tip}`), out);
  assert.ok(out.includes(`jarl.mjs merged 1 --sha ${tip} --ci green`), out);
  assert.doesNotMatch(jarl(repo, 'show', '1'), /Merged:/);
});

test('merged without --sha on an issue whose lease records no branch says so, and gives the command with a sha to fill in', () => {
  const repo = join(mkdtempSync(join(tmpdir(), 'jarl-holds-')), 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  commit(repo, 'a.txt', 'a\n');
  jarl(repo, 'init', 'goal');
  jarl(repo, 'new', 'issue one', '--acceptance', 'it works');
  const out = refuses(repo, 'merged', '1', '--ci', 'green');
  assert.match(out, /records no merge yet/);
  assert.match(out, /its lease records no branch, so no head is offered/);
  assert.ok(out.includes('jarl.mjs merged 1 --sha <sha> --ci green'), out);
  assert.doesNotMatch(jarl(repo, 'show', '1'), /Merged:/);
});

// ---- the approve's tip against the tip being merged -------------------------------------------------------------------

const APPROVED_ELSEWHERE = /APPROVED ON ANOTHER TIP/;
// The commands the note gives to see the branch's own commits between two tips in a repository, and their changes, its
// path as the shell takes it.
const seeing = (dir, a, b) => {
  const at = realpathSync.native(dir);
  const word = /^[A-Za-z0-9_@%+=:,./-]+$/.test(at) ? at : `'${at}'`;
  return `git -C ${word} log --oneline --first-parent --no-merges ${a}..${b} and git -C ${word} log -p --first-parent --no-merges ${a}..${b}`;
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
  assert.ok(out.includes('jarl.mjs review 1 approve|changes --by <fresh reviewer> "<findings>"'), out);
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

test('a merge of a commit made after the approve, while the branch moved on again before it was recorded, is noted with the approved tip and the branch tip', () => {
  const { repo, tip, later } = approved();
  const landed = later('late.txt');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge a commit after the approve', landed);
  const now = later('later.txt');
  const out = said(repo, 'merged', '1', '--sha', git(repo, 'rev-parse', 'HEAD'), '--keep');
  assert.match(out, /MERGE WITHOUT THE BRANCH/);
  assert.match(out, APPROVED_ELSEWHERE);
  assert.ok(out.includes(`recorded on jarl/1-x at ${tip.slice(0, 12)}, and the branch stands at ${now.slice(0, 12)} at this merge`), out);
});

test('after the base was merged into the branch, the commands of the note show only the branch\'s own commits', () => {
  const { repo, tip, later } = approved();
  commit(repo, 'base.txt', 'base\n');
  git(repo, 'checkout', '-q', 'jarl/1-x');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge the base into the branch', 'main');
  commit(repo, 'own.txt', 'own\n');
  git(repo, 'checkout', '-q', 'main');
  const now = git(repo, 'rev-parse', 'jarl/1-x');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x');
  const out = said(repo, 'merged', '1', '--sha', git(repo, 'rev-parse', 'HEAD'), '--keep');
  const [a, b] = [tip.slice(0, 12), now.slice(0, 12)];
  assert.ok(out.includes(`see it: ${seeing(repo, a, b)}`), out);
  const commits = git(repo, 'log', '--oneline', '--first-parent', '--no-merges', `${a}..${b}`);
  assert.match(commits, /add own\.txt/);
  assert.doesNotMatch(commits, /add base\.txt/);
  const changes = git(repo, 'log', '-p', '--first-parent', '--no-merges', `${a}..${b}`);
  assert.match(changes, /own\.txt/);
  assert.doesNotMatch(changes, /base\.txt/);
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
  jarl(repo, 'new', 'issue one', '--acceptance', 'it works');
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
  jarl(repo, 'evidence', '1', '--ran', 'npm test', '--saw', 'all green');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x');
  assert.match(said(repo, 'merged', '1', '--sha', git(repo, 'rev-parse', 'HEAD'), '--keep'), APPROVED_ELSEWHERE);
  jarl(repo, 'review', '1', 'approve', '--by', 'rev-fresh-2', 'read the late commit, nothing found');
  assert.equal(jarl(repo, 'set', '1', 'done', 'merged'), '1 → done');
});

test('an issue of several repositories is noted for the repository whose tip moved after the approve, and only that one', () => {
  const parent = mkdtempSync(join(tmpdir(), 'jarl-holds-multi-'));
  const dirs = {};
  for (const name of ['hub', 'tool', 'lib']) {
    dirs[name] = join(parent, name);
    mkdirSync(dirs[name]);
    git(dirs[name], 'init', '-q', '-b', 'main');
    commit(dirs[name], 'a.txt', 'a\n');
  }
  const { hub, tool, lib } = dirs;
  jarl(hub, 'init', 'goal');
  jarl(hub, 'new', 'cross', '--repo', '../tool,../lib', '--acceptance', 'it works');
  for (const r of [tool, lib]) { git(r, 'checkout', '-q', '-b', 'jarl/1-x'); commit(r, 'b.txt', 'b\n'); git(r, 'checkout', '-q', 'main'); }
  jarl(hub, 'set', '1', 'in-progress', 'start', '--branch', 'jarl/1-x', '--worker', 'w-one');
  jarl(hub, 'review', '1', 'approve', '--by', 'rev-fresh', 'read the diff, nothing found');
  const was = git(lib, 'rev-parse', 'jarl/1-x');
  git(lib, 'checkout', '-q', 'jarl/1-x'); commit(lib, 'late.txt', 'late\n'); git(lib, 'checkout', '-q', 'main');
  const now = git(lib, 'rev-parse', 'jarl/1-x');
  git(lib, 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x');
  const out = said(hub, 'merged', '1', '--sha', git(lib, 'rev-parse', 'HEAD'), '--keep');
  assert.match(out, APPROVED_ELSEWHERE);
  assert.ok(out.includes(`in lib ${was.slice(0, 12)} → ${now.slice(0, 12)}, see it: ${seeing(lib, was.slice(0, 12), now.slice(0, 12))}`), out);
  assert.doesNotMatch(out, /in tool /);
});
