// A loop whose goal declares no Model line is offered the lines by the lease that raises its first agent, once: the answer
// of that lease names the tier of the jarl (strong) and of the coordinators (standard) and ends with the form of the goal
// line that adds them, and one log line remembers it. No view holds the offer. A lease that records no model raises nobody
// and says nothing, and a note in the shape of a line the lease writes is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as R from '../record.mjs';
import { jarl, refuses, run, loop as makeLoop } from './helpers.mjs';

const loop = () => makeLoop({ prefix: 'jarl-offer-', goal: 'a goal', via: 'cli', dotGit: false });
const goalFile = (root) => join(root, '.jarl', 'goal.md');
const log = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const count = (root, word) => log(root).split('\n').filter((l) => l.includes(` · ${word} · `)).length;
const offers = (root) => count(root, 'models offered');
const closes = (root) => count(root, 'models offer closed');
const OFFER = /^note: \S+ is leased with a model and the goal declares no Model line, so no model is placed and none ranked; add one line for each tier: Model \(strong\): <model-id> for the jarl, Model \(standard\): <model-id> for the coordinators — jarl\.mjs goal --set "<machine-line>" --by "<who>"$/m;
let seq = 0;
// A lease through the command line; `model` is the model of the agent raised for it.
const lease = (root, { model = 'some-model' } = {}) => {
  seq += 1;
  const id = JSON.parse(jarl(root, 'new', `change ${seq}`, '--acceptance', '[read] it works', '--files', `f${seq}.mjs`, '--json')).id;
  if (!model) { R.setStatus(root, id, 'in-progress', 'go', { worker: `w${seq}`, branch: `jarl/${id}-x`, by: 'jarl' }); return { stderr: '' }; }
  const args = ['set', id, 'in-progress', 'go', '--worker', `w${seq}`, '--branch', `jarl/${id}-x`, '--model', model];
  return run(root, args);
};

test('the lease that raises the first agent says the offer, once, and writes one log line', () => {
  const root = loop();
  const first = lease(root);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stderr, OFFER);
  assert.equal(offers(root), 1);
  const second = lease(root);
  assert.doesNotMatch(second.stderr, /Model \(strong\)/, 'the second lease says nothing more');
  assert.equal(offers(root), 1);
});

test('no view holds the offer', () => {
  const root = loop();
  lease(root);
  for (const args of [['status'], ['resume'], ['next'], ['list'], ['models'], ['report'], ['next', '--as', 'jarl'], ['next', '--as', 'owner'], ['status', '--as', 'jarl'], ['resume', '--as', 'jarl']]) {
    assert.doesNotMatch(jarl(root, ...args), /Model \(strong\)/, args.join(' '));
  }
  assert.deepEqual(JSON.parse(jarl(root, 'next', '--as', 'jarl', '--all', '--json')).rows.filter((r) => r.what === 'models'), []);
  const before = log(root);
  for (const args of [['status'], ['resume'], ['next', '--as', 'jarl'], ['models']]) jarl(root, ...args);
  assert.equal(log(root), before, 'a view writes nothing');
});

test('a lease that records no model raises nobody: it says nothing and writes nothing, and the first lease with a model still offers', () => {
  const root = loop();
  const alone = lease(root, { model: null });
  assert.doesNotMatch(alone.stderr, /Model \(strong\)/);
  assert.equal(offers(root), 0);
  const raised = lease(root);
  assert.match(raised.stderr, OFFER);
  assert.equal(offers(root), 1);
});

test('a loop whose goal has Model lines is told and writes nothing', () => {
  const root = loop();
  appendFileSync(goalFile(root), '\nModel (strong): big-model\nModel (standard): mid-model\n');
  const r = lease(root);
  assert.doesNotMatch(r.stderr, /Model \(strong\)/);
  assert.equal(offers(root) + closes(root), 0);
});

test('the lines added close the offer at the next lease, and the offer is made again only after the lines are gone and a lease raises another agent', () => {
  const root = loop();
  const bare = readFileSync(goalFile(root), 'utf8');
  lease(root);
  assert.equal(jarl(root, 'goal', '--set', 'Model (strong): big-model').includes('Model'), true);
  lease(root);
  assert.equal(closes(root), 1, 'a lease that finds the lines closes the offer');
  lease(root);
  assert.equal(closes(root), 1, 'once');
  writeFileSync(goalFile(root), bare);
  const again = lease(root);
  assert.match(again.stderr, OFFER, 'offered again');
  assert.equal(offers(root), 2);
  assert.doesNotMatch(lease(root).stderr, /Model \(strong\)/);
});

test('a note in the shape of a line the lease or the path note writes is refused, so it opens and closes nothing', () => {
  const root = loop();
  for (const text of ['models offered · the goal declares no Model line at a lease', 'models offer closed · the goal declares a Model line at a lease', 'repo path ./inner noted · elsewhere']) {
    const said = refuses(root, 'log', text);
    assert.match(said, /^log writes a note, and ".*" has the shape of a line (a lease|a filing or a field call) writes to remember what it said: /, text);
    assert.match(said, /\njarl\.mjs (set "<ids>" "<status>" "<why>"|field "<id>" Repo "<name-or-path>") --by "<who>"\n$/, text);
  }
  assert.equal(offers(root) + closes(root), 0);
  assert.equal(log(root).includes('repo path'), false);
  assert.match(lease(root).stderr, OFFER, 'the first real lease still offers');
  assert.throws(() => R.appendLog(root, 'models offered · typed by hand'), /has the shape of a line a lease writes/, 'a composer\'s free note is refused the same way');
});
