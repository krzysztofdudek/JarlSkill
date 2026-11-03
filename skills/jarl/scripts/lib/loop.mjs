// The loaded loop: every issue with the state the log gives it, the done gate's window, and where a header and the
// log disagree.

import { resolve, dirname, basename } from 'node:path';
import { CI_STATES, fieldText } from './base.mjs';
import { jarlDir } from './where.mjs';
import { idKey, idRe } from './ids.mjs';
import { profileAt } from './profile.mjs';
import { asksAt, decisionsAt, goalLines, readGoal } from './journal.mjs';
import { eventsById, loopEvents } from './log.mjs';
import { alignRows, evidenceTable, issuesAt, mergedOf, settledNote, sharedNumberText, sharedNumbers } from './issues.mjs';
import { branchTip } from './repositories.mjs';

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
//   branchWorkers every worker leased on each Branch, across every issue that records it
// goal, goalLines, asks, decisions, coordinators and branchWorkers are read on first use.
export function readLoop(dir) {
  const root = basename(dir) === '.jarl' ? dirname(dir) : dir;
  const profile = profileAt(dir);
  const events = loopEvents(dir, profile);
  return makeLoop({ dir, root, profile, issues: issuesAt(dir, profile, events), events });
}
function makeLoop({ dir, root, profile, issues, events }) {
  const loop = { dir, root, profile, issues, byId: new Map(issues.map((i) => [i.id, i])), events, eventsById: eventsById(events) };
  const once = (make) => { let made = false; let value; return () => { if (!made) { value = make(); made = true; } return value; }; };
  const reads = {
    goal: once(() => readGoal(dir)),
    goalLines: once(() => goalLines(loop.goal)),
    asks: once(() => asksAt(dir)),
    decisions: once(() => decisionsAt(dir)),
    coordinators: once(() => coordinatorsIn(root, loop.goalLines)),
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
// issue into that the loop's profile does not list (field 'profile': the line reads as a note, not as a move), and one per number two issue files carry (field 'number', with the files) and one per number the log files more than once with no note after it saying how that was settled (field 'refiled'), each in place of the fields. The
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
    // A number the log files more than once named several files at once, so its lines cannot be told apart: the header is
    // not compared with them until a note after the last filing says how that was settled.
    const unsettled = refiledUnsettled(loop.eventsById.get(id) || [], id);
    if (unsettled) {
      out.push({ id, field: 'refiled', onFile: null, record: null, files: [`issues/${basename(issue.file)}`], line: `record: the log files ${id} ${unsettled} times, so its lines for ${id} once named ${unsettled} issue files and cannot be told apart; the header of issues/${basename(issue.file)} is not compared with them, and the log's value is never to be written into it — when the log's status for ${id} is not the one the file reads, move it there (jarl.mjs set ${id} <status>), then write which earlier lines were whose: jarl.mjs log "${settledNote(id)}"` });
      continue;
    }
    if (issue.onFile === null) {
      const status = profile.statuses.includes(issue.status) ? issue.status : profile.initial;
      out.push({ id, field: 'journal', onFile: issue.status, record: null, line: `record: ${id} is not in the log (it holds no filing and no move), so its header is read as it stands — to put it in the log: jarl.mjs set ${id} ${status}${profile.is(status, 'needs-reason') ? ' "<why>"' : ''}${profile.is(status, 'closes-record') ? ' (through its checks)' : ''}` });
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
  out.push(...unreadableMoves(loop));
  return out;
}
// The number of filings of `id` in its events when there are several and no `<id> number settled` note follows the last
// of them; 0 otherwise.
function refiledUnsettled(events, id) {
  const filings = events.filter((e) => e.type === 'filed');
  if (filings.length < 2) return 0;
  const last = filings[filings.length - 1].n;
  return events.some((e) => e.n > last && e.type === 'other' && e.text.startsWith(`${id} number settled`)) ? 0 : filings.length;
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
    return `jarl.mjs set ${id} ${file}${profile.is(file, 'needs-reason') ? ' "<why>"' : ''} (a move into ${file}${profile.is(file, 'closes-record') ? ', through its checks' : ''})`;
  }
  if (LEASE_KEYS.includes(field)) {
    return profile.is(issue.status, 'holds-claim') ? `jarl.mjs set ${id} ${issue.status} --${field} ${file} (a new move line, which stamps Since again)` : '';
  }
  if (field === 'merged') {
    const merge = /^\S+(?: in .+)?$/.test(file) ? mergedOf({ fields: { merged: file } }) : null;
    if (!merge) return '';
    const ci = fieldText(issue.onFile.ci);
    return `jarl.mjs merged ${id} --sha ${merge.sha}${merge.repo ? ` --repo ${merge.repo}` : ''}${CI_STATES.includes(ci) ? ` --ci ${ci}` : ''} --keep (a new merge line)`;
  }
  if (field === 'ci') return CI_STATES.includes(file) && issue.fields.merged ? `jarl.mjs merged ${id} --ci ${file} (a new CI line)` : '';
  return '';
}
// One entry for a header field that differs from the log. Its `rewrite` (not enumerable, so not in the JSON) is the
// command that writes the header from the log without a hand edit and without a line.
function fieldDisagreement(profile, issue, field, file, record) {
  const name = FIELD_NAMES[field];
  const follow = record ? `write **${name}:** ${record} back into the header` : `remove the **${name}:** line from the header`;
  const make = makeFileTheRecord(profile, issue, field, file);
  const entry = { id: issue.id, field: name, onFile: file || null, record: record || null, line: `record: ${issue.id} ${disagreementSentence(name, file, record)}, which is the record — to follow the log, ${follow}${make ? `; to make the file's value the record, ${make}` : ''}` };
  Object.defineProperty(entry, 'rewrite', { value: `jarl.mjs set ${issue.id} ${issue.status} --header`, enumerable: false });
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
    if (!m || idKey(m[1]) !== idKey(e.id) || loop.profile.statuses.includes(m[2])) continue;
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

// Who reviewed, as a kind: the word self, or anyone who has ever held the issue's lease — its own worker across
// every takeover, and the worker of any other issue sharing its Branch (a package, or an issue folded into the
// same branch later) — is self too; the loop's own director — coordinator, jarl, reeve, the loop's own name (the
// directory holding .jarl/) and any name the goal declares on a `Coordinators: a, b` line (coordinator); anyone
// else (fresh). A name is compared without case and surrounding space. `worker` is a name, or a set of them.
export const BASE_COORDINATORS = ['coordinator', 'jarl', 'reeve'];
export function reviewerKind(by, worker, coordinators = BASE_COORDINATORS) {
  const b = fieldText(by).toLowerCase();
  const workers = worker == null ? [] : typeof worker === 'string' ? [worker] : [...worker];
  if (b === 'self' || workers.some((w) => b === fieldText(w).toLowerCase())) return 'self';
  if (coordinators.some((c) => fieldText(c).toLowerCase() === b)) return 'coordinator';
  return 'fresh';
}
// The names that review as the loop's director in this loop: the fixed three, the loop's own name, and the names
// a `Coordinators:` line of the goal lists (see goalLines).
export function coordinatorNames(root) { return coordinatorsIn(root, goalLines(readGoal(jarlDir(root)))); }
function coordinatorsIn(root, lines) { return [...BASE_COORDINATORS, basename(resolve(root)), ...lines.coordinators]; }
const KIND_WEIGHT = { fresh: 0, coordinator: 1, self: 2 };
// An issue carries code when it records a branch or a merge. Only then does done (and the merge queue) need a
// fresh approve; an issue with neither — a ruling, a note, a hub document — is still cleared by the coordinator.
export function carriesCode(issue) { return Boolean(fieldText(issue.fields.branch) || fieldText(issue.fields.merged)); }

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
// - the live approve is the strongest one (fresh over coordinator over self) among those since whatever last
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
export function gateOf(loop, id) {
  const { profile, coordinators } = loop;
  const events = loop.eventsById.get(id) || [];
  const issue = loop.issues.find((i) => i.id === id) || null;
  const self = selfWorkers(events, issue, loop.branchWorkers);
  const { anchor, cut } = gateWindow(profile, events);
  // The window no pause opens. A row or an approve between it and the window above counts when the tip it was made on is
  // the branch's tip now: a pause and a resume leave the code as it was, and a new commit spends them.
  const firm = gateWindow(profile, events, { throughPauses: true });
  const firmAnchorN = firm.anchor ? firm.anchor.n : -1;
  const anchorN = anchor ? anchor.n : -1;
  const evidence = []; const allReviews = [];
  const trail = [];   // every review line in order (approve, changes, retract), for the issue view
  const retractedRows = [];
  // A tip line belongs to the line of the same issue just before it: a row, a verdict or a merge.
  let before = null;
  let mergeTip = null;   // the tip the newest merge was recorded on
  for (const e of events) {
    if (e.type === 'tip') {
      if (before && before.type === 'merged') mergeTip = e.tip;
      else if (before && before.tip === undefined) before.tip = e.tip;
      before = null;
      continue;
    }
    before = null;
    if (e.type === 'merged') { before = e; mergeTip = null; continue; }
    if (e.type === 'verdict') {
      // The kind is the one recorded, or the one today's names give, whichever is stricter: a name the goal
      // declares as a coordinator after its approve was logged as fresh does not stay fresh, and a name that
      // turns out to have ever held the lease (self) does not stay fresh or coordinator either.
      let kind = e.kind;
      if (kind && e.by) { const now = reviewerKind(e.by, self, coordinators); if (KIND_WEIGHT[now] > KIND_WEIGHT[kind]) kind = now; }
      const review = { n: e.n, at: e.at, verdict: e.verdict, by: e.by, kind, retracted: false };
      allReviews.push(review);
      trail.push(review);
      before = review;
      continue;
    }
    // A retraction takes away the newest approve not yet retracted, and only that: it never touches a changes verdict.
    if (e.type === 'retract-review') {
      const target = [...allReviews].reverse().find((x) => x.verdict === 'approve' && !x.retracted);
      if (target) target.retracted = true;
      trail.push({ n: e.n, at: e.at, verdict: 'retract', retracted: false });
      continue;
    }
    if (e.type === 'retract-row') { retractedRows.push(e.row); continue; }
    if (e.type === 'row') { const row = { ...e, retracted: false }; evidence.push(row); before = row; }
  }
  // The branch's tip now, read once and only when a row or a verdict between the two windows carries a tip: the branch
  // in the issue's repositories, or, where it is gone (the cleanup after a merge deletes it), the tip the newest merge
  // was recorded on.
  let tipHere;
  const now = () => {
    if (tipHere === undefined) tipHere = (issue && loop.root && branchTip(loop.root, issue)) || mergeTip || null;
    return tipHere;
  };
  const kept = (e, after) => e.n > after || (e.tip !== undefined && now() !== null && e.tip === now());
  for (const e of evidence) e.inWindow = e.n > anchorN || (e.n > firmAnchorN && kept(e, anchorN));
  for (const r of allReviews) r.inWindow = r.n > cut || (r.n > firm.cut && kept(r, cut));
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
  let live = null;
  for (const r of sinceChanges) {
    if (r.verdict !== 'approve' || !r.inWindow) continue;
    const rw = KIND_WEIGHT[r.kind] ?? Infinity;
    const lw = live ? (KIND_WEIGHT[live.kind] ?? Infinity) : Infinity;
    if (!live || rw < lw || (rw === lw && r.n > live.n)) live = r;
  }
  return {
    tracked: anchor !== null,
    anchor: anchor ? { at: anchor.at, what: anchor.type === 'filed' ? 'filed' : anchor.to } : null,
    unresolvedRetractions,
    rowsSince: evidence.filter((e) => e.inWindow && !e.retracted).length,
    // What the issue view windows by: where the gate's window starts in the log, and the log's rows and review lines in
    // order. A row or a verdict a pause did not spend opens it as far back as the first of them.
    cut: Math.min(cut, ...allReviews.filter((r) => r.inWindow).map((r) => r.n - 1)),
    anchorN: Math.min(anchorN, ...evidence.filter((e) => e.inWindow).map((e) => e.n - 1), ...allReviews.filter((r) => r.inWindow && r.n <= anchorN).map((r) => r.n - 1)),
    rowLog: evidence, trail,
    lastReview: last ? last.verdict : null,
    lastApprove: [...reviews].reverse().find((r) => r.verdict === 'approve') || null,
    approved: Boolean(live && live.kind !== 'self'),
    selfApproved: Boolean(live && live.kind === 'self'),
    fresh: Boolean(live && live.kind === 'fresh'),
    live,
    workers: self,
  };
}

// Who reviewed the done issues: the kind of each one's last approve, and how many carry no reviewer at all
// (an approve recorded without --by). Shown by status and report, never acted on.
export function reviewSplit(loop) {
  const split = { fresh: 0, coordinator: 0, self: 0, unrecorded: 0 };
  for (const i of loop.issues.filter((x) => loop.profile.is(x.status, 'closes-record'))) {
    const kind = approveKind(gateOf(loop, i.id));
    if (kind === 'retracted') split.retracted = (split.retracted || 0) + 1; else split[kind] += 1;
  }
  return split;
}
// The kind of the approve that stands behind an issue — the live one, the one that actually cleared it, not simply the
// last one recorded: a later coordinator (or self) approve does not make an already-cleared issue read as coordinator- or
// self-reviewed. `retracted` when the approve was taken back and none stands; `unrecorded` for an approve without --by.
function approveKind(g) {
  if (g.live) return g.live.kind || 'unrecorded';
  return g.trail.some((r) => r.verdict === 'approve' && r.retracted && r.inWindow) ? 'retracted' : 'unrecorded';
}

const closedGateLine = (x) => `closed, gate does not hold: ${x.id} · ${x.reason} — repair: ${x.repair}`;
// Who stands behind the closed issues: the reviewers, by kind — or, under a done gate with no approve, the merge that
// landed each one, with whatever reviews were recorded all the same.
function gateLine(profile, split, label) {
  if (profile.doneGate.approve !== 'none') return `${label}: ${renderSplit(split)}`;
  return `closed on a merge in the base, no approve required (this loop's done gate) · reviews recorded: ${renderSplit(split)}`;
}
function renderSplit(s) { return `fresh ${s.fresh} · coordinator ${s.coordinator} · self ${s.self}${s.retracted ? ` · retracted ${s.retracted}` : ''}${s.unrecorded ? ` · unrecorded ${s.unrecorded}` : ''}`; }

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { FIELD_NAMES, approveKind, closedGateLine, gateLine, scopedLoop };
