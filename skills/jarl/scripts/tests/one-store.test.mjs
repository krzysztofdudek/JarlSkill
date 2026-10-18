// One store of state. The journal (log.md) is the record of an issue's status, lease, merge and CI; the header fields
// of the issue file are the tool's rendering of it, written in the same call. These tests hold the fold that derives the
// state from the journal against the header the commands write, the views and the gate that read the fold, the report of
// a header that disagrees, the refusal of event-shaped lines by the free log, and a composer's flow through the record
// operations alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as R from '../record.mjs';
import { gitRepo, jarl, loop as makeLoop, refuses } from './helpers.mjs';
import { oldJarl, oldJarlIsPinned } from './old-jarl.mjs';

const L = await import('../jarl-lib.mjs');

const RENDERED = ['status', 'branch', 'worker', 'model', 'since', 'merged', 'ci'];
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
  writeFileSync(join(dir, 'issues', '001-by-hand.md'), '# 001 · by hand\n\n**Status:** in-progress\n**Branch:** b\n');
  assert.equal(foldOf(dir, profile, '001'), null);
  writeFileSync(join(dir, 'log.md'), '# Log\n\n- 2026-10-01 09:00 · 001 merged abc1234 · CI green\n- 2026-10-01 09:01 · 001 CI red\n');
  assert.equal(foldOf(dir, profile, '001'), null, 'merge and CI lines alone do not hold an issue');
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
  editHeader(root, '001', (t) => t.replace('**Status:** in-progress', '**Status:** done'));
  const status = JSON.parse(jarl(root, 'status', '--json'));
  assert.equal(status.done, 0, 'status does not count the edit as a close');
  assert.equal(status['in-progress'], 1);
  assert.equal(status.inFlight, 1);
  assert.match(jarl(root, 'status'), /open 1 · in flight 1 · done 0/);
  assert.match(jarl(root, 'resume'), /open 1 · in flight 1 · done 0/);
  assert.match(jarl(root, 'resume'), /## In flight \(1\)\n- 001 /);
  assert.match(jarl(root, 'list', '--all'), /001.*in-progress/);
  assert.equal(JSON.parse(jarl(root, 'show', '1', '--json')).status, 'in-progress');
  const next = jarl(root, 'next', '--all');
  assert.doesNotMatch(next, /^001 /m, 'an issue in progress is not offered');
});

test('a removed Branch header does not turn a code issue into one a coordinator may close', () => {
  const root = makeLoop();
  jarl(root, 'new', 'code', '--tier', 'light', '--acceptance', 'it works');
  jarl(root, 'set', '1', 'in-progress', '--branch', 'jarl/1-a', '--worker', 'w1');
  jarl(root, 'evidence', '1', '--ran', 'node --test', '--saw', 'ok');
  editHeader(root, '001', (t) => t.replace(/^\*\*Branch:\*\*.*\n/m, ''));
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
  jarl(root, 'new', 'one', '--tier', 'light', '--acceptance', 'a');
  jarl(root, 'new', 'two', '--tier', 'light', '--acceptance', 'a');
  jarl(root, 'new', 'three', '--tier', 'light');
  jarl(root, 'set', '1', 'in-progress', '--branch', 'jarl/1-a', '--worker', 'w1', '--model', 'm1');
  jarl(root, 'set', '2', 'in-progress', '--worker', 'w2');
  jarl(root, 'set', '3', 'deferred', 'later');
  const loop = L.readLoop(R.jarlDir(root));
  for (const issue of loop.issues) assert.deepEqual(issue.onFile, { status: issue.status, ...Object.fromEntries(['branch', 'worker', 'model', 'since', 'merged', 'ci'].map((k) => [k, issue.fields[k] ?? null])) }, `${issue.id}: the header and the record agree`);
  assert.ok(oldJarlIsPinned());
  const old = oldJarl(root, 'status', {});
  assert.equal(old.ok, true);
  const now = R.statusData(root);
  for (const key of ['open', 'in-progress', 'done', 'dropped', 'deferred', 'waiting', 'inFlight', 'ready']) assert.equal(old.value[key], now[key], key);
  const rows = (issues) => issues.map((i) => [i.id, i.status, i.fields.branch ?? null, i.fields.worker ?? null]);
  assert.deepEqual(rows(oldJarl(root, 'list', { all: true }).value), rows(L.cmdList(root, { all: true })), 'the frozen reader lists the same issues in the same states');
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

const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
// Runs fn with the issues directory of the loop closed to writing (a file cannot be created or replaced in it).
function withIssuesDirClosed(root, fn) {
  const dir = join(R.jarlDir(root), 'issues');
  chmodSync(dir, 0o555);
  try { return fn(); } finally { chmodSync(dir, 0o755); }
}

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
