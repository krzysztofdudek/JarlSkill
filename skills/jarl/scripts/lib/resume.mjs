// Resume: the state a session picks the loop up from, assembled live; the handoff file and the report.

import { existsSync } from 'node:fs';
import { fieldText, need } from './base.mjs';
import { jarlDir } from './where.mjs';
import { readText } from './files.mjs';
import { DEFAULT_PROFILE, loadProfile } from './profile.mjs';
import { mergedOf, sharedMark } from './issues.mjs';
import { repoNames } from './repositories.mjs';
import { closedGateLine, disagreementText, gateLine, gateOf, readLoop, reviewSplit, sameSlice, sliceNamed, sliceOf } from './loop.mjs';
import { checkWaitingText, metricsOf, renderMetrics, testimonyNote } from './metrics.mjs';
import { ago } from './rounds.mjs';
import { cmdTips, renderTips } from './tips.mjs';
import { reasonWord, waitingOn } from './commands.mjs';
import { handoffAge, handoffPath } from './questions.mjs';
import { answeredLines } from './journal.mjs';
import { IN_FLIGHT_MARKS, closedGateFlags, leaseWriter, leasedByText, modelText, nextRows, schedulerNote, statusOf, uncommittedLoopFiles } from './evidence.mjs';
import { cmdQueue, renderQueue } from './queue.mjs';
import { countsLine } from './import.mjs';

// ---- resume: the state a session picks the loop up from, assembled live -------------------------------

export const RESUME_LOG_LINES = 15;
export const RESUME_READY = 10;
const RESUME_TITLE = 160;
const short = (t, n = RESUME_TITLE) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
function countFlag(flags, name, dflt) {
  if (flags[name] === undefined) return dflt;
  const n = Number(flags[name]);
  need(Number.isInteger(n) && n >= 0, `--${name} takes a whole number, 0 or more (got "${flags[name]}")`);
  return n;
}

// resume [--log n] [--ready n] [--ci] — read-only, no lock: the goal and where the loop stands (status), the
// rulings in force, in flight with leases, waiting on After, the questions and the ratify items, the next ready
// issues and the merge queue, the merges whose CI is pending or red, the tips of every repository the loop's
// issues name, the loop files git has not committed, and the last n log lines. Nothing goes to the network
// unless --ci asks gh for the CI of each pushed tip.
export function cmdResume(root, flags = {}) {
  need(existsSync(jarlDir(root)), `no loop here: ${jarlDir(root)} does not exist — open one with jarl.mjs init "<goal>", or pass --root <the directory holding .jarl/>`);
  const logN = countFlag(flags, 'log', RESUME_LOG_LINES);
  const readyN = countFlag(flags, 'ready', RESUME_READY);
  const loop = readLoop(jarlDir(root));
  // --slice: in flight, waiting, held, the questions and the next ready are the slice's own, as status --slice counts
  // them; the rulings, the merge queue, the tips and the log stay the loop's, which every slice shares.
  const slice = flags.slice === undefined ? null : sliceNamed(loop.goalLines.coordinators, loop.issues, flags.slice);
  const status = statusOf(root, loop, slice === null ? {} : { slice });
  const { profile, byId } = loop;
  const issues = slice === null ? loop.issues : loop.issues.filter((i) => sameSlice(sliceOf(i), slice));
  const inScope = new Set(issues.map((i) => i.id));
  const stale = new Map(status.stale.map((x) => [x.id, x.problems]));
  const marks = new Map(status.inFlightRows.map((x) => [x.id, x.mark]));
  // An answered question's ruling also carries its answer line, which the text lists before the question.
  const rulings = loop.decisions.filter((d) => !d.supersededBy).map((d) => {
    const answered = answeredLines(d);
    return { date: d.date, slug: d.slug, by: d.by, under: d.under, line: (d.ruling.split('\n').find((l) => l.trim()) || '').trim(), ...(answered ? { answer: answered.answer } : {}) };
  });
  // In flight and waiting split the unfinished issues the way status counts them: an issue whose After is not
  // settled is waiting, in progress or not, so each section's count is the number on the counts line.
  const unsettled = (i) => waitingOn(i, byId, profile).length > 0;
  const holds = (i) => profile.is(i.status, 'holds-claim');
  // Under a profile that declares fields, each row carries the ones the issue holds (fields: { Name: value }).
  const declared = (i) => (profile.fields.length ? { fields: Object.fromEntries(profile.fields.map((f) => [f.name, fieldText(i.fields[f.key])]).filter(([, v]) => v)) } : {});
  const inFlight = issues.filter((i) => holds(i) && !unsettled(i)).map((i) => ({
    id: i.id, title: i.title, branch: i.fields.branch || null, worker: i.fields.worker || null, model: i.fields.model || null, since: i.fields.since || null,
    ...leaseWriter(loop, i), stale: stale.get(i.id) || [], mark: marks.get(i.id), ...declared(i),
  }));
  const waiting = issues.filter((i) => profile.active(i.status) && unsettled(i)).map((i) => ({
    id: i.id, title: i.title, status: i.status, after: waitingOn(i, byId, profile),
    ...(holds(i) ? { branch: i.fields.branch || null, worker: i.fields.worker || null, model: i.fields.model || null, since: i.fields.since || null, stale: stale.get(i.id) || [] } : {}),
  }));
  const asks = loop.asks.filter((a) => a.state === 'open' && (slice === null || (a.issue && inScope.has(a.issue)) || sameSlice(a.slice ?? null, slice)));
  const scheduled = profile.scheduler !== null;
  const next = scheduled ? [] : nextRows(root, slice === null ? {} : { slice });
  const ready = next.filter((r) => r.ready);
  // Open, not waiting on After, and still not offered: a file it declares is taken by work in flight (or by a ready
  // issue ahead of it), or an open question names it. Ready and held together are the open count on the status line.
  const held = next.filter((r) => !r.ready && !r.after.length).map((r) => ({ id: r.id, title: r.title, priority: r.priority, files: r.waitsOn, heldBy: r.heldBy || [], ...(r.questions ? { questions: r.questions } : {}), ...(r.resources ? { resources: r.resources } : {}) }));
  const merged = issues.filter((i) => status.ciPending.includes(i.id) || status.ciRed.includes(i.id)).map((i) => ({ id: i.id, title: i.title, ...mergedOf(i) }));
  const logLines = loop.events;
  const kept = handoffAge(root, status.lastActivity);
  return {
    goal: status.goal, opened: status.opened, lastActivity: status.lastActivity, archived: status.archived, status, ...(slice !== null ? { slice } : {}),
    rulings, inFlight, waiting,
    questions: asks.filter((a) => a.kind !== 'ratify' && a.kind !== 'escalation'), escalations: asks.filter((a) => a.kind === 'escalation'), ratify: asks.filter((a) => a.kind === 'ratify'),
    held, next: ready.slice(0, readyN).map((r) => ({ id: r.id, title: r.title, priority: r.priority, ...(r.noAcceptance ? { noAcceptance: true } : {}), ...(r.model ? { model: r.model } : {}), ...declared(byId.get(r.id)) })), readyTotal: scheduled ? null : ready.length,
    ...(scheduled ? { scheduler: profile.scheduler } : {}),
    queue: cmdQueue(root), merged, tips: cmdTips(root, { ci: flags.ci === true }),
    uncommitted: uncommittedLoopFiles(root),
    ...(status.disagreements ? { disagreements: status.disagreements } : {}),
    ...(status.headerRead ? { headerRead: status.headerRead } : {}),
    log: logN ? logLines.slice(-logN).map((e) => `${e.at}${e.writer ? ` by ${e.writer}` : ''} · ${e.text}`) : null,
    legacyHandoff: kept ? { path: handoffPath(root), at: kept.at, ageMs: kept.ageMs } : null,
  };
}

export function renderResume(o, profile = DEFAULT_PROFILE) {
  const shownFields = (x) => (x.fields && Object.keys(x.fields).length ? ` · ${Object.entries(x.fields).map(([n, v]) => `${n}=${v}`).join(' ')}` : '');
  const sec = (title, lines, none) => (lines.length ? [`## ${title}`, ...lines, ''] : none === undefined ? [] : [`## ${title}`, none, '']);
  const lease = (x) => [x.branch && `branch ${x.branch}`, x.worker && `worker ${x.worker}`, x.worker && x.model !== undefined && (x.model ? `model ${x.model}` : 'model not recorded'), x.since && `since ${x.since}`, leasedByText(x)].filter(Boolean).join(' · ');
  const st = o.status;
  const head = [
    `# Resume${o.goal ? ` · ${o.goal}` : ''}`,
    `opened ${o.opened || '?'} · last activity ${o.lastActivity || '?'}${o.archived ? ` · ${o.archived} archived loop(s)` : ''}${profile.declared ? ` · profile ${profile.name}` : ''}`,
    countsLine(st, profile),
    ...(o.slice !== undefined ? [`scoped to the slice of ${o.slice}, the issues tagged slice:${o.slice}: in flight, waiting, the questions, held and next ready are its own; the rulings, the merge queue, the tips and the log are the loop's`] : []),
    '',
  ];
  // The tips and the merge queue as their own views print them; the merges still waiting on CI have a section of their own here.
  const tips = o.tips.repos.length ? renderTips({ repos: o.tips.repos.map((r) => ({ ...r, merged: [] })) }).split('\n') : [];
  const waiting = o.queue.repos.filter((r) => r.rows.length);
  const queue = waiting.length ? renderQueue({ repos: waiting }).split('\n') : [];
  const files = o.uncommitted || [];
  return [
    ...head,
    ...sec(`Rulings in force (${o.rulings.length})`, o.rulings.map((d) => `- ${d.date} · ${d.slug}${d.by ? ` · by ${d.by}` : ''}${d.under ? ` · under ${d.under}` : ''} — ${d.answer ? `${short(d.answer)} · ` : ''}${short(d.line)}`), '- (none)'),
    ...sec(`The files disagree with the log (${(st.disagreements || []).length})`, (st.disagreements || []).map(disagreementText)),
    ...sec(`Read from their headers (${(st.headerRead || []).length})`, (st.headerRead || []).map((n) => `- ${n.line}`)),
    ...sec(`Closed, gate does not hold (${(st.closedGate || []).length})`, (st.closedGate || []).map(closedGateLine)),
    ...sec(`In flight (${o.inFlight.length})`, o.inFlight.map((x) => `- ${x.id} ${short(x.title)}${shownFields(x)}${lease(x) ? ` · ${lease(x)}` : ''}${x.stale.length ? ` · STALE: ${x.stale.join('; ')}` : ''}${x.mark ? `\n  → ${IN_FLIGHT_MARKS[x.mark]}` : ''}`), '- (nothing)'),
    ...sec(`Waiting — After not settled (${o.waiting.length})`, o.waiting.map((x) => `- ${x.id} ${short(x.title)} (after ${x.after.join(', ')})${x.stale !== undefined ? ` · ${x.status === 'in-progress' ? 'in progress' : x.status}${lease(x) ? ` · ${lease(x)}` : ''}${x.stale.length ? ` · STALE: ${x.stale.join('; ')}` : ''}` : ''}`)),
    ...sec(`Questions to the owner (${o.questions.length})`, o.questions.map((a) => `- a-${a.id} (${a.kind || 'stuck'})${a.issue ? ` issue ${a.issue}` : ''} · ${a.question}`), '- (nothing)'),
    ...sec(`Escalations to the jarl (${o.escalations.length})`, o.escalations.map((a) => `- a-${a.id}${a.slice ? ` slice:${a.slice}` : ''}${a.issue ? ` issue ${a.issue}` : ''} · ${a.question}`)),
    ...sec(`To ratify (${o.ratify.length})`, o.ratify.map((a) => `- a-${a.id}${a.issue ? ` (issue ${a.issue})` : ''} · ${a.question}`)),
    ...sec(`Held — files in flight (${o.held.length})`, o.held.map((x) => `- ${x.id}  P${x.priority}  ${short(x.title)} (${x.questions ? `open question ${x.questions.map((q) => `a-${q}`).join(', ')}` : `${[...x.files, ...(x.resources || []).map((n) => `resource ${n}`)].join(', ')} held by ${x.heldBy.join(', ')}`})`)),
    ...(o.scheduler ? sec('Next ready and merge queue', [`- ${schedulerNote(o.scheduler)}`]) : [
      ...sec(`Next ready (${o.next.length} of ${o.readyTotal})`, o.next.map((r) => `- ${r.id}  P${r.priority}  ${short(r.title)}${shownFields(r)}${r.noAcceptance ? '  (no acceptance yet)' : ''}${modelText(r.model)}`), '- (nothing ready)'),
      ...sec('Merge queue', queue, '- (nothing approved waits to be merged)'),
    ]),
    ...sec(`Merged, CI pending or red (${o.merged.length})`, o.merged.map((m) => `- ${m.id} ${m.sha}${m.repo ? ` in ${m.repo}` : ''} · CI ${m.ci}`)),
    ...sec(`Merged, waiting for its check (${(o.status.checkWaiting || []).length})`, (o.status.checkWaiting || []).map((w) => `- ${checkWaitingText(w)}`)),
    ...sec(`Tips${o.tips.ci ? '' : ' (CI not asked — --ci asks gh)'}`, tips),
    ...(files.length ? sec(`Loop files not committed (${files.length}) — commit .jarl/`, [...files.slice(0, 20).map((f) => `- ${f}`), ...(files.length > 20 ? [`- … ${files.length - 20} more`] : [])]) : []),
    ...(o.log ? sec(`Last ${o.log.length} log line(s)`, o.log.map((l) => `- ${l}`), '- (empty log)') : []),
    ...(o.legacyHandoff ? [`(the loop holds a handoff file at .jarl/handoff.md${o.legacyHandoff.at ? `, written ${o.legacyHandoff.at}` : ''} — not the state; handoff read prints it)`] : []),
  ].join('\n').replace(/\n+$/, '');
}

// handoff read — resume, then the .jarl/handoff.md left in the loop, if there is one, as history: its headings one level
// down under a heading that says how old it is, so its snapshot is never read as the state.
export function cmdHandoffRead(root, flags = {}) {
  const out = cmdResume(root, flags);
  if (!existsSync(handoffPath(root))) return { ...out, history: null, text: renderResume(out, loadProfile(root)) };
  const written = readText(handoffPath(root));
  const body = written.split('\n').filter((l) => !/^#\s+Handoff\s*$/.test(l)).map((l) => (/^#{1,5}\s/.test(l) ? `#${l}` : l)).join('\n').trim();
  const h = out.legacyHandoff;
  const when = h && h.at ? `written ${h.at}, ${ago(h.ageMs)} ago` : 'written at an unknown time';
  const text = `${renderResume(out, loadProfile(root))}\n\n## Earlier handoff — history, ${when}; not the current state\n${body}`;
  return { ...out, history: written, text };
}

// handoff write — the state is assembled live by resume, so there is nothing to write. The command is accepted (with
// its flags) so a script that calls it does not fail; it writes nothing — no file, no log line — and says so; exit 0.
export const HANDOFF_TEXT = 'handoff writes nothing. The state a session resumes from is assembled live — run jarl.mjs resume. Put intent where it lives: order in priorities and After (prio, after), reasons in rulings (decide) and issue bodies (body).';
export function cmdHandoffWrite() {
  return { retired: true, wrote: null, note: HANDOFF_TEXT };
}

// The reason an issue was dropped or deferred: the last "Dropped: ..." / "Deferred: ..." line of its Evidence,
// whatever notes were written before it. Evidence with no such line is read whole.
function statusReason(evidence, word) {
  const text = (evidence || '').trim();
  const last = [...text.matchAll(new RegExp(`^${word}:\\s*(.*)$`, 'gm'))].pop();
  return last ? last[1].trim() : text;
}

// report [--found]: done (per repository when the done work spans more than one — an issue naming several is
// listed under each, for each repository's changelog), dropped, deferred, still open, and who reviewed the done
// work; --found adds the issues someone other than the jarl found.
export function cmdReport(root, flags = {}) {
  const loop = readLoop(jarlDir(root));
  const { profile, issues } = loop;
  const done = issues.filter((i) => profile.is(i.status, 'closes-record'));
  const dropped = issues.filter((i) => i.status === 'dropped');
  const deferred = issues.filter((i) => i.status === 'deferred');
  const left = issues.filter((i) => profile.unfinished(i.status));
  // Every other finished status gets its own section after Done, in the profile's order (built-in: Dropped, then
  // Deferred), with the reason a needs-reason status carries.
  const closedOther = profile.statuses.filter((st) => profile.is(st, 'terminal') && !profile.is(st, 'closes-record'));
  const found = issues.filter((i) => i.fields['found by'] && !/^jarl\b/i.test(i.fields['found by']));
  const goal = loop.goalLines.goal ?? '';
  const byRepo = {};
  for (const i of done) for (const r of repoNames(root, i)) (byRepo[r] = byRepo[r] || []).push(i);
  // An issue whose number another file carries too says so on its line, with the files of that number.
  const mark = (i) => (i.shared ? ` (${sharedMark(i.shared)})` : '');
  const row = (i) => `- ${i.id} ${i.title}${mark(i)} (${i.kind})${mergedOf(i) ? ` · merged ${mergedOf(i).sha}${mergedOf(i).repo ? ` in ${mergedOf(i).repo}` : ''}` : ''}`;
  const repos = Object.keys(byRepo).sort();
  const doneLines = repos.length > 1 ? repos.flatMap((r) => ['', `### ${r} (${byRepo[r].length})`, ...byRepo[r].map(row)]) : done.map(row);
  const split = reviewSplit(loop);
  // One row per issue, for a host that renders its own dashboard from --json: the same fields a reader of the
  // issue would look up, with the live approve (who, which kind, when) — the one that actually cleared it, not
  // simply the last one recorded.
  const rows = issues.map((i) => {
    const m = mergedOf(i);
    const a = gateOf(loop, i.id).live;
    return { id: i.id, title: i.title, status: i.status, kind: i.kind, priority: i.priority, tier: i.tier, tags: i.tags, repos: repoNames(root, i), branch: i.fields.branch || null, after: i.after, sources: i.sources, merged: m ? m.sha : null, ci: m ? m.ci : null, review: a ? { by: a.by, kind: a.kind, at: a.at } : null, ...(i.shared ? { shared: i.shared } : {}) };
  });
  const metrics = metricsOf(loop, Date.now());
  const closedGate = closedGateFlags(loop);
  const lines = [`# Report`, '', goal, '', ...(metrics.check.landsOn === 'testimony' ? [testimonyNote(metrics.check), ''] : []), `## Done (${done.length})`, ...(done.length ? [gateLine(profile, split, 'Reviewed by')] : []), ...doneLines,
    ...closedOther.flatMap((st) => {
      const on = issues.filter((i) => i.status === st);
      return ['', `## ${reasonWord(st)} (${on.length})`, ...on.map((i) => `- ${i.id} ${i.title}${mark(i)}${profile.is(st, 'needs-reason') ? ` — ${statusReason(i.sections.evidence, reasonWord(st))}` : ''}`)];
    }),
    ...(closedGate.length ? ['', `## Closed, gate does not hold (${closedGate.length})`, ...closedGate.map(closedGateLine)] : []),
    '', `## Still open (${left.length})`, ...left.map((i) => `- ${i.id} ${i.title}${mark(i)} (${i.status})`),
    ...(flags.found ? ['', `## Found along the way (${found.length})`, ...found.map((i) => `- ${i.id} ${i.title} — ${i.fields['found by']}`)] : []),
    '', renderMetrics(metrics)];
  return { done: done.length, dropped: dropped.length, deferred: deferred.length, left: left.length, found: found.length, reviews: split,
    ...(profile.declared ? { statuses: Object.fromEntries(profile.statuses.map((st) => [st, issues.filter((i) => i.status === st).length])) } : {}),
    byRepo: Object.fromEntries(repos.map((r) => [r, byRepo[r].map((i) => i.id)])), issues: rows, text: lines.join('\n') + '\n', check: metrics.check, metrics, closedGate };
}
