// A ratify item is the owner's: only an answer --by owner records it, and an answer --by anyone else is refused before
// anything is written, ending with the form of the call. An ordinary question is answered by whoever --by names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jarl, refuses, loop as makeLoop } from './helpers.mjs';

const loop = () => makeLoop({ prefix: 'jarl-ratify-answer-', via: 'cli' });
const record = (root) => ['asks.md', 'decisions.md', 'log.md'].map((f) => readFileSync(join(root, '.jarl', f), 'utf8')).join('\n----\n');

test('a ratify item is answered only --by owner: any other name is refused with the form, and nothing is written', () => {
  const root = loop();
  jarl(root, 'ask', 'raised the limit to 20', '--kind', 'ratify');
  jarl(root, 'decide', 'r', 'A rule.', '--by', 'jarl', '--area', 'svc', '--reach', '3');
  const batch = JSON.parse(jarl(root, 'close', '--batch', '--json')).batch.items[0].ask;
  const before = record(root);
  for (const id of ['a-1', batch]) {
    for (const name of ['Jane Doe', 'w-jarl-007', 'reviewer']) {
      const said = refuses(root, 'answer', id, 'yes', '--by', name);
      assert.match(said, new RegExp(`^${id} is a ratify item: it is the owner's to ratify or reject, and only his answer is recorded, --by owner \\(got "${name}"\\)\\njarl\\.mjs answer "<question>" "<text>" --by "<the-owner-himself>"\\n$`), said);
    }
  }
  assert.equal(record(root), before, 'a refused answer writes nothing');
  assert.match(jarl(root, 'answer', 'a-1', 'yes', '--by', 'owner'), /a-1/);
  assert.match(jarl(root, 'answer', batch, 'tak', '--by', 'owner'), /r ratified/);
  assert.equal(JSON.parse(jarl(root, 'decisions', '--json')).find((d) => d.slug === 'ask-1').by, 'owner');
});

test('an ordinary question is answered by whoever --by names, in any words', () => {
  const root = loop();
  jarl(root, 'ask', 'which database?');
  jarl(root, 'ask', 'raised the limit', '--kind', 'ratify');
  jarl(root, 'answer', 'a-1', 'Postgres, for now', '--by', 'Jane Doe');
  assert.equal(JSON.parse(jarl(root, 'decisions', '--json')).find((d) => d.slug === 'ask-1').by, 'Jane Doe');
  assert.match(refuses(root, 'answer', 'a-1,a-2', 'yes', '--by', 'owner'), /answered together only when each is a ratify item/);
});
