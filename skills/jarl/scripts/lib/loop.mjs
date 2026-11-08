// The loaded loop: every issue with the state the log gives it, read once into one value.

import { existsSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { echoWord, fieldText, jarlLine, need } from './base.mjs';
import { jarlDir } from './where.mjs';
import { idKey, idsCited, keyedIds } from './ids.mjs';
import { botNames, profileAt } from './profile.mjs';
import { asksAt, decisionsAt, goalLines, readGoal } from './journal.mjs';
import { eventsById, loopEvents } from './log.mjs';
import { issuesAt } from './issues.mjs';
import { coordinatorsIn } from './slices.mjs';

// The refusal of a command that needs a loop where there is none: the directory the call looked in (echoed in single
// quotes with its line breaks escaped, as the words of a call are, so it can neither start a line nor run when the text is
// pasted), the --root that names the directory holding .jarl/, and the form that opens a loop in the root the call named.
export function needLoop(root) {
  need(existsSync(jarlDir(root)), `no loop here: ${echoWord(root)} holds no .jarl/ — open one with ${jarlLine('init', '<goal>')}, or pass --root "<loop-root>", the directory that holds .jarl/`, () => (['jarl.mjs', 'init', '<goal>']));
}

// ---- the loaded loop -------------------------------------------------------------------------------
//
// A command reads the loop once, into one value, and hands it to the gate, the views and models; nothing a function
// needs about the record is looked up again or kept in a module-level table. The value of readLoop(dir), with `dir`
// the directory holding the record (a loop's .jarl/, or an archived loop's directory):
//   dir, root     the record's directory, and the directory whose name is the loop's own (the one holding .jarl/, or
//                 the archive directory itself)
//   profile       the loop's profile
//   issues        every issue, in order; byId, the same by id
//   events        every dated line of the log, typed (see parseEvent); eventsById, the events of each issue
//   goal          the text of the goal, or null; goalLines, what it carries for the tool (see goalLines)
//   asks          the questions; decisions, the rulings
//   coordinators  the names that review as the loop's director
//   bots          the names of the bots the profile's done gate names
//   branchWorkers every worker leased on each Branch, across every issue that records it
// goal, goalLines, asks, decisions, coordinators, bots and branchWorkers are read on first use.
export function readLoop(dir) {
  const root = basename(dir) === '.jarl' ? dirname(dir) : dir;
  const profile = profileAt(dir);
  const events = loopEvents(dir, profile);
  return makeLoop({ dir, root, profile, issues: issuesAt(dir, profile, events), events });
}

function makeLoop({ dir, root, profile, issues, events }) {
  const loop = { dir, root, profile, issues, byId: new Map(issues.map((i) => [i.id, i])), events, eventsById: eventsById(events) };
  // A number the log cannot attribute (two files carry it, or the log files it more than once) has no log lines of its
  // own: its rows, approves, rounds and merges may be another issue's, so no view or gate reads any of them for it.
  for (const i of issues) if (i.byHeader) loop.eventsById.set(i.id, []);
  const once = (make) => { let made = false; let value; return () => { if (!made) { value = make(); made = true; } return value; }; };
  const reads = {
    goal: once(() => readGoal(dir)),
    goalLines: once(() => goalLines(loop.goal)),
    asks: once(() => asksAt(dir)),
    decisions: once(() => decisionsAt(dir)),
    coordinators: once(() => coordinatorsIn(root, loop.goalLines)),
    bots: once(() => botNames(profile)),
    branchWorkers: once(() => branchWorkersOf(loop)),
  };
  for (const [key, read] of Object.entries(reads)) Object.defineProperty(loop, key, { enumerable: true, get: read });
  return loop;
}

// The same loop over some of its issues (the ones a view is scoped to): the gate looks up an issue and the branch it
// shares with others among these, as the view does.
export function scopedLoop(loop, issues) { return makeLoop({ dir: loop.dir, root: loop.root, profile: loop.profile, issues, events: loop.events }); }

// The issues an unfinished issue's What, Why or Acceptance names by number (see idsCited) while the order does not hold
// them together: the named issue is unsettled (not done or dropped), is not among the issues the naming one waits on
// through After, directly or through the chain, and does not itself wait on the naming one that way. Each is
// { id, names: [ids] }, in the order of the issues. Only these are listed for the issues in `only` when it is given.
// The text relies on the named issue, and nothing orders the two: a note, never a refusal.
export function unorderedNamings(issues, profile, only = null) {
  const held = new Map(issues.filter((i) => i.id !== null).map((i) => [i.id, i]));
  const byKey = new Map([...held.values()].map((i) => [idKey(i.id), i]));
  const keyed = keyedIds(held);
  // Whether `issue` waits on the issue with `id` through After, directly or through the chain: a walk that stops at the
  // first sight of it and visits each issue once.
  const waitsOn = (issue, id) => {
    const want = idKey(id);
    const seen = new Set();
    const stack = [...issue.after];
    while (stack.length) {
      const key = idKey(stack.pop());
      if (key === want) return true;
      if (seen.has(key)) continue;
      seen.add(key);
      stack.push(...(byKey.get(key)?.after || []));
    }
    return false;
  };
  const heading = (profile.acceptance || 'Acceptance').toLowerCase();
  const out = [];
  for (const issue of issues) {
    if (issue.id === null || !profile.unfinished(issue.status) || (only && !only.includes(issue.id))) continue;
    const text = [issue.sections.what, issue.sections.why, issue.sections[heading]].filter(Boolean).join('\n');
    const cited = idsCited(text, held, keyed).filter((id) => idKey(id) !== idKey(issue.id) && !profile.is(held.get(id).status, 'settles-dependents'));
    const names = cited.filter((id) => !waitsOn(issue, id) && !waitsOn(held.get(id), issue.id));
    if (names.length) out.push({ id: issue.id, names });
  }
  return out;
}

// The note a text that names unordered issues gets, on one line: the same words from verify, new and field.
export function unorderedText(n) {
  const [noun, it, is] = n.names.length === 1 ? ['issue', 'it', 'is'] : ['issues', 'them', 'are'];
  return `names ${noun} ${n.names.join(', ')} in What, Why or Acceptance, which ${is} neither done nor dropped, and no After orders ${it} with ${n.id} — if the text relies on ${it}, order the two by adding ${it} to After, which keeps what After holds: ${jarlLine('field', n.id, 'After', '<ids-it-waits-on>', '--add')}`;
}

// Every worker one issue's own journal has ever named on an in-progress move — a takeover replaces Worker but
// is still the same issue, so every lease across every round counts, not only the latest.
export function leaseWorkers(events) {
  const workers = new Set();
  for (const e of events) if (e.type === 'move' && e.lease) workers.add(e.lease.worker);
  return workers;
}

// Every worker ever leased on a Branch, across every issue of the loop that records it (a package leased once for
// several issues, or one folded into the branch later by a bare `set <ids> in-progress --branch <b>` with no
// --worker of its own, is still one branch). The loop holds it, built once on first use.
function branchWorkersOf(loop) {
  const map = new Map();
  for (const i of loop.issues) {
    const branch = fieldText(i.fields.branch);
    if (!branch) continue;
    const set = map.get(branch) || new Set();
    for (const w of leaseWorkers(loop.eventsById.get(i.id) || [])) set.add(w);
    if (i.fields.worker) set.add(fieldText(i.fields.worker));
    map.set(branch, set);
  }
  return map;
}
