// One store of state. The journal (log.md) is the record of an issue's status, lease, merge and CI; the header fields
// of the issue file are the tool's rendering of it, written in the same call. These tests hold the fold that derives the
// state from the journal against the header the commands write, the views and the gate that read the fold, the report of
// a header that disagrees, the refusal of event-shaped lines by the free log, and a composer's flow through the record
// operations alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as R from '../record.mjs';
import { gitRepo, jarl, loop as makeLoop } from './helpers.mjs';

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
