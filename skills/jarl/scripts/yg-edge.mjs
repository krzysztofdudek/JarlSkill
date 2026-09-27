// yg-edge.mjs — Jarl's one optional edge to another family tool, and the only place in Jarl's code that reaches one.
//
// A ruling about a whole area of code (`decide --area <type>`) that the user ratified is written into that type's
// decision log in Yggdrasil (`yg log add --type <type>`), so an agent touching any other file of the type reads it.
// The edge is optional: it is taken only when the loop's repository holds a Yggdrasil graph (.yggdrasil/) and a
// working yg answers the probe `npx --no-install yg --version`. Without either, nothing is written and the ruling
// stays in decisions.md, as every ruling does. A write that fails is reported, never retried and never fatal.
//
// The family guard (guard.allow at the repository root) allows this file, and only this file, to name that state
// directory and run that command. Zero dependencies, Node 22+.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const GRAPH_DIR = '.yggdrasil';
// The test knob: JARL_YG names the command that stands in for `npx --no-install yg` (a script ending in .js, .mjs or
// .cjs is run by process.execPath, so a stub works the same on every OS).
const PROBE_MS = 60_000;
const WRITE_MS = 120_000;

function gitTop(dir) {
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}

// Where the graph is: the loop's root, else the top of the repository holding it. Null when neither has one.
export function graphRepo(root) {
  if (existsSync(join(root, GRAPH_DIR))) return root;
  const top = gitTop(root);
  return top && existsSync(join(top, GRAPH_DIR)) ? top : null;
}

function command() {
  const bin = process.env.JARL_YG;
  if (bin) return /\.[cm]?js$/i.test(bin) ? { file: process.execPath, pre: [bin] } : { file: bin, pre: [] };
  return { file: 'npx', pre: ['--no-install', 'yg'] };
}

// One run, output captured. On Windows a bare command name (npx is npx.cmd there) needs the shell, so every word is
// quoted for it; the words are a type name, a flag, a timestamp and a temporary file path, none holding a quote.
function run(cwd, args, timeout) {
  const { file, pre } = command();
  const all = [...pre, ...args];
  const opts = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } };
  if (process.platform === 'win32' && file !== process.execPath) {
    return execFileSync(`"${file}"`, all.map((a) => `"${a}"`), { ...opts, shell: true, windowsHide: true });
  }
  return execFileSync(file, all, opts);
}

function failure(e) {
  const said = `${e.stderr || ''}\n${e.stdout || ''}`.split('\n').map((l) => l.trim()).filter(Boolean);
  return said.length ? said.slice(0, 12).join(' | ') : e.message.split('\n')[0];
}

// Writes one ratified area ruling (the typeDecision an answer hands back) into the type's decision log. `supersedes` is the timestamp of the earlier entry of
// that log it replaces, when Jarl wrote that one too. The answer is one of:
//   { state: 'skipped', reason }             no graph, or no working yg: nothing was attempted
//   { state: 'written', repo, datetime }     the entry is in the log
//   { state: 'failed', repo, reason, retry } yg refused or broke; retry is the command to run by hand
// A type log that already holds decisions in force refuses an entry that says nothing about them (Yggdrasil's own
// guard): Jarl passes that refusal on with the decisions it listed, and the person writing it by hand chooses
// --supersedes or --adds, having seen them.
export function writeAreaDecision(root, { type, text, supersedes = null }) {
  const repo = graphRepo(root);
  if (!repo) return { state: 'skipped', reason: `no ${GRAPH_DIR}/ in the loop's repository` };
  try { run(repo, ['--version'], PROBE_MS); } catch { return { state: 'skipped', reason: `${GRAPH_DIR}/ found, but no working yg answers \`npx --no-install yg --version\` there` }; }
  const dir = mkdtempSync(join(tmpdir(), 'jarl-area-'));
  const file = join(dir, 'decision.md');
  const args = ['log', 'add', '--type', type, '--reason-file', file, ...(supersedes ? ['--supersedes', supersedes] : [])];
  const retry = `yg log add --type ${type} --reason '<the ruling>'${supersedes ? ` --supersedes ${supersedes}` : ''}`;
  try {
    writeFileSync(file, `${text.trim()}\n`);
    const out = run(repo, args, WRITE_MS);
    const datetime = /Timestamp:\s*(\S+)/.exec(out)?.[1] || null;
    return { state: 'written', repo, datetime };
  } catch (e) {
    return { state: 'failed', repo, reason: failure(e), retry };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
