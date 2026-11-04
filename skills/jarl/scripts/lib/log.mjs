// The log: the one reader of every line the journal holds, which the review and the done gate stand on.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CI_STATES, fieldText, hole, need } from './base.mjs';
import { needNoOwnersWords } from './owner.mjs';
import { jarlDir, plainRelative } from './where.mjs';
import { readText, writeAtomic } from './files.mjs';
import { ISSUE_FILE_RE, KEY_SRC, idKey, idRe, issueForms, writtenId } from './ids.mjs';
import { SLOT_NAME_RE, loadProfile } from './profile.mjs';
import { STAMP_SRC, appendLog, headerKey, logPath, oneLine } from './journal.mjs';

// ---- review and the done gate --------------------------------------------------------------------

// ---- the log: one reader ---------------------------------------------------------------------------
//
// The log is one dated line per event. This is the only place that reads the file and the only place that knows a
// line's grammar: parseEvent types one line, loopEvents reads the file and types them all, and everything else that
// needs a fact about the log (the done gate, the metrics, models, the rounds, tips, the timestamps status and resume
// print) takes it from the typed event. A line kind is taught here once.
//
// An event is { n, at, text, writer, id, type, … } with n the line's index in the file, writer the name the call that
// wrote it gave (null when it named none) and id the issue the line is about (null for a line about the loop). The types and what they add:
//   filed          the issue's filing
//   move           a status change: from (null when the log names no status before the line), to, lease — { worker, model, branch }
//                  for a move into a status that holds the claim and names a worker, else null — and model, the model a
//                  lease line names (null without one); a move that hands the lease over adds handover (true) and branch,
//                  the branch it names (null without one)
//   round          one red round; a round this Jarl writes carries its standing right after its number, as standing
//                  { takeover, count, limit }: `<id> round <n> · count <k> of <limit> · …`, or `takeover <k> of <limit>`
//                  on the round that reached the limit and printed the takeover block. A round line without a standing
//                  is counted at the fixed limit of three (see takeoverStanding)
//   row            one --ran/--saw evidence row
//   verdict        a review: verdict (approve|changes), by, kind (as recorded), model, relayed
//   retract-row    a retracted evidence row: row, its number
//   retract-note   a retracted evidence note: note, its number
//   retract-review a retracted approve
//   merged         a recorded merge: sha, repo, check, red, ci
//   tip            the tip of the issue's branch when the line before it of the same issue (a row, a verdict, a merge) was
//                  written: tip, the commit of the branch in each repository of the issue, in order, joined by commas
//   ci             a CI state recorded alone: state
//   body           a body change
//   tick           the owner's tick of an acceptance line only he ticks: line, its number when it was ticked, by, and
//                  ownerLine, the line as it was written then, which is what the tick holds (a line rewritten after it is
//                  another); the event's text stays the log line's whole text, as for every other kind
//   other          any other line
// A line names its writer, when the call that wrote it named one (--by), right after the stamp and before the separator:
// `- <stamp> by <writer> · <text>`. The place is fixed and no text of the line can reach it, so a note can never pose as
// a writer; a reader that knows no writer does not read the line as dated at all, and a loop that holds one is in
// record format 3, which that reader refuses. A line about an issue that carries a key names the key in the same way,
// right after the stamp and before the writer: `- <stamp> key <key> by <writer> · <text>`. The key, not the number, says
// which issue such a line is about: two issues that took one number in two copies of the loop keep their lines apart,
// and an issue given another number keeps the lines written under its old one. A line with no key is read by its number.
const LOG_LINE = new RegExp(`^- (${STAMP_SRC})(?: key (${KEY_SRC}))?(?: by ([^·\\n]+?))? · ([^\\n]*)$`);
const LEADING_ID = idRe('^(?:filed )?({id})\\b');
const RETRACT_ROW_LINE = idRe('^{id} evidence retract · row (\\d+)\\b');
const RETRACT_NOTE_LINE = idRe('^{id} evidence retract · note (\\d+)\\b');
// The tip line: the branch's commit in each repository of the issue, joined by commas, alone on the line.
const TIP_LINE = idRe('^{id} tip ([0-9a-f]{7,64}(?:,[0-9a-f]{7,64})*)$');
// The owner's tick: the number the acceptance line had, who ticked it, then the line itself as it was written.
const TICK_LINE = idRe('^{id} tick · line (\\d+) · by (.+?) · (\\[[^\\]]*\\].*)$');
// The standing of a round, right after its number and before its findings and its text: its count and the limit then.
const ROUND_STANDING_LINE = /^\S+ round \d+ · (count|takeover) (\d+) of (\d+) · /;
// A move into a status that holds the claim is read by position, never by searching: after the arrow and the status come
// the free reason (at most one segment, never searched for fields) and then the lease fields in the order set writes them
// (branch, model, worker, worktree), each at most once; the worktree path is the rest of the line.
const LEASE_ORDER = ['branch', 'model', 'worker', 'worktree'];
const LEASE_SEGMENT = /^(branch|model|worker|worktree) (.+)$/;
function leaseTail(segments) {
  const out = {};
  let at = -1;
  for (let i = 0; i < segments.length; i += 1) {
    const m = LEASE_SEGMENT.exec(segments[i]);
    if (!m) return null;
    const k = LEASE_ORDER.indexOf(m[1]);
    if (k <= at) return null;
    at = k;
    if (m[1] === 'worktree') { out.worktree = [m[2], ...segments.slice(i + 1)].join(' · '); return out; }
    if (m[1] === 'branch' && /\s/.test(m[2])) return null;
    // A worker or a model is a name: a text with a comma in it is a sentence, so a reason that opens with "worker" is not one.
    if ((m[1] === 'worker' || m[1] === 'model') && m[2].includes(',')) return null;
    out[m[1]] = fieldText(m[2]);
  }
  return out;
}
// The segment that marks a lease handed over: it follows the move's reason, which a handover always has, so it is the
// second segment of the head or later, and a reason alone (one segment) is never read as one.
export const HANDOVER_SEGMENT = 'handover';
// The lease fields { branch, model, worker, worktree } a move line carries: the longest tail of its segments that reads as
// lease fields in order, the segments before it being the reason.
// The reason is the rest, as `reason`, without the "(reason)" segment that closes a reason opening with a field name, and
// without the handover segment; `handover` is true on a move that hands the lease over.
export function leaseOfMove(text, id, to) {
  const rest = text.slice(`${id} → ${to}`.length);
  const segments = rest === '' ? [] : rest.split(' · ').slice(1);
  for (let k = 0; k <= segments.length; k += 1) {
    const found = leaseTail(segments.slice(k));
    if (!found) continue;
    const head = segments.slice(0, k);
    if (head.length > 1 && head[head.length - 1] === '(reason)' && /^(branch|model|worker|worktree) /.test(head[0])) head.pop();
    const handover = head.length > 1 && head[head.length - 1] === HANDOVER_SEGMENT;
    if (handover) head.pop();
    return { ...found, reason: head.join(' · '), ...(handover ? { handover: true } : {}) };
  }
  return { reason: '' };
}

// The approve a retraction line takes away, as { by, kind } (by null for an approve with no reviewer recorded), or null
// when the line names none. The line is written "retracts the approve by <name> (<kind>) of <date>".
const RETRACT_TARGET = /retracts the approve (?:by (.+?)(?: \((fresh|coordinator|self)\))?(?: of \d{4}-\d{2}-\d{2})?|with no reviewer recorded)(?= · |$)/;
function retractTarget(text) {
  const m = RETRACT_TARGET.exec(text);
  return m ? { by: m[1] ?? null, kind: m[2] ?? null } : null;
}

// The slot facts of an attachment row's command, `attach <slot> <path> sha256:<hex> size:<bytes>`, as { slot, path, sha256,
// size }; null for any other command. The row's journal line and its line in the issue file hold the same command.
export function attachmentOf(ran) {
  const p = String(ran).split(' ');
  if (p.length !== 5 || p[0] !== 'attach') return null;
  const sha = /^sha256:([0-9a-f]{64})$/.exec(p[3]);
  const size = /^size:(\d{1,12})$/.exec(p[4]);
  if (!sha || !size || !SLOT_NAME_RE.test(p[1]) || p[2] === '' || plainRelative(p[2])) return null;
  return { slot: p[1], path: p[2], sha256: sha[1], size: Number(size[1]) };
}
// One log line as an event, without its place in the file. `from` is the status the issue was in before the line.
export function parseEvent(id, text, profile, from = null) {
  return eventParser(profile)(id, text, from);
}
function eventParser(profile) {
  const moved = movesInto(profile.statuses);
  const claims = (st) => profile.is(st, 'holds-claim');
  return (id, text, from) => {
    if (text.startsWith(`filed ${id} `)) return { type: 'filed' };
    if (!text.startsWith(`${id} `) && text !== id) return { type: 'other' };
    const mv = moved.exec(text);
    if (mv) {
      const to = mv[1];
      const found = claims(to) ? leaseOfMove(text, id, to) : {};
      const model = found.model || null;
      return { type: 'move', from, to, lease: found.worker ? { worker: found.worker, model, branch: found.branch || null } : null, model, ...(found.handover ? { handover: true, branch: found.branch || null } : {}) };
    }
    if (text.startsWith(`${id} round `)) {
      const st = ROUND_STANDING_LINE.exec(text);
      return st ? { type: 'round', standing: { takeover: st[1] === 'takeover', count: Number(st[2]), limit: Number(st[3]) } } : { type: 'round' };
    }
    const r = REVIEW_LINE.exec(text);
    if (r) {
      const rest = text.slice(r[0].length);
      const mm = /^model (.+?) · /.exec(rest);
      return { type: 'verdict', verdict: r[1], by: r[2] || null, kind: r[3] || null, model: mm ? mm[1] : null, relayed: /^relayed · /.test(mm ? rest.slice(mm[0].length) : rest) };
    }
    if (text.startsWith(`${id} review retract`) && !/^\w/.test(text.slice(`${id} review retract`.length))) return { type: 'retract-review', target: retractTarget(text) };
    const rr = RETRACT_ROW_LINE.exec(text);
    if (rr) return { type: 'retract-row', row: Number(rr[1]) };
    const rn = RETRACT_NOTE_LINE.exec(text);
    if (rn) return { type: 'retract-note', note: Number(rn[1]) };
    if (text.startsWith(`${id} evidence row · `)) {
      const attach = attachmentOf(text.slice(`${id} evidence row · `.length));
      return attach ? { type: 'row', attach } : { type: 'row' };
    }
    if (text.startsWith(`${id} merged `)) {
      const line = mergeLineOf(id, text);
      if (line) return { type: 'merged', ...line };
    }
    const tp = TIP_LINE.exec(text);
    if (tp) return { type: 'tip', tip: tp[1] };
    if (text.startsWith(`${id} CI `) && CI_STATES.includes(text.slice(`${id} CI `.length))) return { type: 'ci', state: text.slice(`${id} CI `.length) };
    if (text.startsWith(`${id} body · `)) return { type: 'body' };
    const tk = TICK_LINE.exec(text);
    if (tk) return { type: 'tick', line: Number(tk[1]), by: tk[2], ownerLine: tk[3] };
    return { type: 'other' };
  };
}

// The command that writes each kind of line that carries state: what the free log refuses to write in its place.
const LINE_WRITERS = {
  filed: 'jarl.mjs new', move: 'jarl.mjs set "<ids>" "<status>"', round: 'jarl.mjs round "<id>"', verdict: 'jarl.mjs review "<id>" "<verdict>"',
  'retract-review': 'jarl.mjs retract "<id>" review', 'retract-row': 'jarl.mjs retract "<id>" "<n>"', 'retract-note': 'jarl.mjs retract "<id>" "<n|note-n>"', row: 'jarl.mjs evidence "<id>" --ran "<command>" --saw "<what-it-printed>"',
  merged: 'jarl.mjs merged "<id>" --sha "<sha>"', ci: 'jarl.mjs merged "<id>" --ci "<ci-state>"', body: 'jarl.mjs field "<id>" "<part>" "<value>"', tick: 'jarl.mjs tick "<id>" "<line>" --by owner',
  tip: 'jarl.mjs evidence, review or merged, which write the tip of the branch after their own line',
};
// The form of the command that writes each kind of line, the last line of a refusal of that line given to log.
const LINE_CALLS = {
  filed: () => ['new', hole('<title>')], move: (ids) => ['set', ids, hole('<status>'), hole('<why>')], round: (id) => ['round', id, hole('<what-failed>')],
  verdict: (id) => ['review', id, hole('<verdict>'), hole('<findings-with-a-severity>'), '--by', hole('<reviewer>')],
  'retract-review': (id) => ['retract', id, 'review', hole('<why>'), '--by', hole('<who>')], 'retract-row': (id) => ['retract', id, hole('<n>'), hole('<why>'), '--by', hole('<who>')],
  'retract-note': (id) => ['retract', id, hole('<n|note-n>'), hole('<why>'), '--by', hole('<who>')], row: (id) => ['evidence', id, '--ran', hole('<command>'), '--saw', hole('<what-it-printed>')],
  merged: (id) => ['merged', id, '--sha', hole('<sha>')], ci: (id) => ['merged', id, '--ci', hole('<ci-state>')], body: (id) => ['field', id, hole('<part>'), hole('<value>')],
  tick: (id) => ['tick', id, hole('<line>'), '--by', hole('<the-owner-himself>')], tip: (id) => ['evidence', id, '--ran', hole('<command>'), '--saw', hole('<what-it-printed>')],
};
const MOVE_SHAPE = idRe('^{id} →');
// A free line for the journal (the log command and record.appendLog): a note about the loop or an issue. A line that
// reads as one of the kinds above (a filing, a move, a round, a verdict, a retraction, a row, a merge, a CI state, a body
// change or a tick) is refused and names the command that writes it, so every line the views and the gate read as state was
// written by the command that owns it, with that command's checks.
export function appendNote(root, event) {
  needNoOwnersWords('the note', event);
  const text = oneLine(event);
  const id = LEADING_ID.exec(text)?.[1] ?? null;
  need(!MOVE_SHAPE.test(text), `log writes a note, and "${text.length > 80 ? `${text.slice(0, 77)}...` : text}" has the shape of a move (an id, an arrow), which set writes: ${LINE_WRITERS.move} "<text>"`, () => ['jarl.mjs', ...LINE_CALLS.move(hole('<ids>'))]);
  const type = id === null ? 'other' : parseEvent(id, text, loadProfile(root)).type;
  need(type === 'other', `log writes a note, and "${text.length > 80 ? `${text.slice(0, 77)}...` : text}" reads as ${type === 'filed' ? 'a filing' : `a ${type.replace('-', ' ')} line`}, which the journal's own command writes with its checks: ${type === 'row' && attachmentOf(text.slice(`${id} evidence row · `.length)) ? 'jarl.mjs evidence "<id>" --file "<path>" --slot "<name>"' : LINE_WRITERS[type]}`, () => ['jarl.mjs', ...LINE_CALLS[type](hole('<id>'))]);
  appendLog(root, event);
}

// Writes the repository after "in" of every merge line of the log as `fn(value)` gives it, the rest of the line as it was;
// nothing is written when no line changes. Only the raise of the record format calls it.
// Only a line the tool itself writes for a merge is touched: the id of an issue of the loop first, the sha, the repository,
// then only the fixed segments (check, saw, landed red, CI) in the order merged writes them. Any other line is left as it is.
const MERGE_REPO_PART = idRe('^({id}) merged ([0-9a-f]{4,64}) in ([^\\n]+?)((?: · check [^\\n]*?)?(?: · saw [^\\n]*?)?(?: · landed red, cause \\S+)?(?: · CI (?:pending|green|red|none))?)$');
export function mapMergeRepos(root, fn) {
  const path = logPath(jarlDir(root));
  if (!existsSync(path)) return;
  const log = readText(path);
  const held = issueForms(jarlDir(root));
  const next = log.split('\n').map((l) => {
    const m = LOG_LINE.exec(l);
    const p = m && MERGE_REPO_PART.exec(m[4]);
    return p && held.has(idKey(p[1])) && !p[3].includes(' · ') ?`- ${m[1]}${m[2] ? ` key ${m[2]}` : ''}${m[3] ? ` by ${m[3]}` : ''} · ${p[1]} merged ${p[2]} in ${fn(p[3])}${p[4]}` : l;
  }).join('\n');
  if (next !== log) writeAtomic(path, next);
}

// Every dated line of the loop's log under `dir` (the directory holding the goal, the log and issues/), in order, as
// typed events. An issue's events carry the status it moved from, replayed from its own filing and moves. With `skipped`
// (an array), each line the reader does not place is pushed onto it as { n, text, reason }, n the line's number: a line
// that is not dated, and a line that reads as one of the kinds the log writes and parses as none of them (see unplaced).
// Each event carries `written`, the number as its line writes it, and `key`, the key the line names (null for none). A
// line with a key is about the issue whose file carries that key, whatever number it was written under, and its id is
// that issue's; a line with no key, or with a key no file carries, is about the issue its number names. `keys` (a Map of
// key to the written id of the file that carries it) is read from the issue files when not handed in.
export function loopEvents(dir, profile, skipped, keys) {
  const path = logPath(dir);
  if (!existsSync(path)) return [];
  const parse = eventParser(profile);
  const lastStatus = new Map();
  const events = [];
  const forms = issueForms(dir);
  const log = readText(path);
  const keyed = keys ?? (profile.keyed !== false && KEYED_LINE.test(log) ? issueKeysAt(dir) : new Map());
  log.split('\n').forEach((l, n) => {
    const m = LOG_LINE.exec(l);
    if (!m) {
      if (skipped && l.trim() !== '' && !l.startsWith('#')) skipped.push({ n: n + 1, text: l, reason: 'not a dated line: a line of the log is "- yyyy-mm-dd hh:mm · <text>"' });
      return;
    }
    // A line names its issue as it was written; the event carries the issue's own form, so it meets its issue's id.
    const [, at, key = null, writer = null, text] = m;
    const written = LEADING_ID.exec(text)?.[1] ?? null;
    const id = written === null ? null : (key !== null && keyed.has(key) ? keyed.get(key) : writtenId(written, forms));
    // The status a move comes from is the one the same issue's lines left: by its key where the line names one.
    const thread = key ?? id;
    const body = id === null ? { type: 'other' } : parse(written, text, lastStatus.get(thread) ?? null);
    if (skipped && written !== null) { const why = unplaced(profile, written, text, body); if (why) skipped.push({ n: n + 1, text: l, reason: why }); }
    // A line the tool never writes with a strike-through: the reader takes it for a note, and a strike-through voids nothing.
    if (skipped && /^~~/.test(text)) skipped.push({ n: n + 1, text: l, reason: 'a struck-through line: the reader takes it for a note, and a strike-through retracts nothing (a verdict is retracted with retract <id> review, an evidence row with retract <id> <n>)' });
    if (body.type === 'filed') { if (!lastStatus.has(thread)) lastStatus.set(thread, profile.initial); }
    else if (body.type === 'move') lastStatus.set(thread, body.to);
    events.push({ n, at, text, writer, key, id, written, ...body });
  });
  return events;
}
// Whether a log holds a line with a key: only then are the issue files read for their keys.
const KEYED_LINE = new RegExp(`^- ${STAMP_SRC} key ${KEY_SRC} `, 'm');
// The keys the issue files under `dir` (the directory holding issues/) carry, each to the written id of its file. A key
// two files carry names neither: it is left out, and their lines are read by number.
export function issueKeysAt(dir) {
  const d = join(dir, 'issues');
  const out = new Map();
  const twice = new Set();
  for (const f of existsSync(d) ? readdirSync(d) : []) {
    const m = ISSUE_FILE_RE.exec(f);
    const key = m ? headerKey(readText(join(d, f))) : null;
    if (key === null) continue;
    if (out.has(key)) twice.add(key);
    out.set(key, m[1]);
  }
  for (const k of twice) out.delete(k);
  return out;
}
// Why a dated line of an issue is not placed, or null when it is: a line that reads as one of the kinds the log writes
// (a review, a merge, a CI state, a body change, an evidence row or retraction, a tick) and that the parser placed as none of
// them; a move into a status that holds the claim whose worker or model does not parse; a verdict whose model mark does not.
const LOG_KIND = /^(review|merged|CI|body|evidence (?:row|retract)|tick(?= · ))\b/;
function unplaced(profile, written, text, body) {
  const rest = text.slice(written.length + 1);
  if (body.type === 'other') {
    const kind = LOG_KIND.exec(rest);
    return kind ? `reads as a "${kind[1]}" line of the log, and that line's grammar is not met` : null;
  }
  if (body.type === 'move' && profile.is(body.to, 'holds-claim') && !body.lease && !body.model && / · (worker|model) /.test(text)) {
    return 'the lease fields of the move do not parse: a worker and a model are one name each, written once, in the order branch, model, worker, worktree';
  }
  // The model mark sits right after the reviewer, where the parser reads it: a word of the findings that reads as a mark is text.
  const head = REVIEW_LINE.exec(text);
  if (body.type === 'verdict' && body.model === null && head && /^model /.test(text.slice(head[0].length))) return 'the model mark of the verdict does not parse: it is "model <name> · " after the reviewer';
  return null;
}
// The events of the issues, by the issue each line is about.
export function eventsById(events) {
  const map = new Map();
  for (const e of events) {
    if (e.id === null) continue;
    if (!map.has(e.id)) map.set(e.id, []);
    map.get(e.id).push(e);
  }
  return map;
}
// The journal as the done gate and the views read it: the events by issue.
export function journalById(root) {
  return eventsById(loopEvents(jarlDir(root), loadProfile(root)));
}

// The state an issue's own lines say, the one every view and the gate read: its status, its lease (branch, worker, model,
// since), the merge it records and that merge's CI state, folded over the issue's events in file order, as the
// commands that write the lines write the header beside them. A move into a status that holds the claim stamps `since`
// with the line's stamp, replaces the branch when the line names one, replaces the worker when it names one (and then
// the model with the line's own, or none), and replaces the model alone when only a model is named; a move into any
// other status removes the worker, the model and `since`, and keeps the branch. A merge line replaces the merge and
// takes its CI state (none when it names none); a CI line replaces the CI state alone. Null for an issue the
// journal holds no filing and no move of: its header is all there is to read.
export function issueState(profile, events) {
  const s = { status: null, branch: null, worker: null, model: null, since: null, merged: null, 'merge check': null, ci: null };
  let held = false;
  for (const e of events) {
    if (e.type === 'filed') { if (!held) { held = true; s.status = profile.initial; } continue; }
    if (e.type === 'move') {
      held = true; s.status = e.to;
      if (profile.is(e.to, 'holds-claim')) {
        s.since = e.at;
        const branch = leaseOfMove(e.text, e.written ?? e.id, e.to).branch;
        if (branch) s.branch = branch;
        if (e.lease) { s.worker = e.lease.worker; s.model = e.model; } else if (e.model) s.model = e.model;
      } else { s.worker = null; s.model = null; s.since = null; }
      continue;
    }
    if (e.type === 'merged') { s.merged = e.repo ? `${e.sha} in ${e.repo}` : e.sha; s['merge check'] = mergeCheckText(e.check, e.saw); s.ci = e.ci; continue; }
    if (e.type === 'ci') s.ci = e.state;
  }
  return held ? s : null;
}

const REVIEW_LINE = idRe('^{id} review (approve|changes) · (?:by (.+?) \\((fresh|coordinator|self)\\) · )?');

// A journal line that moves an issue into one of the statuses named: `NNN → <status>`, the status followed by the end
// of the line or a space. Longest names first, so no status is read as a shorter one.
function movesInto(statuses) {
  const names = [...statuses].sort((a, b) => b.length - a.length);
  return idRe(`^{id} → (${names.join('|')})(?= |$)`);
}

// The merge a log line records: `<id> merged <sha>[ in <repo>]`, then the fields it names in any order — `check <what
// ran>` for a merge landed on a passing check, `saw <what-it-printed>` after it, `landed red, cause <id>` for one landed
// while its check was red for a cause outside the branch, and `CI <state>`. Null for any other line.
export function mergeLineOf(id, text) {
  const parts = text.split(' · ');
  const head = new RegExp(`^${id} merged (\\S+)(?: in (.+))?$`).exec(parts[0]);
  if (!head) return null;
  const line = { sha: head[1], repo: head[2] || null, check: null, red: null, ci: null };
  for (const p of parts.slice(1)) {
    let m;
    if ((m = /^check (.+)$/.exec(p))) line.check = m[1];
    else if ((m = /^saw (.+)$/.exec(p)) && line.check !== null) line.saw = m[1];
    else if ((m = /^landed red, cause (\S+)$/.exec(p))) line.red = m[1];
    else if ((m = /^CI (pending|green|red|none)$/.exec(p))) line.ci = m[1];
  }
  return line;
}

// The Merge check field of an issue: the check a merge line names and what it printed, as one line. Null when the merge
// names no check. The field is rendered from the merge line, like Merged and CI.
function mergeCheckText(check, saw) { return check ? (saw ? `${check} · saw ${saw}` : check) : null; }

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { mergeCheckText };
