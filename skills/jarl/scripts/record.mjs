// record.mjs — Jarl's record as a library: the one stable surface another tool may vendor (with jarl-lib.mjs, the
// implementation it stands on). Nothing else in this directory is a contract: jarl.mjs is the command line over this
// module, jarl-mcp.mjs the MCP adapter over the command line, and jarl-lib.mjs changes without notice.
//
// The contract is RECORD_API and the exports below, each with its arity, enumerated by hand — never `export *`. The
// suite's contract test (tests/record-contract.test.mjs) holds the exact list; adding, removing or re-shaping an export
// fails it until RECORD_API is bumped and the table of that contract is written beside the others. RECORD_APIS names
// every contract this module keeps, oldest first and RECORD_API last: each one's exports are still here with the same
// parameters, so a caller written against any of them keeps working, and checks for its own version in RECORD_APIS.
//
// How to call it:
// - `root` is the directory holding .jarl/ (resolveRoot turns a --root value, or nothing, into one).
// - `ids` is one id ('7', '007', '#7') or several, as the CLI takes them: '12,13', '203-206,209', or an array. One id
//   gives back one result object; several give back an array of them.
// - `opts` carries what the CLI's flags carry, under the flags' own names ({ branch, worker, worktree }, { ran, saw },
//   { sha, ci, repo }, { by, supersedes, settles }, …), plus caller on setStatus and setField. The opts keys named at
//   each function below are part of the contract, as much as the parameters: renaming or dropping one bumps
//   RECORD_API; a new optional key does not. The result of every call is what the command's --json prints.
// - A refusal is a thrown Error whose message is the reason, then, on a line of its own, what the caller acts on: a jarl.mjs
//   command, or the fix written out in words (the flag or the argument to give, a <placeholder> where a value only the
//   caller knows goes); nothing is written then. The command line refuses the same call for the same reason and ends with
//   the form of the command that does what was meant, each value a placeholder, which a library caller does not hold
//   (references/composers.md, "The ready line of a refusal").
// - Every call that writes holds .jarl/.lock for its whole length, and every file is written whole (writeAtomic). The
//   lock is re-entrant per loop (a call inside withLock on the same loop keeps that lock; one on another loop takes
//   that loop's own). withLock runs synchronous work only: a function that is async or returns a promise is refused.
// - Waiting for a lock held by another process blocks the thread (Atomics.wait) for up to 20 s before the call is
//   refused; a caller with an event loop to keep responsive runs these calls off it (a worker or a child process).
// - Every call first empties the per-call caches (git refs, resolved repositories, branch tips), so a process that lives
//   long sees git as it is now. The profile is the one thing kept: it is re-read whenever .jarl/profile.json changes
//   its modification time or size, so a rewrite that keeps both is not seen until one of them changes.
// - recordMerged keeps `pending` as the CI state of a merge recorded with a sha and no ci, and never removes a worktree or
//   a branch; the command line records no CI state unless it is given, and does that cleanup (see references/merger.md).
// Zero dependencies, Node 22+.
import { resolve } from 'node:path';
import * as L from './jarl-lib.mjs';

export const RECORD_API = 'jarl-record/3';
export const RECORD_APIS = Object.freeze(['jarl-record/1', 'jarl-record/2', RECORD_API]);

const read = (fn) => { L.resetCaches(); return fn(); };
const write = (root, fn) => { L.resetCaches(); return L.withLock(root, fn); };

// ---- the record format ----------------------------------------------------------------------------

// A loop's record carries its format (see loadProfile's format). This library reads the formats RECORD_FORMATS names
// and refuses a loop of any other, before anything is read or written. A loop with no marker is format 1; the first
// write of a line FORMAT_LINES names raises it to that line's format: 2 for a repository name, a number written plain
// and a retraction, 3 for the rest. Format 3 holds everything format 2 holds. FORMAT_LINES is frozen: by name, each
// line's { format, what, where, misread } — what the line is, where the record writes it, and what a reader that knows
// only the formats below it would make of it.
// A loop whose profile names an external scheduler is never raised: a composer runs it with its own copy of this
// library, and Jarl leaves its format to the composer. A write of a line of a higher format there is refused, naming
// the line, with nothing written, and the command line files its numbers with three digits there; the composer that
// reads a higher format opens its loops with that "format" in the profile.
export const RECORD_FORMATS = L.RECORD_FORMATS;
export const FORMAT_LINES = L.FORMAT_LINES;
// { format, reads, raises, off }: the loop's format, the formats this library reads, whether a write may raise the loop
// (false under an external scheduler) and the names of the lines of FORMAT_LINES that are off in it.
export function recordFormat(root) { return read(() => L.formatState(L.loadProfile(root))); }

// ---- the loop: where it is, opening it, reading it ----------------------------------------------

// The loop's root as the CLI finds it: an explicit root (a --root value, read against `from`, else the working
// directory), else the nearest checkout's root — or the main checkout's, when a worktree holds no loop of its own.
export function resolveRoot(root, from) { return root ? resolve(from ?? process.cwd(), root) : L.findRoot(from); }
export function jarlDir(root) { return L.jarlDir(root); }
export function hasLiveLoop(root) { return L.hasLiveLoop(root); }
// init: opts { committed, permanent, profile } (profile: the path of a profile file).
export function initLoop(root, goal, opts = {}) { return write(root, () => L.cmdInit(root, goal, opts)); }
// The issues as the record has them: each one's status, lease (Branch, Worker, Model, Since), Merged and CI are what the
// loop's journal says, which is what the operations below write beside every header field. A header edited by hand does
// not change them; parseIssue reads a text alone and so reads the header.
export function loadIssues(root) { return read(() => L.loadIssues(root)); }
// The issue a number names, or null. It throws, naming the files, when two issue files carry that number: the journal
// cannot tell their lines apart, so neither is the issue the number names. Two such issues each carry `shared`, the files
// of their number, in loadIssues; no other issue has that key.
export function findIssue(root, id) { return read(() => L.findIssue(root, id)); }
// opts { live }: live leaves out the superseded rulings. A ruling made under one that does not hold carries why, as
// underNotInForce.
export function decisions(root, opts = {}) { return read(() => L.cmdDecisions(root, opts)); }
export function loadAsks(root) { return read(() => L.loadAsks(root)); }

// ---- an issue as text -----------------------------------------------------------------------------

export function parseIssue(text, file) { return L.parseIssue(text, file); }
export function renderIssue(spec) { return L.renderIssue(spec); }
export function mergedOf(issue) { return L.mergedOf(issue); }
// The checkable --ran/--saw rows of an issue's Evidence, as { ran, saw }; a retracted row (struck through by
// addEvidence with opts { retract }) is not one. The rows of the whole section are read, under ### Proof, under
// ### Notes or in a section with no sub-heading.
export function evidenceRows(issue) { return L.evidenceRows(issue); }

// ---- the profile ----------------------------------------------------------------------------------

// A profile, as loadProfile, validateProfile, readProfileFile and DEFAULT_PROFILE give it, is contract in these fields:
//   name, declared (false for the built-in one), initial, statuses (in order), kinds, kindDefault, tiers, tierDefault,
//   fields (the extra header fields: [{ name, key, enum, default, required }]), sections (extra headings), acceptance
//   (the acceptance heading, or null for "Acceptance"), format (the record format, one of RECORD_FORMATS: a loop without a marker is 1), scheduler (the external
//   scheduler's command, or null), doneGate ({ approve: 'fresh'|'none', 'requires-merged': boolean }), lifecycle ({ close: 'any'|'record', archive:
//   'any'|'record', command: string|null } — 'record' refuses jarl close / archive and their MCP tools), and the questions
//   is(status, flag), with(flag), flagsOf(status), setBy(status) ('any' or 'record'), active(status),
//   unfinished(status), field(name). Any other key is not. describeProfile gives the plain-data form.
// DEFAULT_PROFILE and STATUS_FLAGS (the six flags, in order) are frozen, lists included; treat every profile as read-only.
export const PROFILE_VERSION = L.PROFILE_VERSION;
export const STATUS_FLAGS = L.STATUS_FLAGS;
export const DEFAULT_PROFILE = L.DEFAULT_PROFILE;
export function validateProfile(json, where) { return L.validateProfile(json, where); }
export function readProfileFile(file) { return L.readProfileFile(file); }
export function loadProfile(root) { return L.loadProfile(root); }
export function describeProfile(profile) { return L.describeProfile(profile); }

// ---- one writer at a time -------------------------------------------------------------------------

export function withLock(root, fn) { return L.withLock(root, fn); }
// Any file whole, except the loop's journal (log.md), which is appended to by appendLog and refused here. The issue
// fields the record renders from the journal (Status, Branch, Worker, Model, Since, Merged, CI) are not the file's to
// change: a write of one that differs from the journal is read as a disagreement, never as the new state. The fields the
// journal does not hold (title, Kind, Priority, Tier, Tags, Files, Repo, After, Source, Where, Resources, a profile's own
// fields) and the text of every section stay the file's.
export function writeAtomic(path, text) { return L.writeWhole(path, text); }

// ---- operations on the record (each under the lock) ---------------------------------------------

// new: opts { kind, prio, tier, tags, files, repo, 'found-by', where, what, why, acceptance, source, after, changelog,
// template, field, section, person, 'check-when' } (person and check-when: the outside person a wait is held by and
// when to check it, both required on kind wait and refused on any other).
// The library names the width of a new number (three digits, so the file reads 007-…); the command line names none.
export function newIssue(root, title, opts = {}) { return write(root, () => L.cmdNew(root, title, { width: 3, ...opts })); }
// A move into a status, checked against the profile: needs-reason wants `why`, closes-record passes the done gate,
// holds-claim writes the lease from opts { branch, worker, model }, leaving it removes the lease. The lease holds: an
// issue another worker or branch holds, and a file or resource another lease holds, are refused, unless opts.handover
// (true) hands a leased issue to the new worker or branch, with `why` as the reason. In a loop whose profile names an
// external scheduler the composer decides who holds what, and neither refusal runs: a call written against any
// contract in RECORD_APIS leases there as it always did. A lease records no
// worktree, which is found through its branch: a worktree key is accepted and stores nothing, and is never refused.
// opts.caller says who asks: 'record' (the default for a library call) or 'cli' (what the command line and the MCP tools
// always pass). A status the profile marks "set-by": "record" refuses 'cli'; a library caller that acts for a person at
// the command line passes 'cli' too. setField takes the same opts.caller. The profile's done-gate decides what a move
// into closes-record asks for (requires-merged: a recorded merge the base holds; approve: 'none': no approve). The base
// is the branch checked out in the merge's repository, or opts.base (a branch or ref, library callers only) when the
// composer landed the merge into a branch that is not checked out there.
export function setStatus(root, ids, status, why, opts = {}) {
  return write(root, () => L.cmdSetStatus(root, ids, status, why, opts));
}
// A field the profile declares (Kind and Tier too, when it declares them), checked against its values; and the tool's
// own Tags, Priority, Files and Source by those names, each written as the command line's field writes it (Tags and Files
// a whole comma list, Priority 1, 2 or 3, Source <report-dir#finding-id> refs). A change of the description is logged
// with the old value, and with its writer when opts.by names one (setField, setBody, setRepo, setAfter); setTags,
// setPriority, setFiles and setSource take no opts, so their changes are logged with no writer, and a caller that names
// one writes those four fields through setField.
export function setField(root, ids, field, value, opts = {}) {
  return write(root, () => L.cmdSetField(root, ids, field, value, opts));
}
// The title (the heading only; the file keeps its name) and the sections: opts { title, where, what, why, acceptance, changelog, section, by } (section: "<Heading>=<text>", repeatable).
export function setBody(root, id, opts = {}) { return write(root, () => L.cmdBody(root, id, opts)); }
// tags: ['+name', '-name', …].
export function setTags(root, ids, ops) { return write(root, () => L.cmdTag(root, ids, ops)); }
export function setPriority(root, ids, priority) { return write(root, () => L.cmdPrio(root, ids, priority)); }
export function setFiles(root, id, files) { return write(root, () => L.cmdFiles(root, id, files)); }
// path is a repository's name, its checkout, a worktree of it or a file inside it (several as one comma list), stored as a
// name where the checkout sits beside the loop's own and as a path elsewhere; opts { clear, by }.
export function setRepo(root, id, path, opts = {}) { return write(root, () => L.cmdRepo(root, id, path, { clear: opts.clear === true, by: opts.by })); }
export function setAfter(root, id, ids, opts = {}) { return write(root, () => L.cmdAfter(root, id, ids, { clear: opts.clear === true, by: opts.by })); }
export function setSource(root, id, refs) { return write(root, () => L.cmdSource(root, id, refs)); }
// Free text, or opts { ran, saw } (one row per pair; text then undefined), or opts { retract: n, by } (n a row number, or note-<n> for a free-text note) with the reason as
// text: the n-th row of the whole Evidence section (retracted rows counted) is struck through and an entry saying who
// retracted it and why is appended; the done gate stops counting it. The first retraction raises the loop's record
// format, so a Jarl that cannot read a retraction refuses the loop. Rows are written under ### Proof, after the last
// row of the section; text and the retraction entry under ### Notes. An Evidence section that already holds content and
// no sub-heading is appended to as it stands.
export function addEvidence(root, ids, text, opts = {}) { return write(root, () => L.cmdEvidence(root, ids, text, opts)); }
// verdict: approve | changes (findings of at least three words); opts { by, model, relayed, outside, field }: outside, one
// finding outside the issue or a list, each filed as a new issue (Found by the reviewer, Where the review), field the
// Name=value pairs those issues take; the result names them in filed. verdict retract, with the reason as findings,
// retracts the newest approve not yet retracted by an appended entry (never a changes verdict, and never with outside or
// field), and raises the record format the first time, like addEvidence's retract.
export function review(root, ids, verdict, findings, opts = {}) { return write(root, () => L.cmdReview(root, ids, verdict, findings, opts)); }
// opts { sha, ci, repo }, and the optional keys { ran, saw }: the check that decided the merge and what it printed. They
// go to the merge record (the Merge check field and the merge line) and are never written as a Proof row, so a merge never
// stands in for the worker's proof; a composer that closes on rows writes its own with addEvidence.
export function recordMerged(root, ids, opts = {}) { return write(root, () => L.cmdMerged(root, ids, opts)); }
export function addRound(root, id, what) { return write(root, () => L.cmdRound(root, id, what)); }
// opts { by, supersedes, settles, area, reach, rule }.
export function decide(root, slug, ruling, opts = {}) { return write(root, () => L.cmdDecide(root, slug, ruling, opts)); }
// opts { kind, target, issue, ruling }. ruling (the slug of an area ruling in force, with kind ratify) makes the question
// that ruling's ratification item — what close's batch files, and what a composer files for a batch of its own — so its
// answer marks the ruling ratified or rejected. A ruling already asked about, ratified, rejected or superseded is refused.
export function ask(root, question, opts = {}) { return write(root, () => L.cmdAsk(root, question, { width: 3, ...opts })); }
// A ratify item from the close's batch names an area ruling: its answer starts with yes or reject and marks that ruling
// Ratified or Rejected; the result then carries { ruling, verdict, typeDecision, typeLog, ruleRatification, ruleLog }.
// A ratified area ruling's typeDecision ({ type, text, supersedes }) is the entry for the type's decision log, and its
// ruleRatification ({ rule, text }, when the ruling names a rule) the ratification for that rule's own log: the command
// line writes both (yg-edge.mjs); this library never does, so a composer writes them with its own code or leaves them.
// The command line leaves them to the composer too on a loop whose profile keeps close to the record (lifecycle): its
// answer says so as a skipped write. decisions() tells a composer what is written already: typeLog and ruleLog, set
// once the entry is in the graph's log (the **Type log:** and **Rule log:** fields a writer adds to the ruling).
export function answer(root, id, text) { return write(root, () => L.cmdAnswer(root, id, text)); }
// A free note for the journal. A line that reads as a filing, a move, a round, a verdict, a retraction, an evidence row, a
// branch tip, a merge, a CI state, a body change, the owner's tick of an acceptance line or its retraction is refused and names the
// operation that writes it.
export function appendLog(root, event) {
  return write(root, () => { L.need(event, 'log requires "<text>"', () => (['jarl.mjs', 'log', '<text>'])); L.appendNote(root, event); return { logged: event }; });
}

// ---- the views' data ------------------------------------------------------------------------------

// status --json: opts { 'stale-hours', by }. It carries `disagreements` (one entry per header that disagrees with the
// journal, with the line that says how to settle it) when there are any, and resumeData the same; and `recordFormat`,
// what recordFormat returns.
export function statusData(root, opts = {}) { return read(() => L.cmdStatus(root, opts)); }
// resume --json: opts { log, ready, ci }; ci asks gh for the CI of the tips, as the command line's --gh does, and gh is
// taken as the same key.
export function resumeData(root, opts = {}) { return read(() => L.cmdResume(root, opts)); }
// brief --json: the brief of an issue's worker (opts { role: 'worker' }, the default) or reviewer (role 'reviewer'), or,
// with id null and opts { slice }, of that slice's coordinator. It carries the role, the roles and moments the rules were
// matched for and the rules that match (each { slug, scope, until, by, under, builtin, source, text }, and underNotInForce
// when the ruling it is made under does not hold), the count of the
// rulings in force with the command that lists them (rulings { inForce, command }), the role's
// reference ({ file, section }, inside the skill's directory), the commands that record the result ({ what, command },
// each with a placeholder for every value) and notes; an issue's brief also the issue as show prints it (show, without
// the lines that name where things are on this machine), its rounds, the findings of the reviews that sent it back and its
// proof rows ({ n, ran, saw }), and a slice's its issues in play. Every part is whole: nothing is cut.
export function briefData(root, id, opts = {}) { return read(() => L.cmdBrief(root, id, opts)); }
