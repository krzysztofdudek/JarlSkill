// The record library and the command line write the same record. Each operation of record.mjs runs twice on twin loops
// that start from the same state: the library call on one, the matching command (spawned as a process, as a person runs
// it) on the other. The files and the log lines must come out the same, except where the list below names the
// difference. The list is the one place that says what only the command line does, or what the library does
// differently, and why; SKILL.md carries the same list, and a test there holds the two to each other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../record.mjs';
import { spawnJarl } from './helpers.mjs';
import { FINDINGS } from './findings.mjs';

// The heading of the section of SKILL.md that carries the table of the list.
const SECTION = '### What only the command line does\n';

// What the command line does and the library does not, one row per difference: `item` is the row's first cell in
// SKILL.md; `case` names the parity case that shows it (a row without a case is a difference no twin loop can show).
export const COMMAND_LINE_ONLY = [
  { item: 'Merge with no CI state', cases: ['merged'], cli: 'records no CI state unless `--ci` is given', library: 'records `pending` when a sha is given without a CI state', why: 'a composer that records a merge before CI has run says so in the record; a person at the command line gives the state when it is known' },
  { item: 'Numbers of issues and questions', cases: ['new', 'ask'], cli: 'writes them plain (`3`, `a-1`), and raises the record format for a plain number under three digits', library: 'writes three digits (`003`, `a-001`)', why: 'a composer\'s files sort by name, and the contract returns the three-digit ids' },
  { item: 'Merge cleanup', cases: [], cli: 'removes the merged issue\'s worktree and local branch when that is safe, unless `--keep` is given', library: 'removes nothing', why: 'removing git worktrees and branches is a step a person asks for at the command line; a composer removes the ones it made' },
  { item: 'Caller of a status or field move', cases: [], cli: 'asks as `cli`, so a status the profile marks `set-by: record` is refused', library: 'asks as `record` unless `caller: cli` is passed', why: 'a status the profile gives to the record\'s own tool is moved by the composer that runs the loop, not by a person at the command line' },
  { item: 'Who answered', cases: [], cli: 'records `--by` (default: owner)', library: 'records the owner; the contract\'s answer takes no name', why: 'the answer keeps the arguments the contract names' },
  { item: 'Ratified area rulings', cases: [], cli: 'writes the type\'s decision log and the rule\'s log through the Yggdrasil edge', library: 'returns the entries and writes neither', why: 'the Yggdrasil write is the only call from Jarl to another family tool; a composer writes into its own graph' },
  { item: 'Review reply', cases: [], cli: 'adds model notes, a proof note and the next step to its reply', library: 'returns the notes the record itself raises', why: 'the notes and the next step are read by a person; the files written are the same' },
  { item: 'Merge reply', cases: [], cli: 'adds a note when the issue holds no proof from the worker', library: 'does not add it', why: 'the note is a reminder for a person at the command line; the files written are the same' },
  { item: '`close`', cases: [], cli: 'ends the loop: removes it, or keeps it as a permanent record', library: 'no function', why: 'ending a loop belongs to whoever runs it, and a profile may hand that to a composer' },
  { item: '`archive`', cases: [], cli: 'moves the loop under an archive directory and leaves the open issues named', library: 'no function', why: 'ending a loop belongs to whoever runs it, and a profile may hand that to a composer' },
  { item: '`mode`', cases: [], cli: 'makes the loop permanent, a mode of git', library: 'no function', why: 'the mode is written at init, and a change of it is a decision of the person who commits the record' },
  { item: '`import`', cases: [], cli: 'files issues from a Markdown source', library: 'no function; newIssue files one issue', why: 'filing from a source is the composer\'s choice' },
  { item: '`next`', cases: [], cli: 'lists the open issues that can start now', library: 'no function; statusData carries the counts', why: 'ordering work is a composer\'s planner; Jarl offers what can run now' },
  { item: '`queue`', cases: [], cli: 'lists the merge queue', library: 'no function', why: 'a listing for a person; a composer decides what lands' },
  { item: '`report`', cases: [], cli: 'writes the loop\'s text report with its metrics', library: 'no function', why: 'a summary for a person; a composer reports from its own record' },
  { item: '`check`', cases: [], cli: 'reads a worker branch\'s diff against the files its issues declare', library: 'no function', why: 'it reads git; a composer\'s gate decides what lands' },
  { item: '`branches`', cases: [], cli: 'lists each branch with the issues it carries and its state', library: 'no function', why: 'it reads git in the repositories the issues name; a view for a person' },
  { item: '`tips`', cases: [], cli: 'lists the tip of each worker branch in flight', library: 'no function', why: 'it reads git in every repository the issues name; a view for a person' },
  { item: '`verify`', cases: [], cli: 'checks the record with its own readers in strict mode', library: 'no function; the readers are the library\'s', why: 'a consistency read for a person; a composer uses the readers' },
  { item: '`models`', cases: [], cli: 'shows, per model, what the record holds as worker and as reviewer', library: 'no function', why: 'a reading of the record for choosing models; a view for a person' },
  { item: '`goal`', cases: [], cli: 'reads or sets the goal line', library: 'no function; initLoop writes the goal', why: 'the goal is written at init; a change of it is a decision of the person who runs the loop' },
  { item: '`show`', cases: [], cli: 'shows one issue as text, with its evidence rows and where its branch sits', library: 'no function; findIssue returns the same record as data', why: 'text for a person' },
  { item: '`list`', cases: [], cli: 'lists the issues as a table', library: 'no function; loadIssues returns the same record as data', why: 'a table for a person' },
  { item: '`changelog`', cases: [], cli: 'shows the changelog fragments of issues as text', library: 'no function', why: 'the release step writes the release text once, from the fragments' },
  { item: '`handoff`', cases: [], cli: 'reads and writes a session\'s handoff note', library: 'no function', why: 'the handoff is a note of a session, not part of the record' },
  { item: '`sources`', cases: [], cli: 'lists the sources of issues', library: 'no function; setSource writes them', why: 'a view for a person' },
  { item: '`profile`', cases: [], cli: 'shows the profile in use, as text', library: 'no function; loadProfile and describeProfile return it as data', why: 'text for a person' },
];

const TIME = /\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?Z?)?)?/g;

// The loop's files, as text: every path under .jarl/ (the lock aside), with the two roots and the clock taken out.
function snapshot(root) {
  const dir = join(root, '.jarl');
  const files = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name !== '.lock') files[relative(dir, p)] = readFileSync(p, 'utf8').split(root).join('<root>').replace(TIME, '<time>');
    }
  };
  walk(dir);
  return files;
}
const logLines = (snap) => (snap['log.md'] ?? '').split('\n').filter((l) => l.startsWith('- '));

// A fresh directory that is a checkout (an empty .git), with no loop in it yet.
function twin() {
  const root = mkdtempSync(join(tmpdir(), 'jarl-parity-'));
  mkdirSync(join(root, '.git'));
  return root;
}

// The state every case starts from: a loop with two issues, the second after the first, built by the library.
function base(root) {
  R.initLoop(root, 'goal');
  R.newIssue(root, 'first', { acceptance: 'it works' });
  R.newIssue(root, 'second', { after: '1' });
}
// The first issue taken through a worker's proof and a fresh approve, so that done and merged have something to stand on.
function proven(root) {
  base(root);
  R.setStatus(root, '1', 'in-progress', undefined, { branch: 'work/first', worker: 'w1' });
  R.addEvidence(root, '1', undefined, { ran: 'npm test', saw: 'ok' });
  R.review(root, '1', 'approve', FINDINGS, { by: 'reviewer' });
}

// Each case: `pre` builds the state on both loops with the library; `lib` runs on one loop as the library calls it;
// `cli` is the command line's arguments (the loop's --root is added), run on the other.
const CASES = [
  { name: 'new', pre: base, lib: (root) => R.newIssue(root, 'third', { kind: 'gap', prio: '2', acceptance: 'it works' }), cli: ['new', 'third', '--kind', 'gap', '--prio', '2', '--acceptance', 'it works'] },
  { name: 'set in-progress', pre: base, lib: (root) => R.setStatus(root, '1', 'in-progress', undefined, { branch: 'work/first', worker: 'w1' }), cli: ['set', '1', 'in-progress', '--branch', 'work/first', '--worker', 'w1'] },
  { name: 'set done', pre: proven, lib: (root) => R.setStatus(root, '1', 'done'), cli: ['set', '1', 'done'] },
  { name: 'set field', pre: base, lib: (root) => R.setField(root, '1', 'Tier', 'strong'), cli: ['set', '1', 'tier', 'strong'] },
  { name: 'body', pre: base, lib: (root) => R.setBody(root, '1', { what: 'the what' }), cli: ['body', '1', '--what', 'the what'] },
  { name: 'tag', pre: base, lib: (root) => R.setTags(root, '1', ['+x']), cli: ['tag', '1', '+x'] },
  { name: 'prio', pre: base, lib: (root) => R.setPriority(root, '1', '1'), cli: ['prio', '1', '1'] },
  { name: 'files', pre: base, lib: (root) => R.setFiles(root, '1', 'a.mjs'), cli: ['files', '1', 'a.mjs'] },
  { name: 'after', pre: base, lib: (root) => R.setAfter(root, '1', '2'), cli: ['after', '1', '2'] },
  { name: 'source', pre: base, lib: (root) => R.setSource(root, '1', 'https://example.test/a'), cli: ['source', '1', 'https://example.test/a'] },
  { name: 'evidence text', pre: base, lib: (root) => R.addEvidence(root, '1', 'a note'), cli: ['evidence', '1', 'a note'] },
  { name: 'evidence rows', pre: base, lib: (root) => R.addEvidence(root, '1', undefined, { ran: 'npm test', saw: 'ok' }), cli: ['evidence', '1', '--ran', 'npm test', '--saw', 'ok'] },
  { name: 'review', pre: base, lib: (root) => R.review(root, '1', 'approve', FINDINGS, { by: 'reviewer' }), cli: ['review', '1', 'approve', '--by', 'reviewer', FINDINGS] },
  { name: 'merged', pre: proven, lib: (root) => R.recordMerged(root, '1', { sha: 'abc1234' }), cli: ['merged', '1', '--sha', 'abc1234'] },
  { name: 'merged with CI', pre: proven, lib: (root) => R.recordMerged(root, '1', { sha: 'abc1234', ci: 'green' }), cli: ['merged', '1', '--sha', 'abc1234', '--ci', 'green'] },
  { name: 'round', pre: base, lib: (root) => R.addRound(root, '1', 'failed once'), cli: ['round', '1', 'failed once'] },
  { name: 'decide', pre: base, lib: (root) => R.decide(root, 'one', 'first ruling'), cli: ['decide', 'one', 'first ruling'] },
  { name: 'ask', pre: base, lib: (root) => R.ask(root, 'which?', { issue: '1' }), cli: ['ask', 'which?', '--issue', '1'] },
  { name: 'answer', pre: (root) => { base(root); R.ask(root, 'which?', { issue: '1' }); }, lib: (root) => R.answer(root, 'a-001', 'this'), cli: ['answer', 'a-001', 'this'] },
  { name: 'log', pre: base, lib: (root) => R.appendLog(root, 'an event'), cli: ['log', 'an event'] },
];

// The result of one run: whether it was refused, and the loop's files afterwards.
function runLib(root, c) {
  try { c.lib(root); return { refused: false, files: snapshot(root) }; } catch (e) { return { refused: true, message: e.message, files: snapshot(root) }; }
}
function runCli(root, c) {
  const r = spawnJarl(root, c.cli);
  return { refused: r.status !== 0, message: (r.stderr ?? '').trim(), files: snapshot(root) };
}

test('every record operation writes the same files and log lines as its command, except where the list names the difference', () => {
  const differing = new Map();
  for (const c of CASES) {
    const lib = twin();
    const cli = twin();
    try {
      c.pre(lib);
      // The command line's twin starts from the same state, built by the library too.
      c.pre(cli);
      const a = runLib(lib, c);
      const b = runCli(cli, c);
      assert.equal(a.refused, b.refused, `${c.name}: one side refused and the other did not (${a.message ?? ''} / ${b.message ?? ''})`);
      if (JSON.stringify(a.files) !== JSON.stringify(b.files)) differing.set(c.name, { files: a.files, cliFiles: b.files });
      else assert.deepEqual(logLines(a.files), logLines(b.files), `${c.name}: log lines`);
    } finally {
      rmSync(lib, { recursive: true, force: true });
      rmSync(cli, { recursive: true, force: true });
    }
  }
  const named = new Set(COMMAND_LINE_ONLY.flatMap((row) => row.cases));
  const unnamed = [...differing.keys()].filter((name) => !named.has(name));
  assert.deepEqual(unnamed, [], `the files differ and the list does not name the difference: ${unnamed.join(', ')}`);
  for (const row of COMMAND_LINE_ONLY) for (const name of row.cases) assert.ok(differing.has(name), `the list names ${name} for "${row.item}", and its files do not differ: remove the case or fix the row`);
});

test('the list and the table in SKILL.md agree: each item is one row, and nothing else is in the section', () => {
  const skill = readFileSync(fileURLToPath(new URL('../../SKILL.md', import.meta.url)), 'utf8');
  const start = skill.indexOf(SECTION);
  assert.ok(start >= 0, `SKILL.md has no section "${SECTION}"`);
  const rest = skill.slice(start + SECTION.length);
  const next = rest.search(/^#{1,3} /m);
  const body = next === -1 ? rest : rest.slice(0, next);
  const rows = body.split('\n').filter((l) => l.startsWith('|')).slice(2).map((l) => l.split('|')[1].trim());
  assert.deepEqual(rows, COMMAND_LINE_ONLY.map((row) => `${row.item}`), 'the rows of the SKILL.md table, in the order of the list');
});
