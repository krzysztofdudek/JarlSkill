// show prints the gate's window by default and the file with --full (issue 280); every evidence row carries its
// file-wide ordinal, the number evidence --retract takes (issue 245); a long free-text evidence note is noted on stderr.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const L = await import('../jarl-lib.mjs');

function jarl(root, ...args) {
  return execFileSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function loop() {
  const root = mkdtempSync(join(tmpdir(), 'jarl-show-'));
  mkdirSync(join(root, '.git'));
  jarl(root, 'init', 'a goal');
  return root;
}
function started(root, title = 'thing to do') {
  const id = JSON.parse(jarl(root, 'new', title, '--acceptance', 'it works', '--json')).id;
  jarl(root, 'set', id, 'in-progress', '--worker', 'w-one', '--branch', `jarl/${id}-x`);
  return id;
}
const file = (root, id) => readFileSync(L.findIssue(root, id).file, 'utf8');

function threeRounds() {
  const root = loop();
  const id = started(root, 'worked in rounds');
  jarl(root, 'evidence', id, 'a note before anything ran');
  jarl(root, 'evidence', id, '--ran', 'run one', '--saw', 'saw one');
  jarl(root, 'review', id, 'changes', '--by', 'rev-a', 'Important: first problem\nwith a second line');
  jarl(root, 'round', id, 'red one');
  jarl(root, 'evidence', id, '--ran', 'run two', '--saw', 'saw two');
  jarl(root, 'review', id, 'changes', '--by', 'rev-b', 'Important: second problem');
  jarl(root, 'round', id, 'red two');
  jarl(root, 'evidence', id, '--ran', 'run three', '--saw', 'saw three');
  jarl(root, 'review', id, 'changes', '--by', 'rev-c', 'Critical: third problem');
  jarl(root, 'round', id, 'red three');
  return { root, id };
}

test('show prints the gate window: current rows and verdicts, one line per earlier round, every unanswered changes in full, and the call for the rest', () => {
  const { root, id } = threeRounds();
  jarl(root, 'evidence', id, '--ran', 'run four', '--saw', 'saw four');
  jarl(root, 'review', id, 'approve', '--by', 'rev-d', 'Minor: a name. The rest reads right');
  const shown = jarl(root, 'show', id);
  assert.match(shown, /^# 001 · worked in rounds\n/);
  assert.match(shown, /## Acceptance\nit works\n/);
  for (const row of ['run one', 'run two', 'run three', 'run four']) assert.match(shown, new RegExp(`\\*\\*ran:\\*\\* ${row}`), 'every row since the start is shown');
  assert.match(shown, /\*\*approve\*\* · by rev-d \(fresh\)/);
  assert.match(shown, /Minor: a name\. The rest reads right/, 'the current verdict is whole');
  const earlier = shown.split('\n').filter((l) => l.startsWith('- earlier: '));
  assert.equal(earlier.length, 3, 'one line for each earlier round');
  assert.match(earlier[0], /\*\*changes\*\* · by rev-a \(fresh\) · \d{4}-\d{2}-\d{2} · Important: first problem$/);
  assert.doesNotMatch(shown, /with a second line/, 'an answered earlier finding is a line, not the text');
  assert.match(shown, /\n\nThe whole issue, with every earlier round and row: jarl\.mjs show 001 --full$/);
  assert.match(jarl(root, 'show', id, '--full'), /with a second line/);

  // The same issue without the approve: the changes findings nothing answered are printed whole.
  const open = threeRounds();
  const unanswered = jarl(open.root, 'show', open.id);
  assert.match(unanswered, /Critical: third problem/);
  assert.match(unanswered, /Important: second problem/);
  assert.match(unanswered, /with a second line/, 'no approve came after any of them: all three are open, in full');
  assert.equal(unanswered.split('\n').filter((l) => l.startsWith('- earlier: ')).length, 0);
});

test('show: rows before the last start are not shown, and the ordinals in the bounded view, --full and --json are the same and retract the right row', () => {
  const root = loop();
  const id = started(root, 'restarted');
  jarl(root, 'evidence', id, '--ran', 'old one', '--saw', 'old result one', '--ran', 'old two', '--saw', 'old result two');
  jarl(root, 'set', id, 'deferred', 'waits for a decision');
  jarl(root, 'set', id, 'in-progress', '--worker', 'w-two', '--branch', 'jarl/001-x');
  jarl(root, 'evidence', id, '--ran', 'new three', '--saw', 'new result three');
  jarl(root, 'evidence', id, 'a note after the restart');
  jarl(root, 'evidence', id, '--ran', 'new four', '--saw', 'new result four');

  const bounded = jarl(root, 'show', id);
  assert.doesNotMatch(bounded, /old one|old two/);
  assert.match(bounded, /\(evidence rows 1-2 came before the last start or reopen and are not shown; rows 3-4 follow\)/);
  assert.match(bounded, /^- \[3\] \*\*ran:\*\* new three · \*\*saw:\*\* new result three$/m);
  assert.match(bounded, /^- \[4\] \*\*ran:\*\* new four · \*\*saw:\*\* new result four$/m);
  assert.match(bounded, /a note after the restart/);
  const full = jarl(root, 'show', id, '--full');
  assert.match(full, /^- \[1\] \*\*ran:\*\* old one/m);
  assert.match(full, /^- \[3\] \*\*ran:\*\* new three/m);
  assert.equal(full.replace(/^- \[\d+\] /gm, '- '), readFileSync(L.findIssue(root, id).file, 'utf8').trim(), '--full is the file, with only the row numbers added');
  const json = JSON.parse(jarl(root, 'show', id, '--json'));
  assert.deepEqual(json.evidenceRows.map((r) => [r.n, r.ran]), [[1, 'old one'], [2, 'old two'], [3, 'new three'], [4, 'new four']]);
  assert.equal(json.title, 'restarted');
  assert.ok(json.sections.evidence.includes('a note after the restart'), '--json is complete');

  // The number the bounded view printed names the row retracted.
  jarl(root, 'evidence', id, '--retract', '3', '--by', 'jarl', 'row three ran in the wrong place');
  const after = jarl(root, 'show', id);
  assert.match(after, /^- \[3\] ~~\*\*ran:\*\* new three · \*\*saw:\*\* new result three~~$/m);
  assert.match(after, /^- \[4\] \*\*ran:\*\* new four/m);
  assert.deepEqual(JSON.parse(jarl(root, 'show', id, '--json')).evidenceRows.map((r) => [r.n, r.retracted]), [[1, false], [2, false], [3, true], [4, false]]);
  // Row 1, an earlier one, is named by its number from --full.
  jarl(root, 'evidence', id, '--retract', '1', '--by', 'jarl', 'row one belonged to another issue');
  assert.match(file(root, id), /^- ~~\*\*ran:\*\* old one · \*\*saw:\*\* old result one~~$/m);
});

test('show leaves an issue the log does not match (written by hand) whole', () => {
  const root = loop();
  const id = JSON.parse(jarl(root, 'new', 'by hand', '--json')).id;
  jarl(root, 'evidence', id, '--ran', 'one', '--saw', 'result');
  jarl(root, 'set', id, 'in-progress', '--worker', 'w-one', '--branch', 'jarl/001-x');
  jarl(root, 'evidence', id, '--ran', 'two', '--saw', 'result two');
  jarl(root, 'review', id, 'approve', '--by', 'rev-a', 'read it all');
  assert.doesNotMatch(jarl(root, 'show', id), /\*\*ran:\*\* one/, 'the log and the file agree: the row before the start is not shown');
  // A row written into the file by hand: the file holds more than the log, so nothing is cut.
  const path = L.findIssue(root, id).file;
  writeFileSync(path, `${readFileSync(path, 'utf8').trimEnd()}\n- **ran:** by hand · **saw:** typed in\n`);
  const whole = jarl(root, 'show', id);
  assert.match(whole, /- \[1\] \*\*ran:\*\* one/);
  assert.match(whole, /- \[3\] \*\*ran:\*\* by hand/);
  assert.doesNotMatch(whole, /came before the last start/);
});

test('a long free-text evidence note is noted on stderr and still written whole; a short one and a row say nothing', () => {
  const root = loop();
  const id = JSON.parse(jarl(root, 'new', 'long note', '--json')).id;
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8' });
  const long = Array.from({ length: 40 }, (_, n) => `line ${n} of a long pasted output that nobody reads back`).join('\n');
  const r = run('evidence', id, long);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /^note: that evidence note is long \(\d+ characters, 40 lines\) and was written whole/);
  assert.ok(file(root, id).includes('line 39 of a long pasted output'), 'nothing is cut');
  assert.equal(run('evidence', id, 'a short note').stderr, '');
  assert.equal(run('evidence', id, '--ran', long, '--saw', 'ok').stderr, '', 'a row is the way to record a long output');
});
