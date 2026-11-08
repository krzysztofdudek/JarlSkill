// A declared file is one key however its path is spelled: a leading ./, a . segment, a doubled or trailing slash, and on
// Windows a backslash. next, the lease, scope and field Files --add and --remove all read the same key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, jarl, refuses } from './helpers.mjs';
import { normalPath } from '../lib/where.mjs';

const SPELLINGS = ['src/a.mjs', './src/a.mjs', 'src//a.mjs', 'src/./a.mjs', 'src/a.mjs/', './src//a.mjs//', '././src/a.mjs'];

test('a path is normalised to one key, and what is not a spelling of the same file stays apart', () => {
  for (const s of SPELLINGS) assert.equal(normalPath(s, 'linux'), 'src/a.mjs', s);
  assert.equal(normalPath('src\\a.mjs', 'win32'), 'src/a.mjs');
  assert.equal(normalPath('.\\src\\\\a.mjs\\', 'win32'), 'src/a.mjs');
  assert.equal(normalPath('src\\a.mjs', 'linux'), 'src\\a.mjs', 'a backslash is an ordinary character of a name outside Windows');
  assert.equal(normalPath('/abs//x/', 'linux'), '/abs/x');
  assert.equal(normalPath('//server/share/x/', 'win32'), '//server/share/x');
  assert.equal(normalPath('../a.mjs'), '../a.mjs', 'a .. segment is kept as written');
  assert.equal(normalPath('src/A.mjs'), 'src/A.mjs', 'case is kept');
  assert.equal(normalPath('./'), '.');
  assert.equal(normalPath('src/'), 'src');
});

test('next holds an issue back on a file another declares, whatever the spelling', () => {
  const { dir: root } = gitRepo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'first', '--acceptance', '[read] it works', '--files', 'src/a.mjs', '--prio', '1');
  SPELLINGS.slice(1).forEach((s, n) => jarl(root, 'new', `other ${n}`, '--acceptance', '[read] it works', '--files', s));
  const rows = JSON.parse(jarl(root, 'next', '--all', '--json'));
  assert.deepEqual(rows.filter((r) => r.ready).map((r) => r.id), ['1'], 'only the first is ready: every spelling is the file it declares');
  for (const r of rows.filter((x) => x.id !== '1')) assert.equal(r.waitsOn.length, 1, `issue ${r.id} waits on the one file`);
});

test('a lease on a file refuses another lease on it under another spelling', () => {
  const { dir: root } = gitRepo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'first', '--acceptance', '[read] it works', '--files', 'src/a.mjs');
  jarl(root, 'new', 'second', '--acceptance', '[read] it works', '--files', './src//a.mjs');
  jarl(root, 'set', '1', 'in-progress', 'raised', '--worker', 'w1', '--branch', 'jarl/1-a');
  assert.match(refuses(root, 'set', '2', 'in-progress', 'raised', '--worker', 'w2', '--branch', 'jarl/2-a'), /declares \.\/src\/\/a\.mjs, which 1 holds in its lease/);
});

test('field Files --add and --remove treat the spellings of one file as one item', () => {
  const { dir: root } = gitRepo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'thing', '--acceptance', '[read] it works', '--files', 'src/a.mjs');
  assert.equal(jarl(root, 'field', '1', 'Files', '--add', './src/a.mjs,src//a.mjs,src/b.mjs,./src/b.mjs/'), '1 Files: src/a.mjs, src/b.mjs');
  assert.equal(jarl(root, 'field', '1', 'Files', '--remove', './src//a.mjs/'), '1 Files: src/b.mjs');
  assert.equal(jarl(root, 'field', '1', 'Files', '--remove', 'src/./b.mjs'), '1 Files: (cleared)');
});

test('scope reads a declared file under any spelling as the file the diff changes', () => {
  const { dir: root, g } = gitRepo();
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.mjs'), 'export const a = 1;\n');
  g('add', '-A'); g('commit', '-qm', 'src');
  jarl(root, 'init', 'goal', '--committed');
  jarl(root, 'new', 'change a', '--acceptance', '[read] it works', '--files', './src//a.mjs');
  g('add', '-A'); g('commit', '-qm', 'jarl');
  g('checkout', '-qb', 'jarl/1-change-a');
  writeFileSync(join(root, 'src', 'a.mjs'), 'export const a = 2;\n');
  g('add', '-A'); g('commit', '-qm', 'work');
  g('checkout', '-q', 'feature');
  const out = JSON.parse(jarl(root, 'scope', '1', '--branch', 'jarl/1-change-a', '--base', 'feature', '--json'));
  const inside = out.items.find((i) => i.name === 'diff inside declared files');
  assert.equal(inside.ok, true, inside.note);
});
