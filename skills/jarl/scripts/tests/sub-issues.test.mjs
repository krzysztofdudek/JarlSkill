// Sub-issues: an issue names its parent in the header field Parent, so the backlog is a tree whose ids stay flat numbers. A
// parent waits on its sub-issues, and a sub-issue on what the After of every issue above it names; a split moves each
// acceptance line of a parent to a sub-issue or keeps it there, and refuses a line moved nowhere; a parent whose sub-issues
// are all closed is on its coordinator to check its own acceptance against the whole, and done waits for that check; a
// sub-issue is in its parent's slice and under the rules that name its parent. The first parent written raises the record
// format, so a frozen reader that would read the backlog as flat refuses the loop, and reads a loop with no parent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jarl, refuses, loop as makeLoop } from './helpers.mjs';
import { fileAsBefore, formatTwoJarl, oldJarl } from './old-jarl.mjs';
import { FINDINGS } from './findings.mjs';
import * as L from '../jarl-lib.mjs';

const loop = () => makeLoop({ prefix: 'jarl-tree-', via: 'cli', dotGit: false });
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const logText = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const textOf = (root, id) => readFileSync(json(root, 'show', id).file, 'utf8');
const marker = (root) => join(root, '.jarl', 'profile.json');

// A parent with three acceptance lines and two issues filed for its parts: 1 the export, 2 the csv writer, 3 the json writer.
function exportLoop() {
  const root = loop();
  jarl(root, 'new', 'the export', '--acceptance', 'it writes csv', '--acceptance', 'it writes json', '--acceptance', 'the docs describe both', '--files', 'docs/export.md');
  jarl(root, 'new', 'the csv writer', '--files', 'src/csv.mjs');
  jarl(root, 'new', 'the json writer', '--files', 'src/json.mjs', '--acceptance', 'json is valid');
  return root;
}
// Proof and an approve on an issue in a lease, then done.
function finish(root, id) {
  jarl(root, 'set', id, 'in-progress', 'go', '--worker', `w${id}`);
  jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'all pass');
  jarl(root, 'review', id, 'approve', '--by', 'rev', FINDINGS);
  jarl(root, 'set', id, 'done', 'finished');
}

test('field Parent names the parent of an issue, a sub-issue has sub-issues of its own, ids stay numbers, and the first parent raises the record format so the frozen readers refuse the loop', () => {
  const root = loop();
  for (const t of ['the export', 'the csv writer', 'its header row']) fileAsBefore(root, t, { acceptance: 'it works' });
  assert.equal(oldJarl(root, 'list', {}).ok, true, 'a loop with no parent is read by the frozen reader of format 1');
  assert.equal(formatTwoJarl(root, 'list', {}).ok, true, 'and by the frozen reader of formats 1 and 2');
  assert.equal(jarl(root, 'field', '2', 'Parent', '1'), '002 Parent: 001');
  jarl(root, 'field', '3', 'Parent', '#2');
  assert.match(textOf(root, '2'), /^\*\*Parent:\*\* 001$/m);
  assert.match(textOf(root, '3'), /^\*\*Parent:\*\* 002$/m);
  assert.deepEqual(json(root, 'list').map((i) => [i.id, i.parent]), [['001', null], ['002', '001'], ['003', '002']]);
  assert.match(logText(root), /^- \d{4}-\d{2}-\d{2} \d{2}:\d{2} · 002 field Parent · 001 · was \(none\)$/m);
  assert.equal(JSON.parse(readFileSync(marker(root), 'utf8')).format, 3, 'the first parent raised the record format');
  for (const [reader, read] of [['the reader of format 1', oldJarl], ['the reader of formats 1 and 2', formatTwoJarl]]) {
    const r = read(root, 'list', {});
    assert.equal(r.ok, false, reader);
    assert.match(r.error, /written for record format 3/, reader);
  }
  // Cleared, the issue has no parent, and the loop stays in the format it was raised to.
  jarl(root, 'field', '3', 'Parent', '--clear');
  assert.equal(json(root, 'show', '3').parent, null);
  assert.match(logText(root), /^- \S+ \S+ · 003 field Parent · \(cleared\) · was 002$/m);
});

test('a parent the loop does not hold, the issue itself, one of its own sub-issues and a wait in a circle are refused, with nothing written', () => {
  const root = loop();
  for (const t of ['one', 'two', 'three', 'four']) jarl(root, 'new', t);
  jarl(root, 'field', '2', 'Parent', '1');
  jarl(root, 'field', '3', 'Parent', '2');
  const before = () => [logText(root), textOf(root, '1'), textOf(root, '2'), textOf(root, '3'), textOf(root, '4')];
  const held = before();
  assert.match(refuses(root, 'field', '2', 'Parent', '99'), /^no such issue: 99 — the issues: jarl\.mjs list --all\njarl\.mjs field "<ids>" Parent "<id>"\n$/);
  assert.match(refuses(root, 'field', '2', 'Parent', 'one'), /^the Parent of an issue is the number of one issue of the loop \(got "one"\)$/m);
  assert.match(refuses(root, 'field', '2', 'Parent', '2'), /^2 cannot be its own parent\njarl\.mjs field "<ids>" Parent "<another-id>"\n$/);
  assert.match(refuses(root, 'field', '1', 'Parent', '3'), /^1 cannot be a sub-issue of 3: 3 is under 1 already \(3 → 2 → 1\), and the tree would run in a circle$/m);
  // A parent waits on its sub-issues, and a sub-issue on its parent's After: a wait in a circle through the tree is refused,
  // by field After and by field Parent alike.
  assert.match(refuses(root, 'field', '3', 'After', '1'), /^3 after 1 would close a cycle through the tree \(3 → 1 → 2 → 3\): a parent waits on its sub-issues and a sub-issue on the After of every issue above it, so none of them would ever be offered$/m);
  assert.match(refuses(root, 'field', '1', 'After', '3'), /^1 after 3 would close a cycle through the tree \(3 → 3 \(the After of 1\)\)/m, 'the sub-issue would wait on itself through the After of the issue above it');
  jarl(root, 'field', '4', 'After', '3');
  assert.match(refuses(root, 'field', '3', 'Parent', '4'), /^3 cannot be a sub-issue of 4: a parent waits on its sub-issues and a sub-issue on the After of the issues above it, so 3 → 3 \(the After of 4\) would wait in a circle and none of them would ever be offered$/m);
  jarl(root, 'field', '4', 'After', '--clear');
  assert.deepEqual(before().slice(1), held.slice(1), 'no issue was written by a refused call');
  assert.match(refuses(root, 'field', '4', 'Parent', '1', '--add'), /^Parent holds one value, so it is replaced, never added to or taken from/m);
});

test('in a loop a composer runs, a parent is off: field Parent and split are refused with nothing written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-tree-composed-'));
  const profile = join(mkdtempSync(join(tmpdir(), 'jarl-tree-profile-')), 'profile.json');
  writeFileSync(profile, JSON.stringify({ 'jarl-profile': 1, name: 'composed', statuses: L.BUILTIN_STATUSES, 'external-scheduler': 'the composer tick' }, null, 2));
  jarl(dir, 'init', 'a mission', '--profile', profile);
  jarl(dir, 'new', 'one', '--acceptance', 'a', '--acceptance', 'b');
  jarl(dir, 'new', 'two');
  const log = logText(dir);
  assert.match(refuses(dir, 'field', '2', 'Parent', '1'), /^the parent of a sub-issue needs record format 3, and this loop stays at format 1: its profile names an external scheduler \(the composer tick\).*nothing was written$/m);
  assert.match(refuses(dir, 'split', '1', '--line', '1=2', '--line', '2=1'), /^the parent of a sub-issue needs record format 3, and this loop stays at format 1/m);
  assert.equal(logText(dir), log);
  assert.equal(json(dir, 'show', '2').parent, null);
  // A profile of its own that declares a field Parent keeps it: a new loop is refused it, as for the field Key.
  const own = join(mkdtempSync(join(tmpdir(), 'jarl-tree-own-')), 'profile.json');
  writeFileSync(own, JSON.stringify({ 'jarl-profile': 1, name: 'own', statuses: L.BUILTIN_STATUSES, fields: { Parent: {} } }, null, 2));
  assert.match(refuses(mkdtempSync(join(tmpdir(), 'jarl-tree-own-loop-')), 'init', 'g', '--profile', own), /it declares the field Parent, which Jarl reserves for the parent of a sub-issue — rename it in the profile/);
});

test('next offers only issues with no open sub-issues, and an After on a parent holds its sub-issues back too', () => {
  const root = exportLoop();
  jarl(root, 'new', 'the schema', '--files', 'src/schema.mjs');                 // 4
  jarl(root, 'new', 'the release notes', '--files', 'notes.md', '--after', '1'); // 5
  jarl(root, 'field', '2,3', 'Parent', '1');
  jarl(root, 'field', '1', 'After', '4');
  const ready = () => json(root, 'next').map((r) => r.id);
  const groups = () => Object.fromEntries(json(root, 'next', '--all').map((r) => [r.id, r.group]));
  assert.deepEqual(ready(), ['4'], 'the parent waits on its sub-issues, and they wait on the After of the parent');
  assert.deepEqual(groups(), { 1: 'waiting-after', 2: 'waiting-after', 3: 'waiting-after', 4: 'ready', 5: 'waiting-after' });
  assert.deepEqual(json(root, 'next', '--all').find((r) => r.id === '2').after, ['4']);
  finish(root, '4');
  assert.deepEqual(ready(), ['2', '3'], 'the After settled, the sub-issues are offered and the parent is not');
  assert.deepEqual(groups()['1'], 'waiting-sub');
  assert.match(jarl(root, 'next', '--all'), /^Waiting on their sub-issues \(1\)\n1  P2  the export  \(sub-issues 2, 3 not closed\)$/m);
  finish(root, '2');
  assert.deepEqual(ready(), ['3']);
  jarl(root, 'set', '3', 'dropped', 'json is not needed after all');
  assert.deepEqual(ready(), ['1'], 'every sub-issue settled: the parent is offered, for its check');
  assert.match(jarl(root, 'next'), /^1  P2  the export  \(sub-issues 2, 3 closed: check its own acceptance against the whole\)$/m);
  assert.ok(!ready().includes('5'), 'an issue that waits on the parent waits until the parent itself is closed');
});

test('a split moves each acceptance line to a named issue or keeps it on the parent, the issues become its sub-issues, and the log says what each held', () => {
  const root = exportLoop();
  const out = json(root, 'split', '1', '--line', '1=2', '--line', '2=3', '--line', '3=1', '--by', 'odin');
  assert.deepEqual(out, { id: '1', subs: ['2', '3'], lines: [{ line: 1, to: '2', kept: false }, { line: 2, to: '3', kept: false }, { line: 3, to: '1', kept: true }] });
  assert.deepEqual(json(root, 'show', '1').sections.acceptance.trim(), '- the docs describe both');
  assert.equal(json(root, 'show', '2').sections.acceptance.trim(), 'it writes csv');
  assert.equal(json(root, 'show', '3').sections.acceptance.trim(), '- json is valid\n- it writes json', 'a moved line follows the lines the issue holds');
  assert.deepEqual(['2', '3'].map((id) => json(root, 'show', id).parent), ['1', '1']);
  const log = logText(root);
  assert.match(log, /^- \S+ \S+ key \S+ · 2 field Parent · 1 · was \(none\) · by odin$/m);
  assert.match(log, /^- \S+ \S+ key \S+ · 1 body · acceptance · was "- it writes csv" \(\d+ characters\) · by odin$/m);
  assert.match(log, /^- \S+ \S+ key \S+ · 3 body · acceptance · was "json is valid" \(13 characters\) · by odin$/m);
  // A sub-issue can be split in turn: the tree goes deeper, and the ids stay flat numbers.
  jarl(root, 'new', 'the csv header');                                                                   // 4
  assert.equal(jarl(root, 'split', '2', '--line', '1=4'), '2 split: line 1 → 4 · sub-issues 4');
  assert.deepEqual(json(root, 'show', '4').parent, '2');
});

test('a split that moves a line nowhere is refused, naming the line, and so are a line named twice or out of range, an issue the loop does not hold, one under another parent and one finished; nothing is written', () => {
  const root = exportLoop();
  jarl(root, 'new', 'another parent');   // 4
  jarl(root, 'new', 'under it');         // 5
  jarl(root, 'field', '5', 'Parent', '4');
  jarl(root, 'new', 'finished');         // 6
  finish(root, '6');
  const state = () => [logText(root), ...['1', '2', '3', '5', '6'].map((id) => textOf(root, id))];
  const before = state();
  const lost = refuses(root, 'split', '1', '--line', '1=2', '--line', '2=3');
  // The form holds a place for each line the call gave and names each line still to place, so filled it is the whole split.
  assert.match(lost, /^line 3 of 1 is moved nowhere: a split names every acceptance line of the parent, moved to a sub-issue or kept on 1, so no line is lost — 3: "the docs describe both"\njarl\.mjs split "<id>" --line "<line=id>" --line "<line=id>" --line '3=<id>'\n$/);
  assert.match(refuses(root, 'split', '1', '--line', '1=2', '--by', 'odin'), /^lines 2, 3 of 1 are moved nowhere: .* — 2: "it writes json"; 3: "the docs describe both"\njarl\.mjs split "<id>" --line "<line=id>" --line '2=<id>' --line '3=<id>' --by "<who>"\n$/);
  assert.match(refuses(root, 'split', '1', '--line', '1=2', '--line', '2=3', '--line', '3=<id>'), /placeholder/, 'the form pasted with a line left unfilled writes nothing');
  assert.match(refuses(root, 'split', '1'), /^split names where each acceptance line of 1 goes, --line <n>=<id>, an acceptance line's number and the issue it goes to \(1 itself to keep it there\), for each of its 3 lines$/m);
  assert.match(refuses(root, 'split', '1', '--line', '1=2', '--line', '1=3', '--line', '2=3', '--line', '3=1'), /^line 1 of 1 is named twice \("1=2" and "1=3"\): a line goes to one issue$/m);
  assert.match(refuses(root, 'split', '1', '--line', '4=2'), /^1 has 3 acceptance lines: there is no line 4 \(got "4=2"\)$/m);
  assert.match(refuses(root, 'split', '1', '--line', 'one=2'), /^--line takes <n>=<id>, .* \(got "one=2"\)$/m);
  assert.match(refuses(root, 'split', '1', '--line', '1=99', '--line', '2=3', '--line', '3=1'), /^no such issue: 99 \(got "1=99"\)/m);
  assert.match(refuses(root, 'split', '1', '--line', '1=5', '--line', '2=3', '--line', '3=1'), /^5 is a sub-issue of 4: a split moves lines to the sub-issues of 1, or to issues with no parent \(got "1=5"\)$/m);
  assert.match(refuses(root, 'split', '1', '--line', '1=6', '--line', '2=3', '--line', '3=1'), /^6 is done: a line moved to it would never be checked — move it to an issue in play \(got "1=6"\)$/m);
  assert.match(refuses(root, 'split', '1', '--line', '1=1', '--line', '2=1', '--line', '3=1'), /^every line stays on 1: a split moves at least one acceptance line to a sub-issue$/m);
  assert.match(refuses(root, 'split', '2', '--line', '1=3'), /^2 has no acceptance line to share out — an issue is put under it with jarl\.mjs field "<ids>" Parent 2\njarl\.mjs field "<ids>" Parent "<id>"\n$/);
  assert.match(refuses(root, 'split', '1', '--line', '1=<id>'), /placeholder/);
  assert.deepEqual(state(), before, 'nothing was written');
});

test('a parent whose sub-issues are all closed holds the ball on its coordinator to check its own acceptance against the whole, and done refuses until that check is recorded and reviewed', () => {
  const root = exportLoop();
  jarl(root, 'goal', '--set', 'Coordinators: odin');
  jarl(root, 'field', '1', 'Tags', '--add', 'slice:odin');
  jarl(root, 'split', '1', '--line', '1=2', '--line', '2=3', '--line', '3=1');
  // Proof and an approve made before the whole exists are not the check.
  jarl(root, 'evidence', '1', '--ran', 'read the docs', '--saw', 'they name csv');
  jarl(root, 'review', '1', 'approve', '--by', 'rev', FINDINGS);
  const subsOpen = refuses(root, 'set', '1', 'done', 'finished');
  assert.match(subsOpen, /^1 has sub-issues not closed: 2 \(open\), 3 \(open\) — a parent is closed once each of its sub-issues is done or dropped and its own acceptance is then checked against the whole\njarl\.mjs show 1\njarl\.mjs set "<ids>" "<status>" "<why>"\n$/);
  const odin = () => jarl(root, 'next', '--as', 'odin');
  assert.match(odin(), /^- 2 the csv writer: ready to start, raise a worker — jarl\.mjs set 2 in-progress --branch "<branch>" --worker "<name>" · holds up 1$/m, 'a sub-issue is in its parent\'s slice, and holds the parent up');
  assert.match(jarl(root, 'next', '--as', 'odin', '--all'), /^- 1 the export: waits on odin via 2, 3$/m);
  assert.match(jarl(root, 'resume'), /^## Waiting on their sub-issues \(1\)\n- 1 the export \(sub-issues 2, 3 not closed\)$/m);
  assert.doesNotMatch(jarl(root, 'resume'), /^## Held/m, 'a parent waiting on its sub-issues is not held by a file');
  assert.match(jarl(root, 'status'), /^waiting on their sub-issues: 1 \(2, 3\)$/m);
  finish(root, '2');
  finish(root, '3');
  // The whole is complete: the parent is on its coordinator, in next --as, status and resume.
  assert.match(odin(), /^- 1 the export: its sub-issues are closed \(2 done, 3 done\): check its own acceptance against the whole, and record what the check ran and printed — jarl\.mjs evidence 1 --ran "<command>" --saw "<what-it-printed>"$/m);
  assert.deepEqual(json(root, 'next', '--as', 'jarl').rows.map((r) => r.id), [], 'the check is the coordinator\'s, not the jarl\'s');
  assert.match(jarl(root, 'status'), /^parent 1 · sub-issues 2 done, 3 done · odin checks its own acceptance against the whole and records the check$/m);
  assert.match(jarl(root, 'resume'), /^## Parents whose sub-issues are closed \(1\)\n- 1 the export · sub-issues 2 done, 3 done\n {2}→ odin checks its own acceptance against the whole and records the check$/m);
  assert.match(refuses(root, 'set', '1', 'done', 'finished'), /^1 has no --ran\/--saw evidence row recorded since its last sub-issue, 3, closed \(\S+ \S+\) — a parent's own acceptance is checked against the whole once every sub-issue is closed, and a row written before that is not that check/m);
  jarl(root, 'evidence', '1', '--ran', 'run the export end to end', '--saw', 'csv and json written, the docs name both');
  assert.match(odin(), /^- 1 the export: checked against the whole, no verdict; raise a reviewer — jarl\.mjs review 1 "<verdict>" --by "<reviewer>" "<text>"$/m);
  assert.match(refuses(root, 'set', '1', 'done', 'finished'), /^1 has no approving review newer than its last round or reopen, nor one since its last sub-issue, 3, closed/m, 'the approve from before the whole does not count');
  jarl(root, 'review', '1', 'approve', '--by', 'rev', FINDINGS);
  assert.match(jarl(root, 'next', '--as', 'jarl'), /^- 1 the export: approved; close it — jarl\.mjs set 1 done "<text>"$/m);
  jarl(root, 'set', '1', 'done', 'the whole holds');
  assert.equal(json(root, 'show', '1').status, 'done');
});

test('a sub-issue inherits its parent\'s slice, so a slice can be a subtree, and an own slice tag wins', () => {
  const root = exportLoop();
  jarl(root, 'goal', '--set', 'Coordinators: odin, thor');
  jarl(root, 'field', '1', 'Tags', '--add', 'slice:odin');
  jarl(root, 'new', 'deeper', '--files', 'src/deep.mjs');   // 4
  jarl(root, 'field', '2,3', 'Parent', '1');
  jarl(root, 'field', '4', 'Parent', '2');
  assert.deepEqual(json(root, 'next', '--slice', 'odin').map((r) => r.id), ['3', '4'], 'the subtree of a parent in the slice is the slice');
  assert.deepEqual(json(root, 'next', '--as', 'odin').rows.map((r) => r.id), ['3', '4']);
  assert.match(jarl(root, 'status', '--slice', 'odin'), /^open 2 · in flight 0 · waiting 2/m);
  assert.match(jarl(root, 'brief', '--slice', 'odin'), /^- 4 open · deeper · sub-issue of 2$/m);
  assert.match(jarl(root, 'status'), /^slices: odin runs slice:odin \(4 in play\) · thor runs slice:thor \(none in play\)$/m);
  // A sub-issue that carries a slice tag of its own is in that slice, and its own sub-issues with it.
  jarl(root, 'field', '2', 'Tags', '--add', 'slice:thor');
  assert.deepEqual(json(root, 'next', '--as', 'thor').rows.map((r) => r.id), ['4']);
  assert.deepEqual(json(root, 'next', '--as', 'odin').rows.map((r) => r.id), ['3']);
});

test('a rule whose selector names an issue reaches that issue\'s sub-issues, at every depth, and no other issue', () => {
  const root = exportLoop();
  jarl(root, 'new', 'deeper');        // 4
  jarl(root, 'new', 'elsewhere');     // 5
  jarl(root, 'field', '2,3', 'Parent', '1');
  jarl(root, 'field', '4', 'Parent', '2');
  jarl(root, 'decide', 'export-rule', 'Every writer of the export streams its output.', '--applies-to', 'issue 1 and role worker', '--by', 'jarl');
  const rules = (id) => json(root, 'brief', id).rules.map((r) => r.slug);
  for (const id of ['1', '2', '4']) assert.ok(rules(id).includes('export-rule'), id);
  assert.ok(!rules('5').includes('export-rule'));
  assert.match(jarl(root, 'brief', '4'), /^sub-issue of 2 \(open\): the csv writer$/m, 'the brief shows where the issue stands in the tree');
});

test('a parent is dropped or deferred with its unfinished sub-issues in the same call, a sub-issue is not reopened under a finished parent, and nothing is put under a finished parent', () => {
  const root = exportLoop();
  jarl(root, 'field', '2,3', 'Parent', '1');
  finish(root, '2');
  const log = logText(root);
  assert.match(refuses(root, 'set', '1', 'dropped', 'not wanted'), /^1 has sub-issues not finished: 3 \(open\) — an issue goes dropped with its sub-issues, so name them in the same call, or finish them first\njarl\.mjs set "<ids>" "<status>" "<why>"\n$/);
  assert.match(refuses(root, 'set', '1', 'deferred', 'later'), /^1 has sub-issues not finished: 3 \(open\)/m);
  assert.equal(logText(root), log);
  jarl(root, 'set', '1,3', 'deferred', 'later');
  assert.match(refuses(root, 'set', '3', 'open', 'back'), /^3 is under 1, which is deferred: an issue is in play only under issues in play, so move 1 back into play in the same call, or first$/m);
  jarl(root, 'set', '1,3', 'open', 'back to it');
  jarl(root, 'set', '3', 'dropped', 'not needed');
  jarl(root, 'new', 'late');    // 4
  finish(root, '1');
  assert.match(refuses(root, 'field', '4', 'Parent', '1'), /^1 is done: its own acceptance was checked against a whole that a sub-issue added now would not be part of — reopen it first\njarl\.mjs set 1 open "<why>"\njarl\.mjs field "<ids>" Parent "<id>"\n$/);
});

test('list shows the tree, each sub-issue indented under its parent, and one whose parent it does not list names it; show and report name the parent and the sub-issues', () => {
  const root = exportLoop();
  jarl(root, 'new', 'deeper');           // 4
  jarl(root, 'new', 'on its own', '--prio', '1');   // 5
  jarl(root, 'field', '2,3', 'Parent', '1');
  jarl(root, 'field', '4', 'Parent', '2');
  assert.equal(jarl(root, 'list'), [
    '5  P1  open        bug      on its own',
    '1  P2  open        bug      the export',
    '  2  P2  open        bug      the csv writer',
    '    4  P2  open        bug      deeper',
    '  3  P2  open        bug      the json writer',
  ].join('\n'));
  assert.equal(jarl(root, 'list', '--match', 'Parent=2'), '4  P2  open        bug      deeper  (sub-issue of 2)');
  assert.match(jarl(root, 'show', '1'), /^sub-issues: 2 open, 3 open$/m);
  assert.match(jarl(root, 'show', '4'), /^sub-issue of 2 \(open\): the csv writer$/m);
  finish(root, '4');
  assert.match(jarl(root, 'report'), /^- 4 deeper · sub-issue of 2 \(bug\)$/m);
  assert.equal(json(root, 'report').issues.find((i) => i.id === '4').parent, '2');
});

test('verify names a parent the loop does not hold, a parent that is the issue itself, parents that run in a circle and an open issue under a finished one, all written by hand', () => {
  const root = loop();
  for (const t of ['one', 'two', 'three', 'four', 'five']) jarl(root, 'new', t);
  jarl(root, 'field', '5', 'Parent', '4');
  assert.match(jarl(root, 'verify'), /^issues\/: clean$/m);
  const edit = (id, parent) => { const f = json(root, 'show', id).file; writeFileSync(f, readFileSync(f, 'utf8').replace(/^\*\*Where:\*\*.*$/m, (w) => `${w}\n**Parent:** ${parent}`)); };
  edit('1', '99');
  edit('2', '3');
  edit('3', '2');
  edit('4', '4');
  const out = L.cmdVerify(root);
  const issues = out.checks.find((c) => c.name === 'issues').findings.map((x) => `${x.where}: ${x.what}`);
  assert.ok(issues.includes('issue 1: names 99 in its Parent field, which the loop does not hold'), issues.join('\n'));
  assert.ok(issues.includes('issue 2: its parents come back to it (2 → 3 → 2), so none of them is ever offered'), issues.join('\n'));
  assert.ok(issues.includes('issue 3: its parents come back to it (3 → 2 → 3), so none of them is ever offered'), issues.join('\n'));
  assert.ok(issues.includes('issue 4: names itself in its Parent field'), issues.join('\n'));
  // The views stand on such a record: the list holds every issue once.
  assert.deepEqual(json(root, 'list', '--all').map((i) => i.id).sort(), ['1', '2', '3', '4', '5']);
});

test('an open issue under a finished parent, written by hand, is a finding of verify', () => {
  const root = loop();
  jarl(root, 'new', 'parent');
  jarl(root, 'new', 'child');
  jarl(root, 'field', '2', 'Parent', '1');
  jarl(root, 'set', '1,2', 'dropped', 'not needed');
  const f = json(root, 'show', '2').file;
  // The log is the record of a status: the child's reopen is written as the command writes it, and its header follows.
  const logFile = join(root, '.jarl', 'log.md');
  writeFileSync(logFile, `${readFileSync(logFile, 'utf8')}- 2026-11-05 12:00 · 2 → open · reopened by hand\n`);
  writeFileSync(f, readFileSync(f, 'utf8').replace(/^\*\*Status:\*\* dropped$/m, '**Status:** open'));
  const issues = L.cmdVerify(root).checks.find((c) => c.name === 'issues').findings.map((x) => `${x.where}: ${x.what}`);
  assert.ok(issues.includes('issue 2: is open under 1, which is dropped: reopen 1, or finish 2'), issues.join('\n'));
});

test('a loop that never names a parent is not raised by the views of the tree, and the frozen readers read it as before', () => {
  const root = loop();
  fileAsBefore(root, 'one', { acceptance: 'it works' });
  fileAsBefore(root, 'two', { acceptance: 'it works', after: '1' });
  for (const view of [['list', '--all'], ['next', '--all'], ['next', '--as', 'jarl'], ['status'], ['resume'], ['report'], ['verify'], ['brief', '2']]) jarl(root, ...view);
  assert.throws(() => readFileSync(marker(root)), /ENOENT/, 'no record format marker was written');
  assert.equal(oldJarl(root, 'list', {}).ok, true);
  assert.equal(formatTwoJarl(root, 'next', {}).ok, true);
});
