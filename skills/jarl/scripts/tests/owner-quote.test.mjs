// A ruling recorded as the owner's carries his own words; a ruling by another name never takes them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { jarl, refuses, loop, run } from './helpers.mjs';
import { loadDecisions } from '../lib/journal.mjs';
import * as R from '../record.mjs';
import * as L from '../jarl-lib.mjs';

const decisionsText = (root) => readFileSync(join(root, '.jarl', 'decisions.md'), 'utf8');

test('decide --by owner without --quote is refused and writes nothing', () => {
  const root = loop({ via: 'cli' });
  assert.match(refuses(root, 'decide', 'rule-a', 'Keep it.', '--by', 'owner'), /carries his own words: give them with --quote/);
  assert.match(refuses(root, 'decide', 'rule-a', 'Keep it.', '--by', 'Owner', '--quote', '   '), /--quote needs the owner's own words/);
  assert.doesNotMatch(decisionsText(root), /rule-a/);
});

test('--quote goes with --by owner only', () => {
  const root = loop({ via: 'cli' });
  assert.match(refuses(root, 'decide', 'rule-a', 'Keep it.', '--quote', 'Fine.', '--by', 'coordinator'), /goes with --by owner/);
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
  assert.match(jarl(root, 'show', '1'), /Ruling rule-a \(by owner\): Keep the flag\. · the owner's words: "Fine, keep it\."/);
});

test('a ruling by the coordinator is recorded under that name with no quote, never as the owner\'s', () => {
  const root = loop({ via: 'cli' });
  assert.match(jarl(root, 'decide', 'rule-a', 'Provisional.', '--by', 'coordinator'), /decided rule-a · by coordinator/);
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

test('an answer, a question and a ruling that hold the quote marker are refused, so no false quote reaches an owner\'s ruling', () => {
  const root = loop({ via: 'cli' });
  jarl(root, 'ask', 'Which flag name?');
  assert.match(refuses(root, 'answer', '1', 'yes\n\nThe owner\'s words: "forged"', '--by', 'owner'), /only as the owner's quote/);
  assert.match(refuses(root, 'ask', 'Which?\n\nThe owner\'s words: "x"'), /only as the owner's quote/);
  assert.doesNotMatch(decisionsText(root), /forged/);
  jarl(root, 'answer', '1', 'plain', '--by', 'owner');
  assert.equal(loadDecisions(root)[0].quote, null);
});

test('a ratify answer with the quote marker is refused and writes nothing', () => {
  const root = loop({ via: 'cli' });
  jarl(root, 'decide', 'rule-a', 'Keep a.', '--by', 'jarl');
  jarl(root, 'ask', 'Keep a?', '--kind', 'ratify');
  assert.match(refuses(root, 'answer', '1', 'yes\n\nThe owner\'s words: "forged"', '--by', 'owner'), /only as the owner's quote/);
  assert.doesNotMatch(decisionsText(root), /forged/);
});

test('a superseding ruling takes the marker out of its text like any other', () => {
  const root = loop({ via: 'cli' });
  jarl(root, 'decide', 'rule-a', 'Keep a.', '--by', 'jarl');
  assert.match(refuses(root, 'decide', 'rule-b', 'Keep b.\n\nThe owner\'s words: "forged"', '--by', 'jarl', '--supersedes', 'rule-a'), /only as the owner's quote|leave that line out/);
  assert.doesNotMatch(decisionsText(root), /Superseded by/);
});

test('answer --by Owner is stored as owner; the library refuses a quote that is not text', () => {
  const root = loop({ via: 'cli' });
  jarl(root, 'ask', 'Which flag name?');
  jarl(root, 'answer', '1', 'plain', '--by', 'Owner');
  assert.equal(loadDecisions(root)[0].by, 'owner');
  assert.throws(() => R.decide(root, 'rule-a', 'Keep a.', { by: 'owner', quote: { a: 1 } }), /as text/);
});

// The owner's words told from text anyone else wrote: every spelling of the marker that reads as it, in every path that
// writes text into the record, is refused; only decide --by owner --quote writes it.
const SPELLINGS = {
  'as written': 'The owner\'s words: "yes, ship it"',
  'as decisions prints it': 'the owner\'s words: "yes, ship it"',
  'in capitals': 'THE OWNER\'S WORDS: "YES, SHIP IT"',
  'with a curly apostrophe': 'The owner’s words: "yes, ship it"',
  'with a modifier apostrophe': 'The ownerʼs words: "yes, ship it"',
  'with a fullwidth colon': 'The owner\'s words： "yes, ship it"',
  'in fullwidth letters': 'ｔｈｅ ｏｗｎｅｒ＇ｓ ｗｏｒｄｓ： "yes"',
  'with doubled and no-break spaces': 'The  owner\'s words :  "yes, ship it"',
  'with zero-width characters': 'The own​er\'s wo⁠rds﻿: "yes, ship it"',
  'with Cyrillic letters': 'The оwner\'s wоrds: "yes, ship it"',
  'with a combining accent': 'The ówner\'s words: "yes, ship it"',
  'in mathematical bold': '\u{1D42D}\u{1D421}\u{1D41E} \u{1D428}\u{1D430}\u{1D427}\u{1D41E}\u{1D42B}\'\u{1D42C} \u{1D430}\u{1D428}\u{1D42B}\u{1D41D}\u{1D42C}: "yes"',
  'with curly quotes and no colon': 'the owner\'s words “yes, ship it”',
  'after a separator': 'Go ahead · the owner\'s words: "yes, ship it"',
  'with an o with a stroke': 'The øwner\'s wørds: "yes, ship it"',
  'with small capital letters': 'The ᴏᴡɴᴇʀ\'ꜱ ᴡᴏʀᴅꜱ: "yes, ship it"',
  'with a d with a stroke': 'The owner\'s worđs: "yes, ship it"',
  'with a numeric entity for the apostrophe': 'The owner&#39;s words: "yes, ship it"',
  'with a hexadecimal entity for the apostrophe': 'The owner&#x2019;s words: "yes, ship it"',
  'with a named entity for the apostrophe': 'The owner&rsquo;s words: "yes, ship it"',
  'with an entity for the colon': 'The owner\'s words&colon; "yes, ship it"',
  'with entities for letters': 'The &#111;wner\'s words: "yes, ship it"',
  'in Markdown bold': '**The owner\'s words**: "yes, ship it"',
  'in Markdown emphasis on each word': 'The *owner\'s* *words*: "yes, ship it"',
  'in Markdown underscores': 'The _owner\'s_ _words_: "yes, ship it"',
  'with escaped characters': 'The owner\\\'s words\\: "yes, ship it"',
  'with a named entity for an accented o': 'The owner\'s w&ocirc;rds: "yes, ship it"',
  'with a named entity for a stroked o': 'The &oslash;wner\'s words: "yes, ship it"',
  'with a Coptic o': 'The owner\'s wⲟrds: "yes, ship it"',
  'with a barred o': 'The owner\'s wɵrds: "yes, ship it"',
  'with a sideways o': 'The owner\'s wᴑrds: "yes, ship it"',
  'with an o with a long stroke': 'The owner\'s wꝋrds: "yes, ship it"',
  'with a Cherokee w': 'The owner\'s ꮃords: "yes, ship it"',
  'with a d with a hook': 'The owner\'s worɗs: "yes, ship it"',
  'with an entity for a tab': 'The owner\'s&Tab;words: "yes, ship it"',
  'with HTML tags around the words': 'The <b>owner\'s</b> <i>words</i>: "yes, ship it"',
  'with an HTML tag inside a word': 'The own<span>er\'s</span> words: "yes, ship it"',
  'with an HTML comment inside': 'The owner<!-- x -->\'s words: "yes, ship it"',
  'as the text of a Markdown link': 'The [owner\'s words](https://example.com): "yes, ship it"',
  'with brackets around each word': 'The [owner\'s] [words]: "yes, ship it"',
  'with single quotation marks and no colon': 'The owner\'s words \'yes, ship it\'',
  'with corner quotation marks and no colon': 'The owner\'s words 「yes, ship it」',
  'in the singular with a colon and a quotation mark': 'The owner\'s word: "yes, ship it"',
  'in the singular, own, with a colon and a quotation mark': 'The owner\'s own word: "yes, ship it"',
  'in the singular with a curly quotation mark and no colon': 'the owner\'s word “yes, ship it”',
  'in the singular with single quotation marks': 'The owner\'s word: \'yes, ship it\'',
};
const REFUSED = /the record keeps only as the owner's quote/;

for (const [name, marker] of Object.entries(SPELLINGS)) {
  test(`the marker ${name} is refused in every path that writes text, and nothing is written`, () => {
    const root = loop();
    R.newIssue(root, 'thing');
    R.ask(root, 'Which flag?');
    const files = () => ['decisions.md', 'log.md', 'asks.md', 'issues/001-thing.md'].map((f) => { try { return readFileSync(join(root, '.jarl', f), 'utf8'); } catch { return ''; } }).join('\n=====\n');
    const before = files();
    const tries = {
      'decide by jarl': () => R.decide(root, 'r1', `Ruling.\n\n${marker}`, { by: 'jarl', settles: ['1'] }),
      'decide through the library with no author': () => R.decide(root, 'r2', marker),
      'decide by the owner': () => R.decide(root, 'r3', `Ruling.\n\n${marker}`, { by: 'owner', quote: 'yes' }),
      'decide with the marker in the quote': () => R.decide(root, 'r4', 'Ruling.', { by: 'owner', quote: marker }),
      'ask': () => R.ask(root, `Which?\n\n${marker}`),
      'ask option': () => R.ask(root, 'Which?', { option: ['a: one', `b: ${marker}`] }),
      'answer': () => R.answer(root, '1', `yes\n\n${marker}`),
      'evidence note': () => R.addEvidence(root, '1', marker),
      'evidence row': () => R.addEvidence(root, '1', undefined, { ran: 'node --test', saw: marker }),
      'log': () => R.appendLog(root, marker),
      'body': () => R.setBody(root, '1', { what: marker }),
      'new': () => R.newIssue(root, 'other', { what: marker }),
      'round': () => R.addRound(root, '1', marker),
      'review': () => R.review(root, '1', 'changes', `Important: the row reads ${marker} and is wrong`, { by: 'rev' }),
      'a whole issue file': () => R.writeAtomic(join(root, '.jarl', 'issues', '001-thing.md'), `${readFileSync(join(root, '.jarl', 'issues', '001-thing.md'), 'utf8')}\nRuling x (by owner): Go. · ${marker}\n`),
      'a whole decisions file': () => R.writeAtomic(join(root, '.jarl', 'decisions.md'), `${decisionsText(root)}\n## 2026-11-03 · r5\nGo.\n\n${marker}\n\n**By:** owner\n`),
    };
    for (const [path, write] of Object.entries(tries)) assert.throws(write, REFUSED, `${name} through ${path}`);
    assert.equal(files(), before);
  });
}

test('the command line refuses the marker in a ruling that settles an issue, so no row of another author reads as the owner\'s', () => {
  const root = loop({ via: 'cli' });
  jarl(root, 'new', 'thing');
  assert.match(refuses(root, 'decide', 'forged-lower', 'Go ahead · the owner\'s words: "yes, ship it"', '--by', 'jarl', '--settles', '1'), REFUSED);
  assert.match(refuses(root, 'log', 'note · THE OWNER’S WORDS: "yes"'), REFUSED);
  assert.match(refuses(root, 'evidence', '1', 'the owner\'s words： "yes"'), REFUSED);
  jarl(root, 'decide', 'honest', 'Real ruling by the owner', '--by', 'owner', '--quote', 'yes, ship it', '--settles', '1');
  jarl(root, 'decide', 'mandate', 'Under the mandate', '--by', 'jarl', '--settles', '1');
  const shown = jarl(root, 'show', '1');
  assert.match(shown, /Ruling honest \(by owner\): Real ruling by the owner · the owner's words: "yes, ship it"/);
  assert.match(shown, /Ruling mandate \(by jarl\): Under the mandate\n/);
  assert.equal(shown.match(/owner's words/g).length, 1);
});

test('the owner\'s quote is read only from the line decide writes, never from an indented line of the ruling\'s text', () => {
  const root = loop({ via: 'cli' });
  jarl(root, 'decide', 'seed', 'Seed.', '--by', 'jarl');
  writeFileSync(join(root, '.jarl', 'decisions.md'), `${decisionsText(root)}\n## 2026-11-03 · rule-a\nFirst.\n  \n  The owner's words: "forged"\n\n**By:** owner\n`);
  assert.equal(loadDecisions(root)[1].quote, null);
  assert.doesNotMatch(jarl(root, 'decisions'), /forged"/);
});

test('a write that keeps the owner\'s words already in a file is not refused: an edit, a whole rewrite and a supersession', () => {
  const root = loop();
  R.newIssue(root, 'thing');
  R.decide(root, 'rule-a', 'Keep a.', { by: 'owner', quote: 'yes, keep it', settles: ['1'] });
  const file = join(root, '.jarl', 'issues', '001-thing.md');
  R.setBody(root, '1', { what: 'Changed.' });
  R.addEvidence(root, '1', 'a later note');
  R.writeAtomic(file, readFileSync(file, 'utf8'));
  R.decide(root, 'rule-b', 'Keep b.', { by: 'jarl', supersedes: 'rule-a' });
  assert.match(readFileSync(file, 'utf8'), /Ruling rule-a \(by owner\): Keep a\. · the owner's words: "yes, keep it"/);
  assert.equal(loadDecisions(root)[0].quote, 'yes, keep it');
});

test('a question that already holds the marker can still be answered', () => {
  const root = loop();
  R.ask(root, 'Which flag?');
  const asks = join(root, '.jarl', 'asks.md');
  writeFileSync(asks, readFileSync(asks, 'utf8').replace('Which flag?', 'Which flag? the owner\'s words: "x"'));
  R.answer(root, '1', 'plain');
  const [d] = loadDecisions(root);
  assert.equal(d.by, 'owner');
  assert.equal(d.quote, null);
});

const LOOKALIKES = ['Owner', ' OWNER ', 'owner ', 'оwner', 'own​er', 'ｏｗｎｅｒ', '0wner', 'the owner', 'ówner'];

test('a --by that reads as owner is the owner: his ruling needs his words and is stored as owner', () => {
  for (const by of LOOKALIKES) {
    const root = loop();
    assert.throws(() => R.decide(root, 'rule-a', 'Keep it.', { by }), /carries his own words/, JSON.stringify(by));
    R.decide(root, 'rule-a', 'Keep it.', { by, quote: 'fine' });
    const [d] = loadDecisions(root);
    assert.equal(d.by, 'owner', JSON.stringify(by));
    assert.equal(d.quote, 'fine', JSON.stringify(by));
  }
});

test('an answer --by that reads as owner is stored as owner', () => {
  const root = loop({ via: 'cli' });
  jarl(root, 'ask', 'Which flag?');
  jarl(root, 'answer', '1', 'plain', '--by', 'оwner');
  assert.equal(loadDecisions(root)[0].by, 'owner');
  jarl(root, 'decide', 'rule-a', 'Keep it.', '--by', 'оwner ', '--quote', 'fine');
  assert.equal(loadDecisions(root)[1].by, 'owner');
});

test('a --by that holds the owner\'s name inside another is refused, and so is one that is not text', () => {
  const root = loop();
  for (const by of ['co-owner', 'owner (Krzysztof)', 'jarl) (by owner', 'the оwner\'s proxy']) {
    assert.throws(() => R.decide(root, 'rule-a', 'Keep it.', { by }), /reads as the owner/, by);
  }
  R.ask(root, 'Which?');
  assert.throws(() => L.cmdAnswer(root, '1', 'plain', { by: 'co-owner' }), /reads as the owner/);
  assert.throws(() => R.decide(root, 'rule-a', 'Keep it.', { by: ['owner'], quote: 'fine' }), /as text/);
  assert.throws(() => L.cmdAnswer(root, '1', 'plain', { by: ['owner'] }), /as text/);
  assert.deepEqual(loadDecisions(root), []);
});

test('a note that carries the owner\'s quote is retracted by the owner or anyone else, and a retraction never lets a new quote in', () => {
  for (const by of ['owner', 'jarl']) {
    const root = loop({ via: 'cli' });
    jarl(root, 'new', 'thing');
    jarl(root, 'decide', 'rule-a', 'Keep the flag.', '--by', 'owner', '--quote', 'Fine, keep it.', '--settles', '1');
    const issue = L.findIssue(root, '1').file;
    assert.match(readFileSync(issue, 'utf8'), /^Ruling rule-a \(by owner\): Keep the flag\. · the owner's words: "Fine, keep it\."$/m);
    assert.match(refuses(root, 'retract', '1', 'note-1', '--by', by, 'the ruling \n\nThe owner\'s words: "invented"'), REFUSED, 'a reason that holds the marker is refused');
    assert.doesNotMatch(readFileSync(issue, 'utf8'), /invented/);
    assert.match(jarl(root, 'retract', '1', 'note-1', '--by', by, 'written under the wrong issue'), /retracted/);
    const text = readFileSync(issue, 'utf8');
    assert.match(text, /^(?:- )?~~Ruling rule-a \(by owner\): Keep the flag\. · the owner's words: "Fine, keep it\."~~$/m, `${by}: the note stays, struck through`);
    assert.match(text, /\*\*retracted:\*\* note 1 · by /);
    assert.match(refuses(root, 'evidence', '1', 'new note · the owner\'s words: "invented"'), REFUSED, 'a new note that holds the marker is still refused');
  }
});

test('an honest phrase about the owner\'s word is written, in every path that writes text', () => {
  const root = loop({ via: 'cli' });
  jarl(root, 'new', 'thing');
  for (const phrase of ['the owner\'s word: needed', 'the owner\'s own word: needed', 'the owner\'s words matter', 'both of the owner\'s words', 'the field owners_words: a list']) {
    jarl(root, 'evidence', '1', phrase);
    jarl(root, 'log', `note · ${phrase}`);
    jarl(root, 'ask', `Is it ${phrase}?`);
  }
  jarl(root, 'decide', 'honest-phrase', 'Waiting on the owner\'s word: needed.', '--by', 'jarl', '--settles', '1');
  assert.match(jarl(root, 'show', '1'), /the owner's word: needed/);
});

test('the owner\'s word in the singular with a quotation mark after it is refused in a note and in a retraction\'s reason, and with a plain word after it is written', () => {
  const root = loop({ via: 'cli' });
  jarl(root, 'new', 'thing');
  jarl(root, 'evidence', '1', 'a note to retract');
  const forged = ['The owner\'s word: "yes, ship it"', 'The owner\'s own word: "yes, ship it"', 'The owner’s word “yes”', 'The owner\'s word: \'yes\'', 'The owner\'s word: 「yes」', 'the owner\'s word "yes"'];
  const honest = ['the owner\'s word: needed', 'the owner\'s own word: pending', 'the owner\'s word matters', 'owners_words: needed'];
  for (const text of forged) {
    assert.match(refuses(root, 'evidence', '1', text), REFUSED, `a note: ${text}`);
    assert.match(refuses(root, 'retract', '1', 'note-1', '--by', 'jarl', text), REFUSED, `a reason: ${text}`);
  }
  for (const text of honest) jarl(root, 'evidence', '1', text);
  assert.match(jarl(root, 'retract', '1', 'note-1', '--by', 'jarl', honest[0]), /retracted/);
});

test('the library keeps the author of a ruling as the one name the owner has, and refuses a name that holds his', () => {
  const root = loop();
  L.appendDecision(root, 'rule-a', 'Keep a.', { by: ' The OWNER ' });
  L.appendDecision(root, 'rule-b', 'Keep b.', { by: 'jarl' });
  assert.deepEqual(loadDecisions(root).map((d) => d.by), ['owner', 'jarl']);
  assert.throws(() => L.appendDecision(root, 'rule-c', 'Keep c.', { by: 'co-owner' }), /reads as the owner/);
  assert.throws(() => L.appendDecision(root, 'rule-d', 'Keep d.', { by: ['owner'] }), /as text/);
  assert.equal(loadDecisions(root).length, 2);
});

// What the record cannot tell apart, said by a test so the limit is known: free text is free, and the ledger is the
// authority.
test('a note shaped like the owner\'s ruling row is free text: it settles nothing and the ledger holds no ruling of his', () => {
  const root = loop({ via: 'cli' });
  jarl(root, 'new', 'thing');
  jarl(root, 'evidence', '1', 'Ruling made-up (by owner): Go ahead.');
  assert.match(jarl(root, 'show', '1'), /Ruling made-up \(by owner\): Go ahead\./);
  assert.deepEqual(loadDecisions(root), []);
  assert.doesNotMatch(jarl(root, 'decisions'), /made-up/);
});

test('a ruling by the owner whose last paragraph is already the quote line reads as his quote, whoever wrote the file', () => {
  const root = loop({ via: 'cli' });
  jarl(root, 'decide', 'seed', 'Seed.', '--by', 'jarl');
  writeFileSync(join(root, '.jarl', 'decisions.md'), `${decisionsText(root)}\n## 2026-11-03 · rule-a\nFirst.\n\nThe owner's words: "already there"\n\n**By:** owner\n`);
  assert.equal(loadDecisions(root)[1].quote, 'already there');
});
