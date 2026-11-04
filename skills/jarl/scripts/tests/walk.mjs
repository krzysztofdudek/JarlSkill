// The walk of the wrong calls, shared by the test files that make it: the loops a wrong call is made on, the wrong calls
// generated from the command table, and the check of what a refusal ends with. No refusal ends with a call composed for
// the caller: it says what is wrong, naming the caller's wrong word, and its last line is the form of the command that
// does what was meant, a placeholder of the registry for each value only the caller knows, or a read-only view; a step to
// take first is a command on its own line before it. Each line, pasted as printed into sh and zsh, is refused for its
// placeholder (or, a view, reads) and writes nothing in any loop of the checkout; each carries the call's --root and
// --json as they were given.
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { jarl, SCRIPT } from './helpers.mjs';
import { bashBin, NO_EXCLUDES } from './portable.mjs';

const J = await import('../jarl.mjs');
const L = await import('../jarl-lib.mjs');
const { COMMAND_ARGS, COMMAND_FLAGS, GLOBAL_FLAGS, MUTATING, REPLACED_COMMANDS, REMOVED_FLAGS } = J;
const { STATUSES, TIERS, PRIORITIES, ASK_KINDS, CI_STATES } = L;
export const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

// ---- the loops the wrong calls start from ------------------------------------------------------------------------

// Three issues, the second leased, a row on the first, three questions (one with options, one to ratify), a ruling, and a
// number two issue files carry, as two branches that each filed an issue leave it when they are merged (the file of one,
// and its filing line, copied into the other).
function plainLoop() {
  const root = mkdtempSync(join(tmpdir(), 'jarl-refusals-'));
  mkdirSync(join(root, '.git'));
  jarl(root, 'init', 'goal');
  for (const t of ['one', 'two', 'three']) jarl(root, 'new', t, '--tier', 'light', '--acceptance', 'it works');
  jarl(root, 'set', '2', 'in-progress', 'start', '--worker', 'w2', '--branch', 'jarl/2-two');
  jarl(root, 'ask', 'which way?');
  jarl(root, 'ask', 'pick one', '--issue', '3', '--option', 'A: does a', '--option', 'B: does b');
  jarl(root, 'ask', 'ratify this', '--kind', 'ratify');
  jarl(root, 'decide', 'taken', 'a ruling', '--by', 'jarl');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'ok');
  // An owner line on 3, for tick, and a findings file, for import.
  jarl(root, 'field', '3', 'Acceptance', '[owner] the page reads well · material: docs/x.md · check: it reads well', '--add');
  mkdirSync(join(root, 'research'));
  writeFileSync(join(root, 'research', 'findings.json'), JSON.stringify([{ id: 'f-1', title: 'a finding', where: 'x:1', evidence: 'e', proposal: 'p' }]));
  const other = mkdtempSync(join(tmpdir(), 'jarl-refusals-branch-'));
  cpSync(root, other, { recursive: true });
  const base = logOf(root);
  jarl(root, 'new', 'four', '--tier', 'light', '--acceptance', 'it works');
  jarl(other, 'new', 'four elsewhere', '--tier', 'light', '--acceptance', 'it works');
  const file = readdirSync(join(other, '.jarl', 'issues')).find((f) => f.startsWith('4-'));
  cpSync(join(other, '.jarl', 'issues', file), join(root, '.jarl', 'issues', file));
  appendFileSync(join(root, '.jarl', 'log.md'), logOf(other).slice(base.length));
  return { dir: root, cwd: '' };
}
function logOf(dir) { return readFileSync(join(dir, '.jarl', 'log.md'), 'utf8'); }
// A loop in a checkout with a sibling repository: four issues (the second leased by w-beta, the first with a row, a note
// and an approve, the fourth with two acceptance lines), three questions and a ruling.
function siblingLoop() {
  const top = mkdtempSync(join(tmpdir(), 'jarl-refusals-sibling-'));
  for (const name of ['main', 'tool']) {
    const d = join(top, name);
    mkdirSync(d);
    const g = (...a) => execFileSync('git', a, { cwd: d, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
    g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'core.excludesFile', NO_EXCLUDES);
    writeFileSync(join(d, 'README.md'), `${name}\n`);
    g('add', '-A'); g('commit', '-qm', 'first');
  }
  const root = join(top, 'main');
  jarl(root, 'init', 'a scratch goal');
  jarl(root, 'new', 'alpha', '--tier', 'light', '--acceptance', 'alpha works', '--tags', 'core', '--files', 'a.mjs', '--why', 'because');
  jarl(root, 'new', 'beta', '--tier', 'standard', '--acceptance', 'beta works', '--repo', 'tool');
  jarl(root, 'new', 'gamma', '--tier', 'strong', '--acceptance', 'gamma works', '--after', '1');
  jarl(root, 'new', 'delta', '--tier', 'light', '--acceptance', 'delta works', '--acceptance', 'and still works');
  jarl(root, 'set', '2', 'in-progress', 'start beta', '--worker', 'w-beta', '--branch', 'jarl/2-beta');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass 3');
  jarl(root, 'evidence', '1', 'a free note on alpha');
  jarl(root, 'review', '1', 'approve', '--by', 'rev-a', 'read it all, alpha is fine');
  jarl(root, 'ask', 'plain question?', '--issue', '4');
  jarl(root, 'ask', 'pick a way', '--issue', '3', '--option', 'A: the first way', '--option', 'B: the second way');
  jarl(root, 'ask', 'ratify this rule', '--kind', 'ratify');
  jarl(root, 'decide', 'old-way', 'we go the old way', '--by', 'jarl');
  return { dir: top, cwd: 'main' };
}
export const PLAIN = plainLoop();
export const SIBLING = siblingLoop();
// A checkout with a loop at its root, the plain loop in releases/r1 (no checkout of its own) and an empty releases/r2: a
// call given --root releases/r1 from the top reaches the plain loop, one that dropped it would reach the loop at the root,
// and init given --root releases/r2 opens a loop there.
function rootedLoop() {
  const top = mkdtempSync(join(tmpdir(), 'jarl-refusals-rooted-'));
  mkdirSync(join(top, '.git'));
  jarl(top, 'init', 'the loop at the root');
  jarl(top, 'new', 'root one', '--tier', 'light', '--acceptance', 'it works');
  cpSync(PLAIN.dir, join(top, 'releases', 'r1'), { recursive: true, filter: (s) => basename(s) !== '.git' });
  cpSync(join(PLAIN.dir, 'research'), join(top, 'research'), { recursive: true });
  mkdirSync(join(top, 'releases', 'r2'));
  return { dir: top, cwd: '' };
}
export const ROOTED = rootedLoop();
export const ROOT_ARG = 'releases/r1';
export const ROOT_EMPTY = 'releases/r2';
// A checkout with no loop, where init opens one.
export const EMPTY = (() => { const dir = mkdtempSync(join(tmpdir(), 'jarl-refusals-empty-')); mkdirSync(join(dir, '.git')); return { dir, cwd: '' }; })();

// A fresh copy of a checkout, with a profile written into its loop and the calls of `pre` run first: the directory a call
// runs in. snapshot reads every loop of the copy, wherever in it the call runs.
const TOPS = new Map();
export function copy(loop, { profile, pre } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-refusals-call-'));
  cpSync(loop.dir, dir, { recursive: true });
  const cwd = join(dir, loop.cwd);
  TOPS.set(cwd, dir);
  if (profile) writeFileSync(join(cwd, '.jarl', 'profile.json'), JSON.stringify(profile, null, 2));
  for (const a of pre || []) { const r = run(cwd, a); assert.equal(r.status, 0, `pre ${a.join(' ')}: ${r.stderr}`); }
  return cwd;
}
export const run = (cwd, args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 60000 });

// ---- the shells -------------------------------------------------------------------------------------------------------

const unix = (p) => (process.platform === 'win32' ? p.replace(/\\/g, '/') : p);
function shell(cwd, line, body) {
  return spawnSync(bashBin(), ['-c', `jarl.mjs() { ${body}; }\n${line}`], { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, JARL_NODE: unix(process.execPath), JARL_SCRIPT: unix(SCRIPT) } });
}
// The shells a printed line is pasted into: sh and zsh (zsh -f), where the machine has them, with an executable jarl.mjs
// on the PATH that runs this script; bash with jarl.mjs a function where it has neither (Git for Windows).
export const SHELLS = process.platform === 'win32' ? ['bash'] : ['/bin/sh', ...(existsSync('/bin/zsh') ? ['/bin/zsh'] : [])];
const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const BIN = process.platform === 'win32' ? null : (() => { const d = mkdtempSync(join(tmpdir(), 'jarl-refusals-bin-')); writeFileSync(join(d, 'jarl.mjs'), `#!/bin/sh\nexec ${sq(process.execPath)} ${sq(SCRIPT)} "$@"\n`, { mode: 0o755 }); return d; })();
export function runPrinted(cwd, line, sh = SHELLS[0]) {
  if (sh === 'bash') return shell(cwd, line, '"$JARL_NODE" "$JARL_SCRIPT" "$@"');
  return spawnSync(sh, [...(sh.endsWith('zsh') ? ['-f'] : []), '-c', line], { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, PATH: `${BIN}:${process.env.PATH}` } });
}
// The calls of a printed line as a shell passes them to jarl.mjs: each one's words, jarl.mjs left out; null where the shell
// does not run the line.
export function printedCalls(line) {
  const r = shell(tmpdir(), line, "printf '\\036'; printf '%s\\037' \"$@\"");
  if (r.status !== 0) return null;
  return r.stdout.split('\x1e').slice(1).map((c) => c.split('\x1f').slice(0, -1));
}

// Every file of every loop in the copy a call ran in (each .jarl/ in it, at any depth) but the lock, with what changes
// from one run to another (a time, an issue's random key) masked.
export function snapshot(cwd) {
  const top = TOPS.get(cwd) ?? cwd;
  const out = {};
  const walk = (d, inLoop) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (f === '.lock' || f === '.git') continue;
      if (statSync(p).isDirectory()) walk(p, inLoop || f === '.jarl');
      else if (inLoop) out[relative(top, p)] = readFileSync(p, 'utf8').replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?Z?)?/g, 'TIME').replace(/\b\d{8}T\d{4}-[a-z0-9]+\b/g, 'KEY');
    }
  };
  walk(top, false);
  return out;
}

// ---- what a refusal ends with -------------------------------------------------------------------------------------------

// A call read from its words as the command line reads them: the command, its arguments and its flags as [name, value].
export function readCall(words) {
  const [cmd, ...rest] = words;
  const shapes = { ...GLOBAL_FLAGS, ...(COMMAND_FLAGS[cmd] || {}) };
  const call = { cmd, pos: [], flags: [] };
  let after = false;
  for (let i = 0; i < rest.length; i += 1) {
    const w = String(rest[i]);
    if (!after && w === '--') { after = true; continue; }
    const name = w.startsWith('--') && w.length > 2 ? w.slice(2).split('=')[0] : null;
    if (after || name === null || /\s/.test(name)) { call.pos.push(w); continue; }
    if (w.includes('=')) call.flags.push([name, w.slice(w.indexOf('=') + 1)]);
    else if (shapes[name] === 'bool' || i + 1 >= rest.length || String(rest[i + 1]).startsWith('--')) call.flags.push([name, true]);
    else { call.flags.push([name, String(rest[i + 1])]); i += 1; }
  }
  return call;
}
// The global flags a call gave, each as the words it was written in: ['--root', 'x'], ['--root=x'], ['--json'].
export function globalsOf(args) {
  // Read as the command line reads the call: a word taken as the value of a flag before it is no flag, and a --root
  // given twice leaves which one was meant to the caller, so the form has a placeholder for it.
  const flags = J.callOfArgv(args.map(String)).flags.filter(([k]) => k === 'root' || k === 'json');
  const roots = flags.filter(([k]) => k === 'root');
  return flags.filter(([k, v]) => (k === 'json' ? v === true : roots.length === 1 && typeof v === 'string')).map(([k, v, spelt]) => (k === 'json' ? ['--json'] : spelt === '=' ? [`--root=${v}`] : ['--root', v]));
}
// The reason of a refusal and its commands: the lines at its end that are commands of jarl.mjs, the last its form.
export function partsOf(said) {
  const lines = said.replace(/\n+$/, '').split('\n');
  let k = lines.length;
  while (k > 1 && lines[k - 1].startsWith('jarl.mjs ')) k -= 1;
  return { reason: lines.slice(0, k).join('\n'), commands: lines.slice(k) };
}
const HOLE = L.HOLE;
// Flags a form never adds to what the call gave: they remove, keep or sign off something nobody asked for.
const NEVER_ADDED = ['force', 'batch', 'keep', 'relayed', 'permanent', 'committed', 'header', 'adopt'];
// Whether a reason names a word: as it was given, quoted as JSON, or in another case.
export const names = (reason, word) => [String(word), JSON.stringify(String(word)).slice(1, -1)].some((w) => reason.includes(w) || reason.toLowerCase().includes(w.toLowerCase()));

// What is wrong with the refusal `said` of the wrong call `args` made on `loop` (copied with `opts`); `wrong` is the word
// of the call the reason must name, or null. An empty list is a refusal that holds.
export function formProblems(args, said, loop, opts = {}, wrong = null) {
  const lines = said.replace(/\n+$/, '').split('\n');
  // A loop run by a composer is closed and archived by its command, which the profile names.
  if (opts.profile?.lifecycle?.command && lines.at(-1) === opts.profile.lifecycle.command) return [];
  const { reason, commands } = partsOf(said);
  if (!commands.length || !reason.trim()) return [`no reason and form on lines of their own: ${lines.at(-1)}`];
  const given = args.map(String);
  const problems = [];
  for (const line of commands) {
    const calls = printedCalls(line);
    if (!calls || calls.length !== 1) { problems.push(`not one command for a shell: ${line}`); continue; }
    const words = calls[0];
    for (const w of words) for (const m of w.matchAll(/<[^<>]*>/g)) if (!L.PLACEHOLDERS.includes(m[0]) && !given.some((g) => g.includes(m[0]))) problems.push(`prints ${m[0]}, no placeholder of the registry: ${line}`);
    const c = readCall(words);
    if (MUTATING.has(c.cmd) && !words.some((w) => HOLE.test(w))) problems.push(`a command that writes, with no placeholder: pasted as printed it runs: ${line}`);
    for (const g of globalsOf(given)) if (!(g.length === 1 ? words.includes(g[0]) : words.some((w, i) => w === g[0] && words[i + 1] === g[1]))) problems.push(`drops ${g.join(' ')}, a global flag the call gave: ${line}`);
    for (const [k, v] of c.flags) if (k === 'by' && typeof v === 'string' && !HOLE.test(v) && !given.includes(v)) problems.push(`names --by ${v}, an author the call did not name: ${line}`);
    for (const [k] of c.flags) if (NEVER_ADDED.includes(k) && !given.includes(`--${k}`) && !given.includes(k)) problems.push(`adds --${k}, which the call did not ask for: ${line}`);
  }
  if (wrong !== null && !names(reason, wrong)) problems.push(`the reason does not name ${JSON.stringify(wrong)}: ${reason.split('\n')[0].slice(0, 160)}`);
  // Pasted as printed into each shell, on a fresh copy: refused for its placeholder, and nothing written in any loop.
  const before = JSON.stringify(snapshot(copy(loop, opts)));
  for (const line of commands) {
    for (const sh of SHELLS) {
      const dir = copy(loop, opts);
      const r = runPrinted(dir, line, sh);
      if (JSON.stringify(snapshot(dir)) !== before) problems.push(`pasted into ${sh}, it writes: ${line}`);
      if (HOLE.test(line) && (r.status === 0 || !/placeholder/.test(r.stderr))) problems.push(`pasted into ${sh}, it is not refused for its placeholder: ${line} — ${r.stderr.trim().split('\n')[0]}`);
    }
  }
  return problems;
}

// Each wrong call on a fresh copy: refused, nothing written, and its refusal holds. A case is the words of the call, or
// { args, wrong, loop, pre, profile }.
export function walk(cases, loop, { mustRefuse }) {
  const found = [];
  let refused = 0;
  for (const c of cases) {
    const { args, wrong = null, pre, profile, loop: own } = Array.isArray(c) ? { args: c } : c;
    const opts = { pre, profile };
    const on = own || loop;
    // A case whose first calls the loop cannot take (an issue it does not hold) is not one of this loop.
    let dir;
    try { dir = copy(on, opts); } catch { continue; }
    const before = JSON.stringify(snapshot(dir));
    const r = run(dir, args);
    if (r.status === 0) { if (mustRefuse) found.push(`${JSON.stringify(args)}: went through`); continue; }
    refused += 1;
    if (JSON.stringify(snapshot(dir)) !== before) found.push(`${JSON.stringify(args)}: refused and wrote`);
    for (const p of formProblems(args, r.stderr, on, opts, wrong)) found.push(`${JSON.stringify(args)}: ${p}`);
  }
  return { found, refused };
}

// ---- the wrong calls of the command table ---------------------------------------------------------------------------

// A call each writing command takes on the plain loop (base on the loop with a sibling repository, which declares one, and
// init where no loop lives); the generator breaks it in every way the table names, each call with the word of it the
// reason must name.
function keyOf4() { const f = readdirSync(join(PLAIN.dir, '.jarl', 'issues')).find((x) => x.startsWith('4-')); return /^\*\*Key:\*\* (\S+)/m.exec(readFileSync(join(PLAIN.dir, '.jarl', 'issues', f), 'utf8'))?.[1] ?? 'k'; }
const VALID = {
  init: ['g'], new: ['t', '--tier', 'light'], renumber: ['4', '--key', keyOf4()], import: ['research/findings.json'], evidence: ['1', 'a note'],
  retract: ['1', '1', '--by', 'jarl', 'the row was wrong'], field: ['1', 'Priority', '1'], base: ['tool', 'main'], set: ['1', 'deferred', 'later'],
  merged: ['1', '--sha', 'abc1234'], review: ['1', 'approve', '--by', 'rev', 'read it all, fine'], round: ['1', 'it failed'], tick: ['3', '2', '--by', 'owner'],
  ask: ['which?'], answer: ['a-1', 'this way', '--by', 'owner'], log: ['a note'], decide: ['s1', 'a ruling', '--by', 'jarl'], goal: ['--set', 'Check: npm test'],
  archive: ['old'], mode: ['permanent'], close: [],
};
const SETS = {
  new: { '--tier': TIERS, '--kind': ['bug', 'gap'], '--prio': PRIORITIES }, import: { '--tier': TIERS, '--kind': ['bug', 'gap'], '--prio': PRIORITIES },
  set: { 1: STATUSES }, review: { 1: ['approve', 'changes'] }, merged: { '--ci': CI_STATES }, ask: { '--kind': ASK_KINDS }, mode: { 0: ['permanent'] },
};
const OUTSIDE = { '--tier': ['huge'], '--kind': ['task'], '--prio': ['7'], '--ci': ['blue'], 1: ['bogus'], 0: ['bogus'] };
const misspelt = (v) => `${v.charAt(0)}${v.slice(2)}`;
const capital = (v) => `${v.charAt(0).toUpperCase()}${v.slice(1)}`;
const TEXT_AT = { evidence: 1, retract: 2, set: 2, review: 2, round: 1, ask: 0, answer: 1, log: 0, decide: 1 };
const IDS_AT = { evidence: 0, retract: 0, field: 0, set: 0, merged: 0, review: 0, round: 0, tick: 0 };
const OLD_TEXT = { set: 'why', review: 'findings', round: 'what', ask: 'question', answer: 'answer', log: 'event', decide: 'ruling', retract: 'reason' };
// Words a shell reads something in, given as a text the call carries beside the word that is wrong.
export const ODD = ['#12', '=x', '~', '~/x', '&&', ';', '|', 'a\nb', "it's", '"q"', '-x', '  leading', '', '$(touch pwned)', '`touch pwned`', '*', 'a\u2028b', 'a\u0085b', 'a\u2029b', 'a\rb'];
function positionalsOf(args) { const out = []; for (let i = 0; i < args.length; i += 1) { if (args[i].startsWith('--')) { i += args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? 1 : 0; continue; } out.push(i); } return out; }
export function generateWrongCalls() {
  const calls = [];
  const add = (args, wrong) => calls.push({ args, wrong });
  for (const cmd of [...MUTATING]) {
    const valid = VALID[cmd];
    if (!valid) continue;
    const at = positionalsOf(valid);
    // each required argument left out: the reason names the argument
    COMMAND_ARGS[cmd].forEach((a, n) => { if (!/[?.]$/.test(a) && at[n] !== undefined) add([cmd, ...valid.slice(0, at[n])], a); });
    // each value of a closed set wrong: far from the set, misspelt, in another case
    for (const [where, set] of Object.entries(SETS[cmd] || {})) {
      for (const bad of [...(OUTSIDE[where] || []), ...(set === PRIORITIES ? [] : [misspelt(set[0]), capital(set[0])])]) {
        const args = [...valid];
        if (where.startsWith('--')) { const i = args.indexOf(where); if (i >= 0) args[i + 1] = bad; else args.push(where, bad); } else args[at[Number(where)]] = bad;
        add([cmd, ...args], bad);
      }
    }
    if (cmd === 'field') for (const [name, value] of [['Bogus', 'x'], ['Priority', '7'], ['Tier', 'Strong'], ['Tier', 'stong'], ['Kind', 'Bug']]) add(['field', '1', name, value], name === 'Bogus' ? name : value);
    // an unknown flag, with a value and with none
    add([cmd, ...valid, '--bogus', 'x'], '--bogus');
    add([cmd, ...valid, '--bogus'], '--bogus');
    // each flag that takes a value: given last with none, and (when it takes one value) given twice
    for (const [flag, shape] of Object.entries(COMMAND_FLAGS[cmd])) {
      if (shape === 'bool') continue;
      add([cmd, ...valid, `--${flag}`], `--${flag}`);
      if (shape !== 'many' && !valid.includes(`--${flag}`)) add([cmd, ...valid, `--${flag}`, 'a', `--${flag}`, 'b'], 'b');
    }
    if (TEXT_AT[cmd] !== undefined) {
      const text = valid[at[TEXT_AT[cmd]]];
      const dashed = [...valid]; dashed[at[TEXT_AT[cmd]]] = '--looks like a flag'; add([cmd, ...dashed], '--looks like a flag');
      // the free text given as a flag: text, and the name it had in the tools
      for (const name of ['text', ...(OLD_TEXT[cmd] ? [OLD_TEXT[cmd]] : [])]) add([cmd, ...valid.filter((_, i) => i !== at[TEXT_AT[cmd]]), `--${name}`, text], `--${name}`);
    }
    if (IDS_AT[cmd] !== undefined) { const wrong = [...valid]; wrong[at[IDS_AT[cmd]]] = '99'; add([cmd, ...wrong], '99'); }
  }
  // A write that records a judgement, with its author left out: the reason names --by.
  for (const cmd of Object.keys(J.AUTHOR_REQUIRED)) { const valid = VALID[cmd]; const at = valid.indexOf('--by'); if (at !== -1) add([cmd, ...valid.slice(0, at), ...valid.slice(at + 2)], '--by'); }
  // Calls refused for the state of the loop: a close with work open, a loop out of git made permanent.
  add(['close'], null); add(['close', '--by', 'jarl'], null); add(['mode', 'permanent'], null);
  // Each removed flag, and each removed command, given extra words.
  for (const [cmd, flags] of Object.entries(REMOVED_FLAGS)) for (const flag of Object.keys(flags)) add([cmd, ...(VALID[cmd] || []), `--${flag}`, ...(flag === 'retract' ? ['1'] : flag === 'by' ? ['repo'] : [])], `--${flag}`);
  for (const cmd of Object.keys(REPLACED_COMMANDS)) { add([cmd, '1'], cmd); add([cmd, '1', 'extra', 'words', '--by', 'w'], cmd); }
  // A dashed item after another in a list, ranges over ids the loop lacks or written backwards, a lease another worker
  // holds, words of one text given apart.
  for (const [args, wrong] of [
    [['new', 't', '--tier', 'light', '--tags', 'ui,-x'], '-x'], [['new', 't', '--tier', 'light', '--files', 'src/a.mjs,--b'], '--b'], [['field', '1', 'Files', 'a.mjs,-b.mjs', '--add'], '-b.mjs'],
    [['field', '1', 'Tags', 'core,-x', '--remove'], '-x'], [['set', '3-12', 'deferred', 'later'], '3-12'], [['round', '3-9', 'it failed'], '3-9'], [['field', '6-9', 'Priority', '1'], '6-9'],
    [['set', '3-2', 'dropped', 'duplicate of 1'], '3-2'], [['field', '3-1', 'Priority', '3'], '3-1'], [['set', '2', 'in-progress', 'start', '--worker', 'w-other', '--branch', 'jarl/2-other'], '2'],
    [['evidence', '1', '--ran', 'npm', 'test', '--saw', 'ok'], 'test'], [['evidence', '1', '--ran', 'npm test', '--saw', 'pass', '3'], '3'], [['set', '1', 'deferred', 'not', 'now'], 'now'],
    [['review', '1', 'approve', '--by', 'rev', 'read', 'it', 'all'], 'all'],
  ]) add(args, wrong);
  // Odd words: each given as the text of a call refused for its status, as a title refused for its tier, and as a flag's name.
  for (const w of ODD) { add(['set', '1', 'Deferred', w], 'Deferred'); add(['new', w, '--tier', 'Light'], w.trim() ? 'Light' : null); }
  for (const name of ['--a;b', '--x|y', '--&&', '--#', '--$(touch pwned)', '--`id`', '--~']) add(['new', 't', '--tier', 'light', name, 'x'], name);
  // The calls of the sixth review, and three more of their kind.
  for (const [args, wrong] of [
    [['tag', '4', '+x', 'bug'], 'tag'], [['prio', '4', '2', '3'], 'prio'], [['after', '3', '4', '--clear'], 'after'], [['body', '4', '--what', 'A', '--what', 'B'], 'body'],
    [['repo', 'tool', 'develop', '--base', 'main'], 'repo'], [['body', '4', '--where', '--what', 'x'], 'body'], [['body', '4', '--what', 'T', '--why'], 'body'],
    [['tag', '1', '-core', '+"quoted"'], 'tag'], [['body', '1', '--title', 'X', '--section', 'Design=x'], 'body'],
  ]) add(args, wrong);
  // base runs where a repository is declared, and init where no loop lives yet; and init where one lives.
  return [...calls.map((c) => (c.args[0] === 'base' ? { ...c, loop: SIBLING } : c.args[0] === 'init' ? { ...c, loop: EMPTY } : c)), { args: ['init', 'g', '--by', 'jarl'], wrong: null, loop: PLAIN }];
}
// Each generated call given --root (one in three written --root=), and one in four --json too, run from the top of a
// checkout whose own loop the call does not name: its form carries them as given, and pasted it writes in no loop.
export function rootedWrongCalls() {
  return generateWrongCalls().map((c, n) => {
    const [on, root] = c.loop === SIBLING ? [{ ...SIBLING, cwd: '' }, SIBLING.cwd] : c.loop === EMPTY ? [ROOTED, ROOT_EMPTY] : [ROOTED, ROOT_ARG];
    const globals = [...(n % 3 === 2 ? [`--root=${root}`] : ['--root', root]), ...(n % 4 === 1 ? ['--json'] : [])];
    return { ...c, args: [c.args[0], ...globals, ...c.args.slice(1)], loop: on };
  });
}
