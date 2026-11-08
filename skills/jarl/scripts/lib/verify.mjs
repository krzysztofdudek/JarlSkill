// Verify: the record read strictly, with nothing written.

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fieldText, jarlLine, need } from './base.mjs';
import { canonical, jarlDir } from './where.mjs';
import { readText } from './files.mjs';
import { ISSUE_FILE_RE, cmpId, idKey, needsRaisedFormat } from './ids.mjs';
import { FORMAT_LINES, RECORD_FORMAT_RAISED, formatOffText, formatState, loadProfile } from './profile.mjs';
import { ASKS_FILE, DECISIONS_FILE, GOAL_FILE, LOG_FILE, goalLineOf, goalLines, loadDecisions, readGoal } from './journal.mjs';
import { loopEvents } from './log.mjs';
import { issueKeyOf, parentCycle, parseIssue, sharedNumberText, sharedNumbers } from './issues.mjs';
import { REPOS_DECLARED_IN, declaredNames, issueRepos, repoIdentity, repoValueKind, reposNamed, worktreesOf } from './repositories.mjs';
import { headerReadNotes, readLoop, recordDisagreements, unorderedNamings, unorderedText } from './loop.mjs';
import { attachmentFindings } from './attachments.mjs';
import { hasLiveLoop } from './commands.mjs';
import { issuesNaming, loadAsks, unsettledRulings, unsettledText } from './questions.mjs';

// ---- verify: the record read strictly, with nothing written ----------------------------------------------------
//
// verify runs the readers of the record in their strict mode (see loopEvents, goalLines, parseIssue, loadAsks and
// loadDecisions, and validateProfile, which lists every problem it finds) and reports what each one did not place. It
// adds no grammar of its own: a line is placed by the reader that owns it, and what verify adds is what the readers do
// not see — a retraction that points at nothing, the record format a line needs, the header that disagrees with the log,
// the repositories the issues name, the worktrees the leases hold, the open issues that cite a superseded ruling and, as
// notes, the rulings in force whose settled issues are not closed. It
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
  need(hasLiveLoop(root), `verify reads a loop: there is no .jarl/ with a goal here — open one with ${jarlLine('init', '<goal>')}, or name the loop with --root`, () => (['jarl.mjs', 'init', '<goal>']));
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
  const goalText = readGoal(dir);
  goalLines(goalText, goalSkips);
  // A Takeover line for a kind the profile does not declare never applies to an issue.
  (goalText ?? '').split('\n').forEach((text, i) => {
    const line = goalLineOf(text);
    if (!line || line.key !== 'takeover' || line.qualifier === null || goalSkips.some((s) => s.n === i + 1)) return;
    if (!profile.kinds.some((k) => k.toLowerCase() === line.qualifier.toLowerCase())) goalSkips.push({ n: i + 1, text, reason: `the profile declares no kind ${line.qualifier}, so the line applies to no issue: its kinds are ${profile.kinds.join(', ')}` });
  });
  // The Merger line names the jarl or a coordinator the Coordinators line lists: anyone else raises no merger in the record.
  const lines = goalLines(goalText);
  if (lines.merger !== null && lines.merger.toLowerCase() !== 'jarl' && !lines.coordinators.some((c) => c.toLowerCase() === lines.merger.toLowerCase())) {
    const n = (goalText ?? '').split('\n').findIndex((t) => goalLineOf(t)?.key === 'merger');
    goalSkips.push({ n: n + 1, text: (goalText ?? '').split('\n')[n], reason: `${lines.merger} is neither the jarl nor a coordinator of the Coordinators line, so no holder of the loop raises its merger` });
  }
  for (const s of goalSkips) add('goal', `${GOAL_FILE} line ${s.n}`, `"${shownText(s.text)}" — ${s.reason}`, s.n);
  for (const f of issueFilesOf(dir)) {
    const issueSkips = [];
    parseIssue(readText(join(dir, 'issues', f)), join(dir, 'issues', f), issueSkips);
    for (const s of issueSkips) add('issues', `issues/${shownText(f)} line ${s.n}`, `"${shownText(s.text)}" — ${s.reason}`);
  }
  for (const f of existsSync(join(dir, 'issues')) ? readdirSync(join(dir, 'issues')) : []) {
    if (!ISSUE_FILE_RE.test(f)) add('issues', `issues/${shownText(f)}`, 'a file the loop does not read as an issue: an issue file is its number, a dash and its title, ending in .md');
  }
  const loop = readLoop(dir);
  // A number two files carry: the files, then what it means and what the coordinator does (headers says nothing of their fields).
  for (const s of sharedNumbers(loop.issues)) add('issues', `issue ${s.id}`, sharedNumberText(s, loop.issues));
  const known = new Set(loop.issues.filter((i) => i.id !== null).map((i) => idKey(i.id)));
  for (const i of loop.issues) {
    if (i.id === null) continue;
    for (const a of i.after) if (!known.has(idKey(a))) add('issues', `issue ${i.id}`, `waits on issue ${a} in its After field, which the loop does not hold`);
  }
  // The tree as written: a Parent names another issue the loop holds, the parents above an issue never come back to it,
  // and nothing unfinished sits under a finished issue (each refused at the write, and found here after a hand edit).
  for (const i of loop.issues) {
    if (i.id === null || i.parent === null) continue;
    const finished = i.tree.ancestors.find((a) => profile.is(a.status, 'terminal'));
    if (idKey(i.parent) === idKey(i.id)) add('issues', `issue ${i.id}`, 'names itself in its Parent field');
    else if (!i.tree.parent) add('issues', `issue ${i.id}`, `names ${i.parent} in its Parent field, which the loop does not hold`);
    else if (parentCycle(i)) add('issues', `issue ${i.id}`, `its parents come back to it (${[i, ...i.tree.ancestors, i].map((a) => a.id).join(' → ')}), so none of them is ever offered`);
    else if (finished && profile.unfinished(i.status)) add('issues', `issue ${i.id}`, `is ${i.status} under ${finished.id}, which is ${finished.status}: reopen ${finished.id}, or finish ${i.id}`);
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
  // A line of a format the loop is not in: a writer after the stamp is held by format 3, and so is an escalation.
  if (profile.format < FORMAT_LINES.writer.format) {
    for (const e of events) if (e.writer !== null) add('format', `${LOG_FILE} line ${e.n + 1}`, `"${shownText(e.text)}" names its writer (${shownText(e.writer)}), which is written in record format ${FORMAT_LINES.writer.format}, and this loop is not in it`, e.n + 1);
  }
  // An issue's key, in its header or in a log line, is held by format 3: a reader of a lower format reads the lines by
  // number alone.
  if (profile.format < FORMAT_LINES['issue-key'].format) {
    for (const i of loop.issues) if (i.id !== null && profile.keyed && issueKeyOf(i)) add('format', `issue ${i.id}`, `its header carries a key (${shownText(i.fields.key)}), which is written in record format ${FORMAT_LINES['issue-key'].format}, and this loop is not in it`);
    for (const e of events) if (e.key) add('format', `${LOG_FILE} line ${e.n + 1}`, `"${shownText(e.text)}" names a key (${e.key}), which is written in record format ${FORMAT_LINES['issue-key'].format}, and this loop is not in it`, e.n + 1);
  }
  // A parent is held by format 3: a reader of a lower format reads the backlog as flat.
  if (profile.format < FORMAT_LINES.parent.format) {
    for (const i of loop.issues) if (i.id !== null && i.parent !== null) add('format', `issue ${i.id}`, `its header names a parent (${shownText(i.parent)}), which is written in record format ${FORMAT_LINES.parent.format}, and this loop is not in it`);
  }
  // A question of a format the loop is not in: an escalation is held by format 3.
  if (profile.format < FORMAT_LINES.escalation.format) {
    for (const a of loadAsks(root)) if (a.kind === 'escalation') add('format', `${ASKS_FILE} a-${a.id}`, `an escalation is written in record format ${FORMAT_LINES.escalation.format}, and this loop is not in it`);
  }
  // A waiver of review is held by format 3: below it the done gate does not count it, and a reader of a lower format
  // counts the issue as unreviewed.
  if (profile.format < FORMAT_LINES['review-waiver'].format) {
    for (const d of rulings) if (d.waives) add('format', `${DECISIONS_FILE} ${d.slug}`, `a waiver of the review of ${d.waives.join(', ')} is written in record format ${FORMAT_LINES['review-waiver'].format}, and this loop is not in it`);
  }
  retractionChecks(events, add);
  // A shared number is the issues check's finding. A number the log files more than once, now one file's, is read from
  // its header: a one-line note, while a contradiction inside that header is a finding, printed whole as the tool wrote it.
  for (const d of recordDisagreements(loop)) if (d.field !== 'number') add('headers', '', d.field === 'header' ? d.line : shownText(d.line));
  for (const n of headerReadNotes(loop)) notes.push({ where: `issue ${n.id}`, what: n.line });
  repositoryChecks(root, loop, add, notes);
  for (const n of unorderedNamings(loop.issues, profile)) notes.push({ where: `issue ${n.id}`, what: unorderedText(n) });
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
  // A ruling in force whose settled issues are not all closed is work not yet carried out: said, never a finding.
  for (const u of unsettledRulings(loop)) notes.push({ where: `ruling ${u.slug}`, what: `${unsettledText(u)}, which ${u.issues.length === 1 ? 'is' : 'are'} neither done nor dropped` });
  for (const f of attachmentFindings(root, loop)) add('attachments', `issue ${f.id}`, f.what);
  // The format of the loop, and the lines of a higher format that are off where a composer keeps it.
  const format = formatState(profile);
  if (formatOffText(format)) notes.push({ where: '', what: formatOffText(format) });
  return verifyResult(found, notes, null, profile.doneGate['requires-slots'] !== undefined || found.some((f) => f.check === 'attachments'), format.format);
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
function verifyResult(found, notes, unread = null, attachments = false, format = null) {
  const checks = VERIFY_CHECKS.filter(([name]) => name !== 'attachments' || attachments).map(([name, label]) => ({
    name,
    // The format check names the format the loop is in, once the profile is read.
    label: name === 'format' && format !== null ? `${label} ${format}` : label,
    read: unread === null || name === 'profile',
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
