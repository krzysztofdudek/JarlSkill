// The rule of an --artifact value is one allowlist: a relative path inside the repository, in plain characters, and
// everything else refused. The help states it in one sentence, and this file holds an oracle written from that sentence
// alone, with its own table of characters and its own reading of segments, never calling the command's code. The oracle
// and the command must agree on every value of a product of building blocks: segments of tricky and plain tokens, joined
// by both separators, the log's separator and spaces, behind prefixes of schemes, hosts, ports, users, drives, shares,
// roots and homes. The values each answer was decided for are checked against both, and then run through the real
// review command on one loop: what it accepts is read back as given from the verdict line, the Reviews entry, show and
// report, and what it refuses leaves every file of the loop as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileThreeDigits } from './helpers.mjs';
import { jarl, refuses, loop as makeLoop } from './helpers.mjs';
import { FINDINGS } from './findings.mjs';
import { ARTIFACT_MOST, Refusal, artifactValue, loadProfile, loopEvents } from '../jarl-lib.mjs';

// ---- the oracle, from the sentence of the help ------------------------------------------------------------------------

// One kind per code point, built once. ASCII from the sentence's own list: letters and digits, spaces and . _ - + @ # , =
// ( ) [ ], the $ and the % with their places, the two separators. Above ASCII, a letter or digit, or a mark, that is not
// default-ignorable and whose NFKC form holds letters, digits and marks alone. Every other code point is 0.
const SEPARATOR = 1;
const LETTER = 2;
const MARK = 3;
const PUNCTUATION = 4;
const DOLLAR = 5;
const PERCENT = 6;
const KIND = new Uint8Array(0x110000);
for (const [from, to] of [[0x30, 0x39], [0x41, 0x5a], [0x61, 0x7a]]) for (let cp = from; cp <= to; cp += 1) KIND[cp] = LETTER;
for (const c of ' ._-+@#,=()[]') KIND[c.codePointAt(0)] = PUNCTUATION;
KIND[0x2f] = SEPARATOR;
KIND[0x5c] = SEPARATOR;
KIND[0x24] = DOLLAR;
KIND[0x25] = PERCENT;
for (let cp = 0x80; cp <= 0x10ffff; cp += 1) {
  if (cp >= 0xd800 && cp <= 0xdfff) continue;
  const c = String.fromCodePoint(cp);
  const kind = /\p{L}|\p{N}/u.test(c) ? LETTER : /\p{M}/u.test(c) ? MARK : 0;
  if (kind === 0 || /\p{DI}/u.test(c)) continue;
  if ([...c.normalize('NFKC')].every((k) => /[\p{L}\p{N}\p{M}]/u.test(k))) KIND[cp] = kind;
}
const DEVICES = new Set(['CON', 'PRN', 'AUX', 'NUL', ...['COM', 'LPT'].flatMap((name) => [...'0123456789\u00b9\u00b2\u00b3'].map((d) => `${name}${d}`))]);
const upperAscii = (s) => [...s].map((c) => (c >= 'a' && c <= 'z' ? String.fromCharCode(c.charCodeAt(0) - 32) : c)).join('');
const hex = (c) => c !== undefined && '0123456789abcdefABCDEF'.includes(c) && c.length === 1;
const kindOf = (c) => KIND[c.codePointAt(0)];

// Whether the sentence accepts a value, and what is stored when it does: the value with the plain spaces around it cut.
function oracle(raw) {
  let v = raw;
  while (v.startsWith(' ')) v = v.slice(1);
  while (v.endsWith(' ')) v = v.slice(0, -1);
  const cs = Array.from(v);
  if (cs.length === 0 || cs.length > 260 || v.normalize('NFC') !== v || cs[0] === '-') return null;
  for (let i = 0; i < cs.length; i += 1) {
    const kind = kindOf(cs[i]);
    const before = i > 0 ? kindOf(cs[i - 1]) : undefined;
    const after = i + 1 < cs.length ? kindOf(cs[i + 1]) : undefined;
    if (kind === 0) return null;
    if (kind === MARK && before !== LETTER && before !== MARK) return null;
    if (kind === DOLLAR && (before !== LETTER || after !== LETTER)) return null;
    if (kind === PERCENT && (i === 0 || before === SEPARATOR || (hex(cs[i + 1]) && hex(cs[i + 2])))) return null;
  }
  const segments = [''];
  for (const c of cs) {
    if (kindOf(c) === SEPARATOR) segments.push('');
    else segments[segments.length - 1] += c;
  }
  const plainSegment = (s, n) => {
    if (n === 0 && s === '.' && segments.length > 1) return true;
    if (s === '' || s === '..' || s.endsWith('.') || s.endsWith(' ')) return false;
    let base = s.split('.')[0];
    while (base.endsWith(' ')) base = base.slice(0, -1);
    return !DEVICES.has(upperAscii(base));
  };
  return segments.every(plainSegment) ? v : null;
}

// What the command does with a value: what it stores, or null when it refuses with the --artifact form.
function command(raw) {
  try {
    return artifactValue(raw);
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    assert.deepEqual(e.ready, { flag: '--artifact', value: '<path>' }, `the refusal ends with the --artifact form: ${JSON.stringify(raw)}`);
    return null;
  }
}

// ---- the values each answer was decided for ---------------------------------------------------------------------------

const LONG = `${'a'.repeat(100008)}.png`;
const AT_MOST = `${'a'.repeat(256)}.png`;
// [value, what is stored, or null for a refusal]
const DECIDED = [
  // a host, a port, a user or an address before the path: a colon wherever it stands
  ['[::1]:8080/x.png', null], ['[fe80::1]:80/x.png', null], ['user@host:22/x.png', null], ['my_host:8080/x.png', null],
  ['user@host:/home/u/x.png', null], ['1.2.3.4:/srv/x.png', null], ['192.168.0.10:renders/x.png', null], ['me@devbox:renders/x.png', null],
  ['git@github.com:org/repo/x.png', null], ['docs/shots/2026-11-08 10:30.png', null], ['localhost:3000/x.png', null], ['127.0.0.1:8080/x.png', null],
  ['file:x.png', null], ['file:/home/u/x.png', null], ['file:///home/u/x.png', null], ['FILE:///C:/Users/u/x.png', null], ['file://server/share/x.png', null],
  ['https://example.com/render.png', null], ['HTTP://localhost:3000/render.png', null], ['mailto:x', null], ['data:image/png;base64,AAAA', null],
  ['javascript:x', null], ['svn+ssh:host/x.png', null], ['vscode:x', null], ['about:blank', null],
  ['C:\\Users\\someone\\render.png', null], ['C:/Users/u/x.png', null], ['c:x.png', null], ['a:b', null],
  ['renders/a.png:ads', null], ['renders/a.png::$DATA', null], ['\\\\?\\C:\\x.png', null],
  // a scheme spelled with a look-alike or split from its colon, an encoded address, a quoted one
  ['\uff46ile:///home/u/x.png', null], ['file\u200b:///home/u/x.png', null], ['file%3A%2F%2F%2Fhome%2Fu%2Fx.png', null], ['%2Fhome%2Fu%2Fx.png', null],
  ['"file:///home/u/x.png"', null], ["'renders/x.png'", null],
  // roots, shares, homes, short names
  ['/home/someone/render.png', null], ['/', null], ['\\renders\\x.png', null], ['\\\\share\\render.png', null], ['//server/share/x.png', null],
  ['\\\\.\\COM1', null], ['~/render.png', null], ['~someone/render.png', null], ['PROGRA~1/x.png', null], ['renders/x.png~', null],
  // what a shell expands where a variable, a command or an arithmetic stands for a place
  ['$HOME/x.png', null], ['${HOME}/x.png', null], ['renders/$HOME/x.png', null], ['renders\\$TMP\\x.png', null], ['renders/a${X}.png', null],
  ['$(pwd)/x.png', null], ['`pwd`/x.png', null], ['$((1+1))/x.png', null], ['renders/a$(pwd).png', null], ['a$.png', null], ['a$_b.png', null],
  ['%USERPROFILE%\\x.png', null], ['renders/%TEMP%/x.png', null], ['%~dp0x.png', null], ['!USERPROFILE!\\x.png', null], ['renders/a%41.png', null],
  // control, format and invisible characters, other spaces, the log's separator, characters Windows refuses
  ['renders/\u202egnp.x', null], ['renders/\u2066x\u2069.png', null], ['renders/\u2067x.png', null], ['renders/\u2068x.png', null],
  ['renders/x\u200b.png', null], ['renders/x\u009b.png', null], ['renders/a\u0387b.png', null], ['renders \u00b7 home.png', null],
  ['renders/\nhome.png', null], ['renders/a\tb.png', null], ['renders/a\u2028b.png', null], ['a\u00a0b.png', null], ['a\u3000b.png', null],
  ['a\u034fb.png', null], ['a\ufe0f.png', null], ['\u3164.png', null], ['a&b.png', null], ['a;b.png', null], ['a|b.png', null],
  ['a*b.png', null], ['a?b.png', null], ['a<b>.png', null], ['a^b.png', null], ['{a,b}.png', null], ['a!b.png', null],
  // look-alikes of a slash and a dot, NFKC forms that hold one, a decomposed letter, a mark on nothing
  ['\u2215home\u2215u\u2215x.png', null], ['\uff0fhome\uff0fx.png', null], ['\u2044home\u2044x.png', null], ['\u2024\u2024/x.png', null], ['\uff0e\uff0e/x.png', null],
  ['\u013f.png', null], ['\u2488.png', null], ['\u00bd.png', null], ['re\u0301sume\u0301/x.png', null], ['\u0301x.png', null], ['renders/\u0301x.png', null],
  // device names of Windows, with or without an extension
  ['NUL', null], ['CON', null], ['renders/CON.png', null], ['COM1.png', null], ['con.tar.gz', null], ['CON .png', null], ['COM0', null], ['LPT\u00b9.png', null],
  // empty segments, dots and spaces at a segment's end, climbs, a dash first, the length
  ['renders/', null], ['.', null], ['./', null], ['renders//x.png', null], ['renders\\', null], ['', null], ['  ', null],
  ['x.png.', null], ['renders /x.png', null], ['..', null], ['../other/render.png', null], ['a/../b', null], ['renders/old/../home.png', null],
  ['renders\\..\\..\\x.png', null], ['./../x.png', null], ['-x.png', null], ['--x.png', null], [`${AT_MOST}x`, null], [LONG, null],
  // plain relative paths, stored as given
  ['renders/home page.png', 'renders/home page.png'], ['./x', './x'], ['.\\x', '.\\x'], ['renders\\x', 'renders\\x'], ['v2.png', 'v2.png'],
  ['renders/50%.png', 'renders/50%.png'], ['price$total.png', 'price$total.png'], ['a$b/c.png', 'a$b/c.png'], ['renders/x%y%.png', 'renders/x%y%.png'],
  ['a$1.png', 'a$1.png'], ['a%2g.png', 'a%2g.png'], ['Screenshot 2026-11-08 at 10.30.15.png', 'Screenshot 2026-11-08 at 10.30.15.png'],
  ['@scope/pkg/x.png', '@scope/pkg/x.png'], ['C++/x.png', 'C++/x.png'], ['r\u00e9sum\u00e9/x.png', 'r\u00e9sum\u00e9/x.png'], ['\u65e5\u672c/x.png', '\u65e5\u672c/x.png'],
  ['\u0939\u093f\u0928\u094d\u0926\u0940/x.png', '\u0939\u093f\u0928\u094d\u0926\u0940/x.png'], ['photo (1).png', 'photo (1).png'], ['[draft] x.png', '[draft] x.png'],
  ['a,b=c#d.png', 'a,b=c#d.png'], ['.github/x.png', '.github/x.png'], ['renders/ x.png', 'renders/ x.png'], ['CONSOLE.png', 'CONSOLE.png'], ['COM10.png', 'COM10.png'],
  ['m\u00b2.png', 'm\u00b2.png'], ['\u216b.png', '\u216b.png'], ['\ufb01le.png', '\ufb01le.png'], ['  renders/x.png  ', 'renders/x.png'], [AT_MOST, AT_MOST],
];

// ---- the product of building blocks -----------------------------------------------------------------------------------

const TOKENS = [
  'renders', 'x.png', 'home page.png', 'a', 'C++', '@scope', 'r\u00e9sum\u00e9', '\u65e5\u672c', '\u0939\u093f\u0928\u094d\u0926\u0940', 'at 10.30.15.png', '.github',
  'photo (1).png', '[draft]', 'a,b=c#d', 'v2', '\u216b', 'm\u00b2', '\ufb01le',
  'price$total.png', 'a$1', 'a$', '$a', 'a$_b', 'a$(b)', '$HOME', '${HOME}', '$(pwd)', '$((1+1))', '50%.png', 'x%y%.png', '%TEMP%', '%~dp0x', '%2F', 'a%2Fb',
  'a%2g', 'a%%b', '', '.', '..', '...', 'x.', 'x ', ' x', '-x', 'CON', 'con.png', 'CON .png', 'NUL.tar.gz', 'COM1', 'COM0.png', 'LPT\u00b9', 'COM10', 'CONSOLE',
  'a.png:ads', 'a.png::$DATA', 'PROGRA~1', '~', '~u', 'a:b', '10:30', '"x"', "'x'", '`pwd`', '!USERPROFILE!', 'a&b', 'a;b', 'a|b', 'a*b', 'a?b', '<x>', '{a,b}',
  'a\u00b7b', 'a\u0387b', '\uff46ile', 'file\u200b', '\u202ex', '\u2066x\u2069', 'x\u009b', 'a\u00a0b', 'a\tb', 'a\nb', 'x\u0000', '\u2215home', '\uff0fhome',
  '\u2024\u2024', '\u013fx', '\u2488x', '\u00bd', 'e\u0301', '\u0301x', '\u00e9\u0301', 'a\u034fb', 'a\ufe0fb', '\u3164', 'a\ud800b',
];
const PREFIXES = [
  '', 'file://', 'file:///', 'file:', 'FILE:/', 'https://example.com/', 'http://localhost:3000/', 'localhost:3000/', '127.0.0.1:8080/', '[::1]:8080/',
  '[fe80::1]:80/', 'user@host:22/', 'my_host:8080/', 'user@host:/home/u/', '1.2.3.4:/srv/', 'me@devbox:', 'git@github.com:org/repo/', 'C:', 'c:\\', 'C:/',
  '\\\\server\\share\\', '//server/', '/', '\\', '~/', '$HOME/', '%USERPROFILE%\\', '\\\\?\\C:\\', '\\\\.\\', 'mailto:', './', '.\\', '../', ' ', '-', '\uff46ile:///',
  '"', '\u202e', 'renders/', 'renders\\',
];
const SEPARATORS = ['/', '\\'];
const JOINERS = [' \u00b7 ', ' ', '//'];
// A deterministic product: every prefix before every token and every decided value, every two tokens joined by each
// separator, a share of them joined by the log's separator, a space or a doubled slash, and every three of a smaller set.
function values() {
  const out = [];
  for (const p of PREFIXES) for (const t of [...TOKENS, ...DECIDED.map(([v]) => v).filter((v) => v.length < 300)]) out.push(`${p}${t}`);
  for (const a of TOKENS) for (const s of SEPARATORS) for (const b of TOKENS) out.push(`${a}${s}${b}`);
  const some = TOKENS.filter((_, n) => n % 4 === 0);
  for (const a of some) for (const j of JOINERS) for (const b of some) out.push(`${a}${j}${b}`);
  const few = TOKENS.filter((_, n) => n % 8 === 1);
  for (const a of few) for (const s of SEPARATORS) for (const b of few) for (const s2 of SEPARATORS) for (const c of few) out.push(`${a}${s}${b}${s2}${c}`);
  return [...new Set(out)];
}

test('the oracle written from the sentence of the help gives every decided value its decided answer', () => {
  assert.equal(ARTIFACT_MOST, 260, 'the length the sentence states');
  const wrong = DECIDED.filter(([v, stored]) => oracle(v) !== stored).map(([v]) => JSON.stringify(v));
  assert.deepEqual(wrong, []);
});

test('review --artifact accepts a value exactly when the oracle does, over every value of the product of building blocks, and stores what the oracle stores', (t) => {
  const all = [...values(), ...DECIDED.map(([v]) => v)];
  let accepted = 0;
  const disagree = [];
  for (const v of all) {
    const want = oracle(v);
    const got = command(v);
    if (got !== want) disagree.push(`${JSON.stringify(v.length > 80 ? `${v.slice(0, 80)}…` : v)}: the oracle ${want === null ? 'refuses' : 'accepts'}, the command ${got === null ? 'refuses' : 'accepts'}`);
    if (want !== null) accepted += 1;
  }
  const written = disagree.filter((d) => d.endsWith('the command accepts')).length;
  t.diagnostic(`${all.length} values, ${accepted} accepted and ${all.length - accepted} refused by the oracle, ${disagree.length} disagreements (${written} written that the oracle refuses, ${disagree.length - written} refused that it accepts)`);
  assert.deepEqual(disagree.slice(0, 20), [], `${disagree.length} disagreements`);
  assert.ok(all.length >= 20000, `the product holds ${all.length} values`);
  assert.ok(accepted >= 1000 && all.length - accepted >= 1000, `both answers are given often: ${accepted} accepted of ${all.length}`);
});

// ---- the real command, on one loop ------------------------------------------------------------------------------------

test('the review command writes each accepted value as given into the verdict line and the Reviews entry, show and report read back exactly those, and a refused value writes nothing', () => {
  // A NUL cannot be given as an argument, and a command line on Windows holds at most 32767 characters: those two are
  // checked above, against the code, and the command gets a value over the limit that every platform passes.
  const sample = DECIDED.filter(([v]) => !v.includes('\u0000') && v !== LONG).concat([[`${'a'.repeat(19996)}.png`, null]]);
  assert.ok(sample.length >= 150, `the sample holds ${sample.length} values`);
  const root = makeLoop({ prefix: 'jarl-artifact-rule-', via: 'cli' });
  const id = fileThreeDigits(root, 'a page change', { acceptance: '[read] the page renders' });
  jarl(root, 'set', id, 'in-progress', '--worker', 'w1');
  jarl(root, 'evidence', id, '--line', '1', '--ran', 'npm test', '--saw', 'pass 3, fail 0');
  // Every file of the loop, by its path, with what it holds.
  const state = () => Object.fromEntries(readdirSync(join(root, '.jarl'), { recursive: true }).map(String).sort()
    .filter((f) => statSync(join(root, '.jarl', f)).isFile()).map((f) => [f, readFileSync(join(root, '.jarl', f), 'utf8')]));
  const issueFile = join(root, '.jarl', 'issues', readdirSync(join(root, '.jarl', 'issues')).find((f) => f.startsWith(`${id}-`)));
  const stored = [];
  for (const [v, want] of sample) {
    if (want === null) {
      const before = state();
      const said = refuses(root, 'review', id, 'approve', '--by', 'rev-a', '--artifact', v, FINDINGS);
      assert.match(said, /--artifact "<path>"\n$/, `the refusal ends with the form: ${JSON.stringify(v.slice(0, 60))}`);
      assert.deepEqual(state(), before, `nothing was written: ${JSON.stringify(v.slice(0, 60))}`);
    } else {
      jarl(root, 'review', id, 'approve', '--by', 'rev-a', '--artifact', v, FINDINGS);
      stored.push(want);
    }
  }
  assert.ok(stored.length >= 25 && sample.length - stored.length >= 100,`${stored.length} accepted, ${sample.length - stored.length} refused`);
  const verdicts = loopEvents(join(root, '.jarl'), loadProfile(root)).filter((e) => e.type === 'verdict');
  assert.deepEqual(verdicts.map((e) => e.artifact), stored, 'the verdict lines');
  const log = readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
  for (const v of stored) assert.ok(log.includes(`${id} review approve · by rev-a (fresh) · model test-model · artifact ${v} · ${FINDINGS}`), `the verdict line names ${v}`);
  const entries = (text) => [...text.matchAll(/^- \*\*approve\*\* · by rev-a \(fresh\) · \d{4}-\d\d-\d\d · (?:model test-model · )?artifact (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(entries(readFileSync(issueFile, 'utf8')), stored, 'the Reviews entries');
  assert.deepEqual(entries(jarl(root, 'show', id)), stored, 'show');
  assert.deepEqual(entries(JSON.parse(jarl(root, 'show', id, '--json')).sections.reviews), stored, 'show --json');
  assert.deepEqual(JSON.parse(jarl(root, 'report', '--json')).metrics.artifacts, { n: stored.length, approve: stored.length, changes: 0, issues: [id] }, 'report');
});
