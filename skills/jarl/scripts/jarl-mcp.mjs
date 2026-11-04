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
// Wire format: newline-delimited JSON-RPC on stdin/stdout (MCP stdio transport); stderr is for diagnostics.
// No dependencies beyond the vendored copy, Node 22+.
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTHOR_REQUIRED, COMMAND_ARGS, COMMAND_FLAGS, INTERNAL_COMMANDS, LIST_FIELDS, REPLACED_COMMANDS, replacedMessage, flagsOf, COMMAND_SUMMARY, GLOBAL_FLAGS, MUTATING, USAGE, parseArgs, dispatch, findRoot, isEntry as isEntryOf, installVersion } from './jarl.mjs';
import { defineTable } from './vendor/runes/dist/cli/index.mjs';
import {
  buildTools as generateTools, argvFor as generateArgv, commandForTool, serveStdio, InvalidParams,
  PROTOCOL_VERSION as RUNES_PROTOCOL_VERSION, PROTOCOL_VERSIONS as RUNES_PROTOCOL_VERSIONS,
} from './vendor/runes/dist/mcp/index.mjs';

export const PROTOCOL_VERSION = RUNES_PROTOCOL_VERSION;
// The protocol revisions this server speaks: it uses nothing beyond tool annotations, which a client that does not
// know them ignores. A client asking for one of these gets it back; any other gets PROTOCOL_VERSION.
export const PROTOCOL_VERSIONS = RUNES_PROTOCOL_VERSIONS;
// The fields that name a file on disk: read against the server's working directory, which is not the caller's,
// so they must be absolute.
export const PATH_FIELDS = { import: ['file'], sources: ['files'], init: ['profile'], profile: ['file'] };
const SERVER_INFO = { name: 'jarl', version: installVersion() };

export const TOOL_PREFIX = 'jarl_';
export const toolName = (cmd) => `${TOOL_PREFIX}${cmd}`;
export const argName = (a) => a.replace(/[?.]+$/, '');

// What a command's table cannot say about its arguments, added to that tool's description.
export const ARG_NOTES = {};
// The list fields of a command (LIST_FIELDS in jarl.mjs).
const listFieldsOf = (cmd) => LIST_FIELDS[cmd] || {};
// The id-list fields of a command: its arguments that take the list grammar and are not the last words of the command
// (the id of one issue, or the ids of several). The adapter types an argument that comes before others as one text, so
// the tools declare each of these as a list too, and argvFor joins a list into the one comma list the command reads.
export const listArgsOf = (cmd) => {
  const fields = listFieldsOf(cmd);
  return (COMMAND_ARGS[cmd] || []).filter((a) => !a.endsWith('...')).map((a) => a.replace(/\?$/, '')).filter((a) => Object.hasOwn(fields, a));
};
// The commands that write one issue at a time and take the list grammar in their "id" field.
const LIST_ID_COMMANDS = new Set(['round']);
const IDS_FIELD = 'One id, or several as one comma list with ranges (12,13 or 203-206) or as a list of strings: all of them change, or none.';
// Every other list field: one rule for all of them, listItems in jarl.mjs.
const LIST_FIELD = 'One item, several as one comma list (a,b), or a list of strings, one item each. A list written as text (["a", "b"]), an item in quotes, or an item starting with - is refused.';
// The answer command takes one question, or several ratify items as one comma list (answer 2,3,4), with no ranges.
const ANSWER_ID_FIELD = 'One question id, or several ratify items as one comma list (2,3,4) or as a list of strings: all of them take the one answer.';
const ROOT_FIELD = "The directory holding .jarl/, as an absolute path (a relative or empty one is refused). Defaults to JARL_ROOT from the server's environment, else the loop found from the server's working directory. Workers in a worktree and every role of a loop that lives in another repository pass it always.";
// The usage text whole: the ids grammar is in it, and its last section is the workflow for parallel workers.
const HELP = USAGE;
// Hosts keep these in the session's standing instructions, so the last sentence outlives a compaction that loses the skill.
const INSTRUCTIONS = 'Every jarl command is a tool, jarl_<command>, with its arguments and flags as fields. A description is one sentence; jarl_help answers with the full usage of every command. After a compaction, or any summary of your own context, you are starting a session: run jarl_resume before your next action; a summary is not the state of the loop.';

// The CLI's tables as one Runes command table. An argument written `name...` in COMMAND_ARGS takes any number of
// words, none included (sources' findings files): `name...?` in the Runes grammar.
const entry = (cmd) => ({
  args: COMMAND_ARGS[cmd].map((a) => (a.endsWith('...') ? `${a}?` : a)),
  flags: flagsOf(cmd),
  summary: COMMAND_SUMMARY[cmd],
  writes: MUTATING.has(cmd),
  destructive: cmd === 'close' || cmd === 'archive',
  ...(INTERNAL_COMMANDS.includes(cmd) ? { internal: true } : {}),
  ...(PATH_FIELDS[cmd] ? { paths: PATH_FIELDS[cmd] } : {}),
});
export const TABLE = defineTable({
  tool: 'jarl',
  globalFlags: GLOBAL_FLAGS,
  commands: {
    ...Object.fromEntries(Object.keys(COMMAND_FLAGS).map((cmd) => [cmd, entry(cmd)])),
  },
});

function describe(cmd, spec) {
  const effect = spec.writes ? 'WRITES the loop.' : 'Read-only.';
  return `${effect} ${spec.summary}${ARG_NOTES[cmd] ? ` ${ARG_NOTES[cmd]}` : ''}`;
}
function baseNote(cmd, field) {
  if (field === 'root') return ROOT_FIELD;
  if (field === 'by' && AUTHOR_REQUIRED[cmd]) return `Required: ${AUTHOR_REQUIRED[cmd]}.`;
  if (field === 'ids' || (field === 'id' && LIST_ID_COMMANDS.has(cmd))) return IDS_FIELD;
  if (field === 'id' && cmd === 'answer') return ANSWER_ID_FIELD;
  if (cmd === 'field' && field === 'value') return 'The value of the part, one text: a comma list for a list field (Tags, Files, Repo, After, Source, Resources), one item per line for Acceptance and Changelog. Left out when clear is set. Example: {"ids": "12", "name": "Tags", "value": "docs,cli", "add": true}';
  if (['name', 'path'].includes(listFieldsOf(cmd)[field])) return LIST_FIELD;
  return undefined;
}
// The example that ends a field's description where its name does not give its meaning: a call of the command's own
// tool as JSON, so one line shows the field, the fields beside it and the type each one takes. A test holds every example
// to the fields and the types of its tool.
const EXAMPLES = {
  evidence: {
    ran: 'One command per row, a list of strings. Row n pairs with the text at place n of saw. Example: {"ids": "12", "ran": ["npm test"], "saw": ["# pass 4 # fail 0"]}',
    saw: 'What each command of ran printed, a list of strings in the same order. Example: {"ids": "12", "ran": ["npm test"], "saw": ["# pass 4 # fail 0"]}',
  },
  review: {
    verdict: 'approve or changes: the verdict of this reviewer on each issue. Example: {"ids": "12", "verdict": "approve", "by": "rev-12", "text": "Read the diff and the acceptance: every line holds."}',
    text: 'What the reviewer read and found, at least three words, also when nothing is wrong. Example: {"ids": "12", "verdict": "approve", "by": "rev-12", "text": "Read the diff and the acceptance: every line holds."}',
  },
  decide: {
    supersedes: 'The slug of the ruling this one replaces, which the record then marks as superseded. Example: {"slug": "subagents-again", "text": "Use fresh reviewers again.", "by": "jarl", "supersedes": "no-subagents"}',
  },
  decisions: {
    live: 'true lists only the rulings still in force, those no later ruling supersedes. Example: {"live": true}',
  },
  field: {
    add: 'true adds the items of value to a list field, or value after what a section holds. Example: {"ids": "12", "name": "Acceptance", "value": "the new line", "add": true}',
    remove: 'true takes the items of value off a list field. Example: {"ids": "12", "name": "Tags", "value": "docs", "remove": true}',
  },
};
function fieldNote(cmd, field) {
  return [baseNote(cmd, field), EXAMPLES[cmd]?.[field]].filter(Boolean).join(' ') || undefined;
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

// One tool per command and jarl_help, generated by the adapter from TABLE. Each id-list field is declared as a list too,
// not only as one text (listArgsOf), so a client that reads the schema sends a list of ids as a list.
export function buildTools() {
  return generateTools(TABLE, TOOL_OPTIONS).map((tool) => {
    const cmd = commandForTool(TABLE, tool.name, TOOL_OPTIONS);
    for (const field of cmd === null ? [] : listArgsOf(cmd)) {
      tool.inputSchema.properties[field] = { ...tool.inputSchema.properties[field], type: ['string', 'array'], items: { type: 'string' } };
    }
    // A write that records a judgement names its author: the schema requires by, as the command line does.
    if (cmd !== null && AUTHOR_REQUIRED[cmd]) tool.inputSchema.required = [...new Set([...(tool.inputSchema.required || []), 'by'])];
    return tool;
  });
}

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
    need(typeof input.root === 'string' && input.root.trim() !== '' && isAbsolute(input.root.trim()), `${toolName(cmd)}: "root" must be the absolute path of the directory that holds .jarl/ (got ${JSON.stringify(input.root)}) — leave it out to use JARL_ROOT or the server's working directory`);
  }
  const { root: _root, ...fields } = input;
  // A list flag repeats and a list argument that comes last takes many words, so the adapter carries a list for them.
  // An id list comes before other arguments, so the adapter takes it as one word: given as a list of strings, it
  // reaches the command line as the one comma list it reads there. listItems in dispatch checks the items either way.
  for (const field of listArgsOf(cmd)) {
    const v = fields[field];
    if (!Array.isArray(v)) continue;
    need(v.every((x) => typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x))), `${toolName(cmd)}: "${field}" must be a string or a list of strings`);
    fields[field] = v.join(',');
  }
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
  if (name === toolName('help')) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) throw invalid(`${name}: arguments must be an object`);
    const shared = Object.keys(GLOBAL_FLAGS).filter((f) => f !== 'help');
    const extra = Object.keys(input).filter((k) => !shared.includes(k));
    if (extra.length) throw invalid(`${name}: unknown field "${extra[0]}" — it takes ${shared.length ? shared.join(', ') : 'no fields'}`);
    return { content: [{ type: 'text', text: HELP }], isError: false };
  }
  const cmd = commandForTool(TABLE, name, TOOL_OPTIONS);
  // A tool the server does not have, under the name of a command the CLI refuses with its replacement: the same line.
  const asked = typeof name === 'string' && name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : null;
  if (cmd === null && asked !== null && Object.hasOwn(REPLACED_COMMANDS, asked)) throw invalid(`Unknown tool: ${name} — ${replacedMessage(asked)}`);
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
  const isError = cmd === 'scope' && !r.out.ok;   // scope's exit 2: a branch that failed its measure
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
