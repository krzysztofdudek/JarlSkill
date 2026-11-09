// next --as <holder>: what is on the owner, the jarl, a named coordinator or a named person, derived from the record —
// the status flags of the loop's profile, the verdicts, the questions and the rulings — with the command that moves each
// line; and status --as and resume --as, which end with the same list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FINDINGS } from './findings.mjs';
import { jarl, refuses, loop as makeLoop } from './helpers.mjs';
import * as R from '../record.mjs';
import { filePlain } from './helpers.mjs';
import { BUILTIN_STATUSES } from '../jarl-lib.mjs';

const loop = (initFlags = []) => makeLoop({ prefix: 'jarl-as-', via: 'cli', dotGit: false, initFlags });
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const IMPORTANT = 'Important: the empty list is not handled';

// One loop with an issue at every step: ready, with its worker, proof and no verdict, changes asked, approved, merged;
// issues waiting on After; a question on an issue, and an item to ratify.
function stepsLoop() {
  const root = loop();
  const titles = ['ready one', 'with a worker', 'proof no verdict', 'changes asked', 'approved', 'merged'];
  titles.forEach((t, n) => jarl(root, 'new', t, '--acceptance', '[read] it works', '--files', `f${n + 1}.mjs`));        // 1-6
  jarl(root, 'new', 'waits on the ready one', '--acceptance', '[read] it works', '--after', '1', '--files', 'f7.mjs');   // 7
  jarl(root, 'new', 'asked about', '--acceptance', '[read] it works', '--files', 'f8.mjs');                              // 8
  jarl(root, 'new', 'waits on the asked one', '--acceptance', '[read] it works', '--after', '8', '--files', 'f9.mjs');   // 9
  jarl(root, 'new', 'after the approved one', '--acceptance', '[read] it works', '--after', '5', '--files', 'f10.mjs');  // 10
  jarl(root, 'new', 'also after the approved one', '--acceptance', '[read] it works', '--after', '5', '--files', 'f11.mjs'); // 11
  jarl(root, 'new', 'after two', '--acceptance', '[read] it works', '--after', '1,5', '--files', 'f12.mjs');            // 12
  for (const id of ['2', '3', '4', '5', '6']) jarl(root, 'set', id, 'in-progress', 'go', '--worker', `w${id}`, '--branch', `jarl/${id}`);
  for (const id of ['3', '4', '5', '6']) jarl(root, 'evidence', id, '--line', '1', '--ran', 'npm test', '--saw', 'green');
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
  assert.deepEqual(o.rows.map((r) => [r.id, r.what]), [['5', 'merge'], ['1', 'ready'], ['6', 'close'], ['3', 'review'], ['2', 'worker'], ['4', 'changes']]);
  assert.deepEqual(o.rows.find((r) => r.id === '5').holdsUp, ['10', '11', '12']);
  assert.equal(o.rows.find((r) => r.id === '2').doer, 'w2');
  const text = jarl(root, 'next', '--as', 'jarl');
  assert.match(text, /^On the jarl \(6\)$/m);
  assert.match(text, /^- 5 approved: approved, not merged; merge it \(worker w5\) — jarl\.mjs merged 5 --sha "<sha>" --ran "<command>" --saw "<what-it-printed>" --by jarl · holds up 10, 11, 12$/m);
  assert.match(text, /^- 1 ready one: ready to start, raise a worker — jarl\.mjs set 1 in-progress --branch "<branch>" --worker "<name>" --model "<model-id>" --by jarl · holds up 7, 12$/m);
  assert.match(text, /^- 2 with a worker: with worker w2 since .*: no row is owed for read lines; raise a fresh examiner when it reports — jarl\.mjs brief 2 --role reviewer/m);
  assert.match(text, /^- 3 proof no verdict: proof recorded, no verdict; raise a fresh reviewer for 3; if you cannot raise agents, ask the owner to start a fresh session \(worker w3\) — jarl\.mjs review 3 "<verdict>" --by "<reviewer>" --model "<model-id>" "<text>", or jarl\.mjs ask 'start a fresh session to review issue 3' --by jarl$/m);
  assert.match(text, /^- 4 changes asked: changes asked by its reviewer; send it back to a worker \(worker w4\) — jarl\.mjs round 4 "<text>" --by jarl$/m);
  assert.match(text, /^- 6 merged: merged; close it \(worker w6\) — jarl\.mjs set 6 done "<text>" --by jarl$/m);
  assert.doesNotMatch(text, /a-1|a-2|ratify/, 'the questions are the owner\'s');
  // A round sends the changes back to the worker until it records a new row; then the proof waits for a reviewer again.
  jarl(root, 'round', '4', 'the empty list');
  assert.equal(json(root, 'next', '--as', 'jarl', '--all').rows.find((r) => r.id === '4').what, 'worker');
  assert.match(jarl(root, 'next', '--as', 'jarl'), /^- 4 changes asked: with worker w4 since .*, sent back by a round: no row is owed for read lines; raise a fresh examiner when it reports — jarl\.mjs brief 4 --role reviewer/m);
  jarl(root, 'evidence', '4', '--line', '1', '--ran', 'npm test', '--saw', 'green again');
  const review = json(root, 'next', '--as', 'jarl', '--all').rows.find((r) => r.what === 'review');
  assert.deepEqual(review.ids, ['3', '4'], 'the two proofs of code with no verdict are one line');
});

test('next --as owner lists the questions and the items to ratify, most held-up first, and --all is his digest with what waits on him', () => {
  const root = stepsLoop();
  const o = json(root, 'next', '--as', 'owner');
  assert.deepEqual(o.rows.map((r) => [r.ask, r.what, r.holdsUp]), [['1', 'question', ['8']], ['2', 'ratify', []]]);
  const text = jarl(root, 'next', '--as', 'the Owner');
  assert.match(text, /^On the owner \(2\)\n- a-1 which way\?: question \(stuck\) on issue 8 — jarl\.mjs answer a-1 "<text>" --by "<the-owner-himself>" · holds up 8\n- a-2 ratify the naming: to ratify — jarl\.mjs answer a-2 "<yes-or-reject-first>" --by "<the-owner-himself>"$/m);
  assert.match(text, /^and 1 issue\(s\) waiting on the owner: jarl\.mjs next --as owner --all$/m);
  const digest = jarl(root, 'next', '--as', 'owner', '--all');
  assert.match(digest, /^Waiting on the owner \(1\)\n- 9 waits on the asked one: waits on the owner via 8$/m);
  const jarlAll = jarl(root, 'next', '--as', 'jarl', '--all');
  assert.match(jarlAll, /^Waiting on the jarl \(4\)\n- 7 waits on the ready one: waits on the jarl via 1\n- 10 after the approved one: waits on the jarl via 5\n- 11 also after the approved one: waits on the jarl via 5\n- 12 after two: waits on the jarl via 1, 5$/m);
  // An answer releases the issue: the question leaves the owner's list, and 8 is ready on the jarl's.
  jarl(root, 'answer', '1', 'this way', '--by', 'owner');
  assert.deepEqual(json(root, 'next', '--as', 'owner').rows.map((r) => r.ask), ['2']);
  assert.deepEqual(json(root, 'next', '--as', 'jarl', '--all').rows.find((r) => r.id === '8').holdsUp, ['9']);
  // A question comes before an item to ratify, which blocks nothing, and a stop question before every other.
  jarl(root, 'ask', 'is the goal still right?', '--kind', 'charter');   // a-3
  jarl(root, 'ask', 'halt?', '--kind', 'stop');                          // a-4
  assert.deepEqual(json(root, 'next', '--as', 'owner').rows.map((r) => r.ask), ['4', '3', '2']);
});

test('next --as prints at most seven lines and counts the rest; --all prints every line', () => {
  const root = loop();
  for (let n = 1; n <= 9; n += 1) jarl(root, 'new', `task ${n}`, '--acceptance', '[read] it works', '--files', `t${n}.mjs`);
  const listOf = (t) => t.split('\n\nRules for ')[0];
  const text = jarl(root, 'next', '--as', 'jarl');
  assert.equal(listOf(text).split('\n').filter((l) => l.startsWith('- ')).length, 7);
  assert.match(text, /^and 2 more: jarl\.mjs next --as jarl --all$/m);
  assert.equal(json(root, 'next', '--as', 'jarl').more, 2);
  const all = jarl(root, 'next', '--as', 'jarl', '--all');
  assert.equal(listOf(all).split('\n').filter((l) => l.startsWith('- ')).length, 9);
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
  jarl(root, 'new', 'to do', '--acceptance', '[read] it works', '--files', 'a.mjs');
  jarl(root, 'new', 'being done', '--acceptance', '[read] it works', '--files', 'b.mjs');
  jarl(root, 'new', 'approved plain', '--acceptance', '[read] it works', '--files', 'c.mjs');
  jarl(root, 'set', '2', 'doing', 'go', '--worker', 'w2', '--branch', 'jarl/2');
  jarl(root, 'set', '3', 'doing', 'go', '--worker', 'w3');
  jarl(root, 'evidence', '2', '--line', '1', '--ran', 'npm test', '--saw', 'green');
  jarl(root, 'evidence', '3', '--line', '1', '--ran', 'npm test', '--saw', 'green');
  jarl(root, 'review', '3', 'approve', '--by', 'rev', FINDINGS);
  const o = json(root, 'next', '--as', 'jarl');
  assert.deepEqual(o.rows.map((r) => [r.id, r.what]), [['3', 'close'], ['2', 'review'], ['1', 'ready']]);
  const text = jarl(root, 'next', '--as', 'jarl');
  assert.match(text, /— jarl\.mjs set 1 doing --branch "<branch>" --worker "<name>" --model "<model-id>" --by jarl$/m);
  assert.match(text, /^- 3 approved plain: approved; close it \(worker w3\) — jarl\.mjs set 3 shipped "<text>" --by jarl$/m);
});

test('a ruling that settles issues none of which is live, and none finished on it, is the jarl\'s', () => {
  const root = loop();
  jarl(root, 'new', 'folded away', '--acceptance', '[read] it works', '--files', 'a.mjs');      // 1
  jarl(root, 'new', 'dropped on the ruling', '--acceptance', '[read] it works', '--files', 'b.mjs'); // 2
  jarl(root, 'new', 'still open', '--acceptance', '[read] it works', '--files', 'c.mjs');       // 3
  jarl(root, 'decide', 'keep-the-work', 'The work of 1 is kept.', '--settles', '1', '--by', 'coordinator');
  jarl(root, 'decide', 'drop-the-work', 'Issue 2 is not needed.', '--settles', '2', '--by', 'coordinator');
  jarl(root, 'decide', 'open-work', 'Issue 3 does it.', '--settles', '3', '--by', 'coordinator');
  jarl(root, 'set', '1', 'dropped', 'folded into another task');
  jarl(root, 'set', '2', 'dropped', 'not needed, ruling drop-the-work');
  const o = json(root, 'next', '--as', 'jarl', '--all');
  assert.deepEqual(o.rows.filter((r) => r.what === 'ruling').map((r) => r.ruling), ['keep-the-work']);
  assert.match(jarl(root, 'next', '--as', 'jarl', '--all'), /^- keep-the-work: ruling in force; the work it settles has no live issue: 1 is dropped; file the work and settle it — jarl\.mjs new "<title>" --by jarl, then jarl\.mjs decide "<slug>" "<text>" --by jarl --supersedes keep-the-work --settles "<id>"$/m);
  // A ruling that supersedes it takes the line away.
  jarl(root, 'new', 'the kept work', '--acceptance', '[read] it works', '--files', 'd.mjs');   // 4
  jarl(root, 'decide', 'keep-the-work-in-4', 'The work of 1 is done in 4.', '--supersedes', 'keep-the-work', '--settles', '4', '--by', 'coordinator');
  assert.deepEqual(json(root, 'next', '--as', 'jarl', '--all').rows.filter((r) => r.what === 'ruling'), []);
});

test('a ruling is cited by its whole name: a longer name that starts with it, or ends with it, cites another ruling', () => {
  const root = loop();
  for (const n of ['a', 'b', 'c', 'd']) jarl(root, 'new', `work ${n}`, '--acceptance', '[read] it works', '--files', `${n}.mjs`);   // 1-4
  jarl(root, 'decide', 'ask-01', 'Issue 1 is not needed.', '--settles', '1', '--by', 'coordinator');
  jarl(root, 'decide', 'ask-02', 'Issue 2 is not needed.', '--settles', '2', '--by', 'coordinator');
  jarl(root, 'decide', 'ask-03', 'Issue 3 is not needed.', '--settles', '3', '--by', 'coordinator');
  jarl(root, 'decide', 'ask-04', 'Issue 4 is not needed.', '--settles', '4', '--by', 'coordinator');
  jarl(root, 'set', '1', 'dropped', 'not needed, ruling ask-012');
  jarl(root, 'set', '2', 'dropped', 'not needed, see old-ask-02');
  jarl(root, 'set', '3', 'dropped', 'not needed (ruling ask-03).');
  jarl(root, 'set', '4', 'dropped', 'not needed on ask-04.');
  const rows = json(root, 'next', '--as', 'jarl', '--all').rows.filter((r) => r.what === 'ruling').map((r) => r.ruling);
  assert.deepEqual(rows, ['ask-01', 'ask-02'], 'a reason that names another ruling, or the same name inside a longer one, does not finish the issue on this one');
});

test('resume and status say an issue a round sent back is back with its worker, as the list does, until the worker records a row', () => {
  const root = stepsLoop();
  const inFlight = (text, id) => text.split('\n').find((l) => l.startsWith(id) || l.startsWith(`- ${id} `) || l.startsWith(`in flight ${id} `));
  jarl(root, 'round', '4', 'the empty list');
  const resume = jarl(root, 'resume');
  assert.match(resume, /^- 4 changes asked[^\n]*\n  → sent back by a round, back with the worker: no row is owed for read lines$/m);
  assert.doesNotMatch(resume, /^- 4 [^\n]*\n  → [^\n]*waits for a reviewer/m, 'the line does not say it waits for a reviewer');
  assert.match(jarl(root, 'status'), /^in flight 4 · sent back by a round, back with the worker: no row is owed for read lines$/m);
  assert.match(inFlight(jarl(root, 'next', '--as', 'jarl', '--all'), '4'), /sent back by a round: no row is owed for read lines/, 'the list says what a read line owes');
  assert.equal(json(root, 'status').inFlightRows.find((r) => r.id === '4').next, 'sent back by a round, back with the worker: no row is owed for read lines');
  assert.equal(json(root, 'resume').inFlight.find((r) => r.id === '4').mark, 'rows-no-verdict', 'the mark names the rows and no verdict since the round');
  jarl(root, 'evidence', '4', '--line', '1', '--ran', 'npm test', '--saw', 'green again');
  assert.match(jarl(root, 'resume'), /^- 4 changes asked[^\n]*\n  → evidence rows recorded, no verdict since the last start or round — it waits for a reviewer$/m);
});

test('status and resume end with the asker\'s list under a header that says it is the whole loop\'s when the view is scoped by a tag or a slice', () => {
  const root = stepsLoop();
  jarl(root, 'field', '1', 'Tags', 'ui');
  assert.match(jarl(root, 'status', '--tag', 'ui', '--as', 'jarl'), /\n\n## On the jarl \(6\) — the whole loop's list, not only the issues tagged ui\n/);
  assert.match(jarl(root, 'status', '--as', 'jarl'), /\n\n## On the jarl \(6\)\n/, 'an unscoped view says nothing of the kind');
  jarl(root, 'goal', '--set', 'Coordinators: odin');
  jarl(root, 'field', '2', 'Tags', 'slice:odin');
  assert.match(jarl(root, 'resume', '--slice', 'odin', '--as', 'jarl'), /\n\n## On the jarl \(\d+\) — the whole loop's list, not only the slice of odin\n/);
});

test('a question of several lines is one row of next --as, its lines joined, and its title in --json is the question as asked', () => {
  const root = loop();
  jarl(root, 'ask', 'first line of the question\nsecond line that goes on\nthird', '--kind', 'stuck');
  const text = jarl(root, 'next', '--as', 'owner');
  assert.match(text, /^- a-1 first line of the question second line that goes on third: question \(stuck\) — jarl\.mjs answer a-1 /m);
  assert.equal(text.split('\n').filter((l) => l.startsWith('-')).length, 1, text);
  assert.equal(text.split('\n').length, 2, 'the list is the heading and one row');
  assert.equal(json(root, 'next', '--as', 'owner').rows[0].title, 'first line of the question\nsecond line that goes on\nthird');
  const status = jarl(root, 'status', '--as', 'owner');
  assert.match(status, /\n\n## On the owner \(1\)\n- a-1 first line of the question second line that goes on third: /);
});

test('an escalation, a proposed rule and a ratify item of several lines are each one row of resume, its lines joined, and the text in --json is as asked', () => {
  const root = loop();
  jarl(root, 'goal', '--set', 'Coordinators: odin');
  jarl(root, 'ask', 'the slice cannot go on\nbecause the base moved', '--kind', 'escalation', '--slice', 'odin');
  jarl(root, 'ask', 'reviewers run the suite\nbefore they approve', '--kind', 'rule', '--applies-to', 'role reviewer');
  jarl(root, 'ask', 'raised the limit to 20\nunder the mandate', '--kind', 'ratify');
  const text = jarl(root, 'resume');
  assert.match(text, /\n## Escalations to the jarl \(1\)\n- a-1 slice:odin · the slice cannot go on because the base moved\n\n/);
  assert.match(text, /\n## Rules proposed \(1\)\n- a-2 to jarl · applies to role reviewer · reviewers run the suite before they approve\n\n/);
  assert.match(text, /\n## To ratify \(1\)\n- a-3 · raised the limit to 20 under the mandate\n\n/);
  const out = json(root, 'resume');
  assert.deepEqual([out.escalations[0].question, out.proposed[0].question, out.ratify[0].question], ['the slice cannot go on\nbecause the base moved', 'reviewers run the suite\nbefore they approve', 'raised the limit to 20\nunder the mandate']);
});

test('a question of several lines is one row of resume\'s questions too, its lines joined, and its text in --json is the question as asked', () => {
  const root = loop();
  jarl(root, 'ask', 'first line of the question\nsecond line that goes on\nthird', '--kind', 'stuck');
  jarl(root, 'ask', 'one line', '--kind', 'charter');
  const text = jarl(root, 'resume');
  assert.match(text, /\n## Questions to the owner \(2\)\n- a-1 \(stuck\) · first line of the question second line that goes on third\n- a-2 \(charter\) · one line\n\n/);
  assert.equal(json(root, 'resume').questions[0].question, 'first line of the question\nsecond line that goes on\nthird');
});

test('in a loop with slices the jarl is the coordinator of the issues in play in no slice, so the coordinator rules reach it while one is there', () => {
  const root = loop();
  jarl(root, 'goal', '--set', 'Coordinators: odin');
  jarl(root, 'new', 'in a slice', '--acceptance', '[read] it works', '--files', 'a.mjs', '--tags', 'slice:odin');
  jarl(root, 'new', 'in no slice', '--acceptance', '[read] it works', '--files', 'b.mjs');
  const slugs = (o) => o.rules.map((r) => r.slug);
  assert.deepEqual(slugs(json(root, 'next', '--as', 'jarl')), slugs(json(root, 'next', '--as', 'odin')), 'the jarl leases the issue in no slice under the rules odin leases its own under');
  assert.ok(slugs(json(root, 'next', '--as', 'jarl')).includes('jarl:coordinator-scope-holds'));
  jarl(root, 'set', '2', 'dropped', 'not needed');
  assert.deepEqual(slugs(json(root, 'next', '--as', 'jarl')), [], 'with every issue in play in a slice the jarl holds no lease or review of its own');
});

test('a named coordinator holds nothing while the loop has no slices, and an outside person holds nothing yet', () => {
  const root = loop();
  jarl(root, 'new', 'ready', '--acceptance', '[read] it works', '--files', 'a.mjs');
  jarl(root, 'goal', '--set', 'Coordinators: Ada');
  const ada = jarl(root, 'next', '--as', 'Ada');
  assert.match(ada, /^On Ada \(0\)\n- \(nothing is on Ada\)\nwith no slice in the loop, what a coordinator holds is the jarl's: jarl\.mjs next --as jarl\n\nRules for Ada \(3\)\n- jarl:coordinator-escalates · role coordinator · references\/jarl\.md — /);
  assert.equal(json(root, 'next', '--as', 'Ada').rows.length, 0);
  assert.equal(jarl(root, 'next', '--as', 'Dana Smith'), 'On Dana Smith (0)\n- (nothing is on Dana Smith)');
  assert.equal(json(root, 'next', '--as', 'jarl').rows.length, 1);
});

test('status --as and resume --as end with the asker\'s list; their --json carries it as `as`', () => {
  const root = stepsLoop();
  const status = jarl(root, 'status', '--as', 'owner');
  assert.match(status, /\n\n## On the owner \(2\)\n- a-1 [^\n]*\n- a-2 [^\n]*\nand 1 issue\(s\) waiting on the owner: jarl\.mjs next --as owner --all$/);
  const resume = jarl(root, 'resume', '--as', 'jarl');
  assert.match(resume, /\n\n## On the jarl \(6\)\n- 5 approved: [^\n]*\n(- [^\n]*\n){5}and 4 issue\(s\) waiting on the jarl: jarl\.mjs next --as jarl --all\n\nRules for the jarl \(3\)\n- jarl:coordinator-escalates/);
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

// A profile for a tool that runs its own loop: every status set by the record, a done gate with no approve.
const COMPOSER = {
  'jarl-profile': 1, name: 'composer-x',
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
  'done-gate': { approve: 'none', 'requires-merged': true },
  lifecycle: { close: 'record', archive: 'record', command: "composer-x's composer-x.mjs done --loop <composed-loop>" },
};

// ---- the kept kinds: a promise on whoever made it, a wait on a named outside person ----------------------------------

const profileJson = (root) => JSON.parse(readFileSync(join(root, '.jarl', 'profile.json'), 'utf8'));

test('a promise is on whoever its Found by names until it is kept and closed, and next never offers it to a worker', () => {
  const root = loop();
  jarl(root, 'goal', '--set', 'Coordinators: Ada');
  jarl(root, 'new', 'real work', '--acceptance', '[read] it works', '--files', 'a.mjs');                                                       // 1
  jarl(root, 'new', 'run the bench again after the fix', '--kind', 'promise', '--files', 'bench.mjs');      // 2, the jarl's
  jarl(root, 'new', 'read the draft by Friday', '--kind', 'promise', '--found-by', 'owner');                // 3
  jarl(root, 'new', 'send the summary to the jarl', '--kind', 'promise', '--found-by', 'Ada');              // 4
  jarl(root, 'new', 'after the bench', '--acceptance', '[read] it works', '--after', '2', '--files', 'c.mjs');                                // 5
  // next offers the work only; --all shows the promises in a group of their own, with who made each.
  assert.deepEqual(json(root, 'next').map((r) => r.id), ['1']);
  const all = jarl(root, 'next', '--all');
  assert.match(all, /^Promises, kept by who made them \(3\)\n2  P2  run the bench again after the fix  \(promised by jarl\)\n3  P2  read the draft by Friday  \(promised by owner\)\n4  P2  send the summary to the jarl  \(promised by Ada\)$/m);
  assert.deepEqual(json(root, 'next', '--all').filter((r) => r.group === 'promise').map((r) => [r.id, r.by]), [['2', 'jarl'], ['3', 'owner'], ['4', 'Ada']]);
  // Each one is on its maker's list, with the command that moves it.
  const mine = json(root, 'next', '--as', 'jarl', '--all');
  assert.deepEqual(mine.rows.map((r) => [r.id, r.what]), [['2', 'promise'], ['1', 'ready']], 'the bench holds 5 up, so it comes first');
  assert.match(jarl(root, 'next', '--as', 'jarl'), /^- 2 run the bench again after the fix: promised by the jarl; keep it, then record what was done — jarl\.mjs evidence 2 --ran "<command>" --saw "<what-it-printed>" --line "<line-number>" --by jarl · holds up 5$/m);
  assert.match(jarl(root, 'next', '--as', 'jarl', '--all'), /^- 5 after the bench: waits on the jarl via 2$/m);
  assert.match(jarl(root, 'next', '--as', 'owner'), /^On the owner \(1\)\n- 3 read the draft by Friday: promised by the owner; keep it, then record what was done — jarl\.mjs evidence 3 /);
  assert.match(jarl(root, 'next', '--as', 'ada'), /^On Ada \(1\)\n- 4 send the summary to the jarl: promised by Ada; keep it, then record what was done — /);
  // Kept: the proof waits for a verdict, then the close, and the promise stays on its maker throughout.
  jarl(root, 'evidence', '4', '--ran', 'sent the summary', '--saw', 'the jarl has it');
  assert.match(jarl(root, 'next', '--as', 'Ada'), /^- 4 send the summary to the jarl: kept, proof recorded, no verdict; review it — jarl\.mjs review 4 "<verdict>" --by "<reviewer>" --model "<model-id>" "<text>"$/m);
  jarl(root, 'review', '4', 'approve', '--by', 'jarl', FINDINGS);
  assert.match(jarl(root, 'next', '--as', 'Ada'), /^- 4 send the summary to the jarl: kept, approved; close it — jarl\.mjs set 4 done "<text>" --by Ada$/m);
  jarl(root, 'set', '4', 'done', 'the summary was sent');
  assert.equal(json(root, 'next', '--as', 'Ada').total, 0, 'a promise ends when its issue closes');
  // A promise given to a worker is worked as any issue, and its maker still holds each line.
  jarl(root, 'field', '2', 'Acceptance', '[read] the bench runs');
  jarl(root, 'set', '2', 'in-progress', 'go', '--worker', 'w2', '--branch', 'jarl/2');
  assert.deepEqual(json(root, 'next', '--as', 'jarl', '--all').rows.filter((r) => r.id === '2').map((r) => [r.what, r.holder, r.doer]), [['worker', 'jarl', 'w2']]);
  jarl(root, 'field', '3', 'Acceptance', '[read] it is read');
  jarl(root, 'set', '3', 'in-progress', 'go', '--worker', 'w3', '--branch', 'jarl/3');
  jarl(root, 'evidence', '3', '--line', '1', '--ran', 'npm test', '--saw', 'green');
  const owners = json(root, 'next', '--as', 'owner').rows;
  assert.deepEqual(owners.map((r) => [r.id, r.what]), [['3', 'review']], 'a promise\'s proof of code is on its maker, not in the jarl\'s line of fresh reviews');
  assert.equal(json(root, 'next', '--as', 'jarl', '--all').rows.filter((r) => r.id === '3').length, 0);
});

test('a wait is on its named outside person, with when to check, and what comes after it waits on that person; once it comes it is the jarl\'s to close', () => {
  const root = loop();
  jarl(root, 'new', 'the licence key from the vendor', '--kind', 'wait', '--person', 'Dana Smith', '--check-when', '2026-11-10');  // 1
  jarl(root, 'new', 'install with the key', '--acceptance', '[read] it works', '--after', '1', '--files', 'install.mjs');                                            // 2
  jarl(root, 'new', 'the legal sign-off', '--kind', 'wait', '--person', 'Lee', '--check-when', 'after the board meets');          // 3
  assert.match(readFileSync(join(root, '.jarl', 'issues', '1-the-licence-key-from-the-vendor.md'), 'utf8'), /^\*\*Found by:\*\* jarl\n\*\*Person:\*\* Dana Smith\n\*\*Check when:\*\* 2026-11-10\n/m);
  // Not offered to a worker, and on nobody's list but the person's.
  assert.deepEqual(json(root, 'next'), []);
  assert.match(jarl(root, 'next', '--all'), /^Waits on an outside person \(2\)\n1  P2  the licence key from the vendor  \(on Dana Smith, check when 2026-11-10\)\n3  P2  the legal sign-off  \(on Lee, check when after the board meets\)$/m);
  assert.equal(json(root, 'next', '--as', 'jarl').total, 0);
  // The person's list, asked in any case: the wait with when to check, and the issue that waits through it.
  const dana = jarl(root, 'next', '--as', 'dana smith', '--all');
  assert.equal(dana, [
    'On Dana Smith (1)',
    "- 1 the licence key from the vendor: waits on Dana Smith, check when 2026-11-10; when it comes, record it — jarl.mjs evidence 1 --ran \"<command>\" --saw \"<what-it-printed>\" --line \"<line-number>\" --by \"<who>\" · holds up 2",
    '',
    'Waiting on Dana Smith (1)',
    '- 2 install with the key: waits on Dana Smith via 1',
  ].join('\n'));
  const o = json(root, 'next', '--as', 'Dana Smith');
  assert.deepEqual(o.rows.map((r) => [r.id, r.what, r.holder, r.checkWhen, r.holdsUp]), [['1', 'wait', 'Dana Smith', '2026-11-10', ['2']]]);
  assert.match(jarl(root, 'next', '--as', 'Dana Smith'), /^and 1 issue\(s\) waiting on Dana Smith: jarl\.mjs next --as 'Dana Smith' --all$/m);
  assert.match(jarl(root, 'next', '--as', 'Lee'), /^On Lee \(1\)\n- 3 the legal sign-off: waits on Lee, check when after the board meets; when it comes, record it — /);
  assert.equal(json(root, 'next', '--as', 'Dana').total, 0, 'another name is another person');
  // It came: the proof is recorded, and the wait leaves the person for the jarl, who reviews and closes it.
  jarl(root, 'evidence', '1', '--ran', 'asked Dana for the key', '--saw', 'the key arrived by mail');
  assert.equal(json(root, 'next', '--as', 'Dana Smith').total, 0);
  assert.match(jarl(root, 'next', '--as', 'jarl'), /^- 1 the licence key from the vendor: it came, proof recorded, no verdict; review it — jarl\.mjs review 1 "<verdict>" --by "<reviewer>" --model "<model-id>" "<text>" · holds up 2$/m);
  jarl(root, 'review', '1', 'approve', '--by', 'jarl', FINDINGS);
  assert.match(jarl(root, 'next', '--as', 'jarl'), /^- 1 the licence key from the vendor: it came, approved; close it — jarl\.mjs set 1 done "<text>" --by jarl · holds up 2$/m);
  jarl(root, 'set', '1', 'done', 'the key came');
  assert.deepEqual(json(root, 'next', '--as', 'jarl').rows.map((r) => [r.id, r.what]), [['2', 'ready']], 'the wait ended with its issue, and the work after it is ready');
});

test('a wait names its person and when to check: new refuses one without them, field makes an issue a wait only once both are written, and neither is emptied on it', () => {
  const root = loop();
  assert.match(refuses(root, 'new', 'the key', '--kind', 'wait'), /^a wait names the outside person it is held by and when to check it\njarl\.mjs new "<title>" --by "<who>" --kind "<kind>" --person "<name>" --check-when "<date-or-event>"\n$/);
  assert.match(refuses(root, 'new', 'the key', '--kind', 'wait', '--person', 'Dana'), /a wait names the outside person/);
  assert.match(refuses(root, 'new', 'the key', '--kind', 'promise', '--person', 'Dana'), /--person goes with --kind wait/);
  assert.match(refuses(root, 'new', 'the key', '--check-when', 'Friday'), /--check-when goes with --kind wait/);
  assert.match(refuses(root, 'new', 'the key', '--kind', 'wait', '--person', 'Dana · Lee', '--check-when', 'Friday'), /Person is one value — not a phrase with "·" in it/);
  assert.ok(!readdirSync(join(root, '.jarl', 'issues')).length, 'nothing was filed');
  jarl(root, 'new', 'the key', '--acceptance', '[read] it works', '--files', 'a.mjs');                                                                   // 1
  assert.match(refuses(root, 'field', '1', 'Kind', 'wait'), /^1 becomes a wait only with the outside person it is held by and when to check it — first jarl\.mjs field "<ids>" Person "<name>" --by "<who>" and jarl\.mjs field "<ids>" 'Check when' "<date-or-event>" --by "<who>"\njarl\.mjs field "<ids>" Person "<name>" --by "<who>"\njarl\.mjs field "<ids>" 'Check when' "<date-or-event>" --by "<who>"\njarl\.mjs field "<ids>" Kind "<kind>" --by "<who>"\n$/);
  jarl(root, 'field', '1', 'Person', 'Dana');
  jarl(root, 'field', '1', 'Check when', 'Friday');
  jarl(root, 'field', '1', 'Kind', 'wait');
  assert.deepEqual(json(root, 'next', '--as', 'Dana').rows.map((r) => [r.id, r.what, r.checkWhen]), [['1', 'wait', 'Friday']]);
  assert.match(refuses(root, 'field', '1', 'Person', '--clear'), /^1 is a wait, held by its Person and checked when its Check when says: Person is never empty on it — give it another kind first \(jarl\.mjs field "<ids>" Kind "<kind>" --by "<who>"\)\njarl\.mjs field "<ids>" Kind "<kind>" --by "<who>"\n$/);
  jarl(root, 'field', '1', 'Person', 'Lee');
  assert.equal(json(root, 'next', '--as', 'Lee').total, 1, 'the wait moves with its Person');
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /1 field Person · Lee · was Dana/);
  // Given another kind, the issue is work again, and its Person can go.
  jarl(root, 'field', '1', 'Kind', 'gap');
  jarl(root, 'field', '1', 'Person', '--clear');
  assert.deepEqual(json(root, 'next').map((r) => r.id), ['1']);
});

test('of several issues, the refusal of a wait without its Person or of an emptied field of a wait names the issue in its reason and ends with the form, an id placeholder in place of the ids', () => {
  const root = loop();
  jarl(root, 'new', 'not a wait', '--acceptance', '[read] it works', '--files', 'a.mjs');                                                                 // 1
  jarl(root, 'new', 'the key', '--kind', 'wait', '--person', 'Dana', '--check-when', 'Friday', '--files', 'b.mjs');     // 2
  jarl(root, 'new', 'held by Lee', '--acceptance', '[read] it works', '--files', 'c.mjs');                                                                 // 3
  jarl(root, 'field', '3', 'Person', 'Lee');
  jarl(root, 'field', '3', 'Check when', 'Monday');
  assert.match(refuses(root, 'field', '1,2', 'Check when', '--clear'), /^2 is a wait, held by its Person and checked when its Check when says: Check when is never empty on it — give it another kind first \(jarl\.mjs field "<ids>" Kind "<kind>" --by "<who>"\)\njarl\.mjs field "<ids>" Kind "<kind>" --by "<who>"\n$/);
  assert.match(refuses(root, 'field', '3,1', 'Kind', 'wait'), /^1 becomes a wait only with the outside person it is held by and when to check it — first jarl\.mjs field "<ids>" Person "<name>" --by "<who>" and jarl\.mjs field "<ids>" 'Check when' "<date-or-event>" --by "<who>"\njarl\.mjs field "<ids>" Person "<name>" --by "<who>"\njarl\.mjs field "<ids>" 'Check when' "<date-or-event>" --by "<who>"\njarl\.mjs field "<ids>" Kind "<kind>" --by "<who>"\n$/);
  assert.deepEqual(json(root, 'show', '1').kind, 'bug', 'nothing was written');
});

test('a finding is never filed as a promise or a wait', () => {
  const root = loop();
  const dir = mkdtempSync(join(tmpdir(), 'jarl-as-findings-'));
  const file = join(dir, 'findings.json');
  writeFileSync(file, JSON.stringify([{ id: 'f1', title: 'a finding that says wait', kind: 'wait' }, { id: 'f2', title: 'a finding that says promise', kind: 'promise' }]));
  jarl(root, 'import', file);
  assert.deepEqual(json(root, 'list').map((i) => i.kind), ['bug', 'bug']);
  assert.match(refuses(root, 'import', file, '--kind', 'wait'), /--kind wait: a finding is work, never a promise or a wait — file one of those with jarl\.mjs new "<title>" --kind wait/);
});

test('resume lists the open promises and waits on their own, with who holds each, and never as held by a file', () => {
  const root = loop();
  jarl(root, 'new', 'real work', '--acceptance', '[read] it works', '--files', 'a.mjs');                                                                              // 1
  jarl(root, 'new', 'same file', '--acceptance', '[read] it works', '--files', 'a.mjs');                                                                              // 2, held by 1
  jarl(root, 'new', 'run the bench again', '--kind', 'promise', '--found-by', 'Ada');                                             // 3
  jarl(root, 'new', 'the licence key', '--kind', 'wait', '--person', 'Dana Smith', '--check-when', '2026-11-10');                // 4
  const text = jarl(root, 'resume');
  assert.match(text, /^## Held — files in flight \(1\)\n- 2  P2  same file \(a\.mjs held by 1\)$/m);
  assert.match(text, /^## Promises and waits \(2\)\n- 3  P2  run the bench again \(promised by Ada\)\n- 4  P2  the licence key \(waits on Dana Smith, check when 2026-11-10\)$/m);
  assert.doesNotMatch(text, /\( held by \)/);
  const o = json(root, 'resume');
  assert.deepEqual(o.held.map((h) => h.id), ['2']);
  assert.deepEqual(o.kept, [
    { id: '3', title: 'run the bench again', priority: '2', kind: 'promise', by: 'Ada' },
    { id: '4', title: 'the licence key', priority: '2', kind: 'wait', person: 'Dana Smith', checkWhen: '2026-11-10', came: false },
  ]);
  assert.equal(o.held.length + o.kept.length + o.readyTotal, o.status.ready, 'ready, held and kept together are the open issues not waiting');
  // With its proof recorded, the wait is shown as come: the jarl reviews and closes it.
  jarl(root, 'evidence', '4', '--ran', 'asked Dana for the key', '--saw', 'the key arrived');
  assert.match(jarl(root, 'resume'), /^- 4  P2  the licence key \(came from Dana Smith, proof recorded; the jarl reviews and closes it\)$/m);
  assert.equal(json(root, 'resume').kept.find((k) => k.id === '4').came, true);
});

// A profile as a loop opened before Jarl kept promises and waits may hold it: a field Person of its own and a kind wait of its own.
const OWN_WORDS = {
  'jarl-profile': 1, name: 'own-words', statuses: BUILTIN_STATUSES,
  fields: { Kind: { enum: ['work', 'wait'], default: 'work' }, Person: {}, 'Check when': {} },
};

test('a loop whose profile already declares a field Person or a kind wait reads as it did: its own field and kind keep their meaning, and the built-in promise and wait are off', () => {
  const root = loop();
  writeFileSync(join(root, '.jarl', 'profile.json'), JSON.stringify(OWN_WORDS));
  // Filed with no key (filePlain).
  filePlain(root, 'hold the line', { kind: 'wait', files: 'a.mjs', field: 'Person=Dana' });   // its own kind wait
  filePlain(root, 'plain work', { files: 'b.mjs' });
  for (const command of [['status'], ['list'], ['show', '1'], ['resume'], ['next']]) jarl(root, ...command);
  assert.deepEqual(json(root, 'next').map((r) => r.id), ['1', '2'], 'its own wait is work, offered as any other');
  assert.deepEqual(json(root, 'next', '--as', 'jarl').rows.map((r) => [r.id, r.what]), [['1', 'ready'], ['2', 'ready']]);
  assert.equal(json(root, 'next', '--as', 'Dana').total, 0, 'Person is its own field here, and holds nothing');
  jarl(root, 'field', '1', 'Person', 'Lee');
  assert.match(readFileSync(join(root, '.jarl', 'issues', '1-hold-the-line.md'), 'utf8'), /^\*\*Person:\*\* Lee$/m);
  assert.match(refuses(root, 'new', 'a wait', '--kind', 'wait', '--person', 'Dana', '--check-when', 'Friday'), /--person is off in this loop: its profile declares its own kinds or a field Person or Check when, so the built-in promise and wait are off here/);
  assert.match(refuses(root, 'new', 'a promise', '--kind', 'promise'), /--kind must be one of: work, wait/);
  // A profile that declares only the field keeps the built-in work kinds, without promise and wait.
  const other = loop();
  writeFileSync(join(other, '.jarl', 'profile.json'), JSON.stringify({ 'jarl-profile': 1, name: 'own-field', statuses: BUILTIN_STATUSES, fields: { Person: {} } }));
  assert.match(refuses(other, 'new', 'a promise', '--kind', 'promise'), /^--kind must be one of: bug, gap, cleanup, docs, test, research, process \(got "promise"\)\njarl\.mjs new "<title>" --by "<who>" --kind "<kind>"\n$/);
  jarl(other, 'new', 'work', '--acceptance', '[read] it works', '--files', 'a.mjs', '--field', 'Person=Dana');
  assert.deepEqual(json(other, 'next').map((r) => r.id), ['1']);
});

test('a profile file given to init or to profile is refused when it declares a field Person or Check when or names promise or wait among its kinds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-as-reserved-'));
  const write = (name, json) => { const f = join(dir, `${name}.json`); writeFileSync(f, JSON.stringify(json)); return f; };
  const withField = write('field', { 'jarl-profile': 1, name: 'field', statuses: BUILTIN_STATUSES, fields: { 'Check when': {} } });
  const withKinds = write('kinds', { 'jarl-profile': 1, name: 'kinds', statuses: BUILTIN_STATUSES, fields: { Kind: { enum: ['work', 'promise'] } } });
  const fresh = mkdtempSync(join(tmpdir(), 'jarl-as-fresh-'));
  assert.match(refuses(fresh, 'init', 'a goal', '--profile', withField), /is not a valid profile: it declares the field Check when, which Jarl reserves for its own promise and wait — the reserved names are the fields Person and Check when and the kinds promise and wait; rename them in the profile/);
  assert.match(refuses(fresh, 'init', 'a goal', '--profile', withKinds), /it declares the kind promise, which Jarl reserves/);
  assert.ok(!existsSync(join(fresh, '.jarl')), 'no loop was opened');
  assert.match(refuses(fresh, 'profile', withField), /it declares the field Check when, which Jarl reserves/);
  // The same profile already in a loop is read: the refusal is at the opening only.
  const root = loop();
  writeFileSync(join(root, '.jarl', 'profile.json'), JSON.stringify(OWN_WORDS));
  assert.match(jarl(root, 'profile'), /^kind: work \| wait$/m);
});

test('resume, status and next --as tell one state of a read-only lease: no view asks for rows', () => {
  const root = makeLoop({ prefix: 'jarl-one-state-', via: 'cli', dotGit: false });
  jarl(root, 'new', 'the docs', '--why', 'w', '--acceptance', '[read] the docs say so', '--files', 'a.md');
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1', '--model', 'm-x');
  for (const view of ['resume', 'status']) {
    assert.doesNotMatch(jarl(root, view), /no proof yet|records new rows/, view);
    assert.match(jarl(root, view), /no row is owed for read lines/, view);
  }
  jarl(root, 'round', '1', 'the page is wrong');
  for (const view of ['resume', 'status']) {
    assert.doesNotMatch(jarl(root, view), /records new rows|no new proof yet/, view);
    assert.match(jarl(root, view), /sent back by a round[^\n]*no row is owed for read lines/, view);
  }
});

test('a worker raised by a director is shown a worker\'s moves only; an agent that leased its own work sees its review too', () => {
  const root = makeLoop({ prefix: 'jarl-worker-list-', via: 'cli', dotGit: false });
  jarl(root, 'new', 'one', '--why', 'w', '--acceptance', '[test] it works', '--files', 'a.md');
  jarl(root, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/1-one', '--worker', 'w7', '--model', 'm-x', '--by', 'jarl');
  assert.match(jarl(root, 'next', '--as', 'w7'), /the worker records it/);
  jarl(root, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'green', '--by', 'w7');
  assert.doesNotMatch(jarl(root, 'next', '--as', 'w7'), /fresh reviewer/, 'the director raises the examiner');
  jarl(root, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'green', '--by', 'rev-1');
  jarl(root, 'review', '1', 'approve', 'read the diff and it looks right', '--by', 'rev-1', '--model', 'm-y');
  assert.doesNotMatch(jarl(root, 'next', '--as', 'w7'), /merge it/, 'the merge is the merger\'s');
  jarl(root, 'new', 'two', '--why', 'w', '--acceptance', '[test] it works', '--files', 'b.md');
  jarl(root, 'set', '2', 'in-progress', 'go', '--branch', 'jarl/2-two', '--worker', 'me', '--model', 'm-x', '--by', 'me');
  jarl(root, 'evidence', '2', '--line', '1', '--ran', 'npm test', '--saw', 'green', '--by', 'me');
  assert.match(jarl(root, 'next', '--as', 'me'), /fresh reviewer/, 'its own lease: it holds its review too');
});
