// The shared skill fragments in SKILL.md (between the RUNES markers) and the vendoring tool are pinned in
// vendor/runes.pin.json and checked by that tool, offline; Jarl vendors no Runes code. The CI job adds the fresh-clone half.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = fileURLToPath(new URL('../../', import.meta.url));
const check = (skillDir) =>
  spawnSync(process.execPath, [join(skillDir, 'scripts', 'runes.mjs'), 'check', '--offline', '--pin', join(skillDir, 'scripts', 'vendor', 'runes.pin.json')], { encoding: 'utf8' });

const tmps = [];
after(() => { for (const d of tmps) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

// A throwaway repository holding the skill directory as it is here: the tool's own copy, the pin and SKILL.md.
function copyOfSkill() {
  const repo = mkdtempSync(join(tmpdir(), 'jarl-runes-'));
  tmps.push(repo);
  mkdirSync(join(repo, '.git'));
  const dir = join(repo, 'skills', 'jarl');
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  cpSync(join(SKILL, 'SKILL.md'), join(dir, 'SKILL.md'));
  cpSync(join(SKILL, 'scripts', 'runes.mjs'), join(dir, 'scripts', 'runes.mjs'));
  cpSync(join(SKILL, 'scripts', 'vendor'), join(dir, 'scripts', 'vendor'), { recursive: true });
  return dir;
}

test('the tool and every skill fragment match the pin, and no Runes file is vendored', () => {
  const r = check(SKILL);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /0 vendored files, 3 skill fragments and the tool match/);
});

test('SKILL.md carries each pinned fragment between its markers, once', () => {
  const pin = JSON.parse(readFileSync(join(SKILL, 'scripts', 'vendor', 'runes.pin.json'), 'utf8'));
  const text = readFileSync(join(SKILL, 'SKILL.md'), 'utf8');
  assert.deepEqual(pin.fragments.map((f) => f.name).sort(), ['evidence', 'mcp-first', 'worker-worktree']);
  for (const { name } of pin.fragments) {
    for (const edge of ['START', 'END']) assert.equal(text.split(`<!-- RUNES:${name}:${edge} -->`).length, 2, `${name} ${edge} marker`);
  }
});

test('a hand edit inside a fragment block turns the gate red and names the fragment', () => {
  const dir = copyOfSkill();
  const path = join(dir, 'SKILL.md');
  const text = readFileSync(path, 'utf8');
  const edited = text.replace('**Evidence is what ran and what it printed.**', '**Evidence is what ran.**');
  assert.notEqual(edited, text);
  writeFileSync(path, edited);
  const r = check(dir);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /fragment evidence in \.\.\/\.\.\/SKILL\.md: the block between the markers differs/);
});

test('an edit outside the blocks leaves the gate green; a lost marker turns it red', () => {
  const dir = copyOfSkill();
  const path = join(dir, 'SKILL.md');
  const text = readFileSync(path, 'utf8');
  writeFileSync(path, text.replace('In Jarl the coordinator is the jarl', 'In Jarl, the coordinator is the jarl'));
  assert.equal(check(dir).status, 0);
  writeFileSync(path, text.replace('<!-- RUNES:mcp-first:END -->\n', ''));
  const r = check(dir);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /fragment mcp-first/);
});
