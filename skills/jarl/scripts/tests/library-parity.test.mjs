// The record library and the command line write the same record. Each operation of record.mjs runs twice on twin loops
// that start from the same state: the library call on one, the matching command (spawned as a process, as a person runs
// it) on the other. The files and the log lines must come out the same, except where the list below names the
// difference. The list is the one place that says what only the command line does, or what the library does
// differently, and why; SKILL.md carries the same list, and a test there holds the two to each other cell by cell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../record.mjs';
import { spawnJarl, gitRepo } from './helpers.mjs';
import { FINDINGS } from './findings.mjs';

// The heading of the section of SKILL.md that carries the table of the list.
const SECTION = '### What only the command line does\n';
const SKILL = fileURLToPath(new URL('../../SKILL.md', import.meta.url));

// What the command line does and the library does not, one row per difference: four cells, exactly as the table in
// SKILL.md writes them. `cases` names the parity cases that show the difference (a row with none says why in `why`).
export const COMMAND_LINE_ONLY = [
  { item: 'Merge with no CI state', cases: ['merged'], cli: 'records no CI state unless `--ci` is given', library: 'records `pending` when a sha is given without a CI state', why: 'a composer that records a merge before CI has run says so in the record; a person at the command line gives the state when it is known' },
  { item: 'Numbers of issues and questions', cases: ['new', 'ask'], cli: 'writes them plain (`3`, `a-1`), and raises the record format for a plain number under three digits', library: 'writes three digits (`003`, `a-001`)', why: 'a composer\'s files sort by name, and the contract returns the three-digit ids' },
  { item: 'Merge cleanup', cases: ['merge cleanup'], cli: 'removes the merged issue\'s worktree and local branch when that is safe, unless `--keep` is given', library: 'removes nothing', why: 'removing git worktrees and branches is a step a person asks for at the command line; a composer removes the ones it made' },
  { item: 'Caller of a status or field move', cases: ['status as cli'], cli: 'asks as `cli`, so a status the profile marks `set-by: record` is refused', library: 'asks as `record` unless `caller: cli` is passed', why: 'a status the profile gives to the record\'s own tool is moved by the composer that runs the loop, not by a person at the command line' },
  { item: 'Worktree of a lease', cases: ['worktree as cli'], cli: 'refuses a `--worktree` that exists and is not a worktree of the lease\'s repository, or has another branch checked out', library: 'accepts it and stores nothing', why: 'the worktree of a lease is found through its branch; a composer that tracks worktrees checks them itself' },
  { item: 'Base of a done check', cases: [], cli: 'checks a done against the branch checked out in the merge\'s repository, and takes no base', library: 'takes `base`, the branch or ref a merge landed in, for a composer that lands into a branch not checked out', why: 'a person\'s merge lands in the checked-out branch; a composer names its own target, and no command-line call can name one' },
  { item: 'Who answered', cases: ['answer with a name'], cli: 'records `--by` (default: owner)', library: 'records the owner; the contract\'s answer takes no name', why: 'a composer cannot name the ratifier through the library, because the answer keeps the arguments the contract names' },
  { item: 'Ratified area rulings', cases: [], cli: 'writes the type\'s decision log and the rule\'s log through the Yggdrasil edge', library: 'returns the entries and writes neither', why: 'the Yggdrasil write is the only call from Jarl to another family tool; a composer writes into its own graph; no twin case exists, because it needs a loop with an area ruling and a graph' },
  { item: 'Replies and notes', cases: [], cli: 'prints notes and replies that depend on the caller: the goal that names no check (`init`), the tier of a new issue (`new`), the lease notes (`set`), the proof and fresh-review notes (`merged`), the model and proof notes and the next step (`review`), the owner\'s word with no question (`decide`), and a long free-text note (`evidence`)', library: 'writes the same files and prints none of them', why: 'the notes are for a person at the command line; the twin cases compare files and log lines, and the notes are neither' },
  { item: 'Lists of ids', cases: [], cli: 'takes a list of ids (`12,13`, `203-206`) for `files`, `repo`, `after`, `body`, `round` and `source`, and checks every id before it writes one', library: 'takes one id for each of those operations', why: 'a person at the command line writes a package of issues in one call; a composer calls the operation for each id it holds and decides what a refusal on one of them means; no twin case exists, because the twin loops run one id' },
  { item: 'The verbs `retract` and `field`', cases: [], cli: 'retracts an approve or an evidence row with `retract`, and writes Resources or a profile field with `field`, emptied with `--clear`', library: 'retracts with `review` (verdict `retract`) and `addEvidence` (`retract`); `setField` writes a field the profile declares, and `setStatus` with the name `resources` writes Resources; both empty a field with an empty value', why: 'the verbs are the command line\'s grammar over the operations; the library keeps the operations its contract names' },
  { item: '`close`', cases: [], cli: 'ends the loop: removes it, or keeps it as a permanent record', library: 'no function', why: 'ending a loop belongs to whoever runs it, and a profile may hand that to a composer' },
  { item: '`archive`', cases: [], cli: 'moves the loop under an archive directory and leaves the open issues named', library: 'no function', why: 'ending a loop belongs to whoever runs it, and a profile may hand that to a composer' },
  { item: '`mode`', cases: [], cli: 'makes the loop permanent, a mode of git', library: 'no function', why: 'the mode is written at init, and a change of it is a decision of the person who commits the record' },
  { item: '`import`', cases: [], cli: 'files issues from a Markdown source', library: 'no function; newIssue files one issue', why: 'filing from a source is the composer\'s choice' },
  { item: '`next`', cases: [], cli: 'lists the open issues that can start now', library: 'no function; statusData carries the counts', why: 'ordering work is a composer\'s planner; Jarl offers what can run now' },
  { item: '`queue`', cases: [], cli: 'lists the merge queue', library: 'no function', why: 'a listing for a person; a composer decides what lands' },
  { item: '`report`', cases: [], cli: 'writes the loop\'s text report with its metrics', library: 'no function', why: 'a summary for a person; a composer reports from its own record' },
  { item: '`scope`', cases: [], cli: 'reads a worker branch\'s diff against the files its issues declare', library: 'no function', why: 'it reads git; a composer\'s gate decides what lands' },
  { item: 'Typing a command under another name', cases: [], cli: 'prints a note on stderr that gives the command\'s own name', library: 'no command names, only functions called by name', why: 'a note for a person typing at the command line; the tools and composers call a command by its own name' },
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

// The exports of record.mjs that read the loop and touch no file of it through an operation. Every other function export
// is an operation, and needs a parity case: the test below fails for one that has none.
const READS = ['resolveRoot', 'jarlDir', 'hasLiveLoop', 'loadIssues', 'findIssue', 'decisions', 'loadAsks', 'parseIssue', 'renderIssue', 'mergedOf', 'evidenceRows', 'validateProfile', 'readProfileFile', 'loadProfile', 'describeProfile', 'withLock', 'writeAtomic', 'statusData', 'resumeData'];

const TIME = /\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?Z?)?)?/g;
// The padding of an id and nothing else: 003 reads as 3, a-001 as a-1. Applied only where a case says its ids differ in spelling.
const spelling = (text) => text.replace(/(?<![\w.])(a-)?0+(\d)/g, '$1$2');
// The files of a case whose ids are spelled with padding on one side: names and text, with the padding taken out.
const spelled = (files) => Object.fromEntries(Object.entries(files).map(([name, text]) => [spelling(name), spelling(text)]));
const sameFiles = (a, b) => {
  const entries = (f) => Object.entries(f).sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0));
  return JSON.stringify(entries(a)) === JSON.stringify(entries(b));
};

// The loop's files as text, with both roots and the clock taken out; and, in a git checkout, its branches and worktrees.
function snapshot(root, wt) {
  const dir = join(root, '.jarl');
  const files = {};
  // The worktree's path is the root's path with a suffix, so it is taken out first; each path as given and as resolved.
  const scrub = (text) => {
    let t = text;
    for (const n of [existsOrNull(wt), wt, realpathSync(root), root]) if (n) t = t.split(n).join(n === wt || n === existsOrNull(wt) ? '<wt>' : '<root>');
    return t.replace(TIME, '<time>');
  };
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name !== '.lock') files[relative(dir, p)] = scrub(readFileSync(p, 'utf8'));
    }
  };
  walk(dir);
  const git = (...args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 }); } catch { return null; } };
  const branches = git('branch', '--list');
  if (branches !== null) {
    files['git branches'] = branches;
    files['git worktrees'] = scrub(git('worktree', 'list', '--porcelain') ?? '');
  }
  return files;
}
function existsOrNull(p) { try { return realpathSync(p); } catch { return null; } }
const logLines = (snap) => (snap['log.md'] ?? '').split('\n').filter((l) => l.startsWith('- '));

// A fresh directory with an empty .git in it (no loop yet), or a git repository with one commit.
function twin(git) {
  if (git) return gitRepo({ prefix: 'jarl-parity-git-' }).dir;
  const root = mkdtempSync(join(tmpdir(), 'jarl-parity-'));
  mkdirSync(join(root, '.git'));
  return root;
}
const head = (root) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 30000 }).trim();

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
// A loop whose profile gives a status to the record's own tool: the library moves it, the command line refuses.
function recordOwned(root) {
  const file = join(root, 'profile.json');
  writeFileSync(file, JSON.stringify({ 'jarl-profile': R.PROFILE_VERSION, name: 'p', statuses: { open: ['dispatchable'], doing: { flags: ['holds-claim'], 'set-by': 'record' }, done: ['settles-dependents', 'terminal', 'closes-record'] } }));
  R.initLoop(root, 'g', { profile: file });
  R.newIssue(root, 't');
}
// A proven issue on a branch that is merged into the base, with a worktree of that branch beside the loop.
function merged(root) {
  proven(root);
  execFileSync('git', ['branch', 'work/first'], { cwd: root, timeout: 30000 });
  execFileSync('git', ['worktree', 'add', `${root}-wt`, 'work/first'], { cwd: root, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
}

// Each case: `pre` builds the state on both loops with the library; `lib` runs on one loop as the library calls it;
// `cli` is the command line's arguments (the loop's --root is added), run on the other; `git` makes a checkout; `spell`
// compares the ids with their padding taken out; `refusal` says which side refuses, when the two must differ in that.
// `op` names the record operation the case shows.
const CASES = [
  { op: 'initLoop', name: 'init', git: false, pre: () => {}, lib: (root) => R.initLoop(root, 'goal'), cli: ['init', 'goal'] },
  { op: 'newIssue', name: 'new', pre: base, spell: true, lib: (root) => R.newIssue(root, 'third', { kind: 'gap', prio: '2', acceptance: 'it works' }), cli: ['new', 'third', '--kind', 'gap', '--prio', '2', '--acceptance', 'it works'] },
  { op: 'setStatus', name: 'set in-progress', pre: base, lib: (root) => R.setStatus(root, '1', 'in-progress', undefined, { branch: 'work/first', worker: 'w1' }), cli: ['set', '1', 'in-progress', '--branch', 'work/first', '--worker', 'w1'] },
  { op: 'setStatus', name: 'set done', pre: proven, lib: (root) => R.setStatus(root, '1', 'done'), cli: ['set', '1', 'done'] },
  { op: 'setStatus', name: 'status as cli', pre: recordOwned, lib: (root) => R.setStatus(root, '1', 'doing'), cli: ['set', '1', 'doing'], refusal: { lib: false, cli: true } },
  { op: 'setStatus', name: 'worktree as cli', pre: base, lib: (root) => R.setStatus(root, '1', 'in-progress', undefined, { branch: 'work/first', worker: 'w1', worktree: join(root, '.jarl') }), cli: (root) => ['set', '1', 'in-progress', '--branch', 'work/first', '--worker', 'w1', '--worktree', join(root, '.jarl')], refusal: { lib: false, cli: true } },
  { op: 'setField', name: 'set field', pre: base, lib: (root) => R.setField(root, '1', 'Tier', 'strong'), cli: ['set', '1', 'tier', 'strong'] },
  { op: 'setBody', name: 'body', pre: base, lib: (root) => R.setBody(root, '1', { what: 'the what' }), cli: ['body', '1', '--what', 'the what'] },
  { op: 'setTags', name: 'tag', pre: base, lib: (root) => R.setTags(root, '1', ['+x']), cli: ['tag', '1', '+x'] },
  { op: 'setPriority', name: 'prio', pre: base, lib: (root) => R.setPriority(root, '1', '1'), cli: ['prio', '1', '1'] },
  { op: 'setFiles', name: 'files', pre: base, lib: (root) => R.setFiles(root, '1', 'a.mjs'), cli: ['files', '1', 'a.mjs'] },
  { op: 'setRepo', name: 'repo', pre: base, lib: (root) => R.setRepo(root, '1', '.'), cli: ['repo', '1', '.'] },
  { op: 'setAfter', name: 'after', pre: base, lib: (root) => R.setAfter(root, '1', '2'), cli: ['after', '1', '2'] },
  { op: 'setSource', name: 'source', pre: base, lib: (root) => R.setSource(root, '1', 'https://example.test/a'), cli: ['source', '1', 'https://example.test/a'] },
  { op: 'addEvidence', name: 'evidence text', pre: base, lib: (root) => R.addEvidence(root, '1', 'a note'), cli: ['evidence', '1', 'a note'] },
  { op: 'addEvidence', name: 'evidence rows', pre: base, lib: (root) => R.addEvidence(root, '1', undefined, { ran: 'npm test', saw: 'ok' }), cli: ['evidence', '1', '--ran', 'npm test', '--saw', 'ok'] },
  { op: 'review', name: 'review', pre: base, lib: (root) => R.review(root, '1', 'approve', FINDINGS, { by: 'reviewer' }), cli: ['review', '1', 'approve', '--by', 'reviewer', FINDINGS] },
  { op: 'recordMerged', name: 'merged', pre: proven, lib: (root) => R.recordMerged(root, '1', { sha: 'abc1234' }), cli: ['merged', '1', '--sha', 'abc1234'] },
  { op: 'recordMerged', name: 'merged with CI', pre: proven, lib: (root) => R.recordMerged(root, '1', { sha: 'abc1234', ci: 'green' }), cli: ['merged', '1', '--sha', 'abc1234', '--ci', 'green'] },
  { op: 'recordMerged', name: 'merge cleanup', git: true, pre: merged, lib: (root) => R.recordMerged(root, '1', { sha: head(root), ci: 'green' }), cli: (root) => ['merged', '1', '--sha', head(root), '--ci', 'green'] },
  { op: 'addRound', name: 'round', pre: base, lib: (root) => R.addRound(root, '1', 'failed once'), cli: ['round', '1', 'failed once'] },
  { op: 'decide', name: 'decide', pre: base, lib: (root) => R.decide(root, 'one', 'first ruling'), cli: ['decide', 'one', 'first ruling'] },
  { op: 'ask', name: 'ask', pre: base, spell: true, lib: (root) => R.ask(root, 'which?', { issue: '1' }), cli: ['ask', 'which?', '--issue', '1'] },
  { op: 'answer', name: 'answer', pre: (root) => { base(root); R.ask(root, 'which?', { issue: '1' }); }, lib: (root) => R.answer(root, 'a-001', 'this'), cli: ['answer', 'a-001', 'this'] },
  { op: 'answer', name: 'answer with a name', pre: (root) => { base(root); R.ask(root, 'which?', { issue: '1' }); }, lib: (root) => R.answer(root, 'a-001', 'this'), cli: ['answer', 'a-001', 'this', '--by', 'Composer'] },
  { op: 'appendLog', name: 'log', pre: base, lib: (root) => R.appendLog(root, 'an event'), cli: ['log', 'an event'] },
];

const argsOf = (c, root) => (typeof c.cli === 'function' ? c.cli(root) : c.cli);
function run(c, root, wt, side) {
  let refused = false;
  let message = '';
  if (side === 'lib') {
    try { c.lib(root); } catch (e) { refused = true; message = e.message; }
  } else {
    const r = spawnJarl(root, argsOf(c, root));
    refused = r.status !== 0;
    message = (r.stderr ?? '').trim();
  }
  return { refused, message, files: snapshot(root, wt) };
}

test('every record operation writes the same files and log lines as its command, except where the list names the difference', () => {
  const differing = new Set();
  for (const c of CASES) {
    const lib = twin(c.git);
    const cli = twin(c.git);
    const wtLib = `${lib}-wt`;
    const wtCli = `${cli}-wt`;
    try {
      c.pre(lib);
      // The command line's twin starts from the same state, built by the library too.
      c.pre(cli);
      const a = run(c, lib, wtLib, 'lib');
      const b = run(c, cli, wtCli, 'cli');
      if (c.refusal) {
        assert.equal(a.refused, c.refusal.lib, `${c.name}: the library refused: ${a.message}`);
        assert.equal(b.refused, c.refusal.cli, `${c.name}: the command line refused: ${b.message}`);
      } else {
        assert.equal(a.refused, b.refused, `${c.name}: one side refused and the other did not (${a.message} / ${b.message})`);
      }
      let aFiles = a.files;
      let bFiles = b.files;
      let raised = false;
      if (c.spell) {
        aFiles = spelled(aFiles);
        bFiles = spelled(bFiles);
        // A plain number under three digits makes the command line raise the record format: that marker, exactly, is the one
        // file that may differ beside the padding of the ids.
        if (bFiles['profile.json'] !== undefined && aFiles['profile.json'] === undefined) {
          assert.deepEqual(JSON.parse(bFiles['profile.json']), { 'jarl-profile': R.PROFILE_VERSION, format: 2 }, `${c.name}: the marker the command line raises`);
          delete bFiles['profile.json'];
          raised = true;
        }
      }
      if (raised || !sameFiles(aFiles, bFiles)) differing.add(c.name);
      else assert.deepEqual(logLines(a.files), logLines(b.files), `${c.name}: log lines`);
    } finally {
      for (const d of [lib, cli, wtLib, wtCli]) rmSync(d, { recursive: true, force: true });
    }
  }
  const named = new Set(COMMAND_LINE_ONLY.flatMap((row) => row.cases));
  const unnamed = [...differing].filter((name) => !named.has(name));
  assert.deepEqual(unnamed, [], `the files differ and the list does not name the difference: ${unnamed.join(', ')}`);
  for (const row of COMMAND_LINE_ONLY) for (const name of row.cases) assert.ok(differing.has(name), `the list names ${name} for "${row.item}", and its files do not differ: remove the case or fix the row`);
});

test('every function export of record.mjs has a parity case, or is one of the reads that change nothing in the loop', () => {
  const operations = Object.keys(R).filter((k) => typeof R[k] === 'function');
  const cased = new Set(CASES.map((c) => c.op));
  const missing = operations.filter((k) => !cased.has(k) && !READS.includes(k));
  assert.deepEqual(missing, [], 'exports with no parity case');
  for (const op of cased) assert.ok(operations.includes(op), `a case names ${op}, which record.mjs does not export`);
});

test('the list and the table in SKILL.md agree cell by cell, so a changed cell in either fails', () => {
  const skill = readFileSync(SKILL, 'utf8');
  const start = skill.indexOf(SECTION);
  assert.ok(start >= 0, `SKILL.md has no section "${SECTION}"`);
  const rest = skill.slice(start + SECTION.length);
  const next = rest.search(/^#{1,3} /m);
  const body = next === -1 ? rest : rest.slice(0, next);
  const rows = body.split('\n').filter((l) => l.startsWith('|')).slice(2).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
  assert.deepEqual(rows, COMMAND_LINE_ONLY.map((row) => [row.item, row.cli, row.library, row.why]), 'the table rows, cell by cell, in the order of the list');
});
