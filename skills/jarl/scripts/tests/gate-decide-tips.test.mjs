// The done gate read from the journal (issue 272), rulings with supersession (276), issues across several
// repositories (278) and the read-only tips view (282).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, chmodSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));

function run(root, args, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8', env: { ...process.env, ...env } });
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
function loop() {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-gate-'));
  mkdirSync(join(dir, '.git'));
  jarl(dir, 'init', 'goal');
  return dir;
}
const sh = (cwd, script) => execFileSync('bash', ['-c', script], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function reposBeside(...names) {
  const parent = mkdtempSync(join(tmpdir(), 'jarl-multi-'));
  const dirs = {};
  for (const name of ['hub', ...names]) {
    const dir = join(parent, name);
    mkdirSync(dir, { recursive: true });
    sh(dir, `git init -q -b ${name === 'hub' ? 'main' : 'feature'} && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null && mkdir src && echo 1 > src/a.mjs && echo 1 > src/b.mjs && git add -A && git commit -qm base`);
    dirs[name] = dir;
  }
  return { parent, ...dirs };
}

// ---- 272: the done gate ------------------------------------------------------------------------

test('done: evidence written before the issue went in progress is not proof; evidence after it is', () => {
  const root = loop();
  jarl(root, 'new', 'thing');
  jarl(root, 'evidence', '1', 'Source: a research report, finding X');   // a note at filing time
  jarl(root, 'set', '1', 'in-progress', 'raised', '--worker', 'w1');
  jarl(root, 'review', '1', 'approve', '--by', 'fresh-opus', 'read the diff');
  assert.match(refuses(root, 'set', '1', 'done', 'merged'), /001 has no evidence recorded since it was moved → in-progress/);
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', '63 pass');
  assert.equal(jarl(root, 'set', '1', 'done', 'merged'), '001 → done');
});

test('done: an issue that never went in progress needs evidence after its filing (older loops keep working)', () => {
  const root = loop();
  jarl(root, 'new', 'small');
  jarl(root, 'evidence', '1', 'fixed in place');
  jarl(root, 'review', '1', 'approve', '--by', 'jarl', 'ok');
  assert.equal(jarl(root, 'set', '1', 'done', 'ok'), '001 → done');
});

test('review: an approve needs --by, a self-approve by the worker is refused, and --by is recorded with its kind', () => {
  const root = loop();
  jarl(root, 'new', 'a'); jarl(root, 'new', 'b');
  jarl(root, 'set', '1,2', 'in-progress', 'pkg', '--worker', 'opus-worker-3', '--branch', 'jarl/001-pkg');
  assert.match(refuses(root, 'review', '1', 'approve', 'fine'), /a verdict needs --by/);
  assert.match(refuses(root, 'review', '1-2', 'approve', '--by', 'Opus-Worker-3', 'fine'), /001: an approve by Opus-Worker-3 is a self-approve \(opus-worker-3 is the issue's worker\).*nothing was written/);
  assert.match(refuses(root, 'review', '1', 'approve', '--by', 'self', 'fine'), /self-approve/);
  const log = () => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
  assert.doesNotMatch(log(), /review approve/, 'a refused approve writes nothing');
  // A changes verdict needs --by too, and may come from the worker: it is recorded, not refused.
  jarl(root, 'review', '1', 'changes', '--by', 'opus-worker-3', 'Important: a self-check found a hole');
  assert.match(refuses(root, 'review', '1', 'changes', 'Important: no reviewer named'), /a verdict needs --by/);
  assert.equal(jarl(root, 'review', '1,2', 'approve', '--by', 'fresh-opus', 'read it'), '001 review approve by fresh-opus (fresh) · acceptance: (none on file)\n002 review approve by fresh-opus (fresh) · acceptance: (none on file)');
  assert.match(log(), /001 review approve · by fresh-opus \(fresh\) · read it/);
  assert.match(jarl(root, 'review', '2', 'approve', '--by', 'jarl', 'also read'), /by jarl \(coordinator\)/);
  // The worker is found from the lease line too once the Worker field is gone.
  jarl(root, 'evidence', '1', '--ran', 't', '--saw', 'ok');
  jarl(root, 'set', '1', 'deferred', 'later');
  assert.match(refuses(root, 'review', '1', 'approve', '--by', 'opus-worker-3', 'x'), /self-approve/);
});

test('done: a reopen spends the approve and the evidence before it; a round spends the approve', () => {
  const root = loop();
  jarl(root, 'new', 'x');
  jarl(root, 'set', '1', 'in-progress', 'go');
  jarl(root, 'evidence', '1', '--ran', 't', '--saw', 'ok');
  jarl(root, 'review', '1', 'approve', '--by', 'r1', 'ok');
  jarl(root, 'set', '1', 'done', 'merged');
  jarl(root, 'set', '1', 'open', 'reopened: the fix was incomplete');
  const r = refuses(root, 'set', '1', 'done', 'again');
  assert.match(r, /no evidence recorded since it was moved → open/);
  jarl(root, 'evidence', '1', '--ran', 't2', '--saw', 'ok');
  assert.match(refuses(root, 'set', '1', 'done', 'again'), /no approving review newer than its last round or reopen/);
  jarl(root, 'review', '1', 'approve', '--by', 'r2', 'ok');
  jarl(root, 'round', '1', 'red on CI');
  assert.match(refuses(root, 'set', '1', 'done', 'again'), /no approving review/);
  jarl(root, 'review', '1', 'approve', '--by', 'r2', 'ok');
  assert.equal(jarl(root, 'set', '1', 'done', 'again'), '001 → done');
  // A re-lease of an issue already in progress is not a new start: its evidence stands.
  jarl(root, 'new', 'y');
  jarl(root, 'set', '2', 'in-progress', 'go', '--worker', 'a');
  jarl(root, 'evidence', '2', 'did it');
  jarl(root, 'set', '2', 'in-progress', 'handed over', '--worker', 'b');
  jarl(root, 'review', '2', 'approve', '--by', 'r', 'ok');
  assert.equal(jarl(root, 'set', '2', 'done', 'ok'), '002 → done');
});

test('done: an issue the journal does not know (a hand-made file) is read from its Evidence alone; an approve logged by hand as self never counts', () => {
  const root = loop();
  jarl(root, 'new', 'hand');
  const dir = join(root, '.jarl', 'issues');
  const f = readdirSync(dir).find((x) => x.startsWith('001-'));
  writeFileSync(join(dir, f.replace('001-', '002-')), readFileSync(join(dir, f), 'utf8').replace('# 001 ·', '# 002 ·').replace(/## Evidence\n/, '## Evidence\nold proof\n'));
  appendFileSync(join(root, '.jarl', 'log.md'), '- 2026-01-01 00:00 · 002 review approve · legacy approve\n');
  assert.equal(jarl(root, 'set', '2', 'done', 'legacy'), '002 → done');
  jarl(root, 'evidence', '1', 'x');
  appendFileSync(join(root, '.jarl', 'log.md'), '- 2026-01-01 00:00 · 001 review approve · by w (self) · hand-written\n');
  assert.match(refuses(root, 'set', '1', 'done', 'x'), /self-approve does not count/);
});

test('status and report show who reviewed the done work', () => {
  const root = loop();
  for (const t of ['a', 'b', 'c']) jarl(root, 'new', t);
  jarl(root, 'evidence', '1-3', 'proof');
  jarl(root, 'review', '1', 'approve', '--by', 'fresh-opus', 'ok');
  jarl(root, 'review', '2', 'approve', '--by', 'jarl', 'ok');
  appendFileSync(join(root, '.jarl', 'log.md'), '- 2026-01-01 00:00 · 003 review approve · an approve from before --by\n');
  jarl(root, 'set', '1-3', 'done', 'ok');
  assert.match(jarl(root, 'status'), /^done reviewed by: fresh 1 · coordinator 1 · self 0 · unrecorded 1$/m);
  assert.match(jarl(root, 'report'), /## Done \(3\)\nReviewed by: fresh 1 · coordinator 1 · self 0 · unrecorded 1/);
  assert.deepEqual(JSON.parse(jarl(root, 'report', '--json')).reviews, { fresh: 1, coordinator: 1, self: 0, unrecorded: 1 });
});

// ---- 276: rulings --------------------------------------------------------------------------------

test('decide: slugs are validated and compared as strings — q.r is not a duplicate of qxr, specials never crash', () => {
  const root = loop();
  jarl(root, 'decide', 'qxr', 'one');
  assert.match(jarl(root, 'decide', 'q.r', 'two'), /^decided q\.r · by owner$/);
  assert.match(refuses(root, 'decide', 'q.r', 'three'), /duplicate slug: q\.r/);
  for (const bad of ['a+b', '(x', 'a b', '[z]', 'x'.repeat(81), 'ż', '.dot']) {
    assert.match(refuses(root, 'decide', bad, 'r'), /a ruling's slug is letters, digits/, bad);
  }
  const lead = spawnSync(process.execPath, [SCRIPT, '--root', root, 'decide', '--', '-lead', 'r'], { encoding: 'utf8' });
  assert.match(lead.stderr, /a ruling's slug is letters, digits/);
  assert.match(refuses(root, 'decide', 'answers', 'r', '--by', ''), /--by needs a value/);
});

test('decide --supersedes marks the old ruling, --by records who ruled, decisions --live lists what is in force', () => {
  const root = loop();
  jarl(root, 'decide', 'no-subagents', 'Work without subagents.');
  jarl(root, 'decide', 'keep', 'Keep this.', '--by', 'jarl');
  assert.match(refuses(root, 'decide', 'subagents', 'x', '--supersedes', 'nope'), /no ruling nope in decisions.md/);
  assert.equal(jarl(root, 'decide', 'subagents-again', 'Use fresh reviewers again. $1 $& kept', '--supersedes', 'no-subagents'), 'decided subagents-again · by owner · supersedes no-subagents');
  const text = readFileSync(join(root, '.jarl', 'decisions.md'), 'utf8');
  assert.match(text, /## \d{4}-\d{2}-\d{2} · no-subagents\nWork without subagents\.\n\n\*\*By:\*\* owner\n\*\*Superseded by:\*\* subagents-again \(\d{4}-\d{2}-\d{2}\)\n\n## \d{4}-\d{2}-\d{2} · keep\nKeep this\.\n\n\*\*By:\*\* jarl\n/);
  assert.match(text, /· subagents-again\nUse fresh reviewers again\. \$1 \$& kept\n\n\*\*By:\*\* owner\n\*\*Supersedes:\*\* no-subagents\n$/);
  assert.match(refuses(root, 'decide', 'third', 'x', '--supersedes', 'no-subagents'), /already superseded by subagents-again/);
  const all = JSON.parse(jarl(root, 'decisions', '--json'));
  assert.deepEqual(all.map((d) => [d.slug, d.by, d.supersededBy]), [['no-subagents', 'owner', 'subagents-again'], ['keep', 'jarl', null], ['subagents-again', 'owner', null]]);
  const live = jarl(root, 'decisions', '--live');
  assert.doesNotMatch(live, /no-subagents ·|· no-subagents —/);
  assert.match(live, /· subagents-again · by owner · supersedes no-subagents — Use fresh reviewers again/);
  assert.match(jarl(root, 'decisions'), /no-subagents · by owner · SUPERSEDED by subagents-again/);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /decided subagents-again · by owner · supersedes no-subagents/);
});

// ---- 278: several repositories -------------------------------------------------------------------

test('an issue may name several repositories: files per repository, next keeps them apart, check needs --repo, report groups per repository', () => {
  const { hub, tool, lib } = reposBeside('tool', 'lib');
  jarl(hub, 'init', 'goal');
  jarl(hub, 'new', 'cross', '--repo', '../tool,../lib', '--files', 'tool/src/a.mjs,lib/src/a.mjs');
  assert.match(jarl(hub, 'show', '1'), /^\*\*Repo:\*\* \.\.\/tool, \.\.\/lib$/m);
  assert.match(refuses(hub, 'new', 'bad', '--repo', '../tool,../nope'), /not a git repository/);
  jarl(hub, 'new', 'only lib a', '--repo', '../lib', '--files', 'lib/src/a.mjs');
  jarl(hub, 'new', 'only tool b', '--repo', '../tool', '--files', 'tool/src/b.mjs');
  jarl(hub, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/001-cross');
  const next = JSON.parse(jarl(hub, 'next', '--json'));
  assert.deepEqual(next.find((r) => r.id === '002').waitsOn, ['lib/src/a.mjs'], 'the same file in lib waits');
  assert.equal(next.find((r) => r.id === '003').ready, true, 'another file in tool does not');
  // check: one repository at a time, bounded by the files declared in it.
  sh(tool, 'git checkout -q -b jarl/001-cross && echo 2 > src/a.mjs && echo 2 > src/b.mjs && git commit -qam w && git checkout -q feature');
  assert.match(refuses(hub, 'check', '1', '--branch', 'jarl/001-cross'), /names several repositories/);
  const r = run(hub, ['check', '1', '--branch', 'jarl/001-cross', '--repo', '../tool']);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /✗ diff inside declared files — outside tool\/src\/a\.mjs: src\/b\.mjs/);
  // branches finds the branch in the repository that has it; the lease is not gone while one has it.
  assert.match(jarl(hub, 'branches'), /\[tool\] jarl\/001-cross → 001/);
  assert.doesNotMatch(jarl(hub, 'status'), /branch gone/);
  // report: per repository, an issue naming two under each.
  for (const id of ['1', '2']) { jarl(hub, 'evidence', id, 'proof'); jarl(hub, 'review', id, 'approve', '--by', 'r', 'ok'); }
  jarl(hub, 'set', '1,2', 'done', 'ok');
  const rep = jarl(hub, 'report');
  assert.match(rep, /### lib \(2\)\n- 001 cross \(bug\)\n- 002 only lib a \(bug\)/);
  assert.match(rep, /### tool \(1\)\n- 001 cross \(bug\)/);
  assert.deepEqual(JSON.parse(jarl(hub, 'report', '--json')).byRepo, { lib: ['001', '002'], tool: ['001'] });
  assert.equal(jarl(hub, 'repo', '3', '../tool,../lib'), '003 repo: ../tool, ../lib');
});

// ---- 282: tips -------------------------------------------------------------------------------------

function ghStub(dir, runs) {
  const bin = join(dir, 'gh-stub');
  writeFileSync(bin, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo stub; exit 0; fi\necho "$@" >> "${join(dir, 'gh-calls')}"\ncat <<'JSON'\n${JSON.stringify(runs)}\nJSON\n`);
  chmodSync(bin, 0o755);
  return bin;
}

test('tips: branch tips against their upstream, CI from gh for pushed commits, nothing about CI without gh; it writes nothing', () => {
  const { parent, hub, tool } = reposBeside('tool');
  const bare = join(parent, 'tool.git');
  sh(parent, `git init -q --bare ${bare}`);
  sh(tool, `git remote add origin ${bare} && git push -q -u origin feature && git branch main && git push -q -u origin main && echo 3 > src/a.mjs && git commit -qam local`);
  jarl(hub, 'init', 'goal');
  jarl(hub, 'new', 'w', '--repo', '../tool', '--files', 'tool/src/b.mjs');
  jarl(hub, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/001-w');
  sh(tool, 'git branch jarl/001-w');
  const log = readFileSync(join(hub, '.jarl', 'log.md'), 'utf8');
  const gh = ghStub(parent, [{ conclusion: 'failure', status: 'completed', databaseId: 42, workflowName: 'CI' }, { conclusion: 'success', status: 'completed', databaseId: 41, workflowName: 'lint' }]);
  const r = run(hub, ['tips', '--json'], { JARL_GH: gh });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.equal(o.gh, true);
  const t = o.repos.find((x) => x.repo === 'tool');
  const row = (b) => t.rows.find((x) => x.branch === b);
  assert.deepEqual([row('jarl/001-w').role, row('jarl/001-w').against, row('jarl/001-w').ahead, row('jarl/001-w').ci], ['feature', 'feature', 0, undefined], 'a worker branch never pushed: compared to the release branch, no CI');
  assert.deepEqual(row('jarl/001-w').issues, ['001']);
  assert.deepEqual([row('feature').role, row('feature').upstream, row('feature').ahead, row('feature').behind], ['release', 'origin/feature', 1, 0]);
  assert.deepEqual(row('feature').ci, { state: 'red', runs: 2, run: 42, workflow: 'CI', conclusion: 'failure' });
  assert.equal(row('main').role, 'main');
  assert.match(readFileSync(join(parent, 'gh-calls'), 'utf8'), /run list --commit [0-9a-f]{40} --json/);
  const text = run(hub, ['tips'], { JARL_GH: gh }).stdout;
  assert.match(text, /\[tool\] .*\n {2}feature {2}jarl\/001-w [0-9a-f]{12} {2}= feature {2}→ 001\n {2}release {2}feature [0-9a-f]{12} {2}\+1\/-0 vs origin\/feature {2}ci red \(run 42 CI\)/);
  // Without gh: the same view, with no CI and no error.
  const none = JSON.parse(run(hub, ['tips', '--json'], { JARL_GH: join(parent, 'no-such-gh') }).stdout);
  assert.equal(none.gh, false);
  assert.equal(none.repos.find((x) => x.repo === 'tool').rows.find((x) => x.branch === 'feature').ci, undefined);
  assert.equal(readFileSync(join(hub, '.jarl', 'log.md'), 'utf8'), log, 'tips writes nothing');
});
