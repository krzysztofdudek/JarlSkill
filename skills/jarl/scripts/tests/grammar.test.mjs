// One grammar for the commands: --help exits 0, one retract verb for a verdict and an evidence row, set for statuses and
// field for fields, one way to empty a field, and the list grammar on every command that takes an id. The spellings
// another form of the same operation takes keep working, and say on stderr (the command line only) which form to use.
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
const logText = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8').replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, '<t>');
const scrubbed = (text) => text.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, '<t>');
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
  assert.match(r.stdout, /^usage: jarl\.mjs <command>/);
  assert.equal(r.stderr, '');
  const withCommand = spawnJarl(process.cwd(), ['list', '--help']);
  assert.equal(withCommand.status, 0);
  assert.match(withCommand.stdout, /^usage: jarl\.mjs/);
});

test('retract takes back a verdict and an evidence row with the same results as the spellings that name them in review and evidence', () => {
  const a = loop();
  const b = loop();
  const ida = worked(a);
  const idb = worked(b);
  assert.equal(ida, idb);
  const reason = 'the row and the verdict were read in the wrong place';
  const viaVerbs = [run(b, ['retract', '1', '1', '--by', 'jarl', reason]), run(b, ['retract', '1', 'review', '--by', 'jarl', reason])];
  const viaForms = [run(a, ['evidence', '1', '--retract', '1', '--by', 'jarl', reason]), run(a, ['review', '1', 'retract', '--by', 'jarl', reason])];
  for (const [i, r] of viaVerbs.entries()) {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '', 'the verb says nothing on stderr');
    assert.equal(r.stdout, viaForms[i].stdout, 'the same reply');
    assert.equal(viaForms[i].status, 0);
  }
  assert.match(viaForms[0].stderr, /retract <id> 1 --by <who> "<reason>"/);
  assert.match(viaForms[1].stderr, /retract <id> review --by <who> "<reason>"/);
  assert.equal(scrubbed(issueText(a, ida)), scrubbed(issueText(b, idb)), 'the same file');
  assert.equal(logText(a), logText(b), 'the same log');
  assert.match(issueText(b, idb), /~~\*\*ran:\*\*/);
  assert.match(issueText(b, idb), /~~\*\*approve\*\*/);
});

test('retract refuses what the two spellings refuse, in the same words', () => {
  const a = loop();
  const b = loop();
  worked(a);
  worked(b);
  const pairs = [
    [['retract', '1', '3', '--by', 'jarl', 'no such row here'], ['evidence', '1', '--retract', '3', '--by', 'jarl', 'no such row here']],
    [['retract', '1', '1', 'because the row is wrong'], ['evidence', '1', '--retract', '1', 'because the row is wrong']],
    [['retract', '1', 'review', '--by', 'jarl', 'x'], ['review', '1', 'retract', '--by', 'jarl', 'x']],
    [['retract', '1,2', 'review', '--by', 'jarl', 'because I said so'], ['review', '1,2', 'retract', '--by', 'jarl', 'because I said so']],
  ];
  for (const [verb, form] of pairs) assert.equal(refuses(b, ...verb).replace(/\s+$/, ''), refuses(a, ...form).replace(/\s+$/, ''), verb.join(' '));
  assert.match(refuses(b, 'retract', '1', 'approve', '--by', 'jarl', 'what is this word'), /retract takes review .* or the number of an evidence row/);
  assert.equal(logText(a), logText(b), 'nothing was written');
});

test('a tool call that retracts through evidence or review answers without the line that names the verb', () => {
  const root = loop();
  const id = worked(root);
  const said = (r) => r.content.map((c) => c.text).join('\n');
  const evidence = mcp.callTool('jarl_evidence', { ids: id, retract: '1', by: 'jarl', text: 'the row was wrong', root });
  assert.ok(!evidence.isError, said(evidence));
  assert.doesNotMatch(said(evidence), /note:/);
  assert.equal(said(evidence).trim(), '001 evidence row 1 retracted by jarl');
  const review = mcp.callTool('jarl_review', { ids: id, verdict: 'retract', by: 'jarl', findings: 'the verdict was wrong', root });
  assert.ok(!review.isError, said(review));
  assert.doesNotMatch(said(review), /note:/);
  const verb = mcp.callTool('jarl_retract', { id, what: 'review', by: 'jarl', reason: 'a second try at the verdict', root });
  assert.ok(verb.isError, 'no approve is left to retract');
  assert.match(said(verb), /no approve to retract/);
});

test('field writes Resources and the fields a profile declares; set takes statuses', () => {
  const root = fieldedLoop();
  assert.equal(jarl(root, 'field', '1,2', 'resources', 'gate, db'), '1 Resources: gate, db\n2 Resources: gate, db');
  assert.equal(jarl(root, 'field', '1', 'note', 'see the thread'), '1 Note: see the thread');
  assert.equal(field(root, '1', 'resources'), 'gate, db');
  assert.equal(field(root, '1', 'note'), 'see the thread');
  assert.match(refuses(root, 'field', '1', 'Area', 'web'), /Area must be one of: core, cli/);
  assert.match(refuses(root, 'field', '1', 'Files', 'x'), /Files is not a field: Resources, or one this loop's profile declares \(Area, Note\)/);
  assert.match(refuses(root, 'field', '1', 'open', 'x'), /open is not a field/);
  assert.match(refuses(root, 'field', '1', 'Note', 'x', '--worker', 'w'), /unknown flag --worker for field/);
  assert.match(refuses(root, 'set', '1', 'Note', 'x', '--worker', 'w'), /--worker goes with a status, not with the field Note/);
  assert.match(refuses(root, 'set', '1', 'Files', 'x'), /^status must be one of: open, in-progress, done, dropped, deferred\n$/);
  assert.match(refuses(root, 'set', '1', 'bogus', 'x'), /status must be one of: /);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /· 1 field Resources · gate, db\n.*· 2 field Resources · gate, db\n/);
});

test('set <ids> resources and set <ids> <profile field> write the field and say which verb to use', () => {
  const a = fieldedLoop();
  const b = fieldedLoop();
  const viaSet = [run(a, ['set', '1,2', 'resources', 'gate']), run(a, ['set', '1', 'Note', 'a note']), run(a, ['set', '2', 'Note', ''])];
  const viaField = [run(b, ['field', '1,2', 'resources', 'gate']), run(b, ['field', '1', 'Note', 'a note']), run(b, ['field', '2', 'Note', '--clear'])];
  for (const [i, r] of viaSet.entries()) {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, viaField[i].stdout);
    assert.equal(viaField[i].stderr, '');
  }
  assert.match(viaSet[0].stderr, /resources is a field, not a status — write it with: field <ids> resources "<value>"/);
  assert.match(viaSet[2].stderr, /field <ids> Note --clear/);
  for (const id of ['1', '2']) assert.equal(scrubbed(issueText(a, id)), scrubbed(issueText(b, id)));
  assert.equal(logText(a), logText(b));
  const said = mcp.callTool('jarl_set', { ids: '3', status: 'resources', why: 'gate', root: a });
  assert.ok(!said.isError, said.content[0].text);
  assert.equal(said.content.length, 1, 'the tool reply carries no note');
  assert.equal(field(a, '3', 'resources'), 'gate');
});

test('one idiom empties every field: --clear on After, Repo, Resources and a profile field', () => {
  const root = fieldedLoop();
  const dir = gitRepo().dir;
  jarl(root, 'field', '1', 'resources', 'gate');
  jarl(root, 'field', '1', 'Note', 'to go');
  jarl(root, 'after', '1', '2');
  jarl(root, 'repo', '1', dir);
  assert.ok(field(root, '1', 'repo'));
  assert.equal(jarl(root, 'field', '1', 'resources', '--clear'), '1 Resources: (cleared)');
  assert.equal(jarl(root, 'field', '1', 'Note', '--clear'), '1 Note: (cleared)');
  assert.equal(jarl(root, 'after', '1', '--clear'), '1 after: cleared');
  assert.equal(jarl(root, 'repo', '1', '--clear'), '1 repo: cleared');
  const text = issueText(root, '1');
  assert.doesNotMatch(text, /\*\*After:\*\*/);
  assert.doesNotMatch(text, /\*\*Repo:\*\*/);
  assert.doesNotMatch(text, /\*\*Resources:\*\*.*\S/);
  assert.match(text, /\*\*Note:\*\*\s*\n/);
  assert.match(refuses(root, 'field', '1', 'Area', '--clear'), /Area cannot be empty/);
  assert.match(refuses(root, 'field', '1', 'Note', ''), /the value is required, or --clear to empty it/);
  assert.match(refuses(root, 'field', '1', 'Note', 'x', '--clear'), /either a value or --clear, not both/);
});

test('files, repo, after, body, round and source take a comma list with a range: every id changes, or none', () => {
  const root = loop();
  issues(root, 4);
  const dir = gitRepo().dir;
  assert.equal(jarl(root, 'files', '1-2,4', 'a.txt,b.txt'), '1 files: a.txt, b.txt\n2 files: a.txt, b.txt\n4 files: a.txt, b.txt');
  assert.deepEqual(['1', '2', '3', '4'].map((id) => field(root, id, 'files')), ['a.txt, b.txt', 'a.txt, b.txt', '', 'a.txt, b.txt']);
  const filed = ['1', '2', '3', '4'].map((id) => issueText(root, id));
  assert.match(refuses(root, 'files', '1-2,9', 'z.txt'), /no such issue: 9 — nothing was written/);
  assert.deepEqual(['1', '2', '3', '4'].map((id) => issueText(root, id)), filed);

  assert.equal(jarl(root, 'after', '1-3', '4'), '1 after: 4\n2 after: 4\n3 after: 4');
  const afterLog = logText(root);
  assert.match(refuses(root, 'after', '1,3-4', '2'), /no such|cannot wait|cycle/);
  assert.equal(logText(root), afterLog);
  assert.match(refuses(root, 'after', '1-2,4', '4'), /4 cannot wait on itself — nothing was written/);
  assert.equal(field(root, '1', 'after'), '4');
  assert.equal(jarl(root, 'after', '1-3', '--clear'), '1 after: cleared\n2 after: cleared\n3 after: cleared');
  jarl(root, 'after', '2', '4');
  assert.match(refuses(root, 'after', '1-2', '--clear'), /1 has no After field to clear — nothing was written/);
  assert.equal(field(root, '2', 'after'), '4');
  jarl(root, 'after', '2', '--clear');

  assert.equal(jarl(root, 'repo', '1-2,4', dir).split('\n').length, 3);
  const repoOf = (id) => field(root, id, 'repo');
  assert.ok(repoOf('1') && repoOf('1') === repoOf('2') && repoOf('2') === repoOf('4'));
  assert.ok(!repoOf('3'));
  assert.match(refuses(root, 'repo', '1-3', '--clear'), /3 has no Repo field to clear — nothing was written/);
  assert.ok(repoOf('1') && repoOf('2'));
  assert.match(refuses(root, 'repo', '1-2,9', dir), /no such issue: 9 — nothing was written/);
  assert.equal(jarl(root, 'repo', '1-2,4', '--clear').split('\n').length, 3);

  assert.equal(jarl(root, 'body', '1-2,4', '--what', 'the same text'), '1 body: what\n2 body: what\n4 body: what');
  assert.match(issueText(root, '4'), /## What\n\s*the same text/);
  assert.doesNotMatch(issueText(root, '3'), /the same text/);
  const bodied = ['1', '2', '3', '4'].map((id) => issueText(root, id));
  assert.match(refuses(root, 'body', '1-2,9', '--why', 'a reason'), /no such issue: 9 — nothing was written/);
  assert.deepEqual(['1', '2', '3', '4'].map((id) => issueText(root, id)), bodied);

  const ref = 'core/research/2026-10-01-report#r-1';
  assert.equal(jarl(root, 'source', '1-2,4', ref), `1 source: ${ref}\n2 source: ${ref}\n4 source: ${ref}`);
  assert.deepEqual(['1', '2', '3', '4'].map((id) => field(root, id, 'source')), [ref, ref, undefined, ref]);
  assert.match(refuses(root, 'source', '1-2,9', 'core/research/2026-10-02-report#r-2'), /no such issue: 9 — nothing was written/);
  assert.match(refuses(root, 'source', '1-2', 'not a source'), /a source is <report dir>#<finding id>/);
  assert.equal(field(root, '1', 'source'), ref);

  assert.equal(jarl(root, 'round', '1-2,4', 'the check failed').split('\n').length, 3);
  assert.match(jarl(root, 'round', '1-2', 'failed again'), /^1 round 2 of 3 before a takeover\n2 round 2 of 3/);
  const rounds = logText(root);
  assert.match(refuses(root, 'round', '1-2,9', 'once more'), /no such issue: 9 — nothing was written/);
  assert.equal(logText(root), rounds);
});

test('one id answers as an object and a list as an array, so a caller that sends one id sees what it always saw', () => {
  const root = loop();
  issues(root, 2);
  assert.deepEqual(JSON.parse(jarl(root, 'files', '1', 'a.txt', '--json')), { id: '1', files: ['a.txt'] });
  assert.deepEqual(JSON.parse(jarl(root, 'files', '1-2', 'a.txt', '--json')), [{ id: '1', files: ['a.txt'] }, { id: '2', files: ['a.txt'] }]);
});

test('the tools keep the field named id on every command that now takes a list', () => {
  const tools = Object.fromEntries(mcp.buildTools().map((t) => [t.name, t]));
  for (const cmd of ['body', 'source', 'after', 'files', 'repo', 'round']) {
    const props = tools[`jarl_${cmd}`].inputSchema.properties;
    assert.ok(props.id, `${cmd}: the id field`);
    assert.match(props.id.description, /comma list with ranges/);
  }
  assert.ok(tools.jarl_evidence.inputSchema.properties.retract, 'the retract field of evidence');
  for (const cmd of ['retract', 'field']) assert.ok(tools[`jarl_${cmd}`], `${cmd} has its tool`);
});
