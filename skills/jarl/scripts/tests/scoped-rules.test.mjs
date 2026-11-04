// Rules with a scope: decide --applies-to writes whom a ruling applies to and until when, the views print to each reader
// the rules that match it, whole, Jarl ships its own role guidance as such rules, an agent proposes a rule for the jarl or
// the owner to accept, and close offers each rule of the loop for promotion. A reader of format 1 or 2 reads a ruling with a scope
// as a ruling whose text ends with the scope, and every other field of it as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jarl, refuses, loop as makeLoop } from './helpers.mjs';
import { formatTwoJarl, oldJarl } from './old-jarl.mjs';

const loop = () => makeLoop({ prefix: 'jarl-rules-', via: 'cli', dotGit: false });
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const decisionsFile = (root) => readFileSync(join(root, '.jarl', 'decisions.md'), 'utf8');

test('decide --applies-to writes the scope as the first line of the ruling\'s closing block, and decisions shows it', () => {
  const root = loop();
  jarl(root, 'new', 'ui work', '--tags', 'ui');
  const out = jarl(root, 'decide', 'review-ui', 'Every ui change is shown in a screenshot.', '--applies-to', 'role reviewer and tag ui', '--until', '2999-12-31', '--settles', '1');
  assert.match(out, /decided review-ui · by coordinator · applies to role reviewer and tag ui · until 2999-12-31/);
  assert.match(decisionsFile(root), /Every ui change is shown in a screenshot\.\n\n\*\*Applies to:\*\* role reviewer and tag ui · until 2999-12-31\n\*\*Settles:\*\* 1\n\*\*By:\*\* coordinator\n/);
  const [d] = json(root, 'decisions');
  assert.equal(d.appliesTo, 'role reviewer and tag ui · until 2999-12-31');
  assert.equal(d.ruling, 'Every ui change is shown in a screenshot.');
  assert.match(jarl(root, 'decisions'), /review-ui · by coordinator · applies to role reviewer and tag ui · until 2999-12-31 — Every ui change/);
});

test('decide --applies-to refuses a selector it does not know, a role or a moment it does not know, and --until alone', () => {
  const root = loop();
  assert.match(refuses(root, 'decide', 'x', 'text', '--applies-to', 'colour blue'), /"colour blue" is not a selector of --applies-to: loop, or selectors joined by "and"/);
  assert.match(refuses(root, 'decide', 'x', 'text', '--applies-to', 'role painter'), /role painter is not a role a rule reaches: jarl, coordinator, worker, reviewer, merger, takeover/);
  assert.match(refuses(root, 'decide', 'x', 'text', '--applies-to', 'moment lunch'), /moment lunch is not a moment of work: filing, start, review, round, merge, done, close/);
  assert.match(refuses(root, 'decide', 'x', 'text', '--applies-to', 'loop and role worker'), /loop takes no other selector/);
  assert.match(refuses(root, 'decide', 'x', 'text', '--until', '2999-01-01'), /--until ends a rule with a scope: it needs --applies-to/);
  assert.match(refuses(root, 'decide', 'x', 'text', '--applies-to', 'loop', '--until', 'soon'), /--until is a date \(yyyy-mm-dd\)/);
  assert.match(refuses(root, 'decide', 'x', 'text', '--applies-to', 'issue 9'), /no such issue: 9/);
  assert.equal(json(root, 'decisions').length, 0, 'nothing was written');
});

test('a rule ends after its date, when its issue closes, or when a ruling supersedes it; decisions --live leaves an ended rule out', () => {
  const root = loop();
  jarl(root, 'new', 'the work');
  jarl(root, 'decide', 'past', 'Old rule.', '--applies-to', 'loop', '--until', '2000-01-01');
  jarl(root, 'decide', 'future', 'Standing rule.', '--applies-to', 'loop', '--until', '2999-01-01');
  jarl(root, 'decide', 'while-1', 'Rule while the work is open.', '--applies-to', 'role worker', '--until', '1');
  jarl(root, 'decide', 'revoked', 'A rule taken back.', '--applies-to', 'role reviewer');
  jarl(root, 'decide', 'revoke-it', 'The rule revoked is no longer needed.', '--supersedes', 'revoked');
  const live = () => json(root, 'decisions', '--live').map((d) => d.slug);
  assert.deepEqual(live(), ['future', 'while-1', 'revoke-it']);
  assert.match(jarl(root, 'decisions'), /past · by coordinator · applies to loop · until 2000-01-01 · ENDED: ended 2000-01-01/);
  jarl(root, 'set', '1', 'dropped', 'not needed');
  assert.deepEqual(live(), ['future', 'revoke-it']);
  assert.match(jarl(root, 'decisions'), /while-1 · by coordinator · applies to role worker · until issue 1 closes · ENDED: ended when 1 closed \(dropped\)/);
});

test('a reader of format 1 or 2 reads a ruling with a scope: its text ends with the scope, its author and its supersession read as before', () => {
  const root = loop();
  jarl(root, 'decide', 'first', 'A rule for reviewers.', '--applies-to', 'role reviewer and moment round', '--by', 'jarl');
  jarl(root, 'decide', 'second', 'A rule for workers.', '--applies-to', 'role worker', '--supersedes', 'first', '--by', 'jarl');
  for (const reader of [oldJarl, formatTwoJarl]) {
    const read = reader(root, 'decisions', {});
    assert.equal(read.ok, true, read.error);
    const [first, second] = read.value;
    assert.equal(first.by, 'jarl');
    assert.equal(first.supersededBy, 'second');
    assert.match(first.ruling, /^A rule for reviewers\.\n\n\*\*Applies to:\*\* role reviewer and moment round$/);
    assert.equal(second.by, 'jarl');
    assert.equal(second.supersedes, 'first');
    assert.match(second.ruling, /\*\*Applies to:\*\* role worker$/);
  }
  const profile = join(root, '.jarl', 'profile.json');
  assert.equal(existsSync(profile) ? JSON.parse(readFileSync(profile, 'utf8')).format ?? 1 : 1, 1, 'a scope raises no record format');
});
