// Two copies of one committed loop: two clones, or two branches of one checkout. A new issue takes its number over every
// local and remote-tracking branch of the clone, so a branch or a fetched clone that already filed a number is never
// given it again. Two clones that file before either sees the other still take one number each; after the merge the keys
// tell their lines apart, and renumber gives one of the two a free number without rewriting a line of the log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
  jarl(dir, 'new', 'filed before the split', '--acceptance', '[read] it works', '--tier', 'light');
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
  const out = json(at.dir, 'new', title, '--tier', 'light', '--acceptance', '[read] it works');
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

// Two clones that each file and work the second issue before either sees the other, the second merging the first: the
// merged checkout holds two files numbered 2, each with its own key and its own lines in the log.
const keyIn = (dir, file) => /^\*\*Key:\*\* (\S+)$/m.exec(readFileSync(join(dir, '.jarl', 'issues', file), 'utf8'))[1];
function twoClonesWorked() {
  const a = committedLoop();
  const b = cloneOf(a.dir);
  assert.equal(fileAndCommit(a, 'second on A'), '2');
  jarl(a.dir, 'set', '2', 'in-progress', '--branch', 'jarl/2-on-a', '--worker', 'wa', '--by', 'coordinator A');
  a.g('add', '-A'); a.g('commit', '-qm', 'a leases its 2');
  assert.equal(fileAndCommit(b, 'second on B'), '2', 'B has not seen A');
  jarl(b.dir, 'set', '2', 'in-progress', '--branch', 'jarl/2-on-b', '--worker', 'wb', '--by', 'coordinator B');
  jarl(b.dir, 'evidence', '2', '--line', '1', '--ran', 'npm test', '--saw', 'green on B', '--by', 'wb');
  b.g('add', '-A'); b.g('commit', '-qm', 'b works its 2');
  b.g('pull', '-q', '--no-rebase', '--no-edit', 'origin', 'main');
  return b;
}

for (const [shape, make] of [
  ['two clones', twoClonesWorked],
  ['two branches of one checkout, one of them fetched from a clone that filed before the fetch', () => {
    const a = committedLoop();
    const c = cloneOf(a.dir);
    assert.equal(fileAndCommit(c, 'second on B'), '2');
    jarl(c.dir, 'set', '2', 'in-progress', '--branch', 'jarl/2-on-b', '--worker', 'wb', '--by', 'coordinator B');
    jarl(c.dir, 'evidence', '2', '--line', '1', '--ran', 'npm test', '--saw', 'green on B', '--by', 'wb');
    c.g('add', '-A'); c.g('commit', '-qm', 'c works its 2');
    a.g('checkout', '-q', '-b', 'one');
    assert.equal(fileAndCommit(a, 'second on A'), '2', 'the clone\'s branch is not fetched yet');
    jarl(a.dir, 'set', '2', 'in-progress', '--branch', 'jarl/2-on-a', '--worker', 'wa', '--by', 'coordinator A');
    a.g('add', '-A'); a.g('commit', '-qm', 'a leases its 2');
    a.g('fetch', '-q', c.dir, 'main:two');
    a.g('merge', '-q', '--no-edit', 'two');
    return a;
  }],
]) {
  test(`${shape}: the keys keep the two issues numbered 2 apart, and renumber gives one of them a free number with no line of the log rewritten`, () => {
    const b = make();
    assert.deepEqual(issueFiles(b.dir), ['1-filed-before-the-split.md', '2-second-on-a.md', '2-second-on-b.md'], 'git merged both files without a conflict');
    const keyA = keyIn(b.dir, '2-second-on-a.md');
    const keyB = keyIn(b.dir, '2-second-on-b.md');
    assert.notEqual(keyA, keyB);
    // Before the renumbering: each file is read from its own keyed lines, and the number names no one issue.
    const listed = json(b.dir, 'list', '--all');
    const byFile = (f) => listed.find((i) => i.file.endsWith(f));
    assert.equal(byFile('2-second-on-a.md').fields.worker, 'wa');
    assert.equal(byFile('2-second-on-b.md').fields.worker, 'wb');
    const said = run(b.dir, ['verify']);
    assert.equal(said.status, 2, said.stdout);
    assert.match(said.stdout, /2 issue files carry the number 2: issues\/2-second-on-a\.md and issues\/2-second-on-b\.md/);
    assert.match(said.stdout, new RegExp(`jarl\\.mjs renumber 2 --key "<key>".*${keyA} \\(issues/2-second-on-a\\.md\\), ${keyB} \\(issues/2-second-on-b\\.md\\)`));
    assert.match(run(b.dir, ['set', '2', 'dropped', 'x']).stderr, /2 issue files carry the number 2/, 'a command that addresses 2 is refused');
    assert.match(run(b.dir, ['renumber', '2']).stderr, new RegExp(`name the one to give a free number with --key <key>`));
    assert.match(run(b.dir, ['renumber', '2', '--key', '20200101T0000-abcd']).stderr, /no file of 2 carries the key 20200101T0000-abcd/);
    assert.match(run(b.dir, ['renumber', '1', '--key', keyA]).stderr, /1 is carried by one issue file/);
    const logBefore = readFileSync(join(b.dir, '.jarl', 'log.md'), 'utf8');
    // The renumbering.
    const out = json(b.dir, 'renumber', '2', '--key', keyB, '--by', 'coordinator B');
    assert.deepEqual([out.from, out.id, out.key], ['2', '3', keyB]);
    assert.deepEqual(issueFiles(b.dir), ['1-filed-before-the-split.md', '2-second-on-a.md', '3-second-on-b.md']);
    assert.match(readFileSync(join(b.dir, '.jarl', 'issues', '3-second-on-b.md'), 'utf8'), /^# 3 · second on B\n/);
    const logAfter = readFileSync(join(b.dir, '.jarl', 'log.md'), 'utf8');
    assert.ok(logAfter.startsWith(logBefore), 'no line of the log is rewritten');
    assert.match(logAfter.slice(logBefore.length), new RegExp(`^- \\S+ \\S+ key ${keyB} by coordinator B · 3 renumbered from 2 · issues/3-second-on-b\\.md\\n$`));
    // After it: each issue is read from its own lines, under its own number.
    const two = json(b.dir, 'show', '2');
    const three = json(b.dir, 'show', '3');
    assert.deepEqual([two.title, two.status, two.fields.worker, two.fields.branch], ['second on A', 'in-progress', 'wa', 'jarl/2-on-a']);
    assert.deepEqual([three.title, three.status, three.fields.worker, three.fields.branch], ['second on B', 'in-progress', 'wb', 'jarl/2-on-b']);
    assert.deepEqual(two.evidenceRows, [], 'B\'s row is not A\'s');
    assert.deepEqual(three.evidenceRows.map((r) => r.saw), ['green on B']);
    const after = run(b.dir, ['verify']);
    assert.equal(after.status, 0, after.stdout);
    assert.doesNotMatch(after.stdout, /read from its header/);
    jarl(b.dir, 'set', '2', 'dropped', 'not needed');
    assert.equal(json(b.dir, 'show', '3').status, 'in-progress', 'a move of 2 does not reach 3');
  });
}

// Two clones that each lease the first issue before either sees the other, by two writers, the second merging the first. Both
// leases write the issue's header, which git cannot join: the merge keeps the first clone's file, and the log, merged by
// union, keeps both lease lines.
function leasedInTwoClones({ byB = 'coordinator B', handover = false } = {}) {
  const a = committedLoop();
  const b = cloneOf(a.dir);
  jarl(a.dir, 'set', '1', 'in-progress', '--branch', 'jarl/1-on-a', '--worker', 'wa', '--by', 'coordinator A');
  a.g('add', '-A'); a.g('commit', '-qm', 'a leases 1');
  jarl(b.dir, 'set', '1', 'in-progress', '--branch', 'jarl/1-on-b', '--worker', 'wb', '--by', byB);
  b.g('add', '-A'); b.g('commit', '-qm', 'b leases 1');
  assert.throws(() => b.g('pull', '-q', '--no-rebase', '--no-edit', 'origin', 'main'), 'the two headers conflict');
  b.g('checkout', '--theirs', '.jarl/issues/1-filed-before-the-split.md');
  b.g('add', '-A'); b.g('commit', '-qm', 'merge, keeping the first clone\'s file');
  if (handover) jarl(b.dir, 'set', '1', 'in-progress', 'the lease on B stands', '--handover', '--branch', 'jarl/1-on-b', '--worker', 'wb', '--by', 'jarl');
  return b;
}

test('two leases of one issue by two writers, with no move out between them and no handover, show on the jarl\'s list as a conflict', () => {
  const b = leasedInTwoClones();
  const rows = json(b.dir, 'next', '--as', 'jarl').rows.filter((r) => r.what === 'conflict');
  assert.equal(rows.length, 1, JSON.stringify(rows));
  assert.equal(rows[0].id, '1');
  assert.match(rows[0].says, /leased twice with no move out between: by coordinator (A|B) \(worker w[ab], jarl\/1-on-[ab]\) at .* and by coordinator (A|B) \(worker w[ab], jarl\/1-on-[ab]\) at /);
  assert.match(rows[0].command, /^jarl\.mjs set 1 in-progress --handover /);
  assert.match(jarl(b.dir, 'next', '--as', 'jarl'), /1 .*leased twice with no move out between/);
});

test('the command a lease-conflict row offers settles the conflict whichever of the two leases is kept', () => {
  for (const [worker, branch] of [['wa', 'jarl/1-on-a'], ['wb', 'jarl/1-on-b']]) {
    const b = leasedInTwoClones();
    const r = run(b.dir, ['set', '1', 'in-progress', 'the lease is settled', '--handover', '--branch', branch, '--worker', worker, '--by', 'jarl']);
    assert.equal(r.status, 0, `${worker}: ${r.stderr}`);
    assert.deepEqual(json(b.dir, 'next', '--as', 'jarl').rows.filter((x) => x.what === 'conflict'), [], worker);
    assert.deepEqual([json(b.dir, 'show', '1').fields.worker, json(b.dir, 'show', '1').fields.branch], [worker, branch]);
  }
});

test('one writer leasing twice, a handover, and a move out between two leases are no conflict', () => {
  for (const b of [leasedInTwoClones({ byB: 'coordinator A' }), leasedInTwoClones({ handover: true })]) {
    assert.deepEqual(json(b.dir, 'next', '--as', 'jarl').rows.filter((r) => r.what === 'conflict'), []);
  }
  const a = committedLoop();
  jarl(a.dir, 'set', '1', 'in-progress', '--branch', 'jarl/1-x', '--worker', 'wa', '--by', 'coordinator A');
  jarl(a.dir, 'set', '1', 'open', 'back to the queue', '--by', 'coordinator A');
  jarl(a.dir, 'set', '1', 'in-progress', '--branch', 'jarl/1-y', '--worker', 'wb', '--by', 'coordinator B');
  assert.deepEqual(json(a.dir, 'next', '--as', 'jarl').rows.filter((r) => r.what === 'conflict'), []);
});

test('under a profile with two statuses that hold the lease, a worker\'s move from the first to the second is no second lease', () => {
  const { dir, g } = gitRepo({ branch: 'main' });
  const file = join(mkdtempSync(join(tmpdir(), 'jarl-copies-p-')), 'house.json');
  writeFileSync(file, JSON.stringify({ 'jarl-profile': 1, name: 'house', statuses: { proposed: [], queued: ['dispatchable'], running: ['lease'], landed: ['lease'], merged: ['settles-dependents', 'terminal', 'closes-record'], dropped: ['terminal', 'needs-reason'] }, initial: 'queued' }));
  jarl(dir, 'init', 'house', '--committed', '--profile', file);
  jarl(dir, 'new', 'one', '--acceptance', '[read] it works', '--tier', 'light');
  jarl(dir, 'set', '1', 'running', '--branch', 'jarl/1-one', '--worker', 'w1', '--by', 'coord');
  jarl(dir, 'set', '1', 'landed', 'pushed', '--by', 'w1');
  assert.deepEqual(json(dir, 'next', '--as', 'jarl').rows.filter((r) => r.what === 'conflict'), []);
});

test('a second writer that sets the lease the issue already has is no conflict', () => {
  const a = committedLoop();
  jarl(a.dir, 'set', '1', 'in-progress', '--branch', 'jarl/1-x', '--worker', 'w1', '--by', 'coordinator A');
  jarl(a.dir, 'set', '1', 'in-progress', '--branch', 'jarl/1-x', '--worker', 'w1', '--by', 'coordinator B');
  assert.deepEqual(json(a.dir, 'next', '--as', 'jarl').rows.filter((r) => r.what === 'conflict'), []);
});

// A text that quotes a whole git conflict, in a fence and out of one, and the same text as the tool writes it: each marker
// line escaped with a backslash, every other line as given.
const QUOTED = 'git left this in the file:\n```\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> main\n```\nand the same with no fence:\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> main\nand a line that quotes <<<<<<< HEAD inline';
const ESCAPED = 'git left this in the file:\n```\n\\<<<<<<< HEAD\nours\n\\=======\ntheirs\n\\>>>>>>> main\n```\nand the same with no fence:\n\\<<<<<<< HEAD\nours\n\\=======\ntheirs\n\\>>>>>>> main\nand a line that quotes <<<<<<< HEAD inline';
const issueText = (dir, file) => readFileSync(join(dir, '.jarl', 'issues', file), 'utf8');
const MARKER_LINE = /^(?:<{7}|={7}|>{7})/m;

test('text that quotes a git conflict, written through new, body, a note and a reason, has each marker line escaped, reads back as written, and verify reads it as text', () => {
  const a = committedLoop();
  assert.equal(json(a.dir, 'new', 'quotes a conflict', '--tier', 'light', '--what', QUOTED, '--why', 'quoted').id, '2');
  jarl(a.dir, 'field', '1', 'Why', QUOTED);
  jarl(a.dir, 'field', '1', 'What', `the opening line\n${QUOTED}`, '--add');
  jarl(a.dir, 'evidence', '1', QUOTED);
  jarl(a.dir, 'set', '2', 'dropped', QUOTED);
  for (const file of issueFiles(a.dir)) assert.doesNotMatch(issueText(a.dir, file), MARKER_LINE, `${file} holds no marker line`);
  const one = json(a.dir, 'show', '1');
  const two = json(a.dir, 'show', '2');
  assert.equal(two.sections.what.trim(), ESCAPED);
  assert.equal(one.sections.why.trim(), ESCAPED);
  assert.ok(one.sections.what.trim().endsWith(`the opening line\n${ESCAPED}`), one.sections.what);
  assert.ok(one.sections.evidence.includes(ESCAPED), one.sections.evidence);
  assert.ok(two.sections.evidence.includes(`Dropped: ${ESCAPED}`), two.sections.evidence);
  // The escaped text written back as it reads is written as it is: an escape is never escaped again.
  const before = issueText(a.dir, '1-filed-before-the-split.md');
  jarl(a.dir, 'field', '1', 'Why', one.sections.why);
  assert.equal(issueText(a.dir, '1-filed-before-the-split.md'), before);
  const r = run(a.dir, ['verify']);
  assert.equal(r.status, 0, r.stdout);
});

test('verify refuses an issue file that holds git conflict markers', () => {
  const a = committedLoop();
  const b = cloneOf(a.dir);
  jarl(a.dir, 'field', '1', 'What', 'the text on A');
  a.g('add', '-A'); a.g('commit', '-qm', 'a edits 1');
  jarl(b.dir, 'field', '1', 'What', 'the text on B');
  b.g('add', '-A'); b.g('commit', '-qm', 'b edits 1');
  assert.throws(() => b.g('pull', '-q', '--no-rebase', '--no-edit', 'origin', 'main'), 'git cannot join the two texts');
  assert.match(readFileSync(join(b.dir, '.jarl', 'issues', '1-filed-before-the-split.md'), 'utf8'), /^<<<<<<< /m);
  const r = run(b.dir, ['verify']);
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stdout, /issues\/1-filed-before-the-split\.md line \d+: "<<<<<<< [^"]*" — a git conflict marker/);
  const plain = committedLoop();
  jarl(plain.dir, 'field', '1', 'What', 'A heading\n=======\nunder it');
  assert.equal(run(plain.dir, ['verify']).status, 0, 'a line of equals signs alone is text');
});

test('verify refuses a real git conflict whose side holds a fenced block', () => {
  const a = committedLoop();
  const b = cloneOf(a.dir);
  jarl(a.dir, 'field', '1', 'What', 'run it as:\n```\nnpm test\n```');
  a.g('add', '-A'); a.g('commit', '-qm', 'a edits 1 with a fence');
  jarl(b.dir, 'field', '1', 'What', 'the text on B');
  b.g('add', '-A'); b.g('commit', '-qm', 'b edits 1');
  assert.throws(() => b.g('pull', '-q', '--no-rebase', '--no-edit', 'origin', 'main'), 'git cannot join the two texts');
  const text = readFileSync(join(b.dir, '.jarl', 'issues', '1-filed-before-the-split.md'), 'utf8');
  assert.match(text, /^<<<<<<< [\s\S]*^```$[\s\S]*^>>>>>>> /m, 'one side of the conflict holds the fence');
  const r = run(b.dir, ['verify']);
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stdout, /"<<<<<<< [^"]*" — a git conflict marker/);
});

test('verify refuses a real git conflict inside a fenced block both sides share', () => {
  const a = committedLoop();
  jarl(a.dir, 'field', '1', 'What', 'run it as:\n```\nnpm test\n```');
  a.g('add', '-A'); a.g('commit', '-qm', 'a fence in 1');
  const b = cloneOf(a.dir);
  jarl(a.dir, 'field', '1', 'What', 'run it as:\n```\nnpm test -- --on-a\n```');
  a.g('add', '-A'); a.g('commit', '-qm', 'a edits the fence');
  jarl(b.dir, 'field', '1', 'What', 'run it as:\n```\nnpm run on-b\n```');
  b.g('add', '-A'); b.g('commit', '-qm', 'b edits the fence');
  assert.throws(() => b.g('pull', '-q', '--no-rebase', '--no-edit', 'origin', 'main'), 'git cannot join the two lines');
  const text = issueText(b.dir, '1-filed-before-the-split.md');
  assert.match(text, /^```\n<<<<<<< [^\n]*\n[\s\S]*?^>>>>>>> [^\n]*\n```$/m, 'the markers sit inside the fence both sides hold');
  const r = run(b.dir, ['verify']);
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stdout, /issues\/1-filed-before-the-split\.md line \d+: "<<<<<<< [^"]*" — a git conflict marker/);
});

test('a lone opening marker is no conflict, and a conflict after it is still refused', () => {
  const a = committedLoop();
  const file = join(a.dir, '.jarl', 'issues', '1-filed-before-the-split.md');
  const lone = readFileSync(file, 'utf8').replace('## What\n', '## What\n<<<<<<< HEAD\nthe rest of the paragraph\n```\na fence opened after it\n');
  writeFileSync(file, lone);
  const clean = run(a.dir, ['verify']);
  assert.equal(clean.status, 0, clean.stdout);
  const both = lone.replace('## Why\n', '## Why\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> main\n');
  writeFileSync(file, both);
  const at = both.split('\n').lastIndexOf('<<<<<<< HEAD') + 1;
  const r = run(a.dir, ['verify']);
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stdout, new RegExp(`issues/1-filed-before-the-split\\.md line ${at}: "<<<<<<< HEAD" — a git conflict marker`));
  assert.doesNotMatch(r.stdout, new RegExp(`line ${both.split('\n').indexOf('<<<<<<< HEAD') + 1}:`), 'the lone marker is not named');
});

// A real pull whose conflict holds, on one side, a marker line the tool did not write (a hand edit, or text written raw):
// `edit` turns the text the tool wrote on that side into the text with the stray line.
for (const [shape, side, edit] of [
  ['an opening marker after the separator', 'a', (t) => t.replace('the text on A\n', 'the text on A\n<<<<<<< lone line\n')],
  ['a closing marker before the separator', 'b', (t) => t.replace('the text on B\n', 'the text on B\n>>>>>>> lone line\n')],
]) {
  test(`verify refuses a real git conflict whose side holds ${shape}`, () => {
    const a = committedLoop();
    const b = cloneOf(a.dir);
    for (const [at, name] of [[a, 'A'], [b, 'B']]) {
      jarl(at.dir, 'field', '1', 'What', `the text on ${name}`);
      if (side === name.toLowerCase()) {
        const file = join(at.dir, '.jarl', 'issues', '1-filed-before-the-split.md');
        writeFileSync(file, edit(readFileSync(file, 'utf8')));
      }
      at.g('add', '-A'); at.g('commit', '-qm', `${name} edits 1`);
    }
    assert.throws(() => b.g('pull', '-q', '--no-rebase', '--no-edit', 'origin', 'main'), 'git cannot join the two texts');
    const text = issueText(b.dir, '1-filed-before-the-split.md');
    const order = side === 'a' ? /^<<<<<<< HEAD\nthe text on B\n=======\nthe text on A\n<<<<<<< lone line\n>>>>>>> \S+\n/m : /^<<<<<<< HEAD\nthe text on B\n>>>>>>> lone line\n=======\nthe text on A\n>>>>>>> \S+\n/m;
    assert.match(text, order, 'git left the stray line inside the conflict');
    const r = run(b.dir, ['verify']);
    assert.equal(r.status, 2, r.stdout);
    assert.match(r.stdout, /issues\/1-filed-before-the-split\.md line \d+: "<<<<<<< HEAD" — a git conflict marker/);
  });
}

test('markers in another order than opening, separator, closing are no conflict', () => {
  const a = committedLoop();
  const file = join(a.dir, '.jarl', 'issues', '1-filed-before-the-split.md');
  const base = readFileSync(file, 'utf8');
  for (const lines of ['>>>>>>> main\n=======\n<<<<<<< HEAD\n', '=======\n', '>>>>>>> main\n<<<<<<< HEAD\n=======\n', '<<<<<<< HEAD\n>>>>>>> main\n']) {
    writeFileSync(file, base.replace('## What\n', `## What\n${lines}`));
    const r = run(a.dir, ['verify']);
    assert.equal(r.status, 0, `${JSON.stringify(lines)}: ${r.stdout}`);
  }
});

test('the refusal says what to do with markers that only quote a conflict', () => {
  const a = committedLoop();
  const file = join(a.dir, '.jarl', 'issues', '1-filed-before-the-split.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace('## What\n', '## What\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> main\n'));
  const r = run(a.dir, ['verify']);
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stdout, /if the lines only quote a conflict, write the text again with jarl\.mjs field 1 "<section-or-field>" "<text>" --by "<who>", which escapes each marker line/);
});

test('with CRLF line endings, a real conflict is refused, and text with CRLF breaks that quotes one is written escaped, a note into an Evidence section with no parts included', () => {
  const a = committedLoop();
  const b = cloneOf(a.dir);
  jarl(a.dir, 'field', '1', 'What', 'the text on A');
  a.g('add', '-A'); a.g('commit', '-qm', 'a edits 1');
  jarl(b.dir, 'field', '1', 'What', 'the text on B');
  b.g('add', '-A'); b.g('commit', '-qm', 'b edits 1');
  assert.throws(() => b.g('pull', '-q', '--no-rebase', '--no-edit', 'origin', 'main'), 'git cannot join the two texts');
  const conflicted = join(b.dir, '.jarl', 'issues', '1-filed-before-the-split.md');
  writeFileSync(conflicted, readFileSync(conflicted, 'utf8').replace(/\n/g, '\r\n'));
  const refused = run(b.dir, ['verify']);
  assert.equal(refused.status, 2, refused.stdout);
  assert.match(refused.stdout, /"<<<<<<< [^"]*" — a git conflict marker/);
  const c = committedLoop();
  const file = join(c.dir, '.jarl', 'issues', '1-filed-before-the-split.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace(/## Evidence\s*$/, '## Evidence\nan old line written by hand\n'));
  const crlf = QUOTED.replace(/\n/g, '\r\n');
  jarl(c.dir, 'field', '1', 'What', crlf);
  jarl(c.dir, 'evidence', '1', crlf);
  const text = readFileSync(file, 'utf8');
  assert.match(text, /## Evidence\nan old line written by hand\n/, 'the section has no parts');
  assert.doesNotMatch(text.replace(/\r\n?/g, '\n'), MARKER_LINE);
  assert.ok(json(c.dir, 'show', '1').sections.evidence.includes(ESCAPED));
  writeFileSync(file, text.replace(/\r?\n/g, '\r\n'));
  const r = run(c.dir, ['verify']);
  assert.equal(r.status, 0, r.stdout);
});
