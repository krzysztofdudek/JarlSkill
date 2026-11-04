// The walk of the wrong calls the reviews of the normalized surface made (tests/fixtures/wrong-calls-reviewers.json), on
// the loop with a sibling repository: the first half here, the second in refusals-walk-reviewers-b, so the two run side
// by side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIBLING, fixture, walk } from './walk.mjs';

test('the first half of the reviews\' wrong calls end with a form that pasted as printed writes nothing', () => {
  const all = fixture('wrong-calls-reviewers.json');
  const calls = all.slice(0, Math.ceil(all.length / 2));
  const { found, refused } = walk(calls, SIBLING, { mustRefuse: false });
  assert.ok(refused >= calls.length / 2, `${refused} of ${calls.length} are refused`);
  assert.deepEqual(found, []);
});
