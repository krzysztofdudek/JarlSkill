// The record contract: record.mjs is the one surface another tool may vendor, so its exports are held here exactly —
// every name, whether it is a value or a function, and each function's parameters as written (a parameter with a
// default is optional, marked ?). Adding, removing, renaming or re-shaping an export fails this test. The way through
// is a new contract version: bump RECORD_API in record.mjs (jarl-record/2), write its table below beside the old one,
// and freeze the new table's fingerprint in FROZEN. A published version's table is never edited in place — its
// fingerprint would no longer match. The same version goes on the family's contracts page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const R = await import('../record.mjs');

const CONTRACTS = {
  'jarl-record/1': {
    RECORD_API: 'value',
    // the loop: where it is, opening it, reading it
    resolveRoot: '(root, from)',
    jarlDir: '(root)',
    hasLiveLoop: '(root)',
    initLoop: '(root, goal, opts?)',
    loadIssues: '(root)',
    findIssue: '(root, id)',
    decisions: '(root, opts?)',
    loadAsks: '(root)',
    // an issue as text
    parseIssue: '(text, file)',
    renderIssue: '(spec)',
    mergedOf: '(issue)',
    evidenceRows: '(issue)',
    // the profile
    PROFILE_VERSION: 'value',
    STATUS_FLAGS: 'value',
    DEFAULT_PROFILE: 'value',
    validateProfile: '(json, where)',
    readProfileFile: '(file)',
    loadProfile: '(root)',
    describeProfile: '(profile)',
    // one writer at a time
    withLock: '(root, fn)',
    writeAtomic: '(path, text)',
    // operations on the record
    newIssue: '(root, title, opts?)',
    setStatus: '(root, ids, status, why, opts?)',
    setField: '(root, ids, field, value, opts?)',
    setBody: '(root, id, opts?)',
    setTags: '(root, ids, ops)',
    setPriority: '(root, ids, priority)',
    setFiles: '(root, id, files)',
    setRepo: '(root, id, path, opts?)',
    setAfter: '(root, id, ids, opts?)',
    setSource: '(root, id, refs)',
    addEvidence: '(root, ids, text, opts?)',
    review: '(root, ids, verdict, findings, opts?)',
    recordMerged: '(root, ids, opts?)',
    addRound: '(root, id, what)',
    decide: '(root, slug, ruling, opts?)',
    ask: '(root, question, opts?)',
    answer: '(root, id, text)',
    appendLog: '(root, event)',
    // the views' data
    statusData: '(root, opts?)',
    resumeData: '(root, opts?)',
  },
};

// Each published table's fingerprint, frozen when the version was published.
const FROZEN = {
  'jarl-record/1': '7635917fcee9a8c3cd25c5ed50c8d365523e7c10432542eed269e22a57a7a041',
};

// A function's parameters as written in its source: `opts = {}` reads as opts?.
function paramsOf(fn) {
  const src = fn.toString();
  const open = src.indexOf('(');
  let depth = 0;
  let close = open;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    if (src[i] === ')') { depth -= 1; if (depth === 0) { close = i; break; } }
  }
  const inner = src.slice(open + 1, close).trim();
  if (!inner) return '()';
  return `(${inner.split(',').map((p) => p.trim()).map((p) => (p.includes('=') ? `${p.split('=')[0].trim()}?` : p)).join(', ')})`;
}
// A module's signature: each export by name, 'value' or its parameters.
function signatureOf(mod) {
  return Object.fromEntries(Object.keys(mod).sort().map((k) => [k, typeof mod[k] === 'function' ? paramsOf(mod[k]) : 'value']));
}
const sorted = (t) => Object.fromEntries(Object.keys(t).sort().map((k) => [k, t[k]]));
const fingerprint = (t) => createHash('sha256').update(JSON.stringify(sorted(t))).digest('hex');

test('record.mjs declares its contract version, and its exports are exactly that version\'s table', () => {
  assert.equal(R.RECORD_API, 'jarl-record/1');
  assert.ok(CONTRACTS[R.RECORD_API], `no table for ${R.RECORD_API} — write one in this test`);
  assert.deepEqual(signatureOf(R), sorted(CONTRACTS[R.RECORD_API]), `record.mjs does not match ${R.RECORD_API}: a changed export needs a new contract version`);
});

test('a published contract table is frozen: its fingerprint never changes', () => {
  for (const [version, table] of Object.entries(CONTRACTS)) {
    assert.ok(FROZEN[version], `${version} has no frozen fingerprint`);
    assert.equal(fingerprint(table), FROZEN[version], `the table of ${version} was edited in place — publish a new version instead`);
  }
});

test('the contract check fails on an added, a removed or a re-shaped export', () => {
  const table = sorted(CONTRACTS['jarl-record/1']);
  const same = { ...R };
  assert.deepEqual(signatureOf(same), table);
  assert.notDeepEqual(signatureOf({ ...R, extra() {} }), table, 'an added export');
  const less = { ...R };
  delete less.setStatus;
  assert.notDeepEqual(signatureOf(less), table, 'a removed export');
  assert.notDeepEqual(signatureOf({ ...R, setStatus(root, ids, status) { return [root, ids, status]; } }), table, 'a changed signature');
  assert.equal(paramsOf(function f(a, b = 1, { c } = {}) { return [a, b, c]; }), '(a, b?, { c }?)');
});

test('record.mjs names every export by hand and stands only on jarl-lib.mjs, which stands only on Node built-ins', () => {
  const here = (f) => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8');
  const record = here('record.mjs');
  const lib = here('jarl-lib.mjs');
  assert.doesNotMatch(record, /^export \*/m, 'record.mjs enumerates its exports; no export *');
  const imports = (text) => [...text.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports(record).filter((s) => !s.startsWith('node:')), ['./jarl-lib.mjs']);
  assert.deepEqual(imports(lib).filter((s) => !s.startsWith('node:')), []);
});

test('the record through record.mjs: a loop opened, an issue carried to done and merged, rulings, a question, the views', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-record-'));
  try {
    assert.equal(R.resolveRoot('x', root), join(root, 'x'));
    assert.equal(R.hasLiveLoop(root), false);
    R.initLoop(root, 'the goal', { committed: true });
    assert.equal(R.hasLiveLoop(root), true);
    assert.equal(R.newIssue(root, 'first', { acceptance: 'it works' }).id, '001');
    R.newIssue(root, 'second', { after: '1' });
    assert.throws(() => R.setStatus(root, '1', 'done'), /no evidence yet/);
    const lease = R.setStatus(root, '1', 'in-progress', undefined, { worker: 'w1' });
    assert.equal(lease.worker, 'w1');
    R.addEvidence(root, '1', undefined, { ran: 'npm test', saw: 'ok' });
    R.review(root, '1', 'approve', 'fine', { by: 'reviewer' });
    assert.equal(R.setStatus(root, '1', 'done').status, 'done');
    R.recordMerged(root, '1', { sha: 'abc1234', ci: 'green' });
    assert.deepEqual(R.mergedOf(R.findIssue(root, '1')), { sha: 'abc1234', repo: null, ci: 'green' });
    assert.deepEqual(R.evidenceRows(R.findIssue(root, '1')), [{ ran: 'npm test', saw: 'ok' }]);
    assert.equal(R.addRound(root, '2', 'failed once').round, 1);
    R.decide(root, 'one', 'first ruling');
    R.decide(root, 'two', 'second ruling', { supersedes: 'one', settles: '2' });
    assert.deepEqual(R.decisions(root, { live: true }).map((d) => d.slug), ['two']);
    assert.equal(R.ask(root, 'which?', { issue: '2' }).id, '001');
    assert.equal(R.answer(root, 'a-001', 'this').issue, '002');
    assert.equal(R.loadAsks(root)[0].state, 'answered');
    assert.deepEqual(R.appendLog(root, 'an event'), { logged: 'an event' });
    assert.throws(() => R.appendLog(root, ''), /log requires/);
    R.setTags(root, '1,2', ['+x']);
    R.setPriority(root, '2', '1');
    R.setFiles(root, '2', 'a.mjs');
    R.setBody(root, '2', { what: 'the what' });
    assert.equal(R.findIssue(root, '2').sections.what.trim(), 'the what');
    const status = R.statusData(root);
    assert.equal(status.done, 1);
    assert.equal(status.goal, 'the goal');
    const resume = R.resumeData(root, { log: 3 });
    assert.equal(resume.goal, 'the goal');
    assert.equal(resume.log.length, 3);
    // an issue round-trips through render and parse
    const text = R.renderIssue({ id: '009', title: 'T', kind: 'gap', priority: '2', tier: 'standard', tags: [], files: [], foundBy: 'me' });
    assert.equal(R.parseIssue(text, 'x.md').title, 'T');
    // the lock is left free after each call
    assert.equal(existsSync(join(R.jarlDir(root), '.lock')), false);
    assert.equal(R.withLock(root, () => existsSync(join(R.jarlDir(root), '.lock'))), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the profile through record.mjs: a declared field is written by setField, never mistaken for a status', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-record-profile-'));
  try {
    const file = join(root, 'profile.json');
    writeFileSync(file, JSON.stringify({ 'jarl-profile': R.PROFILE_VERSION, name: 'p', statuses: { open: ['dispatchable'], doing: ['holds-claim'], done: ['settles-dependents', 'terminal', 'closes-record'] }, fields: { Area: { enum: ['a', 'b'] } } }));
    assert.equal(R.readProfileFile(file).profile.name, 'p');
    assert.throws(() => R.validateProfile({ 'jarl-profile': 1 }), /not a valid profile/);
    R.initLoop(root, 'g', { profile: file });
    assert.equal(R.describeProfile(R.loadProfile(root)).name, 'p');
    assert.deepEqual(R.describeProfile(R.DEFAULT_PROFILE).statuses.map((s) => s.name), ['open', 'in-progress', 'done', 'dropped', 'deferred']);
    R.newIssue(root, 't');
    assert.deepEqual(R.setField(root, '1', 'Area', 'b'), { id: '001', field: 'Area', value: 'b' });
    assert.throws(() => R.setField(root, '1', 'Area', 'z'), /Area must be one of/);
    assert.throws(() => R.setStatus(root, '1', 'area', 'b'), /is a field this loop's profile declares, not a status/);
    assert.throws(() => R.setField(root, '1', 'doing', 'x'), /not a field this loop's profile declares/);
    assert.equal(R.setStatus(root, '1', 'doing').status, 'doing');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
