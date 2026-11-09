// The record's format: goal.md holds one machine line, written by init, and Jarl reads a loop that holds it and refuses
// every other one before anything else is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { jarl, loop, refuses, SCRIPT } from './helpers.mjs';
import { COMMAND_ARGS, MUTATING } from '../jarl.mjs';
const mcp = await import('../jarl-mcp.mjs');

const R = await import('../record.mjs');

const CONVERSION = 'references/converting-from-6-2.md';
const goalFile = (root) => join(root, '.jarl', 'goal.md');
const goalText = (root) => readFileSync(goalFile(root), 'utf8');
const formatLines = (root) => goalText(root).split('\n').filter((l) => /^Format:/.test(l));

// Every file under a directory with its size and modification time, to prove nothing was written.
function snapshot(dir) {
  const out = {};
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const s = statSync(p); if (s.isDirectory()) walk(p); else out[p] = `${s.size} ${s.mtimeMs}`; } };
  walk(dir);
  return out;
}
// A loop whose goal holds the given text in place of the format line, or no such line when the text is null.
function loopWithMark(mark) {
  const root = loop({ via: 'cli' });
  jarl(root, 'new', 'one', '--acceptance', '[read] it works', '--by', 'jarl');
  const lines = goalText(root).split('\n');
  const at = lines.indexOf('Format: 4');
  assert.notEqual(at, -1, 'init writes the line');
  if (mark === null) lines.splice(at, 1); else lines[at] = mark;
  writeFileSync(goalFile(root), lines.join('\n'));
  return root;
}
const WRONG_MARKS = [['no line', null], ['an older number', 'Format: 3'], ['a newer number', 'Format: 5'], ['no number', 'Format:'], ['words in the number', 'Format: 4 or so']];

// A word for each argument of a command, so that a call is complete and only the format can refuse it.
const argsOf = (cmd) => (COMMAND_ARGS[cmd] || []).filter((a) => !/[?.]$/.test(a)).map((a) => ({ ids: '1', id: '1', status: 'open', verdict: 'approve', slug: 'a-slug', part: 'section', name: 'Extra', mode: 'permanent', line: '1', entry: 'review', branch: 'main' }[a] ?? 'some text'));

test('init writes one line that says the format, and a loop it opened is read', () => {
  const cli = loop({ via: 'cli' });
  assert.deepEqual(formatLines(cli), ['Format: 4']);
  assert.match(jarl(cli, 'status'), /goal/);
  const library = loop();
  assert.deepEqual(formatLines(library), ['Format: 4']);
});

for (const [name, mark] of WRONG_MARKS) {
  test(`a loop with ${name} in its goal is refused by every command, with nothing read or written, and the refusal names the conversion file`, () => {
    const root = loopWithMark(mark);
    const before = snapshot(join(root, '.jarl'));
    for (const cmd of Object.keys(COMMAND_ARGS)) {
      const said = refuses(root, cmd, ...argsOf(cmd), ...(MUTATING.has(cmd) ? ['--by', 'jarl'] : []));
      assert.match(said, new RegExp(CONVERSION.replace('.', '\\.')), `${cmd}: ${said}`);
    }
    assert.deepEqual(snapshot(join(root, '.jarl')), before);
  });
}

test('the refusal of a wrong format comes before every other refusal of the call', () => {
  const root = loopWithMark('Format: 3');
  assert.match(refuses(root, 'set', '99', 'not-a-status', '--by', 'jarl'), /converting-from-6-2/);
  assert.match(refuses(root, 'list', '--status', 'not-a-status'), /converting-from-6-2/);
});

test('the refusal of a wrong format holds for the library, on a read and on a write', () => {
  const root = loopWithMark(null);
  assert.throws(() => R.loadIssues(root), /converting-from-6-2/);
  assert.throws(() => R.statusData(root), /converting-from-6-2/);
  assert.throws(() => R.newIssue(root, 'two', { acceptance: '[read] it works' }), /converting-from-6-2/);
  assert.throws(() => R.initLoop(root, 'another goal'), /converting-from-6-2/);
});

test('the refusal of a wrong format holds for a tool of the server', () => {
  const root = loopWithMark(null);

  const r = mcp.callTool('jarl_list', { root });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /converting-from-6-2/);
});

test('goal.md with two format lines names no one format and is refused', () => {
  const root = loop({ via: 'cli' });
  writeFileSync(goalFile(root), `${goalText(root)}\nFormat: 4\n`);
  assert.match(refuses(root, 'status'), /converting-from-6-2/);
});

test('a directory with no loop in it is not refused, and init opens one', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-format-none-'));
  mkdirSync(join(root, '.git'));
  jarl(root, 'init', 'a goal', '--by', 'jarl');
  assert.deepEqual(formatLines(root), ['Format: 4']);
});

test('--version and --help answer whatever the loop holds', () => {
  const root = loopWithMark(null);
  for (const args of [['--version'], ['--help']]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
  }
});

test('no command changes the line', () => {
  const root = loop({ via: 'cli' });
  const before = goalText(root);
  jarl(root, 'goal', '--set', 'Check: npm test', '--by', 'jarl');
  jarl(root, 'new', 'one', '--acceptance', '[read] it works', '--by', 'jarl');
  jarl(root, 'set', '1', 'dropped', 'not needed', '--by', 'jarl');
  jarl(root, 'field', '1', 'Why', 'because', '--by', 'jarl');
  assert.deepEqual(formatLines(root), ['Format: 4']);
  assert.ok(goalText(root).startsWith(before.split('## Assumptions')[0].trimEnd()));
  assert.match(refuses(root, 'goal', '--set', 'Format: 5', '--by', 'jarl'), /machine line/);
  assert.deepEqual(formatLines(root), ['Format: 4']);
});

test('a goal text that holds a line that reads as the format line is refused, with nothing opened', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-format-text-'));
  mkdirSync(join(root, '.git'));
  const said = refuses(root, 'init', 'a goal\nFormat: 3', '--by', 'jarl');
  assert.match(said, /Format:/);
  assert.deepEqual(readdirSync(root), ['.git']);
});

// An archived loop of the record before this one: the marker its profile.json held, and lines of the shape before the writer.
function archiveOfTheFormatBefore(root, name = 'old') {
  const dir = join(root, '.jarl', 'archive', name);
  mkdirSync(join(dir, 'issues'), { recursive: true });
  writeFileSync(join(dir, 'profile.json'), JSON.stringify({ 'jarl-profile': 1, format: 2 }));
  writeFileSync(join(dir, 'goal.md'), '# Goal\n\nthe goal of before\n');
  writeFileSync(join(dir, 'log.md'), '# Log\n\n- 2026-09-01 08:00 · opened · the goal of before\n- 2026-09-01 08:01 · filed 1 · one\n');
  writeFileSync(join(dir, 'issues', '1-one.md'), '# 1 · one\n\n**Status:** open\n**Priority:** 2\n**Tier:** standard\n**Kind:** task\n**Tags:** \n\n## What\n\nx\n');
  return dir;
}

test('an archive of the format before is read by models, its marker no profile and its lines not placed, and nothing refuses', () => {
  const root = loop({ via: 'cli' });
  const dir = archiveOfTheFormatBefore(root);
  const archives = spawnSync(process.execPath, [SCRIPT, 'models', '--archives', '--root', root], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(archives.status, 0, archives.stderr);
  const named = spawnSync(process.execPath, [SCRIPT, 'models', '--with', dir, '--root', root], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(named.status, 0, named.stderr);
});

test('a marker in a live loop of this format is still refused as a profile that does not validate', () => {
  const root = loop({ via: 'cli' });
  writeFileSync(join(root, '.jarl', 'profile.json'), JSON.stringify({ 'jarl-profile': 1, format: 2 }));
  assert.notEqual(spawnSync(process.execPath, [SCRIPT, 'status', '--root', root], { encoding: 'utf8', timeout: 60_000 }).status, 0);
});

test('models --with a live loop of another format is refused, naming the conversion file and writing nothing, by its root and by its .jarl', () => {
  const root = loop({ via: 'cli' });
  const other = loopWithMark(null);
  const before = snapshot(other);
  for (const given of [other, join(other, '.jarl')]) {
    const r = spawnSync(process.execPath, [SCRIPT, 'models', '--with', given, '--root', root], { encoding: 'utf8', timeout: 60_000 });
    assert.notEqual(r.status, 0, given);
    assert.ok(r.stderr.includes(CONVERSION), r.stderr);
  }
  assert.deepEqual(snapshot(other), before);
});
