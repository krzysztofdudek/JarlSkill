// The owner in the record: the one name `owner`, and his own words, which only a ruling of his carries. His words are
// kept as the last line of that ruling, `The owner's words: "<words>"`, and this module is where that line is told from
// text anyone else wrote: every text the record takes is read here in one normal form, and a text that reads as the
// marker in any spelling is refused, so no note, row, question, answer or ruling of anyone else can look like his words.

import { fieldText, need } from './base.mjs';

export const OWNER = 'owner';
export const QUOTE_MARKER = "The owner's words:";
// The quote as a ruling's last line holds it, and as an evidence row and the decisions view show it.
export const quoteLine = (words) => `${QUOTE_MARKER} "${words}"`;
export const quoteShown = (words) => `the owner's words: "${words}"`;

// Letters of other scripts that read as the Latin letters of "owner's words", once a letter's wide, bold, circled and
// other Unicode forms are taken apart (NFKD) and the case is folded; and a zero, which reads as an o.
const LOOKALIKES = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'ѕ': 's',
  'ԁ': 'd', 'ԝ': 'w', 'ѡ': 'w', 'г': 'r', 'п': 'n', 'ҽ': 'e', 'і': 'i', 'ӏ': 'l',
  'ο': 'o', 'ω': 'w', 'η': 'n', 'ε': 'e', 'ρ': 'p', 'ν': 'v', 'σ': 'o',
  'օ': 'o', 'ո': 'n', 'ա': 'w', 'ս': 'u', 'ᴏ': 'o', 'ᴡ': 'w', 'ɴ': 'n', 'ᴇ': 'e',
  'ʀ': 'r', 'ꜱ': 's', 'ɯ': 'w', 'ɑ': 'a', 'ɡ': 'g', '0': 'o',
  // Letters with a stroke, which no decomposition takes apart, and the small capital d.
  'ø': 'o', 'đ': 'd', 'ᴅ': 'd',
};
const LOOKALIKE_RE = new RegExp(`[${Object.keys(LOOKALIKES).join('')}]`, 'gu');
// What is read as nothing: invisible format characters (zero-width spaces and joiners, the word joiner, a byte-order
// mark, a soft hyphen, the direction marks), combining marks, and the fillers that print as blank.
const NOTHING = /[\p{Cf}\p{M}ᅟᅠㅤﾠ]/gu;
// An apostrophe in any of its forms is read as nothing too, so "owner's" and "owners" are one word.
const APOSTROPHES = /['‘’‚‛′‵ʹʻʼʽˈ`´Ꞌꞌ՚׳]/g;
// A colon and a double quote in any of their forms, and every space.
const COLONS = /[꞉∶ː˸։፡׃܃܄⁚⸬︰]/g;
const QUOTES = /[“”„‟«»‹›〝〞〟″˝]/g;
const SPACES = /[\s\p{Z}]+/gu;
// Markdown emphasis and escapes, which a renderer takes away: the asterisk, the underscore, the tilde and the backslash.
const MARKDOWN = /[*_~\\]/g;
// The few named HTML entities that stand for a character the marker is made of, and a numeric entity (decimal or
// hexadecimal, with or without its semicolon) for any character.
const ENTITY_NAMES = { apos: "'", rsquo: '\u2019', lsquo: '\u2018', sbquo: '\u201A', prime: '\u2032', quot: '"', ldquo: '\u201C', rdquo: '\u201D', bdquo: '\u201E', laquo: '\u00AB', raquo: '\u00BB', colon: ':', nbsp: ' ', zwj: '\u200D', zwnj: '\u200C', shy: '\u00AD' };
const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));?/g;
function decodeEntities(text) {
  return text.replace(ENTITY, (whole, dec, hex, name) => {
    if (name !== undefined) return Object.hasOwn(ENTITY_NAMES, name) ? ENTITY_NAMES[name] : whole;
    const code = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : whole;
  });
}

// A text in the one form the marker is looked for in: HTML entities read as the characters they stand for, every Unicode
// form of a letter taken apart, case folded, invisible characters, accents, apostrophes, Markdown emphasis and spaces
// dropped, lookalike letters, colons and quotes read as the plain ones.
function normalForm(text) {
  return decodeEntities(String(text ?? '')).normalize('NFKD').toLowerCase().normalize('NFKD').replace(NOTHING, '').replace(APOSTROPHES, '')
    .replace(MARKDOWN, '').replace(SPACES, '').replace(LOOKALIKE_RE, (c) => LOOKALIKES[c]).replace(COLONS, ':').replace(QUOTES, '"');
}

// "owner's words" (or "owner's own words") with a colon or an opening quote after it, perhaps behind other punctuation:
// what reads as the marker. The singular is no marker: "the owner's word: needed" is an honest phrase, as is "the owner's
// words matter".
const MARKER_FORM = /owners(?:own)?words[\p{P}\p{S}]*?[:"]/u;

// Whether a text holds the marker in any spelling: the one test every writer of the record goes through.
export function holdsOwnersWords(text) { return MARKER_FORM.test(normalForm(text)); }

const REFUSAL = (what) => `${what} holds "${QUOTE_MARKER}" (in some spelling), which the record keeps only as the owner's quote, written by decide --by owner --quote "<his-own-words>": give his words with --quote and leave that line out of the text`;

// Every text a command was given, refused when any of them holds the marker: strings, and the strings inside lists and
// objects, so a command checks all its flags in one call before it writes anything.
export function needNoOwnersWords(what, ...values) {
  const texts = [];
  const walk = (v) => {
    if (typeof v === 'string') texts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  values.forEach(walk);
  for (const t of texts) need(!holdsOwnersWords(t), REFUSAL(what), { retry: true });
}

// The texts the writes inside `fn` may add that hold the marker: the quote decide writes, and text the record already
// holds and copies (a question being answered). Any other new line that holds it is refused by needNoNewOwnersWords. Only
// a text that holds the marker itself is carried, so a short one (an option labelled "o") cannot hide a marker around it.
let carried = [];
export function carryingOwnersWords(texts, fn) {
  const before = carried;
  carried = [...before, ...texts.filter((t) => typeof t === 'string' && holdsOwnersWords(t))];
  try { return fn(); } finally { carried = before; }
}

// A file of the record, written: every line of `after` that holds the marker is either a line `before` held already (as
// many times as it held it) or holds it only inside a text being carried; any other is refused and nothing is written.
export function needNoNewOwnersWords(before, after, where) {
  if (!holdsOwnersWords(after.replace(/\n/g, '␞'))) return;
  const held = new Map();
  for (const l of String(before).split('\n')) if (holdsOwnersWords(l)) held.set(l, (held.get(l) || 0) + 1);
  for (const l of after.split('\n')) {
    if (!holdsOwnersWords(l)) continue;
    const n = held.get(l) || 0;
    if (n) { held.set(l, n - 1); continue; }
    const rest = carried.reduce((t, c) => t.split(c).join(''), l);
    need(!holdsOwnersWords(rest), REFUSAL(`a line written to ${where} ("${l.trim().slice(0, 80)}")`), { retry: true });
  }
}

// Who a ruling is by, as given to --by: a name that reads as owner (in any case or script, with spaces, invisible
// characters or "the" around it) is the owner; a name that holds "owner" inside another is refused, so no other name
// reads as his; any other name is kept as it was given, on one line.
export function rulingAuthor(by) {
  need(typeof by === 'string', '--by is who ruled or answered, as text', () => ({ flag: '--by', value: '<who>' }));
  const name = fieldText(by);
  need(name, '--by needs a value — who ruled or answered: owner, jarl, or a name', () => ({ flag: '--by', value: '<who>' }));
  const letters = normalForm(name).replace(/[^\p{L}]/gu, '');
  if (letters === OWNER || letters === `the${OWNER}`) return OWNER;
  need(!letters.includes(OWNER), `--by "${name}" reads as the owner and names someone else: write owner for the owner, and a name without "owner" in it for anyone else`, () => ({ flag: '--by', value: '<owner-or-a-name>' }));
  return name;
}

// The owner's words beside a ruling, from the lines of its text as the file holds them (indents kept): the last line,
// when it starts at the left edge, follows a blank line and is not the ruling's first line, which is the form decide
// writes. Every other line of a ruling's text that decide writes is indented, so no text given to it can stand there.
export function quoteOf(lines) {
  const at = lines.findLastIndex((l) => l.trim() !== '');
  const first = lines.findIndex((l) => l.trim() !== '');
  if (at <= first || lines[at - 1].trim() !== '') return null;
  const m = /^The owner's words: "(.*)"$/.exec(lines[at]);
  return m ? m[1] : null;
}

// The ruling a ruling by the jarl or a coordinator rests on, kept as the last paragraph of its text: `Made under: <slug>`,
// at the left edge after a blank line. It is a different marker from the owner's words and sits where only the owner's
// words may, so a ruling by the owner never carries it and a ruling that carries it never reads as his.
export const UNDER_MARKER = 'Made under:';
export const underLine = (slug) => `${UNDER_MARKER} ${slug}`;
// The slug named by the last paragraph of a ruling's text (lines as the file holds them, indents kept), under the same
// shape quoteOf reads: the last line, at the left edge, after a blank line, and not the ruling's first line.
export function underOf(lines) {
  const at = lines.findLastIndex((l) => l.trim() !== '');
  const first = lines.findIndex((l) => l.trim() !== '');
  if (at <= first || lines[at - 1].trim() !== '') return null;
  const m = /^Made under: ([A-Za-z0-9][A-Za-z0-9._-]{0,79})$/.exec(lines[at]);
  return m ? m[1] : null;
}
