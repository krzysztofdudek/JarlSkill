// The commands that write the record: init, new, body, set, field, merged and the rest, and the cleanup a
// recorded merge makes redundant.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, openSync, closeSync, writeSync, unlinkSync, linkSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { CI_STATES, LEASE_FIELDS, PRIORITIES, Refusal, TIERS, WAIT_KIND, afterView, echoWord, fieldText, hole, jarlLine, need, noSeparators, refuse, shellWord, slugify, splitList } from './base.mjs';
import { needNoNewOwnersWords, needNoOwnersWords } from './owner.mjs';
import { git, gitBytes, gitHere, gitRun } from './git.mjs';
import { canonical, issuesDir, jarlDir, normalPath, portablePath, stamp, today } from './where.mjs';
import { readText, renameRetry, writeAtomic } from './files.mjs';
import { ISSUE_FILE_RE, branchNameProblem, cmpId, expandIds, idKey, idRe, isBulk, itemNaming, needsRaisedFormat, newIssueKey, newNumber } from './ids.mjs';
import { BUILTIN_STATUSES, DEFAULT_PROFILE, FORMAT_LINES, LIFECYCLE_OPS, PARENT_FIELD, PROFILE_VERSION, TOOL_FIELDS, describeProfile, forgetProfile, formatState, loadProfile, numberWidth, profilePath, readProfileFile, reservedProblem, validateProfile } from './profile.mjs';
import { appendLog, appendLogLines, decisionsPath, goalLines, goalPath, logPath, parseStamp, readGoal, writerRaised } from './journal.mjs';
import { JARL_GITIGNORE, JARL_GITIGNORE_COMMITTED, ensureLoopMerge, outOfGit } from './loop-git.mjs';
import { HANDOVER_SEGMENT, journalById, mergeCheckText } from './log.mjs';
import { FIELD_RE, PROPOSED, RENDERED_FIELDS, acceptanceHeading, alignRows, acceptanceLineCount, acceptanceLines, acceptanceText, bodyText, changelogText, evidenceNotes, evidenceParts, evidenceRows, evidenceTable, fieldValue, findIssue, issueNamed, loadIssues, mergedOf, namedPairs, needNoFieldTags, noteText, parentCycle, parseIssue, placeEvidence, removeFields, removeFirstField, renderIssue, setField, setSection, unattributedRefusal, waitCycle } from './issues.mjs';
import { baseOf, branchTip, commitRepoNames, fileAt, fileKeysOf, isGitRepo, issueRepoPaths, issueRepoSlots, issueRepos, mainCheckoutOf, needFormat, needFormatHeld, needRightCheckouts, repoFromInput, repoNames, repoLabel, repoList, reposNamed, tipLinesOf, whyNotDeletable, worktreeState, worktreesOf } from './repositories.mjs';
import { FIELD_NAMES, IN_PLACE_TAG, activeSlices, carriesCode, unmergedCode, unmergedText, gateOf, isSliceTag, leaseConflictOf, needOneSlice, readLoop, sinceText, sliceOf, unclearedText, unorderedNamings, unorderedText, worksInPlace } from './loop.mjs';
import { carriesDeclared, declaredChecks, declaredFor, lastMerge } from './metrics.mjs';
import { limitNote, modelLines, modelRefusalOf, modelReviewForm, modelValue, modelOfferAtLease, spellingNote } from './models.mjs';
import { slotRefusal } from './attachments.mjs';
import { NOTE_LIMIT, addedContentNotes, addedNoteText } from './rounds.mjs';
import { resetCaches } from './tips.mjs';
import { closeForm, ownerLineRefusal, ownerLineRewrite } from './owner-lines.mjs';
import { LINE_FORM, LINE_ROW_READY, lineDigest, lineRowForm, lineStates, lineStateText, needMarkedLines, unprovedMechanical } from './lines.mjs';

// ---- commands ----------------------------------------------------------------------------------

// What a refusal of an id the loop does not hold ends with: the call that lists the ids it holds.
const listAll = () => ` — the issues: ${jarlLine('list', '--all')}`;
// The ids as they were asked for, where they name more than the ones missing (a range, a list).
const askedAs = (raw, missing) => (String(raw) === missing.join(',') ? '' : ` (asked for as ${String(raw)})`);

export const PERMANENT_MARKER = 'This loop is a permanent record: it is not tied to a feature branch, and `close` never removes this directory. See SKILL.md.\n';

export function cmdInit(root, goal, flags = {}) {
  need(flags.committed === undefined || flags.committed === true, '--committed takes no value — put the goal first: init "<goal>" --committed', () => ({ rename: '--committed', to: hole('<no-flag-here>') }));
  need(flags.permanent === undefined || flags.permanent === true, '--permanent takes no value — put the goal first: init "<goal>" --permanent', () => ({ rename: '--permanent', to: hole('<no-flag-here>') }));
  need(goal, 'init requires "<goal>"', () => ({ arg: 0, value: '<goal>' }));
  need(!hasLiveLoop(root), '.jarl/ already exists here with a live loop — resume it, or archive it first', ['jarl.mjs', 'archive', '<slug>']);
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
    need(asked === null || asked === kept, `this .jarl/ keeps its archived loops in the ${kept} mode, and a new loop here keeps that mode — run init without --${asked}`, () => ({ rename: `--${asked}`, to: hole('<no-flag-here>') }));
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
  // The same for the models: a goal with no Model line leaves every model unplaced, and `models` can rank nothing.
  const noModels = flags.caller === 'cli' && !modelLines(root).declared;
  return { dir: jarlDir(root), committed, permanent, ...(prof ? { profile: prof.profile.name } : {}),
    ...(noModels ? { modelNote: `the goal declares no Model line ("Model (<tier>): <model-id>"), so models places no model and ranks none until it does — add one for each tier: ${jarlLine('goal', '--set', hole('<machine-line>'))}` } : {}), ...(noCheck ? { note: 'the goal names no check (a "Check: <command>" line, or "Check (<name>): <command>" for one repository) — this loop lands on testimony alone, whatever its merges record, until the goal declares one' } : {}) };
}

// A live loop is one with a goal; a .jarl/ holding only archive/ and the mode markers has none.
export function hasLiveLoop(root) {
  return existsSync(goalPath(jarlDir(root)));
}

// The refusal for a command that needs a live loop: no .jarl/ at all, or one holding only archives.
function needLiveLoop(root, next) {
  need(existsSync(jarlDir(root)), `no .jarl/ here${next}`, () => (['jarl.mjs', 'init', '<goal>']));
  need(hasLiveLoop(root), `no live loop here — .jarl/ holds only archived loops${next}`, () => (['jarl.mjs', 'init', '<goal>']));
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
  need(slug, 'archive requires "<slug>", a short name for the loop being put away', () => ({ arg: 0, value: '<slug>' }));
  need(hasLiveLoop(root), existsSync(jarlDir(root)) ? `no loop to archive here — .jarl/ holds only earlier archives; open one with: ${jarlLine('init', '<goal>')}` : 'no .jarl/ here', () => (['jarl.mjs', 'init', '<goal>']));
  needLifecycle(root, 'archive', flags.caller);
  const name = `${today().replace(/-/g, '.')}-${slugify(slug)}`;
  const dest = join(jarlDir(root), 'archive', name);
  need(!existsSync(dest), `.jarl/archive/${name} already exists — pick another slug`, () => ({ replace: slug, value: '<a-new-slug>' }));
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
  need(typeof name === 'string' && TEMPLATE_RE.test(name), `a template is named by letters, digits and . _ - (the file .jarl/templates/<name>.md) — not "${name}"`, () => ({ replace: name, value: '<template>' }));
  const path = join(templatesDir(root), `${name}.md`);
  if (!existsSync(path)) {
    const have = existsSync(templatesDir(root)) ? readdirSync(templatesDir(root)).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)) : [];
    refuse(`no template ${name} in ${templatesDir(root)} — ${have.length ? `templates here: ${have.join(', ')}` : 'none here yet; write one as an issue file without a number (see references/jarl.md, "Templates")'}, or file it without one`, { replace: name, value: hole('<template>') });
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

// The issue numbers the files of a directory's listing hold.
const numbersIn = (names) => names.map((f) => ISSUE_FILE_RE.exec(f)).filter(Boolean).map((m) => Number(m[1]));
// The issue numbers any copy of this loop holds (the main checkout and every linked worktree).
function numbersAcrossWorktrees(root) {
  const found = mainCheckoutOf(root);
  return (found ? found.copies : []).filter((copy) => existsSync(issuesDir(copy))).flatMap((copy) => numbersIn(readdirSync(issuesDir(copy))));
}

// The issue numbers the loop's issue directory holds on any local branch or remote-tracking branch of its repository
// (read-only, one git process for all of them): a clone or a branch that filed an issue this checkout has not merged yet
// has taken that number, and a new issue here takes the next one. None outside git, and for a loop git does not hold.
function numbersAcrossRefs(root) {
  const prefix = git(root, ['rev-parse', '--show-prefix']);
  if (prefix === null) return [];
  const refs = (git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']) || '').split('\n').filter(Boolean);
  if (!refs.length) return [];
  return numbersIn(treeNames(gitBytes(root, ['cat-file', '--batch'], refs.map((r) => `${r}:${prefix}.jarl/issues\n`).join(''))));
}
// The number the next filing in this loop takes, from the numbers held by its issue files, its copies in every other
// worktree and every branch of its repository. The issue files stay the only source: there is no counter file. `range`
// is a range the goal declares (see declaredRange), or null for the numbers outside every declared range.
export function nextIssueNumber(root, range = null) {
  const dir = issuesDir(root);
  const held = [...(existsSync(dir) ? numbersIn(readdirSync(dir)) : []), ...numbersAcrossWorktrees(root), ...numbersAcrossRefs(root)];
  return numberAfter(held, rangesOf(root), range, 1);
}
// The numbers `count` filings outside every range take one after another in one act, each as new takes it: the next
// free number, stepped past each declared range it falls in.
export function nextIssueNumbers(root, count) {
  const ranges = rangesOf(root);
  const out = [];
  for (let n = count > 0 ? nextIssueNumber(root) : 0; out.length < count; n = numberAfter([], ranges, null, n + 1)) out.push(n);
  return out;
}
// The ranges of numbers the goal declares, each { name, from, to }.
const rangesOf = (root) => goalLines(readGoal(jarlDir(root))).ranges;
const rangeAt = (ranges, n) => ranges.find((r) => n >= r.from && n <= r.to) || null;
// The first free number of a series at `least` or above, `held` being the numbers already taken: in a declared range, one
// above the highest number the range holds, or its first, and null when the range has none left; outside every range, one
// above the highest number held outside them all, stepped past each range it falls in. A number held in one series never
// moves the count of another.
function numberAfter(held, ranges, range, least) {
  if (range) {
    const n = Math.max(held.filter((x) => x >= range.from && x <= range.to).reduce((m, x) => Math.max(m, x), range.from - 1) + 1, least);
    return n <= range.to ? n : null;
  }
  let n = Math.max(held.filter((x) => !rangeAt(ranges, x)).reduce((m, x) => Math.max(m, x), 0) + 1, least);
  for (let r = rangeAt(ranges, n); r; r = rangeAt(ranges, n)) n = r.to + 1;
  return n;
}
// The range --range names among the ones the goal declares, matched in any case; a name the goal does not declare is
// refused with the names it does, or with the goal line that declares one.
function declaredRange(root, raw) {
  const name = typeof raw === 'string' ? raw.trim() : '';
  const ranges = rangesOf(root);
  const range = ranges.find((r) => r.name.toLowerCase() === name.toLowerCase());
  if (range) return range;
  if (ranges.length) refuse(`the goal declares no range ${JSON.stringify(name)}: its ranges are ${ranges.map((r) => `${r.name} (${r.from}-${r.to})`).join(', ')}`, { flag: '--range', value: hole('<name>') });
  refuse(`the goal declares no range ${JSON.stringify(name)}, nor any other: a range is a goal line, "Range (<name>): <from-to>"`, ['jarl.mjs', 'goal', '--set', `Range (${hole('<name>')}): ${hole('<from-to>')}`]);
}
// The refusal of a filing in a range that has no number left.
function needRoomIn(range, n) {
  need(n !== null, `the range ${range.name} (${range.from}-${range.to}) has no number left: widen it in the goal`, () => ['jarl.mjs', 'goal', '--set', `Range (${range.name}): ${hole('<from-to>')}`]);
}
// The names of the entries of every tree `git cat-file --batch` printed: each object is "<hash> <type> <size>", its bytes
// and a line break; a tree's bytes are entries of "<mode> <name>", a zero byte and the entry's hash in binary. An object
// git did not find is one line ("<name> missing") and holds no names.
function treeNames(buf) {
  const names = [];
  if (!buf) return names;
  let at = 0;
  while (at < buf.length) {
    const eol = buf.indexOf(10, at);
    if (eol === -1) break;
    const [hash, type, size] = buf.subarray(at, eol).toString('utf8').split(' ');
    at = eol + 1;
    if (size === undefined || !/^\d+$/.test(size)) continue;
    const end = at + Number(size);
    if (type === 'tree') {
      const width = hash.length / 2;
      for (let p = at; p < end;) {
        const zero = buf.indexOf(0, p);
        if (zero === -1 || zero >= end) break;
        const entry = buf.subarray(p, zero).toString('utf8');
        names.push(entry.slice(entry.indexOf(' ') + 1));
        p = zero + 1 + width;
      }
    }
    at = end + 1;
  }
  return names;
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

// The --field pairs of a filing: each one <name>=<value>, its name a field the profile declares, and its value one of the
// field's values where the field has values. A pair that is not is refused with that pair and a placeholder in its place,
// the reason naming the pair, so a caller that files many issues from one call checks the pairs once, as the call's own.
export function givenFields(profile, list) {
  const given = namedPairs(list, 'field', profile.fields.map((f) => f.name), 'field');
  for (const f of profile.fields) {
    const item = given.items.get(f.name);
    const v = item === undefined ? '' : fieldText(given.get(f.name));
    need(!f.enum || v === '' || f.enum.includes(v), `${f.name} must be one of: ${(f.enum || []).join(', ')} (got "${v}")`, () => ({ replace: item, value: `${String(item).slice(0, String(item).indexOf('='))}=${hole('<value>')}` }));
  }
  return given;
}

// `from`, a filing's own and never a flag or a library option (newIssue passes three arguments): { dry, number, repoOf }.
// dry runs every check of the filing and writes nothing; number, with dry, is the number the filing would take (the next
// free one when absent), for a caller that checks several filings before the first of them is written; repoOf (issue
// files) gives the new issue the Repo those issues hold once every raise of the filing has run, so a finding a review
// files names its repositories as the reviewed issue does.
export function cmdNew(root, title, rawFlags, from = {}) {
  need(title, 'new requires "<title>"', { arg: 0, value: '<title>' });
  needNoOwnersWords('the new issue', title, rawFlags);
  // A title is the heading line of the issue: line breaks in it become spaces, so the lines after the first are not lost to the heading.
  if (/[\r\n]/.test(title)) title = String(title).split(/\r\n?|\n/).map((l) => l.trim()).filter(Boolean).join(' ');
  needLiveLoop(root, ` — run: ${jarlLine('init', '<goal>')}`);
  // A linked worktree of a committed loop holds only the copy it was cut with, so a number taken there may already be used
  // in the main checkout: file from the main checkout.
  const placed = mainCheckoutOf(root);
  need(!placed || !placed.linked || !existsSync(jarlDir(placed.mainRoot)), `${echoWord(root)} is a linked worktree of ${echoWord(placed?.mainRoot)}, which holds this loop: its copy here may lag, and the number would be used twice — file from the main checkout: pass --root ${echoWord(placed?.mainRoot)}`, () => ({ flag: '--root', value: placed?.mainRoot ?? '<the-main-checkout>' }));
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
  const given = givenFields(profile, flags.field);
  const fields = profile.fields.map((f) => {
    const raw = given.has(f.name) ? given.get(f.name) : fromTemplate.allFields?.[f.key] || f.default || '';
    const v = fieldValue(profile, f, raw);
    need(!f.required || v, `${f.name} is required by this loop's profile — give it${f.enum ? ` (one of: ${f.enum.join(', ')})` : ''}`, () => ({ flag: '--field', value: `${f.name}=${hole('<value>')}`, add: true }));
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
  need(profile.kinds.includes(kind), `--kind must be one of: ${profile.kinds.join(', ')} (got "${kind}")`, () => ({ flag: '--kind', value: hole('<kind>') }));
  const person = flags.person !== undefined ? keptValue('Person', flags.person) : '';
  const checkWhen = flags['check-when'] !== undefined ? keptValue('Check when', flags['check-when']) : '';
  const kept = profile.keptKind(kind);
  need(kept === WAIT_KIND || (!person && !checkWhen), profile.kept ? `--${person ? 'person' : 'check-when'} goes with --kind wait: it names the outside person a wait is held by and when to check it` : `--${person ? 'person' : 'check-when'} is off in this loop: its profile declares its own kinds or a field Person or Check when, so the built-in promise and wait are off here — write a field the profile declares with --field "<name=value>"`, () => (profile.kept ? { flag: '--kind', value: hole('<kind>') } : [{ drop: '--person' }, { drop: '--check-when' }, { flag: '--field', value: hole('<name=value>') }]));
  need(kept !== WAIT_KIND || (person && checkWhen), `a wait names the outside person it is held by and when to check it`, () => [...(person ? [] : [{ flag: '--person', value: '<name>' }]), ...(checkWhen ? [] : [{ flag: '--check-when', value: '<date-or-event>' }])]);
  const priority = String(flags.prio || '2');
  const priorityDefaulted = !flags.prio;
  need(PRIORITIES.includes(priority), `--prio must be 1, 2 or 3 (got "${priority}")`, () => ({ flag: '--prio', value: hole('<prio>') }));
  const tier = String(flags.tier || profile.tierDefault);
  need(profile.tiers.includes(tier), `--tier must be one of: ${profile.tiers.join(', ')} (got "${tier}") — the tier of model the worker is raised on, mapped to a model by the platform running the loop`, () => ({ flag: '--tier', value: hole('<tier>') }));
  const picked = flags.repo !== undefined ? repoList(root, flags.repo) : [];
  needOneSlice(splitList(flags.tags));
  const source = sourceList(flags.source);
  const after = flags.after !== undefined ? afterList(root, null, flags.after) : [];
  // A line only the owner ticks names its material and what to check; its first write raises the record format.
  const acceptance = flags.acceptance !== undefined ? acceptanceText(flags.acceptance) : bodyText(fromTemplate.acceptance);
  const ownerLined = needMarkedLines(acceptance, (value) => ({ flag: '--acceptance', value }));
  // A number from a range the goal declares, for a series of issues kept apart by number.
  const range = rawFlags.range !== undefined ? declaredRange(root, rawFlags.range) : null;
  const inPlace = splitList(flags.tags).includes(IN_PLACE_TAG);
  const render = (id, key, repo) => renderIssue({
    id, title, status: profile.initial, key, kind, priority, tier, fields, sections, acceptanceHeading: profile.acceptance || 'Acceptance',
    tags: splitList(flags.tags), files: pathList(flags.files), repo, foundBy: flags['found-by'] || 'jarl', person, checkWhen,
    where: flags.where, what: bodyText(flags.what), why: bodyText(flags.why), source, after,
    // A template's Acceptance and Changelog are taken as written (a list already); a flag replaces them.
    acceptance,
    changelog: flags.changelog !== undefined ? changelogText(flags.changelog) : bodyText(fromTemplate.changelog),
  });
  // A dry filing ends here, before the first write: the text the file would hold passes the record's check too.
  // The raises the filing would make are checked as well, so a loop that refuses them is refused here, with nothing written:
  // the number it would take among them (from.number, where filings before it in the same act take the ones below).
  if (from.dry) {
    const number = from.number ?? nextIssueNumber(root, range);
    if (range) needRoomIn(range, number);
    const id = newNumber(number, numberWidth(profile, rawFlags.width));
    needNoNewOwnersWords('', render(id, null, picked.map((p) => p.value).join(', ')), `${id}-${slugify(title)}.md`);
    if (range) needFormatHeld(root, 'range-number');
    if (inPlace) needFormatHeld(root, 'in-place');
    if (needsRaisedFormat(id)) needFormatHeld(root, 'plain-number', `issue number ${id}`);
    if (kept) needFormatHeld(root, 'promise-wait');
    if (picked.some((p) => p.name)) needFormatHeld(root, 'repo-name');
    if (ownerLined) needFormatHeld(root, 'owner-line');
    return { dry: true };
  }
  // A promise and a wait are kinds a reader of formats 1 and 2 does not know: the loop is raised first, or, where a composer
  // keeps its format, the filing is refused with nothing written. So is a number from a declared range, which a reader that
  // knows no range would count past.
  if (range) needRoomIn(range, nextIssueNumber(root, range));
  if (range) needFormat(root, 'range-number');
  // So is an issue worked in place, which a reader of formats 1 and 2 would close with no commit of its files named.
  if (inPlace) needFormat(root, 'in-place');
  if (kept) needFormat(root, 'promise-wait');
  commitRepoNames(root, picked);
  if (ownerLined) needFormat(root, 'owner-line');
  // The issue's key, its filing stamp and four random letters, raises the loop to the format that holds it. A loop a
  // composer keeps stays in the format the composer reads, and its issues carry no key: they are told apart by number; so
  // are the issues of a loop whose profile declares a field Key of its own.
  const keyed = loadProfile(root).keyed && (formatState(loadProfile(root)).raises || loadProfile(root).format >= FORMAT_LINES['issue-key'].format);
  if (keyed) needFormat(root, 'issue-key');
  // Read after the raises, which write a bare path of a format-1 loop with a leading ./, so the pair names one place alike.
  const repoText = from.repoOf ? [...new Set(from.repoOf.flatMap((f) => reposNamed(parseIssue(readText(f), f))))].join(', ') : picked.map((p) => p.value).join(', ');
  const at = stamp();
  const key = keyed ? newIssueKey(at) : null;
  // The number is claimed by creating the file with a link, which never overwrites: when another
  // writer got there first (the lock makes that rare, not impossible — a hand-made file, a stale
  // lock broken early), the next number is tried instead of two issues sharing one.
  const dir = issuesDir(root);
  // Git keeps no empty directory, so a clone of a loop committed before its first issue has none yet.
  mkdirSync(dir, { recursive: true });
  const taken = () => readdirSync(dir).map((f) => ISSUE_FILE_RE.exec(f)).filter(Boolean).map((m) => Number(m[1]));
  // The numbers over this loop, its copies in every other worktree and every local and remote-tracking branch of its
  // repository (read-only), so a lagging copy cannot hand out a number already used elsewhere.
  let n = nextIssueNumber(root, range);
  if (range) needRoomIn(range, n);
  for (let tries = 0; ; tries += 1) {
    const id = newNumber(n, numberWidth(profile, rawFlags.width));
    // The first issue of 1000 or more is a file a reader that knows only format 1 would skip in silence: the format is raised first.
    if (needsRaisedFormat(id)) needFormat(root, 'plain-number');
    const file = join(dir, `${id}-${slugify(title)}.md`);
    const tmp = join(dir, `.${id}.${process.pid}.tmp`);
    const rendered = render(id, key, repoText);
    // The file is claimed by a link, not through writeAtomic, so its text passes the record's one check here (a template too).
    needNoNewOwnersWords('', rendered, `${id}-${slugify(title)}.md`);
    writeFileSync(tmp, rendered);
    let claimed = !taken().includes(n);
    // The filing goes into the journal first: a write that stops after it leaves the record ahead of the files (a filing
    // with no file, and the number is taken again), never a file the record does not hold.
    if (claimed) appendLogLines(root, [{ text: `filed ${id} · ${title}${rawFlags.template !== undefined ? ` · template ${rawFlags.template}` : ''}`, key }], at);
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
    need(tries < 100, 'could not claim a free issue number after 100 tries', () => afterView(['jarl.mjs', 'verify']));
    n = numberAfter(taken(), rangesOf(root), range, n + 1);
    if (range) needRoomIn(range, n);
  }
}

// renumber <id> --key <key>: of the issue files that carry one number after a merge, the one whose header carries `key`
// is given the next free number (over this checkout, its worktrees and every branch, as new takes one): its file is
// renamed and its first line says the new number. Every line the log holds about it names its key, so the issue keeps
// them under its new number, and no line is rewritten: the log takes one line, `<new> renumbered from <old> · <file>`,
// with the key, written before the file moves. A number one file carries, and a file with no key, are refused.
export function cmdRenumber(root, rawId, flags = {}) {
  needLiveLoop(root, '');
  // Where the ready call names a number: a placeholder for one of those two files of the loop carry; where no number
  // is carried twice, verify, which shows what there is to repair.
  const carriedTwice = () => { const ids = loadIssues(root).filter((i) => i.id !== null).map((i) => i.id); const twice = [...new Set(ids.filter((id, n) => ids.findIndex((x) => idKey(x) === idKey(id)) !== n))]; return twice.length ? { arg: 0, value: hole('<a-number-two-files-carry>') } : ['jarl.mjs', 'verify']; };
  need(rawId !== undefined && /^#?\d+$/.test(String(rawId).trim()), 'renumber takes the number two issue files carry', carriedTwice);
  const issues = loadIssues(root);
  const same = issues.filter((i) => i.id !== null && idKey(i.id) === idKey(rawId));
  need(same.length, `no such issue: ${rawId}${listAll()}`, () => ({ replace: rawId, value: '<id>' }));
  const old = same[0].id;
  const named = (list) => list.map((i) => `issues/${basename(i.file)} (${i.fields.key ? `key ${fieldText(i.fields.key)}` : 'no key'})`).join(', ');
  need(same.length > 1, `${old} is carried by one issue file, ${named(same)}: renumber gives a free number to one of the files that carry one number after a merge, and the files that do: ${jarlLine('verify')}`, carriedTwice);
  need(flags.key !== undefined && String(flags.key).trim() !== '', `${old} is carried by ${named(same)}: name the one to give a free number with --key <key>`, () => ({ flag: '--key', value: keysOf(same) }));
  const key = String(flags.key).trim();
  const pick = same.find((i) => i.fields.key === key);
  need(pick, `no file of ${old} carries the key ${key}: ${named(same)}`, () => ({ flag: '--key', value: keysOf(same) }));
  needFormat(root, 'issue-key');
  const profile = loadProfile(root);
  const dir = issuesDir(root);
  const before = readText(pick.file);
  const rest = basename(pick.file).replace(/^\d+-/, '');
  // The free number comes from the series the old one belongs to: its declared range, or the numbers outside every range.
  const ranges = rangesOf(root);
  const range = rangeAt(ranges, Number(old));
  for (let n = nextIssueNumber(root, range), tries = 0; ; n = numberAfter([], ranges, range, n + 1), tries += 1) {
    if (range) needRoomIn(range, n);
    need(tries < 100, 'could not claim a free issue number after 100 tries', () => afterView(['jarl.mjs', 'verify']));
    const id = newNumber(n, numberWidth(profile));
    if (needsRaisedFormat(id)) needFormat(root, 'plain-number');
    const file = join(dir, `${id}-${rest}`);
    if (existsSync(file)) continue;
    const text = before.replace(idRe('^#(\\s+){id}(\\s+·)'), `#$1${id}$2`);
    needNoNewOwnersWords(before, text, `${id}-${rest}`);
    const tmp = join(dir, `.${id}.${process.pid}.tmp`);
    writeFileSync(tmp, text);
    // The line goes into the journal first: a write that stops after it leaves the line beside the file it names under
    // its old number, which its key still finds.
    appendLogLines(root, [{ text: `${id} renumbered from ${old} · issues/${id}-${rest}`, key }]);
    let claimed;
    try { claimed = claimFile(tmp, file); } finally { unlinkSync(tmp); }
    if (!claimed) continue;
    unlinkSync(pick.file);
    return { id, from: old, key, file };
  }
}
// The placeholder of the keys the files of one number carry: which file gets the free number is the caller's choice.
function keysOf(files) {
  const keys = files.map((i) => fieldText(i.fields.key ?? '')).filter(Boolean);
  return hole('<key>');
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
  for (const s of list) need(/^[^#\s]+#[^#\s]+$/.test(s), `a source is <report-dir#finding-id>, e.g. core/research/2026-09-25-jarl#jarl-2-B2 — not "${s}"`, () => ({ replace: s, value: '<report-dir#finding-id>' }));
  return list;
}

// The issues one waits on: each must exist and not be the issue itself, and the chain must not come back to
// it — a cycle would leave every issue in it waiting for good with nothing to say so.
function afterList(root, selfId, raw) {
  const keys = expandIds(raw);
  const all = loadIssues(root);
  const missing = keys.filter((k) => !all.some((i) => idKey(i.id) === k));
  need(missing.length === 0, `no such issue: ${missing.join(', ')}${askedAs(raw, missing)}${listAll()}`, () => ({ replace: itemNaming(raw, missing[0]), value: hole('<ids-the-loop-holds>') }));
  const ids = keys.map((k) => issueNamed(all, k).id);
  need(!selfId || !ids.some((id) => idKey(id) === idKey(selfId)), `${selfId} cannot wait on itself`, () => ({ arg: 2, value: String(raw).split(',').map((s) => s.trim()).filter(Boolean).map((s) => (/^#?\d+$/.test(s) && idKey(s) === idKey(selfId) ? hole('<another-id>') : s)).join(',') }));
  if (selfId) {
    // A wait runs through the tree too: a parent waits on its sub-issues, and a sub-issue on the After of every issue above it.
    const cycle = waitCycle(all, selfId, { afters: new Map([[selfId, ids]]) });
    const onPath = new Set(cycle ? cycle.ids : []);
    const throughTree = all.some((i) => onPath.has(i.id) && i.tree && (i.tree.parent || i.tree.children.length));
    need(!cycle, throughTree
      ? `${selfId} after ${ids.join(', ')} would close a cycle through the tree (${cycle?.text}): a parent waits on its sub-issues and a sub-issue on the After of every issue above it, so none of them would ever be offered`
      : `${selfId} after ${ids.join(', ')} would close a cycle: that chain of After already leads back to ${selfId} (${cycle?.text}), so none of them would ever be offered`, () => ({ replace: ids[0], value: '<id>' }));
  }
  return ids;
}

// What an issue waits on, not yet settled (an issue in a settles-dependents status settles, built-in: done and dropped;
// any other does not, open, in progress, deferred; an id with no issue behind it, removed by hand, holds nothing back):
// after, its own After and the After of every issue above it in the tree, so going deeper breaks no order; and subs, its
// own sub-issues, as a parent is offered only once each of them is settled.
export function waitsOf(issue, byId, profile = DEFAULT_PROFILE) {
  const open = (id) => byId.has(id) && !profile.is(byId.get(id).status, 'settles-dependents');
  const tree = issue.tree || { ancestors: [], children: [] };
  const after = [...new Set([...issue.after, ...tree.ancestors.flatMap((a) => a.after)])].filter(open);
  return { after, subs: tree.children.map((c) => c.id).filter(open) };
}
// Everything an issue waits on, in one list: the After issues not settled, then its sub-issues not settled.
export function waitingOn(issue, byId, profile = DEFAULT_PROFILE) {
  const { after, subs } = waitsOf(issue, byId, profile);
  return [...after, ...subs.filter((id) => !after.includes(id))];
}

// ---- the description of an issue -----------------------------------------------------------------
//
// An issue is its description and its history. Every part of the description (the title, the header fields below, the
// fields a profile declares, the What, Why, Acceptance and Changelog sections and the sections a profile declares) is
// changed by a command, and every change writes one log line that names the part, who changed it and what it held
// before. The history (evidence rows and notes, verdicts, merges, rulings, answers) has no edit at all: a row or an
// approve is taken back by retract, a ruling replaced by decide --supersedes, and the status moves only through set.

// The header fields of the description, each written by field and by its own command.
export const DESCRIPTION_FIELDS = ['Title', 'Priority', 'Tier', 'Kind', 'Found by', 'Tags', 'Files', 'Repo', 'After', 'Parent', 'Source', 'Where', 'Resources', 'Person', 'Check when'];
// A wait's Person (the outside person it is held by, the name next --as answers to) and its Check when (a date, or the
// event to check after): each one value on one line, without the log's separator.
function keptValue(name, value) {
  const v = fieldText(value);
  need(typeof value === 'string' && v, `${name} needs a value: ${name === 'Person' ? 'the outside person a wait is held by' : 'when to check a wait, a date or the event to check after'}`, () => ({ replace: String(value ?? ''), value: name === 'Person' ? '<name>' : '<date-or-event>' }));
  need(!/[\r\n]/.test(String(value).trim()), `${name} is one line (got ${JSON.stringify(String(value))})`, () => ({ replace: String(value), value: hole('<value>') }));
  need(!v.includes('·'), `${name} is one value — not a phrase with "·" in it (got "${v}")`, () => ({ replace: String(value), value: hole('<value>') }));
  return v;
}
// The name a description change records as its author, or null when the call names nobody: a write nobody named is
// logged with no author at all, never under a name nobody gave. A name is one name on one line, without the log's
// separator, which would let it be read as more than one segment of the line.
export function editorOf(by) {
  if (by === undefined || by === null) return null;
  const name = fieldText(by);
  need(typeof by === 'string' && name, '--by needs a name: who changed the description', () => ({ flag: '--by', value: '<who>' }));
  need(!/[\r\n]/.test(String(by).trim()), `--by is one name on one line (got ${JSON.stringify(String(by))})`, () => ({ flag: '--by', value: '<one-name>' }));
  need(!name.includes('·'), `--by is one name — not a phrase with "·" in it (got "${name}")`, () => ({ flag: '--by', value: '<one-name>' }));
  return name;
}
// The stand-in a description line writes for the log's separator inside a value, as ⏎ stands in for a line break: the
// value stays readable, and no reader finds a separator in it.
const SEPARATOR_MARK = '∙';
// A value as one segment of a description line: on one line (each break as ⏎), each separator as its stand-in; (none) when empty.
const logValue = (v) => String(v ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean).join(' ⏎ ').replace(/·/g, SEPARATOR_MARK) || '(none)';
const byPart = (by) => (by ? ` · by ${by}` : '');
// The line a change of a header field writes, `<id> field <Name> · <value> · was <old value>[ · by <who>]`, or null when
// the field already holds the value: a change to nothing writes no line. Where is free text of any length, so what it
// held is kept as a section's first line is: at most EXCERPT_CHARS of it, and its length when it is cut. The value it
// holds now is kept the same way.
function fieldLine(id, name, value, was, by) {
  if (fieldText(value) === fieldText(was)) return null;
  const shown = (v) => (name === 'Where' && fieldText(v).length > EXCERPT_CHARS ? `${logValue(fieldText(v).slice(0, EXCERPT_CHARS))}… (${fieldText(v).length} characters)` : logValue(v));
  return `${id} field ${name} · ${fieldText(value) === '' ? '(cleared)' : shown(value)} · was ${shown(was)}${byPart(by)}`;
}
// The most of a section's first line a body line keeps: the line stays one short line whatever the section holds.
const EXCERPT_CHARS = 120;
// The line a change of the title or of a section writes, `<id> body · <part> · was "<old text>"[ · by <who>]`, or null
// when the part already holds that text. The title is kept whole; a section by its first line (at most EXCERPT_CHARS)
// and its length, so a long section never floods the log.
// A change of the acceptance that grew a leased issue's scope carries `grew after the lease: line <n>[, <n>…]` after what
// the part held and before its author: a segment of the description line every reader places by its start, so no reader
// misreads a line that has one.
function bodyLine(id, part, was, now, by, grew = []) {
  const old = String(was ?? '').trim();
  if (old === String(now ?? '').trim()) return null;
  const mark = grew.length ? ` · ${GREW_MARK} ${grew.map((g) => g.n).join(', ')}` : '';
  if (!old) return `${id} body · ${part} · was (none)${mark}${byPart(by)}`;
  if (part === 'title') return `${id} body · ${part} · was "${logValue(old)}"${byPart(by)}`;
  // The lines are kept whole, so the tool can read back what they were at any point: one JSON string, and in it the log's
  // separator written as its escape, so no segment of the line is cut inside the old text.
  if (part === 'acceptance') return `${id} body · ${part} · was ${JSON.stringify(old).replace(/·/g, '\\u00b7')}${mark}${byPart(by)}`;
  const first = old.split(/\r\n?|\n/)[0].trim();
  const cut = first.length > EXCERPT_CHARS ? `${first.slice(0, EXCERPT_CHARS)}…` : first;
  return `${id} body · ${part} · was "${logValue(cut)}" (${old.length} characters)${mark}${byPart(by)}`;
}
// An issue's scope does not grow once it is leased. Every change of an acceptance (field and the library's setBody, which
// write through cmdBody, and split) asks here which lines it grew: on an issue in a status that holds a lease, each line
// the new acceptance holds that the old one did not (a line added, or one rewritten), with its number in the new
// acceptance; nothing on an issue no lease holds, and nothing for a change that only takes lines away.
const GREW_MARK ='grew after the lease: line';
function grownLines(profile, issue, was, now) {
  if (!profile.is(issue.status, 'holds-claim')) return [];
  const held = new Map();
  for (const l of acceptanceLines({ sections: { acceptance: String(was ?? '') } })) held.set(l, (held.get(l) || 0) + 1);
  return acceptanceLines({ sections: { acceptance: String(now ?? '') } }).map((text, k) => ({ n: k + 1, text })).filter(({ text }) => {
    const left = held.get(text) || 0;
    if (left) held.set(text, left - 1);
    return !left;
  });
}
// The note a change of an issue's acceptance prints where a row named a line that is no line now: the row counts for
// nothing, and the new text needs its own proof.
function rowsLostNote(issue, was, now) {
  const before = new Set(acceptanceLines({ sections: { acceptance: String(was ?? '') } }).map(lineDigest));
  const after = new Set(acceptanceLines({ sections: { acceptance: String(now ?? '') } }).map(lineDigest));
  const named = new Set(evidenceTable(issue.sections.evidence).rows.filter((r) => !r.retracted).flatMap((r) => r.lines));
  const lost = [...before].filter((d) => !after.has(d) && named.has(d)).length;
  return lost ? `note: ${issue.id} holds ${lost === 1 ? 'a row' : 'rows'} naming ${lost} acceptance line${lost === 1 ? '' : 's'} this change rewrote or removed: a row counts only for the text it named, so the new text needs its own proof: ${lineRowForm(issue.id)}` : null;
}
// The note a change that grew a leased issue's scope prints, naming each line it grew by.
function grewNote(issue, grew) {
  return `note: ${issue.id} is leased (${issue.status}), and its scope grew after the lease: ${grew.map((g) => `line ${g.n} "${g.text}"`).join('; ')} — an issue's scope does not grow once it is leased: a new ask is a new issue, ${jarlLine('new', hole('<title>'), '--acceptance', hole('<line>'))}`;
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
// The body of one issue (the writer of field's title, Where and sections, and of the library's setBody): the title, the
// Where field and the What, Why, Acceptance and Changelog sections, and the profile's sections, set or replaced; with append, the text of each section is added after what it holds. Evidence is never written here:
// it is the record of what was done, appended by evidence, never replaced.
// `dry` checks everything the call would refuse and writes nothing: a list of ids is run dry on every id before the
// first one is written (see eachIssue).
export function cmdBody(root, rawId, flags, dry = false) {
  needNoOwnersWords('the body', flags);
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}${listAll()}`, () => ({ replace: rawId, value: '<id>' }));
  const profile = loadProfile(root);
  const parts = ['title', 'where', 'what', 'why', 'acceptance', 'changelog', 'section'].filter((k) => flags[k] !== undefined);
  need(parts.length, 'body needs at least one of --title, --where, --what, --why, --acceptance, --changelog, --section', () => (['jarl.mjs', 'field', '<ids>', '<part>', '<value>']));
  const by = editorOf(flags.by);
  const title = flags.title === undefined ? null : fieldText(flags.title);
  need(flags.title === undefined || title, '--title needs a title', () => (['jarl.mjs', 'field', '<ids>', 'Title', '<title>']));
  const sections = namedPairs(flags.section, 'section', profile.sections, 'section');
  const append = flags.append === true;
  if (append) {
    need(flags.title === undefined && flags.where === undefined, '--append adds to a section (What, Why, Acceptance, Changelog or a profile section): the title and the Where field are replaced, not appended to', () => ({ rename: '--add', to: hole('<no-flag-here>') }));
    for (const [heading, v] of [['What', flags.what], ['Why', flags.why], ['Acceptance', flags.acceptance], ['Changelog', flags.changelog], ...sections]) {
      need(v === undefined || [].concat(v).some((x) => fieldText(x) !== ''), `--append needs text to add to the ${heading} section, not an empty one`, () => ({ replace: '', value: '<text>' }));
    }
  }
  needNoFieldTags(flags.what, 'the What text');
  needNoFieldTags(flags.why, 'the Why text');
  for (const [h, v] of sections) needNoFieldTags(v, `the ${h} text`);
  const ownerLined = flags.acceptance !== undefined && needMarkedLines(acceptanceText(flags.acceptance), (value) => ({ arg: 2, value }));
  const named = parts.flatMap((k) => (k === 'section' ? [...sections.keys()] : [k]));
  if (dry) return { id: issue.id, set: named };
  if (ownerLined) needFormat(root, 'owner-line');
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
  let grew = [];
  let rewrote = false;
  if (flags.acceptance !== undefined) {
    const heading = acceptanceHeading(issue, profile);
    const now = acceptanceText(append ? [...itemsOf(held(heading.toLowerCase())), ...[].concat(flags.acceptance)] : flags.acceptance);
    rewrote = String(held('acceptance')).trim() !== String(now).trim();
    text = setSection(text, heading, now);
    grew = grownLines(profile, issue, held('acceptance'), now);
    lines.push(bodyLine(issue.id, 'acceptance', held('acceptance'), now, by, grew));
  }
  for (const [h, v] of sections) section(h, h, grow(h, bodyText(v)));
  if (flags.changelog !== undefined) section('Changelog', 'changelog', changelogText(flags.changelog, append ? itemsOf(held('changelog')) : []));
  logChanges(root, lines);
  writeAtomic(issue.file, text);
  // Said on the command line only: a rewritten What, Why or Acceptance that names issues nothing orders with this one.
  // A scope grown after the lease is said with the lines it grew by; a library caller reads them as grew.
  // A row keeps the numbers of the acceptance lines it named: a rewritten acceptance says so where rows name any.
  const rowsNote = rewrote ? rowsLostNote(issue, held('acceptance'), issue.sections.acceptance ?? '') : null;
  const note = flags.caller === 'cli' ? [...(grew.length ? [grewNote(issue, grew)] : []), ...(rowsNote ? [rowsNote] : []), ...(['what', 'why', 'acceptance'].some((k) => named.includes(k)) ? unorderedNotes(root, profile, issue.id) : [])] : [];
  return { id: issue.id, set: named, ...(grew.length ? { grew } : {}), ...(note.length ? { note: note.join('\n') } : {}) };
}

export function cmdSource(root, rawId, list, dry = false, by = undefined) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}${listAll()}`, () => ({ replace: rawId, value: '<id>' }));
  const editor = editorOf(by);
  const sources = sourceList(list);
  need(sources.length, 'source requires <report-dir#finding-id>[,...]', () => (['jarl.mjs', 'field', '<ids>', 'Source', '<report-dir#finding-id>']));
  if (dry) return { id: issue.id, sources };
  logChanges(root, [fieldLine(issue.id, 'Source', sources.join(', '), heldField(issue, 'Source'), editor)]);
  writeAtomic(issue.file, setField(readText(issue.file), 'Source', sources.join(', ')));
  return { id: issue.id, sources };
}

export function cmdAfter(root, rawId, raw, { clear = false, dry = false, by } = {}) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}${listAll()}`, () => ({ replace: rawId, value: '<id>' }));
  const editor = editorOf(by);
  if (clear) {
    need(raw === undefined, 'after takes either <ids> or --clear, not both', () => ({ rename: '--clear', to: hole('<no-flag-here>') }));
    need(issue.fields.after !== undefined, `${issue.id} has no After field to clear`, () => ({ rename: '--clear', to: hole('<no-flag-here>') }));
    if (dry) return { id: issue.id, after: [], cleared: true };
    logChanges(root, [fieldLine(issue.id, 'After', '', heldField(issue, 'After'), editor)]);
    writeAtomic(issue.file, removeFirstField(readText(issue.file), 'After'));
    return { id: issue.id, after: [], cleared: true };
  }
  need(raw !== undefined, 'after requires <ids> — the issues this one waits on (or --clear)', () => ({ arg: 2, value: '<ids>' }));
  const ids = afterList(root, issue.id, raw);
  if (dry) return { id: issue.id, after: ids };
  logChanges(root, [fieldLine(issue.id, 'After', ids.join(', '), heldField(issue, 'After'), editor)]);
  writeAtomic(issue.file, setField(readText(issue.file), 'After', ids.join(', ')));
  return { id: issue.id, after: ids };
}

export function cmdList(root, flags) {
  const profile = loadProfile(root);
  let rows = loadIssues(root);
  // A filter names a value the loop knows (the profile's, or one an issue holds already): a value it does not know would
  // list nothing and look like an empty loop.
  const known = (flag, listed, held, value) => {
    const given = flags[flag];
    if (given === undefined || given === true) return;
    const allowed = [...new Set([...listed, ...rows.map(held).filter(Boolean)])];
    need(allowed.includes(String(given)), `--${flag} must be one of: ${allowed.join(', ')} (got "${given}")`, () => ({ flag: `--${flag}`, value }));
  };
  known('status', profile.statuses, (i) => i.status, hole('<status>'));
  known('kind', profile.kinds, (i) => i.kind, hole('<kind>'));
  known('prio', PRIORITIES, (i) => i.priority, hole('<prio>'));
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
    need(at > 0, `--match takes <field=value> (got "${w}")`, () => ({ replace: String(w), value: hole('<field=value>') }));
    const name = String(w).slice(0, at).trim().toLowerCase();
    const known = [...TOOL_FIELDS, 'Kind', 'Tier', ...(profile.tree ? [PARENT_FIELD] : []), ...profile.fields.map((f) => f.name)];
    need(known.some((k) => k.toLowerCase() === name), `--match names a header field — one of: ${known.join(', ')} (got "${name}")`, () => ({ replace: String(w), value: hole('<field=value>') }));
    const value = fieldText(String(w).slice(at + 1));
    rows = rows.filter((i) => (name === 'status' ? i.status : fieldText(i.fields[name])) === value);
  }
  if (flags.grep) {
    const re = new RegExp(flags.grep, 'i');
    rows = rows.filter((i) => re.test(readText(i.file)));
  }
  return treeOrder(rows.sort((a, b) => a.priority.localeCompare(b.priority) || cmpId(a.id, b.id)));
}
// The rows of a list in the order of the tree: each row with no row above it (its nearest listed ancestor) in the order
// given, then the rows under it, depth first, each level in the order given. A row whose parents run in a circle stands on
// its own, so no row is lost. A list with no sub-issue keeps the order given.
function treeOrder(rows) {
  const listed = new Set(rows);
  const under = new Map();
  const top = [];
  for (const r of rows) {
    const above = parentCycle(r) ? undefined : (r.tree ? r.tree.ancestors : []).find((a) => listed.has(a));
    if (above) under.set(above, [...(under.get(above) || []), r]); else top.push(r);
  }
  const out = [];
  const add = (r) => { out.push(r); for (const c of under.get(r) || []) add(c); };
  top.forEach(add);
  return out;
}

// Bulk ids: evidence, review, set, tag and prio take one id or several (see expandIds). Every id is resolved and every
// precondition checked before anything is written, so a call either lands on all of them or on none;
// each issue still gets its own log line.
function issuesFor(root, rawIds, readOnly = false) {
  const keys = expandIds(rawIds);
  const all = loadIssues(root);
  const missing = keys.filter((k) => !all.some((i) => idKey(i.id) === k));
  need(missing.length === 0, `no such issue: ${missing.join(', ')}${askedAs(rawIds, missing)}${keys.length > 1 ? ' — nothing was written' : ''}${listAll()}`, () => ({ replace: itemNaming(rawIds, missing[0]), value: hole('<ids-the-loop-holds>') }));
  const found = keys.map((k) => issueNamed(all, k));
  if (!readOnly && found.some((i) => needsRaisedFormat(i.id))) needFormat(root, 'plain-number');
  return found;
}
// One id in, the same object as always out; a list in, an array of them.
function oneOrMany(rawIds, results) { return isBulk(rawIds) ? results : results[0]; }

// The ready part of a refused move into a closing status, by the cause the gate names: the step that cause asks for, each
// value only its maker knows a placeholder (the command run, the verdict and the reviewer, the sha, the file and the slot);
// an owner line is his to tick, so its step is the question put to him, never his tick; a retraction the log cannot
// place is shown by verify, before the form of the move.
function doneReady(cause, issue) {
  if (issue.byHeader || cause === 'unattributed') return refiled();
  if (cause === 'evidence') return LINE_ROW_READY();
  if (cause === 'lines') return ['jarl.mjs', 'field', hole('<id>'), 'Acceptance', LINE_FORM];
  if (cause === 'approve-standing') return ['jarl.mjs', 'round', hole('<id>'), hole('<what-failed>')];
  if (cause === 'approve') return ['jarl.mjs', 'review', hole('<ids>'), hole('<verdict>'), hole('<what-was-read-and-found>'), '--by', hole('<a-fresh-reviewer>')];
  if (cause === 'clears') return ['jarl.mjs', 'review', hole('<ids>'), hole('<verdict>'), hole('<what-was-read-and-found>'), '--by', hole('<reviewer>')];
  if (cause === 'model') return ['jarl.mjs', 'review', hole('<ids>'), hole('<verdict>'), hole('<what-was-read-and-found>'), '--by', hole('<a-fresh-reviewer>'), '--model', hole('<model-id>')];
  if (cause === 'merge') return ['jarl.mjs', 'merged', hole('<ids>'), '--sha', hole('<sha>')];
  if (cause === 'commit') return LINE_ROW_READY();
  if (cause === 'files') return ['jarl.mjs', 'field', hole('<ids>'), 'Files', hole('<paths>')];
  if (cause === 'slots') return ['jarl.mjs', 'evidence', hole('<id>'), '--file', hole('<path>'), '--slot', hole('<slot>')];
  if (cause === 'owner') return ['jarl.mjs', 'ask', hole('<question-for-the-owner>'), '--issue', hole('<id>')];
  if (cause === 'owner-rewrite') return ['jarl.mjs', 'field', hole('<ids>'), 'Acceptance', hole('<the-whole-section>')];
  if (cause === 'retraction') return [{ first: ['jarl.mjs', 'verify'] }, { retry: true }];
  if (cause === 'subs') return [{ first: ['jarl.mjs', 'show', issue.id] }, { retry: true }];
  return { arg: 1, value: hole('<a-status-the-gate-allows>') };
}
// The ready part for an issue whose number the log files twice, which is never closed, approved or merged: the work filed
// again, and the call on the number new prints.
export function refiled() { return [{ first: ['jarl.mjs', 'new', '<the-title-filed-again>'] }, { arg: 0, value: '<the-id-new-prints>' }]; }
// A refusal of a call on several ids says nothing was written, before the ready command it ends with.
export function nothingWritten(message) { return typeof message === 'string' ? `${message} — nothing was written` : message; }
// A command that writes one issue at a time (files, repo, after, body, round, source) takes the list grammar too: `run(id,
// dry)` does one issue's work and writes nothing when `dry` is true. Every id is resolved and run dry before the first
// one is written, so a list lands on every id or on none; one id is run as it stands, with no pass before it.
export function eachIssue(root, rawIds, run) {
  if (!isBulk(rawIds)) return run(rawIds, false);
  const keys = expandIds(rawIds);
  const all = loadIssues(root);
  const missing = keys.filter((k) => !all.some((i) => idKey(i.id) === k));
  need(missing.length === 0, `no such issue: ${missing.join(', ')}${askedAs(rawIds, missing)} — nothing was written${listAll()}`, () => ({ replace: itemNaming(rawIds, missing[0]), value: hole('<ids-the-loop-holds>') }));
  const ids = keys.map((k) => issueNamed(all, k).id);
  inCall(() => {
    for (const id of ids) {
      resetCaches();
      try { run(id, true); } catch (e) { if (!(e instanceof Refusal)) throw e; refuse(/nothing was written/.test(e.reason) ? e.reason : nothingWritten(e.reason), e.ready); }
    }
  });
  return ids.map((id) => { resetCaches(); return run(id, false); });
}
// What the issues of the call checked so far would hold once written, as { files, resources } by issue id, while a call over
// several issues checks them all before writing any; null outside such a check. A later issue of the call is checked against
// the lease of an earlier one as it will stand, so a call that would make two leases collide is refused whole.
let declaredInCall = null;
function inCall(check) {
  const outer = declaredInCall;
  declaredInCall = outer ?? new Map();
  try { check(); } finally { declaredInCall = outer; }
}

// The refusal for a move into a needs-reason status given without one; the built-in two say what the status is for.
const REASON_TEXT = {
  dropped: () => `dropped needs a reason: ${jarlLine('set', '<id>', 'dropped', '<text>')}`,
  deferred: () => `deferred needs a reason: ${jarlLine('set', '<id>', 'deferred', '<text>')} — work that waits, not work that is gone`,
};
// The line a needs-reason status writes under Evidence: its name with a capital, then the reason (Dropped: …).
export function reasonWord(status) { return status.charAt(0).toUpperCase() + status.slice(1); }

// Who asked for the move: 'cli' — the command line and the MCP tools over it, which always say so — or 'record', a
// library call through record.mjs (the default). A status the profile marks "set-by": "record" refuses 'cli'.
export const SET_CALLERS = ['cli', 'record'];

// Where `set <ids> <name> …` goes, decided here and nowhere else: a field the profile declares (Kind and Tier too, when it
// declares them) and that is no status, the built-in Resources field, another header field of the tool's own (field
// writes it), or a move into a status.
function setRoute(profile, name) {
  if (name === undefined || profile.statuses.includes(name)) return 'status';
  if (profile.field(name)) return 'field';
  if (String(name).toLowerCase() === 'resources') return 'resources';
  return fieldsWritten(profile).some((f) => f.toLowerCase() === String(name).trim().toLowerCase()) ? 'own' : 'status';
}
// What a name given to set is: 'status', or 'field' (a field the profile declares, a header field of the tool's own, or
// the built-in Resources).
export function setRouteOf(root, name) { return setRoute(loadProfile(root), name) === 'status' ? 'status' : 'field'; }

// The header fields of the tool's own that hold a list, each item one name or path: field adds and removes items of these.
const LIST_KEYS = ['tags', 'files', 'repo', 'after', 'source', 'resources'];
// The sections of the description field writes, as their headings: What, Why, the acceptance (under the heading the
// profile gives it), Changelog and the sections the profile declares.
function sectionsOf(profile) {
  return [...new Set(['What', 'Why', 'Acceptance', ...(profile.acceptance ? [profile.acceptance] : []), 'Changelog', ...profile.sections])];
}
// The header fields of the tool's own that field writes in this loop. Person and Check when are the tool's own where the
// built-in promise and wait hold, and a declared field's otherwise; so is Parent where the issues form a tree.
function fieldsWritten(profile) {
  return DESCRIPTION_FIELDS.filter((f) => (profile.kept || !['person', 'check when'].includes(f.toLowerCase())) && (profile.tree || f !== PARENT_FIELD));
}
// The one mode a field call writes in: set (a value alone), add, remove or clear.
function fieldMode(flags) {
  const given = ['add', 'remove', 'clear'].filter((k) => flags[k] === true);
  need(given.length <= 1, `field takes one of --add, --remove and --clear, not ${given.map((k) => `--${k}`).join(' and ')}: run one call for each`, () => ([...given.map((k) => ({ drop: `--${k}` })), { flag: hole('<no-flag-here>') }]));
  return given[0] ?? 'set';
}

// field <ids> <name> ["<value>"] [--add | --remove | --clear]: one part of the description written on every issue — a
// header field of the tool's own, a field the profile declares, or a section. A value alone replaces what the part holds;
// --add adds the items of a list field, or the text after what a section holds; --remove takes the items off a list field;
// --clear empties an optional part. A part is emptied with clear and never with an empty value.
export function cmdField(root, rawIds, name, value, flags = {}) {
  needNoOwnersWords('the field', value);
  const profile = loadProfile(root);
  const writes = fieldsWritten(profile);
  const sections = sectionsOf(profile);
  const writable = () => [...writes, ...profile.fields.map((f) => f.name), ...sections].join(', ');
  need(name !== undefined && String(name).trim() !== '', `field requires <name>, a part of the description: ${writable()} — e.g. ${jarlLine('field', '<ids>', 'Priority', '<prio>')}`, () => ({ arg: 1, value: '<a-part-of-the-description>' }));
  editorOf(flags.by);
  const key = String(name).trim().toLowerCase();
  const mode = fieldMode(flags);
  const clear = mode === 'clear';
  const section = profile.field(name) ? undefined : sections.find((s) => s.toLowerCase() === key);
  need(section !== undefined || setRoute(profile, name) !== 'status' || writes.some((f) => f.toLowerCase() === key), `${name} is not a part of the description, which field writes: ${writable()}; ${notWrittenByField(profile, key)}`, () => ({ arg: 1, value: hole('<a-part-of-the-description>') }));
  need(!clear || value === undefined, `field takes either a value or --clear, not both (got ${JSON.stringify(String(value))} and --clear)`, () => ([{ drop: '--clear' }, { arg: 2, value: hole('<value>') }]));
  need(clear || (value !== undefined && String(value).trim() !== ''), `field ${name} needs a value, or --clear to empty it`, () => ({ arg: 2, value: '<value>' }));
  if (section !== undefined) return writeSection(root, rawIds, section, clear ? '' : value, mode, flags);
  if (mode === 'add' || mode === 'remove') {
    const list = LIST_KEYS.find((k) => k === key);
    need(list, `${name} holds one value, so it is replaced, never added to or taken from (got ${JSON.stringify(String(value ?? ''))}); --add and --remove take the items of ${LIST_KEYS.map((k) => (k === 'repo' ? 'Repo' : k.charAt(0).toUpperCase() + k.slice(1))).join(', ')}, and --add the text of a section`, () => ([{ drop: '--add' }, { drop: '--remove' }, { arg: 2, value: hole('<the-whole-new-value>') }]));
    return editList(root, rawIds, list, value, mode, flags);
  }
  if (profile.field(name)) return setDeclaredField(root, rawIds, profile.field(name), clear ? '' : value, flags);
  if (key === 'resources') return setResources(root, rawIds, clear ? '' : value, flags);
  const own = EMPTIED_BY_FIELD[key];
  if (own && clear) return emptyOwnField(root, rawIds, own, flags);
  const one = (results, field) => { const list = [].concat(results).map((o) => ({ id: o.id, field, value: fieldText(readFieldOf(root, o.id, field)), ...(o.notes?.length ? { notes: o.notes } : {}) })); return isBulk(rawIds) ? list : list[0]; };
  switch (key) {
    case 'title': need(!clear, 'Title cannot be emptied with --clear: a value replaces it', [{ drop: '--clear' }, { arg: 2, value: '<title>' }]); return one(eachIssue(root, rawIds, (id, dry) => cmdBody(root, id, { title: value, by: flags.by }, dry)), 'Title');
    case 'where': return one(eachIssue(root, rawIds, (id, dry) => cmdBody(root, id, { where: value, by: flags.by }, dry)), 'Where');
    case 'files': return one(eachIssue(root, rawIds, (id, dry) => cmdFiles(root, id, value, dry, flags.by)), 'Files');
    case 'source': return one(eachIssue(root, rawIds, (id, dry) => cmdSource(root, id, value, dry, flags.by)), 'Source');
    case 'after': return one(eachIssue(root, rawIds, (id, dry) => cmdAfter(root, id, value, { dry, by: flags.by })), 'After');
    case 'repo': return one(eachIssue(root, rawIds, (id, dry) => cmdRepo(root, id, value, { dry, by: flags.by })), 'Repo');
    case 'tags': return one(cmdTagList(root, rawIds, value, flags.by), 'Tags');
    case 'parent': return setParent(root, rawIds, clear ? '' : value, flags);
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
// merge is recorded by merged, and the history has no edit.
function notWrittenByField(profile, key) {
  if (key === 'status' || profile.statuses.includes(key)) return `a status is moved by set: ${jarlLine('set', '<ids>', '<status>', '<text>')}`;
  if (['branch', 'worker', 'model', 'since', 'worktree'].includes(key)) return `the lease (Branch, Worker, Model, Since) is written by set: ${jarlLine('set', '<ids>', 'in-progress', '<text>', '--branch', '<worker-branch>', '--worker', '<name>')}`;
  if (['merged', 'merge check', 'ci'].includes(key)) return `a merge and its CI are recorded by merged: ${jarlLine('merged', '<ids>', '--sha', '<sha>')}`;
  if (['notes', 'proof'].includes(key)) return `a note or a row of proof is added by evidence: ${jarlLine('evidence', '<ids>', '<text>')}, or ${jarlLine('evidence', '<ids>', '--ran', '<command>', '--saw', '<what-it-printed>', '--line', '<line-number>', '--by', '<who>')}`;
  if (key === 'evidence' || key === 'reviews') return `the history is never edited: a note or a row is added by evidence and a verdict by review, a row or an approve is taken back by retract, a ruling replaced by decide --supersedes: ${jarlLine('retract', '<id>', '<n>', '--by', '<who>', '<text>')}`;
  return `no other part goes by that name: a field or a section the loop's profile declares is among the names above, and the profile lists them: ${jarlLine('profile')}`;
}

// extend section "<name>" | extend field "<name>" [--values <a,b>] [--default <value>] [--required]: the profile of a live
// loop gains one section or one field, checked as profile <file> checks a profile file, with a log line after it. A
// loop with no profile of its own gets one: the built-in statuses and the part, in the record format the loop is in. The
// issues already filed are not rewritten: each carries the part once field writes it, and a new issue is filed with it (a
// field's default, when it has one and none is given). Kind and Tier keep the values the loop was opened with. The profile
// of a loop a composer runs is the composer's, and is never changed here.
export function cmdExtend(root, part, name, flags = {}) {
  needLiveLoop(root, '');
  const profile = loadProfile(root);
  const kept = LIFECYCLE_OPS.some((op) => profile.lifecycle[op] === 'record');
  if (profile.scheduler !== null || kept) refuse(`this loop is run by a composer (its profile, ${profile.name}, ${profile.scheduler !== null ? 'names an external scheduler' : 'keeps its lifecycle to the record'}), and its profile is the composer's: extend changes nothing in it — nothing was written`, profile.scheduler ?? profile.lifecycle.command ? { external: profile.scheduler ?? profile.lifecycle.command } : afterView(['jarl.mjs', 'profile']));
  const kind = String(part ?? '').trim().toLowerCase();
  need(kind === 'section' || kind === 'field', `extend adds a section or a field to the loop's profile (got ${JSON.stringify(String(part ?? ''))})`, () => ({ arg: 0, value: hole('<section-or-field>') }));
  const label = typeof name === 'string' ? name.trim() : '';
  need(label, `extend ${kind} needs the name of the ${kind}`, () => ({ arg: 1, value: hole('<name>') }));
  const fieldFlags = ['values', 'default', 'required'].filter((k) => flags[k] !== undefined);
  need(kind === 'field' || !fieldFlags.length, `--${fieldFlags[0]} goes with a field, not with a section`, () => fieldFlags.map((k) => ({ drop: `--${k}` })));
  need(!['kind', 'tier'].includes(label.toLowerCase()), `${label} is built in, and its values are the ones the loop was opened with: extend adds a field of the loop's own`, () => ({ arg: 1, value: hole('<name>') }));
  const held = kind === 'section' ? sectionsOf(profile).some((s) => s.toLowerCase() === label.toLowerCase()) : profile.declaredFields.some((f) => f.key === label.toLowerCase());
  need(!held, `the profile already declares the ${kind} ${label}: ${jarlLine('profile')}`, () => ({ arg: 1, value: hole('<name>') }));
  // A field and a section never share a name: the field command would not know which one it writes.
  const other = kind === 'section' ? profile.declaredFields.find((f) => f.key === label.toLowerCase())?.name : sectionsOf(profile).find((s) => s.toLowerCase() === label.toLowerCase());
  need(!other, `the profile already declares ${other} as a ${kind === 'section' ? 'field' : 'section'}, and a field and a section never share a name: ${jarlLine('profile')}`, () => ({ arg: 1, value: hole('<name>') }));
  const spec = kind === 'field' ? { ...(flags.values !== undefined ? { enum: splitList(flags.values) } : {}), ...(flags.default !== undefined ? { default: String(flags.default) } : {}), ...(flags.required === true ? { required: true } : {}) } : null;
  // The profile as it would be: checked whole before anything is written.
  const extended = () => {
    const raw = existsSync(profilePath(root)) ? JSON.parse(readText(profilePath(root))) : null;
    const base = raw && loadProfile(root).declared ? raw : { 'jarl-profile': PROFILE_VERSION, ...(raw && raw.format !== undefined ? { format: raw.format } : {}), statuses: BUILTIN_STATUSES, initial: 'open' };
    const json = kind === 'section' ? { ...base, sections: [...(base.sections || []), label] } : { ...base, fields: { ...(base.fields || {}), [label]: spec } };
    try { return { json, profile: validateProfile(json, `the profile with the ${kind} ${label}`) }; } catch (e) { if (e instanceof Refusal) refuse(e.reason, { retry: true }); throw e; }
  };
  extended();
  const reserved = reservedProblem(validateProfile({ 'jarl-profile': PROFILE_VERSION, statuses: BUILTIN_STATUSES, ...(kind === 'section' ? { sections: [label] } : { fields: { [label]: spec } }) }));
  need(!reserved, `the ${kind} ${label} is not added: ${reserved}`, () => ({ arg: 1, value: hole('<name>') }));
  const words = kind === 'section' ? `section ${label}` : `field ${label}${[spec.enum && `values ${spec.enum.join(', ')}`, spec.default && `default ${spec.default}`, spec.required && 'required'].filter(Boolean).map((w) => `; ${w}`).join('').replace(/^; /, ': ')}`;
  // The raise the call's writer needs comes first, and rewrites the profile: the part is added to the profile as the raise
  // left it, and the log line follows the profile, so a profile that could not be written leaves no line behind.
  writerRaised(root);
  const next = extended();
  writeAtomic(profilePath(root), `${JSON.stringify(next.json, null, 2)}\n`);
  forgetProfile(root);
  appendLog(root, `profile extended · ${noSeparators(words)}`);
  return { part: kind, name: label, ...(spec ? { spec } : {}), profile: describeProfile(next.profile) };
}

// field <ids> <section> "<text>": a section of the description, as body writes it, with the body line it logs. A value
// replaces what the section holds; --add puts it after that (a list of lines, Acceptance and Changelog, gains its lines; a
// text, its paragraph); --clear empties the section. Acceptance and Changelog take one line per item, so a value of several
// lines is several items. A section holds text, so --remove has nothing to take items from.
function writeSection(root, rawIds, heading, value, mode, flags) {
  need(mode !== 'remove', `a section holds text, not items, so --remove takes nothing off it (got ${JSON.stringify(String(value ?? ''))}): write it whole with ${jarlLine('field', '<ids>', String(heading).trim(), '<text>')}, or add to it with --add`, () => ([{ drop: '--remove' }, { arg: 2, value: hole('<the-whole-section>') }]));
  const profile = loadProfile(root);
  const key = heading.toLowerCase();
  const lines = (v) => String(v ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim().replace(/^-\s+/, '')).filter(Boolean);
  const isAcceptance = key === 'acceptance' || (profile.acceptance && key === profile.acceptance.toLowerCase());
  const opts = isAcceptance ? { acceptance: lines(value) } : key === 'changelog' ? { changelog: lines(value) } : key === 'what' || key === 'why' ? { [key]: value } : { section: [`${heading}=${value}`] };
  const results = [].concat(eachIssue(root, rawIds, (id, dry) => cmdBody(root, id, { ...opts, by: flags.by, append: mode === 'add', caller: flags.caller }, dry)));
  const out = results.map((o) => ({ id: o.id, field: heading, value: fieldText(sectionOf(root, o.id, heading)), ...(o.grew ? { grew: o.grew } : {}), ...(o.note ? { note: o.note } : {}) }));
  return isBulk(rawIds) ? out : out[0];
}
// What a section of an issue holds in its file now, read again after a write.
function sectionOf(root, id, heading) { return findIssue(root, id).sections[heading.toLowerCase()] ?? ''; }

// field <ids> <list field> "<items>" --add | --remove: the items added to what each issue holds (each item once, in the
// order held, then the new ones), or taken off it; an item an issue does not hold is not there to take. Each issue is
// written by the same writer as a replacement, so the line it logs is the one a replacement logs, and a list emptied by
// --remove is emptied as --clear empties it. Tags go through tag's own operations: a slice: tag keeps its one-slice rule,
// and a slice tag is taken off in any case.
function editList(root, rawIds, key, value, mode, flags) {
  const name = { tags: 'Tags', files: 'Files', repo: 'Repo', after: 'After', source: 'Source', resources: 'Resources' }[key];
  const items = splitList(value);
  need(items.length, `field ${name} --${mode} needs the items`, () => ({ arg: 2, value: '<items>' }));
  if (key === 'tags') {
    const done = cmdTag(root, rawIds, items.map((t) => `${mode === 'add' ? '+' : '-'}${t}`), flags.by);
    const list = [].concat(done).map((o) => ({ id: o.id, field: name, value: o.tags.join(', ') }));
    return isBulk(rawIds) ? list : list[0];
  }
  // Two spellings of one item are one item: a repository by name or by path, an id with or without its leading zeros, a
  // resource in any case.
  // An item added is written as the field stores it (a repository as its name or its path), and one the issue holds
  // already, in any spelling of it, is not added again.
  const adds = mode !== 'add' ? [] : key === 'repo' ? repoList(root, items.join(',')).map((p) => p.value) : items;
  const sameItem = (a, b) => (key === 'after' ? idKey(a) === idKey(b) : key === 'resources' ? a.toLowerCase() === b.toLowerCase() : key === 'files' ? normalPath(a) === normalPath(b) : a === b);
  const removes = mode !== 'remove' ? null : (() => {
    if (key === 'repo') {
      let picked = [];
      try { picked = repoList(root, items.join(',')).map((p) => p.value); } catch { picked = []; }
      return (x) => items.includes(x) || picked.includes(x);
    }
    if (key === 'after') { const keys = items.map((x) => idKey(x)); return (x) => keys.includes(idKey(x)); }
    if (key === 'resources') { const low = items.map((x) => x.toLowerCase()); return (x) => low.includes(x.toLowerCase()); }
    if (key === 'files') { const same = items.map((x) => normalPath(x)); return (x) => same.includes(normalPath(x)); }
    return (x) => items.includes(x);
  })();
  const results = [].concat(eachIssue(root, rawIds, (id, dry) => {
    const issue = findIssue(root, id);
    need(issue, `no such issue: ${id}${listAll()}`, () => ({ replace: id, value: '<id>' }));
    const held = splitList(issue.fields[key]);
    const next = mode === 'add' ? [...held, ...adds.filter((x, n) => !held.some((h) => sameItem(h, x)) && !adds.slice(0, n).some((y) => sameItem(y, x)))] : held.filter((x) => !removes(x));
    if (next.length === 0) {
      if (held.length === 0) return { id: issue.id };
      if (dry) return { id: issue.id };
      return emptyListField(root, issue.id, name, flags);
    }
    const text = next.join(', ');
    if (dry) {
      if (key === 'files') cmdFiles(root, issue.id, text, true, flags.by);
      else if (key === 'source') cmdSource(root, issue.id, text, true, flags.by);
      else if (key === 'after') cmdAfter(root, issue.id, text, { dry: true, by: flags.by });
      else if (key === 'repo') cmdRepo(root, issue.id, text, { dry: true, by: flags.by });
      else needFreeOfOtherLeases(root, issue, [], resourceNames(text).filter((n) => !issue.resources.some((r) => r.toLowerCase() === n.toLowerCase())), { resources: resourceNames(text) });
      return { id: issue.id };
    }
    if (key === 'files') return cmdFiles(root, issue.id, text, false, flags.by);
    if (key === 'source') return cmdSource(root, issue.id, text, false, flags.by);
    if (key === 'after') return cmdAfter(root, issue.id, text, { by: flags.by });
    if (key === 'repo') return cmdRepo(root, issue.id, text, { by: flags.by });
    return setResources(root, issue.id, text, flags);
  })).map((o) => ({ id: o.id, field: name, value: fieldText(findIssue(root, o.id).fields[key]), ...(o.notes?.length ? { notes: o.notes } : {}) }));
  return isBulk(rawIds) ? results : results[0];
}
// A list field emptied by --remove, as --clear empties it.
function emptyListField(root, id, name, flags) {
  if (name === 'Resources') return setResources(root, id, '', flags);
  return emptyOwnField(root, id, name, flags);
}
// The lease flags (--branch, --worker, --model, --worktree) a call gives. They belong to a move into a status that holds
// a claim; a call that writes a field refuses them.
const LEASE_FLAGS = ['branch', 'worker', 'model', 'worktree'];
function leaseFlagsGiven(flags) { return LEASE_FLAGS.filter((k) => flags[k] !== undefined); }
function needNoLeaseFlags(flags, what) {
  const lease = [...leaseFlagsGiven(flags), ...(flags.handover !== undefined ? ['handover'] : [])];
  need(!lease.length, `--${lease[0]} goes with a status, not with ${what}`, () => ({ rename: `--${lease[0]}`, to: hole('<no-flag-here>') }));
}
// set with the name taken as a status (record.setStatus), or as a field the profile declares (record.setField): the
// refusal of a name that is the other kind, in the command line's own words.
export function cmdSetStatus(root, rawIds, status, why, flags = {}) {
  const profile = loadProfile(root);
  need(profile.statuses.includes(status) || !profile.field(status), `${status} is a field this loop's profile declares, not a status — setField writes it`, () => (['jarl.mjs', 'field', rawIds ?? '<ids>', status, why ?? '<value>']));
  return cmdSet(root, rawIds, status, why, flags);
}
// The tool's own header fields a library caller also writes by name, as field writes them, with the writer flags.by names.
const LIBRARY_OWN_FIELDS = ['tags', 'priority', 'files', 'source'];
export function cmdSetField(root, rawIds, field, value, flags = {}) {
  const profile = loadProfile(root);
  if (!profile.field(field) && LIBRARY_OWN_FIELDS.includes(String(field ?? '').trim().toLowerCase())) return cmdField(root, rawIds, field, value, { by: flags.by });
  need(profile.field(field) && !profile.statuses.includes(field), `${field} is not a field this loop's profile declares${profile.declaredFields.length ? ` — it declares ${profile.declaredFields.map((f) => f.name).join(', ')}` : ''}`, () => (['jarl.mjs', 'set', '<ids>', '<status>', '<text>']));
  return cmdSet(root, rawIds, field, value, flags);
}

export function cmdSet(root, rawIds, status, why, flags = {}) {
  needNoOwnersWords('the move', why, flags);
  const caller = flags.caller ?? 'record';
  need(SET_CALLERS.includes(caller), `caller must be one of: ${SET_CALLERS.join(', ')} (got "${caller}")`, () => (['jarl.mjs', 'set', '<ids>', '<status>', '<text>']));
  const profile = loadProfile(root);
  const route = setRoute(profile, status);
  need(route !== 'own', `${String(status).trim()} is a field, not a status: field writes it`, () => (['jarl.mjs', 'field', hole('<ids>'), String(status).trim(), hole('<value>')]));
  if (route === 'field') return setDeclaredField(root, rawIds, profile.field(status), why, flags);
  if (route === 'resources') return setResources(root, rawIds, why, flags);
  if (flags.header) return rewriteHeader(root, rawIds, status, why, flags);
  // ready and the review words are views, not statuses: say which view answers the question the worker was asking.
  need(profile.statuses.includes(status) || !/^(ready|review|in[-_ ]?review|ready[-_ ]for[-_ ]review|reviewing)$/i.test(String(status ?? '')), `${status} is a view here, not a status: next lists the issues ready to start, and status and resume mark each in-flight issue with what the record says (no evidence rows yet; rows and no verdict, so it waits for a reviewer; changes requested; approved and queued). Nothing needs setting: record the rows with evidence, and the reviewer's verdict with review. A loop that wants an explicit review status can declare one in its profile. Statuses here: ${profile.statuses.join(', ')}; the issues ready to start: ${jarlLine('next')}`, () => ({ arg: 1, value: hole('<status>') }));
  need(profile.statuses.includes(status), `status must be one of: ${profile.statuses.join(', ')} (got "${status}")`, () => [...(rawIds === undefined ? [{ arg: 0, value: '<ids>' }] : []), { arg: 1, value: hole('<status>') }]);
  need(caller !== 'cli' || profile.setBy(status) !== 'record', `${status} is set by the record only — this loop's profile (${profile.name}) marks it "set-by": "record", so jarl set and the MCP tools cannot move an issue into it; the tool that runs the loop does${profile.scheduler ? ` (${profile.scheduler})` : ''}`, () => ({ arg: 1, value: hole('<status>') }));
  const holds = profile.is(status, 'holds-claim');
  const lease = leaseFlagsGiven(flags);
  need(!lease.length || holds, `--${lease[0]} goes with ${profile.with('holds-claim').join(' or ')} only, not with ${status} — it records who works on the issue and where`, () => ({ arg: 1, value: hole('<status>') }));
  need(flags.handover === undefined || typeof flags.handover === 'boolean', '--handover takes no value: the reason it is logged with is the move\'s own "<text>"', () => ({ rename: '--handover', to: hole('<no-flag-here>') }));
  const handover = flags.handover === true;
  need(!handover || holds, `--handover goes with ${profile.with('holds-claim').join(' or ')} only, not with ${status} — it hands a lease to a new worker or branch`, () => ({ arg: 1, value: hole('<status>') }));
  for (const k of lease) need(typeof flags[k] === 'string' && fieldText(flags[k]), `--${k} needs a value`, () => ({ flag: `--${k}`, value: hole('<value>') }));
  const model = flags.model !== undefined ? modelValue(flags.model) : undefined;
  // A name is one value: with the log's own separator in it, the lease line would carry a field the caller did not give.
  for (const k of ['worker', 'branch']) need(flags[k] === undefined || !` ${fieldText(flags[k])} `.includes(' · '), `--${k} is one name — not a phrase with " · " in it (got "${fieldText(flags[k])}")`, () => ({ flag: `--${k}`, value: hole('<one-name>') }));
  // What is written into the lease is what the journal gives back unchanged: a value the reader would take for something else is refused.
  for (const k of lease) { const problem = leaseValueProblem(k, flags[k]); need(!problem, `--${k} ${JSON.stringify(fieldText(flags[k]))} ${problem}`, () => ({ flag: `--${k}`, value: hole('<value>') })); }
  const issues = issuesFor(root, rawIds);
  need(!profile.is(status, 'needs-reason') || fieldText(why ?? ''), REASON_TEXT[status]?.() || `${status} needs a reason: ${jarlLine('set', '<id>', status, '<text>')}`, () => ({ arg: 2, value: '<text>' }));
  const nothing = issues.length > 1 ? ' — nothing was written' : '';
  needTreeHolds(profile, issues, status, nothing);
  if (holds) needLeaseHolds(root, profile, issues, status, why, flags, handover, nothing);
  // An issue worked in place is leased with no branch, on the files it declares, which keep two such issues apart.
  for (const issue of holds ? issues.filter((i) => worksInPlace(profile, i)) : []) {
    const given = ['branch', 'worktree'].filter((k) => flags[k] !== undefined);
    need(!given.length, `${issue.id} is worked in place: its worker writes the files it declares in the checkout of their repository, as it is checked out, with no branch and no worktree of its own${nothing}`, () => given.map((k) => ({ drop: `--${k}` })));
    need(issue.files.length, `${issue.id} is worked in place and declares no files: it names the files it writes before it is leased, so that next keeps two issues off one file${nothing}`, () => ['jarl.mjs', 'field', issue.id, 'Files', hole('<paths>')]);
  }
  // base: the branch the composer landed the merge into, for the done gate's requires-merged (else the branch checked
  // out). A library call only: the command line has no --base, and dispatch never passes one through.
  need(flags.base === undefined || caller === 'record', 'base is named by a library call through record.mjs only — the command line checks against the branch checked out', () => ({ rename: '--base', to: hole('<no-flag-here>') }));
  need(flags.base === undefined || (typeof flags.base === 'string' && fieldText(flags.base) !== '' && !flags.base.startsWith('-')), 'base names a branch or ref — the one the merge landed in', () => ({ rename: '--base', to: hole('<no-flag-here>') }));
  if (profile.is(status, 'closes-record')) {
    for (const issue of issues) { const refusal = unattributedRefusal(issue, `moved → ${status}`); need(!refusal, nothing ? nothingWritten(refusal) : refusal, () => (doneReady('unattributed', issue))); }
    const loop = readLoop(jarlDir(root));
    for (const issue of issues) { const gate = doneGateIn(root, loop, issue, flags.base); need(!gate, nothing ? nothingWritten(gate?.text) : gate?.text, () => (doneReady(gate.cause, issue))); }
  }
  // One lease for the whole call: every issue in a package gets the same Branch, Worker and Since. A lease records no
  // worktree: git allows a branch in at most one worktree, so the worktree of a lease is found through its branch. On the
  // command line and in the tools --worktree is a check (a relative path is read from the loop's root, like --repo): a
  // path that exists must be a worktree of a repository of the issue with the lease's branch checked out. The record
  // library accepts the key and stores nothing.
  const since = stamp();
  if (holds && flags.worktree !== undefined && caller === 'cli') for (const issue of issues) needWorktreeOfLease(root, issue, flags.branch !== undefined ? fieldText(flags.branch) : fieldText(issue.fields.branch), resolve(root, fieldText(flags.worktree)));
  // Each issue's change is applied to its file as it stands after the log line: the call's first line may raise the record
  // format (its --by), and a raise from format 1 writes every bare Repo path of the loop again, this issue's too.
  const writes = issues.map((issue) => ({ issue, edit: (read) => {
    let text = setField(read, 'Status', status);
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
    const notes = profile.is(status, 'needs-reason') ? [[`${reasonWord(status)}: `, why]] : [];
    if (notes.length) {
      const evidence = notes.reduce((written, [head, said]) => placeEvidence(written, 'note', `${head}${noteText(said, written)}`, '\n\n'), (issue.sections.evidence || '').trim());
      text = setSection(text, 'Evidence', evidence);
    }
    return text;
  } }));
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
  // A move that closes the record is followed by the tip the close was judged on: the tip of the issue's branch, or, where
  // the branch is gone (a merge's cleanup deletes it), the tip its merge was recorded on, else the tip its counted waiver,
  // row or approve was made on, and none where nothing gives one; never the commit the merge names. The gate of the
  // closed issue is read against it whatever the branch does after, a branch of the same name made again included.
  const closes = profile.is(status, 'closes-record');
  const judged = closes ? readLoop(jarlDir(root)) : null;
  const closeTip = closes ? tipLinesOf(root, issues, (issue) => gateOf(judged, issue.id).closingTip()) : () => [];
  appendLogLines(root, issues.flatMap((issue) => [`${issue.id} → ${status}${reason ? ` · ${reason}` : ''}${leaseNote ? ` · ${leaseNote}` : ''}`, ...closeTip(issue)]), since);
  // The lines that remember the offer are written for every caller; its text is the command line's answer alone.
  const offered = holds && leaseNote ? modelOfferAtLease(root, model) : null;
  const modelOffer = caller === 'cli' ? offered : null;
  for (const w of writes) writeAtomic(w.issue.file, w.edit(readText(w.issue.file)));
  // Said on the command line only, and only in a loop that declares model lines: a lease with no model (once per call).
  const leaseNoModel = caller === 'cli' && holds && model === undefined && modelLines(root).declared ? 'no --model on this lease — the loop declares its models, and a model that is not recorded can never be recovered' : null;
  const worktreeNote = caller === 'cli' && holds && flags.worktree !== undefined ? '--worktree was checked and is not recorded — the worktree of a lease is found through its branch' : null;
  const limit = caller === 'cli' && holds ? limitNote(root, model) : null;
  // Each note is a line of its own: the command line prints every line after the issue's id, which is the subject the
  // offer reads after, whichever note comes before it.
  const leaseNotes = [leaseNoModel, worktreeNote, spelling, limit, modelOffer].filter(Boolean).join('\n');
  return oneOrMany(rawIds, issues.map((issue, n) => ({ id: issue.id, status, ...(handover ? { handover: true } : {}), ...(holds ? { since, ...(flags.branch !== undefined ? { branch: fieldText(flags.branch) } : {}), ...(flags.worker !== undefined ? { worker: fieldText(flags.worker) } : {}), ...(model !== undefined ? { model } : {}) } : {}), ...(profile.is(status, 'closes-record') ? doneNote(issue, root) : {}), ...(leaseNotes && n === 0 ? { note: leaseNotes } : {}) })));
}

// The tree holds through a move, so no unfinished issue sits under a finished one. An issue moved into a finished status
// (terminal) takes its unfinished sub-issues along in the same call, a drop or a deferral of the whole; a move into the
// status that closes the record waits instead in the done gate, for every sub-issue settled and the parent's own check.
// An issue moved back into play is not under a finished issue, unless that one moves back into play in the same call.
function needTreeHolds(profile, issues, status, nothing) {
  const moving = new Set(issues.map((i) => i.id));
  const form = () => ({ arg: 0, value: hole('<ids>') });
  if (profile.is(status, 'terminal')) {
    if (profile.is(status, 'closes-record')) return;
    for (const issue of issues) {
      const left = (issue.tree ? issue.tree.children : []).filter((c) => profile.unfinished(c.status) && !moving.has(c.id));
      need(!left.length, `${issue.id} has sub-issues not finished: ${left.map((c) => `${c.id} (${c.status})`).join(', ')} — an issue goes ${status} with its sub-issues, so name them in the same call, or finish them first${nothing}`, form);
    }
    return;
  }
  for (const issue of issues) {
    const above = (issue.tree ? issue.tree.ancestors : []).find((a) => profile.is(a.status, 'terminal') && !moving.has(a.id));
    need(!above, `${issue.id} is under ${above?.id}, which is ${above?.status}: an issue is in play only under issues in play, so move ${above?.id} back into play in the same call, or first${nothing}`, form);
  }
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
  const leaseFlags = ['branch', 'model', 'worker'].filter((k) => named(k) !== null).flatMap((k) => [`--${k}`, named(k)]);
  const taken = new Set(issues.map((i) => i.id));
  const leased = (i) => profile.is(i.status, 'holds-claim') && Boolean(i.fields.worker || i.fields.branch);
  // Another holder named by the call: a worker or a branch other than the one the lease already names.
  const replaces = (i) => ['worker', 'branch'].some((k) => named(k) !== null && i.fields[k] && named(k) !== fieldText(i.fields[k]));
  if (handover) need(why, `--handover says why the work changes hands: ${jarlLine('set', issues.map((i) => i.id).join(','), status, '<why-the-worker-changed>', ...leaseFlags, '--handover')}`, () => ({ arg: 2, value: '<why-the-worker-changed>' }));
  // A worker raised on an issue with no line has nothing to prove and a reviewer nothing to check it against.
  for (const issue of issues) need(acceptanceLineCount(issue) > 0, `${issue.id} has no acceptance line, so a lease would hold a worker to nothing that can be proved — every issue carries at least one line before it is leased${nothing}`, () => ['jarl.mjs', 'field', hole('<id>'), 'Acceptance', LINE_FORM]);
  for (const issue of issues) {
    if (handover) {
      need(leased(issue), `${issue.id} holds no lease to hand over${nothing} — lease it without --handover: ${jarlLine('set', issue.id, status, '<text>', ...leaseFlags)}`, () => ({ rename: '--handover', to: hole('<no-flag-here>') }));
      // A lease the log holds twice is settled by a handover to either of its two holders, the one the issue's header already names too.
      need(replaces(issue) || ((named('worker') !== null || named('branch') !== null) && leaseConflictOf(readLoop(jarlDir(root)), issue) !== null), `--handover names the lease ${issue.id} already has (${holderText(issue)}) — a handover names the new --worker or --branch${nothing}`, () => ({ flag: '--worker', value: '<the-new-worker>' }));
    } else if (!composed) {
      need(!(leased(issue) && replaces(issue)), `${issue.id} is leased already (${holderText(issue)}) — a second lease would replace it in silence, and ${fieldText(issue.fields.worker) || 'its worker'} would go on working on a branch the record does not name; when the work changes hands, say why: ${jarlLine('set', issue.id, status, '<why-the-worker-changed>', ...leaseFlags, '--handover')}${nothing}`, () => ([...(why ? [] : [{ arg: 2, value: '<why-the-worker-changed>' }]), { flag: hole('<--handover-or-none>') }]));
    }
  }
  if (composed) return;
  // With more than one slice in play, a lease holds only what its issue declares, so one that declares nothing would
  // collide with another slice's work unseen: it is refused until the issue declares its files or its resources. The issues
  // in no slice, the jarl's own, are one more slice of work beside the coordinators' when one of them is in play. The
  // reason names the issue; the forms carry a placeholder for the ids.
  const loop = readLoop(jarlDir(root));
  const unsliced = loop.issues.some((i) => sliceOf(i) === null && loop.profile.active(i.status));
  const slices = [...activeSlices(loop).map((x) => x.tag), ...(unsliced ? ['the issues in no slice'] : [])];
  if (slices.length > 1) {
    for (const issue of issues) {
      if ((leased(issue) && !handover) || issue.files.length || issue.resources.length) continue;
      need(false, `${issue.id} declares no Files or Resources, and ${slices.length} slices are in play (${slices.join(', ')}): across slices only leases hold, and a lease holds only what its issue declares — declare them first, its files or its resources (${jarlLine('field', '<ids>', 'Resources', '<resource-name>')})${nothing}`, () => [{ first: ['jarl.mjs', 'field', hole('<ids>'), 'Files', hole('<paths>')] }, { retry: true }]);
    }
  }
  const others = otherLeases(root, profile, taken);
  for (const issue of issues) {
    if (leased(issue) && !handover) continue;
    const held = heldByOthers(root, others, issue, named('branch') ?? fieldText(issue.fields.branch), named('worker') ?? fieldText(issue.fields.worker), fileKeysOf(root, issue), issue.resources);
    if (!held.length) continue;
    const { what, by } = held[0];
    const join = by.fields.branch ? `, or put ${issue.id} in ${by.id}'s lease: set ${issue.id} ${status} "<text>" --branch ${fieldText(by.fields.branch)}${by.fields.worker ? ` --worker ${fieldText(by.fields.worker)}` : ''}` : '';
    need(false, `${issue.id} ${what}, which ${by.id} holds in its lease (${holderText(by)}) — two leases on one file or resource collide; wait until ${by.id} leaves its lease (next offers ${issue.id} then)${join}${nothing}; what is ready: ${jarlLine('next')}`, () => ({ arg: 0, value: '<an-issue-next-offers>' }));
  }
}
// What the leases of the issues outside `taken` hold: each file key and each resource, with the issue whose lease holds it.
// The first holder of each, in the order of the record, so a refusal names the same issue every time.
function otherLeases(root, profile, taken) {
  const files = new Map();
  const resources = new Map();
  for (const held of loadIssues(root).filter((x) => !taken.has(x.id) && profile.is(x.status, 'holds-claim'))) {
    const i = declaredInCall?.has(held.id) ? { ...held, ...declaredInCall.get(held.id) } : held;
    for (const k of fileKeysOf(root, i)) if (!files.has(k.key)) files.set(k.key, held);
    for (const r of i.resources) if (!resources.has(r.toLowerCase())) resources.set(r.toLowerCase(), held);
  }
  return { files, resources };
}
// The files (as fileKeysOf gives them) and resources of an issue that another lease holds, as { what, by }, leaving out what
// the lease of `branch` and `worker` joins: the holder's own branch, and its worker when both name one.
function heldByOthers(root, others, issue, branch, worker, fileKeys, resourceNames) {
  const joins = (h) => (branch && h.fields.branch ? branch === fieldText(h.fields.branch) && (!worker || !h.fields.worker || worker === fieldText(h.fields.worker)) : !branch && !h.fields.branch && Boolean(worker) && worker === fieldText(h.fields.worker));
  return [
    ...fileKeys.filter((k) => others.files.has(k.key)).map((k) => ({ what: `declares ${k.f}`, by: others.files.get(k.key) })),
    ...resourceNames.filter((r) => others.resources.has(r.toLowerCase())).map((r) => ({ what: `uses the resource ${r}`, by: others.resources.get(r.toLowerCase()) })),
  ].filter((h) => !joins(h.by));
}
// A file or a resource declared on an issue a lease holds is taken into that lease, so it is refused when another lease holds
// it, as a lease taken on it would be: a lease that guards what an issue declares is guarded wherever it is declared. What
// the issue's own lease joins is allowed; an issue no lease holds is checked when it takes one; a loop its composer schedules
// leaves the decision to the composer. `files` and `resources` are what the call adds; `next` is what the issue holds once
// the call is written, which a call over several issues keeps for the issues checked after this one.
function needFreeOfOtherLeases(root, issue, files, resources, next) {
  const profile = loadProfile(root);
  if (profile.scheduler !== null && profile.scheduler !== undefined) return;
  if (!profile.is(issue.status, 'holds-claim') || !(issue.fields.worker || issue.fields.branch)) return;
  const held = heldByOthers(root, otherLeases(root, profile, new Set([issue.id])), issue, fieldText(issue.fields.branch), fieldText(issue.fields.worker), fileKeysOf(root, { ...issue, files }), resources);
  if (!held.length) {
    declaredInCall?.set(issue.id, { files: next.files ?? issue.files, resources: next.resources ?? issue.resources });
    return;
  }
  const { what, by } = held[0];
  const join = by.fields.branch ? `, or put ${issue.id} in ${by.id}'s lease: ${jarlLine('set', issue.id, issue.status, '<why-the-worker-changed>', '--branch', fieldText(by.fields.branch), ...(by.fields.worker ? ['--worker', fieldText(by.fields.worker)] : []), '--handover')}` : '';
  need(false, `${issue.id} ${what}, which ${by.id} holds in its lease (${holderText(by)}) — two leases on one file or resource collide; leave it out, or wait until ${by.id} leaves its lease${join}`, () => ({ arg: 2, value: resources.length ? '<resource-name>' : '<paths>' }));
}
// Who holds an issue's lease, as the refusals name it: its worker, branch and start, and its slice tag when it has one.
function holderText(issue) {
  const name = sliceOf(issue);
  const slice = name === null ? null : `slice:${name}`;
  return [issue.fields.worker && `worker ${fieldText(issue.fields.worker)}`, issue.fields.branch && `branch ${fieldText(issue.fields.branch)}`, issue.fields.since && `since ${fieldText(issue.fields.since)}`, slice].filter(Boolean).join(', ') || 'no worker or branch named';
}

// The check behind set --worktree: a path that exists is a worktree of one of the repositories the issue names (or the
// loop's own) with `branch` checked out; a path that does not exist is not checked.
function needWorktreeOfLease(root, issue, branch, path) {
  if (!existsSync(path)) return;
  const repos = issueRepoPaths(root, issue).filter(isGitRepo);
  const listed = repos.flatMap((r) => (worktreesOf(r) || []).filter((w) => sameDir(w.path, path)));
  need(listed.length > 0, `--worktree ${path} is not a worktree of ${repos.length ? repos.map((r) => repoLabel(r)).join(' or ') : 'a repository of ' + issue.id} — a lease is its branch, and the worktree is found through it`, () => ({ flag: '--worktree', value: '<the-worktree-of-the-lease>' }));
  need(!branch || listed.some((w) => w.branch === branch), `--worktree ${path} has ${listed[0].branch ?? 'no branch'} checked out, not ${branch}, the branch of the lease`, () => ({ flag: '--worktree', value: '<the-worktree-of-the-lease>' }));
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
  need(status !== undefined, 'set <ids> <status-in-the-log> --header: name the status the log holds for the issue (status shows it); --header rewrites the header from the log and moves nothing', () => ({ arg: 1, value: '<status-in-the-log>' }));
  need(loadProfile(root).statuses.includes(status), `${status} is not a status this loop's profile lists (${loadProfile(root).statuses.join(', ')})`, () => ({ arg: 1, value: '<status-in-the-log>' }));
  need(why === undefined && flags.base === undefined && !leaseFlagsGiven(flags).length && flags.handover === undefined && flags['without-rows'] === undefined, '--header rewrites the header from the log and takes no reason, lease flag, --handover, --without-rows or base', () => ({ rename: '--header', to: '<no-flag-here>' }));
  const issues = issuesFor(root, rawIds);
  for (const issue of issues) {
    need(!issue.byHeader, `${issue.id} is read from its header: the log files ${issue.id} ${issue.byHeader?.filings} times and cannot say which file its lines were written for, so no header is written from it`, refiled);
    need(issue.onFile !== null, `${issue.id} is not in the log, so there is nothing to write its header from: ${jarlLine('set', issue.id, status, '<why>')} without --header puts it there`, () => [{ first: ['jarl.mjs', 'set', issue.id, status, '<why>'] }, { retry: true }]);
    need(issue.status === status, `${issue.id} is ${issue.status} in the log: set ${issue.id} ${issue.status} --header writes its header from it, and ${jarlLine('set', issue.id, status, '<why>')} without --header moves it`, () => ({ arg: 1, value: hole('<status-in-the-log>') }));
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
  need(value !== undefined, `field <ids> ${field.name} "<value>" — the value is required${field.enum ? ` (one of: ${field.enum.join(', ')})` : ''}`, () => ({ arg: 2, value: hole('<value>') }));
  const by = editorOf(flags.by);
  const profile = loadProfile(root);
  const v = fieldValue(profile, field, value);
  need(v || (!field.required && !field.builtin), `${field.name} cannot be emptied with --clear or an empty value${field.enum ? ` — one of: ${field.enum.join(', ')}` : ''}`, () => [{ drop: '--clear' }, { arg: 2, value: hole('<value>') }]);
  const issues = issuesFor(root, rawIds);
  if (field.key === 'kind' && profile.keptKind(v) === WAIT_KIND) {
    // The reason names the issue; the forms carry a placeholder for the ids, as every refusal's form does.
    const person = ['jarl.mjs', 'field', hole('<ids>'), 'Person', hole('<name>')];
    const checkWhen = ['jarl.mjs', 'field', hole('<ids>'), 'Check when', hole('<date-or-event>')];
    for (const issue of issues) need(fieldText(issue.fields.person) && fieldText(issue.fields['check when']), `${issue.id} becomes a wait only with the outside person it is held by and when to check it — first ${jarlLine(...person.slice(1))} and ${jarlLine(...checkWhen.slice(1))}`, () => [{ first: person }, { first: checkWhen }, { retry: true }]);
  }
  if (field.key === 'kind' && profile.keptKind(v) && issues.some((issue) => issue.kind !== v)) needFormat(root, 'promise-wait');
  logChanges(root, issues.map((issue) => fieldLine(issue.id, field.name, v, heldField(issue, field.name), by)));
  for (const issue of issues) writeAtomic(issue.file, setField(readText(issue.file), field.name, v));
  return oneOrMany(rawIds, issues.map((issue) => ({ id: issue.id, field: field.name, value: v })));
}

// field <ids> Person "<name>" | "Check when" "<when>": what a wait is held by and when to check it. Written on any issue,
// so an issue can become a wait (its Kind is written last); never emptied on a wait, which they hold.
function setKeptField(root, rawIds, name, value, flags) {
  needNoLeaseFlags(flags, `the field ${name}`);
  const profile = loadProfile(root);
  const by = editorOf(flags.by);
  const v = value === '' ? '' : keptValue(name, value);
  const issues = issuesFor(root, rawIds);
  for (const issue of issues) need(v || profile.keptKind(issue.kind) !== WAIT_KIND, `${issue.id} is a wait, held by its Person and checked when its Check when says: ${name} is never empty on it — give it another kind first (${jarlLine('field', hole('<ids>'), 'Kind', hole('<kind>'))})`, () => (['jarl.mjs', 'field', hole('<ids>'), 'Kind', hole('<kind>')]));
  if (v) needFormat(root, 'promise-wait', `the field ${name} of a wait`);
  logChanges(root, issues.map((issue) => fieldLine(issue.id, name, v, heldField(issue, name), by)));
  for (const issue of issues) writeAtomic(issue.file, v ? setField(readText(issue.file), name, v) : removeFields(readText(issue.file), [name]));
  return oneOrMany(rawIds, issues.map((issue) => ({ id: issue.id, field: name, value: v })));
}

// field <ids> Parent <id> | --clear: the issue each id is a sub-issue of, one number of the loop, or none. The tree holds:
// no issue is its own parent or sits under its own sub-issue, no wait runs in a circle through the tree (a parent waits on
// its sub-issues, a sub-issue on the After of every issue above it), and nothing is added under a finished parent, whose
// own acceptance was checked against a whole without it. The first parent written raises the record format, since a
// reader that knows no parent would read the backlog as flat and offer a parent as work of its own.
function setParent(root, rawIds, value, flags) {
  needNoLeaseFlags(flags, `the field ${PARENT_FIELD}`);
  const by = editorOf(flags.by);
  const issues = issuesFor(root, rawIds);
  const nothing = issues.length > 1 ? ' — nothing was written' : '';
  const out = (v) => oneOrMany(rawIds, issues.map((issue) => ({ id: issue.id, field: PARENT_FIELD, value: v })));
  if (value === '') {
    for (const issue of issues) need(issue.fields.parent !== undefined, `${issue.id} has no ${PARENT_FIELD} field to clear${nothing}`, () => ({ rename: '--clear', to: hole('<no-flag-here>') }));
    logChanges(root, issues.map((issue) => fieldLine(issue.id, PARENT_FIELD, '', heldField(issue, PARENT_FIELD), by)));
    for (const issue of issues) writeAtomic(issue.file, removeFields(readText(issue.file), [PARENT_FIELD]));
    return out('');
  }
  const all = loadIssues(root);
  const parent = parentNamed(all, value);
  needUnder(all, loadProfile(root), issues, parent, nothing, () => ({ arg: 2, value: hole('<another-id>') }));
  needFormat(root, 'parent');
  logChanges(root, issues.map((issue) => fieldLine(issue.id, PARENT_FIELD, parent.id, heldField(issue, PARENT_FIELD), by)));
  for (const issue of issues) writeAtomic(issue.file, setField(readText(issue.file), PARENT_FIELD, parent.id));
  return out(parent.id);
}
// The issue a Parent value names: one number the loop holds, as the loop writes it.
function parentNamed(all, value, where = { arg: 2, value: hole('<id>') }) {
  const raw = fieldText(value).replace(/^#/, '');
  need(/^\d+$/.test(raw), `the ${PARENT_FIELD} of an issue is the number of one issue of the loop (got "${fieldText(value)}")`, () => where);
  const parent = issueNamed(all, raw);
  need(parent, `no such issue: ${raw}${listAll()}`, () => where);
  return parent;
}
// The parent a filing names, checked as a sub-issue's parent is, before anything is filed: the profile keeps the tool's
// own Parent, the loop holds the issue, it is not finished, and the record may be raised to hold a parent.
export function parentToFile(root, value, where) {
  const profile = loadProfile(root);
  need(profile.tree, `${where.flag} files the ${PARENT_FIELD} the tool keeps, and this loop's profile declares a field ${PARENT_FIELD} of its own — write that field with --field`, () => [{ drop: where.flag }, { flag: '--field', value: hole('<name=value>'), add: true }]);
  const all = loadIssues(root);
  const parent = parentNamed(all, value, where);
  needUnder(all, profile, [], parent, '', () => where);
  needFormatHeld(root, 'parent');
  return parent;
}
// The issues just filed, put under the parent parentToFile named: one write, one log line each.
export function putUnder(root, ids, parent, flags = {}) { return setParent(root, ids.join(','), parent.id, flags); }
// Whether `issues` may be put under `parent`, read from `all`, the loop as it stands: each check of the tree that a Parent
// written by field or by split passes, refused with `ready` where another parent is the fix.
function needUnder(all, profile, issues, parent, nothing, ready) {
  for (const issue of issues) {
    need(idKey(issue.id) !== idKey(parent.id), `${issue.id} cannot be its own parent${nothing}`, ready);
    const above = [parent, ...parent.tree.ancestors];
    const at = above.findIndex((a) => idKey(a.id) === idKey(issue.id));
    need(at === -1, `${issue.id} cannot be a sub-issue of ${parent.id}: ${parent.id} is under ${issue.id} already (${above.slice(0, at + 1).map((a) => a.id).join(' → ')}), and the tree would run in a circle${nothing}`, ready);
  }
  need(!profile.is(parent.status, 'terminal'), `${parent.id} is ${parent.status}: its own acceptance was checked against a whole that a sub-issue added now would not be part of — reopen it first${nothing}`, () => [{ first: ['jarl.mjs', 'set', parent.id, profile.initial, hole('<why>')] }, { retry: true }]);
  const parents = new Map(issues.map((i) => [i.id, parent.id]));
  for (const issue of issues) {
    const cycle = waitCycle(all, issue.id, { parents });
    need(!cycle, `${issue.id} cannot be a sub-issue of ${parent.id}: a parent waits on its sub-issues and a sub-issue on the After of the issues above it, so ${cycle?.text} would wait in a circle and none of them would ever be offered${nothing}`, ready);
  }
}

// split <id> --line <n>=<id>...: the acceptance of a parent shared out among its sub-issues, in one write. Every acceptance
// line of the parent is named once: moved to an issue (<n>=<that issue>) or kept on the parent (<n>=<the parent>), so a
// line named nowhere is refused and no line is lost. Each issue a line moves to becomes a sub-issue of the parent, as field
// <id> Parent makes one, with every check of the tree, and gains the lines after the ones it holds; the parent keeps the
// lines it keeps and every other line of its section (a finding's proposal) as it stands. It is a command of its own,
// not a part field writes, because it writes several issues at once and its check, that every line lands somewhere, is
// over all of them together: field writes one part, and a line dropped between two such writes would be seen by nobody.
export function cmdSplit(root, rawId, flags = {}) {
  needLiveLoop(root, '');
  const by = editorOf(flags.by);
  need(rawId !== undefined && /^#?\d+$/.test(String(rawId).trim()), `split takes the number of the parent whose acceptance is shared out (got "${rawId ?? ''}")`, () => ({ arg: 0, value: hole('<id>') }));
  const all = loadIssues(root);
  const profile = loadProfile(root);
  const parent = issueNamed(all, rawId);
  need(parent, `no such issue: ${rawId}${listAll()}`, () => ({ arg: 0, value: hole('<id>') }));
  const lines = acceptanceLines(parent);
  need(lines.length, `${parent.id} has no acceptance line to share out — an issue is put under it with ${jarlLine('field', '<ids>', PARENT_FIELD, parent.id)}`, () => (['jarl.mjs', 'field', hole('<ids>'), PARENT_FIELD, hole('<id>')]));
  const given = [].concat(flags.line ?? []).map(String);
  const shape = `<n>=<id>, an acceptance line's number and the issue it goes to (${parent.id} itself to keep it there)`;
  need(given.length, `split names where each acceptance line of ${parent.id} goes, --line ${shape}, for each of its ${lines.length} line${lines.length === 1 ? '' : 's'}`, () => ({ flag: '--line', value: hole('<line=id>') }));
  const placed = new Map();
  for (const item of given) {
    const m = /^\s*(\d+)\s*=\s*#?(\d+)\s*$/.exec(item);
    const wrong = () => ({ replace: item, value: hole('<line=id>') });
    need(m, `--line takes ${shape} (got "${item}")`, wrong);
    const n = Number(m[1]);
    need(n >= 1 && n <= lines.length, `${parent.id} has ${lines.length} acceptance line${lines.length === 1 ? '' : 's'}: there is no line ${n} (got "${item}")`, wrong);
    const to = issueNamed(all, m[2]);
    need(to, `no such issue: ${m[2]} (got "${item}")${listAll()}`, wrong);
    need(!placed.has(n), `line ${n} of ${parent.id} is named twice ("${placed.get(n)?.item}" and "${item}"): a line goes to one issue`, () => ({ drop: '--line', value: item }));
    placed.set(n, { to, item });
  }
  const lost = lines.map((_, k) => k + 1).filter((n) => !placed.has(n));
  // The form holds a place for each line the call gave, then names each line still to place, its issue a placeholder: filled,
  // it is the whole split.
  need(!lost.length, `${lost.length === 1 ? 'line' : 'lines'} ${lost.join(', ')} of ${parent.id} ${lost.length === 1 ? 'is' : 'are'} moved nowhere: a split names every acceptance line of the parent, moved to a sub-issue or kept on ${parent.id}, so no line is lost — ${lost.map((n) => `${n}: "${lines[n - 1]}"`).join('; ')}`,
    () => ['jarl.mjs', 'split', hole('<id>'), ...given.flatMap(() => ['--line', hole('<line=id>')]), ...lost.flatMap((n) => ['--line', `${n}=${hole('<id>')}`]), ...(flags.by !== undefined ? ['--by', hole('<who>')] : [])]);
  const subs = [...new Map([...placed.values()].filter((p) => idKey(p.to.id) !== idKey(parent.id)).map((p) => [p.to.id, p.to])).values()];
  need(subs.length, `every line stays on ${parent.id}: a split moves at least one acceptance line to a sub-issue`, () => ({ replace: given[0], value: hole('<line=id>') }));
  for (const sub of subs) {
    const item = [...placed.values()].find((p) => p.to === sub).item;
    need(sub.parent === null || idKey(sub.parent) === idKey(parent.id), `${sub.id} is a sub-issue of ${sub.parent}: a split moves lines to the sub-issues of ${parent.id}, or to issues with no parent (got "${item}")`, () => ({ replace: item, value: hole('<line=id>') }));
    need(!profile.is(sub.status, 'terminal'), `${sub.id} is ${sub.status}: a line moved to it would never be checked — move it to an issue in play (got "${item}")`, () => ({ replace: item, value: hole('<line=id>') }));
  }
  const joining = subs.filter((s) => s.parent === null);
  needUnder(all, profile, joining.length ? joining : subs, parent, '', () => ({ replace: [...placed.values()].find((p) => p.to !== parent).item, value: hole('<line=id>') }));
  needFormat(root, 'parent');
  // The parent's section with the moved lines taken out, the rest as it stands; each sub-issue's with its lines added.
  let k = 0;
  const keptText = (parent.sections.acceptance || '').split('\n').filter((raw) => {
    const l = raw.trim().replace(/^- /, '');
    if (l === '' || l.startsWith(PROPOSED)) return true;
    k += 1;
    return idKey(placed.get(k).to.id) === idKey(parent.id);
  }).join('\n').trim();
  const moved = (sub) => lines.filter((_, n) => placed.get(n + 1).to === sub);
  const writes = [{ issue: parent, now: keptText }, ...subs.map((sub) => ({ issue: sub, now: acceptanceText([...itemsOf(sub.sections.acceptance), ...moved(sub)]) }))]
    .map((w) => ({ ...w, grew: grownLines(profile, w.issue, w.issue.sections.acceptance, w.now) }));
  logChanges(root, [
    ...joining.map((sub) => fieldLine(sub.id, PARENT_FIELD, parent.id, heldField(sub, PARENT_FIELD), by)),
    ...writes.map((w) => bodyLine(w.issue.id, 'acceptance', w.issue.sections.acceptance, w.now, by, w.grew)),
  ]);
  for (const w of writes) {
    let text = setSection(readText(w.issue.file), acceptanceHeading(w.issue, profile), w.now);
    if (joining.includes(w.issue)) text = setField(text, PARENT_FIELD, parent.id);
    writeAtomic(w.issue.file, text);
  }
  const grown = writes.filter((w) => w.grew.length);
  // A row keeps the numbers it named: the parent's rows that name a line the split moved away, or whose number the lines
  // taken out before it changed, are said, as field says them. A sub-issue's lines are added after its own and keep theirs.
  const keptOrder = lines.map((_, k) => k + 1).filter((n) => idKey(placed.get(n).to.id) === idKey(parent.id));
  const renumbered = linesRowsName(parent).filter((n) => keptOrder.indexOf(n) + 1 !== n);
  const notes = [...grown.map((w) => grewNote(w.issue, w.grew)), ...(renumbered.length ? [rowNumbersNote(parent.id, renumbered)] : [])];
  return {
    id: parent.id, subs: subs.map((s) => s.id),
    lines: [...placed.entries()].sort((a, b) => a[0] - b[0]).map(([n, p]) => ({ line: n, to: p.to.id, kept: idKey(p.to.id) === idKey(parent.id) })),
    ...(grown.length ? { grew: grown.map((w) => ({ id: w.issue.id, lines: w.grew })) } : {}),
    ...(notes.length ? { notes } : {}),
  };
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
// The names of a Resources value, checked: single words, each kept once whatever its case.
function resourceNames(value) {
  const names = [];
  for (const n of splitList(fieldText(value))) {
    need(/^[A-Za-z0-9._:/-]+$/.test(n), `resource names are single words of letters, digits and . _ : / - ("${n}" is not), naming the thing`, () => ({ replace: n, value: hole('<resource-name>') }));
    if (!names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
  }
  return names;
}
function setResources(root, rawIds, value, flags) {
  needNoLeaseFlags(flags, 'the field Resources');
  need(value !== undefined, 'the field Resources needs a value, or --clear to empty it', () => ({ arg: 2, value: '<names>' }));
  const names = resourceNames(value);
  const by = editorOf(flags.by);
  const issues = issuesFor(root, rawIds);
  inCall(() => { for (const issue of issues) needFreeOfOtherLeases(root, issue, [], names.filter((n) => !issue.resources.some((r) => r.toLowerCase() === n.toLowerCase())), { resources: names }); });
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
// the merge stands behind the issue instead of a reviewer. The evidence rows are asked for either way, and so is the
// owner's tick of every acceptance line only he ticks (see owner-lines.mjs).
// doneRefusal reads the loop for one issue; a caller checking several issues reads it once and asks doneRefusalIn.
export function doneRefusal(root, issue) { return doneRefusalIn(root, readLoop(jarlDir(root)), issue, undefined); }
function doneRefusalIn(root, loop, issue, base) { return doneGateIn(root, loop, issue, base)?.text ?? null; }
// Why done refuses, as { text, cause }, or null: the cause (retraction, evidence, slots, merge, owner, approve, model)
// decides the step a refusal of the move ends with. `base`: the branch or ref the merge landed in, when the caller names
// one.
function doneGateIn(root, loop, issue, base) {
  const { profile } = loop;
  const g = gateOf(loop, issue.id);
  if (g.unresolvedRetractions.length) return { cause: 'retraction', text: `${issue.id} records a retraction of evidence row ${g.unresolvedRetractions.join(', ')} that matches no evidence line of the log, so which row it retracts is unknown and a retracted row might be counted — done refuses until that log line is repaired` };
  // A parent closes after the whole under it: every sub-issue settled, then its own acceptance checked against the whole.
  const open = (issue.tree ? issue.tree.children : []).filter((c) => !profile.is(c.status, 'settles-dependents'));
  if (open.length) return { cause: 'subs', text: `${issue.id} has sub-issues not closed: ${open.map((c) => `${c.id} (${c.status})`).join(', ')} — a parent is closed once each of its sub-issues is done or dropped and its own acceptance is then checked against the whole` };
  // Done asks of every line what its method asks: rows here (read lines by the approve below, owner lines by his tick).
  const states = lineStates(loop, issue, g);
  if (!states.length) return { cause: 'lines', text: `${issue.id} has no acceptance line, so there is nothing done can ask of it — write what it is to prove first: ${jarlLine('field', issue.id, 'Acceptance', LINE_FORM)}` };
  const unproved = unprovedMechanical(states);
  if (unproved.length) return { cause: 'evidence', text: `${issue.id} has lines whose method is not met${g.tracked && g.anchor ? ` (rows count since ${sinceText(g.anchor)})` : ''}: ${unproved.map(lineStateText).join('; ')} — ${lineRowForm(issue.id)}` };
  const slots = slotRefusal(root, profile, issue, g);
  if (slots) return { cause: 'slots', text: slots };
  if (profile.doneGate['requires-merged']) { const m = mergeRefusal(root, issue, base, g); if (m) return { cause: 'merge', text: m }; }
  const owner = () => { const text = ownerLineRefusal(root, loop, issue); return text ? { cause: ownerLineRewrite(root, loop, issue) ? 'owner-rewrite' : 'owner', text } : null; };
  if (profile.doneGate.approve === 'none') return owner();
  const code = carriesCode(issue);
  if (g.selfApproved) return { cause: 'approve', text: `${issue.id}'s live approve is by a worker of this issue or its branch — a self-approve does not count as review: ${jarlLine('review', issue.id, '<verdict>', '--by', '<a-fresh-reviewer>', '<text>')}${code ? '' : ' (or jarl, on an issue that carries no code)'}` };
  // A changes verdict with no approve after it is named as the cause, with its reviewer and day, so whoever is refused
  // sees the review that stands in the way.
  if (!g.approved && (g.lastReview === 'changes' || g.standingChanges)) {
    const changes = g.standingChanges || [...g.trail].reverse().find((r) => r.verdict === 'changes');
    if (g.lastReview !== 'changes') return { cause: 'approve-standing', text: `${issue.id}'s changes verdict by ${changes.by || 'a reviewer not recorded'} of ${changes.at} stands until a round or a new commit — an approve recorded after it does not clear the issue: ${jarlLine('round', issue.id, '<what-failed>')}` };
    return { cause: 'approve', text: `${issue.id}'s latest review is a changes verdict by ${changes.by || 'a reviewer not recorded'} of ${changes.at}, and no approve came after it — a fresh reviewer reads the issue and the diff first: ${jarlLine('review', issue.id, '<verdict>', '--by', '<reviewer>', '<text>')}` };
  }
  if (!g.approved) return { cause: 'approve', text: `${issue.id} has no approving review newer than its last round${g.tracked ? ' or reopen' : ''}${g.anchor && g.anchor.what === 'whole' ? `, nor one since ${sinceText(g.anchor)}` : ''} — a fresh reviewer reads the issue and the diff first: ${jarlLine('review', issue.id, '<verdict>', '--by', '<reviewer>', '<text>')}` };
  // Approves that stand and do not clear it: a bot's the done gate does not name, or short of the loop's own definition.
  const uncleared = unclearedText(loop, issue, g);
  if (uncleared) return g.uncleared.cause === 'bot'
    ? { cause: 'approve', text: `${uncleared} — an approve that clears it is next: ${jarlLine('review', issue.id, '<verdict>', '--by', '<a-fresh-reviewer>', '<text>')}` }
    : { cause: 'clears', text: `${uncleared} — an approve that clears it is next: ${jarlLine('review', issue.id, '<verdict>', '--by', '<reviewer>', '<text>')}` };
  if (code && !g.fresh) return { cause: 'approve', text: `${issue.id} ${freshRuleText(issue, g.live, g.uncleared?.standing)}: ${jarlLine('review', issue.id, '<verdict>', '--by', '<a-fresh-reviewer>', '<text>')}` };
  // The model of the approve, where the profile's reviewer rule makes it a gate; under the default it is advice only.
  const byModel = modelRefusalOf(root, loop, issue, { gate: g });
  if (byModel) return { cause: 'model', text: `${byModel}: ${modelReviewForm(issue.id)}` };
  // A code issue is merged before it is done, the order the approve's reply names and the rule status flags a closed
  // issue by; a profile that requires a landed merge has checked more than this above.
  const unmerged = unmergedRefusal(issue, g);
  if (unmerged) return { cause: 'merge', text: unmerged };
  // An issue worked in place has no merge: it closes on the commit of its files, which a row of its proof names.
  const uncommitted = inPlaceRefusal(root, loop, issue, g);
  if (uncommitted) return uncommitted;
  // Last, an acceptance line only the owner ticks: his look comes on top of the proof and the review, never instead.
  return owner();
}
// Why an issue worked in place may not close yet, as { cause, text }, or null. Each file it declares is placed in its
// repository as fileAt places it (the loop's own, or the one its Repo names for that path), read from the top of that repository and compared, whole, with the
// paths git names there (see repositoryPaths). The issue closes when every such repository is a
// git repository here, none of its declared files has a change its checkout has not committed (staged, unstaged or
// untracked), and a row of its proof inside the gate's window names a commit that a repository holds on the branch it
// has checked out, that changes a declared file of that repository, and that was committed at or after the minute of the
// move the window starts at (the lease, a reopen or a red round): a commit made before the work began commits none of it.
// The files are committed in the checkout of their repository once the approve stands (by the merger where one runs,
// else the coordinator), and that commit is recorded as a row; nothing is merged.
function inPlaceRefusal(root, loop, issue, g) {
  if (!worksInPlace(loop.profile, issue)) return null;
  const rows = evidenceTable(issue.sections.evidence).rows;
  const logged = alignRows(issue.id, rows, g.rowLog);
  const counted = rows.filter((r, k) => !r.retracted && r.saw !== '' && (!g.tracked || (logged[k] && logged[k].inWindow && !logged[k].retracted)));
  const shas = [...new Set(counted.flatMap((r) => `${r.ran} ${r.saw}`.match(/\b[0-9a-f]{7,40}\b/g) || []))];
  // The declared files by the top of the repository they are in, each as the paths git names there. Git is asked without
  // the variables a hook sets, which would point it at the repository the hook runs for.
  const byTop = new Map();
  for (const f of issue.files) {
    const at = fileAt(root, issue, f);
    const found = gitHere(at.repo, ['rev-parse', '--show-toplevel']);
    if (found === null) return { cause: 'commit', text: `${issue.id} is worked in place, and ${f} is in ${repoLabel(at.repo)}, which is no git repository here, so the commit of its files cannot be checked — ${inPlaceStep(issue)}` };
    const top = canonical(found);
    const placed = repositoryPaths(top, at);
    if (placed.outside) return { cause: 'files', text: `${issue.id} is worked in place, and ${f} ${placed.outside} — an issue worked in place declares the files it writes inside their repository: ${jarlLine('field', issue.id, 'Files', '<paths>')}` };
    byTop.set(top, [...(byTop.get(top) || []), ...placed.paths]);
  }
  // A declared directory covers what is under it; a path is compared whole, so a file of the same name elsewhere is not it.
  const touches = (paths) => (f) => paths.some((d) => d === '' || f === d || f.startsWith(`${d}/`));
  const names = (top, args) => (gitHere(top, args) || '').split('\0').filter(Boolean);
  for (const [top, paths] of byTop) {
    const changed = [...names(top, ['diff', '--name-only', '-z', '--no-renames', 'HEAD']), ...names(top, ['ls-files', '--others', '--exclude-standard', '-z'])];
    const dirty = changed.filter(touches(paths));
    if (dirty.length) return { cause: 'commit', text: `${issue.id} is worked in place, and its checkout holds changes not committed to ${dirty.join(', ')} — ${inPlaceStep(issue)}` };
  }
  const from = g.tracked ? parseStamp(g.anchor.at) : null;
  const committed = (top, paths, sha) => gitHere(top, ['merge-base', '--is-ancestor', sha, 'HEAD']) !== null
    && (from === null || Number(gitHere(top, ['show', '-s', '--format=%ct', sha])) * 1000 >= from)
    && names(top, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', '--no-renames', sha]).some(touches(paths));
  if (shas.some((sha) => [...byTop].some(([top, paths]) => committed(top, paths, sha)))) return null;
  return { cause: 'commit', text: `${issue.id} is worked in place, and no row of its proof${g.tracked ? ` since ${sinceText(g.anchor)}` : ''} names a commit made after it, on the branch checked out, that changes ${issue.files.join(', ')} — ${inPlaceStep(issue)}` };
}
// A declared file as the paths git names it by in its repository, whose top is `top`: the path read from the top of the
// repository (the one its Repo names, or the loop's own), the one base scope reads too, so a loop kept in a subdirectory
// declares its files as they are written from the top. A symbolic link on the way is followed, so the file an edit through
// it changes is checked, and the link's own path with it. { paths } or, for a path that leaves the repository as written
// or once a link is followed, { outside } with why.
function repositoryPaths(top, at) {
  const written = resolve(top, at.path);
  const inside = (p) => { const r = relative(top, p); return r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r) ? null : portablePath(r); };
  const own = inside(written);
  if (own === null) return { outside: 'lies outside its repository, so no commit of that repository changes it' };
  const target = inside(realPlace(written));
  if (target === null) return { outside: 'is a symbolic link to a place outside its repository, so no commit of that repository changes the file it points to' };
  return { paths: [...new Set([own, target])] };
}
// A path with every symbolic link on it followed, as far as it exists: a file not written yet, or deleted, keeps its name
// under the real place of its nearest directory that exists.
function realPlace(path) {
  const rest = [];
  for (let at = path; ; at = dirname(at)) {
    try { return join(realpathSync.native(at), ...rest); } catch { /* not there: its directory is read */ }
    if (dirname(at) === at) return path;
    rest.unshift(basename(at));
  }
}
const inPlaceStep = (issue) => `once the approve stands, its files are committed in the checkout of their repository (by the merger where one runs, else the coordinator), and the commit is recorded as a row: ${jarlLine('evidence', issue.id, '--ran', '<command>', '--saw', '<what-it-printed>', '--line', '<line-number>', '--by', '<who>')}`;
// Why a code issue's code as it is now is not merged (see unmergedCode), as done says it, or null.
function unmergedRefusal(issue, g) {
  const u = unmergedCode(issue, g);
  return u ? `${issue.id} carries code (its lease records Branch ${fieldText(issue.fields.branch)}) and ${unmergedText(u)} — a code issue is merged before it is done: the merger lands the branch and records it, ${jarlLine('merged', issue.id, '--sha', '<sha>')}, then done` : null;
}

// The done gate's requires-merged: the issue records a merge (merged --sha) and that commit is in the base of the
// repository where the merge was recorded (Merged's "in <repo>", else the issue's Repo, else the loop's own repository):
// the base the merge note and the cleanup read too (see baseOf), or the branch a library caller names as opts.base (a
// composer that lands into a branch nobody has checked out, such as a team branch, names it). A sha the repository does
// not know, or one not reachable from the base, is refused: a merge recorded is not a merge landed until the base holds it.
// A merge that does not count for the code as it is now (see unmergedCode) is refused before its commit is looked for.
function mergeRefusal(root, issue, base, g) {
  const m = mergedOf(issue);
  const gate = 'this loop\'s profile closes an issue only on a landed merge (done-gate "requires-merged": true)';
  if (!m) return `${issue.id} records no merge — ${gate}: ${jarlLine('merged', issue.id, '--sha', '<sha>')} once it has landed`;
  const spent = unmergedRefusal(issue, g);
  if (spent) return spent;
  const repos = issueRepoPaths(root, issue, m.repo ? [m.repo] : undefined).filter(isGitRepo);
  if (!repos.length) return `${issue.id} records Merged ${m.sha}, but no repository it names is a git repository here — ${gate}, and the merge cannot be checked`;
  const refOf = (r) => (base === undefined ? baseOf(root, r) : base);
  if (base !== undefined && repos.every((r) => git(r, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]) === null)) return `${issue.id}: the base ${base} is not a branch or commit in ${repos.join(' or ')} — ${gate}, and the merge cannot be checked`;
  const landed = repos.some((r) => git(r, ['merge-base', '--is-ancestor', m.sha, refOf(r)]) !== null);
  if (landed) return null;
  const where = repos.map((r) => `${refOf(r)} in ${r}`).join(' or ');
  return `${issue.id} records Merged ${m.sha}, which is not in the base (${where}) — ${gate}; merge it, or record the sha that landed: ${jarlLine('merged', issue.id, '--sha', '<sha>')}`;
}

// The fresh-review rule, said the same way by done, review and merged: an issue that carries code (a Branch or a
// Merged field) needs its live approve from a fresh reviewer — an agent that neither wrote the code nor runs the loop.
// `standing` names every approve that stands and does not clear it (gateOf's uncleared), so one the live approve outranks,
// a bot's beside the coordinator's, is named too.
function freshRuleText(issue, live, standing = []) {
  const who = live && live.by ? `${live.by} (${live.kind})` : 'a reviewer not recorded (an approve from before --by)';
  const others = standing.filter((s) => s !== who);
  const bot = others.some((s) => s.endsWith(' (bot)'));
  return `carries code (${issue.fields.merged ? 'Merged' : 'Branch'} is recorded) and its live approve is by ${who}${others.length ? `, and it holds the approve${others.length > 1 ? 's' : ''} of ${others.join(', ')} as well` : ''} — the fresh-review rule: a code issue needs an approve from a fresh reviewer, an agent that neither wrote the code nor runs the loop; a coordinator's approve does not clear it${bot ? ', and a bot\'s clears only where the loop\'s done gate names that bot' : ''}`;
}

// Said, never refused: done closes an issue that was merged while its CI is not green yet, but the output says so, so the
// gap is seen by whoever closed it.
function doneNote(issue, root) {
  const notes = [];
  const m = mergedOf(issue);
  // A merge that carries its check (a passing check, or the red it landed on) needs no CI state to be told apart from an unrecorded one.
  const decided = () => { const line = issue.byHeader ? null : lastMerge(journalById(root).get(issue.id) || []); return Boolean(line && (line.check || line.red)); };
  if (m && m.ci !== 'green' && m.ci !== 'none' && !(m.ci === null && decided())) notes.push(`merged ${m.sha}, CI ${m.ci || 'not recorded'} — record it when known: ${jarlLine('merged', issue.id, '--ci', '<ci-state>')}`);
  return notes.length ? { note: notes.join('; ') } : {};
}

// The Proof rows an issue holds inside the done gate's window: the --ran/--saw rows the worker wrote, not retracted.
function proofSince(g, issue) { return g.tracked ? g.rowsSince : evidenceRows(issue).length; }
const EVIDENCE_HOW = (id) => lineRowForm(id);
// What a merge refused for want of its --sha says next: the head of the branch the issue's lease records, or, where no
// branch is recorded or it has no single head here, that there is none; the sha that landed is the caller's to give, so
// the command it names holds a placeholder for it and never the head.
function noMergeHow(root, issue) {
  const branch = fieldText(issue.fields.branch);
  const tip = branchTip(root, issue);
  const give = `once it has landed, give the sha that landed: ${jarlLine('merged', issue.id, '--sha', '<sha>', '--ci', '<ci-state>')}`;
  if (tip && !tip.includes(',')) return `the head of ${branch}, the branch its lease records, is ${tip}; ${give}`;
  if (!branch) return `its lease records no branch, so no head is offered; ${give}`;
  return `${branch} has no single head in the repositories here, so no head is offered; ${give}`;
}

// merged <ids> --sha <sha> [--ran "<command>" --saw "<what-it-printed>" | --red <id>] [--ci pending|green|red|none] [--repo <path>]
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
  need(flags.sha !== undefined || flags.ci !== undefined, `merged needs --sha <sha> (and optionally --ci), or --ci alone on issues that already record a merge`, () => ({ flag: '--sha', value: '<sha>' }));
  if (flags.sha !== undefined) need(/^[0-9a-f]{4,64}$/i.test(String(flags.sha)), `--sha is a commit id, 4 to 64 hex characters (got "${flags.sha}")`, () => ({ flag: '--sha', value: hole('<sha>') }));
  if (flags.ci !== undefined) need(CI_STATES.includes(flags.ci), `--ci must be one of: ${CI_STATES.join(', ')} (got "${flags.ci}") — none means the repository has no CI to wait for`, () => ({ flag: '--ci', value: hole('<ci-state>') }));
  need(flags.repo === undefined || flags.sha !== undefined, '--repo names where --sha landed; give it with --sha', () => ({ flag: '--sha', value: '<sha>' }));
  const rows = flags.ran !== undefined || flags.saw !== undefined ? rowsOf(flags) : null;
  need(!rows || flags.sha !== undefined, '--ran and --saw record the check that decided the merge; give them with --sha', () => ({ flag: '--sha', value: '<sha>' }));
  need(flags.red === undefined || flags.sha !== undefined, '--red names the issue that tracks why the merge landed on a red check; give it with --sha', () => ({ flag: '--sha', value: '<sha>' }));
  need(!(rows && flags.red !== undefined), 'a merge landed on red carries no passing check: give --ran/--saw for a green check, or --red <id> for a red one, not both', () => ({ rename: '--red', to: '<no-flag-here>' }));
  const issues = issuesFor(root, rawIds);
  const nothing = issues.length > 1 ? ' — nothing was written' : '';
  for (const issue of issues) { const refusal = unattributedRefusal(issue, 'merged'); need(!refusal, nothing ? nothingWritten(refusal) : refusal, refiled); }
  let cause = null;
  if (flags.red !== undefined) {
    need(typeof flags.red === 'string' && fieldText(flags.red), '--red needs the id of the issue that tracks the cause', () => ({ flag: '--red', value: '<id>' }));
    const tracked = findIssue(root, fieldText(flags.red));
    need(tracked, `--red names an issue that does not exist: ${flags.red}${nothing} — file the cause first`, () => [{ first: ['jarl.mjs', 'new', '<what-is-red>', '--tier', hole('<tier>')] }, { flag: '--red', value: '<the-id-new-prints>' }]);
    need(!issues.some((i) => i.id === tracked.id), `--red names the issue that tracks the cause of a red check outside the branch; ${tracked.id} is the issue being merged${nothing}`, () => ({ flag: '--red', value: '<another-issue>' }));
    cause = tracked.id;
  }
  if (flags.sha === undefined) for (const issue of issues) need(mergedOf(issue), `${issue.id} records no merge yet — ${noMergeHow(root, issue)}${nothing}`, () => ({ flag: '--sha', value: '<sha>' }));
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
  if (sha) notes.push(...mergedAddedNotes(root, issues, sha, repoPath));
  // Said, never refused: a merge is a fact, and recording it is not the place to stop it. A merge whose issue holds
  // no fresh approve went in without the fresh review the rule asks for, and the note says so loudly.
  // Under a done gate with no approve (approve: none), the merge gate stands behind the issue, and no reviewer is owed.
  if (sha && cli) {
    const loop = readLoop(jarlDir(root));
    for (const issue of issues) {
      const g = gateOf(loop, issue.id);
      if (proofSince(g, issue) === 0 && unprovedMechanical(lineStates(loop, issue, g)).length) notes.push(`NO PROOF FROM THE WORKER — ${issue.id} holds no Proof row since ${g.tracked ? sinceText(g.anchor) : 'it was filed'}; ${checkText ? 'the merge check is recorded in the merge record and is not proof' : 'the merge records no check, and a merge is not proof'}, so done refuses until the worker records it:${lineRowForm(issue.id)}`);
    }
  }
  // Said, never refused: a --ran that matches no declared check is recorded as given, and the banner reads it as no check
  // landed; the declared commands are named here, where whoever typed it can still see the mismatch.
  if (sha && checkText) {
    const loop = readLoop(jarlDir(root));
    for (const issue of issues) {
      const declared = [...new Set(repoNames(root, issue).flatMap((n) => declaredFor(loop, n)))];
      if (declared.length && !carriesDeclared({ check: checkText }, declared)) notes.push(`${issue.id}'s merge check "${checkText}" matches no declared check, so this merge does not count as landing on it; the declared ones: ${declared.join(' ; ')}`);
    }
  }
  if (sha && loadProfile(root).doneGate.approve !== 'none') {
    const loop = readLoop(jarlDir(root));
    for (const issue of issues) {
      const g = gateOf(loop, issue.id);
      const uncleared = g.fresh ? null : unclearedText(loop, issue, g);
      if (uncleared) notes.push(`MERGED WITHOUT AN APPROVE THAT CLEARS IT — ${uncleared}; recorded as given, get that approve now: ${jarlLine('review', issue.id, '<verdict>', '--by', '<reviewer>', '<text>')}`);
      else if (!g.fresh) notes.push(`MERGED WITHOUT A FRESH REVIEW — ${issue.id} ${g.live ? freshRuleText({ fields: { merged: sha } }, g.live, g.uncleared?.standing) : 'holds no live approve at all (none, or spent by a later round, restart or reopen) — the fresh-review rule: a code issue needs an approve from a fresh reviewer before it merges'}; recorded as given, get the fresh review now: ${jarlLine('review', issue.id, '<verdict>', '--by', '<a-fresh-reviewer>', '<text>')}`);
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
  const tips = sha ? tipLinesOf(root, issues) : () => [];
  appendLogLines(root, issues.flatMap((issue) => (sha ? [`${issue.id} merged ${sha}${named}`, ...tips(issue)] : [`${issue.id} CI ${ci}`])));
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
// branch, the base or the commit is not here to be read). The branch tip is the branch as it stands now. The base is the
// repository's declared base when the checkout stands for a declared name and the branch exists there, else the branch the
// checkout has open; it is asked for only while the commit is not yet in it: once the base holds the commit, later commits
// on the base are no part of the merge. A commit that lacks the tip but holds every file the branch changed exactly as the
// branch has it is a squash or a rebase merge: it carries the branch's work without its commits, and is named so.
function mergeContentNotes(root, issue, sha, repoPath) {
  const branch = fieldText(issue.fields.branch);
  const repo = (repoPath ? [repoPath] : issueRepoPaths(root, issue)).filter(isGitRepo).find((r) => git(r, ['cat-file', '-e', `${sha}^{commit}`]) !== null);
  if (!repo) return [];
  const holds = (ancestor, ref) => git(repo, ['merge-base', '--is-ancestor', ancestor, ref]) !== null;
  const notes = [];
  const tip = branch ? git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`]) : null;
  const record = jarlLine('merged', issue.id, '--sha', '<sha>');
  if (tip && !holds(tip, sha)) {
    if (holdsChangesOf(repo, tip, sha)) notes.push(`SQUASH OR REBASE MERGE — ${sha} does not contain the commits of ${branch} (tip ${tip.slice(0, 12)}), but holds every file the branch changed exactly as the branch has it, so the branch's work landed without its commits, and the cleanup keeps ${branch} because its tip is in no merge`);
    else notes.push(`MERGE WITHOUT THE BRANCH — ${sha} does not contain the tip of ${branch} (${tip.slice(0, 12)}) and does not hold the files the branch changed as the branch has them, so a check that ran on it did not run on the branch's work; the check runs on the merge result: merge the branch, check the result, and record that commit with ${record}`);
  }
  const base = baseOf(root, repo);
  const baseTip = base !== branch ? git(repo, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]) : null;
  if (baseTip && !holds(sha, baseTip) && !holds(baseTip, sha)) notes.push(`MERGE WITHOUT THE BASE — ${sha} does not contain ${base} as it stands (${baseTip.slice(0, 12)}), so the check ran on a tree the base has moved past; the check runs on the merge result: merge the base into the result, check it again, and record that commit with ${record}`);
  return notes;
}

// What the recorded commit brings into its first parent, as notes: each added line that starts a conflict marker and each
// added file over the size Jarl accepts as an attachment (see addedContentNotes), up to NOTE_LIMIT with the rest counted.
// A commit is read once per repository however many issues share it; a commit that is not here, or has no parent, says nothing.
function mergedAddedNotes(root, issues, sha, repoPath) {
  const found = new Set();
  const all = [];
  for (const issue of issues) {
    const repo = (repoPath ? [repoPath] : issueRepoPaths(root, issue)).filter(isGitRepo).find((r) => git(r, ['cat-file', '-e', `${sha}^{commit}`]) !== null);
    if (!repo || found.has(canonical(repo))) continue;
    found.add(canonical(repo));
    if (git(repo, ['rev-parse', '--verify', '--quiet', `${sha}^1`]) === null) continue;
    all.push(...addedContentNotes(repo, `${sha}^1..${sha}`));
  }
  const shown = all.slice(0, NOTE_LIMIT).map((n) => `${addedNoteText(n)} (brought in by the merge)`);
  return all.length > NOTE_LIMIT ? [...shown, `… and ${all.length - NOTE_LIMIT} more notes about what the merge brought in not shown`] : shown;
}

// Whether `sha` holds what `tip` changed on its way from the commit they share: every file the branch changed is, in `sha`,
// exactly as the branch has it (a deletion included), and the branch changed at least one. A squash or a rebase merge
// does; a commit made without the branch's work does not.
function holdsChangesOf(repo, tip, sha) {
  const mb = git(repo, ['merge-base', tip, sha]);
  if (!mb) return false;
  const changed = (git(repo, ['diff', '--name-only', '--no-renames', '-z', mb, tip]) || '').split('\0').filter(Boolean);
  if (!changed.length) return false;
  // The paths ride the command line, so they go in groups that stay under the shortest limit a platform has.
  for (let at = 0; at < changed.length;) {
    let size = 0;
    const group = [];
    while (at < changed.length && (!group.length || size + changed[at].length < 8000)) { size += changed[at].length + 1; group.push(changed[at]); at += 1; }
    const differ = git(repo, ['--literal-pathspecs', 'diff', '--name-only', '-z', tip, sha, '--', ...group]);
    if (differ === null || differ !== '') return false;
  }
  return true;
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
  // The approve's tips are one for each repository the issue names. A repository that is not on this machine keeps its place
  // among them and is not compared, so the others still are and a tip that did not move is not said to have moved; tips that
  // count another number of repositories than the issue names are compared against the ones that are here.
  const slots = issueRepoSlots(root, issue);
  const repos = was.length === slots.length ? slots : slots.filter(Boolean);
  const is = repos.map((dir) => (dir && isGitRepo(dir) ? git(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`]) : null));
  const unmoved = was.length === repos.length && repos.every((dir, k) => !dir || is[k] === was[k]);
  if (!is.some(Boolean) || unmoved) return [];
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
  const again = `if it was meant to land, record a review of the tip that landed: ${jarlLine('review', issue.id, '<verdict>', '--by', '<a-fresh-reviewer>', '<text>')}`;
  const head = `APPROVED ON ANOTHER TIP — ${issue.id}'s approve ${who} was recorded on ${branch}`;
  if (was.length !== repos.length) return [`${head} at ${was.map(short).join(', ')}, and the branch stands at ${is.map((s) => (s ? short(s) : 'gone')).join(', ')} at this merge, so that review did not see what changed between them; recorded as given, ${again}`];
  const here = repos.map((dir) => Boolean(dir) && isGitRepo(dir) && git(dir, ['cat-file', '-e', `${sha}^{commit}`]) !== null);
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
  if (repos.filter(Boolean).length === 1) {
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
// "<command>" --saw "<what-it-printed>" appends one checkable row per pair instead — repeat the pair,
// in one call or across calls, one row per acceptance line. Both append to the same section, never
// replace it: the merger's free-text note lands after the worker's rows. `set done` needs the section
// non-empty, rows or not (not every issue's proof is a command).
//
// evidence <id> --retract <n> --by <who> "<text>" retracts the n-th row (numbered over the whole Evidence section, as
// show prints it) by an appended entry: the row stays, struck through, the entry names who retracted it and why, and
// the done gate stops counting it. It only tightens: a row is taken away, never added or revived.
// The --ran/--saw rows of a call, checked: each --ran has its --saw, each with a value.
function rowsOf(flags) {
  const rans = [].concat(flags.ran ?? []);
  const saws = [].concat(flags.saw ?? []);
  need(rans.length && saws.length && [...rans, ...saws].every((v) => typeof v === 'string' && v.trim()), 'a row needs both --ran "<command>" and --saw "<what-it-printed>", each with a value', () => (!rans.length || rans.some((v) => typeof v !== 'string' || !v.trim()) ? { flag: '--ran', value: '<command>' } : { flag: '--saw', value: '<what-it-printed>' }));
  // The flag given fewer times is given once more, after the ones the call holds.
  need(rans.length === saws.length, `--ran and --saw must repeat the same number of times (got ${rans.length} --ran, ${saws.length} --saw)`, () => (rans.length > saws.length ? { flag: '--saw', value: '<what-it-printed>', add: true } : { flag: '--ran', value: '<command>', add: true }));
  return rans.map((ran, i) => ({ ran, saw: saws[i] }));
}

// A loop whose profile keeps close or archive to the record ("lifecycle") refuses them from the command line and the
// MCP tools (caller 'cli'), naming the composer's command; a library caller ('record', the default) passes.
export function needLifecycle(root, op, caller = 'record') {
  need(SET_CALLERS.includes(caller), `caller must be one of: ${SET_CALLERS.join(', ')} (got "${caller}")`, () => (['jarl.mjs', 'set', '<ids>', '<status>', '<text>']));
  if (caller !== 'cli') return;
  const profile = loadProfile(root);
  need(profile.lifecycle[op] !== 'record', `this loop is ${op === 'close' ? 'closed' : 'archived'} by the tool that runs it, never by jarl ${op} — its profile (${profile.name}) marks "lifecycle": { "${op}": "record" }, so jarl ${op} and the MCP tools refuse, and nothing was ${op === 'close' ? 'closed or removed' : 'moved'}${profile.lifecycle.command ? `; run: ${profile.lifecycle.command}` : ''}`, () => (profile.lifecycle.command ? { external: profile.lifecycle.command } : { flag: hole('<the-command-of-the-tool-that-runs-this-loop>') }));
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
export { shellWord };
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
    const base = baseOf(root, repo);
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
  for (const op of ops) need(/^[+-]./.test(op), `tags are +name or -name, not "${op}"`, () => (['jarl.mjs', 'field', '<ids>', 'Tags', '--add', '<tag>']));
  const results = issues.map((issue) => {
    const tags = new Set(issue.tags);
    // A slice tag is removed in any case: -slice:odin takes slice:Odin off too, as the two name one slice.
    const sameTag = (t, name) => t === name || (isSliceTag(name) && t.toLowerCase() === name.toLowerCase());
    for (const op of ops) { if (op.startsWith('+')) tags.add(op.slice(1)); else for (const t of [...tags]) if (sameTag(t, op.slice(1))) tags.delete(t); }
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
  for (const r of results) needOneSlice(r.tags, { id: r.issue.id, held: r.issue.tags });
  // The mark of an issue worked in place goes on an issue with no branch and no merge: code is merged from its branch.
  const marked = results.filter((r) => r.tags.includes(IN_PLACE_TAG) && !r.issue.tags.includes(IN_PLACE_TAG));
  for (const r of marked) need(!carriesCode(r.issue), `${r.issue.id} carries code (${r.issue.fields.merged ? 'Merged' : 'Branch'} is recorded), which its merge lands: an issue worked in place has no branch and no merge, so it is not tagged ${IN_PLACE_TAG}`, () => ({ arg: 2, value: hole('<items>') }));
  if (marked.length) needFormat(root, 'in-place');
  logChanges(root, results.map((r) => fieldLine(r.issue.id, 'Tags', r.tags.join(', '), heldField(r.issue, 'Tags'), by)));
  for (const r of results) writeAtomic(r.issue.file, setField(readText(r.issue.file), 'Tags', r.tags.join(', ')));
  return oneOrMany(rawIds, results.map(out));
}

export function cmdPrio(root, rawIds, prio, by = undefined) {
  need(PRIORITIES.includes(String(prio)), 'priority is 1, 2 or 3', () => (['jarl.mjs', 'field', '<ids>', 'Priority', '<prio>']));
  const editor = editorOf(by);
  const issues = issuesFor(root, rawIds);
  logChanges(root, issues.map((issue) => fieldLine(issue.id, 'Priority', String(prio), heldField(issue, 'Priority'), editor)));
  for (const issue of issues) writeAtomic(issue.file, setField(readText(issue.file), 'Priority', String(prio)));
  return oneOrMany(rawIds, issues.map((issue) => ({ id: issue.id, priority: String(prio) })));
}

export function cmdFiles(root, rawId, list, dry = false, by = undefined) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}${listAll()}`, () => ({ replace: rawId, value: '<id>' }));
  const editor = editorOf(by);
  const files = pathList(list);
  needFreeOfOtherLeases(root, issue, files.filter((f) => !issue.files.includes(f)), [], { files });
  if (!dry) {
    logChanges(root, [fieldLine(issue.id, 'Files', files.join(', '), heldField(issue, 'Files'), editor)]);
    writeAtomic(issue.file, setField(readText(issue.file), 'Files', files.join(', ')));
  }
  return { id: issue.id, files };
}

export function cmdRepo(root, rawId, path, { clear = false, dry = false, by } = {}) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}${listAll()}`, () => ({ replace: rawId, value: '<id>' }));
  const editor = editorOf(by);
  if (clear) {
    need(issue.fields.repo, `${issue.id} has no Repo field to clear`, () => ({ rename: '--clear', to: hole('<no-flag-here>') }));
    if (dry) return { id: issue.id, repo: null, cleared: true };
    logChanges(root, [fieldLine(issue.id, 'Repo', '', issue.fields.repo, editor)]);
    const text = removeFirstField(readText(issue.file), 'Repo');
    writeAtomic(issue.file, text);
    return { id: issue.id, repo: null, cleared: true };
  }
  need(path !== undefined, 'repo requires <name-or-path> — the repository the issue\'s code lives in (its name, its checkout, a worktree of it or a file inside it), several as one comma list (or --clear to remove the field)', () => (['jarl.mjs', 'field', '<ids>', 'Repo', '<name-or-path>']));
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
