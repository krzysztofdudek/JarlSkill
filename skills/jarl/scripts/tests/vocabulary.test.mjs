// The words the skill, the help and the tools use for one thing, and one thing for one word: the labels of the
// branch views, the profile's lease flag and the spelling it also accepts, the command that measures a branch's scope
// and the name it also answers to, the glossary the skill defines its terms in, and the words that name the owner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import * as R from '../record.mjs';
import { gitRepo, jarlResult, run } from './helpers.mjs';

const NO_GH = { JARL_GH: join(tmpdir(), 'jarl-vocab-no-gh') };

test('tips labels a worker branch as a worker branch and the checkout branch by its role in the skill, the feature branch', () => {
  const { dir, g } = gitRepo({ prefix: 'jarl-vocab-tips-', branch: 'feature' });
  g('branch', 'jarl/2-a');
  R.initLoop(dir, 'goal');
  R.newIssue(dir, 'first', { acceptance: 'it works' });
  R.newIssue(dir, 'second', { acceptance: 'it works' });
  R.setStatus(dir, '2', 'in-progress', undefined, { branch: 'jarl/2-a', worker: 'w2' });
  const o = JSON.parse(run(dir, ['tips', '--json'], { env: NO_GH }).stdout);
  assert.deepEqual(o.repos[0].rows.map((r) => [r.role, r.branch]), [['worker', 'jarl/2-a'], ['feature', 'feature']]);
});

// The same loop, opened under a profile that writes the claim's flag one way or the other, and the views read after the
// same moves: the two transcripts must match, word for word, once the directory is taken out.
function transcript(flag) {
  const { dir } = gitRepo({ prefix: 'jarl-vocab-flag-', branch: 'feature' });
  const profiles = mkdtempSync(join(tmpdir(), 'jarl-vocab-profile-'));
  const file = join(profiles, 'profile.json');
  writeFileSync(file, JSON.stringify({
    'jarl-profile': 1,
    name: 'stock',
    statuses: { open: ['dispatchable'], running: [flag], done: ['settles-dependents', 'terminal', 'closes-record'], dropped: ['terminal', 'needs-reason'] },
  }));
  jarlResult(dir, ['init', 'goal', '--profile', file]);
  jarlResult(dir, ['new', 'first']);
  jarlResult(dir, ['new', 'second']);
  const set = jarlResult(dir, ['set', '2', 'running', '--branch', 'jarl/2-a', '--worker', 'w2']).stdout;
  const views = [['status'], ['next', '--all'], ['list', '--all'], ['queue'], ['show', '2'], ['resume']];
  const out = views.map((args) => jarlResult(dir, args).stdout);
  // The directory's path and its name, the times and the commit ids of the two repositories are taken out: they differ by run.
  const scrub = (text) => text.split(realpathSync(dir)).join('<root>').split(dir).join('<root>').split(basename(dir)).join('<name>')
    .replace(/\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?/g, '<date>').replace(/\b[0-9a-f]{12}\b/g, '<sha>');
  return scrub([set, ...out].join('\n----\n'));
}

test('a profile declaring the lease flag loads and behaves exactly as one declaring holds-claim', () => {
  assert.equal(transcript('lease'), transcript('holds-claim'));
});

test('a profile validation message names the lease, and a status names the flag once whichever spelling it uses', () => {
  assert.throws(() => R.validateProfile({ 'jarl-profile': 1, statuses: { a: ['dispatchable'], b: ['terminal'] } }), /no status is a lease/);
  assert.throws(() => R.validateProfile({ 'jarl-profile': 1, statuses: { a: ['dispatchable'], b: ['lease', 'holds-claim', 'settles-dependents'] } }), /names a flag twice/);
  assert.doesNotThrow(() => R.validateProfile({ 'jarl-profile': 1, statuses: { a: ['dispatchable'], b: ['lease'], c: ['terminal', 'settles-dependents'] } }));
});
