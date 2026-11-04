// The acceptance lines only the owner ticks: a stage he wants to see himself, agreed while the backlog is written. Such a
// line is written "[owner] <line> · material: <what he reviews> · check: <what he checks>", and a line marked so that
// does not name both is refused, because he must be handed the material and a clear instruction. His tick is a line of
// the log, `<id> tick · line <n> · by owner · <the line>`: it holds the line as it was written then, so a line rewritten
// after it waits for a tick of its own, and it counts inside the window an approve counts in (a red round, a start or a
// reopen spends it, a pause does not). The done gate refuses while a line is not ticked; next --as puts the line on
// whoever produces its material until the material is there, then on the owner; the first write of a mark raises the
// record format (FORMAT_LINES 'owner-line'), so a reader that would let done pass over it refuses the loop instead.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fieldText, need } from './base.mjs';
import { OWNER, rulingAuthor } from './owner.mjs';
import { jarlDir, stamp } from './where.mjs';
import { appendLogLines } from './journal.mjs';
import { formatState } from './profile.mjs';
import { acceptanceLines, evidenceRows, findIssue } from './issues.mjs';
import { issueRepoPaths, needFormat, worktreeState } from './repositories.mjs';
import { gateOf, gateWindow, readLoop } from './loop.mjs';

const MARK = /^\[owner\]\s*/i;
const PART = (key) => new RegExp(`^${key}:\\s*(.*)$`, 'i');
// A placeholder copied from the help names nothing.
const PLACEHOLDER = /^<.*>$/;
export const OWNER_LINE_SHAPE = '[owner] <line> · material: <path, link or artifact> · check: <what to check>';

// One acceptance line read as an owner line: null when it is not marked; else { what, material, check }, each null when
// the line does not name it in the shape above.
function ownerLineOf(text) {
  if (!MARK.test(text)) return null;
  const parts = text.replace(MARK, '').split(' · ').map((p) => p.trim());
  const value = (p, key) => { const m = p === undefined ? null : PART(key).exec(p); const v = m ? m[1].trim() : ''; return v && !PLACEHOLDER.test(v) ? v : null; };
  const what = parts[0] && !PLACEHOLDER.test(parts[0]) ? parts[0] : null;
  if (parts.length !== 3) return { what, material: null, check: null };
  return { what, material: value(parts[1], 'material'), check: value(parts[2], 'check') };
}
const whole = (o) => Boolean(o.what && o.material && o.check);

// The owner lines of an acceptance text that new and field are given: a marked line that does not name its material and
// what to check is refused, naming the shape. True when the text holds an owner line, so the write raises the format.
export function needOwnerLines(acceptance) {
  let held = false;
  for (const text of acceptanceLines({ sections: { acceptance } })) {
    const o = ownerLineOf(text);
    if (!o) continue;
    need(whole(o), `acceptance line "${text}" is marked as one only the owner ticks, and it must name the material he reviews (a path, a link or an artifact) and what he checks: ${OWNER_LINE_SHAPE}; e.g. --acceptance "[owner] <line> · material: <path> · check: <what to check>"`);
    held = true;
  }
  return held;
}

// The owner lines of an issue, with their numbers among its acceptance lines.
export function ownerLines(issue) {
  return acceptanceLines(issue).map((text, i) => ({ n: i + 1, text, o: ownerLineOf(text) })).filter((l) => l.o).map(({ n, text, o }) => ({ n, text, ...o }));
}

// A material written as a path (not a link, and with a directory in it or a file extension at its end) is looked for on
// the disk; one named otherwise (a link, an artifact named in words) cannot be, and is there once the work is proven.
const LINK = /^[a-z][a-z0-9+.-]*:\/\//i;
const asPath = (m) => !LINK.test(m) && (/[\\/]/.test(m) || /^\S+\.[A-Za-z][A-Za-z0-9]{0,9}$/.test(m));
// Where a path is looked for: the loop's root, each repository of the issue and the worktree of its lease in each.
function placesOf(root, issue) {
  const repos = issueRepoPaths(root, issue);
  const branch = fieldText(issue.fields.branch);
  const worktrees = branch ? repos.map((r) => worktreeState(r, branch)).filter((w) => w.state === 'here').map((w) => w.path) : [];
  return [...new Set([root, ...repos, ...worktrees])];
}

// Whether owner lines are off in a loop: its profile names an external scheduler, so Jarl never raises its format, and
// it keeps a format below the one that holds them. A line marked there (written by a Jarl that did not know the mark)
// can be neither ticked nor kept: the views and the gate say so, and how to rewrite it.
function linesOff(profile) { const f = formatState(profile); return !f.raises && profile.format < 3; }
const offText = (profile) => `owner lines are off in this loop: its profile names an external scheduler (${profile.scheduler}) and keeps record format ${profile.format}, so no tick can be written here`;
const rewrite = (id) => `jarl.mjs field ${id} Acceptance "<every line of the section, one per line>"`;

// Each owner line of an issue as the gate and the views read it: { n, text, what, material, check, tick, spent, ready,
// why, at, off }; off is true where owner lines are off in the loop (see linesOff). tick is the tick that counts ({ at, by }) or null, spent the newest tick of the same line that a red round,
// a start or a reopen spent. ready says whether the material is there: proof of the work recorded since it was started
// or sent back, and, for a path, the file where the loop sees it (at: the place it was found, when that is not the
// loop's root); why says what is missing when it is not.
export function ownerLineStates(root, loop, issue) {
  const lines = ownerLines(issue);
  if (!lines.length) return [];
  const events = loop.eventsById.get(issue.id) || [];
  const { cut } = gateWindow(loop.profile, events, { throughPauses: true });
  const g = gateOf(loop, issue.id);
  const proven = g.tracked ? g.rowLog.some((r) => !r.retracted && r.n > cut) : evidenceRows(issue).length > 0;
  let places;
  return lines.map((l) => {
    const ticks = events.filter((e) => e.type === 'tick' && e.ownerLine === l.text);
    const live = ticks.filter((e) => e.n > cut).pop();
    const spent = live ? null : ticks.pop();
    const state = { ...l, tick: live ? { at: live.at, by: live.by } : null, spent: spent ? { at: spent.at, by: spent.by } : null, ready: false, why: null, at: null, off: linesOff(loop.profile) };
    if (state.off) return { ...state, why: offText(loop.profile) };
    if (!whole(l)) return { ...state, why: 'the line does not name its material and what to check' };
    if (!proven) return { ...state, why: 'no proof of the work is recorded after it was started or last sent back' };
    if (!asPath(l.material)) return { ...state, ready: true };
    places = places || placesOf(root, issue);
    const found = places.find((p) => existsSync(resolve(p, l.material)));
    if (found === undefined) return { ...state, why: `${l.material} is not found under the loop's root, the issue's repositories or its worktree` };
    return { ...state, ready: true, at: found === root ? null : found };
  });
}

const reviewText = (s) => `he reviews ${s.material}${s.at ? ` (in ${s.at})` : ''} and checks ${s.check}`;
const tickCommand = (id, n) => `jarl.mjs tick ${id} ${n} --by owner`;

// Why done refuses for the owner lines of an issue, or null when every one is ticked: each line not ticked, with its
// material and what to check.
export function ownerLineRefusal(root, loop, issue) {
  const open = ownerLineStates(root, loop, issue).filter((s) => !s.tick);
  if (!open.length) return null;
  const one = (s) => {
    if (s.off) return `acceptance line ${s.n}, which is marked as one only the owner ticks, and ${s.why}; rewrite it without the [owner] mark: ${rewrite(issue.id)}`;
    if (!whole(s)) return `acceptance line ${s.n} is marked as one only the owner ticks and does not name its material and what to check — rewrite it as ${OWNER_LINE_SHAPE}: ${rewrite(issue.id)}`;
    const spent = s.spent ? `; his tick of ${s.spent.at} came before the work was sent back or started again, so it does not count` : '';
    return `acceptance line ${s.n}, "${s.what}": ${reviewText(s)}; only he ticks it, once he has looked: ${tickCommand(issue.id, s.n)}${spent}`;
  };
  return `${issue.id} waits for the owner's sign-off on ${open.map(one).join('; and on ')}`;
}

// What done still waits for on an issue whose work is approved or merged, as the in-flight views say it, or null: the
// owner's tick of each owner line not ticked, with the command, or the rewrite where owner lines are off.
export function ownerLineWait(root, loop, issue) {
  const open = ownerLineStates(root, loop, issue).filter((s) => !s.tick);
  if (!open.length) return null;
  if (open[0].off) return `the [owner] mark on acceptance line ${open.map((s) => s.n).join(', ')} is rewritten (${open[0].why}): ${rewrite(issue.id)}`;
  return `the owner ticks acceptance line ${open.map((s) => s.n).join(', ')} (${open.map((s) => tickCommand(issue.id, s.n)).join(', ')})`;
}

// The lines show prints under an issue's header: each owner line, ticked or not.
export function ownerLineNotes(root, loop, issue) {
  return ownerLineStates(root, loop, issue).map((s) => (s.tick
    ? `owner's sign-off: acceptance line ${s.n} ticked by ${s.tick.by} ${s.tick.at}`
    : `owner's sign-off: acceptance line ${s.n} not ticked — ${whole(s) && !s.off ? `${reviewText(s)}; ${s.ready ? `his to tick: ${tickCommand(issue.id, s.n)}` : `its material is not there yet: ${s.why}`}` : s.why}`));
}

// tick <id> <n> --by owner: the owner's tick of an owner line, once he has reviewed its material. It needs the owner by
// name, an owner line that names its material and what to check, the material there and no tick that counts already;
// it raises the record format where the loop is not in it, and writes one log line.
export function cmdTick(root, rawId, rawLine, flags = {}) {
  need(flags.by !== undefined, 'tick needs --by owner: only the owner ticks an owner line, and the record says who did');
  const by = rulingAuthor(flags.by);
  need(by === OWNER, `only the owner ticks an owner line: --by owner (got "${by}")`);
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  const loop = readLoop(jarlDir(root));
  const states = ownerLineStates(root, loop, issue);
  const lines = acceptanceLines(issue);
  need(states.length, `${issue.id} has no acceptance line marked as one only the owner ticks — mark one: ${OWNER_LINE_SHAPE}, written with jarl.mjs field ${issue.id} Acceptance "<every line of the section, one per line>"`);
  const owners = `its owner lines: ${states.map((s) => s.n).join(', ')}`;
  need(/^\d+$/.test(String(rawLine ?? '').trim()) && Number(rawLine) > 0, `tick takes the number of the acceptance line, counted from 1 — ${owners}`);
  const n = Number(rawLine);
  need(n <= lines.length, `${issue.id} has ${lines.length} acceptance line${lines.length === 1 ? '' : 's'}: there is no line ${n}; ${owners}`);
  const s = states.find((x) => x.n === n);
  need(s, `acceptance line ${n} of ${issue.id} is not marked as one only the owner ticks; ${owners}`);
  need(!loop.profile.is(issue.status, 'terminal'), `${issue.id} is ${issue.status}: nothing waits for the owner's tick`);
  need(!s.off, `acceptance line ${n} of ${issue.id} cannot be ticked: ${s.why}; rewrite it without the [owner] mark: ${rewrite(issue.id)}`);
  need(!s.tick, `acceptance line ${n} of ${issue.id} is ticked already, by ${s.tick && s.tick.by} at ${s.tick && s.tick.at}`);
  need(s.ready, `the material of acceptance line ${n} of ${issue.id} is not there yet: ${s.why} — the owner ticks the line once he has reviewed it; nothing was written`);
  needFormat(root, 'owner-line');
  const at = stamp();
  appendLogLines(root, [`${issue.id} tick · line ${n} · by ${by} · ${s.text}`], at);
  return { id: issue.id, line: n, by, at, text: s.text };
}
