// models reads other loops (issue 290): --with <root> (a root, or an archive directory), --archives (the loop's own
// archives). The tables merge: counts add up, a share appears only from n >= 5 over the sum, and a path that is not a
// loop is refused with nothing written and no lock taken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as R from '../record.mjs';
import { loop as makeLoop } from './helpers.mjs';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const L = await import('../jarl-lib.mjs');
const MID = 'mid-model';

const loop = () => makeLoop({ prefix: 'jarl-models-loops-', goal: 'a goal' });
let seq = 0;
function units(root, n, { model, changed = 0 } = {}) {
  for (let k = 0; k < n; k += 1) {
    seq += 1;
    const { id } = R.newIssue(root, `unit ${seq}`, { kind: 'bug', tier: 'standard', acceptance: 'it works' });
    R.setStatus(root, id, 'in-progress', '', { branch: `jarl/${id}-x`, worker: 'w-x', ...(model ? { model } : {}) });
    R.addEvidence(root, id, undefined, { ran: 'npm test', saw: 'pass' });
    if (k < changed) R.review(root, id, 'changes', 'Important: the case is not handled', { by: 'rev-a' });
    R.review(root, id, 'approve', 'read the diff, nothing found', { by: 'rev-a' });
    R.setStatus(root, id, 'done', 'merged', {});
  }
}
const cell = (m, model, key) => m.workers.find((r) => r.model === model).cells.find((c) => c.key === key);
const snapshot = (root) => [readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), readdirSync(join(root, '.jarl', 'issues')).join()];

test('--with merges two loops with the same model: counts add up and a share appears only from n >= 5 over the sum', () => {
  const a = loop();
  const b = loop();
  units(a, 3, { model: MID, changed: 1 });
  units(b, 3, { model: MID });
  const alone = L.cmdModels(a, {});
  assert.equal(cell(alone, MID, 'bug · standard').units, 3);
  assert.equal(cell(alone, MID, 'bug · standard').share, null, 'n = 3 alone: no share');
  const both = L.cmdModels(a, { with: [b] });
  const c = cell(both, MID, 'bug · standard');
  assert.equal(c.units, 6);
  assert.equal(c.clean, 5);
  assert.equal(c.share, 0.833, 'n = 6 over the sum: a share');
  assert.equal(both.loops.length, 2);
  assert.deepEqual(both.loops.map((l) => l.label), ['this loop', b]);
  assert.match(L.renderModels(both), /Models · this loop \(\d+ issues, 3 units/);
});

test('--with takes one value or several, and the same loop twice is read once', () => {
  const a = loop();
  const b = loop();
  units(b, 2, { model: MID });
  assert.equal(L.cmdModels(a, { with: b }).loops.length, 2);
  assert.equal(L.cmdModels(a, { with: [b, b] }).loops.length, 2);
});

test('a root and its own .jarl/ passed together are one loop, and each model row says how many loops it comes from', () => {
  const a = loop();
  const b = loop();
  units(a, 3, { model: MID });
  units(b, 3, { model: MID });
  const m = L.cmdModels(a, { with: [a, join(a, '.jarl'), b, join(b, '.jarl')] });
  assert.equal(m.loops.length, 2);
  assert.equal(m.workers.find((r) => r.model === MID).loops, 2);
  assert.equal(m.reviewers.find((r) => r.model === null).loops, 2);
  assert.match(L.renderModels(m), /\nmid-model \(?[^\n]*from 2 loops/);
  assert.equal(L.cmdModels(a, {}).workers[0].loops, 1);
});

test('--archives reads the loop\'s own archives, and an archive directory can be named with --with', () => {
  const root = loop();
  units(root, 3, { model: MID });
  L.cmdArchive(root, 'first');
  R.initLoop(root, 'second goal');
  units(root, 3, { model: MID, changed: 2 });
  const now = L.cmdModels(root, {});
  assert.equal(cell(now, MID, 'bug · standard').units, 3);
  const all = L.cmdModels(root, { archives: true });
  assert.equal(cell(all, MID, 'bug · standard').units, 6);
  assert.equal(cell(all, MID, 'bug · standard').clean, 4);
  assert.match(all.loops[1].label, /^archive \d{4}\.\d{2}\.\d{2}-first$/);
  const dir = join(root, '.jarl', 'archive', readdirSync(join(root, '.jarl', 'archive'))[0]);
  const only = L.cmdModels(root, { with: dir });
  assert.equal(only.loops.length, 2);
  assert.equal(cell(only, MID, 'bug · standard').units, 6);
  // after the read the archive is an ordinary directory again: nothing registered remains
  assert.equal(L.jarlDir(dir), join(dir, '.jarl'));
});

test('a loop with no live record can still be read through its archives', () => {
  const root = loop();
  units(root, 5, { model: MID });
  L.cmdArchive(root, 'only');
  const m = L.cmdModels(root, { archives: true });
  assert.equal(m.loops.length, 1);
  assert.equal(cell(m, MID, 'bug · standard').share, 1);
  assert.throws(() => L.cmdModels(root, {}), /no loop here|no loop to read/);
});

test('a loop without recorded models reads as (not recorded) by tier next to one that has them', () => {
  const a = loop();
  const b = loop();
  units(a, 2, {});
  units(b, 4, { model: MID });
  const m = L.cmdModels(a, { with: b });
  assert.equal(m.workers.find((r) => r.model === null).cells[0].units, 2);
  assert.equal(cell(m, MID, 'bug · standard').units, 4);
});

test('a root that is not a loop is refused with a message, and nothing is written or locked', () => {
  const a = loop();
  units(a, 1, { model: MID });
  const empty = mkdtempSync(join(tmpdir(), 'jarl-models-loops-'));
  const before = snapshot(a);
  assert.throws(() => L.cmdModels(a, { with: empty }), /is not a loop/);
  assert.throws(() => L.cmdModels(a, { with: join(a, 'nowhere') }), /is not a loop/);
  const r = spawnSync(process.execPath, [SCRIPT, 'models', '--with', empty, '--root', a], { encoding: 'utf8', timeout: 60_000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /is not a loop/);
  assert.deepEqual(snapshot(a), before);
  assert.equal(existsSync(join(a, '.jarl', '.lock')), false);
  assert.equal(existsSync(join(empty, '.jarl')), false, 'the named path is not touched');
});

test('the command line takes --with (repeatable) and --archives, reads, and writes nothing', () => {
  const a = loop();
  const b = loop();
  units(a, 3, { model: MID });
  units(b, 3, { model: MID });
  const before = [snapshot(a), snapshot(b)];
  const r = spawnSync(process.execPath, [SCRIPT, 'models', '--with', b, '--archives', '--json', '--root', a], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).loops.length, 2);
  assert.deepEqual([snapshot(a), snapshot(b)], before);
});
