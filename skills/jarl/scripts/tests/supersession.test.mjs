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
  const said = refuses(root, 'decide', 'd', 'D.', '--supersedes', 'a,nothing', '--by', 'coordinator');
  assert.match(said, /no ruling nothing in decisions\.md to supersede/);
  assert.match(said, /--supersedes "a,<a-ruling-in-force>"/, 'the form keeps the slugs that were fine and replaces the one that was not');
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
  const after = decisionsText(root).split('\n');
  let at = 0;
  for (const line of before.split('\n')) { const k = after.indexOf(line, at); assert.notEqual(k, -1, `the line stays: ${line}`); at = k + 1; }
  assert.match(decisionsText(root), /\*\*Superseded by:\*\* \(withdrawn\) d \(\d{4}-\d{2}-\d{2}\) · by jarl · a was named by mistake/);
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

// The closing block of a ruling as Jarl 6.3.0 reads it: from its end, up to the first line that is none of its fields. A
// withdrawal written as a line of a field that reader does not know would end the block there and leave By, Applies to and the
// owner's words inside the ruling's text.
const OLD_META = /^\*\*(Waives review|Applies to|By|Supersedes|Superseded by|Settles|Area|Reach|Rule|Ratified|Rejected|Type log|Rule log):\*\*\s*(.*)$/;
function oldReading(text, slug) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.endsWith(` · ${slug}`) && l.startsWith('## '));
  let end = lines.findIndex((l, n) => n > at && l.startsWith('## '));
  if (end === -1) end = lines.length;
  const body = lines.slice(at + 1, end);
  let cut = body.length;
  while (cut > 0 && (body[cut - 1].trim() === '' || OLD_META.test(body[cut - 1]))) cut -= 1;
  const meta = body.slice(cut).map((l) => OLD_META.exec(l)).filter(Boolean);
  return { ruling: body.slice(0, cut).join('\n').trim(), by: meta.filter((m) => m[1] === 'By').pop()?.[2], applies: meta.filter((m) => m[1] === 'Applies to').pop()?.[2] ?? null };
}

test('a record that holds a withdrawal is read by an older Jarl with every field in place, the ruling still reading as superseded', () => {
  const root = makeLoop({ prefix: 'jarl-withdraw-old-', via: 'cli', dotGit: false });
  jarl(root, 'decide', 'a', 'Run the tests.', '--applies-to', 'role worker', '--by', 'owner', '--quote', 'Yes, run them.');
  jarl(root, 'decide', 'b', 'B replaces a by mistake.', '--supersedes', 'a', '--by', 'jarl');
  jarl(root, 'retract', 'a', 'supersession', 'a was named by mistake', '--by', 'jarl');
  const old = oldReading(decisionsText(root), 'a');
  assert.equal(old.by, 'owner');
  assert.equal(old.applies, 'role worker');
  assert.match(old.ruling, /^Run the tests\.\n\nThe owner's words: "Yes, run them\."$/);
  assert.deepEqual(live(root), ['a', 'b']);
});

test('the decisions driver merges a withdrawal added on one side, and still refuses two successors', () => {
  const block = (slug, ...meta) => `## 2026-01-01 · ${slug}\nRuling ${slug}.\n\n${meta.join('\n')}\n`;
  const file = (...blocks) => `# Decisions\n\n${blocks.join('\n')}`;
  const base = file(block('a', '**Superseded by:** d (2026-01-02)'), block('d', '**Supersedes:** a'));
  const withdrawn = file(block('a', '**Superseded by:** d (2026-01-02)', '**Superseded by:** (withdrawn) d (2026-01-03) · by jarl · mistake'), block('d', '**Supersedes:** a'));
  const again = file(block('a', '**Superseded by:** d (2026-01-02)', '**Superseded by:** (withdrawn) d (2026-01-03) · by jarl · mistake', '**Superseded by:** f (2026-01-04)'), block('d', '**Supersedes:** a'), block('f', '**Supersedes:** a'));
  assert.equal(mergeDecisionsTexts(base, withdrawn, base).ok, true);
  assert.equal(mergeDecisionsTexts(base, base, withdrawn).ok, true);
  const merged = mergeDecisionsTexts(base, again, withdrawn);
  assert.equal(merged.ok, true, merged.conflicts?.join('; '));
  assert.equal(mergeDecisionsTexts(file(block('a'), block('d'), block('e')), file(block('a', '**Superseded by:** d (2026-01-02)'), block('d'), block('e')), file(block('a', '**Superseded by:** e (2026-01-02)'), block('d'), block('e'))).ok, false);
});
