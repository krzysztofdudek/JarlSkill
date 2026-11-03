// The commands that write the record: init, new, body, set, field, merged and the rest, and the cleanup a
// recorded merge makes redundant.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, openSync, closeSync, writeSync, unlinkSync, linkSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { CI_STATES, KEPT_KINDS, LEASE_FIELDS, PRIORITIES, TIERS, WAIT_KIND, fieldText, need, noSeparators, slugify, splitList } from './base.mjs';
import { needNoNewOwnersWords, needNoOwnersWords } from './owner.mjs';
import { git, gitRun } from './git.mjs';
import { canonical, issuesDir, jarlDir, portablePath, stamp, today } from './where.mjs';
import { readText, renameRetry, writeAtomic } from './files.mjs';
import { ISSUE_FILE_RE, branchNameProblem, cmpId, expandIds, idKey, idRe, isBulk, needsRaisedFormat, newNumber } from './ids.mjs';
import { DEFAULT_PROFILE, TOOL_FIELDS, loadProfile, numberWidth, profilePath, readProfileFile } from './profile.mjs';
import { appendLog, appendLogLines, decisionsPath, goalPath, logPath } from './journal.mjs';
import { JARL_GITIGNORE, JARL_GITIGNORE_COMMITTED, ensureLoopMerge, outOfGit } from './loop-git.mjs';
import { HANDOVER_SEGMENT, journalById, mergeCheckText } from './log.mjs';
import { FIELD_RE, RENDERED_FIELDS, acceptanceHeading, acceptanceLineCount, acceptanceText, bodyText, changelogText, evidenceNotes, evidenceParts, evidenceRows, evidenceTable, fieldValue, findIssue, issueNamed, loadIssues, mergedOf, namedPairs, needNoFieldTags, noteText, parseIssue, placeEvidence, removeFields, removeFirstField, renderIssue, setField, setSection, unattributedRefusal } from './issues.mjs';
import { branchTip, commitRepoNames, defaultBase, fileKeysOf, isGitRepo, issueRepoPaths, issueRepos, mainCheckoutOf, needFormat, needRightCheckouts, repoFromInput, repoLabel, repoList, tipLines, whyNotDeletable, worktreeState, worktreesOf } from './repositories.mjs';
import { FIELD_NAMES, carriesCode, gateOf, readLoop, unorderedNamings, unorderedText } from './loop.mjs';
import { declaredChecks, lastMerge } from './metrics.mjs';
import { modelLines, modelValue, spellingNote } from './models.mjs';
import { slotRefusal } from './attachments.mjs';
import { resetCaches } from './tips.mjs';

// ---- commands ----------------------------------------------------------------------------------

export const PERMANENT_MARKER = 'This loop is a permanent record: it is not tied to a feature branch, and `close` never removes this directory. See SKILL.md.\n';

export function cmdInit(root, goal, flags = {}) {
  need(flags.committed === undefined || flags.committed === true, '--committed takes no value — put the goal first: init "<goal>" --committed');
  need(flags.permanent === undefined || flags.permanent === true, '--permanent takes no value — put the goal first: init "<goal>" --permanent');
  need(goal, 'init requires "<goal>"');
  need(!hasLiveLoop(root), '.jarl/ already exists here with a live loop — resume it, or archive it first: jarl.mjs archive "<slug>"');
  // The profile is read and checked before anything is written: a bad one leaves no half-opened loop behind.
  const prof = flags.profile !== undefined ? readProfileFile(flags.profile) : null;
  // A .jarl/ left behind by `archive` holds only archive/ and the mode markers, and the new loop
  // keeps that mode: the markers are the loop's own record of how it lives in git.
  const archived = existsSync(jarlDir(root));
  let permanent = flags.permanent === true;
  let committed = flags.committed === true || permanent;
  if (archived) {
    const kept = existsSync(join(jarlDir(root), '.permanent')) ? 'permanent' : outOfGit(root) ? 'default' : 'committed';
    const asked = permanent ? 'permanent' : committed ? 'committed' : null;
    need(asked === null || asked === kept, `this .jarl/ keeps its archived loops in the ${kept} mode, and a new loop here keeps that mode — run init without --${asked}`);
    permanent = kept === 'permanent';
    committed = kept !== 'default';
  }
  mkdirSync(issuesDir(root), { recursive: true });
  if (!archived) writeAtomic(join(jarlDir(root), '.gitignore'), committed ? JARL_GITIGNORE_COMMITTED : JARL_GITIGNORE);
  if (!archived && permanent) writeAtomic(join(jarlDir(root), '.permanent'), PERMANENT_MARKER);
  writeAtomic(goalPath(jarlDir(root)), `# Goal\n\n${goal.trim()}\n\n## Assumptions\n\n## Rules that apply here\n`);
  writeAtomic(decisionsPath(jarlDir(root)), '# Decisions\n');
  writeAtomic(logPath(jarlDir(root)), '# Log\n\n');
  if (prof) writeAtomic(profilePath(root), `${JSON.stringify(prof.json, null, 2)}\n`);
  if (committed) ensureLoopMerge(root);
  appendLog(root, `opened · ${goal.trim()}${prof ? ` · profile ${prof.profile.name}` : ''}`);
  // Said once, on the command line: a goal that names no check lands its merges on testimony, whatever they record.
  const noCheck = flags.caller === 'cli' && declaredChecks(root).length === 0;
  return { dir: jarlDir(root), committed, permanent, ...(prof ? { profile: prof.profile.name } : {}), ...(noCheck ? { note: 'the goal names no check (a "Check: <command>" line, or "Check (<repo>): <command>" for one repository) — this loop lands on testimony alone, whatever its merges record, until the goal declares one' } : {}) };
}

// A live loop is one with a goal; a .jarl/ holding only archive/ and the mode markers has none.
export function hasLiveLoop(root) {
  return existsSync(goalPath(jarlDir(root)));
}

// The refusal for a command that needs a live loop: no .jarl/ at all, or one holding only archives.
function needLiveLoop(root, next) {
  need(existsSync(jarlDir(root)), `no .jarl/ here${next}`);
  need(hasLiveLoop(root), `no live loop here — .jarl/ holds only archived loops${next}`);
}

// What stays in .jarl/ when a loop is archived: the archive itself, the markers that say how the loop lives in
// git, so the next loop opened here keeps the same mode, and the issue templates, which belong to the place, not
// to one loop.
const ARCHIVE_KEEPS = new Set(['archive', 'templates', '.gitignore', '.gitattributes', '.permanent', '.lock', '.lock.break']);

// archive "<slug>" — put the current loop away under .jarl/archive/<yyyy.mm.dd>-<slug>/ so a new one
// can be opened here with init. Everything but the archive and the mode markers moves: issues, goal,
// decisions, log, handoff. Open work is not a refusal (archiving is how a session sets old work
// aside), but the result names it, and the loop's own log records the move before it goes.
export function cmdArchive(root, slug, flags = {}) {
  need(slug, 'archive requires "<slug>" — a short name for the loop being put away');
  need(hasLiveLoop(root), existsSync(jarlDir(root)) ? 'no loop to archive here — .jarl/ holds only earlier archives; open one with: jarl.mjs init "<goal>"' : 'no .jarl/ here');
  needLifecycle(root, 'archive', flags.caller);
  const name = `${today().replace(/-/g, '.')}-${slugify(slug)}`;
  const dest = join(jarlDir(root), 'archive', name);
  need(!existsSync(dest), `.jarl/archive/${name} already exists — pick another slug`);
  const profile = loadProfile(root);
  const left = loadIssues(root).filter((i) => profile.unfinished(i.status)).map((i) => i.id);
  appendLog(root, `archived → .jarl/archive/${name}${left.length ? ` · ${left.length} still open or in progress: ${left.join(', ')}` : ''}`);
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(jarlDir(root))) {
    if (ARCHIVE_KEEPS.has(entry)) continue;
    renameRetry(join(jarlDir(root), entry), join(dest, entry));
  }
  return { archived: dest, leftOpen: left };
}

// Put a written temporary file in place under a name that must not exist yet: a hard link never overwrites,
// so it is the claim. On a file system without hard links, an exclusive create and a copy of the content
// do the same (the lock already keeps other writers out; readers may see the file an instant before it
// is complete). False when the name is taken.
const NO_LINKS = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV']);
export function claimFile(tmp, file, link = linkSync) {
  try { link(tmp, file); return true; } catch (e) {
    if (e.code === 'EEXIST') return false;
    if (!NO_LINKS.has(e.code)) throw e;
  }
  let fd;
  try { fd = openSync(file, 'wx'); } catch (e) { if (e.code === 'EEXIST') return false; throw e; }
  try { writeSync(fd, readFileSync(tmp)); } finally { closeSync(fd); }
  return true;
}

// A template is .jarl/templates/<name>.md: an issue file without a number — header fields (Kind, Priority, Tier, Tags,
// Files) as defaults and What, Why, Acceptance and Changelog sections as the body. A flag given on the call wins over
// the template, field by field and section by section. Templates are the loop's own and outlive it: archive keeps them.
export const TEMPLATE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export function templatesDir(root) { return join(jarlDir(root), 'templates'); }
export function readTemplate(root, name) {
  need(typeof name === 'string' && TEMPLATE_RE.test(name), `a template is named by letters, digits and . _ - (the file .jarl/templates/<name>.md) — not "${name}"`);
  const path = join(templatesDir(root), `${name}.md`);
  if (!existsSync(path)) {
    const have = existsSync(templatesDir(root)) ? readdirSync(templatesDir(root)).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)) : [];
    throw new Error(`no template ${name} in ${templatesDir(root)} — ${have.length ? `templates here: ${have.join(', ')}` : 'none here yet; write one as an issue file without a number (see references/jarl.md, "Templates")'}`);
  }
  // The template is read as an issue whose title line may be anything: only its fields and sections count. A template
  // that starts straight with a field has no title line, so that first field is read as a field, not dropped.
  const raw = readText(path);
  const t = parseIssue(FIELD_RE.test(raw.split('\n')[0]) ? `# template\n${raw}` : raw, path);
  const section = (k) => (t.sections[k] !== undefined && t.sections[k].trim() ? t.sections[k].trim() : undefined);
  return {
    kind: t.fields.kind || undefined, prio: t.fields.priority || undefined, tier: t.fields.tier || undefined,
    tags: t.fields.tags || undefined, files: t.fields.files || undefined,
    what: section('what'), why: section('why'), acceptance: section('acceptance'), changelog: section('changelog'),
    // Every field and section as read, for the ones a loop's profile declares (see cmdNew).
    allFields: t.fields, section,
  };
}

// The highest issue number any copy of this loop holds (the main checkout and every linked worktree), 0 when none.
function highestAcrossWorktrees(root) {
  const found = mainCheckoutOf(root);
  let top = 0;
  for (const copy of found ? found.copies : []) {
    const dir = issuesDir(copy);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) { const m = ISSUE_FILE_RE.exec(f); if (m) top = Math.max(top, Number(m[1])); }
  }
  return top;
}

// When a tier is light, standard or strong: the criteria the skill gives, as a prior the measurements then refine.
export const TIER_CRITERIA = {
  light: 'a check or test decides, the scope is written down, nothing that protects changes',
  standard: 'a clear acceptance and a known place in the code',
  strong: 'unknown cause (a flaky test too), a design, a record format or contract, security or data integrity, anything that weakens a protection, a takeover after the red rounds the loop allows, finishing another worker\'s uncommitted work',
};
function tierNote(profile, tier) {
  const builtIn = profile.tiers.length === TIERS.length && profile.tiers.every((t, k) => t === TIERS[k]);
  return `note: no --tier given, so tier ${tier} was recorded${builtIn ? ` — ${TIERS.map((t) => `${t}: ${TIER_CRITERIA[t]}`).join('; ')}` : ' (this loop\'s default)'}; name it with --tier`;
}
// The kind and the priority a new issue took when its flag was not given: said so, as the tier is.
function defaultedNote(field, value, flag) {
  return `note: no --${flag} given, so ${field} ${value} was recorded (the default); name it with --${flag}`;
}

export function cmdNew(root, title, rawFlags) {
  need(title, 'new requires "<title>"');
  needNoOwnersWords('the new issue', title, rawFlags);
  // A title is the heading line of the issue: line breaks in it become spaces, so the lines after the first are not lost to the heading.
  if (/[\r\n]/.test(title)) title = String(title).split(/\r\n?|\n/).map((l) => l.trim()).filter(Boolean).join(' ');
  needLiveLoop(root, ' — run: jarl.mjs init "<goal>"');
  // A linked worktree of a committed loop holds only the copy it was cut with, so a number taken there may already be used
  // in the main checkout: file from the main checkout.
  const placed = mainCheckoutOf(root);
  need(!placed || !placed.linked || !existsSync(jarlDir(placed.mainRoot)), `${root} is a linked worktree of ${placed?.mainRoot}, which holds this loop: its copy here may lag, and the number would be used twice — file from the main checkout: pass --root ${placed?.mainRoot}`);
  let flags = rawFlags;
  let fromTemplate = {};
  if (rawFlags.template !== undefined) {
    const t = readTemplate(root, rawFlags.template);
    fromTemplate = t;
    flags = { ...rawFlags };
    for (const k of ['kind', 'prio', 'tier', 'tags', 'files', 'what', 'why']) if (flags[k] === undefined && t[k] !== undefined) flags[k] = t[k];
  }
  const profile = loadProfile(root);
  // The profile's fields and sections: a flag's value, else the template's, else the field's default. A required
  // field with none of them is refused; a value outside a field's enum is refused.
  const given = namedPairs(flags.field, 'field', profile.fields.map((f) => f.name), 'field');
  const fields = profile.fields.map((f) => {
    const raw = given.has(f.name) ? given.get(f.name) : fromTemplate.allFields?.[f.key] || f.default || '';
    const v = fieldValue(profile, f, raw);
    need(!f.required || v, `${f.name} is required by this loop's profile — give it: --field "${f.name}=<value>"${f.enum ? ` (one of: ${f.enum.join(', ')})` : ''}`);
    return [f.name, v];
  });
  const givenSections = namedPairs(flags.section, 'section', profile.sections, 'section');
  needNoFieldTags(flags.what, 'the What text');
  needNoFieldTags(flags.why, 'the Why text');
  for (const [h, v] of givenSections) needNoFieldTags(v, `the ${h} text`);
  const sections = profile.sections.map((h) => [h, givenSections.has(h) ? bodyText(givenSections.get(h)) : bodyText(fromTemplate.section?.(h.toLowerCase()))]);
  if (profile.acceptance && fromTemplate.acceptance === undefined && fromTemplate.section) fromTemplate.acceptance = fromTemplate.section(profile.acceptance.toLowerCase());
  const kind = flags.kind || profile.kindDefault;
  const kindDefaulted = !flags.kind;
  need(profile.kinds.includes(kind), `--kind must be one of: ${profile.kinds.join(', ')}`);
  const person = flags.person !== undefined ? keptValue('Person', flags.person) : '';
  const checkWhen = flags['check-when'] !== undefined ? keptValue('Check when', flags['check-when']) : '';
  need(kind === WAIT_KIND || (!person && !checkWhen), `--${person ? 'person' : 'check-when'} goes with --kind wait: it names the outside person a wait is held by and when to check it`);
  need(kind !== WAIT_KIND || (person && checkWhen), `a wait names the outside person it is held by and when to check it: jarl.mjs new "<title>" --kind wait --person "<name>" --check-when "<a date, or the event to check after>"`);
  const priority = String(flags.prio || '2');
  const priorityDefaulted = !flags.prio;
  need(PRIORITIES.includes(priority), '--prio must be 1, 2 or 3');
  const tier = String(flags.tier || profile.tierDefault);
  need(profile.tiers.includes(tier), `--tier must be one of: ${profile.tiers.join(', ')} — the tier of model the worker is raised on, mapped to a model by the platform running the loop`);
  const picked = flags.repo !== undefined ? repoList(root, flags.repo) : [];
  const source = sourceList(flags.source);
  const after = flags.after !== undefined ? afterList(root, null, flags.after) : [];
  // A promise and a wait are kinds a reader of formats 1 and 2 does not know: the loop is raised first, or, where a composer
  // keeps its format, the filing is refused with nothing written.
  if (KEPT_KINDS.includes(kind)) needFormat(root, 'promise-wait');
  commitRepoNames(root, picked);
  // The number is claimed by creating the file with a link, which never overwrites: when another
  // writer got there first (the lock makes that rare, not impossible — a hand-made file, a stale
  // lock broken early), the next number is tried instead of two issues sharing one.
  const dir = issuesDir(root);
  // Git keeps no empty directory, so a clone of a loop committed before its first issue has none yet.
  mkdirSync(dir, { recursive: true });
  const taken = () => readdirSync(dir).map((f) => ISSUE_FILE_RE.exec(f)).filter(Boolean).map((m) => Number(m[1]));
  // The highest number over this loop and its copies in every other worktree (read-only), so a lagging copy cannot hand
  // out a number already used elsewhere. The issue files stay the only source: there is no counter file.
  const elsewhere = highestAcrossWorktrees(root);
  let n = Math.max(taken().reduce((m, x) => Math.max(m, x), 0), elsewhere) + 1;
  for (let tries = 0; ; tries += 1) {
    const id = newNumber(n, numberWidth(profile, rawFlags.width));
    // The first issue of 1000 or more is a file a reader that knows only format 1 would skip in silence: the format is raised first.
    if (needsRaisedFormat(id)) needFormat(root, 'plain-number');
    const file = join(dir, `${id}-${slugify(title)}.md`);
    const tmp = join(dir, `.${id}.${process.pid}.tmp`);
    const rendered = renderIssue({
      id, title, status: profile.initial, kind, priority, tier, fields, sections, acceptanceHeading: profile.acceptance || 'Acceptance',
      tags: splitList(flags.tags), files: pathList(flags.files), repo: picked.map((p) => p.value).join(', '), foundBy: flags['found-by'] || 'jarl', person, checkWhen,
      where: flags.where, what: bodyText(flags.what), why: bodyText(flags.why), source, after,
      // A template's Acceptance and Changelog are taken as written (a list already); a flag replaces them.
      acceptance: flags.acceptance !== undefined ? acceptanceText(flags.acceptance) : bodyText(fromTemplate.acceptance),
      changelog: flags.changelog !== undefined ? changelogText(flags.changelog) : bodyText(fromTemplate.changelog),
    });
    // The file is claimed by a link, not through writeAtomic, so its text passes the record's one check here (a template too).
    needNoNewOwnersWords('', rendered, `${id}-${slugify(title)}.md`);
    writeFileSync(tmp, rendered);
    let claimed = !taken().includes(n);
    // The filing goes into the journal first: a write that stops after it leaves the record ahead of the files (a filing
    // with no file, and the number is taken again), never a file the record does not hold.
    if (claimed) appendLog(root, `filed ${id} · ${title}${rawFlags.template !== undefined ? ` · template ${rawFlags.template}` : ''}`);
    if (claimed) { try { claimed = claimFile(tmp, file); } catch (e) { unlinkSync(tmp); throw e; } }
    unlinkSync(tmp);
    if (claimed) {
      // Said on the command line only (a library caller gets none, and its result does not change): the tier it used, and
      // the kind and priority it took by default.
      const notes = rawFlags.caller === 'cli' ? [
        rawFlags.tier === undefined ? tierNote(profile, tier) : null,
        kindDefaulted ? defaultedNote('kind', kind, 'kind') : null,
        priorityDefaulted ? defaultedNote('priority', priority, 'prio') : null,
        ...picked.map((p) => p.note && `note: ${p.note}`),
        ...unorderedNotes(root, profile, id),
      ].filter(Boolean) : [];
      const note = notes.length ? { note: notes.join('\n') } : {};
      return { id, file, ...(rawFlags.template !== undefined ? { template: rawFlags.template } : {}), ...note };
    }
    need(tries < 100, 'could not claim a free issue number after 100 tries');
    n = Math.max(n + 1, taken().reduce((m, x) => Math.max(m, x), 0) + 1);
  }
}

// The notes for the text of an issue just written: one for the unfinished issues it names that nothing orders with it.
function unorderedNotes(root, profile, id) {
  return unorderedNamings(loadIssues(root), profile, [id]).map((n) => `note: issue ${n.id}: ${unorderedText(n)}`);
}

function pathList(v) { return splitList(v).map((p) => portablePath(p)); }

// A Source entry names one finding for good: the report's directory (dated, so unique) and the finding's id
// inside it, <dir>#<id>. Several are one comma list.
export function sourceList(v) {
  const list = splitList(v);
  for (const s of list) need(/^[^#\s]+#[^#\s]+$/.test(s), `a source is <report dir>#<finding id>, e.g. core/research/2026-09-25-jarl#jarl-2-B2 — not "${s}"`);
  return list;
}

// The issues one waits on: each must exist and not be the issue itself, and the chain must not come back to
// it — a cycle would leave every issue in it waiting for good with nothing to say so.
function afterList(root, selfId, raw) {
  const keys = expandIds(raw);
  const all = loadIssues(root);
  const missing = keys.filter((k) => !all.some((i) => idKey(i.id) === k));
  need(missing.length === 0, `no such issue: ${missing.join(', ')}`);
  const ids = keys.map((k) => issueNamed(all, k).id);
  need(!selfId || !ids.some((id) => idKey(id) === idKey(selfId)), `${selfId} cannot wait on itself`);
  if (selfId) {
    const byId = new Map(all.map((i) => [i.id, i]));
    const seen = new Set();
    const stack = [...ids];
    while (stack.length) {
      const id = stack.pop();
      need(idKey(id) !== idKey(selfId), `${selfId} after ${ids.join(', ')} would close a cycle: that chain of After already leads back to ${selfId}, so none of them would ever be offered`);
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(byId.get(id)?.after || []));
    }
  }
  return ids;
}

// The After issues not yet settled: an issue in a settles-dependents status settles (built-in: done and dropped);
// any other does not (open, in progress, deferred). An After id with no issue behind it (removed by hand) holds
// nothing back.
export function waitingOn(issue, byId, profile = DEFAULT_PROFILE) {
  return issue.after.filter((id) => byId.has(id) && !profile.is(byId.get(id).status, 'settles-dependents'));
}

// ---- the description of an issue -----------------------------------------------------------------
//
// An issue is its description and its history. Every part of the description (the title, the header fields below, the
// fields a profile declares, the What, Why, Acceptance and Changelog sections and the sections a profile declares) is
// changed by a command, and every change writes one log line that names the part, who changed it and what it held
// before. The history (evidence rows and notes, verdicts, merges, rulings, answers) has no edit at all: a row or an
// approve is taken back by retract, a ruling replaced by decide --supersedes, and the status moves only through set.

// The header fields of the description, each written by field and by its own command.
export const DESCRIPTION_FIELDS = ['Title', 'Priority', 'Tier', 'Kind', 'Found by', 'Tags', 'Files', 'Repo', 'After', 'Source', 'Where', 'Resources', 'Person', 'Check when'];
// A wait's Person (the outside person it is held by, the name next --as answers to) and its Check when (a date, or the
// event to check after): each one value on one line, without the log's separator.
function keptValue(name, value) {
  const v = fieldText(value);
  need(typeof value === 'string' && v, `${name} needs a value: ${name === 'Person' ? 'the outside person a wait is held by' : 'when to check a wait, a date or the event to check after'}`);
  need(!/[\r\n]/.test(String(value).trim()), `${name} is one line (got ${JSON.stringify(String(value))})`);
  need(!v.includes('·'), `${name} is one value — not a phrase with "·" in it (got "${v}")`);
  return v;
}
// The name a description change records as its author, or null when the call names nobody: a write nobody named is
// logged with no author at all, never under a name nobody gave. A name is one name on one line, without the log's
// separator, which would let it be read as more than one segment of the line.
export function editorOf(by) {
  if (by === undefined || by === null) return null;
  const name = fieldText(by);
  need(typeof by === 'string' && name, '--by needs a name: who changed the description');
  need(!/[\r\n]/.test(String(by).trim()), `--by is one name on one line (got ${JSON.stringify(String(by))})`);
  need(!name.includes('·'), `--by is one name — not a phrase with "·" in it (got "${name}")`);
  return name;
}
// The stand-in a description line writes for the log's separator inside a value, as ⏎ stands in for a line break: the
// value stays readable, and no reader finds a separator in it.
const SEPARATOR_MARK = '∙';
// A value as one segment of a description line: on one line (each break as ⏎), each separator as its stand-in; (none) when empty.
const logValue = (v) => String(v ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean).join(' ⏎ ').replace(/·/g, SEPARATOR_MARK) || '(none)';
const byPart = (by) => (by ? ` · by ${by}` : '');
// The line a change of a header field writes, `<id> field <Name> · <value> · was <old value>[ · by <who>]`, or null when
// the field already holds the value: a change to nothing writes no line.
function fieldLine(id, name, value, was, by) {
  if (fieldText(value) === fieldText(was)) return null;
  return `${id} field ${name} · ${fieldText(value) === '' ? '(cleared)' : logValue(value)} · was ${logValue(was)}${byPart(by)}`;
}
// The most of a section's first line a body line keeps: the line stays one short line whatever the section holds.
const EXCERPT_CHARS = 120;
// The line a change of the title or of a section writes, `<id> body · <part> · was "<old text>"[ · by <who>]`, or null
// when the part already holds that text. The title is kept whole; a section by its first line (at most EXCERPT_CHARS)
// and its length, so a long section never floods the log.
function bodyLine(id, part, was, now, by) {
  const old = String(was ?? '').trim();
  if (old === String(now ?? '').trim()) return null;
  if (!old) return `${id} body · ${part} · was (none)${byPart(by)}`;
  if (part === 'title') return `${id} body · ${part} · was "${logValue(old)}"${byPart(by)}`;
  const first = old.split(/\r\n?|\n/)[0].trim();
  const cut = first.length > EXCERPT_CHARS ? `${first.slice(0, EXCERPT_CHARS)}…` : first;
  return `${id} body · ${part} · was "${logValue(cut)}" (${old.length} characters)${byPart(by)}`;
}
// The lines of a description change that are not null, appended in one write; nothing when every part was unchanged.
function logChanges(root, lines) {
  const kept = lines.filter(Boolean);
  if (kept.length) appendLogLines(root, kept);
}
// What a header field of an issue holds as written, '' when the header has none.
const heldField = (issue, name) => fieldText(issue.fields[name.toLowerCase()]);

// The items a list section holds, each line without its bullet, for an append to add to.
const itemsOf = (text) => String(text ?? '').split('\n').map((l) => l.trim().replace(/^-\s+/, '')).filter(Boolean);
// The text a section holds after an append: what it held, then the added text as its own paragraph.
const joinParagraphs = (held, added) => (String(held ?? '').trim() ? `${String(held).trim()}\n\n${added}` : added);
// body <id>: the title, the Where field and the What, Why, Acceptance and Changelog sections, and the profile's sections,
// set or replaced; with append, the text of each section is added after what it holds. Evidence is never written here:
// it is the record of what was done, appended by evidence, never replaced.
// `dry` checks everything the call would refuse and writes nothing: a list of ids is run dry on every id before the
// first one is written (see eachIssue).
export function cmdBody(root, rawId, flags, dry = false) {
  needNoOwnersWords('the body', flags);
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  const profile = loadProfile(root);
  const parts = ['title', 'where', 'what', 'why', 'acceptance', 'changelog', 'section'].filter((k) => flags[k] !== undefined);
  need(parts.length, 'body needs at least one of --title, --where, --what, --why, --acceptance, --changelog, --section');
  const by = editorOf(flags.by);
  const title = flags.title === undefined ? null : fieldText(flags.title);
  need(flags.title === undefined || title, '--title needs a title');
  const sections = namedPairs(flags.section, 'section', profile.sections, 'section');
  const append = flags.append === true;
  if (append) {
    need(flags.title === undefined && flags.where === undefined, '--append adds to a section (What, Why, Acceptance, Changelog or a profile section): the title and the Where field are replaced, not appended to');
    for (const [heading, v] of [['What', flags.what], ['Why', flags.why], ['Acceptance', flags.acceptance], ['Changelog', flags.changelog], ...sections]) {
      need(v === undefined || [].concat(v).some((x) => fieldText(x) !== ''), `--append needs text to add to the ${heading} section, not an empty one`);
    }
  }
  needNoFieldTags(flags.what, 'the What text');
  needNoFieldTags(flags.why, 'the Why text');
  for (const [h, v] of sections) needNoFieldTags(v, `the ${h} text`);
  const named = parts.flatMap((k) => (k === 'section' ? [...sections.keys()] : [k]));
  if (dry) return { id: issue.id, set: named };
  let text = readText(issue.file);
  const lines = [];
  const held = (key) => issue.sections[key] ?? '';
  // With append, a section keeps what it holds and the new text follows it.
  const grow = (heading, now) => (append ? joinParagraphs(held(heading.toLowerCase()), now) : now);
  // The title is the heading's text; the file keeps its name, so the number and the slug a branch was cut from stay.
  const section = (heading, part, now) => { text = setSection(text, heading, now); lines.push(bodyLine(issue.id, part, held(heading.toLowerCase()), now, by)); };
  if (title) { text = text.replace(idRe('^(#\\s+{id}\\s+·\\s+).*$', 'm'), (_, head) => `${head}${title}`); lines.push(bodyLine(issue.id, 'title', issue.title, title, by)); }
  if (flags.where !== undefined) { text = setField(text, 'Where', fieldText(flags.where)); lines.push(fieldLine(issue.id, 'Where', flags.where, heldField(issue, 'Where'), by)); }
  if (flags.what !== undefined) section('What', 'what', grow('What', bodyText(flags.what)));
  if (flags.why !== undefined) section('Why', 'why', grow('Why', bodyText(flags.why)));
  if (flags.acceptance !== undefined) {
    const heading = acceptanceHeading(issue, profile);
    const now = acceptanceText(append ? [...itemsOf(held(heading.toLowerCase())), ...[].concat(flags.acceptance)] : flags.acceptance);
    text = setSection(text, heading, now);
    lines.push(bodyLine(issue.id, 'acceptance', held('acceptance'), now, by));
  }
  for (const [h, v] of sections) section(h, h, grow(h, bodyText(v)));
  if (flags.changelog !== undefined) section('Changelog', 'changelog', changelogText(append ? [...itemsOf(held('changelog')), ...[].concat(flags.changelog)] : flags.changelog));
  logChanges(root, lines);
  writeAtomic(issue.file, text);
  // Said on the command line only: a rewritten What, Why or Acceptance that names issues nothing orders with this one.
  const note = flags.caller === 'cli' && ['what', 'why', 'acceptance'].some((k) => named.includes(k)) ? unorderedNotes(root, profile, issue.id) : [];
  return { id: issue.id, set: named, ...(note.length ? { note: note.join('\n') } : {}) };
}

export function cmdSource(root, rawId, list, dry = false, by = undefined) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  const editor = editorOf(by);
  const sources = sourceList(list);
  need(sources.length, 'source requires <report dir>#<finding id>[,...]');
  if (dry) return { id: issue.id, sources };
  logChanges(root, [fieldLine(issue.id, 'Source', sources.join(', '), heldField(issue, 'Source'), editor)]);
  writeAtomic(issue.file, setField(readText(issue.file), 'Source', sources.join(', ')));
  return { id: issue.id, sources };
}

export function cmdAfter(root, rawId, raw, { clear = false, dry = false, by } = {}) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  const editor = editorOf(by);
  if (clear) {
    need(raw === undefined, 'after takes either <ids> or --clear, not both');
    need(issue.fields.after !== undefined, `${issue.id} has no After field to clear`);
    if (dry) return { id: issue.id, after: [], cleared: true };
    logChanges(root, [fieldLine(issue.id, 'After', '', heldField(issue, 'After'), editor)]);
    writeAtomic(issue.file, removeFirstField(readText(issue.file), 'After'));
    return { id: issue.id, after: [], cleared: true };
  }
  need(raw !== undefined, 'after requires <ids> — the issues this one waits on (or --clear)');
  const ids = afterList(root, issue.id, raw);
  if (dry) return { id: issue.id, after: ids };
  logChanges(root, [fieldLine(issue.id, 'After', ids.join(', '), heldField(issue, 'After'), editor)]);
  writeAtomic(issue.file, setField(readText(issue.file), 'After', ids.join(', ')));
  return { id: issue.id, after: ids };
}

export function cmdList(root, flags) {
  const profile = loadProfile(root);
  let rows = loadIssues(root);
  // Finished business (terminal: done, dropped, and deferred work, which waits) is not in the default list:
  // --status or --all shows it.
  // An issue whose number another file carries is listed whatever its status: the log's state of it may be another's.
  if (!flags.all && !flags.status) rows = rows.filter((i) => profile.unfinished(i.status) || i.shared);
  if (flags.status) rows = rows.filter((i) => i.status === flags.status);
  if (flags.kind) rows = rows.filter((i) => i.kind === flags.kind);
  if (flags.tag) rows = rows.filter((i) => i.tags.includes(flags.tag));
  if (flags.prio) rows = rows.filter((i) => i.priority === String(flags.prio));
  // --match <field>=<value> (repeatable, all must hold): any header field — the tool's own, Kind, Tier or one the
  // profile declares — compared as written, without case in the name. An empty value matches an empty field.
  for (const w of [].concat(flags.match ?? [])) {
    const at = String(w).indexOf('=');
    need(at > 0, `--match takes <field>=<value> (got "${w}")`);
    const name = String(w).slice(0, at).trim().toLowerCase();
    const known = [...TOOL_FIELDS, 'Kind', 'Tier', ...profile.fields.map((f) => f.name)];
    need(known.some((k) => k.toLowerCase() === name), `--match names a header field — one of: ${known.join(', ')} (got "${name}")`);
    const value = fieldText(String(w).slice(at + 1));
    rows = rows.filter((i) => (name === 'status' ? i.status : fieldText(i.fields[name])) === value);
  }
  if (flags.grep) {
    const re = new RegExp(flags.grep, 'i');
    rows = rows.filter((i) => re.test(readText(i.file)));
  }
  return rows.sort((a, b) => a.priority.localeCompare(b.priority) || cmpId(a.id, b.id));
}

// Bulk ids: evidence, review, set, tag and prio take one id or several (see expandIds). Every id is resolved and every
// precondition checked before anything is written, so a call either lands on all of them or on none;
// each issue still gets its own log line.
function issuesFor(root, rawIds, readOnly = false) {
  const keys = expandIds(rawIds);
  const all = loadIssues(root);
  const missing = keys.filter((k) => !all.some((i) => idKey(i.id) === k));
  need(missing.length === 0, `no such issue: ${missing.join(', ')}${keys.length > 1 ? ' — nothing was written' : ''}`);
  const found = keys.map((k) => issueNamed(all, k));
  if (!readOnly && found.some((i) => needsRaisedFormat(i.id))) needFormat(root, 'plain-number');
  return found;
}
// One id in, the same object as always out; a list in, an array of them.
function oneOrMany(rawIds, results) { return isBulk(rawIds) ? results : results[0]; }

// A command that writes one issue at a time (files, repo, after, body, round, source) takes the list grammar too: `run(id,
// dry)` does one issue's work and writes nothing when `dry` is true. Every id is resolved and run dry before the first
// one is written, so a list lands on every id or on none; one id is run as it stands, with no pass before it.
export function eachIssue(root, rawIds, run) {
  if (!isBulk(rawIds)) return run(rawIds, false);
  const keys = expandIds(rawIds);
  const all = loadIssues(root);
  const missing = keys.filter((k) => !all.some((i) => idKey(i.id) === k));
  need(missing.length === 0, `no such issue: ${missing.join(', ')} — nothing was written`);
  const ids = keys.map((k) => issueNamed(all, k).id);
  for (const id of ids) {
    resetCaches();
    try { run(id, true); } catch (e) { throw new Error(/nothing was written/.test(e.message) ? e.message : `${e.message} — nothing was written`); }
  }
  return ids.map((id) => { resetCaches(); return run(id, false); });
}

// The refusal for a move into a needs-reason status given without one; the built-in two say what the status is for.
const REASON_TEXT = {
  dropped: 'dropped needs a reason: jarl.mjs set <id> dropped "<why>"',
  deferred: 'deferred needs a reason: jarl.mjs set <id> deferred "<why>" — work that waits, not work that is gone',
};
// The line a needs-reason status writes under Evidence: its name with a capital, then the reason (Dropped: …).
export function reasonWord(status) { return status.charAt(0).toUpperCase() + status.slice(1); }

// Who asked for the move: 'cli' — the command line and the MCP tools over it, which always say so — or 'record', a
// library call through record.mjs (the default). A status the profile marks "set-by": "record" refuses 'cli'.
export const SET_CALLERS = ['cli', 'record'];

// Where `set <ids> <name> …` goes, decided here and nowhere else: a field the profile declares (Kind and Tier too, when it
// declares them) and that is no status, the built-in Resources field, or a move into a status.
function setRoute(profile, name) {
  if (name === undefined || profile.statuses.includes(name)) return 'status';
  if (profile.field(name)) return 'field';
  return String(name).toLowerCase() === 'resources' ? 'resources' : 'status';
}
// What a name given to set is: 'status', or 'field' (a field the profile declares, or the built-in Resources).
export function setRouteOf(root, name) { return setRoute(loadProfile(root), name) === 'status' ? 'status' : 'field'; }

// field <ids> <name> "<value>" | field <ids> <name> --clear: one field written on every issue, the tool's own (Resources)
// or one the profile declares. A field is emptied with clear and never with an empty value.
export function cmdField(root, rawIds, name, value, flags = {}) {
  needNoOwnersWords('the field', value);
  const profile = loadProfile(root);
  const writable = () => [...DESCRIPTION_FIELDS, ...profile.fields.map((f) => f.name)].join(', ');
  need(name !== undefined && String(name).trim() !== '', `field requires <name> — a field of the description: ${writable()}`);
  editorOf(flags.by);
  const key = String(name).trim().toLowerCase();
  need(setRoute(profile, name) !== 'status' || DESCRIPTION_FIELDS.some((f) => f.toLowerCase() === key), `${name} is not a field of the description, which field writes: ${writable()}; ${notWrittenByField(profile, key)}`);
  const clear = flags.clear === true;
  need(!clear || value === undefined, 'field takes either a value or --clear, not both');
  need(clear || (value !== undefined && String(value).trim() !== ''), `field ${name} "<value>" — the value is required, or --clear to empty it`);
  if (profile.field(name)) return setDeclaredField(root, rawIds, profile.field(name), clear ? '' : value, flags);
  if (key === 'resources') return setResources(root, rawIds, clear ? '' : value, flags);
  const own = EMPTIED_BY_FIELD[key];
  if (own && clear) return emptyOwnField(root, rawIds, own, flags);
  const one = (results, field) => { const list = [].concat(results).map((o) => ({ id: o.id, field, value: fieldText(readFieldOf(root, o.id, field)) })); return isBulk(rawIds) ? list : list[0]; };
  switch (key) {
    case 'title': need(!clear, 'Title cannot be empty — body <ids> --title "<t>" replaces it'); return one(eachIssue(root, rawIds, (id, dry) => cmdBody(root, id, { title: value, by: flags.by }, dry)), 'Title');
    case 'where': return one(eachIssue(root, rawIds, (id, dry) => cmdBody(root, id, { where: value, by: flags.by }, dry)), 'Where');
    case 'files': return one(eachIssue(root, rawIds, (id, dry) => cmdFiles(root, id, value, dry, flags.by)), 'Files');
    case 'source': return one(eachIssue(root, rawIds, (id, dry) => cmdSource(root, id, value, dry, flags.by)), 'Source');
    case 'after': return one(eachIssue(root, rawIds, (id, dry) => cmdAfter(root, id, value, { dry, by: flags.by })), 'After');
    case 'repo': return one(eachIssue(root, rawIds, (id, dry) => cmdRepo(root, id, value, { dry, by: flags.by })), 'Repo');
    case 'tags': return one(cmdTagList(root, rawIds, value, flags.by), 'Tags');
    case 'person': return setKeptField(root, rawIds, 'Person', clear ? '' : value, flags);
    case 'check when': return setKeptField(root, rawIds, 'Check when', clear ? '' : value, flags);
    default: return setDeclaredField(root, rawIds, builtInField(profile, key), clear ? '' : value, flags);
  }
}
// A header field of the tool's own that every issue carries, as setDeclaredField writes it: Priority, Tier and Kind
// checked against their values (the profile's, for Tier and Kind), Found by a free name; none of them is ever empty.
function builtInField(profile, key) {
  if (key === 'priority') return { name: 'Priority', key, enum: PRIORITIES, builtin: true };
  if (key === 'tier') return { name: 'Tier', key, enum: profile.tiers, builtin: true };
  if (key === 'kind') return { name: 'Kind', key, enum: profile.kinds, builtin: true };
  return { name: 'Found by', key: 'found by', enum: null, builtin: true };
}
// What a field holds in the issue's file now, read again after a write.
function readFieldOf(root, id, field) {
  const issue = findIssue(root, id);
  return field === 'Title' ? issue.title : issue.fields[field.toLowerCase()];
}
// Why a name is not one field writes, and which command writes it instead: the status and the lease move with set, a
// merge is recorded by merged, a section is written by body, and the history has no edit.
function notWrittenByField(profile, key) {
  if (key === 'status' || profile.statuses.includes(key)) return 'a status is moved by set <ids> <status> "<why>"';
  if (['branch', 'worker', 'model', 'since', 'worktree'].includes(key)) return 'the lease (Branch, Worker, Model, Since) is written by set <ids> in-progress';
  if (['merged', 'merge check', 'ci'].includes(key)) return 'a merge and its CI are recorded by merged <ids> --sha <sha> | --ci <state>';
  if (key === 'evidence' || key === 'reviews') return 'the history is never edited: a row or an approve is taken back by retract, a ruling replaced by decide --supersedes';
  if (['what', 'why', 'acceptance', 'changelog', ...profile.sections.map((s) => s.toLowerCase())].includes(key)) return `a section is written by body <ids> --${['what', 'why', 'acceptance', 'changelog'].includes(key) ? key : 'section "<Heading>=<text>"'}`;
  return 'a section is written by body, a status by set, a merge by merged';
}
// The lease flags (--branch, --worker, --model, --worktree) a call gives. They belong to a move into a status that holds
// a claim; a call that writes a field refuses them.
const LEASE_FLAGS = ['branch', 'worker', 'model', 'worktree'];
function leaseFlagsGiven(flags) { return LEASE_FLAGS.filter((k) => flags[k] !== undefined); }
function needNoLeaseFlags(flags, what) {
  const lease = [...leaseFlagsGiven(flags), ...(flags.handover !== undefined ? ['handover'] : [])];
  need(!lease.length, `--${lease[0]} goes with a status, not with ${what}`);
}
// set with the name taken as a status (record.setStatus), or as a field the profile declares (record.setField): the
// refusal of a name that is the other kind, in the command line's own words.
export function cmdSetStatus(root, rawIds, status, why, flags = {}) {
  const profile = loadProfile(root);
  need(profile.statuses.includes(status) || !profile.field(status), `${status} is a field this loop's profile declares, not a status — setField writes it`);
  return cmdSet(root, rawIds, status, why, flags);
}
export function cmdSetField(root, rawIds, field, value, flags = {}) {
  const profile = loadProfile(root);
  need(profile.field(field) && !profile.statuses.includes(field), `${field} is not a field this loop's profile declares${profile.declaredFields.length ? ` — it declares ${profile.declaredFields.map((f) => f.name).join(', ')}` : ''}`);
  return cmdSet(root, rawIds, field, value, flags);
}

export function cmdSet(root, rawIds, status, why, flags = {}) {
  needNoOwnersWords('the move', why, flags);
  const caller = flags.caller ?? 'record';
  need(SET_CALLERS.includes(caller), `caller must be one of: ${SET_CALLERS.join(', ')} (got "${caller}")`);
  const profile = loadProfile(root);
  const route = setRoute(profile, status);
  if (route === 'field') return setDeclaredField(root, rawIds, profile.field(status), why, flags);
  if (route === 'resources') return setResources(root, rawIds, why, flags);
  if (flags.header) return rewriteHeader(root, rawIds, status, why, flags);
  // ready and the review words are views, not statuses: say which view answers the question the worker was asking.
  need(profile.statuses.includes(status) || !/^(ready|review|in[-_ ]?review|ready[-_ ]for[-_ ]review|reviewing)$/i.test(String(status ?? '')), `${status} is a view here, not a status: \`next\` lists the issues ready to start, and \`status\` and \`resume\` mark each in-flight issue with what the record says (no evidence rows yet; rows and no verdict, so it waits for a reviewer; changes requested; approved and queued). Nothing needs setting: record the rows with \`evidence\`, and the reviewer's verdict with \`review\`. A loop that wants an explicit review status can declare one in its profile. Statuses here: ${profile.statuses.join(', ')}`);
  need(profile.statuses.includes(status), `status must be one of: ${profile.statuses.join(', ')}`);
  need(caller !== 'cli' || profile.setBy(status) !== 'record', `${status} is set by the record only — this loop's profile (${profile.name}) marks it "set-by": "record", so jarl set and the MCP tools cannot move an issue into it; the tool that runs the loop does${profile.scheduler ? ` (${profile.scheduler})` : ''}`);
  const holds = profile.is(status, 'holds-claim');
  const lease = leaseFlagsGiven(flags);
  need(!lease.length || holds, `--${lease[0]} goes with ${profile.with('holds-claim').join(' or ')} only — it records who works on the issue and where`);
  need(flags.handover === undefined || typeof flags.handover === 'boolean', '--handover takes no value: the reason it is logged with is the move\'s own "<why>"');
  const handover = flags.handover === true;
  need(!handover || holds, `--handover goes with ${profile.with('holds-claim').join(' or ')} only — it hands a lease to a new worker or branch`);
  for (const k of lease) need(typeof flags[k] === 'string' && fieldText(flags[k]), `--${k} needs a value`);
  const model = flags.model !== undefined ? modelValue(flags.model) : undefined;
  // A name is one value: with the log's own separator in it, the lease line would carry a field the caller did not give.
  for (const k of ['worker', 'branch']) need(flags[k] === undefined || !` ${fieldText(flags[k])} `.includes(' · '), `--${k} is one name — not a phrase with " · " in it (got "${fieldText(flags[k])}")`);
  // What is written into the lease is what the journal gives back unchanged: a value the reader would take for something else is refused.
  for (const k of lease) { const problem = leaseValueProblem(k, flags[k]); need(!problem, `--${k} ${JSON.stringify(fieldText(flags[k]))} ${problem}`); }
  const issues = issuesFor(root, rawIds);
  need(!profile.is(status, 'needs-reason') || why, REASON_TEXT[status] || `${status} needs a reason: jarl.mjs set <id> ${status} "<why>"`);
  const nothing = issues.length > 1 ? ' — nothing was written' : '';
  if (holds) needLeaseHolds(root, profile, issues, status, why, flags, handover, nothing);
  // base: the branch the composer landed the merge into, for the done gate's requires-merged (else the branch checked
  // out). A library call only: the command line has no --base, and dispatch never passes one through.
  need(flags.base === undefined || caller === 'record', 'base is named by a library call through record.mjs only — the command line checks against the branch checked out');
  need(flags.base === undefined || (typeof flags.base === 'string' && fieldText(flags.base) !== '' && !flags.base.startsWith('-')), 'base names a branch or ref — the one the merge landed in');
  if (profile.is(status, 'closes-record')) {
    for (const issue of issues) { const refusal = unattributedRefusal(issue, `moved → ${status}`); need(!refusal, `${refusal}${nothing}`); }
    const loop = readLoop(jarlDir(root));
    for (const issue of issues) { const refusal = doneRefusalIn(root, loop, issue, flags.base); need(!refusal, `${refusal}${nothing}`); }
  }
  // One lease for the whole call: every issue in a package gets the same Branch, Worker and Since. A lease records no
  // worktree: git allows a branch in at most one worktree, so the worktree of a lease is found through its branch. On the
  // command line and in the tools --worktree is a check (a relative path is read from the loop's root, like --repo): a
  // path that exists must be a worktree of a repository of the issue with the lease's branch checked out. The record
  // library accepts the key and stores nothing.
  const since = stamp();
  if (holds && flags.worktree !== undefined && caller === 'cli') for (const issue of issues) needWorktreeOfLease(root, issue, flags.branch !== undefined ? fieldText(flags.branch) : fieldText(issue.fields.branch), resolve(root, fieldText(flags.worktree)));
  const writes = issues.map((issue) => {
    let text = readText(issue.file);
    text = setField(text, 'Status', status);
    if (holds) {
      if (flags.branch !== undefined) text = setField(text, 'Branch', fieldText(flags.branch));
      if (flags.worker !== undefined) text = setField(text, 'Worker', fieldText(flags.worker));
      // The model belongs to the worker it was raised for: a new worker named without one does not inherit the last one's.
      if (model !== undefined) text = setField(text, 'Model', model);
      else if (flags.worker !== undefined) text = removeFields(text, ['Model']);
      // A Worktree field belongs to the lease that wrote it: once the issue is handed over, its worktree is the old one.
      if (handover) text = removeFields(text, ['Worktree']);
      text = setField(text, 'Since', since);
    } else {
      text = removeFields(text, LEASE_FIELDS);
    }
    // What was already written under Evidence stays: a drop or a deferral is one more line in the history,
    // not a reset of it.
    if (profile.is(status, 'needs-reason')) {
      const written = (issue.sections.evidence || '').trim();
      const line = `${reasonWord(status)}: ${noteText(why, written)}`;
      text = setSection(text, 'Evidence', placeEvidence(written, 'note', line, '\n\n'));
    }
    return { issue, text };
  });
  // The model goes before the worker: the worker is read as the text after "· worker " up to the end of the line (or up to
  // "· worktree " in a line that carries one), so a model written after it would become part of the worker's name.
  const leaseNote = [flags.branch !== undefined && `branch ${fieldText(flags.branch)}`, model !== undefined && `model ${model}`, flags.worker !== undefined && `worker ${fieldText(flags.worker)}`].filter(Boolean).join(' · ');
  // The reason is free text in front of the lease's fields: on a lease its own " · " is neutralised, so no reason can be
  // read as a branch, a model or a worker.
  // A reason that opens with the name of a lease field is closed by a segment "(reason)", so no reader takes it for the field.
  // Every separator character of a lease's reason is replaced, with the space around it, so no run of separators and
  // spaces can leave a separator in it and the reason is one segment of the line.
  // A handover is the segment "handover" right after the reason, which a handover always has: a reason alone is one
  // segment, so a reason that says "handover" is never read as one. A reader that does not know the segment reads it as
  // part of the reason and the lease fields after it as they are.
  const neutral = holds && why ? noSeparators(why) : why;
  const marked = handover ? `${neutral} · ${HANDOVER_SEGMENT}` : neutral;
  const reason = holds && neutral && /^(branch|model|worker|worktree) /.test(neutral) ? `${marked} · (reason)` : marked;
  // A model spelled another way than the record holds it is noted on the command line. The loop is read before this call
  // writes its own line, so that line is not among the spellings the record holds.
  const spelling = caller === 'cli' && model !== undefined ? spellingNote(readLoop(jarlDir(root)), model) : null;
  // The line goes first: a write that stops between the two leaves the journal, the record, ahead of the files, which the
  // views report, and never a file ahead of the record.
  appendLogLines(root, issues.map((issue) => `${issue.id} → ${status}${reason ? ` · ${reason}` : ''}${leaseNote ? ` · ${leaseNote}` : ''}`), since);
  for (const w of writes) writeAtomic(w.issue.file, w.text);
  // Said on the command line only, and only in a loop that declares model lines: a lease with no model (once per call).
  const leaseNoModel = caller === 'cli' && holds && model === undefined && modelLines(root).declared ? 'no --model on this lease — the loop declares its models, and a model that is not recorded can never be recovered' : null;
  const worktreeNote = caller === 'cli' && holds && flags.worktree !== undefined ? '--worktree was checked and is not recorded — the worktree of a lease is found through its branch' : null;
  const leaseNotes = [leaseNoModel, worktreeNote, spelling].filter(Boolean).join('; ');
  return oneOrMany(rawIds, issues.map((issue, n) => ({ id: issue.id, status, ...(handover ? { handover: true } : {}), ...(holds ? { since, ...(flags.branch !== undefined ? { branch: fieldText(flags.branch) } : {}), ...(flags.worker !== undefined ? { worker: fieldText(flags.worker) } : {}), ...(model !== undefined ? { model } : {}) } : {}), ...(profile.is(status, 'closes-record') ? doneNote(issue, root) : {}), ...(leaseNotes && n === 0 ? { note: leaseNotes } : {}) })));
}

// A lease holds. Called under the write lock with the issues just read from the record, before anything is written:
// - an issue a lease holds (a status that holds the claim, with a worker or a branch) is refused a lease that names
//   another worker or branch, unless the call hands it over (--handover, with the move's reason as why); a handover
//   needs a lease to replace and a holder that changes;
// - an issue that takes a lease (a new one, or a handover) is refused a file or a resource that another issue's lease
//   holds, unless it joins that lease: the same branch, and the same worker when both name one. Issues leased in one
//   call share one lease.
// A move that names no new holder, or restates the one the issue has, takes nothing new and is never refused here.
// A loop whose profile names an external scheduler is leased by its composer, which decides who holds what (several
// issues it runs at once may share a file there), so neither refusal runs in it; a handover there is still checked
// and logged.
function needLeaseHolds(root, profile, issues, status, why, flags, handover, nothing) {
  const composed = profile.scheduler !== null && profile.scheduler !== undefined;
  const named = (k) => (flags[k] !== undefined ? fieldText(flags[k]) : null);
  const leaseFlags = ['branch', 'model', 'worker'].filter((k) => named(k) !== null).map((k) => `--${k} ${named(k)}`).join(' ');
  const taken = new Set(issues.map((i) => i.id));
  const leased = (i) => profile.is(i.status, 'holds-claim') && Boolean(i.fields.worker || i.fields.branch);
  // Another holder named by the call: a worker or a branch other than the one the lease already names.
  const replaces = (i) => ['worker', 'branch'].some((k) => named(k) !== null && i.fields[k] && named(k) !== fieldText(i.fields[k]));
  if (handover) need(why, `--handover says why the work changes hands: set ${issues.map((i) => i.id).join(',')} ${status} "<why the worker changed>" ${leaseFlags} --handover`.replace(/ {2,}/g, ' '));
  for (const issue of issues) {
    if (handover) {
      need(leased(issue), `${issue.id} holds no lease to hand over — lease it without --handover: set ${issue.id} ${status} "<why>" ${leaseFlags}${nothing}`.replace(/ {2,}/g, ' '));
      need(replaces(issue), `--handover names the lease ${issue.id} already has (${holderText(issue)}) — a handover names the new --worker or --branch${nothing}`);
    } else if (!composed) {
      need(!(leased(issue) && replaces(issue)), `${issue.id} is leased already (${holderText(issue)}) — a second lease would replace it in silence, and ${fieldText(issue.fields.worker) || 'its worker'} would go on working on a branch the record does not name; when the work changes hands, say why: jarl.mjs set ${issue.id} ${status} "<why the worker changed>" ${leaseFlags} --handover${nothing}`.replace(/ {2,}/g, ' '));
    }
  }
  if (composed) return;
  // What the other leases hold: each file key and each resource, with the issue whose lease holds it.
  const others = loadIssues(root).filter((i) => !taken.has(i.id) && profile.is(i.status, 'holds-claim'));
  // The first holder of each, in the order of the record, so a refusal names the same issue every time.
  const files = new Map();
  const resources = new Map();
  for (const i of others) {
    for (const k of fileKeysOf(root, i)) if (!files.has(k.key)) files.set(k.key, i);
    for (const r of i.resources) if (!resources.has(r.toLowerCase())) resources.set(r.toLowerCase(), i);
  }
  for (const issue of issues) {
    if (leased(issue) && !handover) continue;
    const branch = named('branch') ?? fieldText(issue.fields.branch);
    const worker = named('worker') ?? fieldText(issue.fields.worker);
    const joins = (h) => (branch && h.fields.branch ? branch === fieldText(h.fields.branch) && (!worker || !h.fields.worker || worker === fieldText(h.fields.worker)) : !branch && !h.fields.branch && Boolean(worker) && worker === fieldText(h.fields.worker));
    const held = [
      ...fileKeysOf(root, issue).filter((k) => files.has(k.key)).map((k) => ({ what: `declares ${k.f}`, by: files.get(k.key) })),
      ...issue.resources.filter((r) => resources.has(r.toLowerCase())).map((r) => ({ what: `uses the resource ${r}`, by: resources.get(r.toLowerCase()) })),
    ].filter((h) => !joins(h.by));
    if (!held.length) continue;
    const { what, by } = held[0];
    const join = by.fields.branch ? `, or put ${issue.id} in ${by.id}'s lease: set ${issue.id} ${status} "<why>" --branch ${fieldText(by.fields.branch)}${by.fields.worker ? ` --worker ${fieldText(by.fields.worker)}` : ''}` : '';
    need(false, `${issue.id} ${what}, which ${by.id} holds in its lease (${holderText(by)}) — two leases on one file or resource collide; wait until ${by.id} leaves its lease (next offers ${issue.id} then)${join}${nothing}`);
  }
}
// Who holds an issue's lease, as the refusals name it: its worker, branch and start, and its slice tag when it has one.
function holderText(issue) {
  const slice = issue.tags.find((t) => t.startsWith('slice:'));
  return [issue.fields.worker && `worker ${fieldText(issue.fields.worker)}`, issue.fields.branch && `branch ${fieldText(issue.fields.branch)}`, issue.fields.since && `since ${fieldText(issue.fields.since)}`, slice].filter(Boolean).join(', ') || 'no worker or branch named';
}

// The check behind set --worktree: a path that exists is a worktree of one of the repositories the issue names (or the
// loop's own) with `branch` checked out; a path that does not exist is not checked.
function needWorktreeOfLease(root, issue, branch, path) {
  if (!existsSync(path)) return;
  const repos = issueRepoPaths(root, issue).filter(isGitRepo);
  const listed = repos.flatMap((r) => (worktreesOf(r) || []).filter((w) => sameDir(w.path, path)));
  need(listed.length > 0, `--worktree ${path} is not a worktree of ${repos.length ? repos.map((r) => repoLabel(r)).join(' or ') : 'a repository of ' + issue.id} — a lease is its branch, and the worktree is found through it`);
  need(!branch || listed.some((w) => w.branch === branch), `--worktree ${path} has ${listed[0].branch ?? 'no branch'} checked out, not ${branch}, the branch of the lease`);
}

// Why a lease value (--branch, --worker, --model, --worktree) cannot be written, or null when the lease line gives it
// back unchanged: one line in all four; no comma in a worker or a model (a comma marks a sentence, not a name); and a
// branch is a name git accepts, which has no space.
function leaseValueProblem(flag, raw) {
  const v = fieldText(raw);
  if (/[\r\n]/.test(String(raw).trim())) return 'is on more than one line: the lease line is one line';
  if (flag === 'worker' || flag === 'model') return v.includes(',') ? 'holds a comma: the lease line is read by position and a comma marks a sentence, not a name — use a name without one' : null;
  if (flag === 'branch') return branchNameProblem(v);
  return null;
}

// set <ids> <status> --header: writes the header fields the log renders (Status, Branch, Worker, Model, Since, Merged, CI)
// of each issue from the log, and writes no log line; the status named is the one the log holds, so it is never a move.
function rewriteHeader(root, rawIds, status, why, flags) {
  need(status !== undefined, 'set <ids> <status-in-the-log> --header: name the status the log holds for the issue (status shows it); --header rewrites the header from the log and moves nothing');
  need(loadProfile(root).statuses.includes(status), `${status} is not a status this loop's profile lists (${loadProfile(root).statuses.join(', ')}): --header rewrites a header from the log and moves nothing, so it names the status the log holds`);
  need(why === undefined && flags.base === undefined && !leaseFlagsGiven(flags).length && flags.handover === undefined, '--header rewrites the header from the log and takes no reason, lease flag, --handover or base');
  const issues = issuesFor(root, rawIds);
  for (const issue of issues) {
    need(!issue.byHeader, `${issue.id} is read from its header: the log files ${issue.id} ${issue.byHeader?.filings} times and cannot say which file its lines were written for, so no header is written from it`);
    need(issue.onFile !== null, `${issue.id} is not in the log, so there is nothing to write its header from — jarl.mjs set ${issue.id} ${status} puts it there`);
    need(issue.status === status, `${issue.id} is ${issue.status} in the log: jarl.mjs set ${issue.id} ${issue.status} --header writes its header from it, and set ${issue.id} ${status} without --header moves it`);
  }
  for (const issue of issues) {
    let text = setField(readText(issue.file), 'Status', issue.status);
    for (const key of RENDERED_FIELDS) {
      const name = FIELD_NAMES[key];
      text = issue.fields[key] ? setField(text, name, issue.fields[key]) : removeFields(text, [name]);
    }
    writeAtomic(issue.file, text);
  }
  return oneOrMany(rawIds, issues.map((issue) => ({ id: issue.id, status: issue.status, header: true })));
}

// The optional header fields of the tool's own that field --clear empties.
const EMPTIED_BY_FIELD = { files: 'Files', source: 'Source', where: 'Where', tags: 'Tags', after: 'After', repo: 'Repo' };
// field <ids> <field> <value>: one declared field (or Priority, Tier, Kind, Found by) written on every issue in the call,
// checked against its enum first, with one log line each. An empty value clears it, unless the field is required or built in.
function setDeclaredField(root, rawIds, field, value, flags) {
  needNoLeaseFlags(flags, `the field ${field.name}`);
  need(value !== undefined, `field <ids> ${field.name} "<value>" — the value is required${field.enum ? ` (one of: ${field.enum.join(', ')})` : ''}`);
  const by = editorOf(flags.by);
  const profile = loadProfile(root);
  const v = fieldValue(profile, field, value);
  need(v || (!field.required && !field.builtin), `${field.name} cannot be empty${field.enum ? ` — one of: ${field.enum.join(', ')}` : ''}`);
  const issues = issuesFor(root, rawIds);
  if (field.key === 'kind' && v === WAIT_KIND) {
    for (const issue of issues) need(fieldText(issue.fields.person) && fieldText(issue.fields['check when']), `${issue.id} becomes a wait only with the outside person it is held by and when to check it — first jarl.mjs field ${issue.id} Person "<name>" and jarl.mjs field ${issue.id} "Check when" "<a date, or the event to check after>"`);
  }
  if (field.key === 'kind' && KEPT_KINDS.includes(v) && issues.some((issue) => issue.kind !== v)) needFormat(root, 'promise-wait');
  logChanges(root, issues.map((issue) => fieldLine(issue.id, field.name, v, heldField(issue, field.name), by)));
  for (const issue of issues) writeAtomic(issue.file, setField(readText(issue.file), field.name, v));
  return oneOrMany(rawIds, issues.map((issue) => ({ id: issue.id, field: field.name, value: v })));
}

// field <ids> Person "<name>" | "Check when" "<when>": what a wait is held by and when to check it. Written on any issue,
// so an issue can become a wait (its Kind is written last); never emptied on a wait, which they hold.
function setKeptField(root, rawIds, name, value, flags) {
  needNoLeaseFlags(flags, `the field ${name}`);
  const by = editorOf(flags.by);
  const v = value === '' ? '' : keptValue(name, value);
  const issues = issuesFor(root, rawIds);
  for (const issue of issues) need(v || issue.kind !== WAIT_KIND, `${issue.id} is a wait, held by its Person and checked when its Check when says: ${name} is never empty on it — give it another kind first (jarl.mjs field ${issue.id} Kind <kind>)`);
  if (v) needFormat(root, 'promise-wait');
  logChanges(root, issues.map((issue) => fieldLine(issue.id, name, v, heldField(issue, name), by)));
  for (const issue of issues) writeAtomic(issue.file, v ? setField(readText(issue.file), name, v) : removeFields(readText(issue.file), [name]));
  return oneOrMany(rawIds, issues.map((issue) => ({ id: issue.id, field: name, value: v })));
}

// field <ids> <Files|Source|Where|Tags|After|Repo> --clear: the field is emptied (After and Repo as their own commands empty them).
function emptyOwnField(root, rawIds, name, flags) {
  const key = name.toLowerCase();
  if (key === 'after' || key === 'repo') {
    const done = [].concat(eachIssue(root, rawIds, (id, dry) => (key === 'after' ? cmdAfter(root, id, undefined, { clear: true, dry, by: flags.by }) : cmdRepo(root, id, undefined, { clear: true, dry, by: flags.by })))).map((o) => ({ id: o.id, field: name, value: '' }));
    return isBulk(rawIds) ? done : done[0];
  }
  const by = editorOf(flags.by);
  const issues = issuesFor(root, rawIds);
  logChanges(root, issues.map((issue) => fieldLine(issue.id, name, '', heldField(issue, name), by)));
  for (const issue of issues) writeAtomic(issue.file, key === 'source' ? removeFirstField(readText(issue.file), name) : setField(readText(issue.file), name, ''));
  return oneOrMany(rawIds, issues.map((issue) => ({ id: issue.id, field: name, value: '' })));
}

// field <ids> resources "a, b": the exclusive resources an issue holds for the whole life of its lease (a port, a database
// server, the machine's load), loop-wide and not files. Names are single words; an empty value clears the field. Only next
// reads it: check, queue and the file rules do not.
function setResources(root, rawIds, value, flags) {
  needNoLeaseFlags(flags, 'the field Resources');
  need(value !== undefined, 'field <ids> resources "<name>[, <name>...]" — the value is required (--clear empties the field)');
  const names = [];
  for (const n of splitList(fieldText(value))) {
    need(/^[A-Za-z0-9._:/-]+$/.test(n), `resource names are single words of letters, digits and . _ : / - ("${n}" is not): name the thing, e.g. gate, db-server, port-8080`);
    if (!names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
  }
  const by = editorOf(flags.by);
  const issues = issuesFor(root, rawIds);
  logChanges(root, issues.map((issue) => fieldLine(issue.id, 'Resources', names.join(', '), heldField(issue, 'Resources'), by)));
  for (const issue of issues) writeAtomic(issue.file, setField(readText(issue.file), 'Resources', names.join(', ')));
  return oneOrMany(rawIds, issues.map((issue) => ({ id: issue.id, field: 'Resources', value: names.join(', ') })));
}

// Why an issue may not go done, or null when it may: at least one --ran/--saw evidence row inside the gate's window
// (see gateWindow; free-text notes never count alone), and a live approve by someone
// other than its worker (see gateState) — by a fresh reviewer when the issue carries code (a Branch or Merged field;
// see carriesCode). It gates only the record: nothing here stops code from landing.
// A profile's done-gate changes the last two: requires-merged also asks for a recorded merge whose sha is in the base
// (see mergeRefusal), and approve: none (allowed only with requires-merged) drops the approve — the gate that landed
// the merge stands behind the issue instead of a reviewer. The evidence rows are asked for either way.
// doneRefusal reads the loop for one issue; a caller checking several issues reads it once and asks doneRefusalIn.
export function doneRefusal(root, issue) { return doneRefusalIn(root, readLoop(jarlDir(root)), issue, undefined); }
// `base`: the branch or ref the merge landed in, when the caller names one.
function doneRefusalIn(root, loop, issue, base) {
  const { profile } = loop;
  const g = gateOf(loop, issue.id);
  const how = EVIDENCE_HOW(issue.id);
  // A merge that records its check does not stand in for the worker's row: said to whoever is refused, the merger included.
  const mergeLine = lastMerge(loop.eventsById.get(issue.id) || []);
  const gap = mergeLine && mergeLine.check ? ` — the merge records a check (${mergeLine.check}), but that check is the merger's and does not stand in for the worker's row: the row is the worker's proof of the work, so the worker records what the work's own check ran and printed, and nobody types the merge check into Proof in its place` : '';
  if (g.unresolvedRetractions.length) return `${issue.id} records a retraction of evidence row ${g.unresolvedRetractions.join(', ')} that matches no evidence line of the log, so which row it retracts is unknown and a retracted row might be counted — done refuses until that log line is repaired`;
  if (!workEvidence(issue, profile)) return `${issue.id} has no evidence yet — record it first: ${how}${gap}`;
  if (!g.tracked && !evidenceRows(issue).length) return `${issue.id} has no --ran/--saw evidence row — a free-text note alone is not proof of the work: ${how}${gap}`;
  if (g.tracked && !g.rowsSince) return `${issue.id} has no --ran/--saw evidence row recorded since it was ${g.anchor.what === 'filed' ? 'filed' : `moved → ${g.anchor.what}`} (${g.anchor.at}) — a free-text note, or a row written before that (before a start or a reopen), is not proof of the work: ${how}${gap}`;
  const slots = slotRefusal(root, profile, issue, g);
  if (slots) return slots;
  if (profile.doneGate['requires-merged']) { const m = mergeRefusal(root, issue, base); if (m) return m; }
  if (profile.doneGate.approve === 'none') return null;
  const code = carriesCode(issue);
  if (g.selfApproved) return `${issue.id}'s live approve is by a worker of this issue or its branch — a self-approve does not count as review: jarl.mjs review ${issue.id} approve --by <${code ? 'fresh reviewer' : 'fresh reviewer|jarl'}> "<findings>"`;
  // A changes verdict with no approve after it is named as the cause, with its reviewer and day, so whoever is refused
  // sees the review that stands in the way.
  if (!g.approved && g.lastReview === 'changes') {
    const changes = [...g.trail].reverse().find((r) => r.verdict === 'changes');
    return `${issue.id}'s latest review is a changes verdict by ${changes.by || 'a reviewer not recorded'} of ${changes.at}, and no approve came after it — a fresh reviewer reads the issue and the diff first: jarl.mjs review ${issue.id} approve|changes --by <reviewer> "<findings>"`;
  }
  if (!g.approved) return `${issue.id} has no approving review newer than its last round${g.tracked ? ' or reopen' : ''} — a fresh reviewer reads the issue and the diff first: jarl.mjs review ${issue.id} approve|changes --by <reviewer> "<findings>"`;
  if (code && !g.fresh) return `${issue.id} ${freshRuleText(issue, g.live)}: jarl.mjs review ${issue.id} approve|changes --by <fresh reviewer> "<findings>"`;
  return null;
}

// The done gate's requires-merged: the issue records a merge (merged --sha) and that commit is in the base — the branch
// checked out where the merge was recorded (Merged's "in <repo>", else the issue's Repo, else the loop's own
// repository), or the branch a library caller names as opts.base (a composer that lands into a branch nobody has
// checked out, such as a team branch, names it). A sha the repository does not know, or one not reachable from the
// base, is refused: a merge recorded is not a merge landed until the base holds it.
function mergeRefusal(root, issue, base) {
  const m = mergedOf(issue);
  const gate = 'this loop\'s profile closes an issue only on a landed merge (done-gate "requires-merged": true)';
  if (!m) return `${issue.id} records no merge — ${gate}: jarl.mjs merged ${issue.id} --sha <sha> once it has landed`;
  const repos = issueRepoPaths(root, issue, m.repo ? [m.repo] : undefined).filter(isGitRepo);
  if (!repos.length) return `${issue.id} records Merged ${m.sha}, but no repository it names is a git repository here — ${gate}, and the merge cannot be checked`;
  const ref = base === undefined ? 'HEAD' : base;
  if (base !== undefined && repos.every((r) => git(r, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]) === null)) return `${issue.id}: the base ${base} is not a branch or commit in ${repos.join(' or ')} — ${gate}, and the merge cannot be checked`;
  const landed = repos.some((r) => git(r, ['merge-base', '--is-ancestor', m.sha, ref]) !== null);
  if (landed) return null;
  const where = repos.map((r) => `${base === undefined ? defaultBase(r) : base} in ${r}`).join(' or ');
  return `${issue.id} records Merged ${m.sha}, which is not in the base (${where}) — ${gate}; merge it, or record the sha that landed: jarl.mjs merged ${issue.id} --sha <sha>`;
}

// The fresh-review rule, said the same way by done, review and merged: an issue that carries code (a Branch or a
// Merged field) needs its live approve from a fresh reviewer — an agent that neither wrote the code nor runs the loop.
function freshRuleText(issue, live) {
  const who = live && live.by ? `${live.by} (${live.kind})` : 'a reviewer not recorded (an approve from before --by)';
  return `carries code (${issue.fields.merged ? 'Merged' : 'Branch'} is recorded) and its live approve is by ${who} — the fresh-review rule: a code issue needs an approve from a fresh reviewer, an agent that neither wrote the code nor runs the loop; a coordinator's approve does not clear it`;
}

// Said, never refused: done closes an issue whose acceptance is missing, or has more lines than the
// --ran/--saw rows recorded, or that was merged while its CI is not green yet, but the output says so, so
// the gap is seen by whoever closed it.
function doneNote(issue, root) {
  const notes = [];
  const lines = acceptanceLineCount(issue);
  if (!lines) notes.push('no acceptance line on file');
  else {
    const rows = evidenceRows(issue).length;
    if (rows < lines) notes.push(`${lines} acceptance line(s), ${rows} --ran/--saw row(s)`);
  }
  const m = mergedOf(issue);
  // A merge that carries its check (a passing check, or the red it landed on) needs no CI state to be told apart from an unrecorded one.
  const decided = () => { const line = issue.byHeader ? null : lastMerge(journalById(root).get(issue.id) || []); return Boolean(line && (line.check || line.red)); };
  if (m && m.ci !== 'green' && m.ci !== 'none' && !(m.ci === null && decided())) notes.push(`merged ${m.sha}, CI ${m.ci || 'not recorded'} — record it when known: jarl.mjs merged ${issue.id} --ci green|red`);
  return notes.length ? { note: notes.join('; ') } : {};
}

// The Proof rows an issue holds inside the done gate's window: the --ran/--saw rows the worker wrote, not retracted.
function proofSince(g, issue) { return g.tracked ? g.rowsSince : evidenceRows(issue).length; }
const EVIDENCE_HOW = (id) => `jarl.mjs evidence ${id} --ran "<command>" --saw "<what it printed>"`;

// What a merge refused for want of its --sha says next: the head of the branch the issue's lease records, as the ready
// command that records it, or, where no branch is recorded or it has no single head here, that the sha has to be given.
function noMergeHow(root, issue, ci) {
  const branch = fieldText(issue.fields.branch);
  const tip = branchTip(root, issue);
  if (tip && !tip.includes(',')) return `the head of ${branch}, the branch its lease records, is ${tip}; once it has landed, record it: jarl.mjs merged ${issue.id} --sha ${tip} --ci ${ci}`;
  if (!branch) return `its lease records no branch, so no head is offered; once it has landed, give its sha: jarl.mjs merged ${issue.id} --sha <sha> --ci ${ci}`;
  return `${branch} has no single head in the repositories here, so no head is offered; once it has landed, give its sha: jarl.mjs merged ${issue.id} --sha <sha> --ci ${ci}`;
}

// merged <ids> --sha <sha> [--ran "<check>" --saw "<summary>" | --red <id>] [--ci pending|green|red|none] [--repo <path>]
// — the merge as a field, not as prose: the sha, where it landed, the check that decided it and the CI state. --ran and
// --saw record the check and what it printed in the merge record (the merge line and the Merge check field) of every issue
// of the call; they write no Proof row, because the merger's check is not the worker's proof; --red <id> records
// a merge that landed while its check was red for a cause outside the branch, which issue <id> tracks, and is never counted
// as a passing check. The CI state is recorded only when given, except for a library call, which keeps pending as the
// default. --ci alone, on issues that already record a merge, moves only the CI state. A sha the repository does not know
// is noted, never refused (the merge may be in a clone not fetched here). It records; it never decides whether anything
// may land.
export function cmdMerged(root, rawIds, flags) {
  needNoOwnersWords('the merge', flags);
  const cli = flags.caller === 'cli';
  need(flags.sha !== undefined || flags.ci !== undefined, 'merged needs --sha <sha> (and optionally --ci), or --ci alone on issues that already record a merge');
  if (flags.sha !== undefined) need(/^[0-9a-f]{4,64}$/i.test(String(flags.sha)), `--sha is a commit id, 4 to 64 hex characters (got "${flags.sha}")`);
  if (flags.ci !== undefined) need(CI_STATES.includes(flags.ci), `--ci must be one of: ${CI_STATES.join(', ')} — none means the repository has no CI to wait for`);
  need(flags.repo === undefined || flags.sha !== undefined, '--repo names where --sha landed; give it with --sha');
  const rows = flags.ran !== undefined || flags.saw !== undefined ? rowsOf(flags) : null;
  need(!rows || flags.sha !== undefined, '--ran and --saw record the check that decided the merge; give them with --sha');
  need(flags.red === undefined || flags.sha !== undefined, '--red names the issue that tracks why the merge landed on a red check; give it with --sha');
  need(!(rows && flags.red !== undefined), 'a merge landed on red carries no passing check: give --ran/--saw for a green check, or --red <id> for a red one, not both');
  const issues = issuesFor(root, rawIds);
  const nothing = issues.length > 1 ? ' — nothing was written' : '';
  for (const issue of issues) { const refusal = unattributedRefusal(issue, 'merged'); need(!refusal, `${refusal}${nothing}`); }
  let cause = null;
  if (flags.red !== undefined) {
    need(typeof flags.red === 'string' && fieldText(flags.red), '--red needs the id of the issue that tracks the cause');
    const tracked = findIssue(root, fieldText(flags.red));
    need(tracked, `--red names an issue that does not exist: ${flags.red}${nothing}`);
    need(!issues.some((i) => i.id === tracked.id), `--red names the issue that tracks the cause of a red check outside the branch; ${tracked.id} is the issue being merged${nothing}`);
    cause = tracked.id;
  }
  if (flags.sha === undefined) for (const issue of issues) need(mergedOf(issue), `${issue.id} records no merge yet — ${noMergeHow(root, issue, flags.ci)}${nothing}`);
  const pickedRepo = flags.repo !== undefined ? repoFromInput(root, String(flags.repo)) : null;
  const repoPath = pickedRepo ? pickedRepo.main : null;
  const repoIn = pickedRepo ? ` in ${noSeparators(pickedRepo.value)}` : '';
  if (flags.sha !== undefined) needRightCheckouts(root, pickedRepo ? [pickedRepo.name].filter(Boolean) : issues.flatMap((i) => splitList(i.fields.repo)));
  const sha = flags.sha !== undefined ? String(flags.sha).toLowerCase() : null;
  const ci = flags.ci ?? (sha && !cli ? 'pending' : undefined);
  // The check as the merge line names it: the commands that ran, one line, never the log's own separator.
  const oneLineOf = (key) => noSeparators(fieldText(rows.map((r) => r[key]).join(' ; '))).slice(0, 200).trim();
  const checkText = rows ? oneLineOf('ran') : null;
  const sawText = rows ? oneLineOf('saw') : null;
  const notes = pickedRepo && pickedRepo.note ? [pickedRepo.note] : [];
  if (sha) {
    // Where the sha should be: --repo, else each issue's Repo, else the loop's own repository.
    // An issue naming several repositories is noted only when the sha is in none of them.
    const checked = new Set();
    for (const issue of issues) {
      const repos = (repoPath ? [repoPath] : issueRepoPaths(root, issue)).filter(isGitRepo);
      const key = repos.join('\n');
      if (!repos.length || checked.has(key)) continue;
      checked.add(key);
      if (repos.every((r) => git(r, ['cat-file', '-e', `${sha}^{commit}`]) === null)) notes.push(`${sha} is not a commit in ${repos.join(' or ')} (yet) — recorded as given`);
    }
  }
  // Said, never refused: the check of a merge runs on the merge result, so a commit that lacks the branch tip, or lacks
  // the base as it stands before the merge landed there, was not the tree the check ran on.
  if (sha) for (const issue of issues) notes.push(...mergeContentNotes(root, issue, sha, repoPath));
  // Said, never refused: a merge is a fact, and recording it is not the place to stop it. A merge whose issue holds
  // no fresh approve went in without the fresh review the rule asks for, and the note says so loudly.
  // Under a done gate with no approve (approve: none), the merge gate stands behind the issue, and no reviewer is owed.
  if (sha && cli) {
    const loop = readLoop(jarlDir(root));
    for (const issue of issues) {
      const g = gateOf(loop, issue.id);
      if (proofSince(g, issue) === 0) notes.push(`NO PROOF FROM THE WORKER — ${issue.id} holds no Proof row since it was ${g.tracked ? (g.anchor.what === 'filed' ? 'filed' : `moved → ${g.anchor.what}`) : 'filed'}; ${checkText ? 'the merge check is recorded in the merge record and is not proof' : 'the merge records no check, and a merge is not proof'}, so done refuses until the worker records it:${EVIDENCE_HOW(issue.id)}`);
    }
  }
  if (sha && loadProfile(root).doneGate.approve !== 'none') {
    const loop = readLoop(jarlDir(root));
    for (const issue of issues) {
      const g = gateOf(loop, issue.id);
      if (!g.fresh) notes.push(`MERGED WITHOUT A FRESH REVIEW — ${issue.id} ${g.live ? freshRuleText({ fields: { merged: sha } }, g.live) : 'holds no live approve at all (none, or spent by a later round, restart or reopen) — the fresh-review rule: a code issue needs an approve from a fresh reviewer before it merges'}; recorded as given, get the fresh review now: jarl.mjs review ${issue.id} approve|changes --by <fresh reviewer> "<findings>"`);
      notes.push(...approveTipNotes(root, issue, g.live, sha));
    }
  }
  // The check goes into the merge record (the merge line and the Merge check field) and never into Proof: the merger's
  // check is not the worker's proof, so only evidence writes a row.
  const named = `${repoIn}${checkText ? ` · check ${checkText}${sawText ? ` · saw ${sawText}` : ''}` : ''}${cause ? ` · landed red, cause ${cause}` : ''}${ci ? ` · CI ${ci}` : ''}`;
  // The line goes first, as in set: a write that stops between the two leaves the record ahead of the files.
  if (pickedRepo) commitRepoNames(root, [pickedRepo]);
  // A merge line is followed by the tip of the branch that was merged: the cleanup may delete the branch, and the gate
  // then reads the tip from here.
  appendLogLines(root, issues.flatMap((issue) => (sha ? [`${issue.id} merged ${sha}${named}`, ...tipLines(root, issue)] : [`${issue.id} CI ${ci}`])));
  for (const issue of issues) {
    let text = readText(issue.file);
    if (sha) {
      text = setField(text, 'Merged', `${sha}${repoIn}`);
      const kept = mergeCheckText(checkText, sawText);
      text = kept ? setField(text, 'Merge check', kept) : removeFields(text, ['Merge check']);
    }
    text = ci ? setField(text, 'CI', ci) : removeFields(text, ['CI']);
    writeAtomic(issue.file, text);
  }
  // The cleanup comes last, after the merge is on the record, and only on the command line and in the tools.
  const cleanup = sha && cli && flags.keep !== true ? cleanUpAfterMerge(root, issues, sha, repoPath, pickedRepo && pickedRepo.name ? [pickedRepo.name] : []) : [];
  return { ids: issues.map((i) => i.id), sha: sha || null, ci: ci ?? null, ...(checkText ? { check: checkText } : {}), ...(cause ? { red: cause } : {}), ...(cleanup.length ? { cleanup } : {}), notes };
}

// What a recorded merge commit holds of the branch and of its base, as notes (empty when it holds both, or when the
// branch, the base or the commit is not here to be read). The branch tip is the branch as it stands now; the base is the
// main checkout's branch as it stands now, asked for only while the commit is not yet in it: once the base holds the
// commit, later commits on the base are no part of the merge.
function mergeContentNotes(root, issue, sha, repoPath) {
  const branch = fieldText(issue.fields.branch);
  const repo = (repoPath ? [repoPath] : issueRepoPaths(root, issue)).filter(isGitRepo).find((r) => git(r, ['cat-file', '-e', `${sha}^{commit}`]) !== null);
  if (!repo) return [];
  const holds = (ancestor, ref) => git(repo, ['merge-base', '--is-ancestor', ancestor, ref]) !== null;
  const notes = [];
  const tip = branch ? git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`]) : null;
  if (tip && !holds(tip, sha)) notes.push(`MERGE WITHOUT THE BRANCH — ${sha} does not contain the tip of ${branch} (${tip.slice(0, 12)}), so a check that ran on it did not run on the branch's work; the check runs on the merge result: merge the branch, check the result, and record that commit with jarl.mjs merged ${issue.id} --sha <sha>`);
  const base = defaultBase(repo);
  const baseTip = base !== branch ? git(repo, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]) : null;
  if (baseTip && !holds(sha, baseTip) && !holds(baseTip, sha)) notes.push(`MERGE WITHOUT THE BASE — ${sha} does not contain ${base} as it stands (${baseTip.slice(0, 12)}), so the check ran on a tree the base has moved past; the check runs on the merge result: merge the base into the result, check it again, and record that commit with jarl.mjs merged ${issue.id} --sha <sha>`);
  return notes;
}

// What a merge says when the approve the gate stands on was recorded on another tip of the branch than the one at this
// merge: the commits between the two landed without that review. A commit does not spend an approve inside the gate's
// window, so this note is where it shows. The approve's tip is the tip line written after it, one sha per repository of
// the issue, in the order branchTip gives. The branch's tip now is read in each repository on its own, so a repository
// whose branch is gone (deleted by the cleanup of its own earlier merge, or before the merge is recorded) is left out and
// the others are still compared; an approve with no tip line is not compared. What landed is read along the branch's first parents: the newest of its
// commits after the approved tip that the recorded commit holds. A recorded commit that holds the approved tip and none
// of those is the reviewed one and is left out (the note on a merge without the branch names the rest); one that holds
// the approved tip only through a merge of the base into the branch is no exception, since that merge is a commit of the
// branch. A recorded commit that does not hold the approved tip (a squash) is taken to hold the branch as it stands. A
// repository the recorded commit is not in is said to be not in this merge, or, when it is in none of them, not found
// here: nothing is said to have landed there. The commands the note gives list the branch's commits along its first
// parents, merges of the base included, and the whole difference, so code a conflict fix added is seen.
function approveTipNotes(root, issue, live, sha) {
  if (!live || !live.tip) return [];
  const branch = fieldText(issue.fields.branch);
  if (!branch) return [];
  const short = (s) => s.slice(0, 12);
  const was = live.tip.split(',');
  const repos = issueRepos(root, issue);
  const is = repos.map((dir) => (isGitRepo(dir) ? git(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`]) : null));
  if (!is.some(Boolean) || is.join(',') === live.tip) return [];
  const see = (dir, a, b) => `git -C ${shellWord(dir)} log --oneline --first-parent ${short(a)}..${short(b)} and git -C ${shellWord(dir)} diff ${short(a)} ${short(b)}`;
  const lines = (dir, args) => (git(dir, args) || '').split('\n').filter(Boolean);
  // The newest commit of the branch after the approved tip that the recorded commit holds; null when it holds none of
  // them and holds the approved tip (the reviewed commit landed), the branch's tip when it does not hold the approved tip.
  const landedUpTo = (dir, a, b) => {
    const held = new Set(lines(dir, ['rev-list', sha, `^${a}`]));
    const top = lines(dir, ['rev-list', '--first-parent', `${a}..${b}`]).find((c) => held.has(c));
    if (top) return top;
    return git(dir, ['merge-base', '--is-ancestor', a, sha]) !== null ? null : b;
  };
  const who = live.by ? `by ${live.by} (${live.kind})` : 'by a reviewer not recorded';
  const again = `if it was meant to land, record a review of the tip that landed: jarl.mjs review ${issue.id} approve|changes --by <fresh reviewer> "<findings>"`;
  const head = `APPROVED ON ANOTHER TIP — ${issue.id}'s approve ${who} was recorded on ${branch}`;
  if (was.length !== repos.length) return [`${head} at ${was.map(short).join(', ')}, and the branch stands at ${is.map((s) => (s ? short(s) : 'gone')).join(', ')} at this merge, so that review did not see what changed between them; recorded as given, ${again}`];
  const here = repos.map((dir) => isGitRepo(dir) && git(dir, ['cat-file', '-e', `${sha}^{commit}`]) !== null);
  const away = here.some(Boolean) ? 'not in this merge' : 'not found here';
  const moved = [];
  repos.forEach((dir, k) => {
    const [a, b] = [was[k], is[k]];
    if (!b || a === b) return;
    if (!here[k]) { moved.push({ dir, a, b, away }); return; }
    const to = landedUpTo(dir, a, b);
    if (to) moved.push({ dir, a, b, to });
  });
  if (!moved.length) return [];
  if (repos.length === 1) {
    const [m] = moved;
    if (m.away) return [`${head} at ${short(m.a)}, and the branch stands at ${short(m.b)}; ${short(sha)} is not found here, so what it holds cannot be read; see what changed: ${see(m.dir, m.a, m.b)}; ${again}`];
    const upTo = m.to === m.b ? `the branch stands at ${short(m.b)} at this merge, so what changed between them` : `this merge holds the branch up to ${short(m.to)} (it stands at ${short(m.b)} now), so what changed from ${short(m.a)} to ${short(m.to)}`;
    return [`${head} at ${short(m.a)}, and ${upTo} landed without that review; recorded as given, see it: ${see(m.dir, m.a, m.to)}; ${again}`];
  }
  const entry = (m) => (m.away ? `in ${repoLabel(m.dir)} ${short(m.a)} → ${short(m.b)}, ${m.away}, see it: ${see(m.dir, m.a, m.b)}` : `in ${repoLabel(m.dir)} ${short(m.a)} → ${short(m.to)}, which this merge holds without that review${m.to === m.b ? '' : ` (the branch stands at ${short(m.b)})`}, see it: ${see(m.dir, m.a, m.to)}`);
  return [`${head}, and the branch has moved since in ${moved.length === 1 ? 'one repository' : `${moved.length} repositories`}; recorded as given — ${moved.map(entry).join('; ')}; ${again}`];
}

// What counts as evidence of the work for done: not a ruling written in by decide or answer, and not the
// reason of an earlier move into a needs-reason status (a drop or a deferral).
export function workEvidence(issue, profile = DEFAULT_PROFILE) {
  // Status names are lower-case letters, digits and dashes: nothing in them is read as a pattern.
  const skip = new RegExp(`^\\s*(Ruling\\b${profile.with('needs-reason').map((st) => `|${reasonWord(st)}:`).join('')})`);
  const section = issue.sections.evidence || '';
  let lines = section.split('\n');
  // A note taken back counts for nothing: its lines are left out before anything is read.
  const taken = new Set();
  for (const note of evidenceNotes(section).notes.filter((x) => x.retracted)) for (let i = note.start; i <= note.end; i += 1) taken.add(i);
  // In a section written in parts, the work's evidence is its Proof: the lines of Proof and every row line (a row written
  // by a writer that does not know the parts may sit under Notes). A note alone is not evidence of the work.
  const { proofAt, notesAt } = evidenceParts(lines);
  if (proofAt !== -1 || notesAt !== -1) {
    const proofEnd = notesAt > proofAt ? notesAt : lines.length;
    const inRow = new Set();
    for (const r of evidenceTable(section).rows) for (let i = r.start; i <= r.end; i += 1) inRow.add(i);
    lines = lines.filter((l, i) => inRow.has(i) || (proofAt !== -1 && i > proofAt && i < proofEnd));
  } else lines = lines.filter((l, i) => !taken.has(i));
  return lines.filter((l) => !skip.test(l)).join('\n').trim();
}

// evidence <id> "<text>" appends free text (a merge sha, a one-line note); evidence <id> --ran
// "<command>" --saw "<what it printed>" appends one checkable row per pair instead — repeat the pair,
// in one call or across calls, one row per acceptance line. Both append to the same section, never
// replace it: the merger's free-text note lands after the worker's rows. `set done` needs the section
// non-empty, rows or not (not every issue's proof is a command).
//
// evidence <id> --retract <n> --by <who> "<reason>" retracts the n-th row (numbered over the whole Evidence section, as
// show prints it) by an appended entry: the row stays, struck through, the entry names who retracted it and why, and
// the done gate stops counting it. It only tightens: a row is taken away, never added or revived.
// The --ran/--saw rows of a call, checked: each --ran has its --saw, each with a value.
function rowsOf(flags) {
  const rans = [].concat(flags.ran ?? []);
  const saws = [].concat(flags.saw ?? []);
  need(rans.length && saws.length && [...rans, ...saws].every((v) => typeof v === 'string' && v.trim()), 'a row needs both --ran "<command>" and --saw "<what it printed>", each with a value');
  need(rans.length === saws.length, `--ran and --saw must repeat the same number of times (got ${rans.length} --ran, ${saws.length} --saw)`);
  return rans.map((ran, i) => ({ ran, saw: saws[i] }));
}

// A loop whose profile keeps close or archive to the record ("lifecycle") refuses them from the command line and the
// MCP tools (caller 'cli'), naming the composer's command; a library caller ('record', the default) passes.
export function needLifecycle(root, op, caller = 'record') {
  need(SET_CALLERS.includes(caller), `caller must be one of: ${SET_CALLERS.join(', ')} (got "${caller}")`);
  if (caller !== 'cli') return;
  const profile = loadProfile(root);
  need(profile.lifecycle[op] !== 'record', `this loop is ${op === 'close' ? 'closed' : 'archived'} by the tool that runs it, never by jarl ${op} — its profile (${profile.name}) marks "lifecycle": { "${op}": "record" }, so jarl ${op} and the MCP tools refuse, and nothing was ${op === 'close' ? 'closed or removed' : 'moved'}${profile.lifecycle.command ? `; run: ${profile.lifecycle.command}` : ''}`);
}

// ---- the cleanup a recorded merge makes redundant -------------------------------------------------------------------
//
// Right after merged records a sha, the issue's worktree and its local branch are redundant. Jarl removes them when that is
// safe and keeps everything, naming the condition, when it is not. It is the only place Jarl changes git, and only after a
// recorded merge: `git worktree remove` and `git branch -d`, never a force, never a file removed by any other means, nothing
// pushed and no remote branch touched. It runs for the command line and the tools (--keep skips it), never for a library call.
// The branch is kept unless every condition holds: it is not the base, a release branch or a trunk name; its tip is in the
// base or in the recorded merge; no other unfinished issue holds a lease on it (a package); its worktree, when it has one,
// is on this machine, is the one the lease names, is not the main checkout nor the one the loop or this command lives in,
// and holds nothing uncommitted and nothing untracked; and git itself accepts the removal and the delete.
const TRUNK_NAME = /^(?:HEAD|main|master|trunk|develop|release\/.+)$/;
// A word safe to paste into a shell: single-quoted unless it is plainly safe.
export const shellWord = (s) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);
const sameDir = (a, b) => canonical(a) === canonical(b);
// The one wording for a worktree git lists whose directory is not there. Git marks such a worktree prunable or not
// depending on how the directory went missing, and the lookup reads that as gone or as invisible; both are the same fact here.
const missingWorktreeReason = () => 'git lists its worktree but its directory is missing here';
const insideDir = (dir, path) => { const r = relative(canonical(dir), canonical(path)); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

function cleanUpAfterMerge(root, issues, sha, repoPath, named = []) {
  const profile = loadProfile(root);
  const everyone = loadIssues(root);
  const called = new Set(issues.map((i) => i.id));
  const groups = new Map();
  for (const issue of issues) {
    const branch = fieldText(issue.fields.branch);
    if (!branch) continue;
    for (const repo of repoPath ? [canonical(repoPath)] : issueRepos(root, issue)) {
      const key = `${repo}\n${branch}`;
      if (!groups.has(key)) groups.set(key, { repo, branch, on: [] });
      groups.get(key).on.push(issue);
    }
  }
  const results = [];
  for (const { repo, branch, on } of groups.values()) {
    if (!isGitRepo(repo) || git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]) === null) continue;
    const base = defaultBase(repo);
    const result = { repo: repoLabel(repo), branch };
    const keep = (reason, extra = {}) => results.push({ ...result, ...extra, kept: reason });
    const unsafe = whyNotDeletable(root, repo, [...on.flatMap((i) => splitList(i.fields.repo)), ...named]);
    if (unsafe) { keep(unsafe); continue; }
    if (TRUNK_NAME.test(branch) || branch === base) { keep('it is the base or a release branch'); continue; }
    const others = everyone.filter((i) => !called.has(i.id) && fieldText(i.fields.branch) === branch && profile.unfinished(i.status) && issueRepos(root, i).includes(repo)).map((i) => i.id);
    if (others.length) { keep(`${others.join(', ')} still hold${others.length === 1 ? 's' : ''} a lease on it`); continue; }
    if (git(repo, ['merge-base', '--is-ancestor', branch, base]) === null && git(repo, ['merge-base', '--is-ancestor', branch, sha]) === null) { keep(`its tip is neither in ${base} nor in the merge ${sha}`); continue; }
    const stored = on.map((i) => i.fields.worktree).find(Boolean);
    // Only the worktree git lists on exactly this branch is Jarl's to remove; the path the lease names is looked at to say
    // what it is when it is not that one, and is never removed.
    const ws = worktreeState(repo, branch, undefined);
    if (ws.state === 'none' && stored) {
      const listed = (worktreesOf(repo) || []).find((w) => sameDir(w.path, stored));
      keep(!listed ? `the path the lease names (${stored}) is not a worktree git lists` : listed.branch ? `the path the lease names (${stored}) is a worktree on ${listed.branch}, not on this branch` : `the path the lease names (${stored}) is a detached worktree`);
      continue;
    }
    let removed = null;
    if (ws.state === 'elsewhere') { keep('its worktree is not on this machine'); continue; }
    if (ws.state === 'gone' || ws.state === 'invisible') { keep(missingWorktreeReason()); continue; }
    if (ws.state === 'here') {
      const main = mainCheckoutOf(repo);
      if (main && main.main && canonical(ws.path) === main.main) { keep('it is checked out in the main checkout'); continue; }
      if (stored && existsSync(stored) && canonical(stored) !== canonical(ws.path)) { keep('it is checked out in another worktree than the one the lease names'); continue; }
      if (insideDir(ws.path, root) || insideDir(ws.path, process.cwd())) { keep('the loop or this command lives in its worktree'); continue; }
      // Asked explicitly, whatever git configuration on this machine hides (status.showUntrackedFiles, ignore settings).
      const status = git(ws.path, ['-c', 'status.showUntrackedFiles=all', 'status', '--porcelain', '--untracked-files=all', '--ignored']);
      if (status === null) { keep('the state of its worktree cannot be read'); continue; }
      const lines = status.split('\n').filter(Boolean);
      const changed = lines.filter((l) => !l.startsWith('!!'));
      if (changed.length) { keep(`its worktree holds ${changed.length} uncommitted or untracked file(s)`); continue; }
      // A second, independent look, so that no single mechanism that hides a change from `status` slips through: files an
      // index flag hides (assume-unchanged shows as a lowercase tag in ls-files -v, skip-worktree as S), the working files
      // against HEAD, and the untracked files not ignored.
      const flagged = (git(ws.path, ['-c', 'core.fsmonitor=false', 'ls-files', '-v']) || '').split('\n').filter((l) => l && (/^[a-z]/.test(l) || l.startsWith('S ')));
      if (flagged.length) { keep(`its worktree hides changes from git status behind assume-unchanged or skip-worktree marks: ${flagged.slice(0, 5).map((l) => l.slice(2)).join(', ')}${flagged.length > 5 ? `, and ${flagged.length - 5} more` : ''}`); continue; }
      if (!gitRun(ws.path, ['diff', '--quiet', 'HEAD', '--']).ok) { keep('its worktree differs from its HEAD'); continue; }
      const others = git(ws.path, ['ls-files', '--others', '--exclude-standard']);
      if (others === null || others !== '') { keep('its worktree holds untracked files'); continue; }
      // git deletes ignored files together with a worktree, so a worktree that holds any is left for a person to look at.
      const ignored = lines.map((l) => l.slice(3));
      if (ignored.length) {
        keep(`its worktree holds ignored files: ${ignored.slice(0, 5).join(', ')}${ignored.length > 5 ? `, and ${ignored.length - 5} more` : ''}`, { commands: [`git -C ${shellWord(repo)} worktree remove --force ${shellWord(ws.path)}`, `git -C ${shellWord(repo)} branch -d ${shellWord(branch)}`] });
        continue;
      }
      const gone = gitRun(repo, ['worktree', 'remove', ws.path]);
      if (!gone.ok) { keep(`git worktree remove refused: ${gone.err}`); continue; }
      removed = ws.path;
    }
    const dropped = gitRun(repo, ['branch', '-d', branch]);
    if (!dropped.ok) { keep(`git branch -d refused: ${dropped.err}`, removed ? { worktree: removed } : {}); continue; }
    results.push({ ...result, ...(removed ? { worktree: removed } : {}), removed: true });
  }
  return results;
}

export function cmdTag(root, rawIds, ops, by = undefined) {
  const editor = editorOf(by);
  const issues = issuesFor(root, rawIds);
  for (const op of ops) need(/^[+-]./.test(op), `tags are +name or -name, not "${op}"`);
  const results = issues.map((issue) => {
    const tags = new Set(issue.tags);
    for (const op of ops) { if (op.startsWith('+')) tags.add(op.slice(1)); else tags.delete(op.slice(1)); }
    return { issue, tags: [...tags].sort() };
  });
  return writeTags(root, rawIds, results, editor, (r) => ({ id: r.issue.id, tags: r.tags }));
}
// field <ids> Tags "a, b": the tags replaced by the list given, as tag writes them.
function cmdTagList(root, rawIds, value, by) {
  const editor = editorOf(by);
  const tags = [...new Set(splitList(value))].sort();
  const results = issuesFor(root, rawIds).map((issue) => ({ issue, tags }));
  return writeTags(root, rawIds, results, editor, (r) => ({ id: r.issue.id, tags: r.tags }));
}
function writeTags(root, rawIds, results, by, out) {
  logChanges(root, results.map((r) => fieldLine(r.issue.id, 'Tags', r.tags.join(', '), heldField(r.issue, 'Tags'), by)));
  for (const r of results) writeAtomic(r.issue.file, setField(readText(r.issue.file), 'Tags', r.tags.join(', ')));
  return oneOrMany(rawIds, results.map(out));
}

export function cmdPrio(root, rawIds, prio, by = undefined) {
  need(PRIORITIES.includes(String(prio)), 'priority is 1, 2 or 3');
  const editor = editorOf(by);
  const issues = issuesFor(root, rawIds);
  logChanges(root, issues.map((issue) => fieldLine(issue.id, 'Priority', String(prio), heldField(issue, 'Priority'), editor)));
  for (const issue of issues) writeAtomic(issue.file, setField(readText(issue.file), 'Priority', String(prio)));
  return oneOrMany(rawIds, issues.map((issue) => ({ id: issue.id, priority: String(prio) })));
}

export function cmdFiles(root, rawId, list, dry = false, by = undefined) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  const editor = editorOf(by);
  const files = pathList(list);
  if (!dry) {
    logChanges(root, [fieldLine(issue.id, 'Files', files.join(', '), heldField(issue, 'Files'), editor)]);
    writeAtomic(issue.file, setField(readText(issue.file), 'Files', files.join(', ')));
  }
  return { id: issue.id, files };
}

export function cmdRepo(root, rawId, path, { clear = false, dry = false, by } = {}) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  const editor = editorOf(by);
  if (clear) {
    need(issue.fields.repo, `${issue.id} has no Repo field to clear`);
    if (dry) return { id: issue.id, repo: null, cleared: true };
    logChanges(root, [fieldLine(issue.id, 'Repo', '', issue.fields.repo, editor)]);
    const text = removeFirstField(readText(issue.file), 'Repo');
    writeAtomic(issue.file, text);
    return { id: issue.id, repo: null, cleared: true };
  }
  need(path !== undefined, 'repo requires <name or path> — the repository the issue\'s code lives in (its name, its checkout, a worktree of it or a file inside it), several as one comma list (or --clear to remove the field)');
  const picked = repoList(root, path);
  if (dry) return { id: issue.id, repo: picked.map((p) => p.value).join(', ') };
  commitRepoNames(root, picked);
  const repos = picked.map((p) => p.value);
  const was = fieldText(issue.fields.repo);
  const notes = picked.map((p) => p.note).filter(Boolean);
  if (was === repos.join(', ')) return { id: issue.id, repo: was, repos, unchanged: true, notes };
  logChanges(root, [fieldLine(issue.id, 'Repo', repos.join(', '), was, editor)]);
  writeAtomic(issue.file, setField(readText(issue.file), 'Repo', repos.join(', ')));
  return { id: issue.id, repo: repos.join(', '), repos, notes };
}

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { ARCHIVE_KEEPS, EVIDENCE_HOW, issuesFor, needLiveLoop, oneOrMany, proofSince, rowsOf };
