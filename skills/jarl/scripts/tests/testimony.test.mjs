// A multi-line text given to a command is kept whole: in the issue, the question or the ruling, never cut to its
// first line, and the log (one line per event) never holds a raw newline. The pinned frozen reader still reads such a loop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { oldJarl } from './old-jarl.mjs';
import { jarl, loop as makeLoop } from './helpers.mjs';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const L = await import(new URL('../jarl-lib.mjs', import.meta.url).href);

const three = (tag) => `${tag} line one\n${tag} line two\n${tag} line three`;
const lines = (tag) => three(tag).split('\n');
const has = (text, tag) => lines(tag).every((l) => text.includes(l));
const read = (root, name) => readFileSync(join(root, '.jarl', name), 'utf8');

const loop = () => makeLoop({ prefix: 'jarl-testimony-', goal: three('goal'), via: 'cli' });

test('three lines through every command that writes text: whole in the issue, the question and the ruling, and one line in the log', () => {
  const root = loop();
  const id = JSON.parse(jarl(root, 'new', 'multi-line testimony', '--what', three('what'), '--why', three('why'), '--acceptance', three('acceptance'), '--changelog', 'Fixed: x', '--json')).id;
  assert.equal(id, '1');
  const t = JSON.parse(jarl(root, 'new', three('title'), '--json')).id;
  assert.match(readFileSync(L.findIssue(root, t).file, 'utf8'), /^# 2 · title line one title line two title line three\n/, 'a title of three lines is one heading with every line');
  jarl(root, 'body', id, '--what', three('body-what'), '--why', three('body-why'));
  jarl(root, 'evidence', id, three('evidence'));
  jarl(root, 'evidence', id, '--ran', three('ran'), '--saw', three('saw'));
  jarl(root, 'set', id, 'in-progress', '--worker', 'w-one', '--branch', 'jarl/1-x');
  jarl(root, 'round', id, three('round'));
  jarl(root, 'review', id, 'changes', '--by', 'reviewer-one', `Important: ${three('review')}`);

  const issue = readFileSync(L.findIssue(root, id).file, 'utf8');
  for (const tag of ['acceptance', 'body-what', 'body-why', 'evidence']) assert.ok(has(issue, tag), `${tag} is whole in the issue`);
  for (const l of ['Important: review line one', 'review line two', 'review line three']) assert.ok(issue.includes(l), `${l} is in the issue`);
  const reviews = L.parseIssue(issue, 'x').sections.reviews;
  assert.match(reviews, /changes/);
  assert.match(reviews, /reviewer-one \(fresh\)/);
  assert.ok(reviews.includes('review line three'));
  assert.ok(issue.indexOf('## Reviews') < issue.indexOf('## Evidence'), 'Evidence stays last');
  assert.ok(has(issue, 'ran') && has(issue, 'saw'), 'the rows keep every line');
  assert.ok(has(jarl(root, 'show', id, '--full'), 'evidence'));
  const shown = JSON.parse(jarl(root, 'show', id, '--json'));
  assert.ok(shown.sections.reviews.includes('review line two'), '--json carries the whole review');

  const q = jarl(root, 'ask', three('question'), '--kind', 'stuck', '--issue', id, '--json');
  const askId = JSON.parse(q).id;
  assert.ok(L.loadAsks(root).find((a) => a.id === askId).question.split('\n').length === 3, 'the question keeps its lines');
  assert.ok(has(read(root, 'asks.md'), 'question'));
  jarl(root, 'answer', askId, three('answer'));
  assert.ok(has(read(root, 'decisions.md'), 'question') && has(read(root, 'decisions.md'), 'answer'), 'the ruling holds the whole question and answer');
  jarl(root, 'decide', 'multi-ruling', three('ruling'), '--settles', id);
  assert.ok(has(read(root, 'decisions.md'), 'ruling'));
  const after = readFileSync(L.findIssue(root, id).file, 'utf8');
  assert.match(after, /Ruling multi-ruling: ruling line one/);
  assert.match(after, /multi-ruling/);
  assert.match(after, /ask-1/);
  assert.match(after, /decisions\.md/);

  jarl(root, 'log', three('log'));
  jarl(root, 'set', id, 'deferred', three('reason'));
  const log = read(root, 'log.md');
  for (const l of log.split('\n').filter(Boolean)) assert.match(l, /^(# Log|- \d{4}-\d{2}-\d{2} \d{2}:\d{2} · .*)$/, `a log line is one line: ${JSON.stringify(l)}`);
  assert.match(log, /review changes · by reviewer-one \(fresh\) · Important: review line one \(\+2 more lines/);
  assert.ok(log.includes('log line three'), 'a log text with no other home keeps every line');
  assert.ok(log.includes('round line three'), 'a round keeps every line');
  assert.ok(log.includes('question line one'));
});

test('a verdict line with its pointer, and a multi-line question, read right under the pinned frozen reader', async () => {
  const root = loop();
  // Filed by the library, whose number has three digits, so the loop stays format 1 for the frozen reader.
  const id = (await import('../record.mjs')).newIssue(root, 'old reader', { acceptance: 'it works' }).id;
  jarl(root, 'set', id, 'in-progress', '--worker', 'w-one', '--branch', 'jarl/1-x');
  jarl(root, 'review', id, 'changes', '--by', 'reviewer-one', `Important: ${three('review')}`);
  // Questions are filed by the library as well, so the loop stays format 1 for the frozen reader.
  const R = await import('../record.mjs');
  R.ask(root, three('question'), { kind: 'stuck' });
  R.ask(root, 'next question');
  assert.equal(oldJarl(root, 'list', {}).ok, true);
  const status = oldJarl(root, 'status', {});
  assert.equal(status.ok, true, status.error);
  assert.equal(status.value.counts?.questions ?? status.value.questions, 2, 'the old reader counts both questions, each once');
  assert.equal(status.value.inFlight, 1, 'the old reader still sees the issue in flight under its Reviews section');
  assert.equal(oldJarl(root, 'next', {}).ok, true);
  assert.equal(oldJarl(root, 'queue', {}).ok, true);
});
