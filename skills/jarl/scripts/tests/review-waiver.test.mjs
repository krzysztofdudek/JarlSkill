// The owner may close chosen issues without a review: a ruling of his, carrying his words, names them with
// --waives-review. The waiver stands in for the approve alone (the proof rows, the merge and his ticks are still asked
// for), clears a code issue for done and the merge queue, is counted apart from fresh and coordinator reviews, and is
// named by show. A ruling by anyone else waives nothing; a superseded one, or one with no words of his, is not read as a
// waiver. A round, a reopen or a new commit after it spends it, as it spends an approve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../record.mjs';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gitRepo, jarl, refuses, run } from './helpers.mjs';
import { BUILTIN_STATUSES } from '../jarl-lib.mjs';
import { fileThreeDigits } from './helpers.mjs';

const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const decisions = (root) => readFileSync(join(root, '.jarl', 'decisions.md'), 'utf8');

// A loop in a git repository with one code issue on a branch one commit ahead of the base, its proof recorded. `reviewer`
// is the profile's done-gate reviewer rule (none: the default), and `model` the model the lease names (none: no model).
function codeLoop({ reviewer, model } = {}) {
  const { dir: root, g } = gitRepo({ prefix: 'jarl-waiver-', branch: 'main' });
  const flags = [];
  if (reviewer) {
    const dir = mkdtempSync(join(tmpdir(), 'jarl-waiver-profile-'));
    writeFileSync(join(dir, 'profile.json'), JSON.stringify({ 'jarl-profile': 1, statuses: BUILTIN_STATUSES, initial: 'open', 'done-gate': { reviewer } }));
    flags.push('--profile', join(dir, 'profile.json'));
  }
  jarl(root, 'init', 'goal', ...flags);
  if (reviewer || model) for (const line of ['Model (light): m-light', 'Model (strong): m-strong']) jarl(root, 'goal', '--set', line);
  jarl(root, 'new', 'move the helper', '--acceptance', '[read] the output is the same', '--files', 'a.txt');
  g('checkout', '-q', '-b', 'jarl/1-move');
  writeFileSync(join(root, 'a.txt'), 'moved\n'); g('add', 'a.txt'); g('commit', '-qm', 'move');
  g('checkout', '-q', 'main');
  jarl(root, 'set', '1', 'in-progress', '--worker', 'w1', '--branch', 'jarl/1-move', ...(model ? ['--model', model] : []), '--by', 'jarl');
  jarl(root, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'pass 4, fail 0', '--by', 'w1');
  const commit = () => { g('checkout', '-q', 'jarl/1-move'); appendFileSync(join(root, 'a.txt'), 'more\n'); g('commit', '-qam', 'more'); g('checkout', '-q', 'main'); };
  return { root, g, commit };
}
const waive = (root, slug = 'no-review-for-1', extra = []) => jarl(root, 'decide', slug, 'Issue 1 closes without a review: the comparison is enough.', '--by', 'owner', '--quote', 'No review for that one.', '--waives-review', '1', ...extra);

test('a waiver is the owner\'s alone: a ruling by the jarl or a coordinator naming issues to waive is refused and writes nothing', () => {
  const { root } = codeLoop();
  const before = decisions(root);
  const said = refuses(root, 'decide', 'skip-review', 'no review needed', '--by', 'jarl', '--waives-review', '1');
  assert.match(said, /^--waives-review closes the named issues without a review, which only the owner rules: a ruling by jarl waives nothing\n/);
  assert.match(said, /\njarl\.mjs decide .*--by "<the-owner-himself>".* --quote "<his-own-words>"\n$/);
  assert.match(refuses(root, 'decide', 'skip-review', 'no review needed', '--by', 'owner', '--waives-review', '1'), /carries his own words/);
  assert.equal(decisions(root), before);
});

test('a waived code issue passes the done gate and the merge queue, show names the ruling, and status counts it apart', () => {
  const { root, g } = codeLoop();
  assert.match(refuses(root, 'set', '1', 'done', 'x', '--by', 'jarl'), /no approving review/);
  waive(root);
  assert.match(decisions(root), /\*\*Waives review:\*\* 1\n/);
  assert.match(jarl(root, 'show', '1'), /Ruling no-review-for-1 \(by owner\) waives the review: Issue 1 closes without a review/);
  const queue = json(root, 'resume').queue.repos.flatMap((r) => r.rows);
  assert.deepEqual(queue.map((r) => r.issues), [['1']], 'the waived issue waits for its merge in the queue');
  assert.match(refuses(root, 'set', '1', 'done', 'x', '--by', 'jarl'), /records no merge/, 'the waiver stands in for the review, never for the merge');
  jarl(root, 'merged', '1', '--sha', g('rev-parse', 'jarl/1-move').trim(), '--ci', 'none', '--keep', '--by', 'jarl');
  assert.match(jarl(root, 'set', '1', 'done', 'waived by the owner and merged', '--by', 'jarl'), /1 → done/);
  const st = json(root, 'status');
  assert.equal(st.reviews.waived, 1);
  assert.equal(st.reviews.fresh, 0);
  assert.match(jarl(root, 'status'), /waived by the owner 1/);
  assert.deepEqual(st.closedGate, []);
});

test('a round, a reopen or a new commit after the waiver spends it, as it spends an approve', () => {
  const round = codeLoop();
  waive(round.root);
  jarl(round.root, 'round', '1', 'red: a case was missed', '--by', 'jarl');
  jarl(round.root, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'pass 5, fail 0', '--by', 'w1');
  assert.match(refuses(round.root, 'set', '1', 'done', 'x', '--by', 'jarl'), /no approving review newer than its last round/);
  const reopened = codeLoop();
  waive(reopened.root);
  jarl(reopened.root, 'merged', '1', '--sha', reopened.g('rev-parse', 'jarl/1-move').trim(), '--ci', 'none', '--keep', '--by', 'jarl');
  jarl(reopened.root, 'set', '1', 'done', 'waived and merged', '--by', 'jarl');
  jarl(reopened.root, 'set', '1', 'open', 'the owner wants one more case', '--by', 'jarl');
  jarl(reopened.root, 'set', '1', 'in-progress', '--worker', 'w2', '--branch', 'jarl/1-move', '--by', 'jarl');
  jarl(reopened.root, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'pass 4, fail 0', '--by', 'w2');
  assert.match(refuses(reopened.root, 'set', '1', 'done', 'x', '--by', 'jarl'), /no approving review/);
  const committed = codeLoop();
  waive(committed.root);
  committed.commit();
  assert.match(refuses(committed.root, 'set', '1', 'done', 'x', '--by', 'jarl'), /no approving review/, 'the code the owner waived is not the code there now');
});

test('a waiver whose note is retracted waives nothing, in the done gate and the merge queue, and one whose note stands still waives', () => {
  const { root, g } = codeLoop();
  waive(root);
  assert.deepEqual(json(root, 'resume').queue.repos.flatMap((r) => r.rows).map((r) => r.issues), [['1']], 'the note stands: the waived issue waits for its merge');
  assert.match(jarl(root, 'retract', '1', 'note-1', '--by', 'owner', 'the issue is reviewed after all'), /retracted/);
  assert.deepEqual(json(root, 'resume').queue.repos.flatMap((r) => r.rows), [], 'the retracted waiver puts the issue back out of the queue');
  jarl(root, 'merged', '1', '--sha', g('rev-parse', 'jarl/1-move').trim(), '--ci', 'none', '--keep', '--by', 'jarl');
  assert.match(refuses(root, 'set', '1', 'done', 'x', '--by', 'jarl'), /no approving review/, 'the retracted waiver no longer stands in for the review');
  assert.match(jarl(root, 'show', '1', '--full'), /~~Ruling no-review-for-1 \(by owner\) waives the review/);
  jarl(root, 'review', '1', 'approve', '--by', 'rev-a', 'read the diff, nothing found');
  assert.match(jarl(root, 'set', '1', 'done', 'reviewed and merged', '--by', 'jarl'), /1 → done/);
});

test('a superseded waiver, or a ruling whose words are not the owner\'s, waives nothing', () => {
  const { root, g } = codeLoop();
  jarl(root, 'merged', '1', '--sha', g('rev-parse', 'jarl/1-move').trim(), '--ci', 'none', '--keep', '--by', 'jarl');
  waive(root);
  jarl(root, 'decide', 'review-1-after-all', 'Issue 1 is reviewed after all.', '--by', 'owner', '--quote', 'Have it reviewed.', '--supersedes', 'no-review-for-1');
  assert.match(refuses(root, 'set', '1', 'done', 'x', '--by', 'jarl'), /no approving review/);
  // A ruling written into the record by hand, naming the issue and the owner, with no words of his.
  const other = codeLoop();
  appendFileSync(join(other.root, '.jarl', 'decisions.md'), '\n## 2026-11-05 · by-hand\nNo review.\n\n**Waives review:** 1\n**By:** owner\n');
  jarl(other.root, 'evidence', '1', 'Ruling by-hand (by owner) waives the review: No review.', '--by', 'jarl');
  jarl(other.root, 'merged', '1', '--sha', other.g('rev-parse', 'jarl/1-move').trim(), '--ci', 'none', '--keep', '--by', 'jarl');
  assert.match(refuses(other.root, 'set', '1', 'done', 'x', '--by', 'jarl'), /no approving review/);
  assert.equal(run(other.root, ['status']).status, 0);
});

// A loop whose one code issue, filed with three digits and no key, is on a branch with its proof row and its merge.
function mergedIssueLoop() {
  const { dir: root, g } = gitRepo({ prefix: 'jarl-waiver-merged-', branch: 'main' });
  jarl(root, 'init', 'goal');
  const id = fileThreeDigits(root, 'move the helper', { acceptance: '[compare] the output is the same · by: node report.mjs' });
  g('checkout', '-q', '-b', 'jarl/move');
  writeFileSync(join(root, 'a.txt'), 'moved\n'); g('add', 'a.txt'); g('commit', '-qm', 'move');
  g('checkout', '-q', 'main');
  jarl(root, 'set', id, 'in-progress', '--worker', 'w1', '--branch', 'jarl/move');
  jarl(root, 'evidence', id, '--line', '1', '--ran', 'npm test', '--saw', 'pass 4, fail 0', '--by', 'w1');
  jarl(root, 'merged', id, '--sha', g('rev-parse', 'jarl/move').trim(), '--ci', 'none');
  return { root, id };
}
const waiveIn = (root, id, slug = 'no-review', extra = []) => jarl(root, 'decide', slug, 'Closes without a review.', '--by', 'owner', '--quote', 'No review for that one.', '--waives-review', id, ...extra);

test('a waiver refused for its slug or the ruling it supersedes writes nothing', () => {
  const { root, id } = mergedIssueLoop();
  jarl(root, 'decide', 'taken', 'A ruling.', '--by', 'jarl');
  const before = decisions(root);
  assert.match(refuses(root, 'decide', 'taken', 'Closes without a review.', '--by', 'owner', '--quote', 'No review for that one.', '--waives-review', id), /^duplicate slug: taken/);
  assert.match(refuses(root, 'decide', 'no-review', 'Closes without a review.', '--by', 'owner', '--quote', 'No review for that one.', '--waives-review', id, '--supersedes', 'no-such-ruling'), /^no ruling no-such-ruling /);
  assert.match(refuses(root, 'decide', 'no review', 'Closes without a review.', '--by', 'owner', '--quote', 'No review for that one.', '--waives-review', id), /slug is letters, digits/);
  assert.equal(decisions(root), before);
});

test('show says a superseded waiver waives nothing, in the window and in the whole issue', () => {
  const { root } = codeLoop();
  waive(root);
  assert.doesNotMatch(jarl(root, 'show', '1'), /waives nothing/);
  jarl(root, 'decide', 'review-1-after-all', 'Issue 1 is reviewed after all.', '--by', 'owner', '--quote', 'Have it reviewed.', '--supersedes', 'no-review-for-1');
  for (const full of [[], ['--full']]) assert.match(jarl(root, 'show', '1', ...full), /^.*Ruling no-review-for-1 \(by owner\) waives the review: .* \(superseded by review-1-after-all: it waives nothing\)$/m, full.join(' '));
});

// An approve the reviewer rule makes done refuse, by rule: one that names no model, and one whose model the rule refuses
// (the worker's own under "other-model", a lower rank under "model-rank"), with the start of the refusal done gives.
const REFUSED = [
  { reviewer: 'other-model', approve: [], said: /^1's live approve by rev-x names no model — / },
  { reviewer: 'other-model', model: 'm-strong', approve: ['--model', 'm-strong'], said: /^1's live approve is by rev-x on m-strong, the model of its worker — / },
  { reviewer: 'model-rank', approve: [], said: /^1's live approve by rev-x names no model — / },
  { reviewer: 'model-rank', model: 'm-strong', approve: ['--model', 'm-light'], said: /^1's live approve is by rev-x on m-light, which ranks below the worker's model \(m-strong\) — / },
];
const approveAs = (root, flags) => (flags.length ? jarl(root, 'review', '1', 'approve', '--by', 'rev-x', ...flags, 'read the diff and the rows, nothing found') : R.review(root, '1', 'approve', 'read the diff and the rows, nothing found', { by: 'rev-x' }));
const mergeTip = (root, g) => jarl(root, 'merged', '1', '--sha', g('rev-parse', 'jarl/1-move').trim(), '--ci', 'none', '--keep', '--by', 'jarl');

for (const c of REFUSED) {
  const which = c.approve.length ? `an approve on ${c.approve[1]} (the lease on ${c.model})` : 'an approve that names no model';
  test(`"${c.reviewer}": the owner's waiver clears the done gate past ${which} that the rule refuses, and status counts the issue as waived`, () => {
    const { root, g } = codeLoop(c);
    approveAs(root, c.approve);
    mergeTip(root, g);
    assert.match(refuses(root, 'set', '1', 'done', 'x', '--by', 'jarl'), c.said);
    waive(root);
    assert.match(jarl(root, 'show', '1'), /Ruling no-review-for-1 \(by owner\) waives the review/);
    assert.match(jarl(root, 'set', '1', 'done', 'waived by the owner and merged', '--by', 'jarl'), /1 → done/);
    const st = json(root, 'status');
    assert.equal(st.reviews.waived, 1);
    assert.equal(st.reviews.fresh, 0);
    assert.deepEqual(st.closedGate, []);
  });

  test(`"${c.reviewer}": a new commit after the waiver spends it, and done holds ${which} to the rule again`, () => {
    const { root, g, commit } = codeLoop(c);
    approveAs(root, c.approve);
    waive(root);
    commit();
    mergeTip(root, g);
    assert.match(refuses(root, 'set', '1', 'done', 'x', '--by', 'jarl'), c.said);
  });
}

test('"agent", the default: an approve clears done whatever its model, and with a waiver beside it status counts the review as fresh', () => {
  for (const model of [undefined, 'm-strong']) {
    const { root, g } = codeLoop({ model });
    approveAs(root, model ? ['--model', model] : []);
    waive(root);
    mergeTip(root, g);
    assert.match(jarl(root, 'set', '1', 'done', 'approved and merged', '--by', 'jarl'), /1 → done/, `lease on ${model}`);
    const st = json(root, 'status');
    assert.equal(st.reviews.fresh, 1, `lease on ${model}`);
    assert.equal(st.reviews.waived ?? 0, 0, `lease on ${model}`);
  }
});
