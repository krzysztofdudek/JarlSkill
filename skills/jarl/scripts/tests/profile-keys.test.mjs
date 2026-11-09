// The profile keys "set-by" on a status and "done-gate". A loop with a profile is read by Jarl's views through it: a status
// the record alone may set is refused to jarl set and the MCP tools, and done needs a merge the base holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { sh } from './portable.mjs';
import { FINDINGS } from './findings.mjs';
import { run, jarl, refuses } from './helpers.mjs';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const R = await import('../record.mjs');
const CLI = await import('../jarl.mjs');
// The id a filing reports, read with the shared id grammar (three digits or more).
const FILED = new RegExp(`filed (${CLI.ID_SRC})`);

const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
function file(obj) {
  const f = join(mkdtempSync(join(tmpdir(), 'jarl-keys-file-')), 'profile.json');
  writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
  return f;
}
const reason = (fn) => { try { fn(); } catch (e) { return e.message; } throw new Error('expected a refusal'); };

// A profile of a tool that runs its own loop: a proposal and the queue are the record's to set, a merge is recorded only
// by its landing, and an issue closes on a merge the base holds, with no approve of Jarl's own.
const COMPOSER = {
  'jarl-profile': 1,
  name: 'composer-x',
  statuses: {
    proposed: { flags: [], 'set-by': 'record' },
    queued: { flags: ['dispatchable'], 'set-by': 'record' },
    running: ['holds-claim'],
    landed: ['holds-claim'],
    changes: ['holds-claim'],
    held: [],
    merged: { flags: ['settles-dependents', 'terminal', 'closes-record'], 'set-by': 'record' },
    dropped: ['settles-dependents', 'terminal', 'needs-reason'],
  },
  'done-gate': { approve: 'none', 'requires-merged': true },
};

// A real repository on main with the loop committed beside the code; the composed loop lives in a subdirectory,
// as a composer keeps it (.composer-x/loops/<m>/.jarl/).
function composedLoop(profile = COMPOSER) {
  const repo = mkdtempSync(join(tmpdir(), 'jarl-keys-'));
  sh(repo, 'git init -q -b main && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null && mkdir src && echo 1 > src/a.mjs && git add -A && git commit -qm base');
  const root = join(repo, '.composer-x', 'loops', 'm1');
  mkdirSync(root, { recursive: true });
  jarl(root, 'init', 'the composed goal', '--committed', '--profile', file(profile));
  return { repo, root };
}

// ---- the schema ----

test('set-by and done-gate are checked with every other problem', () => {
  const e = reason(() => R.validateProfile({
    'jarl-profile': 1,
    statuses: { open: { flags: ['dispatchable'], 'set-by': 'nobody' }, run: { flags: ['holds-claim'], who: 1 }, done: ['terminal', 'settles-dependents', 'closes-record'] },
    'done-gate': { approve: 'none', extra: 1 },
  }, 'p'));
  assert.match(e, /status "open": "set-by" is one of any, record/);
  assert.match(e, /status "run": unknown key "who"/);
  assert.match(e, /"done-gate": unknown key "extra"/);
  assert.match(e, /"approve": "none" is allowed only with "requires-merged": true/);
  assert.match(reason(() => R.validateProfile({ ...COMPOSER, 'done-gate': { approve: 'none', 'requires-merged': false } })), /allowed only with "requires-merged": true/);
  assert.match(reason(() => R.validateProfile({ ...COMPOSER, 'done-gate': { approve: 'fresh', 'requires-merged': 'yes' } })), /"requires-merged" is true or false/);
  assert.match(reason(() => R.validateProfile({ ...COMPOSER, 'done-gate': 'none' })), /"done-gate" is an object/);
  // A status written as an object with no flags is a status with none; the list form still reads as before.
  const p = R.validateProfile(COMPOSER);
  assert.deepEqual(p.flagsOf('proposed'), []);
  assert.equal(p.setBy('queued'), 'record');
  assert.equal(p.setBy('running'), 'any');
  assert.deepEqual({ ...p.doneGate }, { approve: 'none', 'requires-merged': true });
  assert.deepEqual({ ...R.DEFAULT_PROFILE.doneGate }, { approve: 'fresh', 'requires-merged': false });
});

test('profile describes the new keys, as JSON and as text', () => {
  const { root } = composedLoop();
  const d = json(root, 'profile');
  assert.deepEqual(d.statuses.filter((s) => s.setBy).map((s) => s.name), ['proposed', 'queued', 'merged']);
  assert.deepEqual(d.doneGate, { approve: 'none', 'requires-merged': true });
  const t = jarl(root, 'profile');
  assert.match(t, /queued {2}dispatchable {2}\(set by the record only, never jarl set\)/);
  assert.match(t, /done gate: approve none · requires a merge in the base/);
});

// ---- set-by: record ----

test('set-by record: jarl set and the MCP tools cannot move an issue into it; a library call can, and moving out is anyone\'s', () => {
  const { root } = composedLoop();
  jarl(root, 'new', 'an issue', '--acceptance', '[read] it works');
  const path = R.findIssue(root, '1').file;
  const before = readFileSync(path, 'utf8');
  assert.match(refuses(root, 'set', '1', 'queued'), /queued is set by the record only — this loop's profile \(composer-x\) marks it "set-by": "record"/);
  // The MCP tools run through dispatch as the command line does: jarl_set is refused the same way.
  assert.throws(() => CLI.dispatch(root, 'set', ['1', 'queued'], { by: 'jarl' }), /queued is set by the record only/);
  assert.throws(() => R.setStatus(root, '1', 'queued', undefined, { caller: 'cli' }), /set by the record only/);
  assert.equal(readFileSync(path, 'utf8'), before, 'a refusal writes nothing');
  // The composer, through record.mjs, moves it; the worker's claim after that is anyone's.
  assert.equal(R.setStatus(root, '1', 'queued').status, 'queued');
  jarl(root, 'set', '1', 'running', '--branch', 'jarl/1-a', '--worker', 'w1');
  assert.equal(R.findIssue(root, '1').status, 'running');
  // Filing is not a move: a new issue lands in a set-by-record initial status.
  assert.equal(R.findIssue(root, jarl(root, 'new', 'another', '--acceptance', '[read] it works').match(FILED)[1]).status, 'proposed');
});

// ---- done-gate ----

test('done-gate requires-merged: no merge, or a merge the base does not hold, is refused; approve none asks for no review', () => {
  const { repo, root } = composedLoop();
  jarl(root, 'new', 'an issue', '--acceptance', '[read] it works');
  R.setStatus(root, '1', 'queued');
  jarl(root, 'set', '1', 'running', '--branch', 'jarl/1-t', '--worker', 'w1');
  jarl(root, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'pass 1');
  assert.match(reason(() => R.setStatus(root, '1', 'merged')), /1 records no merge — this loop's profile closes an issue only on a landed merge \(done-gate "requires-merged": true\)/);
  // A commit on a side branch, recorded as merged, is not in the base yet.
  sh(repo, 'git checkout -q -b jarl/1-t && echo 2 > src/a.mjs && git commit -qam work && git checkout -q main');
  const side = sh(repo, 'git rev-parse jarl/1-t');
  const rec = R.recordMerged(root, '1', { sha: side, ci: 'none' });
  assert.ok(!rec.notes.some((n) => /FRESH REVIEW/.test(n)), 'with approve none no reviewer is owed, so the merge note does not ask for one');
  assert.match(reason(() => R.setStatus(root, '1', 'merged')), new RegExp(`1 records Merged ${side.slice(0, 12)}\\w*, which is not in the base \\(main in `));
  // Landed: the base holds it. No review was ever recorded, and none is asked for.
  sh(repo, 'git merge -q --ff-only jarl/1-t');
  assert.equal(R.setStatus(root, '1', 'merged').status, 'merged');
  // An unknown sha is refused the same way.
  jarl(root, 'new', 'second', '--acceptance', '[read] it works');
  R.setStatus(root, '2', 'queued');
  jarl(root, 'set', '2', 'running', '--worker', 'w2');
  jarl(root, 'evidence', '2', '--line', '1', '--ran', 'npm test', '--saw', 'pass 2');
  R.recordMerged(root, '2', { sha: 'deadbeef', ci: 'none' });
  assert.match(reason(() => R.setStatus(root, '2', 'merged')), /records Merged deadbeef, which is not in the base/);
});

test('done-gate requires-merged: a composer landing into a branch nobody has checked out names it as base; the command line cannot', () => {
  // A composer lands an issue into its team branch in a throwaway tree and moves the ref: the checkout stays on main, so the
  // branch checked out is the wrong base, and the composer names the one it landed into.
  const { repo, root } = composedLoop();
  jarl(root, 'new', 'an issue', '--acceptance', '[read] it works');
  R.setStatus(root, '1', 'queued');
  jarl(root, 'set', '1', 'running', '--branch', 'h1-t1', '--worker', 'w1');
  jarl(root, 'evidence', '1', '--line', '1', '--ran', 'land', '--saw', 'green');
  sh(repo, 'git branch h1/team && git checkout -q -b h1-t1 && echo 2 > src/a.mjs && git commit -qam work && git checkout -q h1/team && git merge -q --no-ff -m land h1-t1 && git checkout -q main');
  const landed = sh(repo, 'git rev-parse h1/team');
  R.recordMerged(root, '1', { sha: landed, ci: 'none' });
  assert.match(reason(() => R.setStatus(root, '1', 'merged')), /which is not in the base \(main in /);
  assert.match(reason(() => R.setStatus(root, '1', 'merged', undefined, { base: 'h1/nope' })), /the base h1\/nope is not a branch or commit/);
  // The command line has no --base, and a base handed to dispatch (as an MCP call would) is refused, not honoured.
  assert.match(refuses(root, 'set', '1', 'dropped', 'x', '--base', 'h1/team'), /unknown flag --base/);
  assert.throws(() => CLI.dispatch(root, 'set', ['1', 'dropped', 'x'], { base: 'h1/team', by: 'jarl' }), /base is named by a library call through record\.mjs only/);
  assert.equal(R.findIssue(root, '1').status, 'running', 'a refusal writes nothing');
  assert.equal(R.setStatus(root, '1', 'merged', undefined, { base: 'h1/team' }).status, 'merged');
});

test('done-gate requires-merged with approve fresh: the landed merge and the fresh approve are both asked for', () => {
  const { repo, root } = composedLoop({ ...COMPOSER, name: 'both', 'done-gate': { approve: 'fresh', 'requires-merged': true }, statuses: { ...COMPOSER.statuses, merged: ['settles-dependents', 'terminal', 'closes-record'] } });
  jarl(root, 'new', 'an issue', '--acceptance', '[read] it works');
  R.setStatus(root, '1', 'queued');
  jarl(root, 'set', '1', 'running', '--branch', 'jarl/1-t', '--worker', 'w1');
  jarl(root, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'pass');
  assert.match(refuses(root, 'set', '1', 'merged'), /records no merge/);
  const head = sh(repo, 'git rev-parse HEAD');
  jarl(root, 'merged', '1', '--sha', head, '--ci', 'none');
  assert.match(refuses(root, 'set', '1', 'merged'), /no approving review/);
  jarl(root, 'review', '1', 'approve', '--by', 'fresh-eyes', FINDINGS);
  assert.match(jarl(root, 'set', '1', 'merged'), /1 → merged/);
});

test('no done-gate: a loop without the key closes exactly as before — no merge asked for', () => {
  const { root } = composedLoop({ ...COMPOSER, name: 'plain', 'done-gate': undefined, statuses: { ...COMPOSER.statuses, merged: ['settles-dependents', 'terminal', 'closes-record'] } });
  jarl(root, 'new', 'an issue', '--acceptance', '[read] it works');
  R.setStatus(root, '1', 'queued');
  jarl(root, 'set', '1', 'running', '--worker', 'w1');
  jarl(root, 'evidence', '1', '--line', '1', '--ran', 'x', '--saw', 'y');
  jarl(root, 'review', '1', 'approve', '--by', 'fresh-eyes', FINDINGS);
  assert.match(jarl(root, 'set', '1', 'merged'), /1 → merged/);
});

// ---- every view on a composed loop ----

// ---- every view on a loop with a profile ----

test('every view tells the truth on a loop with a profile: next, status, resume with its tips, branches, report, list', () => {
  const { repo, root } = composedLoop();
  // 1 merged and landed; 2 in flight on its branch; 3 queued; 4 proposed; 5 dropped.
  for (const t of ['landed one', 'in flight', 'queued', 'proposed', 'gone']) jarl(root, 'new', t, '--acceptance', '[read] it works');
  R.setStatus(root, '1,2,3,5', 'queued');
  sh(repo, 'git checkout -q -b jarl/1-landed && echo 2 > src/a.mjs && git commit -qam one && git checkout -q main && git merge -q --ff-only jarl/1-landed');
  jarl(root, 'set', '1', 'running', '--branch', 'jarl/1-landed', '--worker', 'w1');
  jarl(root, 'evidence', '1', '--line', '1', '--ran', 'gate', '--saw', 'green');
  R.recordMerged(root, '1', { sha: sh(repo, 'git rev-parse HEAD'), ci: 'none' });
  R.setStatus(root, '1', 'merged');
  sh(repo, 'git checkout -q -b jarl/2-flight && echo 3 > src/b.mjs && git add src/b.mjs && git commit -qm two && git checkout -q main');
  jarl(root, 'set', '2', 'running', '--branch', 'jarl/2-flight', '--worker', 'w2');
  jarl(root, 'set', '5', 'dropped', 'out of scope');

  // status: the counts by the profile's statuses.
  const st = json(root, 'status');
  assert.deepEqual(st.statuses, { proposed: 1, queued: 1, running: 1, landed: 0, changes: 0, held: 0, merged: 1, dropped: 1 });
  assert.equal(st.inFlight, 1);
  const stText = jarl(root, 'status');
  assert.match(stText, /^goal: the composed goal\n.*profile composer-x\n/);
  assert.match(stText, /closed on a merge in the base, no approve required/);

  // resume: in flight is the one running, by its branch and worker.
  const rs = json(root, 'resume');
  assert.deepEqual(rs.inFlight.map((x) => [x.id, x.branch, x.worker]), [['2', 'jarl/2-flight', 'w2']]);

  // next offers the queued issue and nothing another status holds.
  assert.deepEqual(json(root, 'next').map((r) => r.id), ['3']);

  // tips: the feature branch of the work in flight and the base, in the repository the loop lives in.
  const rows = json(root, 'resume', '--gh').tips.repos[0].rows.map((r) => [r.role, r.branch, r.issues || []]);
  assert.deepEqual(rows, [['worker', 'jarl/2-flight', ['2']], ['feature', 'main', []]]);

  // branches: the landed branch is done and deletable, the one in flight is not.
  const br = Object.fromEntries(json(root, 'branches').map((b) => [b.branch, b]));
  assert.equal(br['jarl/1-landed'].done, 'delete');
  assert.deepEqual(br['jarl/1-landed'].issues, ['1']);
  assert.equal(br['jarl/2-flight'].done, null);

  // report: merged is the done work, with the merge it closed on; dropped with its reason; the rest still open.
  const rp = json(root, 'report');
  assert.equal(rp.done, 1);
  assert.equal(rp.dropped, 1);
  assert.equal(rp.left, 3);
  assert.deepEqual(rp.statuses, st.statuses);
  assert.equal(rp.issues.find((i) => i.id === '1').merged, sh(repo, 'git rev-parse HEAD'));
  assert.match(rp.text, /## Done \(1\)\nclosed on a merge in the base, no approve required \(this loop's done gate\)/);
  assert.match(rp.text, /## Dropped \(1\)\n- 5 gone — out of scope/);
  assert.match(rp.text, /## Still open \(3\)\n- 2 in flight \(running\)\n- 3 queued \(queued\)\n- 4 proposed \(proposed\)/);

  // list: the unfinished ones, by the profile's statuses.
  assert.deepEqual(json(root, 'list').map((i) => [i.id, i.status]), [['2', 'running'], ['3', 'queued'], ['4', 'proposed']]);
});

test('no profile: next is the list and status and resume count what is ready', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-keys-plain-'));
  mkdirSync(join(root, '.git'));
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'one', '--acceptance', '[read] it works');
  assert.ok(Array.isArray(json(root, 'next')));
  const st = json(root, 'status');
  assert.equal(st.ready, 1);
  const rs = json(root, 'resume');
  assert.equal(rs.readyTotal, 1);
});

// ---- a composer's loop keeps its record format ----
