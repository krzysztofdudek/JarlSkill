// A verdict names the render or file it judged with review --artifact <path>: the path is stored as given, in the verdict
// line after the reviewer's marks and in the Reviews entry, and show prints it with the verdict. A path that is absolute,
// or that climbs out of the repository with .., is refused with nothing written: the record holds no place on one machine.
// The first verdict that names one raises the loop to record format 3, which both readers of the lower formats refuse; a
// loop that names none is never raised, and a loop whose format a composer keeps refuses it with nothing written. report
// counts the verdicts that name one. Nothing gates on it: done and the merge read the verdict as they read any other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileAsBefore, formatTwoJarl, oldJarl } from './old-jarl.mjs';
import { jarl, refuses, loop as makeLoop } from './helpers.mjs';
import { FINDINGS } from './findings.mjs';
import { BUILTIN_STATUSES, loadProfile, loopEvents } from '../jarl-lib.mjs';

const log = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const marker = (root) => join(root, '.jarl', 'profile.json');
const formatOf = (root) => (existsSync(marker(root)) ? JSON.parse(readFileSync(marker(root), 'utf8')).format : 1);

// An issue filed as a loop of format 1 holds it, in progress with a proof row: nothing written so far raises the format.
function inFlight(prefix = 'jarl-artifact-', initFlags = []) {
  const root = makeLoop({ prefix, via: 'cli', initFlags });
  const id = fileAsBefore(root, 'a page change', { acceptance: 'the page renders' });
  jarl(root, 'set', id, 'in-progress', '--worker', 'w1');
  jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'pass 3, fail 0');
  return { root, id };
}

test('a verdict names its artifact: the line, the Reviews entry and show carry the path as given, and the event reads it', () => {
  const { root, id } = inFlight();
  jarl(root, 'review', id, 'changes', '--by', 'rev-a', '--model', 'm-1', '--artifact', 'renders/home page.png', 'Important: the header overlaps the menu');
  assert.match(log(root), new RegExp(`${id} review changes · by rev-a \\(fresh\\) · model m-1 · artifact renders/home page\\.png · Important: the header overlaps the menu`));
  const shown = jarl(root, 'show', id);
  assert.match(shown, /^- \*\*changes\*\* · by rev-a \(fresh\) · \d{4}-\d\d-\d\d · model m-1 · artifact renders\/home page\.png$/m);
  jarl(root, 'round', id, 'the header overlaps the menu');
  jarl(root, 'review', id, 'approve', '--by', 'rev-b', '--artifact', './renders/home.png', FINDINGS);
  assert.match(jarl(root, 'show', id), /^- \*\*approve\*\* · by rev-b \(fresh\) · \d{4}-\d\d-\d\d · artifact \.\/renders\/home\.png$/m);
  const verdicts = loopEvents(join(root, '.jarl'), loadProfile(root)).filter((e) => e.type === 'verdict');
  assert.deepEqual(verdicts.map((e) => [e.verdict, e.artifact, e.model]), [['changes', 'renders/home page.png', 'm-1'], ['approve', './renders/home.png', null]]);
  assert.match(JSON.parse(jarl(root, 'show', id, '--json')).sections.reviews, /artifact renders\/home page\.png/);
  // The artifact gates nothing: the approve clears the issue as any other.
  assert.match(jarl(root, 'set', id, 'done', 'approved', '--by', 'jarl'), new RegExp(`${id} → done`));
});

test('the brief pairs a verdict that names an artifact with its Reviews entry, and gives its findings whole', () => {
  const { root, id } = inFlight();
  jarl(root, 'review', id, 'changes', '--by', 'rev-a', '--artifact', 'renders/home.png', 'Important: the header overlaps the menu\nthe footer is cut at the bottom');
  jarl(root, 'round', id, 'the header overlaps the menu');
  const brief = jarl(root, 'brief', id);
  assert.match(brief, /the footer is cut at the bottom/);
  assert.doesNotMatch(brief, /more lines, whole text in/);
});

test('a finding that opens like an artifact mark is kept as text', () => {
  const { root, id } = inFlight();
  jarl(root, 'review', id, 'approve', '--by', 'rev-a', 'artifact renders/x.png · was read and nothing was found in it');
  assert.match(log(root), new RegExp(`${id} review approve · by rev-a \\(fresh\\) · findings: artifact renders/x\\.png · was read`));
  assert.equal(formatOf(root), 1, 'a verdict that names no artifact raises nothing');
  assert.doesNotMatch(jarl(root, 'report', '--metrics'), /verdicts that name an artifact/);
});

test('an absolute path, a home path, an address with a scheme, a variable of a shell, a path that climbs out, and one with a separator or a line break are refused with nothing written', () => {
  const { root, id } = inFlight();
  const before = log(root);
  for (const [path, said] of [
    ['/home/someone/render.png', /is a place on one machine, which the record never holds/],
    ['C:\\Users\\someone\\render.png', /is a place on one machine/],
    ['\\\\share\\render.png', /is a place on one machine/],
    ['~/render.png', /is a place on one machine/],
    ['file:///home/u/x.png', /is an address with a scheme, which names no path inside the repository/],
    ['file:///C:/Users/u/x.png', /is an address with a scheme/],
    ['https://example.com/render.png', /is an address with a scheme/],
    ['http://localhost:3000/render.png', /is an address with a scheme/],
    ['$HOME/x.png', /holds a variable of a shell, which stands for a place on one machine/],
    ['${HOME}/x.png', /holds a variable of a shell/],
    ['%USERPROFILE%\\x.png', /holds a variable of a shell/],
    ['../other/render.png', /climbs out of it with \.\./],
    ['renders/../../render.png', /climbs out of it with \.\./],
    ['renders · home.png', /--artifact is one path on one line, with no · in it/],
    ['renders/\nhome.png', /--artifact is one path on one line/],
    ['  ', /--artifact needs a value/],
  ]) {
    const r = refuses(root, 'review', id, 'approve', '--by', 'rev-a', '--artifact', path, FINDINGS);
    assert.match(r, said, path);
    assert.match(r, /--artifact "<path>"\n$/, `the refusal ends with the form: ${path}`);
  }
  assert.equal(log(root), before, 'nothing was written');
  assert.equal(formatOf(root), 1);
  // A path that goes down and back up inside the repository stays in it.
  jarl(root, 'review', id, 'approve', '--by', 'rev-a', '--artifact', 'renders/old/../home.png', FINDINGS);
  assert.match(log(root), / · artifact renders\/old\/\.\.\/home\.png · /);
});

test('the first verdict that names an artifact raises the loop to format 3, which both readers of the lower formats refuse', () => {
  const { root, id } = inFlight();
  jarl(root, 'review', id, 'changes', '--by', 'rev-a', 'Important: the header overlaps the menu');
  assert.equal(formatOf(root), 1, 'a verdict with no artifact raises nothing');
  for (const read of [oldJarl, formatTwoJarl]) assert.equal(read(root, 'status', {}).ok, true, 'both readers still read the loop');
  jarl(root, 'review', id, 'approve', '--by', 'rev-b', '--artifact', 'renders/home.png', FINDINGS);
  assert.equal(formatOf(root), 3);
  for (const read of [oldJarl, formatTwoJarl]) assert.match(read(root, 'status', {}).error, /written for record format 3/);
});

test('a loop whose format a composer keeps refuses a verdict that names an artifact, with nothing written', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'jarl-artifact-profile-')), 'profile.json');
  writeFileSync(file, JSON.stringify({ 'jarl-profile': 1, name: 'composed', statuses: BUILTIN_STATUSES, 'external-scheduler': 'the composer tick' }));
  const { root, id } = inFlight('jarl-artifact-composed-', ['--profile', file]);
  const before = log(root);
  assert.match(refuses(root, 'review', id, 'approve', '--by', 'rev-a', '--artifact', 'renders/home.png', FINDINGS), /the artifact a verdict judged needs record format 3, and this loop stays at format 1: its profile names an external scheduler/);
  assert.equal(log(root), before);
});

test('report counts the verdicts that name an artifact', () => {
  const { root, id } = inFlight();
  const other = fileAsBefore(root, 'another page', { acceptance: 'it renders' });
  jarl(root, 'set', other, 'in-progress', '--worker', 'w2');
  jarl(root, 'review', id, 'changes', '--by', 'rev-a', '--artifact', 'renders/home.png', 'Important: the header overlaps the menu');
  jarl(root, 'review', id, 'approve', '--by', 'rev-b', '--artifact', 'renders/home.png', FINDINGS);
  jarl(root, 'review', other, 'approve', '--by', 'rev-b', '--artifact', 'renders/about.png', FINDINGS);
  jarl(root, 'review', other, 'approve', '--by', 'rev-c', FINDINGS);
  assert.match(jarl(root, 'report', '--metrics'), new RegExp(`^verdicts that name an artifact: 3 \\(approve 2, changes 1\\) on 2 issues: ${id}, ${other}$`, 'm'));
  assert.deepEqual(JSON.parse(jarl(root, 'report', '--json')).metrics.artifacts, { n: 3, approve: 2, changes: 1, issues: [id, other] });
});
