// A rule's repo selector names a repository by its declared name or by a path to it, and both reach the issues that name
// that repository in either spelling. A selector no repository of the loop answers to is refused, since a rule that reaches
// nobody looks like one in force.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { jarl, refuses, SPAWN_TIMEOUT } from './helpers.mjs';
import { parseScope, readLoop, ruleMatches } from '../jarl-lib.mjs';

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', timeout: SPAWN_TIMEOUT });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
};
function repoAt(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.txt'), `${dir}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}
// A loop in `hub`, a repository `tool` beside it (declared by name when an issue names it), and a repository `inner`
// inside it (stored as a path).
function world() {
  const parent = realpathSync.native(mkdtempSync(join(tmpdir(), 'jarl-repo-selector-')));
  const hub = repoAt(join(parent, 'hub'));
  repoAt(join(parent, 'tool'));
  repoAt(join(hub, 'inner'));
  jarl(hub, 'init', 'goal');
  jarl(hub, 'new', 'by name', '--acceptance', '[read] it works', '--tier', 'light', '--repo', '../tool');
  jarl(hub, 'new', 'by path', '--acceptance', '[read] it works', '--tier', 'light', '--repo', './inner');
  return hub;
}
const reaches = (hub, scope, id) => {
  const read = readLoop(join(hub, '.jarl'));
  const reader = { roles: new Set(['worker']), slice: null, moments: new Set(['start']), issues: [read.byId.get(id)] };
  return ruleMatches(hub, { selectors: parseScope(scope) }, reader);
};

test('a repo selector spelled as the name or as a path to the repository reaches the issue that names it in either spelling', () => {
  const hub = world();
  for (const spelling of ['tool', '../tool', '../tool/']) assert.ok(reaches(hub, `role worker and repo ${spelling}`, '1'), `${spelling} reaches the issue that names the repository`);
  for (const spelling of ['inner', './inner', './inner/']) assert.ok(reaches(hub, `role worker and repo ${spelling}`, '2'), `${spelling} reaches the issue that holds the path`);
  assert.ok(!reaches(hub, 'role worker and repo tool', '2'));
  assert.ok(!reaches(hub, 'role worker and repo ./inner', '1'));
});

test('decide refuses a repo selector no repository of the loop has, and takes the name and the path of one it has', () => {
  const hub = world();
  const said = refuses(hub, 'decide', 'r0', 'Run the linter.', '--applies-to', 'role worker and repo ./nothing', '--by', 'coordinator');
  assert.match(said, /repo \.\/nothing is not a repository of this loop: tool, inner/);
  assert.match(said, /--applies-to "role worker and repo <name-or-path>"/);
  assert.match(refuses(hub, 'decide', 'r0', 'Run the linter.', '--applies-to', 'repo missing', '--by', 'coordinator'), /repo missing is not a repository of this loop/);
  assert.match(refuses(hub, 'ask', 'Run the linter.', '--kind', 'rule', '--applies-to', 'repo missing', '--by', 'w1'), /repo missing is not a repository of this loop/);
  assert.equal(jarl(hub, 'decisions', '--json'), '[]', 'nothing was written');
  for (const [n, spelling] of ['tool', '../tool', 'inner', './inner'].entries()) {
    assert.match(jarl(hub, 'decide', `r${n + 1}`, 'Run the linter.', '--applies-to', `role worker and repo ${spelling}`, '--by', 'coordinator'), /decided/);
  }
});
