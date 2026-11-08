// A byte order mark at the start of a text file is no part of the text. Windows editors write one, often with CRLF line
// endings: a findings file, a profile and a goal read the same with the mark, with the mark and CRLF, and without.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jarl, loop as makeLoop } from './helpers.mjs';
import { readText } from '../lib/files.mjs';

const BOM = '﻿';
const crlf = (text) => text.replace(/\n/g, '\r\n');
const scratch = () => mkdtempSync(join(tmpdir(), 'jarl-bom-'));
const loop = () => makeLoop({ prefix: 'jarl-bom-loop-', via: 'cli' });
const FINDINGS = JSON.stringify([{ id: 'B-1', title: 'a finding', claim: 'It reads.' }, { id: 'B-2', title: 'another' }], null, 2);
const PROFILE = JSON.stringify({ 'jarl-profile': 1, name: 'marked', statuses: { open: ['dispatchable'], running: ['holds-claim'], done: ['terminal', 'closes-record', 'settles-dependents'] } }, null, 2);

// Each form a file takes on Windows: with the mark, and with the mark and CRLF.
const FORMS = [['a byte order mark', (t) => BOM + t], ['a byte order mark and CRLF line endings', (t) => BOM + crlf(t)]];

test('readText drops a leading byte order mark, with or without CRLF, and nothing else', () => {
  const dir = scratch();
  const file = join(dir, 'a.txt');
  writeFileSync(file, `${BOM}one\r\ntwo\r\n`);
  assert.equal(readText(file), 'one\ntwo\n');
  writeFileSync(file, `${BOM}${BOM}x`);
  assert.equal(readText(file), `${BOM}x`, 'only the first mark is the file\'s own');
  writeFileSync(file, `a${BOM}b`);
  assert.equal(readText(file), `a${BOM}b`, 'a mark inside the text stays');
  writeFileSync(file, 'plain\n');
  assert.equal(readText(file), 'plain\n');
});

for (const [what, form] of FORMS) {
  test(`import and sources read a findings file that starts with ${what}`, () => {
    const root = loop();
    const file = join(scratch(), 'findings.json');
    writeFileSync(file, form(FINDINGS));
    assert.match(jarl(root, 'sources', file, '--source', 'r-bom'), /^r-bom · 2 finding\(s\) · 0 filed · 2 unfiled/m);
    assert.match(jarl(root, 'import', file, '--source', 'r-bom', '--dry-run'), /would file 2/);
    const out = JSON.parse(jarl(root, 'import', file, '--source', 'r-bom', '--json'));
    assert.deepEqual(out.filed.map((f) => f.finding), ['B-1', 'B-2']);
    assert.match(jarl(root, 'import', file, '--source', 'r-bom'), /filed 0 · already filed 2/);
  });

  test(`init --profile and the profile command read a profile file that starts with ${what}`, () => {
    const root = scratch();
    mkdirSync(join(root, '.git'));
    const file = join(scratch(), 'profile.json');
    writeFileSync(file, form(PROFILE));
    assert.match(jarl(root, 'profile', file), /^profile marked/);
    assert.match(jarl(root, 'init', 'a goal', '--profile', file), /profile marked/);
    assert.equal(JSON.parse(jarl(root, 'profile', '--json')).name, 'marked');
  });

  test(`a loop whose profile starts with ${what} is read`, () => {
    const root = scratch();
    mkdirSync(join(root, '.git'));
    const file = join(scratch(), 'profile.json');
    writeFileSync(file, PROFILE);
    jarl(root, 'init', 'a goal', '--profile', file);
    const kept = join(root, '.jarl', 'profile.json');
    writeFileSync(kept, form(readFileSync(kept, 'utf8')));
    assert.equal(JSON.parse(jarl(root, 'profile', '--json')).name, 'marked');
    assert.match(jarl(root, 'new', 'an issue', '--acceptance', '[read] it works'), /^filed 1/);
  });

  test(`a goal that starts with ${what} is read`, () => {
    const root = loop();
    const goal = join(root, '.jarl', 'goal.md');
    const text = readFileSync(goal, 'utf8');
    writeFileSync(goal, form(text));
    assert.equal(JSON.parse(jarl(root, 'goal', '--json')).goal.charCodeAt(0), '#'.charCodeAt(0), 'the goal opens with its heading, not with the mark');
    assert.match(jarl(root, 'status'), /^goal: goal\n/);
  });
}
