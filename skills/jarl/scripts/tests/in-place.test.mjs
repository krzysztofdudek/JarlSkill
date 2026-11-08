// An issue tagged in-place is worked in place: its worker writes the files it declares in the loop's own checkout, with no
// branch and no merge, and they are committed in the main checkout once the approve stands. The lease takes no branch and needs the
// files declared, which keep two such issues off one file as for any lease. It closes on the commit of its files: a row of
// its proof names a commit on the branch checked out that changes one of them. The tag is a line of record format 3: its
// first write raises the loop, and the frozen readers, which would close the issue with no commit named, refuse it. An
// issue that carries code is never tagged in-place, and its own gate stays as it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileAsBefore, formatTwoJarl } from './old-jarl.mjs';
import { gitRepo, jarl, refuses, run } from './helpers.mjs';
import { FINDINGS } from './findings.mjs';

const lastLine = (text) => text.trim().split('\n').pop();
const logText = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
function placeLoop() {
  const { dir, g } = gitRepo({ prefix: 'jarl-in-place-', branch: 'main' });
  jarl(dir, 'init', 'write the guides');
  mkdirSync(join(dir, 'docs'));
  return { root: dir, g };
}
const nextIds = (root) => JSON.parse(jarl(root, 'next', '--json')).filter((r) => r.ready !== false).map((r) => r.id);

test('an issue worked in place is leased with no branch on the files it declares, and next keeps two of them off one file', () => {
  const { root } = placeLoop();
  jarl(root, 'new', 'write the guide', '--tags', 'in-place', '--files', 'docs/guide.md', '--acceptance', 'it reads well');
  jarl(root, 'new', 'fix a typo in the guide', '--tags', 'in-place', '--files', 'docs/guide.md', '--acceptance', 'no typo');
  jarl(root, 'new', 'write the faq', '--tags', 'in-place', '--acceptance', 'it answers');
  assert.match(jarl(root, 'next', '--as', 'jarl'), /jarl\.mjs set 1 in-progress --worker "<name>" --model "<model-id>"/, 'the ready row leases it with no branch');
  let said = refuses(root, 'set', '1', 'in-progress', '--branch', 'jarl/1-guide', '--worker', 'w1', '--by', 'jarl');
  assert.match(said, /^1 is worked in place: its worker writes the files it declares in the loop's own checkout, with no branch and no worktree of its own/);
  assert.equal(lastLine(said), 'jarl.mjs set "<ids>" "<status>" --worker "<the-new-worker>" --by "<who>"');
  said = refuses(root, 'set', '3', 'in-progress', '--worker', 'w3', '--by', 'jarl');
  assert.match(said, /^3 is worked in place and declares no files: it names the files it writes before it is leased/);
  assert.equal(lastLine(said), 'jarl.mjs field 3 Files "<paths>"');
  jarl(root, 'set', '1', 'in-progress', '--worker', 'w1', '--by', 'jarl');
  const ids = nextIds(root);
  assert.ok(!ids.includes('2'), `the second issue on the same file is held: ${ids.join(', ')}`);
  assert.match(refuses(root, 'set', '2', 'in-progress', '--worker', 'w2', '--by', 'jarl'), /docs\/guide\.md/);
});

test('an issue worked in place closes on a row that names a commit of its files on the branch checked out, and never before', () => {
  const { root, g } = placeLoop();
  jarl(root, 'new', 'write the guide', '--tags', 'in-place', '--files', 'docs/guide.md', '--acceptance', 'it reads well');
  jarl(root, 'set', '1', 'in-progress', '--worker', 'w1', '--by', 'jarl');
  writeFileSync(join(root, 'docs', 'guide.md'), '# Guide\n');
  jarl(root, 'evidence', '1', '--ran', 'proofread docs/guide.md', '--saw', 'reads well', '--by', 'w1');
  jarl(root, 'review', '1', 'approve', '--by', 'rev-1', FINDINGS);
  assert.match(jarl(root, 'next', '--as', 'jarl'), /approved and worked in place; commit its files, record the commit as a row, then close it/);
  let said = refuses(root, 'set', '1', 'done', 'written', '--by', 'jarl');
  assert.match(said, /^1 is worked in place, and no row of its proof since it was moved → in-progress names a commit on the branch checked out that changes docs\/guide\.md — once the approve stands, its files are committed in the main checkout \(by the merger where one runs, else the coordinator\), and the commit is recorded as a row/);
  assert.equal(lastLine(said), 'jarl.mjs evidence "<id>" --ran "<command>" --saw "<what-it-printed>"');
  // A commit that changes another file does not close it.
  writeFileSync(join(root, 'other.txt'), 'other\n');
  g('add', 'other.txt'); g('commit', '-qm', 'other');
  const other = g('rev-parse', '--short', 'HEAD').trim();
  jarl(root, 'evidence', '1', '--ran', 'git commit', '--saw', `${other} other`, '--by', 'jarl');
  assert.match(refuses(root, 'set', '1', 'done', 'written', '--by', 'jarl'), /^1 is worked in place, and no row of its proof/);
  g('add', 'docs/guide.md'); g('commit', '-qm', 'the guide');
  const sha = g('rev-parse', '--short', 'HEAD').trim();
  jarl(root, 'evidence', '1', '--ran', 'git commit docs/guide.md', '--saw', `${sha} the guide`, '--by', 'jarl');
  const r = run(root, ['set', '1', 'done', 'written and committed', '--by', 'jarl']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(logText(root), /1 → done · written and committed/);
});

test('the tag in-place raises the loop to format 3, which the frozen reader then refuses, and an issue that carries code is never tagged with it', () => {
  const { root } = placeLoop();
  fileAsBefore(root, 'a guide filed by the first reader');
  assert.equal(formatTwoJarl(root, 'list', {}).ok, true);
  jarl(root, 'field', '1', 'Tags', 'in-place', '--add');
  assert.equal(JSON.parse(readFileSync(join(root, '.jarl', 'profile.json'), 'utf8')).format, 3);
  const two = formatTwoJarl(root, 'list', {});
  assert.equal(two.ok, false, 'the reader that would close it with no commit named refuses the loop');
  assert.match(two.error, /written for record format 3/);
  jarl(root, 'new', 'change the code');
  jarl(root, 'set', '2', 'in-progress', '--branch', 'jarl/2-code', '--worker', 'w2', '--by', 'jarl');
  const said = refuses(root, 'field', '2', 'Tags', 'in-place', '--add');
  assert.match(said, /^2 carries code \(Branch is recorded\), which its merge lands: an issue worked in place has no branch and no merge, so it is not tagged in-place/);
  assert.equal(lastLine(said), 'jarl.mjs field "<ids>" Tags "<items>" --add');
});

test('below format 3 the tag in-place is a tag like any other, and verify says so', () => {
  const { root } = placeLoop();
  fileAsBefore(root, 'a guide filed by the first reader', { tags: 'in-place' });
  const r = run(root, ['verify']);
  assert.match(r.stdout, /^note: issue 001: its tag in-place marks it as worked in place only in record format 3, and this loop is in format 1/m);
});
