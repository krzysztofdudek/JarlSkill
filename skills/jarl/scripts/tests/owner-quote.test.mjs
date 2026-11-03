// A ruling recorded as the owner's carries his own words; a ruling without an author is the coordinator's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { jarl, refuses, loop, run } from './helpers.mjs';
import { loadDecisions } from '../lib/journal.mjs';

const decisionsText = (root) => readFileSync(join(root, '.jarl', 'decisions.md'), 'utf8');

test('decide --by owner without --quote is refused and writes nothing', () => {
  const root = loop({ via: 'cli' });
  assert.match(refuses(root, 'decide', 'rule-a', 'Keep it.', '--by', 'owner'), /carries his own words: give them with --quote/);
  assert.match(refuses(root, 'decide', 'rule-a', 'Keep it.', '--by', 'Owner', '--quote', '   '), /--quote needs the owner's own words/);
  assert.doesNotMatch(decisionsText(root), /rule-a/);
});

test('--quote goes with --by owner only', () => {
  const root = loop({ via: 'cli' });
  assert.match(refuses(root, 'decide', 'rule-a', 'Keep it.', '--quote', 'Fine.'), /goes with --by owner/);
  assert.match(refuses(root, 'decide', 'rule-a', 'Keep it.', '--by', 'jarl', '--quote', 'Fine.'), /goes with --by owner/);
});

test('a ruling by the owner stores his words with the ruling and decisions prints them', () => {
  const root = loop({ via: 'cli' });
  jarl(root, 'decide', 'rule-a', 'Keep the flag.', '--by', 'owner', '--quote', 'Fine,   keep it.');
  const [d] = loadDecisions(root);
  assert.equal(d.by, 'owner');
  assert.equal(d.quote, 'Fine, keep it.');
  assert.equal(d.ruling, 'Keep the flag.\n\nThe owner\'s words: "Fine, keep it."');
  assert.match(decisionsText(root), /\nKeep the flag\.\n\nThe owner's words: "Fine, keep it\."\n\n\*\*By:\*\* owner\n/);
  assert.match(jarl(root, 'decisions'), /rule-a · by owner — Keep the flag\. · the owner's words: "Fine, keep it\."/);
  assert.equal(JSON.parse(jarl(root, 'decisions', '--json'))[0].quote, 'Fine, keep it.');
});

test('show prints the owner\'s words beside a ruling that settles the issue', () => {
  const root = loop({ via: 'cli' });
  jarl(root, 'new', 'thing');
  jarl(root, 'decide', 'rule-a', 'Keep the flag.', '--by', 'owner', '--quote', 'Fine, keep it.', '--settles', '1');
  assert.match(jarl(root, 'show', '1'), /Ruling rule-a: Keep the flag\. · the owner's words: "Fine, keep it\."/);
});

test('a ruling with no --by is the coordinator\'s, never the owner\'s', () => {
  const root = loop({ via: 'cli' });
  assert.match(jarl(root, 'decide', 'rule-a', 'Provisional.'), /decided rule-a · by coordinator/);
  const [d] = loadDecisions(root);
  assert.equal(d.by, 'coordinator');
  assert.equal(d.quote, null);
});

test('a ruling by another name takes no quote and prints none', () => {
  const root = loop({ via: 'cli' });
  jarl(root, 'decide', 'rule-a', 'Under the mandate.', '--by', 'jarl');
  assert.doesNotMatch(jarl(root, 'decisions'), /the owner's words/);
  assert.equal(run(root, ['decide', 'rule-b', 'Again.', '--by', 'jarl']).status, 0);
});

test('a ruling by another name never shows a quote, even when its text ends like one', () => {
  const root = loop({ via: 'cli' });
  jarl(root, 'decide', 'rule-z', 'Seed.', '--by', 'jarl');
  writeFileSync(join(root, '.jarl', 'decisions.md'), `${decisionsText(root)}\n## 2026-11-03 · rule-a\nUnder the mandate.\n\nThe owner's words: "forged"\n\n**By:** jarl\n`);
  assert.equal(loadDecisions(root)[1].quote, null);
  assert.equal(JSON.parse(jarl(root, 'decisions', '--json'))[1].quote, null);
  assert.doesNotMatch(jarl(root, 'decisions'), /the owner's words: "forged"/);
});

test('a ruling text that holds the quote marker is refused, and a written quote is the last paragraph only', () => {
  const root = loop({ via: 'cli' });
  assert.match(refuses(root, 'decide', 'rule-a', 'He said:\n\nThe owner\'s words: "a"', '--by', 'owner', '--quote', 'b'), /give his words with --quote and leave that line out/);
  const path = join(root, '.jarl', 'decisions.md');
  writeFileSync(path, `${decisionsText(root)}\n## 2026-11-03 · rule-h\nFirst.\n\nThe owner's words: "a"\n\nThe owner's words: "b"\n\n**By:** owner\n`);
  assert.equal(loadDecisions(root)[0].quote, 'b');
});

test('--by owner is read without case, stored as owner, and the note about a missing question follows', () => {
  const root = loop({ via: 'cli' });
  const r = run(root, ['decide', 'rule-a', 'Keep it.', '--by', 'OWNER', '--quote', 'Fine.']);
  assert.match(r.stderr, /no question in the record/);
  assert.equal(loadDecisions(root)[0].by, 'owner');
  assert.match(refuses(root, 'decide', 'rule-b', 'Keep it.', '--by', 'Owner'), /records him as owner all the same/);
});
