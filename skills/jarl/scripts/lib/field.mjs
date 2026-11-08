// The commands that write one field or one section of an issue: field, extend and the lists.

import { existsSync } from 'node:fs';
import { PRIORITIES, Refusal, afterView, fieldText, hole, jarlLine, need, noSeparators, refuse, splitList } from './base.mjs';
import { needNoOwnersWords } from './owner.mjs';
import { normalPath } from './where.mjs';
import { readText, writeAtomic } from './files.mjs';
import { idKey, isBulk } from './ids.mjs';
import { BUILTIN_STATUSES, LIFECYCLE_OPS, PROFILE_VERSION, describeProfile, forgetProfile, loadProfile, profilePath, reservedProblem, validateProfile } from './profile.mjs';
import { appendLog } from './journal.mjs';
import { findIssue } from './issues.mjs';
import { repoList } from './repositories.mjs';
import { eachIssue, fieldsWritten, listAll, needLiveLoop, sectionsOf, setRoute } from './shared.mjs';
import { cmdAfter, cmdBody, cmdSource, editorOf } from './body.mjs';
import { needFreeOfOtherLeases, resourceNames } from './leases.mjs';
import { EMPTIED_BY_FIELD, emptyOwnField, setDeclaredField, setKeptField, setParent, setResources } from './setters.mjs';
import { cmdFiles, cmdRepo, cmdTag, cmdTagList } from './tags.mjs';

// The header fields of the tool's own that hold a list, each item one name or path: field adds and removes items of these.
const LIST_KEYS = ['tags', 'files', 'repo', 'after', 'source', 'resources'];

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
  if (['branch', 'worker', 'model', 'since', 'worktree'].includes(key)) return `the lease (Branch, Worker, Model, Since) is written by set: ${jarlLine('set', '<ids>', 'in-progress', '<text>', '--branch', '<worker-branch>', '--worker', '<name>', '--model', '<model-id>')}`;
  if (['merged', 'merge check', 'ci'].includes(key)) return `a merge and its CI are recorded by merged: ${jarlLine('merged', '<ids>', '--sha', '<sha>')}`;
  if (['notes', 'proof'].includes(key)) return `a note or a row of proof is added by evidence: ${jarlLine('evidence', '<ids>', '<text>')}, or ${jarlLine('evidence', '<ids>', '--ran', '<command>', '--saw', '<what-it-printed>', '--line', '<line-number>', '--by', '<who>')}`;
  if (key === 'evidence' || key === 'reviews') return `the history is never edited: a note or a row is added by evidence and a verdict by review, a row or an approve is taken back by retract, a ruling replaced by decide --supersedes: ${jarlLine('retract', '<id>', '<n>', '--by', '<who>', '<text>')}`;
  return `no other part goes by that name: a field or a section the loop's profile declares is among the names above, and the profile lists them: ${jarlLine('profile')}`;
}

// extend section "<name>" | extend field "<name>" [--values <a,b>] [--default <value>] [--required]: the profile of a live
// loop gains one section or one field, checked as profile <file> checks a profile file, with a log line after it. A
// loop with no profile of its own gets one: the built-in statuses and the part. The
// issues already filed are not rewritten: each carries the part once field writes it, and a new issue is filed with it (a
// field's default, when it has one and none is given). Kind and Tier keep the values the loop was opened with. The profile
// of a loop that keeps its lifecycle to the record is its own tool's, and is never changed here.
export function cmdExtend(root, part, name, flags = {}) {
  needLiveLoop(root, '');
  const profile = loadProfile(root);
  const kept = LIFECYCLE_OPS.some((op) => profile.lifecycle[op] === 'record');
  if (kept) refuse(`this loop is run by a tool of its own (its profile, ${profile.name}, keeps its lifecycle to the record), and its profile is that tool's: extend changes nothing in it — nothing was written`, profile.lifecycle.command ? { external: profile.lifecycle.command } : afterView(['jarl.mjs', 'profile']));
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
    const base = raw && loadProfile(root).declared ? raw : { 'jarl-profile': PROFILE_VERSION, statuses: BUILTIN_STATUSES, initial: 'open' };
    const json = kind === 'section' ? { ...base, sections: [...(base.sections || []), label] } : { ...base, fields: { ...(base.fields || {}), [label]: spec } };
    try { return { json, profile: validateProfile(json, `the profile with the ${kind} ${label}`) }; } catch (e) { if (e instanceof Refusal) refuse(e.reason, { retry: true }); throw e; }
  };
  extended();
  const reserved = reservedProblem(validateProfile({ 'jarl-profile': PROFILE_VERSION, statuses: BUILTIN_STATUSES, ...(kind === 'section' ? { sections: [label] } : { fields: { [label]: spec } }) }));
  need(!reserved, `the ${kind} ${label} is not added: ${reserved}`, () => ({ arg: 1, value: hole('<name>') }));
  const words = kind === 'section' ? `section ${label}` : `field ${label}${[spec.enum && `values ${spec.enum.join(', ')}`, spec.default && `default ${spec.default}`, spec.required && 'required'].filter(Boolean).map((w) => `; ${w}`).join('').replace(/^; /, ': ')}`;
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
  const out = results.map((o) => ({ id: o.id, field: heading, value: fieldText(sectionOf(root, o.id, heading)), ...(o.note ? { note: o.note } : {}) }));
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
