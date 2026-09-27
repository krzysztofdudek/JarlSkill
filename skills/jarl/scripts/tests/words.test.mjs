// Jarl is a block: a loop profile may bring any vocabulary, but Jarl's own code never names another tool's concepts.
// Three words stay out of jarl.mjs, jarl-lib.mjs, record.mjs and jarl-mcp.mjs entirely: wave, architect, node — and every word that starts with
// them (waves, architecture, nodes). The only allowed occurrences are the Node.js runtime, named where the code cannot
// avoid it; each allowed form is listed below, and anything else fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILES = ['../jarl.mjs', '../jarl-lib.mjs', '../record.mjs', '../jarl-mcp.mjs'];
const FORBIDDEN = /\b(wave|architect|node)/gi;
// The runtime, and only as written here: the shebang, an import from a node: built-in module, and "Node 22+".
const RUNTIME = [/^#!\/usr\/bin\/env node$/, /'node:[a-z_]+'/g, /\bNode 22\+/g];

test('the word test: jarl.mjs, jarl-lib.mjs, record.mjs and jarl-mcp.mjs never use wave, architect or node, beyond the Node.js runtime', () => {
  for (const f of FILES) {
    const lines = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8').split('\n');
    const hits = [];
    lines.forEach((line, n) => {
      let rest = line;
      for (const re of RUNTIME) rest = rest.replace(re, '');
      for (const m of rest.matchAll(FORBIDDEN)) hits.push(`${f}:${n + 1}: "${m[0]}" in ${line.trim()}`);
    });
    assert.deepEqual(hits, [], `forbidden words in ${f}`);
  }
});

test('the word test catches what it guards against, and the allow-list stays that narrow', () => {
  const scrub = (line) => RUNTIME.reduce((s, re) => s.replace(re, ''), line).match(FORBIDDEN) || [];
  assert.deepEqual(scrub("import { x } from 'node:fs';"), []);
  assert.deepEqual(scrub('#!/usr/bin/env node'), []);
  assert.deepEqual(scrub('// Zero dependencies, Node 22+.'), []);
  assert.deepEqual(scrub('const node = issue.fields.node;'), ['node', 'node']);
  assert.deepEqual(scrub('// the next wave closes'), ['wave']);
  assert.deepEqual(scrub('the architecture graph'), ['architect']);
  assert.deepEqual(scrub('a Nodes list'), ['Node']);
  assert.deepEqual(scrub('runs on Node.js'), ['Node']);
});
