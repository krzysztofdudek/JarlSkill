// The id grammar: one or more digits, written plain or with leading zeros, compared as numbers. 007 and 7 name one issue
// in every command, a number of fewer than three digits or of 1000 or more is written plain and raises the record format
// before it is written, so a reader that expects three digits refuses the loop loudly instead of skipping a file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sh } from './portable.mjs';
import { jarl, refuses } from './helpers.mjs';
import { oldJarl } from './old-jarl.mjs';
import { FINDINGS } from './findings.mjs';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const L = await import('../jarl-lib.mjs');
const mcp = await import('../jarl-mcp.mjs');
const R = await import('../record.mjs');

const tool = (root, name, input = {}) => mcp.callTool(name, { root, ...input }).content[0].text;
const markerPath = (root) => join(root, '.jarl', 'profile.json');
const formatOf = (root) => (existsSync(markerPath(root)) ? JSON.parse(readFileSync(markerPath(root), 'utf8')).format : 1);

// A loop that already holds issues 998 and 999, written as the frozen reader would have: the next number is 1000.
function loopAt999() {
  const root = mkdtempSync(join(tmpdir(), 'jarl-ids-'));
  mkdirSync(join(root, '.git'));
  jarl(root, 'init', 'a goal');
  for (const id of ['998', '999']) {
    writeFileSync(join(root, '.jarl', 'issues', `${id}-old-${id}.md`), L.renderIssue({ id, title: `old ${id}`, kind: 'task', priority: '2', tier: 'standard', tags: [], files: [], repo: '', foundBy: 'jarl' }));
  }
  return root;
}

test('no function pads an id: idKey, cmpId, expandIds and needsRaisedFormat read a number as written, and compare it as a number', () => {
  assert.equal(L.padId, undefined, 'the padding function is gone');
  assert.equal(L.idKey('7'), '7');
  assert.equal(L.idKey('007'), '7');
  assert.equal(L.idKey('#195'), '195');
  assert.equal(L.idKey('0000'), '0');
  assert.equal(L.idKey('1000'), '1000');
  assert.deepEqual(['1000', '999', '8', '007'].sort(L.cmpId), ['007', '8', '999', '1000']);
  assert.deepEqual(L.expandIds('998-1002'), ['998', '999', '1000', '1001', '1002']);
  assert.deepEqual(L.expandIds('#7,007,8-9'), ['7', '8', '9'], 'the keys of the ids, each once');
  assert.equal(L.needsRaisedFormat('7'), true, 'one digit is written plain');
  assert.equal(L.needsRaisedFormat('99'), true, 'two digits are written plain');
  assert.equal(L.needsRaisedFormat('100'), false);
  assert.equal(L.needsRaisedFormat('007'), false, 'a number written with three digits is as the format reads it');
  assert.equal(L.needsRaisedFormat('999'), false);
  assert.equal(L.needsRaisedFormat('1000'), true);
});

test('a new issue in an empty loop is numbered 1: its file is 1-<slug>.md, its heading # 1 · <title>, and the next one is 2', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-ids-'));
  mkdirSync(join(root, '.git'));
  jarl(root, 'init', 'a goal');
  const a = JSON.parse(jarl(root, 'new', 'first', '--json'));
  assert.equal(a.id, '1');
  assert.match(a.file, /[\\/]1-first\.md$/);
  assert.equal(readFileSync(a.file, 'utf8').split('\n')[0], '# 1 · first');
  assert.equal(JSON.parse(jarl(root, 'new', 'second', '--json')).id, '2');
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /filed 1 · first\n/);
});

test('007 and 7 are one issue wherever an id is read: show, after, lists, the log, questions and sorting', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-ids-'));
  mkdirSync(join(root, '.git'));
  jarl(root, 'init', 'a goal');
  writeFileSync(join(root, '.jarl', 'issues', '007-padded.md'), L.renderIssue({ id: '007', title: 'padded', kind: 'task', priority: '2', tier: 'standard', tags: [], files: [], repo: '', foundBy: 'jarl' }));
  writeFileSync(join(root, '.jarl', 'issues', '8-plain.md'), L.renderIssue({ id: '8', title: 'plain', kind: 'task', priority: '2', tier: 'standard', tags: [], files: [], repo: '', foundBy: 'jarl' }));
  for (const form of ['7', '007', '#7']) assert.match(jarl(root, 'show', form), /^# 007 · padded/, form);
  assert.deepEqual(JSON.parse(jarl(root, 'list', '--json')).map((r) => r.id), ['007', '8'], 'sorted as numbers, each as its file writes it');
  jarl(root, 'after', '8', '7');
  assert.deepEqual(JSON.parse(jarl(root, 'show', '8', '--json')).after, ['007'], 'the After names the issue as its file writes it');
  jarl(root, 'set', '7', 'in-progress', '--worker', 'w1');
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /007 → in-progress/, 'the log writes the issue as its file writes it');
  assert.match(jarl(root, 'show', '007'), /\*\*Status:\*\* in-progress/);
  assert.match(jarl(root, 'show', '#7'), /\*\*Status:\*\* in-progress/);
  assert.match(refuses(root, 'show', '9'), /no such issue: 9/);
  writeFileSync(join(root, '.jarl', 'asks.md'), '# Questions to the user\n\n- **a-007** (open) · stuck · which one?\n');
  assert.match(jarl(root, 'answer', 'a-7', 'the padded one'), /007/);
  assert.match(readFileSync(join(root, '.jarl', 'asks.md'), 'utf8'), /\*\*a-007\*\* \(answered\)/);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /answered a-007 · the padded one/);
  const held = new Map([['007', 1], ['8', 1]]);
  assert.deepEqual([...new Set(L.idsNamed('issues 7 and 007 and 8', held))], ['007', '8']);
  assert.deepEqual([...new Set(L.idsNamed('issues 6-8', held))], ['007', '8']);
});

test('a branch named jarl/7-<slug> or jarl/008-<slug> is the branch of issue 007 or 8, whichever form the issue file carries', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-ids-'));
  mkdirSync(join(root, '.git'));
  jarl(root, 'init', 'a goal');
  writeFileSync(join(root, '.jarl', 'issues', '007-padded.md'), L.renderIssue({ id: '007', title: 'padded', kind: 'task', priority: '2', tier: 'standard', tags: [], files: [], repo: '', foundBy: 'jarl' }));
  writeFileSync(join(root, '.jarl', 'issues', '8-plain.md'), L.renderIssue({ id: '8', title: 'plain', kind: 'task', priority: '2', tier: 'standard', tags: [], files: [], repo: '', foundBy: 'jarl' }));
  rmSync(join(root, '.git'), { recursive: true, force: true });
  sh(root, 'git init -q -b feature && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null && echo a > a.txt && git add -A && git commit -qm base');
  sh(root, 'git checkout -q -b jarl/7-padded && echo b > b.txt && git add -A && git commit -qm w && git checkout -q feature && git checkout -q -b jarl/008-plain && echo c > c.txt && git add -A && git commit -qm w2 && git checkout -q feature');
  const rows = JSON.parse(jarl(root, 'branches', '--base', 'feature', '--json'));
  assert.deepEqual(rows.find((r) => r.branch === 'jarl/7-padded').issues, ['007']);
  assert.deepEqual(rows.find((r) => r.branch === 'jarl/008-plain').issues, ['8']);
});

test('new numbers 1000 after 999, raises the record format before it writes, and the pinned frozen reader then refuses the loop', () => {
  const root = loopAt999();
  assert.equal(formatOf(root), 1);
  assert.equal(oldJarl(root, 'list', {}).ok, true, 'before: 6.1.0 reads the loop');
  const a = JSON.parse(jarl(root, 'new', 'one thousand', '--acceptance', 'it works', '--json'));
  assert.equal(a.id, '1000');
  assert.match(a.file, /1000-one-thousand\.md$/);
  assert.equal(formatOf(root), 2);
  assert.equal(JSON.parse(jarl(root, 'new', 'one thousand one', '--json')).id, '1001');
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /filed 1000 · one thousand\n/);
  for (const command of ['list', 'status']) {
    const r = oldJarl(root, command, {});
    assert.equal(r.ok, false, command);
    assert.match(r.error, /written for record format 2, and this Jarl reads format 1/, command);
  }
  assert.ok(readdirSync(join(root, '.jarl', 'issues')).includes('998-old-998.md'), 'files below 1000 keep their names');
});

test('an existing loop of padded numbers reads and prints as written, and the first issue of 100 stays in format 1', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-ids-'));
  mkdirSync(join(root, '.git'));
  jarl(root, 'init', 'a goal');
  writeFileSync(join(root, '.jarl', 'issues', '099-old.md'), L.renderIssue({ id: '099', title: 'old', kind: 'task', priority: '2', tier: 'standard', tags: [], files: [], repo: '', foundBy: 'jarl' }));
  assert.match(jarl(root, 'show', '99'), /^# 099 · old/);
  const a = JSON.parse(jarl(root, 'new', 'hundred', '--json'));
  assert.equal(a.id, '100');
  assert.match(a.file, /100-hundred\.md$/);
  assert.equal(formatOf(root), 1, 'a number of three digits is written the same padded or not');
  assert.deepEqual(JSON.parse(jarl(root, 'list', '--json')).map((r) => r.id), ['099', '100']);
  assert.equal(oldJarl(root, 'list', {}).ok, true);
});

test('the first write of an unpadded number of 1 to 99 raises the record format, and the frozen reader then refuses the loop', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-ids-'));
  mkdirSync(join(root, '.git'));
  jarl(root, 'init', 'a goal');
  writeFileSync(join(root, '.jarl', 'issues', '007-padded.md'), L.renderIssue({ id: '007', title: 'padded', kind: 'task', priority: '2', tier: 'standard', tags: [], files: [], repo: '', foundBy: 'jarl' }));
  assert.equal(formatOf(root), 1);
  assert.equal(oldJarl(root, 'list', {}).ok, true, 'before: the frozen reader reads the loop');
  assert.equal(JSON.parse(jarl(root, 'new', 'eight', '--json')).id, '8');
  assert.equal(formatOf(root), 2);
  const r = oldJarl(root, 'list', {});
  assert.equal(r.ok, false);
  assert.match(r.error, /written for record format 2, and this Jarl reads format 1/);
});

test('list, queue, next, show, set, after, ranges, review and the log work across 998 to 1001, by the CLI', () => {
  const root = loopAt999();
  jarl(root, 'new', 'thousand', '--acceptance', 'works');
  jarl(root, 'new', 'thousand one', '--acceptance', 'works');
  assert.deepEqual(JSON.parse(jarl(root, 'list', '--json')).map((r) => r.id), ['998', '999', '1000', '1001']);
  assert.deepEqual(JSON.parse(jarl(root, 'next', '--all', '--json')).map((r) => r.id), ['998', '999', '1000', '1001']);
  assert.match(jarl(root, 'show', '1000'), /^# 1000 · thousand/);
  assert.match(jarl(root, 'show', '#1001'), /^# 1001 · thousand one/);
  assert.match(refuses(root, 'show', '1002'), /no such issue: 1002/);
  jarl(root, 'after', '1001', '999,1000');
  assert.deepEqual(JSON.parse(jarl(root, 'show', '1001', '--json')).after, ['999', '1000']);
  assert.deepEqual(JSON.parse(jarl(root, 'next', '--json')).filter((r) => r.ready).map((r) => r.id), ['998', '999', '1000'], '1001 waits on 999 and 1000');
  const tagged = JSON.parse(jarl(root, 'tag', '998-1001', '+range', '--json'));
  assert.deepEqual(tagged.map((r) => r.id), ['998', '999', '1000', '1001']);
  jarl(root, 'prio', '999,1000', '1');
  assert.deepEqual(JSON.parse(jarl(root, 'list', '--json')).map((r) => r.id), ['999', '1000', '998', '1001']);
  jarl(root, 'set', '1000', 'in-progress', '--worker', 'w1');
  assert.match(jarl(root, 'show', '1000'), /\*\*Status:\*\* in-progress/);
  jarl(root, 'evidence', '1000', '--ran', 'npm test', '--saw', 'ok');
  jarl(root, 'review', '1000', 'approve', '--by', 'rev', FINDINGS);
  jarl(root, 'set', '1000', 'done');
  const log = readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
  assert.match(log, /· 1000 review approve · by rev \(fresh\)/);
  assert.match(log, /· 1000 → done/);
  assert.match(jarl(root, 'status'), /done/);
  // The journal is read back by id: the done gate saw the approve logged under 1000.
  assert.match(jarl(root, 'show', '1000'), /\*\*Status:\*\* done/);
});

test('the same commands work by the MCP tool', () => {
  const root = loopAt999();
  assert.match(tool(root, 'jarl_new', { title: 'thousand', acceptance: ['works'] }), /1000/);
  assert.match(tool(root, 'jarl_new', { title: 'thousand one' }), /1001/);
  assert.equal(formatOf(root), 2);
  const ids = JSON.parse(tool(root, 'jarl_list', { json: true })).map((r) => r.id);
  assert.deepEqual(ids, ['998', '999', '1000', '1001']);
  assert.match(tool(root, 'jarl_show', { id: '1000' }), /^# 1000 · thousand/);
  tool(root, 'jarl_after', { id: '1001', ids: '998-1000' });
  assert.deepEqual(JSON.parse(tool(root, 'jarl_show', { id: '1001', json: true })).after, ['998', '999', '1000']);
  tool(root, 'jarl_set', { ids: '1000', status: 'in-progress', worker: 'w1' });
  tool(root, 'jarl_review', { ids: '1000', verdict: 'approve', findings: FINDINGS, by: 'rev' });
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /· 1000 review approve/);
  assert.match(tool(root, 'jarl_ask', { question: 'which?', issue: '1000' }), /a-1\b/);
});

test('questions: a-1000 and an issue 1000 in a question read and write the same, and the first of either raises the format', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-ids-'));
  mkdirSync(join(root, '.git'));
  jarl(root, 'init', 'a goal');
  writeFileSync(join(root, '.jarl', 'asks.md'), '# Questions to the user\n\n- **a-999** (answered) · stuck · old\n');
  assert.equal(formatOf(root), 1);
  const q = JSON.parse(jarl(root, 'ask', 'which one?', '--json'));
  assert.equal(q.id, '1000');
  assert.equal(formatOf(root), 2, 'the ask a-1000 raised the format before it wrote');
  assert.match(readFileSync(join(root, '.jarl', 'asks.md'), 'utf8'), /\*\*a-1000\*\* \(open\) · stuck · which one\?/);
  assert.match(jarl(root, 'answer', 'a-1000', 'this one'), /1000/);
  assert.match(readFileSync(join(root, '.jarl', 'asks.md'), 'utf8'), /\*\*a-1000\*\* \(answered\)/);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /answered a-1000 · this one/);
  assert.deepEqual(L.loadAsks(root).map((a) => a.id), ['999', '1000']);
  // A question naming an issue of 1000 or more raises the format as well.
  const other = loopAt999();
  jarl(other, 'new', 'thousand');
  const raised = formatOf(other);
  assert.equal(raised, 2);
  jarl(other, 'ask', 'about it', '--issue', '1000');
  assert.match(readFileSync(join(other, '.jarl', 'asks.md'), 'utf8'), /\(open\) · stuck · issue 1000 · about it/);
  assert.equal(L.loadAsks(other)[0].issue, '1000');
});

test('a branch named jarl/1000-slug (and jarl/999-slug, a number of three digits) is recognised as carrying its issue', () => {
  const root = loopAt999();
  jarl(root, 'new', 'thousand');
  rmSync(join(root, '.git'), { recursive: true, force: true });
  sh(root, 'git init -q -b feature && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null && echo a > a.txt && git add -A && git commit -qm base');
  sh(root, 'git checkout -q -b jarl/1000-thousand && echo b > b.txt && git add -A && git commit -qm w && git checkout -q -b jarl/999-old feature && echo c > c.txt && git add -A && git commit -qm w2 && git checkout -q feature');
  const rows = JSON.parse(jarl(root, 'branches', '--base', 'feature', '--json'));
  assert.deepEqual(rows.find((r) => r.branch === 'jarl/1000-thousand').issues, ['1000']);
  assert.deepEqual(rows.find((r) => r.branch === 'jarl/999-old').issues, ['999']);
});

test('idsNamed counts only ids the loop holds: never a year, a date, a hash, a version or a piece of a longer number', () => {
  const held = new Map([['2026', 1], ['450', 1], ['1000', 1], ['398', 1]]);
  const text = 'found 2026-10-15 by 1b066c7 in 6.2.0 and v1.450.2 at 2026-10 12:30, deadbeef2026, reviewer-450, raport-398, (1000), 12345, 777';
  assert.deepEqual(L.idsNamed(text, held), ['450', '398', '1000']);
  assert.deepEqual(L.idsNamed('2026', held), ['2026'], 'a number that is an issue the loop holds still counts when it stands alone');
  assert.deepEqual(L.idsNamed('', held), []);
});

test('idsNamed reads a range of ids of any length whole, and a date still yields none', () => {
  const held = new Map(['998', '999', '1000', '1001', '1002', '2026'].map((id) => [id, 1]));
  assert.deepEqual(L.idsNamed('998-1002', held), ['998', '999', '1000', '1001', '1002'], 'a range names every id the loop holds inside it');
  assert.deepEqual(L.idsNamed('1000-1002', held), ['1000', '1001', '1002']);
  assert.deepEqual(L.idsNamed('998-1002', new Set(['998', '1000', '1002', '1500'])), ['998', '1000', '1002'], 'only the held ones');
  assert.deepEqual(L.idsNamed('1002-998', held), ['1002', '998'], 'a backwards range is not expanded');
  assert.deepEqual(L.idsNamed('see 998-999, 1000-1001 and 2026-10-15', held), ['998', '999', '1000', '1001']);
  assert.deepEqual(L.idsNamed('2026-10-15', held), []);
  assert.deepEqual(L.idsNamed('2026-10-15 12:30', held), []);
  assert.deepEqual(L.idsNamed('2026-10', held), []);
});

test('idsNamed takes a number of one or two digits only when it is introduced: #N, or after issue, issues or ticket', () => {
  const held = new Map([['002', 1], ['7', 1], ['8', 1], ['9', 1], ['10', 1]]);
  assert.deepEqual(L.idsNamed('jarl-2-B2 and step 7 of 8', held), [], 'bare short numbers in free text name nothing');
  assert.deepEqual(L.idsNamed('#7', held), ['7']);
  assert.deepEqual(L.idsNamed('issue 2', held), ['002']);
  assert.deepEqual(L.idsNamed('ticket 10', held), ['10']);
  assert.deepEqual([...new Set(L.idsNamed('issues 7, 8 and 9', held))], ['7', '8', '9'], 'a list that follows the word counts each number');
  assert.deepEqual(L.idsNamed('issues 7-9', held), ['7', '8', '9'], 'a range that follows the word counts every held number in it');
  assert.deepEqual(L.idsNamed('found 7 things in issue 8, then 9 more', held), ['8'], 'the list ends at the first word that is not a separator');
  assert.deepEqual(L.idsNamed('version 1.7.0 and 2026-10-15', held), [], 'a dotted version and a date name nothing');
});

test('a new number is plain on the command line and three digits from the record library, which reads both the same', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-ids-'));
  mkdirSync(join(root, '.git'));
  jarl(root, 'init', 'a goal');
  const lib = R.newIssue(root, 'library');
  assert.equal(lib.id, '001');
  assert.match(lib.file, /[\\/]001-library\.md$/);
  assert.equal(formatOf(root), 1, 'a three-digit number raises nothing');
  assert.equal(JSON.parse(jarl(root, 'new', 'command', '--json')).id, '2', 'the command line writes the next number plain');
  assert.equal(formatOf(root), 2);
  assert.match(jarl(root, 'show', '1'), /^# 001 · library/, 'both writings read the same issue');
  assert.match(jarl(root, 'show', '#2'), /^# 2 · command/);
  const q = R.ask(root, 'which?', { kind: 'stuck' });
  assert.equal(q.id, '001', 'the library numbers its question with three digits too');
  assert.equal(JSON.parse(jarl(root, 'ask', 'other', '--json')).id, '2');
});
