// The landing banner says, per repository, how many merges carry the declared check: a merge counts when its --ran text
// equals a command a Check line of goal.md declares, after trimming whitespace. A repository with no declared check lands on
// testimony, whatever merges record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { jarl, loop as makeLoop, SPAWN_TIMEOUT } from './helpers.mjs';

const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const goal = (root, text) => appendFileSync(join(root, '.jarl', 'goal.md'), text);
const loop = (n) => {
  const root = makeLoop({ prefix: 'jarl-banner-', via: 'cli' });
  for (let k = 1; k <= n; k += 1) jarl(root, 'new', `issue ${k}`, '--acceptance', 'it works');
  return root;
};
const merge = (root, id, ran) => jarl(root, 'merged', String(id), '--sha', 'abc1234', ...(ran ? ['--ran', ran, '--saw', 'pass'] : []));

test('a loop with no Check line and one merge recorded with a --ran text lands on testimony, never on its check', () => {
  const root = loop(1);
  merge(root, 1, 'npm test');
  const check = json(root, 'status').check;
  assert.equal(check.declared, false);
  assert.equal(check.landsOn, 'testimony');
  const repo = Object.values(check.byRepo)[0];
  assert.deepEqual([repo.declared, repo.k, repo.n], [[], 0, 1]);
  for (const text of [jarl(root, 'status'), jarl(root, 'report')]) {
    assert.match(text, /no check is declared — this loop lands its merges on testimony alone/);
    assert.match(text, /no check declared/);
    assert.doesNotMatch(text, /carry the declared check/);
    assert.doesNotMatch(text, /lands on (its )?check\b/);
  }
});

test('a goal with no Check line says that no check is declared and that its merges are testimony, and a goal with a Check line keeps the declared mark', () => {
  const root = loop(1);
  merge(root, 1, 'npm test');
  for (const text of [jarl(root, 'status'), jarl(root, 'report')]) {
    assert.match(text, /^no check is declared — this loop lands its merges on testimony alone: a review is recorded as testimony, not proof/m);
    assert.doesNotMatch(text, /no merge carries the declared check/);
  }
  const declared = loop(1);
  goal(declared, '\nCheck: npm test\n');
  const text = jarl(declared, 'status');
  assert.match(text, /^no merge carries the declared check — this loop lands on testimony alone: a review is recorded as testimony, not proof/m);
  assert.doesNotMatch(text, /no check is declared/);
});

test('with a declared check, status and report say how many of the merges carry it', () => {
  const root = loop(3);
  goal(root, '\nCheck: npm test\n');
  merge(root, 1, 'npm test'); merge(root, 2, 'echo ok'); merge(root, 3);
  for (const text of [jarl(root, 'status'), jarl(root, 'report')]) {
    assert.match(text, /1 of 3 merges carry the declared check/);
    assert.doesNotMatch(text, /no merge carries/);
  }
  const repo = Object.values(json(root, 'status').check.byRepo)[0];
  assert.deepEqual([repo.k, repo.n, repo.declared], [1, 3, ['npm test']]);
  assert.equal(json(root, 'status').check.landsOn, 'partial');
  assert.deepEqual(Object.values(json(root, 'report').check.byRepo)[0], repo);
});

test('the text of a --ran row is compared after trimming whitespace', () => {
  const root = loop(2);
  goal(root, '\nCheck:   npm test  \n');
  merge(root, 1, '  npm test ');
  merge(root, 2, 'npm test --watch');
  const repo = Object.values(json(root, 'status').check.byRepo)[0];
  assert.deepEqual([repo.k, repo.n], [1, 2]);
});

test('every merge carrying the declared check lands the loop on its check', () => {
  const root = loop(2);
  goal(root, '\nCheck: npm test\n');
  merge(root, 1, 'npm test'); merge(root, 2, 'npm test');
  assert.equal(json(root, 'status').check.landsOn, 'check');
  assert.doesNotMatch(jarl(root, 'status'), /testimony/);
  assert.match(jarl(root, 'report'), /2 of 2 merges carry the declared check/);
});

test('the counts are per repository, and a row matching the other repository\'s check does not count', () => {
  const parent = mkdtempSync(join(tmpdir(), 'jarl-banner-two-'));
  for (const name of ['app', 'lib']) { mkdirSync(join(parent, name)); spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: join(parent, name), timeout: SPAWN_TIMEOUT }); }
  const root = join(parent, 'app');
  jarl(root, 'init', 'two repositories');
  for (let k = 1; k <= 4; k += 1) jarl(root, 'new', `issue ${k}`, '--acceptance', 'it works');
  for (const id of [3, 4]) jarl(root, 'repo', String(id), '../lib');
  goal(root, '\nCheck (app): yg check\nCheck (lib): npm test\n');
  merge(root, 1, 'yg check');
  merge(root, 2, 'npm test');
  merge(root, 3, 'yg check');
  merge(root, 4, 'npm test');
  const by = json(root, 'status').check.byRepo;
  assert.deepEqual([by.app.k, by.app.n, by.app.declared], [1, 2, ['yg check']]);
  assert.deepEqual([by.lib.k, by.lib.n, by.lib.declared], [1, 2, ['npm test']]);
  for (const text of [jarl(root, 'status'), jarl(root, 'report')]) {
    assert.match(text, /app: 1 of 2 merges carry the declared check/);
    assert.match(text, /lib: 1 of 2 merges carry the declared check/);
  }
});

test('status --json and report --json carry {repo, k, n, declared} for each repository', () => {
  const root = loop(1);
  goal(root, '\nCheck: npm test\n');
  merge(root, 1, 'npm test');
  for (const view of ['status', 'report']) {
    const [name, repo] = Object.entries(json(root, view).check.byRepo)[0];
    assert.deepEqual({ repo: repo.repo, k: repo.k, n: repo.n, declared: repo.declared }, { repo: name, k: 1, n: 1, declared: ['npm test'] });
  }
});

test('the help of status and report says when the testimony mark shows and what the count is', () => {
  const root = loop(0);
  const help = jarl(root, 'status', '--help');
  assert.match(help, /carry the declared check/);
  assert.doesNotMatch(help, /goal\.md has no "Check: <command>" line/);
});
