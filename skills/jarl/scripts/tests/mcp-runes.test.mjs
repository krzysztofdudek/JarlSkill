// The MCP server stands on the family's one adapter, @chrisdudek/runes/mcp (vendored under vendor/runes/). These tests
// hold it there with the adapter's own test kit: parity between the command table, the usage text and the tools the
// running server lists (assertParity), and the size of that list against the family's budget (measureTools) — a
// number reported on every run and a warning when over, never a failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { assertParity, parityProblems } from '../vendor/runes/dist/testkit/parity.mjs';
import { measureTools, formatToolsMeasure } from '../vendor/runes/dist/testkit/measure.mjs';
import { listToolsOverStdio } from '../vendor/runes/dist/testkit/client.mjs';
import { COMMAND_FLAGS, USAGE } from '../jarl.mjs';
import * as mcp from '../jarl-mcp.mjs';

const SERVER = fileURLToPath(new URL('../jarl-mcp.mjs', import.meta.url));
const listed = await listToolsOverStdio({ command: process.execPath, args: [SERVER] });

// The usage side checks that every command has its entry and no entry names a command the table lacks. Its flag check
// is off: an entry's prose names other commands' flags (set's "--ran/--saw row", close's "init --permanent"), and
// mcp.test.mjs already holds each synopsis to its command's flags both ways.
test('parity (Runes testkit): the table, the usage text and the tools the running server lists say the same thing', () => {
  assertParity({ table: mcp.TABLE, usage: USAGE, usageOptions: { from: /^commands:/ }, usageFlags: false, tools: listed, toolOptions: mcp.TOOL_OPTIONS });
});

test('parity (Runes testkit): a tool that loses a field, or a command with no tool, is caught', () => {
  const lost = listed.map((t) => (t.name === 'jarl_set' ? { ...t, inputSchema: { ...t.inputSchema, properties: { ...t.inputSchema.properties, worker: undefined } } } : t))
    .map((t) => ({ ...t, inputSchema: { ...t.inputSchema, properties: Object.fromEntries(Object.entries(t.inputSchema.properties).filter(([, v]) => v)) } }));
  assert.match(parityProblems({ table: mcp.TABLE, tools: lost, toolOptions: mcp.TOOL_OPTIONS }).join('\n'), /tool jarl_set lacks "worker"/);
  const fewer = listed.filter((t) => t.name !== 'jarl_tips');
  assert.match(parityProblems({ table: mcp.TABLE, tools: fewer, toolOptions: mcp.TOOL_OPTIONS }).join('\n'), /command "tips" has no tool jarl_tips/);
});

test('the table is the CLI\'s: every command, and the server lists exactly the tools buildTools generates', () => {
  assert.deepEqual(Object.keys(mcp.TABLE.commands).sort(), Object.keys(COMMAND_FLAGS).sort());
  assert.deepEqual(listed, JSON.parse(JSON.stringify(mcp.buildTools())));
});

test('budget step 1: a tool description is one sentence after whether it writes; the full usage is jarl_help', () => {
  for (const t of listed) {
    if (t.name === 'jarl_help') continue;
    const body = t.description.replace(/^(WRITES the loop\.|Read-only\.) /, '').replace(mcp.ARG_NOTES.set, '').trim();
    assert.equal(body.split(/(?<=[.!?])\s+(?=[A-Z])/).length, 1, `${t.name}: "${body}"`);
    assert.ok(t.description.length <= 400, `${t.name}: ${t.description.length} characters`);
  }
  const help = mcp.callTool('jarl_help', {});
  assert.ok(help.content[0].text.startsWith(USAGE), 'jarl_help answers with the usage --help prints');
});

test('tools/list is measured against the budget (8.5k tokens per server): reported, a warning when over, never a failure', (t) => {
  const m = measureTools(listed, { label: 'jarl tools/list' });
  const line = formatToolsMeasure(m, 'jarl tools/list');
  t.diagnostic(line);
  if (m.over) process.emitWarning(line, { code: 'RUNES_TOOLS_BUDGET' });
  if (m.over && process.env.GITHUB_ACTIONS) console.log(`::warning title=MCP tools/list budget::${line}`);
  assert.ok(m.tokens > 0 && m.perTool.length === listed.length);
});
