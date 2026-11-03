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
  ['ground', ['base.mjs', 'git.mjs', 'where.mjs', 'files.mjs', 'ids.mjs'],
    'the vocabulary, a process, a path, a whole file and an id: nothing of the record'],
  ['record', ['profile.mjs', 'journal.mjs', 'loop-git.mjs', 'lock.mjs', 'log.mjs', 'issues.mjs', 'repositories.mjs', 'loop.mjs', 'metrics.mjs', 'models.mjs', 'rounds.mjs', 'attachments.mjs', 'tips.mjs'],
    'the record read and written: the profile, the journal, the lock, the log, an issue, the repositories, the loaded loop and what is derived from it'],
  ['commands', ['commands.mjs', 'questions.mjs', 'evidence.mjs', 'queue.mjs', 'review.mjs', 'changelog.mjs', 'import.mjs', 'resume.mjs', 'verify.mjs', 'merge-driver.mjs'],
    'the commands and the views, each standing on the record and on the commands under it'],
];

// Every import of a module as { spec, names: [{ imported, local }] }: static imports over one line or many, side-effect
// imports and export … from. A dynamic import is refused outright: the graph is read from the text alone.
function importsOf(text) {
  assert.doesNotMatch(text, /\bimport\s*\(/, 'a dynamic import');
  return [...text.matchAll(/^(?:import|export)\s*(?:\{([^}]*)\}\s*from\s*|\*\s+as\s+\w+\s+from\s*)?['"]([^'"]+)['"]/gm)].map((m) => ({
    spec: m[2],
    names: (m[1] || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const [imported, local = imported] = s.split(/\s+as\s+/);
      return { imported, local };
    }),
  }));
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
