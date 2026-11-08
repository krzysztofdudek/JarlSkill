// Which loop a call that names none reaches. Jarl lists the loops under a checkout by a bounded walk: at most four levels
// down, never into a hidden directory, node_modules, vendor or another checkout, following no link, and stopping after a
// set number of directories. Where the checkout's root holds a loop it is reached and a note names the others; where it
// holds none and loops are below, the call is refused with their list. use <path> names the loop of the calls that
// follow: a tool session keeps it in the server, and the command line, which keeps nothing between runs, prints the
// JARL_ROOT setting it then reads. Nothing of it is written into the record or the checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SCRIPT, SPAWN_TIMEOUT } from './helpers.mjs';
import * as R from '../record.mjs';
import { LOOP_WALK_DEPTH, loopsUnder } from '../jarl-lib.mjs';
import * as mcp from '../jarl-mcp.mjs';

// A checkout (a directory with a .git) holding a loop at each path given, '.' for its root.
function checkout(loops) {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-discovery-'));
  mkdirSync(join(dir, '.git'));
  for (const p of loops) { const at = join(dir, ...p.split('/')); mkdirSync(at, { recursive: true }); R.initLoop(at, `the loop at ${p}`); }
  return dir;
}
// One call of the command line from `cwd`, with no --root, and JARL_ROOT only where `env` sets it.
function cli(cwd, args, env = {}) {
  const inherited = { ...process.env };
  delete inherited.JARL_ROOT;
  delete inherited.CLAUDE_PLUGIN_ROOT;
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: SPAWN_TIMEOUT, env: { ...inherited, ...env } });
  return { status: r.status, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}
const listing = (dir) => readdirSync(dir, { recursive: true }).map(String).sort();

test('the walk lists the loops under a checkout, down to its depth, and never enters a hidden directory, node_modules, vendor, another checkout or a link', () => {
  const dir = checkout(['.', 'releases/6.3.0', 'topics/a/b', 'node_modules/pkg', 'vendor/copy', '.hidden/x', 'w/x/y/z/deep']);
  mkdirSync(join(dir, 'other', '.git'), { recursive: true });
  R.initLoop(join(dir, 'other'), 'another checkout');
  mkdirSync(join(dir, 'link-target'));
  try { symlinkSync(join(dir, 'releases'), join(dir, 'link-target', 'releases'), 'dir'); } catch { /* a platform that refuses a link here leaves the case out */ }
  const walk = loopsUnder(dir);
  assert.equal(LOOP_WALK_DEPTH, 4);
  assert.deepEqual(walk.loops, ['.', 'releases/6.3.0', 'topics/a/b']);
  assert.equal(walk.stopped, false);
  assert.equal(walk.depth, 4);
  assert.deepEqual(loopsUnder(dir, { depth: 5 }).loops, ['.', 'releases/6.3.0', 'topics/a/b', 'w/x/y/z/deep'], 'a deeper walk finds the deeper loop');
  assert.equal(loopsUnder(dir, { limit: 3 }).stopped, true, 'the walk stops after its number of directories and says so');
});

test('a checkout with no loop at its root and loops below refuses a call that names none, with the list; init and use still run', () => {
  const dir = checkout(['releases/6.3.0', 'topics/a']);
  const before = listing(dir);
  const r = cli(dir, ['status']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^the call names no loop, this checkout holds none at its root, and 2 loops are below it: releases\/6\.3\.0, topics\/a — which one is meant is the caller's to say, with --root or JARL_ROOT, or for the calls that follow with jarl\.mjs use "<path>"; nothing was read or written\n--root "<loop-root>"$/);
  assert.match(cli(join(dir, 'releases'), ['new', 'a title']).stderr, /2 loops are below it/, 'from a subdirectory too');
  assert.deepEqual(listing(dir), before, 'nothing was written');
  assert.match(cli(dir, ['use']).stdout, /^loops under this checkout \(2, down to 4 levels\):\n- releases\/6\.3\.0\n- topics\/a\nthe calls that follow reach one: jarl\.mjs use "<path>"$/);
  assert.equal(cli(dir, ['status', '--root', join(dir, 'topics', 'a')]).status, 0, '--root reaches one');
  const opened = cli(dir, ['init', 'a loop at the root']);
  assert.equal(opened.status, 0, opened.stderr);
});

test('where the root holds a loop it is reached, and a note names the loops below it', () => {
  const dir = checkout(['.', 'releases/6.3.0']);
  const r = cli(dir, ['status']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^goal: the loop at \./);
  assert.match(r.stderr, /note: the call named no loop and reached the one at the root of this checkout; 1 more is below it: releases\/6\.3\.0 — another is reached with --root or JARL_ROOT, or for the calls that follow with jarl\.mjs use "<path>"/);
  assert.doesNotMatch(cli(dir, ['status', '--root', dir]).stderr, /note: the call named no loop/, 'a call that names its loop gets no note');
  const lone = checkout(['.']);
  assert.equal(cli(lone, ['status']).stderr, '', 'a checkout with one loop says nothing');
});

test('the command line reads JARL_ROOT after --root, and refuses one that is not absolute', () => {
  const dir = checkout(['releases/6.3.0', 'topics/a']);
  const sub = join(dir, 'topics', 'a');
  assert.match(cli(dir, ['status'], { JARL_ROOT: sub }).stdout, /^goal: the loop at topics\/a/);
  assert.match(cli(dir, ['status', '--root', join(dir, 'releases', '6.3.0')], { JARL_ROOT: sub }).stdout, /^goal: the loop at releases\/6\.3\.0/, '--root wins');
  const rel = cli(dir, ['status'], { JARL_ROOT: 'topics/a' });
  assert.equal(rel.status, 1);
  assert.match(rel.stderr, /^JARL_ROOT must be an absolute path \(got "topics\/a"\) — a relative one would reach another loop from another directory; nothing was read or written\n--root "<loop-root>"$/);
});

test('use <path> on the command line prints the JARL_ROOT setting for each shell, writes nothing, and refuses a path with no loop', () => {
  const dir = checkout(['releases/6.3.0', 'topics/a']);
  const before = listing(dir);
  const r = cli(join(dir, 'topics'), ['use', 'releases/6.3.0']);
  assert.equal(r.status, 0, r.stderr);
  const abs = resolve(dir, 'releases', '6.3.0');
  const lines = r.stdout.split('\n');
  assert.match(lines[0], /^use releases\/6\.3\.0: the command line keeps nothing between runs, so set JARL_ROOT in this shell, and every call that names no --root reaches this loop until JARL_ROOT is changed or unset:$/);
  assert.ok(lines[1].startsWith('  POSIX shell (sh, bash, zsh): export JARL_ROOT=') && lines[1].includes(abs), lines[1]);
  assert.equal(lines[2], `  PowerShell: $env:JARL_ROOT = '${abs}'`);
  assert.equal(lines[3], `  cmd: set "JARL_ROOT=${abs}"`);
  assert.deepEqual(listing(dir), before, 'use writes nothing');
  assert.match(cli(dir, ['use', join(dir, 'topics', 'a', '.jarl')]).stdout, /^use topics\/a: /, 'a loop\'s .jarl/ names the loop; an absolute path is read as it is');
  const none = cli(dir, ['use', 'topics']);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /^'topics' holds no loop: there is no \.jarl\/ there — the loops under this checkout: releases\/6\.3\.0, topics\/a\njarl\.mjs use "<path>"$/);
});

test('a tool session names its loop once with jarl_use; the server holds it for that session alone, below a call\'s root and above JARL_ROOT', () => {
  const dir = checkout(['releases/6.3.0', 'topics/a']);
  const before = listing(dir);
  const session = { root: null };
  const used = mcp.callTool('jarl_use', { path: 'releases/6.3.0' }, {}, dir, session);
  assert.equal(used.isError, false);
  assert.match(used.content[0].text, /^use releases\/6\.3\.0: this session's calls that name no root reach this loop until use names another; a call's root field still reaches its own$/);
  assert.equal(session.root, resolve(dir, 'releases', '6.3.0'));
  const status = mcp.callTool('jarl_status', {}, { JARL_ROOT: join(dir, 'topics', 'a') }, dir, session);
  assert.match(status.content[0].text, /^goal: the loop at releases\/6\.3\.0/);
  assert.match(status.content.at(-1).text, /\(no root given — the loop this session chose with use\)$/);
  assert.match(mcp.callTool('jarl_status', { root: join(dir, 'topics', 'a') }, {}, dir, session).content[0].text, /^goal: the loop at topics\/a/, 'the root field wins');
  // Another session has chosen nothing: it is refused with the list, and the form carries the root as a placeholder.
  const other = mcp.callTool('jarl_status', {}, {}, dir, { root: null });
  assert.equal(other.isError, true);
  assert.match(other.content[0].text, /^the call names no loop, this checkout holds none at its root, and 2 loops are below it: releases\/6\.3\.0, topics\/a — .*\njarl_status \{"root":"<loop-root>"\}$/);
  // jarl_init opens a loop at the checkout's root, which holds none.
  assert.equal(mcp.callTool('jarl_init', { goal: 'opened at the root' }, {}, mkdtempSync(join(tmpdir(), 'jarl-discovery-init-')), { root: null }).isError, false);
  mcp.callTool('jarl_use', { path: 'topics/a' }, {}, dir, session);
  assert.match(mcp.callTool('jarl_status', {}, {}, dir, session).content[0].text, /^goal: the loop at topics\/a/, 'use names another');
  assert.match(mcp.callTool('jarl_use', {}, {}, dir, { root: null }).content[0].text, /^loops under this checkout \(2, down to 4 levels\):/);
  assert.deepEqual(listing(dir), before, 'nothing is written into the checkout or the record');
});
