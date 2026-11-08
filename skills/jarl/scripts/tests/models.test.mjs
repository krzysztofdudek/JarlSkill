// The record keeps the model of every worker and reviewer: the lease and the verdict lines, the tiers and the
// loop's model lines, the notes (command line only, only in a loop with model lines), and the read-only views that
// derive from them: `models`, the marks on `next` and `resume`. Every line written here is read by the pinned frozen reader
// (tests/old-jarl.mjs) without a refusal and without a silent misreading, so the record format is not raised.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, cpSync, renameSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as R from '../record.mjs';
import { OLD_JARL_FILE, fileAsBefore, formatTwoJarl, formatTwoJarlIsPinned, oldJarlIsPinned, oldJarl } from './old-jarl.mjs';
import { spawnJarl, loop as makeLoop, SPAWN_TIMEOUT } from './helpers.mjs';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const L = await import('../jarl-lib.mjs');
const J = await import('../jarl.mjs');
const OLD = await import(pathToFileURL(OLD_JARL_FILE).href);

const BIG = 'big-model@high';
const MID = 'mid-model';
const SMALL = 'small-model';
const LINES = `\nModel (strong): ${BIG}\nModel (standard): ${MID}, mid-other\nModel (light): ${SMALL}\n`;

const loop = ({ lines = false } = {}) => {
  const root = makeLoop({ prefix: 'jarl-models-', goal: 'a goal' });
  if (lines) appendFileSync(join(root, '.jarl', 'goal.md'), LINES);
  return root;
};
const log = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const issueText = (root, id) => readFileSync(L.findIssue(root, id).file, 'utf8');
const cli = (root, ...args) => spawnJarl(root, args);

let seq = 0;
// One finished unit of work: filed, leased with a model, one evidence row, `changes` reviews, an approve, done.
function unit(root, { model, worker = 'w-x', reviewer = 'rev-big', reviewerModel = BIG, kind = 'bug', tier = 'standard', changes = 0, repo } = {}) {
  seq += 1;
  const { id } = R.newIssue(root, `unit ${seq}`, { kind, tier, acceptance: 'it works', ...(repo ? { repo } : {}) });
  R.setStatus(root, id, 'in-progress', '', { branch: `jarl/${id}-x`, worker, ...(model ? { model } : {}) });
  R.addEvidence(root, id, undefined, { ran: 'npm test', saw: 'pass 3' });
  for (let k = 0; k < changes; k += 1) R.review(root, id, 'changes', 'Important: the case is not handled', { by: reviewer, ...(reviewerModel ? { model: reviewerModel } : {}) });
  R.review(root, id, 'approve', 'read the diff, nothing found', { by: reviewer, ...(reviewerModel ? { model: reviewerModel } : {}) });
  R.recordMerged(root, id, { sha: 'abc1234' }); R.setStatus(root, id, 'done', 'merged', {});
  return id;
}
function units(root, n, opts, changed = 0) { for (let k = 0; k < n; k += 1) unit(root, { ...opts, changes: k < changed ? 1 : 0 }); }

// ---- the record ------------------------------------------------------------------------------------

test('set in-progress --model writes the Model field and the model before the worker in the lease line; leaving removes the field', () => {
  const root = loop();
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works' });
  const out = R.setStatus(root, id, 'in-progress', 'start', { branch: 'jarl/001-a', worker: 'w-one', model: '  claude-sonnet-5-5@high ', worktree: join(root, 'wt') });
  assert.equal(out.model, 'claude-sonnet-5-5@high', 'stored as given, trimmed');
  assert.match(issueText(root, id), /^\*\*Model:\*\* claude-sonnet-5-5@high$/m);
  assert.match(log(root), /001 → in-progress · start · branch jarl\/001-a · model claude-sonnet-5-5@high · worker w-one\n/, 'the record library accepts a worktree key and stores none');
  assert.doesNotMatch(issueText(root, id), /\*\*Worktree:\*\*/);
  R.setStatus(root, id, 'open', '', {});
  assert.doesNotMatch(issueText(root, id), /\*\*Model:\*\*/, 'removed with Worker');
  assert.doesNotMatch(issueText(root, id), /\*\*Worker:\*\*/);
});

test('a takeover with another worker and no model does not keep the old model on the issue', () => {
  const root = loop();
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works' });
  R.setStatus(root, id, 'in-progress', '', { branch: 'jarl/001-a', worker: 'w-one', model: MID });
  R.setStatus(root, id, 'in-progress', 'taken over', { branch: 'jarl/001-a', worker: 'w-two', handover: true });
  assert.doesNotMatch(issueText(root, id), /\*\*Model:\*\*/, 'the model belonged to w-one');
  assert.match(issueText(root, id), /^\*\*Worker:\*\* w-two$/m);
});

test('--model goes with in-progress only, needs a value and cannot hold the line separator', () => {
  const root = loop();
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works' });
  assert.throws(() => R.setStatus(root, id, 'deferred', 'later', { model: MID }), /--model goes with in-progress only/);
  assert.throws(() => R.setStatus(root, id, 'in-progress', '', { worker: 'w', model: '   ' }), /--model needs a value/);
  assert.throws(() => R.setStatus(root, id, 'in-progress', '', { worker: 'w', model: 'a · worker b' }), /one value/);
});

test('a --worker or --branch value that holds the line separator is refused, so no name can be read as a model', () => {
  const root = loop();
  const id = fileAsBefore(root, 'a thing', { acceptance: 'it works' });
  const before = log(root);
  for (const bad of ['w-c · model evil', 'w-c ·  model evil', '· model evil', 'w-c · model evil ·']) {
    assert.throws(() => R.setStatus(root, id, 'in-progress', '', { branch: 'jarl/001-a', worker: bad }), /--worker is one name/, `worker ${bad}`);
    assert.throws(() => R.setStatus(root, id, 'in-progress', '', { branch: bad, worker: 'w-c' }), /--branch is one name/, `branch ${bad}`);
  }
  assert.equal(log(root), before, 'a refused lease writes nothing');
  assert.equal(L.findIssue(root, id).fields.status, 'open');
  R.setStatus(root, id, 'in-progress', '', { branch: 'jarl/001-a', worker: 'w-c·model·ok' });
  assert.doesNotMatch(log(root), / · model /, 'a name with the dot inside it, without spaces, is no separator');
  const read = oldJarl(root, 'list', {});
  assert.equal(read.ok, true, 'the frozen reader reads the log as it stands');
});

test('review --model [--relayed] writes the model and the relay mark after the kind, in the log line and in the Reviews entry', () => {
  const root = loop();
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works' });
  R.setStatus(root, id, 'in-progress', '', { branch: 'jarl/001-a', worker: 'w-one', model: MID });
  const out = R.review(root, id, 'approve', 'read the diff, found nothing', { by: 'rev-c', model: ` ${BIG} `, relayed: true });
  assert.equal(out.model, BIG);
  assert.equal(out.relayed, true);
  assert.match(log(root), /001 review approve · by rev-c \(fresh\) · model big-model@high · relayed · read the diff, found nothing/);
  assert.match(issueText(root, id), /^- \*\*approve\*\* · by rev-c \(fresh\) · \d{4}-\d{2}-\d{2} · model big-model@high · relayed$/m);
  R.review(root, id, 'approve', 'a second look, nothing found', { by: 'rev-d', model: SMALL });
  assert.match(log(root), /001 review approve · by rev-d \(fresh\) · model small-model · a second look, nothing found/);
  assert.match(issueText(root, id), /^- \*\*approve\*\* · by rev-d \(fresh\) · \d{4}-\d{2}-\d{2} · model small-model$/m);
  const bare = R.review(root, id, 'approve', 'a third look, nothing found', { by: 'rev-e' });
  assert.equal(bare.model, undefined, 'no model given, none reported');
  assert.match(log(root), /001 review approve · by rev-e \(fresh\) · a third look, nothing found/);
  assert.throws(() => R.review(root, id, 'approve', 'a fourth look, nothing found', { by: 'rev-f', model: '  ' }), /--model needs a value/);
});

test('record.mjs takes model and relayed as optional keys, and jarl-record/1 is still a contract it keeps', () => {
  assert.ok(R.RECORD_APIS.includes('jarl-record/1'));
  const root = loop();
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works' });
  const lease = R.setStatus(root, id, 'in-progress', '', { branch: 'jarl/001-a', worker: 'w-one' });
  assert.equal(lease.model, undefined, 'without the key, nothing changes');
  assert.match(log(root), /001 → in-progress · branch jarl\/001-a · worker w-one$/m);
});

test('the command line and the tables carry --model and --relayed', () => {
  assert.equal(J.COMMAND_FLAGS.set.model, 'value');
  assert.equal(J.COMMAND_FLAGS.review.model, 'value');
  assert.equal(J.COMMAND_FLAGS.review.relayed, 'bool');
  assert.ok(J.COMMAND_FLAGS.models && J.COMMAND_ARGS.models && J.COMMAND_SUMMARY.models, 'models is a command of the tables');
  assert.equal(J.MUTATING.has('models'), false, 'a read-only view takes no lock');
  const root = loop();
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works' });
  assert.equal(cli(root, 'set', id, 'in-progress', 'go', '--branch', 'jarl/001-a', '--worker', 'w-one', '--model', MID).status, 0);
  const r = cli(root, 'review', id, 'approve', '--by', 'rev-c', '--model', BIG, '--relayed', 'read the diff, found nothing');
  assert.equal(r.status, 0, r.stderr);
  assert.match(log(root), /001 review approve · by rev-c \(fresh\) · model big-model@high · relayed · /);
});

// ---- the frozen reader ------------------------------------------------------------------------------

test('the frozen reader reads the lease line with the model before the worker, the verdict line with model and relayed, and Tier light, without the format being raised', () => {
  assert.ok(oldJarlIsPinned());
  const root = loop();
  const id = fileAsBefore(root, 'a thing', { acceptance: 'it works' });
  assert.equal(cli(root, 'field', id, 'Tier', 'light').status, 0);
  R.setStatus(root, id, 'in-progress', 'go', { branch: 'jarl/001-a', worker: 'w-five', model: 'claude-sonnet-5-5@high' });
  // The frozen reader finds the worker of the lease, whatever the model before it says.
  assert.equal(OLD.findIssue(root, id).fields.worker, 'w-five');
  assert.throws(() => OLD.cmdReview(root, id, 'approve', 'Minor: nothing to add here', { by: 'w-five' }), /self-approve/, 'the self-approve is refused');
  R.addEvidence(root, id, undefined, { ran: 'npm test', saw: 'pass' });
  R.review(root, id, 'approve', 'read the diff, found nothing', { by: 'rev-c', model: 'claude-opus-5-5', relayed: true });
  const gate = OLD.gateState(root, id);
  assert.equal(gate.approved, true);
  assert.equal(gate.live.kind, 'fresh', 'the verdict is fresh');
  assert.equal(gate.live.by, 'rev-c');
  OLD.cmdSet(root, id, 'done', 'merged', {});
  assert.equal(OLD.findIssue(root, id).status, 'done', 'done passes');
  for (const command of ['list', 'status', 'next', 'queue']) assert.equal(oldJarl(root, command, {}).ok, true, command);
  assert.equal(existsSync(join(root, '.jarl', 'profile.json')), false, 'no marker: nothing here is misread in silence, so the format stays');
  assert.equal(R.loadProfile(root).format, 1);
});

test('the other order would have been misread: the model after the worker makes the frozen reader accept the worker as its own reviewer (why the order matters)', () => {
  const root = loop();
  const id = fileAsBefore(root, 'a thing', { acceptance: 'it works' });
  appendFileSync(join(root, '.jarl', 'log.md'), `- 2026-10-18 10:00 · ${id} → in-progress · go · branch jarl/001-a · worker w-six · model m\n`);
  const text = issueText(root, id).replace('**Status:** open', '**Status:** in-progress');
  writeFileSync(L.findIssue(root, id).file, text);
  OLD.cmdReview(root, id, 'approve', 'Minor: nothing to add here', { by: 'w-six' });
});

// ---- tiers and the loop's model lines ---------------------------------------------------------------

test('the built-in tiers are light, standard, strong, weakest first, and standard is the default', () => {
  assert.deepEqual(L.TIERS, ['light', 'standard', 'strong']);
  const root = loop();
  const p = R.loadProfile(root);
  assert.deepEqual(p.tiers, ['light', 'standard', 'strong']);
  assert.equal(p.tierDefault, 'standard');
  const a = R.newIssue(root, 'no tier named', {});
  assert.match(issueText(root, a.id), /^\*\*Tier:\*\* standard$/m);
  const b = R.newIssue(root, 'a light one', { tier: 'light' });
  assert.match(issueText(root, b.id), /^\*\*Tier:\*\* light$/m);
  assert.throws(() => R.newIssue(root, 'bad', { tier: 'heavy' }), /--tier must be one of: light, standard, strong/);
});

test('a profile keeps its declared tiers in their declared order', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-models-'));
  mkdirSync(join(root, '.git'));
  const file = join(root, 'p.json');
  writeFileSync(file, JSON.stringify({ 'jarl-profile': 1, name: 'x', statuses: J.BUILTIN_STATUSES, fields: { Tier: { enum: ['small', 'big', 'huge'] } } }));
  R.initLoop(root, 'a goal', { profile: file });
  const p = R.loadProfile(root);
  assert.deepEqual(p.tiers, ['small', 'big', 'huge']);
  appendFileSync(join(root, '.jarl', 'goal.md'), '\nModel (huge): h1\nModel (small): s1, s2\n');
  const lines = L.modelLines(root);
  assert.equal(lines.rank('s1'), 0);
  assert.equal(lines.rank('h1'), 2);
  assert.equal(lines.defaultOf('small'), 's1');
});

test('Model (<tier>) lines are read like Check lines: plain, list item, bold; the first is the default, the tier order ranks, an unlisted model is unplaced', () => {
  const root = loop();
  appendFileSync(join(root, '.jarl', 'goal.md'), '\n- Model (light): l-1, l-2\n**Model (standard):** `s-1`, s-2@low\nmodel (strong): x-1@high\nModel (nonsense): ignored-1\n');
  const lines = L.modelLines(root);
  assert.equal(lines.declared, true);
  assert.deepEqual(lines.byTier, { light: ['l-1', 'l-2'], standard: ['s-1', 's-2@low'], strong: ['x-1@high'] });
  assert.equal(lines.defaultOf('standard'), 's-1');
  assert.equal(lines.defaultOf('strong'), 'x-1@high');
  assert.ok(lines.rank('l-2') < lines.rank('s-1') && lines.rank('s-1') < lines.rank('x-1@high'));
  assert.equal(lines.rank('s-2@low'), lines.rank('s-1'));
  assert.equal(lines.rank('s-2@high'), lines.rank('s-1'), 'the same id at another effort sits where the id sits');
  assert.equal(lines.rank('ignored-1'), -1, 'a line naming no tier of the loop places nothing');
  assert.equal(lines.rank('stranger'), -1, 'unplaced ranks below every placed one');
  assert.equal(L.modelLines(loop()).declared, false);
});

// ---- the notes: the command line only, only in a loop with model lines ---------------------------------

function notes(root, cmd, rest, flags) { return J.dispatch(root, cmd, rest, flags).warn.join('\n'); }

test('notes on a lease and on a verdict without --model, and on an approve of the same model or a lower rank, only in a loop with model lines', () => {
  const root = loop({ lines: true });
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works', tier: 'strong' });
  assert.match(notes(root, 'set', [id, 'in-progress', 'go'], { branch: 'jarl/001-a', worker: 'w-one' }), /no --model/, 'a lease without a model');
  assert.doesNotMatch(notes(root, 'set', [id, 'in-progress', 'go'], { branch: 'jarl/001-a', worker: 'w-one', model: BIG }), /--model/);
  R.addEvidence(root, id, undefined, { ran: 'npm test', saw: 'pass' });
  assert.match(notes(root, 'review', [id, 'changes', 'Important: the case is missing'], { by: 'rev-1' }), /no --model/, 'a verdict without a model');
  assert.match(notes(root, 'review', [id, 'approve', 'read it all, nothing found'], { by: 'rev-2', model: BIG }), /same model as the worker's/, 'the worker model leased on the issue');
  assert.match(notes(root, 'review', [id, 'approve', 'read it all, nothing found'], { by: 'rev-3', model: SMALL }), /ranks below the worker's model/, 'a lower rank');
  assert.match(notes(root, 'review', [id, 'approve', 'read it all, nothing found'], { by: 'rev-4', model: 'stranger-1' }), /unplaced|ranks below/, 'an unplaced reviewer ranks below every placed one');
  assert.equal(notes(root, 'review', [id, 'approve', 'read it all, nothing found'], { by: 'rev-5', model: 'big-model@low' }), '', 'another value of the same rank is neither the same model nor a lower one');
});

test('no note at all in a loop without model lines', () => {
  const root = loop();
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works' });
  assert.equal(notes(root, 'set', [id, 'in-progress', 'go'], { branch: 'jarl/001-a', worker: 'w-one' }), '');
  R.addEvidence(root, id, undefined, { ran: 'npm test', saw: 'pass' });
  assert.equal(notes(root, 'review', [id, 'approve', 'read it all, nothing found'], { by: 'rev-1' }), '');
  assert.equal(notes(root, 'review', [id, 'approve', 'read it all, nothing found'], { by: 'rev-2', model: MID }), '');
});

test('a library caller gets no note and its results do not change', () => {
  const root = loop({ lines: true });
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works' });
  const lease = R.setStatus(root, id, 'in-progress', 'go', { branch: 'jarl/001-a', worker: 'w-one' });
  assert.equal(lease.note, undefined);
  const v = R.review(root, id, 'approve', 'read it all, nothing found', { by: 'rev-1' });
  assert.equal(v.note, undefined);
  assert.deepEqual(Object.keys(v).sort(), ['acceptance', 'by', 'id', 'kind', 'severities', 'verdict']);
  const made = R.newIssue(root, 'another', {});
  assert.equal(made.note, undefined);
});

test('a lease that names another spelling of a model the record holds says which spelling the record holds; the spelling the record holds, and a library call, say nothing', () => {
  const root = loop();
  const first = R.newIssue(root, 'first', { acceptance: 'it works' }).id;
  const second = R.newIssue(root, 'second', { acceptance: 'it works' }).id;
  const third = R.newIssue(root, 'third', { acceptance: 'it works' }).id;
  const fourth = R.newIssue(root, 'fourth', { acceptance: 'it works' }).id;
  assert.equal(notes(root, 'set', [first, 'in-progress', 'go'], { branch: 'jarl/001-a', worker: 'w-one', model: 'claude-opus-5-5' }), '', 'nothing held yet, so nothing to compare with');
  assert.match(notes(root, 'set', [second, 'in-progress', 'go'], { branch: 'jarl/002-b', worker: 'w-two', model: 'claude-opus-5.5' }), /claude-opus-5\.5 is another spelling of claude-opus-5-5, which the record holds; models counts both as one model\./);
  assert.equal(notes(root, 'set', [third, 'in-progress', 'go'], { branch: 'jarl/003-c', worker: 'w-three', model: 'claude-opus-5-5' }), '', 'the spelling the record holds is not another one');
  assert.equal(R.setStatus(root, fourth, 'in-progress', 'go', { branch: 'jarl/004-d', worker: 'w-four', model: 'claude-opus-5.5' }).note, undefined, 'a library call gets no note');
});

test('a review that names another spelling of a model the record holds says which spelling the record holds, on the command line and in a loop with no model lines', () => {
  const root = loop();
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works' });
  R.setStatus(root, id, 'in-progress', '', { branch: 'jarl/001-a', worker: 'w-one', model: 'claude-opus-5-5' });
  R.addEvidence(root, id, undefined, { ran: 'npm test', saw: 'pass' });
  assert.match(notes(root, 'review', [id, 'approve', 'read it all, nothing found'], { by: 'rev-1', model: 'claude-opus-5.5' }), /claude-opus-5\.5 is another spelling of claude-opus-5-5, which the record holds; models counts both as one model\./);
  assert.equal(notes(root, 'review', [id, 'approve', 'read it all, nothing found'], { by: 'rev-2', model: 'claude-opus-5-5' }), '', 'a spelling the record holds says nothing');
  assert.equal(R.review(root, id, 'approve', 'read it all, nothing found', { by: 'rev-3', model: 'claude-opus-5.5' }).note, undefined, 'a library call gets no note');
});

test('new without --tier says on the command line which tier it used and the criteria; with --tier, or from the library, nothing', () => {
  const root = loop();
  const w = notes(root, 'new', ['a thing'], {});
  assert.match(w, /tier standard/);
  assert.match(w, /light: a check or test decides/);
  assert.match(w, /strong: unknown cause/);
  assert.equal(w.split('\n').filter((l) => l.includes('no --tier given')).length, 1, 'the tier note is one line');
  assert.equal(notes(root, 'new', ['another thing'], { tier: 'strong', kind: 'bug', prio: '2' }), '');
  assert.equal(R.newIssue(root, 'third', {}).note, undefined);
  const real = cli(root, 'new', 'fourth thing');
  assert.equal(real.status, 0);
  assert.match(real.stderr, /tier standard/);
});

test('new without --kind or --prio says on the command line that each was defaulted and names the flag; with both, neither', () => {
  const root = loop();
  const w = notes(root, 'new', ['a film'], { tier: 'standard' });
  assert.match(w, /no --kind given, so kind bug was recorded/);
  assert.match(w, /name it with --kind/);
  assert.match(w, /no --prio given, so priority 2 was recorded/);
  assert.match(w, /name it with --prio/);
  assert.equal(notes(root, 'new', ['another film'], { tier: 'standard', kind: 'bug', prio: '1' }), '');
  const real = cli(root, 'new', 'fourth film', '--tier', 'standard');
  assert.equal(real.status, 0);
  assert.match(real.stderr, /--kind/);
  assert.match(real.stderr, /--prio/);
  const named = cli(root, 'new', 'fifth film', '--tier', 'standard', '--kind', 'bug', '--prio', '1');
  assert.equal(named.status, 0);
  assert.doesNotMatch(named.stderr, /--kind|--prio/);
});

test('the third round prints a takeover block that says to raise the fresh worker one tier up or on another model than the one that failed', () => {
  const root = loop();
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works', tier: 'standard' });
  R.setStatus(root, id, 'in-progress', '', { branch: 'jarl/001-a', worker: 'w-one', model: MID });
  R.addRound(root, id, 'red one');
  R.addRound(root, id, 'red two');
  const r = R.addRound(root, id, 'red three');
  assert.equal(r.takeover, true);
  assert.match(r.block, /one tier up from standard \(to strong\), or put it on a model other than mid-model/);
});

test('the takeover advice from the strong tier names another model or a changed approach, never a tier above strong', () => {
  const root = loop();
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works', tier: 'strong' });
  R.setStatus(root, id, 'in-progress', '', { branch: 'jarl/001-a', worker: 'w-one', model: MID });
  R.addRound(root, id, 'red one');
  R.addRound(root, id, 'red two');
  const r = R.addRound(root, id, 'red three');
  assert.match(r.block, /strong is the top tier/);
  assert.match(r.block, /a model other than mid-model, or change the approach/);
  assert.doesNotMatch(r.block, /tier up/);
});

test('a takeover starts a new count: the block comes once per takeover, not on every round after the third', () => {
  const root = loop();
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works', tier: 'standard' });
  R.setStatus(root, id, 'in-progress', '', { branch: 'jarl/001-a', worker: 'w-one', model: MID });
  const seen = [1, 2, 3, 4, 5, 6, 7].map((k) => R.addRound(root, id, `red ${k}`));
  assert.deepEqual(seen.map((r) => r.takeover), [false, false, true, false, false, true, false]);
  assert.deepEqual(seen.map((r) => r.block === null), [true, true, false, true, true, false, true]);
  assert.deepEqual(seen.map((r) => r.since), [1, 2, 3, 1, 2, 3, 1]);
  const out = cli(root, 'round', id, 'red 8').stdout;
  assert.match(out, /round 8: 2 of 3 before a takeover; the rounds so far: show /);
  assert.doesNotMatch(out, /## Takeover/);
});

// An in-progress issue of a kind, in a loop whose goal carries the given lines.
// Filed with three digits and no key (fileAsBefore), as the frozen reader of format 1 reads it.
function leased(goalLines, kind) {
  const root = loop();
  if (goalLines) appendFileSync(join(root, '.jarl', 'goal.md'), `\n${goalLines}\n`);
  const id = fileAsBefore(root, `a ${kind} thing`, { acceptance: 'it works', tier: 'standard', kind });
  R.setStatus(root, id, 'in-progress', '', { branch: `jarl/${id}-a`, worker: 'w-one', model: MID });
  return { root, id };
}

test('a goal line sets the red rounds after which a kind of issue takes over, and the other kinds keep three', () => {
  const { root, id } = leased('Takeover (docs): 2', 'docs');
  const first = R.addRound(root, id, 'red one');
  assert.equal(first.takeover, false);
  assert.equal(first.limit, 2);
  const second = R.addRound(root, id, 'red two');
  assert.equal(second.takeover, true);
  assert.match(second.block, /a prior worker attempted issue \S+ 2 times/i);
  assert.match(second.block, /has failed this 2 times/);
  assert.equal(R.addRound(root, id, 'red three').since, 1);
  assert.equal(R.addRound(root, id, 'red four').takeover, true);
  const other = leased('Takeover (docs): 2', 'bug');
  const rounds = [1, 2, 3].map((k) => R.addRound(other.root, other.id, `red ${k}`));
  assert.deepEqual(rounds.map((r) => [r.takeover, r.limit]), [[false, 3], [false, 3], [true, 3]]);
});

test('a loop without a takeover line keeps three, and a bare line sets the limit of every kind the loop does not name', () => {
  const plain = leased(null, 'docs');
  assert.deepEqual([1, 2, 3].map((k) => R.addRound(plain.root, plain.id, `red ${k}`)).map((r) => [r.takeover, r.limit]), [[false, 3], [false, 3], [true, 3]]);
  const bare = leased('Takeover: 4\nTakeover (docs): 2', 'gap');
  assert.deepEqual([1, 2, 3, 4].map((k) => R.addRound(bare.root, bare.id, `red ${k}`)).map((r) => [r.takeover, r.limit]), [[false, 4], [false, 4], [false, 4], [true, 4]]);
});

test('round prints how many rounds are left before a takeover by the limit of the issue\'s kind', () => {
  const { root, id } = leased('- **Takeover (Docs):** 2', 'docs');
  assert.match(cli(root, 'round', id, 'red one').stdout, /round 1: 1 of 2 before a takeover/);
  assert.match(cli(root, 'round', id, 'red two').stdout, /round 2 — takeover:/);
});

test('goal --set writes a takeover line for a kind the profile declares and refuses what is not a count of rounds', () => {
  const root = loop();
  const set = (line) => cli(root, 'goal', '--set', line);
  assert.equal(set('Takeover (DOCS): 2').status, 0);
  assert.match(readFileSync(join(root, '.jarl', 'goal.md'), 'utf8'), /^Takeover \(docs\): 2$/m);
  assert.equal(set('Takeover (docs): 5').status, 0);
  assert.match(readFileSync(join(root, '.jarl', 'goal.md'), 'utf8'), /^Takeover \(docs\): 5$/m);
  assert.match(log(root), /goal line changed · Takeover \(docs\): 5 · was 2/);
  assert.equal(set('Takeover: 4').status, 0);
  assert.match(set('Takeover (poetry): 2').stderr, /the profile declares no kind "poetry"/);
  assert.match(set('Takeover (docs): 0').stderr, /whole number of rounds/);
  assert.match(set('Takeover (docs): many').stderr, /whole number of rounds/);
});

test('init says once, on the command line, that a goal with no Model line places no model, with the form that adds one', () => {
  const fresh = () => { const dir = mkdtempSync(join(tmpdir(), 'jarl-models-init-')); mkdirSync(join(dir, '.git')); return dir; };
  const bare = fresh();
  const said = cli(bare, 'init', 'a goal with no model');
  assert.equal(said.status, 0, said.stderr);
  assert.match(said.stderr, /^note: the goal declares no Model line \("Model \(<tier>\): <model-id>"\), so models places no model and ranks none until it does — add one for each tier: jarl\.mjs goal --set "<machine-line>" --root /m);
  const named = fresh();
  assert.doesNotMatch(cli(named, 'init', `a goal${LINES}`).stderr, /Model line/);
  const lib = fresh();
  assert.equal(R.initLoop(lib, 'a library goal').modelNote, undefined, 'a library caller is told nothing');
  // The form it prints works: a line given through it is a Model line, and models then reads it.
  assert.equal(cli(bare, 'goal', '--set', 'Model (strong): big-model').status, 0);
  assert.doesNotMatch(cli(bare, 'models').stdout, /declares no Model/);
});

test('a limit lowered below the rounds already counted gives the takeover at the next round', () => {
  const { root, id } = leased(null, 'docs');
  assert.equal(R.addRound(root, id, 'red one').takeover, false);
  assert.equal(R.addRound(root, id, 'red two').takeover, false);
  assert.equal(cli(root, 'goal', '--set', 'Takeover (docs): 2').status, 0);
  const third = R.addRound(root, id, 'red three');
  assert.deepEqual([third.takeover, third.limit, third.since], [true, 2, 3]);
  assert.match(third.block, /attempted issue \S+ 3 times \(3 rounds in all\)/);
  const next = R.addRound(root, id, 'red four');
  assert.deepEqual([next.takeover, next.since], [false, 1]);
  assert.equal(R.addRound(root, id, 'red five').takeover, true);
});

test('a limit raised after rounds are counted waits for the count to reach it, and the count restarts at each takeover', () => {
  const { root, id } = leased('Takeover (docs): 2', 'docs');
  assert.equal(R.addRound(root, id, 'red one').takeover, false);
  assert.equal(R.addRound(root, id, 'red two').takeover, true);
  assert.equal(R.addRound(root, id, 'red three').takeover, false);
  assert.equal(cli(root, 'goal', '--set', 'Takeover (docs): 4').status, 0);
  const rounds = [4, 5, 6].map((k) => R.addRound(root, id, `red ${k}`));
  assert.deepEqual(rounds.map((r) => [r.takeover, r.since, r.limit]), [[false, 2, 4], [false, 3, 4], [true, 4, 4]]);
  assert.match(cli(root, 'round', id, 'red seven').stdout, /round 7: 1 of 4 before a takeover/);
});

test('a limit of one reads as one time, and the takeover comes at every round', () => {
  const { root, id } = leased('Takeover (docs): 1', 'docs');
  const first = R.addRound(root, id, 'red one');
  assert.equal(first.takeover, true);
  assert.match(first.block, /has failed this 1 time\./);
  assert.match(first.block, /attempted issue \S+ 1 time \(1 round in all\)/);
});

const goalFile = (root) => join(root, '.jarl', 'goal.md');
// A Takeover line set in goal.md by hand, the way a person edits the goal: the line of that kind replaced where it
// stands, or added at the end. No log line says so.
function byHand(root, line) {
  const label = line.slice(0, line.indexOf(':') + 1);
  const text = readFileSync(goalFile(root), 'utf8');
  const at = text.split('\n').findIndex((l) => l.startsWith(label));
  writeFileSync(goalFile(root), at === -1 ? `${text.trimEnd()}\n${line}\n` : text.split('\n').map((l, k) => (k === at ? line : l)).join('\n'));
}
// The rounds of one issue as [takeover, since, limit], with the goal changed before the round where `changes` says so.
function roundsWith(root, id, count, changes, change) {
  const seen = [];
  for (let k = 1; k <= count; k += 1) {
    if (changes[k]) change(root, changes[k]);
    const r = R.addRound(root, id, `red ${k}`);
    seen.push([r.takeover, r.since, r.limit]);
  }
  return seen;
}
const viaGoalSet = (root, line) => assert.equal(cli(root, 'goal', '--set', line).status, 0);

test('a takeover line edited by hand counts like one set by goal --set: the limit is read from the goal at the next round', () => {
  for (const change of [byHand, viaGoalSet]) {
    const { root, id } = leased(null, 'docs');
    const seen = roundsWith(root, id, 4, { 3: 'Takeover (docs): 2' }, change);
    assert.deepEqual(seen, [[false, 1, 3], [false, 2, 3], [true, 3, 2], [false, 1, 2]], change.name);
    const out = cli(root, 'verify');
    assert.equal(out.status, 0, change.name);
    assert.doesNotMatch(out.stdout + out.stderr, /Takeover|by hand/, change.name);
  }
  const logged = leased(null, 'docs');
  viaGoalSet(logged.root, 'Takeover (docs): 3');
  const seen = roundsWith(logged.root, logged.id, 3, { 3: 'Takeover (docs): 2' }, byHand);
  assert.deepEqual(seen.map((r) => r[0]), [false, false, true], 'a hand edit after a goal --set of the same kind counts the same');
});

test('a limit lowered with a takeover behind counts from that takeover and gives the next one at the next round', () => {
  for (const change of [byHand, viaGoalSet]) {
    const { root, id } = leased('Takeover: 4', 'docs');
    const seen = roundsWith(root, id, 9, { 7: 'Takeover: 2' }, change);
    assert.deepEqual(seen, [[false, 1, 4], [false, 2, 4], [false, 3, 4], [true, 4, 4], [false, 1, 4], [false, 2, 4], [true, 3, 2], [false, 1, 2], [true, 2, 2]], change.name);
  }
});

test('a limit raised with a takeover behind waits until the rounds since that takeover reach it', () => {
  for (const change of [byHand, viaGoalSet]) {
    const { root, id } = leased('Takeover (docs): 2', 'docs');
    const seen = roundsWith(root, id, 7, { 4: 'Takeover (docs): 4' }, change);
    assert.deepEqual(seen, [[false, 1, 2], [true, 2, 2], [false, 1, 2], [false, 2, 4], [false, 3, 4], [true, 4, 4], [false, 1, 4]], change.name);
  }
});

test('two kinds count apart: a changed line moves only the issues whose limit it is', () => {
  const root = loop();
  appendFileSync(goalFile(root), '\nTakeover (docs): 2\nTakeover: 4\n');
  const issue = (kind) => {
    const { id } = R.newIssue(root, `a ${kind} thing`, { acceptance: 'it works', tier: 'standard', kind });
    R.setStatus(root, id, 'in-progress', '', { branch: `jarl/${id}-a`, worker: 'w-one', model: MID });
    return id;
  };
  const docs = issue('docs');
  const gap = issue('gap');
  const round = (id) => { const r = R.addRound(root, id, 'red'); return [r.takeover, r.since, r.limit]; };
  assert.deepEqual([round(docs), round(gap), round(docs), round(gap)], [[false, 1, 2], [false, 1, 4], [true, 2, 2], [false, 2, 4]]);
  byHand(root, 'Takeover: 2');
  assert.deepEqual([round(gap), round(docs)], [[true, 3, 2], [false, 1, 2]], 'the bare line moves the gap issue, not the docs one');
  byHand(root, 'Takeover (docs): 3');
  assert.deepEqual([round(docs), round(gap), round(docs), round(gap)], [[false, 2, 3], [false, 1, 2], [true, 3, 3], [true, 2, 2]]);
});

test('a limit lowered to one mid-loop takes over at the next round and at every round after it', () => {
  const { root, id } = leased(null, 'docs');
  const seen = roundsWith(root, id, 5, { 3: 'Takeover (docs): 1' }, byHand);
  assert.deepEqual(seen, [[false, 1, 3], [false, 2, 3], [true, 3, 1], [true, 1, 1], [true, 1, 1]]);
});

test('each round carries its standing in its line, text that opens like a standing or a count is not read as one, and the pinned frozen reader counts the rounds', () => {
  assert.ok(oldJarlIsPinned());
  const { root, id } = leased('Takeover (docs): 2', 'docs');
  R.addRound(root, id, 'takeover 2 of 2 · typed by hand');
  assert.match(log(root), /· 001 round 1 \(count 1 of 2\) · takeover 2 of 2 · typed by hand$/m);
  const second = cli(root, 'round', id, 'red two', '--findings', '3');
  assert.match(second.stdout, /round 2 — takeover:/);
  assert.match(log(root), /· 001 round 2 \(takeover 2 of 2\) · findings 3 · red two$/m);
  assert.match(second.stdout, /Findings per round: -, 3 \(a dash: the round recorded no count\)\./);
  R.addRound(root, id, 'findings 7 · typed by hand');
  assert.match(log(root), /· 001 round 3 \(count 1 of 2\) · findings - · findings 7 · typed by hand$/m);
  const rounds = L.loopEvents(join(root, '.jarl'), L.loadProfile(root)).filter((e) => e.type === 'round');
  assert.deepEqual(rounds.map((e) => e.standing), [{ takeover: false, count: 1, limit: 2 }, { takeover: true, count: 2, limit: 2 }, { takeover: false, count: 1, limit: 2 }]);
  assert.equal(OLD.roundsOf(root, id), 3);
  for (const command of ['list', 'status', 'next', 'queue']) assert.equal(oldJarl(root, command, {}).ok, true, command);
  OLD.cmdRound(root, id, 'red four');
  assert.deepEqual([R.addRound(root, id, 'red five')].map((r) => [r.round, r.takeover, r.since]), [[5, false, 1]], 'a round the frozen reader wrote from the third on is the takeover it printed');
});

// An issue whose rounds the pinned frozen reader wrote, `count` of them, in a loop whose goal carries the given lines.
function roundsByFrozenReader(goalLines, count, text = (k) => `red ${k}`) {
  const { root, id } = leased(goalLines, 'docs');
  for (let k = 1; k <= count; k += 1) OLD.cmdRound(root, id, text(k));
  return { root, id };
}

test('rounds written with no standing count as the takeover their writer printed, at every round from the third, so the first round after one starts a new count', () => {
  assert.ok(oldJarlIsPinned());
  const three = roundsByFrozenReader(null, 3);
  assert.deepEqual([4, 5, 6].map((k) => R.addRound(three.root, three.id, `red ${k}`)).map((r) => [r.round, r.takeover, r.since]), [[4, false, 1], [5, false, 2], [6, true, 3]]);
  const six = roundsByFrozenReader(null, 6);
  const seventh = cli(six.root, 'round', six.id, 'red 7');
  assert.match(seventh.stdout, /round 7: 1 of 3 before a takeover/);
  const two = roundsByFrozenReader(null, 2);
  assert.equal(R.addRound(two.root, two.id, 'red 3').takeover, true, 'two rounds with no standing, then the third reaches three');
  const lowered = roundsByFrozenReader('Takeover (docs): 2', 4);
  assert.deepEqual([5, 6].map((k) => R.addRound(lowered.root, lowered.id, `red ${k}`)).map((r) => [r.takeover, r.since, r.limit]), [[false, 1, 2], [true, 2, 2]], 'the rounds with no standing took over at the third and the fourth, as their writer printed; the goal\'s limit applies from the first round with a standing');
  const typed = roundsByFrozenReader(null, 1, () => 'takeover · typed by hand');
  assert.deepEqual([R.addRound(typed.root, typed.id, 'red 2')].map((r) => [r.takeover, r.since]), [[false, 2]], 'text that opens like a mark in a round with no standing is no takeover');
  const marked = readFileSync(join(two.root, '.jarl', 'log.md'), 'utf8');
  assert.match(marked, /· 001 round 3 \(takeover 3 of 3\) · red 3$/m);
});

// Each pinned frozen reader, as the round command of that reader runs it: the round it wrote and whether it printed a takeover.
const FROZEN_READERS = [['6.1.0', oldJarl], ['6.2.0', formatTwoJarl]];
const frozenRound = (reader, root, id, text) => {
  const r = reader(root, 'round', {}, [id, text]);
  assert.ok(r.ok, r.error);
  return r.value;
};

test('with a limit other than three, the count after a round a frozen reader wrote follows the takeover that reader printed', () => {
  assert.ok(oldJarlIsPinned() && formatTwoJarlIsPinned());
  for (const [version, reader] of FROZEN_READERS) {
    const { root, id } = leased('Takeover (docs): 2', 'docs');
    assert.deepEqual([R.addRound(root, id, 'red 1'), R.addRound(root, id, 'red 2')].map((r) => r.takeover), [false, true], version);
    const printed = frozenRound(reader, root, id, 'red 3');
    assert.deepEqual([printed.round, printed.takeover], [3, true], `${version} prints a takeover at round 3 whatever the goal says`);
    assert.deepEqual([R.addRound(root, id, 'red 4'), R.addRound(root, id, 'red 5')].map((r) => [r.round, r.takeover, r.since]), [[4, false, 1], [5, true, 2]], `${version}: the count starts again after the takeover it printed`);
    const five = leased('Takeover (docs): 5', 'docs');
    assert.equal(frozenRound(reader, five.root, five.id, 'red 1').takeover, false, version);
    assert.equal(frozenRound(reader, five.root, five.id, 'red 2').takeover, false, version);
    assert.deepEqual([3, 4].map((k) => R.addRound(five.root, five.id, `red ${k}`)).map((r) => [r.takeover, r.since]), [[false, 3], [false, 4]], `${version}: rounds it printed no takeover on keep counting`);
    assert.equal(frozenRound(reader, five.root, five.id, 'red 5').takeover, true, version);
    assert.deepEqual([R.addRound(five.root, five.id, 'red 6')].map((r) => [r.takeover, r.since]), [[false, 1]], version);
  }
});

test('a round a frozen reader wrote whose text opens like a standing is a round with no standing, and its words never count', () => {
  assert.ok(oldJarlIsPinned() && formatTwoJarlIsPinned());
  for (const [version, reader] of FROZEN_READERS) {
    const { root, id } = leased(null, 'docs');
    frozenRound(reader, root, id, 'takeover 1 of 1 · typed by hand');
    frozenRound(reader, root, id, 'count 1 of 3 · findings 9 · typed by hand');
    const rounds = L.loopEvents(join(root, '.jarl'), L.loadProfile(root)).filter((e) => e.type === 'round');
    assert.deepEqual(rounds.map((e) => e.standing ?? null), [null, null], version);
    const third = R.addRound(root, id, 'red 3');
    assert.deepEqual([third.takeover, third.since], [true, 3], `${version}: neither line reset the count`);
    assert.match(log(root), /· 001 round 3 \(takeover 3 of 3\) · red 3$/m, version);
    assert.equal(frozenRound(reader, root, id, 'red 4').round, 4, `${version} counts a round with a standing as a round`);
  }
});

test('a replaced takeover value comes from the line in force', () => {
  const { root } = leased('Takeover (docs): 5\nTakeover (docs): 2', 'docs');
  assert.equal(cli(root, 'goal', '--set', 'Takeover (docs): 4').status, 0);
  assert.match(log(root), /goal line changed · Takeover \(docs\): 4 · was 2$/m);
  const odd = leased('Takeover (docs): often', 'docs');
  assert.equal(cli(odd.root, 'goal', '--set', 'Takeover (docs): 3').status, 0);
  assert.match(log(odd.root), /goal line changed · Takeover \(docs\): 3 · was often$/m);
  assert.deepEqual([1, 2, 3].map((k) => R.addRound(odd.root, odd.id, `red ${k}`).takeover), [false, false, true]);
});

test('verify lists a takeover line for a kind the profile does not declare', () => {
  const { root } = leased('Takeover (poetry): 2\nTakeover (docs): 2', 'docs');
  const out = cli(root, 'verify');
  assert.notEqual(out.status, 0);
  assert.match(out.stdout + out.stderr, /Takeover \(poetry\): 2[^\n]*declares no kind poetry/);
  assert.doesNotMatch(out.stdout + out.stderr, /Takeover \(docs\): 2/);
});

test('verify lists a takeover line that is not a count of rounds', () => {
  const { root } = leased('Takeover (docs): often\nTakeover: 0', 'docs');
  const out = cli(root, 'verify');
  assert.notEqual(out.status, 0);
  assert.match(out.stdout + out.stderr, /Takeover \(docs\): often[^\n]*whole number of rounds/);
  assert.match(out.stdout + out.stderr, /Takeover: 0[^\n]*whole number of rounds/);
});

test('a takeover line in the goal is read by the pinned frozen reader without a refusal and leaves the issues it lists as they are', () => {
  assert.ok(oldJarlIsPinned());
  const { root, id } = leased('Takeover (docs): 2\nTakeover: 4', 'docs');
  R.addRound(root, id, 'red one');
  for (const command of ['list', 'status', 'next', 'queue']) assert.equal(oldJarl(root, command, {}).ok, true, command);
  assert.equal(OLD.findIssue(root, id).status, 'in-progress');
  assert.equal(OLD.cmdList(root, {}).length, 1);
});

test('a round records its count of findings and the takeover block lists them', () => {
  const root = loop();
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works', tier: 'standard' });
  R.setStatus(root, id, 'in-progress', '', { branch: 'jarl/001-a', worker: 'w-one', model: MID });
  assert.equal(cli(root, 'round', id, 'red one', '--findings', '29').status, 0);
  assert.equal(cli(root, 'round', id, 'red two', '--findings', '14').status, 0);
  const out = cli(root, 'round', id, 'red three', '--findings', '3');
  assert.match(out.stdout, /Findings per round: 29, 14, 3\./);
  const bad = cli(root, 'round', id, 'red four', '--findings', 'many');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /--findings must be a whole number/);
});

test('the takeover advice reads the tiers and their order from the loop\'s profile', () => {
  const root = loop();
  writeFileSync(join(root, '.jarl', 'profile.json'), JSON.stringify({ 'jarl-profile': 1, name: 'sized', statuses: { open: ['dispatchable'], 'in-progress': ['holds-claim'], done: ['terminal', 'closes-record', 'settles-dependents'] }, fields: { Tier: { enum: ['small', 'big', 'huge'], default: 'small' } } }));
  const run = (tier) => {
    const { id } = R.newIssue(root, `a ${tier} thing`, { acceptance: 'it works', tier });
    R.setStatus(root, id, 'in-progress', '', { branch: `jarl/${id}-a`, worker: 'w-one', model: MID });
    R.addRound(root, id, 'red one');
    R.addRound(root, id, 'red two');
    return R.addRound(root, id, 'red three').block;
  };
  assert.match(run('small'), /one tier up from small \(to big\)/);
  const top = run('huge');
  assert.match(top, /huge is the top tier \(huge\)/);
  assert.doesNotMatch(top, /tier up|light|strong/);
});

test('a later takeover does not offer the tier up again, and a count above the bound is refused', () => {
  const root = loop();
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works', tier: 'standard' });
  R.setStatus(root, id, 'in-progress', '', { branch: 'jarl/001-a', worker: 'w-one', model: MID });
  const blocks = [1, 2, 3, 4, 5, 6].map((k) => R.addRound(root, id, `red ${k}`).block);
  assert.match(blocks[2], /tier up/);
  assert.match(blocks[5], /a model that has not held this issue/);
  assert.doesNotMatch(blocks[5], /tier up/);
  const bad = cli(root, 'round', id, 'red seven', '--findings', '1e23');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /up to 10000/);
  assert.notEqual(cli(root, 'round', id, 'red seven', '--findings', '10001').status, 0);
});

test('the findings per round keep each round in its place, a round with no count shown as a dash', () => {
  const root = loop();
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works', tier: 'standard' });
  R.setStatus(root, id, 'in-progress', '', { branch: 'jarl/001-a', worker: 'w-one', model: MID });
  assert.equal(cli(root, 'round', id, 'red one', '--findings', '29').status, 0);
  assert.equal(cli(root, 'round', id, 'red two').status, 0);
  const out = cli(root, 'round', id, 'red three', '--findings', '3');
  assert.match(out.stdout, /Findings per round: 29, -, 3 \(a dash: the round recorded no count\)\./);
});

test('a later takeover names every model that held the issue, and says nothing of one same model', () => {
  const root = loop();
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works', tier: 'standard' });
  R.setStatus(root, id, 'in-progress', '', { branch: 'jarl/001-a', worker: 'w-one', model: MID });
  const first = [1, 2, 3].map((k) => R.addRound(root, id, `red ${k}`)).pop().block;
  assert.match(first, /a model other than mid-model, or change the approach — the same model at the same tier has failed this 3 times/);
  R.setStatus(root, id, 'in-progress', 'takeover after three rounds', { branch: 'jarl/001-a', worker: 'w-two', model: BIG, handover: true });
  const second = [4, 5, 6].map((k) => R.addRound(root, id, `red ${k}`)).pop().block;
  assert.match(second, /put it on a model that has not held this issue \(it was held on mid-model, big-model@high\), or change the approach/);
  assert.doesNotMatch(second, /the same model|the last was/);
});

test('the takeover advice for an issue whose Tier is not one of the profile\'s offers no tier up', () => {
  const root = loop();
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works', tier: 'standard' });
  writeFileSync(join(root, '.jarl', 'profile.json'), JSON.stringify({ 'jarl-profile': 1, name: 'sized', statuses: { open: ['dispatchable'], 'in-progress': ['holds-claim'], done: ['terminal', 'closes-record', 'settles-dependents'] }, fields: { Tier: { enum: ['small', 'big', 'huge'], default: 'small' } } }));
  R.setStatus(root, id, 'in-progress', '', { branch: 'jarl/001-a', worker: 'w-one', model: MID });
  const block = [1, 2, 3].map((k) => R.addRound(root, id, `red ${k}`)).pop().block;
  assert.match(block, /standard is not a tier of this loop's profile \(small, big, huge\), so put it on a model other than mid-model, or change the approach/);
  assert.doesNotMatch(block, /tier up|to small/);
});

test('a count of findings is read from the flag only, never from the words of a round', () => {
  const root = loop();
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works', tier: 'standard' });
  R.setStatus(root, id, 'in-progress', '', { branch: 'jarl/001-a', worker: 'w-one', model: MID });
  R.addRound(root, id, 'findings 99 · typed by hand');
  cli(root, 'round', id, 'red two', '--findings', '4');
  const out = cli(root, 'round', id, 'red three', '--findings', '2').stdout;
  assert.match(out, /Findings per round: -, 4, 2 \(a dash: the round recorded no count\)\./);
});

// ---- free text is never a field ------------------------------------------------------------------------------

// Filed with three digits and no key (fileAsBefore), as the frozen reader of format 1 reads it.
function reviewedUnit(root, findings, extra = {}) {
  const id = fileAsBefore(root, 'a thing', { acceptance: 'it works' });
  R.setStatus(root, id, 'in-progress', extra.reason ?? '', { branch: `jarl/${id}-x`, worker: 'w-one', ...(extra.model ? { model: extra.model } : {}) });
  R.addEvidence(root, id, undefined, { ran: 'npm test', saw: 'pass' });
  R.review(root, id, 'approve', findings, { by: 'rev-one' });
  return id;
}

test('findings that open like a model field are not read as one: no reviewer model appears, and the frozen reader still reads the verdict', () => {
  const root = loop();
  const id = reviewedUnit(root, 'model fake-1 · looks fine here and nothing found');
  assert.match(log(root), /001 review approve · by rev-one \(fresh\) · findings: model fake-1 · looks fine/);
  R.recordMerged(root, id, { sha: 'abc1234' }); R.setStatus(root, id, 'done', 'merged', {});
  const m = L.cmdModels(root, {});
  assert.deepEqual(m.reviewers.map((r) => r.model), [null]);
  const gate = OLD.gateState(root, id);
  assert.equal(gate.live.kind, 'fresh');
});

test('findings that open like the relay mark are not read as one', () => {
  const root = loop();
  reviewedUnit(root, 'relayed · looks fine here and nothing found');
  assert.match(log(root), /by rev-one \(fresh\) · findings: relayed · looks fine/);
  const m = L.cmdModels(root, {});
  assert.equal(m.reviewers[0].cells[0].relayed, 0);
  const real = L.cmdModels(loop(), {});
  assert.deepEqual(real.reviewers, []);
});

test('a lease reason that holds " · model " is neutralised on write and never read as the model', () => {
  const root = loop();
  const id = reviewedUnit(root, 'read the whole diff, found nothing', { reason: 'start · model fake-2 · more', model: MID });
  assert.match(log(root), /001 → in-progress · start - model fake-2 - more · branch jarl\/001-x · model mid-model · worker w-one/);
  R.recordMerged(root, id, { sha: 'abc1234' }); R.setStatus(root, id, 'done', 'merged', {});
  assert.deepEqual(L.cmdModels(root, {}).workers.map((r) => r.model), [MID]);
  // A line written before the reason was neutralised still reads right: the model is the last field.
  const raw = readFileSync(join(root, '.jarl', 'log.md'), 'utf8').replace(' · branch ', ' · model fake-3 · branch ');
  writeFileSync(join(root, '.jarl', 'log.md'), raw);
  assert.deepEqual(L.cmdModels(root, {}).workers.map((r) => r.model), [MID]);
  const bare = loop();
  const id2 = reviewedUnit(bare, 'read the whole diff, found nothing', { reason: 'start · model fake-4 · more' });
  R.recordMerged(bare, id2, { sha: 'abc1234' }); R.setStatus(bare, id2, 'done', 'merged', {});
  assert.deepEqual(L.cmdModels(bare, {}).workers.map((r) => r.model), [null]);
  const open = fileAsBefore(bare, 'another', { acceptance: 'it works' });
  R.setStatus(bare, open, 'in-progress', 'start · model fake-5 · more', { branch: 'jarl/9-x', worker: 'w-two', model: MID });
  assert.throws(() => OLD.cmdReview(bare, open, 'approve', 'Minor: nothing to add here', { by: 'w-two' }), /self-approve/);
});

// ---- the views: models ----------------------------------------------------------------------------------

const cell = (rows, model, key) => rows.find((r) => r.model === model).cells.find((c) => c.key === key);

function threeModels() {
  const root = loop({ lines: true });
  units(root, 6, { model: MID, worker: 'w-mid' }, 1);
  units(root, 4, { model: SMALL, worker: 'w-small' });
  units(root, 5, { model: BIG, worker: 'w-big' });
  units(root, 5, { model: MID, worker: 'w-mid', kind: 'docs', tier: 'light' }, 3);
  units(root, 5, { model: SMALL, worker: 'w-small', kind: 'docs', tier: 'light' });
  return root;
}

test('models: a loop with three models over two kinds gives the counts, the shares and the words, and n = 4 prints no share and no word', () => {
  const root = threeModels();
  const m = L.cmdModels(root, {});
  assert.equal(m.minN, 5);
  const mid = cell(m.workers, MID, 'bug · standard');
  assert.equal(mid.units, 6);
  assert.equal(mid.clean, 5);
  assert.equal(mid.share, 0.833);
  assert.equal(mid.changes, 1);
  assert.equal(mid.word, 'below', 'under the kind baseline of 14 clean in 15');
  const big = cell(m.workers, BIG, 'bug · standard');
  assert.equal(big.share, 1);
  assert.equal(big.word, 'fits');
  const small = cell(m.workers, SMALL, 'bug · standard');
  assert.equal(small.units, 4);
  assert.equal(small.clean, 4);
  assert.equal(small.share, null, 'n = 4: no share');
  assert.equal(small.word, null, 'n = 4: no word');
  assert.equal(cell(m.workers, MID, 'docs · light').share, 0.4);
  assert.equal(cell(m.workers, MID, 'docs · light').word, 'below');
  assert.equal(cell(m.workers, SMALL, 'docs · light').word, 'fits');
  assert.equal(m.workers.find((r) => r.model === MID).new, false, 'a model with n >= 5 somewhere is not new');
  assert.equal(m.workers.find((r) => r.model === SMALL).new, false);
  assert.deepEqual(m.baselines.map((b) => [b.key, b.units, b.clean]), [['bug · standard', 15, 14], ['docs · light', 10, 7]]);
  // the reviewer, one model for everything
  const rev = m.reviewers.find((r) => r.model === BIG);
  const bug = rev.cells.find((c) => c.key === 'bug · standard');
  assert.equal(bug.approves, 15);
  assert.equal(bug.changes, 1);
  assert.equal(bug.verdicts, 16);
  assert.equal(bug.clearingOwnOrLower, 5, 'the clearing approves on the reviewer\'s own model');
  assert.equal(rev.cells.find((c) => c.key === 'docs · light').changes, 3);
  assert.ok(m.loops.length === 1);
});

test('models: a model with fewer than five units in every kind is new; a model on no line is unplaced', () => {
  const root = loop({ lines: true });
  units(root, 3, { model: 'brand-new-1', worker: 'w-new' });
  const m = L.cmdModels(root, {});
  const row = m.workers.find((r) => r.model === 'brand-new-1');
  assert.equal(row.new, true);
  assert.equal(row.unplaced, true);
  assert.equal(cell(m.workers, 'brand-new-1', 'bug · standard').share, null);
});

test('models on a loop with no issue file yet (a fresh clone of a committed loop) reads an empty live loop, not a missing one', () => {
  const root = loop();
  renameSync(join(root, '.jarl', 'issues'), join(root, '.jarl', 'issues-moved'));
  const m = L.cmdModels(root, {});
  assert.deepEqual(m.loops.map((l) => [l.label, l.issues, l.units, l.verdicts]), [['this loop', 0, 0, 0]]);
  const r = cli(root, 'models');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /# Models · this loop \(0 issues, 0 units, 0 verdicts\)/);
  assert.match(r.stdout, /\(no unit of work yet\)/);
  assert.match(r.stdout, /\(no verdict yet\)/);
  assert.doesNotMatch(r.stdout + r.stderr, /holds no live loop/);
});

test('models: a loop whose leases and verdicts carry no model reads as (not recorded) by tier', () => {
  const root = loop();
  units(root, 6, { worker: 'w-a', reviewerModel: null }, 2);
  units(root, 2, { worker: 'w-b', reviewerModel: null, tier: 'light', kind: 'docs' });
  const m = L.cmdModels(root, {});
  assert.deepEqual(m.workers.map((r) => r.label), ['(not recorded)']);
  const row = m.workers[0];
  assert.deepEqual(row.cells.map((c) => c.key), ['tier light', 'tier standard']);
  const std = row.cells.find((c) => c.key === 'tier standard');
  assert.equal(std.units, 6);
  assert.equal(std.clean, 4);
  assert.equal(std.share, 0.667);
  assert.equal(std.word, null, 'no word for work with no model');
  assert.equal(m.reviewers[0].label, '(not recorded)');
  const text = L.renderModels(m);
  assert.match(text, /\(not recorded\) · tier standard/);
  assert.match(text, /\(not recorded\) · tier light/);
});

test('models: work with no recorded model prints under its own heading, never under the last named model', () => {
  const root = loop({ lines: true });
  units(root, 5, { model: MID, worker: 'w-m' });
  units(root, 2, { worker: 'w-old' });
  const text = L.renderModels(L.cmdModels(root, {}));
  assert.match(text, /\n\(not recorded\)\n  \(not recorded\) · tier standard  units 2/);
});

test('models: one model recorded with dots and with dashes is one row, which names the spellings it folded; the record keeps each id as written', () => {
  const root = loop({ lines: true });
  units(root, 4, { model: 'claude-opus-5-5', worker: 'w-dash', reviewerModel: 'claude-opus-5-5' });
  units(root, 2, { model: 'claude-opus-5.5', worker: 'w-dot', reviewerModel: 'claude-opus-5.5' }, 1);
  const m = L.cmdModels(root, {});
  const worker = m.workers.filter((r) => r.spellings.includes('claude-opus-5.5'));
  assert.equal(worker.length, 1, 'one worker row for the two spellings');
  assert.deepEqual(worker[0].spellings, ['claude-opus-5-5', 'claude-opus-5.5'], 'the spelling more units carry names the row');
  assert.equal(worker[0].model, 'claude-opus-5-5');
  const bug = worker[0].cells.find((c) => c.key === 'bug · standard');
  assert.deepEqual([bug.units, bug.clean, bug.changes], [6, 5, 1], 'the counts of both spellings add up');
  const reviewer = m.reviewers.filter((r) => r.spellings.includes('claude-opus-5.5'));
  assert.equal(reviewer.length, 1, 'one reviewer row for the two spellings');
  const verdicts = reviewer[0].cells.find((c) => c.key === 'bug · standard');
  assert.deepEqual([verdicts.verdicts, verdicts.approves, verdicts.changes], [7, 6, 1]);
  assert.match(L.renderModels(m), /spellings folded: claude-opus-5-5, claude-opus-5\.5/);
  assert.match(log(root), /· model claude-opus-5-5 · worker w-dash\n/, 'the log keeps the id as written');
  assert.match(log(root), /· model claude-opus-5\.5 · worker w-dot\n/, 'and the other spelling as written');
});

test('a model written with dots sits on the goal line that writes it with dashes, and an approve by it is the same model as the worker\'s', () => {
  const root = loop();
  appendFileSync(join(root, '.jarl', 'goal.md'), '\nModel (strong): claude-opus-5-5\n');
  const lines = L.modelLines(root);
  assert.equal(lines.rank('claude-opus-5.5'), lines.rank('claude-opus-5-5'));
  assert.equal(lines.rank('claude-opus-5.5@high'), lines.rank('claude-opus-5-5@high'), 'the same id at another effort sits where the id sits, in either spelling');
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works', tier: 'strong' });
  R.setStatus(root, id, 'in-progress', '', { branch: 'jarl/001-a', worker: 'w-one', model: 'claude-opus-5-5' });
  R.addEvidence(root, id, undefined, { ran: 'npm test', saw: 'pass' });
  assert.match(notes(root, 'review', [id, 'approve', 'read it all, nothing found'], { by: 'rev-2', model: 'claude-opus-5.5' }), /same model as the worker's \(claude-opus-5\.5\)/);
});

test('models --group repo slices the same facts by repository; the text names n for every count and a share only from n >= 5', () => {
  const root = loop({ lines: true });
  mkdirSync(join(root, 'sub'));
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: join(root, 'sub'), timeout: SPAWN_TIMEOUT }).status, 0);
  units(root, 5, { model: MID, worker: 'w-m' }, 1);
  units(root, 2, { model: MID, worker: 'w-m', repo: './sub' });
  const m = L.cmdModels(root, { by: 'repo' });
  assert.equal(m.by, 'repo');
  assert.deepEqual(m.slices.map((s) => s.value).sort(), ['sub', basename(root)].sort());
  const own = m.slices.find((s) => s.value === basename(root));
  assert.equal(cell(own.workers, MID, 'bug · standard').units, 5);
  assert.throws(() => L.cmdModels(root, { by: 'nonsense' }), /--group is one of: repo, tag/);
  const text = L.renderModels(L.cmdModels(root, {}));
  assert.match(text, /mid-model/);
  assert.match(text, /units 7/);
  assert.match(text, /clean first pass 6 of 7 \(86%\)/);
  const tiny = L.renderModels(L.cmdModels(threeModels(), {}));
  assert.match(tiny, /small-model[\s\S]*units 4 · clean first pass 4 of 4 · /, 'n = 4: counts only');
});

test('models: an approve by a lower-ranked reviewer that a reviewer able to clear then checked, five times with no miss, may clear that kind; four times, no word', () => {
  const root = loop({ lines: true });
  const clear = (n) => {
    for (let k = 0; k < n; k += 1) {
      seq += 1;
      const { id } = R.newIssue(root, `cl ${seq}`, { kind: 'bug', tier: 'standard', acceptance: 'it works' });
      R.setStatus(root, id, 'in-progress', '', { branch: `jarl/${id}-x`, worker: 'w-mid', model: MID });
      R.addEvidence(root, id, undefined, { ran: 'npm test', saw: 'pass' });
      R.review(root, id, 'approve', 'first look, nothing found', { by: 'rev-small', model: SMALL });
      R.review(root, id, 'approve', 'second look, nothing found', { by: 'rev-big', model: BIG });
      R.recordMerged(root, id, { sha: 'abc1234' }); R.setStatus(root, id, 'done', 'merged', {});
    }
  };
  clear(4);
  let rev = L.cmdModels(root, {}).reviewers.find((r) => r.model === SMALL);
  assert.equal(rev.cells[0].lowChecked, 4);
  assert.equal(rev.cells[0].word, null);
  clear(1);
  rev = L.cmdModels(root, {}).reviewers.find((r) => r.model === SMALL);
  assert.equal(rev.cells[0].lowChecked, 5);
  assert.equal(rev.cells[0].lowMisses, 0);
  assert.equal(rev.cells[0].word, 'may clear bug · standard');
  assert.match(L.renderModels(L.cmdModels(root, {})), /may clear bug · standard/);
});

test('models is read-only: it takes no lock and writes nothing', () => {
  const root = threeModels();
  const before = [log(root), readFileSync(L.findIssue(root, '001').file, 'utf8')];
  const r = cli(root, 'models');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /mid-model/);
  assert.deepEqual([log(root), readFileSync(L.findIssue(root, '001').file, 'utf8')], before);
  assert.equal(existsSync(join(root, '.jarl', '.lock')), false);
  const j = cli(root, 'models', '--json');
  assert.ok(Array.isArray(JSON.parse(j.stdout).workers));
});

// ---- the views: next, resume, status --------------------------------------------------------------------

test('next and resume show the default model of the issue\'s tier alone, whatever the record measured of the other models; next --json carries model', () => {
  const root = loop({ lines: true });
  units(root, 5, { model: SMALL, worker: 'w-small' });
  units(root, 5, { model: MID, worker: 'w-mid' }, 2);
  const { id } = R.newIssue(root, 'to do', { kind: 'bug', tier: 'standard', acceptance: 'it works' });
  const { id: strong } = R.newIssue(root, 'hard', { kind: 'bug', tier: 'strong', acceptance: 'it works' });
  const rows = J.cmdNext(root, {});
  assert.deepEqual(rows.find((r) => r.id === id).model, { default: MID });
  assert.deepEqual(rows.find((r) => r.id === strong).model, { default: BIG });
  const text = L.renderNext(rows, false);
  assert.match(text, new RegExp(`${id}[^\\n]*\\[model mid-model\\]`));
  assert.doesNotMatch(text, /suggest/);
  const resume = R.resumeData(root, {});
  assert.deepEqual(resume.next.find((r) => r.id === id).model, { default: MID });
  assert.match(L.renderResume(resume), /\[model mid-model\]/);
  assert.doesNotMatch(L.renderResume(resume), /suggest/);
});

test('next and resume carry no model in a loop without model lines', () => {
  const root = loop();
  R.newIssue(root, 'to do', { acceptance: 'it works' });
  assert.equal(J.cmdNext(root, {})[0].model, undefined);
  assert.equal(R.resumeData(root, {}).next[0].model, undefined);
});

test('resume in-flight rows and status inFlightRows carry the model, or say it was not recorded', () => {
  const root = loop();
  const a = R.newIssue(root, 'with a model', { acceptance: 'it works' }).id;
  const b = R.newIssue(root, 'without', { acceptance: 'it works' }).id;
  R.setStatus(root, a, 'in-progress', '', { branch: 'jarl/001-a', worker: 'w-one', model: 'claude-sonnet-5-5@high' });
  R.setStatus(root, b, 'in-progress', '', { branch: 'jarl/002-b', worker: 'w-two' });
  const s = R.statusData(root, {});
  assert.equal(s.inFlightRows.find((r) => r.id === a).model, 'claude-sonnet-5-5@high');
  assert.equal(s.inFlightRows.find((r) => r.id === b).model, null);
  const resume = R.resumeData(root, {});
  assert.equal(resume.inFlight.find((r) => r.id === a).model, 'claude-sonnet-5-5@high');
  const text = L.renderResume(resume);
  assert.match(text, /worker w-one · model claude-sonnet-5-5@high/);
  assert.match(text, /worker w-two · model not recorded/);
});

// ---- the real record ----------------------------------------------------------------------------------

test('JARL_LIVE_LOOP, when set: the record cut where the research cut it gives the research\'s tier rows; the whole record reads as (not recorded) by tier', { skip: !process.env.JARL_LIVE_LOOP }, () => {
  const root = process.env.JARL_LIVE_LOOP;
  // The research (retro-output.txt) read the first 2062 log lines: there the strong tier has 62 settled units, 36 clean
  // (58%), 34 changes and 17 with evidence rows before the review, and the standard tier 4 units, 3 clean, 1 change.
  // A unit is counted only when every issue of it closed or was handed over; two further strong units were reviewed
  // and then ended without closing, and this view lists them apart ("ended after a review without closing") instead of
  // counting them, which is the research's own rule. Counting them would give 64 units and 38 changes.
  const logLines = readFileSync(join(root, '.jarl', 'log.md'), 'utf8').split('\n');
  if (logLines.length >= 2062) {
    const cut = mkdtempSync(join(tmpdir(), 'jarl-live-cut-'));
    cpSync(join(root, '.jarl'), join(cut, '.jarl'), { recursive: true });
    writeFileSync(join(cut, '.jarl', 'log.md'), `${logLines.slice(0, 2062).join('\n')}\n`);
    const rows = L.cmdModels(cut, {}).workers.find((r) => r.model === null).cells;
    const strong = rows.find((c) => c.key === 'tier strong');
    const standard = rows.find((c) => c.key === 'tier standard');
    assert.deepEqual([strong.units, strong.clean, strong.changes, strong.rowsBeforeReview, strong.endedAfterReview], [62, 36, 34, 17, 2]);
    assert.deepEqual([standard.units, standard.clean, standard.changes, standard.rowsBeforeReview], [4, 3, 1, 0]);
  }
  const m = L.cmdModels(root, {});
  const row = m.workers.find((r) => r.model === null);
  assert.ok(row, 'work with no recorded model exists');
  const total = row.cells.reduce((s, c) => s + c.units, 0);
  assert.ok(total > 0);
  for (const c of row.cells) { assert.ok(c.clean <= c.units); assert.match(c.key, /^tier /); }
  console.log(`live loop: ${row.cells.map((c) => `${c.key} units ${c.units} clean ${c.clean}`).join(' · ')}`);
});
