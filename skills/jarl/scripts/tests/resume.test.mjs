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
  assert.deepEqual(Object.keys(o), ['goal', 'opened', 'lastActivity', 'archived', 'status', 'rulings', 'inFlight', 'waiting', 'questions', 'ratify', 'next', 'readyTotal', 'queue', 'merged', 'tips', 'uncommitted', 'log', 'legacyHandoff']);
  assert.deepEqual(o.inFlight[0], { id: '001', title: 'in flight one', branch: 'jarl/001-one', worker: 'w1', since: o.inFlight[0].since, waitsOn: [], stale: [] });
  assert.deepEqual(o.merged.map((m) => [m.id, m.ci]), [['006', 'pending'], ['007', 'red']]);
  assert.equal(o.tips.ci, false);
  assert.equal(o.legacyHandoff, null);

  // A lease that went wrong is flagged in place.
  sh(tool, 'git branch -D jarl/001-one');
  assert.match(jarl(hub, 'resume'), /- 001 in flight one · branch jarl\/001-one · worker w1 · since \S+ \S+ · STALE: branch gone: jarl\/001-one\n/);
});

test('handoff write is retired: it takes its old flags, writes nothing, says so and exits 0; handoff read is resume plus the old file as history', () => {
  const { hub } = world();
  jarl(hub, 'new', 'one');
  const before = snapshot(hub);
  const r = run(hub, ['handoff', 'write', '--summary', 'the plan', '--next', 'raise one']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^handoff write is retired: nothing written\. The state a session resumes from is assembled live — run jarl\.mjs resume\./);
  assert.deepEqual(snapshot(hub), before, 'no handoff.md, no log line');
  assert.equal(existsSync(join(hub, '.jarl', 'handoff.md')), false);
  assert.deepEqual(JSON.parse(jarl(hub, 'handoff', 'write', '--json')), { retired: true, wrote: null, note: r.stdout });
  // With no file kept, read is resume itself.
  const resumed = jarl(hub, 'resume');
  assert.equal(jarl(hub, 'handoff', 'read'), resumed);
  assert.equal(jarl(hub, 'handoff'), resumed, 'a bare handoff reads');
  assert.match(run(hub, ['handoff', 'rewrite']).stderr, /handoff takes read or write/);
  // status no longer carries a handoff age in its text.
  writeFileSync(join(hub, '.jarl', 'handoff.md'), '# Handoff\n\n**At:** 2026-01-01 00:00 · **Head:** main@abc1234\n\n## Summary\nthe old plan\n\n## Next\n- raise one\n');
  assert.doesNotMatch(jarl(hub, 'status'), /handoff/);
  const h = jarl(hub, 'handoff', 'read');
  assert.ok(h.startsWith(jarl(hub, 'resume')), 'read starts with exactly what resume prints');
  assert.match(h, /\n\n## Earlier handoff — history, written 2026-01-01 00:00, \d+d ago; not the current state\n\*\*At:\*\* 2026-01-01 00:00 · \*\*Head:\*\* main@abc1234\n\n### Summary\nthe old plan\n\n### Next\n- raise one$/);
  const js = JSON.parse(jarl(hub, 'handoff', 'read', '--json'));
  assert.match(js.history, /the old plan/);
  assert.equal(js.legacyHandoff.at, '2026-01-01 00:00');
});

test('resume stays fast on a loop of hundreds of issues naming another repository and a long log', () => {
  const { hub, tool } = world();
  const dir = join(hub, '.jarl', 'issues');
  const statuses = ['done', 'done', 'done', 'open', 'in-progress'];
  for (let n = 1; n <= 425; n += 1) {
    const id = String(n).padStart(3, '0');
    const status = statuses[n % statuses.length];
    const lease = status === 'in-progress' ? `**Branch:** jarl/${id}-x\n**Worker:** w\n**Since:** 2026-09-27 06:00\n` : '';
    const merged = status === 'done' ? `**Merged:** abc1234 in ../tool\n**CI:** green\n` : '';
    writeFileSync(join(dir, `${id}-issue-${id}.md`), `# ${id} · issue ${id}\n\n**Status:** ${status}\n**Kind:** bug\n**Priority:** 2\n**Tier:** standard\n**Tags:** \n**Files:** tool/src/f${id}.mjs\n**Repo:** ../tool\n${lease}${merged}**Found by:** jarl\n**Where:**\n\n## What\n\n\n## Why\n\n\n## Acceptance\n- works\n\n## Evidence\n\n`);
  }
  const lines = [];
  for (let n = 0; n < 3000; n += 1) lines.push(`- 2026-09-27 06:00 · ${String((n % 425) + 1).padStart(3, '0')} evidence · note ${n}`);
  writeFileSync(join(hub, '.jarl', 'log.md'), `# Log\n\n${lines.join('\n')}\n`);
  sh(tool, 'for n in 005 010 015; do git branch jarl/$n-x; done');
  const t0 = Date.now();
  const r = run(hub, ['resume']);
  const ms = Date.now() - t0;
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /## In flight \(85\)/);
  assert.match(r.stdout, /## Last 15 log line\(s\)/);
  // The budget is 2 s on a quiet machine; the bound here leaves room for a loaded one, and still catches a return
  // to git processes per issue (over a thousand on this loop).
  assert.ok(ms < 6000, `resume took ${ms} ms`);
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
