// The one grammar of the number of an issue, a question and a branch, and of the name a branch may have.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { need } from './base.mjs';

// ---- ids: the one grammar of the number of an issue, a question and a branch ----------------------------------------

// The number of an issue, of a question (a-12) and of the issue a branch carries: one or more digits, written plain (7,
// 42, 1000) or with leading zeros, as 007. Every reader and writer of an id, a range of ids or the id in a branch name is
// here. Two writings of one number name one issue, ids are compared as numbers (999 comes before 1000), and a log line,
// a heading or a question keeps the writing its issue file carries.
export const ID_SRC = '\\d+';
// A pattern with `{id}` where an issue number stands: the one way another section embeds the grammar.
function idRe(source, flags) { return new RegExp(source.replaceAll('{id}', ID_SRC), flags); }
const ISSUE_FILE_RE = idRe('^({id})-.*\\.md$');
// The key of an id: its number without leading zeros, so 007, 7 and #7 share one key. Ids are compared by key.
export function idKey(raw) {
  const s = String(raw).trim().replace(/^#/, '');
  return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s;
}
export const cmpId = (a, b) => Number(a) - Number(b);
// The record format a written id needs before it is written: a number of fewer than three digits is written plain, and a
// reader that expects three digits skips it in silence, as it skips a number of 1000 or more.
export const needsRaisedFormat = (id) => /^\d+$/.test(String(id)) && (String(id).length < 3 || Number(id) >= 1000);
// The written form of each issue number the issue files' names hold, by key: 007 for 007-x.md, 7 for 7-x.md.
export function writtenForms(names) {
  const forms = new Map();
  for (const f of names) { const m = ISSUE_FILE_RE.exec(f); if (m) forms.set(idKey(m[1]), m[1]); }
  return forms;
}
// The form an id is written in: the one its issue file carries, else the id as given, without its #.
export function writtenId(raw, forms) { return forms.get(idKey(raw)) ?? String(raw).trim().replace(/^#/, ''); }
// The written forms of the issue files under `dir` (the directory holding issues/).
function issueForms(dir) { const d = join(dir, 'issues'); return writtenForms(existsSync(d) ? readdirSync(d) : []); }
// The number a new issue or question is written with: plain (7, 1000), or with leading zeros to `width` digits when the
// caller names a width (the record library names 3, so its file reads 007-…). The command line and the tools name none.
export function newNumber(n, width) { return width ? String(n).padStart(width, '0') : String(n); }
// The number of a question as the command line gives it: 12, the same with a hash in front, or a-12.
function askNumber(raw) { return idKey(String(raw).replace(/^a-/, '')); }

// One id, or several as a comma list with ranges: `12,13,14` or `203-206,209` (no spaces: one argument, like --tags a,b).
const MAX_BULK = 200;
export function expandIds(raw) {
  need(raw !== undefined && String(raw).trim() !== '', 'an issue id is required — one id, or several as a comma list with ranges: 12,13 or 203-206,209');
  const out = [];
  for (const part of String(raw).split(',').map((p) => p.trim().replace(/^#/, ''))) {
    const range = /^(\d+)-#?(\d+)$/.exec(part);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      need(a <= b, `range ${part} runs backwards — write it low-high`);
      need(b - a < MAX_BULK, `range ${part} spans more than ${MAX_BULK} issues`);
      for (let n = a; n <= b; n += 1) out.push(String(n));
    } else {
      need(/^\d+$/.test(part), `not an issue id: "${part}" — ids are numbers, several as a comma list with ranges: 12,13 or 203-206,209`);
      out.push(idKey(part));
    }
  }
  return [...new Set(out)];
}
function isBulk(raw) { return /[,-]/.test(String(raw ?? '')); }

// An issue number of the loop standing alone in a text: no letter or digit touches it, so a sha (1b066c7) or a longer
// number never reads as one, while reviewer-450, report-398 and 024 between brackets do. Dates (2026-10-15, 2026-10) and dotted
// version numbers are set aside first, and only a number that is an id the loop holds (`held`, a Set or Map of ids) counts, so a
// year or a count never becomes an issue in a loop of thousands. With `introducedOnly`, a number counts only when it is
// introduced by the word issue, issues or ticket, or by a hash sign, whatever its length, so a bare number in code is never read as an id.
export function idsNamed(text, held, { introducedOnly = false } = {}) {
  const plain = String(text || '').replace(/(?<![0-9])\d{4}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?(?:[ T]\d{2}:\d{2})?(?![0-9])/g, ' ').replace(/\d+(?:\.\d+)+/g, ' ');
  // A range (998-1002, low-high like expandIds reads it) names every id the loop holds inside it; a lone id names itself.
  const heldIds = [...held.keys ? held.keys() : held].map(String);
  // A number named in the text is the held id it means, written as the loop writes it (007 for 7 when the file is 007).
  const byKey = new Map(heldIds.map((id) => [idKey(id), id]));
  const out = [];
  // A number of one or two digits names an issue only when it is introduced: written #N, or in a list or range that
  // follows issue, issues or ticket (the list runs on over commas and and/or). Free text such as jarl-2-B2 names none.
  // A number of three or more digits names an issue whenever the loop holds it.
  let prevEnd = 0;
  let chain = false;
  for (const m of plain.matchAll(idRe('(?<![0-9A-Za-z])(#?)({id})(?:-(#?)({id}))?(?![0-9A-Za-z])', 'g'))) {
    const gap = plain.slice(prevEnd, m.index);
    prevEnd = m.index + m[0].length;
    const introduced = m[1] === '#' || /(?:^|[^A-Za-z])(?:issues?|tickets?)\s*$/i.test(gap) || (chain && /^\s*(?:,|and|or|&)?\s*$/i.test(gap));
    chain = introduced;
    if (!introduced && (introducedOnly || m[2].length < 3)) continue;
    if (m[4] !== undefined && Number(m[2]) <= Number(m[4])) out.push(...heldIds.filter((id) => Number(id) >= Number(m[2]) && Number(id) <= Number(m[4])).sort(cmpId));
    else for (const raw of m[4] === undefined ? [m[2]] : [m[2], m[4]]) if (byKey.has(idKey(raw))) out.push(byKey.get(idKey(raw)));
  }
  return out;
}

// The number a branch name carries: `jarl/NNN-…`, `jarl/<who>/NNN-…` or `<who>/jarl/NNN-…`. Null when it carries none.
function branchIssueId(name) {
  return idRe('^jarl/(?:[^/]+/)?({id})-').exec(name)?.[1] || idRe('^[^/]+/jarl/({id})-').exec(name)?.[1] || null;
}
// The branch names git is asked for that carry an issue's number (the globs `branchIssueId` reads).
function branchGlobsFor(id) { return [...new Set([String(id), idKey(id)])].flatMap((n) => [`jarl/${n}-*`, `jarl/*/${n}-*`]); }

// Why git would not accept `name` as a branch name (git check-ref-format), or null.
function branchNameProblem(name) {
  const bad = (why) => `is not a branch name git accepts: ${why}`;
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name)) return bad('no space, control character or any of ~ ^ : ? * [ \\');
  if (name.includes('..') || name.includes('@{') || name.includes('//') || name === '@') return bad('no "..", "@{", "//" or a lone @');
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return bad('it does not start with - or /, nor end with / or .');
  if (name.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock'))) return bad('no part starts with . or ends with .lock');
  return null;
}

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { ISSUE_FILE_RE, askNumber, branchGlobsFor, branchIssueId, branchNameProblem, idRe, isBulk, issueForms };
