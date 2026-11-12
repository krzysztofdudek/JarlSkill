// The journal and the decisions: the loop's files, the log lines written, the rulings, the goal and the questions file.

import { existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fieldText, hole, jarlLine, need, noSeparators, oneBreak, refuse, splitList } from './base.mjs';
import { issuesDir, jarlDir, stamp, today } from './where.mjs';
import { appendAtomic, readText, writeAtomic } from './files.mjs';
import { ISSUE_FILE_RE, KEY_RE, idKey, idRe, issueForms, writtenId } from './ids.mjs';
import { loadProfile } from './profile.mjs';
import { OWNER, carryingOwnersWords, needNoOwnersWords, quoteLine, quoteOf, rulingAuthor, underLine, underOf } from './owner.mjs';

// ---- journal and decisions ----------------------------------------------------------------------

// The files of the record held in `dir`, named here and nowhere else. Only appendLogLines writes the log and only
// loopEvents reads it; the goal is read by goalLines, the decisions by decisionsAt and the questions by asksAt.
const LOG_FILE = 'log.md';
const GOAL_FILE = 'goal.md';
const DECISIONS_FILE = 'decisions.md';
const ASKS_FILE = 'asks.md';
// A journal stamp, as the log and the loop's other dated lines write it: YYYY-MM-DD HH:MM (UTC).
const STAMP_SRC = '\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}';
export function logPath(dir) { return join(dir, LOG_FILE); }
// A stamp in milliseconds; null for a text that is no stamp.
function parseStamp(s) {
  const m = new RegExp(`^(\\d{4}-\\d{2}-\\d{2}) (\\d{2}:\\d{2})$`).exec(String(s || '').trim());
  return m ? Date.parse(`${m[1]}T${m[2]}:00Z`) : null;
}
function goalPath(dir) { return join(dir, GOAL_FILE); }
// The format of the record: one machine line of goal.md, written by init and by nothing else. A loop that holds exactly this
// line is read; a loop with another number, with no such line or with two is refused before anything else is read. There
// is one format, this one, and one way to it from the format before: an agent follows CONVERSION_FILE, in the skill.
export const RECORD_FORMAT = 4;
// The writer a line carries when nobody named one: a library call that gave none, and the lines a conversion carries over
// from a record that kept no writer. It is never a name a call may give.
export const UNRECORDED = 'unrecorded';
export const FORMAT_MARK = `Format: ${RECORD_FORMAT}`;
export const CONVERSION_FILE = 'references/converting-from-6-2.md';
const FORMAT_LINE_RE = /^Format:(.*)$/;
const formatLinesOf = (text) => text.split(/\r?\n/).filter((l) => FORMAT_LINE_RE.test(l));
// Whether a text holds a line a reader of the goal takes for the format line.
export const holdsFormatLine = (text) => formatLinesOf(String(text ?? '')).length > 0;
// The refusal of a loop in any other format. A place with no live loop has no format to refuse.
export function needRecordFormat(root, whose = 'this loop\'s') {
  const path = goalPath(jarlDir(root));
  if (!existsSync(path)) return;
  const lines = formatLinesOf(readText(path));
  if (lines.length === 1 && lines[0].trimEnd() === FORMAT_MARK) return;
  const held = lines.length === 0 ? `holds no "Format:" line` : lines.length > 1 ? `holds ${lines.length} "Format:" lines` : `says "${lines[0].trim()}"`;
  refuse(`${whose} ${GOAL_FILE} ${held}, and this Jarl reads a loop whose ${GOAL_FILE} holds the one line "${FORMAT_MARK}" — nothing was read or written; an agent converts a loop of the format before by following ${CONVERSION_FILE}`, { external: `follow ${CONVERSION_FILE}, in the directory of the skill` });
}
function decisionsPath(dir) { return join(dir, DECISIONS_FILE); }
function asksPath(dir) { return join(dir, ASKS_FILE); }
export function appendLog(root, event) {
  appendLogLines(root, [event]);
}
// A whole-file write for a library caller (record.writeAtomic): any file but the loop's journal, which is appended to and
// never written whole, so no line of it is replaced or dropped behind the record's back.
export function writeWhole(path, text) {
  const dir = dirname(path);
  need(!(basename(path).toLowerCase() === LOG_FILE.toLowerCase() && (existsSync(join(dir, 'issues')) || existsSync(goalPath(dir)))), `${path} is the loop's journal: it is appended to (record.appendLog), never written whole`, () => (['jarl.mjs', 'log', '<text>']));
  writeAtomic(path, text);
}
// Several lines in one write: a bulk command's lines land together or not at all. A command that writes the same
// moment into a header field takes the stamp once and passes it as `at`, so the two cannot fall in two minutes.
// An event is the line's text, or { text, key } for a line that names its issue's key itself (the filing, written before
// the issue's file exists), or a tip line as tipLine makes it. A line about an issue whose file carries a key is written
// with that key, in its fixed place right after the stamp and before the writer: `- <stamp> key <key> by <writer> ·
// <text>`. A tip line carries the tip mark after the key and before the writer. No text reaches either place. Every line
// names its writer: the call's --by, or `unrecorded` for a library call that named nobody.
export function appendLogLines(root, events, at = stamp()) {
  const by = callWriter ? callWriter.name : UNRECORDED;
  const keyOf = lineKeys(root, events);
  appendAtomic(logPath(jarlDir(root)), '# Log\n\n', events.map((e) => {
    const text = oneLine(typeof e === 'string' ? e : e.text);
    const key = typeof e === 'string' || e.key === undefined ? keyOf(text) : e.key;
    return `- ${at}${key ? ` key ${key}` : ''}${typeof e !== 'string' && e.tip === true ? ` ${TIP_MARK}` : ''} by ${by} · ${text}\n`;
  }).join(''));
}
// The tip mark: the word a tip line carries before the separator, where no text of a line reaches. Only the write of a
// row, a verdict, a merge or a close puts it there, through tipLine, and a log command that writes `- <stamp> · <text>`
// cannot, so the reader counts a tip line only with it.
export const TIP_MARK = 'tip';
// The tip line of an issue: the commit its branch points to in each repository of the issue, joined by commas.
export const tipLine = (id, tip) => ({ text: `${id} tip ${tip}`, tip: true });
// The key each line of `events` is about, read from its issue's file: a line that opens with an issue's number (after
// "filed", for a filing) takes the key of the one issue file of that number, when that file carries one. A number two
// files carry names no one issue, and its line is written with no key.
const LEADING_ISSUE = idRe('^(?:filed )?({id})\\b');
function lineKeys(root, events) {
  const wanted = new Set(events.filter((e) => typeof e === 'string' || e.key === undefined).map((e) => LEADING_ISSUE.exec(oneLine(typeof e === 'string' ? e : e.text))?.[1]).filter(Boolean).map(idKey));
  const none = () => null;
  if (!wanted.size) return none;
  const dir = join(jarlDir(root), 'issues');
  if (!existsSync(dir)) return none;
  const keys = new Map();
  for (const f of readdirSync(dir)) {
    const m = ISSUE_FILE_RE.exec(f);
    if (!m || !wanted.has(idKey(m[1]))) continue;
    keys.set(idKey(m[1]), [...(keys.get(idKey(m[1])) || []), headerKey(readText(join(dir, f)))]);
  }
  return (text) => {
    const n = LEADING_ISSUE.exec(text)?.[1];
    const found = n === undefined ? [] : keys.get(idKey(n)) || [];
    return found.length === 1 ? found[0] : null;
  };
}
// The key an issue's header carries, or null: a Key field of the header (before the first section) in the key's grammar.
export function headerKey(text) {
  for (const line of String(text).split('\n').slice(1)) {
    if (line.startsWith('## ')) break;
    const m = /^\*\*Key:\*\*\s*(\S+)\s*$/i.exec(line);
    if (m) return KEY_RE.test(m[1]) ? m[1] : null;
  }
  return null;
}
// The writer one call names (its --by), for every line the call writes: withWriter sets it for the length of `fn` and
// puts back what was there, so nothing outlives the call and a server that runs call after call keeps no name of its own.
let callWriter = null;
export function withWriter(name, fn) {
  const was = callWriter;
  callWriter = name ? { name } : null;
  try { return fn(); } finally { callWriter = was; }
}

// The log is one event per line: a text with line breaks never reaches it raw. A command that keeps the whole text
// elsewhere writes its first line and a pointer (firstLine); any other text that gets here has its lines joined by
// " ⏎ ", so nothing is cut.
function oneLine(event) {
  return String(event).replace(/\r\n?/g, '\n').trim().split('\n').map((l) => l.trim()).filter(Boolean).join(' ⏎ ');
}
// The first line of a text, and when there are more, how many and where the whole is kept.
const moreLines = (n, where) => ` (+${n} more lines, whole text in ${where})`;
export function firstLine(text, where) {
  const lines = String(text).replace(/\r\n?/g, '\n').trim().split('\n');
  const first = lines[0].trim();
  return lines.length > 1 ? `${first}${moreLines(lines.length - 1, where)}` : first;
}
// What firstLine wrote can have been read from: the first line of a text of one line, the logged words whole; and, when
// they end with the pointer firstLine adds, the first line of a text of more lines, the words before it. A text of one
// line can end with the pointer's words itself, so both readings stand.
export function firstLineReadings(logged, where) {
  const text = String(logged);
  const m = new RegExp(` \\(\\+([1-9]\\d*) more lines, whole text in ${String(where).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)$`).exec(text);
  const pointer = m && moreLines(Number(m[1]), where) === m[0];
  return [{ first: text, more: false }, ...(pointer ? [{ first: text.slice(0, m.index), more: true }] : [])];
}

// A ruling's slug names it for good: letters, digits, and . _ - inside, at most 80 characters. It is compared
// as a string, never read as a pattern, so `q.r` and `qxr` are two slugs and a slug with any character in it
// cannot break the reading.
export const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const DECISION_HEAD = /^## (\d{4}-\d{2}-\d{2}) · (.+?)\s*$/;

// The decisions read back: one entry per `## <date> · <slug>` heading, with its ruling, who ruled (**By:**, none
// on a ruling that records no author), what it supersedes and what superseded it.
export function loadDecisions(root, skipped) { return decisionsAt(jarlDir(root), skipped); }
// The rulings of the record held in `dir`. With `skipped` (an array), each line that is neither a ruling heading, a line
// of a ruling, the title nor blank is pushed onto it as { n, text, reason }: text before the first ruling, a "## " heading
// that is not a ruling's, and a ruling whose slug a ruling above it already holds.
function decisionsAt(dir, skipped) {
  const path = decisionsPath(dir);
  if (!existsSync(path)) return [];
  const out = [];
  const slugs = new Set();
  readText(path).split('\n').forEach((line, i) => {
    const h = DECISION_HEAD.exec(line);
    if (h) {
      if (skipped && slugs.has(h[2])) skipped.push({ n: i + 1, text: line, reason: `the slug ${h[2]} is ruled twice: a ruling's slug names one ruling` });
      slugs.add(h[2]);
      out.push({ date: h[1], slug: h[2], body: [] });
      return;
    }
    if (skipped && /^## /.test(line)) skipped.push({ n: i + 1, text: line, reason: 'a ruling heading does not parse: it is "## <yyyy-mm-dd> · <slug>"' });
    else if (skipped && !out.length && line.trim() !== '' && !line.startsWith('# ')) skipped.push({ n: i + 1, text: line, reason: 'text before the first ruling: a ruling starts with "## <yyyy-mm-dd> · <slug>"' });
    if (out.length) out[out.length - 1].body.push(line);
  });
  // A ruling's own fields (By, Supersedes, Superseded by, Settles) are the block the tool writes at the end of its
  // section — the trailing lines that are such a field or blank. A line of the ruling's text that happens to start
  // with **By:** is text.
  const META = DECISION_META;
  const read = out.map((d) => {
    let cut = d.body.length;
    while (cut > 0 && (d.body[cut - 1].trim() === '' || META.test(d.body[cut - 1]))) cut -= 1;
    const meta = d.body.slice(cut).map((l) => META.exec(l)).filter(Boolean);
    const field = (name) => meta.filter((m) => m[1] === name).map((m) => m[2].trim());
    // The ruling's text: a line indented two spaces is a continuation line of its free text, read without the indent.
    const ruling = d.body.slice(0, cut).map((l) => (l.startsWith('  ') ? l.slice(2) : l)).join('\n').trim();
    // A withdrawal is a Superseded by line of its own, `(withdrawn) <by> (<date>) · by <who> · <why>`: a field every reader
    // places, so a reader that does not know withdrawals keeps the ruling's closing block whole, and reads the ruling as superseded.
    const marks = field('Superseded by');
    const withdrawn = marks.filter((v) => v.startsWith(WITHDRAWN)).map((v) => v.slice(WITHDRAWN.length).split(/\s/)[0]);
    const sup = marks.filter((v) => !v.startsWith(WITHDRAWN) && !withdrawn.includes(v.split(/\s/)[0])).pop();
    const reach = field('Reach').pop();
    const typeLog = /^(\S+) · (\S+)/.exec(field('Type log').pop() || '');
    const ruleLog = /^(\S+) · (\S+)/.exec(field('Rule log').pop() || '');
    const first = (name) => (field(name).pop() || '').split(/\s/)[0] || null;
    return {
      withdrawn, date: d.date, slug: d.slug, ruling, quote: field('By').pop() === OWNER ? quoteOf(d.body.slice(0, cut)) : null, under: field('By').pop() === OWNER ? null : underOf(d.body.slice(0, cut)), by: field('By').pop() || null, supersedes: field('Supersedes').pop() || null, supersededBy: sup ? sup.split(/\s/)[0] : null, settles: splitList(field('Settles').pop()),
      ...(field('Waives review').length ? { waives: splitList(field('Waives review').pop()) } : {}), appliesTo: field('Applies to').pop() || null, area: field('Area').pop() || null, reach: reach !== undefined && /^\d+$/.test(reach) ? Number(reach) : null, rule: field('Rule').pop() || null,
      ratified: first('Ratified'), rejected: first('Rejected'), typeLog: typeLog ? { type: typeLog[1], datetime: typeLog[2] } : null,
      ruleLog: ruleLog ? { rule: ruleLog[1], datetime: ruleLog[2] } : null,
    };
  });
  // A ruling names the rulings it supersedes as it wrote them; one whose supersession was withdrawn is not one it supersedes now.
  const gone = new Set(read.flatMap((d) => d.withdrawn.map((by) => `${d.slug}\n${by}`)));
  return read.map(({ withdrawn, ...d }) => {
    if (d.supersedes === null || !gone.size) return d;
    const kept = splitList(d.supersedes).filter((x) => !gone.has(`${x}\n${d.slug}`));
    return { ...d, supersedes: kept.length ? kept.join(', ') : null };
  });
}
// The words that open the value of a Superseded by line that takes a supersession back; no slug starts with a parenthesis.
export const WITHDRAWN = '(withdrawn) ';
// The fields the tool writes into a ruling's closing block. Applies to, Area, Reach and Rule come with the ruling (decide
// --applies-to, --area, --reach, --rule); Superseded by, Ratified, Rejected, Type log and Rule log are added to an earlier
// ruling in place, later. Applies to is the block's first line, after Waives review. Waives review
// (decide --waives-review, the issues a ruling of the owner closes without a review) comes first of all.
const DECISION_META = /^\*\*(Waives review|Applies to|By|Supersedes|Superseded by|Settles|Area|Reach|Rule|Ratified|Rejected|Type log|Rule log):\*\*\s*(.*)$/;
// The answer line of an answered question's ruling (ask-<n>): the answer itself, the option chosen, or the answer in its own words.
const ANSWER_LINE = /^\*\*(?:Answer|Answer in own words|Chose):\*\*/;
// The answer line and the question line of an answered question's ruling, as the ruling holds them. Resume and decisions
// list such a ruling by its answer first and the question after; any other ruling is listed by its first line alone, so
// this returns null for it.
export function answeredLines(d) {
  const lines = d.ruling.split('\n').map((l) => l.trim());
  if (!/^ask-\d+$/.test(d.slug) || !lines[0].startsWith('**Question:**')) return null;
  const answer = lines.find((l) => ANSWER_LINE.test(l));
  return answer ? { answer, question: lines[0] } : null;
}

// A field line added at the end of one ruling's own section, by lines: the text is never read as a pattern.
// Given `text` (the decisions as they will be written), it returns the marked text and writes nothing; without it, it marks
// the decisions of the loop in `root` and writes them once.
function markDecision(root, slug, line, { text: given } = {}) {
  const path = decisionsPath(jarlDir(root));
  const lines = (given ?? readText(path)).split('\n');
  const at = lines.findIndex((l) => { const h = DECISION_HEAD.exec(l); return h && h[2] === slug; });
  need(at !== -1, `no ruling ${slug} in ${DECISIONS_FILE}`, () => ({ replace: slug, value: '<a-ruling>' }));
  let end = lines.findIndex((l, n) => n > at && l.startsWith('## '));
  if (end === -1) end = lines.length;
  while (end - 1 > at && lines[end - 1].trim() === '') end -= 1;
  lines.splice(end, 0, line);
  if (given !== undefined) return lines.join('\n');
  writeAtomic(path, lines.join('\n'));
  return undefined;
}

// The slugs a --supersedes names, in the order given, each once: one slug, a comma list or the flag repeated. Null where none
// is given.
export function supersedesList(raw) {
  if (raw === undefined || raw === null) return null;
  const items = [].concat(raw).flatMap((v) => (typeof v === 'string' ? splitList(v) : [v]));
  return [...new Set(items)];
}
// The refusals of a new ruling's slug and of the earlier rulings it supersedes, which write nothing. appendDecision asks
// them before it writes.
export function needNewRuling(root, slug, supersedes) {
  need(typeof slug === 'string' && SLUG_RE.test(slug), `a ruling's slug is letters, digits and . _ - (starting with a letter or digit, at most 80 characters) — not "${slug}"`, () => ({ arg: 0, value: '<slug>' }));
  const all = loadDecisions(root);
  need(!all.some((d) => d.slug === slug), `duplicate slug: ${slug} — a ruling that replaces it takes a new slug and --supersedes ${slug}`, () => ({ arg: 0, value: hole('<a-new-slug>') }));
  const list = supersedesList(supersedes);
  if (list === null) return;
  need(list.length > 0 && list.every((x) => typeof x === 'string' && SLUG_RE.test(x) && x !== slug), '--supersedes names the slug of an earlier ruling, or several of them', () => ({ flag: '--supersedes', value: '<slug>' }));
  // A refusal of a list says which of the slugs given are fine, since its form holds a placeholder for each value.
  const fine = list.filter((x) => all.some((d) => d.slug === x && !d.supersededBy));
  const others = list.length > 1 ? ` (of the ${list.length} slugs given, ${fine.length ? `${fine.join(', ')} ${fine.length === 1 ? 'is a ruling' : 'are rulings'} in force` : 'none is a ruling in force'}; nothing was written)` : '';
  for (const target of list) {
    const old = all.find((d) => d.slug === target);
    need(old, `no ruling ${target} in ${DECISIONS_FILE} to supersede${others} — the rulings: ${jarlLine('decisions')}`, () => ({ flag: '--supersedes', value: '<a-ruling-in-force>' }));
    need(!old.supersededBy, `${target} is already superseded by ${old.supersededBy}${others} — supersede that one instead`, () => ({ flag: '--supersedes', value: hole('<a-ruling-in-force>') }));
  }
}

// The ruling is written as its caller gives it: structure at the start of a line, free text indented (freeInline, freeBlock).
// The owner's words (quote, on a ruling by the owner only) are its last line, after a blank one, at the left edge: the one
// line of a ruling no text given to decide can stand on (owner.mjs, quoteOf). The ruling it rests on (under, on a ruling
// by anyone but the owner) is the paragraph before, in the same form and for the same reason (owner.mjs, underOf).
export function appendDecision(root, slug, ruling, { by: given, quote, under, supersedes, area, reach, rule, settles, appliesTo, waives } = {}) {
  // The author is the one name the owner has when it reads as his, whoever calls: a name that holds his inside another is refused.
  const by = given === undefined || given === null ? given : rulingAuthor(given);
  need(under === undefined || under === null || (typeof under === 'string' && SLUG_RE.test(under) && by !== OWNER), 'the ruling a ruling rests on is the slug of a ruling, and a ruling by the owner rests on his own words', () => ({ flag: '--under', value: '<a-ruling-in-force>' }));
  need(quote === undefined || quote === null || (typeof quote === 'string' && quote === fieldText(quote) && quote !== '' && by === OWNER), 'the owner\'s words are one line of text, kept with a ruling by the owner', () => ({ flag: '--quote', value: '<his-own-words>' }));
  if (quote) needNoOwnersWords('--quote', quote);
  needNewRuling(root, slug, supersedes);
  const path = decisionsPath(jarlDir(root));
  const existing = existsSync(path) ? readText(path) : '# Decisions\n';
  let text = existing;
  const superseded = supersedesList(supersedes) ?? [];
  for (const target of superseded) text = markDecision(root, target, `**Superseded by:** ${slug} (${today()})`, { text });
  const meta = [waives?.length ? `**Waives review:** ${waives.join(', ')}` : null, appliesTo ? `**Applies to:** ${fieldText(appliesTo)}` : null, settles?.length ? `**Settles:** ${settles.join(', ')}` : null, by ? `**By:** ${fieldText(by)}` : null, superseded.length ? `**Supersedes:** ${superseded.join(', ')}` : null, area ? `**Area:** ${area}` : null, reach !== undefined && reach !== null ? `**Reach:** ${reach}` : null, rule ? `**Rule:** ${rule}` : null].filter(Boolean).join('\n');
  const body = `${ruling.replace(/\s+$/, '')}${under ? `\n\n${underLine(under)}` : ''}${quote ? `\n\n${quoteLine(quote)}` : ''}`;
  carryingOwnersWords([quote && { text: quoteLine(quote), before: /^$/, after: /^$/ }], () => writeAtomic(path, `${text.replace(/\s*$/, '')}\n\n## ${today()} · ${slug}\n${body}\n${meta ? `\n${meta}\n` : ''}`));
}

// The goal of the record held in `dir`, as text; null when it has none.
function readGoal(dir) {
  const path = goalPath(dir);
  return existsSync(path) ? readText(path) : null;
}
// The one grammar of a line the goal carries for the tool: `Check: <what runs>`, `Check (<repository>): <what runs>`,
// `Model (<tier>): <model>[, <model>…]`, `Coordinators: <name>[, <name>…]`, `Takeover: <rounds>` and
// `Takeover (<kind>): <rounds>`, each as a plain line, a list item, or in bold. goalLines reads them all in one pass, so
// no other reader of the goal repeats the pattern. It returns
//   goal           the first line of the goal, or null where the loop has none
//   checks         every command the goal names, the loop's own first
//   checksByRepo   { bare: the loop's own commands, repos: { <repository>: its commands } }
//   models         [{ tier, models }] in the order written, `tier` as written
//   coordinators   the names written on Coordinators lines
//   takeovers      { bare: the rounds of the bare line or null, kinds: { <kind in lower case>: its rounds } }; the last line
//                  written for a kind or for the bare line stands
//   liveness       the minutes of the `Liveness: <minutes>` line after which a lease or a proof with no activity is idle,
//                  or null; the last line written stands
//   ranges         [{ name, from, to }], the numbers of each `Range (<name>): <from-to>` line, a series new --range files
//                  in; the first line of a name stands, and a range that shares a number with one above it is not placed
const GOAL_LINE = /^\s*(?:[-*]\s+)?(?:\*\*)?(coordinators|merger|check|model|takeover|liveness|range)(?:\s*\(([^)]+)\))?:(?:\*\*)?\s*(.+)$/i;
// A range is named by letters, digits, _ and -, and spans whole numbers from its first to its last, both at least 1.
const RANGE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const RANGE_REASON = 'a Range line is "Range (<name>): <from-to>": a name of letters, digits, _ and -, and two whole numbers from 1, the first at most the second';
function rangeSpan(name, value) {
  const m = /^\s*(\d{1,9})\s*-\s*(\d{1,9})\s*$/.exec(value);
  if (!name || !RANGE_NAME_RE.test(name) || !m || Number(m[1]) < 1 || Number(m[1]) > Number(m[2])) return null;
  return { name, from: Number(m[1]), to: Number(m[2]) };
}
const rangesMeet = (a, b) => a.from <= b.to && b.from <= a.to;
const rangeWords = (r) => `${r.name} (${r.from}-${r.to})`;
const MERGER_REASON = 'a Merger line names one holder, the jarl or one coordinator of the Coordinators line: it is "Merger: <name>"; a slice may keep a merger of its own, any name, with "Merger (<coordinator>): <name>"';
// The red rounds after which an issue takes over are a whole number from 1 to this.
const TAKEOVER_MAX = 99;
const takeoverRounds = (value) => (/^\d+$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= TAKEOVER_MAX ? Number(value) : null);
const TAKEOVER_REASON = `a Takeover line is "Takeover: <rounds>" or "Takeover (<kind>): <rounds>", with a whole number of rounds from 1 to ${TAKEOVER_MAX}`;
// The minutes of a Liveness line are a whole number from 1 to a week's.
const LIVENESS_MAX = 10080;
const livenessMinutes = (value) => (/^\d+$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= LIVENESS_MAX ? Number(value) : null);
const LIVENESS_REASON = `a Liveness line is "Liveness: <minutes>", with a whole number of minutes from 1 to ${LIVENESS_MAX} and no qualifier`;
// With `skipped` (an array), each machine line the grammar does not place is pushed onto it as { n, text, reason }: a
// Check with no command, a Model with no tier or no model, a Coordinators line with a tier, a Takeover line whose
// value is not a whole number of rounds, a Liveness line with a qualifier or a value that is not a whole number of minutes,
// a Range line that does not parse, names a range declared above it or shares numbers with one.
export function goalLines(text, skipped) {
  const out = { goal: null, checks: [], checksByRepo: { bare: [], repos: {} }, models: [], coordinators: [], merger: null, mergers: {}, takeovers: { bare: null, kinds: {} }, liveness: null, ranges: [] };
  if (text == null) return out;
  const lines = text.split('\n');
  out.goal = lines.slice(2).find((l) => l.trim()) || '';
  lines.forEach((line, i) => {
    const m = GOAL_LINE.exec(line);
    if (!m) return;
    const key = m[1].toLowerCase();
    const value = m[3].replace(/\*\*/g, '');
    const qualifier = m[2] && fieldText(m[2]);
    const skip = (reason) => { if (skipped) skipped.push({ n: i + 1, text: line, reason }); };
    if (key === 'coordinators' && !m[2]) out.coordinators.push(...value.split(',').map((n) => fieldText(n)).filter(Boolean));
    else if (key === 'coordinators') skip('a Coordinators line takes no tier: it is "Coordinators: <name>[, <name>…]"');
    // The one holder that raises the merger of the work on the loop's feature branch, the jarl or one coordinator; a slice
    // may name a merger of its own, which lands the slice's work on its integration branch.
    else if (key === 'merger' && !m[2] && !value.includes(',') && fieldText(value)) out.merger = fieldText(value);
    else if (key === 'merger' && m[2] && qualifier && !value.includes(',') && fieldText(value)) out.mergers[qualifier.toLowerCase()] = { slice: qualifier, name: fieldText(value) };
    else if (key === 'merger') skip(MERGER_REASON);
    else if (key === 'model' && m[2]) {
      const models = value.split(',').map((s) => fieldText(s).replace(/^`(.*)`$/, '$1')).filter(Boolean);
      if (models.length) out.models.push({ tier: qualifier, models });
      else skip('a Model line names no model: it is "Model (<tier>): <model-id>", more models after commas');
    } else if (key === 'model') skip('a Model line names its tier in brackets: it is "Model (<tier>): <model-id>", more models after commas');
    else if (key === 'takeover') {
      const rounds = takeoverRounds(value);
      if (rounds === null) skip(TAKEOVER_REASON);
      else if (qualifier) out.takeovers.kinds[qualifier.toLowerCase()] = rounds;
      else out.takeovers.bare = rounds;
    } else if (key === 'liveness') {
      const minutes = m[2] ? null : livenessMinutes(value);
      if (minutes === null) skip(LIVENESS_REASON); else out.liveness = minutes;
    } else if (key === 'range') {
      const span = rangeSpan(qualifier, value);
      const same = span && out.ranges.find((r) => r.name.toLowerCase() === span.name.toLowerCase());
      const met = span && out.ranges.find((r) => rangesMeet(r, span));
      if (span === null) skip(RANGE_REASON);
      else if (same) skip(`the range ${span.name} is declared on a line above: the first line of a range stands`);
      else if (met) skip(`the range ${rangeWords(span)} shares numbers with the range ${rangeWords(met)} above it: two ranges never share a number`);
      else out.ranges.push(span);
    } else if (key === 'check') {
      const command = fieldText(value).replace(/^`(.*)`$/, '$1');
      if (!command) { skip('a Check line names no command: it is "Check: <command>" or "Check (<name>): <command>"'); return; }
      if (qualifier) (out.checksByRepo.repos[qualifier] = out.checksByRepo.repos[qualifier] || []).push(command); else out.checksByRepo.bare.push(command);
    }
  });
  out.checks = [...out.checksByRepo.bare, ...Object.values(out.checksByRepo.repos).flat()];
  return out;
}

// The machine lines the command line writes into the goal, and the words that label them. A line is read by GOAL_LINE, the
// grammar goalLines reads, and written with the label the grammar takes.
const MACHINE_LABEL = { check: 'Check', model: 'Model', coordinators: 'Coordinators', merger: 'Merger', takeover: 'Takeover', liveness: 'Liveness', range: 'Range' };
// The machine line a text is, as { key, qualifier, value } (key lower case; qualifier as written, or null), or null.
export function goalLineOf(text) {
  const m = GOAL_LINE.exec(String(text ?? ''));
  if (!m) return null;
  return { key: m[1].toLowerCase(), qualifier: m[2] ? fieldText(m[2]) : null, value: m[3].replace(/\*\*/g, '').trim() };
}
// Whether a goal line is the machine line of this kind and qualifier (the same qualifier, in any case, or none).
function isMachineLine(line, key, qualifier) {
  const m = GOAL_LINE.exec(line);
  if (!m || m[1].toLowerCase() !== key) return false;
  if (qualifier === null) return !m[2];
  return m[2] !== undefined && fieldText(m[2]).toLowerCase() === qualifier.toLowerCase();
}
// The goal with one machine line set: every line of its kind and qualifier becomes this one, where the first stood, or the
// line is added after the goal's text when there is none. `replaced` says which, and `was` is the value it held before.
export function goalWithLine(text, line) {
  const shown = `${MACHINE_LABEL[line.key]}${line.qualifier !== null ? ` (${line.qualifier})` : ''}: ${line.value}`;
  const out = [];
  let replaced = false;
  let was = null;
  for (const l of String(text ?? '').replace(/\s+$/, '').split('\n')) {
    if (isMachineLine(l, line.key, line.qualifier)) {
      if (!replaced) out.push(shown);
      // The first line of a kind stands for them all, except a Takeover or a Liveness line: the last one is the one in force.
      if (!replaced || line.key === 'takeover' || line.key === 'liveness') was = goalLineOf(l).value;
      replaced = true;
      continue;
    }
    out.push(l);
  }
  if (!replaced) out.push('', shown);
  return { text: `${out.join('\n')}\n`, replaced, was, shown };
}

// goal: the goal as goal.md holds it.
export function cmdGoal(root) {
  const text = readGoal(jarlDir(root));
  need(text !== null, `the loop has no goal: open it with init "<goal>"`, () => (['jarl.mjs', 'init', '<goal>']));
  return { goal: text.replace(/\s+$/, '') };
}
// goal --set "<machine line>": one machine line of the goal changed, and a log line that says what it was and what it is now.
// The machine lines are Check (<repository>): <command> or a bare Check: <command>, Model (<tier>): <models> with a tier the
// profile declares, Coordinators: <names>, Takeover: <rounds> or Takeover (<kind>): <rounds> with a kind the profile
// declares, and Liveness: <minutes>. Any other line, a repository line among them, is refused: a repository joins the loop
// by its own declaration, not by a line of the goal.
export function cmdGoalSet(root, text) {
  const dir = jarlDir(root);
  const old = readGoal(dir);
  need(old !== null, 'the loop has no goal: open it with init "<goal>"', () => (['jarl.mjs', 'init', '<goal>']));
  need(!oneBreak(text).includes('\n'), 'goal --set takes one machine line: a line break in its value is refused', () => ({ flag: '--set', value: '<machine-line>' }));
  const line = goalLineOf(text);
  need(line && line.value && MACHINE_LABEL[line.key], `goal --set takes one machine line (got "${text}"): ` + '"Check (<name>): <command>" or "Check: <command>", "Model (<tier>): <model-id>" (more models after commas), "Coordinators: <name>, …", "Merger: <name>", "Takeover (<kind>): <rounds>" or "Takeover: <rounds>", "Liveness: <minutes>", "Range (<name>): <from-to>"', () => ({ flag: '--set', value: '<machine-line>' }));
  let qualifier = line.qualifier;
  if (line.key === 'model') {
    need(qualifier !== null, 'a Model line names its tier: "Model (<tier>): <model-id>", more models after commas', () => ({ flag: '--set', value: `Model (${hole('<tier>')}): ${line.value}` }));
    const profile = loadProfile(root);
    qualifier = profile.tiers.find((t) => t.toLowerCase() === qualifier.toLowerCase()) ?? null;
    need(qualifier !== null, `the profile declares no tier ${JSON.stringify(line.qualifier)}: its tiers are ${loadProfile(root).tiers.join(', ')}`, () => ({ flag: '--set', value: `Model (${hole('<tier>')}): ${line.value}` }));
  }
  need(line.key !== 'coordinators' || qualifier === null, 'a Coordinators line takes no qualifier: "Coordinators: <name>, …"', () => ({ flag: '--set', value: `Coordinators (${hole('<machine-line>')}): ${line.value}` }));
  need(line.key !== 'merger' || !line.value.includes(','), MERGER_REASON, () => ({ flag: '--set', value: `Merger: ${hole('<one-name>')}` }));
  if (line.key === 'merger' && qualifier !== null) {
    const slices = goalLines(old).coordinators;
    const known = slices.find((c) => c.toLowerCase() === qualifier.toLowerCase());
    need(known !== undefined, `Merger (${qualifier}) names no slice of this loop: ${slices.length ? `its slices are ${slices.join(', ')}` : 'it has no Coordinators line'}`, () => ({ flag: '--set', value: `Merger (${hole('<coordinator>')}): ${line.value}` }));
    qualifier = known;
  }
  if (line.key === 'takeover' && qualifier !== null) {
    const kinds = loadProfile(root).kinds;
    qualifier = kinds.find((k) => k.toLowerCase() === qualifier.toLowerCase()) ?? null;
    need(qualifier !== null, `the profile declares no kind ${JSON.stringify(line.qualifier)}: its kinds are ${kinds.join(', ')}`, () => ({ flag: '--set', value: `Takeover (${hole('<kind>')}): ${line.value}` }));
  }
  if (line.key === 'range') qualifier = rangeLine(root, old, line, text);
  const value = line.key === 'range' ? line.value.replace(/\s+/g, '') : noSeparators(line.value);
  need(value, 'goal --set needs a value after the colon', () => ({ flag: '--set', value: `${String(text).split(':')[0].trim()}: ${hole('<value>')}` }));
  need(line.key !== 'liveness' || (qualifier === null && livenessMinutes(value) !== null), `${LIVENESS_REASON} (got "${String(text).trim()}")`, () => ({ flag: '--set', value: `Liveness: ${hole('<minutes>')}` }));
  need(line.key !== 'takeover' || takeoverRounds(value) !== null, `a Takeover line takes a whole number of rounds from 1 to ${TAKEOVER_MAX} (got "${value}"): "Takeover: <rounds>" or "Takeover (<kind>): <rounds>"`, () => ({ flag: '--set', value: `${String(text).split(':')[0].trim()}: ${hole('<rounds>')}` }));
  const next = goalWithLine(old, { key: line.key, qualifier, value });
  // A line that already holds this value is left alone: nothing is written and no log line says it changed.
  if (next.replaced && noSeparators(next.was) === value) return { shown: next.shown, replaced: true, was: next.was, unchanged: true };
  writeAtomic(goalPath(dir), next.text);
  appendLog(root, `goal line ${next.replaced ? 'changed' : 'added'} · ${next.shown}${next.replaced ? ` · was ${noSeparators(next.was)}` : ''}`);
  return { shown: next.shown, replaced: next.replaced, was: next.replaced ? next.was : null, unchanged: false };
}
// The Range line goal --set writes: one that parses and shares no number with another declared range, and that keeps the
// numbers of this checkout's issue files where they are: the ones the range held stay in it, and it takes in none filed
// outside it. Returns the range's name as the goal already writes it, or as given for a new one.
function rangeLine(root, old, line, text) {
  const span = rangeSpan(line.qualifier, line.value);
  need(span, `${RANGE_REASON} (got "${String(text).trim()}")`, () => ({ flag: '--set', value: `Range (${hole('<name>')}): ${hole('<from-to>')}` }));
  const declared = goalLines(old).ranges;
  const was = declared.find((r) => r.name.toLowerCase() === span.name.toLowerCase()) || null;
  const name = was ? was.name : span.name;
  const form = () => ({ flag: '--set', value: `Range (${name}): ${hole('<from-to>')}` });
  const met = declared.find((r) => r !== was && rangesMeet(r, span));
  if (met) refuse(`the range ${rangeWords(span)} shares numbers with the range ${rangeWords(met)}: two ranges never share a number`, form());
  const dir = issuesDir(root);
  const held = existsSync(dir) ? readdirSync(dir).map((f) => ISSUE_FILE_RE.exec(f)).filter(Boolean).map((m) => Number(m[1])) : [];
  const within = (r, n) => r !== null && n >= r.from && n <= r.to;
  const left = held.filter((n) => within(was, n) && !within(span, n));
  const taken = held.filter((n) => within(span, n) && !within(was, n));
  if (left.length) refuse(`the range ${rangeWords(span)} would leave out issue ${left.join(', ')}, numbered in the range ${rangeWords(was)}: a range keeps every number it holds`, form());
  need(!taken.length, `the range ${rangeWords(span)} would take in issue ${taken.join(', ')}, numbered outside it: a range takes in no number filed elsewhere`, form);
  return name;
}

// A ratify item the close's batch filed names the area ruling it asks about: `· ruling <slug>`.
const ASK_RE = idRe('^- \\*\\*a-({id})\\*\\* \\((open|answered)\\)(?: · (stop|stuck|lower|charter|ratify|escalation|rule))?(?: · target (\\S+))?(?: · issue ({id}))?(?: · slice ([^\\s·]+))?(?: · ruling ([A-Za-z0-9][A-Za-z0-9._-]{0,79}))?(?: · to (owner|jarl))?(?: · applies to ([^·]+?(?: · until [^·]+?)?))? · (.*)$');

// An option of a question is its own line after the question: `- **a-<n>** option · <label> · <effect>`. Its label and effect
// pass noSeparators, so the line splits on its separators alone. A question's indented lines never start with `- **a-`.
const ASK_OPTION_RE = idRe('^- \\*\\*a-({id})\\*\\* option · (.+?) · (.+)$');

// The questions of the record held in `dir`; a question with options carries them as `options: [{ label, effect }]`.
// With `skipped` (an array), each line that is neither a question, an option, a continuation, a blank nor the heading
// is pushed onto it as { n, text, reason }, and so is an option whose question the file does not hold.
function asksAt(dir, skipped) {
  const path = asksPath(dir);
  if (!existsSync(path)) return [];
  // A question of several lines is the item line and its next lines indented by two spaces (blank ones are two spaces
  // alone); the item line alone still reads as a question.
  const out = [];
  const options = new Map();
  const optionLines = [];
  let last = null;
  const forms = issueForms(dir);
  readText(path).split('\n').forEach((line, i) => {
    const skip = (reason) => { if (skipped) skipped.push({ n: i + 1, text: line, reason }); };
    const m = ASK_RE.exec(line);
    if (m) { last = { id: m[1], state: m[2], kind: m[3] || null, target: m[4] || null, issue: m[5] ? writtenId(m[5], forms) : null, ...(m[6] ? { slice: m[6] } : {}), ...(m[7] ? { ruling: m[7] } : {}), ...(m[8] ? { to: m[8] } : {}), ...(m[9] ? { appliesTo: m[9] } : {}), question: m[10] }; out.push(last); return; }
    const o = ASK_OPTION_RE.exec(line);
    if (o) { const key = idKey(o[1]); options.set(key, [...(options.get(key) || []), { label: o[2], effect: o[3] }]); optionLines.push({ key, line: i + 1, text: line }); last = null; return; }
    if (last && line.startsWith('  ')) { last.question += `\n${line.slice(2)}`; return; }
    last = null;
    if (line.trim() === '' || line.startsWith('# ')) return;
    skip('not a question, an option of one, or a continuation line of a question: a question is "- **a-<n>** (open|answered) · <kind> · <question>"');
  });
  if (skipped) {
    const asked = new Set(out.map((a) => idKey(a.id)));
    for (const o of optionLines) if (!asked.has(o.key)) skipped.push({ n: o.line, text: o.text, reason: 'an option of no question: the question it belongs to is not in the file' });
  }
  for (const a of out) {
    a.question = a.question.replace(/\s+$/, '');
    if (options.has(idKey(a.id))) a.options = options.get(idKey(a.id));
  }
  return out;
}

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { ASKS_FILE, DECISIONS_FILE, DECISION_HEAD, DECISION_META, GOAL_FILE, LOG_FILE, STAMP_SRC, asksAt, asksPath, decisionsAt, decisionsPath, goalPath, markDecision, oneLine, parseStamp, readGoal };
