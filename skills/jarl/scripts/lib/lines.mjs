// The acceptance lines of an issue as the chain reads them. A line is written `[method] the requirement · key: value`,
// the method one of five, and its method says what counts as its proof: test, check and compare a counted row naming the
// line by the holder of the lease and one by a name that has not held it (a check on the declared command is proved by the
// landing's check instead), compare two of the holder's rows with identical saw besides; read a live approve; owner his
// tick. A row names its line by a digest of the line's text, so inserting or rewording a line moves no proof onto
// another requirement; a caller still names a line by its number, read against the lines as they are when the row is written.

import { createHash } from 'node:crypto';
import { fieldText, hole, jarlLine, need } from './base.mjs';
import { acceptanceLines, alignRows, evidenceTable, findIssue } from './issues.mjs';
import { jarlDir } from './where.mjs';
import { carriesDeclared, declaredFor } from './metrics.mjs';
import { repoNames } from './repositories.mjs';
import { gateOf } from './gate.mjs';
import { readLoop } from './loop.mjs';
import { needOwnerLine, ownerLineStates } from './owner-lines.mjs';

export const METHODS = Object.freeze(['test', 'check', 'compare', 'read', 'owner']);
const MECHANICAL = new Set(['test', 'check', 'compare']);
export const METHODS_TEXT = 'test, check, compare, read or owner';
// The form a refusal of a line ends with: the five, the placeholder of the requirement, and no value of the caller's.
export const LINE_FORM = hole('<test-check-compare-read-or-owner-line>');
const COMPARE_FORM = hole('<compare-line-with-by-command>');
const MARK = /^\[([^\]]*)\]\s*(.*)$/s;
const SEPARATOR = / · |^· /;
const PAIR = /^([a-z][a-z-]*):\s*(.*)$/;
const PLACEHOLDER = /^<.*>$/;
// The keys a line of each method may name after its text: any other key is refused, so a typo is never taken for the
// proof it was meant to name. `by` is the command that proves the line, read by the examiner; an owner line's material and
// what to check are read by its own reader.
const KEYS = Object.freeze({ test: ['by'], check: ['by'], compare: ['by'], read: [], owner: ['material', 'check'] });

// The digest a row stores for the line it names: of the line's whole text, mark and keys included, as a change of any of
// them is another requirement.
export const lineDigest = (text) => createHash('sha256').update(String(text)).digest('hex').slice(0, 12);

// One acceptance line read: { text, method, marked, what, by }. A line with no mark, or a mark that is none of the five,
// reads as read, and marked false; keys are read by their place, as much as the line holds.
export function readLine(text) {
  const m = MARK.exec(text);
  const method = m && METHODS.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
  if (!method) return { text, method: 'read', marked: false, what: text, by: null };
  const parts = m[2].split(SEPARATOR).map((p) => p.trim());
  const key = (name) => parts.slice(1).map((p) => PAIR.exec(p)).filter(Boolean).find(([, k]) => k === name)?.[2]?.trim() || null;
  return { text, method, marked: true, what: parts[0], by: key('by') };
}

// Why a line given to new or field is refused, or null: as `[method] text · key: value`, one of the five, a text, every
// part after it a key this method takes with a value, a compare naming its command. An owner line is read by its own reader.
function lineProblem(text) {
  const m = MARK.exec(text);
  const method = m ? m[1].toLowerCase() : null;
  if (!METHODS.includes(method)) return `is not headed by its method`;
  if (method === 'owner') return null;
  const parts = m[2].split(SEPARATOR).map((p) => p.trim());
  if (!parts[0]) return 'names no requirement';
  for (const part of parts.slice(1)) {
    const pair = PAIR.exec(part);
    if (!pair) return `holds "${part}", which is no key: value pair`;
    if (!KEYS[method].includes(pair[1])) return `holds the key ${pair[1]}, which a ${method} line does not take`;
    if (!pair[2].trim() || PLACEHOLDER.test(pair[2].trim())) return `holds the key ${pair[1]} with no value`;
  }
  if (method === 'compare' && !readLine(text).by) return 'is a compare line that names no command';
  return null;
}
// The lines an acceptance text given to new or field holds, each in the form above, the first one that is not refused
// with the form that names the five. True when the text holds an owner line (its first write raises the format).
export function needMarkedLines(acceptance, ready) {
  let ownerLined = false;
  for (const text of acceptanceLines({ sections: { acceptance } })) {
    if (MARK.exec(text)?.[1].toLowerCase() === 'owner') { needOwnerLine(text, ready); ownerLined = true; continue; }
    const problem = lineProblem(text);
    const compare = MARK.exec(text)?.[1].toLowerCase() === 'compare' && !readLine(text).by;
    need(!problem, `acceptance line "${text}" ${problem}: a line is written "[method] the requirement · key: value", the method one of ${METHODS_TEXT} — test a behaviour a test proves, check a command (by: <command>, or the goal's declared check when none is given), compare output that must stay the same (by: <command> is required), read what only judgement proves, owner what the owner looks at himself`, () => (compare ? ready(COMPARE_FORM) : ready(LINE_FORM)));
  }
  return ownerLined;
}

// The rows of an issue a line's proof can stand on: inside the gate's window and not retracted, each with its writer, what it
// names and what it printed. A row of an issue the log holds nothing of has no writer: it counts for no side.
function countedRows(issue, g) {
  const table = evidenceTable(issue.sections.evidence).rows;
  if (!g.tracked) return table.filter((r) => !r.retracted && r.saw !== '').map((r) => ({ by: null, lines: r.lines, saw: r.saw }));
  const aligned = alignRows(issue.id, table, g.rowLog);
  const out = [];
  table.forEach((r, k) => {
    const j = aligned[k];
    if (j && !j.retracted && j.inWindow) out.push({ by: j.writer ?? null, lines: r.lines, saw: r.saw });
  });
  return out;
}
// The check of the merge that counts for the code as it is now, read for a check line on the declared command: whether
// such a merge carries the declared command this line names, or any the issue's repositories declare where it names none.
function landedOn(loop, issue, g, line) {
  const merges = g.countedMerges();
  if (!merges.length) return false;
  const declared = [...new Set(repoNames(loop.root, issue).flatMap((n) => declaredFor(loop, n)))];
  const wanted = line.by ? declared.filter((c) => fieldText(c) === fieldText(line.by)) : declared;
  return wanted.length > 0 && merges.some((m) => carriesDeclared({ check: m.check }, wanted));
}
// Whether a check line is on the declared command: it names none, or the one it names is declared for a repository of the issue.
function onDeclared(loop, issue, line) {
  if (!line.by) return true;
  return repoNames(loop.root, issue).some((n) => declaredFor(loop, n).some((c) => fieldText(c) === fieldText(line.by)));
}

const sameName = (a, b) => fieldText(a).toLowerCase() === fieldText(b).toLowerCase();

// The state of each acceptance line, computed from the gate: { n, text, digest, method, what, by, state, missing }, state
// one of unproved, proved (test, check, compare), judged (read) or ticked (owner); missing says what the method still asks
// for, null when nothing. The rows the method counts are the ones naming the line's digest inside the window; the holder
// is any name that has held the issue's lease, and with no lease on record one named row is what the method asks.
export function lineStates(loop, issue, g = gateOf(loop, issue.id)) {
  const texts = acceptanceLines(issue);
  if (!texts.length) return [];
  const holders = [...g.workers];
  const heldBy = (name) => holders.some((w) => sameName(w, name));
  const rows = countedRows(issue, g);
  const owner = new Map(ownerLineStates(loop.root, loop, issue).map((s) => [s.n, s]));
  return texts.map((text, k) => {
    const n = k + 1;
    const line = readLine(text);
    const digest = lineDigest(text);
    const base = { n, text, digest, method: line.method, what: line.what, by: line.by };
    if (line.method === 'owner') {
      const o = owner.get(n);
      return { ...base, state: o && o.tick ? 'ticked' : 'unproved', missing: o && o.tick ? null : 'the owner\'s tick' };
    }
    if (line.method === 'read') {
      const judged = g.approved || loop.profile.doneGate.approve === 'none';
      return { ...base, state: judged ? 'judged' : 'unproved', missing: judged ? null : 'a live approve that quotes it' };
    }
    const naming = rows.filter((r) => r.lines.includes(digest));
    const named = naming.filter((r) => r.by);
    if (line.method === 'check' && onDeclared(loop, issue, line) && landedOn(loop, issue, g, line)) return { ...base, state: 'proved', missing: null };
    const missing = [];
    const byHolder = named.filter((r) => heldBy(r.by));
    if (holders.length) {
      if (!byHolder.length) missing.push('a counted row naming it by the holder of the lease');
      if (!named.some((r) => !heldBy(r.by))) missing.push('a counted row naming it by a name that has not held the lease');
    } else if (!named.length) missing.push('a counted row by a named writer');
    if (line.method === 'compare') {
      const counts = new Map();
      for (const r of holders.length ? byHolder : named) counts.set(r.saw, (counts.get(r.saw) || 0) + 1);
      if (![...counts.values()].some((c) => c >= 2)) missing.push(holders.length ? 'two rows by the holder with identical --saw' : 'two rows with identical --saw');
    }
    if (missing.length && line.method === 'check' && onDeclared(loop, issue, line)) missing.push('or the landing on the declared check');
    return { ...base, state: missing.length ? 'unproved' : 'proved', missing: missing.length ? missing.join(', ') : null };
  });
}
// The rows counted for an issue's lines, with what they ran, so a brief can offer them to re-run.
export function countedRowsOf(issue, loop) {
  const g = gateOf(loop, issue.id);
  const ran = new Map(evidenceTable(issue.sections.evidence).rows.map((r) => [`${r.saw}\n${r.lines.join()}`, r.ran]));
  return countedRows(issue, g).map((r) => ({ ...r, ran: ran.get(`${r.saw}\n${r.lines.join()}`) ?? '' }));
}
// The changes of an issue's lines since its current lease started, as { at, by, removed, added }, each read from the old text the
// log keeps whole; none for an issue no lease holds, or whose lines are as they were.
export function lineChanges(loop, issue) {
  const events = loop.eventsById.get(issue.id) || [];
  const claim = (st) => loop.profile.is(st, 'holds-claim');
  const start = [...events].reverse().find((e) => e.type === 'move' && claim(e.to) && (!claim(e.from) || e.handover));
  if (!start) return [];
  const changes = events.filter((e) => e.type === 'body' && e.part === 'acceptance' && e.n > start.n && e.was !== null);
  const texts = changes.map((c) => acceptanceLines({ sections: { acceptance: c.was } }));
  const sets = [...texts, acceptanceLines(issue)];
  return changes.map((c, k) => {
    const now = sets[k + 1];
    const was = sets[k];
    return { at: c.at, by: c.by ?? c.writer ?? null, removed: was.filter((l) => !now.includes(l)), added: now.filter((l) => !was.includes(l)) };
  }).filter((c) => c.removed.length || c.added.length);
}

// The numbers of the lines an issue's worker still owes a row for, before a review is offered: test and compare lines, and
// check lines that state a command of their own: each needs a counted row naming it by a holder of the lease. A check
// on the declared command is the landing's to prove, and a read line needs no row.
export function workerRowsMissing(loop, issue, g = gateOf(loop, issue.id)) {
  const holders = [...g.workers];
  const heldBy = (name) => holders.some((w) => sameName(w, name));
  const rows = countedRows(issue, g).filter((r) => r.by && (!holders.length || heldBy(r.by)));
  return acceptanceLines(issue).flatMap((text, k) => {
    const line = readLine(text);
    const asked = line.method === 'test' || line.method === 'compare' || (line.method === 'check' && !onDeclared(loop, issue, line));
    return asked && !rows.some((r) => r.lines.includes(lineDigest(text))) ? [k + 1] : [];
  });
}
// The lines whose rows done still asks for: the mechanical lines the rows and the landing leave unproved.
export const unprovedMechanical = (states) => states.filter((s) => MECHANICAL.has(s.method) && s.state === 'unproved');
// One line's state as a line of text, the way show and the refusals say it.
export const lineStateText = (s) => `line ${s.n} [${s.method}] ${s.state}${s.missing ? `: ${s.missing}` : ''}`;
const BY_METHOD = () => Object.fromEntries(METHODS.map((m) => [m, 0]));
const BY_STATE = () => ({ unproved: 0, proved: 0, judged: 0, ticked: 0 });
// The lines of a set of issues, counted by method and by state: the honest answer to how much of the work rests on opinion.
export function lineCounts(loop, issues) {
  const byMethod = BY_METHOD();
  const byState = BY_STATE();
  for (const issue of issues) {
    for (const s of lineStates(loop, issue)) { byMethod[s.method] += 1; byState[s.state] += 1; }
  }
  return { byMethod, byState, total: Object.values(byMethod).reduce((a, b) => a + b, 0) };
}
export function linesCountText(c) {
  const methods = METHODS.map((m) => `${c.byMethod[m]} ${m}`).join(' · ');
  const states = Object.entries(c.byState).map(([k, v]) => `${v} ${k}`).join(', ');
  return `lines: ${methods} (${states})`;
}

// A row's lines as a person reads them: each digest as the number of the line that carries it now, or the digest and that
// it is no line now.
export function shownRowLines(issue, digests) {
  const texts = acceptanceLines(issue);
  return digests.map((d) => { const k = texts.findIndex((t) => lineDigest(t) === d); return k === -1 ? `${d} not a line now` : String(k + 1); });
}

// The lines an issue held when its current lease started, and what they are now: { at, worker, lines, now, changed }, the
// lines one per entry as acceptanceLines gives them. Read from the log, which keeps the whole old text of every change of
// the lines; null for an issue no lease has held. The lease is its last move into a status that holds the claim that was a
// start or a handover: a renewal of the same lease changes nothing it was started on.
export function linesAtLease(loop, issue) {
  const events = loop.eventsById.get(issue.id) || [];
  const claim = (st) => loop.profile.is(st, 'holds-claim');
  const start = [...events].reverse().find((e) => e.type === 'move' && claim(e.to) && (!claim(e.from) || e.handover));
  if (!start) return null;
  const change = events.find((e) => e.type === 'body' && e.part === 'acceptance' && e.n > start.n && e.was !== null);
  const lines = change ? acceptanceLines({ sections: { acceptance: change.was } }) : acceptanceLines(issue);
  const now = acceptanceLines(issue);
  return { at: start.at, worker: start.lease?.worker ?? null, lines, now, changed: lines.join('\n') !== now.join('\n') };
}
// The text of show --at-lease: the lines as they were at the lease and as they are now, or the note that no lease is on record.
export function atLeaseText(issue, atLease) {
  if (!atLease) return `${issue.id} holds no lease on record, so there are no lines as they were at a lease; its lines are the ones show prints`;
  const list = (lines) => (lines.length ? lines.map((l) => `- ${l}`) : ['- (none)']);
  const head = `the lines as they were at the lease of ${atLease.at}${atLease.worker ? ` (worker ${atLease.worker})` : ''}:`;
  if (!atLease.changed) return [head, ...list(atLease.lines), '', 'unchanged since the lease'].join('\n');
  return [head, ...list(atLease.lines), '', 'the lines as they are now:', ...list(atLease.now)].join('\n');
}
// The evidence form a line's proof is recorded with, its number the caller's.
export const lineRowForm = (id) => jarlLine('evidence', id, '--ran', '<command>', '--saw', '<what-it-printed>', '--line', '<line-number>', '--by', '<who>');
export const LINE_ROW_READY = () => ['jarl.mjs', 'evidence', hole('<id>'), '--ran', hole('<command>'), '--saw', hole('<what-it-printed>'), '--line', hole('<line-number>'), '--by', hole('<who>')];
export const issueLinesAtLease = (root, rawId) => {
  const loop = readLoop(jarlDir(root));
  const issue = findIssue(root, rawId);
  return issue ? { issue, atLease: linesAtLease(loop, loop.byId.get(issue.id) || issue) } : null;
};
