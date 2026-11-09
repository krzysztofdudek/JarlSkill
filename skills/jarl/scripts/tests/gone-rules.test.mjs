// What the loop does not do: the tag identical-output means nothing, a comparison is a [compare] line and its examiner may
// be a light one; a leased issue that changes its lines carries no mark of it; no rule reaches a reviewer by the tier of the
// work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jarl, loop as makeLoop, refuses, run } from './helpers.mjs';
import { BUILTIN_RULES, BUILTIN_STATUSES } from '../jarl-lib.mjs';

const R = await import('../record.mjs');
const logOf = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const profileFile = (gate) => {
  const file = join(mkdtempSync(join(tmpdir(), 'jarl-gone-profile-')), 'profile.json');
  writeFileSync(file, JSON.stringify({ 'jarl-profile': 1, statuses: BUILTIN_STATUSES, initial: 'open', 'done-gate': gate }));
  return file;
};
// A loop whose done gate reads an approve's model, with a light and a strong line; an issue leased on the strong model.
function ranked(acceptance, flags = []) {
  const root = makeLoop({ prefix: 'jarl-gone-', via: 'cli', dotGit: false, initFlags: ['--profile', profileFile({ reviewer: 'model-rank' })] });
  jarl(root, 'goal', '--set', 'Model (light): m-light');
  jarl(root, 'goal', '--set', 'Model (strong): m-strong');
  jarl(root, 'new', 'split the renderer', '--tier', 'standard', '--files', 'render.mjs', '--acceptance', acceptance, ...flags);
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1', '--model', 'm-strong');
  return root;
}
const COMPARE = '[compare] the report is unchanged · by: node report.mjs';
const rows = (root) => {
  jarl(root, 'evidence', '1', '--line', '1', '--ran', 'node report.mjs', '--saw', 'report sha1 aaaa', '--by', 'w1');
  jarl(root, 'evidence', '1', '--line', '1', '--ran', 'node report.mjs', '--saw', 'report sha1 aaaa', '--by', 'w1');
  jarl(root, 'evidence', '1', '--line', '1', '--ran', 'node report.mjs', '--saw', 'report sha1 aaaa', '--by', 'rev-1');
};

test('a change whose lines are all comparisons may be cleared by a light examiner, where the rule asks for one of the worker\'s rank', () => {
  const root = ranked(COMPARE);
  rows(root);
  const r = run(root, ['review', '1', 'approve', '--by', 'rev-1', '--model', 'm-light', 'the comparison covers every file the change touched']);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /ranks below the worker's model/);
  assert.match(r.stderr, /every line is a comparison, so a light review may clear it/);
  assert.match(jarl(root, 'set', '1', 'done', 'the output is the same'), /1 → done/);
});

test('the tag identical-output makes a line no comparison: a [read] issue tagged with it is held to the worker\'s rank like any other', () => {
  const root = ranked('[read] the report is unchanged', ['--tags', 'identical-output']);
  const r = run(root, ['review', '1', 'approve', '--by', 'rev-1', '--model', 'm-light', 'the comparison covers every file the change touched']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /m-light ranks below the worker's model \(m-strong\)/);
  assert.match(refuses(root, 'set', '1', 'done', 'the output is the same'), /ranks below|is refused|m-light/);
});

test('the tag identical-output and a comparison row together let no light approve through: only the lines say what is a comparison', () => {
  const root = ranked('[read] the report is unchanged', ['--tags', 'identical-output']);
  jarl(root, 'evidence', '1', '--line', '1', '--ran', 'node report.mjs && cmp before.txt after.txt', '--saw', 'cmp printed nothing, identical', '--by', 'w1');
  const r = run(root, ['review', '1', 'approve', '--by', 'rev-1', '--model', 'm-light', 'the comparison covers every file the change touched']);
  assert.match(r.stderr, /ranks below the worker's model/);
});

test('a brief of a tagged issue says nothing of the tag', () => {
  const root = ranked('[read] the report is unchanged', ['--tags', 'identical-output']);
  for (const role of ['worker', 'reviewer']) {
    const text = jarl(root, 'brief', '1', '--role', role);
    assert.doesNotMatch(text, /meant to alter nothing/, role);
  }
});

test('the rules of the reviewer hold no re-run by tier, no tag and no review unit of four', () => {
  const slugs = BUILTIN_RULES.map((r) => r.slug);
  for (const gone of ['jarl:reviewer-light-tier', 'jarl:reviewer-identical-output', 'jarl:coordinator-shared-review']) assert.ok(!slugs.includes(gone), gone);
  const root = ranked('[read] it works');
  jarl(root, 'field', '1', 'Tier', 'light');
  const text = jarl(root, 'brief', '1', '--role', 'reviewer');
  assert.doesNotMatch(text, /On work done on the light tier/);
  assert.match(text, /Proof to re-run|re-run/);
});

test('a change of the lines of a leased issue carries no mark of it: the log keeps the old text whole, and the brief shows the change', () => {
  const root = ranked('[read] it works');
  const r = JSON.parse(jarl(root, 'field', '1', 'Acceptance', '[read] it works\n[read] a new requirement', '--by', 'jarl', '--json'));
  assert.equal(r.grew, undefined);
  assert.doesNotMatch(logOf(root), /grew after the lease/);
  assert.match(logOf(root), / body · acceptance · was "\[read\] it works" · by jarl/);
  assert.doesNotMatch(jarl(root, 'report'), /scope grew after the lease/);
  assert.equal(JSON.parse(jarl(root, 'report', '--json')).metrics?.slips?.scopeGrew, undefined);
});

test('an issue split onto a leased sub-issue writes no mark either', () => {
  const root = makeLoop({ prefix: 'jarl-gone-', via: 'cli', dotGit: false });
  jarl(root, 'new', 'the parent', '--acceptance', '[read] one', '--acceptance', '[read] two');
  jarl(root, 'new', 'the sub', '--acceptance', '[read] its own');
  jarl(root, 'set', '2', 'in-progress', 'go', '--worker', 'w1');
  const out = JSON.parse(jarl(root, 'split', '1', '--line', '1=1', '--line', '2=2', '--by', 'jarl', '--json'));
  assert.equal(out.grew, undefined);
  assert.doesNotMatch(logOf(root), /grew after the lease/);
});

test('the library writes a change of the lines as the command line does', () => {
  const root = makeLoop({ prefix: 'jarl-gone-' });
  const { id } = R.newIssue(root, 'one', { acceptance: '[read] first', by: 'jarl' });
  R.setStatus(root, id, 'in-progress', '', { worker: 'w1', by: 'jarl' });
  const out = R.setBody(root, id, { acceptance: ['[read] first', '[read] second'], by: 'jarl' });
  assert.equal(out.grew, undefined);
  assert.doesNotMatch(logOf(root), /grew after/);
});
