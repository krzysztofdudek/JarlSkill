// The journal and the decisions: the loop's files, the log lines written, the rulings, the goal and the questions file.

import { existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fieldText, need, noSeparators, oneBreak, slugify, splitList } from './base.mjs';
import { jarlDir, stamp, today } from './where.mjs';
import { appendAtomic, readText, writeAtomic } from './files.mjs';
import { idKey, idRe, issueForms, writtenId } from './ids.mjs';
import { loadProfile } from './profile.mjs';
import { OWNER, carryingOwnersWords, needNoOwnersWords, quoteLine, quoteOf, underLine, underOf } from './owner.mjs';

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
function decisionsPath(dir) { return join(dir, DECISIONS_FILE); }
function asksPath(dir) { return join(dir, ASKS_FILE); }
export function appendLog(root, event) {
  appendLogLines(root, [event]);
}
// A whole-file write for a composer (record.writeAtomic): any file but the loop's journal, which is appended to and
// never written whole, so no line of it is replaced or dropped behind the record's back.
export function writeWhole(path, text) {
  const dir = dirname(path);
  need(!(basename(path).toLowerCase() === LOG_FILE.toLowerCase() && (existsSync(join(dir, 'issues')) || existsSync(goalPath(dir)))), `${path} is the loop's journal: it is appended to (record.appendLog), never written whole`);
  writeAtomic(path, text);
}
// Several lines in one write: a bulk command's lines land together or not at all. A command that writes the same
// moment into a header field takes the stamp once and passes it as `at`, so the two cannot fall in two minutes.
export function appendLogLines(root, events, at = stamp()) {
  const w = callWriter;
  if (w && !w.raised) { w.raise(root); w.raised = true; }
  appendAtomic(logPath(jarlDir(root)), '# Log\n\n', events.map((e) => `- ${at}${w ? ` by ${w.name}` : ''} · ${oneLine(e)}\n`).join(''));
}
// The writer one call names (its --by), for every line the call writes: withWriter sets it for the length of `fn` and
// puts back what was there, so nothing outlives the call and a server that runs call after call keeps no name of its own.
// `raise` runs once, before the first line, under the call's lock: it raises the record to the format that holds a
// writer. A call that names nobody writes its lines with no writer.
let callWriter = null;
export function withWriter(name, raise, fn) {
  const was = callWriter;
  callWriter = name ? { name, raise, raised: false } : null;
  try { return fn(); } finally { callWriter = was; }
}

// The log is one event per line: a text with line breaks never reaches it raw. A command that keeps the whole text
// elsewhere writes its first line and a pointer (firstLine); any other text that gets here has its lines joined by
// " ⏎ ", so nothing is cut.
function oneLine(event) {
  return String(event).replace(/\r\n?/g, '\n').trim().split('\n').map((l) => l.trim()).filter(Boolean).join(' ⏎ ');
}
// The first line of a text, and when there are more, how many and where the whole is kept.
export function firstLine(text, where) {
  const lines = String(text).replace(/\r\n?/g, '\n').trim().split('\n');
  const first = lines[0].trim();
  return lines.length > 1 ? `${first} (+${lines.length - 1} more lines, whole text in ${where})` : first;
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
    if (skipped && /^## /.test(line)) skipped.push({ n: i + 1, text: line, reason: 'a ruling heading does not parse: it is "## <date> · <slug>"' });
    else if (skipped && !out.length && line.trim() !== '' && !line.startsWith('# ')) skipped.push({ n: i + 1, text: line, reason: 'text before the first ruling: a ruling starts with "## <date> · <slug>"' });
    if (out.length) out[out.length - 1].body.push(line);
  });
  // A ruling's own fields (By, Supersedes, Superseded by, Settles) are the block the tool writes at the end of its
  // section — the trailing lines that are such a field or blank. A line of the ruling's text that happens to start
  // with **By:** is text.
  const META = DECISION_META;
  return out.map((d) => {
    let cut = d.body.length;
    while (cut > 0 && (d.body[cut - 1].trim() === '' || META.test(d.body[cut - 1]))) cut -= 1;
    const meta = d.body.slice(cut).map((l) => META.exec(l)).filter(Boolean);
    const field = (name) => meta.filter((m) => m[1] === name).map((m) => m[2].trim());
    // The ruling's text: a line indented two spaces is a continuation line of its free text, read without the indent.
    const ruling = d.body.slice(0, cut).map((l) => (l.startsWith('  ') ? l.slice(2) : l)).join('\n').trim();
    const sup = field('Superseded by').pop();
    const reach = field('Reach').pop();
    const typeLog = /^(\S+) · (\S+)/.exec(field('Type log').pop() || '');
    const ruleLog = /^(\S+) · (\S+)/.exec(field('Rule log').pop() || '');
    const first = (name) => (field(name).pop() || '').split(/\s/)[0] || null;
    return {
      date: d.date, slug: d.slug, ruling, quote: field('By').pop() === OWNER ? quoteOf(d.body.slice(0, cut)) : null, under: field('By').pop() === OWNER ? null : underOf(d.body.slice(0, cut)), by: field('By').pop() || null, supersedes: field('Supersedes').pop() || null, supersededBy: sup ? sup.split(/\s/)[0] : null, settles: splitList(field('Settles').pop()),
      area: field('Area').pop() || null, reach: reach !== undefined && /^\d+$/.test(reach) ? Number(reach) : null, rule: field('Rule').pop() || null,
      ratified: first('Ratified'), rejected: first('Rejected'), typeLog: typeLog ? { type: typeLog[1], datetime: typeLog[2] } : null,
      ruleLog: ruleLog ? { rule: ruleLog[1], datetime: ruleLog[2] } : null,
    };
  });
}
// The fields the tool writes into a ruling's closing block. Area, Reach and Rule come with the ruling (decide --area,
// --reach, --rule); Superseded by, Ratified, Rejected, Type log and Rule log are added to an earlier ruling in place, later.
const DECISION_META = /^\*\*(By|Supersedes|Superseded by|Settles|Area|Reach|Rule|Ratified|Rejected|Type log|Rule log):\*\*\s*(.*)$/;
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
  need(at !== -1, `no ruling ${slug} in ${DECISIONS_FILE}`);
  let end = lines.findIndex((l, n) => n > at && l.startsWith('## '));
  if (end === -1) end = lines.length;
  while (end - 1 > at && lines[end - 1].trim() === '') end -= 1;
  lines.splice(end, 0, line);
  if (given !== undefined) return lines.join('\n');
  writeAtomic(path, lines.join('\n'));
  return undefined;
}

// The ruling is written as its caller gives it: structure at the start of a line, free text indented (freeInline, freeBlock).
// The owner's words (quote, on a ruling by the owner only) are its last line, after a blank one, at the left edge: the one
// line of a ruling no text given to decide can stand on (owner.mjs, quoteOf). The ruling it rests on (under, on a ruling
// by anyone but the owner) is the paragraph before, in the same form and for the same reason (owner.mjs, underOf).
export function appendDecision(root, slug, ruling, { by, quote, under, supersedes, area, reach, rule, settles } = {}) {
  need(under === undefined || under === null || (typeof under === 'string' && SLUG_RE.test(under) && by !== OWNER), 'the ruling a ruling rests on is the slug of a ruling, and a ruling by the owner rests on his own words');
  need(quote === undefined || quote === null || (typeof quote === 'string' && quote === fieldText(quote) && quote !== '' && by === OWNER), 'the owner\'s words are one line of text, kept with a ruling by the owner');
  if (quote) needNoOwnersWords('--quote', quote);
  need(typeof slug === 'string' && SLUG_RE.test(slug), `a ruling's slug is letters, digits and . _ - (starting with a letter or digit, at most 80 characters) — not "${slug}"; e.g. ${slugify(String(slug || 'ruling'))}`);
  const path = decisionsPath(jarlDir(root));
  const existing = existsSync(path) ? readText(path) : '# Decisions\n';
  const all = loadDecisions(root);
  need(!all.some((d) => d.slug === slug), `duplicate slug: ${slug} — a ruling that replaces it takes a new slug and --supersedes ${slug}`);
  let text = existing;
  if (supersedes !== undefined) {
    need(typeof supersedes === 'string' && SLUG_RE.test(supersedes) && supersedes !== slug, '--supersedes names the slug of an earlier ruling');
    const old = all.find((d) => d.slug === supersedes);
    need(old, `no ruling ${supersedes} in ${DECISIONS_FILE} to supersede`);
    need(!old.supersededBy, `${supersedes} is already superseded by ${old.supersededBy} — supersede that one instead`);
    text = markDecision(root, supersedes, `**Superseded by:** ${slug} (${today()})`, { text });
  }
  const meta = [settles?.length ? `**Settles:** ${settles.join(', ')}` : null, by ? `**By:** ${fieldText(by)}` : null, supersedes !== undefined ? `**Supersedes:** ${supersedes}` : null, area ? `**Area:** ${area}` : null, reach !== undefined && reach !== null ? `**Reach:** ${reach}` : null, rule ? `**Rule:** ${rule}` : null].filter(Boolean).join('\n');
  const body = `${ruling.replace(/\s+$/, '')}${under ? `\n\n${underLine(under)}` : ''}${quote ? `\n\n${quoteLine(quote)}` : ''}`;
  carryingOwnersWords([quote && quoteLine(quote)], () => writeAtomic(path, `${text.replace(/\s*$/, '')}\n\n## ${today()} · ${slug}\n${body}\n${meta ? `\n${meta}\n` : ''}`));
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
const GOAL_LINE = /^\s*(?:[-*]\s+)?(?:\*\*)?(coordinators|merger|check|model|takeover)(?:\s*\(([^)]+)\))?:(?:\*\*)?\s*(.+)$/i;
const MERGER_REASON = 'a Merger line names one holder, the jarl or one coordinator of the Coordinators line: it is "Merger: <name>"';
// The red rounds after which an issue takes over are a whole number from 1 to this.
const TAKEOVER_MAX = 99;
const takeoverRounds = (value) => (/^\d+$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= TAKEOVER_MAX ? Number(value) : null);
const TAKEOVER_REASON = `a Takeover line is "Takeover: <rounds>" or "Takeover (<kind>): <rounds>", with a whole number of rounds from 1 to ${TAKEOVER_MAX}`;
// With `skipped` (an array), each machine line the grammar does not place is pushed onto it as { n, text, reason }: a
// Check with no command, a Model with no tier or no model, a Coordinators line with a tier, a Takeover line whose
// value is not a whole number of rounds.
export function goalLines(text, skipped) {
  const out = { goal: null, checks: [], checksByRepo: { bare: [], repos: {} }, models: [], coordinators: [], merger: null, takeovers: { bare: null, kinds: {} } };
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
    // The one holder that raises the merger, one merge at a time across every slice: the jarl or one coordinator.
    else if (key === 'merger' && !m[2] && !value.includes(',') && fieldText(value)) out.merger = fieldText(value);
    else if (key === 'merger') skip(MERGER_REASON);
    else if (key === 'model' && m[2]) {
      const models = value.split(',').map((s) => fieldText(s).replace(/^`(.*)`$/, '$1')).filter(Boolean);
      if (models.length) out.models.push({ tier: qualifier, models });
      else skip('a Model line names no model: it is "Model (<tier>): <model>[, <model>…]"');
    } else if (key === 'model') skip('a Model line names its tier in brackets: it is "Model (<tier>): <model>[, <model>…]"');
    else if (key === 'takeover') {
      const rounds = takeoverRounds(value);
      if (rounds === null) skip(TAKEOVER_REASON);
      else if (qualifier) out.takeovers.kinds[qualifier.toLowerCase()] = rounds;
      else out.takeovers.bare = rounds;
    } else if (key === 'check') {
      const command = fieldText(value).replace(/^`(.*)`$/, '$1');
      if (!command) { skip('a Check line names no command: it is "Check: <what runs>" or "Check (<repository>): <what runs>"'); return; }
      if (qualifier) (out.checksByRepo.repos[qualifier] = out.checksByRepo.repos[qualifier] || []).push(command); else out.checksByRepo.bare.push(command);
    }
  });
  out.checks = [...out.checksByRepo.bare, ...Object.values(out.checksByRepo.repos).flat()];
  return out;
}

// The machine lines the command line writes into the goal, and the words that label them. A line is read by GOAL_LINE, the
// grammar goalLines reads, and written with the label the grammar takes.
const MACHINE_LABEL = { check: 'Check', model: 'Model', coordinators: 'Coordinators', merger: 'Merger', takeover: 'Takeover' };
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
      // The first line of a kind stands for them all, except a Takeover line: the last one is the one in force.
      if (!replaced || line.key === 'takeover') was = goalLineOf(l).value;
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
  need(text !== null, `the loop has no goal: open it with init "<goal>"`);
  return { goal: text.replace(/\s+$/, '') };
}
// goal --set "<machine line>": one machine line of the goal changed, and a log line that says what it was and what it is now.
// The machine lines are Check (<repository>): <command> or a bare Check: <command>, Model (<tier>): <models> with a tier the
// profile declares, Coordinators: <names>, and Takeover: <rounds> or Takeover (<kind>): <rounds> with a kind the profile
// declares. Any other line, a repository line among them, is refused: a repository joins the loop by its own
// declaration, not by a line of the goal.
export function cmdGoalSet(root, text) {
  const dir = jarlDir(root);
  const old = readGoal(dir);
  need(old !== null, 'the loop has no goal: open it with init "<goal>"');
  need(!oneBreak(text).includes('\n'), 'goal --set takes one machine line: a line break in its value is refused');
  const line = goalLineOf(text);
  need(line && line.value && MACHINE_LABEL[line.key], 'goal --set takes one machine line: "Check (<repository>): <command>" or "Check: <command>", "Model (<tier>): <model>, …", "Coordinators: <name>, …", "Merger: <name>", "Takeover (<kind>): <rounds>" or "Takeover: <rounds>"');
  let qualifier = line.qualifier;
  if (line.key === 'model') {
    need(qualifier !== null, 'a Model line names its tier: "Model (<tier>): <model>, …"');
    const profile = loadProfile(root);
    qualifier = profile.tiers.find((t) => t.toLowerCase() === qualifier.toLowerCase()) ?? null;
    need(qualifier !== null, `the profile declares no tier ${line.qualifier}: its tiers are ${loadProfile(root).tiers.join(', ')}`);
  }
  need(line.key !== 'coordinators' || qualifier === null, 'a Coordinators line takes no qualifier: "Coordinators: <name>, …"');
  need(line.key !== 'merger' || (qualifier === null && !line.value.includes(',')), MERGER_REASON);
  if (line.key === 'takeover' && qualifier !== null) {
    const kinds = loadProfile(root).kinds;
    qualifier = kinds.find((k) => k.toLowerCase() === qualifier.toLowerCase()) ?? null;
    need(qualifier !== null, `the profile declares no kind ${line.qualifier}: its kinds are ${kinds.join(', ')}`);
  }
  const value = noSeparators(line.value);
  need(value, 'goal --set needs a value after the colon');
  need(line.key !== 'takeover' || takeoverRounds(value) !== null, `a Takeover line takes a whole number of rounds from 1 to ${TAKEOVER_MAX}: "Takeover: <rounds>" or "Takeover (<kind>): <rounds>"`);
  const next = goalWithLine(old, { key: line.key, qualifier, value });
  // A line that already holds this value is left alone: nothing is written and no log line says it changed.
  if (next.replaced && noSeparators(next.was) === value) return { shown: next.shown, replaced: true, was: next.was, unchanged: true };
  writeAtomic(goalPath(dir), next.text);
  appendLog(root, `goal line ${next.replaced ? 'changed' : 'added'} · ${next.shown}${next.replaced ? ` · was ${noSeparators(next.was)}` : ''}`);
  return { shown: next.shown, replaced: next.replaced, was: next.replaced ? next.was : null, unchanged: false };
}

// A ratify item the close's batch filed names the area ruling it asks about: `· ruling <slug>`.
const ASK_RE = idRe('^- \\*\\*a-({id})\\*\\* \\((open|answered)\\)(?: · (stop|stuck|lower|charter|ratify|escalation))?(?: · target (\\S+))?(?: · issue ({id}))?(?: · slice ([^\\s·]+))?(?: · ruling ([A-Za-z0-9][A-Za-z0-9._-]{0,79}))? · (.*)$');

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
    if (m) { last = { id: m[1], state: m[2], kind: m[3] || null, target: m[4] || null, issue: m[5] ? writtenId(m[5], forms) : null, ...(m[6] ? { slice: m[6] } : {}), ...(m[7] ? { ruling: m[7] } : {}), question: m[8] }; out.push(last); return; }
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
