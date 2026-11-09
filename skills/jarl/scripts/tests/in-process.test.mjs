// The calls the tests make inside their own process read as a process would: for a range of calls, a process and an
// in-process run of the same call on a copy of one loop print the same, exit alike and leave the same record. A line
// pasted into a shell, read by the shell and run in-process, matches the same line run by a real process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { gitRepo, jarl, SCRIPT, SPAWN_TIMEOUT, withNames } from './helpers.mjs';
import { runInProcess } from './in-process.mjs';
import { runPrinted, SHELLS } from './walk.mjs';

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

const CALLS = [
  [], ['--version'], ['--help'], ['set', '--help'], ['no-such-command', '1'],
  ['status'], ['status', '--json'], ['list', '--all'], ['show', '1'], ['show', '99'], ['next', '--as', 'jarl', '--all'], ['next', '--as', 'owner', '--all'], ['resume'], ['report'], ['verify'], ['decisions'], ['changelog', '1'],
  ['brief', '1'], ['brief', '1', '--role', 'reviewer'], ['brief', '--role', 'merger'], ['scope', '1', '--branch', 'jarl/1-one'], ['merge-driver', 'flags'], ['merge-driver', 'nonsense'],
  ['set', '1', 'Deferred', 'later'], ['set', '2', 'in-progress', 'go', '--worker', 'w2', '--branch', 'jarl/2-two'], ['field', '2', 'Priority', '1'], ['field', '2', 'Priority', 'seven'], ['field', '2', 'Bogus', 'x'],
  ['evidence', '2', 'a note on two'], ['review', '2', 'changes', '--by', 'rev-b', 'Important: a test is missing'], ['new', 'another', '--tier', 'light', '--acceptance', '[read] it works', '--json'], ['new', 'no tier given'],
  ['init', 'a second goal'], ['log', 'a line of the log'], ['ask', 'a question for the owner?', '--kind', 'stuck'], ['answer', 'a-1', 'this way', '--by', 'owner'], ['answer', 'a-9', 'that way', '--by', 'owner'],
  ['set', '1', 'done', 'finished'], ['retract', '1', 'review', 'taken back', '--by', 'rev-a'], ['close'], ['round', '2', 'it failed'], ['round', '99', 'no such issue'], ['show', '1', '--bogus'],
];

for (const args of CALLS) {
  test(`in-process and in a process alike: ${args.join(' ') || '(no words)'}`, () => {
    const words = withNames(args);
    const [inProcess, process_] = [copyScene(), copyScene()];
    const a = runInProcess(words, { cwd: inProcess });
    const b = spawnSync(process.execPath, [SCRIPT, ...words], { cwd: process_, encoding: 'utf8', timeout: SPAWN_TIMEOUT });
    assert.equal(a.status, b.status, `status: ${a.stderr || a.stdout}\n---\n${b.stderr || b.stdout}`);
    assert.equal(masked(a.stdout, inProcess), masked(b.stdout, process_), 'stdout');
    assert.equal(masked(a.stderr, inProcess), masked(b.stderr, process_), 'stderr');
    assert.deepEqual(record(inProcess), record(process_), 'the record left');
  });
}

test('a line pasted into a shell reads as the same line run by a real process: the shell splits it, and refused or written the call answers alike', { skip: process.platform === 'win32' && 'a stand-in on the PATH needs a shebang, and Windows runs none; the shell is Git for Windows\' bash there, and the same tests run through it' }, () => {
  const bin = mkdtempSync(join(tmpdir(), 'jarl-in-process-bin-'));
  writeFileSync(join(bin, 'jarl.mjs'), `#!/bin/sh\nexec '${process.execPath}' '${SCRIPT}' "$@"\n`, { mode: 0o755 });
  const lines = [
    'jarl.mjs status',
    'jarl.mjs set "<ids>" "<status>" "<why>" --by "<who>"',
    'jarl.mjs field 3 What \'a text with "quotes" and spaces\' --by jarl',
    'jarl.mjs new "a title" --tier light --acceptance "[read] it works" --by jarl; jarl.mjs show 1 --bogus',
    'jarl.mjs field 1 Files "<paths>" --by jarl --root .',
  ];
  for (const sh of SHELLS) {
    for (const line of lines) {
      const [dirA, dirB] = [copyScene(), copyScene()];
      const printed = runPrinted(dirA, line, sh);
      const real = spawnSync(sh, [...(sh.endsWith('zsh') ? ['-f'] : []), '-c', line], { cwd: dirB, encoding: 'utf8', timeout: SPAWN_TIMEOUT, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
      assert.equal(printed.status, real.status, `${sh} ${line}: ${printed.stderr}\n---\n${real.stderr}`);
      assert.equal(masked(printed.stdout, dirA), masked(real.stdout, dirB), `${sh} ${line}`);
      assert.equal(masked(printed.stderr, dirA), masked(real.stderr, dirB), `${sh} ${line}`);
      assert.deepEqual(record(dirA), record(dirB), `${sh} ${line}`);
    }
  }
});
