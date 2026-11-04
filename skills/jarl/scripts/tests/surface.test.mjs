// The command surface: one command changes every part of an issue's description, with one grammar for setting, adding,
// removing and clearing; a command or a spelling the surface does not have is refused with one line that ends with the
// call that does it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jarl, refuses, loop as makeLoop, gitRepo } from './helpers.mjs';
import * as R from '../record.mjs';

const L = await import('../jarl-lib.mjs');
const mcp = await import('../jarl-mcp.mjs');

const PROFILE = { 'jarl-profile': 1, name: 'fielded', statuses: L.BUILTIN_STATUSES, fields: { Area: { enum: ['core', 'cli'] } }, sections: ['Design'] };
function fieldedLoop() {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-surface-profile-'));
  const file = join(dir, 'profile.json');
  writeFileSync(file, JSON.stringify(PROFILE));
  const root = makeLoop({ prefix: 'jarl-surface-', goal: 'a goal', via: 'cli', initFlags: ['--profile', file] });
  jarl(root, 'new', 'first', '--tier', 'light', '--field', 'Area=core', '--what', 'old what', '--acceptance', 'old line', '--section', 'Design=old design');
  jarl(root, 'new', 'second', '--tier', 'light');
  jarl(root, 'new', 'third', '--tier', 'light');
  return root;
}
const logLines = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8').split('\n').filter(Boolean).map((l) => l.replace(/^- \d{4}-\d{2}-\d{2} \d{2}:\d{2}(?: key \S+)?(?: by \S+)? · /, ''));
const lastLine = (root) => logLines(root).at(-1);
const issue = (root, id) => R.findIssue(root, id);

test('field writes every section of the description: a value replaces it, --add adds to it, --clear empties it', () => {
  const root = fieldedLoop();
  assert.equal(jarl(root, 'field', '1', 'What', 'new what', '--by', 'w-one'), '1 What: new what');
  assert.equal(lastLine(root), '1 body · what · was "old what" (8 characters) · by w-one', 'a section logs what it held, as every description change does');
  jarl(root, 'field', '1', 'what', 'more what', '--add');
  assert.equal(issue(root, '1').sections.what.trim(), 'new what\n\nmore what', 'a name is matched in any case, and --add puts a paragraph after the text');
  jarl(root, 'field', '1', 'Why', 'because');
  assert.equal(issue(root, '1').sections.why.trim(), 'because');
  jarl(root, 'field', '1', 'Acceptance', 'line a\nline b');
  assert.equal(issue(root, '1').sections.acceptance.trim(), '- line a\n- line b', 'Acceptance takes one item per line');
  jarl(root, 'field', '1', 'Acceptance', 'line c', '--add');
  assert.equal(issue(root, '1').sections.acceptance.trim(), '- line a\n- line b\n- line c', '--add gives the list a line');
  jarl(root, 'field', '1', 'Changelog', 'Fixed: one');
  jarl(root, 'field', '1', 'Changelog', 'Added: two', '--add');
  assert.equal(issue(root, '1').sections.changelog.trim(), '- Fixed: one\n- Added: two');
  jarl(root, 'field', '1', 'Design', 'more design', '--add');
  assert.equal(issue(root, '1').sections.design.trim(), 'old design\n\nmore design', 'a section the profile declares is a part like the others');
  jarl(root, 'field', '1', 'Why', '--clear');
  assert.equal((issue(root, '1').sections.why ?? '').trim(), '', '--clear empties a section');
  jarl(root, 'field', '1,2', 'What', 'shared what');
  assert.equal(issue(root, '2').sections.what.trim(), 'shared what', 'a list of ids takes the one value');
  assert.match(refuses(root, 'field', '1', 'What', 'x', '--remove'), /a section holds text, not items: write it whole with jarl\.mjs field <ids> What "<text>", or add to it with --add/);
});

test('field adds and removes the items of a list field, each issue keeping what it held, and logs the line a replacement logs', () => {
  const root = fieldedLoop();
  jarl(root, 'field', '1', 'Tags', 'a');
  jarl(root, 'field', '1,2', 'Tags', 'b,c', '--add', '--by', 'coord');
  assert.deepEqual(issue(root, '1').tags, ['a', 'b', 'c']);
  assert.deepEqual(issue(root, '2').tags, ['b', 'c'], 'each issue adds to its own list');
  assert.equal(lastLine(root), '2 field Tags · b, c · was (none) · by coord');
  jarl(root, 'field', '1,2', 'Tags', 'b', '--remove');
  assert.deepEqual(issue(root, '1').tags, ['a', 'c']);
  assert.deepEqual(issue(root, '2').tags, ['c']);
  jarl(root, 'field', '1', 'Files', 'src/a.mjs');
  jarl(root, 'field', '1', 'Files', 'src/b.mjs', '--add');
  assert.deepEqual(issue(root, '1').files, ['src/a.mjs', 'src/b.mjs']);
  jarl(root, 'field', '1', 'Files', 'src/a.mjs', '--remove');
  assert.deepEqual(issue(root, '1').files, ['src/b.mjs']);
  jarl(root, 'field', '1', 'After', '2', '--add');
  jarl(root, 'field', '1', 'After', '003', '--add');
  assert.deepEqual(issue(root, '1').after, ['2', '3']);
  jarl(root, 'field', '1', 'After', '2,3', '--remove');
  assert.deepEqual(issue(root, '1').after, [], 'a list emptied by --remove is emptied as --clear empties it');
  assert.equal(lastLine(root), '1 field After · (cleared) · was 2, 3');
  jarl(root, 'field', '1', 'Source', 'r/x#1', '--add');
  jarl(root, 'field', '1', 'Source', 'r/x#2', '--add');
  assert.deepEqual(issue(root, '1').sources, ['r/x#1', 'r/x#2']);
  jarl(root, 'field', '1', 'Resources', 'gate', '--add');
  jarl(root, 'field', '1', 'Resources', 'db', '--add');
  jarl(root, 'field', '1', 'Resources', 'GATE', '--remove');
  assert.deepEqual(issue(root, '1').resources, ['db'], 'a resource is one name in any case');
  const count = logLines(root).length;
  jarl(root, 'field', '1', 'Tags', 'a', '--add');
  jarl(root, 'field', '1', 'Tags', 'zzz', '--remove');
  assert.equal(logLines(root).length, count, 'an item held already, or not held at all, writes nothing');
  assert.match(refuses(root, 'field', '1', 'Priority', '1', '--add'), /Priority holds one value, so it is replaced, never added to or taken from: jarl\.mjs field <ids> Priority "<value>"/);
  assert.match(refuses(root, 'field', '1', 'Tags', 'a', '--add', '--clear'), /field takes one of --add, --remove and --clear, not --add and --clear/);
  assert.match(refuses(root, 'field', '1', 'Tags', '--add'), /field Tags needs a value: jarl\.mjs field <ids> Tags "<value>"/);
});

test('a slice: tag keeps its one-slice rule through --add, and the refusal is the two calls that move the issue', () => {
  const root = fieldedLoop();
  jarl(root, 'field', '1', 'Tags', 'slice:odin', '--add');
  const said = refuses(root, 'field', '1', 'Tags', 'slice:thor', '--add');
  assert.match(said, /1 is in slice:odin already, and an issue is in one slice — to move it: jarl\.mjs field 1 Tags --remove slice:odin, then jarl\.mjs field 1 Tags --add slice:thor/);
  jarl(root, 'field', '1', 'Tags', 'slice:odin', '--remove');
  jarl(root, 'field', '1', 'Tags', 'slice:thor', '--add');
  assert.deepEqual(issue(root, '1').tags, ['slice:thor']);
});

test('field adds a repository to Repo and takes it off by its name', () => {
  const root = makeLoop({ prefix: 'jarl-surface-repo-', via: 'cli' });
  jarl(root, 'new', 'one', '--tier', 'light');
  const a = gitRepo({ prefix: 'jarl-surface-a-' });
  const b = gitRepo({ prefix: 'jarl-surface-b-' });
  jarl(root, 'field', '1', 'Repo', a.dir);
  jarl(root, 'field', '1', 'Repo', b.dir, '--add');
  assert.equal(issue(root, '1').fields.repo.split(', ').length, 2);
  const [first, second] = issue(root, '1').fields.repo.split(', ');
  jarl(root, 'field', '1', 'Repo', a.dir, '--remove');
  assert.equal(issue(root, '1').fields.repo, second, 'the repository given by its path is taken off as it is stored');
  assert.notEqual(first, second);
});

test('the commands that wrote one part each are refused with one line that ends with the field call doing what was asked', () => {
  const root = fieldedLoop();
  const cases = [
    [['prio', '1', '3'], 'prio is not a command; the priority is a field: jarl.mjs field 1 Priority 3'],
    [['tag', '1', '+a', '-b'], 'tag is not a command; tags are a field: jarl.mjs field 1 Tags --remove b, then jarl.mjs field 1 Tags --add a'],
    [['files', '1', 'a.mjs', 'b.mjs'], 'files is not a command; the files are a field: jarl.mjs field 1 Files a.mjs,b.mjs'],
    [['source', '1', 'r/x#1'], 'source is not a command; the source is a field: jarl.mjs field 1 Source r/x#1'],
    [['after', '1', '2'], 'after is not a command; the issues an issue waits on are a field: jarl.mjs field 1 After 2'],
    [['after', '1', '--clear'], 'after is not a command; the issues an issue waits on are a field: jarl.mjs field 1 After --clear'],
    [['repo', '1', '--clear'], 'repo is not a command; the repository is a field: jarl.mjs field 1 Repo --clear'],
    [['repo', '--base', 'tool', 'main'], "repo is not a command; a repository's base is changed by base: jarl.mjs base tool main"],
    [['body', '1', '--why', 'a reason', '--acceptance', 'a line', '--append'], 'body is not a command; every part of the description is written by field: jarl.mjs field 1 Why "a reason" --add, then jarl.mjs field 1 Acceptance "a line" --add'],
  ];
  for (const [args, line] of cases) {
    const said = refuses(root, ...args);
    assert.equal(said.trim(), line, args.join(' '));
    assert.equal(said.trim().split('\n').length, 1, `${args[0]}: one line`);
  }
  assert.equal(issue(root, '1').priority, '2', 'a refused call writes nothing');
  const tool = mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'jarl_prio', arguments: { root } } });
  assert.match(tool.error.message, /^Unknown tool: jarl_prio — prio is not a command; the priority is a field: jarl\.mjs field <ids> Priority <1\|2\|3>$/);
});

test('set takes statuses only: a field given to it is refused with the field call that writes it', () => {
  const root = fieldedLoop();
  assert.equal(refuses(root, 'set', '1', 'Area', 'cli').trim(), 'Area is a field, not a status: jarl.mjs field 1 Area cli');
  assert.equal(refuses(root, 'set', '1', 'resources', 'gate, db').trim(), 'resources is a field, not a status: jarl.mjs field 1 resources "gate, db"');
  assert.equal(issue(root, '1').fields.area, 'core');
});

test('base is the command that changes the base branch of a declared repository', () => {
  const root = makeLoop({ prefix: 'jarl-surface-base-', via: 'cli' });
  assert.match(refuses(root, 'base', 'nothing-here', 'main'), /nothing-here is not declared in this loop/);
  assert.match(refuses(root, 'base', 'nothing-here'), /base takes a repository name and a branch: jarl\.mjs base <name> <branch>/);
});
