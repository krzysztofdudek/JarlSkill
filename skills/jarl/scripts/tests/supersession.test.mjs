// A ruling supersedes one ruling or several, in one call, and a supersession written by mistake is withdrawn with a reason
// the log keeps; nothing the record already holds is edited.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jarl, refuses, loop as makeLoop } from './helpers.mjs';
import { mergeDecisionsTexts } from '../jarl-lib.mjs';

const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const live = (root) => json(root, 'decisions', '--live').map((d) => d.slug);
const decisionsText = (root) => readFileSync(join(root, '.jarl', 'decisions.md'), 'utf8');
const logText = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
function chain() {
  const root = makeLoop({ prefix: 'jarl-supersede-', via: 'cli', dotGit: false });
  for (const s of ['a', 'b', 'c']) jarl(root, 'decide', s, `Ruling ${s}.`, '--by', 'coordinator');
  return root;
}

test('--supersedes takes several slugs, as a list or repeated, and marks each one in a single write', () => {
  const root = chain();
  const out = jarl(root, 'decide', 'd', 'D replaces a and b.', '--supersedes', 'a,b', '--by', 'coordinator');
  assert.match(out, /supersedes a, b/);
  assert.deepEqual(live(root), ['c', 'd']);
  assert.match(decisionsText(root), /## .* · a\nRuling a\.\n\n\*\*By:\*\* coordinator\n\*\*Superseded by:\*\* d \(/);
  assert.match(decisionsText(root), /\*\*Supersedes:\*\* a, b\n/);
  assert.equal(json(root, 'decisions').find((d) => d.slug === 'd').supersedes, 'a, b');
  jarl(root, 'decide', 'e', 'E replaces c and d.', '--supersedes', 'c', '--supersedes', 'd', '--by', 'coordinator');
  assert.deepEqual(live(root), ['e']);
  assert.match(jarl(root, 'decisions'), /a · by coordinator — Ruling a\. ?.* SUPERSEDED by d|SUPERSEDED by d/);
  assert.match(logText(root), /decided e · by coordinator · supersedes c, d/);
});

test('a list with one slug that cannot be superseded writes nothing, and names the slug', () => {
  const root = chain();
  assert.match(refuses(root, 'decide', 'd', 'D.', '--supersedes', 'a,nothing', '--by', 'coordinator'), /no ruling nothing in decisions\.md to supersede/);
  jarl(root, 'decide', 'x', 'X replaces b.', '--supersedes', 'b', '--by', 'coordinator');
  assert.match(refuses(root, 'decide', 'd', 'D.', '--supersedes', 'a,b', '--by', 'coordinator'), /b is already superseded by x/);
  assert.match(refuses(root, 'decide', 'd', 'D.', '--supersedes', 'a,a,d', '--by', 'coordinator'), /--supersedes names the slug of an earlier ruling/);
  assert.deepEqual(live(root), ['a', 'c', 'x'], 'nothing was written by the refused calls');
});

test('retract <slug> supersession takes a supersession back with a reason the log keeps, and the ruling is in force again', () => {
  const root = chain();
  jarl(root, 'decide', 'd', 'D replaces a and b.', '--supersedes', 'a,b', '--by', 'coordinator');
  const before = decisionsText(root);
  const out = jarl(root, 'retract', 'a', 'supersession', 'a was named by mistake', '--by', 'jarl');
  assert.match(out, /supersession of a by d withdrawn by jarl/);
  assert.deepEqual(live(root), ['a', 'c', 'd']);
  assert.ok(decisionsText(root).startsWith(before.trimEnd().slice(0, 200)), 'the text written stays');
  assert.match(decisionsText(root), /\*\*Supersession withdrawn:\*\* d \(\d{4}-\d{2}-\d{2}\) · by jarl · a was named by mistake/);
  assert.match(logText(root), /withdrew the supersession of a by d · by jarl · a was named by mistake/);
  assert.equal(json(root, 'decisions').find((d) => d.slug === 'd').supersedes, 'b', 'd supersedes b only now');
  assert.equal(json(root, 'decisions').find((d) => d.slug === 'a').supersededBy, null);
  jarl(root, 'decide', 'f', 'F replaces a.', '--supersedes', 'a', '--by', 'coordinator');
  assert.deepEqual(live(root), ['c', 'd', 'f']);
});

test('a supersession is withdrawn only for a ruling that is superseded, with a reason and a writer', () => {
  const root = chain();
  jarl(root, 'decide', 'd', 'D replaces a.', '--supersedes', 'a', '--by', 'coordinator');
  assert.match(refuses(root, 'retract', 'b', 'supersession', 'why', '--by', 'jarl'), /b is not superseded/);
  assert.match(refuses(root, 'retract', 'nothing', 'supersession', 'why', '--by', 'jarl'), /no ruling nothing/);
  assert.match(refuses(root, 'retract', 'a', 'supersession', '--by', 'jarl'), /retract/);
  assert.deepEqual(live(root), ['b', 'c', 'd']);
  jarl(root, 'retract', 'a', 'supersession', 'wrong ruling', '--by', 'jarl');
  assert.match(refuses(root, 'retract', 'a', 'supersession', 'again', '--by', 'jarl'), /a is not superseded/);
});

test('the decisions driver reads every slug of a Supersedes line when it looks for two successors of one ruling', () => {
  const ruling = (slug, ...meta) => `## 2026-01-01 · ${slug}\nRuling ${slug}.\n\n${meta.join('\n')}\n`;
  const file = (...blocks) => `# Decisions\n\n${blocks.join('\n')}`;
  const base = file(ruling('a'), ruling('b'));
  const ours = file(ruling('a'), ruling('b'), ruling('n1', '**Supersedes:** a, b'));
  const theirs = file(ruling('a'), ruling('b'), ruling('n2', '**Supersedes:** b'));
  const r = mergeDecisionsTexts(base, ours, theirs);
  assert.equal(r.ok, false);
  assert.ok(r.conflicts.some((c) => /b is superseded on both sides — by n1 and by n2/.test(c)), r.conflicts.join('; '));
});
