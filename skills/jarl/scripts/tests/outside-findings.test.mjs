// A reviewer judges the issue it was given: a finding outside the issue is given with --outside, apart from the verdict,
// and is filed as a new issue whose Found by is the reviewer and whose Where names the reviewed issue; the verdict stands
// on the findings of the issue alone. A changes verdict whose only Critical or Important findings are outside the issue is
// refused, writes nothing, and ends with the form of the review that files them instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, jarl, refuses, loop as makeLoop } from './helpers.mjs';

const loop = () => makeLoop({ prefix: 'jarl-outside-', via: 'cli', dotGit: false });
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const logText = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const fileOf = (root, id) => readFileSync(json(root, 'show', id).file, 'utf8');
const issueFiles = (root) => json(root, 'list', '--all').map((i) => i.id);

// One issue in a lease with a proof row, ready for its review.
function leased() {
  const root = loop();
  jarl(root, 'new', 'the csv export', '--acceptance', 'the export writes csv', '--repo', gitRepo({ prefix: 'jarl-outside-tool-' }).dir);
  jarl(root, 'set', '1', 'in-progress', 'start', '--worker', 'w1');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'tests 4, pass 4');
  return root;
}

test('an approve with a finding outside the issue files that finding as a new issue found by the reviewer, and the approve stands', () => {
  const root = leased();
  const out = jarl(root, 'review', '1', 'approve', 'read the diff and the test, the export writes csv', '--by', 'rev-a',
    '--outside', 'Important: the json export drops the header row', '--outside', 'Minor: the docs name the old flag');
  assert.match(out, /^1 review approve by rev-a \(fresh\)/m);
  assert.match(out, /filed outside the issue: 2, 3/);
  const filed = json(root, 'show', '2');
  assert.equal(filed.title, 'Important: the json export drops the header row');
  assert.equal(filed.fields['found by'], 'rev-a');
  assert.equal(filed.fields.where, 'the review of 1');
  assert.equal(filed.fields.repo, json(root, 'show', '1').fields.repo, 'the finding is filed against the repository the reviewed issue names');
  assert.match(filed.sections.what, /^Important: the json export drops the header row$/m);
  assert.equal(json(root, 'show', '3').fields['found by'], 'rev-a');
  // The verdict judges the issue alone: the approve is live, and the Reviews entry names the issues filed beside it.
  assert.equal(json(root, 'status').inFlightRows.find((r) => r.id === '1').mark, 'approved');
  assert.match(fileOf(root, '1'), /^ {2}outside the issue, filed as 2: Important: the json export drops the header row$/m);
  assert.match(fileOf(root, '1'), /^ {2}outside the issue, filed as 3: Minor: the docs name the old flag$/m);
  assert.match(logText(root), /· filed 2 · Important: the json export drops the header row$/m);
  assert.match(logText(root), /· 1 review approve · by rev-a \(fresh\) · read the diff/m);
  jarl(root, 'set', '1', 'done', 'proved and approved');
  assert.equal(json(root, 'show', '1').status, 'done');
});

test('a changes verdict whose only Critical or Important findings are outside the issue is refused, writes nothing, and ends with the form that files them', () => {
  const root = leased();
  const before = logText(root);
  const said = refuses(root, 'review', '1', 'changes', 'read the diff, Minor: a comment is stale', '--by', 'rev-a', '--outside', 'Important: the json export drops the header row');
  assert.match(said, /its only Critical or Important findings are outside the issue/);
  const form = said.trim().split('\n').pop();
  assert.match(form, /^jarl\.mjs review "<ids>" "<verdict>" "<what-was-read-and-found>" --by "<reviewer>" --outside "<finding-outside-the-issue>"$/);
  assert.equal(logText(root), before, 'a refused review writes no line');
  assert.deepEqual(issueFiles(root), ['1'], 'and files nothing');
});

test('a changes verdict with a finding of the issue still files a finding outside it, and sends the work back for its own', () => {
  const root = leased();
  const out = jarl(root, 'review', '1', 'changes', 'Important: the export writes no csv for an empty table', '--by', 'rev-a', '--outside', 'Critical: the importer crashes on a BOM');
  assert.match(out, /^1 review changes by rev-a \(fresh\)/m);
  assert.match(out, /filed outside the issue: 2/);
  assert.equal(json(root, 'show', '2').fields['found by'], 'rev-a');
});

test('a finding outside the issue needs words, and a refused one files nothing', () => {
  const root = leased();
  const before = logText(root);
  const said = refuses(root, 'review', '1', 'approve', 'read the diff and the test, the export writes csv', '--by', 'rev-a', '--outside', ' - ');
  assert.match(said, /a finding outside the issue needs words/);
  assert.equal(logText(root), before);
  assert.deepEqual(issueFiles(root), ['1']);
});

test('the reviewer brief names the form that files a finding outside the issue with the verdict', () => {
  const root = leased();
  const brief = jarl(root, 'brief', '1', '--role', 'reviewer');
  assert.match(brief, /^- the verdict when a finding lies outside the issue, one --outside each \(filed as a new issue, never a reason for changes\): jarl\.mjs review 1 "<verdict>" "<findings-with-a-severity>" --by "<reviewer>" --model "<model-id>" --outside "<finding-outside-the-issue>"$/m);
  assert.match(brief, /\n- the verdict, as the last step: jarl\.mjs review 1 "<verdict>" "<findings-with-a-severity>" --by "<reviewer>" --model "<model-id>"$/);
});
