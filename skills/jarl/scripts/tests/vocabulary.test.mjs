// The words the skill, the help and the tools use for one thing, and one thing for one word: the labels of the
// branch views, the profile's lease flag and the spelling it also accepts, the command that measures a branch's scope
// and the name it also answers to, the glossary the skill defines its terms in, and the words that name the owner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as R from '../record.mjs';
import { gitRepo, run } from './helpers.mjs';

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
