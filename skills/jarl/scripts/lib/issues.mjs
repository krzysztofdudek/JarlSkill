// An issue file: its header fields, its sections, the rows of its Evidence and the entries of its Reviews.

import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CI_STATES, fieldText, need, oneBreak, splitList } from './base.mjs';
import { issuesDir, jarlDir } from './where.mjs';
import { readText } from './files.mjs';
import { ISSUE_FILE_RE, cmpId, idKey, idRe, newNumber, writtenForms, writtenId } from './ids.mjs';
import { loadProfile } from './profile.mjs';
import { DECISION_HEAD, DECISION_META } from './journal.mjs';
import { eventsById, issueState, loopEvents } from './log.mjs';

// ---- issues ------------------------------------------------------------------------------------

// A header field: **Name:** value. A name is letters, digits, spaces and dashes, so a profile's fields (Area-2) read
// as fields; the built-in ones are letters and spaces only.
const FIELD_RE = /^\*\*([A-Za-z0-9 -]+):\*\*\s*(.*)$/;

// With `skipped` (an array), what the parser does not place is pushed onto it as { n, text, reason }: the first line when it
// is not an issue's header, and a Resources line one of whose names is not a word (letters, digits and . _ : / -).
export function parseIssue(text, file, skipped) {
  const lines = text.split('\n');
  const head = idRe('^#\\s+({id})\\s+·\\s+(.*)$').exec(lines[0] || '');
  if (skipped && !head) skipped.push({ n: 1, text: lines[0] || '', reason: 'not an issue header: the first line is "# <id> · <title>"' });
  if (skipped) {
    lines.forEach((line, i) => {
      const f = FIELD_RE.exec(line);
      if (!f || f[1].toLowerCase() !== 'resources') return;
      for (const name of splitList(f[2])) {
        if (!/^[A-Za-z0-9._:/-]+$/.test(name)) { skipped.push({ n: i + 1, text: line, reason: `the resource "${fieldText(name)}" is not a word: resource names are letters, digits and . _ : / -` }); break; }
      }
    });
  }
  const issue = { file, id: head ? head[1] : null, title: head ? head[2].trim() : '', fields: {}, sections: {} };
  let section = null;
  for (const line of lines.slice(1)) {
    const f = FIELD_RE.exec(line);
    if (f && section === null) { issue.fields[f[1].toLowerCase()] = f[2].trim(); continue; }
    const h = /^##\s+(.*)$/.exec(line);
    if (h) { section = h[1].trim().toLowerCase(); issue.sections[section] = ''; continue; }
    if (section !== null) issue.sections[section] += line + '\n';
  }
  issue.status = issue.fields.status || 'open';
  issue.kind = issue.fields.kind || '';
  issue.priority = issue.fields.priority || '2';
  issue.tier = issue.fields.tier || 'standard';
  issue.tags = (issue.fields.tags || '').split(',').map((s) => s.trim()).filter(Boolean);
  issue.files = (issue.fields.files || '').split(',').map((s) => s.trim()).filter(Boolean);
  // Both fields are optional: an issue without them reads as waiting on nothing and filed from no finding.
  issue.after = splitList(issue.fields.after).map(idKey);
  // The exclusive resources it holds while its lease lasts (names, loop-wide, never files); next and the lease read them.
  issue.resources = splitList(issue.fields.resources);
  issue.sources = splitList(issue.fields.source);
  return issue;
}

export function loadIssues(root) {
  if (!existsSync(issuesDir(root))) return [];
  return issuesAt(jarlDir(root), loadProfile(root));
}
// The issues of the record held in `recordDir`, read under `profile`: each one's text, and for the status, lease, merge
// and CI the state the record's journal (`events`, read here when not handed in) says, which is what the commands wrote
// beside it. What the header says is kept in issue.onFile.
function issuesAt(recordDir, profile, events = loopEvents(recordDir, profile)) {
  const dir = join(recordDir, 'issues');
  if (!existsSync(dir)) return [];
  const by = eventsById(events);
  const forms = writtenForms(readdirSync(dir));
  const parsed = readdirSync(dir).filter((f) => ISSUE_FILE_RE.test(f)).sort((a, b) => cmpId(ISSUE_FILE_RE.exec(a)[1], ISSUE_FILE_RE.exec(b)[1]) || (a < b ? -1 : a > b ? 1 : 0))
    .map((f) => withProfile(parseIssue(readText(join(dir, f)), join(dir, f)), profile));
  const files = new Map();
  for (const i of parsed) if (i.id !== null) files.set(idKey(i.id), (files.get(idKey(i.id)) || 0) + 1);
  const issues = parsed.map((issue) => {
    // An After names an issue as the loop writes it: the form its file carries, whatever form the After line gives.
    issue.after = issue.after.map((x) => writtenId(x, forms));
    const events = by.get(issue.id) || [];
    // Filings are counted by what they file: a filing line repeated with the same title (a line copied in the log) files
    // the same issue again, while two titles under one number are two issues.
    const filings = new Set(events.filter((e) => e.type === 'filed').map((e) => e.text.replace(/^filed \S+ · /, ''))).size;
    // A number two files carry, or one the log files more than once, is one the log cannot attribute: it cannot say which
    // file its lines were written for. Such an issue is read from its own header, never from the log.
    if (issue.id !== null && (files.get(idKey(issue.id)) > 1 || filings > 1)) return headerRead(issue, filings);
    return withRecordState(issue, issueState(profile, events));
  });
  // An issue whose number another file carries too holds the files of that number in `shared`, which the views print;
  // every other issue has no such key.
  for (const s of sharedNumbers(issues)) for (const i of s.issues) i.shared = s.issues.map((x) => `issues/${basename(x.file)}`);
  return issues;
}
// The header fields the commands render from the journal, as the fields of an issue name them.
const RENDERED_FIELDS = ['branch', 'worker', 'model', 'since', 'merged', 'merge check', 'ci'];
// An issue with the state its journal gives in place of the one its header says. The header as read stays in
// issue.onFile (not enumerable, so a copy of the issue does not carry it): status and the fields above, each as the file
// has it. An issue the journal holds no filing and no move of (state null) keeps its header, and onFile is null.
function withRecordState(issue, state) {
  const onFile = { status: issue.status, ...Object.fromEntries(RENDERED_FIELDS.map((k) => [k, issue.fields[k] ?? null])) };
  Object.defineProperty(issue, 'onFile', { value: state ? onFile : null, enumerable: false, configurable: true });
  if (!state) return issue;
  issue.status = state.status;
  issue.fields.status = state.status;
  for (const k of RENDERED_FIELDS) {
    if (state[k] !== null) issue.fields[k] = state[k];
    else delete issue.fields[k];
  }
  return issue;
}
// An issue whose number the log cannot attribute, as its header says: onFile is the header itself, so nothing reads as a
// disagreement with the log, and `byHeader` (not enumerable) holds how many times the log files that number.
function headerRead(issue, filings) {
  const onFile = { status: issue.status, ...Object.fromEntries(RENDERED_FIELDS.map((k) => [k, issue.fields[k] ?? null])) };
  Object.defineProperty(issue, 'onFile', { value: onFile, enumerable: false, configurable: true });
  Object.defineProperty(issue, 'byHeader', { value: { filings }, enumerable: false, configurable: true });
  issue.fields.status = issue.status;
  return issue;
}
// An issue read under the loop's profile: one written with no Status starts where the profile's issues start.
// Its acceptance is read under the profile's heading as under ## Acceptance, so every view that counts acceptance
// lines (next, status, done, review) sees it.
function withProfile(issue, profile) {
  if (!profile.declared) return issue;
  if (issue.fields.status === undefined) issue.status = profile.initial;
  const alias = profile.acceptance && profile.acceptance.toLowerCase();
  if (alias && issue.sections[alias] !== undefined && issue.sections.acceptance === undefined) issue.sections.acceptance = issue.sections[alias];
  return issue;
}
// The heading an issue's acceptance is written under: the one the file already has, else the profile's.
function acceptanceHeading(issue, profile) {
  if (profile.acceptance && issue.sections[profile.acceptance.toLowerCase()] !== undefined) return profile.acceptance;
  if (/^##\s+Acceptance\s*$/m.test(readText(issue.file))) return 'Acceptance';
  return profile.acceptance || 'Acceptance';
}

// A declared field's value, checked: one line, one of its enum values when it has them. Kind and Tier are checked
// against the profile's values the same way.
export function fieldValue(profile, field, raw) {
  const v = fieldText(raw);
  const f = typeof field === 'string' ? profile.field(field) : field;
  if (f && f.enum && v !== '') need(f.enum.includes(v), `${f.name} must be one of: ${f.enum.join(', ')} (got "${v}")`);
  return v;
}
// Name=value pairs from a repeatable flag (--field, --section), each name one the profile declares.
function namedPairs(list, flag, known, what) {
  const out = new Map();
  for (const item of [].concat(list ?? [])) {
    const at = String(item).indexOf('=');
    need(at > 0, `--${flag} takes <name>=<value> (got "${item}")`);
    const name = String(item).slice(0, at).trim();
    const hit = known.find((k) => k.toLowerCase() === name.toLowerCase());
    need(hit, known.length ? `${name} is not a ${what} this loop's profile declares — it declares ${known.join(', ')}` : `this loop's profile declares no ${what}s — --${flag} names one (see: jarl.mjs profile)`);
    need(!out.has(hit), `--${flag} names ${hit} twice`);
    out.set(hit, String(item).slice(at + 1));
  }
  return out;
}


// ---- issues: one number, two files ---------------------------------------------------------------------------
//
// The write lock hands out numbers within one checkout and its worktrees. Two clones of a committed loop, or two branches
// of one checkout, that each file an issue take the same number, and git merges the two files without a conflict because
// their names differ. The log names an issue by its number alone, so every line for that number is read for each file,
// and a command that moved one of them would move both. Such a number names no issue until one of the files is given
// another: the commands that address an issue by number refuse it, and verify and the views name both files. The log's
// lines for it stay unattributed after that: a number the log files more than once is read from its file's header, never from the log.

// The numbers two or more issue files carry, each with its issues in the order the loop reads them.
export function sharedNumbers(issues) {
  const byKey = new Map();
  for (const i of issues) if (i.id !== null) byKey.set(idKey(i.id), [...(byKey.get(idKey(i.id)) || []), i]);
  return [...byKey.values()].filter((list) => list.length > 1).map((list) => ({ id: list[0].id, issues: list }));
}
// The mark a view prints on the line of an issue whose number another file carries: the first files of that number, and a
// count of the rest, so a line stays one line however many files share it.
export function sharedMark(files) {
  return `number shared: ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` and ${files.length - 3} more` : ''}`;
}
// The files of one shared number as the record names them: issues/<file>, joined with "and".
function sharedFiles(list) {
  const names = list.map((i) => `issues/${basename(i.file)}`);
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
// What a shared number means and what the coordinator does about it, for a refusal and for verify. `all` is every issue
// of the loop, so the free number named is one the loop does not hold. It names no header to write: the log cannot say
// which file its lines were written for, so each file is read from its own header.
export function sharedNumberText(shared, all) {
  const id = shared.id;
  // The free number is written as the shared one is: padded to its width in a loop whose numbers carry leading zeros.
  const free = newNumber(all.reduce((m, i) => (i.id !== null && /^\d+$/.test(i.id) ? Math.max(m, Number(i.id)) : m), 0) + 1, /^0\d/.test(id) ? id.length : 0);
  const filings = Math.max(0, ...shared.issues.map((i) => i.byHeader?.filings ?? 0));
  const head = `${shared.issues.length} issue files carry the number ${id}: ${sharedFiles(shared.issues)}.`;
  const rename = `give ${filings > 1 ? 'one of the files' : 'the copy'} a number the loop does not hold, such as ${free} (rename it to ${free}-… and write ${free} in its first line), and put it in the log at the status its own file reads (jarl.mjs set ${free} <status>; a renumbered issue starts its record anew, so one that was done needs its proof and a fresh review again)`;
  if (filings > 1) return `${head} Two copies of the loop that each filed an issue and were merged leave this: the log files ${id} ${filings} times. The log names an issue by its number alone, so it cannot say which file its lines for ${id} were written for, and no command moves or edits one of these files alone. Each file is read from its own header, never from the log: its status, branch and lease are what the file says, it is never closed or approved under this number, because the log cannot tell whose its rows, approves, rounds and merges are (the work is filed again under a new number instead), and the log's state of ${id} is never to be written into any of them. The coordinator settles it by hand: ${rename}, then write in a log note which of the lines already written for ${id} belong to which file (jarl.mjs log "…"). The file that keeps ${id} is still read from its own header after that, because the log goes on filing ${id} more than once`;
  return `${head} The log files ${id} ${filings ? 'once' : 'never'}, so ${filings ? 'one of these files was made outside Jarl\'s commands, by a copy or by hand' : 'none of these files was filed by Jarl\'s commands'}, and Jarl cannot tell which file is the copy. No command moves or edits one of these files alone, and while they share ${id} each is read from its own header. The coordinator settles it by hand: ${rename}. ${id} is then one file the log files ${filings ? 'once' : 'never'}, which Jarl reads like any issue: if the file renumbered was the original, the copy that keeps ${id} takes the original's lines in the log, and Jarl cannot see that a copy was made`;
}
// The note on a number the log files more than once while one issue file carries it: one line, not a disagreement.
export function headerReadText(id, filings, file) {
  return `${id} is read from its header (${file}): the log files ${id} ${filings} times and cannot say which file its lines were written for, so it is never closed or approved`;
}
// The refusal of a move that rests on the log's proof (a close, an approve, a merge) for an issue read from its header:
// the log's rows, approves, rounds and merges under its number may be another issue's, so none of them can clear it.
export function unattributedRefusal(issue, what) {
  if (!issue.byHeader) return null;
  const id = issue.id;
  return `${id} cannot be ${what}: the log files ${id} ${issue.byHeader.filings} times, so it cannot tell which issue the rows, approves, rounds and merges under ${id} belong to, and an issue under this number is never closed or approved. File the work again under a new number (jarl.mjs new "<title>") and carry it on there; this one can then be dropped (jarl.mjs set ${id} dropped "<why>")`;
}
// The one issue `rawId` names among `issues`, or null when none does. A number two files carry is refused, with both files
// named: a move or an edit by that number would land on each of them in the log.
export function issueNamed(issues, rawId) {
  const key = idKey(rawId);
  const hits = issues.filter((i) => i.id !== null && idKey(i.id) === key);
  if (hits.length > 1) throw new Error(sharedNumberText({ id: hits[0].id, issues: hits }, issues));
  return hits[0] || null;
}
// The issue `rawId` names in the loop at `root`, or null; a number two files carry is refused (see issueNamed).
export function findIssue(root, rawId) { return issueNamed(loadIssues(root), rawId); }

function setField(text, name, value) {
  // Only the header holds fields: a line in a section body that looks like one (a pasted finding) is text.
  const lines = text.split('\n');
  let last = 0;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) break;
    const f = FIELD_RE.exec(lines[i]);
    if (!f) continue;
    // Compared without case, as parseIssue reads names: **status:** written by hand is the Status field, not a second one.
    if (f[1].toLowerCase() === name.toLowerCase()) { lines[i] = `**${name}:** ${value}`; return lines.join('\n'); }
    last = i;
  }
  // insert after the last field line of the header
  lines.splice(last + 1, 0, `**${name}:** ${value}`);
  return lines.join('\n');
}

// Remove the first line `**<Name>:** …`, in exactly that case, wherever it stands (what after --clear and repo --clear remove).
function removeFirstField(text, name) { return text.replace(new RegExp(`^\\*\\*${name}:\\*\\*.*\\n`, 'm'), ''); }

// Remove header fields (only the header: a section line that looks like a field is text). A field that is
// not there is left alone.
function removeFields(text, names) {
  const lines = text.split('\n');
  const out = [lines[0]];
  let inHeader = true;
  for (const line of lines.slice(1)) {
    if (line.startsWith('## ')) inHeader = false;
    const f = inHeader ? FIELD_RE.exec(line) : null;
    if (f && names.some((n) => n.toLowerCase() === f[1].toLowerCase())) continue;
    out.push(line);
  }
  return out.join('\n');
}

function setSection(text, name, body) {
  // A heading may hold any character (a profile's "Acceptance — evidence"): it is matched as it is written.
  const re = new RegExp(`(^##\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$\\n)([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'mi');
  // A function replacer: user text is inserted as it is, never read for $1, $& or $' patterns.
  if (re.test(text)) return text.replace(re, (_, head) => `${head}${body.trim()}\n\n`);
  // A new section other than Evidence goes before Evidence, which stays last: the record of the work.
  const evidence = /^## Evidence\s*$/m.exec(text);
  if (name !== 'Evidence' && evidence) return `${text.slice(0, evidence.index)}## ${name}\n${body.trim()}\n\n${text.slice(evidence.index)}`;
  return `${text.replace(/\s*$/, '')}\n\n## ${name}\n${body.trim()}\n`;
}

// A body written into a section must not open a section of its own: a line starting with ## would end it
// early and the rest would land under a heading nobody reads. Such a line is escaped (\##), which renders
// the same and parses as text.
export function bodyText(v) {
  return String(v ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/^(\s*)(#+)(?=\s|$)/, (_, sp, h) => `${sp}\\${h}`)).join('\n').trim();
}
// A text for What, Why or a section that holds a matched opening and closing tag named after one of the issue's own
// fields (<why>…</why>) is a call whose fields all went into one parameter: the other fields would be filed empty.
// Refused, naming the field. Code is not looked at — a fenced block or a code span may name such a tag — and a lone
// tag is only text.
const FIELD_TAGS = ['what', 'why', 'acceptance', 'prio', 'tags', 'files', 'kind'];
const FIELD_FLAG = { what: '--what', why: '--why', acceptance: '--acceptance', prio: '--prio', tags: '--tags', files: '--files', kind: '--kind' };
export function needNoFieldTags(text, where) {
  let fence = null;
  const kept = [];
  for (const line of String(text ?? '').split('\n')) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; continue; }
    if (f) { fence = f[1]; continue; }
    kept.push(line);
  }
  const outsideCode = kept.join('\n').replace(/(`+)[\s\S]*?\1/g, ' ');
  for (const tag of FIELD_TAGS) {
    if (new RegExp(`<${tag}\\s*>[\\s\\S]*?</${tag}\\s*>`, 'i').test(outsideCode)) {
      throw new Error(`${where} holds a <${tag}>…</${tag}> pair: a field goes in its own parameter (${FIELD_FLAG[tag]}), never inside another text — nothing was written; pass each field on its own, or put the tags in backticks if you mean to write them`);
    }
  }
}
// What a new issue was filed with, read back from its file: for new's reply, which lists what was parsed and what was
// left empty, each empty field with the command that fills it.
const FILL_WITH = {
  why: (id) => `jarl.mjs body ${id} --why "<why>"`,
  acceptance: (id) => `jarl.mjs body ${id} --acceptance "<line>"`,
  files: (id) => `jarl.mjs files ${id} p,q`,
  after: (id) => `jarl.mjs after ${id} <ids>`,
  where: (id) => `jarl.mjs body ${id} --where "<where>"`,
  'found by': () => 'only at filing: new --found-by <who>',
};
export function describeNew(file) {
  const issue = parseIssue(readText(file), file);
  const len = (k) => (issue.sections[k] || '').trim().length;
  const parsed = { priority: issue.priority, tier: issue.tier, kind: issue.kind, tags: issue.tags, acceptanceLines: acceptanceLineCount(issue), whatChars: len('what'), whyChars: len('why') };
  const empty = [
    ['why', len('why') === 0], ['acceptance', acceptanceLineCount(issue) === 0], ['files', issue.files.length === 0],
    ['after', issue.after.length === 0], ['where', !fieldText(issue.fields.where)], ['found by', !fieldText(issue.fields['found by'])],
  ].filter(([, e]) => e).map(([k]) => ({ field: k, fill: FILL_WITH[k](issue.id) }));
  return { parsed, empty };
}
export function renderNewReply(out) {
  const { parsed: p, empty } = out;
  const lines = [`filed ${out.id} · ${out.file}`,
    `parsed: priority ${p.priority} · tier ${p.tier} · kind ${p.kind} · tags ${p.tags.length ? p.tags.join(',') : '(none)'} · ${p.acceptanceLines} acceptance line${p.acceptanceLines === 1 ? '' : 's'} · What ${p.whatChars} characters · Why ${p.whyChars} characters`];
  if (empty.length) lines.push(`left empty: ${empty.map((e) => `${e.field} (${e.fill})`).join(' · ')}`);
  return lines.join('\n');
}
// A ruling's own text: every continuation line indented, and the first line too when it would read as structure (a field,
// an option, a heading, an indent), so the text starts no field, option or heading of the record.
function freeBlock(text) {
  return oneBreak(text).split('\n').map((l, i) => (i === 0 && !/^[*\-#>\s]/.test(l) && !DECISION_META.test(l) && !DECISION_HEAD.test(l) ? l : `  ${l}`)).join('\n');
}
// --acceptance repeats, one checkable line each; several become a list.
export function acceptanceText(v) {
  const lines = [].concat(v ?? []).map(bodyText).filter(Boolean);
  return lines.length > 1 ? lines.map((l) => `- ${l}`).join('\n') : (lines[0] || '');
}

// --changelog repeats, one entry each: the line the repository's changelog gets for this issue, optionally opened by
// its Keep a Changelog section (`Added: …`). An entry is one line, like a changelog bullet; several become a list.
export const CHANGELOG_SECTIONS = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];
export function changelogText(v) {
  const lines = [].concat(v ?? []).map(fieldText).filter(Boolean).map((l) => l.replace(/^-\s+/, ''));
  // A section with nothing after it would print an empty bullet under that heading: refused, not guessed at.
  for (const l of lines) need(!new RegExp(`^(${CHANGELOG_SECTIONS.join('|')}):\\s*$`, 'i').test(l), `changelog entry "${l}" has no text — write the line after the section: --changelog "${l.replace(/:\s*$/, '')}: <what changed>"`);
  return lines.map((l) => `- ${l}`).join('\n');
}
// The entries of an issue's ## Changelog section, each with its section: the one it opens with, else Fixed for a bug
// and Changed for anything else.
export function changelogEntries(issue) {
  const fallback = issue.kind === 'bug' ? 'Fixed' : 'Changed';
  return (issue.sections.changelog || '').split('\n').map((l) => l.trim().replace(/^-\s+/, '')).filter(Boolean).map((l) => {
    const m = new RegExp(`^(${CHANGELOG_SECTIONS.join('|')}):\\s*(.*)$`, 'i').exec(l);
    return m && m[2] ? { section: CHANGELOG_SECTIONS.find((x) => x.toLowerCase() === m[1].toLowerCase()), text: m[2] } : { section: fallback, text: l };
  });
}

// fields: the profile's declared fields, [name, value] in its order, each written after Where (empty when not given).
// sections: the profile's extra sections, [heading, body], written after Acceptance. acceptanceHeading: the heading the
// acceptance goes under. Without them the file holds the built-in fields and sections only.
export function renderIssue({ id, title, status = 'open', kind, priority, tier, tags, files, repo, foundBy, where = '', what = '', why = '', acceptance = '', source = [], after = [], changelog = '', fields = [], sections = [], acceptanceHeading = 'Acceptance' }) {
  const body = (t) => (t ? `${t}\n` : '\n');
  const declared = fields.map(([n, v]) => `**${n}:**${v ? ` ${v}` : ''}\n`).join('');
  const extra = sections.map(([h, t]) => `## ${h}\n${body(t)}\n`).join('');
  return `# ${id} · ${fieldText(title)}

**Status:** ${status}
**Kind:** ${kind}
**Priority:** ${priority}
**Tier:** ${tier}
**Tags:** ${tags.join(', ')}
**Files:** ${files.join(', ')}
${repo ? `**Repo:** ${repo}\n` : ''}${after.length ? `**After:** ${after.join(', ')}\n` : ''}**Found by:** ${fieldText(foundBy)}
${source.length ? `**Source:** ${source.join(', ')}\n` : ''}**Where:**${where ? ` ${fieldText(where)}` : ''}
${declared}
## What
${body(what)}
## Why
${body(why)}
## ${acceptanceHeading}
${body(acceptance)}
${extra}${changelog ? `## Changelog\n${changelog}\n\n` : ''}## Evidence

`;
}

// The merge an issue records: **Merged:** <sha>[ in <repo>] and **CI:** pending|green|red|none. Null when
// the issue records none.
export function mergedOf(issue) {
  const m = /^(\S+)(?: in (.+))?$/.exec(issue.fields.merged || '');
  if (!m) return null;
  const ci = CI_STATES.includes(issue.fields.ci) ? issue.fields.ci : null;
  return { sha: m[1], repo: m[2] || null, ci };
}

// ---- issues: the rows of an Evidence section -------------------------------------------------------

// The checkable rows of an Evidence section, each with its ordinal n counted over the whole section (a retracted
// row keeps its number, so a number never moves), the lines it spans (start..end, a row is its first line and the
// indented lines under it) and whether it is retracted (struck through: `- ~~**ran:** … **saw:** …~~`). The one
// numbering: show prints it, retract takes it, the done gate counts by it.
const ROW_START = /^- (~~)?\*\*ran:\*\*/;
// Which journal line each file row wrote, by position in the file: a row's journal line keeps the first line of its
// command (`<id> evidence row · <first line>`, with a pointer suffix when the command has more lines), so it matches
// when that is the row's whole first line (a command of several lines) or is followed by the saw marker. Each journal
// line is taken once, the earliest still free, so lines in another order, equal commands and commands that hold the
// saw marker themselves all resolve; a row no journal line fits is null.
const MORE_LINES = / \(\+\d+ more lines, whole text in [^)]*\)$/;
export function alignRows(id, rows, journalRows) {
  const prefix = `${id} evidence row · `;
  const used = new Set();
  return rows.map((row) => {
    const hit = journalRows.find((j) => {
      if (used.has(j) || !j.text.startsWith(prefix)) return false;
      const l = j.text.slice(prefix.length).replace(MORE_LINES, '');
      return row.first === l || row.first.startsWith(`${l} · **saw:**`);
    });
    if (hit) used.add(hit);
    return hit || null;
  });
}
export function evidenceTable(text) {
  const lines = String(text || '').split('\n');
  const rows = [];
  for (let i = 0; i < lines.length; i += 1) {
    const s = ROW_START.exec(lines[i]);
    if (!s) continue;
    let end = i;
    while (end + 1 < lines.length && /^ {2}\S/.test(lines[end + 1])) end += 1;
    const retracted = Boolean(s[1]);
    let body = lines.slice(i, end + 1).map((l) => l.trim()).join(' ').replace(/^- (~~)?\*\*ran:\*\*\s*/, '');
    if (retracted) body = body.replace(/~~$/, '');
    const cut = body.indexOf(' · **saw:**');
    // The row's first physical line after the marker: what alignRows matches the journal's row line against.
    const first = lines[i].replace(/^- (~~)?\*\*ran:\*\*\s*/, '').trim();
    rows.push({ n: rows.length + 1, start: i, end, retracted, first, ran: (cut === -1 ? body : body.slice(0, cut)).trim(), saw: cut === -1 ? '' : body.slice(cut + ' · **saw:**'.length).trim() });
    i = end;
  }
  return { lines, rows };
}
// The rows that count as evidence: the ones with a --saw and not retracted.
export function evidenceRows(issue) {
  return evidenceTable(issue.sections.evidence).rows.filter((r) => !r.retracted && r.saw !== '').map((r) => ({ ran: r.ran, saw: r.saw }));
}

// The free-text notes of an Evidence section, each with its ordinal n counted over the whole section (a retracted note
// keeps its number), the lines it spans (start..end) and whether it is retracted (struck through: `~~` before its first
// line's text and after its last line). A note is a run of lines with no blank line in it that is no row, no sub-heading
// and no retraction entry (`- **retracted:**` and the lines indented under it). `retract <id> note-<n>` takes the number.
const RETRACTION_ENTRY = /^- \*\*retracted:\*\*/;
export function evidenceNotes(text) {
  const { lines, rows } = evidenceTable(text);
  const inRow = new Set();
  for (const r of rows) for (let i = r.start; i <= r.end; i += 1) inRow.add(i);
  const notes = [];
  let open = null;
  let entry = false;
  const close = (end) => {
    if (!open) return;
    const retracted = /^(- )?~~/.test(lines[open.start]) && /~~$/.test(lines[end].trimEnd());
    notes.push({ n: notes.length + 1, start: open.start, end, retracted });
    open = null;
  };
  lines.forEach((l, i) => {
    if (inRow.has(i) || PROOF_HEAD.test(l) || NOTES_HEAD.test(l)) { close(i - 1); entry = false; return; }
    if (l.trim() === '') { close(i - 1); return; }
    if (RETRACTION_ENTRY.test(l)) { close(i - 1); entry = true; return; }
    if (entry && /^ {2}/.test(l)) return;
    entry = false;
    if (!open) open = { start: i };
  });
  close(lines.length - 1);
  return { lines, notes };
}
// A note struck through, as a row is: after its bullet when it has one.
export function struckNote(lines, note) {
  const out = lines.slice();
  out[note.start] = out[note.start].replace(/^(- )?/, '$1~~');
  out[note.end] = `${out[note.end].trimEnd()}~~`;
  return out;
}

// ---- Proof and Notes: the two parts of an Evidence section ---------------------------------------------------------
//
// An Evidence section whose first entry is written while it is empty gets two sub-headings, always in this order: `### Proof`
// (the worker's --ran/--saw rows) and `### Notes` (free text, rulings, reasons and retraction entries). A sub-heading is
// written with its first entry. A section that already holds content and neither sub-heading is unsplit: it is read as
// it stands and entries are appended at its end, never sorted into parts. The sub-headings are not section headings
// (a section ends at `## `), so nothing that cuts a section sees them.
const PROOF_HEAD = /^### Proof\s*$/;
const NOTES_HEAD = /^### Notes\s*$/;
// Where the parts of a section's lines begin: the index of each sub-heading, or -1.
function evidenceParts(lines) {
  return { proofAt: lines.findIndex((l) => PROOF_HEAD.test(l)), notesAt: lines.findIndex((l) => NOTES_HEAD.test(l)) };
}
// Whether a section's text holds content and neither sub-heading.
export function isUnsplit(section) {
  const lines = String(section || '').trim().split('\n');
  const { proofAt, notesAt } = evidenceParts(lines);
  return lines.join('').trim() !== '' && proofAt === -1 && notesAt === -1;
}
// A note must not read as a sub-heading of the section: in a section written in parts, a line that starts with # is escaped
// as a body is; in an unsplit one, only a line that is a sub-heading by itself.
// A note whose own first line starts with ~~ is escaped, so that only a retraction strikes a note through.
function noteText(value, current) {
  const text = isUnsplit(current) ? String(value).split('\n').map((l) => l.replace(/^(\s*)###(?=\s+(?:Proof|Notes)\s*$)/, '$1\\###')).join('\n') : bodyText(value);
  return text.replace(/^(- )?~~/, '$1\\~~');
}
// The Evidence section with one entry written into its part. `kind` is 'proof' (rows, one per line) or 'note' (text); `sep`
// is what separates a note from the text before it. A proof entry goes after the last row of the section, wherever that
// is (a row number is an ordinal over the whole section, so a row never goes in front of another row), else at the end of
// Proof, else in a Proof written in front of an existing Notes. A note goes at the end of the section, in a Notes written
// when there is none. An unsplit section is appended to as it is, and an empty one is written in parts.
export function placeEvidence(current, kind, added, sep) {
  const text = String(current || '').trim();
  if (text === '') return `${kind === 'proof' ? '### Proof' : '### Notes'}\n\n${added}`;
  const lines = text.split('\n');
  const { proofAt, notesAt } = evidenceParts(lines);
  if (proofAt === -1 && notesAt === -1) return `${text}${sep}${added}`;
  if (kind === 'note') return notesAt === -1 ? `${text}\n\n### Notes\n\n${added}` : `${text}${sep}${added}`;
  const rows = evidenceTable(text).rows;
  const entry = added.split('\n');
  if (rows.length) lines.splice(rows[rows.length - 1].end + 1, 0, ...entry);
  else if (proofAt !== -1) {
    let at = notesAt > proofAt ? notesAt : lines.length;
    while (at - 1 > proofAt && lines[at - 1].trim() === '') at -= 1;
    lines.splice(at, 0, ...(at === proofAt + 1 ? [''] : []), ...entry);
  } else lines.splice(notesAt, 0, '### Proof', '', ...entry, '');
  return lines.join('\n');
}

// A finding's proposal copied in by import is not yet an acceptance line: it waits to be made checkable.
export const PROPOSED = 'Proposed by the finding';
export function acceptanceLineCount(issue) {
  const text = issue.sections.acceptance || '';
  return text.split('\n').map((l) => l.trim().replace(/^- /, '')).filter((l) => l.length > 0 && !l.startsWith(PROPOSED)).length;
}

// ---- issues: the entries of a Reviews section ---------------------------------------------------------

const REVIEW_ENTRY = /^- (~~)?\*\*(approve|changes|retract)\*\*(?: · by (.+?) \((fresh|coordinator|self)\))?(?: · (\d{4}-\d{2}-\d{2}))?/;
// The entries of a Reviews section in file order, each with the lines it spans.
export function reviewEntries(text) {
  const lines = String(text || '').split('\n');
  const entries = [];
  lines.forEach((l, i) => {
    const m = REVIEW_ENTRY.exec(l);
    if (m) entries.push({ start: i, retracted: Boolean(m[1]), verdict: m[2], by: m[3] || null, kind: m[4] || null, day: m[5] || null });
  });
  entries.forEach((e, k) => { e.end = k + 1 < entries.length ? entries[k + 1].start - 1 : lines.length - 1; });
  return { lines, entries };
}

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { FIELD_RE, RENDERED_FIELDS, acceptanceHeading, evidenceParts, freeBlock, issuesAt, namedPairs, noteText, removeFields, removeFirstField, setField, setSection };
