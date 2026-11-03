// A loop with no coordinators line and no goal line beyond the goal: the proofs of code that no one has reviewed are
// listed once on the jarl, with the way to ask the owner for a fresh session; once that question is open the ball is
// the owner's, and his digest names the issues.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jarl, loop as makeLoop } from './helpers.mjs';

const loop = () => makeLoop({ prefix: 'jarl-lone-', via: 'cli', dotGit: false });
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const ASK = 'jarl.mjs ask "start a fresh session to review issues 1, 2"';

// 1 and 2 carry code (a branch) and have proof with no verdict; 3 has no branch and proof with no verdict; 4 waits on 1.
function loneLoop() {
  const root = loop();
  jarl(root, 'new', 'first change', '--files', 'a.mjs');
  jarl(root, 'new', 'second change', '--files', 'b.mjs');
  jarl(root, 'new', 'a note', '--files', 'c.md');
  jarl(root, 'new', 'after the first', '--after', '1', '--files', 'd.mjs');
  for (const id of ['1', '2']) jarl(root, 'set', id, 'in-progress', 'go', '--worker', 'me', '--branch', `jarl/${id}`);
  jarl(root, 'set', '3', 'in-progress', 'go', '--worker', 'me');
  for (const id of ['1', '2', '3']) jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'green');
  return root;
}

test('proofs of code with no verdict are one line on the jarl: raise a fresh reviewer for them, or ask the owner for a fresh session', () => {
  const root = loneLoop();
  const o = json(root, 'next', '--as', 'jarl', '--all');
  const group = o.rows.find((r) => r.what === 'review' && r.ids);
  assert.deepEqual(group.ids, ['1', '2']);
  assert.equal(group.says, 'proof recorded, no verdict; raise a fresh reviewer for 1, 2; if you cannot raise agents, ask the owner to start a fresh session');
  assert.ok(group.command.includes(ASK), group.command);
  assert.deepEqual(group.holdsUp, ['4']);
  assert.deepEqual(o.rows.filter((r) => r.what === 'review').map((r) => r.id), ['1', '3'], 'the proof of the issue without code keeps its own line');
  const text = jarl(root, 'next', '--as', 'jarl', '--all');
  assert.match(text, new RegExp(`^- 1, 2: proof recorded, no verdict; raise a fresh reviewer for 1, 2; if you cannot raise agents, ask the owner to start a fresh session — jarl\\.mjs review <id> approve\\|changes --by <reviewer> "<findings>", or ${ASK.replace(/[.\\"]/g, '\\$&')} · holds up 4$`, 'm'));
  assert.match(text, /^- 3 a note: proof recorded, no verdict; raise a reviewer \(worker me\) — jarl\.mjs review 3 /m);
  assert.deepEqual(json(root, 'next', '--as', 'owner', '--all').rows, []);
});

test('once the question for a fresh session is asked, the owner holds the ball and his digest names the issues', () => {
  const root = loneLoop();
  jarl(root, 'ask', 'start a fresh session to review issues 1, 2');
  const mine = json(root, 'next', '--as', 'jarl', '--all');
  assert.deepEqual(mine.rows.filter((r) => r.ids), [], 'nothing about 1 and 2 stays on the jarl');
  assert.ok(!mine.rows.some((r) => ['1', '2'].includes(r.id)));
  const owner = json(root, 'next', '--as', 'owner', '--all');
  assert.deepEqual(owner.rows.map((r) => [r.ask, r.what, r.reviewing, r.holdsUp]), [['1', 'question', ['1', '2'], ['4']]]);
  const digest = jarl(root, 'next', '--as', 'owner', '--all');
  assert.match(digest, /^- a-1 start a fresh session to review issues 1, 2: question \(stuck\), the fresh review of 1, 2 waits on it — jarl\.mjs answer a-1 "<answer>" · holds up 4$/m);
  assert.match(digest, /^Waiting on the owner \(1\)\n- 4 after the first: waits on the owner via 1$/m);
  const text = jarl(root, 'next', '--as', 'jarl', '--all');
  assert.match(text, /^On the jarl \(1\)$/m);
  assert.doesNotMatch(text, /Waiting on the jarl/);
});

test('a proof recorded after the question is asked is the jarl\'s again, and the answered question gives the ball back', () => {
  const root = loneLoop();
  jarl(root, 'ask', 'start a fresh session to review issues 1, 2');
  jarl(root, 'new', 'third change', '--files', 'e.mjs');
  jarl(root, 'set', '5', 'in-progress', 'go', '--worker', 'me', '--branch', 'jarl/5');
  jarl(root, 'evidence', '5', '--ran', 'npm test', '--saw', 'green');
  assert.deepEqual(json(root, 'next', '--as', 'jarl', '--all').rows.filter((r) => r.ids).map((r) => r.ids), [['5']]);
  jarl(root, 'answer', '1', 'reviewed in a fresh session');
  assert.deepEqual(json(root, 'next', '--as', 'jarl', '--all').rows.filter((r) => r.ids).map((r) => r.ids), [['1', '2', '5']]);
  assert.deepEqual(json(root, 'next', '--as', 'owner', '--all').rows, []);
});
