// The built-in vocabulary of a loop that has no profile (statuses, kinds, priorities, tiers) and the plain text
// helpers every other module uses: a guard, a comma list, free text brought to one line, a slug.

// The built-in statuses, kinds and tiers: what a loop with no profile uses (see "the profile" below).
export const STATUSES = ['open', 'in-progress', 'done', 'dropped', 'deferred'];
export const KINDS = ['bug', 'gap', 'cleanup', 'docs', 'test', 'research', 'process', 'promise', 'wait'];
// The two kinds that are not work to raise a worker on but something the loop keeps track of until the issue closes: a
// promise, held by whoever made it (the one its Found by names), and a wait, held by the outside person its Person field
// names until what was waited for comes, with when to check in its Check when field. They hold in a loop whose profile
// declares no kinds of its own and no field Person or Check when (see makeProfile); elsewhere they are off.
export const PROMISE_KIND = 'promise';
export const WAIT_KIND = 'wait';
export const KEPT_KINDS = [PROMISE_KIND, WAIT_KIND];
export const PRIORITIES = ['1', '2', '3'];
// Weakest first: the order of the list is the order of strength, which is how a loop's model lines rank its models.
export const TIERS = ['light', 'standard', 'strong'];
export const TIER_DEFAULT = 'standard';
export const ASK_KINDS = ['stop', 'stuck', 'lower', 'charter', 'ratify', 'escalation', 'rule'];
export const CI_STATES = ['pending', 'green', 'red', 'none'];
export const ROUNDS_BEFORE_TAKEOVER = 3;
// A lease (Worker, Worktree, Since on an in-progress issue) whose branch saw no commit for this long is shown
// as idle; --stale-hours on status and branches changes it. It is only ever shown, never acted on.
export const STALE_HOURS = 6;
// A handoff file written more than this before the loop's last log line is read as stale (status --json).
export const HANDOFF_STALE_MS = 60 * 60_000;
// The lease fields: written by set in-progress, removed when the issue leaves in-progress. Branch stays: it
// is where the work was, which branches and scope --branch still read after done.
const LEASE_FIELDS = ['Worker', 'Model', 'Worktree', 'Since'];

// Letters Unicode does not decompose into a base letter and an accent (ł, ø, đ, ß, æ, þ...) would be
// dropped as punctuation and leave a hole in the name ("gałęzi" -> "ga-ezi"), so they are spelled out first.
const UNDECOMPOSED = {
  'ł': 'l', 'ø': 'o', 'đ': 'd', 'ð': 'd', 'ħ': 'h', 'ı': 'i', 'ŧ': 't', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'þ': 'th',
};

export function slugify(title) {
  return title.toLowerCase().replace(/[łøđðħıŧßæœþ]/g, (c) => UNDECOMPOSED[c]).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').slice(0, 60).replace(/^-+|-+$/g, '') || 'issue';
}

// A header field is one line.
// The line breaks a text may hold, of every kind (a carriage return, the line and paragraph separators, NEL), as the one
// line break the record writes. The readers split on that break alone, so a text is brought to it before anything is
// written: its first line sits where the text's field is, and each later line is indented (see freeInline and freeBlock).
const LINE_BREAKS = new RegExp(`\\r\\n?|${String.fromCharCode(0x2028)}|${String.fromCharCode(0x85)}`, 'g');

function oneBreak(text) { return String(text ?? '').replace(LINE_BREAKS, '\n'); }

// Free text after a field's label: the first line follows the label, every later line is indented two spaces, as a
// question's continuation lines are, so no line of the text starts where the reader looks for a field or an option.
function freeInline(text) { return oneBreak(text).split('\n').join('\n  '); }

function fieldText(v) { return oneBreak(v).replace(/\s+/g, ' ').trim(); }

// ---- refusals ------------------------------------------------------------------------------------------------
//
// Every refusal is built here, from two parts: the reason, and the ready part a refused caller acts on, which the
// refusal prints last, on a line of its own. The ready part is a command (a text or an array of words starting with
// jarl.mjs, each word quoted for a POSIX shell when it is printed), or a fix of the call that was refused, which the
// command line, holding the call, turns into the same call fixed: { flag, value } adds or replaces a flag ({ flag, value,
// add: true } gives a flag that repeats one more value), { arg, value } sets the n-th argument after the command, { drop }
// takes a flag off ({ drop, value } only the one with that value, and value null the one given with none), { replace, value } writes value where the call gave
// replace (a word, or one item of a comma list), { truncate: n } keeps the first n words, { retry: true } is the call again
// as it was given, { rename, to } writes a flag under another name, { first } is a command to run before the call, printed
// before it with &&, and an array applies several. A ready command of another command than the refused one is a step
// before the call too, unless the command line's table of removed forms names that command as the one that does what the
// call asked. { line } is a command line whose words were quoted with shellWord as it was built, printed as it is. A refusal with no ready part cannot be built: refuse and need throw a TypeError instead, and a test of the
// sources finds every need and refuse that names none.
export class Refusal extends Error {
  constructor(reason, ready) {
    super(`${reason}\n${readyText(ready)}`);
    this.reason = reason;
    this.ready = ready;
  }
}
const FIX_KEYS = ['flag', 'arg', 'drop', 'replace', 'truncate', 'retry', 'rename', 'first'];
const isFix = (r) => r !== null && typeof r === 'object' && !Array.isArray(r) && FIX_KEYS.some((k) => Object.hasOwn(r, k));
function checkReady(ready) {
  if (isLine(ready)) return true;
  if (Array.isArray(ready) && ready.length && ready.every(isFix)) return ready.every((f) => f.first === undefined || checkReady(f.first));
  if (isFix(ready)) return ready.first === undefined || checkReady(ready.first);
  const words = Array.isArray(ready) ? ready.map(String) : typeof ready === 'string' ? commandWords(ready) : [];
  return words[0] === 'jarl.mjs' && words.length > 1;
}
// The words of a command written as a text: a word in double or single quotes is one word without its quotes, a
// <placeholder> is part of the word it stands in with its brackets (spaces and all: <path>,<path> is one word), and
// the rest splits at spaces; && joins two commands.
export function commandWords(text) {
  const words = [];
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^']|'\\'')*)'|((?:<[^>]*>|[^\s"'<])+)|(\S+)/g;
  for (const m of String(text).matchAll(re)) words.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2].replace(/'\\''/g, "'") : m[3] ?? m[4]);
  return words;
}
// A command line built word by word with shellWord already ({ line }), printed as it is.
const isLine = (r) => r !== null && typeof r === 'object' && !Array.isArray(r) && typeof r.line === 'string' && /^jarl\.mjs \S/.test(r.line);
// A command as the shell is given it: every word quoted where the shell would read it, && kept between two commands.
export function commandLine(ready) {
  if (isLine(ready)) return ready.line;
  const words = Array.isArray(ready) ? ready.map(String) : commandWords(ready);
  return words.map((w) => (w === '&&' ? w : shellWord(w))).join(' ');
}
// The ready part as a text, for a caller that holds no call (the record library): a fix is written as the flag or the
// argument it asks for.
export function readyText(ready) {
  const fixes = [].concat(ready).filter(isFix);
  if (!fixes.length) return commandLine(ready);
  return fixes.map((f) => (f.first !== undefined ? `after ${commandLine(f.first)}` : f.drop !== undefined ? `without ${f.drop}${f.value === undefined ? '' : ` ${shellWord(f.value)}`}` : f.flag !== undefined ? `${f.flag}${f.value === undefined ? '' : ` ${shellWord(f.value)}`}`
    : f.retry ? 'the same call again' : f.rename !== undefined ? `${f.to} in place of ${f.rename}` : f.replace !== undefined ? `${shellWord(f.value)} in place of ${shellWord(f.replace)}` : f.truncate !== undefined ? `no word after the first ${f.truncate}` : `argument ${f.arg + 1}: ${shellWord(f.value)}`)).join(' ');
}
export { isFix };
export function refuse(reason, ready) {
  if (typeof reason !== 'string' || !reason.trim() || !checkReady(ready)) throw new TypeError(`a refusal is built from a reason and a ready part (a jarl.mjs command or a fix of the call): ${JSON.stringify(reason)}`);
  throw new Refusal(reason, ready);
}
// The ready part may be an arrow, computed only when the condition fails: what it reads may not exist while the call is right.
export function need(cond, reason, ready) { if (!cond) refuse(reason, typeof ready === 'function' ? ready() : ready); }

function splitList(v) { return String(v || '').split(',').map((s) => s.trim()).filter(Boolean); }

// Free text written into a log line beside its fields (a lease's reason, a merge's check and what it printed): every
// separator character is replaced, with the space around it, after trimming, so no run of separators and spaces can
// survive in it at either end or inside and the text is one segment of the line.
export function noSeparators(text) { return String(text ?? '').trim().replace(/\s*·\s*/g, ' - ').trim(); }

// A word as a POSIX shell reads it back unchanged: as it is when it holds nothing the shell reads, else in single quotes,
// a single quote inside written '\''. A word with line breaks is printed by printf, one quoted line per argument, so the
// command stays on one line, and a refusal's ready command on its last line. Every command Jarl prints for a person or an
// agent to run writes its words so.
const quoted = (s) => (/^[A-Za-z0-9_@%+=:,./#-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
export function shellWord(s) {
  const text = String(s);
  if (!/[\r\n]/.test(text)) return quoted(text);
  return `"$(printf '%s\\n' ${text.split(/\r\n?|\n/).map(quoted).join(' ')})"`;
}

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { LEASE_FIELDS, fieldText, freeInline, oneBreak, splitList };
