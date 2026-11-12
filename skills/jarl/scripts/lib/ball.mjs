// What is on whom: every open thing of the loop has one holder who must move next, derived from the record and never
// stored, and next --as <holder> lists what is on that one, each line with the command that moves it.

import { PROMISE_KIND, WAIT_KIND, fieldText, jarlLine, need, printCommand, slugify } from './base.mjs';
import { cmpId, idKey, idsCited } from './ids.mjs';
import { mergedOf } from './issues.mjs';
import { carriesCode, gateOf, holderKey, inFlightMark, leaseConflictForm, leaseConflictOf, leaseConflictText, roundSinceLease, sameHolder, sentBack, statusWith, worksInPlace } from './gate.mjs';
import { coordinatorOf, integrationBranch, sameSlice, sliceOf } from './slices.mjs';
import { git } from './git.mjs';
import { readLoop } from './loop.mjs';
import { gatedMark, modelLines, modelReviewForm } from './models.mjs';
import { examinerDepth } from './brief.mjs';
import { liveMerger } from './queue.mjs';
import { baseOf, issueRepos, repoLabel } from './repositories.mjs';
import { reasonWord } from './shared.mjs';
import { waitingOn } from './after.mjs';
import { mergeAgainWhy, nextRows } from './evidence.mjs';
import { ownerLineStates } from './owner-lines.mjs';
import { ruleLines, rulesFor } from './rules.mjs';
import { jarlDir, today } from './where.mjs';
import { ago, leaseLiveness, livenessOf, takeoverDue, thresholdText } from './rounds.mjs';
import { LINE_FORM, noRowOwed, workerRowsMissing } from './lines.mjs';
import { sameLease } from './leases.mjs';

// The holders: the owner, the jarl, a named coordinator or a named outside person. A ready issue, a lease, a proof with no
// verdict and a changes verdict are held by the coordinator whose slice the issue is in, and by the jarl for an issue in
// no slice; with no slice in the loop every one of them is the jarl's.
export const OWNER_HOLDER = 'owner';
export const JARL_HOLDER = 'jarl';
// How many lines next --as prints before it counts the rest; --all prints every one.
export const BALL_SHOWN = 7;
const TITLE = 70;
// A title in the list of issues one line names.
const MEMBER_TITLE = 30;
// A title on one line: a question of several lines is one row, its lines joined.
const short = (text, n = TITLE) => { const t = fieldText(text); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

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
// Who keeps a promise: the one its Found by names (the jarl when it names nobody). Who a wait is held by: its Person.
const makerOf = (issue) => holderOf(fieldText(issue.fields['found by']) || JARL_HOLDER);
const personOf = (issue) => (fieldText(issue.fields.person) ? holderOf(fieldText(issue.fields.person)) : null);

// The coordinator who holds an issue's rows: the one whose slice it is in (see coordinatorOf), or the jarl.
const sliceHolder = (loop, issue) => coordinatorOf(loop, issue);
// A parent in a status that offers it is in play for its rows once its sub-issues are all settled: its own acceptance is
// then checked against the whole, reviewed and closed, as a lease's work is. A parent in a lease is in play as any lease.
const isParent = (i) => Boolean(i.tree && i.tree.children.length);
const checking = (profile, i) => isParent(i) && profile.is(i.status, 'dispatchable');
const inPlayForRows = (profile, i) => profile.is(i.status, 'holds-claim') || checking(profile, i);
// The step for an issue whose recorded merge done does not count for its code as it is now (see mergeAgainWhy).
const MERGE_AGAIN = 'merge it again and record the merge';

// The issue rows: what the record says about an issue in play, as the step it points to and who takes it. The worker of
// a lease is the one who does the step, and the holder of its slice (the jarl, with none) still holds the line.
function issueRows(ctx) {
  const { loop, profile } = ctx;
  const holderOfId = (id) => sliceHolder(loop, loop.byId.get(id));
  const leaseStatus = statusWith(profile, 'holds-claim');
  const closeStatus = statusWith(profile, 'closes-record', 'terminal');
  const out = [];
  // Open and offered by next: ready to start, unless it holds no line, which leaves a worker nothing to prove: then the
  // move is to write one. A parent offered there is in play below, for its check.
  for (const r of ctx.next.filter((x) => x.ready && !x.subs)) {
    const i = loop.byId.get(r.id);
    if (r.noAcceptance) {
      out.push({ what: 'no-line', id: r.id, title: r.title, priority: r.priority, holder: holderOfId(r.id),
        says: 'no acceptance line, so there is nothing a lease could prove: write its first line', command: jarlLine('field', r.id, 'Acceptance', LINE_FORM) });
      continue;
    }
    out.push({ what: 'ready', id: r.id, title: r.title, priority: r.priority, holder: holderOfId(r.id),
      says: 'ready to start, raise a worker', command: jarlLine('set', r.id, leaseStatus, ...(worksInPlace(i) ? [] : ['--branch', '<branch>']), '--worker', '<name>', '--model', '<model-id>') });
  }
  const evidence = (id, by = '<who>') => jarlLine('evidence', id, '--ran', '<command>', '--saw', '<what-it-printed>', '--line', '<line-number>', '--by', by);
  const verdict = (id) => jarlLine('review', id, '<verdict>', '--by', '<reviewer>', '--model', '<model-id>', '<text>');
  const unclearedBy = new Map();
  // A wait has rows of its own (keptRows); a promise in a lease is worked as any issue, and its maker holds each line.
  for (const i of loop.issues.filter((x) => inPlayForRows(profile, x) && profile.keptKind(x.kind) !== WAIT_KIND && !waitingOn(x, loop.byId, profile).length)) {
    // A question that holds the issue back holds it here too: the check of a parent waits for the answer, as next says.
    if (checking(profile, i) && ctx.next.some((r) => r.id === i.id && r.group === 'held-by-question')) continue;
    const { mark, missing } = gatedMark(loop, i);
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
    // A slice with a merger of its own: on that merger, which lands the slice's work on its integration branch.
    const slicem = liveMerger(ctx.root, loop, i);
    const onMerger = { ...base, holder: slicem ? holderOf(slicem.name) : ctx.merger, ...(slicem ? { target: integrationBranch(slicem.slice) } : {}) };
    const withWorker = worker ? `with worker ${worker}` : 'in progress';
    const since = fieldText(i.fields.since) ? ` since ${fieldText(i.fields.since)}` : '';
    const lv = ctx.liveness(i);
    if (profile.is(i.status, 'holds-claim') && !promise && !AT_THE_MERGE.has(mark) && takeoverDue(ctx.root, i, loop.eventsById.get(i.id) || [])) {
      // The round that reached the limit said a takeover is due; it stands until a lease is handed over, whatever else the
      // issue's record holds, so no compaction loses it.
      const ids = leaseIds(loop, i);
      out.push({ ...base, what: 'takeover', says: `the round limit is reached, so a takeover is due: raise a fresh worker, one tier up or on another model, or with a changed approach, and hand it the old diff to use or discard`,
        command: jarlLine('set', ids.join(','), leaseStatus, '<why-the-worker-changed>', '--worker', '<the-new-worker>', '--model', '<model-id>', '--handover') });
      continue;
    }
    if ((mark === 'no-rows' || backAfterRound) && lv.idle) {
      // Idle past the threshold: a worker stuck on a prompt or a lock writes nothing, so the act is the holder's.
      out.push({ ...base, what: 'idle', idle: { ageMs: lv.ageMs, minutes: lv.minutes }, says: `${withWorker}${since}, ${lv.lastWork ? 'no commit, row, log line or change in its worktree' : 'no commit, row or log line'} for ${idleFor(lv)}: ask the worker whether it waits on a prompt or a lock, or hand the lease over`,
        command: jarlLine('set', leaseIds(loop, i).join(','), leaseStatus, '<why-the-worker-changed>', '--worker', '<the-new-worker>', '--model', '<model-id>', '--handover') });
      continue;
    }
    if (mark === 'no-rows' || backAfterRound) {
      // A read line takes no row: with no row owed there is no proof to ask for, and the next move is the examiner's.
      if (!noRowOwed(i)) {
        out.push({ ...base, what: 'worker', workersMove: true, says: `${withWorker}${since}, ${backAfterRound ? 'sent back by a round, no new proof yet' : 'no proof yet'}; the worker records it`, command: evidence(i.id, fieldText(i.fields.worker) || '<who>') });
      } else {
        out.push({ ...base, what: 'worker', says: `${withWorker}${since}${backAfterRound || roundSinceLease(loop, i) ? ', sent back by a round' : ''}: no row is owed for read lines; raise a fresh examiner when it reports`, command: jarlLine('brief', i.id, '--role', 'reviewer') });
      }
      continue;
    }
    // A close the done gate would refuse for an owner line not ticked is not offered: that line's own row stands instead.
    const unticked = (ctx.ownerStates.get(i.id) || []).some((s) => !s.tick);
    if (mark === 'rows-no-verdict' && profile.doneGate.approve === 'none') {
      // A done gate that asks for no approve: the proof is enough, and the merge (when the gate asks for one) comes next.
      const again = profile.doneGate['requires-merged'] ? mergeAgainWhy(loop, i) : null;
      const merge = profile.doneGate['requires-merged'] && (!mergedOf(i) || Boolean(again));
      if (!merge && unticked) continue;
      out.push({ ...(merge ? onMerger : onJarl), what: merge ? 'merge' : 'close', says: again ? `proof recorded, and ${again}; ${MERGE_AGAIN}` : merge ? 'proof recorded, not merged; merge it' : 'proof recorded; close it',
        command: merge ? jarlLine('merged', i.id, '--sha', '<sha>', '--ran', '<command>', '--saw', '<what-it-printed>') : jarlLine('set', i.id, closeStatus, '<text>') });
      continue;
    }
    if (mark === 'rows-no-verdict' && carriesCode(i) && profile.keptKind(i.kind) !== PROMISE_KIND) {
      const gap = rowsGap(loop, i);
      if (gap) {
        const [own, lines] = gap.id === i.id ? ['its', gap.lines] : [`${gap.id}'s`, gap.lines];
        out.push({ ...base, what: 'worker', workersMove: true, says: `${withWorker}${since}, ${own} rows for ${lines.length === 1 ? 'line' : 'lines'} ${lines.join(', ')} are missing, and a review is offered for a whole branch once every issue on it has its worker's rows; the worker records them`, command: evidence(gap.id) });
      }
      continue;   // the branches with every row are listed together below
    }
    if (mark === 'rows-no-verdict') {
      out.push({ ...base, what: 'review', ...(lv.idle ? { idle: { ageMs: lv.ageMs, minutes: lv.minutes } } : {}), says: `${checking(profile, i) ? 'checked against the whole' : 'proof recorded'}, no verdict${lv.idle ? ` for ${idleFor(lv)}` : ''}; raise a reviewer`, command: verdict(i.id) });
      continue;
    }
    // Approves that do not clear: listed together per holder below, in the units of a shared review. An approve the
    // reviewer rule refuses for its model is one of them, the reading the merge queue and done take: it is not merged or
    // closed on, and one alone says what is missing.
    if (mark === 'approved-not-fresh' || mark === 'approved-not-cleared' || mark === 'approved-model-refused') {
      const key = `${mark}\n${holderKey(holder)}`;
      if (!unclearedBy.has(key)) unclearedBy.set(key, { mark, holder, issues: [], missing: new Map() });
      unclearedBy.get(key).issues.push(i);
      if (missing) unclearedBy.get(key).missing.set(i.id, missing);
      continue;
    }
    if (mark === 'changes-requested') {
      out.push({ ...base, what: 'changes', says: 'changes asked by its reviewer; send it back to a worker', command: jarlLine('round', i.id, '<text>') });
      continue;
    }
    if (mark === 'approved' && carriesCode(i)) {
      const again = mergeAgainWhy(loop, i);
      const landed = !again && !mergedOf(i) && branchInItsTarget(ctx.root, loop, i);
      out.push({ ...onMerger, what: 'merge', says: again ? `approved, and ${again}; ${MERGE_AGAIN}` : landed ? 'approved, and its branch is in its base already, with no merge on record; record the merge' : 'approved, not merged; merge it', command: jarlLine('merged', i.id, '--sha', '<sha>', '--ran', '<command>', '--saw', '<what-it-printed>') });
      continue;
    }
    if (mark === 'merged-ci') {
      out.push({ ...onJarl, what: 'ci', says: 'merged, its CI not green yet; record the result', command: jarlLine('merged', i.id, '--ci', '<ci-state>') });
      continue;
    }
    if (unticked) continue;
    out.push({ ...onJarl, what: 'close', says: mark === 'merged' ? 'merged; close it' : worksInPlace(i) ? 'approved and worked in place; commit its files, record the commit as a row, then close it' : 'approved; close it', command: jarlLine('set', i.id, closeStatus, '<text>') });
  }
  // One line per holder for the proofs of code with no verdict: each coordinator raises its own slice's reviewer.
  const byHolder = new Map();
  for (const i of ctx.awaiting.filter((x) => !ctx.onOwner.has(x.id))) {
    const h = sliceHolder(loop, i);
    byHolder.set(h, [...(byHolder.get(h) || []), i]);
  }
  for (const [holder, todo] of byHolder) out.push(...reviewRow(ctx.root, todo, holder, verdict, ctx.liveness));
  for (const { mark, holder, issues, missing } of unclearedBy.values()) out.push(unclearedRow(ctx.root, issues, holder, mark, mark === 'approved-model-refused' ? modelReviewForm : verdict, missing));
  return out;
}
// The issues of one holder whose approves stand and do not clear them, one kind of cause at a time: one issue keeps its
// line, several are one line cut into the units one reviewer may take, as the proofs with no verdict are.
const UNCLEARED_SAYS = {
  'approved-not-fresh': ['approved by a coordinator only, and it carries code; raise a fresh reviewer', 'approved by a coordinator only, and they carry code; raise one fresh reviewer per unit'],
  'approved-not-cleared': ['approved, and no approve it holds clears it under the loop\'s done gate; raise a reviewer whose approve does', 'approved, and no approve they hold clears them under the loop\'s done gate; raise one reviewer whose approve does per unit'],
  'approved-model-refused': [(missing) => `approved, and done refuses the approve for its model — ${missing}; raise a reviewer whose approve the rule accepts`, 'approved, and done refuses their approves for their model; raise one reviewer whose approve the rule accepts per unit'],
};
// `missing` holds, by id, what the reviewer rule finds missing in an approve it refuses for its model.
function unclearedRow(root, issues, holder, mark, verdict, missing = new Map()) {
  const [one, many] = UNCLEARED_SAYS[mark];
  const worker = fieldText(issues[0].fields.worker) || null;
  if (issues.length === 1) return { id: issues[0].id, title: issues[0].title, priority: issues[0].priority, holder, ...(worker ? { doer: worker } : {}), what: 'review', says: typeof one === 'function' ? one(missing.get(issues[0].id)) : one, command: verdict(issues[0].id) };
  const units = reviewUnits(root, issues);
  return { what: 'review', id: issues[0].id, ids: issues.map((i) => i.id), units, title: '', priority: issues.map((i) => i.priority).filter((p) => p !== undefined).sort()[0], holder,
    says: `${many}: ${units.map(unitText).join(' · ')}`, command: verdict('<ids>') };
}
// What a host needs to carry a move that raises an agent, and no judgement: for each agent, its role, the default model for
// the tier it needs, the branch it works on and the command that prints its brief. Moves that raise nobody have none.
function raisesOf(loop, models, row) {
  const { profile } = loop;
  const byId = (ids) => ids.map((id) => loop.byId.get(id)).filter(Boolean);
  const proposed = (i) => fieldText(i.fields.branch) || `jarl/${i.id}-${slugify(i.title)}`;
  const worker = (i) => ({ role: 'worker', model: models.defaultOf(i.tier), branch: proposed(i), command: jarlLine('brief', i.id), ...(worksInPlace(i) ? { inPlace: true } : {}) });
  const reviewer = (ids) => { const issues = byId(ids); const tier = examinerDepth(loop, issues).tier; return { role: 'reviewer', model: models.defaultOf(tier), tier, branch: issues[0] ? proposed(issues[0]) : null, command: jarlLine('brief', ids.join(','), '--role', 'reviewer') }; };
  const merger = (extra) => ({ role: 'merger', model: models.defaultOf('standard'), ...extra });
  if (row.what === 'takeover' && loop.byId.has(row.id)) {
    // A takeover moves the whole lease, on the highest tier any issue of it carries, as its brief does.
    const lease = byId(leaseIds(loop, loop.byId.get(row.id)));
    const highest = profile.tiers.reduce((best, t) => (lease.some((i) => i.tier === t) ? t : best), lease[0].tier);
    return [{ role: 'worker', model: models.defaultOf(highest), branch: proposed(lease[0]), command: jarlLine('brief', lease.map((i) => i.id).join(',')) }];
  }
  if (row.what === 'ready' && loop.byId.has(row.id)) return [worker(loop.byId.get(row.id))];
  if (row.what === 'review') return (row.units ? row.units.map((u) => u.ids) : [row.ids ?? [row.id]]).map(reviewer);
  if (row.what === 'merge' && row.integration) return [merger({ branch: row.branch, integration: true, command: jarlLine('brief', '--role', 'merger') })];
  if (row.what === 'merge') {
    const i = loop.byId.get(row.id);
    const m = i ? liveMerger(loop.root, loop, i) : null;
    return [merger({ branch: i ? fieldText(i.fields.branch) || null : null, ...(m ? { target: integrationBranch(m.slice) } : {}), command: jarlLine('brief', '--role', 'merger', ...(m ? ['--slice', m.slice] : [])) })];
  }
  return [];
}
// How long an idle lease or proof has had no sign of work, with the threshold it is past.
const idleFor = (lv) => `${ago(lv.ageMs)} (threshold ${thresholdText(lv.minutes)})`;

// Whether an approved issue's branch is held whole by the branch its merger lands on (the integration branch of its slice
// where it has one, else the base), in every repository of the issue where the branch exists: the merge queue then lists
// it as a merge to record, and nothing is left to land.
function branchInItsTarget(root, loop, issue) {
  const branch = fieldText(issue.fields.branch);
  if (!branch) return false;
  const m = liveMerger(root, loop, issue);
  const repos = issueRepos(root, issue).filter((r) => git(r, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`]) !== null);
  return repos.length > 0 && repos.every((r) => {
    const into = m && git(r, ['rev-parse', '--verify', '--quiet', `refs/heads/${integrationBranch(m.slice)}^{commit}`]) !== null ? integrationBranch(m.slice) : baseOf(root, r);
    return git(r, ['merge-base', '--is-ancestor', branch, into]) !== null;
  });
}

// The issues in play whose code has proof and no verdict, and waits for a fresh reviewer.
function awaitingReview(loop, profile) {
  if (profile.doneGate.approve === 'none') return [];
  return loop.issues.filter((i) => inPlayForRows(profile, i) && !profile.keptKind(i.kind) && !waitingOn(i, loop.byId, profile).length && carriesCode(i)
    && inFlightMark(loop, i) === 'rows-no-verdict' && !sentBack(loop, i, 'rows-no-verdict') && !rowsGap(loop, i));
}
// The issues of one lease, the given one among them, in the record's order.
function leaseIds(loop, issue) {
  const mates = loop.issues.filter((x) => x.id !== issue.id && sameLease(loop.root, loop.profile, x, issue)).map((x) => x.id);
  return [issue.id, ...mates].sort(cmpId);
}
// The first issue of `issue`'s lease whose worker still owes rows (see workerRowsMissing), and which lines: a review is
// offered for a whole branch once none does. Null when none owes any, or when the issue carries no code.
function rowsGap(loop, issue) {
  if (!carriesCode(issue)) return null;
  const onLease = leaseIds(loop, issue).map((id) => loop.byId.get(id)).filter((i) => inPlayForRows(loop.profile, i));
  for (const i of onLease) {
    const lines = workerRowsMissing(loop, i);
    if (lines.length) return { id: i.id, lines };
  }
  return null;
}

// The proofs of code with no verdict, as one line: a fresh reviewer for all of them at once, or, where the jarl cannot
// raise agents, a question asking the owner to start a fresh session. The record cannot tell the two apart, so the line
// offers both. A proof that an open question of that wording names is the owner's: it leaves the jarl's list, and the
// issues that wait on it wait on the owner. A question whose issues all have a verdict holds nothing.
const REVIEW_ASK = 'start a fresh session to review';
// The sentence a question opens with to ask for a review: the phrase, then "issue" or "issues" and the one list of numbers
// that runs on from it, joined by a comma (with or without a space after it), by and or or between spaces, or by an ampersand. The list ends
// at the first thing that is not a join and a number, so a number later in the question is not asked about.
const ASKED_NUMBER = '#?\\d+(?![\\w/-])(?![.:]\\d)';
const ASKED_JOIN = '(?:,\\s*(?:(?:and|or)\\s+)?|\\s+(?:and|or)\\s+|\\s*&\\s*)';
const REVIEW_ASK_RE = new RegExp(`^${REVIEW_ASK} issues?\\s+${ASKED_NUMBER}(?:${ASKED_JOIN}${ASKED_NUMBER})*`, 'i');
// The issues a question asks for a fresh review of, by key: the issues of that one list the loop holds (idsCited reads the
// numbers of the sentence); none for any other question.
function reviewAskKeys(loop, question) {
  const m = REVIEW_ASK_RE.exec(question);
  return m ? idsCited(m[0].replace(/,(?=\S)/g, ', '), loop.byId).map(idKey) : [];
}
// The proofs awaiting a fresh reviewer that an open question names: the ones the owner holds.
// Only a plain question holds: a ratify item blocks nothing, and an escalation, a rule and a promotion have rows of their own.
const HOLDS_NO_REVIEW = new Set(['escalation', 'rule', 'ratify']);
function heldByOwner(loop, awaiting) {
  const asked = new Set(loop.asks.filter((a) => a.state === 'open' && !HOLDS_NO_REVIEW.has(a.kind)).flatMap((a) => reviewAskKeys(loop, a.question)));
  return awaiting.filter((i) => asked.has(idKey(i.id))).map((i) => i.id);
}
const joinIds = (issues) => issues.map((i) => i.id).join(', ');
// The units one fresh reviewer takes, out of the proofs that wait for a verdict: a lease is one review, so the issues leased
// on one branch of one repository are one unit, whatever it carries; a branch of the same name in another repository is
// another diff. Every other issue is a unit of its own. Each is { ids }, and a grouped one adds what it shares:
// { shares: 'branch', on }, and { in }, the names of its repositories, where another unit's branch has the same name.
function reviewUnits(root, todo) {
  const byBranch = new Map();
  for (const i of todo) {
    const b = fieldText(i.fields.branch);
    const repos = b ? issueRepos(root, i) : [];
    const key = b ? `${repos.join('\n')}\n\n${b}` : `\n${i.id}`;
    if (!byBranch.has(key)) byBranch.set(key, { branch: b, repos, issues: [] });
    byBranch.get(key).issues.push(i);
  }
  const named = new Map();
  for (const g of byBranch.values()) if (g.branch && g.issues.length > 1) named.set(g.branch, (named.get(g.branch) || 0) + 1);
  const units = [];
  for (const { branch, repos, issues } of byBranch.values()) {
    if (issues.length === 1) { units.push({ ids: [issues[0].id] }); continue; }
    const where = named.get(branch) > 1 ? { in: repos.map((r) => repoLabel(r)).join(', ') } : {};
    units.push({ ids: issues.map((i) => i.id), shares: 'branch', on: branch, ...where });
  }
  return units.sort((a, b) => cmpId(a.ids[0], b.ids[0]));
}
const unitText = (u) => (u.shares ? `${u.ids.join(', ')} (one ${u.shares}, ${u.on}${u.in ? ` in ${u.in}` : ''})` : u.ids[0]);
// A proof that waits past the threshold for its verdict says how long: the one issue's age, or each idle issue's.
function reviewRow(root, todo, holder, verdict, liveness) {
  if (!todo.length) return [];
  const ids = joinIds(todo);
  const only = todo.length === 1 ? todo[0] : null;
  const units = reviewUnits(root, todo);
  const worker = only ? fieldText(only.fields.worker) : '';
  const priority = todo.map((i) => i.priority).filter((p) => p !== undefined).sort()[0];
  const idle = todo.map((i) => liveness(i)).filter((lv) => lv.idle);
  const waited = !idle.length ? '' : only ? ` for ${idleFor(idle[0])}` : ` for ${idle.map((lv) => `${ago(lv.ageMs)} on ${lv.id}`).join(', ')} (threshold ${thresholdText(idle[0].minutes)})`;
  return [{
    what: 'review', id: todo[0].id, ids: todo.map((i) => i.id), units, title: only ? only.title : '', priority, holder, ...(worker ? { doer: worker } : {}),
    ...(only ? {} : { issues: todo.map((i) => ({ id: i.id, title: i.title, ...(fieldText(i.fields.worker) ? { doer: fieldText(i.fields.worker) } : {}) })) }),
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
  const verdict = (id) => jarlLine('review', id, '<verdict>', '--by', '<reviewer>', '--model', '<model-id>', '<text>');
  const evidence = (id) => jarlLine('evidence', id, '--ran', '<command>', '--saw', '<what-it-printed>', '--line', '<line-number>', '--by', '<who>');
  const out = [];
  const kept = loop.issues.filter((i) => profile.active(i.status) && !waitingOn(i, loop.byId, profile).length
    && (profile.keptKind(i.kind) === WAIT_KIND || (profile.keptKind(i.kind) === PROMISE_KIND && !profile.is(i.status, 'holds-claim'))));
  for (const i of kept) {
    const { mark } = gatedMark(loop, i);
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
    if (mark === 'rows-no-verdict' || mark === 'approved-not-fresh' || mark === 'approved-not-cleared' || mark === 'approved-model-refused') out.push({ ...base, what: 'review', holder, says: `${done}, proof recorded, no verdict; review it`, command: verdict(i.id) });
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
        out.push({ ...line, holder: sliceHolder(ctx.loop, i), says: `acceptance line ${s.n} is the owner's to tick once its material is there (${s.material}); ${s.why}`, command: jarlLine('evidence', id, '--ran', '<command>', '--saw', '<what-it-printed>', '--line', '<line-number>', '--by', fieldText(i.fields.worker) || '<who>') });
      } else {
        out.push({ ...line, holder: OWNER_HOLDER, material: s.material, check: s.check, says: `acceptance line ${s.n} is yours to tick: review ${s.material}${s.at ? ` (in ${s.at})` : ''} and check ${s.check}`, command: jarlLine('tick', id, s.n, '--by', '<the-owner-himself>') });
      }
    }
  }
  return out;
}

// The owner's rows: every open question and every item to ratify. A ratify item blocks nothing.
function questionRows(ctx) {
  return ctx.loop.asks.filter((a) => a.state === 'open').map((a) => {
    const ref = `a-${a.id}`;
    const stuckTo = askHolder(ctx.loop, a);
    // An escalation goes up from a coordinator and is the jarl's: it names its slice or its issue.
    if (a.kind === 'escalation') return { what: 'escalation', ask: a.id, kind: a.kind, title: a.question, holder: JARL_HOLDER, ...(a.slice ? { slice: a.slice } : {}),
      says: `escalation${a.slice ? ` from slice:${a.slice}` : ''}${a.issue ? ` on issue ${a.issue}` : ''}`, command: jarlLine('answer', ref, '<text>', '--by', 'jarl') };
    // A proposed rule is on the one it was proposed to, and so is a rule of the loop offered for promotion at its close.
    if (a.kind === 'rule') {
      const holder = a.to === OWNER_HOLDER ? OWNER_HOLDER : JARL_HOLDER;
      const by = holder === OWNER_HOLDER ? '<the-owner-himself>' : holder;
      return a.ruling
        ? { what: 'promotion', ask: a.id, title: a.question, holder, ruling: a.ruling, says: `rule ${a.ruling} offered for promotion: ${(a.options || []).map((o) => o.label).join(', ')}`, command: jarlLine('answer', ref, '--option', '<option>', '--by', by) }
        : { what: 'rule', ask: a.id, title: a.question, holder, says: `rule proposed${a.appliesTo ? ` for ${a.appliesTo}` : ''}`, command: jarlLine('answer', ref, '<yes-or-reject-first>', '--by', by) };
    }
    if (a.kind === 'ratify') return { what: 'ratify', ask: a.id, title: a.question, holder: OWNER_HOLDER, says: `to ratify${a.issue ? ` (issue ${a.issue})` : ''}`, command: jarlLine('answer', ref, '<yes-or-reject-first>', '--by', '<the-owner-himself>') };
    // A question that asks for a fresh review holds the proofs it names, as far as they still await one.
    const keys = new Set(reviewAskKeys(ctx.loop, a.question));
    const reviewing = ctx.loop.issues.filter((i) => ctx.onOwner.has(i.id) && keys.has(idKey(i.id))).map((i) => i.id);
    return { what: 'question', ask: a.id, kind: a.kind || 'stuck', title: a.question, holder: stuckTo, ...(reviewing.length ? { reviewing } : {}),
      says: `question (${a.kind || 'stuck'})${a.issue ? ` on issue ${a.issue}` : ''}${stuckTo !== OWNER_HOLDER ? ` from its worker` : ''}${reviewing.length ? `, the fresh review of ${reviewing.join(', ')} waits on it` : keys.size ? ', no issue it names awaits a review now' : ''}`, command: jarlLine('answer', ref, '<text>', '--by', stuckTo === OWNER_HOLDER ? '<the-owner-himself>' : stuckTo) };
  });
}
// Who answers a question: the kinds with a holder of their own are read where they are built. A stuck that names its issue
// whose asker holds that issue's lease is its director's, the coordinator of its slice or the jarl; asked by
// the director itself, it is the owner's; asked by anyone else, or naming no issue, the owner's, as it has always been.
export function askHolder(loop, a) {
  if (a.kind && a.kind !== 'stuck') return OWNER_HOLDER;
  const issue = a.issue ? loop.byId.get(a.issue) : null;
  if (!issue) return OWNER_HOLDER;
  const asked = loop.events.find((e) => new RegExp(`^asked a-${a.id}\\b`).test(e.text));
  const by = asked ? asked.writer : null;
  if (!by) return OWNER_HOLDER;
  const director = coordinatorOf(loop, issue);
  if (sameHolder(by, director)) return OWNER_HOLDER;
  return [...gateOf(loop, issue.id).workers].some((w) => sameHolder(w, by)) ? director : OWNER_HOLDER;
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
  if (reasons.length && cites(reasons[reasons.length - 1][1], slug)) return true;
  const moves = (loop.eventsById.get(issue.id) || []).filter((e) => e.type === 'move');
  return moves.length > 0 && cites(String(moves[moves.length - 1].text || ''), slug);
}

// Whether a text names a ruling: the slug as a whole name, never as the start or the end of a longer one (ask-01 is not
// named by ask-012, nor x-ask-01 by ask-01). A name ends at a character a slug cannot hold, and a full stop that closes a sentence ends it too.
const cites = (text, slug) => new RegExp(`(?<![\\p{L}\\p{N}_.-])${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_-])(?!\\.[\\p{L}\\p{N}_-])`, 'u').test(text);

// The jarl's lease conflicts: an issue whose log leases it twice, by two writers, to two holders, with no move out of the
// lease between the two lines and no handover. One copy of the loop refuses a lease another worker holds, so the two
// lines come from two copies that each leased it before either saw the other, merged. Which lease stands is the jarl's
// to settle.
function leaseConflictRows(ctx) {
  const { loop, profile } = ctx;
  const out = [];
  for (const i of loop.issues) {
    if (i.id === null || i.shared) continue;
    const c = leaseConflictOf(loop, i);
    if (!c) continue;
    out.push({ what: 'conflict', id: i.id, title: i.title, priority: i.priority, holder: JARL_HOLDER, says: leaseConflictText(c), command: leaseConflictForm(profile, i.id) });
  }
  return out;
}

// The integration branches that have work the feature branch lacks: each lands on it as a merge with its check, on the
// default merger, like any landing (see the merge queue, which lists the same branches).
function integrationRows(ctx) {
  const { root, loop } = ctx;
  const out = [];
  for (const m of Object.values(loop.goalLines.mergers)) {
    const branch = integrationBranch(m.slice);
    const held = loop.issues.filter((i) => sameSlice(sliceOf(i), m.slice) && mergedOf(i));
    const repos = [...new Set(held.flatMap((i) => issueRepos(root, i)))].filter((r) => git(r, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`]) !== null);
    for (const repo of repos) {
      const base = baseOf(root, repo);
      const mb = git(repo, ['merge-base', base, branch]);
      const ahead = mb ? Number(git(repo, ['rev-list', '--count', `${mb}..${branch}`]) || 0) : 0;
      if (!ahead) continue;
      const ids = held.filter((i) => git(repo, ['merge-base', '--is-ancestor', mergedOf(i).sha, base]) === null).map((i) => i.id);
      if (!ids.length) continue;
      out.push({ what: 'merge', integration: true, ids, id: ids[0], branch, title: '', priority: loop.byId.get(ids[0]).priority, holder: ctx.merger,
        says: `the integration branch of the slice ${m.slice} has ${ahead} commit${ahead === 1 ? '' : 's'} ${base} lacks: merge it into ${base} and run its check, as any landing`, command: jarlLine('merged', ids.join(','), '--sha', '<sha>', '--ran', '<command>', '--saw', '<what-it-printed>') });
    }
  }
  return out;
}

// The sources of the rows, in order. Each reads the record through the context and gives rows { what, holder, says,
// command, and id, ask or ruling }; a kind of open thing the record learns to hold adds its own source here.
export const ROW_SOURCES = [issueRows, integrationRows, leaseConflictRows, keptRows, ownerLineRows, questionRows, rulingRows];

// The marks at which an approve stands and clears the issue: the work is the merger's, and a takeover due before it is over.
const AT_THE_MERGE = new Set(['approved', 'merged', 'merged-ci']);
// The kinds of move, from the end of the line back: close and CI, then the merge, then the verdict, then rework (what went
// back), then a new start; every other row after those.
const STAGE_ORDER = Object.freeze({ close: 0, ci: 0, merge: 1, review: 2, check: 2, changes: 3, worker: 3, takeover: 3, idle: 3, ready: 4, other: 5 });
// Every row of the loop, ordered as one display (never a schedule): the owner's rows first, then the rows idle past the threshold, then by how many issues each
// holds up directly, an item to ratify after a question (it blocks nothing), then by priority and number. A question of
// kind stop holds up the whole loop.
export function ballRows(root, flags = {}) {
  const loop = readLoop(jarlDir(root));
  const { profile } = loop;
  const awaiting = awaitingReview(loop, profile);
  // The owner lines of the issues in play that wait on nothing, read once for the issue rows and their own.
  const inPlay = loop.issues.filter((i) => inPlayForRows(profile, i) && !waitingOn(i, loop.byId, profile).length);
  const ownerStates = new Map(inPlay.map((i) => [i.id, ownerLineStates(root, loop, i)]).filter(([, s]) => s.length));
  // Each issue reserves its files against the issues of its own slice: across slices only leases hold.
  // The age of each lease, past the goal's liveness threshold or not, read once per issue (see leaseLiveness).
  const minutes = livenessOf(loop.goalLines, flags).minutes;
  const ages = new Map();
  const liveness = (i) => { if (!ages.has(i.id)) ages.set(i.id, leaseLiveness(root, i, minutes, { events: loop.eventsById.get(i.id) || [] })); return ages.get(i.id); };
  const ctx = { root, loop, profile, merger: loop.goalLines.merger === null ? JARL_HOLDER : holderOf(loop.goalLines.merger), next: nextRows(root, { perSlice: true }), awaiting, onOwner: new Set(heldByOwner(loop, awaiting)), ownerStates, liveness };
  const rows = ROW_SOURCES.flatMap((s) => s(ctx));
  // The holder of a row is who runs its command, so a write printed for it names that writer: all but a wait, held by an
  // outside person whose answer someone else records.
  for (const r of rows) if (typeof r.command === 'string' && r.holder && r.what !== 'wait') r.command = r.command.replaceAll('--by "<who>"', () => `--by ${printCommand([r.holder], { globals: [] })}`);
  // Who each issue holds up: the issues in play whose After names it, not settled yet, and for a question the issues it holds.
  const active = loop.issues.filter((i) => profile.active(i.status));
  const dependents = new Map();
  for (const i of active) for (const a of waitingOn(i, loop.byId, profile)) dependents.set(a, [...(dependents.get(a) || []), i.id]);
  // A question holds every issue it holds back: the one it names, and on a parent each issue under it. A parent that the
  // question names and that waits on its sub-issues is shown as held, but the answer does not free it, so it is not counted.
  const waitingParents = new Set(ctx.next.filter((x) => x.group === 'waiting-sub').map((x) => String(x.id)));
  const namedIssue = new Map(loop.asks.map((a) => [String(a.id), a.issue === null || a.issue === undefined ? null : String(a.issue)]));
  const heldByQuestion = new Map();
  for (const r of ctx.next.filter((x) => x.group === 'held-by-question')) for (const q of r.questions) {
    if (String(r.id) === namedIssue.get(String(q)) && waitingParents.has(String(r.id))) continue;
    heldByQuestion.set(q, [...(heldByQuestion.get(q) || []), r.id]);
  }
  const upOf = (ids) => [...new Set(ids.flatMap((id) => dependents.get(id) || []))];
  for (const r of rows) {
    if (r.ids) r.holdsUp = upOf(r.ids);
    else if (r.id !== undefined) r.holdsUp = dependents.get(r.id) || [];
    else if (r.what === 'question' || r.what === 'escalation') r.holdsUp = [...new Set([...(heldByQuestion.get(r.ask) || []), ...upOf(r.reviewing || [])])];
    else r.holdsUp = [];
  }
  const models = modelLines(root);
  for (const r of rows) {
    const raises = raisesOf(loop, models, r);
    if (raises.length) { r.raise = raises[0]; if (raises.length > 1) r.raises = raises; }
  }
  const weight = (r) => (r.what === 'question' && r.kind === 'stop' ? Number.MAX_SAFE_INTEGER : r.holdsUp.length);
  // A row idle past the threshold goes before the others of its holder: a worker that waits on a prompt or a lock writes
  // nothing, so the list is where it is seen, and it must not fall past the seven lines shown.
  // Among equals the end of the line comes first: what is nearest to landing frees the most, then what waits on a verdict,
  // then what went back, then a new start; anything else keeps the old order after them.
  const stage = (r) => STAGE_ORDER[r.what] ?? STAGE_ORDER.other;
  rows.sort((a, b) => (b.holder === OWNER_HOLDER) - (a.holder === OWNER_HOLDER) || Boolean(b.idle) - Boolean(a.idle) || weight(b) - weight(a)
    || stage(a) - stage(b)
    || (a.what === 'ratify') - (b.what === 'ratify')
    || String(a.priority ?? '9').localeCompare(String(b.priority ?? '9')) || cmpRef(a, b));
  return { loop, rows, waiting: waitingRows(loop, rows, ctx.next, ctx.onOwner) };
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
  const asksById = new Map(loop.asks.map((a) => [a.id, a]));
  // The holder of a question that holds an issue back: the jarl for an escalation, its director for a worker's stuck.
  const onHolder = (q) => { const a = asksById.get(q); return a.kind === 'escalation' ? JARL_HOLDER : askHolder(loop, a); };
  const questionHolder = (id) => { const holders = [...new Set(questionOf.get(id).map(onHolder))]; return holders.includes(OWNER_HOLDER) || !holders.length ? OWNER_HOLDER : holders[0]; };
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
// says so.
// The moment of work each kind of row stands at: what a rule with a moment selector is read against.
const MOMENT_OF = Object.freeze({ ready: 'start', worker: 'start', idle: 'start', 'no-line': 'filing', takeover: 'round', check: 'done', review: 'review', changes: 'round', merge: 'merge', ci: 'merge', close: 'done', 'sign-off': 'done' });
// Who asks, as a rule reads a reader: its roles, its slice, the moments of work its list stands at and the issues it works
// on. The jarl works on the issues in play in no slice and holds the filing and the close, and it is the coordinator of the
// issues in play in no slice as well; a coordinator on the issues in
// play of its slice, and files; a worker that holds a lease on its leased issues, at their start and, once a round sent
// one back, at its round; anyone else on the issues of its own list.
export function readerOf(loop, holder, mine) {
  const { profile } = loop;
  const inPlay = loop.issues.filter((i) => profile.active(i.status));
  const rowIds = new Set(mine.flatMap((r) => (r.ids ? r.ids : r.id !== undefined ? [r.id] : [])));
  const moments = new Set(mine.map((r) => MOMENT_OF[r.what]).filter(Boolean));
  const issues = (pick) => loop.issues.filter((i) => rowIds.has(i.id) || pick(i));
  // The jarl holds every lease and review of an issue in no slice, so it is the coordinator of those issues too: in a loop
  // with no slice, of every one; in a loop with slices, while an issue in play is in none.
  if (holder === JARL_HOLDER) return { roles: new Set(['jarl', ...(inPlay.some((i) => sliceOf(i) === null) || !loop.issues.some((i) => sliceOf(i) !== null) ? ['coordinator'] : [])]), slice: null, moments: new Set([...moments, 'filing', 'close']), issues: issues((i) => inPlay.includes(i) && sliceOf(i) === null) };
  if (loop.coordinators.some((c) => sameHolder(fieldText(c), holder))) return { roles: new Set(['coordinator']), slice: holder, moments: new Set([...moments, 'filing']), issues: issues((i) => inPlay.includes(i) && sameSlice(sliceOf(i), holder)) };
  const leased = loop.issues.filter((i) => profile.is(i.status, 'holds-claim') && sameHolder(fieldText(i.fields.worker) || '', holder));
  if (leased.length) return { roles: new Set(['worker']), slice: null, moments: new Set(['start', ...(leased.some((i) => sentBack(loop, i, inFlightMark(loop, i))) ? ['round'] : [])]), issues: leased };
  return { roles: new Set(), slice: null, moments, issues: issues(() => false) };
}

export function cmdNextAs(root, flags = {}) {
  const holder = holderOf(flags.as);
  const { loop, rows, waiting } = ballRows(root, flags);
  // With no coordinator named, an agent asking for its own name is shown a worker's moves on its work; and where it wrote its
  // own lease, a lone agent, the review of that work, which it cannot give and must get.
  const wroteLease = (id) => { const move = (loop.eventsById.get(id) || []).filter((e) => e.type === 'move' && loop.profile.is(e.to, 'holds-claim')).pop(); return Boolean(move?.writer) && sameHolder(move.writer, holder); };
  const onItsWork = (r) => sameHolder(r.doer ?? '', holder) || (r.issues || []).some((i) => sameHolder(i.doer ?? '', holder));
  const doesTheWork = (r) => loop.goalLines.coordinators.length === 0 && r.holder === JARL_HOLDER && holder !== JARL_HOLDER && holder !== OWNER_HOLDER && onItsWork(r) && (r.workersMove === true || (r.what === 'review' && (r.ids ?? [r.id]).every(wroteLease)));
  const held = rows.filter((r) => sameHolder(r.holder, holder));
  const mine = held.length ? held : rows.filter(doesTheWork);
  const rules = rulesFor(root, loop, readerOf(loop, holder, mine), today());
  const all = flags.all === true;
  const shown = all ? mine : mine.slice(0, BALL_SHOWN);
  const waits = waiting.filter((w) => sameHolder(w.on, holder));
  const coordinator = holder !== JARL_HOLDER && holder !== OWNER_HOLDER && loop.coordinators.some((c) => fieldText(c).toLowerCase() === holder.toLowerCase());
  const sliced = loop.issues.some((i) => sliceOf(i) !== null);
  const ownSlice = loop.issues.some((i) => sameSlice(sliceOf(i), holder));
  const note = !coordinator || ownSlice ? null : sliced ? `no issue carries slice:${holder}, so nothing of a slice is on ${holder}: the issues in no slice are the jarl's (${jarlLine('next', '--as', 'jarl')}), and ${jarlLine('field', '<ids>', 'Tags', '--add', `slice:${holder}`)} gives ${holder} its slice` : `with no slice in the loop, what a coordinator holds is the jarl's: ${jarlLine('next', '--as', 'jarl')}`;
  // A person is named as the record writes the name, whatever case the asker typed.
  const spelled = held.length ? held[0].holder : waits.length ? waits[0].on : holder;
  return {
    as: spelled, rows: shown, total: mine.length, more: mine.length - shown.length, rules,
    waiting: all ? waits : [], waitingTotal: waits.length,
    ...(note ? { note } : {}),
  };
}

export function renderNextAs(o) {
  // A line for several issues names each with its title and worker, where a line for one carries them in its head.
  const members = (r) => (r.issues ? ` (${r.issues.map((i) => `${i.id} ${short(i.title, MEMBER_TITLE)}${i.doer ? `, worker ${i.doer}` : ''}`).join('; ')})` : '');
  const line = (r) => `- ${refOf(r)}${r.what === 'ruling' || !r.title ? '' : ` ${short(r.title)}`}: ${r.says}${r.doer && r.what !== 'worker' && r.what !== 'idle' ? ` (worker ${r.doer})` : members(r)} — ${r.command}${r.holdsUp.length ? ` · holds up ${r.holdsUp.slice(0, 5).join(', ')}${r.holdsUp.length > 5 ? ` and ${r.holdsUp.length - 5} more` : ''}` : ''}`;
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
  if (o.rules.length) out.push('', `Rules for ${holderWord(o.as)} (${o.rules.length})`, ...o.rules.flatMap(ruleLines));
  return out.join('\n');
}

// The asker's list at the end of status --as and resume --as: what next --as prints, under its own heading.
export function askerSection(root, as, flags = {}) {
  const o = cmdNextAs(root, { as, ...(flags['stale-hours'] !== undefined ? { 'stale-hours': flags['stale-hours'] } : {}) });
  return { as: o, text: `## ${renderNextAs(o)}` };
}
