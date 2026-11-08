// The writers of one field of an issue behind field and set: declared fields, kept fields, the parent and resources.

import { WAIT_KIND, fieldText, hole, jarlLine, need } from './base.mjs';
import { readText, writeAtomic } from './files.mjs';
import { idKey, isBulk } from './ids.mjs';
import { PARENT_FIELD, loadProfile } from './profile.mjs';
import { fieldValue, issueNamed, loadIssues, removeFields, removeFirstField, setField, waitCycle } from './issues.mjs';
import { needFormat, needFormatHeld } from './repositories.mjs';
import { eachIssue, inCall, issuesFor, listAll, oneOrMany } from './shared.mjs';
import { cmdAfter, editorOf, fieldLine, heldField, keptValue, logChanges } from './body.mjs';
import { needFreeOfOtherLeases, needNoLeaseFlags, resourceNames } from './leases.mjs';
import { cmdRepo } from './tags.mjs';

// The optional header fields of the tool's own that field --clear empties.
export const EMPTIED_BY_FIELD = { files: 'Files', source: 'Source', where: 'Where', tags: 'Tags', after: 'After', repo: 'Repo' };

// field <ids> <field> <value>: one declared field (or Priority, Tier, Kind, Found by) written on every issue in the call,
// checked against its enum first, with one log line each. An empty value clears it, unless the field is required or built in.
export function setDeclaredField(root, rawIds, field, value, flags) {
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
export function setKeptField(root, rawIds, name, value, flags) {
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
export function setParent(root, rawIds, value, flags) {
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
export function needUnder(all, profile, issues, parent, nothing, ready) {
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

// field <ids> <Files|Source|Where|Tags|After|Repo> --clear: the field is emptied (After and Repo as their own commands empty them).
export function emptyOwnField(root, rawIds, name, flags) {
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

export function setResources(root, rawIds, value, flags) {
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
