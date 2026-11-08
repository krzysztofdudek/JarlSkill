// A findings file is one act: import checks every finding it would file against the rules of filing before the first write,
// and refuses the whole file, with the form of a call that can file it, when one fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_STATUSES } from '../jarl-lib.mjs';
import { jarl } from './helpers.mjs';
import { BAD, findingsFile, good, imports, json, loop, refusedImport } from './import-kit.mjs';

// A loop whose profile declares a field Area with two values, not required.
function areas() {
  const root = mkdtempSync(join(tmpdir(), 'jarl-import-areas-'));
  mkdirSync(join(root, '.git'));
  const profile = join(mkdtempSync(join(tmpdir(), 'jarl-import-areas-profile-')), 'profile.json');
  writeFileSync(profile, JSON.stringify({ 'jarl-profile': 1, name: 'areas', statuses: BUILTIN_STATUSES, fields: { Area: { enum: ['web', 'api'] } } }));
  jarl(root, 'init', 'goal', '--profile', profile);
  return root;
}

// A --field pair is given once for the whole call, so a wrong one is the call's own fault, never a finding's.
for (const [what, pair, reason] of [
  ['a value outside the field\'s values', 'Area=nowhere', /^Area must be one of: web, api \(got "nowhere"\)\n/],
  ['a field the profile does not declare', 'Colour=red', /^Colour is not a field this loop's profile declares — it declares Area \(got "Colour=red"\)\n/],
  ['a pair without =', 'Area', /^--field takes <name>=<value> \(got "Area"\)\n/],
]) {
  test(`--field with ${what} is refused for the call, naming the pair and not a finding, with a form that carries --field, a dry run alike`, () => {
    const root = areas();
    const file = findingsFile([good(1), good(2)]);
    for (const dry of [[], ['--dry-run']]) {
      const said = refusedImport(root, file, '--field', pair, ...dry);
      assert.match(said, reason);
      assert.doesNotMatch(said, /cannot be filed|finding "/, 'no finding is blamed for the flag');
      assert.match(said, new RegExp(`\\njarl\\.mjs import "<findings\\.json>" --source "?[^ \\n]+"? --field "<name=value>"${dry.length ? ' --dry-run' : ''}\\n$`));
    }
    assert.equal(json(root, 'list', '--all').length, 0);
  });
}

test('with a right --field, a finding whose own text the filing refuses is still the one named, and a key of a finding named like the field is not read as it', () => {
  const root = areas();
  const said = refusedImport(root, findingsFile([good(1), BAD]), '--field', 'Area=web');
  assert.match(said, /^finding "finding-bad" cannot be filed: .*holds an opening and a closing why tag/);
  assert.match(said, /\njarl\.mjs import "<findings\.json>" --dry-run\n$/);
  const out = imports(root, findingsFile([{ ...good(1), Area: 'nowhere' }]), '--field', 'Area=web');
  assert.match(out, /extra keys let through, not read: Area \(1 finding\)/);
  assert.equal(json(root, 'show', '1').fields.area, 'web');
});

test('a finding the filing refuses refuses the whole file, whichever place it has in it, and nothing is filed', () => {
  for (const list of [[BAD, good(1), good(2)], [good(1), BAD, good(2)], [good(1), good(2), BAD]]) {
    const root = loop();
    const said = refusedImport(root, findingsFile(list));
    assert.match(said, /^finding "finding-bad" cannot be filed: .*holds an opening and a closing why tag.* — nothing was (filed|written)/);
    assert.equal(json(root, 'list', '--all').length, 0);
  }
});

test('the refusal of a finding ends with a form of the import, and a dry run refuses the same file the same way', () => {
  const root = loop();
  const file = findingsFile([good(1), BAD]);
  const said = refusedImport(root, file);
  assert.match(said, /\njarl\.mjs import "<findings\.json>" --dry-run\n$/);
  assert.equal(refusedImport(root, file, '--dry-run'), said);
});

test('a flag the filing refuses is refused before the first write, with the form that fixes it', () => {
  const root = loop();
  jarl(root, 'new', 'an issue that names finding-1', '--acceptance', '[read] it works', '--what', 'it covers finding-1 of the report');
  const file = findingsFile([good(1), good(2)]);
  const said = refusedImport(root, file, '--adopt', '--tier', 'huge');
  assert.match(said, /--tier must be one of: light, standard, strong \(got "huge"\)/);
  assert.match(said, /\njarl\.mjs import "<findings\.json>" --source "?[^ \n]+"? --adopt --tier "<tier>"\n$/);
});
