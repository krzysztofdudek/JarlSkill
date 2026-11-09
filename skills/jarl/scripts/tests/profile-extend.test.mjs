// extend adds one section or one field to the profile of a live loop: the result is checked as profile <file> checks a
// profile file, a log line says what was added, and verify is clean after it. A loop with no profile of its own gets one,
// with the built-in statuses. The issues already filed are not rewritten: each carries the part once field writes it, and
// a new issue is filed with it, a field's default where none is given. The profile of a loop a composer runs is never
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileThreeDigits, filePlain } from './helpers.mjs';
import { jarl, jarlResult, refuses, run, loop as makeLoop } from './helpers.mjs';
import { BUILTIN_STATUSES, cmdExtend, withWriter } from '../jarl-lib.mjs';
import * as R from '../record.mjs';

const profileFile = (root) => join(root, '.jarl', 'profile.json');
const profileJson = (root) => JSON.parse(readFileSync(profileFile(root), 'utf8'));
const logText = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const issueText = (root, id) => readFileSync(R.findIssue(root, id).file, 'utf8');
const lastLine = (text) => text.trim().split('\n').pop();
const snapshot = (root) => [existsSync(profileFile(root)) ? readFileSync(profileFile(root), 'utf8') : null, logText(root)];

test('extend section adds a section to a loop with no profile: the loop gets one with the built-in statuses, a log line, and verify is clean', () => {
  const root = makeLoop({ prefix: 'jarl-extend-', via: 'cli' });
  jarl(root, 'new', 'filed before', '--acceptance', '[read] it holds');
  const before = issueText(root, '1');
  const r = jarlResult(root, ['extend', 'section', 'Risks', '--by', 'jarl']);
  assert.equal(r.stdout, 'profile extended: section Risks');
  assert.equal(r.stderr, 'note: the issues already filed carry the section once field writes it: jarl.mjs field "<ids>" Risks "<text>"');
  const json = profileJson(root);
  assert.deepEqual(json.statuses, BUILTIN_STATUSES);
  assert.deepEqual(json.sections, ['Risks']);
  assert.match(logText(root), /^- \S+ \S+ by jarl · profile extended · section Risks$/m);
  assert.equal(issueText(root, '1'), before, 'an issue already filed is not rewritten');
  assert.equal(run(root, ['verify']).status, 0, run(root, ['verify']).stdout);
  jarl(root, 'field', '1', 'Risks', 'none known');
  assert.match(issueText(root, '1'), /^## Risks\nnone known\n/m);
  jarl(root, 'new', 'filed after', '--acceptance', '[read] it works', '--section', 'Risks=a slow disk');
  assert.match(issueText(root, '2'), /^## Risks\na slow disk\n/m);
  assert.deepEqual(JSON.parse(jarl(root, 'profile', '--json')).sections, ['Risks']);
  assert.equal(run(root, ['verify']).status, 0);
});

test('extend field adds a field with its values and default: a new issue takes the default, an issue already filed has none until field writes it', () => {
  const root = makeLoop({ prefix: 'jarl-extend-field-', via: 'cli' });
  jarl(root, 'new', 'filed before', '--acceptance', '[read] it works');
  const before = issueText(root, '1');
  assert.equal(jarl(root, 'extend', 'field', 'Area', '--values', 'ui,api', '--default', 'ui', '--by', 'jarl'), 'profile extended: field Area (one of ui, api, default ui)');
  assert.deepEqual(profileJson(root).fields, { Area: { enum: ['ui', 'api'], default: 'ui' } });
  assert.match(logText(root), /by jarl · profile extended · field Area: values ui, api; default ui$/m);
  assert.equal(issueText(root, '1'), before);
  jarl(root, 'new', 'filed after', '--acceptance', '[read] it works');
  assert.match(issueText(root, '2'), /^\*\*Area:\*\* ui$/m);
  jarl(root, 'field', '1', 'Area', 'api');
  assert.match(issueText(root, '1'), /^\*\*Area:\*\* api$/m);
  assert.match(refuses(root, 'field', '1', 'Area', 'db'), /Area must be one of: ui, api/);
  assert.equal(jarl(root, 'extend', 'field', 'Owner team', '--required'), 'profile extended: field Owner team (required)');
  assert.match(refuses(root, 'new', 'needs the team'), /Owner team is required by this loop's profile/);
  assert.equal(run(root, ['verify']).status, 0, 'a required field the issues filed before it lack leaves verify clean');
});

test('extend refuses a part that is not a section or a field, a name the profile holds or Jarl reserves, and a field that does not check, with a form, writing nothing', () => {
  const root = makeLoop({ prefix: 'jarl-extend-refused-', via: 'cli' });
  jarl(root, 'new', 'one', '--acceptance', '[read] it works');
  jarl(root, 'extend', 'section', 'Risks');
  const held = snapshot(root);
  let said = refuses(root, 'extend', 'status', 'review');
  assert.match(said, /extend adds a section or a field to the loop's profile \(got "status"\)/);
  assert.equal(lastLine(said), 'jarl.mjs extend "<section-or-field>" "<name>" --by "<who>"');
  said = refuses(root, 'extend', 'section', 'risks');
  assert.match(said, /the profile already declares the section risks/);
  assert.equal(lastLine(said), 'jarl.mjs extend "<section-or-field>" "<name>" --by "<who>"');
  assert.match(refuses(root, 'extend', 'section', 'Why'), /the profile already declares the section Why/);
  assert.match(refuses(root, 'extend', 'section', 'Notes'), /the section Notes is not added: it declares the section Notes, which is the name of a header field or of a part Jarl writes itself/);
  assert.match(refuses(root, 'extend', 'field', 'Key'), /the field Key is not added: it declares the field Key, which Jarl reserves for an issue's key/);
  assert.match(refuses(root, 'extend', 'field', 'Parent'), /Jarl reserves for the parent of a sub-issue/);
  assert.match(refuses(root, 'extend', 'field', 'Kind', '--values', 'a,b'), /Kind is built in, and its values are the ones the loop was opened with/);
  assert.match(refuses(root, 'extend', 'field', 'Branch'), /field "Branch" is one the tool writes itself/);
  said = refuses(root, 'extend', 'field', 'Area', '--values', 'ui,api', '--default', 'db');
  assert.match(said, /field "Area": "default" "db" is not one of its enum values/);
  assert.equal(lastLine(said), 'jarl.mjs extend "<section-or-field>" "<name>" --by "<who>" --values "<items>" --default "<value>"');
  said = refuses(root, 'extend', 'section', 'Plan', '--default', 'x');
  assert.match(said, /--default goes with a field, not with a section/);
  assert.deepEqual(snapshot(root), held, 'nothing was written');
});

test('a field takes no name of a part Jarl writes itself, and a field and a section never share a name: extend and profile <file> refuse both, naming the reserved names', () => {
  const root = makeLoop({ prefix: 'jarl-extend-names-', via: 'cli' });
  jarl(root, 'extend', 'section', 'Risks');
  jarl(root, 'extend', 'field', 'Area');
  const held = snapshot(root);
  for (const name of ['Title', 'model', 'Notes']) {
    const said = refuses(root, 'extend', 'field', name);
    assert.match(said, new RegExp(`^the field ${name} is not added: it declares the field ${name}, which is the name of a part Jarl writes itself — the names a field may not take are Status, .*, Title, Model, What, .*, Proof, Key, Parent, Person, Check when; rename it in the profile`));
    assert.equal(lastLine(said), 'jarl.mjs extend "<section-or-field>" "<name>" --by "<who>"');
  }
  assert.match(refuses(root, 'extend', 'field', 'risks'), /^the profile already declares Risks as a section, and a field and a section never share a name/);
  assert.match(refuses(root, 'extend', 'section', 'AREA'), /^the profile already declares Area as a field, and a field and a section never share a name/);
  assert.deepEqual(snapshot(root), held, 'nothing was written');
  const dir = mkdtempSync(join(tmpdir(), 'jarl-extend-names-file-'));
  const file = (name, json) => { const path = join(dir, name); writeFileSync(path, JSON.stringify({ 'jarl-profile': 1, name: 'own', statuses: BUILTIN_STATUSES, ...json })); return path; };
  let r = run(root, ['profile', file('title.json', { fields: { Title: {} } })]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /is not a valid profile: it declares the field Title, which is the name of a part Jarl writes itself — the names a field may not take are /);
  r = run(root, ['profile', file('both.json', { fields: { Plan: {} }, sections: ['plan'] })]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /is not a valid profile: it declares Plan as a field and as a section, so the field command could not tell which one it writes/);
  assert.equal(run(root, ['profile', file('fine.json', { fields: { Plan: {} }, sections: ['Steps'] })]).status, 0);
});

test('extend refuses the profile of a loop a composer runs, naming the composer\'s command, and writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-extend-composed-'));
  mkdirSync(join(dir, '.git'));
  const file = join(mkdtempSync(join(tmpdir(), 'jarl-extend-profile-')), 'profile.json');
  writeFileSync(file, JSON.stringify({ 'jarl-profile': 1, name: 'composed', statuses: BUILTIN_STATUSES, lifecycle: { close: 'record', command: 'composer tick' } }));
  jarl(dir, 'init', 'a composed goal', '--profile', file);
  const held = snapshot(dir);
  const said = refuses(dir, 'extend', 'section', 'Risks');
  assert.match(said, /this loop is run by a tool of its own \(its profile, composed, keeps its lifecycle to the record\), and its profile is that tool's: extend changes nothing in it — nothing was written/);
  assert.equal(lastLine(said), 'composer tick');
  assert.deepEqual(snapshot(dir), held);
});

// A loop in record format 1 with no profile, in format 2, in format 3, and in format 1 with a profile of its own.
const FORMATS = [
  ['format 1 with no profile', () => { const root = makeLoop({ prefix: 'jarl-extend-f1-' }); fileThreeDigits(root, 'filed by the first reader'); return root; }, undefined],
  ['format 2', () => { const root = makeLoop({ prefix: 'jarl-extend-f2-' }); filePlain(root, 'filed by the reader of formats 1 and 2'); return root; }, 2],
  ['format 3', () => { const root = makeLoop({ prefix: 'jarl-extend-f3-', via: 'cli' }); jarl(root, 'new', 'filed with a key', '--acceptance', '[read] it works'); return root; }, 3],
  ['format 1 with a profile of its own', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'jarl-extend-own-')), 'profile.json');
    writeFileSync(file, JSON.stringify({ 'jarl-profile': 1, name: 'own', statuses: BUILTIN_STATUSES, sections: ['Plan'] }));
    const root = makeLoop({ prefix: 'jarl-extend-own-', via: 'cli', initFlags: ['--profile', file] });
    fileThreeDigits(root, 'filed by the first reader');
    return root;
  }, undefined],
];
for (const [name, make, format] of FORMATS) {
}

test('a profile that cannot be written leaves no log line, with --by and without', () => {
  const root = makeLoop({ prefix: 'jarl-extend-failed-', via: 'cli' });
  jarl(root, 'new', 'one', '--acceptance', '[read] it works');
  const held = snapshot(root);
  // The temporary file the profile is written through is taken by a directory, so the write fails.
  mkdirSync(join(root, '.jarl', `.profile.json.${process.pid}.tmp`));
  assert.throws(() => cmdExtend(root, 'section', 'Risks', {}));
  assert.throws(() => withWriter('jarl', () => cmdExtend(root, 'section', 'Risks', { by: 'jarl' })));
  assert.deepEqual(snapshot(root), held, 'nothing was logged and the profile is as it was');
});
