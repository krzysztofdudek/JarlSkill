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
// The standing a verdict's reviewer is recorded with, as every reader of a verdict line or a Reviews entry matches it:
// the issue's own worker (self), the loop's director (coordinator), a bot, or anyone else (fresh).
export const REVIEWER_KIND_SRC = 'fresh|coordinator|self|bot';
// Weakest first: the order of the list is the order of strength, which is how a loop's model lines rank its models.
export const TIERS = ['light', 'standard', 'strong'];
export const TIER_DEFAULT = 'standard';
export const ASK_KINDS = ['stop', 'stuck', 'lower', 'charter', 'ratify', 'escalation', 'rule'];
export const CI_STATES = ['pending', 'green', 'red', 'none'];
export const ROUNDS_BEFORE_TAKEOVER = 3;
// A lease whose issue saw no commit, no evidence row and no log line for this many minutes is shown as idle, and so is a
// proof that waits this long for its verdict; the goal's Liveness line changes it, --stale-hours for one call. It is only
// ever shown, never acted on.
export const LIVENESS_MINUTES = 30;
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
// Every refusal is built here, from two parts: the reason, which says what is wrong and names the word of the call that
// is, and the ready part, which the refusal prints last, on a line of its own. No refusal ends with a call composed for
// the caller: the last line is the form of the command that does what was meant, each value only the caller knows a
// placeholder of the registry below, so the line pasted as printed is refused for its placeholder and writes nothing; the
// caller fills the values and runs it. The ready part is one of:
// - a shape of the refused call, which the command line, holding the call, prints as the call's form: its command, the
//   placeholder of each argument, each flag with the placeholder of its value, its --root and --json as they were given.
//   { flag, value } puts a flag in ({ flag, value, add: true } one more of a flag that repeats), { arg, value } an
//   argument, { drop } takes a flag out ({ drop, value } the one given with that value, value null the one given with
//   none), { replace, value } stands for the place of a word given, { truncate: n } keeps the first n words, { retry: true }
//   is the call's own form, { rename, to } puts a flag under another name (a placeholder as to, where the flag is the
//   caller's to name), { toArg, at } a flag's value as the at-th argument, { command } another command, { dashes: true }
//   the arguments after a bare --, and an array several. A value that is a placeholder of the registry is printed where
//   it goes; every other value is printed as the placeholder of its argument or flag. { first } is a read-only view,
//   printed on a line of its own before the form;
// - a command (an array of words, or a text, starting with jarl.mjs): the form of another command (the one a removed
//   form names), or a step the caller takes first (a question put, an issue leased), printed alone and never joined to
//   the call; a command that writes holds a placeholder;
// - { external }: a command of the tool that runs the loop, named by its profile, printed as it is.
// A refusal with no ready part cannot be built: refuse and need throw a TypeError instead. A ready line never does an act
// that is someone else's (an owner's answer, a ratification, an approve, a sign-off, close --force, a removal of text).
export class Refusal extends Error {
  constructor(reason, ready) {
    super(`${reason}\n${readyText(ready)}`);
    this.reason = reason;
    this.ready = ready;
  }
}
// A placeholder: one angle-bracketed token where a value only the caller knows goes. Jarl prints only the placeholders of
// this closed registry, each one token with no space and no comma, so no reader of a list or a text splits it, in its
// ready lines, its reasons, its help and its tool descriptions alike; the command line refuses a value only where it is
// exactly one of them (a whole value, a list item, a line of a list held one per line, or the value part of a value
// written in parts), so a form pasted unfilled writes nothing, and any other value written in angle brackets (<nil>,
// <none>, <Button />) is a value, recorded as given. What the placeholder stands for is said by the reason before it: the
// values allowed, the ids the loop holds, the word that was wrong. One placeholder means one thing: <line> is the text of
// an acceptance line, <line-number> its number among the issue's acceptance lines.
export const PLACEHOLDERS = Object.freeze([
  '<id>', '<ids>', '<ids-it-waits-on>', '<another-id>', '<another-issue>', '<ids-the-loop-holds>', '<ids-low-high>', '<a-smaller-range>', '<the-id-new-prints>',
  '<the-id-ask-prints>', '<an-issue-next-offers>', '<question>', '<a-n>', '<n>', '<n-or-note-n>', '<review-n-or-note-n>', '<tick-n>', '<line>', '<line-number>',
  '<text>', '<title>', '<the-title-filed-again>', '<goal>', '<slug>', '<a-new-slug>', '<a-ruling>', '<a-ruling-in-force>', '<value>',
  '<the-whole-new-value>', '<the-whole-section>', '<a-part-of-the-description>', '<part>', '<name=value>', '<field=value>', '<line=id>',
  '<changelog-entry>', '<owner-line>', '<items>', '<an-item-with-no-leading-dash>', '<an-item-without-quotes>', '<one-quoted-text>',
  '<no-word-here>', '<argument>', '<who>', '<one-name>', '<reviewer>', '<a-fresh-reviewer>', '<the-owner-himself>', '<owner-or-a-name>',
  '<who-asks>', '<his-own-words>', '<status>', '<status-in-the-log>', '<a-status-the-gate-allows>', '<kind>', '<tier>', '<prio>',
  '<verdict>', '<ci-state>', '<ask-kind>', '<jarl-or-owner>', '<option>', '<label:effect>', '<another-label:effect>', '<mode>', '<group>',
  '<name>', '<names>', '<name-or-path>', '<coordinator>', '<slice:coordinator>', '<no-second-slice-tag>', '<tag>', '<a-tag-an-issue-carries>', '<key>',
  '<a-number-two-files-carry>', '<sha>', '<command>', '<what-it-printed>', '<what-was-wrong>', '<what-was-read-and-found>',
  '<findings-with-a-severity>', '<finding-outside-the-issue>', '<what-failed>', '<what-the-branch-does>', '<what-is-red>', '<what-would-get-weaker>', '<why>',
  '<why-the-worker-changed>', '<question-for-the-owner>', '<test-check-compare-read-or-owner-line>', '<compare-line-with-by-command>', '<yes-or-reject-first>', '<branch>', '<worker-branch>', '<base-branch>',
  '<the-new-worker>', '<the-worktree-of-the-lease>', '<model-id>', '<path>', '<paths>', '<path-under-the-loop-root>', '<slot>',
  '<findings.json>', '<profile.json>', '<report-dir>', '<report-dir#finding-id>', '<finding-ids>', '<template>', '<the-main-checkout>',
  '<loop-root>', '<selectors>', '<selector>', '<role>', '<moment>', '<date-or-event>', '<date-or-id>', '<material>', '<what-to-check>', '<yyyy-mm-dd>', '<type>', '<rule-id>', '<number-of-files>', '<whole-number>',
  '<count>', '<hours>', '<minutes>', '<rounds>', '<machine-line>', '<from-to>', '<section-or-field>', '<resource-name>', '<a-row-the-log-matches>', '<a-flag-it-takes-or-none>',
  '<no-flag-here>', '<--handover-or-none>', '<one-kind-of-evidence-per-call>', '<a-jarl-command>', '<nothing-to-do>',
  '<the-command-of-the-tool-that-runs-this-loop>', '<as-the-view-shows>', '<as-the-reason-says>', '<a-jarl-that-reads-this-format>', '<placeholder>', '<path-of-jarl.mjs>',
]);
const REGISTERED = new Set(PLACEHOLDERS);
// Whether a value is one of the tool's own placeholders, the one test the command line refuses a value by.
export const isPlaceholder = (v) => typeof v === 'string' && REGISTERED.has(v.trim());
// A placeholder of the registry, by its text: the one way code names one, so an unregistered one cannot be printed.
export function hole(token) {
  if (!REGISTERED.has(token)) throw new TypeError(`${token} is not a placeholder of the registry (lib/base.mjs, PLACEHOLDERS)`);
  return token;
}
// The placeholders of the registry a printed line holds, found anywhere in its words.
export const HOLE = new RegExp(PLACEHOLDERS.map((p) => p.replace(/[|.#=:]/g, (c) => `\\${c}`)).join('|'));
// Where only a view tells what to change (the record read strictly, the profile, the rulings): the view, which writes
// nothing, on a line of its own, then the call's form with a placeholder for what the view shows.
export const afterView = (view) => [{ first: view }, { flag: hole('<as-the-view-shows>') }];
const FIX_KEYS = ['flag', 'arg', 'drop', 'replace', 'truncate', 'retry', 'rename', 'toArg', 'command', 'first', 'dashes'];
const isFix = (r) => r !== null && typeof r === 'object' && !Array.isArray(r) && FIX_KEYS.some((k) => Object.hasOwn(r, k));
const isExternal = (r) => r !== null && typeof r === 'object' && !Array.isArray(r) && typeof r.external === 'string' && r.external.trim() !== '';
// The words of a command written as a text: a word in double or single quotes is one word without its quotes, a
// <placeholder> is part of the word it stands in with its brackets, and the rest splits at spaces.
export function commandWords(text) {
  const words = [];
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^']|'\\'')*)'|((?:<[^>]*>|[^\s"'<])+)|(\S+)/g;
  for (const m of String(text).matchAll(re)) words.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2].replace(/'\\''/g, "'") : m[3] ?? m[4]);
  return words;
}
// The words of a ready part that is a command.
export const commandOf = (ready) => (Array.isArray(ready) ? ready.map((w) => (w === undefined || w === null ? hole('<value>') : String(w))) : commandWords(ready));
const isCommand = (ready) => { const words = Array.isArray(ready) || typeof ready === 'string' ? commandOf(ready) : []; return words[0] === 'jarl.mjs' && words.length > 1; };
function checkReady(ready) {
  if (isExternal(ready)) return true;
  if (Array.isArray(ready) && ready.length && ready.every(isFix)) return ready.every((f) => f.first === undefined || isCommand(f.first));
  if (isFix(ready)) return ready.first === undefined || isCommand(ready.first);
  return isCommand(ready);
}
// ---- printed commands ----------------------------------------------------------------------------------------
//
// Every command Jarl prints is built by printCommand, and by nothing else: the form and the steps a refusal ends with, a
// command a reason names, the one a note or a hint offers, the command of a row of a view. It takes the words (jarl.mjs
// first) and the global flags of the call that prints it (--root and --json, as that call gave them, so the command
// reaches the loop the call named: a view and a note print with the root of the loop they describe), and writes each
// word in the quoting of the shell of the platform (shellOf, shellWord) and each placeholder of the registry in double
// quotes, which sh, bash, zsh, PowerShell and cmd all read alike. A global flag the words name already is not added; a
// --root the call gave twice, or one that shell cannot carry as it is, is its placeholder <loop-root>; any other word that
// shell cannot carry is the placeholder <value>. The command line and the MCP server print for the call they run
// (printingFor, around the call); the record library, which runs no call, prints with no global flag.
let printing = null;
export function printingFor(globals, fn, shell = shellOf()) {
  const before = printing;
  printing = { globals: [...globals], shell };
  try { return fn(); } finally { printing = before; }
}
const current = () => printing ?? { globals: [], shell: shellOf() };
// A global flag as the words of a command: --json and --help as switches (whatever value they were given), --root as the
// call gave it (--root x, --root=x), or its placeholder where it has no value, is one, was given twice or holds what the
// shell cannot carry (a line break, or on Windows a character cmd and PowerShell read apart).
export const rootPrintable = (v, shell) => typeof v === 'string' && !isPlaceholder(v) && !LINE_BREAKING.test(v) && printable(v, shell) && printable(`--root=${v}`, shell);
export function globalWords(k, v, spelt, shell = 'posix') {
  if (k !== 'root') return [`--${k}`];
  if (!rootPrintable(v, shell)) return ['--root', hole('<loop-root>')];
  return spelt === '=' ? [`--root=${v}`] : ['--root', v];
}
// The commands that write the record. goal writes only when it is given --set.
export const MUTATING = new Set(['init', 'new', 'renumber', 'import', 'set', 'field', 'split', 'base', 'merged', 'evidence', 'retract', 'review', 'round', 'tick', 'ask', 'answer', 'log', 'decide', 'goal', 'archive', 'mode', 'close', 'extend']);
export const writes = (words) => MUTATING.has(words[1]) && !(words[1] === 'goal' && !words.some((w) => w === '--set' || String(w).startsWith('--set=')));
// A printed write names its writer: the words of a command with --by added where they name none, before a bare --.
export function signedWords(words, by = hole('<who>')) {
  const end = words.indexOf('--') === -1 ? words.length : words.indexOf('--');
  if (!writes(words) || words.slice(0, end).some((w) => w === '--by' || String(w).startsWith('--by='))) return words;
  return [...words.slice(0, end), '--by', by, ...words.slice(end)];
}
export function printCommand(given, { globals = current().globals, shell = current().shell } = {}) {
  const words = given[0] === 'jarl.mjs' ? signedWords(given) : given;
  const w = words.map((x) => (x === undefined || x === null ? hole('<value>') : String(x)));
  let all = w;
  if (w[0] === 'jarl.mjs') {
    const end = w.indexOf('--') === -1 ? w.length : w.indexOf('--');
    const names = (k, list) => list.some((x) => x === `--${k}` || x.startsWith(`--${k}=`));
    const roots = new Set(globals.filter(([k]) => k === 'root').map(([, v]) => v));
    const added = [];
    for (const [k, v, spelt] of globals) {
      if (names(k, w.slice(0, end)) || names(k, added)) continue;
      added.push(...globalWords(k, k === 'root' && roots.size > 1 ? hole('<loop-root>') : v, spelt, shell));
    }
    all = [...w.slice(0, end), ...added, ...w.slice(end)];
  }
  return all.map((x) => (isPlaceholder(x) ? `"${x.trim()}"` : printable(x, shell) ? shellWord(x, shell) : `"${hole('<value>')}"`)).join(' ');
}
// A command of jarl.mjs as printed: printCommand of its words.
export const jarlLine = (...words) => printCommand(['jarl.mjs', ...words]);
// A command with no global flag carried, for the shell named.
export const printedLine = (words, shell = 'posix') => printCommand(words, { globals: [], shell });
export function commandLine(ready, shell = current().shell) {
  if (isExternal(ready)) return ready.external.trim();
  return printCommand(commandOf(ready), { shell });
}
// The ready part as a text, for a caller that holds no call (the record library): a shape of the call is written as the
// flag or the argument it asks for, its value a placeholder.
export function readyText(ready, shell = current().shell) {
  const fixes = [].concat(ready).filter(isFix);
  if (!fixes.length) return commandLine(ready, shell);
  const s = (v) => (isPlaceholder(v) ? `"${String(v).trim()}"` : shellWord(v, shell));
  const w = (v) => s(isPlaceholder(v) ? v : hole('<value>'));
  return fixes.map((f) => (f.first !== undefined ? `after ${commandLine(f.first, shell)}` : f.drop !== undefined ? `without ${s(f.drop)}` : f.flag !== undefined ? `${s(f.flag)}${f.value === undefined ? '' : ` ${w(f.value)}`}`
    : f.retry ? 'the call with its values filled' : f.dashes ? 'the arguments after a bare --' : f.rename !== undefined ? `${s(f.to)} in place of ${s(f.rename)}` : f.toArg !== undefined ? `the value of ${f.toArg} as argument ${f.at + 1}` : f.command !== undefined ? `${s(f.command)} in place of the command`
      : f.replace !== undefined ? `${w(f.value)} in place of ${s(f.replace)}` : f.truncate !== undefined ? `no word after the first ${f.truncate}${f.value === undefined ? '' : `, then ${w(f.value)}`}` : `argument ${f.arg + 1}: ${w(f.value)}`)).join(' ');
}
export { isFix, isExternal };
export function refuse(reason, ready) {
  if (typeof reason !== 'string' || !reason.trim() || !checkReady(ready)) throw new TypeError(`a refusal is built from a reason and a ready part (a jarl.mjs command, a shape of the call, or an external command): ${JSON.stringify(reason)}`);
  throw new Refusal(reason, ready);
}
// The ready part may be an arrow, computed only when the condition fails: what it reads may not exist while the call is right.
export function need(cond, reason, ready) { if (!cond) refuse(reason, typeof ready === 'function' ? ready() : ready); }

function splitList(v) { return String(v || '').split(',').map((s) => s.trim()).filter(Boolean); }

// Free text written into a log line beside its fields (a lease's reason, a merge's check and what it printed): every
// separator character is replaced, with the space around it, after trimming, so no run of separators and spaces can
// survive in it at either end or inside and the text is one segment of the line.
export function noSeparators(text) { return String(text ?? '').trim().replace(/\s*·\s*/g, ' - ').trim(); }

// A word as sh, bash and zsh read it back unchanged: bare only when it starts with a letter, a digit, _ . / or - and holds
// nothing but letters, digits and _ . / : @ % + , - after it; else in single quotes, a single quote inside written '\''.
// A word a shell reserves (done, if, then) is bare too: it is an argument, after jarl.mjs, where no shell reads one. So a word that starts with # (a comment), = or ~ (zsh and bash expand them), an operator
// (&&, ;, |) and every other word is quoted. A word that holds a character a reader may take for the end of a line (CR,
// LF, a vertical tab, a form feed, NEL, the Unicode line and paragraph separators) or any other control character is
// printed by printf %b with that character written as the octal escapes of its bytes, so the command stays on one line,
// for a reader that splits lines on Unicode separators too, and a refusal's ready command on its last line (a shell drops
// the line breaks a word ends with). Every word Jarl prints in a command for a person or an agent to run is written so,
// through printCommand.
//
// That is the quoting of a POSIX shell (sh, bash, zsh), the shell of macOS and Linux. The commands Jarl prints are
// written for the shell of the platform they are printed on (shellOf): on Windows, for PowerShell and cmd. There
// a word is bare when it holds nothing but letters, digits and _ . / : = - (and is not --, which PowerShell may take for
// its own), and else in double quotes, which both read alike for every other character: a space, a single quote, a < or
// a >, & | ; ( ) ^ and a backslash inside. A word neither reads alike is not printable there (printable): a double quote,
// a percent sign (cmd expands %name%), a dollar sign or a backtick (PowerShell expands them), a control character or a
// line break (no quoting of theirs carries one, and no command substitution is printed), and a quoted word that ends with
// a backslash (a program reads a backslash before the closing quote as an escape). Whoever builds a form prints such a
// word as its placeholder and says why (see refusalFor in jarl.mjs); given one, shellWord prints the placeholder <value>.
const quoted = (s) => (/^[A-Za-z0-9_./-][A-Za-z0-9_./:@%+,-]*$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
const LINE_BREAKING = /[\u0000-\u0008\u000a-\u001f\u007f\u0085\u2028\u2029]/;
const escapedByte = (c) => [...Buffer.from(c, 'utf8')].map((b) => `\\0${b.toString(8).padStart(3, '0')}`).join('');
export const shellOf = (platform = process.platform) => (platform === 'win32' ? 'windows' : 'posix');
const windowsBare = (s) => /^[A-Za-z0-9_./:=-]+$/.test(s) && s !== '--';
// Not printable on Windows besides: the typographic double quotes U+201C, U+201D and U+201E (PowerShell reads them as
// double quotes), an exclamation mark (cmd expands !name! where delayed expansion is on), and an empty word (Windows
// PowerShell, and some releases of PowerShell, drop an empty argument).
export function printable(s, shell = 'posix') {
  if (shell !== 'windows') return true;
  const text = String(s);
  return text !== '' && !/["%$`!“”„]/.test(text) && !LINE_BREAKING.test(text) && (windowsBare(text) || !text.endsWith('\\'));
}
export function shellWord(s, shell = 'posix') {
  const text = String(s);
  if (shell === 'windows') return !printable(text, shell) ? `"${hole('<value>')}"` : windowsBare(text) ? text : `"${text}"`;
  if (!LINE_BREAKING.test(text)) return quoted(text);
  const escaped = [...text].map((c) => (c === '\\' ? '\\\\' : LINE_BREAKING.test(c) ? escapedByte(c) : c)).join('');
  return `"$(printf '%b' ${quoted(escaped)})"`;
}
// A text Jarl prints with words of a call in it (a reason, a note), safe to read and to paste: each word of the call that
// holds a character a reader may end a line at, or one a shell acts on inside double quotes ($ ` \ " !), is echoed in
// single quotes with its line breaks escaped (\n, \u2028), wherever the text has it bare, in double quotes or quoted as
// JSON; a part of such a word around each line break is escaped as well, for an echo that cut the word. A word whose
// only such characters are ones a shell acts on outside quotes (a redirection, a pipe, a command separator, a
// parenthesis, a single quote) is echoed so where it stands bare as a word of the text (after a space or an opening
// bracket, before a space, a closing bracket or punctuation), and left as it is in double quotes, where they are
// letters; a ; or a > of Jarl's own, or inside one of its placeholders, stays as it is. No word of the caller starts a
// line of its own in what Jarl prints, and none runs, redirects or pipes when the whole text is pasted into a shell.
// Every line-breaking character but the line feed is never Jarl's own and is escaped wherever it stands.
const LINE_BREAKING_ALL = new RegExp(LINE_BREAKING.source, 'g');
const escapeBreaks = (s) => s.replace(LINE_BREAKING_ALL, (c) => (c === '\n' ? '\\n' : c === '\r' ? '\\r' : `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`));
export const breaksLine = (s) => LINE_BREAKING.test(String(s));
export const echoWord = (w) => `'${escapeBreaks(String(w)).replace(/'/g, `'\\''`)}'`;
const SHELL_ACTIVE = /[$`\\"!]/;
const SHELL_OPERATOR = /[<>|&;()']/;
const MARK = /\uE000(\d+)\uE001/g;
const literally = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const standingBare = (w) => new RegExp(`(?<=^|[\\s([{])${literally(w)}(?=$|[\\s)\\]},:;.])`, 'g');
export function escapedEchoes(text, words = []) {
  let out = String(text);
  const marks = [];
  const mark = (s) => { marks.push(s); return `\uE000${marks.length - 1}\uE001`; };
  const echoed = [...new Set(words.map(String))].filter((w) => w.trim() && (breaksLine(w) || SHELL_ACTIVE.test(w) || SHELL_OPERATOR.test(w))).sort((a, b) => b.length - a.length);
  for (const w of echoed) {
    const as = mark(echoWord(w));
    if (!breaksLine(w) && !SHELL_ACTIVE.test(w)) { out = out.replace(standingBare(w), as); continue; }
    for (const form of [JSON.stringify(w), `"${w}"`, w]) out = out.split(form).join(as);
    for (const { index: at } of w.matchAll(LINE_BREAKING_ALL)) {
      const part = w.slice(Math.max(0, at - 12), at + 13);
      if (part.trim()) out = out.split(part).join(mark(escapeBreaks(part)));
    }
  }
  return out.replace(/[\u0000-\u0008\u000b-\u001f\u007f\u0085\u2028\u2029]/g, escapeBreaks).replace(MARK, (_, n) => marks[Number(n)]);
}
// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { LEASE_FIELDS, fieldText, freeInline, oneBreak, splitList };
