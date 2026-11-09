// The cleanup a recorded merge makes redundant.

import { existsSync } from 'node:fs';
import { relative, isAbsolute } from 'node:path';
import { fieldText, printCommand, splitList } from './base.mjs';
import { git, gitRun } from './git.mjs';
import { canonical } from './where.mjs';
import { loadProfile } from './profile.mjs';
import { loadIssues } from './issues.mjs';
import { baseOf, isGitRepo, issueRepos, mainCheckoutOf, repoLabel, whyNotDeletable, worktreeState, worktreesOf } from './repositories.mjs';
import { sameDir } from './shared.mjs';

// ---- the cleanup a recorded merge makes redundant -------------------------------------------------------------------
//
// Right after merged records a sha, the issue's worktree and its local branch are redundant. Jarl removes them when that is
// safe and keeps everything, naming the condition, when it is not. It is the only place Jarl changes git, and only after a
// recorded merge: `git worktree remove` and `git branch -d`, never a force, never a file removed by any other means, nothing
// pushed and no remote branch touched. It runs for the command line and the tools (--keep skips it), never for a library call.
// The branch is kept unless every condition holds: it is not the base, a release branch or a trunk name; its tip is in the
// base or in the recorded merge; no other unfinished issue holds a lease on it (a package); its worktree, when it has one,
// is on this machine, is the one the lease names, is not the main checkout nor the one the loop or this command lives in,
// and holds nothing uncommitted and nothing untracked; and git itself accepts the removal and the delete.
const TRUNK_NAME = /^(?:HEAD|main|master|trunk|develop|release\/.+)$/;

// The one wording for a worktree git lists whose directory is not there. Git marks such a worktree prunable or not
// depending on how the directory went missing, and the lookup reads that as gone or as invisible; both are the same fact here.
const missingWorktreeReason = () => 'git lists its worktree but its directory is missing here';

const insideDir = (dir, path) => { const r = relative(canonical(dir), canonical(path)); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

export function cleanUpAfterMerge(root, issues, sha, repoPath, named = []) {
  const profile = loadProfile(root);
  const everyone = loadIssues(root);
  const called = new Set(issues.map((i) => i.id));
  const groups = new Map();
  for (const issue of issues) {
    const branch = fieldText(issue.fields.branch);
    if (!branch) continue;
    for (const repo of repoPath ? [canonical(repoPath)] : issueRepos(root, issue)) {
      const key = `${repo}\n${branch}`;
      if (!groups.has(key)) groups.set(key, { repo, branch, on: [] });
      groups.get(key).on.push(issue);
    }
  }
  const results = [];
  for (const { repo, branch, on } of groups.values()) {
    if (!isGitRepo(repo) || git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]) === null) continue;
    const base = baseOf(root, repo);
    const result = { repo: repoLabel(repo), branch };
    const keep = (reason, extra = {}) => results.push({ ...result, ...extra, kept: reason });
    const unsafe = whyNotDeletable(root, repo, [...on.flatMap((i) => splitList(i.fields.repo)), ...named]);
    if (unsafe) { keep(unsafe); continue; }
    if (TRUNK_NAME.test(branch) || branch === base) { keep('it is the base or a release branch'); continue; }
    const others = everyone.filter((i) => !called.has(i.id) && fieldText(i.fields.branch) === branch && profile.unfinished(i.status) && issueRepos(root, i).includes(repo)).map((i) => i.id);
    if (others.length) { keep(`${others.join(', ')} still hold${others.length === 1 ? 's' : ''} a lease on it`); continue; }
    if (git(repo, ['merge-base', '--is-ancestor', branch, base]) === null && git(repo, ['merge-base', '--is-ancestor', branch, sha]) === null) { keep(`its tip is neither in ${base} nor in the merge ${sha}`); continue; }
    const stored = on.map((i) => i.fields.worktree).find(Boolean);
    // Only the worktree git lists on exactly this branch is Jarl's to remove; the path the lease names is looked at to say
    // what it is when it is not that one, and is never removed.
    const ws = worktreeState(repo, branch, undefined);
    if (ws.state === 'none' && stored) {
      const listed = (worktreesOf(repo) || []).find((w) => sameDir(w.path, stored));
      keep(!listed ? `the path the lease names (${stored}) is not a worktree git lists` : listed.branch ? `the path the lease names (${stored}) is a worktree on ${listed.branch}, not on this branch` : `the path the lease names (${stored}) is a detached worktree`);
      continue;
    }
    let removed = null;
    if (ws.state === 'elsewhere') { keep('its worktree is not on this machine'); continue; }
    if (ws.state === 'gone' || ws.state === 'invisible') { keep(missingWorktreeReason()); continue; }
    if (ws.state === 'here') {
      const main = mainCheckoutOf(repo);
      if (main && main.main && canonical(ws.path) === main.main) { keep('it is checked out in the main checkout'); continue; }
      if (stored && existsSync(stored) && canonical(stored) !== canonical(ws.path)) { keep('it is checked out in another worktree than the one the lease names'); continue; }
      if (insideDir(ws.path, root) || insideDir(ws.path, process.cwd())) { keep('the loop or this command lives in its worktree'); continue; }
      // Asked explicitly, whatever git configuration on this machine hides (status.showUntrackedFiles, ignore settings).
      const status = git(ws.path, ['-c', 'status.showUntrackedFiles=all', 'status', '--porcelain', '--untracked-files=all', '--ignored']);
      if (status === null) { keep('the state of its worktree cannot be read'); continue; }
      const lines = status.split('\n').filter(Boolean);
      const changed = lines.filter((l) => !l.startsWith('!!'));
      if (changed.length) { keep(`its worktree holds ${changed.length} uncommitted or untracked file(s)`); continue; }
      // A second, independent look, so that no single mechanism that hides a change from `status` slips through: files an
      // index flag hides (assume-unchanged shows as a lowercase tag in ls-files -v, skip-worktree as S), the working files
      // against HEAD, and the untracked files not ignored.
      const flagged = (git(ws.path, ['-c', 'core.fsmonitor=false', 'ls-files', '-v']) || '').split('\n').filter((l) => l && (/^[a-z]/.test(l) || l.startsWith('S ')));
      if (flagged.length) { keep(`its worktree hides changes from git status behind assume-unchanged or skip-worktree marks: ${flagged.slice(0, 5).map((l) => l.slice(2)).join(', ')}${flagged.length > 5 ? `, and ${flagged.length - 5} more` : ''}`); continue; }
      if (!gitRun(ws.path, ['diff', '--quiet', 'HEAD', '--']).ok) { keep('its worktree differs from its HEAD'); continue; }
      const others = git(ws.path, ['ls-files', '--others', '--exclude-standard']);
      if (others === null || others !== '') { keep('its worktree holds untracked files'); continue; }
      // git deletes ignored files together with a worktree, so a worktree that holds any is left for a person to look at.
      const ignored = lines.map((l) => l.slice(3));
      if (ignored.length) {
        keep(`its worktree holds ignored files: ${ignored.slice(0, 5).join(', ')}${ignored.length > 5 ? `, and ${ignored.length - 5} more` : ''}`, { commands: [printCommand(['git', '-C', repo, 'worktree', 'remove', '--force', ws.path], { globals: [] }), printCommand(['git', '-C', repo, 'branch', '-d', branch], { globals: [] })] });
        continue;
      }
      const gone = gitRun(repo, ['worktree', 'remove', ws.path]);
      if (!gone.ok) { keep(`git worktree remove refused: ${gone.err}`); continue; }
      removed = ws.path;
    }
    const dropped = gitRun(repo, ['branch', '-d', branch]);
    if (!dropped.ok) { keep(`git branch -d refused: ${dropped.err}`, removed ? { worktree: removed } : {}); continue; }
    results.push({ ...result, ...(removed ? { worktree: removed } : {}), removed: true });
  }
  return results;
}
