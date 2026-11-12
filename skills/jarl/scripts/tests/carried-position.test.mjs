// A text the record already holds and copies into a line is carried at the place it is written in that line: the same text
// anywhere else in the line is new, and a new text that holds the owner's marker is refused wherever it stands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carryingOwnersWords, needNoNewOwnersWords } from '../lib/owner.mjs';

const MARKER = 'the owner\'s words: "yes"';
const REFUSED = /holds "The owner's words:"/;
const asRulingRow = { text: MARKER, before: / · $/, after: /^$/ };
const write = (line, ...carried) => carryingOwnersWords(carried, () => needNoNewOwnersWords('', `${line}\n`, 'the issue'));

test('a carried text is removed at the place it was written, the end of a row after its separator', () => {
  write(`Ruling x (by owner): keep it · ${MARKER}`, asRulingRow);
});

test('the same text elsewhere in the line is still refused: in front, in the middle, in the name, or twice', () => {
  assert.throws(() => write(`${MARKER} · Ruling x (by owner): keep it · ${MARKER}`, asRulingRow), REFUSED, 'at the start of the line');
  assert.throws(() => write(`Ruling x (by ${MARKER}): keep it · ${MARKER}`, asRulingRow), REFUSED, 'in the name of the writer');
  assert.throws(() => write(`Ruling x (by owner): keep ${MARKER} it · ${MARKER}`, asRulingRow), REFUSED, 'in the middle of the words');
  assert.throws(() => write(`Ruling x (by owner): keep it · ${MARKER} · ${MARKER}`, asRulingRow), REFUSED, 'twice, the first at a place the carry does not name');
  assert.throws(() => write(`Ruling x (by owner): keep it · ${MARKER} and more`, asRulingRow), REFUSED, 'followed by words that are new');
});

test('a carried text whose position is not given is refused as a call, so no writer carries a text anywhere', () => {
  assert.throws(() => carryingOwnersWords([MARKER], () => {}), /names where it stands in the line/);
  assert.throws(() => carryingOwnersWords([{ text: MARKER }], () => {}), /names where it stands in the line/);
});

test('a text that is whole-line, quoted after a word, or struck through is carried at its own frame and nowhere else', () => {
  const whole = { text: MARKER, before: /^$/, after: /^$/ };
  write(MARKER, whole);
  assert.throws(() => write(`note: ${MARKER}`, whole), REFUSED);
  const quoted = { text: `"${MARKER}"`, before: / was $/, after: /^(?: \(\d+ characters\))?(?: · by .*)?$/ };
  write(`1 body · title · was "${MARKER}" (40 characters)`, quoted);
  assert.throws(() => write(`1 body · title · was "x" · by "${MARKER}"`, quoted), REFUSED);
});
