// The command surface: one command changes every part of an issue's description, with one grammar for setting, adding,
// removing and clearing; a command or a spelling the surface does not have is refused with one line that ends with the
// call that does it. A flag name means one thing across commands, and every flag a command takes is named below with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { jarl, refuses, loop as makeLoop, gitRepo, SKILL_DIR, SCRIPT, skillText } from './helpers.mjs';
import * as R from '../record.mjs';

const L = await import('../jarl-lib.mjs');
const mcp = await import('../jarl-mcp.mjs');
const J = await import('../jarl.mjs');

const PROFILE = { 'jarl-profile': 1, name: 'fielded', statuses: L.BUILTIN_STATUSES, fields: { Area: { enum: ['core', 'cli'] } }, sections: ['Design'] };
function fieldedLoop() {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-surface-profile-'));
  const file = join(dir, 'profile.json');
  writeFileSync(file, JSON.stringify(PROFILE));
  const root = makeLoop({ prefix: 'jarl-surface-', goal: 'a goal', via: 'cli', initFlags: ['--profile', file] });
  jarl(root, 'new', 'first', '--tier', 'light', '--field', 'Area=core', '--what', 'old what', '--acceptance', 'old line', '--section', 'Design=old design');
  jarl(root, 'new', 'second', '--tier', 'light');
  jarl(root, 'new', 'third', '--tier', 'light');
  return root;
}
const logLines = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8').split('\n').filter(Boolean).map((l) => l.replace(/^- \d{4}-\d{2}-\d{2} \d{2}:\d{2}(?: key \S+)?(?: by \S+)? · /, ''));
const lastLine = (root) => logLines(root).at(-1);
const issue = (root, id) => R.findIssue(root, id);

test('field writes every section of the description: a value replaces it, --add adds to it, --clear empties it', () => {
  const root = fieldedLoop();
  assert.equal(jarl(root, 'field', '1', 'What', 'new what', '--by', 'w-one'), '1 What: new what');
  assert.equal(lastLine(root), '1 body · what · was "old what" (8 characters) · by w-one', 'a section logs what it held, as every description change does');
  jarl(root, 'field', '1', 'what', 'more what', '--add');
  assert.equal(issue(root, '1').sections.what.trim(), 'new what\n\nmore what', 'a name is matched in any case, and --add puts a paragraph after the text');
  jarl(root, 'field', '1', 'Why', 'because');
  assert.equal(issue(root, '1').sections.why.trim(), 'because');
  jarl(root, 'field', '1', 'Acceptance', 'line a\nline b');
  assert.equal(issue(root, '1').sections.acceptance.trim(), '- line a\n- line b', 'Acceptance takes one item per line');
  jarl(root, 'field', '1', 'Acceptance', 'line c', '--add');
  assert.equal(issue(root, '1').sections.acceptance.trim(), '- line a\n- line b\n- line c', '--add gives the list a line');
  jarl(root, 'field', '1', 'Changelog', 'Fixed: one');
  jarl(root, 'field', '1', 'Changelog', 'Added: two', '--add');
  assert.equal(issue(root, '1').sections.changelog.trim(), '- Fixed: one\n- Added: two');
  jarl(root, 'field', '1', 'Design', 'more design', '--add');
  assert.equal(issue(root, '1').sections.design.trim(), 'old design\n\nmore design', 'a section the profile declares is a part like the others');
  jarl(root, 'field', '1', 'Why', '--clear');
  assert.equal((issue(root, '1').sections.why ?? '').trim(), '', '--clear empties a section');
  jarl(root, 'field', '1,2', 'What', 'shared what');
  assert.equal(issue(root, '2').sections.what.trim(), 'shared what', 'a list of ids takes the one value');
  assert.match(refuses(root, 'field', '1', 'What', 'x', '--remove'), /a section holds text, not items: write it whole with jarl\.mjs field <ids> What "<text>", or add to it with --add/);
});

test('field adds and removes the items of a list field, each issue keeping what it held, and logs the line a replacement logs', () => {
  const root = fieldedLoop();
  jarl(root, 'field', '1', 'Tags', 'a');
  jarl(root, 'field', '1,2', 'Tags', 'b,c', '--add', '--by', 'coord');
  assert.deepEqual(issue(root, '1').tags, ['a', 'b', 'c']);
  assert.deepEqual(issue(root, '2').tags, ['b', 'c'], 'each issue adds to its own list');
  assert.equal(lastLine(root), '2 field Tags · b, c · was (none) · by coord');
  jarl(root, 'field', '1,2', 'Tags', 'b', '--remove');
  assert.deepEqual(issue(root, '1').tags, ['a', 'c']);
  assert.deepEqual(issue(root, '2').tags, ['c']);
  jarl(root, 'field', '1', 'Files', 'src/a.mjs');
  jarl(root, 'field', '1', 'Files', 'src/b.mjs', '--add');
  assert.deepEqual(issue(root, '1').files, ['src/a.mjs', 'src/b.mjs']);
  jarl(root, 'field', '1', 'Files', 'src/a.mjs', '--remove');
  assert.deepEqual(issue(root, '1').files, ['src/b.mjs']);
  jarl(root, 'field', '1', 'After', '2', '--add');
  jarl(root, 'field', '1', 'After', '003', '--add');
  jarl(root, 'field', '1', 'After', '02,3', '--add');
  assert.deepEqual(issue(root, '1').after, ['2', '3'], 'an id held already, in any spelling, is not added again');
  jarl(root, 'field', '1', 'After', '2,3', '--remove');
  assert.deepEqual(issue(root, '1').after, [], 'a list emptied by --remove is emptied as --clear empties it');
  assert.equal(lastLine(root), '1 field After · (cleared) · was 2, 3');
  jarl(root, 'field', '1', 'Source', 'r/x#1', '--add');
  jarl(root, 'field', '1', 'Source', 'r/x#2', '--add');
  assert.deepEqual(issue(root, '1').sources, ['r/x#1', 'r/x#2']);
  jarl(root, 'field', '1', 'Resources', 'gate', '--add');
  jarl(root, 'field', '1', 'Resources', 'db', '--add');
  jarl(root, 'field', '1', 'Resources', 'DB', '--add');
  assert.deepEqual(issue(root, '1').resources, ['gate', 'db'], 'a resource held already, in another case, is not added again');
  jarl(root, 'field', '1', 'Resources', 'GATE', '--remove');
  assert.deepEqual(issue(root, '1').resources, ['db'], 'a resource is one name in any case');
  const count = logLines(root).length;
  jarl(root, 'field', '1', 'Tags', 'a', '--add');
  jarl(root, 'field', '1', 'Tags', 'zzz', '--remove');
  assert.equal(logLines(root).length, count, 'an item held already, or not held at all, writes nothing');
  assert.match(refuses(root, 'field', '1', 'Priority', '1', '--add'), /^Priority holds one value, so it is replaced, never added to or taken from; .*\njarl\.mjs field 1 Priority 1\n$/);
  assert.match(refuses(root, 'field', '1', 'Tags', 'a', '--add', '--clear'), /field takes one of --add, --remove and --clear, not --add and --clear/);
  assert.match(refuses(root, 'field', '1', 'Tags', '--add'), /^field Tags needs a value, or --clear to empty it\njarl\.mjs field 1 Tags '<value>' --add\n$/);
});

test('a slice: tag keeps its one-slice rule through --add, and the refusal is the two calls that move the issue', () => {
  const root = fieldedLoop();
  jarl(root, 'field', '1', 'Tags', 'slice:odin', '--add');
  const said = refuses(root, 'field', '1', 'Tags', 'slice:thor', '--add');
  assert.match(said, /1 is in slice:odin already, and an issue is in one slice — to move it: jarl\.mjs field 1 Tags --remove slice:odin, then jarl\.mjs field 1 Tags --add slice:thor/);
  jarl(root, 'field', '1', 'Tags', 'slice:odin', '--remove');
  jarl(root, 'field', '1', 'Tags', 'slice:thor', '--add');
  assert.deepEqual(issue(root, '1').tags, ['slice:thor']);
});

test('field adds a repository to Repo and takes it off by its name', () => {
  const root = makeLoop({ prefix: 'jarl-surface-repo-', via: 'cli' });
  jarl(root, 'new', 'one', '--tier', 'light');
  const a = gitRepo({ prefix: 'jarl-surface-a-' });
  const b = gitRepo({ prefix: 'jarl-surface-b-' });
  jarl(root, 'field', '1', 'Repo', a.dir);
  jarl(root, 'field', '1', 'Repo', b.dir, '--add');
  assert.equal(issue(root, '1').fields.repo.split(', ').length, 2);
  jarl(root, 'field', '1', 'Repo', a.dir, '--add');
  jarl(root, 'field', '1', 'Repo', `${b.dir}/a.txt`, '--add');
  assert.equal(issue(root, '1').fields.repo.split(', ').length, 2, 'a repository held already, by its path or a file inside it, is not added again');
  const [first, second] = issue(root, '1').fields.repo.split(', ');
  jarl(root, 'field', '1', 'Repo', a.dir, '--remove');
  assert.equal(issue(root, '1').fields.repo, second, 'the repository given by its path is taken off as it is stored');
  assert.notEqual(first, second);
});

test('the commands that wrote one part each are refused with the reason, then on its own line the field call doing what was asked', () => {
  const root = fieldedLoop();
  const cases = [
    [['prio', '1', '3'], 'prio is not a command; the priority is a field\njarl.mjs field 1 Priority 3'],
    [['tag', '1', '+a', '-b'], 'tag is not a command; tags are a field\njarl.mjs field 1 Tags --remove b && jarl.mjs field 1 Tags --add a'],
    [['files', '1', 'a.mjs', 'b.mjs'], 'files is not a command; the files are a field\njarl.mjs field 1 Files a.mjs,b.mjs'],
    [['source', '1', 'r/x#1'], 'source is not a command; the source is a field\njarl.mjs field 1 Source r/x#1'],
    [['after', '1', '2'], 'after is not a command; the issues an issue waits on are a field\njarl.mjs field 1 After 2'],
    [['after', '1', '--clear'], 'after is not a command; the issues an issue waits on are a field\njarl.mjs field 1 After --clear'],
    [['repo', '1', '--clear'], 'repo is not a command; the repository is a field\njarl.mjs field 1 Repo --clear'],
    [['repo', '--base', 'tool', 'main'], "repo is not a command; a repository's base is changed by base\njarl.mjs base tool main"],
    [['body', '1', '--why', 'a reason', '--acceptance', 'a line', '--append'], "body is not a command; every part of the description is written by field, one call per part\njarl.mjs field 1 Why 'a reason' --add && jarl.mjs field 1 Acceptance 'a line' --add"],
  ];
  for (const [args, line] of cases) {
    const said = refuses(root, ...args);
    assert.equal(said.trim(), line, args.join(' '));
    assert.equal(said.trim().split('\n').length, 2, `${args[0]}: the reason and the ready line`);
  }
  assert.equal(issue(root, '1').priority, '2', 'a refused call writes nothing');
  const tool = mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'jarl_prio', arguments: { root } } });
  assert.match(tool.error.message, /^Unknown tool: jarl_prio — prio is not a command; the priority is a field\njarl\.mjs field '<ids>' Priority '<1\|2\|3>'$/);
});

test('set takes statuses only: a field given to it is refused with the field call that writes it', () => {
  const root = fieldedLoop();
  assert.equal(refuses(root, 'set', '1', 'Area', 'cli').trim(), 'Area is a field, not a status\njarl.mjs field 1 Area cli');
  assert.equal(refuses(root, 'set', '1', 'resources', 'gate, db').trim(), "resources is a field, not a status\njarl.mjs field 1 resources 'gate, db'");
  assert.equal(issue(root, '1').fields.area, 'core');
});

test('base is the command that changes the base branch of a declared repository', () => {
  const root = makeLoop({ prefix: 'jarl-surface-base-', via: 'cli' });
  assert.match(refuses(root, 'base', 'nothing-here', 'main'), /nothing-here is not declared in this loop/);
  assert.match(refuses(root, 'base', 'nothing-here'), /^base takes a repository name and a branch\njarl\.mjs base nothing-here '<branch>'\n$/);
});

// Every flag of the command table with the one thing it means, and the commands that take it. A flag added to a command,
// or a name given a second meaning, fails here until it is written down: the name keeps its meaning, or gets another name.
const FLAG_MEANINGS = {
  by: ['the author of the write: who wrote, changed, reviewed, answered, ruled, retracted or ticked', 'every command that writes'],
  group: ['the counts grouped by repository, tag, kind, priority or a field', ['status', 'models']],
  kind: ['the kind of the thing the command files or filters: an issue kind, a question kind', ['new', 'import', 'list', 'ask']],
  committed: ['the loop committed with the work', ['init']], permanent: ['the loop kept as a standing record', ['init']], profile: ['the profile file a loop opens with', ['init']],
  key: ['the key of one issue file', ['renumber']],
  prio: ['the priority of an issue', ['new', 'import', 'list']], tier: ['the tier of an issue', ['new', 'import']], tags: ['the tags of an issue', ['new', 'import']],
  files: ['the files an issue touches', ['new']], repo: ['a repository, by its name or its path', ['new', 'import', 'scope', 'branches', 'merged', 'resume', 'changelog']],
  'found-by': ['who found an issue', ['new', 'import']], where: ['the Where of an issue', ['new']], what: ['the What of an issue', ['new']], why: ['the Why of an issue', ['new']],
  acceptance: ['an acceptance line of an issue', ['new']], source: ['the research a finding comes from', ['new', 'import', 'sources']], after: ['the issues an issue waits on', ['new']],
  changelog: ['a changelog entry of an issue', ['new']], template: ['the template an issue starts from', ['new']], field: ['a profile field and its value, Name=value', ['new', 'import']],
  section: ['a profile section and its text, Heading=text', ['new']], person: ['the outside person a wait is held by', ['new']], 'check-when': ['when to check a wait', ['new']],
  only: ['the findings to file', ['import']], adopt: ['a Source written onto an issue that names the finding', ['import']], 'dry-run': ['what would be filed, nothing written', ['import']],
  ran: ['a command that ran', ['evidence', 'merged']], saw: ['what the command printed', ['evidence', 'merged']], file: ['the file of an attachment', ['evidence']], slot: ['the slot of an attachment', ['evidence']],
  add: ['add to a part of the description', ['field']], remove: ['take items off a part of the description', ['field']], clear: ['empty a part of the description', ['field']],
  status: ['the status the list keeps', ['list']], tag: ['the tag the view keeps', ['list', 'status']], grep: ['the text the list keeps', ['list']], match: ['a field value the list keeps', ['list']],
  all: ['every row, not only the first or the unfinished', ['list', 'next']], full: ['the whole issue file', ['show']],
  branch: ['a branch: the lease\'s, or the one measured', ['set', 'scope']], worker: ['the worker of a lease', ['set']], model: ['the model the agent was raised on', ['set', 'review']],
  worktree: ['the worktree a lease is checked against', ['set']], handover: ['a lease handed to a new worker', ['set']], header: ['the header rewritten from the log', ['set']],
  limit: ['how many ready issues', ['next']], as: ['the holder whose list is asked for', ['next', 'resume', 'status']], slice: ['a coordinator\'s slice', ['next', 'ask', 'resume', 'status']],
  relayed: ['a verdict recorded in the reviewer\'s name', ['review']], findings: ['how many findings a red round left', ['round']], with: ['another loop to read', ['models']], archives: ['this loop\'s archives read too', ['models']],
  base: ['the base branch a branch is held against', ['scope', 'branches', 'resume']], 'stale-hours': ['how long a lease may idle', ['branches', 'status']],
  sha: ['the merge commit', ['merged']], ci: ['the CI state of a merge', ['merged']], gh: ['the CI of each tip asked of gh', ['resume', 'handoff']], red: ['the issue a red landing is tracked by', ['merged']], keep: ['the worktree and branch kept', ['merged']],
  target: ['what a lower question weakens', ['ask']], issue: ['the issue a question is about', ['ask']], option: ['an option of a question', ['ask', 'answer']],
  'applies-to': ['whom a rule applies to', ['ask', 'decide']], until: ['when a rule ends', ['ask', 'decide']], to: ['who a rule is proposed to', ['ask']],
  log: ['how many log lines', ['resume', 'handoff']], ready: ['how many ready issues', ['resume', 'handoff']], summary: ['a summary, written nowhere', ['handoff']], next: ['a next step, written nowhere', ['handoff']],
  settles: ['the issues a ruling settles', ['decide']], quote: ['the owner\'s own words', ['decide']], under: ['the ruling a ruling rests on', ['decide']], supersedes: ['the ruling a ruling replaces', ['decide']],
  area: ['the type of code a ruling reaches', ['decide']], reach: ['how many files that type holds', ['decide']], rule: ['the graph rule a ruling admits', ['decide']],
  live: ['only the rulings in force', ['decisions']], set: ['a machine line of the goal', ['goal']], found: ['the issues found by others', ['report']], metrics: ['the metrics alone', ['report']],
  force: ['close with work left', ['close']], batch: ['the ratification batch alone', ['close']],
};

test('a flag name means one thing across commands: --by names the author on every write and only there, grouping is --group, --kind the kind of what is filed or filtered', () => {
  const { COMMAND_FLAGS, MUTATING } = J;
  const takers = {};
  for (const [cmd, flags] of Object.entries(COMMAND_FLAGS)) for (const name of Object.keys(flags)) (takers[name] = takers[name] || []).push(cmd);
  assert.deepEqual(Object.keys(takers).sort(), Object.keys(FLAG_MEANINGS).sort(), 'every flag of the table has one meaning written down, and no meaning names a flag the table lacks');
  for (const [name, [, commands]] of Object.entries(FLAG_MEANINGS)) {
    const want = commands === 'every command that writes' ? [...MUTATING] : commands;
    assert.deepEqual([...takers[name]].sort(), [...want].sort(), `--${name}: ${FLAG_MEANINGS[name][0]}`);
  }
  for (const cmd of MUTATING) assert.equal(COMMAND_FLAGS[cmd].by, 'value', `${cmd} writes, so it takes --by`);
  assert.ok(!['status', 'models'].some((c) => MUTATING.has(c)), 'the grouping views write nothing');
  // One name, one shape: a flag that takes a value on one command takes one on every command, and a switch is a switch.
  const shapes = {};
  for (const flags of Object.values(COMMAND_FLAGS)) for (const [name, shape] of Object.entries(flags)) (shapes[name] = shapes[name] || new Set()).add(shape === 'bool' ? 'switch' : 'value');
  assert.deepEqual(Object.entries(shapes).filter(([, s]) => s.size > 1).map(([n]) => n), [], 'no flag is a switch on one command and takes a value on another');
  const switched = { ...COMMAND_FLAGS, list: { ...COMMAND_FLAGS.list, kind: 'bool' } };
  const seen = {};
  for (const flags of Object.values(switched)) for (const [name, shape] of Object.entries(flags)) (seen[name] = seen[name] || new Set()).add(shape === 'bool' ? 'switch' : 'value');
  assert.equal(seen.kind.size, 2, 'the check sees list --kind turned into a switch');
});

test('the tools that record a judgement require and describe by, the author: answer, decide, review, retract and tick', () => {
  const tools = Object.fromEntries(mcp.buildTools().map((t) => [t.name, t]));
  for (const cmd of ['answer', 'decide', 'review', 'retract', 'tick']) {
    const t = tools[mcp.toolName(cmd)];
    assert.ok(t.inputSchema.required.includes('by'), `${cmd} requires by`);
    assert.match(t.inputSchema.properties.by.description, /^Required: who /, `${cmd} describes by`);
  }
  assert.doesNotMatch(tools.jarl_answer.description, /the owner's answer/);
  assert.ok(!tools.jarl_new.inputSchema.required?.includes('by'), 'a write that records no judgement takes by as an option');
});

test('status and models group with --group; --by on them is refused with the call that groups', () => {
  const root = fieldedLoop();
  jarl(root, 'field', '1', 'Tags', 'docs');
  assert.match(jarl(root, 'status', '--group', 'tag'), /by tag:\n {2}\(none\) .*\n {2}docs /);
  assert.equal(JSON.parse(jarl(root, 'status', '--group', 'kind', '--json')).by.key, 'kind');
  assert.equal(refuses(root, 'status', '--by', 'repo').trim(), 'status groups its counts with --group, and --by names the author of a write\njarl.mjs status --group repo');
  assert.equal(refuses(root, 'models', '--by', 'tag').trim(), 'models groups its counts with --group, and --by names the author of a write\njarl.mjs models --group tag');
  assert.match(refuses(root, 'status', '--group', 'colour'), /^--group is one of: repo, tag, kind, prio, area \(got "colour"\)\njarl\.mjs status --group repo\n$/);
  assert.equal(JSON.parse(jarl(root, 'models', '--group', 'tag', '--json')).by, 'tag');
});

test('a verdict and an evidence row are taken back by retract alone; the other spellings and the second name of scope are refused with the call to use', () => {
  const root = fieldedLoop();
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'ok');
  assert.equal(refuses(root, 'evidence', '1', '--retract', '1', '--by', 'jarl', 'wrong row').trim(), "evidence takes nothing back: a row or a note is taken back with retract\njarl.mjs retract 1 1 'wrong row' --by jarl");
  assert.equal(refuses(root, 'review', '1', 'retract', '--by', 'jarl', 'wrong verdict').trim(), "a verdict is taken back with retract\njarl.mjs retract 1 review 'wrong verdict' --by jarl");
  assert.equal(refuses(root, 'check', '1', '--branch', 'jarl/1-a').trim(), 'check is not a command; a branch is measured by scope\njarl.mjs scope 1 --branch jarl/1-a');
  assert.equal(mcp.buildTools().some((t) => t.name === 'jarl_check'), false, 'no tool answers to a second name');
  assert.equal(mcp.buildTools().find((t) => t.name === 'jarl_evidence').inputSchema.properties.retract, undefined);
});

// The commands that take free text: a note, a reason, findings, a question, an answer, a ruling.
const FREE_TEXT = ['evidence', 'retract', 'set', 'review', 'round', 'ask', 'answer', 'log', 'decide'];

test('free text has one name, text, in every tool, and one place in every command: its last argument', () => {
  const { COMMAND_ARGS, USAGE } = J;
  const blocks = mcp.usageBlocks(USAGE);
  const tools = Object.fromEntries(mcp.buildTools().map((t) => [t.name, t.inputSchema.properties]));
  for (const cmd of FREE_TEXT) {
    assert.match(COMMAND_ARGS[cmd].at(-1), /^text\??$/, `${cmd}: the free text is its last argument, named text`);
    assert.ok(tools[mcp.toolName(cmd)].text, `${cmd}: the tool's field is text`);
    // The arguments of the form that takes text: its words without the options in brackets and the flags with their values.
    const form = blocks[cmd].synopsis.split(' | ').find((f) => f.includes('"<text>"'));
    let bare = form ?? '';
    while (/\[[^[\]]*\]/.test(bare)) bare = bare.replace(/\[[^[\]]*\](?:\.\.\.)?/g, ' ');
    const args = bare.replace(/--[a-z-]+(?: (?:"[^"]*"|<[^>]*>|[a-z|]+(?=\s|$)))?/g, ' ').trim();
    assert.ok(args?.endsWith('"<text>"'), `${cmd}: the usage writes "<text>" last among its arguments: ${blocks[cmd].synopsis}`);
  }
  const names = Object.values(COMMAND_ARGS).flat().map((a) => a.replace(/[?.]+$/, ''));
  for (const old of ['why', 'findings', 'what', 'question', 'answer', 'ruling', 'event', 'reason']) assert.ok(!names.includes(old), `no argument is named ${old}`);
});

test('a tool call writes its free text through the field text', () => {
  const root = fieldedLoop();
  const call = (name, input) => { const r = mcp.callTool(`jarl_${name}`, { ...input, root }); assert.equal(r.isError, false, `${name}: ${r.content[0].text}`); return r; };
  call('evidence', { ids: '1', text: 'a note' });
  call('round', { id: '1', text: 'the check failed' });
  call('set', { ids: '2', status: 'deferred', text: 'later' });
  call('log', { text: 'an event' });
  call('ask', { text: 'which way?', kind: 'ratify' });
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /an event/);
  assert.match(R.findIssue(root, '2').sections.evidence, /Deferred: later/);
});

test('every write that records a judgement names its author: review, answer, decide, retract and tick refuse a call without --by, with the call that names one', () => {
  const root = fieldedLoop();
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'ok');
  jarl(root, 'ask', 'which way?');
  const before = readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
  assert.match(refuses(root, 'review', '1', 'approve', 'read the diff, nothing found'), /a verdict needs --by <reviewer>/);
  assert.equal(refuses(root, 'answer', 'a-1', 'this way').trim(), "answer records who answered, owner for the owner\njarl.mjs answer a-1 'this way' --by '<who>'");
  assert.equal(refuses(root, 'decide', 'the-way', 'we go this way').trim(), 'decide records who ruled, jarl under a mandate, owner with --quote "<his words>"\njarl.mjs decide the-way \'we go this way\' --by \'<who>\'');
  assert.match(refuses(root, 'retract', '1', '1', 'the row was wrong'), /needs --by <who>/);
  assert.match(refuses(root, 'tick', '1', '1'), /--by owner/);
  assert.equal(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), before, 'nothing was written');
  jarl(root, 'answer', 'a-1', 'this way', '--by', 'owner');
  jarl(root, 'decide', 'the-way', 'we go this way', '--by', 'jarl');
  assert.match(jarl(root, 'decisions'), /the-way · by jarl/);
});

// The walk of the wrong calls of every writing command, and the check that each refusal ends with a ready command, are in
// refusals.test.mjs.

test('the help gives each read-only view one purpose, on one line of its own', () => {
  const { USAGE, COMMAND_FLAGS, MUTATING, INTERNAL_COMMANDS } = J;
  const lines = USAGE.split('\n');
  const at = lines.findIndex((l) => /^views, one purpose each/.test(l));
  assert.ok(at > 0, 'the help has the views section');
  const section = [];
  for (const l of lines.slice(at + 1)) { if (!/^ {2}\S/.test(l)) break; section.push(l); }
  const named = section.map((l) => /^ {2}([a-z]+) {2,}\S/.exec(l)?.[1]);
  const views = Object.keys(COMMAND_FLAGS).filter((c) => !MUTATING.has(c) && !INTERNAL_COMMANDS.includes(c));
  assert.deepEqual([...named].sort(), [...views].sort(), 'one line for each read-only view, and no other');
});

test('the tips and the merge queue are sections of resume: --repo narrows both, --base sets the queue\'s base, --gh asks for the tips\' CI; tips and queue are refused with the resume call', () => {
  const { dir } = gitRepo({ prefix: 'jarl-surface-fold-' });
  const other = gitRepo({ prefix: 'jarl-surface-fold-other-' });
  jarl(dir, 'init', 'goal');
  jarl(dir, 'new', 'elsewhere', '--tier', 'light', '--repo', other.dir);
  const all = JSON.parse(jarl(dir, 'resume', '--json'));
  assert.equal(all.tips.repos.length, 2, 'the tips of the loop\'s repository and of the one an issue names');
  assert.equal(all.queue.repos.length, 2);
  assert.equal(all.tips.ci, false, 'no network unless --gh');
  const narrowed = JSON.parse(jarl(dir, 'resume', '--repo', other.dir, '--base', 'main', '--gh', '--json'));
  const name = basename(other.dir);
  assert.deepEqual(narrowed.tips.repos.map((r) => r.repo), [name]);
  assert.deepEqual(narrowed.queue.repos.map((r) => [r.repo, r.base]), [[name, 'main']]);
  assert.equal(narrowed.tips.ci, true);
  assert.equal(refuses(dir, 'tips').trim(), 'tips is not a command; the tips are a section of resume, which asks gh for their CI with --gh\njarl.mjs resume --gh');
  assert.equal(refuses(dir, 'queue', '--repo', 'tool', '--base', 'release').trim(), 'queue is not a command; the merge queue is a section of resume, its batches included\njarl.mjs resume --repo tool --base release');
  assert.equal(mcp.buildTools().some((t) => ['jarl_tips', 'jarl_queue'].includes(t.name)), false);
});

// The calls a refusal ends with, as a shell would be given them: its last line, one call per &&.
const callsOf = (said) => said.trim().split('\n').at(-1).split(' && ');
// One printed call run through a POSIX shell against the loop, the script standing where jarl.mjs stands; --root goes
// before the command, where it is read even when the call ends with a bare -- and its arguments.
function runPrinted(root, call, fill = {}) {
  let line = call;
  for (const [from, to] of Object.entries(fill)) line = line.split(from).join(to);
  const r = spawnSync('/bin/sh', ['-c', `"$JARL_NODE" "$JARL_SCRIPT" --root "$JARL_LOOP" ${line.slice('jarl.mjs '.length)}`], { encoding: 'utf8', env: { ...process.env, JARL_NODE: process.execPath, JARL_SCRIPT: SCRIPT, JARL_LOOP: root, HOME: '/home-not-expanded' }, timeout: 120000 });
  assert.equal(r.status, 0, `${line}\n${r.stderr}`);
}
const sectionsOf = (root, id) => { const i = R.findIssue(root, id); return { what: i.sections.what, why: i.sections.why, acceptance: i.sections.acceptance, changelog: i.sections.changelog, tags: i.tags, priority: i.priority }; };
const tail = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8').split('\n').filter(Boolean).slice(-4).map((l) => l.replace(/^- \d{4}-\d{2}-\d{2} \d{2}:\d{2}(?: key \S+)? · /, ''));

test('a printed call, run through a shell, writes what the refused call meant: $, backticks, quotes and newlines pass as they were given', () => {
  const nasty = ['a $HOME and $(echo run) and `echo run`', "it's \"quoted\"", 'two\nlines'];
  // The refused call on one loop; the calls it prints, run by a shell, on that loop; the same intent written by field on another.
  const viaPrinted = fieldedLoop();
  const viaField = fieldedLoop();
  const said = refuses(viaPrinted, 'body', '1', '--what', nasty.join(' / '), '--why', nasty[2], '--acceptance', nasty[0], '--acceptance', nasty[1], '--changelog', `Fixed: ${nasty[0]}`, '--by', "w-1's");
  assert.equal(callsOf(said).length, 5, 'one call per part, and one per acceptance line');
  for (const call of callsOf(said)) runPrinted(viaPrinted, call);
  jarl(viaField, 'field', '1', 'What', nasty.join(' / '), '--by', "w-1's");
  jarl(viaField, 'field', '1', 'Why', nasty[2], '--by', "w-1's");
  jarl(viaField, 'field', '1', 'Acceptance', `${nasty[0]}\n${nasty[1]}`, '--by', "w-1's");
  jarl(viaField, 'field', '1', 'Changelog', `Fixed: ${nasty[0]}`, '--by', "w-1's");
  assert.deepEqual(sectionsOf(viaPrinted, '1'), sectionsOf(viaField, '1'));
  assert.equal(R.findIssue(viaPrinted, '1').sections.acceptance.trim().split('\n').length, 2, 'two acceptance lines, not one holding a \\n');
  assert.match(tail(viaPrinted).join('\n'), /by w-1∙?'s|by w-1's/);
  // Tags, Priority and an answer and a ruling: the printed call carries --by and the text as given.
  const t = fieldedLoop();
  for (const call of callsOf(refuses(t, 'tag', '1', '+a$b', '-none', '--by', 'w2'))) runPrinted(t, call);
  for (const call of callsOf(refuses(t, 'prio', '1', '3', '--by', 'w2'))) runPrinted(t, call);
  assert.deepEqual([R.findIssue(t, '1').tags, R.findIssue(t, '1').priority], [['a$b'], '3']);
  assert.match(tail(t).join('\n'), /1 field Priority · 3 · was 2 · by w2/);
  jarl(t, 'ask', 'which?');
  for (const call of callsOf(refuses(t, 'answer', 'a-1', nasty[0]))) runPrinted(t, call, { '<who>': 'owner' });
  for (const call of callsOf(refuses(t, 'decide', 'the-way', nasty[1], '--settles', '1'))) runPrinted(t, call, { '<who>': 'jarl' });
  const rulings = readFileSync(join(t, '.jarl', 'decisions.md'), 'utf8');
  assert.ok(rulings.includes(nasty[0]) && rulings.includes(nasty[1]), 'the answer and the ruling hold the text as written');
  assert.match(R.findIssue(t, '1').sections.evidence, /Ruling the-way \(by jarl\)/, '--settles was carried');
});

test('a replacing call carries every word the caller gave: --by, the reason of a retraction, the filters of status, and Files emptied as --clear', () => {
  const root = fieldedLoop();
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'ok');
  assert.equal(refuses(root, 'evidence', '1', '--retract', '1', '--by', 'rev', 'ran on the wrong tree').trim(), "evidence takes nothing back: a row or a note is taken back with retract\njarl.mjs retract 1 1 'ran on the wrong tree' --by rev");
  assert.equal(refuses(root, 'status', '--by', 'tag', '--tag', 'docs').trim(), 'status groups its counts with --group, and --by names the author of a write\njarl.mjs status --group tag --tag docs');
  assert.equal(refuses(root, 'files', '1', '').trim(), 'files is not a command; the files are a field\njarl.mjs field 1 Files --clear');
  assert.equal(refuses(root, 'prio', '1', '3', '--by', 'w2').trim(), 'prio is not a command; the priority is a field\njarl.mjs field 1 Priority 3 --by w2');
  assert.equal(refuses(root, 'set', '1', 'Area', 'cli', '--by', 'w2').trim(), 'Area is a field, not a status\njarl.mjs field 1 Area cli --by w2');
  assert.equal(refuses(root, 'body', '1', '--title', 'new title', '--by', 'w2').trim(), "body is not a command; every part of the description is written by field, one call per part\njarl.mjs field 1 Title 'new title' --by w2");
  for (const call of callsOf(refuses(root, 'evidence', '1', '--retract', '1', '--by', 'rev', 'ran on the wrong tree'))) runPrinted(root, call);
  assert.match(R.findIssue(root, '1').sections.evidence, /~~\*\*ran:\*\* npm test/);
});

// A command the surface does not have, written as a command: in code quotes with an argument after it, as a call of the
// script or of a tool, or a flag in a spelling the surface refuses. A JSON key in quotes (`after`, `check`), a selector of a
// rule (`tag <tag>`, `files <path>`) and a word of a sentence are not commands, and do not match.
const GONE = 'body|tag|prio|files|repo|source|after|tips|queue|check|handoff';
// The names free text had in a tool before it was text, as a field of a tool call or a placeholder of a command.
const OLD_TEXT_NAMES = 'findings|why|question|ruling|answer|event|reason|what';
// A call of answer or decide, in code quotes or after jarl.mjs, that names no author.
const UNAUTHORED = /(?:`|jarl\.mjs )((?:answer|decide) [^`]*?)(?:`|$)/g;
const STALE = [
  new RegExp(`\`(?:${GONE}) (?:<ids?>|\\d|--|\\+|-[a-z]|"|')`),
  new RegExp(`\\bjarl\\.mjs (?:${GONE})\\b`),
  new RegExp(`\\bjarl_(?:${GONE})\\b`),
  /\b(?:status|models) [^`|]*--by\b/, /\bevidence [^`|]*--retract\b/, /\breview <ids?> retract\b/,
  /\bresume [^`|]*--ci\b/,
  new RegExp(`\\b(?:${OLD_TEXT_NAMES}): "`),
  new RegExp(`"<(?:${OLD_TEXT_NAMES})>"`),
  // A call with its id or slug (not a flag named alone, not an elided …) and words after it.
  { test: (line) => [...line.matchAll(UNAUTHORED)].some((m) => /^(?:answer|decide) (?!-|…)\S+ \S/.test(m[1]) && !/--by\b/.test(m[1])) },
];
function staleHits(texts) {
  const hits = [];
  for (const [name, text] of texts) {
    text.split('\n').forEach((line, i) => { for (const re of STALE) if (re.test(line)) hits.push(`${name}:${i + 1}: ${line.slice(0, 160)}`); });
  }
  return hits;
}
test('SKILL.md, the references, the help, the tool descriptions and the server instructions use no command or flag the surface refuses', () => {
  const init = mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  const texts = [
    ...['SKILL.md', ...readdirSync(join(SKILL_DIR, 'references')).map((f) => `references/${f}`)].map((f) => [f, skillText(f)]),
    ['the help', J.USAGE], ['the tool descriptions', mcp.buildTools().map((t) => t.description).join('\n')], ['the server instructions', init.result.instructions],
  ];
  assert.deepEqual(staleHits(texts), []);
  // Each form, planted in SKILL.md, turns the check red: the check reads the texts it is for, and fires on each form.
  const planted = [
    'run `tag 7 +a` first', 'jarl.mjs prio 7 1', 'jarl_body { id: "7" }', '`status --by repo`', 'resume asks gh with `resume --ci`',
    'jarl_review { ids: "1", verdict: "approve", findings: "read it" }', 'jarl_set { ids: "1", status: "deferred", why: "later" }', 'jarl_ask { question: "which?" }',
    'jarl_decide { slug: "s", ruling: "r" }', 'jarl_answer { id: "a-1", answer: "yes" }', 'jarl_log { event: "x" }', 'jarl_retract { reason: "x" }', 'jarl_evidence { what: "x" }',
    '`jarl.mjs answer a-1 "yes"`', '`decide the-way "we go"`', 'jarl.mjs round 1 "<why>"', 'jarl.mjs review 1 approve --by r "<findings>"',
  ];
  for (const line of planted) assert.equal(staleHits([['SKILL.md', `${texts[0][1]}\n${line}`]]).length, 1, line);
  for (const line of ['`jarl.mjs answer a-1 "yes" --by owner`', '`decide the-way "we go" --by jarl`', '`answer` records who answered']) assert.deepEqual(staleHits([['x', line]]), [], line);
});
