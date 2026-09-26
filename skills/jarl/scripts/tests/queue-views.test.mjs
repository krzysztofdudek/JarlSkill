// The merge queue as a derived view and changelog fragments (issue 284), and the views and templates a
// dashboard or a release checklist is built from (289).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));

function run(root, args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}
function jarl(root, ...args) {
  const r = run(root, args);
  if (r.status !== 0) throw new Error(`jarl ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}
function refuses(root, ...args) {
  const r = run(root, args);
  assert.notEqual(r.status, 0, `expected a refusal: ${args.join(' ')}`);
  return r.stderr;
}
const sh = (cwd, script) => execFileSync('bash', ['-c', script], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
// A git repository on branch `feature` holding the loop (default mode) and two source files.
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-queue-'));
  sh(dir, 'git init -q -b feature && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null && mkdir src && echo 1 > src/a.mjs && echo 1 > src/b.mjs && git add -A && git commit -qm base');
  jarl(dir, 'init', 'goal');
  return dir;
}
function branchWith(dir, branch, file) {
  const wt = mkdtempSync(join(tmpdir(), 'jarl-wt-'));
  sh(dir, `git worktree add -q -b ${branch} ${wt} feature`);
  sh(wt, `echo change >> ${file} && git add -A && git commit -qm "work on ${branch}"`);
  return wt;
}

// ---- 284: the queue ------------------------------------------------------------------------------

test('queue: approved, ahead of the base and not merged — in the order of approval; unapproved and merged branches stay out', () => {
  const root = repo();
  jarl(root, 'new', 'first', '--files', 'src/a.mjs');
  jarl(root, 'new', 'second', '--files', 'src/b.mjs');
  jarl(root, 'new', 'third', '--files', 'src/b.mjs');
  jarl(root, 'new', 'not reviewed', '--files', 'src/a.mjs');
  jarl(root, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/001-first', '--worker', 'w1');
  jarl(root, 'set', '2', 'in-progress', 'go', '--branch', 'jarl/002-second', '--worker', 'w2');
  jarl(root, 'set', '4', 'in-progress', 'go', '--branch', 'jarl/004-not', '--worker', 'w4');
  branchWith(root, 'jarl/001-first', 'src/a.mjs');
  branchWith(root, 'jarl/002-second', 'src/b.mjs');
  branchWith(root, 'jarl/004-not', 'src/a.mjs');
  // 002 approved before 001: the queue follows the approvals, not the numbers.
  jarl(root, 'review', '2', 'approve', '--by', 'rev', 'ok');
  jarl(root, 'review', '1', 'approve', '--by', 'rev', 'ok');
  const q = JSON.parse(jarl(root, 'queue', '--json'));
  assert.equal(q.repos.length, 1);
  const rows = q.repos[0].rows;
  assert.deepEqual(rows.map((r) => r.branch), ['jarl/002-second', 'jarl/001-first']);
  assert.deepEqual(rows.map((r) => r.issues), [['002'], ['001']]);
  assert.equal(rows[0].ahead, 1);
  assert.equal(q.repos[0].base, 'feature');
  // Files do not overlap, so both go in one batch.
  assert.deepEqual(rows.map((r) => r.batch), [1, 1]);
  const text = jarl(root, 'queue');
  assert.match(text, /1\. jarl\/002-second → 002/);
  assert.doesNotMatch(text, /004/);
  // Once merged into the base, a branch leaves the queue by itself.
  sh(root, 'git merge -q --no-ff jarl/002-second -m "merge 002"');
  assert.deepEqual(JSON.parse(jarl(root, 'queue', '--json')).repos[0].rows.map((r) => r.branch), ['jarl/001-first']);
});

test('queue: a round spends the approve, overlapping files start a new batch, a package lists who still waits for review', () => {
  const root = repo();
  jarl(root, 'new', 'a', '--files', 'src/a.mjs');
  jarl(root, 'new', 'b', '--files', 'src/a.mjs');
  jarl(root, 'new', 'c', '--files', 'src/b.mjs');
  jarl(root, 'new', 'd', '--files', 'src/b.mjs');
  jarl(root, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/001-a', '--worker', 'w1');
  jarl(root, 'set', '2', 'in-progress', 'go', '--branch', 'jarl/002-b', '--worker', 'w2');
  jarl(root, 'set', '3,4', 'in-progress', 'pkg', '--branch', 'jarl/003-pkg', '--worker', 'w3');
  branchWith(root, 'jarl/001-a', 'src/a.mjs');
  branchWith(root, 'jarl/002-b', 'src/a.mjs');
  branchWith(root, 'jarl/003-pkg', 'src/b.mjs');
  jarl(root, 'review', '1', 'approve', '--by', 'rev', 'ok');
  jarl(root, 'review', '2', 'approve', '--by', 'rev', 'ok');
  jarl(root, 'review', '3', 'approve', '--by', 'rev', 'ok');
  let rows = JSON.parse(jarl(root, 'queue', '--json')).repos[0].rows;
  const byBranch = Object.fromEntries(rows.map((r) => [r.branch, r]));
  assert.equal(byBranch['jarl/001-a'].batch, 1);
  assert.equal(byBranch['jarl/002-b'].batch, 2, 'the same file as 001 never rides in its batch');
  assert.deepEqual(byBranch['jarl/003-pkg'].issues, ['003']);
  assert.deepEqual(byBranch['jarl/003-pkg'].waitingReview, ['004']);
  assert.equal(byBranch['jarl/003-pkg'].ready, false);
  assert.equal(byBranch['jarl/001-a'].ready, true);
  jarl(root, 'round', '1', 'check red');
  rows = JSON.parse(jarl(root, 'queue', '--json')).repos[0].rows;
  assert.ok(!rows.some((r) => r.branch === 'jarl/001-a'), 'a round spends the approve: the branch leaves the queue');
});

test('queue: an issue in another repository is queued there; --repo reads one repository; nothing is written', () => {
  const parent = mkdtempSync(join(tmpdir(), 'jarl-queue-multi-'));
  const hub = join(parent, 'hub'); const tool = join(parent, 'tool');
  for (const d of [hub, tool]) { mkdirSync(d); sh(d, 'git init -q -b feature && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null && mkdir src && echo 1 > src/a.mjs && git add -A && git commit -qm base'); }
  jarl(hub, 'init', 'goal');
  jarl(hub, 'new', 'in tool', '--repo', '../tool', '--files', 'tool/src/a.mjs');
  jarl(hub, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/001-t', '--worker', 'w');
  branchWith(tool, 'jarl/001-t', 'src/a.mjs');
  jarl(hub, 'review', '1', 'approve', '--by', 'rev', 'ok');
  const before = readFileSync(join(hub, '.jarl', 'log.md'), 'utf8');
  const q = JSON.parse(jarl(hub, 'queue', '--json'));
  const toolRows = q.repos.find((r) => r.repo === 'tool').rows;
  assert.deepEqual(toolRows.map((r) => r.branch), ['jarl/001-t']);
  assert.equal(JSON.parse(jarl(hub, 'queue', '--repo', '../tool', '--json')).repos.length, 1);
  assert.equal(readFileSync(join(hub, '.jarl', 'log.md'), 'utf8'), before, 'queue writes nothing');
});

// ---- 284: changelog fragments --------------------------------------------------------------------

test('changelog: fragments recorded on the issue print grouped for [Unreleased]; unprefixed lines follow the issue kind', () => {
  const root = repo();
  jarl(root, 'new', 'a feature', '--kind', 'gap', '--changelog', 'Added: `queue` shows the merge queue.', '--changelog', 'Changed: `report` groups by repository.');
  jarl(root, 'new', 'a bug', '--kind', 'bug');
  jarl(root, 'body', '2', '--changelog', 'A value starting with $1 or $& is written as it is.');
  jarl(root, 'new', 'silent');
  const shown = jarl(root, 'show', '1');
  assert.match(shown, /## Changelog\n- Added: `queue` shows the merge queue\.\n- Changed: `report` groups by repository\.\n\n## Evidence/);
  const r = run(root, ['changelog', '1-3']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '### Added\n- `queue` shows the merge queue.\n\n### Changed\n- `report` groups by repository.\n\n### Fixed\n- A value starting with $1 or $& is written as it is.');
  assert.match(r.stderr, /no changelog fragment: 003/);
  const j = JSON.parse(jarl(root, 'changelog', '1,2', '--json'));
  assert.deepEqual(j.sections, { Added: ['`queue` shows the merge queue.'], Changed: ['`report` groups by repository.'], Fixed: ['A value starting with $1 or $& is written as it is.'] });
  // body --changelog replaces the fragment, it never appends.
  jarl(root, 'body', '2', '--changelog', 'Fixed: something else.');
  assert.equal(jarl(root, 'changelog', '2'), '### Fixed\n- something else.');
  assert.match(refuses(root, 'changelog'), /changelog requires <ids>/);
});

test('changelog: an issue naming several repositories prints under each; --repo keeps one', () => {
  const parent = mkdtempSync(join(tmpdir(), 'jarl-cl-multi-'));
  const dirs = {};
  for (const n of ['hub', 'tool', 'lib']) { dirs[n] = join(parent, n); mkdirSync(dirs[n]); sh(dirs[n], 'git init -q -b main && git commit -q --allow-empty -m base'); }
  jarl(dirs.hub, 'init', 'goal');
  jarl(dirs.hub, 'new', 'both', '--kind', 'gap', '--repo', '../tool,../lib', '--changelog', 'Added: both.');
  jarl(dirs.hub, 'new', 'tool only', '--kind', 'gap', '--repo', '../tool', '--changelog', 'Added: tool.');
  const all = jarl(dirs.hub, 'changelog', '1,2');
  assert.match(all, /^## lib\n\n### Added\n- both\.\n\n## tool\n\n### Added\n- both\.\n- tool\.$/);
  assert.equal(jarl(dirs.hub, 'changelog', '1,2', '--repo', '../lib'), '### Added\n- both.');
});

// ---- 289: templates ------------------------------------------------------------------------------

test('new --template reads .jarl/templates/<name>.md: its fields are defaults, its sections the body, flags win', () => {
  const root = repo();
  mkdirSync(join(root, '.jarl', 'templates'));
  writeFileSync(join(root, '.jarl', 'templates', 'release-phase.md'), '# release phase\n\n**Kind:** process\n**Priority:** 1\n**Tags:** release\n\n## What\nOne phase of the release checklist.\n\n## Why\nA step skipped here is found by a user.\n\n## Acceptance\n- the tag exists on the remote\n- CI is green on the tag\n');
  jarl(root, 'new', 'Phase A: tag', '--template', 'release-phase', '--why', 'Overridden.');
  const i = jarl(root, 'show', '1');
  assert.match(i, /\*\*Kind:\*\* process/);
  assert.match(i, /\*\*Priority:\*\* 1/);
  assert.match(i, /\*\*Tags:\*\* release/);
  assert.match(i, /## What\nOne phase of the release checklist\.\n/);
  assert.match(i, /## Why\nOverridden\.\n/);
  assert.match(i, /## Acceptance\n- the tag exists on the remote\n- CI is green on the tag\n/);
  jarl(root, 'new', 'Phase B', '--template', 'release-phase', '--kind', 'docs', '--after', '1');
  assert.match(jarl(root, 'show', '2'), /\*\*Kind:\*\* docs[\s\S]*\*\*After:\*\* 001/);
  assert.match(refuses(root, 'new', 'x', '--template', 'nope'), /no template nope in .*templates — templates here: release-phase/);
  assert.match(refuses(root, 'new', 'x', '--template', '../goal'), /a template is named by letters, digits/);
  // Templates outlive the loop: archive leaves them for the next one.
  jarl(root, 'archive', 'first');
  assert.ok(existsSync(join(root, '.jarl', 'templates', 'release-phase.md')));
});

// ---- 289: views ------------------------------------------------------------------------------------

test('status --by groups the counts by kind, tag, priority or repository; report --json carries one row per issue', () => {
  const root = repo();
  jarl(root, 'new', 'a', '--kind', 'bug', '--tags', 'x,y');
  jarl(root, 'new', 'b', '--kind', 'gap', '--tags', 'x');
  jarl(root, 'new', 'c', '--kind', 'gap');
  jarl(root, 'set', '3', 'dropped', 'not needed');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'ok');
  jarl(root, 'review', '1', 'approve', '--by', 'rev', 'ok');
  jarl(root, 'set', '1', 'done', 'ok');
  const s = JSON.parse(jarl(root, 'status', '--by', 'kind', '--json'));
  assert.deepEqual(s.by, { key: 'kind', groups: { bug: { open: 0, 'in-progress': 0, done: 1, dropped: 0, deferred: 0 }, gap: { open: 1, 'in-progress': 0, done: 0, dropped: 1, deferred: 0 } } });
  const t = JSON.parse(jarl(root, 'status', '--by', 'tag', '--json'));
  assert.deepEqual(Object.keys(t.by.groups).sort(), ['(none)', 'x', 'y']);
  assert.equal(t.by.groups.x.done, 1);
  assert.match(jarl(root, 'status', '--by', 'repo'), /by repo:\n {2}jarl-queue-\S+ +open 1 · in flight 0 · done 1 · dropped 1 · deferred 0/);
  assert.match(refuses(root, 'status', '--by', 'colour'), /--by is one of: repo, tag, kind, prio/);
  // Without --by the shape is what it was.
  assert.equal(JSON.parse(jarl(root, 'status', '--json')).by, undefined);
  const rep = JSON.parse(jarl(root, 'report', '--json'));
  const one = rep.issues.find((i) => i.id === '001');
  assert.deepEqual({ ...one, repos: undefined }, { id: '001', title: 'a', status: 'done', kind: 'bug', priority: '2', tier: 'standard', tags: ['x', 'y'], repos: undefined, branch: null, after: [], sources: [], merged: null, ci: null, review: { by: 'rev', kind: 'fresh', at: one.review.at } });
  assert.equal(rep.issues.length, 3);
});
