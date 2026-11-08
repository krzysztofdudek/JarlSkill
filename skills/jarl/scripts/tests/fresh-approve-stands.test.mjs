// In a loop whose done gate names no bot and no "clears", the approve that stands behind an issue is the strongest one
// since its last round: a fresh agent's before the loop's director's, and the more recent of two of one standing. A later
// approve by the loop's director never takes the place of a fresh one, so the live approve, the counts of status and report
// and the decisions of done are those of the fresh approve, under every reviewer rule, on code and on an issue with no code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jarl, run, loop as makeLoop } from './helpers.mjs';
import { BUILTIN_STATUSES, gateOf, readLoop } from '../jarl-lib.mjs';

const WORKER_MODEL = 'm-strong';
// The model each rule accepts on an approve of an issue whose worker ran on m-strong, and one it refuses; under the
// default rule the model is advice, and both are accepted.
const MODELS = {
  agent: { ok: 'm-light', refused: 'm-strong' },
  'other-model': { ok: 'm-light', refused: 'm-strong' },
  'model-rank': { ok: 'm-strong', refused: 'm-light' },
};
// The approves of each case, in the order they are given: by a fresh agent (fresh) or the loop's director (jarl), each
// on a model the rule accepts (ok) or refuses (refused).
const CASES = {
  'a fresh approve alone': [['fresh', 'ok']],
  'a fresh approve, then the director\'s': [['fresh', 'ok'], ['jarl', 'refused']],
  'a fresh approve the rule refuses, then the director\'s it accepts': [['fresh', 'refused'], ['jarl', 'ok']],
  'the director\'s approve, then a fresh one the rule refuses': [['jarl', 'ok'], ['fresh', 'refused']],
  'the director\'s approve alone': [['jarl', 'ok']],
};

function ruleLoop(rule) {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-fresh-stands-profile-'));
  writeFileSync(join(dir, 'profile.json'), JSON.stringify({ 'jarl-profile': 1, statuses: BUILTIN_STATUSES, initial: 'open', 'done-gate': { reviewer: rule } }));
  const root = makeLoop({ prefix: 'jarl-fresh-stands-', via: 'cli', initFlags: ['--profile', join(dir, 'profile.json')] });
  jarl(root, 'goal', '--set', 'Model (light): m-light');
  jarl(root, 'goal', '--set', 'Model (strong): m-strong');
  const issues = [];
  for (const [name, approves] of Object.entries(CASES)) {
    for (const code of [true, false]) {
      const id = String(issues.length + 1);
      jarl(root, 'new', `${name}${code ? '' : ', no code'}`, '--acceptance', '[read] it works');
      jarl(root, 'set', id, 'in-progress', '--worker', `w${id}`, '--model', WORKER_MODEL, ...(code ? ['--branch', `jarl/${id}`] : []), '--by', 'jarl');
      jarl(root, 'evidence', id, '--line', '1', '--ran', 'npm test', '--saw', 'pass 3, fail 0', '--by', `w${id}`);
      if (code) jarl(root, 'merged', id, '--sha', 'abc1234', '--ci', 'none', '--by', 'jarl');
      for (const [who, fit] of approves) {
        const r = run(root, ['review', id, 'approve', '--by', who === 'fresh' ? `rev-${id}` : 'jarl', '--model', MODELS[rule][fit], 'read the change against its acceptance, nothing found']);
        assert.equal(r.status, 0, r.stderr);
      }
      issues.push({ id, name, code, approves });
    }
  }
  return { root, issues };
}

// What the record shows for each case before done is asked: the live approve's reviewer, standing and model, and whether
// it clears the issue as one carrying code; then whether done closes it.
const expected = (rule, { approves, code }) => {
  const fresh = approves.find(([who]) => who === 'fresh');
  const live = fresh || approves[approves.length - 1];
  const kind = fresh ? 'fresh' : 'coordinator';
  const modelRefused = rule !== 'agent' && live[1] === 'refused';
  return { kind, model: MODELS[rule][live[1]], fresh: Boolean(fresh), closes: !modelRefused && (Boolean(fresh) || !code) };
};

for (const rule of Object.keys(MODELS)) {
  test(`under the reviewer rule ${rule}, a later approve by the loop's director never takes the place of a fresh one: the live approve, done and the counts are the fresh approve's, on code and with no code`, () => {
    const { root, issues } = ruleLoop(rule);
    const loop = readLoop(join(root, '.jarl'));
    const want = { fresh: 0, coordinator: 0 };
    for (const issue of issues) {
      const e = expected(rule, issue);
      const g = gateOf(loop, issue.id);
      const what = `${issue.name}${issue.code ? '' : ', no code'}`;
      assert.deepEqual({ kind: g.live.kind, model: g.live.model, by: g.live.by, fresh: g.fresh, approved: g.approved }, { kind: e.kind, model: e.model, by: e.kind === 'fresh' ? `rev-${issue.id}` : 'jarl', fresh: e.fresh, approved: true }, what);
      const done = run(root, ['set', issue.id, 'done', 'the gate holds', '--by', 'jarl']);
      assert.equal(done.status === 0, e.closes, `${what}: ${done.stderr}`);
      if (e.closes) want[e.kind] += 1;
    }
    const reviews = JSON.parse(jarl(root, 'status', '--json')).reviews;
    assert.deepEqual({ fresh: reviews.fresh, coordinator: reviews.coordinator, self: reviews.self }, { ...want, self: 0 });
    assert.match(jarl(root, 'report'), new RegExp(`^Reviewed by: fresh ${want.fresh} · coordinator ${want.coordinator} · self 0$`, 'm'));
  });
}
