// A loop with no coordinators line and no goal line beyond the goal: the proofs of code that no one has reviewed are
// listed once on the jarl, with the way to ask the owner for a fresh session; once that question is open the ball is
// the owner's, and his digest names the issues.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FINDINGS } from './findings.mjs';
import { jarl, loop as makeLoop } from './helpers.mjs';

const loop = () => makeLoop({ prefix: 'jarl-lone-', via: 'cli', dotGit: false });
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const ASK = "jarl.mjs ask 'start a fresh session to review issues 1, 2'";

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

test('proofs of code with no verdict are one line on the jarl: one fresh reviewer per unit, or ask the owner for a fresh session', () => {
  const root = loneLoop();
  const o = json(root, 'next', '--as', 'jarl', '--all');
  const group = o.rows.find((r) => r.what === 'review' && r.ids);
  assert.deepEqual(group.ids, ['1', '2']);
  assert.equal(group.says, 'proof recorded, no verdict; raise one fresh reviewer per unit: 1 · 2; if you cannot raise agents, ask the owner to start a fresh session');
  assert.ok(group.command.includes(ASK), group.command);
  assert.deepEqual(group.holdsUp, ['4']);
  assert.deepEqual(o.rows.filter((r) => r.what === 'review').map((r) => r.id), ['1', '3'], 'the proof of the issue without code keeps its own line');
  const text = jarl(root, 'next', '--as', 'jarl', '--all');
  assert.match(text, new RegExp(`^- 1, 2: proof recorded, no verdict; raise one fresh reviewer per unit: 1 · 2; if you cannot raise agents, ask the owner to start a fresh session \\(1 first change, worker me; 2 second change, worker me\\) — jarl\\.mjs review "<ids>" "<verdict>" --by "<reviewer>" "<text>", or ${ASK.replace(/[.\\"]/g, '\\$&')} · holds up 4$`, 'm'));
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
  assert.match(digest, /^- a-1 start a fresh session to review issues 1, 2: question \(stuck\), the fresh review of 1, 2 waits on it — jarl\.mjs answer a-1 "<text>" --by "<the-owner-himself>" · holds up 4$/m);
  assert.match(digest, /^Waiting on the owner \(1\)\n- 4 after the first: waits on the owner via 1$/m);
  const text = jarl(root, 'next', '--as', 'jarl', '--all');
  assert.match(text, /^On the jarl \(1\)$/m);
  assert.doesNotMatch(text, /Waiting on the jarl/);
});

test('a question holds only the issues cited right after "issues", joined by commas, "and" or "&": no later number, version or sentence', () => {
  const root = loneLoop();
  jarl(root, 'new', 'third change', '--files', 'e.mjs');
  jarl(root, 'new', 'fourth change', '--files', 'f.mjs');
  jarl(root, 'set', '5', 'in-progress', 'go', '--worker', 'me', '--branch', 'jarl/5');
  jarl(root, 'set', '6', 'in-progress', 'go', '--worker', 'me', '--branch', 'jarl/6');
  jarl(root, 'evidence', '5', '--ran', 'npm test', '--saw', 'green');
  jarl(root, 'evidence', '6', '--ran', 'npm test', '--saw', 'green');
  const grouped = () => json(root, 'next', '--as', 'jarl', '--all').rows.filter((r) => r.ids).map((r) => r.ids);
  assert.deepEqual(grouped(), [['1', '2', '5', '6']]);
  jarl(root, 'ask', 'start a fresh session to review issues 1 and 2 before 5 lands. It waits on 6.3.0 and 6');
  assert.deepEqual(grouped(), [['5', '6']], 'a number after the list, after a period, or in a version stays with the jarl');
  jarl(root, 'answer', '1', 'done', '--by', 'owner');
  jarl(root, 'ask', 'start a fresh session to review issues 1, 2 & 5, then 6.3.0');
  assert.deepEqual(grouped(), [['6']], 'a comma and an ampersand join the list; the version ends it');
  jarl(root, 'answer', '2', 'done', '--by', 'owner');
  jarl(root, 'ask', 'start a fresh session to review issues 6.3.0');
  assert.deepEqual(grouped(), [['1', '2', '5', '6']], 'a version is no issue number');
});

test('a question holds the one list right after "issues": a later issue, hash number, task or version is not asked about', () => {
  const root = loneLoop();
  jarl(root, 'new', 'third change', '--files', 'e.mjs');
  jarl(root, 'set', '5', 'in-progress', 'go', '--worker', 'me', '--branch', 'jarl/5');
  jarl(root, 'evidence', '5', '--ran', 'npm test', '--saw', 'green');
  const grouped = () => json(root, 'next', '--as', 'jarl', '--all').rows.filter((r) => r.ids).map((r) => r.ids);
  const later = ['1 and 2 before issue 5 lands', '1, 2; #5 is next', '1, 2. Task 5 waits on them', '1, 2 (they hold up issue 5)', '1 & 2, then issues 5, 6.3.0'];
  for (const [n, tail] of later.entries()) {
    jarl(root, 'ask', `start a fresh session to review issues ${tail}`);
    assert.deepEqual(grouped(), [['5']], tail);
    jarl(root, 'answer', String(n + 1), 'done', '--by', 'owner');
  }
});

test('a question about one issue reads "issue", and a question whose issues all have a verdict holds nothing', () => {
  const root = loop();
  jarl(root, 'new', 'only change', '--files', 'a.mjs');
  jarl(root, 'new', 'after it', '--after', '1', '--files', 'b.mjs');
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'me', '--branch', 'jarl/1');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'green');
  const row = json(root, 'next', '--as', 'jarl').rows[0];
  assert.ok(row.command.endsWith("jarl.mjs ask 'start a fresh session to review issue 1'"), row.command);
  assert.match(row.says, /raise a fresh reviewer for 1;/);
  jarl(root, 'ask', 'start a fresh session to review issue 1');
  assert.deepEqual(json(root, 'next', '--as', 'owner').rows.map((r) => [r.reviewing, r.holdsUp]), [[['1'], ['2']]]);
  jarl(root, 'review', '1', 'approve', '--by', 'rev', FINDINGS);
  const owner = json(root, 'next', '--as', 'owner', '--all');
  assert.deepEqual(owner.rows.map((r) => [r.reviewing, r.holdsUp]), [[undefined, []]], 'the reviewed issue no longer waits on him');
  assert.match(owner.rows[0].says, /no issue it names awaits a review now/);
  assert.equal(owner.waitingTotal, 0);
});

test('a proof recorded after the question is asked is the jarl\'s again, and the answered question gives the ball back', () => {
  const root = loneLoop();
  jarl(root, 'ask', 'start a fresh session to review issues 1, 2');
  jarl(root, 'new', 'third change', '--files', 'e.mjs');
  jarl(root, 'set', '5', 'in-progress', 'go', '--worker', 'me', '--branch', 'jarl/5');
  jarl(root, 'evidence', '5', '--ran', 'npm test', '--saw', 'green');
  assert.deepEqual(json(root, 'next', '--as', 'jarl', '--all').rows.filter((r) => r.ids).map((r) => r.ids), [['5']]);
  jarl(root, 'answer', '1', 'reviewed in a fresh session', '--by', 'owner');
  assert.deepEqual(json(root, 'next', '--as', 'jarl', '--all').rows.filter((r) => r.ids).map((r) => r.ids), [['1', '2', '5']]);
  assert.deepEqual(json(root, 'next', '--as', 'owner', '--all').rows, []);
});

test('a ratify item or an escalation worded as the question for a fresh session holds no review: only a plain question does', () => {
  const root = loneLoop();
  const grouped = () => json(root, 'next', '--as', 'jarl', '--all').rows.filter((r) => r.ids).map((r) => r.ids);
  jarl(root, 'ask', 'start a fresh session to review issues 1, 2', '--kind', 'ratify');
  assert.deepEqual(grouped(), [['1', '2']], 'a ratify item blocks nothing, so the review stays with the jarl');
  const owner = json(root, 'next', '--as', 'owner', '--all');
  assert.deepEqual(owner.rows.map((r) => [r.what, r.reviewing, r.holdsUp]), [['ratify', undefined, []]]);
  jarl(root, 'answer', '1', 'yes', '--by', 'owner');
  jarl(root, 'ask', 'start a fresh session to review issues 1, 2', '--kind', 'escalation', '--issue', '1');
  assert.deepEqual(grouped(), [['1', '2']], 'an escalation is the jarl\'s own row and holds no review either');
});

test('a list written without a space after the comma holds the same issues as one written with it', () => {
  const root = loneLoop();
  const grouped = () => json(root, 'next', '--as', 'jarl', '--all').rows.filter((r) => r.ids).map((r) => r.ids);
  jarl(root, 'ask', 'start a fresh session to review issues 1,2');
  assert.deepEqual(grouped(), [], 'both issues are asked about');
  assert.deepEqual(json(root, 'next', '--as', 'owner', '--all').rows.map((r) => r.reviewing), [['1', '2']]);
});

test('a line for several proofs names each issue with its title and its worker', () => {
  const root = loop();
  jarl(root, 'new', 'first change', '--files', 'a.mjs');
  jarl(root, 'new', 'second change', '--files', 'b.mjs');
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'me', '--branch', 'jarl/1');
  jarl(root, 'set', '2', 'in-progress', 'go', '--worker', 'you', '--branch', 'jarl/2');
  for (const id of ['1', '2']) jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'green');
  const row = json(root, 'next', '--as', 'jarl', '--all').rows.find((r) => r.ids);
  assert.deepEqual(row.issues, [{ id: '1', title: 'first change', doer: 'me' }, { id: '2', title: 'second change', doer: 'you' }]);
  assert.match(jarl(root, 'next', '--as', 'jarl', '--all'), /^- 1, 2: proof recorded, no verdict; raise one fresh reviewer per unit: 1 · 2; if you cannot raise agents, ask the owner to start a fresh session \(1 first change, worker me; 2 second change, worker you\) — /m);
});
