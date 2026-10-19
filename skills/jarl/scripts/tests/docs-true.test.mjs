// The texts an installed agent reads say what the code does: the command the skill names exists where the install puts
// it, the command reference lists the commands and flags of the command table and nothing else, the record's file list
// is the list of paths the tool writes, discovery finds a loop where the texts say it does, and the MCP tools are
// described as they behave. Each test runs the real tool or reads the real table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPT, SKILL_DIR, SPAWN_TIMEOUT, gitRepo, jarl, loop, refuses, run, skillFiles, skillText } from './helpers.mjs';

const { COMMAND_FLAGS, INTERNAL_COMMANDS, MUTATING, USAGE } = await import('../jarl.mjs');
const mcp = await import('../jarl-mcp.mjs');

const PLUGIN = resolve(SKILL_DIR, '..', '..');
const readRoot = (path) => readFileSync(join(PLUGIN, path), 'utf8');
const publicCommands = Object.keys(COMMAND_FLAGS).filter((c) => !INTERNAL_COMMANDS.includes(c));
const node = (args, opts = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', timeout: SPAWN_TIMEOUT, ...opts });

// ---- the literal command and the install -------------------------------------------------------------------------

test('SKILL.md names the script by the directory it was read from, and the plugin directory it names exists', () => {
  const skill = skillText('SKILL.md');
  assert.ok(skill.includes('node "<skill dir>/scripts/jarl.mjs" <command>'));
  const plugin = /`\$\{CLAUDE_PLUGIN_ROOT\}\/(skills\/jarl)`/.exec(skill);
  assert.ok(plugin, 'SKILL.md says where <skill dir> is in a plugin install');
  assert.ok(existsSync(join(PLUGIN, plugin[1], 'SKILL.md')), 'the plugin directory holds the skill');
  assert.ok(existsSync(join(PLUGIN, plugin[1], 'scripts', 'jarl.mjs')), 'the plugin directory holds the script');
  for (const text of [...skillFiles().map(skillText), readRoot('README.md'), readRoot('CLAUDE.md')]) {
    assert.doesNotMatch(text, /CLAUDE_PLUGIN_ROOT:-/, 'no form that falls back to a directory under the plugin root');
    assert.doesNotMatch(text, /CLAUDE_PLUGIN_ROOT\}?\/scripts\//, 'no scripts/ directly under the plugin root');
  }
});

test('the README copies the whole skills/jarl/ directory for a drop-in, never the single SKILL.md', () => {
  const readme = readRoot('README.md');
  assert.doesNotMatch(readme, /\.(?:agents|cursor|claude)\/skills\/jarl\/SKILL\.md/);
  for (const target of ['~/.agents/skills/jarl/', '.agents/skills/jarl/', '~/.cursor/skills/jarl/', '.cursor/skills/jarl/']) {
    assert.ok(readme.includes(`\`${target}\``), `the README names ${target}`);
  }
  assert.equal(readme.match(/copy the whole `skills\/jarl\/` directory/gi).length, 2, 'Codex and Cursor both copy the whole directory');
});

test('a drop-in copy of skills/jarl/ runs its own command and starts its own MCP server', () => {
  const home = mkdtempSync(join(tmpdir(), 'jarl-dropin-'));
  const copy = join(home, '.agents', 'skills', 'jarl');
  mkdirSync(join(home, '.agents', 'skills'), { recursive: true });
  cpSync(SKILL_DIR, copy, { recursive: true });
  assert.deepEqual(readdirSync(join(copy, 'references')).sort(), readdirSync(join(SKILL_DIR, 'references')).sort(), 'the references travel with the copy');
  const script = join(copy, 'scripts', 'jarl.mjs');
  assert.match(node([script, '--help']).stdout, /^usage: jarl\.mjs <command>/);
  const { dir } = gitRepo({ prefix: 'jarl-dropin-repo-' });
  assert.equal(node([script, 'init', 'a goal', '--root', dir]).status, 0);
  assert.match(node([script, 'status', '--root', dir]).stdout, /^goal: a goal/);
  const server = node([join(copy, 'scripts', 'jarl-mcp.mjs')], { input: `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n` });
  assert.match(server.stdout, /"instructions"/);
});

// ---- the command reference and the help text agree with the command table ---------------------------------------

// The commands the reference's table names, with every flag its synopses write: one backtick span of the first column
// is one synopsis, and a span starts with the command.
function referenceFlags() {
  const md = skillText('references/commands.md');
  const table = md.slice(md.indexOf('## The commands'), md.indexOf('## The command line'));
  const out = {};
  for (const row of table.split('\n').filter((l) => l.startsWith('| `'))) {
    const first = row.slice(2).split(/(?<!\\)\|/)[0];
    for (const [, span] of first.matchAll(/`([^`]+)`/g)) {
      const name = /^[a-z]+/.exec(span)?.[0];
      assert.ok(name, `a synopsis starts with its command: ${span}`);
      out[name] ??= new Set();
      for (const [, flag] of span.matchAll(/--([a-z][a-z-]*)/g)) out[name].add(flag);
    }
  }
  return out;
}

test('commands.md names every command of the table with every flag it takes, and nothing the table lacks', () => {
  const documented = referenceFlags();
  assert.deepEqual(Object.keys(documented).sort(), [...publicCommands].sort(), 'the commands of the reference and of the table');
  for (const command of publicCommands) {
    assert.deepEqual([...documented[command]].sort(), Object.keys(COMMAND_FLAGS[command]).sort(), `the flags of ${command}`);
  }
});

test('the help text writes every flag of a command in that command\'s synopsis, and no other', () => {
  const blocks = mcp.usageBlocks(USAGE);
  for (const command of publicCommands) {
    const written = new Set([...blocks[command].synopsis.matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1]));
    assert.deepEqual([...written].sort(), Object.keys(COMMAND_FLAGS[command]).sort(), `the synopsis of ${command}`);
  }
});

test('ask takes --kind as an option that defaults to stuck, as the reference writes it', () => {
  const { dir } = gitRepo({ prefix: 'jarl-docs-ask-' });
  jarl(dir, 'init', 'g');
  assert.match(jarl(dir, 'ask', 'which way?'), /^asked a-1$/);
  assert.match(jarl(dir, 'status', '--json'), /"questions": 1/);
  const asks = readFileSync(join(dir, '.jarl', 'asks.md'), 'utf8');
  assert.match(asks, /stuck/);
  assert.match(skillText('references/commands.md'), /\| `ask "<question>" \[--kind stop\\\|stuck\\\|lower\\\|charter\\\|ratify\]/);
});

test('close --force closes with issues still open, as the reference says, and refuses without it', () => {
  const { dir } = gitRepo({ prefix: 'jarl-docs-close-' });
  jarl(dir, 'init', 'g');
  jarl(dir, 'new', 'still open');
  assert.match(refuses(dir, 'close'), /still open or in progress.*--force/);
  assert.match(jarl(dir, 'close', '--force'), /^removed /);
  assert.equal(existsSync(join(dir, '.jarl')), false);
});

// ---- branches reads every repository the loop names, and next prints the ready issues ----------------------------

test('branches without --repo reads the loop\'s repository, every repository an unfinished issue names and every one where a not dropped issue records a Branch; --repo narrows it to one', () => {
  const main = gitRepo({ prefix: 'jarl-docs-br-' });
  const open = gitRepo({ prefix: 'jarl-docs-br-open-' });
  const kept = gitRepo({ prefix: 'jarl-docs-br-kept-' });
  const dropped = gitRepo({ prefix: 'jarl-docs-br-dropped-' });
  for (const [repo, branch] of [[open, 'jarl/1-a'], [kept, 'jarl/2-b'], [dropped, 'jarl/3-c']]) {
    repo.g('checkout', '-q', '-b', branch);
    writeFileSync(join(repo.dir, 'b.txt'), 'b\n');
    repo.g('add', '-A'); repo.g('commit', '-qm', 'work');
    repo.g('checkout', '-q', 'feature');
  }
  jarl(main.dir, 'init', 'g');
  for (const [title, repo] of [['one', open], ['two', kept], ['three', dropped]]) jarl(main.dir, 'new', title, '--repo', repo.dir);
  jarl(main.dir, 'set', '2', 'in-progress', 'go', '--branch', 'jarl/2-b', '--worker', 'w');
  jarl(main.dir, 'set', '2', 'deferred', 'later');
  jarl(main.dir, 'set', '3', 'in-progress', 'go', '--branch', 'jarl/3-c', '--worker', 'w');
  jarl(main.dir, 'set', '3', 'dropped', 'not needed');
  const all = jarl(main.dir, 'branches');
  assert.match(all, /jarl\/1-a/, 'a repository an open issue names');
  assert.match(all, /jarl\/2-b/, 'a repository where a deferred issue records a Branch');
  assert.doesNotMatch(all, /jarl\/3-c/, 'a repository only a dropped issue records a Branch in is not read');
  const one = jarl(main.dir, 'branches', '--repo', kept.dir);
  assert.match(one, /jarl\/2-b/);
  assert.doesNotMatch(one, /jarl\/1-a/, '--repo reads that one repository alone');
});

test('next prints the issues ready to start and the groups only with --all, as the texts say', () => {
  const { dir } = gitRepo({ prefix: 'jarl-docs-next-' });
  jarl(dir, 'init', 'g');
  jarl(dir, 'new', 'ready one', '--files', 'a.mjs');
  jarl(dir, 'new', 'waits', '--files', 'b.mjs', '--after', '1');
  const ready = jarl(dir, 'next');
  assert.match(ready, /ready one/);
  assert.doesNotMatch(ready, /waits/);
  assert.match(jarl(dir, 'next', '--all'), /waits/);
  assert.match(skillText('SKILL.md'), /`next` \| the open issues ready to start; `--all` adds the held and waiting ones, in groups/);
  assert.match(mcp.buildTools().find((t) => t.name === 'jarl_next').description, /ready to start/);
});

// ---- who counts as self ------------------------------------------------------------------------------------------

test('self is --by self, anyone who held the issue\'s lease across takeovers, and the workers of other issues on the same Branch', () => {
  const { dir } = gitRepo({ prefix: 'jarl-docs-self-' });
  jarl(dir, 'init', 'g');
  jarl(dir, 'new', 'one', '--files', 'a.txt');
  jarl(dir, 'new', 'two', '--files', 'b.txt');
  jarl(dir, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/1-shared', '--worker', 'w1');
  jarl(dir, 'set', '2', 'in-progress', 'go', '--branch', 'jarl/1-shared', '--worker', 'w2');
  jarl(dir, 'set', '1', 'open', 'takeover');
  jarl(dir, 'set', '1', 'in-progress', 'again', '--branch', 'jarl/1-shared', '--worker', 'w3');
  const findings = 'read the diff and found nothing wrong';
  for (const by of ['self', 'w1', 'w2', 'w3']) assert.match(refuses(dir, 'review', '1', 'approve', '--by', by, findings), /self-approve/, by);
  assert.match(jarl(dir, 'review', '1', 'approve', '--by', 'stranger', findings), /\(fresh\)/);
  const reference = skillText('references/commands.md');
  assert.match(reference, /`self` \(`--by self`, or anyone who has held this issue's lease/);
  assert.match(USAGE, /self for "self" or anyone who has held the issue's lease/);
});

// ---- discovery ---------------------------------------------------------------------------------------------------

test('a loop is found at the root of a checkout and never in a subdirectory, which root, --root or JARL_ROOT reach', () => {
  const { dir } = gitRepo({ prefix: 'jarl-docs-find-' });
  const sub = join(dir, 'releases', 'x');
  mkdirSync(sub, { recursive: true });
  jarl(sub, 'init', 'a loop in a subdirectory');
  const status = (cwd, args = [], env = {}) => spawnSync(process.execPath, [SCRIPT, 'status', ...args], { cwd, encoding: 'utf8', timeout: SPAWN_TIMEOUT, env: { ...process.env, ...env } });
  assert.doesNotMatch(status(sub).stdout, /^goal:/, 'not found from inside the subdirectory that holds it');
  assert.doesNotMatch(status(dir).stdout, /^goal:/, 'not found from the checkout root above it');
  assert.match(status(dir, ['--root', sub]).stdout, /^goal: a loop in a subdirectory/);
  assert.match(mcp.callTool('jarl_status', {}, { JARL_ROOT: sub }, dir).content[0].text, /^goal: a loop in a subdirectory/, 'a tool call reaches it through the server\'s JARL_ROOT');
  assert.doesNotMatch(mcp.callTool('jarl_status', {}, {}, sub).content[0].text, /^goal:/, 'a tool call finds nothing from inside the subdirectory');
  jarl(dir, 'init', 'a loop at the root');
  mkdirSync(join(dir, 'deep', 'er'), { recursive: true });
  assert.match(status(join(dir, 'deep', 'er')).stdout, /^goal: a loop at the root/, 'found from below the checkout root');
  const worktree = join(mkdtempSync(join(tmpdir(), 'jarl-docs-wt-')), 'wt');
  spawnSync('git', ['-C', dir, 'worktree', 'add', '-q', '-b', 'side', worktree], { encoding: 'utf8', timeout: SPAWN_TIMEOUT });
  assert.match(status(worktree).stdout, /^goal: a loop at the root/, 'found from a worktree that holds none, at the root of its main checkout');
  for (const text of [skillText('SKILL.md'), skillText('references/commands.md'), readRoot('README.md')]) assert.match(text, /never (?:looks )?in a subdirectory/);
});

// ---- the record's files ------------------------------------------------------------------------------------------

const NUMBER_WORDS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16 };

test('record.md lists every path the tool writes in .jarl/, in the count it states, and names what it only reads', () => {
  const md = skillText('references/record.md');
  const section = md.slice(md.indexOf('## The files of the loop'), md.indexOf('## The log is the record'));
  const count = /writes (\w+) paths/.exec(section);
  assert.ok(count && NUMBER_WORDS[count[1]], 'the section states how many paths the tool writes');
  const listed = section.split('\n').filter((l) => l.startsWith('| `.jarl/')).flatMap((row) => [...row.split('|')[1].matchAll(/`\.jarl\/([^`]+)`/g)].map((m) => m[1]));
  assert.equal(listed.length, NUMBER_WORDS[count[1]], `the table lists ${listed.length} paths`);
  assert.equal(new Set(listed).size, listed.length, 'no path twice');
  const prose = section.split('\n').filter((l) => !l.startsWith('|')).join('\n');
  assert.match(prose, /reads two things it never writes/);
  assert.ok(prose.includes('`.jarl/templates/`') && prose.includes('`handoff.md`'));
  // The names on disk after a committed loop with a profile, a named repository, a question, a ruling and an archive,
  // and after a permanent one.
  const found = new Set();
  const note = (dir) => { for (const entry of readdirSync(join(dir, '.jarl'))) found.add(entry); };
  const repo = gitRepo({ prefix: 'jarl-docs-files-' });
  const sibling = gitRepo({ prefix: 'jarl-docs-files-sibling-' });
  const profile = join(mkdtempSync(join(tmpdir(), 'jarl-docs-profile-')), 'profile.json');
  writeFileSync(profile, JSON.stringify({ 'jarl-profile': 1, statuses: { open: ['dispatchable'], 'in-progress': ['lease'], done: ['settles-dependents', 'terminal', 'closes-record'], dropped: ['settles-dependents', 'terminal', 'needs-reason'] } }));
  jarl(repo.dir, 'init', 'g', '--committed', '--profile', profile);
  jarl(repo.dir, 'new', 'one', '--repo', basename(sibling.dir));
  jarl(repo.dir, 'ask', 'which way?');
  jarl(repo.dir, 'decide', 'a-ruling', 'a ruling');
  note(repo.dir);
  jarl(repo.dir, 'set', '1', 'dropped', 'not needed');
  jarl(repo.dir, 'archive', 'one');
  note(repo.dir);
  const permanent = gitRepo({ prefix: 'jarl-docs-files-permanent-' });
  jarl(permanent.dir, 'init', 'g', '--permanent');
  note(permanent.dir);
  const names = new Set(listed.map((p) => p.split('/')[0]));
  for (const entry of found) assert.ok(names.has(entry) || /^\..*\.tmp$/.test(entry), `${entry} is written by the tool and listed in record.md`);
  for (const entry of names) if (!['.lock', '.lock.break'].includes(entry)) assert.ok(found.has(entry), `${entry} is listed and a loop of the tool holds it`);
});

// ---- the README --------------------------------------------------------------------------------------------------

test('the README says who verifies: the fresh reviewer and the merger, and no more than the record gives', () => {
  const readme = readRoot('README.md');
  assert.match(readme, /a fresh reviewer reads the diff and checks that the new test was red before the change/);
  assert.match(readme, /the merger merges into the branch with a commit that names the issue and runs the check on the result/);
  assert.match(readme, /nothing is closed without recorded evidence and a fresh reviewer's approve/);
  for (const false_ of [/reproduced itself/i, /reproducing the acceptance/i, /runs the test suite itself/i, /blocks (?:code|a merge)/i, /Nobody writes a handoff/]) {
    assert.doesNotMatch(readme.replace(/never blocks code from landing/g, ''), false_);
  }
  assert.match(readme, /fresh, coordinator, self or unrecorded/);
  assert.doesNotMatch(readme, /(?:four|five) (?:kinds of )?markdown files?/i, 'no count of the record\'s files the record contradicts');
});

test('the manifests describe a loop whose evidence and fresh review decide what closes', () => {
  for (const path of ['plugin.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.cursor-plugin/plugin.json']) {
    const { description } = JSON.parse(readRoot(path));
    assert.match(description, /evidence and a fresh review decide what closes, and a branch loop leaves no trace on main/, path);
  }
  for (const path of ['.claude-plugin/marketplace.json', '.github/plugin/marketplace.json']) {
    assert.match(readRoot(path), /evidence and a fresh review decide what closes/, path);
  }
});

// ---- the skill ---------------------------------------------------------------------------------------------------

test('the first screen of SKILL.md starts a cold agent: resume an existing loop after asking once, or init', () => {
  const lines = skillText('SKILL.md').split('\n');
  const first = lines.findIndex((l) => l === '## First moves');
  const roles = lines.findIndex((l) => l === '## The roles');
  assert.ok(first > 0 && first < 20 && first < roles, 'First moves comes before the roles');
  const text = lines.slice(first, roles).join('\n');
  assert.match(text, /already holds a loop/);
  assert.match(text, /ask the owner once/);
  assert.match(text, /`archive "<slug>"`, then `init "<goal>"`/);
  assert.match(text, /`resume`/);
  assert.match(text, /No loop yet\.\*\* Run `init "<goal>"`/);
});

test('models.md never puts the reviewer that clears an issue below the worker it reviews', () => {
  const models = skillText('references/models.md');
  assert.match(models, /Workers run on the tier the issue's `Tier:` names\. A reviewer whose approve clears the issue runs on that tier or above, never below it/);
  assert.match(models, /Readers and the merger run on the standard tier/);
  assert.doesNotMatch(models, /Workers, readers, reviewers and the merger run on the standard tier/);
});

// ---- the MCP server ----------------------------------------------------------------------------------------------

// Every file under .jarl/ with its bytes: what a read-only tool must leave as it found it.
function snapshot(dir) {
  const out = {};
  const walk = (p) => {
    for (const entry of readdirSync(p)) {
      const full = join(p, entry);
      if (statSync(full).isDirectory()) walk(full); else out[full] = readFileSync(full, 'utf8');
    }
  };
  walk(join(dir, '.jarl'));
  return out;
}

test('every tool is described as it behaves: Read-only tools write nothing and WRITES tools are the writers', () => {
  const tools = mcp.buildTools().filter((t) => t.name !== 'jarl_help');
  for (const tool of tools) {
    const command = tool.name.slice('jarl_'.length);
    const writes = MUTATING.has(({ check: 'scope' })[command] ?? command);
    assert.ok(tool.description.startsWith(writes ? 'WRITES the loop. ' : 'Read-only. '), `${tool.name}: ${tool.description}`);
  }
  const { dir } = gitRepo({ prefix: 'jarl-docs-tools-' });
  jarl(dir, 'init', 'g');
  jarl(dir, 'new', 'one', '--files', 'a.txt', '--acceptance', 'it works');
  jarl(dir, 'ask', 'which way?');
  jarl(dir, 'decide', 'a-ruling', 'a ruling');
  const before = snapshot(dir);
  const inputs = { show: { id: '1' }, changelog: { ids: '1' }, scope: { branch: 'feature' }, check: { branch: 'feature' } };
  for (const tool of tools.filter((t) => t.description.startsWith('Read-only.'))) {
    const command = tool.name.slice('jarl_'.length);
    mcp.callTool(tool.name, { ...(inputs[command] ?? {}), root: dir });
    assert.deepEqual(snapshot(dir), before, `${tool.name} wrote into the loop`);
  }
});

test('jarl_help prints the usage the command line prints, and the server instructions name the tool that boots a session', () => {
  assert.equal(mcp.callTool('jarl_help').content[0].text, USAGE);
  const { dir } = gitRepo({ prefix: 'jarl-docs-help-' });
  assert.equal(run(dir, ['--help']).stdout, USAGE.trim());
  const reply = mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.match(reply.result.instructions, /jarl_resume/);
  assert.ok(mcp.buildTools().some((t) => t.name === 'jarl_resume'));
});

test('a tool call does what its description says: jarl_ask without a kind files a stuck question, jarl_close with force closes', () => {
  const root = loop({ prefix: 'jarl-docs-call-', via: 'cli' });
  const asked = mcp.callTool('jarl_ask', { question: 'which way?', root });
  assert.equal(asked.isError, false);
  assert.match(readFileSync(join(root, '.jarl', 'asks.md'), 'utf8'), /stuck/);
  mcp.callTool('jarl_new', { title: 'open', root });
  assert.equal(mcp.callTool('jarl_close', { root }).isError, true, 'close refuses while an issue is open');
  assert.equal(mcp.callTool('jarl_close', { force: true, root }).isError, false);
});
