// Rounds, branches and checks.

import { ROUNDS_BEFORE_TAKEOVER, STALE_HOURS, fieldText, need, noSeparators } from './base.mjs';
import { git } from './git.mjs';
import { canonical, portablePath } from './where.mjs';
import { branchIssueId, idKey, idsNamed } from './ids.mjs';
import { DEFAULT_PROFILE, loadProfile } from './profile.mjs';
import { appendLog, oneLine, parseStamp } from './journal.mjs';
import { journalById } from './log.mjs';
import { findIssue, loadIssues, mergedOf } from './issues.mjs';
import { defaultBase, fileAt, isGitRepo, issuePlaces, issueRepoPaths, issueRepos, refsIn, repoFromInput, repoLabel, repoOf, reposNamed, worktreeState, worktreesOf } from './repositories.mjs';

// ---- rounds, branches, checks ------------------------------------------------------------------

export function roundsOf(root, id) {
  return (journalById(root).get(id) || []).filter((e) => e.type === 'round').length;
}

// The findings a round line records after its number, in the order of the rounds.
const FINDINGS_MAX = 10000;
function findingsOfRounds(entries) {
  return entries.filter((e) => e.type === 'round').map((e) => /^\S+ round \d+ · findings (\d+) · /.exec(e.text)).map((m) => (m ? Number(m[1]) : null));
}

// What to change for the fresh worker, from the tier the issue carries: a tier up while one exists, and from the top
// tier a different model or a changed approach. Every step is a choice, so a loop that bars a model can take another.
// The tiers and their order are the loop's profile's. After the first takeover the tier was already offered, so later
// advice leaves it out: the issue's Tier stays as filed, and a model other than the ones that held the issue is the step.
function takeoverAdvice(tiers, tier, failed, n, takeovers) {
  const model = failed || 'the one that failed';
  const unknown = failed ? '' : ' (its lease did not record one)';
  const above = tiers[tiers.indexOf(tier) + 1];
  const top = tiers[tiers.length - 1];
  const tried = `the same model at the same tier has failed this ${n} times`;
  const lead = 'For whoever raises the fresh worker: ';
  if (takeovers > 1) return `${lead}put it on a model that has not held this issue (the last was ${model}${unknown}), or change the approach — ${tried}, and an earlier takeover has not settled it.`;
  if (above) return `${lead}raise it one tier up from ${tier} (to ${above}), or put it on a model other than ${model}${unknown}, or change the approach — ${tried}.`;
  return `${lead}${tier} is the top tier (${top}), so put it on a model other than ${model}${unknown}, or change the approach — ${tried}.`;
}

export function cmdRound(root, rawId, what, dry = false, opts = {}) {
  need(what, 'round requires "<what failed>"');
  const found = opts.findings;
  need(found === undefined || (/^\d+$/.test(String(found)) && Number(found) <= FINDINGS_MAX), `--findings must be a whole number up to ${FINDINGS_MAX}`);
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  if (dry) return { id: issue.id };
  const n = roundsOf(root, issue.id) + 1;
  appendLog(root, `${issue.id} round ${n} · ${found === undefined ? (/^findings \d+ · /.test(what) ? 'findings - · ' : '') : `findings ${Number(found)} · `}${what}`);
  // A takeover starts a new count: the next one comes after as many rounds of the new worker.
  const takeover = n % ROUNDS_BEFORE_TAKEOVER === 0;
  const since = ((n - 1) % ROUNDS_BEFORE_TAKEOVER) + 1;
  const entries = journalById(root).get(issue.id) || [];
  const findings = findingsOfRounds(entries).filter((x) => x !== null);
  const trend = findings.length ? `Findings per round: ${findings.join(', ')}.\n\n` : '';
  const log = entries.filter((e) => e.type !== 'filed').map((e) => `- ${e.at} · ${e.text}`).join('\n');
  const advice = takeoverAdvice(loadProfile(root).tiers, issue.tier, fieldText(issue.fields.model), ROUNDS_BEFORE_TAKEOVER, n / ROUNDS_BEFORE_TAKEOVER);
  const block = takeover ? `## Takeover\n\n${advice}\n\n${trend}A prior worker attempted issue ${issue.id} ${ROUNDS_BEFORE_TAKEOVER} times (${n} rounds in all); the issue is yours now. Its rounds so far:\n\n\`\`\`\n${log}\n\`\`\`\n` : null;
  return { id: issue.id, round: n, since, takeover, block, ...(found === undefined ? {} : { findings: Number(found) }) };
}

const ASSERT_RE = /\b(expect\(|assert\.|assert\(|assert |t\.(Error|Fatal|Errorf|Fatalf)\(|Assert\.|should\.|\.toBe|\.toEqual)/g;

function countAsserts(root, ref, files) {
  let n = 0;
  for (const f of files) {
    const text = git(root, ['show', `${ref}:${f}`]);
    if (text === null) continue;
    n += (text.match(ASSERT_RE) || []).length;
  }
  return n;
}

function isTestFile(f) { return /(^|\/)(test|tests|spec|__tests__)(\/|$)|\.(test|spec)\.[a-z]+$|_test\.[a-z]+$|Tests?\.[a-z]+$/.test(f); }

// The most notes a check prints; the rest are counted, so a branch of thousands of lines cannot flood the output.
const NOTE_LIMIT = 20;
// The added lines of a diff that name an issue of the loop (`held`): each line the branch gives, its file and its number
// in the branch, read from the hunks of a zero-context diff. Only added lines count, a removed line never does, and the
// text of each is one line with its separators escaped.
function issueNumberNotes(repo, range, held) {
  const diff = git(repo, ['diff', '--no-color', '--no-ext-diff', '-U0', range]) || '';
  const notes = [];
  let file = null;
  let line = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const text of diff.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      if (oldLeft > 0 && text.startsWith('-')) oldLeft -= 1;
      else if (newLeft > 0 && text.startsWith('+')) {
        const added = noSeparators(oneLine(text.slice(1)));
        const ids = idsNamed(added, held, { introducedOnly: true });
        if (ids.length) notes.push({ kind: 'issue-number', file, line, ids, text: added });
        newLeft -= 1;
        line += 1;
      }
      continue;
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(text);
    if (hunk) { oldLeft = Number(hunk[1] ?? 1); line = Number(hunk[2]); newLeft = Number(hunk[3] ?? 1); }
    else if (text.startsWith('+++ ')) file = text.startsWith('+++ b/') ? text.slice(6) : null;
  }
  return notes;
}
// The lines a check prints for its notes: each note on one line, then how many were left out past the limit.
export function renderCheckNotes(out) {
  const lines = out.notes.map((n) => `note ${n.file}:${n.line} names issue ${n.ids.join(', ')} · ${n.text}`);
  if (out.notesOmitted) lines.push(`… and ${out.notesOmitted} more notes not shown`);
  return lines.join('\n');
}

// scope <id> --branch <b> bounds the diff by that issue's Files; scope --branch <b> with no id bounds it by the
// union of Files over every issue that records Branch <b> (in progress or done) — a package on one shared
// branch passes in one call instead of failing each issue for the files of the others.
// The commits a branch carries beyond the base, or null when git does not know the branch or the base.
function commitsBeyond(repo, base, branch) {
  const n = git(repo, ['rev-list', '--count', `${base}..${branch}`]);
  return n === null ? null : Number(n);
}
// The refusal of a branch no issue records. When the branch carries commits, it says how many and what to file.
function unrecordedBranch(root, flags) {
  const repo = flags.repo !== undefined ? repoFromInput(root, flags.repo).main : root;
  const base = flags.base || defaultBase(repo);
  const carried = commitsBeyond(repo, base, flags.branch);
  if (carried) return `no issue records branch ${flags.branch}: it carries ${carried} commit(s) beyond ${base} and no issue holds it (work without an issue) — file the issue, then set it in-progress --branch ${flags.branch}`;
  return `no issue records branch ${flags.branch} — name one (scope <id> --branch ${flags.branch}), or record the package: set <ids> in-progress --branch ${flags.branch}`;
}

export function cmdCheck(root, rawId, flags) {
  need(flags.branch, 'scope requires --branch <worker branch>');
  let pkg;
  if (rawId === undefined) {
    const profile = loadProfile(root);
    pkg = loadIssues(root).filter((i) => i.fields.branch === flags.branch && (profile.is(i.status, 'holds-claim') || profile.is(i.status, 'closes-record')));
    if (!pkg.length) need(false, unrecordedBranch(root, flags));
    if (flags.repo === undefined) {
      const repos = new Map();
      for (const i of pkg) for (const r of issuePlaces(root, i)) repos.set(r, [...(repos.get(r) || []), i.id]);
      need(repos.size === 1, `the issues on ${flags.branch} name different repositories (${[...repos.values()].map((ids) => ids.join(', ')).join(' | ')}) — check them one by one, or pass --repo`);
    }
  } else {
    const issue = findIssue(root, rawId);
    need(issue, `no such issue: ${rawId}`);
    pkg = [issue];
    need(flags.repo !== undefined || reposNamed(issue).length <= 1, `${issue.id} names several repositories (${reposNamed(issue).join(', ')}) — check one at a time with --repo <path>`);
  }
  const issue = pkg[0];
  const repo = flags.repo !== undefined ? repoFromInput(root, flags.repo).main : repoOf(root, reposNamed(issue)[0]);
  const realRepo = canonical(repo);
  const where = repo === root ? '' : ` in ${repo}`;
  const base = flags.base || defaultBase(repo);
  const tip = git(repo, ['rev-parse', '--verify', flags.branch]);
  need(tip, `no such branch: ${flags.branch}${where}`);
  const mergeBase = git(repo, ['merge-base', base, flags.branch]);
  need(mergeBase, `no merge base between ${base} and ${flags.branch}${where}`);
  const commits = (git(repo, ['rev-list', '--count', `${mergeBase}..${flags.branch}`]) || '0');
  const changed = (git(repo, ['diff', '--name-only', `${mergeBase}..${flags.branch}`]) || '').split('\n').filter(Boolean);
  // A change proves itself with a test and announces itself in the changelog, so neither is ever
  // "outside" the issue: the scope check is about source, not about the two files every issue touches.
  const alwaysInScope = (f) => isTestFile(f) || /(^|\/)CHANGELOG\.md$/i.test(f);
  // A declared file may be repo-relative (the common case) or relative to some subdirectory the
  // issue itself is scoped to (e.g. a plugin's own skill body); a diff path matches either way —
  // as a root-relative prefix, or at a "/" boundary anywhere in the path. A declared directory covers everything under it.
  const pathMatches = (f, d) => {
    const dd = d.replace(/\/+$/, '');
    return f === dd || f.startsWith(`${dd}/`) || f.endsWith(`/${dd}`) || f.includes(`/${dd}/`);
  };
  // The diff's paths are inside the repository read, so a file the issue declares with its
  // repository's name first is matched by the path after that name.
  // `--repo` on the command reads the paths as the issue's own Repo field would.
  // An issue that names several repositories bounds the diff by the files it declares in the one read here.
  const listsRepo = (i) => Boolean(i.fields.repo) && issuePlaces(root, i).includes(realRepo);
  const named = (i) => (flags.repo !== undefined && !listsRepo(i) ? { ...i, fields: { ...i.fields, repo: portablePath(repo) } } : i);
  const here = pkg.flatMap((i) => i.files.map((d) => ({ d, at: fileAt(root, named(i), d) }))).filter((x) => canonical(x.at.repo) === realRepo);
  const declaredFiles = [...new Set(here.map((x) => x.d))];
  const declared = here.map((x) => x.at.path);
  // The bounds are only what the issues declare, never what the worker's commits touched: a worker would set its own.
  // An issue that declares no files here leaves the diff unbounded, and that is one sentence, not a list of files.
  const noFiles = pkg.filter((i) => !here.some((x) => i.files.includes(x.d))).map((i) => i.id);
  const outside = declaredFiles.length && !noFiles.length ? changed.filter((f) => !alwaysInScope(f) && !declared.some((d) => pathMatches(f, d))) : [];
  const unbounded = (ids) => `${ids.join(', ')} declare${ids.length === 1 ? 's' : ''} no files, so nothing bounds the diff`;
  const testsBase = (git(repo, ['ls-tree', '-r', '--name-only', mergeBase]) || '').split('\n').filter(isTestFile);
  const testsTip = (git(repo, ['ls-tree', '-r', '--name-only', flags.branch]) || '').split('\n').filter(isTestFile);
  const removedTests = testsBase.filter((f) => !testsTip.includes(f));
  const touchedTests = changed.filter(isTestFile);
  const assertsBase = countAsserts(repo, mergeBase, [...new Set([...touchedTests, ...removedTests])]);
  const assertsTip = countAsserts(repo, flags.branch, touchedTests);
  const items = [
    { name: 'commits beyond base', ok: Number(commits) > 0, note: `${commits} commit(s) on ${flags.branch} beyond ${mergeBase.slice(0, 7)}` },
    { name: 'diff inside declared files', ok: outside.length === 0, note: noFiles.length ? (pkg.length > 1 ? unbounded(noFiles) : 'no files declared on the issue — nothing to bound the diff by') : (outside.length ? `outside ${declaredFiles.join(', ')}: ${outside.join(', ')}` : `${changed.length} file(s), all inside`) },
    { name: 'test files', ok: removedTests.length === 0, note: removedTests.length ? `removed: ${removedTests.join(', ')}` : `${testsTip.length} on the branch, ${touchedTests.length} touched, none removed` },
    { name: 'assertions in touched tests', ok: assertsTip >= assertsBase, note: `${assertsBase} → ${assertsTip}` },
  ];
  const notes = issueNumberNotes(repo, `${base}...${flags.branch}`, new Set(loadIssues(root).map((i) => i.id)));
  return { id: rawId === undefined ? null : issue.id, ids: pkg.map((i) => i.id), branch: flags.branch, repo, base, mergeBase, changed, items, notes: notes.slice(0, NOTE_LIMIT), notesOmitted: Math.max(0, notes.length - NOTE_LIMIT), ok: items.every((i) => i.ok) };
}

// Every jarl/* branch, plus every branch some worktree has checked out that is not the base: a
// worker that never renamed its branch still did the work, and a listing that hides it would
// hide a report. Such a branch is marked unnamed so the merger renames it before merging.
// With --repo, all of it is read in that repository, for a loop whose workers change another one.
// Worker branches in one repository, or — with no --repo — in the loop's own repository and in every repository
// an open or in-progress issue names, each row carrying the repository's name. The boot reads this to see a worker
// branch with commits as a report, and in a loop whose issues point at other repositories that is where they are.
export function cmdBranches(root, flags) {
  const hours = staleHours(flags);
  const issues = loadIssues(root);
  const repos = flags.repo !== undefined ? [repoFromInput(root, flags.repo).main] : loopRepos(root, issues);
  return repos.flatMap((repo) => branchesIn(root, repo, flags, issues, hours));
}

const DONE_BRANCH = { delete: '  DONE → delete', dirty: '  DONE (worktree dirty)', unknown: '  DONE (worktree state unknown)', unverified: '  DONE (merged by record, branch not in base) — verify' };
function renderBranchWorktree(b) {
  if (!b.worktree) return '(no worktree)';
  const state = b.worktreeGone ? ' (gone)'
    : b.worktreeState === 'elsewhere' ? ` (elsewhere${b.worktreeReason ? `: ${b.worktreeReason}` : ''})`
    : b.worktreeState === 'invisible' ? ' (not visible from here)'
    : b.dirty ? ` (${b.dirty} uncommitted)` : ' (clean)';
  return `${b.worktree}${state}`;
}
// branches: one line per branch, in a repository other than the loop's own prefixed with its name.
export function renderBranches(rows, root) {
  if (!rows.length) return '(no worker branches)';
  return rows.map((b) => [
    b.repo !== repoLabel(root) ? `[${b.repo}] ` : '', b.branch, b.issues.length ? ` → ${b.issues.join(', ')}` : '', '  ',
    b.missing ? 'GONE' : `+${b.ahead ?? '?'}  ${renderBranchWorktree(b)}`,
    b.unnamed ? '  UNNAMED — rename to jarl/NNN-slug before merging' : '', b.unticketed ? '  NO ISSUE' : '', DONE_BRANCH[b.done] || '', b.stale.length ? `  STALE: ${b.stale.join('; ')}` : '',
  ].join('')).join('\n');
}

function staleHours(flags) {
  if (flags['stale-hours'] === undefined) return STALE_HOURS;
  const h = Number(flags['stale-hours']);
  need(Number.isFinite(h) && h > 0, `--stale-hours takes a positive number of hours (got "${flags['stale-hours']}")`);
  return h;
}

// The loop's own repository, every repository an open or in-progress issue names, and every one an issue
// records a Branch in (a done package's branch waits there to be deleted).
function loopRepos(root, issues) {
  const seen = new Map([[canonical(root), root]]);
  const profile = loadProfile(root);
  for (const issue of issues) {
    const unfinished = profile.unfinished(issue.status);
    if (!unfinished && !(issue.fields.branch && issue.status !== 'dropped')) continue;
    for (const repo of issueRepoPaths(root, issue)) {   // a Repo path that does not resolve is not the boot's to refuse
      const real = canonical(repo);
      if (!seen.has(real)) seen.set(real, repo);
    }
  }
  return [...seen.values()];
}

// The issues a branch carries in one repository: those that record it as their Branch, and — for an issue
// that records no Branch — the one whose number the branch's jarl/NNN-* name carries.
function issuesOnBranch(root, issues, realRepo, name) {
  const numbered = branchIssueId(name);
  return issues.filter((i) => issueRepos(root, i).includes(realRepo) && (i.fields.branch ? i.fields.branch === name : idKey(i.id) === idKey(numbered)));
}

export function ago(ms) {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// What looks wrong with an in-progress issue's lease — shown, never acted on (no expiry, no takeover): its
// recorded worktree is gone, its recorded branch is gone, or the lease has lasted more than `hours` and its branch
// has no commit that recent either. An issue that records no lease fields has none of them and reads clean.
export function leaseProblems(root, issue, hours = STALE_HOURS, now = Date.now()) {
  if (!loadProfile(root).is(issue.status, 'holds-claim')) return [];
  const f = issue.fields;
  const out = [];
  let lastCommit = null;
  // Outside a git repository there is no branch to find, gone or not. An issue naming several repositories
  // keeps its branch while any of them has it.
  const repos = f.branch || f.worktree ? issueRepoPaths(root, issue).filter(isGitRepo) : [];
  // The worktree is asked of git, by the lease's branch (and the stored path of a lease that has one): only 'gone' is a problem.
  if (f.branch || f.worktree) {
    const states = (repos.length ? repos : [null]).map((r) => worktreeState(r, f.branch, f.worktree));
    const seen = states.find((s) => s.state !== 'gone' && s.state !== 'none');
    const gone = states.find((s) => s.state === 'gone');
    if (!seen && gone) out.push(`worktree gone: ${gone.path}`);
  }
  if (f.branch) {
    const having = repos.filter((r) => refsIn(r).has(f.branch));
    if (repos.length && !having.length) out.push(`branch gone: ${f.branch}`);
    for (const r of having) { const t = refsIn(r).get(f.branch).committedMs; if (t && (!lastCommit || t > lastCommit)) lastCommit = t; }
  }
  const since = parseStamp(f.since);
  const limit = hours * 3_600_000;
  if (since !== null && now - since > limit && !(lastCommit && now - lastCommit <= limit)) {
    out.push(`idle ${ago(now - since)}: lease since ${f.since}${lastCommit ? `, last commit ${ago(now - lastCommit)} ago` : ''}`);
  }
  return out;
}

// Whether a branch whose issues are all settled (done or dropped, at least one done) can go. 'delete': its tip
// is in the base — an ancestor of it, or of every merge sha its done issues record (a squash or a merge made
// elsewhere) — and its worktree holds nothing uncommitted. 'dirty': it would be, but its worktree has
// uncommitted files. 'unverified': its issues record merges but the branch has commits none of them contain
// (work after the merge, or a squash). A branch matched only by its jarl/NNN- number, with no Branch field
// behind it, is judged by ancestry alone: a number is too weak to trust a recorded merge for. Null otherwise.
function doneMark(repo, base, name, on, dirty, profile = DEFAULT_PROFILE, unknown = false) {
  const closed = (i) => profile.is(i.status, 'closes-record');
  // Given up: finished, settling what waits on it, without closing the record (built-in: dropped). A status that is
  // finished but settles nothing (deferred) is work that waits, and keeps its branch.
  const givenUp = (i) => profile.is(i.status, 'terminal') && profile.is(i.status, 'settles-dependents') && !closed(i);
  const settled = on.length > 0 && on.every((i) => closed(i) || givenUp(i)) && on.some(closed);
  if (!settled) return null;
  const inBase = git(repo, ['merge-base', '--is-ancestor', name, base]) !== null;
  let byRecord = false;
  if (!inBase) {
    const recorded = on.every((i) => i.fields.branch === name);
    const done = on.filter(closed);
    if (!recorded || !done.every((i) => mergedOf(i))) return null;
    byRecord = done.every((i) => git(repo, ['merge-base', '--is-ancestor', name, mergedOf(i).sha]) !== null);
    if (!byRecord) return 'unverified';
  }
  // A worktree git lists but this machine cannot inspect has an unknown number of uncommitted changes: never 'delete'.
  return dirty ? 'dirty' : unknown ? 'unknown' : 'delete';
}

function branchesIn(root, repo, flags, issues, hours = STALE_HOURS) {
  const base = flags.base || defaultBase(repo);
  const real = canonical(repo);
  const named = (git(repo, ['branch', '--list', 'jarl/*', '--format=%(refname:short)']) || '').split('\n').filter(Boolean);
  const worktrees = (worktreesOf(repo) || []).filter((w) => w.branch);
  const mainPath = git(repo, ['rev-parse', '--show-toplevel']);
  // A branch some issue records as its Branch is listed whatever its name: a package's shared branch.
  const leased = [...new Set(issues.filter((i) => i.fields.branch && i.status !== 'dropped' && issueRepos(root, i).includes(real)).map((i) => i.fields.branch))];
  const exists = (b) => git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]) !== null;
  const recorded = leased.filter((b) => !named.includes(b) && b !== base && exists(b));
  const extra = worktrees.filter((w) => w.branch !== base && !named.includes(w.branch) && !recorded.includes(w.branch) && w.path !== mainPath).map((w) => w.branch);
  const rows = [...named, ...recorded, ...extra].map((name) => {
    const mb = git(repo, ['merge-base', base, name]);
    const ahead = mb ? Number(git(repo, ['rev-list', '--count', `${mb}..${name}`]) || 0) : null;
    const on = issuesOnBranch(root, issues, real, name);
    // The worktree is asked of git by the branch (and the stored path of a lease that has one), through the one lookup.
    const ws = worktreeState(repo, name, on.map((i) => i.fields.worktree).find(Boolean));
    const wtGone = ws.state === 'gone';
    const status = ws.state === 'here' ? git(ws.path, ['status', '--porcelain']) : null;
    const dirty = status === null ? null : status.split('\n').filter(Boolean).length;
    // Uncommitted changes that cannot be counted: a worktree git lists but this machine cannot see, or one that would not answer.
    const unknown = ws.state === 'elsewhere' || ws.state === 'invisible' || (ws.state === 'here' && dirty === null);
    const stale = on.flatMap((i) => leaseProblems(root, i, hours).map((p) => `${i.id} ${p}`));
    // Done → delete: every issue it carries is done or dropped (at least one done), and its work is in the
    // base — the branch is an ancestor of it, or every done issue records its merge.
    const done = doneMark(repo, base, name, on, dirty, loadProfile(root), unknown);
    // A branch that carries commits, no issue holds (no Branch, no lease) and that is neither the base nor a release branch.
    const unticketed = on.length === 0 && (ahead ?? 0) > 0 && name !== base && !/^release\//.test(name);
    return { repo: repoLabel(repo), branch: name, ahead, unticketed, worktree: ws.path, worktreeState: ws.state, ...(ws.reason ? { worktreeReason: ws.reason } : {}), ...(wtGone ? { worktreeGone: true } : {}), dirty, unnamed: !name.startsWith('jarl/') && !leased.includes(name), issues: on.map((i) => i.id), stale, done, deletable: done === 'delete' };
  });
  // An in-progress issue whose recorded branch is not in the repository any more: a lease with nothing under it.
  const gone = leased.filter((b) => !exists(b)).map((name) => {
    const on = issuesOnBranch(root, issues, real, name);
    const stale = on.flatMap((i) => leaseProblems(root, i, hours).map((p) => `${i.id} ${p}`));
    return { repo: repoLabel(repo), branch: name, ahead: null, unticketed: false, worktree: null, dirty: null, unnamed: false, issues: on.map((i) => i.id), stale, done: null, deletable: false, missing: true };
  }).filter((r) => r.stale.length);
  return [...rows, ...gone];
}

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { issuesOnBranch, loopRepos, staleHours };
