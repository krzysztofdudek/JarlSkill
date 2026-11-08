// Attachments: a file as a proof row.

import { readFileSync, realpathSync, lstatSync, fstatSync, openSync, closeSync, constants as fsConstants } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { plainRelative } from './where.mjs';
import { jarlLine } from './base.mjs';
import { ATTACH_MAX_BYTES, loadProfile } from './profile.mjs';
import { gateOf, gateState } from './gate.mjs';

// ---- attachments: a file as a proof row --------------------------------------------------------------------------
//
// An attachment is a Proof row whose command reads `attach <slot> <path> sha256:<hex> size:<bytes>` (the log's reader places
// it as a row carrying the slot facts, see attachmentOf): the slot a profile's done gate declares for the kind of the issue,
// the path of the file under the loop root, and the sha256 and size of the file as it was recorded. Nothing is copied. The
// path is resolved against the loop root and the file is opened without following a symlink, so a recorded file is always
// a regular file inside the root, read as bytes and never more than ATTACH_MAX_BYTES.

// The slots the profile requires of an issue's kind, each { name, place, extensions, minSize } with `place` as declared
// (see slotPlace for the issue's own); [] when the profile requires none.
export function requiredSlots(profile, issue) {
  const table = profile.doneGate['requires-slots'];
  const names = (table && table[issue.kind || profile.kindDefault]) || [];
  return names.map((name) => ({ name, place: profile.doneGate.slots[name].place, extensions: profile.doneGate.slots[name].extensions, minSize: profile.doneGate.slots[name]['min-size'] }));
}
// A slot's place for one issue: the declared pattern with <id> replaced by the issue's number.
function slotPlace(spec, issueId) { return spec.place.split('<id>').join(String(issueId)); }
// Whether `rel` is at the place `pattern`: equal to it, or, when it holds *, matching it with * standing for any
// characters but a /.
function atPlace(pattern, rel) {
  const parts = pattern.split('*');
  if (parts.length === 1) return pattern === rel;
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (rel.length < first.length + last.length || !rel.startsWith(first) || !rel.endsWith(last)) return false;
  const span = rel.slice(first.length, rel.length - last.length);
  if (span.includes('/')) return false;
  let from = 0;
  for (const middle of parts.slice(1, -1)) {
    const k = span.indexOf(middle, from);
    if (k === -1) return false;
    from = k + middle.length;
  }
  return true;
}
// The file at `rel` under the root: { missing: true }, { problem } or { size, sha256, name } (name: the path as the disk spells it).
// It resolves the root and the path, refuses a path that is, or sits under, a symlink, and refuses anything that is not a regular
// file (a pipe, a socket, a device, a directory) before it opens anything, so a pipe can never block the reader. The file is then
// opened without following a symlink and without blocking, and the descriptor must be the file the check saw (same device and inode).
// With `hash` false only the size is read, from the check alone: the file is never opened.
function readAttachment(root, rel, hash = true) {
  let base;
  try { base = realpathSync.native(root); } catch { return { problem: 'cannot be read: the loop root is not readable' }; }
  const abs = join(base, ...rel.split('/'));
  let real;
  try { real = realpathSync.native(abs); } catch { return { missing: true }; }
  const spelled = real !== abs && real.toLowerCase() === abs.toLowerCase();
  if (real !== abs && !spelled) return { problem: 'is, or sits under, a symlink: an attachment is a regular file inside the loop root' };
  const name = spelled ? relative(base, real).split(sep).join('/') : rel;
  let seen;
  try { seen = lstatSync(real); } catch { return { missing: true }; }
  if (seen.isSymbolicLink()) return { problem: 'is a symlink: an attachment is a regular file inside the loop root' };
  if (seen.isDirectory()) return { problem: 'is a directory' };
  if (!seen.isFile()) return { problem: 'is not a regular file: a pipe, a socket or a device cannot be an attachment' };
  const sizeProblem = (n) => (n > ATTACH_MAX_BYTES ? `is ${n} bytes, over the limit of 64 MiB` : n === 0 ? 'is empty' : null);
  if (!hash) return sizeProblem(seen.size) ? { problem: sizeProblem(seen.size) } : { size: seen.size, sha256: null, name };
  let fd;
  try { fd = openSync(real, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | (fsConstants.O_NONBLOCK || 0)); } catch (e) {
    if (e.code === 'ENOENT') return { missing: true };
    return { problem: e.code === 'EISDIR' ? 'is a directory' : e.code === 'ELOOP' ? 'is a symlink: an attachment is a regular file inside the loop root' : `cannot be opened (${e.code})` };
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.dev !== seen.dev || st.ino !== seen.ino) return { problem: 'was replaced while it was being read: an attachment is a regular file that stays put' };
    if (sizeProblem(st.size)) return { problem: sizeProblem(st.size) };
    const bytes = readFileSync(fd);
    if (bytes.length > ATTACH_MAX_BYTES) return { problem: `is ${bytes.length} bytes, over the limit of 64 MiB` };
    return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), name };
  } finally { closeSync(fd); }
}
// The file at `rel` held to a slot: its path, its place, its extension (in lower case) and its size, then its bytes. Returns
// { problem } (what is wrong with it, said as "<path> <problem>") or { size, sha256 }; `gone` is how a missing file is said.
// The path of a file held to a slot's place and extensions (the extension compared in lower case): the problem, or null.
function shapeProblem(spec, issueId, rel) {
  const place = slotPlace(spec, issueId);
  if (!atPlace(place, rel)) return `${rel} is not at the place of slot ${spec.name} (${place})`;
  const file = rel.slice(rel.lastIndexOf('/') + 1).toLowerCase();
  const ext = file.includes('.') ? file.slice(file.lastIndexOf('.') + 1) : '';
  return spec.extensions.includes(ext) ? null : `${rel} has the extension "${ext}", and slot ${spec.name} allows ${spec.extensions.join(', ')}`;
}
// `hash` false reads the size alone (see readAttachment); the result then holds no sha256. A result's `name` is the path as the
// disk spells it, which is the one a row records.
function inspectAttachment(root, issueId, spec, rel, gone, hash = true) {
  const bad = plainRelative(rel);
  if (bad) return { problem: `${rel === '' ? 'the path' : rel} ${bad}` };
  const shape = spec ? shapeProblem(spec, issueId, rel) : null;
  if (shape) return { problem: shape };
  const read = readAttachment(root, rel, hash);
  if (read.missing) return { problem: `${rel} ${gone}`, missing: true };
  if (read.problem) return { problem: `${rel} ${read.problem}` };
  const onDisk = spec && read.name !== rel ? shapeProblem(spec, issueId, read.name) : null;
  if (onDisk) return { problem: onDisk };
  if (spec && read.size < spec.minSize) return { problem: `${read.name} is ${read.size} bytes, under the minimum of ${spec.minSize} bytes` };
  return read;
}
// How a file that differs from its row is said: the recorded hash and the one the bytes have now, shortened.
function changedText(recorded, now) { return `${recorded.path} does not match its recorded sha256 (recorded ${recorded.sha256.slice(0, 12)}, now ${now.sha256.slice(0, 12)})`; }
// Where one required slot of an issue stands in the gate's window: the newest row of the slot, and the file as it is now. A
// retraction empties the slot, and never brings back an earlier row of it. state is missing (no row in the window, or the newest is
// retracted: `outside` says a row of the slot exists before the window opened), filled, gone, changed (the bytes are not the
// recorded ones) or refused. With `hash` false the file's size is compared and its bytes are not read, so changed then means a
// different size; the done gate and verify read the bytes.
function slotState(root, issue, spec, g, hash = true) {
  const rows = g.rowLog.filter((e) => e.attach && e.attach.slot === spec.name);
  const row = [...rows].reverse().find((e) => e.inWindow);
  if (!row || row.retracted) return { state: 'missing', spec, outside: !row && rows.length > 0 };
  const now = inspectAttachment(root, issue.id, spec, row.attach.path, 'is gone', hash);
  if (now.problem) return { state: now.missing ? 'gone' : 'refused', spec, row, problem: now.problem };
  if (now.size !== row.attach.size || (hash && now.sha256 !== row.attach.sha256)) return { state: 'changed', spec, row, problem: hash ? changedText(row.attach, now) : `${row.attach.path} is ${now.size} bytes, and ${row.attach.size} were recorded` };
  return { state: 'filled', spec, row };
}
// What stops an issue from being done for want of its attachments: one { slot, what, fix } for each required slot that is not
// filled, with the command that fills it. [] for an issue whose kind requires no slots.
// With `hash` false (the views) a file is compared by existence and size; the done gate reads the bytes.
export function slotProblems(root, profile, issue, g, hash = true) {
  const out = [];
  for (const spec of requiredSlots(profile, issue)) {
    const s = slotState(root, issue, spec, g, hash);
    if (s.state === 'filled') continue;
    out.push({ slot: spec.name, what: s.state === 'missing' ? (s.outside ? 'no file recorded inside the gate\'s window (a row from before the last start or reopen does not count)' : 'no file recorded') : s.problem, fix: `${jarlLine('evidence', issue.id, '--file', '<path>', '--slot', spec.name)} (a file at ${slotPlace(spec, issue.id)})` });
  }
  return out;
}
// The done gate's refusal for missing or broken attachments, or null.
function slotRefusal(root, profile, issue, g) {
  const problems = slotProblems(root, profile, issue, g);
  if (!problems.length) return null;
  return `${issue.id} needs these attachments before done (kind ${issue.kind || profile.kindDefault}): ${problems.map((p) => `slot ${p.slot}: ${p.what} — ${p.fix}`).join('; ')}`;
}
// The slots an issue's kind requires, each as { slot, state, place, extensions, path, size, sha256, problem } with the state the
// gate would read them in (see slotState; the bytes are read, so a changed file is told from an unchanged one). [] when the
// kind requires none. show prints them and show --json carries them.
export function attachmentStates(root, issue) {
  const profile = loadProfile(root);
  const specs = requiredSlots(profile, issue);
  if (!specs.length) return [];
  const g = gateState(root, issue.id);
  return specs.map((spec) => {
    const s = slotState(root, issue, spec, g);
    return {
      slot: spec.name, state: s.state === 'missing' && s.outside ? 'outside' : s.state, place: slotPlace(spec, issue.id), extensions: [...spec.extensions],
      path: s.row ? s.row.attach.path : null, size: s.row ? s.row.attach.size : null, sha256: s.row ? s.row.attach.sha256 : null, problem: s.problem || null,
    };
  });
}
// The lines show prints for an issue whose kind requires slots: each required slot, its recorded path and its state, one of
// filled, gone, changed, refused (with its reason), outside (a row recorded ahead of the gate's window, which does not count) and
// not recorded (with its place and extensions).
function attachmentLines(root, profile, issue) {
  const states = attachmentStates(root, issue);
  if (!states.length) return [];
  const lines = [`Attachments (slots an issue of kind ${issue.kind || profile.kindDefault} requires):`];
  for (const s of states) {
    if (s.path === null) { lines.push(`- ${s.slot}: ${s.state === 'outside' ? 'not recorded in the gate\'s window (a row from before the last start or reopen does not count)' : 'not recorded'} · place ${s.place} · ${s.extensions.join(', ')}`); continue; }
    lines.push(`- ${s.slot}: ${s.path} · ${s.size} bytes · sha256 ${s.sha256.slice(0, 12)} · ${s.state}${s.state === 'refused' ? ` (${s.problem})` : ''}`);
  }
  return lines;
}
// The recorded files of the loop that are gone or differ from what was recorded: verify's findings, one { id, what } for each slot of an issue
// whose newest row, when it is not retracted, names such a file.
function attachmentFindings(root, loop) {
  const out = [];
  for (const issue of loop.issues) {
    if (issue.id === null || !(loop.eventsById.get(issue.id) || []).some((e) => e.attach)) continue;
    const newest = new Map();
    for (const e of gateOf(loop, issue.id).rowLog) if (e.attach) newest.set(e.attach.slot, e.retracted ? null : e.attach);
    for (const [slot, a] of newest) {
      if (a === null) continue;
      const now = inspectAttachment(root, issue.id, null, a.path, 'is gone');
      if (now.problem) out.push({ id: issue.id, what: `slot ${slot}: ${now.problem}` });
      else if (now.sha256 !== a.sha256 || now.size !== a.size) out.push({ id: issue.id, what: `slot ${slot}: ${changedText(a, now)}` });
    }
  }
  return out;
}

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { attachmentFindings, attachmentLines, inspectAttachment, slotRefusal };
