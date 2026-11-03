// A field that holds a list takes a list through the tools and stores its items; a value that would store
// brackets or quotes as part of an item is refused instead of written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loop, gitRepo, refuses } from './helpers.mjs';

const mcp = await import('../jarl-mcp.mjs');

const raw = (root, name, input) => mcp.callTool(`jarl_${name}`, { ...input, root });
const call = (root, name, input) => { const r = raw(root, name, input); assert.equal(r.isError, false, r.content[0].text); return r; };
const issueText = (root, n) => {
  const dir = join(root, '.jarl', 'issues');
  return readFileSync(join(dir, readdirSync(dir).find((f) => f.startsWith(`${n}-`))), 'utf8');
};
const header = (text, name) => new RegExp(`^\\*\\*${name}:\\*\\* ?(.*)$`, 'm').exec(text)?.[1];
const refused = (fn, re) => { const r = fn(); assert.equal(r.isError, true, 'expected a refusal'); assert.match(r.content[0].text, re); };

test('new takes tags, files and after as lists and stores each item', () => {
  const root = loop();
  call(root, 'new', { title: 'first' });
  call(root, 'new', { title: 'second', tags: ['drift', 'processes'], files: ['a/one.mjs', 'b/two.mjs'], after: ['1'] });
  const text = issueText(root, 2);
  assert.equal(header(text, 'Tags'), 'drift, processes');
  assert.equal(header(text, 'Files'), 'a/one.mjs, b/two.mjs');
  assert.equal(header(text, 'After'), '1');
  const found = call(root, 'list', { tag: 'drift' });
  assert.match(found.content[0].text, /second/);
});

test('tags given as the text of a list are refused, not stored with their brackets and quotes', () => {
  const root = loop();
  refused(() => raw(root, 'new', { title: 't', tags: '["drift", "processes"]' }), /tag/i);
  refused(() => raw(root, 'new', { title: 't', tags: ['"drift"'] }), /tag/i);
  refused(() => raw(root, 'new', { title: 't', tags: ['[drift]'] }), /tag/i);
  assert.equal(readdirSync(join(root, '.jarl', 'issues')).length, 0);
});

test('files given as the text of a list are refused, and a bracketed path is still a path', () => {
  const root = loop();
  call(root, 'new', { title: 't' });
  refused(() => raw(root, 'new', { title: 'u', files: '["a.mjs", "b.mjs"]' }), /list/i);
  refused(() => raw(root, 'files', { id: '1', paths: '["a.mjs", "b.mjs"]' }), /list/i);
  call(root, 'files', { id: '1', paths: ['src/[id]/page.tsx', 'b.mjs'] });
  assert.equal(header(issueText(root, 1), 'Files'), 'src/[id]/page.tsx, b.mjs');
});

test('tag takes its operations as a list and refuses an added tag with brackets or quotes', () => {
  const root = loop();
  call(root, 'new', { title: 't' });
  call(root, 'tag', { ids: '1', ops: ['+drift', '+processes'] });
  assert.equal(header(issueText(root, 1), 'Tags'), 'drift, processes');
  refused(() => raw(root, 'tag', { ids: '1', ops: ['+["x"]'] }), /tag/i);
  assert.equal(header(issueText(root, 1), 'Tags'), 'drift, processes');
});

test('after and source take a list and store its items', () => {
  const root = loop();
  call(root, 'new', { title: 'a' });
  call(root, 'new', { title: 'b' });
  call(root, 'new', { title: 'c' });
  call(root, 'after', { id: '3', ids: ['1', '2'] });
  assert.equal(header(issueText(root, 3), 'After'), '1, 2');
  call(root, 'source', { id: '3', refs: ['core/r#a', 'core/r#b'] });
  assert.equal(header(issueText(root, 3), 'Source'), 'core/r#a, core/r#b');
  refused(() => raw(root, 'after', { id: '3', ids: '["1", "2"]' }), /parses as a list of strings/i);
});

test('files, source and after refuse an item that starts with - and say where flags go', () => {
  const root = loop();
  call(root, 'new', { title: 'a' });
  call(root, 'new', { title: 'b' });
  for (const [cmd, first] of [['files', 'a.mjs'], ['source', 'core/r#a'], ['after', '1']]) {
    const said = refuses(root, cmd, '2', first, '--', '--root', '/x');
    assert.match(said, /cannot start with -/);
    assert.match(said, /flags such as --root go before it/);
  }
  assert.equal(header(issueText(root, 2), 'Files'), '');
});

test('a file named in brackets is a path, and an empty path clears Files', () => {
  const root = loop();
  call(root, 'new', { title: 't' });
  call(root, 'files', { id: '1', paths: ['[1]'] });
  assert.equal(header(issueText(root, 1), 'Files'), '[1]');
  call(root, 'files', { id: '1', paths: [''] });
  assert.equal(header(issueText(root, 1), 'Files'), '');
});

test('the source and files tools require their list; the after tool describes its ids', () => {
  const tools = Object.fromEntries(mcp.buildTools().map((t) => [t.name, t.inputSchema]));
  assert.ok(tools.jarl_files.required.includes('paths'));
  assert.ok(tools.jarl_source.required.includes('refs'));
  assert.ok(!tools.jarl_after.required.includes('ids'));
  assert.match(tools.jarl_after.properties.ids.description, /waits on/);
  assert.equal(tools.jarl_files.properties.paths.type, 'array');
});

test('repo, settles and only take lists through the tools', () => {
  const root = loop();
  const one = gitRepo().dir;
  const two = gitRepo().dir;
  call(root, 'new', { title: 'a', repo: [one, two] });
  call(root, 'new', { title: 'b' });
  const repo = header(issueText(root, 1), 'Repo');
  assert.ok(!/[[\]"]/.test(repo), repo);
  assert.equal(repo.split(',').length, 2);
  call(root, 'decide', { slug: 'ruled', ruling: 'a ruling', settles: ['1', '2'] });
  assert.match(readFileSync(join(root, '.jarl', 'decisions.md'), 'utf8'), /\*\*Settles:\*\* 1, 2/);
  const tools = Object.fromEntries(mcp.buildTools().map((t) => [t.name, t.inputSchema]));
  for (const [tool, field] of [['jarl_new', 'repo'], ['jarl_import', 'repo'], ['jarl_import', 'only'], ['jarl_decide', 'settles']]) {
    assert.equal(tools[tool].properties[field].type, 'array', `${tool} ${field}`);
  }
});

test('import takes tags, repo and only as lists through the tool', () => {
  const root = loop();
  const one = gitRepo().dir;
  const two = gitRepo().dir;
  const dir = mkdtempSync(join(tmpdir(), 'report-2026-09-25-'));
  const file = join(dir, 'findings.json');
  writeFileSync(file, JSON.stringify([
    { id: 'f-1', kind: 'defect', priority: 'high', title: 'first', where: 'a.mjs:1', evidence: 'e', proposal: 'p', effort: 'S' },
    { id: 'f-2', kind: 'defect', priority: 'low', title: 'second', where: 'a.mjs:2', evidence: 'e', proposal: 'p', effort: 'S' },
    { id: 'f-3', kind: 'defect', priority: 'low', title: 'third', where: 'a.mjs:3', evidence: 'e', proposal: 'p', effort: 'S' },
  ]));
  call(root, 'import', { file, source: 'core/r', tags: ['drift', 'processes'], repo: [one, two], only: ['f-1', 'f-3'] });
  const files = readdirSync(join(root, '.jarl', 'issues'));
  assert.equal(files.length, 2);
  const text = issueText(root, 1);
  assert.equal(header(text, 'Tags'), 'drift, processes');
  assert.equal(header(text, 'Repo').split(',').length, 2);
});

test('a one-item list written as text is refused in every list field, by the tool and by the command line', () => {
  const root = loop();
  call(root, 'new', { title: 'a' });
  call(root, 'new', { title: 'b' });
  const onePerField = [
    ['files', { id: '2', paths: '["a.mjs"]' }, ['2', '["a.mjs"]']],
    ['source', { id: '2', refs: '["core/r#a"]' }, ['2', '["core/r#a"]']],
    ['after', { id: '2', ids: '["1"]' }, ['2', '["1"]']],
    ['new', { title: 'c', files: '["a.mjs"]' }, null],
    ['new', { title: 'c', tags: '["drift"]' }, null],
    ['new', { title: 'c', source: '["core/r#a"]' }, null],
    ['new', { title: 'c', after: '["1"]' }, null],
  ];
  for (const [cmd, input, argv] of onePerField) {
    refused(() => raw(root, cmd, input), /parses as a list of strings|plain word/);
    if (argv) assert.match(refuses(root, cmd, ...argv), /parses as a list of strings/);
  }
  assert.ok(!issueText(root, 2).includes('["'), 'nothing with brackets and quotes was stored');
  call(root, 'files', { id: '2', paths: ['[1]', 'src/[id]/page.tsx'] });
  assert.equal(header(issueText(root, 2), 'Files'), '[1], src/[id]/page.tsx');
});

test('the repo tool takes its repositories as a list', () => {
  const root = loop();
  const one = gitRepo().dir;
  const two = gitRepo().dir;
  call(root, 'new', { title: 'a' });
  call(root, 'repo', { id: '1', path: [one, two] });
  const repo = header(issueText(root, 1), 'Repo');
  assert.equal(repo.split(',').length, 2);
  assert.ok(!/[[\]"]/.test(repo), repo);
  const tools = Object.fromEntries(mcp.buildTools().map((t) => [t.name, t.inputSchema]));
  assert.equal(tools.jarl_repo.properties.path.type, 'array');
});
