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
// The prose of the skill: SKILL.md and every file of references/, by the name each is read under.
const SKILL_FILES = Object.fromEntries(['SKILL.md', ...readdirSync(new URL('../references/', SCRIPTS)).filter((f) => f.endsWith('.md')).sort().map((f) => `references/${f}`)].map((f) => [f, new URL(`../${f}`, SCRIPTS)]));
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

// ---- rule 9: repositories -----------------------------------------------------------------------------

const REPOSITORIES = (title) => /^repositories:/.test(title);
const REPOSITORY_NAMES = /\bREPOS_FILE\b|\brepos\.md\b|\bloopHome\(|\bdeclaredRepos\(|\brootsOf\(|--max-parents=0|--is-shallow-repository/;

test('rule 9: only the repositories section resolves a name, declares a repository or reads a root commit', () => {
  assert.deepEqual(outside(LIB, REPOSITORIES, REPOSITORY_NAMES), []);
  assert.ok(sectionsOf(LIB).some((s) => REPOSITORIES(s.title) && s.lines.some((l) => /\bloopHome\(/.test(l.text))), 'the section does the resolving');
  const sample = '// ---- repositories: names -----\nfunction loopHome(root) {}\n// ---- commands ----\nconst home = loopHome(root);\nconst r = git(dir, [\'rev-list\', \'--max-parents=0\', ref]);\nconst f = join(jarlDir(root), \'repos.md\');\n';
  assert.equal(outside(sample, REPOSITORIES, REPOSITORY_NAMES).length, 3);
  const count = (pattern) => (LIB.match(pattern) || []).length;
  assert.equal(count(/--max-parents=0/g), 1, 'the root commits are read in one place');
});

// ---- rule 10: verify holds no grammar of its own ----------------------------------------------------------

const VERIFY = (title) => /^verify:/.test(title);
// A regular expression as code: the RegExp constructor, or a literal that opens after an operator, a bracket or a comma.
const REGEX_CODE = /\bRegExp\b|(?:^|[(=,:!&|?\[]|\breturn)\s*\/(?![/*])/;
const verifyLines = (text) => sectionsOf(text).filter((s) => VERIFY(s.title)).flatMap((s) => s.lines);

test('rule 10: the verify section holds no regular expression: a record line is placed by the reader that owns it', () => {
  assert.ok(sectionsOf(LIB).some((s) => VERIFY(s.title)), 'the verify section is found');
  assert.deepEqual(verifyLines(LIB).filter((l) => REGEX_CODE.test(l.text)).map((l) => `${l.n}: ${l.text.trim()}`), []);
  const sample = '// ---- verify: the record ----\nconst re = /^a+$/;\nconst b = x.test(/y/);\nconst c = new RegExp(\'z\');\n// ---- commands ----\nconst d = /ok/;\nconst e = \'issues/\' + f;\n';
  assert.equal(verifyLines(sample).filter((l) => REGEX_CODE.test(l.text)).length, 3, 'three regular expressions in verify are found, and the commands section is not verify');
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

// A comment that dates the code instead of stating what it does: a version number, a word of the past, and
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
  for (const [name, url] of Object.entries(SKILL_FILES)) assert.deepEqual(prose(name, url), []);
  assert.deepEqual(prose('README.md', new URL('../../../README.md', SCRIPTS)), []);
});

// The help text and the descriptions the command line and the server print are prose too: their lines hold no dating word.
function datedStrings(name, text) {
  return text.split('\n').flatMap((line, i) => (!/^\s*\/\//.test(line) && !/jsonrpc|plugin\.json/.test(line) && DATED.test(line) ? [`${name}:${i + 1}: ${line.trim().slice(0, 100)}`] : []));
}
test('rule 7: no line of the help text or of the server\'s descriptions names a version or a past', () => {
  assert.deepEqual(['jarl.mjs', 'jarl-mcp.mjs'].flatMap((f) => datedStrings(f, read(f))), []);
  assert.equal(datedStrings('x.mjs', "  evidence  a Jarl 6.1.x refuses the loop\n  show  prints the issue\n// an older reader\n  merged  as it no longer did\n").length, 2);
});

const PAST_WORDS =/\bno longer\b|\bolder\b|\blegacy\b|\bused to\b|\bformerly\b|\bnew in\b/i;
test('rule 7: no title of the one-store tests and no changelog entry of the single record tells of the past', () => {
  const titled = TESTS.filter((f) => f === 'one-store.test.mjs').flatMap((f) => read(`tests/${f}`).split('\n').flatMap((line, i) => (/^\s*test\('/.test(line) && PAST_WORDS.test(line) ? [`tests/${f}:${i + 1}: ${line.trim().slice(0, 100)}`] : [])));
  assert.deepEqual(titled, []);
  assert.equal(PAST_WORDS.test("test('the profile no longer lists it', () => {"), true);
  const changelog = readFileSync(new URL('../../../CHANGELOG.md', SCRIPTS), 'utf8').split('\n');
  const unreleased = changelog.slice(changelog.findIndex((l) => l.startsWith('## [Unreleased]')) + 1);
  const entry = unreleased.slice(0, unreleased.findIndex((l) => l.startsWith('## [')));
  assert.deepEqual(entry.filter((l) => /^- The log is now the one record/.test(l) && PAST_WORDS.test(l)), []);
});

// ---- every spawn in the tests has a timeout -----------------------------------------------------------

test('every process a test starts carries a timeout', () => {
  const calls = (text) => text.split('\n').flatMap((l, i) => (/\b(spawnSync|execFileSync|execSync)\(/.test(l) && !/timeout/.test(l) && !/^\s*(\/\/|import|assert)/.test(l) ?[`${i + 1}: ${l.trim().slice(0, 100)}`] : []));
  const files = [...TESTS, 'helpers.mjs', 'portable.mjs', 'old-jarl.mjs'];
  assert.deepEqual(files.flatMap((f) => calls(read(`tests/${f}`)).map((l) => `tests/${f}:${l}`)), []);
  assert.equal(calls('const r = spawnSync(process.execPath, [x], { encoding: \'utf8\' });\nconst ok = spawnSync(a, b, { timeout: 1 });').length, 1);
});

// ---- rule 8: no task number and no task story --------------------------------------------------------

// A comment, a test title or a line of prose never points at a task of the loop: no number after the word for an issue,
// a ticket, a package or a round, no hash number, no report of a review, and no comment opens with a bare number in parentheses. The commit
// subject is the one place a number names an issue. No file needs an exception: an id that a test feeds a command is
// written as the id (7, 007, 1000) and a line about a fixture says "the first issue" rather than its number.
const TASK_REF = /\((issues?|tickets?|packages?|rounds?)\s+#?\d+|\(#?\d{2,4}\)|(^|[^a-z])(issues?|tickets?|packages?|rounds?)\s+#?\d+|#\d{2,}|field report/i;
const BARE_NUMBER_FIRST = /^\s*(\/\/|\*)\s*\(#?\d+\)/;
// The comment part of a script line (the whole line when it is a comment or a test title), or null.
function commentOf(line) {
  if (/^\s*(\/\/|\/\*|\*)/.test(line) || /^\s*test\('/.test(line)) return line;
  const at = line.search(/\s\/\/\s/);
  return at === -1 ? null : line.slice(at);
}
// The lines that hold a task reference, as "file:n: text". A prose file is read whole, line by line.
function taskRefs(name, text, prose = false) {
  return text.split('\n').flatMap((line, i) => {
    const body = prose ? line : commentOf(line);
    if (body === null || !(TASK_REF.test(body) || BARE_NUMBER_FIRST.test(body))) return [];
    return [`${name}:${i + 1}: ${body.trim().slice(0, 120)}`];
  });
}

test('rule 8: no comment, test title or prose line names a task by number or tells its story', () => {
  const scripts = readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs'));
  const tests = readdirSync(new URL('tests/', SCRIPTS)).filter((f) => f.endsWith('.mjs') && f !== 'seams.test.mjs');
  const prose = { ...SKILL_FILES, 'README.md': new URL('../../../README.md', SCRIPTS), 'CLAUDE.md': new URL('../../../CLAUDE.md', SCRIPTS), 'CHANGELOG.md': new URL('../../../CHANGELOG.md', SCRIPTS) };
  assert.deepEqual([
    ...scripts.flatMap((f) => taskRefs(f, read(f))),
    ...tests.flatMap((f) => taskRefs(`tests/${f}`, read(`tests/${f}`))),
    ...Object.entries(prose).flatMap(([n, u]) => taskRefs(n, readFileSync(u, 'utf8'), true)),
  ], []);
  assert.equal(taskRefs('x.mjs', '// the lease of (issue 281)\nconst a = 1; // see issue 7\n// (475) the old count\nconst b = "issue 9";\n// a package 2 ships\n// the #281 shape\n// the field report says so\n').length, 6);
  assert.equal(taskRefs('x.mjs', 'const a = 1; // a count of 7 things\n// the id 007 is data\n').length, 0);
  assert.equal(taskRefs('x.md', 'Use `issue 7` as an example.\n(issue 281) ticket 3\n', true).length, 2, 'prose is read whole');
});
