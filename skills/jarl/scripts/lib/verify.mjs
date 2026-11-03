// Verify: the record read strictly, with nothing written.

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fieldText, need } from './base.mjs';
import { canonical, jarlDir } from './where.mjs';
import { readText } from './files.mjs';
import { ISSUE_FILE_RE, cmpId, idKey, needsRaisedFormat } from './ids.mjs';
import { RECORD_FORMAT_RAISED, loadProfile } from './profile.mjs';
import { ASKS_FILE, DECISIONS_FILE, GOAL_FILE, LOG_FILE, goalLines, loadDecisions, readGoal } from './journal.mjs';
import { loopEvents } from './log.mjs';
import { parseIssue, sharedNumberText, sharedNumbers } from './issues.mjs';
import { REPOS_DECLARED_IN, declaredNames, issueRepos, repoIdentity, repoValueKind, reposNamed, worktreesOf } from './repositories.mjs';
import { readLoop, recordDisagreements } from './loop.mjs';
import { attachmentFindings } from './attachments.mjs';
import { hasLiveLoop } from './commands.mjs';
import { issuesNaming, loadAsks } from './questions.mjs';

// ---- verify: the record read strictly, with nothing written ----------------------------------------------------
//
// verify runs the readers of the record in their strict mode (see loopEvents, goalLines, parseIssue, loadAsks and
// loadDecisions, and validateProfile, which lists every problem it finds) and reports what each one did not place. It
// adds no grammar of its own: a line is placed by the reader that owns it, and what verify adds is what the readers do
// not see — a retraction that points at nothing, the record format a line needs, the header that disagrees with the log,
// the repositories the issues name, the worktrees the leases hold and the open issues that cite a superseded ruling. It
// takes no lock and no network and writes nothing; its exit status is the caller's (2 when it found something).

// The checks in the order they print, with the part of the loop each one reads.
const VERIFY_CHECKS = [
  ['profile', 'profile.json'], ['log', LOG_FILE], ['asks', ASKS_FILE], ['decisions', DECISIONS_FILE], ['goal', GOAL_FILE],
  ['issues', 'issues/'], ['format', 'record format'], ['headers', 'issue headers'], ['repositories', REPOS_DECLARED_IN],
  ['leases', 'worktree leases'], ['superseded', 'open issues citing a superseded ruling'], ['attachments', 'recorded attachment files'],
];
export const VERIFY_SHOWN = 20;
// Free text from the record as a finding shows it: one line, with control characters escaped, at most 120 characters.
function shownText(text) {
  const s = JSON.stringify(String(text)).slice(1, -1);
  return s.length > 120 ? `${s.slice(0, 119)}…` : s;
}
// The lines of a profile error: the problems list validateProfile throws, or the message itself.
function profileProblems(message) {
  const items = String(message).split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
  return items.length ? items : [String(message)];
}
// Every finding of the loop in `root`, as the checks print them, and the notes; a profile that does not parse ends the
// reading, because every other reader goes through the profile.
export function cmdVerify(root) {
  need(hasLiveLoop(root), 'verify reads a loop: there is no .jarl/ with a goal here — open one with jarl.mjs init "<goal>", or name the loop with --root');
  const found = [];
  const notes = [];
  // n is the line of the file the finding is about, where it has one: a check's findings print in file order.
  const add = (check, where, what, n) => found.push({ check, where, what, n });
  const dir = jarlDir(root);
  let profile;
  try { profile = loadProfile(root); } catch (e) {
    for (const reason of profileProblems(e.message)) add('profile', 'profile.json', reason);
    return verifyResult(found, notes, 'the profile does not parse, and the other readers go through it');
  }
  const logSkips = [];
  const events = loopEvents(dir, profile, logSkips);
  for (const s of logSkips) add('log', `${LOG_FILE} line ${s.n}`, `"${shownText(s.text)}" — ${s.reason}`, s.n);
  const asksSkips = [];
  loadAsks(root, asksSkips);
  for (const s of asksSkips) add('asks', `${ASKS_FILE} line ${s.n}`, `"${shownText(s.text)}" — ${s.reason}`, s.n);
  const decisionSkips = [];
  const rulings = loadDecisions(root, decisionSkips);
  for (const s of decisionSkips) add('decisions', `${DECISIONS_FILE} line ${s.n}`, `"${shownText(s.text)}" — ${s.reason}`, s.n);
  const goalSkips = [];
  goalLines(readGoal(dir), goalSkips);
  for (const s of goalSkips) add('goal', `${GOAL_FILE} line ${s.n}`, `"${shownText(s.text)}" — ${s.reason}`, s.n);
  for (const f of issueFilesOf(dir)) {
    const issueSkips = [];
    parseIssue(readText(join(dir, 'issues', f)), join(dir, 'issues', f), issueSkips);
    for (const s of issueSkips) add('issues', `issues/${shownText(f)} line ${s.n}`, `"${shownText(s.text)}" — ${s.reason}`);
  }
  for (const f of existsSync(join(dir, 'issues')) ? readdirSync(join(dir, 'issues')) : []) {
    if (!ISSUE_FILE_RE.test(f)) add('issues', `issues/${shownText(f)}`, 'a file the loop does not read as an issue: an issue file is <number>-<title>.md');
  }
  const loop = readLoop(dir);
  // A number two files carry: the files, then what it means and how it is settled (headers says nothing of their fields).
  for (const s of sharedNumbers(loop.issues)) add('issues', `issue ${s.id}`, sharedNumberText(s, loop.issues));
  const known = new Set(loop.issues.filter((i) => i.id !== null).map((i) => idKey(i.id)));
  for (const i of loop.issues) {
    if (i.id === null) continue;
    for (const a of i.after) if (!known.has(idKey(a))) add('issues', `issue ${i.id}`, `waits on issue ${a} in its After field, which the loop does not hold`);
  }
  if (profile.format < RECORD_FORMAT_RAISED) {
    for (const e of events) {
      // A retraction is a line of the log: it is found there, with the other findings of the log, in file order.
      if (e.type === 'retract-row' || e.type === 'retract-review') add('format', `${LOG_FILE} line ${e.n + 1}`, `"${shownText(e.text)}" — a retraction is written in the raised record format, and this loop is not in it`, e.n + 1);
    }
    for (const i of loop.issues) {
      if (i.id !== null && needsRaisedFormat(i.id)) add('format', `issue ${i.id}`, 'its id needs the raised record format (an id of 1000 or more, or of fewer than three digits), and this loop is not in it');
    }
  }
  retractionChecks(events, add);
  // A refiled number's line is the tool's own advice and prints whole; the others are cut as free text is.
  for (const d of recordDisagreements(loop)) if (d.field !== 'number') add('headers', '', d.field === 'refiled' ? d.line : shownText(d.line));
  repositoryChecks(root, loop, add, notes);
  for (const i of loop.issues) {
    const lease = fieldText(i.fields.worktree);
    if (i.id === null || !lease || !profile.is(i.status, 'holds-claim')) continue;
    const path = canonical(resolve(root, lease));
    const repos = issueRepos(root, i);
    // A lease is compared with the repositories its issue resolves to; one that resolves to none is a repository that is
    // not on this machine, which the repositories check says, and a worktree that is gone is the status's to say.
    if (!existsSync(path) || repos.length === 0) continue;
    const listed = repos.flatMap((r) => (worktreesOf(r) || []).filter((w) => w.path).map((w) => canonical(w.path)));
    if (!listed.includes(path)) add('leases', `issue ${i.id}`, `its worktree ${shownText(lease)} is not a worktree of a repository the issue names (its Repo field, or the loop's own repository)`);
  }
  const supersededBy = new Map(rulings.filter((d) => d.supersededBy).map((d) => [d.slug, d.supersededBy]));
  for (const [slug, by] of supersededBy) {
    for (const i of issuesNaming(root, slug)) add('superseded', `issue ${i.id}`, `cites the ruling ${slug} in What, Why or Acceptance, and ${by} supersedes it`);
  }
  for (const f of attachmentFindings(root, loop)) add('attachments', `issue ${f.id}`, f.what);
  return verifyResult(found, notes, null, profile.doneGate['requires-slots'] !== undefined || found.some((f) => f.check === 'attachments'));
}
// The issue files of a loop, in the order the loop reads them.
function issueFilesOf(dir) {
  const d = join(dir, 'issues');
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => ISSUE_FILE_RE.test(f)).sort((a, b) => cmpId(ISSUE_FILE_RE.exec(a)[1], ISSUE_FILE_RE.exec(b)[1]) || (a < b ? -1 : a > b ? 1 : 0));
}
// The retraction lines: a row number that the log's rows of the issue do not reach, and an approve that was not given by
// the reviewer the line names, or a "changes" verdict it names, or none at all.
function retractionChecks(events, add) {
  const rows = new Map();
  const verdicts = new Map();
  for (const e of events) {
    if (e.id === null) continue;
    const where = `${LOG_FILE} line ${e.n + 1}`;
    if (e.type === 'row') rows.set(e.id, (rows.get(e.id) || 0) + 1);
    if (e.type === 'verdict') verdicts.set(e.id, [...(verdicts.get(e.id) || []), e]);
    if (e.type === 'retract-row') {
      const have = rows.get(e.id) || 0;
      if (e.row > have) add('log', where, `"${shownText(e.text)}" — row ${e.row} of issue ${e.id} is not one of the ${have} evidence rows the log holds for it`, e.n + 1);
    }
    if (e.type === 'retract-review') {
      const before = verdicts.get(e.id) || [];
      if (!e.target) { add('log', where, `"${shownText(e.text)}" — the line names no approve, so it takes away none`, e.n + 1); continue; }
      const same = before.filter((v) => v.by === e.target.by);
      if (same.some((v) => v.verdict === 'approve')) continue;
      const named = e.target.by === null ? 'with no reviewer recorded' : `by ${e.target.by}`;
      if (same.some((v) => v.verdict === 'changes')) add('log', where, `"${shownText(e.text)}" — it takes away the approve ${named}, which the log holds as a "changes" verdict: only an approve is retracted`, e.n + 1);
      else add('log', where, `"${shownText(e.text)}" — the log holds no approve ${named} before it, so it points at no entry`, e.n + 1);
    }
  }
}
// The repositories the issues name by name, and the declared ones: each one's identity against the checkout on this
// machine. A Repo that holds a path is not a name and is not checked here.
function repositoryChecks(root, loop, add, notes) {
  const named = new Map();
  for (const i of loop.issues) {
    for (const v of reposNamed(i)) if (repoValueKind(root, v) === 'name') named.set(v, [...(named.get(v) || []), i.id]);
  }
  for (const name of new Set([...named.keys(), ...declaredNames(root)])) {
    const id = repoIdentity(root, name);
    const cited = named.get(name) ? ` (named by issue ${named.get(name).join(', ')})` : '';
    if (id.state === 'undeclared') add('repositories', name, `is named${cited} but has no declaration in ${REPOS_DECLARED_IN}`);
    else if (id.state === 'missing') add('repositories', name, `is declared and does not resolve on this machine — ${id.fix}`);
    else if (id.state === 'mismatch') add('repositories', name, id.fix);
    else if (id.state === 'unverified') add('repositories', name, `cannot be verified: ${id.notes.join('; ')}`);
    else for (const n of id.notes) notes.push({ where: name, what: n });
  }
}
// The attachments check prints only for a loop whose profile declares slots, or that holds a finding of it.
function verifyResult(found, notes, unread = null, attachments = false) {
  const checks = VERIFY_CHECKS.filter(([name]) => name !== 'attachments' || attachments).map(([name, label]) => ({
    name, label, read: unread === null || name === 'profile',
    // Findings with a line print in file order, the ones without after them, in the order they were found.
    findings: found.filter((f) => f.check === name)
      .map((f, k) => ({ ...f, k }))
      .sort((a, b) => (a.n === undefined) - (b.n === undefined) || (a.n ?? 0) - (b.n ?? 0) || a.k - b.k)
      .map(({ where, what }) => ({ where, what })),
  }));
  return { ok: found.length === 0, findings: found.length, checks, notes, unread };
}
// verify as the command line prints it: each check with its count, its first findings and a count of the rest, then the notes.
export function renderVerify(o) {
  const lines = [o.ok ? 'verify: clean — every line of the record is placed, and nothing disagrees' : `verify: ${o.findings} finding${o.findings === 1 ? '' : 's'}`];
  for (const c of o.checks) {
    if (!c.read) { lines.push(`${c.label}: not read (${o.unread})`); continue; }
    lines.push(c.findings.length ? `${c.label}: ${c.findings.length}` : `${c.label}: clean`);
    for (const f of c.findings.slice(0, VERIFY_SHOWN)) lines.push(`  ${f.where ? `${f.where}: ` : ''}${f.what}`);
    if (c.findings.length > VERIFY_SHOWN) lines.push(`  … and ${c.findings.length - VERIFY_SHOWN} more`);
  }
  const shownNotes = o.notes.slice(0, VERIFY_SHOWN);
  for (const n of shownNotes) lines.push(`note: ${n.where ? `${n.where}: ` : ''}${n.what}`);
  if (o.notes.length > VERIFY_SHOWN) lines.push(`note: … and ${o.notes.length - VERIFY_SHOWN} more`);
  return lines.join('\n');
}
