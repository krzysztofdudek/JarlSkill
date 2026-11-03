// Tips: where each repository's branches stand, and their CI.

import { basename } from 'node:path';
import { git, runGh } from './git.mjs';
import { jarlDir } from './where.mjs';
import { parseStamp } from './journal.mjs';
import { mergedOf } from './issues.mjs';
import { HOMES, IS_REPO, REFS, REPO_OF, RESOLVED, TOP_OF, isGitRepo, issueRepoPaths, issueRepos, refsIn, reposNamed, topOf } from './repositories.mjs';
import { readLoop } from './loop.mjs';
import { lastMerge } from './metrics.mjs';

// ---- tips: where each repository's branches stand, and their CI -----------------------------------

function issueTops(root, issue) { return issueRepos(root, issue).map(topOf); }

// A merge counts as recent for tips while its CI is pending or red, or for this long after its log line.
export const TIPS_RECENT_MS = 7 * 24 * 3_600_000;

// gh, when it is on PATH (JARL_GH names another binary: a test knob). Null when it cannot be run: tips then
// says nothing about CI rather than guessing. A JARL_GH ending in .js, .mjs or .cjs is run by process.execPath, so a stub
// works the same on every OS: Windows runs no shebang script, and no .cmd shim without a shell.
let GH;
// Every cache a command fills, emptied before the next one (see dispatch).
export function resetCaches() {
  for (const m of [IS_REPO, REFS, RESOLVED, REPO_OF, TOP_OF, HOMES]) m.clear();
  GH = undefined;
}
function ghBin() {
  if (GH !== undefined) return GH;
  const bin = process.env.JARL_GH || 'gh';
  try { runGh(bin, ['--version'], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 10_000 }); GH = bin; } catch { GH = null; }
  return GH;
}
// The CI runs for one commit, summed up: pending while any run is not completed, red when any concluded
// otherwise than success, skipped or neutral, green when all did, none when no run exists. Null without gh or
// when gh fails (not logged in, no remote on GitHub): unknown, never red.
export function ciOf(repo, sha) {
  const bin = ghBin();
  if (!bin) return null;
  let runs;
  try {
    runs = JSON.parse(runGh(bin, ['run', 'list', '--commit', sha, '--json', 'conclusion,status,databaseId,workflowName', '--limit', '20'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 }));
  } catch { return null; }
  if (!Array.isArray(runs)) return null;
  const pending = runs.filter((r) => r.status && r.status !== 'completed');
  const bad = runs.filter((r) => r.status === 'completed' && !['success', 'skipped', 'neutral'].includes(r.conclusion));
  const state = !runs.length ? 'none' : pending.length ? 'pending' : bad.length ? 'red' : 'green';
  const pick = bad[0] || pending[0] || runs[0];
  return { state, runs: runs.length, ...(pick ? { run: pick.databaseId ?? null, workflow: pick.workflowName ?? null, conclusion: pick.conclusion || pick.status || null } : {}) };
}

// tips — read-only: for the loop's own repository and every repository an open, in-progress or recently merged
// issue names, the tip of each branch that matters there — the feature branches its in-progress issues record,
// the branch its checkout is on (the release branch), and main — with ahead/behind against its upstream as last
// fetched (nothing is fetched), and, when gh is on PATH, the CI of that exact commit. It never gates anything.
// A row's role says what the branch is in the skill: worker (a worker branch of an in-progress issue), feature (the
// branch the checkout is on, the one the loop's work merges into) or main.
export function cmdTips(root, { ci: askCi = true } = {}) {
  const loop = readLoop(jarlDir(root));
  const { issues, profile } = loop;
  const now = Date.now();
  const recent = (i) => {
    const m = mergedOf(i);
    if (!m || i.status === 'dropped') return false;
    if (m.ci === 'pending' || m.ci === 'red') return true;
    const line = lastMerge(loop.eventsById.get(i.id) || []);
    const at = line ? parseStamp(line.at) : null;
    return at !== null && now - at <= TIPS_RECENT_MS;
  };
  const named = issues.filter((i) => profile.unfinished(i.status) || recent(i));
  const repos = new Map([[topOf(root), root]]);
  for (const i of named) {
    const m = mergedOf(i);
    for (const r of issueRepoPaths(root, i, [...reposNamed(i), ...(m && m.repo ? [m.repo] : [])])) if (!repos.has(topOf(r))) repos.set(topOf(r), r);
  }
  const out = [];
  for (const [real, repo] of repos) {
    if (!isGitRepo(repo)) continue;
    const current = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const refs = refsIn(repo);
    const exists = (b) => refs.has(b);
    const main = ['main', 'master'].find(exists) || null;
    const flight = issues.filter((i) => profile.is(i.status, 'holds-claim') && i.fields.branch && issueTops(root, i).includes(real));
    // A worker branch of an issue naming several repositories lives in one or some of them: it is shown where it
    // is, and GONE only when none of them has it.
    const hasBranch = (dir, b) => isGitRepo(dir) && refsIn(dir).has(b);
    const elsewhere = (b) => flight.filter((i) => i.fields.branch === b).some((i) => issueRepos(root, i).some((r) => topOf(r) !== real && hasBranch(r, b)));
    const feature = [...new Set(flight.map((i) => i.fields.branch))].filter((b) => exists(b) || !elsewhere(b));
    const wanted = [...feature.map((b) => ({ role: 'worker', branch: b })), ...(current && current !== 'HEAD' ? [{ role: 'feature', branch: current }] : []), ...(main ? [{ role: 'main', branch: main }] : [])];
    const seen = new Set();
    const rows = [];
    for (const w of wanted) {
      if (seen.has(w.branch)) continue;
      seen.add(w.branch);
      if (!exists(w.branch)) { rows.push({ ...w, sha: null, missing: true }); continue; }
      const ref = refs.get(w.branch);
      const sha = ref.sha;
      // A worker branch cut with tracking of the release branch has no upstream of its own: only a remote branch
      // of the same name counts as where it was pushed.
      let upstream = ref.upstream;
      if (upstream && w.role === 'worker' && !upstream.endsWith(`/${w.branch}`)) upstream = null;
      let ahead = null; let behind = null; let against = null;
      if (upstream) {
        ahead = ref.ahead; behind = ref.behind; against = upstream;
      } else if (w.role === 'worker' && current && current !== 'HEAD' && current !== w.branch) {
        const lr = (git(repo, ['rev-list', '--left-right', '--count', `${w.branch}...${current}`]) || '').split(/\s+/).map(Number);
        [ahead, behind] = lr; against = current;
      }
      const on = w.role === 'worker' ? flight.filter((i) => i.fields.branch === w.branch).map((i) => i.id) : [];
      // CI runs on what was pushed: only a tip its upstream already holds (nothing ahead) is asked about.
      const pushed = Boolean(upstream) && ahead === 0;
      const ci = pushed && askCi ? ciOf(repo, sha) : null;
      rows.push({ ...w, sha: sha.slice(0, 12), upstream: upstream || null, against, ahead, behind, pushed, ...(on.length ? { issues: on } : {}), ...(ci ? { ci } : {}) });
    }
    const merged = named.filter((i) => mergedOf(i) && issueTops(root, i).includes(real)).map((i) => ({ id: i.id, sha: mergedOf(i).sha, ci: mergedOf(i).ci }));
    out.push({ repo: basename(real), path: repo, rows, ...(merged.length ? { merged } : {}) });
  }
  return { gh: askCi ? ghBin() !== null : null, ci: askCi, repos: out };
}

export function renderTips(o) {
  const lines = [];
  for (const r of o.repos) {
    lines.push(`[${r.repo}] ${r.path}`);
    for (const x of r.rows) {
      if (x.missing) { lines.push(`  ${x.role.padEnd(8)} ${x.branch}  GONE`); continue; }
      const ab = x.against ? `  ${x.ahead === 0 && x.behind === 0 ? `= ${x.against}` : `+${x.ahead}/-${x.behind} vs ${x.against}`}` : '  (no upstream)';
      const ci = x.ci ? `  ci ${x.ci.state}${x.ci.run ? ` (run ${x.ci.run}${x.ci.workflow ? ` ${x.ci.workflow}` : ''})` : ''}` : x.pushed ? '' : '  not pushed';
      lines.push(`  ${x.role.padEnd(8)} ${x.branch} ${x.sha}${ab}${ci}${x.issues ? `  → ${x.issues.join(', ')}` : ''}`);
    }
    for (const m of r.merged || []) lines.push(`  merged   ${m.id} ${m.sha} · CI ${m.ci || 'not recorded'}`);
  }
  return lines.join('\n') || '(no repository)';
}

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { issueTops };
