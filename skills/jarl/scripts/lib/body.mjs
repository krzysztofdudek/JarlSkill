// The commands that change the description of an issue: body, source and after, and the log lines a change leaves.

import { fieldText, hole, need } from './base.mjs';
import { carryingOwnersWords, needNoOwnersWords } from './owner.mjs';
import { readText, writeAtomic } from './files.mjs';
import { idRe } from './ids.mjs';
import { loadProfile } from './profile.mjs';
import { appendLogLines } from './journal.mjs';
import { acceptanceHeading, acceptanceLines, acceptanceText, bodyText, changelogText, evidenceTable, findIssue, namedPairs, needNoFieldTags, removeFirstField, setField, setSection } from './issues.mjs';
import { lineDigest, lineRowForm, needMarkedLines } from './lines.mjs';
import { listAll } from './shared.mjs';
import { afterList, sourceList, unorderedNotes } from './after.mjs';

// ---- the description of an issue -----------------------------------------------------------------
//
// An issue is its description and its history. Every part of the description (the title, the header fields below, the
// fields a profile declares, the What, Why, Acceptance and Changelog sections and the sections a profile declares) is
// changed by a command, and every change writes one log line that names the part, who changed it and what it held
// before. The history (evidence rows and notes, verdicts, merges, rulings, answers) has no edit at all: a row or an
// approve is taken back by retract, a ruling replaced by decide --supersedes, and the status moves only through set.

// A wait's Person (the outside person it is held by, the name next --as answers to) and its Check when (a date, or the
// event to check after): each one value on one line, without the log's separator.
export function keptValue(name, value) {
  const v = fieldText(value);
  need(typeof value === 'string' && v, `${name} needs a value: ${name === 'Person' ? 'the outside person a wait is held by' : 'when to check a wait, a date or the event to check after'}`, () => ({ replace: String(value ?? ''), value: name === 'Person' ? '<name>' : '<date-or-event>' }));
  need(!/[\r\n]/.test(String(value).trim()), `${name} is one line (got ${JSON.stringify(String(value))})`, () => ({ replace: String(value), value: hole('<value>') }));
  need(!v.includes('·'), `${name} is one value — not a phrase with "·" in it (got "${v}")`, () => ({ replace: String(value), value: hole('<value>') }));
  return v;
}

// The name a description change records as its author, or null when the call names nobody: a write nobody named is
// logged with no author at all, never under a name nobody gave. A name is one name on one line, without the log's
// separator, which would let it be read as more than one segment of the line.
export function editorOf(by) {
  if (by === undefined || by === null) return null;
  const name = fieldText(by);
  need(typeof by === 'string' && name, '--by needs a name: who makes this write', () => ({ flag: '--by', value: '<who>' }));
  need(!/[\r\n]/.test(String(by).trim()), `--by is one name on one line (got ${JSON.stringify(String(by))})`, () => ({ flag: '--by', value: '<one-name>' }));
  need(!name.includes('·'), `--by is one name — not a phrase with "·" in it (got "${name}")`, () => ({ flag: '--by', value: '<one-name>' }));
  return name;
}

// The stand-in a description line writes for the log's separator inside a value, as ⏎ stands in for a line break: the
// value stays readable, and no reader finds a separator in it.
const SEPARATOR_MARK = '∙';

// A value as one segment of a description line: on one line (each break as ⏎), each separator as its stand-in; (none) when empty.
const logValue = (v) => String(v ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean).join(' ⏎ ').replace(/·/g, SEPARATOR_MARK) || '(none)';

const byPart = (by) => (by ? ` · by ${by}` : '');

// The line a change of a header field writes, `<id> field <Name> · <value> · was <old value>[ · by <who>]`, or null when
// the field already holds the value: a change to nothing writes no line. Where is free text of any length, so what it
// held is kept as a section's first line is: at most EXCERPT_CHARS of it, and its length when it is cut. The value it
// holds now is kept the same way.
export function fieldLine(id, name, value, was, by) {
  if (fieldText(value) === fieldText(was)) return null;
  const shown = (v) => (name === 'Where' && fieldText(v).length > EXCERPT_CHARS ? `${logValue(fieldText(v).slice(0, EXCERPT_CHARS))}… (${fieldText(v).length} characters)` : logValue(v));
  return `${id} field ${name} · ${fieldText(value) === '' ? '(cleared)' : shown(value)} · was ${shown(was)}${byPart(by)}`;
}

// The most of a section's first line a body line keeps: the line stays one short line whatever the section holds.
const EXCERPT_CHARS = 120;

// The line a change of the title or of a section writes, `<id> body · <part> · was "<old text>"[ · by <who>]`, or null
// when the part already holds that text. The title is kept whole; a section by its first line (at most EXCERPT_CHARS)
// and its length, so a long section never floods the log.
export function bodyLine(id, part, was, now, by) {
  const old = String(was ?? '').trim();
  if (old === String(now ?? '').trim()) return null;
  if (!old) return `${id} body · ${part} · was (none)${byPart(by)}`;
  if (part === 'title') return `${id} body · ${part} · was "${logValue(old)}"${byPart(by)}`;
  // The lines are kept whole, so the tool can read back what they were at any point: one JSON string, and in it the log's
  // separator written as its escape, so no segment of the line is cut inside the old text.
  if (part === 'acceptance') return `${id} body · ${part} · was ${JSON.stringify(old).replace(/·/g, '\\u00b7')}${byPart(by)}`;
  const first = old.split(/\r\n?|\n/)[0].trim();
  const cut = first.length > EXCERPT_CHARS ? `${first.slice(0, EXCERPT_CHARS)}…` : first;
  return `${id} body · ${part} · was "${logValue(cut)}" (${old.length} characters)${byPart(by)}`;
}


// The note a change of an issue's acceptance prints where a row named a line that is no line now: the row counts for
// nothing, and the new text needs its own proof.
export function rowsLostNote(issue, was, now) {
  const before = new Set(acceptanceLines({ sections: { acceptance: String(was ?? '') } }).map(lineDigest));
  const after = new Set(acceptanceLines({ sections: { acceptance: String(now ?? '') } }).map(lineDigest));
  const named = new Set(evidenceTable(issue.sections.evidence).rows.filter((r) => !r.retracted).flatMap((r) => r.lines));
  const lost = [...before].filter((d) => !after.has(d) && named.has(d)).length;
  return lost ? `note: ${issue.id} holds rows naming ${lost} acceptance line${lost === 1 ? '' : 's'} this change rewrote or removed: a row counts only for the text it named, so the new text needs its own proof: ${lineRowForm(issue.id)}` : null;
}


// The old text a body line quotes. It is the record's own text, and the closing quotation mark bodyLine puts after it
// would turn an honest "on the owner's word." into the shape of the owner's quote.
const quotedOldText = (line) => line.match(/ body · [^·]+ · was (".*")/)?.[1];

// The lines of a description change that are not null, appended in one write; nothing when every part was unchanged.
export function logChanges(root, lines) {
  const kept = lines.filter(Boolean);
  if (kept.length) carryingOwnersWords(kept.map(quotedOldText), () => appendLogLines(root, kept));
}

// What a header field of an issue holds as written, '' when the header has none.
export const heldField = (issue, name) => fieldText(issue.fields[name.toLowerCase()]);

// The items a list section holds, each line without its bullet, for an append to add to.
export const itemsOf = (text) => String(text ?? '').split('\n').map((l) => l.trim().replace(/^-\s+/, '')).filter(Boolean);

// The text a section holds after an append: what it held, then the added text as its own paragraph.
const joinParagraphs = (held, added) => (String(held ?? '').trim() ? `${String(held).trim()}\n\n${added}` : added);

// The body of one issue (the writer of field's title, Where and sections, and of the library's setBody): the title, the
// Where field and the What, Why, Acceptance and Changelog sections, and the profile's sections, set or replaced; with append, the text of each section is added after what it holds. Evidence is never written here:
// it is the record of what was done, appended by evidence, never replaced.
// `dry` checks everything the call would refuse and writes nothing: a list of ids is run dry on every id before the
// first one is written (see eachIssue).
export function cmdBody(root, rawId, flags, dry = false) {
  needNoOwnersWords('the body', flags);
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}${listAll()}`, () => ({ replace: rawId, value: '<id>' }));
  const profile = loadProfile(root);
  const parts = ['title', 'where', 'what', 'why', 'acceptance', 'changelog', 'section'].filter((k) => flags[k] !== undefined);
  need(parts.length, 'body needs at least one of --title, --where, --what, --why, --acceptance, --changelog, --section', () => (['jarl.mjs', 'field', '<ids>', '<part>', '<value>']));
  const by = editorOf(flags.by);
  const title = flags.title === undefined ? null : fieldText(flags.title);
  need(flags.title === undefined || title, '--title needs a title', () => (['jarl.mjs', 'field', '<ids>', 'Title', '<title>']));
  const sections = namedPairs(flags.section, 'section', profile.sections, 'section');
  const append = flags.append === true;
  if (append) {
    need(flags.title === undefined && flags.where === undefined, '--append adds to a section (What, Why, Acceptance, Changelog or a profile section): the title and the Where field are replaced, not appended to', () => ({ rename: '--add', to: hole('<no-flag-here>') }));
    for (const [heading, v] of [['What', flags.what], ['Why', flags.why], ['Acceptance', flags.acceptance], ['Changelog', flags.changelog], ...sections]) {
      need(v === undefined || [].concat(v).some((x) => fieldText(x) !== ''), `--append needs text to add to the ${heading} section, not an empty one`, () => ({ replace: '', value: '<text>' }));
    }
  }
  needNoFieldTags(flags.what, 'the What text');
  needNoFieldTags(flags.why, 'the Why text');
  for (const [h, v] of sections) needNoFieldTags(v, `the ${h} text`);
  if (flags.acceptance !== undefined) needMarkedLines(acceptanceText(flags.acceptance), (value) => ({ arg: 2, value }));
  const named = parts.flatMap((k) => (k === 'section' ? [...sections.keys()] : [k]));
  if (dry) return { id: issue.id, set: named };
  let text = readText(issue.file);
  const lines = [];
  const held = (key) => issue.sections[key] ?? '';
  // With append, a section keeps what it holds and the new text follows it.
  const grow = (heading, now) => (append ? joinParagraphs(held(heading.toLowerCase()), now) : now);
  // The title is the heading's text; the file keeps its name, so the number and the slug a branch was cut from stay.
  const section = (heading, part, now) => { text = setSection(text, heading, now); lines.push(bodyLine(issue.id, part, held(heading.toLowerCase()), now, by)); };
  if (title) { text = text.replace(idRe('^(#\\s+{id}\\s+·\\s+).*$', 'm'), (_, head) => `${head}${title}`); lines.push(bodyLine(issue.id, 'title', issue.title, title, by)); }
  if (flags.where !== undefined) { text = setField(text, 'Where', fieldText(flags.where)); lines.push(fieldLine(issue.id, 'Where', flags.where, heldField(issue, 'Where'), by)); }
  if (flags.what !== undefined) section('What', 'what', grow('What', bodyText(flags.what)));
  if (flags.why !== undefined) section('Why', 'why', grow('Why', bodyText(flags.why)));
  let rewrote = false;
  let acceptanceNow = '';
  if (flags.acceptance !== undefined) {
    const heading = acceptanceHeading(issue, profile);
    const now = acceptanceText(append ? [...itemsOf(held(heading.toLowerCase())), ...[].concat(flags.acceptance)] : flags.acceptance);
    rewrote = String(held('acceptance')).trim() !== String(now).trim();
    acceptanceNow = now;
    text = setSection(text, heading, now);
    lines.push(bodyLine(issue.id, 'acceptance', held('acceptance'), now, by));
  }
  for (const [h, v] of sections) section(h, h, grow(h, bodyText(v)));
  if (flags.changelog !== undefined) section('Changelog', 'changelog', changelogText(flags.changelog, append ? itemsOf(held('changelog')) : []));
  logChanges(root, lines);
  writeAtomic(issue.file, text);
  // Said on the command line only: a rewritten What, Why or Acceptance that names issues nothing orders with this one.
  // A row keeps the numbers of the acceptance lines it named: a rewritten acceptance says so where rows name any.
  const rowsNote = rewrote ? rowsLostNote(issue, held('acceptance'), acceptanceNow) : null;
  const note = flags.caller === 'cli' ? [...(rowsNote ? [rowsNote] : []), ...(['what', 'why', 'acceptance'].some((k) => named.includes(k)) ? unorderedNotes(root, profile, issue.id) : [])] : [];
  return { id: issue.id, set: named, ...(note.length ? { note: note.join('\n') } : {}) };
}

export function cmdSource(root, rawId, list, dry = false, by = undefined) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}${listAll()}`, () => ({ replace: rawId, value: '<id>' }));
  const editor = editorOf(by);
  const sources = sourceList(list);
  need(sources.length, 'source requires <report-dir#finding-id>[,...]', () => (['jarl.mjs', 'field', '<ids>', 'Source', '<report-dir#finding-id>']));
  if (dry) return { id: issue.id, sources };
  logChanges(root, [fieldLine(issue.id, 'Source', sources.join(', '), heldField(issue, 'Source'), editor)]);
  writeAtomic(issue.file, setField(readText(issue.file), 'Source', sources.join(', ')));
  return { id: issue.id, sources };
}

export function cmdAfter(root, rawId, raw, { clear = false, dry = false, by } = {}) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}${listAll()}`, () => ({ replace: rawId, value: '<id>' }));
  const editor = editorOf(by);
  if (clear) {
    need(raw === undefined, 'after takes either <ids> or --clear, not both', () => ({ rename: '--clear', to: hole('<no-flag-here>') }));
    need(issue.fields.after !== undefined, `${issue.id} has no After field to clear`, () => ({ rename: '--clear', to: hole('<no-flag-here>') }));
    if (dry) return { id: issue.id, after: [], cleared: true };
    logChanges(root, [fieldLine(issue.id, 'After', '', heldField(issue, 'After'), editor)]);
    writeAtomic(issue.file, removeFirstField(readText(issue.file), 'After'));
    return { id: issue.id, after: [], cleared: true };
  }
  need(raw !== undefined, 'after requires <ids> — the issues this one waits on (or --clear)', () => ({ arg: 2, value: '<ids>' }));
  const ids = afterList(root, issue.id, raw);
  if (dry) return { id: issue.id, after: ids };
  logChanges(root, [fieldLine(issue.id, 'After', ids.join(', '), heldField(issue, 'After'), editor)]);
  writeAtomic(issue.file, setField(readText(issue.file), 'After', ids.join(', ')));
  return { id: issue.id, after: ids };
}
