// An issue's evidence and the views that read it: evidence and retract, show, next and status, then mode and close.

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fieldText, need } from './base.mjs';
import { needNoOwnersWords } from './owner.mjs';
import { git } from './git.mjs';
import { jarlDir, stamp } from './where.mjs';
import { readText, writeAtomic } from './files.mjs';
import { cmpId, isBulk } from './ids.mjs';
import { SLOT_NAME_RE, formatState, loadProfile } from './profile.mjs';
import { appendLog, appendLogLines, firstLine } from './journal.mjs';
import { outOfGit } from './loop-git.mjs';
import { attachmentOf, journalById } from './log.mjs';
import { acceptanceLineCount, alignRows, bodyText, evidenceParts, evidenceTable, loadIssues, mergedOf, noteText, parseIssue, placeEvidence, reviewEntries, setSection, sharedMark } from './issues.mjs';
import { fileAt, raiseFormat, repoNames, reposWhere, tipLines, whereLines, whereOf } from './repositories.mjs';
import { approveKind, carriesCode, disagreementText, gateOf, gateState, headerReadNotes, readLoop, recordDisagreements, reviewSplit, scopedLoop } from './loop.mjs';
import { checkState, checkWaiting, checkWaitingText } from './metrics.mjs';
import { builds, modelMarks } from './models.mjs';
import { leaseProblems, staleHours } from './rounds.mjs';
import { attachmentLines, inspectAttachment, requiredSlots, slotProblems } from './attachments.mjs';
import { ARCHIVE_KEEPS, PERMANENT_MARKER, issuesFor, needLifecycle, needLiveLoop, oneOrMany, rowsOf, waitingOn } from './commands.mjs';
import { handoffAge, loadAsks, ratificationBatch } from './questions.mjs';

// ---- commands: evidence ------------------------------------------------------------------------------

export function cmdEvidence(root, rawIds, text, flags) {
  needNoOwnersWords('the evidence', text, flags);
  const attaching = Boolean(flags) && (flags.file !== undefined || flags.slot !== undefined);
  need(!attaching || (text === undefined && flags.ran === undefined && flags.saw === undefined && flags.retract === undefined), 'evidence takes an attachment (--file with --slot), or free text, or --ran/--saw rows, or a retraction, not both');
  if (flags && flags.retract !== undefined) return retractEvidence(root, rawIds, text, flags);
  let rows = null;
  if (attaching) rows = attachmentRow(root, rawIds, flags);
  else if (flags && (flags.ran !== undefined || flags.saw !== undefined)) {
    rows = rowsOf(flags);
    // The log stores a command trimmed and cut to its first line, so the shape is judged on that, in any case.
    need(!rows.some((r) => attachmentOf(String(r.ran).replace(/\r\n?/g, '\n').trim().split('\n')[0].trim().toLowerCase())),'a row shaped as an attachment is written only by --file and --slot, which read the file and record its hash');
    need(text === undefined, `evidence takes free text or --ran/--saw rows, not both (got "${text}" as well) — a value starting with -- goes after a bare --`);
  } else {
    need(text, 'evidence requires "<what was run and what it printed>", or --ran "<command>" --saw "<what it printed>"');
  }
  const issues = issuesFor(root, rawIds);
  // A row is one list item: the lines of a multi-line command or output after the first are indented under it.
  const indented = (v) => String(v).replace(/\r\n?/g, '\n').trim().split('\n').join('\n  ');
  const added = rows ? rows.map((r) => `- **ran:** ${indented(r.ran)} · **saw:** ${indented(r.saw)}`).join('\n') : text;
  for (const issue of issues) {
    const current = (issue.sections.evidence || '').trim();
    writeAtomic(issue.file, setSection(readText(issue.file), 'Evidence', rows ? placeEvidence(current, 'proof', added, '\n') : placeEvidence(current, 'note', noteText(added, current), '\n\n')));
  }
  // Each row line is followed by the tip of the issue's branch, so the gate knows which code the row was made on.
  appendLogLines(root, issues.flatMap((issue) => (rows ? rows.flatMap((r) => [`${issue.id} evidence row · ${firstLine(r.ran, "the issue's Evidence section")}`, ...tipLines(root, issue)]) : [`${issue.id} evidence · ${firstLine(text, "the issue's Evidence section")}`])));
  return oneOrMany(rawIds, issues.map((issue) => (rows ? { id: issue.id, rows } : { id: issue.id })));
}

// A text a reviewer or a retracting hand gives must say something: at least two letters or digits (not "", "-", "x").
const REVIEW_MIN_WORDS = 3;
function needSaid(text, what) {
  const said = (String(text ?? '').match(/[\p{L}\p{N}]/gu) || []).length;
  need(said >= 2, `${what} needs words — what was read and what was found, or why; got "${String(text ?? '').trim().slice(0, 20)}"`);
}
function retractedBy(flags, what) {
  need(flags.by !== undefined && fieldText(flags.by), `${what} needs --by <who> — whoever retracts it is recorded with the reason`);
  return fieldText(flags.by);
}
const struck = (line) => line.replace(/^- /, '- ~~');

function retractEvidence(root, rawIds, reason, flags) {
  need(!isBulk(rawIds), 'retract names one issue and one row');
  need(flags.ran === undefined && flags.saw === undefined, 'a retraction takes a row number and a reason, not a new --ran/--saw row');
  const raw = String(flags.retract);
  need(/^\d+$/.test(raw) && Number(raw) >= 1, `retract takes the number of an evidence row as show prints it (1, 2, …); got "${raw}"`);
  const n = Number(raw);
  const by = retractedBy(flags, 'a retraction');
  needSaid(reason, 'a retraction');
  const [issue] = issuesFor(root, rawIds);
  const text = readText(issue.file);
  const table = evidenceTable(parseIssue(text, issue.file).sections.evidence);
  need(table.rows.length > 0, `${issue.id} has no evidence row to retract`);
  const row = table.rows[n - 1];
  need(row, `${issue.id} has ${table.rows.length} evidence row${table.rows.length === 1 ? '' : 's'}: there is no row ${n}`);
  need(!row.retracted, `row ${n} of ${issue.id} is retracted already`);
  // An issue read from its header has no log rows of its own: its file's rows are the only ones.
  const journalRows = issue.byHeader ? [] : (journalById(root).get(issue.id) || []).filter((e) => e.type === 'row');
  need(journalRows.length === 0 || journalRows.length === table.rows.length, `${issue.id} holds ${table.rows.length} evidence row${table.rows.length === 1 ? '' : 's'} and its log ${journalRows.length}, so the row numbers cannot be matched to the log; nothing was written`);
  need(journalRows.length === 0 || alignRows(issue.id, table.rows, journalRows)[n - 1], `row ${n} of ${issue.id} matches no evidence line of the log, so its retraction could not be told from another row's; nothing was written`);
  // The first retraction of a loop raises the record format, before its line is written: a reader of format 1 does not
  // read a retraction and would go on counting the row, so it must refuse the loop instead.
  raiseFormat(root);
  const lines = table.lines.slice();
  lines[row.start] = struck(lines[row.start]);
  lines[row.end] = `${lines[row.end].trimEnd()}~~`;
  const entry = `- **retracted:** row ${n} · by ${by} · ${stamp().slice(0, 10)}\n${bodyText(reason).split('\n').map((l) => (l ? `  ${l}` : '')).join('\n')}`;
  writeAtomic(issue.file, setSection(text, 'Evidence', placeEvidence(lines.join('\n').trim(), 'note', entry, '\n')));
  appendLog(root, `${issue.id} evidence retract · row ${n} · by ${by} · ${firstLine(reason, "the issue's Evidence section")}`);
  return { id: issue.id, retracted: n, by };
}

// show <id>: the issue as the done gate sees it. The header, What, Why, Acceptance, Changelog and any section of the
// profile in full; of Reviews and Evidence only the gate's window — every verdict and every --ran/--saw row since
// the last start or reopen — plus every "changes" finding no later approve has answered, and one line for each
// earlier verdict; last, the exact call that prints everything. The window is read from the journal, where the file's
// entries are matched to the log's lines in order: when the file and the log do not agree on how many there are (an
// issue written by hand, a loop without a Reviews section) nothing is cut. Every evidence row carries its
// ordinal [n], counted over the whole section, the number retract takes; --full prints the file with them.
export function issueView(root, issue, { full = false } = {}) {
  const pieces = [];
  let cur = { name: null, lines: [] };
  for (const l of readText(issue.file).split('\n')) {
    const h = /^##\s+(.*)$/.exec(l);
    if (h) { pieces.push(cur); cur = { name: h[1].trim().toLowerCase(), lines: [l] }; } else cur.lines.push(l);
  }
  pieces.push(cur);
  const numbered = (body, rows) => body.map((l, i) => { const r = rows.find((x) => x.start === i); return r ? l.replace(/^- /, `- [${r.n}] `) : l; });
  const g = full ? null : gateState(root, issue.id);
  const loop = readLoop(jarlDir(root));
  const notes = [...recordDisagreements(loop).filter((d) => d.id === issue.id).map(disagreementText), ...headerReadNotes(loop).filter((n) => n.id === issue.id).map((n) => `note: ${n.line}`), ...checkWaiting(loop, [issue]).map(checkWaitingText), ...whereLines(whereOf(root, issue))];
  const out = [];
  for (const p of pieces) {
    if (p.name === null && notes.length) {
      const head = [...p.lines];
      while (head.length && head[head.length - 1].trim() === '') head.pop();
      out.push(...head, ...notes, '');
      continue;
    }
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
  if (full) return attachments.length ? `${out.join('\n').replace(/\s+$/, '')}\n\n${attachments.join('\n')}\n` : out.join('\n');
  return `${out.join('\n').replace(/\s+$/, '')}\n\n${attachments.length ? `${attachments.join('\n')}\n\n` : ''}The whole issue, with every earlier round and row: jarl.mjs show ${issue.id} --full\n`;
}

// The words next, queue, status and resume say in place of what they would compute, on a loop whose profile names an
// external scheduler: Jarl does not know that scheduler's edges (ports, leases, holds), so a ready list of its own would
// offer work the loop's real scheduler holds back.
export function schedulerNote(cmd) { return `scheduling is led by the composer: ${cmd}`; }

// next — on a loop with an external scheduler, { scheduler, note } and no list: Jarl computes nothing it cannot know.
// By default the issues ready to start and nothing else; --all adds the others, each row carrying its group:
// ready, held-by-file (a file an in-progress or earlier-offered issue holds), waiting-after (After not settled) or
// held-by-question (an open stuck or stop question names the issue). A library caller reads the full list through
// nextRows and filters it itself.
export const NEXT_GROUPS = ['ready', 'held-by-file', 'held-by-resource', 'waiting-after', 'held-by-question'];
export function cmdNext(root, flags) {
  const profile = loadProfile(root);
  if (profile.scheduler) return { scheduler: profile.scheduler, note: schedulerNote(profile.scheduler) };
  const rows = nextRows(root, flags);
  return flags.all ? rows : rows.filter((r) => r.ready);
}

export const modelsTableBuilds = () => builds.modelsTable;
export const nextRowsBuilds = () => builds.nextRows;

// The model of a ready issue as next and resume show it: the default model of the issue's tier.
const modelText = (m) => (m && m.default ? `  [model ${m.default}]` : '');

const NEXT_HEADERS = { ready: 'Ready', 'held-by-file': 'Held by a file another issue holds', 'held-by-resource': 'Held by a resource another issue holds', 'waiting-after': 'Waiting on After', 'held-by-question': 'Held by an open question' };
export function renderNext(rows, all, held = 0) {
  const line = (r) => {
    const note = r.group === 'ready' ? [r.noAcceptance && 'no acceptance yet', r.noFiles && 'no files declared']
      : r.group === 'waiting-after' ? [`after ${r.after.join(', ')}`]
        : r.group === 'held-by-question' ? [`question ${r.questions.map((q) => `a-${q}`).join(', ')}`]
          : [`waits on ${[...r.waitsOn, ...(r.resources || []).map((x) => `resource ${x}`)].join(', ')}, held by ${r.heldBy.join(', ')}`];
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

export function nextRows(root, flags = {}) {
  builds.nextRows += 1;
  const profile = loadProfile(root);
  const issues = loadIssues(root);
  // An open question of kind stuck (the default) or stop that names an issue holds that issue back until it is answered.
  const asked = new Map();
  for (const a of loadAsks(root)) {
    if (a.state !== 'open' || !a.issue || !['stuck', 'stop', null].includes(a.kind)) continue;
    asked.set(a.issue, [...(asked.get(a.issue) || []), a.id]);
  }
  // Files are compared as (repository, path) pairs: the same path in two repositories never holds
  // an issue back, the same file in one repository always does, however its Repo path is spelled.
  const keysOf = (i) => i.files.map((f) => { const at = fileAt(root, i, f); return { f, key: `${at.repo}\n${at.path}` }; });
  // Each taken file with the issue holding it: one in a lease status (in progress), or a dispatchable (open)
  // one offered earlier in this list.
  const taken = new Map(issues.filter((i) => profile.is(i.status, 'holds-claim')).flatMap((i) => keysOf(i).map((k) => [k.key, i.id])));
  // Exclusive resources: names, loop-wide (no repository in the key), held by an issue for its lease's whole life. Resources
  // is a field the tool writes itself, so no profile declares a field of that name and the name has one meaning.
  const resourcesOf = (i) => i.resources.map((name) => ({ name, key: name.toLowerCase() }));
  const takenRes = new Map(issues.filter((i) => profile.is(i.status, 'holds-claim')).flatMap((i) => resourcesOf(i).map((r) => [r.key, i.id])));
  const byId = new Map(issues.map((i) => [i.id, i]));
  const out = [];
  for (const i of issues.filter((x) => profile.is(x.status, 'dispatchable')).sort((a, b) => a.priority.localeCompare(b.priority) || cmpId(a.id, b.id))) {
    // An issue whose After issues are not all settled (done or dropped) is never offered, whatever its files.
    const after = waitingOn(i, byId, profile);
    const base = { id: i.id, title: i.title, priority: i.priority, ...(i.files.length ? {} : { noFiles: true }), ...(i.shared ? { shared: i.shared } : {}) };
    if (after.length) { out.push({ ...base, group: 'waiting-after', after, waitsOn: [] }); continue; }
    if (asked.has(i.id)) { out.push({ ...base, group: 'held-by-question', questions: asked.get(i.id), waitsOn: [], after: [] }); continue; }
    const keys = keysOf(i);
    const held = keys.filter((k) => taken.has(k.key));
    const heldRes = resourcesOf(i).filter((r) => takenRes.has(r.key));
    if (held.length || heldRes.length) {
      out.push({
        ...base, group: held.length ? 'held-by-file' : 'held-by-resource', waitsOn: held.map((k) => k.f),
        ...(heldRes.length ? { resources: heldRes.map((r) => r.name) } : {}),
        heldBy: [...new Set([...held.map((k) => taken.get(k.key)), ...heldRes.map((r) => takenRes.get(r.key))])], after: [],
      });
      continue;
    }
    keys.forEach((k) => taken.set(k.key, i.id));
    resourcesOf(i).forEach((r) => takenRes.set(r.key, i.id));
    // Offered, but flagged: a worker raised on an issue with no acceptance line has nothing to prove, and
    // the reviewer nothing to check it against. Fill it with body --acceptance before raising one.
    out.push({ ...base, group: 'ready', files: i.files, ready: true, waitsOn: [], after: [], ...(acceptanceLineCount(i) ? {} : { noAcceptance: true }) });
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
  const hours = staleHours(flags);
  const { profile } = loop;
  // The count per status. Without a profile the five built-in counts are top-level keys; under a
  // profile they live under their own key, statuses, so no status name can overwrite a key of the view (waiting,
  // ready, stale...). countOf reads either.
  const counts = Object.fromEntries(profile.statuses.map((st) => [st, 0]));
  const c = profile.declared ? { statuses: counts } : counts;
  const every = loop.issues;
  // --tag: every section below is computed over the issues carrying that tag only; an After issue outside the tag is
  // still read for what it is (byId holds them all), so waiting means the same thing in the scope as in the whole.
  if (flags.tag !== undefined) need(typeof flags.tag === 'string' && flags.tag && every.some((i) => i.tags.includes(flags.tag)), `no issue carries the tag ${flags.tag}`);
  const issues = flags.tag === undefined ? every : every.filter((i) => i.tags.includes(flags.tag));
  for (const i of issues) counts[i.status] = (counts[i.status] || 0) + 1;
  // Each status keeps its own count; waiting is the part of those in play (open, in progress) whose After issues
  // are not settled yet, so "in flight" in the text line means someone is working on it.
  const { byId } = loop;
  const unfinished = issues.filter((i) => profile.active(i.status));
  c.waitingIds = unfinished.filter((i) => waitingOn(i, byId, profile).length).map((i) => i.id);
  c.waiting = c.waitingIds.length;
  c.inFlight = unfinished.filter((i) => profile.is(i.status, 'holds-claim') && !c.waitingIds.includes(i.id)).length;
  // Ready is Jarl's own reckoning (dispatchable, After settled); under an external scheduler it is not Jarl's to count:
  // null, and scheduler names who counts it.
  c.ready = profile.scheduler ? null : unfinished.filter((i) => profile.is(i.status, 'dispatchable') && !c.waitingIds.includes(i.id)).length;
  if (profile.scheduler) c.scheduler = profile.scheduler;
  c.noAcceptance = issues.filter((i) => profile.is(i.status, 'holds-claim') && !acceptanceLineCount(i)).map((i) => i.id);
  const inScope = new Set(issues.map((i) => i.id));
  const asks = loop.asks.filter((a) => a.state === 'open' && (flags.tag === undefined || (a.issue && inScope.has(a.issue))));
  // A ratify item blocks nothing, so it is not counted among the questions the loop waits on.
  c.questions = asks.filter((a) => a.kind !== 'ratify').length;
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
  c.stale = issues.filter((i) => profile.is(i.status, 'holds-claim')).map((i) => ({ id: i.id, problems: leaseProblems(root, i, hours) })).filter((x) => x.problems.length);
  const live = issues.filter((i) => i.status !== 'dropped');
  c.ciPending = live.filter((i) => mergedOf(i)?.ci === 'pending').map((i) => i.id);
  c.ciRed = live.filter((i) => mergedOf(i)?.ci === 'red').map((i) => i.id);
  c.checkWaiting = checkWaiting(loop, issues);
  c.handoff = handoffAge(root, c.lastActivity);
  c.reviews = reviewSplit(flags.tag === undefined ? loop : scopedLoop(loop, issues));
  c.inFlightRows = inFlightRows(loop, issues);
  c.closedGate = closedGateFlags(flags.tag === undefined ? loop : scopedLoop(loop, issues));
  const disagreements = recordDisagreements(flags.tag === undefined ? loop : scopedLoop(loop, issues));
  if (disagreements.length) c.disagreements = disagreements;
  // The numbers read from their headers, one note each: not disagreements, the header is the record for them.
  const byHeader = headerReadNotes(flags.tag === undefined ? loop : scopedLoop(loop, issues));
  if (byHeader.length) c.headerRead = byHeader;
  // The record format: what the loop is in, what this Jarl reads, and the lines that are off where a composer keeps the format.
  c.recordFormat = formatState(profile);
  const files = uncommittedLoopFiles(root);
  c.uncommitted = files === null ? null : files.length;
  // --by: the same five counts per repository, tag, kind or priority — a dashboard's table, read from the issues.
  if (flags.by !== undefined) {
    // Or a field the profile declares: one group per value it holds.
    const declared = profile.fields.find((f) => f.key === String(flags.by).toLowerCase());
    need(STATUS_BY.includes(flags.by) || declared, `--by is one of: ${[...STATUS_BY, ...profile.fields.map((f) => f.key)].join(', ')} (got "${flags.by}")`);
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
  c.check = checkState(loop);
  return c;
}
export const STATUS_BY = ['repo', 'tag', 'kind', 'prio'];

// What the record says about one in-flight issue, as one fact and the step it points to (never a status, never stored):
// no evidence rows since the start; rows and no verdict since the last restart or round; changes requested; approved
// (the merge comes next, and then done). A self approve is not a verdict that counts, so it reads as no verdict.
export const IN_FLIGHT_MARKS = {
  'no-rows': 'no evidence rows since the start — the worker has recorded no proof yet',
  'rows-no-verdict': 'evidence rows recorded, no verdict since the last start or round — it waits for a reviewer',
  'changes-requested': 'changes requested — it is back with the worker, who fixes it and records new rows',
  approved: 'approved and queued for the merge — next the merger lands it, then set it done',
  'approved-not-fresh': 'approved by a coordinator only, and it carries code — neither the merge queue nor done accepts that: it waits for a fresh reviewer\'s approve',
  merged: 'merged — nothing is left to land: set it done',
  'merged-ci': 'merged, CI not green yet — next record the CI result (merged <id> --ci green|red), then set it done',
};
export function inFlightMark(loop, issue) {
  const g = gateOf(loop, issue.id);
  if (g.approved) {
    // The same rule the done gate and the merge queue apply: an issue that carries code is cleared by a fresh approve only.
    if (carriesCode(issue) && !g.fresh) return 'approved-not-fresh';
    const m = mergedOf(issue);
    if (!m) return 'approved';
    return m.ci === 'pending' || m.ci === 'red' ? 'merged-ci' : 'merged';
  }
  const verdicts = g.trail.filter((r) => r.inWindow && !r.retracted && (r.verdict === 'approve' || r.verdict === 'changes'));
  if (verdicts.length && verdicts[verdicts.length - 1].verdict === 'changes') return 'changes-requested';
  return g.rowsSince === 0 ? 'no-rows' : 'rows-no-verdict';
}
// The rows for the in-flight `issues` of a loop (its own issues, or the ones a view is scoped to).
export function inFlightRows(loop, issues) {
  const { profile, byId } = loop;
  return issues.filter((i) => profile.is(i.status, 'holds-claim') && !waitingOn(i, byId, profile).length).map((i) => {
    const mark = inFlightMark(loop, i);
    return { id: i.id, title: i.title, branch: i.fields.branch || null, worker: i.fields.worker || null, model: i.fields.model || null, since: i.fields.since || null, mark, next: IN_FLIGHT_MARKS[mark] };
  });
}

// A loop opened in the default mode, or opened --committed, has no way to become the
// permanent record other than this: init is the only command that writes .jarl/.permanent for a new
// loop, and mode is the only other one, for an existing one — it never turns the default mode's ignore-everything
// .jarl/.gitignore into the committed one, so a
// default-mode loop (out of git) cannot be switched in place: a permanent record must be committed,
// and only init decides that. Idempotent it is not: running it twice on an already-permanent loop
// refuses clearly instead of silently doing nothing, so a session never mistakes a no-op for a check.
export function cmdMode(root, mode) {
  need(mode, 'mode requires a target: jarl.mjs mode permanent');
  need(mode === 'permanent', `mode only supports "permanent" today: jarl.mjs mode permanent (got "${mode}")`);
  needLiveLoop(root, '');
  need(!outOfGit(root), 'this loop is out of git (default mode) — a permanent record must be committed, and only init decides .jarl/.gitignore, so there is no in-place switch. Start a fresh loop with: jarl.mjs init "<goal>" --permanent');
  need(!existsSync(join(jarlDir(root), '.permanent')), 'already a permanent record (.jarl/.permanent exists) — nothing to do');
  writeAtomic(join(jarlDir(root), '.permanent'), PERMANENT_MARKER);
  appendLog(root, 'mode → permanent · not tied to a feature branch; close keeps the directory');
  return { permanent: true };
}

export function cmdClose(root, flags = {}) {
  needLiveLoop(root, '');
  needLifecycle(root, 'close', flags.caller);
  // --batch files the ratification batch and closes nothing, so the owner can answer it before the loop goes.
  if (flags.batch) return { closed: false, batch: ratificationBatch(root) };
  const profile = loadProfile(root);
  const left = loadIssues(root).filter((i) => profile.unfinished(i.status));
  need(flags.force || left.length === 0, `${left.length} issue(s) still open or in progress: ${left.map((i) => i.id).join(', ')} — set each ${profile.with('terminal').filter((st) => profile.is(st, 'settles-dependents') || profile.is(st, 'closes-record')).join(' or ') || profile.with('terminal').join(' or ')}, or report them to the owner and run with --force`);
  // A permanent loop is a record, not a stage cleared before a merge: close leaves the directory in
  // place and logs the close instead of removing it, so --root still finds the loop afterwards.
  // Deferred work is not open, but it is work that waits: where close removes the directory it would wait nowhere, so
  // the default mode refuses until the deferred issues are archived or --force removes them; a permanent loop keeps them.
  const deferred = loadIssues(root).filter((i) => i.status === 'deferred').map((i) => i.id);
  const permanent = existsSync(join(jarlDir(root), '.permanent'));
  need(permanent || flags.force || deferred.length === 0, `${deferred.length} issue(s) deferred: ${deferred.join(', ')} — close removes .jarl/ with them, and deferred work waits, it is not gone. Keep it: jarl.mjs archive "<slug>" puts the loop under .jarl/archive/ with its deferred issues. Or remove it with them: jarl.mjs close --force`);
  // The ratification batch is assembled here and never holds the close: in a permanent loop its items stay open for
  // the owner's word; in a loop on a branch the rulings no one ratified leave with the directory, rulings of that loop.
  // In the committed mode the archive is committed content: leaving it would put .jarl/archive/ on the branch that merges to
  // main, so close refuses while it holds anything, unless --force removes the whole directory.
  const archiveDir = join(jarlDir(root), 'archive');
  const archived = existsSync(archiveDir) ? readdirSync(archiveDir) : [];
  const committedMode = !permanent && !outOfGit(root);
  need(!committedMode || flags.force || archived.length === 0, `.jarl/archive/ holds ${archived.length} archived loop(s): ${archived.join(', ')} — in the committed mode the archive is committed content, and close would leave it on the branch that merges to main. Move it out of the tree, or remove it with the loop: jarl.mjs close --force`);
  const batch = ratificationBatch(root);
  // A committed loop's files git never saw are named, not refused: in the permanent mode they (and the closing
  // line) wait for a commit; in the committed mode the removal below is itself the change to commit.
  if (permanent) {
    appendLog(root, `closed · kept as a permanent record${deferred.length ? ` · ${deferred.length} deferred still waiting: ${deferred.join(', ')}` : ''}`);
    const files = uncommittedLoopFiles(root);
    return { closed: true, removed: null, kept: jarlDir(root), leftOpen: left.map((i) => i.id), deferred, uncommitted: files === null ? null : files.length, batch };
  }
  const files = uncommittedLoopFiles(root);
  // In the default mode an archive is never removed: close removes the live loop's files and leaves the archive, the mode
  // markers and the templates where archive leaves them. In the committed mode the whole directory goes (an archive only with --force).
  const archive = archiveDir;
  const keepArchive = !committedMode && existsSync(archive);
  if (keepArchive) {
    for (const entry of readdirSync(jarlDir(root))) if (!ARCHIVE_KEEPS.has(entry)) rmSync(join(jarlDir(root), entry), { recursive: true, force: true });
  } else rmSync(jarlDir(root), { recursive: true, force: true });
  return { closed: true, removed: jarlDir(root), archiveKept: keepArchive ? archive : null, archiveRemoved: archived.length ? archived : null, kept: null, leftOpen: left.map((i) => i.id), deferred, uncommitted: files === null ? null : files.length, batch };
}

// The row `evidence <id> --file <path> --slot <name>` writes, after every check; nothing is written here.
function attachmentRow(root, rawIds, flags) {
  need(!isBulk(rawIds), 'an attachment names one issue: evidence <id> --file <path> --slot <name>');
  need(flags.file !== undefined, '--slot needs --file <path>: the file of the slot, relative to the loop root');
  need(flags.slot !== undefined, '--file needs --slot <name>: the slot of the issue\'s kind the file fills');
  need(typeof flags.file === 'string' && typeof flags.slot === 'string', '--file and --slot each take one value');
  const slot = flags.slot.trim();
  need(SLOT_NAME_RE.test(slot), `a slot name is lower-case letters, digits and - (starting with a letter or digit, at most 40 characters); got "${slot.slice(0, 40)}"`);
  const [issue] = issuesFor(root, rawIds);
  const profile = loadProfile(root);
  const specs = requiredSlots(profile, issue);
  const spec = specs.find((s) => s.name === slot);
  const kind = issue.kind || profile.kindDefault;
  need(spec, `the profile declares no slot "${slot}" for an issue of kind ${kind}${specs.length ? ` (its slots: ${specs.map((s) => s.name).join(', ')})` : ' — it requires no slots for that kind'}`);
  const rel = flags.file;
  const read = inspectAttachment(root, issue.id, spec, rel, 'is no such file');
  need(!read.problem, read.missing ? `no such file: ${rel}, under the loop root` : read.problem);
  return [{ ran: `attach ${slot} ${read.name} sha256:${read.sha256} size:${read.size}`, saw: `slot ${slot}: ${read.size} bytes` }];
}

// The closed issues whose done gate does not hold on the record as it stands, each with its reason and the command that
// repairs it. Read from the journal the gate reads, never stored: the gate refuses at the move, and the record can change
// after it (an approve or a proof row retracted, a merge recorded later, a restart that spent the approve). Every issue
// in a finished status is read: a closing one against the gate's own conditions, any other against the merge it records.
export function closedGateFlags(loop) {
  const { profile } = loop;
  const flags = [];
  for (const issue of loop.issues) {
    if (!profile.is(issue.status, 'terminal')) continue;
    const id = issue.id;
    const events = loop.eventsById.get(id) || [];
    const merges = events.filter((e) => e.type === 'merged');
    const reasons = []; const repairs = [];
    const flag = (reason, repair) => { reasons.push(reason); if (!repairs.includes(repair)) repairs.push(repair); };
    const reopen = `jarl.mjs set ${id} open`;
    if (!profile.is(issue.status, 'closes-record')) {
      if (merges.length || mergedOf(issue)) flag(`a merge is recorded on a ${issue.status} issue`, reopen);
    } else {
      const g = gateOf(loop, id);
      if (!g.tracked) continue;
      const code = carriesCode(issue);
      if (!g.rowsSince) flag(g.rowLog.some((r) => r.retracted && r.n > g.anchorN) ? 'its proof row was retracted' : `no --ran/--saw row since it was ${g.anchor.what === 'filed' ? 'filed' : `moved → ${g.anchor.what}`}`, `jarl.mjs evidence ${id} --ran "<command>" --saw "<what it printed>"`);
      for (const p of slotProblems(loop.root, profile, issue, g, false)) flag(`slot ${p.slot}: ${p.what}`, p.fix);
      if (profile.doneGate.approve !== 'none') {
        const fresh = `jarl.mjs review ${id} approve --by <fresh reviewer> "<findings>"`;
        const kind = approveKind(g);
        if (g.selfApproved) flag('its live approve is by a worker of this issue or its branch', fresh);
        else if (!g.approved) flag(kind === 'retracted' ? 'its approve was retracted' : g.trail.some((r) => r.verdict === 'approve') ? 'its approve is spent by a later round, restart, reopen or changes verdict' : 'it holds no approve', fresh);
        else if (code && !g.fresh) flag(`it carries code and holds no fresh approve (the live one is by ${g.live.by || 'a reviewer not recorded'}, ${g.live.kind || 'unrecorded'})`, fresh);
      }
      const doneAt = Math.max(-1, ...events.filter((e) => e.type === 'move' && profile.is(e.to, 'closes-record')).map((e) => e.n));
      if (merges.some((m) => m.n > doneAt)) flag('a merge was recorded after it went done', reopen);
      if (fieldText(issue.fields.branch) && !merges.length && !mergedOf(issue)) flag('a code issue done with no merge recorded', reopen);
    }
    // Reopening resets the row and the approve, so when it is one of several repairs it comes first: the others would be wasted.
    if (repairs.length > 1 && repairs.includes(reopen)) repairs.splice(0, repairs.length, `${reopen} (it resets the row and the approve, so do it first)`, ...repairs.filter((r) => r !== reopen));
    if (reasons.length) flags.push({ id, reason: reasons.join('; '), repair: repairs.join(' ; ') });
  }
  return flags;
}

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { REVIEW_MIN_WORDS, modelText, needSaid, retractedBy, statusOf, struck };
