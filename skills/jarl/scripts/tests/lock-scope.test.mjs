// The write lock is re-entrant per loop, never across loops, and it runs only synchronous work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';

process.env.JARL_LOCK_WAIT_MS = '300';
const R = await import('../record.mjs');

function loop(name) {
  const root = mkdtempSync(join(tmpdir(), `jarl-lock-${name}-`));
  R.initLoop(root, `loop ${name}`);
  return root;
}
// A lock held by another process that is alive on this host: the parent of this test process.
function heldElsewhere(root) {
  writeFileSync(join(R.jarlDir(root), '.lock'), `${process.ppid} ${hostname()} ${new Date().toISOString()}\n`);
}

test('inside the lock of loop A, a write to loop B still waits for B\'s own lock, held by another process', () => {
  const a = loop('a');
  const b = loop('b');
  try {
    heldElsewhere(b);
    assert.throws(() => R.withLock(a, () => R.appendLog(b, 'written past a held lock')), /\.jarl\/\.lock is held by another jarl\.mjs/);
    assert.doesNotMatch(readFileSync(join(R.jarlDir(b), 'log.md'), 'utf8'), /written past a held lock/);
    // A's own lock is re-entrant: a write to A inside it runs, and the lock is gone afterwards.
    R.withLock(a, () => R.appendLog(a, 'nested write'));
    assert.match(readFileSync(join(R.jarlDir(a), 'log.md'), 'utf8'), /nested write/);
    assert.equal(existsSync(join(R.jarlDir(a), '.lock')), false);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

test('two spellings of one loop are one lock: a write through a symlinked root inside the lock does not wait', () => {
  const a = loop('a');
  const link = `${a}-link`;
  try {
    symlinkSync(a, link);
    R.withLock(a, () => R.appendLog(link, 'through the link'));
    assert.match(readFileSync(join(R.jarlDir(a), 'log.md'), 'utf8'), /through the link/);
  } finally { try { unlinkSync(link); } catch { /* never made */ } rmSync(a, { recursive: true, force: true }); }
});

test('withLock refuses an async function before it runs, and a function returning a promise, and lets the lock go', () => {
  const a = loop('a');
  try {
    let ran = false;
    assert.throws(() => R.withLock(a, async () => { ran = true; }), /withLock takes a synchronous function/);
    assert.equal(ran, false);
    assert.throws(() => R.withLock(a, () => Promise.resolve(1)), /withLock takes a synchronous function/);
    assert.equal(existsSync(join(R.jarlDir(a), '.lock')), false);
    assert.equal(R.withLock(a, () => 7), 7);
  } finally { rmSync(a, { recursive: true, force: true }); }
});
