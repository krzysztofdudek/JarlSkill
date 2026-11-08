// Where a header and the log disagree: what the record says, the sentence for it and the repair.

import { basename } from 'node:path';
import { CI_STATES, fieldText, jarlLine } from './base.mjs';
import { idKey, idRe } from './ids.mjs';
import { evidenceRows, headerReadText, mergedOf, sharedNumberText, sharedNumbers } from './issues.mjs';

// Where the files disagree with the journal, which is the record: one entry { id, field, onFile, record, line } per
// header field (Status, Branch, Worker, Model, Since, Merged, CI) whose value differs from the journal's, one per
// issue the journal holds no filing and no move of (field 'journal'), and one per status a line of the journal moves an
// issue into that the loop's profile does not list (field 'profile': the line reads as a note, not as a move), and one per number two issue files carry (field 'number', with the files), each in place of the fields and with no advice to write the log's value into a header, and one per contradiction inside the header of an issue whose number the log cannot attribute (field 'header'), which is read from its header and never compared with the log. The
// views never believe the header; they print these. Each line names how the disagreement is settled: the header written
// back to the journal's value, which writes nothing else, or the move or merge that makes the header's value the
// record, which writes a line of its own.
export const FIELD_NAMES = { status: 'Status', branch: 'Branch', worker: 'Worker', model: 'Model', since: 'Since', merged: 'Merged', 'merge check': 'Merge check', ci: 'CI' };

const LEASE_KEYS = ['branch', 'worker', 'model'];

const ghostRe = idRe('^({id}) → (\\S+)');

export function recordDisagreements(loop) {
  const { profile } = loop;
  const out = [];
  // A number two files carry is one entry naming both: the log's lines for it are read for each file, so a header that
  // differs from them may be the true one, and copying the log's value into it would move an issue nobody moved.
  const shared = sharedNumbers(loop.issues);
  const sharedFiles = new Set(shared.flatMap((s) => s.issues.map((i) => i.file)));
  for (const s of shared) out.push({ id: s.id, field: 'number', onFile: null, record: null, files: s.issues.map((i) => `issues/${basename(i.file)}`), line: `record: ${sharedNumberText(s, loop.issues)}` });
  for (const issue of loop.issues) {
    if (issue.id === null || sharedFiles.has(issue.file)) continue;
    const id = issue.id;
    // A number the log cannot attribute is read from its header, so the header is never compared with the log; it is
    // checked against itself, which still catches a hand edit that contradicts the file.
    if (issue.byHeader) {
      for (const what of headerContradictions(profile, issue, loop.events)) out.push({ id, field: 'header', onFile: issue.status, record: null, line: `record: ${id} is read from its header (issues/${basename(issue.file)}), and the header contradicts itself: ${what}` });
      continue;
    }
    if (issue.onFile === null) {
      const status = profile.statuses.includes(issue.status) ? issue.status : profile.initial;
      out.push({ id, field: 'journal', onFile: issue.status, record: null, line: `record: ${id} is not in the log (it holds no filing and no move), so its header is read as it stands — to put it in the log: ${jarlLine('set', id, status, ...(profile.is(status, 'needs-reason') ? ['<text>'] : []))}${profile.is(status, 'closes-record') ? ' (through its checks)' : ''}` });
      continue;
    }
    for (const field of Object.keys(FIELD_NAMES)) {
      const file = fieldText(issue.onFile[field]);
      const record = fieldText(field === 'status' ? issue.status : issue.fields[field]);
      // A header that never carried the Merge check (the merge was written without the field) is read from the merge line, and said nothing about.
      if (field === 'merge check' && !file) continue;
      if (file !== record) out.push(fieldDisagreement(profile, issue, field, file, record));
    }
  }
  // A shared number's files are checked against themselves too: each is read from its own header while they share it.
  for (const s of shared) for (const issue of s.issues) {
    for (const what of headerContradictions(profile, issue, loop.events)) out.push({ id: s.id, field: 'header', onFile: issue.status, record: null, line: `record: ${s.id} is read from its header (issues/${basename(issue.file)}), and the header contradicts itself: ${what}` });
  }
  out.push(...unreadableMoves(loop));
  return out;
}

// What a header read as the record says against itself: a status the profile does not list, a lease that its status
// does not hold or a status that holds one with no lease, a CI with no merge, and a closing status with no proof row
// in the file's Evidence, or one the log never moved the number into: Jarl refuses a close of a number the log cannot
// attribute, so a closing status that no closing move of the number stands behind was written by hand. A close the log
// holds under the number may be another file's; that the record cannot tell.
function headerContradictions(profile, issue, events) {
  const out = [];
  const has = (k) => Boolean(fieldText(issue.fields[k]));
  const st = issue.status;
  if (!profile.statuses.includes(st)) { out.push(`its Status ${st} is not one the loop's profile lists`); return out; }
  if (profile.is(st, 'holds-claim')) {
    if (!has('since')) out.push(`its Status ${st} holds a lease, and it has no Since`);
  } else {
    for (const k of ['worker', 'since', 'worktree']) if (has(k)) out.push(`it carries ${k === 'worktree' ? 'Worktree' : FIELD_NAMES[k]}, and its Status ${st} holds no lease`);
  }
  if (has('ci') && !has('merged')) out.push('it carries CI and no Merged');
  if (profile.is(st, 'closes-record') && evidenceRows(issue).length === 0) out.push(`its Status ${st} closes it, and its Evidence holds no --ran/--saw row`);
  if (profile.is(st, 'closes-record') && !events.some((e) => e.id === issue.id && e.type === 'move' && profile.is(e.to, 'closes-record'))) out.push(`its Status ${st} closes it, and the log holds no move of ${issue.id} into a status that closes it: a number the log cannot attribute is never closed through Jarl`);
  return out;
}

// The issues read from their headers because the log files their number more than once, while one file carries it: one
// note each, { id, file, filings, line }. They are not disagreements: the header is the record for them.
export function headerReadNotes(loop) {
  return loop.issues.filter((i) => i.byHeader && !i.shared).map((i) => {
    const file = `issues/${basename(i.file)}`;
    return { id: i.id, file, filings: i.byHeader.filings, line: headerReadText(i.id, i.byHeader.filings, file) };
  });
}

// The sentence about one header field: what the file holds against what the log holds.
function disagreementSentence(name, file, record) {
  const inFile = file ? `reads ${file} in the file` : 'is missing from the file';
  const inLog = record ? (file ? `${record} in the log` : `reads ${record} in the log`) : 'is not in the log';
  return `${name} ${inFile} and ${inLog}`;
}

// The command that makes the file's value the record, or '' when the field has none. It writes a line of its own.
function makeFileTheRecord(profile, issue, field, file) {
  const id = issue.id;
  if (!file) return '';
  if (field === 'status') {
    if (!profile.statuses.includes(file)) return '';
    return `${jarlLine('set', id, file, ...(profile.is(file, 'needs-reason') ? ['<text>'] : []))} (a move into ${file}${profile.is(file, 'closes-record') ? ', through its checks' : ''})`;
  }
  if (LEASE_KEYS.includes(field)) {
    if (!profile.is(issue.status, 'holds-claim')) return '';
    // Another worker or branch than the lease the log holds is a new holder: the lease is handed over, with its reason.
    const handover = (field === 'worker' || field === 'branch') && Boolean(issue.fields[field]);
    return handover ? `${jarlLine('set', id, issue.status, '<text>', `--${field}`, file, '--handover')} (a handover, a new move line, which stamps Since again)` : `${jarlLine('set', id, issue.status, `--${field}`, file)} (a new move line, which stamps Since again)`;
  }
  if (field === 'merged') {
    const merge = /^\S+(?: in .+)?$/.test(file) ? mergedOf({ fields: { merged: file } }) : null;
    if (!merge) return '';
    const ci = fieldText(issue.onFile.ci);
    return `${jarlLine('merged', id, '--sha', merge.sha, ...(merge.repo ? ['--repo', merge.repo] : []), ...(CI_STATES.includes(ci) ? ['--ci', ci] : []), '--keep')} (a new merge line)`;
  }
  if (field === 'ci') return CI_STATES.includes(file) && issue.fields.merged ? `${jarlLine('merged', id, '--ci', file)} (a new CI line)` : '';
  return '';
}

// One entry for a header field that differs from the log. Its `rewrite` (not enumerable, so not in the JSON) is the
// command that writes the header from the log without a hand edit and without a line.
function fieldDisagreement(profile, issue, field, file, record) {
  const name = FIELD_NAMES[field];
  const follow = record ? `write **${name}:** ${record} back into the header` : `remove the **${name}:** line from the header`;
  const make = makeFileTheRecord(profile, issue, field, file);
  const entry = { id: issue.id, field: name, onFile: file || null, record: record || null, line: `record: ${issue.id} ${disagreementSentence(name, file, record)}, which is the record — to follow the log, ${follow}${make ? `; to make the file's value the record, ${make}` : ''}` };
  Object.defineProperty(entry, 'rewrite', { value: jarlLine('set', issue.id, issue.status, '--header'), enumerable: false });
  return entry;
}

// The lines that have the shape of a move the tool writes (`<id> → <status>` alone or followed by ` · …`, the status a
// lower-case word) into a status the loop's profile does not list. They read as notes. Any other line with an arrow is a note.
function unreadableMoves(loop) {
  const out = [];
  const seen = new Set();
  for (const e of loop.events) {
    if (e.id === null || e.type !== 'other') continue;
    const m = ghostRe.exec(e.text);
    if (!m || idKey(m[1]) !== idKey(e.written ?? e.id) || loop.profile.statuses.includes(m[2])) continue;
    if (!/^[a-z][a-z0-9_-]*$/.test(m[2]) || !/^( · |$)/.test(e.text.slice(m[0].length))) continue;
    const key = `${e.id} ${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: e.id, field: 'profile', onFile: null, record: m[2], line: `record: ${e.id} the log moves it into ${m[2]}, which the loop's profile does not list as a status, so the line is read as a note and not as a move — the profile's status list changed after the line was written` });
  }
  return out;
}

// A disagreement as the views print it: its line, and under it the command that writes the header from the log.
export function disagreementText(d) { return d.rewrite ? `${d.line}\n  or, with no hand edit and no new log line: ${d.rewrite} (writes the header from the log)` : d.line; }
