// What the test files share: one spawn of the command line, the calls built on it, and the loops and repositories a
// test sets up. Every spawn carries an explicit timeout, so a hung process fails the test instead of waiting for it.
import './tmp-cleanup.mjs';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../record.mjs';
import { printedLine, shellWord } from '../jarl-lib.mjs';
import * as J from '../jarl.mjs';
import { NO_EXCLUDES } from './portable.mjs';

// The command line and the server read JARL_ROOT when a call names no loop. A shell that exports it would send every call
// a test makes without --root (from a checkout, through a shell, or to a server it starts) to that loop, and write into
// it: the variable is taken out of this process's environment once, here, so nothing a test starts inherits it. A test
// that means a JARL_ROOT passes it to the call it starts.
delete process.env.JARL_ROOT;

export const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
export const SPAWN_TIMEOUT = 120_000;

// The directory of the skill (SKILL.md, references/, scripts/) and the markdown files that make up its text: SKILL.md
// first, then every file of references/ in name order.
export const SKILL_DIR = fileURLToPath(new URL('../../', import.meta.url));
export function skillFiles() {
  const refs = readdirSync(join(SKILL_DIR, 'references')).filter((f) => f.endsWith('.md')).sort();
  return ['SKILL.md', ...refs.map((f) => `references/${f}`)];
}
// The text of one skill file, by its path under the skill directory ('SKILL.md', 'references/record.md').
export const skillText = (file) => readFileSync(join(SKILL_DIR, file), 'utf8');
// The lines of every skill file outside the blocks between the Runes markers (shared fragments that Runes writes and
// the vendoring pins, changed in Runes and never here), as { file, n, text }; `n` counts from 1 in its own file.
export function skillLines() {
  const out = [];
  for (const file of skillFiles()) {
    let inside = false;
    skillText(file).split('\n').forEach((text, i) => {
      if (/^<!-- RUNES:[a-z-]+:START -->$/.test(text)) inside = true;
      if (!inside) out.push({ file, n: i + 1, text });
      if (/^<!-- RUNES:[a-z-]+:END -->$/.test(text)) inside = false;
    });
  }
  return out;
}

// Every write names its writer, and a lease and a verdict their model. A test about something else does not spell them:
// a call that gives none carries these. A test about the flags themselves spawns with `bare`, or names its own.
export const TEST_WRITER = 'test-writer';
export const TEST_MODEL = 'test-model';
export const TEST_WORKER = 'test-worker';
export function withNames(args, { bare = false } = {}) {
  if (bare) return args;
  const words = args.map(String);
  const stop = words.indexOf('--');
  const before = stop === -1 ? words : words.slice(0, stop);
  const call = J.callOfArgv(before);
  const cmd = call.cmd;
  if (cmd === undefined || !J.MUTATING.has(cmd)) return args;
  const has = (flag) => call.flags.some(([k]) => k === flag);
  if (cmd === 'goal' && !has('set')) return args;
  const add = [];
  // The writes that name a judgement (who ruled, answered, took back or ticked) name it themselves, as they always did.
  if (!['decide', 'answer', 'retract', 'tick', 'review'].includes(cmd) && !has('by')) add.push('--by', cmd === 'set' ? 'jarl' : TEST_WRITER);
  // A lease names its worker; a move that restates a lease is written with its own --worker, or bare.
  const leasing = cmd === 'set' && call.args[1] === 'in-progress' && !has('header');
  if (leasing && !has('worker') && !has('model')) add.push('--worker', TEST_WORKER);
  const leases = leasing || (cmd === 'set' && has('worker'));
  const by = call.flags.find(([k]) => k === 'by')?.[1];
  const verdict = cmd === 'review' && call.args[1] !== 'retract' && !has('bot') && by !== 'owner';
  if ((leases || verdict) && !has('model')) add.push('--model', TEST_MODEL);
  if (!add.length) return args;
  // Right after the command: a flag at the end of a call may be one that lacks its value on purpose.
  const at = words.indexOf(cmd);
  return [...words.slice(0, at + 1), ...add, ...words.slice(at + 1)];
}
// One run of the command line against the loop in `root`: the result of spawnSync, both streams as written. `env` is
// added to the environment of the process.
// The host's plugin root is taken out of the environment of every run, so a run sees it only when the test sets it.
export function spawnJarl(root, args, { env, timeout = SPAWN_TIMEOUT, bare = false } = {}) {
  const inherited = { ...process.env };
  delete inherited.CLAUDE_PLUGIN_ROOT;
  return spawnSync(process.execPath, [SCRIPT, ...withNames(args, { bare }), '--root', root], { encoding: 'utf8', timeout, env: { ...inherited, ...env } });
}
// The same, as { status, stdout, stderr } with both streams trimmed. Every command the call prints (a view's row, a note,
// a step a reason names, a form) carries the call's --root, which every call of these tests gives: it is taken out, so a
// test reads what the call printed as it would be without it (the walks check that each command carries it).
export function run(root, args, opts) {
  const r = spawnJarl(root, args, opts);
  const read = (t) => (args.includes('--') ? posixForms(t) : posixForms(t).split(` --root ${shellWord(root)}`).join(''));
  return { status: r.status, stdout: read((r.stdout ?? '').trim()), stderr: read((r.stderr ?? '').trim()) };
}
// The result of a call that succeeded; a failure throws with what it said, and carries its status, stdout and stderr.
export function jarlResult(root, args, opts) {
  const r = run(root, args, opts);
  if (r.status !== 0) throw Object.assign(new Error(`jarl ${args.join(' ')} failed: ${r.stderr}`), r);
  return r;
}
// What the command prints, trimmed.
export function jarl(root, ...args) { return jarlResult(root, args).stdout; }
// What the command says when it refuses (with its closing newline); a call that succeeds fails the test. Every call of
// these tests gives --root, last, and the ready line carries it into each command it prints: it is taken out of the line,
// so a test reads the call as it would be without it, and a ready line that drops it fails the test. After a bare -- the
// --root is two arguments, not a flag, and the line is read as it is.
export function refuses(root, ...args) { return refusesCall(root, args); }
// The same for a call that keeps only the flags it was given, for a test about the writer or the model of a call.
export function refusesBare(root, ...args) { return refusesCall(root, args, { bare: true }); }
function refusesCall(root, args, opts) {
  const r = spawnJarl(root, args, opts);
  assert.notEqual(r.status, 0, `expected a refusal: ${args.join(' ')}`);
  const said = posixForms(r.stderr ?? '');
  return args.includes('--') ? said : withoutRoot(said, root);
}
// The commands a text prints, wherever they stand in it (a form on its own line, a step a reason names, the command of a
// row of a view, the one a note offers): each from jarl.mjs to its last word, as [{ start, end, raw }] per line. A command
// ends where its words do as the command table reads them (its arguments, its flags with their values) or at a word of
// prose: a dash or a dot of the views (— ·), a word that opens a parenthesis, or after a word that closes one or ends
// with a comma, a semicolon, a colon or a full stop.
const commandWordsTable = () => ({ args: J.COMMAND_ARGS, flags: { ...J.COMMAND_FLAGS }, globals: J.GLOBAL_FLAGS });
function tokensOf(line, from) {
  const out = [];
  let i = from;
  while (i < line.length) {
    while (line[i] === ' ') i += 1;
    if (i >= line.length) break;
    const start = i;
    let value = '';
    let bareEnd = false;
    while (i < line.length && line[i] !== ' ') {
      const c = line[i];
      if (c === "'") { const end = line.indexOf("'", i + 1); if (end === -1) { value += line.slice(i + 1); i = line.length; break; } value += line.slice(i + 1, end); i = end + 1; bareEnd = false; continue; }
      if (c === '"') { const end = line.indexOf('"', i + 1); if (end === -1) { value += line.slice(i + 1); i = line.length; break; } value += line.slice(i + 1, end); i = end + 1; bareEnd = false; continue; }
      value += c;
      i += 1;
      bareEnd = true;
    }
    out.push({ start, end: i, value, raw: line.slice(start, i), bareEnd });
  }
  return out;
}
export function commandSpans(text) {
  const { args, flags, globals } = commandWordsTable();
  const spans = [];
  String(text).split('\n').forEach((line, n) => {
    for (const m of line.matchAll(/(?<![\w.-])jarl\.mjs /g)) {
      const tokens = tokensOf(line, m.index);
      const cmd = tokens[1]?.value;
      if (cmd === undefined) continue;
      const table = { ...globals, ...(flags[cmd] || {}) };
      const arity = (args[cmd] || []).some((a) => a.endsWith('...')) ? Infinity : (args[cmd] || []).length;
      let end = tokens[1].end;
      let positional = 0;
      for (let k = 2; k < tokens.length; k += 1) {
        const t = tokens[k];
        if (t.raw === '—' || t.raw === '·' || t.raw.startsWith('(')) break;
        const trail = t.bareEnd ? /[,;:).]+$/.exec(t.raw)?.[0] ?? '' : '';
        const value = trail ? t.value.slice(0, -trail.length) : t.value;
        const name = /^--([A-Za-z][\w-]*)(?:=|$)/.exec(value)?.[1];
        if (name !== undefined && value !== '--') {
          end = t.end - trail.length;
          if (!trail && table[name] !== 'bool' && !value.includes('=') && tokens[k + 1]) { k += 1; const v = tokens[k]; const vt = v.bareEnd ? /[,;:).]+$/.exec(v.raw)?.[0] ?? '' : ''; end = v.end - vt.length; if (vt) break; }
          if (trail) break;
          continue;
        }
        if (value === '--') { end = t.end; continue; }
        if (positional >= arity) break;
        positional += 1;
        end = t.end - trail.length;
        if (trail) break;
      }
      spans.push({ line: n, start: m.index, end, raw: line.slice(m.index, end) });
    }
  });
  return spans;
}
// A text with the commands it prints as a POSIX shell has them. On Windows Jarl writes them for PowerShell and cmd, each
// word bare or in double quotes and none holding a double quote (shellOf in lib/base.mjs): the tests read every command
// in one spelling on every platform, and the quoting of each shell is tested on its own, with the platform passed in.
export const windowsWords = (line) => [...String(line).matchAll(/"([^"]*)"|([^\s"]+)/g)].map((m) => m[1] ?? m[2]);
export function posixForms(text, platform = process.platform) {
  if (platform !== 'win32') return text;
  const lines = String(text).split('\n');
  const spans = commandSpans(text);
  for (const s of [...spans].reverse()) lines[s.line] = `${lines[s.line].slice(0, s.start)}${printedLine(windowsWords(s.raw), 'posix')}${lines[s.line].slice(s.end)}`;
  return lines.join('\n');
}
// A text with the --root of the call taken out of every command it prints; each command at its end (a step on its own
// line, then the form) must carry it.
export function withoutRoot(text, root) {
  const flag = ` --root ${shellWord(root)}`;
  const lines = text.replace(/\n$/, '').split('\n');
  for (let i = lines.length - 1; i > 0 && lines[i].startsWith('jarl.mjs '); i -= 1) assert.ok(lines[i].includes(flag), `the command carries the call's --root: ${lines[i]}`);
  return text.split(flag).join('');
}

// A directory with a loop in it. `dotGit` makes it a checkout (an empty .git); `via` opens the loop through the library
// (the default) or through the command line.
export function loop({ prefix = 'jarl-loop-', goal = 'goal', dotGit = true, via = 'library', initFlags = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  if (dotGit) mkdirSync(join(root, '.git'));
  if (via === 'cli') jarl(root, 'init', goal, ...initFlags);
  else R.initLoop(root, goal);
  return root;
}

// An issue filed through the library, whose numbers have three digits (007-…), for a test that reads or writes them so.
export function fileThreeDigits(root, title, flags = {}) { return R.newIssue(root, title, { acceptance: '[read] it works', ...flags }).id; }
// An issue filed through the library with a plain number, as the command line writes it.
export function filePlain(root, title, flags = {}) { return R.newIssue(root, title, { acceptance: '[read] it works', width: undefined, ...flags }).id; }

// A git repository with one commit (a.txt), on `branch`; `g` runs git in it and returns what it prints.
export function gitRepo({ prefix = 'jarl-git-', branch = 'feature' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: SPAWN_TIMEOUT });
  g('init', '-q', '-b', branch);
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  g('config', 'core.excludesFile', NO_EXCLUDES);
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  g('add', '-A'); g('commit', '-qm', 'base');
  return { dir, g };
}
