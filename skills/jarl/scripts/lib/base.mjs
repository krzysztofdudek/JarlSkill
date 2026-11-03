// The built-in vocabulary of a loop that has no profile (statuses, kinds, priorities, tiers) and the plain text
// helpers every other module uses: a guard, a comma list, free text brought to one line, a slug.

// The built-in statuses, kinds and tiers: what a loop with no profile uses (see "the profile" below).
export const STATUSES = ['open', 'in-progress', 'done', 'dropped', 'deferred'];
export const KINDS = ['bug', 'gap', 'cleanup', 'docs', 'test', 'research', 'process'];
export const PRIORITIES = ['1', '2', '3'];
// Weakest first: the order of the list is the order of strength, which is how a loop's model lines rank its models.
export const TIERS = ['light', 'standard', 'strong'];
export const TIER_DEFAULT = 'standard';
export const ASK_KINDS = ['stop', 'stuck', 'lower', 'charter', 'ratify', 'escalation'];
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

export function need(cond, msg) { if (!cond) throw new Error(msg); }

function splitList(v) { return String(v || '').split(',').map((s) => s.trim()).filter(Boolean); }

// Free text written into a log line beside its fields (a lease's reason, a merge's check and what it printed): every
// separator character is replaced, with the space around it, after trimming, so no run of separators and spaces can
// survive in it at either end or inside and the text is one segment of the line.
export function noSeparators(text) { return String(text ?? '').trim().replace(/\s*·\s*/g, ' - ').trim(); }

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { LEASE_FIELDS, fieldText, freeInline, oneBreak, splitList };
