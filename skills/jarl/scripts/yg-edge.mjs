// yg-edge.mjs — Jarl's one optional edge to another family tool, and the only place in Jarl's code that reaches one.
//
// A ruling about a whole area of code (`decide --area <type>`) that the user ratified is written into that type's
// decision log in Yggdrasil (`yg log add --type <type>`), so an agent touching any other file of the type reads it.
// When the ruling names a rule of the graph (`decide --area <type> --rule <id>`), the user's yes is also written into
// that rule's own log as a ratification (`yg log add --aspect <id> --ratify --by <who>`): what lets the rule stand
// enforced on the types it reaches, and what clears Yggdrasil's type-law-unratified for it.
// The edge is optional: it is taken only when the loop's repository holds a Yggdrasil graph (.yggdrasil/) and a
// working yg answers the probe `npx --no-install yg --version`. Without either, nothing is written and the ruling
// stays in decisions.md, as every ruling does. A write that fails is reported, never retried and never fatal.
//
// The family guard (guard.allow at the repository root) allows this file, and only this file, to name that state
// directory and run that command. Zero dependencies, Node 22+.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, execSync } from 'node:child_process';

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

// One run, output captured. On Windows a bare command name (npx is npx.cmd there) runs only through the shell (cmd.exe),
// so the command line is built as one string, every word in double quotes. No word may hold what cmd.exe would read
// inside quotes (a quote, %, !, a line break): writeAreaDecision and writeRuleRatification pass only a checked type
// name or rule id, a checked timestamp, a checked name, flags and a temporary file path, and the ruling's text goes
// through that file, never the command line.
const SHELL_UNSAFE = /["%!\r\n]/;
function run(cwd, args, timeout) {
  const { file, pre } = command();
  const all = [...pre, ...args];
  const opts = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } };
  if (process.platform === 'win32' && file !== process.execPath) {
    const words = [file, ...all];
    const bad = words.find((w) => SHELL_UNSAFE.test(w));
    if (bad !== undefined) throw new Error(`refused to pass ${JSON.stringify(bad)} through the Windows shell`);
    return execSync(words.map((w) => `"${w}"`).join(' '), { ...opts, windowsHide: true });
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
// A type name as a graph takes it (one path segment), and an entry's timestamp as yg prints it: what decisions.md
// holds is checked again here, because a hand edit of that file could put anything there.
const TYPE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const DATETIME_RE = /^\d{4}-\d\d-\d\dT[0-9:.]+Z$/;
const RULE_RE = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

export function writeAreaDecision(root, { type, text, supersedes = null }) {
  if (!TYPE_RE.test(String(type))) return { state: 'skipped', reason: `"${type}" is not a type name yg takes (one word of letters, digits and . _ -)` };
  if (supersedes !== null && !DATETIME_RE.test(String(supersedes))) supersedes = null;
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

// Who admitted the rule, as the ratification names them: the person the graph's repository commits as (git
// user.name), who is the user answering the batch; "the owner" when git names nobody. A name cmd.exe would read inside
// quotes, or one of no letters, is not passed: "the owner" stands for it.
const NAME_RE = /^[^"%!\r\n\x00-\x1f]{1,120}$/u;
function ratifier(repo) {
  let name = '';
  try { name = execFileSync('git', ['config', 'user.name'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* none set */ }
  return NAME_RE.test(name) && /\p{L}/u.test(name) ? name : 'the owner';
}

// Writes the ratification of one rule (the ruleRatification an answer hands back) into the rule's own log. The types
// and the version admitted are Yggdrasil's to read from the graph, never Jarl's to say. The answer has the shapes of
// writeAreaDecision's, and a written one also names who it says admitted the rule (by). yg refuses a rule it does not
// know (aspect-not-found) and one no type reaches (aspect-ratify-no-type): the refusal is passed on with the command
// to run by hand. Entries a graph upgrade recorded for rules already in force name the graph, not a person; Jarl never
// reads them as the user's word and never skips a write because one is there.
export function writeRuleRatification(root, { rule, text }) {
  if (!RULE_RE.test(String(rule))) return { state: 'skipped', reason: `"${rule}" is not a rule id yg takes (segments of letters, digits and . _ - joined by /)` };
  const repo = graphRepo(root);
  if (!repo) return { state: 'skipped', reason: `no ${GRAPH_DIR}/ in the loop's repository` };
  try { run(repo, ['--version'], PROBE_MS); } catch { return { state: 'skipped', reason: `${GRAPH_DIR}/ found, but no working yg answers \`npx --no-install yg --version\` there` }; }
  const by = ratifier(repo);
  const dir = mkdtempSync(join(tmpdir(), 'jarl-rule-'));
  const file = join(dir, 'ratification.md');
  // Quoted for a POSIX shell: a name such as O'Brien stays one word when the command is pasted.
  const retry = `yg log add --aspect ${rule} --ratify --by '${by.replace(/'/g, "'\\''")}' --reason '<what was admitted>'`;
  try {
    writeFileSync(file, `${text.trim()}\n`);
    const out = run(repo, ['log', 'add', '--aspect', rule, '--ratify', '--by', by, '--reason-file', file], WRITE_MS);
    const datetime = /Timestamp:\s*(\S+)/.exec(out)?.[1] || null;
    return { state: 'written', repo, datetime, by };
  } catch (e) {
    return { state: 'failed', repo, reason: failure(e), retry };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
