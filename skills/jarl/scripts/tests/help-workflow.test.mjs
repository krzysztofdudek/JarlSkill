// The end of the help: a short workflow section for a session with parallel workers in worktrees. It is part of the one
// usage text, so --help prints it last and the jarl_help answer ends with it; there is no help topic and no command for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, USAGE } from '../jarl.mjs';
import * as mcp from '../jarl-mcp.mjs';
import { loop, spawnJarl } from './helpers.mjs';

const lastSection = (text) => text.replace(/\s+$/, '').split('\n\n').at(-1);
const POINTS = [
  ['the default mode with root set to the loop root on every call', /default mode[^\n]*every call[^\n]*--root <loop root>/i],
  ['the merger alone commits .jarl/ in the committed mode', /committed mode[^\n]*merger alone commits \.jarl\/[^\n]*never/i],
  ['the coordinator files issues, or a worker with root set to the loop root', /coordinator files[^\n]*worker[^\n]*--root <loop root>/i],
  ['a lease means held by a worker', /lease[^\n]*held by a worker/i],
  ['list hides finished work and filters by tag, status, priority and text', /list hides[^\n]*done[^\n]*--tag[^\n]*--status[^\n]*--prio[^\n]*--grep|list hides[^\n]*tag[^\n]*status[^\n]*priority[^\n]*text/i],
];
function namesTheWorkflow(section) {
  assert.match(section.split('\n')[0], /^Parallel workers in worktrees:/, 'the section opens with its heading');
  for (const [what, re] of POINTS) assert.match(section, re, `the last section names ${what}`);
}

test('the usage text ends with a workflow section for parallel workers in worktrees, and the command line prints it last', () => {
  namesTheWorkflow(lastSection(USAGE));
  const r = spawnJarl(loop(), ['--help']);
  assert.equal(r.status, 0, r.stderr);
  namesTheWorkflow(lastSection(r.stdout));
});

test('the jarl_help answer ends with the same workflow section, and there is no help topic and no command for it', () => {
  const help = mcp.callTool('jarl_help', {}).content[0].text;
  namesTheWorkflow(lastSection(help));
  assert.equal(lastSection(help), lastSection(USAGE));
  assert.ok(!mcp.buildTools().some((t) => /workflow/.test(t.name)), 'no tool for the workflow');
  assert.throws(() => dispatch(loop(), 'workflow', [], {}), /unknown command/);
});
