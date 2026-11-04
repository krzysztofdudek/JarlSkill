// The walk of the wrong calls the command table makes (tests/walk.mjs): every writing command, each required argument
// left out, each value of a closed set wrong (in another case, misspelt, outside the set), an unknown flag with and
// without a value, a flag given with no value or twice, a removed command or flag with extra words, a free text given as a
// flag or starting with dashes, an id or a range the loop does not hold, words a shell reads something in, and the calls
// of the reviews. Each is refused, writes nothing, names its wrong word, and ends with a form that, pasted as printed into
// sh and zsh, is refused for its placeholder and writes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAIN, generateWrongCalls, walk } from './walk.mjs';

test('every generated wrong call of every writing command is refused, writes nothing, names its wrong word, and ends with a form that pasted as printed is refused for its placeholder', () => {
  const calls = generateWrongCalls();
  assert.ok(calls.length >= 300, `the walk makes ${calls.length} calls`);
  const { found } = walk(calls, PLAIN, { mustRefuse: true });
  assert.deepEqual(found, []);
});
