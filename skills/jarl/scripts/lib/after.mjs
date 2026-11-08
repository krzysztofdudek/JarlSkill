// What an issue waits on, and the lists of files, sources and ids read from a value.

import { fieldText, hole, need, splitList } from './base.mjs';
import { portablePath } from './where.mjs';
import { expandIds, idKey, itemNaming } from './ids.mjs';
import { DEFAULT_PROFILE } from './profile.mjs';
import { issueNamed, loadIssues, waitCycle } from './issues.mjs';
import { unorderedNamings, unorderedText } from './loop.mjs';
import { askedAs, listAll } from './shared.mjs';

// The placeholder of the keys the files of one number carry: which file gets the free number is the caller's choice.
export function keysOf(files) {
  const keys = files.map((i) => fieldText(i.fields.key ?? '')).filter(Boolean);
  return hole('<key>');
}

// The notes for the text of an issue just written: one for the unfinished issues it names that nothing orders with it.
export function unorderedNotes(root, profile, id) {
  return unorderedNamings(loadIssues(root), profile, [id]).map((n) => `note: issue ${n.id}: ${unorderedText(n)}`);
}

export function pathList(v) { return splitList(v).map((p) => portablePath(p)); }

// A Source entry names one finding for good: the report's directory (dated, so unique) and the finding's id
// inside it, <dir>#<id>. Several are one comma list.
export function sourceList(v) {
  const list = splitList(v);
  for (const s of list) need(/^[^#\s]+#[^#\s]+$/.test(s), `a source is <report-dir#finding-id>, e.g. core/research/2026-09-25-jarl#jarl-2-B2 — not "${s}"`, () => ({ replace: s, value: '<report-dir#finding-id>' }));
  return list;
}

// The issues one waits on: each must exist and not be the issue itself, and the chain must not come back to
// it — a cycle would leave every issue in it waiting for good with nothing to say so.
export function afterList(root, selfId, raw) {
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
