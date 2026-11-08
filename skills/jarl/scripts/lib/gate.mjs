// The done gate: the window of the log it reads, what clears it and what stands in its way.

import { fieldText } from './base.mjs';
import { jarlDir } from './where.mjs';
import { idKey } from './ids.mjs';
import { BOT_PREFIX, clearsOf, clearsWords, reviewerRule } from './profile.mjs';
import { isParentLine, leaseOfMove } from './log.mjs';
import { alignRows, evidenceNotes, evidenceTable, mergedOf } from './issues.mjs';
import { branchTip } from './repositories.mjs';
import { OWNER } from './owner.mjs';
import { leaseWorkers, readLoop } from './loop.mjs';
import { reviewerKind } from './slices.mjs';

// How strong an approve of each standing is, strongest first. A bot's approve clears nothing unless the done gate names it,
// so it stands below the loop's director's, which still clears an issue that carries no code.
const KIND_WEIGHT = { fresh: 0, waived: 0.5, coordinator: 1, bot: 1.5, self: 2 };

// The note decide --waives-review writes into each issue it names, as the log holds it.
const WAIVER_NOTE = /^\S+ evidence · Ruling (\S+) \(by owner\) waives the review\b/;

// Why the ruling `slug` waives nothing for issue `id`, in a few words, or null when it waives its review: a waiver counts
// only while its ruling is in the record, is in force, is the owner's with his words and names the issue under Waives
// review. The done gate reads it, and show says it beside a note whose ruling does not count.
export function waiverVoid(loop, slug, id) {
  const d = (loop.decisions || []).find((x) => x.slug === slug);
  if (!d) return `no ruling ${slug} is in the record`;
  if (d.supersededBy) return `superseded by ${d.supersededBy}`;
  if (d.by !== OWNER || !d.quote) return 'the ruling is not the owner\'s with his words';
  if (!(d.waives || []).some((w) => idKey(w) === idKey(id))) return `the ruling does not name ${id} under Waives review`;
  if (waiverNoteRetracted(loop, slug, id)) return 'its note in the issue was retracted';
  return null;
}

// Whether the notes of the issue that carry the ruling's waiver are all retracted: a note taken back is no waiver, as the
// views leave it out. An issue whose notes hold none (a waiver whose note was never written there) is not judged by it.
function waiverNoteRetracted(loop, slug, id) {
  const issue = (loop.issues || []).find((i) => i.id !== null && idKey(i.id) === idKey(id));
  if (!issue) return false;
  const { lines, notes } = evidenceNotes(issue.sections.evidence || '');
  const own = new RegExp(`^(?:- )?(?:~~)?Ruling ${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(by owner\\) waives the review\\b`);
  const mine = notes.filter((m) => own.test(lines[m.start]));
  return mine.length > 0 && mine.every((m) => m.retracted);
}

// An issue carries code when it records a branch or a merge. Only then does done (and the merge queue) need a
// fresh approve; an issue with neither — a ruling, a note, a hub document — is still cleared by the coordinator.
export function carriesCode(issue) { return Boolean(fieldText(issue.fields.branch) || fieldText(issue.fields.merged)); }

// An issue worked in place carries the tag in-place: its worker writes the files it declares in the checkout of their repository,
// with no branch and no merge, and they are committed in the main checkout once the approve stands.
export const IN_PLACE_TAG = 'in-place';

export function worksInPlace(issue) { return Boolean(issue) && issue.tags.includes(IN_PLACE_TAG); }

// A code issue whose code as it is now is not merged, or null: its lease records a Branch, and its journal records no merge
// that counts for that code (see mergeState of gateOf; a journal with no merge line leaves it to the Merged field), as
// { why: 'none' } or the mergeState that says why. The one rule done refuses by and status flags a closed issue by: the
// merge of the code comes before done.
export function unmergedCode(issue, g) {
  if (!fieldText(issue.fields.branch)) return null;
  const state = g.mergeState();
  if (state === null) return mergedOf(issue) ? null : { why: 'none' };
  return state.counts ? null : state;
}

// What unmergedCode found, as the words after "and": the done refusal and the status flag say it alike.
export function unmergedText(u) {
  if (u.why === 'none') return 'records no merge';
  const short = (tip) => tip.split(',').map((s) => s.slice(0, 12)).join(',');
  const last = `its last merge, ${u.last.sha} (${u.last.at}),`;
  return u.why === 'tip'
    ? `${last} was recorded on tip ${short(u.last.tip)} and the branch is at ${short(u.tipNow)}, so the commits after it are not merged`
    : `${last} was recorded before its last start, reopen or red round, which spends a merge as it spends an approve`;
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
  // A merge is of the issue's own code, so a sub-issue closing under a parent spends none: its window is the issue's own.
  const mergeCuts = { cut: own.cut, firm: firm.cut };
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
  const merges = [];     // every merge line, in order, each with the tip recorded after it
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
      if (own && before.type === 'merged') { mergeTip = e.tip; before.tip = e.tip; }
      else if (own && closedBy(before)) closeTip = e.tip;
      else if (own && before.tip === undefined) before.tip = e.tip;
      before = null;
      continue;
    }
    before = null;
    if (e.type === 'move') { closeTip = null; if (closedBy(e)) before = e; continue; }
    if (e.type === 'merged') { const m = { type: 'merged', n: e.n, at: e.at, sha: e.sha, check: e.check ?? null }; merges.push(m); before = m; mergeTip = null; continue; }
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
    if (e.type === 'retract-row') { retractedRows.push(e); continue; }
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
  // A merge counts for the code as it is now when it was recorded after the issue's last start, reopen or red round (the
  // moves that spend an approve; a sub-issue's close spends none, a merge being of the issue's own code), or before a pause
  // on the tip the branch has now; and in both cases only on that tip, where its tip line and the branch's tip now are both
  // known: commits made after a merge are not merged by it.
  const onTipNow = (m) => m.tip === undefined || now() === null || m.tip === now();
  const inWindow = (m) => m.n > mergeCuts.cut || (m.n > mergeCuts.firm && m.tip !== undefined && now() !== null && m.tip === now());
  const counts = (m) => inWindow(m) && onTipNow(m);
  for (const e of evidence) e.inWindow = e.n > anchorN || (e.n > firmAnchorN && kept(e, anchorN));
  for (const r of allReviews) r.inWindow = (r.n > cut || (r.n > firm.cut && kept(r, cut))) && (r.kind !== 'waived' || r.tip === undefined || now() === null || r.tip === now());
  // A retraction names a row by its file-wide ordinal (evidenceTable: the one numbering show prints), and the journal's
  // row lines are matched to the file's rows (alignRows), so journal lines that merged in another order cannot retract
  // the wrong row. A retraction that cannot be resolved to exactly one row is never ignored: it is returned, and done
  // refuses while one stands, so a retracted row can never count again unseen. A retracted row keeps the log line of its
  // first retraction (retractedAt), so a closed issue is read as it stood at its close.
  const unresolvedRetractions = [];
  if (retractedRows.length) {
    const rows = issue ? evidenceTable(issue.sections.evidence).rows : [];
    const aligned = alignRows(id, rows, evidence);
    for (const { row: n, n: at } of retractedRows) {
      if (aligned[n - 1]) { aligned[n - 1].retracted = true; aligned[n - 1].retractedAt ??= at; }
      else if (evidence.length) unresolvedRetractions.push(n);
    }
  }
  const reviews = allReviews.filter((r) => !r.retracted);
  const last = reviews[reviews.length - 1] || null;
  // Only approves logged after the last "changes" verdict are even candidates — a changes still needs its own
  // approve. Among those, and past cut, the strongest kind wins, tie-broken by the more recent.
  let sinceChanges = reviews;
  let lastChanges = null;
  for (let i = reviews.length - 1; i >= 0; i -= 1) { if (reviews[i].verdict === 'changes') { lastChanges = reviews[i]; sinceChanges = reviews.slice(i + 1); break; } }
  // A changes verdict stands until the work goes back: a round (or a start or reopen) spends it, and so does a new commit
  // on the branch, seen by the tip the verdict was given on differing from the tip now. While it stands, no approve clears the
  // issue: an approve after it counts only once it was given on a later commit, whatever reviewer gives it. A pause and a
  // resume spend no changes verdict, so its reach is read from the window a pause does not open.
  const changesSpent = lastChanges === null || lastChanges.n <= firm.cut;
  const committedSince = (r) => r.tip !== undefined && lastChanges.tip !== undefined && r.tip !== lastChanges.tip;
  const standingChanges = lastChanges && !changesSpent && !(lastChanges.tip !== undefined && now() !== null && lastChanges.tip !== now()) ? lastChanges : null;
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
  const approves = sinceChanges.filter((r) => r.verdict === 'approve' && r.inWindow && (r.kind === 'waived' || changesSpent || committedSince(r)));
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
    // The changes verdict that stands in the way of any approve, or null.
    standingChanges,
    // The merges that count for the code as it is now, each with the check it recorded.
    countedMerges: () => merges.filter(counts),
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
    // The tip a close of the issue records, read when asked, so that the closed issue's gate is read later as it was judged
    // at the close, whatever the branch does after (a branch of the same name made again included): the tip the gate
    // judges it on now. Where neither the branch nor its merge's tip line gives one, the gate judged it on no tip, and a
    // tip that spends nothing it counted is recorded instead: a waiver counts only on the tip it was made on, so that one
    // (waivers on two tips: none), else the newest tip a counted row or approve was made on. Every other row and approve
    // inside the window counts whatever the tip, and one from ahead of a pause, which counts on no tip, can only be added.
    // The commit a merge names is never taken: a squash or a merge commit is a tip no row or waiver was made on.
    // The merges the journal records, read when asked: null when it records none; else whether one counts for the code as
    // it is now, and, when none does, the newest with why it does not ('window': recorded before the last start, reopen or
    // red round; else 'tip': recorded on another tip than the branch's tip now, which `tipNow` is).
    mergeState: () => {
      if (!merges.length) return null;
      if (merges.some(counts)) return { counts: true };
      const last = merges[merges.length - 1];
      return { counts: false, last, why: inWindow(last) ? 'tip' : 'window', tipNow: now() };
    },
    closingTip: () => {
      if (now() !== null) return now();
      const counted = [...evidence.filter((e) => e.inWindow && !e.retracted), ...approves].filter((x) => x.tip !== undefined);
      const waivedOn = [...new Set(counted.filter((x) => x.kind === 'waived').map((x) => x.tip))];
      if (waivedOn.length) return waivedOn.length === 1 ? waivedOn[0] : null;
      const newest = counted.reduce((best, x) => (!best || x.n > best.n ? x : best), null);
      return newest ? newest.tip : null;
    },
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
export function approveKind(g) {
  if (g.live) return g.live.kind === 'fresh' && g.live.relayed ? 'relayed' : g.live.kind || 'unrecorded';
  return g.trail.some((r) => r.verdict === 'approve' && r.retracted && r.inWindow) ? 'retracted' : 'unrecorded';
}

export const closedGateLine = (x) => `closed, gate does not hold: ${x.id} · ${x.reason} — repair: ${x.repair}`;

// Who stands behind the closed issues: the reviewers, by kind — or, under a done gate with no approve, the merge that
// landed each one, with whatever reviews were recorded all the same.
export function gateLine(profile, split, label) {
  if (profile.doneGate.approve !== 'none') return `${label}: ${renderSplit(split)}`;
  return `closed on a merge in the base, no approve required (this loop's done gate) · reviews recorded: ${renderSplit(split)}`;
}

export function renderSplit(s) {
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
    // A merge that does not count for the code as it is now (see unmergedCode) leaves it approved and not merged, as done
    // reads it.
    const m = mergedOf(issue);
    if (!m || unmergedCode(issue, g)) return 'approved';
    return m.ci === 'pending' || m.ci === 'red' ? 'merged-ci' : 'merged';
  }
  const verdicts = g.trail.filter((r) => r.inWindow && !r.retracted && (r.verdict === 'approve' || r.verdict === 'changes'));
  if (g.standingChanges || (verdicts.length && verdicts[verdicts.length - 1].verdict === 'changes')) return 'changes-requested';
  return g.rowsSince === 0 ? 'no-rows' : 'rows-no-verdict';
}

// Whether a round sent the work back and the worker has recorded no row since: the issue is the worker's again, though its
// mark still reads rows and no verdict.
export function sentBack(loop, issue, mark) {
  const lastRound = (loop.eventsById.get(issue.id) || []).filter((e) => e.type === 'round').reduce((n, e) => Math.max(n, e.n), -1);
  const rowsAfterRound = gateOf(loop, issue.id).rowLog.filter((r) => !r.retracted && r.inWindow && r.n > lastRound).length;
  return lastRound >= 0 && rowsAfterRound === 0 && mark === 'rows-no-verdict';
}

// One holder however its name is cased or spaced: Dana Smith and dana  smith are one person.
export const holderKey = (h) => String(h).toLowerCase().replace(/\s+/g, ' ');

export const sameHolder = (a, b) => holderKey(a) === holderKey(b);

// The status a move of each kind goes into, read from the profile's flags: the first status that holds the claim, and
// the first that closes the record (else the first terminal one).
export function statusWith(profile, flag, fallback) {
  return profile.statuses.find((s) => profile.is(s, flag)) || (fallback ? profile.statuses.find((s) => profile.is(s, fallback)) : undefined) || flag;
}

// The lease lines of one issue's `events` that still conflict, as { first, second }, or null. A lease line is a move into
// the status the lease is taken in (the profile's first status that holds the claim) that names a worker or a branch; a
// move between the statuses that hold the claim (running to landed) is the work going on, and takes no lease. Two lease
// lines conflict when each names a writer, the writers differ, they name another worker or another branch, no move into
// a status that does not hold the claim comes between them, and the second is no handover. A later handover or move out
// settles it.
export function leaseConflict(profile, events) {
  const leaseStatus = statusWith(profile, 'holds-claim');
  let held = null;
  let conflict = null;
  for (const e of events) {
    if (e.type !== 'move') continue;
    if (!profile.is(e.to, 'holds-claim')) { held = null; conflict = null; continue; }
    const holder = e.to === leaseStatus ? leaseHolder(e) : null;
    if (!holder) continue;
    if (e.handover) conflict = null;
    else if (held && held.e.writer !== null && e.writer !== null && !sameHolder(held.e.writer, e.writer) && !sameLease(held, holder)) conflict = { first: held.e, second: e };
    held = { e, ...holder };
  }
  return conflict;
}

// The lease conflict an issue's own log lines hold, or null: the lines of its key (the lines of no key too), as the rows read them.
export function leaseConflictOf(loop, issue) {
  const events = (loop.eventsById.get(issue.id) || []).filter((e) => (e.key ?? null) === null || e.key === (issue.fields.key || null));
  return leaseConflict(loop.profile, events);
}

// The worker and the branch a lease line names, or null when it names neither.
function leaseHolder(e) {
  const worker = e.lease?.worker ?? null;
  const branch = e.lease?.branch ?? leaseOfMove(e.text, e.written ?? e.id, e.to).branch ?? null;
  return worker || branch ? { worker, branch } : null;
}

// Two lease lines that name one worker and one branch (where both name it) take one lease.
function sameLease(a, b) {
  const same = (x, y) => x === null || y === null || x === y;
  return same(a.worker, b.worker) && same(a.branch, b.branch);
}
