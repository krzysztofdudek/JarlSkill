// The numbers a new issue takes: the next free one across the loop's checkouts and refs, and the ranges a goal declares.

import { existsSync, readdirSync } from 'node:fs';
import { hole, need, refuse } from './base.mjs';
import { git, gitBytes } from './git.mjs';
import { issuesDir, jarlDir } from './where.mjs';
import { ISSUE_FILE_RE } from './ids.mjs';
import { goalLines, readGoal } from './journal.mjs';
import { mainCheckoutOf } from './repositories.mjs';

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
export const rangesOf = (root) => goalLines(readGoal(jarlDir(root))).ranges;

export const rangeAt = (ranges, n) => ranges.find((r) => n >= r.from && n <= r.to) || null;

// The first free number of a series at `least` or above, `held` being the numbers already taken: in a declared range, one
// above the highest number the range holds, or its first, and null when the range has none left; outside every range, one
// above the highest number held outside them all, stepped past each range it falls in. A number held in one series never
// moves the count of another.
export function numberAfter(held, ranges, range, least) {
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
export function declaredRange(root, raw) {
  const name = typeof raw === 'string' ? raw.trim() : '';
  const ranges = rangesOf(root);
  const range = ranges.find((r) => r.name.toLowerCase() === name.toLowerCase());
  if (range) return range;
  if (ranges.length) refuse(`the goal declares no range ${JSON.stringify(name)}: its ranges are ${ranges.map((r) => `${r.name} (${r.from}-${r.to})`).join(', ')}`, { flag: '--range', value: hole('<name>') });
  refuse(`the goal declares no range ${JSON.stringify(name)}, nor any other: a range is a goal line, "Range (<name>): <from-to>"`, ['jarl.mjs', 'goal', '--set', `Range (${hole('<name>')}): ${hole('<from-to>')}`]);
}

// The refusal of a filing in a range that has no number left.
export function needRoomIn(range, n) {
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
