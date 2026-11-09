// A command that needs a loop, run where there is none, says so and ends with its own form naming the root, instead of
// failing on a missing file or on an issue that cannot exist. Nothing is written, and no .jarl/ appears.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { jarl, refuses, posixForms, spawnJarl } from './helpers.mjs';
import { SHELLS, run, runPrinted } from './walk.mjs';

const mcp = await import('../jarl-mcp.mjs');

const empty = () => mkdtempSync(join(tmpdir(), 'jarl-no-loop-'));

// Every command that writes the loop, with a call that is right in every other way.
const WRITING = [
  ['new', 'a title'], ['renumber', '1'], ['import', 'findings.md'], ['set', '1', 'done', 'finished'], ['field', '1', 'Why', 'because'],
  ['split', '1'], ['base', 'name', 'main'], ['merged', '1', '--sha', 'abcd1234'], ['evidence', '1', 'a note'],
  ['retract', '1', '1', 'it was read wrongly', '--by', 'w'], ['review', '1', 'approve', 'read the diff and found nothing', '--by', 'r'],
  ['round', '1', 'the test failed again'], ['tick', '1', 'a line', '--by', 'owner'], ['ask', 'a question'], ['answer', 'a-1', 'yes', '--by', 'owner'],
  ['log', 'a note'], ['decide', 'a-slug', 'a ruling', '--by', 'jarl'], ['goal', '--set', 'a goal'], ['archive', 'a-slug'], ['mode', 'manual'], ['close'],
];
// The view that reads it and refuses where none is; the other views read an empty loop there.
const READING = [['resume']];

for (const call of [...WRITING, ...READING]) {
  test(`${call[0]} where there is no loop says so and ends with its form naming the root`, () => {
    const dir = empty();
    const said = refuses(dir, ...call).trim().split('\n');
    assert.match(said[0], /^no loop here: .*\S+ holds no \.jarl\/ — open one with jarl\.mjs init "<goal>"( --root \S+)?, or pass --root "<loop-root>", the directory that holds \.jarl\/$/);
    assert.equal(said.length, 2, said.join('\n'));
    assert.equal(said[1], 'jarl.mjs init "<goal>" --by "<who>"');
    assert.deepEqual(readdirSync(dir), [], 'nothing was written');
  });
}

test('the tools say there is no loop where a root holds none, with the form naming the root', () => {
  const dir = empty();
  for (const [tool, args] of [['jarl_ask', { text: 'a question' }], ['jarl_log', { text: 'a note' }], ['jarl_decide', { slug: 'a-slug', text: 'a ruling', by: 'jarl' }]]) {
    const said = mcp.callTool(tool, { by: 'jarl', ...args, root: dir });
    assert.ok(said.isError, tool);
    assert.match(posixForms(said.content[0].text), /^no loop here: .*\S+ holds no \.jarl\/ — open one with jarl\.mjs init "<goal>" '--root=[^']+', or pass --root "<loop-root>", the directory that holds \.jarl\/\njarl\.mjs init "<goal>" --by "<who>" '--root=[^']+'$/, tool);
  }
  assert.deepEqual(readdirSync(dir), []);
});

test('the commands that run without a loop still do', () => {
  const dir = empty();
  assert.match(refuses(dir, 'init').trim(), /init requires its goal/);
  assert.match(refuses(dir, 'models').trim(), /no loop to read here/);
  assert.equal(jarl(dir, 'list'), '(none)');
  assert.match(jarl(dir, 'status'), /^open 0/);
});

// A root is echoed in the reason, so it must neither start a line nor run when the whole message is pasted into a shell.
// The commands that write are checked, as are the view that refuses and the tools.
const CALLS = [...WRITING, ...READING];
const rooted = (name) => { const dir = join(mkdtempSync(join(tmpdir(), 'jarl-no-loop-')), name); mkdirSync(dir); return dir; };
const pastedNothing = (said) => {
  for (const sh of SHELLS) {
    const where = empty();
    runPrinted(where, said, sh);
    assert.deepEqual(readdirSync(where), [], `${sh}: pasting the whole message made a file: ${JSON.stringify(said.split('\n')[0])}`);
  }
};

// The root names no directory at all: the refusal needs none, so the test holds on every platform, Windows too, where a
// directory whose name holds a line break cannot be made.
test('a root whose name holds a line break and no loop is echoed with the break escaped: no word of it starts a line', () => {
  const dir = join(empty(), 'loops\njarl.mjs field 4 Priority 1 holds no .jarl');
  for (const call of CALLS) {
    const r = spawnJarl(dir, call);
    assert.notEqual(r.status, 0, call.join(' '));
    const said = r.stderr.replace(/\n+$/, '').split('\n');
    assert.equal(said.length, 2, `${call[0]}: ${JSON.stringify(r.stderr)}`);
    assert.match(said[0], /^no loop here: '.*loops\\njarl\.mjs field 4 Priority 1 holds no \.jarl' holds no \.jarl\//, call[0]);
    assert.equal(said.filter((l) => l.startsWith('jarl.mjs ')).length, 1, `${call[0]}: one command, the form: ${JSON.stringify(r.stderr)}`);
    assert.equal(said[1], 'jarl.mjs init "<goal>" --by "<who>" --root "<loop-root>"', `${call[0]}: the form names the loop root by its placeholder`);
    assert.equal(existsSync(dir), false, 'nothing was written: the root was not made');
    assert.deepEqual(readdirSync(dirname(dir)), [], 'nothing was written beside it');
    pastedNothing(r.stderr);
  }
});

test('a root whose name holds a command substitution and no loop is echoed in single quotes: pasted whole, the message runs nothing', () => {
  const dir = rooted('$(touch made-by-paste)');
  for (const call of CALLS) {
    const r = spawnJarl(dir, call);
    assert.notEqual(r.status, 0, call.join(' '));
    const said = r.stderr.replace(/\n+$/, '').split('\n');
    assert.equal(said.length, 2, `${call[0]}: ${JSON.stringify(r.stderr)}`);
    assert.match(said[0], /^no loop here: '.*\$\(touch made-by-paste\)' holds no \.jarl\//, call[0]);
    assert.equal(said.filter((l) => l.startsWith('jarl.mjs ')).length, 1, `${call[0]}: one command, the form: ${JSON.stringify(r.stderr)}`);
    assert.match(said[1], /^jarl\.mjs init "<goal>" --by "<who>" --root /, `${call[0]}: the form carries the call's root`);
    assert.deepEqual(readdirSync(dir), [], 'nothing was written');
    pastedNothing(r.stderr);
  }
});

test('models with a root whose name holds a line break and no loop echoes it with the break escaped: no word of it starts a line', () => {
  const dir = join(empty(), 'loops\njarl.mjs field 4 Priority 1 holds no .jarl');
  const r = spawnJarl(dir, ['models']);
  assert.notEqual(r.status, 0);
  const said = r.stderr.replace(/\n+$/, '').split('\n');
  assert.equal(said.length, 2, JSON.stringify(r.stderr));
  assert.match(said[0], /^no loop to read here: '.*loops\\njarl\.mjs field 4 Priority 1 holds no \.jarl' holds no live loop — /);
  assert.equal(said[1], 'jarl.mjs models --with "<loop-root>" --root "<loop-root>"');
  assert.equal(existsSync(dir), false, 'nothing was written: the root was not made');
  pastedNothing(r.stderr);
});

test('models with a root whose name holds a command substitution and no loop echoes it in single quotes: pasted whole, the message runs nothing', () => {
  const dir = rooted('$(touch made-by-paste)');
  const r = spawnJarl(dir, ['models']);
  assert.notEqual(r.status, 0);
  const said = r.stderr.replace(/\n+$/, '').split('\n');
  assert.equal(said.length, 2, JSON.stringify(r.stderr));
  assert.match(said[0], /^no loop to read here: '.*\$\(touch made-by-paste\)' holds no live loop — /);
  assert.match(said[1], /^jarl\.mjs models --with "<loop-root>" --root /);
  assert.deepEqual(readdirSync(dir), [], 'nothing was written');
  pastedNothing(r.stderr);
});

test('a relative --repo that is no repository, under a root whose name holds a command substitution, echoes the root and the path in single quotes', () => {
  const dir = rooted('$(touch made-by-paste)');
  jarl(dir, 'init', 'goal');
  mkdirSync(join(dir, 'inner'));
  for (const repo of ['./nope', './inner']) {
    const r = spawnJarl(dir, ['new', 'one', '--acceptance', '[read] it works', '--repo', repo]);
    assert.notEqual(r.status, 0, repo);
    const said = r.stderr.replace(/\n+$/, '').split('\n');
    assert.match(said[0], /^not a git repository: '.*\$\(touch made-by-paste\)[\\/](nope|inner)' /, repo);
    assert.ok(said[0].includes(`'${join(dir, repo.slice(2))}'`), `${repo}: the path is echoed in single quotes: ${said[0]}`);
    if (repo === './inner') assert.ok(said[0].includes(`read from the loop's root, '${dir}'`), `the root is echoed in single quotes: ${said[0]}`);
    pastedNothing(r.stderr);
  }
  assert.deepEqual(readdirSync(dir).sort(), ['.jarl', 'inner'], 'nothing was written');
});

test('a call that gave no root ends with the form that names none: the reason still tells how to point at a loop', () => {
  for (const call of CALLS) {
    const cwd = empty();
    const r = run(cwd, call);
    assert.notEqual(r.status, 0, call.join(' '));
    const said = r.stderr.replace(/\n+$/, '').split('\n');
    assert.equal(said.length, 2, `${call[0]}: ${JSON.stringify(r.stderr)}`);
    assert.match(said[0], /^no loop here: '.+' holds no \.jarl\/ — open one with jarl\.mjs init "<goal>", or pass --root "<loop-root>", the directory that holds \.jarl\/$/, call[0]);
    assert.equal(said[1], 'jarl.mjs init "<goal>" --by "<who>"', `${call[0]}: no --root in a form of a call that gave none`);
    assert.deepEqual(readdirSync(cwd), [], 'nothing was written');
  }
});
