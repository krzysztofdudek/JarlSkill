// The tense of the texts: Jarl is described only as it is now. Every text a reader or an agent meets names no version,
// no other Jarl, no plan for a release still to come and no second name for a command, calls the owner by his role, and
// holds no task by number. The surfaces are the skill, its references, README.md and CLAUDE.md; the help, the usage, the command
// summaries, the tool descriptions, the server's instructions and the notes the commands print, read from the command
// table, the tool list and the server; the comments of the scripts; and the comments and the titles of the tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMAND_SUMMARY, USAGE } from '../jarl.mjs';
import { buildTools, handle } from '../jarl-mcp.mjs';

const SKILL = fileURLToPath(new URL('../../', import.meta.url));
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPTS = fileURLToPath(new URL('../', import.meta.url));
const TESTS = fileURLToPath(new URL('./', import.meta.url));

// Each family of words, with the name the failure gives it.
const TENSE_FLAGS = [
  [/\b\d+\.\d+(?:\.\d+)?\b|\b\d+\.x\b|\bv\d+(?:\.\d+)*\b|\bv[NX]\b|\b[NX]\.[NY](?:\.[NZ])?\b/, 'a version number or a version-shaped token'],
  [/\b(?:older|no longer|new in|used to|legacy|retire[ds]?|backward|compatib(?:le|ility)|migrat(?:e|es|ed|ing)|formerly|predates?|upgrad(?:e|es|ed|ing) from|previous (?:version|release|jarl|format|skill|reader)|earlier (?:version|release|jarl|reader|skill|format)|before this release|(?:later|next|following|future) (?:release|version)|the old (?:way|name|form|flag|version|release|reader|command|spelling)|old (?:name|form|flag|version|release|reader|command|spelling))\b/i, 'a word of history or a plan for a later release'],
  [/\bsince (?:the (?:last )?)?(?:release|version|tag|jarl|v?\d)/i, 'since, told as history'],
  [/\bthe user(?:'s)?\b/i, 'the user, for the owner who rules'],
  [/\balias(?:es|ed)? (?:tools?|commands?|flags?|names?|of)\b|\b(?:tool|command|flag|verb) aliases?\b/i, 'an alias of a command or a flag'],
  [/\((?:issues?|tickets?|packages?|rounds?|tasks?)\s+(?:#?\d|N\b)|(?:^|[^-a-z])(?:issues?|tickets?|packages?|rounds?|tasks?)\s+(?:#?\d|N\b)|#\d{2,}|field report|the review found|as asked by/i, 'a task by number or the story of a task'],
];
// The only text the families do not read: the name of the record contract, which is its version, and the path of the
// frozen reader and of the fixture it loads.
const TENSE_ALLOWED = [/jarl-record\/\d+/g, /old-jarl(?:\.mjs)?/g, /fixtures\/jarl-6\.1\.0\//g];

// The lines of a markdown file outside the blocks Runes writes, as { where, text }.
function proseLines(path, text) {
  let inside = false;
  return text.split('\n').flatMap((line, i) => {
    if (/^<!-- RUNES:[a-z-]+:START -->$/.test(line)) { inside = true; return []; }
    if (/^<!-- RUNES:[a-z-]+:END -->$/.test(line)) { inside = false; return []; }
    return inside ? [] : [{ where: `${path}:${i + 1}`, text: line }];
  });
}
// The comment lines of a script, and the titles of a test. A comment after code is not read: the same characters
// inside a string are data a test feeds a command, and no comment in these files ends a line of code.
function commentLines(path, text) {
  return text.split('\n').flatMap((line, i) => {
    const where = `${path}:${i + 1}`;
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return [{ where, text: line }];
    const title = /^\s*(?:test|describe)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/.exec(line);
    return title ? [{ where, text: title[2] }] : [];
  });
}
// The notes the commands print: the text after "note: " in the command line's and the library's source.
function noteLines(path, text) {
  return text.split('\n').flatMap((line, i) => {
    const note = /note: ([^`'"]*)/.exec(line);
    return note ? [{ where: `${path}:${i + 1} (a note)`, text: note[1] }] : [];
  });
}
// The help, the command summaries, the tool descriptions and the server's instructions, read from the tables and the server.
function derivedLines() {
  const strings = (value, out = []) => {
    if (typeof value === 'string') out.push(value);
    else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out);
    return out;
  };
  const instructions = handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }).result.instructions;
  return [
    ...USAGE.split('\n').map((text) => ({ where: 'the usage', text })),
    ...Object.entries(COMMAND_SUMMARY).map(([cmd, text]) => ({ where: `the summary of ${cmd}`, text })),
    ...buildTools().flatMap((tool) => strings(tool).map((text) => ({ where: `the tool ${tool.name}`, text }))),
    { where: 'the server instructions', text: instructions },
  ];
}

// Every text the tense rule reads, as { where, text }.
function tenseTexts() {
  const read = (path) => readFileSync(join(REPO, path), 'utf8');
  const references = readdirSync(join(SKILL, 'references')).filter((f) => f.endsWith('.md')).sort().map((f) => `skills/jarl/references/${f}`);
  const markdown = ['skills/jarl/SKILL.md', ...references, 'README.md', 'CLAUDE.md'].flatMap((p) => proseLines(p, read(p)));
  // The Runes vendoring tool is compared byte for byte with Runes' own copy by the vendor gate, so it is changed in Runes only.
  const scripts = readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs') && f !== 'runes.mjs');
  const comments = scripts.flatMap((f) => commentLines(`skills/jarl/scripts/${f}`, read(`skills/jarl/scripts/${f}`)));
  const notes = scripts.flatMap((f) => noteLines(`skills/jarl/scripts/${f}`, read(`skills/jarl/scripts/${f}`)));
  // The frozen reader is the one file of the tests that names its version, and no rule reads it. The record contract's
  // test is held unchanged by this release, so its comments are not read here either.
  const tests = readdirSync(TESTS).filter((f) => f.endsWith('.mjs') && f !== 'old-jarl.mjs' && f !== 'record-contract.test.mjs');
  const testComments = tests.flatMap((f) => commentLines(`skills/jarl/scripts/tests/${f}`, readFileSync(join(TESTS, f), 'utf8')));
  return [...markdown, ...derivedLines(), ...notes, ...comments, ...testComments];
}
function tenseHits(texts) {
  const hits = [];
  for (const { where, text } of texts) {
    let clean = text;
    for (const re of TENSE_ALLOWED) clean = clean.replace(re, '');
    for (const [re, what] of TENSE_FLAGS) {
      const m = re.exec(clean);
      if (m) hits.push(`${where}: ${what}: "${m[0]}" in ${text.trim().slice(0, 100)}`);
    }
  }
  return hits;
}

test('the tense test: the skill, README.md, CLAUDE.md, the help, the tool texts, the instructions, the notes, and the comments and titles of the scripts and the tests speak of Jarl as it is now', () => {
  assert.deepEqual(tenseHits(tenseTexts()), []);
});

test('the tense test names each family in a sample, and the allow-list passes only the record contract name and the frozen reader path', () => {
  const samples = ['Jarl 6.2.0 reads it.', 'the v2 shape', 'a version of N.N', 'an X.Y.Z tag', 'an older loop', 'it no longer runs', 'it is new in the tool', 'it used to need a flag', 'a legacy file', 'it is retired', 'it stays compatible with the reader', 'it was migrated', 'a backward rule', 'an issue N of the loop', 'a (issue N) note', 'a previous version', 'before this release', 'a later release', 'the next release', 'the old name of the flag', 'the user decides', 'an alias of check', 'since the last release', '(issue 281)', 'ticket 3 is open', 'round 3 failed', 'see #281', 'the field report', 'the review found it'];
  for (const sample of samples) assert.ok(tenseHits([{ where: 'x', text: sample }]).length, sample);
  const passes = ['the lease since the last start', 'an earlier round', 'the earlier verdict', 'a row from before a reopen', 'a migration of the record', 'an alias such as the family name', 'a row of the evidence', 'the usage of --issue 7', 'jarl-record/1 is the contract', 'the frozen reader at tests/old-jarl.mjs', 'fixtures/jarl-6.1.0/jarl-lib.mjs', 'the owner rules', 'a round <ids> call'];
  for (const sample of passes) assert.deepEqual(tenseHits([{ where: 'x', text: sample }]), [], sample);
});
