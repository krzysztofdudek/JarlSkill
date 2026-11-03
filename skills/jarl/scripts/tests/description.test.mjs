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
const logLines = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8').split('\n').map((l) => l.replace(/^- \d{4}-\d{2}-\d{2} \d{2}:\d{2} · /, ''));
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
  assert.equal(lastLine(root), '1 field Tier · light · was strong · by jarl', 'who changed it is jarl when the call names nobody');
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

test('body logs each part it replaces with the text the part held, on one line, and who changed it', () => {
  const root = profiledLoop();
  jarl(root, 'body', '1', '--what', 'new what', '--why', 'new\nwhy', '--acceptance', 'line a', '--acceptance', 'line b', '--changelog', 'Fixed: new entry', '--section', 'Design=new design', '--by', 'w-two');
  const lines = logLines(root).filter((l) => l.startsWith('1 body · '));
  assert.deepEqual(lines, [
    '1 body · what · was "old what" · by w-two',
    '1 body · why · was "old why" · by w-two',
    '1 body · acceptance · was "old line" · by w-two',
    '1 body · Design · was "old design" · by w-two',
    '1 body · changelog · was "- Fixed: old entry" · by w-two',
  ]);
  jarl(root, 'body', '1', '--why', 'third why');
  assert.equal(lastLine(root), '1 body · why · was "new ⏎ why" · by jarl', 'a text of several lines is kept on one line');
  jarl(root, 'body', '1', '--title', 'a · dotted title');
  jarl(root, 'body', '1', '--title', 'plain');
  assert.equal(lastLine(root), '1 body · title · was "a - dotted title" · by jarl', 'the log\'s separator never reaches a value');
  assert.equal(R.findIssue(root, '1').sections.why.trim(), 'third why');
});

test('a name field does not write is refused with the names it writes and the command that writes that one', () => {
  const root = profiledLoop();
  const names = /Title, Priority, Tier, Kind, Found by, Tags, Files, Repo, After, Source, Where, Resources, Area, Note/;
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
