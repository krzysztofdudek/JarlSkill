// The table of the rules: every row names a test that exists and a guard whose text is still in its file. The red run of
// each guard is rule-guards.mjs, which is slow and run on its own; here the table itself is held.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RULES } from './rule-table.mjs';

const TESTS = new URL('./', import.meta.url);
const SCRIPTS = new URL('../', import.meta.url);

// The names of the tests a test file holds, read from its source: every test( followed by a plain string. A name built
// with ${} cannot be read here, so the table never names one.
function testNames(file) {
  const src = readFileSync(new URL(file, TESTS), 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/\btest\(\s*'((?:[^'\\]|\\.)*)'/g)) names.add(m[1].replace(/\\(['\\])/g, '$1'));
  return names;
}
const missingTests = (rows, namesOf) => rows.filter((r) => r.test !== undefined && !namesOf(r.file).has(r.test)).map((r) => r.id);

test('every rule of the table names a test that exists, and the table fails when one is missing', () => {
  const cache = new Map();
  const namesOf = (file) => { if (!cache.has(file)) cache.set(file, testNames(file)); return cache.get(file); };
  assert.deepEqual(missingTests(RULES, namesOf), []);
  const removed = (file) => { const names = new Set(namesOf(file)); names.delete(RULES.find((r) => r.file === file).test); return names; };
  const firstFile = RULES.find((r) => r.file).file;
  assert.deepEqual(missingTests(RULES.filter((r) => r.file === firstFile).slice(0, 1), removed), [RULES.find((r) => r.file === firstFile).id], 'a named test that is gone is reported');
});

test('every row has an id, says its rule, and either names a test and a guard or says why no behaviour can be tested', () => {
  const ids = new Set();
  for (const row of RULES) {
    assert.ok(typeof row.id === 'string' && /^[a-z0-9-]+$/.test(row.id), row.id);
    assert.ok(!ids.has(row.id), `id ${row.id} is listed once`);
    ids.add(row.id);
    assert.ok(typeof row.rule === 'string' && row.rule.trim(), row.id);
    if (row.reason !== undefined) assert.ok(row.test === undefined && row.guard === undefined && row.reason.trim(), row.id);
    else assert.ok(row.file && row.test && row.guard && row.guard.file && typeof row.guard.find === 'string' && row.guard.find && typeof row.guard.to === 'string', row.id);
  }
});

test('the text of every guard is still exactly once in its file', () => {
  for (const row of RULES.filter((r) => r.guard)) {
    const src = readFileSync(new URL(row.guard.file, SCRIPTS), 'utf8');
    const first = src.indexOf(row.guard.find);
    assert.ok(first !== -1, `${row.id}: the guard's text has left ${row.guard.file}: ${row.guard.find.slice(0, 60)}`);
    assert.equal(src.indexOf(row.guard.find, first + 1), -1, `${row.id}: the guard's text is not exactly once in ${row.guard.file}`);
  }
});
