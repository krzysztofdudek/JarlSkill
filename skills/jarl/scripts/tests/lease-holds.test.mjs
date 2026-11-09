// A lease holds: under the write lock, a move into a status that holds the claim reads the record again and refuses an
// issue another lease holds, and a file or a resource another lease holds, unless the call hands the issue over with its
// reason. A handover is logged in a shape every reader places, and the views stop alarming about the lease it ended.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitRepo, jarl, refuses, run, loop } from './helpers.mjs';
import { fileThreeDigits } from './helpers.mjs';
import * as R from '../record.mjs';

const logText = (root) => readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
const header = (root, id) => readFileSync(R.findIssue(root, id).file, 'utf8');

// A loop in a git repository with two issues that both declare f.txt.
function twoOnOneFile() {
  const { dir, g } = gitRepo({ prefix: 'jarl-lease-' });
  jarl(dir, 'init', 'goal');
  jarl(dir, 'new', 'one', '--acceptance', '[read] it works', '--files', 'f.txt', '--tier', 'standard', '--kind', 'gap', '--prio', '2');
  jarl(dir, 'new', 'two', '--acceptance', '[read] it works', '--files', 'f.txt', '--tier', 'standard', '--kind', 'gap', '--prio', '2');
  return { root: dir, g };
}

test('a second lease on an issue another lease holds is refused, names the holder and writes nothing', () => {
  const { root } = twoOnOneFile();
  jarl(root, 'set', '1', 'in-progress', 'A', '--branch', 'jarl/1-one', '--worker', 'wA');
  const before = logText(root);
  const said = refuses(root, 'set', '1', 'in-progress', 'B', '--branch', 'jarl/1-one-b', '--worker', 'wB');
  assert.match(said, /1 is leased already \(worker wA, branch jarl\/1-one, since /);
  assert.match(said, /set 1 in-progress "<why-the-worker-changed>" --branch jarl\/1-one-b --worker wB --handover/, 'the reason names the command that hands the issue over');
  assert.equal(said.trim().split('\n').at(-1), "jarl.mjs set \"<ids>\" \"<status>\" \"<why>\" --branch \"<worker-branch>\" --worker \"<the-new-worker>\" \"<--handover-or-none>\"", 'the refusal ends with its form, the handover the caller\'s to give');
  assert.equal(logText(root), before, 'nothing was written');
  const one = JSON.parse(jarl(root, 'show', '1', '--json'));
  assert.equal(one.fields.worker, 'wA');
  assert.equal(one.fields.branch, 'jarl/1-one');
});

test('the same holder restating its lease, or a move that names no lease, is not a second lease', () => {
  const { root } = twoOnOneFile();
  jarl(root, 'set', '1', 'in-progress', 'A', '--branch', 'jarl/1-one', '--worker', 'wA');
  jarl(root, 'set', '1', 'in-progress', 'again', '--branch', 'jarl/1-one', '--worker', 'wA', '--model', 'some-model');
  jarl(root, 'set', '1', 'in-progress', 'still going');
  // A lease that names no worker yet is filled in, not replaced.
  jarl(root, 'field', '2', 'files', 'g.txt');
  jarl(root, 'set', '2', 'in-progress', 'reserved');
  jarl(root, 'set', '2', 'in-progress', 'raised', '--branch', 'jarl/2-two', '--worker', 'wC');
  assert.equal(JSON.parse(jarl(root, 'show', '2', '--json')).fields.worker, 'wC');
});

test('a lease on a file another lease holds is refused, naming the holding issue and its slice tag', () => {
  const { root } = twoOnOneFile();
  jarl(root, 'field', '1', 'Tags', '--add', 'slice:alpha');
  jarl(root, 'set', '1', 'in-progress', 'A', '--branch', 'jarl/1-one', '--worker', 'wA');
  const before = logText(root);
  const said = refuses(root, 'set', '2', 'in-progress', 'held file', '--branch', 'jarl/2-two', '--worker', 'wC');
  assert.match(said, /2 declares f\.txt, which 1 holds in its lease \(worker wA, branch jarl\/1-one, since [^,]+, slice:alpha\)/);
  assert.match(said, /--branch jarl\/1-one --worker wA/, 'it names the call that puts the issue in the holder\'s package');
  assert.equal(logText(root), before, 'nothing was written');
  assert.equal(JSON.parse(jarl(root, 'show', '2', '--json')).status, 'open');
});

test('the holder is named without a slice when it has none, and a held resource is refused the same way', () => {
  const { root } = twoOnOneFile();
  jarl(root, 'field', '1,2', 'files', '--clear');
  jarl(root, 'field', '1,2', 'resources', 'db-server');
  jarl(root, 'set', '1', 'in-progress', 'A', '--branch', 'jarl/1-one', '--worker', 'wA');
  const said = refuses(root, 'set', '2', 'in-progress', 'held', '--branch', 'jarl/2-two', '--worker', 'wC');
  assert.match(said, /2 uses the resource db-server, which 1 holds in its lease \(worker wA, branch jarl\/1-one, since [^)]+\)/);
  assert.doesNotMatch(said, /slice:/);
});

// Two issues that each hold a lease of their own, the first declaring f.txt and the resource db-server, the second g.txt.
function twoLeasesOnTwoFiles() {
  const { dir: root } = gitRepo({ prefix: 'jarl-lease-after-' });
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'one', '--acceptance', '[read] it works', '--files', 'f.txt', '--tier', 'standard', '--kind', 'gap', '--prio', '2');
  jarl(root, 'new', 'two', '--acceptance', '[read] it works', '--files', 'g.txt', '--tier', 'standard', '--kind', 'gap', '--prio', '2');
  jarl(root, 'field', '1', 'resources', 'db-server');
  jarl(root, 'set', '1', 'in-progress', 'A', '--branch', 'jarl/1-one', '--worker', 'wA');
  jarl(root, 'set', '2', 'in-progress', 'C', '--branch', 'jarl/2-two', '--worker', 'wC');
  return root;
}

test('declaring a file after the lease that another lease holds is refused, naming the holder, and writes nothing', () => {
  const root = twoLeasesOnTwoFiles();
  const before = logText(root);
  const said = refuses(root, 'field', '2', 'files', 'g.txt, f.txt');
  assert.match(said, /2 declares f\.txt, which 1 holds in its lease \(worker wA, branch jarl\/1-one, since [^)]+\)/);
  assert.match(said, /set 2 in-progress "<why-the-worker-changed>" --branch jarl\/1-one --worker wA --handover/, 'it names the call that puts the issue in the holder\'s package');
  assert.equal(logText(root), before, 'nothing was written');
  assert.equal(JSON.parse(jarl(root, 'show', '2', '--json')).fields.files, 'g.txt');
  assert.match(refuses(root, 'field', '2', 'files', 'f.txt', '--add'), /2 declares f\.txt, which 1 holds in its lease/);
  assert.equal(logText(root), before);
});

test('declaring a resource after the lease that another lease holds is refused, naming the holder, and writes nothing', () => {
  const root = twoLeasesOnTwoFiles();
  const before = logText(root);
  assert.match(refuses(root, 'field', '2', 'resources', 'DB-Server'), /2 uses the resource DB-Server, which 1 holds in its lease \(worker wA, branch jarl\/1-one/);
  assert.match(refuses(root, 'field', '2', 'resources', 'db-server', '--add'), /2 uses the resource db-server, which 1 holds in its lease/);
  assert.equal(logText(root), before, 'nothing was written');
  assert.equal(JSON.parse(jarl(root, 'show', '2', '--json')).fields.resources, undefined);
});

test('a call over several issues that one lease refuses writes nothing for any of them', () => {
  const root = twoLeasesOnTwoFiles();
  jarl(root, 'new', 'three', '--acceptance', '[read] it works', '--files', 'h.txt', '--tier', 'standard', '--kind', 'gap', '--prio', '2');
  jarl(root, 'set', '3', 'in-progress', 'D', '--branch', 'jarl/3-three', '--worker', 'wD');
  const before = logText(root);
  assert.match(refuses(root, 'field', '2,3', 'files', '--add', 'f.txt'), /which 1 holds in its lease/);
  assert.equal(logText(root), before);
  assert.equal(JSON.parse(jarl(root, 'show', '3', '--json')).fields.files, 'h.txt');
});

test('a resource one lease holds is refused for a later issue of a call, and no earlier issue of the call is written, whatever the order', () => {
  const root = twoLeasesOnTwoFiles();
  jarl(root, 'new', 'three', '--acceptance', '[read] it works', '--files', 'h.txt', '--tier', 'standard', '--kind', 'gap', '--prio', '2');
  const before = logText(root);
  for (const ids of ['3,2', '2,3']) {
    for (const form of [['--add'], []]) {
      assert.match(refuses(root, 'field', ids, 'resources', 'db-server', ...form), /2 uses the resource db-server, which 1 holds in its lease \(worker wA, branch jarl\/1-one/);
      assert.equal(logText(root), before, `nothing was logged by field ${ids} resources${form.length ? ' --add' : ''}`);
      assert.equal(JSON.parse(jarl(root, 'show', '3', '--json')).fields.resources, undefined, 'the issue before the refused one is not written');
      assert.equal(JSON.parse(jarl(root, 'show', '2', '--json')).fields.resources, undefined);
    }
  }
});

test('a file one lease holds is refused for a later issue of a call, and no earlier issue of the call is written, whatever the order', () => {
  const root = twoLeasesOnTwoFiles();
  jarl(root, 'new', 'three', '--acceptance', '[read] it works', '--files', 'h.txt', '--tier', 'standard', '--kind', 'gap', '--prio', '2');
  const before = logText(root);
  for (const ids of ['3,2', '2,3']) {
    for (const form of [['--add'], []]) {
      const list = form.length ? 'f.txt' : 'f.txt, g.txt, h.txt';
      assert.match(refuses(root, 'field', ids, 'files', list, ...form), /declares f\.txt, which 1 holds in its lease \(worker wA, branch jarl\/1-one/);
      assert.equal(logText(root), before, `nothing was logged by field ${ids} files${form.length ? ' --add' : ''}`);
      assert.equal(JSON.parse(jarl(root, 'show', '3', '--json')).fields.files, 'h.txt', 'the issue before the refused one is not written');
      assert.equal(JSON.parse(jarl(root, 'show', '2', '--json')).fields.files, 'g.txt');
    }
  }
});

test('issues of one call in two leases cannot both declare a file or a resource nobody holds yet: the call is refused whole, naming the issue it would make the holder', () => {
  const root = twoLeasesOnTwoFiles();
  jarl(root, 'new', 'three', '--acceptance', '[read] it works', '--files', 'h.txt', '--tier', 'standard', '--kind', 'gap', '--prio', '2');
  jarl(root, 'set', '3', 'in-progress', 'D', '--branch', 'jarl/3-three', '--worker', 'wD');
  const before = logText(root);
  for (const ids of ['2,3', '3,2']) {
    const first = ids.split(',')[0];
    const second = ids.split(',')[1];
    assert.match(refuses(root, 'field', ids, 'files', 'new.txt', '--add'), new RegExp(`${second} declares new\\.txt, which ${first} holds in its lease`));
    assert.equal(logText(root), before, 'nothing was logged');
    assert.doesNotMatch(JSON.parse(jarl(root, 'show', first, '--json')).fields.files, /new\.txt/);
    assert.match(refuses(root, 'field', ids, 'resources', 'cache', '--add'), new RegExp(`${second} uses the resource cache, which ${first} holds in its lease`));
    assert.match(refuses(root, 'field', ids, 'resources', 'cache'), new RegExp(`${second} uses the resource cache, which ${first} holds in its lease`));
    assert.equal(logText(root), before, 'nothing was logged');
    assert.equal(JSON.parse(jarl(root, 'show', first, '--json')).fields.resources, undefined);
  }
  // Issues in one lease share what they declare.
  jarl(root, 'set', '3', 'in-progress', 'joins', '--branch', 'jarl/2-two', '--worker', 'wC', '--handover');
  jarl(root, 'field', '2,3', 'files', 'new.txt', '--add');
});

test('declaring a file or a resource an issue may take is not refused: its own lease\'s, one nobody holds, an issue no lease holds', () => {
  const root = twoLeasesOnTwoFiles();
  jarl(root, 'field', '2', 'files', 'g.txt, k.txt');
  jarl(root, 'field', '2', 'resources', 'cache');
  jarl(root, 'field', '2', 'files', '--clear');
  jarl(root, 'new', 'open one', '--acceptance', '[read] it works', '--files', 'm.txt', '--tier', 'standard', '--kind', 'gap', '--prio', '2');
  jarl(root, 'field', '3', 'files', 'f.txt');
  jarl(root, 'field', '3', 'resources', 'db-server');
  // An issue that joins the holder's lease declares what the lease holds.
  jarl(root, 'set', '3', 'in-progress', 'joins', '--branch', 'jarl/1-one', '--worker', 'wA');
  jarl(root, 'field', '3', 'files', 'f.txt, n.txt');
});

test('issues leased in one call, or added to the lease that holds their file, share it', () => {
  const { root } = twoOnOneFile();
  jarl(root, 'set', '1,2', 'in-progress', 'a package', '--branch', 'jarl/1-pkg', '--worker', 'wA');
  jarl(root, 'new', 'three', '--acceptance', '[read] it works', '--files', 'f.txt', '--tier', 'standard', '--kind', 'gap', '--prio', '2');
  jarl(root, 'set', '3', 'in-progress', 'joins the package', '--branch', 'jarl/1-pkg', '--worker', 'wA');
  assert.equal(JSON.parse(jarl(root, 'show', '3', '--json')).fields.branch, 'jarl/1-pkg');
  // The same branch with another worker is another lease.
  jarl(root, 'new', 'four', '--acceptance', '[read] it works', '--files', 'f.txt', '--tier', 'standard', '--kind', 'gap', '--prio', '2');
  assert.match(refuses(root, 'set', '4', 'in-progress', 'x', '--branch', 'jarl/1-pkg', '--worker', 'wZ'), /4 declares f\.txt, which 1 holds/);
});

test('a handover with its reason is accepted and logged, and the new lease replaces the old one', () => {
  const { root } = twoOnOneFile();
  jarl(root, 'set', '1', 'in-progress', 'A', '--branch', 'jarl/1-one', '--worker', 'wA', '--model', 'm-one');
  const out = JSON.parse(jarl(root, 'set', '1', 'in-progress', 'context grew far beyond the others', '--branch', 'jarl/1-one-b', '--worker', 'wB', '--handover', '--json'));
  assert.equal(out.handover, true);
  assert.equal(out.worker, 'wB');
  assert.match(logText(root), /· 1 → in-progress · context grew far beyond the others · handover · branch jarl\/1-one-b · worker wB\n/);
  const one = JSON.parse(jarl(root, 'show', '1', '--json'));
  assert.equal(one.fields.worker, 'wB');
  assert.equal(one.fields.branch, 'jarl/1-one-b');
  assert.equal(one.fields.model, undefined, 'the old worker\'s model is not the new one\'s');
  assert.equal(run(root, ['verify']).status, 0, 'verify places the line');
});

test('a handover needs its reason, a lease to replace and a change of holder', () => {
  const { root } = twoOnOneFile();
  assert.match(refuses(root, 'set', '1', 'in-progress', '--branch', 'jarl/1-one', '--worker', 'wA', '--handover'), /--handover says why the work changes hands: jarl\.mjs set 1 in-progress "<why-the-worker-changed>"/);
  assert.match(refuses(root, 'set', '1', 'in-progress', 'nobody', '--branch', 'jarl/1-one', '--worker', 'wA', '--handover'), /1 holds no lease to hand over/);
  jarl(root, 'set', '1', 'in-progress', 'A', '--branch', 'jarl/1-one', '--worker', 'wA');
  assert.match(refuses(root, 'set', '1', 'in-progress', 'same', '--branch', 'jarl/1-one', '--worker', 'wA', '--handover'), /names the lease 1 already has/);
  assert.match(refuses(root, 'set', '1', 'done', 'x', '--handover'), /--handover goes with in-progress only/);
  assert.match(refuses(root, 'set', '1', 'in-progress', '--header', '--handover'), /takes no reason, lease flag, --handover or base/);
  assert.match(refuses(root, 'field', '1', 'files', 'g.txt', '--handover'), /unknown flag --handover for field/);
});

test('a handover ends the old lease in the views: its worktree is not reported gone and its branch is not an orphan', () => {
  const { dir, g } = gitRepo({ prefix: 'jarl-lease-repo-' });
  R.initLoop(dir, 'goal');
  fileThreeDigits(dir, 'one', { files: 'f.txt' });
  const oldWt = `${dir}-wt-a`;
  g('worktree', 'add', '-q', '-b', 'jarl/001-a', oldWt);
  g('-C', oldWt, 'commit', '-q', '--allow-empty', '-m', 'first worker');
  R.setStatus(dir, '001', 'in-progress', 'A', { branch: 'jarl/001-a', worker: 'wA', worktree: oldWt });
  R.setStatus(dir, '001', 'in-progress', 'context grew far beyond the others', { branch: 'jarl/001-b', worker: 'wB', handover: true });
  g('branch', 'jarl/001-b');
  g('worktree', 'remove', '--force', oldWt);
  assert.doesNotMatch(header(dir, '001'), /\*\*Worktree:\*\*/, 'the worktree of the old lease left with it');
  const status = JSON.parse(jarl(dir, 'status', '--json'));
  assert.deepEqual(status.stale, [], 'no stale lease');
  const rows = JSON.parse(jarl(dir, 'branches', '--json'));
  const old = rows.find((b) => b.branch === 'jarl/001-a');
  assert.equal(old.unticketed, false, 'the branch the handover left is not a branch with no issue');
  assert.deepEqual(old.handedOver, ['001']);
  assert.match(jarl(dir, 'branches'), /jarl\/001-a .*HANDED OVER: 001 to jarl\/001-b/);
});

test('the record library holds the lease the same way and takes handover as an option', () => {
  const root = loop({ prefix: 'jarl-lease-lib-' });
  R.newIssue(root, 'one', { acceptance: '[read] it works', });
  R.setStatus(root, '001', 'in-progress', 'A', { branch: 'jarl/001-a', worker: 'wA' });
  assert.throws(() => R.setStatus(root, '001', 'in-progress', 'B', { branch: 'jarl/001-b', worker: 'wB' }), /001 is leased already/);
  const out = R.setStatus(root, '001', 'in-progress', 'fresh worker after three rounds', { branch: 'jarl/001-b', worker: 'wB', handover: true });
  assert.equal(out.handover, true);
  assert.equal(R.findIssue(root, '001').fields.worker, 'wB');
});
