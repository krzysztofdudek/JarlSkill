// The sentence that survives a compaction (the skill and the server's instructions), the checklists of the briefs, the
// tool list without the handoff tool, and the views that show a tier's default model without building the models table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import * as R from '../record.mjs';
import * as L from '../jarl-lib.mjs';
import { dispatch, USAGE } from '../jarl.mjs';
import * as mcp from '../jarl-mcp.mjs';
import { loop, skillFiles, skillText } from './helpers.mjs';

// ---- the sentence that survives a compaction ----------------------------------------------------------------------------

test('after a summary of its own context a session resumes before its next action: SKILL.md and the server instructions say so', () => {
  const skill = skillText('SKILL.md');
  assert.match(skill, /compaction[^\n]*summary of your own context[^\n]*resume[^\n]*before[^\n]*next action/i);
  assert.match(skill, /a summary is not the state/i);
  // What a host receives: the instructions of the initialize answer.
  const instructions = mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }).result.instructions;
  assert.match(instructions, /compaction/i);
  assert.match(instructions, /resume/);
  assert.match(instructions, /before your next action/);
  assert.match(instructions, /a summary is not the state/i);
});

test('the compaction sentence has two homes by design, SKILL.md for the skill and the server instructions for a host that keeps them; no reference repeats it', () => {
  for (const file of skillFiles().filter((f) => f !== 'SKILL.md')) assert.doesNotMatch(skillText(file), /summary is not the state/i, `${file} repeats the compaction sentence`);
});

// ---- the briefs -----------------------------------------------------------------------------------------------------------

const sectionOf = (text, heading) => {
  const at = text.indexOf(`\n## ${heading}\n`);
  assert.ok(at >= 0, `no section ${heading}`);
  const rest = text.slice(at + 1);
  const next = rest.indexOf('\n## ', 4);
  return next < 0 ? rest : rest.slice(0, next);
};

test('the worker brief ends with a closing checklist and says that no file carries a task number', () => {
  const brief = sectionOf(skillText('references/worker.md'), 'The worker\'s brief');
  const items = [
    ['the work is committed', /closing checklist[\s\S]*committed/i],
    ['red and green are recorded as evidence rows, not only in the report', /red and green[^\n]*evidence rows[^\n]*not only in the report/i],
    ['every check the brief names was waited for to its end', /every check[^\n]*brief names[^\n]*waited for[^\n]*to its end/i],
    ['the changelog fragment is written', /changelog fragment[^\n]*written/i],
    ['the report is sent', /report is sent/i],
  ];
  for (const [what, re] of items) assert.match(brief, re, `the worker brief carries: ${what}`);
  assert.match(brief, /no (?:file|comment|test|doc)[^\n]*task number|task number[^\n]*no file/i);
  assert.match(brief, /no loop issue number appears in code, comments, tests, docs or graph entries/i, 'every place a number may not appear is named');
  assert.match(brief, /loop ends[^\n]*number[^\n]*points nowhere/i, 'the reason is given in the worker\'s own terms');
  assert.match(brief, /rulings in force[^\n]*jarl_decisions[^\n]*live: true/i, 'the worker reads the rulings in force');
  assert.match(brief, /only the commit subject names the issue/i);
  assert.ok(brief.indexOf('closing checklist') > brief.indexOf('Report in under'), 'the checklist closes the brief');
});

test('the reviewer brief asks the fourth question, reads the rows, and ends with the recording call with its fields filled', () => {
  const ref = skillText('references/reviewer.md');
  const brief = sectionOf(ref, 'The reviewer\'s brief');
  assert.match(brief, /weaken anything that worked or protected before[^\n]*(?:mode|default|guard|test)/i, 'the fourth question');
  assert.match(brief, /(?:read|reads) the (?:evidence )?rows[^\n]*missing[^\n]*Important/i, 'a worker\'s missing rows are an Important finding');
  const last = brief.slice(brief.lastIndexOf('Record your own verdict'));
  assert.match(last, /jarl_review|review <id>/, 'the last step is the recording call');
  assert.match(last, /by[^\n]*model/i, 'its fields are filled');
  assert.match(last, /quotes? the line review printed/i, 'the answer quotes the line review printed');
  assert.ok(brief.trimEnd().endsWith('```'), 'the recording step closes the brief');
  assert.ok(brief.indexOf('Record your own verdict') > brief.indexOf('Rank every finding'), 'recording is the last step');
  assert.match(brief, /rulings in force[^\n]*jarl_decisions[^\n]*live: true/i, 'the reviewer reads the rulings in force');
  assert.match(ref, /returned without recording[^\n]*resumed to record/i, 'a reviewer that returned without recording is resumed');
  for (const file of skillFiles().filter((f) => f !== 'references/reviewer.md')) assert.doesNotMatch(skillText(file), /without recording[^\n]*resumed to record/i, `${file} repeats the rule that a reviewer is resumed to record`);
  assert.match(ref, /gate counts the reviewer of the previous round as fresh/i);
  assert.match(ref, /new one-shot reviewer for each round[^\n]*findings of the previous round/i);
});

// ---- the tool list ------------------------------------------------------------------------------------------------------

test('the tool list has no handoff tool, the command line keeps its command, and the main path and the command reference leave it out', () => {
  assert.ok(!mcp.buildTools().some((t) => t.name === 'jarl_handoff'));
  assert.ok(!Object.keys(mcp.TABLE.commands).some((c) => c === 'handoff' && !mcp.TABLE.commands[c].internal), 'the table marks the command internal');
  assert.throws(() => mcp.callTool('jarl_handoff', {}), /unknown|no such tool|not found/i);
  assert.doesNotMatch(USAGE, /^\s{2}handoff\b/m, 'the usage text does not document it');
  // The main path never names it. The command reference leaves out its tool fields, its row, the archive's mention of its
  // file and the two JSON keys; the list of what only the command line does (composers.md) still has its row.
  assert.doesNotMatch(skillText('SKILL.md'), /handoff/i, 'SKILL.md does not name the handoff');
  const commands = skillText('references/commands.md');
  assert.doesNotMatch(commands, /handoff/i, 'commands.md does not document the handoff command, its keys or its file');
  assert.match(skillText('references/composers.md'), /^\| `handoff` \|/m, 'the command-line-only list keeps its row');
});

// ---- next and resume show the tier's default model and never build the models table -----------------------------------

const LINES = '\nModel (strong): big-model\nModel (standard): mid-model, other-model\nModel (light): small-model\n';
function readyLoop() {
  const root = loop({ prefix: 'jarl-next-model-', goal: 'a goal' });
  appendFileSync(join(root, '.jarl', 'goal.md'), LINES);
  R.newIssue(root, 'to do', { kind: 'bug', tier: 'standard', acceptance: 'it works' });
  R.newIssue(root, 'hard', { kind: 'bug', tier: 'strong', acceptance: 'it works' });
  return root;
}

test('next and resume print the default model of the tier and no table row; the models table is built zero times', () => {
  const root = readyLoop();
  const built = L.modelsTableBuilds();
  const next = dispatch(root, 'next', [], {});
  const resume = dispatch(root, 'resume', [], {});
  assert.equal(L.modelsTableBuilds(), built, 'a plain next and a resume build no models table');
  assert.match(next.text, /to do[^\n]*\[model mid-model\]/);
  assert.match(next.text, /hard[^\n]*\[model big-model\]/);
  assert.match(resume.text, /to do[^\n]*\[model mid-model\]/);
  for (const text of [next.text, resume.text]) assert.doesNotMatch(text, /suggest|clean first pass|units \d|\(not recorded\)/);
  assert.deepEqual(next.out.map((r) => r.model), [{ default: 'mid-model' }, { default: 'big-model' }]);
  assert.deepEqual(resume.out.next.map((r) => r.model), [{ default: 'mid-model' }, { default: 'big-model' }]);
  L.cmdModels(root, {});
  assert.ok(L.modelsTableBuilds() > built, 'the probe counts the steps that build the table, not only the command');
});

test('next computes its rows once, also when nothing is ready', () => {
  const root = loop({ prefix: 'jarl-next-once-', goal: 'a goal' });
  R.newIssue(root, 'first', { acceptance: 'it works', files: 'a.mjs' });
  R.newIssue(root, 'second', { acceptance: 'it works', files: 'a.mjs' });
  R.setStatus(root, '1', 'in-progress', '', { branch: 'jarl/1-x', worker: 'w' });
  let before = L.nextRowsBuilds();
  const some = dispatch(root, 'next', [], {});
  assert.equal(L.nextRowsBuilds() - before, 1);
  assert.deepEqual(some.out, []);
  assert.match(some.text, /nothing is ready to start; 1 open issue\(s\) are held or waiting/);
  R.setStatus(root, '2', 'in-progress', '', { branch: 'jarl/2-x', worker: 'w' });
  before = L.nextRowsBuilds();
  assert.equal(dispatch(root, 'next', [], {}).text, '(nothing open)');
  assert.equal(L.nextRowsBuilds() - before, 1);
});
