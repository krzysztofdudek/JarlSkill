// The Unreleased section of CHANGELOG.md holds each entry once. A merge of two branches that both added an entry can leave
// it twice, word for word or with a few words changed, and nothing else reads the section closely enough to see it: two
// entries are one when they begin alike, compared without case or punctuation over their first 80 characters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PREFIX = 80;

// An entry as it is compared: lower case, every mark of punctuation a space, spaces collapsed, its first 80 characters.
const entryKey = (entry) => entry.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, PREFIX);

// The entries of the Unreleased section of a changelog's text: each list item, one line, from the heading
// `## [Unreleased]` to the next `## ` heading.
function unreleasedEntries(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((l) => /^## \[Unreleased\]/i.test(l));
  if (start === -1) return [];
  const end = lines.findIndex((l, n) => n > start && /^## /.test(l));
  return lines.slice(start + 1, end === -1 ? lines.length : end).filter((l) => /^\s*[-*] \S/.test(l)).map((l) => l.replace(/^\s*[-*] /, '').trim());
}

// Each entry that begins as an earlier one does, with the earlier one it repeats: [{ entry, repeats }].
function repeatedEntries(text) {
  const seen = new Map();
  const out = [];
  for (const entry of unreleasedEntries(text)) {
    const key = entryKey(entry);
    if (seen.has(key)) out.push({ entry, repeats: seen.get(key) });
    else seen.set(key, entry);
  }
  return out;
}

test('the Unreleased section of CHANGELOG.md holds no entry twice', () => {
  const text = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  assert.ok(unreleasedEntries(text).length > 0, 'the checker reads the entries of the Unreleased section');
  assert.deepEqual(repeatedEntries(text), []);
});

test('the checker finds an entry repeated word for word or with a few words changed, in the Unreleased section alone', () => {
  const entry = 'A task that only writes its own files can be tagged in-place: its worker writes them where they are checked out, with no branch and no merge.';
  const changelog = (unreleased, released = []) => ['# Changelog', '', '## [Unreleased]', '', '### Added', '', ...unreleased.map((e) => `- ${e}`), '', '## [6.2.0] - 2026-10-01', '', ...released.map((e) => `- ${e}`), ''].join('\n');
  assert.deepEqual(repeatedEntries(changelog([entry, 'Another change.'])), []);
  assert.deepEqual(repeatedEntries(changelog([entry, 'Another change.', entry])), [{ entry, repeats: entry }], 'the same entry twice');
  const reworded = entry.replace('with no branch and no merge.', 'with neither a branch nor a merge, and the coordinator commits them.');
  assert.deepEqual(repeatedEntries(changelog([entry, reworded])), [{ entry: reworded, repeats: entry }], 'a few words changed after the first 80 characters');
  const recased = entry.toUpperCase().replace(/:/g, ' -').replace('IN-PLACE', '`IN-PLACE`');
  assert.equal(repeatedEntries(changelog([entry, recased])).length, 1, 'another case and other punctuation');
  assert.equal(repeatedEntries(changelog([entry], [entry])).length, 0, 'an entry of a released section repeats nothing');
  assert.equal(repeatedEntries(changelog([entry, 'A task that only writes one document is closed once a recorded proof names the commit of it.'])).length, 0, 'two entries that differ early are two');
  assert.equal(repeatedEntries(changelog([entry, entry]).replace(/\n/g, '\r\n')).length, 1, 'a file with CRLF line ends is read alike');
});
