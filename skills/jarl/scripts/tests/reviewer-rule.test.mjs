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
import * as R from '../record.mjs';

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
  jarl(root, 'new', 'a change', '--acceptance', '[read] it works');
  jarl(root, 'new', 'a refactor', '--acceptance', '[read] the output is the same', '--tags', 'identical-output');
  for (const id of ['1', '2']) {
    jarl(root, 'set', id, 'in-progress', '--worker', `w${id}`, '--model', 'm-strong', '--by', 'jarl');
    jarl(root, 'evidence', id, '--line', '1', '--ran', 'npm test', '--saw', 'pass 4, fail 0', '--by', `w${id}`);
  }
  // The change meant to alter nothing holds the row that names its comparison, which its light review depends on.
  jarl(root, 'evidence', '2', '--line', '1', '--ran', 'cmp before.txt after.txt', '--saw', 'cmp printed nothing, exit 0', '--by', 'w2');
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
  jarl(root, 'new', 'another change', '--acceptance', '[read] it works');
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
  assert.match(said, /\njarl\.mjs review "<ids>" "<verdict>" "<what-was-read-and-found>" --by "<a-fresh-reviewer>" --model "<model-id>"\n$/);
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

// The same loop with the lease recording no model: the worker's model is unknown to the record.
function unknownWorkerLoop(reviewer) {
  const root = modelLoop(reviewer);
  jarl(root, 'new', 'a change leased with no model', '--acceptance', '[read] it works');
  jarl(root, 'set', '3', 'in-progress', '--worker', 'w3', '--by', 'jarl');
  jarl(root, 'evidence', '3', '--line', '1', '--ran', 'npm test', '--saw', 'pass 4, fail 0', '--by', 'w3');
  return root;
}

for (const rule of ['other-model', 'model-rank']) {
  test(`"${rule}": an approve that names no model is refused by done, as its note says, whether or not the lease names a model, and the refusal ends with the form that names one`, () => {
    for (const id of ['3', '1']) {
      const root = unknownWorkerLoop(rule);
      const bare = run(root, ['review', id, 'approve', '--by', 'rev-x', 'read the diff and the rows, nothing found']);
      assert.equal(bare.status, 0, bare.stderr);
      assert.match(bare.stderr, new RegExp(`${id}: no --model on this verdict — .*done refuses an approve that names no model`));
      const said = refuses(root, 'set', id, 'done', 'proof and approve', '--by', 'jarl');
      assert.match(said, new RegExp(`^${id}'s live approve by rev-x names no model — `), `issue ${id}`);
      assert.match(said, /\njarl\.mjs review "<ids>" "<verdict>" "<what-was-read-and-found>" --by "<a-fresh-reviewer>" --model "<model-id>"\n$/, `issue ${id}`);
      assert.equal(R.findIssue(root, id).status, 'in-progress', `issue ${id} stays open`);
      approve(root, id, 'm-light-2');
      if (rule === 'other-model' || id === '3') assert.match(jarl(root, 'set', id, 'done', 'approve names its model', '--by', 'jarl'), new RegExp(`${id} → done`));
    }
  });

  test(`"${rule}": an approve on an issue whose lease names no model says done accepts it, because there is no worker's model to compare it with`, () => {
    const root = unknownWorkerLoop(rule);
    const said = approve(root, '3', 'm-light');
    assert.match(said.stderr, /3: the lease of 3 records no model, so .* has no worker's model to compare m-light with — done accepts this approve; the rule holds where the lease names the worker's model/);
    assert.doesNotMatch(said.stderr, /done refuses/);
    assert.match(jarl(root, 'set', '3', 'done', 'approved', '--by', 'jarl'), /3 → done/);
  });
}

test('a profile names the reviewer rule with one of its values; any other is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-reviewer-profile-'));
  writeFileSync(join(dir, 'p.json'), profileWith('bigger-model'));
  const root = makeLoop({ prefix: 'jarl-reviewer-rule-', via: 'cli' });
  assert.match(refuses(root, 'profile', join(dir, 'p.json')), /"done-gate": "reviewer" is one of agent, other-model, model-rank/);
});

// The step after an approve the rule refuses for its model is the review form that carries the model, the one a refusal of
// done ends with; after an approve the rule accepts it is the step that follows an approve anywhere.
const nextLine = (said) => (/ · next: (.*)$/m.exec(said.stdout) || [])[1];
const modelForm = (root, id) => refuses(root, 'set', id, 'done', 'x', '--by', 'jarl').trim().split('\n').pop();

for (const [rule, own, label] of [['other-model', 'm-strong', 'the worker\'s own model'], ['model-rank', 'm-light', 'a model ranked below the worker\'s']]) {
  test(`"${rule}": the line after an approve with no model, or with ${label}, names the review form that carries the model, not done`, () => {
    for (const given of [[], ['--model', own]]) {
      const root = modelLoop(rule);
      const said = run(root, ['review', '1', 'approve', '--by', 'rev-x', ...given, 'read the diff and the rows, nothing found']);
      assert.equal(said.status, 0, said.stderr);
      const form = modelForm(root, '1');
      assert.match(form, /^jarl\.mjs review "<ids>" "<verdict>" "<what-was-read-and-found>" --by "<a-fresh-reviewer>" --model "<model-id>"$/);
      assert.match(nextLine(said), /^done refuses this approve for its model \(done-gate "reviewer": "[a-z-]+"\), so an approve that names a model the rule accepts is next — jarl\.mjs review 1 "<verdict>" --by "<a-fresh-reviewer>" --model "<model-id>" "<text>" — then jarl\.mjs set 1 done "<why>" once the worker's Proof rows are recorded/, given.join(' '));
    }
  });

  test(`"${rule}": the line after an approve the rule accepts, and after any approve under the default rule, is the step that follows an approve`, () => {
    const root = modelLoop(rule);
    const accepted = run(root, ['review', '1', 'approve', '--by', 'rev-x', '--model', rule === 'other-model' ? 'm-light' : 'm-strong', 'read the diff and the rows, nothing found']);
    assert.equal(nextLine(accepted), 'jarl.mjs set 1 done "<why>" once the worker\'s Proof rows are recorded; a worker never sets done');
    const plain = modelLoop();
    const bare = run(plain, ['review', '1', 'approve', '--by', 'rev-x', 'read the diff and the rows, nothing found']);
    assert.equal(nextLine(bare), 'jarl.mjs set 1 done "<why>" once the worker\'s Proof rows are recorded; a worker never sets done');
  });

  test(`"${rule}": on an issue that carries code the fresh reviewer's approve asked for after a coordinator's carries the model, and a refused fresh approve is followed by the form before the merge`, () => {
    const root = modelLoop(rule);
    jarl(root, 'new', 'a change with code', '--acceptance', '[read] it works');
    jarl(root, 'set', '3', 'in-progress', '--worker', 'w3', '--model', 'm-strong', '--branch', 'jarl/3-code', '--by', 'jarl');
    jarl(root, 'evidence', '3', '--line', '1', '--ran', 'npm test', '--saw', 'pass 4, fail 0', '--by', 'w3');
    const coordinator = run(root, ['review', '3', 'approve', '--by', 'jarl', 'read the diff and the rows, nothing found']);
    assert.match(nextLine(coordinator), /^a fresh reviewer's approve is next — jarl\.mjs review 3 "<verdict>" --by "<a-fresh-reviewer>" --model "<model-id>" "<text>" — then the merger lands it$/);
    const fresh = run(root, ['review', '3', 'approve', '--by', 'rev-x', ...(rule === 'model-rank' ? ['--model', 'm-light'] : ['--model', 'm-strong']), 'read the diff and the rows, nothing found']);
    assert.match(nextLine(fresh), /^done refuses this approve for its model .* — jarl\.mjs review 3 "<verdict>" --by "<a-fresh-reviewer>" --model "<model-id>" "<text>" — then the merger merges the branch and records it with one call — jarl\.mjs merged 3 /);
    const good = run(root, ['review', '3', 'approve', '--by', 'rev-y', '--model', rule === 'other-model' ? 'm-light' : 'm-strong', 'read the diff and the rows, nothing found']);
    assert.match(nextLine(good), /^the merger merges the branch and records it with one call — /);
  });
}
