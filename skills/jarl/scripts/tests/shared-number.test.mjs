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
    ['merged', '2', '--sha', 'abc1234', '--ran', 'npm test', '--saw', 'all green'],
    ['scope', '2', '--branch', 'jarl/2-x'],
    ['field', '2', 'Resources', 'db'],
    ['source', '2', 'research/r#f1'],
    ['repo', '2', '.'],
    ['retract', '2', '1', '--by', 'jarl', 'the row was wrong'],
    ['decide', 'which-one', 'the ruling text', '--settles', '2'],
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

// Clone A files its second issue and drops it; clone B files its own second issue and merges A in. B's file reads open.
function droppedOnOneSide() {
  const a = committedLoop();
  const b = cloneOf(a.dir);
  fileAndCommit(a, 'second on A');
  jarl(a.dir, 'set', '2', 'dropped', 'not needed');
  a.g('add', '-A'); a.g('commit', '-qm', 'a drops its 2');
  fileAndCommit(b, 'second on B');
  b.g('pull', '-q', '--no-rebase', '--no-edit', 'origin', 'main');
  return b;
}
// Gives the file `from` the number `to`: its name and its first line, as the finding says.
function renumber(at, from, to) {
  const issues = join(at.dir, '.jarl', 'issues');
  const text = readFileSync(join(issues, from), 'utf8');
  const name = from.replace(/^\d+-/, `${to}-`);
  at.g('mv', `.jarl/issues/${from}`, `.jarl/issues/${name}`);
  writeFileSync(join(issues, name), text.replace(/^# \d+ ·/, `# ${to} ·`));
}

// What verify, status, resume and show say of the loop, joined: where a header advice would show.
const views = (at, id = '2') => [run(at.dir, ['verify']).stdout, jarl(at.dir, 'status'), jarl(at.dir, 'resume'), jarl(at.dir, 'show', id)].join('\n');
// Any header advice about the number 2: a field of its header set against the log, or the command that writes the
// header from the log. Either would copy the log's state, which may be another file's, into the file that keeps 2.
const JUDGES_2 = /record: 2 (Status|Branch|Worker|Model|Since|Merged|Merge check|CI) |jarl\.mjs set 2 \S+ --header/;

test('the finding says the log cannot tell the lines apart and that the headers are not judged, and names no file to renumber', () => {
  const b = droppedOnOneSide();
  const said = run(b.dir, ['verify']).stdout;
  assert.match(said, /it cannot tell its lines for 2 apart/);
  assert.match(said, /Jarl does not judge these files' headers against the log/);
  assert.match(said, /give one of the files a number the loop does not hold, such as 3/);
  assert.match(said, /a fresh review again/);
  assert.match(said, /write in a log note which earlier lines of 2 belong to which file/);
  assert.doesNotMatch(said, /Give issues\/|either may|number settled/, 'no file is singled out and no settling line is asked for');
  assert.doesNotMatch(said, JUDGES_2);
  assert.match(jarl(b.dir, 'list'), /second on A[\s\S]*second on B/, 'plain list shows both while the number reads as dropped');
});

// Each order of the hand procedure, with the views read after every step: the file renumbered, its new number put in
// the log, the note, and a move of the number kept to the status its own file reads.
for (const [which, renamed, keptStatus, newMove] of [
  ['the file nobody moved', '2-second-on-b.md', 'dropped', ['set', '3', 'open']],
  ['the file the log moved', '2-second-on-a.md', 'open', ['set', '3', 'dropped', 'not needed']],
]) {
  test(`renumbering ${which} gives no header advice for the number kept at any step, and verify ends clean with a note`, () => {
    const b = droppedOnOneSide();
    renumber(b, renamed, 3);
    assert.doesNotMatch(views(b), JUDGES_2, 'after the renumbering');
    assert.match(run(b.dir, ['verify']).stdout, /^note: issue 2: the log files 2 2 times[^\n]*Jarl does not judge the header of issues\/2-/m);
    jarl(b.dir, ...newMove);
    assert.doesNotMatch(views(b), JUDGES_2, 'after the new number is in the log');
    jarl(b.dir, 'log', 'the drop of 2 before the merge was for the first clone\'s file; the second clone\'s file was never moved');
    assert.doesNotMatch(views(b), JUDGES_2, 'after the note');
    if (keptStatus === 'open') jarl(b.dir, 'set', '2', 'open');
    assert.doesNotMatch(views(b), JUDGES_2, 'after the number kept is moved to its own status');
    const after = run(b.dir, ['verify']);
    assert.equal(after.status, 0, after.stdout);
    assert.match(after.stdout, /^note: issue 2: the log files 2 2 times/m, 'the number stays unattributed, and says so');
    assert.equal(JSON.parse(jarl(b.dir, 'show', '3', '--json')).status, renamed === '2-second-on-b.md' ? 'open' : 'dropped');
  });
}

test('when the log holds a lease of one file and a drop of the other, neither file is told to take the other\'s Branch or status', () => {
  const a = committedLoop();
  a.g('checkout', '-q', '-b', 'one');
  fileAndCommit(a, 'second on one');
  jarl(a.dir, 'set', '2', 'in-progress', '--branch', 'jarl/2-one', '--worker', 'w-one');
  a.g('add', '-A'); a.g('commit', '-qm', 'one takes its 2');
  a.g('checkout', '-q', 'main'); a.g('checkout', '-q', '-b', 'two');
  fileAndCommit(a, 'second on two');
  jarl(a.dir, 'set', '2', 'dropped', 'not needed');
  a.g('add', '-A'); a.g('commit', '-qm', 'two drops its 2');
  a.g('checkout', '-q', 'one');
  a.g('merge', '-q', '--no-edit', 'two');
  // A note written before any renumbering changes nothing either: no line of the log switches the headers back on.
  jarl(a.dir, 'log', '2 number settled · written before the renumbering');
  assert.doesNotMatch(views(a, '1'), JUDGES_2, 'while both files carry 2');
  renumber(a, '2-second-on-one.md', 3);
  jarl(a.dir, 'set', '3', 'in-progress', '--branch', 'jarl/2-one', '--worker', 'w-one');
  jarl(a.dir, 'log', 'the lease of 2 was the file now 3; the drop of 2 was the file that keeps 2');
  const out = views(a);
  assert.doesNotMatch(out, JUDGES_2, out);
  assert.doesNotMatch(out, /Branch jarl\/2-one|--branch jarl\/2-one[^\n]*2-second-on-two/, 'the lease of the file now 3 is not advised into the file that keeps 2');
});

test('a third file merged in after the renumbering shares the number again and is refused and named', () => {
  const a = committedLoop();
  a.g('checkout', '-q', '-b', 'three');
  fileAndCommit(a, 'second on C');
  a.g('checkout', '-q', 'main'); a.g('checkout', '-q', '-b', 'one');
  fileAndCommit(a, 'second on A');
  a.g('checkout', '-q', 'main'); a.g('checkout', '-q', '-b', 'two');
  fileAndCommit(a, 'second on B');
  a.g('merge', '-q', '--no-edit', 'one');
  renumber(a, '2-second-on-b.md', 3);
  jarl(a.dir, 'set', '3', 'open');
  jarl(a.dir, 'log', 'the second on B is now 3');
  a.g('add', '-A'); a.g('commit', '-qm', 'renumbered');
  a.g('merge', '-q', '--no-edit', 'three');
  const r = run(a.dir, ['verify']);
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stdout, /2 issue files carry the number 2: issues\/2-second-on-a\.md and issues\/2-second-on-c\.md/);
  assert.match(refuses(a.dir, 'set', '2', 'dropped', 'x'), /issues\/2-second-on-a\.md and issues\/2-second-on-c\.md/);
  assert.doesNotMatch(views(a, '3'), JUDGES_2);
});

test('list, next and report mark both files of a shared number', () => {
  const dir = twoClones();
  const marked = /number shared: issues\/2-second-on-a\.md, issues\/2-second-on-b\.md/;
  for (const args of [['list'], ['next'], ['report']]) {
    const lines = jarl(dir, ...args).split('\n').filter((l) => /second on [AB]/.test(l));
    assert.equal(lines.length, 2, `${args[0]}: ${lines.join(' | ')}`);
    for (const l of lines) assert.match(l, marked, `${args[0]}: ${l}`);
  }
  assert.doesNotMatch(jarl(dir, 'list'), /filed before the split.*number shared/);
  assert.deepEqual(JSON.parse(jarl(dir, 'report', '--json')).issues.filter((i) => i.shared).map((i) => i.title), ['second on A', 'second on B']);
});

test('import --adopt that would write into a number two files carry is refused before it writes anything', () => {
  const a = committedLoop();
  jarl(a.dir, 'body', '1', '--what', 'covers jarl-1-A1');
  a.g('add', '-A'); a.g('commit', '-qm', 'a names a finding');
  const b = cloneOf(a.dir);
  fileAndCommit(a, 'second on A');
  jarl(b.dir, 'new', 'second on B', '--tier', 'light', '--what', 'covers jarl-2-B5');
  b.g('add', '-A'); b.g('commit', '-qm', 'b files');
  b.g('pull', '-q', '--no-rebase', '--no-edit', 'origin', 'main');
  const file = join(mkdtempSync(join(tmpdir(), 'jarl-shared-findings-')), 'findings.json');
  writeFileSync(file, JSON.stringify([{ id: 'jarl-1-A1', title: 'one' }, { id: 'jarl-2-B5', title: 'two' }]));
  const before = snapshot(b.dir);
  assert.match(refuses(b.dir, 'import', file, '--source', 'r', '--adopt'), BOTH);
  assert.deepEqual(snapshot(b.dir), before, 'issue 1 got no Source and no line was written');
});

test('the record library finds an issue as before, and refuses a number two files carry with both files named', () => {
  const dir = twoClones();
  assert.equal(R.findIssue(dir, '1').title, 'filed before the split');
  assert.equal(R.findIssue(dir, '9'), null);
  assert.throws(() => R.findIssue(dir, '2'), BOTH);
});
