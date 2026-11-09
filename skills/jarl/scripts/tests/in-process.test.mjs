// The calls the tests make inside their own process read as a process would: for one list of calls (every way a call
// ends, words holding a backslash, words that are empty), a spawned node and an in-process run of the same call on a copy
// of one loop print the same, exit alike and leave the same record; and the same call pasted into each shell, read by the
// shell and run in-process, matches that shell starting a real node. What crosses the boundary of a process is compared
// here, on every OS: the words as the entry reads them, the streams and the exit status.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { gitRepo, jarl, SCRIPT, SPAWN_TIMEOUT, withNames } from './helpers.mjs';
import { runInProcess } from './in-process.mjs';
import { runPrinted, SHELLS } from './walk.mjs';
import { bashBin } from './portable.mjs';

const { dir: SCENE } = gitRepo({ prefix: 'jarl-in-process-' });
jarl(SCENE, 'init', 'a scene for both ways of running a call');
jarl(SCENE, 'new', 'one', '--tier', 'light', '--files', 'a.mjs', '--acceptance', '[read] it works');
jarl(SCENE, 'new', 'two', '--tier', 'standard', '--acceptance', '[test] it works');
jarl(SCENE, 'new', 'three', '--tier', 'strong', '--acceptance', '[read] it reads', '--after', '1');
jarl(SCENE, 'set', '1', 'in-progress', 'go', '--worker', 'w1', '--branch', 'jarl/1-one');
jarl(SCENE, 'evidence', '2', '--line', '1', '--ran', 'npm test', '--saw', 'pass 3');
jarl(SCENE, 'review', '1', 'approve', '--by', 'rev-a', 'read the diff, nothing found');
jarl(SCENE, 'ask', 'which way?');
jarl(SCENE, 'decide', 'taken', 'a ruling', '--by', 'jarl');

const copies = [];
function copyScene() {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-in-process-copy-'));
  cpSync(SCENE, dir, { recursive: true });
  copies.push(dir);
  return dir;
}
// A text with what changes from one run to the next masked: the place of the copy, a time, a key.
function masked(text, dir) {
  return String(text)
    .split(JSON.stringify(realpathSync(dir)).slice(1, -1)).join('<COPY>').split(JSON.stringify(dir).slice(1, -1)).join('<COPY>')   // in JSON on Windows, each backslash doubled
    .split(realpathSync(dir)).join('<COPY>').split(dir).join('<COPY>').split(basename(dir)).join('<NAME>')
    .replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?Z?)?/g, 'TIME').replace(/\b\d{8}T\d{4}-[a-z0-9]+\b/g, 'KEY').replace(/"ageMs": \d+/g, '"ageMs": 0');
}
// Every file of the record (the lock aside) as the two runs left it, masked.
function record(dir) {
  const out = {};
  const walk = (d) => { for (const f of readdirSync(d)) { if (f === '.lock' || f === '.git') continue; const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else out[relative(dir, p)] = masked(readFileSync(p, 'utf8'), dir); } };
  walk(join(dir, '.jarl'));
  return out;
}

// What a copy of the scene is made into before a call that needs it.
const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: SPAWN_TIMEOUT });
const firstIssue = (dir) => join(dir, '.jarl', 'issues', readdirSync(join(dir, '.jarl', 'issues')).sort()[0]);
const conflicted = (dir) => writeFileSync(firstIssue(dir), `${readFileSync(firstIssue(dir), 'utf8')}<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> main\n`);
function outOfScope(dir) {
  git(dir, 'checkout', '-q', '-b', 'jarl/1-one');
  writeFileSync(join(dir, 'outside.txt'), 'not in the Files of the issue\n');
  git(dir, 'add', 'outside.txt');
  git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'outside');
  git(dir, 'checkout', '-q', 'feature');
}
const decisions = (ours, theirs) => (dir) => {
  const entry = (body) => `# Decisions\n\n## 2026-01-01 · the-way\n${body}\n`;
  writeFileSync(join(dir, 'base.md'), '# Decisions\n');
  writeFileSync(join(dir, 'ours.md'), entry(ours));
  writeFileSync(join(dir, 'theirs.md'), entry(theirs));
};

const CALLS = [
  // How a call ends: 0, 1 and 2, by a view, by a refusal, by the entry itself and by the merge driver's own status.
  { args: [], status: 1 }, { args: ['--version'], status: 0 }, { args: ['--help'], status: 0 }, { args: ['set', '--help'], status: 0 }, { args: ['no-such-command', '1'], status: 1 },
  { args: ['verify'], status: 0 }, { args: ['verify'], prepare: conflicted, status: 2 }, { args: ['scope', '1', '--branch', 'jarl/1-one'], prepare: outOfScope, status: 2 },
  { args: ['merge-driver', 'flags'], status: 0 }, { args: ['merge-driver', 'nonsense'], status: 1 }, { args: ['merge-driver', 'decisions', 'base.md', 'ours.md', 'theirs.md'], prepare: decisions('same', 'same'), status: 0 },
  { args: ['merge-driver', 'decisions', 'base.md', 'ours.md', 'theirs.md'], prepare: decisions('one way', 'another way'), status: 1 },
  // Views and writes.
  ['status'], ['status', '--json'], ['list', '--all'], ['show', '1'], ['show', '99'], ['next', '--as', 'jarl', '--all'], ['next', '--as', 'owner', '--all'], ['resume'], ['report'], ['decisions'], ['changelog', '1'],
  ['brief', '1'], ['brief', '1', '--role', 'reviewer'], ['brief', '--role', 'merger'], ['scope', '1', '--branch', 'jarl/1-one'],
  ['set', '1', 'Deferred', 'later'], ['set', '2', 'in-progress', 'go', '--worker', 'w2', '--branch', 'jarl/2-two'], ['field', '2', 'Priority', '1'], ['field', '2', 'Priority', 'seven'], ['field', '2', 'Bogus', 'x'],
  ['evidence', '2', 'a note on two'], ['review', '2', 'changes', '--by', 'rev-b', 'Important: a test is missing'], ['new', 'another', '--tier', 'light', '--acceptance', '[read] it works', '--json'], ['new', 'no tier given'],
  ['init', 'a second goal'], ['log', 'a line of the log'], ['ask', 'a question for the owner?', '--kind', 'stuck'], ['answer', 'a-1', 'this way', '--by', 'owner'], ['answer', 'a-9', 'that way', '--by', 'owner'],
  ['set', '1', 'done', 'finished'], ['retract', '1', 'review', 'taken back', '--by', 'rev-a'], ['close'], ['round', '2', 'it failed'], ['round', '99', 'no such issue'], ['show', '1', '--bogus'],
  // Words with a backslash: as a text, as a title, as a value of a flag, ending one, doubled, and as a --root.
  ['log', 'C:\\Users\\x has a backslash'], ['log', 'a word that ends with one\\'], ['log', 'doubled \\\\ and \\" a quote'], ['evidence', '2', 'node C:\\x\\y.mjs ran'], ['field', '2', 'What', 'D:\\tools\\a.mjs and\\nno line break'],
  ['new', 'a title in E:\\work', '--tier', 'light', '--what', 'F:\\src', '--acceptance', '[read] it works', '--json'], ['show', '1\\2'], ['no\\such', 'x'], ['--root', 'C:\\no\\such\\place', 'status'], ['status', '--root=C:\\no\\such\\place'],
  // Empty words: as the command, as an argument, as a value of a flag, as a --root.
  ['', 'x'], ['show', ''], ['log', ''], ['new', ''], ['field', '2', 'What', ''], ['evidence', '2', ''], ['set', '1', '', 'why'], ['new', 'a title', '--tier', '', '--acceptance', '[read] it works'], ['--root', '', 'status'], ['status', '--root='],
  // Words a process hands on as they are: a bare --, dashes after it, a line break, quotes, other scripts.
  ['log', '--', '--dashes in a text'], ['log', 'two\nlines'], ['log', 'it\'s "quoted" and $HOME and %PATH%'], ['log', 'zażółć gęślą jaźń · ⏎'],
].map((c) => (Array.isArray(c) ? { args: c } : c));

const sq = (w) => `'${String(w).replace(/'/g, `'\\''`)}'`;
const unix = (p) => p.replaceAll('\\', '/');
const BIN = process.platform === 'win32' ? null : (() => { const d = mkdtempSync(join(tmpdir(), 'jarl-in-process-bin-')); writeFileSync(join(d, 'jarl.mjs'), `#!/bin/sh\nexec ${sq(process.execPath)} ${sq(SCRIPT)} "$@"\n`, { mode: 0o755 }); return d; })();
// A shell running the line for real, with jarl.mjs a real node: on the PATH where a shebang runs, a function of Git for
// Windows' bash where none does (that bash left to hand the words over as they are).
function shellToNode(sh, line, cwd) {
  if (sh === 'bash') return spawnSync(bashBin(), ['-c', `jarl.mjs() { "$JARL_NODE" "$JARL_SCRIPT" "$@"; }\n${line}`], { cwd, encoding: 'utf8', timeout: SPAWN_TIMEOUT, env: { ...process.env, JARL_NODE: unix(process.execPath), JARL_SCRIPT: unix(SCRIPT), MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' } });
  return spawnSync(sh, [...(sh.endsWith('zsh') ? ['-f'] : []), '-c', line], { cwd, encoding: 'utf8', timeout: SPAWN_TIMEOUT, env: { ...process.env, PATH: `${BIN}:${process.env.PATH}` } });
}
function assertAlike(a, dirA, b, dirB, what) {
  assert.equal(a.status, b.status, `${what}: status: ${a.stderr || a.stdout}\n---\n${b.stderr || b.stdout}`);
  assert.equal(masked(a.stdout, dirA), masked(b.stdout, dirB), `${what}: stdout`);
  assert.equal(masked(a.stderr, dirA), masked(b.stderr, dirB), `${what}: stderr`);
  assert.deepEqual(record(dirA), record(dirB), `${what}: the record left`);
}
function prepared(prepare) { const dir = copyScene(); prepare?.(dir); return dir; }

for (const { args, prepare, status } of CALLS) {
  test(`in-process and in a process alike: ${args.map((w) => JSON.stringify(w)).join(' ') || '(no words)'}${prepare ? ` (${prepare.name || 'prepared'})` : ''}`, () => {
    const words = withNames(args);
    const [inProcess, process_] = [prepared(prepare), prepared(prepare)];
    const a = runInProcess(words, { cwd: inProcess });
    const b = spawnSync(process.execPath, [SCRIPT, ...words], { cwd: process_, encoding: 'utf8', timeout: SPAWN_TIMEOUT });
    assertAlike(a, inProcess, b, process_, 'a spawned node');
    if (status !== undefined) assert.equal(b.status, status, 'the status this call is in the list for');
    const line = `jarl.mjs ${words.map(sq).join(' ')}`.trimEnd();
    for (const sh of SHELLS) {
      const [pasted, real] = [prepared(prepare), prepared(prepare)];
      assertAlike(runPrinted(pasted, line, sh), pasted, shellToNode(sh, line, real), real, `pasted into ${sh}`);
    }
  });
}

test('lines a shell reads for itself, more than one command and a form with placeholders, read alike in-process and through a real node', () => {
  const lines = [
    'jarl.mjs set "<ids>" "<status>" "<why>" --by "<who>"',
    'jarl.mjs field 3 What \'a text with "quotes" and spaces\' --by jarl',
    'jarl.mjs new "a title" --tier light --acceptance "[read] it works" --by jarl; jarl.mjs show 1 --bogus',
    'jarl.mjs field 1 Files "<paths>" --by jarl --root .',
  ];
  for (const sh of SHELLS) {
    for (const line of lines) {
      const [dirA, dirB] = [copyScene(), copyScene()];
      assertAlike(runPrinted(dirA, line, sh), dirA, shellToNode(sh, line, dirB), dirB, `${sh} ${line}`);
    }
  }
});

test('a call that never ends fails at its time limit instead of hanging, with the console given back and the next call running', () => {
  const log = console.log;
  assert.throws(() => runInProcess(['status'], { timeout: 200, main: () => { for (;;) { /* a command that never ends */ } } }), /jarl status did not end within 200 ms/);
  assert.equal(console.log, log, 'the console is the test\'s again');
  assert.equal(runInProcess(['--version']).status, 0, 'the next call runs');
});

test('a call held up by a child process that never ends fails at its time limit too', () => {
  assert.throws(() => runInProcess(['status'], { timeout: 300, main: () => execFileSync(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }) }), /did not end within 300 ms/);
});
