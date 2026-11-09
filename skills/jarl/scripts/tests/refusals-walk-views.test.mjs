// The walk of the commands that calls which go through print: in an answer (the reply of new, field and review), in a
// note, and in the rows of a view (next --as, resume, status, report, verify, show, changelog). Each carries the call's
// --root, and pasted into sh and zsh, as printed and filled, writes in no loop but the one the call named, on a checkout
// that holds two loops, one in a subdirectory (tests/walk.mjs, outputProblems).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { PLAIN, ROOTED, ROOT_ARG, SHELLS, copy, run, runPrinted, snapshot, walkOutputs } from './walk.mjs';
import { NO_EXCLUDES } from './portable.mjs';

const L = await import('../jarl-lib.mjs');

// The calls, each with the state of the loop before it: an approve, a row, a merge on the plain loop's issues.
const PRE = [['review', '1', 'approve', '--by', 'rev-fresh', 'read the diff and the tests, all fine'], ['evidence', '2', '--line', '1', '--ran', 'npm test', '--saw', 'all pass']];
const CALLS = [
  ['next', '--as', 'jarl', '--all'], ['next', '--as', 'owner', '--all'], ['next', '--as', 'w2', '--all'], ['resume', '--as', 'jarl'], ['status', '--as', 'owner'],
  ['report'], ['verify'], ['show', '3'], ['show', '1', '--full'], ['changelog', '1'],
  ['new', 'five', '--tier', 'light', '--what', 'relies on issue 1 for its data'], ['field', '3', 'What', 'relies on issue 1 for its data'],
  ['review', '2', 'approve', '--by', 'rev-fresh', 'read the diff and the tests, all fine'],
];
const rooted = (args, root) => [args[0], ...root, ...args.slice(1)];

test('every command a call that goes through prints, in its answer, a note or its view, carries its --root, and pasted as printed and filled writes in no loop but the one it named', () => {
  const cases = [
    ...CALLS.map((args) => ({ args, loop: PLAIN, pre: PRE })),
    ...CALLS.map((args) => ({ args: rooted(args, ['--root', ROOT_ARG]), loop: ROOTED, pre: PRE.map((p) => rooted(p, ['--root', ROOT_ARG])) })),
    ...CALLS.map((args) => ({ args: rooted(args, [`--root=${ROOT_ARG}`]), loop: ROOTED, pre: PRE.map((p) => rooted(p, ['--root', ROOT_ARG])) })),
    // On the checkout that holds two loops, with no --root: the loop at its top is the one named, and releases/r1 is not.
    ...CALLS.slice(0, 6).map((args) => ({ args, loop: ROOTED })),
  ];
  const { found, commands } = walkOutputs(cases);
  assert.ok(commands >= 80, `${commands} commands printed`);
  assert.deepEqual(found, []);
});

test('the note of a text that names an unordered issue, given --root, carries it: pasted filled where the call was made it writes the loop the call named, and the loop of the working directory is untouched', () => {
  const top = copy(ROOTED);
  const r = run(top, ['field', '3', 'What', 'relies on issue 1 for its data', '--root', ROOT_ARG]);
  assert.equal(r.status, 0, r.stderr);
  const note = r.stderr.split('\n').find((l) => l.includes('no After orders it with 3'));
  const command = /: (jarl\.mjs .*)$/.exec(note ?? '')?.[1];
  assert.equal(command, `jarl.mjs field 3 After "<ids-it-waits-on>" --add --by "<who>" --root ${ROOT_ARG}`, note);
  const filled = command.replace('"<ids-it-waits-on>"', '1').replace('"<who>"', 'jarl');
  for (const sh of SHELLS) {
    const dir = copy(ROOTED);
    run(dir, ['field', '3', 'What', 'relies on issue 1 for its data', '--root', ROOT_ARG]);
    const before = snapshot(dir);
    assert.equal(runPrinted(dir, filled, sh).status, 0, sh);
    assert.deepEqual(L.findIssue(join(dir, ROOT_ARG), '3').after, ['1'], `${sh}: the loop named waits on 1`);
    const after = snapshot(dir);
    assert.deepEqual(Object.keys(after).filter((k) => after[k] !== before[k] && !k.split('\\').join('/').startsWith(`${ROOT_ARG}/.jarl/`)), [], `${sh}: nothing outside the loop named`);
  }
});

test('in a worker worktree of a committed loop, the note of a call given --root naming the main checkout carries it: pasted in the worktree it writes the main checkout\'s loop, never the worktree\'s copy', () => {
  const main = join(mkdtempSync(join(tmpdir(), 'jarl-views-wt-')), 'main');
  const wt = `${main}-wt`;
  execFileSync('git', ['init', '-q', '-b', 'main', main], { timeout: 120_000 });
  const g = (...a) => execFileSync('git', a, { cwd: main, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'core.excludesFile', NO_EXCLUDES);
  const at = (cwd, args) => { const r = run(cwd, args); assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`); return r; };
  at(main, ['init', 'a committed goal', '--committed']);
  for (const t of ['one', 'two', 'three']) at(main, ['new', t, '--tier', 'light', '--acceptance', '[read] it works']);
  g('add', '-A'); g('commit', '-qm', 'loop');
  g('worktree', 'add', '-q', '-b', 'w3', wt);
  const copyBefore = readFileSync(join(wt, '.jarl', 'log.md'), 'utf8');
  const r = at(wt, ['field', '3', 'What', 'relies on issue 1 for its data', '--root', main]);
  const command = /: (jarl\.mjs .*)$/.exec(r.stderr.split('\n').find((l) => l.includes('no After orders it with 3')) ?? '')?.[1];
  assert.equal(command, `jarl.mjs field 3 After "<ids-it-waits-on>" --add --by "<who>" --root ${L.shellWord(main)}`);
  assert.equal(runPrinted(wt, command.replace('"<ids-it-waits-on>"', '1').replace('"<who>"', 'jarl')).status, 0, command);
  assert.deepEqual(L.findIssue(main, '3').after, ['1'], 'the main checkout\'s loop waits on 1');
  assert.equal(readFileSync(join(wt, '.jarl', 'log.md'), 'utf8'), copyBefore, 'the worktree\'s copy of the loop is untouched');
  assert.deepEqual(L.findIssue(wt, '3').after, [], 'nor its issue');
});

