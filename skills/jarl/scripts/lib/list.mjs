// The list command.

import { PRIORITIES, fieldText, hole, need } from './base.mjs';
import { readText } from './files.mjs';
import { cmpId } from './ids.mjs';
import { PARENT_FIELD, TOOL_FIELDS, loadProfile } from './profile.mjs';
import { loadIssues, parentCycle } from './issues.mjs';

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
