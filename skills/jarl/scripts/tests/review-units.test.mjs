// The proofs of code with no verdict on one holder's list are cut into units one fresh reviewer may take, under Jarl's own
// rule for a shared review: one contract or one screen, at most four. The record's mark of one contract is one branch,
// leased as one package and read as one diff; a package of more than four is cut into units as even as they come, and
// every other issue is a unit of its own. Each grouped unit names what it shares, and a coordinator's list holds the units
// of its slice alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SPAWN_TIMEOUT, jarl, loop as makeLoop } from './helpers.mjs';
import { BUILTIN_STATUSES } from '../jarl-lib.mjs';

const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const RULE = 'One shared review covers only issues that are one contract or one screen, at most four.';

// Eight changes: the first six on one branch (a package), the last two each on a branch of its own, every one with a proof
// row and no verdict; with `slice`, the package is in odin's slice and the other two in none.
function inReview({ slice = false } = {}) {
  const root = makeLoop({ prefix: 'jarl-units-', via: 'cli', dotGit: false });
  if (slice) jarl(root, 'goal', '--set', 'Coordinators: odin');
  for (let k = 1; k <= 8; k += 1) jarl(root, 'new', `change ${k}`, '--files', `f${k}.mjs`, '--acceptance', 'it works', ...(slice && k <= 6 ? ['--tags', 'slice:odin'] : []));
  jarl(root, 'set', '1-6', 'in-progress', 'one package', '--worker', 'wa', '--branch', 'jarl/a');
  jarl(root, 'set', '7', 'in-progress', 'go', '--worker', 'wb', '--branch', 'jarl/b');
  jarl(root, 'set', '8', 'in-progress', 'go', '--worker', 'wc', '--branch', 'jarl/c');
  for (let k = 1; k <= 8; k += 1) jarl(root, 'evidence', String(k), '--ran', 'npm test', '--saw', 'pass 3, fail 0');
  return root;
}
const reviewRow = (o) => o.rows.find((r) => r.what === 'review' && r.ids);

test('the proofs waiting for a verdict are cut into units one reviewer may take: a branch of at most four, each grouped unit naming its branch, every other issue alone', () => {
  const root = inReview();
  const row = reviewRow(json(root, 'next', '--as', 'jarl', '--all'));
  assert.deepEqual(row.ids, ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.deepEqual(row.units, [
    { ids: ['1', '2', '3'], shares: 'branch', on: 'jarl/a' },
    { ids: ['4', '5', '6'], shares: 'branch', on: 'jarl/a' },
    { ids: ['7'] },
    { ids: ['8'] },
  ], 'a package of six is two units of three, never one of six or one of four and one of two');
  assert.equal(row.says, 'proof recorded, no verdict; raise one fresh reviewer per unit: 1, 2, 3 (one branch, jarl/a) · 4, 5, 6 (one branch, jarl/a) · 7 · 8; if you cannot raise agents, ask the owner to start a fresh session');
  assert.equal(row.command, "jarl.mjs review \"<ids>\" \"<verdict>\" --by \"<reviewer>\" \"<text>\", or jarl.mjs ask 'start a fresh session to review issues 1, 2, 3, 4, 5, 6, 7, 8'");
  assert.match(jarl(root, 'next', '--as', 'jarl'), /^- 1, 2, 3, 4, 5, 6, 7, 8: proof recorded, no verdict; raise one fresh reviewer per unit: 1, 2, 3 \(one branch, jarl\/a\) · 4, 5, 6 \(one branch, jarl\/a\) · 7 · 8;/m);
  assert.match(jarl(root, 'next', '--as', 'jarl'), new RegExp(`jarl:coordinator-shared-review · role coordinator and moment review · references/jarl\\.md — ${RULE.replace(/\./g, '\\.')}`), 'the rule the units follow comes with the list');
});

test('a package of four or fewer is one unit, and a reviewer\'s verdict on the unit is one batch', () => {
  const root = inReview();
  jarl(root, 'review', '1-4', 'approve', '--by', 'rev-a', 'read the diff of jarl/a, nothing found');
  const batches = readFileSync(join(root, '.jarl', 'log.md'), 'utf8').split('\n').filter((l) => / review approve · /.test(l)).map((l) => / · batch (\S+) · /.exec(l)[1]);
  assert.equal(batches.length, 4);
  assert.equal(new Set(batches).size, 1, 'the four lines of the verdict carry one batch id');
  const row = reviewRow(json(root, 'next', '--as', 'jarl', '--all'));
  assert.deepEqual(row.units, [{ ids: ['5', '6'], shares: 'branch', on: 'jarl/a' }, { ids: ['7'] }, { ids: ['8'] }]);
});

test('a coordinator\'s list holds the units of its slice alone', () => {
  const root = inReview({ slice: true });
  assert.deepEqual(reviewRow(json(root, 'next', '--as', 'odin', '--all')).units, [
    { ids: ['1', '2', '3'], shares: 'branch', on: 'jarl/a' },
    { ids: ['4', '5', '6'], shares: 'branch', on: 'jarl/a' },
  ]);
  assert.deepEqual(reviewRow(json(root, 'next', '--as', 'jarl', '--all')).units, [{ ids: ['7'] }, { ids: ['8'] }]);
  assert.match(jarl(root, 'next', '--as', 'jarl'), /^- 7, 8: proof recorded, no verdict; raise one fresh reviewer per unit: 7 · 8;/m);
});

test('the code a coordinator alone approved, and the issues no approve clears under the loop\'s definition, are cut into the units of the proofs waiting for a verdict', () => {
  const root = inReview();
  jarl(root, 'review', '1-3', 'approve', '--by', 'jarl', 'read the diff of jarl/a, nothing found');
  jarl(root, 'review', '7', 'approve', '--by', 'jarl', 'read the diff of jarl/b, nothing found');
  const rows = json(root, 'next', '--as', 'jarl', '--all').rows.filter((r) => r.what === 'review');
  const coordinatorOnly = rows.find((r) => r.ids && r.ids.includes('1'));
  assert.deepEqual(coordinatorOnly.ids, ['1', '2', '3', '7']);
  assert.deepEqual(coordinatorOnly.units, [{ ids: ['1', '2', '3'], shares: 'branch', on: 'jarl/a' }, { ids: ['7'] }]);
  assert.equal(coordinatorOnly.says, 'approved by a coordinator only, and they carry code; raise one fresh reviewer per unit: 1, 2, 3 (one branch, jarl/a) · 7');
  assert.equal(coordinatorOnly.command, 'jarl.mjs review "<ids>" "<verdict>" --by "<reviewer>" "<text>"');
  assert.deepEqual(rows.find((r) => r.ids && r.ids.includes('4')).ids, ['4', '5', '6', '8'], 'the proofs with no verdict keep their own row');

  const profile = join(mkdtempSync(join(tmpdir(), 'jarl-units-profile-')), 'profile.json');
  writeFileSync(profile, JSON.stringify({ 'jarl-profile': 1, statuses: BUILTIN_STATUSES, initial: 'open', 'done-gate': { clears: [['fresh', 'bot:coderabbit']] } }));
  const defined = makeLoop({ prefix: 'jarl-units-clears-', via: 'cli', dotGit: false, initFlags: ['--profile', profile] });
  for (let k = 1; k <= 3; k += 1) jarl(defined, 'new', `change ${k}`, '--files', `f${k}.mjs`, '--acceptance', 'it works');
  jarl(defined, 'set', '1-2', 'in-progress', 'one package', '--worker', 'wa', '--branch', 'jarl/a');
  jarl(defined, 'set', '3', 'in-progress', 'go', '--worker', 'wb', '--branch', 'jarl/b');
  for (let k = 1; k <= 3; k += 1) jarl(defined, 'evidence', String(k), '--ran', 'npm test', '--saw', 'pass 3, fail 0');
  jarl(defined, 'review', '1-3', 'approve', '--by', 'rev-a', 'read the diffs, nothing found');
  const notCleared = json(defined, 'next', '--as', 'jarl', '--all').rows.find((r) => r.what === 'review' && r.ids);
  assert.deepEqual(notCleared.units, [{ ids: ['1', '2'], shares: 'branch', on: 'jarl/a' }, { ids: ['3'] }]);
  assert.equal(notCleared.says, 'approved, and no approve they hold clears them under the loop\'s done gate; raise one reviewer whose approve does per unit: 1, 2 (one branch, jarl/a) · 3');
});

test('one branch name in two repositories is two units, each naming its repository', () => {
  const parent = mkdtempSync(join(tmpdir(), 'jarl-units-repos-'));
  for (const name of ['hub', 'tool']) {
    mkdirSync(join(parent, name));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: join(parent, name), stdio: 'ignore', timeout: SPAWN_TIMEOUT });
  }
  const root = join(parent, 'hub');
  jarl(root, 'init', 'goal');
  for (let k = 1; k <= 4; k += 1) jarl(root, 'new', `change ${k}`, '--files', `f${k}.mjs`, '--acceptance', 'it works', ...(k > 2 ? ['--repo', '../tool'] : []));
  jarl(root, 'set', '1-2', 'in-progress', 'one package', '--worker', 'wa', '--branch', 'jarl/x');
  jarl(root, 'set', '3-4', 'in-progress', 'one package', '--worker', 'wb', '--branch', 'jarl/x');
  for (let k = 1; k <= 4; k += 1) jarl(root, 'evidence', String(k), '--ran', 'npm test', '--saw', 'pass 3, fail 0');
  const row = reviewRow(json(root, 'next', '--as', 'jarl', '--all'));
  assert.deepEqual(row.units, [
    { ids: ['1', '2'], shares: 'branch', on: 'jarl/x', in: 'hub' },
    { ids: ['3', '4'], shares: 'branch', on: 'jarl/x', in: 'tool' },
  ]);
  assert.match(row.says, /raise one fresh reviewer per unit: 1, 2 \(one branch, jarl\/x in hub\) · 3, 4 \(one branch, jarl\/x in tool\);/);
});

test('one proof waiting alone keeps its line, with its own review command', () => {
  const root = makeLoop({ prefix: 'jarl-units-one-', via: 'cli', dotGit: false });
  jarl(root, 'new', 'only change', '--files', 'a.mjs');
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'me', '--branch', 'jarl/1');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'green');
  const row = reviewRow(json(root, 'next', '--as', 'jarl'));
  assert.deepEqual(row.units, [{ ids: ['1'] }]);
  assert.match(row.says, /^proof recorded, no verdict; raise a fresh reviewer for 1;/);
  assert.match(row.command, /^jarl\.mjs review 1 "<verdict>" --by "<reviewer>" "<text>", or /);
});
