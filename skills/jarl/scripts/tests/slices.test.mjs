// Slices: the part of the backlog one coordinator runs is the issues tagged slice:<coordinator>, the coordinator a name
// of the goal's Coordinators line. An issue is in one slice at most, and the views say which coordinator runs which slice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jarl, refuses, loop as makeLoop } from './helpers.mjs';

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
