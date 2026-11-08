// The merged command: a recorded merge, what it checks and the notes it adds.

import { CI_STATES, fieldText, hole, jarlLine, need, noSeparators, shellWord, splitList } from './base.mjs';
import { needNoOwnersWords } from './owner.mjs';
import { git } from './git.mjs';
import { canonical, jarlDir } from './where.mjs';
import { readText, writeAtomic } from './files.mjs';
import { DEFAULT_PROFILE, loadProfile } from './profile.mjs';
import { appendLogLines, goalLines, readGoal } from './journal.mjs';
import { mergeCheckText } from './log.mjs';
import { evidenceNotes, evidenceParts, evidenceTable, findIssue, mergedOf, removeFields, setField, unattributedRefusal } from './issues.mjs';
import { baseOf, commitRepoNames, isGitRepo, issueRepoPaths, issueRepoSlots, needRightCheckouts, repoFromInput, repoNames, repoLabel, tipLinesOf } from './repositories.mjs';
import { gateOf, sinceText, unclearedText } from './gate.mjs';
import { integrationBranch, sliceMerger } from './slices.mjs';
import { readLoop } from './loop.mjs';
import { carriesDeclared, declaredFor } from './metrics.mjs';
import { NOTE_LIMIT, addedContentNotes, addedNoteText } from './rounds.mjs';
import { lineRowForm, lineStates, unprovedMechanical } from './lines.mjs';
import { issuesFor, nothingWritten, reasonWord, refiled } from './shared.mjs';
import { freshRuleText, noMergeHow, proofSince } from './done-gate.mjs';
import { cleanUpAfterMerge } from './cleanup.mjs';

// merged <ids> --sha <sha> [--ran "<command>" --saw "<what-it-printed>" | --red <id>] [--ci pending|green|red|none] [--repo <path>]
// — the merge as a field, not as prose: the sha, where it landed, the check that decided it and the CI state. --ran and
// --saw record the check and what it printed in the merge record (the merge line and the Merge check field) of every issue
// of the call; they write no Proof row, because the merger's check is not the worker's proof; --red <id> records
// a merge that landed while its check was red for a cause outside the branch, which issue <id> tracks, and is never counted
// as a passing check. The CI state is recorded only when given, except for a library call, which keeps pending as the
// default. --ci alone, on issues that already record a merge, moves only the CI state. A sha the repository does not know
// is noted, never refused (the merge may be in a clone not fetched here). It records; it never decides whether anything
// may land.
export function cmdMerged(root, rawIds, flags) {
  needNoOwnersWords('the merge', flags);
  const cli = flags.caller === 'cli';
  need(flags.sha !== undefined || flags.ci !== undefined, `merged needs --sha <sha> (and optionally --ci), or --ci alone on issues that already record a merge`, () => ({ flag: '--sha', value: '<sha>' }));
  if (flags.sha !== undefined) need(/^[0-9a-f]{4,64}$/i.test(String(flags.sha)), `--sha is a commit id, 4 to 64 hex characters (got "${flags.sha}")`, () => ({ flag: '--sha', value: hole('<sha>') }));
  if (flags.ci !== undefined) need(CI_STATES.includes(flags.ci), `--ci must be one of: ${CI_STATES.join(', ')} (got "${flags.ci}") — none means the repository has no CI to wait for`, () => ({ flag: '--ci', value: hole('<ci-state>') }));
  need(flags.repo === undefined || flags.sha !== undefined, '--repo names where --sha landed; give it with --sha', () => ({ flag: '--sha', value: '<sha>' }));
  const rows = flags.ran !== undefined || flags.saw !== undefined ? rowsOf(flags) : null;
  need(!rows || flags.sha !== undefined, '--ran and --saw record the check that decided the merge; give them with --sha', () => ({ flag: '--sha', value: '<sha>' }));
  need(flags.red === undefined || flags.sha !== undefined, '--red names the issue that tracks why the merge landed on a red check; give it with --sha', () => ({ flag: '--sha', value: '<sha>' }));
  need(!(rows && flags.red !== undefined), 'a merge landed on red carries no passing check: give --ran/--saw for a green check, or --red <id> for a red one, not both', () => ({ rename: '--red', to: '<no-flag-here>' }));
  const issues = issuesFor(root, rawIds);
  const nothing = issues.length > 1 ? ' — nothing was written' : '';
  for (const issue of issues) { const refusal = unattributedRefusal(issue, 'merged'); need(!refusal, nothing ? nothingWritten(refusal) : refusal, refiled); }
  let cause = null;
  if (flags.red !== undefined) {
    need(typeof flags.red === 'string' && fieldText(flags.red), '--red needs the id of the issue that tracks the cause', () => ({ flag: '--red', value: '<id>' }));
    const tracked = findIssue(root, fieldText(flags.red));
    need(tracked, `--red names an issue that does not exist: ${flags.red}${nothing} — file the cause first`, () => [{ first: ['jarl.mjs', 'new', '<what-is-red>', '--tier', hole('<tier>')] }, { flag: '--red', value: '<the-id-new-prints>' }]);
    need(!issues.some((i) => i.id === tracked.id), `--red names the issue that tracks the cause of a red check outside the branch; ${tracked.id} is the issue being merged${nothing}`, () => ({ flag: '--red', value: '<another-issue>' }));
    cause = tracked.id;
  }
  if (flags.sha === undefined) for (const issue of issues) need(mergedOf(issue), `${issue.id} records no merge yet — ${noMergeHow(root, issue)}${nothing}`, () => ({ flag: '--sha', value: '<sha>' }));
  const pickedRepo = flags.repo !== undefined ? repoFromInput(root, String(flags.repo)) : null;
  const repoPath = pickedRepo ? pickedRepo.main : null;
  const repoIn = pickedRepo ? ` in ${noSeparators(pickedRepo.value)}` : '';
  if (flags.sha !== undefined) needRightCheckouts(root, pickedRepo ? [pickedRepo.name].filter(Boolean) : issues.flatMap((i) => splitList(i.fields.repo)));
  const sha = flags.sha !== undefined ? String(flags.sha).toLowerCase() : null;
  const ci = flags.ci ?? (sha && !cli ? 'pending' : undefined);
  // The check as the merge line names it: the commands that ran, one line, never the log's own separator.
  const oneLineOf = (key) => noSeparators(fieldText(rows.map((r) => r[key]).join(' ; '))).slice(0, 200).trim();
  const checkText = rows ? oneLineOf('ran') : null;
  const sawText = rows ? oneLineOf('saw') : null;
  const notes = pickedRepo && pickedRepo.note ? [pickedRepo.note] : [];
  if (sha) {
    // Where the sha should be: --repo, else each issue's Repo, else the loop's own repository.
    // An issue naming several repositories is noted only when the sha is in none of them.
    const checked = new Set();
    for (const issue of issues) {
      const repos = (repoPath ? [repoPath] : issueRepoPaths(root, issue)).filter(isGitRepo);
      const key = repos.join('\n');
      if (!repos.length || checked.has(key)) continue;
      checked.add(key);
      if (repos.every((r) => git(r, ['cat-file', '-e', `${sha}^{commit}`]) === null)) notes.push(`${sha} is not a commit in ${repos.join(' or ')} (yet) — recorded as given`);
    }
  }
  // Said, never refused: the check of a merge runs on the merge result, so a commit that lacks the branch tip, or lacks
  // the base as it stands before the merge landed there, was not the tree the check ran on.
  if (sha) for (const issue of issues) notes.push(...mergeContentNotes(root, issue, sha, repoPath));
  if (sha) notes.push(...mergedAddedNotes(root, issues, sha, repoPath));
  // Said, never refused: a merge is a fact, and recording it is not the place to stop it. A merge whose issue holds
  // no fresh approve went in without the fresh review the rule asks for, and the note says so loudly.
  // Under a done gate with no approve (approve: none), the merge gate stands behind the issue, and no reviewer is owed.
  if (sha && cli) {
    const loop = readLoop(jarlDir(root));
    for (const issue of issues) {
      const g = gateOf(loop, issue.id);
      if (proofSince(g, issue) === 0 && unprovedMechanical(lineStates(loop, issue, g)).length) notes.push(`NO PROOF FROM THE WORKER — ${issue.id} holds no Proof row since ${g.tracked ? sinceText(g.anchor) : 'it was filed'}; ${checkText ? 'the merge check is recorded in the merge record and is not proof' : 'the merge records no check, and a merge is not proof'}, so done refuses until the worker records it: ${lineRowForm(issue.id)}`);
    }
  }
  // Said, never refused: a --ran that matches no declared check is recorded as given, and the banner reads it as no check
  // landed; the declared commands are named here, where whoever typed it can still see the mismatch.
  if (sha && checkText) {
    const loop = readLoop(jarlDir(root));
    for (const issue of issues) {
      const declared = [...new Set(repoNames(root, issue).flatMap((n) => declaredFor(loop, n)))];
      if (declared.length && !carriesDeclared({ check: checkText }, declared)) notes.push(`${issue.id}'s merge check "${checkText}" matches no declared check, so this merge does not count as landing on it; the declared ones: ${declared.join(' ; ')}`);
    }
  }
  if (sha && loadProfile(root).doneGate.approve !== 'none') {
    const loop = readLoop(jarlDir(root));
    for (const issue of issues) {
      const g = gateOf(loop, issue.id);
      const uncleared = g.fresh ? null : unclearedText(loop, issue, g);
      if (uncleared) notes.push(`MERGED WITHOUT AN APPROVE THAT CLEARS IT — ${uncleared}; recorded as given, get that approve now: ${jarlLine('review', issue.id, '<verdict>', '--by', '<reviewer>', '--model', '<model-id>', '<text>')}`);
      else if (!g.fresh) notes.push(`MERGED WITHOUT A FRESH REVIEW — ${issue.id} ${g.live ? freshRuleText({ fields: { merged: sha } }, g.live, g.uncleared?.standing) : 'holds no live approve at all (none, or spent by a later round, restart or reopen) — the fresh-review rule: a code issue needs an approve from a fresh reviewer before it merges'}; recorded as given, get the fresh review now: ${jarlLine('review', issue.id, '<verdict>', '--by', '<a-fresh-reviewer>', '--model', '<model-id>', '<text>')}`);
      notes.push(...approveTipNotes(root, issue, g.live, sha));
    }
  }
  // The check goes into the merge record (the merge line and the Merge check field) and never into Proof: the merger's
  // check is not the worker's proof, so only evidence writes a row.
  const named = `${repoIn}${checkText ? ` · check ${checkText}${sawText ? ` · saw ${sawText}` : ''}` : ''}${cause ? ` · landed red, cause ${cause}` : ''}${ci ? ` · CI ${ci}` : ''}`;
  // The line goes first, as in set: a write that stops between the two leaves the record ahead of the files.
  if (pickedRepo) commitRepoNames(root, [pickedRepo]);
  // A merge line is followed by the tip of the branch that was merged: the cleanup may delete the branch, and the gate
  // then reads the tip from here.
  const tips = sha ? tipLinesOf(root, issues) : () => [];
  appendLogLines(root, issues.flatMap((issue) => (sha ? [`${issue.id} merged ${sha}${named}`, ...tips(issue)] : [`${issue.id} CI ${ci}`])));
  for (const issue of issues) {
    let text = readText(issue.file);
    if (sha) {
      text = setField(text, 'Merged', `${sha}${repoIn}`);
      const kept = mergeCheckText(checkText, sawText);
      text = kept ? setField(text, 'Merge check', kept) : removeFields(text, ['Merge check']);
    }
    text = ci ? setField(text, 'CI', ci) : removeFields(text, ['CI']);
    writeAtomic(issue.file, text);
  }
  // The cleanup comes last, after the merge is on the record, and only on the command line and in the tools.
  const cleanup = sha && cli && flags.keep !== true ? cleanUpAfterMerge(root, issues, sha, repoPath, pickedRepo && pickedRepo.name ? [pickedRepo.name] : []) : [];
  return { ids: issues.map((i) => i.id), sha: sha || null, ci: ci ?? null, ...(checkText ? { check: checkText } : {}), ...(cause ? { red: cause } : {}), ...(cleanup.length ? { cleanup } : {}), notes };
}

// What a recorded merge commit holds of the branch and of its base, as notes (empty when it holds both, or when the
// branch, the base or the commit is not here to be read). The branch tip is the branch as it stands now. The base is the
// repository's declared base when the checkout stands for a declared name and the branch exists there, else the branch the
// checkout has open; it is asked for only while the commit is not yet in it: once the base holds the commit, later commits
// on the base are no part of the merge. A commit that lacks the tip but holds every file the branch changed exactly as the
// branch has it is a squash or a rebase merge: it carries the branch's work without its commits, and is named so.
function mergeContentNotes(root, issue, sha, repoPath) {
  const branch = fieldText(issue.fields.branch);
  const repo = (repoPath ? [repoPath] : issueRepoPaths(root, issue)).filter(isGitRepo).find((r) => git(r, ['cat-file', '-e', `${sha}^{commit}`]) !== null);
  if (!repo) return [];
  const holds = (ancestor, ref) => git(repo, ['merge-base', '--is-ancestor', ancestor, ref]) !== null;
  const notes = [];
  const tip = branch ? git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`]) : null;
  const record = jarlLine('merged', issue.id, '--sha', '<sha>');
  if (tip && !holds(tip, sha)) {
    if (holdsChangesOf(repo, tip, sha)) notes.push(`SQUASH OR REBASE MERGE — ${sha} does not contain the commits of ${branch} (tip ${tip.slice(0, 12)}), but holds every file the branch changed exactly as the branch has it, so the branch's work landed without its commits, and the cleanup keeps ${branch} because its tip is in no merge`);
    else notes.push(`MERGE WITHOUT THE BRANCH — ${sha} does not contain the tip of ${branch} (${tip.slice(0, 12)}) and does not hold the files the branch changed as the branch has them, so a check that ran on it did not run on the branch's work; the check runs on the merge result: merge the branch, check the result, and record that commit with ${record}`);
  }
  // A slice with a merger of its own lands on its integration branch, which is the base this merge is read against, unless
  // the commit already stands on the feature branch: that merge is the feature branch's, whatever the integration branch holds.
  const merger = sliceMerger(goalLines(readGoal(jarlDir(root))), issue);
  const integration = merger ? integrationBranch(merger.slice) : null;
  const feature = baseOf(root, repo);
  const intoSlice = integration && git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${integration}^{commit}`]) !== null && !holds(sha, feature);
  const base = intoSlice ? integration : feature;
  const baseTip = base !== branch ? git(repo, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]) : null;
  if (baseTip && !holds(sha, baseTip) && !holds(baseTip, sha)) notes.push(`MERGE WITHOUT THE BASE — ${sha} does not contain ${base} as it stands (${baseTip.slice(0, 12)}), so the check ran on a tree the base has moved past; the check runs on the merge result: merge the base into the result, check it again, and record that commit with ${record}`);
  return notes;
}

// What the recorded commit brings into its first parent, as notes: each added line that starts a conflict marker and each
// added file over the size Jarl accepts as an attachment (see addedContentNotes), up to NOTE_LIMIT with the rest counted.
// A commit is read once per repository however many issues share it; a commit that is not here, or has no parent, says nothing.
function mergedAddedNotes(root, issues, sha, repoPath) {
  const found = new Set();
  const all = [];
  for (const issue of issues) {
    const repo = (repoPath ? [repoPath] : issueRepoPaths(root, issue)).filter(isGitRepo).find((r) => git(r, ['cat-file', '-e', `${sha}^{commit}`]) !== null);
    if (!repo || found.has(canonical(repo))) continue;
    found.add(canonical(repo));
    if (git(repo, ['rev-parse', '--verify', '--quiet', `${sha}^1`]) === null) continue;
    all.push(...addedContentNotes(repo, `${sha}^1..${sha}`));
  }
  const shown = all.slice(0, NOTE_LIMIT).map((n) => `${addedNoteText(n)} (brought in by the merge)`);
  return all.length > NOTE_LIMIT ? [...shown, `… and ${all.length - NOTE_LIMIT} more notes about what the merge brought in not shown`] : shown;
}

// Whether `sha` holds what `tip` changed on its way from the commit they share: every file the branch changed is, in `sha`,
// exactly as the branch has it (a deletion included), and the branch changed at least one. A squash or a rebase merge
// does; a commit made without the branch's work does not.
function holdsChangesOf(repo, tip, sha) {
  const mb = git(repo, ['merge-base', tip, sha]);
  if (!mb) return false;
  const changed = (git(repo, ['diff', '--name-only', '--no-renames', '-z', mb, tip]) || '').split('\0').filter(Boolean);
  if (!changed.length) return false;
  // The paths ride the command line, so they go in groups that stay under the shortest limit a platform has.
  for (let at = 0; at < changed.length;) {
    let size = 0;
    const group = [];
    while (at < changed.length && (!group.length || size + changed[at].length < 8000)) { size += changed[at].length + 1; group.push(changed[at]); at += 1; }
    const differ = git(repo, ['--literal-pathspecs', 'diff', '--name-only', '-z', tip, sha, '--', ...group]);
    if (differ === null || differ !== '') return false;
  }
  return true;
}

// What a merge says when the approve the gate stands on was recorded on another tip of the branch than the one at this
// merge: the commits between the two landed without that review. A commit does not spend an approve inside the gate's
// window, so this note is where it shows. The approve's tip is the tip line written after it, one sha per repository of
// the issue, in the order branchTip gives. The branch's tip now is read in each repository on its own, so a repository
// whose branch is gone (deleted by the cleanup of its own earlier merge, or before the merge is recorded) is left out and
// the others are still compared; an approve with no tip line is not compared. What landed is read along the branch's first parents: the newest of its
// commits after the approved tip that the recorded commit holds. A recorded commit that holds the approved tip and none
// of those is the reviewed one and is left out (the note on a merge without the branch names the rest); one that holds
// the approved tip only through a merge of the base into the branch is no exception, since that merge is a commit of the
// branch. A recorded commit that does not hold the approved tip (a squash) is taken to hold the branch as it stands. A
// repository the recorded commit is not in is said to be not in this merge, or, when it is in none of them, not found
// here: nothing is said to have landed there. The commands the note gives list the branch's commits along its first
// parents, merges of the base included, and the whole difference, so code a conflict fix added is seen.
function approveTipNotes(root, issue, live, sha) {
  if (!live || !live.tip) return [];
  const branch = fieldText(issue.fields.branch);
  if (!branch) return [];
  const short = (s) => s.slice(0, 12);
  const was = live.tip.split(',');
  // The approve's tips are one for each repository the issue names. A repository that is not on this machine keeps its place
  // among them and is not compared, so the others still are and a tip that did not move is not said to have moved; tips that
  // count another number of repositories than the issue names are compared against the ones that are here.
  const slots = issueRepoSlots(root, issue);
  const repos = was.length === slots.length ? slots : slots.filter(Boolean);
  const is = repos.map((dir) => (dir && isGitRepo(dir) ? git(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`]) : null));
  const unmoved = was.length === repos.length && repos.every((dir, k) => !dir || is[k] === was[k]);
  if (!is.some(Boolean) || unmoved) return [];
  const see = (dir, a, b) => `git -C ${shellWord(dir)} log --oneline --first-parent ${short(a)}..${short(b)} and git -C ${shellWord(dir)} diff ${short(a)} ${short(b)}`;
  const lines = (dir, args) => (git(dir, args) || '').split('\n').filter(Boolean);
  // The newest commit of the branch after the approved tip that the recorded commit holds; null when it holds none of
  // them and holds the approved tip (the reviewed commit landed), the branch's tip when it does not hold the approved tip.
  const landedUpTo = (dir, a, b) => {
    const held = new Set(lines(dir, ['rev-list', sha, `^${a}`]));
    const top = lines(dir, ['rev-list', '--first-parent', `${a}..${b}`]).find((c) => held.has(c));
    if (top) return top;
    return git(dir, ['merge-base', '--is-ancestor', a, sha]) !== null ? null : b;
  };
  const who = live.by ? `by ${live.by} (${live.kind})` : 'by a reviewer not recorded';
  const again = `if it was meant to land, record a review of the tip that landed: ${jarlLine('review', issue.id, '<verdict>', '--by', '<a-fresh-reviewer>', '--model', '<model-id>', '<text>')}`;
  const head = `APPROVED ON ANOTHER TIP — ${issue.id}'s approve ${who} was recorded on ${branch}`;
  if (was.length !== repos.length) return [`${head} at ${was.map(short).join(', ')}, and the branch stands at ${is.map((s) => (s ? short(s) : 'gone')).join(', ')} at this merge, so that review did not see what changed between them; recorded as given, ${again}`];
  const here = repos.map((dir) => Boolean(dir) && isGitRepo(dir) && git(dir, ['cat-file', '-e', `${sha}^{commit}`]) !== null);
  const away = here.some(Boolean) ? 'not in this merge' : 'not found here';
  const moved = [];
  repos.forEach((dir, k) => {
    const [a, b] = [was[k], is[k]];
    if (!b || a === b) return;
    if (!here[k]) { moved.push({ dir, a, b, away }); return; }
    const to = landedUpTo(dir, a, b);
    if (to) moved.push({ dir, a, b, to });
  });
  if (!moved.length) return [];
  if (repos.filter(Boolean).length === 1) {
    const [m] = moved;
    if (m.away) return [`${head} at ${short(m.a)}, and the branch stands at ${short(m.b)}; ${short(sha)} is not found here, so what it holds cannot be read; see what changed: ${see(m.dir, m.a, m.b)}; ${again}`];
    const upTo = m.to === m.b ? `the branch stands at ${short(m.b)} at this merge, so what changed between them` : `this merge holds the branch up to ${short(m.to)} (it stands at ${short(m.b)} now), so what changed from ${short(m.a)} to ${short(m.to)}`;
    return [`${head} at ${short(m.a)}, and ${upTo} landed without that review; recorded as given, see it: ${see(m.dir, m.a, m.to)}; ${again}`];
  }
  const entry = (m) => (m.away ? `in ${repoLabel(m.dir)} ${short(m.a)} → ${short(m.b)}, ${m.away}, see it: ${see(m.dir, m.a, m.b)}` : `in ${repoLabel(m.dir)} ${short(m.a)} → ${short(m.to)}, which this merge holds without that review${m.to === m.b ? '' : ` (the branch stands at ${short(m.b)})`}, see it: ${see(m.dir, m.a, m.to)}`);
  return [`${head}, and the branch has moved since in ${moved.length === 1 ? 'one repository' : `${moved.length} repositories`}; recorded as given — ${moved.map(entry).join('; ')}; ${again}`];
}

// What counts as evidence of the work for done: not a ruling written in by decide or answer, and not the
// reason of an earlier move into a needs-reason status (a drop or a deferral).
export function workEvidence(issue, profile = DEFAULT_PROFILE) {
  // Status names are lower-case letters, digits and dashes: nothing in them is read as a pattern.
  const skip = new RegExp(`^\\s*(Ruling\\b${profile.with('needs-reason').map((st) => `|${reasonWord(st)}:`).join('')})`);
  const section = issue.sections.evidence || '';
  let lines = section.split('\n');
  // A note taken back counts for nothing: its lines are left out before anything is read.
  const taken = new Set();
  for (const note of evidenceNotes(section).notes.filter((x) => x.retracted)) for (let i = note.start; i <= note.end; i += 1) taken.add(i);
  // In a section written in parts, the work's evidence is its Proof: the lines of Proof and every row line (a row written
  // by a writer that does not know the parts may sit under Notes). A note alone is not evidence of the work.
  const { proofAt, notesAt } = evidenceParts(lines);
  if (proofAt !== -1 || notesAt !== -1) {
    const proofEnd = notesAt > proofAt ? notesAt : lines.length;
    const inRow = new Set();
    for (const r of evidenceTable(section).rows) for (let i = r.start; i <= r.end; i += 1) inRow.add(i);
    lines = lines.filter((l, i) => inRow.has(i) || (proofAt !== -1 && i > proofAt && i < proofEnd));
  } else lines = lines.filter((l, i) => !taken.has(i));
  return lines.filter((l) => !skip.test(l)).join('\n').trim();
}

// evidence <id> "<text>" appends free text (a merge sha, a one-line note); evidence <id> --ran
// "<command>" --saw "<what-it-printed>" appends one checkable row per pair instead — repeat the pair,
// in one call or across calls, one row per acceptance line. Both append to the same section, never
// replace it: the merger's free-text note lands after the worker's rows. `set done` needs the section
// non-empty, rows or not (not every issue's proof is a command).
//
// evidence <id> --retract <n> --by <who> "<text>" retracts the n-th row (numbered over the whole Evidence section, as
// show prints it) by an appended entry: the row stays, struck through, the entry names who retracted it and why, and
// the done gate stops counting it. It only tightens: a row is taken away, never added or revived.
// The --ran/--saw rows of a call, checked: each --ran has its --saw, each with a value.
export function rowsOf(flags) {
  const rans = [].concat(flags.ran ?? []);
  const saws = [].concat(flags.saw ?? []);
  need(rans.length && saws.length && [...rans, ...saws].every((v) => typeof v === 'string' && v.trim()), 'a row needs both --ran "<command>" and --saw "<what-it-printed>", each with a value', () => (!rans.length || rans.some((v) => typeof v !== 'string' || !v.trim()) ? { flag: '--ran', value: '<command>' } : { flag: '--saw', value: '<what-it-printed>' }));
  // The flag given fewer times is given once more, after the ones the call holds.
  need(rans.length === saws.length, `--ran and --saw must repeat the same number of times (got ${rans.length} --ran, ${saws.length} --saw)`, () => (rans.length > saws.length ? { flag: '--saw', value: '<what-it-printed>', add: true } : { flag: '--ran', value: '<command>', add: true }));
  return rans.map((ran, i) => ({ ran, saw: saws[i] }));
}
