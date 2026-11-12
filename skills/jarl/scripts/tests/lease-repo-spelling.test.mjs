// Two issues leased together on one branch are one lease whichever way their Repo fields spell the repository: as the name
// the loop declares or as a path to it. The tool wrote both leases in one call, so it must brief them as one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { jarl, refuses, SPAWN_TIMEOUT } from './helpers.mjs';
import { readLoop } from '../jarl-lib.mjs';
import { sameLease } from '../lib/leases.mjs';

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
}
// A loop in `hub` and a repository `tool` beside it, which three issues name: by its name, by a path, and by a path again.
// A Repo field is written in the spelling a person gave it, so the second and third are rewritten in the file.
function world() {
  const parent = realpathSync.native(mkdtempSync(join(tmpdir(), 'jarl-lease-spelling-')));
  const hub = join(parent, 'hub');
  repoAt(hub);
  repoAt(join(parent, 'tool'));
  repoAt(join(parent, 'other'));
  jarl(hub, 'init', 'goal');
  for (const title of ['by name', 'by path', 'by other path']) jarl(hub, 'new', title, '--acceptance', '[read] it works', '--tier', 'light', '--repo', '../tool');
  const dir = join(hub, '.jarl', 'issues');
  const spell = (id, value) => {
    const file = join(dir, readdirSync(dir).find((f) => f.startsWith(`${id}-`)));
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^\*\*Repo:\*\* .*$/m, `**Repo:** ${value}`));
  };
  spell(2, '../tool');
  spell(3, '../hub/../tool/');
  return { hub, spell };
}

test('two issues leased in one call whose Repo fields spell one repository as a name and as a path are one lease', () => {
  const { hub } = world();
  jarl(hub, 'set', '1,2', 'in-progress', 'go', '--branch', 'jarl/x', '--worker', 'w', '--model', 'm', '--by', 'jarl');
  const brief = jarl(hub, 'brief', '1,2');
  assert.match(brief, /^The worker's brief for issues 1, 2/);
  assert.match(jarl(hub, 'brief', '1'), /^The worker's brief for issues 1, 2/, 'the mate in the other spelling is added to the brief of one');
  const read = readLoop(join(hub, '.jarl'));
  const [a, b] = ['1', '2'].map((id) => read.byId.get(id));
  assert.ok(sameLease(hub, read.profile, a, b));
});

test('a lease is one lease in every spelling of its repository, and two repositories stay two leases', () => {
  const { hub, spell } = world();
  jarl(hub, 'set', '1,2,3', 'in-progress', 'go', '--branch', 'jarl/x', '--worker', 'w', '--model', 'm', '--by', 'jarl');
  jarl(hub, 'brief', '1,3');
  spell(3, '../other');
  const said = refuses(hub, 'brief', '1,3');
  assert.match(said, /1, 3 are not one lease/);
});
