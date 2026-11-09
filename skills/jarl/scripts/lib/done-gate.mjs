// What a close to done must show: the refusals of the gate and the notes it leaves.

import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fieldText, jarlLine } from './base.mjs';
import { git, gitHere } from './git.mjs';
import { canonical, jarlDir, portablePath } from './where.mjs';
import { parseStamp } from './journal.mjs';
import { journalById } from './log.mjs';
import { alignRows, evidenceRows, evidenceTable, mergedOf } from './issues.mjs';
import { baseOf, branchTip, fileAt, isGitRepo, issueRepoPaths, repoLabel } from './repositories.mjs';
import { carriesCode, unmergedCode, unmergedText, gateOf, sinceText, unclearedText, worksInPlace } from './gate.mjs';
import { readLoop } from './loop.mjs';
import { lastMerge } from './metrics.mjs';
import { modelRefusalOf, modelReviewForm } from './models.mjs';
import { slotRefusal } from './attachments.mjs';
import { ownerLineRefusal, ownerLineRewrite } from './owner-lines.mjs';
import { LINE_FORM, lineRowForm, lineStates, lineStateText, unprovedMechanical } from './lines.mjs';

// Why an issue may not go done, or null when it may: at least one --ran/--saw evidence row inside the gate's window
// (see gateWindow; free-text notes never count alone), and a live approve by someone
// other than its worker (see gateState) — by a fresh reviewer when the issue carries code (a Branch or Merged field;
// see carriesCode). It gates only the record: nothing here stops code from landing.
// A profile's done-gate changes the last two: requires-merged also asks for a recorded merge whose sha is in the base
// (see mergeRefusal), and approve: none (allowed only with requires-merged) drops the approve — the gate that landed
// the merge stands behind the issue instead of a reviewer. The evidence rows are asked for either way, and so is the
// owner's tick of every acceptance line only he ticks (see owner-lines.mjs).
// doneRefusal reads the loop for one issue; a caller checking several issues reads it once and asks doneRefusalIn.
export function doneRefusal(root, issue) { return doneRefusalIn(root, readLoop(jarlDir(root)), issue, undefined); }

function doneRefusalIn(root, loop, issue, base) { return doneGateIn(root, loop, issue, base)?.text ?? null; }

// Why done refuses, as { text, cause }, or null: the cause (retraction, evidence, slots, merge, owner, approve, model)
// decides the step a refusal of the move ends with. `base`: the branch or ref the merge landed in, when the caller names
// one.
export function doneGateIn(root, loop, issue, base) {
  const { profile } = loop;
  const g = gateOf(loop, issue.id);
  if (g.unresolvedRetractions.length) return { cause: 'retraction', text: `${issue.id} records a retraction of evidence row ${g.unresolvedRetractions.join(', ')} that matches no evidence line of the log, so which row it retracts is unknown and a retracted row might be counted — done refuses until that log line is repaired` };
  // A parent closes after the whole under it: every sub-issue settled, then its own acceptance checked against the whole.
  const open = (issue.tree ? issue.tree.children : []).filter((c) => !profile.is(c.status, 'settles-dependents'));
  if (open.length) return { cause: 'subs', text: `${issue.id} has sub-issues not closed: ${open.map((c) => `${c.id} (${c.status})`).join(', ')} — a parent is closed once each of its sub-issues is done or dropped and its own acceptance is then checked against the whole` };
  // Done asks of every line what its method asks: rows here (read lines by the approve below, owner lines by his tick).
  const states = lineStates(loop, issue, g);
  // A promise or a wait with no line is kept, not worked: its row records what came, as ever.
  if (!states.length && profile.keptKind(issue.kind)) {
    if (g.tracked ? !g.rowsSince : !evidenceRows(issue).length) return { cause: 'evidence', text: `${issue.id} has no --ran/--saw row recorded${g.anchor ? ` since ${sinceText(g.anchor)}` : ''} — record what was done: ${jarlLine('evidence', issue.id, '--ran', '<command>', '--saw', '<what-it-printed>', '--by', '<who>')}` };
  } else if (!states.length) return { cause: 'lines', text: `${issue.id} has no acceptance line, so there is nothing done can ask of it — write what it is to prove first: ${jarlLine('field', issue.id, 'Acceptance', LINE_FORM)}` };
  const unproved = unprovedMechanical(states);
  // A merge that records its check does not stand in for a worker's row: said to whoever is refused, the merger included.
  const mergeLine = lastMerge(loop.eventsById.get(issue.id) || []);
  const gap = mergeLine && mergeLine.check ? ` — the merge records a check (${mergeLine.check}), but that check is the merger's and does not stand in for the worker's row: the row is the worker's proof of the work, so the worker records what the work's own check ran and printed, and nobody types the merge check into Proof in its place` : '';
  if (unproved.length) return { cause: 'evidence', text: `${issue.id} has lines whose method is not met${g.tracked && g.anchor ? ` (rows count since ${sinceText(g.anchor)})` : ''}: ${unproved.map(lineStateText).join('; ')} — ${lineRowForm(issue.id)}${gap}` };
  const slots = slotRefusal(root, profile, issue, g);
  if (slots) return { cause: 'slots', text: slots };
  if (profile.doneGate['requires-merged']) { const m = mergeRefusal(root, issue, base, g); if (m) return { cause: 'merge', text: m }; }
  const owner = () => { const text = ownerLineRefusal(root, loop, issue); return text ? { cause: ownerLineRewrite(root, loop, issue) ? 'owner-rewrite' : 'owner', text } : null; };
  if (profile.doneGate.approve === 'none') return owner();
  const code = carriesCode(issue);
  if (g.selfApproved) return { cause: 'approve', text: `${issue.id}'s live approve is by a worker of this issue or its branch — a self-approve does not count as review: ${jarlLine('review', issue.id, '<verdict>', '--by', '<a-fresh-reviewer>', '--model', '<model-id>', '<text>')}${code ? '' : ' (or jarl, on an issue that carries no code)'}` };
  // A changes verdict with no approve after it is named as the cause, with its reviewer and day, so whoever is refused
  // sees the review that stands in the way.
  if (!g.approved && (g.lastReview === 'changes' || g.standingChanges)) {
    const changes = g.standingChanges || [...g.trail].reverse().find((r) => r.verdict === 'changes');
    if (g.lastReview !== 'changes') return { cause: 'approve-standing', text: `${issue.id}'s changes verdict by ${changes.by || 'a reviewer not recorded'} of ${changes.at} stands until a round or a new commit — an approve recorded after it does not clear the issue: ${jarlLine('round', issue.id, '<what-failed>')}` };
    return { cause: 'approve', text: `${issue.id}'s latest review is a changes verdict by ${changes.by || 'a reviewer not recorded'} of ${changes.at}, and no approve came after it — a fresh reviewer reads the issue and the diff first: ${jarlLine('review', issue.id, '<verdict>', '--by', '<reviewer>', '--model', '<model-id>', '<text>')}` };
  }
  if (!g.approved) return { cause: 'approve', text: `${issue.id} has no approving review newer than its last round${g.tracked ? ' or reopen' : ''}${g.anchor && g.anchor.what === 'whole' ? `, nor one since ${sinceText(g.anchor)}` : ''} — a fresh reviewer reads the issue and the diff first: ${jarlLine('review', issue.id, '<verdict>', '--by', '<reviewer>', '--model', '<model-id>', '<text>')}` };
  // Approves that stand and do not clear it: a bot's the done gate does not name, or short of the loop's own definition.
  const uncleared = unclearedText(loop, issue, g);
  if (uncleared) return g.uncleared.cause === 'bot'
    ? { cause: 'approve', text: `${uncleared} — an approve that clears it is next: ${jarlLine('review', issue.id, '<verdict>', '--by', '<a-fresh-reviewer>', '--model', '<model-id>', '<text>')}` }
    : { cause: 'clears', text: `${uncleared} — an approve that clears it is next: ${jarlLine('review', issue.id, '<verdict>', '--by', '<reviewer>', '--model', '<model-id>', '<text>')}` };
  if (code && !g.fresh) return { cause: 'approve', text: `${issue.id} ${freshRuleText(issue, g.live, g.uncleared?.standing)}: ${jarlLine('review', issue.id, '<verdict>', '--by', '<a-fresh-reviewer>', '--model', '<model-id>', '<text>')}` };
  // The model of the approve, where the profile's reviewer rule makes it a gate; under the default it is advice only.
  const byModel = modelRefusalOf(root, loop, issue, { gate: g });
  if (byModel) return { cause: 'model', text: `${byModel}: ${modelReviewForm(issue.id)}` };
  // A code issue is merged before it is done, the order the approve's reply names and the rule status flags a closed
  // issue by; a profile that requires a landed merge has checked more than this above.
  const unmerged = unmergedRefusal(issue, g);
  if (unmerged) return { cause: 'merge', text: unmerged };
  // An issue worked in place has no merge: it closes on the commit of its files, which a row of its proof names.
  const uncommitted = inPlaceRefusal(root, loop, issue, g);
  if (uncommitted) return uncommitted;
  // Last, an acceptance line only the owner ticks: his look comes on top of the proof and the review, never instead.
  return owner();
}

// Why an issue worked in place may not close yet, as { cause, text }, or null. Each file it declares is placed in its
// repository as fileAt places it (the loop's own, or the one its Repo names for that path), read from the top of that repository and compared, whole, with the
// paths git names there (see repositoryPaths). The issue closes when every such repository is a
// git repository here, none of its declared files has a change its checkout has not committed (staged, unstaged or
// untracked), and a row of its proof inside the gate's window names a commit that a repository holds on the branch it
// has checked out, that changes a declared file of that repository, and that was committed at or after the minute of the
// move the window starts at (the lease, a reopen or a red round): a commit made before the work began commits none of it.
// The files are committed in the checkout of their repository once the approve stands (by the merger where one runs,
// else the coordinator), and that commit is recorded as a row; nothing is merged.
function inPlaceRefusal(root, loop, issue, g) {
  if (!worksInPlace(issue)) return null;
  const rows = evidenceTable(issue.sections.evidence).rows;
  const logged = alignRows(issue.id, rows, g.rowLog);
  const counted = rows.filter((r, k) => !r.retracted && r.saw !== '' && (!g.tracked || (logged[k] && logged[k].inWindow && !logged[k].retracted)));
  const shas = [...new Set(counted.flatMap((r) => `${r.ran} ${r.saw}`.match(/\b[0-9a-f]{7,40}\b/g) || []))];
  // The declared files by the top of the repository they are in, each as the paths git names there. Git is asked without
  // the variables a hook sets, which would point it at the repository the hook runs for.
  const byTop = new Map();
  for (const f of issue.files) {
    const at = fileAt(root, issue, f);
    const found = gitHere(at.repo, ['rev-parse', '--show-toplevel']);
    if (found === null) return { cause: 'commit', text: `${issue.id} is worked in place, and ${f} is in ${repoLabel(at.repo)}, which is no git repository here, so the commit of its files cannot be checked — ${inPlaceStep(issue)}` };
    const top = canonical(found);
    const placed = repositoryPaths(top, at);
    if (placed.outside) return { cause: 'files', text: `${issue.id} is worked in place, and ${f} ${placed.outside} — an issue worked in place declares the files it writes inside their repository: ${jarlLine('field', issue.id, 'Files', '<paths>')}` };
    byTop.set(top, [...(byTop.get(top) || []), ...placed.paths]);
  }
  // A declared directory covers what is under it; a path is compared whole, so a file of the same name elsewhere is not it.
  const touches = (paths) => (f) => paths.some((d) => d === '' || f === d || f.startsWith(`${d}/`));
  const names = (top, args) => (gitHere(top, args) || '').split('\0').filter(Boolean);
  for (const [top, paths] of byTop) {
    const changed = [...names(top, ['diff', '--name-only', '-z', '--no-renames', 'HEAD']), ...names(top, ['ls-files', '--others', '--exclude-standard', '-z'])];
    const dirty = changed.filter(touches(paths));
    if (dirty.length) return { cause: 'commit', text: `${issue.id} is worked in place, and its checkout holds changes not committed to ${dirty.join(', ')} — ${inPlaceStep(issue)}` };
  }
  const from = g.tracked ? parseStamp(g.anchor.at) : null;
  const committed = (top, paths, sha) => gitHere(top, ['merge-base', '--is-ancestor', sha, 'HEAD']) !== null
    && (from === null || Number(gitHere(top, ['show', '-s', '--format=%ct', sha])) * 1000 >= from)
    && names(top, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', '--no-renames', sha]).some(touches(paths));
  if (shas.some((sha) => [...byTop].some(([top, paths]) => committed(top, paths, sha)))) return null;
  // A declared path that is not there at the top of its repository is a path to write again, not a commit to name.
  for (const [top, paths] of byTop) {
    const missing = paths.find((p) => p !== '' && !existsSync(join(top, p)));
    if (missing !== undefined) return { cause: 'files', text: `${issue.id} is worked in place, and ${missing} is not there: a declared path is read from the top of its repository, ${top}, not from the folder of the loop — ${jarlLine('field', issue.id, 'Files', '<paths>')}` };
  }
  return { cause: 'commit', text: `${issue.id} is worked in place, and no row of its proof${g.tracked ? ` since ${sinceText(g.anchor)}` : ''} names a commit made after it, on the branch checked out, that changes ${issue.files.join(', ')} — ${inPlaceStep(issue)}` };
}

// A declared file as the paths git names it by in its repository, whose top is `top`: the path read from the top of the
// repository (the one its Repo names, or the loop's own), the one base scope reads too, so a loop kept in a subdirectory
// declares its files as they are written from the top. A symbolic link on the way is followed, so the file an edit through
// it changes is checked, and the link's own path with it. { paths } or, for a path that leaves the repository as written
// or once a link is followed, { outside } with why.
function repositoryPaths(top, at) {
  const written = resolve(top, at.path);
  const inside = (p) => { const r = relative(top, p); return r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r) ? null : portablePath(r); };
  const own = inside(written);
  if (own === null) return { outside: 'lies outside its repository, so no commit of that repository changes it' };
  const target = inside(realPlace(written));
  if (target === null) return { outside: 'is a symbolic link to a place outside its repository, so no commit of that repository changes the file it points to' };
  return { paths: [...new Set([own, target])] };
}

// A path with every symbolic link on it followed, as far as it exists: a file not written yet, or deleted, keeps its name
// under the real place of its nearest directory that exists.
function realPlace(path) {
  const rest = [];
  for (let at = path; ; at = dirname(at)) {
    try { return join(realpathSync.native(at), ...rest); } catch { /* not there: its directory is read */ }
    if (dirname(at) === at) return path;
    rest.unshift(basename(at));
  }
}

const inPlaceStep = (issue) => `once the approve stands, its files are committed in the checkout of their repository (by the merger where one runs, else the coordinator), and the commit is recorded as a row: ${jarlLine('evidence', issue.id, '--ran', '<command>', '--saw', '<what-it-printed>', '--line', '<line-number>', '--by', '<who>')}`;

// Why a code issue's code as it is now is not merged (see unmergedCode), as done says it, or null.
function unmergedRefusal(issue, g) {
  const u = unmergedCode(issue, g);
  return u ? `${issue.id} carries code (its lease records Branch ${fieldText(issue.fields.branch)}) and ${unmergedText(u)} — a code issue is merged before it is done: the merger lands the branch and records it, ${jarlLine('merged', issue.id, '--sha', '<sha>', ...(u.why === 'repo' ? ['--repo', '<name-or-path>'] : []))}, then done` : null;
}

// The done gate's requires-merged: the issue records a merge (merged --sha) and that commit is in the base of the
// repository where the merge was recorded (Merged's "in <repo>", else the issue's Repo, else the loop's own repository):
// the base the merge note and the cleanup read too (see baseOf), or the branch a library caller names as opts.base (a
// caller that lands into a branch nobody has checked out, such as a team branch, names it). A sha the repository does
// not know, or one not reachable from the base, is refused: a merge recorded is not a merge landed until the base holds it.
// A merge that does not count for the code as it is now (see unmergedCode) is refused before its commit is looked for.
function mergeRefusal(root, issue, base, g) {
  const m = mergedOf(issue);
  const gate = 'this loop\'s profile closes an issue only on a landed merge (done-gate "requires-merged": true)';
  if (!m) return `${issue.id} records no merge — ${gate}: ${jarlLine('merged', issue.id, '--sha', '<sha>')} once it has landed`;
  const spent = unmergedRefusal(issue, g);
  if (spent) return spent;
  const repos = issueRepoPaths(root, issue, m.repo ? [m.repo] : undefined).filter(isGitRepo);
  if (!repos.length) return `${issue.id} records Merged ${m.sha}, but no repository it names is a git repository here — ${gate}, and the merge cannot be checked`;
  const refOf = (r) => (base === undefined ? baseOf(root, r) : base);
  if (base !== undefined && repos.every((r) => git(r, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]) === null)) return `${issue.id}: the base ${base} is not a branch or commit in ${repos.join(' or ')} — ${gate}, and the merge cannot be checked`;
  const landed = repos.some((r) => git(r, ['merge-base', '--is-ancestor', m.sha, refOf(r)]) !== null);
  if (landed) return null;
  const where = repos.map((r) => `${refOf(r)} in ${r}`).join(' or ');
  return `${issue.id} records Merged ${m.sha}, which is not in the base (${where}) — ${gate}; merge it, or record the sha that landed: ${jarlLine('merged', issue.id, '--sha', '<sha>')}`;
}

// The fresh-review rule, said the same way by done, review and merged: an issue that carries code (a Branch or a
// Merged field) needs its live approve from a fresh reviewer — an agent that neither wrote the code nor runs the loop.
// `standing` names every approve that stands and does not clear it (gateOf's uncleared), so one the live approve outranks,
// a bot's beside the coordinator's, is named too.
export function freshRuleText(issue, live, standing = []) {
  const who = live && live.by ? `${live.by} (${live.kind})` : 'a reviewer not recorded (an approve from before --by)';
  const others = standing.filter((s) => s !== who);
  const bot = others.some((s) => s.endsWith(' (bot)'));
  return `carries code (${issue.fields.merged ? 'Merged' : 'Branch'} is recorded) and its live approve is by ${who}${others.length ? `, and it holds the approve${others.length > 1 ? 's' : ''} of ${others.join(', ')} as well` : ''} — the fresh-review rule: a code issue needs an approve from a fresh reviewer, an agent that neither wrote the code nor runs the loop; a coordinator's approve does not clear it${bot ? ', and a bot\'s clears only where the loop\'s done gate names that bot' : ''}`;
}

// Said, never refused: done closes an issue that was merged while its CI is not green yet, but the output says so, so the
// gap is seen by whoever closed it.
export function doneNote(issue, root) {
  const notes = [];
  const m = mergedOf(issue);
  // A merge that carries its check (a passing check, or the red it landed on) needs no CI state to be told apart from an unrecorded one.
  const decided = () => { const line = issue.byHeader ? null : lastMerge(journalById(root).get(issue.id) || []); return Boolean(line && (line.check || line.red)); };
  if (m && m.ci !== 'green' && m.ci !== 'none' && !(m.ci === null && decided())) notes.push(`merged ${m.sha}, CI ${m.ci || 'not recorded'} — record it when known: ${jarlLine('merged', issue.id, '--ci', '<ci-state>')}`);
  return notes.length ? { note: notes.join('; ') } : {};
}

// The Proof rows an issue holds inside the done gate's window: the --ran/--saw rows the worker wrote, not retracted.
export function proofSince(g, issue) { return g.tracked ? g.rowsSince : evidenceRows(issue).length; }

export const EVIDENCE_HOW = (id) => lineRowForm(id);

// What a merge refused for want of its --sha says next: the head of the branch the issue's lease records, or, where no
// branch is recorded or it has no single head here, that there is none; the sha that landed is the caller's to give, so
// the command it names holds a placeholder for it and never the head.
export function noMergeHow(root, issue) {
  const branch = fieldText(issue.fields.branch);
  const tip = branchTip(root, issue);
  const give = `once it has landed, give the sha that landed: ${jarlLine('merged', issue.id, '--sha', '<sha>', '--ci', '<ci-state>')}`;
  if (tip && !tip.includes(',')) return `the head of ${branch}, the branch its lease records, is ${tip}; ${give}`;
  if (!branch) return `its lease records no branch, so no head is offered; ${give}`;
  return `${branch} has no single head in the repositories here, so no head is offered; ${give}`;
}
