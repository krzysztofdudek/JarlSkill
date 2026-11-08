// A raise from record format 1 writes every bare Repo path of the loop again with ./, so that format 2 does not read it
// as a repository name. A command whose write raises the format (its --by, or a line of the format registry) and then
// writes an issue file must write it from the file as the raise left it, never from the text it read before the raise:
// each command that does so has its case here, and each case checks the issue it writes and an issue it does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileAsBefore } from './old-jarl.mjs';
import { SPAWN_TIMEOUT, jarl, loop as makeLoop } from './helpers.mjs';

const L = await import('../jarl-lib.mjs');

const file = (root, id) => readFileSync(L.findIssue(root, id).file, 'utf8');
const formatOf = (root) => {
  const path = join(root, '.jarl', 'profile.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).format ?? 1 : 1;
};
// A format-1 loop with a repository directory `tool` beside its record and two issues whose Repo is the bare path `tool`.
function formatOneLoop() {
  const root = makeLoop({ prefix: 'jarl-raise-paths-', goal: 'a goal', via: 'cli' });
  mkdirSync(join(root, 'tool'));
  execFileSync('git', ['init', '-q'], { cwd: join(root, 'tool'), stdio: 'ignore', timeout: SPAWN_TIMEOUT });
  const id = fileAsBefore(root, 'thing to do', { acceptance: 'it works', repo: 'tool' });
  const other = fileAsBefore(root, 'other thing', { acceptance: 'it works', repo: 'tool' });
  return { root, id, other };
}
function keepsPaths(what, act) {
  const { root, id, other } = formatOneLoop();
  const before = act.before ? act.before(root, id, other) : null;
  assert.equal(formatOf(root), 1, `${what}: the loop is in format 1 before the write`);
  assert.match(file(root, id), /^\*\*Repo:\*\* tool$/m, `${what}: the format-1 writer wrote the path bare`);
  act.run(root, id, other, before);
  assert.ok(formatOf(root) >= 2, `${what}: the write raised the format`);
  assert.match(file(root, other), /^\*\*Repo:\*\* \.\/tool$/m, `${what}: the raise wrote the path of an issue the command does not write with ./`);
  assert.match(file(root, id), /^\*\*Repo:\*\* \.\/tool$/m, `${what}: the issue the command wrote keeps the raise's ./ form`);
  if (act.holds) assert.match(file(root, id), act.holds, `${what}: and holds what the command wrote`);
}

const CASES = {
  'set with --by': {
    run: (root, id) => jarl(root, 'set', id, 'in-progress', '--worker', 'w-one', '--branch', `jarl/${id}-x`, '--by', 'jarl'),
    holds: /^\*\*Worker:\*\* w-one$/m,
  },
  'set into a status that needs a reason, with --by': {
    run: (root, id) => jarl(root, 'set', id, 'dropped', 'not needed', '--by', 'jarl'),
    holds: /dropped: not needed/i,
  },
  'evidence of a row with --by': {
    run: (root, id) => jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'pass 5', '--by', 'w-one'),
    holds: /npm test/,
  },
  'evidence of a note with --by': {
    run: (root, id) => jarl(root, 'evidence', id, 'a note of the work', '--by', 'w-one'),
    holds: /a note of the work/,
  },
  'merged with --by': {
    before: (root, id) => jarl(root, 'set', id, 'in-progress', '--worker', 'w-one', '--branch', `jarl/${id}-x`),
    run: (root, id) => jarl(root, 'merged', id, '--sha', 'abc1234', '--ci', 'none', '--by', 'merger'),
    holds: /^\*\*Merged:\*\* abc1234/m,
  },
  'round with --by': {
    before: (root, id) => {
      jarl(root, 'set', id, 'in-progress', '--worker', 'w-one', '--branch', `jarl/${id}-x`);
      jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'pass 5');
      jarl(root, 'review', id, 'changes', '--by', 'rev-a', 'Important: the second case is not tested at all here');
    },
    run: (root, id) => jarl(root, 'round', id, 'test the second case', '--by', 'jarl'),
  },
  'set done with --by, after a merge': {
    before: (root, id) => {
      jarl(root, 'set', id, 'in-progress', '--worker', 'w-one', '--branch', `jarl/${id}-x`);
      jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'pass 5');
      jarl(root, 'review', id, 'approve', '--by', 'rev-a', 'read the whole diff and found nothing');
      jarl(root, 'merged', id, '--sha', 'abc1234', '--ci', 'none');
    },
    run: (root, id) => jarl(root, 'set', id, 'done', 'merged', '--by', 'jarl'),
    holds: /^\*\*Status:\*\* done$/m,
  },
  'ask about an issue with --by': {
    run: (root, id) => jarl(root, 'ask', 'which way is right here?', '--issue', id, '--by', 'w-one'),
  },
  'new with --by': {
    run: (root) => jarl(root, 'new', 'third thing', '--by', 'jarl'),
  },
  'field Acceptance with an owner line': {
    run: (root, id) => jarl(root, 'field', id, 'Acceptance', '[owner] the page reads well · material: renders/page.txt · check: the opening'),
    holds: /^\[owner\] the page reads well/m,
  },
  'decide --waives-review by the owner': {
    run: (root, id) => jarl(root, 'decide', 'no-review-here', 'This issue closes without a review: the comparison is enough.', '--by', 'owner', '--quote', 'No review for that one.', '--waives-review', id),
    holds: /waives the review/,
  },
  'a review by a bot': {
    before: (root, id) => {
      jarl(root, 'set', id, 'in-progress', '--worker', 'w-one', '--branch', `jarl/${id}-x`);
      jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'pass 5');
    },
    run: (root, id) => jarl(root, 'review', id, 'approve', '--by', 'bot-checker', '--bot', 'read the whole diff and found nothing'),
  },
  'a review of several issues': {
    before: (root, id, other) => {
      jarl(root, 'set', `${id},${other}`, 'in-progress', '--worker', 'w-one', '--branch', `jarl/${id}-x`);
      jarl(root, 'evidence', `${id},${other}`, '--ran', 'npm test', '--saw', 'pass 5');
    },
    run: (root, id, other) => jarl(root, 'review', `${id},${other}`, 'approve', '--by', 'rev-a', 'read the whole diff of both and found nothing'),
  },
  'field Parent': {
    run: (root, id, other) => jarl(root, 'field', id, 'Parent', other),
    holds: /^\*\*Parent:\*\*/m,
  },
  'field Kind promise': {
    run: (root, id) => jarl(root, 'field', id, 'Kind', 'promise'),
    holds: /^\*\*Kind:\*\* promise$/m,
  },
};

for (const [what, act] of Object.entries(CASES)) {
  test(`${what}, raising a format-1 loop, keeps the ./ form of a bare Repo path in the issue it writes`, () => keepsPaths(what, act));
}
