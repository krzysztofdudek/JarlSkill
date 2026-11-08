// The merge queue: derived, never stored.

import { basename } from 'node:path';
import { git } from './git.mjs';
import { canonical, jarlDir } from './where.mjs';
import { branchGlobsFor } from './ids.mjs';
import { loadProfile, reviewerRule } from './profile.mjs';
import { modelLines, modelRefusalOf } from './models.mjs';
import { baseOf, fileAt, isGitRepo, issueRepos, refsIn, repoFromInput } from './repositories.mjs';
import { mergedOf } from './issues.mjs';
import { integrationBranch, sameSlice, sliceMerger, sliceOf } from './slices.mjs';
import { gateOf } from './gate.mjs';
import { readLoop } from './loop.mjs';
import { issuesOnBranch, loopRepos } from './rounds.mjs';
import { mergeAgainWhy, schedulerNote } from './evidence.mjs';

// ---- the merge queue: derived, never stored --------------------------------------------------------

// The merge queue resume prints (--repo <path> narrows it, --base <b> sets its base) — read-only: the branches waiting
// for the merger. A branch is in the queue when
// an unsettled issue on it (open or in progress) holds a live approve — one no round, restart or reopen has spent,
// by a fresh reviewer (the done gate's reading for an issue that carries code) — and the branch has commits its base does
// not, so it is not merged yet. Rows are ordered by approval (the latest live approve on the branch, then the log's
// order) and, per repository, cut into batches the way the merger's brief batches: a branch joins the current batch
// while its declared files share none with it, and starts the next one otherwise. It computes, holds no lock and
// writes nothing; it runs no check and refuses no merge — that is a composer's gate, never Jarl's. A branch its base
// already holds is listed as well when a red round spent the merge recorded on it: that row is marked record only, since
// its merge is recorded again and nothing lands.
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
  // Under a reviewer rule that judges the model, an approve the done gate refuses for its model does not make its branch
  // ready: the gate's own reading says so, and its words say what is missing.
  const lines = reviewerRule(profile) === 'agent' ? null : modelLines(root);
  const refused = new Map(approved.map((i) => [i.id, modelRefusalOf(root, loop, i, { gate: gate.get(i.id), lines })]).filter(([, why]) => why));
  const repos = flags.repo !== undefined ? [repoFromInput(root, flags.repo).main] : loopRepos(root, issues);
  const out = [];
  for (const repo of repos) {
    if (!isGitRepo(repo)) continue;
    const real = canonical(repo);
    const base = flags.base || baseOf(root, repo);
    const exists = (b) => refsIn(repo).has(b);
    // The branch an approved issue is on: its Branch field, else — for an issue that records none — the one
    // jarl/NNN-* branch carrying its number.
    const branchOf = (i) => {
      if (i.fields.branch) return exists(i.fields.branch) ? i.fields.branch : null;
      const found = (git(repo, ['branch', '--list', ...branchGlobsFor(i.id), '--format=%(refname:short)']) || '').split('\n').filter(Boolean);
      return found.length === 1 ? found[0] : null;
    };
    // Each approved issue goes to its merger's target: the integration branch of a slice with a merger of its own, once
    // that branch exists, else the base. One writer per target branch: each target gets a queue of its own.
    const mergerOf = (i) => { const m = sliceMerger(loop.goalLines, i); return m && exists(integrationBranch(m.slice)) ? m : null; };
    const targets = new Map([[base, { base, slice: null, merger: null, branches: new Map() }]]);
    for (const i of approved.filter((x) => issueRepos(root, x).includes(real))) {
      const b = branchOf(i);
      const m = mergerOf(i);
      const into = m ? integrationBranch(m.slice) : base;
      if (!b || b === into) continue;
      if (!targets.has(into)) targets.set(into, { base: into, slice: m.slice, merger: m.name, branches: new Map() });
      const { branches } = targets.get(into);
      branches.set(b, [...(branches.get(b) || []), i]);
    }
    for (const t of targets.values()) {
      const rows = queueRows(root, loop, repo, real, t.base, t.branches, { unsettled, gate, refused });
      if (t.base === base) rows.push(...integrationRows(root, loop, repo, base));
      finishRows(rows);
      if (t.base === base || rows.length) out.push({ repo: basename(real), path: repo, base: t.base, ...(t.merger ? { slice: t.slice, merger: t.merger } : {}), rows });
    }
  }
  return { repos: out };
}

// The merger an issue's approved work goes to through its slice, { slice, name }, from the moment the slice's integration
// branch exists in a repository of the issue; null for an issue with none and, until that branch is made, for a slice
// with one: its work queues to the feature branch and is that merger's alone, in every view.
export function liveMerger(root, loop, issue) {
  const m = sliceMerger(loop.goalLines, issue);
  return m && issueRepos(root, issue).filter(isGitRepo).some((r) => refsIn(r).has(integrationBranch(m.slice))) ? m : null;
}

// The rows of one target branch: the branches of `branches` (issues approved on each) with what the target lacks of them.
function queueRows(root, loop, repo, real, base, branches, { unsettled, gate, refused }) {
  const rows = [];
  for (const [branch, on] of branches) {
    const mb = git(repo, ['merge-base', base, branch]);
    const ahead = mb ? Number(git(repo, ['rev-list', '--count', `${mb}..${branch}`]) || 0) : null;
    // A branch the target holds whole has nothing to land: its approved issue is listed only when its merge is to be
    // recorded, the one on record not counting now (mergeAgainWhy says why) or none being on record at all, and then the
    // row is record only.
    const unrecorded = ahead === 0 ? on.filter((i) => mergeAgainWhy(loop, i) || !mergedOf(i)) : [];
    const recordWhy = unrecorded.length ? mergeAgainWhy(loop, unrecorded[0]) ?? 'no merge is on record for it' : null;
    if (!ahead && !recordWhy) continue;   // nothing its target lacks: merged already, or never worked on
    const listed = ahead === 0 ? unrecorded : on;
    const others = issuesOnBranch(root, unsettled, real, branch).filter((i) => !on.includes(i));
    // The live approve, not simply the last one recorded: a later coordinator approve does not spend an
    // earlier, still-live fresh approve, so the row still credits the fresh reviewer who actually cleared it.
    const approves = on.map((i) => gate.get(i.id).live);
    const last = approves.reduce((a, b) => (!a || b.n > a.n ? b : a), null);
    const files = [...new Set(on.concat(others).flatMap((i) => i.files.map((f) => { const at = fileAt(root, i, f); return canonical(at.repo) === real ? at.path : null; }).filter(Boolean)))];
    const unaccepted = listed.filter((i) => refused.has(i.id));
    rows.push({ branch, issues: listed.map((i) => i.id), waitingReview: others.map((i) => i.id), ...(unaccepted.length ? { waitingModel: unaccepted.map((i) => ({ id: i.id, missing: refused.get(i.id) })) } : {}), ready: others.length === 0 && unaccepted.length === 0, ahead, ...(recordWhy ? { recordOnly: true, recordWhy } : {}), approvedAt: last.at, by: last.by, files, n: last.n });
  }
  return rows;
}

// The integration branches of the slices that keep their own merger, as rows of the base's queue: each lands on the base as
// a merge with its check, like any landing. A branch the base holds whole is left out; its issues are the slice's issues
// merged there and not in the base yet.
function integrationRows(root, loop, repo, base) {
  const rows = [];
  for (const m of Object.values(loop.goalLines.mergers)) {
    const branch = integrationBranch(m.slice);
    if (!refsIn(repo).has(branch)) continue;
    const mb = git(repo, ['merge-base', base, branch]);
    const ahead = mb ? Number(git(repo, ['rev-list', '--count', `${mb}..${branch}`]) || 0) : 0;
    if (!ahead) continue;
    const landed = (sha) => git(repo, ['merge-base', '--is-ancestor', sha, base]) !== null;
    const issues = loop.issues.filter((i) => sameSlice(sliceOf(i), m.slice) && mergedOf(i) && issueRepos(root, i).includes(canonical(repo)) && !landed(mergedOf(i).sha)).map((i) => i.id);
    if (!issues.length) continue;   // no merge recorded on it yet: nothing is known to land
    rows.push({ branch, issues, integration: true, slice: m.slice, waitingReview: [], ready: true, ahead, files: [], n: Number.MAX_SAFE_INTEGER });
  }
  return rows;
}

// The rows of a target in the order of approval, integration branches last, and cut into batches: consecutive rows whose
// declared files do not meet. A row with no files declared rides alone: nothing says what it touches.
function finishRows(rows) {
  rows.sort((a, b) => a.n - b.n);
  let batch = 0; let taken = null;
  for (const r of rows) {
    if (!taken || !r.files.length || r.files.some((f) => taken.has(f))) { batch += 1; taken = new Set(); }
    r.files.forEach((f) => taken.add(f));
    if (!r.files.length) taken = null;
    r.batch = batch;
    delete r.n;
  }
}

export function renderQueue(o) {
  if (o.scheduler) return o.note;
  const lines = [];
  for (const r of o.repos) {
    if (!r.rows.length && o.repos.length > 1) continue;
    lines.push(`[${r.repo}] into ${r.base}${r.merger ? ` (merger ${r.merger})` : ''}`);
    if (!r.rows.length) lines.push('  (nothing approved waits to be merged)');
    r.rows.forEach((x, n) => {
      // A row marked record only has nothing to land: its mark says why its merge is recorded again.
      const waits = [...(x.waitingReview.length ? [`waiting for review: ${x.waitingReview.join(', ')}`] : []), ...(x.waitingModel ? [`waiting for an approve the reviewer rule accepts: ${x.waitingModel.map((m) => m.missing).join('; ')}`] : [])];
      const marks = [...(x.recordOnly ? [`record only: the branch is in the base, and ${x.recordWhy}`] : []), ...(x.ready ? [] : waits)];
      const what = x.integration ? `the integration branch of the slice ${x.slice}` : `approved ${x.approvedAt}${x.by ? ` by ${x.by}` : ''}`;
      lines.push(`  ${n + 1}. ${x.branch} → ${x.issues.join(', ')}  +${x.ahead}  ${what}  batch ${x.batch}${marks.length ? `  (${marks.join('; ')})` : ''}`);
    });
  }
  return lines.join('\n') || '(nothing approved waits to be merged)';
}
