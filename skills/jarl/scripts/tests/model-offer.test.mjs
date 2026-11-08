// A loop whose goal declares no Model line is offered the lines once its first agent is leased: the jarl's list holds one
// row that names the tier of the jarl (strong) and of the coordinators (standard) and ends with the form of the goal line
// that adds them. A lease writes one log line to remember it (a view writes nothing), a lease that finds the lines
// present closes the offer, and a loop that never meets the case writes nothing new, so the pinned frozen readers read
// every loop as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as R from '../record.mjs';
import { fileAsBefore, formatTwoJarl, formatTwoJarlIsPinned, oldJarl, oldJarlIsPinned } from './old-jarl.mjs';
import { jarl, loop as makeLoop } from './helpers.mjs';

const loop = () => makeLoop({ prefix: 'jarl-offer-', goal: 'a goal' });
const goalFile = (root) => join(root, '.jarl', 'goal.md');
const log = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const offers = (root) => log(root).split('\n').filter((l) => / · models offered · /.test(l)).length;
const closes = (root) => log(root).split('\n').filter((l) => / · models offer closed · /.test(l)).length;
const rowOf = (root) => JSON.parse(jarl(root, 'next', '--as', 'jarl', '--all', '--json')).rows.find((r) => r.what === 'models');
const lease = (root, name) => {
  const { id } = R.newIssue(root, `change ${name}`, { files: `${name}.mjs` });
  R.setStatus(root, id, 'in-progress', '', { branch: `jarl/${id}-${name}`, worker: `w-${name}` });
  return id;
};

test('the first lease in a loop with no Model line is remembered once, and the jarl\'s list offers the lines with the tiers and the form', () => {
  const root = loop();
  const id = R.newIssue(root, 'change a', { files: 'a.mjs' }).id;
  assert.equal(rowOf(root), undefined, 'nothing is leased yet');
  assert.equal(offers(root), 0);
  R.setStatus(root, id, 'in-progress', '', { branch: `jarl/${id}-a`, worker: 'w-a' });
  assert.equal(offers(root), 1);
  lease(root, 'b');
  assert.equal(offers(root), 1, 'a second lease says nothing more');
  const row = rowOf(root);
  assert.equal(row.holder, 'jarl');
  assert.match(row.says, /^an agent is leased and the goal declares no Model line, so no model is placed and none ranked; add one line for each tier: Model \(strong\): <model-id> for the jarl, Model \(standard\): <model-id> for the coordinators$/);
  assert.equal(row.command, 'jarl.mjs goal --set "<machine-line>"');
  assert.match(jarl(root, 'next', '--as', 'jarl'), /^- models: an agent is leased and the goal declares no Model line.* — jarl\.mjs goal --set "<machine-line>"$/m);
  assert.deepEqual(JSON.parse(jarl(root, 'next', '--as', 'owner', '--json')).rows, [], 'the row is the jarl\'s alone');
});

test('no other view prints the offer', () => {
  const root = loop();
  lease(root, 'a');
  for (const args of [['status'], ['resume'], ['next'], ['list'], ['models'], ['report'], ['next', '--as', 'owner']]) {
    assert.doesNotMatch(jarl(root, ...args), /Model \(strong\)/, args.join(' '));
  }
  const before = log(root);
  for (const args of [['status'], ['resume'], ['next', '--as', 'jarl'], ['models']]) jarl(root, ...args);
  assert.equal(log(root), before, 'a view writes nothing');
});

test('a loop whose goal has Model lines writes nothing and is offered nothing', () => {
  const root = loop();
  appendFileSync(goalFile(root), '\nModel (strong): big-model\nModel (standard): mid-model\n');
  const before = log(root);
  lease(root, 'a');
  assert.equal(offers(root) + closes(root), 0);
  assert.equal(rowOf(root), undefined);
  assert.equal(log(root).split('\n').filter((l) => /models offer/.test(l)).length, 0);
  assert.ok(log(root).startsWith(before));
});

test('the row goes when the lines are added, a lease then closes the offer, and the offer is made again only when the lines are gone and another lease happens', () => {
  const root = loop();
  lease(root, 'a');
  assert.ok(rowOf(root));
  const bare = readFileSync(goalFile(root), 'utf8');
  assert.equal(jarl(root, 'goal', '--set', 'Model (strong): big-model').includes('Model'), true);
  assert.equal(rowOf(root), undefined, 'the lines are there');
  lease(root, 'b');
  assert.equal(closes(root), 1, 'a lease that finds the lines closes the offer');
  lease(root, 'c');
  assert.equal(closes(root), 1, 'and only once');
  writeFileSync(goalFile(root), bare);
  assert.equal(rowOf(root), undefined, 'lines removed, no lease since: the offer stays closed');
  lease(root, 'd');
  assert.equal(offers(root), 2);
  assert.ok(rowOf(root), 'offered again');
  lease(root, 'e');
  assert.equal(offers(root), 2, 'once for each');
});

test('the frozen readers of the earlier formats read a loop that carries the offer, and the format stays', () => {
  assert.ok(oldJarlIsPinned() && formatTwoJarlIsPinned());
  const root = loop();
  const id = fileAsBefore(root, 'a thing', { acceptance: 'it works' });
  R.setStatus(root, id, 'in-progress', '', { branch: `jarl/${id}-a`, worker: 'w-a' });
  assert.equal(offers(root), 1);
  for (const [version, reader] of [['6.1.0', oldJarl], ['6.2.0', formatTwoJarl]]) {
    for (const command of ['list', 'status', 'next', 'queue']) assert.equal(reader(root, command, {}).ok, true, `${version} ${command}`);
  }
  assert.equal(existsSync(join(root, '.jarl', 'profile.json')), false, 'no marker: the format stays');
  assert.equal(R.loadProfile(root).format, 1);
});
