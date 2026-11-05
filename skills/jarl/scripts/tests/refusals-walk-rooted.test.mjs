// The walk of every generated wrong call given --root (one in three written --root=) and, one in four, --json, run from
// the top of a checkout that holds two loops, the call naming the one in releases/r1 (init the empty releases/r2, base the
// checkout of the loop with a sibling repository): each form carries the global flags as given, and pasted as printed it
// writes in neither loop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOTED, rootedWrongCalls, walk } from './walk.mjs';

test('every generated wrong call given --root or --json ends with a form that carries them as given, and pasted where the call was made writes in no loop of the checkout', () => {
  const calls = rootedWrongCalls();
  assert.ok(calls.length >= 300, `the walk makes ${calls.length} calls`);
  assert.ok(calls.filter((c) => c.args.includes('--json')).length >= 70);
  const { found } = walk(calls, ROOTED, { mustRefuse: true });
  assert.deepEqual(found, []);
});
