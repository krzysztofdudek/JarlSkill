// A command that needs a loop, run where there is none, says so and ends with its own form naming the root, instead of
// failing on a missing file or on an issue that cannot exist. Nothing is written, and no .jarl/ appears.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jarl, refuses, posixForms } from './helpers.mjs';

const mcp = await import('../jarl-mcp.mjs');

const empty = () => mkdtempSync(join(tmpdir(), 'jarl-no-loop-'));

// Every command that writes the loop, with a call that is right in every other way.
const WRITING = [
  ['new', 'a title'], ['renumber', '1'], ['import', 'findings.md'], ['set', '1', 'done', 'finished'], ['field', '1', 'Why', 'because'],
  ['split', '1'], ['base', 'name', 'main'], ['merged', '1', '--sha', 'abcd1234'], ['evidence', '1', 'a note'],
  ['retract', '1', '1', 'it was read wrongly', '--by', 'w'], ['review', '1', 'approve', 'read the diff and found nothing', '--by', 'r'],
  ['round', '1', 'the test failed again'], ['tick', '1', 'a line', '--by', 'owner'], ['ask', 'a question'], ['answer', 'a-1', 'yes', '--by', 'owner'],
  ['log', 'a note'], ['decide', 'a-slug', 'a ruling', '--by', 'jarl'], ['goal', '--set', 'a goal'], ['archive', 'a-slug'], ['mode', 'manual'], ['close'],
];
// The view that reads it and refuses where none is; the other views read an empty loop there.
const READING = [['resume']];

for (const call of [...WRITING, ...READING]) {
  test(`${call[0]} where there is no loop says so and ends with its form naming the root`, () => {
    const dir = empty();
    const said = refuses(dir, ...call).trim().split('\n');
    assert.match(said[0], /^no loop here: .*\S+ holds no \.jarl\/ — open one with jarl\.mjs init "<goal>"( --root \S+)?, or pass --root "<loop-root>", the directory that holds \.jarl\/$/);
    assert.equal(said.length, 2, said.join('\n'));
    assert.equal(said[1], 'jarl.mjs init "<goal>"');
    assert.deepEqual(readdirSync(dir), [], 'nothing was written');
  });
}

test('the tools say there is no loop where a root holds none, with the form naming the root', () => {
  const dir = empty();
  for (const [tool, args] of [['jarl_ask', { text: 'a question' }], ['jarl_log', { text: 'a note' }], ['jarl_decide', { slug: 'a-slug', text: 'a ruling', by: 'jarl' }]]) {
    const said = mcp.callTool(tool, { ...args, root: dir });
    assert.ok(said.isError, tool);
    assert.match(posixForms(said.content[0].text), /^no loop here: .*\S+ holds no \.jarl\/ — open one with jarl\.mjs init "<goal>" '--root=[^']+', or pass --root "<loop-root>", the directory that holds \.jarl\/\njarl\.mjs init "<goal>" '--root=[^']+'$/, tool);
  }
  assert.deepEqual(readdirSync(dir), []);
});

test('the commands that run without a loop still do', () => {
  const dir = empty();
  assert.match(refuses(dir, 'init').trim(), /init requires its goal/);
  assert.match(refuses(dir, 'models').trim(), /no loop to read here/);
  assert.equal(jarl(dir, 'list'), '(none)');
  assert.match(jarl(dir, 'status'), /^open 0/);
});
