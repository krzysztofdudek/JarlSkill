// A change meant to alter nothing carries the tag identical-output and records its comparison of the output before and
// after as a proof row, the command and what it printed. It keeps its fresh review, which may be a light one that checks
// the comparison covers everything the change touched: an approve by a model below the worker's is said to be enough for
// it, where on any other issue it is said not to clear. The comparison never stands in for the review: done refuses such
// an issue with no approve, unless the owner waived its review by a ruling of his.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gitRepo, jarl, loop as makeLoop, refuses, run } from './helpers.mjs';
import { BUILTIN_STATUSES } from '../jarl-lib.mjs';

const logText = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');

// A loop with two model lines and two changes leased on the strong model, each with its comparison recorded as a proof row:
// the first tagged as meant to alter nothing, the second the same change without the tag.
function refactorLoop() {
  const { dir } = gitRepo({ prefix: 'jarl-identical-' });
  jarl(dir, 'init', 'g');
  jarl(dir, 'goal', '--set', 'Model (light): m-light');
  jarl(dir, 'goal', '--set', 'Model (strong): m-strong');
  for (const [title, file, tags] of [['split the renderer', 'render.mjs', ['--tags', 'identical-output']], ['split the parser', 'parse.mjs', []]]) {
    jarl(dir, 'new', title, '--tier', 'standard', '--files', file, '--acceptance', 'the output is byte for byte the same', ...tags);
  }
  for (const id of ['1', '2']) {
    jarl(dir, 'set', id, 'in-progress', 'go', '--branch', `jarl/${id}-split`, '--worker', `w${id}`, '--model', 'm-strong');
    jarl(dir, 'evidence', id, '--ran', 'node render.mjs > after.txt && cmp before.txt after.txt', '--saw', 'cmp printed nothing, exit 0');
  }
  return dir;
}

test('done refuses a change meant to alter nothing that holds its comparison and no approve, and writes nothing', () => {
  const root = refactorLoop();
  const before = logText(root);
  const said = refuses(root, 'set', '1', 'done', 'the output is the same');
  assert.match(said, /^1 has no approving review newer than its last round or reopen/);
  assert.match(said.trim().split('\n').pop(), /^jarl\.mjs review "<ids>" "<verdict>"/);
  assert.equal(logText(root), before);
});

test('a light approve of a change meant to alter nothing is said to be enough, and the same approve of any other change is not', () => {
  const root = refactorLoop();
  const tagged = run(root, ['review', '1', 'approve', '--by', 'rev-1', '--model', 'm-light', 'the comparison covers every file the change touched']);
  assert.equal(tagged.status, 0, tagged.stderr);
  assert.doesNotMatch(tagged.stderr, /ranks below the worker's model/);
  assert.match(tagged.stderr, /1: a change meant to alter nothing \(tag identical-output\): a light review may clear it, one that checks the comparison of the output before and after covers everything the change touched/);
  const plain = run(root, ['review', '2', 'approve', '--by', 'rev-2', '--model', 'm-light', 'the comparison covers every file the change touched']);
  assert.match(plain.stderr, /2: m-light ranks below the worker's model \(m-strong\)/);
});

test('the briefs of a change meant to alter nothing say what its worker records and what its reviewer checks', () => {
  const root = refactorLoop();
  assert.match(jarl(root, 'brief', '1'), /^note: 1 is a change meant to alter nothing \(tag identical-output\): its comparison of the output before and after is a proof row, the command and what it printed — jarl\.mjs evidence 1 --ran "<command>" --saw "<what-it-printed>"$/m);
  assert.match(jarl(root, 'brief', '1', '--role', 'reviewer'), /^note: 1 is a change meant to alter nothing \(tag identical-output\): its review may be a light one, and it checks that the comparison in its proof rows covers everything the change touched; the comparison never stands in for the review$/m);
  assert.doesNotMatch(jarl(root, 'brief', '2', '--role', 'reviewer'), /meant to alter nothing \(tag/);
});

// The tag is set by anyone, the issue's own worker included, so it relaxes nothing by itself: the light review is enough only
// for an issue that carries the tag and a proof row that names the comparison. Three changes leased on the strong model:
// the tag with a comparison row, no tag with a comparison row, and the tag with a row that compares nothing.
function taggedLoop(reviewer) {
  const flags = [];
  if (reviewer) {
    const file = join(mkdtempSync(join(tmpdir(), 'jarl-identical-profile-')), 'profile.json');
    writeFileSync(file, JSON.stringify({ 'jarl-profile': 1, statuses: BUILTIN_STATUSES, initial: 'open', 'done-gate': { reviewer } }));
    flags.push('--profile', file);
  }
  const root = makeLoop({ prefix: 'jarl-identical-tag-', via: 'cli', initFlags: flags });
  jarl(root, 'goal', '--set', 'Model (light): m-light');
  jarl(root, 'goal', '--set', 'Model (strong): m-strong');
  const rows = { 1: ['tag with a comparison row', ['--tags', 'identical-output'], 'node render.mjs > after.txt && cmp before.txt after.txt', 'cmp printed nothing, exit 0'],
    2: ['no tag with a comparison row', [], 'node parse.mjs > after.txt && cmp before.txt after.txt', 'cmp printed nothing, exit 0'],
    3: ['tag with a row that compares nothing', ['--tags', 'identical-output'], 'npm test', 'pass 4, fail 0'] };
  for (const [id, [title, tags, ran, saw]] of Object.entries(rows)) {
    jarl(root, 'new', title, '--acceptance', 'the output is the same', ...tags);
    jarl(root, 'set', id, 'in-progress', 'go', '--worker', `w${id}`, '--model', 'm-strong');
    jarl(root, 'evidence', id, '--ran', ran, '--saw', saw);
  }
  return root;
}
const lightApprove = (root, id) => run(root, ['review', id, 'approve', '--by', `rev-${id}`, '--model', 'm-light', 'the comparison covers every file the change touched']);

test('the rank note is silenced only for a change that carries the tag and a proof row naming the comparison', () => {
  const root = taggedLoop();
  assert.match(lightApprove(root, '1').stderr, /1: a change meant to alter nothing \(tag identical-output\): a light review may clear it/);
  const untagged = lightApprove(root, '2').stderr;
  assert.match(untagged, /2: m-light ranks below the worker's model \(m-strong\)/);
  assert.doesNotMatch(untagged, /the tag identical-output/);
  const bare = lightApprove(root, '3').stderr;
  assert.doesNotMatch(bare, /a light review may clear it/);
  assert.match(bare, /3: m-light ranks below the worker's model \(m-strong\) — advice, not a gate: .* \(the tag identical-output lets a light review clear only with a proof row that names the comparison of the output before and after, and 3 holds none since its last round or reopen\)/);
});

test('under "model-rank" done refuses a light approve of a tagged change with no row naming the comparison, and accepts it with one', () => {
  const root = taggedLoop('model-rank');
  lightApprove(root, '1');
  lightApprove(root, '3');
  assert.match(jarl(root, 'set', '1', 'done', 'the comparison covers the change', '--by', 'jarl'), /1 → done/);
  assert.match(refuses(root, 'set', '3', 'done', 'x', '--by', 'jarl'), /^3's live approve is by rev-3 on m-light, which ranks below the worker's model \(m-strong\)/);
  jarl(root, 'evidence', '3', '--ran', 'diff before.txt after.txt', '--saw', 'no difference');
  assert.match(jarl(root, 'set', '3', 'done', 'the comparison is on record now', '--by', 'jarl'), /3 → done/);
});

test('a comparison row recorded before the last round or reopen of a tagged change lets no light review clear it; one recorded after does', () => {
  const root = taggedLoop('model-rank');
  // A round sends the work back: the comparison recorded before it compared code other than the change as it stands.
  jarl(root, 'round', '1', 'the split dropped a case', '--by', 'jarl');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 5, fail 0');
  lightApprove(root, '1');
  assert.match(refuses(root, 'set', '1', 'done', 'x', '--by', 'jarl'), /^1's live approve is by rev-1 on m-light, which ranks below the worker's model \(m-strong\)/);
  assert.match(lightApprove(root, '1').stderr, /\(the tag identical-output lets a light review clear only with a proof row that names the comparison of the output before and after, and 1 holds none since its last round or reopen\)/);
  jarl(root, 'evidence', '1', '--ran', 'node render.mjs > after.txt && cmp before.txt after.txt', '--saw', 'cmp printed nothing, exit 0');
  assert.match(jarl(root, 'set', '1', 'done', 'the comparison covers the change', '--by', 'jarl'), /1 → done/);
  // A reopen and a new start: the comparison of the first lease is not the proof of the second.
  jarl(root, 'set', '1', 'open', 'the output differs after all', '--by', 'jarl');
  jarl(root, 'set', '1', 'in-progress', 'again', '--worker', 'w9', '--model', 'm-strong', '--by', 'jarl');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 5, fail 0');
  lightApprove(root, '1');
  assert.match(refuses(root, 'set', '1', 'done', 'x', '--by', 'jarl'), /^1's live approve is by rev-1 on m-light, which ranks below the worker's model \(m-strong\)/);
});

test('models counts a light approve of a tagged change that holds its comparison as the review the rule asks for, and one of a tag with no comparison as clearing on a lower rank', () => {
  const root = taggedLoop();
  for (const id of ['1', '2', '3']) {
    lightApprove(root, id);
    jarl(root, 'set', id, 'done', 'approved', '--by', 'jarl');
  }
  const light = JSON.parse(jarl(root, 'models', '--json')).reviewers.find((r) => r.model === 'm-light');
  assert.equal(light.cells.reduce((sum, c) => sum + c.approves, 0), 3);
  assert.equal(light.cells.reduce((sum, c) => sum + c.clearingOwnOrLower, 0), 2, 'issues 2 and 3 cleared on a lower rank; issue 1 holds its comparison');
});

test('the owner\'s waiver of the review, and nothing else, closes a change meant to alter nothing with no approve', () => {
  const root = refactorLoop();
  jarl(root, 'merged', '1', '--sha', 'abc1234', '--ci', 'none', '--keep');
  assert.match(refuses(root, 'set', '1', 'done', 'the output is the same'), /^1 has no approving review/);
  jarl(root, 'decide', 'no-review-for-the-split', 'The split of the renderer closes on its comparison.', '--by', 'owner', '--quote', 'The comparison is enough for that one.', '--waives-review', '1');
  assert.match(jarl(root, 'set', '1', 'done', 'the output is the same, the review waived'), /1 → done/);
});
