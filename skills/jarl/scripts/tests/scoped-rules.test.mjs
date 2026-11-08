// Rules with a scope: decide --applies-to writes whom a ruling applies to and until when, the views print to each reader
// the rules that match it, whole, Jarl ships its own role guidance as such rules, an agent proposes a rule for the jarl or
// the owner to accept, and close offers each rule of the loop for promotion. A reader of format 1 or 2 reads a ruling with a scope
// as a ruling whose text ends with the scope, and every other field of it as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jarl, refuses, skillText, loop as makeLoop } from './helpers.mjs';
import { BUILTIN_RULES, BUILTIN_STATUSES, parseScope, readLoop, ruleMatches, rulesFor } from '../jarl-lib.mjs';
import { formatTwoJarl, oldJarl } from './old-jarl.mjs';
import { FINDINGS } from './findings.mjs';

const loop = () => makeLoop({ prefix: 'jarl-rules-', via: 'cli', dotGit: false });
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const decisionsFile = (root) => readFileSync(join(root, '.jarl', 'decisions.md'), 'utf8');

test('decide --applies-to writes the scope as the first line of the ruling\'s closing block, and decisions shows it', () => {
  const root = loop();
  jarl(root, 'new', 'ui work', '--acceptance', '[read] it works', '--tags', 'ui');
  const out = jarl(root, 'decide', 'review-ui', 'Every ui change is shown in a screenshot.', '--applies-to', 'role reviewer and tag ui', '--until', '2999-12-31', '--settles', '1', '--by', 'coordinator');
  assert.match(out, /decided review-ui · by coordinator · applies to role reviewer and tag ui · until 2999-12-31/);
  assert.match(decisionsFile(root), /Every ui change is shown in a screenshot\.\n\n\*\*Applies to:\*\* role reviewer and tag ui · until 2999-12-31\n\*\*Settles:\*\* 1\n\*\*By:\*\* coordinator\n/);
  const [d] = json(root, 'decisions');
  assert.equal(d.appliesTo, 'role reviewer and tag ui · until 2999-12-31');
  assert.equal(d.ruling, 'Every ui change is shown in a screenshot.');
  assert.match(jarl(root, 'decisions'), /review-ui · by coordinator · applies to role reviewer and tag ui · until 2999-12-31 — Every ui change/);
});

test('decide --applies-to refuses a selector it does not know, a role or a moment it does not know, and --until alone', () => {
  const root = loop();
  assert.match(refuses(root, 'decide', 'x', 'text', '--applies-to', 'colour blue', '--by', 'coordinator'), /"colour blue" is not a selector of --applies-to: loop, or selectors joined by "and"/);
  assert.match(refuses(root, 'decide', 'x', 'text', '--applies-to', 'role painter', '--by', 'coordinator'), /role painter is not a role a rule reaches: jarl, coordinator, worker, reviewer, merger, takeover/);
  assert.match(refuses(root, 'decide', 'x', 'text', '--applies-to', 'moment lunch', '--by', 'coordinator'), /moment lunch is not a moment of work: filing, start, review, round, merge, done, close/);
  assert.match(refuses(root, 'decide', 'x', 'text', '--applies-to', 'loop and role worker', '--by', 'coordinator'), /loop takes no other selector/);
  assert.match(refuses(root, 'decide', 'x', 'text', '--until', '2999-01-01', '--by', 'coordinator'), /--until ends a rule with a scope: it needs --applies-to/);
  assert.match(refuses(root, 'decide', 'x', 'text', '--applies-to', 'loop', '--until', 'soon', '--by', 'coordinator'), /--until is a date \(yyyy-mm-dd\)/);
  assert.match(refuses(root, 'decide', 'x', 'text', '--applies-to', 'issue 9', '--by', 'coordinator'), /no such issue: 9/);
  assert.equal(json(root, 'decisions').length, 0, 'nothing was written');
});

test('a rule ends after its date, when its issue closes, or when a ruling supersedes it; decisions --live leaves an ended rule out', () => {
  const root = loop();
  jarl(root, 'new', 'the work', '--acceptance', '[read] it works');
  jarl(root, 'decide', 'past', 'Old rule.', '--applies-to', 'loop', '--until', '2000-01-01', '--by', 'coordinator');
  jarl(root, 'decide', 'future', 'Standing rule.', '--applies-to', 'loop', '--until', '2999-01-01', '--by', 'coordinator');
  jarl(root, 'decide', 'while-1', 'Rule while the work is open.', '--applies-to', 'role worker', '--until', '1', '--by', 'coordinator');
  jarl(root, 'decide', 'revoked', 'A rule taken back.', '--applies-to', 'role reviewer', '--by', 'coordinator');
  jarl(root, 'decide', 'revoke-it', 'The rule revoked is no longer needed.', '--supersedes', 'revoked', '--by', 'coordinator');
  const live = () => json(root, 'decisions', '--live').map((d) => d.slug);
  assert.deepEqual(live(), ['future', 'while-1', 'revoke-it']);
  assert.match(jarl(root, 'decisions'), /past · by coordinator · applies to loop · until 2000-01-01 · ENDED: ended 2000-01-01/);
  jarl(root, 'set', '1', 'dropped', 'not needed');
  assert.deepEqual(live(), ['future', 'revoke-it']);
  assert.match(jarl(root, 'decisions'), /while-1 · by coordinator · applies to role worker · until issue 1 closes · ENDED: ended when 1 closed \(dropped\)/);
});

test('a reader of format 1 or 2 reads a ruling with a scope: its text ends with the scope, its author and its supersession read as before', () => {
  const root = loop();
  jarl(root, 'decide', 'first', 'A rule for reviewers.', '--applies-to', 'role reviewer and moment round', '--by', 'jarl');
  jarl(root, 'decide', 'second', 'A rule for workers.', '--applies-to', 'role worker', '--supersedes', 'first', '--by', 'jarl');
  for (const reader of [oldJarl, formatTwoJarl]) {
    const read = reader(root, 'decisions', {});
    assert.equal(read.ok, true, read.error);
    const [first, second] = read.value;
    assert.equal(first.by, 'jarl');
    assert.equal(first.supersededBy, 'second');
    assert.match(first.ruling, /^A rule for reviewers\.\n\n\*\*Applies to:\*\* role reviewer and moment round$/);
    assert.equal(second.by, 'jarl');
    assert.equal(second.supersedes, 'first');
    assert.match(second.ruling, /\*\*Applies to:\*\* role worker$/);
  }
  const profile = join(root, '.jarl', 'profile.json');
  assert.equal(existsSync(profile) ? JSON.parse(readFileSync(profile, 'utf8')).format ?? 1 : 1, 1, 'a scope raises no record format');
});

// A loop with two slices, a ui issue in each, and a rule of every reach: the loop, a role, each slice, a tag for workers,
// a moment of the jarl's, and one that has ended.
const LONG = `Every report names the branch it was made on and the commit at its tip, so a reader can find the work without asking; ${'a rule is printed whole, '.repeat(6)}to its last word.`;
function rulesLoop() {
  const root = loop();
  jarl(root, 'goal', '--set', 'Coordinators: odin, frigg');
  jarl(root, 'new', 'odin ui', '--acceptance', '[read] it works', '--tags', 'slice:odin,ui', '--files', 'a.mjs');       // 1
  jarl(root, 'new', 'frigg work', '--acceptance', '[read] it works', '--tags', 'slice:frigg', '--files', 'b.mjs');      // 2
  jarl(root, 'new', 'jarl ui', '--acceptance', '[read] it works', '--tags', 'ui', '--files', 'c.mjs');                  // 3
  jarl(root, 'decide', 'loop-rule', LONG, '--applies-to', 'loop', '--by', 'coordinator');
  jarl(root, 'decide', 'coordinators', 'Coordinators report in one line.', '--applies-to', 'role coordinator', '--by', 'coordinator');
  jarl(root, 'decide', 'odin-only', 'Odin keeps the ui screens together.', '--applies-to', 'slice odin', '--by', 'coordinator');
  jarl(root, 'decide', 'frigg-only', 'Frigg asks before touching the parser.', '--applies-to', 'slice frigg', '--by', 'coordinator');
  jarl(root, 'decide', 'ui-workers', 'A ui worker attaches a screenshot.', '--applies-to', 'role worker and tag ui', '--by', 'coordinator');
  jarl(root, 'decide', 'reviewers', 'Reviewers run the suite themselves.', '--applies-to', 'role reviewer', '--by', 'coordinator');
  jarl(root, 'decide', 'at-merge', 'The jarl reads the diff once more before a merge.', '--applies-to', 'role jarl and moment merge', '--by', 'coordinator');
  jarl(root, 'decide', 'gone', 'An ended rule.', '--applies-to', 'loop', '--until', '2000-01-01', '--by', 'coordinator');
  return root;
}
const slugs = (o) => o.rules.map((r) => r.slug);

test('next --as prints the rules that match the asker, and none of another slice or role', () => {
  const root = rulesLoop();
  const odin = json(root, 'next', '--as', 'odin');
  assert.deepEqual(slugs(odin), ['loop-rule', 'coordinators', 'odin-only', 'jarl:coordinator-escalates', 'jarl:coordinator-pull-push', 'jarl:coordinator-scope-holds']);
  assert.deepEqual(slugs(json(root, 'next', '--as', 'frigg')), ['loop-rule', 'coordinators', 'frigg-only', 'jarl:coordinator-escalates', 'jarl:coordinator-pull-push', 'jarl:coordinator-scope-holds']);
  assert.deepEqual(slugs(json(root, 'next', '--as', 'jarl')), ['loop-rule', 'coordinators', 'jarl:coordinator-escalates', 'jarl:coordinator-pull-push', 'jarl:coordinator-scope-holds'], 'the jarl leases the issue in no slice, so it holds the coordinator\'s rules; no merge is waiting, so the rule of the merge is not its yet');
  assert.deepEqual(slugs(json(root, 'next', '--as', 'owner')), ['loop-rule']);
  const text = jarl(root, 'next', '--as', 'odin');
  assert.match(text, /\nRules for odin \(6\)\n- loop-rule · loop · by coordinator — Every report names/);
  assert.ok(text.includes(LONG), 'a rule is printed whole');
  assert.match(text, /- jarl:coordinator-escalates · role coordinator · references\/jarl\.md — It goes up with `ask "<text>" --kind escalation --slice <name>`[^\n]*\n  1\. a gap or a finding outside its slice's goal;/);
  assert.doesNotMatch(text, /frigg-only|reviewers|ui-workers|gone/);
});

test('a worker holding a lease is given the rules of its role and of the issue it works on; the jarl the rule of a moment its list stands at', () => {
  const root = rulesLoop();
  jarl(root, 'set', '3', 'in-progress', 'go', '--worker', 'w3', '--branch', 'jarl/3-ui');
  jarl(root, 'set', '2', 'in-progress', 'go', '--worker', 'w2', '--branch', 'jarl/2-work');
  assert.deepEqual(slugs(json(root, 'next', '--as', 'w3')), ['loop-rule', 'ui-workers', 'jarl:worker-only-the-issue']);
  assert.deepEqual(slugs(json(root, 'next', '--as', 'w2')), ['loop-rule', 'frigg-only', 'jarl:worker-only-the-issue'], 'a slice reaches the worker of an issue in it');
  jarl(root, 'evidence', '3', '--line', '1', '--ran', 'npm test', '--saw', 'pass 3');
  jarl(root, 'review', '3', 'approve', '--by', 'rev', FINDINGS);
  assert.deepEqual(slugs(json(root, 'next', '--as', 'jarl')), ['loop-rule', 'coordinators', 'at-merge', 'jarl:coordinator-escalates', 'jarl:coordinator-pull-push', 'jarl:coordinator-scope-holds']);
});

test('resume prints the rules of the whole loop and a count of the rulings, not every ruling; resume --as prints the asker\'s rules instead', () => {
  const root = rulesLoop();
  const text = jarl(root, 'resume');
  assert.doesNotMatch(text, /## Rulings in force/);
  assert.match(text, /\n7 ruling\(s\) in force: jarl\.mjs decisions --live; resume --as <who> adds the rules that match whoever asks\n/);
  assert.match(text, /## Rules for the whole loop \(1\)\n- loop-rule · loop · by coordinator — /);
  assert.ok(text.includes(LONG));
  assert.doesNotMatch(text, /Odin keeps|Coordinators report|An ended rule/);
  const asked = jarl(root, 'resume', '--as', 'odin');
  assert.doesNotMatch(asked, /## Rules for the whole loop/);
  assert.match(asked, /\n7 ruling\(s\) in force: jarl\.mjs decisions --live\n/);
  assert.match(asked, /Rules for odin \(6\)\n- loop-rule · loop · by coordinator/);
  assert.match(asked, /Odin keeps the ui screens together\./);
  assert.doesNotMatch(asked, /Frigg asks/);
  assert.equal(json(root, 'resume').rulings.length, 7, 'the JSON holds every ruling in force, the ended rule left out');
  assert.deepEqual(json(root, 'resume').rulings.map((d) => d.slug), json(root, 'decisions', '--live').map((d) => d.slug), 'resume and decisions --live agree on what is in force');
});

test('every rule Jarl ships is quoted whole from the reference it names, and each role the acceptance names has its rules', () => {
  const flat = (t) => t.replace(/\s+/g, ' ').trim();
  for (const r of BUILTIN_RULES) {
    assert.ok(r.slug.startsWith('jarl:'), r.slug);
    assert.ok(flat(skillText(r.source)).includes(flat(r.text)), `${r.slug} is not quoted from ${r.source}`);
    assert.ok(r.selectors.length > 0);
  }
  const of = (role) => BUILTIN_RULES.filter((r) => r.selectors.some((s) => s.word === 'role' && s.value === role)).length;
  assert.deepEqual([of('reviewer'), of('worker'), of('coordinator')], [5, 1, 4]);
});

test('a reviewer of a light issue in a round is given the reviewer\'s rules of the round and of the light tier; a reviewer of a standard issue at its first review is not', () => {
  const root = loop();
  jarl(root, 'new', 'light work', '--acceptance', '[read] it works', '--tier', 'light');
  jarl(root, 'new', 'standard work', '--acceptance', '[read] it works', '--tier', 'standard');
  const loopRead = readLoop(join(root, '.jarl'));
  const reviewer = (id, moments) => ({ roles: new Set(['reviewer']), slice: null, moments: new Set(moments), issues: [loopRead.byId.get(id)] });
  const slugsOf = (reader) => rulesFor(root, loopRead, reader, '2026-11-04').map((r) => r.slug);
  assert.deepEqual(slugsOf(reviewer('1', ['review', 'round'])), ['jarl:reviewer-every-round', 'jarl:reviewer-light-tier', 'jarl:reviewer-tier-above', 'jarl:reviewer-identical-output', 'jarl:reviewer-judges-the-issue']);
  assert.deepEqual(slugsOf(reviewer('2', ['review'])), ['jarl:reviewer-tier-above', 'jarl:reviewer-identical-output', 'jarl:reviewer-judges-the-issue']);
});

test('a selector of files matches a path, a directory and a pattern; of a repository and a kind, the issue that names them', () => {
  const root = loop();
  jarl(root, 'new', 'in lib', '--acceptance', '[read] it works', '--files', 'src/lib/a.mjs', '--kind', 'bug');
  const loopRead = readLoop(join(root, '.jarl'));
  const reader = { roles: new Set(['worker']), slice: null, moments: new Set(['start']), issues: [loopRead.byId.get('1')] };
  const holds = (scope) => ruleMatches(root, { selectors: parseScope(scope) }, reader);
  assert.ok(holds('files src/lib/a.mjs'));
  assert.ok(holds('files src/lib'));
  assert.ok(holds('files src/**/*.mjs'));
  assert.ok(!holds('files src/li'));
  assert.ok(!holds('files test/**'));
  assert.ok(holds('kind bug and role worker and files src/*/a.mjs'));
  assert.ok(!holds('kind gap'));
  assert.ok(!holds('role reviewer and kind bug'));
  assert.ok(holds('issue 1 and moment start'));
});

test('an agent proposes a rule: the ball is on the jarl, or on the owner where the rule is his; accepted, it reaches every reader it matches', () => {
  const root = loop();
  jarl(root, 'new', 'work', '--acceptance', '[read] it works', '--files', 'a.mjs');
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1', '--branch', 'jarl/1-work');
  const asked = json(root, 'ask', 'A worker runs the linter before it reports.', '--kind', 'rule', '--applies-to', 'role worker', '--by', 'w1');
  assert.equal(asked.kind, 'rule');
  assert.equal(asked.to, 'jarl');
  assert.equal(json(root, 'profile').format, 3, 'a proposed rule is a line of format 3');
  const onJarl = json(root, 'next', '--as', 'jarl').rows.find((r) => r.what === 'rule');
  assert.equal(onJarl.command, `jarl.mjs answer a-${asked.id} "<yes-or-reject-first>" --by jarl`);
  assert.match(onJarl.says, /rule proposed for role worker/);
  assert.ok(!json(root, 'next', '--as', 'owner').rows.some((r) => r.what === 'rule'));
  assert.ok(!slugs(json(root, 'next', '--as', 'w1')).includes(`ask-${asked.id}`), 'a proposal reaches no one');
  assert.match(jarl(root, 'resume'), new RegExp(`## Rules proposed \\(1\\)\\n- a-${asked.id} to jarl · applies to role worker · A worker runs the linter`));
  assert.match(refuses(root, 'answer', `a-${asked.id}`, 'maybe', '--by', 'owner'), /proposes a rule: the answer starts with one word/);
  jarl(root, 'answer', `a-${asked.id}`, 'yes', '--by', 'jarl');
  const rule = json(root, 'next', '--as', 'w1').rules.find((r) => r.slug === `ask-${asked.id}`);
  assert.equal(rule.text, 'A worker runs the linter before it reports.');
  assert.equal(rule.scope, 'role worker');
  assert.ok(!json(root, 'next', '--as', 'jarl').rules.some((r) => r.slug === `ask-${asked.id}`));

  const his = json(root, 'ask', 'Nothing is pushed on a Friday.', '--kind', 'rule', '--applies-to', 'loop', '--to', 'owner');
  assert.ok(json(root, 'next', '--as', 'owner').rows.some((r) => r.what === 'rule' && r.ask === his.id));
  assert.match(refuses(root, 'answer', `a-${his.id}`, 'yes', '--by', 'jarl'), /proposes a rule to the owner: it is his to accept or reject/);
  jarl(root, 'answer', `a-${his.id}`, 'reject', '--by', 'owner');
  assert.ok(!json(root, 'next', '--as', 'w1').rules.some((r) => r.slug === `ask-${his.id}`), 'a rejected rule reaches no one');
  assert.match(refuses(root, 'ask', 'x', '--kind', 'rule'), /a rule is proposed with whom it applies to/);
  const withOptions = refuses(root, 'ask', 'x', '--kind', 'rule', '--applies-to', 'loop', '--option', 'a:one', '--option', 'b:two');
  assert.match(withOptions, /^a proposed rule is answered yes or reject, so it takes no --option\n/);
  assert.match(withOptions, /\njarl\.mjs ask "<text>" --kind "<ask-kind>" --applies-to "<selectors>"\n$/, 'the form leaves the options out');
  assert.equal(json(root, 'ask', 'x', '--kind', 'rule', '--applies-to', 'loop').options, undefined, 'a proposed rule without options is filed');
  assert.match(refuses(root, 'ask', 'x', '--kind', 'rule', '--applies-to', 'loop', '--issue', '1'), /a proposed rule holds no issue back/);
  assert.match(refuses(root, 'ask', 'x', '--applies-to', 'loop'), /--applies-to, --until and --to go with kind rule/);
});

test('close offers each rule of the loop for promotion, on the owner, with four ways it goes on; Jarl\'s own rules and an ended rule are not offered', () => {
  const root = loop();
  jarl(root, 'new', 'work', '--acceptance', '[read] it works');
  jarl(root, 'decide', 'standing', 'Reports name their branch.', '--applies-to', 'loop', '--by', 'coordinator');
  jarl(root, 'decide', 'for-reviewers', 'Reviewers run the suite.', '--applies-to', 'role reviewer', '--by', 'coordinator');
  jarl(root, 'decide', 'old', 'Gone.', '--applies-to', 'loop', '--until', '2000-01-01', '--by', 'coordinator');
  jarl(root, 'decide', 'plain', 'A ruling with no scope.', '--by', 'coordinator');
  const out = json(root, 'close', '--batch');
  assert.deepEqual(out.promotion.items.map((i) => i.ruling), ['standing', 'for-reviewers']);
  const text = jarl(root, 'close', '--batch');
  assert.match(text, /rules of the loop to promote \(2\) — answer each with one way \(carry, instructions, law or drop\): jarl\.mjs answer "<question>" --option "<option>" --by "<who>"\n- a-1 · rule standing · loop: "Reports name their branch\." — what becomes of it when the loop closes\n- a-2 · rule for-reviewers · role reviewer:/);
  assert.equal(json(root, 'close', '--batch').promotion.filed.length, 0, 'a rule is offered once');
  const onOwner = json(root, 'next', '--as', 'owner').rows.filter((r) => r.what === 'promotion');
  assert.deepEqual(onOwner.map((r) => r.ruling), ['standing', 'for-reviewers']);
  assert.equal(onOwner[0].command, 'jarl.mjs answer a-1 --option "<option>" --by "<the-owner-himself>"');
  const promoted = refuses(root, 'answer', 'a-1', 'yes', '--by', 'owner');
  assert.match(promoted, /offers rule standing for promotion: answer it with --option and one of carry, instructions, law, drop\n/);
  assert.match(promoted, /\njarl\.mjs answer "<question>" --by "<who>" --option "<option>"\n$/, 'the form takes the option in place of the words given');
  jarl(root, 'answer', 'a-1', '--option', 'carry', '--by', 'owner');
  jarl(root, 'answer', 'a-2', '--option', 'drop', '--by', 'owner');
  const [a1, a2] = ['ask-1', 'ask-2'].map((slug) => json(root, 'decisions').find((d) => d.slug === slug));
  assert.match(a1.ruling, /\*\*Chose:\*\* carry/);
  assert.match(a2.ruling, /\*\*Chose:\*\* drop/);
  assert.equal(a1.appliesTo, null, 'the answer to an offer is a ruling of its own, not a second rule');
  jarl(root, 'set', '1', 'dropped', 'not needed');
  assert.match(jarl(root, 'close'), /^removed /);
});

test('a loop whose composer keeps its format is offered no promotion, and says why; its rules with a scope still reach their readers', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-rules-composed-'));
  const file = join(mkdtempSync(join(tmpdir(), 'jarl-rules-profile-')), 'profile.json');
  writeFileSync(file, JSON.stringify({ 'jarl-profile': 1, name: 'composed', statuses: BUILTIN_STATUSES, 'external-scheduler': 'the composer tick' }));
  jarl(root, 'init', 'a composed goal', '--profile', file);
  jarl(root, 'decide', 'standing', 'Reports name their branch.', '--applies-to', 'loop', '--by', 'coordinator');
  const out = json(root, 'close', '--batch');
  assert.deepEqual(out.promotion.items, []);
  assert.match(out.promotion.off, /1 rule\(s\) of the loop are not offered for promotion: a question of kind rule needs record format 3/);
  assert.match(refuses(root, 'ask', 'A rule.', '--kind', 'rule', '--applies-to', 'loop'), /a question of kind rule needs record format 3, and this loop stays at format 1/);
  assert.deepEqual(json(root, 'next', '--as', 'owner').rules.map((r) => r.slug), ['standing']);
});

test('a rule of two lines, written by decide or proposed and accepted, is printed whole in every view that prints rules', () => {
  const root = loop();
  jarl(root, 'new', 'work', '--acceptance', '[read] it works');
  jarl(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1', '--branch', 'jarl/1-work');
  jarl(root, 'decide', 'two-lines', 'First line of the rule.\nSecond line of the rule.', '--applies-to', 'loop', '--by', 'coordinator');
  const asked = json(root, 'ask', 'First line of the proposal.\nSecond line of the proposal.', '--kind', 'rule', '--applies-to', 'loop');
  jarl(root, 'answer', `a-${asked.id}`, 'yes', '--by', 'jarl');
  const whole = (text) => {
    assert.match(text, /- two-lines · loop · by coordinator — First line of the rule\.\n  Second line of the rule\./);
    assert.match(text, new RegExp(`- ask-${asked.id} · loop · by jarl — First line of the proposal\\.\\n  Second line of the proposal\\.(\\n|$)`));
  };
  for (const args of [['resume'], ['resume', '--as', 'w1'], ['next', '--as', 'w1'], ['next', '--as', 'jarl'], ['status', '--as', 'owner']]) whole(jarl(root, ...args));
  assert.equal(json(root, 'next', '--as', 'w1').rules.find((r) => r.slug === `ask-${asked.id}`).text, 'First line of the proposal.\nSecond line of the proposal.');
});

test('in a loop with no slice the jarl is the one coordinator and is given the coordinator\'s rules; with a slice it is not', () => {
  const root = loop();
  jarl(root, 'new', 'work', '--acceptance', '[read] it works');
  const coordinatorRules = (o) => slugs(o).filter((s) => s.startsWith('jarl:coordinator-'));
  assert.deepEqual(coordinatorRules(json(root, 'next', '--as', 'jarl')), ['jarl:coordinator-escalates', 'jarl:coordinator-pull-push', 'jarl:coordinator-scope-holds']);
  jarl(root, 'goal', '--set', 'Coordinators: odin');
  jarl(root, 'field', '1', 'Tags', '--add', 'slice:odin');
  assert.deepEqual(coordinatorRules(json(root, 'next', '--as', 'jarl')), []);
});

test('a plain close that removes the loop names no answer for the promotion questions that left with it', () => {
  const root = loop();
  jarl(root, 'decide', 'standing', 'Reports name their branch.', '--applies-to', 'loop', '--by', 'coordinator');
  const text = jarl(root, 'close');
  assert.match(text, /\n1 rule\(s\) of the loop were offered for promotion and left with it unanswered: close --batch offers them before the loop goes/);
  assert.doesNotMatch(text, /answer <a-id>|--option carry/);
});
