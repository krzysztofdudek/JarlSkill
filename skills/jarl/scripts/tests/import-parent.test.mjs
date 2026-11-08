// --parent files every issue an import files under one parent, as field Parent puts an issue under one, and is refused with
// nothing written where that cannot be done.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as L from '../jarl-lib.mjs';
import { BUILTIN_STATUSES } from '../jarl-lib.mjs';
import { jarl } from './helpers.mjs';
import { BAD, SOURCE, composed, findingsFile, good, imports, json, loop, refusedImport, snapshot } from './import-kit.mjs';

test('--parent files every issue the import files under that parent, and moves nothing filed before', () => {
  const root = loop();
  jarl(root, 'new', 'the parent', '--acceptance', '[read] all of them are fixed');
  const file = findingsFile([good(1), good(2), good(3)]);
  const out = JSON.parse(imports(root, file, '--parent', '1', '--json'));
  assert.deepEqual(out.filed.map((f) => f.id), ['2', '3', '4']);
  assert.equal(out.parent, '1');
  for (const id of ['2', '3', '4']) assert.equal(json(root, 'show', id).fields.parent, '1', `issue ${id}`);
  assert.equal(json(root, 'show', '1').fields.parent, undefined);
  assert.match(jarl(root, 'list'), /^1 .*\n {2}2 .*\n {2}3 .*\n {2}4 /, 'the list shows the three under the parent');
  assert.equal(JSON.parse(readFileSync(join(root, '.jarl', 'profile.json'), 'utf8')).format, 3);
  const log = readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
  assert.equal([...log.matchAll(/field Parent · /g)].length, 3, 'one log line per issue put under the parent');
  assert.match(jarl(root, 'import', file, '--source', SOURCE), /already filed 3/);
  const next = jarl(root, 'import', findingsFile([good(1), good(4)]), '--source', SOURCE, '--parent', '1');
  assert.match(next, /^ext\/2026-11-06-atomic: 2 finding\(s\) · filed 1 · already filed 1 · under 1$/m);
  assert.equal(json(root, 'show', '5').fields.parent, '1');
});

test('the library\'s import refuses an empty by with --parent before it files anything', () => {
  const root = loop();
  jarl(root, 'new', 'the parent', '--acceptance', '[read] all of them are fixed');
  const before = snapshot(root);
  assert.throws(() => L.cmdImport(root, findingsFile([good(1), good(2)]), { source: SOURCE, parent: '1', by: '' }), /--by needs a name/);
  assert.deepEqual(snapshot(root), before, 'nothing was filed');
});

test('--parent shows in the text of the import and in a dry run, which writes nothing', () => {
  const root = loop();
  jarl(root, 'new', 'the parent', '--acceptance', '[read] it works');
  const before = readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
  assert.match(imports(root, findingsFile([good(1)]), '--parent', '1', '--dry-run'), /^ext\/2026-11-06-atomic: 1 finding\(s\) · would file 1 · already filed 0 · under 1$/m);
  assert.equal(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), before);
  assert.equal(json(root, 'list', '--all').length, 1);
  assert.match(imports(root, findingsFile([good(1)]), '--parent', '1'), /filed 1 · already filed 0 · under 1$/m);
});

test('--parent is refused, with nothing written, for a parent the loop does not hold, a finished one, or a word that is no number', () => {
  const root = loop();
  jarl(root, 'new', 'the parent', '--acceptance', '[read] it works');
  jarl(root, 'new', 'a dropped one', '--acceptance', '[read] it works');
  jarl(root, 'set', '2', 'dropped', 'not wanted');
  const file = findingsFile([good(1)]);
  assert.match(refusedImport(root, file, '--parent', '99'), /no such issue: 99[^\n]*\njarl\.mjs import "<findings\.json>" --source "?[^ \n]+"? --parent "<id>"\n$/);
  assert.match(refusedImport(root, file, '--parent', 'soon'), /the Parent of an issue is the number of one issue of the loop \(got "soon"\)[^\n]*\njarl\.mjs import .* --parent "<id>"\n$/);
  assert.match(refusedImport(root, file, '--parent', '2'), /2 is dropped: its own acceptance was checked against a whole that a sub-issue added now would not be part of — reopen it first/);
  assert.equal(json(root, 'list', '--all').length, 2);
});

test('--parent with a finding the filing refuses files nothing, and the parent keeps no sub-issue', () => {
  const root = loop();
  jarl(root, 'new', 'the parent', '--acceptance', '[read] it works');
  refusedImport(root, findingsFile([good(1), BAD]), '--parent', '1');
  assert.equal(json(root, 'list', '--all').length, 1);
});

test('--parent on a loop that stays at its record format is refused before anything is written', () => {
  const hub = composed();
  const said = refusedImport(hub, findingsFile([good(2)]), '--parent', '1');
  assert.match(said, /the parent of a sub-issue needs record format 3, and this loop stays at format 1: its profile names an external scheduler \(the composer tick\)/);
});

test('--parent is refused where the profile declares a field Parent of its own, and says how that field is written', () => {
  // A loop already open keeps a field of that name; a new loop is refused it, so the profile is written into the open loop.
  const root = loop();
  writeFileSync(join(root, '.jarl', 'profile.json'), JSON.stringify({ 'jarl-profile': 1, name: 'own', statuses: BUILTIN_STATUSES, fields: { Parent: {} } }));
  jarl(root, 'new', 'the parent', '--acceptance', '[read] it works');
  const said = refusedImport(root, findingsFile([good(1)]), '--parent', '1');
  assert.match(said, /--parent files the Parent the tool keeps, and this loop's profile declares a field Parent of its own/);
  assert.match(said, /\njarl\.mjs import .* --field "<name=value>"\n$/);
  assert.match(imports(root, findingsFile([good(1)]), '--field', 'Parent=1'), /filed 1/);
});
