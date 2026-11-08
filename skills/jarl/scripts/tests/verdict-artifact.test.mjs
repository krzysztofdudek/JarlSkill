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
import { jarl, refuses, skillText, loop as makeLoop } from './helpers.mjs';
import { USAGE } from '../jarl.mjs';
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

// The values --artifact refuses, each with the words of its reason: a place on one machine, an address or a host, a
// variable of a shell where one starts, a path that climbs out, and what one segment of the line cannot hold.
const PLACE = /is a place on one machine, which the record never holds/;
const SCHEMED = /opens with a scheme or a host and a port, which names no path inside the repository/;
const VARIABLE = /holds a variable of a shell, which stands for a place on one machine/;
const CLIMBS = /climbs out of it with \.\./;
const REFUSED = [
  ['/home/someone/render.png', PLACE], ['/', PLACE], ['\\renders\\x.png', PLACE], ['\\\\share\\render.png', PLACE], ['//server/share/x.png', PLACE],
  ['C:\\Users\\someone\\render.png', PLACE], ['C:/Users/u/x.png', PLACE], ['c:x.png', PLACE], ['a:b', PLACE],
  ['~/render.png', PLACE], ['~someone/render.png', PLACE],
  ['file:x.png', SCHEMED], ['file:/home/u/x.png', SCHEMED], ['file:/C:/Users/u/x.png', SCHEMED], ['file:C:/x.png', SCHEMED],
  ['file://server/share/x.png', SCHEMED], ['file:///home/u/x.png', SCHEMED], ['FILE:///C:/Users/u/x.png', SCHEMED], ['File:////server/share/x.png', SCHEMED],
  ['https://example.com/render.png', SCHEMED], ['HTTP://localhost:3000/render.png', SCHEMED], ['localhost:3000/x.png', SCHEMED], ['localhost:3000', SCHEMED],
  ['127.0.0.1:8080/x.png', SCHEMED], ['mailto:x', SCHEMED], ['data:image/png;base64,AAAA', SCHEMED], ['javascript:x', SCHEMED], ['svn+ssh:host/x.png', SCHEMED],
  ['$HOME/x.png', VARIABLE], ['${HOME}/x.png', VARIABLE], ['renders/$HOME/x.png', VARIABLE], ['renders\\$TMP\\x.png', VARIABLE], ['renders/a${X}.png', VARIABLE],
  ['%USERPROFILE%\\x.png', VARIABLE], ['renders/%TEMP%/x.png', VARIABLE],
  ['..', CLIMBS], ['../other/render.png', CLIMBS], ['renders/../../render.png', CLIMBS], ['renders\\..\\..\\x.png', CLIMBS],
  ['renders · home.png', /--artifact is one path on one line, with no · in it/], ['renders/\nhome.png', /--artifact is one path on one line/], ['  ', /--artifact needs a value/],
];
// The values --artifact writes as given: a path inside the repository, a $ or a % inside a name, a .. that stays inside.
const WRITTEN = ['renders/home page.png', './x', 'a/../b', 'renders\\x', 'renders/50%.png', 'price$total.png', 'a$b/c.png', 'renders/x%y%.png', 'renders/old/../home.png', 'v2.png'];

test('an artifact value with a scheme or a host, a drive, a root, a home, a variable where one starts, a climb out, a separator or a line break is refused with nothing written', () => {
  const { root, id } = inFlight();
  const before = log(root);
  for (const [path, said] of REFUSED) {
    const r = refuses(root, 'review', id, 'approve', '--by', 'rev-a', '--artifact', path, FINDINGS);
    assert.match(r, said, path);
    assert.match(r, /--artifact "<path>"\n$/, `the refusal ends with the form: ${path}`);
  }
  assert.equal(log(root), before, 'nothing was written');
  assert.equal(formatOf(root), 1);
});

test('a path inside the repository is written as given, a $ or a % inside a name and a .. that stays inside among them', () => {
  const { root, id } = inFlight();
  for (const path of WRITTEN) jarl(root, 'review', id, 'approve', '--by', 'rev-a', '--artifact', path, FINDINGS);
  const verdicts = loopEvents(join(root, '.jarl'), loadProfile(root)).filter((e) => e.type === 'verdict');
  assert.deepEqual(verdicts.map((e) => e.artifact), WRITTEN);
});

test('the help and the reviewer reference state the rule of an artifact value in the same words', () => {
  const sentence = (text) => /the value is a path inside the repository the work is in, [^;]*? is refused/i.exec(text.replace(/\s+/g, ' '))?.[0].toLowerCase();
  const help = sentence(USAGE);
  assert.ok(help, 'the help states the rule');
  assert.equal(sentence(skillText('references/reviewer.md')), help);
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
