// brief: the text a worker, a reviewer or a coordinator is raised with, assembled from the record when asked. It carries
// the issue as show prints it, the rules that reach that reader and none other, the rounds so far and the findings that
// sent the work back, the proof rows, the role's reference and the commands that record the result; it writes nothing,
// leaves out where things are on this machine, and cuts nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, jarl, posixForms, refuses, spawnJarl, loop as makeLoop } from './helpers.mjs';
import { shellWord } from '../jarl-lib.mjs';
import * as R from '../record.mjs';
import { FINDINGS } from './findings.mjs';
import { fileAsBefore, fileAsFormatTwo, formatTwoJarl, oldJarl } from './old-jarl.mjs';

const loop = () => makeLoop({ prefix: 'jarl-brief-', via: 'cli', dotGit: false });
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const slugs = (o) => o.rules.map((r) => r.slug);
// Every file of the loop with its text, so a test sees that a call wrote nothing.
const snapshot = (root) => {
  const dir = join(root, '.jarl');
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [[join(d, e.name), readFileSync(join(d, e.name), 'utf8')]]));
  return Object.fromEntries(walk(dir));
};

// A loop with two slices, a ui issue in each slice and one in none, and a rule of every reach.
const LONG = `Every report names the branch it was made on and the commit at its tip; ${'a rule is printed whole, '.repeat(12)}to its last word.`;
function rulesLoop() {
  const root = loop();
  jarl(root, 'goal', '--set', 'Coordinators: odin, frigg');
  jarl(root, 'new', 'odin ui', '--tags', 'slice:odin,ui', '--files', 'a.mjs', '--acceptance', 'the screen shows the count');   // 1
  jarl(root, 'new', 'frigg work', '--tags', 'slice:frigg', '--files', 'b.mjs');                                                // 2
  jarl(root, 'new', 'jarl ui', '--tags', 'ui', '--files', 'c.mjs', '--tier', 'light');                                         // 3
  jarl(root, 'decide', 'loop-rule', LONG, '--applies-to', 'loop', '--by', 'coordinator');
  jarl(root, 'decide', 'coordinators', 'Coordinators report in one line.', '--applies-to', 'role coordinator', '--by', 'coordinator');
  jarl(root, 'decide', 'odin-only', 'Odin keeps the ui screens together.', '--applies-to', 'slice odin', '--by', 'coordinator');
  jarl(root, 'decide', 'frigg-only', 'Frigg asks before touching the parser.', '--applies-to', 'slice frigg', '--by', 'coordinator');
  jarl(root, 'decide', 'ui-workers', 'A ui worker attaches a screenshot.', '--applies-to', 'role worker and tag ui', '--by', 'coordinator');
  jarl(root, 'decide', 'reviewers', 'Reviewers run the suite themselves.', '--applies-to', 'role reviewer', '--by', 'coordinator');
  jarl(root, 'decide', 'takeovers', 'A worker after a takeover reads every round first.', '--applies-to', 'role takeover', '--by', 'coordinator');
  jarl(root, 'decide', 'gone', 'An ended rule.', '--applies-to', 'loop', '--until', '2000-01-01', '--by', 'coordinator');
  return root;
}

test('brief <id> is the worker\'s: the issue as show prints it, the rules that reach its worker and none of another slice or role, and the commands that record the proof', () => {
  const root = rulesLoop();
  const before = snapshot(root);
  const o = json(root, 'brief', '1');
  assert.equal(o.role, 'worker');
  assert.deepEqual(o.roles, ['worker']);
  assert.deepEqual(o.moments, ['start']);
  assert.deepEqual(slugs(o), ['loop-rule', 'odin-only', 'ui-workers', 'jarl:worker-only-the-issue']);
  for (const absent of ['coordinators', 'frigg-only', 'reviewers', 'takeovers', 'gone', 'jarl:coordinator-escalates', 'jarl:reviewer-tier-above']) assert.ok(!slugs(o).includes(absent), absent);
  assert.deepEqual(o.reference, { file: 'references/worker.md', section: "The worker's brief" });
  const text = jarl(root, 'brief', '1');
  assert.match(text, /^The worker's brief for issue 1, assembled from the record; it writes nothing\.\n\n# 1 · odin ui\n/);
  assert.ok(text.includes(jarl(root, 'show', '1')), 'the issue as show prints it');
  assert.ok(text.includes(LONG), 'a rule is printed whole');
  assert.match(text, /\n## Rules for the worker of 1 \(4\)\n- loop-rule · loop · by coordinator — /);
  assert.equal(o.rulings.inForce, json(root, 'decisions', '--live').length, 'every ruling in force is counted, as decisions --live lists them');
  assert.match(text, /\n- jarl:worker-only-the-issue [^\n]*\n7 ruling\(s\) in force in the loop: jarl\.mjs decisions --live\n/);
  assert.doesNotMatch(text, /Frigg asks|Reviewers run|Coordinators report|An ended rule|after a takeover/);
  assert.match(text, /\n## The role\nreferences\/worker\.md, section "The worker's brief", in the jarl skill's directory/);
  assert.match(text, /\n## Recording the result\n- proof, one row per check: jarl\.mjs evidence 1 --ran "<command>" --saw "<what-it-printed>" --by "<who>"\n- the changelog entry, for a change someone sees: jarl\.mjs field 1 Changelog "<changelog-entry>" --add --by "<who>"$/);
  // The worker of an issue in no slice gets no slice's rule, and the rule of a tag reaches it.
  assert.deepEqual(slugs(json(root, 'brief', '3')), ['loop-rule', 'ui-workers', 'jarl:worker-only-the-issue']);
  assert.deepEqual(slugs(json(root, 'brief', '2')), ['loop-rule', 'frigg-only', 'jarl:worker-only-the-issue']);
  assert.deepEqual(snapshot(root), before, 'brief writes nothing');
});

test('brief <id> --role reviewer carries the rules of the reviewer, of the round once one sent the work back, the rounds, their findings whole and the proof rows', () => {
  const root = rulesLoop();
  assert.deepEqual(slugs(json(root, 'brief', '3', '--role', 'reviewer')), ['loop-rule', 'reviewers', 'jarl:reviewer-light-tier', 'jarl:reviewer-tier-above', 'jarl:reviewer-identical-output', 'jarl:reviewer-judges-the-issue'], 'at the first review, no rule of the round');
  jarl(root, 'set', '3', 'in-progress', 'go', '--worker', 'w3', '--branch', 'jarl/3-ui');
  jarl(root, 'evidence', '3', '--ran', 'npm test', '--saw', 'tests 4, pass 3, fail 1');
  const finding = `Important: the count is off by one on the last page.\nMinor: ${'the name of the helper could say more, '.repeat(8)}end of the finding.`;
  jarl(root, 'review', '3', 'changes', '--by', 'rev1', finding);
  jarl(root, 'round', '3', 'the count is off by one', '--findings', '2');
  jarl(root, 'evidence', '3', '--ran', 'npm test', '--saw', 'tests 4, pass 4, fail 0');
  const o = json(root, 'brief', '3', '--role', 'reviewer');
  assert.equal(o.role, 'reviewer');
  assert.deepEqual(o.moments, ['review', 'round']);
  assert.deepEqual(slugs(o), ['loop-rule', 'reviewers', 'jarl:reviewer-every-round', 'jarl:reviewer-light-tier', 'jarl:reviewer-tier-above', 'jarl:reviewer-identical-output', 'jarl:reviewer-judges-the-issue']);
  for (const absent of ['ui-workers', 'odin-only', 'coordinators', 'jarl:worker-only-the-issue']) assert.ok(!slugs(o).includes(absent), absent);
  assert.equal(o.rounds.length, 1);
  assert.match(o.rounds[0].text, /^round 1 \(count 1 of 3\) · findings 2 · the count is off by one$/);
  assert.deepEqual(o.findings.map((f) => [f.by, f.kind, f.text]), [['rev1', 'fresh', finding]], 'the finding is whole');
  assert.deepEqual(o.proof, [{ n: 1, ran: 'npm test', saw: 'tests 4, pass 3, fail 1' }, { n: 2, ran: 'npm test', saw: 'tests 4, pass 4, fail 0' }]);
  const text = jarl(root, 'brief', '3', '--role', 'reviewer');
  assert.match(text, /^The reviewer's brief for issue 3/);
  assert.match(text, /\n## Rounds so far \(1\)\n- \d{4}-\d{2}-\d{2} \d{2}:\d{2} · round 1 \(count 1 of 3\) · findings 2 · the count is off by one\n/);
  assert.match(text, /\n## Findings of the reviews that sent it back \(1\)\n- \d{4}-\d{2}-\d{2} · by rev1 \(fresh\) — Important: the count is off by one on the last page\.\n {2}Minor: the name/);
  assert.ok(text.includes('end of the finding.'));
  assert.match(text, /\n## Proof rows \(2\)\n- \[1\] ran: npm test · saw: tests 4, pass 3, fail 1\n- \[2\] ran: npm test · saw: tests 4, pass 4, fail 0\n/);
  assert.match(text, /\n## Recording the result\n- the verdict when a finding lies outside the issue, one --outside each \(filed as a new issue, never a reason for changes\): jarl\.mjs review 3 "<verdict>" "<findings-with-a-severity>" --by "<reviewer>" --model "<model-id>" --outside "<finding-outside-the-issue>"\n- the verdict, as the last step: jarl\.mjs review 3 "<verdict>" "<findings-with-a-severity>" --by "<reviewer>" --model "<model-id>"$/);
  // A done issue keeps its reviewer's brief; its worker's says it starts once reopened.
  jarl(root, 'review', '3', 'approve', '--by', 'rev2', FINDINGS);
  jarl(root, 'merged', '3', '--sha', 'abc1234');
  jarl(root, 'set', '3', 'done', 'approved');
  assert.equal(json(root, 'brief', '3', '--role', 'reviewer').rounds.length, 1);
  assert.match(jarl(root, 'brief', '3'), /\nnote: 3 is done: a worker starts on it once it is reopened — jarl\.mjs set 3 open "<why>"\n/);
});

test('an issue whose file holds no Reviews section is briefed with the findings its journal holds, without the verdict and reviewer repeated', () => {
  const root = loop();
  jarl(root, 'new', 'the work');
  jarl(root, 'review', '1', 'changes', '--by', 'rev1', 'Important: the count is off by one on the last page.');
  const [file] = readdirSync(join(root, '.jarl', 'issues'));
  const path = join(root, '.jarl', 'issues', file);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/\n## Reviews\n[\s\S]*?(?=\n## |$)/, '\n'));
  assert.doesNotMatch(readFileSync(path, 'utf8'), /## Reviews|off by one/, 'the file holds no review: the journal is all there is');
  const [f] = json(root, 'brief', '1', '--role', 'reviewer').findings;
  assert.deepEqual([f.by, f.kind], ['rev1', 'fresh']);
  assert.match(f.text, /^Important: the count is off by one on the last page\./);
});

// Lines a writer that keeps its verdicts and rounds in the journal alone writes, with no mark of a takeover on a round.
const journalOnly = (root, ...texts) => {
  const log = join(root, '.jarl', 'log.md');
  writeFileSync(log, `${readFileSync(log, 'utf8').replace(/\n*$/, '\n')}${texts.map((t) => `- 2026-11-01 10:00 · ${t}\n`).join('')}`);
};
const issueFile = (root) => join(root, '.jarl', 'issues', readdirSync(join(root, '.jarl', 'issues'))[0]);

// The findings a reviewer's brief lists, as [by, text], and the count its text heading gives, which is the number listed.
const findingsListed = (root, id) => {
  const o = json(root, 'brief', id, '--role', 'reviewer');
  const heading = /\n## Findings of the reviews that sent it back \((\d+)\)\n/.exec(jarl(root, 'brief', id, '--role', 'reviewer'));
  assert.equal(Number(heading[1]), o.findings.length, 'the heading counts what is listed');
  return o;
};
const fileOnlyNote = /review\(s\) of the Reviews section of 1 match no verdict line of its log/;

test('a journal-only writer\'s verdict first and a file\'s after it: every changes verdict of the log once, in the log\'s order, the file\'s whole', () => {
  const root = loop();
  jarl(root, 'new', 'the work');
  journalOnly(root, '1 review changes · by old1 (fresh) · Important: the first finding, written in the journal alone.', '1 round 1 · the first round');
  const second = 'Important: the second finding.\nMinor: its second line, kept whole.';
  jarl(root, 'review', '1', 'changes', '--by', 'rev2', second);
  jarl(root, 'round', '1', 'the second round');
  const o = findingsListed(root, '1');
  assert.equal(o.rounds.length, 2);
  assert.deepEqual(o.findings.map((f) => [f.by, f.text]), [['old1', 'Important: the first finding, written in the journal alone.'], ['rev2', second]]);
  assert.doesNotMatch(o.notes.join('\n'), fileOnlyNote);
});

test('two journal-only verdicts, one this Jarl wrote, then a fourth journal-only one: rev-a to rev-d each once, in the log\'s order, rev-c whole', () => {
  const root = loop();
  jarl(root, 'new', 'the work');
  journalOnly(root, '1 review changes · by rev-a (fresh) · Important: finding a.', '1 round 1 · a', '1 review changes · by rev-b (fresh) · Important: finding b.', '1 round 2 · b');
  const c = 'Important: finding c.\nMinor: the second line of c.';
  jarl(root, 'review', '1', 'changes', '--by', 'rev-c', c);
  journalOnly(root, '1 round 3 · c', '1 review changes · by rev-d (fresh) · Important: finding d.');
  const o = findingsListed(root, '1');
  assert.deepEqual(o.findings.map((f) => [f.by, f.text]), [['rev-a', 'Important: finding a.'], ['rev-b', 'Important: finding b.'], ['rev-c', c], ['rev-d', 'Important: finding d.']]);
  assert.doesNotMatch(o.notes.join('\n'), fileOnlyNote);
});

test('a file that lost its newest Reviews entry: each verdict once, the one the file holds whole and the other from its log line, no note', () => {
  const root = loop();
  jarl(root, 'new', 'the work');
  jarl(root, 'review', '1', 'changes', '--by', 'rev-a', 'Important: finding a.\nMinor: a second line of a.');
  jarl(root, 'review', '1', 'changes', '--by', 'rev-c', 'Important: finding c.');
  writeFileSync(issueFile(root), readFileSync(issueFile(root), 'utf8').replace(/\n- \*\*changes\*\* · by rev-c [\s\S]*?(?=\n## |$)/, '\n'));
  assert.doesNotMatch(readFileSync(issueFile(root), 'utf8'), /finding c/);
  const o = findingsListed(root, '1');
  assert.deepEqual(o.findings.map((f) => [f.by, f.text]), [['rev-a', 'Important: finding a.\nMinor: a second line of a.'], ['rev-c', 'Important: finding c.']]);
  assert.deepEqual(o.notes.filter((n) => fileOnlyNote.test(n)), []);
});

test('a loop whose log holds no review line gives the file\'s entries, each once, marked as the issue file\'s alone', () => {
  const root = loop();
  jarl(root, 'new', 'the work');
  jarl(root, 'review', '1', 'changes', '--by', 'rev1', 'Important: only the file keeps this.');
  const log = join(root, '.jarl', 'log.md');
  writeFileSync(log, readFileSync(log, 'utf8').split('\n').filter((l) => !/ · 1 review changes /.test(l)).join('\n'));
  const o = findingsListed(root, '1');
  assert.deepEqual(o.findings.map((f) => [f.by, f.text, f.fileOnly]), [['rev1', 'Important: only the file keeps this.', true]]);
  assert.match(o.notes.join('\n'), /^1 review\(s\) of the Reviews section of 1 match no verdict line of its log, which is the record: listed after the log's, marked in the issue file only$/m);
  assert.match(jarl(root, 'brief', '1', '--role', 'reviewer'), /\n- \d{4}-\d{2}-\d{2} · by rev1 \(fresh\) · in the issue file only — Important: only the file keeps this\.\n/);
});

test('an entry written into the file that is no verdict of the log is listed after the log\'s, marked, and the note says so', () => {
  const root = loop();
  jarl(root, 'new', 'the work');
  jarl(root, 'review', '1', 'changes', '--by', 'rev1', 'Important: recorded by the tool.');
  writeFileSync(issueFile(root), readFileSync(issueFile(root), 'utf8').replace(/(\n## Reviews\n[\s\S]*?)(?=\n## |$)/, '$1\n- **changes** · by hand (fresh) · 2026-11-01\n  Important: written into the file by hand.\n'));
  const o = findingsListed(root, '1');
  assert.deepEqual(o.findings.map((f) => [f.by, f.fileOnly === true]), [['rev1', false], ['hand', true]]);
  assert.match(o.notes.join('\n'), fileOnlyNote);
});

test('two reviewers with the same findings text stay two findings, and so do two verdicts of one reviewer with the same text', () => {
  const root = loop();
  jarl(root, 'new', 'the work');
  for (const by of ['rev1', 'rev2', 'rev2']) jarl(root, 'review', '1', 'changes', '--by', by, 'Important: the same text.');
  const o = findingsListed(root, '1');
  assert.deepEqual(o.findings.map((f) => [f.by, f.text, f.fileOnly === true]), [['rev1', 'Important: the same text.', false], ['rev2', 'Important: the same text.', false], ['rev2', 'Important: the same text.', false]]);
});

test('a finding of many lines, one of them like a merge marker and one like a heading, is one finding, given whole', () => {
  const root = loop();
  jarl(root, 'new', 'the work');
  jarl(root, 'review', '1', 'changes', '--by', 'rev1', 'Important: the text holds a marker.\n<<<<<<< HEAD\n# like a heading\nthe last line.');
  const o = findingsListed(root, '1');
  assert.equal(o.findings.length, 1);
  assert.equal(o.findings[0].text, 'Important: the text holds a marker.\n<<<<<<< HEAD\n# like a heading\nthe last line.', 'given as the reviewer wrote it, without the escapes the file keeps');
  assert.match(readFileSync(issueFile(root), 'utf8'), /\n {2}\\<<<<<<< HEAD\n {2}\\# like a heading\n/, 'the file keeps them escaped');
  assert.equal(o.findings[0].fileOnly, undefined);
});

test('a finding whose own text opens with the lead-in the log sets before a mark is listed once, matched and whole', () => {
  const root = loop();
  jarl(root, 'new', 'the work');
  const texts = ['findings: model big-model was asked.\nImportant: the count is off.', 'findings: relayed · the count was read twice.\nImportant: the count is off.', 'model big-model is named first.\nImportant: the count is off.', 'findings: model big-model is one line. Important: the count is off.'];
  texts.forEach((t, k) => jarl(root, 'review', '1', 'changes', '--by', `rev${k + 1}`, t));
  const o = findingsListed(root, '1');
  assert.deepEqual(o.findings.map((f) => [f.by, f.text, f.fileOnly === true]), texts.map((t, k) => [`rev${k + 1}`, t, false]));
  assert.doesNotMatch(o.notes.join('\n'), fileOnlyNote);
  for (const t of texts) assert.equal(o.findings.filter((f) => f.text === t).length, 1);
});

// Verdicts of one reviewer whose findings share the first line and the line count, so their log lines read the same.
const alike = (which) => `Important: the count is off.\nMinor: the ${which} second line.`;
const OLDER = alike('older');
const NEWER = alike('newer');
const POINTER = "Important: the count is off. (+1 more lines, whole text in the issue's Reviews section)";
const alikeNote = /^1 review\(s\) of the Reviews section of 1 fit a verdict line of its log that another line or entry of the same reviewer fits as well, and nothing the two record tells which is whose: those verdicts are given as the log's lines, and the entries are listed after them, marked in the issue file only$/m;
const reviewNotes = (o) => o.notes.filter((n) => /Reviews section/.test(n));
// Takes the entry of `by` whose second line names `which` out of the file, as a hand edit or a lost merge would.
const loseEntry = (root, by, which) => {
  writeFileSync(issueFile(root), readFileSync(issueFile(root), 'utf8').replace(new RegExp(`\\n- \\*\\*changes\\*\\* · by ${by} [^\\n]*\\n {2}Important: the count is off\\.\\n {2}Minor: the ${which} second line\\.`), ''));
  assert.doesNotMatch(readFileSync(issueFile(root), 'utf8'), new RegExp(`${which} second line`));
};
// Moves the first verdict of rev1 to an earlier day, its log line and its entry alike, as a verdict given days before.
const earlierDay = (root) => {
  const log = join(root, '.jarl', 'log.md');
  writeFileSync(log, readFileSync(log, 'utf8').replace(/^- \d{4}-\d{2}-\d{2} \d{2}:\d{2}((?: key \S+)? · 1 review changes · by rev1 )/m, '- 2026-11-01 10:00$1'));
  writeFileSync(issueFile(root), readFileSync(issueFile(root), 'utf8').replace(/^- \*\*changes\*\* · by rev1 \(fresh\) · \d{4}-\d{2}-\d{2}/m, '- **changes** · by rev1 (fresh) · 2026-11-01'));
};
const alikeLoop = (...verdicts) => {
  const root = loop();
  jarl(root, 'new', 'the work');
  for (const [by, text, ...flags] of verdicts) jarl(root, 'review', '1', 'changes', '--by', by, text, ...flags);
  return root;
};
const listed = (root) => findingsListed(root, '1').findings.map((f) => [f.by, f.text, f.fileOnly === true]);

test('two verdicts of one reviewer with the same first line and line count, both entries kept: each keeps its own text', () => {
  const root = alikeLoop(['rev1', OLDER], ['rev1', NEWER]);
  assert.deepEqual(listed(root), [['rev1', OLDER, false], ['rev1', NEWER, false]]);
  assert.deepEqual(reviewNotes(findingsListed(root, '1')), []);
});

test('two alike verdicts of one reviewer, the file keeping only the second, told apart by the model: each keeps its own text', () => {
  const root = alikeLoop(['rev1', OLDER, '--model', 'model-a'], ['rev1', NEWER, '--model', 'model-b']);
  loseEntry(root, 'rev1', 'older');
  const o = findingsListed(root, '1');
  assert.deepEqual(o.findings.map((f) => [f.by, f.text]), [['rev1', POINTER], ['rev1', NEWER]]);
  assert.deepEqual(o.notes.filter((n) => fileOnlyNote.test(n)), []);
  assert.deepEqual(reviewNotes(o), []);
});

test('two alike verdicts of one reviewer, the file keeping only the first, told apart by the model or the day: the first keeps its own text and the second gives its log line', () => {
  const byModel = alikeLoop(['rev1', OLDER, '--model', 'model-a'], ['rev1', NEWER, '--model', 'model-b']);
  loseEntry(byModel, 'rev1', 'newer');
  assert.deepEqual(listed(byModel), [['rev1', OLDER, false], ['rev1', POINTER, false]]);
  assert.deepEqual(reviewNotes(findingsListed(byModel, '1')), []);
  const byDay = alikeLoop(['rev1', OLDER], ['rev1', NEWER]);
  earlierDay(byDay);
  loseEntry(byDay, 'rev1', 'newer');
  assert.deepEqual(listed(byDay), [['rev1', OLDER, false], ['rev1', POINTER, false]]);
  assert.deepEqual(reviewNotes(findingsListed(byDay, '1')), []);
});

test('two alike verdicts of one reviewer that nothing tells apart, the file keeping one entry: neither verdict takes it, both give the log line, and the entry follows, marked, with a note', () => {
  for (const [lost, kept] of [['newer', OLDER], ['older', NEWER]]) {
    const root = alikeLoop(['rev1', OLDER], ['rev1', NEWER]);
    loseEntry(root, 'rev1', lost);
    const o = findingsListed(root, '1');
    assert.deepEqual(o.findings.map((f) => [f.by, f.text, f.fileOnly === true]), [['rev1', POINTER, false], ['rev1', POINTER, false], ['rev1', kept, true]], lost);
    assert.match(o.notes.join('\n'), alikeNote, lost);
    assert.doesNotMatch(o.notes.join('\n'), fileOnlyNote, lost);
    assert.match(jarl(root, 'brief', '1', '--role', 'reviewer'), new RegExp(`\\n- \\d{4}-\\d{2}-\\d{2} · by rev1 \\(fresh\\) · in the issue file only — Important: the count is off\\.\\n {2}Minor: the ${lost === 'newer' ? 'older' : 'newer'} second line\\.\\n`), lost);
  }
});

test('three alike verdicts of one reviewer: all kept, each keeps its own; one lost, the others told apart by the model keep their own and the lost one gives its log line', () => {
  const three = [['rev1', alike('first'), '--model', 'model-a'], ['rev1', alike('middle'), '--model', 'model-b'], ['rev1', alike('last'), '--model', 'model-a']];
  assert.deepEqual(listed(alikeLoop(...three)), three.map(([by, text]) => [by, text, false]));
  const bare = three.map(([by, text]) => [by, text]);
  assert.deepEqual(listed(alikeLoop(...bare)), three.map(([by, text]) => [by, text, false]), 'with no mark at all, every entry kept');
  const middle = alikeLoop(...three);
  loseEntry(middle, 'rev1', 'middle');
  assert.deepEqual(listed(middle), [['rev1', alike('first'), false], ['rev1', POINTER, false], ['rev1', alike('last'), false]]);
  const first = alikeLoop(...three);
  loseEntry(first, 'rev1', 'first');
  assert.deepEqual(listed(first), [['rev1', POINTER, false], ['rev1', alike('middle'), false], ['rev1', alike('last'), false]]);
  for (const root of [middle, first]) assert.deepEqual(reviewNotes(findingsListed(root, '1')), []);
});

test('alike verdicts of two reviewers: each reviewer keeps its own text, and the entry of another reviewer between them tells one reviewer\'s two apart by its place', () => {
  const verdicts = [['rev1', OLDER], ['rev2', alike('other')], ['rev1', NEWER]];
  assert.deepEqual(listed(alikeLoop(...verdicts)), verdicts.map(([by, text]) => [by, text, false]));
  const newerLost = alikeLoop(...verdicts);
  loseEntry(newerLost, 'rev1', 'newer');
  assert.deepEqual(listed(newerLost), [['rev1', OLDER, false], ['rev2', alike('other'), false], ['rev1', POINTER, false]]);
  const olderLost = alikeLoop(...verdicts);
  loseEntry(olderLost, 'rev1', 'older');
  assert.deepEqual(listed(olderLost), [['rev1', POINTER, false], ['rev2', alike('other'), false], ['rev1', NEWER, false]]);
  const otherLost = alikeLoop(...verdicts);
  loseEntry(otherLost, 'rev2', 'other');
  assert.deepEqual(listed(otherLost), [['rev1', OLDER, false], ['rev2', POINTER, false], ['rev1', NEWER, false]]);
  for (const root of [newerLost, olderLost, otherLost]) assert.deepEqual(reviewNotes(findingsListed(root, '1')), []);
});

// Findings that open with the lead-in a writer sets before a mark, or with a mark itself.
const LEAD_IN_FINDINGS = ['findings: model big-model was asked.\nImportant: the count is off.', 'findings: relayed · the count was read twice.\nImportant: the count is off.', 'model big-model is named first.\nImportant: the count is off.', 'findings: model big-model is one line. Important: the count is off.'];

test('a verdict whose writer sets the lead-in only before a mark, its finding opening with the lead-in before a mark, is listed once, matched and whole', () => {
  const root = loop();
  const id = fileAsFormatTwo(root, 'the work');
  LEAD_IN_FINDINGS.forEach((t, k) => {
    const r = formatTwoJarl(root, 'review', {}, [id, 'changes', t, { by: `rev${k + 1}` }]);
    assert.equal(r.ok, true, r.error);
  });
  const o = findingsListed(root, id);
  assert.deepEqual(o.findings.map((f) => [f.by, f.text, f.fileOnly === true]), LEAD_IN_FINDINGS.map((t, k) => [`rev${k + 1}`, t, false]));
  assert.deepEqual(reviewNotes(o), []);
});

test('a verdict whose writer keeps only the log and sets no lead-in, its finding opening with the lead-in before a mark, is listed once, as the log holds it', () => {
  const root = loop();
  const id = fileAsBefore(root, 'the work');
  LEAD_IN_FINDINGS.forEach((t, k) => {
    const r = oldJarl(root, 'review', {}, [id, 'changes', t, { by: `rev${k + 1}` }]);
    assert.equal(r.ok, true, r.error);
  });
  assert.doesNotMatch(readFileSync(issueFile(root), 'utf8'), /## Reviews/, 'this writer keeps no Reviews section');
  const o = findingsListed(root, id);
  assert.deepEqual(o.findings.map((f) => [f.by, f.text, f.fileOnly === true]), LEAD_IN_FINDINGS.map((t, k) => [`rev${k + 1}`, t.split('\n')[0], false]));
  assert.deepEqual(reviewNotes(o), []);
});

test('a Worktree field a lease wrote into the header is left out of the brief, as every line that names a place on this machine is', () => {
  const root = loop();
  jarl(root, 'new', 'the work');
  writeFileSync(issueFile(root), readFileSync(issueFile(root), 'utf8').replace(/(\*\*Status:\*\* [^\n]*\n)/, '$1**Worktree:** /home/someone/worktrees/1-the-work\n'));
  assert.match(jarl(root, 'show', '1'), /\*\*Worktree:\*\* \/home\/someone\/worktrees\/1-the-work/);
  const text = jarl(root, 'brief', '1');
  assert.doesNotMatch(text, /Worktree:|\/home\/someone/);
  assert.match(text, /\n# 1 · the work\n\n\*\*Status:\*\* open\n\*\*Kind:\*\* /);
});

test('three rounds with no mark that end with the same worker and no lease handed on give no takeover role', () => {
  const root = rulesLoop();
  journalOnly(root, '2 → in-progress · go · branch jarl/2-work · worker w-one', '2 round 1 · a', '2 round 2 · b', '2 round 3 · c', '2 round 4 · d');
  const o = json(root, 'brief', '2');
  assert.deepEqual(o.roles, ['worker']);
  assert.ok(!slugs(o).includes('takeovers'));
});

test('a lease handed to a new worker with a reason that names a takeover gives the takeover role, with no round line at all', () => {
  const root = rulesLoop();
  journalOnly(root, '2 → in-progress · go · branch jarl/2-work · worker w-one');
  assert.deepEqual(json(root, 'brief', '2').roles, ['worker']);
  journalOnly(root, '2 → in-progress · takeover after three rounds: a fresh strong worker · branch jarl/2-work · worker w-two');
  const o = json(root, 'brief', '2');
  assert.equal(o.rounds.length, 0);
  assert.deepEqual(o.roles, ['takeover', 'worker']);
  assert.ok(slugs(o).includes('takeovers'));
});

test('a round that printed the takeover block gives the takeover role once the lease is handed over for it, and a handover for another reason gives none', () => {
  const root = rulesLoop();
  jarl(root, 'goal', '--set', 'Takeover: 1');
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w-one', '--branch', 'jarl/1-ui');
  jarl(root, 'set', '3', 'in-progress', 'go', '--worker', 'w-three', '--branch', 'jarl/3-ui');
  jarl(root, 'round', '1', 'the screen is blank');
  const before = json(root, 'brief', '1');
  assert.deepEqual(before.roles, ['worker'], 'the block is advice: the same worker still holds the lease');
  assert.deepEqual(before.moments, ['round', 'start']);
  assert.match(before.rounds[0].text, /^round 1 \(takeover 1 of 1\) · the screen is blank$/);
  jarl(root, 'set', '1', 'in-progress', 'Takeover after one round', '--worker', 'w-two', '--branch', 'jarl/1-ui', '--handover');
  const o = json(root, 'brief', '1');
  assert.deepEqual(o.roles, ['takeover', 'worker']);
  assert.ok(slugs(o).includes('takeovers'));
  jarl(root, 'set', '3', 'in-progress', 'the host restarted, a fresh session goes on', '--worker', 'w-four', '--branch', 'jarl/3-ui', '--handover');
  assert.deepEqual(json(root, 'brief', '3').roles, ['worker']);
});

test('brief --slice <coordinator> is the coordinator\'s: its issues in play, its rules and none of another slice or role, its reference and its commands', () => {
  const root = rulesLoop();
  const o = json(root, 'brief', '--slice', 'odin');
  assert.equal(o.role, 'coordinator');
  assert.equal(o.slice, 'odin');
  assert.equal(o.declared, true);
  assert.deepEqual(o.issues.map((i) => i.id), ['1']);
  assert.deepEqual(slugs(o), ['loop-rule', 'coordinators', 'odin-only', 'jarl:coordinator-escalates', 'jarl:coordinator-pull-push', 'jarl:coordinator-shared-review', 'jarl:coordinator-scope-holds']);
  for (const absent of ['frigg-only', 'ui-workers', 'reviewers', 'takeovers', 'jarl:worker-only-the-issue']) assert.ok(!slugs(o).includes(absent), absent);
  assert.deepEqual(slugs(json(root, 'brief', '--slice', 'FRIGG')).filter((s) => !s.startsWith('jarl:')), ['loop-rule', 'coordinators', 'frigg-only'], 'a slice is named in any case');
  const text = jarl(root, 'brief', '--slice', 'odin');
  assert.match(text, /^The coordinator's brief for the slice odin \(slice:odin\), assembled from the record; it writes nothing\.\n\n## The issues of the slice in play \(1\)\n- 1 open · odin ui\n/);
  assert.match(text, /\n## Rules for the coordinator of the slice odin \(7\)\n/);
  assert.match(text, /\n## The role\nreferences\/jarl\.md, section "Coordinators: slices of the backlog"/);
  assert.match(text, /\n## Recording the result\n- what is on the coordinator now, each line with the command that moves it: jarl\.mjs next --as odin\n- an escalation to the jarl, for one of the four reasons: jarl\.mjs ask "<text>" --kind escalation --slice odin --by odin$/);
  assert.doesNotMatch(text, /## Rounds so far|## Proof rows/);
});

test('a slice no Coordinators line names, and one with nothing in play, are briefed with a note that says so', () => {
  const root = loop();
  jarl(root, 'new', 'loose work', '--tags', 'slice:loki');
  const o = json(root, 'brief', '--slice', 'loki');
  assert.equal(o.declared, false);
  assert.match(o.notes[0], /^the goal's Coordinators line does not name loki: its approve counts as fresh and what its slice holds is the jarl's until the line names it — jarl\.mjs goal --set "<machine-line>"/);
  jarl(root, 'goal', '--set', 'Coordinators: thor');
  const thor = json(root, 'brief', '--slice', 'thor');
  assert.equal(thor.declared, true);
  assert.deepEqual(thor.issues, []);
  assert.deepEqual(thor.notes, ['no issue of the slice thor is in play']);
  assert.match(jarl(root, 'brief', '--slice', 'thor'), /## The issues of the slice in play \(0\)\n- \(none\)\n/);
});

test('brief refuses an unknown id, a role it has no brief for, no id and no slice, an id with a slice, and a slice the loop does not have, each with its form and nothing written', () => {
  const root = rulesLoop();
  const before = snapshot(root);
  assert.match(refuses(root, 'brief', '9'), /^no such issue: 9 — the issues: jarl\.mjs list --all\njarl\.mjs brief "<id>"\n$/);
  assert.match(refuses(root, 'brief', '1', '--role', 'merger'), /^--role is worker or reviewer \(got "merger"\): a merger's brief is one for the whole loop \(references\/merger\.md\), its branches the merge queue of resume, and a coordinator's is jarl\.mjs brief --slice "<coordinator>"\njarl\.mjs brief "<id>" --role "<role>"\n$/);
  assert.match(refuses(root, 'brief'), /^brief takes the id of an issue; a coordinator's brief is jarl\.mjs brief --slice "<coordinator>"\njarl\.mjs brief "<id>"\n$/);
  assert.match(refuses(root, 'brief', '1', '--slice', 'odin'), /^brief --slice is the coordinator's brief and takes no id; an issue's brief is jarl\.mjs brief "<id>"\njarl\.mjs brief --slice "<coordinator>"\n$/);
  assert.match(refuses(root, 'brief', '--slice', 'odin', '--role', 'reviewer'), /^--role names the role of an issue's brief; brief --slice is the coordinator's\njarl\.mjs brief --slice "<coordinator>"\n$/);
  assert.match(refuses(root, 'brief', '--slice', 'loki'), /^no coordinator loki on the goal's Coordinators line and no issue tagged slice:loki — the slices are slice:odin, slice:frigg\njarl\.mjs brief --slice "<coordinator>"\n$/);
  assert.deepEqual(snapshot(root), before);
});

test('every command a brief prints carries the call\'s --root, and no line names where a repository or a worktree is on this machine', () => {
  const { dir, g } = gitRepo({ prefix: 'jarl-brief-git-' });
  jarl(dir, 'init', 'goal');
  jarl(dir, 'new', 'work in a worktree');
  const wt = `${dir}-wt`;
  g('worktree', 'add', '-q', '-b', 'jarl/1-work', wt);
  jarl(dir, 'set', '1', 'in-progress', 'go', '--worker', 'w1', '--branch', 'jarl/1-work');
  assert.match(jarl(dir, 'show', '1'), /\nworktree of \S+ on jarl\/1-work: /, 'show names the worktree of the lease');
  for (const args of [['brief', '1'], ['brief', '1', '--role', 'reviewer']]) {
    const said = posixForms(spawnJarl(dir, args).stdout);
    assert.doesNotMatch(said, /worktree of /);
    const flag = ` --root ${shellWord(dir)}`;
    const commands = said.split('\n').filter((l) => /jarl\.mjs \w/.test(l));
    assert.ok(commands.length >= 2);
    for (const l of commands) for (const m of l.matchAll(/jarl\.mjs \w[^—]*/g)) assert.ok(m[0].includes(flag), `the command carries --root: ${m[0]}`);
    assert.ok(!said.split(flag).join('').includes(dir), 'no path of this machine but the --root a command carries');
  }
  // The record library prints with no global flag: its commands carry none.
  const o = R.briefData(dir, '1');
  assert.ok(o.record.every((r) => !r.command.includes('--root')));
  assert.deepEqual(o.rules, json(dir, 'brief', '1').rules, 'the library and the command line give one brief');
});

test('a very long issue is briefed whole, and an issue file with CRLF line endings is briefed as one with LF', () => {
  const root = loop();
  const what = `${'A long description of the work, with every line of it kept. '.repeat(400)}The last words.`;
  jarl(root, 'new', 'long work', '--what', what, '--acceptance', 'first line', '--acceptance', 'second line');
  const text = jarl(root, 'brief', '1');
  assert.ok(text.includes(what), 'the whole What');
  assert.ok(text.length > what.length);
  const [file] = readdirSync(join(root, '.jarl', 'issues'));
  const path = join(root, '.jarl', 'issues', file);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/\n/g, '\r\n'));
  const crlf = jarl(root, 'brief', '1');
  assert.doesNotMatch(crlf, /\r/);
  assert.equal(crlf, text);
});

test('brief is the library\'s too: briefData gives what brief --json prints, and refuses as the command line does', () => {
  const root = rulesLoop();
  assert.deepEqual(R.briefData(root, '1').rules, json(root, 'brief', '1').rules);
  assert.deepEqual(R.briefData(root, null, { slice: 'odin' }).issues, json(root, 'brief', '--slice', 'odin').issues);
  assert.equal(R.briefData(root, '3', { role: 'reviewer' }).role, 'reviewer');
  assert.throws(() => R.briefData(root, '9'), /^Error: no such issue: 9/);
});
