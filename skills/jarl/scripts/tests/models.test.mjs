// The record keeps the model of every worker and reviewer (issue 287): the lease and the verdict lines, the tiers and the
// loop's model lines, the notes (command line only, only in a loop with model lines), and the read-only views that
// derive from them: `models`, the marks on `next` and `resume`. Every line written here is read by the pinned frozen reader
// (tests/old-jarl.mjs) without a refusal and without a silent misreading, so the record format is not raised.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as R from '../record.mjs';
import { OLD_JARL_FILE, oldJarlIsPinned, oldJarl } from './old-jarl.mjs';
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
  R.setStatus(root, id, 'done', 'merged', {});
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
  assert.match(log(root), /001 → in-progress · start · branch jarl\/001-a · model claude-sonnet-5-5@high · worker w-one · worktree /);
  R.setStatus(root, id, 'open', '', {});
  assert.doesNotMatch(issueText(root, id), /\*\*Model:\*\*/, 'removed with Worker');
  assert.doesNotMatch(issueText(root, id), /\*\*Worker:\*\*/);
});

test('a takeover with another worker and no model does not keep the old model on the issue', () => {
  const root = loop();
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works' });
  R.setStatus(root, id, 'in-progress', '', { branch: 'jarl/001-a', worker: 'w-one', model: MID });
  R.setStatus(root, id, 'in-progress', '', { branch: 'jarl/001-a', worker: 'w-two' });
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
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works' });
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

test('record.mjs takes model and relayed as optional keys and the contract stays jarl-record/1', () => {
  assert.equal(R.RECORD_API, 'jarl-record/1');
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
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works', tier: 'light' });
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
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works' });
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

test('new without --tier says on the command line which tier it used and the criteria; with --tier, or from the library, nothing', () => {
  const root = loop();
  const w = notes(root, 'new', ['a thing'], {});
  assert.match(w, /tier standard/);
  assert.match(w, /light: a check or test decides/);
  assert.match(w, /strong: unknown cause/);
  assert.equal(w.split('\n').length, 1, 'one line');
  assert.equal(notes(root, 'new', ['another thing'], { tier: 'strong' }), '');
  assert.equal(R.newIssue(root, 'third', {}).note, undefined);
  const real = cli(root, 'new', 'fourth thing');
  assert.equal(real.status, 0);
  assert.match(real.stderr, /tier standard/);
});

test('the third round prints a takeover block that says to raise the fresh worker one tier up or on another model than the one that failed', () => {
  const root = loop();
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works', tier: 'standard' });
  R.setStatus(root, id, 'in-progress', '', { branch: 'jarl/001-a', worker: 'w-one', model: MID });
  R.addRound(root, id, 'red one');
  R.addRound(root, id, 'red two');
  const r = R.addRound(root, id, 'red three');
  assert.equal(r.takeover, true);
  assert.match(r.block, /one tier up from standard, or on a model other than mid-model/);
});

// ---- free text is never a field ------------------------------------------------------------------------------

function reviewedUnit(root, findings, extra = {}) {
  const { id } = R.newIssue(root, 'a thing', { acceptance: 'it works' });
  R.setStatus(root, id, 'in-progress', extra.reason ?? '', { branch: `jarl/${id}-x`, worker: 'w-one', ...(extra.model ? { model: extra.model } : {}) });
  R.addEvidence(root, id, undefined, { ran: 'npm test', saw: 'pass' });
  R.review(root, id, 'approve', findings, { by: 'rev-one' });
  return id;
}

test('findings that open like a model field are not read as one: no reviewer model appears, and the frozen reader still reads the verdict', () => {
  const root = loop();
  const id = reviewedUnit(root, 'model fake-1 · looks fine here and nothing found');
  assert.match(log(root), /001 review approve · by rev-one \(fresh\) · findings: model fake-1 · looks fine/);
  R.setStatus(root, id, 'done', 'merged', {});
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
  R.setStatus(root, id, 'done', 'merged', {});
  assert.deepEqual(L.cmdModels(root, {}).workers.map((r) => r.model), [MID]);
  // A line written before the reason was neutralised still reads right: the model is the last field.
  const raw = readFileSync(join(root, '.jarl', 'log.md'), 'utf8').replace(' · branch ', ' · model fake-3 · branch ');
  writeFileSync(join(root, '.jarl', 'log.md'), raw);
  assert.deepEqual(L.cmdModels(root, {}).workers.map((r) => r.model), [MID]);
  const bare = loop();
  const id2 = reviewedUnit(bare, 'read the whole diff, found nothing', { reason: 'start · model fake-4 · more' });
  R.setStatus(bare, id2, 'done', 'merged', {});
  assert.deepEqual(L.cmdModels(bare, {}).workers.map((r) => r.model), [null]);
  const { id: open } = R.newIssue(bare, 'another', { acceptance: 'it works' });
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

test('a lower-ranked model whose share equals the default\'s is suggested: the default does no better there', () => {
  const root = loop({ lines: true });
  units(root, 5, { model: SMALL, worker: 'w-small' });
  units(root, 5, { model: MID, worker: 'w-mid' });
  const { id } = R.newIssue(root, 'to do', { kind: 'bug', tier: 'standard', acceptance: 'it works' });
  assert.equal(J.cmdNext(root, {}).find((r) => r.id === id).model.suggested, SMALL);
});

test('models --by repo slices the same facts by repository; the text names n for every count and a share only from n >= 5', () => {
  const root = loop({ lines: true });
  mkdirSync(join(root, 'sub'));
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: join(root, 'sub'), timeout: SPAWN_TIMEOUT }).status, 0);
  units(root, 5, { model: MID, worker: 'w-m' }, 1);
  units(root, 2, { model: MID, worker: 'w-m', repo: 'sub' });
  const m = L.cmdModels(root, { by: 'repo' });
  assert.equal(m.by, 'repo');
  assert.deepEqual(m.slices.map((s) => s.value).sort(), ['sub', root.split('/').pop()].sort());
  const own = m.slices.find((s) => s.value === root.split('/').pop());
  assert.equal(cell(own.workers, MID, 'bug · standard').units, 5);
  assert.throws(() => L.cmdModels(root, { by: 'nonsense' }), /--by is one of: repo, tag/);
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
      R.setStatus(root, id, 'done', 'merged', {});
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

test('next and resume show the tier default model, and suggest a lower-ranked model that fits while the default does no better; next --json gains model', () => {
  const root = loop({ lines: true });
  units(root, 5, { model: SMALL, worker: 'w-small' });
  units(root, 5, { model: MID, worker: 'w-mid' }, 2);
  const { id } = R.newIssue(root, 'to do', { kind: 'bug', tier: 'standard', acceptance: 'it works' });
  const { id: strong } = R.newIssue(root, 'hard', { kind: 'bug', tier: 'strong', acceptance: 'it works' });
  const rows = J.cmdNext(root, {});
  const row = rows.find((r) => r.id === id);
  assert.equal(row.model.default, MID);
  assert.equal(row.model.suggested, SMALL);
  assert.match(row.model.basis, /small-model/);
  assert.match(row.model.basis, /5 of 5/);
  const hard = rows.find((r) => r.id === strong);
  assert.equal(hard.model.default, BIG);
  assert.equal(hard.model.suggested, null);
  const text = L.renderNext(rows, false);
  assert.match(text, new RegExp(`${id}[^\\n]*model mid-model[^\\n]*suggest small-model`));
  const resume = R.resumeData(root, {});
  assert.equal(resume.next.find((r) => r.id === id).model.suggested, SMALL);
  assert.match(L.renderResume(resume), /suggest small-model/);
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
