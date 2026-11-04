// One grammar for the commands: --help exits 0, one retract verb for a verdict and an evidence row, set for statuses and
// field for fields, one way to empty a field, and the list grammar on the commands that write more than one issue. A
// spelling that names the same operation through evidence, review or set is refused with the call of the verb.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnJarl, run, jarl, refuses, loop as makeLoop, gitRepo } from './helpers.mjs';
import * as R from '../record.mjs';

const mcp = await import('../jarl-mcp.mjs');
const L = await import('../jarl-lib.mjs');

const loop = () => makeLoop({ prefix: 'jarl-grammar-', goal: 'a goal', via: 'cli' });
const issueText = (root, id) => readFileSync(R.findIssue(root, id).file, 'utf8');
// The clock and the issues' keys (a filing stamp and four random letters) taken out, so twin loops read the same.
const scrubbed = (text) => text.replace(/\b\d{8}T\d{4}-[a-z]{4}\b/g, '<key>').replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, '<t>');
const logText = (root) => scrubbed(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'));
const field = (root, id, name) => JSON.parse(jarl(root, 'show', id, '--json')).fields[name];
// An issue in progress on a branch, with one proof row and one approve.
function worked(root, title = 'thing to do') {
  const id = R.newIssue(root, title, { acceptance: 'it works' }).id;
  jarl(root, 'set', id, 'in-progress', '--worker', 'w-one', '--branch', `jarl/${id}-x`);
  jarl(root, 'evidence', id, '--ran', 'npm test', '--saw', 'pass 5');
  jarl(root, 'review', id, 'approve', '--by', 'rev-a', 'read the diff, nothing found');
  return id;
}
// Issues filed by the command line, numbered plain (1, 2, 3).
function issues(root, n = 3) { for (let i = 1; i <= n; i += 1) jarl(root, 'new', `issue ${i}`); }

const PROFILE = { 'jarl-profile': 1, name: 'grammar', statuses: L.BUILTIN_STATUSES, fields: { Area: { enum: ['core', 'cli'], required: true }, Note: {} } };
function fieldedLoop() {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-grammar-profile-'));
  const file = join(dir, 'profile.json');
  writeFileSync(file, JSON.stringify(PROFILE));
  const root = makeLoop({ prefix: 'jarl-grammar-fielded-', goal: 'a goal', via: 'cli', initFlags: ['--profile', file] });
  for (const t of ['a', 'b', 'c']) jarl(root, 'new', t, '--field', 'Area=core');
  return root;
}

test('--help prints the usage on stdout and exits 0', () => {
  const r = spawnJarl(process.cwd(), ['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^usage: jarl\.mjs '<a-jarl-command>'/);
  assert.equal(r.stderr, '');
  const withCommand = spawnJarl(process.cwd(), ['list', '--help']);
  assert.equal(withCommand.status, 0);
  assert.match(withCommand.stdout, /^usage: jarl\.mjs/);
});

test('retract takes back a verdict and an evidence row; the spellings through evidence and review are refused with the retract call', () => {
  const root = loop();
  worked(root);
  const reason = 'the row and the verdict were read in the wrong place';
  const before = logText(root);
  assert.equal(refuses(root, 'evidence', '1', '--retract', '1', '--by', 'jarl', reason).trim(), "evidence takes nothing back with --retract: a row or a note is taken back with retract\njarl.mjs retract '<id>' '<n-or-note-n>' '<why>' --by '<who>'");
  assert.equal(refuses(root, 'review', '1', 'retract', '--by', 'jarl', reason).trim(), "a verdict is taken back with retract, not with review retract\njarl.mjs retract '<id>' review '<why>' --by '<who>'");
  assert.equal(logText(root), before, 'a refused spelling writes nothing');
  for (const r of [run(root, ['retract', '1', '1', '--by', 'jarl', reason]), run(root, ['retract', '1', 'review', '--by', 'jarl', reason])]) {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '', 'the verb says nothing on stderr');
  }
  assert.match(issueText(root, '1'), /~~\*\*ran:\*\*/);
  assert.match(issueText(root, '1'), /~~\*\*approve\*\*/);
});

test('retract refuses what it cannot take back, in words that name what it takes', () => {
  const b = loop();
  worked(b);
  const before = logText(b);
  assert.match(refuses(b, 'retract', '1', '3', '--by', 'jarl', 'no such row here'), /has 1 evidence row: there is no row 3/);
  assert.match(refuses(b, 'retract', '1', '1', 'because the row is wrong'), /needs --by <who>/);
  assert.match(refuses(b, 'retract', '1', 'approve', '--by', 'jarl', 'what is this word'), /retract takes review .* or the number of an evidence row/);
  assert.match(refuses(b, 'retract', '1', '0', '--by', 'jarl', 'row zero does not exist'), /^retract takes the number of an evidence row/);
  assert.match(refuses(b, 'retract', '1,4', 'review', '--by', 'jarl', 'two issues at once'), /^retract names one issue/);
  assert.match(refuses(b, 'retract', '1,4', '1', '--by', 'jarl', 'two issues at once'), /^retract names one issue/);
  assert.equal(logText(b), before, 'nothing was written');
});

test('a tool call that names a retraction through evidence or review is refused, and jarl_retract takes it back', () => {
  const root = loop();
  const id = worked(root);
  const said = (r) => r.content.map((c) => c.text).join('\n');
  assert.throws(() => mcp.callTool('jarl_evidence', { ids: id, retract: '1', by: 'jarl', text: 'the row was wrong', root }), /"retract" is not a field of this tool — a row or a note is taken back with jarl_retract, and by names who takes it back: jarl_retract \{"id":"<id>","entry":"<n-or-note-n>","by":"<who>","text":"<why>"\}$/);
  const review = mcp.callTool('jarl_review', { ids: id, verdict: 'retract', by: 'jarl', text: 'the verdict was wrong', root });
  assert.ok(review.isError);
  assert.match(said(review), /a verdict is taken back with retract, not with review retract\njarl\.mjs retract '<id>' review '<why>' --by '<who>' '--root=[^']+'$/);
  const verb = mcp.callTool('jarl_retract', { id, entry: 'review', by: 'jarl', text: 'a second try at the verdict', root });
  assert.ok(!verb.isError, said(verb));
});

test('field writes Resources and the fields a profile declares; set takes statuses', () => {
  const root = fieldedLoop();
  assert.equal(jarl(root, 'field', '1,2', 'resources', 'gate, db'), '1 Resources: gate, db\n2 Resources: gate, db');
  assert.equal(jarl(root, 'field', '1', 'note', 'see the thread'), '1 Note: see the thread');
  assert.equal(field(root, '1', 'resources'), 'gate, db');
  assert.equal(field(root, '1', 'note'), 'see the thread');
  assert.match(refuses(root, 'field', '1', 'Area', 'web'), /Area must be one of: core, cli/);
  assert.match(refuses(root, 'field', '1', 'Bogus', 'x'), /Bogus is not a part of the description, which field writes: Title, Priority, Tier, Kind, Found by, Tags, Files, Repo, After, Source, Where, Resources, Person, Check when, Area, Note, What, Why, Acceptance, Changelog;/);
  assert.match(refuses(root, 'field', '1', 'open', 'x'), /open is not a part of the description/);
  assert.match(refuses(root, 'field', '1', 'Note', 'x', '--worker', 'w'), /unknown flag --worker for field/);
  assert.equal(refuses(root, 'set', '1', 'Note', 'x', '--worker', 'w').trim(), "Note is a field, not a status: field writes it\njarl.mjs field '<ids>' Note '<value>'");
  assert.match(refuses(root, 'set', '1', 'Files', 'x'), /^status must be one of: open, in-progress, done, dropped, deferred \(got "Files"\)\njarl\.mjs set '<ids>' '<status>' '<why>'\n$/);
  assert.match(refuses(root, 'set', '1', 'bogus', 'x'), /status must be one of: /);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /· 1 field Resources · gate, db · was \(none\)\n.*· 2 field Resources · gate, db · was \(none\)\n/);
});

test('set given a field is refused with the field call that writes it, on the command line and through the tool, and writes nothing', () => {
  const a = fieldedLoop();
  const before = logText(a);
  assert.equal(refuses(a, 'set', '1,2', 'resources', 'gate').trim(), "resources is a field, not a status: field writes it\njarl.mjs field '<ids>' resources '<resource-name>'");
  assert.equal(refuses(a, 'set', '1', 'Note', 'a note').trim(), "Note is a field, not a status: field writes it\njarl.mjs field '<ids>' Note '<value>'");
  for (const blank of ['', ' ']) assert.equal(refuses(a, 'set', '2', 'Note', blank).trim(), "Note is a field, not a status: field writes it\njarl.mjs field '<ids>' Note --clear");
  const said = mcp.callTool('jarl_set', { ids: '3', status: 'resources', text: 'gate', root: a });
  assert.ok(said.isError);
  assert.match(said.content[0].text, /^resources is a field, not a status: field writes it\njarl\.mjs field '<ids>' resources '<resource-name>' '--root=[^']+'$/);
  assert.equal(logText(a), before);
  assert.equal(field(a, '3', 'resources') || '', '');
  const toolField = mcp.callTool('jarl_field', { ids: '3', name: 'Note', value: 'through field', root: a });
  assert.ok(!toolField.isError, toolField.content[0].text);
  assert.equal(toolField.content.length, 1);
  assert.equal(field(a, '3', 'note'), 'through field');
  const cleared = mcp.callTool('jarl_field', { ids: '3', name: 'Note', clear: true, root: a });
  assert.ok(!cleared.isError, cleared.content[0].text);
  assert.equal(field(a, '3', 'note') || '', '');
  assert.ok(mcp.callTool('jarl_field', { ids: '3', name: 'Note', value: ' ', root: a }).isError);
});

test('one idiom empties every field: --clear on After, Repo, Resources and a profile field', () => {
  const root = fieldedLoop();
  const dir = gitRepo().dir;
  jarl(root, 'field', '1', 'resources', 'gate');
  jarl(root, 'field', '1', 'Note', 'to go');
  jarl(root, 'field', '1', 'After', '2');
  jarl(root, 'field', '1', 'Repo', dir);
  assert.ok(field(root, '1', 'repo'));
  assert.equal(jarl(root, 'field', '1', 'resources', '--clear'), '1 Resources: (cleared)');
  assert.equal(jarl(root, 'field', '1', 'Note', '--clear'), '1 Note: (cleared)');
  assert.equal(jarl(root, 'field', '1', 'After', '--clear'), '1 After: (cleared)');
  assert.equal(jarl(root, 'field', '1', 'Repo', '--clear'), '1 Repo: (cleared)');
  const text = issueText(root, '1');
  assert.doesNotMatch(text, /\*\*After:\*\*/);
  assert.doesNotMatch(text, /\*\*Repo:\*\*/);
  assert.doesNotMatch(text, /\*\*Resources:\*\*.*\S/);
  assert.match(text, /\*\*Note:\*\*\s*\n/);
  assert.match(refuses(root, 'field', '1', 'Area', '--clear'), /Area cannot be emptied with --clear/);
  // The optional header fields of the tool's own are emptied the same way, on a list too.
  jarl(root, 'field', '1-2', 'Files', 'a.txt');
  jarl(root, 'field', '1-2', 'Source', 'core/research/2026-10-01-report#r-1');
  jarl(root, 'field', '1-2', 'Where', 'somewhere');
  jarl(root, 'field', '1-2', 'Tags', '--add', 'x');
  jarl(root, 'field', '1-2', 'After', '3');
  jarl(root, 'field', '1-2', 'Repo', dir);
  for (const name of ['Files', 'Source', 'Where', 'Tags', 'After', 'Repo']) {
    const said = jarl(root, 'field', '1-2', name, '--clear');
    assert.match(said, new RegExp(`${name}: \\(cleared\\)`), name);
    for (const id of ['1', '2']) assert.ok(!field(root, id, name.toLowerCase()), `${name} of ${id}`);
  }
  // field writes them as their own commands do, and empties them the same way.
  assert.equal(jarl(root, 'field', '1', 'Files', 'a.txt'), '1 Files: a.txt');
  assert.equal(field(root, '1', 'files'), 'a.txt');
  assert.match(refuses(root, 'field', '1', 'Note', ''), /field Note needs a value, or --clear to empty it\njarl\.mjs field '<ids>' Note '<value>'$/m);
  assert.match(refuses(root, 'field', '1', 'Note', 'x', '--clear'), /either a value or --clear, not both/);
});

test('field and round take a comma list with a range: every id changes, or none', () => {
  const root = loop();
  issues(root, 4);
  const dir = gitRepo().dir;
  assert.equal(jarl(root, 'field', '1-2,4', 'Files', 'a.txt,b.txt'), '1 Files: a.txt, b.txt\n2 Files: a.txt, b.txt\n4 Files: a.txt, b.txt');
  assert.deepEqual(['1', '2', '3', '4'].map((id) => field(root, id, 'files')), ['a.txt, b.txt', 'a.txt, b.txt', '', 'a.txt, b.txt']);
  const filed = ['1', '2', '3', '4'].map((id) => issueText(root, id));
  assert.match(refuses(root, 'field', '1-2,9', 'Files', 'z.txt'), /no such issue: 9 \(asked for as 1-2,9\) — nothing was written/);
  assert.deepEqual(['1', '2', '3', '4'].map((id) => issueText(root, id)), filed);

  assert.equal(jarl(root, 'field', '1-3', 'After', '4'), '1 After: 4\n2 After: 4\n3 After: 4');
  const afterLog = logText(root);
  assert.match(refuses(root, 'field', '1,3-4', 'After', '2'), /no such|cannot wait|cycle/);
  assert.equal(logText(root), afterLog);
  assert.match(refuses(root, 'field', '1-2,4', 'After', '4'), /4 cannot wait on itself — nothing was written\njarl\.mjs field '<ids>' After '<another-id>'$/m);
  assert.equal(field(root, '1', 'after'), '4');
  assert.equal(jarl(root, 'field', '1-3', 'After', '--clear'), '1 After: (cleared)\n2 After: (cleared)\n3 After: (cleared)');
  jarl(root, 'field', '2', 'After', '4');
  assert.match(refuses(root, 'field', '1-2', 'After', '--clear'), /1 has no After field to clear — nothing was written/);
  assert.equal(field(root, '2', 'after'), '4');
  jarl(root, 'field', '2', 'After', '--clear');

  assert.equal(jarl(root, 'field', '1-2,4', 'Repo', dir).split('\n').length, 3);
  const repoOf = (id) => field(root, id, 'repo');
  assert.ok(repoOf('1') && repoOf('1') === repoOf('2') && repoOf('2') === repoOf('4'));
  assert.ok(!repoOf('3'));
  assert.match(refuses(root, 'field', '1-3', 'Repo', '--clear'), /3 has no Repo field to clear — nothing was written/);
  assert.ok(repoOf('1') && repoOf('2'));
  assert.match(refuses(root, 'field', '1-2,9', 'Repo', dir), /no such issue: 9 \(asked for as 1-2,9\) — nothing was written/);
  assert.equal(jarl(root, 'field', '1-2,4', 'Repo', '--clear').split('\n').length, 3);

  assert.equal(jarl(root, 'field', '1-2,4', 'What', 'the same text'), '1 What: the same text\n2 What: the same text\n4 What: the same text');
  assert.match(issueText(root, '4'), /## What\n\s*the same text/);
  assert.doesNotMatch(issueText(root, '3'), /the same text/);
  const bodied = ['1', '2', '3', '4'].map((id) => issueText(root, id));
  assert.match(refuses(root, 'field', '1-2,9', 'Why', 'a reason'), /no such issue: 9 \(asked for as 1-2,9\) — nothing was written/);
  assert.deepEqual(['1', '2', '3', '4'].map((id) => issueText(root, id)), bodied);

  const ref = 'core/research/2026-10-01-report#r-1';
  assert.equal(jarl(root, 'field', '1-2,4', 'Source', ref), `1 Source: ${ref}\n2 Source: ${ref}\n4 Source: ${ref}`);
  assert.deepEqual(['1', '2', '3', '4'].map((id) => field(root, id, 'source')), [ref, ref, undefined, ref]);
  assert.match(refuses(root, 'field', '1-2,9', 'Source', 'core/research/2026-10-02-report#r-2'), /no such issue: 9 \(asked for as 1-2,9\) — nothing was written/);
  assert.match(refuses(root, 'field', '1-2', 'Source', 'not a source'), /a source is <report-dir#finding-id>/);
  assert.equal(field(root, '1', 'source'), ref);

  assert.equal(jarl(root, 'round', '1-2,4', 'the check failed').split('\n').length, 3);
  assert.match(jarl(root, 'round', '1-2', 'failed again'), /^1 round 2: 2 of 3 before a takeover[^\n]*\n2 round 2: 2 of 3/);
  const rounds = logText(root);
  assert.match(refuses(root, 'round', '1-2,9', 'once more'), /no such issue: 9 \(asked for as 1-2,9\) — nothing was written/);
  assert.equal(logText(root), rounds);
});

test('one id answers as an object and a list as an array, so a caller that sends one id sees what it always saw', () => {
  const root = loop();
  issues(root, 2);
  assert.deepEqual(JSON.parse(jarl(root, 'field', '1', 'Files', 'a.txt', '--json')), { id: '1', field: 'Files', value: 'a.txt' });
  assert.deepEqual(JSON.parse(jarl(root, 'field', '1-2', 'Files', 'a.txt', '--json')), [{ id: '1', field: 'Files', value: 'a.txt' }, { id: '2', field: 'Files', value: 'a.txt' }]);
});

test('the tools keep the field named id on every command that takes a list', () => {
  const tools = Object.fromEntries(mcp.buildTools().map((t) => [t.name, t]));
  for (const [cmd, field] of [['round', 'id'], ['field', 'ids']]) {
    const props = tools[`jarl_${cmd}`].inputSchema.properties;
    assert.ok(props[field], `${cmd}: the ${field} field`);
    assert.match(props[field].description, /comma list with ranges/);
  }
  assert.equal(tools.jarl_evidence.inputSchema.properties.retract, undefined, 'evidence takes nothing back');
  for (const cmd of ['retract', 'field']) assert.ok(tools[`jarl_${cmd}`], `${cmd} has its tool`);
});
