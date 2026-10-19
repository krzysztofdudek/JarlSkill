// The tense of the texts: Jarl is described only as it is now. Every text a reader or an agent meets names no version,
// no other Jarl, no plan for a release still to come and no second name for a command, calls the owner by his role, and
// holds no task by number. The surfaces are the skill, its references, README.md and CLAUDE.md; the help, the usage, the command
// summaries, the tool descriptions, the server's instructions, read from the command table, the tool list and the server;
// every string, template literal, comment and name of the scripts; the comments and the titles of the tests; and the
// comments and the names of the workflow files.
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
// The names of a script that the families read by their words (camel case and underscores split), and the names the
// output keeps: each is a key the tests assert in the JSON the tools print, and renaming it would change that output.
const NAME_FLAGS = /^(?:legacy|retire[ds]?|older|backward|backwards|compatible|migrate[sd]?|formerly)$/;
// Each allowance holds in its one file only: the keys are built in the library, and no other name passes.
const NAME_ALLOWED = [
  { name: 'legacyHandoff', file: 'skills/jarl/scripts/jarl-lib.mjs', reason: 'the key of the handoff file in resume --json, which the tests assert' },
  { name: 'retired', file: 'skills/jarl/scripts/jarl-lib.mjs', reason: 'the key of the handoff write --json, which the tests assert' },
];
// A string that is exactly one of these is a constant of the protocol or a placeholder of the server, not prose: the
// JSON-RPC version, and the version the server reports when its manifest cannot be read.
const CONSTANT_ALLOWED = {
  '2.0': 'the JSON-RPC version, a protocol constant',
  '0.0.0': 'the version the server reports when its manifest cannot be read, a placeholder',
};

// The tokens of a script: its string literals, template literals, comments and names, each with the line it starts on.
// A regular expression literal is skipped whole, so the quotes and the slashes inside it are read as nothing.
const WORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'in', 'of', 'void', 'delete', 'throw', 'new']);
const PUNCT_BEFORE_REGEX = '(,=:[!&|?{};+-*%<>~^';
function sourceTokens(path, src) {
  const out = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let prev = { ch: '', word: '' };
  const regexAllowed = () => (prev.word ? WORDS_BEFORE_REGEX.has(prev.word) : prev.ch === '' || PUNCT_BEFORE_REGEX.includes(prev.ch));
  // Moves past the source up to `end`, counting its lines, and returns the line the token started on.
  const take = (end) => {
    const start = line;
    for (const ch of src.slice(i, end)) if (ch === '\n') line += 1;
    i = end;
    return start;
  };
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { take(i + 1); continue; }
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out.push({ kind: 'comment', where: `${path}:${line}`, text: src.slice(i + 2, stop) });
      take(stop);
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out.push({ kind: 'comment', where: `${path}:${line}`, text: src.slice(i + 2, end === -1 ? n : end) });
      take(stop);
      prev = { ch: ')', word: '' };
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (inClass) { if (src[j] === ']') inClass = false; } else if (src[j] === '[') inClass = true; else if (src[j] === '/') break;
        j += 1;
      }
      j += 1;
      while (j < n && /[a-z]/i.test(src[j])) j += 1;
      take(j);
      prev = { ch: ')', word: '' };
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let text = '';
      while (j < n && src[j] !== c && src[j] !== '\n') {
        if (src[j] === '\\') { text += src[j] + src[j + 1]; j += 2; } else { text += src[j]; j += 1; }
      }
      out.push({ kind: 'string', where: `${path}:${line}`, text });
      take(j + 1);
      prev = { ch: ')', word: '' };
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      let text = '';
      let depth = 0;
      while (j < n) {
        const d = src[j];
        if (depth === 0 && d === '`') break;
        if (d === '\\') { text += d + src[j + 1]; j += 2; continue; }
        if (depth === 0 && d === '$' && src[j + 1] === '{') { depth = 1; text += '${'; j += 2; continue; }
        if (depth > 0 && d === '{') depth += 1;
        if (depth > 0 && d === '}') depth -= 1;
        text += d;
        j += 1;
      }
      out.push({ kind: 'template', where: `${path}:${line}`, text });
      take(j + 1);
      prev = { ch: ')', word: '' };
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(src[j])) j += 1;
      const word = src.slice(i, j);
      out.push({ kind: 'name', where: `${path}:${line}`, text: word });
      take(j);
      prev = { ch: 'a', word };
      continue;
    }
    if (/\d/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(src[j])) j += 1;
      take(j);
      prev = { ch: '0', word: '' };
      continue;
    }
    take(i + 1);
    prev = { ch: c, word: '' };
  }
  return out;
}

// The lines of a markdown file outside the blocks Runes writes, as { where, text }.
function proseLines(path, text) {
  let inside = false;
  return text.split('\n').flatMap((line, i) => {
    if (/^<!-- RUNES:[a-z-]+:START -->$/.test(line)) { inside = true; return []; }
    if (/^<!-- RUNES:[a-z-]+:END -->$/.test(line)) { inside = false; return []; }
    return inside ? [] : [{ where: `${path}:${i + 1}`, text: line }];
  });
}
// The comment lines of a test, and the titles of a test. A comment after code is not read in a test: the same characters
// inside a string are data a test feeds a command.
function commentLines(path, text) {
  return text.split('\n').flatMap((line, i) => {
    const where = `${path}:${i + 1}`;
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return [{ where, text: line }];
    const title = /^\s*(?:test|describe)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/.exec(line);
    return title ? [{ where, text: title[2] }] : [];
  });
}
// The comments and the names of a workflow file: a comment is the text after a # that starts a line or follows a value,
// and a name is the value of a name key. The rest of the YAML is code, not prose, and is not read.
function workflowLines(path, text) {
  return text.split('\n').flatMap((line, i) => {
    const where = `${path}:${i + 1}`;
    const comment = /(?:^|\s)#(.*)$/.exec(line);
    if (comment) return [{ where, text: comment[1] }];
    const name = /^\s*(?:-\s+)?name:\s*(.*)$/.exec(line);
    return name ? [{ where, text: name[1] }] : [];
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

// Every text the tense rule reads, as { where, text } and, for a name of a script, kind 'name'.
function tenseTexts() {
  const read = (path) => readFileSync(join(REPO, path), 'utf8');
  const references = readdirSync(join(SKILL, 'references')).filter((f) => f.endsWith('.md')).sort().map((f) => `skills/jarl/references/${f}`);
  const markdown = ['skills/jarl/SKILL.md', ...references, 'README.md', 'CLAUDE.md'].flatMap((p) => proseLines(p, read(p)));
  // The Runes vendoring tool is compared byte for byte with Runes' own copy by the vendor gate, so it is changed in Runes only.
  const scripts = readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs') && f !== 'runes.mjs');
  const source = scripts.flatMap((f) => sourceTokens(`skills/jarl/scripts/${f}`, read(`skills/jarl/scripts/${f}`)));
  // The frozen reader is the one file of the tests that names its version, and no rule reads it. The record contract's
  // test is held unchanged by this release, so its comments are not read here either.
  const tests = readdirSync(TESTS).filter((f) => f.endsWith('.mjs') && f !== 'old-jarl.mjs' && f !== 'record-contract.test.mjs');
  const testComments = tests.flatMap((f) => commentLines(`skills/jarl/scripts/tests/${f}`, readFileSync(join(TESTS, f), 'utf8')));
  const workflows = readdirSync(join(REPO, '.github/workflows')).filter((f) => f.endsWith('.yml')).sort().flatMap((f) => workflowLines(`.github/workflows/${f}`, read(`.github/workflows/${f}`)));
  return [...markdown, ...derivedLines(), ...source, ...testComments, ...workflows];
}
function tenseHits(texts) {
  const hits = [];
  for (const { where, text, kind } of texts) {
    if (kind === 'name') {
      if (NAME_ALLOWED.some((a) => a.name === text && where.startsWith(`${a.file}:`))) continue;
      const word = text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase().split(' ').find((w) => NAME_FLAGS.test(w));
      if (word) hits.push(`${where}: a word of history in a name: "${text}"`);
      continue;
    }
    if (kind === 'string' && CONSTANT_ALLOWED[text] !== undefined) continue;
    let clean = text;
    for (const re of TENSE_ALLOWED) clean = clean.replace(re, '');
    for (const [re, what] of TENSE_FLAGS) {
      const m = re.exec(clean);
      if (m) hits.push(`${where}: ${what}: "${m[0]}" in ${text.trim().slice(0, 100)}`);
    }
  }
  return hits;
}

test('the tense test: the skill, README.md, CLAUDE.md, the help, the tool texts, the instructions, every string, comment and name of the scripts, and the comments and titles of the tests speak of Jarl as it is now', () => {
  assert.deepEqual(tenseHits(tenseTexts()), []);
});

test('the tense test reads every string, template, comment and name of a script, and passes a regular expression with a quote in it', () => {
  const sample = "const a = 'older'; // the owner decides\nconst t = `x ${'b'} retired`;\nconst r = /'/.test(a);\nconst legacy = 1; /* since the last release */\n";
  const tokens = sourceTokens('x.mjs', sample);
  const kind = (k) => tokens.filter((t) => t.kind === k).map((t) => t.text.trim());
  assert.deepEqual(kind('string'), ['older']);
  assert.deepEqual(kind('comment'), ['the owner decides', 'since the last release']);
  assert.deepEqual(kind('template'), ["x ${'b'} retired"]);
  assert.ok(kind('name').includes('legacy'));
  assert.equal(tokens.find((t) => t.kind === 'comment' && t.text.includes('owner')).where, 'x.mjs:1');
  assert.equal(tenseHits(tokens).length, 4, 'the older string, the since comment, the retired template and the legacy name');
});

test('the tense test reads the comments and the names of a workflow file, and no other YAML', () => {
  const sample = 'name: CI\n  # The runner (issue 7)\n  run: npm test # pinned 22.0.1\n  - name: Run tests\n    with: { node-version: 22 }\n';
  const lines = workflowLines('x.yml', sample);
  assert.deepEqual(lines.map((l) => l.text.trim()), ['CI', 'The runner (issue 7)', 'pinned 22.0.1', 'Run tests']);
  assert.equal(lines[1].where, 'x.yml:2');
  assert.equal(tenseHits(lines).length, 2, 'the task number and the version-shaped token');
});

test('the tense test names each family in a sample, and the allow-list passes only the record contract name, the frozen reader path and the two output keys', () => {
  const samples = ['Jarl 6.2.0 reads it.', 'the v2 shape', 'a version of N.N', 'an X.Y.Z tag', 'an older loop', 'it no longer runs', 'it is new in the tool', 'it used to need a flag', 'a legacy file', 'it is retired', 'it stays compatible with the reader', 'it was migrated', 'a backward rule', 'an issue N of the loop', 'a (issue N) note', 'a previous version', 'before this release', 'a later release', 'the next release', 'the old name of the flag', 'the user decides', 'an alias of check', 'since the last release', '(issue 281)', 'ticket 3 is open', 'round 3 failed', 'see #281', 'the field report', 'the review found it'];
  for (const sample of samples) assert.ok(tenseHits([{ where: 'x', text: sample }]).length, sample);
  const passes = ['the lease since the last start', 'an earlier round', 'the earlier verdict', 'a row from before a reopen', 'a migration of the record', 'an alias such as the family name', 'a row of the evidence', 'the usage of --issue 7', 'jarl-record/1 is the contract', 'the frozen reader at tests/old-jarl.mjs', 'fixtures/jarl-6.1.0/jarl-lib.mjs', 'the owner rules', 'a round <ids> call'];
  for (const sample of passes) assert.deepEqual(tenseHits([{ where: 'x', text: sample }]), [], sample);
  const lib = 'skills/jarl/scripts/jarl-lib.mjs:1';
  assert.deepEqual(tenseHits([{ where: lib, text: 'legacyHandoff', kind: 'name' }, { where: lib, text: 'retired', kind: 'name' }]), []);
  assert.equal(tenseHits([{ where: 'skills/jarl/scripts/mutant.mjs:1', text: 'retired', kind: 'name' }]).length, 1, 'the allowance holds in its one file');
  assert.equal(tenseHits([{ where: lib, text: 'legacyFile', kind: 'name' }]).length, 1);
});
