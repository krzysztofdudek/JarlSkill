// The texts the commands print and the lines a loop writes into its own files, read whole: each names the owner who
// rules, states the present property, and keeps no word of a past. A reader of the loop's files meets the same headings
// the commands print, and a file written under an earlier heading is still read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { jarl, refuses, loop, gitRepo } from './helpers.mjs';

test('a committed loop switched to permanent logs the property of the mode, read whole', () => {
  const { dir } = gitRepo();
  jarl(dir, 'init', 'goal', '--committed');
  jarl(dir, 'mode', 'permanent');
  const last = readFileSync(join(dir, '.jarl', 'log.md'), 'utf8').trimEnd().split('\n').at(-1);
  assert.match(last, /^- \d{4}-\d{2}-\d{2} \d{2}:\d{2} · mode → permanent · not tied to a feature branch; close keeps the directory$/);
});

test('an ask with a kind that does not exist says the owner decides a ratify item', () => {
  const root = loop();
  const err = refuses(root, 'ask', 'which way?', '--kind', 'bogus');
  assert.match(err, /ratify \(a choice already made under a mandate, awaiting the owner's word; blocks nothing\)/);
  assert.doesNotMatch(err, /\buser\b/);
});

test('a close with open issues says the owner is told them, and how to close anyway', () => {
  const root = loop();
  jarl(root, 'new', 'still open');
  assert.match(refuses(root, 'close'), /report them to the owner and run with --force/);
});

test('a loop written in a record format this Jarl does not read says what the reader needs, and names no upgrade', () => {
  const root = loop();
  writeFileSync(join(root, '.jarl', 'profile.json'), JSON.stringify({ 'jarl-profile': 1, format: 9 }));
  const err = refuses(root, 'list');
  assert.match(err, /is written for record format 9/);
  assert.match(err, /the reader needs a Jarl that knows format 9/);
  assert.doesNotMatch(err, /upgrad/);
});

test('a new asks.md opens under the owner heading', () => {
  const root = loop();
  jarl(root, 'ask', 'which way?');
  assert.equal(readFileSync(join(root, '.jarl', 'asks.md'), 'utf8').split('\n')[0], '# Questions to the owner');
});

test('an asks.md written under the earlier heading is still read, and its question shows under the owner heading', () => {
  const root = loop();
  writeFileSync(join(root, '.jarl', 'asks.md'), '# Questions to the user\n\n- **a-007** (open) · stuck · which one?\n');
  const resumed = jarl(root, 'resume');
  assert.match(resumed, /## Questions to the owner \(1\)\n- a-007 \(stuck\) · which one\?/);
  assert.doesNotMatch(resumed, /Questions to the user/);
});
