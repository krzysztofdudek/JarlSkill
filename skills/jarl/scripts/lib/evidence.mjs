// An issue's evidence and the views that read it: evidence and retract, show, next and status, then mode and close.

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PROMISE_KIND, fieldText, hole, jarlLine, need, refuse } from './base.mjs';
import { carryingOwnersWords, needNoOwnersWords } from './owner.mjs';
import { git } from './git.mjs';
import { jarlDir, stamp } from './where.mjs';
import { readText, writeAtomic } from './files.mjs';
import { cmpId, isBulk } from './ids.mjs';
import { PARENT_FIELD, SLOT_NAME_RE, clearsOf, clearsWords, loadProfile } from './profile.mjs';
import { appendLog, appendLogLines, firstLine, goalLines, readGoal } from './journal.mjs';
import { outOfGit } from './loop-git.mjs';
import { attachmentOf, journalById, rowLinesText } from './log.mjs';
import { acceptanceLineCount, acceptanceLines, alignRows, bodyText, evidenceNotes, evidenceParts, evidenceTable, loadIssues, mergedOf, noteLogText, noteText, parseIssue, placeEvidence, removeFields, reviewEntries, setSection, sharedMark, struckNote } from './issues.mjs';
import { fileKeysOf, repoNames, reposWhere, tipLinesOf, whereLines, whereOf } from './repositories.mjs';
import { approveKind, carriesCode, inFlightMark, roundSinceLease, sentBack, unmergedCode, unmergedText, gateOf, gateState, reviewSplit, waiverVoid, worksInPlace } from './gate.mjs';
import { coordinatorOf, sameSlice, sliceNamed, sliceOf, slicesOf } from './slices.mjs';
import { disagreementText, headerReadNotes, recordDisagreements } from './disagreements.mjs';
import { readLoop, scopedLoop } from './loop.mjs';
import { checkState, checkWaiting, checkWaitingText, closedNoCheck } from './metrics.mjs';
import { awaitsMerge, builds, gatedMark, modelMarks } from './models.mjs';
import { ago, leaseLiveness, leaseState, livenessOf, thresholdText } from './rounds.mjs';
import { attachmentLines, inspectAttachment, requiredSlots, slotProblems } from './attachments.mjs';
import { ARCHIVE_KEEPS, PERMANENT_MARKER } from './init.mjs';
import { issuesFor, needLifecycle, needLiveLoop, oneOrMany } from './shared.mjs';
import { rowsOf } from './merged.mjs';
import { waitingOn, waitsOf } from './after.mjs';
import { handoffAge, loadAsks, promotionBatch, ratificationBatch } from './questions.mjs';
import { ownerLineNotes, ownerLineWait } from './owner-lines.mjs';
import { lineCounts, lineDigest, lineRowForm, lineStates, lineStateText, noRowOwed, shownRowLines, unprovedMechanical } from './lines.mjs';

// ---- commands: evidence ------------------------------------------------------------------------------

export function cmdEvidence(root, rawIds, text, flags) {
  needNoOwnersWords('the evidence', text, flags);
  const attaching = Boolean(flags) && (flags.file !== undefined || flags.slot !== undefined);
  need(!attaching || (text === undefined && flags.ran === undefined && flags.saw === undefined && flags.retract === undefined), 'evidence takes an attachment (--file with --slot), or free text, or --ran/--saw rows, or a retraction, not both: one call for each', () => ([{ drop: '--file' }, { drop: '--slot' }]));
  if (flags && flags.retract !== undefined) return retractEvidence(root, rawIds, text, flags);
  let rows = null;
  if (attaching) rows = attachmentRow(root, rawIds, flags);
  else if (flags && (flags.ran !== undefined || flags.saw !== undefined)) {
    rows = rowsOf(flags);
    // The log stores a command trimmed and cut to its first line, so the shape is judged on that, in any case.
    need(!rows.some((r) => attachmentOf(String(r.ran).replace(/\r\n?/g, '\n').trim().split('\n')[0].trim().toLowerCase())),'a row shaped as an attachment is written only by --file and --slot, which read the file and record its hash', () => ([{ drop: '--ran' }, { drop: '--saw' }, { flag: '--file', value: hole('<path>') }, { flag: '--slot', value: hole('<slot>') }]));
    need(text === undefined, `evidence takes free text or --ran/--saw rows, not both (got "${text}" as well) — a value starting with -- goes after a bare --, and a command of several words is one quoted --ran`, () => ({ truncate: 2 }));
  } else {
    need(text, 'evidence requires a note or a row', () => ({ arg: 1, value: '<text>' }));
  }
  const issues = issuesFor(root, rawIds);
  const proved = provedLines(root, flags, rows, issues);
  // A row is one list item: the lines of a multi-line command or output after the first are indented under it.
  const indented = (v) => String(v).replace(/\r\n?/g, '\n').trim().split('\n').join('\n  ');
  // The digest of each line named, per issue: the same number is another text in another issue.
  const markOf = (issue) => rowLinesText(proved ? proved.digests.get(issue.id) : []);
  const addedTo = (issue) => (rows ? rows.map((r) => `- **ran${markOf(issue)}:** ${indented(r.ran)} · **saw:** ${indented(r.saw)}`).join('\n') : text);
  for (const issue of issues) {
    const current = (issue.sections.evidence || '').trim();
    writeAtomic(issue.file, setSection(readText(issue.file), 'Evidence', rows ? placeEvidence(current, 'proof', addedTo(issue), '\n') : placeEvidence(current, 'note', noteText(addedTo(issue), current), '\n\n')));
  }
  // Each row line is followed by the tip of the issue's branch, so the gate knows which code the row was made on.
  const tips = rows ? tipLinesOf(root, issues) : () => [];
  appendLogLines(root, issues.flatMap((issue) => (rows ? rows.flatMap((r) => [`${issue.id} evidence row${markOf(issue)} · ${firstLine(r.ran, "the issue's Evidence section")}`, ...tips(issue)]) : [noteLogText(issue.id, text)])));
  return oneOrMany(rawIds, issues.map((issue) => (rows ? { id: issue.id, rows, ...(proved?.numbers.length ? { lines: proved.numbers } : {}) } : { id: issue.id })));
}

// The acceptance lines the --ran/--saw rows of one call prove (--line, repeated or as a comma list), each once and in
// order, read as the numbers the caller gave and, for each issue of the call, the digest of the line at that number now:
// the digest is what a row stores, so a row keeps naming the text it was made for whatever happens to the numbers. A row of
// proof names at least one line, every row of the call names them all, an attachment names none, and a note proves none.
function provedLines(root, flags, rows, issues) {
  if (!flags) return null;
  const attachment = flags.file !== undefined;
  if (flags.line === undefined) {
    // A promise or a wait with no line is kept, not worked: the first row records what came, and has no line to name.
    const kept = (i) => loadProfile(root).keptKind(i.kind) && !acceptanceLineCount(i);
    if (rows && !attachment && !issues.every(kept)) refuse('a --ran/--saw row names the acceptance line it proves, by its number with --line: a row about nothing in particular proves nothing, and a free note is taken without --ran and --saw', { flag: '--line', value: hole('<line-number>') });
    return null;
  }
  const nothing = issues.length > 1 ? ' — nothing was written' : '';
  need(rows && !attachment, '--line names the acceptance lines a --ran/--saw row proves, and a free-text note or an attachment proves none: record the row, or leave --line out', () => ({ drop: '--line' }));
  const given = [].concat(flags.line).flatMap((v) => String(v).split(',')).map((s) => s.trim()).filter(Boolean);
  need(given.length, '--line needs the number of an acceptance line, 1 for the first', () => ({ flag: '--line', value: hole('<line-number>') }));
  for (const v of given) need(/^\d{1,4}$/.test(v) && Number(v) >= 1, `--line takes the number of an acceptance line, 1 for the first, got "${v.slice(0, 20)}"`, () => ({ flag: '--line', value: hole('<line-number>') }));
  const numbers = [...new Set(given.map(Number))].sort((a, b) => a - b);
  const digests = new Map();
  for (const issue of issues) {
    const lines = acceptanceLines(issue);
    const over = numbers.filter((n) => n > lines.length);
    if (!lines.length) refuse(`${issue.id} has no acceptance line, so a row of it can name none: write the acceptance first, ${jarlLine('field', issue.id, 'Acceptance', '<line>')}${nothing}`, ['jarl.mjs', 'field', hole('<id>'), 'Acceptance', hole('<line>')]);
    need(!over.length, `${issue.id} has ${lines.length} acceptance line${lines.length === 1 ? '' : 's'}: there is no line ${over.join(', ')}${nothing}`, () => ({ flag: '--line', value: hole('<line-number>') }));
    digests.set(issue.id, [...new Set(numbers.map((n) => lineDigest(lines[n - 1])))]);
  }
  return { numbers, digests };
}

// A text a reviewer or a retracting hand gives must say something: at least two letters or digits (not "", "-", "x").
const REVIEW_MIN_WORDS = 3;
function needSaid(text, what) {
  const said = (String(text ?? '').match(/[\p{L}\p{N}]/gu) || []).length;
  need(said >= 2, `${what} needs words — what was read and what was found, or why; got "${String(text ?? '').trim().slice(0, 20)}"`, () => ({ arg: 2, value: '<what-was-wrong>' }));
}
function retractedBy(flags, what) {
  need(flags.by !== undefined && fieldText(flags.by), `${what} needs --by <who> — whoever retracts it is recorded with the reason`, () => ({ flag: '--by', value: '<who>' }));
  return fieldText(flags.by);
}
const struck = (line) => line.replace(/^- /, '- ~~');
// The waiver decide --waives-review writes into an issue's notes, as the file holds it: the ruling it names.
const WAIVER_TEXT = /^(?:- )?Ruling (\S+) \(by owner\) waives the review\b/;

function retractEvidence(root, rawIds, reason, flags) {
  need(!isBulk(rawIds), 'retract names one issue and one row or note', () => ({ arg: 0, value: hole('<id>') }));
  need(flags.ran === undefined && flags.saw === undefined, 'a retraction takes a row or note number and a reason, not a new --ran/--saw row', () => ([{ drop: '--ran' }, { drop: '--saw' }]));
  const raw = String(flags.retract);
  const noteRaw = /^note-(\d+)$/.exec(raw);
  if (noteRaw) return retractNote(root, rawIds, reason, flags, Number(noteRaw[1]));
  need(/^\d+$/.test(raw) && Number(raw) >= 1, `retract takes the number of an evidence row as show prints it (1, 2, …) or a note as note-1, note-2, …; got "${raw}"`, () => ({ replace: raw, value: '<n-or-note-n>' }));
  const n = Number(raw);
  const by = retractedBy(flags, 'a retraction');
  needSaid(reason, 'a retraction');
  const [issue] = issuesFor(root, rawIds);
  const text = readText(issue.file);
  const table = evidenceTable(parseIssue(text, issue.file).sections.evidence);
  // The rows a retraction can take: the ones not retracted, by the numbers show prints; with none, a note may be meant.
  const liveRows = table.rows.map((r, k) => (r.retracted ? null : String(k + 1))).filter(Boolean);
  const rowFirst = () => ({ replace: raw, value: hole('<n-or-note-n>') });
  need(table.rows.length > 0, `${issue.id} has no evidence row to retract (got ${raw})`, rowFirst);
  const row = table.rows[n - 1];
  need(row, `${issue.id} has ${table.rows.length} evidence row${table.rows.length === 1 ? '' : 's'}: there is no row ${n}`, rowFirst);
  const live = table.rows.findLastIndex((r) => !r.retracted);
  need(!row.retracted, `row ${n} of ${issue.id} is retracted already${live === -1 ? ', as is every row it holds' : `; row ${live + 1} is not`}`, rowFirst);
  // An issue read from its header has no log rows of its own: its file's rows are the only ones.
  const journalRows = issue.byHeader ? [] : (journalById(root).get(issue.id) || []).filter((e) => e.type === 'row');
  need(journalRows.length === 0 || journalRows.length === table.rows.length, `${issue.id} holds ${table.rows.length} evidence row${table.rows.length === 1 ? '' : 's'} and its log ${journalRows.length}, so the row numbers cannot be matched to the log; nothing was written; what the record holds: ${jarlLine('verify')}`, () => ({ replace: raw, value: '<a-row-the-log-matches>' }));
  need(journalRows.length === 0 || alignRows(issue.id, table.rows, journalRows)[n - 1], `row ${n} of ${issue.id} matches no evidence line of the log, so its retraction could not be told from another row's; nothing was written; what the record holds: ${jarlLine('verify')}`, () => ({ replace: raw, value: '<a-row-the-log-matches>' }));
  const lines = table.lines.slice();
  lines[row.start] = struck(lines[row.start]);
  lines[row.end] = `${lines[row.end].trimEnd()}~~`;
  const entry = `- **retracted:** row ${n} · by ${by} · ${stamp().slice(0, 10)}\n${bodyText(reason).split('\n').map((l) => (l ? `  ${l}` : '')).join('\n')}`;
  writeAtomic(issue.file, setSection(text, 'Evidence', placeEvidence(lines.join('\n').trim(), 'note', entry, '\n')));
  appendLog(root, `${issue.id} evidence retract · row ${n} · by ${by} · ${firstLine(reason, "the issue's Evidence section")}`);
  return { id: issue.id, retracted: n, by };
}

// A free-text note taken back: struck through where it stands, and an entry saying who retracted it and why appended to
// Notes. The note numbers are the ones show prints as note-<n>, counted over the whole section.
function retractNote(root, rawIds, reason, flags, n) {
  need(n >= 1, `retract takes a note as note-1, note-2, …; got "note-${n}"`, () => ({ replace: String(flags.retract), value: '<n-or-note-n>' }));
  const by = retractedBy(flags, 'a retraction');
  needSaid(reason, 'a retraction');
  const [issue] = issuesFor(root, rawIds);
  const text = readText(issue.file);
  const table = evidenceNotes(parseIssue(text, issue.file).sections.evidence);
  // The notes a retraction can take: the ones not retracted, as note-<n>; with none, a row may be meant.
  const given = String(flags.retract);
  const liveNotes = table.notes.map((x, k) => (x.retracted ? null : `note-${k + 1}`)).filter(Boolean);
  const noteFirst = () => ({ replace: given, value: hole('<n-or-note-n>') });
  need(table.notes.length > 0, `${issue.id} has no evidence note to retract (got ${given})`, noteFirst);
  const note = table.notes[n - 1];
  need(note, `${issue.id} has ${table.notes.length} evidence note${table.notes.length === 1 ? '' : 's'}: there is no note ${n} (got ${given})`, noteFirst);
  const live = table.notes.findLastIndex((x) => !x.retracted);
  need(!note.retracted, `note ${n} of ${issue.id} is retracted already${live === -1 ? ', as is every note it holds' : `; note ${live + 1} is not`}`, noteFirst);
  const entry = `- **retracted:** note ${n} · by ${by} · ${stamp().slice(0, 10)}\n${bodyText(reason).split('\n').map((l) => (l ? `  ${l}` : '')).join('\n')}`;
  // A note that carries the owner's quote (a ruling's row) is struck through as it stands: its own lines are carried, so the
  // strike does not read as a new line that looks like his words, while the reason and everything else stay checked.
  const own = table.lines.slice(note.start, note.end + 1).map((l) => l.trim().replace(/^- /, ''));
  carryingOwnersWords(own, () => writeAtomic(issue.file, setSection(text, 'Evidence', placeEvidence(struckNote(table.lines, note).join('\n').trim(), 'note', entry, '\n'))));
  appendLog(root, `${issue.id} evidence retract · note ${n} · by ${by} · ${firstLine(reason, "the issue's Evidence section")}`);
  return { id: issue.id, retractedNote: n, by };
}

// The lines of an Evidence section a worker does not read, by index into `body` (its lines), and how many notes were
// retracted: each retracted note with the blank line that follows it, and the entry that says who retracted a note and
// why, with its indented lines, since a reason often restates the note.
export function retractedNoteLines(body) {
  const { notes } = evidenceNotes(body.join('\n'));
  const hidden = new Set();
  const taken = notes.filter((m) => m.retracted);
  for (const x of taken) for (let i = x.start; i <= x.end + (body[x.end + 1] === '' ? 1 : 0); i += 1) hidden.add(i);
  for (let i = 0; i < body.length; i += 1) {
    if (!/^- \*\*retracted:\*\* note \d+/.test(body[i])) continue;
    hidden.add(i);
    while (i + 1 < body.length && (/^ {2}/.test(body[i + 1]) || (body[i + 1] === '' && /^ {2}/.test(body[i + 2] || '')))) { i += 1; hidden.add(i); }
  }
  return { hidden, count: taken.length };
}
// The line that says how many notes were hidden, so an absence is never silent.
export const retractedNotesText = (n) => `(${n} note${n === 1 ? '' : 's'} retracted, not shown; the reasons are in the log and in show --full)`;
// The Evidence section of an issue as a worker reads it: the text with the retracted notes and their reasons left out, and
// how many notes that was.
export function workerEvidence(text) {
  const body = String(text || '').split('\n');
  const { hidden, count } = retractedNoteLines(body);
  return { text: body.filter((_, i) => !hidden.has(i)).join('\n'), retracted: count };
}

// show <id>: the issue as the done gate sees it. The header, What, Why, Acceptance, Changelog and any section of the
// profile in full; of Reviews and Evidence only the gate's window — every verdict and every --ran/--saw row since
// the last start or reopen — plus every "changes" finding no later approve has answered, and one line for each
// earlier verdict; last, the exact call that prints everything. The window is read from the journal, where the file's
// entries are matched to the log's lines in order: when the file and the log do not agree on how many there are (an
// issue written by hand, a loop without a Reviews section) nothing is cut. Every evidence row carries its
// ordinal [n], counted over the whole section, the number retract takes; --full prints the file with them. With places
// false the lines that name where a repository and the lease's worktree are on this machine, a Worktree field of the
// header among them, are left out, for a text handed to an agent that may run on another one.
export function issueView(root, issue, { full = false, places = true, omit = [] } = {}) {
  const pieces = [];
  let cur = { name: null, lines: [] };
  const text = readText(issue.file);
  // A Worktree field in the header (a lease written by a Jarl that stored the worktree's path) names a place on a machine.
  for (const l of (places ? text : removeFields(text, ['Worktree'])).split('\n')) {
    const h = /^##\s+(.*)$/.exec(l);
    if (h) { pieces.push(cur); cur = { name: h[1].trim().toLowerCase(), lines: [l] }; } else cur.lines.push(l);
  }
  pieces.push(cur);
  // The lines of the section as shown: every row carries [n] and every note [note-n]. A retracted note is struck through
  // in the whole file and left out (null) of the window a worker reads, with the blank line that follows it.
  const numbered = (body, rows) => {
    const { notes } = evidenceNotes(body.join('\n'));
    const { hidden: gone, count } = retractedNoteLines(body);
    const hidden = full ? new Set() : gone;
    const shown = body.map((l, i) => {
      if (hidden.has(i)) return null;
      const r = rows.find((x) => x.start === i);
      // A row names its lines by digest: shown by the numbers they carry now, so a reader sees which line it proves.
      if (r) return (r.lines.length && !full ? l.replace(/\(line [0-9a-f, ]+\)/, `(line ${shownRowLines(issue, r.lines).join(', ')})`) : l).replace(/^- /, `- [${r.n}] `);
      const m = notes.find((x) => x.start === i);
      if (!m) return l;
      // A waiver whose ruling does not count (superseded, or otherwise void) keeps its words and says why it waives nothing.
      const waiver = WAIVER_TEXT.exec(l);
      const why = waiver ? waiverVoid(loop, waiver[1], issue.id) : null;
      return `${l.replace(/^(- )?/, `$1[note-${m.n}] `)}${why ? ` (${why}: it waives nothing)` : ''}`;
    });
    return !full && count ? [...shown, retractedNotesText(count)] : shown;
  };
  const g = full ? null : gateState(root, issue.id);
  const loop = readLoop(jarlDir(root));
  const own = loop.issues.find((i) => i.file === issue.file) ?? issue;
  const lineNotes = g ? lineStates(loop, own, gateOf(loop, own.id)).map(lineStateText) : [];
  const notes = [...recordDisagreements(loop).filter((d) => d.id === issue.id).map(disagreementText), ...headerReadNotes(loop).filter((n) => n.id === issue.id).map((n) => `note: ${n.line}`), ...checkWaiting(loop, [issue]).map(checkWaitingText), ...(places ? whereLines(whereOf(root, issue)) : []), ...ownerLineNotes(root, loop, issue), ...lineNotes, ...treeLines(loop, issue)];
  const out = [];
  for (const p of pieces) {
    if (p.name === null && notes.length) {
      const head = [...p.lines];
      while (head.length && head[head.length - 1].trim() === '') head.pop();
      out.push(...head, ...notes, '');
      continue;
    }
    if (omit.includes(p.name)) continue;
    if (p.name !== 'evidence' && p.name !== 'reviews') { out.push(...p.lines); continue; }
    const body = p.lines.slice(1);
    if (p.name === 'evidence') {
      const t = evidenceTable(body.join('\n'));
      const earlier = !full && g.anchorN >= 0 && g.rowLog.length === t.rows.length ? g.rowLog.filter((r) => r.n <= g.anchorN).length : 0;
      out.push(p.lines[0]);
      const cutNote = `(evidence rows 1-${earlier} came before the last start or reopen and are not shown; ${earlier === t.rows.length ? 'none since' : `rows ${earlier + 1}-${t.rows.length} follow`})`;
      if (earlier > 0 && evidenceParts(body).proofAt === -1 && evidenceParts(body).notesAt === -1) {
        out.push(cutNote);
        out.push(...numbered(body, t.rows).slice(t.rows[earlier - 1].end + 1));
      } else if (earlier > 0) {
        // A section in parts keeps both sub-headings and Notes whole: only the lines of the earlier rows are replaced, by one line.
        const gone = new Set();
        for (const r of t.rows.slice(0, earlier)) for (let i = r.start; i <= r.end; i += 1) gone.add(i);
        const shown = numbered(body, t.rows);
        let said = false;
        shown.forEach((l, i) => { if (!gone.has(i)) out.push(l); else if (!said) { said = true; out.push(cutNote); } });
      } else out.push(...numbered(body, t.rows));
      continue;
    }
    const t = reviewEntries(body.join('\n'));
    out.push(p.lines[0]);
    if (full || !t.entries.length || t.entries.length !== g.trail.length) { out.push(...body); continue; }
    out.push(...body.slice(0, t.entries[0].start));
    t.entries.forEach((e, i) => {
      const open = e.verdict === 'changes' && !t.entries.slice(i + 1).some((x) => x.verdict === 'approve' && !x.retracted);
      if (g.trail[i].n > g.anchorN || open) { out.push(...body.slice(e.start, e.end + 1)); return; }
      const first = body.slice(e.start + 1, e.end + 1).map((l) => l.trim()).find(Boolean);
      const line = `- earlier: ${body[e.start].replace(/^- /, '')}${first ? ` · ${first}` : ''}`;
      out.push(line.length > 200 ? `${line.slice(0, 197)}...` : line);
    });
  }
  const attachments = attachmentLines(root, loadProfile(root), issue);
  const shown = out.filter((l) => l !== null);
  if (full) return attachments.length ? `${shown.join('\n').replace(/\s+$/, '')}\n\n${attachments.join('\n')}\n` : shown.join('\n');
  // A view that leaves sections out is printed for one reader, and the pointer to the whole would hand them back.
  const whole = omit.length ? '' : `\n\nThe whole issue, with every earlier round and row: ${jarlLine('show', issue.id, '--full')}`;
  return `${shown.join('\n').replace(/\s+$/, '')}${attachments.length ? `\n\n${attachments.join('\n')}` : ''}${whole}\n`;
}

// The lines show prints under an issue's header about its place in the tree: the parent it is a sub-issue of, its own
// sub-issues with their statuses, and a Parent that names no issue the loop holds. Read from the loop as loaded, so the
// statuses are the record's.
function treeLines(loop, issue) {
  const own = loop.issues.find((i) => i.file === issue.file);
  if (!own || !own.tree) return [];
  const { parent, children } = own.tree;
  return [
    parent && `sub-issue of ${parent.id} (${parent.status}): ${parent.title}`,
    own.parent !== null && !parent && `its ${PARENT_FIELD} names ${own.parent}, which is no other issue the loop holds`,
    children.length && `sub-issues: ${subsText(children)}`,
  ].filter(Boolean);
}


// By default the issues ready to start and nothing else; --all adds the others, each row carrying its group:
// ready, held-by-file (a file an in-progress or earlier-offered issue holds), waiting-after (After not settled, the
// issue's own or that of an issue above it), waiting-sub (a parent with a sub-issue not settled), held-by-question (an
// open stuck or stop question names the issue or one above it), promise or wait (an issue of that kind, which is never offered to a
// worker: next --as shows it on who holds it). A library caller reads the full list through nextRows and filters it itself.
export const NEXT_GROUPS = ['ready', 'held-by-file', 'held-by-resource', 'waiting-after', 'waiting-sub', 'held-by-question', 'promise', 'wait'];
export function cmdNext(root, flags) {
  const rows = nextRows(root, flags);
  return flags.all ? rows : rows.filter((r) => r.ready);
}

export const modelsTableBuilds = () => builds.modelsTable;
export const nextRowsBuilds = () => builds.nextRows;

// The model of a ready issue as next and resume show it: the default model of the issue's tier.
// The model a ready issue would be raised on; where the profile's models keep it from the tier's default, that default
// and why, and where its reviewer would be beyond what the profile allows, the lighter worker that makes the review possible.
const modelText = (m) => {
  if (!m || (!m.default && !m.over)) return '';
  const what = m.default ? `model ${m.default}` : 'no model the profile allows at this tier or below';
  return `  [${what}${m.over ? ` (in place of ${m.over}, ${m.why})` : ''}${m.review ? ` — ${m.review}` : ''}]`;
};

// What a held row says of the leases that hold its resources: how long ago each was last active (see leaseLiveness), and
// whether that is past the threshold.
export function resourceAgeText(r) {
  const holders = new Map((r.resourceHolders || []).filter((h) => h.ageMs !== undefined).map((h) => [h.by, h]));
  const one = (h) => `last active ${ago(h.ageMs)} ago${h.idle ? `, past the ${thresholdText(h.minutes)} threshold` : ''}`;
  if (!holders.size) return '';
  return holders.size === 1 && r.heldBy.length === 1 ? `, ${one([...holders.values()][0])}` : `; ${[...holders.values()].map((h) => `${h.by} ${one(h)}`).join('; ')}`;
}
const NEXT_HEADERS = { ready: 'Ready', 'held-by-file': 'Held by a file another issue holds', 'held-by-resource': 'Held by a resource another issue holds', 'waiting-after': 'Waiting on After', 'waiting-sub': 'Waiting on their sub-issues', 'held-by-question': 'Held by an open question', promise: 'Promises, kept by who made them', wait: 'Waits on an outside person' };
export function renderNext(rows, all, held = 0) {
  const line = (r) => {
    const note = r.group === 'ready' ? [r.noAcceptance && 'no acceptance yet', r.noFiles && 'no files declared', r.subs && `sub-issues ${r.subs.join(', ')} closed: check its own acceptance against the whole`]
      : r.group === 'waiting-after' ? [`after ${r.after.join(', ')}`]
        : r.group === 'waiting-sub' ? [`sub-issues ${r.subs.join(', ')} not closed`]
        : r.group === 'held-by-question' ? [`question ${r.questions.map((q) => `a-${q}`).join(', ')}`]
          : r.group === 'promise' ? [`promised by ${r.by || 'nobody named'}`]
            : r.group === 'wait' ? [`on ${r.person || 'nobody named'}, check when ${r.checkWhen || 'not said'}`]
          : [`waits on ${[...r.waitsOn, ...(r.resources || []).map((x) => `resource ${x}`)].join(', ')}, held by ${r.heldBy.join(', ')}${resourceAgeText(r)}`];
    return `${r.id}  P${r.priority}  ${r.title}${[...note, r.shared && sharedMark(r.shared)].filter(Boolean).map((n) => `  (${n})`).join('')}${modelText(r.model)}`;
  };
  if (!all) {
    if (rows.length) return rows.map(line).join('\n');
    return held ? `(nothing is ready to start; ${held} open issue(s) are held or waiting — jarl next --all shows which and why)` : '(nothing open)';
  }
  if (!rows.length) return '(nothing open)';
  return NEXT_GROUPS.map((g) => [g, rows.filter((r) => r.group === g)]).filter(([, list]) => list.length)
    .map(([g, list]) => `${NEXT_HEADERS[g]} (${list.length})\n${list.map(line).join('\n')}`).join('\n\n');
}

// flags.slice offers only the issues of that coordinator's slice; flags.perSlice (the ball's) offers every issue, each
// reserving its files against the issues of its own slice only. Across slices only leases hold: a file a lease holds is
// taken for every slice, and a file an open issue of another slice declares is not.
export function nextRows(root, flags = {}) {
  builds.nextRows += 1;
  const profile = loadProfile(root);
  const issues = loadIssues(root);
  const slice = flags.slice === undefined ? null : sliceNamed(goalLines(readGoal(jarlDir(root))).coordinators, issues, flags.slice);
  const inScope = slice === null ? () => true : (i) => sameSlice(sliceOf(i), slice);
  const groupOf = flags.perSlice ? (i) => (sliceOf(i) ?? '').toLowerCase() : () => '';
  // An open question of kind stuck (the default), stop or escalation that names an issue holds that issue back until it
  // is answered, and every issue under it in the tree: no worker is raised on work whose question waits on the owner or
  // the jarl.
  const asked = new Map();
  for (const a of loadAsks(root)) {
    if (a.state !== 'open' || !a.issue || !['stuck', 'stop', 'escalation', null].includes(a.kind)) continue;
    asked.set(a.issue, [...(asked.get(a.issue) || []), a.id]);
  }
  const questionsOn = (i) => [...new Set([i, ...(i.tree ? i.tree.ancestors : [])].flatMap((x) => asked.get(x.id) || []))].sort(cmpId);
  // Files are compared as (repository, path) pairs: the same path in two repositories never holds
  // an issue back, the same file in one repository always does, however its Repo path is spelled.
  const keysOf = (i) => fileKeysOf(root, i);
  // Each taken file with the issue holding it: one in a lease status (in progress), or a dispatchable (open)
  // one offered earlier in this list.
  const leasedFiles = issues.filter((i) => profile.is(i.status, 'holds-claim')).flatMap((i) => keysOf(i).map((k) => [k.key, i.id]));
  // Exclusive resources: names, loop-wide (no repository in the key), held by an issue for its lease's whole life. Resources
  // is a field the tool writes itself, so no profile declares a field of that name and the name has one meaning.
  const resourcesOf = (i) => i.resources.map((name) => ({ name, key: name.toLowerCase() }));
  const leasedRes = issues.filter((i) => profile.is(i.status, 'holds-claim')).flatMap((i) => resourcesOf(i).map((r) => [r.key, i.id]));
  // The files and resources taken in each group of the list (one group, or one per slice): the leases' own, then each
  // issue the list offers.
  const groups = new Map();
  const takenIn = (i) => {
    const g = groupOf(i);
    if (!groups.has(g)) groups.set(g, { taken: new Map(leasedFiles), takenRes: new Map(leasedRes) });
    return groups.get(g);
  };
  const byId = new Map(issues.map((i) => [i.id, i]));
  // The age of the lease that holds a resource, as { ageMs, idle, minutes } (see leaseLiveness); nothing for a holder that
  // is not leased (an open issue offered ahead of it in this list).
  const minutes = livenessOf(goalLines(readGoal(jarlDir(root)))).minutes;
  const ages = new Map();
  const holderAge = (id) => {
    const h = byId.get(id);
    if (!h || !profile.is(h.status, 'holds-claim')) return {};
    if (!ages.has(id)) { const lv = leaseLiveness(root, h, minutes); ages.set(id, lv.ageMs === null ? {} : { ageMs: lv.ageMs, idle: lv.idle, minutes }); }
    return ages.get(id);
  };
  const out = [];
  for (const i of issues.filter((x) => profile.is(x.status, 'dispatchable') && inScope(x)).sort((a, b) => a.priority.localeCompare(b.priority) || cmpId(a.id, b.id))) {
    const { taken, takenRes } = takenIn(i);
    // An issue whose After issues are not all settled (done or dropped), its own or those of an issue above it in the
    // tree, is never offered, whatever its files; nor is a parent while a sub-issue of it is not settled.
    const { after, subs } = waitsOf(i, byId, profile);
    const base = { id: i.id, title: i.title, priority: i.priority, ...(i.files.length ? {} : { noFiles: true }), ...(i.shared ? { shared: i.shared } : {}) };
    // A question holds the issue whatever else it waits on, its After included, so the question's own row knows what it
    // holds up. A parent waits on its open sub-issues, and a question holds it as well: a question on an issue holds every issue under
    // it, so a parent in the middle of a tree is held by a question above it too. Each is a row of its own, the held row
    // first and the waiting row last, so the parent shows under both groups.
    const questions = questionsOn(i);
    if (questions.length) out.push({ ...base, group: 'held-by-question', questions, waitsOn: [], after: [] });
    if (after.length) { out.push({ ...base, group: 'waiting-after', after, waitsOn: [] }); continue; }
    if (subs.length) out.push({ ...base, group: 'waiting-sub', subs, after: [], waitsOn: [] });
    if (subs.length || questions.length) continue;
    // A promise or a wait is kept by who holds it, not worked on by a worker: never offered, and it takes no file.
    if (profile.keptKind(i.kind)) {
      out.push({ ...base, group: i.kind, waitsOn: [], after: [], ...(i.kind === PROMISE_KIND ? { by: fieldText(i.fields['found by']) || null } : { person: fieldText(i.fields.person) || null, checkWhen: fieldText(i.fields['check when']) || null }) });
      continue;
    }
    const keys = keysOf(i);
    const held = keys.filter((k) => taken.has(k.key));
    const heldRes = resourcesOf(i).filter((r) => takenRes.has(r.key));
    if (held.length || heldRes.length) {
      out.push({
        ...base, group: held.length ? 'held-by-file' : 'held-by-resource', waitsOn: held.map((k) => k.f),
        ...(heldRes.length ? { resources: heldRes.map((r) => r.name), resourceHolders: heldRes.map((r) => ({ name: r.name, by: takenRes.get(r.key), ...holderAge(takenRes.get(r.key)) })) } : {}),
        heldBy: [...new Set([...held.map((k) => taken.get(k.key)), ...heldRes.map((r) => takenRes.get(r.key))])], after: [],
      });
      continue;
    }
    keys.forEach((k) => taken.set(k.key, i.id));
    resourcesOf(i).forEach((r) => takenRes.set(r.key, i.id));
    // Offered, but flagged: a worker raised on an issue with no acceptance line has nothing to prove, and
    // the reviewer nothing to check it against. Fill it with field <id> Acceptance before raising one.
    // A parent whose sub-issues are all settled is offered too: its own acceptance is checked against the whole now.
    out.push({ ...base, group: 'ready', files: i.files, ready: true, waitsOn: [], after: [], ...(acceptanceLineCount(i) ? {} : { noAcceptance: true }), ...(i.tree && i.tree.children.length ? { subs: i.tree.children.map((c) => c.id) } : {}) });
  }
  const limit = Number(flags.limit) || Infinity;
  let n = 0;
  const kept = out.filter((r) => { if (!r.ready) return true; n += 1; return n <= limit; });
  // In a loop that declares model lines, a ready issue shows the default model of its tier.
  const marks = modelMarks(root, kept.filter((r) => r.ready).map((r) => byId.get(r.id)));
  return kept.map((r) => (marks.has(r.id) ? { ...r, model: marks.get(r.id) } : r));
}

// The loop's own files git has not committed: in the committed and permanent modes the loop is part of the
// record, and a loop whose code lives in another repository has no merge in its own to ride on, so nothing
// commits it unless someone does. Null — and silent — in the default mode (git never sees the loop) and
// outside a git repository.
export function uncommittedLoopFiles(root) {
  if (!existsSync(jarlDir(root)) || outOfGit(root)) return null;
  if (git(root, ['rev-parse', '--git-dir']) === null) return null;
  const out = git(root, ['status', '--porcelain', '--untracked-files=all', '--', '.jarl']);
  if (out === null) return null;
  // Each line is "XY path"; the output comes back trimmed, so the first line may have lost X's leading space.
  return out.split('\n').filter(Boolean).map((l) => l.replace(/^[ MTADRCU?!]{1,2} /, '')).sort();
}

export function cmdStatus(root, flags = {}) { return statusOf(root, readLoop(jarlDir(root)), flags); }
// The status of a loop already read: a view that shows more than the status reads the loop once for all of it.
function statusOf(root, loop, flags) {
  const threshold = livenessOf(loop.goalLines, flags);
  const { profile } = loop;
  // The count per status. Without a profile the five built-in counts are top-level keys; under a
  // profile they live under their own key, statuses, so no status name can overwrite a key of the view (waiting,
  // ready, stale...). countOf reads either.
  const counts = Object.fromEntries(profile.statuses.map((st) => [st, 0]));
  const c = profile.declared ? { statuses: counts } : counts;
  const every = loop.issues;
  // --tag: every section below is computed over the issues carrying that tag only; an After issue outside the tag is
  // still read for what it is (byId holds them all), so waiting means the same thing in the scope as in the whole.
  // --slice: the same scoping over the issues of one coordinator's slice, and the escalations that name the slice.
  need(flags.tag === undefined || flags.slice === undefined, '--tag and --slice each scope the view: give one', () => ({ rename: '--slice', to: '<no-flag-here>' }));
  if (flags.tag !== undefined) need(typeof flags.tag === 'string' && flags.tag && every.some((i) => i.tags.includes(flags.tag)), `no issue carries the tag ${flags.tag}`, () => ({ flag: '--tag', value: '<a-tag-an-issue-carries>' }));
  const slice = flags.slice === undefined ? null : sliceNamed(loop.goalLines.coordinators, every, flags.slice);
  const scoped = flags.tag !== undefined || slice !== null;
  const issues = flags.tag !== undefined ? every.filter((i) => i.tags.includes(flags.tag)) : slice !== null ? every.filter((i) => sameSlice(sliceOf(i), slice)) : every;
  for (const i of issues) counts[i.status] = (counts[i.status] || 0) + 1;
  // Each status keeps its own count; waiting is the part of those in play (open, in progress) whose After issues
  // are not settled yet, so "in flight" in the text line means someone is working on it.
  const { byId } = loop;
  const unfinished = issues.filter((i) => profile.active(i.status));
  c.waitingIds = unfinished.filter((i) => waitingOn(i, byId, profile).length).map((i) => i.id);
  c.waiting = c.waitingIds.length;
  c.inFlight = unfinished.filter((i) => profile.is(i.status, 'holds-claim') && !c.waitingIds.includes(i.id)).length;
  c.ready = unfinished.filter((i) => profile.is(i.status, 'dispatchable') && !c.waitingIds.includes(i.id)).length;
  c.noAcceptance = issues.filter((i) => profile.is(i.status, 'holds-claim') && !acceptanceLineCount(i)).map((i) => i.id);
  c.lines = lineCounts(loop, issues.filter((i) => i.status !== 'dropped'));
  c.stages = stageCounts(loop, issues);
  const inScope = new Set(issues.map((i) => i.id));
  const asks = loop.asks.filter((a) => a.state === 'open' && (!scoped || (a.issue && inScope.has(a.issue)) || (slice !== null && sameSlice(a.slice ?? null, slice))));
  // A ratify item blocks nothing, so it is not counted among the questions the loop waits on.
  c.questions = asks.filter((a) => a.kind !== 'ratify' && a.kind !== 'escalation' && a.kind !== 'rule').length;
  // The escalations a coordinator sent up, which the jarl answers: counted apart from the owner's questions.
  c.escalations = asks.filter((a) => a.kind === 'escalation').length;
  c.toRatify = asks.filter((a) => a.kind === 'ratify');
  c.ratify = c.toRatify.length;
  // What a session needs to decide between continuing this loop and archiving it: the goal, when the
  // loop was opened, and when anything last happened in it — all read from its own files.
  c.goal = loop.goalLines.goal !== null ? loop.goalLines.goal.trim() : null;
  const log = loop.events;
  c.opened = log.length ? log[0].at : null;
  c.lastActivity = log.length ? log[log.length - 1].at : null;
  const archiveDir = join(jarlDir(root), 'archive');
  c.archived = existsSync(archiveDir) ? readdirSync(archiveDir).length : 0;
  // Leases that look wrong (worktree gone, branch gone, idle), merges waiting on CI, the age of a handoff file left in the loop (JSON only) and the
  // loop files nobody committed: all shown, none acted on.
  const leases = issues.filter((i) => profile.is(i.status, 'holds-claim')).map((i) => ({ id: i.id, ...leaseState(root, i, threshold.minutes, { events: loop.eventsById.get(i.id) || [], approved: awaitsMerge(loop, i) }) }));
  c.stale = leases.map((x) => ({ id: x.id, problems: x.problems })).filter((x) => x.problems.length);
  // The liveness threshold of the call and where it came from, and the ages of every lease in the view (see leaseLiveness).
  c.liveness = { minutes: threshold.minutes, from: threshold.from, leases: leases.map((x) => x.liveness) };
  const live = issues.filter((i) => i.status !== 'dropped');
  c.ciPending = live.filter((i) => mergedOf(i)?.ci === 'pending').map((i) => i.id);
  c.ciRed = live.filter((i) => mergedOf(i)?.ci === 'red').map((i) => i.id);
  c.checkWaiting = checkWaiting(loop, issues);
  c.closedNoCheck = closedNoCheck(loop, issues);
  c.handoff = handoffAge(root, c.lastActivity);
  c.reviews = reviewSplit(!scoped ? loop : scopedLoop(loop, issues));
  c.inFlightRows = inFlightRows(loop, issues);
  c.closedGate = closedGateFlags(!scoped ? loop : scopedLoop(loop, issues));
  const disagreements = recordDisagreements(!scoped ? loop : scopedLoop(loop, issues));
  if (disagreements.length) c.disagreements = disagreements;
  // The numbers read from their headers, one note each: not disagreements, the header is the record for them.
  const byHeader = headerReadNotes(!scoped ? loop : scopedLoop(loop, issues));
  if (byHeader.length) c.headerRead = byHeader;
  const files = uncommittedLoopFiles(root);
  c.uncommitted = files === null ? null : files.length;
  // --group (by, as the library takes it): the same five counts per repository, tag, kind or priority — a dashboard's table, read from the issues.
  if (flags.by !== undefined) {
    // Or a field the profile declares: one group per value it holds.
    const declared = profile.fields.find((f) => f.key === String(flags.by).toLowerCase());
    need(STATUS_BY.includes(flags.by) || declared, `--group is one of: ${[...STATUS_BY, ...profile.fields.map((f) => f.key)].join(', ')} (got "${flags.by}")`, () => ({ flag: '--group', value: hole('<group>') }));
    const keysOf = declared ? (i) => [fieldText(i.fields[declared.key]) || '(none)'] : { repo: (i) => repoNames(root, i), tag: (i) => (i.tags.length ? i.tags : ['(none)']), kind: (i) => [i.kind || '(none)'], prio: (i) => [i.priority] }[flags.by];
    const groups = {};
    for (const i of issues) for (const k of keysOf(i)) {
      const g = (groups[k] = groups[k] || Object.fromEntries(profile.statuses.map((st) => [st, 0])));
      if (Object.hasOwn(g, i.status)) g[i.status] += 1;
    }
    c.by = { key: declared ? declared.key : flags.by, groups: Object.fromEntries(Object.keys(groups).sort().map((k) => [k, groups[k]])), ...(flags.by === 'repo' && !declared ? { where: reposWhere(root, issues) } : {}) };
  }
  // Last, so every key status --json carried before keeps its place.
  if (flags.tag !== undefined) c.tag = flags.tag;
  if (slice !== null) c.slice = slice;
  // The coordinators with their slices, once an issue carries a slice tag.
  if (every.some((i) => sliceOf(i) !== null)) c.slices = slicesOf(loop);
  // In a loop with sub-issues: the parents that wait on their sub-issues alone, and the parents whose sub-issues are all
  // settled, each with the step it stands at (see parentChecks).
  const subWaits = unfinished.map((i) => ({ id: i.id, ...waitsOf(i, byId, profile) })).filter((w) => w.subs.length && !w.after.length).map((w) => ({ id: w.id, subs: w.subs }));
  if (subWaits.length) c.waitingOnSubs = subWaits;
  const parents = parentChecks(loop, issues);
  if (parents.length) c.parents = parents;
  c.check = checkState(loop);
  return c;
}
export const STATUS_BY = ['repo', 'tag', 'kind', 'prio'];

// The stages of the work, in the order the work moves through them: where each issue stands, one count each. A status
// outside the built-in five, of a loop's own profile, keeps a stage of its own name.
const STAGES = ['open', 'in work', 'to examine', 'changes', 'to merge', 'merged', 'done', 'dropped', 'deferred'];
const STAGE_OF_MARK = { 'no-rows': 'in work', 'rows-no-verdict': 'to examine', 'changes-requested': 'changes', approved: 'to merge', 'approved-not-fresh': 'to examine', 'approved-not-cleared': 'to examine', 'approved-model-refused': 'to examine', merged: 'merged', 'merged-ci': 'merged' };
function stageCounts(loop, issues) {
  const { profile } = loop;
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0]));
  for (const i of issues) {
    const stage = profile.is(i.status, 'holds-claim')
      ? (sentBack(loop, i, inFlightMark(loop, i)) ? 'in work' : STAGE_OF_MARK[gatedMark(loop, i).mark])
      : profile.is(i.status, 'dispatchable') ? 'open' : profile.is(i.status, 'closes-record') ? 'done' : i.status;
    counts[stage] = (counts[stage] ?? 0) + 1;
  }
  return counts;
}

// What the record says about one in-flight issue, as one fact and the step it points to (never a status, never stored):
// no evidence rows since the start; rows and no verdict since the last restart or round; changes requested; approved
// (the merge comes next, and then done). A self approve is not a verdict that counts, so it reads as no verdict.
export const IN_FLIGHT_MARKS = {
  'no-rows': 'no evidence rows since the start — the worker has recorded no proof yet',
  'rows-no-verdict': 'evidence rows recorded, no verdict since the last start or round — it waits for a reviewer',
  'changes-requested': 'changes requested — it is back with the worker, who fixes it and records new rows',
  approved: 'approved and queued for the merge — next the merger lands it, then set it done',
  'approved-not-fresh': 'approved by a coordinator only, and it carries code — neither the merge queue nor done accepts that: it waits for a fresh reviewer\'s approve',
  'approved-not-cleared': 'approved, and no approve it holds clears it under the loop\'s done gate — neither the merge queue nor done accepts that: it waits for an approve that does',
  'approved-model-refused': 'approved, and done refuses its approve for its model — neither the merge queue nor done accepts that: it waits for an approve the reviewer rule accepts',
  merged: 'merged — nothing is left to land: set it done',
  'merged-ci': 'merged, CI not green yet — next record the CI result with merged --ci, green or red, then set it done',
};
// The step a mark points to for one issue. An approved issue that carries no code never reaches the merge queue, which
// lists branches, so it is told to be set done and not that it is queued.
const APPROVED_NO_CODE = 'approved, and it carries no code, so no merge waits — next set it done';
// An issue a round sent back whose worker has recorded no row since is the worker's again, not waiting for a reviewer.
const SENT_BACK = 'sent back by a round, no new proof yet — it is back with the worker, who records new rows';
const APPROVED_IN_PLACE = 'approved and worked in place, so no merge waits — next its files are committed, a row names the commit, and it is set done';
// Why an issue's recorded merge does not count for its code as it is now (see unmergedCode), as the words after "and":
// done refuses that merge, so the views ask for the merge again. Null when the issue records no merge, or one that counts.
export function mergeAgainWhy(loop, issue) {
  if (!mergedOf(issue)) return null;
  const u = unmergedCode(issue, gateOf(loop, issue.id));
  if (!u) return null;
  return u.why === 'tip' ? 'the branch has commits after its last merge' : 'its last merge was spent by a later start, reopen or red round';
}
// An approve refused for its model on an issue whose merge counts for its code as it is now: the merge queue has nothing
// left to take, and only done refuses it.
const MODEL_REFUSED_MERGED = 'approved and merged, and done refuses its approve for its model: it waits for an approve the reviewer rule accepts';
const mergedFor = (loop, issue) => Boolean(mergedOf(issue)) && !mergeAgainWhy(loop, issue);
const approvedStep = (loop, issue) => { const again = mergeAgainWhy(loop, issue); return again ? `approved, and ${again} — next the merger lands it again and records the merge, then set it done` : IN_FLIGHT_MARKS.approved; };
// An issue that owes no row reads the same in every view: nothing asks its worker for proof.
const NO_ROW_OWED = 'at work: no row is owed for read lines, and a fresh examiner is raised when it reports';
const SENT_BACK_NO_ROW = 'sent back by a round, back with the worker: no row is owed for read lines';
const CHANGES_NO_ROW = 'changes requested, back with the worker, who fixes it: no row is owed for read lines';
const stepOf = (loop, mark, issue) => (mark === 'approved' && worksInPlace(issue) ? APPROVED_IN_PLACE : mark === 'approved' && !carriesCode(issue) ? APPROVED_NO_CODE : mark === 'approved' ? approvedStep(loop, issue) : sentBack(loop, issue, mark) ? SENT_BACK : IN_FLIGHT_MARKS[mark]);
const inFlightStep = (loop, mark, issue) => {
  if (noRowOwed(issue)) {
    if (sentBack(loop, issue, mark) || (mark === 'no-rows' && roundSinceLease(loop, issue))) return SENT_BACK_NO_ROW;
    if (mark === 'no-rows') return NO_ROW_OWED;
    if (mark === 'changes-requested') return CHANGES_NO_ROW;
  }
  return stepOf(loop, mark, issue);
};
// The rows for the in-flight `issues` of a loop (its own issues, or the ones a view is scoped to). Where the mark ends in
// setting the issue done and an acceptance line only the owner ticks is not ticked, next says that tick comes first. An
// approve the done gate refuses for its model is named with what is missing, in the gate's words.
const ENDS_DONE = new Set(['approved', 'merged', 'merged-ci']);
export function inFlightRows(loop, issues) {
  const { profile, byId } = loop;
  return issues.filter((i) => profile.is(i.status, 'holds-claim') && !waitingOn(i, byId, profile).length).map((i) => {
    const { mark, missing } = gatedMark(loop, i);
    const wait = ENDS_DONE.has(mark) ? ownerLineWait(loop.root, loop, i) : null;
    const step = missing ? `${mergedFor(loop, i) ? MODEL_REFUSED_MERGED : IN_FLIGHT_MARKS[mark]} (${missing})` : inFlightStep(loop, mark, i);
    const next = wait ? step.replace(/set it done$/, `${wait}, then set it done`) : step;
    return { id: i.id, title: i.title, branch: i.fields.branch || null, worker: i.fields.worker || null, model: i.fields.model || null, since: i.fields.since || null, ...leaseWriter(loop, i), mark, next };
  });
}
// The parents in a status that offers them (built-in: open) whose sub-issues are all settled and that wait on nothing else:
// each is on the coordinator of its slice (the jarl, with none) to check its own acceptance against the whole and record
// the check as a proof row, then reviewed and closed. A parent in a lease is worked as any issue in flight is. Each is
// { id, title, subs: [{ id, status }], holder, mark, next }, mark as gatedMark reads it and next the step in words.
export function parentChecks(loop, issues) {
  const { profile, byId } = loop;
  return issues.filter((i) => i.tree && i.tree.children.length && profile.is(i.status, 'dispatchable') && !waitingOn(i, byId, profile).length).map((i) => {
    const { mark } = gatedMark(loop, i);
    const holder = coordinatorOf(loop, i);
    return { id: i.id, title: i.title, subs: i.tree.children.map((c) => ({ id: c.id, status: c.status })), holder, mark, next: parentStep(loop, i, mark, holder) };
  });
}
function parentStep(loop, issue, mark, holder) {
  if (mark === 'no-rows') return `${holder === 'jarl' ? 'the jarl' : holder} checks its own acceptance against the whole and records the check`;
  if (sentBack(loop, issue, mark)) return 'sent back by a round: it is checked against the whole again, then reviewed again';
  if (mark === 'rows-no-verdict') return 'checked against the whole, it waits for a verdict';
  if (mark === 'changes-requested') return 'changes asked on its check: it is checked again, then reviewed again';
  if (mark === 'approved' && !carriesCode(issue)) return 'checked against the whole and approved: set it done';
  return IN_FLIGHT_MARKS[mark];
}
// The sub-issues of a parent with their statuses, as the views print them: 12 done, 13 dropped.
export const subsText = (subs) => subs.map((s) => `${s.id} ${s.status}`).join(', ');

// Who wrote an issue's lease, as { leasedBy }: the writer its last move into a lease status names. A loop whose goal names
// coordinators shows the writer of every lease (null where none is recorded), since several may lease there; in any other
// loop the jarl is the one who leases, and the key is left out when the lease names the jarl or nobody.
export function leaseWriter(loop, issue) {
  const move = (loop.eventsById.get(issue.id) || []).filter((e) => e.type === 'move' && loop.profile.is(e.to, 'holds-claim')).pop();
  const writer = move ? move.writer : null;
  return loop.goalLines.coordinators.length || (writer !== null && writer !== 'jarl') ? { leasedBy: writer } : {};
}
// The writer of a lease as a view prints it.
export const leasedByText = (x) => (x.leasedBy === undefined ? '' : `leased by ${x.leasedBy ?? '(unnamed)'}`);

// A loop opened in the default mode, or opened --committed, has no way to become the
// permanent record other than this: init is the only command that writes .jarl/.permanent for a new
// loop, and mode is the only other one, for an existing one — it never turns the default mode's ignore-everything
// .jarl/.gitignore into the committed one, so a
// default-mode loop (out of git) cannot be switched in place: a permanent record must be committed,
// and only init decides that. Idempotent it is not: running it twice on an already-permanent loop
// refuses clearly instead of silently doing nothing, so a session never mistakes a no-op for a check.
export function cmdMode(root, mode) {
  need(mode, 'mode requires a target: permanent', { arg: 0, value: '<mode>' });
  need(mode === 'permanent', `mode takes "permanent" (got "${mode}")`, { arg: 0, value: hole('<mode>') });
  needLiveLoop(root, '');
  need(!outOfGit(root), 'this loop is out of git (default mode) — a permanent record must be committed, and only init decides .jarl/.gitignore, so there is no in-place switch. Start a fresh loop with', ['jarl.mjs', 'init', '<goal>', '--permanent']);
  need(!existsSync(join(jarlDir(root), '.permanent')), `already a permanent record (.jarl/.permanent exists) — nothing to do; the loop: ${jarlLine('status')}`, { arg: 0, value: hole('<nothing-to-do>') });
  writeAtomic(join(jarlDir(root), '.permanent'), PERMANENT_MARKER);
  appendLog(root, 'mode → permanent · not tied to a feature branch; close keeps the directory');
  return { permanent: true };
}

// The ready part where an act is the owner's (removing a loop that still holds work): the question to put to him, its
// text the caller's to write, the call's author carried.
function askOwner(question, flags) { return ['jarl.mjs', 'ask', question, ...(typeof flags.by === 'string' ? ['--by', flags.by] : [])]; }
export function cmdClose(root, flags = {}) {
  needLiveLoop(root, '');
  needLifecycle(root, 'close', flags.caller);
  // --batch files the ratification batch and closes nothing, so the owner can answer it before the loop goes.
  if (flags.batch) return { closed: false, batch: ratificationBatch(root), promotion: promotionBatch(root) };
  const profile = loadProfile(root);
  const left = loadIssues(root).filter((i) => profile.unfinished(i.status));
  need(flags.force || left.length === 0, `${left.length} issue(s) still open or in progress: ${left.map((i) => i.id).join(', ')} — set each ${profile.with('terminal').filter((st) => profile.is(st, 'settles-dependents') || profile.is(st, 'closes-record')).join(' or ') || profile.with('terminal').join(' or ')}, or report them to the owner, who decides whether the loop closes with them (close --force removes it with them)`, () => askOwner(hole('<question-for-the-owner>'), flags));
  // A permanent loop is a record, not a stage cleared before a merge: close leaves the directory in
  // place and logs the close instead of removing it, so --root still finds the loop afterwards.
  // Deferred work is not open, but it is work that waits: where close removes the directory it would wait nowhere, so
  // the default mode refuses until the deferred issues are archived or --force removes them; a permanent loop keeps them.
  const deferred = loadIssues(root).filter((i) => i.status === 'deferred').map((i) => i.id);
  const permanent = existsSync(join(jarlDir(root), '.permanent'));
  need(permanent || flags.force || deferred.length === 0, `${deferred.length} issue(s) deferred: ${deferred.join(', ')} — close removes .jarl/ with them, and deferred work waits, it is not gone. Keep it: ${jarlLine('archive', '<slug>')} puts the loop under .jarl/archive/ with its deferred issues. Or remove it with them, on the owner's word (close --force)`, () => (['jarl.mjs', 'archive', '<slug>', ...(typeof flags.by === 'string' ? ['--by', flags.by] : [])]));
  // The ratification batch is assembled here and never holds the close: in a permanent loop its items stay open for
  // the owner's word; in a loop on a branch the rulings no one ratified leave with the directory, rulings of that loop.
  // In the committed mode the archive is committed content: leaving it would put .jarl/archive/ on the branch that merges to
  // main, so close refuses while it holds anything, unless --force removes the whole directory.
  const archiveDir = join(jarlDir(root), 'archive');
  const archived = existsSync(archiveDir) ? readdirSync(archiveDir) : [];
  const committedMode = !permanent && !outOfGit(root);
  need(!committedMode || flags.force || archived.length === 0, `.jarl/archive/ holds ${archived.length} archived loop(s): ${archived.join(', ')} — in the committed mode the archive is committed content, and close would leave it on the branch that merges to main. Move it out of the tree, or remove it with the loop on the owner's word (close --force)`, () => askOwner(hole('<question-for-the-owner>'), flags));
  const batch = ratificationBatch(root);
  const promotion = promotionBatch(root);
  // A committed loop's files git never saw are named, not refused: in the permanent mode they (and the closing
  // line) wait for a commit; in the committed mode the removal below is itself the change to commit.
  if (permanent) {
    appendLog(root, `closed · kept as a permanent record${deferred.length ? ` · ${deferred.length} deferred still waiting: ${deferred.join(', ')}` : ''}`);
    const files = uncommittedLoopFiles(root);
    return { closed: true, removed: null, kept: jarlDir(root), leftOpen: left.map((i) => i.id), deferred, uncommitted: files === null ? null : files.length, batch, promotion };
  }
  const files = uncommittedLoopFiles(root);
  // In the default mode an archive is never removed: close removes the live loop's files and leaves the archive, the mode
  // markers and the templates where archive leaves them. In the committed mode the whole directory goes (an archive only with --force).
  const archive = archiveDir;
  const keepArchive = !committedMode && existsSync(archive);
  if (keepArchive) {
    for (const entry of readdirSync(jarlDir(root))) if (!ARCHIVE_KEEPS.has(entry)) rmSync(join(jarlDir(root), entry), { recursive: true, force: true });
  } else rmSync(jarlDir(root), { recursive: true, force: true });
  return { closed: true, removed: jarlDir(root), archiveKept: keepArchive ? archive : null, archiveRemoved: archived.length ? archived : null, kept: null, leftOpen: left.map((i) => i.id), deferred, uncommitted: files === null ? null : files.length, batch, promotion };
}

// The row `evidence <id> --file <path> --slot <name>` writes, after every check; nothing is written here.
function attachmentRow(root, rawIds, flags) {
  need(!isBulk(rawIds), `an attachment names one issue, not ${rawIds}: ${jarlLine('evidence', '<id>', '--file', '<path>', '--slot', '<name>')}`, () => ({ arg: 0, value: hole('<id>') }));
  need(flags.file !== undefined, '--slot needs --file <path>: the file of the slot, relative to the loop root', () => ({ flag: '--file', value: '<path-under-the-loop-root>' }));
  need(flags.slot !== undefined, '--file needs --slot <name>, the slot of the issue\'s kind the file fills', () => ({ flag: '--slot', value: '<name>' }));
  need(typeof flags.file === 'string' && typeof flags.slot === 'string', '--file and --slot each take one value', () => (['jarl.mjs', 'evidence', '<id>', '--file', '<path>', '--slot', '<name>']));
  const slot = flags.slot.trim();
  need(SLOT_NAME_RE.test(slot), `a slot name is lower-case letters, digits and - (starting with a letter or digit, at most 40 characters); got "${slot.slice(0, 40)}"`, () => ({ flag: '--slot', value: '<name>' }));
  const [issue] = issuesFor(root, rawIds);
  const profile = loadProfile(root);
  const specs = requiredSlots(profile, issue);
  const spec = specs.find((s) => s.name === slot);
  const kind = issue.kind || profile.kindDefault;
  need(spec, `the profile declares no slot "${slot}" for an issue of kind ${kind}${specs.length ? ` (its slots: ${specs.map((s) => s.name).join(', ')})` : ` — it requires no slots for that kind, so the file (${flags.file}) is described in a note, with no --file or --slot`}`, () => (specs.length ? { replace: slot, value: hole('<slot>') } : [{ drop: '--file' }, { drop: '--slot' }, { arg: 1, value: hole('<text>') }]));
  const rel = flags.file;
  const read = inspectAttachment(root, issue.id, spec, rel, 'is no such file');
  need(!read.problem, read.missing ? `no such file: ${rel}, under the loop root; e.g. --file <path-under-the-loop-root>` : read.problem, () => ({ flag: '--file', value: '<path-under-the-loop-root>' }));
  return [{ ran: `attach ${slot} ${read.name} sha256:${read.sha256} size:${read.size}`, saw: `slot ${slot}: ${read.size} bytes` }];
}

// The closed issues whose done gate does not hold on the record as it stands, each with its reason and the command that
// repairs it. Read from the journal the gate reads, never stored: the gate refuses at the move, and the record can change
// after it (an approve or a proof row retracted, a merge recorded later, a restart that spent the approve). Every issue
// in a finished status is read: a closing one against the gate's own conditions, any other against the merge it records.
export function closedGateFlags(loop) {
  // An issue closed before the line a conversion ends with was closed under an earlier gate: it is not re-read against this one.
  const convertedAt = loop.events.findLast((e) => e.type === 'converted')?.n ?? -1;
  const { profile } = loop;
  const flags = [];
  for (const issue of loop.issues) {
    if (!profile.is(issue.status, 'terminal')) continue;
    const id = issue.id;
    const events = loop.eventsById.get(id) || [];
    if ((events.findLast((e) => e.type === 'move')?.n ?? -1) < convertedAt) continue;
    const merges = events.filter((e) => e.type === 'merged');
    const reasons = []; const repairs = [];
    const flag = (reason, repair) => { reasons.push(reason); if (!repairs.includes(repair)) repairs.push(repair); };
    const reopen = jarlLine('set', id, 'open', '<text>');
    if (!profile.is(issue.status, 'closes-record')) {
      if (merges.length || mergedOf(issue)) flag(`a merge is recorded on a ${issue.status} issue`, reopen);
    } else {
      const g = gateOf(loop, id);
      if (!g.tracked) continue;
      const code = carriesCode(issue);
      // Read as the gate reads it now: a closed issue's lines lost their proof when a row was retracted or a line was
      // rewritten after the close.
      for (const s of unprovedMechanical(lineStates(loop, issue, g))) flag(`acceptance ${lineStateText(s)}`, lineRowForm(id));
      for (const p of slotProblems(loop.root, profile, issue, g, false)) flag(`slot ${p.slot}: ${p.what}`, p.fix);
      if (profile.doneGate.approve !== 'none') {
        const fresh = jarlLine('review', id, 'approve', '--by', '<a-fresh-reviewer>', '--model', '<model-id>', '<text>');
        const kind = approveKind(g);
        if (g.selfApproved) flag('its live approve is by a worker of this issue or its branch', fresh);
        else if (!g.approved) flag(kind === 'retracted' ? 'its approve was retracted' : g.trail.some((r) => r.verdict === 'approve') ? 'its approve is spent by a later round, restart, reopen or changes verdict' : 'it holds no approve', fresh);
        // The reading done, the merge queue and the line after a verdict take: the approves clear the issue as it is, with
        // code or without. The cause is named (the fresh-review rule on code, a bot the done gate does not name, or the loop's
        // own definition), with every approve that stands and does not clear it.
        else if (!g.cleared) {
          const held = `the approves it holds are by ${g.uncleared.standing.join(', ')}`;
          if (code && g.uncleared.cause === 'coordinator') flag(`it carries code and holds no fresh approve (${held})`, fresh);
          else if (g.uncleared.cause === 'bot') flag(`its live approve is a bot's, which clears an issue only where the loop's done gate names that bot (${held})`, fresh);
          else flag(`it holds no approve that clears it under the loop's done gate (done-gate "clears": ${clearsWords(clearsOf(profile))}; ${held})`, jarlLine('review', id, 'approve', '--by', '<reviewer>', '--model', '<model-id>', '<text>'));
        }
      }
      const doneAt = Math.max(-1, ...events.filter((e) => e.type === 'move' && profile.is(e.to, 'closes-record')).map((e) => e.n));
      if (merges.some((m) => m.n > doneAt)) flag('a merge was recorded after it went done', reopen);
      const unmerged = unmergedCode(issue, g);
      if (unmerged) flag(unmerged.why === 'none' ? 'a code issue done with no merge recorded' : `a code issue done, and ${unmergedText(unmerged)}`, reopen);
    }
    // Reopening resets the row and the approve, so when it is one of several repairs it comes first: the others would be wasted.
    if (repairs.length > 1 && repairs.includes(reopen)) repairs.splice(0, repairs.length, `${reopen} (it resets the row and the approve, so do it first)`, ...repairs.filter((r) => r !== reopen));
    if (reasons.length) flags.push({ id, reason: reasons.join('; '), repair: repairs.join(' ; ') });
  }
  return flags;
}

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { REVIEW_MIN_WORDS, modelText, needSaid, retractedBy, statusOf, struck };
