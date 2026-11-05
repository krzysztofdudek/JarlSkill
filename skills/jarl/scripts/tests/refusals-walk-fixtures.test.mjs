// The walk of the wrong calls kept as fixtures, each a way a call was found to go wrong: refused, nothing written, and a
// form at the end that pasted as printed is refused for its placeholder and writes nothing. Some of them are right calls
// and go through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAIN, SIBLING, fixture, walk } from './walk.mjs';

test('the wrong calls kept as fixtures end with a form that pasted as printed writes nothing', () => {
  const calls = [...fixture('wrong-calls-review.json'), ...fixture('wrong-calls.json')];
  assert.ok(calls.length >= 180);
  const { found, refused } = walk(calls, PLAIN, { mustRefuse: false });
  assert.ok(refused >= 150, `${refused} of them are refused`);
  assert.deepEqual(found, []);
  const theirs = fixture('wrong-calls-meaning.json');
  assert.ok(theirs.length >= 150);
  const second = walk(theirs, SIBLING, { mustRefuse: false });
  assert.ok(second.refused >= 130, `${second.refused} of them are refused`);
  assert.deepEqual(second.found, []);
});
