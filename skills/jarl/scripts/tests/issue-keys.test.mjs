// The key of an issue: its filing stamp and a few random letters, written by new into the header and, in its fixed place
// after the stamp, into the filed line and every later log line about the issue. The key raises the loop to record
// format 3, so a reader of a lower format refuses the loop instead of mixing two issues that took one number; a loop a
// composer keeps is never raised, and its issues carry no key. Lines with no key, which a loop filed before it was
// raised holds, are read by number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jarl, refuses, run, loop as makeLoop } from './helpers.mjs';
import { formatTwoJarl, oldJarl } from './old-jarl.mjs';
import * as R from '../record.mjs';

const loop = () => makeLoop({ prefix: 'jarl-keys-', via: 'cli', dotGit: false });
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const logOf = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const issueText = (root, n) => readFileSync(join(root, '.jarl', 'issues', readdirSync(join(root, '.jarl', 'issues')).find((f) => f.startsWith(`${n}-`))), 'utf8');
const keyOf = (root, n) => /^\*\*Key:\*\* (\S+)$/m.exec(issueText(root, n))?.[1] ?? null;
const STAMP = '(\\d{4})-(\\d{2})-(\\d{2}) (\\d{2}):(\\d{2})';

test('new writes a key made of the filing stamp and four random letters into the header and the filed line, and raises the loop to format 3', () => {
  const root = loop();
  assert.equal(json(root, 'profile').format, 1);
  jarl(root, 'new', 'one', '--files', 'a.mjs');
  const key = keyOf(root, 1);
  assert.match(key ?? '', /^\d{8}T\d{4}-[a-z]{4}$/, issueText(root, 1));
  const filed = new RegExp(`^- ${STAMP} key (\\S+) · filed 1 · one$`, 'm').exec(logOf(root));
  assert.ok(filed, logOf(root));
  assert.equal(filed[6], key, 'the filed line carries the header\'s key');
  assert.equal(key.slice(0, 13), `${filed[1]}${filed[2]}${filed[3]}T${filed[4]}${filed[5]}`, 'the key opens with the filing stamp');
  assert.equal(json(root, 'profile').format, 3);
  assert.equal(json(root, 'show', '1').fields.key, key);
  jarl(root, 'new', 'two');
  assert.notEqual(keyOf(root, 2), key, 'each issue has its own key');
});

test('every log line about a keyed issue carries its key after the stamp, and a line about the loop carries none', () => {
  const root = loop();
  jarl(root, 'new', 'one', '--files', 'a.mjs');
  const key = keyOf(root, 1);
  jarl(root, 'set', '1', 'in-progress', '--branch', 'jarl/1-one', '--worker', 'w1', '--by', 'odin');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'green');
  jarl(root, 'evidence', '1', 'a note');
  jarl(root, 'log', '1 looked at again');
  jarl(root, 'log', 'about the loop');
  const lines = logOf(root).split('\n').filter((l) => l.startsWith('- '));
  for (const l of lines.filter((x) => / · (filed )?1\b/.test(x))) assert.match(l, new RegExp(`^- ${STAMP} key ${key}( by \\S+)? · `), l);
  assert.match(logOf(root), new RegExp(`^- ${STAMP} key ${key} by odin · 1 → in-progress`, 'm'), 'the key comes before the writer');
  assert.match(logOf(root), new RegExp(`^- ${STAMP} · about the loop$`, 'm'));
  const shown = json(root, 'show', '1');
  assert.equal(shown.status, 'in-progress', 'the keyed lines are read as the issue\'s own');
  assert.equal(shown.fields.worker, 'w1');
  assert.equal(run(root, ['verify']).status, 0, run(root, ['verify']).stdout);
});

test('the key is the tool\'s: no profile declares it, field refuses to write it, and a hand-written free note cannot pose as one', () => {
  const root = loop();
  jarl(root, 'new', 'one');
  assert.match(refuses(root, 'field', '1', 'Key', 'x'), /Key/);
  jarl(root, 'log', 'key 20260101T0000-abcd · a note that names a key');
  assert.match(logOf(root), new RegExp(`^- ${STAMP} · key 20260101T0000-abcd · a note that names a key$`, 'm'), 'text never reaches the key\'s place');
  const file = join(mkdtempSync(join(tmpdir(), 'jarl-keys-p-')), 'p.json');
  writeFileSync(file, JSON.stringify({ 'jarl-profile': 1, statuses: { open: ['dispatchable'], 'in-progress': ['holds-claim'], done: ['terminal', 'closes-record', 'settles-dependents'] }, fields: { Key: {} } }));
  assert.throws(() => R.readProfileFile(file), /it declares the field Key, which Jarl reserves for an issue's key — rename it in the profile/);
  assert.match(refuses(root, 'profile', file), /reserves for an issue's key/);
  assert.match(refuses(mkdtempSync(join(tmpdir(), 'jarl-keys-init-')), 'init', 'goal', '--profile', file), /reserves for an issue's key/);
});

test('a loop already open with a profile that declares a field Key keeps its own field, and its issues get no key of the tool\'s', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-keys-own-'));
  mkdirSync(join(root, '.git'));
  R.initLoop(root, 'an older loop');
  writeFileSync(join(root, '.jarl', 'profile.json'), JSON.stringify({ 'jarl-profile': 1, name: 'own-key', statuses: { open: ['dispatchable'], 'in-progress': ['holds-claim'], done: ['terminal', 'closes-record', 'settles-dependents'], dropped: ['terminal', 'needs-reason'] }, fields: { Key: {} } }));
  jarl(root, 'new', 'tracked elsewhere', '--field', 'Key=PROJ-12');
  jarl(root, 'set', '1', 'in-progress', '--branch', 'jarl/1-x', '--worker', 'w1');
  assert.equal(keyOf(root, 1), 'PROJ-12', 'the field is the profile\'s own');
  assert.doesNotMatch(logOf(root), / key /, 'no line names a key');
  assert.ok(json(root, 'profile').format < 3, 'nothing raises it to the format of keys');
  assert.equal(json(root, 'show', '1').fields.key, 'PROJ-12');
  assert.equal(json(root, 'show', '1').fields.worker, 'w1');
  assert.match(jarl(root, 'list'), /tracked elsewhere/);
  const r = run(root, ['verify']);
  assert.equal(r.status, 0, r.stdout);
});

test('a loop filed before its raise keeps its unkeyed lines read by number, and its first new issue is keyed beside them', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-keys-old-'));
  mkdirSync(join(root, '.git'));
  assert.equal(oldJarl(root, 'init', {}, ['an older loop', {}]).ok, true);
  assert.equal(oldJarl(root, 'new', {}, ['filed by an older Jarl', {}]).ok, true);
  assert.equal(oldJarl(root, 'set', {}, ['001', 'in-progress', null, { branch: 'jarl/001-x', worker: 'w0' }]).ok, true);
  assert.equal(keyOf(root, '001'), null);
  jarl(root, 'evidence', '001', '--ran', 'npm test', '--saw', 'green');
  assert.match(logOf(root), new RegExp(`^- ${STAMP} · 001 evidence row · npm test`, 'm'), 'a write about an unkeyed issue names no key');
  assert.equal(json(root, 'profile').format, 1, 'and raises nothing');
  assert.equal(oldJarl(root, 'list', {}).ok, true, 'the frozen reader still reads it');
  jarl(root, 'new', 'filed now');
  assert.match(keyOf(root, '2') ?? '', /^\d{8}T\d{4}-[a-z]{4}$/);
  const one = json(root, 'show', '001');
  assert.equal(one.status, 'in-progress', 'the unkeyed lines still read by number');
  assert.equal(one.fields.worker, 'w0');
  assert.equal(json(root, 'show', '2').status, 'open');
  assert.equal(run(root, ['verify']).status, 0, run(root, ['verify']).stdout);
  for (const reader of [oldJarl, formatTwoJarl]) {
    const r = reader(root, 'list', {});
    assert.equal(r.ok, false, 'a reader of a lower format refuses the keyed loop');
    assert.match(r.error, /record format 3/);
  }
});

test('a loop a composer keeps is never raised for a key: its issues are filed with three digits and no key', () => {
  const repo = mkdtempSync(join(tmpdir(), 'jarl-keys-c-'));
  mkdirSync(join(repo, '.git'));
  const file = join(repo, 'p.json');
  writeFileSync(file, JSON.stringify({ 'jarl-profile': 1, format: 1, name: 'composer', statuses: { open: ['dispatchable'], running: ['holds-claim'], done: ['terminal', 'closes-record', 'settles-dependents'] }, 'external-scheduler': 'composer tick' }));
  jarl(repo, 'init', 'the composed goal', '--profile', file);
  jarl(repo, 'new', 'one');
  assert.equal(keyOf(repo, '001'), null);
  assert.doesNotMatch(logOf(repo), / key /);
  assert.equal(json(repo, 'profile').format, 1);
  assert.equal(oldJarl(repo, 'list', {}).ok, true, 'the composer\'s own older reader still reads it');
  R.newIssue(repo, 'two');
  assert.equal(keyOf(repo, '002'), null, 'nor through the library');
});

test('verify finds a key in a loop below format 3', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-keys-low-'));
  mkdirSync(join(root, '.git'));
  assert.equal(oldJarl(root, 'init', {}, ['an older loop', {}]).ok, true);
  assert.equal(oldJarl(root, 'new', {}, ['one', {}]).ok, true);
  const f = join(root, '.jarl', 'issues', readdirSync(join(root, '.jarl', 'issues'))[0]);
  writeFileSync(f, readFileSync(f, 'utf8').replace(/(\*\*Status:\*\* open)/, '$1\n**Key:** 20260101T0000-abcd'));
  const r = run(root, ['verify']);
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stdout, /issue 001.*key.*record format 3/i);
});
