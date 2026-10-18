// The seams of the library, held by greps over its text so that no later change can erode them while it is still one
// module. The library is cut into sections by its `// ---- <title> ---` headers; each rule names the section that owns a
// thing and fails on any line outside it. Every rule has a case below that proves it fails on a sample that breaks it.
//
//   1  only the journal sections name the loop's files (log, decisions, asks, goal) or hold the stamp pattern, and the
//      line the goal carries for the tool has one grammar
//   2  only the issue-file sections parse an issue's header or a section
//   3  a process is run in one place: the git section
//   4  a view never writes
//   5  nothing in the library imports upward (the record, the command line, the server)
//   6  one section holds the grammar of an id, a range of ids and the id in a branch name
//   7  a comment states what the code does; it names no version and no past
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const SCRIPTS = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, SCRIPTS), 'utf8');
const LIB = read('jarl-lib.mjs');

const HEADER = /^\/\/ ---- (.+?) -{3,}\s*$/;
// The text as [{ title, lines: [{ n, text }] }]; what stands before the first header is the section ''.
function sectionsOf(text) {
  const out = [{ title: '', lines: [] }];
  text.split('\n').forEach((line, i) => {
    const h = HEADER.exec(line);
    if (h) out.push({ title: h[1], lines: [] });
    else out[out.length - 1].lines.push({ n: i + 1, text: line });
  });
  return out;
}
// Every line outside the sections `owned` accepts that `pattern` matches, as "n: text".
function outside(text, owned, pattern) {
  return sectionsOf(text).filter((s) => !owned(s.title)).flatMap((s) => s.lines.filter((l) => pattern.test(l.text)).map((l) => `${l.n}: ${l.text.trim()}`));
}
// The text of the function `name` (a top-level declaration, closed by a line holding only `}`, or on one line).
function functionBody(text, name) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^(export )?function ${name}\\(`).test(l));
  if (start === -1) return null;
  const count = (s, c) => s.split(c).length - 1;
  if (lines[start].trimEnd().endsWith('}') && count(lines[start], '{') === count(lines[start], '}')) return lines[start];
  let end = start + 1;
  while (end < lines.length && lines[end] !== '}') end += 1;
  return lines.slice(start, end + 1).join('\n');
}

// ---- rule 1: the journal ------------------------------------------------------------------------------

const JOURNAL = (title) => /^(journal and decisions|the log: one reader)/.test(title);
const JOURNAL_NAMES = /\b(log|decisions|asks|goal)\.md\b|\\+d\{4\}-\\+d\{2\}-\\+d\{2\} \\+d\{2\}:\\+d\{2\}/;

test('rule 1: only the journal sections name the loop\'s files or hold the stamp pattern', () => {
  assert.deepEqual(outside(LIB, JOURNAL, JOURNAL_NAMES), []);
  const noted = '// ---- journal and decisions ---------\nconst a = join(dir, \'goal.md\');\n// ---- commands -----------\nconst b = join(dir, \'goal.md\');\nconst re = /^(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2})/;\n';
  assert.equal(outside(noted, JOURNAL, JOURNAL_NAMES).length, 2, 'a file name and a stamp pattern outside the journal are found; the same name inside it is not');
});

test('rule 1: the line the goal carries for the tool has one grammar', () => {
  const bold = (text) => (text.match(/\(\?:\[-\*\]\\s\+\)\?\(\?:\\\*\\\*\)\?/g) || []).length;
  assert.equal(bold(LIB), 1, 'the bold-key line pattern occurs once, in goalLines');
  assert.equal(bold(`${LIB}\nconst again = /^\\s*(?:[-*]\\s+)?(?:\\*\\*)?check:/;`), 2, 'a second copy is counted');
});

// ---- rule 2: the issue file ---------------------------------------------------------------------------

const ISSUE_FILE = (title) => /^(issues|journal and decisions)/.test(title);
const PARSES_ISSUE = /\^\\\*\\\*|'## '|\^## /;

test('rule 2: only the issue-file sections parse an issue\'s header or a section', () => {
  assert.deepEqual(outside(LIB, ISSUE_FILE, PARSES_ISSUE), []);
  const sample = '// ---- issues -------\nconst f = /^\\*\\*([A-Za-z]+):\\*\\*/;\n// ---- commands -----\nconst g = text.replace(/^\\*\\*After:\\*\\*.*\\n/m, \'\');\nif (l.startsWith(\'## \')) break;\n';
  assert.equal(outside(sample, ISSUE_FILE, PARSES_ISSUE).length, 2);
});

// ---- rule 3: a process is run in one place ------------------------------------------------------------

const GIT_SECTION = (title) => /^git:/.test(title);
const RUNS_PROCESS = /\b(execFileSync|execSync|spawnSync|spawn)\(|\bexec\('git'/;

test('rule 3: a process is run in the git section and nowhere else', () => {
  assert.deepEqual(outside(LIB, GIT_SECTION, RUNS_PROCESS), []);
  assert.ok(sectionsOf(LIB).some((s) => GIT_SECTION(s.title) && s.lines.some((l) => RUNS_PROCESS.test(l.text))), 'the git section runs it');
  const sample = '// ---- git: the one place -----\nexecFileSync(\'git\', []);\n// ---- commands ----\nexecFileSync(\'git\', args);\nconst out = exec(\'git\', args);\n';
  assert.equal(outside(sample, GIT_SECTION, RUNS_PROCESS).length, 2);
});

// ---- rule 4: a view never writes ----------------------------------------------------------------------

const VIEWS = ['cmdStatus', 'statusOf', 'cmdNext', 'nextRows', 'cmdList', 'cmdReport', 'cmdModels', 'cmdTips', 'cmdQueue', 'cmdBranches', 'cmdResume', 'cmdChangelog', 'issueView',
  'renderStatus', 'renderNext', 'renderModels', 'renderTips', 'renderQueue', 'renderResume', 'renderBranches', 'renderList', 'renderDecide', 'renderDecisions', 'renderProfile'];
const WRITES = /\b(writeAtomic|appendAtomic|appendLog|appendLogLines|withLock|writeFileSync|unlinkSync|rmSync|renameSync|mkdirSync|raiseFormat)\(/;
const writingViews = (text) => VIEWS.filter((name) => { const body = functionBody(text, name); return body && WRITES.test(body); });

test('rule 4: a view never writes', () => {
  assert.deepEqual(writingViews(LIB), []);
  assert.ok(VIEWS.filter((name) => functionBody(LIB, name) !== null).length >= 20, 'the views are found in the library');
  const sample = 'export function cmdStatus(root) {\n  appendLog(root, \'x\');\n  return 1;\n}\nfunction cmdNext(root) { return 1; }\n';
  assert.deepEqual(writingViews(sample), ['cmdStatus']);
});

// ---- rule 5: no upward import -------------------------------------------------------------------------

const UPWARD = /from '\.\/(record|jarl|jarl-mcp)\.mjs'|import\('\.\/(record|jarl|jarl-mcp)\.mjs'\)/;
const importsUpward = (text, pattern = UPWARD) => text.split('\n').filter((l) => pattern.test(l));

test('rule 5: the library imports nothing above it, and the record imports not the command line', () => {
  assert.deepEqual(importsUpward(LIB), []);
  assert.deepEqual(importsUpward(read('record.mjs'), /from '\.\/(jarl|jarl-mcp)\.mjs'/), []);
  assert.deepEqual(importsUpward(read('yg-edge.mjs'), UPWARD), []);
  assert.equal(importsUpward('import * as R from \'./record.mjs\';\nimport { x } from \'node:fs\';').length, 1);
});

// ---- rule 6: ids --------------------------------------------------------------------------------------

const IDS = (title) => /^ids:/.test(title);
const ID_GRAMMAR = /\bID_SRC\b|\\+d\{3,\}|\(\\+d\+\)-#\?|jarl\/\(\?:/;

test('rule 6: the grammar of an id, a range of ids and the id in a branch name is in the ids section', () => {
  assert.deepEqual(outside(LIB, IDS, ID_GRAMMAR), []);
  const sample = '// ---- ids: the grammar -----\nexport const ID_SRC = \'\\\\d{3,}\';\n// ---- commands ----\nconst r = new RegExp(`^(${ID_SRC})-`);\nconst legacy = /^jarl\\/(?:[^/]+\\/)?(\\d{3,})-/;\n';
  assert.equal(outside(sample, IDS, ID_GRAMMAR).length, 2);
});

// ---- the resolvers the seams hang on ------------------------------------------------------------------

test('one resolver names the repositories of an issue, one parser splits the worktree list, one guard holds the lease flags', () => {
  const count = (pattern) => (LIB.match(pattern) || []).length;
  assert.ok(count(/reposNamed\(i\)\.length/g) <= 1, 'the repositories an issue names are resolved in one place');
  assert.ok(count(/worktree list/g) <= 1, 'the worktree list is split in one place');
  assert.equal(count(/'branch', 'worker', 'model', 'worktree'/g), 1, 'the lease flags are listed once');
  assert.equal(count(/^function repoLabel\(/gm), 1, 'one function labels a repository');
  assert.equal(count(/\breviewState\b|\bREVIEWER_KINDS\b|\blastSetCaller\b|\blastCaller\b/g), 0);
});

// ---- rule 7: comments ---------------------------------------------------------------------------------

// A comment that dates the code instead of stating what it does: a version number, "older", "no longer", "legacy", and
// the like. The exceptions are named here, one by one, with the file and the text that stays.
const VERSIONED = /\b\d+\.\d+(?:\.(?:\d+|x))?\b|\bv\d+\b/;
const DATED = /\b\d+\.\d+(?:\.(?:\d+|x))?\b|\bv\d+\b|\bolder\b|before .* existed|\bno longer\b|\bearlier (version|jarl|reader|loop)|\blegacy\b|\bbackward|\bcompatib|\bused to\b|\bnew in\b|\bmigrat|\bformerly\b|\bfrom before\b|\bprevious (version|release)/i;
const EXCEPTIONS = [];
function datedComments(name, text, pattern = DATED) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    const at = line.search(/(^|\s)\/\/(\s|$)/);
    if (at === -1) return;
    const comment = line.slice(at).trim();
    if (pattern.test(comment) && !EXCEPTIONS.some((e) => e.file === name && comment.includes(e.text))) out.push(`${name}:${i + 1}: ${comment}`);
  });
  return out;
}

test('rule 7: no comment in the scripts names a version or a past', () => {
  const files = readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs'));
  assert.ok(files.includes('jarl-lib.mjs') && files.includes('jarl.mjs') && files.includes('record.mjs'));
  assert.deepEqual(files.flatMap((f) => datedComments(f, read(f))), []);
  assert.equal(datedComments('x.mjs', 'const a = 1; // kept for 6.1.0 readers\n// an older loop\n// the lease since the last move\nconst u = "https://example.com";\n// compatible with a reader\n').length, 3);
  assert.equal(datedComments('x.mjs', '// a 6.1.x reader\n// the v2 shape\n// since 6.2\n// a ratio of 0.5 lines\n// nothing dated here\n').length, 4, 'N.N.x, vN and N.N are version-shaped');
});

// The same words in the tests' comments and test titles (not in the frozen reader or in data a test feeds a command), and
// in the prose files.
const TESTS = readdirSync(new URL('tests/', SCRIPTS)).filter((f) => f.endsWith('.test.mjs') && f !== 'seams.test.mjs');
const titlesOf = (text) => text.split('\n').flatMap((line, i) => (/^\s*test\('/.test(line) ? [`${i + 1}: ${line.trim()}`] : [])).filter((l) => VERSIONED.test(l));

test('rule 7: no comment or title in the tests, and no prose in the skill or the readme, holds a version-shaped token', () => {
  assert.deepEqual(TESTS.flatMap((f) => datedComments(`tests/${f}`, read(`tests/${f}`), VERSIONED)), []);
  assert.deepEqual(TESTS.flatMap((f) => titlesOf(read(`tests/${f}`)).map((l) => `tests/${f}:${l}`)), []);
  const prose = (name, url) => readFileSync(url, 'utf8').split('\n').flatMap((l, i) => (VERSIONED.test(l) ? [`${name}:${i + 1}: ${l.trim().slice(0, 80)}`] : []));
  assert.deepEqual(prose('SKILL.md', new URL('../SKILL.md', SCRIPTS)), []);
  assert.deepEqual(prose('README.md', new URL('../../../README.md', SCRIPTS)), []);
});

// ---- every spawn in the tests has a timeout -----------------------------------------------------------

test('every process a test starts carries a timeout', () => {
  const calls = (text) => text.split('\n').flatMap((l, i) => (/\b(spawnSync|execFileSync|execSync)\(/.test(l) && !/timeout/.test(l) && !/^\s*(\/\/|import|assert)/.test(l) ?[`${i + 1}: ${l.trim().slice(0, 100)}`] : []));
  const files = [...TESTS, 'helpers.mjs', 'portable.mjs', 'old-jarl.mjs'];
  assert.deepEqual(files.flatMap((f) => calls(read(`tests/${f}`)).map((l) => `tests/${f}:${l}`)), []);
  assert.equal(calls('const r = spawnSync(process.execPath, [x], { encoding: \'utf8\' });\nconst ok = spawnSync(a, b, { timeout: 1 });').length, 1);
});
