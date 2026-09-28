// The profile's "lifecycle" key (issue 505): a loop a composer keeps (Horde's mission) is closed and archived by the
// composer, never by Jarl's own close and archive. Before, jarl close on a finished mission deleted .jarl/ with no way
// back, and jarl archive moved a live mission out from under Horde. Under "lifecycle": { "close": "record",
// "archive": "record" } both commands and their MCP tools refuse, name the composer's command and write nothing, while
// a library caller (the composer) still may.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { sh } from './portable.mjs';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const R = await import('../record.mjs');
const L = await import('../jarl-lib.mjs');
const CLI = await import('../jarl.mjs');
const MCP = await import('../jarl-mcp.mjs');

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
  assert.equal(r.status, 1, `expected a refusal: ${args.join(' ')}`);
  return r.stderr;
}
const reason = (fn) => { try { fn(); } catch (e) { return e.message; } throw new Error('expected a refusal'); };
function file(obj) {
  const f = join(mkdtempSync(join(tmpdir(), 'jarl-life-file-')), 'profile.json');
  writeFileSync(f, JSON.stringify(obj, null, 2));
  return f;
}
// Every file under .jarl/, with its content: a refusal must leave all of it as it was.
function snapshot(dir) {
  const out = {};
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === '.lock' || e.name === '.lock.break') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, `${rel}${e.name}/`);
      else out[`${rel}${e.name}`] = readFileSync(p, 'utf8');
    }
  };
  walk(dir, '');
  return out;
}

const COMMAND = 'horde.mjs done <mission>, then horde.mjs archive <mission>';
const HORDE = {
  'jarl-profile': 1,
  format: 1,
  name: 'horde',
  statuses: {
    proposed: { flags: [], 'set-by': 'record' },
    queued: { flags: ['dispatchable'], 'set-by': 'record' },
    running: ['holds-claim'],
    merged: { flags: ['settles-dependents', 'terminal', 'closes-record'], 'set-by': 'record' },
    dropped: ['settles-dependents', 'terminal', 'needs-reason'],
  },
  'external-scheduler': 'horde.mjs tick',
  'done-gate': { approve: 'none', 'requires-merged': true },
  lifecycle: { close: 'record', archive: 'record', command: COMMAND },
};

// A mission's loop as Horde keeps it, in .horde/hordes/<h>/ of a real repository, in the default mode (out of git,
// where close removes .jarl/ outright): the case that lost the record for good.
function mission(profile = HORDE) {
  const repo = mkdtempSync(join(tmpdir(), 'jarl-life-'));
  sh(repo, 'git init -q -b main && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null && echo 1 > a.txt && git add -A && git commit -qm base');
  const root = join(repo, '.horde', 'hordes', 'h1');
  mkdirSync(root, { recursive: true });
  jarl(root, 'init', 'the mission', '--profile', file(profile));
  return { repo, root };
}

// ---- the schema ----

test('lifecycle: its keys and values are checked with every other problem; absent, both are anyone\'s', () => {
  const e = reason(() => R.validateProfile({ ...HORDE, lifecycle: { close: 'nobody', archive: 'composer', command: 'two\nlines', when: 1 } }, 'p'));
  assert.match(e, /"lifecycle": unknown key "when" — it takes close, archive, command/);
  assert.match(e, /"lifecycle": "close" is one of any, record/);
  assert.match(e, /"lifecycle": "archive" is one of any, record/);
  assert.match(e, /"lifecycle": "command" is the one-line command/);
  assert.match(reason(() => R.validateProfile({ ...HORDE, lifecycle: 'record' })), /"lifecycle" is an object/);
  const p = R.validateProfile(HORDE);
  assert.deepEqual({ ...p.lifecycle }, { close: 'record', archive: 'record', command: COMMAND });
  assert.deepEqual({ ...R.validateProfile({ ...HORDE, lifecycle: { archive: 'record' } }).lifecycle }, { close: 'any', archive: 'record', command: null });
  const { lifecycle, ...without } = HORDE;
  assert.ok(lifecycle);
  assert.deepEqual({ ...R.validateProfile(without).lifecycle }, { close: 'any', archive: 'any', command: null });
  assert.deepEqual({ ...R.DEFAULT_PROFILE.lifecycle }, { close: 'any', archive: 'any', command: null });
});

test('profile describes lifecycle, as JSON and as text', () => {
  const { root } = mission();
  assert.deepEqual(JSON.parse(jarl(root, 'profile', '--json')).lifecycle, { close: 'record', archive: 'record', command: COMMAND });
  assert.match(jarl(root, 'profile'), new RegExp(`lifecycle: close and archive by the record only, never jarl close / archive — ${COMMAND.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

// ---- the guard ----

test('lifecycle record: jarl close refuses on a finished mission, --force and --batch too, naming the composer\'s command; nothing is removed', () => {
  const { root } = mission();
  jarl(root, 'new', 'a ticket');
  R.setStatus(root, '001', 'dropped', 'out of scope');
  const dir = join(root, '.jarl');
  const before = snapshot(dir);
  for (const args of [['close'], ['close', '--force'], ['close', '--batch']]) {
    const e = refuses(root, ...args);
    assert.match(e, /this loop is closed by the tool that runs it, never by jarl close — its profile \(horde\) marks "lifecycle": \{ "close": "record" \}/);
    assert.match(e, /nothing was closed or removed; run: horde\.mjs done <mission>, then horde\.mjs archive <mission>/);
  }
  assert.ok(existsSync(dir), 'the record is still there');
  assert.deepEqual(snapshot(dir), before, 'a refusal writes nothing, not even a log line');
  assert.equal(R.findIssue(root, '001').status, 'dropped');
});

test('lifecycle record: jarl archive refuses on a live mission, naming the command; nothing is moved', () => {
  const { root } = mission();
  jarl(root, 'new', 'a live ticket');
  const dir = join(root, '.jarl');
  const before = snapshot(dir);
  const e = refuses(root, 'archive', 'old');
  assert.match(e, /this loop is archived by the tool that runs it, never by jarl archive — its profile \(horde\) marks "lifecycle": \{ "archive": "record" \}/);
  assert.match(e, /nothing was moved; run: horde\.mjs done <mission>/);
  assert.equal(existsSync(join(dir, 'archive')), false);
  assert.deepEqual(snapshot(dir), before);
  assert.ok(R.hasLiveLoop(root));
});

test('lifecycle record: the MCP tools refuse as the command line does — jarl_close and jarl_archive, and dispatch itself', () => {
  const { root } = mission();
  jarl(root, 'new', 'a ticket');
  R.setStatus(root, '001', 'dropped', 'out of scope');
  const before = snapshot(join(root, '.jarl'));
  for (const [tool, input] of [['jarl_close', {}], ['jarl_close', { force: true }], ['jarl_close', { batch: true, json: true }], ['jarl_archive', { slug: 'old' }], ['jarl_archive', { slug: 'old', json: true }]]) {
    const r = MCP.callTool(tool, { ...input, root });
    assert.equal(r.isError, true, `${tool} ${JSON.stringify(input)} is refused`);
    assert.match(r.content[0].text, /by the tool that runs it, never by jarl (close|archive).*run: horde\.mjs done <mission>/);
  }
  assert.throws(() => CLI.dispatch(root, 'close', [], {}), /never by jarl close/);
  assert.throws(() => CLI.dispatch(root, 'archive', ['old'], {}), /never by jarl archive/);
  // A caller flag handed to dispatch (as an MCP input cannot, but a host might try) does not let the command line through.
  assert.throws(() => CLI.dispatch(root, 'close', [], { caller: 'record' }), /never by jarl close/);
  assert.deepEqual(snapshot(join(root, '.jarl')), before);
});

test('lifecycle record: the composer, as a library caller, still closes and archives', () => {
  const a = mission();
  L.withLock(a.root, () => L.cmdArchive(a.root, 'done'));
  assert.equal(R.hasLiveLoop(a.root), false);
  assert.equal(readdirSync(join(a.root, '.jarl', 'archive')).length, 1);
  const b = mission();
  jarl(b.root, 'new', 'a ticket');
  R.setStatus(b.root, '001', 'dropped', 'out of scope');
  const out = L.withLock(b.root, () => L.cmdClose(b.root, {}));
  assert.equal(out.closed, true);
  assert.equal(existsSync(join(b.root, '.jarl')), false);
  // An unknown caller is refused, never read as the command line nor as the record.
  const c = mission();
  assert.match(reason(() => L.cmdClose(c.root, { caller: 'mcp' })), /caller must be one of: cli, record/);
  assert.match(reason(() => L.cmdArchive(c.root, 'x', { caller: 'mcp' })), /caller must be one of: cli, record/);
});

test('lifecycle keeps only what it names: archive to the record, close anyone\'s', () => {
  const { root } = mission({ ...HORDE, lifecycle: { archive: 'record' } });
  assert.match(refuses(root, 'archive', 'x'), /never by jarl archive — its profile \(horde\) marks "lifecycle": \{ "archive": "record" \}, so jarl archive and the MCP tools refuse, and nothing was moved$/m);
  jarl(root, 'new', 'a ticket');
  R.setStatus(root, '001', 'dropped', 'out of scope');
  assert.match(jarl(root, 'close'), /^removed /);
  assert.equal(existsSync(join(root, '.jarl')), false);
});

test('no lifecycle: close and archive from the command line work as before', () => {
  const { lifecycle, ...plain } = HORDE;
  assert.ok(lifecycle);
  const { root } = mission(plain);
  jarl(root, 'new', 'a ticket');
  assert.match(jarl(root, 'archive', 'old'), /^archived → /);
  jarl(root, 'init', 'the next mission', '--profile', file(plain));
  assert.match(jarl(root, 'close'), /^removed /);
});
