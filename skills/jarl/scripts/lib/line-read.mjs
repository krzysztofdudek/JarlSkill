// One acceptance line read: its method and what it asks. Its own module so the readers of the lines and of the owner's lines both take it.

import { acceptanceLines } from './issues.mjs';

export const METHODS = Object.freeze(['test', 'check', 'compare', 'read', 'owner']);
export const MECHANICAL = new Set(['test', 'check', 'compare']);
export const MARK = /^\[([^\]]*)\]\s*(.*)$/s;
export const SEPARATOR = / · |^· /;
export const PAIR = /^([a-z][a-z-]*):\s*(.*)$/;

// One acceptance line read: { text, method, marked, what, by }. A line with no mark, or a mark that is none of the five,
// reads as read, and marked false; keys are read by their place, as much as the line holds.
export function readLine(text) {
  const m = MARK.exec(text);
  const method = m && METHODS.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
  if (!method) return { text, method: 'read', marked: false, what: text, by: null };
  const parts = m[2].split(SEPARATOR).map((p) => p.trim());
  const key = (name) => parts.slice(1).map((p) => PAIR.exec(p)).filter(Boolean).find(([, k]) => k === name)?.[2]?.trim() || null;
  return { text, method, marked: true, what: parts[0], by: key('by') };
}

// Whether an issue owes no row at all: its lines are read lines, judged by a verdict, and owner lines, proved by his tick.
export const noRowOwed = (issue) => acceptanceLines(issue).every((l) => !MECHANICAL.has(readLine(l).method));
