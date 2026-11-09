// The key of an issue: its filing stamp and a few random letters, written by new into the header and, in its fixed place
// after the stamp, into the filed line and every later log line about the issue. Lines with no key are read by number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jarl, refuses, run, loop as makeLoop } from './helpers.mjs';
import * as R from '../record.mjs';

const loop = () => makeLoop({ prefix: 'jarl-keys-', via: 'cli', dotGit: false });
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const logOf = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const issueText = (root, n) => readFileSync(join(root, '.jarl', 'issues', readdirSync(join(root, '.jarl', 'issues')).find((f) => f.startsWith(`${n}-`))), 'utf8');
const keyOf = (root, n) => /^\*\*Key:\*\* (\S+)$/m.exec(issueText(root, n))?.[1] ?? null;
const STAMP = '(\\d{4})-(\\d{2})-(\\d{2}) (\\d{2}):(\\d{2})';

test('new writes a key made of the filing stamp and four random letters into the header and the filed line', () => {
  const root = loop();
  jarl(root, 'new', 'one', '--acceptance', '[read] it works', '--files', 'a.mjs');
  const key = keyOf(root, 1);
  assert.match(key ?? '', /^\d{8}T\d{4}-[a-z]{4}$/, issueText(root, 1));
  const filed = new RegExp(`^- ${STAMP} key (\\S+) by test-writer · filed 1 · one$`, 'm').exec(logOf(root));
  assert.ok(filed, logOf(root));
  assert.equal(filed[6], key, 'the filed line carries the header\'s key');
  assert.equal(key.slice(0, 13), `${filed[1]}${filed[2]}${filed[3]}T${filed[4]}${filed[5]}`, 'the key opens with the filing stamp');
  assert.equal(json(root, 'show', '1').fields.key, key);
  jarl(root, 'new', 'two', '--acceptance', '[read] it works');
  assert.notEqual(keyOf(root, 2), key, 'each issue has its own key');
});

test('every log line about a keyed issue carries its key after the stamp, and a line about the loop carries none', () => {
  const root = loop();
  jarl(root, 'new', 'one', '--acceptance', '[read] it works', '--files', 'a.mjs');
  const key = keyOf(root, 1);
  jarl(root, 'set', '1', 'in-progress', '--branch', 'jarl/1-one', '--worker', 'w1', '--by', 'odin');
  jarl(root, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'green');
  jarl(root, 'evidence', '1', 'a note');
  jarl(root, 'log', '1 looked at again');
  jarl(root, 'log', 'about the loop');
  const lines = logOf(root).split('\n').filter((l) => l.startsWith('- '));
  for (const l of lines.filter((x) => / · (filed )?1\b/.test(x))) assert.match(l, new RegExp(`^- ${STAMP} key ${key}( by \\S+)? · `), l);
  assert.match(logOf(root), new RegExp(`^- ${STAMP} key ${key} by odin · 1 → in-progress`, 'm'), 'the key comes before the writer');
  assert.match(logOf(root), new RegExp(`^- ${STAMP} by test-writer · about the loop$`, 'm'));
  const shown = json(root, 'show', '1');
  assert.equal(shown.status, 'in-progress', 'the keyed lines are read as the issue\'s own');
  assert.equal(shown.fields.worker, 'w1');
  assert.equal(run(root, ['verify']).status, 0, run(root, ['verify']).stdout);
});

test('the key is the tool\'s: no profile declares it, field refuses to write it, and a hand-written free note cannot pose as one', () => {
  const root = loop();
  jarl(root, 'new', 'one', '--acceptance', '[read] it works');
  assert.match(refuses(root, 'field', '1', 'Key', 'x'), /Key/);
  jarl(root, 'log', 'key 20260101T0000-abcd · a note that names a key');
  assert.match(logOf(root), new RegExp(`^- ${STAMP} by test-writer · key 20260101T0000-abcd · a note that names a key$`, 'm'), 'text never reaches the key\'s place');
  const file = join(mkdtempSync(join(tmpdir(), 'jarl-keys-p-')), 'p.json');
  writeFileSync(file, JSON.stringify({ 'jarl-profile': 1, statuses: { open: ['dispatchable'], 'in-progress': ['holds-claim'], done: ['terminal', 'closes-record', 'settles-dependents'] }, fields: { Key: {} } }));
  assert.throws(() => R.readProfileFile(file), /it declares the field Key, which Jarl reserves for an issue's key — rename it in the profile/);
  assert.match(refuses(root, 'profile', file), /reserves for an issue's key/);
  assert.match(refuses(mkdtempSync(join(tmpdir(), 'jarl-keys-init-')), 'init', 'goal', '--profile', file), /reserves for an issue's key/);
});
