// No refusal ends with a call composed for the caller. A refusal says what is wrong, naming the word of the call that is,
// and ends with the form of the command that does what was meant: a placeholder of the closed registry for each value only
// the caller knows, the call's --root and --json as given, every word quoted for a shell; a step to take first is a
// command on its own line. Pasted as printed, a form is refused for its placeholder and writes nothing. The walks of the
// wrong calls are in the refusals-walk test files (the check itself in walk.mjs); here, the check is shown to catch what a
// form may not be, single calls are named, the placeholders are shown to be refused wherever a value is taken and recorded
// nowhere, and the sources are read: every printed <...> is a placeholder of the registry, every refusal is built by
// refuse or need with its ready part, and nothing else is thrown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMPTY, PLAIN, ROOTED, ROOT_ARG, SHELLS, SIBLING, copy, formProblems, partsOf, printedCalls, run, runPrinted, snapshot } from './walk.mjs';

const J = await import('../jarl.mjs');
const L = await import('../jarl-lib.mjs');
const MCP = await import('../jarl-mcp.mjs');
const { MUTATING, REPLACED_COMMANDS } = J;
const lastLine = (said) => said.replace(/\n+$/, '').split('\n').at(-1);

// ---- the check of a refusal ------------------------------------------------------------------------------------------

test('the check of a refusal catches what a form may not be: a composed call that runs, two calls joined, a placeholder outside the registry, a dropped --root, a reason that names no wrong word, a line that writes when pasted', () => {
  const check = (args, line, wrong = 'Deferred', reason = 'status must be one of: open, deferred (got "Deferred")', loop = PLAIN) => formProblems(args, `${reason}\n${line}`, loop, {}, wrong);
  // A form that holds.
  assert.deepEqual(check(['set', '1', 'Deferred', 'later'], "jarl.mjs set '<ids>' '<status>' '<why>'"), []);
  assert.deepEqual(check(['set', '--root', ROOT_ARG, '1', 'Deferred', 'later'], `jarl.mjs set '<ids>' '<status>' '<why>' --root ${ROOT_ARG}`, 'Deferred', undefined, ROOTED), []);
  // The call corrected and composed for the caller: it runs when pasted.
  assert.ok(check(['set', '1', 'Deferred', 'later'], 'jarl.mjs set 1 deferred later').some((p) => /no placeholder/.test(p)));
  // A step and the call joined, the call after it.
  assert.ok(check(['close', '--by', 'jarl'], "jarl.mjs ask '<question-for-the-owner>' --by jarl && jarl.mjs close --by jarl", null).some((p) => /not one command/.test(p)));
  // A placeholder outside the registry, which pasted would be recorded as a value.
  assert.ok(check(['set', '1', 'Deferred', 'later'], "jarl.mjs set '<ids>' '<a-status-of-yours>' '<why>'").some((p) => /no placeholder of the registry/.test(p)));
  // The --root the call gave dropped: pasted, the line reaches another loop.
  assert.ok(check(['set', '--root', ROOT_ARG, '1', 'Deferred', 'later'], "jarl.mjs set '<ids>' '<status>' '<why>'", 'Deferred', undefined, ROOTED).some((p) => /drops --root/.test(p)));
  // A reason that does not name the word that was wrong.
  assert.ok(check(['set', '1', 'Deferred', 'later'], "jarl.mjs set '<ids>' '<status>' '<why>'", 'Deferred', 'a status is wrong').some((p) => /does not name/.test(p)));
  // A placeholder inside a text, which pasted is a text like any other: it writes, and is not refused.
  const writes = check(['log', 'a note'], "jarl.mjs log 'see <id> later'", null);
  assert.ok(writes.some((p) => /it writes/.test(p)) && writes.some((p) => /not refused for its placeholder/.test(p)), writes.join('\n'));
});

// ---- calls named one by one ------------------------------------------------------------------------------------------

// A call on a loop: its refusal, its last line, and the check of it.
function refusal(args, { loop = SIBLING, wrong = null, ...opts } = {}) {
  const dir = copy(loop, opts);
  const before = JSON.stringify(snapshot(dir));
  const r = run(dir, args);
  assert.notEqual(r.status, 0, `${args.join(' ')} is refused`);
  assert.equal(JSON.stringify(snapshot(dir)), before, `${args.join(' ')} writes nothing`);
  assert.deepEqual(formProblems(args, r.stderr, loop, opts, wrong), [], args.join(' '));
  return { said: r.stderr, ready: lastLine(r.stderr), ...partsOf(r.stderr) };
}

test('a removed command, given words it does not read or a value twice, ends with the form of the command that replaces it and drops or picks nothing', () => {
  const cases = [
    [['tag', '4', '+x', 'bug'], "jarl.mjs field '<ids>' Tags '<tag>' --add"],
    [['prio', '4', '2', '3'], "jarl.mjs field '<ids>' Priority '<prio>'"],
    [['after', '3', '4', '--clear'], "jarl.mjs field '<ids>' After --clear"],
    [['body', '4', '--what', 'A', '--what', 'B'], "jarl.mjs field '<ids>' What '<text>'"],
    [['repo', 'tool', 'develop', '--base', 'main'], "jarl.mjs base '<name>' '<branch>'"],
    [['body', '4', '--what', 'T', '--why'], "jarl.mjs field '<ids>' '<part>' '<value>'"],
    [['tag', '1', '-core', '+"quoted"'], "jarl.mjs field '<ids>' Tags '<tag>' --add"],
    [['body', '1', '--title', 'X', '--section', 'Design=x'], "jarl.mjs field '<ids>' '<part>' '<value>'"],
    [['tag', '1', '-core'], "jarl.mjs field '<ids>' Tags '<tag>' --remove"],
  ];
  for (const [args, form] of cases) assert.equal(refusal(args, { wrong: args[0] }).ready, form, args.join(' '));
  // A part given to body with no value of its own takes the next word: the form is the field call of that part, its value
  // a placeholder, and nothing is written.
  assert.match(refusal(['body', '4', '--where', '--what', 'x'], { wrong: 'body' }).ready, /^jarl\.mjs field '<ids>' Where '<text>'$/);
});

test('a value of a closed set, in another case or outside it, ends with the form of the call and a reason that lists the values: nothing is fixed for the caller', () => {
  const leased = refusal(['set', '2', 'Done', 'all merged'], { wrong: 'Done' });
  assert.equal(leased.ready, "jarl.mjs set '<ids>' '<status>' '<why>'");
  assert.match(leased.reason, /open, in-progress, done, dropped, deferred/);
  assert.equal(refusal(['new', 't', '--tier', 'Strong'], { wrong: 'Strong' }).ready, "jarl.mjs new '<title>' --tier '<tier>'");
  assert.equal(refusal(['answer', 'a-2', '--by', 'b', '--option', 'b'], { wrong: 'b' }).ready, "jarl.mjs answer '<question>' --by '<who>' --option '<option>'");
  assert.equal(refusal(['mode', 'PERMANENT'], { wrong: 'PERMANENT' }).ready, "jarl.mjs mode '<mode>'");
  assert.equal(refusal(['goal', '--set', 'Model (huge): opus'], { wrong: 'huge' }).ready, "jarl.mjs goal --set '<machine-line>'");
  // base names a repository as the loop declares it: another spelling ends with the form of base, the reason naming them.
  const base = refusal(['base', 'Tool', 'develop'], { wrong: 'Tool' });
  assert.equal(base.ready, "jarl.mjs base '<name>' '<branch>'");
  assert.match(base.reason, /it declares tool/);
});

test('a step the call needs first is its own command on its own line, never joined to the call and never followed by a composed one', () => {
  const close = refusal(['close', '--by', 'jarl']);
  assert.equal(close.ready, "jarl.mjs ask '<question-for-the-owner>' --by jarl");
  assert.equal(close.commands.length, 1);
  const wait = refusal(['field', '1', 'Kind', 'wait'], { loop: PLAIN, wrong: 'wait' });
  assert.deepEqual(wait.commands, ["jarl.mjs field 1 Person '<name>'", "jarl.mjs field 1 'Check when' '<date-or-event>'", "jarl.mjs field '<ids>' Kind '<kind>'"]);
  for (const line of wait.commands) assert.equal(printedCalls(line).length, 1, line);
  const opened = refusal(['init', 'g'], { loop: PLAIN });
  assert.equal(opened.ready, "jarl.mjs archive '<slug>'");
});

test('a text that starts with dashes is refused with a reason that says it goes after a bare --, and the form puts the arguments there', () => {
  const r = refusal(['new', '--looks like a title', '--tier', 'light'], { loop: PLAIN, wrong: '--looks like a title' });
  assert.match(r.reason, /after a bare --/);
  assert.equal(r.ready, "jarl.mjs new --tier '<tier>' -- '<title>'");
  // Filled, the form runs and records the title as given.
  const dir = copy(PLAIN);
  const filled = r.ready.replace("'<tier>'", 'light').replace("'<title>'", "'--looks like a title'");
  assert.equal(runPrinted(dir, filled).status, 0, filled);
  assert.ok(L.loadIssues(dir).some((i) => i.title === '--looks like a title'));
});

test('a form filled where the call was made reaches the loop the call named: --root as given, both spellings and --root . from inside', () => {
  const fill = (line) => line.replace("'<ids>'", '1').replace("'<status>'", 'deferred').replace("'<why>'", 'later');
  for (const root of [['--root', ROOT_ARG], [`--root=${ROOT_ARG}`]]) {
    const said = run(copy(ROOTED), ['set', ...root, '1', 'Deferred', 'later']).stderr;
    const ready = lastLine(said);
    assert.equal(ready, `jarl.mjs set '<ids>' '<status>' '<why>' ${root.length === 2 ? `--root ${ROOT_ARG}` : `'--root=${ROOT_ARG}'`}`);
    for (const sh of SHELLS) {
      const top = copy(ROOTED);
      assert.equal(runPrinted(top, fill(ready), sh).status, 0, `${sh}: ${fill(ready)}`);
      assert.equal(L.findIssue(join(top, ROOT_ARG), '1').status, 'deferred', sh);
      assert.deepEqual(L.loadIssues(top).map((i) => i.status), ['open'], `${sh}: the loop at the root is untouched`);
    }
  }
  const inner = join(copy(ROOTED), ROOT_ARG);
  const ready = lastLine(run(inner, ['set', '1', 'Deferred', 'later', '--root', '.']).stderr);
  assert.equal(ready, "jarl.mjs set '<ids>' '<status>' '<why>' --root .");
  assert.equal(runPrinted(inner, fill(ready)).status, 0);
  assert.equal(L.findIssue(inner, '1').status, 'deferred');
});

test('a composer\'s loop is closed and archived by the composer\'s command, which a refusal of close or archive ends with', () => {
  const composer = { 'jarl-profile': 1, format: 3, name: 'composer', statuses: { open: ['dispatchable'], 'in-progress': ['lease'], done: ['settles-dependents', 'terminal', 'closes-record'], dropped: ['settles-dependents', 'terminal', 'needs-reason'], deferred: ['terminal', 'needs-reason'] }, lifecycle: { close: 'record', archive: 'record', command: 'composer done' } };
  for (const args of [['close', '--force'], ['archive', 'old']]) {
    const r = run(copy(SIBLING, { profile: composer }), args);
    assert.equal(lastLine(r.stderr), 'composer done', args.join(' '));
  }
});

// ---- placeholders are never data -------------------------------------------------------------------------------------

test('the registry holds one-token placeholders only, none of them a value a person writes in angle brackets', () => {
  for (const p of L.PLACEHOLDERS) assert.match(p, /^<[^<>\s,]+>$/, p);
  for (const value of ['<nil>', '<none>', '<b>', '<br>', '<Button />', '<Response [200]>', '<x>', '<T>']) assert.equal(L.isPlaceholder(value), false, value);
  assert.throws(() => L.hole('<not-registered>'), TypeError);
});

test('a placeholder of the registry is refused as a value, a list item, a line of a list held one per line, or the value part of a value written in parts, with nothing written', () => {
  const holes = [
    ['review', '1', 'approve', '--by', '<reviewer>', 'read it all, fine'], ['retract', '1', '1', '--by', '<who>', 'the row was wrong'],
    ['evidence', '1', '--ran', '<command>', '--saw', 'ok'], ['evidence', '1', '--ran', 'npm test', '--saw', '<what-it-printed>'],
    ['set', '3', 'in-progress', 'start', '--worker', 'w3', '--branch', '<worker-branch>'], ['field', '1', 'Title', '<title>'], ['new', '<title>', '--tier', 'light'],
    ['answer', 'a-1', '<text>', '--by', 'owner'], ['decide', 's9', '<text>', '--by', 'jarl'], ['decide', '<slug>', 'a ruling', '--by', 'jarl'], ['log', '<text>'],
    ['field', '1', 'Tags', 'a,<tag>'], ['new', 't', '--tier', 'light', '--after', '3,<id>'], ['answer', 'a-2', '--option', '<option>', '--by', 'owner'], ['goal', '--set', '<machine-line>'],
    // The value part of a value written in parts: a goal line, an option, a source, a field and a section of a profile, a
    // changelog entry, a selector of a scope; a list item taken off; a line of the acceptance.
    ['goal', '--set', 'Check: <command>'], ['goal', '--set', 'Model (<tier>): opus'], ['goal', '--set', 'Model (light): <model-id>'], ['ask', 'q?', '--option', 'A: <label:effect>', '--option', 'B: b'],
    ['new', 't', '--tier', 'light', '--source', '<report-dir#finding-id>'], ['new', 't', '--tier', 'light', '--source', 'research#<id>'], ['new', 't', '--tier', 'light', '--field', 'Area=<value>'],
    ['new', 't', '--tier', 'light', '--section', 'Design=<text>'], ['field', '1', 'Changelog', 'Added: <changelog-entry>'], ['new', 't', '--tier', 'light', '--changelog', 'Fixed: <text>'],
    ['decide', 's9', 'a ruling', '--by', 'jarl', '--applies-to', 'role <role>'], ['decide', 's9', 'a ruling', '--by', 'jarl', '--applies-to', 'loop and <selector>'],
    ['field', '1', 'Tags', 'core,<tag>', '--remove'], ['field', '1', 'Source', 'r/x#<id>'], ['field', '1', 'Acceptance', 'a line\n<text>'],
    // The forms the reasons and the help quote, pasted with one value filled and the other left.
    ['evidence', '1', '--ran', 'npm test', '--saw', '<what-it-printed>'], ['field', '1', 'Check when', '<date-or-event>'], ['merged', '1', '--sha', '<sha>'],
  ];
  for (const args of holes) {
    const dir = copy(PLAIN);
    const before = snapshot(dir);
    const r = run(dir, args);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.match(r.stderr, /placeholder/, args.join(' '));
    assert.deepEqual(snapshot(dir), before, args.join(' '));
  }
});

test('every global flag that takes a value is checked for a placeholder: --root given one, in either spelling, is refused before a loop is read or opened', () => {
  const values = Object.entries(J.GLOBAL_FLAGS).filter(([, shape]) => shape === 'value').map(([name]) => name);
  assert.deepEqual(values, ['root'], 'every global flag that takes a value is walked below');
  for (const p of L.PLACEHOLDERS) {
    for (const spelt of [['--root', p], [`--root=${p}`]]) {
      const empty = copy(EMPTY);
      const opened = run(empty, ['init', 'a goal', ...spelt]);
      assert.notEqual(opened.status, 0, `init ${spelt.join(' ')}`);
      assert.match(opened.stderr, /placeholder/, `init ${spelt.join(' ')}`);
      assert.deepEqual(readdirSync(empty), ['.git'], `init ${spelt.join(' ')} opens no loop and makes no directory`);
      const plain = copy(PLAIN);
      const before = snapshot(plain);
      const set = run(plain, ['set', '1', 'deferred', 'later', ...spelt]);
      assert.notEqual(set.status, 0);
      assert.match(set.stderr, /placeholder/);
      assert.deepEqual(snapshot(plain), before);
    }
  }
  // The form of init given --root with no value, pasted as printed, opens no loop in a directory named for its placeholder.
  const empty = copy(EMPTY);
  const ready = lastLine(run(empty, ['init', 'a goal', '--root']).stderr);
  assert.equal(ready, "jarl.mjs init '<goal>' --root '<value>'");
  for (const sh of SHELLS) {
    assert.notEqual(runPrinted(empty, ready, sh).status, 0, sh);
    assert.deepEqual(readdirSync(empty), ['.git'], sh);
  }
});

test('a value written in angle brackets that is no placeholder of the registry is a value, recorded as it was given', () => {
  const genuine = [
    [['evidence', '1', '--ran', 'node a.mjs <in.txt', '--saw', 'Vec<T> is fine'], 'Vec<T> is fine'], [['field', '1', 'Title', 'the <b> tag is escaped'], 'the <b> tag is escaped'],
    [['new', 'Map<K, V> leaks', '--tier', 'light'], 'Map<K, V> leaks'], [['decide', 's9', 'use <x> where it fits', '--by', 'jarl'], 'use <x> where it fits'], [['log', '<x> and more'], '<x> and more'],
    [['review', '1', 'approve', '--by', 'rev', '<html> renders, all fine'], '<html> renders, all fine'], [['new', 'Jarl: <b> handling', '--tier', 'light'], 'Jarl: <b> handling'],
    [['field', '1', 'Where', 'the <tag> in a.mjs, line 3'], 'the <tag> in a.mjs, line 3'], [['evidence', '1', '--ran', 'npm test', '--saw', 'it printed <b>ok</b>'], 'it printed <b>ok</b>'],
    [['field', '1', 'Changelog', 'Fixed: a <b> tag is escaped'], 'Fixed: a <b> tag is escaped'], [['ask', 'q?', '--option', 'A: keep <b> as it is', '--option', 'B: drop it'], 'keep <b> as it is'],
    [['goal', '--set', 'Check: node run.mjs <in.txt'], 'node run.mjs <in.txt'], [['evidence', '1', '--ran', 'curl x', '--saw', '<nil>'], '<nil>'], [['evidence', '1', '--ran', 'curl x', '--saw', '<none>'], '<none>'],
    [['evidence', '1', '--ran', 'curl x', '--saw', '<Response [200]>'], '<Response [200]>'], [['new', '<Button />', '--tier', 'light'], '<Button />'], [['field', '1', 'Title', '<nil>'], '<nil>'],
    [['log', '<none>'], '<none>'], [['new', 't', '--tier', 'light', '--acceptance', '<br>'], '<br>'], [['field', '1', 'What', '<class int>'], '<class int>'],
  ];
  for (const [args, text] of genuine) {
    const dir = copy(PLAIN);
    const r = run(dir, args);
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
    assert.ok(Object.values(snapshot(dir)).some((t) => t.includes(text)), `${args.join(' ')}: ${text} is written as given`);
  }
});

// The tools run the command line's own parser and dispatch, so a tool call is the command line's call: each placeholder of
// the registry, given as each text or list value of each writing tool, is refused before anything is written.
test('each placeholder of the registry is refused in every text or list value a writing tool takes, with nothing written', () => {
  const dir = copy(PLAIN);
  const before = snapshot(dir);
  const FILL = { ids: '1', id: '1', text: 'a reason here', status: 'deferred', verdict: 'approve', name: 'Priority', value: '1', slug: 's9', goal: 'g', title: 't', file: 'research/findings.json', mode: 'permanent', line: '1', entry: '1', by: 'jarl', key: 'k', branch: 'main' };
  const misses = [];
  let calls = 0;
  for (const tool of MCP.buildTools().filter((t) => /^WRITES/.test(t.description))) {
    const props = tool.inputSchema.properties;
    // A path field takes an absolute path: a placeholder in one is refused as no absolute path, before Jarl reads it.
    const paths = MCP.PATH_FIELDS[tool.name.replace(/^jarl_/, '')] || [];
    const base = Object.fromEntries((tool.inputSchema.required || []).map((k) => [k, paths.includes(k) ? join(dir, 'research', 'findings.json') : tool.name === 'jarl_answer' && k === 'id' ? 'a-1' : FILL[k] ?? 'x']));
    for (const [field, p] of Object.entries(props)) {
      if (['root', 'json'].includes(field) || ![].concat(p.type).includes('string')) continue;
      for (const hole of L.PLACEHOLDERS) {
        calls += 1;
        let said;
        try { const r = MCP.callTool(tool.name, { ...base, [field]: hole, root: dir }); said = r.isError ? r.content.map((c) => c.text).join('\n') : null; } catch (e) { said = `invalid: ${e.message}`; }
        const refused = said !== null && (/placeholder/.test(said) || (paths.includes(field) && /must be an absolute path/.test(said)));
        if (!refused) misses.push(`${tool.name} ${field} ${hole}: ${said === null ? 'went through' : said.split('\n')[0]}`);
      }
    }
  }
  assert.ok(calls > 1000, `${calls} calls`);
  assert.deepEqual(misses, []);
  assert.deepEqual(snapshot(dir), before);
});

// ---- the shell ---------------------------------------------------------------------------------------------------------

test('every word of a printed command is written by one function, which leaves a word bare only when no shell reads anything in it, and keeps a line on one line for any reader', () => {
  const { shellWord } = L;
  for (const w of ['abc', '--by', 'a/b.c', '1,2', 'x@y:z%+', 'jarl/1-a', '_x', '.hidden', '/abs/path']) assert.equal(shellWord(w), w, w);
  for (const w of ['#12', '=x', '~x', '&&', ';', '|', '{', '}', '!', 'if', 'done', 'a b', '', 'a#b', 'a=b', "it's", '$(id)', '`id`', '*', '?', '[a]', '%1']) assert.notEqual(shellWord(w), w, w);
  // A word with a character a reader may end a line at is printed on one line, and a shell passes it back as it was.
  for (const w of ['a\nb', 'a\r\nb', 'a\u2028b', 'a\u2029b', 'a\u0085b', 'a\u000bb', 'a\fb', 'tab\there', 'back\\slash\nnext', "quote's\u2028line", '-x\u2028y', '%s\u2028%d']) {
    const printed = `jarl.mjs ${shellWord(w)}`;
    assert.doesNotMatch(printed, /[\r\n\u000b\f\u0085\u2028\u2029]/, JSON.stringify(w));
    assert.deepEqual(printedCalls(printed), [[w]], JSON.stringify(w));
  }
  // The forms of the removed commands are words, each a string, starting with jarl.mjs.
  for (const [cmd, build] of Object.entries(REPLACED_COMMANDS)) {
    const said = build(['1', '--by', 'jarl', '--root', 'r1']);
    assert.ok(Array.isArray(said.form) && said.form[0] === 'jarl.mjs' && said.form.every((w) => typeof w === 'string'), cmd);
  }
});

// ---- the sources -----------------------------------------------------------------------------------------------------

const SOURCES = fileURLToPath(new URL('../', import.meta.url));
const sourceFiles = () => ['jarl.mjs', 'record.mjs', ...readdirSync(join(SOURCES, 'lib')).filter((f) => f.endsWith('.mjs')).map((f) => `lib/${f}`)];
// The sources whose strings Jarl prints: the command line and the library, and the MCP server, whose own refusals of a
// tool call's arguments are its own errors.
const printingFiles = () => ['jarl-mcp.mjs', ...sourceFiles()];

// The string literals of a source, as { line, text, before }: comments and regular expression literals left out, a template
// whole with each ${...} part written as ${} (its code read too, its own strings listed on their own); before is the code
// just ahead of the string.
export function stringsOf(src) {
  const out = [];
  const stack = [];
  let i = 0;
  let line = 1;
  let prev = '';
  const regexBefore = /(?:^|[(,=:[!&|?{};+\-*%<>~^])$|\b(?:return|typeof|case|in|of|delete|void|new|throw|else|do|await|yield)$/;
  function read(entry, q) {
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { entry.text += src.slice(i, i + 2); if (src[i + 1] === '\n') line += 1; i += 2; continue; }
      if (c === '\n') line += 1;
      if (q === '`' && c === '$' && src[i + 1] === '{') { entry.text += '${}'; i += 2; stack.push(entry); return; }
      if (c === q) { i += 1; out.push(entry); return; }
      entry.text += c;
      i += 1;
    }
  }
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line += 1; i += 1; continue; }
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); line += (src.slice(i, end).match(/\n/g) || []).length; i = end + 2; continue; }
    if (c === "'" || c === '"' || c === '`') { const entry = { line, text: '', before: src.slice(Math.max(0, i - 12), i) }; i += 1; read(entry, c); prev = 'x'; continue; }
    if (c === '{') { stack.push('{'); i += 1; prev = c; continue; }
    if (c === '}') { const top = stack.pop(); i += 1; if (top && typeof top === 'object') { read(top, '`'); prev = 'x'; } else prev = c; continue; }
    if (c === '/' && regexBefore.test(prev)) {
      let inClass = false;
      i += 1;
      while (i < src.length) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '[') inClass = true; else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { i += 1; break; } else if (d === '\n') break;
        i += 1;
      }
      while (/[a-z]/.test(src[i] || '')) i += 1;
      prev = 'x';
      continue;
    }
    const w = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 60));
    if (w) { prev = w[0]; i += w[0].length; continue; }
    prev = c;
    i += 1;
  }
  return out;
}
// What is wrong with the <...> tokens of a source's strings: one that is no placeholder of the registry (a word, or built
// from code), and one that stands unquoted in a command written after jarl.mjs, where a shell would read its brackets
// as redirections. A string handed to new RegExp is a pattern, not a text Jarl prints.
export function tokenProblems(file, src, registry) {
  const problems = [];
  for (const { line, text, before } of stringsOf(src)) {
    if (/new RegExp\($/.test(before)) continue;
    for (const m of text.matchAll(/<(?:\$\{\}|[A-Za-z-])[^<>\n]*>/g)) if (!registry.includes(m[0])) problems.push(`${file}:${line}: ${m[0]} is no placeholder of the registry`);
    for (const cmd of text.split('\n').flatMap((l) => l.split(/(?=jarl\.mjs )/).filter((p) => p.startsWith('jarl.mjs ')))) {
      // Each <...> of the command read with the shell's quotes: one outside every quote is read as redirections.
      let quote = null;
      for (let i = 0; i < cmd.length; i += 1) {
        const c = cmd[i];
        if (quote === null && (c === "'" || c === '"')) quote = c;
        else if (c === quote) quote = null;
        else if (quote === null && c === '<' && /^<[^<>\s]+>/.test(cmd.slice(i))) { problems.push(`${file}:${line}: ${/^<[^<>\s]+>/.exec(cmd.slice(i))[0]} stands unquoted in a command: ${cmd.slice(0, 80)}`); break; }
      }
    }
  }
  return problems;
}
test('every <...> Jarl prints, in a ready line, a reason, the help or a tool\'s description, is a placeholder of the registry, quoted where it stands in a command', () => {
  const problems = [];
  for (const f of printingFiles()) problems.push(...tokenProblems(f, readFileSync(join(SOURCES, f), 'utf8'), L.PLACEHOLDERS));
  assert.deepEqual(problems, []);
  // The check reads a placeholder outside the registry wherever it is written, a refusal no call reaches included, one built
  // from code, and one left bare in a command; it reads past comments and patterns.
  const planted = [
    "function never() { need(false, 'a reason', () => ['jarl.mjs', 'models', '--with', '<a-loop-root>']); }",
    "const t = `no ruling here: jarl.mjs decide <an-unregistered-ruling>`;",
    "const t = `the --saw \"<what it printed>\" of a row`;",
    'const t = `pick <${name} or another>`;',
    "const t = 'jarl.mjs review 1 approve --by <reviewer> \"<text>\"';",
  ];
  for (const p of planted) assert.equal(tokenProblems('x', p, L.PLACEHOLDERS).length >= 1, true, p);
  assert.deepEqual(tokenProblems('x', "// <not printed>\nconst re = /<[^>]+>/g;\nconst r = new RegExp(`<${tag}\\\\s*>`);\nconst t = 'jarl.mjs set \"<ids>\" \"<status>\"';", L.PLACEHOLDERS), []);
});

// A refusal is thrown only by refuse, or by need with a reason and a ready part: no error of any class is made or thrown
// anywhere else. The places that do are named here, each with why: refusalFor makes the one Error a refusal reaches the
// caller as; refuse throws the Refusal it builds, and a TypeError when it is given no ready part; hole throws a TypeError
// at code that names a placeholder outside the registry; withLock throws a TypeError at a library caller that hands it
// async work, a mistake in that caller's code and no refusal of a call.
const ALLOWED_ERRORS = [
  ['jarl.mjs', /return new Error\(`\$\{e\.reason\}\\n\$\{(?:readyText\(e\.ready\)|commandLine\(e\.ready\)|printed\.map\(printedLine\)\.join\('\\n'\))\}`\)/],
  ['lib/base.mjs', /throw new TypeError\(`a refusal is built from a reason and a ready part/],
  ['lib/base.mjs', /throw new TypeError\(`\$\{token\} is not a placeholder of the registry/],
  ['lib/base.mjs', /throw new Refusal\(reason, ready\)/],
  ['lib/lock.mjs', /throw new TypeError\(ASYNC_REFUSAL\)/],
];
// A throw that hands on what was caught (throw e), or the refusal the command line builds from it, is not a new error.
const RETHROW = /\bthrow\s+(?:e|err|error)\s*;|\bthrow\s+refusalFor\(/;
export function errorProblems(file, src) {
  const problems = [];
  src.split('\n').forEach((l, i) => {
    if (/^\s*\/\//.test(l)) return;
    const made = /\bnew\s+[A-Z]\w*(?:Error|Refusal)\s*\(/.test(l) || /\bnew\s+Error\s*\(/.test(l);
    const thrown = /\bthrow\b/.test(l) && !RETHROW.test(l);
    if (!made && !thrown) return;
    if (ALLOWED_ERRORS.some(([f, re]) => f === file && re.test(l))) return;
    problems.push(`${file}:${i + 1}: ${l.trim().slice(0, 100)}`);
  });
  return problems;
}
function needArity(src) {
  const bad = [];
  for (const m of src.matchAll(/(?<![\w$.])need\(|\bL\.need\(/g)) {
    if (/function need\(/.test(src.slice(Math.max(0, m.index - 9), m.index + 5))) continue;
    let depth = 0; let args = 1; let q = null;
    for (let i = m.index + m[0].length; i < src.length; i += 1) {
      const c = src[i];
      if (q) { if (c === '\\') i += 1; else if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; continue; }
      if ('([{'.includes(c)) depth += 1;
      else if (')]}'.includes(c)) { if (depth === 0) break; depth -= 1; }
      else if (c === ',' && depth === 0) args += 1;
    }
    if (args < 3) bad.push(src.slice(0, m.index).split('\n').length);
  }
  return bad;
}
// The ready part of each need and refuse of a source, as written: the last argument of the call.
function readyParts(src) {
  const out = [];
  for (const m of src.matchAll(/(?<![\w$.])(?:need|refuse)\(|\bL\.need\(/g)) {
    if (/function (?:need|refuse)\(/.test(src.slice(Math.max(0, m.index - 9), m.index + 7))) continue;
    let depth = 0; let q = null; let start = m.index + m[0].length; let i = start;
    for (; i < src.length; i += 1) {
      const c = src[i];
      if (q) { if (c === '\\') i += 1; else if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; continue; }
      if ('([{'.includes(c)) depth += 1;
      else if (')]}'.includes(c)) { if (depth === 0) break; depth -= 1; }
      else if (c === ',' && depth === 0) start = i + 1;
    }
    out.push({ line: src.slice(0, m.index).split('\n').length, text: src.slice(start, i).trim() });
  }
  return out;
}
// What is wrong with a ready part, read from its source: a command of a command that writes, written out with no
// placeholder in it, which pasted would run; a command built as a text from code, which no quoting function wrote.
export function readyProblems(file, src) {
  const problems = [];
  for (const { line, text } of readyParts(src)) {
    const command = /\[\s*'jarl\.mjs',\s*'([a-z-]+)'/.exec(text);
    if (command && MUTATING.has(command[1]) && !/'<|\bhole\(|RETRACT_FORM|RETRACT_REVIEW_FORM|fieldForm\(/.test(text)) problems.push(`${file}:${line}: a command that writes, with no placeholder: ${text.slice(0, 80)}`);
    if (/`[^`]*jarl\.mjs [^`]*\$\{/.test(text)) problems.push(`${file}:${line}: a command built as a text: ${text.slice(0, 80)}`);
  }
  return problems;
}
test('every ready part of the sources is a shape of the call, a form or step that holds a placeholder, or a view; none is a command built as a text', () => {
  const problems = [];
  for (const f of sourceFiles()) problems.push(...readyProblems(f, readFileSync(join(SOURCES, f), 'utf8')));
  assert.deepEqual(problems, []);
  // The check reads a command that writes with no placeholder, and one built as a text.
  assert.equal(readyProblems('x', "need(a, 'reason', () => ['jarl.mjs', 'set', id, 'deferred', 'later']);").length, 1);
  assert.equal(readyProblems('x', "need(a, 'reason', () => `jarl.mjs set ${id} deferred`);").length, 1);
  assert.deepEqual(readyProblems('x', "need(a, 'r', ['jarl.mjs', 'list', '--all']);\nneed(b, 'r', () => ['jarl.mjs', 'ask', hole('<question-for-the-owner>')]);"), []);
  // And the command line gives a form that writes and holds no placeholder one of its own, so it is refused when pasted.
  const said = J.refusalFor(new L.Refusal('a reason', ['jarl.mjs', 'close']), { cmd: 'close', args: [], flags: [] }).message;
  assert.equal(lastLine(said), "jarl.mjs close '<as-the-reason-says>'");
  assert.equal(lastLine(J.refusalFor(new L.Refusal('a reason', { arg: 1, value: 'done' }), { cmd: 'set', args: ['1', 'Done'], flags: [] }).message), "jarl.mjs set '<ids>' '<status>'");
});
test('every refusal of the sources is built by refuse or need with its ready part; no other error of any class is made or thrown', async () => {
  const problems = [];
  for (const f of sourceFiles()) {
    const src = readFileSync(join(SOURCES, f), 'utf8');
    for (const line of needArity(src)) problems.push(`${f}:${line}: need( with no ready part`);
    problems.push(...errorProblems(f, src));
  }
  assert.deepEqual(problems, []);
  // refuse turns away a refusal with no ready part, or with one that is neither a command nor a shape of the call.
  const { refuse } = await import('../lib/base.mjs');
  assert.throws(() => refuse('a reason'), TypeError);
  assert.throws(() => refuse('a reason', 'list the issues'), TypeError);
  assert.throws(() => refuse('a reason', { first: 'see the help' }), TypeError);
  assert.throws(() => refuse('a reason', ['jarl.mjs', 'list']), (e) => e.reason === 'a reason' && e.message === 'a reason\njarl.mjs list');
  // The checks see a need with two arguments, and an error of any class made or thrown outside refuse.
  assert.deepEqual(needArity("need(a, 'reason');\nneed(a, 'reason', ['jarl.mjs', 'x']);"), [1]);
  for (const planted of ["  throw new RangeError('bad status');", "  throw new Error('no such issue');", "  const e = new TypeError('x');", "  throw Object.assign(new Error('x'), { code: 1 });", "  throw 'a refusal';"]) {
    assert.equal(errorProblems('lib/commands.mjs', `const a = 1;\n${planted}\n`).length, 1, planted);
  }
  assert.deepEqual(errorProblems('lib/commands.mjs', 'try { x(); } catch (e) { throw e; }\n'), []);
});
