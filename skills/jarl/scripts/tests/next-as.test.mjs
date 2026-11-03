// next --as <holder>: what is on the owner, the jarl, a named coordinator or a named person, derived from the record —
// the status flags of the loop's profile, the verdicts, the questions and the rulings — with the command that moves each
// line; and status --as and resume --as, which end with the same list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FINDINGS } from './findings.mjs';
import { jarl, refuses, loop as makeLoop } from './helpers.mjs';
import * as R from '../record.mjs';

const loop = (initFlags = []) => makeLoop({ prefix: 'jarl-as-', via: 'cli', dotGit: false, initFlags });
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const IMPORTANT = 'Important: the empty list is not handled';

// One loop with an issue at every step: ready, with its worker, proof and no verdict, changes asked, approved, merged;
// issues waiting on After; a question on an issue, and an item to ratify.
function stepsLoop() {
  const root = loop();
  const titles = ['ready one', 'with a worker', 'proof no verdict', 'changes asked', 'approved', 'merged'];
  titles.forEach((t, n) => jarl(root, 'new', t, '--files', `f${n + 1}.mjs`));        // 1-6
  jarl(root, 'new', 'waits on the ready one', '--after', '1', '--files', 'f7.mjs');   // 7
  jarl(root, 'new', 'asked about', '--files', 'f8.mjs');                              // 8
  jarl(root, 'new', 'waits on the asked one', '--after', '8', '--files', 'f9.mjs');   // 9
  jarl(root, 'new', 'after the approved one', '--after', '5', '--files', 'f10.mjs');  // 10
  jarl(root, 'new', 'also after the approved one', '--after', '5', '--files', 'f11.mjs'); // 11
  jarl(root, 'new', 'after two', '--after', '1,5', '--files', 'f12.mjs');            // 12
  for (const id of ['2', '3', '4', '5', '6']) jarl(root, 'set', id, 'in-progress', 'go', '--worker', `w${id}`, '--branch', `jarl/${id}`);
  for (const id of ['3', '4', '5', '6']) jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'green');
  jarl(root, 'review', '4', 'changes', '--by', 'rev', IMPORTANT);
  jarl(root, 'review', '5', 'approve', '--by', 'rev', FINDINGS);
  jarl(root, 'review', '6', 'approve', '--by', 'rev', FINDINGS);
  jarl(root, 'merged', '6', '--sha', 'abc1234', '--ci', 'green');
  jarl(root, 'ask', 'which way?', '--kind', 'stuck', '--issue', '8');                 // a-1
  jarl(root, 'ask', 'ratify the naming', '--kind', 'ratify');                         // a-2
  return root;
}

test('next --as jarl lists each issue in play with the step it points to and the command that moves it, most held-up first', () => {
  const root = stepsLoop();
  const o = json(root, 'next', '--as', 'jarl', '--all');
  assert.equal(o.as, 'jarl');
  assert.deepEqual(o.rows.map((r) => [r.id, r.what]), [['5', 'merge'], ['1', 'ready'], ['2', 'worker'], ['3', 'review'], ['4', 'changes'], ['6', 'close']]);
  assert.deepEqual(o.rows.find((r) => r.id === '5').holdsUp, ['10', '11', '12']);
  assert.equal(o.rows.find((r) => r.id === '2').doer, 'w2');
  const text = jarl(root, 'next', '--as', 'jarl');
  assert.match(text, /^On the jarl \(6\)$/m);
  assert.match(text, /^- 5 approved: approved, not merged; merge it \(worker w5\) — jarl\.mjs merged 5 --sha <sha> --ran "<check>" --saw "<summary>" · holds up 10, 11, 12$/m);
  assert.match(text, /^- 1 ready one: ready to start, raise a worker — jarl\.mjs set 1 in-progress --branch <branch> --worker <name> · holds up 7, 12$/m);
  assert.match(text, /^- 2 with a worker: with worker w2 since .*, no proof yet; the worker records it — jarl\.mjs evidence 2 --ran "<command>" --saw "<what it printed>"$/m);
  assert.match(text, /^- 3 proof no verdict: proof recorded, no verdict; raise a fresh reviewer \(worker w3\) — jarl\.mjs review 3 approve\|changes --by <reviewer> "<findings>"$/m);
  assert.match(text, /^- 4 changes asked: changes asked by its reviewer; send it back to a worker \(worker w4\) — jarl\.mjs round 4 "<what failed>"$/m);
  assert.match(text, /^- 6 merged: merged; close it \(worker w6\) — jarl\.mjs set 6 done "<why>"$/m);
  assert.doesNotMatch(text, /a-1|a-2|ratify/, 'the questions are the owner\'s');
  // A round sends the changes back to the worker until it records a new row; then the proof waits for a reviewer again.
  jarl(root, 'round', '4', 'the empty list');
  assert.equal(json(root, 'next', '--as', 'jarl', '--all').rows.find((r) => r.id === '4').what, 'worker');
  assert.match(jarl(root, 'next', '--as', 'jarl'), /^- 4 changes asked: with worker w4 since .*, sent back by a round, no new proof yet; the worker records it — jarl\.mjs evidence 4 /m);
  jarl(root, 'evidence', '4', '--ran', 'npm test', '--saw', 'green again');
  assert.equal(json(root, 'next', '--as', 'jarl', '--all').rows.find((r) => r.id === '4').what, 'review');
});

test('next --as owner lists the questions and the items to ratify, most held-up first, and --all is his digest with what waits on him', () => {
  const root = stepsLoop();
  const o = json(root, 'next', '--as', 'owner');
  assert.deepEqual(o.rows.map((r) => [r.ask, r.what, r.holdsUp]), [['1', 'question', ['8']], ['2', 'ratify', []]]);
  const text = jarl(root, 'next', '--as', 'the Owner');
  assert.match(text, /^On the owner \(2\)\n- a-1 which way\?: question \(stuck\) on issue 8 — jarl\.mjs answer a-1 "<answer>" · holds up 8\n- a-2 ratify the naming: to ratify — jarl\.mjs answer a-2 "yes" --by owner \(or "reject"\)$/m);
  assert.match(text, /^and 1 issue\(s\) waiting on the owner: jarl\.mjs next --as owner --all$/m);
  const digest = jarl(root, 'next', '--as', 'owner', '--all');
  assert.match(digest, /^Waiting on the owner \(1\)\n- 9 waits on the asked one: waits on the owner via 8$/m);
  const jarlAll = jarl(root, 'next', '--as', 'jarl', '--all');
  assert.match(jarlAll, /^Waiting on the jarl \(4\)\n- 7 waits on the ready one: waits on the jarl via 1\n- 10 after the approved one: waits on the jarl via 5\n- 11 also after the approved one: waits on the jarl via 5\n- 12 after two: waits on the jarl via 1, 5$/m);
  // An answer releases the issue: the question leaves the owner's list, and 8 is ready on the jarl's.
  jarl(root, 'answer', '1', 'this way');
  assert.deepEqual(json(root, 'next', '--as', 'owner').rows.map((r) => r.ask), ['2']);
  assert.deepEqual(json(root, 'next', '--as', 'jarl', '--all').rows.find((r) => r.id === '8').holdsUp, ['9']);
  // A question comes before an item to ratify, which blocks nothing, and a stop question before every other.
  jarl(root, 'ask', 'is the goal still right?', '--kind', 'charter');   // a-3
  jarl(root, 'ask', 'halt?', '--kind', 'stop');                          // a-4
  assert.deepEqual(json(root, 'next', '--as', 'owner').rows.map((r) => r.ask), ['4', '3', '2']);
});

test('next --as prints at most seven lines and counts the rest; --all prints every line', () => {
  const root = loop();
  for (let n = 1; n <= 9; n += 1) jarl(root, 'new', `task ${n}`, '--files', `t${n}.mjs`);
  const text = jarl(root, 'next', '--as', 'jarl');
  assert.equal(text.split('\n').filter((l) => l.startsWith('- ')).length, 7);
  assert.match(text, /^and 2 more: jarl\.mjs next --as jarl --all$/m);
  assert.equal(json(root, 'next', '--as', 'jarl').more, 2);
  const all = jarl(root, 'next', '--as', 'jarl', '--all');
  assert.equal(all.split('\n').filter((l) => l.startsWith('- ')).length, 9);
  assert.doesNotMatch(all, /more:/);
});

test('the rows come from the profile\'s status flags, never from the names of the statuses', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-as-profile-'));
  const file = join(dir, 'profile.json');
  writeFileSync(file, JSON.stringify({
    'jarl-profile': 1, name: 'shop',
    statuses: { todo: ['dispatchable'], doing: ['holds-claim'], shipped: ['settles-dependents', 'terminal', 'closes-record'], binned: ['settles-dependents', 'terminal', 'needs-reason'] },
    initial: 'todo',
  }));
  const root = loop(['--profile', file]);
  jarl(root, 'new', 'to do', '--files', 'a.mjs');
  jarl(root, 'new', 'being done', '--files', 'b.mjs');
  jarl(root, 'new', 'approved plain', '--files', 'c.mjs');
  jarl(root, 'set', '2', 'doing', 'go', '--worker', 'w2', '--branch', 'jarl/2');
  jarl(root, 'set', '3', 'doing', 'go', '--worker', 'w3');
  jarl(root, 'evidence', '2', '--ran', 'npm test', '--saw', 'green');
  jarl(root, 'evidence', '3', '--ran', 'npm test', '--saw', 'green');
  jarl(root, 'review', '3', 'approve', '--by', 'rev', FINDINGS);
  const o = json(root, 'next', '--as', 'jarl');
  assert.deepEqual(o.rows.map((r) => [r.id, r.what]), [['1', 'ready'], ['2', 'review'], ['3', 'close']]);
  const text = jarl(root, 'next', '--as', 'jarl');
  assert.match(text, /— jarl\.mjs set 1 doing --branch <branch> --worker <name>$/m);
  assert.match(text, /^- 3 approved plain: approved; close it \(worker w3\) — jarl\.mjs set 3 shipped "<why>"$/m);
});

test('a ruling that settles issues none of which is live, and none finished on it, is the jarl\'s', () => {
  const root = loop();
  jarl(root, 'new', 'folded away', '--files', 'a.mjs');      // 1
  jarl(root, 'new', 'dropped on the ruling', '--files', 'b.mjs'); // 2
  jarl(root, 'new', 'still open', '--files', 'c.mjs');       // 3
  jarl(root, 'decide', 'keep-the-work', 'The work of 1 is kept.', '--settles', '1');
  jarl(root, 'decide', 'drop-the-work', 'Issue 2 is not needed.', '--settles', '2');
  jarl(root, 'decide', 'open-work', 'Issue 3 does it.', '--settles', '3');
  jarl(root, 'set', '1', 'dropped', 'folded into another task');
  jarl(root, 'set', '2', 'dropped', 'not needed, ruling drop-the-work');
  const o = json(root, 'next', '--as', 'jarl', '--all');
  assert.deepEqual(o.rows.filter((r) => r.what === 'ruling').map((r) => r.ruling), ['keep-the-work']);
  assert.match(jarl(root, 'next', '--as', 'jarl', '--all'), /^- keep-the-work: ruling in force; the work it settles has no live issue: 1 is dropped; file the work and settle it — jarl\.mjs new "<title>", then jarl\.mjs decide <slug> "<ruling>" --supersedes keep-the-work --settles <id>$/m);
  // A ruling that supersedes it takes the line away.
  jarl(root, 'new', 'the kept work', '--files', 'd.mjs');   // 4
  jarl(root, 'decide', 'keep-the-work-in-4', 'The work of 1 is done in 4.', '--supersedes', 'keep-the-work', '--settles', '4');
  assert.deepEqual(json(root, 'next', '--as', 'jarl', '--all').rows.filter((r) => r.what === 'ruling'), []);
});

test('a named coordinator holds nothing while the loop has no slices, and an outside person holds nothing yet', () => {
  const root = loop();
  jarl(root, 'new', 'ready', '--files', 'a.mjs');
  jarl(root, 'goal', '--set', 'Coordinators: Ada');
  const ada = jarl(root, 'next', '--as', 'Ada');
  assert.match(ada, /^On Ada \(0\)\n- \(nothing is on Ada\)\nwith no slice in the loop, what a coordinator holds is the jarl's: jarl\.mjs next --as jarl$/);
  assert.equal(json(root, 'next', '--as', 'Ada').rows.length, 0);
  assert.equal(jarl(root, 'next', '--as', 'Dana Smith'), 'On Dana Smith (0)\n- (nothing is on Dana Smith)');
  assert.equal(json(root, 'next', '--as', 'jarl').rows.length, 1);
});

test('status --as and resume --as end with the asker\'s list; their --json carries it as `as`', () => {
  const root = stepsLoop();
  const status = jarl(root, 'status', '--as', 'owner');
  assert.match(status, /\n\n## On the owner \(2\)\n- a-1 [^\n]*\n- a-2 [^\n]*\nand 1 issue\(s\) waiting on the owner: jarl\.mjs next --as owner --all$/);
  const resume = jarl(root, 'resume', '--as', 'jarl');
  assert.match(resume, /\n\n## On the jarl \(6\)\n- 5 approved: [^\n]*\n(- [^\n]*\n){5}and 4 issue\(s\) waiting on the jarl: jarl\.mjs next --as jarl --all$/);
  assert.deepEqual(json(root, 'status', '--as', 'owner').as.rows.map((r) => r.ask), ['1', '2']);
  assert.equal(json(root, 'resume', '--as', 'jarl').as.total, 6);
  assert.equal(json(root, 'resume').as, undefined, 'without --as nothing is added');
  assert.doesNotMatch(jarl(root, 'status'), /## On the/);
});

test('next --as refuses an empty name and --limit, and names what it takes', () => {
  const root = loop();
  assert.match(refuses(root, 'next', '--as', ' '), /--as names who asks: owner, jarl, a coordinator or a person by name/);
  assert.match(refuses(root, 'next', '--as', 'jarl', '--limit', '3'), /--limit counts the ready issues of next; next --as prints at most seven lines, and --all every line/);
});

// Horde's profile as Horde ships it: every status set by the record, an external scheduler, a done gate with no approve.
const HORDE = {
  'jarl-profile': 1, format: 1, name: 'horde',
  statuses: {
    proposed: { flags: [], 'set-by': 'record' }, queued: { flags: ['dispatchable'], 'set-by': 'record' },
    running: { flags: ['holds-claim'], 'set-by': 'record' }, landed: { flags: [], 'set-by': 'record' },
    changes: { flags: [], 'set-by': 'record' }, blocked: { flags: [], 'set-by': 'record' },
    merged: { flags: ['settles-dependents', 'terminal', 'closes-record'], 'set-by': 'record' }, dropped: { flags: ['terminal'], 'set-by': 'record' },
  },
  initial: 'proposed',
  fields: { Kind: { enum: ['work', 'quality', 'prototype', 'revert'], default: 'work' }, Node: { required: true }, Class: { required: true } },
  sections: ['Scope', 'Notes for the worker'],
  'acceptance-heading': 'Acceptance — evidence',
  'external-scheduler': "Horde's tick.mjs --horde <mission> (the director runs it; Jarl's next and queue do not schedule a mission)",
  'done-gate': { approve: 'none', 'requires-merged': true },
  lifecycle: { close: 'record', archive: 'record', command: "Horde's horde.mjs done --horde <mission>" },
};

test('on a loop opened with Horde\'s profile, next --as lists only what is not scheduling and names the composer\'s command for the rest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-as-horde-'));
  const file = join(dir, 'jarl-profile.json');
  writeFileSync(file, JSON.stringify(HORDE));
  const root = join(dir, 'mission');
  R.initLoop(root, 'the mission', { profile: file });
  const ticket = (t) => R.newIssue(root, t, { field: ['Node=core', 'Class=standard'] }).id;
  const queued = ticket('queued ticket');
  const running = ticket('running ticket');
  const gone = ticket('dropped ticket');
  R.setStatus(root, queued, 'queued');
  R.setStatus(root, running, 'queued');
  R.setStatus(root, running, 'running', undefined, { worker: 'w-run', branch: 'horde/run' });
  R.setStatus(root, gone, 'dropped');
  R.ask(root, 'which tier is the default?', { kind: 'stop' });
  R.decide(root, 'tickets-by-weight', 'Tickets are ranked by weight.', { settles: [gone] });
  const o = json(root, 'next', '--as', 'jarl', '--all');
  assert.deepEqual(o.rows.map((r) => r.what), ['ruling'], 'no ticket in play is listed: the scheduler holds them');
  assert.match(o.schedulerNote, /Horde's tick\.mjs --horde <mission>/);
  const text = jarl(root, 'next', '--as', 'jarl');
  assert.match(text, /^- tickets-by-weight: ruling in force; the work it settles has no live issue: 003 is dropped;/m);
  assert.match(text, /^the issues in play are the composer's: scheduling is led by the composer: Horde's tick\.mjs --horde <mission>/m);
  assert.doesNotMatch(text, /queued ticket|running ticket/);
  const owner = jarl(root, 'next', '--as', 'owner');
  assert.match(owner, /^- a-001 which tier is the default\?: question \(stop\) — jarl\.mjs answer a-001 "<answer>"$/m);
  assert.match(jarl(root, 'resume', '--as', 'owner'), /## On the owner \(1\)\n- a-001 [^\n]*\nthe issues in play are the composer's: [^\n]*$/);
});
