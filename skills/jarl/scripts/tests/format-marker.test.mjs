// The record format marker: .jarl/profile.json holding only jarl-profile and format. A loop without one is format 1; the
// first write of an element a reader of format 1 would misread in silence raises it to 2 (raiseFormat), and the pinned
// frozen reader (tests/old-jarl.mjs) then refuses the loop loudly instead of reading it wrong. The packages that add such an
// element (a repository name, an id of 1000 or more, a retraction line) add their case to the last test here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { oldJarl, oldJarlIsPinned } from './old-jarl.mjs';
import { jarl, refuses, loop as makeLoop } from './helpers.mjs';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const L = await import('../jarl-lib.mjs');

const loop = () => {
  const dir = makeLoop({ prefix: 'jarl-format-', goal: 'a goal', via: 'cli' });
  jarl(dir, 'new', 'first issue', '--acceptance', 'it works');
  return dir;
};
const marker = (root) => join(root, '.jarl', 'profile.json');
const read = (root) => JSON.parse(readFileSync(marker(root), 'utf8'));

test('the pinned frozen library is the one from its tag, unchanged', () => {
  assert.ok(oldJarlIsPinned());
});

test('a format-1 record, with no profile at all, is read as today: the built-in profile, format 1', () => {
  const root = loop();
  assert.equal(existsSync(marker(root)), false);
  const p = JSON.parse(jarl(root, 'profile', '--json'));
  assert.equal(p.declared, false);
  assert.equal(p.format, 1);
  assert.match(jarl(root, 'list'), /first issue/);
  // The pinned frozen reader reads it as well: format 1 is read the same.
  assert.equal(oldJarl(root, 'list', {}).ok, true);
});

test('a profile holding only jarl-profile and format is the built-in profile (declared: false), and every shape is unchanged', () => {
  const plain = loop();
  const marked = loop();
  writeFileSync(marker(marked), JSON.stringify({ 'jarl-profile': 1, format: 1 }));
  for (const root of [plain, marked]) {
    const p = JSON.parse(jarl(root, 'profile', '--json'));
    assert.equal(p.declared, false);
    assert.equal(p.name, 'built-in');
    assert.deepEqual(p.statuses.map((s) => s.name), ['open', 'in-progress', 'done', 'dropped', 'deferred']);
  }
  const keys = (root, ...a) => Object.keys(JSON.parse(jarl(root, ...a, '--json'))).sort();
  assert.deepEqual(keys(marked, 'status'), keys(plain, 'status'));
  assert.ok(keys(marked, 'status').includes('open') && !keys(marked, 'status').includes('statuses'), 'the five counts, not a per-status object');
  assert.deepEqual(keys(marked, 'report'), keys(plain, 'report'));
  const rows = (root) => JSON.parse(jarl(root, 'list', '--json')).map((r) => Object.keys(r).sort());
  assert.deepEqual(rows(marked), rows(plain));
  assert.match(jarl(marked, 'status'), /open/);
  // The marker at format 2 reads the same way.
  writeFileSync(marker(marked), JSON.stringify({ 'jarl-profile': 1, format: 2 }));
  const p2 = JSON.parse(jarl(marked, 'profile', '--json'));
  assert.equal(p2.declared, false);
  assert.equal(p2.format, 2);
  assert.deepEqual(keys(marked, 'status'), keys(plain, 'status'));
  // A marker with a wrong version, or with anything else in it, is still a profile and is checked as one.
  writeFileSync(marker(marked), JSON.stringify({ 'jarl-profile': 2, format: 1 }));
  assert.match(refuses(marked, 'status'), /"jarl-profile" must be 1/);
});

test('raiseFormat writes the marker under the lock, once, and a declared profile only gains its format key', () => {
  const root = loop();
  assert.equal(L.loadProfile(root).format, 1);
  assert.equal(L.raiseFormat(root), true);
  assert.deepEqual(read(root), { 'jarl-profile': 1, format: 2 });
  assert.equal(L.loadProfile(root).format, 2);
  assert.equal(L.raiseFormat(root), false, 'already raised: nothing is written');
  // Inside another write on the same loop it takes no second lock (the lock is re-entrant per loop).
  const inner = loop();
  assert.equal(L.withLock(inner, () => L.raiseFormat(inner)), true);
  assert.equal(read(inner).format, 2);
  // A declared profile keeps everything it had.
  const declared = loop();
  const prof = { 'jarl-profile': 1, name: 'mine', statuses: L.BUILTIN_STATUSES };
  writeFileSync(marker(declared), JSON.stringify(prof));
  assert.equal(L.raiseFormat(declared), true);
  assert.deepEqual(read(declared), { ...prof, format: 2 });
  assert.equal(L.loadProfile(declared).declared, true);
  // Before init there is no loop to mark.
  assert.equal(L.raiseFormat(mkdtempSync(join(tmpdir(), 'jarl-format-none-'))), false);
  assert.throws(() => L.raiseFormat(root, 3), /record format 3 is not one this Jarl writes/);
});

test('a loop in a format this Jarl does not read is refused on read and on write, with nothing written', () => {
  const root = loop();
  writeFileSync(marker(root), JSON.stringify({ 'jarl-profile': 1, format: 3 }));
  for (const args of [['list'], ['status'], ['next'], ['new', 'another issue']]) {
    assert.match(refuses(root, ...args), /record format 3, and this Jarl reads format 1, 2 — nothing was read or written/, args.join(' '));
  }
  assert.throws(() => L.raiseFormat(root), /record format 3/);
  assert.deepEqual(read(root), { 'jarl-profile': 1, format: 3 });
});

test('the pinned frozen reader refuses list and status, loudly, on a loop whose format this Jarl raised', () => {
  const root = loop();
  assert.equal(oldJarl(root, 'list', {}).ok, true, 'before: it reads the loop');
  assert.equal(oldJarl(root, 'status', {}).ok, true);
  L.raiseFormat(root);
  for (const command of ['list', 'status', 'next', 'queue']) {
    const r = oldJarl(root, command, {});
    assert.equal(r.ok, false, command);
    assert.match(r.error, /written for record format 2, and this Jarl reads format 1/, command);
  }
  // The new Jarl reads the same loop as before.
  assert.match(jarl(root, 'list'), /first issue/);
});
