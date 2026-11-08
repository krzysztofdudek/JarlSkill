// The loaded loop: every issue with the state the log gives it, the done gate's window, and where a header and the
// log disagree.

import { existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { CI_STATES, echoWord, fieldText, hole, jarlLine, need } from './base.mjs';
import { jarlDir } from './where.mjs';
import { idKey, idRe, idsCited, keyedIds } from './ids.mjs';
import { BOT_PREFIX, FORMAT_LINES, botNames, clearsOf, clearsWords, profileAt, reviewerRule } from './profile.mjs';
import { asksAt, decisionsAt, goalLines, readGoal } from './journal.mjs';
import { eventsById, isParentLine, loopEvents } from './log.mjs';
import { alignRows, evidenceRows, evidenceTable, headerReadText, issuesAt, mergedOf, sharedNumberText, sharedNumbers } from './issues.mjs';
import { branchTip } from './repositories.mjs';
import { OWNER } from './owner.mjs';

// The refusal of a command that needs a loop where there is none: the directory the call looked in (echoed in single
// quotes with its line breaks escaped, as the words of a call are, so it can neither start a line nor run when the text is
// pasted), the --root that names the directory holding .jarl/, and the form that opens a loop in the root the call named.
export function needLoop(root) {
  need(existsSync(jarlDir(root)), `no loop here: ${echoWord(root)} holds no .jarl/ — open one with ${jarlLine('init', '<goal>')}, or pass --root "<loop-root>", the directory that holds .jarl/`, () => (['jarl.mjs', 'init', '<goal>']));
}

// ---- the loaded loop -------------------------------------------------------------------------------
//
// A command reads the loop once, into one value, and hands it to the gate, the views and models; nothing a function
// needs about the record is looked up again or kept in a module-level table. The value of readLoop(dir), with `dir`
// the directory holding the record (a loop's .jarl/, or an archived loop's directory):
//   dir, root     the record's directory, and the directory whose name is the loop's own (the one holding .jarl/, or
//                 the archive directory itself)
//   profile       the loop's profile
//   issues        every issue, in order; byId, the same by id
//   events        every dated line of the log, typed (see parseEvent); eventsById, the events of each issue
//   goal          the text of the goal, or null; goalLines, what it carries for the tool (see goalLines)
//   asks          the questions; decisions, the rulings
//   coordinators  the names that review as the loop's director
//   bots          the names of the bots the profile's done gate names
//   branchWorkers every worker leased on each Branch, across every issue that records it
// goal, goalLines, asks, decisions, coordinators, bots and branchWorkers are read on first use.
export function readLoop(dir) {
  const root = basename(dir) === '.jarl' ? dirname(dir) : dir;
  const profile = profileAt(dir);
  const events = loopEvents(dir, profile);
  return makeLoop({ dir, root, profile, issues: issuesAt(dir, profile, events), events });
}
function makeLoop({ dir, root, profile, issues, events }) {
  const loop = { dir, root, profile, issues, byId: new Map(issues.map((i) => [i.id, i])), events, eventsById: eventsById(events) };
  // A number the log cannot attribute (two files carry it, or the log files it more than once) has no log lines of its
  // own: its rows, approves, rounds and merges may be another issue's, so no view or gate reads any of them for it.
  for (const i of issues) if (i.byHeader) loop.eventsById.set(i.id, []);
  const once = (make) => { let made = false; let value; return () => { if (!made) { value = make(); made = true; } return value; }; };
  const reads = {
    goal: once(() => readGoal(dir)),
    goalLines: once(() => goalLines(loop.goal)),
    asks: once(() => asksAt(dir)),
    decisions: once(() => decisionsAt(dir)),
    coordinators: once(() => coordinatorsIn(root, loop.goalLines)),
    bots: once(() => botNames(profile)),
    branchWorkers: once(() => branchWorkersOf(loop)),
  };
  for (const [key, read] of Object.entries(reads)) Object.defineProperty(loop, key, { enumerable: true, get: read });
  return loop;
}
// The same loop over some of its issues (the ones a view is scoped to): the gate looks up an issue and the branch it
// shares with others among these, as the view does.
function scopedLoop(loop, issues) { return makeLoop({ dir: loop.dir, root: loop.root, profile: loop.profile, issues, events: loop.events }); }

// Where the files disagree with the journal, which is the record: one entry { id, field, onFile, record, line } per
// header field (Status, Branch, Worker, Model, Since, Merged, CI) whose value differs from the journal's, one per
// issue the journal holds no filing and no move of (field 'journal'), and one per status a line of the journal moves an
// issue into that the loop's profile does not list (field 'profile': the line reads as a note, not as a move), and one per number two issue files carry (field 'number', with the files), each in place of the fields and with no advice to write the log's value into a header, and one per contradiction inside the header of an issue whose number the log cannot attribute (field 'header'), which is read from its header and never compared with the log. The
// views never believe the header; they print these. Each line names how the disagreement is settled: the header written
// back to the journal's value, which writes nothing else, or the move or merge that makes the header's value the
// record, which writes a line of its own.
const FIELD_NAMES = { status: 'Status', branch: 'Branch', worker: 'Worker', model: 'Model', since: 'Since', merged: 'Merged', 'merge check': 'Merge check', ci: 'CI' };
const LEASE_KEYS = ['branch', 'worker', 'model'];
const ghostRe = idRe('^({id}) → (\\S+)');
export function recordDisagreements(loop) {
  const { profile } = loop;
  const out = [];
  // A number two files carry is one entry naming both: the log's lines for it are read for each file, so a header that
  // differs from them may be the true one, and copying the log's value into it would move an issue nobody moved.
  const shared = sharedNumbers(loop.issues);
  const sharedFiles = new Set(shared.flatMap((s) => s.issues.map((i) => i.file)));
  for (const s of shared) out.push({ id: s.id, field: 'number', onFile: null, record: null, files: s.issues.map((i) => `issues/${basename(i.file)}`), line: `record: ${sharedNumberText(s, loop.issues)}` });
  for (const issue of loop.issues) {
    if (issue.id === null || sharedFiles.has(issue.file)) continue;
    const id = issue.id;
    // A number the log cannot attribute is read from its header, so the header is never compared with the log; it is
    // checked against itself, which still catches a hand edit that contradicts the file.
    if (issue.byHeader) {
      for (const what of headerContradictions(profile, issue, loop.events)) out.push({ id, field: 'header', onFile: issue.status, record: null, line: `record: ${id} is read from its header (issues/${basename(issue.file)}), and the header contradicts itself: ${what}` });
      continue;
    }
    if (issue.onFile === null) {
      const status = profile.statuses.includes(issue.status) ? issue.status : profile.initial;
      out.push({ id, field: 'journal', onFile: issue.status, record: null, line: `record: ${id} is not in the log (it holds no filing and no move), so its header is read as it stands — to put it in the log: ${jarlLine('set', id, status, ...(profile.is(status, 'needs-reason') ? ['<text>'] : []))}${profile.is(status, 'closes-record') ? ' (through its checks)' : ''}` });
      continue;
    }
    for (const field of Object.keys(FIELD_NAMES)) {
      const file = fieldText(issue.onFile[field]);
      const record = fieldText(field === 'status' ? issue.status : issue.fields[field]);
      // A header that never carried the Merge check (the merge was written without the field) is read from the merge line, and said nothing about.
      if (field === 'merge check' && !file) continue;
      if (file !== record) out.push(fieldDisagreement(profile, issue, field, file, record));
    }
  }
  // A shared number's files are checked against themselves too: each is read from its own header while they share it.
  for (const s of shared) for (const issue of s.issues) {
    for (const what of headerContradictions(profile, issue, loop.events)) out.push({ id: s.id, field: 'header', onFile: issue.status, record: null, line: `record: ${s.id} is read from its header (issues/${basename(issue.file)}), and the header contradicts itself: ${what}` });
  }
  out.push(...unreadableMoves(loop));
  return out;
}
// What a header read as the record says against itself: a status the profile does not list, a lease that its status
// does not hold or a status that holds one with no lease, a CI with no merge, and a closing status with no proof row
// in the file's Evidence, or one the log never moved the number into: Jarl refuses a close of a number the log cannot
// attribute, so a closing status that no closing move of the number stands behind was written by hand. A close the log
// holds under the number may be another file's; that the record cannot tell.
function headerContradictions(profile, issue, events) {
  const out = [];
  const has = (k) => Boolean(fieldText(issue.fields[k]));
  const st = issue.status;
  if (!profile.statuses.includes(st)) { out.push(`its Status ${st} is not one the loop's profile lists`); return out; }
  if (profile.is(st, 'holds-claim')) {
    if (!has('since')) out.push(`its Status ${st} holds a lease, and it has no Since`);
  } else {
    for (const k of ['worker', 'since', 'worktree']) if (has(k)) out.push(`it carries ${k === 'worktree' ? 'Worktree' : FIELD_NAMES[k]}, and its Status ${st} holds no lease`);
  }
  if (has('ci') && !has('merged')) out.push('it carries CI and no Merged');
  if (profile.is(st, 'closes-record') && evidenceRows(issue).length === 0) out.push(`its Status ${st} closes it, and its Evidence holds no --ran/--saw row`);
  if (profile.is(st, 'closes-record') && !events.some((e) => e.id === issue.id && e.type === 'move' && profile.is(e.to, 'closes-record'))) out.push(`its Status ${st} closes it, and the log holds no move of ${issue.id} into a status that closes it: a number the log cannot attribute is never closed through Jarl`);
  return out;
}
// The issues read from their headers because the log files their number more than once, while one file carries it: one
// note each, { id, file, filings, line }. They are not disagreements: the header is the record for them.
export function headerReadNotes(loop) {
  return loop.issues.filter((i) => i.byHeader && !i.shared).map((i) => {
    const file = `issues/${basename(i.file)}`;
    return { id: i.id, file, filings: i.byHeader.filings, line: headerReadText(i.id, i.byHeader.filings, file) };
  });
}
// The sentence about one header field: what the file holds against what the log holds.
function disagreementSentence(name, file, record) {
  const inFile = file ? `reads ${file} in the file` : 'is missing from the file';
  const inLog = record ? (file ? `${record} in the log` : `reads ${record} in the log`) : 'is not in the log';
  return `${name} ${inFile} and ${inLog}`;
}
// The command that makes the file's value the record, or '' when the field has none. It writes a line of its own.
function makeFileTheRecord(profile, issue, field, file) {
  const id = issue.id;
  if (!file) return '';
  if (field === 'status') {
    if (!profile.statuses.includes(file)) return '';
    return `${jarlLine('set', id, file, ...(profile.is(file, 'needs-reason') ? ['<text>'] : []))} (a move into ${file}${profile.is(file, 'closes-record') ? ', through its checks' : ''})`;
  }
  if (LEASE_KEYS.includes(field)) {
    if (!profile.is(issue.status, 'holds-claim')) return '';
    // Another worker or branch than the lease the log holds is a new holder: the lease is handed over, with its reason.
    const handover = (field === 'worker' || field === 'branch') && Boolean(issue.fields[field]);
    return handover ? `${jarlLine('set', id, issue.status, '<text>', `--${field}`, file, '--handover')} (a handover, a new move line, which stamps Since again)` : `${jarlLine('set', id, issue.status, `--${field}`, file)} (a new move line, which stamps Since again)`;
  }
  if (field === 'merged') {
    const merge = /^\S+(?: in .+)?$/.test(file) ? mergedOf({ fields: { merged: file } }) : null;
    if (!merge) return '';
    const ci = fieldText(issue.onFile.ci);
    return `${jarlLine('merged', id, '--sha', merge.sha, ...(merge.repo ? ['--repo', merge.repo] : []), ...(CI_STATES.includes(ci) ? ['--ci', ci] : []), '--keep')} (a new merge line)`;
  }
  if (field === 'ci') return CI_STATES.includes(file) && issue.fields.merged ? `${jarlLine('merged', id, '--ci', file)} (a new CI line)` : '';
  return '';
}
// One entry for a header field that differs from the log. Its `rewrite` (not enumerable, so not in the JSON) is the
// command that writes the header from the log without a hand edit and without a line.
function fieldDisagreement(profile, issue, field, file, record) {
  const name = FIELD_NAMES[field];
  const follow = record ? `write **${name}:** ${record} back into the header` : `remove the **${name}:** line from the header`;
  const make = makeFileTheRecord(profile, issue, field, file);
  const entry = { id: issue.id, field: name, onFile: file || null, record: record || null, line: `record: ${issue.id} ${disagreementSentence(name, file, record)}, which is the record — to follow the log, ${follow}${make ? `; to make the file's value the record, ${make}` : ''}` };
  Object.defineProperty(entry, 'rewrite', { value: jarlLine('set', issue.id, issue.status, '--header'), enumerable: false });
  return entry;
}
// The lines that have the shape of a move the tool writes (`<id> → <status>` alone or followed by ` · …`, the status a
// lower-case word) into a status the loop's profile does not list. They read as notes. Any other line with an arrow is a note.
function unreadableMoves(loop) {
  const out = [];
  const seen = new Set();
  for (const e of loop.events) {
    if (e.id === null || e.type !== 'other') continue;
    const m = ghostRe.exec(e.text);
    if (!m || idKey(m[1]) !== idKey(e.written ?? e.id) || loop.profile.statuses.includes(m[2])) continue;
    if (!/^[a-z][a-z0-9_-]*$/.test(m[2]) || !/^( · |$)/.test(e.text.slice(m[0].length))) continue;
    const key = `${e.id} ${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: e.id, field: 'profile', onFile: null, record: m[2], line: `record: ${e.id} the log moves it into ${m[2]}, which the loop's profile does not list as a status, so the line is read as a note and not as a move — the profile's status list changed after the line was written` });
  }
  return out;
}
// A disagreement as the views print it: its line, and under it the command that writes the header from the log.
export function disagreementText(d) { return d.rewrite ? `${d.line}\n  or, with no hand edit and no new log line: ${d.rewrite} (writes the header from the log)` : d.line; }

// The issues an unfinished issue's What, Why or Acceptance names by number (see idsCited) while the order does not hold
// them together: the named issue is unsettled (not done or dropped), is not among the issues the naming one waits on
// through After, directly or through the chain, and does not itself wait on the naming one that way. Each is
// { id, names: [ids] }, in the order of the issues. Only these are listed for the issues in `only` when it is given.
// The text relies on the named issue, and nothing orders the two: a note, never a refusal.
export function unorderedNamings(issues, profile, only = null) {
  const held = new Map(issues.filter((i) => i.id !== null).map((i) => [i.id, i]));
  const byKey = new Map([...held.values()].map((i) => [idKey(i.id), i]));
  const keyed = keyedIds(held);
  // Whether `issue` waits on the issue with `id` through After, directly or through the chain: a walk that stops at the
  // first sight of it and visits each issue once.
  const waitsOn = (issue, id) => {
    const want = idKey(id);
    const seen = new Set();
    const stack = [...issue.after];
    while (stack.length) {
      const key = idKey(stack.pop());
      if (key === want) return true;
      if (seen.has(key)) continue;
      seen.add(key);
      stack.push(...(byKey.get(key)?.after || []));
    }
    return false;
  };
  const heading = (profile.acceptance || 'Acceptance').toLowerCase();
  const out = [];
  for (const issue of issues) {
    if (issue.id === null || !profile.unfinished(issue.status) || (only && !only.includes(issue.id))) continue;
    const text = [issue.sections.what, issue.sections.why, issue.sections[heading]].filter(Boolean).join('\n');
    const cited = idsCited(text, held, keyed).filter((id) => idKey(id) !== idKey(issue.id) && !profile.is(held.get(id).status, 'settles-dependents'));
    const names = cited.filter((id) => !waitsOn(issue, id) && !waitsOn(held.get(id), issue.id));
    if (names.length) out.push({ id: issue.id, names });
  }
  return out;
}
// The note a text that names unordered issues gets, on one line: the same words from verify, new and field.
export function unorderedText(n) {
  const [noun, it, is] = n.names.length === 1 ? ['issue', 'it', 'is'] : ['issues', 'them', 'are'];
  return `names ${noun} ${n.names.join(', ')} in What, Why or Acceptance, which ${is} neither done nor dropped, and no After orders ${it} with ${n.id} — if the text relies on ${it}, order the two by adding ${it} to After, which keeps what After holds: ${jarlLine('field', n.id, 'After', '<ids-it-waits-on>', '--add')}`;
}

// Who reviewed, as a kind: the word self, or anyone who has ever held the issue's lease — its own worker across
// every takeover, and the worker of any other issue sharing its Branch (a package, or an issue folded into the
// same branch later) — is self too; the loop's own director — coordinator, jarl, reeve, the loop's own name (the
// directory holding .jarl/) and any name the goal declares on a `Coordinators: a, b` line (coordinator); a bot the
// profile's done gate names (bot); anyone else (fresh). A name is compared without case and surrounding space. `worker`
// is a name, or a set of them.
export const BASE_COORDINATORS = ['coordinator', 'jarl', 'reeve'];
export function reviewerKind(by, worker, coordinators = BASE_COORDINATORS, bots = []) {
  const b = fieldText(by).toLowerCase();
  const workers = worker == null ? [] : typeof worker === 'string' ? [worker] : [...worker];
  if (b === 'self' || workers.some((w) => b === fieldText(w).toLowerCase())) return 'self';
  if (coordinators.some((c) => fieldText(c).toLowerCase() === b)) return 'coordinator';
  if (bots.some((n) => fieldText(n).toLowerCase() === b)) return 'bot';
  return 'fresh';
}
// The names that review as the loop's director in this loop: the fixed three, the loop's own name, and the names
// a `Coordinators:` line of the goal lists (see goalLines).
export function coordinatorNames(root) { return coordinatorsIn(root, goalLines(readGoal(jarlDir(root)))); }
function coordinatorsIn(root, lines) { return [...BASE_COORDINATORS, basename(resolve(root)), ...lines.coordinators]; }

// ---- slices ----------------------------------------------------------------------------------------
//
// A slice is the part of the backlog one coordinator runs: the issues tagged slice:<coordinator>, the coordinator being a
// name the goal's Coordinators line lists. The line names the coordinators and each one's slice is its name, so a reader
// that knows no slices reads the same line as the names that review as the loop's director. An issue is in one slice
// at most; an issue in none is the jarl's.
export const SLICE_PREFIX = 'slice:';
export const isSliceTag = (t) => String(t).toLowerCase().startsWith(SLICE_PREFIX);
export function sliceTag(coordinator) { return `${SLICE_PREFIX}${coordinator}`; }
// The coordinator whose slice an issue is in, as its tag names it, or null. A sub-issue with no slice tag of its own is
// in the slice of the nearest issue above it that carries one, so a slice can be a subtree.
export function sliceOf(issue) {
  for (const i of [issue, ...(issue.tree ? issue.tree.ancestors : [])]) {
    const tag = (i.tags || []).find(isSliceTag);
    if (tag) return tag.slice(SLICE_PREFIX.length);
  }
  return null;
}
// Who holds an issue's rows of work: the coordinator whose slice it is in, written as the Coordinators line writes the
// name (as the tag writes it when the line does not list it), or the jarl for an issue in no slice.
export function coordinatorOf(loop, issue) {
  const slice = sliceOf(issue);
  if (slice === null) return 'jarl';
  return loop.goalLines.coordinators.find((c) => sameSlice(c, slice)) ?? slice;
}
// The same coordinator, in any case: slice:Odin and slice:odin are one slice.
export const sameSlice = (a, b) => a !== null && b !== null && fieldText(a).toLowerCase() === fieldText(b).toLowerCase();
// A write of an issue's tags keeps one slice tag at most, and a slice tag names its coordinator; slice names compare in any
// case, so slice:Odin beside slice:odin is a second tag of one slice and refused too. `held` is what the issue carries
// now, so a refusal says how to move it from the slice it is in, removing every slice tag it holds.
export function needOneSlice(tags, { id = null, held = [] } = {}) {
  const slices = [...new Set(tags.filter(isSliceTag))];
  for (const t of slices) need(t.length > SLICE_PREFIX.length, `${t} names no coordinator: a slice is the tag slice:<coordinator>, the coordinator a name of the goal's Coordinators line`, () => ({ replace: t, value: '<slice:coordinator>' }));
  if (slices.length <= 1) return;
  const heldSlices = held.filter(isSliceTag);
  const was = heldSlices[0];
  const to = was && slices.find((t) => !heldSlices.some((h) => h.toLowerCase() === t.toLowerCase()));
  const same = was && !to ? slices.find((t) => !heldSlices.includes(t)) : null;
  // The tags to take off and the one to add are named, never written into a command: which slice the issue goes to is the
  // caller's to say, so the steps below the reason are forms.
  need(false, id !== null && was && to
    ? `${id} is in ${was} already, and an issue is in one slice — to move it, take ${heldSlices.join(' and ')} off with field --remove first, then add ${to} with field --add`
    : id !== null && same
      ? `${id} is in ${was} already, and ${same} names the same slice in another case — an issue carries one slice tag`
      : `an issue is in one slice, and ${id !== null ? `${id} would carry` : 'the tags name'} ${slices.join(', ')} — keep one${id !== null ? '' : `, e.g. --tags ${slices[0]}`}`, () => (id !== null && was && to ? [{ first: ['jarl.mjs', 'field', hole('<ids>'), 'Tags', hole('<tag>'), '--remove'] }, { retry: true }] : { retry: true }));
}
// The slices of a loop: each coordinator the Coordinators line names, with its slice tag, then each slice a tag names
// whose coordinator the line does not list (declared false: its coordinator's approve counts as fresh). inPlay counts the
// issues of the slice still in play (open or in progress).
export function slicesOf(loop) {
  const { profile } = loop;
  const out = new Map();
  for (const name of loop.goalLines.coordinators) if (!out.has(name.toLowerCase())) out.set(name.toLowerCase(), { coordinator: name, tag: sliceTag(name), declared: true, inPlay: 0 });
  for (const i of loop.issues) {
    const name = sliceOf(i);
    if (name === null) continue;
    if (!out.has(name.toLowerCase())) out.set(name.toLowerCase(), { coordinator: name, tag: sliceTag(name), declared: false, inPlay: 0 });
    if (profile.active(i.status)) out.get(name.toLowerCase()).inPlay += 1;
  }
  return [...out.values()];
}
// The coordinator a --slice names, as the record writes it: a name of the Coordinators line (`coordinators`) or of a
// slice tag one of `issues` carries, in any case. Any other name is refused, naming the slices there are.
export function sliceNamed(coordinators, issues, name) {
  need(typeof name === 'string' && fieldText(name), '--slice names a coordinator: its slice is the issues tagged slice:<coordinator>', () => ({ flag: '--slice', value: '<coordinator>' }));
  const known = [...coordinators, ...issues.map(sliceOf).filter((s) => s !== null)];
  const found = known.find((k) => sameSlice(k, name));
  const names = [...new Map(known.map((k) => [k.toLowerCase(), k])).values()];
  need(found !== undefined, `no coordinator ${fieldText(name)} on the goal's Coordinators line and no issue tagged ${sliceTag(fieldText(name))} — ${names.length ? `the slices are ${names.map(sliceTag).join(', ')}` : `the loop has no slice: ${jarlLine('goal', '--set', 'Coordinators: <names>')}, then ${jarlLine('field', '<ids>', 'Tags', '--add', '<slice:coordinator>')}`}`, () => (names.length ? { replace: fieldText(name), value: hole('<coordinator>') } : ['jarl.mjs', 'goal', '--set', '<machine-line>']));
  return found;
}
// The slices with an issue in play.
export function activeSlices(loop) { return slicesOf(loop).filter((s) => s.inPlay > 0); }
// How strong an approve of each standing is, strongest first. A bot's approve clears nothing unless the done gate names it,
// so it stands below the loop's director's, which still clears an issue that carries no code.
const KIND_WEIGHT = { fresh: 0, waived: 0.5, coordinator: 1, bot: 1.5, self: 2 };
// The note decide --waives-review writes into each issue it names, as the log holds it.
const WAIVER_NOTE = /^\S+ evidence · Ruling (\S+) \(by owner\) waives the review\b/;
// Why the ruling `slug` waives nothing for issue `id`, in a few words, or null when it waives its review: a waiver counts
// only while its ruling is in the record, is in force, is the owner's with his words, names the issue under Waives
// review, and the loop is in the record format that holds a waiver (a reader of the formats below it counts the issue as
// unreviewed, so a waiver below that format counts here neither). The done gate reads it, and show says it beside a note
// whose ruling does not count.
function waiverVoid(loop, slug, id) {
  const d = (loop.decisions || []).find((x) => x.slug === slug);
  if (!d) return `no ruling ${slug} is in the record`;
  if (d.supersededBy) return `superseded by ${d.supersededBy}`;
  if (d.by !== OWNER || !d.quote) return 'the ruling is not the owner\'s with his words';
  if (!(d.waives || []).some((w) => idKey(w) === idKey(id))) return `the ruling does not name ${id} under Waives review`;
  const held = FORMAT_LINES['review-waiver'].format;
  if (loop.profile.format < held) return `the loop is not in record format ${held}`;
  return null;
}
// An issue carries code when it records a branch or a merge. Only then does done (and the merge queue) need a
// fresh approve; an issue with neither — a ruling, a note, a hub document — is still cleared by the coordinator.
export function carriesCode(issue) { return Boolean(fieldText(issue.fields.branch) || fieldText(issue.fields.merged)); }
// A code issue whose branch is not merged: its lease records a Branch, and neither its Merged field nor its journal
// records a merge. The one rule done refuses by and status flags a closed issue by: the merge comes before done.
export function unmergedCode(issue, events) { return Boolean(fieldText(issue.fields.branch)) && !mergedOf(issue) && !events.some((e) => e.type === 'merged'); }

// Every worker one issue's own journal has ever named on an in-progress move — a takeover replaces Worker but
// is still the same issue, so every lease across every round counts, not only the latest.
function leaseWorkers(events) {
  const workers = new Set();
  for (const e of events) if (e.type === 'move' && e.lease) workers.add(e.lease.worker);
  return workers;
}

// Every worker ever leased on a Branch, across every issue of the loop that records it (a package leased once for
// several issues, or one folded into the branch later by a bare `set <ids> in-progress --branch <b>` with no
// --worker of its own, is still one branch). The loop holds it, built once on first use.
function branchWorkersOf(loop) {
  const map = new Map();
  for (const i of loop.issues) {
    const branch = fieldText(i.fields.branch);
    if (!branch) continue;
    const set = map.get(branch) || new Set();
    for (const w of leaseWorkers(loop.eventsById.get(i.id) || [])) set.add(w);
    if (i.fields.worker) set.add(fieldText(i.fields.worker));
    map.set(branch, set);
  }
  return map;
}

// The full self scope for one issue: everyone its own lease has ever named, plus everyone named on another issue
// that shares its Branch (see branchWorkersOf). Self-review is refused for any of them, not only the id's own
// latest lease. Pure and cheap: no I/O, so it costs nothing extra when called once per issue in a loop.
function selfWorkers(events, issue, branches) {
  const self = leaseWorkers(events);
  if (issue && issue.fields.worker) self.add(fieldText(issue.fields.worker));
  const branch = issue && fieldText(issue.fields.branch);
  if (branch && branches.has(branch)) for (const w of branches.get(branch)) self.add(w);
  return self;
}

// The done gate, read from the journal for one issue. Replaying its lines in order:
// - the window (gateWindow) holds the anchor and the cut; only --ran/--saw rows logged after the anchor count for done
//   (a free-text note never does), so nothing written before a start, a reopen or the filing is proof of the work;
// - an approve by anyone who has ever held the issue's lease (self — see selfWorkers) never counts;
// - the live approve is the strongest one (fresh over the owner's waiver over coordinator over self; the waiver over
//   every approve where the profile's reviewer rule judges an approve's model) among those since whatever last
//   reset the issue — the cut of the window (a round, a reopen, a start), or a later "changes" verdict still
//   waiting on its own approve. A later, weaker approve never spends an earlier, still-live one: only those
//   resets do — a coordinator's approve recorded after a live fresh one does not undo it;
// - `tracked` is false for an issue the journal has no filing and no status move for (a hand-made file, a
//   loop whose log does not hold it): the gate then needs a --ran/--saw row in its Evidence section.
//
// gateState reads the loop for one call; a view that reads the gate for many issues reads the loop once and asks
// gateOf of it.
export function gateState(root, id) {
  const loop = readLoop(jarlDir(root));
  const issue = loop.issues.find((i) => idKey(i.id) === idKey(id));
  return gateOf(loop, issue ? issue.id : id);
}
// The one window of the done gate, from the issue's own events in order: `anchor` is the event after which a --ran/--saw
// row counts as proof, `cut` the log line number at or before which an approve is spent. The flags of the profile say what
// resets them. A filing, a start (a move into a status that holds the claim from one that does not), a reopen (a move into
// a dispatchable status from one that closes the record or holds the claim, and any move out of a status that closes the
// record) reset both, so a close rests only on proof and review recorded after the last of them. A red round
// resets the cut alone: it spends the approve, while the rows the worker logged stay true.
// With `throughPauses`, a pause and a resume reset nothing: a move from a status that holds the claim back into a
// dispatchable one, and a move into a status that holds the claim made after the issue already held it since the last
// filing or reopen from a closed status. What is left is the window no pause can open: the gate keeps a row or an approve
// from between the two windows when the tip it was made on is the branch's tip now.
export function gateWindow(profile, events, { throughPauses = false } = {}) {
  let anchor = null; let cut = -1; let filed = false; let held = false;
  for (const e of events) {
    if (e.type === 'filed') { if (!filed) { filed = true; anchor = e; cut = e.n; } continue; }
    if (e.type === 'round') { cut = e.n; continue; }
    if (e.type !== 'move') continue;
    const { from, to } = e;
    const start = profile.is(to, 'holds-claim') && !profile.is(from, 'holds-claim');
    const leavesClose = profile.is(from, 'closes-record') && !profile.is(to, 'closes-record');
    const reopen = profile.is(to, 'dispatchable') && (profile.is(from, 'closes-record') || profile.is(from, 'holds-claim'));
    const pause = throughPauses && !leavesClose && ((start && held) || (reopen && !profile.is(from, 'closes-record')));
    if ((start || reopen || leavesClose) && !pause) { anchor = e; cut = e.n; }
    if (leavesClose) held = false;
    if (profile.is(to, 'holds-claim')) held = true;
  }
  return { anchor, cut };
}
// When the whole under a parent was last complete: the latest line of its sub-issues that closed one (a move into a status
// that settles what waits on it) or made it a sub-issue (its Parent field written), as { n, at, id, how } with how
// 'closed' or 'joined', or null for an issue with no sub-issues. A parent's own acceptance is checked against the whole,
// so the done gate's window of a parent opens there, as it opens at a start or a reopen.
export function wholeOf(loop, issue) {
  let best = null;
  for (const c of issue && issue.tree ? issue.tree.children : []) {
    for (const e of loop.eventsById.get(c.id) || []) {
      const how = e.type === 'move' && loop.profile.is(e.to, 'settles-dependents') ? 'closed' : isParentLine(e) ? 'joined' : null;
      if (how && (!best || e.n > best.n)) best = { n: e.n, at: e.at, id: c.id, how };
    }
  }
  return best;
}
// Since when the done gate counts an issue's proof, as a reason says it: since it was filed, moved into a status, or since
// its last sub-issue closed or joined it.
export function sinceText(anchor) {
  if (anchor.what === 'filed') return 'it was filed';
  if (anchor.what === 'whole') return `its last sub-issue, ${anchor.sub}, ${anchor.how === 'joined' ? 'joined it' : 'closed'}`;
  return `it was moved → ${anchor.what}`;
}

// A commit as a tip line holds it.
const TIP_SHA = /^[0-9a-f]{7,64}$/;
export function gateOf(loop, id) {
  const { profile, coordinators, bots } = loop;
  const events = loop.eventsById.get(id) || [];
  const issue = loop.issues.find((i) => i.id === id) || null;
  const self = selfWorkers(events, issue, loop.branchWorkers);
  const own = gateWindow(profile, events);
  // The window no pause opens. A row or an approve between it and the window above counts when the tip it was made on is
  // the branch's tip now: a pause and a resume leave the code as it was, and a new commit spends them.
  const firm = gateWindow(profile, events, { throughPauses: true });
  // A parent's window opens no earlier than the whole under it was complete: a proof or an approve made while a sub-issue
  // was still open was not made against the whole.
  const whole = wholeOf(loop, issue);
  const later = (w) => (whole && (!w.anchor || whole.n > w.anchor.n) ? { anchor: { n: whole.n, at: whole.at, type: 'whole', sub: whole.id, how: whole.how }, cut: Math.max(w.cut, whole.n) } : w);
  const { anchor, cut } = later(own);
  const firmed = later(firm);
  const firmAnchorN = firmed.anchor ? firmed.anchor.n : -1;
  firm.cut = firmed.cut;
  const anchorN = anchor ? anchor.n : -1;
  const evidence = []; const allReviews = [];
  const trail = [];   // every review line in order (approve, changes, retract), for the issue view
  const retractedRows = [];
  // A tip line belongs to the line of the same issue just before it: a row, a verdict, a merge or a close. It is one only as
  // part of the write that made that line, which puts it on the next line of the log under the same stamp: a line of the
  // tip shape written by itself (a note a log command with no refusal of it took, a line added later) is the tip of nothing.
  let before = null;
  let mergeTip = null;   // the tip the newest merge was recorded on
  let mergeSha = null;   // the commit the newest merge names
  let closeTip = null;   // the tip recorded with the newest move, when that move closed the record
  const closedBy = (e) => e.type === 'move' && profile.is(e.to, 'closes-record');
  // The owner's waivers of this issue's review: the rulings waiverVoid finds nothing against. Each stands where decide
  // wrote it into the issue (its first note naming the ruling, and the tip after it), and counts as an approve counts: a
  // start, a reopen or a red round spends it, and so does a new commit.
  const waivers = new Set((loop.decisions || []).filter((d) => d.waives && waiverVoid(loop, d.slug, id) === null).map((d) => d.slug));
  const waived = [];
  for (const e of events) {
    if (e.type === 'tip') {
      const own = before && e.n === before.n + 1 && e.at === before.at;
      if (own && before.type === 'merged') mergeTip = e.tip;
      else if (own && closedBy(before)) closeTip = e.tip;
      else if (own && before.tip === undefined) before.tip = e.tip;
      before = null;
      continue;
    }
    before = null;
    if (e.type === 'move') { closeTip = null; if (closedBy(e)) before = e; continue; }
    if (e.type === 'merged') { before = e; mergeTip = null; mergeSha = e.sha; continue; }
    if (e.type === 'verdict') {
      // The kind is the one recorded, or the one today's names give, whichever is stricter: a name the goal
      // declares as a coordinator after its approve was logged as fresh does not stay fresh, and a name that
      // turns out to have ever held the lease (self) does not stay fresh or coordinator either.
      let kind = e.kind;
      if (kind && e.by) { const now = reviewerKind(e.by, self, coordinators, bots); if (KIND_WEIGHT[now] > KIND_WEIGHT[kind]) kind = now; }
      const review = { n: e.n, at: e.at, verdict: e.verdict, by: e.by, kind, model: e.model ?? null, relayed: Boolean(e.relayed), retracted: false };
      allReviews.push(review);
      trail.push(review);
      before = review;
      continue;
    }
    // A retraction takes away the newest approve not yet retracted, and only that: it never touches a changes verdict.
    if (e.type === 'retract-review') {
      const target = [...allReviews].reverse().find((x) => x.verdict === 'approve' && x.kind !== 'waived' && !x.retracted);
      if (target) target.retracted = true;
      trail.push({ n: e.n, at: e.at, verdict: 'retract', retracted: false });
      continue;
    }
    if (e.type === 'retract-row') { retractedRows.push(e.row); continue; }
    if (e.type === 'row') { const row = { ...e, retracted: false }; evidence.push(row); before = row; continue; }
    const w = e.type === 'other' ? WAIVER_NOTE.exec(e.text || '') : null;
    if (w && waivers.has(w[1]) && !waived.some((x) => x.ruling === w[1])) {
      const review = { n: e.n, at: e.at, verdict: 'approve', by: OWNER, kind: 'waived', ruling: w[1], model: null, retracted: false };
      allReviews.push(review); waived.push(review);
      before = review;
    }
  }
  // The branch's tip now, read once and only when a row or a verdict between the two windows carries a tip: the branch
  // in the issue's repositories, or, where it is gone (the cleanup after a merge deletes it), the tip the newest merge
  // was recorded on. A closed issue is judged on the tip recorded when it closed, where the close recorded one: a commit
  // on its branch or the branch's removal after the close changes nothing it was closed on.
  let tipHere;
  const now = () => {
    if (tipHere === undefined) tipHere = closeTip || (issue && loop.root && branchTip(loop.root, issue)) || mergeTip || null;
    return tipHere;
  };
  const kept = (e, after) => e.n > after || (e.tip !== undefined && now() !== null && e.tip === now());
  for (const e of evidence) e.inWindow = e.n > anchorN || (e.n > firmAnchorN && kept(e, anchorN));
  for (const r of allReviews) r.inWindow = (r.n > cut || (r.n > firm.cut && kept(r, cut))) && (r.kind !== 'waived' || r.tip === undefined || now() === null || r.tip === now());
  // A retraction names a row by its file-wide ordinal (evidenceTable: the one numbering show prints), and the journal's
  // row lines are matched to the file's rows (alignRows), so journal lines that merged in another order cannot retract
  // the wrong row. A retraction that cannot be resolved to exactly one row is never ignored: it is returned, and done
  // refuses while one stands, so a retracted row can never count again unseen.
  const unresolvedRetractions = [];
  if (retractedRows.length) {
    const rows = issue ? evidenceTable(issue.sections.evidence).rows : [];
    const aligned = alignRows(id, rows, evidence);
    for (const n of retractedRows) {
      if (aligned[n - 1]) aligned[n - 1].retracted = true;
      else if (evidence.length) unresolvedRetractions.push(n);
    }
  }
  const reviews = allReviews.filter((r) => !r.retracted);
  const last = reviews[reviews.length - 1] || null;
  // Only approves logged after the last "changes" verdict are even candidates — a changes still needs its own
  // approve. Among those, and past cut, the strongest kind wins, tie-broken by the more recent.
  let sinceChanges = reviews;
  for (let i = reviews.length - 1; i >= 0; i -= 1) { if (reviews[i].verdict === 'changes') { sinceChanges = reviews.slice(i + 1); break; } }
  // Under a reviewer rule that judges the model of an approve, the owner's live waiver is the one that clears the issue,
  // whatever approve it holds: done refuses an approve whose model the rule refuses, and a waiver is the owner's ruling
  // that no review is needed, which no model rule judges. Under the default rule a fresh approve still stands first.
  const weight = reviewerRule(profile) === 'agent' ? KIND_WEIGHT : { ...KIND_WEIGHT, waived: -1 };
  const strongest = (list) => {
    let best = null;
    for (const r of list) {
      const rw = weight[r.kind] ?? Infinity;
      const bw = best ? (weight[best.kind] ?? Infinity) : Infinity;
      if (!best || rw < bw || (rw === bw && r.n > best.n)) best = r;
    }
    return best;
  };
  const approves = sinceChanges.filter((r) => r.verdict === 'approve' && r.inWindow);
  // Whether the approves meet the loop's definition of an approved issue (the done gate's "clears"), read for an issue that
  // carries code and for this issue as it is: the reading done, the merge queue and the line after a verdict all take.
  // Each reviewer of the definition is met by its strongest approve, so the approve that meets the default definition is
  // the strongest of all, and a later approve of a weaker standing never takes its place.
  const code = issue ? carriesCode(issue) : false;
  const forCode = clearing(clearsOf(profile), approves, true, strongest);
  const cleared = code ? forCode : clearing(clearsOf(profile), approves, false, strongest);
  // The live approve is the strongest; where the definition is met without it, the strongest of the approves that meet it.
  // A self-approve that stands strongest stays live, and the issue stays unapproved.
  let live = strongest(approves);
  if (cleared.met && live && live.kind !== 'self' && !cleared.by.has(live)) live = strongest([...cleared.by]);
  const approved = Boolean(live && live.kind !== 'self');
  return {
    tracked: anchor !== null,
    anchor: anchor ? { at: anchor.at, what: anchor.type === 'filed' ? 'filed' : anchor.type === 'whole' ? 'whole' : anchor.to, ...(anchor.type === 'whole' ? { sub: anchor.sub, how: anchor.how } : {}) } : null,
    unresolvedRetractions,
    rowsSince: evidence.filter((e) => e.inWindow && !e.retracted).length,
    // What the issue view windows by: where the gate's window starts in the log, and the log's rows and review lines in
    // order. A row or a verdict a pause did not spend opens it as far back as the first of them.
    cut: Math.min(cut, ...allReviews.filter((r) => r.inWindow).map((r) => r.n - 1)),
    anchorN: Math.min(anchorN, ...evidence.filter((e) => e.inWindow).map((e) => e.n - 1), ...allReviews.filter((r) => r.inWindow && r.n <= anchorN).map((r) => r.n - 1)),
    rowLog: evidence, trail,
    lastReview: last ? last.verdict : null,
    lastApprove: [...reviews].reverse().find((r) => r.verdict === 'approve' && r.kind !== 'waived') || null,
    approved,
    selfApproved: Boolean(live && live.kind === 'self'),
    // fresh: the approves clear the issue as one that carries code; cleared: as the issue is. uncleared: why approves stand
    // and do not clear it — the fresh-review rule (coordinator), a bot the done gate does not name (bot), or the loop's own
    // definition (definition) — with the approves that stand.
    fresh: approved && forCode.met,
    cleared: approved && cleared.met,
    uncleared: approved && !cleared.met ? { cause: profile.doneGate.clears ? 'definition' : live.kind === 'bot' ? 'bot' : 'coordinator', standing: [...new Map(approves.filter((r) => r.kind !== 'self').map((r) => [`${r.by} (${r.kind})`, r])).keys()] } : null,
    waived: live && live.kind === 'waived' ? live.ruling : null,
    live,
    workers: self,
    // The tip a close of the issue records, read when asked: the one the gate judges it on now, or, where neither the
    // branch nor its merge's tip line is there, the commit the newest merge names. A closed issue's gate is read against
    // it, so a branch of the same name made again after the close changes nothing.
    closingTip: () => now() || (mergeSha && TIP_SHA.test(mergeSha) ? mergeSha : null),
  };
}

// An approve that stands for one reviewer of a done gate's "clears", on an issue that carries code or one that does not:
// fresh, an agent that is neither the issue's worker, the loop's director, a bot nor the owner (the loop's director, or an
// approve that names no reviewer, too on an issue with no code); owner, the owner's own approve, given in his own standing
// (a verdict recorded as a bot's under his name is a bot's); bot:<name>, that bot's.
const isOwner = (by) => Boolean(by) && fieldText(by).toLowerCase() === OWNER;
function standsFor(r, who, code) {
  if (r.kind === 'self' || r.kind === 'waived') return false;
  if (who === 'owner') return r.kind === 'fresh' && isOwner(r.by);
  if (who === 'fresh') return (r.kind === 'fresh' && !isOwner(r.by)) || (!code && (r.kind === 'coordinator' || !r.kind));
  return r.kind === 'bot' && fieldText(r.by).toLowerCase() === who.slice(BOT_PREFIX.length).toLowerCase();
}
// Whether `approves` meet a done gate's "clears": some way it names, every reviewer of it with an approve that stands for
// it, the strongest such approve as `strongest` ranks them; the owner's live waiver meets any. `by` holds the approves
// that meet it.
function clearing(clears, approves, code, strongest) {
  const by = new Set(approves.filter((r) => r.kind === 'waived'));
  for (const way of clears) {
    const picks = way.map((who) => strongest(approves.filter((r) => standsFor(r, who, code))));
    if (picks.every(Boolean)) for (const r of picks) by.add(r);
  }
  return { met: by.size > 0, by };
}
// Why done refuses an issue whose approves stand and do not clear it, for a cause other than the fresh-review rule (which
// freshRuleText says): a bot the done gate does not name, or the loop's own definition. Null when there is no such cause.
export function unclearedText(loop, issue, g) {
  const u = g.uncleared;
  if (!u || u.cause === 'coordinator') return null;
  const how = clearsWords(clearsOf(loop.profile));
  if (u.cause === 'bot') return `${issue.id}'s live approve is by ${g.live.by} (bot) — a bot's approve is recorded and counted apart, and clears an issue only where the loop's done gate names that bot (done-gate "clears"); this loop clears on ${how}`;
  return `${issue.id} holds no approve that clears it under this loop's done gate (done-gate "clears": ${how})${u.standing.length ? ` — the approves it holds are by ${u.standing.join(', ')}` : ''}`;
}

// Who reviewed the done issues: the kind of each one's last approve, and how many carry no reviewer at all
// (an approve recorded without --by). Shown by status and report, never acted on.
// A relayed fresh approve, and a bot's, are counted apart from the fresh ones (relayed, bot), and so, over every issue of the
// loop, are the verdicts of each that the record holds (botVerdicts, relayedVerdicts); each of these four only when not 0.
export function reviewSplit(loop) {
  const split = { fresh: 0, coordinator: 0, self: 0, unrecorded: 0 };
  for (const i of loop.issues.filter((x) => loop.profile.is(x.status, 'closes-record'))) {
    const kind = approveKind(gateOf(loop, i.id));
    split[kind] = (split[kind] || 0) + 1;
  }
  const verdicts = loop.issues.flatMap((i) => (loop.eventsById.get(i.id) || []).filter((e) => e.type === 'verdict'));
  const bot = verdicts.filter((e) => e.kind === 'bot' || (e.by && reviewerKind(e.by, [], [], loop.bots) === 'bot')).length;
  const relayed = verdicts.filter((r) => r.relayed).length;
  return { ...split, ...(bot ? { botVerdicts: bot } : {}), ...(relayed ? { relayedVerdicts: relayed } : {}) };
}
// The kind of the approve that stands behind an issue — the live one, the one that actually cleared it, not simply the
// last one recorded: a later coordinator (or self) approve does not make an already-cleared issue read as coordinator- or
// self-reviewed. `relayed` for a fresh approve someone else recorded in the reviewer's name; `retracted` when the approve
// was taken back and none stands; `unrecorded` for an approve without --by.
function approveKind(g) {
  if (g.live) return g.live.kind === 'fresh' && g.live.relayed ? 'relayed' : g.live.kind || 'unrecorded';
  return g.trail.some((r) => r.verdict === 'approve' && r.retracted && r.inWindow) ? 'retracted' : 'unrecorded';
}

const closedGateLine = (x) => `closed, gate does not hold: ${x.id} · ${x.reason} — repair: ${x.repair}`;
// Who stands behind the closed issues: the reviewers, by kind — or, under a done gate with no approve, the merge that
// landed each one, with whatever reviews were recorded all the same.
function gateLine(profile, split, label) {
  if (profile.doneGate.approve !== 'none') return `${label}: ${renderSplit(split)}`;
  return `closed on a merge in the base, no approve required (this loop's done gate) · reviews recorded: ${renderSplit(split)}`;
}
function renderSplit(s) {
  const apart = [s.botVerdicts ? `bot ${s.botVerdicts}` : null, s.relayedVerdicts ? `relayed ${s.relayedVerdicts}` : null].filter(Boolean);
  return `fresh ${s.fresh}${s.waived ? ` · waived by the owner ${s.waived}` : ''} · coordinator ${s.coordinator} · self ${s.self}${s.relayed ? ` · relayed ${s.relayed}` : ''}${s.bot ? ` · bot ${s.bot}` : ''}${s.retracted ? ` · retracted ${s.retracted}` : ''}${s.unrecorded ? ` · unrecorded ${s.unrecorded}` : ''}${apart.length ? ` · of every verdict recorded, ${apart.join(' and ')}` : ''}`;
}

// What the record says about one in-flight issue, as one fact (the steps the marks point to are in evidence.mjs): no
// evidence rows since the start; rows and no verdict since the last restart or round; changes requested; approved, with
// the merge and its CI after it. A self approve is not a verdict that counts, so it reads as no verdict.
export function inFlightMark(loop, issue) {
  const g = gateOf(loop, issue.id);
  if (g.approved) {
    // The same reading the done gate and the merge queue take: an issue that carries code is cleared by a fresh approve
    // only, and an approve the loop's definition of an approved issue does not accept clears nothing.
    if (!g.cleared) return g.uncleared.cause === 'coordinator' ? 'approved-not-fresh' : 'approved-not-cleared';
    const m = mergedOf(issue);
    if (!m) return 'approved';
    return m.ci === 'pending' || m.ci === 'red' ? 'merged-ci' : 'merged';
  }
  const verdicts = g.trail.filter((r) => r.inWindow && !r.retracted && (r.verdict === 'approve' || r.verdict === 'changes'));
  if (verdicts.length && verdicts[verdicts.length - 1].verdict === 'changes') return 'changes-requested';
  return g.rowsSince === 0 ? 'no-rows' : 'rows-no-verdict';
}
// Whether a round sent the work back and the worker has recorded no row since: the issue is the worker's again, though its
// mark still reads rows and no verdict.
export function sentBack(loop, issue, mark) {
  const lastRound = (loop.eventsById.get(issue.id) || []).filter((e) => e.type === 'round').reduce((n, e) => Math.max(n, e.n), -1);
  const rowsAfterRound = gateOf(loop, issue.id).rowLog.filter((r) => !r.retracted && r.inWindow && r.n > lastRound).length;
  return lastRound >= 0 && rowsAfterRound === 0 && mark === 'rows-no-verdict';
}
// Whether an issue holds a live approve and is not merged yet: the merger's to land, so its lease is not idle for that wait.
export const awaitsMerge = (loop, issue) => inFlightMark(loop, issue) === 'approved';

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { FIELD_NAMES, approveKind, closedGateLine, gateLine, renderSplit, scopedLoop, waiverVoid };
