// Research findings into issues: import and sources, and the text status and list print.

import { existsSync } from 'node:fs';
import { resolve, dirname, basename, relative, isAbsolute } from 'node:path';
import { KEPT_KINDS, KINDS, PRIORITIES, Refusal, fieldText, hole, isFix, jarlLine, need, refuse, slugify, splitList } from './base.mjs';
import { git } from './git.mjs';
import { canonical } from './where.mjs';
import { readText } from './files.mjs';
import { DEFAULT_PROFILE, formatOffText, loadProfile } from './profile.mjs';
import { appendLog } from './journal.mjs';
import { PROPOSED, bodyText, findIssue, loadIssues, sharedMark } from './issues.mjs';
import { repoList, reposWhereLines } from './repositories.mjs';
import { closedGateLine, disagreementText, gateLine, needOneSlice } from './loop.mjs';
import { checkLines, checkWaitingText, closedNoCheckText, mergeCheckLines } from './metrics.mjs';
import { cmdNew, cmdSource, givenFields, needLiveLoop, parentToFile, putUnder } from './commands.mjs';
import { leasedByText, schedulerNote, subsText } from './evidence.mjs';

// ---- research findings into issues ----------------------------------------------------------------

// A research round leaves a findings.json beside its report. import turns each finding into one issue whose
// **Source:** is <report-dir#finding-id>: the report directory is dated, so the pair names that finding for
// good, and a re-run skips every finding whose Source an issue already carries. The mapping (references/jarl.md, "From
// research to issues") reads three shapes: a flat array of findings; an array of angles, each with its
// surviving findings under `surviving`; and { results: [{ area, kept: [...] }] }. A finding without an id
// cannot be keyed, so the file is refused whole.
const KIND_OF = { defect: 'bug', inconsistency: 'bug', risk: 'gap', opportunity: 'gap' };
const PRIO_OF = { blocker: '1', critical: '1', high: '1', medium: '2', major: '2', important: '2', low: '3', minor: '3' };

// The keys of a finding the mapping below reads. Research writes further keys beside them (verifier, v, language, and
// others), and those pass. Three misses of a mapped key are refused: the key in another case, a mapped key of five
// letters or more missed by one letter (one added, left out or wrong), and a mapped key with two neighbouring letters
// swapped. A misspelled claim or severity would otherwise file the issue with that field empty and nothing said; a shorter
// key one letter off a mapped key (file, line, ids, fixed) is as likely a key of its own as a slip, so it passes.
const FINDING_KEYS = ['id', 'title', 'claim', 'kind', 'priority', 'severity', 'where', 'surfaces', 'truth', 'evidence', 'impact', 'adopter_impact', 'proposal', 'suggested_fix', 'fix', 'effort'];
const MISSED_BY_ONE_FROM = 5;
// The number of single-character edits (insert, delete, replace) that turn one text into the other.
function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
// Whether `b` is `a` with two neighbouring, different letters swapped.
function swapped(a, b) {
  if (a.length !== b.length) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  return i < a.length - 1 && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
}
// The mapped key a key is a miss of, or null where it is a mapped key or passes as a key of its own.
function missedKey(key) {
  if (FINDING_KEYS.includes(key)) return null;
  const k = key.toLowerCase();
  return FINDING_KEYS.find((m) => m === k) ?? FINDING_KEYS.find((m) => swapped(k, m)) ?? FINDING_KEYS.find((m) => m.length >= MISSED_BY_ONE_FROM && editDistance(k, m) === 1) ?? null;
}
// The keys a finding carries that the mapping does not read, in the order written.
const extraKeysOf = (f) => Object.keys(f).filter((k) => !FINDING_KEYS.includes(k));
// The extra keys of a finding of the angles shape, which is copied with the keys import sets itself.
const EXTRA_KEYS = Symbol('extra keys');

// What a refusal of a findings file ends with, by the command that reads it: import files, so a refusal says nothing was
// filed and ends with its dry run; sources only reads.
const READERS = {
  'import': { form: ['jarl.mjs', 'import', '<findings.json>', '--dry-run'], then: ' — nothing was filed', stop: '; nothing was filed' },
  sources: { form: ['jarl.mjs', 'sources', '<findings.json>'], then: '', stop: '' },
};

function refuseMisspelledKeys(f, label, reader) {
  if (!f || typeof f !== 'object') return f;
  const bad = Object.keys(f).map((k) => [k, missedKey(k)]).filter(([, best]) => best);
  need(bad.length === 0, `finding ${label} has ${bad.map(([k, best]) => `"${k}" (did you mean "${best}"?)`).join(', ')}, which look like misspelled keys; the keys a finding takes are ${FINDING_KEYS.join(', ')}${reader.then}`, () => reader.form);
  return f;
}
// A label for a finding in a refusal: its id, or its place in the list when it has none (the id check names that case).
const labelOf = (f, n) => (f && f.id !== undefined ? `"${f.id}"` : `#${n + 1}`);

export function findingsOf(json, command = 'import') {
  const reader = READERS[command];
  const checkedList = (items) => items.map((f, n) => refuseMisspelledKeys(f, labelOf(f, n), reader));
  let list;
  // In the angles shape an id is unique only inside its angle (two angles may each have an F1), so the key
  // is <angle>/<id> there, always — never only when two collide, which would change a key once a later
  // edit of the file added a twin.
  if (Array.isArray(json) && json.some((x) => x && Array.isArray(x.surviving))) {
    list = json.flatMap((x) => (x.surviving || []).map((f, n) => {
      const angle = x && x.angle ? slugify(String(x.angle)) : null;
      refuseMisspelledKeys(f, angle && f && f.id !== undefined ? `"${angle}/${f.id}"` : labelOf(f, n), reader);
      return f && f.id !== undefined && angle ? { ...f, id: `${angle}/${f.id}`, localId: String(f.id), angle, [EXTRA_KEYS]: extraKeysOf(f) } : f;
    }));
  } else if (Array.isArray(json)) list = checkedList(json);
  else if (json && Array.isArray(json.results)) list = checkedList(json.results.flatMap((r) => r.kept || []));
  else if (json && Array.isArray(json.findings)) list = checkedList(json.findings);
  else refuse('not a findings file this tool reads: expected an array of findings, an array of angles with `surviving`, or { results: [{ kept }] } — see references/jarl.md, "From research to issues"', reader.form);
  const seen = new Set();
  const out = list.map((f, n) => {
    need(f && typeof f === 'object' && (typeof f.id === 'string' || typeof f.id === 'number') && String(f.id).trim(), `finding #${n + 1} has no id — every finding needs one to be filed once and only once${reader.stop}`, () => reader.form);
    const id = String(f.id).trim();
    need(!/[\s,#]/.test(id), `finding id "${id}" holds a space, a comma or a # — it cannot be a Source key${reader.stop}`, () => reader.form);
    need(!seen.has(id), `finding id ${id} appears twice in the file${reader.stop}`, () => reader.form);
    seen.add(id);
    const claim = typeof f.claim === 'string' ? f.claim : '';
    const title = String(f.title || claim.split(/(?<=[.!?])\s/)[0] || id).replace(/\s+/g, ' ').trim();
    const kindRaw = String(f.kind || '').toLowerCase();
    const prioRaw = String(f.priority ?? f.severity ?? '').toLowerCase();
    const why = [f.impact, f.adopter_impact].filter((x) => typeof x === 'string' && x.trim()).join('\n\n');
    const proposal = [f.proposal, f.suggested_fix, f.fix].find((x) => typeof x === 'string' && x.trim());
    return {
      id,
      localId: f.localId || id,
      angle: f.angle || null,
      extras: f[EXTRA_KEYS] ?? extraKeysOf(f),
      title: title.length > 140 ? `${title.slice(0, 139)}…` : title,
      // A finding is work: it is never filed as a promise or a wait, which new files with who holds them.
      kind: KINDS.includes(kindRaw) && !KEPT_KINDS.includes(kindRaw) ? kindRaw : (KIND_OF[kindRaw] || 'bug'),
      priority: PRIORITIES.includes(prioRaw) ? prioRaw : (PRIO_OF[prioRaw] || '2'),
      where: String(f.where || f.surfaces || ''),
      // Whether the What opens with a label (Claim:, Truth:), which is what tells the issue import files from one written by hand.
      claimOrTruth: Boolean(claim || (typeof f.truth === 'string' && f.truth)),
      what: [claim && `Claim: ${claim}`, typeof f.truth === 'string' && f.truth && `Truth: ${f.truth}`, typeof f.evidence === 'string' ? f.evidence : ''].filter(Boolean).join('\n\n'),
      why: [why, f.effort && `Effort (the finding's estimate): ${f.effort}`].filter(Boolean).join('\n\n'),
      acceptance: proposal ? `${PROPOSED} — make it checkable before a worker starts: ${proposal}` : '',
    };
  });
  return out;
}

// The report directory a findings file belongs to, as its Source spells it: the path from the root of the
// repository holding it (core/research/2026-09-25-jarl), so every loop that imports it writes the same key;
// the directory's own name outside a repository.
export function reportDirOf(file) {
  const dir = dirname(resolve(file));
  const top = git(dir, ['rev-parse', '--show-toplevel']);
  const rel = top ? relative(canonical(top), canonical(dir)).split('\\').join('/') : '';
  // On Windows a path on another drive has no relative spelling: relative() gives it back absolute.
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : basename(dir);
}

function readFindings(file, flags = {}, command = 'import') {
  need(file, 'a findings file is required', () => ({ arg: 0, value: '<findings.json>' }));
  need(existsSync(file), `no such file: ${file}`, () => ({ arg: 0, value: '<findings.json>' }));
  let json;
  try { json = JSON.parse(readText(file)); } catch (e) { refuse(`${file} is not JSON: ${e.message}`, READERS[command].form); }
  const dir = flags.source !== undefined ? String(flags.source).replace(/\/+$/, '') : reportDirOf(file);
  need(dir && !/[\s,#]/.test(dir), `--source is the report directory alone, with no space, comma or # in it (got "${dir}")`, () => ({ flag: '--source', value: '<report-dir>' }));
  return { dir, findings: findingsOf(json, command) };
}

// An issue that records no Source often names its finding. That issue is found, never guessed at, and
// mainly where an issue says what it is about: its title and its What, Why and Acceptance — never a header
// field (`**Priority:** 2` is not finding 2). Evidence (notes about other work, too) counts only under the
// strict rule in inEvidence below. An id that reads as unique
// on its own (jarl-2-B2: a dash, and at least 8 characters) is enough by itself. A short one (F1, C1, 2) or one
// from the angles shape needs its report named in the same issue too: the report directory's name, or the
// <angle>/<id> key. A title naming the finding wins, else the one issue whose body does; two candidates are
// reported as ambiguous and left alone.
function uniqueLooking(id) { return id.includes('-') && id.length >= 8; }
function tokenRe(s) { return new RegExp(`(^|[^A-Za-z0-9-])${s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^A-Za-z0-9-]|$)`); }
function mentionOf(issues, finding, dir) {
  const own = tokenRe(finding.id);
  const bare = tokenRe(finding.localId);
  const report = tokenRe(basename(dir));
  const named = (text) => {
    if (own.test(text) && finding.id !== finding.localId) return true;   // <angle>/<id> written out
    if (!bare.test(text)) return false;
    return !finding.angle && uniqueLooking(finding.localId);
  };
  const namedWithReport = (text) => named(text) || (bare.test(text) && report.test(text));
  const unsourced = issues.filter((i) => i.fields.source === undefined);
  const bodyOf = (i) => [i.title, i.sections.what, i.sections.why, i.sections.acceptance].filter(Boolean).join('\n');
  const byTitle = unsourced.filter((i) => named(i.title) || (bare.test(i.title) && report.test(bodyOf(i))));
  if (byTitle.length === 1) return { issue: byTitle[0] };
  if (byTitle.length > 1) return { ambiguous: byTitle.map((i) => i.id) };
  // Evidence counts under the strictest rule only: an id that reads as unique on its own, on an Evidence line
  // that also names the report (a package issue's "Source: <report dir>/report.md … Ids: a-b-01, a-b-02").
  const inEvidence = (i) => !finding.angle && uniqueLooking(finding.localId)
    && (i.sections.evidence || '').split('\n').some((l) => bare.test(l) && report.test(l));
  const byBody = unsourced.filter((i) => namedWithReport(bodyOf(i)) || inEvidence(i));
  if (byBody.length === 1) return { issue: byBody[0] };
  return byBody.length ? { ambiguous: byBody.map((i) => i.id) } : {};
}

function bySource(issues) {
  const map = new Map();
  for (const i of issues) for (const s of i.sources) map.set(s, [...(map.get(s) || []), i]);
  return map;
}

// The Found by import writes on each issue it files: --found-by, else "research" and the report directory of the findings.
const foundByOf = (flags, dir) => flags['found-by'] || `research ${dir}`;
const wordsOf = (s) => String(s).normalize('NFC').replace(/\s+/g, ' ').trim();
const paragraphsOf = (s) => bodyText(s).split(/\n\s*\n/).map(wordsOf).filter(Boolean);

// An issue import filed is told by what import wrote into its file when it filed it, which a stopped run, the merge of two
// copies of the loop and a new number all leave as it is: its Source is this finding alone, its Found by is the one this
// run writes, and its What opens with the label import gives a finding's claim or its truth. An issue written by hand
// under the Source, or adopted into it, holds its writer's own words and no such opening, and comparing it with the
// finding would report a change on every run; one that names several findings is a package of them, not a copy of one.
// A finding with neither a claim nor a truth is filed with a What that opens with its evidence, as a What written by hand
// may: its issue cannot be told from one written by hand, so that finding is not compared, and the run says so.
function filedByImport(issue, foundBy) {
  return issue.sources.length === 1
    && wordsOf(fieldText(issue.fields['found by'])) === wordsOf(foundBy)
    && /^(Claim|Truth):(\s|$)/.test(paragraphsOf(issue.sections.what ?? '')[0] ?? '');
}

// A filed finding's text lives in the What and the Why of its issue, which keep being written to (a coordinator adds a
// paragraph, a worker a note), so the finding is unchanged while each paragraph it would file today is still a paragraph of
// the issue, word for word. Words are compared, not white space, line endings or the Unicode form of a letter, and the text
// is compared as the issue stores it (a line that opens with # is escaped there).
function changedParts(issue, f) {
  return [['What', f.what], ['Why', f.why]].flatMap(([part, now]) => {
    const held = issue.sections[part.toLowerCase()] ?? '';
    const heldParagraphs = new Set(paragraphsOf(held));
    const holds = paragraphsOf(now).every((p) => heldParagraphs.has(p));
    return holds ? [] : [{ part, issueText: held.trim(), findingText: String(now).trim() }];
  });
}

// The ready part of the refusal of a finding the filing refused: the filing's own when it is a fix of a flag import takes
// (or a command of another kind, a step to take first), else the form of the import, since the fix is in the findings file.
const IMPORT_FIXES = new Set(['--kind', '--prio', '--tier', '--tags', '--repo', '--field', '--parent', '--root']);
function formOf(ready) {
  const fixes = [].concat(ready);
  if (!fixes.every(isFix)) return ready;
  return fixes.every((x) => IMPORT_FIXES.has(x.flag ?? x.drop)) ? ready : READERS.import.form;
}

export function cmdImport(root, file, flags) {
  needLiveLoop(root, ` — run: ${jarlLine('init', '<goal>')}`);
  const { dir, findings: read } = readFindings(file, flags);
  const profile = loadProfile(root);
  if (flags.kind !== undefined) need(profile.kinds.includes(flags.kind), `--kind must be one of: ${profile.kinds.join(', ')} (got "${flags.kind}")`, () => ({ flag: '--kind', value: hole('<kind>') }));
  need(!profile.keptKind(flags.kind), `--kind ${flags.kind}: a finding is work, never a promise or a wait — file one of those with ${jarlLine('new', '<title>', '--kind', flags.kind)}`, () => (['jarl.mjs', 'new', '<title>', '--kind', flags.kind]));
  if (flags.prio !== undefined) need(PRIORITIES.includes(String(flags.prio)), `--prio must be 1, 2 or 3 (got "${flags.prio}")`, () => ({ flag: '--prio', value: hole('<prio>') }));
  if (flags.tier !== undefined) need(profile.tiers.includes(String(flags.tier)), `--tier must be one of: ${profile.tiers.join(', ')} (got "${flags.tier}")`, () => ({ flag: '--tier', value: hole('<tier>') }));
  // A --field pair is the call's, given once for every finding: a wrong one is refused as the call's own, naming the pair.
  givenFields(profile, flags.field);
  // A finding's kind is mapped onto the built-in kinds; under a profile with kinds of its own, one it does not
  // name is filed under the profile's default kind.
  const findings = profile.declared ? read.map((f) => (profile.kinds.includes(f.kind) && !profile.keptKind(f.kind) ? f : { ...f, kind: profile.kindDefault })) : read;
  if (flags.repo !== undefined) repoList(root, flags.repo);
  if (flags.tags !== undefined) needOneSlice(splitList(flags.tags));
  let chosen = findings;
  if (flags.only !== undefined) {
    const only = splitList(flags.only);
    const unknown = only.filter((id) => !findings.some((f) => f.id === id));
    need(unknown.length === 0, `not in ${file}: ${unknown.join(', ')}`, () => ({ flag: '--only', value: '<finding-ids>' }));
    chosen = findings.filter((f) => only.includes(f.id));
  }
  const issues = loadIssues(root);
  const filedAs = bySource(issues);
  const foundBy = foundByOf(flags, dir);
  const out = { source: dir, findings: findings.length, considered: chosen.length, filed: [], already: [], foundBy, compared: [], notCompared: [], changed: [], adopted: [], mentioned: [], ambiguous: [], dryRun: flags['dry-run'] === true };
  const toFile = [];
  for (const f of chosen) {
    const key = `${dir}#${f.id}`;
    if (filedAs.has(key)) {
      out.already.push({ finding: f.id, issues: filedAs.get(key).map((i) => i.id) });
      const own = f.claimOrTruth ? filedAs.get(key).filter((i) => filedByImport(i, foundBy)) : [];
      if (!own.length) { out.notCompared.push({ finding: f.id, reason: f.claimOrTruth ? 'no-issue-of-this-run' : 'no-claim-or-truth' }); continue; }
      out.compared.push(f.id);
      for (const i of own) {
        const parts = changedParts(i, f);
        if (parts.length) out.changed.push({ finding: f.id, issue: i.id, status: i.status, parts });
      }
      continue;
    }
    const m = mentionOf(issues, f, dir);
    if (m.ambiguous) { out.ambiguous.push({ finding: f.id, issues: m.ambiguous }); continue; }
    if (m.issue) {
      if (flags.adopt === true) out.adopted.push({ finding: f.id, issue: m.issue.id, key });
      else out.mentioned.push({ finding: f.id, issue: m.issue.id });
      continue;
    }
    toFile.push({ f, key });
  }
  // The keys of the findings about to be filed that the mapping does not read: they pass, and the run says which.
  const extras = new Map();
  for (const { f } of toFile) for (const k of f.extras) extras.set(k, [...(extras.get(k) || []), f.id]);
  out.extras = [...extras].map(([key, findings]) => ({ key, findings }));
  // A findings file is one act: the parent is held, and every finding to be filed passes the checks of the filing, before the
  // first write (a dry run included), so a refusal leaves the loop as it was.
  const parent = flags.parent !== undefined ? parentToFile(root, flags.parent, { flag: '--parent', value: hole('<id>') }) : null;
  out.parent = parent ? parent.id : null;
  const filing = (f, key) => ({
    kind: flags.kind || f.kind, prio: flags.prio || f.priority, tier: flags.tier, tags: flags.tags, repo: flags.repo,
    field: flags.field, 'found-by': foundBy, where: f.where, what: f.what, why: f.why, acceptance: f.acceptance || undefined, source: key,
  });
  for (const { f, key } of toFile) {
    try { cmdNew(root, f.title, filing(f, key), { dry: true }); } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      refuse(`finding "${f.id}" cannot be filed: ${e.reason}${/nothing was (written|filed)/.test(e.reason) ? '' : ' — nothing was filed'}`, formOf(e.ready));
    }
  }
  if (out.dryRun) {
    out.filed = toFile.map(({ f, key }) => ({ id: null, finding: f.id, source: key, title: f.title, kind: flags.kind || f.kind, priority: String(flags.prio || f.priority) }));
    return out;
  }
  // One issue may name several findings (a package of minor ones): its Source gets all of them, once.
  const adopt = new Map();
  for (const a of out.adopted) adopt.set(a.issue, [...(adopt.get(a.issue) || []), a.key]);
  // Every adopted issue is resolved before the first write, so a number two files carry refuses the import whole.
  const adopting = [...adopt].map(([id, keys]) => [id, [...findIssue(root, id).sources, ...keys]]);
  for (const [id, sources] of adopting) cmdSource(root, id, sources.join(','));
  for (const { f, key } of toFile) {
    const r = cmdNew(root, f.title, filing(f, key));
    out.filed.push({ id: r.id, finding: f.id, source: key, title: f.title, kind: flags.kind || f.kind, priority: String(flags.prio || f.priority) });
  }
  if (parent && out.filed.length) putUnder(root, out.filed.map((x) => x.id), parent, { by: flags.by });
  appendLog(root, `imported ${dir} · ${out.filed.length} filed, ${out.already.length} already filed${out.adopted.length ? `, ${out.adopted.length} adopted` : ''}${out.mentioned.length ? `, ${out.mentioned.length} named by an issue without Source` : ''}${out.ambiguous.length ? `, ${out.ambiguous.length} ambiguous` : ''}`);
  return out;
}

// sources — per report: its findings, the issues filed from them and where those stand. With findings files,
// every finding in them is listed, the unfiled ones too; without, only what the issues' Source fields name.
export function cmdSources(root, files, flags = {}) {
  const issues = loadIssues(root);
  const filedAs = bySource(issues);
  const reports = new Map();   // dir -> ordered finding ids
  const add = (dir, id) => { if (!reports.has(dir)) reports.set(dir, []); if (!reports.get(dir).includes(id)) reports.get(dir).push(id); };
  need(files.length <= 1 || flags.source === undefined, '--source names one report directory: give one findings file with it', () => ({ rename: '--source', to: '<no-flag-here>' }));
  const mentionKey = new Map();
  for (const file of files) { const { dir, findings } = readFindings(file, flags, 'sources'); findings.forEach((f) => { add(dir, f.id); mentionKey.set(`${dir}#${f.id}`, f); }); }
  for (const key of filedAs.keys()) { const at = key.indexOf('#'); add(key.slice(0, at), key.slice(at + 1)); }
  const fromFile = new Set();
  for (const file of files) fromFile.add(readFindings(file, flags, 'sources').dir);
  return [...reports.entries()].map(([dir, ids]) => {
    const rows = ids.map((id) => {
      const on = filedAs.get(`${dir}#${id}`) || [];
      if (on.length) return { finding: id, issues: on.map((i) => ({ id: i.id, status: i.status })) };
      const m = mentionKey.has(`${dir}#${id}`) ? mentionOf(issues, mentionKey.get(`${dir}#${id}`), dir) : {};
      return { finding: id, issues: [], ...(m.issue ? { mentionedBy: [m.issue.id] } : m.ambiguous ? { mentionedBy: m.ambiguous } : {}) };
    });
    const distinct = [...new Map(rows.flatMap((r) => r.issues).map((i) => [i.id, i])).values()];
    const byStatus = {};
    for (const i of distinct) byStatus[i.status] = (byStatus[i.status] || 0) + 1;
    return {
      source: dir, findings: fromFile.has(dir) ? ids.length : null, filed: rows.filter((r) => r.issues.length).length,
      mentioned: rows.filter((r) => !r.issues.length && r.mentionedBy).length, unfiled: rows.filter((r) => !r.issues.length && !r.mentionedBy).length,
      issues: byStatus, rows,
    };
  });
}

// The counts line of status and resume: the issues ready (in the dispatchable status — built-in: open) and in flight
// (lease), less those waiting on After, then every other status by its own name, then the questions.
// One status's count from a status object, with or without a profile (see cmdStatus).
function countOf(o, st) { return (o.statuses || o)[st] || 0; }
function countsLine(o, profile) {
  const ready = profile.with('dispatchable');
  const rest = profile.statuses.filter((st) => !profile.active(st)).map((st) => ` · ${st} ${countOf(o, st)}`).join('');
  // Under an external scheduler Jarl does not reckon readiness: each dispatchable status by its own count instead.
  const head = o.scheduler ? ready.map((st) => `${st} ${countOf(o, st)}`).join(' · ') : `${ready.length === 1 ? ready[0] : 'ready'} ${o.ready}`;
  return `${head} · in flight ${o.inFlight}${o.waiting ? ` · waiting ${o.waiting}` : ''}${rest} · questions ${o.questions}${o.escalations ? ` · escalations ${o.escalations}` : ''}${o.ratify ? ` · to ratify ${o.ratify}` : ''}${o.ciPending.length ? ` · merged, CI pending ${o.ciPending.length}` : ''}${o.ciRed.length ? ` · CI red ${o.ciRed.length}` : ''}`;
}
const statusLabel = (st) => (st === 'in-progress' ? 'in flight' : st);

// The coordinators and their slices, one line: who runs which slice and how many of its issues are in play.
function slicesLine(slices) {
  const inPlay = (s) => `(${s.inPlay ? `${s.inPlay} in play` : 'none in play'})`;
  return `slices: ${slices.map((s) => (s.declared ? `${s.coordinator} runs ${s.tag} ${inPlay(s)}` : `${s.tag} has no coordinator on the goal's Coordinators line ${inPlay(s)}: its approve counts as fresh until the line names ${s.coordinator}`)).join(' · ')}`;
}
export function renderStatus(o, profile = DEFAULT_PROFILE) {
  const head = o.goal ? `goal: ${o.goal}\nopened ${o.opened || '?'} · last activity ${o.lastActivity || '?'}${o.archived ? ` · ${o.archived} archived loop(s)` : ''}${o.recordFormat ? ` · record format ${o.recordFormat.format}` : ''}${profile.declared ? ` · profile ${profile.name}` : ''}\n` : '';
  const line = countsLine(o, profile);
  const width = o.by ? Math.max(...Object.keys(o.by.groups).map((k) => k.length), 1) : 0;
  const by = o.by ? [`by ${o.by.key}:`, ...Object.entries(o.by.groups).map(([k, g]) => `  ${k.padEnd(width)}  ${profile.statuses.map((st) => `${statusLabel(st)} ${g[st]}`).join(' · ')}`)] : [];
  const onSubs = new Set((o.waitingOnSubs || []).map((w) => w.id));
  const more = [
    ...(o.tag !== undefined ? [`scoped to the issues tagged ${o.tag} — the counts above and the lists below are theirs only`] : []),
    ...(o.slice !== undefined ? [`scoped to the slice of ${o.slice}, the issues tagged slice:${o.slice}, and the escalations that name it — the counts above and the lists below are theirs only`] : []),
    ...(o.slices ? [slicesLine(o.slices)] : []),
    ...(o.disagreements || []).map(disagreementText),
    ...(o.headerRead || []).map((n) => `note: ${n.line}`),
    ...(o.check ? checkLines(o.check) : []),
    ...(o.scheduler ? [schedulerNote(o.scheduler)] : []),
    ...(o.recordFormat && formatOffText(o.recordFormat) ? [formatOffText(o.recordFormat)] : []),
    ...by,
    ...(o.by && o.by.where && Object.keys(o.by.where).length ? ['where each repository is on this machine:', ...reposWhereLines(o.by.where)] : []),
    ...(o.by && o.by.key === 'repo' && o.check ?['merges by repository, with the check that decided each:', ...mergeCheckLines(o.check)] : []),
    ...o.stale.map((x) => `stale ${x.id} · ${x.problems.join('; ')}`),
    ...(o.ciPending.length ? [`merged, CI pending: ${o.ciPending.join(', ')}`] : []),
    ...(o.ciRed.length ? [`merged, CI red: ${o.ciRed.join(', ')}`] : []),
    ...(o.checkWaiting || []).map(checkWaitingText),
    ...(o.closedNoCheck && o.closedNoCheck.length ? [closedNoCheckText(o.closedNoCheck)] : []),
    ...(profile.with('closes-record').some((st) => countOf(o, st)) ? [gateLine(profile, o.reviews, 'done reviewed by')] : []),
    ...(o.uncommitted ? [`${o.uncommitted} loop file(s) not committed — commit .jarl/ in the loop's repository`] : []),
    ...o.toRatify.map((a) => `ratify a-${a.id}${a.issue ? ` (issue ${a.issue})` : ''} · ${a.question}`),
    ...(o.waitingIds.some((id) => !onSubs.has(id)) ? [`waiting (After not settled): ${o.waitingIds.filter((id) => !onSubs.has(id)).join(', ')}`] : []),
    ...(o.waitingOnSubs ? [`waiting on their sub-issues: ${o.waitingOnSubs.map((w) => `${w.id} (${w.subs.join(', ')})`).join(', ')}`] : []),
    ...(o.parents || []).map((p) => `parent ${p.id} · sub-issues ${subsText(p.subs)} · ${p.next}`),
    ...(o.noAcceptance.length ? [`in flight with no acceptance line: ${o.noAcceptance.join(', ')}`] : []),
    ...(o.closedGate || []).map(closedGateLine),
    ...(o.inFlightRows || []).map((x) => `in flight ${x.id}${leasedByText(x) ? ` · ${leasedByText(x)}` : ''} · ${x.next}`),
  ];
  return `${head}${line}${more.length ? `\n${more.join('\n')}` : ''}`;
}

// A text under its label, every further line under the first one's text; an empty text leaves the label alone on its line.
const indented = (label, text) => text.split('\n').map((l, n) => (n === 0 ? `    ${label}${l}`.trimEnd() : l ? `    ${' '.repeat(label.length)}${l}` : '')).join('\n');

// How many of the findings already filed were compared with their issue, and why the others were not.
function comparedLine(o) {
  const count = (reason) => o.notCompared.filter((x) => x.reason === reason).length;
  const why = [
    count('no-claim-or-truth') && `${count('no-claim-or-truth')} with neither a claim nor a truth`,
    count('no-issue-of-this-run') && `${count('no-issue-of-this-run')} with no issue that reads as filed by import with Found by "${o.foundBy}"`,
  ].filter(Boolean);
  return `compared ${o.compared.length} of ${o.already.length} already filed${why.length ? ` · not compared: ${why.join(', ')}` : ''}`;
}

export function renderImport(o) {
  const head = `${o.source}: ${o.findings} finding(s)${o.considered !== o.findings ? `, ${o.considered} chosen` : ''} · ${o.dryRun ? 'would file' : 'filed'} ${o.filed.length} · already filed ${o.already.length}${o.changed.length ? ` · changed since filed ${o.changed.length}` : ''}${o.adopted.length ? ` · adopted ${o.adopted.length}` : ''}${o.mentioned.length ? ` · named by an issue without Source ${o.mentioned.length} (--adopt links them)` : ''}${o.ambiguous.length ? ` · ambiguous ${o.ambiguous.length}` : ''}${o.parent ? ` · under ${o.parent}` : ''}`;
  const rows = [
    ...(o.already.length ? [comparedLine(o)] : []),
    ...(o.extras.length ? [`extra keys let through, not read: ${o.extras.map((x) => `${x.key} (${x.findings.length} finding${x.findings.length === 1 ? '' : 's'})`).join(', ')}`] : []),
    ...o.filed.map((f) => `${o.dryRun ? 'would file' : `filed ${f.id}`} · ${f.finding} · ${f.kind} P${f.priority} · ${f.title}`),
    ...o.changed.flatMap((c) => c.parts.flatMap((p) => [
      `changed since filed · ${c.finding} · issue ${c.issue} (${c.status}) · ${p.part}`,
      ...[['issue', p.issueText], ['finding', p.findingText]].map(([who, text]) => indented(`${who}:`.padEnd(9), text)),
    ])),
    ...o.adopted.map((a) => `adopted ${a.issue} · ${a.finding}`),
    ...o.mentioned.map((m) => `named by ${m.issue} · ${m.finding}`),
    ...o.ambiguous.map((m) => `ambiguous · ${m.finding} · named by ${m.issues.join(', ')}`),
    ...(o.changed.length ? ['import leaves the text of an issue as it is: the issue and the finding are shown as they stand'] : []),
  ];
  return [head, ...rows].join('\n');
}

export function renderSources(reports) {
  if (!reports.length) return '(no issue carries a Source, and no findings file was given)';
  return reports.map((r) => {
    const st = Object.entries(r.issues).map(([k, v]) => `${k} ${v}`).join(', ');
    const head = `${r.source} · ${r.findings === null ? '' : `${r.findings} finding(s) · `}${r.filed} filed${r.mentioned ? ` · ${r.mentioned} named by an issue without Source` : ''}${r.findings === null ? '' : ` · ${r.unfiled} unfiled`}${st ? ` · issues: ${st}` : ''}`;
    const rows = r.rows.map((x) => `  ${x.finding}  ${x.issues.length ? x.issues.map((i) => `${i.id} ${i.status}`).join(', ') : x.mentionedBy ? `named by ${x.mentionedBy.join(', ')} (no Source)` : 'unfiled'}`);
    return [head, ...rows].join('\n');
  }).join('\n\n');
}

// The profile's declared fields an issue holds a value for, as Name=value — shown by list and resume.
function declaredShown(i, profile) {
  return profile.fields.map((f) => [f.name, fieldText(i.fields[f.key])]).filter(([, v]) => v).map(([n, v]) => `${n}=${v}`).join(' ');
}
// The list shows the tree: a sub-issue stands indented under the nearest issue above it that the list holds, two spaces a
// level, and one whose parent the list leaves out names it.
export function renderList(rows, profile = DEFAULT_PROFILE) {
  if (rows.length === 0) return '(none)';
  const listed = new Set(rows);
  const depth = (i) => (i.tree ? i.tree.ancestors.filter((a) => listed.has(a)).length : 0);
  const under = (i) => (i.tree && i.tree.parent && !listed.has(i.tree.parent) ? `  (sub-issue of ${i.tree.parent.id})` : '');
  return rows.map((i) => { const d = declaredShown(i, profile); return `${'  '.repeat(depth(i))}${i.id}  P${i.priority}  ${i.status.padEnd(11)} ${i.kind.padEnd(8)} ${i.title}${i.tags.length ? `  [${i.tags.join(', ')}]` : ''}${d ? `  ${d}` : ''}${under(i)}${i.shared ? `  (${sharedMark(i.shared)})` : ''}`; }).join('\n');
}

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { countsLine };
