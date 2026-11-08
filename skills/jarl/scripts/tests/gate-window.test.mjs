// One window for the done gate: the evidence anchor and the approve cut reset on the same events. A filing, a start and a
// reopen reset both; a red round resets the approve alone. A pause and a resume on an unchanged branch tip spend neither.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { jarl, loop as makeLoop, refuses, gitRepo, run } from './helpers.mjs';
import { oldJarl, fileAsBefore, formatTwoJarl } from './old-jarl.mjs';

const L = await import('../jarl-lib.mjs');
const R = await import('../record.mjs');

const loop = (n) => {
  const root = makeLoop({ prefix: 'jarl-window-', via: 'cli' });
  for (let k = 1; k <= n; k += 1) jarl(root, 'new', `issue ${k}`, '--acceptance', 'it works');
  return root;
};
const row = (root, id, saw = 'pass') => jarl(root, 'evidence', String(id), '--ran', 'npm test', '--saw', saw);
const approve = (root, id) => jarl(root, 'review', String(id), 'approve', '--by', 'jarl', 'read the diff, nothing found');
const gate = (root, id) => L.gateState(root, String(id));

test('an issue closed, deferred and closed again is refused for the missing row after the reopen, and passes with one', () => {
  const root = loop(2);
  row(root, 2); approve(root, 2); jarl(root, 'set', '2', 'done');
  jarl(root, 'set', '2', 'deferred', 'waits for the owner');
  approve(root, 2);
  const said = refuses(root, 'set', '2', 'done');
  assert.match(said, /no --ran\/--saw evidence row recorded since it was moved → deferred/);
  row(root, 2, 'pass again');
  jarl(root, 'set', '2', 'done');
  assert.match(jarl(root, 'show', '2'), /Status:\*\* done/);
});

test('a start resets the rows and the approve; a round spends the approve and leaves the rows counting', () => {
  const root = loop(1);
  row(root, 1); approve(root, 1);
  assert.deepEqual([gate(root, 1).rowsSince, gate(root, 1).approved], [1, true]);
  jarl(root, 'round', '1', 'the test was red');
  assert.deepEqual([gate(root, 1).rowsSince, gate(root, 1).approved], [1, false], 'a round: the row stays, the approve is spent');
  approve(root, 1);
  jarl(root, 'set', '1', 'in-progress', '--worker', 'w1');
  assert.deepEqual([gate(root, 1).rowsSince, gate(root, 1).approved], [0, false], 'a start: both reset');
});

test('a reopen from done resets the rows and the approve, to open and to any other status', () => {
  for (const to of ['open', 'deferred', 'in-progress']) {
    const root = loop(1);
    row(root, 1); approve(root, 1); jarl(root, 'set', '1', 'done');
    assert.deepEqual([gate(root, 1).rowsSince, gate(root, 1).approved], [1, true]);
    jarl(root, 'set', '1', to, ...(to === 'deferred' ? ['waits'] : to === 'in-progress' ? ['--worker', 'w1'] : []));
    assert.deepEqual([gate(root, 1).rowsSince, gate(root, 1).approved], [0, false], `done → ${to}`);
  }
});

test('the filing of an issue never in progress opens the window', () => {
  const root = loop(1);
  assert.deepEqual([gate(root, 1).rowsSince, gate(root, 1).approved, gate(root, 1).anchor.what], [0, false, 'filed']);
  row(root, 1); approve(root, 1);
  assert.deepEqual([gate(root, 1).rowsSince, gate(root, 1).approved], [1, true]);
});

// The window as one function of the profile and the issue's events: the same value for the rows and for the approves.
const move = (n, from, to) => ({ type: 'move', n, from, to });
test('gateWindow gives the anchor and the cut for every event, from each closing status', () => {
  const profile = {
    is: (st, flag) => ({ 'closes-record': ['done', 'shipped'], 'holds-claim': ['in-progress'], dispatchable: ['open'] }[flag] || []).includes(st),
  };
  const w = (...events) => L.gateWindow(profile, events);
  assert.deepEqual(w({ type: 'filed', n: 0 }), { anchor: { type: 'filed', n: 0 }, cut: 0 });
  const filed = { type: 'filed', n: 0 };
  assert.equal(w(filed, move(3, 'open', 'in-progress')).anchor.n, 3, 'a start');
  assert.equal(w(filed, move(3, 'open', 'in-progress')).cut, 3);
  const round = w(filed, move(3, 'open', 'in-progress'), { type: 'round', n: 5 });
  assert.deepEqual([round.anchor.n, round.cut], [3, 5], 'a round resets the cut alone');
  for (const closing of ['done', 'shipped']) {
    for (const to of ['open', 'deferred', 'in-progress', 'dropped']) {
      const win = w(filed, move(4, 'in-progress', closing), move(9, closing, to));
      assert.deepEqual([win.anchor.n, win.cut], [9, 9], `${closing} → ${to} resets both`);
    }
    const stay = w(filed, move(4, 'in-progress', closing), move(9, closing, 'shipped'));
    assert.deepEqual([stay.anchor.n, stay.cut], [0, 0],`${closing} → another closing status keeps the window`);
  }
});

// A loop at the root of a git repository on main, its first issue leased on the branch jarl/1-x with one commit of its
// own, proved and approved by a fresh reviewer. `commit` adds a commit on the branch; `fresh` reads the gate as a new
// command does. With `library` the issue is filed by the pinned frozen reader, as 001 with no key; the first tip line,
// the row's, raises the loop to record format 3.
function leased({ library = false } = {}) {
  const { dir: root, g } = gitRepo({ prefix: 'jarl-pause-', branch: 'main' });
  jarl(root, 'init', 'goal');
  if (library) fileAsBefore(root, 'issue 1', { acceptance: 'it works' }); else jarl(root, 'new', 'issue 1', '--acceptance', 'it works');
  g('branch', 'jarl/1-x');
  const commit = (name) => { g('checkout', '-q', 'jarl/1-x'); writeFileSync(join(root, `${name}.txt`), `${name}\n`); g('add', `${name}.txt`); g('commit', '-qm', name); g('checkout', '-q', 'main'); };
  commit('work');
  jarl(root, 'set', '1', 'in-progress', '--branch', 'jarl/1-x', '--worker', 'w1');
  row(root, 1);
  jarl(root, 'review', '1', 'approve', '--by', 'rev1', 'read the diff, nothing found');
  const fresh = () => { L.resetCaches(); const s = L.gateState(root, '1'); return [s.rowsSince, s.approved]; };
  assert.deepEqual(fresh(), [1, true]);
  return { root, g, commit, fresh };
}
const resume = (root) => jarl(root, 'set', '1', 'in-progress', '--branch', 'jarl/1-x', '--worker', 'w1');

test('a pause and a resume on the same branch tip keep the rows and the approve, through open and through deferred', () => {
  for (const pause of [['open', 'reordered'], ['deferred', 'waits for the owner']]) {
    const { root, fresh } = leased();
    jarl(root, 'set', '1', ...pause);
    resume(root);
    assert.deepEqual(fresh(), [1, true], `in progress → ${pause[0]} → in progress`);
    assert.match(jarl(root, 'show', '1'), /npm test/, 'the kept row is shown in the window');
  }
  const { root, fresh } = leased();
  jarl(root, 'set', '1', 'open', 'reordered'); resume(root);
  jarl(root, 'set', '1', 'deferred', 'later'); jarl(root, 'set', '1', 'open', 'back'); resume(root);
  assert.deepEqual(fresh(), [1, true], 'several pauses in a row');
});

test('a new commit on the branch after a pause spends the rows and the approve; new ones count again', () => {
  const { root, commit, fresh } = leased();
  jarl(root, 'set', '1', 'open', 'reordered');
  resume(root);
  commit('more');
  assert.deepEqual(fresh(), [0, false]);
  assert.match(refuses(root, 'set', '1', 'done'), /no --ran\/--saw evidence row recorded since it was moved → in-progress/);
  row(root, 1, 'pass on the new tip');
  jarl(root, 'review', '1', 'approve', '--by', 'rev2', 'read the new commit, nothing found');
  assert.deepEqual(fresh(), [1, true]);
});

test('a round and a reopen from done still spend what they spend, pause or no pause', () => {
  const a = leased();
  jarl(a.root, 'set', '1', 'open', 'reordered'); resume(a.root);
  jarl(a.root, 'round', '1', 'the test was red');
  assert.deepEqual(a.fresh(), [1, false], 'a round spends the approve, the row stays');
  const b = leased();
  jarl(b.root, 'set', '1', 'open', 'reordered'); resume(b.root);
  b.g('merge', '-q', '--no-ff', 'jarl/1-x', '-m', 'merge');
  jarl(b.root, 'merged', '1', '--sha', b.g('rev-parse', 'HEAD').trim(), '--keep');
  jarl(b.root, 'set', '1', 'done');
  jarl(b.root, 'set', '1', 'open', 'found a gap');
  resume(b.root);
  assert.deepEqual(b.fresh(), [0, false], 'a reopen from done spends both, though the tip is the same');
});

test('the window no pause opens: the first start, a reopen from a closed status and the start after it still open it', () => {
  const profile = {
    is: (st, flag) => ({ 'closes-record': ['done'], 'holds-claim': ['in-progress'], dispatchable: ['open'] }[flag] || []).includes(st),
  };
  const firm = (...events) => L.gateWindow(profile, [{ type: 'filed', n: 0 }, ...events], { throughPauses: true });
  assert.equal(firm(move(3, 'open', 'in-progress')).anchor.n, 3, 'the first start');
  const paused = [move(3, 'open', 'in-progress'), move(5, 'in-progress', 'open'), move(7, 'open', 'in-progress'), move(8, 'in-progress', 'deferred'), move(9, 'deferred', 'in-progress')];
  assert.deepEqual([firm(...paused).anchor.n, firm(...paused).cut], [3, 3], 'pauses and resumes');
  assert.deepEqual([firm(...paused, { type: 'round', n: 10 }).anchor.n, firm(...paused, { type: 'round', n: 10 }).cut], [3, 10], 'a round');
  const reopened = [...paused, move(11, 'in-progress', 'done'), move(12, 'done', 'open')];
  assert.equal(firm(...reopened).anchor.n, 12, 'a reopen from done');
  assert.equal(firm(...reopened, move(14, 'open', 'in-progress')).anchor.n, 14, 'the start after a reopen from done');
  assert.equal(L.gateWindow(profile, [{ type: 'filed', n: 0 }, ...paused]).anchor.n, 9, 'without throughPauses every resume opens it');
});

test('a merge whose cleanup deleted the branch: done reads the tip the merge was recorded on', () => {
  const { root, g } = leased();
  jarl(root, 'set', '1', 'open', 'reordered'); resume(root);
  g('merge', '-q', '--no-ff', 'jarl/1-x', '-m', 'merge');
  jarl(root, 'merged', '1', '--sha', g('rev-parse', 'HEAD').trim());
  assert.equal(g('branch', '--list', 'jarl/1-x').trim(), '', 'the cleanup deleted the branch');
  assert.equal(jarl(root, 'set', '1', 'done'), '1 → done');
});

test('rows and verdicts that carry no tip are spent by a pause and a resume', () => {
  const { root, fresh } = leased();
  const log = join(root, '.jarl', 'log.md');
  writeFileSync(log, readFileSync(log, 'utf8').split('\n').filter((l) => !/ · 1 tip /.test(l)).join('\n'));
  assert.deepEqual(fresh(), [1, true], 'without a pause nothing changes');
  jarl(root, 'set', '1', 'open', 'reordered');
  resume(root);
  assert.deepEqual(fresh(), [0, false]);
});

test('a tip line is written by evidence, review and merged, right after their own line and with the tip mark before the separator, and never by log', () => {
  const { root, g } = leased();
  const tip = g('rev-parse', 'jarl/1-x').trim();
  const raw = readFileSync(join(root, '.jarl', 'log.md'), 'utf8').split('\n');
  const lines = raw.map((l) => l.replace(/^- \S+ \S+(?: key \S+)?(?: tip)? · /, ''));
  const after = (re) => lines[lines.findIndex((l) => re.test(l)) + 1];
  assert.equal(after(/^1 evidence row · /), `1 tip ${tip}`);
  assert.equal(after(/^1 review approve · /), `1 tip ${tip}`);
  for (const l of raw.filter((x) => / · 1 tip /.test(x))) assert.match(l, /^- \S+ \S+(?: key \S+)? tip · 1 tip [0-9a-f]+$/, 'every tip line carries the mark');
  assert.match(refuses(root, 'log', `1 tip ${tip}`), /reads as a tip line/);
});

test('the first tip line raises a loop of record format 1 to 3, and the pinned frozen readers of format 1 and of formats 1 and 2 refuse it with their own message; this Jarl keeps the row and the approve of the unchanged tip', () => {
  const { root, g } = leased({ library: true });
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.jarl', 'profile.json'), 'utf8')), { 'jarl-profile': 1, format: 3 }, 'raised by the first tip');
  for (const command of ['list', 'status']) {
    const one = oldJarl(root, command, {});
    assert.equal(one.ok, false, command);
    assert.match(one.error, /written for record format 3, and this Jarl reads format 1 — /, command);
    const two = formatTwoJarl(root, command, {});
    assert.equal(two.ok, false, command);
    assert.match(two.error, /written for record format 3, and this Jarl reads format 1, 2 — nothing was read or written; the reader needs a Jarl that knows format 3/, command);
  }
  jarl(root, 'set', '1', 'open', 'reordered'); resume(root);
  jarl(root, 'merged', '1', '--sha', g('rev-parse', 'jarl/1-x').trim(), '--ci', 'none', '--keep');
  assert.equal(jarl(root, 'set', '1', 'done'), '001 → done', 'this Jarl keeps the row and the approve of the unchanged tip');
});

test('a loop that records no tip is never raised: a row, an approve and a close on an issue with no branch, or on a branch that is not there', () => {
  for (const branch of [null, 'jarl/1-gone']) {
    const { dir: root } = gitRepo({ prefix: 'jarl-no-tip-', branch: 'main' });
    jarl(root, 'init', 'goal');
    fileAsBefore(root, 'issue 1', { acceptance: 'it works' });
    if (branch) jarl(root, 'set', '1', 'in-progress', '--branch', branch, '--worker', 'w1');
    row(root, 1);
    jarl(root, 'review', '1', 'approve', '--by', 'rev1', 'read the diff, nothing found');
    if (branch) jarl(root, 'merged', '1', '--sha', 'abc1234', '--ci', 'none', '--keep');
    assert.equal(jarl(root, 'set', '1', 'done'), '001 → done');
    assert.doesNotMatch(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), / · 001 tip /, `${branch ?? 'no branch'}: no tip line`);
    assert.equal(existsSync(join(root, '.jarl', 'profile.json')), false, `${branch ?? 'no branch'}: the loop stays at record format 1`);
  }
});

// The issue of a format-1 loop leased by this Jarl on its branch, its row and its approve written by the pinned frozen
// reader, each followed at once by a line of the tip's text that the frozen reader's log command writes, so each pair
// shares one stamp as the write of a row and its tip does. A minute that turns between the two lines makes another try.
test('a tip line without the tip mark, written by the pinned frozen log command right after its row and its approve under the same stamp, keeps nothing across a pause', () => {
  for (let attempt = 1; ; attempt += 1) {
    const { dir: root, g } = gitRepo({ prefix: 'jarl-unmarked-', branch: 'main' });
    jarl(root, 'init', 'goal');
    fileAsBefore(root, 'issue 1', { acceptance: 'it works' });
    g('branch', 'jarl/1-x');
    g('checkout', '-q', 'jarl/1-x'); writeFileSync(join(root, 'work.txt'), 'work\n'); g('add', 'work.txt'); g('commit', '-qm', 'work'); g('checkout', '-q', 'main');
    jarl(root, 'set', '1', 'in-progress', '--branch', 'jarl/1-x', '--worker', 'w1');
    const tip = g('rev-parse', 'jarl/1-x').trim();
    assert.equal(oldJarl(root, 'evidence', {}, ['001', null, { ran: 'npm test', saw: 'pass' }]).ok, true);
    assert.equal(oldJarl(root, 'log', {}, [`001 tip ${tip}`]).ok, true, 'the pinned frozen log writes a line of the tip text');
    assert.equal(oldJarl(root, 'review', {}, ['001', 'approve', 'read the diff, nothing found', { by: 'rev1' }]).ok, true);
    assert.equal(oldJarl(root, 'log', {}, [`001 tip ${tip}`]).ok, true);
    const lines = readFileSync(join(root, '.jarl', 'log.md'), 'utf8').trim().split('\n').slice(-4);
    const stamps = lines.map((l) => /^- (\S+ \S+) · /.exec(l)?.[1]);
    assert.match(lines[0], / · 001 evidence row · npm test$/);
    assert.match(lines[2], / · 001 review approve · /);
    if (stamps[0] !== stamps[1] || stamps[2] !== stamps[3]) { if (attempt < 3) continue; assert.fail(`a minute turned between a line and its tip on every try: ${lines.join(' / ')}`); }
    assert.deepEqual([lines[1], lines[3]], [`- ${stamps[1]} · 001 tip ${tip}`, `- ${stamps[3]} · 001 tip ${tip}`], 'each line of the tip text right after its line, under its stamp, without the mark');
    jarl(root, 'set', '1', 'open', 'reordered'); resume(root);
    L.resetCaches();
    const s = L.gateState(root, '1');
    assert.deepEqual([s.rowsSince, s.approved], [0, false], 'the row and the approve are spent by the pause: a line without the mark is the tip of nothing');
    const verified = run(root, ['verify']);
    assert.equal(verified.stdout.match(/a tip line without the tip mark before the separator/g)?.length, 2, `verify names each such line: ${verified.stdout}`);
    assert.equal(existsSync(join(root, '.jarl', 'profile.json')), false, 'this Jarl wrote no tip, so the loop is not raised');
    break;
  }
});

test('a loop whose profile names an external scheduler records no tip below record format 3: the row is recorded, nothing is raised, and the tip is listed as off', () => {
  const { dir: root, g } = gitRepo({ prefix: 'jarl-composed-tip-', branch: 'main' });
  const file = join(root, 'composed-profile.json');
  writeFileSync(file, JSON.stringify({ 'jarl-profile': 1, name: 'composed', statuses: L.BUILTIN_STATUSES, 'external-scheduler': 'the composer tick' }));
  jarl(root, 'init', 'goal', '--profile', file);
  R.newIssue(root, 'issue 1', { acceptance: 'it works' });
  g('branch', 'jarl/1-x');
  R.setStatus(root, '1', 'in-progress', undefined, { branch: 'jarl/1-x', worker: 'w1' });
  const before = readFileSync(join(root, '.jarl', 'profile.json'), 'utf8');
  R.addEvidence(root, '1', undefined, { ran: 'npm test', saw: 'pass' });
  R.review(root, '1', 'approve', 'read the diff, nothing found', { by: 'rev1' });
  assert.doesNotMatch(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), / · 001 tip /);
  assert.equal(readFileSync(join(root, '.jarl', 'profile.json'), 'utf8'), before, 'the format is the composer\'s: nothing is raised');
  assert.ok(R.recordFormat(root).off.includes('tip-mark'));
  assert.match(jarl(root, 'status'), /the tip of a branch after a row, a verdict, a merge or a close \(format 3\)/);
});

// The log of a leased loop with its tip lines taken out: the row and the approve as a Jarl that writes no tip line
// records them.
const withoutTips = (root) => {
  const log = join(root, '.jarl', 'log.md');
  writeFileSync(log, readFileSync(log, 'utf8').split('\n').filter((l) => !/ · 001 tip /.test(l)).join('\n'));
  return log;
};
// A stamp a minute after the newest line of the log, as a line written later carries it.
const minuteAfterLast = (log) => {
  const last = [...readFileSync(log, 'utf8').matchAll(/^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) /gm)].pop()[1];
  return new Date(Date.parse(`${last.replace(' ', 'T')}:00Z`) + 60_000).toISOString().replace('T', ' ').slice(0, 16);
};

test('a tip line written by a log command after a verdict keeps nothing across a pause: only the line right after its own write, under its stamp, is a tip', () => {
  for (const how of ['a later minute', 'a line between']) {
    const { root, g, commit, fresh } = leased({ library: true });
    const log = withoutTips(root);
    commit('more');
    const tip = g('rev-parse', 'jarl/1-x').trim();
    if (how === 'a later minute') appendFileSync(log, `- ${minuteAfterLast(log)} · 001 tip ${tip}\n`);
    else {
      assert.equal(oldJarl(root, 'log', {}, ['a note about the loop']).ok, true);
      assert.equal(oldJarl(root, 'log', {}, [`001 tip ${tip}`]).ok, true, 'the pinned frozen log writes a line of the tip shape');
    }
    jarl(root, 'set', '1', 'open', 'reordered'); resume(root);
    assert.deepEqual(fresh(), [0, false], `${how}: the approve made before the new commit is spent`);
  }
});

test('a done issue is judged against the tip recorded when it closed: a later commit on its branch, or the branch deleted with no tip on its merge, leaves its gate holding', () => {
  for (const after of ['commit', 'delete']) {
    const { root, g, commit } = leased({ library: true });
    jarl(root, 'set', '1', 'open', 'reordered'); resume(root);
    jarl(root, 'merged', '1', '--sha', g('rev-parse', 'jarl/1-x').trim(), '--ci', 'none', '--keep');
    // The merge's own tip line taken out: a merge recorded with no tip.
    const log = join(root, '.jarl', 'log.md');
    const lines = readFileSync(log, 'utf8').split('\n');
    const at = lines.findLastIndex((l) => / · 001 merged /.test(l));
    assert.match(lines[at + 1], / · 001 tip /);
    writeFileSync(log, [...lines.slice(0, at + 1), ...lines.slice(at + 2)].join('\n'));
    assert.equal(jarl(root, 'set', '1', 'done'), '001 → done');
    if (after === 'commit') commit('later'); else g('branch', '-q', '-D', 'jarl/1-x');
    L.resetCaches();
    assert.deepEqual(JSON.parse(jarl(root, 'status', '--json')).closedGate, [], `after a ${after}: the closed issue's gate holds`);
    assert.doesNotMatch(jarl(root, 'status'), /001.*(no --ran|spent)/, `after a ${after}: status flags nothing`);
  }
});

test('a close after a merge that deleted the branch records the tip the merge was recorded on, so a branch of the same name made again later leaves the closed gate holding', () => {
  const { root, g, commit } = leased();
  jarl(root, 'set', '1', 'open', 'reordered'); resume(root);
  const tip = g('rev-parse', 'jarl/1-x').trim();
  g('merge', '-q', '--no-ff', 'jarl/1-x', '-m', 'merge the work');
  const sha = g('rev-parse', 'main').trim();
  jarl(root, 'merged', '1', '--sha', sha, '--ci', 'none');
  assert.equal(g('branch', '--list', 'jarl/1-x').trim(), '', 'the merge without --keep deleted the branch');
  assert.equal(jarl(root, 'set', '1', 'done'), '1 → done');
  g('branch', 'jarl/1-x', 'main');
  commit('again');
  L.resetCaches();
  assert.deepEqual(JSON.parse(jarl(root, 'status', '--json')).closedGate, [], 'with the branch made again on other work, the closed issue\'s gate holds');
  assert.doesNotMatch(jarl(root, 'status'), /\b1\b.*(no --ran|spent)/, 'status flags nothing');
  const log = readFileSync(join(root, '.jarl', 'log.md'), 'utf8').trim().split('\n');
  const close = log.findLastIndex((l) => / · 1 → done$/.test(l));
  assert.match(log[close + 1] ?? '(no line after the close)', new RegExp(` · 1 tip ${tip}$`), 'the close is followed by the tip the merge was recorded on');
});

// An issue leased on its branch with one commit of work and a row, cleared by a fresh approve or by the owner's waiver of
// its review; the branch landed on main by a merge commit or a squash, then deleted before the merge is recorded (deleted
// by hand) or kept by it; and the issue closed. The close's own tip line, and the closed gate, are read after.
function closedAfterLanding({ clears, how, deleted }) {
  const { dir: root, g } = gitRepo({ prefix: 'jarl-close-tip-', branch: 'main' });
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'issue 1', '--acceptance', 'it works');
  const commit = (branch, name) => { g('checkout', '-q', branch); writeFileSync(join(root, `${name}.txt`), `${name}\n`); g('add', `${name}.txt`); g('commit', '-qm', name); g('checkout', '-q', 'main'); };
  g('branch', 'jarl/1-x');
  commit('jarl/1-x', 'work');
  jarl(root, 'set', '1', 'in-progress', '--branch', 'jarl/1-x', '--worker', 'w1');
  row(root, 1);
  if (clears === 'approve') jarl(root, 'review', '1', 'approve', '--by', 'rev1', 'read the diff, nothing found');
  else jarl(root, 'decide', 'no-review-for-1', 'Issue 1 closes without a review: the comparison is enough.', '--by', 'owner', '--quote', 'No review for that one.', '--waives-review', '1');
  const tip = g('rev-parse', 'jarl/1-x').trim();
  if (how === 'squash') { g('merge', '-q', '--squash', 'jarl/1-x'); g('commit', '-qm', 'the work, squashed'); } else g('merge', '-q', '--no-ff', 'jarl/1-x', '-m', 'merge the work');
  const sha = g('rev-parse', 'main').trim();
  if (deleted) g('branch', '-q', '-D', 'jarl/1-x');
  jarl(root, 'merged', '1', '--sha', sha, '--ci', 'none', ...(deleted ? [] : ['--keep']));
  assert.equal(jarl(root, 'set', '1', 'done'), '1 → done');
  const log = readFileSync(join(root, '.jarl', 'log.md'), 'utf8').trim().split('\n');
  const after = log[log.findLastIndex((l) => / · 1 → done$/.test(l)) + 1] ?? '(no line after the close)';
  const closedGate = () => { L.resetCaches(); return JSON.parse(jarl(root, 'status', '--json')).closedGate; };
  return { g, tip, sha, after, closedGate, commit };
}

for (const clears of ['waiver', 'approve']) {
  for (const how of ['merge', 'squash']) {
    test(`a close cleared by ${clears === 'waiver' ? 'the owner\'s waiver' : 'a fresh approve'}, after a ${how === 'merge' ? 'merge commit' : 'squash'} recorded once the branch was deleted, records the tip the gate was judged on, never the commit the merge names, and the closed gate holds`, () => {
      const { g, tip, sha, after, closedGate, commit } = closedAfterLanding({ clears, how, deleted: true });
      assert.notEqual(sha, tip, 'the merge names a commit that is not on the branch');
      assert.deepEqual(closedGate(), [], 'right after the close, the closed issue\'s gate holds');
      assert.match(after, new RegExp(` · 1 tip ${tip}$`), 'the close is followed by the tip the row and the clearing were made on');
      g('branch', 'jarl/1-x', 'main');
      commit('jarl/1-x', 'other work');
      assert.deepEqual(closedGate(), [], 'with a branch of the same name made again on other work, the closed issue\'s gate holds');
    });
  }
  test(`a close cleared by ${clears === 'waiver' ? 'the owner\'s waiver' : 'a fresh approve'}, with the branch kept by the merge, records the branch's tip, and a later commit on it leaves the closed gate holding`, () => {
    const { tip, after, closedGate, commit } = closedAfterLanding({ clears, how: 'merge', deleted: false });
    assert.match(after, new RegExp(` · 1 tip ${tip}$`), 'the close is followed by the branch\'s tip');
    assert.deepEqual(closedGate(), [], 'right after the close, the closed issue\'s gate holds');
    commit('jarl/1-x', 'more');
    assert.deepEqual(closedGate(), [], 'after a commit on the kept branch, the closed issue\'s gate holds');
  });
}

test('a close where no branch, merge, row or approve gives a tip records none, and its gate holds', () => {
  const root = loop(1);
  row(root, 1); approve(root, 1);
  assert.equal(jarl(root, 'set', '1', 'done'), '1 → done');
  const log = readFileSync(join(root, '.jarl', 'log.md'), 'utf8').trim().split('\n');
  assert.doesNotMatch(log[log.findLastIndex((l) => / · 1 → done$/.test(l)) + 1] ?? '', / · 1 tip /, 'no tip line follows the close');
  assert.deepEqual(JSON.parse(jarl(root, 'status', '--json')).closedGate, []);
});

// A copy of a real loop (the directory that holds its .jarl), named by JARL_LIVE_LOOP: the gate is replayed over it, and
// every close that rests on a row from before a reopen is listed.
const LIVE = process.env.JARL_LIVE_LOOP || '';
test('a copy of a real loop: every close resting on a row from before a reopen is listed, and no other issue changes', { skip: !(LIVE && existsSync(join(LIVE, '.jarl'))) && 'JARL_LIVE_LOOP is unset, or names no loop' }, () => {
  const loopValue = L.readLoop(join(LIVE, '.jarl'));
  const listed = [];
  for (const issue of loopValue.issues) {
    const events = loopValue.eventsById.get(issue.id) || [];
    const g = L.gateOf(loopValue, issue.id);
    // The window the gate kept when a move out of a closing status reset the approve alone.
    let before = null;
    for (const e of events) {
      if (e.type === 'filed') before = e;
      if (e.type === 'move') {
        const { profile } = loopValue;
        if ((profile.is(e.to, 'holds-claim') && !profile.is(e.from, 'holds-claim')) || (profile.is(e.to, 'dispatchable') && (profile.is(e.from, 'closes-record') || profile.is(e.from, 'holds-claim')))) before = e;
      }
    }
    const rowsBefore = g.rowLog.filter((r) => before && r.n > before.n && !r.retracted).length;
    if (rowsBefore !== g.rowsSince) listed.push(`${issue.id}: ${rowsBefore} row(s) counted before, ${g.rowsSince} now`);
  }
  console.log(`rows differing: ${listed.length}${listed.length ? `\n${listed.join('\n')}` : ''}`);
  for (const line of listed) assert.match(line, /\d+ row\(s\) counted before, 0 now/, 'a differing issue is one whose rows all come from before a reopen');
});
