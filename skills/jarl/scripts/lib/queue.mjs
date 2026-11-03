// The merge queue: derived, never stored.

import { basename } from 'node:path';
import { git } from './git.mjs';
import { canonical, jarlDir } from './where.mjs';
import { branchGlobsFor } from './ids.mjs';
import { loadProfile } from './profile.mjs';
import { defaultBase, fileAt, isGitRepo, issueRepos, refsIn, repoFromInput } from './repositories.mjs';
import { gateOf, readLoop } from './loop.mjs';
import { issuesOnBranch, loopRepos } from './rounds.mjs';
import { schedulerNote } from './evidence.mjs';

// ---- the merge queue: derived, never stored --------------------------------------------------------

// queue [--repo <path>] [--base <b>] — read-only: the branches waiting for the merger. A branch is in the queue when
// an unsettled issue on it (open or in progress) holds a live approve — one no round, restart or reopen has spent,
// by a fresh reviewer (the done gate's reading for an issue that carries code) — and the branch has commits its base does
// not, so it is not merged yet. Rows are ordered by approval (the latest live approve on the branch, then the log's
// order) and, per repository, cut into batches the way the merger's brief batches: a branch joins the current batch
// while its declared files share none with it, and starts the next one otherwise. It computes, holds no lock and
// writes nothing; it runs no check and refuses no merge — that is Horde's land.
export function cmdQueue(root, flags = {}) {
  const profile = loadProfile(root);
  // Under an external scheduler the merge order is its own (and with approve: none no fresh approve would ever queue
  // anything): { scheduler, note, repos: [] }.
  if (profile.scheduler) return { scheduler: profile.scheduler, note: schedulerNote(profile.scheduler), repos: [] };
  const loop = readLoop(jarlDir(root));
  const { issues } = loop;
  // Only work in play (offered or worked on): an issue waiting in a status with no such flag (a proposal, a block) is
  // never queued for merge.
  const unsettled = issues.filter((i) => profile.active(i.status));
  const gate = new Map(unsettled.map((i) => [i.id, gateOf(loop, i.id)]));
  // Every issue in the queue sits on a branch, so it carries code: only a fresh approve puts it there (the
  // fresh-review rule). One cleared by a coordinator alone waits, listed with its package as waiting for review.
  const approved = unsettled.filter((i) => gate.get(i.id).fresh);
  const repos = flags.repo !== undefined ? [repoFromInput(root, flags.repo).main] : loopRepos(root, issues);
  const out = [];
  for (const repo of repos) {
    if (!isGitRepo(repo)) continue;
    const real = canonical(repo);
    const base = flags.base || defaultBase(repo);
    const exists = (b) => refsIn(repo).has(b);
    // The branch an approved issue is on: its Branch field, else — for an issue that records none — the one
    // jarl/NNN-* branch carrying its number.
    const branchOf = (i) => {
      if (i.fields.branch) return exists(i.fields.branch) ? i.fields.branch : null;
      const found = (git(repo, ['branch', '--list', ...branchGlobsFor(i.id), '--format=%(refname:short)']) || '').split('\n').filter(Boolean);
      return found.length === 1 ? found[0] : null;
    };
    const branches = new Map();
    for (const i of approved.filter((x) => issueRepos(root, x).includes(real))) {
      const b = branchOf(i);
      if (b && b !== base) branches.set(b, [...(branches.get(b) || []), i]);
    }
    const rows = [];
    for (const [branch, on] of branches) {
      const mb = git(repo, ['merge-base', base, branch]);
      const ahead = mb ? Number(git(repo, ['rev-list', '--count', `${mb}..${branch}`]) || 0) : null;
      if (!ahead) continue;   // nothing its base lacks: merged already, or never worked on
      const others = issuesOnBranch(root, unsettled, real, branch).filter((i) => !on.includes(i));
      // The live approve, not simply the last one recorded: a later coordinator approve does not spend an
      // earlier, still-live fresh approve, so the row still credits the fresh reviewer who actually cleared it.
      const approves = on.map((i) => gate.get(i.id).live);
      const last = approves.reduce((a, b) => (!a || b.n > a.n ? b : a), null);
      const files = [...new Set(on.concat(others).flatMap((i) => i.files.map((f) => { const at = fileAt(root, i, f); return canonical(at.repo) === real ? at.path : null; }).filter(Boolean)))];
      rows.push({ branch, issues: on.map((i) => i.id), waitingReview: others.map((i) => i.id), ready: others.length === 0, ahead, approvedAt: last.at, by: last.by, files, n: last.n });
    }
    rows.sort((a, b) => a.n - b.n);
    // Batches: consecutive rows whose declared files do not meet. A row with no files declared rides alone —
    // nothing says what it touches.
    let batch = 0; let taken = null;
    for (const r of rows) {
      if (!taken || !r.files.length || r.files.some((f) => taken.has(f))) { batch += 1; taken = new Set(); }
      r.files.forEach((f) => taken.add(f));
      if (!r.files.length) taken = null;
      r.batch = batch;
      delete r.n;
    }
    out.push({ repo: basename(real), path: repo, base, rows });
  }
  return { repos: out };
}

export function renderQueue(o) {
  if (o.scheduler) return o.note;
  const lines = [];
  for (const r of o.repos) {
    if (!r.rows.length && o.repos.length > 1) continue;
    lines.push(`[${r.repo}] into ${r.base}`);
    if (!r.rows.length) lines.push('  (nothing approved waits to be merged)');
    r.rows.forEach((x, n) => {
      lines.push(`  ${n + 1}. ${x.branch} → ${x.issues.join(', ')}  +${x.ahead}  approved ${x.approvedAt}${x.by ? ` by ${x.by}` : ''}  batch ${x.batch}${x.ready ? '' : `  (waiting for review: ${x.waitingReview.join(', ')})`}`);
    });
  }
  return lines.join('\n') || '(nothing approved waits to be merged)';
}
