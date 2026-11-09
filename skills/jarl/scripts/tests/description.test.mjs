// An issue is its description and its history. Every part of the description is changed by a command, and each change
// writes one log line with who changed it and what the part held before; field refuses any other name, naming the ones it
// writes; the history has no edit command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jarl, refuses, loop as makeLoop, skillText } from './helpers.mjs';
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
  jarl(root, 'new', 'first title', '--kind', 'gap', '--prio', '2', '--tier', 'standard', '--found-by', 'owner', '--field', 'Area=core', '--what', 'old what', '--why', 'old why', '--acceptance', '[read] old line', '--changelog', 'Fixed: old entry', '--section', 'Design=old design');
  jarl(root, 'new', 'second', '--acceptance', '[read] it works', '--tier', 'light');
  jarl(root, 'new', 'third', '--acceptance', '[read] it works', '--tier', 'light');
  return root;
}
const logLines = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8').split('\n').map((l) => l.replace(/^- \d{4}-\d{2}-\d{2} \d{2}:\d{2}(?: key \S+)? by [^·]+ · /, ''));
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
  assert.equal(lastLine(root), '1 field Tier · light · was strong · by test-writer', 'a write that names nobody carries no author');
  const count = logLines(root).length;
  jarl(root, 'field', '1', 'Tier', 'light', '--by', 'w-one');
  jarl(root, 'field', '1', 'Priority', '1');
  jarl(root, 'field', '1', 'Tags', '--add', 'a');
  jarl(root, 'field', '1', 'Title', 'a better title');
  jarl(root, 'field', '1', 'What', 'old what');
  assert.equal(logLines(root).length, count, 'a value the part already holds writes no line');
});

test('the record library logs the writer its options name, and no author when they name none', () => {
  const root = profiledLoop();
  R.setField(root, '1', 'Area', 'cli', { by: 'composer-x-architect' });
  assert.equal(lastLine(root), '1 field Area · cli · was core · by composer-x-architect');
  R.setBody(root, '1', { why: 'library why', by: 'composer-x-architect' });
  assert.equal(lastLine(root), '1 body · why · was "old why" (7 characters) · by composer-x-architect');
  R.setAfter(root, '1', '2', { by: 'composer-x-architect' });
  assert.equal(lastLine(root), '1 field After · 2 · was (none) · by composer-x-architect');
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

test('the record library writes Tags, Priority, Files and Source through setField with the writer its options name', () => {
  const root = profiledLoop();
  for (const [field, value, line] of [
    ['Tags', 'x, y', '1 field Tags · x, y · was (none) · by composer-x-architect'],
    ['Priority', '3', '1 field Priority · 3 · was 2 · by composer-x-architect'],
    ['Files', 'a.mjs, b.mjs', '1 field Files · a.mjs, b.mjs · was (none) · by composer-x-architect'],
    ['Source', 'r/x#1', '1 field Source · r/x#1 · was (none) · by composer-x-architect'],
  ]) {
    assert.deepEqual(R.setField(root, '1', field, value, { by: 'composer-x-architect' }), { id: '1', field, value }, field);
    assert.equal(lastLine(root), line, field);
  }
  R.setField(root, '1', 'Priority', '1');
  assert.equal(lastLine(root), '1 field Priority · 1 · was 3', 'with no writer named, the line names none');
  assert.throws(() => R.setField(root, '1', 'Priority', '7', { by: 'composer-x-architect' }), /Priority must be one of: 1, 2, 3/);
});

test('a change of Where logs at most the first 120 characters of what it held, with its length when it was longer', () => {
  const root = profiledLoop();
  const long = `${'a long place '.repeat(20)}end`;
  jarl(root, 'field', '1', 'Where', long);
  jarl(root, 'field', '1', 'Where', 'a short place', '--by', 'w-one');
  assert.equal(lastLine(root), `1 field Where · a short place · was ${long.slice(0, 120)}… (${long.length} characters) · by w-one`);
  jarl(root, 'field', '1', 'Where', 'another place');
  assert.equal(lastLine(root), '1 field Where · another place · was a short place · by test-writer', 'a short value is kept whole');
  jarl(root, 'field', '1', 'Where', long);
  jarl(root, 'field', '1', 'Where', '--clear');
  assert.equal(lastLine(root), `1 field Where · (cleared) · was ${long.slice(0, 120)}… (${long.length} characters) · by test-writer`, 'a cleared one too');
});

test('a change of Where logs at most the first 120 characters of the new value too, with its length when it is longer', () => {
  const root = profiledLoop();
  const long = `${'a long place '.repeat(20)}end`;
  const longer = `${'another long place '.repeat(20)}end`;
  jarl(root, 'field', '1', 'Where', 'a short place');
  jarl(root, 'field', '1', 'Where', long, '--by', 'w-one');
  assert.equal(lastLine(root), `1 field Where · ${long.slice(0, 120)}… (${long.length} characters) · was a short place · by w-one`);
  jarl(root, 'field', '1', 'Where', longer);
  assert.equal(lastLine(root), `1 field Where · ${longer.slice(0, 120)}… (${longer.length} characters) · was ${long.slice(0, 120)}… (${long.length} characters) · by test-writer`, 'both values are bounded');
  const exact = 'x'.repeat(120);
  jarl(root, 'field', '1', 'Where', exact);
  assert.equal(lastLine(root), `1 field Where · ${exact} · was ${longer.slice(0, 120)}… (${longer.length} characters) · by test-writer`, 'a value of exactly 120 characters is kept whole');
  assert.equal(lastLine(root).includes(longer.slice(130)), false, 'the rest of a long value is not in the log');
});

test('field logs the old value and who changed it on a list of ids, an added and a removed item, and a cleared field', () => {
  const root = profiledLoop();
  jarl(root, 'field', '1,2', 'Priority', '3', '--by', 'coord');
  assert.deepEqual(logLines(root).filter((l) => / field Priority /.test(l)), ['1 field Priority · 3 · was 2 · by coord', '2 field Priority · 3 · was 2 · by coord']);
  jarl(root, 'field', '1', 'Tags', '--add', 'x,y');
  jarl(root, 'field', '1', 'Tags', '--remove', 'x', '--by', 'coord');
  assert.equal(lastLine(root), '1 field Tags · y · was x, y · by coord');
  jarl(root, 'field', '1', 'Files', 'a.mjs');
  jarl(root, 'field', '1', 'Files', 'b.mjs', '--by', 'coord');
  assert.equal(lastLine(root), '1 field Files · b.mjs · was a.mjs · by coord');
  jarl(root, 'field', '1', 'Source', 'r/x#1', '--by', 'coord');
  assert.equal(lastLine(root), '1 field Source · r/x#1 · was (none) · by coord');
  jarl(root, 'field', '1', 'After', '3', '--by', 'coord');
  jarl(root, 'field', '1', 'After', '--clear', '--by', 'coord');
  assert.equal(lastLine(root), '1 field After · (cleared) · was 3 · by coord');
  jarl(root, 'field', '1', 'Files', '--clear', '--by', 'coord');
  assert.equal(lastLine(root), '1 field Files · (cleared) · was b.mjs · by coord');
});

test('field logs each section it replaces by the first line and the length of what the section held, and who changed it', () => {
  const root = profiledLoop();
  for (const [part, value] of [['What', 'new what'], ['Why', 'new\nwhy'], ['Acceptance', '[read] line a\n[read] line b'], ['Design', 'new design'], ['Changelog', 'Fixed: new entry']]) jarl(root, 'field', '1', part, value, '--by', 'w-two');
  const lines = logLines(root).filter((l) => l.startsWith('1 body · '));
  assert.deepEqual(lines, [
    '1 body · what · was "old what" (8 characters) · by w-two',
    '1 body · why · was "old why" (7 characters) · by w-two',
    '1 body · acceptance · was "[read] old line" · by w-two',
    '1 body · Design · was "old design" (10 characters) · by w-two',
    '1 body · changelog · was "- Fixed: old entry" (18 characters) · by w-two',
  ]);
  jarl(root, 'field', '1', 'Why', 'third why');
  assert.equal(lastLine(root), '1 body · why · was "new" (7 characters) · by test-writer', 'a section is kept by its first line and its length');
  const long = `${'x'.repeat(300)}\nsecond line`;
  jarl(root, 'field', '1', 'What', long);
  jarl(root, 'field', '1', 'What', 'short');
  assert.equal(lastLine(root), `1 body · what · was "${'x'.repeat(120)}…" (${long.length} characters) · by test-writer`, 'the first line is cut, so the line stays short');
  jarl(root, 'field', '1', 'Title', 'a · dotted title');
  jarl(root, 'field', '1', 'Title', 'plain');
  assert.equal(lastLine(root), '1 body · title · was "a ∙ dotted title" · by test-writer', 'the log\'s separator in a value is written as its stand-in');
  jarl(root, 'field', '1', 'Found by', 'x · y');
  jarl(root, 'field', '1', 'Found by', 'owner');
  assert.equal(lastLine(root), '1 field Found by · owner · was x ∙ y · by test-writer');
  assert.equal(R.findIssue(root, '1').sections.why.trim(), 'third why');
});

test('field --add adds to a section after what it holds, and logs the line a replacement logs', () => {
  const root = profiledLoop();
  jarl(root, 'field', '1', 'What', 'more what', '--add');
  assert.equal(R.findIssue(root, '1').sections.what.trim(), 'old what\n\nmore what', 'the new text follows the text the section held, as its own paragraph');
  assert.equal(lastLine(root), '1 body · what · was "old what" (8 characters) · by test-writer', 'the line says what the section held before the append');
  jarl(root, 'field', '1', 'Why', 'more why', '--add', '--by', 'w-two');
  assert.equal(lastLine(root), '1 body · why · was "old why" (7 characters) · by w-two');
  jarl(root, 'field', '1', 'Acceptance', '[read] line b', '--add');
  assert.equal(R.findIssue(root, '1').sections.acceptance.trim(), '- [read] old line\n- [read] line b', 'the new line joins the list the section held');
  assert.equal(lastLine(root), '1 body · acceptance · was "[read] old line" · by test-writer');
  jarl(root, 'field', '1', 'Changelog', 'Added: new entry', '--add');
  assert.equal(R.findIssue(root, '1').sections.changelog.trim(), '- Fixed: old entry\n- Added: new entry');
  assert.equal(lastLine(root), '1 body · changelog · was "- Fixed: old entry" (18 characters) · by test-writer');
  jarl(root, 'field', '1', 'Design', 'more design', '--add');
  assert.equal(R.findIssue(root, '1').sections.design.trim(), 'old design\n\nmore design');
  assert.equal(lastLine(root), '1 body · Design · was "old design" (10 characters) · by test-writer');
  jarl(root, 'field', '2', 'What', 'first what', '--add');
  assert.equal(R.findIssue(root, '2').sections.what.trim(), 'first what', 'a section that holds nothing takes the text alone');
  assert.equal(lastLine(root), '2 body · what · was (none) · by test-writer');
  assert.match(refuses(root, 'field', '1', 'Title', 'x', '--add'), /Title holds one value, so it is replaced, never added to or taken from/, 'the title is replaced, never appended to');
  assert.match(refuses(root, 'field', '1', 'Where', 'x', '--add'), /Where holds one value/);
  assert.match(refuses(root, 'field', '1', 'Why', '', '--add'), /^field Why needs a value, or --clear to empty it\njarl\.mjs field "<ids>" Why "<text>" --by "<who>" --add\n$/);
  jarl(root, 'field', '1', 'What', 'replaced');
  assert.equal(R.findIssue(root, '1').sections.what.trim(), 'replaced', 'without --add a section is replaced');
});

test('a name field does not write is refused with the names it writes and the command that writes that one', () => {
  const root = profiledLoop();
  const names = /Title, Priority, Tier, Kind, Found by, Tags, Files, Repo, After, Parent, Source, Where, Resources, Person, Check when, Area, Note, What, Why, Acceptance, Changelog, Design/;
  for (const [name, why] of [['Status', /jarl\.mjs set "<ids>" "<status>"/], ['done', /jarl\.mjs set "<ids>" "<status>"/], ['Branch', /written by set: jarl\.mjs set "<ids>" in-progress/], ['Worker', /written by set/], ['Merged', /recorded by merged: jarl\.mjs merged "<ids>" --sha "<sha>"/], ['CI', /recorded by merged/], ['Evidence', /history is never edited: .*retract.*decide --supersedes: jarl\.mjs retract/], ['Bogus', /no other part goes by that name: .* the profile lists them: jarl\.mjs profile/]]) {
    const said = refuses(root, 'field', '1', name, 'x');
    assert.match(said, new RegExp(`${name} is not a part of the description, which field writes: `), name);
    assert.match(said, names, name);
    assert.match(said, why, name);
  }
  assert.match(refuses(root, 'field', '1', 'Tier', 'huge'), /Tier must be one of: light, standard, strong/);
  assert.match(refuses(root, 'field', '1', 'Kind', 'task'), /Kind must be one of: bug, gap/);
  assert.match(refuses(root, 'field', '1', 'Priority', '7'), /Priority must be one of: 1, 2, 3/);
  for (const name of ['Tier', 'Kind', 'Priority', 'Found by', 'Title']) assert.match(refuses(root, 'field', '1', name, '--clear'), new RegExp(`${name} cannot be emptied`), name);
  assert.match(refuses(root, 'field', '1', 'Tags', '[a, b]'), /Tags takes its items one by one/);
  assert.match(refuses(root, 'field', '1', 'Tier', 'strong', '--by', 'a · b'), /--by is one name/);
  assert.match(refuses(root, 'base', 'x', 'main', '--by', 'me'), /x is not declared in this loop/);
  assert.equal(show(root, '1').tier, 'standard', 'a refused call writes nothing');
});

test('the help has one command for the description, and the reference says the history is only retracted or superseded', () => {
  const at = (cmd) => USAGE.search(new RegExp(`^  ${cmd} `, 'm'));
  assert.ok(at('field') > 0, 'field has its block');
  for (const cmd of ['body', 'tag', 'prio', 'files', 'repo', 'source', 'after']) assert.equal(at(cmd), -1, `${cmd} has no block`);
  const record = skillText('references/record.md');
  assert.match(record, /## The description and the history/);
  assert.match(record, /Evidence, verdicts, merges, rulings and answers have no edit command at all/);
  assert.match(record, /No reader takes a description line as state: `log` writes a hand-written line of the `field` shape as a note/);
});
