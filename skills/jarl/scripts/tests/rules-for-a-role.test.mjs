// decisions --as <role> prints the rulings that reach that role, so a rule is checked before any brief is raised.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jarl, refuses, loop as makeLoop } from './helpers.mjs';

const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));

function rolesLoop() {
  const root = makeLoop({ prefix: 'jarl-role-rules-', via: 'cli', dotGit: false });
  jarl(root, 'decide', 'for-all', 'Everyone reads the goal.', '--applies-to', 'loop', '--by', 'coordinator');
  jarl(root, 'decide', 'for-workers', 'Workers run the tests.', '--applies-to', 'role worker', '--by', 'coordinator');
  jarl(root, 'decide', 'for-ui-workers', 'Workers on ui attach a screenshot.', '--applies-to', 'role worker and tag ui', '--by', 'coordinator');
  jarl(root, 'decide', 'for-reviewers', 'Reviewers run the suite.', '--applies-to', 'role reviewer and moment round', '--by', 'coordinator');
  jarl(root, 'decide', 'for-mergers', 'Mergers read the diff.', '--applies-to', 'role merger', '--by', 'coordinator');
  jarl(root, 'decide', 'past', 'An ended rule for workers.', '--applies-to', 'role worker', '--until', '2000-01-01', '--by', 'coordinator');
  jarl(root, 'decide', 'old', 'A worker rule replaced.', '--applies-to', 'role worker', '--by', 'coordinator');
  jarl(root, 'decide', 'new', 'The replacement.', '--supersedes', 'old', '--applies-to', 'role worker', '--by', 'coordinator');
  jarl(root, 'decide', 'a-record', 'The choice was made on a Tuesday.', '--by', 'coordinator');
  return root;
}

test('decisions --live --as <role> prints the rules in force that reach the role, and no ruling that is only a record', () => {
  const root = rolesLoop();
  const slugs = (role, ...more) => json(root, 'decisions', '--live', '--as', role, ...more).map((d) => d.slug);
  assert.deepEqual(slugs('worker'), ['for-all', 'for-workers', 'for-ui-workers', 'new']);
  assert.deepEqual(slugs('reviewer'), ['for-all', 'for-reviewers']);
  assert.deepEqual(slugs('merger'), ['for-all', 'for-mergers']);
  assert.deepEqual(slugs('jarl'), ['for-all']);
  const text = jarl(root, 'decisions', '--live', '--as', 'reviewer');
  assert.match(text, /for-reviewers .* applies to role reviewer and moment round — Reviewers run the suite\./);
  assert.doesNotMatch(text, /for-workers|a-record/);
});

test('decisions --as without --live also lists the rules that ended or were replaced, marked as they are', () => {
  const root = rolesLoop();
  const all = json(root, 'decisions', '--as', 'worker').map((d) => d.slug);
  assert.deepEqual(all, ['for-all', 'for-workers', 'for-ui-workers', 'past', 'old', 'new']);
});

test('decisions --as refuses a word that is not a role a rule reaches, and ends with the form', () => {
  const root = rolesLoop();
  const said = refuses(root, 'decisions', '--as', 'painter');
  assert.match(said, /painter is not a role a rule reaches: jarl, coordinator, worker, reviewer, merger, takeover/);
  assert.match(said, /\njarl\.mjs decisions .*--as "<role>"/);
});
