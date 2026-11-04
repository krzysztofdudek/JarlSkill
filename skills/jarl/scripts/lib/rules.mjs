// Rules with a scope: a ruling that says whom it applies to and until when, and the rules Jarl ships itself, quoted
// from the role references. A view or a brief prints the rules that match whoever reads it, whole, and no other.
//
// A ruling's scope is its **Applies to:** line, the first line of its closing block:
//   **Applies to:** <selector> [and <selector>]… [· until <yyyy-mm-dd> | · until issue <id> closes]
// A selector is `loop`, or a word and one value: role, slice, moment (who reads, and when), and issue, tag, kind, tier,
// files, repo (the issue the reader works on). Every selector must hold, and the issue selectors for one and the same
// issue. A rule ends at the end of its date, when its issue closes, or when a later ruling supersedes it.

import { fieldText, need } from './base.mjs';
import { idKey } from './ids.mjs';
import { sameSlice, sliceOf } from './loop.mjs';
import { repoNames } from './repositories.mjs';

export const RULE_ROLES = Object.freeze(['jarl', 'coordinator', 'worker', 'reviewer', 'merger', 'takeover']);
export const RULE_MOMENTS = Object.freeze(['filing', 'start', 'review', 'round', 'merge', 'done', 'close']);
export const RULE_SELECTORS = Object.freeze(['loop', 'role', 'slice', 'moment', 'issue', 'tag', 'kind', 'tier', 'files', 'repo']);
// The selectors read from the reader; the rest are read from an issue the reader works on.
const READER_SELECTORS = new Set(['loop', 'role', 'moment']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISSUE_RE = /^#?\d+$/;
const SCOPE_SHAPE = 'loop, or selectors joined by "and": role <role>, slice <coordinator>, moment <moment>, issue <id>, tag <tag>, kind <kind>, tier <tier>, files <path or pattern>, repo <repository>';

// The selectors of an Applies to text, as [{ word, value }]. A refusal names the shape.
export function parseScope(text) {
  const raw = fieldText(text);
  need(raw, `--applies-to names whom the rule applies to: ${SCOPE_SHAPE}`);
  const parts = raw.split(/\s+and\s+/i).map((p) => p.trim());
  const selectors = parts.map((p) => {
    if (/^loop$/i.test(p)) return { word: 'loop', value: null };
    const m = /^([a-z]+)\s+(\S+)$/i.exec(p);
    need(m && RULE_SELECTORS.includes(m[1].toLowerCase()) && m[1].toLowerCase() !== 'loop', `"${p}" is not a selector of --applies-to: ${SCOPE_SHAPE}`);
    const word = m[1].toLowerCase();
    const value = m[2];
    if (word === 'role') need(RULE_ROLES.includes(value.toLowerCase()), `role ${value} is not a role a rule reaches: ${RULE_ROLES.join(', ')}`);
    if (word === 'moment') need(RULE_MOMENTS.includes(value.toLowerCase()), `moment ${value} is not a moment of work: ${RULE_MOMENTS.join(', ')}`);
    if (word === 'issue') need(ISSUE_RE.test(value), `issue ${value} is not an issue number`);
    return { word, value: word === 'role' || word === 'moment' ? value.toLowerCase() : word === 'issue' ? value.replace(/^#/, '') : value };
  });
  need(!(selectors.length > 1 && selectors.some((s) => s.word === 'loop')), 'loop takes no other selector: a rule of the loop reaches every reader of it');
  return selectors;
}

// The end of a rule from --until: a date (the rule holds through that day) or an issue (it holds until the issue closes).
export function parseUntil(text) {
  const raw = fieldText(text).replace(/^issue\s+/i, '');
  if (DATE_RE.test(raw)) return { date: raw };
  need(ISSUE_RE.test(raw), `--until is a date (yyyy-mm-dd), through which the rule holds, or the issue whose closing ends it (got "${fieldText(text)}")`);
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
      need(m, `"${end}" is not the end of a rule: until <yyyy-mm-dd> or until issue <id> closes`);
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
  { slug: 'jarl:reviewer-every-round', scope: 'role reviewer and moment round', source: 'references/reviewer.md',
    text: 'Every round, re-check every acceptance line of the issue, not only the findings of the round before.' },
  { slug: 'jarl:reviewer-light-tier', scope: 'role reviewer and tier light', source: 'references/reviewer.md',
    text: 'On work done on the light tier, re-run each command a proof row names.' },
  { slug: 'jarl:reviewer-tier-above', scope: 'role reviewer', source: 'references/reviewer.md',
    text: 'Work on a record format, a contract or what a person sees is reviewed a tier above the worker.' },
  { slug: 'jarl:reviewer-identical-output', scope: 'role reviewer', source: 'references/reviewer.md',
    text: 'A change meant to alter nothing is reviewed by checking that its comparison of the output before and after covers everything the change touched.' },
  { slug: 'jarl:reviewer-judges-the-issue', scope: 'role reviewer', source: 'references/reviewer.md',
    text: "The verdict judges the issue's acceptance and what the change itself broke; a finding outside that is filed as a new issue and never turns the verdict to changes." },
  { slug: 'jarl:worker-only-the-issue', scope: 'role worker', source: 'SKILL.md',
    text: 'Change only what the issue needs. Something else seen on the way is reported for filing, not fixed in passing.' },
  { slug: 'jarl:coordinator-escalates', scope: 'role coordinator', source: 'references/jarl.md',
    text: "It goes up with `ask \"<question>\" --kind escalation --slice <name>` (and `--issue <id>` when one issue is the subject), which the jarl holds and answers, for these four and no other:\n1. a gap or a finding outside its slice's goal;\n2. a decision that is the jarl's or the owner's;\n3. its slice empty, or blocked by another slice;\n4. a takeover that failed too." },
  { slug: 'jarl:coordinator-pull-push', scope: 'role coordinator', source: 'references/jarl.md',
    text: 'Pull before leasing and push right after when the loop is shared between clones.' },
  { slug: 'jarl:coordinator-shared-review', scope: 'role coordinator and moment review', source: 'references/jarl.md',
    text: 'One shared review covers only issues that are one contract or one screen, at most four.' },
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
// Whether one issue holds every issue selector of a rule.
function issueHolds(root, issue, selectors) {
  return selectors.every(({ word, value }) => {
    if (word === 'issue') return idKey(issue.id) === idKey(value);
    if (word === 'tag') return (issue.tags || []).some((t) => t.toLowerCase() === value.toLowerCase());
    if (word === 'kind') return String(issue.kind).toLowerCase() === value.toLowerCase();
    if (word === 'tier') return String(issue.tier).toLowerCase() === value.toLowerCase();
    if (word === 'slice') return sameSlice(sliceOf(issue), value);
    if (word === 'files') return (issue.files || []).some((f) => fileMatches(value, f));
    if (word === 'repo') return repoNames(root, issue).some((n) => n.toLowerCase() === value.toLowerCase());
    return false;
  });
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

// The loop's rules: every ruling with an Applies to line, read, with its end (null while it holds).
export function loopRules(loop, today) {
  return loop.decisions.filter((d) => d.appliesTo).map((d) => {
    const read = readAppliesTo(d.appliesTo);
    const rule = { slug: d.slug, date: d.date, by: d.by, under: d.under, text: ruleText(d), scope: read.selectors ? scopeText(read.selectors) : d.appliesTo, selectors: read.selectors, until: read.until, supersededBy: d.supersededBy, ...(read.unread ? { unread: read.unread } : {}) };
    return { ...rule, ended: ruleEnd(rule, loop, today) };
  });
}
// The text a rule delivers: its ruling, or, for an accepted proposal (the answer to a question of kind rule), the rule
// it proposed.
function ruleText(d) {
  const first = d.ruling.split('\n')[0] || '';
  if (/^ask-\d+$/.test(d.slug) && first.startsWith('**Question:** ')) return first.slice('**Question:** '.length).trim();
  return d.ruling;
}
// The rules that match a reader, whole: the loop's rules in force first, then Jarl's own.
export function rulesFor(root, loop, reader, today) {
  const own = loopRules(loop, today).filter((r) => !r.ended && ruleMatches(root, r, reader));
  return [...own, ...BUILTIN_RULES.filter((r) => ruleMatches(root, r, reader))];
}
// One rule as a view prints it: its slug and scope, its end when it has one, who ruled and the ruling it rests on (Jarl's
// own: the reference it is quoted from), then its text whole, each further line indented.
export function ruleLines(r) {
  const head = `- ${r.slug} · ${r.scope}${r.until ? ` · ${untilText(r.until)}` : ''}${r.builtin ? ` · ${r.source}` : `${r.by ? ` · by ${r.by}` : ''}${r.under ? ` · under ${r.under}` : ''}`}`;
  const lines = String(r.text).split('\n');
  return [`${head} — ${lines[0]}`, ...lines.slice(1).map((l) => `  ${l}`)];
}
