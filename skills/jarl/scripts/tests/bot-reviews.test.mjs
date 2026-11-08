// A verdict can be recorded as a bot's (review --bot, or a name the loop's done gate names as a bot): its line carries the
// standing bot, which a reader of record formats 1 and 2 would take for an approve with no reviewer, so the first one raises
// the loop to format 3. Which approves clear an issue is the loop's own definition, the done gate's "clears": by default a
// fresh agent's or the owner's; a loop may name a bot there, and may ask for several approves together. With no
// definition a bot's approve never clears, and done says so, naming the bot. status and report count bot and relayed
// verdicts apart from fresh ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileAsBefore, formatTwoJarl, oldJarl } from './old-jarl.mjs';
import { jarl, refuses, run, loop as makeLoop } from './helpers.mjs';
import { FINDINGS } from './findings.mjs';
import { BUILTIN_STATUSES } from '../jarl-lib.mjs';
import * as R from '../record.mjs';

const log = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const profileFile = (gate) => {
  const file = join(mkdtempSync(join(tmpdir(), 'jarl-bot-profile-')), 'profile.json');
  writeFileSync(file, JSON.stringify({ 'jarl-profile': 1, statuses: BUILTIN_STATUSES, initial: 'open', 'done-gate': gate }));
  return file;
};
// A loop with `n` code issues, each in progress on its own branch with a proof row and its merge recorded, so done stands
// on its approves alone; and one issue with no code (no branch) with a proof row, last.
function botLoop(gate = null, n = 3) {
  const root = makeLoop({ prefix: 'jarl-bot-', via: 'cli', initFlags: gate ? ['--profile', profileFile(gate)] : [] });
  for (let k = 1; k <= n; k += 1) {
    jarl(root, 'new', `change ${k}`, '--acceptance', 'it works');
    jarl(root, 'set', String(k), 'in-progress', '--worker', `w${k}`, '--branch', `jarl/${k}`, '--by', 'jarl');
    jarl(root, 'evidence', String(k), '--ran', 'npm test', '--saw', 'pass 3, fail 0', '--by', `w${k}`);
    jarl(root, 'merged', String(k), '--sha', 'abc1234', '--ci', 'none', '--by', 'jarl');
  }
  jarl(root, 'new', 'a note with no code', '--acceptance', 'it reads well');
  jarl(root, 'set', String(n + 1), 'in-progress', '--worker', 'wn', '--by', 'jarl');
  jarl(root, 'evidence', String(n + 1), '--ran', 'proofread', '--saw', 'reads well', '--by', 'wn');
  return root;
}
const done = (root, id) => run(root, ['set', id, 'done', 'the gate holds', '--by', 'jarl']);
const review = (root, id, by, ...flags) => run(root, ['review', id, 'approve', '--by', by, ...flags, FINDINGS]);

test('with no definition a bot\'s approve is recorded as a bot\'s and never clears: done says so naming the bot, on code and on an issue with no code', () => {
  const root = botLoop();
  const r = review(root, '1', 'coderabbit', '--bot');
  assert.equal(r.status, 0, r.stderr);
  assert.match(log(root), /^- \S+ \S+(?: key \S+)? · 1 review approve · by coderabbit \(bot\) · read the diff, nothing found$/m);
  assert.match(readFileSync(R.findIssue(root, '1').file, 'utf8'), /^- \*\*approve\*\* · by coderabbit \(bot\) · /m);
  assert.match(r.stdout, /next: 1's live approve is by coderabbit \(bot\) — a bot's approve is recorded and counted apart, and clears an issue only where the loop's done gate names that bot \(done-gate "clears"\); this loop clears on an approve by a fresh agent, or by the owner — an approve that clears it is next — jarl\.mjs review 1 "<verdict>" --by "<a-fresh-reviewer>" "<text>"/);
  const said = refuses(root, 'set', '1', 'done', 'the bot approved', '--by', 'jarl');
  assert.match(said, /^1's live approve is by coderabbit \(bot\) — a bot's approve is recorded and counted apart, and clears an issue only where the loop's done gate names that bot/);
  assert.match(said, /\njarl\.mjs review "<ids>" "<verdict>" "<what-was-read-and-found>" --by "<a-fresh-reviewer>"\n$/);
  // The bot's approve keeps the branch out of the merge queue and marks the issue as waiting for an approve that clears it.
  assert.equal(json(root, 'status').inFlightRows.find((x) => x.id === '1').mark, 'approved-not-cleared');
  // An issue with no code is not cleared by a bot either.
  review(root, '4', 'coderabbit', '--bot');
  assert.match(refuses(root, 'set', '4', 'done', 'the bot approved', '--by', 'jarl'), /^4's live approve is by coderabbit \(bot\)/);
  // A fresh agent's approve clears both.
  review(root, '1', 'rev-a');
  review(root, '4', 'rev-a');
  assert.equal(done(root, '1').status, 0);
  assert.equal(done(root, '4').status, 0);
});

test('status and report count relayed and bot verdicts apart from fresh ones', () => {
  const root = botLoop();
  review(root, '1', 'coderabbit', '--bot');
  review(root, '1', 'rev-a');
  review(root, '2', 'rev-b', '--relayed');
  review(root, '3', 'rev-c');
  for (const id of ['1', '2', '3']) assert.equal(done(root, id).status, 0);
  const reviews = json(root, 'status').reviews;
  assert.deepEqual([reviews.fresh, reviews.relayed, reviews.coordinator, reviews.self, reviews.botVerdicts, reviews.relayedVerdicts], [2, 1, 0, 0, 1, 1]);
  assert.match(jarl(root, 'status'), /fresh 2 · coordinator 0 · self 0 · relayed 1 · of every verdict recorded, bot 1 and relayed 1/);
  const report = jarl(root, 'report');
  assert.match(report, /^Reviewed by: fresh 2 · coordinator 0 · self 0 · relayed 1 · of every verdict recorded, bot 1 and relayed 1$/m);
  assert.match(report, /^fresh reviews of closed work: 2 of 3 with a recorded reviewer \(66\.7%\) · coordinator 0 · self 0 · relayed 1 · bot 0 /m);
  const f = json(root, 'report').metrics.freshReviews;
  assert.deepEqual([f.fresh, f.relayed, f.bot, f.recorded, f.reviewers], [2, 1, 0, 3, { 'rev-a': 1, 'rev-c': 1 }]);
});

test('a loop that names a bot in its done gate reads that name as a bot\'s, and its approve clears', () => {
  const root = botLoop({ clears: ['fresh', 'owner', 'bot:coderabbit'] });
  review(root, '1', 'CodeRabbit');
  assert.match(log(root), / · 1 review approve · by CodeRabbit \(bot\) · /, 'a name the done gate names is a bot\'s without --bot');
  assert.equal(done(root, '1').status, 0);
  // Another bot is not named, and does not clear.
  review(root, '2', 'copilot', '--bot');
  assert.match(refuses(root, 'set', '2', 'done', 'the bot approved', '--by', 'jarl'), /^2 holds no approve that clears it under this loop's done gate \(done-gate "clears": an approve by a fresh agent, or by the owner, or by the bot coderabbit\) — the approves it holds are by copilot \(bot\)/);
  assert.match(jarl(root, 'profile'), /^done gate: approve fresh · clears on an approve by a fresh agent, or by the owner, or by the bot coderabbit$/m);
});

test('a loop may require a bot\'s approve and a fresh one together: either alone is refused, both clear, and the owner clears alone where it is named', () => {
  const root = botLoop({ clears: [['fresh', 'bot:coderabbit'], 'owner'] });
  review(root, '1', 'rev-a');
  const said = refuses(root, 'set', '1', 'done', 'fresh approve', '--by', 'jarl');
  assert.match(said, /^1 holds no approve that clears it under this loop's done gate \(done-gate "clears": an approve by a fresh agent and the bot coderabbit together, or by the owner\) — the approves it holds are by rev-a \(fresh\)/);
  assert.match(said, /\njarl\.mjs review "<ids>" "<verdict>" "<what-was-read-and-found>" --by "<reviewer>"\n$/);
  review(root, '2', 'coderabbit');
  assert.match(refuses(root, 'set', '2', 'done', 'bot approve', '--by', 'jarl'), /^2 holds no approve that clears it .* — the approves it holds are by coderabbit \(bot\)/);
  review(root, '1', 'coderabbit');
  assert.equal(done(root, '1').status, 0, 'a fresh approve and the bot\'s together clear it');
  review(root, '3', 'owner');
  assert.equal(done(root, '3').status, 0, 'the owner clears alone');
  // A changes verdict spends the approves before it: the pair is asked for again.
  review(root, '2', 'rev-b');
  run(root, ['review', '2', 'changes', '--by', 'coderabbit', 'Important: the edge case is not handled']);
  review(root, '2', 'rev-b');
  assert.match(refuses(root, 'set', '2', 'done', 'approved again', '--by', 'jarl'), /the approves it holds are by rev-b \(fresh\)/);
});

test('the done gate\'s clears is checked: a word it does not know, a bot with no name, an empty alternative and clears beside approve none are refused', () => {
  const root = makeLoop({ prefix: 'jarl-bot-bad-', via: 'cli' });
  const bad = (gate) => refuses(root, 'profile', profileFile(gate));
  assert.match(bad({ clears: ['agent'] }), /"done-gate": "clears" names "agent" — each entry is fresh, owner or bot:<name>, or a list of them that must all approve together/);
  assert.match(bad({ clears: ['bot:'] }), /"done-gate": "clears" names "bot:" — each entry is fresh, owner or bot:<name>/);
  assert.match(bad({ clears: [[]] }), /"done-gate": "clears" holds an empty list/);
  assert.match(bad({ clears: [] }), /"done-gate": "clears" names at least one way an issue is cleared/);
  assert.match(bad({ approve: 'none', 'requires-merged': true, clears: ['fresh'] }), /"done-gate": "clears" names whose approves clear an issue, and "approve": "none" asks for none/);
});

test('the first bot verdict raises a loop of format 1 to format 3, which both readers of the lower formats refuse; a composer\'s loop refuses it with nothing written', () => {
  const root = makeLoop({ prefix: 'jarl-bot-format-', via: 'cli' });
  const id = fileAsBefore(root, 'a change', { acceptance: 'it works' });
  jarl(root, 'set', id, 'in-progress', '--worker', 'w1', '--branch', 'jarl/1');
  jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'pass');
  jarl(root, 'review', id, 'approve', '--by', 'rev-a', FINDINGS);
  assert.equal(existsSync(join(root, '.jarl', 'profile.json')), false, 'a fresh verdict raises nothing');
  jarl(root, 'review', id, 'approve', '--by', 'coderabbit', '--bot', FINDINGS);
  assert.equal(JSON.parse(readFileSync(join(root, '.jarl', 'profile.json'), 'utf8')).format, 3);
  for (const read of [oldJarl, formatTwoJarl]) assert.match(read(root, 'status', {}).error, /written for record format 3/);

  const composed = makeLoop({ prefix: 'jarl-bot-composed-', via: 'cli', initFlags: ['--profile', (() => {
    const file = join(mkdtempSync(join(tmpdir(), 'jarl-bot-profile-')), 'profile.json');
    writeFileSync(file, JSON.stringify({ 'jarl-profile': 1, name: 'composed', statuses: BUILTIN_STATUSES, 'external-scheduler': 'the composer tick' }));
    return file;
  })()] });
  const cid = fileAsBefore(composed, 'a change', { acceptance: 'it works' });
  const before = log(composed);
  assert.match(refuses(composed, 'review', cid, 'approve', '--by', 'coderabbit', '--bot', FINDINGS), /a verdict by a bot needs record format 3, and this loop stays at format 1/);
  assert.equal(log(composed), before);
});

test('a bot\'s verdict given under the owner\'s name is a bot\'s, never the owner\'s: it does not clear', () => {
  const root = botLoop();
  assert.equal(review(root, '1', 'owner', '--bot').status, 0);
  assert.match(log(root), / · 1 review approve · by owner \(bot\) · /);
  assert.match(refuses(root, 'set', '1', 'done', 'the bot approved', '--by', 'jarl'), /^1's live approve is by owner \(bot\) — a bot's approve is recorded and counted apart/);
  assert.equal(json(root, 'status').inFlightRows.find((x) => x.id === '1').mark, 'approved-not-cleared');
  review(root, '4', 'owner', '--bot');
  assert.match(refuses(root, 'set', '4', 'done', 'the bot approved', '--by', 'jarl'), /^4's live approve is by owner \(bot\)/);
  // The owner's own approve clears both.
  review(root, '1', 'owner');
  review(root, '4', 'owner');
  assert.equal(done(root, '1').status, 0);
  assert.equal(done(root, '4').status, 0);
});

test('status flags an issue closed on a bot\'s approve alone by a move written into the log, with no code as with code', () => {
  const root = botLoop();
  const file = join(root, '.jarl', 'log.md');
  for (const id of ['1', '4']) {
    review(root, id, 'coderabbit', '--bot');
    // done refuses it, so the close comes from a writer that does not hold the rule: the move line written into the log.
    assert.equal(done(root, id).status, 1);
    const last = log(root).trim().split('\n').filter((l) => new RegExp(` · ${id} `).test(l)).pop();
    appendFileSync(file, `${last.split(' · ')[0]} · ${id} → done\n`);
  }
  const flags = json(root, 'status').closedGate;
  for (const id of ['1', '4']) {
    const f = flags.find((x) => x.id === id);
    assert.ok(f, `${id} is flagged`);
    assert.match(f.reason, /its live approve is a bot's, which clears an issue only where the loop's done gate names that bot \(the approves it holds are by coderabbit \(bot\)\)/);
    assert.match(f.repair, new RegExp(`review ${id} approve --by "<a-fresh-reviewer>"`));
  }
});

test('the closed gate names the cause of an approve that does not clear, and every approve that stands', () => {
  const close = (root, id) => {
    const last = log(root).trim().split('\n').filter((l) => new RegExp(` · ${id} `).test(l)).pop();
    appendFileSync(join(root, '.jarl', 'log.md'), `${last.split(' · ')[0]} · ${id} → done\n`);
  };
  const root = botLoop();
  review(root, '1', 'jarl');
  review(root, '1', 'coderabbit', '--bot');
  review(root, '2', 'coderabbit', '--bot');
  for (const id of ['1', '2']) close(root, id);
  const flags = Object.fromEntries(json(root, 'status').closedGate.map((f) => [f.id, f.reason]));
  assert.match(flags['1'], /it carries code and holds no fresh approve \(the approves it holds are by jarl \(coordinator\), coderabbit \(bot\)\)/);
  assert.match(flags['2'], /its live approve is a bot's, which clears an issue only where the loop's done gate names that bot \(the approves it holds are by coderabbit \(bot\)\)/);
  const defined = botLoop({ clears: [['fresh', 'bot:coderabbit'], 'owner'] });
  review(defined, '1', 'rev-a');
  close(defined, '1');
  assert.match(json(defined, 'status').closedGate.find((f) => f.id === '1').reason, /it holds no approve that clears it under the loop's done gate \(done-gate "clears": an approve by a fresh agent and the bot coderabbit together, or by the owner; the approves it holds are by rev-a \(fresh\)\)/);
});

test('done refuses a code issue holding a coordinator\'s approve and a bot\'s, naming both', () => {
  const root = botLoop();
  review(root, '1', 'jarl');
  review(root, '1', 'coderabbit', '--bot');
  const said = refuses(root, 'set', '1', 'done', 'two approves', '--by', 'jarl');
  assert.match(said, /^1 carries code \(Merged is recorded\) and its live approve is by jarl \(coordinator\), and it holds the approve of coderabbit \(bot\) as well — the fresh-review rule: /);
  assert.match(said, /a coordinator's approve does not clear it, and a bot's clears only where the loop's done gate names that bot:/);
});

test('a bot\'s verdict refused in a composer\'s loop ends with the profile view and the form of the call, with no value after --bot', () => {
  const composed = makeLoop({ prefix: 'jarl-bot-composed-form-', via: 'cli', initFlags: ['--profile', (() => {
    const file = join(mkdtempSync(join(tmpdir(), 'jarl-bot-profile-')), 'profile.json');
    writeFileSync(file, JSON.stringify({ 'jarl-profile': 1, name: 'composed', statuses: BUILTIN_STATUSES, 'external-scheduler': 'the composer tick' }));
    return file;
  })()] });
  const id = fileAsBefore(composed, 'a change', { acceptance: 'it works' });
  const said = refuses(composed, 'review', id, 'approve', '--by', 'coderabbit', '--bot', FINDINGS);
  const [view, form] = said.trim().split('\n').slice(-2);
  assert.equal(view, 'jarl.mjs profile');
  assert.match(form, /^jarl\.mjs review .* --bot$/);
});

test('--bot names a bot, never the loop\'s director or the issue\'s worker', () => {
  const root = botLoop();
  assert.match(refuses(root, 'review', '1', 'approve', '--by', 'jarl', '--bot', FINDINGS), /jarl reviews as the loop's director \(coordinator\), and --bot records a bot's verdict/);
  assert.match(refuses(root, 'review', '1', 'approve', '--by', 'w1', '--bot', FINDINGS), /self-approve/);
});
