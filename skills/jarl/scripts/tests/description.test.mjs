// An issue is its description and its history. Every part of the description is changed by a command, and each change
// writes one log line with who changed it and what the part held before; field refuses any other name, naming the ones it
// writes; the history has no edit command. The pinned frozen reader reads a loop so changed as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jarl, refuses, loop as makeLoop, skillText } from './helpers.mjs';
import { oldJarl } from './old-jarl.mjs';
import * as R from '../record.mjs';

const L = await import('../jarl-lib.mjs');
const { renderVerify } = L;
const { USAGE } = await import('../jarl.mjs');

const PROFILE = { 'jarl-profile': 1, name: 'fielded', statuses: L.BUILTIN_STATUSES, fields: { Area: { enum: ['core', 'cli'] }, Note: {} }, sections: ['Design'] };
function profiledLoop() {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-description-profile-'));
  const file = join(dir, 'profile.json');
  writeFileSync(file, JSON.stringify(PROFILE));
  const root = makeLoop({ prefix: 'jarl-description-', goal: 'a goal', via: 'cli', initFlags: ['--profile', file] });
  jarl(root, 'new', 'first title', '--kind', 'gap', '--prio', '2', '--tier', 'standard', '--found-by', 'owner', '--field', 'Area=core', '--what', 'old what', '--why', 'old why', '--acceptance', 'old line', '--changelog', 'Fixed: old entry', '--section', 'Design=old design');
  jarl(root, 'new', 'second', '--tier', 'light');
  jarl(root, 'new', 'third', '--tier', 'light');
  return root;
}
const logLines = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8').split('\n').map((l) => l.replace(/^- \d{4}-\d{2}-\d{2} \d{2}:\d{2}(?: key \S+)? · /, ''));
const lastLine = (root) => logLines(root).filter(Boolean).at(-1);
const show = (root, id) => JSON.parse(jarl(root, 'show', id, '--json'));

test('field writes every header field of the description, each with a log line naming its old value and who changed it', () => {
  const root = profiledLoop();
  const cases = [
    ['Tier', 'strong', (i) => i.tier, 'standard'],
    ['Kind', 'bug', (i) => i.kind, 'gap'],
    ['Priority', '1', (i) => i.priority, '2'],
    ['Found by', 'field-report', (i) => i.fields['found by'], 'owner'],
    ['Title', 'a better title', (i) => i.title, 'first title'],
    ['Where', 'the parser', (i) => i.fields.where, '(none)'],
    ['Tags', 'b, a', (i) => i.tags.join(', '), '(none)'],
    ['Files', 'src/a.mjs, src/b.mjs', (i) => i.files.join(', '), '(none)'],
    ['After', '2', (i) => i.after.join(', '), '(none)'],
    ['Source', 'research/r#f-1', (i) => i.sources.join(', '), '(none)'],
    ['Resources', 'gate', (i) => i.resources.join(', '), '(none)'],
    ['Area', 'cli', (i) => i.fields.area, 'core'],
    ['Note', 'see the thread', (i) => i.fields.note, '(none)'],
  ];
  for (const [name, value, read, was] of cases) {
    assert.equal(jarl(root, 'field', '1', name, value, '--by', 'w-one'), `1 ${name}: ${name === 'Tags' ? 'a, b' : value}`, name);
    assert.equal(read(show(root, '1')), name === 'Tags' ? 'a, b' : value, name);
    if (name === 'Title') assert.equal(lastLine(root), '1 body · title · was "first title" · by w-one');
    else assert.equal(lastLine(root), `1 field ${name} · ${name === 'Tags' ? 'a, b' : value} · was ${was} · by w-one`, name);
  }
  jarl(root, 'field', '1', 'Tier', 'light');
  assert.equal(lastLine(root), '1 field Tier · light · was strong', 'a write that names nobody carries no author');
  const count = logLines(root).length;
  jarl(root, 'field', '1', 'Tier', 'light', '--by', 'w-one');
  jarl(root, 'prio', '1', '1');
  jarl(root, 'tag', '1', '+a');
  jarl(root, 'field', '1', 'Title', 'a better title');
  jarl(root, 'body', '1', '--what', 'old what');
  assert.equal(logLines(root).length, count, 'a value the part already holds writes no line');
});

test('the record library logs the writer its options name, and no author when they name none', () => {
  const root = profiledLoop();
  R.setField(root, '1', 'Area', 'cli', { by: 'horde-architect' });
  assert.equal(lastLine(root), '1 field Area · cli · was core · by horde-architect');
  R.setBody(root, '1', { why: 'library why', by: 'horde-architect' });
  assert.equal(lastLine(root), '1 body · why · was "old why" (7 characters) · by horde-architect');
  R.setAfter(root, '1', '2', { by: 'horde-architect' });
  assert.equal(lastLine(root), '1 field After · 2 · was (none) · by horde-architect');
  R.setAfter(root, '1', undefined, { clear: true });
  assert.equal(lastLine(root), '1 field After · (cleared) · was 2');
  R.setFiles(root, '1', 'a.mjs');
  assert.equal(lastLine(root), '1 field Files · a.mjs · was (none)');
  R.setTags(root, '1', ['+x']);
  assert.equal(lastLine(root), '1 field Tags · x · was (none)');
  R.setPriority(root, '1', '3');
  assert.equal(lastLine(root), '1 field Priority · 3 · was 2');
  R.setSource(root, '1', 'r/x#1');
  assert.equal(lastLine(root), '1 field Source · r/x#1 · was (none)');
});

test('the dedicated commands of the description log the old value and who changed it, by the one rule field follows', () => {
  const root = profiledLoop();
  jarl(root, 'prio', '1,2', '3', '--by', 'coord');
  assert.deepEqual(logLines(root).filter((l) => / field Priority /.test(l)), ['1 field Priority · 3 · was 2 · by coord', '2 field Priority · 3 · was 2 · by coord']);
  jarl(root, 'tag', '1', '+x', '+y');
  jarl(root, 'tag', '1', '-x', '--by', 'coord');
  assert.equal(lastLine(root), '1 field Tags · y · was x, y · by coord');
  jarl(root, 'files', '1', 'a.mjs');
  jarl(root, 'files', '1', 'b.mjs', '--by', 'coord');
  assert.equal(lastLine(root), '1 field Files · b.mjs · was a.mjs · by coord');
  jarl(root, 'source', '1', 'r/x#1', '--by', 'coord');
  assert.equal(lastLine(root), '1 field Source · r/x#1 · was (none) · by coord');
  jarl(root, 'after', '1', '3', '--by', 'coord');
  jarl(root, 'after', '1', '--clear', '--by', 'coord');
  assert.equal(lastLine(root), '1 field After · (cleared) · was 3 · by coord');
  jarl(root, 'field', '1', 'Files', '--clear', '--by', 'coord');
  assert.equal(lastLine(root), '1 field Files · (cleared) · was b.mjs · by coord');
});

test('body logs each part it replaces by the first line and the length of what the part held, and who changed it', () => {
  const root = profiledLoop();
  jarl(root, 'body', '1', '--what', 'new what', '--why', 'new\nwhy', '--acceptance', 'line a', '--acceptance', 'line b', '--changelog', 'Fixed: new entry', '--section', 'Design=new design', '--by', 'w-two');
  const lines = logLines(root).filter((l) => l.startsWith('1 body · '));
  assert.deepEqual(lines, [
    '1 body · what · was "old what" (8 characters) · by w-two',
    '1 body · why · was "old why" (7 characters) · by w-two',
    '1 body · acceptance · was "old line" (8 characters) · by w-two',
    '1 body · Design · was "old design" (10 characters) · by w-two',
    '1 body · changelog · was "- Fixed: old entry" (18 characters) · by w-two',
  ]);
  jarl(root, 'body', '1', '--why', 'third why');
  assert.equal(lastLine(root), '1 body · why · was "new" (7 characters)', 'a section is kept by its first line and its length');
  const long = `${'x'.repeat(300)}\nsecond line`;
  jarl(root, 'body', '1', '--what', long);
  jarl(root, 'body', '1', '--what', 'short');
  assert.equal(lastLine(root), `1 body · what · was "${'x'.repeat(120)}…" (${long.length} characters)`, 'the first line is cut, so the line stays short');
  jarl(root, 'body', '1', '--title', 'a · dotted title');
  jarl(root, 'body', '1', '--title', 'plain');
  assert.equal(lastLine(root), '1 body · title · was "a ∙ dotted title"', 'the log\'s separator in a value is written as its stand-in');
  jarl(root, 'field', '1', 'Found by', 'x · y');
  jarl(root, 'field', '1', 'Found by', 'owner');
  assert.equal(lastLine(root), '1 field Found by · owner · was x ∙ y');
  assert.equal(R.findIssue(root, '1').sections.why.trim(), 'third why');
});

test('body --append adds to a section after what it holds, and logs the line a replacement logs', () => {
  const root = profiledLoop();
  jarl(root, 'body', '1', '--what', 'more what', '--append');
  assert.equal(R.findIssue(root, '1').sections.what.trim(), 'old what\n\nmore what', 'the new text follows the text the section held, as its own paragraph');
  assert.equal(lastLine(root), '1 body · what · was "old what" (8 characters)', 'the line says what the section held before the append');
  jarl(root, 'body', '1', '--why', 'more why', '--append', '--by', 'w-two');
  assert.equal(lastLine(root), '1 body · why · was "old why" (7 characters) · by w-two');
  jarl(root, 'body', '1', '--acceptance', 'line b', '--append');
  assert.equal(R.findIssue(root, '1').sections.acceptance.trim(), '- old line\n- line b', 'the new line joins the list the section held');
  assert.equal(lastLine(root), '1 body · acceptance · was "old line" (8 characters)');
  jarl(root, 'body', '1', '--changelog', 'Added: new entry', '--append');
  assert.equal(R.findIssue(root, '1').sections.changelog.trim(), '- Fixed: old entry\n- Added: new entry');
  assert.equal(lastLine(root), '1 body · changelog · was "- Fixed: old entry" (18 characters)');
  jarl(root, 'body', '1', '--section', 'Design=more design', '--append');
  assert.equal(R.findIssue(root, '1').sections.design.trim(), 'old design\n\nmore design');
  assert.equal(lastLine(root), '1 body · Design · was "old design" (10 characters)');
  jarl(root, 'body', '2', '--what', 'first what', '--append');
  assert.equal(R.findIssue(root, '2').sections.what.trim(), 'first what', 'a section that holds nothing takes the text alone');
  assert.equal(lastLine(root), '2 body · what · was (none)');
  assert.match(refuses(root, 'body', '1', '--title', 'x', '--append'), /--append adds to a section/, 'the title is replaced, never appended to');
  assert.match(refuses(root, 'body', '1', '--why', '', '--append'), /--append needs text to add to the Why section/);
  jarl(root, 'body', '1', '--what', 'replaced');
  assert.equal(R.findIssue(root, '1').sections.what.trim(), 'replaced', 'without --append a section is replaced, as before');
});

test('a name field does not write is refused with the names it writes and the command that writes that one', () => {
  const root = profiledLoop();
  const names = /Title, Priority, Tier, Kind, Found by, Tags, Files, Repo, After, Source, Where, Resources, Person, Check when, Area, Note/;
  for (const [name, why] of [['Status', /set <ids> <status>/], ['done', /set <ids> <status>/], ['Branch', /written by set <ids> in-progress/], ['Worker', /written by set/], ['Merged', /recorded by merged/], ['CI', /recorded by merged/], ['Evidence', /history is never edited: .*retract.*decide --supersedes/], ['What', /body <ids> --what/], ['Design', /body <ids> --section/], ['Bogus', /a section is written by body/]]) {
    const said = refuses(root, 'field', '1', name, 'x');
    assert.match(said, new RegExp(`${name} is not a field of the description, which field writes: `), name);
    assert.match(said, names, name);
    assert.match(said, why, name);
  }
  assert.match(refuses(root, 'field', '1', 'Tier', 'huge'), /Tier must be one of: light, standard, strong/);
  assert.match(refuses(root, 'field', '1', 'Kind', 'task'), /Kind must be one of: bug, gap/);
  assert.match(refuses(root, 'field', '1', 'Priority', '7'), /Priority must be one of: 1, 2, 3/);
  for (const name of ['Tier', 'Kind', 'Priority', 'Found by', 'Title']) assert.match(refuses(root, 'field', '1', name, '--clear'), new RegExp(`${name} cannot be empty`), name);
  assert.match(refuses(root, 'field', '1', 'Tags', '[a, b]'), /Tags takes its items one by one/);
  assert.match(refuses(root, 'field', '1', 'Tier', 'strong', '--by', 'a · b'), /--by is one name/);
  assert.match(refuses(root, 'repo', '--base', 'x', 'main', '--by', 'me'), /no --clear or --by/);
  assert.equal(show(root, '1').tier, 'standard', 'a refused call writes nothing');
});

test('the help lists the description commands together, and the reference says the history is only retracted or superseded', () => {
  const at = (cmd) => USAGE.search(new RegExp(`^  ${cmd} `, 'm'));
  const order = ['body', 'field', 'tag', 'prio', 'files', 'repo', 'source', 'after'].map(at);
  assert.ok(order.every((n) => n > 0), 'each command has its block');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'in one run, body first');
  const between = USAGE.slice(order[0], order.at(-1)).match(/^ {2}[a-z]+ /gm).map((s) => s.trim());
  assert.deepEqual(between, ['body', 'field', 'tag', 'prio', 'files', 'repo', 'source'], 'no other command among them');
  const record = skillText('references/record.md');
  assert.match(record, /## The description and the history/);
  assert.match(record, /Evidence, verdicts, merges, rulings and answers have no edit command at all/);
  assert.match(record, /No reader takes a description line as state: `log` writes a hand-written line of the `field` shape as a note/);
});

test('a loop whose description was changed by every command is read by the pinned frozen reader as before', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-description-old-'));
  mkdirSync(join(root, '.git'));
  jarl(root, 'init', 'a goal');
  // Two issues as the frozen reader writes them: three-digit ids, each filed in the log.
  for (const id of ['001', '002']) {
    writeFileSync(join(root, '.jarl', 'issues', `${id}-old-${id}.md`), L.renderIssue({ id, title: `old ${id}`, kind: 'gap', priority: '2', tier: 'standard', tags: [], files: [], repo: '', foundBy: 'jarl' }));
    appendFileSync(join(root, '.jarl', 'log.md'), `- 2026-01-01 00:00 · filed ${id} · old ${id}\n`);
  }
  const before = oldJarl(root, 'status', {});
  assert.equal(before.ok, true);
  jarl(root, 'field', '001', 'Tier', 'strong', '--by', 'coord');
  jarl(root, 'field', '001', 'Kind', 'bug');
  jarl(root, 'field', '001', 'Found by', 'owner');
  jarl(root, 'field', '001', 'Title', 'a better title');
  jarl(root, 'prio', '001', '1');
  jarl(root, 'tag', '001', '+x');
  jarl(root, 'files', '001', 'a.mjs');
  jarl(root, 'source', '001', 'r/x#1');
  jarl(root, 'after', '001', '002');
  jarl(root, 'body', '001', '--what', 'w', '--why', 'y', '--acceptance', 'a', '--where', 'here');
  jarl(root, 'field', '001', 'Resources', 'gate');
  const list = oldJarl(root, 'list', { all: true });
  assert.equal(list.ok, true, list.error);
  const one = list.value.find((i) => i.id === '001');
  assert.deepEqual([one.title, one.tier, one.kind, one.priority, one.tags, one.files, one.after], ['a better title', 'strong', 'bug', '1', ['x'], ['a.mjs'], ['002']]);
  const after = oldJarl(root, 'status', {});
  assert.equal(after.ok, true, after.error);
  for (const k of ['open', 'in-progress', 'done', 'dropped', 'deferred']) assert.equal(after.value[k], before.value[k], k);
  assert.equal(after.value.waiting, 1, 'the After it was given is read');
  const verify = L.cmdVerify(root);
  assert.equal(verify.ok, true, renderVerify(verify));
});
