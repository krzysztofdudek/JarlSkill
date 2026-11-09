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
import { gitRepo, jarl, loop, skillFiles, skillText } from './helpers.mjs';

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

// A lease of one issue, for the briefs the tool prints: the worker's and the examiner's text live there and nowhere else.
function leasedForBriefs() {
  const { dir } = gitRepo({ prefix: 'jarl-texts-brief-', branch: 'feature' });
  jarl(dir, 'init', 'a goal');
  jarl(dir, 'new', 'one', '--why', 'needed', '--acceptance', '[test] it works', '--acceptance', '[read] the docs say so', '--files', 'a.txt');
  jarl(dir, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/1-one', '--worker', 'w1', '--model', 'm-x');
  return dir;
}

test('the worker\'s brief holds the worker\'s rules: the issue is the scope, no file carries a task number, proof recorded per line, nothing weakened, nothing pushed', () => {
  const brief = jarl(leasedForBriefs(), 'brief', '1');
  for (const [what, re] of [
    ['anything else goes under Found', /anything else you see goes under "Found"/i],
    ['weakening is refused and stuck is the exit', /weaken a test, a check, a guard or a hook[^\n]*stuck command/i],
    ['no file carries a task number', /No file you write carries a task number: only the commit subject names the issue/],
    ['commits at the failing test and at the fix', /Commit at the failing test and at the fix, one issue per commit, never amending/],
    ['never push, never another branch', /Never push or touch another branch/],
    ['scratch, not git stash', /never `git stash`/],
    ['records each line by its method', /Prove each line by its method/],
    ['runs only the files it touches', /Run the test files you touch/],
    ['no report while waiting', /Never report "waiting for the test run"/],
    ['the report names what ran and Found', /what changed, the commands and what they printed[^\n]*Found/],
    ['a refused call writes nothing', /A refused call writes nothing/],
    ['spawns no agents', /Spawn no agents/],
  ]) assert.match(brief, re, `the worker brief carries: ${what}`);
});

test('the examiner\'s brief holds its six steps, the verdict recorded last, and what it must not do', () => {
  const dir = leasedForBriefs();
  const brief = jarl(dir, 'brief', '1', '--role', 'reviewer');
  for (const [what, re] of [
    ['nothing protective was weakened', /nothing protective was weakened/],
    ['every mechanical line run again', /Run every \[test\], \[check\] and \[compare\] line again/],
    ['a line with no row is a finding', /no row names it: run it yourself; the worker's missing row is an Important finding/],
    ['read lines are quoted', /Judge the \[read\] lines and quote them/],
    ['findings by severity', /Rank findings Critical, Important or Minor/],
    ['the verdict is recorded last', /Record your own verdict last, with your name and model/],
    ['the answer quotes the line review printed', /quotes the line review printed/],
    ['read-only, never checkout in the main checkout', /never `git checkout` in the main checkout/],
  ]) assert.match(brief, re, `the examiner brief carries: ${what}`);
  assert.doesNotMatch(jarl(dir, 'brief', '1', '--role', 'reviewer'), /Report in under/);
});

test('the merger\'s brief holds its procedure', () => {
  const brief = jarl(leasedForBriefs(), 'brief', '--role', 'merger');
  for (const [what, re] of [
    ['a batch rolled back whole', /A batch went red: reset to before its first merge/],
    ['a red from outside is filed', /The cause is outside the branch/],
    ['the merge drivers on every merge', /the settings the merge-driver command prints, on every merge/],
    ['never hard reset', /never `--hard`/],
    ['report after the check', /report only after it has finished/],
    ['changelog once, in its own commit', /Changelog entries, once the batch is green/],
  ]) assert.match(brief, re, `the merger brief carries: ${what}`);
});
test('the tool list has no handoff tool, the command line keeps its command, and the main path and the command reference leave it out', () => {
  assert.ok(!mcp.buildTools().some((t) => t.name === 'jarl_handoff'));
  assert.ok(!Object.keys(mcp.TABLE.commands).some((c) => c === 'handoff' && !mcp.TABLE.commands[c].internal), 'the table marks the command internal');
  assert.throws(() => mcp.callTool('jarl_handoff', {}), /unknown|no such tool|not found/i);
  assert.doesNotMatch(USAGE, /^\s{2}handoff\b/m, 'the usage text does not document it');
  // The main path never names it. The command reference leaves out its tool fields, its row, the archive's mention of its
  // file and the two JSON keys; the list of what only the command line does (record.md) still has its row.
  assert.doesNotMatch(skillText('SKILL.md'), /handoff/i, 'SKILL.md does not name the handoff');
  const commands = skillText('references/commands.md');
  assert.doesNotMatch(commands, /handoff/i, 'commands.md does not document the handoff command, its keys or its file');
  assert.match(skillText('references/record.md'), /^\| `handoff` \|/m, 'the command-line-only list keeps its row');
});

// ---- next and resume show the tier's default model and never build the models table -----------------------------------

const LINES = '\nModel (strong): big-model\nModel (standard): mid-model, other-model\nModel (light): small-model\n';
function readyLoop() {
  const root = loop({ prefix: 'jarl-next-model-', goal: 'a goal' });
  appendFileSync(join(root, '.jarl', 'goal.md'), LINES);
  R.newIssue(root, 'to do', { kind: 'bug', tier: 'standard', acceptance: '[read] it works' });
  R.newIssue(root, 'hard', { kind: 'bug', tier: 'strong', acceptance: '[read] it works' });
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
  R.newIssue(root, 'first', { acceptance: '[read] it works', files: 'a.mjs' });
  R.newIssue(root, 'second', { acceptance: '[read] it works', files: 'a.mjs' });
  R.setStatus(root, '1', 'in-progress', '', { branch: 'jarl/1-x', worker: 'w' });
  let before = L.nextRowsBuilds();
  const some = dispatch(root, 'next', [], {});
  assert.equal(L.nextRowsBuilds() - before, 1);
  assert.deepEqual(some.out, []);
  assert.match(some.text, /nothing is ready to start; 1 open issue\(s\) are held or waiting/);
  R.setStatus(root, '2', 'in-progress', '', { branch: 'jarl/1-x', worker: 'w' });
  before = L.nextRowsBuilds();
  assert.equal(dispatch(root, 'next', [], {}).text, '(nothing open)');
  assert.equal(L.nextRowsBuilds() - before, 1);
});
