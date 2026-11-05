// A reviewer judges the issue it was given: a finding outside the issue is given with --outside, apart from the verdict,
// and is filed as a new issue whose Found by is the reviewer and whose Where names the reviewed issue; the verdict stands
// on the findings of the issue alone. A changes verdict whose only Critical or Important findings are outside the issue is
// refused, writes nothing, and ends with the form of the review that files them instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitRepo, jarl, refuses, run, windowsWords, loop as makeLoop } from './helpers.mjs';
import { fileAsBefore, oldJarl } from './old-jarl.mjs';
import * as R from '../record.mjs';
import * as L from '../jarl-lib.mjs';

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

// What a refusal must leave as it was: the log, every issue file by name and text, and the profile.
function snapshot(root) {
  const dir = join(root, '.jarl', 'issues');
  const profile = join(root, '.jarl', 'profile.json');
  return { log: logText(root), files: readdirSync(dir).sort().map((f) => [f, readFileSync(join(dir, f), 'utf8')]), profile: existsSync(profile) ? readFileSync(profile, 'utf8') : null };
}
// The form a refusal ends with, its placeholders filled: a review call that names one issue and one finding of each kind.
const FILLED = { '<ids>': '1', '<verdict>': 'approve', '<what-was-read-and-found>': 'read the diff and the test, the export writes csv', '<reviewer>': 'rev-a', '<model-id>': 'm-1', '<finding-outside-the-issue>': 'Important: the importer drops the header row', '<name=value>': 'Area=core' };
function filled(form) {
  const words = windowsWords(form).slice(1).map((w) => w.replace(/<[a-z=-]+>/g, (p) => FILLED[p] ?? p));
  assert.ok(!words.some((w) => /<[a-z=-]+>/.test(w)), `every placeholder of ${form} is filled`);
  return words;
}

test('a review whose second finding outside the issue cannot be filed writes nothing at all, and ends with a review form that runs when filled', () => {
  const root = leased();
  const before = snapshot(root);
  const said = refuses(root, 'review', '1', 'approve', 'read the diff and the test, the export writes csv', '--by', 'rev-a', '--model', 'm-1',
    '--outside', 'Important: the json export drops the header row', '--outside', 'Important: a <why>reason</why> sits in the text');
  assert.match(said, /^the finding outside the issue "Important: a <why>reason<\/why> sits in the text" cannot be filed: the What text holds an opening and a closing why tag/);
  const form = said.trim().split('\n').pop();
  assert.doesNotMatch(form, /--why/, 'the form carries no flag review refuses');
  assert.match(form, /--model "<model-id>"/);
  assert.deepEqual(snapshot(root), before, 'nothing was written: no issue filed, no verdict, no line');
  const again = run(root, filled(form));
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /filed outside the issue: 2 ·/);
});

const PROFILE = { 'jarl-profile': 1, name: 'outside', statuses: L.BUILTIN_STATUSES, fields: { Area: { enum: ['core', 'cli'], required: true }, Team: { default: 'tools' } } };
function profiledLeased() {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-outside-profile-'));
  const file = join(dir, 'profile.json');
  writeFileSync(file, JSON.stringify(PROFILE));
  const root = makeLoop({ prefix: 'jarl-outside-fielded-', via: 'cli', dotGit: false, initFlags: ['--profile', file] });
  jarl(root, 'new', 'the csv export', '--acceptance', 'the export writes csv', '--field', 'Area=cli');
  jarl(root, 'set', '1', 'in-progress', 'start', '--worker', 'w1');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'tests 4, pass 4');
  return root;
}

test('in a loop whose profile requires a field, a finding outside the issue takes it with --field, a default fills the rest, and the refusal without it is a review form that runs when filled', () => {
  const root = profiledLeased();
  const before = snapshot(root);
  const said = refuses(root, 'review', '1', 'approve', 'read the diff and the test, the export writes csv', '--by', 'rev-a', '--outside', 'Important: the importer drops the header row');
  assert.match(said, /cannot be filed: Area is required by this loop's profile/);
  const form = said.trim().split('\n').pop();
  assert.match(form, /--field "<name=value>"/);
  assert.deepEqual(snapshot(root), before);
  const again = run(root, filled(form));
  assert.equal(again.status, 0, again.stderr);
  const filedIssue = json(root, 'show', '2');
  assert.equal(filedIssue.fields.area, 'core');
  assert.equal(filedIssue.fields.team, 'tools', 'a field with a default takes it');
  // --field names the fields of the issues --outside files: with no --outside it names nothing, and is refused.
  const alone = refuses(root, 'review', '1', 'approve', 'read the diff and the test, the export writes csv', '--by', 'rev-b', '--field', 'Area=core');
  assert.match(alone, /--field names a field of the issues --outside files/);
});

test('the issue a finding outside a format-1 loop files names the reviewed issue\'s repository as the raise leaves it, and verify stays clean', () => {
  const root = makeLoop({ prefix: 'jarl-outside-format1-', via: 'cli', dotGit: false });
  const tool = join(root, 'tool');
  mkdirSync(tool);
  const g = (...a) => execFileSync('git', a, { cwd: tool, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  writeFileSync(join(tool, 'a.txt'), 'a\n'); g('add', '-A'); g('commit', '-qm', 'base');
  const id = fileAsBefore(root, 'the csv export', { acceptance: 'the export writes csv', repo: 'tool' });
  assert.equal(json(root, 'show', id).fields.repo, 'tool', 'the format-1 reader writes the path bare');
  assert.equal(oldJarl(root, 'set', {}, [id, 'in-progress', null, { worker: 'w1' }]).ok, true);
  jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'tests 4, pass 4');
  const out = jarl(root, 'review', id, 'approve', 'read the diff and the test, the export writes csv', '--by', 'rev-a', '--outside', 'Important: the importer drops the header row');
  const filedId = /filed outside the issue: (\S+)/.exec(out)[1];
  assert.equal(json(root, 'show', id).fields.repo, './tool', 'the raise wrote the reviewed issue\'s path with a leading ./');
  assert.equal(json(root, 'show', filedId).fields.repo, './tool', 'and the filed issue names it the same way');
  const v = run(root, ['verify']);
  assert.equal(v.status, 0, v.stdout);
});

test('a finding outside an issue that names an undeclared repository is filed naming it the same way, so verify says the same of both', () => {
  const root = leased();
  const file = json(root, 'show', '1').file;
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^\*\*Repo:\*\* .*$/m, '**Repo:** tool'));
  jarl(root, 'review', '1', 'approve', 'read the diff and the test, the export writes csv', '--by', 'rev-a', '--outside', 'Important: the importer drops the header row');
  assert.equal(json(root, 'show', '2').fields.repo, 'tool');
  const said = run(root, ['verify']).stdout;
  assert.match(said, /^verify: 1 finding$/m, said);
  assert.match(said, /^\s*tool: is named \(named by issue 1, 2\) but has no declaration in \.jarl\/repos\.md$/m, 'one finding names the pair');
});

test('the library\'s newIssue writes no Repo it did not check, and its review refuses a finding outside the issue on a retraction', () => {
  const root = leased();
  const { id } = R.newIssue(root, 'a hand filing', { repoAsHeld: '../../nowhere/at/all' });
  assert.equal(R.findIssue(root, id).fields.repo, undefined, 'repoAsHeld is no option of newIssue');
  R.review(root, '1', 'approve', 'read the diff and the test, the export writes csv', { by: 'rev-a' });
  const before = snapshot(root);
  assert.throws(() => R.review(root, '1', 'retract', 'the approve came too early', { by: 'jarl', outside: 'Important: the importer drops the header row' }), /a retraction files no finding outside the issue/);
  assert.deepEqual(snapshot(root), before);
});

test('the reviewer brief names the form that files a finding outside the issue with the verdict', () => {
  const root = leased();
  const brief = jarl(root, 'brief', '1', '--role', 'reviewer');
  assert.match(brief, /^- the verdict when a finding lies outside the issue, one --outside each \(filed as a new issue, never a reason for changes\): jarl\.mjs review 1 "<verdict>" "<findings-with-a-severity>" --by "<reviewer>" --model "<model-id>" --outside "<finding-outside-the-issue>"$/m);
  assert.match(brief, /\n- the verdict, as the last step: jarl\.mjs review 1 "<verdict>" "<findings-with-a-severity>" --by "<reviewer>" --model "<model-id>"$/);
});
