// Every field that holds a list follows one rule, on the command line and through the tools alike: a list is its
// items. The command line writes one item or a comma list (a,b, ids with ranges); a tool field takes that text or a
// list of strings, one item each. Text that is a list written out (brackets, quotes) is refused instead of being
// stored with its brackets and quotes; an item that starts with - is refused with where flags go; a name with
// brackets in it that is not a list ([1], src/[id]/page.tsx) is a name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loop, gitRepo, jarl, refuses } from './helpers.mjs';

const mcp = await import('../jarl-mcp.mjs');

const raw = (root, name, input) => mcp.callTool(`jarl_${name}`, { ...input, root });
const call = (root, name, input) => { const r = raw(root, name, input); assert.equal(r.isError, false, `${name}: ${r.content[0].text}`); return r; };
const refusedByTool = (root, name, input) => {
  let r;
  try { r = raw(root, name, input); } catch (e) { return e.message; }
  assert.equal(r.isError, true, `${name} ${JSON.stringify(input)}: expected a refusal, got ${r.content[0].text}`);
  return r.content[0].text;
};
const issueFile = (root, n) => {
  const dir = join(root, '.jarl', 'issues');
  return join(dir, readdirSync(dir).find((f) => f.startsWith(`${n}-`)));
};
const issueText = (root, n) => readFileSync(issueFile(root, n), 'utf8');
const header = (text, name) => new RegExp(`^\\*\\*${name}:\\*\\* ?(.*)$`, 'm').exec(text)?.[1];
// Everything the loop holds, to show that a refusal wrote nothing.
const snapshot = (root) => {
  const dir = join(root, '.jarl', 'issues');
  return [readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), ...readdirSync(dir).sort().map((f) => readFileSync(join(dir, f), 'utf8'))].join('\n');
};
const LIST_RULE = /takes its items one by one/;
const DASH_RULE = /cannot start with -/;
// Where a flag goes: before the bare --, said of a list item that starts with a dash, or of a flag written after the --.
const DASH_HINT = /flags such as --root go before it|is a flag, which goes before the bare --|are flags, which go before the bare --/;

// A loop with three issues and two repositories beside it.
function fixture() {
  const root = loop();
  for (const title of ['a', 'b', 'c']) call(root, 'new', { title });
  return { root, one: gitRepo().dir, two: gitRepo().dir };
}
function findingsFile() {
  const dir = mkdtempSync(join(tmpdir(), 'report-2026-09-25-'));
  const file = join(dir, 'findings.json');
  writeFileSync(file, JSON.stringify(['f-1', 'f-2', 'f-3'].map((id, i) => ({ id, kind: 'defect', priority: 'low', title: `finding ${i}`, where: `a.mjs:${i}`, evidence: 'e', proposal: 'p', effort: 'S' }))));
  return file;
}

// Every list field of every tool, the call that fills it with a list (`list` stands for the items), and an item it takes.
// The kind says what an item is: a name (an issue or question id, a tag, a reference, a finding id) never holds a
// bracket or a quote; a path (Files, Repo) may hold brackets that pair up.
const FIELDS = [
  ['new', 'tags', 'name', (list) => ({ title: 'n', tags: list }), 'drift'],
  ['new', 'files', 'path', (list) => ({ title: 'n', files: list }), 'a.mjs'],
  ['new', 'after', 'name', (list) => ({ title: 'n', after: list }), '1'],
  ['new', 'source', 'name', (list) => ({ title: 'n', source: list }), 'core/r#a'],
  ['new', 'repo', 'path', (list) => ({ title: 'n', repo: list }), 'ONE'],
  ['import', 'tags', 'name', (list) => ({ file: 'FINDINGS', source: 'core/r', tags: list }), 'drift'],
  ['import', 'repo', 'path', (list) => ({ file: 'FINDINGS', source: 'core/r', repo: list }), 'ONE'],
  ['import', 'only', 'name', (list) => ({ file: 'FINDINGS', source: 'core/r', only: list }), 'f-1'],
  ['decide', 'settles', 'name', (list) => ({ slug: 'ruled', text: 'a ruling', by: 'jarl', settles: list }), '1'],
  ['round', 'id', 'name', (list) => ({ id: list, text: 'it failed' }), '1'],
  ['evidence', 'ids', 'name', (list) => ({ ids: list, text: 'a note' }), '1'],
  ['field', 'ids', 'name', (list) => ({ ids: list, name: 'Resources', value: 'db' }), '1'],
  ['set', 'ids', 'name', (list) => ({ ids: list, status: 'deferred', text: 'later' }), '1'],
  ['review', 'ids', 'name', (list) => ({ ids: list, verdict: 'changes', by: 'rev', text: 'Important: three words here' }), '1'],
  ['merged', 'ids', 'name', (list) => ({ ids: list, sha: 'abc1234', ci: 'none' }), '1'],
  ['changelog', 'ids', 'name', (list) => ({ ids: list }), '1'],
  ['answer', 'id', 'name', (list) => ({ id: list, text: 'yes', by: 'owner' }), 'a-1'],
];
// The input of a case with its placeholders filled in.
const subOf = (fx, v) => (v === 'ONE' ? fx.one : v === 'TWO' ? fx.two : v === 'FINDINGS' ? fx.findings : v);
function inputFor(fx, build, list) {
  const input = build(list);
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => subOf(fx, x)) : subOf(fx, v)]));
}
function fullFixture() {
  const fx = { ...fixture(), findings: findingsFile() };
  call(fx.root, 'ask', { text: 'first?', kind: 'ratify' });
  call(fx.root, 'ask', { text: 'second?', kind: 'ratify' });
  return fx;
}
// A second item of the same kind, for a list of two.
const second = (item) => ({ drift: 'processes', 'a.mjs': 'b.mjs', 1: '2', 'core/r#a': 'core/r#b', ONE: 'TWO', 'f-1': 'f-3', 'a-1': 'a-2' }[item]);

test('every list field of every tool takes a list of strings and lands on each item', () => {
  for (const [cmd, field, , build, item] of FIELDS) {
    const fx = fullFixture();
    const r = call(fx.root, cmd, { ...inputFor(fx, build, [item, second(item)]), json: true });
    assert.ok(!/\[\\?"|\\?"\]/.test(r.content[0].text), `${cmd} ${field}: ${r.content[0].text}`);
  }
});

test('a list given through the tools is stored item by item, and filtering by a tag finds the issue', () => {
  const fx = fullFixture();
  call(fx.root, 'new', { title: 'd', tags: ['drift', 'processes'], files: ['a/one.mjs', 'b/two.mjs'], after: ['1', '2'], source: ['core/r#a', 'core/r#b'], repo: [fx.one, fx.two] });
  const text = issueText(fx.root, 4);
  assert.equal(header(text, 'Tags'), 'drift, processes');
  assert.equal(header(text, 'After'), '1, 2');
  assert.equal(header(text, 'Source'), 'core/r#a, core/r#b');
  assert.equal(header(text, 'Repo').split(', ').length, 2);
  assert.ok(header(text, 'Files').includes('a/one.mjs') && header(text, 'Files').includes('b/two.mjs'));
  assert.match(call(fx.root, 'list', { tag: 'drift' }).content[0].text, /\bd\b/);
  call(fx.root, 'field', { ids: ['1', '2'], name: 'Tags', value: 'drift', add: true });
  call(fx.root, 'field', { ids: [1, 2], name: 'Priority', value: '1' });
  for (const n of [1, 2]) {
    assert.equal(header(issueText(fx.root, n), 'Tags'), 'drift');
    assert.equal(header(issueText(fx.root, n), 'Priority'), '1');
  }
  call(fx.root, 'field', { ids: ['1', '2'], name: 'Files', value: 'x.mjs,y.mjs' });
  assert.equal(header(issueText(fx.root, 2), 'Files'), 'x.mjs, y.mjs');
  call(fx.root, 'decide', { slug: 'ruled', text: 'a ruling', by: 'jarl', settles: ['1', '2'] });
  assert.match(readFileSync(join(fx.root, '.jarl', 'decisions.md'), 'utf8'), /\*\*Settles:\*\* 1, 2/);
  call(fx.root, 'import', { file: fx.findings, source: 'core/r', tags: ['drift', 'processes'], only: ['f-1', 'f-3'] });
  assert.equal(header(issueText(fx.root, 5), 'Tags'), 'drift, processes');
  assert.equal(readdirSync(join(fx.root, '.jarl', 'issues')).length, 6);
});

// The id lists come before other arguments, which the adapter types as one text: the tools declare each of them as one
// text or a list of strings, and the description says so.
const ID_LISTS = (cmd, field) => field === 'ids' || field === 'id';

test('every list field of every tool says it takes a list: declared as a list, or, for an id list, as one text or a list of strings', () => {
  const tools = Object.fromEntries(mcp.buildTools().map((t) => [t.name, t.inputSchema.properties]));
  for (const [cmd, field] of FIELDS) {
    const schema = tools[`jarl_${cmd}`][field];
    if (ID_LISTS(cmd, field)) {
      assert.deepEqual(schema.type, ['string', 'array'], `${cmd} ${field}`);
      assert.deepEqual(schema.items, { type: 'string' }, `${cmd} ${field}`);
      assert.match(schema.description, cmd === 'answer' ? /comma list/ : /comma list with ranges \(12,13 or 203-206\) or as a list of strings/, `${cmd} ${field}`);
    } else {
      assert.deepEqual(schema, { type: 'array', items: { type: 'string' }, ...(schema.minItems ? { minItems: 1 } : {}), description: schema.description }, `${cmd} ${field}`);
      assert.match(schema.description, /a list of strings, one item each/, `${cmd} ${field}`);
    }
  }
  assert.match(tools.jarl_field.value.description, /a comma list for a list field/);
});

test('the schema declares a list for the id field of each command that takes an id list, and for no other field', () => {
  const declared = [];
  for (const tool of mcp.buildTools()) {
    for (const [field, schema] of Object.entries(tool.inputSchema.properties)) if (Array.isArray(schema.type)) declared.push(`${tool.name} ${field}`);
  }
  assert.deepEqual(declared.sort(), [
    'jarl_answer id', 'jarl_changelog ids', 'jarl_evidence ids', 'jarl_field ids', 'jarl_merged ids', 'jarl_review ids', 'jarl_round id', 'jarl_set ids',
  ].sort());
});

// A list written out as text, in every spelling the tools and the command line have been seen to pass, with `a` and
// `b` standing for two items of the field.
const LIST_TEXTS = [
  (a, b) => `["${a}", "${b}"]`, (a) => `["${a}"]`, (a, b) => `[${a}, ${b}]`, (a, b) => `[${a},${b}]`, (a) => `['${a}']`,
  (a) => `"${a}"`, (a) => `'${a}'`, (a, b) => `"${a}", "${b}"`, () => '[]', (a) => `[ "${a}" ]`,
];

test('a list written as text is refused in every list field of every tool, and nothing is written', () => {
  const fx = fullFixture();
  const before = snapshot(fx.root);
  for (const [cmd, field, kind, build, item] of FIELDS) {
    const a = subOf(fx, item);
    const b = subOf(fx, second(item));
    const spellings = [...LIST_TEXTS.map((f) => f(a, b)), ...(kind === 'name' ? [`[${a}]`] : [])];
    for (const text of spellings) {
      assert.match(refusedByTool(fx.root, cmd, inputFor(fx, build, text)), LIST_RULE, `${cmd} ${field} ${text}`);
    }
    // The same text cut into list items by a host: each piece keeps a bracket or a quote of the text.
    assert.match(refusedByTool(fx.root, cmd, inputFor(fx, build, [`["${a}"`, `"${b}"]`])), LIST_RULE, `${cmd} ${field} pieces`);
    assert.match(refusedByTool(fx.root, cmd, inputFor(fx, build, [`"${a}"`])), LIST_RULE, `${cmd} ${field} a quoted item`);
    assert.equal(snapshot(fx.root), before, `${cmd} ${field}: a refusal wrote nothing`);
  }
});

test('a list written as text is refused on the command line too, in every list argument and flag', () => {
  const fx = fixture();
  const before = snapshot(fx.root);
  const cases = [
    ['new', 't', '--tags', '["drift", "processes"]'], ['new', 't', '--tags', '[drift]'], ['new', 't', '--files', '["a.mjs"]'],
    ['new', 't', '--files', '[a.mjs, b.mjs]'], ['new', 't', '--after', '["1"]'], ['new', 't', '--source', '[core/r#a, core/r#b]'],
    ['new', 't', '--repo', `["${fx.one}"]`], ['field', '3', 'Files', '["a.mjs"]'], ['field', '3', 'Files', '[a.mjs,b.mjs]'], ['field', '3', 'Files', "'a.mjs'"],
    ['field', '3', 'Source', '[core/r#a, core/r#b]'], ['field', '3', 'Source', '"core/r#a"'], ['field', '3', 'After', '[1,2]'], ['field', '3', 'Repo', `['${fx.one}']`],
    ['field', '[1, 2]', 'Tags', 'x', '--add'], ['field', '["1"]', 'Priority', '1'], ['field', '"1"', 'Files', 'a.mjs'], ['evidence', '[1]', 'note'],
    ['decide', 'ruled', 'a ruling', '--settles', '[1, 2]'], ['field', '1', 'Tags', '["drift"]', '--add'], ['field', '1', 'Tags', "it's", '--add'],
  ];
  for (const args of cases) assert.match(refuses(fx.root, ...args), LIST_RULE, args.join(' '));
  assert.equal(snapshot(fx.root), before);
});

test('a name with brackets that is not a list is a path, through the tools and on the command line', () => {
  const fx = fixture();
  const names = ['[1]', 'src/[id]/page.tsx', '[...slug]', 'app/[[...slug]]/page.tsx', '[a.mjs]'];
  call(fx.root, 'field', { ids: '1', name: 'Files', value: names.join(',') });
  assert.equal(header(issueText(fx.root, 1), 'Files'), names.join(', '));
  jarl(fx.root, 'field', '2', 'Files', names.join(','));
  assert.equal(header(issueText(fx.root, 2), 'Files'), names.join(', '));
  call(fx.root, 'new', { title: 'd', files: 'src/[id]/page.tsx,[1]' });
  assert.equal(header(issueText(fx.root, 4), 'Files'), 'src/[id]/page.tsx, [1]');
});

test('an item that starts with - is refused in every list field, with where flags go', () => {
  const fx = fullFixture();
  const before = snapshot(fx.root);
  for (const [cmd, field, , build, item] of FIELDS) {
    for (const list of [['-x'], `${subOf(fx, item)},--root`]) {
      const said = refusedByTool(fx.root, cmd, inputFor(fx, build, list));
      assert.match(said, DASH_RULE, `${cmd} ${field} ${list}`);
      assert.match(said, DASH_HINT, `${cmd} ${field} ${list}`);
    }
    assert.equal(snapshot(fx.root), before, `${cmd} ${field}: a refusal wrote nothing`);
  }
});

test('a flag written after a bare -- is refused on the command line with where flags go, never stored', () => {
  const fx = fixture();
  const before = snapshot(fx.root);
  for (const args of [
    ['field', '3', 'Files', 'a.mjs', '--', '--root', '/x'], ['field', '3', 'Source', 'core/r#a', '--', '--root', '/x'], ['field', '3', 'After', '1', '--', '--root', '/x'],
    ['field', '3', 'Repo', fx.one, '--', '--root', '/x'], ['field', '3', 'Files', '--', '--root'], ['field', '3', 'After', '--', '-1'], ['field', '--add', '--', '1', 'Tags', '-x'],
    ['new', 't', '--tags', '-x'], ['new', 't', '--files=--root'], ['decide', 'ruled', 'r', '--settles', '-1'],
  ]) {
    assert.match(refuses(fx.root, ...args), DASH_HINT, args.join(' '));
  }
  assert.equal(snapshot(fx.root), before);
});

test('the command line keeps every spelling it takes: one value, a comma list, ranges, an empty list', () => {
  const fx = fixture();
  jarl(fx.root, 'field', '1', 'Files', 'a.mjs');
  jarl(fx.root, 'field', '2', 'Files', 'a.mjs, b.mjs');
  assert.equal(header(issueText(fx.root, 2), 'Files'), 'a.mjs, b.mjs');
  jarl(fx.root, 'field', '1-2', 'Files', 'c.mjs,d.mjs');
  assert.equal(header(issueText(fx.root, 1), 'Files'), 'c.mjs, d.mjs');
  jarl(fx.root, 'field', '1,2', 'Tags', '--add', 'x,y');
  assert.equal(header(issueText(fx.root, 2), 'Tags'), 'x, y');
  jarl(fx.root, 'field', '3', 'After', '1-2');
  assert.equal(header(issueText(fx.root, 3), 'After'), '1, 2');
  jarl(fx.root, 'new', 'd', '--acceptance', '[read] it works', '--tags', 'drift,processes', '--files', 'p.mjs,q.mjs', '--after', '1,3', '--source', 'core/r#a,core/r#b');
  const text = issueText(fx.root, 4);
  assert.equal(header(text, 'Tags'), 'drift, processes');
  assert.equal(header(text, 'Files'), 'p.mjs, q.mjs');
  assert.equal(header(text, 'After'), '1, 3');
  assert.equal(header(text, 'Source'), 'core/r#a, core/r#b');
  jarl(fx.root, 'field', '1', 'Repo', `${fx.one},${fx.two}`);
  assert.equal(header(issueText(fx.root, 1), 'Repo').split(', ').length, 2);
  jarl(fx.root, 'field', '1', 'Files', '--clear');
  assert.equal(header(issueText(fx.root, 1), 'Files'), '');
  call(fx.root, 'field', { ids: '3', name: 'Files', clear: true });
  assert.equal(header(issueText(fx.root, 3), 'Files'), '');
});

test('base takes a name and a branch, and a word beyond them is refused', () => {
  const fx = fixture();
  assert.match(refuses(fx.root, 'base', 'tool', 'main', 'extra'), /base takes at most 2 arguments — unexpected: "extra"/);
});

test('a tag stored with the brackets and quotes of a list can still be taken off', () => {
  const fx = fixture();
  const file = issueFile(fx.root, 1);
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^\*\*Tags:\*\*.*$/m, '**Tags:** ["drift", "processes"]'));
  jarl(fx.root, 'field', '1', 'Tags', '["drift","processes"]', '--remove');
  jarl(fx.root, 'field', '1', 'Tags', 'drift,processes', '--add');
  assert.equal(header(issueText(fx.root, 1), 'Tags'), 'drift, processes');
  assert.match(jarl(fx.root, 'list', '--tag', 'drift'), /\ba\b/);
});

test('field adds and removes a comma list of tags, one tag each, on the command line and through the tool', () => {
  const fx = fixture();
  assert.match(jarl(fx.root, 'field', '1', 'Tags', '--add', 'a,b'), / Tags: a, b$/);
  assert.equal(header(issueText(fx.root, 1), 'Tags'), 'a, b');
  call(fx.root, 'field', { ids: '1', name: 'Tags', value: 'c,d', add: true });
  call(fx.root, 'field', { ids: '1', name: 'Tags', value: 'a,b', remove: true });
  assert.equal(header(issueText(fx.root, 1), 'Tags'), 'c, d');
  call(fx.root, 'field', { ids: '1', name: 'Tags', value: 'e, f', add: true });
  assert.equal(header(issueText(fx.root, 1), 'Tags'), 'c, d, e, f');
  assert.match(jarl(fx.root, 'field', '1', 'Tags', '--remove', 'c,d'), / Tags: e, f$/);
});

test('a tag to add or remove that is empty, or starts with -, is refused through the tool and on the command line, and nothing is written', () => {
  const fx = fixture();
  const before = snapshot(fx.root);
  for (const mode of ['--add', '--remove']) for (const v of [',', ' , ']) assert.match(refuses(fx.root, 'field', '1', 'Tags', v, mode), /field Tags needs a value/, `${mode} ${v}`);
  assert.match(refusedByTool(fx.root, 'field', { ids: '1', name: 'Tags', value: '--root', add: true }), DASH_RULE);
  assert.match(refusedByTool(fx.root, 'field', { ids: '1', name: 'Tags', value: '--root', remove: true }), DASH_HINT);
  assert.equal(snapshot(fx.root), before);
});
