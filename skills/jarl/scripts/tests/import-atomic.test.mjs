// A refused import leaves the loop as it found it: nothing is adopted onto an issue, nothing is filed and nothing is
// logged, whether the refusal comes from the profile, from a later finding or from a record format the loop stays at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_STATUSES } from '../jarl-lib.mjs';
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

test('an import that is not refused still files, adopts and logs as it did', () => {
  const root = loop();
  jarl(root, 'new', 'an issue that names finding-1', '--what', 'it covers finding-1 of the report');
  const out = JSON.parse(imports(root, findingsFile([good(1), good(2), good(3)]), '--adopt', '--json'));
  assert.deepEqual(out.filed.map((f) => f.finding), ['finding-2', 'finding-3']);
  assert.deepEqual(out.adopted.map((a) => a.finding), ['finding-1']);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /imported ext\/2026-11-06-atomic · 2 filed, 0 already filed, 1 adopted/);
});
