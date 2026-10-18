// The views of next, status and resume that say what comes next: the ready set and its groups (issue 249), the
// derived facts on in-flight rows (283), status --tag (281) and exclusive resources (282).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FINDINGS } from './findings.mjs';
import { oldJarl } from './old-jarl.mjs';
import { run, jarl, refuses, loop as makeLoop } from './helpers.mjs';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));

const loop = () => makeLoop({ prefix: 'jarl-views-', via: 'cli', dotGit: false });

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
  assert.match(full, /^Held by a file another issue holds \(1\)$/m);
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

test('a coordinator\'s approve on an issue that carries code is not "approved and queued"; a merged issue says what is left', () => {
  const root = loop();
  jarl(root, 'new', 'code issue', '--files', 'a.mjs');
  jarl(root, 'new', 'merged issue', '--files', 'b.mjs');
  jarl(root, 'new', 'plain issue', '--files', 'c.mjs');
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1', '--branch', 'jarl/1');
  jarl(root, 'set', '2', 'in-progress', 'go', '--worker', 'w2', '--branch', 'jarl/2');
  jarl(root, 'set', '3', 'in-progress', 'go', '--worker', 'w3');
  for (const id of ['1', '2', '3']) jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'green');
  jarl(root, 'review', '1', 'approve', '--by', 'jarl', FINDINGS);
  jarl(root, 'review', '2', 'approve', '--by', 'rev', FINDINGS);
  jarl(root, 'merged', '2', '--sha', 'abc1234', '--ci', 'pending');
  const marks = () => Object.fromEntries(JSON.parse(jarl(root, 'status', '--json')).inFlightRows.map((r) => [r.id, r.mark]));
  assert.deepEqual(marks(), { '001': 'approved-not-fresh', '002': 'merged-ci', '003': 'rows-no-verdict' });
  assert.match(jarl(root, 'status'), /^in flight 001 · approved by a coordinator only.*fresh reviewer/m);
  assert.match(jarl(root, 'status'), /^in flight 002 · merged, CI not green yet — next record the CI result/m);
  assert.doesNotMatch(jarl(root, 'status'), /in flight 001 · approved and queued/);
  jarl(root, 'merged', '2', '--ci', 'green');
  assert.equal(marks()['002'], 'merged');
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
  assert.match(jarl(root, 'status', '--tag', 'alpha'), /^scoped to the issues tagged alpha/m);
  const keys = Object.keys(a);
  assert.deepEqual(keys.slice(-2), ['tag', 'check'], 'tag sits just before the last key, check stays last');
});

test('status --tag scopes the stale leases and the merges waiting on CI too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-tag-git-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'core.excludesFile', '/dev/null');
  writeFileSync(join(dir, 'a.mjs'), '1\n');
  git('add', '-A'); git('commit', '-qm', 'base');
  jarl(dir, 'init', 'goal');
  jarl(dir, 'new', 'alpha running', '--tags', 'alpha');   // 001: its branch does not exist
  jarl(dir, 'new', 'beta running', '--tags', 'beta');     // 002: nor does this one
  jarl(dir, 'new', 'alpha merged', '--tags', 'alpha');    // 003
  jarl(dir, 'new', 'beta merged', '--tags', 'beta');      // 004
  jarl(dir, 'set', '1', 'in-progress', 'go', '--worker', 'w1', '--branch', 'gone-alpha');
  jarl(dir, 'set', '2', 'in-progress', 'go', '--worker', 'w2', '--branch', 'gone-beta');
  jarl(dir, 'merged', '3', '--sha', 'abc1234', '--ci', 'pending');
  jarl(dir, 'merged', '4', '--sha', 'abc1234', '--ci', 'red');
  const whole = JSON.parse(jarl(dir, 'status', '--json'));
  assert.deepEqual(whole.stale.map((x) => x.id), ['001', '002']);
  const a = JSON.parse(jarl(dir, 'status', '--tag', 'alpha', '--json'));
  const b = JSON.parse(jarl(dir, 'status', '--tag', 'beta', '--json'));
  assert.deepEqual(a.stale.map((x) => x.id), ['001']);
  assert.deepEqual(b.stale.map((x) => x.id), ['002']);
  assert.match(a.stale[0].problems.join(), /branch gone: gone-alpha/);
  assert.deepEqual([a.ciPending, a.ciRed], [['003'], []]);
  assert.deepEqual([b.ciPending, b.ciRed], [[], ['004']]);
  const text = jarl(dir, 'status', '--tag', 'beta');
  assert.match(text, /^stale 002 · branch gone: gone-beta/m);
  assert.match(text, /^merged, CI red: 004$/m);
  assert.doesNotMatch(text, /001|003/);
});

// ---- 282: exclusive resources ---------------------------------------------------------------------------

function twoRepos() {
  const hub = mkdtempSync(join(tmpdir(), 'jarl-res-'));
  for (const name of ['tool', 'lib']) { mkdirSync(join(hub, name)); spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: join(hub, name) }); }
  jarl(hub, 'init', 'goal');
  return hub;
}

test('a resource is held by an issue in progress; next never offers two issues that declare one, across repositories', () => {
  const hub = twoRepos();
  jarl(hub, 'new', 'heavy run in tool', '--repo', './tool', '--files', 'tool/a.mjs');           // 001
  jarl(hub, 'new', 'heavy run in lib', '--repo', './lib', '--files', 'lib/b.mjs');              // 002
  jarl(hub, 'new', 'light work', '--repo', './lib', '--files', 'lib/c.mjs');                    // 003
  jarl(hub, 'new', 'third heavy run', '--repo', './tool', '--files', 'tool/d.mjs');             // 004
  jarl(hub, 'set', '1', 'resources', 'gate, Database');
  jarl(hub, 'set', '2', 'resources', 'DataBase');
  jarl(hub, 'set', '4', 'resources', 'gate');
  assert.match(jarl(hub, 'show', '1'), /\*\*Resources:\*\* gate, Database/);
  // Nothing in progress: the first heavy one is offered, the others sharing a resource with an offered one are held.
  const rows = JSON.parse(jarl(hub, 'next', '--all', '--json'));
  const by = (g) => rows.filter((r) => r.group === g).map((r) => r.id);
  assert.deepEqual(by('ready'), ['001', '003'], 'two repositories, one resource: never together');
  assert.deepEqual(by('held-by-resource'), ['002', '004']);
  assert.deepEqual(rows.find((r) => r.id === '002').heldBy, ['001']);
  assert.deepEqual(rows.find((r) => r.id === '002').resources, ['DataBase'], 'names keep the case they were written in; the comparison ignores case');
  assert.match(jarl(hub, 'next', '--all'), /^Held by a resource another issue holds \(2\)\n002 {2}P2 {2}heavy run in lib {2}.*\(waits on resource DataBase, held by 001\)/m);
  // Once 001 runs, its resources are taken for the whole lease.
  jarl(hub, 'set', '1', 'in-progress', 'go', '--worker', 'w1');
  assert.deepEqual(JSON.parse(jarl(hub, 'next', '--json')).map((r) => r.id), ['003']);
  const held = JSON.parse(jarl(hub, 'next', '--all', '--json')).filter((r) => r.group === 'held-by-resource');
  assert.deepEqual(held.map((r) => [r.id, r.heldBy]), [['002', ['001']], ['004', ['001']]]);
});

test('an issue that declares a resource passes check on its real files; check, queue and the file rules never read it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-res-git-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'core.excludesFile', '/dev/null');
  writeFileSync(join(dir, 'a.mjs'), '1\n');
  git('add', '-A'); git('commit', '-qm', 'base');
  jarl(dir, 'init', 'goal');
  jarl(dir, 'new', 'work', '--files', 'a.mjs');
  jarl(dir, 'set', '1', 'resources', 'gate');
  jarl(dir, 'set', '1', 'in-progress', 'go', '--worker', 'w', '--branch', 'work');
  git('checkout', '-q', '-b', 'work');
  writeFileSync(join(dir, 'a.mjs'), '2\n');
  git('commit', '-qam', 'work');
  const c = JSON.parse(jarl(dir, 'check', '1', '--branch', 'work', '--base', 'main', '--json'));
  const scope = c.items.find((x) => x.name === 'diff inside declared files');
  assert.equal(scope.ok, true, 'a resource is not a file: the real change is inside the issue');
  assert.match(scope.note, /1 file\(s\), all inside/);
  assert.deepEqual(c.changed, ['a.mjs']);
  assert.deepEqual(JSON.parse(jarl(dir, 'queue', '--json')).repos.flatMap((r) => r.rows), [], 'queue reads no resource');
});

test('set resources refuses a bad name and the lease flags; an empty value clears; Jarl 6.1.0 ignores the field', () => {
  const hub = twoRepos();
  jarl(hub, 'new', 'a', '--files', 'a.mjs');
  jarl(hub, 'new', 'b', '--files', 'b.mjs');
  assert.match(refuses(hub, 'set', '1', 'resources', 'two words'), /resource names are single words/);
  jarl(hub, 'set', '1,2', 'resources', 'port-8080');
  assert.deepEqual(JSON.parse(jarl(hub, 'next', '--json')).map((r) => r.id), ['001'], '002 shares the resource, so it is held');
  // The pinned Jarl 6.1.0 reads the field as any other it does not know: both issues are ready to it, nothing refused.
  for (const command of ['list', 'status', 'next', 'queue']) assert.equal(oldJarl(hub, command, {}).ok, true, command);
  assert.deepEqual(oldJarl(hub, 'next', {}).value.filter((r) => r.ready).map((r) => r.id), ['001', '002'], '6.1.0 ignores Resources');
  jarl(hub, 'set', '2', 'resources', '');
  assert.deepEqual(JSON.parse(jarl(hub, 'next', '--json')).map((r) => r.id), ['001', '002']);
});

test('Resources is a field the tool writes itself: a profile that declares a field of that name is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-res-profile-'));
  const file = join(dir, 'profile.json');
  writeFileSync(file, JSON.stringify({ 'jarl-profile': 1, name: 'mine', statuses: { open: ['dispatchable'], 'in-progress': ['holds-claim'], done: ['settles-dependents', 'terminal', 'closes-record'], dropped: ['terminal', 'needs-reason'] }, fields: { Resources: { default: 'none' } } }));
  const hub = mkdtempSync(join(tmpdir(), 'jarl-res-hub-'));
  assert.match(refuses(hub, 'init', 'goal', '--profile', file), /field "Resources" is one the tool writes itself — a profile cannot declare it/);
  jarl(hub, 'init', 'goal');
  assert.match(jarl(hub, 'new', 'a', '--files', 'a.mjs'), /001/);
  assert.match(jarl(hub, 'set', '1', 'resources', 'shared'), /001 Resources: shared/, 'the name has one meaning: the exclusive resources');
});
