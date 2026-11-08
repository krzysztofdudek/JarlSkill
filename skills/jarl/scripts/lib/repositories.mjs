// The repositories of a loop: their names, their declarations, the one resolver, and where each one and
// each worktree is on this machine.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, basename, relative, isAbsolute } from 'node:path';
import { afterView, echoWord, fieldText, hole, jarlLine, need, noSeparators, splitList } from './base.mjs';
import { git } from './git.mjs';
import { canonical, issuesDir, jarlDir, normalPath, portablePath } from './where.mjs';
import { readText, writeAtomic } from './files.mjs';
import { ISSUE_FILE_RE, branchNameProblem } from './ids.mjs';
import { FORMAT_LINES, PROFILE_VERSION, RECORD_FORMATS, RECORD_FORMAT_RAISED, forgetProfile, formatState, loadProfile, needRaisable, profilePath } from './profile.mjs';
import { appendLog, appendLogLines, logPath, tipLine } from './journal.mjs';
import { withLock } from './lock.mjs';
import { mapMergeRepos } from './log.mjs';

// ---- repositories: names, declarations and the one resolver ------------------------------------------------------
//
// A repository an issue names is written as a name or as a path. The record holds identity and the machine holds
// location. A name is the directory git clone gives the repository; it holds no path and resolves, here and nowhere
// else, to the sibling of the loop's main checkout. A path is read from the loop's root. How a stored value reads
// depends on the loop's record format: in format 1 every value is a path; in format 2 a value that starts with a dot, a
// slash or a drive letter is a path, and anything else is a name. Jarl declares a name once, in .jarl/repos.md, with the
// root commits of the repository (all of them), its origin as found and its base branch, and no path. The root commits
// are read to declare a repository and to check one (repoIdentity); no other command reads them. Nothing resolved is
// ever written: the views print where a repository is on this machine and store none of it.
export const REPOS_FILE = 'repos.md';
const reposPath = (root) => join(jarlDir(root), REPOS_FILE);
const REPO_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const PATH_START = /^(?:[./\\]|[A-Za-z]:(?:[\\/]|$))/;
// 'name' or 'path': how a stored Repo value (or the in-part of a recorded merge) reads in this loop.
export function repoValueKind(root, value) {
  return loadProfile(root).format >= RECORD_FORMAT_RAISED && !PATH_START.test(value) && REPO_NAME_RE.test(value) ? 'name' : 'path';
}

// The directory a name is looked for in: the parent of the loop's main checkout, found through git's common directory, so
// a loop opened in a linked worktree finds its siblings beside the main checkout. A loop outside git looks beside its root.
const HOMES = new Map();
function loopHome(root) {
  if (HOMES.has(root)) return HOMES.get(root);
  const found = mainCheckoutOf(root);
  const home = dirname(found && found.main ? found.main : canonical(resolve(root)));
  if (found && found.main) HOMES.set(root, home);
  return home;
}
const nameFix = (root, name) => `the repository ${name} is not on this machine — put its checkout, or a symlink to it, at ${join(loopHome(root), name)}`;

// Where a stored value points on this machine, with no check that a repository is there: { path, name } with name null for
// a path. No value is the loop's own directory.
export function repoPlace(root, value) {
  if (value === undefined || value === '') return { path: root, name: null };
  if (repoValueKind(root, value) === 'path') return { path: resolve(root, value), name: null };
  return { path: join(loopHome(root), value), name: value };
}

// Where git runs for an issue's code. A loop may keep its issues in one repository while its workers change another;
// the issue's Repo field names it. A relative path is read from the loop's root, not the caller's directory, because
// workers, reviewers and the merger call the tool from different checkouts with the same --root. Naming nothing keeps git
// where the loop lives. A repository that resolved once resolves the same for the rest of the run: a loop of hundreds of
// issues names a handful of repositories, and each check costs two git processes. One that failed is checked again, so
// its refusal always names the current state.
const RESOLVED = new Map();
export function repoOf(root, named) {
  if (named === undefined || named === '') return root;
  need(typeof named === 'string', '--repo takes one name or path — the repository the code lives in', () => ({ flag: '--repo', value: '<name-or-path>' }));
  const key = `${root}\n${loadProfile(root).format}\n${named}`;
  if (RESOLVED.has(key)) return RESOLVED.get(key);
  const { path: repo, name } = repoPlace(root, named);
  need(isGitRepo(repo), name ? `${nameFix(root, name)} (${echoWord(repo)} is not a git repository)` : `not a git repository: ${echoWord(repo)} (a relative --repo or Repo path is read from the loop's root, ${echoWord(root)}): e.g. --repo <name-or-path>`, () => ({ replace: String(repo), value: '<name-or-path>' }));
  // A subdirectory of a repository is not the repository: the paths git reports are relative to its root, so a
  // declared file or a removed test would be read from the wrong place and go unseen.
  const top = git(repo, ['rev-parse', '--show-toplevel']);
  need(top !== null || git(repo, ['rev-parse', '--is-bare-repository']) !== 'true', `${repo} is a bare repository: it has no working tree to act on`, () => ({ replace: String(repo), value: '<name-or-path>' }));
  need(top !== null && canonical(top) === canonical(repo), name ? `${repo} is inside the repository at ${top}, not its root — ${nameFix(root, name)}` : `${repo} is inside the repository at ${top}, not its root — name the root: ${portablePath(relative(canonical(root), canonical(top || repo))) || '.'}`, () => ({ replace: String(repo), value: hole('<name-or-path>') }));
  RESOLVED.set(key, repo);
  return repo;
}

// The repository an issue's code lives in, canonical; empty when its Repo value does not resolve. Resolved once per
// spelling of the value in a run: a loop of hundreds of issues names a handful of repositories.
const REPO_OF = new Map();
function issueRepos(root, issue) {
  const key = `${root}\n${loadProfile(root).format}\n${issue.fields.repo || ''}`;
  if (!REPO_OF.has(key)) REPO_OF.set(key, issueRepoPaths(root, issue).map(canonical));
  return REPO_OF.get(key);
}
// The tip of an issue's branch: the commit its Branch points to in each repository of the issue, in order, joined by
// commas. Null when the issue records no branch, or when a repository is not here or does not hold the branch: a row or a
// verdict written then carries no tip, and the gate reads it as one that does not outlive a pause.
export function branchTip(root, issue) {
  const branch = fieldText(issue.fields.branch);
  if (!branch) return null;
  const repos = issueRepos(root, issue);
  if (!repos.length) return null;
  const shas = repos.map((r) => (isGitRepo(r) ? refsIn(r).get(branch)?.sha : undefined));
  return shas.every((s) => s && /^[0-9a-f]{7,64}$/.test(s)) ? shas.join(',') : null;
}
// The tip lines of one write about `issues`, as a function of the issue that gives the line written after its row, verdict,
// merge or close: the tip `tipOf` gives (the tip of its branch now, see branchTip), or none. Every tip is read before
// anything is written; then, when one is there, the loop is raised once to the format that holds the tip mark. A loop
// whose composer keeps its format below that one gets no tip line: the tip is off there, and the write goes on without it.
function tipLinesOf(root, issues, tipOf = (issue) => branchTip(root, issue)) {
  const tips = new Map(issues.map((issue) => [issue, tipOf(issue)]));
  const profile = [...tips.values()].some(Boolean) ? loadProfile(root) : null;
  const held = profile !== null && (profile.format >= FORMAT_LINES['tip-mark'].format || formatState(profile).raises);
  if (held) needFormat(root, 'tip-mark');
  return (issue) => (held && tips.get(issue) ? [tipLine(issue.id, tips.get(issue))] : []);
}
// The checkouts an issue's Repo field gives, as repoOf resolves them, or the loop's own repository where it names none.
// `names` stands in for the Repo field where something else names the repository (a recorded merge). A value that does
// not resolve is left out: a repository that is not on this machine is no refusal here.
function issueRepoPaths(root, issue, names = reposNamed(issue)) {
  const out = [];
  for (const n of namedRepos(names)) { try { out.push(repoOf(root, n)); } catch { /* not a repository here */ } }
  return out;
}
// The same, one place for each repository the issue names, in the order of its Repo field and canonical: a repository that
// is not on this machine keeps its place as null, so a list kept per repository (the tips of a branch) still lines up.
function issueRepoSlots(root, issue) {
  return namedRepos(reposNamed(issue)).map((n) => { try { return canonical(repoOf(root, n)); } catch { return null; } });
}
// The values to resolve: the ones given, or undefined (the loop's own repository) where there are none.
function namedRepos(names) { return names.length ? names : [undefined]; }
// The canonical places an issue's Repo values point to, resolved or not: one key for one repository.
function issuePlaces(root, issue) { return namedRepos(reposNamed(issue)).map((n) => canonical(repoPlace(root, n).path)); }
// What a repository is called wherever the tool shows one: the name of its directory.
function repoLabel(dir, fallback = dir) { return basename(String(dir).replace(/[\\/]+$/, '')) || basename(resolve(fallback)); }
// What the report and the status group an issue's repositories under: a name is its own label, a path the name of the
// directory of the repository it points into.
function repoEntries(root, issue) {
  const named = reposNamed(issue);
  if (!named.length) return [{ label: repoLabel(topOf(root)), value: undefined }];
  const seen = new Set();
  return named.map((value) => { const p = repoPlace(root, value); return { label: p.name ?? repoLabel(topOf(canonical(p.path))), value }; }).filter((e) => !seen.has(e.label) && seen.add(e.label));
}

// Raises the loop to a record format (default: RECORD_FORMAT_RAISED), before the write that needs it and under the same
// lock: .jarl/profile.json becomes the marker (jarl-profile and format only) when the loop has none, and a declared
// profile gets its "format" key set. One function, called by every write of an element a reader of a lower format would
// misread in silence; it never lowers the format, and it refuses a loop already in a format this Jarl does not read (loadProfile
// throws). A loop whose profile names an external scheduler is never raised: the write is refused, naming `what` it
// would have written, and nothing is written. Returns true when it wrote.
export function raiseFormat(root, to = RECORD_FORMAT_RAISED, what = null) {
  need(RECORD_FORMATS.includes(to), `record format ${to} is not one this Jarl writes`, () => afterView(['jarl.mjs', 'profile']));
  if (!existsSync(jarlDir(root))) return false;
  return withLock(root, () => {
    const profile = loadProfile(root);
    if (profile.format >= to) return false;
    needRaisable(profile, to, what);
    // A bare word is a path in format 1 and a name from format 2 on: only a loop in format 1 has paths to say again.
    if (profile.format < RECORD_FORMAT_RAISED) writeBarePaths(root);
    const path = profilePath(root);
    const json = existsSync(path) ? JSON.parse(readText(path)) : { 'jarl-profile': PROFILE_VERSION };
    json.format = to;
    writeAtomic(path, `${JSON.stringify(json, null, 2)}\n`);
    forgetProfile(root);
    return true;
  });
}
// Before a write of the line FORMAT_LINES names `name`, under the write's lock: the loop is raised to the line's format
// (from format 1 or 2, whichever it is in), or the write is refused where the loop's composer keeps its format;
// `what` names the write in the refusal when it is one part of the line (a field of a kind), else the line's own words do.
export function needFormat(root, name, what = null) {
  const line = lineNamed(name);
  return raiseFormat(root, line.format, what || line.what);
}
// Whether the loop holds the line of FORMAT_LINES `name` or may be raised to hold it: the refusal needFormat would make,
// made without writing, for a caller that checks a whole call before its first write.
export function needFormatHeld(root, name, what = null) {
  const line = lineNamed(name);
  if (!existsSync(jarlDir(root))) return;
  const profile = loadProfile(root);
  if (profile.format < line.format) needRaisable(profile, line.format, what || line.what);
}
function lineNamed(name) {
  const line = Object.hasOwn(FORMAT_LINES, name) ? FORMAT_LINES[name] : null;
  need(line, `${name} is not a line of the record format registry: its lines are ${Object.keys(FORMAT_LINES).join(', ')}`, () => afterView(['jarl.mjs', 'profile']));
  return line;
}

// Where a loop's directory stands among the worktrees of its git repository, read-only (git rev-parse and the
// worktrees git lists). Null outside git. `main` is the main checkout (null for a bare repository), `mainRoot` the same
// directory of the loop in it, `linked` whether `root` is inside a linked worktree rather than the main checkout, and
// `copies` the loop's directory in every worktree, the main checkout first. The one helper that finds the main checkout
// through git's own list of worktrees; the commands that must act on the main checkout's loop reuse it.
export function mainCheckoutOf(root) {
  const top = git(root, ['rev-parse', '--show-toplevel']);
  const entries = top === null ? null : worktreesOf(root);
  if (entries === null) return null;
  const here = canonical(top);
  const rel = relative(here, canonical(root));
  const main = entries.length && !entries[0].bare ? canonical(entries[0].path) : null;
  return {
    main, mainRoot: main === null ? null : join(main, rel), linked: main !== null && main !== here,
    copies: entries.filter((e) => !e.bare).map((e) => join(canonical(e.path), rel)),
  };
}

// The one lookup of a worktree's state, asked of git first (the worktrees git lists in `repo`). It finds the worktree
// holding the lease's `branch`, and, for a lease that stored a path, the worktree at `stored`. The states:
//   here       the worktree's directory is on this machine;
//   elsewhere  git lists it locked (`reason` when it has one) and its directory is not visible from here — a container's;
//   invisible  git lists it but its directory is not visible from here: not marked prunable, or prunable with its parent
//              directory missing too (a whole directory tree on another machine) — not gone;
//   gone       its directory is missing while the parent directory is here: removed under a live lease;
//   none       no worktree holds the branch (and `stored`, when given, is neither listed nor a directory here).
// The fallback for a stored path git does not list: a directory here is `here`, a missing one with an existing parent is
// `gone`, a missing one whose parent is missing too is `invisible`. Returns { state, path, reason? }; `path` is null for none.
export function worktreeState(repo, branch, stored) {
  const sameAs = (a, b) => canonical(dirname(a)) === canonical(dirname(b)) && basename(a) === basename(b);
  const entries = (repo && worktreesOf(repo)) || [];
  const found = (branch && entries.find((e) => e.branch === branch)) || (stored && entries.find((e) => sameAs(e.path, stored)));
  if (found) {
    if (existsSync(found.path)) return { state: 'here', path: found.path };
    if (found.locked) return { state: 'elsewhere', path: found.path, ...(found.reason ? { reason: found.reason } : {}) };
    if (found.prunable && existsSync(dirname(found.path))) return { state: 'gone', path: found.path };
    return { state: 'invisible', path: found.path };
  }
  if (!stored) return { state: 'none', path: null };
  if (existsSync(stored)) return { state: 'here', path: stored };
  return { state: existsSync(dirname(stored)) ? 'gone' : 'invisible', path: stored };
}

export function fileAt(root, issue, written) {
  // However it is spelled, a path is one key (see normalPath).
  const declared = normalPath(written);
  const named = splitList(issue.fields.repo);
  if (!named.length) return { repo: root, path: declared };
  // Several repositories: the one whose name the entry starts with; an entry that starts with none of them is
  // a path in the first one named.
  for (const r of named) { const hit = prefixedIn(root, r, declared); if (hit) return hit; }
  return { repo: canonical(repoPlace(root, named[0]).path), path: declared };
}

// The files an issue declares as (repository, path) pairs, each with its key: the same path in two repositories is two
// keys, the same file in one repository one key, however its Repo path is spelled. next and the lease compare these.
export function fileKeysOf(root, issue) {
  return issue.files.map((f) => { const at = fileAt(root, issue, f); return { f, key: `${at.repo}\n${at.path}` }; });
}

function prefixedIn(root, named, declared) {
  const spelled = repoPlace(root, named).path;
  const repo = canonical(spelled);
  // The name written in front of a path is the repository's own directory name, or the name its Repo path
  // spells (a symlink or another case of it): either reads as the same prefix.
  const names = [...new Set([basename(repo), basename(spelled)].filter(Boolean))];
  for (const name of names) {
    let inner = false;
    try { inner = statSync(join(repo, name)).isDirectory(); } catch { inner = false; }
    if (inner) { if (declared.startsWith(`${name}/${name}/`)) return { repo, path: declared.slice(name.length + 1) }; continue; }
    if (declared.startsWith(`${name}/`)) return { repo, path: declared.slice(name.length + 1) };
  }
  return null;
}

// The repositories an issue names, as written: its Repo field, names and paths as a comma list. Empty for an issue
// whose code lives in the loop's own repository.
export function reposNamed(issue) { return splitList(issue.fields.repo); }

// The worktrees of the repository `dir` is in, as `git worktree list --porcelain` gives them: { path, branch (null when detached), bare, locked,
// reason (of the lock), prunable }, the main checkout first. Null where git does not answer. The one place the list is
// split into entries. The first entry of a repository kept in a submodule is git's own directory for it (inside the
// superproject's .git), not a working tree: its working tree is the directory its core.worktree names, and one without
// that setting has none (bare). The list is read with -z, each attribute ended by a NUL and each entry by one more, so a
// path that holds a line break is read whole; a git that does not know -z there gives the list with line ends.
function worktreesOf(dir) {
  const z = git(dir, ['worktree', 'list', '--porcelain', '-z']);
  const text = z === null ? git(dir, ['worktree', 'list', '--porcelain']) : null;
  if (z === null && text === null) return null;
  const blocks = z !== null ? z.split('\0\0').map((b) => b.split('\0')) : text.split(/\n\s*\n/).map((b) => b.split('\n'));
  // The value of an attribute: the text after its name and a space, '' for a name alone, undefined when absent.
  const value = (lines, name) => { const l = lines.find((x) => x === name || x.startsWith(`${name} `)); return l === undefined ? undefined : l.slice(name.length + 1); };
  return blocks.map((lines) => ({
    path: value(lines, 'worktree') || undefined, branch: /^refs\/heads\/(.+)$/s.exec(value(lines, 'branch') ?? '')?.[1] || null, bare: lines.includes('bare'),
    locked: value(lines, 'locked') !== undefined, reason: value(lines, 'locked') || undefined, prunable: value(lines, 'prunable') !== undefined,
  })).filter((e) => e.path).map((e, k) => {
    if (k !== 0 || e.bare || !existsSync(join(e.path, 'HEAD')) || existsSync(join(e.path, '.git'))) return e;
    const tree = git(e.path, ['config', '--get', 'core.worktree']);
    return tree ? { ...e, path: resolve(e.path, tree) } : { ...e, bare: true };
  });
}

// Read once per run: whether a directory is in a git repository, and every local branch of a repository with its
// tip, upstream (null when none is set or its remote branch is gone), ahead/behind against that upstream and the
// time of its last commit — one git process per repository instead of several per branch, which is what keeps the
// read-only views (status, tips, resume) fast on a loop of hundreds of issues. jarl moves a ref only in the cleanup
// that ends a recorded merge, after which the command is over, so nothing read here goes stale while it runs. The caches live for one command: dispatch empties them (resetCaches) before
// each one. Only what was found is kept — a directory that is not a repository, like a Repo path that did not
// resolve, is asked again, so a refusal always names the current state.
const IS_REPO = new Set();

function isGitRepo(dir) {
  if (IS_REPO.has(dir)) return true;
  const ok = git(dir, ['rev-parse', '--git-dir']) !== null;
  if (ok) IS_REPO.add(dir);
  return ok;
}

const REFS = new Map();

export function refsIn(repo) {
  if (REFS.has(repo)) return REFS.get(repo);
  const map = new Map();
  const out = git(repo, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(committerdate:unix)', 'refs/heads']);
  for (const line of (out || '').split('\n').filter(Boolean)) {
    const [ref, sha, up, track, ct] = line.split('\0');
    const gone = track === 'gone';
    map.set(ref.replace(/^refs\/heads\//, ''), {
      sha, upstream: up && !gone ? up : null,
      ahead: up && !gone ? Number(/ahead (\d+)/.exec(track)?.[1] || 0) : null,
      behind: up && !gone ? Number(/behind (\d+)/.exec(track)?.[1] || 0) : null,
      committedMs: Number(ct) * 1000 || null,
    });
  }
  REFS.set(repo, map);
  return map;
}

// The fetched refs of a branch in a clone: <remote>/<branch> for each remote of the clone that has one, as last fetched,
// each with the commit time of its tip. Jarl never fetches: a commit another clone pushed is seen only once this clone
// fetched it.
const FETCHED = new Map();
export function fetchedRefs(repo, branch) {
  if (!FETCHED.has(repo)) {
    const map = new Map();
    const out = git(repo, ['for-each-ref', '--format=%(refname)%00%(committerdate:unix)', 'refs/remotes']);
    for (const line of (out || '').split('\n').filter(Boolean)) {
      const [ref, ct] = line.split('\0');
      map.set(ref.replace(/^refs\/remotes\//, ''), Number(ct) * 1000 || null);
    }
    FETCHED.set(repo, { map, remotes: (git(repo, ['remote']) || '').split('\n').map((r) => r.trim()).filter(Boolean) });
  }
  const { map, remotes } = FETCHED.get(repo);
  return remotes.map((r) => `${r}/${branch}`).filter((ref) => map.has(ref)).map((ref) => ({ ref, committedMs: map.get(ref) }));
}

function defaultBase(root) {
  return git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'HEAD';
}

// A directory's repository, as one key: the canonical root of the git repository holding it, so a loop kept in a
// subdirectory and a Repo path naming that repository's root (../../..) are one repository, not two.
const TOP_OF = new Map();

function topOf(dir) {
  if (!TOP_OF.has(dir)) TOP_OF.set(dir, canonical(git(dir, ['rev-parse', '--show-toplevel']) || dir));
  return TOP_OF.get(dir);
}

// The repository an issue's work counts under in the report: the directory name of each repository it names,
// or the loop's own.
function repoNames(root, issue) { return repoEntries(root, issue).map((e) => e.label); }

// ---- what a person or a tool names a repository by, and what is stored

// A remote url as the record spells it: host and path, with no scheme, credentials or .git; null for a local path.
export function originSpelling(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return null;
  const full = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(raw);
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(raw);
  const m = full ?? (scp && !/^[A-Za-z]:[\\/]/.test(raw) ? scp : null);
  return m ? noSeparators(`${m[1]}/${m[2].replace(/\/+$/, '').replace(/\.git$/, '')}`) : null;
}
// The root commits reachable from `ref` in the checkout `dir`, sorted; null when the checkout is shallow, which cannot
// show them. The one place the roots are read.
function rootsOf(dir, ref = 'HEAD') {
  if (git(dir, ['rev-parse', '--is-shallow-repository']) === 'true') return null;
  const out = git(dir, ['rev-list', '--max-parents=0', ref]);
  return out === null ? [] : out.split('\n').filter(Boolean).sort();
}
// The path to a main checkout from the loop's root, written so that a format-2 loop reads it as a path.
function pathTo(root, main) {
  const rel = portablePath(relative(canonical(root), main));
  if (rel === '') return '.';
  if (isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return main;
  return PATH_START.test(rel) ? rel : `./${rel}`;
}

// What a person or a tool gives for a repository — a name, a checkout, a worktree of it or a file inside it — reduced to
// its main checkout through git's list of worktrees: { main, name, value, note }. `value` is what Repo stores: the name
// when the checkout sits where the convention looks for it, else the path (with a note saying why, so two repositories
// that share a directory name stay apart). Writes nothing.
export function repoFromInput(root, raw) {
  need(typeof raw === 'string' && raw.trim() !== '', '--repo takes a repository: its name, its checkout, a worktree of it or a file inside it', () => ({ flag: '--repo', value: '<name-or-path>' }));
  const given = portablePath(raw.trim());
  need(!/[\r\n]/.test(given) && !given.includes(' · '), `--repo ${JSON.stringify(given)} is on more than one line or holds the log's separator: a repository is one name or one path`, () => ({ replace: String(given), value: '<name-or-path>' }));
  const word = !PATH_START.test(given);
  need(!word || REPO_NAME_RE.test(given), `${JSON.stringify(given)} is neither a path (it starts with . or /) nor a repository name (letters, digits, - _ and . inside)`, () => ({ replace: String(given), value: '<name-or-path>' }));
  const home = loopHome(root);
  const spelled = word ? join(home, given) : resolve(root, given);
  // Only a directory, or an existing file (reduced to the directory it is in), names a repository: a path that is not
  // there is refused, never read as the repository around it.
  let kind = null;
  try { const st = statSync(spelled); kind = st.isDirectory() ? 'dir' : st.isFile() ? 'file' : null; } catch { kind = null; }
  need(kind !== null || word, `not a git repository: ${echoWord(spelled)} does not exist (--repo ${JSON.stringify(given)}) — give the repository's name, its checkout, a worktree of it or a file inside it`, () => ({ replace: String(given), value: '<name-or-path>' }));
  const isDir = kind === 'dir';
  const inside = isDir ? spelled : kind === 'file' ? dirname(spelled) : spelled;
  const underRoot = isGitRepo(resolve(root, given)) ? `; ./${given} is a repository under the loop's root — a path is written with a leading ./` : '';
  need(isGitRepo(inside), word ? `${nameFix(root, given)} (${echoWord(spelled)} is not a git repository${underRoot}), or name another: e.g. --repo <name-or-path>` :`not a git repository: ${echoWord(spelled)} (a relative --repo or Repo path is read from the loop's root, ${echoWord(root)})`, () => ({ replace: String(given), value: '<name-or-path>' }));
  const main = (mainCheckoutOf(inside) || {}).main ?? null;
  need(main !== null, `${inside} is a bare repository: it has no working tree to act on`, () => ({ replace: String(given), value: '<name-or-path>' }));
  const candidates = [word ? given : null, isDir ? basename(spelled) : null, basename(main)];
  let name = candidates.find((n, k) => n && REPO_NAME_RE.test(n) && candidates.indexOf(n) === k && canonical(join(home, n)) === main);
  // A loop Jarl never raises (its profile names an external scheduler) stays below the format that holds a name: a
  // repository given by its path keeps its path there, and one given by its name only is refused when it is written.
  const profile = loadProfile(root);
  const keepsPath = !word && Boolean(name) && profile.format < RECORD_FORMAT_RAISED && !formatState(profile).raises;
  if (name && !keepsPath) {
    // A disk that ignores case reads TOOL as tool: one repository has one name, the declared spelling or else the directory's own.
    const same = (n) => n.toLowerCase() === name.toLowerCase();
    name = [...declaredRepos(root).keys()].find((d) => same(d) && canonical(join(home, d)) === main) ??(same(basename(main)) ? basename(main) : name);
    return { main, name, value: name, note: null };
  }
  const exact = isDir && canonical(spelled) === main;
  const value = exact ? given : pathTo(root, main);
  const place = join(home, basename(main));
  const occupied = existsSync(place) && canonical(place) !== main;
  const why = `${exact ? '' : `${given} is reduced to its main checkout; `}${keepsPath ? `the loop's profile names an external scheduler, so its record format stays at ${profile.format}, which holds paths and no names` : occupied ? `another repository stands at ${place}, where its name would resolve, so this one keeps its path` : `the checkout is not at ${place}, where a name would resolve — put it, or a symlink to it, there to name it`}`;
  const reason = keepsPath ? 'profile' : occupied ? 'occupied' : 'elsewhere';
  // The note is read when a caller asks for it, so a call that only reads the repository never looks at the log.
  const found = { main, name: null, value, reason };
  let note;
  Object.defineProperty(found, 'note', {
    enumerable: true,
    get: () => (note === undefined ? (note = notedPath(root, main, reason) ? null : `${given} is stored as the path ${value}: ${why}`) : note),
    set: (text) => { note = text; },
  });
  return found;
}
// The log line that records a note on a path was said, and the reason it gave: a later filing of the same checkout by its
// path is silent while its reason is the same, and says its note again when the reason is another.
const PATH_NOTED = /^- \d{4}-\d\d-\d\d \d\d:\d\d(?: key \S+)?(?: by [^·]+)? · repo path (.+) noted · (profile|occupied|elsewhere)$/;
const pathNotedLine = (value, reason) => `repo path ${noSeparators(value)} noted · ${reason}`;
// Whether the log holds a note on this checkout stored as a path for this reason. Only the log is read.
function notedPath(root, main, reason) {
  const log = logPath(jarlDir(root));
  if (!existsSync(log)) return false;
  const place = canonical(main);
  return readText(log).split('\n').some((line) => {
    const m = PATH_NOTED.exec(line);
    return m !== null && m[2] === reason && canonical(resolve(root, m[1])) === place;
  });
}
// The values of a --repo list (one name or path, or several as one comma list), each read by repoFromInput.
function repoList(root, v) {
  need(typeof v === 'string', '--repo takes one name or path, or several as one comma list', () => ({ flag: '--repo', value: '<name-or-path>' }));
  const items = splitList(v);
  need(items.length, '--repo needs a name or a path', () => ({ flag: '--repo', value: '<name-or-path>' }));
  return items.map((item) => repoFromInput(root, item));
}

// Every raise of the record format (raiseFormat, whatever triggers it) first writes each bare-word path a format-1 loop
// holds as ./<word>: the same place said so that format 2 does not read it as a name. The values are the Repo field of
// every issue, the repository after "in" in a Merged field, and the same after "in" in the log's merge lines, which
// the header is read against. A value that already starts with a dot, a slash or a drive letter is left as it is, so the
// rewrite is idempotent. Called under the lock, before the marker is written.
const BARE_REPO_LINE = /^(\*\*Repo:\*\* )(.*)$/m;
const BARE_MERGED_FIELD = /^(\*\*Merged:\*\* \S+ in )(.+)$/m;
const dotted = (v) => (PATH_START.test(v) ? v : `./${v}`);
function writeBarePaths(root) {
  const dir = issuesDir(root);
  const rewritten = [];
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    const m = ISSUE_FILE_RE.exec(f);
    if (!m) continue;
    const text = readText(join(dir, f));
    const next = text
      .replace(BARE_REPO_LINE, (all, head, value) => `${head}${splitList(value).map(dotted).join(', ')}`)
      .replace(BARE_MERGED_FIELD, (all, head, value) => `${head}${dotted(value.trim())}`);
    if (next === text) continue;
    writeAtomic(join(dir, f), next);
    rewritten.push(m[1]);
  }
  mapMergeRepos(root, dotted);
  if (rewritten.length) appendLog(root, `repo paths written as ./ and the name in ${rewritten.join(', ')} · the record format is raised`);
}
// The names among the repositories read from a --repo list are declared (once), after the format is raised.
function commitRepoNames(root, picked) {
  // A path whose note is said now is logged with its reason, so the note is not said again for it.
  const said = picked.filter((p) => !p.name && p.note);
  if (!picked.some((p) => p.name) && !said.length) return;
  withLock(root, () => {
    if (said.length) appendLogLines(root, said.map((p) => pathNotedLine(p.value, p.reason)));
    if (!picked.some((p) => p.name)) return;
    needFormat(root, 'repo-name');
    for (const p of picked) if (p.name && declareRepo(root, p.name, p.main) === 'no-base') p.note =`${p.name} has no branch checked out, so it is declared with no base — name one with ${jarlLine('base', p.name, '<branch>')}`;
  });
}

// ---- the declarations in .jarl/repos.md

export const REPOS_HEADER = '# Repositories\n\nEach line declares a repository that an issue names by name: its root commits, its origin as found, its base branch, and no path. Jarl writes this file and nothing else does. A name stands for the checkout beside the main checkout of the loop.\n\n';
const declarationText = (e) => `roots ${e.roots === null ? 'unknown' : e.roots.length ? e.roots.join(', ') : 'none'} · origin ${e.origin ?? 'none'} · base ${e.base ?? 'none'}`;
// The file the declarations are written in, as a message names it.
export const REPOS_DECLARED_IN = `.jarl/${REPOS_FILE}`;
// The names declared in the loop, in the order written.
export function declaredNames(root) { return [...declaredRepos(root).keys()]; }
// name → { name, roots (null when the checkout was shallow), origin (null when none), base }, in the order written.
export function declaredRepos(root) {
  const out = new Map();
  if (!existsSync(reposPath(root))) return out;
  for (const line of readText(reposPath(root)).split('\n')) {
    const m = /^- \*\*([A-Za-z0-9_][A-Za-z0-9._-]*)\*\* · (.*)$/.exec(line);
    if (!m) continue;
    const parts = new Map(m[2].split(' · ').map((s) => { const k = s.indexOf(' '); return k < 0 ? [s, ''] : [s.slice(0, k), s.slice(k + 1)]; }));
    const roots = parts.get('roots');
    const origin = parts.get('origin');
    out.set(m[1], { name: m[1], roots: roots === undefined || roots === 'unknown' ? null : roots === 'none' ? [] : roots.split(', '), origin: origin && origin !== 'none' ? origin : null, base: parts.get('base') && parts.get('base') !== 'none' ? parts.get('base') : null });
  }
  return out;
}
// The branch a repository is held against: the base its declaration names, when the checkout `dir` is the one a declared
// name stands for and the branch exists there, else null (the branch the checkout has open is then the only base known).
export function declaredBaseOf(root, dir) {
  const real = canonical(dir);
  for (const entry of declaredRepos(root).values()) {
    if (!entry.base || canonical(repoPlace(root, entry.name).path) !== real) continue;
    return git(dir, ['rev-parse', '--verify', '--quiet', `${entry.base}^{commit}`]) !== null ? entry.base : null;
  }
  return null;
}
// The one base a merge is judged against, by the merge note, the cleanup after it and the done gate alike: the declared
// base (see declaredBaseOf), else the branch the checkout `dir` has open (HEAD where it has none open).
export function baseOf(root, dir) { return declaredBaseOf(root, dir) ?? defaultBase(dir); }
function writeDeclarations(root, entries) {
  writeAtomic(reposPath(root), `${REPOS_HEADER}${entries.map((e) => `- **${e.name}** · ${declarationText(e)}`).join('\n')}\n`);
}
// Declares `name` for the checkout `main` once: its root commits, its origin as found and the branch it has checked out as
// its base. The log line goes first. True when it wrote.
function declareRepo(root, name, main) {
  const known = declaredRepos(root);
  if (known.has(name)) return false;
  // A checkout with no branch checked out (detached) is declared with no base.
  const current = noSeparators(defaultBase(main));
  const base = current === 'HEAD' ? null : current;
  const entry = { name, roots: rootsOf(main, base ?? 'HEAD'), origin: originSpelling(git(main, ['remote', 'get-url', 'origin'])), base };
  appendLog(root, `repo ${name} declared · ${declarationText(entry)}`);
  writeDeclarations(root, [...known.values(), entry]);
  return base === null ? 'no-base' : true;
}

// base <name> <branch>: changes the base of a declared repository, with a log line that says what it was.
export function cmdRepoBase(root, name, branch) {
  need(name !== undefined && branch !== undefined, 'base takes a repository name and a branch', () => [...(name === undefined ? [{ arg: 0, value: '<name>' }] : []), { arg: 1, value: '<branch>' }]);
  const known = declaredRepos(root);
  // A loop that declares none takes the step that declares one first, on a line of its own: no name is a base's before it.
  need(known.has(name), `${name} is not declared in this loop${known.size ? ` — it declares ${[...known.keys()].join(', ')}, names written as declared` : ''}; Jarl declares a repository the first time an issue names it (${jarlLine('field', hole('<id>'), 'Repo', hole('<name-or-path>'))})`, () => (known.size ? { arg: 0, value: hole('<name>') } : [{ first: ['jarl.mjs', 'field', hole('<id>'), 'Repo', hole('<name-or-path>')] }, { arg: 0, value: hole('<name>') }]));
  const base = fieldText(branch);
  need(base && !/[\r\n]/.test(String(branch)) && !base.includes(' · '), 'the base is one branch name on one line', () => ({ replace: String(branch), value: '<branch>' }));
  const problem = branchNameProblem(base);
  need(!problem, `${JSON.stringify(base)} ${problem}`, () => ({ replace: String(branch), value: '<branch>' }));
  const was = known.get(name).base;
  if (was === base) return { name, base, was, unchanged: true };
  appendLog(root, `repo ${name} base · was ${was ?? 'none'} · now ${base}`);
  writeDeclarations(root, [...known.values()].map((e) => (e.name === name ? { ...e, base } : e)));
  return { name, base, was, unchanged: false };
}

// ---- the identity of a declared repository, against the checkout on this machine

// Whether the checkout a name resolves to is the repository the declaration names: { name, state, path, roots, found, notes,
// fix }. The states: undeclared (no declaration), missing (nothing is there; `fix` says where to put it), verified (the
// checkout has a root commit the declaration holds), mismatch (it has none: another repository stands there; `fix`
// says so) and unverified (a shallow checkout cannot show its roots, or the declaration was made from one). A different
// origin is a note and never changes the state. This is the check verify reports; no other command reads the roots.
export function repoIdentity(root, name) {
  const declared = declaredRepos(root).get(name);
  const { path } = repoPlace(root, name);
  const out = { name, state: 'undeclared', path, roots: declared ? declared.roots : null, found: null, notes: [] };
  if (!declared) return out;
  try { repoOf(root, name); } catch (e) { return { ...out, state: 'missing', fix: nameFix(root, name), notes: [String(e.message)] }; }
  const found = rootsOf(path, declared.base && git(path, ['rev-parse', '--verify', '--quiet', `${declared.base}^{commit}`]) !== null ? declared.base : 'HEAD');
  const origin = originSpelling(git(path, ['remote', 'get-url', 'origin']));
  if (declared.origin && origin && declared.origin !== origin) out.notes.push(`its origin is ${origin}, the declaration holds ${declared.origin} (a fork or a renamed repository)`);
  out.found = found;
  if (found === null) return { ...out, state: 'unverified', notes: [...out.notes, 'a shallow checkout cannot show its root commits'] };
  if (declared.roots === null) return { ...out, state: 'unverified', notes: [...out.notes, 'the declaration was made from a shallow checkout and holds no root commits'] };
  if (found.length === 0 || declared.roots.length === 0) return { ...out, state: 'unverified', notes: [...out.notes, 'a repository with no commit has no root commit to compare'] };
  if (found.some((r) => declared.roots.includes(r))) return { ...out, state: 'verified' };
  return { ...out, state: 'mismatch', fix: `${path} is another repository than ${name} (its root commits are ${found.join(', ') || 'none'}, the declaration holds ${declared.roots.join(', ')}) — put the checkout of ${name}, or a symlink to it, there` };
}

// A command that acts on a repository acts only on the one it names. A value written as a name that does not resolve to
// a repository on this machine is refused with its fix (the views mark it and go on), and so is one whose checkout holds
// none of the declared root commits: that is another repository.
export function needRightCheckouts(root, values) {
  for (const value of new Set(values)) {
    if (repoValueKind(root, value) !== 'name') continue;
    repoOf(root, value);
    const found = repoIdentity(root, value);
    need(found.state !== 'mismatch', found.fix, () => afterView(['jarl.mjs', 'verify']));
  }
}
// Why nothing may be deleted in the checkout `repo`, or null: it stands under a name (one of `values`) whose root commits
// were not compared and found equal. A checkout that is unverified (shallow, or declared from a shallow one), another
// repository, or under an undeclared name keeps everything.
export function whyNotDeletable(root, repo, values) {
  for (const value of new Set(values)) {
    if (repoValueKind(root, value) !== 'name' || canonical(repoPlace(root, value).path) !== canonical(repo)) continue;
    const found = repoIdentity(root, value);
    if (found.state !== 'verified') return `the checkout under the name ${value} is ${found.state === 'mismatch' ? 'another repository' : `not verified as that repository (${found.state}${found.notes.length ? `: ${found.notes[0]}` : ''})`}, so nothing is deleted in it`;
  }
  return null;
}

// ---- where the repositories and the worktree of a lease are on this machine

// The repositories an issue names and the worktree git has on its lease's branch in each of them, read from git and the
// file system and never stored. A repository: { value, name, path, state (here | missing), fix? }. A worktree: { repo,
// branch, state (here | elsewhere | invisible | gone | none), path, reason? }, for a lease that stores no worktree path.
export function whereOf(root, issue) {
  const repos = reposNamed(issue).map((value) => {
    const place = repoPlace(root, value);
    try { repoOf(root, value); return { value, name: place.name, path: place.path, state: 'here' }; }
    catch (e) { return { value, name: place.name, path: place.path, state: 'missing', fix: place.name ? nameFix(root, place.name) : String(e.message) }; }
  });
  const worktrees = [];
  const f = issue.fields;
  if (loadProfile(root).is(issue.status, 'holds-claim') && f.branch && !f.worktree) {
    for (const dir of issueRepoPaths(root, issue)) {
      if (!isGitRepo(dir)) continue;
      const ws = worktreeState(dir, f.branch, undefined);
      worktrees.push({ repo: repoLabel(dir), branch: f.branch, state: ws.state, path: ws.path, ...(ws.reason ? { reason: ws.reason } : {}) });
    }
  }
  return { repos, worktrees };
}
const WORKTREE_STATE_TEXT = { here: '', gone: ' (gone)', invisible: ' (listed by git, not visible from here)' };
// The lines show prints under the header: where each repository written as a name is, and the worktree of the lease. A
// repository written as a path says nothing: its value is the place.
export function whereLines(where) {
  const lines = [];
  for (const r of where.repos) {
    if (!r.name) continue;
    lines.push(r.state === 'here' ? `repository ${r.name} is at ${r.path}` : r.fix);
  }
  for (const w of where.worktrees) {
    lines.push(w.state === 'none' ? `no worktree of ${w.repo} holds ${w.branch}` : `worktree of ${w.repo} on ${w.branch}: ${w.path}${w.state === 'elsewhere' ? ` (elsewhere${w.reason ? `: ${w.reason}` : ''})` : WORKTREE_STATE_TEXT[w.state] ?? ''}`);
  }
  return lines;
}
// For status --by repo: each repository the issues name, where its checkout is, and for a declared one its base and
// whether the checkout is on it (a warning only). Keyed by the label the status groups by.
export function reposWhere(root, issues) {
  const declared = declaredRepos(root);
  const out = {};
  for (const issue of issues) {
    for (const { label, value } of repoEntries(root, issue)) {
      if (out[label]) continue;
      const place = repoPlace(root, value);
      let dir = null;
      try { dir = repoOf(root, value); } catch { dir = null; }
      const base = place.name ? declared.get(place.name)?.base ?? null : null;
      const current = dir ? git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']) : null;
      out[label] = { name: place.name, path: place.path, state: dir ? 'here' : 'missing', ...(dir ? {} : { fix: place.name ? nameFix(root, place.name) : `${place.path} is not a git repository` }), base, current, onBase: base && current ? current === base : null };
    }
  }
  return out;
}
export function reposWhereLines(where) {
  return Object.entries(where).map(([label, w]) => {
    if (w.state === 'missing') return `  ${label}  ${w.fix}`;
    const on = w.onBase === false ? ` · WARNING: its checkout is on ${w.current}, not on its base` : w.current ? ` · on ${w.current}` : '';
    return `  ${label}  ${w.path}${w.base ? ` · base ${w.base}` : ''}${on}`;
  });
}

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { FETCHED, HOMES, IS_REPO, REFS, REPO_OF, RESOLVED, TOP_OF, commitRepoNames, defaultBase, isGitRepo, issuePlaces, issueRepoPaths, issueRepoSlots, issueRepos, repoLabel, repoList, repoNames, tipLinesOf, topOf, worktreesOf };
