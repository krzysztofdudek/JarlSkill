// A raise from record format 1 writes every bare Repo path of the loop again with ./, so that format 2 does not read it
// as a repository name. A command whose write raises the format (its --by, or a line of the format registry) and then
// writes an issue file must write it from the file as the raise left it, never from the text it read before the raise:
// each command that does so has its case here, and each case checks the issue it writes, an issue it does not, and every
// other issue file of the loop, an issue the command files included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
// A format-1 loop with a repository directory `tool` beside its record and two issues whose Repo is the bare path `tool`;
// a case may give the first issue's title and acceptance lines, and a third issue the command does not write.
function formatOneLoop(act) {
  const root = makeLoop({ prefix: 'jarl-raise-paths-', goal: 'a goal', via: 'cli' });
  mkdirSync(join(root, 'tool'));
  execFileSync('git', ['init', '-q'], { cwd: join(root, 'tool'), stdio: 'ignore', timeout: SPAWN_TIMEOUT });
  const id = fileAsBefore(root, act.title ?? 'thing to do', { acceptance: act.acceptance ?? 'it works', repo: 'tool' });
  const other = fileAsBefore(root, 'other thing', { acceptance: 'it works', repo: 'tool' });
  if (act.third) fileAsBefore(root, 'third thing', { acceptance: 'it works', repo: 'tool' });
  return { root, id, other };
}
// The Repo line of every issue file of the loop that holds one, by file name.
const repoLines = (root) => {
  const dir = join(root, '.jarl', 'issues');
  return readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => [f, (/^\*\*Repo:\*\* (.*)$/m.exec(readFileSync(join(dir, f), 'utf8')) || [])[1]]).filter(([, repo]) => repo !== undefined);
};
function keepsPaths(what, act) {
  const { root, id, other } = formatOneLoop(act);
  assert.match(file(root, id), /^\*\*Repo:\*\* tool$/m, `${what}: the format-1 writer wrote the path bare`);
  const before = act.before ? act.before(root, id, other) : null;
  assert.equal(formatOf(root), 1, `${what}: the loop is in format 1 before the write`);
  assert.ok(repoLines(root).every(([, repo]) => repo === 'tool'), `${what}: every issue holds the path bare before the write`);
  const files = repoLines(root).length;
  act.run(root, id, other, before);
  assert.ok(formatOf(root) >= 2, `${what}: the write raised the format`);
  if (!act.writesOther) assert.match(file(root, other), /^\*\*Repo:\*\* \.\/tool$/m, `${what}: the raise wrote the path of an issue the command does not write with ./`);
  assert.match(file(root, id), /^\*\*Repo:\*\* \.\/tool$/m, `${what}: the issue the command wrote keeps the raise's ./ form`);
  if (act.holds) assert.match(file(root, id), act.holds, `${what}: and holds what the command wrote`);
  const lines = repoLines(root);
  if (act.files) assert.equal(lines.length, files + act.files, `${what}: the command filed ${act.files} issue(s)`);
  for (const [f, repo] of lines) assert.equal(repo, './tool', `${what}: ${f} holds the path as ./tool after the raise`);
  if (act.after) act.after(root, id, other);
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
  'new with --repo and --by': {
    run: (root) => jarl(root, 'new', 'third thing', '--repo', './tool', '--by', 'jarl'),
    files: 1,
  },
  'split with --by': {
    acceptance: ['the first part works', 'the second part works'],
    third: true,
    run: (root, id, other) => jarl(root, 'split', id, '--line', `1=${other}`, '--line', `2=${id}`, '--by', 'jarl'),
    writesOther: true,
    holds: /the second part works/,
    after: (root, id, other) => {
      assert.match(file(root, other), /the first part works/, 'split: the line moved to the sub-issue');
      assert.match(file(root, other), new RegExp(`^\\*\\*Parent:\\*\\* ${id}$`, 'm'), 'split: the sub-issue is under the parent');
    },
  },
  'import --adopt with --by': {
    title: 'thing to do, see FIND-0001',
    run: (root) => {
      const findings = join(root, 'findings.json');
      writeFileSync(findings, JSON.stringify([{ id: 'FIND-0001', title: 'thing to do' }]));
      jarl(root, 'import', findings, '--source', 'report', '--adopt', '--by', 'jarl');
    },
    holds: /^\*\*Source:\*\* report#FIND-0001$/m,
  },
  'import --adopt with --by, filing a finding with --repo': {
    title: 'thing to do, see FIND-0001',
    run: (root) => {
      const findings = join(root, 'findings.json');
      writeFileSync(findings, JSON.stringify([{ id: 'FIND-0001', title: 'thing to do' }, { id: 'FIND-0002', title: 'one more thing' }]));
      jarl(root, 'import', findings, '--source', 'report', '--adopt', '--repo', './tool', '--by', 'jarl');
    },
    holds: /^\*\*Source:\*\* report#FIND-0001$/m,
    files: 1,
  },
  'retract of an evidence row': {
    before: (root, id) => jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'pass 5'),
    run: (root, id) => jarl(root, 'retract', id, '1', '--by', 'w-one', 'the run was on another branch'),
    holds: /~~/,
  },
  'retract of a note': {
    before: (root, id) => jarl(root, 'evidence', id, 'a note of the work'),
    run: (root, id) => jarl(root, 'retract', id, 'note-1', '--by', 'w-one', 'the note was about another issue'),
    holds: /~~/,
  },
  'retract of an approve': {
    before: (root, id) => {
      jarl(root, 'set', id, 'in-progress', '--worker', 'w-one', '--branch', `jarl/${id}-x`);
      jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'pass 5');
      jarl(root, 'review', id, 'approve', '--by', 'rev-a', 'read the whole diff and found nothing');
    },
    run: (root, id) => jarl(root, 'retract', id, 'review', '--by', 'jarl', 'the approve was given on the wrong branch'),
    holds: /~~/,
  },
  'tick by the owner': {
    acceptance: '[owner] the page reads well · material: the page as shown · check: the opening',
    before: (root, id) => {
      jarl(root, 'set', id, 'in-progress', '--worker', 'w-one', '--branch', `jarl/${id}-x`);
      jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'pass 5');
    },
    run: (root, id) => jarl(root, 'tick', id, '1', '--by', 'owner'),
  },
  'renumber with --by': {
    // Two files of one number, each with a key, as a merge of two copies of the loop leaves them.
    before: (root, id, other) => {
      const dir = join(root, '.jarl', 'issues');
      const withKey = (text, key) => text.replace(/^\*\*Tags:\*\*/m, `**Key:** ${key}\n**Tags:**`);
      writeFileSync(L.findIssue(root, id).file, withKey(file(root, id), '20261108T0900-aaaa'));
      writeFileSync(join(dir, `${id}-other-thing.md`), withKey(file(root, other), '20261108T0901-bbbb').replace(/^# \S+ ·/, `# ${id} ·`));
    },
    run: (root, id) => jarl(root, 'renumber', id, '--key', '20261108T0901-bbbb', '--by', 'jarl'),
  },
};

for (const [what, act] of Object.entries(CASES)) {
  test(`${what}, raising a format-1 loop, keeps the ./ form of a bare Repo path in the issue it writes`, () => keepsPaths(what, act));
}
