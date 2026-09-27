// The loop's metrics in report --json, and the mark on a loop with no declared check (issue 464). Every metric is read
// from the record alone — the journal and the issue files — and where the record holds nothing to read it from it says
// "no data" with a reason and null values, never a zero. A loop with no `Check:` line in goal.md lands on testimony
// alone, and status and report say so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const L = await import('../jarl-lib.mjs');

function jarl(root, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`jarl ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
function loop(goal = 'metrics') {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-metrics-'));
  jarl(dir, 'init', goal);
  return dir;
}
const issueFile = (dir, id) => join(dir, '.jarl', 'issues', readdirSync(join(dir, '.jarl', 'issues')).find((f) => f.startsWith(`${id}-`)));
// Header fields written straight into the issue file, the way a loop older than a command would hold them.
function fields(dir, id, values) {
  const f = issueFile(dir, id);
  let text = readFileSync(f, 'utf8');
  for (const [name, value] of Object.entries(values)) {
    const re = new RegExp(`^\\*\\*${name}:\\*\\*.*$`, 'm');
    text = re.test(text) ? text.replace(re, `**${name}:** ${value}`) : text.replace(/^(\*\*Status:\*\*.*)$/m, `$1\n**${name}:** ${value}`);
  }
  writeFileSync(f, text);
}
// A journal written by hand, so every stamp is known: the log the commands would have written, at chosen times.
function journal(dir, lines) {
  writeFileSync(join(dir, '.jarl', 'log.md'), `# Log\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
}

test('a loop with no declared check is marked in status and report; a Check line in goal.md names the check instead', () => {
  const dir = loop();
  const status = jarl(dir, 'status');
  assert.match(status, /no check declared — this loop lands on testimony alone/);
  assert.deepEqual(json(dir, 'status').check, { declared: false, checks: [], landsOn: 'testimony' });
  const report = json(dir, 'report');
  assert.deepEqual(report.check, { declared: false, checks: [], landsOn: 'testimony' });
  assert.match(report.text, /^no check declared — this loop lands on testimony alone/m);
  assert.equal(report.metrics.check.landsOn, 'testimony');

  appendFileSync(join(dir, '.jarl', 'goal.md'), '\n- **Check:** `npm test`\nCheck: yg check\n');
  assert.doesNotMatch(jarl(dir, 'status'), /testimony/);
  assert.deepEqual(json(dir, 'status').check, { declared: true, checks: ['npm test', 'yg check'], landsOn: 'check' });
  const declared = json(dir, 'report');
  assert.equal(declared.check.landsOn, 'check');
  assert.doesNotMatch(declared.text, /testimony/);
  assert.match(declared.text, /^check: npm test · yg check$/m);
});

test('an empty loop reports every metric as no data, never as zero', () => {
  const m = json(loop(), 'report').metrics;
  for (const k of ['cycleTime', 'leadTime', 'rounds', 'reopenings', 'freshReviews', 'redCiAfterMerge', 'followUps']) assert.ok(m[k].noData, `${k} says no data`);
  assert.equal(m.cycleTime.medianHours, null);
  assert.equal(m.rounds.rounds, null);
  assert.equal(m.reopenings.times, null);
  assert.equal(m.freshReviews.share, null);
  assert.equal(m.redCiAfterMerge.red, null);
  assert.equal(m.redCiAfterMerge.share, null);
  assert.equal(m.followUps.share, null);
  const text = jarl(loop(), 'report');
  assert.match(text, /^cycle time \(in progress → closed\): no data \(nothing closed yet\)$/m);
  assert.match(text, /^red CI after merge: no data \(no merge recorded\)$/m);
});

test('approves from before --by give no data for the fresh share, not a share of zero', () => {
  const dir = loop();
  jarl(dir, 'new', 'one');
  fields(dir, '001', { Status: 'done' });
  journal(dir, ['2026-09-01 10:00 · filed 001 · one', '2026-09-01 10:10 · 001 → in-progress · go', '2026-09-01 11:00 · 001 review approve · looks fine', '2026-09-01 11:10 · 001 → done · ok']);
  const f = json(dir, 'report').metrics.freshReviews;
  assert.equal(f.recorded, 0);
  assert.equal(f.unrecorded, 1);
  assert.equal(f.share, null);
  assert.match(f.noData, /1 from before --by/);
});

test('the metrics are read from the journal and the issues, with the numbers a reader would count by hand', () => {
  const dir = loop();
  for (const t of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) jarl(dir, 'new', t);
  // 001: code, fresh approve, merged, CI red then green; one round and one changes verdict; reopened once after done.
  // 002: code, coordinator approve, merged with no CI. 003: no code, approved by the jarl, CI still pending.
  // 004: deferred and brought back — not a reopening. 005: filed 3 days after 001 closed, found by 001's reviewer: a
  // follow-up. 006: filed after 002 closed but names it only inside a sha (1b002c3): not a follow-up. 007: a research
  // issue closed, with 006 naming it in Found by: research is left out of follow-ups.
  fields(dir, '001', { Status: 'done', Branch: 'jarl/001-a', Merged: 'abc1234', CI: 'green' });
  fields(dir, '002', { Status: 'done', Branch: 'jarl/002-b', Merged: 'def5678', CI: 'none' });
  fields(dir, '003', { Status: 'done', Merged: 'aaa1111', CI: 'pending' });
  fields(dir, '004', { Status: 'open' });
  fields(dir, '005', { Status: 'open', 'Found by': 'reviewer-001' });
  fields(dir, '006', { Status: 'open', 'Found by': 'CI run after merge 1b002c3, and research 007' });
  fields(dir, '007', { Status: 'done', Kind: 'research' });
  journal(dir, [
    '2026-09-01 08:00 · filed 001 · a',
    '2026-09-01 08:00 · filed 002 · b',
    '2026-09-01 08:00 · filed 003 · c',
    '2026-09-01 08:00 · filed 004 · d',
    '2026-09-01 08:00 · filed 007 · g',
    '2026-09-01 09:00 · 001 → in-progress · worker started · branch jarl/001-a · worker w1',
    '2026-09-01 10:00 · 001 review changes · by r1 (fresh) · Important: x',
    '2026-09-01 10:05 · 001 round 1 · x',
    '2026-09-01 11:00 · 001 review approve · by r1 (fresh) · ok',
    '2026-09-01 11:10 · 001 merged abc1234 · CI pending',
    '2026-09-01 11:20 · 001 CI red',
    '2026-09-01 11:30 · 001 → done · merged',
    '2026-09-01 12:00 · 001 → open · reopened: missed a case',
    '2026-09-01 13:00 · 001 → in-progress · again · worker w1',
    '2026-09-01 14:00 · 001 review approve · by r2 (fresh) · ok',
    '2026-09-01 14:10 · 001 CI green',
    '2026-09-01 15:00 · 001 → done · merged',
    '2026-09-01 09:00 · 002 → in-progress · worker started · branch jarl/002-b · worker w2',
    '2026-09-01 12:00 · 002 review approve · by jarl (coordinator) · ok',
    '2026-09-01 12:10 · 002 merged def5678 · CI none',
    '2026-09-01 13:00 · 002 → done · ok',
    '2026-09-02 08:00 · 003 → in-progress · worker started',
    '2026-09-02 09:00 · 003 review approve · by jarl (coordinator) · ok',
    '2026-09-02 09:30 · 003 merged aaa1111 · CI pending',
    '2026-09-02 10:00 · 003 → done · ok',
    '2026-09-02 10:00 · 004 → deferred · later',
    '2026-09-03 10:00 · 004 → open · back',
    '2026-09-02 11:00 · 007 → done · the report',
    '2026-09-04 15:00 · filed 005 · e',
    '2026-09-05 08:00 · filed 006 · f',
  ]);
  const out = json(dir, 'report');
  const m = out.metrics;
  // Cycle: 001 09:00 → 15:00 = 6 h; 002 09:00 → 13:00 = 4 h; 003 08:00 → 10:00 = 2 h; 007 never in progress.
  assert.deepEqual({ n: m.cycleTime.n, of: m.cycleTime.of, median: m.cycleTime.medianHours, max: m.cycleTime.maxHours }, { n: 3, of: 4, median: 4, max: 6 });
  // Lead: 7 h, 5 h, 26 h, 27 h.
  assert.deepEqual({ n: m.leadTime.n, median: m.leadTime.medianHours, max: m.leadTime.maxHours }, { n: 4, median: 16.5, max: 27 });
  assert.deepEqual({ rounds: m.rounds.rounds, on: m.rounds.issuesWithRounds, changes: m.rounds.changes, onChanges: m.rounds.issuesWithChanges }, { rounds: 1, on: ['001'], changes: 1, onChanges: ['001'] });
  assert.deepEqual({ times: m.reopenings.times, issues: m.reopenings.issues }, { times: 1, issues: ['001'] });
  const f = m.freshReviews;
  assert.deepEqual({ fresh: f.fresh, coordinator: f.coordinator, self: f.self, unrecorded: f.unrecorded, recorded: f.recorded }, { fresh: 1, coordinator: 2, self: 0, unrecorded: 1, recorded: 3 });
  assert.equal(f.share, 0.333);
  assert.deepEqual({ recorded: f.code.recorded, fresh: f.code.fresh, share: f.code.share }, { recorded: 3, fresh: 1, share: 0.333 });
  assert.deepEqual(f.reviewers, { r2: 1 });
  const ci = m.redCiAfterMerge;
  assert.deepEqual({ n: ci.n, settled: ci.settled, red: ci.red, issues: ci.issues, share: ci.share, pending: ci.pending, none: ci.none }, { n: 3, settled: 1, red: 1, issues: ['001'], share: 1, pending: ['003'], none: ['002'] });
  const fu = m.followUps;
  assert.deepEqual({ n: fu.n, with: fu.withFollowUps, list: fu.followUps }, { n: 3, with: 1, list: [{ id: '001', followUps: ['005'] }] });
  assert.equal(fu.noData, null);
  assert.match(out.text, /^reopened: 1 issue\(s\), 1 time\(s\): 001 · n 7$/m);
  assert.match(out.text, /^red CI after merge: 1 of 1 settled \(100%\): 001 · pending 1 · no CI 1$/m);
  assert.deepEqual({ windowClosed: fu.windowClosed, with: fu.windowClosedWithFollowUps, share: fu.share, open: fu.windowOpen }, { windowClosed: 3, with: 1, share: 0.333, open: 0 });
  assert.match(out.text, /^follow-ups within 7 days \(Found by names the closed issue\): 1 of 3 closed: 001 ← 005 · share 1 of 3 whose 7 days have passed \(33\.3%\)$/m);
  // A week and a bit after 001 first closed (09-01 11:30), 002 (09-01 13:00) and 003 (09-02 10:00) are still inside their
  // window: the share is taken over 001 alone, never over closes that have not had their 7 days.
  const early = L.loopMetrics(dir, undefined, undefined, Date.parse('2026-09-08T12:00:00Z')).followUps;
  assert.deepEqual({ windowClosed: early.windowClosed, with: early.windowClosedWithFollowUps, share: early.share, open: early.windowOpen, all: early.withFollowUps }, { windowClosed: 1, with: 1, share: 1, open: 2, all: 1 });
  const none = L.loopMetrics(dir, undefined, undefined, Date.parse('2026-09-03T12:00:00Z')).followUps;
  assert.deepEqual({ windowClosed: none.windowClosed, share: none.share, open: none.windowOpen }, { windowClosed: 0, share: null, open: 3 });
});

test('status --json keeps every earlier key in its place: check comes last', () => {
  const dir = loop();
  const keys = Object.keys(json(dir, 'status'));
  assert.equal(keys[keys.length - 1], 'check');
  assert.equal(keys[keys.length - 2], 'uncommitted');
});

test('the library reads the same metrics the report prints', () => {
  const dir = loop();
  assert.deepEqual(L.loopMetrics(dir), json(dir, 'report').metrics);
  assert.deepEqual(L.declaredChecks(dir), []);
});
