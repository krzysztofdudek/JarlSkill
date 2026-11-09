// A profile's "models" names the strongest model a loop may use (its ceiling, read by its tier on the goal's Model lines)
// and the models it may not use (barred). The profile check refuses a model no Model line places. Jarl refuses no lease and
// no verdict for it; its advice keeps under it: the model next shows for a tier, the takeover's tier up, and the words of
// the fresh-review rule, which name the lighter worker that makes the review possible where the reviewer the rule needs
// is beyond what the profile allows. A loop whose profile names no models reads and writes as it does without the key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jarl, refuses, run, loop as makeLoop } from './helpers.mjs';
import { BUILTIN_STATUSES } from '../jarl-lib.mjs';

const FOUND = 'read the diff and the rows, nothing found';
const profileFile = (extra) => {
  const file = join(mkdtempSync(join(tmpdir(), 'jarl-ceiling-profile-')), 'profile.json');
  writeFileSync(file, JSON.stringify({ 'jarl-profile': 1, statuses: BUILTIN_STATUSES, initial: 'open', ...extra }));
  return file;
};
// A loop with a model per tier (two on the light line), under the reviewer rule and the models given.
function ceilingLoop({ reviewer, models } = {}) {
  const root = makeLoop({ prefix: 'jarl-ceiling-', via: 'cli' });
  jarl(root, 'goal', '--set', 'Model (light): m-light, m-light2');
  jarl(root, 'goal', '--set', 'Model (standard): m-std');
  jarl(root, 'goal', '--set', 'Model (strong): m-strong');
  const profile = { ...(reviewer ? { 'done-gate': { reviewer } } : {}), ...(models ? { models } : {}) };
  writeFileSync(join(root, '.jarl', 'profile.json'), JSON.stringify({ 'jarl-profile': 1, statuses: BUILTIN_STATUSES, initial: 'open', ...profile }, null, 2));
  return root;
}
const leased = (root, id, model) => {
  jarl(root, 'set', id, 'in-progress', '--worker', `w${id}`, '--model', model);
  jarl(root, 'evidence', id, '--line', '1', '--ran', 'npm test', '--saw', 'pass 4, fail 0');
};

test('the profile names a ceiling and barred models: shown by profile, and a model no Model line places is refused by the check', () => {
  const root = ceilingLoop({ models: { ceiling: 'm-std', barred: ['m-light2'] } });
  const shown = jarl(root, 'profile');
  assert.match(shown, /^models: ceiling m-std \(nothing of a stronger tier\) · barred m-light2 — the owner's lever for cost; Jarl reads no usage or budget from the host$/m);
  assert.deepEqual(JSON.parse(jarl(root, 'profile', '--json')).models, { ceiling: 'm-std', barred: ['m-light2'] });
  // The check of a file reads the Model lines of the loop the call reaches.
  const typo = refuses(root, 'profile', profileFile({ models: { ceiling: 'm-stdd' } }));
  assert.match(typo, /names models the loop does not know:\n- "models" names m-stdd, which no Model line of the goal places\n— a loop knows its models from the Model lines of its goal/);
  assert.match(typo, /\njarl\.mjs goal --set "<machine-line>" --by "<who>"\n$/);
  assert.match(refuses(root, 'profile', profileFile({ models: { ceiling: 'm-std', barred: ['m-std'] } })), /"models": the ceiling m-std is barred as well/);
  assert.match(jarl(root, 'profile', profileFile({ models: { barred: ['m-strong'] } })), /^models: barred m-strong — /m);
  // The shape of the key is the schema's.
  const bad = (models) => refuses(root, 'profile', profileFile({ models }));
  assert.match(bad({}), /"models" names a "ceiling", a "barred" list, or both/);
  assert.match(bad({ ceiling: ['m-std'] }), /"models": "ceiling" is one model id/);
  assert.match(bad({ barred: 'm-std' }), /"models": "barred" is a non-empty list of model ids/);
  assert.match(bad({ cap: 'm-std' }), /"models": unknown key "cap" — it takes ceiling, barred/);
  // The loop's own profile, edited by hand, is checked the same way.
  const own = join(root, '.jarl', 'profile.json');
  writeFileSync(own, readFileSync(own, 'utf8').replace('"m-std"', '"m-gone"'));
  assert.match(refuses(root, 'profile'), /"models" names m-gone, which no Model line of the goal places/);
});

test('init with a profile that names models opens the loop and says the goal places none yet', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-ceiling-init-'));
  const r = run(root, ['init', 'goal', '--profile', profileFile({ models: { ceiling: 'm-std' } })]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /note: the profile names models, and the goal places none yet: add a Model line for each tier, then check the profile — jarl\.mjs goal --set "<machine-line>", then jarl\.mjs profile/);
});

test('a lease and a verdict on a model the profile does not allow are recorded, with a note that refuses nothing', () => {
  const root = ceilingLoop({ models: { ceiling: 'm-std', barred: ['m-light2'] } });
  jarl(root, 'new', 'a change', '--acceptance', '[read] it works');
  const lease = run(root, ['set', '1', 'in-progress', '--worker', 'w1', '--model', 'm-strong']);
  assert.equal(lease.status, 0, lease.stderr);
  assert.match(lease.stderr, /m-strong is above the profile's ceiling \(m-std\) — the record keeps the model as given and Jarl refuses nothing for it/);
  const verdict = run(root, ['review', '1', 'changes', '--by', 'rev-1', '--model', 'm-light2@high', 'Important: the edge case is not handled']);
  assert.equal(verdict.status, 0, verdict.stderr);
  assert.match(verdict.stderr, /m-light2@high is barred by the profile \(m-light2\) — /);
});

test('the refusal of done says when the reviewer the rule needs is beyond the ceiling, and names the lighter worker', () => {
  const root = ceilingLoop({ reviewer: 'model-rank', models: { ceiling: 'm-std' } });
  jarl(root, 'new', 'a change', '--acceptance', '[read] it works');
  leased(root, '1', 'm-strong');
  const note = run(root, ['review', '1', 'approve', '--by', 'rev-1', '--model', 'm-std', FOUND]);
  assert.match(note.stderr, /1: m-std ranks below the worker's model \(m-strong\) — a gate in this loop: done refuses this approve, .*; the reviewer the fresh-review rule needs for a worker on m-strong is beyond what the profile allows \(ceiling m-std\): a worker on m-std lets m-std review it/);
  const said = refuses(root, 'set', '1', 'done', 'approved', '--by', 'jarl');
  assert.match(said, /^1's live approve is by rev-1 on m-std, which ranks below the worker's model \(m-strong\) — this loop's profile asks for a reviewer of a model ranked at least as the worker's \(done-gate "reviewer": "model-rank"\); the reviewer the fresh-review rule needs for a worker on m-strong is beyond what the profile allows \(ceiling m-std\): a worker on m-std lets m-std review it/);
  // Under "other-model", a ceiling that leaves only the worker's own model says no lighter worker makes the review possible.
  const one = ceilingLoop({ reviewer: 'other-model', models: { ceiling: 'm-light', barred: ['m-light2'] } });
  jarl(one, 'new', 'a change', '--acceptance', '[read] it works');
  leased(one, '1', 'm-light');
  run(one, ['review', '1', 'approve', '--by', 'rev-1', '--model', 'm-light', FOUND]);
  assert.match(refuses(one, 'set', '1', 'done', 'approved', '--by', 'jarl'), /the model of its worker — .*; the reviewer the fresh-review rule needs for a worker on m-light is beyond what the profile allows \(ceiling m-light, barred m-light2\), and no lighter worker makes the review possible: the profile allows only m-light, and its models are the owner's to change/);
  // Where a model the profile allows meets the rule, the refusal is as it is without the key.
  const room = ceilingLoop({ reviewer: 'model-rank', models: { ceiling: 'm-strong' } });
  jarl(room, 'new', 'a change', '--acceptance', '[read] it works');
  leased(room, '1', 'm-strong');
  run(room, ['review', '1', 'approve', '--by', 'rev-1', '--model', 'm-std', FOUND]);
  assert.doesNotMatch(refuses(room, 'set', '1', 'done', 'approved', '--by', 'jarl'), /beyond what the profile allows/);
});

test('next shows the model the profile allows for each tier, and the lighter worker where the review would be beyond it', () => {
  const root = ceilingLoop({ models: { ceiling: 'm-std' } });
  jarl(root, 'new', 'hard', '--tier', 'strong', '--acceptance', '[read] it works');
  jarl(root, 'new', 'ordinary', '--tier', 'standard', '--acceptance', '[read] it works');
  jarl(root, 'new', 'small', '--tier', 'light', '--acceptance', '[read] it works');
  const next = jarl(root, 'next');
  assert.match(next, /^1 {2}P2 {2}hard {2}\(no files declared\) {2}\[model m-std \(in place of m-strong, above the profile's ceiling \(m-std\)\) — the reviewer the fresh-review rule needs for a worker on m-std is beyond what the profile allows \(ceiling m-std\): a worker on m-light lets m-std review it\]$/m);
  assert.match(next, /^2 {2}P2 {2}ordinary {2}\(no files declared\) {2}\[model m-std — the reviewer the fresh-review rule needs for a worker on m-std is beyond what the profile allows \(ceiling m-std\): a worker on m-light lets m-std review it\]$/m);
  assert.match(next, /^3 {2}P2 {2}small {2}\(no files declared\) {2}\[model m-light\]$/m);
  // A second model at the ceiling's tier is a reviewer the rule accepts: nothing is said.
  jarl(root, 'goal', '--set', 'Model (standard): m-std, m-std2');
  assert.match(jarl(root, 'next'), /^2 {2}P2 {2}ordinary {2}\(no files declared\) {2}\[model m-std\]$/m);
  // Without the key, next shows the tier's default and nothing more.
  const plain = ceilingLoop();
  jarl(plain, 'new', 'hard', '--tier', 'strong', '--acceptance', '[read] it works');
  assert.match(jarl(plain, 'next'), /^1 {2}P2 {2}hard {2}\(no files declared\) {2}\[model m-strong\]$/m);
  assert.equal(JSON.parse(jarl(plain, 'profile', '--json')).models, undefined);
});

// What next, the note after an approve and the refusal of done print for one issue: a strong issue in next, and the same
// issue leased on `worker` and approved on `reviewer`.
function seen(profile, worker, reviewer) {
  const root = ceilingLoop(profile);
  jarl(root, 'new', 'hard', '--tier', 'strong', '--acceptance', '[read] it works');
  const next = jarl(root, 'next');
  leased(root, '1', worker);
  const note = run(root, ['review', '1', 'approve', '--by', 'rev-1', '--model', reviewer, FOUND]).stderr;
  const done = run(root, ['set', '1', 'done', 'approved', '--by', 'jarl']);
  return { next, note, done: done.status === 0 ? '' : done.stderr };
}
const plain = (said) => said.replace(/note: m-\S+ is (?:barred by the profile|above the profile's ceiling)[^\n]*\n?/g, '');

test('where the profile is not what limits the review, next, the note and done say exactly what they say without the key', () => {
  // Each rule with the approve it refuses or advises against: the worker's own model under "other-model", a lower one else.
  for (const [reviewer, approve] of [['agent', 'm-std'], ['other-model', 'm-strong'], ['model-rank', 'm-std']]) {
    const without = seen({ reviewer }, 'm-strong', approve);
    for (const models of [{ barred: ['m-light2'] }, { ceiling: 'm-strong' }, { ceiling: 'm-nowhere' }]) {
      const withKey = seen({ reviewer, models }, 'm-strong', approve);
      const named = `${reviewer} ${JSON.stringify(models)}`;
      assert.doesNotMatch(`${withKey.next}${withKey.note}${withKey.done}`, /beyond what the profile allows/, named);
      assert.equal(withKey.next, without.next, `next: ${named}`);
      assert.equal(plain(withKey.note), without.note, `the note: ${named}`);
      assert.equal(withKey.done, without.done, `done: ${named}`);
    }
  }
});

test('where the profile bars the model the rule needs, each rule says so and names the nearest worker that makes the review possible', () => {
  // The strongest model barred: next shows the strongest allowed, and its reviewer is out of reach under the advice.
  const barred = seen({ models: { barred: ['m-strong'] } }, 'm-std', 'm-light');
  assert.match(barred.next, /\[model m-std \(in place of m-strong, barred by the profile\) — the reviewer the fresh-review rule needs for a worker on m-std is beyond what the profile allows \(barred m-strong\): a worker on m-light lets m-std review it\]/);
  assert.match(barred.note, /m-light ranks below the worker's model \(m-std\) — advice, not a gate: .*; the reviewer the fresh-review rule needs for a worker on m-std is beyond what the profile allows \(barred m-strong\): a worker on m-light lets m-std review it/);
  // Under "other-model", where every model the profile allows held the lease, a lighter worker frees the strongest to review.
  const other = ceilingLoop({ reviewer: 'other-model', models: { barred: ['m-light2', 'm-strong'] } });
  jarl(other, 'new', 'hard', '--tier', 'strong', '--acceptance', '[read] it works');
  leased(other, '1', 'm-light');
  jarl(other, 'set', '1', 'in-progress', 'taken over after two red rounds', '--worker', 'w2', '--model', 'm-std', '--handover');
  run(other, ['review', '1', 'approve', '--by', 'rev-1', '--model', 'm-std', FOUND]);
  assert.match(run(other, ['set', '1', 'done', 'approved', '--by', 'jarl']).stderr, /the model of its worker — .*; the reviewer the fresh-review rule needs for a worker on m-light, m-std is beyond what the profile allows \(barred m-light2, m-strong\): a worker on m-light lets m-std review it/);
  // Under "model-rank" the reviewer's own tier is the nearest worker: another model of it, else the reviewer's own.
  const rank = seen({ reviewer: 'model-rank', models: { ceiling: 'm-light' } }, 'm-strong', 'm-light');
  assert.match(rank.done, /ranks below the worker's model \(m-strong\) — .*: a worker on m-light2 lets m-light review it/);
  // Everything barred: nothing the profile allows can review, and next shows no model.
  const none = seen({ reviewer: 'model-rank', models: { barred: ['m-light', 'm-light2', 'm-std', 'm-strong'] } }, 'm-strong', 'm-light');
  assert.match(none.next, /\[no model the profile allows at this tier or below \(in place of m-strong, barred by the profile\)\]/);
  assert.match(none.done, /beyond what the profile allows \(barred m-light, m-light2, m-std, m-strong\), and no lighter worker makes the review possible: the profile allows no model the goal places, and its models are the owner's to change/);
});

test('verify reports a model the profile names that no Model line places, as profile refuses it', () => {
  const root = ceilingLoop({ models: { ceiling: 'm-nowhere', barred: ['m-std'] } });
  const r = run(root, ['verify']);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /"models" names m-nowhere, which no Model line of the goal places/);
  assert.doesNotMatch(r.stdout, /names m-std,/);
  assert.equal(run(ceilingLoop({ models: { ceiling: 'm-std' } }), ['verify']).stdout.includes('"models" names'), false);
});

test('the takeover offers no tier above the profile\'s ceiling', () => {
  const root = ceilingLoop({ models: { ceiling: 'm-std' } });
  jarl(root, 'new', 'ordinary', '--tier', 'standard', '--acceptance', '[read] it works');
  jarl(root, 'set', '1', 'in-progress', '--worker', 'w1', '--model', 'm-std');
  for (const n of [1, 2]) jarl(root, 'round', '1', `red ${n}`);
  const block = jarl(root, 'round', '1', 'red 3');
  assert.match(block, /the profile's ceiling \(m-std\) allows no tier above standard, so put it on a model other than m-std that the profile allows, or change the approach/);
  assert.doesNotMatch(block, /one tier up/);
  const light = ceilingLoop({ models: { ceiling: 'm-std' } });
  jarl(light, 'new', 'small', '--tier', 'light', '--acceptance', '[read] it works');
  jarl(light, 'set', '1', 'in-progress', '--worker', 'w1', '--model', 'm-light');
  for (const n of [1, 2]) jarl(light, 'round', '1', `red ${n}`);
  assert.match(jarl(light, 'round', '1', 'red 3'), /raise it one tier up from light \(to standard\)/);
  // From the top tier, a ceiling below it is named; a ceiling at the top tier limits nothing.
  for (const [ceiling, said] of [['m-std', /the profile's ceiling \(m-std\) allows no tier above standard, so put it on a model other than m-strong that the profile allows/], ['m-strong', /strong is the top tier \(strong\), so put it on a model other than m-strong,/]]) {
    const top = ceilingLoop({ models: { ceiling } });
    jarl(top, 'new', 'hard', '--tier', 'strong', '--acceptance', '[read] it works');
    jarl(top, 'set', '1', 'in-progress', '--worker', 'w1', '--model', 'm-strong');
    for (const n of [1, 2]) jarl(top, 'round', '1', `red ${n}`);
    assert.match(jarl(top, 'round', '1', 'red 3'), said);
  }
});
