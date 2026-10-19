// One store of state. The journal (log.md) is the record of an issue's status, lease, merge and CI; the header fields
// of the issue file are the tool's rendering of it, written in the same call. These tests hold the fold that derives the
// state from the journal against the header the commands write, the views and the gate that read the fold, the report of
// a header that disagrees, the refusal of event-shaped lines by the free log, and a composer's flow through the record
// operations alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as R from '../record.mjs';
import { gitRepo, jarl, loop as makeLoop, refuses, spawnJarl } from './helpers.mjs';
import { oldJarl, oldJarlIsPinned } from './old-jarl.mjs';
import { sh } from './portable.mjs';

const L = await import('../jarl-lib.mjs');

const RENDERED = ['status', 'branch', 'worker', 'model', 'since', 'merged', 'merge check', 'ci'];
// The rendered fields of an issue file as its header says them (null for a field the header does not carry).
function headerOf(file) {
  const issue = L.parseIssue(readFileSync(file, 'utf8'), file);
  return Object.fromEntries(RENDERED.map((k) => [k, k === 'status' ? issue.status : (issue.fields[k] || null)]));
}
// The same fields as the fold of the journal gives them.
function foldOf(dir, profile, id) {
  const events = L.loopEvents(dir, profile).filter((e) => e.id === id);
  return L.issueState(profile, events);
}
function issueFile(root, id) { return R.findIssue(root, id).file; }
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
// Runs fn with the issues directory of the loop closed to writing (a file cannot be created or replaced in it).
function withIssuesDirClosed(root, fn) {
  const dir = join(R.jarlDir(root), 'issues');
  chmodSync(dir, 0o555);
  try { return fn(); } finally { chmodSync(dir, 0o755); }
}

// A profile in a composer's shape, and the status names a script uses under each profile.
const HORDE = {
  'jarl-profile': 1, format: 1, name: 'horde',
  statuses: {
    proposed: { flags: [], 'set-by': 'record' },
    queued: { flags: ['dispatchable'], 'set-by': 'record' },
    running: ['holds-claim'],
    held: [],
    merged: { flags: ['settles-dependents', 'terminal', 'closes-record'], 'set-by': 'record' },
    dropped: ['settles-dependents', 'terminal', 'needs-reason'],
  },
  'external-scheduler': 'horde.mjs tick',
  'done-gate': { approve: 'none', 'requires-merged': true },
};
const SHAPES = {
  builtin: { names: { rest: 'open', work: 'in-progress', park: 'deferred' } },
  horde: { names: { rest: 'queued', work: 'running', park: 'held' }, profile: HORDE },
};
function shapedLoop(shape) {
  const root = mkdtempSync(join(tmpdir(), 'jarl-one-store-'));
  mkdirSync(join(root, '.git'));
  if (shape.profile) {
    const file = join(root, 'profile-source.json');
    writeFileSync(file, JSON.stringify(shape.profile));
    R.initLoop(root, 'goal', { profile: file });
  } else R.initLoop(root, 'goal');
  return root;
}

// ---- the fold -------------------------------------------------------------------------------------------

for (const [name, shape] of Object.entries(SHAPES)) {
  test(`the fold of the journal equals the header after every kind of lease, merge and CI line (${name} profile)`, () => {
    const root = shapedLoop(shape);
    const { rest, work, park } = shape.names;
    const dir = R.jarlDir(root);
    const profile = R.loadProfile(root);
    const { id } = R.newIssue(root, 'folded');
    const same = (label) => assert.deepEqual(foldOf(dir, profile, id), { ...headerOf(issueFile(root, id)) }, label);
    same('a filed issue');
    R.setStatus(root, id, work, undefined, { branch: 'jarl/1-a', worker: 'w1', model: 'm1' }); same('a lease with branch, worker and model');
    R.setStatus(root, id, work, undefined, {}); same('a bare lease');
    R.setStatus(root, id, work, undefined, { worker: 'w2' }); same('a new worker without a model');
    R.setStatus(root, id, work, undefined, { model: 'm3' }); same('a model alone');
    R.setStatus(root, id, work, undefined, { branch: 'jarl/1-b' }); same('a branch alone');
    R.setStatus(root, id, work, 'taking over', { worker: 'w3', model: 'm4', worktree: join(root, 'wt') }); same('a takeover with a reason and a worktree');
    R.setStatus(root, id, rest, undefined, {}); same('released: the branch stays, the rest goes');
    R.setStatus(root, id, work, undefined, { worker: 'w4' }); same('leased again on the branch that stayed');
    R.recordMerged(root, id, { sha: 'abc1234' }); same('a merge with the default CI state');
    R.recordMerged(root, id, { sha: 'abc1235', repo: gitRepo().dir, ci: 'green' }); same('a merge in a repository with its CI state');
    R.recordMerged(root, id, { ci: 'red' }); same('a CI state alone');
    R.recordMerged(root, id, { sha: 'abc1236', ci: 'none' }); same('a merge with CI none');
    R.setStatus(root, id, park, 'not now', {}); same('parked with a reason');
    const cli = R.newIssue(root, 'folded through the command line');
    jarl(root, 'set', cli.id, work, '--branch', 'jarl/2-a', '--worker', 'w5', '--model', 'm5');
    assert.deepEqual(foldOf(dir, profile, cli.id), headerOf(issueFile(root, cli.id)), 'a lease through the command line');
    jarl(root, 'merged', cli.id, '--sha', 'deadbeef', '--keep');
    assert.deepEqual(foldOf(dir, profile, cli.id), headerOf(issueFile(root, cli.id)), 'a merge through the command line records no CI state');
    jarl(root, 'merged', cli.id, '--ci', 'green');
    assert.deepEqual(foldOf(dir, profile, cli.id), headerOf(issueFile(root, cli.id)), 'a CI line through the command line');
  });
}

test('an issue the journal holds no filing and no move of has no folded state', () => {
  const root = makeLoop();
  const dir = R.jarlDir(root);
  const profile = R.loadProfile(root);
  writeFileSync(join(dir, 'issues', '1-by-hand.md'), '# 1 · by hand\n\n**Status:** in-progress\n**Branch:** b\n');
  assert.equal(foldOf(dir, profile, '1'), null);
  writeFileSync(join(dir, 'log.md'), '# Log\n\n- 2026-10-01 09:00 · 1 merged abc1234 · CI green\n- 2026-10-01 09:01 · 1 CI red\n');
  assert.equal(foldOf(dir, profile, '1'), null, 'merge and CI lines alone do not hold an issue');
});

const LIVE = process.env.JARL_LIVE_LOOP || '';
test('a copy of a real loop: the fold equals the header of every issue it holds', { skip: !(LIVE && existsSync(join(LIVE, '.jarl'))) && 'JARL_LIVE_LOOP is unset, or names no loop' }, () => {
  const dir = join(LIVE, '.jarl');
  const profile = R.loadProfile(LIVE);
  const events = L.loopEvents(dir, profile);
  const by = L.eventsById(events);
  const wrong = [];
  let held = 0;
  for (const f of readdirSync(join(dir, 'issues')).filter((x) => /^\d+-.*\.md$/.test(x))) {
    const header = headerOf(join(dir, 'issues', f));
    const id = f.slice(0, f.indexOf('-'));
    const s = L.issueState(profile, by.get(id) || []);
    if (!s) continue;
    held += 1;
    for (const k of RENDERED) if (s[k] !== header[k]) wrong.push(`${id} ${k}: file ${header[k]} log ${s[k]}`);
  }
  assert.deepEqual(wrong, []);
  assert.ok(held > 100, 'the copy holds many issues');
});

// ---- the views and the gate read the record ----------------------------------------------------------------

// The text of an issue file rewritten by `fn`, the way a person editing it by hand would.
function editHeader(root, id, fn) {
  const file = issueFile(root, id);
  writeFileSync(file, fn(readFileSync(file, 'utf8')));
}

test('a hand edit of a Status header to done is not counted by status, resume, list, show or next', () => {
  const root = makeLoop();
  jarl(root, 'new', 'first', '--tier', 'light');
  jarl(root, 'new', 'second', '--tier', 'light');
  jarl(root, 'set', '1', 'in-progress', '--branch', 'jarl/1-a', '--worker', 'w1');
  editHeader(root, '1', (t) => t.replace('**Status:** in-progress', '**Status:** done'));
  const status = JSON.parse(jarl(root, 'status', '--json'));
  assert.equal(status.done, 0, 'status does not count the edit as a close');
  assert.equal(status['in-progress'], 1);
  assert.equal(status.inFlight, 1);
  assert.match(jarl(root, 'status'), /open 1 · in flight 1 · done 0/);
  assert.match(jarl(root, 'resume'), /open 1 · in flight 1 · done 0/);
  assert.match(jarl(root, 'resume'), /## In flight \(1\)\n- 1 /);
  assert.match(jarl(root, 'list', '--all'), /1.*in-progress/);
  assert.equal(JSON.parse(jarl(root, 'show', '1', '--json')).status, 'in-progress');
  const next = jarl(root, 'next', '--all');
  assert.doesNotMatch(next, /^1 /m, 'an issue in progress is not offered');
});

test('a removed Branch header does not turn a code issue into one a coordinator may close', () => {
  const root = makeLoop();
  jarl(root, 'new', 'code', '--tier', 'light', '--acceptance', 'it works');
  jarl(root, 'set', '1', 'in-progress', '--branch', 'jarl/1-a', '--worker', 'w1');
  jarl(root, 'evidence', '1', '--ran', 'node --test', '--saw', 'ok');
  editHeader(root, '1', (t) => t.replace(/^\*\*Branch:\*\*.*\n/m, ''));
  jarl(root, 'review', '1', 'approve', '--by', 'jarl', 'the diff was read and holds');
  const refusal = refuses(root, 'set', '1', 'done');
  assert.match(refusal, /carries code \(Branch is recorded\)/);
  assert.match(refusal, /fresh-review rule/);
});

test('a Merged header written by hand does not satisfy a done gate that wants a recorded merge', () => {
  const repo = gitRepo({ branch: 'main' });
  const root = shapedLoop(SHAPES.horde);
  const { id } = R.newIssue(root, 'lands', { repo: repo.dir });
  R.setStatus(root, id, 'running', undefined, { branch: 'jarl/1-a', worker: 'w1' });
  R.addEvidence(root, id, undefined, { ran: 'node --test', saw: 'ok' });
  const sha = repo.g('rev-parse', 'HEAD').trim();
  editHeader(root, id, (t) => t.replace(/^(\*\*Status:\*\*.*)$/m, `$1\n**Merged:** ${sha}`));
  assert.throws(() => R.setStatus(root, id, 'merged', undefined, {}), /records no merge/);
  R.recordMerged(root, id, { sha });
  R.setStatus(root, id, 'merged', undefined, {});
  assert.equal(R.findIssue(root, id).status, 'merged');
});

test('the views of a loop moved only through the tool read the same as the header they replace, and the frozen reader counts the same', () => {
  const root = makeLoop();
  // Filed by the library, so the loop stays format 1 for the frozen reader; the numbers are 001 to 003.
  R.newIssue(root, 'one', { tier: 'light', acceptance: 'a' });
  R.newIssue(root, 'two', { tier: 'light', acceptance: 'a' });
  R.newIssue(root, 'three', { tier: 'light' });
  jarl(root, 'set', '1', 'in-progress', '--branch', 'jarl/1-a', '--worker', 'w1', '--model', 'm1');
  jarl(root, 'set', '2', 'in-progress', '--worker', 'w2');
  jarl(root, 'set', '3', 'deferred', 'later');
  const loop = L.readLoop(R.jarlDir(root));
  for (const issue of loop.issues) assert.deepEqual(issue.onFile, { status: issue.status, ...Object.fromEntries(['branch', 'worker', 'model', 'since', 'merged', 'merge check', 'ci'].map((k) => [k, issue.fields[k] ?? null])) },`${issue.id}: the header and the record agree`);
  assert.ok(oldJarlIsPinned());
  const old = oldJarl(root, 'status', {});
  assert.equal(old.ok, true);
  const now = R.statusData(root);
  for (const key of ['open', 'in-progress', 'done', 'dropped', 'deferred', 'waiting', 'inFlight', 'ready']) assert.equal(old.value[key], now[key], key);
  const rows = (issues) => issues.map((i) => [i.id, i.status, i.fields.branch ?? null, i.fields.worker ?? null]);
  assert.deepEqual(rows(oldJarl(root, 'list', { all: true }).value), rows(L.cmdList(root, { all: true })), 'the frozen reader lists the same issues in the same states');
});

// ---- the report of a header that disagrees -----------------------------------------------------------------

const recordLines = (text) => text.split('\n').filter((l) => l.startsWith('record: '));
// A loop with issue 1 leased, with a model, and merged with its CI green, moved only through the command line.
function leasedAndMerged() {
  const root = makeLoop();
  jarl(root, 'new', 'one', '--tier', 'light', '--acceptance', 'a');
  jarl(root, 'set', '1', 'in-progress', '--branch', 'jarl/1-a', '--worker', 'w1', '--model', 'm1');
  jarl(root, 'merged', '1', '--sha', 'abc1234', '--ci', 'green', '--keep');
  return root;
}

test('a hand edit of Status is reported by status, resume and show as one line that names the log as the record and the commands that settle it', () => {
  const root = makeLoop();
  jarl(root, 'new', 'first', '--tier', 'light');
  jarl(root, 'set', '1', 'in-progress', '--branch', 'jarl/1-a', '--worker', 'w1');
  assert.deepEqual(recordLines(jarl(root, 'status')), [], 'a loop moved through the tool prints no such line');
  assert.equal(JSON.parse(jarl(root, 'status', '--json')).disagreements, undefined);
  editHeader(root, '1', (t) => t.replace('**Status:** in-progress', '**Status:** done'));
  const line = 'record: 1 Status reads done in the file and in-progress in the log, which is the record — to follow the log, write **Status:** in-progress back into the header; to make the file\'s value the record, jarl.mjs set 1 done (a move into done, through its checks)';
  assert.deepEqual(recordLines(jarl(root, 'status')), [line]);
  assert.deepEqual(recordLines(jarl(root, 'resume')), [line]);
  assert.match(jarl(root, 'resume'), /## The files disagree with the log \(1\)\nrecord: 1 /);
  assert.deepEqual(recordLines(jarl(root, 'show', '1')), [line]);
  assert.deepEqual(recordLines(jarl(root, 'show', '1', '--full')), [line]);
  const st = JSON.parse(jarl(root, 'status', '--json'));
  assert.deepEqual(st.disagreements, [{ id: '1', field: 'Status', onFile: 'done', record: 'in-progress', line }]);
  assert.deepEqual(JSON.parse(jarl(root, 'resume', '--json')).disagreements, st.disagreements);
  assert.equal(R.statusData(root).disagreements.length, 1);
  assert.equal(R.resumeData(root).disagreements.length, 1);
});

const CASES = [
  { field: 'Status', edit: (t) => t.replace('**Status:** in-progress', '**Status:** open'), make: ['set', '1', 'open'] },
  { field: 'Branch', edit: (t) => t.replace('**Branch:** jarl/1-a', '**Branch:** jarl/1-b'), make: ['set', '1', 'in-progress', '--branch', 'jarl/1-b'] },
  { field: 'Worker', edit: (t) => t.replace('**Worker:** w1', '**Worker:** w9'), make: ['set', '1', 'in-progress', '--worker', 'w9'] },
  { field: 'Model', edit: (t) => t.replace('**Model:** m1', '**Model:** m2'), make: ['set', '1', 'in-progress', '--model', 'm2'] },
  { field: 'Since', edit: (t) => t.replace(/^\*\*Since:\*\* .*$/m, '**Since:** 2026-01-01 00:00'), make: null },
  { field: 'Merged', edit: (t) => t.replace('**Merged:** abc1234', '**Merged:** deadbeef'), make: ['merged', '1', '--sha', 'deadbeef', '--ci', 'green', '--keep'] },
  { field: 'CI', edit: (t) => t.replace('**CI:** green', '**CI:** red'), make: ['merged', '1', '--ci', 'red'] },
];
for (const c of CASES) {
  test(`a hand edit of ${c.field} is one reported line, and the way to follow the log writes nothing while the way to make the file the record settles it`, () => {
    const root = leasedAndMerged();
    const original = readFileSync(issueFile(root, '1'), 'utf8');
    const logBefore = logLinesOf(root).length;
    editHeader(root, '1', c.edit);
    assert.notEqual(readFileSync(issueFile(root, '1'), 'utf8'), original, 'the edit changed the file');
    const status = recordLines(jarl(root, 'status'));
    assert.equal(status.length, 1, status.join('\n'));
    assert.match(status[0], new RegExp(`^record: 1 ${c.field} (reads .* in the file and .* in the log|is missing)`));
    assert.match(status[0], /which is the record — to follow the log, (write \*\*|remove the )/);
    assert.equal(/to make the file's value the record/.test(status[0]), c.make !== null, 'a field with no command of its own names none');
    // Following the log is a header written back: no command, no line.
    const edited = readFileSync(issueFile(root, '1'), 'utf8');
    writeFileSync(issueFile(root, '1'), original);
    assert.deepEqual(recordLines(jarl(root, 'status')), []);
    assert.equal(logLinesOf(root).length, logBefore, 'the journal gained nothing');
    // Making the file's value the record is the one command the line names, and it leaves nothing else changed.
    if (c.make) {
      writeFileSync(issueFile(root, '1'), edited);
      const printed = /to make the file's value the record, (jarl\.mjs [^(]+?) \(/.exec(status[0])[1];
      assert.deepEqual(printed.split(' ').slice(1), c.make);
      jarl(root, ...c.make);
      assert.deepEqual(recordLines(jarl(root, 'status')), []);
      assert.deepEqual(recordLines(jarl(root, 'resume')), []);
      assert.deepEqual(recordLines(jarl(root, 'show', '1')), []);
      assert.equal(logLinesOf(root).length, logBefore + 1, 'the command wrote its one line');
      if (c.field === 'Merged') assert.equal(headerOf(issueFile(root, '1')).ci, 'green', 'the CI state survived the command');
    }
  });
}

test('an issue the journal holds no filing and no move of is reported as not in the log, and the command named puts it there', () => {
  const root = makeLoop();
  writeFileSync(join(R.jarlDir(root), 'issues', '1-by-hand.md'), '# 1 · by hand\n\n**Status:** open\n**Kind:** bug\n');
  const lines = recordLines(jarl(root, 'status'));
  assert.deepEqual(lines, ['record: 1 is not in the log (it holds no filing and no move), so its header is read as it stands — to put it in the log: jarl.mjs set 1 open']);
  jarl(root, 'set', '1', 'open');
  assert.deepEqual(recordLines(jarl(root, 'status')), []);
});

test('a hand edit of the profile\'s status list is reported: a line that moved an issue into a status the profile does not list reads as a note', () => {
  const root = makeLoop();
  const profile = { 'jarl-profile': 1, name: 'review-loop', statuses: { open: ['dispatchable'], working: ['holds-claim'], review: [], done: ['settles-dependents', 'terminal', 'closes-record'] } };
  const file = join(root, 'p.json');
  writeFileSync(file, JSON.stringify(profile));
  const dir = mkdtempSync(join(tmpdir(), 'jarl-one-store-profile-'));
  mkdirSync(join(dir, '.git'));
  jarl(dir, 'init', 'g', '--profile', file);
  jarl(dir, 'new', 'one', '--tier', 'light');
  jarl(dir, 'set', '1', 'working', '--worker', 'w1');
  jarl(dir, 'set', '1', 'review');
  assert.match(jarl(dir, 'status'), /review 1/);
  const { review, ...rest } = profile.statuses;
  assert.ok(review);
  writeFileSync(join(dir, '.jarl', 'profile.json'), JSON.stringify({ ...profile, statuses: rest }));
  const lines = recordLines(jarl(dir, 'status'));
  assert.equal(lines.filter((l) => /^record: 1 the log moves it into review, which the loop's profile does not list as a status, so the line is read as a note and not as a move/.test(l)).length, 1);
  assert.ok(lines.some((l) => /^record: 1 Status reads review in the file and working in the log/.test(l)), 'the status the file holds against the one the log now reads');
  assert.ok(JSON.parse(jarl(dir, 'status', '--json')).disagreements.some((d) => d.field === 'profile'));
  writeFileSync(join(dir, '.jarl', 'profile.json'), JSON.stringify(profile));
  assert.deepEqual(recordLines(jarl(dir, 'status')), []);
});

test('the same log folds the same in two clones, and clones that merged in opposite directions follow their own log', () => {
  const { dir, g } = gitRepo({ branch: 'main' });
  jarl(dir, 'init', 'g', '--committed');
  jarl(dir, 'new', 'one', '--tier', 'light');
  g('add', '-A'); g('commit', '-qm', 'loop');
  g('checkout', '-q', '-b', 'x');
  jarl(dir, 'set', '1', 'in-progress', '--worker', 'wx');
  g('add', '-A'); g('commit', '-qm', 'x moves it');
  g('checkout', '-q', 'main'); g('checkout', '-q', '-b', 'y');
  jarl(dir, 'set', '1', 'deferred', 'later');
  g('add', '-A'); g('commit', '-qm', 'y moves it');
  const clone = (branch, other) => {
    const c = mkdtempSync(join(tmpdir(), 'jarl-one-store-clone-'));
    sh(c, `git clone -q ${dir} . && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null && git checkout -q ${branch}`);
    sh(c, `git merge -q --no-edit origin/${other} || (git checkout --ours -- .jarl/issues && git add -A && git commit -q --no-edit)`);
    return c;
  };
  const one = clone('x', 'y');
  const two = clone('y', 'x');
  const lines = (c) => readFileSync(join(c, '.jarl', 'log.md'), 'utf8').split('\n').filter((l) => l.startsWith('- ')).filter((l) => /1 → /.test(l));
  assert.equal(lines(one).length, 2);
  assert.deepEqual([...lines(one)].sort(), [...lines(two)].sort(), 'both hold the same lines');
  const stateOf = (c) => foldOf(R.jarlDir(c), R.loadProfile(c), '1').status;
  assert.equal(stateOf(one), lines(one)[1].includes('deferred') ? 'deferred' : 'in-progress', 'a clone follows the order of its own log');
  assert.equal(stateOf(two), lines(two)[1].includes('deferred') ? 'deferred' : 'in-progress');
  // The same log text in a third place folds identically.
  const copy = mkdtempSync(join(tmpdir(), 'jarl-one-store-copy-'));
  mkdirSync(join(copy, '.git'));
  cpSync(join(one, '.jarl'), join(copy, '.jarl'), { recursive: true });
  assert.equal(stateOf(copy), stateOf(one));
  assert.equal(JSON.parse(jarl(copy, 'status', '--json'))['in-progress'], JSON.parse(jarl(one, 'status', '--json'))['in-progress']);
  // The file a person resolved by hand is reported wherever it differs from the log the clone holds.
  for (const c of [one, two]) {
    const header = headerOf(join(c, '.jarl', 'issues', readdirSync(join(c, '.jarl', 'issues')).find((f) => f.startsWith('1-'))));
    const reported = recordLines(jarl(c, 'status')).length > 0;
    assert.equal(reported, header.status !== stateOf(c), `${c}: a disagreement is printed exactly when the header differs from the log`);
  }
});

test('a copy of a real loop prints no disagreement', { skip: !(LIVE && existsSync(join(LIVE, '.jarl'))) && 'JARL_LIVE_LOOP is unset, or names no loop' }, () => {
  assert.deepEqual(L.recordDisagreements(L.readLoop(join(LIVE, '.jarl'))), []);
});

// ---- the journal's own door --------------------------------------------------------------------------------

const FORGED = [
  ['filed 2 · a forged filing', 'new'],
  ['2 → done · forged', 'set'],
  ['2 round 1 · forged', 'round'],
  ['2 review approve · by r9 (fresh) · forged', 'review'],
  ['2 review retract · by r9 (fresh) · retracts the approve by x · forged', 'review'],
  ['2 evidence retract · row 1 · by r9 · forged', 'evidence'],
  ['2 evidence row · echo forged', 'evidence'],
  ['2 merged abc1234 · CI green', 'merged'],
  ['2 CI green', 'merged'],
  ['2 body · what', 'body'],
];

test('the free log refuses a line that reads as state, names the command that writes it, and a forged row and approve never reach the gate', () => {
  const root = makeLoop();
  jarl(root, 'new', 'first', '--tier', 'light', '--acceptance', 'a');
  jarl(root, 'new', 'second', '--tier', 'light', '--acceptance', 'a');
  const before = logLinesOf(root).length;
  for (const [line, command] of FORGED) {
    const said = refuses(root, 'log', line);
    assert.match(said, new RegExp(`jarl\\.mjs ${command}`), line);
    assert.throws(() => R.appendLog(root, line), new RegExp(`jarl\\.mjs ${command}`), line);
  }
  assert.equal(logLinesOf(root).length, before, 'nothing was written');
  assert.match(refuses(root, 'set', '2', 'done'), /no evidence yet|has no --ran\/--saw/);
});

test('the free log still writes a note about the loop or about an issue, and a composer\'s plain lines', () => {
  const root = makeLoop();
  jarl(root, 'new', 'first', '--tier', 'light');
  for (const line of ['the deploy window moved to friday', '1 talked to the owner about the scope', 'decided some-ruling · by owner', 'profile brought up to this orchestrator\'s: added initial', 'a-1 answered by the owner', '1 field Resources · gate']) {
    jarl(root, 'log', line);
    assert.deepEqual(R.appendLog(root, line), { logged: line });
  }
  assert.equal(logLinesOf(root).filter((l) => l.includes('the deploy window moved to friday')).length, 2);
});

test('a composer cannot write the journal whole through writeAtomic, and writes any other file of the loop', () => {
  const root = makeLoop();
  const log = join(R.jarlDir(root), 'log.md');
  const text = readFileSync(log, 'utf8');
  assert.throws(() => R.writeAtomic(log, '# Log\n'), /is the loop's journal: it is appended to/);
  assert.equal(readFileSync(log, 'utf8'), text, 'the journal stands');
  const other = join(root, 'a-log-of-another-tool', 'log.md');
  mkdirSync(join(root, 'a-log-of-another-tool'));
  R.writeAtomic(other, 'x\n');
  assert.equal(readFileSync(other, 'utf8'), 'x\n', 'a file of that name outside a loop is any file');
  R.writeAtomic(join(R.jarlDir(root), 'decisions.md'), '# Decisions\n');
});

// ---- a composer's flow through the record operations alone -------------------------------------------------

test('a composer that moves tickets with the record operations and edits its own ticket fields under the lock reads the same in every view and the gate', () => {
  const repo = gitRepo({ branch: 'main' });
  const root = shapedLoop(SHAPES.horde);
  const dir = R.jarlDir(root);
  const a = R.newIssue(root, 'lands on main', { repo: repo.dir }).id;
  const b = R.newIssue(root, 'waits in the queue', { repo: repo.dir }).id;
  const c = R.newIssue(root, 'is sent back', { repo: repo.dir }).id;
  R.setStatus(root, a, 'queued', undefined, {});
  R.setStatus(root, a, 'running', undefined, { branch: 'jarl/a', worker: 'w1', model: 'm1' });
  R.addEvidence(root, a, undefined, { ran: 'node --test', saw: 'ok' });
  R.recordMerged(root, a, { sha: repo.g('rev-parse', 'HEAD').trim() });
  R.setStatus(root, a, 'merged', undefined, {});
  R.setStatus(root, b, 'queued', undefined, {});
  R.setStatus(root, c, 'running', undefined, { branch: 'jarl/c', worker: 'w2' });
  R.addRound(root, c, 'the check was red');
  // The composer's own edit of its own ticket fields, as its editTicket does: under the lock, whole file, no line of the journal.
  const edit = (id, fn) => R.withLock(root, () => { const file = issueFile(root, id); R.writeAtomic(file, fn(readFileSync(file, 'utf8'))); });
  const logBefore = logLinesOf(root).length;
  edit(b, (t) => t.replace('\n## ', '\n**Team:** platform\n\n## '));
  edit(b, (t) => t.replace(/^\*\*Files:\*\*.*$/m, '**Files:** a.txt, b.txt'));
  assert.equal(logLinesOf(root).length, logBefore, 'the edit wrote no line');
  const agree = () => {
    const loop = L.readLoop(dir);
    const status = R.statusData(root);
    const resume = R.resumeData(root);
    for (const issue of loop.issues) {
      const g = L.gateOf(loop, issue.id);
      assert.equal(g.tracked, true, `${issue.id} is held by the journal`);
      assert.equal(issue.status, foldOf(dir, loop.profile, issue.id).status, `${issue.id}: the view and the fold read one status`);
      assert.deepEqual(R.findIssue(root, issue.id).fields, issue.fields);
    }
    const byStatus = {};
    for (const issue of loop.issues) byStatus[issue.status] = (byStatus[issue.status] || 0) + 1;
    for (const [name, n] of Object.entries(status.statuses)) assert.equal(n, byStatus[name] || 0, `status counts ${name} as the issues read`);
    assert.equal(status.inFlight, loop.issues.filter((i) => loop.profile.is(i.status, 'holds-claim')).length);
    assert.deepEqual(resume.inFlight.map((x) => x.id), loop.issues.filter((i) => loop.profile.is(i.status, 'holds-claim')).map((i) => i.id));
    assert.deepEqual(status.closedGate, [], 'the closed ticket holds its gate');
    return { status, resume };
  };
  const first = agree();
  assert.equal(first.status.disagreements, undefined, 'a write of a field the journal does not hold is no disagreement');
  assert.equal(first.resume.disagreements, undefined);
  assert.equal(R.findIssue(root, b).fields.files, 'a.txt, b.txt');
  assert.match(readFileSync(issueFile(root, b), 'utf8'), /\*\*Team:\*\* platform/);
  // The composer writes a status into a ticket's text: the views keep the status of the journal and say so.
  edit(b, (t) => t.replace('**Status:** queued', '**Status:** merged'));
  const second = agree();
  assert.equal(second.status.disagreements.length, 1);
  assert.equal(second.status.disagreements[0].field, 'Status');
  assert.equal(second.status.statuses.merged, 1, 'the edit moved no count');
  assert.equal(R.findIssue(root, b).status, 'queued');
});

// ---- a move line is read by position ------------------------------------------------------------------------

test('a reason is never searched for lease fields: reasons that open with a field name, hold the separator or name a branch give the values the command wrote', () => {
  const root = makeLoop();
  const cases = [
    { reason: 'branch work starts today', flags: [], want: { branch: null, worker: null } },
    { reason: 'branch fix', flags: ['--branch', 'jarl/1-a'], want: { branch: 'jarl/1-a', worker: null } },
    { reason: 'branch fix', flags: ['--worker', 'w1'], want: { branch: null, worker: 'w1' } },
    { reason: 'worker raised', flags: [], want: { branch: null, worker: null } },
    { reason: 'worker raised in tool', flags: ['--branch', 'jarl/2-b', '--worker', 'w2'], want: { branch: 'jarl/2-b', worker: 'w2' } },
    { reason: 'model swap needed', flags: ['--model', 'm1'], want: { branch: null, worker: null, model: 'm1' } },
    { reason: 'see the note · branch other', flags: ['--branch', 'jarl/3-c', '--worker', 'w3'], want: { branch: 'jarl/3-c', worker: 'w3' } },
    { reason: 'on branch tools-misc: first slice', flags: ['--worker', 'w4'], want: { branch: null, worker: 'w4' } },
  ];
  for (const c of cases) {
    const { id } = R.newIssue(root, `reason ${c.reason}`);
    jarl(root, 'set', id, 'in-progress', c.reason, ...c.flags);
    const state = foldOf(R.jarlDir(root), R.loadProfile(root), id);
    assert.equal(state.branch, c.want.branch, `${c.reason}: branch`);
    assert.equal(state.worker, c.want.worker, `${c.reason}: worker`);
    if (c.want.model) assert.equal(state.model, c.want.model);
    assert.deepEqual(state, headerOf(issueFile(root, id)), `${c.reason}: the fold equals the header`);
  }
  assert.deepEqual(recordLines(jarl(root, 'status')), []);
  const wt = join(root, 'a · branch b');
  const { id } = R.newIssue(root, 'a worktree path with the separator');
  jarl(root, 'set', id, 'in-progress', 'go', '--branch', 'jarl/9-z', '--worker', 'w9', '--worktree', wt);
  assert.equal(foldOf(R.jarlDir(root), R.loadProfile(root), id).branch, 'jarl/9-z');
  assert.equal(foldOf(R.jarlDir(root), R.loadProfile(root), id).worker, 'w9');
});

test('move lines in the shapes real loops hold read by position', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-one-store-shapes-'));
  mkdirSync(join(dir, 'issues'));
  writeFileSync(join(dir, 'log.md'), [
    '# Log', '',
    '- 2026-10-01 09:00 · filed 5 · a',
    '- 2026-10-01 09:01 · 5 → in-progress · worker w5-gates claims gates, regression, fingerprint · branch w5-gates · worker w5-gates',
    '- 2026-10-01 09:02 · filed 010 · b',
    '- 2026-10-01 09:03 · 010 → in-progress · w3-text on branch w3-text · branch w3-text · worker w3-text',
    '- 2026-10-01 09:04 · filed 011 · c',
    '- 2026-10-01 09:05 · 011 → in-progress · on branch tools-misc: slice one · model m@high · worker w-x · worktree /p',
    '- 2026-10-01 09:06 · filed 013 · d',
    '- 2026-10-01 09:07 · 013 → in-progress · worker on branch threads-import builds the notes import, the rail and tests',
    '- 2026-10-01 09:08 · filed 014 · e',
    '- 2026-10-01 09:09 · 014 → in-progress · branch fix-picture · worker claude-opus-5-5 fix-picture · worktree /p',
  ].join('\n') + '\n');
  const profile = L.DEFAULT_PROFILE;
  const by = L.eventsById(L.loopEvents(dir, profile));
  assert.deepEqual([L.issueState(profile, by.get('5')).branch, L.issueState(profile, by.get('5')).worker], ['w5-gates', 'w5-gates']);
  assert.deepEqual([L.issueState(profile, by.get('010')).branch, L.issueState(profile, by.get('010')).worker], ['w3-text', 'w3-text']);
  const s = L.issueState(profile, by.get('011'));
  assert.deepEqual([s.branch, s.worker, s.model], [null, 'w-x', 'm@high']);
  assert.equal(L.issueState(profile, by.get('013')).worker, null, 'a sentence that opens with "worker" is a reason');
  assert.equal(L.issueState(profile, by.get('014')).worker, 'claude-opus-5-5 fix-picture', 'a worker name may hold a space');
});

// ---- what is written into the lease reads back unchanged -----------------------------------------------------

const NASTY = ['w1', 'w x', 'w,x', 'm,1', 'a b', 'a\nb', 'a · b', ' padded ', '(reason)', 'branch x', 'worker', 'ünï', 'q"q', "q'q", '**b**', 'jarl/1-a', 'a..b', 'a~b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', 'x.lock', '.hidden', 'a//b', '/a', 'a/', 'a.', '-a', '@', 'a@{b', 'm@high', 'a;b', 'a\tb'];
for (const flag of ['worker', 'model', 'branch']) {
  test(`every ${flag} value the command accepts reads back identical from the log and from the header, and every one it refuses writes nothing`, () => {
    const root = makeLoop();
    const dir = R.jarlDir(root);
    const profile = R.loadProfile(root);
    let accepted = 0; let refused = 0;
    for (const value of NASTY) {
      const { id } = R.newIssue(root, `lease ${flag}`);
      const logBefore = logLinesOf(root).length;
      const fileBefore = readFileSync(issueFile(root, id), 'utf8');
      let wrote = true;
      try { R.setStatus(root, id, 'in-progress', 'taking it', { [flag]: value }); } catch { wrote = false; }
      if (wrote) {
        accepted += 1;
        const state = foldOf(dir, profile, id);
        assert.equal(state[flag], fieldTextOf(value), `${JSON.stringify(value)}: the log gives it back`);
        assert.deepEqual(state, headerOf(issueFile(root, id)), `${JSON.stringify(value)}: the header agrees with the log`);
      } else {
        refused += 1;
        assert.equal(logLinesOf(root).length, logBefore, `${JSON.stringify(value)}: nothing in the journal`);
        assert.equal(readFileSync(issueFile(root, id), 'utf8'), fileBefore, `${JSON.stringify(value)}: nothing in the file`);
      }
    }
    assert.ok(accepted > 0 && refused > 0, 'some values are taken and some refused');
    assert.deepEqual(recordLines(jarl(root, 'status')), []);
  });
}
const fieldTextOf = (v) => String(v).replace(/\s+/g, ' ').trim();

test('the refusals name the flag and the rule, and a worktree path reads back whatever it holds', () => {
  const root = makeLoop();
  const { id } = R.newIssue(root, 'refusals');
  assert.match(refuses(root, 'set', id, 'in-progress', '--worker', 'w,x'), /--worker "w,x" holds a comma/);
  assert.match(refuses(root, 'set', id, 'in-progress', '--model', 'm,1'), /--model "m,1" holds a comma/);
  assert.match(refuses(root, 'set', id, 'in-progress', '--branch', 'a b'), /--branch "a b" is not a branch name git accepts/);
  assert.match(refuses(root, 'set', id, 'in-progress', '--branch', 'a\nb'), /--branch .*more than one line/);
  const wt = join(root, 'path · with · seps');
  jarl(root, 'set', id, 'in-progress', '--branch', 'jarl/1-a', '--worker', 'w1', '--model', 'm1', '--worktree', wt);
  const state = foldOf(R.jarlDir(root), R.loadProfile(root), id);
  assert.deepEqual([state.branch, state.worker, state.model], ['jarl/1-a', 'w1', 'm1']);
  assert.equal(R.findIssue(root, id).fields.worktree, wt);
  assert.deepEqual(state, headerOf(issueFile(root, id)));
});

test('a branch with a space is refused, so a coordinator approve cannot close an issue that carries it', () => {
  const root = makeLoop();
  jarl(root, 'new', 'code', '--tier', 'light', '--acceptance', 'it works');
  refuses(root, 'set', '1', 'in-progress', '--branch', 'a b', '--worker', 'w1');
  assert.equal(R.findIssue(root, '1').status, 'open');
  assert.equal(R.findIssue(root, '1').fields.branch, undefined);
});

// ---- free text next to a field is never read as one -----------------------------------------------------------

// Texts over an alphabet of the separator, a space, the names of the lease fields and a letter, up to length 8, drawn by a
// seeded generator; the cases that matter by name come first.
function alphabetTexts(count, extra = []) {
  const tokens = ['·', ' ', 'branch', 'worker', 'model', 'worktree', 'x'];
  let seed = 20261019;
  const next = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const out = [...extra];
  for (let i = 0; i < count; i += 1) {
    let text = '';
    for (let n = 1 + next(8); n > 0; n -= 1) text += tokens[next(tokens.length)];
    out.push(text);
  }
  return out;
}
const reasonModuloReplacement = (why) => String(why).replace(/\s*·\s*/g, ' - ').trim();

test('a reason over the alphabet of separators, spaces and field names never reads as a lease field, and reads back as the same text modulo the replacement', () => {
  const root = makeLoop();
  const dir = R.jarlDir(root);
  const profile = R.loadProfile(root);
  const texts = alphabetTexts(300, ['a · · branch evil', 'x ·  · worker evil', ' ·  ·  · model evil', 'branch evil', 'worker raised', '(reason)', 'branch x · (reason)']);
  for (const why of texts) {
    for (const flags of [{}, { branch: 'jarl/1-a', worker: 'w1', model: 'm1' }]) {
      const { id } = R.newIssue(root, 'reason');
      R.setStatus(root, id, 'in-progress', why, flags);
      const move = L.loopEvents(dir, profile).filter((e) => e.id === id && e.type === 'move').pop();
      const state = foldOf(dir, profile, id);
      assert.deepEqual([state.branch, state.worker, state.model], [flags.branch ?? null, flags.worker ?? null, flags.model ?? null], `${JSON.stringify(why)} ${JSON.stringify(flags)}`);
      assert.equal(L.leaseOfMove(move.text, id, 'in-progress').reason, reasonModuloReplacement(why), `${JSON.stringify(why)}: the reason reads back`);
    }
  }
  assert.deepEqual(recordLines(jarl(root, 'status')), []);
});

test('a note the free log accepts over the same alphabet is read as a note, and never changes an issue', () => {
  const root = makeLoop();
  const { id } = R.newIssue(root, 'notes');
  R.setStatus(root, id, 'in-progress', undefined, { branch: 'jarl/1-a', worker: 'w1' });
  const dir = R.jarlDir(root);
  const profile = R.loadProfile(root);
  const before = foldOf(dir, profile, id);
  const accepted = [];
  for (const body of alphabetTexts(300, [`${id} → x · branch evil`])) {
    for (const prefix of ['', `${id} `, `${id} → `, `filed ${id} `, `${id} merged `]) {
      try { R.appendLog(root, `${prefix}${body}`); accepted.push(`${prefix}${body}`.replace(/\s+/g, ' ').trim()); } catch { /* refused */ }
    }
  }
  assert.ok(accepted.length > 100);
  const events = L.loopEvents(dir, profile).filter((e) => accepted.includes(e.text));
  assert.ok(events.length > 0);
  assert.deepEqual([...new Set(events.map((e) => e.type))], ['other']);
  assert.deepEqual(foldOf(dir, profile, id), before);
});

test('findings and the reason of a round over the same alphabet are never read as a mark or a field', () => {
  const root = makeLoop();
  const { id } = R.newIssue(root, 'verdicts');
  R.setStatus(root, id, 'in-progress', undefined, { branch: 'jarl/1-a', worker: 'w1' });
  const dir = R.jarlDir(root);
  const profile = R.loadProfile(root);
  const before = foldOf(dir, profile, id);
  for (const tail of alphabetTexts(120, ['relayed · x', 'model m9 · x', 'Relayed', ' · relayed', 'model'])) {
    for (const model of [undefined, 'm1']) {
      R.review(root, id, 'changes', `Important: one two three ${tail}`, { by: 'rev-x', ...(model ? { model } : {}) });
      const e = L.loopEvents(dir, profile).filter((x) => x.id === id && x.type === 'verdict').pop();
      assert.deepEqual([e.verdict, e.by, e.kind, e.model, e.relayed], ['changes', 'rev-x', 'fresh', model ?? null, false], JSON.stringify(tail));
    }
    R.review(root, id, 'changes', `${tail}\nImportant: one two three`, { by: 'rev-x' });
    const f = L.loopEvents(dir, profile).filter((x) => x.id === id && x.type === 'verdict').pop();
    assert.deepEqual([f.verdict, f.by, f.model, f.relayed], ['changes', 'rev-x', null, false], `${JSON.stringify(tail)} first`);
    R.addRound(root, id, tail);
    const r = L.loopEvents(dir, profile).filter((x) => x.id === id).pop();
    assert.equal(r.type, 'round', JSON.stringify(tail));
  }
  assert.deepEqual(foldOf(dir, profile, id), before);
});

// ---- the header rewrite says what it does ---------------------------------------------------------------------

test('set --header says it rewrote a header and moved nothing, and refuses an unknown or a missing status in its own words', () => {
  const root = makeLoop();
  jarl(root, 'new', 'one', '--tier', 'light');
  jarl(root, 'set', '1', 'in-progress', '--worker', 'w1');
  assert.equal(jarl(root, 'set', '1', 'in-progress', '--header'), 'header of 1 rewritten from the log: in-progress');
  const unknown = refuses(root, 'set', '1', 'bogus', '--header');
  assert.match(unknown, /bogus is not a status this loop's profile lists/);
  assert.doesNotMatch(unknown, /moves it|undefined/);
  const missing = refuses(root, 'set', '1', '--header');
  assert.match(missing, /name the status the log holds/);
  assert.doesNotMatch(missing, /undefined/);
});

test('a phantom lease is not read from a reason: the units of a loop with such reasons are the leases the commands wrote', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-one-store-units-'));
  mkdirSync(join(dir, 'issues'));
  writeFileSync(join(dir, 'log.md'), [
    '# Log', '',
    '- 2026-10-01 09:00 · filed 012 · a',
    '- 2026-10-01 09:01 · 012 → in-progress · worker did 013, 014, 015, 012 in one pass; awaiting fresh reviewer',
    '- 2026-10-01 09:02 · filed 021 · b',
    '- 2026-10-01 09:03 · 021 → in-progress · worker on branch fix-toolbox · branch fix-toolbox · worktree /p',
  ].join('\n') + '\n');
  const by = L.eventsById(L.loopEvents(dir, L.DEFAULT_PROFILE));
  for (const id of ['012', '021']) assert.equal(by.get(id).find((e) => e.type === 'move').lease, null, `${id}: no worker was named, so no lease and no unit`);
  assert.equal(L.issueState(L.DEFAULT_PROFILE, by.get('021')).branch, 'fix-toolbox');
});

// ---- a note cannot make a disagreement nothing settles --------------------------------------------------------

test('the free log refuses an id and an arrow whatever follows, and a note of that shape already in a log is no disagreement', () => {
  const root = makeLoop();
  jarl(root, 'new', 'one', '--tier', 'light');
  for (const line of ['1 → see 3 for context', '1 → DONE', '1 →nowhere']) {
    assert.match(refuses(root, 'log', line), /has the shape of a move.*jarl\.mjs set <ids> <status>/, line);
    assert.throws(() => R.appendLog(root, line), /shape of a move/);
  }
  appendFileSync(join(R.jarlDir(root), 'log.md'), '- 2026-10-01 09:00 · 1 → see 3 for context\n- 2026-10-01 09:01 · 1 → DONE\n');
  assert.deepEqual(recordLines(jarl(root, 'status')), []);
  assert.equal(JSON.parse(jarl(root, 'status', '--json')).disagreements, undefined);
});

// ---- the header from the log ----------------------------------------------------------------------------------

test('a bulk set that stopped after its journal lines is repaired by set --header, which writes no line and keeps the moves', { skip: asRoot && 'a writer running as root is not stopped by a closed directory' }, () => {
  const root = makeLoop();
  const ids = ['one', 'two'].map((t) => R.newIssue(root, t).id);
  withIssuesDirClosed(root, () => assert.throws(() => R.setStatus(root, ids.join(','), 'in-progress', undefined, { branch: 'jarl/1-a', worker: 'w1' })));
  const lines = recordLines(jarl(root, 'status'));
  assert.ok(lines.length >= ids.length, 'each issue is reported');
  const shown = jarl(root, 'status');
  assert.match(shown, /jarl\.mjs set 001 in-progress --header \(writes the header from the log\)/);
  const before = logLinesOf(root).length;
  jarl(root, 'set', ids.join(','), 'in-progress', '--header');
  assert.equal(logLinesOf(root).length, before, 'no second journal line');
  assert.deepEqual(recordLines(jarl(root, 'status')), []);
  for (const id of ids) {
    assert.equal(R.findIssue(root, id).status, 'in-progress', 'the recorded move stands');
    assert.deepEqual(foldOf(R.jarlDir(root), R.loadProfile(root), id), headerOf(issueFile(root, id)));
  }
  assert.match(refuses(root, 'set', '1', 'open', '--header'), /is in-progress in the log/);
  assert.match(refuses(root, 'set', '1', 'in-progress', 'a reason', '--header'), /takes no reason/);
});

test('set --header on an issue the log does not hold is refused, naming the command that puts it there', () => {
  const root = makeLoop();
  writeFileSync(join(R.jarlDir(root), 'issues', '1-by-hand.md'), '# 1 · by hand\n\n**Status:** open\n');
  assert.match(refuses(root, 'set', '1', 'open', '--header'), /is not in the log.*jarl\.mjs set 1 open/);
});

test('the guard on the journal compares its name without case', () => {
  const root = makeLoop();
  assert.throws(() => R.writeAtomic(join(R.jarlDir(root), 'LOG.md'), 'x\n'), /is the loop's journal/);
});

test('a second filing line for an issue resets neither its status nor the window of the gate', () => {
  const root = makeLoop();
  const { id } = R.newIssue(root, 'filed twice');
  R.setStatus(root, id, 'in-progress', undefined, { worker: 'w1' });
  R.addEvidence(root, id, undefined, { ran: 'node --test', saw: 'ok' });
  const dir = R.jarlDir(root);
  const rowsBefore = L.gateOf(L.readLoop(dir), id).rowsSince;
  appendFileSync(join(dir, 'log.md'), `- 2026-10-19 10:00 · filed ${id} · filed twice\n`);
  assert.equal(R.findIssue(root, id).status, 'in-progress');
  assert.equal(L.gateOf(L.readLoop(dir), id).rowsSince, rowsBefore, 'the row still counts');
  assert.equal(foldOf(dir, R.loadProfile(root), id).status, 'in-progress');
  assert.equal(L.loopEvents(dir, R.loadProfile(root)).filter((e) => e.type === 'move').pop().from, 'open');
});

// ---- the words ----------------------------------------------------------------------------------------------

test('the skill says once which store is the record, and the help of the commands that print or refuse says the same', () => {
  const skill = readFileSync(new URL('../../SKILL.md', import.meta.url), 'utf8');
  assert.equal(skill.split('**The log is the record, and one tool moves it**').length - 1, 1, 'the source is stated once');
  assert.match(skill, /^### When a header disagrees with the log$/m);
  for (const part of ['A Branch the log has recorded cannot be cleared', 'In a committed loop', 'an audit of the change, and nothing reads them as state', 'a hand edit of a profile\'s status list'.replace('a hand', 'A hand')]) assert.ok(skill.includes(part), part);
  const out = spawnJarl(makeLoop(), ['--help']);
  const help = `${out.stdout}${out.stderr}`;
  assert.match(help, /the log is the record of an issue's status, lease, merge and CI/);
  assert.match(help, /a line that reads as a filing, a move,/);
});

// ---- one stamp, and the line before the file ------------------------------------------------------------------

// A clock that moves two minutes at every reading, so two readings of "now" in one call cannot fall in the same minute.
function withRacingClock(fn) {
  const RealDate = Date;
  let t = RealDate.parse('2026-10-19T10:00:00Z');
  globalThis.Date = class extends RealDate {
    constructor(...args) { if (args.length) super(...args); else { super(t); t += 120_000; } }
    static now() { return t; }
  };
  try { return fn(); } finally { globalThis.Date = RealDate; }
}
function logLinesOf(root) { return readFileSync(join(R.jarlDir(root), 'log.md'), 'utf8').split('\n').filter((l) => l.startsWith('- ')); }

test('the Since of a lease and the stamp of its journal line are one reading of the clock', () => {
  const root = makeLoop();
  const { id } = R.newIssue(root, 'one stamp');
  withRacingClock(() => R.setStatus(root, id, 'in-progress', undefined, { branch: 'jarl/1-a', worker: 'w1' }));
  const issue = R.findIssue(root, id);
  const line = logLinesOf(root).find((l) => l.includes(`${id} → in-progress`));
  assert.equal(line.slice(2, 18), issue.fields.since, 'the header and the line carry the same minute');
  const dir = R.jarlDir(root);
  const profile = R.loadProfile(root);
  assert.equal(foldOf(dir, profile, id).since, headerOf(issue.file).since);
});


test('set writes the journal line before the file: a write that stops leaves the record ahead of the file', { skip: asRoot && 'a writer running as root is not stopped by a closed directory' }, () => {
  const root = makeLoop();
  const { id } = R.newIssue(root, 'crash in set');
  withIssuesDirClosed(root, () => assert.throws(() => R.setStatus(root, id, 'in-progress', undefined, { branch: 'jarl/1-a', worker: 'w1' })));
  assert.ok(logLinesOf(root).some((l) => l.includes(`${id} → in-progress`)), 'the line is in the journal');
  assert.equal(headerOf(issueFile(root, id)).status, 'open', 'the file was not reached');
  const dir = R.jarlDir(root);
  assert.equal(foldOf(dir, R.loadProfile(root), id).status, 'in-progress', 'the record is ahead of the file, not behind it');
});

test('merged writes the journal line before the file', { skip: asRoot && 'a writer running as root is not stopped by a closed directory' }, () => {
  const root = makeLoop();
  const { id } = R.newIssue(root, 'crash in merged');
  withIssuesDirClosed(root, () => assert.throws(() => R.recordMerged(root, id, { sha: 'abc1234', ci: 'green' })));
  assert.ok(logLinesOf(root).some((l) => l.includes(`${id} merged abc1234`)));
  assert.equal(headerOf(issueFile(root, id)).merged, null);
  assert.equal(foldOf(R.jarlDir(root), R.loadProfile(root), id).merged, 'abc1234');
});

test('new writes the filing line before the file is created, and a stopped filing leaves a line and no file', () => {
  const root = makeLoop();
  const real = fs.linkSync;
  fs.linkSync = () => { throw Object.assign(new Error('stopped'), { code: 'EIO' }); };
  syncBuiltinESMExports();
  try { assert.throws(() => R.newIssue(root, 'crash in new'), /stopped/); } finally { fs.linkSync = real; syncBuiltinESMExports(); }
  assert.ok(logLinesOf(root).some((l) => l.includes('filed 001 · crash in new')), 'the filing is in the journal');
  assert.deepEqual(readdirSync(join(R.jarlDir(root), 'issues')).filter((f) => f.endsWith('.md')), [], 'no file was created');
  const again = R.newIssue(root, 'crash in new');
  assert.equal(again.id, '001', 'the number is taken again');
});
