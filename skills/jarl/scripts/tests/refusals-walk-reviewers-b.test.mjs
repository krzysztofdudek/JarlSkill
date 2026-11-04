// The walk of the wrong calls the reviews of the normalized surface made (tests/fixtures/wrong-calls-reviewers.json), on
// the loop with a sibling repository: the second half here, the first in refusals-walk-reviewers-a.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIBLING, fixture, walk } from './walk.mjs';

test('the second half of the reviews\' wrong calls end with a form that pasted as printed writes nothing', () => {
  const all = fixture('wrong-calls-reviewers.json');
  const calls = all.slice(Math.ceil(all.length / 2));
  const { found, refused } = walk(calls, SIBLING, { mustRefuse: false });
  assert.ok(refused >= calls.length / 2, `${refused} of ${calls.length} are refused`);
  assert.deepEqual(found, []);
});
