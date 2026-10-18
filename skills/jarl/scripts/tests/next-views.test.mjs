// The views of next, status and resume that say what comes next: the ready set and its groups (issue 249), the
// derived facts on in-flight rows (283), status --tag (281) and exclusive resources (282).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));

function run(root, args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}
function jarl(root, ...args) {
  const r = run(root, args);
  if (r.status !== 0) throw new Error(`jarl ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}
function refuses(root, ...args) {
  const r = run(root, args);
  assert.notEqual(r.status, 0, `expected a refusal: ${args.join(' ')}`);
  return r.stderr;
}
function loop() {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-views-'));
  jarl(dir, 'init', 'goal');
  return dir;
}

// ---- 249: next lists the ready set, groups behind --all -----------------------------------------------

function groupedLoop() {
  const root = loop();
  jarl(root, 'new', 'running', '--files', 'a.mjs');          // 001, in progress, holds a.mjs
  jarl(root, 'new', 'blocked by file', '--files', 'a.mjs');  // 002
  jarl(root, 'new', 'ready one', '--files', 'b.mjs');        // 003
  jarl(root, 'new', 'after the running one', '--files', 'c.mjs', '--after', '1'); // 004
  jarl(root, 'new', 'asked about', '--files', 'd.mjs');      // 005
  jarl(root, 'new', 'no files at all');                      // 006
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1');
  jarl(root, 'ask', 'which way?', '--kind', 'stuck', '--issue', '5');
  return root;
}

test('next lists only the issues ready to start; --all adds the groups with headers and who holds what', () => {
  const root = groupedLoop();
  const plain = JSON.parse(jarl(root, 'next', '--json'));
  assert.deepEqual(plain.map((r) => r.id), ['003', '006'], 'only the ready ones');
  assert.ok(plain.every((r) => r.group === 'ready'));
  const all = JSON.parse(jarl(root, 'next', '--all', '--json'));
  const by = (g) => all.filter((r) => r.group === g).map((r) => r.id);
  assert.deepEqual(by('ready'), ['003', '006']);
  assert.deepEqual(by('held-by-file'), ['002']);
  assert.deepEqual(by('waiting-after'), ['004']);
  assert.deepEqual(by('held-by-question'), ['005']);
  assert.deepEqual(all.find((r) => r.id === '002').heldBy, ['001']);
  assert.deepEqual(all.find((r) => r.id === '004').after, ['001']);
  assert.deepEqual(all.find((r) => r.id === '005').questions, ['001']);
  const text = jarl(root, 'next');
  assert.doesNotMatch(text, /002|004|005/);
  assert.match(text, /^006 {2}P2 {2}no files at all {2}\(no acceptance yet\) {2}\(no files declared\)$/m);
  const full = jarl(root, 'next', '--all');
  assert.match(full, /^Ready \(2\)$/m);
  assert.match(full, /^Held by a file in progress \(1\)$/m);
  assert.match(full, /^002 {2}P2 {2}blocked by file {2}\(waits on a\.mjs, held by 001\)$/m);
  assert.match(full, /^Waiting on After \(1\)$/m);
  assert.match(full, /^004 {2}P2 {2}after the running one {2}\(after 001\)$/m);
  assert.match(full, /^Held by an open question \(1\)$/m);
  assert.match(full, /^005 {2}P2 {2}asked about {2}\(question a-001\)$/m);
});

test('next says so when nothing is ready but something is held, and an answered question releases its issue', () => {
  const root = loop();
  jarl(root, 'new', 'asked', '--files', 'a.mjs');
  jarl(root, 'ask', 'which?', '--kind', 'stop', '--issue', '1');
  assert.match(jarl(root, 'next'), /nothing is ready to start.*next --all/);
  jarl(root, 'answer', '1', 'this one');
  assert.deepEqual(JSON.parse(jarl(root, 'next', '--json')).map((r) => r.id), ['001']);
});
