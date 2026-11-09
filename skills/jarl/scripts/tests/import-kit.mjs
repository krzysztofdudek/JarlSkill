// What the tests of import's all-or-nothing filing share: findings files, the snapshot of a loop's record that a refused call
// must leave as it was, and a loop that stays at its record format.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { BUILTIN_STATUSES } from '../jarl-lib.mjs';
import { SPAWN_TIMEOUT, jarl, loop as makeLoop, refuses } from './helpers.mjs';

export const loop = () => makeLoop({ prefix: 'jarl-import-atomic-', via: 'cli', dotGit: false });
export const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
export const SOURCE = 'ext/2026-11-06-atomic';
export function findingsFile(list) {
  const file = join(mkdtempSync(join(tmpdir(), 'jarl-atomic-')), 'findings.json');
  writeFileSync(file, JSON.stringify(list));
  return file;
}
// A finding whose text the filing refuses: a pair of field tags in angle brackets inside a text.
export const BAD = { id: 'finding-bad', title: 'Cannot be filed', claim: 'It holds <why>a field tag pair</why> inside the text.' };
// A finding the filing takes; its id reads as one that is unique on its own, so an issue naming it is adopted.
export const good = (n) => ({ id: `finding-${n}`, title: `Finding ${n}`, claim: `Claim number ${n}.` });
// Every file of the record, by path: what a refused call must leave as it was.
export function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path); else out[relative(root, path)] = readFileSync(path, 'utf8');
    }
  };
  walk(join(root, '.jarl'));
  return out;
}
export const imports = (root, file, ...more) => jarl(root, 'import', file, '--source', SOURCE, ...more);
// The refusal of an import, read after the loop is shown to be as it was.
export const refusedImport = (root, file, ...more) => {
  const before = snapshot(root);
  const said = refuses(root, 'import', file, '--source', SOURCE, ...more);
  assert.deepEqual(snapshot(root), before, 'the refused import left the loop as it found it');
  return said;
};

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', timeout: SPAWN_TIMEOUT });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
};
// A loop opened with a profile, in a repository with a repository
// beside it that an issue may name. The first issue names finding-1.
export function composed() {
  const parent = realpathSync.native(mkdtempSync(join(tmpdir(), 'jarl-atomic-composed-')));
  for (const name of ['hub', 'tool']) {
    mkdirSync(join(parent, name));
    git(join(parent, name), 'init', '-q', '-b', 'main');
    writeFileSync(join(parent, name, 'a.txt'), 'a\n');
    git(join(parent, name), 'add', '-A');
    git(join(parent, name), 'commit', '-qm', 'base');
  }
  const hub = join(parent, 'hub');
  const profile = join(mkdtempSync(join(tmpdir(), 'jarl-atomic-profile-')), 'profile.json');
  writeFileSync(profile, JSON.stringify({ 'jarl-profile': 1, name: 'composed', statuses: BUILTIN_STATUSES }));
  jarl(hub, 'init', 'a composed goal', '--profile', profile);
  jarl(hub, 'new', 'an issue that names finding-1', '--acceptance', '[read] it works', '--what', 'it covers finding-1 of the report');
  return hub;
}
