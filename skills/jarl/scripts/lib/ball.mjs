// What is on whom: every open thing of the loop has one holder who must move next, derived from the record and never
// stored, and next --as <holder> lists what is on that one, each line with the command that moves it.

import { fieldText, need } from './base.mjs';
import { jarlDir } from './where.mjs';
import { cmpId, idKey, idsCited } from './ids.mjs';
import { mergedOf } from './issues.mjs';
import { carriesCode, gateOf, readLoop } from './loop.mjs';
import { reasonWord, shellWord, waitingOn } from './commands.mjs';
import { inFlightMark, nextRows, schedulerNote } from './evidence.mjs';

// The holders: the owner, the jarl, a named coordinator or a named outside person. With no slice in the loop, every row
// a coordinator would hold is the jarl's.
export const OWNER_HOLDER = 'owner';
export const JARL_HOLDER = 'jarl';
// How many lines next --as prints before it counts the rest; --all prints every one.
export const BALL_SHOWN = 7;
const TITLE = 70;
const short = (t, n = TITLE) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

// The name the asker gives, read as a holder: a name that reads as owner is the owner, jarl is the jarl, any other name
// is kept as given (a coordinator or an outside person).
export function holderOf(name) {
  need(typeof name === 'string' && fieldText(name), '--as names who asks: owner, jarl, a coordinator or a person by name');
  const plain = fieldText(name);
  const letters = plain.toLowerCase().replace(/[^\p{L}]/gu, '');
  if (letters === OWNER_HOLDER || letters === `the${OWNER_HOLDER}`) return OWNER_HOLDER;
  if (letters === JARL_HOLDER || letters === `the${JARL_HOLDER}`) return JARL_HOLDER;
  return plain;
}
const holderWord = (h) => (h === OWNER_HOLDER || h === JARL_HOLDER ? `the ${h}` : h);

// The status a move of each kind goes into, read from the profile's flags: the first status that holds the claim, and
// the first that closes the record (else the first terminal one).
function statusWith(profile, flag, fallback) {
  return profile.statuses.find((s) => profile.is(s, flag)) || (fallback ? profile.statuses.find((s) => profile.is(s, fallback)) : undefined) || flag;
}

// The issue rows: what the record says about an issue in play, as the step it points to and who takes it. The jarl
// holds them all while the loop has no slices; the worker of a lease is the one who does the step, and the jarl still
// holds the line.
function issueRows(ctx) {
  const { loop, profile } = ctx;
  const leaseStatus = statusWith(profile, 'holds-claim');
  const closeStatus = statusWith(profile, 'closes-record', 'terminal');
  const out = [];
  // Open and offered by next: ready to start.
  for (const r of ctx.next.filter((x) => x.ready)) {
    out.push({ what: 'ready', id: r.id, title: r.title, priority: r.priority, holder: JARL_HOLDER,
      says: 'ready to start, raise a worker', command: `jarl.mjs set ${r.id} ${leaseStatus} --branch <branch> --worker <name>` });
  }
  const evidence = `--ran "<command>" --saw "<what it printed>"`;
  const verdict = (id) => `jarl.mjs review ${id} approve|changes --by <reviewer> "<findings>"`;
  for (const i of loop.issues.filter((x) => profile.is(x.status, 'holds-claim') && !waitingOn(x, loop.byId, profile).length)) {
    const mark = inFlightMark(loop, i);
    const worker = fieldText(i.fields.worker) || null;
    const base = { id: i.id, title: i.title, priority: i.priority, holder: JARL_HOLDER, ...(worker ? { doer: worker } : {}) };
    const withWorker = worker ? `with worker ${worker}` : 'in progress';
    const backAfterRound = sentBack(loop, i, mark);
    if (mark === 'no-rows' || backAfterRound) {
      out.push({ ...base, what: 'worker', says: `${withWorker}${fieldText(i.fields.since) ? ` since ${fieldText(i.fields.since)}` : ''}, ${backAfterRound ? 'sent back by a round, no new proof yet' : 'no proof yet'}; the worker records it`, command: `jarl.mjs evidence ${i.id} ${evidence}` });
      continue;
    }
    if (mark === 'rows-no-verdict' && profile.doneGate.approve === 'none') {
      // A done gate that asks for no approve: the proof is enough, and the merge (when the gate asks for one) comes next.
      const merge = profile.doneGate['requires-merged'] && !mergedOf(i);
      out.push({ ...base, what: merge ? 'merge' : 'close', says: merge ? 'proof recorded, not merged; merge it' : 'proof recorded; close it',
        command: merge ? `jarl.mjs merged ${i.id} --sha <sha> --ran "<check>" --saw "<summary>"` : `jarl.mjs set ${i.id} ${closeStatus} "<why>"` });
      continue;
    }
    if (mark === 'rows-no-verdict' && carriesCode(i)) continue;   // listed together below
    if (mark === 'rows-no-verdict') {
      out.push({ ...base, what: 'review', says: 'proof recorded, no verdict; raise a reviewer', command: verdict(i.id) });
      continue;
    }
    if (mark === 'approved-not-fresh') {
      out.push({ ...base, what: 'review', says: 'approved by a coordinator only, and it carries code; raise a fresh reviewer', command: verdict(i.id) });
      continue;
    }
    if (mark === 'changes-requested') {
      out.push({ ...base, what: 'changes', says: 'changes asked by its reviewer; send it back to a worker', command: `jarl.mjs round ${i.id} "<what failed>"` });
      continue;
    }
    if (mark === 'approved' && carriesCode(i)) {
      out.push({ ...base, what: 'merge', says: 'approved, not merged; merge it', command: `jarl.mjs merged ${i.id} --sha <sha> --ran "<check>" --saw "<summary>"` });
      continue;
    }
    if (mark === 'merged-ci') {
      out.push({ ...base, what: 'ci', says: 'merged, its CI not green yet; record the result', command: `jarl.mjs merged ${i.id} --ci green|red` });
      continue;
    }
    out.push({ ...base, what: 'close', says: mark === 'merged' ? 'merged; close it' : 'approved; close it', command: `jarl.mjs set ${i.id} ${closeStatus} "<why>"` });
  }
  out.push(...reviewRow(ctx, verdict));
  return out;
}

// A round sends the work back: until the worker records a row after it, the issue is the worker's again.
function sentBack(loop, issue, mark) {
  const lastRound = (loop.eventsById.get(issue.id) || []).filter((e) => e.type === 'round').reduce((n, e) => Math.max(n, e.n), -1);
  const rowsAfterRound = gateOf(loop, issue.id).rowLog.filter((r) => !r.retracted && r.inWindow && r.n > lastRound).length;
  return lastRound >= 0 && rowsAfterRound === 0 && mark === 'rows-no-verdict';
}

// The issues in play whose code has proof and no verdict, and waits for a fresh reviewer.
function awaitingReview(loop, profile) {
  if (profile.doneGate.approve === 'none') return [];
  return loop.issues.filter((i) => profile.is(i.status, 'holds-claim') && !waitingOn(i, loop.byId, profile).length && carriesCode(i)
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
function reviewRow(ctx, verdict) {
  const todo = ctx.awaiting.filter((i) => !ctx.onOwner.has(i.id));
  if (!todo.length) return [];
  const ids = joinIds(todo);
  const only = todo.length === 1 ? todo[0] : null;
  const worker = only ? fieldText(only.fields.worker) : '';
  const priority = todo.map((i) => i.priority).filter((p) => p !== undefined).sort()[0];
  return [{
    what: 'review', id: todo[0].id, ids: todo.map((i) => i.id), title: only ? only.title : '', priority, holder: JARL_HOLDER, ...(worker ? { doer: worker } : {}),
    says: `proof recorded, no verdict; raise a fresh reviewer for ${ids}; if you cannot raise agents, ask the owner to start a fresh session`,
    command: `${only ? verdict(only.id) : verdict('<id>')}, or jarl.mjs ask "${REVIEW_ASK} issue${todo.length === 1 ? '' : 's'} ${ids}"`,
  }];
}

// The owner's rows: every open question and every item to ratify. A ratify item blocks nothing.
function questionRows(ctx) {
  return ctx.loop.asks.filter((a) => a.state === 'open').map((a) => {
    const ref = `a-${a.id}`;
    if (a.kind === 'ratify') return { what: 'ratify', ask: a.id, title: a.question, holder: OWNER_HOLDER, says: `to ratify${a.issue ? ` (issue ${a.issue})` : ''}`, command: `jarl.mjs answer ${ref} "yes" --by owner (or "reject")` };
    // A question that asks for a fresh review holds the proofs it names, as far as they still await one.
    const keys = new Set(reviewAskKeys(ctx.loop, a.question));
    const reviewing = ctx.loop.issues.filter((i) => ctx.onOwner.has(i.id) && keys.has(idKey(i.id))).map((i) => i.id);
    return { what: 'question', ask: a.id, kind: a.kind || 'stuck', title: a.question, holder: OWNER_HOLDER, ...(reviewing.length ? { reviewing } : {}),
      says: `question (${a.kind || 'stuck'})${a.issue ? ` on issue ${a.issue}` : ''}${reviewing.length ? `, the fresh review of ${reviewing.join(', ')} waits on it` : keys.size ? ', no issue it names awaits a review now' : ''}`, command: `jarl.mjs answer ${ref} "<answer>"` };
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
      command: `jarl.mjs new "<title>", then jarl.mjs decide <slug> "<ruling>" --supersedes ${d.slug} --settles <id>` });
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

// The sources of the rows, in order. Each reads the record through the context and gives rows { what, holder, says,
// command, and id, ask or ruling }; a kind of open thing the record learns to hold adds its own source here.
export const ROW_SOURCES = [issueRows, questionRows, rulingRows];
// The rows a composer's scheduler owns: under an external scheduler Jarl lists only the others.
const SCHEDULING = new Set([issueRows]);

// Every row of the loop, ordered as one display (never a schedule): the owner's rows first, then by how many issues each
// holds up directly, an item to ratify after a question (it blocks nothing), then by priority and number. A question of
// kind stop holds up the whole loop.
export function ballRows(root) {
  const loop = readLoop(jarlDir(root));
  const { profile } = loop;
  const scheduled = profile.scheduler !== null;
  const awaiting = scheduled ? [] : awaitingReview(loop, profile);
  const ctx = { root, loop, profile, next: scheduled ? [] : nextRows(root, {}), awaiting, onOwner: new Set(heldByOwner(loop, awaiting)) };
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
    else if (r.what === 'question') r.holdsUp = [...new Set([...(heldByQuestion.has(r.ask) ? [heldByQuestion.get(r.ask)] : []), ...upOf(r.reviewing || [])])];
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
  const holderOfIssue = new Map(rows.filter((r) => r.id !== undefined).flatMap((r) => (r.ids || [r.id]).map((id) => [id, r.holder])));
  for (const id of onOwner) holderOfIssue.set(id, OWNER_HOLDER);
  const heldBy = new Map(next.filter((r) => r.heldBy && r.heldBy.length && !r.ready).map((r) => [r.id, r.heldBy]));
  const questionOf = new Map(next.filter((r) => r.group === 'held-by-question').map((r) => [r.id, r.questions]));
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
  // The holder an issue that waits on nothing itself puts the wait on: its own row's, the owner's through a question
  // that names it, or the holder of the issue that holds its file; null when the record names nobody (a status no flag
  // puts in play).
  const onOf = (b) => {
    if (holderOfIssue.has(b.id)) return holderOfIssue.get(b.id);
    if (questionOf.has(b.id)) return OWNER_HOLDER;
    const h = (heldBy.get(b.id) || []).find((x) => holderOfIssue.has(x));
    return h ? holderOfIssue.get(h) : null;
  };
  // One entry per waiting issue and holder, with every issue it waits through.
  const entries = new Map();
  const add = (i, on, through) => {
    if (on === null) return;
    const key = `${i.id}\n${on}`;
    if (!entries.has(key)) entries.set(key, { id: i.id, title: i.title, on, via: [] });
    const e = entries.get(key);
    if (!e.via.includes(through)) e.via.push(through);
  };
  for (const i of loop.issues.filter((x) => profile.active(x.status) && waitingOn(x, byId, profile).length)) {
    for (const b of roots(i)) add(i, onOf(b), b.id);
  }
  for (const [id, holders] of heldBy) {
    const h = holders.find((x) => holderOfIssue.has(x));
    if (h) add(byId.get(id), holderOfIssue.get(h), h);
  }
  return [...entries.values()].sort((a, b) => cmpId(a.id, b.id));
}

// next --as <holder> [--all]: what is on that holder now, each line with the command that moves it — at most seven, then
// how many more; --all every line, and the issues that wait on this holder, with the issue they wait through. A named
// coordinator holds nothing while the loop has no slices: its rows are the jarl's, and the answer says so. Under an
// external scheduler the rows of issues in play are the composer's, and the answer names its command for them.
export function cmdNextAs(root, flags = {}) {
  const holder = holderOf(flags.as);
  const { loop, rows, scheduled, waiting } = ballRows(root);
  const mine = rows.filter((r) => r.holder === holder);
  const all = flags.all === true;
  const shown = all ? mine : mine.slice(0, BALL_SHOWN);
  const waits = waiting.filter((w) => w.on === holder);
  const coordinator = holder !== JARL_HOLDER && holder !== OWNER_HOLDER && loop.coordinators.some((c) => fieldText(c).toLowerCase() === holder.toLowerCase());
  return {
    as: holder, rows: shown, total: mine.length, more: mine.length - shown.length,
    waiting: all ? waits : [], waitingTotal: waits.length,
    ...(coordinator ? { note: 'with no slice in the loop, what a coordinator holds is the jarl\'s: jarl.mjs next --as jarl' } : {}),
    ...(scheduled ? { scheduler: loop.profile.scheduler, schedulerNote: `the issues in play are the composer's: ${schedulerNote(loop.profile.scheduler)}` } : {}),
  };
}

export function renderNextAs(o) {
  const line = (r) => `- ${refOf(r)}${r.what === 'ruling' || !r.title ? '' : ` ${short(r.title)}`}: ${r.says}${r.doer && r.what !== 'worker' ? ` (worker ${r.doer})` : ''} — ${r.command}${r.holdsUp.length ? ` · holds up ${r.holdsUp.slice(0, 5).join(', ')}${r.holdsUp.length > 5 ? ` and ${r.holdsUp.length - 5} more` : ''}` : ''}`;
  const out = [`On ${holderWord(o.as)} (${o.total})`];
  if (!o.total) out.push(`- (nothing is on ${holderWord(o.as)})`);
  out.push(...o.rows.map(line));
  const rest = [o.more && `${o.more} more`, !o.waiting.length && o.waitingTotal && `${o.waitingTotal} issue(s) waiting on ${holderWord(o.as)}`].filter(Boolean);
  if (rest.length) out.push(`and ${rest.join(', and ')}: jarl.mjs next --as ${shellWord(o.as)} --all`);
  if (o.waiting.length) {
    out.push('', `Waiting on ${holderWord(o.as)} (${o.waiting.length})`);
    out.push(...o.waiting.map((w) => `- ${w.id} ${short(w.title)}: waits on ${holderWord(w.on)} via ${w.via.join(', ')}`));
  }
  if (o.note) out.push(o.note);
  if (o.schedulerNote) out.push(o.schedulerNote);
  return out.join('\n');
}

// The asker's list at the end of status --as and resume --as: what next --as prints, under its own heading.
export function askerSection(root, as) {
  const o = cmdNextAs(root, { as });
  return { as: o, text: `## ${renderNextAs(o)}` };
}
