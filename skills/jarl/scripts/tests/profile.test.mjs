// The loop profile: .jarl/profile.json, stored by init --profile and checked against the schema. A profile is data —
// statuses with flags, declared fields and sections — and a loop without one behaves exactly as before profiles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const J = await import('../jarl.mjs');

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-profile-'));
  mkdirSync(join(dir, '.git'));
  return dir;
}
function jarl(root, ...args) {
  return execFileSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function refuses(root, ...args) {
  try { jarl(root, ...args); } catch (e) { return String(e.stderr); }
  throw new Error('expected a refusal');
}
function profileFile(json) {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-profile-file-'));
  const file = join(dir, 'profile.json');
  writeFileSync(file, typeof json === 'string' ? json : JSON.stringify(json, null, 2));
  return file;
}

// A profile shaped like a software house's: a proposal waits for acceptance before it can be offered, two statuses
// hold the claim, only a merge settles a dependent, and a drop does not.
export const HOUSE = {
  'jarl-profile': 1,
  name: 'house',
  statuses: {
    proposed: [],
    queued: ['dispatchable'],
    running: ['holds-claim'],
    landed: ['holds-claim'],
    merged: ['settles-dependents', 'terminal', 'closes-record'],
    blocked: [],
    dropped: ['terminal', 'needs-reason'],
  },
};
// The built-in statuses written out as a profile: the generic code must read it exactly as the built-in one.
const BUILTIN_AS_FILE = { 'jarl-profile': 1, name: 'same', statuses: J.BUILTIN_STATUSES };

// ---- the schema ----

test('the built-in profile is the statuses, kinds and tiers Jarl always had', () => {
  const p = J.DEFAULT_PROFILE;
  assert.deepEqual(p.statuses, J.STATUSES);
  assert.equal(p.initial, 'open');
  assert.deepEqual(p.kinds, J.KINDS);
  assert.deepEqual(p.tiers, J.TIERS);
  assert.equal(p.declared, false);
  assert.deepEqual(p.with('dispatchable'), ['open']);
  assert.deepEqual(p.with('holds-claim'), ['in-progress']);
  assert.deepEqual(p.with('settles-dependents'), ['done', 'dropped']);
  assert.deepEqual(p.with('terminal'), ['done', 'dropped', 'deferred']);
  assert.deepEqual(p.with('closes-record'), ['done']);
  assert.deepEqual(p.with('needs-reason'), ['dropped', 'deferred']);
});

test('a profile is checked whole, and every problem is named at once', () => {
  assert.throws(() => J.validateProfile([]), /not a JSON object/);
  const e = (() => { try { J.validateProfile({ 'jarl-profile': 2, bogus: 1, statuses: { Open: [], queued: ['dispatchable', 'terminal'], ran: ['fast'], x: ['closes-record'] } }); } catch (x) { return x.message; } return ''; })();
  assert.match(e, /unknown key "bogus"/);
  assert.match(e, /"jarl-profile" must be 1/);
  assert.match(e, /status "Open" must be lower-case/);
  assert.match(e, /status "queued" is at most one of dispatchable, holds-claim and terminal/);
  assert.match(e, /status "ran": unknown flag "fast"/);
  assert.match(e, /status "x" is closes-record, so it must be terminal too/);
  assert.match(e, /no status holds-claim/);
});

test('a profile must let the loop run and close, and a new issue must start somewhere it can wait', () => {
  assert.throws(() => J.validateProfile({ 'jarl-profile': 1, statuses: { a: ['holds-claim'], b: ['terminal'] } }), /no status is dispatchable/);
  assert.throws(() => J.validateProfile({ 'jarl-profile': 1, statuses: { a: ['dispatchable'], b: ['holds-claim'] } }), /no status is terminal/);
  assert.throws(() => J.validateProfile({ 'jarl-profile': 1, statuses: { b: ['terminal'], a: ['dispatchable'], c: ['holds-claim'] } }), /a new issue starts in "b", which is terminal/);
  assert.throws(() => J.validateProfile({ ...HOUSE, initial: 'nope' }), /"initial" must name one of the statuses/);
  assert.equal(J.validateProfile({ ...HOUSE, initial: 'queued' }).initial, 'queued');
  assert.equal(J.validateProfile(HOUSE).initial, 'proposed', 'the first status listed, when initial is not given');
});

test('fields: names with digits and dashes, enums and defaults; the tool\'s own fields and a status name are refused', () => {
  const p = J.validateProfile({ ...HOUSE, fields: { 'Area-2': { enum: ['core', 'cli'], default: 'core' }, Class: {}, Kind: { enum: ['feature', 'fix'], default: 'fix' }, Tier: { enum: ['s', 'm', 'l'] } } });
  assert.deepEqual(p.kinds, ['feature', 'fix']);
  assert.equal(p.kindDefault, 'fix');
  assert.deepEqual(p.tiers, ['s', 'm', 'l']);
  assert.equal(p.tierDefault, 's', 'the first value when no default is given');
  assert.deepEqual(p.fields.map((f) => f.name), ['Area-2', 'Class'], 'Kind and Tier stay where they always were');
  const bad = (fields, re) => assert.throws(() => J.validateProfile({ ...HOUSE, fields }), re);
  bad({ Status: {} }, /field "Status" is one the tool writes itself/);
  bad({ 'found by': {} }, /field "found by" is one the tool writes itself/);
  bad({ Merged: {} }, /field "Merged" is one the tool writes itself/);
  bad({ Blocked: {} }, /has the name of a status/);
  bad({ 'x_y': {} }, /must be letters, digits, spaces and -/);
  bad({ '2x': {} }, /must be letters, digits, spaces and -/);
  bad({ A: { enum: ['a', 'b'], default: 'c' } }, /"default" "c" is not one of its enum values/);
  bad({ A: { enum: ['a,b'] } }, /without commas/);
  bad({ A: { enum: ['a', 'a'] } }, /names a value twice/);
  bad({ A: { pattern: 'x' } }, /unknown key "pattern"/);
  bad({ Kind: { default: 'x' } }, /declaring it means giving its values/);
  bad({ Tier: { enum: ['x'], required: true } }, /"required" has no meaning/);
  bad({ A: {}, a: {} }, /declared twice/);
});

test('sections and the acceptance heading: extra headings only, and the alias may carry a dash', () => {
  const p = J.validateProfile({ ...HOUSE, sections: ['Plan', 'Ports'], 'acceptance-heading': 'Acceptance — evidence' });
  assert.deepEqual(p.sections, ['Plan', 'Ports']);
  assert.equal(p.acceptance, 'Acceptance — evidence');
  assert.throws(() => J.validateProfile({ ...HOUSE, sections: ['Why'] }), /section "Why" is built in/);
  assert.throws(() => J.validateProfile({ ...HOUSE, sections: ['Plan', 'plan'] }), /declared twice/);
  assert.throws(() => J.validateProfile({ ...HOUSE, sections: ['Plan'], 'acceptance-heading': 'plan' }), /already the heading of another section/);
  assert.throws(() => J.validateProfile({ ...HOUSE, 'acceptance-heading': '## Acc' }), /one-line heading/);
  assert.equal(J.validateProfile({ ...HOUSE, 'acceptance-heading': 'Acceptance' }).acceptance, null, 'the built-in heading is no alias');
});

// ---- init and the profile command ----

test('init --profile checks the file and stores it; a bad one leaves nothing behind', () => {
  const root = repo();
  const bad = profileFile({ 'jarl-profile': 1, statuses: { a: [] } });
  assert.match(refuses(root, 'init', 'g', '--profile', bad), /is not a valid profile:\n- no status is dispatchable/);
  assert.ok(!existsSync(join(root, '.jarl')), 'nothing was written');
  assert.match(refuses(root, 'init', 'g', '--profile', profileFile('{ nope')), /is not JSON/);
  assert.match(refuses(root, 'init', 'g', '--profile', join(root, 'missing.json')), /no such profile file/);
  assert.match(jarl(root, 'init', 'g', '--profile', profileFile(HOUSE)), /opened .* · kept out of git · profile house/);
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.jarl', 'profile.json'), 'utf8')), HOUSE);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /opened · g · profile house\n/);
  const d = JSON.parse(jarl(root, 'profile', '--json'));
  assert.equal(d.name, 'house');
  assert.equal(d.initial, 'proposed');
  assert.deepEqual(d.statuses.find((s) => s.name === 'merged').flags, ['settles-dependents', 'terminal', 'closes-record']);
  assert.match(jarl(root, 'profile'), /^profile house\nstatuses:\n {2}proposed \(initial\)\n {2}queued {2}dispatchable/);
});

test('profile with a file checks it without touching the loop; with no loop it describes the built-in one', () => {
  const root = repo();
  assert.match(jarl(root, 'profile'), /^profile built-in \(no \.jarl\/profile\.json: the built-in one\)/);
  assert.match(jarl(root, 'profile', profileFile(HOUSE)), /^profile house/);
  assert.match(refuses(root, 'profile', profileFile({ 'jarl-profile': 1 })), /"statuses" must be an object/);
  assert.ok(!existsSync(join(root, '.jarl')));
});

test('a profile file broken by hand is a refusal on every command, never a silent fallback to the built-in one', () => {
  const root = repo();
  jarl(root, 'init', 'g', '--profile', profileFile(HOUSE));
  writeFileSync(join(root, '.jarl', 'profile.json'), JSON.stringify({ ...HOUSE, statuses: { queued: ['dispatchable'] } }));
  assert.match(refuses(root, 'list'), /profile\.json is not a valid profile/);
  assert.match(refuses(root, 'new', 't'), /profile\.json is not a valid profile/);
});

test('archive takes the profile with the loop: the next loop here is opened with its own', () => {
  const root = repo();
  jarl(root, 'init', 'g', '--profile', profileFile(HOUSE));
  jarl(root, 'archive', 'first');
  assert.ok(!existsSync(join(root, '.jarl', 'profile.json')));
  jarl(root, 'init', 'second');
  assert.equal(JSON.parse(jarl(root, 'profile', '--json')).name, 'built-in');
});

// ---- statuses with flags ----

function houseLoop() {
  const root = repo();
  jarl(root, 'init', 'g', '--profile', profileFile(HOUSE));
  return root;
}

test('a new issue starts in the initial status, and next offers only a dispatchable one', () => {
  const root = houseLoop();
  jarl(root, 'new', 'a', '--files', 'src/a.mjs');
  assert.match(jarl(root, 'show', '1'), /\*\*Status:\*\* proposed/);
  assert.equal(jarl(root, 'next'), '(nothing open)', 'a proposal is not offered');
  assert.match(refuses(root, 'set', '1', 'open', 'x'), /status must be one of: proposed, queued, running, landed, merged, blocked, dropped/);
  jarl(root, 'set', '1', 'queued', 'accepted');
  assert.match(jarl(root, 'next'), /^001 {2}P2 {2}a/);
});

test('both holds-claim statuses carry the lease and hold their files; leaving them removes the lease', () => {
  const root = houseLoop();
  jarl(root, 'new', 'a', '--files', 'src/a.mjs');
  jarl(root, 'new', 'b', '--files', 'src/a.mjs');
  jarl(root, 'set', '1,2', 'queued', 'accepted');
  assert.match(refuses(root, 'set', '1', 'queued', 'x', '--worker', 'w'), /--worker goes with running or landed only/);
  jarl(root, 'set', '1', 'running', 'go', '--branch', 'b/1', '--worker', 'w1');
  assert.match(jarl(root, 'show', '1'), /\*\*Worker:\*\* w1/);
  assert.match(jarl(root, 'next'), /002 .*waits on src\/a\.mjs/);
  jarl(root, 'set', '1', 'landed', 'ready for the gate', '--worker', 'w1');
  assert.match(jarl(root, 'show', '1'), /\*\*Since:\*\*/);
  assert.match(jarl(root, 'next'), /002 .*waits on src\/a\.mjs/, 'landed still holds the claim');
  jarl(root, 'set', '1', 'blocked', 'waits for the owner');
  const shown = jarl(root, 'show', '1');
  assert.doesNotMatch(shown, /\*\*Worker:\*\*|\*\*Since:\*\*/);
  assert.match(shown, /\*\*Branch:\*\* b\/1/);
  assert.match(jarl(root, 'next'), /^002 {2}P2 {2}b {2}\(no acceptance yet\)$/m);
});

test('only a settles-dependents status releases a dependent; a drop here does not', () => {
  const root = houseLoop();
  jarl(root, 'new', 'first');
  jarl(root, 'new', 'second', '--after', '1');
  jarl(root, 'set', '1,2', 'queued', 'accepted');
  assert.match(jarl(root, 'next'), /002 .*\(after 001\)/);
  assert.match(refuses(root, 'set', '1', 'dropped'), /dropped needs a reason/);
  jarl(root, 'set', '1', 'dropped', 'not needed');
  assert.match(jarl(root, 'show', '1'), /Dropped: not needed/);
  assert.match(jarl(root, 'next'), /002 .*\(after 001\)/, 'dropped is terminal but does not settle here');
});

test('a closes-record status passes the done gate: evidence since the claim, and a live approve', () => {
  const root = houseLoop();
  jarl(root, 'new', 'first');
  jarl(root, 'new', 'second', '--after', '1');
  jarl(root, 'set', '1,2', 'queued', 'accepted');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'old');
  jarl(root, 'set', '1', 'running', 'go', '--worker', 'w1');
  assert.match(refuses(root, 'set', '1', 'merged'), /no --ran\/--saw evidence row recorded since it was moved → running/);
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', '12 pass');
  assert.match(refuses(root, 'set', '1', 'merged'), /no approving review/);
  assert.match(refuses(root, 'review', '1', 'approve', 'fine', '--by', 'w1'), /self-approve/);
  jarl(root, 'review', '1', 'approve', 'read it', '--by', 'reviewer');
  jarl(root, 'set', '1', 'merged', 'landed through the gate');
  assert.match(jarl(root, 'next'), /^002 {2}P2 {2}second {2}\(no acceptance yet\)$/m, 'merged settles the dependent');
  const st = JSON.parse(jarl(root, 'status', '--json'));
  assert.deepEqual(st.reviews, { fresh: 1, coordinator: 0, self: 0, unrecorded: 0 });
  assert.equal(st.statuses.merged, 1);
  // A reopen out of the closing status spends the approve, as a reopen out of done does.
  jarl(root, 'set', '1', 'queued', 'reopened');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'again');
  assert.match(refuses(root, 'set', '1', 'merged'), /no approving review newer than its last round or reopen/);
});

test('status, list, report and close read the statuses by their flags', () => {
  const root = houseLoop();
  jarl(root, 'new', 'waits for acceptance');
  jarl(root, 'new', 'queued one');
  jarl(root, 'new', 'blocked one');
  jarl(root, 'new', 'dropped one');
  jarl(root, 'set', '2,3,4', 'queued', 'accepted');
  jarl(root, 'set', '3', 'blocked', 'owner');
  jarl(root, 'set', '4', 'dropped', 'no longer wanted');
  const line = jarl(root, 'status').split('\n')[2];
  assert.equal(line, 'queued 1 · in flight 0 · proposed 1 · merged 0 · blocked 1 · dropped 1 · questions 0');
  assert.match(jarl(root, 'status').split('\n')[1], / · profile house$/);
  assert.deepEqual(JSON.parse(jarl(root, 'list', '--json')).map((i) => i.id), ['001', '002', '003'], 'proposed and blocked are not finished');
  const report = JSON.parse(jarl(root, 'report', '--json'));
  assert.equal(report.left, 3);
  assert.deepEqual(report.statuses, { proposed: 1, queued: 1, running: 0, landed: 0, merged: 0, blocked: 1, dropped: 1 });
  assert.match(report.text, /## Done \(0\)\n\n## Dropped \(1\)\n- 004 dropped one — no longer wanted\n\n## Still open \(3\)/);
  assert.match(refuses(root, 'close'), /3 issue\(s\) still open or in progress: 001, 002, 003 — set each merged,/);
  assert.match(jarl(root, 'status', '--by', 'kind'), /bug {2}proposed 1 · queued 1 · running 0 · landed 0 · merged 0 · blocked 1 · dropped 1/);
  assert.match(jarl(root, 'resume'), /· profile house\nqueued 1 · in flight 0 · proposed 1/);
});

// ---- no profile: exactly as before ----

test('no profile: no profile file, the same issue file byte for byte, the same log line, the same JSON keys', () => {
  const root = repo();
  assert.equal(jarl(root, 'init', 'g'), `opened ${join(root, '.jarl')} · kept out of git`);
  assert.ok(!existsSync(join(root, '.jarl', 'profile.json')));
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /· opened · g\n$/);
  jarl(root, 'new', 'plain issue', '--files', 'a.mjs', '--acceptance', 'it works');
  const file = readFileSync(join(root, '.jarl', 'issues', '001-plain-issue.md'), 'utf8');
  assert.equal(file, '# 001 · plain issue\n\n**Status:** open\n**Kind:** bug\n**Priority:** 2\n**Tier:** standard\n**Tags:** \n**Files:** a.mjs\n**Found by:** jarl\n**Where:**\n\n## What\n\n\n## Why\n\n\n## Acceptance\nit works\n\n## Evidence\n\n');
  const st = JSON.parse(jarl(root, 'status', '--json'));
  assert.deepEqual(Object.keys(st).slice(0, 5), ['open', 'in-progress', 'done', 'dropped', 'deferred']);
  assert.ok(!('profile' in st));
  const rep = JSON.parse(jarl(root, 'report', '--json'));
  assert.deepEqual(Object.keys(rep), ['done', 'dropped', 'deferred', 'left', 'found', 'reviews', 'byRepo', 'issues', 'text']);
  assert.equal(jarl(root, 'status').split('\n')[2], 'open 1 · in flight 0 · done 0 · dropped 0 · deferred 0 · questions 0');
  assert.doesNotMatch(jarl(root, 'status'), /profile/);
  assert.match(refuses(root, 'set', '1', 'queued', 'x'), /status must be one of: open, in-progress, done, dropped, deferred/);
  assert.match(refuses(root, 'new', 'x', '--kind', 'feature'), /--kind must be one of: bug, gap, cleanup, docs, test, research, process/);
  assert.match(refuses(root, 'set', '1', 'in-progress', 'x', '--worker', ''), /--worker needs a value/);
  assert.match(refuses(root, 'set', '1', 'open', 'x', '--worker', 'w'), /--worker goes with in-progress only/);
  assert.match(refuses(root, 'set', '1', 'deferred'), /deferred needs a reason: jarl\.mjs set <id> deferred "<why>" — work that waits, not work that is gone/);
});

// The same work, run on a loop with no profile and on one whose profile spells out the built-in statuses: every view
// must print the same, which is what shows the generic code reads the flags the way the constants were read.
function sameWork(root) {
  jarl(root, 'new', 'one', '--files', 'a.mjs', '--acceptance', 'x');
  jarl(root, 'new', 'two', '--files', 'a.mjs', '--after', '1');
  jarl(root, 'new', 'three', '--files', 'b.mjs');
  jarl(root, 'new', 'four');
  jarl(root, 'new', 'five');
  jarl(root, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/001-one', '--worker', 'w1');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'ok');
  jarl(root, 'review', '1', 'approve', 'fine', '--by', 'r1');
  jarl(root, 'set', '4', 'dropped', 'gone');
  jarl(root, 'set', '5', 'deferred', 'later');
  jarl(root, 'set', '3', 'in-progress', 'go');
  jarl(root, 'round', '3', 'red');
  jarl(root, 'evidence', '3', '--ran', 'npm test', '--saw', 'ok');
  jarl(root, 'review', '3', 'approve', 'fine', '--by', 'jarl');
  jarl(root, 'set', '3', 'done', 'done');
  const views = {};
  for (const v of [['next'], ['list', '--all'], ['status'], ['status', '--by', 'kind'], ['report'], ['resume', '--log', '0'], ['queue'], ['next', '--json']]) {
    views[v.join(' ')] = jarl(root, ...v).replace(/ · profile same/g, '').replace(new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<root>').replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, '<t>');
  }
  views.close = refuses(root, 'close');
  return views;
}

test('a profile that spells out the built-in statuses reads exactly as no profile at all', () => {
  const plain = repo();
  jarl(plain, 'init', 'g');
  const spelled = repo();
  jarl(spelled, 'init', 'g', '--profile', profileFile(BUILTIN_AS_FILE));
  const a = sameWork(plain);
  const b = sameWork(spelled);
  for (const k of Object.keys(a)) assert.equal(b[k], a[k], `${k} prints the same`);
});

// ---- declared fields and sections ----

const FIELDED = {
  ...HOUSE,
  fields: {
    Kind: { enum: ['feature', 'fix', 'chore'], default: 'feature' },
    Tier: { enum: ['standard', 'strong', 'max'] },
    'Area-2': { enum: ['core', 'cli'], required: true },
    Class: { default: 'b' },
    Note: {},
  },
  sections: ['Plan', 'Ports'],
  'acceptance-heading': 'Acceptance — evidence',
};
function fieldedLoop() {
  const root = repo();
  jarl(root, 'init', 'g', '--profile', profileFile(FIELDED));
  return root;
}

test('new writes the declared fields after Where, the extra sections after Acceptance, under the profile\'s heading', () => {
  const root = fieldedLoop();
  assert.match(refuses(root, 'new', 't'), /Area-2 is required by this loop's profile — give it: --field "Area-2=<value>" \(one of: core, cli\)/);
  assert.match(refuses(root, 'new', 't', '--field', 'Area-2=web'), /Area-2 must be one of: core, cli \(got "web"\)/);
  assert.match(refuses(root, 'new', 't', '--field', 'Bogus=1'), /Bogus is not a field this loop's profile declares — it declares Area-2, Class, Note/);
  assert.match(refuses(root, 'new', 't', '--field', 'Area-2'), /--field takes <name>=<value>/);
  assert.match(refuses(root, 'new', 't', '--kind', 'bug', '--field', 'area-2=core'), /--kind must be one of: feature, fix, chore/);
  jarl(root, 'new', 'a thing', '--field', 'area-2=core', '--section', 'Plan=first this\nthen that', '--acceptance', 'it runs', '--tier', 'max');
  const file = readFileSync(join(root, '.jarl', 'issues', '001-a-thing.md'), 'utf8');
  assert.equal(file, '# 001 · a thing\n\n**Status:** proposed\n**Kind:** feature\n**Priority:** 2\n**Tier:** max\n**Tags:** \n**Files:** \n**Found by:** jarl\n**Where:**\n**Area-2:** core\n**Class:** b\n**Note:**\n\n## What\n\n\n## Why\n\n\n## Acceptance — evidence\nit runs\n\n## Plan\nfirst this\nthen that\n\n## Ports\n\n\n## Evidence\n\n');
  const shown = JSON.parse(jarl(root, 'show', '1', '--json'));
  assert.equal(shown.fields['area-2'], 'core');
  assert.equal(shown.sections.acceptance, 'it runs\n\n', 'the aliased heading reads as the acceptance');
  assert.doesNotMatch(jarl(root, 'next'), /no acceptance/);
});

test('an issue written with the aliased heading by another tool counts its acceptance lines', () => {
  const root = fieldedLoop();
  jarl(root, 'new', 'x', '--field', 'Area-2=cli');
  jarl(root, 'set', '1', 'queued', 'ok');
  const path = join(root, '.jarl', 'issues', '001-x.md');
  writeFileSync(path, readFileSync(path, 'utf8').replace('## Acceptance — evidence\n\n', '## Acceptance — evidence\n- one\n- two\n'));
  jarl(root, 'set', '1', 'running', 'go');
  assert.deepEqual(JSON.parse(jarl(root, 'status', '--json')).noAcceptance, []);
  jarl(root, 'body', '1', '--acceptance', 'three', '--section', 'Ports=in: a; out: b');
  const text = readFileSync(path, 'utf8');
  assert.match(text, /## Acceptance — evidence\nthree\n\n## Plan/, 'body writes under the heading the file has');
  assert.doesNotMatch(text, /^## Acceptance$/m);
  assert.match(text, /## Ports\n+in: a; out: b\n/);
  assert.match(refuses(root, 'body', '1', '--section', 'Why=x'), /Why is not a section this loop's profile declares — it declares Plan, Ports/);
});

test('set <ids> <field> <value> writes a declared field, checked against its values, one log line per issue', () => {
  const root = fieldedLoop();
  jarl(root, 'new', 'a', '--field', 'Area-2=core');
  jarl(root, 'new', 'b', '--field', 'Area-2=core');
  assert.equal(jarl(root, 'set', '1,2', 'area-2', 'cli'), '001 Area-2: cli\n002 Area-2: cli');
  assert.match(refuses(root, 'set', '1', 'Area-2', 'web'), /Area-2 must be one of: core, cli/);
  assert.match(refuses(root, 'set', '1', 'Area-2', ''), /Area-2 cannot be empty/);
  assert.match(refuses(root, 'set', '1', 'Area-2'), /the value is required/);
  jarl(root, 'set', '1', 'Note', 'see the thread');
  jarl(root, 'set', '1', 'kind', 'fix');
  const shown = jarl(root, 'show', '1');
  assert.match(shown, /\*\*Kind:\*\* fix/);
  assert.match(shown, /\*\*Note:\*\* see the thread/);
  assert.match(refuses(root, 'set', '1', 'kind', 'bug'), /Kind must be one of: feature, fix, chore/);
  assert.match(refuses(root, 'set', '1', 'Note', 'x', '--worker', 'w'), /--worker goes with a status, not with the field Note/);
  assert.match(refuses(root, 'set', '1', 'Files', 'x'), /status must be one of: .* — or a field this loop's profile declares: Kind, Tier, Area-2, Class, Note/);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /· 001 field Area-2 · cli\n.*· 002 field Area-2 · cli\n/);
  // A field line is not a status move: the done gate's replay does not read it as one.
  assert.equal(JSON.parse(jarl(root, 'show', '1', '--json')).status, 'proposed');
});

test('list --match filters on any header field; list and resume show the declared fields; status --by takes one', () => {
  const root = fieldedLoop();
  jarl(root, 'new', 'a', '--field', 'Area-2=core');
  jarl(root, 'new', 'b', '--field', 'Area-2=cli', '--kind', 'fix');
  jarl(root, 'new', 'c', '--field', 'Area-2=cli');
  jarl(root, 'set', '1,2,3', 'queued', 'ok');
  const ids = (...w) => JSON.parse(jarl(root, 'list', ...w.flatMap((x) => ['--match', x]), '--json')).map((i) => i.id);
  assert.deepEqual(ids('area-2=cli'), ['002', '003']);
  assert.deepEqual(ids('Area-2=cli', 'kind=fix'), ['002']);
  assert.deepEqual(ids('status=queued'), ['001', '002', '003']);
  assert.deepEqual(ids('Note='), ['001', '002', '003'], 'an empty value matches an empty field');
  assert.match(refuses(root, 'list', '--match', 'bogus=1'), /--match names a header field — one of: .*Area-2, Class, Note \(got "bogus"\)/);
  assert.match(refuses(root, 'list', '--match', 'nothing'), /--match takes <field>=<value>/);
  assert.match(jarl(root, 'list'), /^001 {2}P2 {2}queued {6}feature {2}a {2}Area-2=core Class=b$/m);
  jarl(root, 'set', '2', 'running', 'go', '--worker', 'w');
  const resume = JSON.parse(jarl(root, 'resume', '--json'));
  assert.deepEqual(resume.inFlight[0].fields, { 'Area-2': 'cli', Class: 'b' });
  assert.deepEqual(resume.next.map((r) => r.fields['Area-2']), ['core', 'cli']);
  assert.match(jarl(root, 'resume'), /- 002 b · Area-2=cli Class=b · worker w/);
  assert.match(jarl(root, 'status', '--by', 'area-2'), /by area-2:\n {2}cli +proposed 0 · queued 1 · running 1 .*\n {2}core +proposed 0 · queued 1/);
  assert.match(refuses(root, 'status', '--by', 'bogus'), /--by is one of: repo, tag, kind, prio, area-2, class, note/);
});

test('a template fills declared fields and sections; import takes --field and files under the profile\'s kinds', () => {
  const root = fieldedLoop();
  mkdirSync(join(root, '.jarl', 'templates'));
  writeFileSync(join(root, '.jarl', 'templates', 'area.md'), '# t\n\n**Area-2:** cli\n\n## Plan\nthe usual plan\n\n## Acceptance — evidence\n- it holds\n');
  jarl(root, 'new', 'from template', '--template', 'area');
  const t = JSON.parse(jarl(root, 'show', '1', '--json'));
  assert.equal(t.fields['area-2'], 'cli');
  assert.equal(t.sections.plan.trim(), 'the usual plan');
  assert.equal(t.sections.acceptance.trim(), '- it holds');
  const f = join(mkdtempSync(join(tmpdir(), 'jarl-findings-')), 'findings.json');
  writeFileSync(f, JSON.stringify([{ id: 'F1', title: 'one', kind: 'defect' }]));
  assert.match(refuses(root, 'import', f), /Area-2 is required/);
  jarl(root, 'import', f, '--field', 'Area-2=core');
  const i = JSON.parse(jarl(root, 'show', '2', '--json'));
  assert.equal(i.kind, 'feature', 'a finding\'s kind the profile does not name files under its default kind');
  assert.equal(i.fields['area-2'], 'core');
});

test('no profile: --field, --section and a field in place of a status are refused; --match works on the built-in fields', () => {
  const root = repo();
  jarl(root, 'init', 'g');
  assert.match(refuses(root, 'new', 't', '--field', 'A=1'), /this loop's profile declares no fields — --field names one/);
  assert.match(refuses(root, 'new', 't', '--section', 'Plan=x'), /declares no sections/);
  jarl(root, 'new', 'a', '--kind', 'gap');
  jarl(root, 'new', 'b');
  assert.match(refuses(root, 'set', '1', 'kind', 'gap'), /^status must be one of: open, in-progress, done, dropped, deferred\n$/);
  assert.deepEqual(JSON.parse(jarl(root, 'list', '--match', 'kind=gap', '--json')).map((i) => i.id), ['001']);
  assert.equal(jarl(root, 'list'), '001  P2  open        gap      a\n002  P2  open        bug      b');
});

// ---- the fresh review's points ----

test('under a profile the status counts live under statuses, so no status name can overwrite a key of the view', () => {
  const root = houseLoop();
  jarl(root, 'new', 'a');
  jarl(root, 'new', 'b', '--after', '1');
  jarl(root, 'set', '1,2', 'queued', 'ok');
  const st = JSON.parse(jarl(root, 'status', '--json'));
  assert.deepEqual(st.statuses, { proposed: 0, queued: 2, running: 0, landed: 0, merged: 0, blocked: 0, dropped: 0 });
  assert.equal(st.waiting, 1, 'waiting is the view\'s count of issues waiting on After');
  assert.equal(st.queued, undefined, 'no status count at the top level under a profile');
  assert.deepEqual(JSON.parse(jarl(root, 'resume', '--json')).status.statuses.queued, 2);
  assert.match(jarl(root, 'status'), /queued 1 · in flight 0 · waiting 1 · proposed 0 · merged 0/);
});

test('a status may not take a name the views use; the refusal lists the reserved names', () => {
  for (const name of ['waiting', 'ready', 'stale', 'questions', 'statuses', 'in-flight']) {
    assert.throws(() => J.validateProfile({ ...HOUSE, statuses: { ...HOUSE.statuses, [name]: [] } }), new RegExp(`status "${name}" is a name the views use for something else — the reserved names are waiting, ready, in-flight, questions, ratify, to-ratify, goal`));
  }
  assert.ok(J.RESERVED_STATUS_NAMES.every((n) => !J.STATUSES.includes(n)), 'no built-in status is reserved');
});

test('a profile must have a status that settles dependents, or every After would wait for good', () => {
  assert.throws(() => J.validateProfile({ 'jarl-profile': 1, statuses: { a: ['dispatchable'], b: ['holds-claim'], c: ['terminal', 'closes-record'] } }), /no status settles-dependents — an issue waiting on another with After would wait for good/);
  assert.doesNotThrow(() => J.validateProfile({ 'jarl-profile': 1, statuses: { a: ['dispatchable'], b: ['holds-claim'], c: ['terminal', 'settles-dependents'] } }));
});

test('no profile: status --json keeps the five counts at the top level and has no statuses key', () => {
  const root = repo();
  jarl(root, 'init', 'g');
  jarl(root, 'new', 'a');
  const st = JSON.parse(jarl(root, 'status', '--json'));
  assert.equal(st.open, 1);
  assert.ok(!('statuses' in st));
  assert.match(jarl(root, 'status'), /open 1 · in flight 0 · done 0 · dropped 0 · deferred 0 · questions 0/);
});

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-profile-git-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'a\n'); g('add', '.'); g('commit', '-qm', 'base');
  return { dir, g };
}

test('branches: a branch is DONE → delete by flags — closed or given up (terminal, settling, not closing); work that waits keeps it', () => {
  const PROF = { ...HOUSE, statuses: { ...HOUSE.statuses, abandoned: ['terminal', 'settles-dependents', 'needs-reason'], parked: ['terminal', 'needs-reason'] } };
  const { dir, g } = gitRepo();
  jarl(dir, 'init', 'g', '--profile', profileFile(PROF));
  for (const t of ['a', 'b', 'c']) jarl(dir, 'new', t);
  jarl(dir, 'set', '1,2,3', 'queued', 'ok');
  jarl(dir, 'set', '1,2', 'running', 'go', '--branch', 'feat/x', '--worker', 'w');
  jarl(dir, 'set', '3', 'running', 'go', '--branch', 'feat/y', '--worker', 'w');
  g('branch', 'feat/x'); g('branch', 'feat/y');
  jarl(dir, 'evidence', '1,3', '--ran', 't', '--saw', 'ok');
  jarl(dir, 'review', '1,3', 'approve', 'fine', '--by', 'r');
  jarl(dir, 'set', '1', 'merged', 'in');
  jarl(dir, 'set', '2', 'abandoned', 'gone');
  jarl(dir, 'new', 'd'); jarl(dir, 'set', '4', 'queued', 'ok');
  jarl(dir, 'set', '3', 'merged', 'in');
  jarl(dir, 'set', '4', 'running', 'go', '--branch', 'feat/y', '--worker', 'w');
  jarl(dir, 'set', '4', 'parked', 'later');
  const rows = JSON.parse(jarl(dir, 'branches', '--json'));
  assert.equal(rows.find((r) => r.branch === 'feat/x').done, 'delete', 'merged and a given-up issue: the branch can go');
  assert.equal(rows.find((r) => r.branch === 'feat/y').done, null, 'an issue parked on it keeps the branch');
});

