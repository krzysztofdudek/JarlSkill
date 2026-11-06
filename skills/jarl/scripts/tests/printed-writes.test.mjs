// A view is read by agents who paste what it prints: a command it prints that records state, or an act that is the
// owner's, must hold a placeholder of the registry where the fact or the person only the reader knows goes, so a line
// pasted as printed is refused and writes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FINDINGS } from './findings.mjs';
import { jarl, commandSpans, loop as makeLoop } from './helpers.mjs';
import * as J from '../jarl.mjs';
import * as L from '../jarl-lib.mjs';

const OWNER_LINE = '[owner] the cut reads well · material: renders/cut.txt · check: the pacing of the opening';

// One loop with an open thing of every kind a view lists: an issue at every step of the work, a merge whose CI is not
// green, a closed issue whose gate does not hold, an acceptance line only the owner ticks, a ruling that settles work
// nobody holds, a note that two issues are unordered, and a question of each kind.
function richLoop() {
  const root = makeLoop({ prefix: 'jarl-printed-writes-', via: 'cli' });
  appendFileSync(join(root, '.jarl', 'goal.md'), '\nCheck: npm test\nCoordinators: odin\n');
  mkdirSync(join(root, 'renders'));
  writeFileSync(join(root, 'renders', 'cut.txt'), 'the cut\n');
  const titles = ['ready one', 'leased one', 'proof no verdict', 'changes asked', 'approved', 'merged, CI pending', 'a dropped one with a merge', 'owner line'];
  titles.forEach((t, n) => jarl(root, 'new', t, '--files', `f${n + 1}.mjs`, '--acceptance', n === 7 ? OWNER_LINE : 'it works'));
  jarl(root, 'new', 'waits on the ready one', '--after', '1', '--files', 'f9.mjs', '--what', 'relies on issue 5 for its data');
  for (const id of ['2', '3', '4', '5', '6', '8']) jarl(root, 'set', id, 'in-progress', 'go', '--worker', `w${id}`, '--branch', `jarl/${id}`);
  for (const id of ['3', '4', '5', '6', '8']) jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'green');
  jarl(root, 'review', '4', 'changes', '--by', 'rev', 'Important: the empty list is not handled');
  jarl(root, 'review', '5', 'approve', '--by', 'rev', FINDINGS);
  jarl(root, 'review', '6', 'approve', '--by', 'rev', FINDINGS);
  jarl(root, 'merged', '6', '--sha', 'abc1234', '--ci', 'pending');
  jarl(root, 'set', '7', 'dropped', 'not needed');
  jarl(root, 'merged', '7', '--sha', 'def5678', '--ran', 'npm test', '--saw', 'pass');
  jarl(root, 'ask', 'which way?', '--kind', 'stuck', '--issue', '1');
  jarl(root, 'ask', 'ratify the naming', '--kind', 'ratify');
  jarl(root, 'ask', 'reports name their branch', '--kind', 'rule', '--applies-to', 'loop', '--to', 'owner');
  jarl(root, 'ask', 'reviewers run the suite', '--kind', 'rule', '--applies-to', 'role reviewer');
  jarl(root, 'ask', 'the slice cannot go on', '--kind', 'escalation', '--slice', 'odin');
  jarl(root, 'decide', 'orphan', 'A ruling that settles work nobody holds.', '--by', 'jarl', '--settles', '7');
  return root;
}

const VIEWS = [['status'], ['report'], ['resume'], ['next'], ['list'], ['verify'], ['show', '5'], ['show', '7'], ['status', '--as', 'jarl'], ['status', '--as', 'owner'], ['resume', '--as', 'jarl'], ['resume', '--as', 'owner'],
  ['next', '--as', 'jarl', '--all'], ['next', '--as', 'owner', '--all'], ['next', '--as', 'odin', '--all'], ['next', '--as', 'w3', '--all']];

// Every command the views print, as the text of the command, with the view that printed it.
function printedBy(root) {
  return VIEWS.flatMap((view) => commandSpans(jarl(root, ...view)).map((s) => ({ view: view.join(' '), command: s.raw })));
}
const holdsPlaceholder = (command) => L.PLACEHOLDERS.some((h) => command.includes(h));

test('a view prints no command that writes unless it holds a placeholder of the registry; a question put to the owner is the one act it prints whole', () => {
  const printed = printedBy(richLoop());
  const writes = printed.filter((p) => J.MUTATING.has(p.command.split(' ')[1]) && p.command.split(' ')[1] !== 'ask');
  assert.ok(writes.length > 20, `the views print commands that write: ${writes.length}`);
  assert.deepEqual(writes.filter((p) => !holdsPlaceholder(p.command)).map((p) => `${p.view}: ${p.command}`), []);
  // The one command of a view that is not a form is the question that asks the owner to start a fresh session.
  const asks = printed.filter((p) => p.command.split(' ')[1] === 'ask');
  assert.ok(asks.length >= 1 && asks.every((p) => /^jarl\.mjs ask 'start a fresh session to review issues? [\d, ]+'/.test(p.command)), asks.map((p) => p.command).join('\n'));
});

test('a view prints no act as the owner: every command of his names him with the placeholder, never --by owner', () => {
  const printed = printedBy(richLoop());
  assert.deepEqual(printed.filter((p) => /--by owner(\s|$)/.test(p.command)).map((p) => `${p.view}: ${p.command}`), []);
  const owners = printed.filter((p) => p.view === 'next --as owner --all').map((p) => p.command);
  for (const verb of ['answer a-1 ', 'answer a-2 ', 'answer a-3 ', 'tick 8 1 ']) assert.ok(owners.some((c) => c.includes(verb) && c.includes('--by "<the-owner-himself>"')), `${verb}: ${owners.join('\n')}`);
  // The form is refused as printed, and writes nothing.
  const root = richLoop();
  for (const c of owners.filter((x) => x.includes('<the-owner-himself>'))) {
    const words = c.replace(/^jarl\.mjs /, '').match(/"[^"]*"|'[^']*'|\S+/g).map((w) => w.replace(/^["']|["']$/g, ''));
    assert.throws(() => jarl(root, ...words), /<the-owner-himself>|<yes-or-reject-first>|<option>|<text>/, c);
  }
});

test('the line a view prints for a CI not recorded and for a closed issue whose gate does not hold are forms: the result and the reason are the reader\'s', () => {
  const root = richLoop();
  assert.match(jarl(root, 'next', '--as', 'jarl', '--all'), /^- 6 merged, CI pending: merged, its CI not green yet; record the result.* — jarl\.mjs merged 6 --ci "<ci-state>"$/m);
  assert.match(jarl(root, 'status'), /^closed, gate does not hold: 7 · a merge is recorded on a dropped issue — repair: jarl\.mjs set 7 open "<text>"$/m);
  assert.match(jarl(root, 'verify'), /order the two by adding it to After, which keeps what After holds: jarl\.mjs field 9 After "<ids-it-waits-on>" --add$/m);
});
