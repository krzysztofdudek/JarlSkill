// A refused import leaves the loop as it found it: nothing is adopted onto an issue, nothing is filed and nothing is
// logged, whether the refusal comes from the profile, from a later finding or from a record format the loop stays at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_STATUSES, renderIssue } from '../jarl-lib.mjs';
import { jarl } from './helpers.mjs';
import { BAD, SOURCE, composed, findingsFile, good, imports, json, loop, refusedImport } from './import-kit.mjs';

test('a refusal after an adoption leaves the adopted issue without the Source, and the log as it was', () => {
  const root = loop();
  jarl(root, 'new', 'an issue that names finding-1', '--what', 'it covers finding-1 of the report');
  const file = findingsFile([good(1), good(2), BAD]);
  const said = refusedImport(root, file, '--adopt');
  assert.match(said, /^finding "finding-bad" cannot be filed/);
  assert.equal(json(root, 'show', '1').fields.source, undefined);
  assert.equal(json(root, 'list', '--all').length, 1);
  const clean = findingsFile([good(1), good(2)]);
  assert.match(imports(root, clean, '--adopt'), /filed 1 · already filed 0 · adopted 1/);
  assert.equal(json(root, 'show', '1').fields.source, `${SOURCE}#finding-1`);
});

test('a required field of the profile that a finding would leave empty refuses the file with nothing adopted and nothing filed', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-atomic-required-'));
  mkdirSync(join(root, '.git'));
  const profile = join(mkdtempSync(join(tmpdir(), 'jarl-atomic-profile-')), 'profile.json');
  writeFileSync(profile, JSON.stringify({ 'jarl-profile': 1, name: 'areas', statuses: BUILTIN_STATUSES, fields: { Area: { required: true, enum: ['web', 'api'] } } }));
  jarl(root, 'init', 'goal', '--profile', profile);
  jarl(root, 'new', 'names finding-1', '--field', 'Area=web', '--what', 'it covers finding-1');
  const file = findingsFile([good(1), good(2)]);
  const said = refusedImport(root, file, '--adopt');
  assert.match(said, /^finding "finding-2" cannot be filed: Area is required by this loop's profile/);
  assert.match(said, /\njarl\.mjs import "<findings\.json>" --source "?[^ \n]+"? --adopt --field "<name=value>"\n$/);
  assert.match(imports(root, file, '--adopt', '--field', 'Area=api'), /adopted 1/);
});

test('on a loop whose profile names an external scheduler, a repository named by --repo refuses the import before it adopts or files anything', () => {
  const hub = composed();
  const file = findingsFile([good(1), good(2)]);
  const said = refusedImport(hub, file, '--adopt', '--repo', 'tool');
  assert.match(said, /^finding "finding-2" cannot be filed: a repository name needs record format 2, and this loop stays at format 1: its profile names an external scheduler \(the composer tick\)/);
  assert.match(said, /nothing was written\n/);
  assert.doesNotMatch(said, /nothing was filed/, 'the reason already says what is true');
  assert.equal(json(hub, 'show', '1').fields.source, undefined);
  assert.equal(refusedImport(hub, file, '--adopt', '--repo', 'tool', '--dry-run'), said);
  // The same file by the repository's path is stored as a path, which this format holds.
  const out = JSON.parse(imports(hub, file, '--adopt', '--repo', '../tool', '--json'));
  assert.deepEqual([out.filed.length, out.adopted.length], [1, 1]);
});

test('on a loop that stays at its record format, a finding that would take a number the format cannot hold refuses the file before the findings ahead of it are filed, a dry run alike', () => {
  const hub = composed();
  writeFileSync(join(hub, '.jarl', 'issues', '998-old-998.md'), renderIssue({ id: '998', title: 'old 998', kind: 'bug', priority: '2', tier: 'standard', tags: [], files: [], repo: '', foundBy: 'jarl' }));
  const file = findingsFile([good(2), good(3)]);
  const said = refusedImport(hub, file);
  assert.match(said, /^finding "finding-3" cannot be filed: issue number 1000 needs record format 2, and this loop stays at format 1: its profile names an external scheduler \(the composer tick\)/);
  assert.match(said, /nothing was written; the findings that take a number below it can be filed with --only\n/);
  assert.match(said, /\njarl\.mjs import "<findings\.json>" --source "?[^ \n]+"? --only "<finding-ids>"\n$/);
  const dry = refusedImport(hub, file, '--dry-run');
  assert.equal(dry.split('\n')[0], said.split('\n')[0], 'the dry run refuses what the import would');
  assert.match(dry, /\njarl\.mjs import "<findings\.json>" --source "?[^ \n]+"? --dry-run --only "<finding-ids>"\n$/);
  assert.deepEqual(json(hub, 'list', '--all').map((r) => r.id), ['001', '998']);
  // The one finding that fits is filed as 999.
  const out = JSON.parse(imports(hub, file, '--only', 'finding-2', '--json'));
  assert.deepEqual(out.filed.map((f) => f.id), ['999']);
});

test('on a loop that stays at its record format and holds no number for the first finding, the refusal ends with the profile view and the call\'s own form', () => {
  const hub = composed();
  writeFileSync(join(hub, '.jarl', 'issues', '999-old-999.md'), renderIssue({ id: '999', title: 'old 999', kind: 'bug', priority: '2', tier: 'standard', tags: [], files: [], repo: '', foundBy: 'jarl' }));
  const said = refusedImport(hub, findingsFile([good(2)]), '--dry-run');
  assert.match(said, /^finding "finding-2" cannot be filed: issue number 1000 needs record format 2, .* until its profile says "format": 2 — nothing was written\n/);
  const [view, form] = said.trim().split('\n').slice(-2);
  assert.equal(view, 'jarl.mjs profile');
  assert.match(form, /^jarl\.mjs import "<findings\.json>" --source "?[^ ]+"? --dry-run$/);
});

test('an adoption of an issue whose number two files carry is refused by the dry run as by the import, with nothing written', () => {
  const root = loop();
  jarl(root, 'new', 'an issue that names finding-1', '--what', 'it covers finding-1 of the report');
  jarl(root, 'new', 'another issue');
  const dir = join(root, '.jarl', 'issues');
  const second = readdirSync(dir).find((f) => /^0*2-/.test(f));
  const twin = second.replace(/^0*2-/, (m) => m.replace('2', '1'));
  renameSync(join(dir, second), join(dir, twin));
  writeFileSync(join(dir, twin), readFileSync(join(dir, twin), 'utf8').replace(/^# 0*2 ·/, (m) => m.replace('2', '1')));
  const file = findingsFile([good(1), good(2)]);
  const said = refusedImport(root, file, '--adopt');
  assert.match(said, /^2 issue files carry the number 0*1: /);
  assert.equal(refusedImport(root, file, '--adopt', '--dry-run'), said);
});

test('an import that is not refused still files, adopts and logs as it did', () => {
  const root = loop();
  jarl(root, 'new', 'an issue that names finding-1', '--what', 'it covers finding-1 of the report');
  const out = JSON.parse(imports(root, findingsFile([good(1), good(2), good(3)]), '--adopt', '--json'));
  assert.deepEqual(out.filed.map((f) => f.finding), ['finding-2', 'finding-3']);
  assert.deepEqual(out.adopted.map((a) => a.finding), ['finding-1']);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /imported ext\/2026-11-06-atomic · 2 filed, 0 already filed, 1 adopted/);
});
