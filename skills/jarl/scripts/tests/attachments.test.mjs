// Attachments: a file an issue must carry before it is done is recorded as a Proof row (the slot, the path under the loop
// root, the sha256 and the size; nothing is copied). The profile declares, in its done gate, the slots each kind of issue
// requires and per slot its place, its extensions and its minimum size. The done gate checks every required slot on the
// disk, show lists them, verify reports a row whose file is gone or changed, and a reader that does not know the key
// refuses the profile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as R from '../record.mjs';
import { spawnSync } from 'node:child_process';
import { jarl, refuses, run, spawnJarl, loop as makeLoop } from './helpers.mjs';
import { FINDINGS } from './findings.mjs';
import { oldJarl } from './old-jarl.mjs';

const L = await import('../jarl-lib.mjs');

const PROFILE = {
  'jarl-profile': 1,
  name: 'bugs',
  statuses: L.BUILTIN_STATUSES,
  'done-gate': {
    'requires-slots': { bug: ['before', 'after'] },
    slots: {
      before: { place: 'attachments/<id>/before.*', extensions: ['png', 'jpg'], 'min-size': 10 },
      after: { place: 'attachments/<id>/after.*', extensions: ['png'], 'min-size': 10 },
    },
  },
};
const PNG = 'a picture of the bug, long enough';
const sha = (text) => createHash('sha256').update(text).digest('hex');
const writeProfile = (root, profile) => writeFileSync(join(root, '.jarl', 'profile.json'), JSON.stringify(profile));
const put = (root, rel, content = PNG) => { const file = join(root, rel); mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, content); return file; };
const log = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const issueText = (root, id) => { const dir = join(root, '.jarl', 'issues'); return readFileSync(join(dir, readdirSync(dir).find((f) => Number(f.split('-')[0]) === Number(id))), 'utf8'); };

// A loop on the profile above holding the first issue, of the given kind, in progress, with a worker row and an approve.
function loopWith(kind = 'bug', profile = PROFILE) {
  const root = makeLoop({ prefix: 'jarl-attach-', via: 'cli' });
  writeProfile(root, profile);
  jarl(root, 'new', 'a defect', '--kind', kind, '--acceptance', 'it works');
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', '3 pass');
  jarl(root, 'review', '1', 'approve', '--by', 'rev-fresh', FINDINGS);
  return root;
}
const attach = (root, slot, rel, id = '1') => jarl(root, 'evidence', id, '--file', rel, '--slot', slot);
const both = (root) => { put(root, 'attachments/1/before.png'); put(root, 'attachments/1/after.png'); attach(root, 'before', 'attachments/1/before.png'); attach(root, 'after', 'attachments/1/after.png'); };

test('an attachment is recorded as one Proof row with the slot, the path, the sha256 and the size, and nothing is copied', () => {
  const root = loopWith();
  put(root, 'attachments/1/before.png');
  const before = readdirSync(join(root, 'attachments', '1'));
  const said = attach(root, 'before', 'attachments/1/before.png');
  assert.match(said, /evidence row recorded/);
  assert.deepEqual(readdirSync(join(root, 'attachments', '1')), before, 'the file stays where it is, and no copy is made');
  const text = issueText(root, 1);
  assert.match(text, /### Proof[\s\S]*- \*\*ran:\*\* attach before attachments\/1\/before\.png sha256:[0-9a-f]{64} size:\d+ · \*\*saw:\*\*/);
  assert.ok(text.includes(`sha256:${sha(PNG)} size:${Buffer.byteLength(PNG)}`));
  assert.match(log(root), /1 evidence row · attach before attachments\/1\/before\.png sha256:/);
  const events = L.loopEvents(join(root, '.jarl'), L.loadProfile(root)).filter((e) => e.type === 'row' && e.attach);
  assert.deepEqual(events.map((e) => e.attach), [{ slot: 'before', path: 'attachments/1/before.png', sha256: sha(PNG), size: Buffer.byteLength(PNG) }]);
});

test('a worker row typed in the shape of an attachment is refused: the row is written by --file and --slot', () => {
  const root = loopWith();
  const why = refuses(root, 'evidence', '1', '--ran', `attach before attachments/1/before.png sha256:${'0'.repeat(64)} size:5`, '--saw', 'ok');
  assert.match(why, /--file and --slot/);
});

test('an attachment is refused for a missing file, an empty file, a file under the minimum size and a file over the limit', () => {
  const root = loopWith();
  assert.match(refuses(root, 'evidence', '1', '--file', 'attachments/1/before.png', '--slot', 'before'), /no such file/);
  put(root, 'attachments/1/before.png', '');
  assert.match(refuses(root, 'evidence', '1', '--file', 'attachments/1/before.png', '--slot', 'before'), /is empty/);
  put(root, 'attachments/1/before.png', 'tiny');
  assert.match(refuses(root, 'evidence', '1', '--file', 'attachments/1/before.png', '--slot', 'before'), /is 4 bytes, under the minimum of 10 bytes/);
  const big = put(root, 'attachments/1/before.png', '');
  truncateSync(big, 64 * 1024 * 1024 + 1);
  assert.match(refuses(root, 'evidence', '1', '--file', 'attachments/1/before.png', '--slot', 'before'), /over the limit of 64 MiB/);
  assert.doesNotMatch(issueText(root, 1), /attach before/);
});

test('an attachment is refused for a slot the profile does not declare for the kind, an undeclared slot name and a slot name that is not a token', () => {
  const root = loopWith();
  put(root, 'attachments/1/during.png');
  const why = refuses(root, 'evidence', '1', '--file', 'attachments/1/during.png', '--slot', 'during');
  assert.match(why, /declares no slot "during" for an issue of kind bug/);
  assert.match(why, /before, after/);
  assert.match(refuses(root, 'evidence', '1', '--file', 'attachments/1/before.png', '--slot', 'Be fore'), /slot name/);
  const other = loopWith('gap');
  put(other, 'attachments/1/before.png');
  assert.match(refuses(other, 'evidence', '1', '--file', 'attachments/1/before.png', '--slot', 'before'), /requires no slots/);
});

test('an attachment is refused for a path outside the declared place and for an extension the slot does not allow', () => {
  const root = loopWith();
  put(root, 'attachments/2/before.png');
  put(root, 'attachments/1/other.png');
  put(root, 'attachments/1/before.gif');
  put(root, 'attachments/1/after.jpg');
  assert.match(refuses(root, 'evidence', '1', '--file', 'attachments/2/before.png', '--slot', 'before'), /is not at the place of slot before \(attachments\/1\/before\.\*\)/);
  assert.match(refuses(root, 'evidence', '1', '--file', 'attachments/1/other.png', '--slot', 'before'), /is not at the place of slot before/);
  assert.match(refuses(root, 'evidence', '1', '--file', 'attachments/1/before.gif', '--slot', 'before'), /has the extension "gif", and slot before allows png, jpg/);
  assert.match(refuses(root, 'evidence', '1', '--file', 'attachments/1/after.jpg', '--slot', 'after'), /has the extension "jpg", and slot after allows png/);
  put(root, 'attachments/1/before.PNG');
  assert.match(attach(root, 'before', 'attachments/1/before.PNG'), /recorded/, 'the extension is compared in lower case');
});

test('an attachment path is refused when it is absolute, climbs out with .., holds a space or is a directory', () => {
  const root = loopWith();
  const outside = mkdtempSync(join(tmpdir(), 'jarl-attach-out-'));
  put(root, 'attachments/1/before.png');
  assert.match(refuses(root, 'evidence', '1', '--file', join(root, 'attachments/1/before.png'), '--slot', 'before'), /relative to the loop root/);
  assert.match(refuses(root, 'evidence', '1', '--file', 'attachments/1/../1/before.png', '--slot', 'before'), /climbs out/);
  assert.match(refuses(root, 'evidence', '1', '--file', '../outside.png', '--slot', 'before'), /climbs out/);
  assert.match(refuses(root, 'evidence', '1', '--file', 'attachments/1/be fore.png', '--slot', 'before'), /whitespace/);
  assert.match(refuses(root, 'evidence', '1', '--file', 'attachments/1/before.png\n', '--slot', 'before'), /whitespace|line/);
  mkdirSync(join(root, 'attachments', '1', 'after.png'));
  assert.match(refuses(root, 'evidence', '1', '--file', 'attachments/1/after.png', '--slot', 'after'), /is a directory/);
  assert.ok(outside);
});

test('an attachment is refused when its path or a directory on it is a symlink, whether it leaves the root or not', () => {
  const root = loopWith();
  const outside = mkdtempSync(join(tmpdir(), 'jarl-attach-out-'));
  writeFileSync(join(outside, 'secret.png'), PNG);
  mkdirSync(join(root, 'attachments', '1'), { recursive: true });
  symlinkSync(join(outside, 'secret.png'), join(root, 'attachments', '1', 'before.png'));
  assert.match(refuses(root, 'evidence', '1', '--file', 'attachments/1/before.png', '--slot', 'before'), /symlink/);
  put(root, 'real/after.png');
  symlinkSync(join(root, 'real', 'after.png'), join(root, 'attachments', '1', 'after.png'));
  assert.match(refuses(root, 'evidence', '1', '--file', 'attachments/1/after.png', '--slot', 'after'), /symlink/);
  assert.doesNotMatch(issueText(root, 1), /attach (before|after)/);
  const linked = loopWith();
  mkdirSync(join(outside, 'dir'));
  writeFileSync(join(outside, 'dir', 'before.png'), PNG);
  mkdirSync(join(linked, 'attachments'));
  symlinkSync(join(outside, 'dir'), join(linked, 'attachments', '1'));
  assert.match(refuses(linked, 'evidence', '1', '--file', 'attachments/1/before.png', '--slot', 'before'), /symlink/);
});

test('--file and --slot go together, alone, and never with a note, a --ran row, a retraction or several issues', () => {
  const root = loopWith();
  put(root, 'attachments/1/before.png');
  assert.match(refuses(root, 'evidence', '1', '--file', 'attachments/1/before.png'), /--file needs --slot/);
  assert.match(refuses(root, 'evidence', '1', '--slot', 'before'), /--slot needs --file/);
  assert.match(refuses(root, 'evidence', '1', 'a note', '--file', 'attachments/1/before.png', '--slot', 'before'), /not both/);
  assert.match(refuses(root, 'evidence', '1', '--ran', 'x', '--saw', 'y', '--file', 'attachments/1/before.png', '--slot', 'before'), /not both/);
  assert.match(refuses(root, 'evidence', '1,2', '--file', 'attachments/1/before.png', '--slot', 'before'), /one issue/);
});

test('done is refused until every required slot is filled, naming each missing slot and the command that fills it', () => {
  const root = loopWith();
  const why = refuses(root, 'set', '1', 'done');
  assert.match(why, /1 needs these attachments before done/);
  assert.match(why, /slot before: no file recorded — jarl\.mjs evidence 1 --file <a file at attachments\/1\/before\.\*> --slot before/);
  assert.match(why, /slot after: no file recorded — jarl\.mjs evidence 1 --file <a file at attachments\/1\/after\.\*> --slot after/);
  put(root, 'attachments/1/before.png');
  attach(root, 'before', 'attachments/1/before.png');
  const half = refuses(root, 'set', '1', 'done');
  assert.doesNotMatch(half, /slot before/);
  assert.match(half, /slot after: no file recorded/);
  put(root, 'attachments/1/after.png');
  attach(root, 'after', 'attachments/1/after.png');
  assert.match(jarl(root, 'set', '1', 'done'), /1 → done/);
});

test('done is refused when a recorded file is gone', () => {
  const root = loopWith();
  both(root);
  unlinkSync(join(root, 'attachments', '1', 'before.png'));
  const why = refuses(root, 'set', '1', 'done');
  assert.match(why, /slot before: attachments\/1\/before\.png is gone/);
  assert.match(why, /jarl\.mjs evidence 1 --file <a file at attachments\/1\/before\.\*> --slot before/);
  assert.doesNotMatch(why, /slot after/);
});

test('done is refused when a recorded file does not match its recorded hash, and a new row for the slot clears it', () => {
  const root = loopWith();
  both(root);
  put(root, 'attachments/1/after.png', PNG.replace('bug', 'bag'));
  const why = refuses(root, 'set', '1', 'done');
  assert.match(why, /slot after: attachments\/1\/after\.png does not match its recorded sha256/);
  attach(root, 'after', 'attachments/1/after.png');
  assert.match(jarl(root, 'set', '1', 'done'), /1 → done/);
});

test('done is refused when a recorded file is under the minimum size or has an extension the slot does not allow', () => {
  const root = loopWith();
  both(root);
  writeProfile(root, { ...PROFILE, 'done-gate': { ...PROFILE['done-gate'], slots: { ...PROFILE['done-gate'].slots, before: { place: 'attachments/<id>/before.*', extensions: ['png'], 'min-size': 5000 } } } });
  assert.match(refuses(root, 'set', '1', 'done'), /slot before: attachments\/1\/before\.png is \d+ bytes, under the minimum of 5000 bytes/);
  writeProfile(root, { ...PROFILE, 'done-gate': { ...PROFILE['done-gate'], slots: { ...PROFILE['done-gate'].slots, before: { place: 'attachments/<id>/before.*', extensions: ['jpg'], 'min-size': 10 } } } });
  assert.match(refuses(root, 'set', '1', 'done'), /slot before: attachments\/1\/before\.png has the extension "png", and slot before allows jpg/);
});

test('done is refused when a recorded path has become a symlink out of the root', () => {
  const root = loopWith();
  both(root);
  const outside = mkdtempSync(join(tmpdir(), 'jarl-attach-out-'));
  writeFileSync(join(outside, 'x.png'), PNG);
  unlinkSync(join(root, 'attachments', '1', 'before.png'));
  symlinkSync(join(outside, 'x.png'), join(root, 'attachments', '1', 'before.png'));
  assert.match(refuses(root, 'set', '1', 'done'), /slot before: .*symlink/);
});

test('a retracted attachment row leaves its slot unfilled', () => {
  const root = loopWith();
  both(root);
  const n = L.evidenceTable(issueText(root, 1).slice(issueText(root, 1).indexOf('## Evidence'))).rows.findIndex((r) => r.ran.startsWith('attach after')) + 1;
  jarl(root, 'evidence', '1', '--retract', String(n), '--by', 'rev', 'the picture shows the wrong screen');
  assert.match(refuses(root, 'set', '1', 'done'), /slot after: no file recorded/);
});

test('an issue of a kind with no required slots is closed as without the feature', () => {
  const root = loopWith('gap');
  assert.match(jarl(root, 'set', '1', 'done'), /1 → done/);
});

test('a closed issue whose recorded file is gone is flagged by status as a gate that does not hold', () => {
  const root = loopWith();
  both(root);
  jarl(root, 'set', '1', 'done');
  unlinkSync(join(root, 'attachments', '1', 'after.png'));
  assert.match(jarl(root, 'status'), /closed, gate does not hold: 1 · .*slot after: attachments\/1\/after\.png is gone/);
});

test('show lists the required slots of an issue with their recorded paths and whether each is filled', () => {
  const root = loopWith();
  put(root, 'attachments/1/before.png');
  attach(root, 'before', 'attachments/1/before.png');
  const shown = jarl(root, 'show', '1');
  assert.match(shown, /Attachments \(slots an issue of kind bug requires\)/);
  assert.match(shown, /- before: attachments\/1\/before\.png · \d+ bytes · sha256 [0-9a-f]{12} · filled/);
  assert.match(shown, /- after: not recorded · place attachments\/1\/after\.\* · png/);
  put(root, 'attachments/1/before.png', PNG.replace('bug', 'bag'));
  assert.match(jarl(root, 'show', '1', '--full'), /- before: attachments\/1\/before\.png · .* · changed/);
  unlinkSync(join(root, 'attachments', '1', 'before.png'));
  assert.match(jarl(root, 'show', '1'), /- before: attachments\/1\/before\.png · .* · gone/);
  const other = loopWith('gap');
  assert.doesNotMatch(jarl(other, 'show', '1'), /Attachments/);
});

test('verify reports a slot row whose file is gone or whose hash changed, and is clean otherwise', () => {
  const root = loopWith();
  both(root);
  assert.match(jarl(root, 'verify'), /verify: clean/);
  unlinkSync(join(root, 'attachments', '1', 'before.png'));
  put(root, 'attachments/1/after.png', PNG.replace('bug', 'bag'));
  const r = run(root, ['verify']);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /recorded attachment files: 2/);
  assert.match(r.stdout, /issue 1: slot before: attachments\/1\/before\.png is gone/);
  assert.match(r.stdout, /issue 1: slot after: attachments\/1\/after\.png does not match its recorded sha256/);
});

test('verify reads the latest row of a slot: an old row of a changed file is not reported once the slot is recorded again', () => {
  const root = loopWith();
  both(root);
  put(root, 'attachments/1/after.png', PNG.replace('bug', 'bag'));
  attach(root, 'after', 'attachments/1/after.png');
  assert.match(jarl(root, 'verify'), /verify: clean/);
});

test('the profile key is checked: kinds, slot names, places, extensions, sizes and unused slots', () => {
  const bad = (gate) => { try { L.validateProfile({ ...PROFILE, 'done-gate': gate }); return null; } catch (e) { return e.message; } };
  const slots = PROFILE['done-gate'].slots;
  assert.equal(bad(PROFILE['done-gate']), null);
  assert.match(bad({ 'requires-slots': ['bug'], slots }), /"requires-slots" is an object/);
  assert.match(bad({ 'requires-slots': { sketch: ['before'] }, slots }), /kind "sketch" is not one of/);
  assert.match(bad({ 'requires-slots': { bug: [] }, slots }), /names at least one slot/);
  assert.match(bad({ 'requires-slots': { bug: ['Before'] }, slots }), /slot name "Before"/);
  assert.match(bad({ 'requires-slots': { bug: ['before', 'before'] }, slots }), /names slot "before" twice/);
  assert.match(bad({ 'requires-slots': { bug: ['before', 'after', 'during'] }, slots }), /slot "during" has no entry in "slots"/);
  assert.match(bad({ 'requires-slots': { bug: ['before'] }, slots }), /"slots": "after" is declared and no kind requires it/);
  assert.match(bad({ slots }), /"slots" needs "requires-slots"/);
  assert.match(bad({ 'requires-slots': { bug: ['before'] }, slots: { before: { place: '/etc/x.*', extensions: ['png'] } } }), /"place" is a relative path/);
  assert.match(bad({ 'requires-slots': { bug: ['before'] }, slots: { before: { place: 'a/../x.*', extensions: ['png'] } } }), /"place" is a relative path/);
  assert.match(bad({ 'requires-slots': { bug: ['before'] }, slots: { before: { place: 'a*/x.png', extensions: ['png'] } } }), /the last segment/);
  assert.match(bad({ 'requires-slots': { bug: ['before'] }, slots: { before: { place: 'a/x.*', extensions: [] } } }), /"extensions" is a non-empty list/);
  assert.match(bad({ 'requires-slots': { bug: ['before'] }, slots: { before: { place: 'a/x.*', extensions: ['.png'] } } }), /"extensions" is a non-empty list/);
  assert.match(bad({ 'requires-slots': { bug: ['before'] }, slots: { before: { place: 'a/x.*', extensions: ['png'], 'min-size': 0 } } }), /"min-size" is a whole number of bytes/);
  assert.match(bad({ 'requires-slots': { bug: ['before'] }, slots: { before: { place: 'a/x.*', extensions: ['png'], color: 'red' } } }), /unknown key "color"/);
});

test('a profile without the key describes no slots, shows no attachment section and prints no extra check', () => {
  const root = makeLoop({ prefix: 'jarl-attach-', via: 'cli' });
  jarl(root, 'new', 'a defect', '--kind', 'bug', '--acceptance', 'it works');
  assert.deepEqual(Object.keys(JSON.parse(jarl(root, 'profile', '--json')).doneGate), ['approve', 'requires-merged']);
  assert.doesNotMatch(jarl(root, 'show', '1'), /Attachments/);
  assert.match(refuses(root, 'evidence', '1', '--file', 'x.png', '--slot', 'before'), /declares no slot/);
});

test('the profile is described with its slots, and profile prints them', () => {
  const root = loopWith();
  const d = JSON.parse(jarl(root, 'profile', '--json'));
  assert.deepEqual(d.doneGate['requires-slots'], { bug: ['before', 'after'] });
  assert.equal(d.doneGate.slots.before.place, 'attachments/<id>/before.*');
  assert.match(jarl(root, 'profile'), /attachments: bug needs before, after/);
});

test('a reader that does not know the key refuses the profile loudly, and reads the same loop without it', () => {
  const root = makeLoop({ prefix: 'jarl-attach-', via: 'library' });
  R.newIssue(root, 'a defect', { acceptance: 'it works' });
  writeProfile(root, { 'jarl-profile': 1, name: 'bugs', statuses: L.BUILTIN_STATUSES });
  assert.equal(oldJarl(root, 'list', {}).ok, true, 'before: the frozen reader reads the loop');
  writeProfile(root, PROFILE);
  for (const command of ['list', 'status', 'next', 'queue']) {
    const r = oldJarl(root, command, {});
    assert.equal(r.ok, false, command);
    assert.match(r.error, /"done-gate": unknown key "requires-slots"/, command);
  }
  assert.match(jarl(root, 'list'), /a defect/);
});

test('the help text describes the two flags', () => {
  const help = run(makeLoop({ prefix: 'jarl-attach-', via: 'cli' }), ['--help']);
  assert.match(`${help.stdout}${help.stderr}`, /--file <path> --slot <name>/);
});

// ---- pipes, normalised rows and the states of a slot ----

// A call that must finish at once: a pipe that blocks the reader makes it time out, and the test fails instead of hanging.
function quick(root, ...args) {
  const r = spawnJarl(root, args, { timeout: 15_000 });
  assert.equal(r.error, undefined, `jarl ${args.join(' ')} did not finish: ${r.error && r.error.message}`);
  return r;
}
// A named pipe cannot exist on Windows, so the tests that need one do not run there.
const NO_PIPES = { skip: process.platform === 'win32' ? 'named pipes (mkfifo) do not exist on Windows' : false };
// Replaces the file at rel by a named pipe.
function pipeAt(root, rel) {
  const file = join(root, rel);
  mkdirSync(join(file, '..'), { recursive: true });
  try { unlinkSync(file); } catch { /* there was none */ }
  const made = spawnSync('mkfifo', [file], { timeout: 10_000 });
  assert.equal(made.status, 0, 'mkfifo made the pipe');
}

test('a named pipe at a slot path is refused by evidence --file, done, show and verify without blocking, and leaves no lock behind', NO_PIPES, () => {
  const root = loopWith();
  both(root);
  pipeAt(root, 'attachments/1/before.png');
  const done = quick(root, 'set', '1', 'done');
  assert.notEqual(done.status, 0);
  assert.match(done.stderr, /slot before: attachments\/1\/before\.png is not a regular file/);
  assert.match(quick(root, 'show', '1').stdout, /- before: attachments\/1\/before\.png .*refused \(attachments\/1\/before\.png is not a regular file/);
  assert.match(quick(root, 'verify').stdout, /issue 1: slot before: attachments\/1\/before\.png is not a regular file/);
  pipeAt(root, 'attachments/1/after.png');
  const again = quick(root, 'evidence', '1', '--file', 'attachments/1/after.png', '--slot', 'after');
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /is not a regular file/);
  assert.equal(quick(root, 'evidence', '1', 'a note after the pipes').status, 0, 'the write lock is free');
});

test('status, resume and report do not block on a closed issue whose slot path has become a named pipe', NO_PIPES, () => {
  const root = loopWith();
  both(root);
  jarl(root, 'set', '1', 'done');
  pipeAt(root, 'attachments/1/before.png');
  const status = quick(root, 'status');
  assert.match(status.stdout, /closed, gate does not hold: 1 · slot before: attachments\/1\/before\.png is not a regular file/);
  assert.equal(quick(root, 'resume').status, 0);
  assert.equal(quick(root, 'report').status, 0);
  assert.equal(quick(root, 'evidence', '1', 'a note after the pipe').status, 0, 'the write lock is free');
});

test('a row shaped as an attachment is refused by --ran in every spelling the log would store as one', () => {
  const root = loopWith();
  const ran = `attach before attachments/1/before.png sha256:${'0'.repeat(64)} size:5`;
  const variants = { 'a leading space': ` ${ran}`, 'a trailing space': `${ran} `, 'a trailing newline': `${ran}\n`, 'a trailing U+2028': `${ran} `, 'a leading tab': `\t${ran}`, 'a non-breaking space': ` ${ran}`, 'upper case': ran.toUpperCase(), 'a second line': `${ran}\nmore` };
  for (const [name, value] of Object.entries(variants)) {
    assert.match(refuses(root, 'evidence', '1', '--ran', value, '--saw', 'ok'), /--file and --slot/, name);
  }
  assert.doesNotMatch(log(root), /evidence row · attach/);
  assert.match(jarl(root, 'evidence', '1', '--ran', 'attach the probe', '--saw', 'ok'), /recorded/, 'a command that only starts with the word is a row');
});

test('the log refuses a hand-written attachment row and names --file and --slot', () => {
  const root = loopWith();
  assert.match(refuses(root, 'log', `1 evidence row · attach before attachments/1/before.png sha256:${'0'.repeat(64)} size:5`), /jarl\.mjs evidence <id> --file <path> --slot <name>/);
});

test('retracting the newest row of a slot empties it and never brings back the row before it', () => {
  const root = loopWith();
  both(root);
  put(root, 'attachments/1/after.png', PNG.replace('bug', 'bag'));
  attach(root, 'after', 'attachments/1/after.png');
  const text = issueText(root, 1);
  const rows = L.evidenceTable(text.slice(text.indexOf('## Evidence'))).rows;
  const newest = rows.map((r, i) => (r.ran.startsWith('attach after') ? i + 1 : 0)).filter(Boolean).pop();
  jarl(root, 'evidence', '1', '--retract', String(newest), '--by', 'rev', 'the picture shows the wrong screen');
  assert.match(refuses(root, 'set', '1', 'done'), /slot after: no file recorded/);
  assert.match(jarl(root, 'show', '1'), /- after: not recorded · place/);
  assert.match(jarl(root, 'verify'), /verify: clean/);
});

test('show prints the reason of a refused slot and show --json carries the state of every slot', () => {
  const root = loopWith();
  both(root);
  writeProfile(root, { ...PROFILE, 'done-gate': { ...PROFILE['done-gate'], slots: { ...PROFILE['done-gate'].slots, before: { place: 'attachments/<id>/before.*', extensions: ['png'], 'min-size': 5000 } } } });
  assert.match(jarl(root, 'show', '1'), /- before: attachments\/1\/before\.png · \d+ bytes · sha256 [0-9a-f]{12} · refused \(attachments\/1\/before\.png is \d+ bytes, under the minimum of 5000 bytes\)/);
  const slots = JSON.parse(jarl(root, 'show', '1', '--json')).attachments;
  assert.deepEqual(slots.map((s) => [s.slot, s.state]), [['before', 'refused'], ['after', 'filled']]);
  assert.equal(slots[1].sha256, sha(PNG));
  assert.equal(slots[1].path, 'attachments/1/after.png');
  assert.equal(JSON.parse(jarl(loopWith('gap'), 'show', '1', '--json')).attachments, undefined);
});

test('a row recorded before the last start is outside the window: show and done say so', () => {
  const root = loopWith();
  both(root);
  jarl(root, 'set', '1', 'open', 'back to the queue');
  jarl(root, 'set', '1', 'in-progress', 'again', '--worker', 'w2');
  assert.match(jarl(root, 'show', '1'), /- before: not recorded in the gate's window \(a row from before the last start or reopen does not count\)/);
  assert.equal(JSON.parse(jarl(root, 'show', '1', '--json')).attachments[0].state, 'outside');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', '3 pass');
  jarl(root, 'review', '1', 'approve', '--by', 'rev-fresh', FINDINGS);
  assert.match(refuses(root, 'set', '1', 'done'), /slot before: no file recorded inside the gate's window/);
});

test('the views compare a recorded file by existence and size, and the done gate and verify read its bytes', () => {
  const root = loopWith();
  both(root);
  jarl(root, 'set', '1', 'done');
  put(root, 'attachments/1/after.png', PNG.replace('bug', 'bag'));
  assert.doesNotMatch(jarl(root, 'status'), /gate does not hold/, 'a same-size rewrite is not read by status');
  assert.match(run(root, ['verify']).stdout, /slot after: attachments\/1\/after\.png does not match its recorded sha256/);
  put(root, 'attachments/1/after.png', `${PNG} and more`);
  assert.match(jarl(root, 'status'), /closed, gate does not hold: 1 · slot after: attachments\/1\/after\.png is \d+ bytes, and \d+ were recorded/);
});

test('the real on-disk name of a file is the one recorded', () => {
  const root = loopWith();
  put(root, 'attachments/1/before.PNG');
  const odd = join(root, 'attachments', '1', 'before.png');
  let sensitive = true;
  try { readFileSync(odd); sensitive = false; } catch { /* a case-sensitive disk */ }
  if (sensitive) { assert.match(refuses(root, 'evidence', '1', '--file', 'attachments/1/before.png', '--slot', 'before'), /no such file/); return; }
  attach(root, 'before', 'attachments/1/before.png');
  assert.match(issueText(root, 1), /attach before attachments\/1\/before\.PNG sha256:/);
});

test('a place holds at most one *, in the last segment, and requires-slots names at least one kind', () => {
  const bad = (gate) => { try { L.validateProfile({ ...PROFILE, 'done-gate': gate }); return null; } catch (e) { return e.message; } };
  const one = (place) => ({ 'requires-slots': { bug: ['before'] }, slots: { before: { place, extensions: ['png'] } } });
  assert.match(bad(one('a/*.*')), /at most one \*/);
  assert.equal(bad(one('a/before.*')), null);
  assert.match(bad({ 'requires-slots': {}, slots: {} }), /"requires-slots" names at least one kind/);
});
