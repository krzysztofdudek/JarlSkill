// Jarl reaches one other family tool, in one place: yg-edge.mjs writes a ratified area ruling into Yggdrasil's type
// decision log. Everywhere else its code names no other tool's state directory and runs no other tool's command.
// guard.allow at the repository root lists the places allowed, in the family guard's own format
// (`<path> <rule> [<subject>]  # reason`), and this test holds both ways: every reach is allowed, and every entry
// allows something. It reads code lines only (a line that is a comment is skipped), as the family guard reads code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LEFT_THE_FAMILY } from './left-the-family.mjs';

const SCRIPTS = fileURLToPath(new URL('..', import.meta.url));
const REPO = fileURLToPath(new URL('../../../..', import.meta.url));
const PREFIX = 'skills/jarl/scripts/';

// The state directories (as a path segment inside a string) and the commands (a quoted word, or npx) of the other tools
// of the family and of the tools that have left it (the one list in left-the-family.mjs): a directory or a command of
// either can sit on a user's machine, and Jarl's code reaches into none of them.
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function reachFor(left) {
  const gone = left.map((name) => escapeRe(name.toLowerCase()));
  return [
    { rule: 'state-path', re: new RegExp(`['"\`/](\\.yggdrasil|\\.grain${gone.map((n) => `|\\.${n}`).join('')})(?=[/'"\`]|$)`, 'g') },
    { rule: 'spawn', re: new RegExp(`['"\`](yg|yggdrasil|grain${gone.map((n) => `|${n}`).join('')})['"\`]|\\b(npx)\\b`, 'g') },
  ];
}
const REACH = reachFor(LEFT_THE_FAMILY);

function findings(file, text, rules = REACH) {
  const out = [];
  text.split('\n').forEach((line, n) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    for (const { rule, re } of rules) for (const m of line.matchAll(re)) out.push({ file, line: n + 1, rule, subject: m[1] || m[2] });
  });
  return out;
}

function parseAllow(text) {
  return text.split('\n').flatMap((raw, n) => {
    const body = raw.replace(/#.*$/, '').trim();
    if (!body) return [];
    const [path, rule, subject, ...extra] = body.split(/\s+/);
    assert.ok(rule && extra.length === 0, `guard.allow line ${n + 1}: expected '<path> <rule> [<subject>]', got '${body}'`);
    assert.ok(/#\s*\S/.test(raw), `guard.allow line ${n + 1}: every entry says why, after a #`);
    return [{ path, rule, subject, line: n + 1 }];
  });
}
const allows = (e, f) => (e.rule === '*' || e.rule === f.rule) && (e.subject === undefined || e.subject === f.subject) && e.path === f.file;

test('the family guard: only the places guard.allow lists reach another tool, and every entry is used', () => {
  const entries = parseAllow(readFileSync(`${REPO}/guard.allow`, 'utf8'));
  const scripts = [...readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs')), ...readdirSync(`${SCRIPTS}/lib`).filter((f) => f.endsWith('.mjs')).map((f) => `lib/${f}`)];
  const found = scripts.flatMap((f) => findings(`${PREFIX}${f}`, readFileSync(`${SCRIPTS}/${f}`, 'utf8')));
  const loose = found.filter((f) => !entries.some((e) => allows(e, f)));
  assert.deepEqual(loose.map((f) => `${f.file}:${f.line} [${f.rule}] ${f.subject}`), [], 'code that reaches another family tool outside guard.allow');
  const unused = entries.filter((e) => !found.some((f) => allows(e, f)));
  assert.deepEqual(unused.map((e) => `guard.allow:${e.line} ${e.path} ${e.rule}`), [], 'guard.allow entries that allow nothing');
  assert.ok(found.some((f) => f.file === `${PREFIX}yg-edge.mjs`), 'the edge is where guard.allow says it is');
});

test('the guard sees what it guards against, and not a comment', () => {
  assert.deepEqual(findings('x', "const d = join(root, '.yggdrasil');").map((f) => f.rule), ['state-path']);
  assert.deepEqual(findings('x', "execFileSync('npx', ['--no-install', 'yg']);").map((f) => f.subject).sort(), ['npx', 'yg']);
  assert.deepEqual(findings('x', "spawnSync('grain', ['export']);").map((f) => f.subject), ['grain']);
  // A state path inside a template string.
  assert.deepEqual(findings('x', "const s = `${root}/.grain/exports`;").map((f) => f.subject), ['.grain']);
  assert.deepEqual(findings('x', '// a comment names .yggdrasil/ and runs yg'), []);
  assert.deepEqual(findings('x', "const name = 'jarl';"), []);
});

test('the guard refuses the state path and the command of a tool that has left the family, wherever a line writes them', () => {
  const [name] = LEFT_THE_FAMILY.map((n) => n.toLowerCase());
  assert.deepEqual(findings('x', `const d = join(root, '.${name}');`).map((f) => [f.rule, f.subject]), [['state-path', `.${name}`]]);
  assert.deepEqual(findings('x', 'const s = `${root}/.' + name + '/items`;').map((f) => [f.rule, f.subject]), [['state-path', `.${name}`]]);
  assert.deepEqual(findings('x', `spawnSync('${name}', ['list']);`).map((f) => [f.rule, f.subject]), [['spawn', name]]);
  assert.deepEqual(findings('x', `// a comment names .${name}/ and runs ${name}`), []);
});

test('a second name on the list of tools that have left the family makes its state path and its command refused too', () => {
  const [first] = LEFT_THE_FAMILY.map((n) => n.toLowerCase());
  const second = 'frobnicator';
  const lines = [`const d = join(root, '.${second}');`, 'const s = `${root}/.' + second + '/items`;', `spawnSync('${second}', ['list']);`];
  const subjects = (rules) => lines.flatMap((line) => findings('x', line, rules).map((f) => f.subject));
  assert.deepEqual(subjects(reachFor(LEFT_THE_FAMILY)), [], 'a name that is not on the list is not refused');
  assert.deepEqual(subjects(reachFor([...LEFT_THE_FAMILY, 'Frobnicator'])), [`.${second}`, `.${second}`, second]);
  assert.deepEqual(findings('x', `spawnSync('${first}x', []);`, reachFor(LEFT_THE_FAMILY)), [], 'a command that only starts with a name on the list is another word');
});
