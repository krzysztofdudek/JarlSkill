// The split command.

import { hole, jarlLine, need } from './base.mjs';
import { readText, writeAtomic } from './files.mjs';
import { idKey } from './ids.mjs';
import { PARENT_FIELD, loadProfile } from './profile.mjs';
import { PROPOSED, acceptanceHeading, acceptanceLines, acceptanceText, issueNamed, loadIssues, setField, setSection } from './issues.mjs';
import { listAll, needLiveLoop } from './shared.mjs';
import { bodyLine, editorOf, fieldLine, heldField, itemsOf, logChanges, rowsLostNote } from './body.mjs';
import { needUnder } from './setters.mjs';

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
  // The parent's section with the moved lines taken out, the rest as it stands; each sub-issue's with its lines added.
  let k = 0;
  const keptText = (parent.sections.acceptance || '').split('\n').filter((raw) => {
    const l = raw.trim().replace(/^- /, '');
    if (l === '' || l.startsWith(PROPOSED)) return true;
    k += 1;
    return idKey(placed.get(k).to.id) === idKey(parent.id);
  }).join('\n').trim();
  const moved = (sub) => lines.filter((_, n) => placed.get(n + 1).to === sub);
  const writes = [{ issue: parent, now: keptText }, ...subs.map((sub) => ({ issue: sub, now: acceptanceText([...itemsOf(sub.sections.acceptance), ...moved(sub)]) }))];
  logChanges(root, [
    ...joining.map((sub) => fieldLine(sub.id, PARENT_FIELD, parent.id, heldField(sub, PARENT_FIELD), by)),
    ...writes.map((w) => bodyLine(w.issue.id, 'acceptance', w.issue.sections.acceptance, w.now, by)),
  ]);
  for (const w of writes) {
    let text = setSection(readText(w.issue.file), acceptanceHeading(w.issue, profile), w.now);
    if (joining.includes(w.issue)) text = setField(text, PARENT_FIELD, parent.id);
    writeAtomic(w.issue.file, text);
  }
  // A row names the text it proved: a split that takes a line a row names off the parent says so, as field does.
  const rowsLost = rowsLostNote(parent, parent.sections.acceptance, keptText);
  const notes = rowsLost ? [rowsLost] : [];
  return {
    id: parent.id, subs: subs.map((s) => s.id),
    lines: [...placed.entries()].sort((a, b) => a[0] - b[0]).map(([n, p]) => ({ line: n, to: p.to.id, kept: idKey(p.to.id) === idKey(parent.id) })),
    ...(notes.length ? { notes } : {}),
  };
}
