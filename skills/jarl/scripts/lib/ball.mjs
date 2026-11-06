// What is on whom: every open thing of the loop has one holder who must move next, derived from the record and never
// stored, and next --as <holder> lists what is on that one, each line with the command that moves it.

import { PROMISE_KIND, WAIT_KIND, fieldText, jarlLine, need } from './base.mjs';
import { cmpId, idKey, idsCited } from './ids.mjs';
import { mergedOf } from './issues.mjs';
import { leaseOfMove } from './log.mjs';
import { carriesCode, coordinatorOf, gateOf, inFlightMark, readLoop, sameSlice, sliceOf } from './loop.mjs';
import { reasonWord, waitingOn } from './commands.mjs';
import { nextRows, schedulerNote } from './evidence.mjs';
import { ownerLineStates } from './owner-lines.mjs';
import { ruleLines, rulesFor } from './rules.mjs';
import { jarlDir, today } from './where.mjs';
import { ago, leaseLiveness, livenessOf, thresholdText } from './rounds.mjs';

// The holders: the owner, the jarl, a named coordinator or a named outside person. A ready issue, a lease, a proof with no
// verdict and a changes verdict are held by the coordinator whose slice the issue is in, and by the jarl for an issue in
// no slice; with no slice in the loop every one of them is the jarl's.
export const OWNER_HOLDER = 'owner';
export const JARL_HOLDER = 'jarl';
// How many lines next --as prints before it counts the rest; --all prints every one.
export const BALL_SHOWN = 7;
const TITLE = 70;
const short = (t, n = TITLE) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

// The name the asker gives, read as a holder: a name that reads as owner is the owner, jarl is the jarl, any other name
// is kept as given (a coordinator or an outside person).
export function holderOf(name) {
  need(typeof name === 'string' && fieldText(name), '--as names who asks: owner, jarl, a coordinator or a person by name', () => ({ flag: '--as', value: '<who-asks>' }));
  const plain = fieldText(name);
  const letters = plain.toLowerCase().replace(/[^\p{L}]/gu, '');
  if (letters === OWNER_HOLDER || letters === `the${OWNER_HOLDER}`) return OWNER_HOLDER;
  if (letters === JARL_HOLDER || letters === `the${JARL_HOLDER}`) return JARL_HOLDER;
  return plain;
}
const holderWord = (h) => (h === OWNER_HOLDER || h === JARL_HOLDER ? `the ${h}` : h);
// One holder however its name is cased or spaced: Dana Smith and dana  smith are one person.
const holderKey = (h) => String(h).toLowerCase().replace(/\s+/g, ' ');
const sameHolder = (a, b) => holderKey(a) === holderKey(b);
// Who keeps a promise: the one its Found by names (the jarl when it names nobody). Who a wait is held by: its Person.
const makerOf = (issue) => holderOf(fieldText(issue.fields['found by']) || JARL_HOLDER);
const personOf = (issue) => (fieldText(issue.fields.person) ? holderOf(fieldText(issue.fields.person)) : null);

// The status a move of each kind goes into, read from the profile's flags: the first status that holds the claim, and
// the first that closes the record (else the first terminal one).
function statusWith(profile, flag, fallback) {
  return profile.statuses.find((s) => profile.is(s, flag)) || (fallback ? profile.statuses.find((s) => profile.is(s, fallback)) : undefined) || flag;
}

// The coordinator who holds an issue's rows: the one whose slice it is in (see coordinatorOf), or the jarl.
const sliceHolder = (loop, issue) => coordinatorOf(loop, issue);
// A parent in a status that offers it is in play for its rows once its sub-issues are all settled: its own acceptance is
// then checked against the whole, reviewed and closed, as a lease's work is. A parent in a lease is in play as any lease.
const isParent = (i) => Boolean(i.tree && i.tree.children.length);
const checking = (profile, i) => isParent(i) && profile.is(i.status, 'dispatchable');
const inPlayForRows = (profile, i) => profile.is(i.status, 'holds-claim') || checking(profile, i);

// The issue rows: what the record says about an issue in play, as the step it points to and who takes it. The worker of
// a lease is the one who does the step, and the holder of its slice (the jarl, with none) still holds the line.
function issueRows(ctx) {
  const { loop, profile } = ctx;
  const holderOfId = (id) => sliceHolder(loop, loop.byId.get(id));
  const leaseStatus = statusWith(profile, 'holds-claim');
  const closeStatus = statusWith(profile, 'closes-record', 'terminal');
  const out = [];
  // Open and offered by next: ready to start. A parent offered there is in play below, for its check.
  for (const r of ctx.next.filter((x) => x.ready && !x.subs)) {
    out.push({ what: 'ready', id: r.id, title: r.title, priority: r.priority, holder: holderOfId(r.id),
      says: 'ready to start, raise a worker', command: jarlLine('set', r.id, leaseStatus, '--branch', '<branch>', '--worker', '<name>') });
  }
  const evidence = (id) => jarlLine('evidence', id, '--ran', '<command>', '--saw', '<what-it-printed>');
  const verdict = (id) => jarlLine('review', id, '<verdict>', '--by', '<reviewer>', '<text>');
  // A wait has rows of its own (keptRows); a promise in a lease is worked as any issue, and its maker holds each line.
  for (const i of loop.issues.filter((x) => inPlayForRows(profile, x) && profile.keptKind(x.kind) !== WAIT_KIND && !waitingOn(x, loop.byId, profile).length)) {
    const mark = inFlightMark(loop, i);
    const worker = fieldText(i.fields.worker) || null;
    const backAfterRound = sentBack(loop, i, mark);
    if (checking(profile, i) && (mark === 'no-rows' || backAfterRound)) {
      // Every sub-issue settled, and no proof since (or since a round sent it back): the coordinator of its slice checks
      // the parent's own acceptance against the whole.
      out.push({ id: i.id, title: i.title, priority: i.priority, holder: sliceHolder(loop, i), what: 'check', subs: i.tree.children.map((c) => c.id),
        says: `its sub-issues are closed (${i.tree.children.map((c) => `${c.id} ${c.status}`).join(', ')}): check its own acceptance against the whole, and record what the check ran and printed`, command: evidence(i.id) });
      continue;
    }
    // A promise is on whoever made it; any other issue on the coordinator of its slice, for the lease, the proof with no
    // verdict and the changes verdict, and on the jarl with no slice. What follows an approve (the merge, its CI and the
    // close) stays the jarl's, a promise's its maker's.
    const promise = profile.keptKind(i.kind) === PROMISE_KIND;
    const holder = promise ? makerOf(i) : sliceHolder(loop, i);
    const base = { id: i.id, title: i.title, priority: i.priority, holder, ...(worker ? { doer: worker } : {}) };
    const onJarl = { ...base, holder: promise ? holder : JARL_HOLDER };
    // An approve not merged is on the one holder the goal's Merger line names, who raises the merger; with none, the jarl.
    const onMerger = { ...base, holder: ctx.merger };
    const withWorker = worker ? `with worker ${worker}` : 'in progress';
    const since = fieldText(i.fields.since) ? ` since ${fieldText(i.fields.since)}` : '';
    const lv = ctx.liveness(i);
    if ((mark === 'no-rows' || backAfterRound) && lv.idle) {
      // Idle past the threshold: a worker stuck on a prompt or a lock writes nothing, so the act is the holder's.
      out.push({ ...base, what: 'idle', idle: { ageMs: lv.ageMs, minutes: lv.minutes }, says: `${withWorker}${since}, no commit, row or log line for ${idleFor(lv)}: ask the worker whether it waits on a prompt or a lock, or hand the lease over`,
        command: jarlLine('set', i.id, leaseStatus, '<why-the-worker-changed>', '--worker', '<the-new-worker>', '--handover') });
      continue;
    }
    if (mark === 'no-rows' || backAfterRound) {
      out.push({ ...base, what: 'worker', says: `${withWorker}${since}, ${backAfterRound ? 'sent back by a round, no new proof yet' : 'no proof yet'}; the worker records it`, command: evidence(i.id) });
      continue;
    }
    // A close the done gate would refuse for an owner line not ticked is not offered: that line's own row stands instead.
    const unticked = (ctx.ownerStates.get(i.id) || []).some((s) => !s.tick);
    if (mark === 'rows-no-verdict' && profile.doneGate.approve === 'none') {
      // A done gate that asks for no approve: the proof is enough, and the merge (when the gate asks for one) comes next.
      const merge = profile.doneGate['requires-merged'] && !mergedOf(i);
      if (!merge && unticked) continue;
      out.push({ ...(merge ? onMerger : onJarl), what: merge ? 'merge' : 'close', says: merge ? 'proof recorded, not merged; merge it' : 'proof recorded; close it',
        command: merge ? jarlLine('merged', i.id, '--sha', '<sha>', '--ran', '<command>', '--saw', '<what-it-printed>') : jarlLine('set', i.id, closeStatus, '<text>') });
      continue;
    }
    if (mark === 'rows-no-verdict' && carriesCode(i) && profile.keptKind(i.kind) !== PROMISE_KIND) continue;   // listed together below
    if (mark === 'rows-no-verdict') {
      out.push({ ...base, what: 'review', ...(lv.idle ? { idle: { ageMs: lv.ageMs, minutes: lv.minutes } } : {}), says: `${checking(profile, i) ? 'checked against the whole' : 'proof recorded'}, no verdict${lv.idle ? ` for ${idleFor(lv)}` : ''}; raise a reviewer`, command: verdict(i.id) });
      continue;
    }
    if (mark === 'approved-not-fresh') {
      out.push({ ...base, what: 'review', says: 'approved by a coordinator only, and it carries code; raise a fresh reviewer', command: verdict(i.id) });
      continue;
    }
    if (mark === 'approved-not-cleared') {
      out.push({ ...base, what: 'review', says: 'approved, and no approve it holds clears it under the loop\'s done gate; raise a reviewer whose approve does', command: verdict(i.id) });
      continue;
    }
    if (mark === 'changes-requested') {
      out.push({ ...base, what: 'changes', says: 'changes asked by its reviewer; send it back to a worker', command: jarlLine('round', i.id, '<text>') });
      continue;
    }
    if (mark === 'approved' && carriesCode(i)) {
      out.push({ ...onMerger, what: 'merge', says: 'approved, not merged; merge it', command: jarlLine('merged', i.id, '--sha', '<sha>', '--ran', '<command>', '--saw', '<what-it-printed>') });
      continue;
    }
    if (mark === 'merged-ci') {
      out.push({ ...onJarl, what: 'ci', says: 'merged, its CI not green yet; record the result', command: jarlLine('merged', i.id, '--ci', 'green|red') });
      continue;
    }
    if (unticked) continue;
    out.push({ ...onJarl, what: 'close', says: mark === 'merged' ? 'merged; close it' : 'approved; close it', command: jarlLine('set', i.id, closeStatus, '<text>') });
  }
  // One line per holder for the proofs of code with no verdict: each coordinator raises its own slice's reviewer.
  const byHolder = new Map();
  for (const i of ctx.awaiting.filter((x) => !ctx.onOwner.has(x.id))) {
    const h = sliceHolder(loop, i);
    byHolder.set(h, [...(byHolder.get(h) || []), i]);
  }
  for (const [holder, todo] of byHolder) out.push(...reviewRow(todo, holder, verdict, ctx.liveness));
  return out;
}
// How long an idle lease or proof has had no sign of work, with the threshold it is past.
const idleFor = (lv) => `${ago(lv.ageMs)} (threshold ${thresholdText(lv.minutes)})`;

// A round sends the work back: until the worker records a row after it, the issue is the worker's again.
function sentBack(loop, issue, mark) {
  const lastRound = (loop.eventsById.get(issue.id) || []).filter((e) => e.type === 'round').reduce((n, e) => Math.max(n, e.n), -1);
  const rowsAfterRound = gateOf(loop, issue.id).rowLog.filter((r) => !r.retracted && r.inWindow && r.n > lastRound).length;
  return lastRound >= 0 && rowsAfterRound === 0 && mark === 'rows-no-verdict';
}

// The issues in play whose code has proof and no verdict, and waits for a fresh reviewer.
function awaitingReview(loop, profile) {
  if (profile.doneGate.approve === 'none') return [];
  return loop.issues.filter((i) => inPlayForRows(profile, i) && !profile.keptKind(i.kind) && !waitingOn(i, loop.byId, profile).length && carriesCode(i)
    && inFlightMark(loop, i) === 'rows-no-verdict' && !sentBack(loop, i, 'rows-no-verdict'));
}

// The proofs of code with no verdict, as one line: a fresh reviewer for all of them at once, or, where the jarl cannot
// raise agents, a question asking the owner to start a fresh session. The record cannot tell the two apart, so the line
// offers both. A proof that an open question of that wording names is the owner's: it leaves the jarl's list, and the
// issues that wait on it wait on the owner. A question whose issues all have a verdict holds nothing.
const REVIEW_ASK = 'start a fresh session to review';
// The sentence a question opens with to ask for a review: the phrase, then "issue" or "issues" and the one list of numbers
// that runs on from it, joined by a comma and a space, by and or or between spaces, or by an ampersand. The list ends
// at the first thing that is not a join and a number, so a number later in the question is not asked about.
const ASKED_NUMBER = '#?\\d+(?![\\w/-])(?![.,:]\\d)';
const ASKED_JOIN = '(?:,\\s+(?:(?:and|or)\\s+)?|\\s+(?:and|or)\\s+|\\s*&\\s*)';
const REVIEW_ASK_RE = new RegExp(`^${REVIEW_ASK} issues?\\s+${ASKED_NUMBER}(?:${ASKED_JOIN}${ASKED_NUMBER})*`, 'i');
// The issues a question asks for a fresh review of, by key: the issues of that one list the loop holds (idsCited reads the
// numbers of the sentence); none for any other question.
function reviewAskKeys(loop, question) {
  const m = REVIEW_ASK_RE.exec(question);
  return m ? idsCited(m[0], loop.byId).map(idKey) : [];
}
// The proofs awaiting a fresh reviewer that an open question names: the ones the owner holds.
function heldByOwner(loop, awaiting) {
  const asked = new Set(loop.asks.filter((a) => a.state === 'open').flatMap((a) => reviewAskKeys(loop, a.question)));
  return awaiting.filter((i) => asked.has(idKey(i.id))).map((i) => i.id);
}
const joinIds = (issues) => issues.map((i) => i.id).join(', ');
// The most issues one shared review covers: Jarl's own rule for the coordinator (jarl:coordinator-shared-review).
export const SHARED_REVIEW_MAX = 4;
// The units one fresh reviewer may take, out of the proofs that wait for a verdict, under that rule: a shared review only
// over issues that are one contract or one screen, at most four. The record's mark of one contract is one branch: the issues
// leased on it as one package, which one diff holds. A branch of more than four is cut into units as even as they come;
// every other issue is a unit of its own. Each is { ids }, and a grouped one adds what it shares: { shares: 'branch', on }.
function reviewUnits(todo) {
  const byBranch = new Map();
  for (const i of todo) {
    const b = fieldText(i.fields.branch);
    const key = b ? b : `\n${i.id}`;
    byBranch.set(key, [...(byBranch.get(key) || []), i]);
  }
  const units = [];
  for (const [key, issues] of byBranch) {
    if (issues.length === 1) { units.push({ ids: [issues[0].id] }); continue; }
    const parts = Math.ceil(issues.length / SHARED_REVIEW_MAX);
    for (let p = 0, at = 0; p < parts; p += 1) {
      const size = Math.ceil((issues.length - at) / (parts - p));
      units.push({ ids: issues.slice(at, at + size).map((i) => i.id), shares: 'branch', on: key });
      at += size;
    }
  }
  return units.sort((a, b) => cmpId(a.ids[0], b.ids[0]));
}
const unitText = (u) => (u.shares ? `${u.ids.join(', ')} (one ${u.shares}, ${u.on})` : u.ids[0]);
// A proof that waits past the threshold for its verdict says how long: the one issue's age, or each idle issue's.
function reviewRow(todo, holder, verdict, liveness) {
  if (!todo.length) return [];
  const ids = joinIds(todo);
  const only = todo.length === 1 ? todo[0] : null;
  const units = reviewUnits(todo);
  const worker = only ? fieldText(only.fields.worker) : '';
  const priority = todo.map((i) => i.priority).filter((p) => p !== undefined).sort()[0];
  const idle = todo.map((i) => liveness(i)).filter((lv) => lv.idle);
  const waited = !idle.length ? '' : only ? ` for ${idleFor(idle[0])}` : ` for ${idle.map((lv) => `${ago(lv.ageMs)} on ${lv.id}`).join(', ')} (threshold ${thresholdText(idle[0].minutes)})`;
  return [{
    what: 'review', id: todo[0].id, ids: todo.map((i) => i.id), units, title: only ? only.title : '', priority, holder, ...(worker ? { doer: worker } : {}),
    ...(idle.length ? { idle: idle.map((lv) => ({ id: lv.id, ageMs: lv.ageMs, minutes: lv.minutes })) } : {}),
    says: `proof recorded, no verdict${waited}; ${only ? `raise a fresh reviewer for ${ids}` : `raise one fresh reviewer per unit: ${units.map(unitText).join(' · ')}`}; if you cannot raise agents, ask the owner to start a fresh session`,
    command: `${only ? verdict(only.id) : verdict('<ids>')}, or ${jarlLine('ask', `${REVIEW_ASK} issue${todo.length === 1 ? '' : 's'} ${ids}`)}`,
  }];
}

// The rows of a promise and of a wait, which next never offers to a worker: an open promise is on whoever made it until
// it is kept and closed; a wait is on its outside person until what was waited for comes (the first proof row records
// it), with when to check, and then on the jarl to close. Either ends when its issue leaves play.
function keptRows(ctx) {
  const { loop, profile } = ctx;
  const closeStatus = statusWith(profile, 'closes-record', 'terminal');
  const verdict = (id) => jarlLine('review', id, '<verdict>', '--by', '<reviewer>', '<text>');
  const evidence = (id) => jarlLine('evidence', id, '--ran', '<command>', '--saw', '<what-it-printed>');
  const out = [];
  const kept = loop.issues.filter((i) => profile.active(i.status) && !waitingOn(i, loop.byId, profile).length
    && (profile.keptKind(i.kind) === WAIT_KIND || (profile.keptKind(i.kind) === PROMISE_KIND && !profile.is(i.status, 'holds-claim'))));
  for (const i of kept) {
    const mark = inFlightMark(loop, i);
    const base = { id: i.id, title: i.title, priority: i.priority, kind: i.kind };
    const promise = i.kind === PROMISE_KIND;
    const holder = promise ? makerOf(i) : mark === 'no-rows' ? personOf(i) || JARL_HOLDER : JARL_HOLDER;
    const when = fieldText(i.fields['check when']) || 'not said';
    if (mark === 'no-rows') {
      out.push(promise
        ? { ...base, what: 'promise', holder, says: `promised by ${holderWord(holder)}; keep it, then record what was done`, command: evidence(i.id) }
        : { ...base, what: 'wait', holder, checkWhen: when, says: `waits on ${holderWord(holder)}, check when ${when}; when it comes, record it`, command: evidence(i.id) });
      continue;
    }
    const done = promise ? 'kept' : 'it came';
    if (mark === 'rows-no-verdict' || mark === 'approved-not-fresh' || mark === 'approved-not-cleared') out.push({ ...base, what: 'review', holder, says: `${done}, proof recorded, no verdict; review it`, command: verdict(i.id) });
    else if (mark === 'changes-requested') out.push({ ...base, what: 'changes', holder, says: `${done}, changes asked by its reviewer; answer them and ask for a new verdict`, command: verdict(i.id) });
    else out.push({ ...base, what: 'close', holder, says: `${done}, approved; close it`, command: jarlLine('set', i.id, closeStatus, '<text>') });
  }
  return out;
}

// The rows of the acceptance lines only the owner ticks, on the issues in play: a line whose material is not there yet is
// on whoever produces it (the coordinator of its slice, the jarl with none, the worker doing it), and once it is there, on the owner, with
// the material and what to check. A line that names neither is the jarl's to rewrite. A ticked line holds nothing.
function ownerLineRows(ctx) {
  const out = [];
  for (const [id, states] of ctx.ownerStates) {
    const i = ctx.loop.byId.get(id);
    const worker = fieldText(i.fields.worker) || null;
    const base = { what: 'sign-off', id, title: i.title, priority: i.priority, ...(worker ? { doer: worker } : {}) };
    for (const s of states.filter((x) => !x.tick)) {
      const line = { ...base, line: s.n };
      if (s.off) {
        out.push({ ...line, holder: JARL_HOLDER, says: `acceptance line ${s.n} is marked as the owner's, and ${s.why}; rewrite it without the mark`, command: jarlLine('field', id, 'Acceptance', '<the-whole-section>') });
      } else if (!s.material || !s.check || !s.what) {
        out.push({ ...line, holder: JARL_HOLDER, says: `acceptance line ${s.n} is marked as the owner's and does not name its material and what to check; rewrite it`, command: jarlLine('field', id, 'Acceptance', '<the-whole-section>') });
      } else if (!s.ready) {
        // Its material is produced in the lease, so the line is on whoever holds the lease's rows: the coordinator of the
        // issue's slice, the jarl with none.
        out.push({ ...line, holder: sliceHolder(ctx.loop, i), says: `acceptance line ${s.n} is the owner's to tick once its material is there (${s.material}); ${s.why}`, command: jarlLine('evidence', id, '--ran', '<command>', '--saw', '<what-it-printed>') });
      } else {
        out.push({ ...line, holder: OWNER_HOLDER, material: s.material, check: s.check, says: `acceptance line ${s.n} is yours to tick: review ${s.material}${s.at ? ` (in ${s.at})` : ''} and check ${s.check}`, command: jarlLine('tick', id, s.n, '--by', 'owner') });
      }
    }
  }
  return out;
}

// The owner's rows: every open question and every item to ratify. A ratify item blocks nothing.
function questionRows(ctx) {
  return ctx.loop.asks.filter((a) => a.state === 'open').map((a) => {
    const ref = `a-${a.id}`;
    // An escalation goes up from a coordinator and is the jarl's: it names its slice or its issue.
    if (a.kind === 'escalation') return { what: 'escalation', ask: a.id, kind: a.kind, title: a.question, holder: JARL_HOLDER, ...(a.slice ? { slice: a.slice } : {}),
      says: `escalation${a.slice ? ` from slice:${a.slice}` : ''}${a.issue ? ` on issue ${a.issue}` : ''}`, command: jarlLine('answer', ref, '<text>', '--by', 'jarl') };
    // A proposed rule is on the one it was proposed to, and so is a rule of the loop offered for promotion at its close.
    if (a.kind === 'rule') {
      const holder = a.to === OWNER_HOLDER ? OWNER_HOLDER : JARL_HOLDER;
      return a.ruling
        ? { what: 'promotion', ask: a.id, title: a.question, holder, ruling: a.ruling, says: `rule ${a.ruling} offered for promotion`, command: jarlLine('answer', ref, '--option', (a.options || []).map((o) => o.label).join('|'), '--by', holder) }
        : { what: 'rule', ask: a.id, title: a.question, holder, says: `rule proposed${a.appliesTo ? ` for ${a.appliesTo}` : ''}`, command: `${jarlLine('answer', ref, 'yes', '--by', holder)} (or "reject")` };
    }
    if (a.kind === 'ratify') return { what: 'ratify', ask: a.id, title: a.question, holder: OWNER_HOLDER, says: `to ratify${a.issue ? ` (issue ${a.issue})` : ''}`, command: `${jarlLine('answer', ref, 'yes', '--by', 'owner')} (or "reject")` };
    // A question that asks for a fresh review holds the proofs it names, as far as they still await one.
    const keys = new Set(reviewAskKeys(ctx.loop, a.question));
    const reviewing = ctx.loop.issues.filter((i) => ctx.onOwner.has(i.id) && keys.has(idKey(i.id))).map((i) => i.id);
    return { what: 'question', ask: a.id, kind: a.kind || 'stuck', title: a.question, holder: OWNER_HOLDER, ...(reviewing.length ? { reviewing } : {}),
      says: `question (${a.kind || 'stuck'})${a.issue ? ` on issue ${a.issue}` : ''}${reviewing.length ? `, the fresh review of ${reviewing.join(', ')} waits on it` : keys.size ? ', no issue it names awaits a review now' : ''}`, command: jarlLine('answer', ref, '<text>', '--by', 'owner') };
  });
}

// The jarl's ruling rows: a ruling in force that names work (it settles issues) and settles no live issue: every issue
// it names is finished without being done, and not on this ruling, or is not in the loop. A settled issue still open or
// in progress has a holder of its own, and one done has done the work.
function rulingRows(ctx) {
  const { loop, profile } = ctx;
  const out = [];
  for (const d of loop.decisions.filter((x) => !x.supersededBy && x.settles.length)) {
    const named = d.settles.map((id) => loop.issues.find((i) => idKey(i.id) === idKey(id)) || { id, missing: true });
    const live = named.some((i) => !i.missing && (!profile.is(i.status, 'terminal') || profile.is(i.status, 'closes-record')));
    if (live || named.some((i) => !i.missing && closedOn(loop, i, d.slug))) continue;
    out.push({ what: 'ruling', ruling: d.slug, title: d.slug, holder: JARL_HOLDER,
      says: `ruling in force; the work it settles has no live issue: ${named.map((i) => (i.missing ? `${i.id} is not in the loop` : `${i.id} is ${i.status}`)).join(', ')}; file the work and settle it`,
      command: `${jarlLine('new', '<title>')}, then ${jarlLine('decide', '<slug>', '<text>', '--by', 'jarl', '--supersedes', d.slug, '--settles', '<id>')}` });
  }
  return out;
}
// An issue finished on the ruling: its reason, or the line of its last move, names the ruling.
function closedOn(loop, issue, slug) {
  const reasons = [...(issue.sections.evidence || '').matchAll(new RegExp(`^${reasonWord(issue.status)}:\\s*(.*)$`, 'gm'))];
  if (reasons.length && reasons[reasons.length - 1][1].includes(slug)) return true;
  const moves = (loop.eventsById.get(issue.id) || []).filter((e) => e.type === 'move');
  return moves.length > 0 && String(moves[moves.length - 1].text || '').includes(slug);
}

// The jarl's lease conflicts: an issue whose log leases it twice, by two writers, to two holders, with no move out of the
// lease between the two lines and no handover. One copy of the loop refuses a lease another worker holds, so the two
// lines come from two copies that each leased it before either saw the other, merged. Which lease stands is the jarl's
// to settle.
function leaseConflictRows(ctx) {
  const { loop, profile } = ctx;
  const leaseStatus = statusWith(profile, 'holds-claim');
  const out = [];
  for (const i of loop.issues) {
    if (i.id === null || i.shared) continue;
    const c = leaseConflict(profile, (loop.eventsById.get(i.id) || []).filter((e) => (e.key ?? null) === null || e.key === (i.fields.key || null)));
    if (!c) continue;
    const lease = (e) => `${e.writer}${e.lease?.worker ? ` (worker ${e.lease.worker}${e.lease.branch ? `, ${e.lease.branch}` : ''})` : ''} at ${e.at}`;
    out.push({ what: 'conflict', id: i.id, title: i.title, priority: i.priority, holder: JARL_HOLDER,
      says: `leased twice with no move out between: by ${lease(c.first)} and by ${lease(c.second)}, in two copies of the loop that each leased it before either saw the other; settle which lease stands`,
      command: jarlLine('set', i.id, leaseStatus, '--handover', '--branch', '<branch>', '--worker', '<name>', '<why-the-worker-changed>') });
  }
  return out;
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

// The sources of the rows, in order. Each reads the record through the context and gives rows { what, holder, says,
// command, and id, ask or ruling }; a kind of open thing the record learns to hold adds its own source here.
export const ROW_SOURCES = [issueRows, leaseConflictRows, keptRows, ownerLineRows, questionRows, rulingRows];
// The rows a composer's scheduler owns: under an external scheduler Jarl lists only the others.
const SCHEDULING = new Set([issueRows, leaseConflictRows]);

// Every row of the loop, ordered as one display (never a schedule): the owner's rows first, then by how many issues each
// holds up directly, an item to ratify after a question (it blocks nothing), then by priority and number. A question of
// kind stop holds up the whole loop.
export function ballRows(root) {
  const loop = readLoop(jarlDir(root));
  const { profile } = loop;
  const scheduled = profile.scheduler !== null;
  const awaiting = scheduled ? [] : awaitingReview(loop, profile);
  // The owner lines of the issues in play that wait on nothing, read once for the issue rows and their own.
  const inPlay = loop.issues.filter((i) => inPlayForRows(profile, i) && !waitingOn(i, loop.byId, profile).length);
  const ownerStates = new Map(inPlay.map((i) => [i.id, ownerLineStates(root, loop, i)]).filter(([, s]) => s.length));
  // Each issue reserves its files against the issues of its own slice: across slices only leases hold.
  // The age of each lease, past the goal's liveness threshold or not, read once per issue (see leaseLiveness).
  const minutes = livenessOf(loop.goalLines).minutes;
  const ages = new Map();
  const liveness = (i) => { if (!ages.has(i.id)) ages.set(i.id, leaseLiveness(root, i, minutes, { events: loop.eventsById.get(i.id) || [] })); return ages.get(i.id); };
  const ctx = { root, loop, profile, merger: loop.goalLines.merger === null ? JARL_HOLDER : holderOf(loop.goalLines.merger), next: scheduled ? [] : nextRows(root, { perSlice: true }), awaiting, onOwner: new Set(heldByOwner(loop, awaiting)), ownerStates, liveness };
  const rows = ROW_SOURCES.filter((s) => !(scheduled && SCHEDULING.has(s))).flatMap((s) => s(ctx));
  // Who each issue holds up: the issues in play whose After names it, not settled yet, and for a question the issue it holds.
  const active = loop.issues.filter((i) => profile.active(i.status));
  const dependents = new Map();
  for (const i of active) for (const a of waitingOn(i, loop.byId, profile)) dependents.set(a, [...(dependents.get(a) || []), i.id]);
  const heldByQuestion = new Map(ctx.next.filter((r) => r.group === 'held-by-question').flatMap((r) => r.questions.map((q) => [q, r.id])));
  const upOf = (ids) => [...new Set(ids.flatMap((id) => dependents.get(id) || []))];
  for (const r of rows) {
    if (r.ids) r.holdsUp = upOf(r.ids);
    else if (r.id !== undefined) r.holdsUp = dependents.get(r.id) || [];
    else if (r.what === 'question' || r.what === 'escalation') r.holdsUp = [...new Set([...(heldByQuestion.has(r.ask) ? [heldByQuestion.get(r.ask)] : []), ...upOf(r.reviewing || [])])];
    else r.holdsUp = [];
  }
  const weight = (r) => (r.what === 'question' && r.kind === 'stop' ? Number.MAX_SAFE_INTEGER : r.holdsUp.length);
  rows.sort((a, b) => (b.holder === OWNER_HOLDER) - (a.holder === OWNER_HOLDER) || weight(b) - weight(a)
    || (a.what === 'ratify') - (b.what === 'ratify')
    || String(a.priority ?? '9').localeCompare(String(b.priority ?? '9')) || cmpRef(a, b));
  return { loop, rows, scheduled, waiting: waitingRows(loop, rows, ctx.next, ctx.onOwner) };
}
const refOf = (r) => (r.ids ? r.ids.join(', ') : r.id !== undefined ? r.id : r.ask !== undefined ? `a-${r.ask}` : r.ruling);
// Issues before questions before rulings; issues and questions by number, rulings by name.
function cmpRef(a, b) {
  const rank = (r) => (r.id !== undefined ? 0 : r.ask !== undefined ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  return rank(a) === 2 ? a.ruling.localeCompare(b.ruling) : cmpId(String(a.id ?? a.ask), String(b.id ?? b.ask));
}

// The issues that wait on another, each with whom it waits on through which issue: its After followed to the issues that
// wait on nothing themselves, and the holder of each of those. A held issue (a file or a resource taken) waits on the
// issue that holds it.
function waitingRows(loop, rows, next, onOwner) {
  const { profile, byId } = loop;
  // An issue may hold the ball on more than one holder at once (a merge on the jarl, an owner line on the owner).
  const holderOfIssue = new Map();
  for (const r of rows.filter((x) => x.id !== undefined)) {
    for (const id of r.ids || [r.id]) holderOfIssue.set(id, [...new Set([...(holderOfIssue.get(id) || []), r.holder])]);
  }
  for (const id of onOwner) holderOfIssue.set(id, [OWNER_HOLDER]);
  const heldBy = new Map(next.filter((r) => r.heldBy && r.heldBy.length && !r.ready).map((r) => [r.id, r.heldBy]));
  const questionOf = new Map(next.filter((r) => r.group === 'held-by-question').map((r) => [r.id, r.questions]));
  // The holder of the questions that hold an issue: the owner while any of them is the owner's, the jarl when every one is
  // an escalation, which the jarl holds.
  const kinds = new Map(loop.asks.map((a) => [a.id, a.kind]));
  const questionHolder = (id) => (questionOf.get(id).every((q) => kinds.get(q) === 'escalation') ? JARL_HOLDER : OWNER_HOLDER);
  const roots = (i, seen = new Set()) => {
    const out = [];
    for (const a of waitingOn(i, byId, profile)) {
      if (seen.has(a)) continue;
      seen.add(a);
      const b = byId.get(a);
      if (profile.active(b.status) && waitingOn(b, byId, profile).length) out.push(...roots(b, seen));
      else out.push(b);
    }
    return out;
  };
  // The holders an issue that waits on nothing itself puts the wait on: its own rows', the owner's through a question
  // that names it, or the holders of the issue that holds its file; none when the record names nobody (a status no flag
  // puts in play).
  const onOf = (b) => {
    if (holderOfIssue.has(b.id)) return holderOfIssue.get(b.id);
    if (questionOf.has(b.id)) return [questionHolder(b.id)];
    const h = (heldBy.get(b.id) || []).find((x) => holderOfIssue.has(x));
    return h ? holderOfIssue.get(h) : [];
  };
  // One entry per waiting issue and holder, with every issue it waits through.
  const entries = new Map();
  const add = (i, on, through) => {
    const key = `${i.id}\n${on}`;
    if (!entries.has(key)) entries.set(key, { id: i.id, title: i.title, on, via: [] });
    const e = entries.get(key);
    if (!e.via.includes(through)) e.via.push(through);
  };
  for (const i of loop.issues.filter((x) => profile.active(x.status) && waitingOn(x, byId, profile).length)) {
    for (const b of roots(i)) for (const on of onOf(b)) add(i, on, b.id);
  }
  for (const [id, holders] of heldBy) {
    const h = holders.find((x) => holderOfIssue.has(x));
    if (h) for (const on of holderOfIssue.get(h)) add(byId.get(id), on, h);
  }
  return [...entries.values()].sort((a, b) => cmpId(a.id, b.id));
}

// next --as <holder> [--all]: what is on that holder now, each line with the command that moves it — at most seven, then
// how many more; --all every line, and the issues that wait on this holder, with the issue they wait through. A named
// coordinator holds the rows of its slice; while no issue carries its slice tag its rows are the jarl's, and the answer
// says so. Under an external scheduler the rows of issues in play are the composer's, and the answer names its command
// for them.
// The moment of work each kind of row stands at: what a rule with a moment selector is read against.
const MOMENT_OF = Object.freeze({ ready: 'start', worker: 'start', idle: 'start', check: 'done', review: 'review', changes: 'round', merge: 'merge', ci: 'merge', close: 'done', 'sign-off': 'done' });
// Who asks, as a rule reads a reader: its roles, its slice, the moments of work its list stands at and the issues it works
// on. The jarl works on the issues in play in no slice and holds the filing and the close, and in a loop with no slice
// it is the coordinator as well; a coordinator on the issues in
// play of its slice, and files; a worker that holds a lease on its leased issues, at their start and, once a round sent
// one back, at its round; anyone else on the issues of its own list.
export function readerOf(loop, holder, mine) {
  const { profile } = loop;
  const inPlay = loop.issues.filter((i) => profile.active(i.status));
  const rowIds = new Set(mine.flatMap((r) => (r.ids ? r.ids : r.id !== undefined ? [r.id] : [])));
  const moments = new Set(mine.map((r) => MOMENT_OF[r.what]).filter(Boolean));
  const issues = (pick) => loop.issues.filter((i) => rowIds.has(i.id) || pick(i));
  // In a loop with no slice the jarl holds every lease and review, so it is the one coordinator too.
  if (holder === JARL_HOLDER) return { roles: new Set(['jarl', ...(loop.issues.some((i) => sliceOf(i) !== null) ? [] : ['coordinator'])]), slice: null, moments: new Set([...moments, 'filing', 'close']), issues: issues((i) => inPlay.includes(i) && sliceOf(i) === null) };
  if (loop.coordinators.some((c) => sameHolder(fieldText(c), holder))) return { roles: new Set(['coordinator']), slice: holder, moments: new Set([...moments, 'filing']), issues: issues((i) => inPlay.includes(i) && sameSlice(sliceOf(i), holder)) };
  const leased = loop.issues.filter((i) => profile.is(i.status, 'holds-claim') && sameHolder(fieldText(i.fields.worker) || '', holder));
  if (leased.length) return { roles: new Set(['worker']), slice: null, moments: new Set(['start', ...(leased.some((i) => sentBack(loop, i, inFlightMark(loop, i))) ? ['round'] : [])]), issues: leased };
  return { roles: new Set(), slice: null, moments, issues: issues(() => false) };
}

export function cmdNextAs(root, flags = {}) {
  const holder = holderOf(flags.as);
  const { loop, rows, scheduled, waiting } = ballRows(root);
  const mine = rows.filter((r) => sameHolder(r.holder, holder));
  const rules = rulesFor(root, loop, readerOf(loop, holder, mine), today());
  const all = flags.all === true;
  const shown = all ? mine : mine.slice(0, BALL_SHOWN);
  const waits = waiting.filter((w) => sameHolder(w.on, holder));
  const coordinator = holder !== JARL_HOLDER && holder !== OWNER_HOLDER && loop.coordinators.some((c) => fieldText(c).toLowerCase() === holder.toLowerCase());
  const sliced = loop.issues.some((i) => sliceOf(i) !== null);
  const ownSlice = loop.issues.some((i) => sameSlice(sliceOf(i), holder));
  const note = !coordinator || ownSlice ? null : sliced ? `no issue carries slice:${holder}, so nothing of a slice is on ${holder}: the issues in no slice are the jarl's (${jarlLine('next', '--as', 'jarl')}), and ${jarlLine('field', '<ids>', 'Tags', '--add', `slice:${holder}`)} gives ${holder} its slice` : `with no slice in the loop, what a coordinator holds is the jarl's: ${jarlLine('next', '--as', 'jarl')}`;
  // A person is named as the record writes the name, whatever case the asker typed.
  const spelled = mine.length ? mine[0].holder : waits.length ? waits[0].on : holder;
  return {
    as: spelled, rows: shown, total: mine.length, more: mine.length - shown.length, rules,
    waiting: all ? waits : [], waitingTotal: waits.length,
    ...(note ? { note } : {}),
    ...(scheduled ? { scheduler: loop.profile.scheduler, schedulerNote: `the issues in play are the composer's: ${schedulerNote(loop.profile.scheduler)}` } : {}),
  };
}

export function renderNextAs(o) {
  const line = (r) => `- ${refOf(r)}${r.what === 'ruling' || !r.title ? '' : ` ${short(r.title)}`}: ${r.says}${r.doer && r.what !== 'worker' && r.what !== 'idle' ? ` (worker ${r.doer})` : ''} — ${r.command}${r.holdsUp.length ? ` · holds up ${r.holdsUp.slice(0, 5).join(', ')}${r.holdsUp.length > 5 ? ` and ${r.holdsUp.length - 5} more` : ''}` : ''}`;
  const out = [`On ${holderWord(o.as)} (${o.total})`];
  if (!o.total) out.push(`- (nothing is on ${holderWord(o.as)})`);
  out.push(...o.rows.map(line));
  const rest = [o.more && `${o.more} more`, !o.waiting.length && o.waitingTotal && `${o.waitingTotal} issue(s) waiting on ${holderWord(o.as)}`].filter(Boolean);
  if (rest.length) out.push(`and ${rest.join(', and ')}: ${jarlLine('next', '--as', o.as, '--all')}`);
  if (o.waiting.length) {
    out.push('', `Waiting on ${holderWord(o.as)} (${o.waiting.length})`);
    out.push(...o.waiting.map((w) => `- ${w.id} ${short(w.title)}: waits on ${holderWord(w.on)} via ${w.via.join(', ')}`));
  }
  if (o.note) out.push(o.note);
  if (o.schedulerNote) out.push(o.schedulerNote);
  if (o.rules.length) out.push('', `Rules for ${holderWord(o.as)} (${o.rules.length})`, ...o.rules.flatMap(ruleLines));
  return out.join('\n');
}

// The asker's list at the end of status --as and resume --as: what next --as prints, under its own heading.
export function askerSection(root, as) {
  const o = cmdNextAs(root, { as });
  return { as: o, text: `## ${renderNextAs(o)}` };
}
