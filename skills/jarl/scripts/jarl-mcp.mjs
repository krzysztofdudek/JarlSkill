#!/usr/bin/env node
// jarl-mcp.mjs — the jarl tool over MCP: a protocol adapter, not a second implementation.
//
// Every tool is generated from the CLI's own tables (COMMAND_ARGS, COMMAND_FLAGS, GLOBAL_FLAGS, MUTATING and the
// USAGE text in jarl.mjs), one tool per command, jarl_<command>, with one field per argument and per flag under
// the flag's own name. A call is turned back into the argv the CLI would get, parsed by the CLI's parseArgs and run
// by its dispatch — the same function main() runs, which empties the per-command git caches first, so a server
// that lives for a whole session sees disk and git as they are now, exactly as a fresh process would.
//
// Result: what the CLI prints on stdout is the first text block (JSON with json: true, as --json prints it); what it
// says on stderr (notes) is a second one; a refusal (the CLI's exit 1) and a failed check (exit 2) come back with
// isError: true and the text. The loop: the root field, else JARL_ROOT from the server's environment, else the loop
// found from the server's working directory, the way the CLI finds it from its own. Writes: dispatch runs
// synchronously and the server handles one message at a time, so its calls never overlap; against other processes
// (the CLI, other sessions' servers) every writing command holds .jarl/.lock exactly as the CLI does.
//
// Wire format: newline-delimited JSON-RPC 2.0 on stdin/stdout (MCP stdio transport); stderr is for diagnostics.
// Zero dependencies, Node 18+.
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMAND_ARGS, COMMAND_FLAGS, GLOBAL_FLAGS, MUTATING, USAGE, parseArgs, dispatch, findRoot } from './jarl.mjs';

export const PROTOCOL_VERSION = '2025-06-18';
// The versions this server can speak: it uses nothing a later one added beyond tool annotations, which an
// older client ignores. A client asking for one of these gets it back; any other gets PROTOCOL_VERSION.
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
// The fields that name a file on disk: read against the server's working directory, which is not the caller's,
// so they must be absolute.
const PATH_FIELDS = { import: ['file'], sources: ['files'] };
function version() {
  // The plugin's manifest, when the skill runs from a plugin install; a drop-in copy has none.
  try { return JSON.parse(readFileSync(new URL('../../../plugin.json', import.meta.url), 'utf8')).version || '0.0.0'; } catch { return '0.0.0'; }
}
const SERVER_INFO = { name: 'jarl', version: version() };

export const TOOL_PREFIX = 'jarl_';
export const toolName = (cmd) => `${TOOL_PREFIX}${cmd}`;
export const argName = (a) => a.replace(/[?.]+$/, '');
const optional = (a) => a.endsWith('?');
const variadic = (a) => a.endsWith('...');

// Each command's block of the USAGE text: its synopsis (the lines before the description column) and its
// description, whitespace collapsed. The text the CLI prints for --help is the one the tools describe themselves with.
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
// The paragraphs after the table (ids, flags, writes, --repo), for the help tool.
const IDS_NOTE = 'An ids field is one id or several as one comma list with ranges (12,13,14 or 203-206,209); every id and every precondition is checked before anything is written, so the call lands on all of them or on none.';

function flagSchema(name, kind) {
  if (kind === 'bool') return { type: 'boolean', description: `--${name} on the CLI.` };
  if (kind === 'many') return { type: 'array', items: { type: 'string' }, description: `--${name} on the CLI, repeatable: one value per item (a single string is taken as one item).` };
  return { type: 'string', description: `--${name} <value> on the CLI.` };
}

// One tool per command, generated. The field names are the CLI's own: each argument under its name in
// COMMAND_ARGS, each flag under its name without the dashes (found-by, dry-run, stale-hours), json and root on all.
export function buildTools() {
  const blocks = usageBlocks();
  const tools = [];
  for (const cmd of Object.keys(COMMAND_FLAGS)) {
    const args = COMMAND_ARGS[cmd] || [];
    const writes = MUTATING.has(cmd);
    const b = blocks[cmd] || { synopsis: cmd, description: '' };
    const properties = {};
    const required = [];
    args.forEach((a, i) => {
      const n = argName(a);
      properties[n] = variadic(a)
        ? { type: 'array', items: { type: 'string' }, description: `Argument ${i + 1} of the CLI synopsis and every one after it, one per item.` }
        : { type: 'string', description: `Argument ${i + 1} of the CLI synopsis${optional(a) ? ' (may be left out)' : ''}.` };
      if (!optional(a) && !variadic(a)) required.push(n);
    });
    for (const [f, kind] of Object.entries(COMMAND_FLAGS[cmd])) properties[f] = flagSchema(f, kind);
    properties.json = { type: 'boolean', description: 'Answer with the JSON --json prints instead of the text.' };
    for (const f of PATH_FIELDS[cmd] || []) properties[f].description += ' An absolute path: the server does not run in your working directory, so a relative one is refused.';
    properties.root = { type: 'string', description: "--root: the directory holding .jarl/, as an absolute path (a relative or empty one is refused). Defaults to JARL_ROOT from the server's environment, else the loop found from the server's working directory. Workers in a worktree and every role of a loop that lives in another repository pass it always." };
    const effect = writes
      ? `WRITES the loop (.jarl/), holding .jarl/.lock while it runs.`
      : cmd === 'handoff' ? 'Read-only (write is retired and writes nothing).' : 'Read-only: writes nothing.';
    const takesIds = args.some((a) => argName(a) === 'ids');
    tools.push({
      name: toolName(cmd),
      description: `${effect} CLI: jarl.mjs ${b.synopsis} — ${b.description.replace(/[.;,]?$/, '.')}${takesIds ? ` ${IDS_NOTE}` : ''}`,
      inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false },
      annotations: { readOnlyHint: !writes, destructiveHint: cmd === 'close' || cmd === 'archive', idempotentHint: false, openWorldHint: false },
    });
  }
  tools.push({
    name: toolName('help'),
    description: 'Read-only: the CLI usage text (what --help prints) — every command, flag and rule the jarl tools are generated from.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  });
  return tools;
}

class ProtocolError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const invalid = (msg) => new ProtocolError(-32602, msg);
const scalar = (v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));

// A tool call back into the argv the CLI would be given: the command, every flag inline (--name=value, so a value
// that starts with -- is never read as a flag), then a bare -- and the arguments in order. parseArgs then checks it
// exactly as it checks a command line.
export function argvFor(cmd, input = {}) {
  need(input !== null && typeof input === 'object' && !Array.isArray(input), `${toolName(cmd)}: arguments must be an object`);
  const args = COMMAND_ARGS[cmd] || [];
  const flags = { ...GLOBAL_FLAGS, ...COMMAND_FLAGS[cmd] };
  delete flags.help;
  const known = new Set([...args.map(argName), ...Object.keys(flags)]);
  for (const k of Object.keys(input)) need(known.has(k), `${toolName(cmd)}: unknown field "${k}" — it takes ${[...known].join(', ')}`);
  if (input.root !== undefined) {
    need(typeof input.root === 'string' && input.root.trim() !== '' && isAbsolute(input.root.trim()), `${toolName(cmd)}: "root" must be the absolute path of the checkout holding .jarl/ (got ${JSON.stringify(input.root)}) — leave it out to use JARL_ROOT or the server's working directory`);
  }
  for (const a of args) if (!optional(a) && !variadic(a)) need(input[argName(a)] !== undefined && input[argName(a)] !== null, `${toolName(cmd)}: "${argName(a)}" is required`);
  for (const f of PATH_FIELDS[cmd] || []) {
    for (const x of [].concat(input[f] ?? [])) need(typeof x === 'string' && isAbsolute(x), `${toolName(cmd)}: "${f}" must be an absolute path (got ${JSON.stringify(x)}) — the server does not run in your working directory`);
  }
  const argv = [cmd];
  for (const [f, kind] of Object.entries(flags)) {
    if (f === 'root') continue;   // resolved by the caller, not handed to dispatch as a flag
    const v = input[f];
    if (v === undefined || v === null) continue;
    if (kind === 'bool') {
      need(typeof v === 'boolean', `${toolName(cmd)}: "${f}" must be true or false`);
      if (v) argv.push(`--${f}`);
    } else if (kind === 'many') {
      const list = [].concat(v);
      need(list.every(scalar), `${toolName(cmd)}: "${f}" must be a string or a list of strings`);
      for (const x of list) argv.push(`--${f}=${x}`);
    } else {
      need(scalar(v), `${toolName(cmd)}: "${f}" must be a string`);
      argv.push(`--${f}=${v}`);
    }
  }
  const words = [];
  let gap = null;
  for (const a of args) {
    const n = argName(a);
    const v = input[n];
    if (v === undefined || v === null) { gap = gap || n; continue; }
    need(gap === null, `${toolName(cmd)}: "${n}" is given but "${gap}" before it is not — the arguments are read in order`);
    if (variadic(a)) {
      const list = [].concat(v);
      need(list.every(scalar), `${toolName(cmd)}: "${n}" must be a list of strings`);
      words.push(...list.map(String));
    } else {
      need(scalar(v), `${toolName(cmd)}: "${n}" must be a string`);
      words.push(String(v));
    }
  }
  if (words.length) argv.push('--', ...words);
  return argv;
}
function need(cond, msg) { if (!cond) throw invalid(msg); }

// The loop a call reaches, and where that came from: the root field, else JARL_ROOT, else the working directory.
export function rootOf(input = {}, env = process.env, cwd = process.cwd()) {
  if (typeof input.root === 'string' && input.root.trim()) return { root: resolve(input.root.trim()), from: 'root' };
  if (env.JARL_ROOT && env.JARL_ROOT.trim()) return { root: resolve(cwd, env.JARL_ROOT.trim()), from: 'JARL_ROOT' };
  return { root: findRoot(cwd), from: 'cwd' };
}
export function rootFor(input = {}, env = process.env, cwd = process.cwd()) { return rootOf(input, env, cwd).root; }

// One tool call: { content, isError } as MCP returns it. Invalid fields throw a ProtocolError (a JSON-RPC error);
// everything the CLI would print — its answer, its notes, its refusal — comes back as the result.
export function callTool(name, input = {}, env = process.env, cwd = process.cwd()) {
  if (name === toolName('help')) return { content: [{ type: 'text', text: `${USAGE}\n\n${IDS_NOTE}` }], isError: false };
  const cmd = typeof name === 'string' && name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : null;
  if (!cmd || !Object.hasOwn(COMMAND_FLAGS, cmd)) throw invalid(`Unknown tool: ${name}`);
  const argv = argvFor(cmd, input);
  const { root, from } = rootOf(input, env, cwd);
  // A call that named no root is told which loop it reached, so a write never lands somewhere unseen.
  const where = from === 'root' ? [] : [{ type: 'text', text: `loop: ${root} (no root given — ${from === 'JARL_ROOT' ? 'from JARL_ROOT' : `found from the server's working directory ${cwd}`})` }];
  let r;
  try {
    const { positional, flags } = parseArgs(argv);
    r = dispatch(root, cmd, positional.slice(1), flags);
  } catch (e) {
    return { content: [{ type: 'text', text: e?.message || String(e) }, ...where], isError: true };   // the CLI's exit 1
  }
  const text = input.json ? JSON.stringify(r.out, null, 2) : String(r.text ?? '');
  const content = [{ type: 'text', text }];
  if (r.warn.length) content.push({ type: 'text', text: r.warn.join('\n') });
  content.push(...where);
  return { content, isError: cmd === 'check' && !r.out.ok };   // check's exit 2: a check that failed
}

// ----- JSON-RPC / MCP -----
export function handle(msg, tools = buildTools()) {
  const { id, method, params } = msg;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (method === 'initialize') {
    const asked = params?.protocolVersion;
    return ok({ protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
  }
  if (method === 'ping') return ok({});
  if (method === 'tools/list') return ok({ tools });
  if (method === 'tools/call') {
    try { return ok(callTool(params?.name, params?.arguments || {})); } catch (e) {
      if (e instanceof ProtocolError) return err(e.code, e.message);
      return err(-32603, e?.message || String(e));
    }
  }
  return err(-32601, `Method not found: ${method}`);
}

function serve() {
  const tools = buildTools();
  const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
  const onLine = (line) => {
    const t = line.trim();
    if (!t) return;
    let msg;
    try { msg = JSON.parse(t); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    const hasId = msg && Object.hasOwn(msg, 'id');
    // A response from the client (to a request this server never sends): nothing to answer.
    if (msg && typeof msg === 'object' && msg.method === undefined && hasId && (Object.hasOwn(msg, 'result') || Object.hasOwn(msg, 'error'))) return;
    if (!msg || typeof msg.method !== 'string') { if (hasId) send({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32600, message: 'Invalid Request' } }); return; }
    if (!hasId) return;   // a notification (initialized, cancelled): nothing to answer
    try { send(handle(msg, tools)); } catch (e) { send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e?.message || String(e) } }); }
  };
  // One message at a time, in order: dispatch is synchronous, so a call runs to its end before the next is read.
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => { try { onLine(line); } catch (e) { console.error('[jarl-mcp]', e?.stack || e); } });
  rl.on('close', () => process.stdout.write('', () => process.exit(0)));
  process.on('uncaughtException', (e) => console.error('[jarl-mcp] uncaught:', e?.stack || e));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) serve();
