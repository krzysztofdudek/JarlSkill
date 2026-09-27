#!/usr/bin/env node
// jarl-mcp.mjs — the jarl tool over MCP: a protocol adapter, not a second implementation.
//
// Built on the family's one MCP adapter, @chrisdudek/runes/mcp, vendored under vendor/runes/ (pinned in
// vendor/runes.pin.json and checked by runes.mjs). The CLI's own tables in jarl.mjs (COMMAND_ARGS, COMMAND_FLAGS,
// GLOBAL_FLAGS, MUTATING, COMMAND_SUMMARY) become one Runes command table, TABLE, and the adapter generates the tools
// from it: one tool per command, jarl_<command>, one field per argument and per flag under the flag's own name, and
// jarl_help answering with the usage text. A tool's description is one sentence (what the command does, after
// whether it writes); the full usage of every command is what jarl_help prints, the same text as --help. A call is
// turned back into the argv the CLI would get by the adapter's argvFor, parsed by the CLI's parseArgs and run by its
// dispatch — the same function main() runs, which empties the per-command git caches first, so a server that lives
// for a whole session sees disk and git as they are now, exactly as a fresh process would. The stdio transport is
// the adapter's too (serveStdio): one call at a time, cancellations, the client going away.
//
// Why this file keeps its own call and its own message handler instead of the adapter's createServer: dispatch is
// synchronous and runs in this process, so the adapter's timeout and cancel could never stop it (Runes says so of
// a synchronous in-process run), and the result below is Jarl's published contract — the loop note and the CLI's
// stderr notes under _meta 'jarl/loop' and 'jarl/warn', a refusal as its text — which callers and the tests read
// synchronously.
//
// Result: with json: true the content is exactly one text block, the JSON --json prints, so a client that
// concatenates blocks never has to skip anything to parse it; the CLI's stderr notes and the "which loop" note
// below go into _meta ('jarl/warn', 'jarl/loop') instead. Without json, stdout is the first text block, stderr
// notes are a second one, and a refusal (the CLI's exit 1) and a failed check (exit 2) come back with isError:
// true and the text. The loop: the root field, else JARL_ROOT from the server's environment — refused unless it
// is absolute, for the same reason "root" is: a relative one would resolve against the server's own working
// directory, not the caller's, and silently reach whatever loop happens to sit there — else the loop found from
// the server's working directory, the way the CLI finds it from its own. Writes: dispatch runs synchronously and
// the server handles one call at a time, so its calls never overlap; against other processes (the CLI, other
// sessions' servers) every writing command holds .jarl/.lock exactly as the CLI does.
//
// Wire format: newline-delimited JSON-RPC 2.0 on stdin/stdout (MCP stdio transport); stderr is for diagnostics.
// No dependencies beyond the vendored copy, Node 22+.
import { readFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMAND_ARGS, COMMAND_FLAGS, COMMAND_SUMMARY, GLOBAL_FLAGS, MUTATING, USAGE, parseArgs, dispatch, findRoot, isEntry as isEntryOf } from './jarl.mjs';
import { defineTable } from './vendor/runes/dist/cli/index.mjs';
import {
  buildTools as generateTools, argvFor as generateArgv, commandForTool, serveStdio, InvalidParams,
  PROTOCOL_VERSION as RUNES_PROTOCOL_VERSION, PROTOCOL_VERSIONS as RUNES_PROTOCOL_VERSIONS,
} from './vendor/runes/dist/mcp/index.mjs';

export const PROTOCOL_VERSION = RUNES_PROTOCOL_VERSION;
// The versions this server can speak: it uses nothing a later one added beyond tool annotations, which an
// older client ignores. A client asking for one of these gets it back; any other gets PROTOCOL_VERSION.
export const PROTOCOL_VERSIONS = RUNES_PROTOCOL_VERSIONS;
// The fields that name a file on disk: read against the server's working directory, which is not the caller's,
// so they must be absolute.
export const PATH_FIELDS = { import: ['file'], sources: ['files'], init: ['profile'], profile: ['file'] };
function version() {
  // The plugin's manifest, when the skill runs from a plugin install; a drop-in copy has none.
  try { return JSON.parse(readFileSync(new URL('../../../plugin.json', import.meta.url), 'utf8')).version || '0.0.0'; } catch { return '0.0.0'; }
}
const SERVER_INFO = { name: 'jarl', version: version() };

export const TOOL_PREFIX = 'jarl_';
export const toolName = (cmd) => `${TOOL_PREFIX}${cmd}`;
export const argName = (a) => a.replace(/[?.]+$/, '');

// What a command's table cannot say about its arguments, added to that tool's description.
export const ARG_NOTES = {
  set: 'The "status" field may instead name a field the loop\'s profile declares (see jarl_profile), and "why" is then that field\'s value: set <ids> <field> "<value>".',
};
const IDS_NOTE = 'An ids field is one id or several as one comma list with ranges (12,13,14 or 203-206,209); every id and every precondition is checked before anything is written, so the call lands on all of them or on none.';
const IDS_FIELD = 'One id, or several as one comma list with ranges (12,13 or 203-206): all of them change, or none.';
const ROOT_FIELD = "The directory holding .jarl/, as an absolute path (a relative or empty one is refused). Defaults to JARL_ROOT from the server's environment, else the loop found from the server's working directory. Workers in a worktree and every role of a loop that lives in another repository pass it always.";
const HELP = `${USAGE}\n\n${IDS_NOTE}\n\n${Object.entries(ARG_NOTES).map(([c, n]) => `${toolName(c)}: ${n}`).join('\n')}`;
const INSTRUCTIONS = 'Every jarl command is a tool, jarl_<command>, with its arguments and flags as fields. A description is one sentence; jarl_help answers with the full usage of every command.';

// The CLI's tables as one Runes command table. An argument written `name...` in COMMAND_ARGS takes any number of
// words, none included (tag's +a -b, sources' findings files): `name...?` in the Runes grammar.
export const TABLE = defineTable({
  tool: 'jarl',
  globalFlags: GLOBAL_FLAGS,
  commands: Object.fromEntries(Object.keys(COMMAND_FLAGS).map((cmd) => [cmd, {
    args: COMMAND_ARGS[cmd].map((a) => (a.endsWith('...') ? `${a}?` : a)),
    flags: COMMAND_FLAGS[cmd],
    summary: COMMAND_SUMMARY[cmd],
    writes: MUTATING.has(cmd),
    destructive: cmd === 'close' || cmd === 'archive',
    ...(PATH_FIELDS[cmd] ? { paths: PATH_FIELDS[cmd] } : {}),
  }])),
});

function describe(cmd, spec) {
  const effect = spec.writes ? 'WRITES the loop.' : 'Read-only.';
  return `${effect} ${spec.summary}${ARG_NOTES[cmd] ? ` ${ARG_NOTES[cmd]}` : ''}`;
}
function fieldNote(_cmd, field) {
  if (field === 'root') return ROOT_FIELD;
  if (field === 'ids') return IDS_FIELD;
  return undefined;
}
// The options the tools are generated with: the prefix, the one-sentence descriptions, the notes on root and ids,
// and the help tool. The parity test builds its reference from the same options.
export const TOOL_OPTIONS = { prefix: TOOL_PREFIX, describe, fieldNote, help: HELP };

// Each command's block of the USAGE text: its synopsis (the lines before the description column) and its
// description, whitespace collapsed.
export function usageBlocks(usage = USAGE) {
  const lines = usage.split('\n');
  const start = lines.indexOf('commands:') + 1;
  const blocks = {};
  let cur = null;
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\S/.test(line)) break;   // "options:" ends the table
    const head = /^ {2}([a-z]+)\b/.exec(line);
    if (head && COMMAND_FLAGS[head[1]]) {
      const [syn, ...desc] = line.trim().split(/\s{2,}/);
      cur = blocks[head[1]] = { synopsis: [syn], description: desc };
      continue;
    }
    if (!cur || !line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    (indent < 20 ? cur.synopsis : cur.description).push(line.trim());
  }
  for (const b of Object.values(blocks)) { b.synopsis = b.synopsis.join(' '); b.description = b.description.join(' '); }
  return blocks;
}

// One tool per command and jarl_help, generated by the adapter from TABLE.
export function buildTools() { return generateTools(TABLE, TOOL_OPTIONS); }

// A refusal of the call's input: a JSON-RPC -32602 error, never a tool result. The adapter's InvalidParams, carrying
// the code where callers of this module read it.
const invalid = (msg) => Object.assign(new InvalidParams(msg), { code: -32602 });
function need(cond, msg) { if (!cond) throw invalid(msg); }

// A tool call back into the argv the CLI would be given: the command, every flag inline (--name=value, so a value
// that starts with -- is never read as a flag), then a bare -- and the arguments in order — the adapter's argvFor.
// parseArgs then checks it exactly as it checks a command line. "root" is checked here and resolved by the caller,
// never handed to dispatch as a flag.
export function argvFor(cmd, input = {}) {
  need(input !== null && typeof input === 'object' && !Array.isArray(input), `${toolName(cmd)}: arguments must be an object`);
  if (input.root !== undefined) {
    need(typeof input.root === 'string' && input.root.trim() !== '' && isAbsolute(input.root.trim()), `${toolName(cmd)}: "root" must be the absolute path of the checkout holding .jarl/ (got ${JSON.stringify(input.root)}) — leave it out to use JARL_ROOT or the server's working directory`);
  }
  const { root: _root, ...fields } = input;
  try { return generateArgv(TABLE, cmd, fields, TOOL_OPTIONS); } catch (e) {
    if (e instanceof InvalidParams) e.code = -32602;
    throw e;
  }
}

// The loop a call reaches, and where that came from: the root field, else JARL_ROOT, else the working directory.
// JARL_ROOT is refused unless it is absolute — resolving it against the server's cwd the way a shell would resolve
// a relative $PATH entry would silently reach whichever loop happens to sit there, in a process the caller does not
// control and mostly does not see; failing every call that would use it, rather than only refusing at server
// start, keeps working the common case where every call already passes its own absolute "root" (SKILL.md has
// every worker in a worktree do exactly that) and never silently misresolves the one that doesn't.
export function rootOf(input = {}, env = process.env, cwd = process.cwd()) {
  if (typeof input.root === 'string' && input.root.trim()) return { root: resolve(input.root.trim()), from: 'root' };
  if (env.JARL_ROOT && env.JARL_ROOT.trim()) {
    const raw = env.JARL_ROOT.trim();
    need(isAbsolute(raw), `JARL_ROOT must be an absolute path (got ${JSON.stringify(raw)}) — a relative one would resolve against the server's own working directory, not the caller's; pass "root" on the call instead, or fix the server's environment`);
    return { root: resolve(raw), from: 'JARL_ROOT' };
  }
  return { root: findRoot(cwd), from: 'cwd' };
}
export function rootFor(input = {}, env = process.env, cwd = process.cwd()) { return rootOf(input, env, cwd).root; }

// One tool call: { content, isError } as MCP returns it. Invalid fields throw InvalidParams (a JSON-RPC error);
// everything the CLI would print — its answer, its notes, its refusal — comes back as the result.
export function callTool(name, input = {}, env = process.env, cwd = process.cwd()) {
  if (name === toolName('help')) return { content: [{ type: 'text', text: HELP }], isError: false };
  const cmd = commandForTool(TABLE, name, TOOL_OPTIONS);
  if (cmd === null) throw invalid(`Unknown tool: ${name}`);
  const argv = argvFor(cmd, input);
  const { root, from } = rootOf(input, env, cwd);
  // A call that named no root is told which loop it reached, so a write never lands somewhere unseen. With
  // json: true this note (and the CLI's stderr notes) never become a second text block — a client that
  // concatenates the blocks to parse JSON would otherwise get invalid JSON — they go into _meta instead.
  const loopNote = from === 'root' ? null : `loop: ${root} (no root given — ${from === 'JARL_ROOT' ? 'from JARL_ROOT' : `found from the server's working directory ${cwd}`})`;
  let r;
  try {
    const { positional, flags } = parseArgs(argv);
    r = dispatch(root, cmd, positional.slice(1), flags);
  } catch (e) {
    const text = e?.message || String(e);   // the CLI's exit 1
    if (input.json) return { content: [{ type: 'text', text }], isError: true, ...(loopNote ? { _meta: { 'jarl/loop': loopNote } } : {}) };
    return { content: [{ type: 'text', text }, ...(loopNote ? [{ type: 'text', text: loopNote }] : [])], isError: true };
  }
  const isError = cmd === 'check' && !r.out.ok;   // check's exit 2: a check that failed
  if (input.json) {
    const meta = { ...(r.warn.length ? { 'jarl/warn': r.warn.join('\n') } : {}), ...(loopNote ? { 'jarl/loop': loopNote } : {}) };
    return { content: [{ type: 'text', text: JSON.stringify(r.out, null, 2) }], isError, ...(Object.keys(meta).length ? { _meta: meta } : {}) };
  }
  const content = [{ type: 'text', text: String(r.text ?? '') }];
  if (r.warn.length) content.push({ type: 'text', text: r.warn.join('\n') });
  if (loopNote) content.push({ type: 'text', text: loopNote });
  return { content, isError };
}

// ----- JSON-RPC / MCP -----
// One message's answer, or null for a notification or a response from the client — the adapter's rules, answered
// synchronously.
export function handle(msg, tools = buildTools()) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  const hasId = Object.hasOwn(msg, 'id');
  // A response from the client (to a request this server never sends): nothing to answer.
  if (msg.method === undefined && hasId && (Object.hasOwn(msg, 'result') || Object.hasOwn(msg, 'error'))) return null;
  if (typeof msg.method !== 'string') return hasId ? { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32600, message: 'Invalid Request' } } : null;
  if (!hasId) return null;   // a notification (initialized, cancelled): nothing to answer
  const { id, method, params } = msg;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (method === 'initialize') {
    const asked = params?.protocolVersion;
    return ok({ protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
  }
  if (method === 'ping') return ok({});
  if (method === 'tools/list') return ok({ tools });
  if (method === 'tools/call') {
    try { return ok(callTool(params?.name, params?.arguments || {})); } catch (e) {
      if (e instanceof InvalidParams) return err(-32602, e.message);
      return err(-32603, e?.message || String(e));
    }
  }
  return err(-32601, `Method not found: ${method}`);
}

// The adapter's stdio transport over this handler: calls one at a time, in order (dispatch is synchronous, so a
// call runs to its end before the next is read); stdin closing or a signal ends the server.
function serve() {
  const tools = buildTools();
  serveStdio({
    tools,
    handle: async (msg) => handle(msg, tools),
    callTool: async (name, input) => callTool(name, input),
    idle: async () => {},
  }, { log: (line) => console.error(line.replace('[mcp]', '[jarl-mcp]')) });
}

// Run as the server only when this file is the script the process was started with (isEntry in jarl-lib.mjs: real
// paths, without case on Windows — a mismatch would leave the server silent, and the client waiting on it).
export function isEntry(argv1, self = fileURLToPath(import.meta.url), platform = process.platform) { return isEntryOf(argv1, self, platform); }
if (isEntry(process.argv[1])) serve();
