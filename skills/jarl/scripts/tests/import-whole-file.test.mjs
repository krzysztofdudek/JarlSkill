// A findings file is one act: import checks every finding it would file against the rules of filing before the first write,
// and refuses the whole file, with the form of a call that can file it, when one fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jarl } from './helpers.mjs';
import { BAD, findingsFile, good, json, loop, refusedImport } from './import-kit.mjs';

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
  jarl(root, 'new', 'an issue that names finding-1', '--what', 'it covers finding-1 of the report');
  const file = findingsFile([good(1), good(2)]);
  const said = refusedImport(root, file, '--adopt', '--tier', 'huge');
  assert.match(said, /--tier must be one of: light, standard, strong \(got "huge"\)/);
  assert.match(said, /\njarl\.mjs import "<findings\.json>" --source "?[^ \n]+"? --adopt --tier "<tier>"\n$/);
});
