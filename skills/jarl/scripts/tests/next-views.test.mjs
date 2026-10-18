// The views of next, status and resume that say what comes next: the ready set and its groups (issue 249), the
// derived facts on in-flight rows (283), status --tag (281) and exclusive resources (282).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FINDINGS } from './findings.mjs';

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

// ---- 283: derived facts on in-flight rows ---------------------------------------------------------------

test('in-flight rows carry one derived fact, in status and resume, text and json; set ready names the view', () => {
  const root = loop();
  for (const t of ['no rows', 'rows only', 'asked for changes', 'approved']) jarl(root, 'new', t, '--files', `${t.replace(/ /g, '-')}.mjs`);
  jarl(root, 'new', 'waits', '--after', '1');
  for (const id of ['1', '2', '3', '4', '5']) jarl(root, 'set', id, 'in-progress', 'go', '--worker', `w${id}`, '--branch', `jarl/${id}`);
  for (const id of ['2', '3', '4']) jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'green');
  jarl(root, 'review', '3', 'changes', '--by', 'rev', 'Important: the edge case of an empty list is not handled');
  jarl(root, 'review', '4', 'approve', '--by', 'rev', FINDINGS);
  const st = JSON.parse(jarl(root, 'status', '--json'));
  assert.deepEqual(Object.fromEntries(st.inFlightRows.map((r) => [r.id, r.mark])),
    { '001': 'no-rows', '002': 'rows-no-verdict', '003': 'changes-requested', '004': 'approved' }, 'an issue waiting on After is not in flight');
  const text = jarl(root, 'status');
  assert.match(text, /^in flight 001 · no evidence rows since the start/m);
  assert.match(text, /^in flight 002 · evidence rows recorded, no verdict .* waits for a reviewer$/m);
  assert.match(text, /^in flight 003 · changes requested .* back with the worker/m);
  assert.match(text, /^in flight 004 · approved and queued .* then set it done$/m);
  const resume = JSON.parse(jarl(root, 'resume', '--json'));
  assert.deepEqual(resume.inFlight.map((r) => r.mark), ['no-rows', 'rows-no-verdict', 'changes-requested', 'approved']);
  assert.match(jarl(root, 'resume'), /^- 003 asked for changes .*\n {2}→ changes requested/m);
  // A new round or a restart spends the verdict: rows and no verdict again.
  jarl(root, 'round', '3', 'red again');
  assert.equal(JSON.parse(jarl(root, 'status', '--json')).inFlightRows.find((r) => r.id === '003').mark, 'rows-no-verdict');
  const msg = refuses(root, 'set', '1', 'ready');
  assert.match(msg, /ready is a view here, not a status/);
  assert.match(msg, /`next` lists the issues ready to start/);
  assert.match(msg, /declare one in its profile/);
  assert.match(refuses(root, 'set', '1', 'review'), /review is a view here/);
  assert.match(refuses(root, 'set', '1', 'nonsense'), /^status must be one of: /m);
});

// ---- 281: status --tag ----------------------------------------------------------------------------------

test('status --tag scopes every section to the issues carrying the tag', () => {
  const root = loop();
  jarl(root, 'new', 'alpha one', '--tags', 'alpha', '--files', 'a.mjs');
  jarl(root, 'new', 'alpha two', '--tags', 'alpha', '--files', 'b.mjs', '--after', '1');
  jarl(root, 'new', 'beta one', '--tags', 'beta', '--files', 'c.mjs');
  jarl(root, 'new', 'beta two', '--tags', 'beta', '--files', 'd.mjs');
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1', '--branch', 'jarl/1');
  jarl(root, 'set', '3', 'in-progress', 'go', '--worker', 'w3', '--branch', 'jarl/3');
  jarl(root, 'ask', 'which?', '--kind', 'stuck', '--issue', '4');
  const a = JSON.parse(jarl(root, 'status', '--tag', 'alpha', '--json'));
  const b = JSON.parse(jarl(root, 'status', '--tag', 'beta', '--json'));
  assert.deepEqual([a.open, a['in-progress']], [1, 1]);
  assert.deepEqual([b.open, b['in-progress']], [1, 1]);
  assert.deepEqual(a.waitingIds, ['002']);
  assert.deepEqual(b.waitingIds, []);
  assert.deepEqual(a.inFlightRows.map((r) => r.id), ['001']);
  assert.deepEqual(b.inFlightRows.map((r) => r.id), ['003']);
  assert.deepEqual([a.questions, b.questions], [0, 1], 'a question counts under the tag of the issue it names');
  assert.equal(a.noAcceptance.length, 1);
  assert.deepEqual(a.noAcceptance, ['001']);
  assert.deepEqual(b.noAcceptance, ['003']);
  assert.equal(a.tag, 'alpha');
  const whole = JSON.parse(jarl(root, 'status', '--json'));
  assert.equal(whole.open, 2); assert.equal(whole['in-progress'], 2); assert.equal(whole.tag, undefined);
  assert.match(jarl(root, 'status', '--tag', 'alpha'), /^open 0 · in flight 1 · waiting 1 /m, 'alpha one runs, alpha two waits on it');
  assert.match(refuses(root, 'status', '--tag', 'nope'), /no issue carries the tag nope/);
});
