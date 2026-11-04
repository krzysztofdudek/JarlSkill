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
// takes a flag off ({ drop, value } only the one with that value, and value null the one given with none), { replace,
// value } writes value where the call gave replace (a word, or one item of a comma list), { truncate: n } keeps the first
// n words, { retry: true } is the call again as it was given, { rename, to } writes a flag under another name (a
// placeholder as to writes the placeholder where the flag's name was, its value kept), { toArg, at } moves the value of
// the flag toArg to the at-th argument, { command } writes another command in place of the one given, { first } is a
// command to run before the call, printed before it with &&, and an array applies several. A ready command of another
// command than the refused one is a step before the call too, unless the command line's table of removed forms names that
// command as the one that does what the call asked. { line } is a command line whose words were quoted with shellWord as
// it was built, printed as it is; { external } is a command of the tool that runs the loop, named by its profile, printed
// as it is. A refusal with no ready part cannot be built: refuse and need throw a TypeError instead.
//
// What the last line writes is decided for each refusal, never by choosing a value. It is a line that runs only where the
// ready part names one of the corrections below (fix: '<name>'), each mechanical, none able to change what the call
// meant; every other ready part holds a placeholder where a value only the caller knows goes (a value outside its set, an
// id the loop does not hold, a range to read again, a lease to take over, words to join, an author who may not do this),
// and a line with a placeholder pasted unfilled is refused for it and writes nothing. The command line checks it: a line
// that would run without a correction named gets a placeholder of its own. A ready line never does an act that is
// someone else's (an owner's answer, a ratification, an approve, a sign-off, close --force, a removal of text): it says who
// does it and ends with the placeholder or the question to ask.
export const CORRECTIONS = Object.freeze({
  case: 'a value of a closed set given in another case, written as the set has it (Done: done)',
  removed: 'a command, flag or tool field the surface does not have, written in the form that replaces it with every word given (prio 7 2: field 7 Priority 2; --why on set: its text)',
  dashes: 'a text that starts with dashes, after a bare --',
  step: 'a step the call needs first and that writes nothing the call did not ask for, then the call as it was given',
});
export class Refusal extends Error {
  constructor(reason, ready) {
    super(`${reason}\n${readyText(ready)}`);
    this.reason = reason;
    this.ready = ready;
  }
}
// A placeholder: a value written as one angle-bracketed token, where a value only the caller knows goes. Jarl prints one
// as a single token with no space and no comma, <hyphenated-words> or <a|b|c> for a closed set, so a list reader never
// splits it; the command line refuses a whole value written so wherever it takes one (with spaces too: <some words>), so it
// is never recorded as data. A text that holds <x> among other words is a text.
export const isPlaceholder = (v) => typeof v === 'string' && /^<[^<>\/][^<>]*>$/.test(v.trim());
// The shape of a placeholder as Jarl prints it, found anywhere in a word.
export const HOLE = /<[^<>\s,]+>/;
// The token of a placeholder: its words joined by hyphens, with no space, comma or angle bracket left in it.
const tokenOf = (text) => String(text ?? '').replace(/[<>]/g, '').trim().replace(/[\s,]+/g, '-') || 'value';
export const hole = (text) => `<${tokenOf(text)}>`;
// The placeholder of a value of a closed set: the values allowed, joined by |.
export const placeholderOf = (values) => `<${[...new Set([].concat(values).map(tokenOf))].join('|')}>`;
// Where only a view tells what to change (the record read strictly, the profile, the rulings): the view, which writes
// nothing, then the call with a placeholder for what the view shows.
export const afterView = (view, why) => [{ first: view }, { flag: hole(why) }];
// A word of a printed command that is a whole placeholder, written as one token.
const asToken = (w) => (isPlaceholder(w) ? hole(String(w).trim().slice(1, -1)) : String(w));
// A text the caller gave, shown inside a reason: whole, its angle brackets left out.
export const shown = (text) => String(text ?? '').replace(/[<>]/g, '').trim();
// The value a refusal writes where a value outside a closed set was given: the one value of the set it is but for case,
// which cannot change what was meant, else the placeholder of the set. The fix that writes it names the correction case.
export function oneOf(given, allowed) {
  const same = allowed.filter((a) => String(a).toLowerCase() === String(given ?? '').trim().toLowerCase());
  return same.length === 1 ? String(same[0]) : placeholderOf(allowed);
}
const FIX_KEYS = ['flag', 'arg', 'drop', 'replace', 'truncate', 'retry', 'rename', 'toArg', 'command', 'first'];
const isFix = (r) => r !== null && typeof r === 'object' && !Array.isArray(r) && FIX_KEYS.some((k) => Object.hasOwn(r, k));
const isExternal = (r) => r !== null && typeof r === 'object' && !Array.isArray(r) && typeof r.external === 'string' && r.external.trim() !== '';
// Whether a ready part names a correction for each of its parts, so the line it makes may run.
export function namesCorrection(ready) {
  const parts = [].concat(ready);
  return parts.length > 0 && parts.every((p) => p !== null && typeof p === 'object' && !Array.isArray(p) && Object.hasOwn(CORRECTIONS, p.fix ?? ''));
}
function checkReady(ready) {
  for (const p of [].concat(ready)) if (p !== null && typeof p === 'object' && !Array.isArray(p) && p.fix !== undefined && !Object.hasOwn(CORRECTIONS, p.fix)) return false;
  if (isLine(ready) || isExternal(ready)) return true;
  if (Array.isArray(ready) && ready.length && ready.every(isFix)) return ready.every((f) => f.first === undefined || checkReady(f.first));
  if (isFix(ready)) return ready.first === undefined || checkReady(ready.first);
  const words = Array.isArray(ready) ? ready.map(String) : typeof ready === 'string' ? commandWords(ready) : [];
  return words[0] === 'jarl.mjs' && words.length > 1;
}
// The words of a command written as a text: a word in double or single quotes is one word without its quotes, a
// <placeholder> is part of the word it stands in with its brackets (spaces and all), and the rest splits at spaces; &&
// joins two commands.
export function commandWords(text) {
  const words = [];
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^']|'\\'')*)'|((?:<[^>]*>|[^\s"'<])+)|(\S+)/g;
  for (const m of String(text).matchAll(re)) words.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2].replace(/'\\''/g, "'") : m[3] ?? m[4]);
  return words;
}
// A command line built word by word with shellWord already ({ line }), printed as it is.
const isLine = (r) => r !== null && typeof r === 'object' && !Array.isArray(r) && typeof r.line === 'string' && /^jarl\.mjs \S/.test(r.line);
// A command as the shell is given it: every word quoted where the shell would read it, && kept between two commands, and a
// word that is a placeholder written as one token.
export function commandLine(ready) {
  if (isLine(ready)) return ready.line;
  if (isExternal(ready)) return ready.external.trim();
  const words = Array.isArray(ready) ? ready.map(String) : commandWords(ready);
  return words.map((w) => (w === '&&' ? w : shellWord(asToken(w)))).join(' ');
}
export { asToken };
// The ready part as a text, for a caller that holds no call (the record library): a fix is written as the flag or the
// argument it asks for.
export function readyText(ready) {
  const fixes = [].concat(ready).filter(isFix);
  if (!fixes.length) return commandLine(ready);
  const w = (v) => shellWord(asToken(v));
  return fixes.map((f) => (f.first !== undefined ? `after ${commandLine(f.first)}` : f.drop !== undefined ? `without ${f.drop}${f.value === undefined || f.value === null ? '' : ` ${w(f.value)}`}` : f.flag !== undefined ? `${f.flag}${f.value === undefined ? '' : ` ${w(f.value)}`}`
    : f.retry ? 'the same call again' : f.rename !== undefined ? `${w(f.to)} in place of ${f.rename}` : f.toArg !== undefined ? `the value of ${f.toArg} as argument ${f.at + 1}` : f.command !== undefined ? `${w(f.command)} in place of the command`
      : f.replace !== undefined ? `${w(f.value)} in place of ${shellWord(f.replace)}` : f.truncate !== undefined ? `no word after the first ${f.truncate}${f.value === undefined ? '' : `, then ${w(f.value)}`}` : `argument ${f.arg + 1}: ${w(f.value)}`)).join(' ');
}
export { isFix, isExternal };
export function refuse(reason, ready) {
  if (typeof reason !== 'string' || !reason.trim() || !checkReady(ready)) throw new TypeError(`a refusal is built from a reason and a ready part (a jarl.mjs command or a fix of the call, a correction it names being one of ${Object.keys(CORRECTIONS).join(', ')}): ${JSON.stringify(reason)}`);
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
