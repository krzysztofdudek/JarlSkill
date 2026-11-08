// The record format marker: .jarl/profile.json holding only jarl-profile and format. A loop without one is format 1; the
// first write of an element a reader of format 1 would misread in silence raises it to 2 (raiseFormat), and the pinned
// frozen reader (tests/old-jarl.mjs) then refuses the loop loudly instead of reading it wrong. The packages that add such an
// element (a repository name, an id of 1000 or more, a retraction line) add their case to the last test here.
// Format 3 holds the lines of format 3 in FORMAT_LINES: the first write of one raises the loop to 3 (needFormat), and both frozen
// readers, of format 1 and of formats 1 and 2, refuse it. A loop whose profile names an external scheduler (a composer
// runs it) is never raised, to 2 or to 3: the write is refused and the line is off in that loop. The read-only commands never raise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fileAsBefore, formatTwoJarl, formatTwoJarlIsPinned, oldJarl, oldJarlIsPinned } from './old-jarl.mjs';
import { jarl, refuses, run, loop as makeLoop } from './helpers.mjs';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const L = await import('../jarl-lib.mjs');

// The first issue is filed with three digits and no key (fileAsBefore), so the loop is format 1.
const R = await import('../record.mjs');
const loop = () => {
  const dir = makeLoop({ prefix: 'jarl-format-', goal: 'a goal', via: 'cli' });
  fileAsBefore(dir, 'first issue', { acceptance: 'it works' });
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
  assert.throws(() => L.raiseFormat(root, 4), /record format 4 is not one this Jarl writes/);
});

test('a loop in a format this Jarl does not read is refused on read and on write, with nothing written', () => {
  const root = loop();
  writeFileSync(marker(root), JSON.stringify({ 'jarl-profile': 1, format: 4 }));
  for (const args of [['list'], ['status'], ['next'], ['new', 'another issue']]) {
    assert.match(refuses(root, ...args), /record format 4, and this Jarl reads format 1, 2, 3 — nothing was read or written/, args.join(' '));
  }
  assert.throws(() => L.raiseFormat(root), /record format 4/);
  assert.deepEqual(read(root), { 'jarl-profile': 1, format: 4 });
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

// ---- format 3: the lines of FORMAT_LINES ------------------------------------------------------------

const CLI = await import('../jarl.mjs');
const issueFile = (root) => join(root, '.jarl', 'issues', readdirSync(join(root, '.jarl', 'issues')).find((f) => f.endsWith('.md')));
const withRepo = (root, value) => writeFileSync(issueFile(root), readFileSync(issueFile(root), 'utf8').replace(/^(\*\*Files:\*\*.*)$/m, `$1\n**Repo:** ${value}`));
const reason = (fn) => { try { fn(); } catch (e) { return e.message; } throw new Error('expected a refusal'); };
// A loop opened through the command line with a profile that names an external scheduler: a composer runs it.
const COMPOSED = { 'jarl-profile': 1, name: 'composed', statuses: L.BUILTIN_STATUSES, 'external-scheduler': 'the composer tick' };
function composed(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-format-composed-'));
  mkdirSync(join(dir, '.git'));
  const file = join(mkdtempSync(join(tmpdir(), 'jarl-format-profile-')), 'profile.json');
  writeFileSync(file, JSON.stringify({ ...COMPOSED, ...extra }, null, 2));
  jarl(dir, 'init', 'a composed goal', '--profile', file);
  R.newIssue(dir, 'first issue', { acceptance: 'it works' });
  return dir;
}

test('every line of the format registry is held by format 2 or 3 and says what it is, where it is written and how a reader of the formats below it misreads it', () => {
  const lines = Object.entries(L.FORMAT_LINES);
  assert.ok(lines.length > 0);
  assert.ok(Object.isFrozen(L.FORMAT_LINES));
  for (const [name, line] of lines) {
    assert.match(name, /^[a-z][a-z-]*$/, name);
    assert.ok(Object.isFrozen(line), name);
    assert.ok([2, 3].includes(line.format), name);
    for (const k of ['what', 'where', 'misread']) assert.ok(typeof line[k] === 'string' && line[k].length > 10, `${name}.${k}`);
  }
  assert.equal(R.FORMAT_LINES, L.FORMAT_LINES, 'the library hands out the one registry');
  assert.throws(() => L.needFormat(loop(), 'no-such-line'), /no-such-line is not a line of the record format registry: its lines are /);
});

test('the first write of a line of format 3 raises a format-1 loop to 3 under the lock, once, and says its bare-word paths as ./<word>', () => {
  const root = loop();
  withRepo(root, 'sub');
  assert.equal(L.loadProfile(root).format, 1);
  assert.equal(L.withLock(root, () => L.needFormat(root, 'note-retraction')), true);
  assert.deepEqual(read(root), { 'jarl-profile': 1, format: 3 });
  assert.equal(L.loadProfile(root).format, 3);
  assert.match(readFileSync(issueFile(root), 'utf8'), /^\*\*Repo:\*\* \.\/sub$/m, 'a bare word of format 1 is a path, and format 3 reads a bare word as a name');
  assert.equal(L.needFormat(root, 'note-retraction'), false, 'already in format 3: nothing is written');
  assert.equal(L.raiseFormat(root), false, 'the format is never lowered');
  assert.deepEqual(read(root), { 'jarl-profile': 1, format: 3 });
  // A declared profile keeps everything it had and gains its format key.
  const declared = loop();
  const prof = { 'jarl-profile': 1, name: 'mine', statuses: L.BUILTIN_STATUSES };
  writeFileSync(marker(declared), JSON.stringify(prof));
  assert.equal(L.needFormat(declared, 'issue-key'), true);
  assert.deepEqual(read(declared), { ...prof, format: 3 });
  assert.equal(L.loadProfile(declared).declared, true);
});

test('a format-2 loop is raised to 3 with its repository names kept as names', () => {
  const root = loop();
  writeFileSync(marker(root), JSON.stringify({ 'jarl-profile': 1, format: 2 }, null, 2));
  withRepo(root, 'tool, ./sub');
  const before = readFileSync(issueFile(root), 'utf8');
  const log = readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
  assert.equal(L.repoValueKind(root, 'tool'), 'name');
  assert.equal(L.needFormat(root, 'writer'), true);
  assert.deepEqual(read(root), { 'jarl-profile': 1, format: 3 });
  assert.equal(L.loadProfile(root).format, 3, 'the raised marker is read at once, though it keeps its size');
  assert.equal(readFileSync(issueFile(root), 'utf8'), before, 'a bare word of format 2 is a name, and stays one');
  assert.equal(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), log, 'nothing is rewritten in the log');
  assert.equal(L.repoValueKind(root, 'tool'), 'name');
  assert.equal(L.repoValueKind(root, './sub'), 'path');
});

test('a format-3 loop is refused by the frozen reader of format 1 and by the frozen reader of formats 1 and 2, on reads and on writes', () => {
  assert.ok(formatTwoJarlIsPinned());
  const root = loop();
  writeFileSync(marker(root), JSON.stringify({ 'jarl-profile': 1, format: 2 }, null, 2));
  assert.equal(formatTwoJarl(root, 'list', {}).ok, true, 'before: the reader of formats 1 and 2 reads a format-2 loop');
  L.needFormat(root, 'batch');
  const log = readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
  for (const command of ['list', 'status', 'next', 'queue']) {
    const two = formatTwoJarl(root, command, {});
    assert.equal(two.ok, false, command);
    assert.match(two.error, /written for record format 3, and this Jarl reads format 1, 2 — nothing was read or written; the reader needs a Jarl that knows format 3/, command);
    const one = oldJarl(root, command, {});
    assert.equal(one.ok, false, command);
    assert.match(one.error, /written for record format 3, and this Jarl reads format 1 — /, command);
  }
  const write = formatTwoJarl(root, 'evidence', {}, ['1', 'a note', {}]);
  assert.equal(write.ok, false);
  assert.match(write.error, /written for record format 3/);
  assert.equal(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), log, 'the refused write wrote nothing');
  assert.match(jarl(root, 'list'), /first issue/, 'this Jarl reads the same loop');
});

test('a loop whose profile names an external scheduler is never raised: a write that needs format 3 or 2 is refused, the line is off there, and nothing is written', () => {
  const root = composed();
  const before = readFileSync(marker(root), 'utf8');
  const err = reason(() => L.withLock(root, () => L.needFormat(root, 'note-retraction')));
  assert.match(err, /^the retraction of a note needs record format 3, and this loop stays at format 1: its profile names an external scheduler \(the composer tick\), the composer that reads this record, so Jarl never raises its format/);
  assert.match(err, /the retraction of a note is off in this loop until its profile says "format": 3 — nothing was written\nafter jarl\.mjs profile "<as-the-view-shows>"$/);
  assert.equal(readFileSync(marker(root), 'utf8'), before);
  assert.match(reason(() => L.raiseFormat(root, 3)), /needs record format 3, and this loop stays at format 1/, 'the raise refuses, whoever calls it');
  assert.match(reason(() => L.raiseFormat(root)), /needs record format 2, and this loop stays at format 1/, 'to format 2 as well');
  assert.equal(readFileSync(marker(root), 'utf8'), before);
  // The views say what is off.
  const state = R.recordFormat(root);
  assert.deepEqual(state, { format: 1, reads: [1, 2, 3], raises: false, off: Object.keys(L.FORMAT_LINES) });
  const off = /record format 1: the profile names an external scheduler, so Jarl never raises it, and these lines are off in this loop until the profile says the format that holds them — a repository name \(format 2\), .*, the retraction of a verdict or an evidence row \(format 2\), an issue's key \(format 3\), .*, the retraction of a note \(format 3\), the tip of a branch after a row, a verdict, a merge or a close \(format 3\), the acceptance lines an evidence row proves \(format 3\)$/m;
  assert.match(jarl(root, 'status'), off);
  assert.match(jarl(root, 'profile'), off);
  assert.match(jarl(root, 'verify'), new RegExp(`^note: ${off.source}`, 'm'));
  assert.deepEqual(JSON.parse(jarl(root, 'status', '--json')).recordFormat, state);
  // A composer that reads format 3 opens its loop in it: nothing is raised and nothing is off.
  const three = composed({ format: 3 });
  assert.equal(L.needFormat(three, 'note-retraction'), false);
  assert.deepEqual(R.recordFormat(three), { format: 3, reads: [1, 2, 3], raises: false, off: [] });
  assert.doesNotMatch(jarl(three, 'status'), /off in this loop/);
});

test('the read-only commands never raise the record format, in a loop of format 1 or of format 2', () => {
  const reads = [...Object.keys(CLI.COMMAND_SUMMARY).filter((c) => !CLI.MUTATING.has(c)), 'goal'];
  assert.ok(reads.length >= 15, reads.join(' '));
  const args = { show: ['1'], changelog: ['1'], scope: ['1'] };
  for (const format of [1, 2]) {
    const root = loop();
    withRepo(root, 'sub');
    if (format === 2) writeFileSync(marker(root), JSON.stringify({ 'jarl-profile': 1, format: 2 }));
    const state = () => [existsSync(marker(root)) ? readFileSync(marker(root), 'utf8') : null, readFileSync(issueFile(root), 'utf8'), readFileSync(join(root, '.jarl', 'log.md'), 'utf8')];
    const before = state();
    for (const command of reads) {
      run(root, [command, ...(args[command] || [])]);
      assert.deepEqual(state(), before, `${command} in a loop of format ${format}`);
    }
  }
});

test('status, verify and profile say the record format of the loop, and profile the formats this Jarl reads', () => {
  const root = loop();
  assert.match(jarl(root, 'status'), /^opened .* · record format 1$/m);
  assert.deepEqual(JSON.parse(jarl(root, 'status', '--json')).recordFormat, { format: 1, reads: [1, 2, 3], raises: true, off: [] });
  assert.match(jarl(root, 'verify'), /^record format 1: clean$/m);
  assert.match(jarl(root, 'profile'), /^record format: 1 \(this Jarl reads 1, 2, 3\)$/m);
  assert.doesNotMatch(jarl(root, 'status'), /off in this loop/);
  L.needFormat(root, 'parent');
  assert.match(jarl(root, 'status'), /^opened .* · record format 3$/m);
  assert.match(jarl(root, 'verify'), /^record format 3: clean$/m);
  assert.match(jarl(root, 'profile'), /^record format: 3 \(this Jarl reads 1, 2, 3\)$/m);
});

test('record.md lists every line of format 3 in the format registry, in its order, with where it is written and what a reader of formats 1 and 2 does with it', () => {
  const md = readFileSync(fileURLToPath(new URL('../../references/record.md', import.meta.url)), 'utf8');
  const head = md.indexOf('| Line | Where it is written | What a reader of formats 1 and 2 does with it |');
  assert.ok(head > md.indexOf('## The format marker'), 'the table stands under The format marker');
  const lines = md.slice(head).split('\n').slice(2);
  const rows = lines.slice(0, lines.findIndex((l) => !l.startsWith('| '))).map((l) => l.slice(2, -2).split(' | ').map((c) => c.replace(/`/g, '')));
  assert.deepEqual(rows, Object.values(L.FORMAT_LINES).filter((l) => l.format === 3).map((l) => [l.what, l.where, l.misread]));
});
