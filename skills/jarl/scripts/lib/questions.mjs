// Questions to the owner, their answers and the rulings, the handoff, and the ratification batch the owner
// admits when the loop closes.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ASK_KINDS, HANDOFF_STALE_MS, fieldText, freeInline, need, noSeparators, oneBreak } from './base.mjs';
import { jarlDir, today } from './where.mjs';
import { appendAtomic, readText, writeAtomic } from './files.mjs';
import { askNumber, idKey, issueForms, needsRaisedFormat, newNumber, writtenId } from './ids.mjs';
import { loadProfile } from './profile.mjs';
import { ASKS_FILE, DECISIONS_FILE, STAMP_SRC, appendDecision, appendLog, appendLogLines, asksAt, asksPath, firstLine, loadDecisions, markDecision, parseStamp } from './journal.mjs';
import { OWNER, carryingOwnersWords, needNoOwnersWords, quoteShown, rulingAuthor } from './owner.mjs';
import { findIssue, freeBlock, loadIssues, noteText, parseIssue, placeEvidence, setSection } from './issues.mjs';
import { raiseFormat } from './repositories.mjs';
import { coordinatorNames } from './loop.mjs';
import { issuesFor } from './commands.mjs';

// ---- questions to the owner and the handoff -------------------------------------------------

export function loadAsks(root, skipped) { return asksAt(jarlDir(root), skipped); }

export function cmdAsk(root, question, flags) {
  need(question, 'ask requires "<question>"');
  needNoOwnersWords('the question', question, flags);
  const kind = String(flags.kind || 'stuck');
  need(ASK_KINDS.includes(kind), `--kind must be one of: ${ASK_KINDS.join(', ')} — stop (halt everything), stuck (this issue only), lower (weaken something protected, needs a target), charter (the goal itself), ratify (a choice already made under a mandate, awaiting the owner's word; blocks nothing)`);
  if (flags.issue !== undefined) need(findIssue(root, flags.issue), `no such issue: ${flags.issue}`);
  need(kind !== 'lower' || flags.target, '--target is required for kind lower — nothing to weaken without naming it');
  need(kind === 'lower' || !flags.target, `--target has no meaning for kind "${kind}" — only lower names something to weaken`);
  const asks = loadAsks(root);
  const id = newNumber(asks.reduce((m, a) => Math.max(m, Number(a.id)), 0) + 1, flags.width);
  // The issue is written as its file writes it, so a question about 007 names it 007 and raises nothing.
  const issueWritten = flags.issue ? writtenId(flags.issue, issueForms(jarlDir(root))) : null;
  // A question whose number is written plain (a-7, a-1000) or that names an issue so written raises the format first.
  if (needsRaisedFormat(id) || (issueWritten !== null && needsRaisedFormat(issueWritten))) raiseFormat(root);
  const path = asksPath(jarlDir(root));
  const target = kind === 'lower' ? ` · target ${flags.target}` : '';
  // flags.ruling is not a flag of the command line: the close's ratification batch passes it, and so may a composer
  // filing its own batch (record.mjs ask). It names an area ruling in force that no item has asked about yet.
  if (flags.ruling !== undefined) {
    need(kind === 'ratify', `a question naming a ruling is that ruling's ratification item — kind ratify (got "${kind}")`);
    const d = loadDecisions(root).find((x) => x.slug === String(flags.ruling));
    need(d && d.area, `no area ruling ${flags.ruling} in ${DECISIONS_FILE} to put to ratification`);
    need(!d.supersededBy && !d.ratified && !d.rejected, `${flags.ruling} is ${d.supersededBy ? `superseded by ${d.supersededBy}` : d.ratified ? 'already ratified' : 'already rejected'} — nothing to ratify`);
    need(!loadAsks(root).some((x) => x.ruling === d.slug), `${flags.ruling} has been put to ratification already`);
  }
  const ruling = kind === 'ratify' && flags.ruling ? ` · ruling ${flags.ruling}` : '';
  const asked = oneBreak(question).trim().split('\n');
  const options = askOptions(flags.option, kind);
  const optionLines = options.map((o) => `- **a-${id}** option · ${o.label} · ${o.effect}\n`).join('');
  appendAtomic(path, '# Questions to the owner\n\n',`- **a-${id}** (open) · ${kind}${target}${issueWritten !== null ? ` · issue ${issueWritten}` : ''}${ruling} · ${asked[0]}\n${asked.slice(1).map((l) => `  ${l}\n`).join('')}${optionLines}`);
  appendLog(root, `asked a-${id} (${kind}) · ${firstLine(asked.join('\n'), ASKS_FILE)}`);
  return { id, question: asked.join('\n'), kind, ...(options.length ? { options } : {}) };
}

// The options of a question, from `--option "<label>: <effect>"` (repeatable): at least two, each with its own label and
// effect, the labels distinct whatever their case. A ratify item is answered yes or reject and takes none. Label and
// effect pass noSeparators, the one escape for free text beside a field.
function askOptions(raw, kind) {
  const given = raw === undefined ? [] : [].concat(raw);
  if (!given.length) return [];
  need(kind !== 'ratify', 'a ratify item is answered yes or reject (tak or nie), so it takes no --option');
  const options = given.map((text) => {
    need(!oneBreak(text).includes('\n'), `--option takes one line: a label or an effect with a line break is refused (got "${String(text).trim()}")`);
    const m = /^([^:]*?):\s*(.*)$/s.exec(String(text).trim());
    need(m, `--option takes "<label>: <effect>", with a colon between the label and the effect (got "${text}")`);
    const label = noSeparators(m[1]);
    const effect = noSeparators(m[2]);
    need(label && effect, `--option needs a label and an effect: "<label>: <effect>" (got "${text}")`);
    return { label, effect };
  });
  need(options.length >= 2, 'a question with options has at least two options: a choice between one is not a choice');
  const labels = options.map((o) => o.label.toLowerCase());
  need(new Set(labels).size === labels.length, 'the labels of a question\'s options are distinct');
  return options;
}

// The one word that answers a ratification: the first word of the answer, without case or trailing punctuation.
// "no" is not among them: it is English no and colloquial Polish yes ("no tak", "no"), so it decides nothing alone —
// the word after it decides ("no tak" ratifies, "no nie" rejects), and a bare "no" is refused with a request for
// tak or nie rather than read as a rejection the owner may not have meant.
export const RATIFY_WORDS = ['yes', 'ok', 'ratify', 'ratified', 'accept', 'accepted', 'approve', 'approved', 'tak'];
export const REJECT_WORDS = ['reject', 'rejected', 'nie'];
export const AMBIGUOUS_WORDS = ['no'];
function ratifyVerdict(answer) {
  const words = String(answer).trim().split(/\s+/).map((w) => w.toLowerCase().replace(/[.,;:!?]+$/, ''));
  const verdict = (w) => (RATIFY_WORDS.includes(w) ? 'ratified' : REJECT_WORDS.includes(w) ? 'rejected' : null);
  return AMBIGUOUS_WORDS.includes(words[0]) ? verdict(words[1] || '') : verdict(words[0]);
}
function ratifyRefusal(id, ruling, answer) {
  const first = String(answer).trim().split(/\s+/)[0].toLowerCase().replace(/[.,;:!?]+$/, '');
  if (AMBIGUOUS_WORDS.includes(first)) return `a-${id} ratifies ruling ${ruling}: "${first}" is English no and colloquial Polish yes, so it decides nothing — answer tak or nie (yes or reject)`;
  return `a-${id} ratifies ruling ${ruling}: the answer starts with one word — ${RATIFY_WORDS.join(', ')} to ratify it, ${REJECT_WORDS.join(', ')} to reject it`;
}

// What an answer is checked against before anything is written: the question, the answer text (or the chosen option's label),
// and for a ratify item the verdict its words give. A refusal throws; a check with nothing to refuse returns the verdict
// and the ruling the item asks about.
function answerChecks(root, ask, answer, chosen) {
  const id = ask.id;
  need(ask.state === 'open', `a-${id} is already answered`);
  need(!(chosen !== null && answer), `answer takes --option <label> or the answer, not both — a-${id}`);
  need(answer || chosen !== null, 'answer requires "<answer>" or --option <label>');
  const options = ask.options || [];
  let option = null;
  if (chosen !== null) {
    need(options.length, `a-${id} offered no options: answer it with its text`);
    option = options.find((o) => o.label === noSeparators(chosen)) || null;
    need(option, `"${chosen}" is none of the options of a-${id}: ${options.map((o) => o.label).join(', ')}`);
  }
  // A batch item asks about one area ruling, and its answer says one word first: yes or reject (tak or nie).
  const rulings = ask.ruling ? loadDecisions(root) : [];
  const ruling = ask.ruling ? rulings.find((d) => d.slug === ask.ruling) : null;
  const verdict = ask.ruling ? ratifyVerdict(answer) : null;
  need(!ask.ruling || verdict, ask.ruling && !verdict ? ratifyRefusal(id, ask.ruling, answer) : '');
  need(!ask.ruling || ruling, `a-${id} ratifies ruling ${ask.ruling}, which is not in force in ${DECISIONS_FILE}`);
  return { verdict, ruling, rulings, option, options };
}

// The question's answer, as the ruling, the journal and the issue quote it. An answer to a question with options is either the
// label of the option chosen (marked in the list of options offered) or the person's own words, never both.
function answerRuling(ask, text, chosen, batch) {
  const lines = [`**Question:** ${freeInline(ask.question)}`];
  if (ask.options) {
    lines.push('**Options:**', ...ask.options.map((o) => `- ${o.label}: ${o.effect}${chosen === o.label ? ' (chosen)' : ''}`));
    lines.push(chosen !== null ? `**Chose:** ${chosen}` : `**Answer in own words:** ${freeInline(text)}`);
  } else lines.push(`**Answer:** ${freeInline(text)}`);
  if (batch) lines.push(`**Batch:** answered together with ${batch.map((b) => `a-${b}`).join(', ')}`);
  return lines.join('\n');
}

// The answer to one question, written: the ruling, the question marked answered, the log line and the issue's ruling. A
// ratify item's yes or reject is applied too, with `by` and the batch the question was answered in when several were.
// The library's answer (record.mjs) calls this with no flags: its ruling is the owner's, and it names no options.
export function cmdAnswer(root, rawId, answer, flags = {}) {
  const by = flags.by === undefined ? null : rulingAuthor(flags.by);
  needNoOwnersWords('the answer', answer, flags.option);
  const chosen = flags.option === undefined ? null : noSeparators(flags.option);
  const key = askNumber(rawId);
  const ask = loadAsks(root).find((a) => idKey(a.id) === key);
  need(ask, `no such question: a-${key}`);
  // The issue the answer is copied into is resolved before the first write, so a number two files carry writes nothing.
  if (ask.issue) findIssue(root, ask.issue);
  const id = ask.id;
  const text = answer === undefined ? null : noSeparators(oneBreak(answer));
  const checked = answerChecks(root, ask, text, chosen);
  const shown = chosen !== null ? chosen : text;
  const author = by || OWNER;
  const issue = ask.issue ? findIssue(root, ask.issue) : null;
  // The question and its options are copied into the ruling as the record holds them; a question written before the
  // marker was refused may hold it, and it is carried as it stands, never refused for text the answerer cannot change.
  carryingOwnersWords([...ask.question.split('\n'), ...(ask.options || []).flatMap((o) => [o.label, o.effect])], () => {
    appendDecision(root, `ask-${id}`, answerRuling(ask, text, chosen === null ? null : checked.option.label, flags.batch || null), { by: author });
    const path = asksPath(jarlDir(root));
    // The item line only: a continuation line of an earlier question is never the one marked.
    writeAtomic(path, readText(path).split('\n').map((l) => (l.startsWith(`- **a-${id}** (open)`) ? l.replace('(open)', '(answered)') : l)).join('\n'));
  });
  appendLog(root, `answered a-${id} · ${firstLine(shown, `${DECISIONS_FILE}, ruling ask-${id}`)}`);
  // The issue the question was about carries the answer too, so reading the issue is enough: its first line and, when
  // there is more, a pointer to the whole ruling.
  if (issue) appendRuling(root, [issue], `Ruling ask-${id} (${ask.kind ? `${ask.kind}, ` : ''}by ${author}): ${firstLine(shown, `${DECISIONS_FILE}, ruling ask-${id}`)}`);
  const out = { id, answer: shown, ...(chosen !== null ? { chose: checked.option.label } : {}), ...(issue ? { issue: issue.id } : {}) };
  if (checked.ruling) Object.assign(out, ratify(root, checked.ruling, checked.rulings, checked.verdict, id, by));
  return out;
}

// The CLI's answer: one id, or a comma list of ratify items answered together with one verdict. Every question is checked
// before anything is written, so a refusal writes nothing. A ratify item names who answered (--by) and no coordinator of the
// loop: the answer to it is a ruling of the person, not of the loop's own director.
export function cmdAnswerMany(root, rawIds, answer, flags = {}) {
  const raw = String(rawIds ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  need(raw.length, 'answer requires an id: one question, or several ratify items as a comma list');
  const asks = loadAsks(root);
  // A question named twice is answered once: the list is taken in its order with each number kept at its first place.
  const found = [...new Set(raw.map(askNumber))].map((key) => {
    const ask = asks.find((a) => idKey(a.id) === key);
    need(ask, `no such question: a-${key}`);
    return ask;
  });
  const batch = found.length > 1 ? found.map((a) => a.id) : null;
  need(!batch || found.every((a) => a.kind === 'ratify'), 'several questions are answered together only when each is a ratify item');
  const by = flags.by === undefined ? undefined : rulingAuthor(flags.by);
  const item = found.find((a) => a.kind === 'ratify');
  if (item) {
    need(by, `a-${item.id} is a ratify item, which needs --by: who answered (owner or a name)`);
    need(!coordinatorNames(root).some((n) => n.toLowerCase() === by.toLowerCase()), `--by names a coordinator of the loop (${by}): a ratify item is answered by the owner or by a name`);
  }
  // Every question is checked before the first write, so a refusal of one of them writes nothing.
  for (const ask of found) answerChecks(root, ask, answer === undefined ? null : noSeparators(answer), flags.option === undefined ? null : noSeparators(flags.option));
  const results = found.map((ask) => cmdAnswer(root, ask.id, answer, { ...flags, ...(batch ? { batch } : {}) }));
  return results.length === 1 ? results[0] : results;
}

// A ratification answered: the ruling is marked in place. A ratified area ruling hands back the entry for the type's
// decision log (typeDecision: { type, text, supersedes }) and, when it names a rule of the graph (decide --rule), the
// ratification of that rule (ruleRatification: { rule, text }, with by when answer --by named who gave it) — what the command line writes through yg-edge.mjs,
// the one place in Jarl that reaches another tool, and what a composer standing on record.mjs may write with its own
// code. This module never writes either: it reads and writes the loop's files only.
function ratify(root, ruling, rulings, verdict, askId, by = null) {
  markDecision(root, ruling.slug, `**${verdict === 'ratified' ? 'Ratified' : 'Rejected'}:** a-${askId} (${today()})`);
  appendLog(root, `${verdict} ${ruling.slug} · a-${askId}${ruling.area ? ` · area ${ruling.area}` : ''}`);
  const out = { ruling: ruling.slug, verdict, typeDecision: null, typeLog: null, ruleRatification: null, ruleLog: null };
  if (verdict !== 'ratified' || !ruling.area) return out;
  if (ruling.supersededBy) {
    const skipped = { state: 'skipped', reason: `superseded by ${ruling.supersededBy}, whose own item asks about it` };
    return { ...out, typeLog: skipped, ...(ruling.rule ? { ruleLog: skipped } : {}) };
  }
  // The ruling it replaces, when its entry is in the same type's log, is replaced there too.
  const prior = ruling.supersedes ? rulings.find((d) => d.slug === ruling.supersedes) : null;
  const supersedes = prior && prior.typeLog && prior.typeLog.type === ruling.area ? prior.typeLog.datetime : null;
  const text = `${ruling.ruling}\n\n(ratified: ${ruling.slug}, a-${askId})`;
  return { ...out, typeDecision: { type: ruling.area, text, supersedes }, ...(ruling.rule ? { ruleRatification: { rule: ruling.rule, text, ...(by ? { by } : {}) } } : {}) };
}

// What became of a ratified area ruling's entry in the type's decision log, recorded: a written one marks the ruling
// **Type log:** <type> · <datetime> (what a later ruling superseding it replaces); a failed one is a log line. Either
// way the ruling stays in the decisions.
export function recordTypeLog(root, slug, decision, result) {
  if (result.state === 'written') {
    markDecision(root, slug, `**Type log:** ${decision.type} · ${result.datetime || 'unknown'}`);
    appendLog(root, `${slug} written into the decision log of type ${decision.type}${decision.supersedes ? ` · supersedes ${decision.supersedes}` : ''}`);
  } else if (result.state === 'failed') {
    appendLog(root, `${slug} NOT written into the decision log of type ${decision.type} · ${result.reason}`);
  }
}

// What became of a ratified ruling's rule ratification in the rule's own log, recorded the same way: a written one
// marks the ruling **Rule log:** <rule> · <datetime>; a failed one is a log line.
export function recordRuleLog(root, slug, ratification, result) {
  if (result.state === 'written') {
    markDecision(root, slug, `**Rule log:** ${ratification.rule} · ${result.datetime || 'unknown'}`);
    appendLog(root, `${slug} ratified rule ${ratification.rule} in its own log · by ${result.by}`);
  } else if (result.state === 'failed') {
    appendLog(root, `${slug} did NOT ratify rule ${ratification.rule} in its own log · ${result.reason}`);
  }
}

// A ruling written into issues' Evidence, after what is there, with one log line each. The status is left
// alone: a ruling may settle the question and still leave work, and done keeps its own preconditions.
function appendRuling(root, issues, line) {
  for (const issue of issues) {
    const text = readText(issue.file);
    const current = (parseIssue(text, issue.file).sections.evidence || '').trim();
    writeAtomic(issue.file, setSection(text, 'Evidence', placeEvidence(current, 'note', noteText(line, current), '\n\n')));
  }
  appendLogLines(root, issues.map((issue) => `${issue.id} evidence · ${line}`));
}

// decide <slug> "<ruling>" [--by who] [--quote "<words>"] [--supersedes <slug>] [--settles <ids>]: the ruling, who ruled
// (the caller, recorded as the coordinator, unless --by says otherwise: jarl for a choice the loop made under a
// mandate, owner for the owner's own, which needs his words in --quote, kept on one line as the ruling's last paragraph),
// the earlier ruling it replaces — marked **Superseded by:** in place, so a reader of the decisions, and decisions --live,
// see it is not in force — and the issues it settles. Nothing in the loop names the owner: the name `owner` is his, and a
// --by that reads as it is it (rulingAuthor). The owner's words reach the record from --quote alone: the ruling's text and
// every other flag are refused when they hold the marker in any spelling, and the row each settled issue gets names who ruled.
export function cmdDecide(root, slug, ruling, flags = {}) {
  need(slug && ruling, 'decide requires <slug> "<ruling>"');
  const by = flags.by === undefined ? 'coordinator' : rulingAuthor(flags.by);
  const byOwner = by === OWNER;
  need(flags.quote === undefined || typeof flags.quote === 'string', '--quote is the owner\'s own words, as text');
  const quote = flags.quote !== undefined ? fieldText(flags.quote) : null;
  need(flags.quote === undefined || quote, '--quote needs the owner\'s own words');
  need(!byOwner || quote, `a ruling by the owner carries his own words: give them with --quote "<what he said>"; a ruling without --by is recorded as the coordinator's, and a question he asked is not a ruling; a loop that names its owner otherwise records him as owner all the same, for the name owner is the rule`);
  needNoOwnersWords('the ruling', slug, ruling, { ...flags, quote: undefined });
  need(flags.quote === undefined || byOwner, '--quote is the owner\'s own words: it goes with --by owner');
  if (quote) needNoOwnersWords('--quote', quote);
  need(flags.area === undefined || AREA_RE.test(String(flags.area)), `--area names the type of code the ruling reaches, as the repository's graph names it: one word of letters, digits and . _ - (got "${flags.area}")`);
  need(flags.reach === undefined || flags.area !== undefined, '--reach counts the files of the --area type — it needs --area');
  need(flags.reach === undefined || /^\d+$/.test(String(flags.reach)), `--reach is how many files the area holds, a whole number (got "${flags.reach}")`);
  need(flags.rule === undefined || flags.area !== undefined, '--rule names the rule of the graph the ruling admits on the --area type — it needs --area');
  need(flags.rule === undefined || RULE_RE.test(String(flags.rule)), `--rule names a rule as the repository's graph names it: its id, segments of letters, digits and . _ - joined by / (got "${flags.rule}")`);
  const settles = flags.settles !== undefined ? issuesFor(root, flags.settles) : [];
  const area = flags.area !== undefined ? String(flags.area) : null;
  const reach = flags.reach !== undefined ? Number(flags.reach) : null;
  const rule = flags.rule !== undefined ? String(flags.rule) : null;
  const text = freeBlock(oneBreak(ruling).trim());
  appendDecision(root, slug, text, { by, quote, supersedes: flags.supersedes, area, reach, rule, settles: settles.map((i) => i.id) });
  appendLog(root, `decided ${slug} · by ${by}${flags.supersedes !== undefined ? ` · supersedes ${flags.supersedes}` : ''}${area ? ` · area ${area}${reach !== null ? ` (${reach} files)` : ''}${rule ? ` · rule ${rule}` : ''}` : ''}`);
  if (settles.length) {
    const shown = quote ? quoteShown(quote) : null;
    carryingOwnersWords([shown], () => appendRuling(root, settles, `Ruling ${slug} (by ${by}): ${firstLine(oneBreak(ruling).trim(), `${DECISIONS_FILE}, ruling ${slug}`)}${shown ? ` · ${shown}` : ''}`));
  }
  return { slug, by, ...(quote ? { quote } : {}), supersedes: flags.supersedes ?? null, settles: settles.map((i) => i.id), ...(area ? { area, reach, ...(rule ? { rule } : {}) } : {}) };
}

// Whether a question of the record asks about a ruling: a ratify item naming it, or the question the ruling `ask-<n>` was
// written from.
export function questionFor(root, slug) {
  const m = /^ask-(\d+)$/.exec(slug);
  return loadAsks(root).some((a) => a.ruling === slug || (m !== null && idKey(a.id) === idKey(m[1])));
}
// The unfinished issues whose What, Why or Acceptance name a ruling by its slug, as a whole word: the list a supersession
// reports on stderr, so the open issues that cite the ruling it replaces are rewritten. A slug that ends a sentence (a
// stop, a comma, a closing quote or bracket after it) names the ruling; a longer slug that starts with it, hyphenated or
// dotted, does not.
export function issuesNaming(root, slug) {
  const profile = loadProfile(root);
  const named = new RegExp(`(?<![A-Za-z0-9_-])(?<![A-Za-z0-9_]\\.)${slug.replace(/\./g, '\\.')}(?![A-Za-z0-9_]|-[A-Za-z0-9_]|\\.[A-Za-z0-9_])`);
  return loadIssues(root).filter((i) => profile.unfinished(i.status) && named.test([i.sections.what, i.sections.why, i.sections.acceptance].filter(Boolean).join('\n')));
}

// A type name as the repository's graph takes it for a log: one path segment.
export const AREA_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
// A rule id as the graph names it: path segments of the same letters, none of them . or .., joined by /.
export const RULE_RE = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

// The loop has no hand-written handoff: everything a new session needs is in the loop's own files — the goal, the
// rulings, the issues with their leases and After, the asks, the log — and in the repositories they name. resume
// reads it all live, so nothing can be stale and nothing has to be written before a session ends (a session that
// gets cut leaves nothing half-said). Intent lives in the order of the priorities and After, and the reasons in the
// rulings and the issues' bodies. A handoff.md left in a loop is read as history only.
function handoffPath(root) { return join(jarlDir(root), 'handoff.md'); }

// How old a handoff file left in the loop is, against the clock and against the loop's last log line: stale when the loop
// moved on for more than HANDOFF_STALE_MS after it was written. Null when there is no handoff file.
export function handoffAge(root, lastActivity, now = Date.now()) {
  if (!existsSync(handoffPath(root))) return null;
  const text = readText(handoffPath(root));
  const at = new RegExp(`^\\*\\*At:\\*\\* (${STAMP_SRC})`, 'm').exec(text)?.[1] || null;
  const atMs = parseStamp(at);
  if (atMs === null) return { at: null, ageMs: null, staleByMs: null, stale: false };
  const last = parseStamp(lastActivity);
  const staleByMs = last !== null && last - atMs > HANDOFF_STALE_MS ? last - atMs : 0;
  return { at, ageMs: now - atMs, staleByMs, stale: staleByMs > 0 };
}

// ---- the ratification batch: area rulings the owner admits when the loop closes ---------------------------

// At most this many area rulings wait for the owner's word at once; the rest wait for the next close.
export const RATIFY_BATCH = 10;
// A ruling's first sentence, as the batch quotes it.
function firstSentence(text) {
  const line = String(text).split('\n').map((l) => l.trim()).find(Boolean) || '';
  const s = /^.+?[.!?](?=\s|$)/.exec(line)?.[0] || line;
  return s.length > 200 ? `${s.slice(0, 199)}…` : s;
}

// The batch: every open ratify item that asks about an area ruling, and new ones filed for the area rulings in force
// that no item has asked about yet — the widest reach first (a ruling with no count last, then oldest first) — up to
// RATIFY_BATCH open in all. A ruling already ratified or rejected is never asked again. Nothing here blocks anything.
export function ratificationBatch(root) {
  const asks = loadAsks(root);
  const asked = new Set(asks.filter((a) => a.ruling).map((a) => a.ruling));
  const pending = asks.filter((a) => a.ruling && a.state === 'open');
  const rulings = loadDecisions(root);
  const candidates = rulings
    .filter((d) => d.area && !d.supersededBy && !d.ratified && !d.rejected && !asked.has(d.slug))
    .map((d, n) => ({ d, n }))
    .sort((a, b) => (b.d.reach ?? -1) - (a.d.reach ?? -1) || a.n - b.n)
    .map((x) => x.d);
  const room = Math.max(0, RATIFY_BATCH - pending.length);
  const filed = candidates.slice(0, room).map((d) => {
    const reach = d.reach !== null ? `${d.reach} file${d.reach === 1 ? '' : 's'}` : 'files not counted';
    // A rule's ratification admits it, as it stands now, on every type the graph has it reach — Yggdrasil reads them,
    // not Jarl — so the question says so: a yes about one area must not pass for consent to less than it gives.
    const scope = d.rule ? `, and to ratify rule ${d.rule} as it stands now on every type the graph has it reach (not only ${d.area})` : '';
    return cmdAsk(root, `area ${d.area}${d.rule ? ` · rule ${d.rule}` : ''} · ${reach} · ${d.slug}: "${firstSentence(d.ruling)}" — yes (tak) to admit it into the type's decisions${scope}, reject (nie) to leave it a ruling of this loop`, { kind: 'ratify', ruling: d.slug }).id;
  });
  const bySlug = new Map(rulings.map((d) => [d.slug, d]));
  const items = loadAsks(root).filter((a) => a.ruling && a.state === 'open').map((a) => {
    const d = bySlug.get(a.ruling);
    return { ask: `a-${a.id}`, ruling: a.ruling, area: d?.area ?? null, reach: d?.reach ?? null, rule: d?.rule ?? null, question: a.question };
  });
  return { items, filed: filed.map((id) => `a-${id}`), waiting: candidates.length - filed.length };
}

// decisions [--live]: the rulings, oldest first, each with who ruled and what superseded it; --live leaves out
// the superseded ones — what a session reads at boot as the rulings in force.
export function cmdDecisions(root, flags = {}) {
  const all = loadDecisions(root);
  return flags.live ? all.filter((d) => !d.supersededBy) : all;
}
// decide: what was ruled, and what the ruling did to the others.
export function renderDecide(out) {
  const area = out.area ? ` · area ${out.area}${out.reach !== null ? ` (${out.reach} file${out.reach === 1 ? '' : 's'})` : ''}${out.rule ? ` · rule ${out.rule}` : ''} · put to ratification at close` : '';
  return `decided ${out.slug} · by ${out.by}${out.supersedes ? ` · supersedes ${out.supersedes}` : ''}${out.settles.length ? ` · written into ${out.settles.join(', ')}` : ''}${area}`;
}
// decisions: one line per ruling, its first line cut at 160 characters.
export function renderDecisions(rows) {
  if (!rows.length) return '(no rulings)';
  return rows.map((d) => {
    const area = d.area ? ` · area ${d.area}${d.rule ? ` · rule ${d.rule}` : ''}${d.ratified ? ' ratified' : d.rejected ? ' rejected' : ''}` : '';
    const quoted = d.quote ? ` · ${quoteShown(d.quote.split('\n')[0].slice(0, 160))}` : '';
    return `${d.date} · ${d.slug}${d.by ? ` · by ${d.by}` : ''}${area}${d.supersededBy ? ` · SUPERSEDED by ${d.supersededBy}` : ''}${d.supersedes ? ` · supersedes ${d.supersedes}` : ''} — ${(d.ruling.split('\n').find((l) => l.trim()) || '').slice(0, 160)}${quoted}`;
  }).join('\n');
}

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { handoffPath };
