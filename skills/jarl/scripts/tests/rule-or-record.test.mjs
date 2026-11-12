// A ruling meant for agents reaches nobody unless it names whom it applies to: decide says so when an instruction has no
// scope, and a rule is delivered as the instruction alone, with none of the lines that record how it came to be.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { jarl, run, loop as makeLoop } from './helpers.mjs';
import { readLoop, rulesFor } from '../jarl-lib.mjs';
import { ruleLines } from '../lib/rules.mjs';

const fresh = () => makeLoop({ prefix: 'jarl-rule-record-', via: 'cli', dotGit: false });

test('decide says when a ruling that reads as an instruction has no scope, and names the call that scopes it', () => {
  const root = fresh();
  for (const [n, text] of ['Never push to main.', 'Workers must run the tests before they report.', 'Run the linter before every commit.', 'Always name the branch in a report.', "Don't edit the vendored copy."].entries()) {
    const r = run(root, ['decide', `i-${n}`, text, '--by', 'jarl']);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /note: i-\d+ reads as an instruction and has no --applies-to, so no brief or view hands it to anyone/, text);
    assert.match(r.stderr, /jarl\.mjs decide "<a-new-slug>" "<a-ruling>" --supersedes i-\d+ --applies-to "<selectors>" --by "<who>"/, text);
  }
});

test('decide stays quiet about a ruling that has a scope and about one that records a choice', () => {
  const root = fresh();
  const scoped = run(root, ['decide', 'scoped', 'Never push to main.', '--applies-to', 'role worker', '--by', 'jarl']);
  assert.doesNotMatch(scoped.stderr, /reads as an instruction/);
  for (const [n, text] of ['The owner chose option b on Tuesday.', 'The release moves to Friday.', 'Issue 4 is dropped because it is a duplicate of 2.'].entries()) {
    const r = run(root, ['decide', `record-${n}`, text, '--by', 'jarl']);
    assert.doesNotMatch(r.stderr, /reads as an instruction/, text);
  }
});

test('a rule is delivered as its instruction alone: the ruling it was made under and the owner\'s words stay in the record', () => {
  const root = fresh();
  jarl(root, 'decide', 'mandate', 'A standing mandate.', '--by', 'jarl');
  jarl(root, 'decide', 'under-rule', 'Run the tests.', '--applies-to', 'role worker', '--by', 'jarl', '--under', 'mandate');
  jarl(root, 'decide', 'owner-rule', 'Keep reports short.', '--applies-to', 'role worker', '--by', 'owner', '--quote', 'Yes, keep them short.');
  const read = readLoop(join(root, '.jarl'));
  const reader = { roles: new Set(['worker']), slice: null, moments: new Set(['start']), issues: [] };
  const rules = rulesFor(root, read, reader, '2026-11-12');
  const text = (slug) => ruleLines(rules.find((r) => r.slug === slug)).join('\n');
  assert.equal(text('under-rule').split(' — ')[1], 'Run the tests.');
  assert.match(text('under-rule'), /^- under-rule · role worker · by jarl · under mandate — Run the tests\.$/);
  assert.match(text('owner-rule'), /^- owner-rule · role worker · by owner — Keep reports short\.$/);
  assert.doesNotMatch(text('under-rule') + text('owner-rule'), /Made under|owner's words/);
  assert.match(jarl(root, 'decisions'), /owner-rule · by owner · applies to role worker — Keep reports short\. · the owner's words: "Yes, keep them short\."/, 'the record keeps them');
});
