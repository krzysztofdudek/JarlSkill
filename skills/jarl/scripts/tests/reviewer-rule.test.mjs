// Which approve clears an issue is the loop's profile's: done-gate "reviewer" is "agent" by default (a separate agent,
// whatever its model), "other-model" (and a model no worker of the issue was leased on) or "model-rank" (and a model
// ranked at least as the worker's, a change meant to alter nothing excepted). The note on an approve says which: advice
// where the profile makes the model advice, a gate where it makes it one, never both; and done holds to the same rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jarl, refuses, run, loop as makeLoop } from './helpers.mjs';
import { BUILTIN_STATUSES } from '../jarl-lib.mjs';

// A profile file with the built-in statuses and the done gate's reviewer rule.
const profileWith = (reviewer) => JSON.stringify({ 'jarl-profile': 1, statuses: BUILTIN_STATUSES, initial: 'open', 'done-gate': { reviewer } });

function modelLoop(reviewer) {
  const flags = [];
  if (reviewer) {
    const dir = mkdtempSync(join(tmpdir(), 'jarl-reviewer-profile-'));
    writeFileSync(join(dir, 'profile.json'), profileWith(reviewer));
    flags.push('--profile', join(dir, 'profile.json'));
  }
  const root = makeLoop({ prefix: 'jarl-reviewer-rule-', via: 'cli', initFlags: flags });
  jarl(root, 'goal', '--set', 'Model (light): m-light');
  jarl(root, 'goal', '--set', 'Model (strong): m-strong');
  jarl(root, 'new', 'a change', '--acceptance', 'it works');
  jarl(root, 'new', 'a refactor', '--acceptance', 'the output is the same', '--tags', 'identical-output');
  for (const id of ['1', '2']) {
    jarl(root, 'set', id, 'in-progress', '--worker', `w${id}`, '--model', 'm-strong', '--by', 'jarl');
    jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'pass 4, fail 0', '--by', `w${id}`);
  }
  return root;
}
const approve = (root, id, model) => run(root, ['review', id, 'approve', '--by', `rev-${model}`, '--model', model, 'read the diff and the rows, nothing found']);

test('by default a separate agent clears: a same-model or lower-ranked approve is accepted, and its note says the model is advice', () => {
  const root = modelLoop();
  const same = approve(root, '1', 'm-strong');
  assert.equal(same.status, 0, same.stderr);
  assert.match(same.stderr, /1: an approve by the same model as the worker's \(m-strong\) — advice, not a gate: done accepts this approve, because in this loop the approve that clears an issue is a separate agent's, whatever its model \(done-gate "reviewer": "agent"\)/);
  assert.match(jarl(root, 'set', '1', 'done', 'proof and approve', '--by', 'jarl'), /1 → done/);
  const below = approve(root, '2', 'm-light');
  assert.doesNotMatch(below.stderr, /done refuses/);
  jarl(root, 'new', 'another change', '--acceptance', 'it works');
  jarl(root, 'set', '3', 'in-progress', '--worker', 'w3', '--model', 'm-strong', '--by', 'jarl');
  const low = approve(root, '3', 'm-light');
  assert.match(low.stderr, /3: m-light ranks below the worker's model \(m-strong\) — advice, not a gate: done accepts this approve/);
});

test('"other-model": the note says done refuses a same-model approve, done refuses it, and an approve of another model clears', () => {
  const root = modelLoop('other-model');
  const same = approve(root, '1', 'm-strong');
  assert.match(same.stderr, /1: an approve by the same model as the worker's \(m-strong\) — a gate in this loop: done refuses this approve, because the profile asks for a reviewer of a model no worker of the issue was leased on \(done-gate "reviewer": "other-model"\)/);
  assert.doesNotMatch(same.stderr, /advice/);
  const said = refuses(root, 'set', '1', 'done', 'proof and approve', '--by', 'jarl');
  assert.match(said, /^1's live approve is by rev-m-strong on m-strong, the model of its worker — this loop's profile asks for a reviewer of a model no worker of the issue was leased on \(done-gate "reviewer": "other-model"\)/);
  assert.match(said, /\njarl\.mjs review "<ids>" "<verdict>" "<what-was-read-and-found>" --by "<a-fresh-reviewer>"\n$/);
  assert.equal(approve(root, '1', 'm-light').stderr.includes('done refuses'), false);
  assert.match(jarl(root, 'set', '1', 'done', 'another model approved', '--by', 'jarl'), /1 → done/);
});

test('"model-rank": done refuses an approve ranked below the worker\'s model, except on a change meant to alter nothing', () => {
  const root = modelLoop('model-rank');
  const low = approve(root, '1', 'm-light');
  assert.match(low.stderr, /1: m-light ranks below the worker's model \(m-strong\) — a gate in this loop: done refuses this approve/);
  assert.match(refuses(root, 'set', '1', 'done', 'x', '--by', 'jarl'), /ranks below the worker's model \(m-strong\) — this loop's profile asks for a reviewer of a model ranked at least as the worker's \(done-gate "reviewer": "model-rank"\)/);
  const tagged = approve(root, '2', 'm-light');
  assert.match(tagged.stderr, /2: a change meant to alter nothing \(tag identical-output\): a light review may clear it/);
  assert.match(jarl(root, 'set', '2', 'done', 'the light review covers the comparison', '--by', 'jarl'), /2 → done/);
  approve(root, '1', 'm-strong');
  assert.match(jarl(root, 'set', '1', 'done', 'approved at the worker\'s rank', '--by', 'jarl'), /1 → done/);
});

test('a profile names the reviewer rule with one of its values; any other is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-reviewer-profile-'));
  writeFileSync(join(dir, 'p.json'), profileWith('bigger-model'));
  const root = makeLoop({ prefix: 'jarl-reviewer-rule-', via: 'cli' });
  assert.match(refuses(root, 'profile', join(dir, 'p.json')), /"done-gate": "reviewer" is one of agent, other-model, model-rank/);
});
