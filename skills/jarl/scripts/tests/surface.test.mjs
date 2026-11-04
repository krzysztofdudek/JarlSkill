// The command surface: one command changes every part of an issue's description, with one grammar for setting, adding,
// removing and clearing; a command or a spelling the surface does not have is refused with one line that ends with the
// call that does it. A flag name means one thing across commands, and every flag a command takes is named below with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jarl, refuses, loop as makeLoop, gitRepo } from './helpers.mjs';
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
  assert.deepEqual(issue(root, '1').after, ['2', '3']);
  jarl(root, 'field', '1', 'After', '2,3', '--remove');
  assert.deepEqual(issue(root, '1').after, [], 'a list emptied by --remove is emptied as --clear empties it');
  assert.equal(lastLine(root), '1 field After · (cleared) · was 2, 3');
  jarl(root, 'field', '1', 'Source', 'r/x#1', '--add');
  jarl(root, 'field', '1', 'Source', 'r/x#2', '--add');
  assert.deepEqual(issue(root, '1').sources, ['r/x#1', 'r/x#2']);
  jarl(root, 'field', '1', 'Resources', 'gate', '--add');
  jarl(root, 'field', '1', 'Resources', 'db', '--add');
  jarl(root, 'field', '1', 'Resources', 'GATE', '--remove');
  assert.deepEqual(issue(root, '1').resources, ['db'], 'a resource is one name in any case');
  const count = logLines(root).length;
  jarl(root, 'field', '1', 'Tags', 'a', '--add');
  jarl(root, 'field', '1', 'Tags', 'zzz', '--remove');
  assert.equal(logLines(root).length, count, 'an item held already, or not held at all, writes nothing');
  assert.match(refuses(root, 'field', '1', 'Priority', '1', '--add'), /Priority holds one value, so it is replaced, never added to or taken from: jarl\.mjs field <ids> Priority "<value>"/);
  assert.match(refuses(root, 'field', '1', 'Tags', 'a', '--add', '--clear'), /field takes one of --add, --remove and --clear, not --add and --clear/);
  assert.match(refuses(root, 'field', '1', 'Tags', '--add'), /field Tags needs a value: jarl\.mjs field <ids> Tags "<value>"/);
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
  const [first, second] = issue(root, '1').fields.repo.split(', ');
  jarl(root, 'field', '1', 'Repo', a.dir, '--remove');
  assert.equal(issue(root, '1').fields.repo, second, 'the repository given by its path is taken off as it is stored');
  assert.notEqual(first, second);
});

test('the commands that wrote one part each are refused with one line that ends with the field call doing what was asked', () => {
  const root = fieldedLoop();
  const cases = [
    [['prio', '1', '3'], 'prio is not a command; the priority is a field: jarl.mjs field 1 Priority 3'],
    [['tag', '1', '+a', '-b'], 'tag is not a command; tags are a field: jarl.mjs field 1 Tags --remove b, then jarl.mjs field 1 Tags --add a'],
    [['files', '1', 'a.mjs', 'b.mjs'], 'files is not a command; the files are a field: jarl.mjs field 1 Files a.mjs,b.mjs'],
    [['source', '1', 'r/x#1'], 'source is not a command; the source is a field: jarl.mjs field 1 Source r/x#1'],
    [['after', '1', '2'], 'after is not a command; the issues an issue waits on are a field: jarl.mjs field 1 After 2'],
    [['after', '1', '--clear'], 'after is not a command; the issues an issue waits on are a field: jarl.mjs field 1 After --clear'],
    [['repo', '1', '--clear'], 'repo is not a command; the repository is a field: jarl.mjs field 1 Repo --clear'],
    [['repo', '--base', 'tool', 'main'], "repo is not a command; a repository's base is changed by base: jarl.mjs base tool main"],
    [['body', '1', '--why', 'a reason', '--acceptance', 'a line', '--append'], 'body is not a command; every part of the description is written by field: jarl.mjs field 1 Why "a reason" --add, then jarl.mjs field 1 Acceptance "a line" --add'],
  ];
  for (const [args, line] of cases) {
    const said = refuses(root, ...args);
    assert.equal(said.trim(), line, args.join(' '));
    assert.equal(said.trim().split('\n').length, 1, `${args[0]}: one line`);
  }
  assert.equal(issue(root, '1').priority, '2', 'a refused call writes nothing');
  const tool = mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'jarl_prio', arguments: { root } } });
  assert.match(tool.error.message, /^Unknown tool: jarl_prio — prio is not a command; the priority is a field: jarl\.mjs field <ids> Priority <1\|2\|3>$/);
});

test('set takes statuses only: a field given to it is refused with the field call that writes it', () => {
  const root = fieldedLoop();
  assert.equal(refuses(root, 'set', '1', 'Area', 'cli').trim(), 'Area is a field, not a status: jarl.mjs field 1 Area cli');
  assert.equal(refuses(root, 'set', '1', 'resources', 'gate, db').trim(), 'resources is a field, not a status: jarl.mjs field 1 resources "gate, db"');
  assert.equal(issue(root, '1').fields.area, 'core');
});

test('base is the command that changes the base branch of a declared repository', () => {
  const root = makeLoop({ prefix: 'jarl-surface-base-', via: 'cli' });
  assert.match(refuses(root, 'base', 'nothing-here', 'main'), /nothing-here is not declared in this loop/);
  assert.match(refuses(root, 'base', 'nothing-here'), /base takes a repository name and a branch: jarl\.mjs base <name> <branch>/);
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
  files: ['the files an issue touches', ['new']], repo: ['a repository, by its name or its path', ['new', 'import', 'scope', 'branches', 'merged', 'queue', 'changelog']],
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
  base: ['the base branch a branch is held against', ['scope', 'branches', 'queue']], 'stale-hours': ['how long a lease may idle', ['branches', 'status']],
  sha: ['the merge commit', ['merged']], ci: ['the CI state of a commit: merged records it, resume asks gh for it', ['merged', 'resume', 'handoff']], red: ['the issue a red landing is tracked by', ['merged']], keep: ['the worktree and branch kept', ['merged']],
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
});

test('status and models group with --group; --by on them is refused with the call that groups', () => {
  const root = fieldedLoop();
  jarl(root, 'field', '1', 'Tags', 'docs');
  assert.match(jarl(root, 'status', '--group', 'tag'), /by tag:\n {2}\(none\) .*\n {2}docs /);
  assert.equal(JSON.parse(jarl(root, 'status', '--group', 'kind', '--json')).by.key, 'kind');
  assert.equal(refuses(root, 'status', '--by', 'repo').trim(), 'status groups its counts with --group, and --by names the author of a write: jarl.mjs status --group repo');
  assert.equal(refuses(root, 'models', '--by', 'tag').trim(), 'models groups its counts with --group, and --by names the author of a write: jarl.mjs models --group tag');
  assert.match(refuses(root, 'status', '--group', 'colour'), /--group is one of: repo, tag, kind, prio, area \(got "colour"\): jarl\.mjs status --group repo/);
  assert.equal(JSON.parse(jarl(root, 'models', '--group', 'tag', '--json')).by, 'tag');
});

test('a verdict and an evidence row are taken back by retract alone; the other spellings and the second name of scope are refused with the call to use', () => {
  const root = fieldedLoop();
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'ok');
  assert.equal(refuses(root, 'evidence', '1', '--retract', '1', '--by', 'jarl', 'wrong row').trim(), 'evidence takes nothing back: a row or a note is taken back with jarl.mjs retract 1 1 --by <who> "<text>"');
  assert.equal(refuses(root, 'review', '1', 'retract', '--by', 'jarl', 'wrong verdict').trim(), 'a verdict is taken back with retract: jarl.mjs retract 1 review --by jarl "wrong verdict"');
  assert.equal(refuses(root, 'check', '1', '--branch', 'jarl/1-a').trim(), 'check is not a command; a branch is measured by scope: jarl.mjs scope 1 --branch jarl/1-a');
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
