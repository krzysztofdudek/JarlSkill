#!/usr/bin/env node
// jarl.mjs — the one tool the jarl skill's state moves through: the command line over record.mjs.
//
// Markdown is the source of truth: the loop's goal, decisions and log, and one
// .jarl/issues/7-slug.md per issue. This script only reads and writes those files, so anything
// it does can be checked by opening them. Zero dependencies, Node 22+.
//
// What is here: the flag and argument tables, the parser and dispatch — one command, run and rendered.
// Every operation on the record goes through record.mjs, the stable surface another tool may vendor; the rest of the
// commands (the views over git, import, report and the like) come from jarl-lib.mjs, the implementation behind both.
// This module re-exports jarl-lib.mjs whole, but none of those exports is a contract: only
// record.mjs (RECORD_API) is.

import { readFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from './record.mjs';
import {
  fieldText, need, refuse, Refusal, isFix, isExternal, isPlaceholder, hole, HOLE, commandOf, printedLine, commandLine, readyText, breaksLine, escapedEchoes, shellWord, shellOf, printable, printCommand, MUTATING, writes, signedWords, printingFor, jarlLine, rootPrintable, resetCaches, withLock, readText, isEntry, cmdSet, cmdField, setRouteOf, eachIssue, cmdRound,
  cmdProfile, cmdArchive, cmdList, cmdNext, renderNext, cmdMode, cmdClose, cmdCheck, cmdBranches,
  cmdChangelog, cmdHandoffRead, cmdHandoffWrite, cmdReport, cmdImport, cmdSources, cmdAnswerMany, cmdModels, renderModels,
  issuesNaming, questionFor, cmdGoal, cmdGoalSet, cmdRepoBase, whereOf, cmdVerify, renderVerify, renderCheckNotes,
  renderProfile, renderResume, renderStatus, renderImport, renderSources, renderList, recordTypeLog, recordRuleLog,
  runDecisionsDriver, mergeFlags, describeNew, renderNewReply, issueView, workerEvidence, attachmentStates, evidenceTable, renderBranches, renderDecide, renderDecisions,
  cmdExtend, needLoop, cmdNextAs, renderNextAs, askerSection, renderBrief, cmdTick, cmdRetractTick, readsAsInstruction, cmdWithdrawSupersession, renderWithdrawn, atLeaseText, issueLinesAtLease, withWriter, editorOf, readProfileFile, cmdRenumber, cmdSplit,
  needKnownModels, cmdUse, renderUse, discoverLoop, needRecordFormat, UNRECORDED,
} from './jarl-lib.mjs';
import { writeAreaDecision, writeRuleRatification } from './yg-edge.mjs';
import { USAGE } from './jarl-usage.mjs';

export * from './jarl-lib.mjs';
export { USAGE };

// ---- main --------------------------------------------------------------------------------------

// Every flag a command accepts, and what it takes: 'bool' takes no value, 'value' takes exactly one,
// 'many' may repeat (one value each time). A value flag always consumes the next argument, whatever it
// starts with — `--ran "--help"` records a row whose command is --help — or takes it inline as
// --flag=value. A bare `--` ends the flags: everything after it is positional, so a free-text note or
// a title that starts with -- goes there. A flag the command does not know is an error that names the
// ones it does, never silently dropped.
export const GLOBAL_FLAGS = { json: 'bool', help: 'bool', root: 'value' };
export const COMMAND_FLAGS = {
  init: { committed: 'bool', permanent: 'bool', profile: 'value', by: 'value' },
  renumber: { key: 'value', by: 'value' },
  new: {
    kind: 'value', prio: 'value', tier: 'value', tags: 'many', files: 'many', repo: 'many', 'found-by': 'value',
    where: 'value', what: 'value', why: 'value', acceptance: 'many', source: 'many', after: 'many', changelog: 'many', template: 'value',
    field: 'many', section: 'many', person: 'value', 'check-when': 'value', range: 'value', by: 'value',
  },
  import: {
    source: 'value', kind: 'value', prio: 'value', tier: 'value', tags: 'many', repo: 'many', 'found-by': 'value',
    only: 'many', adopt: 'bool', 'dry-run': 'bool', field: 'many', parent: 'value', by: 'value',
  },
  sources: { source: 'value' },
  evidence: { ran: 'many', saw: 'many', line: 'many', file: 'value', slot: 'value', by: 'value' },
  retract: { by: 'value' }, field: { add: 'bool', remove: 'bool', clear: 'bool', by: 'value' }, split: { line: 'many', by: 'value' }, base: { by: 'value' },
  list: { status: 'value', kind: 'value', tag: 'value', prio: 'value', grep: 'value', match: 'many', all: 'bool' },
  show: { full: 'bool', 'at-lease': 'bool' }, brief: { role: 'value', slice: 'value' }, set: { branch: 'value', worker: 'value', model: 'value', worktree: 'value', handover: 'bool', header: 'bool', by: 'value' },
  next: { limit: 'value', all: 'bool', as: 'value', slice: 'value' },
  review: { by: 'value', model: 'value', relayed: 'bool', bot: 'bool', outside: 'many', field: 'many', artifact: 'value' }, round: { 'finding-count': 'value', findings: 'value', by: 'value' }, tick: { by: 'value' },
  models: { group: 'value', with: 'many', archives: 'bool' },
  scope: { branch: 'value', base: 'value', repo: 'value' },
  branches: { base: 'value', repo: 'value', 'stale-hours': 'value' },
  merged: { sha: 'value', ci: 'value', repo: 'value', ran: 'many', saw: 'many', red: 'value', keep: 'bool', by: 'value' },
  ask: { kind: 'value', target: 'value', issue: 'value', slice: 'value', option: 'many', 'applies-to': 'value', until: 'value', to: 'value', by: 'value' },
  answer: { by: 'value', option: 'value' },
  resume: { log: 'value', ready: 'value', gh: 'bool', repo: 'value', base: 'value', as: 'value', slice: 'value' },
  handoff: { summary: 'value', next: 'many', log: 'value', ready: 'value', gh: 'bool' },
  log: { by: 'value' }, decide: { settles: 'many', 'waives-review': 'many', by: 'value', quote: 'value', under: 'value', supersedes: 'many', 'applies-to': 'value', until: 'value', area: 'value', reach: 'value', rule: 'value' }, decisions: { live: 'bool', as: 'value' },
  goal: { set: 'value', by: 'value' },
  status: { 'stale-hours': 'value', group: 'value', tag: 'value', as: 'value', slice: 'value' }, archive: { by: 'value' }, report: { found: 'bool', metrics: 'bool' }, mode: { by: 'value' },
  changelog: { repo: 'value' },
  close: { force: 'bool', batch: 'bool', by: 'value' }, profile: {}, extend: { values: 'value', default: 'value', required: 'bool', by: 'value' }, verify: {}, use: {},
};

// The commands the command line runs and the tool list leaves out: no tool, and no block in the usage text.
export const INTERNAL_COMMANDS = Object.freeze(['handoff']);
export const flagsOf = (cmd) => ({ ...(COMMAND_FLAGS[cmd] || {}) });
// A flag one command does not take because its meaning is another flag's, or another command's: the refusal ends with the
// form of the call that does what was asked. --by names the author of a write and nothing else.
const RENAMED_FLAGS = {
  status: { by: { to: '--group', why: 'status groups its counts with --group, and --by names the author of a write' } },
  models: { by: { to: '--group', why: 'models groups its counts with --group, and --by names the author of a write' } },
  resume: { ci: { to: '--gh', why: 'resume asks gh for the CI of the tips with --gh; --ci is the CI state merged records' } },
  handoff: { ci: { to: '--gh', why: 'resume asks gh for the CI of the tips with --gh; --ci is the CI state merged records' } },
};
// The forms of the commands that take a removed form's place: a row or a note is taken back by retract, a verdict too.
const RETRACT_FORM = ['jarl.mjs', 'retract', hole('<id>'), hole('<n-or-note-n>'), hole('<why>'), '--by', hole('<who>')];
const RETRACT_REVIEW_FORM = ['jarl.mjs', 'retract', hole('<id>'), 'review', hole('<why>'), '--by', hole('<who>')];
// The form of field writing one part: its value the placeholder of the part, or --clear; --by where the call named one.
const fieldForm = (part, { clear = false, by = false, add = false, remove = false } = {}) => ['jarl.mjs', 'field', hole('<ids>'), part, ...(clear ? ['--clear'] : [hole(PART_HOLES[String(part).trim().toLowerCase()] ?? '<value>')]), ...(add ? ['--add'] : []), ...(remove ? ['--remove'] : []), ...(by ? ['--by', hole('<who>')] : [])];
// The flags whose name the surface does not have, each with what replaces it: a flag of the same command, or a call.
export const REMOVED_FLAGS = Object.freeze({ ...Object.fromEntries(Object.entries(RENAMED_FLAGS).map(([c, f]) => [c, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.to]))])), evidence: { retract: 'retract' } });
// The names a command's free text had in the tools, where it is now text: a flag or a tool field of that name is the text,
// and the refusal's form has the text's placeholder where the text goes.
export const GONE_TEXT_NAMES = Object.freeze({ set: 'why', review: 'findings', round: 'what', ask: 'question', answer: 'answer', log: 'event', decide: 'ruling', retract: 'reason' });
// The forms of a call the surface does not have because another command does what they ask, each with that command: a
// field's name where set takes a status (field writes it), a line given to log that reads as a line another command writes
// with its checks, a retraction asked of evidence or of review, a handoff action resume answers, a close that only the
// owner may let go on (the question put to him) or that archive does without losing work, and a loop made permanent in
// place where only init makes one. A refusal of such a call ends with the form of that command; a refusal of any other call
// ends with the form of the call itself, or with a step to take first.
export const REMOVED_FORMS = Object.freeze({
  set: ['field'],
  close: ['ask', 'archive'],
  mode: ['init'],
  log: ['new', 'set', 'round', 'review', 'retract', 'evidence', 'merged', 'field', 'tick'],
  evidence: ['retract'],
  review: ['retract'],
  handoff: ['resume'],
});
// A word that starts with -- and holds a space is no flag: a flag's name holds none, so it is a text given where a text
// goes, without the bare -- before it.
const textNotFlag = (a) => a.startsWith('--') && a.length > 2 && /\s/.test(a.indexOf('=') === -1 ? a.slice(2) : a.slice(2, a.indexOf('=')));
// The argument a flag of a command names when the command takes it as an argument: its own name (--title on new, --status
// on set), or text, or the name the text had (GONE_TEXT_NAMES), for the command's free text, its last argument. -1 when it
// names none.
const FREE_TEXT_ARGS = ['text', 'value', 'title', 'goal'];
const argumentNames = (cmd) => (COMMAND_ARGS[cmd] || []).map((a) => a.replace(/[?.]+$/, ''));
export function argumentOfFlag(cmd, name) {
  const names = argumentNames(cmd);
  const own = names.indexOf(name);
  if (own !== -1) return own;
  const last = names.length - 1;
  return (name === 'text' || GONE_TEXT_NAMES[cmd] === name) && FREE_TEXT_ARGS.includes(names[last]) ? last : -1;
}
// The placeholder where a flag the command does not take was given: the caller names the flag, or leaves it out.
const flagHole = () => hole('<a-flag-it-takes-or-none>');

// The name of a flag a word after a bare -- is, when it is one: a global flag (--root, --json) or a flag of the command,
// by its name alone or as --name=value. Such a word was written there by mistake (a flag goes before the --), and the
// refusal of the call reads it as the flag it names, so the form carries it where it goes; any other word is an argument.
export function flagAfterDashes(cmd, word) {
  const m = /^--([A-Za-z][\w-]*)(?:=|$)/.exec(String(word));
  return m && (Object.hasOwn(GLOBAL_FLAGS, m[1]) || Object.hasOwn(COMMAND_FLAGS[cmd] || {}, m[1])) ? m[1] : null;
}
// A call as the refusal of it sees it: the command, its flags in the order given ([name, value], true for a switch) and
// its arguments. Read from the words of the command line leniently, so a call the parser refused is read as well; a flag
// written after a bare -- is read as that flag (flagAfterDashes).
export function callOfArgv(argv) {
  const call = { cmd: undefined, flags: [], args: [] };
  let rest = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i]);
    if (!rest && a === '--') { rest = true; continue; }
    const word = rest ? call.cmd === undefined || flagAfterDashes(call.cmd, a) === null : !a.startsWith('--') || a.length === 2 || textNotFlag(a);
    if (word) { if (call.cmd === undefined) call.cmd = a; else call.args.push(a); continue; }
    const eq = a.indexOf('=');
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    const shape = { ...GLOBAL_FLAGS, ...(COMMAND_FLAGS[call.cmd] || {}) }[name];
    // An unknown flag before the command takes no word: the word after it is the command.
    if (eq !== -1) call.flags.push([name, a.slice(eq + 1), '=']);
    else if (shape === 'bool' || (shape === undefined && (call.cmd === undefined || i + 1 >= argv.length || String(argv[i + 1]).startsWith('-')))) call.flags.push([name, true]);
    else if (NAME_FLAGS.has(name) && i + 1 < argv.length && isFlagWord(argv[i + 1])) call.flags.push([name, undefined]);
    else { call.flags.push([name, argv[i + 1] === undefined ? undefined : String(argv[i + 1])]); i += 1; }
  }
  return call;
}
// A call that dispatch holds: the command, its flags and its arguments, as the refusal of it sees them. A flag given as
// --name=value is marked so ('='), and printed so.
function callOf(cmd, rest, flags) {
  const out = [];
  const inline = flags[INLINE] || new Set();
  for (const [k, v] of Object.entries(flags)) {
    if (k === 'caller' || v === undefined || v === false) continue;
    if (v === true) out.push([k, true]); else for (const x of [].concat(v)) out.push([k, String(x), ...(inline.has(k) ? ['='] : [])]);
  }
  return { cmd, flags: out, args: rest.map((x) => (x === undefined ? '' : String(x))) };
}
// The shape of the call a refusal's ready part asks for: the call with its parts put in, taken out, renamed or moved. Its
// values are the caller's, and formOf prints none of them but the placeholders a part puts in.
function shapeOf(call, fixes) {
  const c = { cmd: call.cmd, flags: call.flags.map((f) => [...f]), args: [...call.args] };
  for (const f of [].concat(fixes)) {
    // A word replaced stands where the call gave it, and in a form every value is its placeholder already.
    if (f.retry || f.dashes || f.replace !== undefined || f.first !== undefined) continue;
    if (f.command !== undefined) { c.cmd = String(f.command); continue; }
    // Words beyond what the command reads: the free text they may be written in one with, or a placeholder after them.
    if (f.truncate !== undefined) { c.args = c.args.slice(0, Math.max(0, f.truncate - 1)); if (f.value !== undefined) { if (f.text && c.args.length) c.args[c.args.length - 1] = String(f.value); else c.args.push(String(f.value)); } continue; }
    if (f.rename !== undefined) { const to = f.to.startsWith('<') ? String(f.to) : f.to.replace(/^--/, ''); c.flags = c.flags.map(([k, v, ...s]) => (k === f.rename.replace(/^--/, '') ? [to, v, ...(to.startsWith('<') ? [] : s)] : [k, v, ...s])); continue; }
    // The value of a flag that names an argument goes where that argument goes, when the arguments given leave its place
    // free; else the flag's name becomes a placeholder.
    if (f.toArg !== undefined) {
      const name = f.toArg.replace(/^--/, '');
      const at = c.flags.findIndex(([k]) => k === name);
      if (at === -1) continue;
      const value = c.flags[at][1];
      const arity = (COMMAND_ARGS[c.cmd] || []).length;
      if (typeof value === 'string' && c.flags.filter(([k]) => k === name).length === 1 && c.args.length >= f.at && c.args.length < arity) { c.flags.splice(at, 1); c.args.splice(f.at, 0, value); } else c.flags[at] = [flagHole(c.cmd), value];
      continue;
    }
    if (f.drop !== undefined) {
      const name = f.drop.replace(/^--/, '');
      const at = f.value === undefined ? -1 : c.flags.findLastIndex(([k, v]) => k === name && (f.value === null ? v === undefined : v === String(f.value)));
      c.flags = f.value === undefined ? c.flags.filter(([k]) => k !== name) : c.flags.filter((_, i) => i !== at);
      continue;
    }
    if (f.flag !== undefined) {
      const name = f.flag.replace(/^--/, '');
      const value = f.value === undefined ? true : String(f.value);
      const empty = c.flags.findIndex(([k, v]) => k === name && v === undefined);
      const at = empty !== -1 && !f.add ? empty : c.flags.findIndex(([k]) => k === name);
      if (at === -1 || f.add) c.flags.push([name, value]); else c.flags[at] = [name, value];
      continue;
    }
    if (f.arg !== undefined) { while (c.args.length < f.arg) c.args.push(hole('<argument>')); c.args[f.arg] = String(f.value); }
  }
  return c;
}
// The placeholder of each argument and of each flag's value in a form, by command and name, else by name, else <value>;
// and of the value field writes, by the part it writes.
const ARG_HOLES = {
  ids: '<ids>', id: '<id>', title: '<title>', goal: '<goal>', files: '<findings.json>', 'import file': '<findings.json>', 'profile file': '<profile.json>',
  'retract entry': '<review-n-or-note-n>', 'retract text': '<why>', 'field name': '<part>', 'base name': '<name>', 'base branch': '<branch>',
  'set status': '<status>', 'set text': '<why>', 'review verdict': '<verdict>', 'review text': '<what-was-read-and-found>', 'round text': '<what-failed>',
  'tick line': '<line-number>', 'answer id': '<question>', 'decide slug': '<slug>', 'decide text': '<a-ruling>', 'decisions as': '<role>', 'archive slug': '<slug>', 'mode mode': '<mode>',
  'extend part': '<section-or-field>', 'extend name': '<name>',
  text: '<text>',
};
const FLAG_HOLES = {
  by: '<who>', kind: '<kind>', 'ask kind': '<ask-kind>', prio: '<prio>', tier: '<tier>', tags: '<tag>', tag: '<tag>', files: '<paths>', repo: '<name-or-path>',
  'found-by': '<who>', where: '<text>', what: '<text>', why: '<text>', acceptance: '<line>', source: '<report-dir#finding-id>', 'sources source': '<report-dir>',
  'import source': '<report-dir>', after: '<ids-it-waits-on>', changelog: '<changelog-entry>', template: '<template>', field: '<name=value>', section: '<name=value>',
  person: '<name>', 'check-when': '<date-or-event>', profile: '<profile.json>', key: '<key>', only: '<finding-ids>', ran: '<command>', saw: '<what-it-printed>',
  file: '<path>', slot: '<slot>', status: '<status>', grep: '<text>', match: '<field=value>', branch: '<worker-branch>', worker: '<the-new-worker>',
  model: '<model-id>', worktree: '<the-worktree-of-the-lease>', limit: '<whole-number>', as: '<who>', slice: '<coordinator>', 'finding-count': '<count>', findings: '<count>', role: '<role>',
  group: '<group>', with: '<loop-root>', base: '<base-branch>', 'stale-hours': '<hours>', sha: '<sha>', ci: '<ci-state>', red: '<another-issue>',
  target: '<what-would-get-weaker>', issue: '<id>', option: '<option>', 'ask option': '<label:effect>', 'applies-to': '<selectors>', until: '<date-or-id>', to: '<jarl-or-owner>', log: '<count>',
  ready: '<count>', summary: '<text>', next: '<text>', settles: '<ids>', 'waives-review': '<ids>', quote: '<his-own-words>', under: '<a-ruling-in-force>', supersedes: '<a-ruling-in-force>',
  rule: '<rule-id>', area: '<type>', reach: '<number-of-files>', set: '<machine-line>', line: '<line=id>', 'evidence line': '<line-number>', outside: '<finding-outside-the-issue>', parent: '<id>', range: '<name>', values: '<items>', default: '<value>',
};
const PART_HOLES = {
  title: '<title>', priority: '<prio>', tier: '<tier>', kind: '<kind>', tags: '<tag>', files: '<paths>', repo: '<name-or-path>', after: '<ids-it-waits-on>', parent: '<id>',
  source: '<report-dir#finding-id>', acceptance: '<line>', changelog: '<changelog-entry>', person: '<name>', 'check when': '<date-or-event>',
  resources: '<resource-name>', 'found by': '<who>', where: '<text>', what: '<text>', why: '<text>',
};
const argHole = (c, i) => {
  const name = argumentNames(c.cmd)[i];
  if (c.cmd === 'field' && name === 'value') return hole(PART_HOLES[String(c.args[1] ?? '').trim().toLowerCase()] ?? '<value>');
  return hole(ARG_HOLES[`${c.cmd} ${name}`] ?? ARG_HOLES[name] ?? '<value>');
};
const valueHole = (cmd, k) => hole(FLAG_HOLES[`${cmd} ${k}`] ?? FLAG_HOLES[k] ?? '<value>');
// The global flags of a call a printed command carries (see printCommand in lib/base.mjs). A refusal's forms and steps
// carry its --root and its --json: they are the call itself, filled. Every other command the call prints (in a reason,
// a note, a hint or a row of a view) carries its --root, so it reaches the loop the call named; the --json says how that
// call prints, and another command prints as its own caller asks.
export const callGlobals = (call) => (call?.flags || []).filter(([k]) => k === 'root' || k === 'json');
const rootOfCall = (call) => callGlobals(call).filter(([k]) => k === 'root');
// The flags a call of a command needs beside the ones it gives, so that its form, filled, is a call the command takes and
// not one refused for a part the form left out: the flag each command requires (the writer of a write, the key of a
// renumbering, the sha of a merge that moves no CI state alone), and the flags one given goes with (a row's --ran and
// --saw, an attachment's --file and --slot, a wait's --person and --check-when with its --kind, the kind a question's
// --target, --slice or rule scope belongs to, the scope a rule's --until and --to end and hold, the area a ruling's
// --reach counts and its --rule is on). A flag named here as needed is refused when it is missing, by the command itself.
export const GOES_WITH = Object.freeze({
  evidence: { ran: ['saw'], saw: ['ran'], file: ['slot'], slot: ['file'] },
  merged: { ran: ['saw'], saw: ['ran'] },
  new: { person: ['check-when', 'kind'], 'check-when': ['person', 'kind'] },
  ask: { target: ['kind'], slice: ['kind'], 'applies-to': ['kind'], until: ['applies-to', 'kind'], to: ['applies-to', 'kind'] },
  decide: { reach: ['area'], rule: ['area'], until: ['applies-to'] },
  set: { worker: ['model'] },
});
// What a form of `cmd` holds when its call gives the flags named in `given`: the flags it needs (above), how many
// arguments at least, the optional last one included where no flag of the call stands in for it (the value field writes,
// but with --clear; the words of an answer, but with --option; a note, but with a row or a file), and how many at most,
// that last one left out where such a flag stands in for it, the command taking one or the other and never both.
export function formNeeds(cmd, given) {
  const has = (k) => given.has(k);
  const flags = [...(Object.hasOwn(AUTHOR_REQUIRED, cmd) || (cmd === 'goal' && has('set')) ? ['by'] : []), ...(cmd === 'renumber' ? ['key'] : []), ...(cmd === 'merged' && !has('ci') ? ['sha'] : []), ...(cmd === 'review' && !has('bot') ? ['model'] : [])];
  for (let grew = true; grew;) {
    grew = false;
    for (const k of [...given, ...flags]) for (const w of GOES_WITH[cmd]?.[k] || []) if (!flags.includes(w)) { flags.push(w); grew = true; }
  }
  const valued = { field: !has('clear'), answer: !has('option'), evidence: !['ran', 'saw', 'file', 'slot'].some(has) }[cmd];
  const required = (COMMAND_ARGS[cmd] || []).filter((a) => !/[?.]$/.test(a)).length;
  const all = argumentNames(cmd).length;
  return { flags: flags.filter((k) => !given.has(k)), args: valued ? all : required, most: valued === false ? all - 1 : all };
}
// The form of a call: jarl.mjs, its command, the placeholder of each argument it takes (the ones it needs, and the ones
// the call gave), each flag of the call with the placeholder of its value (a switch as it is, one flag of a name, but a
// row's --ran and --saw as one pair for each row the call gave), and each flag it needs beside them (formNeeds); its
// global flags are carried by printCommand. A placeholder the shape put in stands where it goes; no other value of the
// call is printed, but the name of the part field writes. With dashes, the arguments come after a bare --.
function formOf(c, dashes) {
  if (!Object.hasOwn(COMMAND_FLAGS, c.cmd)) return ['jarl.mjs', hole('<a-jarl-command>')];
  const names = argumentNames(c.cmd);
  const rows = c.cmd === 'evidence' || c.cmd === 'merged' ? Math.max(...['ran', 'saw'].map((r) => c.flags.filter(([k]) => k === r).length)) : 0;
  const needs = formNeeds(c.cmd, new Set([...c.flags.map(([k]) => k), ...(rows ? ['ran', 'saw'] : [])]));
  // A take-back of the owner's tick (the entry reads tick-...) has its own form: the entry is tick-<n>, the author the owner.
  const tick = c.cmd === 'retract' && /^tick-/.test(String(c.args[1] ?? ''));
  const args = [];
  for (let i = 0; i < Math.min(needs.most, Math.max(needs.args, Math.min(c.args.length, names.length))); i += 1) {
    const v = c.args[i];
    if (tick && i === 1) { args.push(hole('<tick-n>')); continue; }
    // A placeholder the shape put in stands, but the generic one, where the argument has its own.
    if (isPlaceholder(v) && v.trim() !== '<value>') args.push(v.trim());
    else if (c.cmd === 'field' && i === 1 && typeof v === 'string' && v.trim()) args.push(v.trim());
    else args.push(argHole(c, i));
  }
  const flags = [];
  const seen = new Set();
  for (const [k, v] of c.flags) {
    // One flag of a name, but one more of a flag that repeats where the shape put in a placeholder of its own for it.
    const key = typeof v === 'string' && isPlaceholder(v) && v.trim() !== '<value>' && flagsOf(c.cmd)[k] === 'many' ? `${k} ${v.trim()}` : k;
    if (seen.has(key) || Object.hasOwn(GLOBAL_FLAGS, k)) continue;
    seen.add(key);
    // A flag that goes away is left out; a flag the caller is to name keeps a place for its value.
    if (k === '<no-flag-here>') continue;
    else if (rows && (k === 'ran' || k === 'saw')) { if (!seen.has('rows')) for (let n = 0; n < rows; n += 1) flags.push('--ran', valueHole(c.cmd, 'ran'), '--saw', valueHole(c.cmd, 'saw')); seen.add('rows'); }
    else if (k.startsWith('<')) flags.push(k, ...(typeof v === 'string' ? [hole('<value>')] : []));
    else if (v === true || flagsOf(c.cmd)[k] === 'bool') flags.push(`--${k}`);
    else flags.push(`--${k}`, isPlaceholder(v) && v.trim() !== '<value>' ? v.trim() : tick && k === 'by' ? hole('<the-owner-himself>') : valueHole(c.cmd, k));
  }
  // Each flag the form needs that the call did not give, with the placeholder of its value.
  flags.push(...needs.flags.flatMap((k) => [`--${k}`, tick && k === 'by' ? hole('<the-owner-himself>') : valueHole(c.cmd, k)]));
  return dashes ? ['jarl.mjs', c.cmd, ...flags, '--', ...args] : ['jarl.mjs', c.cmd, ...args, ...flags];
}
// The one way a refusal reaches whoever made the call: its reason, then its ready part, the last line (see lib/base.mjs,
// "refusals"). A shape of the call is printed as the call's form, after the view it names first on a line of its own; a
// command is printed alone, never joined to the call; a command of the tool that runs the loop ({ external }) as it is.
// Every command printed is built by printCommand (lib/base.mjs): it carries the global flags of the call as they were
// given, wherever the call wrote them, so a form filled where the call was made reaches the loop the call named, and is
// written for the shell of the platform it is printed on (shellOf): a POSIX shell on macOS and Linux, PowerShell and cmd
// on Windows; `platform` names another one where a test asks for it. A word of a form that shell cannot carry as it is
// (printable) is printed as its placeholder, and the reason says why. A form that writes and holds no placeholder gets
// one, so pasted as printed it is refused and writes nothing.
export function refusalFor(e, call, platform = process.platform) {
  if (!(e instanceof Refusal)) return e;
  const shell = shellOf(platform);
  if (isExternal(e.ready)) return new Error(`${e.reason}\n${commandLine(e.ready, shell)}`);
  if (!call) return new Error(`${e.reason}\n${readyText(e.ready, shell)}`);
  const fixes = [].concat(e.ready).filter(isFix);
  const shaped = fixes.length ? shapeOf(call, fixes) : call;
  const lines = fixes.length
    ? [...fixes.filter((f) => f.first !== undefined).map((f) => commandOf(f.first)), formOf(shaped, fixes.some((f) => f.dashes))]
    : [commandOf(e.ready)];
  let unprintable = false;
  // A form of a write holds its writer, so pasted and filled it is a call the command takes.
  const signed = lines.map((words) => signedWords(words));
  const printed = signed.map((words) => words.map((w) => (printable(w, shell) ? w : ((unprintable = true), hole('<value>')))))
    .map((words) => (writes(words) && !words.some((w) => HOLE.test(String(w))) ? [...words, hole('<as-the-reason-says>')] : words));
  // The globals of the call as the shape left them: a shape may name the loop root the form is for.
  const globals = callGlobals(shaped);
  return new Error(`${reasonFor(e.reason, call, shell, unprintable)}\n${printed.map((words) => printCommand(words, { globals, shell })).join('\n')}`);
}
// The reason as printed: every word of the call it echoes with its line breaks escaped, so no word of the caller starts
// a line (but the global flags, which it prints only inside the commands printCommand built); and where the call's
// --root, or another word of the form, is one the shell of the form cannot carry, why the form names it by its
// placeholder.
function reasonFor(reason, call, shell = 'posix', unprintable = false) {
  const rootFlag = call.flags.find(([k]) => k === 'root');
  const root = rootFlag?.[1];
  const words = [call.cmd, ...call.args, ...call.flags.filter(([k]) => !Object.hasOwn(GLOBAL_FLAGS, k)).flatMap(([k, v]) => [k, `--${k}`, v])].filter((w) => typeof w === 'string');
  const rootNote = typeof root !== 'string' || isPlaceholder(root) || rootPrintable(root, shell, rootFlag[2]) ? ''
    : breaksLine(root) ? ' (the --root given holds a line break, which no printed line carries: the form names the loop root by its placeholder)'
      : ' (the --root given holds a character that cmd and PowerShell read apart, or ends with a backslash a program reads as an escape: the form names the loop root by its placeholder)';
  const wordNote = unprintable ? ' (a word of the form holds a character that cmd and PowerShell read apart: the form names it by its placeholder)' : '';
  return `${escapedEchoes(reason, words)}${rootNote}${wordNote}`;
}

// The names of the flags a call gave as --name=value, held on its parsed flags out of sight of every reader of them.
const INLINE = Symbol('flags given as --name=value');
// A call read is read for its own globals: a command a reason prints while the call is read carries them.
export function parseArgs(argv) {
  const call = callOfArgv(argv);
  try { return printingFor(rootOfCall(call), () => { needNoPlaceholderWord(argv); return parseWords(argv); }); } catch (e) { throw refusalFor(e, call); }
}
// A word of the call that is one of the tool's placeholders, wherever it stands (the command, an argument, a flag's place,
// a flag's value, the value of --name=value, a global flag's value such as --root's), is refused before the call is read,
// so a form pasted as printed, unfilled, writes nothing and opens no loop.
function needNoPlaceholderWord(argv) {
  const holes = argv.map(String).map((a) => (a.startsWith('--') && a.includes('=') ? a.slice(a.indexOf('=') + 1) : a)).filter(isPlaceholder);
  need(holes.length === 0, `${[...new Set(holes)].map(shellWord).join(', ')} ${new Set(holes).size === 1 ? 'is a placeholder' : 'are placeholders'} of a form Jarl printed — write the value in its place; nothing was written`, { retry: true });
}
function parseWords(argv) {
  const positional = [];
  const flags = {};
  const inlineNames = new Set();
  let cmd;
  let rest = false;
  let dashAt = -1;
  const table = () => ({ ...GLOBAL_FLAGS, ...flagsOf(cmd) });
  const named = (t) => Object.keys(t).map((k) => `--${k}`).join(', ');
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (rest || !a.startsWith('--') || a.length === 2) {
      if (a === '--' && !rest) { rest = true; dashAt = positional.length; continue; }
      positional.push(a);
      if (cmd === undefined) {
        cmd = a;
        if (Object.hasOwn(REPLACED_COMMANDS, cmd)) replacedRefusal(cmd, argv.slice(i + 1));
        need(COMMAND_FLAGS[cmd], `unknown command: ${cmd} — the commands are ${Object.keys(COMMAND_FLAGS).filter((c) => !INTERNAL_COMMANDS.includes(c)).join(', ')}`, () => ({ command: hole('<a-jarl-command>') }));
      }
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    const inline = eq === -1 ? undefined : a.slice(eq + 1);
    const t = table();
    const kind = Object.hasOwn(t, name) ? t[name] : undefined;
    if (kind === undefined) {
      const renamed = cmd !== undefined && RENAMED_FLAGS[cmd]?.[name];
      if (renamed) refuse(renamed.why, { rename: `--${name}`, to: renamed.to });
      if (cmd === 'evidence' && name === 'retract') refuse('evidence takes nothing back with --retract: a row or a note is taken back with retract', RETRACT_FORM);
      if (cmd === undefined) refuse(`unknown flag ${a} before the command — only ${named(GLOBAL_FLAGS)} may come before it`, { drop: `--${name}` });
      if (textNotFlag(a)) refuse(`${JSON.stringify(a)} is a text, not a flag: a text that starts with -- goes after a bare --, with every flag before it`, { dashes: true });
      // A flag named as an argument of the command (its own name, text, or the name its text had) is that argument.
      const at = argumentOfFlag(cmd, name);
      if (at !== -1) refuse(`${cmd} takes its ${COMMAND_ARGS[cmd][at].replace(/[?.]+$/, '')} as argument ${at + 1}, not as --${name}`, { toArg: `--${name}`, at });
      refuse(`unknown flag ${a} for ${cmd} — it takes ${named(flagsOf(cmd))}; a text that starts with -- goes after a bare --`, { rename: `--${name}`, to: flagHole(cmd) });
    }
    if (kind === 'bool') {
      need(inline === undefined, `--${name} takes no value: it is given, or left out (got ${JSON.stringify(a)})`, () => (name === 'json' ? { flag: '--json' } : name === 'help' ? { drop: '--help' } : { rename: `--${name}`, to: hole('<no-flag-here>') }));
      flags[name] = true;
      continue;
    }
    let value = inline;
    if (value === undefined) {
      // A flag given once already loses the word with no value; else the word gets one.
      const before = flags[name] !== undefined && kind !== 'many';
      need(i + 1 < argv.length && !(NAME_FLAGS.has(name) && isFlagWord(argv[i + 1])), `--${name} needs a value${before ? ` (it is given ${JSON.stringify(flags[name])} before, and takes one value)` : ''}`, () => (before ? [{ drop: `--${name}`, value: null }, { flag: `--${name}`, value: hole('<value>') }] : { flag: `--${name}`, value: hole('<value>') }));
      value = argv[i + 1];
      i += 1;
    } else inlineNames.add(name);
    if (kind === 'many') flags[name] = flags[name] === undefined ? value : [].concat(flags[name], value);
    else {
      // The same value twice is one; two values leave which one was meant open.
      need(flags[name] === undefined, `--${name} given twice (${JSON.stringify(flags[name])} and ${JSON.stringify(value)}) — it takes one value`, () => ([{ drop: `--${name}`, value }, { flag: `--${name}`, value: hole('<value>') }]));
      flags[name] = value;
    }
  }
  // Words beyond what the command reads are an error, not dropped: after a bare -- that is also where a
  // --root written last would land, and a call that silently lost its --root would write to another loop.
  if (cmd !== undefined && Object.hasOwn(ARITY, cmd)) {
    const extra = positional.slice(1 + ARITY[cmd]);
    // A flag written after the bare -- (with the value it takes there) is a flag in the wrong place, never a word of a text:
    // the reason says it goes before the --, and the form, which reads it as that flag, puts it there.
    const flagsMoved = [];
    const plain = [];
    for (let at = 0; at < positional.length; at += 1) {
      const w = positional[at];
      const name = dashAt !== -1 && at >= Math.max(dashAt, 1) ? flagAfterDashes(cmd, w) : null;
      if (name === null) { plain.push(w); continue; }
      flagsMoved.push(w);
      // Its value is the word after it, as the flag would take it before the --.
      if (table()[name] !== 'bool' && !w.includes('=')) at += 1;
    }
    const left = plain.slice(1 + ARITY[cmd]);
    const text = FREE_TEXT_ARGS.includes(argumentNames(cmd).at(-1));
    const words = text ? plain.slice(ARITY[cmd]) : left;
    const movedNames = [...new Set(flagsMoved.map((x) => x.split('=')[0]))];
    const where = movedNames.length ? `; ${movedNames.map((x) => JSON.stringify(x)).join(' and ')} ${movedNames.length === 1 ? 'is a flag, which goes' : 'are flags, which go'} before the bare --` : rest ? ' (everything after a bare -- is an argument, so flags such as --root go before it)' : '';
    need(extra.length === 0, `${cmd} takes at most ${ARITY[cmd]} argument${ARITY[cmd] === 1 ? '' : 's'} — unexpected: ${extra.map((x) => JSON.stringify(x)).join(' ')}${where}${left.length ? `; several ids are one argument: 12,13 or 203-206${text ? `; the words ${words.map((x) => JSON.stringify(x)).join(' ')} are one ${argumentNames(cmd).at(-1)} only when quoted as one word` : ''}` : ''}`,
      () => [{ truncate: 1 + ARITY[cmd], text, ...(left.length ? { value: text ? hole('<one-quoted-text>') : hole('<no-word-here>') } : {}) }, ...(rest ? [{ dashes: true }] : [])]);
  }
  // The flags given as --name=value, so a line printed for the call writes them as they were given.
  Object.defineProperty(flags, INLINE, { value: inlineNames });
  return { positional, flags };
}
// The arguments each command reads after its name, in order, named: the MCP server (jarl-mcp.mjs) turns each
// name into a field of that command's tool, so this table and COMMAND_FLAGS are the one source of both the
// CLI and the tools. A name ending in ? may be left out; one ending in ... takes any number of words (tag's
// +a -b, sources' findings files) and has no upper bound. A command's arity is how many names it has.
export const COMMAND_ARGS = {
  init: ['goal'], new: ['title'], renumber: ['id'], import: ['file'], sources: ['files...'],
  evidence: ['ids', 'text?'], retract: ['id', 'entry', 'text'], field: ['ids', 'name', 'value?'], split: ['id'], base: ['name', 'branch'],
  list: [], show: ['id'], brief: ['id?'], set: ['ids', 'status', 'text?'],
  merged: ['ids'],
  next: [], review: ['ids', 'verdict', 'text'], round: ['id', 'text'], tick: ['id', 'line'], models: [], scope: ['id?'], branches: [],
  ask: ['text'], answer: ['id', 'text?'], resume: [], handoff: ['action?'], log: ['text'],
  decide: ['slug', 'text'], decisions: [], goal: [], status: [], archive: ['slug'], report: [],
  changelog: ['ids'], mode: ['mode'], close: [], profile: ['file?'], extend: ['part', 'name'], verify: [], use: ['path?'],
};
// The commands that write: each runs under .jarl/.lock (see withLock).
export { MUTATING, writes };
// Whether a printed command (jarl.mjs, then its words) writes: a command of the set above, but goal, which writes only
// with --set and else reads the goal.

// The writes, each with what its --by names: every write names its writer, on the command line and in its tool, where the
// field is required. goal writes only with --set and is left out here: its call is refused without --by when it writes.
const WRITER_WORDS = {
  answer: 'who answered: owner for the owner, jarl on an escalation, or a name',
  decide: 'who ruled: jarl for a choice made under a mandate, owner with quote, or a coordinator',
  review: 'who reviewed: a fresh reviewer\'s name, or jarl',
  retract: 'who takes the record back',
  tick: 'who ticks: owner, as only the owner ticks an owner line',
};
const ownWriter = (cmd) => WRITER_WORDS[cmd] ?? 'who makes this write: your own name';
export const AUTHOR_REQUIRED = Object.freeze(Object.fromEntries([...MUTATING].filter((c) => c !== 'goal').map((c) => [c, ownWriter(c)])));
// The writes that refuse a missing --by themselves, each with a form of its own: dispatch refuses the others.
const REFUSE_THEIR_OWN_BY = ['answer', 'decide', 'review', 'retract', 'tick'];
// A value an identity flag takes is one name: a word that starts with -- is the next flag, never a value.
const NAME_FLAGS = new Set(['by', 'worker', 'model', 'root']);
const isFlagWord = (word) => String(word).startsWith('--');
const NAME_FLAG_HOLES = { by: '<who>', worker: '<the-new-worker>', model: '<model-id>', root: '<loop-root>' };
// One sentence per command: what it does, the MCP tool's whole description after "WRITES the loop." or "Read-only.".
// The rest of what a command takes and does is its block of USAGE, which the jarl_help tool prints, and <command> --help prints
// one command's.
export const COMMAND_SUMMARY = {
  init: 'Open a loop: create .jarl/ with the goal, out of git by default, committed or permanent when asked.',
  new: 'File an issue under the next free number, with its fields and its What, Why and Acceptance; a promise (kind promise) or a wait on an outside person (kind wait, with person and check-when).',
  renumber: 'Give a free number to one of the issue files that carry one number after a merge, the one with the key named, keeping every line of the log written about it.',
  import: 'File one issue per finding of a findings file, skipping findings already filed and reporting those whose text changed; a finding with neither a claim nor a truth is not compared.',
  sources: 'Per findings report: its findings, the issues filed from them and their status.',
  evidence: 'Append a free-text note, or checkable rows of what ran and what it printed, to issues; or record a file as an attachment of a slot (--file, --slot).',
  retract: 'Take back the newest approve of an issue (entry: review), one evidence row by its number (entry: the number), one evidence note (entry: note-<n>) the owner\'s tick of an acceptance line (entry: tick-<n>), or the supersession of a ruling written by mistake (id: the ruling\'s slug, entry: supersession), by an entry that says who and why.',
  field: 'Change one part of the description of issues, a header field (Title, Priority, Tags, Files, After and the rest) or a section (What, Why, Acceptance, Changelog): a value replaces it, add and remove change the items of a list or add to a section, clear empties it; each change logs what the part held and who changed it when named.',
  split: 'Share out the acceptance lines of a parent among its sub-issues in one write: each line is moved to an issue, which becomes a sub-issue, or kept on the parent, and a line moved nowhere is refused.',
  base: 'Change the base branch a declared repository is held against, logging what it was.',
  list: 'List the issues, the unfinished ones by default, filtered by status, kind, tag, priority or a field.',
  show: 'Print one issue as the done gate sees it (its current window, rows numbered), or the whole file with --full.',
  brief: 'The complete text a worker, examiner or merger of a lease, or a slice\'s coordinator, is raised with, assembled from the record.',
  set: 'Change the status of issues, with the reason logged.',
  merged: 'Record a merge (sha, repository, the check that decided it, CI state) on issues and remove their finished worktree and branch when that is safe, or move the CI state of issues already merged.',
  next: 'The open issues ready to start: no file shared with work in progress, every After issue settled, no open question on them, never a promise or a wait; all adds the held and waiting ones in groups; as lists what is on the owner, the jarl or a named person (a promise on its maker, a wait on its person), each line with its command.',
  review: 'Record a reviewer\'s verdict (approve or changes) on issues, with the reviewer and the findings.',
  round: 'Record one red round on issues; every third (or the count the goal sets for the kind of issue) prints the takeover block for a fresh worker.',
  tick: 'Record the owner\'s tick of an acceptance line only he ticks, once he has reviewed the material it names.',
  models: 'Per model as worker and as reviewer, per kind of issue: the counts, clean first passes and verdicts the record holds, with the words fits, below, new and may clear; reads other loops and archives too.',
  scope: 'Measure the scope of a worker branch against its base: commits, diff inside the declared files, test changes; numbers, never a verdict.',
  branches: 'Every worker branch with its issues, commits beyond the base, worktree state, stale leases and done branches, in the loop\'s repository and every repository its issues name (repo narrows it to one).',
  ask: 'File a question the owner has to answer (stop, stuck, lower, charter or ratify).',
  answer: 'Record the answer to a question, the option chosen or the words given, as a ruling by whoever by names, and close the question; several ratify items take one answer.',
  resume: 'The boot: everything a session picks the loop up from, assembled live, the merge queue in its batches and the tips of every repository included (repo narrows those to one, gh asks gh for the tips\' CI); as ends it with what is on the one who asks.',
  handoff: 'read: resume, then the handoff file the loop holds, if any; write: writes nothing.',
  log: 'Append one dated note to the loop\'s journal; a line that reads as a move, a verdict or another line of state is refused.',
  decide: 'Append a ruling, optionally superseding one, settling issues or covering an area of code.',
  decisions: 'The rulings with who ruled and what superseded them.',
  goal: 'The goal as goal.md holds it, or one machine line of it set (Check, Model, Coordinators, Takeover or Liveness), with a log line that says what it was and what it is now.',
  status: 'The goal, the counts by status, the reviews, stale leases and what awaits ratification; as ends it with what is on the one who asks.',
  archive: 'Put the current loop away under .jarl/archive/ so a new one can open here.',
  report: 'What was done, dropped, deferred and still open, ready for the changelog, with the loop metrics first; set metrics for the metrics alone.',
  changelog: 'Print the issues\' changelog entries grouped by section, ready to paste under [Unreleased].',
  mode: 'Switch a committed loop to the permanent mode.',
  profile: 'The loop\'s profile (statuses, fields, sections), or a profile file checked against the schema.',
  extend: 'Add one section or one field to the profile of a live loop, checked as a profile file is, with a log line.',
  verify: 'Check the record strictly, without a lock: the lines each reader does not place, the headers that disagree with the log, the repositories, leases and superseded rulings the issues name; exit 2 on a finding.',
  close: 'Close the loop, filing the ratification batch first; it refuses while issues are open or in progress, or deferred where it removes the loop, unless force is set.',
  use: 'List the loops under this checkout, or name the loop the calls that follow reach: a tool session keeps it until use names another, and the command line prints the JARL_ROOT setting to export.',
};

// The help a call with no command prints: the start of the usage, one line for each command, what it does as far as its
// first sentence allows, and the section the usage ends with. The whole usage is the jarl_help tool's answer; one command's
// is <command> --help.
const SHORT_LINE = 110;
const firstSentence = (text) => { const s = text.split(/(?<=[.;])\s/)[0]; return s.length <= SHORT_LINE ? s : `${s.slice(0, s.lastIndexOf(' ', SHORT_LINE - 1))} …`; };
const USAGE_BLOCKS = (() => {
  const lines = USAGE.split('\n');
  const out = new Map();
  let current = null;
  for (const line of lines.slice(lines.indexOf('commands:') + 1)) {
    if (/^\S/.test(line)) break;
    const head = /^ {2}([a-z]+)\b/.exec(line);
    if (head && COMMAND_FLAGS[head[1]]) { current = out.get(head[1]) ?? []; out.set(head[1], current); }
    if (current && line.trim()) current.push(line);
  }
  return out;
})();
// What <command> --help prints: that command's own block of the usage, or null for a word that is no command of it.
export function commandUsage(cmd) {
  const block = USAGE_BLOCKS.get(cmd);
  if (!block) return null;
  const [synopsis, ...first] = block[0].trim().split(/\s{2,}/);
  return [`usage: jarl.mjs ${synopsis}`, ...first.map((l) => `  ${l}`), ...block.slice(1).map((l) => `  ${l.trim()}`)].join('\n');
}
export function shortUsage() {
  const names = [...USAGE_BLOCKS.keys()].filter((c) => COMMAND_SUMMARY[c] && !INTERNAL_COMMANDS.includes(c));
  const width = Math.max(...names.map((n) => n.length));
  const usageHead = USAGE.split('\n').slice(0, USAGE.split('\n').indexOf('commands:')).join('\n');
  const closing = USAGE.split('\n\n').pop();
  return [usageHead, 'commands (each with its own usage: <command> --help; the whole usage: the jarl_help tool):', ...names.map((n) => `  ${n.padEnd(width)}  ${firstSentence(COMMAND_SUMMARY[n])}`), '', closing].join('\n');
}
// The fields that hold a list, per command: an argument (named as in COMMAND_ARGS) or a flag, and what one item is.
// A name (an issue or question id, a tag, a finding's reference or id) never holds a bracket or a quote; a path (Files,
// Repo) may hold brackets that pair up, as file names do (src/[id]/page.tsx). tag's operations add names. The tools take
// each of these fields as one text or as a list of strings (jarl-mcp.mjs), and dispatch reads every one through
// listItems, so the command line and the tools follow one rule.
export const LIST_FIELDS = {
  new: { tags: 'name', files: 'path', repo: 'path', source: 'name', after: 'name' },
  import: { tags: 'name', repo: 'path', only: 'name' },
  decide: { settles: 'name', 'waives-review': 'name', supersedes: 'name' },
  round: { id: 'name' }, answer: { id: 'name' },
  evidence: { ids: 'name', line: 'name' }, field: { ids: 'name' }, set: { ids: 'name' }, merged: { ids: 'name' },
  review: { ids: 'name' }, changelog: { ids: 'name' },
};
const QUOTED = /^["'`]|["'`]$/;
// Whether one item of a list is a piece of a list written out as text: it begins or ends with a quote mark, or, for a
// name, holds a bracket or a quote at all; for a path, its brackets do not pair up (what a comma inside "[a, b]"
// leaves), or it is an empty or quoted list in brackets ("[]", "["a"]"). A path in brackets with nothing else to
// tell it from a name ([1], [...slug]) is a name.
function piecesOfListText(item, kind) {
  if (QUOTED.test(item)) return true;
  if (kind === 'name') return /[[\]"'`]/.test(item);
  let depth = 0;
  for (const c of item) {
    if (c === '[') depth += 1;
    else if (c === ']' && --depth < 0) return true;
  }
  if (depth !== 0) return true;
  const inner = /^\[(.*)\]$/.exec(item)?.[1].trim();
  return inner !== undefined && (inner === '' || QUOTED.test(inner));
}
// The one rule of a list field: the items of one text written as a comma list, or of a list of such texts, each
// trimmed, the empty ones dropped. An item that starts with - is a flag in the wrong place (after a bare -- it is
// where a --root written last lands), and a piece of a list written as text would store its brackets and quotes:
// both are refused, naming the field.
export function listItems(value, kind, field) {
  const text = [].concat(value ?? []).map(String).join(',');
  const items = text.split(',').map((s) => s.trim()).filter(Boolean);
  const dashed = items.filter((s) => s.startsWith('-'));
  need(dashed.length === 0, `${field}: an item cannot start with - — got ${dashed.map((s) => JSON.stringify(s)).join(' ')} (everything after a bare -- is an argument, so flags such as --root go before it)`, () => ({ replace: dashed[0], value: hole('<an-item-with-no-leading-dash>') }));
  const holes = items.filter(isPlaceholder);
  need(holes.length === 0, `${field}: ${holes.map(shellWord).join(', ')} ${holes.length === 1 ? 'is a placeholder' : 'are placeholders'} — write the value in its place; nothing was written`, { retry: true });
  need(!items.some((s) => piecesOfListText(s, kind)), `${field} takes its items one by one: one item, a comma list (a,b) or a list of strings; ${kind === 'name' ? 'a list written as text, an item in quotes or a name holding a bracket or a quote mark' : 'a list written as text or an item in quotes'} is refused — got ${JSON.stringify(text)}`, () => { const bad = items.find((s) => piecesOfListText(s, kind)); return { replace: bad, value: hole('<an-item-without-quotes>') }; });
  return items;
}
// A command's arguments and flags with every list field read by listItems and written back as the one comma list the
// commands read: a list argument that is last takes every word left, and a list flag repeats.
function readLists(cmd, rest, flags) {
  const fields = LIST_FIELDS[cmd];
  if (!fields) return { rest, flags };
  const out = { rest: [...rest], flags: { ...flags } };
  COMMAND_ARGS[cmd].forEach((a, at) => {
    const field = a.replace(/[?.]+$/, '');
    const kind = fields[field];
    if (kind === undefined) return;
    const given = a.endsWith('...') ? (rest.length > at ? rest.slice(at) : undefined) : rest[at];
    if (given === undefined) return;
    out.rest.splice(at, a.endsWith('...') ? Infinity : 1, listItems(given, kind, field).join(','));
  });
  for (const [field, kind] of Object.entries(fields)) {
    if (Object.hasOwn(flagsOf(cmd), field) && flags[field] !== undefined) out.flags[field] = listItems(flags[field], kind, `--${field}`).join(',');
  }
  return out;
}

// The placeholders a call holds where a value goes: a whole value, a line of a value that holds one item per line, or the
// value part of a value written in parts — the value side of Name=value (--field, --section) and of Label: effect
// (--option), each side of dir#id (--source and the Source field), the entry of Section: entry (--changelog and the
// Changelog section), the qualifier, the value and each comma item of the value of a goal line (Model (light): opus,
// haiku), and each selector of --applies-to and its value (role worker). A text that holds <x> among other words is a
// text, and is not one of them.
const PART_OF = {
  field: (v) => [v.slice(v.indexOf('=') + 1)], section: (v) => [v.slice(v.indexOf('=') + 1)], option: (v) => [v.slice(v.indexOf(':') + 1)], line: (v) => (v.includes('=') ? [v.slice(0, v.indexOf('=')), v.slice(v.indexOf('=') + 1)] : []),
  source: (v) => v.split(',').flatMap((s) => s.split('#')), changelog: (v) => v.split('\n').map((l) => l.slice(l.indexOf(':') + 1)),
  set: (v) => { const m = /^[^:(]*(?:\(([^)]*)\))?\s*:(.*)$/s.exec(v); return m ? [m[1] ?? '', m[2], ...m[2].split(',')] : []; },
  'applies-to': (v) => v.split(/\s+and\s+/i).flatMap((s) => [s.trim(), s.trim().split(/\s+/).slice(1).join(' ')]),
};
// The parts that hold one item per line.
const LINE_PARTS = ['acceptance', 'changelog'];
function placeholdersIn(cmd, rest, flags) {
  const found = [];
  const look = (v, parts, lines) => { for (const p of [v, ...(lines ? String(v).split('\n') : []), ...(parts ? parts(String(v)) : [])]) if (isPlaceholder(p)) { found.push(String(v)); return; } };
  const name = String(rest[1] ?? '').trim().toLowerCase();
  rest.forEach((v, i) => look(v, cmd === 'field' && i === 2 ? PART_OF[name] : undefined, cmd === 'field' && i === 2 && LINE_PARTS.includes(name)));
  for (const [k, v] of Object.entries(flags)) if (k !== 'caller') for (const x of [].concat(v)) if (typeof x === 'string') look(x, PART_OF[k], LINE_PARTS.includes(k));
  return [...new Set(found)];
}

// The value of field for a header field that holds a list (Tags, Files, Repo, After, Source), read by the one rule of a
// list; any other part's value is one text, passed as it is. Items to remove are split at their commas and checked for a
// leading dash only: they match an item as it is stored, so an item stored with brackets or quotes can still be taken off.
const FIELD_LISTS = { tags: 'name', files: 'path', repo: 'path', after: 'name', source: 'name' };
function fieldListValue(name, value, remove) {
  const kind = FIELD_LISTS[String(name ?? '').trim().toLowerCase()];
  if (kind === undefined || value === undefined) return value;
  if (!remove) return listItems(value, kind, String(name).trim()).join(',');
  const items = [].concat(value).map(String).join(',').split(',').map((s) => s.trim()).filter(Boolean);
  const dashed = items.find((s) => s.startsWith('-'));
  need(dashed === undefined, `${String(name).trim()}: an item cannot start with - — got ${JSON.stringify(dashed)} (everything after a bare -- is an argument, so flags such as --root go before it)`, () => ({ replace: dashed, value: hole('<an-item-with-no-leading-dash>') }));
  need(!items.some(isPlaceholder), `${String(name).trim()}: ${items.filter(isPlaceholder).map(shellWord).join(', ')} — a placeholder: write the value in its place; nothing was written`, { retry: true });
  return items.join(',');
}

// The commands the command line and the tools do not have, each with the form of the command that does what was asked:
// every part of an issue's description is written by field, a repository's base by base, a branch is measured by scope,
// and the tips and the merge queue are sections of resume. The refusal names the command given and ends with that form,
// each value a placeholder, never a call built from the words given; --by stays in the form where the call gave it, and
// refusalFor writes the call's --root and --json into it as they were given.
function wordsOf(args, bools) {
  const pos = [];
  const flags = {};
  let rest = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = String(args[i]);
    if (!rest && a === '--') { rest = true; continue; }
    if (!rest && a.startsWith('--') && a.length > 2) {
      const [name, inline] = a.slice(2).split(/=(.*)/s);
      if (name === 'root') { if (inline === undefined) i += 1; continue; }
      if (bools.includes(name)) flags[name] = true;
      else (flags[name] = flags[name] || []).push(inline ?? (i + 1 < args.length ? String(args[(i += 1)]) : null));
    } else pos.push(a);
  }
  return { pos, flags };
}
const SECTION_FLAGS = { title: 'Title', where: 'Where', what: 'What', why: 'Why', acceptance: 'Acceptance', changelog: 'Changelog' };
const BOOLS = ['json', 'help', 'clear', 'append', 'gh'];
// The flags of a removed command that the command replacing it takes, each with the placeholder of its value.
const keptFlags = (cmd, flags) => Object.keys(flags).filter((k) => k !== 'json' && Object.hasOwn(flagsOf(cmd), k)).flatMap((k) => (flagsOf(cmd)[k] === 'bool' ? [`--${k}`] : [`--${k}`, valueHole(cmd, k)]));
export const REPLACED_COMMANDS = Object.freeze({
  tips: (args) => { const { flags } = wordsOf(args, BOOLS); return { why: 'the tips are a section of resume, which asks gh for their CI with --gh', form: ['jarl.mjs', 'resume', '--gh', ...keptFlags('resume', flags).filter((w) => w !== '--gh')] }; },
  queue: (args) => { const { flags } = wordsOf(args, BOOLS); return { why: 'the merge queue is a section of resume, its batches included', form: ['jarl.mjs', 'resume', ...keptFlags('resume', flags)] }; },
  check: (args) => { const { flags } = wordsOf(args, BOOLS); return { why: 'a branch is measured by scope', form: ['jarl.mjs', 'scope', hole('<id>'), '--branch', hole('<worker-branch>'), ...keptFlags('scope', flags).filter((w, i, all) => w !== '--branch' && all[i - 1] !== '--branch')] }; },
  prio: (args) => { const { flags } = wordsOf(args, BOOLS); return { why: 'the priority is a field', form: fieldForm('Priority', { by: flags.by !== undefined }) }; },
  tag: (args) => {
    const { pos, flags } = wordsOf(args, BOOLS);
    const remove = pos.slice(1).length > 0 && pos.slice(1).every((o) => o.startsWith('-'));
    return { why: 'tags are a field: field adds them with --add and takes them off with --remove, one call each', form: fieldForm('Tags', { add: !remove, remove, by: flags.by !== undefined }) };
  },
  files: (args) => {
    const { pos, flags } = wordsOf(args, BOOLS);
    const clearing = pos.length > 1 && !pos.slice(1).some((p) => p.trim().replace(/,/g, ''));
    return { why: 'the files are a field', form: fieldForm('Files', { clear: clearing, by: flags.by !== undefined }) };
  },
  source: (args) => { const { flags } = wordsOf(args, BOOLS); return { why: 'the source is a field', form: fieldForm('Source', { by: flags.by !== undefined }) }; },
  after: (args) => { const { flags } = wordsOf(args, BOOLS); return { why: 'the issues an issue waits on are a field', form: fieldForm('After', { clear: flags.clear === true, by: flags.by !== undefined }) }; },
  repo: (args) => {
    const { flags } = wordsOf(args, [...BOOLS, 'base']);
    if (flags.base) return { why: 'a repository\'s base is changed by base', form: ['jarl.mjs', 'base', hole('<name>'), hole('<branch>'), ...(flags.by !== undefined ? ['--by', hole('<who>')] : [])] };
    return { why: 'the repository is a field', form: fieldForm('Repo', { clear: flags.clear === true, by: flags.by !== undefined }) };
  },
  body: (args) => {
    const { flags } = wordsOf(args, BOOLS);
    const given = Object.entries(SECTION_FLAGS).filter(([flag]) => flags[flag] !== undefined);
    const parts = [...given.map(([flag, part]) => `--${flag} is ${part}`), ...(flags.section ? ['--section Name=value is the part Name'] : []), ...(flags.append ? ['--append is --add'] : [])];
    const why = `every part of the description is written by field, one call per part${parts.length ? ` (${parts.join(', ')})` : ' (Title, Where, What, Why, Acceptance, Changelog or a section the profile declares; --add adds to a section)'}`;
    const by = flags.by !== undefined;
    if (given.length === 1 && !flags.section) return { why, form: fieldForm(given[0][1], { add: flags.append === true && !['title', 'where'].includes(given[0][0]), by }) };
    return { why, form: ['jarl.mjs', 'field', hole('<ids>'), hole('<part>'), hole('<value>'), ...(flags.append ? ['--add'] : []), ...(by ? ['--by', hole('<who>')] : [])] };
  },
});
// The refusal of a command the surface does not have: what replaces it, and last the form of the command that does what
// was asked.
export function replacedRefusal(cmd, args = []) {
  const { why, form } = REPLACED_COMMANDS[cmd](args);
  refuse(`${cmd} is not a command; ${why}`, form);
}
// The same refusal as text, for a caller that reports it in a message of its own (the MCP server's unknown tool), its
// form carrying the root the call named.
export function replacedMessage(cmd, args = [], root = null) {
  try { replacedRefusal(cmd, args); } catch (e) { return refusalFor(e, { cmd, args: [], flags: root === null ? [] : [['root', root, '=']] }).message; }
  return '';
}

const ARITY = Object.fromEntries(Object.entries(COMMAND_ARGS).filter(([, a]) => !a.some((n) => n.endsWith('...'))).map(([c, a]) => [c, a.length]));

// git's side of the loop: the merge driver git runs, and the settings a merger passes it. Neither reads a loop.
function mergeDriverMain(args) {
  const [what, ...rest] = args;
  if (what === 'decisions' && rest.length === 3) {
    const r = runDecisionsDriver(rest[0], rest[1], rest[2]);
    for (const c of r.conflicts) console.error(`jarl: decisions.md conflict — ${c}`);
    process.exit(r.code);
  }
  if (what === 'flags' && (rest.length === 0 || (rest.length === 2 && rest[0] === '--yg'))) {
    console.log(mergeFlags({ yg: rest[1] }));
    process.exit(0);
  }
  console.error('usage: jarl.mjs merge-driver decisions %O %A %B | merge-driver flags [--yg "<command>"]');
  process.exit(1);
}

const LONG_NOTE_CHARS = 600;
const LONG_NOTE_LINES = 6;

// The version of this install: the plugin manifest at the plugin root, three directories above this script. A copy with
// no manifest reports a fallback version. The MCP server reads the same value, so the command line and the server of one install agree.
export function installVersion() {
  try { return JSON.parse(readFileSync(new URL('../../../plugin.json', import.meta.url), 'utf8')).version || '0.0.0'; } catch { return '0.0.0'; }
}

// The line resume prints when the host names a plugin root in CLAUDE_PLUGIN_ROOT and the manifest there names another
// version than this script. The plugin's server runs the Jarl tools, so a different version there means the tools in the
// session and this script differ. Null when the variable is unset or empty, when the manifest is missing, unreadable or
// names no version, and when the two versions are equal. It never throws: a resume is never refused by it.
export function pluginVersionNote(env = process.env, script = installVersion()) {
  try {
    const root = (env.CLAUDE_PLUGIN_ROOT ?? '').trim();
    if (!root) return null;
    const plugin = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8')).version;
    if (typeof plugin !== 'string' || !plugin || plugin === script) return null;
    return `note: the plugin at CLAUDE_PLUGIN_ROOT, whose server runs the Jarl tools, is version ${plugin}; this script is version ${script}.`;
  } catch { return null; }
}

// The command that reads the checkout rather than a loop in it, whatever loop a call would reach: use reads its path from
// it. And the calls discovery does not refuse where the checkout's root holds no loop: init, which opens one there, and profile
// with a file, which checks the file and needs no loop.
export const CHECKOUT_COMMANDS = Object.freeze(['use']);
export const OPENING_COMMANDS = Object.freeze(['init']);
export const readsNoLoop = (cmd, file) => OPENING_COMMANDS.includes(cmd) || (cmd === 'profile' && file !== undefined);
// The loop a command-line call reaches, and the note it gets: its --root; for use, the checkout of the working directory;
// else JARL_ROOT, an absolute path (a relative one would reach another loop from the next directory); else the loop found
// from the working directory (discoverLoop), which refuses a call where the checkout holds no loop at its root and holds
// some below it, init and profile with a file excepted. The command line keeps nothing between runs: use prints the JARL_ROOT
// setting instead. `args` are the call's arguments after the command.
export function cliRoot(cmd, flags, env = process.env, cwd = process.cwd(), args = []) {
  if (flags.root) return { root: R.resolveRoot(flags.root, cwd), note: null };
  if (CHECKOUT_COMMANDS.includes(cmd)) return { root: R.resolveRoot(undefined, cwd), note: null };
  const raw = String(env.JARL_ROOT ?? '').trim();
  if (raw) {
    need(isAbsolute(raw), `JARL_ROOT must be an absolute path (got ${escapedEchoes(JSON.stringify(raw), [raw])}) — a relative one would reach another loop from another directory; nothing was read or written`, { flag: '--root', value: hole('<loop-root>') });
    return { root: resolve(raw), note: null };
  }
  if (readsNoLoop(cmd, args[0])) return { root: R.resolveRoot(undefined, cwd), note: null };
  return discoverLoop(cwd);
}

// The command line, given its words: what it prints goes to the console, its status through process.exit. A test runs it
// in its own process (tests/in-process.mjs) for the same reason a server runs dispatch: thousands of calls cost one start.
export function cliMain(argv = process.argv.slice(2)) {
  if (argv[0] === 'merge-driver') mergeDriverMain(argv.slice(1));
  if (argv.length === 1 && argv[0] === '--version') { console.log(installVersion()); process.exit(0); }
  let parsed;
  try { parsed = parseArgs(argv); } catch (e) { console.error(e.message); process.exit(1); }
  const { positional, flags } = parsed;
  const [cmd, ...rest] = positional;
  if (!cmd || flags.help) { console.log(cmd && commandUsage(cmd) ? commandUsage(cmd) : shortUsage()); process.exit(flags.help ? 0 : 1); }
  let located;
  try { located = cliRoot(cmd, flags, process.env, process.cwd(), rest); } catch (e) { console.error(e.message); process.exit(1); }
  const { root } = located;
  let r;
  try { r = dispatch(root, cmd, rest, flags); } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const { out, text, warn } = r;
  if (located.note) warn.push(`note: ${located.note}`);
  // Said on the command line only, after the note is written whole: a long free-text note is hard to read back and
  // cannot be retracted by number; nothing is refused or cut.
  if (cmd === 'evidence' && flags.ran === undefined && typeof rest[1] === 'string' && (rest[1].length > LONG_NOTE_CHARS || rest[1].trim().split('\n').length > LONG_NOTE_LINES)) {
    warn.push(`note: that evidence note is long (${rest[1].trim().length} characters, ${rest[1].trim().split('\n').length} lines) and was written whole; only its first line reaches the log, and a note is not a row that can be retracted by number — for proof of work, record it as --ran "<command>" --saw "<what-it-printed>"`);
  }
  console.log(flags.json ? JSON.stringify(out, null, 2) : text);
  for (const w of warn) console.error(w);
  if ((cmd === 'scope' || cmd === 'verify') && !out.ok) process.exit(2);
}

// The ratification batch as close prints it: one line per item, then what became of the ones nobody answered.
function renderBatch(batch, loop) {
  if (!batch.items.length && !batch.waiting) return loop === 'open' ? 'no area ruling awaits ratification' : '';
  const head = `\nto ratify (${batch.items.length}${batch.waiting ? `, ${batch.waiting} more at the next close` : ''}) — answer each with yes or reject (tak or nie): ${jarlLine('answer', '<question>', 'yes', '--by', '<who>')}`;
  const tail = { open: 'nothing closed; the loop goes on', kept: 'unanswered items stay open in the record', removed: 'unanswered, they left with the loop as its own rulings' }[loop];
  return `${head}\n${batch.items.map((i) => `- ${i.ask} · ${i.question}`).join('\n')}\n${tail}`;
}
// The rules of the loop offered for promotion at its close, each a question on the owner with the four ways it goes on.
// Where close removed the loop the questions went with it, so no answer is offered for them.
function renderPromotion(p, loop) {
  if (!p) return '';
  if (!p.items.length) return '';
  if (loop === 'removed') return `\n${p.items.length} rule(s) of the loop were offered for promotion and left with it unanswered: close --batch offers them before the loop goes`;
  return `\nrules of the loop to promote (${p.items.length}) — answer each with one way (carry, instructions, law or drop): ${jarlLine('answer', '<question>', '--option', '<option>', '--by', '<who>')}\n${p.items.map((i) => `- ${i.ask} · ${i.question}`).join('\n')}`;
}
function renderRuleLog(r, t) {
  if (!r || !t) return '';
  if (t.state === 'written') return ` · rule ${r.rule} ratified in its own log (by ${t.by}${t.datetime ? `, ${t.datetime}` : ''})`;
  if (t.state === 'skipped') return ` · rule ${r.rule} not ratified in its own log: ${t.reason}`;
  return ` · rule ${r.rule} NOT ratified in its own log: ${t.reason}`;
}
// A loop whose profile keeps close to the record belongs to the tool that runs it: what the answer says instead of
// a write, naming that tool and its command.
function recordKeeperOf(root) {
  const profile = R.loadProfile(root);
  if (profile.lifecycle.close !== 'record') return null;
  return { state: 'skipped', reason: `this loop is run by ${profile.name}, which writes it into the graph with its own code${profile.lifecycle.command ? ` — ${profile.lifecycle.command}` : ''}` };
}
function renderTypeLog(t) {
  if (!t) return '';
  if (t.state === 'written') return ` · written into the type's decision log${t.datetime ? ` (${t.datetime})` : ''}`;
  if (t.state === 'skipped') return ` · not written into a type log: ${t.reason}`;
  return ` · NOT written into the type log: ${t.reason}`;
}

// set <ids> <status> [why] or set <ids> <field> <value>: the library decides which one the name is (see setRoute). The
// command line (and the MCP tools, which run through dispatch) always sets as caller 'cli'.
function setCommand(root, ids, name, value, flags) { return cmdSet(root, ids, name, value, { ...flags, caller: 'cli' }); }

// One command, run: its result (what --json prints), its text and the notes said on stderr. Throws on a refusal.
// Every call starts from empty caches, so a caller that runs many commands in one process (a server) sees each
// time what is on disk and in git now, exactly as a fresh process would.
// Every command the call prints, in its answer, its notes, its JSON or its refusal, carries the call's --root and --json
// (printingFor): a view and a note describe the loop the call named, and their commands reach it.
export function dispatch(root, commandName, rest, flags) {
  const call = callOf(commandName, rest, flags);
  let r;
  try { r = printingFor(rootOfCall(call), () => dispatchCall(root, commandName, rest, flags)); } catch (e) { throw refusalFor(e, call); }
  // A note echoes words of the call as a reason does: line breaks escaped, a word a shell acts on in single quotes; the
  // global flags it prints only inside the commands printCommand built.
  const words = [commandName, ...rest, ...Object.entries(flags).filter(([k]) => !Object.hasOwn(GLOBAL_FLAGS, k)).flatMap(([, v]) => [].concat(v))].filter((w) => typeof w === 'string');
  return { ...r, warn: (r.warn || []).map((w) => escapedEchoes(w, words)) };
}
// The writing commands that run where no loop is: init makes one. Every other write needs the loop to exist; the views
// read an empty one where none is.
const NEEDS_NO_LOOP = ['init'];
const UNRECORDED_NAME = new RegExp(`^\\s*${UNRECORDED}\\s*$`, 'i');
function dispatchCall(root, commandName, rest, flags) {
  const cmd = commandName;
  needRecordFormat(root);
  if (Object.hasOwn(REPLACED_COMMANDS, cmd)) replacedRefusal(cmd, rest);
  // A placeholder a refusal printed, pasted unfilled, is never recorded: every value the call takes is checked for one.
  // The reason names the placeholders a value holds, never the value, which may hold a line break or anything else.
  const holes = placeholdersIn(cmd, rest, flags);
  const named = () => { const found = [...new Set(holes.flatMap((v) => String(v).match(new RegExp(HOLE.source, 'g')) || []))]; return `${found.map((p) => shellWord(p)).join(', ')} ${found.length === 1 ? 'is a placeholder' : 'are placeholders'} of a form Jarl printed, left in ${holes.length === 1 ? 'a value' : `${holes.length} values`} of the call`; };
  need(holes.length === 0, holes.length ? `${named()}: write the value in its place — nothing was written` : '', { retry: true });
  // An argument the command requires and the call left out is named, and the form has a placeholder for it.
  const missing = (COMMAND_ARGS[cmd] || []).filter((a, n) => !/[?.]$/.test(a) && rest[n] === undefined && !(cmd === 'set' && a === 'status' && flags.header));
  need(missing.length === 0, `${cmd} requires ${missing.map((a) => `its ${a}`).join(' and ')}: the form below has a placeholder for each value`, { retry: true });
  if (writes(['jarl.mjs', cmd, ...Object.keys(flags).map((k) => `--${k}`)]) && !REFUSE_THEIR_OWN_BY.includes(cmd)) need(flags.by !== undefined, `${cmd} writes the record, and every write names its writer with --by: ${ownWriter(cmd)}`, () => ({ flag: '--by', value: '<who>' }));
  for (const name of NAME_FLAGS) need(typeof flags[name] !== 'string' || !isFlagWord(flags[name]), `--${name} takes a name, and ${JSON.stringify(flags[name])} reads as a flag`, () => ({ flag: `--${name}`, value: NAME_FLAG_HOLES[name] }));
  if (flags.by !== undefined && MUTATING.has(cmd)) need(!UNRECORDED_NAME.test(String(flags.by)), `${UNRECORDED} is the mark of a line nobody named a writer for, never a name a call gives — every write says who made it`, () => ({ flag: '--by', value: '<who>' }));
  if (MUTATING.has(cmd) && !NEEDS_NO_LOOP.includes(cmd)) needLoop(root);
  ({ rest, flags } = readLists(cmd, rest, flags));
  resetCaches();
  let out;
  let text;
  let warn = [];   // said on stderr, so a caller reading stdout sees the result alone
  const each = (o, f) => [].concat(o).map(f).join('\n');
  const locked = MUTATING.has(cmd);
  const writer = writerOf(cmd, flags);
  {
    (locked ? (fn) => withLock(root, fn) : (fn) => fn())(() => withWriter(writer, () => {
    switch (cmd) {
      case 'init': out = R.initLoop(root, rest[0], { ...flags, caller: 'cli' }); text = `opened ${out.dir} · ${out.permanent ? 'permanent record, no branch' : out.committed ? 'committed with the work' : 'kept out of git'}${out.profile ? ` · profile ${out.profile}` : ''}`; warn = [out.note, out.modelNote, R.loadProfile(root).models && `the profile names models, and the goal places none yet: add a Model line for each tier, then check the profile — ${jarlLine('goal', '--set', hole('<machine-line>'))}, then ${jarlLine('profile')}`].filter(Boolean).map((n) => `note: ${n}`); break;
      // The command line says caller 'cli': the notes (the tier a new issue got) are for it, never for a library caller.
      case 'new': out = R.newIssue(root, rest[0], { ...flags, caller: 'cli', width: undefined }); out = { ...out, ...describeNew(out.file) }; text = renderNewReply(out); warn = out.note ? [out.note] : []; break;
      case 'renumber': out = cmdRenumber(root, rest[0], flags); text = `${out.from} → ${out.id} · issues/${basename(out.file)} · key ${out.key}`; break;
      case 'import': out = cmdImport(root, rest[0], flags); text = renderImport(out); break;
      case 'sources': out = cmdSources(root, rest, flags); text = renderSources(out); break;
      case 'list': out = cmdList(root, flags); text = renderList(out, R.loadProfile(root)); break;
      case 'show': { const i = R.findIssue(root, rest[0]); need(i, `no such issue: ${rest[0]} — the issues: ${jarlLine('list', '--all')}`, { arg: 0, value: '<id>' }); if (flags['at-lease']) { const { atLease } = issueLinesAtLease(root, rest[0]); out = { id: i.id, atLease }; text = atLeaseText(i, atLease); break; } const attachments = attachmentStates(root, i); out = { ...i, evidenceRows: evidenceTable(i.sections.evidence).rows.map(({ n, ran, saw, retracted, lines }) => ({ n, ran, saw, retracted, ...(lines.length ? { lines } : {}) })), where: whereOf(root, i), ...(attachments.length ? { attachments } : {}) }; if (!flags.full) { const read = workerEvidence(i.sections.evidence); if (read.retracted) out = { ...out, sections: { ...i.sections, evidence: read.text }, retractedNotes: read.retracted }; } text = issueView(root, i, { full: Boolean(flags.full) }); break; }
      case 'brief': out = R.briefData(root, rest[0], flags); text = renderBrief(out); break;
      case 'set':
        // A field is written by field, never by set: the refusal ends with the form of the call that writes it.
        if (setRouteOf(root, rest[1]) === 'field') {
          const clearing = rest[2] === undefined || (typeof rest[2] === 'string' && rest[2].trim() === '');
          refuse(`${rest[1]} is a field, not a status: field writes it`, fieldForm(String(rest[1]).trim(), { clear: clearing, by: flags.by !== undefined }));
        }
        out = setCommand(root, rest[0], rest[1], rest[2], flags);
        text = each(out, (o) => (o.header ? `header of ${o.id} rewritten from the log: ${o.status}` : `${o.id} → ${o.status}${o.branch ? ` · ${o.branch}` : ''}${o.worker ? ` · ${o.worker}` : ''}${o.handover ? ' · handed over' : ''}`)); warn = [].concat(out).filter((o) => o.note).flatMap((o) => o.note.split('\n').map((n) => `note: ${o.id} ${n}`)); break;
      case 'field':
        out = cmdField(root, rest[0], rest[1], fieldListValue(rest[1], rest[2], flags.remove === true), { ...flags, caller: 'cli' });
        text = each(out, renderField);
        warn = [].concat(out).flatMap((o) => (o.note ? [o.note] : []).concat((o.notes || []).map((n) => `note: ${n}`)));
        break;
      case 'split':
        out = cmdSplit(root, rest[0], flags);
        text = `${out.id} split: ${out.lines.map((l) => (l.kept ? `line ${l.line} kept` : `line ${l.line} → ${l.to}`)).join(', ')} · sub-issues ${out.subs.join(', ')}`;
        warn = out.notes || [];
        break;
      case 'base':
        out = cmdRepoBase(root, rest[0], rest[1]);
        text = out.unchanged ? `${out.name} base: ${out.base} (unchanged)` : `${out.name} base: ${out.base} (was ${out.was ?? 'none'})`;
        break;
      case 'evidence':
        out = R.addEvidence(root, rest[0], rest[1], flags); text = each(out, renderEvidence); break;
      // One verb takes back a verdict, an evidence row and the owner's tick: the review's newest approve, the row by its
      // number, the tick by the number of its acceptance line.
      case 'retract':
        if (rest[1] === 'supersession') { out = cmdWithdrawSupersession(root, rest[0], rest[2], flags); text = renderWithdrawn(out); break; }
        need(rest[1] === 'review' || /^(note-|tick-)?\d+$/.test(rest[1] ?? ''), `retract takes review (the newest approve) or the number of an evidence row, note-<n> for a note, tick-<n> for the owner's tick of acceptance line n, or supersession for the slug of a ruling superseded by mistake, got "${rest[1] ?? ''}"`, () => [...(rest[0] === undefined ? [{ arg: 0, value: '<id>' }] : []), { arg: 1, value: '<review-n-or-note-n>' }, ...(rest[2] === undefined ? [{ arg: 2, value: '<what-was-wrong>' }] : []), ...(flags.by === undefined ? [{ flag: '--by', value: '<who>' }] : [])]);
        if (/^tick-/.test(rest[1])) { out = cmdRetractTick(root, rest[0], rest[1], rest[2], flags); text = `${out.id} the owner's tick of acceptance line ${out.line} of ${out.retracted} taken back by ${out.by} at ${out.at}`; } else if (rest[1] === 'review') { out = R.review(root, rest[0], 'retract', rest[2], { by: flags.by, caller: 'cli' }); text = each(out, renderReview); warn = [].concat(out).filter((o) => o.note).map((o) => `note: ${o.note}`); } else { out = R.addEvidence(root, rest[0], rest[2], { retract: rest[1], by: flags.by }); text = each(out, renderEvidence); }
        break;
      // One computation of the rows: the ready ones are listed, and the rest says how many are held or waiting.
      case 'next': {
        if (flags.as !== undefined) {
          need(flags.limit === undefined, '--limit counts the ready issues of next; next --as prints at most seven lines, and --all every line', () => ({ rename: '--limit', to: '<no-flag-here>' }));
          need(flags.slice === undefined, '--slice scopes next to one coordinator\'s slice; next --as <coordinator> lists what is on that coordinator, its slice included', () => ({ rename: '--slice', to: '<no-flag-here>' }));
          out = cmdNextAs(root, flags); text = renderNextAs(out);
          break;
        }
        const rows = cmdNext(root, { ...flags, all: true });
        out = flags.all ? rows : rows.filter((r) => r.ready);
        text = renderNext(out, flags.all === true, rows.length - out.length);
        break;
      }
      case 'review':
        // A verdict is taken back by retract alone: the refusal is that call, with the words given.
        if (rest[1] === 'retract') refuse('a verdict is taken back with retract, not with review retract', RETRACT_REVIEW_FORM);
        out = R.review(root, rest[0], rest[1], rest[2], { ...flags, caller: 'cli' }); text = each(out, renderReview); warn = [].concat(out).filter((o) => o.note).map((o) => `note: ${o.note}`); break;
      case 'tick': out = cmdTick(root, rest[0], rest[1], flags); text = `${out.id} acceptance line ${out.line} ticked by ${out.by} at ${out.at}`; break;
      // --group is the grouping the views and the record library read as by.
      case 'models': out = cmdModels(root, groupedBy(flags)); text = renderModels(out); break;
      case 'round': out = eachIssue(root, rest[0], (id, dry) => cmdRound(root, id, rest[1], dry, flags)); text = each(out, (o) => (o.takeover ? `${o.id} round ${o.round} — takeover:\n\n${o.block}` : `${o.id} round ${o.round}: ${o.since} of ${o.limit} before a takeover; the rounds so far: show ${o.id}`)); if (flags.findings !== undefined) warn.push('note: --findings is the name round takes its count of findings under; --finding-count is the name to use'); break;
      case 'merged': out = R.recordMerged(root, rest[0], { ...flags, caller: 'cli' }); text = `${out.ids.join(', ')} ${out.sha ? `merged ${out.sha}` : 'merge'}${out.check ? ` · check ${out.check}` : ''}${out.red ? ` · landed red, cause ${out.red}` : ''}${out.ci ? ` · CI ${out.ci}` : ''}${(out.cleanup || []).map((c) => `\n${c.kept ? `kept ${c.branch}${c.worktree ? ` (worktree ${c.worktree} removed)` : ''} — ${c.kept}` : `removed ${c.worktree ? `the worktree ${c.worktree} and ` : ''}the branch ${c.branch}`}${(c.commands || []).length ? `\nafter looking at the files, remove them with:\n${c.commands.map((x) => `  ${x}`).join('\n')}` : ''}${out.cleanup.some((x) => x.repo !== c.repo) ? ` [${c.repo}]` : ''}`).join('')}`; warn = out.notes.map((n) => `note: ${n}`); break;
      case 'scope': out = cmdCheck(root, rest[0], flags); text = `${out.id === null ? `package ${out.ids.join(', ')} on ${out.branch}\n` : ''}${out.repo === root ? '' : `in ${out.repo}\n`}${out.items.map((i) => `${i.ok ? '✓' : '✗'} ${i.name} — ${i.note}`).join('\n')}${out.notes.length || out.notesOmitted ? `\n${renderCheckNotes(out)}` : ''}`; break;
      case 'branches': out = cmdBranches(root, flags); text = renderBranches(out, root); break;
      case 'ask': out = R.ask(root, rest[0], { ...flags, width: undefined }); text = askText(out); if (flags.kind === undefined) warn.push(`note: asked as ${out.kind}, the default kind (--kind is one of stop, stuck, lower, charter, ratify, escalation, rule)`); break;
      // --by and --option reach the answer through jarl-lib.mjs, under the lock held here.
      // A judgement names its author: on the command line an answer and a ruling are refused without --by, and the refusal
      // ends with the form of the call, its --by a placeholder. The library takes a call that names nobody.
      case 'answer':
        need(flags.by !== undefined, 'answer records who answered with --by, owner for the owner', () => ([{ flag: '--by', value: '<who>' }, ...(rest[1] === undefined && flags.option === undefined ? [{ arg: 1, value: '<text>' }] : [])]));
        out = cmdAnswerMany(root, rest[0], rest[1], flags); break;   // text below: the type log is written outside the lock
      case 'resume': out = R.resumeData(root, flags); text = renderResume(out, R.loadProfile(root), pluginVersionNote(), flags.as !== undefined); ({ out, text } = endWithAsker(root, flags, out, text)); break;
      case 'handoff':
        need(rest[0] === undefined || rest[0] === 'read' || rest[0] === 'write', `handoff takes read or write (got "${rest[0]}") — the state is assembled live by resume`, ['jarl.mjs', 'resume']);
        if (rest[0] === 'write') { out = cmdHandoffWrite(); text = out.note; } else { out = cmdHandoffRead(root, flags); text = out.text; }
        break;
      case 'report': out = cmdReport(root, flags); text = out.text; break;
      case 'log':
        need(typeof rest[0] === 'string' && rest[0].trim(), 'log requires "<text>"', () => ({ arg: 0, value: '<text>' }));
        out = R.appendLog(root, rest[0]); text = 'logged'; break;
      case 'decide':
        need(flags.by !== undefined, 'decide records who ruled with --by, jarl under a mandate, owner with --quote "<his-own-words>"', () => ([{ flag: '--by', value: '<who>' }, ...(rest[1] === undefined ? [{ arg: 1, value: '<text>' }] : [])]));
        out = R.decide(root, rest[0], rest[1], flags); text = renderDecide(out); decideNotes(root, rest[0], out.by, flags, warn, rest[1]); break;
      case 'decisions': out = R.decisions(root, flags); text = renderDecisions(out); break;
      case 'goal': out = flags.set === undefined ? cmdGoal(root) : cmdGoalSet(root, flags.set); text = flags.set === undefined ? out.goal : out.unchanged ? `goal line unchanged: ${out.shown}` : `goal line ${out.replaced ? 'changed' : 'added'}: ${out.shown}${out.replaced ? ` (was ${out.was})` : ''}`; break;
      case 'status': out = R.statusData(root, groupedBy(flags)); text = renderStatus(out, R.loadProfile(root)); ({ out, text } = endWithAsker(root, flags, out, text)); break;
      case 'changelog': out = cmdChangelog(root, rest[0], flags); text = out.text || '(no changelog fragment on these issues)'; warn = out.missing.length ? [`note: no changelog fragment: ${out.missing.join(', ')} — record one with: ${jarlLine('field', '<id>', 'Changelog', '<changelog-entry>', '--add')}, its section first (Added, Changed, Deprecated, Removed, Fixed or Security, then a colon)`] : []; break;
      case 'archive': out = cmdArchive(root, rest[0], { caller: 'cli' }); text = `archived → ${out.archived}${out.leftOpen.length ? ` · ${out.leftOpen.length} still open or in progress: ${out.leftOpen.join(', ')}` : ''} · open a new loop with: ${jarlLine('init', '<goal>')}`; break;
      case 'mode': out = cmdMode(root, rest[0]); text = 'now permanent · not tied to a feature branch; close keeps the directory'; break;
      // The profile check: a model the profile names is one a Model line of the loop's goal places.
      case 'profile': out = cmdProfile(root, rest[0]); needKnownModels(root, rest[0] === undefined ? R.loadProfile(root) : readProfileFile(rest[0], { argument: true }).profile, rest[0] ?? 'the profile'); text = renderProfile(out); break;
      case 'extend': out = cmdExtend(root, rest[0], rest[1], flags); text = `profile extended: ${out.part} ${out.name}${out.spec ? ` (${[out.spec.enum && `one of ${out.spec.enum.join(', ')}`, out.spec.default && `default ${out.spec.default}`, out.spec.required && 'required'].filter(Boolean).join(', ') || 'a free one-line value'})` : ''}`; warn = [`note: the issues already filed carry the ${out.part} once field writes it: ${jarlLine('field', '<ids>', out.name, out.part === 'section' ? '<text>' : '<value>')}`]; break;
      case 'verify': out = cmdVerify(root); text = renderVerify(out); break;
      // The root of use is the checkout its path is read from: the call's --root, else the checkout of the working directory.
      case 'use': out = cmdUse(root, rest[0]); text = renderUse(out); break;
      case 'close': out = cmdClose(root, { ...flags, caller: 'cli' }); text = out.closed ? (out.kept ? `kept ${out.kept} · closed as a permanent record` : `removed ${out.removed}${out.archiveKept ? ' (the live loop; .jarl/archive/ is left in place)' : out.archiveRemoved ? ` (with .jarl/archive/: ${out.archiveRemoved.join(', ')})` : ''}`) + (out.deferred.length ? ` · ${out.deferred.length} deferred ${out.kept ? 'still waiting' : 'removed with the loop'}: ${out.deferred.join(', ')}` : '') + (out.uncommitted ? ` · ${out.uncommitted} loop file(s) not committed${out.kept ? ' — commit .jarl/' : ' before the removal'}` : '') + renderBatch(out.batch, out.kept ? 'kept' : 'removed') + renderPromotion(out.promotion, out.kept ? 'kept' : 'removed') : (renderBatch(out.batch, 'open') + renderPromotion(out.promotion, 'open')).trimStart(); break;
      default: refuse(`unknown command: ${cmd}`, { command: hole('<a-jarl-command>') });
    }
    }));
  }
  // A ratified area ruling goes to the type's decision log after the answer is recorded and the lock let go: the
  // probe and the write run another tool, which may take a while, and other writers of the loop must not wait on it.
  // A loop whose profile keeps close to the record is written into the graph by the tool that runs it, with its own code
  // and into the tree it hands over: here the answer is recorded and nothing is sent, so no entry is ever written twice,
  // nor into a checkout that tool's work never reaches.
  if (cmd === 'answer') text = [].concat(out).map((one) => answered(root, one, warn)).join('\n');
  return { out, text, warn };
}

// The writer of a call: the name its --by gives, written into every line the call writes, in its fixed place after the stamp.
function writerOf(cmd, flags) {
  if (!MUTATING.has(cmd) || flags.by === undefined) return null;
  // A write that refuses a bad --by itself says so in its own words: an empty one reaches that refusal.
  return REFUSE_THEIR_OWN_BY.includes(cmd) && !fieldText(flags.by) ? null : editorOf(flags.by);
}

// The flags of a grouping view with --group handed on as the grouping the library reads (by).
function groupedBy(flags) {
  const { group, ...rest } = flags;
  return group === undefined ? rest : { ...rest, by: group };
}

// status --as and resume --as: the view, then the asker's list as next --as prints it (`as` in --json).
function endWithAsker(root, flags, out, text) {
  if (flags.as === undefined) return { out, text };
  const asker = askerSection(root, flags.as, flags);
  // The asker's list is the loop's, whatever the view is scoped to: a scoped view says so over the list.
  const scope = flags.tag !== undefined ? `the issues tagged ${flags.tag}` : flags.slice !== undefined ? `the slice of ${flags.slice}` : null;
  const [head, ...rest] = asker.text.split('\n');
  return { out: { ...out, as: asker.as }, text: `${text}\n\n${[scope ? `${head} — the whole loop's list, not only ${scope}` : head, ...rest].join('\n')}` };
}

// The line each command prints for one result.
// A section's text on one line, cut where it runs long; a header field as it is.
const FIELD_SHOWN = 120;
const renderField = (o) => { const v = String(o.value ?? '').split('\n').map((l) => l.trim()).filter(Boolean).join(' / '); return `${o.id} ${o.field}: ${v ? (v.length > FIELD_SHOWN ? `${v.slice(0, FIELD_SHOWN)}…` : v) : '(cleared)'}`; };
const renderEvidence = (o) => (o.retractedNote ? `${o.id} evidence note ${o.retractedNote} retracted by ${o.by}` : o.retracted ? `${o.id} evidence row ${o.retracted} retracted by ${o.by}` : o.rows ? `${o.id} evidence row${o.rows.length > 1 ? 's' : ''} recorded${o.lines ? ` for acceptance line ${o.lines.join(', ')}` : ''}` : `${o.id} evidence recorded`);
const renderReview = (o) => (o.retracted ? `${o.id} review retracted by ${o.by} (${o.kind}): the approve ${o.retracted}` : `${o.id} review ${o.verdict}${o.by ? ` by ${o.by} (${o.kind})` : ''} · acceptance: ${o.acceptance ? o.acceptance.split('\n').join(' / ') : '(none on file)'}${o.filed ? ` · filed outside the issue: ${o.filed.join(', ')}` : ''}${o.next ? ` · next: ${o.next}` : ''}`);

// One answer, after its ruling is recorded: a ratified area ruling goes to the type's decision log (and a rule's ratification
// to the rule's own log) through the tool that runs the loop or the graph's tool, then the line the command prints for it.
function answered(root, out, warn) {
  const keeper = (out.typeDecision || out.ruleRatification) ? recordKeeperOf(root) : null;
  if (out.typeDecision) {
    out.typeLog = keeper || writeAreaDecision(root, out.typeDecision);
    try { withLock(root, () => recordTypeLog(root, out.ruling, out.typeDecision, out.typeLog)); } catch (e) { warn.push(`note: what became of ${out.ruling} in the type log was not recorded in the loop: ${e.message}`); }
  }
  // The rule's ratification is written after the type's decision, and independently of it: either may fail alone.
  if (out.ruleRatification) {
    out.ruleLog = keeper || writeRuleRatification(root, out.ruleRatification);
    try { withLock(root, () => recordRuleLog(root, out.ruling, out.ruleRatification, out.ruleLog)); } catch (e) { warn.push(`note: what became of ${out.ruling} in the rule's log was not recorded in the loop: ${e.message}`); }
  }
  if (out.typeLog?.state === 'failed') warn.push(`note: ${out.ruling} stays a ruling of this loop; write it by hand in ${out.typeLog.repo}: ${out.typeLog.retry} (add --supersedes and the date and time of the decision it replaces, or --adds, when yg lists decisions in force)`);
  if (out.ruleLog?.state === 'failed') warn.push(`note: rule ${out.ruleRatification.rule} is not ratified in its own log; write it by hand in ${out.ruleLog.repo}: ${out.ruleLog.retry}`);
  return `answered a-${out.id}${out.chose ? ` · chose ${out.chose}` : ''}${out.issue ? ` · written into ${out.issue}` : ''}${out.verdict ? ` · ${out.ruling} ${out.verdict}${renderTypeLog(out.typeLog)}${renderRuleLog(out.ruleRatification, out.ruleLog)}` : ''}`;
}

// What the command says of a question it asked: a question with options prints them, ready for the choice window.
function askText(out) {
  if (out.kind === 'ratify') return `filed a-${out.id} for ratification · blocks nothing`;
  if (!out.options) return `asked a-${out.id}`;
  return [`asked a-${out.id}`, out.question, ...out.options.map((o) => `- ${o.label}: ${o.effect}`), 'answer with --option <option>, or in your own words'].join('\n');
}

// The notes a decide says on stderr: a ruling that reads as an instruction and names no one it applies to, and the open issues
// that name the ruling a supersession replaces, so the jarl rewrites them now.
function decideNotes(root, slug, by, flags, warn, text) {
  if (flags['applies-to'] === undefined && typeof text === 'string' && readsAsInstruction(text)) {
    warn.push(`note: ${slug} reads as an instruction and has no --applies-to, so no brief or view hands it to anyone — a ruling that is a record needs nothing; to make it a rule for agents, decide it again, which supersedes this one: ${jarlLine('decide', '<a-new-slug>', '<a-ruling>', '--supersedes', slug, '--applies-to', '<selectors>', '--by', '<who>')}`);
  }
  for (const old of flags.supersedes === undefined ? [] : [].concat(flags.supersedes).flatMap((v) => String(v).split(',')).map((x) => x.trim()).filter(Boolean)) {
    const open = issuesNaming(root, old);
    if (open.length) warn.push(`note: open issues name ${old}: ${open.map((i) => i.id).join(', ')} — rewrite them to ${slug}`);
  }
}

if (isEntry(process.argv[1], fileURLToPath(import.meta.url))) cliMain();
