// The library is the modules of lib/, and jarl-lib.mjs is the one surface over them. Each module imports Node
// built-ins and other modules of lib/ by name, and nothing else: never the record, the command line, the server or
// jarl-lib.mjs above it. The modules stand in three layers, lowest first, stated below: a module imports only from its
// own layer and the layers under it, no chain of imports comes back to the module it started from, and a module imports
// only names it uses. Every rule has a case below that proves it fails on a sample that breaks it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const LIB = new URL('../lib/', import.meta.url);
const MODULES = readdirSync(LIB).filter((f) => f.endsWith('.mjs')).sort();
const SOURCES = Object.fromEntries(MODULES.map((f) => [f, readFileSync(new URL(f, LIB), 'utf8')]));

// The layers, lowest first: [name, modules, what the layer holds].
const LAYERS = [
  ['ground', ['base.mjs', 'git.mjs', 'where.mjs', 'files.mjs', 'ids.mjs', 'owner.mjs'],
    'the vocabulary, a process, a path, a whole file, an id and the one test of the owner\'s words every write passes: nothing else of the record'],
  ['record', ['profile.mjs', 'journal.mjs', 'loop-git.mjs', 'lock.mjs', 'log.mjs', 'issues.mjs', 'repositories.mjs', 'loop.mjs', 'metrics.mjs', 'models.mjs', 'rounds.mjs', 'attachments.mjs', 'tips.mjs'],
    'the record read and written: the profile, the journal, the lock, the log, an issue, the repositories, the loaded loop and what is derived from it'],
  ['commands', ['commands.mjs', 'questions.mjs', 'evidence.mjs', 'queue.mjs', 'ball.mjs', 'review.mjs', 'changelog.mjs', 'import.mjs', 'resume.mjs', 'verify.mjs', 'merge-driver.mjs'],
    'the commands and the views, each standing on the record and on the commands under it'],
];

// Every import of a module as { spec, names: [{ imported, local }] }, in every static form, over one line or many: a
// side-effect import, a default import, a namespace import, named imports, a default beside either, and a re-export
// (export * from, export * as X from, export { … } from). A re-export binds no local name. A dynamic import is refused
// outright, and so is an import or a re-export the reader cannot place: the graph is read from the text alone.
const IMPORT = /^[ \t]*import\s*(?:([\w$]+)\s*(?:,\s*)?)?(?:\*\s*as\s+([\w$]+)\s*|\{([^}]*)\}\s*)?(?:from\s*)?(['"])([^'"]+)\4\s*;?/gm;
const REEXPORT = /^[ \t]*export\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])([^'"]+)\1\s*;?/gm;
function importsOf(text) {
  assert.doesNotMatch(text, /\bimport\s*\(/, 'a dynamic import');
  const named = (list) => (list || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [imported, local = imported] = s.split(/\s+as\s+/);
    return { imported, local };
  });
  const found = [];
  let rest = text.replace(IMPORT, (_, dflt, ns, list, q, spec) => {
    found.push({ spec, names: [...(dflt ? [{ imported: 'default', local: dflt }] : []), ...(ns ? [{ imported: '*', local: ns }] : []), ...named(list)] });
    return '';
  });
  rest = rest.replace(REEXPORT, (_, q, spec) => { found.push({ spec, names: [] }); return ''; });
  assert.doesNotMatch(rest, /^[ \t]*import\b(?!\.meta)|^[ \t]*export\s*(?:\*|\{[^}]*\}\s*from\b)/m, 'an import or a re-export the reader cannot place');
  return found;
}

// What a module may import: a Node built-in, or a module of lib/ by its file name.
function strayImports(sources, modules) {
  return Object.entries(sources).flatMap(([f, text]) => importsOf(text)
    .filter((i) => !/^node:[a-z_/]+$/.test(i.spec) && !(i.spec.startsWith('./') && modules.includes(i.spec.slice(2))))
    .map((i) => `${f} imports ${i.spec}`));
}

// The modules each module imports from lib/.
function graphOf(sources) {
  return Object.fromEntries(Object.entries(sources).map(([f, text]) => [f, importsOf(text).filter((i) => i.spec.startsWith('./')).map((i) => i.spec.slice(2))]));
}

// Every import that reaches a layer above the importer's, as "a (layer) imports b (layer)", and every module no layer
// names or two layers name.
function layerProblems(graph, layers) {
  const rank = {};
  const out = [];
  layers.forEach(([name, modules], i) => {
    for (const m of modules) {
      if (rank[m] !== undefined) out.push(`${m} is in two layers`);
      rank[m] = { i, name };
    }
  });
  for (const m of Object.keys(graph)) if (rank[m] === undefined) out.push(`${m} is in no layer`);
  for (const [name, modules] of layers) for (const m of modules) if (!(m in graph)) out.push(`the ${name} layer names ${m}, which lib/ does not hold`);
  for (const [m, deps] of Object.entries(graph)) {
    for (const d of deps) if (rank[m] && rank[d] && rank[d].i > rank[m].i) out.push(`${m} (${rank[m].name}) imports ${d} (${rank[d].name})`);
  }
  return out;
}

// Every cycle of the graph, each once, as "a -> b -> a".
function cyclesOf(graph) {
  const out = [];
  const state = {};
  const path = [];
  const visit = (m) => {
    state[m] = 'open';
    path.push(m);
    for (const d of graph[m] || []) {
      if (state[d] === 'open') out.push([...path.slice(path.indexOf(d)), d].join(' -> '));
      else if (!state[d]) visit(d);
    }
    path.pop();
    state[m] = 'done';
  };
  for (const m of Object.keys(graph).sort()) if (!state[m]) visit(m);
  return out;
}

// Every name a module imports and never uses, as "module: name". A use is the name as a whole word outside the
// import statements, and not a property after a dot (a spread's three dots are a use).
function unusedImports(sources) {
  return Object.entries(sources).flatMap(([f, text]) => {
    const body = text.replace(/^import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?$/gm, '');
    return importsOf(text).flatMap((i) => i.names.filter((n) => !new RegExp(`(?<![\\w$])(?<![^.]\\.)${n.local.replace(/\$/g, '\\$')}(?![\\w$])`).test(body)).map((n) => `${f}: ${n.local}`));
  });
}

test('a module of the library imports only Node built-ins and modules of lib/, from its own layer or a layer under it', () => {
  assert.ok(MODULES.length >= 20, `read ${MODULES.length} modules from lib/`);
  assert.deepEqual(strayImports(SOURCES, MODULES), []);
  assert.deepEqual(layerProblems(graphOf(SOURCES), LAYERS), []);
  const facade = importsOf(readFileSync(new URL('../jarl-lib.mjs', import.meta.url), 'utf8')).map((i) => i.spec);
  assert.deepEqual(facade.filter((s) => !(s.startsWith('./lib/') && MODULES.includes(s.slice('./lib/'.length)))), [], 'jarl-lib.mjs stands only on the modules of lib/');
  // The samples: a ground module that imports a command, a module no layer names, and an import from above lib/.
  const sample = { 'git.mjs': ['commands.mjs'], 'commands.mjs': ['git.mjs'], 'stray.mjs': [] };
  const small = [['ground', ['git.mjs']], ['commands', ['commands.mjs']]];
  assert.deepEqual(layerProblems(sample, small), ['stray.mjs is in no layer', 'git.mjs (ground) imports commands.mjs (commands)']);
  assert.deepEqual(layerProblems({ 'git.mjs': [] }, small), ['the commands layer names commands.mjs, which lib/ does not hold']);
  assert.deepEqual(strayImports({ 'a.mjs': "import { x } from '../record.mjs';\nimport { y } from './b.mjs';\nimport { z } from 'node:fs';\nimport {\n  w,\n} from '../jarl-lib.mjs';\n" }, ['a.mjs', 'b.mjs']), ['a.mjs imports ../record.mjs', 'a.mjs imports ../jarl-lib.mjs']);
  assert.throws(() => importsOf("const m = await import('./b.mjs');"), /dynamic import/);
  // Every form of import and re-export is read: each sample, put in a ground module, reaches the commands layer.
  const FORMS = [
    "import './commands.mjs';",
    "import cmd from './commands.mjs';",
    "import * as C from './commands.mjs';",
    "import { cmdNew } from './commands.mjs';",
    "import {\n  cmdNew,\n  cmdSet as set,\n} from './commands.mjs';",
    "import cmd, { cmdNew } from './commands.mjs';",
    "import cmd, * as C from './commands.mjs';",
    "export * from './commands.mjs';",
    "export * as C from './commands.mjs';",
    "export { cmdNew } from './commands.mjs';",
    "export {\n  cmdNew as made,\n} from \"./commands.mjs\"",
  ];
  for (const form of FORMS) {
    assert.deepEqual(layerProblems(graphOf({ 'git.mjs': `${form}\nexport const x = 1;\n`, 'commands.mjs': '' }), small), ['git.mjs (ground) imports commands.mjs (commands)'], form);
    assert.deepEqual(strayImports({ 'a.mjs': form.replace(/\.\/commands\.mjs/, '../record.mjs') }, ['a.mjs']), ['a.mjs imports ../record.mjs'], form);
  }
  assert.deepEqual(importsOf("import cmd, { cmdNew as made } from './c.mjs';\nimport * as C from './d.mjs';").map((i) => i.names.map((n) => n.local)), [['cmd', 'made'], ['C']]);
  assert.throws(() => importsOf("import{a}from'./b.mjs'\n  import strange-form;\n"), /cannot place/, 'a form the reader does not know fails');
  assert.deepEqual(importsOf("export { a, b };\nconst t = 'import x';\n"), [], 'an export list without from and the word import in a string are not imports');
});

test('no chain of imports between the modules of the library comes back to where it started', () => {
  assert.deepEqual(cyclesOf(graphOf(SOURCES)), []);
  assert.deepEqual(cyclesOf({ 'a.mjs': ['b.mjs'], 'b.mjs': ['c.mjs'], 'c.mjs': ['a.mjs'], 'd.mjs': ['a.mjs'] }), ['a.mjs -> b.mjs -> c.mjs -> a.mjs']);
  assert.deepEqual(cyclesOf({ 'a.mjs': ['a.mjs'] }), ['a.mjs -> a.mjs'], 'a module that imports itself');
  assert.deepEqual(cyclesOf({ 'a.mjs': ['b.mjs'], 'b.mjs': [], 'c.mjs': ['a.mjs', 'b.mjs'] }), []);
});

test('a module of the library imports only the names it uses', () => {
  assert.deepEqual(unusedImports(SOURCES), []);
  assert.deepEqual(unusedImports({ 'a.mjs': "import { join, dirname } from 'node:path';\nimport { need as must } from './base.mjs';\nexport const x = join('a', 'b');\nconst y = o.dirname;\n" }), ['a.mjs: dirname', 'a.mjs: must']);
  assert.deepEqual(unusedImports({ 'a.mjs': "import { KINDS } from './base.mjs';\nconst all = [...KINDS];\n" }), [], 'a spread is a use');
});
