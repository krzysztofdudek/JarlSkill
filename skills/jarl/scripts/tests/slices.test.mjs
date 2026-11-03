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
