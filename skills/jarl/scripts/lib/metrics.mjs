// The check a loop lands on, and the loop's metrics (report --json).

import { fieldText, jarlLine } from './base.mjs';
import { jarlDir } from './where.mjs';
import { cmpId, idsNamed } from './ids.mjs';
import { goalLines, readGoal } from './journal.mjs';
import { mergedOf } from './issues.mjs';
import { repoNames } from './repositories.mjs';
import { approveKind, carriesCode, gateOf } from './gate.mjs';
import { readLoop } from './loop.mjs';

// ---- the check a loop lands on, and the loop's metrics (report --json) ----------------------------------------------

// The check a loop declares: every `Check: <what runs>` line of the goal is the command of the whole loop; a
// `Check (<name>): <what runs>` line is the command of the repository <name>, written as its Files prefix writes it
// (see goalLines). Jarl never runs it: the line says what the check is, and the merge lines say whether a landing passed
// it. Where the repository has a check, the check decides what lands; a review can only stop a change and is recorded
// as testimony.
export function declaredChecksByRepo(root) { return goalLines(readGoal(jarlDir(root))).checksByRepo; }
// Every command the goal names, bare lines first.
export function declaredChecks(root) { return goalLines(readGoal(jarlDir(root))).checks; }

// The commands a repository's checks are: its own `Check (<name>)` lines, else the loop's `Check:` lines.
export function declaredFor(loop, name) {
  const d = loop.goalLines.checksByRepo;
  return d.repos[name] && d.repos[name].length ? d.repos[name] : d.bare;
}

// The last merge an issue's events record, or null.
function lastMerge(events) {
  let line = null;
  for (const e of events) if (e.type === 'merged') line = e;
  return line;
}

// What the merges say about the check, from the log: every merged issue counts once, by its last merge line, as landed
// on the declared check (its --ran text equals a command the repository's Check lines declare, after trimming), on red
// (with the issue that tracks the cause), or on neither (no check, or a check that is not the declared one). Per
// repository, an issue naming several counts in each. A repository's declared check is its own `Check (<repo>)` lines,
// else the loop's `Check:` lines. A repository lands on its check (`check`) when every merge carries it, on
// testimony (`testimony`) when none does or none is declared, and is `partial` between: k is the merges carrying the
// declared check, n all its merges.
export function checkState(loop) {
  const { root, issues } = loop;
  const declared = loop.goalLines.checksByRepo;
  const checks = loop.goalLines.checks;
  const byRepo = {};
  const repo = (name) => (byRepo[name] = byRepo[name] || { repo: name, merges: 0, withCheck: 0, noCheck: 0, red: [], declared: declaredFor(loop, name), landsOn: 'testimony' });
  for (const name of Object.keys(declared.repos)) repo(name);
  const total = { merges: 0, withCheck: 0, noCheck: 0, red: [] };
  for (const i of issues) {
    // A merge on work that was dropped or deferred is no landing of the loop's work: closedGateFlags names it instead.
    if (loop.profile.is(i.status, 'terminal') && !loop.profile.is(i.status, 'closes-record')) continue;
    const line = lastMerge(loop.eventsById.get(i.id) || []);
    if (!line && !mergedOf(i)) continue;
    const names = repoNames(root, i);
    const kindIn = (name) => (line && line.red ? 'red' : carriesDeclared(line, repo(name).declared) ? 'withCheck' : 'noCheck');
    for (const name of names) {
      const r = repo(name);
      r.merges += 1;
      if (kindIn(name) === 'red') r.red.push({ id: i.id, cause: line.red }); else r[kindIn(name)] += 1;
    }
    const kind = line && line.red ? 'red' : names.some((n) => kindIn(n) === 'withCheck') ? 'withCheck' : 'noCheck';
    total.merges += 1;
    if (kind === 'red') total.red.push({ id: i.id, cause: line.red }); else total[kind] += 1;
  }
  const lands = (t) => (t.merges > 0 && t.withCheck === t.merges ? 'check' : t.withCheck === 0 ? 'testimony' : 'partial');
  for (const r of Object.values(byRepo)) { r.landsOn = lands(r); r.k = r.withCheck; r.n = r.merges; }
  return { declared: checks.length > 0, checks, landsOn: lands(total), merges: total, byRepo: Object.fromEntries(Object.keys(byRepo).sort().map((k) => [k, byRepo[k]])) };
}
// Whether a merge line's check text names one of the declared commands: the text is the --ran commands of the call
// joined by " ; " (see cmdMerged), compared with each declared command after trimming.
export function carriesDeclared(line, commands) {
  if (!line || !line.check || !commands.length) return false;
  const norm = (s) => fieldText(s).replace(/ +· +/g, ' - ').slice(0, 200);
  const wanted = commands.map(norm);
  return line.check.split(' ; ').some((part) => wanted.includes(part.trim()));
}
// The testimony mark a goal gets: while no merge carries a declared check the merges are testimony whatever they record, and
// the mark says so, with the form of the merge that carries one. A goal that names no Check line at all gets the undeclared
// mark, else the declared one.
const testimonyNote = (c) => {
  const merge = jarlLine('merged', '<ids>', '--sha', '<sha>', '--ran', '<command>', '--saw', '<what-it-printed>');
  return c.declared
    ? `no merge carries the declared check — this loop lands on testimony alone: a review is recorded as testimony, not proof (a merge carries the check when its --ran text equals a command a Check line of the goal declares: ${merge})`
    : `no check is declared — this loop lands its merges on testimony alone: a review is recorded as testimony, not proof (a Check line of the goal declares the command a merge must carry: ${merge})`;
};
// The landing banner: the testimony mark while no merge carries the declared check, then one line per repository, the count
// of its merges that carry the declared check, or the mark that it declares none.
export function checkLines(c) {
  const lines = c.landsOn === 'testimony' ? [testimonyNote(c)] : [];
  for (const [name, r] of Object.entries(c.byRepo)) {
    if (!r.merges && !r.declared.length) continue;
    lines.push(r.declared.length ? `check ${name}: ${r.k} of ${r.n} merges carry the declared check · declared ${r.declared.join(' · ')}` : `check ${name}: no check declared — ${r.n} merge(s) land on testimony alone`);
  }
  return lines;
}
// One line per repository: its merges by what they carry, the red ones with their cause.
export function mergeCheckLines(c) {
  const names = Object.keys(c.byRepo).filter((n) => c.byRepo[n].merges || c.byRepo[n].declared.length);
  if (!names.length) return [];
  const width = Math.max(...names.map((n) => n.length));
  return names.map((n) => {
    const r = c.byRepo[n];
    return `  ${n.padEnd(width)}  ${r.merges} merge(s) · with the declared check ${r.withCheck} · without it ${r.noCheck} · landed on red ${r.red.length}${r.red.length ? ` (${r.red.map((x) => `${x.id}, cause ${x.cause}`).join('; ')})` : ''}${r.declared.length ? ` · declared ${r.declared.join(' · ')}` : ''}`;
  });
}

// A journal stamp (YYYY-MM-DD HH:MM, UTC) in milliseconds.
function stampMs(at) { return Date.parse(`${at.replace(' ', 'T')}:00Z`); }
const HOUR = 3600000;
const DAY = 24 * HOUR;
const round1 = (x) => Math.round(x * 10) / 10;
const share = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 1000 : null);
const pct = (s) => `${round1(s * 100)}%`;
function spread(values) {
  if (!values.length) return { n: 0, medianHours: null, p90Hours: null, maxHours: null };
  const v = [...values].sort((a, b) => a - b);
  const at = (q) => v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)];
  const mid = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  return { n: v.length, medianHours: round1(mid / HOUR), p90Hours: round1(at(0.9) / HOUR), maxHours: round1(v[v.length - 1] / HOUR) };
}

// The loop's metrics, read from its record alone — the journal and the issue files — never from git or a network. Each
// metric carries n (how many issues it was read from) and, where the record holds nothing to read it from, noData with
// the reason and null values instead of a zero: an approve logged without --by has no kind, a loop with no merge
// has no CI after a merge, and a zero there would claim something the record never said.
//
// - cycleTime: first move into a status that holds the claim (in progress) → last move into one that closes the record
//   (done), per closed issue; leadTime the same from its filing. Hours, median, p90, max.
// - rounds: `round` lines and `changes` verdicts per closed issue the journal tracks.
// - reopenings: moves out of a status that closes the record (done back to open or in progress), on any issue the
//   journal tracks; deferred or dropped work brought back is not a reopening — nothing was closed as finished.
// - freshReviews: the kind of the live approve that cleared each closed issue (see gateState), its share among those
//   with a recorded kind, the same for closed issues carrying code, and who the fresh reviewers were.
// - redCiAfterMerge: issues whose CI was recorded red at any point after their merge, among merges whose CI settled
//   (green or red); pending and none (no CI to wait for) are counted apart.
// - followUps: issues filed within 7 days after a closed issue first closed whose Found by names its number. A closed
//   research issue is left out: the issues filed from its findings are what it was for, not defects it left behind.
export const FOLLOW_UP_DAYS = 7;
// When each issue was filed and when it first moved into a status that closes the record, by issue, from its events.
function filedAndClosed(issues, journal, profile) {
  const filed = new Map();
  const firstClose = new Map();
  for (const i of issues) {
    for (const e of journal.get(i.id) || []) {
      if (e.type === 'filed' && !filed.has(i.id)) filed.set(i.id, e.at);
      if (e.type === 'move' && profile.is(e.to, 'closes-record') && !firstClose.has(i.id)) firstClose.set(i.id, e.at);
    }
  }
  return { filed, firstClose };
}
// The follow-up rule, once: the issues filed within FOLLOW_UP_DAYS after another issue first closed, whose Found by
// names it, by the issue they follow. An issue follows only a closed issue that has its close in the journal, and not a
// research one: the issues filed from a research issue's findings are what it was for, not defects it left behind.
function followUpsOf(issues, filed, firstClose, profile) {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const followable = (i) => i.kind !== 'research' && firstClose.has(i.id);
  const found = new Map();
  for (const y of issues) {
    if (!filed.has(y.id)) continue;
    for (const x of new Set(idsNamed(y.fields['found by'], byId))) {
      if (x === y.id || !byId.has(x) || !followable(byId.get(x)) || !profile.is(byId.get(x).status, 'closes-record')) continue;
      const gap = stampMs(filed.get(y.id)) - stampMs(firstClose.get(x));
      if (gap >= 0 && gap <= FOLLOW_UP_DAYS * DAY) found.set(x, [...(found.get(x) || []), y.id]);
    }
  }
  return found;
}
// loopMetrics reads the loop for one call, at `now` (its fourth argument); metricsOf takes a loop already read.
export function loopMetrics(root, issues, events, now) { return metricsOf(readLoop(jarlDir(root)), now ?? Date.now()); }
export function metricsOf(loop, now) {
  const { profile, issues } = loop;
  const journal = loop.eventsById;
  const closes = (st) => profile.is(st, 'closes-record');
  const claims = (st) => profile.is(st, 'holds-claim');
  const { filed: filedAt, firstClose: firstCloseAt } = filedAndClosed(issues, journal, profile);
  // One pass over each issue's journal: the moves, rounds, changes, merges and CI states.
  const facts = new Map();
  for (const i of issues) {
    const f = { filed: filedAt.get(i.id) || null, firstClaim: null, firstClose: firstCloseAt.get(i.id) || null, lastClose: null, rounds: 0, changes: 0, reopens: 0, merged: false, ci: [], tracked: false };
    for (const e of journal.get(i.id) || []) {
      if (e.type === 'filed') { f.tracked = true; continue; }
      if (e.type === 'move') {
        const prev = e.from; const status = e.to; f.tracked = true;
        if (claims(status) && !f.firstClaim) f.firstClaim = e.at;
        if (closes(status)) f.lastClose = e.at;
        if (prev && closes(prev) && !closes(status)) f.reopens += 1;
        continue;
      }
      if (e.type === 'round') { f.rounds += 1; continue; }
      if (e.type === 'verdict' && e.verdict === 'changes') { f.changes += 1; continue; }
      if (e.type === 'merged') { f.merged = true; if (e.ci) f.ci.push(e.ci); continue; }
      if (e.type === 'ci' && f.merged) f.ci.push(e.state);
    }
    // A merge recorded on the issue with no journal line for it (a hand-made file): its CI field as the one reading.
    if (!f.merged && mergedOf(i)) { f.merged = true; if (mergedOf(i).ci) f.ci.push(mergedOf(i).ci); }
    facts.set(i.id, f);
  }
  const closed = issues.filter((i) => closes(i.status));
  const noData = (cond, why) => (cond ? why : null);

  const cycle = closed.map((i) => facts.get(i.id)).filter((f) => f.firstClaim && f.lastClose && stampMs(f.lastClose) >= stampMs(f.firstClaim)).map((f) => stampMs(f.lastClose) - stampMs(f.firstClaim));
  const cycleTime = { ...spread(cycle), of: closed.length, noData: noData(!cycle.length, closed.length ? 'no closed issue has a move into progress and a later close in the journal' : 'nothing closed yet') };
  const lead = closed.map((i) => facts.get(i.id)).filter((f) => f.filed && f.lastClose).map((f) => stampMs(f.lastClose) - stampMs(f.filed));
  const leadTime = { ...spread(lead), of: closed.length, noData: noData(!lead.length, closed.length ? 'no closed issue has its filing and its close in the journal' : 'nothing closed yet') };

  const trackedClosed = closed.filter((i) => facts.get(i.id).tracked);
  const withRounds = trackedClosed.filter((i) => facts.get(i.id).rounds);
  const withChanges = trackedClosed.filter((i) => facts.get(i.id).changes);
  const rounds = {
    n: trackedClosed.length,
    rounds: trackedClosed.length ? withRounds.reduce((s, i) => s + facts.get(i.id).rounds, 0) : null,
    issuesWithRounds: trackedClosed.length ? withRounds.map((i) => i.id) : null,
    changes: trackedClosed.length ? withChanges.reduce((s, i) => s + facts.get(i.id).changes, 0) : null,
    issuesWithChanges: trackedClosed.length ? withChanges.map((i) => i.id) : null,
    noData: noData(!trackedClosed.length, closed.length ? 'the journal tracks no closed issue' : 'nothing closed yet'),
  };

  const tracked = issues.filter((i) => facts.get(i.id).tracked);
  const reopened = tracked.filter((i) => facts.get(i.id).reopens);
  const reopenings = { n: tracked.length, times: tracked.length ? reopened.reduce((s, i) => s + facts.get(i.id).reopens, 0) : null, issues: tracked.length ? reopened.map((i) => i.id) : null, noData: noData(!tracked.length, 'the journal tracks no issue') };

  // A relayed fresh approve and a bot's are counted apart from the fresh ones.
  const kinds = { fresh: 0, coordinator: 0, self: 0, relayed: 0, bot: 0, unrecorded: 0 };
  const code = { fresh: 0, coordinator: 0, self: 0, relayed: 0, bot: 0, unrecorded: 0 };
  const reviewers = {};
  for (const i of closed) {
    const g = gateOf(loop, i.id);
    const k = approveKind(g);
    kinds[k] = (kinds[k] || 0) + 1;
    if (carriesCode(i)) code[k] = (code[k] || 0) + 1;
    if (k === 'fresh') reviewers[g.live.by] = (reviewers[g.live.by] || 0) + 1;
  }
  const recorded = kinds.fresh + kinds.coordinator + kinds.self + kinds.relayed + kinds.bot;
  const codeRecorded = code.fresh + code.coordinator + code.self + code.relayed + code.bot;
  const freshReviews = {
    n: closed.length, recorded, ...kinds, share: share(kinds.fresh, recorded),
    code: { n: codeRecorded + code.unrecorded + (code.retracted || 0), recorded: codeRecorded, ...code, share: share(code.fresh, codeRecorded) },
    reviewers: Object.fromEntries(Object.entries(reviewers).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    noData: noData(!recorded, closed.length ? `no closed issue's approve records who gave it (${kinds.unrecorded} from before --by)` : 'nothing closed yet'),
  };

  const mergedIssues = issues.filter((i) => facts.get(i.id).merged);
  const red = mergedIssues.filter((i) => facts.get(i.id).ci.includes('red'));
  const settled = mergedIssues.filter((i) => facts.get(i.id).ci.some((c) => c === 'green' || c === 'red'));
  const lastCi = (i) => facts.get(i.id).ci[facts.get(i.id).ci.length - 1] || null;
  const redCiAfterMerge = {
    n: mergedIssues.length, settled: settled.length, red: settled.length ? red.length : null, issues: settled.length ? red.map((i) => i.id) : null, share: share(red.length, settled.length),
    pending: mergedIssues.filter((i) => lastCi(i) === 'pending').map((i) => i.id), none: mergedIssues.filter((i) => lastCi(i) === 'none').map((i) => i.id),
    noData: noData(!settled.length, mergedIssues.length ? 'no merge has a CI recorded green or red yet' : 'no merge recorded'),
  };

  // Follow-ups: the closed issues that have a close time in the journal, and every issue filed within the window after
  // it that names its number in Found by. The window of a close less than 7 days ago is still open: counted apart.
  const anyFoundBy = issues.some((i) => fieldText(i.fields['found by']));
  const closedAt = closed.filter((i) => i.kind !== 'research' && facts.get(i.id).firstClose);
  const found = followUpsOf(issues, filedAt, firstCloseAt, profile);
  // The share is taken over the closes whose window has passed: a close from yesterday with no follow-up yet has not
  // shown it has none, so counting it would pull the share toward a zero the record cannot back.
  const windowClosed = closedAt.filter((i) => now - stampMs(facts.get(i.id).firstClose) >= FOLLOW_UP_DAYS * DAY);
  const windowClosedWith = windowClosed.filter((i) => found.has(i.id)).length;
  const followUps = {
    windowDays: FOLLOW_UP_DAYS, n: closedAt.length, windowOpen: closedAt.length - windowClosed.length,
    withFollowUps: anyFoundBy && closedAt.length ? found.size : null,
    windowClosed: windowClosed.length, windowClosedWithFollowUps: anyFoundBy && windowClosed.length ? windowClosedWith : null,
    share: anyFoundBy ? share(windowClosedWith, windowClosed.length) : null,
    followUps: anyFoundBy ? [...found.keys()].sort(cmpId).map((id) => ({ id, followUps: found.get(id) })) : null,
    noData: noData(!anyFoundBy || !closedAt.length, !anyFoundBy ? 'no issue records Found by, so no follow-up can be traced to what it follows' : closed.length ? 'no closed issue outside research has its close in the journal' : 'nothing closed yet'),
  };

  return { check: checkState(loop), cycleTime, leadTime, rounds, reopenings, freshReviews, redCiAfterMerge, followUps, slips: slipsOf(loop), batches: batchesOf(loop), ...artifactsOf(loop) };
}

// The verdicts that name the artifact they judged (review --artifact), as { n, approve, changes, issues }: how many, of
// each verdict, and the issues they are on, in the order of the log. Only a loop that holds one carries the key.
function artifactsOf(loop) {
  const named = loop.events.filter((e) => e.type === 'verdict' && e.artifact && e.id !== null && loop.byId.has(e.id));
  if (!named.length) return {};
  return { artifacts: { n: named.length, approve: named.filter((e) => e.verdict === 'approve').length, changes: named.filter((e) => e.verdict === 'changes').length, issues: [...new Set(named.map((e) => e.id))] } };
}

// The batched reviews: each verdict given on several issues at once, by the batch id its lines carry, in the order of the
// log, as { id, verdict, by, at, issues, size, rounds }: the issues it covered, how many, and the red rounds recorded on
// them after it.
function batchesOf(loop) {
  const byBatch = new Map();
  for (const e of loop.events) {
    if (e.type !== 'verdict' || !e.batch || e.id === null || !loop.byId.has(e.id)) continue;
    if (!byBatch.has(e.batch)) byBatch.set(e.batch, { id: e.batch, verdict: e.verdict, by: e.by, at: e.at, lines: [] });
    byBatch.get(e.batch).lines.push(e);
  }
  const batches = [...byBatch.values()].map(({ lines, ...b }) => {
    const issues = [...new Set(lines.map((e) => e.id))];
    const rounds = lines.reduce((s, line) => s + (loop.eventsById.get(line.id) || []).filter((e) => e.type === 'round' && e.n > line.n).length, 0);
    return { ...b, issues, size: issues.length, rounds };
  });
  return { n: batches.length, batches };
}
// The batched reviews as report prints them: the first few with their issues, size, verdict and the rounds after each.
const BATCHES_SHOWN = 8;
function batchesLine(b) {
  const over = new Set(b.batches.flatMap((x) => x.issues)).size;
  const shown = b.batches.slice(0, BATCHES_SHOWN).map((x) => `${x.issues.join(', ')} (${x.size}, ${x.verdict}${x.by ? ` by ${x.by}` : ''}): ${x.rounds} round${x.rounds === 1 ? '' : 's'} after it`);
  return `batched reviews: ${b.n} batch${b.n === 1 ? '' : 'es'} over ${over} issue${over === 1 ? '' : 's'} · ${shown.join('; ')}${b.n > BATCHES_SHOWN ? `; and ${b.n - BATCHES_SHOWN} more` : ''}`;
}

// The slips a coordinator records against its own work, per writer: the reopens after done (moves out of a status that
// closes the record) and the retractions (of a row, a note or an approve). The writer is the name the line carries, the --by of the call that wrote it
// (a retraction's own `by`, and a description change's author, which their lines hold); null when the call named nobody. A
// refused call writes no line, so it is never counted. Each list is [{ writer, coordinator, count, issues }], the issues
// in the order of the log, an issue once per line; coordinator says whether the name reviews as the loop's director.
function slipsOf(loop) {
  const closes = (st) => loop.profile.is(st, 'closes-record');
  const directors = new Set(loop.coordinators.map((c) => fieldText(c).toLowerCase()));
  const reopens = new Map();
  const retractions = new Map();
  const add = (map, writer, id) => {
    const key = writer === null ? null : fieldText(writer);
    if (!map.has(key)) map.set(key, { writer: key, coordinator: key !== null && directors.has(key.toLowerCase()), count: 0, issues: [] });
    const entry = map.get(key);
    entry.count += 1;
    entry.issues.push(id);
  };
  for (const e of loop.events) {
    if (e.id === null || !loop.byId.has(e.id)) continue;
    if (e.type === 'move' && e.from && closes(e.from) && !closes(e.to)) add(reopens, e.writer, e.id);
    else if (e.type === 'retract-row' || e.type === 'retract-note' || e.type === 'retract-review') add(retractions, e.writer ?? e.by ?? null, e.id);
  }
  // Named writers by name, the unnamed last.
  const order = (map) => [...map.values()].sort((a, b) => (a.writer === null) - (b.writer === null) || String(a.writer).localeCompare(String(b.writer)));
  return { reopens: order(reopens), retractions: order(retractions) };
}
// One line per kind of slip: each writer with its count and the issues, a writer that is no coordinator marked.
function slipLine(label, list) {
  return `${label}, per writer: ${list.length ? list.map((x) => `${x.writer ?? 'unnamed'} ${x.count} (${x.issues.join(', ')})${x.writer !== null && !x.coordinator ? ', not a coordinator' : ''}`).join(' · ') : 'none'}`;
}

export function renderMetrics(m) {
  const nd = (x) => `no data (${x.noData})`;
  const time = (x) => (x.noData ? nd(x) : `median ${x.medianHours} h · p90 ${x.p90Hours} h · max ${x.maxHours} h · n ${x.n} of ${x.of} closed`);
  const list = (ids) => (ids.length ? `: ${ids.join(', ')}` : '');
  const f = m.freshReviews;
  return [
    '## Loop metrics',
    ...checkLines(m.check),
    ...(m.check.merges.merges ? ['merges by repository:', ...mergeCheckLines(m.check)] : []),
    `cycle time (in progress → closed): ${time(m.cycleTime)}`,
    `lead time (filed → closed): ${time(m.leadTime)}`,
    `rounds: ${m.rounds.noData ? nd(m.rounds) : `${m.rounds.rounds} on ${m.rounds.issuesWithRounds.length} issue(s) · changes verdicts ${m.rounds.changes} on ${m.rounds.issuesWithChanges.length} issue(s) · n ${m.rounds.n} closed`}`,
    `reopened: ${m.reopenings.noData ? nd(m.reopenings) : `${m.reopenings.issues.length} issue(s), ${m.reopenings.times} time(s)${list(m.reopenings.issues)} · n ${m.reopenings.n}`}`,
    slipLine('reopened after done', m.slips.reopens),
    slipLine('retracted', m.slips.retractions),
    `fresh reviews of closed work: ${f.noData ? nd(f) : `${f.fresh} of ${f.recorded} with a recorded reviewer (${pct(f.share)}) · coordinator ${f.coordinator} · self ${f.self}${f.relayed || f.bot ? ` · relayed ${f.relayed} · bot ${f.bot}` : ''}${f.retracted ? ` · retracted ${f.retracted}` : ''}${f.unrecorded ? ` · no data for ${f.unrecorded} (approved before --by)` : ''}${f.code.recorded ? ` · carrying code: ${f.code.fresh} of ${f.code.recorded} (${pct(f.code.share)})` : ''}`}`,
    ...(Object.keys(f.reviewers).length ? [`fresh reviewers: ${Object.keys(f.reviewers).length}${Object.keys(f.reviewers).length > 5 ? ', most often' : ''} ${Object.entries(f.reviewers).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(' · ')}`] : []),
    ...(m.batches && m.batches.n ? [batchesLine(m.batches)] : []),
    ...(m.artifacts ? [`verdicts that name an artifact: ${m.artifacts.n} (approve ${m.artifacts.approve}, changes ${m.artifacts.changes}) on ${m.artifacts.issues.length} issue${m.artifacts.issues.length === 1 ? '' : 's'}: ${m.artifacts.issues.join(', ')}`] : []),
    `red CI after merge: ${m.redCiAfterMerge.noData ? nd(m.redCiAfterMerge) : `${m.redCiAfterMerge.red} of ${m.redCiAfterMerge.settled} settled (${pct(m.redCiAfterMerge.share)})${list(m.redCiAfterMerge.issues)}`}${m.redCiAfterMerge.pending.length ? ` · pending ${m.redCiAfterMerge.pending.length}` : ''}${m.redCiAfterMerge.none.length ? ` · no CI ${m.redCiAfterMerge.none.length}` : ''}`,
    `follow-ups within ${m.followUps.windowDays} days (Found by names the closed issue): ${m.followUps.noData ? nd(m.followUps) : `${m.followUps.withFollowUps} of ${m.followUps.n} closed${m.followUps.followUps.length ? `: ${m.followUps.followUps.map((x) => `${x.id} ← ${x.followUps.join(', ')}`).join('; ')}` : ''} · ${m.followUps.windowClosed ? `share ${m.followUps.windowClosedWithFollowUps} of ${m.followUps.windowClosed} whose ${m.followUps.windowDays} days have passed (${pct(m.followUps.share)})` : `share: no data (no close is ${m.followUps.windowDays} days old yet)`}${m.followUps.windowOpen ? ` · window still open for ${m.followUps.windowOpen}` : ''}`}`,
  ].join('\n');
}

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { filedAndClosed, followUpsOf, lastMerge, share, testimonyNote };

// The merges that carry no check and no red cause: an issue not yet closed whose last merge line names neither, so the
// merge was recorded before its check finished. Each is { id, sha, repo } with the sha as recorded; the merge is
// unfinished, and nobody reads it as landed, until the check or the red cause is recorded on the same commit.
export function checkWaiting(loop, issues = loop.issues) {
  const out = [];
  for (const i of issues) {
    if (loop.profile.is(i.status, 'terminal')) continue;
    const line = lastMerge(loop.eventsById.get(i.id) || []);
    if (line && !line.check && !line.red) out.push({ id: i.id, sha: line.sha, ...(line.repo ? { repo: line.repo } : {}) });
  }
  return out;
}
// The issues closed while their last merge carried no check and no red cause: closing clears the waiting-for-check mark, so
// this is where it shows that the merge was never given one. Each is { id, sha, repo } as checkWaiting gives it.
export function closedNoCheck(loop, issues = loop.issues) {
  const out = [];
  for (const i of issues) {
    if (!loop.profile.is(i.status, 'closes-record')) continue;
    const line = lastMerge(loop.eventsById.get(i.id) || []);
    if (line && !line.check && !line.red) out.push({ id: i.id, sha: line.sha, ...(line.repo ? { repo: line.repo } : {}) });
  }
  return out;
}
// What status says of them: the first few issues, in one line with the count of the rest (the JSON holds them all), and
// the command that records a check after the fact.
const CLOSED_NO_CHECK_SHOWN = 8;
export function closedNoCheckText(list) {
  const shown = list.slice(0, CLOSED_NO_CHECK_SHOWN).map((w) => `${w.id} (${w.sha}${w.repo ? ` in ${w.repo}` : ''})`).join(', ');
  const more = list.length > CLOSED_NO_CHECK_SHOWN ? `, and ${list.length - CLOSED_NO_CHECK_SHOWN} more` : '';
  return `closed with no check recorded on the merge: ${shown}${more} — if its check ran, record it: ${jarlLine('merged', '<id>', '--sha', '<sha>', '--ran', '<command>', '--saw', '<what-it-printed>')}`;
}
// What status, resume and show say of one such merge, with the command that records the check.
export function checkWaitingText(w) {
  return `merged, waiting for its check: ${w.id} (${w.sha}${w.repo ? ` in ${w.repo}` : ''}) — the merge is not finished until its check is recorded: ${jarlLine('merged', w.id, '--sha', w.sha, ...(w.repo ? ['--repo', w.repo] : []), '--ran', '<command>', '--saw', '<what-it-printed>')} (or --red "<id>" when it landed on a red check outside the branch)`;
}
