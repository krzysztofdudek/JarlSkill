// A verdict names the render or file it judged with review --artifact <path>: the path is stored as given, in the verdict
// line after the reviewer's marks and in the Reviews entry, and show prints it with the verdict. A value that is not a
// plain relative path inside the repository is refused with nothing written, its reason named: the record holds no place
// on one machine (artifact-path.test.mjs proves the rule over a product of values).
// loop that names none is never raised, and a loop whose format a composer keeps refuses it with nothing written. report
// counts the verdicts that name one. Nothing gates on it: done and the merge read the verdict as they read any other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileThreeDigits } from './helpers.mjs';
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
  const id = fileThreeDigits(root, 'a page change', { acceptance: '[read] the page renders' });
  jarl(root, 'set', id, 'in-progress', '--worker', 'w1');
  jarl(root, 'evidence', id, '--line', '1', '--ran', 'npm test', '--saw', 'pass 3, fail 0');
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
  assert.match(jarl(root, 'show', id), /^- \*\*approve\*\* · by rev-b \(fresh\) · \d{4}-\d\d-\d\d · (?:model test-model · )?artifact \.\/renders\/home\.png$/m);
  const verdicts = loopEvents(join(root, '.jarl'), loadProfile(root)).filter((e) => e.type === 'verdict');
  assert.deepEqual(verdicts.map((e) => [e.verdict, e.artifact, e.model]), [['changes', 'renders/home page.png', 'm-1'], ['approve', './renders/home.png', 'test-model']]);
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
  assert.match(log(root), new RegExp(`${id} review approve · by rev-a \\(fresh\\) · model test-model · findings: artifact renders/x\\.png · was read`));
  assert.doesNotMatch(jarl(root, 'report', '--metrics'), /verdicts that name an artifact/);
});

// The values --artifact refuses, each with the words of its reason: a root, a colon (a scheme, a host and its port, a
// drive), a home, a $ or a % where a shell expands it, a climb, and a character that is not plain.
const RULE = /--artifact is a relative path inside the repository the work is in, in plain characters \(the help of review names them\), and /;
const ROOT = /opens with a separator, a root on one machine/;
const COLON = /holds U\+003A \(:\) at character \d+: a colon parts a scheme, a host and its port, a drive or a stream/;
const HOME = /holds U\+007E \(~\) at character 1: a ~ is a home or a short name of Windows/;
const DOLLAR = /holds U\+0024 \(\$\) at character \d+: a \$ stands only between two letters or digits/;
const PERCENT = /holds U\+0025 \(%\) at character \d+: a % stands neither first in a segment nor before two hex digits/;
const CLIMBS = /climbs with \.\./;
const REFUSED = [
  ['/home/someone/render.png', ROOT], ['/', ROOT], ['\\renders\\x.png', ROOT], ['\\\\share\\render.png', ROOT], ['//server/share/x.png', ROOT],
  ['C:\\Users\\someone\\render.png', COLON], ['C:/Users/u/x.png', COLON], ['c:x.png', COLON], ['a:b', COLON],
  ['~/render.png', HOME], ['~someone/render.png', HOME],
  ['file:x.png', COLON], ['file:/home/u/x.png', COLON], ['file:/C:/Users/u/x.png', COLON], ['file:C:/x.png', COLON],
  ['file://server/share/x.png', COLON], ['file:///home/u/x.png', COLON], ['FILE:///C:/Users/u/x.png', COLON], ['File:////server/share/x.png', COLON],
  ['https://example.com/render.png', COLON], ['HTTP://localhost:3000/render.png', COLON], ['localhost:3000/x.png', COLON], ['localhost:3000', COLON],
  ['127.0.0.1:8080/x.png', COLON], ['mailto:x', COLON], ['data:image/png;base64,AAAA', COLON], ['javascript:x', COLON], ['svn+ssh:host/x.png', COLON],
  ['$HOME/x.png', DOLLAR], ['${HOME}/x.png', DOLLAR], ['renders/$HOME/x.png', DOLLAR], ['renders\\$TMP\\x.png', DOLLAR], ['renders/a${X}.png', DOLLAR],
  ['%USERPROFILE%\\x.png', PERCENT], ['renders/%TEMP%/x.png', PERCENT],
  ['..', CLIMBS], ['../other/render.png', CLIMBS], ['renders/../../render.png', CLIMBS], ['renders\\..\\..\\x.png', CLIMBS],
  ['a/../b', CLIMBS], ['renders/old/../home.png', CLIMBS],
  ['renders · home.png', /holds U\+00B7 at character 9: it is the separator of the record's lines/], ['renders/\nhome.png', /holds U\+000A at character 9: it is not one of the plain characters/],
];
// The values --artifact writes as given: a path inside the repository, a $ or a % inside a name.
const WRITTEN = ['renders/home page.png', './x', 'renders\\x', 'renders/50%.png', 'price$total.png', 'a$b/c.png', 'renders/x%y%.png', 'v2.png'];

test('an artifact value with a root, a colon, a home, a $ or a % where a shell expands it, a climb or a character that is not plain is refused with its reason and nothing written', () => {
  const { root, id } = inFlight();
  const before = log(root);
  for (const [path, said] of REFUSED) {
    const r = refuses(root, 'review', id, 'approve', '--by', 'rev-a', '--artifact', path, FINDINGS);
    assert.match(r, RULE, path);
    assert.match(r, said, path);
    assert.match(r, /--artifact "<path>"\n$/, `the refusal ends with the form: ${path}`);
  }
  assert.match(refuses(root, 'review', id, 'approve', '--by', 'rev-a', '--artifact', '  ', FINDINGS), /--artifact needs a value/);
  assert.equal(log(root), before, 'nothing was written');
});

test('a path inside the repository is written as given, a $ or a % inside a name among them', () => {
  const { root, id } = inFlight();
  for (const path of WRITTEN) jarl(root, 'review', id, 'approve', '--by', 'rev-a', '--artifact', path, FINDINGS);
  const verdicts = loopEvents(join(root, '.jarl'), loadProfile(root)).filter((e) => e.type === 'verdict');
  assert.deepEqual(verdicts.map((e) => e.artifact), WRITTEN);
});

test('the help and the reviewer reference state the rule of an artifact value in the same words', () => {
  const sentence = (text) => /the value is a relative path inside the repository the work is in, [\s\S]*? is refused/i.exec(text.replace(/`/g, '').replace(/\s+/g, ' '))?.[0].toLowerCase();
  const help = sentence(USAGE);
  assert.ok(help, 'the help states the rule');
  assert.equal(sentence(skillText('references/reviewer.md')), help);
});

test('report counts the verdicts that name an artifact', () => {
  const { root, id } = inFlight();
  const other = fileThreeDigits(root, 'another page', { acceptance: '[read] it renders' });
  jarl(root, 'set', other, 'in-progress', '--worker', 'w2');
  jarl(root, 'review', id, 'changes', '--by', 'rev-a', '--artifact', 'renders/home.png', 'Important: the header overlaps the menu');
  jarl(root, 'review', id, 'approve', '--by', 'rev-b', '--artifact', 'renders/home.png', FINDINGS);
  jarl(root, 'review', other, 'approve', '--by', 'rev-b', '--artifact', 'renders/about.png', FINDINGS);
  jarl(root, 'review', other, 'approve', '--by', 'rev-c', FINDINGS);
  assert.match(jarl(root, 'report', '--metrics'), new RegExp(`^verdicts that name an artifact: 3 \\(approve 2, changes 1\\) on 2 issues: ${id}, ${other}$`, 'm'));
  assert.deepEqual(JSON.parse(jarl(root, 'report', '--json')).metrics.artifacts, { n: 3, approve: 2, changes: 1, issues: [id, other] });
});
