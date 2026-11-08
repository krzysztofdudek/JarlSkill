// A ruling by the jarl or a coordinator may name the ruling in force it rests on, kept in the ruling's own text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { jarl, refuses, loop } from './helpers.mjs';
import { loadDecisions } from '../lib/journal.mjs';
import { holdsOwnersWords } from '../lib/owner.mjs';
import * as R from '../record.mjs';

const decisionsText = (root) => readFileSync(join(root, '.jarl', 'decisions.md'), 'utf8');

function mandate(root) {
  jarl(root, 'decide', 'standing-mandate', 'The jarl may choose between equal options.', '--by', 'owner', '--quote', 'You decide while I am away.');
}

test('decide --under keeps the ruling it rests on as the last paragraph of the ruling text', () => {
  const root = loop({ via: 'cli' });
  mandate(root);
  assert.match(jarl(root, 'decide', 'pick-a', 'Take option a.', '--by', 'jarl', '--under', 'standing-mandate'), /decided pick-a · by jarl · under standing-mandate/);
  assert.match(decisionsText(root), /\nTake option a\.\n\nMade under: standing-mandate\n\n\*\*By:\*\* jarl\n/);
  const d = loadDecisions(root).find((x) => x.slug === 'pick-a');
  assert.equal(d.under, 'standing-mandate');
  assert.equal(d.by, 'jarl');
  assert.equal(d.quote, null);
  assert.equal(loadDecisions(root).find((x) => x.slug === 'standing-mandate').under, null);
});

test('a ruling that names the ruling it rests on is shown with it by decisions, and by resume as a rule of the loop', () => {
  const root = loop({ via: 'cli' });
  mandate(root);
  jarl(root, 'decide', 'pick-a', 'Take option a.', '--under', 'standing-mandate', '--applies-to', 'loop', '--by', 'coordinator');
  assert.match(jarl(root, 'decisions'), /pick-a · by coordinator · under standing-mandate · applies to loop — Take option a\./);
  assert.match(jarl(root, 'decisions', '--live'), /pick-a · by coordinator · under standing-mandate/);
  assert.equal(JSON.parse(jarl(root, 'decisions', '--json')).find((x) => x.slug === 'pick-a').under, 'standing-mandate');
  assert.match(jarl(root, 'resume'), /\n- pick-a · loop · by coordinator · under standing-mandate — Take option a\./);
  assert.doesNotMatch(jarl(root, 'resume'), /standing-mandate · by owner · under/);
});

test('--under names a ruling in force, and anything else is refused with the rulings in force', () => {
  const root = loop({ via: 'cli' });
  mandate(root);
  jarl(root, 'decide', 'old-way', 'Do it the old way.', '--by', 'jarl');
  jarl(root, 'decide', 'new-way', 'Do it the new way.', '--by', 'jarl', '--supersedes', 'old-way');
  const before = decisionsText(root);
  assert.match(refuses(root, 'decide', 'x-1', 'Text.', '--by', 'jarl', '--under', 'no-such-ruling'), /--under "no-such-ruling" is not a ruling in force of this loop; the rulings in force: standing-mandate, new-way/);
  assert.match(refuses(root, 'decide', 'x-2', 'Text.', '--by', 'jarl', '--under', 'old-way'), /not a ruling in force.*standing-mandate, new-way/);
  assert.match(refuses(root, 'decide', 'x-3', 'Text.', '--by', 'jarl', '--under', 'old-way', '--supersedes', 'new-way'), /not a ruling in force/);
  assert.equal(decisionsText(root), before);
  assert.match(jarl(root, 'decide', 'x-4', 'Text.', '--by', 'jarl', '--under', 'new-way'), /under new-way/);
});

// An area ruling by the jarl, put to the owner at close and rejected by him.
function rejected(root, slug) {
  jarl(root, 'decide', slug, 'A rule for the area.', '--by', 'jarl', '--area', 'svc', '--reach', '3');
  const { ask } = JSON.parse(jarl(root, 'close', '--batch', '--json')).batch.items.find((i) => i.ruling === slug);
  assert.match(jarl(root, 'answer', ask, 'reject', '--by', 'owner'), new RegExp(`${slug} rejected`));
}

test('--under refuses an area ruling the owner rejected, and leaves it out of the rulings it names', () => {
  const root = loop({ via: 'cli' });
  mandate(root);
  rejected(root, 'area-rule');
  const before = decisionsText(root);
  assert.match(refuses(root, 'decide', 'x-1', 'Text.', '--by', 'jarl', '--under', 'area-rule'), /--under "area-rule" is not a ruling in force of this loop; the rulings in force: standing-mandate, ask-1\n/, 'the answer that rejected it is a ruling in force; the rejected one is not');
  assert.equal(decisionsText(root), before, 'nothing was written');
});

test('a ruling shown as made under another is marked when the one it names is superseded, rejected, an ended rule or no ruling of the loop', () => {
  const root = loop({ via: 'cli' });
  mandate(root);
  jarl(root, 'decide', 'pick-a', 'Take option a.', '--by', 'jarl', '--under', 'standing-mandate', '--applies-to', 'loop');
  rejected(root, 'area-rule');
  // Rulings written into the file outside decide: the marker is read whatever the slug names.
  const byHand = (slug, under) => `\n## 2026-01-01 · ${slug}\nWritten by hand.\n\n${under ? `Made under: ${under}\n\n` : ''}**Applies to:** loop${under ? '' : ' · until 2026-01-02'}\n**By:** jarl\n`;
  writeFileSync(join(root, '.jarl', 'decisions.md'), `${decisionsText(root)}${byHand('kept-rule', null)}${byHand('on-nothing', 'no-such-ruling')}${byHand('on-rejected', 'area-rule')}${byHand('on-ended', 'kept-rule')}`);
  assert.match(jarl(root, 'decisions'), /pick-a · by jarl · under standing-mandate · applies to loop — /, 'a ruling in force is shown as it was');
  jarl(root, 'decide', 'new-mandate', 'The jarl chooses only what is reversible.', '--by', 'owner', '--quote', 'Only what can be undone.', '--supersedes', 'standing-mandate');
  const shown = jarl(root, 'decisions');
  assert.match(shown, /pick-a · by jarl · under standing-mandate \(not in force: superseded by new-mandate\) · applies to loop/);
  assert.match(shown, /on-nothing · by jarl · under no-such-ruling \(not in force: no ruling of this loop\)/);
  assert.match(shown, /on-rejected · by jarl · under area-rule \(not in force: rejected by the owner\)/);
  assert.match(shown, /on-ended · by jarl · under kept-rule \(not in force: a rule that has ended\)/);
  assert.match(jarl(root, 'resume'), /\n- pick-a · loop · by jarl · under standing-mandate \(not in force: superseded by new-mandate\) — Take option a\./, 'resume marks it in the rule it prints');
  const rows = JSON.parse(jarl(root, 'decisions', '--json'));
  assert.equal(rows.find((d) => d.slug === 'pick-a').underNotInForce, 'superseded by new-mandate');
  assert.equal(rows.find((d) => d.slug === 'on-nothing').underNotInForce, 'no ruling of this loop');
  assert.equal(rows.find((d) => d.slug === 'kept-rule').underNotInForce, undefined, 'a ruling that names none carries no mark');
  const live = JSON.parse(jarl(root, 'resume', '--json')).rulings;
  assert.equal(live.find((d) => d.slug === 'pick-a').underNotInForce, 'superseded by new-mandate');
});

test('--under refuses a rule that has ended, by its date or by its issue closing, and leaves it out of the rulings it names', () => {
  const root = loop({ via: 'cli' });
  mandate(root);
  jarl(root, 'new', 'the work the rule is for', '--acceptance', 'it works');
  jarl(root, 'decide', 'issue-rule', 'Run the long check on this issue.', '--by', 'jarl', '--under', 'standing-mandate', '--applies-to', 'loop', '--until', '1');
  jarl(root, 'decide', 'live-rule', 'Run the short check everywhere.', '--by', 'jarl', '--under', 'standing-mandate', '--applies-to', 'loop');
  writeFileSync(join(root, '.jarl', 'decisions.md'), `${decisionsText(root)}\n## 2026-01-01 · dated-rule\nWritten by hand.\n\n**Applies to:** loop · until 2026-01-02\n**By:** jarl\n`);
  jarl(root, 'set', '1', 'dropped', 'not needed');
  const before = decisionsText(root);
  for (const ended of ['issue-rule', 'dated-rule']) {
    const said = refuses(root, 'decide', 'x-1', 'Text.', '--by', 'jarl', '--under', ended);
    assert.match(said, new RegExp(`--under "${ended}" is not a ruling in force of this loop; the rulings in force: standing-mandate, live-rule\\n`), `${ended}: refused, and the list holds only the rulings in force`);
    assert.match(said, /--under "<a-ruling-in-force>"/, `${ended}: the refusal ends with the form`);
  }
  assert.equal(decisionsText(root), before, 'nothing was written');
  assert.match(jarl(root, 'decide', 'x-2', 'Text.', '--by', 'jarl', '--under', 'live-rule'), /under live-rule/, 'a rule that holds is taken');
});

test('--under on a loop with no ruling in force is refused and says there is none', () => {
  const root = loop({ via: 'cli' });
  assert.match(refuses(root, 'decide', 'x-1', 'Text.', '--under', 'standing-mandate', '--by', 'coordinator'), /the rulings in force: \(none\)/);
});

test('a ruling by the owner takes no --under, and a malformed one is refused', () => {
  const root = loop({ via: 'cli' });
  mandate(root);
  assert.match(refuses(root, 'decide', 'x-1', 'Text.', '--by', 'owner', '--quote', 'Fine.', '--under', 'standing-mandate'), /a ruling by the owner rests on his own words/);
  assert.match(refuses(root, 'decide', 'x-2', 'Text.', '--by', 'jarl', '--under', 'a b'), /not a ruling in force/);
  assert.match(refuses(root, 'decide', 'x-3', 'Text.', '--by', 'jarl', '--under', 'The owner\'s words: "x"'), /holds "The owner's words:"/);
  assert.equal(loadDecisions(root).length, 1);
});

test('the marker cannot be forged from the ruling text, which is indented, nor read as the owner\'s words', () => {
  const root = loop({ via: 'cli' });
  mandate(root);
  jarl(root, 'decide', 'x-1', 'First line.\n\nMade under: standing-mandate', '--by', 'jarl');
  assert.equal(loadDecisions(root).find((x) => x.slug === 'x-1').under, null);
  jarl(root, 'decide', 'x-2', 'Made under: standing-mandate', '--by', 'jarl');
  assert.equal(loadDecisions(root).find((x) => x.slug === 'x-2').under, null);
  assert.equal(holdsOwnersWords('Made under: standing-mandate'), false);
  writeFileSync(join(root, '.jarl', 'decisions.md'), `${decisionsText(root)}\n## 2026-11-03 · x-3\nHis.\n\nThe owner's words: "Yes."\n\nMade under: standing-mandate\n\n**By:** owner\n`);
  const d = loadDecisions(root).find((x) => x.slug === 'x-3');
  assert.equal(d.under, null);
  assert.equal(d.quote, null);
});

test('a ruling that names the ruling it rests on can settle issues and is read as plain text by its closing block', () => {
  const root = loop({ via: 'cli' });
  mandate(root);
  jarl(root, 'new', 'thing');
  jarl(root, 'decide', 'pick-a', 'Take option a.', '--by', 'jarl', '--under', 'standing-mandate', '--settles', '1');
  assert.match(jarl(root, 'show', '1'), /Ruling pick-a \(by jarl\): Take option a\./);
  assert.match(decisionsText(root), /Made under: standing-mandate\n\n\*\*Settles:\*\* 1\n\*\*By:\*\* jarl\n/);
  assert.equal(loadDecisions(root).find((x) => x.slug === 'pick-a').under, 'standing-mandate');
});

test('the record library takes the ruling it rests on and returns it', () => {
  const root = loop({ via: 'library' });
  R.decide(root, 'standing-mandate', 'Mandate.', { by: 'owner', quote: 'Go.' });
  const out = R.decide(root, 'pick-a', 'Take a.', { by: 'jarl', under: 'standing-mandate' });
  assert.equal(out.under, 'standing-mandate');
  assert.equal(R.decisions(root, { live: true }).find((x) => x.slug === 'pick-a').under, 'standing-mandate');
  assert.throws(() => R.decide(root, 'pick-b', 'Take b.', { by: 'jarl', under: 'nothing' }), /not a ruling in force/);
});
