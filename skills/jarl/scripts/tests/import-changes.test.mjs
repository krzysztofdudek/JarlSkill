// Import reports each finding whose text differs from the text its issue was filed with, with both texts, and never
// writes to that issue: white space and line endings are not a change, a hand-added paragraph is not a change, and an
// issue that is done or dropped is reported like an open one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { jarl, loop as makeLoop, refuses } from './helpers.mjs';

const loop = () => makeLoop({ prefix: 'jarl-import-changes-', via: 'cli', dotGit: false });
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const SOURCE = 'ext/2026-11-05-tickets';
const fileOf = (root, id) => readFileSync(json(root, 'show', id).file, 'utf8');

// A findings file in a folder of its own; `text` is written as given, so a test chooses its line endings.
function findingsFile(text) {
  const file = join(mkdtempSync(join(tmpdir(), 'jarl-findings-')), 'findings.json');
  writeFileSync(file, text);
  return file;
}
const finding = (over = {}) => ({ id: 'T-1', title: 'Export as csv', claim: 'Users can export a report as csv.', truth: 'The export button writes json only.', impact: 'Reports cannot be opened in a sheet.', ...over });
const written = (list, eol = '\n') => JSON.stringify(list, null, 2).replace(/\n/g, eol);
const importing = (root, file, ...more) => json(root, 'import', file, '--source', SOURCE, ...more);

test('a finding imported again with the same text is not reported as changed', () => {
  const root = loop();
  const file = findingsFile(written([finding()]));
  assert.deepEqual(importing(root, file).changed, []);
  const again = importing(root, file);
  assert.deepEqual(again.changed, []);
  assert.equal(again.already.length, 1);
  assert.doesNotMatch(jarl(root, 'import', file, '--source', SOURCE), /changed/);
});

test('a finding whose text changed is reported with the issue text and the finding text, and the issue is left as it was', () => {
  const root = loop();
  importing(root, findingsFile(written([finding()])));
  const before = fileOf(root, '1');
  const next = findingsFile(written([finding({ claim: 'Users can export a report as csv or xlsx.', impact: 'Reports open in a sheet.' })]));
  const out = importing(root, next);
  assert.equal(out.changed.length, 1);
  const [c] = out.changed;
  assert.deepEqual([c.finding, c.issue, c.status], ['T-1', '1', 'open']);
  assert.deepEqual(c.parts.map((p) => p.part), ['What', 'Why']);
  assert.match(c.parts[0].issueText, /Claim: Users can export a report as csv\.\n/);
  assert.match(c.parts[0].findingText, /Claim: Users can export a report as csv or xlsx\./);
  assert.equal(c.parts[1].issueText, 'Reports cannot be opened in a sheet.');
  assert.equal(c.parts[1].findingText, 'Reports open in a sheet.');
  assert.equal(fileOf(root, '1'), before, 'import never overwrites the issue');
  assert.equal(out.filed.length, 0);
  const text = jarl(root, 'import', next, '--source', SOURCE);
  assert.match(text, /^ext\/2026-11-05-tickets: 1 finding\(s\) · filed 0 · already filed 1 · changed since filed 1$/m);
  assert.match(text, /^changed since filed · T-1 · issue 1 \(open\) · What$/m);
  assert.match(text, /^ {4}issue: {3}Claim: Users can export a report as csv\.$/m);
  assert.match(text, /^ {4}finding: Claim: Users can export a report as csv or xlsx\.$/m);
  assert.match(text, /import leaves the text of an issue as it is/);
  assert.equal(fileOf(root, '1'), before, 'a second run leaves it as well');
});

test('a change of white space or of line endings alone is not a change', () => {
  const root = loop();
  const first = [finding({ claim: 'Users can export a report as csv.\n\nThe file keeps the column order.' })];
  importing(root, findingsFile(written(first)));
  const spaced = [finding({ claim: '  Users can export   a report\nas csv.\r\n\r\n\r\nThe file keeps the\tcolumn order.  ', truth: 'The export button\nwrites json only.  ' })];
  assert.deepEqual(importing(root, findingsFile(written(spaced))).changed, []);
  assert.deepEqual(importing(root, findingsFile(written(first, '\r\n'))).changed, [], 'a findings file with CRLF line endings reads the same');
  assert.deepEqual(importing(root, findingsFile(written(spaced, '\r\n'))).changed, []);
});

test('a findings file with CRLF line endings, imported first, matches the same file with LF', () => {
  const root = loop();
  const list = [finding({ claim: 'Line one.\r\n\r\nLine two.' })];
  importing(root, findingsFile(written(list, '\r\n')));
  assert.deepEqual(importing(root, findingsFile(written([finding({ claim: 'Line one.\n\nLine two.' })]))).changed, []);
  assert.equal(importing(root, findingsFile(written([finding({ claim: 'Line one.\n\nLine two, changed.' })]))).changed.length, 1);
});

test('a paragraph added to an issue by hand is not a change, and a paragraph of the finding that the issue lost is', () => {
  const root = loop();
  const file = findingsFile(written([finding()]));
  importing(root, file);
  jarl(root, 'field', '1', 'What', `${json(root, 'show', '1').sections.what.trim()}\n\nThe coordinator's note: the sheet export waits for the writer.`);
  assert.deepEqual(importing(root, file).changed, []);
  jarl(root, 'field', '1', 'What', 'Claim: something else entirely.');
  const out = importing(root, file);
  assert.deepEqual(out.changed.map((c) => c.parts.map((p) => p.part)), [['What']]);
});

test('a finding of a done or a dropped issue is reported with the status of that issue', () => {
  const root = loop();
  importing(root, findingsFile(written([finding(), finding({ id: 'T-2', title: 'Print', claim: 'Users can print a report.' })])));
  jarl(root, 'set', '1', 'dropped', 'the ticket was withdrawn');
  jarl(root, 'set', '2', 'in-progress', 'go', '--worker', 'w2');
  jarl(root, 'evidence', '2', '--ran', 'npm test', '--saw', 'all pass');
  jarl(root, 'review', '2', 'approve', '--by', 'rev', 'read the diff, nothing found');
  jarl(root, 'set', '2', 'done', 'finished');
  const out = importing(root, findingsFile(written([finding({ claim: 'Nobody exports.' }), finding({ id: 'T-2', title: 'Print', claim: 'Users can print a report in colour.' })])));
  assert.deepEqual(out.changed.map((c) => [c.finding, c.issue, c.status]), [['T-1', '1', 'dropped'], ['T-2', '2', 'done']]);
  assert.match(jarl(root, 'import', findingsFile(written([finding({ claim: 'Nobody exports.' })])), '--source', SOURCE), /issue 1 \(dropped\)/);
});

test('a dry run and an import of part of the file report changes too, and write nothing', () => {
  const root = loop();
  importing(root, findingsFile(written([finding(), finding({ id: 'T-2', title: 'Print', claim: 'Users can print.' })])));
  const before = [fileOf(root, '1'), fileOf(root, '2')];
  const changed = findingsFile(written([finding({ claim: 'A new claim.' }), finding({ id: 'T-2', title: 'Print', claim: 'A new print claim.' })]));
  assert.deepEqual(importing(root, changed, '--dry-run').changed.map((c) => c.finding), ['T-1', 'T-2']);
  assert.deepEqual(importing(root, changed, '--only', 'T-2').changed.map((c) => c.finding), ['T-2']);
  assert.deepEqual([fileOf(root, '1'), fileOf(root, '2')], before);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /· imported ext\/2026-11-05-tickets · 0 filed, 1 already filed$/m, 'the log line of an import that found a change is the line of any other');
});

test('an external requirement is a branch of the issue tree: the sub-issue of a requirement is reported on its own Source', () => {
  const root = loop();
  jarl(root, 'new', 'the requirements of the tracker');
  importing(root, findingsFile(written([finding()])));
  jarl(root, 'field', '2', 'Parent', '1');
  const out = importing(root, findingsFile(written([finding({ claim: 'Users can export a report as xlsx.' })])));
  assert.deepEqual(out.changed.map((c) => [c.finding, c.issue]), [['T-1', '2']]);
});

test('an issue filed by hand under a Source, and one adopted into it, is never reported, whatever its What says', () => {
  const root = loop();
  jarl(root, 'new', 'Export by hand', '--source', `${SOURCE}#T-1`, '--what', 'Our own account of the export, nothing like the finding.');
  jarl(root, 'new', 'Print named by an issue', '--what', 'Covers T-2 of ext/2026-11-05-tickets in our words.');
  const file = findingsFile(written([finding(), finding({ id: 'T-2', title: 'Print', claim: 'Users can print a report.' })]));
  assert.deepEqual(importing(root, file, '--adopt').changed, []);
  assert.deepEqual(importing(root, file).changed, []);
  assert.deepEqual(importing(root, file, '--dry-run').changed, []);
  assert.match(jarl(root, 'import', file, '--source', SOURCE), /already filed 2$/m);
});

test('only the issues filed by an import run are compared: a hand-filed issue beside imported ones stays silent, an imported one is reported', () => {
  const root = loop();
  jarl(root, 'new', 'Export by hand', '--source', `${SOURCE}#T-1`, '--what', 'Our own account of the export.');
  importing(root, findingsFile(written([finding({ id: 'T-2', title: 'Print', claim: 'Users can print a report.' })])));
  const changed = findingsFile(written([finding(), finding({ id: 'T-2', title: 'Print', claim: 'Users can print a report in colour.' })]));
  assert.deepEqual(importing(root, changed).changed.map((c) => [c.finding, c.issue]), [['T-2', '2']]);
});

test('a change in one word is a change, not only a change in the end of the text', () => {
  const root = loop();
  importing(root, findingsFile(written([finding({ claim: 'Users can export a report as csv or xlsx.' })])));
  assert.equal(importing(root, findingsFile(written([finding({ claim: 'Users can export a report as csv or xls' })]))).changed.length, 1);
  assert.equal(importing(root, findingsFile(written([finding({ claim: 'Users can export a report as csv or xlsx.' })]))).changed.length, 0);
});

test('an import that stops after filing some issues still counts them as filed by import, so a later run reports their changes', () => {
  const root = loop();
  const refused = findingsFile(written([finding(), finding({ id: 'T-2', title: 'Print', claim: 'Users can <why>print</why> a report.' })]));
  assert.match(refuses(root, 'import', refused, '--source', SOURCE), /closing why tag/);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /· imported ext\/2026-11-05-tickets · 1 filed, 0 already filed$/m, 'the filings of the run that stopped are closed by the line');
  const fixed = findingsFile(written([finding(), finding({ id: 'T-2', title: 'Print', claim: 'Users can print a report.' })]));
  assert.deepEqual(importing(root, fixed).filed.map((f) => f.finding), ['T-2']);
  const both = findingsFile(written([finding({ claim: 'Users can export a report as xlsx.' }), finding({ id: 'T-2', title: 'Print', claim: 'Users can print a report in colour.' })]));
  assert.deepEqual(importing(root, both).changed.map((c) => [c.finding, c.issue]), [['T-1', '1'], ['T-2', '2']]);
});

test('two files that carry one number are told apart by their keys: the hand-filed one stays silent, the imported one is reported', () => {
  const root = loop();
  importing(root, findingsFile(written([finding()])));
  const imported = json(root, 'show', '1').file;
  const text = readFileSync(imported, 'utf8');
  assert.match(text, /^\*\*Key:\*\* /m, 'an issue import files carries a key');
  const byHand = text.replace(/^\*\*Key:\*\*.*\n/m, '').replace('Export as csv', 'Printing by hand').replace(`${SOURCE}#T-1`, `${SOURCE}#T-2`).replace(/## What\n[\s\S]*?\n## Why/, '## What\nOur own words about printing.\n\n## Why');
  writeFileSync(join(dirname(imported), '1-printing-by-hand.md'), byHand);
  const next = findingsFile(written([finding({ claim: 'Users can export a report as xlsx.' }), finding({ id: 'T-2', title: 'Print', claim: 'Users can print a report.' })]));
  const out = importing(root, next, '--dry-run');
  assert.deepEqual(out.already.map((a) => a.finding), ['T-1', 'T-2']);
  assert.deepEqual(out.changed.map((c) => c.finding), ['T-1']);
});

test('the log refuses a note shaped like the line import writes, and one shaped like a filing, naming the command that writes each', () => {
  const root = loop();
  jarl(root, 'new', 'by hand', '--source', `${SOURCE}#T-1`, '--what', 'Our own words.');
  assert.match(refuses(root, 'log', `imported ${SOURCE} · 1 filed, 0 already filed`), /has the shape of the line import writes.*jarl\.mjs import "?<findings\.json>"?/);
  assert.match(refuses(root, 'log', 'filed 1 · by hand'), /reads as a filing.*jarl\.mjs new "?<title>"?/);
  assert.deepEqual(importing(root, findingsFile(written([finding({ claim: 'Another.' })]))).changed, []);
});

test('a finding that loses words is a change as one that gains words is, and a paragraph added to the issue by hand is not', () => {
  const root = loop();
  importing(root, findingsFile(written([finding({ claim: 'Users export csv. And xlsx.' })])));
  assert.equal(importing(root, findingsFile(written([finding({ claim: 'Users export csv.' })]))).changed.length, 1, 'words lost at the end');
  assert.equal(importing(root, findingsFile(written([finding({ claim: 'Users export csv. And xlsx. And pdf.' })]))).changed.length, 1, 'words gained at the end');
  jarl(root, 'field', '1', 'What', `${json(root, 'show', '1').sections.what.trim()}\n\nA paragraph the coordinator added.`);
  assert.equal(importing(root, findingsFile(written([finding({ claim: 'Users export csv. And xlsx.' })]))).changed.length, 0);
});

test('the same letters in another Unicode form are not a change', () => {
  const root = loop();
  importing(root, findingsFile(written([finding({ claim: 'Użytkownik eksportuje raport. Zażółć gęślą jaźń.'.normalize('NFC') })])));
  assert.deepEqual(importing(root, findingsFile(written([finding({ claim: 'Użytkownik eksportuje raport. Zażółć gęślą jaźń.'.normalize('NFD') })]))).changed, []);
});
