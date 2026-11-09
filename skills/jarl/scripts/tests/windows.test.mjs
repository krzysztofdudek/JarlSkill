// What Windows does differently, tested on every OS: a loop checked out with CRLF line endings reads
// the same as one with LF, a rename refused for a moment over an open file is retried there (and only there),
// a JARL_GH that is a node script runs without a shebang, and a command Windows prints reads as a test expects
// it: with a drive letter and backslashes in its words, through JSON and through text, on the machine a test runs on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { COMMAND_ARGS, printCommand, readText, renameRetry, RENAME_RETRY_MS, globalWords } from '../jarl.mjs';
import * as L from '../jarl-lib.mjs';
import { commandSpans, posixForms, readOutput, spawnJarl, SPAWN_TIMEOUT, withoutRoot } from './helpers.mjs';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const run = (root, ...args) => spawnJarl(root, args);

// A path as a Windows runner's temporary directory gives it: a drive letter, backslashes, a short name of the kind DOS gave.
const WIN_ROOT = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\jarl-x';

test('the JSON of a call made on Windows stays JSON when a command in it carries a backslash path, and a test reads the command in a POSIX shell\'s spelling with the --root taken out', () => {
  const said = JSON.stringify({ rows: [{ command: `jarl.mjs set "1,2" in-progress "<why-the-worker-changed>" --by "<who>" --root "${WIN_ROOT}"` }], note: `D:\\tool has a backslash and "quotes"` }, null, 2);
  const read = JSON.parse(readOutput(said, ['next', '--as', 'jarl', '--all', '--json'], WIN_ROOT, 'win32'));
  assert.equal(read.rows[0].command, 'jarl.mjs set 1,2 in-progress "<why-the-worker-changed>" --by "<who>"');
  assert.equal(read.note, 'D:\\tool has a backslash and "quotes"', 'a text in the JSON that is no command stays as it is');
  assert.equal(JSON.parse(readOutput(JSON.stringify({ a: 1 }), ['show', '1', '--json'], WIN_ROOT, 'win32')).a, 1, 'and JSON with no command in it reads as itself');
  assert.equal(readOutput('refused: no such issue', ['show', '9', '--json'], WIN_ROOT, 'win32'), 'refused: no such issue', 'a refusal is text, not JSON');
});

test('every --json output is valid JSON when a value holds a backslash', () => {
  const top = mkdtempSync(join(tmpdir(), 'jarl-json-backslash-'));
  const root = join(top, 'a\\folder');
  mkdirSync(join(root, '.git'), { recursive: true });
  assert.equal(run(root, 'init', 'C:\\goal with a backslash').status, 0);
  assert.equal(run(root, 'new', 'a thing in D:\\tools', '--what', 'C:\\Users\\x and "quotes" and \\ alone', '--files', 'a.mjs', '--acceptance', '[read] it works').status, 0);
  assert.equal(run(root, 'set', '1', 'in-progress', 'go', '--worker', 'w1', '--branch', 'jarl/1-thing').status, 0);
  assert.equal(run(root, 'evidence', '1', '--line', '1', '--ran', 'node C:\\x.mjs', '--saw', 'a\\b').status, 0);
  let printed = 0;
  for (const call of [['status'], ['list', '--all'], ['show', '1'], ['next', '--as', 'jarl', '--all'], ['brief', '1'], ['brief', '--role', 'merger'], ['resume'], ['report'], ['verify'], ['decisions'], ['changelog', '1'], ['new', 'another', '--what', 'E:\\y', '--acceptance', '[read] b']]) {
    const r = run(root, ...call, '--json');
    assert.equal(r.status, 0, `${call.join(' ')}: ${r.stderr}`);
    const parsed = JSON.parse(r.stdout);
    if (JSON.stringify(parsed).includes('\\\\')) printed += 1;
  }
  assert.ok(printed >= 5, `${printed} outputs carried a backslash in a value`);
});

test('a test reads every command a Windows run prints in one spelling: past a placeholder no argument of the command stands in for, a flag with no value of its own and a --root that is only a dot', () => {
  const windowsPrinted = [
    [`jarl.mjs field "<ids>" Note "<value>" --by "<who>" "<a-flag-it-takes-or-none>" "<value>" --root "${WIN_ROOT}"`, `jarl.mjs field "<ids>" Note "<value>" --by "<who>" "<a-flag-it-takes-or-none>" "<value>" --root '${WIN_ROOT}'`],
    [`jarl.mjs retract "<id>" "<review-n-or-note-n>" "<why>" --by "<who>" "<a-flag-it-takes-or-none>" "<value>" --saw "<what-it-printed>" --root "${WIN_ROOT}"`, `jarl.mjs retract "<id>" "<review-n-or-note-n>" "<why>" --by "<who>" "<a-flag-it-takes-or-none>" "<value>" --saw "<what-it-printed>" --root '${WIN_ROOT}'`],
    [`jarl.mjs log "<text>" --by "<who>" --x --root "${WIN_ROOT}"`, `jarl.mjs log "<text>" --by "<who>" --x --root '${WIN_ROOT}'`],
    ['jarl.mjs set "<ids>" "<status>" "<why>" --by "<who>" --root .', 'jarl.mjs set "<ids>" "<status>" "<why>" --by "<who>" --root .'],
    ['jarl.mjs set "1,2" in-progress "<why>" --worker "<the-new-worker>" --by jarl', 'jarl.mjs set 1,2 in-progress "<why>" --worker "<the-new-worker>" --by jarl'],
    ['jarl.mjs evidence --by "<who>" "--" "<ids>" "<text>"', 'jarl.mjs evidence --by "<who>" -- "<ids>" "<text>"'],
    [`node "D:\\a\\skills\\jarl\\scripts\\jarl.mjs" review 1 "<verdict>" --by "<reviewer>" --root "${WIN_ROOT}"`, `node D:/a/skills/jarl/scripts/jarl.mjs review 1 "<verdict>" --by "<reviewer>" --root '${WIN_ROOT}'`],
    ['a step: run jarl.mjs show 1 --by "<who>" and go on', 'a step: run jarl.mjs show 1 --by "<who>" and go on'],
  ];
  for (const [printed, posix] of windowsPrinted) assert.equal(posixForms(printed, 'win32'), posix);
  // What only names the tool is left alone: a usage line, the tool's path in a sentence, and a Windows path in a sentence.
  for (const prose of ['usage: jarl.mjs set <ids> <status> [--worker <name>]', 'Tool: node D:\\a\\skills\\jarl\\scripts\\jarl.mjs (every command below is written with both).', 'it opens D:\\a\\jarl.mjs when it starts'])
    assert.equal(posixForms(prose, 'win32'), prose);
  assert.equal(withoutRoot(posixForms(`jarl.mjs init "<goal>" --by "<who>" --profile "<profile.json>" "<as-the-view-shows>" --root "${WIN_ROOT}"\n`, 'win32'), WIN_ROOT), 'jarl.mjs init "<goal>" --by "<who>" --profile "<profile.json>" "<as-the-view-shows>"\n');
  assert.deepEqual(commandSpans(`jarl.mjs field "<ids>" What "<text>" --by "<who>" "<a-flag-it-takes-or-none>"`).length, 1);
  assert.ok(COMMAND_ARGS.field, 'the command table is read');
});

test('the words of a printed command, in the spelling the platform printed them', async () => {
  const { wordsOfPrinted } = await import('./helpers.mjs');
  assert.deepEqual(wordsOfPrinted('node "D:\\a b\\jarl.mjs" merge-driver flags', 'win32'), ['node', 'D:\\a b\\jarl.mjs', 'merge-driver', 'flags']);
  assert.deepEqual(wordsOfPrinted("node '/tmp/a b/jarl.mjs' merge-driver flags", 'linux'), ['node', '/tmp/a b/jarl.mjs', 'merge-driver', 'flags']);
  assert.deepEqual(wordsOfPrinted('node /tmp/jarl.mjs merge-driver flags', 'linux'), ['node', '/tmp/jarl.mjs', 'merge-driver', 'flags']);
});

test('a tool is imported by a file URL, never by a drive-letter path: node reads D: as a URL scheme and refuses it', async () => {
  const { importSpecifier } = await import('./portable.mjs');
  assert.equal(importSpecifier('D:\\a\\JarlSkill\\tests\\tmp-cleanup.mjs', 'win32'), 'file:///D:/a/JarlSkill/tests/tmp-cleanup.mjs');
  assert.equal(importSpecifier('/home/me/repo/tests/tmp-cleanup.mjs', 'linux'), 'file:///home/me/repo/tests/tmp-cleanup.mjs');
  // Every test that starts node with a module to import names it through that one function.
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const bare = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.mjs') && n !== 'windows.test.mjs')) {
    const text = readFileSync(join(dir, f), 'utf8');
    for (const m of text.matchAll(/'--import',\s*([^\s,\]]+)/g)) if (!m[1].startsWith('importSpecifier(')) bare.push(`${f}: --import ${m[1]}`);
  }
  assert.deepEqual(bare, []);
});

test('a --root= given empty stays one word of the form on Windows, where --root "" would be dropped: only the spelling with a space cannot be carried', () => {
  assert.deepEqual(globalWords('root', '', '=', 'windows'), ['--root=']);
  assert.deepEqual(globalWords('root', '', undefined, 'windows'), ['--root', '<loop-root>']);
  assert.equal(L.rootPrintable('', 'windows', '='), true);
  assert.equal(L.rootPrintable('', 'windows'), false);
  assert.equal(printCommand(['jarl.mjs', 'init', '<goal>'], { globals: [['root', '', '=']], shell: 'windows' }), 'jarl.mjs init "<goal>" --by "<who>" --root=');
});

test('readText gives LF whatever the file holds', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'jarl-crlf-')), 'x.md');
  writeFileSync(f, 'a\r\nb\rc\n');
  assert.equal(readText(f), 'a\nb\nc\n');
});

test('a loop whose files came back with CRLF (a Windows checkout with core.autocrlf) reads and writes as with LF', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-crlf-loop-'));
  mkdirSync(join(root, '.git'));
  assert.equal(run(root, 'init', 'goal').status, 0);
  assert.equal(run(root, 'new', 'a thing', '--files', 'a.mjs', '--acceptance', '[read] it works').status, 0);
  const dir = join(root, '.jarl', 'issues');
  const crlf = (f) => writeFileSync(f, readFileSync(f, 'utf8').replace(/\n/g, '\r\n'));
  for (const f of readdirSync(dir)) crlf(join(dir, f));
  for (const f of ['log.md', 'goal.md']) crlf(join(root, '.jarl', f));
  const shown = JSON.parse(run(root, 'show', '1', '--json').stdout);
  assert.equal(shown.title, 'a thing');
  assert.equal(shown.status, 'open');
  assert.deepEqual(shown.fields.files, 'a.mjs');
  assert.equal(run(root, 'set', '1', 'in-progress', 'go').status, 0);
  assert.equal(run(root, 'evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'pass').status, 0);
  const again = JSON.parse(run(root, 'show', '1', '--json').stdout);
  assert.equal(again.status, 'in-progress');
  assert.match(readFileSync(join(dir, readdirSync(dir)[0]), 'utf8'), /\*\*ran(?: \(line [0-9a-f, ]+\))?:\*\* npm test/);
  assert.match(run(root, 'status').stdout, /in flight 1/);
});

test('renameRetry: on win32 a busy rename is retried until it goes through; elsewhere, and for other errors, the first error stands', () => {
  const busy = (n, code = 'EPERM') => { let left = n; return () => { if (left-- > 0) { const e = new Error(code); e.code = code; throw e; } }; };
  let calls = 0; const counted = (f) => (...a) => { calls += 1; return f(...a); };
  renameRetry('a', 'b', counted(busy(3)), 'win32');
  assert.equal(calls, 4);
  for (const code of ['EACCES', 'EBUSY']) renameRetry('a', 'b', busy(2, code), 'win32');
  assert.throws(() => renameRetry('a', 'b', busy(1), 'linux'), { code: 'EPERM' });
  assert.throws(() => renameRetry('a', 'b', busy(1, 'ENOENT'), 'win32'), { code: 'ENOENT' });
  const t0 = Date.now();
  assert.throws(() => renameRetry('a', 'b', busy(Infinity), 'win32'), { code: 'EPERM' });
  assert.ok(Date.now() - t0 >= RENAME_RETRY_MS, 'a rename that never frees up fails after the retry window');
});

test('the MCP server knows it is the entry however its path is spelled: in another drive-letter case on Windows', async () => {
  const { isEntry } = await import('../jarl-mcp.mjs');
  const self = fileURLToPath(new URL('../jarl-mcp.mjs', import.meta.url));
  assert.equal(isEntry(self, self), true);
  assert.equal(isEntry(undefined, self), false);
  assert.equal(isEntry(SCRIPT, self), false);
  const fake = 'C:\\plugins\\jarl\\skills\\jarl\\scripts\\jarl-mcp.mjs';
  assert.equal(isEntry(fake.replace('C:', 'c:'), fake, 'win32'), true, 'drive-letter case does not matter on Windows');
  assert.equal(isEntry(fake.toUpperCase(), fake, 'linux'), false, 'elsewhere case does matter');
});

test('a path written into an issue is stored with slashes when given on Windows, and kept as given elsewhere', async () => {
  const { portablePath } = await import('../jarl.mjs');
  assert.equal(portablePath('..\\tool', 'win32'), '../tool');
  assert.equal(portablePath('src\\a.mjs', 'win32'), 'src/a.mjs');
  assert.equal(portablePath('C:\\work\\tool', 'win32'), 'C:/work/tool');
  assert.equal(portablePath('odd\\name', 'linux'), 'odd\\name', 'a backslash is a file-name character outside Windows');
});

test('the CLI runs when started through a symlink to it, as a plugin directory linked into place is', { skip: process.platform === 'win32' && 'a file symlink needs a privilege on Windows; isEntry is covered above' }, async () => {
  const { symlinkSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'jarl-link-'));
  const link = join(dir, 'jarl.mjs');
  symlinkSync(SCRIPT, link);
  const r = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8', timeout: SPAWN_TIMEOUT });
  assert.match(r.stdout, /^usage: jarl\.mjs/, 'started through the link, the CLI answers instead of exiting silently');
});
