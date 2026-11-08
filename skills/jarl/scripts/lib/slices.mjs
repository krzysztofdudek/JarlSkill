// The coordinators and the slices of a loop: who the coordinators are, what a slice holds and what is in play.

import { resolve, basename } from 'node:path';
import { fieldText, hole, jarlLine, need } from './base.mjs';
import { jarlDir } from './where.mjs';
import { goalLines, readGoal } from './journal.mjs';

// Who reviewed, as a kind: the word self, or anyone who has ever held the issue's lease — its own worker across
// every takeover, and the worker of any other issue sharing its Branch (a package, or an issue folded into the
// same branch later) — is self too; the loop's own director — coordinator, jarl, reeve, the loop's own name (the
// directory holding .jarl/) and any name the goal declares on a `Coordinators: a, b` line (coordinator); a bot the
// profile's done gate names (bot); anyone else (fresh). A name is compared without case and surrounding space. `worker`
// is a name, or a set of them.
export const BASE_COORDINATORS = ['coordinator', 'jarl', 'reeve'];

export function reviewerKind(by, worker, coordinators = BASE_COORDINATORS, bots = []) {
  const b = fieldText(by).toLowerCase();
  const workers = worker == null ? [] : typeof worker === 'string' ? [worker] : [...worker];
  if (b === 'self' || workers.some((w) => b === fieldText(w).toLowerCase())) return 'self';
  if (coordinators.some((c) => fieldText(c).toLowerCase() === b)) return 'coordinator';
  if (bots.some((n) => fieldText(n).toLowerCase() === b)) return 'bot';
  return 'fresh';
}

// The names that review as the loop's director in this loop: the fixed three, the loop's own name, and the names
// a `Coordinators:` line of the goal lists (see goalLines).
export function coordinatorNames(root) { return coordinatorsIn(root, goalLines(readGoal(jarlDir(root)))); }

export function coordinatorsIn(root, lines) { return [...BASE_COORDINATORS, basename(resolve(root)), ...lines.coordinators]; }

// ---- slices ----------------------------------------------------------------------------------------
//
// A slice is the part of the backlog one coordinator runs: the issues tagged slice:<coordinator>, the coordinator being a
// name the goal's Coordinators line lists. The line names the coordinators and each one's slice is its name, so a reader
// that knows no slices reads the same line as the names that review as the loop's director. An issue is in one slice
// at most; an issue in none is the jarl's.
export const SLICE_PREFIX = 'slice:';

export const isSliceTag = (t) => String(t).toLowerCase().startsWith(SLICE_PREFIX);

export function sliceTag(coordinator) { return `${SLICE_PREFIX}${coordinator}`; }

// The coordinator whose slice an issue is in, as its tag names it, or null. A sub-issue with no slice tag of its own is
// in the slice of the nearest issue above it that carries one, so a slice can be a subtree.
export function sliceOf(issue) {
  for (const i of [issue, ...(issue.tree ? issue.tree.ancestors : [])]) {
    const tag = (i.tags || []).find(isSliceTag);
    if (tag) return tag.slice(SLICE_PREFIX.length);
  }
  return null;
}

// Who holds an issue's rows of work: the coordinator whose slice it is in, written as the Coordinators line writes the
// name (as the tag writes it when the line does not list it), or the jarl for an issue in no slice.
export function coordinatorOf(loop, issue) {
  const slice = sliceOf(issue);
  if (slice === null) return 'jarl';
  return loop.goalLines.coordinators.find((c) => sameSlice(c, slice)) ?? slice;
}

// The branch a slice with a merger of its own lands its work on, cut from the feature branch and merged back into it with
// its check, as any landing.
export const integrationBranch = (slice) => `jarl/slice-${slice}`;
// The merger of an issue's slice as the goal names it, { slice, name }, or null when the slice has none of its own.
export function sliceMerger(lines, issue) {
  const slice = sliceOf(issue);
  return slice === null ? null : lines.mergers[slice.toLowerCase()] ?? null;
}

// The same coordinator, in any case: slice:Odin and slice:odin are one slice.
export const sameSlice = (a, b) => a !== null && b !== null && fieldText(a).toLowerCase() === fieldText(b).toLowerCase();

// A write of an issue's tags keeps one slice tag at most, and a slice tag names its coordinator; slice names compare in any
// case, so slice:Odin beside slice:odin is a second tag of one slice and refused too. `held` is what the issue carries
// now, so a refusal says how to move it from the slice it is in, removing every slice tag it holds.
export function needOneSlice(tags, { id = null, held = [] } = {}) {
  const slices = [...new Set(tags.filter(isSliceTag))];
  for (const t of slices) need(t.length > SLICE_PREFIX.length, `${t} names no coordinator: a slice is the tag slice:<coordinator>, the coordinator a name of the goal's Coordinators line`, () => ({ replace: t, value: '<slice:coordinator>' }));
  if (slices.length <= 1) return;
  const heldSlices = held.filter(isSliceTag);
  const was = heldSlices[0];
  const to = was && slices.find((t) => !heldSlices.some((h) => h.toLowerCase() === t.toLowerCase()));
  const same = was && !to ? slices.find((t) => !heldSlices.includes(t)) : null;
  // The tags to take off and the one to add are named, never written into a command: which slice the issue goes to is the
  // caller's to say, so the steps below the reason are forms.
  need(false, id !== null && was && to
    ? `${id} is in ${was} already, and an issue is in one slice — to move it, take ${heldSlices.join(' and ')} off with field --remove first, then add ${to} with field --add`
    : id !== null && same
      ? `${id} is in ${was} already, and ${same} names the same slice in another case — an issue carries one slice tag`
      : `an issue is in one slice, and ${id !== null ? `${id} would carry` : 'the tags name'} ${slices.join(', ')} — keep one${id !== null ? '' : `, e.g. --tags ${slices[0]}`}`, () => (id !== null && was && to ? [{ first: ['jarl.mjs', 'field', hole('<ids>'), 'Tags', hole('<tag>'), '--remove'] }, { retry: true }] : { retry: true }));
}

// The slices of a loop: each coordinator the Coordinators line names, with its slice tag, then each slice a tag names
// whose coordinator the line does not list (declared false: its coordinator's approve counts as fresh). inPlay counts the
// issues of the slice still in play (open or in progress).
export function slicesOf(loop) {
  const { profile } = loop;
  const out = new Map();
  for (const name of loop.goalLines.coordinators) if (!out.has(name.toLowerCase())) out.set(name.toLowerCase(), { coordinator: name, tag: sliceTag(name), declared: true, inPlay: 0 });
  for (const i of loop.issues) {
    const name = sliceOf(i);
    if (name === null) continue;
    if (!out.has(name.toLowerCase())) out.set(name.toLowerCase(), { coordinator: name, tag: sliceTag(name), declared: false, inPlay: 0 });
    if (profile.active(i.status)) out.get(name.toLowerCase()).inPlay += 1;
  }
  return [...out.values()];
}

// The coordinator a --slice names, as the record writes it: a name of the Coordinators line (`coordinators`) or of a
// slice tag one of `issues` carries, in any case. Any other name is refused, naming the slices there are.
export function sliceNamed(coordinators, issues, name) {
  need(typeof name === 'string' && fieldText(name), '--slice names a coordinator: its slice is the issues tagged slice:<coordinator>', () => ({ flag: '--slice', value: '<coordinator>' }));
  const known = [...coordinators, ...issues.map(sliceOf).filter((s) => s !== null)];
  const found = known.find((k) => sameSlice(k, name));
  const names = [...new Map(known.map((k) => [k.toLowerCase(), k])).values()];
  need(found !== undefined, `no coordinator ${fieldText(name)} on the goal's Coordinators line and no issue tagged ${sliceTag(fieldText(name))} — ${names.length ? `the slices are ${names.map(sliceTag).join(', ')}` : `the loop has no slice: ${jarlLine('goal', '--set', 'Coordinators: <names>')}, then ${jarlLine('field', '<ids>', 'Tags', '--add', '<slice:coordinator>')}`}`, () => (names.length ? { replace: fieldText(name), value: hole('<coordinator>') } : ['jarl.mjs', 'goal', '--set', '<machine-line>']));
  return found;
}

// The slices with an issue in play.
export function activeSlices(loop) { return slicesOf(loop).filter((s) => s.inPlay > 0); }
