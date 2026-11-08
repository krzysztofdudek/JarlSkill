// scope and merged note, without refusing, each added line that starts a conflict marker and each added file over the
// largest file Jarl accepts as an attachment (64 MiB), with its path: a marker or a core dump that landed in a branch is
// seen by whoever measures the branch or records its merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, jarl, run } from './helpers.mjs';

const LIMIT = 64 * 1024 * 1024;
const MARKERS = ['<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> feature'].join('\n');

// A loop in a repository on main with its first issue leased on branch jarl/1-x, which is checked out and has no commit of its own yet.
function leased() {
  const { dir, g } = gitRepo({ prefix: 'jarl-added-', branch: 'main' });
  jarl(dir, 'init', 'goal');
  jarl(dir, 'new', 'one', '--acceptance', '[read] it works', '--files', 'a.txt', '--tier', 'standard', '--kind', 'gap', '--prio', '2');
  g('checkout', '-q', '-b', 'jarl/1-x');
  jarl(dir, 'set', '1', 'in-progress', 'start', '--branch', 'jarl/1-x', '--worker', 'w-one');
  const commit = (message) => { g('add', '-A'); g('-c', 'commit.gpgsign=false', 'commit', '-qm', message); };
  return { root: dir, g, commit };
}

// The measure of the branch, whatever it says of the declared files (a note is no verdict, and this branch adds undeclared files).
const scoped = (root) => JSON.parse(run(root, ['scope', '1', '--branch', 'jarl/1-x', '--base', 'main', '--json']).stdout);

test('scope notes each added line that starts a conflict marker, with its file and line, and never changes ok', () => {
  const { root, commit } = leased();
  writeFileSync(join(root, 'a.txt'), `a\n${MARKERS}\n========= more than seven\n<<<<<<<<eight\nprose with ======= inside\n`);
  commit('work');
  const out = scoped(root);
  assert.equal(out.ok, true);
  assert.deepEqual(out.notes.map((n) => [n.kind, n.file, n.line, n.text]), [
    ['conflict-marker', 'a.txt', 2, '<<<<<<< HEAD'],
    ['conflict-marker', 'a.txt', 4, '======='],
    ['conflict-marker', 'a.txt', 6, '>>>>>>> feature'],
  ]);
  const text = run(root, ['scope', '1', '--branch', 'jarl/1-x', '--base', 'main']).stdout;
  assert.match(text, /^note a\.txt:2 starts a conflict marker · <<<<<<< HEAD$/m);
  assert.match(text, /^note a\.txt:4 starts a conflict marker · =======$/m);
});

test('scope notes an added file over 64 MiB with its path and size, and not a file at the limit', () => {
  const { root, commit } = leased();
  writeFileSync(join(root, 'core.dump'), Buffer.alloc(LIMIT + 1));
  writeFileSync(join(root, 'edge.bin'), Buffer.alloc(LIMIT));
  writeFileSync(join(root, 'small.txt'), 'small\n');
  commit('work');
  const out = scoped(root);
  assert.equal(out.items.find((i) => i.name === 'commits beyond base').ok, true);
  assert.deepEqual(out.notes.map((n) => [n.kind, n.file, n.bytes]), [['large-file', 'core.dump', LIMIT + 1]]);
  assert.match(run(root, ['scope', '1', '--branch', 'jarl/1-x', '--base', 'main']).stdout, /^note core\.dump is an added file of 67108865 bytes, over the 67108864 bytes \(64 MiB\) Jarl accepts as an attachment$/m);
});

test('a file that grew over the limit in a later commit of the branch is noted once, as the branch adds it', () => {
  const { root, commit } = leased();
  writeFileSync(join(root, 'core.dump'), 'small\n');
  commit('first');
  writeFileSync(join(root, 'core.dump'), Buffer.alloc(LIMIT + 5));
  commit('second');
  const out = scoped(root);
  assert.deepEqual(out.notes.map((n) => [n.kind, n.file, n.bytes]), [['large-file', 'core.dump', LIMIT + 5]]);
});

test('merged notes a conflict marker and an oversized file that the recorded merge brought in, and is still recorded', () => {
  const { root, g, commit } = leased();
  writeFileSync(join(root, 'a.txt'), `a\n${MARKERS}\n`);
  writeFileSync(join(root, 'core.dump'), Buffer.alloc(LIMIT + 1));
  commit('work');
  g('checkout', '-q', 'main');
  g('-c', 'commit.gpgsign=false', 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x');
  const sha = g('rev-parse', 'HEAD').trim();
  const r = run(root, ['merged', '1', '--sha', sha, '--keep']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^note: a\.txt:2 starts a conflict marker · <<<<<<< HEAD \(brought in by the merge\)$/m);
  assert.match(r.stderr, /^note: a\.txt:4 starts a conflict marker · =======/m);
  assert.match(r.stderr, /^note: core\.dump is an added file of 67108865 bytes, over the 67108864 bytes \(64 MiB\) Jarl accepts as an attachment \(brought in by the merge\)$/m);
  assert.match(jarl(root, 'show', '1'), new RegExp(`Merged:\\*\\* ${sha}`));
});

// git writes a path that holds a space with a tab after it, and one that holds a letter beyond ASCII in double quotes with
// its bytes as octal escapes: the notes name the file as it is on disk all the same.
test('scope and merged name a file whose path git quotes or ends with a tab, in the marker note and the large-file note', () => {
  const { root, g, commit } = leased();
  writeFileSync(join(root, 'ünï notes.txt'), `a\n${MARKERS}\n`);
  writeFileSync(join(root, 'plain space.txt'), 'a\n=======\n');
  writeFileSync(join(root, 'big ü.dump'), Buffer.alloc(LIMIT + 1));
  commit('work');
  const out = scoped(root);
  assert.deepEqual(out.notes.map((n) => [n.kind, n.file, n.line ?? n.bytes]), [
    ['conflict-marker', 'plain space.txt', 2],
    ['conflict-marker', 'ünï notes.txt', 2],
    ['conflict-marker', 'ünï notes.txt', 4],
    ['conflict-marker', 'ünï notes.txt', 6],
    ['large-file', 'big ü.dump', LIMIT + 1],
  ]);
  g('checkout', '-q', 'main');
  g('-c', 'commit.gpgsign=false', 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x');
  const r = run(root, ['merged', '1', '--sha', g('rev-parse', 'HEAD').trim(), '--keep']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^note: ünï notes\.txt:2 starts a conflict marker · <<<<<<< HEAD \(brought in by the merge\)$/m);
  assert.match(r.stderr, /^note: plain space\.txt:2 starts a conflict marker · ======= \(brought in by the merge\)$/m);
  assert.match(r.stderr, /^note: big ü\.dump is an added file of 67108865 bytes/m);
  assert.doesNotMatch(r.stderr, /null/);
});

test('a path git quotes for a double quote, a backslash or a tab in it is named unquoted in the marker note', { skip: process.platform === 'win32' && 'a file name cannot hold a double quote, a backslash or a tab on Windows' }, () => {
  const { root, commit } = leased();
  const name = 'odd\t"name"\\x.txt';
  writeFileSync(join(root, name), `a\n${MARKERS}\n`);
  commit('work');
  assert.deepEqual(scoped(root).notes.map((n) => [n.kind, n.file, n.line]), [
    ['conflict-marker', name, 2], ['conflict-marker', name, 4], ['conflict-marker', name, 6],
  ]);
});

test('the marker note names its file whatever prefixes the repository\'s git settings give a diff', () => {
  for (const settings of [[['diff.noprefix', 'true']], [['diff.srcPrefix', 'ours/'], ['diff.dstPrefix', 'theirs/']], [['diff.mnemonicPrefix', 'true']], [['diff.noprefix', 'true'], ['diff.dstPrefix', 'theirs/']]]) {
    const { root, g, commit } = leased();
    for (const [key, value] of settings) g('config', key, value);
    writeFileSync(join(root, 'a.txt'), `a\n${MARKERS}\n`);
    commit('work');
    const said = settings.map((s) => s.join('=')).join(' ');
    assert.deepEqual(scoped(root).notes.map((n) => [n.kind, n.file, n.line]), [['conflict-marker', 'a.txt', 2], ['conflict-marker', 'a.txt', 4], ['conflict-marker', 'a.txt', 6]], said);
    assert.match(run(root, ['scope', '1', '--branch', 'jarl/1-x', '--base', 'main']).stdout, /^note a\.txt:2 starts a conflict marker · <<<<<<< HEAD$/m, said);
  }
});

test('merged says nothing about a merge that brought in no marker and no large file', () => {
  const { root, g, commit } = leased();
  writeFileSync(join(root, 'a.txt'), 'a\nplain\n');
  commit('work');
  g('checkout', '-q', 'main');
  g('-c', 'commit.gpgsign=false', 'merge', '-q', '--no-ff', '-m', 'merge 1', 'jarl/1-x');
  const r = run(root, ['merged', '1', '--sha', g('rev-parse', 'HEAD').trim(), '--keep']);
  assert.doesNotMatch(r.stderr, /conflict marker|added file of/);
});
