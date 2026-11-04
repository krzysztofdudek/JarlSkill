// One writer at a time: the write lock every change to a loop holds.

import { existsSync, realpathSync, statSync, openSync, closeSync, writeSync, unlinkSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { refuse } from './base.mjs';
import { jarlDir } from './where.mjs';
import { RENAME_BUSY, readText, sleep, writeAtomic } from './files.mjs';
import { JARL_GITIGNORE_COMMITTED, ensureLoopMerge } from './loop-git.mjs';

// ---- one writer at a time ------------------------------------------------------------------------

// Workers, reviewers and the merger all write through this tool with the same --root, often at the same
// moment. Every command that writes therefore runs under .jarl/.lock, taken with the exclusive-create flag
// so exactly one process holds it; the owner's pid, host and start time are written inside it. A lock
// whose owner is gone is broken and taken over (see lockIsStale); a caller that cannot get it within
// LOCK_WAIT_MS fails loudly, naming the owner, rather than writing without it. And every file is written
// whole to a temporary file beside it and renamed into place, so a reader that takes no lock (list, show)
// never sees half a file.
export const LOCK_STALE_MS = 30_000;          // a lock from another host, or one whose owner cannot be read
export const LOCK_REUSED_PID_MS = 10 * 60_000; // a lock on this host whose pid runs, against pid reuse
export const LOCK_EMPTY_MS = 2_000;            // a lock with nothing in it: its owner died between create and write
export const LOCK_BREAK_STALE_MS = 5_000;      // a breaker's own lock (below), left by a breaker that died
export const LOCK_WAIT_MS = Number(process.env.JARL_LOCK_WAIT_MS) || 20_000;   // the variable is a test knob
function lockPath(root) { return join(jarlDir(root), '.lock'); }
// Re-entrant per loop, never across loops: a command that calls another write on the same loop takes that loop's lock
// once, and a write to another loop from inside it takes the other loop's own lock. Keyed by the loop's directory
// with symlinks resolved, so two spellings of one root are one lock.
const HELD = new Map();
function lockKey(root) { try { return realpathSync.native(jarlDir(root)); } catch { return resolve(jarlDir(root)); } }
// fn runs synchronously under the lock. A function that returns a promise would run its awaited part after the lock
// is released, so it is refused: an async function before it runs, any other that hands back a promise when it does.
const ASYNC_REFUSAL = 'withLock takes a synchronous function: the lock is released when it returns, so an async function (or one returning a promise) would write after the release — do the async work first, then call withLock with the writes';
function isThenable(v) { return v !== null && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function'; }
function runSync(fn) {
  const out = fn();
  if (isThenable(out)) throw new TypeError(ASYNC_REFUSAL);
  return out;
}

// Stale: empty for longer than LOCK_EMPTY_MS; on this host, an owner whose pid does not run (or, against pid
// reuse, one held for longer than LOCK_REUSED_PID_MS); from another host (a shared checkout) or with an unreadable
// owner, one held for longer than LOCK_STALE_MS.
function lockIsStale(text, mtimeMs) {
  const age = Date.now() - mtimeMs;
  if (!text.trim()) return age > LOCK_EMPTY_MS;
  const [pid, host] = text.split('\n')[0].split(' ');
  if (host === hostname() && Number(pid) > 0) {
    try { process.kill(Number(pid), 0); } catch (e) { if (e.code === 'ESRCH') return true; }
    return age > LOCK_REUSED_PID_MS;
  }
  return age > LOCK_STALE_MS;
}

// Breaking a stale lock is itself serialized, behind .jarl/.lock.break (exclusive create): only its owner
// may remove .lock, and only when .lock still holds exactly the content judged stale. A live lock is never
// moved or renamed, so a fresh owner that took the lock meanwhile keeps it. A breaker that died leaves
// .lock.break behind; it is removed after LOCK_BREAK_STALE_MS (breaking takes milliseconds).
function breakStaleLock(root, stale) {
  const brk = join(jarlDir(root), '.lock.break');
  const mine = `${process.pid} ${hostname()} ${new Date().toISOString()}\n`;
  try {
    const fd = openSync(brk, 'wx');
    try { writeSync(fd, mine); } finally { closeSync(fd); }
  } catch (e) {
    if (e.code !== 'EEXIST') return;
    try { if (Date.now() - statSync(brk).mtimeMs > LOCK_BREAK_STALE_MS) unlinkSync(brk); } catch { /* gone */ }
    return;
  }
  try {
    let now = null;
    try { now = readText(lockPath(root)); } catch { /* released meanwhile */ }
    if (now === stale) unlinkSync(lockPath(root));
  } catch { /* released meanwhile */ } finally {
    try { if (readText(brk) === mine) unlinkSync(brk); } catch { /* gone */ }
  }
}

// Waiting for a lock held elsewhere blocks the whole thread (Atomics.wait), for up to LOCK_WAIT_MS (20 s): the
// tool is synchronous by design, so a caller with an event loop to keep alive should call it off that loop.
export function withLock(root, fn) {
  if (typeof fn !== 'function' || fn.constructor?.name === 'AsyncFunction') throw new TypeError(ASYNC_REFUSAL);
  // Before init there is no .jarl/ to guard and nothing in it to lose: init runs unguarded.
  if (!existsSync(jarlDir(root))) return runSync(fn);
  const key = lockKey(root);
  if (HELD.get(key) > 0) return runSync(fn);
  const path = lockPath(root);
  const mine = `${process.pid} ${hostname()} ${new Date().toISOString()}\n`;
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = openSync(path, 'wx');
      try { writeSync(fd, mine); } finally { closeSync(fd); }
      break;
    } catch (e) {
      if (e.code === 'ENOENT') refuse(`no .jarl/ here any more — the loop was closed or archived while this command waited (${jarlDir(root)})`, ['jarl.mjs', 'init', '<goal>']);
      // Windows: a lock just released is "delete pending" while another process still has it open (a waiter reading
      // it), and creating it again is refused with EPERM until that handle closes — a busy lock, not an error.
      if (!(e.code === 'EEXIST' || (process.platform === 'win32' && RENAME_BUSY.has(e.code)))) throw e;
    }
    let text = ''; let mtimeMs = Date.now();
    try { text = readText(path); mtimeMs = statSync(path).mtimeMs; } catch {   // released meanwhile
      if (Date.now() > until) refuse(`.jarl/.lock could not be taken within ${LOCK_WAIT_MS} ms — nothing was written; retry`, { retry: true });
      sleep(1 + Math.floor(Math.random() * 5));
      continue;
    }
    if (lockIsStale(text, mtimeMs)) { breakStaleLock(root, text); sleep(1 + Math.floor(Math.random() * 5)); continue; }
    if (Date.now() > until) refuse(`.jarl/.lock is held by another jarl.mjs (${text.trim() || 'holder unknown'}) — nothing was written; retry, or remove ${path} if that process is gone`, { retry: true });
    sleep(10 + Math.floor(Math.random() * 40));
  }
  HELD.set(key, 1);
  try {
    const out = runSync(fn);
    // A committed loop that has no narrow ignore file gets it here: under the lock, and only
    // after a command that wrote (a refused one writes nothing). close may have removed .jarl/ meanwhile.
    const ignore = join(jarlDir(root), '.gitignore');
    if (existsSync(jarlDir(root)) && !existsSync(ignore)) writeAtomic(ignore, JARL_GITIGNORE_COMMITTED);
    // Likewise the merge setup (.jarl/.gitattributes and the decisions driver), once: a loop that has the file is set.
    if (existsSync(jarlDir(root)) && !existsSync(join(jarlDir(root), '.gitattributes'))) ensureLoopMerge(root);
    return out;
  } finally {
    HELD.delete(key);
    // Release only a lock that is still this one: close removes .jarl/ with it, and a lock broken as stale
    // may already belong to someone else.
    try { if (readText(path) === mine) unlinkSync(path); } catch { /* removed with .jarl/ */ }
  }
}

// Whether argv1 (process.argv[1]) names the script self: compared as real paths, and without case on Windows, so a
// plugin root spelled with another drive-letter case (c:\ against C:\), or reached through a symlink or a junction,
// still counts as this script. The CLI and the MCP server both start only when this holds.
export function isEntry(argv1, self, platform = process.platform) {
  if (!argv1) return false;
  const real = (p) => { try { return realpathSync.native(p); } catch { return resolve(p); } };
  const [a, b] = [real(resolve(argv1)), real(self)];
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
