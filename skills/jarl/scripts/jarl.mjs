#!/usr/bin/env node
// jarl.mjs — the one tool the jarl skill's state moves through.
//
// Markdown is the source of truth: .jarl/goal.md, .jarl/decisions.md, .jarl/log.md and one
// .jarl/issues/NNN-slug.md per issue. This script only reads and writes those files, so anything
// it does can be checked by opening them. Zero dependencies, Node 18+.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATUSES = ['open', 'in-progress', 'done', 'dropped', 'deferred'];
export const KINDS = ['bug', 'gap', 'cleanup', 'docs', 'test', 'research', 'process'];
export const PRIORITIES = ['1', '2', '3'];
export const TIERS = ['standard', 'strong'];
export const ASK_KINDS = ['stop', 'stuck', 'lower', 'charter'];
const ROUNDS_BEFORE_TAKEOVER = 3;

const USAGE = `usage: jarl.mjs <command> [options]

commands:
  init "<goal>" [--committed] [--permanent]      create .jarl/ with the goal; by default it also writes .jarl/.gitignore
                                                 (* and **/*) so git never sees the loop, and every role working
                                                 outside the main checkout passes --root <main checkout>;
                                                 --committed writes no .gitignore: the loop is committed with the work;
                                                 --permanent also writes no .gitignore, marks the loop with
                                                 .jarl/.permanent, and is not tied to a feature branch: close (below)
                                                 keeps the directory instead of removing it
  new "<title>" [--kind k] [--prio 1|2|3] [--tier standard|strong] [--tags a,b] [--files p,q] [--repo <path>] [--found-by who]
                                                 file an issue under the next free number; --repo names the repository
                                                 its code lives in when that is not the loop's own (see --repo below)
  evidence <id> "<text>" | --ran "<command>" --saw "<what it printed>"
                                                 append a free-text note, or one checkable row per --ran/--saw pair (repeatable)
  list [--status s] [--kind k] [--tag t] [--prio p] [--grep re] [--all]
                                                 open and in-progress by default; --all for every status
  show <id>                                      print one issue
  set <id> <status> "<why>"                      change status; writes the log line in the same move
  tag <id> +a -b ...                             add and remove tags
  prio <id> 1|2|3                                set priority
  files <id> p,q,...                             declare the files the issue touches
  repo <id> <path>                               name the repository the issue's code lives in
  next [--limit n]                               open issues that do not share a file with any in-progress one;
                                                 a file is its repository and its path (see --repo below)
  review <id> approve|changes "<findings>"     the reviewer's verdict; "done" needs an approve newer than the last round
  round <id> "<what failed>"                     one red round; after three prints the takeover block for a fresh worker
  check <id> --branch <b> [--base <feature-branch>] [--repo <path>]
                                                 commits beyond the base, diff inside the declared files, and the
                                                 change in test files and assertions — numbers, never a verdict;
                                                 read in --repo, else the issue's Repo, else the loop's own repository
  branches [--base <feature-branch>] [--repo <path>]
                                                 every jarl/NNN-* branch: commits beyond the base, worktree state;
                                                 read in --repo, else the loop's own repository
  ask "<question>" [--kind stop|stuck|lower|charter] [--target x] [--issue NNN]
                                                 a question the user has to answer; lower needs --target;
                                                 listed at boot until answered
  answer <id> "<answer>"                         records the answer as a ruling and closes the question
  handoff write --summary "<s>" [--next "<n>"]... | read
                                                 the state of intent between sessions; the header records the loop's
                                                 head and the head of every repository an unfinished issue names
  log "<event>"                                  append one dated line to the journal
  decide <slug> "<ruling>"                       append a ruling; refuses a duplicate slug
  status                                         one line: open, in flight, done, dropped, deferred, open questions
  report                                         what was done, dropped, deferred and found — ready for the changelog
  mode permanent                                 switch an existing committed loop to the permanent mode, with a
                                                 log line; refuses a default-mode loop (out of git — a permanent
                                                 record must be committed) and an already-permanent one
  close [--force]                                refuse while anything is open or in progress; else remove .jarl/
                                                 — a permanent loop (see init --permanent, or mode permanent) is
                                                 kept instead: it logs the close and the directory stays as the record

options: --json  --help  --root <repo root>

--repo <path>: the checkout of another repository, for a loop that keeps its issues in one repository
while its workers change another. Branches, the base (that checkout's current branch), diffs and
assertions are then read there. A relative path is read from the loop's root (the directory holding
.jarl/), so it means the same from any worktree. An issue that names a repository writes each of its
files with that repository's directory name first (tool/src/a.mjs for Repo ../tool): next then keeps
the same path in two repositories apart, and check matches the path after the name.`;

// ---- where -------------------------------------------------------------------------------------

// The checkout a run belongs to: the nearest directory with a `.git`. In the default mode the loop is out of
// git and lives only in the main checkout, which a worktree cannot see; so when that directory is a worktree
// (its `.git` is a file) that holds no loop of its own, and the repository's main checkout does, the main
// checkout is the root. An explicit --root never comes through here.
export function findRoot(from = process.cwd()) {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return mainCheckoutWithLoop(dir) || dir;
    const up = dirname(dir);
    if (up === dir) return resolve(from);
    dir = up;
  }
}
function mainCheckoutWithLoop(dir) {
  if (existsSync(jarlDir(dir))) return null;
  let common;
  try {
    common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch { return null; }
  const commonDir = resolve(dir, common);
  const main = basename(commonDir) === '.git' ? dirname(commonDir) : null;
  return main && main !== dir && existsSync(jarlDir(main)) ? main : null;
}
export function jarlDir(root) { return join(root, '.jarl'); }
export function issuesDir(root) { return join(jarlDir(root), 'issues'); }

function today() { return new Date().toISOString().slice(0, 10); }
function stamp() { return new Date().toISOString().replace('T', ' ').slice(0, 16); }

// ---- issues ------------------------------------------------------------------------------------

// Letters Unicode does not decompose into a base letter and an accent (ł, ø, đ, ß, æ, þ...) would be
// dropped as punctuation and leave a hole in the name ("gałęzi" -> "ga-ezi"), so they are spelled out first.
const UNDECOMPOSED = {
  'ł': 'l', 'ø': 'o', 'đ': 'd', 'ð': 'd', 'ħ': 'h', 'ı': 'i', 'ŧ': 't', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'þ': 'th',
};
export function slugify(title) {
  return title.toLowerCase().replace(/[łøđðħıŧßæœþ]/g, (c) => UNDECOMPOSED[c]).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'issue';
}

const FIELD_RE = /^\*\*([A-Za-z ]+):\*\*\s*(.*)$/;

export function parseIssue(text, file) {
  const lines = text.split('\n');
  const head = /^#\s+(\d{3})\s+·\s+(.*)$/.exec(lines[0] || '');
  const issue = { file, id: head ? head[1] : null, title: head ? head[2].trim() : '', fields: {}, sections: {} };
  let section = null;
  for (const line of lines.slice(1)) {
    const f = FIELD_RE.exec(line);
    if (f && section === null) { issue.fields[f[1].toLowerCase()] = f[2].trim(); continue; }
    const h = /^##\s+(.*)$/.exec(line);
    if (h) { section = h[1].trim().toLowerCase(); issue.sections[section] = ''; continue; }
    if (section !== null) issue.sections[section] += line + '\n';
  }
  issue.status = issue.fields.status || 'open';
  issue.kind = issue.fields.kind || '';
  issue.priority = issue.fields.priority || '2';
  issue.tier = issue.fields.tier || 'standard';
  issue.tags = (issue.fields.tags || '').split(',').map((s) => s.trim()).filter(Boolean);
  issue.files = (issue.fields.files || '').split(',').map((s) => s.trim()).filter(Boolean);
  return issue;
}

export function loadIssues(root) {
  const dir = issuesDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^\d{3}-.*\.md$/.test(f)).sort()
    .map((f) => parseIssue(readFileSync(join(dir, f), 'utf8'), join(dir, f)));
}

export function findIssue(root, rawId) {
  const id = String(rawId).replace(/^#/, '').padStart(3, '0');
  return loadIssues(root).find((i) => i.id === id) || null;
}

function setField(text, name, value) {
  const re = new RegExp(`^\\*\\*${name}:\\*\\*.*$`, 'm');
  if (re.test(text)) return text.replace(re, `**${name}:** ${value}`);
  // insert after the last field line of the header
  const lines = text.split('\n');
  let last = 0;
  for (let i = 1; i < lines.length; i += 1) { if (FIELD_RE.test(lines[i])) last = i; else if (lines[i].startsWith('## ')) break; }
  lines.splice(last + 1, 0, `**${name}:** ${value}`);
  return lines.join('\n');
}

function setSection(text, name, body) {
  const re = new RegExp(`(^##\\s+${name}\\s*$\\n)([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'mi');
  if (re.test(text)) return text.replace(re, `$1${body.trim()}\n\n`);
  return `${text.replace(/\s*$/, '')}\n\n## ${name}\n${body.trim()}\n`;
}

export function renderIssue({ id, title, kind, priority, tier, tags, files, repo, foundBy }) {
  return `# ${id} · ${title}

**Status:** open
**Kind:** ${kind}
**Priority:** ${priority}
**Tier:** ${tier}
**Tags:** ${tags.join(', ')}
**Files:** ${files.join(', ')}
${repo ? `**Repo:** ${repo}\n` : ''}**Found by:** ${foundBy}
**Where:**

## What


## Why


## Acceptance


## Evidence

`;
}

// ---- journal and decisions ----------------------------------------------------------------------

export function appendLog(root, event) {
  const path = join(jarlDir(root), 'log.md');
  if (!existsSync(path)) writeFileSync(path, '# Log\n\n');
  appendFileSync(path, `- ${stamp()} · ${event}\n`);
}

export function appendDecision(root, slug, ruling) {
  const path = join(jarlDir(root), 'decisions.md');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '# Decisions\n';
  if (new RegExp(`^## \\d{4}-\\d{2}-\\d{2} · ${slug}\\s*$`, 'm').test(existing)) throw new Error(`duplicate slug: ${slug}`);
  writeFileSync(path, `${existing.replace(/\s*$/, '')}\n\n## ${today()} · ${slug}\n${ruling.trim()}\n`);
}

// ---- commands ----------------------------------------------------------------------------------

function need(cond, msg) { if (!cond) throw new Error(msg); }

// By default the loop stays out of git: .jarl/.gitignore ignores everything under .jarl/, itself
// included, so the loop never shows in the branch's history, diffs or merges. --committed writes no
// ignore file and the loop is committed with the work. --permanent also writes no ignore file — a
// permanent record must be committed to survive — and additionally writes .jarl/.permanent, so a
// later session can tell the mode from the loop itself without being told: close (below) reads that
// marker and keeps the directory instead of removing it. Only init decides any of this; no other
// command adds or removes these files, so a loop opened before a mode existed keeps behaving as it did.
export const JARL_GITIGNORE = '*\n**/*\n';
export const PERMANENT_MARKER = 'This loop is a permanent record: it is not tied to a feature branch, and `close` never removes this directory. See SKILL.md.\n';

export function cmdInit(root, goal, flags = {}) {
  need(flags.committed === undefined || flags.committed === true, '--committed takes no value — put the goal first: init "<goal>" --committed');
  need(flags.permanent === undefined || flags.permanent === true, '--permanent takes no value — put the goal first: init "<goal>" --permanent');
  need(goal, 'init requires "<goal>"');
  need(!existsSync(jarlDir(root)), '.jarl/ already exists here — resume it, do not re-init');
  const permanent = flags.permanent === true;
  const committed = flags.committed === true || permanent;
  mkdirSync(issuesDir(root), { recursive: true });
  if (!committed) writeFileSync(join(jarlDir(root), '.gitignore'), JARL_GITIGNORE);
  if (permanent) writeFileSync(join(jarlDir(root), '.permanent'), PERMANENT_MARKER);
  writeFileSync(join(jarlDir(root), 'goal.md'), `# Goal\n\n${goal.trim()}\n\n## Assumptions\n\n## Rules that apply here\n`);
  writeFileSync(join(jarlDir(root), 'decisions.md'), '# Decisions\n');
  writeFileSync(join(jarlDir(root), 'log.md'), '# Log\n\n');
  appendLog(root, `opened · ${goal.trim()}`);
  return { dir: jarlDir(root), committed, permanent };
}

export function cmdNew(root, title, flags) {
  need(title, 'new requires "<title>"');
  need(existsSync(jarlDir(root)), 'no .jarl/ here — run: jarl.mjs init "<goal>"');
  const kind = flags.kind || 'bug';
  need(KINDS.includes(kind), `--kind must be one of: ${KINDS.join(', ')}`);
  const priority = String(flags.prio || '2');
  need(PRIORITIES.includes(priority), '--prio must be 1, 2 or 3');
  const tier = String(flags.tier || 'standard');
  need(TIERS.includes(tier), `--tier must be one of: ${TIERS.join(', ')} — the tier of model the worker is raised on, mapped to a model by the platform running the loop`);
  if (flags.repo !== undefined) repoOf(root, flags.repo);
  const issues = loadIssues(root);
  const id = String(issues.reduce((m, i) => Math.max(m, Number(i.id)), 0) + 1).padStart(3, '0');
  const file = join(issuesDir(root), `${id}-${slugify(title)}.md`);
  writeFileSync(file, renderIssue({
    id, title, kind, priority, tier,
    tags: splitList(flags.tags), files: splitList(flags.files), repo: flags.repo, foundBy: flags['found-by'] || 'jarl',
  }));
  appendLog(root, `filed ${id} · ${title}`);
  return { id, file };
}

function splitList(v) { return String(v || '').split(',').map((s) => s.trim()).filter(Boolean); }

export function cmdList(root, flags) {
  let rows = loadIssues(root);
  // Deferred work waits, so the default list does not show it: --status deferred or --all does.
  if (!flags.all && !flags.status) rows = rows.filter((i) => i.status === 'open' || i.status === 'in-progress');
  if (flags.status) rows = rows.filter((i) => i.status === flags.status);
  if (flags.kind) rows = rows.filter((i) => i.kind === flags.kind);
  if (flags.tag) rows = rows.filter((i) => i.tags.includes(flags.tag));
  if (flags.prio) rows = rows.filter((i) => i.priority === String(flags.prio));
  if (flags.grep) {
    const re = new RegExp(flags.grep, 'i');
    rows = rows.filter((i) => re.test(readFileSync(i.file, 'utf8')));
  }
  return rows.sort((a, b) => a.priority.localeCompare(b.priority) || a.id.localeCompare(b.id));
}

export function cmdSet(root, rawId, status, why) {
  need(STATUSES.includes(status), `status must be one of: ${STATUSES.join(', ')}`);
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  need(status !== 'dropped' || why, 'dropped needs a reason: jarl.mjs set <id> dropped "<why>"');
  need(status !== 'deferred' || why, 'deferred needs a reason: jarl.mjs set <id> deferred "<why>" — work that waits, not work that is gone');
  need(status !== 'done' || issue.sections.evidence?.trim(), `${issue.id} has no evidence yet — record it first: jarl.mjs evidence ${issue.id} "<what was run and what it printed>"`);
  need(status !== 'done' || reviewState(root, issue.id).approved, `${issue.id} has no approving review newer than its last round — a fresh reviewer reads the issue and the diff first: jarl.mjs review ${issue.id} approve|changes "<findings>"`);
  let text = readFileSync(issue.file, 'utf8');
  text = setField(text, 'Status', status);
  // What was already written under Evidence stays: a drop or a deferral is one more line in the history,
  // not a reset of it.
  if (status === 'dropped' || status === 'deferred') {
    const written = (issue.sections.evidence || '').trim();
    const line = `${status === 'dropped' ? 'Dropped' : 'Deferred'}: ${why}`;
    text = setSection(text, 'Evidence', written ? `${written}\n\n${line}` : line);
  }
  writeFileSync(issue.file, text);
  appendLog(root, `${issue.id} → ${status}${why ? ` · ${why}` : ''}`);
  return { id: issue.id, status };
}

export function cmdTag(root, rawId, ops) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  const tags = new Set(issue.tags);
  for (const op of ops) {
    if (op.startsWith('+')) tags.add(op.slice(1));
    else if (op.startsWith('-')) tags.delete(op.slice(1));
    else throw new Error(`tags are +name or -name, not "${op}"`);
  }
  writeFileSync(issue.file, setField(readFileSync(issue.file, 'utf8'), 'Tags', [...tags].sort().join(', ')));
  return { id: issue.id, tags: [...tags].sort() };
}

export function cmdPrio(root, rawId, prio) {
  need(PRIORITIES.includes(String(prio)), 'priority is 1, 2 or 3');
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  writeFileSync(issue.file, setField(readFileSync(issue.file, 'utf8'), 'Priority', String(prio)));
  return { id: issue.id, priority: String(prio) };
}

export function cmdFiles(root, rawId, list) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  const files = splitList(list);
  writeFileSync(issue.file, setField(readFileSync(issue.file, 'utf8'), 'Files', files.join(', ')));
  return { id: issue.id, files };
}

export function cmdRepo(root, rawId, path) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  need(path !== undefined, 'repo requires <path> — the checkout of the repository the issue\'s code lives in');
  repoOf(root, path);
  writeFileSync(issue.file, setField(readFileSync(issue.file, 'utf8'), 'Repo', path));
  return { id: issue.id, repo: path };
}

export function evidenceRows(issue) {
  const text = (issue.sections.evidence || '');
  const rows = [];
  for (const line of text.split('\n')) {
    const m = /^- \*\*ran:\*\*\s*(.*?)\s*·\s*\*\*saw:\*\*\s*(.*)$/.exec(line.trim());
    if (m) rows.push({ ran: m[1], saw: m[2] });
  }
  return rows;
}

export function acceptanceLineCount(issue) {
  const text = issue.sections.acceptance || '';
  return text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0).length;
}

// evidence <id> "<text>" appends free text (a merge sha, a one-line note); evidence <id> --ran
// "<command>" --saw "<what it printed>" appends one checkable row per pair instead — repeat the pair,
// in one call or across calls, one row per acceptance line. Both append to the same section, never
// replace it: the merger's free-text note lands after the worker's rows. `set done` needs the section
// non-empty, rows or not (not every issue's proof is a command).
export function cmdEvidence(root, rawId, text, flags) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  if (flags && (flags.ran !== undefined || flags.saw !== undefined)) {
    const rans = [].concat(flags.ran ?? []);
    const saws = [].concat(flags.saw ?? []);
    need(rans.length && saws.length && [...rans, ...saws].every((v) => typeof v === 'string' && v.trim()), 'a row needs both --ran "<command>" and --saw "<what it printed>", each with a value');
    need(rans.length === saws.length, `--ran and --saw must repeat the same number of times (got ${rans.length} --ran, ${saws.length} --saw)`);
    const rows = rans.map((ran, i) => ({ ran, saw: saws[i] }));
    const lines = rows.map((r) => `- **ran:** ${r.ran} · **saw:** ${r.saw}`).join('\n');
    const current = (issue.sections.evidence || '').trim();
    writeFileSync(issue.file, setSection(readFileSync(issue.file, 'utf8'), 'Evidence', current ? `${current}\n${lines}` : lines));
    for (const r of rows) appendLog(root, `${issue.id} evidence row · ${r.ran}`);
    return { id: issue.id, rows };
  }
  need(text, 'evidence requires "<what was run and what it printed>", or --ran "<command>" --saw "<what it printed>"');
  const current = (issue.sections.evidence || '').trim();
  writeFileSync(issue.file, setSection(readFileSync(issue.file, 'utf8'), 'Evidence', current ? `${current}\n\n${text}` : text));
  appendLog(root, `${issue.id} evidence · ${text.split('\n')[0]}`);
  return { id: issue.id };
}

// A declared file is a repository and a path inside it. An issue that names no repository declares
// paths in the loop's own, as a single-repository loop always has. An issue that names one writes
// each file with that repository's directory name first — tool/src/a.mjs for Repo ../tool — so a
// reader of the Files line sees where each file lives and the same path in two repositories reads
// as two files; the name is dropped to get the path inside the repository. An entry that does not
// start with the name is taken as a path inside the repository already, so two spellings of one
// file still meet in next rather than passing each other.
export function fileAt(root, issue, declared) {
  if (!issue.fields.repo) return { repo: root, path: declared };
  const repo = resolve(root, issue.fields.repo);
  const name = basename(repo);
  return { repo, path: name && declared.startsWith(`${name}/`) ? declared.slice(name.length + 1) : declared };
}

export function cmdNext(root, flags) {
  const issues = loadIssues(root);
  // Files are compared as (repository, path) pairs: the same path in two repositories never holds
  // an issue back, the same file in one repository always does, however its Repo path is spelled.
  const keysOf = (i) => i.files.map((f) => { const at = fileAt(root, i, f); return { f, key: `${at.repo}\n${at.path}` }; });
  const taken = new Set(issues.filter((i) => i.status === 'in-progress').flatMap((i) => keysOf(i).map((k) => k.key)));
  const out = [];
  for (const i of issues.filter((x) => x.status === 'open').sort((a, b) => a.priority.localeCompare(b.priority) || a.id.localeCompare(b.id))) {
    const keys = keysOf(i);
    const clash = keys.filter((k) => taken.has(k.key)).map((k) => k.f);
    if (clash.length) { out.push({ id: i.id, title: i.title, priority: i.priority, waitsOn: clash }); continue; }
    keys.forEach((k) => taken.add(k.key));
    out.push({ id: i.id, title: i.title, priority: i.priority, files: i.files, ready: true });
  }
  const limit = Number(flags.limit) || Infinity;
  let n = 0;
  return out.filter((r) => { if (!r.ready) return true; n += 1; return n <= limit; });
}

export function cmdStatus(root) {
  const c = { open: 0, 'in-progress': 0, done: 0, dropped: 0, deferred: 0 };
  for (const i of loadIssues(root)) c[i.status] = (c[i.status] || 0) + 1;
  c.questions = loadAsks(root).filter((a) => a.state === 'open').length;
  return c;
}

// A loop opened before the permanent mode existed, or opened --committed, has no way to become the
// permanent record other than this: init is the only command that writes .jarl/.permanent for a new
// loop, and mode is the only other one, for an existing one — it never touches .jarl/.gitignore, so a
// default-mode loop (out of git) cannot be switched in place: a permanent record must be committed,
// and only init decides that. Idempotent it is not: running it twice on an already-permanent loop
// refuses clearly instead of silently doing nothing, so a session never mistakes a no-op for a check.
export function cmdMode(root, mode) {
  need(mode, 'mode requires a target: jarl.mjs mode permanent');
  need(mode === 'permanent', `mode only supports "permanent" today: jarl.mjs mode permanent (got "${mode}")`);
  need(existsSync(jarlDir(root)), 'no .jarl/ here');
  need(!existsSync(join(jarlDir(root), '.gitignore')), 'this loop is out of git (default mode) — a permanent record must be committed, and only init decides .jarl/.gitignore, so there is no in-place switch. Start a fresh loop with: jarl.mjs init "<goal>" --permanent');
  need(!existsSync(join(jarlDir(root), '.permanent')), 'already a permanent record (.jarl/.permanent exists) — nothing to do');
  writeFileSync(join(jarlDir(root), '.permanent'), PERMANENT_MARKER);
  appendLog(root, 'mode → permanent · no longer tied to a feature branch; close now keeps the directory instead of removing it');
  return { permanent: true };
}

export function cmdClose(root, flags) {
  need(existsSync(jarlDir(root)), 'no .jarl/ here');
  const left = loadIssues(root).filter((i) => i.status === 'open' || i.status === 'in-progress');
  need(flags.force || left.length === 0, `${left.length} issue(s) still open or in progress: ${left.map((i) => i.id).join(', ')} — set each done or dropped, or report them to the user and run with --force`);
  // A permanent loop is a record, not a stage cleared before a merge: close leaves the directory in
  // place and logs the close instead of removing it, so --root still finds the loop afterwards.
  // Deferred work is not open, so it does not hold the close — but the close says it leaves it waiting.
  const deferred = loadIssues(root).filter((i) => i.status === 'deferred').map((i) => i.id);
  if (existsSync(join(jarlDir(root), '.permanent'))) {
    appendLog(root, `closed · kept as a permanent record${deferred.length ? ` · ${deferred.length} deferred still waiting: ${deferred.join(', ')}` : ''}`);
    return { removed: null, kept: jarlDir(root), leftOpen: left.map((i) => i.id), deferred };
  }
  rmSync(jarlDir(root), { recursive: true, force: true });
  return { removed: jarlDir(root), kept: null, leftOpen: left.map((i) => i.id), deferred };
}


// ---- review ----------------------------------------------------------------------------------

// The latest review and the latest round, by their position in the journal: a round after an
// approve means the approve is spent and the branch needs fresh eyes.
export function reviewState(root, id) {
  const path = join(jarlDir(root), 'log.md');
  if (!existsSync(path)) return { approved: false, lastReview: null };
  const lines = readFileSync(path, 'utf8').split('\n');
  let lastReview = null; let lastReviewAt = -1; let lastRoundAt = -1;
  lines.forEach((l, i) => {
    const m = new RegExp(`· ${id} review (approve|changes) · `).exec(l);
    if (m) { lastReview = m[1]; lastReviewAt = i; }
    if (l.includes(`· ${id} round `)) lastRoundAt = i;
  });
  return { approved: lastReview === 'approve' && lastReviewAt > lastRoundAt, lastReview };
}

const SEVERITIES = ['Critical', 'Important', 'Minor'];

// A "changes" verdict names at least one Critical or Important finding — Minor alone never bounces
// a branch back to a worker, it goes to evidence and the branch still merges (the review discipline's
// own rule, enforced here rather than left to a reviewer's judgement).
export function cmdReview(root, rawId, verdict, findings) {
  need(verdict === 'approve' || verdict === 'changes', 'review requires approve|changes');
  need(findings, 'review requires "<findings>" — what was read and what was found, even when nothing');
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  const severities = SEVERITIES.filter((s) => findings.includes(s));
  if (verdict === 'changes') {
    need(severities.length > 0, `"changes" needs at least one finding ranked ${SEVERITIES.join('/')} — name the severity, not just the problem`);
    need(severities.some((s) => s !== 'Minor'), '"changes" needs a Critical or Important finding — Minor alone goes to evidence on an approve, it never bounces a branch');
  }
  appendLog(root, `${issue.id} review ${verdict} · ${findings.split('\n')[0]}`);
  return { id: issue.id, verdict, severities };
}

// ---- rounds, branches, checks ------------------------------------------------------------------

function git(root, args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

// Where git runs for an issue's code. A loop may keep its issues in one repository while its workers
// change another; that other repository is named by --repo on the command or by the issue's Repo
// field. A relative path is read from the loop's root, not the caller's directory, because workers,
// reviewers and the merger call the tool from different checkouts with the same --root. Naming
// nothing keeps git where the loop lives, as it always was.
export function repoOf(root, named) {
  if (named === undefined || named === '') return root;
  need(typeof named === 'string', '--repo takes one path — the checkout of the repository the code lives in');
  const repo = resolve(root, named);
  need(git(repo, ['rev-parse', '--git-dir']) !== null, `not a git repository: ${repo} (a relative --repo or Repo path is read from the loop's root, ${root})`);
  return repo;
}

export function roundsOf(root, id) {
  const path = join(jarlDir(root), 'log.md');
  if (!existsSync(path)) return 0;
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.includes(`· ${id} round `)).length;
}

export function cmdRound(root, rawId, what) {
  need(what, 'round requires "<what failed>"');
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  const n = roundsOf(root, issue.id) + 1;
  appendLog(root, `${issue.id} round ${n} · ${what}`);
  const takeover = n >= ROUNDS_BEFORE_TAKEOVER;
  const log = readFileSync(join(jarlDir(root), 'log.md'), 'utf8').split('\n').filter((l) => l.includes(`· ${issue.id} `)).join('\n');
  const block = takeover ? `## Takeover\n\nA prior worker attempted issue ${issue.id} ${n} times; the issue is yours now. Its rounds so far:\n\n\`\`\`\n${log}\n\`\`\`\n` : null;
  return { id: issue.id, round: n, takeover, block };
}

function defaultBase(root) {
  return git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'HEAD';
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

export function cmdCheck(root, rawId, flags) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  need(flags.branch, 'check requires --branch <worker branch>');
  const repo = repoOf(root, flags.repo ?? issue.fields.repo);
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
  // as a root-relative prefix, or as a path suffix ending at a "/" boundary.
  const pathMatches = (f, d) => {
    const dd = d.replace(/\/+$/, '');
    return f === dd || f.startsWith(`${dd}/`) || f.endsWith(`/${dd}`);
  };
  // The diff's paths are inside the repository read, so a file the issue declares with its
  // repository's name first is matched by the path after that name.
  const declared = issue.files.map((d) => fileAt(root, issue, d).path);
  const outside = issue.files.length ? changed.filter((f) => !alwaysInScope(f) && !declared.some((d) => pathMatches(f, d))) : [];
  const testsBase = (git(repo, ['ls-tree', '-r', '--name-only', mergeBase]) || '').split('\n').filter(isTestFile);
  const testsTip = (git(repo, ['ls-tree', '-r', '--name-only', flags.branch]) || '').split('\n').filter(isTestFile);
  const removedTests = testsBase.filter((f) => !testsTip.includes(f));
  const touchedTests = changed.filter(isTestFile);
  const assertsBase = countAsserts(repo, mergeBase, [...new Set([...touchedTests, ...removedTests])]);
  const assertsTip = countAsserts(repo, flags.branch, touchedTests);
  const items = [
    { name: 'commits beyond base', ok: Number(commits) > 0, note: `${commits} commit(s) on ${flags.branch} beyond ${mergeBase.slice(0, 7)}` },
    { name: 'diff inside declared files', ok: outside.length === 0, note: issue.files.length ? (outside.length ? `outside ${issue.files.join(', ')}: ${outside.join(', ')}` : `${changed.length} file(s), all inside`) : 'no files declared on the issue — nothing to bound the diff by' },
    { name: 'test files', ok: removedTests.length === 0, note: removedTests.length ? `removed: ${removedTests.join(', ')}` : `${testsTip.length} on the branch, ${touchedTests.length} touched, none removed` },
    { name: 'assertions in touched tests', ok: assertsTip >= assertsBase, note: `${assertsBase} → ${assertsTip}` },
  ];
  return { id: issue.id, branch: flags.branch, repo, base, mergeBase, changed, items, ok: items.every((i) => i.ok) };
}

// Every jarl/* branch, plus every branch some worktree has checked out that is not the base: a
// worker that never renamed its branch still did the work, and a listing that hides it would
// hide a report. Such a branch is marked unnamed so the merger renames it before merging.
// With --repo, all of it is read in that repository, for a loop whose workers change another one.
export function cmdBranches(root, flags) {
  const repo = repoOf(root, flags.repo);
  const base = flags.base || defaultBase(repo);
  const named = (git(repo, ['branch', '--list', 'jarl/*', '--format=%(refname:short)']) || '').split('\n').filter(Boolean);
  const worktrees = (git(repo, ['worktree', 'list', '--porcelain']) || '').split('\n\n').map((b) => {
    const path = /^worktree (.*)$/m.exec(b)?.[1];
    const branch = /^branch refs\/heads\/(.*)$/m.exec(b)?.[1];
    return { path, branch };
  }).filter((w) => w.branch);
  const mainPath = git(repo, ['rev-parse', '--show-toplevel']);
  const extra = worktrees.filter((w) => w.branch !== base && !named.includes(w.branch) && w.path !== mainPath).map((w) => w.branch);
  return [...named, ...extra].map((name) => {
    const mb = git(repo, ['merge-base', base, name]);
    const ahead = mb ? Number(git(repo, ['rev-list', '--count', `${mb}..${name}`]) || 0) : null;
    const wt = worktrees.find((w) => w.branch === name);
    const dirty = wt ? (git(wt.path, ['status', '--porcelain']) || '').split('\n').filter(Boolean).length : null;
    return { branch: name, ahead, worktree: wt ? wt.path : null, dirty, unnamed: !name.startsWith('jarl/') };
  });
}

// ---- questions to the user and the handoff --------------------------------------------------

function asksPath(root) { return join(jarlDir(root), 'asks.md'); }
const ASK_RE = /^- \*\*a-(\d{3})\*\* \((open|answered)\)(?: · (stop|stuck|lower|charter))?(?: · target (\S+))?(?: · issue (\d{3}))? · (.*)$/;

export function loadAsks(root) {
  const path = asksPath(root);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').map((l) => ASK_RE.exec(l)).filter(Boolean)
    .map((m) => ({ id: m[1], state: m[2], kind: m[3] || null, target: m[4] || null, issue: m[5] || null, question: m[6] }));
}

export function cmdAsk(root, question, flags) {
  need(question, 'ask requires "<question>"');
  const kind = String(flags.kind || 'stuck');
  need(ASK_KINDS.includes(kind), `--kind must be one of: ${ASK_KINDS.join(', ')} — stop (halt everything), stuck (this issue only), lower (weaken something protected, needs a target), charter (the goal itself)`);
  need(kind !== 'lower' || flags.target, '--target is required for kind lower — nothing to weaken without naming it');
  need(kind === 'lower' || !flags.target, `--target has no meaning for kind "${kind}" — only lower names something to weaken`);
  const asks = loadAsks(root);
  const id = String(asks.reduce((m, a) => Math.max(m, Number(a.id)), 0) + 1).padStart(3, '0');
  const path = asksPath(root);
  if (!existsSync(path)) writeFileSync(path, '# Questions to the user\n\n');
  const target = kind === 'lower' ? ` · target ${flags.target}` : '';
  appendFileSync(path, `- **a-${id}** (open) · ${kind}${target}${flags.issue ? ` · issue ${String(flags.issue).padStart(3, '0')}` : ''} · ${question}\n`);
  appendLog(root, `asked a-${id} (${kind}) · ${question}`);
  return { id, question, kind };
}

export function cmdAnswer(root, rawId, answer) {
  need(answer, 'answer requires "<answer>"');
  const id = String(rawId).replace(/^a-/, '').padStart(3, '0');
  const ask = loadAsks(root).find((a) => a.id === id);
  need(ask, `no such question: a-${id}`);
  need(ask.state === 'open', `a-${id} is already answered`);
  appendDecision(root, `ask-${id}`, `**Question:** ${ask.question}\n**Answer:** ${answer}`);
  const path = asksPath(root);
  writeFileSync(path, readFileSync(path, 'utf8').replace(`- **a-${id}** (open)`, `- **a-${id}** (answered)`));
  appendLog(root, `answered a-${id} · ${answer.split('\n')[0]}`);
  return { id, answer };
}

function handoffPath(root) { return join(jarlDir(root), 'handoff.md'); }

export function cmdHandoffWrite(root, flags) {
  need(typeof flags.summary === 'string' && flags.summary, 'handoff write requires --summary "<s>"');
  const inFlight = loadIssues(root).filter((i) => i.status === 'in-progress').map((i) => `${i.id} ${i.title}`);
  const open = loadAsks(root).filter((a) => a.state === 'open').map((a) => `a-${a.id} ${a.question}`);
  const next = [].concat(flags.next || []).filter(Boolean);
  const headOf = (dir) => `${git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']) || '?'}@${git(dir, ['rev-parse', '--short', 'HEAD']) || '?'}`;
  // Where each other repository an unfinished issue names stands, beside the loop's own head: in a
  // loop whose workers change another repository, that head is the one the next session resumes from.
  const repos = [...new Set(loadIssues(root).filter((i) => i.status === 'open' || i.status === 'in-progress').map((i) => i.fields.repo).filter(Boolean))];
  const heads = repos.map((r) => ` · **Head in ${r}:** ${headOf(resolve(root, r))}`).join('');
  const text = `# Handoff\n\n**At:** ${stamp()} · **Head:** ${headOf(root)}${heads}\n\n## Summary\n${flags.summary}\n\n## In flight\n${inFlight.map((s) => `- ${s}`).join('\n') || '- (nothing)'}\n\n## Waiting on the user\n${open.map((s) => `- ${s}`).join('\n') || '- (nothing)'}\n\n## Next\n${next.map((s) => `- ${s}`).join('\n') || '- (nothing recorded)'}\n`;
  writeFileSync(handoffPath(root), text);
  appendLog(root, `handoff · ${flags.summary.split('\n')[0]}`);
  return { path: handoffPath(root), inFlight: inFlight.length, waiting: open.length };
}

export function cmdHandoffRead(root) {
  return existsSync(handoffPath(root)) ? readFileSync(handoffPath(root), 'utf8') : 'fresh start — no handoff recorded';
}

// The reason an issue was dropped or deferred: the last "Dropped: ..." / "Deferred: ..." line of its Evidence,
// whatever notes were written before it. Evidence with no such line (an older file) is read whole.
function statusReason(evidence, word) {
  const text = (evidence || '').trim();
  const last = [...text.matchAll(new RegExp(`^${word}:\\s*(.*)$`, 'gm'))].pop();
  return last ? last[1].trim() : text;
}

export function cmdReport(root) {
  const issues = loadIssues(root);
  const done = issues.filter((i) => i.status === 'done');
  const dropped = issues.filter((i) => i.status === 'dropped');
  const deferred = issues.filter((i) => i.status === 'deferred');
  const left = issues.filter((i) => i.status === 'open' || i.status === 'in-progress');
  const found = issues.filter((i) => i.fields['found by'] && !/^jarl\b/i.test(i.fields['found by']));
  const goal = existsSync(join(jarlDir(root), 'goal.md')) ? readFileSync(join(jarlDir(root), 'goal.md'), 'utf8').split('\n').slice(2).find((l) => l.trim()) || '' : '';
  const lines = [`# Report`, '', goal, '', `## Done (${done.length})`, ...done.map((i) => `- ${i.id} ${i.title} (${i.kind})`),
    '', `## Dropped (${dropped.length})`, ...dropped.map((i) => `- ${i.id} ${i.title} — ${statusReason(i.sections.evidence, 'Dropped')}`),
    '', `## Deferred (${deferred.length})`, ...deferred.map((i) => `- ${i.id} ${i.title} — ${statusReason(i.sections.evidence, 'Deferred')}`),
    '', `## Still open (${left.length})`, ...left.map((i) => `- ${i.id} ${i.title} (${i.status})`),
    '', `## Found along the way (${found.length})`, ...found.map((i) => `- ${i.id} ${i.title} — ${i.fields['found by']}`)];
  return { done: done.length, dropped: dropped.length, deferred: deferred.length, left: left.length, found: found.length, text: lines.join('\n') + '\n' };
}

// ---- main --------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { flags[k] = flags[k] === undefined ? next : [].concat(flags[k], next); i += 1; } else flags[k] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function renderList(rows) {
  if (rows.length === 0) return '(none)';
  return rows.map((i) => `${i.id}  P${i.priority}  ${i.status.padEnd(11)} ${i.kind.padEnd(8)} ${i.title}${i.tags.length ? `  [${i.tags.join(', ')}]` : ''}`).join('\n');
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = positional;
  if (!cmd || flags.help) { console.log(USAGE); process.exit(cmd ? 0 : 1); }
  const root = flags.root ? resolve(flags.root) : findRoot();
  let out;
  let text;
  try {
    switch (cmd) {
      case 'init': out = cmdInit(root, rest[0], flags); text = `opened ${out.dir} · ${out.permanent ? 'permanent record, no branch' : out.committed ? 'committed with the work' : 'kept out of git'}`; break;
      case 'new': out = cmdNew(root, rest[0], flags); text = `filed ${out.id} · ${out.file}`; break;
      case 'list': out = cmdList(root, flags); text = renderList(out); break;
      case 'show': { const i = findIssue(root, rest[0]); need(i, `no such issue: ${rest[0]}`); out = i; text = readFileSync(i.file, 'utf8'); break; }
      case 'set': out = cmdSet(root, rest[0], rest[1], rest[2]); text = `${out.id} → ${out.status}`; break;
      case 'tag': out = cmdTag(root, rest[0], rest.slice(1)); text = `${out.id} tags: ${out.tags.join(', ') || '(none)'}`; break;
      case 'prio': out = cmdPrio(root, rest[0], rest[1]); text = `${out.id} priority ${out.priority}`; break;
      case 'files': out = cmdFiles(root, rest[0], rest[1]); text = `${out.id} files: ${out.files.join(', ') || '(none)'}`; break;
      case 'repo': out = cmdRepo(root, rest[0], rest[1]); text = `${out.id} repo: ${out.repo}`; break;
      case 'evidence': out = cmdEvidence(root, rest[0], rest[1], flags); text = out.rows ? `${out.id} evidence row${out.rows.length > 1 ? 's' : ''} recorded` : `${out.id} evidence recorded`; break;
      case 'next': out = cmdNext(root, flags); text = out.length ? out.map((r) => (r.ready ? `${r.id}  P${r.priority}  ${r.title}` : `${r.id}  P${r.priority}  ${r.title}  (waits on ${r.waitsOn.join(', ')})`)).join('\n') : '(nothing open)'; break;
      case 'review': out = cmdReview(root, rest[0], rest[1], rest[2]); text = `${out.id} review ${out.verdict}`; break;
      case 'round': out = cmdRound(root, rest[0], rest[1]); text = out.takeover ? `${out.id} round ${out.round} — takeover:\n\n${out.block}` : `${out.id} round ${out.round} of ${ROUNDS_BEFORE_TAKEOVER} before a takeover`; break;
      case 'check': out = cmdCheck(root, rest[0], flags); text = `${out.repo === root ? '' : `in ${out.repo}\n`}${out.items.map((i) => `${i.ok ? '✓' : '✗'} ${i.name} — ${i.note}`).join('\n')}`; break;
      case 'branches': out = cmdBranches(root, flags); text = out.length ? out.map((b) => `${b.branch}  +${b.ahead ?? '?'}  ${b.worktree ? `${b.worktree}${b.dirty ? ` (${b.dirty} uncommitted)` : ' (clean)'}` : '(no worktree)'}${b.unnamed ? '  UNNAMED — rename to jarl/NNN-slug before merging' : ''}`).join('\n') : '(no worker branches)'; break;
      case 'ask': out = cmdAsk(root, rest[0], flags); text = `asked a-${out.id}`; break;
      case 'answer': out = cmdAnswer(root, rest[0], rest[1]); text = `answered a-${out.id}`; break;
      case 'handoff': if (rest[0] === 'write') { out = cmdHandoffWrite(root, flags); text = `handoff written · ${out.inFlight} in flight · ${out.waiting} waiting on the user`; } else { out = { text: cmdHandoffRead(root) }; text = out.text; } break;
      case 'report': out = cmdReport(root); text = out.text; break;
      case 'log': need(rest[0], 'log requires "<event>"'); appendLog(root, rest[0]); out = { logged: rest[0] }; text = 'logged'; break;
      case 'decide': need(rest[0] && rest[1], 'decide requires <slug> "<ruling>"'); appendDecision(root, rest[0], rest[1]); appendLog(root, `decided ${rest[0]}`); out = { slug: rest[0] }; text = `decided ${rest[0]}`; break;
      case 'status': out = cmdStatus(root); text = `open ${out.open} · in flight ${out['in-progress']} · done ${out.done} · dropped ${out.dropped} · deferred ${out.deferred} · questions ${out.questions}`; break;
      case 'mode': out = cmdMode(root, rest[0]); text = 'now permanent · no longer tied to a feature branch; close keeps the directory'; break;
      case 'close': out = cmdClose(root, flags); text = (out.kept ? `kept ${out.kept} · closed as a permanent record` : `removed ${out.removed}`) + (out.deferred.length ? ` · ${out.deferred.length} deferred still waiting: ${out.deferred.join(', ')}` : ''); break;
      default: throw new Error(`unknown command: ${cmd}\n${USAGE}`);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  console.log(flags.json ? JSON.stringify(out, null, 2) : text);
  if (cmd === 'check' && !out.ok) process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
