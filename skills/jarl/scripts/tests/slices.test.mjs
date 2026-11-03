// Slices: the part of the backlog one coordinator runs is the issues tagged slice:<coordinator>, the coordinator a name
// of the goal's Coordinators line. An issue is in one slice at most, and the views say which coordinator runs which slice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { jarl, refuses, run, loop as makeLoop } from './helpers.mjs';
import { formatTwoJarl } from './old-jarl.mjs';

const loop = () => makeLoop({ prefix: 'jarl-slice-', via: 'cli', dotGit: false });
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const tagsOf = (root, id) => json(root, 'show', id).tags;

test('tag, field Tags and new refuse a second slice: tag on one issue, and say how to move the issue', () => {
  const root = loop();
  jarl(root, 'new', 'one', '--tags', 'docs,slice:odin', '--files', 'a.mjs');
  assert.deepEqual(tagsOf(root, '1'), ['docs', 'slice:odin']);
  const log = readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
  const file = readFileSync(json(root, 'show', '1').file, 'utf8');
  assert.match(refuses(root, 'tag', '1', '+slice:thor'), /^1 is in slice:odin already, and an issue is in one slice — to move it: jarl\.mjs tag 1 -slice:odin \+slice:thor$/m);
  assert.match(refuses(root, 'field', '1', 'Tags', 'slice:odin, slice:thor'), /^1 is in slice:odin already, and an issue is in one slice — to move it: jarl\.mjs tag 1 -slice:odin \+slice:thor$/m);
  assert.match(refuses(root, 'new', 'two', '--tags', 'slice:odin,slice:thor'), /^an issue is in one slice, and the tags name slice:odin, slice:thor — keep one$/m);
  assert.match(refuses(root, 'tag', '1', '+slice:'), /^slice: names no coordinator: a slice is the tag slice:<coordinator>/m);
  assert.equal(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), log, 'a refusal writes no log line');
  assert.equal(readFileSync(json(root, 'show', '1').file, 'utf8'), file, 'nor the issue');
  // The same slice in another case is one slice, and moving an issue is one call.
  jarl(root, 'tag', '1', '+slice:Odin');
  jarl(root, 'tag', '1', '-slice:odin', '-slice:Odin', '+slice:thor');
  assert.deepEqual(tagsOf(root, '1'), ['docs', 'slice:thor']);
});

test('status names each coordinator of the Coordinators line with its slice, and a slice whose coordinator the line does not list', () => {
  const root = loop();
  jarl(root, 'goal', '--set', 'Coordinators: odin, thor');
  assert.doesNotMatch(jarl(root, 'status'), /^slices:/m, 'no slice tag in the loop: nothing to say');
  jarl(root, 'new', 'one', '--tags', 'slice:odin', '--files', 'a.mjs');
  jarl(root, 'new', 'two', '--tags', 'slice:odin', '--files', 'b.mjs');
  jarl(root, 'new', 'three', '--tags', 'slice:loki', '--files', 'c.mjs');
  jarl(root, 'set', '2', 'dropped', 'not needed');
  assert.match(jarl(root, 'status'), /^slices: odin runs slice:odin \(1 in play\) · thor runs slice:thor \(none in play\) · slice:loki has no coordinator on the goal's Coordinators line \(1 in play\): its approve counts as fresh until the line names loki$/m);
  assert.deepEqual(json(root, 'status').slices, [
    { coordinator: 'odin', tag: 'slice:odin', declared: true, inPlay: 1 },
    { coordinator: 'thor', tag: 'slice:thor', declared: true, inPlay: 0 },
    { coordinator: 'loki', tag: 'slice:loki', declared: false, inPlay: 1 },
  ]);
  // The goal line is the one a reader that knows no slices reads: the names, each one reviewing as the loop's director.
  const goal = readFileSync(join(root, '.jarl', 'goal.md'), 'utf8');
  assert.match(goal, /^Coordinators: odin, thor$/m);
});

// Two slices over one file: odin's 1 and 2, thor's 3, all declaring a.mjs; 4 in no slice; thor's 5 leased on c.mjs.
function twoSlices() {
  const root = loop();
  jarl(root, 'goal', '--set', 'Coordinators: odin, thor');
  jarl(root, 'new', 'odin first', '--tags', 'slice:odin', '--files', 'a.mjs', '--prio', '1');   // 1
  jarl(root, 'new', 'odin second', '--tags', 'slice:odin', '--files', 'a.mjs');                 // 2
  jarl(root, 'new', 'thor first', '--tags', 'slice:thor', '--files', 'a.mjs');                  // 3
  jarl(root, 'new', 'the jarl\'s', '--files', 'b.mjs');                                         // 4
  jarl(root, 'new', 'thor leased', '--tags', 'slice:thor', '--files', 'c.mjs');                 // 5
  jarl(root, 'set', '5', 'in-progress', 'go', '--worker', 'w5', '--branch', 'jarl/5');
  return root;
}
const ready = (rows) => rows.filter((r) => r.ready).map((r) => r.id);

test('next --slice offers only the slice\'s issues: an open issue reserves its files within its own slice, and a lease holds across slices', () => {
  const root = twoSlices();
  // The whole loop: 1 reserves a.mjs against 2 and 3.
  assert.deepEqual(ready(json(root, 'next', '--all')), ['1', '4']);
  assert.deepEqual(ready(json(root, 'next', '--slice', 'odin', '--all')), ['1']);
  assert.deepEqual(json(root, 'next', '--slice', 'odin', '--all').map((r) => [r.id, r.group]), [['1', 'ready'], ['2', 'held-by-file']]);
  // Odin's open 1 does not hold thor's 3: across slices only leases hold.
  assert.deepEqual(ready(json(root, 'next', '--slice', 'Thor', '--all')), ['3']);
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1', '--branch', 'jarl/1');
  assert.deepEqual(json(root, 'next', '--slice', 'thor', '--all').map((r) => [r.id, r.group, r.heldBy]), [['3', 'held-by-file', ['1']]]);
  assert.match(jarl(root, 'next', '--slice', 'thor'), /nothing is ready to start; 1 open issue\(s\) are held or waiting/);
  assert.match(refuses(root, 'next', '--slice', 'loki'), /^no coordinator loki on the goal's Coordinators line and no issue tagged slice:loki — the slices are slice:odin, slice:thor$/m);
  assert.match(refuses(root, 'next', '--slice', 'odin', '--as', 'odin'), /^--slice scopes next to one coordinator's slice; next --as <coordinator> lists what is on that coordinator/m);
});

test('status --slice and resume --slice are scoped to the slice, the way status --tag is, and keep the loop\'s rulings, queue and log', () => {
  const root = twoSlices();
  jarl(root, 'ask', 'which way for odin?', '--issue', '2');      // a-1, on odin's 2
  jarl(root, 'ask', 'which way for the jarl?', '--issue', '4');  // a-2, on the jarl's 4
  const st = json(root, 'status', '--slice', 'odin');
  assert.equal(st.slice, 'odin');
  assert.equal(st.open, 2);
  assert.equal(st.inFlight, 0);
  assert.equal(st.questions, 1);
  const text = jarl(root, 'status', '--slice', 'thor');
  assert.match(text, /^open 1 · in flight 1 · done 0 · dropped 0 · deferred 0 · questions 0$/m);
  assert.match(text, /^scoped to the slice of thor, the issues tagged slice:thor, and the escalations that name it — the counts above and the lists below are theirs only$/m);
  assert.match(refuses(root, 'status', '--slice', 'odin', '--tag', 'docs'), /--tag and --slice each scope the view: give one/);
  const r = json(root, 'resume', '--slice', 'thor');
  assert.equal(r.slice, 'thor');
  assert.deepEqual(r.inFlight.map((x) => x.id), ['5']);
  assert.deepEqual(r.next.map((x) => x.id), ['3']);
  assert.deepEqual(r.questions, []);
  const odin = json(root, 'resume', '--slice', 'odin');
  assert.deepEqual(odin.questions.map((a) => a.id), ['1']);
  assert.deepEqual(odin.held.map((x) => x.id), ['2']);
  assert.ok(odin.log.length > 3, 'the log is the loop\'s');
  assert.match(jarl(root, 'resume', '--slice', 'odin'), /^scoped to the slice of odin, the issues tagged slice:odin: in flight, waiting, the questions, held and next ready are its own; the rulings, the merge queue, the tips and the log are the loop's$/m);
  assert.match(refuses(root, 'resume', '--slice', 'loki'), /no coordinator loki on the goal's Coordinators line/);
});

test('next --as <coordinator> holds its slice\'s ready issues, leases, proofs with no verdict and changes verdicts; the jarl keeps the issues in no slice and what follows an approve', () => {
  const root = twoSlices();
  jarl(root, 'new', 'odin proof', '--tags', 'slice:odin', '--files', 'd.mjs');     // 6
  jarl(root, 'new', 'odin changes', '--tags', 'slice:odin', '--files', 'e.mjs');   // 7
  jarl(root, 'new', 'thor approved', '--tags', 'slice:thor', '--files', 'f.mjs');  // 8
  for (const id of ['6', '7', '8']) {
    jarl(root, 'set', id, 'in-progress', 'go', '--worker', `w${id}`, '--branch', `jarl/${id}`);
    jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'green');
  }
  jarl(root, 'review', '7', 'changes', '--by', 'rev', 'Important: the empty case fails');
  jarl(root, 'review', '8', 'approve', '--by', 'rev', 'Checked every acceptance line against the diff; nothing left open');
  const rows = (who) => json(root, 'next', '--as', who, '--all').rows.map((r) => [r.ids ? r.ids.join(',') : r.id, r.what, r.holder]);
  assert.deepEqual(rows('odin'), [['1', 'ready', 'odin'], ['6', 'review', 'odin'], ['7', 'changes', 'odin']]);
  assert.deepEqual(rows('THOR'), [['3', 'ready', 'thor'], ['5', 'worker', 'thor']], 'a name in any case; odin\'s open 1 does not reserve a.mjs against 3');
  assert.deepEqual(rows('jarl'), [['4', 'ready', 'jarl'], ['8', 'merge', 'jarl']], 'the issue in no slice, and the approve not merged');
  assert.match(jarl(root, 'next', '--as', 'odin'), /^On odin \(3\)\n- 1 odin first: ready to start, raise a worker — jarl\.mjs set 1 in-progress /);
  assert.match(jarl(root, 'next', '--as', 'odin'), /^- 6 odin proof: proof recorded, no verdict; raise a fresh reviewer for 6;/m);
  // A coordinator the line names whose slice has no issue says so, and so does one while the loop has no slice at all.
  jarl(root, 'goal', '--set', 'Coordinators: odin, thor, frey');
  assert.match(jarl(root, 'next', '--as', 'frey'), /^no issue carries slice:frey, so nothing of a slice is on frey: the issues in no slice are the jarl's \(jarl\.mjs next --as jarl\), and jarl\.mjs tag <ids> \+slice:frey gives frey its slice$/m);
  assert.doesNotMatch(jarl(root, 'next', '--as', 'odin'), /no issue carries/);
});

test('the issues waiting on a slice\'s issue, through After or a file it reserves, wait on its coordinator', () => {
  const root = twoSlices();
  jarl(root, 'new', 'after odin\'s first', '--after', '1', '--files', 'g.mjs');   // 6
  // 2 waits on 1 too: 1 reserves a.mjs within odin's slice.
  assert.deepEqual(json(root, 'next', '--as', 'odin', '--all').waiting.map((w) => [w.id, w.on, w.via]), [['2', 'odin', ['1']], ['6', 'odin', ['1']]]);
  assert.deepEqual(json(root, 'next', '--as', 'jarl', '--all').waiting, [], 'nothing waits on the jarl');
  assert.deepEqual(json(root, 'next', '--as', 'odin', '--all').rows.find((r) => r.id === '1').holdsUp, ['6']);
});

test('ask --kind escalation names its slice or issue, is held by the jarl, shows in the slice\'s views and holds its issue back', () => {
  const root = twoSlices();
  const before = readFileSync(join(root, '.jarl', 'profile.json'), 'utf8');
  assert.match(refuses(root, 'ask', 'is this ours?', '--kind', 'escalation'), /^an escalation names what it is about: --slice <coordinator> \(its slice\) or --issue <id>, or both$/m);
  assert.match(refuses(root, 'ask', 'is this ours?', '--slice', 'odin'), /^--slice goes with kind escalation only/m);
  assert.match(refuses(root, 'ask', 'is this ours?', '--kind', 'escalation', '--slice', 'loki'), /no coordinator loki on the goal's Coordinators line/);
  assert.equal(readFileSync(join(root, '.jarl', 'profile.json'), 'utf8'), before, 'a refusal raises nothing');
  assert.equal(json(root, 'profile').format, 2);
  const a = json(root, 'ask', 'thor blocks odin on a.mjs: which goes first?', '--kind', 'escalation', '--slice', 'odin', '--issue', '2');
  assert.deepEqual([a.id, a.kind, a.slice], ['1', 'escalation', 'odin']);
  assert.equal(json(root, 'profile').format, 3, 'an older reader refuses a kind it does not know: the first escalation raises the format');
  assert.match(readFileSync(join(root, '.jarl', 'asks.md'), 'utf8'), /^- \*\*a-1\*\* \(open\) · escalation · issue 2 · slice odin · thor blocks odin on a\.mjs: which goes first\?$/m);
  // The jarl holds it; the owner does not.
  const jarlRows = json(root, 'next', '--as', 'jarl', '--all').rows;
  const row = jarlRows.find((r) => r.ask === '1');
  assert.deepEqual([row.what, row.holder, row.holdsUp], ['escalation', 'jarl', ['2']]);
  assert.match(jarl(root, 'next', '--as', 'jarl'), /^- a-1 thor blocks odin on a\.mjs: which goes first\?: escalation from slice:odin on issue 2 — jarl\.mjs answer a-1 "<answer>" --by jarl · holds up 2$/m);
  assert.deepEqual(json(root, 'next', '--as', 'owner').rows, []);
  // The slice's views show it; another slice's do not; the owner's question count leaves it out.
  assert.equal(json(root, 'status', '--slice', 'odin').escalations, 1);
  assert.equal(json(root, 'status', '--slice', 'thor').escalations, 0);
  assert.equal(json(root, 'status').questions, 0);
  assert.match(jarl(root, 'status'), / · questions 0 · escalations 1$/m);
  assert.match(jarl(root, 'resume', '--slice', 'odin'), /^## Escalations to the jarl \(1\)\n- a-1 slice:odin issue 2 · thor blocks odin on a\.mjs: which goes first\?$/m);
  assert.deepEqual(json(root, 'resume', '--slice', 'thor').escalations, []);
  assert.equal(json(root, 'next', '--slice', 'odin', '--all').find((r) => r.id === '2').group, 'held-by-question');
  // One that names only an issue is in the view of the issue's slice.
  jarl(root, 'ask', 'is 3 in thor\'s goal?', '--kind', 'escalation', '--issue', '3');
  assert.equal(json(root, 'status', '--slice', 'thor').escalations, 1);
  // Answered with no --by, it is the jarl's ruling.
  jarl(root, 'answer', 'a-1', 'odin goes first');
  assert.match(readFileSync(join(root, '.jarl', 'decisions.md'), 'utf8'), /## \d{4}-\d{2}-\d{2} · ask-1\n[\s\S]*?\*\*By:\*\* jarl/);
  assert.equal(json(root, 'next', '--slice', 'odin', '--all').find((r) => r.id === '2').group, 'held-by-file', 'the answer releases the issue');
});

test('verify finds an escalation in a loop that is not in record format 3', () => {
  const root = twoSlices();
  jarl(root, 'ask', 'which first?', '--kind', 'escalation', '--slice', 'odin');
  writeFileSync(join(root, '.jarl', 'profile.json'), JSON.stringify({ 'jarl-profile': 1, format: 2 }));
  assert.match(run(root, ['verify']).stdout, /asks\.md a-1: an escalation is written in record format 3, and this loop is not in it/);
});

test('a loop holding an escalation is refused by the frozen reader of formats 1 and 2, which would refuse the kind it does not know', () => {
  const root = twoSlices();
  assert.equal(formatTwoJarl(root, 'list', {}).ok, true);
  jarl(root, 'ask', 'which first?', '--kind', 'escalation', '--slice', 'odin');
  const two = formatTwoJarl(root, 'list', {});
  assert.equal(two.ok, false);
  assert.match(two.error, /written for record format 3/);
});

test('the goal\'s Merger line names the one holder that raises the merger: every approve not merged is on it, in every slice', () => {
  const root = twoSlices();
  jarl(root, 'new', 'odin approved', '--tags', 'slice:odin', '--files', 'd.mjs');   // 6
  jarl(root, 'new', 'thor approved', '--tags', 'slice:thor', '--files', 'e.mjs');   // 7
  for (const id of ['6', '7']) {
    jarl(root, 'set', id, 'in-progress', 'go', '--worker', `w${id}`, '--branch', `jarl/${id}`);
    jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'green');
    jarl(root, 'review', id, 'approve', '--by', 'rev', 'Checked every acceptance line against the diff; nothing left open');
  }
  const merges = (who) => json(root, 'next', '--as', who, '--all').rows.filter((r) => r.what === 'merge').map((r) => r.id);
  assert.deepEqual(merges('jarl'), ['6', '7'], 'with no Merger line, the jarl');
  assert.match(jarl(root, 'goal', '--set', 'Merger: thor'), /^goal line added: Merger: thor$/);
  assert.deepEqual(merges('thor'), ['6', '7'], 'odin\'s approve too');
  assert.deepEqual(merges('odin'), []);
  assert.deepEqual(merges('jarl'), []);
  jarl(root, 'goal', '--set', 'Merger: jarl');
  assert.deepEqual(merges('jarl'), ['6', '7']);
  assert.match(refuses(root, 'goal', '--set', 'Merger: odin, thor'), /a Merger line names one holder, the jarl or one coordinator of the Coordinators line: it is "Merger: <name>"/);
  jarl(root, 'goal', '--set', 'Merger: loki');
  assert.match(run(root, ['verify']).stdout, /Merger: loki" — loki is neither the jarl nor a coordinator of the Coordinators line, so no holder of the loop raises its merger/);
});

test('with more than one slice in play, a lease on an issue that declares no Files or Resources is refused with the command to declare them', () => {
  const root = loop();
  jarl(root, 'goal', '--set', 'Coordinators: odin, thor');
  jarl(root, 'new', 'odin bare', '--tags', 'slice:odin');                     // 1
  jarl(root, 'new', 'thor files', '--tags', 'slice:thor', '--files', 'a.mjs'); // 2
  jarl(root, 'new', 'no slice, bare');                                         // 3
  const log = readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
  for (const id of ['1', '3']) {
    assert.match(refuses(root, 'set', id, 'in-progress', 'go', '--worker', 'w', '--branch', `jarl/${id}`), new RegExp(`^${id} declares no Files or Resources, and 2 slices are in play \\(slice:odin, slice:thor\\): across slices only leases hold, and a lease holds only what its issue declares — declare them first: jarl\\.mjs files ${id} <path>,… or jarl\\.mjs field ${id} Resources "<name>, …"$`, 'm'));
  }
  assert.equal(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), log, 'nothing was written');
  jarl(root, 'set', '2', 'in-progress', 'go', '--worker', 'w2', '--branch', 'jarl/2');
  jarl(root, 'field', '1', 'Resources', 'test-db');
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1', '--branch', 'jarl/1');
  // One slice in play: nothing to collide with across slices, and the lease goes through as before.
  const one = loop();
  jarl(one, 'new', 'odin bare', '--tags', 'slice:odin');
  jarl(one, 'new', 'thor done', '--tags', 'slice:thor');
  jarl(one, 'set', '2', 'dropped', 'not needed');
  jarl(one, 'set', '1', 'in-progress', 'go', '--worker', 'w1', '--branch', 'jarl/1');
});
