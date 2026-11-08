// The commands that file an issue: new and renumber.

import { existsSync, mkdirSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { PRIORITIES, TIERS, WAIT_KIND, afterView, echoWord, fieldText, hole, jarlLine, need, slugify, splitList } from './base.mjs';
import { needNoNewOwnersWords, needNoOwnersWords } from './owner.mjs';
import { issuesDir, jarlDir, stamp } from './where.mjs';
import { readText } from './files.mjs';
import { ISSUE_FILE_RE, idKey, idRe, needsRaisedFormat, newIssueKey, newNumber } from './ids.mjs';
import { FORMAT_LINES, formatState, loadProfile, numberWidth } from './profile.mjs';
import { appendLogLines } from './journal.mjs';
import { acceptanceHeading, acceptanceText, bodyText, changelogText, fieldValue, loadIssues, namedPairs, needNoFieldTags, parseIssue, renderIssue } from './issues.mjs';
import { commitRepoNames, mainCheckoutOf, needFormat, needFormatHeld, repoList, reposNamed } from './repositories.mjs';
import { IN_PLACE_TAG } from './gate.mjs';
import { needOneSlice } from './slices.mjs';
import { needMarkedLines } from './lines.mjs';
import { listAll, needLiveLoop } from './shared.mjs';
import { claimFile, readTemplate } from './init.mjs';
import { declaredRange, needRoomIn, nextIssueNumber, numberAfter, rangeAt, rangesOf } from './numbers.mjs';
import { afterList, keysOf, pathList, sourceList, unorderedNotes } from './after.mjs';
import { keptValue } from './body.mjs';

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
