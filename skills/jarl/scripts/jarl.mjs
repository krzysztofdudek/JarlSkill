#!/usr/bin/env node
// jarl.mjs — the one tool the jarl skill's state moves through.
//
// Markdown is the source of truth: .jarl/goal.md, .jarl/decisions.md, .jarl/log.md and one
// .jarl/issues/NNN-slug.md per issue. This script only reads and writes those files, so anything
// it does can be checked by opening them. Zero dependencies, Node 18+.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATUSES = ['open', 'in-progress', 'done', 'dropped'];
export const KINDS = ['bug', 'gap', 'cleanup', 'docs', 'test', 'research', 'process'];
export const PRIORITIES = ['1', '2', '3'];
export const TIERS = ['standard', 'strong'];
const ROUNDS_BEFORE_TAKEOVER = 3;

const USAGE = `usage: jarl.mjs <command> [options]

commands:
  init "<goal>"                                  create .jarl/ on this branch with the goal
  new "<title>" [--kind k] [--prio 1|2|3] [--tier standard|strong] [--tags a,b] [--files p,q] [--found-by who]
                                                 file an issue under the next free number
  evidence <id> "<text>" | --ran "<command>" --saw "<what it printed>"
                                                 append a free-text note, or one checkable row (repeatable)
  list [--status s] [--kind k] [--tag t] [--prio p] [--grep re] [--all]
                                                 open and in-progress by default; --all for every status
  show <id>                                      print one issue
  set <id> <status> "<why>"                      change status; writes the log line in the same move
  tag <id> +a -b ...                             add and remove tags
  prio <id> 1|2|3                                set priority
  files <id> p,q,...                             declare the files the issue touches
  next [--limit n]                               open issues that do not share a file with any in-progress one
  review <id> approve|changes "<findings>"     the reviewer's verdict; "done" needs an approve newer than the last round
  round <id> "<what failed>"                     one red round; after three prints the takeover block for a fresh worker
  check <id> --branch <b> [--base <feature-branch>]
                                                 commits beyond the base, diff inside the declared files, and the
                                                 change in test files and assertions — numbers, never a verdict
  branches [--base <feature-branch>]             every jarl/NNN-* branch: commits beyond the base, worktree state
  ask "<question>" [--issue NNN]                 a question the user has to answer; listed at boot until answered
  answer <id> "<answer>"                         records the answer as a ruling and closes the question
  handoff write --summary "<s>" [--next "<n>"]... | read
                                                 the state of intent between sessions
  log "<event>"                                  append one dated line to the journal
  decide <slug> "<ruling>"                       append a ruling; refuses a duplicate slug
  status                                         one line: open, in flight, done, dropped, open questions
  report                                         what was done, dropped and found — ready for the changelog
  close [--force]                                refuse while anything is open or in progress; else remove .jarl/

options: --json  --help  --root <repo root>`;

// ---- where -------------------------------------------------------------------------------------

export function findRoot(from = process.cwd()) {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const up = dirname(dir);
    if (up === dir) return resolve(from);
    dir = up;
  }
}
export function jarlDir(root) { return join(root, '.jarl'); }
export function issuesDir(root) { return join(jarlDir(root), 'issues'); }

function today() { return new Date().toISOString().slice(0, 10); }
function stamp() { return new Date().toISOString().replace('T', ' ').slice(0, 16); }

// ---- issues ------------------------------------------------------------------------------------

export function slugify(title) {
  return title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
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

export function renderIssue({ id, title, kind, priority, tier, tags, files, foundBy }) {
  return `# ${id} · ${title}

**Status:** open
**Kind:** ${kind}
**Priority:** ${priority}
**Tier:** ${tier}
**Tags:** ${tags.join(', ')}
**Files:** ${files.join(', ')}
**Found by:** ${foundBy}
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

export function cmdInit(root, goal) {
  need(goal, 'init requires "<goal>"');
  need(!existsSync(jarlDir(root)), '.jarl/ already exists on this branch — resume it, do not re-init');
  mkdirSync(issuesDir(root), { recursive: true });
  writeFileSync(join(jarlDir(root), 'goal.md'), `# Goal\n\n${goal.trim()}\n\n## Assumptions\n\n## Rules that apply here\n`);
  writeFileSync(join(jarlDir(root), 'decisions.md'), '# Decisions\n');
  writeFileSync(join(jarlDir(root), 'log.md'), '# Log\n\n');
  appendLog(root, `opened · ${goal.trim()}`);
  return { dir: jarlDir(root) };
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
  const issues = loadIssues(root);
  const id = String(issues.reduce((m, i) => Math.max(m, Number(i.id)), 0) + 1).padStart(3, '0');
  const file = join(issuesDir(root), `${id}-${slugify(title)}.md`);
  writeFileSync(file, renderIssue({
    id, title, kind, priority, tier,
    tags: splitList(flags.tags), files: splitList(flags.files), foundBy: flags['found-by'] || 'jarl',
  }));
  appendLog(root, `filed ${id} · ${title}`);
  return { id, file };
}

function splitList(v) { return String(v || '').split(',').map((s) => s.trim()).filter(Boolean); }

export function cmdList(root, flags) {
  let rows = loadIssues(root);
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
  need(status !== 'done' || issue.sections.evidence?.trim(), `${issue.id} has no evidence yet — record it first: jarl.mjs evidence ${issue.id} "<what was run and what it printed>"`);
  need(status !== 'done' || reviewState(root, issue.id).approved, `${issue.id} has no approving review newer than its last round — a fresh reviewer reads the issue and the diff first: jarl.mjs review ${issue.id} approve|changes "<findings>"`);
  let text = readFileSync(issue.file, 'utf8');
  text = setField(text, 'Status', status);
  if (status === 'dropped') text = setSection(text, 'Evidence', `Dropped: ${why}`);
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
// "<command>" --saw "<what it printed>" appends one checkable row instead — repeatable, one row
// per acceptance line. Both land in the same section; `set done` only counts rows, and a free-text
// evidence block with zero rows still satisfies it (not every issue's proof is a command).
export function cmdEvidence(root, rawId, text, flags) {
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  if (flags && (flags.ran !== undefined || flags.saw !== undefined)) {
    need(flags.ran && flags.saw, 'a row needs both --ran "<command>" and --saw "<what it printed>"');
    const row = `- **ran:** ${flags.ran} · **saw:** ${flags.saw}`;
    const current = (issue.sections.evidence || '').trim();
    writeFileSync(issue.file, setSection(readFileSync(issue.file, 'utf8'), 'Evidence', current ? `${current}\n${row}` : row));
    appendLog(root, `${issue.id} evidence row · ${flags.ran}`);
    return { id: issue.id, row: { ran: flags.ran, saw: flags.saw } };
  }
  need(text, 'evidence requires "<what was run and what it printed>", or --ran "<command>" --saw "<what it printed>"');
  writeFileSync(issue.file, setSection(readFileSync(issue.file, 'utf8'), 'Evidence', text));
  appendLog(root, `${issue.id} evidence · ${text.split('\n')[0]}`);
  return { id: issue.id };
}

export function cmdNext(root, flags) {
  const issues = loadIssues(root);
  const busy = new Set(issues.filter((i) => i.status === 'in-progress').flatMap((i) => i.files));
  const taken = new Set(busy);
  const out = [];
  for (const i of issues.filter((x) => x.status === 'open').sort((a, b) => a.priority.localeCompare(b.priority) || a.id.localeCompare(b.id))) {
    const clash = i.files.filter((f) => taken.has(f));
    if (clash.length) { out.push({ id: i.id, title: i.title, priority: i.priority, waitsOn: clash }); continue; }
    i.files.forEach((f) => taken.add(f));
    out.push({ id: i.id, title: i.title, priority: i.priority, files: i.files, ready: true });
  }
  const limit = Number(flags.limit) || Infinity;
  let n = 0;
  return out.filter((r) => { if (!r.ready) return true; n += 1; return n <= limit; });
}

export function cmdStatus(root) {
  const c = { open: 0, 'in-progress': 0, done: 0, dropped: 0 };
  for (const i of loadIssues(root)) c[i.status] = (c[i.status] || 0) + 1;
  c.questions = loadAsks(root).filter((a) => a.state === 'open').length;
  return c;
}

export function cmdClose(root, flags) {
  need(existsSync(jarlDir(root)), 'no .jarl/ here');
  const left = loadIssues(root).filter((i) => i.status === 'open' || i.status === 'in-progress');
  need(flags.force || left.length === 0, `${left.length} issue(s) still open or in progress: ${left.map((i) => i.id).join(', ')} — set each done or dropped, or report them to the user and run with --force`);
  rmSync(jarlDir(root), { recursive: true, force: true });
  return { removed: jarlDir(root), leftOpen: left.map((i) => i.id) };
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

export function cmdReview(root, rawId, verdict, findings) {
  need(verdict === 'approve' || verdict === 'changes', 'review requires approve|changes');
  need(findings, 'review requires "<findings>" — what was read and what was found, even when nothing');
  const issue = findIssue(root, rawId);
  need(issue, `no such issue: ${rawId}`);
  appendLog(root, `${issue.id} review ${verdict} · ${findings.split('\n')[0]}`);
  return { id: issue.id, verdict };
}

// ---- rounds, branches, checks ------------------------------------------------------------------

function git(root, args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
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
  const base = flags.base || defaultBase(root);
  const tip = git(root, ['rev-parse', '--verify', flags.branch]);
  need(tip, `no such branch: ${flags.branch}`);
  const mergeBase = git(root, ['merge-base', base, flags.branch]);
  need(mergeBase, `no merge base between ${base} and ${flags.branch}`);
  const commits = (git(root, ['rev-list', '--count', `${mergeBase}..${flags.branch}`]) || '0');
  const changed = (git(root, ['diff', '--name-only', `${mergeBase}..${flags.branch}`]) || '').split('\n').filter(Boolean);
  // A change proves itself with a test and announces itself in the changelog, so neither is ever
  // "outside" the issue: the scope check is about source, not about the two files every issue touches.
  const alwaysInScope = (f) => isTestFile(f) || /(^|\/)CHANGELOG\.md$/i.test(f);
  const outside = issue.files.length ? changed.filter((f) => !alwaysInScope(f) && !issue.files.some((d) => f === d || f.startsWith(d.replace(/\/?$/, '/')))) : [];
  const testsBase = (git(root, ['ls-tree', '-r', '--name-only', mergeBase]) || '').split('\n').filter(isTestFile);
  const testsTip = (git(root, ['ls-tree', '-r', '--name-only', flags.branch]) || '').split('\n').filter(isTestFile);
  const removedTests = testsBase.filter((f) => !testsTip.includes(f));
  const touchedTests = changed.filter(isTestFile);
  const assertsBase = countAsserts(root, mergeBase, [...new Set([...touchedTests, ...removedTests])]);
  const assertsTip = countAsserts(root, flags.branch, touchedTests);
  const items = [
    { name: 'commits beyond base', ok: Number(commits) > 0, note: `${commits} commit(s) on ${flags.branch} beyond ${mergeBase.slice(0, 7)}` },
    { name: 'diff inside declared files', ok: outside.length === 0, note: issue.files.length ? (outside.length ? `outside ${issue.files.join(', ')}: ${outside.join(', ')}` : `${changed.length} file(s), all inside`) : 'no files declared on the issue — nothing to bound the diff by' },
    { name: 'test files', ok: removedTests.length === 0, note: removedTests.length ? `removed: ${removedTests.join(', ')}` : `${testsTip.length} on the branch, ${touchedTests.length} touched, none removed` },
    { name: 'assertions in touched tests', ok: assertsTip >= assertsBase, note: `${assertsBase} → ${assertsTip}` },
  ];
  return { id: issue.id, branch: flags.branch, base, mergeBase, changed, items, ok: items.every((i) => i.ok) };
}

// Every jarl/* branch, plus every branch some worktree has checked out that is not the base: a
// worker that never renamed its branch still did the work, and a listing that hides it would
// hide a report. Such a branch is marked unnamed so the merger renames it before merging.
export function cmdBranches(root, flags) {
  const base = flags.base || defaultBase(root);
  const named = (git(root, ['branch', '--list', 'jarl/*', '--format=%(refname:short)']) || '').split('\n').filter(Boolean);
  const worktrees = (git(root, ['worktree', 'list', '--porcelain']) || '').split('\n\n').map((b) => {
    const path = /^worktree (.*)$/m.exec(b)?.[1];
    const branch = /^branch refs\/heads\/(.*)$/m.exec(b)?.[1];
    return { path, branch };
  }).filter((w) => w.branch);
  const mainPath = git(root, ['rev-parse', '--show-toplevel']);
  const extra = worktrees.filter((w) => w.branch !== base && !named.includes(w.branch) && w.path !== mainPath).map((w) => w.branch);
  return [...named, ...extra].map((name) => {
    const mb = git(root, ['merge-base', base, name]);
    const ahead = mb ? Number(git(root, ['rev-list', '--count', `${mb}..${name}`]) || 0) : null;
    const wt = worktrees.find((w) => w.branch === name);
    const dirty = wt ? (git(wt.path, ['status', '--porcelain']) || '').split('\n').filter(Boolean).length : null;
    return { branch: name, ahead, worktree: wt ? wt.path : null, dirty, unnamed: !name.startsWith('jarl/') };
  });
}

// ---- questions to the user and the handoff --------------------------------------------------

function asksPath(root) { return join(jarlDir(root), 'asks.md'); }
const ASK_RE = /^- \*\*a-(\d{3})\*\* \((open|answered)\)(?: · issue (\d{3}))? · (.*)$/;

export function loadAsks(root) {
  const path = asksPath(root);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').map((l) => ASK_RE.exec(l)).filter(Boolean)
    .map((m) => ({ id: m[1], state: m[2], issue: m[3] || null, question: m[4] }));
}

export function cmdAsk(root, question, flags) {
  need(question, 'ask requires "<question>"');
  const asks = loadAsks(root);
  const id = String(asks.reduce((m, a) => Math.max(m, Number(a.id)), 0) + 1).padStart(3, '0');
  const path = asksPath(root);
  if (!existsSync(path)) writeFileSync(path, '# Questions to the user\n\n');
  appendFileSync(path, `- **a-${id}** (open)${flags.issue ? ` · issue ${String(flags.issue).padStart(3, '0')}` : ''} · ${question}\n`);
  appendLog(root, `asked a-${id} · ${question}`);
  return { id, question };
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
  const head = git(root, ['rev-parse', '--short', 'HEAD']) || '?';
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || '?';
  const text = `# Handoff\n\n**At:** ${stamp()} · **Head:** ${branch}@${head}\n\n## Summary\n${flags.summary}\n\n## In flight\n${inFlight.map((s) => `- ${s}`).join('\n') || '- (nothing)'}\n\n## Waiting on the user\n${open.map((s) => `- ${s}`).join('\n') || '- (nothing)'}\n\n## Next\n${next.map((s) => `- ${s}`).join('\n') || '- (nothing recorded)'}\n`;
  writeFileSync(handoffPath(root), text);
  appendLog(root, `handoff · ${flags.summary.split('\n')[0]}`);
  return { path: handoffPath(root), inFlight: inFlight.length, waiting: open.length };
}

export function cmdHandoffRead(root) {
  return existsSync(handoffPath(root)) ? readFileSync(handoffPath(root), 'utf8') : 'fresh start — no handoff recorded';
}

export function cmdReport(root) {
  const issues = loadIssues(root);
  const done = issues.filter((i) => i.status === 'done');
  const dropped = issues.filter((i) => i.status === 'dropped');
  const left = issues.filter((i) => i.status === 'open' || i.status === 'in-progress');
  const found = issues.filter((i) => i.fields['found by'] && !/^jarl\b/i.test(i.fields['found by']));
  const goal = existsSync(join(jarlDir(root), 'goal.md')) ? readFileSync(join(jarlDir(root), 'goal.md'), 'utf8').split('\n').slice(2).find((l) => l.trim()) || '' : '';
  const lines = [`# Report`, '', goal, '', `## Done (${done.length})`, ...done.map((i) => `- ${i.id} ${i.title} (${i.kind})`),
    '', `## Dropped (${dropped.length})`, ...dropped.map((i) => `- ${i.id} ${i.title} — ${(i.sections.evidence || '').trim().replace(/^Dropped:\s*/, '')}`),
    '', `## Still open (${left.length})`, ...left.map((i) => `- ${i.id} ${i.title} (${i.status})`),
    '', `## Found along the way (${found.length})`, ...found.map((i) => `- ${i.id} ${i.title} — ${i.fields['found by']}`)];
  return { done: done.length, dropped: dropped.length, left: left.length, found: found.length, text: lines.join('\n') + '\n' };
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
      case 'init': out = cmdInit(root, rest[0]); text = `opened ${out.dir}`; break;
      case 'new': out = cmdNew(root, rest[0], flags); text = `filed ${out.id} · ${out.file}`; break;
      case 'list': out = cmdList(root, flags); text = renderList(out); break;
      case 'show': { const i = findIssue(root, rest[0]); need(i, `no such issue: ${rest[0]}`); out = i; text = readFileSync(i.file, 'utf8'); break; }
      case 'set': out = cmdSet(root, rest[0], rest[1], rest[2]); text = `${out.id} → ${out.status}`; break;
      case 'tag': out = cmdTag(root, rest[0], rest.slice(1)); text = `${out.id} tags: ${out.tags.join(', ') || '(none)'}`; break;
      case 'prio': out = cmdPrio(root, rest[0], rest[1]); text = `${out.id} priority ${out.priority}`; break;
      case 'files': out = cmdFiles(root, rest[0], rest[1]); text = `${out.id} files: ${out.files.join(', ') || '(none)'}`; break;
      case 'evidence': out = cmdEvidence(root, rest[0], rest[1], flags); text = out.row ? `${out.id} evidence row recorded` : `${out.id} evidence recorded`; break;
      case 'next': out = cmdNext(root, flags); text = out.length ? out.map((r) => (r.ready ? `${r.id}  P${r.priority}  ${r.title}` : `${r.id}  P${r.priority}  ${r.title}  (waits on ${r.waitsOn.join(', ')})`)).join('\n') : '(nothing open)'; break;
      case 'review': out = cmdReview(root, rest[0], rest[1], rest[2]); text = `${out.id} review ${out.verdict}`; break;
      case 'round': out = cmdRound(root, rest[0], rest[1]); text = out.takeover ? `${out.id} round ${out.round} — takeover:\n\n${out.block}` : `${out.id} round ${out.round} of ${ROUNDS_BEFORE_TAKEOVER} before a takeover`; break;
      case 'check': out = cmdCheck(root, rest[0], flags); text = out.items.map((i) => `${i.ok ? '✓' : '✗'} ${i.name} — ${i.note}`).join('\n'); break;
      case 'branches': out = cmdBranches(root, flags); text = out.length ? out.map((b) => `${b.branch}  +${b.ahead ?? '?'}  ${b.worktree ? `${b.worktree}${b.dirty ? ` (${b.dirty} uncommitted)` : ' (clean)'}` : '(no worktree)'}${b.unnamed ? '  UNNAMED — rename to jarl/NNN-slug before merging' : ''}`).join('\n') : '(no worker branches)'; break;
      case 'ask': out = cmdAsk(root, rest[0], flags); text = `asked a-${out.id}`; break;
      case 'answer': out = cmdAnswer(root, rest[0], rest[1]); text = `answered a-${out.id}`; break;
      case 'handoff': if (rest[0] === 'write') { out = cmdHandoffWrite(root, flags); text = `handoff written · ${out.inFlight} in flight · ${out.waiting} waiting on the user`; } else { out = { text: cmdHandoffRead(root) }; text = out.text; } break;
      case 'report': out = cmdReport(root); text = out.text; break;
      case 'log': need(rest[0], 'log requires "<event>"'); appendLog(root, rest[0]); out = { logged: rest[0] }; text = 'logged'; break;
      case 'decide': need(rest[0] && rest[1], 'decide requires <slug> "<ruling>"'); appendDecision(root, rest[0], rest[1]); appendLog(root, `decided ${rest[0]}`); out = { slug: rest[0] }; text = `decided ${rest[0]}`; break;
      case 'status': out = cmdStatus(root); text = `open ${out.open} · in flight ${out['in-progress']} · done ${out.done} · dropped ${out.dropped} · questions ${out.questions}`; break;
      case 'close': out = cmdClose(root, flags); text = `removed ${out.removed}`; break;
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
