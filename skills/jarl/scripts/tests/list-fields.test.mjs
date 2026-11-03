// A field that holds a list takes a list through the tools and stores its items; a value that would store
// brackets or quotes as part of an item is refused instead of written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loop } from './helpers.mjs';

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
  refused(() => raw(root, 'after', { id: '3', ids: '["1", "2"]' }), /not the text of a list/i);
});
