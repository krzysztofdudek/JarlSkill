// resume: the state a session picks the loop up from, assembled live; handoff write retired (issue 423).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, chmodSync, cpSync, statSync } from 'node:fs';
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
const sh = (cwd, script) => execFileSync('bash', ['-c', script], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
// Every file under .jarl/ with its contents: a read-only command leaves this exactly as it was.
function snapshot(root) {
  const out = {};
  const walk = (dir, rel) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p, `${rel}${f}/`); else out[`${rel}${f}`] = readFileSync(p, 'utf8'); } };
  walk(join(root, '.jarl'), '');
  return out;
}
function ghStub(dir) {
  const bin = join(dir, 'gh-stub');
  writeFileSync(bin, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo stub; exit 0; fi\necho "$@" >> "${join(dir, 'gh-calls')}"\necho '[{"conclusion":"success","status":"completed","databaseId":7,"workflowName":"CI"}]'\n`);
  chmodSync(bin, 0o755);
  return bin;
}

// A hub holding a committed loop and a tool repository beside it with a remote, so every section has something in it.
function world() {
  const parent = mkdtempSync(join(tmpdir(), 'jarl-resume-'));
  const hub = join(parent, 'hub');
  const tool = join(parent, 'tool');
  for (const [dir, branch] of [[hub, 'main'], [tool, 'release']]) {
    mkdirSync(dir);
    sh(dir, `git init -q -b ${branch} && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null && mkdir src && echo 1 > src/a.mjs && echo 1 > src/b.mjs && echo 1 > src/c.mjs && git add -A && git commit -qm base`);
  }
  sh(parent, 'git init -q --bare tool.git');
  sh(tool, `git remote add origin ${join(parent, 'tool.git')} && git push -q -u origin release && git branch main && git push -q -u origin main`);
  jarl(hub, 'init', 'ship the export command', '--committed');
  sh(hub, 'git add -A && git commit -qm loop');
  return { parent, hub, tool };
}

test('resume assembles every section live from the loop and the repositories its issues name, and writes nothing', () => {
  const { parent, hub, tool } = world();
  // Rulings: one in force, one superseded (left out).
  jarl(hub, 'decide', 'old-way', 'do it the old way');
  jarl(hub, 'decide', 'new-way', 'do it the new way\nwith a second line', '--supersedes', 'old-way');
  // In flight with a lease, in the tool repository, with a worker branch one commit ahead.
  jarl(hub, 'new', 'in flight one', '--repo', '../tool', '--files', 'tool/src/a.mjs', '--acceptance', 'works');
  jarl(hub, 'set', '1', 'in-progress', 'raised', '--branch', 'jarl/001-one', '--worker', 'w1');
  sh(tool, 'git checkout -q -b jarl/001-one && echo 2 > src/a.mjs && git commit -qam one && git checkout -q release');
  // Waiting on After, ready ones, a question, a ratify item.
  jarl(hub, 'new', 'waits for one', '--after', '1');
  jarl(hub, 'new', 'ready two', '--prio', '1', '--acceptance', 'x');
  jarl(hub, 'new', 'ready three');
  jarl(hub, 'ask', 'which flag name?', '--issue', '3');
  jarl(hub, 'ask', 'kept the old default under the mandate', '--kind', 'ratify', '--issue', '1');
  // An approved branch waiting for the merger.
  jarl(hub, 'new', 'queued five', '--repo', '../tool', '--files', 'tool/src/b.mjs');
  jarl(hub, 'set', '5', 'in-progress', 'raised', '--branch', 'jarl/005-five', '--worker', 'w5');
  sh(tool, 'git checkout -q -b jarl/005-five && echo 2 > src/b.mjs && git commit -qam five && git checkout -q release');
  jarl(hub, 'review', '5', 'approve', '--by', 'rev', 'ok');
  // Merged with CI pending, and one with CI red.
  jarl(hub, 'new', 'merged six', '--repo', '../tool');
  jarl(hub, 'merged', '6', '--sha', sh(tool, 'git rev-parse --short release'), '--ci', 'pending', '--repo', '../tool');
  jarl(hub, 'new', 'merged seven', '--repo', '../tool');
  jarl(hub, 'merged', '7', '--sha', sh(tool, 'git rev-parse --short release'), '--ci', 'red', '--repo', '../tool');

  const before = snapshot(hub);
  const r = run(hub, ['resume'], { JARL_GH: ghStub(parent) });
  assert.equal(r.status, 0, r.stderr);
  const t = r.stdout;
  assert.match(t, /^# Resume · ship the export command\nopened \S+ \S+ · last activity \S+ \S+\nopen 4 · in flight 2 · waiting 1 · done 0 · dropped 0 · deferred 0 · questions 1 · to ratify 1 · merged, CI pending 1 · CI red 1\n/);
  assert.match(t, /## Rulings in force \(1\)\n- \S+ · new-way · by owner — do it the new way\n\n/);
  assert.doesNotMatch(t, /old-way ·/, 'a superseded ruling is not in force');
  assert.match(t, /## In flight \(2\)\n- 001 in flight one · branch jarl\/001-one · worker w1 · since \S+ \S+\n- 005 queued five · branch jarl\/005-five · worker w5 · since \S+ \S+\n/);
  assert.match(t, /## Waiting — After not settled \(1\)\n- 002 waits for one \(after 001\)\n/);
  assert.match(t, /## Questions to the user \(1\)\n- a-001 \(stuck\) issue 003 · which flag name\?\n/);
  assert.match(t, /## To ratify \(1\)\n- a-002 \(issue 001\) · kept the old default under the mandate\n/);
  assert.match(t, /## Next ready \(4 of 4\)\n- 003  P1  ready two\n- 004  P2  ready three  \(no acceptance yet\)\n- 006  P2  merged six  \(no acceptance yet\)\n- 007  P2  merged seven  \(no acceptance yet\)\n/);
  assert.match(t, /## Merge queue\n\[tool\] into release\n  1\. jarl\/005-five → 005  \+1  approved \S+ \S+ by rev  batch 1\n/);
  assert.match(t, /## Merged, CI pending or red \(2\)\n- 006 [0-9a-f]+ in \.\.\/tool · CI pending\n- 007 [0-9a-f]+ in \.\.\/tool · CI red\n/);
  assert.match(t, /## Tips \(CI not asked — --ci asks gh\)\n/);
  assert.match(t, /^\[tool\] .*\n {2}feature {2}jarl\/001-one [0-9a-f]{12} {2}\+1\/-0 vs release {2}not pushed {2}→ 001\n {2}feature {2}jarl\/005-five [0-9a-f]{12} {2}\+1\/-0 vs release {2}not pushed {2}→ 005\n {2}release {2}release [0-9a-f]{12} {2}= origin\/release\n {2}main {5}main [0-9a-f]{12} {2}= origin\/main$/m);
  assert.match(t, /## Loop files not committed \(\d+\) — commit \.jarl\/\n- \.jarl\/asks\.md\n/);
  assert.match(t, /## Last 15 log line\(s\)\n(- \S+ \S+ · .*\n){14}- \S+ \S+ · 007 merged /);
  assert.equal(existsSync(join(parent, 'gh-calls')), false, 'no --ci: gh is never run');
  assert.deepEqual(snapshot(hub), before, 'resume writes nothing: no log line, no lock, no file');

  // --log and --ready narrow the two long sections; --ci asks gh for the pushed tips only.
  const narrow = run(hub, ['resume', '--log', '2', '--ready', '1', '--ci'], { JARL_GH: ghStub(parent) }).stdout;
  assert.match(narrow, /## Next ready \(1 of 4\)\n- 003  P1  ready two\n\n/);
  assert.match(narrow, /## Last 2 log line\(s\)\n- \S+ \S+ · filed 007 · merged seven\n- \S+ \S+ · 007 merged \S+ in \.\.\/tool · CI red$/);
  assert.match(narrow, /## Tips\n/);
  assert.match(narrow, / {2}release {2}release [0-9a-f]{12} {2}= origin\/release {2}ci green \(run 7 CI\)/);
  assert.equal(readFileSync(join(parent, 'gh-calls'), 'utf8').trim().split('\n').length, 2, 'gh asked about the two pushed tips, release and main');
  assert.match(run(hub, ['resume', '--log', 'x']).stderr, /--log takes a whole number/);

  // JSON: the same sections as data.
  const o = JSON.parse(run(hub, ['resume', '--json'], { JARL_GH: ghStub(parent) }).stdout);
  assert.deepEqual(Object.keys(o), ['goal', 'opened', 'lastActivity', 'archived', 'status', 'rulings', 'inFlight', 'waiting', 'questions', 'ratify', 'held', 'next', 'readyTotal', 'queue', 'merged', 'tips', 'uncommitted', 'log', 'legacyHandoff']);
  assert.deepEqual(o.inFlight[0], { id: '001', title: 'in flight one', branch: 'jarl/001-one', worker: 'w1', since: o.inFlight[0].since, stale: [] });
  assert.deepEqual(o.merged.map((m) => [m.id, m.ci]), [['006', 'pending'], ['007', 'red']]);
  assert.equal(o.tips.ci, false);
  assert.equal(o.legacyHandoff, null);

  // The sections sum to the counts line. An issue in progress that waits on After is under Waiting, not In flight;
  // an open one whose file is taken by work in flight is Held, naming who holds it. In text and in JSON.
  jarl(hub, 'new', 'eight');
  jarl(hub, 'after', '5', '8');
  jarl(hub, 'new', 'held nine', '--repo', '../tool', '--files', 'tool/src/a.mjs');
  const w = jarl(hub, 'resume');
  const st = JSON.parse(jarl(hub, 'status', '--json'));
  assert.deepEqual([st.ready, st.inFlight, st.waiting], [6, 1, 2]);
  assert.match(w, /\nopen 6 · in flight 1 · waiting 2 · /);
  assert.match(w, /## In flight \(1\)\n- 001 in flight one · branch jarl\/001-one · worker w1 · since \S+ \S+\n\n/);
  assert.match(w, /## Waiting — After not settled \(2\)\n- 002 waits for one \(after 001\)\n- 005 queued five \(after 008\) · in progress · branch jarl\/005-five · worker w5 · since \S+ \S+\n/);
  assert.match(w, /## Held — files in flight \(1\)\n- 009  P2  held nine \(tool\/src\/a\.mjs held by 001\)\n/);
  assert.match(w, /## Next ready \(5 of 5\)\n/);
  const wo = JSON.parse(jarl(hub, 'resume', '--json'));
  assert.deepEqual([wo.inFlight.length, wo.waiting.length, wo.held.length + wo.readyTotal], [wo.status.inFlight, wo.status.waiting, wo.status.ready]);
  assert.deepEqual(wo.waiting.map((x) => [x.id, x.status]), [['002', 'open'], ['005', 'in-progress']]);
  assert.deepEqual(wo.held, [{ id: '009', title: 'held nine', priority: '2', files: ['tool/src/a.mjs'], heldBy: ['001'] }]);

  // A lease that went wrong is flagged in place, in flight or waiting.
  sh(tool, 'git branch -D jarl/001-one jarl/005-five');
  const gone = jarl(hub, 'resume');
  assert.match(gone, /- 001 in flight one · branch jarl\/001-one · worker w1 · since \S+ \S+ · STALE: branch gone: jarl\/001-one\n/);
  assert.match(gone, /- 005 queued five \(after 008\) · in progress · branch jarl\/005-five · worker w5 · since \S+ \S+ · STALE: branch gone: jarl\/005-five\n/);

  // --log 0 leaves the log out.
  assert.doesNotMatch(jarl(hub, 'resume', '--log', '0'), /log line|empty log/);
  assert.equal(JSON.parse(jarl(hub, 'resume', '--log', '0', '--json')).log, null);
});

test('resume in a git repository with no worker branches: Tips shows the release branch and main, nothing else', () => {
  const { hub } = world();
  jarl(hub, 'new', 'one');
  const t = jarl(hub, 'resume');
  assert.match(t, /## Tips \(CI not asked — --ci asks gh\)\n\[hub\] \S+\n {2}release {2}main [0-9a-f]{12} {2}\(no upstream\) {2}not pushed\n\n## /);
  assert.doesNotMatch(t, /feature {2}/);
});

// The live loop of the family release, when this checkout sits beside it: resume and handoff read on a copy, with
// its old handoff.md shown as history. Skipped anywhere else.
const LIVE = process.env.JARL_LIVE_LOOP || join(fileURLToPath(new URL('.', import.meta.url)), '../../../../../Vision/core/toolset/release-6.1.0');
test('a copy of a live loop from before resume: resume reads it, handoff read shows its handoff.md as history', { skip: !existsSync(join(LIVE, '.jarl', 'handoff.md')) && 'no live loop beside this checkout' }, () => {
  const copy = mkdtempSync(join(tmpdir(), 'jarl-live-'));
  cpSync(join(LIVE, '.jarl'), join(copy, '.jarl'), { recursive: true });
  const before = snapshot(copy);
  const r = run(copy, ['resume'], { JARL_GH: join(copy, 'no-gh') });
  assert.equal(r.status, 0, r.stderr);
  for (const h of ['## Rulings in force', '## In flight', '## Questions to the user', '## Next ready', '## Merge queue', '## Last 15 log line(s)']) assert.ok(r.stdout.includes(h), h);
  assert.match(r.stdout, /a handoff file from before resume is kept at \.jarl\/handoff\.md/);
  const h = run(copy, ['handoff', 'read'], { JARL_GH: join(copy, 'no-gh') }).stdout;
  assert.match(h, /\n## Earlier handoff — history, written \S+ \S+, \S+ ago; not the current state\n\*\*At:\*\* /);
  assert.match(h, /\n### Summary\n/);
  assert.deepEqual(snapshot(copy), before, 'nothing written to the copy');
});
