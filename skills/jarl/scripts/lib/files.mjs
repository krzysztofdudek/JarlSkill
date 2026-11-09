// A file read whole and written whole: an atomic write, so no reader ever sees half of one.

import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { needNoNewOwnersWords } from './owner.mjs';

const SLEEPER = new Int32Array(new SharedArrayBuffer(4));

function sleep(ms) { Atomics.wait(SLEEPER, 0, 0, ms); }

// Every text file the loop keeps is read with its line endings as LF: a loop is committed, and a Windows checkout
// with core.autocrlf (or an editor there) hands it back with CRLF, which every line-based parser here would misread. A
// byte order mark at the start (Windows editors write one) is no part of the text: it is dropped, so a findings file, a
// profile and a goal read the same with or without it.
export function readText(path) { return readFileSync(path, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n'); }

// Windows refuses a rename onto (or of) a file another process holds open — a reader without the lock, a virus
// scanner, the search indexer — with EPERM, EACCES or EBUSY, for the moment that handle stays open. Such a rename
// is retried for up to RENAME_RETRY_MS before the error is let through; everywhere else the first error is final.
export const RENAME_RETRY_MS = 2_000;

const RENAME_BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);

export function renameRetry(from, to, rename = renameSync, platform = process.platform) {
  const until = Date.now() + RENAME_RETRY_MS;
  for (let wait = 5; ; wait = Math.min(wait * 2, 100)) {
    try { rename(from, to); return; } catch (e) {
      if (platform !== 'win32' || !RENAME_BUSY.has(e.code) || Date.now() > until) throw e;
      sleep(wait);
    }
  }
}

// A file of a loop's record (anything under a .jarl directory) takes no new line that reads as the owner's words but
// the ones decide writes (see owner.mjs): every write of the record comes through here, whatever command or library call
// made it.
const IN_RECORD = /(?:^|[\\/])\.jarl[\\/]/;
function needRecordText(path, before, text) { if (IN_RECORD.test(path)) needNoNewOwnersWords(before(), text, basename(path)); }

// Whether every line of a file ends in CRLF: a Windows checkout with core.autocrlf, or an editor there, hands it back
// that way. A file read and written back keeps its endings: written whole, each line of the new text ends as the file's did;
// appended to, the bytes already there are not touched and the new lines end as they do.
const endsInCrlf = (raw) => raw.includes('\r\n') && !/(?:^|[^\r])\n/.test(raw);
const withEndingsOf = (raw, text) => (endsInCrlf(raw) ? text.replace(/\r?\n/g, '\r\n') : text);

// Written whole beside the target, then renamed over it: a reader sees the old file or the new one.
export function writeAtomic(path, text) {
  needRecordText(path, () => (existsSync(path) ? readText(path) : ''), text);
  writeRaw(path, existsSync(path) ? withEndingsOf(readFileSync(path, 'utf8'), text) : text);
}
function writeRaw(path, text) {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(tmp, text);
  try { renameRetry(tmp, path); } catch (e) { try { unlinkSync(tmp); } catch { /* gone */ } throw e; }
}

function appendAtomic(path, header, text) {
  needRecordText(path, () => '', text);
  if (!existsSync(path)) { writeRaw(path, header + text); return; }
  const raw = readFileSync(path, 'utf8');
  writeRaw(path, raw + withEndingsOf(raw, text));
}

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { RENAME_BUSY, appendAtomic, sleep };
