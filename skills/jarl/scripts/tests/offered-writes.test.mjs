// Every write the tool offers to be run is taken as offered, in the help, in a tool's example, in a row of next, in a brief
// and in a hint, filled only with a sample of each placeholder of the registry, and run on a scratch loop: a form the
// command refuses for what it left out is an offer nobody can take.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jarl, loop } from './helpers.mjs';
import { runPrinted } from './walk.mjs';
import { MUTATING } from '../jarl.mjs';
import { PLACEHOLDERS } from '../lib/base.mjs';
import { buildTools, callTool, usageBlocks } from '../jarl-mcp.mjs';

const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const TEXT = 'words that say enough here';
const SAMPLES = {
  '<who>': 'a-writer', '<reviewer>': 'rev-x', '<a-fresh-reviewer>': 'rev-x', '<the-owner-himself>': 'owner', '<name>': 'w-new', '<the-new-worker>': 'w-new',
  '<text>': TEXT, '<why>': TEXT, '<why-the-worker-changed>': TEXT, '<what-failed>': TEXT, '<what-is-red>': 'the check is red', '<question-for-the-owner>': TEXT,
  '<what-was-read-and-found>': 'read the diff, nothing found', '<findings-with-a-severity>': 'read the diff, nothing found',
  '<command>': 'npm test', '<what-it-printed>': 'pass 3', '<line-number>': '1', '<sha>': 'abc1234', '<model-id>': 'a-model-id', '<branch>': 'jarl/new', '<worker-branch>': 'jarl/new',
  '<verdict>': 'approve', '<status>': 'deferred', '<title>': 'a title', '<goal>': 'a goal', '<line>': '[read] it works', '<paths>': 'new.mjs', '<tag>': 'docs', '<prio>': '2', '<tier>': 'standard',
  '<ids-it-waits-on>': '1', '<another-issue>': '1', '<value>': 'a value', '<question>': 'a-1', '<slug>': 'a-slug', '<a-ruling>': 'a ruling that says enough', '<machine-line>': 'Check: npm test',
  '<ci-state>': 'green', '<part>': 'Where', '<kind>': 'task', '<changelog-entry>': 'Fixed: a thing', '<date-or-event>': 'Friday', '<slot>': 'before', '<path>': 'a.png', '<option>': 'A', '<ask-kind>': 'stuck',
  '<findings.json>': 'findings.json', '<report-dir>': 'reports/one', '<key>': 'abc', '<section-or-field>': 'section', '<line=id>': '1=2', '<coordinator>': 'odin', '<yes-or-reject-first>': 'yes',
  '<name-or-path>': '.', '<resource-name>': 'db', '<mode>': 'permanent', '<a-ruling-in-force>': 'no-subagents', '<selectors>': 'role worker', '<date-or-id>': 'Friday', '<report-dir#finding-id>': 'reports/one#F-1',
};
const REGISTERED = new Set(PLACEHOLDERS);
// The issue a placeholder of an id means, by the command that takes it: one in the state the command is for.
const IDS = { set: '1', field: '1', evidence: '2', merged: '3', review: '4', round: '2', retract: '3', split: '1', tick: '7', renumber: '1', ask: '5', import: '1', answer: 'a-1' };

// A loop with an issue in each state a write is offered for, and the issue the tools' examples name.
function scene() {
  const root = loop({ prefix: 'jarl-offered-', via: 'cli' });
  for (let n = 1; n <= 12; n += 1) jarl(root, 'new', `issue ${n}`, '--acceptance', '[read] it works', '--files', `f${n}.mjs`);
  jarl(root, 'set', '2', 'in-progress', 'go', '--branch', 'jarl/2', '--worker', 'w2');
  jarl(root, 'set', '3', 'in-progress', 'go', '--branch', 'jarl/3', '--worker', 'w3');
  jarl(root, 'evidence', '3', '--line', '1', '--ran', 'npm test', '--saw', 'pass 3');
  jarl(root, 'review', '3', 'approve', '--by', 'rev-a', 'read the diff and the rows, nothing found');
  jarl(root, 'set', '4', 'in-progress', 'go', '--branch', 'jarl/4', '--worker', 'w4');
  jarl(root, 'evidence', '4', '--line', '1', '--ran', 'npm test', '--saw', 'pass 3');
  jarl(root, 'set', '12', 'in-progress', 'go', '--branch', 'jarl/12', '--worker', 'w-12');
  jarl(root, 'evidence', '12', '--line', '1', '--ran', 'npm test', '--saw', 'pass 3');
  jarl(root, 'new', 'a promise', '--acceptance', '[read] it works', '--kind', 'promise', '--found-by', 'jarl');
  jarl(root, 'new', 'a wait', '--acceptance', '[read] it works', '--kind', 'wait', '--person', 'Dana', '--check-when', 'Friday');
  jarl(root, 'ask', 'which way?', '--issue', '5');
  jarl(root, 'ask', 'pick one', '--issue', '6', '--option', 'A:the first', '--option', 'B:the second');
  jarl(root, 'decide', 'no-subagents', 'one agent alone', '--by', 'jarl');
  return root;
}
const SCENE = scene();
function onACopy(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-offered-copy-'));
  cpSync(SCENE, dir, { recursive: true });
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); }
}

// The commands of jarl.mjs in a text that write, each as it stands, with no global flag and no path before it.
const COMMAND = /jarl\.mjs ((?:'[^'\n]*'|"[^"\n]*"|[^'"\n])*?)(?=$| — | · |, or |, then | \(|, once| once|; |\)| without )/gm;
function writesIn(text) {
  return [...text.matchAll(COMMAND)].map((m) => m[1].replace(/ '--root=[^']*'| --root=\S+| --root '[^']*'| --root \S+/g, '').trim())
    .filter((c) => { const [cmd] = c.split(' '); return MUTATING.has(cmd) && !(cmd === 'goal' && !/--set/.test(c)); });
}
// A form with its placeholders filled, each by its sample: the issue by the command that takes it.
function filled(command, problems) {
  const cmd = command.split(' ')[0];
  const closing = /^set \S+ done\b/.test(command);
  return command.replace(/"(<[^"]+>)"/g, (_, p) => {
    if (!REGISTERED.has(p)) { problems.push(`${command}: ${p} is no placeholder of the registry`); return p; }
    if (p === '<id>' || p === '<ids>') return closing ? '3' : IDS[cmd] ?? '1';
    if (SAMPLES[p] === undefined) { problems.push(`${command}: no sample for ${p}`); return p; }
    return `'${SAMPLES[p]}'`;
  });
}
const MERGE = ['merged', '3', '--sha', 'abc1234', '--ran', 'npm test', '--saw', 'pass 3'];
// A refusal of the state of the scene, never of the form: the issue a command needs is not there to give.
const STATE_REFUSALS = { renumber: /is carried by one issue file/, mode: /is out of git/, base: /is not declared in this loop/, tick: /has no acceptance line marked as one only the owner ticks/, close: /still open or in progress/, evidence: /the profile declares no slot/ };
function runOffered(command, { pre = [], problems }) {
  const line = `jarl.mjs ${filled(command, problems)}`;
  return onACopy((dir) => {
    for (const p of pre) jarl(dir, ...p);
    const closed = /^set (\d+) done\b/.exec(command);
    if (/^set \S+ done\b/.test(command)) jarl(dir, 'merged', closed ? closed[1] : '3', ...MERGE.slice(2));
    if (command.startsWith('import ')) writeFileSync(join(dir, 'findings.json'), JSON.stringify([{ id: 'F-1', title: 'one', claim: 'it works' }]));
    const r = runPrinted(dir, line);
    if (r.status !== 0 && !STATE_REFUSALS[command.split(' ')[0]]?.test(r.stderr)) problems.push(`${line}\n  ${r.stderr.trim().split('\n').join('\n  ')}`);
  });
}
function runAll(commands, opts = {}) {
  const problems = [];
  for (const c of commands) runOffered(c, { ...opts, problems });
  return problems;
}

test('every write next prints, for the jarl, the owner and a worker, runs as printed on the loop it was printed for', () => {
  const rows = ['jarl', 'owner', 'w2', 'Dana'].flatMap((as) => json(SCENE, 'next', '--as', as, '--all').rows);
  const commands = [...new Set(rows.flatMap((r) => (r.command ? writesIn(r.command) : [])))];
  assert.ok(commands.length >= 5, commands.join('\n'));
  assert.ok(commands.some((c) => /^evidence 13\b/.test(c)), 'the promise row is walked');
  assert.ok(commands.some((c) => /^evidence 14\b/.test(c)), 'the wait row is walked');
  assert.deepEqual(runAll(commands), []);
});

test('every write a brief prints runs as printed: the worker\'s, the reviewer\'s and the merger\'s', () => {
  for (const args of [['2'], ['3', '--role', 'reviewer'], ['--role', 'merger']]) {
    const commands = [...new Set(writesIn(jarl(SCENE, 'brief', ...args)))];
    assert.ok(commands.length >= 2, `${args.join(' ')}: ${commands.join('\n')}`);
    assert.deepEqual(runAll(commands), [], args.join(' '));
  }
});

test('every write a reply or a view hints at runs as printed, on the loop as the reply left it', () => {
  const calls = [
    ['review', '4', 'changes', '--by', 'rev-a', 'Important: the case is missing'],
    ['review', '4', 'approve', '--by', 'rev-a', 'read the diff and the rows, nothing found'],
    ['field', '6', 'What', 'relies on issue 7 for its data'],
  ];
  for (const call of calls) {
    const commands = onACopy((dir) => [...new Set(writesIn(jarl(dir, ...call)))]);
    assert.deepEqual(runAll(commands, { pre: [call] }), [], call.join(' '));
  }
  const views = [...new Set(['resume', 'status'].flatMap((v) => writesIn(jarl(SCENE, v))))];
  assert.deepEqual(runAll(views), []);
});

// The forms of a write in the help: every alternative of its synopsis, what is optional left out.
const NEEDS_MORE = { field: { after: '<name>', add: '"<value>"' } };
function helpForms(cmd, synopsis) {
  const plain = synopsis.replace(/\[(?:[^[\]]|\[[^\]]*\])*\]\.*/g, '').replace(/\.\.\./g, '').replace(/\s+/g, ' ').trim().replace(new RegExp(`^${cmd} `), '');
  const parts = plain.split(' | ');
  const lead = parts[0].split(' ').filter((w) => !w.startsWith('--')).slice(0, 2).join(' ');
  return parts.map((p) => {
    const body = p.startsWith(`${cmd} `) ? p.slice(cmd.length + 1) : p.startsWith('--') ? `${lead.split(' ').filter((w) => /^<id|^"<id/.test(w)).join(' ')} ${p}` : p;
    const words = body.trim().split(' ').map((w) => {
      const first = w.includes('|') && !w.startsWith('"') ? w.split('|')[0] : w;
      if (first === 'who') return '"<who>"';
      return /^<.*>$/.test(first) ? `"${first}"` : first;
    });
    const more = NEEDS_MORE[cmd];
    if (more) words.splice(words.indexOf(`"${more.after}"`) + 1, 0, more.add);
    return `${cmd} ${words.join(' ')}`;
  });
}
test('every form of a write in the help names its writer and runs filled', () => {
  const blocks = usageBlocks();
  const forms = Object.entries(blocks).filter(([cmd]) => MUTATING.has(cmd) && cmd !== 'init').flatMap(([cmd, b]) => helpForms(cmd, b.synopsis));
  assert.ok(forms.length >= 22, forms.join('\n'));
  const unnamed = forms.filter((f) => !/ --by /.test(f));
  assert.deepEqual(unnamed, []);
  const pre = (form) => (/ --ci /.test(form) ? [MERGE] : []);
  const problems = [];
  for (const form of forms) runOffered(form.replace('"<name>" "<value>"', 'Where "<value>"').replace(/^answer "<ids>" --option/, 'answer a-2 --option'), { pre: pre(form), problems });
  assert.deepEqual(problems, []);
});

test('every example of a tool that writes runs as written, on the issue it names', () => {
  const examples = buildTools().flatMap((tool) => Object.values(tool.inputSchema.properties ?? {}).flatMap((p) => {
    const m = /Example: (\{.*\})/.exec(p.description ?? '');
    return m && MUTATING.has(tool.name.replace(/^jarl_/, '')) ? [[tool.name, JSON.parse(m[1])]] : [];
  }));
  assert.ok(examples.length >= 7, String(examples.length));
  const problems = [];
  for (const [tool, example] of examples) {
    onACopy((dir) => {
      try {
        const r = callTool(tool, { ...example, root: dir });
        if (r.isError) problems.push(`${tool} ${JSON.stringify(example)}: ${r.content[0].text}`);
      } catch (e) { problems.push(`${tool} ${JSON.stringify(example)}: ${e.message}`); }
    });
  }
  assert.deepEqual(problems, []);
});
