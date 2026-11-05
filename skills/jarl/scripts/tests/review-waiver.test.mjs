// The owner may close chosen issues without a review: a ruling of his, carrying his words, names them with
// --waives-review. The waiver stands in for the approve alone (the proof rows, the merge and his ticks are still asked
// for), clears a code issue for done and the merge queue, is counted apart from fresh and coordinator reviews, and is
// named by show. A ruling by anyone else waives nothing; a superseded one, or one with no words of his, is not read as a
// waiver. A round, a reopen or a new commit after it spends it, as it spends an approve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, jarl, refuses, run } from './helpers.mjs';

const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const decisions = (root) => readFileSync(join(root, '.jarl', 'decisions.md'), 'utf8');

// A loop in a git repository with one code issue on a branch one commit ahead of the base, its proof recorded.
function codeLoop() {
  const { dir: root, g } = gitRepo({ prefix: 'jarl-waiver-', branch: 'main' });
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'move the helper', '--acceptance', 'the output is the same', '--files', 'a.txt');
  g('checkout', '-q', '-b', 'jarl/1-move');
  writeFileSync(join(root, 'a.txt'), 'moved\n'); g('add', 'a.txt'); g('commit', '-qm', 'move');
  g('checkout', '-q', 'main');
  jarl(root, 'set', '1', 'in-progress', '--worker', 'w1', '--branch', 'jarl/1-move', '--by', 'jarl');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 4, fail 0', '--by', 'w1');
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
  jarl(round.root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 5, fail 0', '--by', 'w1');
  assert.match(refuses(round.root, 'set', '1', 'done', 'x', '--by', 'jarl'), /no approving review newer than its last round/);
  const reopened = codeLoop();
  waive(reopened.root);
  jarl(reopened.root, 'merged', '1', '--sha', reopened.g('rev-parse', 'jarl/1-move').trim(), '--ci', 'none', '--keep', '--by', 'jarl');
  jarl(reopened.root, 'set', '1', 'done', 'waived and merged', '--by', 'jarl');
  jarl(reopened.root, 'set', '1', 'open', 'the owner wants one more case', '--by', 'jarl');
  jarl(reopened.root, 'set', '1', 'in-progress', '--worker', 'w2', '--branch', 'jarl/1-move', '--by', 'jarl');
  jarl(reopened.root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 4, fail 0', '--by', 'w2');
  assert.match(refuses(reopened.root, 'set', '1', 'done', 'x', '--by', 'jarl'), /no approving review/);
  const committed = codeLoop();
  waive(committed.root);
  committed.commit();
  assert.match(refuses(committed.root, 'set', '1', 'done', 'x', '--by', 'jarl'), /no approving review/, 'the code the owner waived is not the code there now');
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
