// An acceptance line only the owner ticks: it is written "[owner] <line> · material: <what to review> · check: <what to
// check>", and a line so marked that does not name both is refused. While it is not ticked, done refuses and names it;
// next --as puts it on whoever produces its material until the material is there, then on the owner, whose digest gives
// the material and the instruction; tick records who ticked it and when, and the issues that wait on it with After stay
// unoffered until it is done.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FINDINGS } from './findings.mjs';
import { formatTwoJarl } from './old-jarl.mjs';
import { jarl, refuses, loop as makeLoop } from './helpers.mjs';
import * as R from '../record.mjs';
import * as L from '../jarl-lib.mjs';

const loop = () => makeLoop({ prefix: 'jarl-owner-line-', via: 'cli' });
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const profileFile = (root) => join(root, '.jarl', 'profile.json');
const logText = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const issueText = (root, id) => readFileSync(R.findIssue(root, id).file, 'utf8');

const CUT = 'renders/cut.txt';
const OWNER_LINE = `[owner] the first cut reads well · material: ${CUT} · check: the pacing of the opening and the captions`;

// A loop with one issue whose second acceptance line is the owner's, leased to a worker, and an issue that waits on it.
function signOffLoop() {
  const root = loop();
  jarl(root, 'new', 'cut the film', '--files', 'film.md', '--acceptance', 'the cut renders', '--acceptance', OWNER_LINE);   // 1
  jarl(root, 'new', 'publish the film', '--files', 'publish.md', '--after', '1', '--acceptance', 'it is published');       // 2
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1');
  return root;
}
// The material the worker produces, on the disk where the loop sees it.
function produce(root) {
  mkdirSync(join(root, 'renders'), { recursive: true });
  writeFileSync(join(root, CUT), 'the cut\n');
}
// Proof and a fresh approve: everything done asks for besides the owner's tick.
function proveAndApprove(root) {
  jarl(root, 'evidence', '1', '--ran', 'render the cut', '--saw', 'renders/cut.txt written');
  jarl(root, 'review', '1', 'approve', '--by', 'rev', FINDINGS);
}

test('a line marked as the owner\'s must name its material and what to check, and its first write raises the record format', () => {
  const root = loop();
  for (const bad of [
    '[owner] the first cut reads well',
    '[owner] the first cut reads well · material: renders/cut.txt',
    '[owner] the first cut reads well · check: the pacing',
    '[owner] the first cut reads well · material:  · check: the pacing',
    '[owner] the first cut reads well · material: <material> · check: the pacing',
    '[owner] the first cut reads well · material: renders/cut.txt · check: <what to check>',
    '[owner] · material: renders/cut.txt · check: the pacing',
  ]) {
    assert.match(refuses(root, 'new', 'cut the film', '--acceptance', bad), /acceptance line ".*" is marked as one only the owner ticks, and it must name the material he reviews \(a path, a link or an artifact\) and what he checks/, bad);
  }
  assert.equal(R.loadIssues(root).length, 0, 'nothing was filed');
  assert.equal(existsSync(profileFile(root)), false, 'nothing was raised');
  assert.equal(formatTwoJarl(root, 'list', {}).ok, true, 'before the mark, a reader of formats 1 and 2 reads the loop');

  jarl(root, 'new', 'cut the film', '--acceptance', 'the cut renders', '--acceptance', OWNER_LINE);
  assert.match(issueText(root, '1'), new RegExp(`^- ${OWNER_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), 'the line is kept as written');
  assert.equal(JSON.parse(readFileSync(profileFile(root), 'utf8')).format, 3, 'the mark raised the format');
  const old = formatTwoJarl(root, 'list', {});
  assert.equal(old.ok, false, 'a reader that would let done pass over the line refuses the loop instead');
  assert.match(old.error, /written for record format 3/);

  // body writes the mark by the same rule.
  jarl(root, 'new', 'second', '--acceptance', 'plain');
  assert.match(refuses(root, 'body', '2', '--acceptance', '[owner] looks right'), /is marked as one only the owner ticks/);
  jarl(root, 'body', '2', '--acceptance', '[Owner] looks right · material: https://example.com/preview · check: the colours');
  assert.equal(json(root, 'show', '2').sections.acceptance.trim(), '[Owner] looks right · material: https://example.com/preview · check: the colours');
});

test('a loop run by a composer refuses an owner line and writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-owner-line-composed-'));
  mkdirSync(join(dir, '.git'));
  const profile = join(mkdtempSync(join(tmpdir(), 'jarl-owner-line-profile-')), 'profile.json');
  writeFileSync(profile, JSON.stringify({ 'jarl-profile': 1, name: 'composed', statuses: L.BUILTIN_STATUSES, 'external-scheduler': 'the composer tick' }, null, 2));
  jarl(dir, 'init', 'a mission', '--profile', profile);
  assert.match(refuses(dir, 'new', 'cut the film', '--acceptance', OWNER_LINE), /an acceptance line only the owner ticks needs record format 3, and this loop stays at format 1: its profile names an external scheduler.*nothing was written/s);
  assert.equal(R.loadIssues(dir).length, 0);
});

test('set done refuses while an owner line is not ticked, naming the line, its material and what to check, and passes once he ticks it', () => {
  const root = signOffLoop();
  produce(root);
  proveAndApprove(root);
  const refusal = refuses(root, 'set', '1', 'done', 'finished');
  assert.match(refusal, /^1 waits for the owner's sign-off on acceptance line 2, "the first cut reads well": he reviews renders\/cut\.txt and checks the pacing of the opening and the captions; only he ticks it, once he has looked: jarl\.mjs tick 1 2 --by owner/m);
  assert.equal(json(root, 'show', '1').status, 'in-progress', 'nothing was written');

  const ticked = json(root, 'tick', '1', '2', '--by', 'owner');
  assert.deepEqual([ticked.id, ticked.line, ticked.by], ['1', 2, 'owner']);
  assert.match(ticked.at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.match(logText(root), /^- \d{4}-\d{2}-\d{2} \d{2}:\d{2} · 1 tick · line 2 · by owner · \[owner\] the first cut reads well · material: renders\/cut\.txt · check: the pacing of the opening and the captions$/m);
  assert.match(jarl(root, 'show', '1'), /^owner's sign-off: acceptance line 2 ticked by owner \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/m);
  jarl(root, 'set', '1', 'done', 'finished');
  assert.equal(json(root, 'show', '1').status, 'done');
});

test('a tick counts for the line it was given on: a round spends it, and a line rewritten after it waits for a tick of its own', () => {
  const root = signOffLoop();
  produce(root);
  proveAndApprove(root);
  jarl(root, 'tick', '1', '2', '--by', 'owner');
  // A red round sends the work back: the material is made again, and the owner looks at it again.
  jarl(root, 'round', '1', 'the captions drift');
  jarl(root, 'evidence', '1', '--ran', 'render the cut again', '--saw', 'renders/cut.txt written');
  jarl(root, 'review', '1', 'approve', '--by', 'rev', FINDINGS);
  assert.match(refuses(root, 'set', '1', 'done', 'finished'), /waits for the owner's sign-off on acceptance line 2, .*; his tick of \d{4}-\d{2}-\d{2} \d{2}:\d{2} came before the work was sent back or started again, so it does not count/);
  jarl(root, 'tick', '1', '2', '--by', 'owner');
  // A rewritten line is another line: the tick of the old one does not hold it.
  jarl(root, 'body', '1', '--acceptance', 'the cut renders', '--acceptance', `[owner] the second cut reads well · material: ${CUT} · check: the captions`);
  assert.match(refuses(root, 'set', '1', 'done', 'finished'), /waits for the owner's sign-off on acceptance line 2, "the second cut reads well"/);
  jarl(root, 'tick', '1', '2', '--by', 'owner');
  jarl(root, 'set', '1', 'done', 'finished');
});

test('tick takes the owner\'s word on an owner line whose material is there, once', () => {
  const root = signOffLoop();
  assert.match(refuses(root, 'tick', '1', '2'), /needs --by owner/);
  assert.match(refuses(root, 'tick', '1', '2', '--by', 'jarl'), /only the owner ticks an owner line: --by owner/);
  assert.match(refuses(root, 'tick', '1', '1', '--by', 'owner'), /acceptance line 1 of 1 is not marked as one only the owner ticks; its owner lines: 2/);
  assert.match(refuses(root, 'tick', '1', '3', '--by', 'owner'), /1 has 2 acceptance lines: there is no line 3; its owner lines: 2/);
  assert.match(refuses(root, 'tick', '2', '1', '--by', 'owner'), /2 has no acceptance line marked as one only the owner ticks/);
  assert.match(refuses(root, 'tick', '1', '2', '--by', 'owner'), /the material of acceptance line 2 of 1 is not there yet: no proof of the work is recorded after it was started or last sent back.*nothing was written/s);
  jarl(root, 'evidence', '1', '--ran', 'render the cut', '--saw', 'written');
  assert.match(refuses(root, 'tick', '1', '2', '--by', 'owner'), /the material of acceptance line 2 of 1 is not there yet: renders\/cut\.txt is not found/);
  produce(root);
  jarl(root, 'tick', '1', '2', '--by', 'the Owner');
  assert.match(refuses(root, 'tick', '1', '2', '--by', 'owner'), /acceptance line 2 of 1 is ticked already, by owner at \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  assert.match(refuses(root, 'log', '1 tick · line 2 · by owner · [owner] x · material: y · check: z'), /reads as a tick line, .*jarl\.mjs tick <id> <line> --by owner/);
});

test('next --as puts an owner line on whoever produces its material, then on the owner with the material and the instruction, and what waits on it with After stays unoffered', () => {
  const root = signOffLoop();
  const onJarl = () => json(root, 'next', '--as', 'jarl', '--all').rows.filter((r) => r.what === 'sign-off');
  const onOwner = () => json(root, 'next', '--as', 'owner', '--all').rows.filter((r) => r.what === 'sign-off');
  // No proof yet: the worker produces the material.
  assert.deepEqual(onJarl().map((r) => [r.id, r.line, r.doer]), [['1', 2, 'w1']]);
  assert.deepEqual(onOwner(), []);
  assert.match(jarl(root, 'next', '--as', 'jarl', '--all'), /^- 1 cut the film: acceptance line 2 is the owner's to tick once its material is there \(renders\/cut\.txt\); no proof of the work is recorded after it was started or last sent back \(worker w1\) — jarl\.mjs evidence 1 --ran "<command>" --saw "<what it printed>" · holds up 2$/m);
  // Proof, and the file is not there: still the producer's.
  proveAndApprove(root);
  assert.match(jarl(root, 'next', '--as', 'jarl', '--all'), /^- 1 cut the film: acceptance line 2 is the owner's to tick once its material is there \(renders\/cut\.txt\); renders\/cut\.txt is not found under the loop's root, the issue's repositories or its worktree \(worker w1\) — /m);
  assert.doesNotMatch(jarl(root, 'next', '--as', 'jarl', '--all'), /^- 1 cut the film: approved; close it/m, 'a close done would refuse is not offered');
  // The material is there: the line is the owner's, in his digest with the material and the instruction.
  produce(root);
  assert.deepEqual(onJarl(), []);
  assert.deepEqual(onOwner().map((r) => [r.id, r.line]), [['1', 2]]);
  const digest = jarl(root, 'next', '--as', 'owner', '--all');
  assert.match(digest, /^On the owner \(1\)\n- 1 cut the film: acceptance line 2 is yours to tick: review renders\/cut\.txt and check the pacing of the opening and the captions \(worker w1\) — jarl\.mjs tick 1 2 --by owner · holds up 2$/m);
  assert.match(digest, /^Waiting on the owner \(1\)\n- 2 publish the film: waits on the owner via 1$/m);
  assert.deepEqual(json(root, 'next').map((r) => r.id), [], 'the issue that waits on it with After is not offered');
  // Ticked: off his list, and the close is the jarl's again; the issue after it is offered once it is done.
  jarl(root, 'tick', '1', '2', '--by', 'owner');
  assert.deepEqual(onOwner(), []);
  assert.match(jarl(root, 'next', '--as', 'jarl', '--all'), /^- 1 cut the film: approved; close it \(worker w1\) — jarl\.mjs set 1 done "<why>" · holds up 2$/m);
  assert.deepEqual(json(root, 'next').map((r) => r.id), []);
  jarl(root, 'set', '1', 'done', 'finished');
  assert.deepEqual(json(root, 'next').map((r) => r.id), ['2']);
});
