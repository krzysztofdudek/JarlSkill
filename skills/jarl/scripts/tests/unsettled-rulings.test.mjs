// A ruling in force whose Settles names an issue that is neither done nor dropped is work ruled and not yet carried out:
// verify lists it as a note, with the ruling's slug and those issues, and resume lists it under its own heading. A
// ruling whose every issue is settled, and a superseded ruling, are not listed. The note leaves verify clean,
// because a ruling that waits on its work is the ordinary state of a loop in flight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jarl, run, loop as makeLoop } from './helpers.mjs';
import { FINDINGS } from './findings.mjs';

function rulingsLoop() {
  const root = makeLoop({ prefix: 'jarl-unsettled-', via: 'cli' });
  for (const t of ['still open', 'carried out', 'given up']) jarl(root, 'new', t, '--acceptance', 'it holds');
  jarl(root, 'set', '2', 'in-progress', '--worker', 'w2', '--by', 'jarl');
  jarl(root, 'evidence', '2', '--ran', 'proofread', '--saw', 'reads well', '--by', 'w2');
  jarl(root, 'review', '2', 'approve', '--by', 'rev-2', FINDINGS);
  jarl(root, 'set', '2', 'done', 'the gate holds', '--by', 'jarl');
  jarl(root, 'set', '3', 'dropped', 'not needed', '--by', 'jarl');
  jarl(root, 'decide', 'waits-on-work', 'Do the first two.', '--by', 'jarl', '--settles', '1,2');
  jarl(root, 'decide', 'all-settled', 'Do the last two.', '--by', 'jarl', '--settles', '2,3');
  jarl(root, 'decide', 'old-word', 'Do the first one the old way.', '--by', 'jarl', '--settles', '1');
  jarl(root, 'decide', 'new-word', 'Do it the new way.', '--by', 'jarl', '--supersedes', 'old-word');
  return root;
}

test('verify lists a ruling in force whose Settles names an issue neither done nor dropped, with its slug and those ids, and stays clean', () => {
  const root = rulingsLoop();
  const r = run(root, ['verify']);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^verify: clean/);
  assert.match(r.stdout, /^note: ruling waits-on-work: settles 1 \(open\), which is neither done nor dropped$/m);
  assert.doesNotMatch(r.stdout, /all-settled|old-word|new-word/);
  const out = JSON.parse(jarl(root, 'verify', '--json'));
  assert.deepEqual(out.notes.filter((n) => n.where.startsWith('ruling ')), [{ where: 'ruling waits-on-work', what: 'settles 1 (open), which is neither done nor dropped' }]);
});

test('resume lists the same rulings under their own heading, and none when every ruling in force is settled', () => {
  const root = rulingsLoop();
  const text = jarl(root, 'resume');
  assert.match(text, /^## Rulings whose issues are not closed \(1\)\n- waits-on-work · settles 1 \(open\)$/m);
  assert.deepEqual(JSON.parse(jarl(root, 'resume', '--json')).unsettled, [{ slug: 'waits-on-work', issues: [{ id: '1', status: 'open' }] }]);
  jarl(root, 'set', '1', 'dropped', 'done another way', '--by', 'jarl');
  assert.doesNotMatch(jarl(root, 'resume'), /Rulings whose issues are not closed/);
  assert.doesNotMatch(jarl(root, 'verify'), /^note: ruling /m);
});
