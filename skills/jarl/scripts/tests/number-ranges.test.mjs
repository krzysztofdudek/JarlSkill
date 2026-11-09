// A goal line "Range (<name>): <from-to>" declares the numbers of a series of issues, and new --range <name> files under
// the next free number of that series. Every other filing takes its number outside every declared range, stepped past a
// range it would fall in, so a series never moves the count of another, and a hand-made file with a high number moves
// only the count of the series it falls in. A number from a range is a line of record format 3: its first filing raises
// declares no range numbers as it always does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jarl, refuses, run, loop as makeLoop } from './helpers.mjs';
import { BUILTIN_STATUSES } from '../jarl-lib.mjs';

const filed = (root, ...args) => JSON.parse(jarl(root, 'new', ...args, '--json')).id;
const files = (root) => readdirSync(join(root, '.jarl', 'issues')).sort();
const goalText = (root) => readFileSync(join(root, '.jarl', 'goal.md'), 'utf8');
const logText = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const lastLine = (text) => text.trim().split('\n').pop();

test('new --range files in the series the goal declares, and the numbers outside every range keep their own count', () => {
  const root = makeLoop({ prefix: 'jarl-ranges-', via: 'cli' });
  assert.match(jarl(root, 'goal', '--set', 'Range (film): 1000-1999'), /goal line added: Range \(film\): 1000-1999/);
  assert.equal(filed(root, 'plain one'), '1');
  assert.equal(filed(root, 'the first film', '--range', 'film'), '1000');
  assert.equal(filed(root, 'plain two'), '2');
  assert.equal(filed(root, 'the second film', '--range', 'FILM'), '1001', 'the name is matched in any case');
  // A hand-made file far above every range moves the count outside the ranges, as it always did, and never a range's.
  writeFileSync(join(root, '.jarl', 'issues', '5000-made-by-hand.md'), '# 5000 · made by hand\n\n**Status:** open\n');
  assert.equal(filed(root, 'the third film', '--range', 'film'), '1002');
  assert.equal(filed(root, 'plain three'), '5001');
  assert.match(logText(root), /filed 1002 · the third film/);
});

test('a filing outside every range steps past a range it would fall in, and renumber keeps a number in its own series', () => {
  const root = makeLoop({ prefix: 'jarl-ranges-step-', via: 'cli' });
  filed(root, 'one'); filed(root, 'two');
  jarl(root, 'goal', '--set', 'Range (upstream): 3-5');
  assert.equal(filed(root, 'three'), '6');
  assert.equal(filed(root, 'an upstream change', '--range', 'upstream'), '3');
  assert.equal(filed(root, 'seven'), '7');
  // Two files of one number after a merge: the one renumbered takes the next free number of the series it is in.
  const issues = join(root, '.jarl', 'issues');
  const copy = readFileSync(join(issues, '3-an-upstream-change.md'), 'utf8').replace(/^(\*\*Key:\*\* )\S+$/m, '$120261108T000000-copy');
  writeFileSync(join(issues, '3-the-same-number.md'), copy);
  assert.match(jarl(root, 'renumber', '3', '--key', '20261108T000000-copy'), /\b4\b/);
  assert.ok(files(root).includes('4-the-same-number.md'), files(root).join(', '));
  assert.equal(filed(root, 'eight'), '8');
});

test('a range that is not declared, a range with no number left and a Range line that would move a filed number are refused with a form, and nothing is written', () => {
  const root = makeLoop({ prefix: 'jarl-ranges-refused-', via: 'cli' });
  filed(root, 'one');
  const before = files(root);
  let said = refuses(root, 'new', 'x', '--range', 'film');
  assert.match(said, /the goal declares no range "film", nor any other/);
  assert.equal(lastLine(said), 'jarl.mjs goal --set \'Range (<name>): <from-to>\' --by "<who>"');
  jarl(root, 'goal', '--set', 'Range (tiny): 7000-7000');
  said = refuses(root, 'new', 'x', '--range', 'film');
  assert.match(said, /the goal declares no range "film": its ranges are tiny \(7000-7000\)/);
  assert.equal(lastLine(said), 'jarl.mjs new "<title>" --by "<who>" --range "<name>"');
  assert.equal(filed(root, 'the only one', '--range', 'tiny'), '7000');
  said = refuses(root, 'new', 'one too many', '--range', 'tiny');
  assert.match(said, /the range tiny \(7000-7000\) has no number left: widen it in the goal/);
  assert.equal(lastLine(said), 'jarl.mjs goal --set \'Range (tiny): <from-to>\' --by "<who>"');
  assert.deepEqual(files(root), [...before, '7000-the-only-one.md'].sort());
  const goal = goalText(root);
  said = refuses(root, 'goal', '--set', 'Range (film): 6000-7500');
  assert.match(said, /the range film \(6000-7500\) shares numbers with the range tiny \(7000-7000\): two ranges never share a number/);
  assert.equal(lastLine(said), 'jarl.mjs goal --by "<who>" --set "<machine-line>"');
  assert.match(refuses(root, 'goal', '--set', 'Range (tiny): 7001-7010'), /would leave out issue 7000, numbered in the range tiny \(7000-7000\): a range keeps every number it holds/);
  assert.match(refuses(root, 'goal', '--set', 'Range (low): 1-50'), /would take in issue 1, numbered outside it: a range takes in no number filed elsewhere/);
  assert.match(refuses(root, 'goal', '--set', 'Range (bad): 50-10'), /a Range line is "Range \(<name>\): <from-to>"/);
  assert.equal(goalText(root), goal);
  assert.match(jarl(root, 'goal', '--set', 'Range (tiny): 7000-7009'), /goal line changed: Range \(tiny\): 7000-7009 \(was 7000-7000\)/);
  assert.equal(filed(root, 'now there is room', '--range', 'tiny'), '7001');
});

test('verify places a Range line, and names one that does not parse, repeats a name or shares numbers with another', () => {
  const root = makeLoop({ prefix: 'jarl-ranges-verify-', via: 'cli' });
  jarl(root, 'goal', '--set', 'Range (film): 1000-1999');
  assert.equal(run(root, ['verify']).status, 0);
  writeFileSync(join(root, '.jarl', 'goal.md'), `${goalText(root)}Range (film): 3000-3999\nRange (other): 1500-2500\nRange: 1-9\n`);
  const r = run(root, ['verify']);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /goal\.md: 3\n/);
  assert.match(r.stdout, /the range film is declared on a line above: the first line of a range stands/);
  assert.match(r.stdout, /the range other \(1500-2500\) shares numbers with the range film \(1000-1999\) above it/);
  assert.match(r.stdout, /"Range: 1-9" — a Range line is "Range \(<name>\): <from-to>"/);
});

