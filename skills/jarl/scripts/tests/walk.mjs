// The walk of the wrong calls, shared by the test files that make it: the loops a wrong call is made on, the wrong calls
// generated from the command table, and the check of what a refusal ends with. No refusal ends with a call composed for
// the caller: it says what is wrong, naming the caller's wrong word, and its last line is the form of the command that
// does what was meant, a placeholder of the registry for each value only the caller knows, or a read-only view; a step to
// take first is a command on its own line before it. Each line, pasted as printed into sh and zsh, is refused for its
// placeholder (or, a view, reads) and writes nothing in any loop of the checkout; each carries the call's --root and
// --json as they were given.
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { commandSpans, jarl, withNames } from './helpers.mjs';
import { runInProcess } from './in-process.mjs';
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
  for (const t of ['one', 'two', 'three']) jarl(root, 'new', t, '--tier', 'light', '--acceptance', '[read] it works');
  jarl(root, 'set', '2', 'in-progress', 'start', '--worker', 'w2', '--branch', 'jarl/2-two');
  jarl(root, 'ask', 'which way?');
  jarl(root, 'ask', 'pick one', '--issue', '3', '--option', 'A: does a', '--option', 'B: does b');
  jarl(root, 'ask', 'ratify this', '--kind', 'ratify');
  jarl(root, 'decide', 'taken', 'a ruling', '--by', 'jarl');
  jarl(root, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'ok');
  // An owner line on 3, for tick, and a findings file, for import.
  jarl(root, 'field', '3', 'Acceptance', '[owner] the page reads well · material: docs/x.md · check: it reads well', '--add');
  mkdirSync(join(root, 'research'));
  writeFileSync(join(root, 'research', 'findings.json'), JSON.stringify([{ id: 'f-1', title: 'a finding', where: 'x:1', evidence: 'e', proposal: 'p' }]));
  const other = mkdtempSync(join(tmpdir(), 'jarl-refusals-branch-'));
  cpSync(root, other, { recursive: true });
  const base = logOf(root);
  jarl(root, 'new', 'four', '--tier', 'light', '--acceptance', '[read] it works');
  jarl(other, 'new', 'four elsewhere', '--tier', 'light', '--acceptance', '[read] it works');
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
  jarl(root, 'new', 'alpha', '--tier', 'light', '--acceptance', '[read] alpha works', '--tags', 'core', '--files', 'a.mjs', '--why', 'because');
  jarl(root, 'new', 'beta', '--tier', 'standard', '--acceptance', '[read] beta works', '--repo', 'tool');
  jarl(root, 'new', 'gamma', '--tier', 'strong', '--acceptance', '[read] gamma works', '--after', '1');
  jarl(root, 'new', 'delta', '--tier', 'light', '--acceptance', '[read] delta works', '--acceptance', '[read] and still works');
  jarl(root, 'set', '2', 'in-progress', 'start beta', '--worker', 'w-beta', '--branch', 'jarl/2-beta');
  jarl(root, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'pass 3');
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
  jarl(top, 'new', 'root one', '--tier', 'light', '--acceptance', '[read] it works');
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
// runs in. snapshot reads every loop of the copy, wherever in it the call runs. A walk makes thousands of them, so each is
// given back with drop as soon as its call is checked: a copy is never reused, and the folders alive at once are the few
// one call holds.
const TOPS = new Map();
export function copy(loop, { profile, pre } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-refusals-call-'));
  cpSync(loop.dir, dir, { recursive: true });
  const cwd = join(dir, loop.cwd);
  TOPS.set(cwd, dir);
  if (profile) writeFileSync(join(cwd, '.jarl', 'profile.json'), JSON.stringify(profile, null, 2));
  for (const a of pre || []) {
    const r = run(cwd, a);
    if (r.status !== 0) { drop(cwd); assert.fail(`pre ${a.join(' ')}: ${r.stderr}`); }
  }
  return cwd;
}
export function drop(cwd) {
  const top = TOPS.get(cwd);
  if (top === undefined) return;
  TOPS.delete(cwd);
  rmSync(top, { recursive: true, force: true, maxRetries: 3 });
}
// One call, made where the walk stands, inside this process (tests/in-process.mjs): the walks make tens of thousands of
// calls, and it is the same code a process would run.
export const run = (cwd, args) => runInProcess(withNames(args), { cwd });

// ---- the shells -------------------------------------------------------------------------------------------------------

function shell(cwd, line, body) {
  return spawnSync(bashBin(), ['-c', `jarl.mjs() { ${body}; }\n${line}`], { cwd, encoding: 'utf8', timeout: 60000 });
}
// The shells a printed line is pasted into: sh and zsh (zsh -f), where the machine has them, with an executable jarl.mjs
// on the PATH, bash with jarl.mjs a function where it has neither (Git for Windows). Each shell reads the line for real
// (its quoting, its expansions, its command separators); jarl.mjs records the words it was given, and the calls recorded
// are then made in this process, in the order they were made (see run), so a walk spawns a shell and no node per line.
export const SHELLS = process.platform === 'win32' ? ['bash'] : ['/bin/sh', ...(existsSync('/bin/zsh') ? ['/bin/zsh'] : [])];
const PASTED = join(mkdtempSync(join(tmpdir(), 'jarl-refusals-paste-')), 'calls');
const RECORDING = 'for a in "$@"; do printf \'%s\\037\' "$a"; done >> "$JARL_PASTED"; printf \'\\036\' >> "$JARL_PASTED"; exit 1';
const BIN = process.platform === 'win32' ? null : (() => { const d = mkdtempSync(join(tmpdir(), 'jarl-refusals-bin-')); writeFileSync(join(d, 'jarl.mjs'), `#!/bin/sh\n${RECORDING}\n`, { mode: 0o755 }); return d; })();
export function runPrinted(cwd, line, sh = SHELLS[0]) {
  writeFileSync(PASTED, '');
  const env = { ...process.env, JARL_PASTED: PASTED.replaceAll('\\', '/') };   // Git for Windows' bash reads a path with slashes
  const pasted = sh === 'bash'
    ? spawnSync(bashBin(), ['-c', `jarl.mjs() { ${RECORDING.replace('exit 1', 'return 1')}; }\n${line}`], { cwd, encoding: 'utf8', timeout: 60000, env })
    : spawnSync(sh, [...(sh.endsWith('zsh') ? ['-f'] : []), '-c', line], { cwd, encoding: 'utf8', timeout: 60000, env: { ...env, PATH: `${BIN}:${process.env.PATH}` } });
  let result = { status: pasted.status, stdout: pasted.stdout ?? '', stderr: pasted.stderr ?? '' };
  for (const words of readFileSync(PASTED, 'utf8').split('\x1e').slice(0, -1).map((c) => c.split('\x1f').slice(0, -1))) {
    const r = runInProcess(words, { cwd });
    result = { status: r.status, stdout: result.stdout + r.stdout, stderr: result.stderr + r.stderr };
  }
  return result;
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
  // given twice leaves which one was meant to the caller, so the form has a placeholder for it, as it has for a --root
  // holding a line break, which no printed line carries.
  // A --root or --json written after a bare -- is counted too, read here and not by the code under test: it is an argument
  // to the command line, and a flag the caller gave all the same.
  const at = args.map(String).indexOf('--');
  const after = [];
  if (at !== -1) {
    const rest = args.slice(at + 1).map(String);
    for (let i = 0; i < rest.length; i += 1) {
      if (rest[i] === '--json') after.push(['json', true]);
      else if (rest[i] === '--root') { after.push(['root', rest[i + 1]]); i += 1; } else if (rest[i].startsWith('--root=')) after.push(['root', rest[i].slice('--root='.length), '=']);
    }
  }
  const flags = [...J.callOfArgv((at === -1 ? args : args.slice(0, at)).map(String)).flags, ...after].filter(([k]) => k === 'root' || k === 'json');
  const roots = flags.filter(([k]) => k === 'root');
  return flags.filter(([k, v]) => (k === 'json' ? v === true : roots.length === 1 && typeof v === 'string')).map(([k, v, spelt]) => (k === 'json' ? ['--json'] : L.breaksLine(v) ? ['--root', '<loop-root>'] : spelt === '=' ? [`--root=${v}`] : ['--root', v]));
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
// Whether a reason names a word: as it was given, quoted as JSON, as Jarl echoes it (its line breaks escaped), or in
// another case.
export const names = (reason, word) => [String(word), JSON.stringify(String(word)).slice(1, -1), L.echoWord(word).slice(1, -1)].some((w) => reason.includes(w) || reason.toLowerCase().includes(w.toLowerCase()));
// The commands a removed command is replaced by, and the steps a refusal may end with in place of the call's own form:
// a question put, a loop archived, a part of the description written, a lease taken, an issue filed, a proof, a verdict,
// a merge or a retraction recorded, a repository's base, a loop opened, or verify, which shows what to repair. No other
// view ends a refusal, but the one a removed view is replaced by.
const REPLACED_BY = { tips: ['resume'], queue: ['resume'], check: ['scope'], prio: ['field'], tag: ['field'], files: ['field'], source: ['field'], after: ['field'], repo: ['field', 'base'], body: ['field'], handoff: ['resume'] };
const STEP_COMMANDS = ['ask', 'archive', 'field', 'set', 'new', 'evidence', 'review', 'merged', 'retract', 'base', 'init', 'verify'];
// The words a form may hold that the call did not give and that are no placeholder: the parts of the description field
// writes, and the entry retract takes a verdict back by.
const STRUCTURAL = new Set([...['Title', 'Priority', 'Tier', 'Kind', 'Found by', 'Tags', 'Files', 'Repo', 'After', 'Source', 'Where', 'Resources', 'Person', 'Check when', 'What', 'Why', 'Acceptance', 'Changelog'], 'review']);
// A plausible value for each placeholder, to fill a form with as a caller would: a word that stands where nothing is to be
// given (a flag to leave out, a step the reason names) is taken out, with the value after it where it has one.
const FILL = {
  '<id>': '1', '<ids>': '1', '<ids-it-waits-on>': '3', '<another-id>': '3', '<another-issue>': '3', '<ids-the-loop-holds>': '1', '<ids-low-high>': '1-2', '<a-smaller-range>': '1-2',
  '<the-id-new-prints>': '1', '<the-id-ask-prints>': 'a-1', '<an-issue-next-offers>': '1', '<question>': 'a-1', '<a-n>': 'a-1', '<n>': '1', '<n-or-note-n>': '1',
  '<review-n-or-note-n>': '1', '<line>': '1', '<line-number>': '1', '<text>': 'a reason written in full', '<title>': 'a title', '<the-title-filed-again>': 'a title', '<goal>': 'a goal',
  '<slug>': 'a-new-slug', '<a-new-slug>': 'a-new-slug', '<a-ruling>': 'a ruling written in full', '<a-ruling-in-force>': 'taken', '<value>': 'a value',
  '<the-whole-new-value>': '2', '<the-whole-section>': 'a whole section', '<a-part-of-the-description>': 'What', '<part>': 'What', '<name=value>': 'Area=core',
  '<field=value>': 'Priority=2', '<changelog-entry>': 'Fixed: a thing', '<owner-line>': '[owner] it reads well · material: docs/x.md · check: it reads', '<items>': 'a',
  '<an-item-with-no-leading-dash>': 'a.mjs', '<an-item-without-quotes>': 'a.mjs', '<one-quoted-text>': 'a reason written in full', '<argument>': 'x', '<who>': 'jarl',
  '<one-name>': 'jarl', '<reviewer>': 'rev-fresh', '<a-fresh-reviewer>': 'rev-fresh', '<the-owner-himself>': 'owner', '<owner-or-a-name>': 'jarl', '<who-asks>': 'jarl',
  '<his-own-words>': 'we go this way', '<status>': 'deferred', '<status-in-the-log>': 'open', '<a-status-the-gate-allows>': 'deferred', '<kind>': 'bug', '<tier>': 'light',
  '<prio>': '2', '<verdict>': 'changes', '<ci-state>': 'green', '<ask-kind>': 'stuck', '<jarl-or-owner>': 'jarl', '<option>': 'A', '<another-label:effect>': 'D: does d',
  '<label:effect>': 'C: does c', '<mode>': 'permanent', '<group>': 'tag', '<name>': 'tool', '<names>': 'odin', '<name-or-path>': 'tool', '<coordinator>': 'odin',
  '<slice:coordinator>': 'slice:odin', '<no-second-slice-tag>': 'ui', '<tag>': 'ui', '<a-tag-an-issue-carries>': 'core', '<key>': 'k', '<a-number-two-files-carry>': '4',
  '<sha>': 'abc1234', '<command>': 'npm test', '<what-it-printed>': 'all 3 pass', '<what-was-wrong>': 'it ran on the wrong tree, so it does not count',
  '<what-was-read-and-found>': 'Important: read the diff and the tests, one name is wrong', '<findings-with-a-severity>': 'Important: read the diff and the tests, one name is wrong',
  '<what-failed>': 'the test of the walk failed on a refusal', '<what-the-branch-does>': 'a title', '<what-is-red>': 'the suite', '<what-would-get-weaker>': 'the gate', '<why>': 'a reason written in full',
  '<why-the-worker-changed>': 'the first worker stopped', '<question-for-the-owner>': 'which way do we go?', '<yes-or-reject-first>': 'yes, as written', '<branch>': 'jarl/1-x',
  '<worker-branch>': 'jarl/1-x', '<base-branch>': 'main', '<the-new-worker>': 'w9', '<the-worktree-of-the-lease>': '.', '<model-id>': 'opus', '<path>': 'a.mjs', '<paths>': 'a.mjs',
  '<path-under-the-loop-root>': 'a.mjs', '<slot>': 'before', '<findings.json>': 'research/findings.json', '<profile.json>': 'profile.json', '<report-dir>': 'research',
  '<report-dir#finding-id>': 'research#f-1', '<finding-ids>': 'f-1', '<template>': 'tmpl', '<the-main-checkout>': '.', '<loop-root>': '.', '<selectors>': 'loop',
  '<selector>': 'role worker', '<role>': 'worker', '<moment>': 'start', '<date-or-event>': '2026-12-01', '<yyyy-mm-dd>': '2026-12-01', '<date-or-id>': '2026-12-01',
  '<type>': 'module', '<rule-id>': 'r1', '<number-of-files>': '2', '<whole-number>': '2', '<count>': '2', '<hours>': '2', '<rounds>': '2', '<machine-line>': 'Check: npm test',
  '<resource-name>': 'db', '<a-row-the-log-matches>': '1', '<material>': 'docs/x.md', '<what-to-check>': 'it reads well', '<placeholder>': 'x', '<a-jarl-command>': 'list',
  '<--handover-or-none>': '--handover', '<line=id>': '1=2',
};
// Other plausible values of a placeholder whose value the context decides (a kind a flag goes with, a status a lease
// goes with, an author the owner must be): the form passes when any filling is a call, or refused for another reason.
const ALTERNATIVES = {
  '<kind>': ['wait', 'promise'], '<status>': ['in-progress', 'open', 'done', 'dropped'], '<ask-kind>': ['escalation', 'rule', 'lower', 'ratify', 'stop', 'charter'],
  '<who>': ['owner', 'rev-fresh'], '<verdict>': ['approve'], '<jarl-or-owner>': ['owner'], '<option>': ['B'], '<status-in-the-log>': ['in-progress'],
  '<key>': [keyOf4()], '<ids-it-waits-on>': ['2'], '<question>': ['a-2', 'a-3'], '<name>': ['Dana', 'Area'], '<value>': ['2', 'core'], '<text>': ['Important: read the diff and the tests, one name is wrong'],
};
const LEFT_OUT = ['<a-flag-it-takes-or-none>', '<no-flag-here>', '<as-the-reason-says>', '<nothing-to-do>', '<as-the-view-shows>', '<one-kind-of-evidence-per-call>', '<no-word-here>'];
// A printed command's words with each word that stands where nothing is to be given taken out, with the value after a
// flag the caller is to name: the words that take a place in the call.
const placed = (words) => words.filter((w, i) => !LEFT_OUT.includes(w) && w !== '<--handover-or-none>' && !(w === '<value>' && words[i - 1] === '<a-flag-it-takes-or-none>'));
// A printed command's words with each placeholder filled: a word that is one is replaced (or taken out), one that holds
// one (a list item, a value part) has it replaced in place.
export function filled(words, at = -1, other = null) {
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (LEFT_OUT.includes(w)) { if (w === '<a-flag-it-takes-or-none>' && words[i + 1] === '<value>') i += 1; continue; }
    if (i === at) { out.push(other); continue; }
    out.push(Object.hasOwn(FILL, w) ? FILL[w] : String(w).replace(HOLE_ALL, (m) => FILL[m] ?? 'x'));
  }
  return out;
}
// Each filling of a form: every placeholder its first plausible value, then each placeholder in turn another of its own.
function fillings(words) {
  const out = [filled(words)];
  words.forEach((w, i) => { for (const v of ALTERNATIVES[w] || []) out.push(filled(words, i, v)); });
  return out;
}
const HOLE_ALL = new RegExp(HOLE.source, 'g');
const shellQuote = (w) => `'${String(w).replace(/'/g, `'\\''`)}'`;
const filesIn = (dir) => readdirSync(dir).filter((f) => f !== '.jarl' && f !== '.git').sort();

// What is wrong with the refusal `said` of the wrong call `args` made on `loop` (copied with `opts`); `wrong` is the word
// of the call the reason must name, or null. An empty list is a refusal that holds.
export function formProblems(args, said, loop, opts = {}, wrong = null) {
  const lines = said.replace(/\n+$/, '').split('\n');
  // A loop run by a composer is closed and archived by its command, which the profile names.
  if (opts.profile?.lifecycle?.command && lines.at(-1) === opts.profile.lifecycle.command) return [];
  const { reason, commands } = partsOf(said);
  if (!commands.length || !reason.trim()) return [`no reason and form on lines of their own: ${lines.at(-1)}`];
  const given = withNames(args).map(String);
  const cmd = J.callOfArgv(given).cmd;
  const problems = [];
  const parsed = [];
  for (const line of commands) {
    const calls = printedCalls(line);
    if (!calls || calls.length !== 1) { problems.push(`not one command for a shell: ${line}`); continue; }
    const words = calls[0];
    parsed.push(words);
    for (const w of words) for (const m of w.matchAll(/<[^<>]*>/g)) if (!L.PLACEHOLDERS.includes(m[0]) && !given.some((g) => g.includes(m[0]))) problems.push(`prints ${m[0]}, no placeholder of the registry: ${line}`);
    if (words.includes('<as-the-reason-says>')) problems.push(`a command that writes and holds no placeholder of its own was given one by the net: ${line}`);
    const c = readCall(words);
    if (J.writes(['jarl.mjs', ...words]) && !words.some((w) => HOLE.test(w))) problems.push(`a command that writes, with no placeholder: pasted as printed it runs: ${line}`);
    for (const g of globalsOf(given)) if (!(g.length === 1 ? words.includes(g[0]) : words.some((w, i) => w === g[0] && words[i + 1] === g[1]))) problems.push(`drops ${g.join(' ')}, a global flag the call gave: ${line}`);
    for (const [k, v] of c.flags) if (k === 'by' && typeof v === 'string' && !HOLE.test(v) && !given.includes(v)) problems.push(`names --by ${v}, an author the call did not name: ${line}`);
    for (const [k] of c.flags) if (NEVER_ADDED.includes(k) && !given.includes(`--${k}`) && !given.includes(k)) problems.push(`adds --${k}, which the call did not ask for: ${line}`);
    // Every flag its command needs beside the ones it holds, and every argument it needs, as the command table says
    // (formNeeds): filled, the line is not refused for a part it left out.
    if (Object.hasOwn(COMMAND_FLAGS, c.cmd)) {
      const needs = J.formNeeds(c.cmd, new Set(c.flags.map(([k]) => k)));
      for (const k of needs.flags) problems.push(`leaves out --${k}, which ${c.cmd} needs with what it holds: ${line}`);
      const held = readCall(placed(words)).pos.length;
      if (held < needs.args) problems.push(`holds ${held} of the ${needs.args} arguments ${c.cmd} needs: ${line}`);
      if (held > needs.most) problems.push(`holds ${held} arguments, and ${c.cmd} takes ${needs.most} with what it holds (one stands in for another): ${line}`);
    }
  }
  if (wrong !== null && !names(reason, wrong)) problems.push(`the reason does not name ${JSON.stringify(wrong)}: ${reason.split('\n')[0].slice(0, 160)}`);
  // The reason prints no pipe and no angle bracket outside a placeholder of the registry, a text in double quotes and a
  // word of the caller it echoes in single quotes: pasted whole into a shell, none of its own pipes or redirects.
  const bare = [...new Set(given)].filter(Boolean).sort((a, b) => b.length - a.length)
    .reduce((t, w) => t.split(L.echoWord(w)).join(' '), reason).replace(/"[^"\n]*"/g, ' ').replace(HOLE_ALL, ' ');
  if (/[|<>]/.test(bare)) problems.push(`the reason prints ${bare.match(/[|<>]/)[0]} outside a placeholder and a quote: ${reason.split('\n')[0].slice(0, 160)}`);
  const form = parsed.at(-1);
  if (form) {
    // The form is the called command, the command a removed one is replaced by, or a step; it holds no value Jarl chose.
    const c = readCall(form);
    const allowed = [cmd, ...(J.REMOVED_FORMS[cmd] || []), ...(REPLACED_BY[cmd] || []), ...STEP_COMMANDS];
    if (!allowed.includes(c.cmd) && !HOLE.test(c.cmd)) problems.push(`ends with ${c.cmd}, neither the command called nor a step: ${commands.at(-1)}`);
    const globals = new Set(globalsOf(given).flat());
    for (const v of [...c.pos, ...c.flags.filter(([k]) => !Object.hasOwn(J.GLOBAL_FLAGS, k)).map(([, x]) => x).filter((x) => typeof x === 'string')]) {
      if (HOLE.test(v) || given.includes(v) || globals.has(v) || STRUCTURAL.has(v) || given.some((g) => g.split(',').map((s) => s.trim()).includes(v))) continue;
      problems.push(`holds ${JSON.stringify(v)}, a value the call did not give: ${commands.at(-1)}`);
    }
    // Filled with a plausible value for each placeholder and run where the call was made, the form is a call that runs,
    // or one refused for another reason than the call was.
    if (form.some((w) => HOLE.test(w))) {
      const first = (t) => t.replace(/\n+$/, '').split('\n')[0];
      const tried = fillings(form);
      const same = (words) => { const dir = copy(loop, opts); const again = run(dir, words); drop(dir); return again.status !== 0 && first(again.stderr) === first(reason); };
      if (tried.every(same)) problems.push(`filled, the form is refused again for the same reason: ${tried[0].map(shellQuote).join(' ')}`);
    }
  }
  // Pasted as printed into each shell, on a fresh copy: each command refused for its placeholder, and nothing written in
  // any loop; the whole message pasted creates no file and writes nothing either.
  const fresh = copy(loop, opts);
  const before = JSON.stringify(snapshot(fresh));
  drop(fresh);
  for (const sh of SHELLS) {
    for (const line of commands) {
      const dir = copy(loop, opts);
      const r = runPrinted(dir, line, sh);
      if (JSON.stringify(snapshot(dir)) !== before) problems.push(`pasted into ${sh}, it writes: ${line}`);
      if (HOLE.test(line) && (r.status === 0 || !/placeholder/.test(r.stderr))) problems.push(`pasted into ${sh}, it is not refused for its placeholder: ${line} — ${r.stderr.trim().split('\n')[0]}`);
      drop(dir);
    }
    const dir = copy(loop, opts);
    const files = filesIn(dir);
    runPrinted(dir, said, sh);
    if (JSON.stringify(snapshot(dir)) !== before) problems.push(`the whole message pasted into ${sh} writes: ${lines.at(-1)}`);
    if (JSON.stringify(filesIn(dir)) !== JSON.stringify(files)) problems.push(`the whole message pasted into ${sh} makes a file (${filesIn(dir).filter((f) => !files.includes(f)).join(', ')}): ${reason.split('\n')[0].slice(0, 120)}`);
    drop(dir);
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
    const wrote = r.status !== 0 && JSON.stringify(snapshot(dir)) !== before;
    drop(dir);
    if (r.status === 0) { if (mustRefuse) found.push(`${JSON.stringify(args)}: went through`); continue; }
    refused += 1;
    if (wrote) found.push(`${JSON.stringify(args)}: refused and wrote`);
    for (const p of formProblems(args, r.stderr, on, opts, wrong)) found.push(`${JSON.stringify(args)}: ${p}`);
  }
  return { found, refused };
}

// ---- the commands of answers, notes and views ---------------------------------------------------------------------------

// The .jarl/ of the loop a call made in `cwd` names, as a key of snapshot: the one its --root names, else the one where it
// was made.
function loopNamed(cwd, args) {
  const top = TOPS.get(cwd) ?? cwd;
  const roots = J.callOfArgv(args.map(String)).flags.filter(([k]) => k === 'root').map(([, v]) => v);
  const named = roots.length === 1 && typeof roots[0] === 'string' ? join(cwd, roots[0]) : cwd;
  const rel = relative(top, named).split('\\').join('/');
  return `${rel ? `${rel}/` : ''}.jarl/`;
}
const changedOutside = (before, after, prefix) => [...new Set([...Object.keys(before), ...Object.keys(after)])].map((k) => k.split('\\').join('/')).filter((k) => before[k] !== after[k] && !k.startsWith(prefix));
// What is wrong with the commands a call that went through printed (its answer, its notes, a row of its view): each
// carries the call's --root, and pasted into each shell, as printed and then filled with a plausible value for each
// placeholder, writes in no loop but the one the call named; a command that holds a placeholder is refused for it when
// pasted as printed, and writes nothing.
export function outputProblems(args, out, loop, opts = {}) {
  const problems = [];
  const given = args.map(String);
  const roots = globalsOf(given).filter((g) => g[0].startsWith('--root'));
  const spans = commandSpans(out);
  for (const { raw: line } of spans) {
    const calls = printedCalls(line);
    if (!calls || calls.length !== 1) { problems.push(`not one command for a shell: ${line}`); continue; }
    const words = calls[0];
    for (const g of roots) if (!(g.length === 1 ? words.includes(g[0]) : words.some((w, i) => w === g[0] && words[i + 1] === g[1]))) problems.push(`drops ${g.join(' ')}, a global flag the call gave: ${line}`);
    for (const w of words) for (const m of w.matchAll(/<[^<>]*>/g)) if (!L.PLACEHOLDERS.includes(m[0]) && !given.some((g) => g.includes(m[0]))) problems.push(`prints ${m[0]}, no placeholder of the registry: ${line}`);
    const holed = HOLE.test(line);
    for (const sh of SHELLS) {
      for (const [pasted, filledIn] of [[line, false], [`jarl.mjs ${L.printedLine(filled(words))}`, true]]) {
        if (filledIn && !holed) continue;
        const dir = copy(loop, opts);
        const prefix = loopNamed(dir, given);
        const before = snapshot(dir);
        const r = runPrinted(dir, pasted, sh);
        const after = snapshot(dir);
        const outside = changedOutside(before, after, prefix);
        if (outside.length) problems.push(`pasted ${filledIn ? 'filled ' : ''}into ${sh}, it writes outside the loop the call named (${outside.join(', ')}): ${pasted}`);
        if (!filledIn && holed && (r.status === 0 || !/placeholder/.test(r.stderr) || JSON.stringify(after) !== JSON.stringify(before))) problems.push(`pasted into ${sh}, it is not refused for its placeholder: ${pasted} — ${r.stderr.trim().split('\n')[0]}`);
        drop(dir);
      }
    }
  }
  return { problems, commands: spans.length };
}
// Each call that goes through on a fresh copy, with the commands of what it printed checked by outputProblems.
export function walkOutputs(cases, loop) {
  const found = [];
  let commands = 0;
  for (const c of cases) {
    const { args, pre, profile, loop: own } = Array.isArray(c) ? { args: c } : c;
    const on = own || loop;
    const opts = { pre, profile };
    const dir = copy(on, opts);
    const r = run(dir, args);
    drop(dir);
    // verify and scope answer with exit 2 when they find something: that is their answer, printed whole.
    if (r.status !== 0 && !(r.status === 2 && ['verify', 'scope'].includes(J.callOfArgv(args.map(String)).cmd))) { found.push(`${JSON.stringify(args)}: did not go through: ${r.stderr.trim().split('\n')[0]}`); continue; }
    const checked = outputProblems(args, `${r.stdout}\n${r.stderr}`, on, opts);
    commands += checked.commands;
    for (const p of checked.problems) found.push(`${JSON.stringify(args)}: ${p}`);
  }
  return { found, commands };
}

// ---- the wrong calls of the command table ---------------------------------------------------------------------------

// A call each writing command takes on the plain loop (base on the loop with a sibling repository, which declares one, and
// init where no loop lives); the generator breaks it in every way the table names, each call with the word of it the
// reason must name.
function keyOf4() { const f = readdirSync(join(PLAIN.dir, '.jarl', 'issues')).find((x) => x.startsWith('4-')); return /^\*\*Key:\*\* (\S+)/m.exec(readFileSync(join(PLAIN.dir, '.jarl', 'issues', f), 'utf8'))?.[1] ?? 'k'; }
const VALID = {
  init: ['g'], new: ['t', '--tier', 'light'], renumber: ['4', '--key', keyOf4()], import: ['research/findings.json'], evidence: ['1', 'a note'],
  retract: ['1', '1', '--by', 'jarl', 'the row was wrong'], field: ['1', 'Priority', '1'], split: ['1', '--line', '1=2'], base: ['tool', 'main'], set: ['1', 'deferred', 'later'],
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
const IDS_AT = { evidence: 0, retract: 0, field: 0, split: 0, set: 0, merged: 0, review: 0, round: 0, tick: 0 };
const OLD_TEXT = { set: 'why', review: 'findings', round: 'what', ask: 'question', answer: 'answer', log: 'event', decide: 'ruling', retract: 'reason' };
// Words a shell reads something in, given as a text the call carries beside the word that is wrong, and as the word that
// is wrong itself.
export const ODD = ['#12', '=x', '~', '~/x', '&&', ';', '|', '>', 'a>made', '<in', '(x)', 'a\nb', "it's", '"q"', '-x', '  leading', '', '$(touch pwned)', '`touch pwned`', '*', 'a\u2028b', 'a\u0085b', 'a\u2029b', 'a\rb'];
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
  for (const cmd of Object.keys(J.AUTHOR_REQUIRED)) { const valid = VALID[cmd]; if (!valid) continue; const at = valid.indexOf('--by'); if (at !== -1) add([cmd, ...valid.slice(0, at), ...valid.slice(at + 2)], '--by'); }
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
    [['evidence', '1', '--line', '1', '--ran', 'npm', 'test', '--saw', 'ok'], 'test'], [['evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'pass', '3'], '3'], [['set', '1', 'deferred', 'not', 'now'], 'now'],
    [['review', '1', 'approve', '--by', 'rev', 'read', 'it', 'all'], 'all'],
  ]) add(args, wrong);
  // Odd words: each given as the text of a call refused for its status, as a title refused for its tier, as the part field
  // does not write, and as a flag's name, a command's and a question's.
  for (const w of ODD) {
    add(['set', '1', 'Deferred', w], 'Deferred'); add(['new', w, '--tier', 'Light'], w.trim() ? 'Light' : null);
    if (w.trim() && !w.startsWith('-')) add(['field', '1', w, 'x'], w);
  }
  for (const name of ['--a;b', '--x|y', '--&&', '--#', '--$(touch pwned)', '--`id`', '--~', '--a>made', '--x<in']) add(['new', 't', '--tier', 'light', name, 'x'], name);
  for (const [args, wrong] of [[['a>made'], 'a>made'], [['>'], '>'], [['answer', 'a-9>made', 'yes', '--by', 'owner'], 'a-9>made'], [['goal', '--set', 'Model (huge>made): opus'], 'huge>made'], [['merged', '1', '--sha', 'abc1234', '--red', '9>made'], '9>made']]) add(args, wrong);
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
  const generated = generateWrongCalls().map((c, n) => {
    const [on, root] = c.loop === SIBLING ? [{ ...SIBLING, cwd: '' }, SIBLING.cwd] : c.loop === EMPTY ? [ROOTED, ROOT_EMPTY] : [ROOTED, ROOT_ARG];
    const globals = [...(n % 3 === 2 ? [`--root=${root}`] : ['--root', root]), ...(n % 4 === 1 ? ['--json'] : [])];
    return { ...c, args: [c.args[0], ...globals, ...c.args.slice(1)], loop: on };
  });
  // --root and --json written after a bare --, where they are arguments: refused, and carried into the form before the --,
  // with every flag of the command written there.
  const afterDashes = [
    [['evidence', '1', '--', '--json prints ok', '--root', ROOT_ARG], '--root'], [['set', '1', 'deferred', '--', 'later', '--root', ROOT_ARG], '--root'],
    [['review', '1', 'approve', '--by', 'rev', '--', 'read it all, fine', `--root=${ROOT_ARG}`], `--root=${ROOT_ARG}`], [['field', '1', 'What', '--', 'x', '--json', '--root', ROOT_ARG], '--json'],
    [['new', '--', 't', '--tier', 'light', '--root', ROOT_ARG], '--tier'], [['round', '1', '--', 'it failed', '--json', `--root=${ROOT_ARG}`], '--json'],
    [['log', '--', 'a note', '--root', ROOT_ARG, '--json'], '--root'], [['ask', '--', 'which way?', '--kind', 'stuck', '--root', ROOT_ARG], '--kind'],
    [['decide', 's9', '--', 'a ruling', '--by', 'jarl', '--root', ROOT_ARG], '--by'], [['set', '1', 'deferred', 'later', '--', '--root', ROOT_ARG], '--root'],
  ].map(([args, wrong]) => ({ args, wrong, loop: ROOTED }));
  return [...generated, ...afterDashes];
}
