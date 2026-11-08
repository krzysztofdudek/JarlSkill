// The commands that write a list of an issue by name: tag, prio, files and repo.

import { PRIORITIES, fieldText, hole, need, splitList } from './base.mjs';
import { readText, writeAtomic } from './files.mjs';
import { findIssue, removeFirstField, setField } from './issues.mjs';
import { commitRepoNames, needFormat, repoList } from './repositories.mjs';
import { IN_PLACE_TAG, carriesCode, isSliceTag, needOneSlice } from './loop.mjs';
import { issuesFor, listAll, oneOrMany } from './shared.mjs';
import { pathList } from './after.mjs';
import { editorOf, fieldLine, heldField, logChanges } from './body.mjs';
import { needFreeOfOtherLeases } from './leases.mjs';

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
export function cmdTagList(root, rawIds, value, by) {
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
