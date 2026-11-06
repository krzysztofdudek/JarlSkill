// The merge queue offers only what the done gate will accept. Under a reviewer rule that judges the model of an approve
// (done-gate "reviewer": "other-model" or "model-rank"), a branch whose only live approve the rule refuses for its model is
// listed as waiting, with what is missing, and not as ready; an approve the rule accepts, and the owner's waiver of the
// review, make it ready. Under the default rule the model never holds a branch back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sh } from './portable.mjs';
import { jarl } from './helpers.mjs';
import { BUILTIN_STATUSES } from '../jarl-lib.mjs';

const FOUND = 'read the diff and the rows, nothing found';

// A git repository on branch `feature` holding a loop with model lines, under the reviewer rule (none: the default).
function modelRepo(reviewer) {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-queue-model-'));
  sh(dir, 'git init -q -b feature && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null && mkdir src && echo 1 > src/a.mjs && git add -A && git commit -qm base');
  const flags = [];
  if (reviewer) {
    const file = join(mkdtempSync(join(tmpdir(), 'jarl-queue-profile-')), 'profile.json');
    writeFileSync(file, JSON.stringify({ 'jarl-profile': 1, statuses: BUILTIN_STATUSES, initial: 'open', 'done-gate': { reviewer } }));
    flags.push('--profile', file);
  }
  jarl(dir, 'init', 'goal', ...flags);
  jarl(dir, 'goal', '--set', 'Model (light): m-light');
  jarl(dir, 'goal', '--set', 'Model (strong): m-strong');
  return dir;
}
// An issue leased on the strong model, on a branch one commit ahead of the base.
function leased(dir, n) {
  jarl(dir, 'new', `change ${n}`, '--acceptance', 'it works');
  jarl(dir, 'set', String(n), 'in-progress', 'go', '--branch', `jarl/${n}-change`, '--worker', `w${n}`, '--model', 'm-strong');
  const wt = mkdtempSync(join(tmpdir(), 'jarl-queue-wt-'));
  sh(dir, `git worktree add -q -b jarl/${n}-change ${wt} feature`);
  sh(wt, `echo change >> src/a${n}.mjs && git add -A && git commit -qm "work on ${n}"`);
}
const approve = (dir, n, ...model) => jarl(dir, 'review', String(n), 'approve', '--by', `rev-${n}`, ...model, FOUND);
const rowsOf = (dir) => Object.fromEntries(JSON.parse(jarl(dir, 'resume', '--json')).queue.repos[0].rows.map((r) => [r.branch, r]));

for (const [rule, refusedModel, label] of [['other-model', 'm-strong', 'the model of its worker'], ['model-rank', 'm-light', 'a model ranked below its worker\'s']]) {
  test(`"${rule}": a branch whose approve is by ${label}, or names no model, is waiting in the queue with what is missing; an accepted approve and the owner's waiver make it ready`, () => {
    const dir = modelRepo(rule);
    for (const n of [1, 2, 3, 4]) leased(dir, n);
    approve(dir, 1);
    approve(dir, 2, '--model', refusedModel);
    approve(dir, 3, '--model', rule === 'other-model' ? 'm-light' : 'm-strong');
    approve(dir, 4);
    jarl(dir, 'decide', 'no-review-for-the-fourth', 'The fourth change closes on the owner\'s word.', '--by', 'owner', '--quote', 'That one needs no review.', '--waives-review', '4');
    const rows = rowsOf(dir);
    assert.equal(rows['jarl/1-change'].ready, false);
    assert.equal(rows['jarl/1-change'].waitingModel.length, 1);
    assert.equal(rows['jarl/1-change'].waitingModel[0].id, '1');
    assert.match(rows['jarl/1-change'].waitingModel[0].missing, /^1's live approve by rev-1 names no model — /);
    assert.equal(rows['jarl/2-change'].ready, false);
    assert.match(rows['jarl/2-change'].waitingModel[0].missing, new RegExp(`^2's live approve is by rev-2 on ${refusedModel}, `));
    assert.equal(rows['jarl/3-change'].ready, true);
    assert.equal(rows['jarl/3-change'].waitingModel, undefined);
    assert.equal(rows['jarl/4-change'].ready, true, 'the owner\'s live waiver ranks above an approve the rule refuses');
    const text = /## Merge queue\n([\s\S]*?)(?:\n\n|$)/.exec(jarl(dir, 'resume'))[1];
    assert.match(text, /jarl\/1-change → 1 .*\(waiting for an approve the reviewer rule accepts: 1's live approve by rev-1 names no model — /);
    assert.doesNotMatch(text, /jarl\/3-change → 3 .*waiting/);
    assert.doesNotMatch(text, /jarl\/4-change → 4 .*waiting/);
  });
}

test('by default the model never holds a branch back in the queue', () => {
  const dir = modelRepo();
  leased(dir, 1);
  approve(dir, 1);
  const row = rowsOf(dir)['jarl/1-change'];
  assert.equal(row.ready, true);
  assert.equal(row.waitingModel, undefined);
});
