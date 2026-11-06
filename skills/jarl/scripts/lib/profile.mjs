// The profile: what a loop's issues carry and what its statuses mean.

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { KEPT_KINDS, KINDS, TIERS, TIER_DEFAULT, afterView, need, refuse } from './base.mjs';
import { jarlDir } from './where.mjs';
import { readText } from './files.mjs';

// ---- the profile: what a loop's issues carry and what its statuses mean ----------------------------

// A loop may be opened with a profile (init --profile <file>), stored as .jarl/profile.json. It is data only: the
// statuses an issue moves through and what each one means to the tool, the header fields its issues carry (with
// the values each may take), extra sections, and the heading its acceptance lives under. Jarl reads the profile's
// keys and flags; it never reads meaning into a name the profile chose. A loop with no profile runs on the built-in
// one below, which is the whole of what a loop without a profile does.
//
// What a status means is said by its flags, never by its name:
// - dispatchable        next offers an issue in it (built-in: open);
// - lease               an issue in it holds its files against the others, and carries the lease: set writes Since
//                       (and Branch, Worker, Worktree when given) on a move into it, and leaving it removes the lease
//                       (built-in: in-progress);
// - settles-dependents  an issue in it does not hold back the issues that wait on it with After (built-in: done,
//                       dropped);
// - terminal            the issue is finished business for the loop: list hides it by default, and close and archive
//                       do not wait for it (built-in: done, dropped, deferred);
// - closes-record       moving into it passes the done gate — evidence and a live approve — and review, report and
//                       status count it as done work (built-in: done);
// - needs-reason        a move into it needs a reason, written under Evidence as "<Status>: <why>" (built-in: dropped,
//                       deferred).
// A status is at most one of dispatchable, lease and terminal; closes-record is terminal too.
// STATUS_FLAGS keeps the name the record contract holds for the lease flag; a profile may write that name or lease,
// and both mean the one flag. flagWord gives the name a message or a description prints: lease.
export const STATUS_FLAGS = Object.freeze(['dispatchable', 'holds-claim', 'settles-dependents', 'terminal', 'closes-record', 'needs-reason']);
const flagOf = (f) => (f === 'lease' ? 'holds-claim' : f);
export const flagWord = (f) => (f === 'holds-claim' ? 'lease' : f);
export const BUILTIN_STATUSES = {
  open: ['dispatchable'],
  'in-progress': ['holds-claim'],
  done: ['settles-dependents', 'terminal', 'closes-record'],
  dropped: ['settles-dependents', 'terminal', 'needs-reason'],
  deferred: ['terminal', 'needs-reason'],
};
export const PROFILE_VERSION = 1;
// The keys a profile file may hold. A key this list does not name is refused, so a profile written for a later
// Jarl fails loudly here instead of being half-read.
export const PROFILE_KEYS = ['jarl-profile', 'format', 'name', 'statuses', 'initial', 'fields', 'sections', 'acceptance-heading', 'external-scheduler', 'done-gate', 'lifecycle'];
export const PROFILE_FIELD_KEYS = ['enum', 'default', 'required'];
// A status written as an object instead of a list of flags: { "flags": [...], "set-by": "record" | "any" }.
export const PROFILE_STATUS_KEYS = ['flags', 'set-by'];
// Who may move an issue into a status: anyone ('any', the default), or only a library call through record.mjs
// ('record') — the command line and the MCP tools are refused, so a composer's own gate (a veto held by one of its roles) cannot
// be walked around with a set.
export const SET_BY = ['any', 'record'];
// Who may end the loop itself: "lifecycle": { "close": "any" | "record", "archive": "any" | "record", "command": "<the
// composer's own command>" }. 'record' refuses jarl close / jarl archive and their MCP tools (caller 'cli') and names the
// command, so the record of a loop a composer keeps is never removed or moved out from under it by
// Jarl's own lifecycle; a library caller (caller 'record') still may. The same two words as "set-by".
export const LIFECYCLE_KEYS = ['close', 'archive', 'command'];
export const LIFECYCLE_OPS = ['close', 'archive'];
export const DEFAULT_LIFECYCLE = Object.freeze({ close: 'any', archive: 'any', command: null });
// The format of the record (the issue files, the log, the rulings) this Jarl reads and writes. A profile may state the
// format it was written for; one this Jarl does not know is refused before anything else, so a vendored copy and an
// installed Jarl that drifted apart stop loudly instead of half-reading each other's loop.
// Format 1 is a loop whose profile names no format, or that has no profile. A loop is raised, by needFormat, by the
// first write of a line of FORMAT_LINES, to that line's format, which a reader that knows only the formats below it
// would misread in silence; such a reader refuses the loop instead. Format 2 holds a repository name in Repo, a number
// written plain and a retraction; format 3 holds everything format 2 holds and the lines of format 3 below. A loop
// whose profile names an external scheduler is run by a composer that reads the record with its own copy of the
// library, so Jarl never raises its format: its profile says the format the composer reads, and until then the lines of
// every higher format are off in that loop.
export const RECORD_FORMAT = 1;
export const RECORD_FORMATS = Object.freeze([1, 2, 3]);
export const RECORD_FORMAT_RAISED = 2;
// The lines of the record a reader that knows only the formats below a line's own would misread in silence, by name:
// the format that holds them, what the line is, where the record writes it, and what such a reader would make of it. A
// write of one calls needFormat with its name, under the write's lock and before the line is written.
const LINES_OF = (format, lines) => Object.entries(lines).map(([name, line]) => [name, Object.freeze({ format, ...line })]);
export const FORMAT_LINES = Object.freeze(Object.fromEntries([
  ...LINES_OF(2, {
    'repo-name': { what: 'a repository name', where: "the issue's Repo field", misread: 'reads the name as a path under the root of the loop' },
    'plain-number': { what: 'a number written plain, below 100 or of 1000 or more', where: 'the name and the header of an issue file, the number of a question, and every line that names them', misread: 'does not read the issue or the question the number names' },
    retraction: { what: 'the retraction of a verdict or an evidence row', where: 'the log, and the struck entry of the issue', misread: 'goes on counting the approve or the row' },
  }),
  ...LINES_OF(3, {
    'issue-key': { what: "an issue's key", where: "the issue's header, its filed line and every log line about it", misread: 'reads each line by its number alone, so the moves of two issues that took one number are mixed' },
    writer: { what: 'the writer of a write', where: 'the log line of the write, in a fixed place', misread: 'does not place the line, so a lease or a verdict is read without the agent that wrote it' },
    'owner-line': { what: 'an acceptance line only the owner ticks', where: "the issue's acceptance", misread: 'lets done pass while the line is not ticked' },
    parent: { what: 'the parent of a sub-issue', where: "the sub-issue's header", misread: 'reads the backlog as flat and offers a parent as work of its own' },
    batch: { what: 'one verdict over several issues', where: 'the verdict line of each issue it covers', misread: 'counts one review as several' },
    'promise-wait': { what: 'the kinds promise and wait', where: "the issue's header", misread: 'refuses an issue of a kind it does not know' },
    escalation: { what: 'a question of kind escalation', where: 'the question, among the loop\'s questions', misread: 'refuses a question of a kind it does not know' },
    'rule-proposal': { what: 'a question of kind rule', where: 'the question, among the loop\'s questions', misread: 'reads a proposed rule as a question to the owner and its answer as a ruling with no scope' },
    'note-retraction': { what: 'the retraction of a note', where: "the log and the issue's notes, in the shape of a row's retraction", misread: 'counts the note as standing' },
  }),
]));
// The record format of a loop as the views say it: its format, the formats this Jarl reads, whether a write may raise it
// (never under an external scheduler) and, when it may not, the names of the lines of FORMAT_LINES that are off in it.
export function formatState(profile) {
  const raises = profile.scheduler === null || profile.scheduler === undefined;
  const off = raises ? [] : Object.keys(FORMAT_LINES).filter((name) => FORMAT_LINES[name].format > profile.format);
  return { format: profile.format, reads: [...RECORD_FORMATS], raises, off };
}
// The line a view prints when lines of FORMAT_LINES are off in the loop, or null: each with the format that holds it.
function formatOffText(state) {
  if (!state.off.length) return null;
  return `record format ${state.format}: the profile names an external scheduler, so Jarl never raises it, and these lines are off in this loop until the profile says the format that holds them — ${state.off.map((name) => `${FORMAT_LINES[name].what} (format ${FORMAT_LINES[name].format})`).join(', ')}`;
}
// The width a new issue or question number is written in, when its caller names none: three digits, which every format
// reads, in a loop below format 2 that Jarl never raises; else the caller's (none: the number written plain).
function numberWidth(profile, width) {
  return width ?? (!formatState(profile).raises && profile.format < RECORD_FORMAT_RAISED ? 3 : undefined);
}
// The done gate a loop runs on: the built-in one (approve: fresh — a live approve by someone other than the worker,
// from a fresh reviewer when the issue carries code) and no merge required. A profile may ask for a landed merge
// (requires-merged) and, only with it, give up the approve (approve: none): the merge gate that landed it is then the
// check, and Jarl records what it did. "requires-slots" names, per kind of issue, the attachments the issue must carry
// before it is done, and "slots" declares each one: { "place": "attachments/<id>/before.*", "extensions": ["png"],
// "min-size": 1000 } (see the attachments section).
export const DONE_GATE_KEYS = ['approve', 'requires-merged', 'requires-slots', 'slots'];
export const SLOT_KEYS = ['place', 'extensions', 'min-size'];
// The largest file an attachment may be: a file over it is refused, never hashed.
export const ATTACH_MAX_BYTES = 64 * 1024 * 1024;
const SLOT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SLOT_EXT_RE = /^[a-z0-9]{1,10}$/;
export const DONE_GATE_APPROVE = ['fresh', 'none'];
export const DEFAULT_DONE_GATE = Object.freeze({ approve: 'fresh', 'requires-merged': false });
// Header fields the tool itself writes and reads: a profile cannot declare them. Kind and Tier are built in too, but
// a profile may declare them to replace their values (an enum, and a default).
export const TOOL_FIELDS = ['Status', 'Priority', 'Tags', 'Files', 'Repo', 'After', 'Found by', 'Source', 'Where', 'Branch', 'Worker', 'Worktree', 'Since', 'Merged', 'Merge check', 'CI', 'Resources'];
// The fields of a wait, Person and Check when, which the tool writes beside the kinds promise and wait. A profile that
// declares a field of either name, or its own Kind values, keeps its own meaning when its loop is read: the built-in
// promise and wait are off in that loop. A profile file given to init or to profile <file> is refused when it declares
// either field or names promise or wait among its kinds (see reservedNamesProblem).
export const KEPT_FIELDS = ['Person', 'Check when'];
// The field an issue's key is written in. A profile file given to init or to profile <file> that declares a field of that
// name is refused; a loop already open with such a profile keeps its own field, and its issues get no key of the tool's.
export const KEY_FIELD = 'Key';
// The field a sub-issue names its parent in. A profile file given to init or to profile <file> that declares a field of
// that name is refused; a loop already open with such a profile keeps its own field, and its issues form no tree.
export const PARENT_FIELD = 'Parent';
export const BUILTIN_SECTIONS = ['What', 'Why', 'Acceptance', 'Changelog', 'Evidence'];
// The names a section of a profile may not take: a header field of the tool's own (field writes it under that name, so a
// section of the same name would hide it) and the parts the tool writes (a section of that name would let field overwrite
// the history the file shows). A profile file given to init or to profile <file> that declares a section of such a name is
// refused; a loop already open with such a profile keeps its own section.
export const RESERVED_SECTION_NAMES = Object.freeze([...new Set([...TOOL_FIELDS, 'Title', 'Kind', 'Tier', 'Model', 'Parent', 'Key', ...KEPT_FIELDS, ...BUILTIN_SECTIONS, 'Notes', 'Reviews', 'Proof'])]);
export const PROFILE_FIELD_RE = /^[A-Za-z][A-Za-z0-9 -]{0,39}$/;
export const PROFILE_STATUS_RE = /^[a-z][a-z0-9-]{0,39}$/;
// Names a status may not take: the words status and resume already print for something else (the counts line's
// "waiting", "ready", "in flight", "questions", "to ratify") and the lower-case keys of status --json, so a count and a
// view can never be read for one another.
export const RESERVED_STATUS_NAMES = ['waiting', 'ready', 'in-flight', 'questions', 'ratify', 'to-ratify', 'goal', 'opened', 'archived', 'stale', 'handoff', 'reviews', 'uncommitted', 'by', 'statuses'];
const PROFILE_SECTION_RE = /^[A-Za-z][A-Za-z0-9 _-]{0,59}$/;
const PROFILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export function profilePath(root) { return join(jarlDir(root), 'profile.json'); }

// A profile file checked whole against the schema above; every problem is named at once. Returns the profile as
// the tool uses it (see makeProfile).
export function validateProfile(json, where = 'the profile') {
  const bad = [];
  const say = (m) => bad.push(m);
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const oneLine = (v) => typeof v === 'string' && v.trim() !== '' && !/[\r\n]/.test(v);
  if (!isObj(json)) refuse(`${where} is not a JSON object`, ['jarl.mjs', 'profile', '<profile.json>']);
  // The record format first, and alone: a profile written for another format may mean anything by its other keys.
  if (json.format !== undefined && !RECORD_FORMATS.includes(json.format)) {
    refuse(`${where} is written for record format ${JSON.stringify(json.format)}, and this Jarl reads format ${RECORD_FORMATS.join(', ')} — nothing was read or written; the reader needs a Jarl that knows format ${JSON.stringify(json.format)} (a vendored copy and the installed one must agree)`, afterView(['jarl.mjs', '--version']));
  }
  // The format marker: a profile that holds only jarl-profile and format changes nothing in how the loop behaves (the
  // built-in profile, declared: false); it only says which format the record was written in.
  if (Object.keys(json).length === 2 && json['jarl-profile'] === PROFILE_VERSION && json.format !== undefined) {
    return makeProfile({ name: 'built-in', statuses: Object.entries(BUILTIN_STATUSES), initial: 'open', declared: false, format: json.format });
  }
  for (const k of Object.keys(json)) if (!PROFILE_KEYS.includes(k)) say(`unknown key "${k}" — a profile takes ${PROFILE_KEYS.join(', ')}`);
  if (json['jarl-profile'] !== PROFILE_VERSION) say(`"jarl-profile" must be ${PROFILE_VERSION} (the profile format this Jarl reads)`);
  if (json.name !== undefined && !(typeof json.name === 'string' && PROFILE_NAME_RE.test(json.name))) say('"name" is letters, digits and . _ - (starting with a letter or digit, at most 80 characters)');
  // statuses: { "<name>": ["<flag>", ...] }, in the order they are shown.
  // A status is a list of flags, or { "flags": [...], "set-by": "record" } when it says who may move an issue into it.
  const statuses = [];
  const flagsOf = new Map();
  const setBy = new Map();
  if (!isObj(json.statuses) || !Object.keys(json.statuses).length) say('"statuses" must be an object naming at least one status: { "<status>": ["<a-flag-it-takes-or-none>", ...] }');
  else {
    for (const [name, spec] of Object.entries(json.statuses)) {
      if (!PROFILE_STATUS_RE.test(name)) { say(`status "${name}" must be lower-case letters, digits and - (starting with a letter, at most 40 characters)`); continue; }
      if (RESERVED_STATUS_NAMES.includes(name)) { say(`status "${name}" is a name the views use for something else — the reserved names are ${RESERVED_STATUS_NAMES.join(', ')}`); continue; }
      let flags = spec;
      if (isObj(spec)) {
        const unknown = Object.keys(spec).filter((k) => !PROFILE_STATUS_KEYS.includes(k));
        if (unknown.length) { say(`status "${name}": unknown key "${unknown[0]}" — a status written as an object takes ${PROFILE_STATUS_KEYS.join(', ')}`); continue; }
        if (spec['set-by'] !== undefined && !SET_BY.includes(spec['set-by'])) { say(`status "${name}": "set-by" is one of ${SET_BY.join(', ')} (record: only a library call through record.mjs moves an issue into it, never jarl set)`); continue; }
        flags = spec.flags === undefined ? [] : spec.flags;
        setBy.set(name, spec['set-by'] || 'any');
      }
      if (!Array.isArray(flags) || !flags.every((f) => typeof f === 'string')) { say(`status "${name}" takes a list of flags (${STATUS_FLAGS.map(flagWord).join(', ')}), [] for none — or { "flags": [...], "set-by": "record" }`); continue; }
      flags = flags.map(flagOf);
      for (const f of flags) if (!STATUS_FLAGS.includes(f)) say(`status "${name}": unknown flag "${f}" — the flags are ${STATUS_FLAGS.map(flagWord).join(', ')}`);
      if (new Set(flags).size !== flags.length) say(`status "${name}" names a flag twice`);
      const set = new Set(flags);
      if (['dispatchable', 'holds-claim', 'terminal'].filter((f) => set.has(f)).length > 1) say(`status "${name}" is at most one of dispatchable, lease and terminal`);
      if (set.has('closes-record') && !set.has('terminal')) say(`status "${name}" is closes-record, so it must be terminal too`);
      statuses.push(name);
      flagsOf.set(name, set);
    }
    const some = (f) => statuses.some((s) => flagsOf.get(s).has(f));
    if (statuses.length && !some('dispatchable')) say('no status is dispatchable — next would never offer anything');
    if (statuses.length && !some('holds-claim')) say('no status is a lease — no issue could ever be worked on');
    if (statuses.length && !some('terminal')) say('no status is terminal — the loop could never close');
    if (statuses.length && !some('settles-dependents')) say('no status settles-dependents — an issue waiting on another with After would wait for good');
  }
  let initial = statuses[0];
  if (json.initial !== undefined) {
    if (!statuses.includes(json.initial)) say(`"initial" must name one of the statuses (${statuses.join(', ')})`);
    else initial = json.initial;
  }
  if (initial && flagsOf.get(initial) && (flagsOf.get(initial).has('terminal') || flagsOf.get(initial).has('holds-claim'))) say(`a new issue starts in "${initial}", which is ${flagsOf.get(initial).has('terminal') ? 'terminal' : 'a lease'} — name another with "initial"`);
  // fields: { "<Name>": { enum?, default?, required? } }
  const fields = [];
  if (json.fields !== undefined && !isObj(json.fields)) say('"fields" must be an object: { "<name>": { "enum": [...], "default": "...", "required": true } }');
  for (const [name, spec] of Object.entries(isObj(json.fields) ? json.fields : {})) {
    if (!PROFILE_FIELD_RE.test(name) || name !== name.trim()) { say(`field "${name}" must be letters, digits, spaces and - (starting with a letter, at most 40 characters)`); continue; }
    if (TOOL_FIELDS.some((t) => t.toLowerCase() === name.toLowerCase())) { say(`field "${name}" is one the tool writes itself — a profile cannot declare it; rename the field in the profile, because the tool writes ${name} itself`); continue; }
    if (statuses.includes(name.toLowerCase())) { say(`field "${name}" has the name of a status — set <id> ${name.toLowerCase()} would be ambiguous`); continue; }
    if (fields.some((f) => f.key === name.toLowerCase())) { say(`field "${name}" is declared twice (names are compared without case)`); continue; }
    if (!isObj(spec)) { say(`field "${name}" takes an object: { "enum": [...], "default": "...", "required": true } ({} for a free one-line value)`); continue; }
    for (const k of Object.keys(spec)) if (!PROFILE_FIELD_KEYS.includes(k)) say(`field "${name}": unknown key "${k}" — a field takes ${PROFILE_FIELD_KEYS.join(', ')}`);
    const builtin = ['kind', 'tier'].includes(name.toLowerCase());
    let values = null;
    if (spec.enum !== undefined) {
      if (!Array.isArray(spec.enum) || !spec.enum.length || !spec.enum.every(oneLine) || spec.enum.some((v) => v.includes(','))) say(`field "${name}": "enum" is a non-empty list of one-line values without commas`);
      else if (new Set(spec.enum).size !== spec.enum.length) say(`field "${name}": "enum" names a value twice`);
      else values = spec.enum.map((v) => v.trim());
    } else if (builtin) say(`field "${name}" is built in: declaring it means giving its values — "enum": [...]`);
    if (spec.default !== undefined) {
      if (!oneLine(spec.default)) say(`field "${name}": "default" is a one-line value`);
      else if (values && !values.includes(spec.default.trim())) say(`field "${name}": "default" "${spec.default}" is not one of its enum values`);
    }
    if (spec.required !== undefined && typeof spec.required !== 'boolean') say(`field "${name}": "required" is true or false`);
    if (builtin && spec.required !== undefined) say(`field "${name}" is built in and always written — "required" has no meaning for it`);
    fields.push({ name: builtin ? name.charAt(0).toUpperCase() + name.slice(1).toLowerCase() : name, key: name.toLowerCase(), enum: values, default: oneLine(spec.default) ? spec.default.trim() : null, required: spec.required === true, builtin });
  }
  // sections: ["<Heading>", ...] beyond What, Why, Acceptance, Changelog and Evidence.
  const sections = [];
  if (json.sections !== undefined && !(Array.isArray(json.sections) && json.sections.every((s) => typeof s === 'string'))) say('"sections" must be a list of headings');
  for (const s of Array.isArray(json.sections) ? json.sections.filter((x) => typeof x === 'string') : []) {
    if (!PROFILE_SECTION_RE.test(s) || s !== s.trim()) say(`section "${s}" must be letters, digits, spaces, _ and - (starting with a letter, at most 60 characters)`);
    else if (BUILTIN_SECTIONS.some((b) => b.toLowerCase() === s.toLowerCase())) say(`section "${s}" is built in — declare only the extra ones`);
    else if (sections.some((x) => x.toLowerCase() === s.toLowerCase())) say(`section "${s}" is declared twice (headings are compared without case)`);
    else sections.push(s);
  }
  // acceptance-heading: the heading this loop's issues keep their acceptance under, read as ## Acceptance is.
  let acceptance = null;
  if (json['acceptance-heading'] !== undefined) {
    const h = json['acceptance-heading'];
    if (!oneLine(h) || h !== h.trim() || /^#/.test(h) || h.length > 80) say('"acceptance-heading" is a one-line heading (without the ##, at most 80 characters)');
    else if ([...BUILTIN_SECTIONS.filter((b) => b !== 'Acceptance'), ...sections].some((b) => b.toLowerCase() === h.toLowerCase())) say(`"acceptance-heading" "${h}" is already the heading of another section`);
    else if (h.toLowerCase() !== 'acceptance') acceptance = h;
  }
  // external-scheduler: the command the loop's own scheduler is run by, shown in place of what next and queue compute.
  let scheduler = null;
  if (json['external-scheduler'] !== undefined) {
    const x = json['external-scheduler'];
    if (!oneLine(x) || x.length > 200) say('"external-scheduler" is the one-line command that schedules this loop\'s work (at most 200 characters), shown by next, queue, status and resume in place of their own ready list');
    else scheduler = x.trim();
  }
  // done-gate: { "approve": "fresh" | "none", "requires-merged": true | false }.
  let doneGate = DEFAULT_DONE_GATE;
  if (json['done-gate'] !== undefined) {
    const g = json['done-gate'];
    if (!isObj(g)) say('"done-gate" is an object: { "approve": "fresh" or "none", "requires-merged": true or false }');
    else {
      const before = bad.length;
      for (const k of Object.keys(g)) if (!DONE_GATE_KEYS.includes(k)) say(`"done-gate": unknown key "${k}" — it takes ${DONE_GATE_KEYS.join(', ')}`);
      if (g.approve !== undefined && !DONE_GATE_APPROVE.includes(g.approve)) say(`"done-gate": "approve" is one of ${DONE_GATE_APPROVE.join(', ')}`);
      if (g['requires-merged'] !== undefined && typeof g['requires-merged'] !== 'boolean') say('"done-gate": "requires-merged" is true or false');
      const gate = { approve: g.approve ?? DEFAULT_DONE_GATE.approve, 'requires-merged': g['requires-merged'] ?? DEFAULT_DONE_GATE['requires-merged'] };
      if (g['requires-slots'] !== undefined || g.slots !== undefined) {
        const kindField = fields.find((f) => f.key === 'kind');
        Object.assign(gate, validateSlots(g, kindField && kindField.enum ? kindField.enum : KINDS, say));
      }
      if (gate.approve === 'none' && gate['requires-merged'] !== true) say('"done-gate": "approve": "none" is allowed only with "requires-merged": true — with neither an approve nor a landed merge, nothing would stand behind a closed issue');
      if (bad.length === before) doneGate = Object.freeze(gate);
    }
  }
  // lifecycle: { "close": "any" | "record", "archive": "any" | "record", "command": "<one line>" }.
  let lifecycle = DEFAULT_LIFECYCLE;
  if (json.lifecycle !== undefined) {
    const l = json.lifecycle;
    if (!isObj(l)) say('"lifecycle" is an object: { "close": "any" or "record", "archive": "any" or "record", "command": "<the-command-of-the-tool-that-runs-this-loop>" }');
    else {
      const before = bad.length;
      for (const k of Object.keys(l)) if (!LIFECYCLE_KEYS.includes(k)) say(`"lifecycle": unknown key "${k}" — it takes ${LIFECYCLE_KEYS.join(', ')}`);
      for (const op of LIFECYCLE_OPS) if (l[op] !== undefined && !SET_BY.includes(l[op])) say(`"lifecycle": "${op}" is one of ${SET_BY.join(', ')} (record: jarl ${op} and its MCP tool refuse, and the composer does it with its own command)`);
      if (l.command !== undefined && (!oneLine(l.command) || l.command.length > 200)) say('"lifecycle": "command" is the one-line command (at most 200 characters) that closes or archives this loop instead, named by the refusal');
      if (bad.length === before) lifecycle = Object.freeze({ close: l.close ?? 'any', archive: l.archive ?? 'any', command: l.command === undefined ? null : l.command.trim() });
    }
  }
  if (bad.length) refuse(`${where} is not a valid profile:\n- ${bad.join('\n- ')}`, ['jarl.mjs', 'profile', '<profile.json>']);
  return makeProfile({ name: json.name || 'custom', statuses: statuses.map((s) => [s, [...flagsOf.get(s)]]), initial, fields, sections, acceptance, declared: true, setBy, scheduler, doneGate, lifecycle, format: json.format ?? RECORD_FORMAT });
}

// The "requires-slots" and "slots" keys of a done gate, checked against the kinds the profile allows: every problem goes to
// `say`, and the frozen { "requires-slots", slots } is returned (a slot's "min-size" is 1 when the profile names none).
function validateSlots(g, kinds, say) {
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const out = {};
  const required = new Set();
  if (g['requires-slots'] === undefined) say('"done-gate": "slots" needs "requires-slots": the kinds of issue that must carry them');
  else if (!isObj(g['requires-slots'])) say('"done-gate": "requires-slots" is an object: { "<kind>": ["<slot>", ...] }');
  else if (!Object.keys(g['requires-slots']).length) say('"requires-slots" names at least one kind of issue: { "<kind>": ["<slot>", ...] }');
  else {
    const table = {};
    for (const [kind, names] of Object.entries(g['requires-slots'])) {
      if (!kinds.includes(kind)) { say(`"requires-slots": kind "${kind}" is not one of ${kinds.join(', ')}`); continue; }
      if (!Array.isArray(names) || !names.length || !names.every((n) => typeof n === 'string')) { say(`"requires-slots": kind "${kind}" names at least one slot, as a list of names`); continue; }
      const seen = [];
      for (const n of names) {
        if (!SLOT_NAME_RE.test(n)) say(`"requires-slots": slot name "${n}" is lower-case letters, digits and - (starting with a letter or digit, at most 40 characters)`);
        else if (seen.includes(n)) say(`"requires-slots": kind "${kind}" names slot "${n}" twice`);
        else { seen.push(n); required.add(n); }
      }
      table[kind] = Object.freeze(seen);
    }
    out['requires-slots'] = Object.freeze(table);
  }
  const declared = g.slots === undefined ? {} : g.slots;
  if (g.slots !== undefined && !isObj(g.slots)) say('"done-gate": "slots" is an object: { "<slot>": { "place": "attachments/<id>/before.*", "extensions": ["png"], "min-size": 1000 } }');
  const slots = {};
  for (const [name, spec] of Object.entries(isObj(declared) ? declared : {})) {
    const at = `"slots": slot "${name}"`;
    if (!SLOT_NAME_RE.test(name)) { say(`"slots": slot name "${name}" is lower-case letters, digits and - (starting with a letter or digit, at most 40 characters)`); continue; }
    if (!isObj(spec)) { say(`${at} takes an object: { "place": "...", "extensions": [...], "min-size": 1 }`); continue; }
    for (const k of Object.keys(spec)) if (!SLOT_KEYS.includes(k)) say(`${at}: unknown key "${k}" — a slot takes ${SLOT_KEYS.join(', ')}`);
    const place = spec.place;
    const parts = typeof place === 'string' ? place.split('/') : [];
    if (typeof place !== 'string' || place === '' || place.length > 200 || /[\s\\\x00-\x1f]/.test(place) || place.startsWith('/') || parts.some((p) => p === '' || p === '.' || p === '..')) say(`${at}: "place" is a relative path under the loop root, without whitespace, backslash, an empty segment, . or .. — for example "attachments/<id>/${name}.*" (<id> stands for the issue's number)`);
    else if (parts.slice(0, -1).some((p) => p.includes('*')) || place.split('*').length > 2) say(`${at}: "place" holds at most one *, and only in the last segment`);
    const exts = spec.extensions;
    if (!Array.isArray(exts) || !exts.length || !exts.every((e) => typeof e === 'string' && SLOT_EXT_RE.test(e))) say(`${at}: "extensions" is a non-empty list of lower-case extensions without the dot, such as ["png", "jpg"]`);
    const min = spec['min-size'] === undefined ? 1 : spec['min-size'];
    if (!Number.isInteger(min) || min < 1 || min > ATTACH_MAX_BYTES) say(`${at}: "min-size" is a whole number of bytes, at least 1 and at most ${ATTACH_MAX_BYTES}`);
    if (g['requires-slots'] !== undefined && isObj(g['requires-slots']) && !required.has(name)) say(`"slots": "${name}" is declared and no kind requires it`);
    slots[name] = Object.freeze({ place, extensions: Object.freeze(Array.isArray(exts) ? [...new Set(exts)] : []), 'min-size': min });
  }
  for (const n of required) if (!Object.prototype.hasOwnProperty.call(slots, n) && isObj(declared)) say(`"requires-slots": slot "${n}" has no entry in "slots"`);
  out.slots = Object.freeze(slots);
  return out;
}

// The profile as the tool reads it: flags looked up by status, the values Kind and Tier may take and their defaults,
// the declared fields in order.
function makeProfile({ name, statuses, initial, fields = [], sections = [], acceptance = null, declared, setBy = new Map(), scheduler = null, doneGate = DEFAULT_DONE_GATE, lifecycle = DEFAULT_LIFECYCLE, format = RECORD_FORMAT }) {
  const flags = new Map(statuses.map(([s, f]) => [s, new Set(f)]));
  const kind = fields.find((f) => f.key === 'kind');
  const tier = fields.find((f) => f.key === 'tier');
  // The built-in promise and wait hold in a loop whose profile declares neither their fields nor kinds of its own; a
  // profile that declares Person or Check when keeps its field, and the two kinds are not among its kinds.
  const ownWords = fields.filter((f) => KEPT_FIELDS.some((k) => k.toLowerCase() === f.key)).map((f) => f.name);
  const kept = !kind && !ownWords.length;
  // Whether new writes the tool's key here: never where the profile declares a field Key of its own.
  const keyed = !fields.some((f) => f.key === KEY_FIELD.toLowerCase());
  // Whether the issues of the loop form a tree through the tool's Parent field: never where the profile declares its own.
  const tree = !fields.some((f) => f.key === PARENT_FIELD.toLowerCase());
  const kinds = kind ? kind.enum : kept ? KINDS : KINDS.filter((k) => !KEPT_KINDS.includes(k));
  const tiers = tier ? tier.enum : TIERS;
  const p = {
    name, declared, initial, sections, acceptance,
    // The record format, the command of an external scheduler (null: next and queue compute their own), the done gate.
    format, scheduler, doneGate,
    // Who may close and archive the loop ('any', or 'record': never jarl close / archive), and the composer's command.
    lifecycle,
    statuses: statuses.map(([s]) => s),
    kinds, kindDefault: kind && kind.default ? kind.default : kinds[0],
    // Whether the built-in promise and wait hold here, and the kept kind an issue's kind is (null for any other, and
    // for every kind of a loop where they are off: a kind of the profile's own named wait is its own).
    keyed, tree, kept, keptKind: (k) => (kept && KEPT_KINDS.includes(k) ? k : null),
    tiers, tierDefault: tier ? (tier.default || tiers[0]) : TIER_DEFAULT,
    // The fields the profile adds to the header (Kind and Tier are written in their fixed places).
    fields: fields.filter((f) => !f.builtin),
    declaredFields: fields,
    is: (status, flag) => Boolean(flags.get(status)?.has(flag)),
    with: (flag) => statuses.map(([s]) => s).filter((s) => flags.get(s).has(flag)),
    flagsOf: (status) => [...(flags.get(status) || [])],
    // Who may move an issue into the status: 'any', or 'record' (a library call only, never jarl set).
    setBy: (status) => setBy.get(status) || 'any',
  };
  // In play: offered or worked on (built-in: open, in-progress).
  p.active = (s) => p.is(s, 'dispatchable') || p.is(s, 'holds-claim');
  // Not finished: a status the profile names that is not terminal — in play, or one an issue waits in (a proposal
  // not yet accepted, a block). A status the profile does not name (a hand-edited file) is neither.
  p.unfinished = (s) => flags.has(s) && !flags.get(s).has('terminal');
  p.field = (name) => fields.find((f) => f.key === String(name).toLowerCase()) || null;
  return p;
}

// Frozen, with every list it holds: it is shared by every loop without a profile, and record.mjs hands it out.
export const DEFAULT_PROFILE = freezeProfile(makeProfile({ name: 'built-in', statuses: Object.entries(BUILTIN_STATUSES), initial: 'open', declared: false }));
function freezeProfile(p) {
  for (const v of Object.values(p)) if (Array.isArray(v)) { v.forEach((x) => (x && typeof x === 'object' ? Object.freeze(x) : x)); Object.freeze(v); }
  return Object.freeze(p);
}

// The loop's profile: .jarl/profile.json when there is one, else the built-in. Read once per state of the file (a
// command reads it many times). A profile file that does not validate is a refusal, never a silent fallback.
const PROFILES = new Map();
export function loadProfile(root) { return profileAt(jarlDir(root)); }
// The profile of the record held in `dir` (a loop's .jarl/, or an archived loop's directory).
export function profileAt(dir) {
  const path = join(dir, 'profile.json');
  let st;
  try { st = statSync(path); } catch { return DEFAULT_PROFILE; }
  const key = `${st.mtimeMs} ${st.size}`;
  const hit = PROFILES.get(path);
  if (hit && hit.key === key) return hit.profile;
  let json;
  try { json = JSON.parse(readText(path)); } catch (e) { refuse(`${path} is not JSON: ${e.message}`, afterView(['jarl.mjs', 'profile'])); }
  const profile = validateProfile(json, path);
  PROFILES.set(path, { key, profile });
  return profile;
}
// A write of the profile file by this process: the next read reads it again, even when the file kept its size and the
// clock did not move between the two writes.
function forgetProfile(root) { PROFILES.delete(profilePath(root)); }
// The file is init's --profile, or the argument of profile (`argument`): a refusal's form puts the path where it was given.
export function readProfileFile(file, { argument = false } = {}) {
  const where = () => (argument ? { arg: 0, value: '<profile.json>' } : { flag: '--profile', value: '<profile.json>' });
  need(typeof file === 'string' && file.trim(), argument ? 'profile checks the profile file its argument names: give its path' : '--profile needs the path of a profile file', where);
  need(existsSync(file), `no such profile file: ${file}`, where);
  let json;
  try { json = JSON.parse(readText(file)); } catch (e) { refuse(`${file} is not JSON: ${e.message}`, ['jarl.mjs', 'profile', '<profile.json>']); }
  const profile = validateProfile(json, file);
  const reserved = reservedNamesProblem(profile) || keyFieldProblem(profile) || parentFieldProblem(profile) || sectionNamesProblem(profile);
  need(!reserved, `${file} is not a valid profile: ${reserved}`, () => afterView(['jarl.mjs', 'profile', file]));
  return { json, profile };
}
// What a profile file to be opened declares of the names the built-in promise and wait use, as one refusal, or null: a
// field named Person or Check when, and promise or wait among its own kinds. A loop already open with such a profile is
// read as it is, with the built-in promise and wait off (see makeProfile).
function reservedNamesProblem(profile) {
  const fields = profile.declaredFields.filter((f) => KEPT_FIELDS.some((k) => k.toLowerCase() === f.key)).map((f) => `the field ${f.name}`);
  const kind = profile.declaredFields.find((f) => f.key === 'kind');
  const kinds = kind && kind.enum ? kind.enum.filter((k) => KEPT_KINDS.includes(k)).map((k) => `the kind ${k}`) : [];
  const named = [...fields, ...kinds];
  if (!named.length) return null;
  return `it declares ${named.join(' and ')}, which Jarl reserves for its own promise and wait — the reserved names are the fields ${KEPT_FIELDS.join(' and ')} and the kinds ${KEPT_KINDS.join(' and ')}; rename them in the profile`;
}

// What a profile file to be opened declares of the name the issue's key is written under, as a refusal, or null.
function keyFieldProblem(profile) {
  const own = profile.declaredFields.find((f) => f.key === KEY_FIELD.toLowerCase());
  return own ? `it declares the field ${own.name}, which Jarl reserves for an issue's key — rename it in the profile` : null;
}
// What a profile file to be opened declares of the names a section may not take (RESERVED_SECTION_NAMES), as a refusal, or null.
function sectionNamesProblem(profile) {
  const named = profile.sections.filter((s) => RESERVED_SECTION_NAMES.some((r) => r.toLowerCase() === s.toLowerCase()));
  if (!named.length) return null;
  return `it declares the section ${named.join(' and ')}, which is the name of a header field or of a part Jarl writes itself — the reserved names are ${RESERVED_SECTION_NAMES.join(', ')}; rename ${named.length === 1 ? 'it' : 'them'} in the profile`;
}
// What a profile file to be opened declares of the name a sub-issue's parent is written under, as a refusal, or null.
function parentFieldProblem(profile) {
  const own = profile.declaredFields.find((f) => f.key === PARENT_FIELD.toLowerCase());
  return own ? `it declares the field ${own.name}, which Jarl reserves for the parent of a sub-issue — rename it in the profile` : null;
}

// The profile described, for `profile` and for a reader deciding whether a file is right.
export function describeProfile(p) {
  return {
    name: p.name, declared: p.declared, initial: p.initial,
    statuses: p.statuses.map((s) => ({ name: s, flags: p.flagsOf(s).map(flagWord), ...(p.setBy(s) !== 'any' ? { setBy: p.setBy(s) } : {}) })),
    fields: p.declaredFields ? p.declaredFields.map((f) => ({ name: f.name, enum: f.enum, default: f.default, required: f.required })) : [],
    kinds: p.kinds, tiers: p.tiers, sections: p.sections, acceptanceHeading: p.acceptance || 'Acceptance',
    format: p.format, externalScheduler: p.scheduler, doneGate: { ...p.doneGate }, lifecycle: { ...p.lifecycle },
  };
}
export function renderProfile(d) {
  const lines = [`profile ${d.name}${d.declared ? '' : ' (no .jarl/profile.json: the built-in one)'}`, 'statuses:'];
  for (const s of d.statuses) lines.push(`  ${s.name}${s.name === d.initial ? ' (initial)' : ''}${s.flags.length ? `  ${s.flags.join(', ')}` : ''}${s.setBy === 'record' ? '  (set by the record only, never jarl set)' : ''}`);
  lines.push(`kind: ${d.kinds.join(' | ')}`, `tier: ${d.tiers.join(' | ')}`);
  const own = d.fields.filter((f) => !['kind', 'tier'].includes(f.name.toLowerCase()));
  if (own.length) lines.push('fields:', ...own.map((f) => `  ${f.name}${f.enum ? `: ${f.enum.join(' | ')}` : ''}${f.default ? ` (default ${f.default})` : ''}${f.required ? ' (required)' : ''}`));
  if (d.sections.length) lines.push(`sections: ${d.sections.join(', ')}`);
  if (d.acceptanceHeading !== 'Acceptance') lines.push(`acceptance heading: ${d.acceptanceHeading}`);
  if (d.externalScheduler) lines.push(`external scheduler: ${d.externalScheduler} (next and queue show it instead of their own list)`);
  if (d.doneGate.approve !== 'fresh' || d.doneGate['requires-merged']) lines.push(`done gate: approve ${d.doneGate.approve}${d.doneGate['requires-merged'] ? ' · requires a merge in the base' : ''}`);
  for (const [kind, names] of Object.entries(d.doneGate['requires-slots'] || {})) {
    lines.push(`attachments: ${kind} needs ${names.join(', ')}`);
    for (const n of names) { const s = d.doneGate.slots[n]; if (s) lines.push(`  ${n}: ${s.place} · ${s.extensions.join(', ')} · at least ${s['min-size']} bytes`); }
  }
  const kept = LIFECYCLE_OPS.filter((op) => d.lifecycle[op] === 'record');
  if (kept.length) lines.push(`lifecycle: ${kept.join(' and ')} by the record only, never jarl ${kept.join(' / ')}${d.lifecycle.command ? ` — ${d.lifecycle.command}` : ''}`);
  const state = formatState({ format: d.format, scheduler: d.externalScheduler });
  lines.push(`record format: ${d.format} (this Jarl reads ${state.reads.join(', ')})`);
  if (formatOffText(state)) lines.push(formatOffText(state));
  return lines.join('\n');
}
export function cmdProfile(root, file) {
  if (file !== undefined) return { file, ...describeProfile(readProfileFile(file, { argument: true }).profile) };
  return describeProfile(existsSync(jarlDir(root)) ? loadProfile(root) : DEFAULT_PROFILE);
}

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { SLOT_NAME_RE, forgetProfile, formatOffText, numberWidth };
