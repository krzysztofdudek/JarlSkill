// The goal is read by one grammar: goalLines returns what it carries for the tool, goalLineText writes a line it reads back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../jarl-lib.mjs';

const GOAL = [
  '# Goal', '', 'Ship the thing', '',
  '## Rules that apply here',
  'Check: make all',
  '- **Check (lib):** `npm test`',
  '* Check (app): yg check',
  'Check (lib): lint',
  'Check:   ',
  '**Coordinators:** Ada, **Grace**',
  'Coordinators (ignored): nobody',
  'Model (light): `haiku`, small',
  '- Model (STANDARD): sonnet@high',
  'Model: no tier',
  'Model (strong): opus',
  'Model (strong): fable',
].join('\n');

test('goalLines reads the goal, the checks, the checks per repository, the models and the coordinators in one pass', () => {
  const g = L.goalLines(GOAL);
  assert.equal(g.goal, 'Ship the thing');
  assert.deepEqual(g.checksByRepo, { bare: ['make all'], repos: { lib: ['npm test', 'lint'], app: ['yg check'] } });
  assert.deepEqual(g.checks, ['make all', 'npm test', 'lint', 'yg check']);
  assert.deepEqual(g.coordinators, ['Ada', 'Grace']);
  assert.deepEqual(g.models, [
    { tier: 'light', models: ['haiku', 'small'] }, { tier: 'STANDARD', models: ['sonnet@high'] },
    { tier: 'strong', models: ['opus'] }, { tier: 'strong', models: ['fable'] },
  ]);
});

test('goalLines of a loop with no goal is empty, and a goal without lines carries only its first line', () => {
  assert.deepEqual(L.goalLines(null), { goal: null, checks: [], checksByRepo: { bare: [], repos: {} }, models: [], coordinators: [] });
  const bare = L.goalLines('# Goal\n\n\nJust this\n');
  assert.equal(bare.goal, 'Just this');
  assert.deepEqual(bare.checks, []);
});

test('goalLineText writes a line goalLines reads back', () => {
  const text = ['# Goal', '', 'g', L.goalLineText('Check', 'make all'), L.goalLineText('Check', 'npm test', 'lib'), L.goalLineText('Model', ['a', 'b'], 'light'), L.goalLineText('Coordinators', ['x', 'y'])].join('\n');
  const g = L.goalLines(text);
  assert.deepEqual(g.checksByRepo, { bare: ['make all'], repos: { lib: ['npm test'] } });
  assert.deepEqual(g.models, [{ tier: 'light', models: ['a', 'b'] }]);
  assert.deepEqual(g.coordinators, ['x', 'y']);
});
