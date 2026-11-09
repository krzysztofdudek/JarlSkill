// A write names its writer, so every write the tool prints for someone to run carries --by: the writer's name where the
// record holds who runs it, and the placeholder where it does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jarl, loop, posixForms } from './helpers.mjs';
import { MUTATING } from '../jarl.mjs';
import { TOOL_OPTIONS } from '../jarl-mcp.mjs';
import { jarlLine } from '../lib/base.mjs';

const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
// The printed writes of a text that name no writer, each cut at the end of its line.
function unsigned(text) {
  return text.split('jarl.mjs ').slice(1).map((s) => s.split('\n')[0]).filter((s) => {
    const cmd = s.split(/[\s"]/)[0];
    return MUTATING.has(cmd) && !(cmd === 'goal' && !/--set/.test(s)) && !/--by[ =]/.test(s);
  });
}
const writesIn = (text) => text.split('jarl.mjs ').slice(1).filter((s) => MUTATING.has(s.split(/[\s"]/)[0])).length;

// A loop with an issue in each state a printed write is offered for.
function busy() {
  const root = loop({ prefix: 'jarl-printed-', via: 'cli' });
  for (const t of ['ready', 'flight', 'approved', 'red']) jarl(root, 'new', t, '--acceptance', '[read] it works', '--files', `${t}.mjs`);
  jarl(root, 'set', '2', 'in-progress', 'go', '--branch', 'jarl/2', '--worker', 'w2');
  jarl(root, 'set', '3', 'in-progress', 'go', '--branch', 'jarl/3', '--worker', 'w3');
  jarl(root, 'evidence', '3', '--line', '1', '--ran', 'npm test', '--saw', 'pass 3');
  jarl(root, 'review', '3', 'approve', '--by', 'rev-a', 'read the diff and the rows, nothing found');
  jarl(root, 'set', '4', 'in-progress', 'go', '--branch', 'jarl/4', '--worker', 'w4');
  return root;
}

test('a write printed by the common printer carries the placeholder of its writer, a read and a read of the goal none, and a named writer stays', () => {
  assert.equal(jarlLine('set', '<ids>', 'done', '<why>'), 'jarl.mjs set "<ids>" done "<why>" --by "<who>"');
  assert.equal(jarlLine('round', '1', '<text>', '--by', 'jarl'), 'jarl.mjs round 1 "<text>" --by jarl');
  assert.equal(jarlLine('list', '--all'), 'jarl.mjs list --all');
  assert.equal(jarlLine('goal'), 'jarl.mjs goal');
  assert.equal(jarlLine('goal', '--set', '<machine-line>'), 'jarl.mjs goal --set "<machine-line>" --by "<who>"');
  assert.equal(posixForms(jarlLine('evidence', '--', '<ids>', '<text>')), 'jarl.mjs evidence --by "<who>" -- "<ids>" "<text>"', 'quoted on Windows, where PowerShell reads a bare -- as its own');
});

test('every write next prints names its writer, and the holder of the row where the record holds one', () => {
  const root = busy();
  const rows = json(root, 'next', '--as', 'jarl', '--all').rows;
  const commands = rows.map((r) => r.command).join('\n');
  assert.ok(writesIn(commands) >= 2, commands);
  assert.deepEqual(unsigned(commands), []);
  const ready = rows.find((r) => r.what === 'ready');
  assert.match(ready.command, /^jarl\.mjs set 1 in-progress --branch "<branch>" --worker "<name>" --model "<model-id>" --by jarl\b/);
  const merge = rows.find((r) => r.what === 'merge');
  assert.match(merge.command, /^jarl\.mjs merged 3 --sha "<sha>" .*--by jarl/);
  assert.deepEqual(unsigned(jarl(root, 'next', '--as', 'jarl', '--all')), []);
});

test('every write a brief prints names its writer: the worker\'s, the goal\'s merger, or the placeholder', () => {
  const root = busy();
  const views = [jarl(root, 'brief', '2'), jarl(root, 'brief', '3', '--role', 'reviewer'), jarl(root, 'brief', '--role', 'merger')];
  for (const text of views) assert.deepEqual(unsigned(text), [], text);
  assert.ok(writesIn(views[2]) >= 6, views[2]);
  assert.match(views[2], /jarl\.mjs set "<id>" done "<text>" --by "<who>"/);
  jarl(root, 'goal', '--set', 'Merger: the-merger');
  assert.match(jarl(root, 'brief', '--role', 'merger'), /jarl\.mjs set "<id>" done "<text>" --by the-merger/);
});

test('the replies and the views name the writer of what they offer: the jarl for the round after a changes verdict', () => {
  const root = busy();
  const reply = jarl(root, 'review', '4', 'changes', '--by', 'rev-a', 'Important: the case is missing');
  assert.match(reply, /jarl\.mjs round 4 "<text>" --by jarl/);
  for (const text of [reply, jarl(root, 'resume'), jarl(root, 'status'), jarl(root, 'show', '1')]) assert.deepEqual(unsigned(text), [], text);
});

test('every example of a writing tool names its writer, and the verdict its model', () => {
  for (const [tool, field] of [['evidence', 'ran'], ['evidence', 'saw'], ['field', 'add'], ['field', 'remove'], ['review', 'verdict'], ['review', 'text'], ['decide', 'supersedes']]) {
    const example = JSON.parse(TOOL_OPTIONS.fieldNote(tool, field).match(/Example: (\{.*\})/)[1]);
    assert.equal(typeof example.by, 'string', `${tool} ${field}`);
    if (tool === 'review') assert.equal(typeof example.model, 'string', field);
  }
});
