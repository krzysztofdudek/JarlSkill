// The keys of a finding. Research writes keys the mapping does not read beside the ones it does, and those pass; a key that
// is a mapped key in another case, a mapped key of five letters or more missed by one letter, or a mapped key with two
// neighbouring letters swapped is refused, because the issue would otherwise be filed with that field empty. Import, its
// dry run and sources read the keys alike.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jarl, loop as makeLoop, refuses } from './helpers.mjs';

const loop = () => makeLoop({ prefix: 'jarl-import-keys-', via: 'cli', dotGit: false });
function findingsFile(list) {
  const file = join(mkdtempSync(join(tmpdir(), 'jarl-keys-')), 'findings.json');
  writeFileSync(file, JSON.stringify(list));
  return file;
}
const KEYS = /the keys a finding takes are id, title, claim, kind, priority, severity, where, surfaces, truth, evidence, impact, adopter_impact, proposal, suggested_fix, fix, effort/;
// The refusal of a finding that carries `key` (a claim beside it, so the file is otherwise right), or null where it passes.
function verdict(key) {
  const root = loop();
  const file = findingsFile([{ id: 'K-1', title: 'a finding', claim: 'It is read.', [key]: 'a value' }]);
  const dry = (() => { try { return jarl(root, 'import', file, '--source', 'r', '--dry-run'); } catch (e) { return null; } })();
  return dry === null ? refuses(root, 'import', file, '--source', 'r', '--dry-run') : null;
}

test('a mapped key in another case is refused, whatever its length', () => {
  for (const [key, mapped] of [['CLAIM', 'claim'], ['Title', 'title'], ['ID', 'id'], ['Fix', 'fix'], ['Suggested_Fix', 'suggested_fix']]) {
    const said = verdict(key);
    assert.ok(said, `${key} is refused`);
    assert.match(said, new RegExp(`finding "K-1" has "${key}" \\(did you mean "${mapped}"\\?\\)`));
    assert.match(said, KEYS);
  }
  assert.equal(verdict('claim'), null, 'the mapped key itself passes');
});

test('a key one letter off a mapped key of five letters or more is refused: a letter missing, added or wrong', () => {
  for (const [key, mapped] of [['clam', 'claim'], ['claims', 'claim'], ['claum', 'claim'], ['priorty', 'priority'], ['severety', 'severity'], ['surface', 'surfaces'], ['evidance', 'evidence'], ['proposals', 'proposal'], ['imapct', 'impact']]) {
    assert.match(verdict(key) ?? '', new RegExp(`has "${key}" \\(did you mean "${mapped}"\\?\\)`), key);
  }
});

test('a key two letters off a mapped key passes, as does any key one letter off a mapped key of four letters or fewer', () => {
  // The names research and people use beside the mapped keys: none of them is a misspelling of one.
  for (const key of ['file', 'line', 'find', 'kid', 'ids', 'effect', 'fixed', 'fixes', 'kinds', 'clime', 'verifier', 'v', 'language', 'notes', 'tag', 'where_to', 'truths_not']) {
    assert.equal(verdict(key), null, key);
  }
});

test('two neighbouring letters swapped in a mapped key is refused, of any length', () => {
  for (const [key, mapped] of [['tilte', 'title'], ['cliam', 'claim'], ['knid', 'kind'], ['di', 'id'], ['ifx', 'fix'], ['evidecne', 'evidence'], ['whree', 'where']]) {
    assert.match(verdict(key) ?? '', new RegExp(`has "${key}" \\(did you mean "${mapped}"\\?\\)`), key);
  }
  assert.equal(verdict('claim'), null);
  assert.equal(verdict('tilet'), null, 'two letters of the key out of place that are not neighbours is two edits');
});

test('the case, the one-letter and the swap rules are read alike in the angles shape, with a dry run, and by sources', () => {
  const root = loop();
  const angles = findingsFile([{ angle: 'first hour', surviving: [{ id: 'F1', title: 'a', Severity: 'minor' }] }]);
  assert.match(refuses(root, 'import', angles, '--source', 'r'), /finding "first-hour\/F1" has "Severity" \(did you mean "severity"\?\)/);
  const flat = findingsFile([{ id: 'F1', title: 'a', Claim: 'x' }]);
  assert.match(refuses(root, 'sources', flat, '--source', 'r'), /finding "F1" has "Claim" \(did you mean "claim"\?\)/);
  assert.equal(refuses(root, 'import', flat, '--source', 'r'), refuses(root, 'import', flat, '--source', 'r', '--dry-run'));
});

test('a refusal of the keys of a findings file says nothing was filed on import and says nothing of the kind on sources, and ends with the form of its own command', () => {
  const root = loop();
  const file = findingsFile([{ id: 'F1', title: 'a', clam: 'x' }]);
  const imported = refuses(root, 'import', file, '--source', 'r');
  assert.match(imported, / — nothing was filed\njarl\.mjs import "<findings\.json>" --dry-run --by "<who>"\n$/);
  const listed = refuses(root, 'sources', file, '--source', 'r');
  assert.doesNotMatch(listed, /nothing was filed/);
  assert.match(listed, /\njarl\.mjs sources "<findings\.json>"\n$/);
  const noId = findingsFile([{ title: 'no id' }]);
  assert.match(refuses(root, 'import', noId, '--source', 'r'), /finding #1 has no id.*nothing was filed/);
  assert.doesNotMatch(refuses(root, 'sources', noId, '--source', 'r'), /nothing was filed/);
});

test('import lists the extra keys it let through when it files, in the text, the JSON and a dry run, and not for a finding it does not file', () => {
  const root = loop();
  const file = findingsFile([
    { id: 'E-1', title: 'one', claim: 'x', verifier: 'checked', language: 'en' },
    { id: 'E-2', title: 'two', verifier: 'checked too' },
    { id: 'E-3', title: 'three' },
  ]);
  const dry = JSON.parse(jarl(root, 'import', file, '--source', 'r-extra', '--dry-run', '--json'));
  assert.deepEqual(dry.extras, [{ key: 'verifier', findings: ['E-1', 'E-2'] }, { key: 'language', findings: ['E-1'] }]);
  assert.match(jarl(root, 'import', file, '--source', 'r-extra', '--dry-run'), /^extra keys let through, not read: verifier \(2 findings\), language \(1 finding\)$/m);
  const text = jarl(root, 'import', file, '--source', 'r-extra', '--only', 'E-1');
  assert.match(text, /^extra keys let through, not read: verifier \(1 finding\), language \(1 finding\)$/m);
  const again = JSON.parse(jarl(root, 'import', file, '--source', 'r-extra', '--json'));
  assert.deepEqual(again.extras, [{ key: 'verifier', findings: ['E-2'] }], 'the finding filed before is not filed now, so its keys are not listed');
  assert.doesNotMatch(jarl(root, 'import', file, '--source', 'r-extra'), /extra keys/, 'nothing is filed, nothing is listed');
  const none = findingsFile([{ id: 'N-1', title: 'plain', claim: 'x' }]);
  assert.doesNotMatch(jarl(root, 'import', none, '--source', 'r-none'), /extra keys/);
});
