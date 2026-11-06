// A section of a profile may not be named like a header field of the tool or like a part the tool writes (the notes, the
// reviews and the proof of an issue): field would hide the header, or overwrite the history the file shows. A profile
// file given to init or to profile is refused with the list of reserved names; a loop already open with such a profile
// is read as it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jarl, refuses } from './helpers.mjs';
import * as R from '../record.mjs';

const { RESERVED_SECTION_NAMES } = await import('../lib/profile.mjs');

const STATUSES = { open: ['dispatchable'], 'in-progress': ['holds-claim'], done: ['terminal', 'closes-record', 'settles-dependents'] };
function profileFile(sections) {
  const file = join(mkdtempSync(join(tmpdir(), 'jarl-sections-')), 'p.json');
  writeFileSync(file, JSON.stringify({ 'jarl-profile': 1, statuses: STATUSES, sections }));
  return file;
}

test('a section named like a header field or like a part the tool writes is refused with the reserved names', () => {
  for (const name of ['Tags', 'Where', 'Priority', 'Files', 'Found by', 'Title', 'Kind', 'Notes', 'Reviews', 'Proof', 'reviews', 'WHERE']) {
    const file = profileFile([name]);
    assert.throws(() => R.readProfileFile(file), new RegExp(`it declares the section ${name}, which is the name of a header field or of a part Jarl writes itself — the reserved names are ${RESERVED_SECTION_NAMES.join(', ')}; rename it in the profile`), name);
    assert.match(refuses(mkdtempSync(join(tmpdir(), 'jarl-sections-init-')), 'init', 'goal', '--profile', file), /reserved names are Status, Priority, Tags/, name);
    assert.match(refuses(mkdtempSync(join(tmpdir(), 'jarl-sections-profile-')), 'profile', file), /which is the name of a header field/, name);
  }
});

test('the reserved names are the header fields of the tool and the parts it writes', () => {
  for (const name of ['Status', 'Priority', 'Tags', 'Files', 'Repo', 'After', 'Found by', 'Source', 'Where', 'Title', 'Kind', 'Tier', 'Parent', 'Key', 'Resources', 'Person', 'Check when', 'Evidence', 'Notes', 'Reviews', 'Proof']) {
    assert.ok(RESERVED_SECTION_NAMES.includes(name), name);
  }
});

test('sections of other names are accepted, and a loop already open with a reserved section keeps it', () => {
  const file = profileFile(['Plan', 'Design notes']);
  assert.deepEqual(R.readProfileFile(file).profile.sections, ['Plan', 'Design notes']);
  const root = mkdtempSync(join(tmpdir(), 'jarl-sections-open-'));
  mkdirSync(join(root, '.git'));
  R.initLoop(root, 'an older loop');
  writeFileSync(join(root, '.jarl', 'profile.json'), JSON.stringify({ 'jarl-profile': 1, name: 'own', statuses: STATUSES, sections: ['Notes'] }));
  assert.match(jarl(root, 'new', 'one', '--section', 'Notes=kept'), /filed 1/);
  assert.deepEqual(JSON.parse(jarl(root, 'profile', '--json')).sections, ['Notes']);
});
