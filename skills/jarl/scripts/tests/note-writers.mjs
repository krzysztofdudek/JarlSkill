// Histories of evidence notes written by the three writers a loop holds notes of: this Jarl, the pinned writer of record
// formats 1 and 2, and the pinned first writer (both in old-jarl.mjs), each through its own evidence command, in every order; each history with every set of its notes then retracted by the record library given. For
// each, what the log tail of resume shows of the notes: the lines of the live notes, in the order they were written, no
// line of a retracted note nor of its retraction, and how many notes were retracted. Deterministic: the same histories,
// in the same order, on every run.
import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FORMAT_TWO_JARL_FILE, OLD_JARL_FILE, fileAsBefore, formatTwoJarlIsPinned, oldJarlIsPinned } from './old-jarl.mjs';
import { loop } from './helpers.mjs';

// Texts a note opens with: one line or several, a list bullet, a heading mark, a conflict marker, a strike, a bullet and a
// strike, the words of the pointer of a longer note, and the same text again.
export const NOTE_TEXTS = Object.freeze(['same', 'same\nwith more', '- same', '- same\nwith more', '# same', '# same\nwith more', '<<<<<<< same', '~~same', '- ~~same', "same (+1 more lines, whole text in the issue's Evidence section)"]);
export const NOTE_WRITERS = Object.freeze(['this', 'second', 'first']);

// Every sequence of one or two notes over every writer and text, and of three over every writer and the first two texts.
export function noteSequences() {
  const letters = (texts) => NOTE_WRITERS.flatMap((w) => texts.map((t) => ({ writer: w, text: t })));
  const words = (alphabet, n) => (n === 0 ? [[]] : words(alphabet, n - 1).flatMap((s) => alphabet.map((a) => [...s, a])));
  return [...words(letters(NOTE_TEXTS), 1), ...words(letters(NOTE_TEXTS), 2), ...words(letters(NOTE_TEXTS.slice(0, 2)), 3)];
}

const tailOf = (R, root) => (R.resumeData(root, { log: 500 }).log || []);
const noteLines = (log) => log.filter((l) => / · \d+ evidence · /.test(l)).map((l) => l.replace(/^.*? · (?=\d+ evidence · )/, ''));

// The histories over `R` (a record library: addEvidence and resumeData), each { what, wrong } with wrong null when the tail
// is right, and the histories a writer refused to write, which none should be.
export async function noteHistories(R, sequences = noteSequences()) {
  if (!oldJarlIsPinned() || !formatTwoJarlIsPinned()) throw new Error('the pinned writers were changed: they are fixtures, read-only');
  const first = await import(pathToFileURL(OLD_JARL_FILE).href);
  const second = await import(pathToFileURL(FORMAT_TWO_JARL_FILE).href);
  // One loop the three write into, its issue filed by the first writer (three digits, no key), and one the retractions are
  // made in, holding each history's issue file and log in turn.
  const written = loop({ prefix: 'jarl-note-writers-', via: 'cli', dotGit: false });
  const id = fileAsBefore(written, 'the work');
  const issueName = readdirSync(join(written, '.jarl', 'issues'))[0];
  const issuePath = (root) => join(root, '.jarl', 'issues', issueName);
  const logPath = (root) => join(root, '.jarl', 'log.md');
  const [baseIssue, baseLog] = [readFileSync(issuePath(written), 'utf8'), readFileSync(logPath(written), 'utf8')];
  const retracting = loop({ prefix: 'jarl-note-retract-', via: 'cli', dotGit: false });
  cpSync(join(written, '.jarl'), join(retracting, '.jarl'), { recursive: true });
  const write = { this: (t) => R.addEvidence(written, id, t), second: (t) => second.cmdEvidence(written, id, t, undefined), first: (t) => first.cmdEvidence(written, id, t, undefined) };
  const out = [];
  const refused = [];
  for (const notes of sequences) {
    writeFileSync(issuePath(written), baseIssue);
    writeFileSync(logPath(written), baseLog);
    const what = notes.map((n) => `${n.writer}:${JSON.stringify(n.text)}`).join(' then ');
    try { for (const n of notes) write[n.writer](n.text); } catch (e) { refused.push(`${what}: ${e.message}`); continue; }
    if (existsSync(join(written, '.jarl', 'profile.json'))) throw new Error(`${what}: a note raised the record format of the loop the writers share`);
    const [issue, log] = [readFileSync(issuePath(written), 'utf8'), readFileSync(logPath(written), 'utf8')];
    // The note lines of the tail before any retraction: one per note, in the order written.
    const all = noteLines(tailOf(R, written));
    for (let mask = 1; mask < 2 ** notes.length; mask += 1) {
      writeFileSync(issuePath(retracting), issue);
      writeFileSync(logPath(retracting), log);
      const gone = notes.map((_, k) => Boolean(mask & (2 ** k)));
      for (let k = 0; k < notes.length; k += 1) if (gone[k]) R.addEvidence(retracting, id, 'taken back', { retract: `note-${k + 1}`, by: 'jarl' });
      const data = R.resumeData(retracting, { log: 500 });
      const shown = noteLines(data.log || []);
      const want = all.filter((_, k) => !gone[k]);
      const problems = [];
      if (all.length !== notes.length) problems.push(`the log holds ${all.length} note lines for ${notes.length} notes`);
      const hiddenLive = want.filter((l) => !shown.includes(l)).length;
      if (hiddenLive || shown.length !== want.length || shown.some((l, k) => l !== want[k])) problems.push(`shows ${JSON.stringify(shown)}, the live notes' lines are ${JSON.stringify(want)}`);
      if ((data.log || []).some((l) => / evidence retract · /.test(l))) problems.push('shows a line that retracts a note');
      if (data.logRetractedNotes !== gone.filter(Boolean).length) problems.push(`counts ${data.logRetractedNotes} retracted, not ${gone.filter(Boolean).length}`);
      out.push({ what: `${what}; retracted ${gone.map((g) => (g ? 1 : 0)).join('')}`, wrong: problems.length ? problems.join('; ') : null, liveHidden: hiddenLive > 0 });
    }
  }
  return { histories: out, refused };
}
