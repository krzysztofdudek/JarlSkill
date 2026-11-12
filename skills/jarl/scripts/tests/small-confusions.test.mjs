// Three calls that let a caller think something happened that did not: a round's count of findings named like the findings
// themselves, a --worktree that was never looked at said to be checked, and an owner's ruling that prints a note when
// nothing is wrong with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { jarl, refuses, run, loop as makeLoop, SPAWN_TIMEOUT } from './helpers.mjs';

const mcp = await import('../jarl-mcp.mjs');

test('round takes its count of findings as --finding-count, and --findings still works and says which name to use', () => {
  const root = makeLoop({ prefix: 'jarl-round-count-', via: 'cli', dotGit: false });
  jarl(root, 'new', 'work', '--acceptance', '[read] it works', '--tier', 'light');
  jarl(root, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/1-work', '--worker', 'w1', '--model', 'm1');
  const old = run(root, ['round', '1', 'the count is off by one', '--findings', '2']);
  assert.equal(old.status, 0, old.stderr);
  assert.match(old.stderr, /note: --findings is the name round takes its count of findings under; --finding-count is the name to use/);
  assert.match(refuses(root, 'round', '1', 'red', '--finding-count', 'many'), /--finding-count must be a whole number/);
  assert.match(refuses(root, 'round', '1', 'red', '--findings', 'many'), /--finding-count must be a whole number/);
  assert.match(refuses(root, 'round', '1', 'red', '--findings', '2', '--finding-count', '3'), /--findings and --finding-count are one count/);
  const named = run(root, ['round', '1', 'and again', '--finding-count', '3']);
  assert.equal(named.status, 0);
  assert.equal(named.stderr, '');
  const log = readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
  assert.match(log, /1 round 1 \(count 1 of 3\) · findings 2 · the count is off by one/);
  assert.match(log, /1 round 2 \(count 2 of 3\) · findings 3 · and again/);
});

test('the round tool takes findings under its other name, records the same count and gives the notice', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-round-tool-'));
  mkdirSync(join(root, '.git'));
  mcp.callTool('jarl_init', { by: 'test-writer', goal: 'g', root });
  mcp.callTool('jarl_new', { by: 'test-writer', title: 'one', acceptance: ['[read] it works'], tier: 'light', root });
  mcp.callTool('jarl_set', { by: 'test-writer', ids: '1', status: 'in-progress', text: 'go', branch: 'jarl/1-one', worker: 'w1', model: 'm1', root });
  const viaAlias = mcp.callTool('jarl_round', { by: 'test-writer', id: '1', text: 'red one', findings: '4', root });
  assert.match(JSON.stringify(viaAlias), /--finding-count is the name to use/);
  mcp.callTool('jarl_round', { by: 'test-writer', id: '1', text: 'red two', 'finding-count': '5', root });
  const log = readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
  assert.match(log, /findings 4 · red one/);
  assert.match(log, /findings 5 · red two/);
});

test('a --worktree that is not on this machine yet says it was not checked, and one that is says it was', () => {
  const parent = realpathSync.native(mkdtempSync(join(tmpdir(), 'jarl-wt-note-')));
  const hub = join(parent, 'hub');
  mkdirSync(hub);
  const git = (cwd, ...args) => {
    const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', timeout: SPAWN_TIMEOUT });
    assert.equal(r.status, 0, r.stderr);
  };
  git(hub, 'init', '-q', '-b', 'main');
  writeFileSync(join(hub, 'a.txt'), 'a\n');
  git(hub, 'add', '-A');
  git(hub, 'commit', '-qm', 'base');
  jarl(hub, 'init', 'goal');
  jarl(hub, 'new', 'one', '--acceptance', '[read] it works', '--tier', 'light');
  const away = join(parent, 'not-yet');
  const r = run(hub, ['set', '1', 'in-progress', 'go', '--branch', 'jarl/1-one', '--worker', 'w1', '--worktree', away]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /note: 1 --worktree was not checked, because that path is not on this machine, and is not recorded/);
  assert.doesNotMatch(r.stderr, /was checked/);
  const there = join(parent, 'there');
  git(hub, 'worktree', 'add', '-q', '-b', 'jarl/2-two', there);
  jarl(hub, 'new', 'two', '--acceptance', '[read] it works', '--tier', 'light');
  const ok = run(hub, ['set', '2', 'in-progress', 'go', '--branch', 'jarl/2-two', '--worker', 'w2', '--worktree', there]);
  assert.match(ok.stderr, /note: 2 --worktree was checked and is not recorded/);
});

test('a ruling by the owner with his words and no question behind it is recorded without a note', () => {
  const root = makeLoop({ prefix: 'jarl-owner-quiet-', via: 'cli', dotGit: false });
  const r = run(root, ['decide', 'the-choice', 'The default stays.', '--by', 'owner', '--quote', 'Leave the default.']);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.match(jarl(root, 'decisions'), /the-choice · by owner — The default stays\. · the owner's words: "Leave the default\."/);
});
