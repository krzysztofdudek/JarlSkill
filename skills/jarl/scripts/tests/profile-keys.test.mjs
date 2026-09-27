// The profile keys a composer's loop stands on (issue 477): "set-by" on a status, "external-scheduler", "done-gate" and
// "format". A loop run by a composer such as Horde must not be misread by Jarl's own views: a status only the composer
// may set is refused to jarl set and the MCP tools, next and queue say who schedules instead of computing a ready list,
// done needs a merge the base holds, and a record format this Jarl does not know is refused before anything is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { sh } from './portable.mjs';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const R = await import('../record.mjs');
const CLI = await import('../jarl.mjs');

function run(root, args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}
function jarl(root, ...args) {
  const r = run(root, args);
  if (r.status !== 0) throw new Error(`jarl ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
function refuses(root, ...args) {
  const r = run(root, args);
  assert.notEqual(r.status, 0, `expected a refusal: ${args.join(' ')}`);
  return r.stderr;
}
function file(obj) {
  const f = join(mkdtempSync(join(tmpdir(), 'jarl-keys-file-')), 'profile.json');
  writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
  return f;
}
const reason = (fn) => { try { fn(); } catch (e) { return e.message; } throw new Error('expected a refusal'); };

// A mission's profile in Horde's shape: a proposal and the queue belong to the composer (its planner's veto stands
// between them), a merge is recorded only by its landing, the composer's tick schedules, and an issue closes on a merge
// the base holds, with no approve of Jarl's own.
const HORDE = {
  'jarl-profile': 1,
  format: 1,
  name: 'horde',
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
  'external-scheduler': 'horde.mjs tick',
  'done-gate': { approve: 'none', 'requires-merged': true },
};

// A real repository on main with the loop committed beside the code; the mission's loop lives in a subdirectory,
// as Horde keeps it (.horde/hordes/<h>/.jarl/).
function mission(profile = HORDE) {
  const repo = mkdtempSync(join(tmpdir(), 'jarl-keys-'));
  sh(repo, 'git init -q -b main && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null && mkdir src && echo 1 > src/a.mjs && git add -A && git commit -qm base');
  const root = join(repo, '.horde', 'hordes', 'h1');
  mkdirSync(root, { recursive: true });
  jarl(root, 'init', 'the mission', '--committed', '--profile', file(profile));
  return { repo, root };
}

// ---- the schema ----

test('format: a record format this Jarl does not know is refused first and alone; the known one is accepted', () => {
  const later = reason(() => R.validateProfile({ ...HORDE, format: 2, bogus: true }, 'p'));
  assert.match(later, /written for record format 2, and this Jarl reads format 1/);
  assert.doesNotMatch(later, /bogus/, 'the other keys of a later format are not read at all');
  assert.match(reason(() => R.validateProfile({ ...HORDE, format: '1' }, 'p')), /record format "1"/);
  assert.equal(R.validateProfile(HORDE).format, 1);
  assert.equal(R.DEFAULT_PROFILE.format, 1);
  // A loop opened on a later format refuses every command, the views too.
  const { root } = mission();
  const p = join(root, '.jarl', 'profile.json');
  writeFileSync(p, JSON.stringify({ ...HORDE, format: 7 }));
  assert.match(refuses(root, 'status'), /record format 7/);
  assert.match(refuses(root, 'list'), /record format 7/);
});

test('set-by, external-scheduler and done-gate are checked with every other problem', () => {
  const e = reason(() => R.validateProfile({
    'jarl-profile': 1,
    statuses: { open: { flags: ['dispatchable'], 'set-by': 'nobody' }, run: { flags: ['holds-claim'], who: 1 }, done: ['terminal', 'settles-dependents', 'closes-record'] },
    'external-scheduler': 'two\nlines',
    'done-gate': { approve: 'none', extra: 1 },
  }, 'p'));
  assert.match(e, /status "open": "set-by" is one of any, record/);
  assert.match(e, /status "run": unknown key "who"/);
  assert.match(e, /"external-scheduler" is the one-line command/);
  assert.match(e, /"done-gate": unknown key "extra"/);
  assert.match(e, /"approve": "none" is allowed only with "requires-merged": true/);
  assert.match(reason(() => R.validateProfile({ ...HORDE, 'done-gate': { approve: 'none', 'requires-merged': false } })), /allowed only with "requires-merged": true/);
  assert.match(reason(() => R.validateProfile({ ...HORDE, 'done-gate': { approve: 'fresh', 'requires-merged': 'yes' } })), /"requires-merged" is true or false/);
  assert.match(reason(() => R.validateProfile({ ...HORDE, 'done-gate': 'none' })), /"done-gate" is an object/);
  // A status written as an object with no flags is a status with none; the list form still reads as before.
  const p = R.validateProfile(HORDE);
  assert.deepEqual(p.flagsOf('proposed'), []);
  assert.equal(p.setBy('queued'), 'record');
  assert.equal(p.setBy('running'), 'any');
  assert.equal(p.scheduler, 'horde.mjs tick');
  assert.deepEqual({ ...p.doneGate }, { approve: 'none', 'requires-merged': true });
  assert.deepEqual({ ...R.DEFAULT_PROFILE.doneGate }, { approve: 'fresh', 'requires-merged': false });
  assert.equal(R.DEFAULT_PROFILE.scheduler, null);
});

test('profile describes the new keys, as JSON and as text', () => {
  const { root } = mission();
  const d = json(root, 'profile');
  assert.deepEqual(d.statuses.filter((s) => s.setBy).map((s) => s.name), ['proposed', 'queued', 'merged']);
  assert.equal(d.externalScheduler, 'horde.mjs tick');
  assert.deepEqual(d.doneGate, { approve: 'none', 'requires-merged': true });
  assert.equal(d.format, 1);
  const t = jarl(root, 'profile');
  assert.match(t, /queued {2}dispatchable {2}\(set by the record only, never jarl set\)/);
  assert.match(t, /external scheduler: horde\.mjs tick/);
  assert.match(t, /done gate: approve none · requires a merge in the base/);
});

// ---- set-by: record ----

test('set-by record: jarl set and the MCP tools cannot move an issue into it; a library call can, and moving out is anyone\'s', () => {
  const { root } = mission();
  jarl(root, 'new', 'a ticket');
  const path = R.findIssue(root, '001').file;
  const before = readFileSync(path, 'utf8');
  assert.match(refuses(root, 'set', '001', 'queued'), /queued is set by the record only — this loop's profile \(horde\) marks it "set-by": "record".*\(horde\.mjs tick\)/);
  // The MCP tools run through dispatch as the command line does: jarl_set is refused the same way.
  assert.throws(() => CLI.dispatch(root, 'set', ['001', 'queued'], {}), /queued is set by the record only/);
  assert.throws(() => R.setStatus(root, '001', 'queued', undefined, { caller: 'cli' }), /set by the record only/);
  assert.equal(readFileSync(path, 'utf8'), before, 'a refusal writes nothing');
  // The composer, through record.mjs, moves it; the worker's claim after that is anyone's.
  assert.equal(R.setStatus(root, '001', 'queued').status, 'queued');
  jarl(root, 'set', '001', 'running', '--branch', 'jarl/001-a', '--worker', 'w1');
  assert.equal(R.findIssue(root, '001').status, 'running');
  // Filing is not a move: a new issue lands in a set-by-record initial status.
  assert.equal(R.findIssue(root, jarl(root, 'new', 'another').match(/filed (\d{3})/)[1]).status, 'proposed');
});

// ---- done-gate ----

test('done-gate requires-merged: no merge, or a merge the base does not hold, is refused; approve none asks for no review', () => {
  const { repo, root } = mission();
  jarl(root, 'new', 'ticket');
  R.setStatus(root, '001', 'queued');
  jarl(root, 'set', '001', 'running', '--branch', 'jarl/001-t', '--worker', 'w1');
  jarl(root, 'evidence', '001', '--ran', 'npm test', '--saw', 'pass 1');
  assert.match(reason(() => R.setStatus(root, '001', 'merged')), /001 records no merge — this loop's profile closes an issue only on a landed merge \(done-gate "requires-merged": true\)/);
  // A commit on a side branch, recorded as merged, is not in the base yet.
  sh(repo, 'git checkout -q -b jarl/001-t && echo 2 > src/a.mjs && git commit -qam work && git checkout -q main');
  const side = sh(repo, 'git rev-parse jarl/001-t');
  const rec = R.recordMerged(root, '001', { sha: side, ci: 'none' });
  assert.ok(!rec.notes.some((n) => /FRESH REVIEW/.test(n)), 'with approve none no reviewer is owed, so the merge note does not ask for one');
  assert.match(reason(() => R.setStatus(root, '001', 'merged')), new RegExp(`001 records Merged ${side.slice(0, 12)}\\w*, which is not in the base \\(main in `));
  // Landed: the base holds it. No review was ever recorded, and none is asked for.
  sh(repo, 'git merge -q --ff-only jarl/001-t');
  assert.equal(R.setStatus(root, '001', 'merged').status, 'merged');
  // An unknown sha is refused the same way.
  jarl(root, 'new', 'second');
  R.setStatus(root, '002', 'queued');
  jarl(root, 'set', '002', 'running', '--worker', 'w2');
  jarl(root, 'evidence', '002', '--ran', 'npm test', '--saw', 'pass 2');
  R.recordMerged(root, '002', { sha: 'deadbeef', ci: 'none' });
  assert.match(reason(() => R.setStatus(root, '002', 'merged')), /records Merged deadbeef, which is not in the base/);
});

test('done-gate requires-merged: a composer landing into a branch nobody has checked out names it as base; the command line cannot', () => {
  // Horde lands a ticket into its team branch in a throwaway tree and moves the ref: the checkout stays on main, so the
  // branch checked out is the wrong base, and the composer names the one it landed into.
  const { repo, root } = mission();
  jarl(root, 'new', 'ticket');
  R.setStatus(root, '001', 'queued');
  jarl(root, 'set', '001', 'running', '--branch', 'h1-t001', '--worker', 'w1');
  jarl(root, 'evidence', '001', '--ran', 'land', '--saw', 'green');
  sh(repo, 'git branch h1/team && git checkout -q -b h1-t001 && echo 2 > src/a.mjs && git commit -qam work && git checkout -q h1/team && git merge -q --no-ff -m land h1-t001 && git checkout -q main');
  const landed = sh(repo, 'git rev-parse h1/team');
  R.recordMerged(root, '001', { sha: landed, ci: 'none' });
  assert.match(reason(() => R.setStatus(root, '001', 'merged')), /which is not in the base \(main in /);
  assert.match(reason(() => R.setStatus(root, '001', 'merged', undefined, { base: 'h1/nope' })), /the base h1\/nope is not a branch or commit/);
  // The command line has no --base, and a base handed to dispatch (as an MCP call would) is refused, not honoured.
  assert.match(refuses(root, 'set', '001', 'dropped', 'x', '--base', 'h1/team'), /unknown flag --base/);
  assert.throws(() => CLI.dispatch(root, 'set', ['001', 'dropped', 'x'], { base: 'h1/team' }), /base is named by a library call through record\.mjs only/);
  assert.equal(R.findIssue(root, '001').status, 'running', 'a refusal writes nothing');
  assert.equal(R.setStatus(root, '001', 'merged', undefined, { base: 'h1/team' }).status, 'merged');
});

test('done-gate requires-merged with approve fresh: the landed merge and the fresh approve are both asked for', () => {
  const { repo, root } = mission({ ...HORDE, name: 'both', 'external-scheduler': undefined, 'done-gate': { approve: 'fresh', 'requires-merged': true }, statuses: { ...HORDE.statuses, merged: ['settles-dependents', 'terminal', 'closes-record'] } });
  jarl(root, 'new', 'ticket');
  R.setStatus(root, '001', 'queued');
  jarl(root, 'set', '001', 'running', '--branch', 'jarl/001-t', '--worker', 'w1');
  jarl(root, 'evidence', '001', '--ran', 'npm test', '--saw', 'pass');
  assert.match(refuses(root, 'set', '001', 'merged'), /records no merge/);
  const head = sh(repo, 'git rev-parse HEAD');
  jarl(root, 'merged', '001', '--sha', head, '--ci', 'none');
  assert.match(refuses(root, 'set', '001', 'merged'), /no approving review/);
  jarl(root, 'review', '001', 'approve', '--by', 'fresh-eyes', 'fine');
  assert.match(jarl(root, 'set', '001', 'merged'), /001 → merged/);
});

test('no done-gate: a loop without the key closes exactly as before — no merge asked for', () => {
  const { root } = mission({ ...HORDE, name: 'plain', 'done-gate': undefined, 'external-scheduler': undefined, statuses: { ...HORDE.statuses, merged: ['settles-dependents', 'terminal', 'closes-record'] } });
  jarl(root, 'new', 'ticket');
  R.setStatus(root, '001', 'queued');
  jarl(root, 'set', '001', 'running', '--worker', 'w1');
  jarl(root, 'evidence', '001', '--ran', 'x', '--saw', 'y');
  jarl(root, 'review', '001', 'approve', '--by', 'fresh-eyes', 'fine');
  assert.match(jarl(root, 'set', '001', 'merged'), /001 → merged/);
});

// ---- every view on a mission's loop ----

test('every view tells the truth on a mission\'s loop: next, queue, status, resume, tips, branches, report, list', () => {
  const { repo, root } = mission();
  // 001 merged and landed; 002 in flight on its branch; 003 queued but held back by the composer's own edges (Jarl
  // cannot see them); 004 proposed; 005 dropped.
  for (const t of ['landed one', 'in flight', 'queued', 'proposed', 'gone']) jarl(root, 'new', t);
  R.setStatus(root, '001,002,003,005', 'queued');
  sh(repo, 'git checkout -q -b jarl/001-landed && echo 2 > src/a.mjs && git commit -qam one && git checkout -q main && git merge -q --ff-only jarl/001-landed');
  jarl(root, 'set', '001', 'running', '--branch', 'jarl/001-landed', '--worker', 'w1');
  jarl(root, 'evidence', '001', '--ran', 'gate', '--saw', 'green');
  R.recordMerged(root, '001', { sha: sh(repo, 'git rev-parse HEAD'), ci: 'none' });
  R.setStatus(root, '001', 'merged');
  sh(repo, 'git checkout -q -b jarl/002-flight && echo 3 > src/b.mjs && git add src/b.mjs && git commit -qm two && git checkout -q main');
  jarl(root, 'set', '002', 'running', '--branch', 'jarl/002-flight', '--worker', 'w2');
  jarl(root, 'set', '005', 'dropped', 'out of scope');

  // next and queue: the composer schedules, Jarl computes nothing.
  assert.equal(jarl(root, 'next'), 'scheduling is led by the composer: horde.mjs tick');
  assert.deepEqual(json(root, 'next'), { scheduler: 'horde.mjs tick', note: 'scheduling is led by the composer: horde.mjs tick' });
  assert.equal(jarl(root, 'queue'), 'scheduling is led by the composer: horde.mjs tick');
  assert.deepEqual(json(root, 'queue').repos, []);

  // status: the counts by status, no ready count of Jarl's own.
  const st = json(root, 'status');
  assert.equal(st.ready, null);
  assert.equal(st.scheduler, 'horde.mjs tick');
  assert.deepEqual(st.statuses, { proposed: 1, queued: 1, running: 1, landed: 0, changes: 0, held: 0, merged: 1, dropped: 1 });
  assert.equal(st.inFlight, 1);
  const stText = jarl(root, 'status');
  assert.match(stText, /^goal: the mission\n.*profile horde\nqueued 1 · in flight 1 · proposed 1 · held 0 · merged 1 · dropped 1 · questions 0/);
  assert.match(stText, /scheduling is led by the composer: horde\.mjs tick/);
  assert.match(stText, /closed on a merge in the base, no approve required/);
  assert.doesNotMatch(stText, /ready/);

  // resume: in flight is true, the ready list and the merge queue are the composer's.
  const rs = json(root, 'resume');
  assert.deepEqual(rs.inFlight.map((x) => [x.id, x.branch, x.worker]), [['002', 'jarl/002-flight', 'w2']]);
  assert.deepEqual(rs.next, []);
  assert.equal(rs.readyTotal, null);
  assert.deepEqual(rs.held, []);
  assert.equal(rs.scheduler, 'horde.mjs tick');
  const rsText = jarl(root, 'resume');
  assert.match(rsText, /## Next ready and merge queue\n- scheduling is led by the composer: horde\.mjs tick/);
  assert.doesNotMatch(rsText, /## Next ready \(|## Merge queue|nothing ready/);

  // tips: the feature branch of the work in flight and the base, in the repository the loop lives in.
  const tips = json(root, 'tips');
  assert.equal(tips.repos.length, 1);
  const rows = tips.repos[0].rows.map((r) => [r.role, r.branch, r.issues || []]);
  assert.deepEqual(rows, [['feature', 'jarl/002-flight', ['002']], ['release', 'main', []]]);

  // branches: the landed branch is done and deletable, the one in flight is not.
  const br = Object.fromEntries(json(root, 'branches').map((b) => [b.branch, b]));
  assert.equal(br['jarl/001-landed'].done, 'delete');
  assert.deepEqual(br['jarl/001-landed'].issues, ['001']);
  assert.equal(br['jarl/002-flight'].done, null);

  // report: merged is the done work, with the merge it closed on; dropped with its reason; the rest still open.
  const rp = json(root, 'report');
  assert.equal(rp.done, 1);
  assert.equal(rp.dropped, 1);
  assert.equal(rp.left, 3);
  assert.deepEqual(rp.statuses, st.statuses);
  assert.equal(rp.issues.find((i) => i.id === '001').merged, sh(repo, 'git rev-parse HEAD'));
  assert.match(rp.text, /## Done \(1\)\nclosed on a merge in the base, no approve required \(this loop's done gate\)/);
  assert.match(rp.text, /## Dropped \(1\)\n- 005 gone — out of scope/);
  assert.match(rp.text, /## Still open \(3\)\n- 002 in flight \(running\)\n- 003 queued \(queued\)\n- 004 proposed \(proposed\)/);

  // list: the unfinished ones, by the profile's statuses.
  assert.deepEqual(json(root, 'list').map((i) => [i.id, i.status]), [['002', 'running'], ['003', 'queued'], ['004', 'proposed']]);
});

test('no profile: next is still the list and queue the rows, with no scheduler key anywhere', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-keys-plain-'));
  mkdirSync(join(root, '.git'));
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'one');
  assert.ok(Array.isArray(json(root, 'next')));
  const st = json(root, 'status');
  assert.equal(st.ready, 1);
  assert.equal('scheduler' in st, false);
  const rs = json(root, 'resume');
  assert.equal(rs.readyTotal, 1);
  assert.equal('scheduler' in rs, false);
  assert.equal('scheduler' in json(root, 'queue'), false);
});
