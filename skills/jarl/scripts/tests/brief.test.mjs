// brief: the text a worker, a reviewer or a coordinator is raised with, assembled from the record when asked. It carries
// the issue as show prints it, the rules that reach that reader and none other, the rounds so far and the findings that
// sent the work back, the proof rows, the role's reference and the commands that record the result; it writes nothing,
// leaves out where things are on this machine, and cuts nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitRepo, jarl, posixForms, refuses, spawnJarl, loop as makeLoop } from './helpers.mjs';
import { shellWord } from '../jarl-lib.mjs';
import * as R from '../record.mjs';
import { FINDINGS } from './findings.mjs';
import { fileAsBefore, fileAsFormatTwo, formatTwoJarl, oldJarl } from './old-jarl.mjs';

const { pairsInAnyOrder } = await import('../lib/brief.mjs');
const SCRIPT_PATH = fileURLToPath(new URL('../jarl.mjs', import.meta.url));

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
  jarl(root, 'new', 'odin ui', '--tags', 'slice:odin,ui', '--files', 'a.mjs', '--acceptance', '[read] the screen shows the count');   // 1
  jarl(root, 'new', 'frigg work', '--acceptance', '[read] it works', '--tags', 'slice:frigg', '--files', 'b.mjs');                                                // 2
  jarl(root, 'new', 'jarl ui', '--acceptance', '[read] it works', '--tags', 'ui', '--files', 'c.mjs', '--tier', 'light');                                         // 3
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
  assert.equal(o.reference, undefined, 'a raised agent reads its brief and nothing else');
  const text = jarl(root, 'brief', '1');
  assert.match(text, /^The worker's brief for issue 1, assembled from the record\. Read nothing else for this job\.\n\n## The goal\n/);
  assert.ok(text.includes(jarl(root, 'show', '1')), 'the issue as show prints it');
  assert.ok(text.includes(LONG), 'a rule is printed whole');
  assert.match(text, /\n## Rules that reach you\n- loop-rule · loop · by coordinator — /);
  assert.equal(o.rulings.inForce, json(root, 'decisions', '--live').length, 'every ruling in force is counted, as decisions --live lists them');
  assert.match(text, /\n\d+ ruling\(s\) in force in the loop: jarl\.mjs decisions --live\n/);
  assert.doesNotMatch(text, /Frigg asks|Reviewers run|Coordinators report|An ended rule|after a takeover|jarl:worker-only-the-issue/, 'the role\'s own shipped rule is said once, in the steps');
  assert.doesNotMatch(text, /references\/worker\.md/);
  assert.match(text, /\n## Commands\n- proof of a line of 1, one row per run: [^\n]*jarl\.mjs evidence 1 --ran "<command>" --saw "<what-it-printed>" --line "<line-number>" --by "<who>"\n- a note, the choice a line leaves open: [^\n]*\n- stuck: [^\n]*\n- the changelog entry, for a change someone sees: [^\n]*jarl\.mjs field 1 Changelog "<changelog-entry>" --add --by "<who>"\n/);
  // The worker of an issue in no slice gets no slice's rule, and the rule of a tag reaches it.
  assert.deepEqual(slugs(json(root, 'brief', '3')), ['loop-rule', 'ui-workers', 'jarl:worker-only-the-issue']);
  assert.deepEqual(slugs(json(root, 'brief', '2')), ['loop-rule', 'frigg-only', 'jarl:worker-only-the-issue']);
  assert.deepEqual(snapshot(root), before, 'brief writes nothing');
});

test('brief <id> --role reviewer carries the rules of the reviewer, of the round once one sent the work back, the rounds, their findings whole and the proof rows', () => {
  const root = rulesLoop();
  assert.deepEqual(slugs(json(root, 'brief', '3', '--role', 'reviewer')), ['loop-rule', 'reviewers', 'jarl:reviewer-light-tier', 'jarl:reviewer-tier-above', 'jarl:reviewer-identical-output', 'jarl:reviewer-judges-the-issue'], 'at the first review, no rule of the round');
  jarl(root, 'set', '3', 'in-progress', 'go', '--worker', 'w3', '--branch', 'jarl/3-ui');
  jarl(root, 'evidence', '3', '--line', '1', '--ran', 'npm test', '--saw', 'tests 4, pass 3, fail 1');
  const finding = `Important: the count is off by one on the last page.\nMinor: ${'the name of the helper could say more, '.repeat(8)}end of the finding.`;
  jarl(root, 'review', '3', 'changes', '--by', 'rev1', finding);
  jarl(root, 'round', '3', 'the count is off by one', '--findings', '2');
  jarl(root, 'evidence', '3', '--line', '1', '--ran', 'npm test', '--saw', 'tests 4, pass 4, fail 0');
  const o = json(root, 'brief', '3', '--role', 'reviewer');
  assert.equal(o.role, 'reviewer');
  assert.deepEqual(o.moments, ['review', 'round']);
  assert.deepEqual(slugs(o), ['loop-rule', 'reviewers', 'jarl:reviewer-every-round', 'jarl:reviewer-light-tier', 'jarl:reviewer-tier-above', 'jarl:reviewer-identical-output', 'jarl:reviewer-judges-the-issue']);
  for (const absent of ['ui-workers', 'odin-only', 'coordinators', 'jarl:worker-only-the-issue']) assert.ok(!slugs(o).includes(absent), absent);
  assert.equal(o.rounds.length, 1);
  assert.match(o.rounds[0].text, /^round 1 \(count 1 of 3\) · findings 2 · the count is off by one$/);
  assert.deepEqual(o.findings.map((f) => [f.by, f.kind, f.text]), [['rev1', 'fresh', finding]], 'the finding is whole');
  assert.deepEqual(o.proof, [{ n: 1, ran: 'npm test', saw: 'tests 4, pass 3, fail 1', lines: ['1'] }, { n: 2, ran: 'npm test', saw: 'tests 4, pass 4, fail 0', lines: ['1'] }]);
  const text = jarl(root, 'brief', '3', '--role', 'reviewer');
  assert.match(text, /^The examiner's brief for issue 3, assembled from the record\. Read nothing else for this job\./);
  assert.match(text, /\n## Rounds so far \(1\)\n- \d{4}-\d{2}-\d{2} \d{2}:\d{2} · round 1 \(count 1 of 3\) · findings 2 · the count is off by one\n/);
  assert.match(text, /\n## Findings of the reviews that sent it back \(1\)\n- \d{4}-\d{2}-\d{2} · by rev1 \(fresh\) — Important: the count is off by one on the last page\.\n {2}Minor: the name/);
  assert.ok(text.includes('end of the finding.'));
  assert.match(text, /\n## Proof to re-run\n- 3 line 1 \[read\]|\n## Proof to re-run\n- \(no test, check or compare line\)/);
  assert.match(text, /\n## Commands\n- [^\n]*\n- the verdict, as the last step \(with `--outside "<finding-outside-the-issue>"` for each finding outside the issue, filed as a new issue, never a reason for changes\): [^\n]*jarl\.mjs review 3 "<verdict>" "<findings-with-a-severity>" --by "<reviewer>" --model "<model-id>"\n/);
  // A done issue keeps its reviewer's brief; its worker's says it starts once reopened.
  jarl(root, 'review', '3', 'approve', '--by', 'rev2', FINDINGS);
  jarl(root, 'merged', '3', '--sha', 'abc1234');
  jarl(root, 'set', '3', 'done', 'approved');
  assert.equal(json(root, 'brief', '3', '--role', 'reviewer').rounds.length, 1);
  assert.match(jarl(root, 'brief', '3'), /\nnote: 3 is done: a worker starts on it once it is reopened — jarl\.mjs set 3 open "<why>"\n/);
});

test('an issue whose file holds no Reviews section is briefed with the findings its journal holds, without the verdict and reviewer repeated', () => {
  const root = loop();
  jarl(root, 'new', 'the work', '--acceptance', '[read] it works');
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
  jarl(root, 'new', 'the work', '--acceptance', '[read] it works');
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
  jarl(root, 'new', 'the work', '--acceptance', '[read] it works');
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
  jarl(root, 'new', 'the work', '--acceptance', '[read] it works');
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
  jarl(root, 'new', 'the work', '--acceptance', '[read] it works');
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
  jarl(root, 'new', 'the work', '--acceptance', '[read] it works');
  jarl(root, 'review', '1', 'changes', '--by', 'rev1', 'Important: recorded by the tool.');
  writeFileSync(issueFile(root), readFileSync(issueFile(root), 'utf8').replace(/(\n## Reviews\n[\s\S]*?)(?=\n## |$)/, '$1\n- **changes** · by hand (fresh) · 2026-11-01\n  Important: written into the file by hand.\n'));
  const o = findingsListed(root, '1');
  assert.deepEqual(o.findings.map((f) => [f.by, f.fileOnly === true]), [['rev1', false], ['hand', true]]);
  assert.match(o.notes.join('\n'), fileOnlyNote);
});

test('two reviewers with the same findings text stay two findings, and so do two verdicts of one reviewer with the same text', () => {
  const root = loop();
  jarl(root, 'new', 'the work', '--acceptance', '[read] it works');
  for (const by of ['rev1', 'rev2', 'rev2']) jarl(root, 'review', '1', 'changes', '--by', by, 'Important: the same text.');
  const o = findingsListed(root, '1');
  assert.deepEqual(o.findings.map((f) => [f.by, f.text, f.fileOnly === true]), [['rev1', 'Important: the same text.', false], ['rev2', 'Important: the same text.', false], ['rev2', 'Important: the same text.', false]]);
});

test('a finding of many lines, one of them like a merge marker and one like a heading, is one finding, given whole', () => {
  const root = loop();
  jarl(root, 'new', 'the work', '--acceptance', '[read] it works');
  jarl(root, 'review', '1', 'changes', '--by', 'rev1', 'Important: the text holds a marker.\n<<<<<<< HEAD\n# like a heading\nthe last line.');
  const o = findingsListed(root, '1');
  assert.equal(o.findings.length, 1);
  assert.equal(o.findings[0].text, 'Important: the text holds a marker.\n<<<<<<< HEAD\n# like a heading\nthe last line.', 'given as the reviewer wrote it, without the escapes the file keeps');
  assert.match(readFileSync(issueFile(root), 'utf8'), /\n {2}\\<<<<<<< HEAD\n {2}\\# like a heading\n/, 'the file keeps them escaped');
  assert.equal(o.findings[0].fileOnly, undefined);
});

test('a finding whose own text opens with the lead-in the log sets before a mark is listed once, matched and whole', () => {
  const root = loop();
  jarl(root, 'new', 'the work', '--acceptance', '[read] it works');
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
// The note of findings given as their log line, whose pointer names a Reviews section that holds no entry left for them.
const pointerNoteOf = (count, id) => `${count} finding(s) of ${id} given as its log's line say the whole text is in its Reviews section, which holds no entry left for them: the first line is all the record keeps`;
const pointerNote = pointerNoteOf(1, '1');
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
  jarl(root, 'new', 'the work', '--acceptance', '[read] it works');
  for (const [by, text, ...flags] of verdicts) jarl(root, 'review', '1', 'changes', '--by', by, text, ...flags);
  return root;
};
const listed = (root) => findingsListed(root, '1').findings.map((f) => [f.by, f.text, f.fileOnly === true]);

test('two verdicts of one reviewer with the same first line and line count, both entries kept: each keeps its own text', () => {
  const root = alikeLoop(['rev1', OLDER], ['rev1', NEWER]);
  assert.deepEqual(listed(root), [['rev1', OLDER, false], ['rev1', NEWER, false]]);
  assert.deepEqual(reviewNotes(findingsListed(root, '1')), []);
});

test('a finding given as its log line, whose entry the Reviews section lost while the other verdict keeps its own, comes with the note that the section holds no more of it; one whose entry is left over for it, or one of one line, comes with none', () => {
  const root = alikeLoop(['rev1', OLDER, '--model', 'model-a'], ['rev1', NEWER, '--model', 'model-b'], ['rev2', alike('third'), '--model', 'model-a']);
  loseEntry(root, 'rev1', 'older');
  loseEntry(root, 'rev2', 'third');
  const o = findingsListed(root, '1');
  assert.deepEqual(o.findings.map((f) => [f.by, f.text]), [['rev1', POINTER], ['rev1', NEWER], ['rev2', POINTER]]);
  assert.deepEqual(reviewNotes(o), [pointerNoteOf(2, '1')], 'two findings point to text the section no longer holds');
  assert.match(jarl(root, 'brief', '1', '--role', 'reviewer'), /\nnote: 2 finding\(s\) of 1 given as its log's line say the whole text is in its Reviews section, which holds no entry left for them: the first line is all the record keeps\n/);
  // An entry left over that the line fits holds the text, listed after the log's lines: the pointer is true.
  const alikeKept = alikeLoop(['rev1', OLDER], ['rev1', NEWER]);
  loseEntry(alikeKept, 'rev1', 'older');
  const kept = reviewNotes(findingsListed(alikeKept, '1'));
  assert.equal(kept.length, 1, 'the note that nothing tells the two apart, alone');
  assert.match(kept[0], alikeNote);
  // A finding of one line given as its log line is whole, and promises nothing more.
  const oneLine = alikeLoop(['rev1', 'Important: one line.', '--model', 'model-a'], ['rev1', 'Important: one line.', '--model', 'model-b']);
  writeFileSync(issueFile(oneLine), readFileSync(issueFile(oneLine), 'utf8').replace(/\n- \*\*changes\*\* · by rev1 [^\n]* · model model-a\n {2}Important: one line\./, ''));
  const one = findingsListed(oneLine, '1');
  assert.deepEqual(one.findings.map((f) => [f.by, f.text, f.fileOnly === true]), [['rev1', 'Important: one line.', false], ['rev1', 'Important: one line.', false]]);
  assert.deepEqual(reviewNotes(one), []);
});

test('two alike verdicts of one reviewer, the file keeping only the second, told apart by the model: each keeps its own text', () => {
  const root = alikeLoop(['rev1', OLDER, '--model', 'model-a'], ['rev1', NEWER, '--model', 'model-b']);
  loseEntry(root, 'rev1', 'older');
  const o = findingsListed(root, '1');
  assert.deepEqual(o.findings.map((f) => [f.by, f.text]), [['rev1', POINTER], ['rev1', NEWER]]);
  assert.deepEqual(o.notes.filter((n) => fileOnlyNote.test(n)), []);
  assert.deepEqual(reviewNotes(o), [pointerNote]);
});

test('two alike verdicts of one reviewer, the file keeping only the first, told apart by the model or the day: the first keeps its own text and the second gives its log line', () => {
  const byModel = alikeLoop(['rev1', OLDER, '--model', 'model-a'], ['rev1', NEWER, '--model', 'model-b']);
  loseEntry(byModel, 'rev1', 'newer');
  assert.deepEqual(listed(byModel), [['rev1', OLDER, false], ['rev1', POINTER, false]]);
  assert.deepEqual(reviewNotes(findingsListed(byModel, '1')), [pointerNote]);
  const byDay = alikeLoop(['rev1', OLDER], ['rev1', NEWER]);
  earlierDay(byDay);
  loseEntry(byDay, 'rev1', 'newer');
  assert.deepEqual(listed(byDay), [['rev1', OLDER, false], ['rev1', POINTER, false]]);
  assert.deepEqual(reviewNotes(findingsListed(byDay, '1')), [pointerNote]);
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
  for (const root of [middle, first]) assert.deepEqual(reviewNotes(findingsListed(root, '1')), [pointerNote]);
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
  for (const root of [newerLost, olderLost, otherLost]) assert.deepEqual(reviewNotes(findingsListed(root, '1')), [pointerNote]);
});

// A writer that keeps a Reviews entry writes the model and the batch into the entry and into the log line alike, or into
// neither: a mark only one of the two records tells verdicts apart as two different marks do.
test('two alike verdicts of one reviewer, only one of them with a model, either entry lost: each keeps its own text or its log line, with the note that the section holds no more of the lost one', () => {
  for (const [olderFlags, newerFlags] of [[['--model', 'model-a'], []], [[], ['--model', 'model-a']]]) {
    const olderLost = alikeLoop(['rev1', OLDER, ...olderFlags], ['rev1', NEWER, ...newerFlags]);
    loseEntry(olderLost, 'rev1', 'older');
    assert.deepEqual(listed(olderLost), [['rev1', POINTER, false], ['rev1', NEWER, false]], olderFlags.join(' '));
    const newerLost = alikeLoop(['rev1', OLDER, ...olderFlags], ['rev1', NEWER, ...newerFlags]);
    loseEntry(newerLost, 'rev1', 'newer');
    assert.deepEqual(listed(newerLost), [['rev1', OLDER, false], ['rev1', POINTER, false]], olderFlags.join(' '));
    for (const root of [olderLost, newerLost]) assert.deepEqual(reviewNotes(findingsListed(root, '1')), [pointerNote], olderFlags.join(' '));
  }
});

test('three alike verdicts of one reviewer with a model, none and the same model again: the middle or the first lost, the others keep their own and the lost one gives its log line', () => {
  const three = [['rev1', alike('first'), '--model', 'model-a'], ['rev1', alike('middle')], ['rev1', alike('last'), '--model', 'model-a']];
  const middle = alikeLoop(...three);
  loseEntry(middle, 'rev1', 'middle');
  assert.deepEqual(listed(middle), [['rev1', alike('first'), false], ['rev1', POINTER, false], ['rev1', alike('last'), false]]);
  const first = alikeLoop(...three);
  loseEntry(first, 'rev1', 'first');
  assert.deepEqual(listed(first), [['rev1', POINTER, false], ['rev1', alike('middle'), false], ['rev1', alike('last'), false]]);
  for (const root of [middle, first]) assert.deepEqual(reviewNotes(findingsListed(root, '1')), [pointerNote]);
});

test('two alike verdicts of one reviewer, a batch over two issues and then one of its own, either entry lost: each keeps its own text or its log line, with the note that the section holds no more of the lost one', () => {
  for (const which of ['older', 'newer']) {
    const root = loop();
    jarl(root, 'new', 'the work', '--acceptance', '[read] it works');
    jarl(root, 'new', 'the other work', '--acceptance', '[read] it works');
    jarl(root, 'review', '1,2', 'changes', '--by', 'rev1', OLDER);
    jarl(root, 'review', '1', 'changes', '--by', 'rev1', NEWER);
    assert.match(readFileSync(issueFile(root), 'utf8'), /\n- \*\*changes\*\* · by rev1 \(fresh\) · \d{4}-\d{2}-\d{2} · batch \S+\n {2}Important: the count is off\.\n {2}Minor: the older second line\./, 'the batch is marked on the first entry');
    loseEntry(root, 'rev1', which);
    assert.deepEqual(listed(root), which === 'older' ? [['rev1', POINTER, false], ['rev1', NEWER, false]] : [['rev1', OLDER, false], ['rev1', POINTER, false]], which);
    assert.deepEqual(reviewNotes(findingsListed(root, '1')), [pointerNote], which);
  }
});

// Either entry of one reviewer's two alike verdicts lost: the first verdict keeps its own text and the second gives its
// log line, or the other way round, with the note that the section holds no more of the one given as its log line.
const eachKeepsItsOwn = (root, which, name) => {
  assert.deepEqual(listed(root), which === 'older' ? [['rev1', POINTER, false], ['rev1', NEWER, false]] : [['rev1', OLDER, false], ['rev1', POINTER, false]], `${name}, the ${which} lost`);
  assert.deepEqual(reviewNotes(findingsListed(root, '1')), [pointerNote], `${name}, the ${which} lost`);
};
const entryKinds = (root) => [...readFileSync(issueFile(root), 'utf8').matchAll(/^- \*\*changes\*\* · by rev1 \((\w+)\)/gm)].map((m) => m[1]);

test('two alike verdicts of one reviewer of two kinds, fresh then coordinator, fresh then self, or a bot\'s then fresh, either entry lost: the kind each line records tells them apart, each keeps its own text or its log line, with the note that the section holds no more of the lost one', () => {
  const histories = [
    ['fresh then coordinator', ['fresh', 'coordinator'], (root) => jarl(root, 'goal', '--set', 'Coordinators: rev1'), []],
    ['fresh then self', ['fresh', 'self'], (root) => jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'rev1', '--branch', 'jarl/1-work'), []],
    ['a bot\'s then fresh', ['bot', 'fresh'], () => {}, ['--bot']],
  ];
  for (const [name, kinds, between, olderFlags] of histories) {
    for (const which of ['older', 'newer']) {
      const root = loop();
      jarl(root, 'new', 'the work', '--acceptance', '[read] it works');
      jarl(root, 'review', '1', 'changes', '--by', 'rev1', ...olderFlags, OLDER);
      between(root);
      jarl(root, 'review', '1', 'changes', '--by', 'rev1', NEWER);
      assert.deepEqual(entryKinds(root), kinds, `${name}: the two entries record two kinds`);
      loseEntry(root, 'rev1', which);
      eachKeepsItsOwn(root, which, name);
    }
  }
});

test('an approve between two alike verdicts of one reviewer, by another reviewer or by the same one, tells the two apart by its place: either entry lost, each keeps its own text or its log line, with the note that the section holds no more of the lost one', () => {
  for (const approver of ['rev2', 'rev1']) {
    for (const which of ['older', 'newer']) {
      const root = alikeLoop(['rev1', OLDER]);
      jarl(root, 'review', '1', 'approve', '--by', approver, 'The count reads right on every page.');
      jarl(root, 'review', '1', 'changes', '--by', 'rev1', NEWER);
      loseEntry(root, 'rev1', which);
      eachKeepsItsOwn(root, which, `an approve by ${approver} between`);
    }
  }
});

test('a retraction between two alike verdicts of one reviewer tells the two apart by its place, as an approve does: either entry lost, each keeps its own text or its log line, with the note that the section holds no more of the lost one', () => {
  for (const which of ['older', 'newer']) {
    const root = loop();
    jarl(root, 'new', 'the work', '--acceptance', '[read] it works');
    jarl(root, 'review', '1', 'approve', '--by', 'rev2', 'The count reads right on every page.');
    jarl(root, 'review', '1', 'changes', '--by', 'rev1', OLDER);
    jarl(root, 'retract', '1', 'review', 'the approve was given before the count was read', '--by', 'rev2');
    jarl(root, 'review', '1', 'changes', '--by', 'rev1', NEWER);
    assert.match(readFileSync(issueFile(root), 'utf8'), /\n- ~~\*\*approve\*\* · by rev2 \(fresh\) · \d{4}-\d{2}-\d{2}~~\n[\s\S]*\n- \*\*retract\*\* · by rev2 \(fresh\) · /, 'the approve is struck and the retraction has an entry');
    loseEntry(root, 'rev1', which);
    eachKeepsItsOwn(root, which, 'a retraction between');
  }
});

// The notes of entries no line takes: those that fit nothing, those two lines or entries nothing tells apart share, and a
// file whose entries no pairing in the log's order places.
const aloneNoteOf = (count, id) => `${count} review(s) of the Reviews section of ${id} match no verdict line of its log, which is the record: listed after the log's, marked in the issue file only`;
const alikeNoteOf = (count, id) => `${count} review(s) of the Reviews section of ${id} fit a verdict line of its log that another line or entry of the same reviewer fits as well, and nothing the two record tells which is whose: those verdicts are given as the log's lines, and the entries are listed after them, marked in the issue file only`;
const outOfOrderNote = (id) => `no pairing in the log's order places every entry of the Reviews section of ${id} that fits a verdict line of its log (the section holds them in another order, or more of them than the lines they fit): each entry is paired by what it records alone, its place telling nothing`;
// Swaps two entries of the file, as a merge resolved by hand can leave them.
const swapEntries = (root, first, second) => {
  const text = readFileSync(issueFile(root), 'utf8');
  const entry = (w) => new RegExp(`- \\*\\*changes\\*\\* · by [^\\n]*\\n {2}[^\\n]*\\n {2}Minor: the ${w} second line\\.`).exec(text)[0];
  const [a, b] = [entry(first), entry(second)];
  writeFileSync(issueFile(root), text.replace(`${a}\n${b}`, `${b}\n${a}`));
};

test('entries the file holds in another order than the log\'s, as a merge resolved by hand can leave them: each is paired by what it records alone, and a note says the place told nothing', () => {
  const verdicts = [['rev1', alike('first')], ['rev2', alike('second')]];
  const root = alikeLoop(...verdicts);
  swapEntries(root, 'first', 'second');
  const o = findingsListed(root, '1');
  assert.deepEqual(listed(root), verdicts.map(([by, text]) => [by, text, false]));
  assert.deepEqual(reviewNotes(o), [outOfOrderNote('1')]);
  // Out of order, the place tells nothing, so one reviewer's two alike verdicts are not told apart: the kept one goes to neither.
  const other = (which) => `Important: the ${which} count is off.\nMinor: the ${which} second line.`;
  const four = alikeLoop(['rev1', alike('first')], ['rev2', other('second')], ['rev1', alike('third')], ['rev2', other('fourth')]);
  loseEntry(four, 'rev1', 'first');
  swapEntries(four, 'third', 'fourth');
  assert.deepEqual(listed(four), [['rev1', POINTER, false], ['rev2', other('second'), false], ['rev1', POINTER, false], ['rev2', other('fourth'), false], ['rev1', alike('third'), true]]);
  assert.deepEqual(reviewNotes(findingsListed(four, '1')), [alikeNoteOf(1, '1'), outOfOrderNote('1')]);
});

// ---- the pairing against every pairing the record allows ---------------------------------------------------------------
//
// Histories of reviews are written straight into a loop's files, in the shapes the review command writes (the first test
// below holds the two to each other), and each brief is checked against all pairings of its log's review lines with its
// Reviews entries, enumerated one by one. A pairing pairs only a line and an entry that agree on every field both record,
// and keeps the log's order and the file's while one that keeps them places every entry a line fits; an entry is a
// verdict's when every pairing with the most pairs pairs the two. The histories are every sequence of up to three reviews
// over the letters below, and of four over a few of them, each with every subset of its entries lost; those with two
// entries swapped in the file stand for a file whose order a hand edit changed.
const WHERE_WHOLE = "the issue's Reviews section";
const logged = (t) => { const ls = t.split('\n'); return ls.length > 1 ? `${ls[0]} (+${ls.length - 1} more lines, whole text in ${WHERE_WHOLE})` : ls[0]; };
const marksOf = (r) => `${r.model ? `model ${r.model} · ` : ''}${r.relayed ? 'relayed · ' : ''}${r.batch ? `batch ${r.batch} · ` : ''}${r.artifact ? `artifact ${r.artifact} · ` : ''}`;
const takenAway = (a) => `retracts the approve by ${a.by} (${a.kind}) of ${a.day}`;
// What a review's log line holds after its marks: as the review and retract commands write it, a finding that opens like a
// mark given the lead-in; or, from a writer that keeps only the log (logOnly) and sets no lead-in, the first line as given.
const ledIn = (t) => (/^(?:findings: )*(?:model |relayed(?: ·|$)|batch |artifact [^·\n]*? · )/i.test(t) ? `findings: ${t}` : t);
const lineText = (r) => (r.verdict === 'retract' ? `${takenAway(r.retracts)} · ${logged(r.text)}` : r.logOnly ? r.text.split('\n')[0] : ledIn(logged(r.text)));
// A review's log line and its Reviews entry, as the review and retract commands write them, or as a writer that keeps only
// the log writes its line, with no key and no mark; `at` is the line's time.
const reviewLine = (id, key, r, at) => `- ${r.day} ${at}${r.logOnly ? '' : ` key ${key}`} · ${id} review ${r.verdict} · by ${r.by} (${r.kind}) · ${r.verdict === 'retract' ? '' : marksOf(r)}${lineText(r)}`;
const reviewEntry = (r) => {
  const heading = `- **${r.verdict}** · by ${r.by} (${r.kind}) · ${r.day}${r.model ? ` · model ${r.model}` : ''}${r.relayed ? ' · relayed' : ''}${r.batch ? ` · batch ${r.batch}` : ''}${r.artifact ? ` · artifact ${r.artifact}` : ''}`;
  const body = r.verdict === 'retract' ? `${takenAway(r.retracts)}\n${r.text}` : r.text;
  return `${r.struck ? `${heading.replace(/^- /, '- ~~')}~~` : heading}\n${body.split('\n').map((l) => `  ${l}`).join('\n')}`;
};
// The reviews of a sequence of letters, in order: each letter changes the reviewer, the kind, the verdict, a mark, the day
// or the text of one changes verdict of rev1, and every finding shares its first line and line count with the others, so
// only what the letter changes tells two apart. A retraction takes away the newest approve not yet taken away and strikes
// its entry. Null for a sequence no writer writes: a retraction with no approve to take away, a day before another.
const DAYS = ['2026-11-01', '2026-11-02'];
const LETTERS = {
  same: {}, other: { by: 'rev2' }, coordinator: { kind: 'coordinator' }, self: { kind: 'self' }, bot: { kind: 'bot' },
  model: { model: 'model-a' }, model2: { model: 'model-b' }, relayed: { relayed: true }, batch: { batch: true }, artifact: { artifact: 'renders/a.png' }, artifact2: { artifact: 'renders/b.png' },
  marks: { model: 'model-a', relayed: true, batch: true, artifact: 'renders/a.png' }, early: { day: DAYS[0] }, worded: { first: 'Important: another count is off.' },
  approve: { verdict: 'approve', by: 'rev2' }, approve1: { verdict: 'approve' }, retract: { verdict: 'retract', by: 'rev2' },
};
// The letters of the writers: this Jarl's verdict of two lines (same), of one line (one), and of one line opening like a
// model mark (opens), and the same three from a writer that keeps only the log, beside a verdict with a model mark.
const WRITER_LETTERS = {
  same: {}, one: { one: true }, opens: { one: true, first: 'model big-model was asked.' }, model: { model: 'model-a' },
  logOnly: { logOnly: true }, logOnlyOne: { logOnly: true, one: true }, logOnlyOpens: { logOnly: true, one: true, first: 'model big-model was asked.' },
};
function reviewsOf(letters, table = LETTERS) {
  const reviews = [];
  let late = false;
  for (const [k, letter] of letters.entries()) {
    const l = table[letter];
    const r = { verdict: 'changes', by: 'rev1', kind: 'fresh', model: null, relayed: false, batch: null, artifact: null, day: DAYS[1], ...l };
    if (r.day === DAYS[0] && late) return null;
    late = late || r.day === DAYS[1];
    if (r.batch) r.batch = `20261101T1000-${'abcd'[k]}aaa`;
    delete r.first;
    r.text = r.verdict === 'retract' ? `the approve was given early ${k}.` : `${l.first ?? (r.verdict === 'approve' ? 'The count reads right.' : 'Important: the count is off.')}${l.one ? '' : `\nMinor: the second line of review ${k}.`}`;
    if (r.verdict === 'retract') {
      const a = [...reviews].reverse().find((x) => x.verdict === 'approve' && !x.struck);
      if (!a) return null;
      a.struck = true;
      r.retracts = a;
    }
    reviews.push(r);
  }
  return reviews;
}
// Every pairing with the most pairs of the lines `L` and the entries `E` (each a review), as one line index or null per
// entry, enumerated one by one, keeping both orders or in any order; `agree` is what the two record alike.
// A line agrees with an entry when it holds what the entry's own line holds: the entry's writer is this Jarl, which keeps it.
const agree = (l, e) => ['verdict', 'by', 'kind', 'model', 'relayed', 'batch', 'artifact', 'day'].every((f) => l[f] === e[f]) && lineText(l) === lineText(e);
const size = (p) => p.filter((i) => i !== null).length;
function mostPairings(L, E, inOrder) {
  const all = [];
  const walk = (j, chosen) => {
    if (j === E.length) { all.push(chosen); return; }
    walk(j + 1, [...chosen, null]);
    const from = inOrder ? Math.max(-1, ...chosen.filter((i) => i !== null)) + 1 : 0;
    for (let i = from; i < L.length; i += 1) if (!chosen.includes(i) && agree(L[i], E[j])) walk(j + 1, [...chosen, i]);
  };
  walk(0, []);
  const most = Math.max(...all.map(size));
  return all.filter((p) => size(p) === most);
}
// What the brief must say of a history: each changes line's finding, then the changes entries no line takes, and the notes.
function expected(id, L, E) {
  const fitting = (j) => L.some((l) => agree(l, E[j]));
  const inOrder = mostPairings(L, E, true);
  const ordered = size(inOrder[0]) === E.filter((_, j) => fitting(j)).length;
  const pairings = ordered ? inOrder : mostPairings(L, E, false);
  const owner = E.map((_, j) => (new Set(pairings.map((p) => p[j])).size === 1 ? pairings[0][j] : null));
  const findings = L.flatMap((l, i) => (l.verdict !== 'changes' ? [] : [[l.by, l.kind, l.day, owner.includes(i) ? E[owner.indexOf(i)].text : lineText(l), false]]));
  const left = E.map((e, j) => ({ e, j })).filter(({ e, j }) => e.verdict === 'changes' && owner[j] === null);
  // The note that two lines or two entries of one reviewer fit alike is true of every entry it counts.
  for (const { j } of left.filter(({ j }) => fitting(j))) {
    const lines = L.flatMap((l, i) => (agree(l, E[j]) ? [i] : []));
    assert.ok(lines.length > 1 || lines.some((i) => E.some((e, x) => x !== j && agree(L[i], e))), `entry ${j} is left with a line of its own`);
  }
  const alone = left.filter(({ j }) => !fitting(j)).length;
  // A finding given as its log line says the whole text is in the section when it has more than one line; the section holds
  // it only when an entry no line takes is one of its review.
  const pointing = L.filter((l, i) => l.verdict === 'changes' && !owner.includes(i) && !l.logOnly && l.text.includes('\n') && !left.some(({ e }) => agree(l, e))).length;
  const notes = [];
  if (alone) notes.push(aloneNoteOf(alone, id));
  if (left.length - alone) notes.push(alikeNoteOf(left.length - alone, id));
  if (pointing) notes.push(pointerNoteOf(pointing, id));
  if (!ordered) notes.push(outOfOrderNote(id));
  return { findings: [...findings, ...left.map(({ e }) => [e.by, e.kind, e.day, e.text, true])], notes, pairings, owner, ordered };
}

test('the review lines and Reviews entries the oracle writes are the ones the review and retract commands write, for every kind, verdict and mark', () => {
  const root = loop();
  jarl(root, 'goal', '--set', 'Coordinators: boss');
  jarl(root, 'new', 'the work', '--acceptance', '[read] it works');
  jarl(root, 'new', 'the other work', '--acceptance', '[read] it works');
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1', '--branch', 'jarl/1-work');
  jarl(root, 'review', '1', 'changes', '--by', 'rev1', '--model', 'model-a', '--relayed', 'Important: the count is off.\nMinor: the second line.');
  jarl(root, 'review', '1,2', 'approve', '--by', 'rev2', 'The count reads right.\nMinor: the second line.');
  jarl(root, 'review', '1', 'approve', '--by', 'boss', 'The director read the count.');
  jarl(root, 'retract', '1', 'review', 'the approve was given early.', '--by', 'rev3');
  jarl(root, 'review', '1', 'changes', '--by', 'w1', 'Important: the worker found it.');
  jarl(root, 'review', '1', 'changes', '--by', 'botty', '--bot', 'Important: the bot found it.');
  jarl(root, 'review', '1,2', 'changes', '--by', 'rev1', '--model', 'model-b', '--relayed', '--artifact', 'renders/home page.png', 'Important: the count is off again.\nMinor: the second line.');
  jarl(root, 'review', '1', 'changes', '--by', 'rev4', 'model big-model was asked. Important: the count is off.');
  const lines = readFileSync(join(root, '.jarl', 'log.md'), 'utf8').split('\n').filter((l) => / · 1 review /.test(l));
  const day = lines[0].slice(2, 12);
  const key = / key (\S+) · /.exec(lines[0])[1];
  const batches = lines.map((l) => / · batch (\S+) · /.exec(l)?.[1] ?? null);
  const at = (l) => l.slice(13, 18);
  const boss = { verdict: 'approve', by: 'boss', kind: 'coordinator', day, text: 'The director read the count.', struck: true };
  const reviews = [
    { verdict: 'changes', by: 'rev1', kind: 'fresh', model: 'model-a', relayed: true, text: 'Important: the count is off.\nMinor: the second line.' },
    { verdict: 'approve', by: 'rev2', kind: 'fresh', batch: batches[1], text: 'The count reads right.\nMinor: the second line.' },
    boss,
    { verdict: 'retract', by: 'rev3', kind: 'fresh', retracts: boss, text: 'the approve was given early.' },
    { verdict: 'changes', by: 'w1', kind: 'self', text: 'Important: the worker found it.' },
    { verdict: 'changes', by: 'botty', kind: 'bot', text: 'Important: the bot found it.' },
    { verdict: 'changes', by: 'rev1', kind: 'fresh', model: 'model-b', relayed: true, batch: batches[6], artifact: 'renders/home page.png', text: 'Important: the count is off again.\nMinor: the second line.' },
    { verdict: 'changes', by: 'rev4', kind: 'fresh', text: 'model big-model was asked. Important: the count is off.' },
  ].map((r) => ({ day, ...r }));
  assert.ok(batches[1] && batches[6], 'both verdicts on two issues carry a batch');
  assert.deepEqual(lines, reviews.map((r, k) => reviewLine('1', key, r, at(lines[k]))));
  const section = /\n## Reviews\n([\s\S]*?)\n\n## /.exec(readFileSync(issueFile(root), 'utf8'))[1];
  assert.equal(section, reviews.map(reviewEntry).join('\n'));
});

const words = (alphabet, n) => (n === 0 ? [[]] : words(alphabet, n - 1).flatMap((w) => alphabet.map((a) => [...w, a])));
// Each history of `sequences` over the letters of `table` written into one loop and briefed, against what the oracle says,
// with the counts of the histories, of those where nothing tells two apart, of those with a finding given as its log line
// the section holds no more of, and of those whose swapped entries no pairing in the log's order places.
function checkHistories(sequences, table) {
  const root = loop();
  jarl(root, 'new', 'the work', '--acceptance', '[read] it works');
  const id = '1';
  const log = join(root, '.jarl', 'log.md');
  const [baseLog, baseFile] = [readFileSync(log, 'utf8'), readFileSync(issueFile(root), 'utf8')];
  const key = / key (\S+) · filed /.exec(baseLog)[1];
  let histories = 0;
  let ambiguous = 0;
  let outOfOrder = 0;
  let pointing = 0;
  for (const letters of sequences) {
    const L = reviewsOf(letters, table);
    if (!L) continue;
    writeFileSync(log, `${baseLog.replace(/\n*$/, '\n')}${L.map((r, k) => `${reviewLine(id, key, r, `10:0${k}`)}\n`).join('')}`);
    // Every subset of the entries kept, in the log's order; with two or more kept, each pair of neighbours swapped too. A
    // writer that keeps only the log wrote no entry.
    for (let mask = 0; mask < 2 ** L.length; mask += 1) {
      if (L.some((r, k) => r.logOnly && mask & (2 ** k))) continue;
      const kept = L.filter((_, k) => mask & (2 ** k));
      const orders = [kept, ...(letters.length < 4 ? kept.slice(1).map((_, k) => [...kept.slice(0, k), kept[k + 1], kept[k], ...kept.slice(k + 2)]) : [])];
      for (const [o, E] of orders.entries()) {
        const section = E.length ? `## Reviews\n${E.map(reviewEntry).join('\n')}\n\n` : '';
        writeFileSync(issueFile(root), baseFile.replace('\n## Evidence', `\n${section}## Evidence`));
        const want = expected(id, L, E);
        const got = R.briefData(root, id, { role: 'reviewer' });
        const what = `${letters.join(' ')}; kept ${mask.toString(2).padStart(L.length, '0')}${o ? `, swapped at ${o}` : ''}`;
        assert.deepEqual(got.findings.map((f) => [f.by, f.kind, f.day, f.text, f.fileOnly === true]), want.findings, what);
        assert.deepEqual(got.notes.filter((n) => /Reviews section/.test(n)), want.notes, what);
        if (o === 0) {
          // A file whose entries the writers wrote, some of them lost: a pairing in both orders places every entry, each
          // one that is paired is with its own verdict, and the only notes are that nothing tells two apart and that a
          // finding given as its log line is held nowhere else, which is true of exactly the verdicts whose entry was lost.
          assert.ok(want.ordered, what);
          assert.equal(size(want.pairings[0]), E.length, what);
          want.owner.forEach((i, j) => { if (i !== null) assert.equal(L[i], E[j], what); });
          assert.ok(want.notes.every((n) => /nothing the two record tells|which holds no entry left for them/.test(n)), what);
          const heldNowhere = L.filter((l, i) => l.verdict === 'changes' && !want.owner.includes(i) && !E.some((e, j) => want.owner[j] === null && agree(l, e)));
          for (const l of heldNowhere) assert.ok(!E.includes(l), `${what}: a finding said to be held nowhere else has its entry in the file`);
        }
        histories += 1;
        if (want.notes.some((n) => /nothing the two record tells/.test(n))) ambiguous += 1;
        if (want.notes.some((n) => /which holds no entry left for them/.test(n))) pointing += 1;
        if (!want.ordered) outOfOrder += 1;
      }
    }
  }
  return { histories, ambiguous, pointing, outOfOrder };
}

test('every history of up to three reviews of one issue, and of four over approves, retractions, a model and an artifact, with every subset of its entries lost or two of them swapped: an entry is a verdict\'s exactly when every pairing with the most pairs says so, and the notes say why the others are not', () => {
  const sequences = [1, 2, 3].flatMap((n) => words(Object.keys(LETTERS), n)).concat(words(['same', 'approve', 'retract', 'model', 'artifact'], 4));
  // The enumeration is fixed, so are its counts.
  assert.deepEqual(checkHistories(sequences, LETTERS), { histories: 54823, ambiguous: 4520, pointing: 36136, outOfOrder: 17339 });
});

test('every history of up to three verdicts of one reviewer on one day from this Jarl and from a writer that keeps only the log and sets no lead-in, of one line or two, opening like a model mark or not: an entry is a verdict\'s exactly when every pairing with the most pairs says so, the missing lead-in telling the two writers apart', () => {
  const sequences = [1, 2, 3].flatMap((n) => words(Object.keys(WRITER_LETTERS), n));
  assert.deepEqual(checkHistories(sequences, WRITER_LETTERS), { histories: 1943, ambiguous: 456, pointing: 610, outOfOrder: 324 });
});

// ---- the pairing in any order against its definition, and its cost ------------------------------------------------------
//
// The definition read literally: the most pairs by augmenting paths, and a pair of one such pairing sure when, taken away, it
// leaves fewer pairs possible.
function anyOrderByDefinition(n, m, fits) {
  const most = (allowed) => {
    const entryAt = new Array(n).fill(-1);
    const take = (j, seen) => {
      for (let i = 0; i < n; i += 1) {
        if (seen[i] || !allowed(i, j)) continue;
        seen[i] = true;
        if (entryAt[i] === -1 || take(entryAt[i], seen)) { entryAt[i] = j; return true; }
      }
      return false;
    };
    let size = 0;
    for (let j = 0; j < m; j += 1) if (take(j, new Array(n).fill(false))) size += 1;
    return { size, entryAt };
  };
  const all = most(fits);
  const sure = new Map();
  all.entryAt.forEach((j, i) => { if (j !== -1 && most((a, b) => fits(a, b) && !(a === i && b === j)).size < all.size) sure.set(i, j); });
  return { most: all.size, sure };
}
// A fixed sequence of numbers in [0, 1), the same on every run.
const numbers = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

test('the pairing in any order gives the most pairs and the sure pairs its definition gives, on every one of several thousand graphs of lines and entries', () => {
  const next = numbers(20261108);
  let graphs = 0;
  for (let round = 0; round < 4000; round += 1) {
    const n = 1 + Math.floor(next() * 9);
    const m = 1 + Math.floor(next() * 9);
    const density = [0.15, 0.3, 0.5, 0.8][round % 4];
    const fit = Array.from({ length: n }, () => Array.from({ length: m }, () => next() < density));
    const fits = (i, j) => fit[i][j];
    const got = pairsInAnyOrder(n, m, fits);
    const want = anyOrderByDefinition(n, m, fits);
    assert.equal(got.most, want.most, JSON.stringify(fit));
    // The sure pairs are those of every pairing with the most pairs, so the two agree on them whichever pairing each found.
    assert.deepEqual([...got.sure].sort((a, b) => a[0] - b[0]), [...want.sure].sort((a, b) => a[0] - b[0]), JSON.stringify(fit));
    graphs += 1;
  }
  assert.equal(graphs, 4000);
});

// Review lines of five reviewers taking turns, each reviewer's findings alike, so each line fits every entry of its reviewer;
// the entries in another order than the lines, one in five lost.
function turnsOfFive(n) {
  const lineBy = Array.from({ length: n }, (_, i) => i % 5);
  const entryBy = lineBy.filter((_, i) => i % 5 !== 3).reverse();
  return { n, m: entryBy.length, fits: (i, j) => lineBy[i] === entryBy[j] };
}

test('the pairing in any order asks each line and entry once whether they fit, so on a history of 250 review lines it costs the product of the two lengths', () => {
  const { n, m, fits } = turnsOfFive(250);
  let asked = 0;
  const got = pairsInAnyOrder(n, m, (i, j) => { asked += 1; return fits(i, j); });
  assert.equal(got.most, m);
  assert.equal(got.sure.size, 0, 'nothing tells one reviewer\'s alike findings apart');
  assert.equal(asked, n * m);
});

test('a brief of an issue with 250 review lines whose Reviews section holds its entries in another order pairs each by what it records alone', () => {
  const root = loop();
  jarl(root, 'new', 'the work', '--acceptance', '[read] it works');
  const log = join(root, '.jarl', 'log.md');
  const [baseLog, baseFile] = [readFileSync(log, 'utf8'), readFileSync(issueFile(root), 'utf8')];
  const key = / key (\S+) · filed /.exec(baseLog)[1];
  const at = (k) => `${String(10 + Math.floor(k / 60)).padStart(2, '0')}:${String(k % 60).padStart(2, '0')}`;
  const write = (reviews, entries) => {
    writeFileSync(log, `${baseLog.replace(/\n*$/, '\n')}${reviews.map((r, k) => `${reviewLine('1', key, r, at(k))}\n`).join('')}`);
    writeFileSync(issueFile(root), baseFile.replace('\n## Evidence', `\n## Reviews\n${entries.map(reviewEntry).join('\n')}\n\n## Evidence`));
    return R.briefData(root, '1', { role: 'reviewer' });
  };
  const review = (k, text) => ({ verdict: 'changes', by: `rev${k % 5}`, kind: 'fresh', model: null, relayed: false, batch: null, day: DAYS[1], text });
  // Each finding its own words: every entry is its own line's, the lost ones given as their log line.
  const own = Array.from({ length: 250 }, (_, k) => review(k, `Important: finding ${k}.\nMinor: its second line.`));
  const o = write(own, own.filter((_, k) => k % 5 !== 3).reverse());
  assert.deepEqual(o.findings.map((f) => [f.text, f.fileOnly === true]), own.map((r, k) => [k % 5 === 3 ? lineText(r) : r.text, false]));
  assert.deepEqual(reviewNotes(o), [pointerNoteOf(50, '1'), outOfOrderNote('1')]);
  // Each reviewer's findings alike, as turnsOfFive: no entry is told apart, every line gives its log line, the entries follow;
  // the reviewer whose entries were all lost points to a section that holds none of them.
  const alikeTurns = Array.from({ length: 250 }, (_, k) => review(k, `Important: the count of rev${k % 5} is off.\nMinor: the second line of review ${k}.`));
  const entries = alikeTurns.filter((_, k) => k % 5 !== 3).reverse();
  const a = write(alikeTurns, entries);
  assert.deepEqual(a.findings.map((f) => [f.text, f.fileOnly === true]), [...alikeTurns.map((r) => [lineText(r), false]), ...entries.map((e) => [e.text, true])]);
  assert.deepEqual(reviewNotes(a), [alikeNoteOf(200, '1'), pointerNoteOf(50, '1'), outOfOrderNote('1')]);
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

// One reviewer's same one-line finding twice: first from a writer that keeps only the log, then from this Jarl.
const logOnlyThenThis = (...flags) => {
  const root = loop();
  const id = fileAsBefore(root, 'the work');
  const r = oldJarl(root, 'review', {}, [id, 'changes', 'Important: the same text.', { by: 'rev1' }]);
  assert.equal(r.ok, true, r.error);
  jarl(root, 'review', id, 'changes', '--by', 'rev1', 'Important: the same text.', ...flags);
  assert.equal((readFileSync(issueFile(root), 'utf8').match(/\*\*changes\*\*/g) || []).length, 1, 'only this Jarl keeps an entry');
  return { root, id };
};

test('the same finding of one reviewer from a writer that keeps only the log and then from this Jarl with a model: each verdict once, the entry the second\'s, no note', () => {
  const { root, id } = logOnlyThenThis('--model', 'model-a');
  const o = findingsListed(root, id);
  assert.deepEqual(o.findings.map((f) => [f.by, f.text, f.fileOnly === true]), [['rev1', 'Important: the same text.', false], ['rev1', 'Important: the same text.', false]]);
  assert.deepEqual(reviewNotes(o), []);
});

test('the same finding of one reviewer twice with no mark at all, from a writer that keeps only the log and then from this Jarl: both give the log line and the entry follows, marked, with the note that nothing tells them apart', () => {
  const { root, id } = logOnlyThenThis();
  const o = findingsListed(root, id);
  assert.deepEqual(o.findings.map((f) => [f.by, f.text, f.fileOnly === true]), [['rev1', 'Important: the same text.', false], ['rev1', 'Important: the same text.', false], ['rev1', 'Important: the same text.', true]]);
  assert.deepEqual(reviewNotes(o), [`1 review(s) of the Reviews section of ${id} fit a verdict line of its log that another line or entry of the same reviewer fits as well, and nothing the two record tells which is whose: those verdicts are given as the log's lines, and the entries are listed after them, marked in the issue file only`]);
});

test('the same finding of one reviewer on one day opening like a model mark, from a writer that keeps only the log and sets no lead-in and then from one that keeps an entry: the missing lead-in tells the two apart, each verdict once, the entry the second\'s, no note', () => {
  const later = { 'this Jarl': (root, id, text) => jarl(root, 'review', id, 'changes', '--by', 'rev1', text), 'the writer of record format 2': (root, id, text) => { const r = formatTwoJarl(root, 'review', {}, [id, 'changes', text, { by: 'rev1' }]); assert.equal(r.ok, true, r.error); } };
  for (const text of ['model big-model was asked. Important: the count is off.', 'Model big-model is the cause. Important: the count is off.']) {
    for (const [name, write] of Object.entries(later)) {
      const root = loop();
      const id = fileAsBefore(root, 'the work');
      const first = oldJarl(root, 'review', {}, [id, 'changes', text, { by: 'rev1' }]);
      assert.equal(first.ok, true, first.error);
      write(root, id, text);
      const lines = readFileSync(join(root, '.jarl', 'log.md'), 'utf8').split('\n').filter((l) => / review changes /.test(l));
      assert.deepEqual(lines.map((l) => / · findings: /.test(l)), [false, true], `${name}: only the second line carries the lead-in`);
      const o = findingsListed(root, id);
      assert.deepEqual(o.findings.map((f) => [f.by, f.text, f.fileOnly === true]), [['rev1', text, false], ['rev1', text, false]], `${name}: ${text}`);
      assert.deepEqual(reviewNotes(o), [], `${name}: ${text}`);
    }
  }
});

test('a Worktree field a lease wrote into the header is left out of the brief, as every line that names a place on this machine is', () => {
  const root = loop();
  jarl(root, 'new', 'the work', '--acceptance', '[read] it works');
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
  jarl(root, 'new', 'loose work', '--acceptance', '[read] it works', '--tags', 'slice:loki');
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
  assert.match(refuses(root, 'brief', '1', '--role', 'scribe'), /^--role is worker, reviewer, merger \(got "scribe"\): a coordinator's brief is jarl\.mjs brief --slice "<coordinator>", and a merger's takes no id\n/);
  assert.match(refuses(root, 'brief', '1', '--role', 'merger'), /^brief --role merger is the merger's and takes no id/);
  assert.match(refuses(root, 'brief'), /^brief takes the id of an issue; a coordinator's brief is jarl\.mjs brief --slice "<coordinator>"\njarl\.mjs brief "<id>"\n$/);
  assert.match(refuses(root, 'brief', '1', '--slice', 'odin'), /^brief --slice is the coordinator's brief and takes no id; an issue's brief is jarl\.mjs brief "<id>"\njarl\.mjs brief --slice "<coordinator>"\n$/);
  assert.match(refuses(root, 'brief', '--slice', 'odin', '--role', 'reviewer'), /^--role names the role of an issue's brief; brief --slice is the coordinator's\njarl\.mjs brief --slice "<coordinator>"\n$/);
  assert.match(refuses(root, 'brief', '--slice', 'loki'), /^no coordinator loki on the goal's Coordinators line and no issue tagged slice:loki — the slices are slice:odin, slice:frigg\njarl\.mjs brief --slice "<coordinator>"\n$/);
  assert.deepEqual(snapshot(root), before);
});

test('every command a brief prints runs as printed: it carries the loop root, the tool by its absolute path, and every value the record holds', () => {
  const { dir, g } = gitRepo({ prefix: 'jarl-brief-git-' });
  jarl(dir, 'init', 'goal');
  jarl(dir, 'new', 'work in a worktree', '--acceptance', '[read] it works');
  const wt = `${dir}-wt`;
  g('worktree', 'add', '-q', '-b', 'jarl/1-work', wt);
  jarl(dir, 'set', '1', 'in-progress', 'go', '--worker', 'w1', '--branch', 'jarl/1-work');
  assert.match(jarl(dir, 'show', '1'), /\nworktree of \S+ on jarl\/1-work: /, 'show names the worktree of the lease');
  for (const args of [['brief', '1'], ['brief', '1', '--role', 'reviewer']]) {
    const said = posixForms(spawnJarl(dir, args).stdout);
    assert.doesNotMatch(said, /worktree of /, 'the issue as shown names no place: the brief says where work is, on its own lines');
    assert.ok(said.split('\n').some((l) => l.includes('Tool: ') && l.includes(SCRIPT_PATH)), `the tool's absolute path: ${SCRIPT_PATH}`);
    const flag = ` --root ${shellWord(dir)}`;
    const commands = said.split('\n').filter((l) => /jarl\.mjs \w/.test(l) && !/Tool: /.test(l));
    assert.ok(commands.length >= 2);
    for (const l of commands) for (const m of l.matchAll(/jarl\.mjs \w[^—]*/g)) assert.ok(m[0].includes(flag), `the command carries --root: ${m[0]}`);
  }
  const o = R.briefData(dir, '1');
  assert.ok(o.record.every((r) => r.command.includes('--root')), 'the record library prints the same commands');
  assert.deepEqual(o.rules, json(dir, 'brief', '1').rules, 'the library and the command line give one brief');
});

test('a very long issue is briefed whole, and an issue file with CRLF line endings is briefed as one with LF', () => {
  const root = loop();
  const what = `${'A long description of the work, with every line of it kept. '.repeat(400)}The last words.`;
  jarl(root, 'new', 'long work', '--what', what, '--acceptance', '[read] first line', '--acceptance', '[read] second line');
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
