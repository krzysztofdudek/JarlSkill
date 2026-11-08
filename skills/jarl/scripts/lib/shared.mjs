// What the commands that write the record share: the refusal for a loop that is not live, the ids asked for and the
// change run over each, and the route of a status.

import { existsSync } from 'node:fs';
import { Refusal, hole, jarlLine, need, refuse, shellWord } from './base.mjs';
import { canonical, jarlDir } from './where.mjs';
import { expandIds, idKey, isBulk, itemNaming, needsRaisedFormat } from './ids.mjs';
import { PARENT_FIELD, loadProfile } from './profile.mjs';
import { goalPath } from './journal.mjs';
import { issueNamed, loadIssues } from './issues.mjs';
import { needFormat } from './repositories.mjs';
import { resetCaches } from './tips.mjs';
import { LINE_FORM, LINE_ROW_READY } from './lines.mjs';

// What a refusal of an id the loop does not hold ends with: the call that lists the ids it holds.
export const listAll = () => ` — the issues: ${jarlLine('list', '--all')}`;

// The ids as they were asked for, where they name more than the ones missing (a range, a list).
export const askedAs = (raw, missing) => (String(raw) === missing.join(',') ? '' : ` (asked for as ${String(raw)})`);

// A live loop is one with a goal; a .jarl/ holding only archive/ and the mode markers has none.
export function hasLiveLoop(root) {
  return existsSync(goalPath(jarlDir(root)));
}

// The refusal for a command that needs a live loop: no .jarl/ at all, or one holding only archives.
export function needLiveLoop(root, next) {
  need(existsSync(jarlDir(root)), `no .jarl/ here${next}`, () => (['jarl.mjs', 'init', '<goal>']));
  need(hasLiveLoop(root), `no live loop here — .jarl/ holds only archived loops${next}`, () => (['jarl.mjs', 'init', '<goal>']));
}

// The header fields of the description, each written by field and by its own command.
export const DESCRIPTION_FIELDS = ['Title', 'Priority', 'Tier', 'Kind', 'Found by', 'Tags', 'Files', 'Repo', 'After', 'Parent', 'Source', 'Where', 'Resources', 'Person', 'Check when'];

// Bulk ids: evidence, review, set, tag and prio take one id or several (see expandIds). Every id is resolved and every
// precondition checked before anything is written, so a call either lands on all of them or on none;
// each issue still gets its own log line.
export function issuesFor(root, rawIds, readOnly = false) {
  const keys = expandIds(rawIds);
  const all = loadIssues(root);
  const missing = keys.filter((k) => !all.some((i) => idKey(i.id) === k));
  need(missing.length === 0, `no such issue: ${missing.join(', ')}${askedAs(rawIds, missing)}${keys.length > 1 ? ' — nothing was written' : ''}${listAll()}`, () => ({ replace: itemNaming(rawIds, missing[0]), value: hole('<ids-the-loop-holds>') }));
  const found = keys.map((k) => issueNamed(all, k));
  if (!readOnly && found.some((i) => needsRaisedFormat(i.id))) needFormat(root, 'plain-number');
  return found;
}

// One id in, the same object as always out; a list in, an array of them.
export function oneOrMany(rawIds, results) { return isBulk(rawIds) ? results : results[0]; }

// The ready part of a refused move into a closing status, by the cause the gate names: the step that cause asks for, each
// value only its maker knows a placeholder (the command run, the verdict and the reviewer, the sha, the file and the slot);
// an owner line is his to tick, so its step is the question put to him, never his tick; a retraction the log cannot
// place is shown by verify, before the form of the move.
export function doneReady(cause, issue) {
  if (issue.byHeader || cause === 'unattributed') return refiled();
  if (cause === 'evidence') return LINE_ROW_READY();
  if (cause === 'lines') return ['jarl.mjs', 'field', hole('<id>'), 'Acceptance', LINE_FORM];
  if (cause === 'approve-standing') return ['jarl.mjs', 'round', hole('<id>'), hole('<what-failed>')];
  if (cause === 'approve') return ['jarl.mjs', 'review', hole('<ids>'), hole('<verdict>'), hole('<what-was-read-and-found>'), '--by', hole('<a-fresh-reviewer>')];
  if (cause === 'clears') return ['jarl.mjs', 'review', hole('<ids>'), hole('<verdict>'), hole('<what-was-read-and-found>'), '--by', hole('<reviewer>')];
  if (cause === 'model') return ['jarl.mjs', 'review', hole('<ids>'), hole('<verdict>'), hole('<what-was-read-and-found>'), '--by', hole('<a-fresh-reviewer>'), '--model', hole('<model-id>')];
  if (cause === 'merge') return ['jarl.mjs', 'merged', hole('<ids>'), '--sha', hole('<sha>')];
  if (cause === 'commit') return LINE_ROW_READY();
  if (cause === 'files') return ['jarl.mjs', 'field', hole('<ids>'), 'Files', hole('<paths>')];
  if (cause === 'slots') return ['jarl.mjs', 'evidence', hole('<id>'), '--file', hole('<path>'), '--slot', hole('<slot>')];
  if (cause === 'owner') return ['jarl.mjs', 'ask', hole('<question-for-the-owner>'), '--issue', hole('<id>')];
  if (cause === 'owner-rewrite') return ['jarl.mjs', 'field', hole('<ids>'), 'Acceptance', hole('<the-whole-section>')];
  if (cause === 'retraction') return [{ first: ['jarl.mjs', 'verify'] }, { retry: true }];
  if (cause === 'subs') return [{ first: ['jarl.mjs', 'show', issue.id] }, { retry: true }];
  return { arg: 1, value: hole('<a-status-the-gate-allows>') };
}

// The ready part for an issue whose number the log files twice, which is never closed, approved or merged: the work filed
// again, and the call on the number new prints.
export function refiled() { return [{ first: ['jarl.mjs', 'new', '<the-title-filed-again>'] }, { arg: 0, value: '<the-id-new-prints>' }]; }

// A refusal of a call on several ids says nothing was written, before the ready command it ends with.
export function nothingWritten(message) { return typeof message === 'string' ? `${message} — nothing was written` : message; }

// A command that writes one issue at a time (files, repo, after, body, round, source) takes the list grammar too: `run(id,
// dry)` does one issue's work and writes nothing when `dry` is true. Every id is resolved and run dry before the first
// one is written, so a list lands on every id or on none; one id is run as it stands, with no pass before it.
export function eachIssue(root, rawIds, run) {
  if (!isBulk(rawIds)) return run(rawIds, false);
  const keys = expandIds(rawIds);
  const all = loadIssues(root);
  const missing = keys.filter((k) => !all.some((i) => idKey(i.id) === k));
  need(missing.length === 0, `no such issue: ${missing.join(', ')}${askedAs(rawIds, missing)} — nothing was written${listAll()}`, () => ({ replace: itemNaming(rawIds, missing[0]), value: hole('<ids-the-loop-holds>') }));
  const ids = keys.map((k) => issueNamed(all, k).id);
  inCall(() => {
    for (const id of ids) {
      resetCaches();
      try { run(id, true); } catch (e) { if (!(e instanceof Refusal)) throw e; refuse(/nothing was written/.test(e.reason) ? e.reason : nothingWritten(e.reason), e.ready); }
    }
  });
  return ids.map((id) => { resetCaches(); return run(id, false); });
}

// What the issues of the call checked so far would hold once written, as { files, resources } by issue id, while a call over
// several issues checks them all before writing any; null outside such a check. A later issue of the call is checked against
// the lease of an earlier one as it will stand, so a call that would make two leases collide is refused whole.
export let declaredInCall = null;

export function inCall(check) {
  const outer = declaredInCall;
  declaredInCall = outer ?? new Map();
  try { check(); } finally { declaredInCall = outer; }
}

// The refusal for a move into a needs-reason status given without one; the built-in two say what the status is for.
export const REASON_TEXT = {
  dropped: () => `dropped needs a reason: ${jarlLine('set', '<id>', 'dropped', '<text>')}`,
  deferred: () => `deferred needs a reason: ${jarlLine('set', '<id>', 'deferred', '<text>')} — work that waits, not work that is gone`,
};

// The line a needs-reason status writes under Evidence: its name with a capital, then the reason (Dropped: …).
export function reasonWord(status) { return status.charAt(0).toUpperCase() + status.slice(1); }

// Who asked for the move: 'cli' — the command line and the MCP tools over it, which always say so — or 'record', a
// library call through record.mjs (the default). A status the profile marks "set-by": "record" refuses 'cli'.
export const SET_CALLERS = ['cli', 'record'];

// Where `set <ids> <name> …` goes, decided here and nowhere else: a field the profile declares (Kind and Tier too, when it
// declares them) and that is no status, the built-in Resources field, another header field of the tool's own (field
// writes it), or a move into a status.
export function setRoute(profile, name) {
  if (name === undefined || profile.statuses.includes(name)) return 'status';
  if (profile.field(name)) return 'field';
  if (String(name).toLowerCase() === 'resources') return 'resources';
  return fieldsWritten(profile).some((f) => f.toLowerCase() === String(name).trim().toLowerCase()) ? 'own' : 'status';
}

// What a name given to set is: 'status', or 'field' (a field the profile declares, a header field of the tool's own, or
// the built-in Resources).
export function setRouteOf(root, name) { return setRoute(loadProfile(root), name) === 'status' ? 'status' : 'field'; }

// The sections of the description field writes, as their headings: What, Why, the acceptance (under the heading the
// profile gives it), Changelog and the sections the profile declares.
export function sectionsOf(profile) {
  return [...new Set(['What', 'Why', 'Acceptance', ...(profile.acceptance ? [profile.acceptance] : []), 'Changelog', ...profile.sections])];
}

// The header fields of the tool's own that field writes in this loop. Person and Check when are the tool's own where the
// built-in promise and wait hold, and a declared field's otherwise; so is Parent where the issues form a tree.
export function fieldsWritten(profile) {
  return DESCRIPTION_FIELDS.filter((f) => (profile.kept || !['person', 'check when'].includes(f.toLowerCase())) && (profile.tree || f !== PARENT_FIELD));
}

// A loop whose profile keeps close or archive to the record ("lifecycle") refuses them from the command line and the
// MCP tools (caller 'cli'), naming the composer's command; a library caller ('record', the default) passes.
export function needLifecycle(root, op, caller = 'record') {
  need(SET_CALLERS.includes(caller), `caller must be one of: ${SET_CALLERS.join(', ')} (got "${caller}")`, () => (['jarl.mjs', 'set', '<ids>', '<status>', '<text>']));
  if (caller !== 'cli') return;
  const profile = loadProfile(root);
  need(profile.lifecycle[op] !== 'record', `this loop is ${op === 'close' ? 'closed' : 'archived'} by the tool that runs it, never by jarl ${op} — its profile (${profile.name}) marks "lifecycle": { "${op}": "record" }, so jarl ${op} and the MCP tools refuse, and nothing was ${op === 'close' ? 'closed or removed' : 'moved'}${profile.lifecycle.command ? `; run: ${profile.lifecycle.command}` : ''}`, () => (profile.lifecycle.command ? { external: profile.lifecycle.command } : { flag: hole('<the-command-of-the-tool-that-runs-this-loop>') }));
}

// A word safe to paste into a shell: single-quoted unless it is plainly safe.
export { shellWord };

export const sameDir = (a, b) => canonical(a) === canonical(b);
