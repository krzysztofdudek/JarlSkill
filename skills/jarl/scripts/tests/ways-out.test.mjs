// Where an agent that knows only the skill or its brief stopped or went by hand: each of these places prints the way out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FINDINGS } from './findings.mjs';
import { SPAWN_TIMEOUT, gitRepo, jarl, loop as makeLoop, refuses, run, skillText } from './helpers.mjs';
import { NO_EXCLUDES } from './portable.mjs';

const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const ISSUE = '.jarl/issues/1-filed-before-the-split.md';

function committedLoop() {
  const { dir, g } = gitRepo({ prefix: 'jarl-ways-', branch: 'main' });
  jarl(dir, 'init', 'two drivers', '--committed');
  jarl(dir, 'new', 'filed before the split', '--acceptance', '[read] it works', '--tier', 'light', '--files', 'split.txt');
  g('add', '-A'); g('commit', '-qm', 'loop');
  return { dir, g };
}
function cloneOf(dir) {
  const c = mkdtempSync(join(tmpdir(), 'jarl-ways-clone-'));
  const g = (...a) => execFileSync('git', a, { cwd: c, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: SPAWN_TIMEOUT });
  g('clone', '-q', dir, '.');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  g('config', 'core.excludesFile', NO_EXCLUDES);
  return { dir: c, g };
}
// Two clones that each lease the first issue; the second is left in the merge git could not finish.
function mergeStopped() {
  const a = committedLoop();
  const b = cloneOf(a.dir);
  jarl(a.dir, 'set', '1', 'in-progress', 'mine', '--branch', 'jarl/1-on-a', '--worker', 'wa', '--model', 'm', '--by', 'coordinator A');
  a.g('add', '-A'); a.g('commit', '-qm', 'a leases 1');
  jarl(b.dir, 'set', '1', 'in-progress', 'mine too', '--branch', 'jarl/1-on-b', '--worker', 'wb', '--model', 'm', '--by', 'coordinator B');
  b.g('add', '-A'); b.g('commit', '-qm', 'b leases 1');
  assert.throws(() => b.g('pull', '-q', '--no-rebase', '--no-edit', 'origin', 'main'), 'the two headers conflict');
  return b;
}

test('verify names the git commands that take one side of a record file a merge left conflicted, and no hand edit', () => {
  const b = mergeStopped();
  const said = run(b.dir, ['verify']);
  assert.equal(said.status, 2, said.stdout);
  assert.match(said.stdout, new RegExp(`git -C \\S+ checkout --ours -- ${ISSUE.replace(/\./g, '\\.')}`));
  assert.match(said.stdout, new RegExp(`git -C \\S+ checkout --theirs -- ${ISSUE.replace(/\./g, '\\.')}`));
  assert.match(said.stdout, new RegExp(`git -C \\S+ add -- ${ISSUE.replace(/\./g, '\\.')}`));
  assert.doesNotMatch(said.stdout, /remove the markers|put a backslash/);
  // The commands it names are the way out: taken as printed, the file holds no marker and the finding is gone.
  b.g('-C', b.dir, 'checkout', '--theirs', '--', ISSUE);
  b.g('add', '--', ISSUE);
  assert.doesNotMatch(readFileSync(join(b.dir, ISSUE), 'utf8'), /^<{7} /m);
  assert.doesNotMatch(run(b.dir, ['verify']).stdout, /a git conflict marker/);
});

test('a merge committed with the markers in it: verify names the two sides of that merge commit', () => {
  const b = mergeStopped();
  b.g('add', '-A'); b.g('commit', '-qm', 'merged as it stood');
  const sha = b.g('rev-parse', 'HEAD').trim();
  const said = run(b.dir, ['verify']);
  assert.equal(said.status, 2, said.stdout);
  assert.match(said.stdout, new RegExp(`git -C \\S+ checkout '?${sha}\\^1'? -- ${ISSUE.replace(/\./g, '\\.')}`));
  assert.match(said.stdout, new RegExp(`git -C \\S+ checkout '?${sha}\\^2'? -- ${ISSUE.replace(/\./g, '\\.')}`));
  b.g('checkout', `${sha}^2`, '--', ISSUE);
  assert.doesNotMatch(run(b.dir, ['verify']).stdout, /a git conflict marker/);
});

test('markers that only quote a conflict are written again through the tool, which escapes them', () => {
  const a = committedLoop();
  const file = join(a.dir, ISSUE);
  writeFileSync(file, readFileSync(file, 'utf8').replace('## What\n', '## What\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> main\n'));
  const said = run(a.dir, ['verify']);
  assert.match(said.stdout, /if the lines only quote a conflict, write the text again with jarl\.mjs field 1 "<section-or-field>" "<text>"/);
});

test('the skill says what verify says: a conflicted record file is taken back with git, never edited by hand', () => {
  assert.match(skillText('SKILL.md'), /One tool moves the record\.[^\n]*git commands `verify` prints/);
  assert.match(skillText('references/jarl.md'), /\| two clones worked apart \| `verify` \|[^\n]*git commands it prints/);
});

test('a double lease left after a merge is named by verify with the form that keeps one, and the form settles it', () => {
  const b = mergeStopped();
  b.g('checkout', '--theirs', '--', ISSUE);
  b.g('add', '-A'); b.g('commit', '-qm', 'merge, keeping the first clone\'s file');
  const said = run(b.dir, ['verify']);
  assert.equal(said.status, 2, said.stdout);
  assert.match(said.stdout, /issue 1: leased twice with no move out between: by coordinator [AB] \(worker w[ab], jarl\/1-on-[ab]\)/);
  assert.match(said.stdout, /\(worker wa, jarl\/1-on-a\)/);
  assert.match(said.stdout, /\(worker wb, jarl\/1-on-b\)/);
  assert.match(said.stdout, /jarl\.mjs set 1 in-progress --handover --branch "<branch>" --worker "<name>" --model "<model-id>" "<why-the-worker-changed>"/);
  jarl(b.dir, 'set', '1', 'in-progress', '--handover', '--branch', 'jarl/1-on-a', '--worker', 'wa', '--model', 'm', 'keeping the first', '--by', 'jarl');
  const after = run(b.dir, ['verify']);
  assert.equal(after.status, 0, after.stdout);
});

test('an examiner of too low a model is told to give no verdict and how to say so', () => {
  const { dir } = gitRepo({ prefix: 'jarl-ways-', branch: 'feature' });
  jarl(dir, 'init', 'one issue');
  jarl(dir, 'new', 'the design', '--tier', 'strong', '--acceptance', '[read] it reads right');
  jarl(dir, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/1', '--worker', 'w', '--model', 'm', '--by', 'jarl');
  const brief = jarl(dir, 'brief', '1', '--role', 'reviewer');
  assert.match(brief, /Run at tier strong or above\. On a model below that tier give no verdict: say so with the question below, and stop\./);
  assert.match(brief, /a model below that tier, instead of a verdict: \S+ \S+jarl\.mjs ask "<text>" --kind escalation --issue 1 --by "<reviewer>"/);
  jarl(dir, 'ask', 'this model is below the tier of the review', '--kind', 'escalation', '--issue', '1', '--by', 'rev');
  assert.ok(json(dir, 'next', '--as', 'jarl', '--all').rows.some((r) => r.what === 'escalation' && r.ask === '1'), 'it is on the director, not on the owner');
});

test('a coordinator starts from the brief of its slice, and is told the slice is its whole business', () => {
  const root = makeLoop({ prefix: 'jarl-ways-', via: 'cli', dotGit: false });
  jarl(root, 'goal', '--set', 'Coordinators: odin, thor');
  jarl(root, 'new', 'odin work', '--acceptance', '[read] it works', '--tags', 'slice:odin', '--files', 'a.txt');
  const brief = jarl(root, 'brief', '--slice', 'odin');
  assert.match(brief, /^## Your first moves\n1\. This brief\.\n2\. jarl\.mjs resume --slice odin --as odin\n3\. jarl\.mjs next --as odin\n/m);
  assert.match(brief, /Your business is the slice odin alone: [^\n]*Do not report it or act on it\./);
  jarl(root, 'resume', '--slice', 'odin', '--as', 'odin');
  assert.match(jarl(root, 'resume', '--slice', 'odin'), /^scoped to the slice of odin,.*: what they show of another slice is the jarl's, not yours$/m);
  assert.match(skillText('SKILL.md'), /^- \*\*You run a slice as a coordinator\.\*\* Start with `brief --slice <name>`, then `resume --slice <name> --as <name>`[^\n]*/m);
  const skill = skillText('SKILL.md');
  assert.ok(skill.indexOf('You run a slice as a coordinator') < skill.indexOf('A `.jarl/` already holds a loop'), 'it comes before the move that sends everyone to resume');
  assert.match(skillText('references/jarl.md'), /and starts from `brief --slice <name>`, then `resume --slice <name> --as <name>`/);
  assert.match(skillText('references/jarl.md'), /\| you compact \| your next turn \| `resume --as <who>`; a coordinator `brief --slice <name>`, then `resume --slice <name> --as <name>` \|/);
});

test('the skill names the owner\'s digest as the move for what waits on him', () => {
  assert.match(skillText('SKILL.md'), /^- \*\*You are asked what waits on the owner\.\*\* `next --as owner --all`/m);
});

test('brief takes a range of ids as set does', () => {
  const { dir } = gitRepo({ prefix: 'jarl-ways-', branch: 'feature' });
  jarl(dir, 'init', 'a package');
  for (const t of ['one', 'two', 'three']) jarl(dir, 'new', t, '--acceptance', '[read] it works', '--tier', 'light');
  jarl(dir, 'set', '1-3', 'in-progress', 'go', '--branch', 'jarl/1-pack', '--worker', 'w', '--model', 'm', '--by', 'jarl');
  assert.deepEqual(json(dir, 'brief', '1-3').ids, ['1', '2', '3']);
  assert.equal(jarl(dir, 'brief', '1-3'), jarl(dir, 'brief', '1,2,3'));
});

test('the refusal of a reason on set --header prints a form with no reason in it', () => {
  const root = makeLoop({ prefix: 'jarl-ways-', via: 'cli', dotGit: false });
  jarl(root, 'new', 'one', '--acceptance', '[read] it works');
  const said = refuses(root, 'set', '1', 'open', 'a reason', '--header');
  assert.match(said, /--header rewrites the header from the log and takes no reason/);
  assert.doesNotMatch(said, /<why>|<text>/);
  assert.match(said, /jarl\.mjs set "<ids>" "<status-in-the-log>" --by "<who>" --header/);
});

test('a slice\'s integration branch landed after its issues went done leaves their gate holding', () => {
  const { dir, g } = gitRepo({ prefix: 'jarl-ways-', branch: 'feature' });
  jarl(dir, 'init', 'slices with mergers');
  jarl(dir, 'goal', '--set', 'Coordinators: odin');
  jarl(dir, 'goal', '--set', 'Merger (odin): mimir');
  jarl(dir, 'new', 'sliced', '--tier', 'light', '--acceptance', '[read] it works', '--tags', 'slice:odin', '--files', 'a.txt');
  g('branch', 'jarl/slice-odin');
  jarl(dir, 'set', '1', 'in-progress', 'go', '--branch', 'jarl/1-sliced', '--worker', 'w1', '--model', 'm', '--by', 'jarl');
  g('checkout', '-qb', 'jarl/1-sliced');
  writeFileSync(join(dir, 'a.txt'), 'changed\n');
  g('add', 'a.txt'); g('commit', '-qm', 'the work');
  jarl(dir, 'review', '1', 'approve', '--by', 'rev', '--model', 'm2', FINDINGS);
  g('checkout', '-q', 'jarl/slice-odin');
  g('merge', '-q', '--no-ff', '--no-edit', 'jarl/1-sliced');
  const intoSlice = g('rev-parse', 'HEAD').trim();
  jarl(dir, 'merged', '1', '--sha', intoSlice, '--ran', 'npm test', '--saw', 'pass', '--keep', '--by', 'mimir');
  jarl(dir, 'set', '1', 'done', 'landed on the slice', '--by', 'odin');
  g('checkout', '-q', 'feature');
  g('merge', '-q', '--no-ff', '--no-edit', 'jarl/slice-odin');
  jarl(dir, 'merged', '1', '--sha', g('rev-parse', 'HEAD').trim(), '--ran', 'npm test', '--saw', 'pass', '--keep', '--by', 'muninn');
  assert.deepEqual(json(dir, 'status').closedGate ?? [], []);
  assert.doesNotMatch(jarl(dir, 'resume'), /gate does not hold/);
});

test('the merger\'s brief skips the changelog step where the repository keeps no changelog', () => {
  const { dir } = gitRepo({ prefix: 'jarl-ways-', branch: 'feature' });
  jarl(dir, 'init', 'one issue');
  assert.match(jarl(dir, 'brief', '--role', 'merger'), /^7\. Changelog entries, once the batch is green:[^\n]* A repository with no changelog skips this step\.$/m);
});

test('the model guidance says a lone agent holds the merger\'s role, on whatever model it runs', () => {
  assert.match(skillText('references/models.md'), /Readers and the merger run on the standard tier\. A lone agent holds every role but the examiner's, the merger's included, on the model it runs on\./);
});

test('what is not in a coordinator\'s slice is not its business, even when the record shows it', () => {
  const root = makeLoop({ prefix: 'jarl-ways-', via: 'cli', dotGit: false });
  jarl(root, 'goal', '--set', 'Coordinators: odin');
  jarl(root, 'new', 'odin work', '--acceptance', '[read] it works', '--tags', 'slice:odin', '--files', 'a.txt');
  assert.match(jarl(root, 'brief', '--slice', 'odin'), /Your business is the slice odin alone: what is not in it is not your business, even when `resume` without --slice or the record files show it\./);
  assert.match(skillText('SKILL.md'), /nothing outside it is your business, even where the record shows it\./);
  assert.match(skillText('references/jarl.md'), /what is not in its slice is not its business, even when the record shows it\./);
});
