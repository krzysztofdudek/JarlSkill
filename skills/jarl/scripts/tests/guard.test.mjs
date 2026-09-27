// Jarl reaches one other family tool, in one place: yg-edge.mjs writes a ratified area ruling into Yggdrasil's type
// decision log. Everywhere else its code names no other tool's state directory and runs no other tool's command.
// guard.allow at the repository root lists the places allowed, in the family guard's own format
// (`<path> <rule> [<subject>]  # reason`), and this test holds both ways: every reach is allowed, and every entry
// allows something. It reads code lines only (a line that is a comment is skipped), as the family guard reads code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCRIPTS = fileURLToPath(new URL('..', import.meta.url));
const REPO = fileURLToPath(new URL('../../../..', import.meta.url));
const PREFIX = 'skills/jarl/scripts/';

// The other tools' state directories (as a path segment inside a string) and their commands (a quoted word, or npx).
const REACH = [
  { rule: 'state-path', re: /['"`/](\.yggdrasil|\.grain|\.horde)(?=[/'"`]|$)/g },
  { rule: 'spawn', re: /['"`](yg|yggdrasil|grain|horde)['"`]|\b(npx)\b/g },
];

function findings(file, text) {
  const out = [];
  text.split('\n').forEach((line, n) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    for (const { rule, re } of REACH) for (const m of line.matchAll(re)) out.push({ file, line: n + 1, rule, subject: m[1] || m[2] });
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
  const found = readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs')).flatMap((f) => findings(`${PREFIX}${f}`, readFileSync(`${SCRIPTS}/${f}`, 'utf8')));
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
  assert.deepEqual(findings('x', "const s = `${root}/.horde/hordes`;").map((f) => f.subject), ['.horde']);
  assert.deepEqual(findings('x', '// a comment names .yggdrasil/ and runs yg'), []);
  assert.deepEqual(findings('x', "const name = 'jarl';"), []);
});
