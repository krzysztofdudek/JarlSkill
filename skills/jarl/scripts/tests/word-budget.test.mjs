// The words an agent must read, held per role: a raised agent reads its brief, whose caps its own tests hold, and only a
// director reads the skill. The numbers are the budgets the guidance is written to; they fail the suite the moment a file
// grows past them, so a new paragraph has to pay for its words by removing others.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SKILL_DIR, skillText } from './helpers.mjs';

const words = (text) => text.split(/\s+/).filter(Boolean).length;
const count = (file) => words(skillText(file));
// What a director reads, and the two references a director reads when the subject comes up.
const BUDGETS = { 'SKILL.md': 1200, 'references/jarl.md': 2500, 'references/repositories.md': 1500, 'references/models.md': 1000 };
// The guidance a director pays for in whole: the entry file, the director's reference, what is left of the
// role references, and the page on building on the record.
const DIRECTOR_SET = ['SKILL.md', 'references/jarl.md', 'references/composers.md'];
const DIRECTOR_SET_LIMIT = 5000;

for (const [file, limit] of Object.entries(BUDGETS)) {
  test(`${file} stays within its budget of ${limit} words`, () => {
    assert.ok(count(file) <= limit, `${file} has ${count(file)} words, over ${limit}`);
  });
}

test(`the director's guidance, the entry file and the reference and the page on building on the record, stays within ${DIRECTOR_SET_LIMIT} words together`, () => {
  const total = DIRECTOR_SET.reduce((n, f) => n + count(f), 0);
  assert.ok(total <= DIRECTOR_SET_LIMIT, `the set holds ${total} words, over ${DIRECTOR_SET_LIMIT}`);
});

test('a raised agent has no role reference to read: its brief is its whole text, and SKILL.md says so', () => {
  const references = readdirSync(join(SKILL_DIR, 'references'));
  for (const gone of ['worker.md', 'reviewer.md', 'merger.md']) assert.ok(!references.includes(gone), `${gone} is a role reference, and the brief replaces it`);
  assert.match(skillText('SKILL.md'), /You were raised to do one job[^\n]*The brief you were given is everything you read/);
});
