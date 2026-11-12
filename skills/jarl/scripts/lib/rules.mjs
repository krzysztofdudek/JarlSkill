// Rules with a scope: a ruling that says whom it applies to and until when, and the rules Jarl ships itself, quoted
// from the role references. A view or a brief prints the rules that match whoever reads it, whole, and no other.
//
// A ruling's scope is its **Applies to:** line, the first line of its closing block:
//   **Applies to:** <selector> [and <selector>]… [· until <yyyy-mm-dd> | · until issue <id> closes]
// A selector is `loop`, or a word and one value: role, slice, moment (who reads, and when), and issue, tag, kind, tier,
// files, repo (the issue the reader works on). Every selector must hold, and the issue selectors for one and the same
// issue. A rule ends at the end of its date, when its issue closes, or when a later ruling supersedes it.

import { fieldText, hole, need } from './base.mjs';
import { idKey } from './ids.mjs';
import { answeredLines } from './journal.mjs';
import { sameSlice, sliceOf } from './slices.mjs';
import { declaredNames, repoLabelOf, repoNames } from './repositories.mjs';

export const RULE_ROLES = Object.freeze(['jarl', 'coordinator', 'worker', 'reviewer', 'merger', 'takeover']);
export const RULE_MOMENTS = Object.freeze(['filing', 'start', 'review', 'round', 'merge', 'done', 'close']);
export const RULE_SELECTORS = Object.freeze(['loop', 'role', 'slice', 'moment', 'issue', 'tag', 'kind', 'tier', 'files', 'repo']);
// The selectors read from the reader; the rest are read from an issue the reader works on.
const READER_SELECTORS = new Set(['loop', 'role', 'moment']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISSUE_RE = /^#?\d+$/;
const SCOPE_SHAPE = 'loop, or selectors joined by "and": role <role>, slice <coordinator>, moment <moment>, issue <id>, tag <tag>, kind <kind>, tier <tier>, files <path>, repo <name>';

// Where one selector of a scope is refused: the scope with that selector, or its value, a placeholder, the others kept.
const scopeHole = (raw, part, words) => raw.replace(part, () => words);
// The selectors of an Applies to text, as [{ word, value }]. A refusal names the shape.
export function parseScope(text) {
  const raw = fieldText(text);
  need(raw, `--applies-to names whom the rule applies to: ${SCOPE_SHAPE}`, () => ({ flag: '--applies-to', value: '<selectors>' }));
  const parts = raw.split(/\s+and\s+/i).map((p) => p.trim());
  const selectors = parts.map((p) => {
    if (/^loop$/i.test(p)) return { word: 'loop', value: null };
    const m = /^([a-z]+)\s+(\S+)$/i.exec(p);
    need(m && RULE_SELECTORS.includes(m[1].toLowerCase()) && m[1].toLowerCase() !== 'loop', `"${p}" is not a selector of --applies-to: ${SCOPE_SHAPE}`, () => ({ flag: '--applies-to', value: scopeHole(raw, p, hole('<selector>')) }));
    const word = m[1].toLowerCase();
    const value = m[2];
    if (word === 'role') need(RULE_ROLES.includes(value.toLowerCase()), `role ${value} is not a role a rule reaches: ${RULE_ROLES.join(', ')}`, () => ({ flag: '--applies-to', value: scopeHole(raw, p, `role ${hole('<role>')}`) }));
    if (word === 'moment') need(RULE_MOMENTS.includes(value.toLowerCase()), `moment ${value} is not a moment of work: ${RULE_MOMENTS.join(', ')}`, () => ({ flag: '--applies-to', value: scopeHole(raw, p, `moment ${hole('<moment>')}`) }));
    if (word === 'issue') need(ISSUE_RE.test(value), `issue ${value} is not an issue number`, () => ({ flag: '--applies-to', value: scopeHole(raw, p, `issue ${hole('<id>')}`) }));
    return { word, value: word === 'role' || word === 'moment' ? value.toLowerCase() : word === 'issue' ? value.replace(/^#/, '') : value };
  });
  need(!(selectors.length > 1 && selectors.some((s) => s.word === 'loop')), `loop takes no other selector: a rule of the loop reaches every reader of it (got "${raw}"); it is loop alone, or the other selectors without it`, () => ({ flag: '--applies-to', value: hole('<selectors>') }));
  return selectors;
}

// The refusal of a repo selector that no repository of the loop answers to: a rule scoped to it would reach nobody. A
// repository the loop knows is one declared in it or named by an issue (the loop's own, when an issue names none), in the
// spelling of a name or of a path.
export function needKnownRepos(root, loop, selectors, raw) {
  const known = [...new Set([...declaredNames(root), ...loop.issues.flatMap((i) => repoNames(root, i))])];
  for (const s of selectors.filter((x) => x.word === 'repo')) {
    need(known.some((n) => n.toLowerCase() === repoLabelOf(root, s.value).toLowerCase()), `repo ${s.value} is not a repository of this loop: ${known.length ? known.join(', ') : '(none declared, and no issue names one)'} — a rule scoped to it would reach no one; name a repository by its name or a path to it`, () => ({ flag: '--applies-to', value: scopeHole(raw, `repo ${s.value}`, `repo ${hole('<name-or-path>')}`) }));
  }
}

// The end of a rule from --until: a date (the rule holds through that day) or an issue (it holds until the issue closes).
export function parseUntil(text) {
  const raw = fieldText(text).replace(/^issue\s+/i, '');
  if (DATE_RE.test(raw)) return { date: raw };
  need(ISSUE_RE.test(raw), `--until is a date (yyyy-mm-dd), through which the rule holds, or the issue whose closing ends it (got "${fieldText(text)}")`, () => ({ flag: '--until', value: '<yyyy-mm-dd>' }));
  return { issue: raw.replace(/^#/, '') };
}

export const scopeText = (selectors) => selectors.map((s) => (s.word === 'loop' ? 'loop' : `${s.word} ${s.value}`)).join(' and ');
export const untilText = (until) => (until === null ? '' : until.date ? `until ${until.date}` : `until issue ${until.issue} closes`);
// The Applies to line's value, as the ruling holds it.
export function appliesToLine(selectors, until) {
  return `${scopeText(selectors)}${until ? ` · ${untilText(until)}` : ''}`;
}
// An Applies to value read back: { selectors, until } or, for a line that does not parse, { selectors: null, until: null,
// unread: the reason } — such a rule reaches no one, and decisions says why.
export function readAppliesTo(value) {
  const [scope, end] = String(value).split(/\s+·\s+/);
  try {
    const selectors = parseScope(scope);
    let until = null;
    if (end !== undefined) {
      const m = /^until\s+(?:(\d{4}-\d{2}-\d{2})|issue\s+#?(\d+)\s+closes)$/i.exec(end.trim());
      need(m, `"${end}" is not the end of a rule: until <yyyy-mm-dd> or until issue <id> closes`, () => ({ flag: '--until', value: '<yyyy-mm-dd>' }));
      until = m[1] ? { date: m[1] } : { issue: m[2] };
    }
    return { selectors, until };
  } catch (e) {
    return { selectors: null, until: null, unread: e.message };
  }
}

// Why a rule has ended, or null while it holds: superseded, past its date, or its issue closed.
export function ruleEnd(rule, loop, today) {
  if (rule.supersededBy) return `superseded by ${rule.supersededBy}`;
  const { until } = rule;
  if (!until) return null;
  if (until.date) return today > until.date ? `ended ${until.date}` : null;
  const issue = loop.issues.find((i) => idKey(i.id) === idKey(until.issue));
  return issue && loop.profile.is(issue.status, 'terminal') ? `ended when ${issue.id} closed (${issue.status})` : null;
}

// The rules Jarl ships: its own role guidance, each quoted whole from the reference that holds it, which stays its one
// source (a test holds every quote to its reference). Their slugs start with jarl: so they never meet a ruling's.
export const BUILTIN_RULES = Object.freeze([
  { slug: 'jarl:reviewer-every-round', scope: 'role reviewer and moment round', source: 'references/jarl.md',
    text: 'Every round, re-check every acceptance line of the issue, not only the findings of the round before.' },
  { slug: 'jarl:reviewer-tier-above', scope: 'role reviewer', source: 'references/jarl.md',
    text: 'Work on a record format, a contract or what a person sees is reviewed a tier above the worker.' },
  { slug: 'jarl:reviewer-judges-the-issue', scope: 'role reviewer', source: 'references/jarl.md',
    text: "The verdict judges the issue's acceptance and what the change itself broke; a finding outside that is filed as a new issue and never turns the verdict to changes." },
  { slug: 'jarl:worker-only-the-issue', scope: 'role worker', source: 'references/family-rules.md',
    text: 'Change only what the issue needs. Something else seen on the way is reported for filing, not fixed in passing.' },
  { slug: 'jarl:coordinator-escalates', scope: 'role coordinator', source: 'references/jarl.md',
    text: "It goes up with `ask \"<text>\" --kind escalation --slice <name>` (and `--issue <id>` when one issue is the subject), which the jarl holds and answers, for these four and no other:\n1. a gap or a finding outside its slice's goal;\n2. a decision that is the jarl's or the owner's;\n3. its slice empty, or blocked by another slice;\n4. a takeover that failed too." },
  { slug: 'jarl:coordinator-pull-push', scope: 'role coordinator', source: 'references/jarl.md',
    text: 'Pull before leasing and push right after when the loop is shared between clones.' },
  { slug: 'jarl:coordinator-scope-holds', scope: 'role coordinator', source: 'references/jarl.md',
    text: "An issue's scope does not grow once it is leased: a new ask becomes a new issue." },
].map((r) => Object.freeze({ ...r, selectors: parseScope(r.scope), until: null, builtin: true })));

// A path the files selector names matches a file of an issue: the same path, a file under it as a directory, or a pattern
// where * stands for any part of one path segment and ** for any number of segments.
function fileMatches(pattern, file) {
  const p = String(pattern).replace(/^\.\//, '');
  const f = String(file).replace(/^\.\//, '');
  if (!p.includes('*')) return f === p || f.startsWith(p.endsWith('/') ? p : `${p}/`);
  const re = new RegExp(`^${p.split('**').map((part) => part.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*')}$`);
  return re.test(f);
}
// Whether one issue holds every issue selector of a rule. An issue selector holds for the issue it names and for every
// issue under it in the tree, so a rule of a parent reaches its sub-issues.
function issueHolds(root, issue, selectors) {
  return selectors.every(({ word, value }) => {
    if (word === 'issue') return [issue, ...(issue.tree ? issue.tree.ancestors : [])].some((i) => idKey(i.id) === idKey(value));
    if (word === 'tag') return (issue.tags || []).some((t) => t.toLowerCase() === value.toLowerCase());
    if (word === 'kind') return String(issue.kind).toLowerCase() === value.toLowerCase();
    if (word === 'tier') return String(issue.tier).toLowerCase() === value.toLowerCase();
    if (word === 'slice') return sameSlice(sliceOf(issue), value);
    if (word === 'files') return (issue.files || []).some((f) => fileMatches(value, f));
    if (word === 'repo') return repoNames(root, issue).some((n) => n.toLowerCase() === repoLabelOf(root, value).toLowerCase());
    return false;
  });
}
// Whether a rule reaches a role at all: its scope names that role or names none. The moment, slice and issue selectors
// narrow what the role is handed, and a role is handed a rule on the work that matches them, so they do not keep it out here.
export function ruleReachesRole(rule, role) {
  return Boolean(rule.selectors) && rule.selectors.every((s) => s.word !== 'role' || s.value === role);
}
export function needRuleRole(role) {
  need(RULE_ROLES.includes(String(role).toLowerCase()), `${role} is not a role a rule reaches: ${RULE_ROLES.join(', ')}`, () => ({ flag: '--as', value: hole('<role>') }));
  return String(role).toLowerCase();
}
// Whether a rule matches a reader: { roles, slice, moments, issues }. The reader's selectors hold for the reader, a slice
// holds for the coordinator of that slice or for an issue in it, and the issue selectors hold for one issue the reader
// works on.
export function ruleMatches(root, rule, reader) {
  if (!rule.selectors) return false;
  const onIssue = [];
  for (const s of rule.selectors) {
    if (s.word === 'loop') continue;
    if (s.word === 'role') { if (!reader.roles.has(s.value)) return false; continue; }
    if (s.word === 'moment') { if (!reader.moments.has(s.value)) return false; continue; }
    if (s.word === 'slice' && reader.slice != null && sameSlice(reader.slice, s.value)) continue;
    if (!READER_SELECTORS.has(s.word)) onIssue.push(s);
  }
  return !onIssue.length || reader.issues.some((i) => issueHolds(root, i, onIssue));
}

// The loop's rules: every ruling with an Applies to line, read, with its end (null while it holds), and, for one made
// under a ruling that is not in force, why not (underNotInForce).
export function loopRules(loop, today) {
  const rules = loop.decisions.filter((d) => d.appliesTo).map((d) => {
    const read = readAppliesTo(d.appliesTo);
    const rule = { slug: d.slug, date: d.date, by: d.by, under: d.under, text: ruleText(d), scope: read.selectors ? scopeText(read.selectors) : d.appliesTo, selectors: read.selectors, until: read.until, supersededBy: d.supersededBy, ...(read.unread ? { unread: read.unread } : {}) };
    return { ...rule, ended: ruleEnd(rule, loop, today) };
  });
  const ended = new Set(rules.filter((r) => r.ended).map((r) => r.slug));
  return rules.map((r) => withUnder(loop.decisions, r, ended));
}
// Why the ruling a ruling names as the one it rests on (its Made under paragraph, whoever wrote it) does not hold, or null
// while it is in force: no ruling of the loop has that slug, a later ruling supersedes it, the owner rejected it as an area
// ruling, or it is a rule that has ended. `ended` holds the slugs of the rules that have ended.
export function underNotInForce(decisions, slug, ended) {
  const d = decisions.find((x) => x.slug === slug);
  if (!d) return 'no ruling of this loop';
  if (d.supersededBy) return `superseded by ${d.supersededBy}`;
  if (d.rejected) return 'rejected by the owner';
  if (ended.has(slug)) return 'a rule that has ended';
  return null;
}
// A ruling as a view carries it, with underNotInForce when the ruling it is made under does not hold.
export function withUnder(decisions, d, ended) {
  const lapse = d.under ? underNotInForce(decisions, d.under, ended) : null;
  return lapse ? { ...d, underNotInForce: lapse } : d;
}
// The words a view prints for the ruling a ruling is made under, marked when that ruling is not in force.
export const underText = (r) => `under ${r.under}${r.underNotInForce ? ` (not in force: ${r.underNotInForce})` : ''}`;
// The text a rule delivers: its ruling, or, for an accepted proposal (the answer to a question of kind rule), the rule
// it proposed, every line of it: the question, up to the line of its answer.
function ruleText(d) {
  const lines = d.ruling.split('\n');
  if (!/^ask-\d+$/.test(d.slug) || !lines[0].startsWith('**Question:** ')) return withoutHistory(d.ruling);
  const answered = answeredLines(d);
  const end = answered ? lines.findIndex((l, n) => n > 0 && l.trim() === answered.answer) : -1;
  return [lines[0].slice('**Question:** '.length), ...lines.slice(1, end === -1 ? lines.length : end)].join('\n').trim();
}
// A ruling's text without the closing paragraphs that record how it came to be: the ruling it was made under and the owner's
// words. A rule is delivered as the instruction alone; its head names who ruled and what it rests on, and the record keeps the
// rest.
const HISTORY_LINE = /^(?:Made under: [A-Za-z0-9][A-Za-z0-9._-]{0,79}|The owner's words: ".*")$/;
export function withoutHistory(text) {
  const lines = String(text).split('\n');
  for (;;) {
    const last = lines.findLastIndex((l) => l.trim() !== '');
    if (last <= 0 || !HISTORY_LINE.test(lines[last]) || lines[last - 1].trim() !== '') break;
    lines.length = last;
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  }
  return lines.join('\n');
}
// Whether a ruling's words read as an instruction to an agent. The ruling's own sentences are read, after the attribution that
// opens a quoted word of the owner's. A sentence is an instruction when it opens with a word that commands or forbids or
// with a verb of work, when an agent (you, a worker, a reviewer, the jarl, no agent) is the one it obliges or forbids, or
// when it says where work goes or what it avoids. A word that obliges or forbids inside a sentence about something else (a
// file that is never decoded, a test that must stay green, a release that was never published) describes and does not
// instruct. A ruling that reads so and names no one it applies to is delivered to no one.
const ATTRIBUTION = /^(?:the owner|krzysztof|the jarl)\b[^:\n]{0,200}?:\s*/i;
const OPENS = /^(?:never|always|do not|don't|please|only|stop|avoid|prefer|ensure|make sure|use|run|keep|write|read|check|file|ask|report|name|send|open|close|add|pass|give|put|take|start|wait|call|set|list|say|state|show|attach|record|pin|make|follow|test|review|commit|push|merge|raise|pull|tell|do)\b/i;
const AGENT = '(?:you|agents?|workers?|reviewers?|examiners?|coordinators?|mergers?|jarl|everyone|nobody|no one)';
const OBLIGES_AN_AGENT = new RegExp(`\\b${AGENT}\\b[^.!?;]{0,40}\\b(?:must|should|shall|never|always|do not|don't|may not|is to|are to)\\b`, 'i');
const PLACES_WORK = /^[\w'-]+(?: [\w'-]+){0,2} (?:goes|go) to\b|\bavoids?\b/i;
export function readsAsInstruction(text) {
  const body = withoutHistory(String(text)).replace(/[\u201C\u201D"]/g, '').replace(ATTRIBUTION, '');
  return body.split(/(?<=[.!?])\s+|\n+|;\s+/).map((x) => x.trim().replace(/^\([^)]*\)\s*/, '')).some((x) => OPENS.test(x) || OBLIGES_AN_AGENT.test(x) || PLACES_WORK.test(x));
}
// The rules that match a reader, whole: the loop's rules in force first, then Jarl's own.
export function rulesFor(root, loop, reader, today) {
  const own = loopRules(loop, today).filter((r) => !r.ended && ruleMatches(root, r, reader));
  return [...own, ...BUILTIN_RULES.filter((r) => ruleMatches(root, r, reader))];
}
// One rule as a view prints it: its slug and scope, its end when it has one, who ruled and the ruling it rests on (Jarl's
// own: the reference it is quoted from), then its text whole, each further line indented.
export function ruleLines(r) {
  const head = `- ${r.slug} · ${r.scope}${r.until ? ` · ${untilText(r.until)}` : ''}${r.builtin ? ` · ${r.source}` : `${r.by ? ` · by ${r.by}` : ''}${r.under ? ` · ${underText(r)}` : ''}`}`;
  const lines = String(r.text).split('\n');
  return [`${head} — ${lines[0]}`, ...lines.slice(1).map((l) => `  ${l}`)];
}
