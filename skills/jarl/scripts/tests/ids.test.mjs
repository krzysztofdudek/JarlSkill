// The one id grammar: three or more digits, padded to three below 1000, compared as numbers. A loop that reaches 1000 keeps
// working in every command, by the CLI and by the MCP tool, and the first id of 1000 or more raises the record format so
// the pinned Jarl 6.1.0 (which would skip such a file in silence) refuses the loop loudly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sh } from './portable.mjs';
import { oldJarl } from './old-jarl.mjs';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const L = await import('../jarl-lib.mjs');
const mcp = await import('../jarl-mcp.mjs');

function jarl(root, ...args) {
  return execFileSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function refuses(root, ...args) {
  try { jarl(root, ...args); } catch (e) { return String(e.stderr); }
  throw new Error('expected a refusal');
}
const tool = (root, name, input = {}) => mcp.callTool(name, { root, ...input }).content[0].text;
const markerPath = (root) => join(root, '.jarl', 'profile.json');
const formatOf = (root) => (existsSync(markerPath(root)) ? JSON.parse(readFileSync(markerPath(root), 'utf8')).format : 1);

// A loop that already holds issues 998 and 999, written as 6.1.0 would have: the next number is 1000.
function loopAt999() {
  const root = mkdtempSync(join(tmpdir(), 'jarl-ids-'));
  mkdirSync(join(root, '.git'));
  jarl(root, 'init', 'a goal');
  for (const id of ['998', '999']) {
    writeFileSync(join(root, '.jarl', 'issues', `${id}-old-${id}.md`), L.renderIssue({ id, title: `old ${id}`, kind: 'task', priority: '2', tier: 'standard', tags: [], files: [], repo: '', foundBy: 'jarl' }));
  }
  return root;
}

test('padId, cmpId and the id pattern: three digits below 1000, as many as needed from 1000, compared as numbers', () => {
  assert.equal(L.padId('7'), '007');
  assert.equal(L.padId('#195'), '195');
  assert.equal(L.padId('0007'), '007');
  assert.equal(L.padId('1000'), '1000');
  assert.equal(L.padId(1001), '1001');
  assert.deepEqual(['1000', '999', '1001', '998'].sort(L.cmpId), ['998', '999', '1000', '1001']);
  assert.deepEqual(L.expandIds('998-1002'), ['998', '999', '1000', '1001', '1002']);
  assert.deepEqual(L.expandIds('#7,999,1000'), ['007', '999', '1000']);
  assert.equal(L.needsRaisedFormat('999'), false);
  assert.equal(L.needsRaisedFormat('1000'), true);
});

test('new numbers 1000 after 999, raises the record format before it writes, and the pinned 6.1.0 then refuses the loop', () => {
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

test('a loop below 1000 stays format 1, and files 001-999 are padded to three', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-ids-'));
  mkdirSync(join(root, '.git'));
  jarl(root, 'init', 'a goal');
  assert.equal(JSON.parse(jarl(root, 'new', 'first', '--json')).id, '001');
  assert.equal(formatOf(root), 1);
  assert.equal(oldJarl(root, 'list', {}).ok, true);
});

test('list, queue, next, show, set, after, ranges, review and the log work across 998 to 1001, by the CLI', () => {
  const root = loopAt999();
  jarl(root, 'new', 'thousand', '--acceptance', 'works');
  jarl(root, 'new', 'thousand one', '--acceptance', 'works');
  assert.deepEqual(JSON.parse(jarl(root, 'list', '--json')).map((r) => r.id), ['998', '999', '1000', '1001']);
  assert.deepEqual(JSON.parse(jarl(root, 'next', '--json')).map((r) => r.id), ['998', '999', '1000', '1001']);
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
  jarl(root, 'review', '1000', 'approve', '--by', 'rev', 'fine');
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
  tool(root, 'jarl_review', { ids: '1000', verdict: 'approve', findings: 'fine', by: 'rev' });
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /· 1000 review approve/);
  assert.match(tool(root, 'jarl_ask', { question: 'which?', issue: '1000' }), /a-001/);
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

test('a branch named jarl/1000-slug (and the old jarl/NNN- of three digits) is recognised as carrying its issue', () => {
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
  assert.deepEqual(L.idsNamed('998-1002', held), ['998', '1002'], 'both ends of a range are ids; the ones between are not named');
  assert.deepEqual(L.idsNamed('1000-1002', held), ['1000', '1002']);
  assert.deepEqual(L.idsNamed('see 998-999, 1000-1001 and 2026-10-15', held), ['998', '999', '1000', '1001']);
  assert.deepEqual(L.idsNamed('2026-10-15', held), []);
  assert.deepEqual(L.idsNamed('2026-10-15 12:30', held), []);
  assert.deepEqual(L.idsNamed('2026-10', held), []);
});
