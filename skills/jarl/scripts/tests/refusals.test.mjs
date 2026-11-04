// Every refusal of a writing command ends with a ready command on its last line: a call to the same command, fixed
// (or the command that replaces a form the surface does not have), which, run by a POSIX shell, is not refused for the
// same reason. The wrong calls are generated from the command table — every writing command, each required argument left
// out, each value of a closed set wrong, an unknown flag, a removed flag, an empty text, a text that starts with --, an id
// the loop does not hold — and joined by the wrong calls of two reviews and of the earlier walk. The sources are read
// too: every refusal is built by refuse or need, with its ready part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { jarl, SCRIPT } from './helpers.mjs';
import { commandWords } from '../lib/base.mjs';

const J = await import('../jarl.mjs');
const { COMMAND_ARGS, MUTATING, REPLACED_COMMANDS, REMOVED_FLAGS, REMOVED_FORMS } = J;
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

// The loop every wrong call starts from: three issues, the second leased, a row on the first, three questions (one with
// options, one to ratify), a ruling, and a number two issue files carry, as two branches that each filed an issue leave
// it when they are merged (the file of one, and its filing line, copied into the other).
function pristine() {
  const root = mkdtempSync(join(tmpdir(), 'jarl-refusals-'));
  mkdirSync(join(root, '.git'));
  jarl(root, 'init', 'goal');
  for (const t of ['one', 'two', 'three']) jarl(root, 'new', t, '--tier', 'light', '--acceptance', 'it works');
  jarl(root, 'set', '2', 'in-progress', 'start', '--worker', 'w2', '--branch', 'jarl/2-two');
  jarl(root, 'ask', 'which way?');
  jarl(root, 'ask', 'pick one', '--issue', '3', '--option', 'A: does a', '--option', 'B: does b');
  jarl(root, 'ask', 'ratify this', '--kind', 'ratify');
  jarl(root, 'decide', 'taken', 'a ruling', '--by', 'jarl');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'ok');
  const other = mkdtempSync(join(tmpdir(), 'jarl-refusals-branch-'));
  cpSync(root, other, { recursive: true });
  const base = logOf(root);
  jarl(root, 'new', 'four', '--tier', 'light', '--acceptance', 'it works');
  jarl(other, 'new', 'four elsewhere', '--tier', 'light', '--acceptance', 'it works');
  const file = readdirSync(join(other, '.jarl', 'issues')).find((f) => f.startsWith('4-'));
  cpSync(join(other, '.jarl', 'issues', file), join(root, '.jarl', 'issues', file));
  appendFileSync(join(root, '.jarl', 'log.md'), logOf(other).slice(base.length));
  return root;
}
function logOf(dir) { return readFileSync(join(dir, '.jarl', 'log.md'), 'utf8'); }
const PRISTINE = pristine();
const copy = () => { const dir = mkdtempSync(join(tmpdir(), 'jarl-refusals-call-')); cpSync(PRISTINE, dir, { recursive: true }); return dir; };
const run = (dir, args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', timeout: 60000 });
// A printed command run by /bin/sh in the loop: jarl.mjs stands for this script, at the start of each command of a chain.
function runPrinted(dir, line) {
  const cmd = line.replace(/(^|&& )jarl\.mjs /g, '$1"$JARL_NODE" "$JARL_SCRIPT" ');
  return spawnSync('/bin/sh', ['-c', cmd], { cwd: dir, encoding: 'utf8', timeout: 60000, env: { ...process.env, JARL_NODE: process.execPath, JARL_SCRIPT: SCRIPT } });
}

// A call each writing command takes on the pristine loop; the generator breaks it in every way the table names.
const VALID = {
  init: ['g'], new: ['t', '--tier', 'light'], renumber: ['1', '--key', 'k'], import: ['findings.json'], evidence: ['1', 'a note'],
  retract: ['1', '1', '--by', 'jarl', 'the row was wrong'], field: ['1', 'Priority', '1'], base: ['tool', 'main'], set: ['1', 'deferred', 'later'],
  merged: ['1', '--sha', 'abc1234'], review: ['1', 'approve', '--by', 'rev', 'read it all, fine'], round: ['1', 'it failed'], tick: ['1', '1', '--by', 'owner'],
  ask: ['which?'], answer: ['a-1', 'this way', '--by', 'owner'], log: ['a note'], decide: ['s1', 'a ruling', '--by', 'jarl'], goal: ['--set', 'Check: npm test'],
  archive: ['old'], mode: ['permanent'], close: [],
};
// The values of a closed set each command takes, by where they sit: a flag, or the n-th argument.
const ENUMS = {
  new: [['--tier', 'huge'], ['--kind', 'task'], ['--prio', '7']], set: [[1, 'bogus']], review: [[1, 'maybe']], merged: [['--ci', 'blue']],
  ask: [['--kind', 'bogus']], field: [[1, 'Bogus'], [2, '7']], mode: [[0, 'bogus']],
};
const TEXT_AT = { evidence: 1, retract: 2, set: 2, review: 2, round: 1, ask: 0, answer: 1, log: 0, decide: 1 };
const IDS_AT = { evidence: 0, retract: 0, field: 0, set: 0, merged: 0, review: 0, round: 0, tick: 0 };
function positionalsOf(args) { const out = []; for (let i = 0; i < args.length; i += 1) { if (args[i].startsWith('--')) { i += args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? 1 : 0; continue; } out.push(i); } return out; }
export function generateWrongCalls() {
  const calls = [];
  for (const cmd of [...MUTATING]) {
    const valid = VALID[cmd];
    if (!valid) continue;
    const at = positionalsOf(valid);
    const required = COMMAND_ARGS[cmd].map((a, n) => (!a.endsWith('?') && !a.endsWith('...') ? n : null)).filter((n) => n !== null);
    for (const n of required) if (at[n] !== undefined) calls.push([cmd, ...valid.slice(0, at[n])]);
    for (const [where, bad] of ENUMS[cmd] || []) {
      const args = [...valid];
      if (typeof where === 'string') { const i = args.indexOf(where); if (i >= 0) args[i + 1] = bad; else args.push(where, bad); } else args[at[where]] = bad;
      calls.push([cmd, ...args]);
    }
    calls.push([cmd, ...valid, '--bogus', 'x']);
    // Each flag that takes a value: given last with none, and (when it takes one value) given twice.
    for (const [flag, shape] of Object.entries(J.COMMAND_FLAGS[cmd])) {
      if (shape === 'bool') continue;
      calls.push([cmd, ...valid, `--${flag}`]);
      if (shape !== 'many' && !valid.includes(`--${flag}`)) calls.push([cmd, ...valid, `--${flag}`, 'a', `--${flag}`, 'b']);
    }
    if (TEXT_AT[cmd] !== undefined) {
      const empty = [...valid]; empty[at[TEXT_AT[cmd]]] = ''; calls.push([cmd, ...empty]);
      const dashed = [...valid]; dashed[at[TEXT_AT[cmd]]] = '--looks like a flag'; calls.push([cmd, ...dashed]);
    }
    if (IDS_AT[cmd] !== undefined) { const wrong = [...valid]; wrong[at[IDS_AT[cmd]]] = '99'; calls.push([cmd, ...wrong]); }
  }
  for (const [cmd, flags] of Object.entries(REMOVED_FLAGS)) for (const flag of Object.keys(flags)) calls.push([cmd, ...(VALID[cmd] || []), `--${flag}`, ...(flag === 'retract' ? ['1'] : flag === 'by' ? ['repo'] : [])]);
  for (const cmd of Object.keys(REPLACED_COMMANDS)) calls.push([cmd, '1']);
  return calls;
}

// What each ready command is checked for: on the last line, a jarl.mjs command whose last call is of the same command (a
// step may come before it), or of the command the tables of removed commands, flags and forms name for the call, which the
// shell runs without the refusal coming back.
export function readyProblems(args, said, again) {
  const lines = said.trim().split('\n');
  const ready = lines.at(-1);
  const reason = lines.slice(0, -1).join('\n');
  const problems = [];
  if (!/^jarl\.mjs \S/.test(ready) || lines.length < 2) return [`no ready command on the last line: ${ready}`];
  const cmd = args[0];
  const used = [...ready.matchAll(/(?:^|&& )jarl\.mjs (\S+)/g)].map((m) => m[1].replace(/^'|'$/g, ''));
  const replaced = Object.hasOwn(REPLACED_COMMANDS, cmd) || (Object.hasOwn(REMOVED_FLAGS, cmd) && Object.keys(REMOVED_FLAGS[cmd]).some((f) => args.includes(`--${f}`)));
  const unknown = !Object.hasOwn(J.COMMAND_FLAGS, cmd) && !Object.hasOwn(REPLACED_COMMANDS, cmd);
  if (!replaced && !unknown && used.at(-1) !== cmd && !(REMOVED_FORMS[cmd] || []).includes(used.at(-1))) problems.push(`the ready command calls ${used.join(', ')}, not ${cmd}: ${ready}`);
  if (unknown && ready !== 'jarl.mjs --help') problems.push(`an unknown command ends with the help: ${ready}`);
  // Each command of the line is a call its own command takes: prose after a command reads as words it refuses.
  for (const segment of ready.split(' && ')) {
    try { J.parseArgs(commandWords(segment).slice(1)); } catch (e) { problems.push(`${segment} is no call jarl.mjs takes: ${String(e.message).split('\n')[0]}`); }
  }
  if (again && again.status !== 0 && again.stderr.trim().split('\n').slice(0, -1).join('\n') === reason) problems.push(`run as printed, it is refused for the same reason: ${ready}`);
  return problems;
}
function walk(calls, { mustRefuse }) {
  const found = [];
  let refused = 0;
  for (const args of calls) {
    const dir = copy();
    const before = logOf(dir);
    const r = run(dir, args);
    if (r.status === 0) { if (mustRefuse) found.push(`${JSON.stringify(args)}: went through`); continue; }
    refused += 1;
    if (logOf(dir) !== before) found.push(`${JSON.stringify(args)}: refused and wrote`);
    const ready = r.stderr.trim().split('\n').at(-1);
    const again = /^jarl\.mjs \S/.test(ready) && !ready.startsWith('jarl.mjs --help') ? runPrinted(copy(), ready) : null;
    for (const p of readyProblems(args, r.stderr, again)) found.push(`${JSON.stringify(args)}: ${p}`);
  }
  return { found, refused };
}

test('the check of a ready command catches a refusal that ends with an unrelated call, or with no call, or with the same refusal again', () => {
  assert.deepEqual(readyProblems(['field', '1', 'Priority', '7'], 'Priority must be one of: 1, 2, 3\njarl.mjs field 1 Priority 1', null), []);
  assert.match(readyProblems(['field', '1', 'Priority', '7'], 'Priority must be one of: 1, 2, 3\njarl.mjs list --all', null)[0], /calls list, not field/);
  assert.match(readyProblems(['field', '1', 'Priority', '7'], 'Priority must be one of: 1, 2, 3\njarl.mjs field 1 Priority 1 && jarl.mjs list --all', null)[0], /calls field, list, not field/);
  assert.match(readyProblems(['set', '1', 'open', '--header'], '1 is not in the log\njarl.mjs set 1 open puts it there', null)[0], /is no call jarl\.mjs takes: set takes at most 3 arguments/);
  assert.match(readyProblems(['field', '1', 'Priority', '7'], 'Priority must be one of: 1, 2, 3 — e.g. jarl.mjs field 1 Priority 1 lists', null)[0], /no ready command on the last line/);
  assert.match(readyProblems(['field', '1', 'Priority', '7'], 'Priority must be one of\njarl.mjs field 1 Priority 7', { status: 1, stderr: 'Priority must be one of\njarl.mjs field 1 Priority 1' })[0], /refused for the same reason/);
});

test('every generated wrong call of every writing command is refused, writes nothing, and ends with a ready command of its own that the shell runs past the refusal', () => {
  const calls = generateWrongCalls();
  assert.ok(calls.length >= 150, `the walk makes ${calls.length} calls`);
  const { found } = walk(calls, { mustRefuse: true });
  assert.deepEqual(found, []);
});

test('the wrong calls of the reviews and of the earlier walk end with a ready command of their own that the shell runs past the refusal', () => {
  const calls = [...fixture('wrong-calls-review.json'), ...fixture('wrong-calls.json')];
  assert.ok(calls.length >= 180);
  const { found, refused } = walk(calls, { mustRefuse: false });
  assert.ok(refused >= 150, `${refused} of them are refused`);
  assert.deepEqual(found, []);
});

test('a ready call whose text starts with -- writes the text after a bare --, and the shell runs it with the text as given', () => {
  const cases = [
    [['retract', '1', '1', '--', '--the row ran on the wrong tree'], { "'<who>'": 'jarl' }, '--the row ran on the wrong tree'],
    [['evidence', '1', '--retract', '1', '--by', 'jarl', '--', '--the row ran elsewhere'], {}, '--the row ran elsewhere'],
    [['answer', 'a-1', '--', '--this way, not that'], { "'<who>'": 'owner' }, '--this way, not that'],
    [['decide', 'the-way', '--', '--we go this way'], { "'<who>'": 'jarl' }, '--we go this way'],
    [['body', '1', '--changelog', '--Fixed: a dash first'], {}, '--Fixed: a dash first'],
  ];
  for (const [args, fill, text] of cases) {
    const dir = copy();
    const said = run(dir, args);
    assert.notEqual(said.status, 0, args.join(' '));
    let ready = said.stderr.trim().split('\n').at(-1);
    assert.match(ready, / -- (?:\S+ )*'--/, `${args.join(' ')}: the text after a bare --: ${ready}`);
    for (const [from, to] of Object.entries(fill)) ready = ready.split(from).join(to);
    const again = runPrinted(dir, ready);
    assert.equal(again.status, 0, `${ready}\n${again.stderr}`);
    assert.ok(readdirSync(join(dir, '.jarl'), { recursive: true }).some((f) => /\.md$/.test(f) && readFileSync(join(dir, '.jarl', f), 'utf8').includes(text)), `${args[0]}: the text is written as given`);
  }
});

// The sources: a refusal is thrown only by refuse, or by need with a reason and a ready part, never as a bare Error.
const SOURCES = fileURLToPath(new URL('../', import.meta.url));
const sourceFiles = () => ['jarl.mjs', 'record.mjs', ...readdirSync(join(SOURCES, 'lib')).filter((f) => f.endsWith('.mjs')).map((f) => `lib/${f}`)];
function needArity(src) {
  const bad = [];
  for (const m of src.matchAll(/(?<![\w$.])need\(|\bL\.need\(/g)) {
    if (/function need\(/.test(src.slice(Math.max(0, m.index - 9), m.index + 5))) continue;
    let depth = 0; let args = 1; let q = null;
    for (let i = m.index + m[0].length; i < src.length; i += 1) {
      const c = src[i];
      if (q) { if (c === '\\') i += 1; else if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; continue; }
      if ('([{'.includes(c)) depth += 1;
      else if (')]}'.includes(c)) { if (depth === 0) break; depth -= 1; }
      else if (c === ',' && depth === 0) args += 1;
    }
    if (args < 3) bad.push(src.slice(0, m.index).split('\n').length);
  }
  return bad;
}
test('every refusal of the sources is built by refuse or need with its ready part; none is a bare Error', async () => {
  const problems = [];
  for (const f of sourceFiles()) {
    const src = readFileSync(join(SOURCES, f), 'utf8');
    for (const line of needArity(src)) problems.push(`${f}:${line}: need( with no ready part`);
    src.split('\n').forEach((l, i) => {
      // One Error is built from a refusal, in refusalFor, the one way a refusal reaches the caller; one Refusal, in refuse.
      if (/\bnew Error\(/.test(l) && !(f === 'jarl.mjs' && /return new Error\(`\$\{e\.reason\}\\n\$\{ready\}`\)/.test(l))) problems.push(`${f}:${i + 1}: new Error`);
      if (/\bnew Refusal\(/.test(l) && f !== 'lib/base.mjs') problems.push(`${f}:${i + 1}: new Refusal outside refuse`);
    });
  }
  assert.deepEqual(problems, []);
  // refuse turns away a refusal with no ready part, or with one that is neither a command nor a fix.
  const { refuse } = await import('../lib/base.mjs');
  assert.throws(() => refuse('a reason'), TypeError);
  assert.throws(() => refuse('a reason', 'list the issues'), TypeError);
  assert.throws(() => refuse('a reason', { first: 'see the help' }), TypeError);
  assert.throws(() => refuse('a reason', ['jarl.mjs', 'list']), (e) => e.reason === 'a reason' && e.message === 'a reason\njarl.mjs list');
  // The check sees a need with two arguments and a bare throw.
  assert.deepEqual(needArity("need(a, 'reason');\nneed(a, 'reason', ['jarl.mjs', 'x']);"), [1]);
});
