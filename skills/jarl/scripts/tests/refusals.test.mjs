// Every refusal of a writing command ends with a ready command on its last line, of one of three kinds, decided for each
// refusal: the call fixed, where the fix is mechanical and cannot change what was meant; a step that has to come first,
// then the call; or the call with a placeholder where a value only the caller knows goes. The walk tests what a line
// means, not only its shape. This test reads each wrong call by itself and says what it meant where the words given
// determine it (meant, below); a line with no placeholder is run by a shell, and the record it leaves must equal the record
// the call meant leaves, word for word in the call and file for file under .jarl/; a line with a placeholder, run as
// written, is refused for it and writes nothing. No line names an author the call did not name, or a flag that removes or
// signs off what the call did not ask for. The wrong calls are generated from the command table — every writing command,
// each required argument left out, each value of a closed set wrong (in another case, misspelt, outside the set), an
// unknown flag with its value, a removed flag, a free text given as a flag, an empty text, a text that starts with --, an
// id the loop does not hold — and joined by the wrong calls kept as fixtures, each a way a call was found to go wrong. The sources are read
// too: every refusal is built by refuse or need, with its ready part, and nothing else is thrown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { jarl, SCRIPT } from './helpers.mjs';
import { bashBin, NO_EXCLUDES } from './portable.mjs';

const J = await import('../jarl.mjs');
const L = await import('../jarl-lib.mjs');
const { COMMAND_ARGS, COMMAND_FLAGS, GLOBAL_FLAGS, MUTATING, REPLACED_COMMANDS, REMOVED_FLAGS, REMOVED_FORMS } = J;
const { STATUSES, KINDS, TIERS, PRIORITIES, ASK_KINDS, CI_STATES } = L;
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

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
  return { dir: root, cwd: '', held: { 2: { worker: 'w2', branch: 'jarl/2-two' } }, options: { 'a-2': ['A', 'B'] } };
}
function logOf(dir) { return readFileSync(join(dir, '.jarl', 'log.md'), 'utf8'); }
// A loop in a checkout with a sibling repository: four issues (the second leased by w-beta, the first
// with a row, a note and an approve, the fourth with two acceptance lines), three questions and a ruling.
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
  return { dir: top, cwd: 'main', held: { 2: { worker: 'w-beta', branch: 'jarl/2-beta' } }, options: { 'a-2': ['A', 'B'] } };
}
const PLAIN = plainLoop();
const SIBLING = siblingLoop();

// A fresh copy of a loop, with a profile written in and the calls of `pre` run first; the directory a call runs in.
function copy(loop, { profile, pre } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-refusals-call-'));
  cpSync(loop.dir, dir, { recursive: true });
  const cwd = join(dir, loop.cwd);
  if (profile) writeFileSync(join(cwd, '.jarl', 'profile.json'), JSON.stringify(profile, null, 2));
  for (const a of pre || []) { const r = run(cwd, a); assert.equal(r.status, 0, `pre ${a.join(' ')}: ${r.stderr}`); }
  return cwd;
}
const run = (cwd, args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 60000 });
// A printed command line run by bash in the loop: jarl.mjs is a function there that runs this script with the words the
// shell gives it, so a word is never rewritten on its way and a text that holds "jarl.mjs" stays a text.
const unix = (p) => (process.platform === 'win32' ? p.replace(/\\/g, '/') : p);
function shell(cwd, line, body) {
  return spawnSync(bashBin(), ['-c', `jarl.mjs() { ${body}; }\n${line}`], { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, JARL_NODE: unix(process.execPath), JARL_SCRIPT: unix(SCRIPT) } });
}
export function runPrinted(cwd, line) { return shell(cwd, line, '"$JARL_NODE" "$JARL_SCRIPT" "$@"'); }
// The calls of a printed command line as the shell passes them: each one's words, jarl.mjs left out.
export function printedCalls(line) {
  const r = shell(tmpdir(), line, "printf '\\036'; printf '%s\\037' \"$@\"");
  if (r.status !== 0) return null;
  return r.stdout.split('\x1e').slice(1).map((c) => c.split('\x1f').slice(0, -1));
}

// Every file under .jarl/ but the lock, with what changes from one run to another (a time, an issue's random key) masked.
function snapshot(cwd) {
  const top = join(cwd, '.jarl');
  const out = {};
  if (!existsSync(top)) return out;
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (f === '.lock') continue;
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(top, p)] = readFileSync(p, 'utf8').replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?Z?)?/g, 'TIME').replace(/\b\d{8}T\d{4}-[a-z0-9]+\b/g, 'KEY');
    }
  };
  walk(top);
  return out;
}

// ---- what a call is -------------------------------------------------------------------------------------------------

// A call read from its words as the command line reads them: the command, its arguments in order and its flags as sorted
// [name, value] pairs. A word that starts with -- and holds a space is a text; an unknown flag takes the next word that is
// no flag as its value.
export function readCall(words, shapes = { ...GLOBAL_FLAGS, ...(COMMAND_FLAGS[words[0]] || {}) }) {
  const [cmd, ...rest] = words;
  const call = { cmd, pos: [], flags: [] };
  let after = false;
  for (let i = 0; i < rest.length; i += 1) {
    const w = String(rest[i]);
    if (!after && w === '--') { after = true; continue; }
    const name = w.startsWith('--') && w.length > 2 ? w.slice(2).split('=')[0] : null;
    if (after || name === null || /\s/.test(name)) { call.pos.push(w); continue; }
    const inline = w.includes('=') ? w.slice(w.indexOf('=') + 1) : undefined;
    const shape = shapes[name];
    if (inline !== undefined) call.flags.push([name, inline]);
    else if (shape === 'bool' || (shape === undefined && (i + 1 >= rest.length || String(rest[i + 1]).startsWith('-')))) call.flags.push([name, true]);
    else if (i + 1 >= rest.length) call.flags.push([name, null]);
    else { call.flags.push([name, String(rest[i + 1])]); i += 1; }
  }
  call.flags.sort((a, b) => `${a[0]}\0${a[1]}`.localeCompare(`${b[0]}\0${b[1]}`));
  return call;
}
const words = (call) => [call.cmd, ...call.flags.flatMap(([k, v]) => (v === true ? [`--${k}`] : [`--${k}`, v])), ...(call.pos.length ? ['--', ...call.pos] : [])];
const flagOf = (call, name) => call.flags.find(([k]) => k === name)?.[1];
const without = (call, ...names) => ({ ...call, flags: call.flags.filter(([k]) => !names.includes(k)) });
const withFlags = (call, ...pairs) => ({ ...call, flags: [...call.flags, ...pairs].sort((a, b) => `${a[0]}\0${a[1]}`.localeCompare(`${b[0]}\0${b[1]}`)) });

// The parts of the description field writes, the values of the closed sets and where each set sits.
const PARTS = ['Title', 'Priority', 'Tier', 'Kind', 'Found by', 'Tags', 'Files', 'Repo', 'After', 'Source', 'Where', 'Resources', 'Person', 'Check when', 'What', 'Why', 'Acceptance', 'Changelog'];
const SETS = {
  new: { '--tier': TIERS, '--kind': KINDS, '--prio': PRIORITIES }, import: { '--tier': TIERS, '--kind': KINDS, '--prio': PRIORITIES },
  set: { 1: STATUSES }, review: { 1: ['approve', 'changes'] }, merged: { '--ci': CI_STATES }, ask: { '--kind': ASK_KINDS }, mode: { 0: ['permanent'] },
};
const FIELD_SETS = { priority: PRIORITIES, tier: TIERS, kind: KINDS };
// The names a command's free text had in the tools, and the names an argument is given by as a flag.
const OLD_TEXT = { set: 'why', review: 'findings', round: 'what', ask: 'question', answer: 'answer', log: 'event', decide: 'ruling', retract: 'reason' };
const argNames = (cmd) => (COMMAND_ARGS[cmd] || []).map((a) => a.replace(/[?.]+$/, ''));
function argOfFlag(cmd, name) {
  const names = argNames(cmd);
  if (names.includes(name)) return names.indexOf(name);
  const last = names.length - 1;
  return (name === 'text' || OLD_TEXT[cmd] === name) && ['text', 'value', 'title', 'goal'].includes(names[last]) ? last : -1;
}
const caseOf = (value, set) => { if (set.includes(value)) return value; const same = set.filter((s) => s.toLowerCase() === String(value).toLowerCase()); return same.length === 1 ? same[0] : null; };

// What a wrong call meant, read by this test from the words given and the loop it is made on: the calls it is with only one
// of the corrections the tool may print as a line that runs — a value of a closed set in its own case, a removed form (a
// command, a flag, a tool field's name given as a flag) in the form that replaces it with every word given, a text after a
// bare -- — or null, when the words given do not determine it: a range to read again, a lease to take over, words to join
// or split, an item or a flag to add or drop are the caller's to say.
export function meant(args, loop) {
  const [cmd, ...rest] = args;
  if (Object.hasOwn(REPLACED_COMMANDS, cmd)) return replacedMeant(cmd, rest);
  let c = readCall(args);
  if (!Object.hasOwn(COMMAND_FLAGS, cmd)) return null;
  // The removed flags, and the retractions asked of evidence and of review.
  for (const [old, to] of Object.entries(REMOVED_FLAGS[cmd] || {})) {
    if (flagOf(c, old) === undefined) continue;
    if (to === 'retract') {
      const by = flagOf(c, 'by');
      if (typeof by !== 'string' || c.pos.length !== 2 || typeof flagOf(c, 'retract') !== 'string') return null;
      return [{ cmd: 'retract', pos: [c.pos[0], flagOf(c, 'retract'), c.pos[1]], flags: [['by', by]] }];
    }
    c = { ...c, flags: c.flags.map(([k, v]) => (k === old ? [to.replace(/^--/, ''), v] : [k, v])) };
  }
  if (cmd === 'review' && c.pos[1] === 'retract') {
    const by = flagOf(c, 'by');
    if (typeof by !== 'string' || c.pos.length !== 3) return null;
    return [{ cmd: 'retract', pos: [c.pos[0], 'review', c.pos[2]], flags: [['by', by]] }];
  }
  if (cmd === 'set' && c.pos[1] !== undefined && PARTS.some((p) => p.toLowerCase() === c.pos[1].toLowerCase()) && !STATUSES.includes(c.pos[1])) {
    const by = flagOf(c, 'by');
    const clearing = c.pos[2] === undefined || c.pos[2].trim() === '';
    return [{ cmd: 'field', pos: [c.pos[0], c.pos[1], ...(clearing ? [] : [c.pos[2]])], flags: [...(typeof by === 'string' ? [['by', by]] : []), ...(clearing ? [['clear', true]] : [])] }];
  }
  // Flags the command does not take: one that names an argument becomes that argument where its place is free.
  for (const [k, v] of c.flags) {
    if (Object.hasOwn(GLOBAL_FLAGS, k) || Object.hasOwn(COMMAND_FLAGS[cmd], k)) continue;
    const at = argOfFlag(cmd, k);
    if (at === -1 || typeof v !== 'string' || c.flags.filter(([x]) => x === k).length > 1 || c.pos.length < at || c.pos.length >= argNames(cmd).length) return null;
    c = { ...without(c, k), pos: [...c.pos.slice(0, at), v, ...c.pos.slice(at)] };
  }
  // A flag given twice, or given with no value: which value was meant is the caller's to say.
  for (const name of new Set(c.flags.map(([k]) => k))) {
    const given = c.flags.filter(([k]) => k === name);
    if (given.some(([, v]) => v === null) || (given.length > 1 && COMMAND_FLAGS[cmd][name] === 'value')) return null;
  }
  // Values of a closed set in another case.
  for (const [where, set] of Object.entries(SETS[cmd] || {})) {
    if (where.startsWith('--')) {
      const v = flagOf(c, where.slice(2));
      if (typeof v !== 'string') continue;
      const ok = caseOf(v, set);
      if (ok === null) return null;
      c = withFlags(without(c, where.slice(2)), [where.slice(2), ok]);
    } else if (c.pos[Number(where)] !== undefined) {
      const ok = caseOf(c.pos[Number(where)], set);
      if (ok === null) return null;
      c = { ...c, pos: c.pos.map((p, n) => (n === Number(where) ? ok : p)) };
    }
  }
  if (cmd === 'field' && c.pos[2] !== undefined && FIELD_SETS[String(c.pos[1]).toLowerCase()]) {
    const ok = caseOf(c.pos[2], FIELD_SETS[String(c.pos[1]).toLowerCase()]);
    if (ok === null) return null;
    c = { ...c, pos: [c.pos[0], c.pos[1], ok] };
  }
  if (cmd === 'answer' && typeof flagOf(c, 'option') === 'string') {
    const ok = caseOf(flagOf(c, 'option'), loop.options[c.pos[0]] || []);
    if (ok === null) return null;
    c = withFlags(without(c, 'option'), ['option', ok]);
  }
  return [c];
}
// The removed commands, each written as the calls that do what it did, from the words given; null where a word it needs
// was not given.
// A removed command's flags each take the next word, but the switches it had.
const REPLACED_SHAPES = new Proxy({ json: 'bool', help: 'bool', clear: 'bool', append: 'bool', gh: 'bool' }, { get: (t, k) => t[k] ?? 'value' });
function replacedMeant(cmd, rest) {
  const c = readCall([cmd, ...rest], REPLACED_SHAPES);
  const by = flagOf(c, 'by');
  const author = typeof by === 'string' ? [['by', by]] : [];
  const field = (part, ...more) => ({ cmd: 'field', pos: [c.pos[0], part, ...more.filter((m) => typeof m === 'string')], flags: [...author, ...more.filter(Array.isArray)] });
  if (cmd === 'tips' || cmd === 'queue') return [{ cmd: 'resume', pos: [], flags: [...(cmd === 'tips' ? [['gh', true]] : []), ...c.flags.filter(([k]) => k !== 'gh')] }];
  if (cmd === 'check') return c.pos.length || flagOf(c, 'branch') !== undefined ? [{ cmd: 'scope', pos: c.pos, flags: c.flags }] : null;
  if (cmd === 'repo' && typeof flagOf(c, 'base') === 'string') return c.pos.length === 1 ? [{ cmd: 'base', pos: [c.pos[0], flagOf(c, 'base')], flags: author }] : null;
  if (c.pos.length < 2 && !(flagOf(c, 'clear') === true && ['after', 'repo'].includes(cmd)) && cmd !== 'body') return null;
  if (cmd === 'prio') return [field('Priority', c.pos[1])];
  if (cmd === 'source') return [field('Source', c.pos.slice(1).join(','))];
  if (cmd === 'files') { const paths = c.pos.slice(1).flatMap((p) => p.split(',')).map((p) => p.trim()).filter(Boolean); return [paths.length ? field('Files', paths.join(',')) : field('Files', ['clear', true])]; }
  if (cmd === 'after' || cmd === 'repo') { const part = cmd === 'after' ? 'After' : 'Repo'; return [flagOf(c, 'clear') === true ? field(part, ['clear', true]) : field(part, c.pos.slice(1).join(','))]; }
  if (cmd === 'tag') {
    const ops = c.pos.slice(1).flatMap((o) => o.slice(1).split(',').filter(Boolean).map((n) => [o.charAt(0), n]));
    const remove = ops.filter(([s]) => s === '-').map(([, n]) => n);
    const add = ops.filter(([s]) => s === '+').map(([, n]) => n);
    return [...(remove.length ? [field('Tags', ['remove', true], remove.join(','))] : []), ...(add.length ? [field('Tags', ['add', true], add.join(','))] : [])];
  }
  if (cmd === 'body') {
    const parts = { title: 'Title', where: 'Where', what: 'What', why: 'Why', acceptance: 'Acceptance', changelog: 'Changelog' };
    const calls = [];
    for (const [flag, part] of Object.entries(parts)) {
      const given = c.flags.filter(([k]) => k === flag).map(([, v]) => v);
      if (!given.length) continue;
      if (given.some((g) => typeof g !== 'string')) return null;
      const items = ['acceptance', 'changelog'].includes(flag) ? given.flatMap((g) => g.split('\n')).filter((l) => l.trim()) : [given.at(-1)];
      items.forEach((v, n) => calls.push(field(part, ...(flagOf(c, 'append') === true && !['title', 'where'].includes(flag)) || n > 0 ? [['add', true]] : [], v)));
    }
    for (const s of c.flags.filter(([k]) => k === 'section').map(([, v]) => v)) {
      const at = String(s).indexOf('=');
      if (at <= 0) return null;
      calls.push(field(String(s).slice(0, at), ...(flagOf(c, 'append') === true ? [['add', true]] : []), String(s).slice(at + 1)));
    }
    return calls.length ? calls : null;
  }
  return null;
}

// The words of the reason and of a ready line, and whether a word holds a placeholder the call did not give. A placeholder
// keeps a text given in its token, its words joined by hyphens.
const tokenOf = (v) => String(v).replace(/[<>]/g, '').trim().replace(/[\s,]+/g, '-');
const HOLE = /<[^<>]+>/;
const reasonOf = (said) => said.trim().split('\n').slice(0, -1).join('\n');
// The commands that do what a removed command did.
const REPLACED_BY = { tips: ['resume'], queue: ['resume'], check: ['scope'], prio: ['field'], tag: ['field'], files: ['field'], source: ['field'], after: ['field'], repo: ['field', 'base'], body: ['field'] };
// Flags a ready line never adds to what the call gave: they remove, keep or sign off something nobody asked for.
const NEVER_ADDED = ['force', 'batch', 'keep', 'relayed', 'permanent', 'committed', 'header', 'adopt'];
// The commands a step before the call may run: a question put, an issue filed, a lease taken, a part declared.
const STEPS = ['ask', 'new', 'set', 'field', 'evidence'];

// What is wrong with the refusal `said` of the wrong call `args` made on `loop` (copied with `opts`): its last line, read
// as one of the three kinds and checked for what it means. An empty list is a refusal that holds.
export function refusalProblems(args, said, loop, opts = {}) {
  const lines = said.trim().split('\n');
  const ready = lines.at(-1);
  if (lines.length < 2) return [`no reason and ready command on lines of their own: ${ready}`];
  const cmd = args[0];
  // A loop run by a composer is closed and archived by its command, which the profile names.
  if (opts.profile?.lifecycle?.command && ready === opts.profile.lifecycle.command) return [];
  if (!/^jarl\.mjs \S/.test(ready)) return [`no ready command on the last line: ${ready}`];
  const unknown = !Object.hasOwn(COMMAND_FLAGS, cmd) && !Object.hasOwn(REPLACED_COMMANDS, cmd);
  const calls = printedCalls(ready);
  if (!calls || !calls.length) return [`the shell does not read it as calls of jarl.mjs: ${ready}`];
  const given = args.slice(1).map(String);
  const holes = calls.flat().filter((w) => HOLE.test(w) && !given.some((g) => g.includes(w.match(HOLE)[0])));
  const last = readCall(calls.at(-1));
  const problems = [];
  // Every placeholder the line prints is one token, with no space and no comma, so no reader of a list or a text splits it.
  for (const w of calls.flat()) for (const m of w.matchAll(/<[^<>]*>/g)) if (!given.some((g) => g.includes(m[0])) && /[\s,]/.test(m[0])) problems.push(`prints the placeholder ${m[0]}, which holds a space or a comma: ${ready}`);
  // The author: a ready line names the author the call named, or a placeholder for one, and never another.
  const by = readCall([cmd, ...given]).flags.find(([k, v]) => k === 'by' && typeof v === 'string')?.[1];
  for (const c of calls.map((w) => readCall(w))) for (const [k, v] of c.flags) if (k === 'by' && typeof v === 'string' && !HOLE.test(v) && v !== by) problems.push(`names --by ${v}, an author the call did not name: ${ready}`);
  for (const c of calls.map((w) => readCall(w))) for (const [k] of c.flags) if (NEVER_ADDED.includes(k) && !given.includes(`--${k}`) && !given.includes(k)) problems.push(`adds --${k}, which the call did not ask for: ${ready}`);
  const before = snapshot(copy(loop, opts));
  if (holes.length) {
    // The call with a placeholder: of the command, of the one a removed form names, or a question put to the owner; every
    // word it holds is one the call gave or a placeholder; pasted unfilled, it is refused and writes nothing.
    const allowed = [cmd, ...(REMOVED_FORMS[cmd] || []), ...(REPLACED_BY[cmd] || [])];
    if (unknown ? !HOLE.test(last.cmd) : !allowed.includes(last.cmd)) problems.push(`the call with a placeholder calls ${last.cmd}, not ${allowed.join(' or ')}: ${ready}`);
    const known = new Set([...given, ...given.map((g) => g.toLowerCase()), ...given.flatMap((g) => g.split(/\s+/)), ...PARTS, 'review', '--', last.cmd]);
    for (const w of calls.at(-1).slice(1)) if (!HOLE.test(w) && !w.startsWith('--') && !known.has(w) && !known.has(w.toLowerCase()) && !given.some((g) => g.split(',').map((s) => s.trim()).includes(w))) problems.push(`writes ${JSON.stringify(w)}, a value the call did not give: ${ready}`);
    // Every word the call gave is in the line, a placeholder keeping it in its token, but the one the reason names as wrong.
    const dropped = readCall([cmd, ...given]);
    const values = [...dropped.pos, ...dropped.flags.flatMap(([k, v]) => [`--${k}`, ...(typeof v === 'string' ? [v] : [])])].filter((v) => v !== '');
    const kept = calls.flat().map((w) => w.toLowerCase());
    const reason = reasonOf(said).toLowerCase();
    // A value is kept whole, item by item (a comma list), or word by word with at most the one word the reason names.
    const bare = (v) => v.toLowerCase().replace(/^["'`[\]]+|["'`[\]]+$/g, '');
    const has = (v) => v !== '' && (kept.some((w) => w === bare(v) || w.includes(bare(v)) || w.includes(tokenOf(bare(v)))) || reason.includes(bare(v)));
    const keeps = (v) => {
      if (has(v)) return true;
      const items = v.split(',').map((s) => s.trim()).filter(Boolean);
      if (items.length > 1) return items.every(keeps);
      const wordsOf = v.split(/[\s:()=#]+/).filter(Boolean);
      return wordsOf.length > 1 && wordsOf.filter((w) => !kept.some((k) => k.includes(bare(w)))).length <= 1 && wordsOf.every((w) => kept.some((k) => k.includes(bare(w))) || reason.includes(bare(w)));
    };
    const lost = values.filter((v) => !keeps(v));
    if (lost.length) problems.push(`drops ${lost.map((v) => JSON.stringify(v)).join(', ')}, which the call gave and the reason does not name as wrong: ${ready}`);
    const dir = copy(loop, opts);
    const pasted = runPrinted(dir, ready);
    if (pasted.status === 0) problems.push(`pasted with its placeholder unfilled, it runs: ${ready}`);
    if (JSON.stringify(snapshot(dir)) !== JSON.stringify(before)) problems.push(`pasted with its placeholder unfilled, it writes: ${ready}`);
    return problems;
  }
  // The call fixed, or a step and then the call: the calls the call meant, word for word, after the steps.
  const intended = meant(args, loop);
  if (!intended) return [...problems, `ends with a call that runs, but what the call meant is not determined by its words — a value was chosen for it: ${ready}`];
  const parsed = calls.map((w) => readCall(w));
  const steps = parsed.slice(0, parsed.length - intended.length);
  const ends = parsed.slice(parsed.length - intended.length);
  if (parsed.length < intended.length) return [...problems, `holds ${parsed.length} calls where the call meant ${intended.length}: ${ready}`];
  // A call corrected one value at a time is the call meant, each value either as given or as meant: a value still wrong
  // has it refused again, for that value, with nothing written.
  const given1 = readCall([cmd, ...given]);
  const stepwise = (c, m) => c.cmd === m.cmd && c.pos.length === m.pos.length && c.flags.length === m.flags.length
    && c.pos.every((v, n) => v === m.pos[n] || v === given1.pos[n]) && c.flags.every(([k, v], n) => k === m.flags[n][0] && (v === m.flags[n][1] || given1.flags.some(([gk, gv]) => gk === k && gv === v)));
  let partly = false;
  ends.forEach((c, n) => {
    const m = readCall(words(intended[n]));
    if (JSON.stringify(c) === JSON.stringify(m)) return;
    if (stepwise(c, m)) { partly = true; return; }
    problems.push(`is not the call meant (${words(intended[n]).join(' ')}): ${ready}`);
  });
  if (partly) {
    const dir = copy(loop, opts);
    const once = runPrinted(dir, ready);
    if (once.status === 0 || JSON.stringify(snapshot(dir)) !== JSON.stringify(before)) problems.push(`corrected in part, it runs or writes: ${ready}`);
    return problems;
  }
  for (const s of steps) if (!STEPS.includes(s.cmd) || (s.cmd === 'set' && s.pos[1] !== 'in-progress')) problems.push(`runs ${s.cmd} as a step before the call: ${ready}`);
  // Run: the line by the shell, and the steps then the calls meant on another copy; the two records are the same.
  const a = copy(loop, opts);
  const pasted = runPrinted(a, ready);
  const b = copy(loop, opts);
  for (const c of [...steps, ...intended]) if (run(b, words(c)).status !== 0) break;
  if (JSON.stringify(snapshot(a)) !== JSON.stringify(snapshot(b))) problems.push(`pasted, it writes another record than the call meant: ${ready}`);
  if (pasted.status !== 0 && reasonOf(pasted.stderr) === reasonOf(said)) problems.push(`pasted, it is refused for the same reason: ${ready}`);
  return problems;
}

// Each wrong call on a fresh copy: refused, nothing written, and its refusal holds.
function walk(cases, loop, { mustRefuse }) {
  const found = [];
  let refused = 0;
  for (const c of cases) {
    const { args, pre, profile, loop: own } = Array.isArray(c) ? { args: c } : c;
    const opts = { pre, profile };
    const on = own || loop;
    const dir = copy(on, opts);
    const before = snapshot(dir);
    const r = run(dir, args);
    if (r.status === 0) { if (mustRefuse) found.push(`${JSON.stringify(args)}: went through`); continue; }
    refused += 1;
    if (JSON.stringify(snapshot(dir)) !== JSON.stringify(before)) found.push(`${JSON.stringify(args)}: refused and wrote`);
    for (const p of refusalProblems(args, r.stderr, on, opts)) found.push(`${JSON.stringify(args)}: ${p}`);
  }
  return { found, refused };
}

// ---- the wrong calls of the command table ---------------------------------------------------------------------------

// A call each writing command takes on the plain loop (base on the loop with a sibling repository, which declares one); the
// generator breaks it in every way the table names. The key of one of the two files that carry 4, for renumber.
function keyOf4() { const f = readdirSync(join(PLAIN.dir, '.jarl', 'issues')).find((x) => x.startsWith('4-')); return /^\*\*Key:\*\* (\S+)/m.exec(readFileSync(join(PLAIN.dir, '.jarl', 'issues', f), 'utf8'))?.[1] ?? 'k'; }
const VALID = {
  init: ['g'], new: ['t', '--tier', 'light'], renumber: ['4', '--key', keyOf4()], import: ['research/findings.json'], evidence: ['1', 'a note'],
  retract: ['1', '1', '--by', 'jarl', 'the row was wrong'], field: ['1', 'Priority', '1'], base: ['tool', 'main'], set: ['1', 'deferred', 'later'],
  merged: ['1', '--sha', 'abc1234'], review: ['1', 'approve', '--by', 'rev', 'read it all, fine'], round: ['1', 'it failed'], tick: ['3', '2', '--by', 'owner'],
  ask: ['which?'], answer: ['a-1', 'this way', '--by', 'owner'], log: ['a note'], decide: ['s1', 'a ruling', '--by', 'jarl'], goal: ['--set', 'Check: npm test'],
  archive: ['old'], mode: ['permanent'], close: [],
};
// Values outside each closed set: one far from it, one misspelt, one in another case.
const OUTSIDE = { '--tier': ['huge'], '--kind': ['task'], '--prio': ['7'], '--ci': ['blue'], 1: ['bogus'], 0: ['bogus'] };
const misspelt = (v) => `${v.charAt(0)}${v.slice(2)}`;
const capital = (v) => `${v.charAt(0).toUpperCase()}${v.slice(1)}`;
const TEXT_AT = { evidence: 1, retract: 2, set: 2, review: 2, round: 1, ask: 0, answer: 1, log: 0, decide: 1 };
const IDS_AT = { evidence: 0, retract: 0, field: 0, set: 0, merged: 0, review: 0, round: 0, tick: 0 };
function positionalsOf(args) { const out = []; for (let i = 0; i < args.length; i += 1) { if (args[i].startsWith('--')) { i += args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? 1 : 0; continue; } out.push(i); } return out; }
export function generateWrongCalls() {
  const calls = [];
  for (const cmd of [...MUTATING]) {
    const valid = VALID[cmd];
    if (!valid) continue;
    const at = positionalsOf(valid);
    const required = COMMAND_ARGS[cmd].map((a, n) => (!a.endsWith('?') && !a.endsWith('...') ? n : null)).filter((n) => n !== null);
    for (const n of required) if (at[n] !== undefined) calls.push([cmd, ...valid.slice(0, at[n])]);
    for (const [where, set] of Object.entries(SETS[cmd] || {})) {
      for (const bad of [...(OUTSIDE[where] || []), ...(set === PRIORITIES ? [] : [misspelt(set[0]), capital(set[0])])]) {
        const args = [...valid];
        if (where.startsWith('--')) { const i = args.indexOf(where); if (i >= 0) args[i + 1] = bad; else args.push(where, bad); } else args[at[Number(where)]] = bad;
        calls.push([cmd, ...args]);
      }
    }
    if (cmd === 'field') for (const [name, value] of [['Bogus', 'x'], ['Priority', '7'], ['Tier', 'Strong'], ['Tier', 'stong'], ['Kind', 'Bug']]) calls.push(['field', '1', name, value]);
    calls.push([cmd, ...valid, '--bogus', 'x']);
    // Each flag that takes a value: given last with none, and (when it takes one value) given twice.
    for (const [flag, shape] of Object.entries(COMMAND_FLAGS[cmd])) {
      if (shape === 'bool') continue;
      calls.push([cmd, ...valid, `--${flag}`]);
      if (shape !== 'many' && !valid.includes(`--${flag}`)) calls.push([cmd, ...valid, `--${flag}`, 'a', `--${flag}`, 'b']);
    }
    if (TEXT_AT[cmd] !== undefined) {
      const text = valid[at[TEXT_AT[cmd]]];
      const empty = [...valid]; empty[at[TEXT_AT[cmd]]] = ''; calls.push([cmd, ...empty]);
      const dashed = [...valid]; dashed[at[TEXT_AT[cmd]]] = '--looks like a flag'; calls.push([cmd, ...dashed]);
      // The free text given as a flag: text, and the name it had in the tools.
      for (const name of ['text', ...(OLD_TEXT[cmd] ? [OLD_TEXT[cmd]] : [])]) { const flagged = valid.filter((_, i) => i !== at[TEXT_AT[cmd]]); calls.push([cmd, ...flagged, `--${name}`, text]); }
    }
    if (IDS_AT[cmd] !== undefined) { const wrong = [...valid]; wrong[at[IDS_AT[cmd]]] = '99'; calls.push([cmd, ...wrong]); }
  }
  // A write that records a judgement, with its author left out.
  for (const cmd of Object.keys(J.AUTHOR_REQUIRED)) { const valid = VALID[cmd]; const at = valid.indexOf('--by'); if (at !== -1) calls.push([cmd, ...valid.slice(0, at), ...valid.slice(at + 2)]); }
  // Calls refused for the state of the loop, as they are written: a close with work open, a loop out of git made
  // permanent, a loop opened where one lives.
  calls.push(['close'], ['close', '--by', 'jarl'], ['mode', 'permanent'], ['init', 'g', '--by', 'jarl']);
  for (const [cmd, flags] of Object.entries(REMOVED_FLAGS)) for (const flag of Object.keys(flags)) calls.push([cmd, ...(VALID[cmd] || []), `--${flag}`, ...(flag === 'retract' ? ['1'] : flag === 'by' ? ['repo'] : [])]);
  for (const cmd of Object.keys(REPLACED_COMMANDS)) calls.push([cmd, '1']);
  // A dashed item after another in a list, a range over ids the loop lacks or written backwards, a lease another worker
  // holds, and words of one text given apart.
  calls.push(
    ['new', 't', '--tier', 'light', '--tags', 'ui,-x'], ['new', 't', '--tier', 'light', '--files', 'src/a.mjs,--b'], ['field', '1', 'Files', 'a.mjs,-b.mjs', '--add'], ['field', '1', 'Tags', 'core,-x', '--remove'],
    ['set', '3-12', 'deferred', 'later'], ['round', '3-9', 'it failed'], ['field', '6-9', 'Priority', '1'], ['set', '3-2', 'dropped', 'duplicate of 1'], ['field', '3-1', 'Priority', '3'],
    ['set', '2', 'in-progress', 'start', '--worker', 'w-other', '--branch', 'jarl/2-other'], ['evidence', '1', '--ran', 'npm', 'test', '--saw', 'ok'], ['evidence', '1', '--ran', 'npm test', '--saw', 'pass', '3'],
    ['set', '1', 'deferred', 'not', 'now'], ['review', '1', 'approve', '--by', 'rev', 'read', 'it', 'all'],
  );
  return calls.map((a) => (a[0] === 'base' ? { args: a, loop: SIBLING } : a));
}

test('the check of a refusal catches a ready line that does what the call did not mean', () => {
  const said = (line) => `a reason (got "bogus")\n${line}`;
  const check = (args, line) => refusalProblems(args, said(line), PLAIN);
  // A refusal that holds: the call fixed, mechanically, and the call with a placeholder.
  assert.deepEqual(check(['set', '1', 'Deferred', 'later'], "jarl.mjs set 1 deferred later"), []);
  assert.deepEqual(check(['set', '1', 'bogus', 'later'], "jarl.mjs set 1 '<open|in-progress|done|dropped|deferred>' later"), []);
  // The ready part taken off, and an unrelated command after the reason.
  assert.match(refusalProblems(['set', '1', 'bogus'], 'status must be one of: open', PLAIN)[0], /no reason and ready command/);
  assert.match(check(['set', '1', 'bogus'], 'jarl.mjs list --all')[0], /a value was chosen|not the call meant/);
  // A status refusal that ends with next, or with the first value of the set, and a value of the set swapped in.
  assert.ok(check(['set', '1', 'bogus', 'later'], 'jarl.mjs next').length);
  assert.ok(check(['set', '1', 'bogus', 'later'], 'jarl.mjs set 1 open later').length);
  assert.ok(check(['set', '2', 'Done', 'all merged'], "jarl.mjs set 2 open 'all merged'").length);
  // close --force, an author swapped in, and a placeholder inside a value that writes when pasted.
  assert.ok(check(['close', '--by', 'jarl'], 'jarl.mjs close --force --by jarl').some((p) => /--force/.test(p)));
  assert.ok(check(['answer', 'a-3', 'yes', '--by', 'jarl'], 'jarl.mjs answer a-3 yes --by owner').some((p) => /author/.test(p)));
  assert.ok(check(['goal', '--set', 'Model (huge): opus'], "jarl.mjs goal --set 'Model (light): <model> or opus'").some((p) => /writes/.test(p)));
  // A word the call gave left out, and the same refusal again.
  assert.ok(check(['new', 't', '--tier', 'light', '--text', 'what it is'], 'jarl.mjs new t --tier light').length);
  assert.ok(check(['field', '1', 'Priority', '7'], 'jarl.mjs field 1 Priority 7').some((p) => /same reason|chosen/.test(p)));
});

test('every generated wrong call of every writing command is refused, writes nothing, and ends with a ready line that means what the call meant', () => {
  const calls = generateWrongCalls();
  assert.ok(calls.length >= 200, `the walk makes ${calls.length} calls`);
  const { found } = walk(calls, PLAIN, { mustRefuse: true });
  assert.deepEqual(found, []);
});

test('the wrong calls kept as fixtures end with a ready line that means what the call meant', () => {
  const calls = [...fixture('wrong-calls-review.json'), ...fixture('wrong-calls.json')];
  assert.ok(calls.length >= 180);
  const { found, refused } = walk(calls, PLAIN, { mustRefuse: false });
  assert.ok(refused >= 150, `${refused} of them are refused`);
  assert.deepEqual(found, []);
  const theirs = fixture('wrong-calls-meaning.json');
  assert.ok(theirs.length >= 150);
  const second = walk(theirs, SIBLING, { mustRefuse: false });
  assert.ok(second.refused >= 130, `${second.refused} of them are refused`);
  assert.deepEqual(second.found, []);
});

// ---- calls named one by one -----------------------------------------------------------------------------------------

// A call on the loop with a sibling repository: its refusal, the last line, and that line pasted as written on a fresh copy.
function refusal(args, opts = {}) {
  const dir = copy(SIBLING, opts);
  const r = run(dir, args);
  assert.notEqual(r.status, 0, `${args.join(' ')} is refused`);
  const ready = r.stderr.trim().split('\n').at(-1);
  assert.deepEqual(refusalProblems(args, r.stderr, SIBLING, opts), [], args.join(' '));
  const pasted = copy(SIBLING, opts);
  const out = runPrinted(pasted, ready);
  return { ready, pasted, out, issue: (id) => L.findIssue(pasted, id) };
}

test('a status outside the set is fixed only by its case: a leased issue is never moved to open, a done one never reopened', () => {
  const leased = refusal(['set', '2', 'Done', 'all merged']);
  assert.equal(leased.ready, "jarl.mjs set 2 done 'all merged'");
  assert.equal(leased.issue('2').status, 'in-progress', 'done is refused there, and the lease holds');
  assert.equal(leased.issue('2').fields.worker, 'w-beta');
  const done = refusal(['set', '1', 'Dropped', 'duplicate of 4'], { pre: [['set', '1', 'done', 'finished']] });
  assert.equal(done.ready, "jarl.mjs set 1 dropped 'duplicate of 4'");
  assert.equal(done.issue('1').status, 'dropped');
  const bogus = refusal(['set', '2', 'finished', 'all merged']);
  assert.match(bogus.ready, /^jarl\.mjs set 2 '<open\|in-progress\|done\|dropped\|deferred>' 'all merged'$/);
  assert.equal(bogus.issue('2').status, 'in-progress');
});

test('an option, a question and an author are never chosen for the caller: the owner\'s choice, another question and his ratification stay his', () => {
  assert.equal(refusal(['answer', 'a-2', '--option', 'b', '--by', 'owner']).ready, 'jarl.mjs answer a-2 --option B --by owner');
  const other = refusal(['answer', 'a-2', '--option', 'second', '--by', 'owner']);
  assert.match(other.ready, /--option '<A\|B>'/);
  assert.equal(L.loadAsks(other.pasted).find((a) => a.id === '2').state, 'open');
  const none = refusal(['answer', 'a-4', 'yes', '--by', 'owner']);
  assert.match(none.ready, /^jarl\.mjs answer '<a-1\|a-2\|a-3>' yes --by owner$/);
  assert.ok(L.loadAsks(none.pasted).every((a) => a.state === 'open'), 'no question is answered');
  const ratify = refusal(['answer', 'a-3', 'yes', '--by', 'jarl']);
  assert.doesNotMatch(ratify.ready, /--by owner\b/);
  assert.equal(L.loadAsks(ratify.pasted).find((a) => a.id === '3').state, 'open');
  const tick = refusal(['tick', '1', '0', '--by', 'owner']);
  assert.doesNotMatch(tick.ready, /\bfield\b|\[owner\]/, 'no owner line is made up');
  assert.doesNotMatch(readFileSync(L.findIssue(tick.pasted, '1').file, 'utf8'), /\[owner\]/);
  const self = refusal(['review', '2', 'approve', '--by', 'w-beta', 'read it all and it is fine'], { pre: [['evidence', '2', '--ran', 'npm test', '--saw', 'pass 2']] });
  assert.match(self.ready, /--by '<a-fresh-reviewer-not-w-beta>'/);
  assert.notEqual(run(self.pasted, ['set', '2', 'done', 'merged']).status, 0, 'the pasted line records no approve, so done stays refused');
});

test('close with open issues ends with the question to the owner, never with close --force', () => {
  const r = refusal(['close', '--by', 'jarl']);
  assert.doesNotMatch(r.ready, /--force/);
  assert.match(r.ready, /^jarl\.mjs ask '<close-the-loop-with-1-2-3-4-still-open\?>' --by jarl$/);
  assert.ok(existsSync(join(r.pasted, '.jarl', 'goal.md')));
});

test('a part field does not write, and a line taken off a section, end with a placeholder: never another field, never the section replaced', () => {
  for (const part of ['Notes', 'Status', 'Reviews', 'Merged', 'Worker']) {
    const r = refusal(['field', '1', part, 'x']);
    assert.doesNotMatch(r.ready, /Priority/, part);
    assert.match(r.ready, /^jarl\.mjs field 1 '<a-part-of-the-description>' x$/, part);
  }
  const r = refusal(['field', '4', 'Acceptance', 'delta works', '--remove']);
  assert.equal(L.findIssue(r.pasted, '4').sections.acceptance, L.findIssue(copy(SIBLING), '4').sections.acceptance);
  assert.match(L.findIssue(r.pasted, '4').sections.acceptance, /delta works[\s\S]*and still works/);
  assert.match(r.ready, /'<the-whole-Acceptance-section-without-delta-works>'/);
});

test('a tier, a kind and a goal line outside their sets keep the value given in a placeholder, or take only its case', () => {
  assert.equal(refusal(['new', 't', '--tier', 'Strong']).ready, 'jarl.mjs new t --tier strong');
  assert.match(refusal(['new', 't', '--tier', 'stong']).ready, /--tier '<light\|standard\|strong>'/);
  const goal = refusal(['goal', '--set', 'Model (huge): opus']);
  assert.equal(goal.ready, "jarl.mjs goal --set 'Model (<light|standard|strong>): opus'");
  // A profile that declares its own fields of a wait keeps no promise among its kinds: the kind is never another one.
  const dir = mkdtempSync(join(tmpdir(), 'jarl-refusals-kinds-'));
  mkdirSync(join(dir, '.git'));
  jarl(dir, 'init', 'goal');
  writeFileSync(join(dir, '.jarl', 'profile.json'), JSON.stringify({ 'jarl-profile': 1, name: 'kinded', statuses: L.BUILTIN_STATUSES, fields: { Person: {} } }));
  const r = run(dir, ['new', 't', '--tier', 'light', '--kind', 'promise']);
  assert.match(r.stderr.trim().split('\n').at(-1), /--kind '<bug\|gap\|cleanup\|docs\|test\|research\|process>'$/);
});

test('a ready line keeps every word given: a title that starts with --, a text given as an unknown flag, a takeover\'s reason, a short finding, a path that starts with -', () => {
  const dash = refusal(['new', '--dash title', '--tier', 'light']);
  assert.equal(dash.ready, "jarl.mjs new --tier light -- '--dash title'");
  assert.ok(L.loadIssues(dash.pasted).some((i) => i.title === '--dash title'));
  const text = refusal(['new', 't', '--tier', 'light', '--text', 'what it is']);
  assert.match(text.ready, /'what it is'/);
  assert.ok(!L.loadIssues(text.pasted).some((i) => i.title === 't'), 'nothing is filed without the text');
  const takeover = refusal(['set', '2', 'in-progress', 'take over', '--worker', 'w-new']);
  assert.equal(takeover.ready, "jarl.mjs set 2 in-progress 'take over' --worker w-new '<--handover-to-end-the-lease-of-w-beta-or-none>'");
  assert.equal(takeover.issue('2').fields.worker, 'w-beta', 'pasted unfilled, the lease another worker holds stays his');
  assert.match(refusal(['review', '2', 'changes', '--by', 'rev-q', 'Important: x']).ready, /'<Important:-x-in-at-least-3-words>'/);
  const path = refusal(['field', '1', 'Files', '-x.mjs', '--add']);
  assert.match(path.ready, /'<item-for--x\.mjs-with-no-leading-dash>'/);
  assert.doesNotMatch(path.ready, / x\.mjs/);
});

test('a ready line is not refused again for the reason the call was: a value with --clear, an attachment with rows, a composer\'s close and archive', () => {
  for (const args of [['field', '1', 'Tags', 'a,b', '--clear'], ['evidence', '4', '--file', 'x.png', '--slot', 'before', '--ran', 'npm test', '--saw', 'ok']]) {
    const dir = copy(SIBLING);
    const r = run(dir, args);
    const again = runPrinted(copy(SIBLING), r.stderr.trim().split('\n').at(-1));
    assert.notEqual(reasonOf(again.stderr), reasonOf(r.stderr), args.join(' '));
  }
  const composer = { 'jarl-profile': 1, format: 3, name: 'composer', statuses: { open: ['dispatchable'], 'in-progress': ['lease'], done: ['settles-dependents', 'terminal', 'closes-record'], dropped: ['settles-dependents', 'terminal', 'needs-reason'], deferred: ['terminal', 'needs-reason'] }, lifecycle: { close: 'record', archive: 'record', command: 'composer done' } };
  for (const args of [['close', '--force'], ['archive', 'old']]) {
    const r = run(copy(SIBLING, { profile: composer }), args);
    assert.equal(r.stderr.trim().split('\n').at(-1), 'composer done', args.join(' '));
  }
});

// ---- placeholders are never data -------------------------------------------------------------------------------------

test('a value, a list item or the value part of a value written in parts that is one placeholder is refused, with nothing written; a text that holds angle brackets among other words is written', () => {
  const holes = [
    ['review', '1', 'approve', '--by', '<reviewer>', 'read it all, fine'], ['retract', '1', '1', '--by', '<who>', 'the row was wrong'],
    ['evidence', '1', '--ran', '<command>', '--saw', 'ok'], ['evidence', '1', '--ran', 'npm test', '--saw', '<what it printed>'],
    ['set', '3', 'in-progress', 'start', '--worker', 'w3', '--branch', '<worker branch>'], ['field', '1', 'Title', '<title>'], ['new', '<title>', '--tier', 'light'],
    ['answer', 'a-1', '<text>', '--by', 'owner'], ['decide', 's9', '<text>', '--by', 'jarl'], ['decide', '<slug>', 'a ruling', '--by', 'jarl'],
    ['field', '1', 'Tags', 'a,<tag>'], ['new', 't', '--tier', 'light', '--after', '3,<id>'], ['log', '<a note that is not shaped as a move>'],
    ['answer', 'a-2', '--option', '<A|B>', '--by', 'owner'], ['goal', '--set', '<Model (light|standard|strong): opus>'],
    // The value part of a value written in parts: a goal line, an option, a source, a field and a section of a profile, a
    // changelog entry, a selector of a scope; and a list item taken off.
    ['goal', '--set', 'Check: <command>'], ['goal', '--set', 'Model (<light|standard|strong>): opus'], ['ask', 'q?', '--option', 'A: <effect>', '--option', 'B: b'],
    ['new', 't', '--tier', 'light', '--source', '<dir>#<id>'], ['new', 't', '--tier', 'light', '--source', 'research#<id>'], ['new', 't', '--tier', 'light', '--field', 'Area=<value>'],
    ['new', 't', '--tier', 'light', '--section', 'Design=<text>'], ['field', '1', 'Changelog', 'Added: <entry>'], ['new', 't', '--tier', 'light', '--changelog', 'Fixed: <what changed>'],
    ['decide', 's9', 'a ruling', '--by', 'jarl', '--applies-to', 'role <role>'], ['field', '1', 'Tags', 'core,<a-tag>', '--remove'], ['field', '1', 'Source', 'r/x#<id>'],
  ];
  for (const args of holes) {
    const dir = copy(PLAIN);
    const before = snapshot(dir);
    const r = run(dir, args);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.match(r.stderr, /placeholder/, args.join(' '));
    assert.deepEqual(snapshot(dir), before, args.join(' '));
  }
  const genuine = [
    ['evidence', '1', '--ran', 'node a.mjs <in.txt', '--saw', 'Vec<T> is fine'], ['field', '1', 'Title', 'the <b> tag is escaped'],
    ['new', 'Map<K, V> leaks', '--tier', 'light'], ['decide', 's9', 'use <x> where it fits', '--by', 'jarl'], ['log', '<x> and more'], ['review', '1', 'approve', '--by', 'rev', '<html> renders, all fine'],
    ['new', 'Jarl: <b> handling', '--tier', 'light'], ['field', '1', 'Where', 'the <tag> in a.mjs, line 3'], ['evidence', '1', '--ran', 'npm test', '--saw', 'it printed <b>ok</b>'],
    ['field', '1', 'Changelog', 'Fixed: a <b> tag is escaped'], ['ask', 'q?', '--option', 'A: keep <b> as it is', '--option', 'B: drop it'], ['goal', '--set', 'Check: node run.mjs <in.txt'],
  ];
  for (const args of genuine) assert.equal(run(copy(PLAIN), args).status, 0, args.join(' '));
});

// ---- texts that start with -- ----------------------------------------------------------------------------------------

test('a ready call whose text starts with -- writes the text after a bare --, and the shell runs it with the text as given', () => {
  const cases = [
    [['retract', '1', '1', '--', '--the row ran on the wrong tree'], { "'<who>'": 'jarl' }, '--the row ran on the wrong tree'],
    [['evidence', '1', '--retract', '1', '--by', 'jarl', '--', '--the row ran elsewhere'], {}, '--the row ran elsewhere'],
    [['answer', 'a-1', '--', '--this way, not that'], { "'<who>'": 'owner' }, '--this way, not that'],
    [['decide', 'the-way', '--', '--we go this way'], { "'<who>'": 'jarl' }, '--we go this way'],
    [['body', '1', '--changelog', '--Fixed: a dash first'], {}, '--Fixed: a dash first'],
  ];
  for (const [args, fill, text] of cases) {
    const dir = copy(PLAIN);
    const said = run(dir, args);
    assert.notEqual(said.status, 0, args.join(' '));
    let ready = said.stderr.trim().split('\n').at(-1);
    assert.match(ready, / -- (?:\S+ )*'--/, `${args.join(' ')}: the text after a bare --: ${ready}`);
    for (const [from, to] of Object.entries(fill)) ready = ready.split(from).join(to);
    const again = runPrinted(dir, ready);
    assert.equal(again.status, 0, `${ready}\n${again.stderr}`);
    assert.ok(readdirSync(join(dir, '.jarl'), { recursive: true }).some((f) => /\.md$/.test(f) && readFileSync(join(dir, '.jarl', f), 'utf8').includes(text)), `${args[0]}: the text is written as given`);
  }
});

// ---- the sources -----------------------------------------------------------------------------------------------------

// A refusal is thrown only by refuse, or by need with a reason and a ready part: no error of any class is made or thrown
// anywhere else. The places that do are named here, each with why: refusalFor makes the one Error a refusal reaches the
// caller as; refuse throws the Refusal it builds, and a TypeError when it is given no ready part; withLock throws a
// TypeError at a library caller that hands it async work, a mistake in that caller's code and no refusal of a call.
const SOURCES = fileURLToPath(new URL('../', import.meta.url));
const sourceFiles = () => ['jarl.mjs', 'record.mjs', ...readdirSync(join(SOURCES, 'lib')).filter((f) => f.endsWith('.mjs')).map((f) => `lib/${f}`)];
const ALLOWED_ERRORS = [
  ['jarl.mjs', /return new Error\(`\$\{e\.reason\}\\n\$\{ready\}`\)/],
  ['lib/base.mjs', /throw new TypeError\(`a refusal is built from a reason and a ready part/],
  ['lib/base.mjs', /throw new Refusal\(reason, ready\)/],
  ['lib/lock.mjs', /throw new TypeError\(ASYNC_REFUSAL\)/],
];
// A throw that hands on what was caught (throw e), or the refusal the command line builds from it, is not a new error.
const RETHROW = /\bthrow\s+(?:e|err|error)\s*;|\bthrow\s+refusalFor\(/;
export function errorProblems(file, src) {
  const problems = [];
  src.split('\n').forEach((l, i) => {
    if (/^\s*\/\//.test(l)) return;
    const made = /\bnew\s+[A-Z]\w*(?:Error|Refusal)\s*\(/.test(l) || /\bnew\s+Error\s*\(/.test(l);
    const thrown = /\bthrow\b/.test(l) && !RETHROW.test(l);
    if (!made && !thrown) return;
    if (ALLOWED_ERRORS.some(([f, re]) => f === file && re.test(l))) return;
    problems.push(`${file}:${i + 1}: ${l.trim().slice(0, 100)}`);
  });
  return problems;
}
function needArity(src) {
  const bad = [];
  for (const m of src.matchAll(/(?<![\w$.])need\(|\bL\.need\(/g)) {
    if (/function need\(/.test(src.slice(Math.max(0, m.index - 9), m.index + 5))) continue;
    let depth = 0; let args = 1; let q = null;
    for (let i = m.index + m[0].length; i < src.length; i += 1) {
      const c = src[i];
      if (q) { if (c === '\\') i += 1; else if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; continue; }
      if ('([{'.includes(c)) depth += 1;
      else if (')]}'.includes(c)) { if (depth === 0) break; depth -= 1; }
      else if (c === ',' && depth === 0) args += 1;
    }
    if (args < 3) bad.push(src.slice(0, m.index).split('\n').length);
  }
  return bad;
}
// The ready part of each need and refuse of a source, as written: the last argument of the call.
function readyParts(src) {
  const out = [];
  for (const m of src.matchAll(/(?<![\w$.])(?:need|refuse)\(|\bL\.need\(/g)) {
    if (/function (?:need|refuse)\(/.test(src.slice(Math.max(0, m.index - 9), m.index + 7))) continue;
    let depth = 0; let q = null; let start = m.index + m[0].length; let i = start;
    for (; i < src.length; i += 1) {
      const c = src[i];
      if (q) { if (c === '\\') i += 1; else if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; continue; }
      if ('([{'.includes(c)) depth += 1;
      else if (')]}'.includes(c)) { if (depth === 0) break; depth -= 1; }
      else if (c === ',' && depth === 0) start = i + 1;
    }
    out.push({ line: src.slice(0, m.index).split('\n').length, text: src.slice(start, i).trim() });
  }
  return out;
}
// What a ready part is, read from its source: it names a correction of CORRECTIONS (fix: '<name>'), or it holds a
// placeholder — written as one (a text that starts with <, hole, placeholderOf), or made by one of the functions below, each
// of which returns a placeholder or a named correction, as the walk proves of every line they make.
const MAKES_HOLES = ['afterView', 'refiled', 'askOwner', 'doneReady', 'openQuestion', 'openLine', 'carriedTwice', 'keysOf', 'rowFirst', 'noteFirst', 'scopeHole', 'verdictHole', 'ownerLineHole', 'flagHole', 'rewrite', 'retractInstead', 'OWNER_TICKS', 'LINE_WRITERS'];
export function unnamedReadyParts(file, src, corrections) {
  const problems = [];
  for (const { line, text } of readyParts(src)) {
    // A ready part handed on as it was built: need's own, and a refusal thrown again over several ids.
    if (/^(?:e\.ready|typeof ready === 'function' \? ready\(\) : ready)$/.test(text)) continue;
    const named = [...text.matchAll(/\bfix: '([a-z]+)'/g)].map((x) => x[1]);
    for (const n of named) if (!Object.hasOwn(corrections, n)) problems.push(`${file}:${line}: names ${n}, which is no correction`);
    const holds = /['"`]<|<\$\{|<[a-z]|\bhole\(|\bplaceholderOf\(|\bheld: true\b/.test(text) || MAKES_HOLES.some((h) => new RegExp(`\\b${h}\\b`).test(text));
    if (!named.length && !holds) problems.push(`${file}:${line}: a ready part that names no correction and holds no placeholder: ${text.slice(0, 80)}`);
  }
  return problems;
}
test('every ready part of the sources names its correction from the table, or holds a placeholder', () => {
  const problems = [];
  for (const f of sourceFiles()) problems.push(...unnamedReadyParts(f, readFileSync(join(SOURCES, f), 'utf8'), L.CORRECTIONS));
  assert.deepEqual(problems, []);
  // The check reads a ready part that writes a value of its choosing, or names a correction the table lacks.
  assert.equal(unnamedReadyParts('x', "need(a, 'reason', () => ({ arg: 1, value: 'open' }));", L.CORRECTIONS).length, 1);
  assert.equal(unnamedReadyParts('x', "need(a, 'reason', () => ({ flag: '--handover' }));", L.CORRECTIONS).length, 1);
  assert.equal(unnamedReadyParts('x', "need(a, 'reason', () => ({ replace: x, value: y, fix: 'guess' }));", L.CORRECTIONS).length, 1);
  assert.deepEqual(unnamedReadyParts('x', "need(a, 'reason', () => ({ arg: 1, value: oneOf(s, set), fix: 'case' }));\nneed(b, 'r', { arg: 0, value: '<id>' });", L.CORRECTIONS), []);
  // And the command line keeps a line that would run without a correction named from running: it gets a placeholder.
  const said = J.refusalFor(new L.Refusal('a reason', { arg: 1, value: 'open' }), { cmd: 'set', args: ['1', 'bogus'], flags: [] }).message;
  assert.match(said.split('\n').at(-1), /^jarl\.mjs set 1 open '<as-the-reason-says>'$/);
  assert.equal(J.refusalFor(new L.Refusal('a reason', { arg: 1, value: 'done', fix: 'case' }), { cmd: 'set', args: ['1', 'Done'], flags: [] }).message.split('\n').at(-1), 'jarl.mjs set 1 done');
});
test('every refusal of the sources is built by refuse or need with its ready part; no other error of any class is made or thrown', async () => {
  const problems = [];
  for (const f of sourceFiles()) {
    const src = readFileSync(join(SOURCES, f), 'utf8');
    for (const line of needArity(src)) problems.push(`${f}:${line}: need( with no ready part`);
    problems.push(...errorProblems(f, src));
  }
  assert.deepEqual(problems, []);
  // refuse turns away a refusal with no ready part, or with one that is neither a command nor a fix.
  const { refuse } = await import('../lib/base.mjs');
  assert.throws(() => refuse('a reason'), TypeError);
  assert.throws(() => refuse('a reason', 'list the issues'), TypeError);
  assert.throws(() => refuse('a reason', { first: 'see the help' }), TypeError);
  assert.throws(() => refuse('a reason', ['jarl.mjs', 'list']), (e) => e.reason === 'a reason' && e.message === 'a reason\njarl.mjs list');
  // The checks see a need with two arguments, and an error of any class made or thrown outside refuse.
  assert.deepEqual(needArity("need(a, 'reason');\nneed(a, 'reason', ['jarl.mjs', 'x']);"), [1]);
  for (const planted of ["  throw new RangeError('bad status');", "  throw new Error('no such issue');", "  const e = new TypeError('x');", "  throw Object.assign(new Error('x'), { code: 1 });", "  throw 'a refusal';"]) {
    assert.equal(errorProblems('lib/commands.mjs', `const a = 1;\n${planted}\n`).length, 1, planted);
  }
  assert.deepEqual(errorProblems('lib/commands.mjs', 'try { x(); } catch (e) { throw e; }\n'), []);
});
