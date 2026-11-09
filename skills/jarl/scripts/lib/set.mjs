// The set command: a status change with its lease, and the fields that route through it.

import { resolve } from 'node:path';
import { LEASE_FIELDS, fieldText, hole, jarlLine, need, noSeparators } from './base.mjs';
import { needNoOwnersWords } from './owner.mjs';
import { jarlDir, stamp } from './where.mjs';
import { readText, writeAtomic } from './files.mjs';
import { loadProfile } from './profile.mjs';
import { appendLogLines } from './journal.mjs';
import { HANDOVER_SEGMENT } from './log.mjs';
import { RENDERED_FIELDS, noteText, placeEvidence, removeFields, setField, setSection, unattributedRefusal } from './issues.mjs';
import { tipLinesOf } from './repositories.mjs';
import { FIELD_NAMES } from './disagreements.mjs';
import { gateOf, worksInPlace } from './gate.mjs';
import { readLoop } from './loop.mjs';
import { limitNote, modelValue, modelOfferAtLease, spellingNote } from './models.mjs';
import { REASON_TEXT, SET_CALLERS, doneReady, issuesFor, nothingWritten, oneOrMany, reasonWord, refiled, setRoute } from './shared.mjs';
import { cmdField } from './field.mjs';
import { leaseFlagsGiven, leaseValueProblem, needLeaseHolds, needTreeHolds, needWorktreeOfLease } from './leases.mjs';
import { setDeclaredField, setResources } from './setters.mjs';
import { doneGateIn, doneNote } from './done-gate.mjs';

// set with the name taken as a status (record.setStatus), or as a field the profile declares (record.setField): the
// refusal of a name that is the other kind, in the command line's own words.
export function cmdSetStatus(root, rawIds, status, why, flags = {}) {
  const profile = loadProfile(root);
  need(profile.statuses.includes(status) || !profile.field(status), `${status} is a field this loop's profile declares, not a status — setField writes it`, () => (['jarl.mjs', 'field', rawIds ?? '<ids>', status, why ?? '<value>']));
  return cmdSet(root, rawIds, status, why, flags);
}

// The tool's own header fields a library caller also writes by name, as field writes them, with the writer flags.by names.
const LIBRARY_OWN_FIELDS = ['tags', 'priority', 'files', 'source'];

export function cmdSetField(root, rawIds, field, value, flags = {}) {
  const profile = loadProfile(root);
  if (!profile.field(field) && LIBRARY_OWN_FIELDS.includes(String(field ?? '').trim().toLowerCase())) return cmdField(root, rawIds, field, value, { by: flags.by });
  need(profile.field(field) && !profile.statuses.includes(field), `${field} is not a field this loop's profile declares${profile.declaredFields.length ? ` — it declares ${profile.declaredFields.map((f) => f.name).join(', ')}` : ''}`, () => (['jarl.mjs', 'set', '<ids>', '<status>', '<text>']));
  return cmdSet(root, rawIds, field, value, flags);
}

export function cmdSet(root, rawIds, status, why, flags = {}) {
  needNoOwnersWords('the move', why, flags);
  const caller = flags.caller ?? 'record';
  need(SET_CALLERS.includes(caller), `caller must be one of: ${SET_CALLERS.join(', ')} (got "${caller}")`, () => (['jarl.mjs', 'set', '<ids>', '<status>', '<text>']));
  const profile = loadProfile(root);
  const route = setRoute(profile, status);
  need(route !== 'own', `${String(status).trim()} is a field, not a status: field writes it`, () => (['jarl.mjs', 'field', hole('<ids>'), String(status).trim(), hole('<value>')]));
  if (route === 'field') return setDeclaredField(root, rawIds, profile.field(status), why, flags);
  if (route === 'resources') return setResources(root, rawIds, why, flags);
  if (flags.header) return rewriteHeader(root, rawIds, status, why, flags);
  // ready and the review words are views, not statuses: say which view answers the question the worker was asking.
  need(profile.statuses.includes(status) || !/^(ready|review|in[-_ ]?review|ready[-_ ]for[-_ ]review|reviewing)$/i.test(String(status ?? '')), `${status} is a view here, not a status: next lists the issues ready to start, and status and resume mark each in-flight issue with what the record says (no evidence rows yet; rows and no verdict, so it waits for a reviewer; changes requested; approved and queued). Nothing needs setting: record the rows with evidence, and the reviewer's verdict with review. A loop that wants an explicit review status can declare one in its profile. Statuses here: ${profile.statuses.join(', ')}; the issues ready to start: ${jarlLine('next')}`, () => ({ arg: 1, value: hole('<status>') }));
  need(profile.statuses.includes(status), `status must be one of: ${profile.statuses.join(', ')} (got "${status}")`, () => [...(rawIds === undefined ? [{ arg: 0, value: '<ids>' }] : []), { arg: 1, value: hole('<status>') }]);
  need(caller !== 'cli' || profile.setBy(status) !== 'record', `${status} is set by the record only — this loop's profile (${profile.name}) marks it "set-by": "record", so jarl set and the MCP tools cannot move an issue into it; the tool that runs the loop does`, () => ({ arg: 1, value: hole('<status>') }));
  const holds = profile.is(status, 'holds-claim');
  const lease = leaseFlagsGiven(flags);
  need(!lease.length || holds, `--${lease[0]} goes with ${profile.with('holds-claim').join(' or ')} only, not with ${status} — it records who works on the issue and where`, () => ({ arg: 1, value: hole('<status>') }));
  need(flags.handover === undefined || typeof flags.handover === 'boolean', '--handover takes no value: the reason it is logged with is the move\'s own "<text>"', () => ({ rename: '--handover', to: hole('<no-flag-here>') }));
  const handover = flags.handover === true;
  need(!handover || holds, `--handover goes with ${profile.with('holds-claim').join(' or ')} only, not with ${status} — it hands a lease to a new worker or branch`, () => ({ arg: 1, value: hole('<status>') }));
  for (const k of lease) need(typeof flags[k] === 'string' && fieldText(flags[k]), `--${k} needs a value`, () => ({ flag: `--${k}`, value: hole('<value>') }));
  const model = flags.model !== undefined ? modelValue(flags.model) : undefined;
  // A name is one value: with the log's own separator in it, the lease line would carry a field the caller did not give.
  for (const k of ['worker', 'branch']) need(flags[k] === undefined || !` ${fieldText(flags[k])} `.includes(' · '), `--${k} is one name — not a phrase with " · " in it (got "${fieldText(flags[k])}")`, () => ({ flag: `--${k}`, value: hole('<one-name>') }));
  // What is written into the lease is what the journal gives back unchanged: a value the reader would take for something else is refused.
  for (const k of lease) { const problem = leaseValueProblem(k, flags[k]); need(!problem, `--${k} ${JSON.stringify(fieldText(flags[k]))} ${problem}`, () => ({ flag: `--${k}`, value: hole('<value>') })); }
  const issues = issuesFor(root, rawIds);
  need(!profile.is(status, 'needs-reason') || fieldText(why ?? ''), REASON_TEXT[status]?.() || `${status} needs a reason: ${jarlLine('set', '<id>', status, '<text>')}`, () => ({ arg: 2, value: '<text>' }));
  const nothing = issues.length > 1 ? ' — nothing was written' : '';
  // A lease says who holds it, and on the command line and in the tools what model it was raised on: a move that names
  // neither keeps the worker and the model the issue's lease already has.
  if (holds) {
    for (const issue of issues) {
      const held = profile.is(issue.status, 'holds-claim') ? fieldText(issue.fields.worker) : '';
      need(flags.worker !== undefined || held, `${issue.id} would be leased with no worker: a lease names who holds it with --worker${nothing}`, () => ({ flag: '--worker', value: hole('<the-new-worker>') }));
      need(caller !== 'cli' || flags.model !== undefined || (flags.worker === undefined && issue.fields.model), `${issue.id} would be leased with no model: a lease names the model its worker runs on with --model${nothing}`, () => ({ flag: '--model', value: hole('<model-id>') }));
    }
  }
  needTreeHolds(profile, issues, status, nothing);
  if (holds) needLeaseHolds(root, profile, issues, status, why, flags, handover, nothing);
  // An issue worked in place is leased with no branch, on the files it declares, which keep two such issues apart.
  for (const issue of holds ? issues.filter((i) => worksInPlace(i)) : []) {
    const given = ['branch', 'worktree'].filter((k) => flags[k] !== undefined);
    need(!given.length, `${issue.id} is worked in place: its worker writes the files it declares in the checkout of their repository, as it is checked out, with no branch and no worktree of its own${nothing}`, () => given.map((k) => ({ drop: `--${k}` })));
    need(issue.files.length, `${issue.id} is worked in place and declares no files: it names the files it writes before it is leased, so that next keeps two issues off one file${nothing}`, () => ['jarl.mjs', 'field', issue.id, 'Files', hole('<paths>')]);
  }
  // base: the branch a library caller landed the merge into, for the done gate's requires-merged (else the branch checked
  // out). A library call only: the command line has no --base, and dispatch never passes one through.
  need(flags.base === undefined || caller === 'record', 'base is named by a library call through record.mjs only — the command line checks against the branch checked out', () => ({ rename: '--base', to: hole('<no-flag-here>') }));
  need(flags.base === undefined || (typeof flags.base === 'string' && fieldText(flags.base) !== '' && !flags.base.startsWith('-')), 'base names a branch or ref — the one the merge landed in', () => ({ rename: '--base', to: hole('<no-flag-here>') }));
  if (profile.is(status, 'closes-record')) {
    for (const issue of issues) { const refusal = unattributedRefusal(issue, `moved → ${status}`); need(!refusal, nothing ? nothingWritten(refusal) : refusal, () => (doneReady('unattributed', issue))); }
    const loop = readLoop(jarlDir(root));
    for (const issue of issues) { const gate = doneGateIn(root, loop, issue, flags.base); need(!gate, nothing ? nothingWritten(gate?.text) : gate?.text, () => (doneReady(gate.cause, issue))); }
  }
  // One lease for the whole call: every issue in a package gets the same Branch, Worker and Since. A lease records no
  // worktree: git allows a branch in at most one worktree, so the worktree of a lease is found through its branch. On the
  // command line and in the tools --worktree is a check (a relative path is read from the loop's root, like --repo): a
  // path that exists must be a worktree of a repository of the issue with the lease's branch checked out. The record
  // library accepts the key and stores nothing.
  const since = stamp();
  if (holds && flags.worktree !== undefined && caller === 'cli') for (const issue of issues) needWorktreeOfLease(root, issue, flags.branch !== undefined ? fieldText(flags.branch) : fieldText(issue.fields.branch), resolve(root, fieldText(flags.worktree)));
  const writes = issues.map((issue) => ({ issue, edit: (read) => {
    let text = setField(read, 'Status', status);
    if (holds) {
      if (flags.branch !== undefined) text = setField(text, 'Branch', fieldText(flags.branch));
      if (flags.worker !== undefined) text = setField(text, 'Worker', fieldText(flags.worker));
      // The model belongs to the worker it was raised for: a new worker named without one does not inherit the last one's.
      if (model !== undefined) text = setField(text, 'Model', model);
      else if (flags.worker !== undefined) text = removeFields(text, ['Model']);
      // A Worktree field belongs to the lease that wrote it: once the issue is handed over, its worktree is the old one.
      if (handover) text = removeFields(text, ['Worktree']);
      text = setField(text, 'Since', since);
    } else {
      text = removeFields(text, LEASE_FIELDS);
    }
    // What was already written under Evidence stays: a drop or a deferral is one more line in the history,
    // not a reset of it.
    const notes = profile.is(status, 'needs-reason') ? [[`${reasonWord(status)}: `, why]] : [];
    if (notes.length) {
      const evidence = notes.reduce((written, [head, said]) => placeEvidence(written, 'note', `${head}${noteText(said, written)}`, '\n\n'), (issue.sections.evidence || '').trim());
      text = setSection(text, 'Evidence', evidence);
    }
    return text;
  } }));
  // The model goes before the worker: the worker is read as the text after "· worker " up to the end of the line (or up to
  // "· worktree " in a line that carries one), so a model written after it would become part of the worker's name.
  const leaseNote = [flags.branch !== undefined && `branch ${fieldText(flags.branch)}`, model !== undefined && `model ${model}`, flags.worker !== undefined && `worker ${fieldText(flags.worker)}`].filter(Boolean).join(' · ');
  // The reason is free text in front of the lease's fields: on a lease its own " · " is neutralised, so no reason can be
  // read as a branch, a model or a worker.
  // A reason that opens with the name of a lease field is closed by a segment "(reason)", so no reader takes it for the field.
  // Every separator character of a lease's reason is replaced, with the space around it, so no run of separators and
  // spaces can leave a separator in it and the reason is one segment of the line.
  // A handover is the segment "handover" right after the reason, which a handover always has: a reason alone is one
  // segment, so a reason that says "handover" is never read as one. A reader that does not know the segment reads it as
  // part of the reason and the lease fields after it as they are.
  const neutral = holds && why ? noSeparators(why) : why;
  const marked = handover ? `${neutral} · ${HANDOVER_SEGMENT}` : neutral;
  const reason = holds && neutral && /^(branch|model|worker|worktree) /.test(neutral) ? `${marked} · (reason)` : marked;
  // A model spelled another way than the record holds it is noted on the command line. The loop is read before this call
  // writes its own line, so that line is not among the spellings the record holds.
  const spelling = caller === 'cli' && model !== undefined ? spellingNote(readLoop(jarlDir(root)), model) : null;
  // The line goes first: a write that stops between the two leaves the journal, the record, ahead of the files, which the
  // views report, and never a file ahead of the record.
  // A move that closes the record is followed by the tip the close was judged on: the tip of the issue's branch, or, where
  // the branch is gone (a merge's cleanup deletes it), the tip its merge was recorded on, else the tip its counted waiver,
  // row or approve was made on, and none where nothing gives one; never the commit the merge names. The gate of the
  // closed issue is read against it whatever the branch does after, a branch of the same name made again included.
  const closes = profile.is(status, 'closes-record');
  const judged = closes ? readLoop(jarlDir(root)) : null;
  const closeTip = closes ? tipLinesOf(root, issues, (issue) => gateOf(judged, issue.id).closingTip()) : () => [];
  appendLogLines(root, issues.flatMap((issue) => [`${issue.id} → ${status}${reason ? ` · ${reason}` : ''}${leaseNote ? ` · ${leaseNote}` : ''}`, ...closeTip(issue)]), since);
  // The lines that remember the offer are written for every caller; its text is the command line's answer alone.
  const offered = holds && leaseNote ? modelOfferAtLease(root, model) : null;
  const modelOffer = caller === 'cli' ? offered : null;
  for (const w of writes) writeAtomic(w.issue.file, w.edit(readText(w.issue.file)));
  const worktreeNote = caller === 'cli' && holds && flags.worktree !== undefined ? '--worktree was checked and is not recorded — the worktree of a lease is found through its branch' : null;
  const limit = caller === 'cli' && holds ? limitNote(root, model) : null;
  // Each note is a line of its own: the command line prints every line after the issue's id, which is the subject the
  // offer reads after, whichever note comes before it.
  const leaseNotes = [worktreeNote, spelling, limit, modelOffer].filter(Boolean).join('\n');
  return oneOrMany(rawIds, issues.map((issue, n) => ({ id: issue.id, status, ...(handover ? { handover: true } : {}), ...(holds ? { since, ...(flags.branch !== undefined ? { branch: fieldText(flags.branch) } : {}), ...(flags.worker !== undefined ? { worker: fieldText(flags.worker) } : {}), ...(model !== undefined ? { model } : {}) } : {}), ...(profile.is(status, 'closes-record') ? doneNote(issue, root) : {}), ...(leaseNotes && n === 0 ? { note: leaseNotes } : {}) })));
}

// set <ids> <status> --header: writes the header fields the log renders (Status, Branch, Worker, Model, Since, Merged, CI)
// of each issue from the log, and writes no log line; the status named is the one the log holds, so it is never a move.
function rewriteHeader(root, rawIds, status, why, flags) {
  need(status !== undefined, 'set <ids> <status-in-the-log> --header: name the status the log holds for the issue (status shows it); --header rewrites the header from the log and moves nothing', () => ({ arg: 1, value: '<status-in-the-log>' }));
  need(loadProfile(root).statuses.includes(status), `${status} is not a status this loop's profile lists (${loadProfile(root).statuses.join(', ')})`, () => ({ arg: 1, value: '<status-in-the-log>' }));
  need(why === undefined && flags.base === undefined && !leaseFlagsGiven(flags).length && flags.handover === undefined, '--header rewrites the header from the log and takes no reason, lease flag, --handover or base', () => ({ rename: '--header', to: '<no-flag-here>' }));
  const issues = issuesFor(root, rawIds);
  for (const issue of issues) {
    need(!issue.byHeader, `${issue.id} is read from its header: the log files ${issue.id} ${issue.byHeader?.filings} times and cannot say which file its lines were written for, so no header is written from it`, refiled);
    need(issue.onFile !== null, `${issue.id} is not in the log, so there is nothing to write its header from: ${jarlLine('set', issue.id, status, '<why>')} without --header puts it there`, () => [{ first: ['jarl.mjs', 'set', issue.id, status, '<why>'] }, { retry: true }]);
    need(issue.status === status, `${issue.id} is ${issue.status} in the log: set ${issue.id} ${issue.status} --header writes its header from it, and ${jarlLine('set', issue.id, status, '<why>')} without --header moves it`, () => ({ arg: 1, value: hole('<status-in-the-log>') }));
  }
  for (const issue of issues) {
    let text = setField(readText(issue.file), 'Status', issue.status);
    for (const key of RENDERED_FIELDS) {
      const name = FIELD_NAMES[key];
      text = issue.fields[key] ? setField(text, name, issue.fields[key]) : removeFields(text, [name]);
    }
    writeAtomic(issue.file, text);
  }
  return oneOrMany(rawIds, issues.map((issue) => ({ id: issue.id, status: issue.status, header: true })));
}
