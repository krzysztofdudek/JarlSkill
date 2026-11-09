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
import { appendFileSync, cpSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMPTY, PLAIN, ROOTED, ROOT_ARG, SHELLS, SIBLING, copy, drop, formProblems, partsOf as partsOfRaw, printedCalls, run, runPrinted, snapshot } from './walk.mjs';
import { posixForms } from './helpers.mjs';

const J = await import('../jarl.mjs');
const L = await import('../jarl-lib.mjs');
const MCP = await import('../jarl-mcp.mjs');
const { MUTATING, REPLACED_COMMANDS } = J;
// A refusal's forms as a POSIX shell has them, on every platform (posixForms); the walk's check reads them as printed.
const lastLine = (said) => posixForms(said).replace(/\n+$/, '').split('\n').at(-1);
const partsOf = (said) => partsOfRaw(posixForms(said));

// ---- the check of a refusal ------------------------------------------------------------------------------------------

test('the check of a refusal catches what a form may not be: a composed call that runs, two calls joined, a placeholder outside the registry, a dropped --root, a reason that names no wrong word, a line that writes when pasted', () => {
  const check = (args, line, wrong = 'Deferred', reason = 'status must be one of: open, deferred (got "Deferred")', loop = PLAIN) => formProblems(args, `${reason}\n${line}`, loop, {}, wrong);
  // A form that holds.
  assert.deepEqual(check(['set', '1', 'Deferred', 'later'], "jarl.mjs set \"<ids>\" \"<status>\" \"<why>\" --by \"<who>\""), []);
  assert.deepEqual(check(['set', '--root', ROOT_ARG, '1', 'Deferred', 'later'], `jarl.mjs set "<ids>" "<status>" "<why>" --by "<who>" --root ${ROOT_ARG}`, 'Deferred', undefined, ROOTED), []);
  // The call corrected and composed for the caller: it runs when pasted.
  assert.ok(check(['set', '1', 'Deferred', 'later'], 'jarl.mjs set 1 deferred later').some((p) => /no placeholder/.test(p)));
  // A step and the call joined, the call after it.
  assert.ok(check(['close', '--by', 'jarl'], "jarl.mjs ask \"<question-for-the-owner>\" --by jarl && jarl.mjs close --by jarl", null).some((p) => /not one command/.test(p)));
  // A placeholder outside the registry, which pasted would be recorded as a value.
  assert.ok(check(['set', '1', 'Deferred', 'later'], "jarl.mjs set \"<ids>\" '<a-status-of-yours>' \"<why>\"").some((p) => /no placeholder of the registry/.test(p)));
  // The --root the call gave dropped: pasted, the line reaches another loop.
  assert.ok(check(['set', '--root', ROOT_ARG, '1', 'Deferred', 'later'], "jarl.mjs set \"<ids>\" \"<status>\" \"<why>\" --by \"<who>\"", 'Deferred', undefined, ROOTED).some((p) => /drops --root/.test(p)));
  // A reason that does not name the word that was wrong.
  assert.ok(check(['set', '1', 'Deferred', 'later'], "jarl.mjs set \"<ids>\" \"<status>\" \"<why>\" --by \"<who>\"", 'Deferred', 'a status is wrong').some((p) => /does not name/.test(p)));
  // A placeholder inside a text, which pasted is a text like any other: it writes, and is not refused.
  const writes = check(['log', 'a note'], "jarl.mjs log 'see <id> later' --by jarl", null);
  assert.ok(writes.some((p) => /it writes/.test(p)) && writes.some((p) => /not refused for its placeholder/.test(p)), writes.join('\n'));
  // A refusal that ends with a view, or with a value Jarl chose, in place of the form of the call.
  assert.ok(check(['set', '1', 'Deferred', 'later'], 'jarl.mjs next').some((p) => /neither the command called nor a step/.test(p)));
  assert.ok(check(['set', '1', 'Deferred', 'later'], "jarl.mjs set \"<ids>\" open \"<why>\"").some((p) => /a value the call did not give/.test(p)));
  // A form that, filled, is refused again for the reason the call was: it keeps the word that was wrong.
  const notes = run(copy(PLAIN), ['field', '1', 'Notes', 'x']).stderr.split('\n')[0];
  assert.ok(check(['field', '1', 'Notes', 'x'], "jarl.mjs field \"<ids>\" Notes \"<value>\"", 'Notes', notes).some((p) => /refused again for the same reason/.test(p)));
  // A step that writes and was given the net's placeholder as one more argument, which no filling makes a call.
  assert.ok(check(['field', '1', 'Tags', 'slice:b', '--add'], "jarl.mjs field 1 Tags slice:a --remove \"<as-the-reason-says>\"", null, 'a reason').some((p) => /given one by the net/.test(p)));
  // A reason that, pasted whole into a shell, makes a file: a pipe and a redirection outside quotes.
  assert.ok(check(['set', '1', 'Deferred', 'later'], "jarl.mjs set \"<ids>\" \"<status>\" \"<why>\" --by \"<who>\"", null, 'the value <x|y> is a placeholder').some((p) => /makes a file/.test(p)));
  // A pipe of the reason's own, which makes no file but pipes when pasted; and a word of the caller echoed bare with a >.
  assert.ok(check(['set', '1', 'Deferred', 'later'], "jarl.mjs set \"<ids>\" \"<status>\" \"<why>\" --by \"<who>\"", null, 'answer it with --option carry|law').some((p) => /prints \| outside a placeholder/.test(p)));
  assert.ok(check(['field', '1', 'a>b', 'x'], "jarl.mjs field \"<ids>\" \"<a-part-of-the-description>\" \"<value>\" --by \"<who>\"", null, 'a>b is not a part').some((p) => /prints > outside a placeholder/.test(p)));
  assert.deepEqual(check(['field', '1', 'a>b', 'x'], "jarl.mjs field \"<ids>\" \"<a-part-of-the-description>\" \"<value>\" --by \"<who>\"", 'a>b', "'a>b' is not a part, and \"<b>\" is quoted"), []);
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
  drop(dir);
  return { said: posixForms(r.stderr), ready: lastLine(r.stderr), ...partsOf(r.stderr) };
}

test('a removed command, given words it does not read or a value twice, ends with the form of the command that replaces it and drops or picks nothing', () => {
  const cases = [
    [['tag', '4', '+x', 'bug'], "jarl.mjs field \"<ids>\" Tags \"<tag>\" --add --by \"<who>\""],
    [['prio', '4', '2', '3'], "jarl.mjs field \"<ids>\" Priority \"<prio>\" --by \"<who>\""],
    [['after', '3', '4', '--clear'], "jarl.mjs field \"<ids>\" After --clear --by \"<who>\""],
    [['body', '4', '--what', 'A', '--what', 'B'], "jarl.mjs field \"<ids>\" What \"<text>\" --by \"<who>\""],
    [['repo', 'tool', 'develop', '--base', 'main'], "jarl.mjs base \"<name>\" \"<branch>\" --by \"<who>\""],
    [['body', '4', '--what', 'T', '--why'], "jarl.mjs field \"<ids>\" \"<part>\" \"<value>\" --by \"<who>\""],
    [['tag', '1', '-core', '+"quoted"'], "jarl.mjs field \"<ids>\" Tags \"<tag>\" --add --by \"<who>\""],
    [['body', '1', '--title', 'X', '--section', 'Design=x'], "jarl.mjs field \"<ids>\" \"<part>\" \"<value>\" --by \"<who>\""],
    [['tag', '1', '-core'], "jarl.mjs field \"<ids>\" Tags \"<tag>\" --remove --by \"<who>\""],
  ];
  for (const [args, form] of cases) assert.equal(refusal(args, { wrong: args[0] }).ready, form, args.join(' '));
  // A part given to body with no value of its own takes the next word: the form is the field call of that part, its value
  // a placeholder, and nothing is written.
  assert.match(refusal(['body', '4', '--where', '--what', 'x'], { wrong: 'body' }).ready, /^jarl\.mjs field "<ids>" Where "<text>" --by "<who>"$/);
});

test('a value of a closed set, in another case or outside it, ends with the form of the call and a reason that lists the values: nothing is fixed for the caller', () => {
  const leased = refusal(['set', '2', 'Done', 'all merged'], { wrong: 'Done' });
  assert.equal(leased.ready, "jarl.mjs set \"<ids>\" \"<status>\" \"<why>\" --by \"<who>\"");
  assert.match(leased.reason, /open, in-progress, done, dropped, deferred/);
  assert.equal(refusal(['new', 't', '--tier', 'Strong'], { wrong: 'Strong' }).ready, "jarl.mjs new \"<title>\" --by \"<who>\" --tier \"<tier>\"");
  assert.equal(refusal(['answer', 'a-2', '--by', 'b', '--option', 'b'], { wrong: 'b' }).ready, "jarl.mjs answer \"<question>\" --by \"<who>\" --option \"<option>\"");
  assert.equal(refusal(['mode', 'PERMANENT'], { wrong: 'PERMANENT' }).ready, "jarl.mjs mode \"<mode>\" --by \"<who>\"");
  assert.equal(refusal(['goal', '--set', 'Model (huge): opus'], { wrong: 'huge' }).ready, "jarl.mjs goal --by \"<who>\" --set \"<machine-line>\"");
  // base names a repository as the loop declares it: another spelling ends with the form of base, the reason naming them.
  const base = refusal(['base', 'Tool', 'develop'], { wrong: 'Tool' });
  assert.equal(base.ready, "jarl.mjs base \"<name>\" \"<branch>\" --by \"<who>\"");
  assert.match(base.reason, /it declares tool/);
});

test('a step the call needs first is its own command on its own line, never joined to the call and never followed by a composed one', () => {
  const close = refusal(['close', '--by', 'jarl']);
  assert.equal(close.ready, "jarl.mjs ask \"<question-for-the-owner>\" --by jarl");
  assert.equal(close.commands.length, 1);
  const wait = refusal(['field', '1', 'Kind', 'wait'], { loop: PLAIN, wrong: 'wait' });
  assert.deepEqual(wait.commands, ["jarl.mjs field \"<ids>\" Person \"<name>\" --by \"<who>\"", "jarl.mjs field \"<ids>\" 'Check when' \"<date-or-event>\" --by \"<who>\"", "jarl.mjs field \"<ids>\" Kind \"<kind>\" --by \"<who>\""]);
  for (const line of wait.commands) assert.equal(printedCalls(line).length, 1, line);
  const opened = refusal(['init', 'g'], { loop: PLAIN });
  assert.equal(opened.ready, "jarl.mjs archive \"<slug>\" --by \"<who>\"");
  // A loop that declares no repository takes the step that declares one before any base is changed.
  const undeclared = refusal(['base', 'tool', 'main'], { loop: PLAIN, wrong: 'tool' });
  assert.deepEqual(undeclared.commands, ["jarl.mjs field \"<id>\" Repo \"<name-or-path>\" --by \"<who>\"", "jarl.mjs base \"<name>\" \"<branch>\" --by \"<who>\""]);
});

test('a part field does not write ends with the form whose part is a placeholder, never the part given, so filled it is a call that runs', () => {
  for (const part of ['Notes', 'Status', 'Evidence', 'Reviews', 'Branch', 'Merged', 'Worker', 'Bogus']) {
    const r = refusal(['field', '1', part, 'x'], { loop: PLAIN, wrong: part });
    assert.equal(r.ready, "jarl.mjs field \"<ids>\" \"<a-part-of-the-description>\" \"<value>\" --by \"<who>\"", part);
  }
  const dir = copy(PLAIN);
  assert.equal(run(dir, ['field', '1', 'What', 'a value']).status, 0, 'filled with a part field writes, the form is a call that runs');
});

test('a form holds every flag its command needs beside the ones the call gave, and the value an argument takes where no flag stands in for it: filled, it is not refused for a part it left out', () => {
  const cases = [
    [['review', '1', 'approve'], "jarl.mjs review \"<ids>\" \"<verdict>\" \"<what-was-read-and-found>\" --model \"<model-id>\" --by \"<who>\""],
    [['retract', '1'], "jarl.mjs retract \"<id>\" \"<review-n-or-note-n>\" \"<why>\" --by \"<who>\""],
    [['decide', 's1'], "jarl.mjs decide \"<slug>\" \"<a-ruling>\" --by \"<who>\""],
    [['answer'], "jarl.mjs answer \"<question>\" \"<text>\" --by \"<who>\""],
    [['answer', 'a-1', '--option', 'A', '--by', 'owner'], "jarl.mjs answer \"<question>\" \"<text>\" --by \"<who>\""],
    [['field', '1'], "jarl.mjs field \"<ids>\" \"<part>\" \"<value>\" --by \"<who>\""],
    [['renumber', '99'], "jarl.mjs renumber \"<id>\" --by \"<who>\" --key \"<key>\""],
    [['merged'], "jarl.mjs merged \"<ids>\" --by \"<who>\" --sha \"<sha>\""],
    [['merged', '1', '--ran', 'npm test'], "jarl.mjs merged \"<ids>\" --by \"<who>\" --ran \"<command>\" --saw \"<what-it-printed>\" --sha \"<sha>\""],
    [['evidence', '1', '--slot', 'y'], "jarl.mjs evidence \"<ids>\" --by \"<who>\" --slot \"<slot>\" --file \"<path-under-the-loop-root>\""],
    [['new', 't', '--tier', 'light', '--person', 'someone'], "jarl.mjs new \"<title>\" --by \"<who>\" --tier \"<tier>\" --person \"<name>\" --kind \"<kind>\" --check-when \"<date-or-event>\""],
    [['ask', 'which?', '--until'], "jarl.mjs ask \"<text>\" --by \"<who>\" --until \"<date-or-id>\" --applies-to \"<selectors>\" --kind \"<ask-kind>\""],
    [['decide', 's1', 'a ruling', '--by', 'jarl', '--reach'], "jarl.mjs decide \"<slug>\" \"<a-ruling>\" --by \"<who>\" --reach \"<number-of-files>\" --area \"<type>\""],
    [['round', '1', 'x', '--findings'], "jarl.mjs round \"<id>\" \"<what-failed>\" --findings \"<count>\""],
  ];
  for (const [args, form] of cases) assert.equal(refusal(args, { loop: PLAIN }).ready, form, args.join(' '));
  // A row's --ran and --saw as one pair for each row the call gave, and no part that another stands in for: rows or a note,
  // an option or words, a value or --clear; goal with no --set is the goal read.
  const pairs = [
    [['evidence', '1', '--line', '1', '--ran', 'a', '--ran', 'b', '--saw', 'c'], 'jarl.mjs evidence "<ids>" --line "<line-number>" --ran "<command>" --saw "<what-it-printed>" --ran "<command>" --saw "<what-it-printed>"'],
    [['merged', '1', '--sha', 'abc1234', '--ran', 'a', '--saw', 'b', '--saw', 'c'], 'jarl.mjs merged "<ids>" --by "<who>" --sha "<sha>" --ran "<command>" --saw "<what-it-printed>" --ran "<command>" --saw "<what-it-printed>"'],
    [['evidence', '1', 'a note', '--ran', 'a', '--saw', 'b'], 'jarl.mjs evidence "<ids>" --ran "<command>" --saw "<what-it-printed>"'],
    [['goal', 'x'], 'jarl.mjs goal'],
  ];
  for (const [args, form] of pairs) assert.equal(refusal(args, { loop: PLAIN }).ready, form, args.join(' '));
  // Through the tools, a field the tool does not take ends with the call written there, the author it requires in it.
  for (const [tool, input] of [['jarl_review', { ids: '1', verdict: 'approve', findings: 'read it all here', by: 'rev', model: 'test-model' }], ['jarl_answer', { id: 'a-1', answer: 'this way', by: 'owner' }], ['jarl_decide', { slug: 's9', ruling: 'a ruling', by: 'jarl' }]]) {
    let said = '';
    try { MCP.callTool(tool, { ...input, root: copy(PLAIN) }); } catch (e) { said = e.message; }
    assert.match(said, /"by":"<who>"/, `${tool}: ${said}`);
  }
  // The table holds what the commands refuse: a call that runs is refused once a flag named as needed is taken out of it,
  // and so is one that leaves out the value an argument takes where no flag stands in for it.
  const issues = join(PLAIN.dir, '.jarl', 'issues');
  const key = /^\*\*Key:\*\* (\S+)/m.exec(readFileSync(join(issues, readdirSync(issues).find((f) => f.startsWith('4-'))), 'utf8'))[1];
  const right = [
    [['review', '1', 'approve', 'read it all, fine', '--by', 'rev'], '--by'], [['retract', '1', '1', 'the row was wrong', '--by', 'jarl'], '--by'],
    [['decide', 's9', 'a ruling', '--by', 'jarl'], '--by'], [['answer', 'a-1', 'this way', '--by', 'owner'], '--by'], [['renumber', '4', '--key', key], '--key'],
    [['merged', '1', '--sha', 'abc1234'], '--sha'], [['evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'ok'], '--saw'], [['evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'ok'], '--ran'],
    [['new', 't', '--tier', 'light', '--kind', 'wait', '--person', 'Dana', '--check-when', '2026-12-01'], '--check-when'],
    [['new', 't', '--tier', 'light', '--kind', 'wait', '--person', 'Dana', '--check-when', '2026-12-01'], '--kind'],
    [['decide', 's9', 'a ruling', '--by', 'jarl', '--area', 'module', '--reach', '3'], '--area'], [['ask', 'q?', '--kind', 'lower', '--target', 'the gate'], '--kind'],
  ];
  for (const [args, flag] of right) {
    const ran = run(copy(PLAIN), args);
    assert.equal(ran.status, 0, `${args.join(' ')} runs: ${ran.stderr}`);
    const at = args.indexOf(flag);
    const without = [...args.slice(0, at), ...args.slice(at + 2)];
    assert.notEqual(run(copy(PLAIN), without).status, 0, `${without.join(' ')} is refused`);
  }
  for (const args of [['field', '1', 'What'], ['answer', 'a-1', '--by', 'owner'], ['evidence', '1']]) assert.notEqual(run(copy(PLAIN), args).status, 0, `${args.join(' ')} is refused`);
});

test('done refused names the step its cause asks for, never an act of someone else: the proof, a verdict, the merge, the question to the owner, the log to repair', () => {
  const merging = { 'jarl-profile': 1, name: 'merging', statuses: L.BUILTIN_STATUSES, 'done-gate': { 'requires-merged': true } };
  const proved = [['evidence', '3', '--line', '1', '--ran', 'npm test', '--saw', 'all pass']];
  const approved = [...proved, ['review', '3', 'approve', '--by', 'rev-fresh', 'read the diff and the tests, all fine']];
  const cases = [
    ['no proof and no approve on a read line', {}, "jarl.mjs review \"<ids>\" \"<verdict>\" \"<what-was-read-and-found>\" --by \"<a-fresh-reviewer>\" --model \"<model-id>\""],
    ['no approve', { pre: proved }, "jarl.mjs review \"<ids>\" \"<verdict>\" \"<what-was-read-and-found>\" --by \"<a-fresh-reviewer>\" --model \"<model-id>\""],
    ['an owner line not ticked', { pre: approved }, "jarl.mjs ask \"<question-for-the-owner>\" --issue \"<id>\" --by \"<who>\""],
    ['no merge', { pre: approved, profile: merging }, "jarl.mjs merged \"<ids>\" --sha \"<sha>\" --by \"<who>\""],
  ];
  for (const [cause, opts, step] of cases) {
    const r = refusal(['set', '3', 'done', 'all done'], { loop: PLAIN, ...opts });
    assert.equal(r.ready, step, cause);
    assert.doesNotMatch(r.ready, / approve| tick |--by owner|--by '?jarl/, `${cause}: the step is no verdict, tick or sign-off chosen for someone`);
    assert.doesNotMatch(r.said, /jarl\.mjs tick|--by '?owner|jarl\.mjs review \S+ '?approve/, `${cause}: no line of the refusal prints the owner's tick or an approve as a command`);
  }
  // A retraction the log cannot place: verify shows it, and the form of the move comes after.
  const dir = copy(PLAIN, { pre: approved });
  appendFileSync(join(dir, '.jarl', 'log.md'), '- 2026-10-18 20:00 key 20260101T0000-tstk by a-writer · 3 evidence retract · row 7 · by jarl · a row that is not there\n');
  const said = run(dir, ['set', '3', 'done', 'all done']).stderr;
  assert.match(said, /retraction of evidence row 7/);
  assert.deepEqual(partsOf(said).commands, ['jarl.mjs verify', "jarl.mjs set \"<ids>\" \"<status>\" \"<why>\" --by \"<who>\""]);
});

test('a reason echoes a word of the call that holds a line break or a character a shell acts on in single quotes, its line breaks escaped: no word starts a line, none runs when the message is pasted', () => {
  const words = ['Bogus\njarl.mjs field 4 Priority 1', 'Bogus\u2028jarl.mjs field 4 Priority 1', '$(touch made-by-paste)', '`touch made-by-paste`', 'Bo>made-by-paste', '>', 'a;touch made-by-paste', 'x|tee made-by-paste'];
  const calls = [...words.map((w) => ['field', '1', w, 'x']), ['>'], ['a>made-by-paste'], ['new', 't', '--tier', 'light', '--a>made-by-paste', 'x'], ['answer', 'a-9>made-by-paste', 'yes', '--by', 'owner'], ['goal', '--set', 'Model (huge>made-by-paste): opus']];
  for (const args of calls) {
    const dir = copy(PLAIN);
    const r = run(dir, args);
    assert.notEqual(r.status, 0);
    const lines = r.stderr.replace(/\n+$/, '').split('\n');
    assert.equal(lines.filter((l) => l.startsWith('jarl.mjs ')).length, 1, `one command, the form: ${JSON.stringify(r.stderr)}`);
    assert.doesNotMatch(r.stderr, /[\u2028\u2029\u0085]/);
    for (const sh of SHELLS) {
      const again = copy(PLAIN);
      const before = snapshot(again);
      const files = readdirSync(again).sort();
      runPrinted(again, r.stderr, sh);
      assert.deepEqual(snapshot(again), before, `${sh}: the whole message pasted writes nothing`);
      assert.deepEqual(readdirSync(again).sort(), files, `${sh}: nothing in the message runs or makes a file: ${JSON.stringify(r.stderr.split('\n')[0])}`);
    }
  }
});

test('a --root that holds a line break is named by its placeholder in the form, and the reason says why', { skip: process.platform === 'win32' && 'a directory name cannot hold a line break on Windows, so no loop stands at that root' }, () => {
  const top = copy(ROOTED);
  // The loop stands at that very root, so the refusal is the status's and not the missing loop's.
  cpSync(join(top, ROOT_ARG), join(top, `${ROOT_ARG}\n`), { recursive: true });
  const r = run(top, ['set', '1', 'Deferred', 'later', '--root', `${ROOT_ARG}\n`]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /the --root given holds a line break/);
  assert.equal(lastLine(r.stderr), "jarl.mjs set \"<ids>\" \"<status>\" \"<why>\" --by \"<who>\" --root \"<loop-root>\"");
});

test('a form through the tools carries the root of the call, so filled it reaches the loop the call named', () => {
  const dir = copy(PLAIN);
  const r = MCP.callTool('jarl_field', { by: 'test-writer', ids: '1', name: 'Notes', value: 'x', root: dir });
  assert.equal(r.isError, true);
  const form = lastLine(r.content[0].text);
  assert.equal(form, `jarl.mjs field "<ids>" "<a-part-of-the-description>" "<value>" --by "<who>" ${L.shellWord(`--root=${dir}`)}`);
});

test('a text that starts with dashes is refused with a reason that says it goes after a bare --, and the form puts the arguments there', () => {
  const r = refusal(['new', '--looks like a title', '--tier', 'light'], { loop: PLAIN, wrong: '--looks like a title' });
  assert.match(r.reason, /after a bare --/);
  assert.equal(r.ready, "jarl.mjs new --by \"<who>\" --tier \"<tier>\" -- \"<title>\"");
  // Filled, the form runs and records the title as given.
  const dir = copy(PLAIN);
  const filled = r.ready.replace("\"<who>\"", 'jarl').replace("\"<tier>\"", 'light').replace("\"<title>\"", "'--looks like a title'");
  assert.equal(runPrinted(dir, filled).status, 0, filled);
  assert.ok(L.loadIssues(dir).some((i) => i.title === '--looks like a title'));
});

test('a --root, a --json or another flag written after a bare -- is named in the reason as a flag that goes before it, and the form carries it there', () => {
  const cases = [
    [['evidence', '1', '--', '--json prints ok', '--root', ROOT_ARG], `jarl.mjs evidence --root ${ROOT_ARG} -- "<ids>" "<text>"`],
    [['set', '1', 'deferred', '--', 'later', '--root', ROOT_ARG], `jarl.mjs set --root ${ROOT_ARG} -- "<ids>" "<status>" "<why>"`],
    [['review', '1', 'approve', '--by', 'rev', '--', 'read it all, fine', `--root=${ROOT_ARG}`], `jarl.mjs review --by "<who>" '--root=${ROOT_ARG}' -- "<ids>" "<verdict>" "<what-was-read-and-found>"`],
    [['field', '1', 'What', '--', 'x', '--json', '--root', ROOT_ARG], `jarl.mjs field --json --root ${ROOT_ARG} -- "<ids>" What "<text>"`],
    [['new', '--', 't', '--tier', 'light', '--root', ROOT_ARG], `jarl.mjs new --tier "<tier>" --root ${ROOT_ARG} -- "<title>"`],
    // Two of them, before and after the --, leave which loop was meant to the caller.
    [['set', '--root', 'releases/r2', '1', 'deferred', '--', 'later', '--root', ROOT_ARG], "jarl.mjs set --root \"<loop-root>\" -- \"<ids>\" \"<status>\" \"<why>\""],
  ];
  for (const [args, form] of cases) {
    const r = refusal(args, { loop: ROOTED });
    assert.equal(r.ready, form, args.join(' '));
    assert.match(r.reason, / is a flag, which goes before the bare --|are flags, which go before the bare --/, args.join(' '));
    assert.doesNotMatch(r.reason, /are one text only when quoted/, `${args.join(' ')}: a flag is never offered as a word of a text`);
  }
  // Filled with the values of the call and run where the call was made, the form writes the loop the call named alone.
  const top = copy(ROOTED);
  const filled = `jarl.mjs evidence --root ${ROOT_ARG} -- 1 '--json prints ok'`;
  assert.equal(runPrinted(top, filled).status, 0, filled);
  assert.match(readFileSync(join(top, ROOT_ARG, '.jarl', 'log.md'), 'utf8'), /1 evidence · --json prints ok/);
  assert.deepEqual(L.loadIssues(top).map((i) => i.id), ['1'], 'the loop of the working directory is untouched');
  assert.doesNotMatch(readFileSync(join(top, '.jarl', 'log.md'), 'utf8'), /--json prints ok/);
});

test('a form filled where the call was made reaches the loop the call named: --root as given, both spellings and --root . from inside', () => {
  const fill = (line) => line.replace("\"<ids>\"", '1').replace("\"<status>\"", 'deferred').replace("\"<why>\"", 'later');
  for (const root of [['--root', ROOT_ARG], [`--root=${ROOT_ARG}`]]) {
    const said = run(copy(ROOTED), ['set', ...root, '1', 'Deferred', 'later']).stderr;
    const ready = lastLine(said);
    assert.equal(ready, `jarl.mjs set "<ids>" "<status>" --by "<who>" "<why>" ${root.length === 2 ? `--root ${ROOT_ARG}` : `'--root=${ROOT_ARG}'`}`);
    for (const sh of SHELLS) {
      const top = copy(ROOTED);
      assert.equal(runPrinted(top, fill(ready), sh).status, 0, `${sh}: ${fill(ready)}`);
      assert.equal(L.findIssue(join(top, ROOT_ARG), '1').status, 'deferred', sh);
      assert.deepEqual(L.loadIssues(top).map((i) => i.status), ['open'], `${sh}: the loop at the root is untouched`);
    }
  }
  const inner = join(copy(ROOTED), ROOT_ARG);
  const ready = lastLine(run(inner, ['set', '1', 'Deferred', 'later', '--root', '.']).stderr);
  assert.equal(ready, "jarl.mjs set \"<ids>\" \"<status>\" \"<why>\" --by \"<who>\" --root .");
  assert.equal(runPrinted(inner, fill(ready)).status, 0);
  assert.equal(L.findIssue(inner, '1').status, 'deferred');
});

test('a composer\'s loop is closed and archived by the composer\'s command, which a refusal of close or archive ends with', () => {
  const composer = { 'jarl-profile': 1, name: 'composer', statuses: { open: ['dispatchable'], 'in-progress': ['lease'], done: ['settles-dependents', 'terminal', 'closes-record'], dropped: ['settles-dependents', 'terminal', 'needs-reason'], deferred: ['terminal', 'needs-reason'] }, lifecycle: { close: 'record', archive: 'record', command: 'composer done' } };
  for (const args of [['close', '--force'], ['archive', 'old']]) {
    const r = run(copy(SIBLING, { profile: composer }), args);
    assert.equal(lastLine(r.stderr), 'composer done', args.join(' '));
  }
});

// ---- placeholders are never data -------------------------------------------------------------------------------------

test('the registry holds one-token placeholders only, none of them a value a person writes in angle brackets', () => {
  // One token, no comma, and no pipe, quote or dollar a shell would act on in a reason pasted whole.
  for (const p of L.PLACEHOLDERS) assert.match(p, /^<[^<>\s,|'"$`]+>$/, p);
  for (const value of ['<nil>', '<none>', '<b>', '<br>', '<Button />', '<Response [200]>', '<x>', '<T>']) assert.equal(L.isPlaceholder(value), false, value);
  assert.throws(() => L.hole('<not-registered>'), TypeError);
});

test('a placeholder of the registry is refused as a value, a list item, a line of a list held one per line, or the value part of a value written in parts, with nothing written', () => {
  const holes = [
    ['review', '1', 'approve', '--by', '<reviewer>', 'read it all, fine'], ['retract', '1', '1', '--by', '<who>', 'the row was wrong'],
    ['evidence', '1', '--line', '1', '--ran', '<command>', '--saw', 'ok'], ['evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', '<what-it-printed>'],
    ['set', '3', 'in-progress', 'start', '--worker', 'w3', '--branch', '<worker-branch>'], ['field', '1', 'Title', '<title>'], ['new', '<title>', '--tier', 'light'],
    ['answer', 'a-1', '<text>', '--by', 'owner'], ['decide', 's9', '<text>', '--by', 'jarl'], ['decide', '<slug>', 'a ruling', '--by', 'jarl'], ['log', '<text>'],
    ['field', '1', 'Tags', 'a,<tag>'], ['new', 't', '--tier', 'light', '--after', '3,<id>'], ['answer', 'a-2', '--option', '<option>', '--by', 'owner'], ['goal', '--set', '<machine-line>'],
    // The value part of a value written in parts: a goal line, an option, a source, a field and a section of a profile, a
    // changelog entry, a selector of a scope; a list item taken off; a line of the acceptance.
    ['goal', '--set', 'Check: <command>'], ['goal', '--set', 'Model (<tier>): opus'], ['goal', '--set', 'Model (light): <model-id>'], ['goal', '--set', 'Coordinators: odin, <name>'], ['goal', '--set', 'Model (light): <model-id>, opus'], ['ask', 'q?', '--option', 'A: <label:effect>', '--option', 'B: b'],
    ['new', 't', '--tier', 'light', '--source', '<report-dir#finding-id>'], ['new', 't', '--tier', 'light', '--source', 'research#<id>'], ['new', 't', '--tier', 'light', '--field', 'Area=<value>'],
    ['new', 't', '--tier', 'light', '--section', 'Design=<text>'], ['field', '1', 'Changelog', 'Added: <changelog-entry>'], ['new', 't', '--tier', 'light', '--changelog', 'Fixed: <text>'],
    ['decide', 's9', 'a ruling', '--by', 'jarl', '--applies-to', 'role <role>'], ['decide', 's9', 'a ruling', '--by', 'jarl', '--applies-to', 'loop and <selector>'],
    ['field', '1', 'Tags', 'core,<tag>', '--remove'], ['field', '1', 'Source', 'r/x#<id>'], ['field', '1', 'Acceptance', '[read] a line\n<text>'],
    // The forms the reasons and the help quote, pasted with one value filled and the other left.
    ['evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', '<what-it-printed>'], ['field', '1', 'Check when', '<date-or-event>'], ['merged', '1', '--sha', '<sha>'],
  ];
  for (const args of holes) {
    const dir = copy(PLAIN);
    const before = snapshot(dir);
    const r = run(dir, args);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.match(r.stderr, /placeholder/, args.join(' '));
    assert.deepEqual(snapshot(dir), before, args.join(' '));
    drop(dir);
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
      drop(empty);
      drop(plain);
    }
  }
  // The form of init given --root with no value, pasted as printed, opens no loop in a directory named for its placeholder.
  const empty = copy(EMPTY);
  const ready = lastLine(run(empty, ['init', 'a goal', '--root']).stderr);
  assert.equal(ready, "jarl.mjs init \"<goal>\" --by \"<who>\" --root \"<loop-root>\"");
  // Given twice, the --root of the form is its placeholder too, the reason naming both.
  const twice = run(copy(ROOTED), ['set', '1', 'Deferred', 'later', '--root', ROOT_ARG, '--root', 'releases/r2']).stderr;
  assert.match(twice, /--root given twice \("releases\/r1" and "releases\/r2"\)/);
  assert.equal(lastLine(twice), "jarl.mjs set \"<ids>\" \"<status>\" \"<why>\" --by \"<who>\" --root \"<loop-root>\"");
  for (const sh of SHELLS) {
    assert.notEqual(runPrinted(empty, ready, sh).status, 0, sh);
    assert.deepEqual(readdirSync(empty), ['.git'], sh);
  }
});

test('a value written in angle brackets that is no placeholder of the registry is a value, recorded as it was given', () => {
  const genuine = [
    [['evidence', '1', '--line', '1', '--ran', 'node a.mjs <in.txt', '--saw', 'Vec<T> is fine'], 'Vec<T> is fine'], [['field', '1', 'Title', 'the <b> tag is escaped'], 'the <b> tag is escaped'],
    [['new', 'Map<K, V> leaks', '--tier', 'light'], 'Map<K, V> leaks'], [['decide', 's9', 'use <x> where it fits', '--by', 'jarl'], 'use <x> where it fits'], [['log', '<x> and more'], '<x> and more'],
    [['review', '1', 'approve', '--by', 'rev', '<html> renders, all fine'], '<html> renders, all fine'], [['new', 'Jarl: <b> handling', '--tier', 'light'], 'Jarl: <b> handling'],
    [['field', '1', 'Where', 'the <tag> in a.mjs, line 3'], 'the <tag> in a.mjs, line 3'], [['evidence', '1', '--line', '1', '--ran', 'npm test', '--saw', 'it printed <b>ok</b>'], 'it printed <b>ok</b>'],
    [['field', '1', 'Changelog', 'Fixed: a <b> tag is escaped'], 'Fixed: a <b> tag is escaped'], [['ask', 'q?', '--option', 'A: keep <b> as it is', '--option', 'B: drop it'], 'keep <b> as it is'],
    [['goal', '--set', 'Check: node run.mjs <in.txt'], 'node run.mjs <in.txt'], [['evidence', '1', '--line', '1', '--ran', 'curl x', '--saw', '<nil>'], '<nil>'], [['evidence', '1', '--line', '1', '--ran', 'curl x', '--saw', '<none>'], '<none>'],
    [['evidence', '1', '--line', '1', '--ran', 'curl x', '--saw', '<Response [200]>'], '<Response [200]>'], [['new', '<Button />', '--tier', 'light'], '<Button />'], [['field', '1', 'Title', '<nil>'], '<nil>'],
    [['log', '<none>'], '<none>'], [['new', 't', '--tier', 'light', '--acceptance', '[read] <br>'], '[read] <br>'], [['field', '1', 'What', '<class int>'], '<class int>'],
  ];
  for (const [args, text] of genuine) {
    const dir = copy(PLAIN);
    const r = run(dir, args);
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
    assert.ok(Object.values(snapshot(dir)).some((t) => t.includes(text)), `${args.join(' ')}: ${text} is written as given`);
    drop(dir);
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
  for (const w of ['#12', '=x', '~x', '&&', ';', '|', '{', '}', '!', '[[', 'a b', '', 'a#b', 'a=b', "it's", '$(id)', '`id`', '*', '?', '[a]', '%1']) assert.notEqual(shellWord(w), w, w);
  // A word a shell reserves stands as an argument after jarl.mjs, where no shell reads one: bare, and passed back as it is.
  for (const w of ['done', 'if', 'then', 'esac']) { assert.equal(shellWord(w), w, w); assert.deepEqual(printedCalls(`jarl.mjs set 1 ${shellWord(w)}`), [['set', '1', w]], w); }
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

// How a Windows program reads its command line (the rules of the C runtime, which node follows): words split at spaces
// outside double quotes; a double quote opens or closes a quoted part; 2n backslashes before a double quote are n
// backslashes and the quote counts, 2n+1 are n and a literal quote; any other backslash is itself.
function windowsArgs(line) {
  const out = [];
  let word = null;
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '\\') {
      let n = 0;
      while (line[i + n] === '\\') n += 1;
      if (line[i + n] === '"') { word = (word ?? '') + '\\'.repeat(Math.floor(n / 2)); if (n % 2) { word += '"'; i += n; } else i += n - 1; } else { word = (word ?? '') + '\\'.repeat(n); i += n - 1; }
      continue;
    }
    if (c === '"') { quoted = !quoted; word = word ?? ''; continue; }
    if (/\s/.test(c) && !quoted) { if (word !== null) out.push(word); word = null; continue; }
    word = (word ?? '') + c;
  }
  if (word !== null) out.push(word);
  return out;
}
// What cmd and PowerShell would read in a line other than what a program reads: in cmd a percent sign anywhere, and outside
// double quotes a redirection, a pipe, an ampersand or a caret; in PowerShell a dollar sign or a backtick anywhere, and a
// bare word holding anything but letters, digits and _ . / : = -.
function windowsShellProblems(line) {
  const problems = [];
  if (/[%$`]/.test(line)) problems.push(`holds ${line.match(/[%$`]/)[0]}`);
  let quoted = false;
  for (const c of line) { if (c === '"') quoted = !quoted; else if (!quoted && /[<>|&^]/.test(c)) problems.push(`holds ${c} outside double quotes`); }
  for (const w of line.match(/"[^"]*"|[^\s"]+/g) || []) if (!w.startsWith('"') && !/^[A-Za-z0-9_./:=-]+$/.test(w)) problems.push(`a bare word ${w}`);
  return problems;
}
test('a form is written for the shell of its platform: a POSIX shell on macOS and Linux, PowerShell and cmd on Windows, where a word both do not read alike stands as its placeholder', () => {
  assert.deepEqual(['linux', 'darwin', 'win32'].map(L.shellOf), ['posix', 'posix', 'windows']);
  // Bare where both shells read the word as it is, else in double quotes, read alike by cmd, PowerShell and the program.
  const readable = ['releases/r1', '--root=releases/r1', '<ids>', 'C:\\Users\\x\\r', '\\\\server\\share\\loops', 'C:\\Program Files\\loops', "it's", 'a^b', 'a&b', 'a|b', 'a<b>c', 'a b', '--', 'D:/loops/one'];
  for (const w of readable) {
    assert.equal(L.printable(w, 'windows'), true, JSON.stringify(w));
    const line = `jarl.mjs ${L.shellWord(w, 'windows')}`;
    assert.deepEqual(windowsArgs(line), ['jarl.mjs', w], line);
    assert.deepEqual(windowsShellProblems(line), [], line);
  }
  assert.equal(L.shellWord('releases/r1', 'windows'), 'releases/r1');
  assert.equal(L.shellWord('<ids>', 'windows'), '"<ids>"');
  // Not printable there: a double quote, a percent sign, a dollar sign, a backtick, a line break of any kind, and a word to
  // quote that ends with a backslash, which a program reads as an escape of the closing quote.
  for (const w of ['say "hi"', '100%', '%PATH%', '$HOME', 'a`b', 'two\nlines', 'a\u2028b', 'a\rb', 'C:\\loops\\', 'C:\\my loops\\', '', 'say \u201Chi\u201D', 'say \u201Ehi', 'a!b', '!name!']) {
    assert.equal(L.printable(w, 'windows'), false, JSON.stringify(w));
    assert.equal(L.shellWord(w, 'windows'), '"<value>"', JSON.stringify(w));
  }
  // A POSIX shell takes every word, in single quotes or as a printf of its bytes.
  for (const w of [...readable, '100%', '$HOME', 'two\nlines']) assert.equal(L.printable(w, 'posix'), true, JSON.stringify(w));
  // The form builder, given the platform: the call's --root is carried in the quoting of that shell, or, where that shell
  // cannot carry it, as its placeholder with the reason saying why; the placeholders are quoted alike.
  const refused = (root, platform) => J.refusalFor(new L.Refusal('status must be one of: open, deferred (got "Deferred")', { arg: 1, value: L.hole('<status>') }), { cmd: 'set', args: ['1', 'Deferred', 'later'], flags: [['root', root]] }, platform).message;
  const cases = [
    ['C:\\Users\\x\\r', "--root 'C:\\Users\\x\\r'", '--root "C:\\Users\\x\\r"'],
    ['C:\\Program Files\\loop', "--root 'C:\\Program Files\\loop'", '--root "C:\\Program Files\\loop"'],
    ['\\\\server\\share\\loop', "--root '\\\\server\\share\\loop'", '--root "\\\\server\\share\\loop"'],
    ["C:\\it's\\loop", "--root 'C:\\it'\\''s\\loop'", '--root "C:\\it\'s\\loop"'],
    ['C:\\a&b^c\\loop', "--root 'C:\\a&b^c\\loop'", '--root "C:\\a&b^c\\loop"'],
    ['C:\\100%\\loop', "--root 'C:\\100%\\loop'", '--root "<loop-root>"'],
    ['C:\\say "hi"\\loop', "--root 'C:\\say \"hi\"\\loop'", '--root "<loop-root>"'],
    ['C:\\loops\\', "--root 'C:\\loops\\'", '--root "<loop-root>"'],
    ['releases/r1\n', "--root \"<loop-root>\"", '--root "<loop-root>"'],
  ];
  for (const [root, posix, windows] of cases) {
    const onLinux = refused(root, 'linux');
    const onWindows = refused(root, 'win32');
    assert.equal(onLinux.split('\n').at(-1), `jarl.mjs set "<ids>" "<status>" --by "<who>" "<why>" ${posix}`, JSON.stringify(root));
    assert.equal(onWindows.split('\n').at(-1), `jarl.mjs set "<ids>" "<status>" --by "<who>" "<why>" ${windows}`, JSON.stringify(root));
    assert.deepEqual(windowsShellProblems(onWindows.split('\n').at(-1)), [], onWindows);
    const said = windowsArgs(onWindows.split('\n').at(-1));
    assert.deepEqual(said.slice(0, 5), ['jarl.mjs', 'set', '<ids>', '<status>', '<why>']);
    assert.equal(said[6], windows.includes('<loop-root>') ? '<loop-root>' : root, JSON.stringify(root));
    if (windows.includes('<loop-root>') && !root.includes('\n')) assert.match(onWindows, /\(the --root given holds a character that cmd and PowerShell read apart, or ends with a backslash a program reads as an escape: the form names the loop root by its placeholder\)/);
  }
  // A step and a form of another word that shell cannot carry: the placeholder, and the reason says why.
  const step = J.refusalFor(new L.Refusal('a reason', [{ first: ['jarl.mjs', 'field', '1', 'Owner', '100%'] }, { retry: true }]), { cmd: 'set', args: ['1', 'x'], flags: [] }, 'win32').message;
  assert.equal(step.split('\n').at(-2), 'jarl.mjs field 1 Owner "<value>"');
  assert.match(step, /a word of the form holds a character that cmd and PowerShell read apart: the form names it by its placeholder/);
});

// Where a machine has no zsh, the walk pastes into sh alone: this test says so, and is counted as skipped.
test('the walk pastes into zsh too, where the machine has it', { skip: process.platform === 'win32' ? 'on Windows the walk pastes into Git for Windows\' bash alone' : existsSync('/bin/zsh') ? false : 'no /bin/zsh on this machine: the walk pastes into sh alone' }, () => {
  assert.ok(SHELLS.includes('/bin/zsh'));
});
test('the walk pastes every line into sh and zsh on macOS and Linux, and on Windows into Git for Windows\' bash alone, which reads the forms of both shells', () => {
  if (process.platform === 'win32') assert.deepEqual(SHELLS, ['bash']);
  else { assert.equal(SHELLS[0], '/bin/sh'); assert.ok(SHELLS.every((s) => ['/bin/sh', '/bin/zsh'].includes(s))); }
  // A Windows form pasted into bash is read as cmd and PowerShell read it: placeholders and quoted words alike.
  for (const line of ['jarl.mjs set "<ids>" "<status>" "<why>" --by "<who>" --root releases/r1', 'jarl.mjs field "<ids>" "Check when" "<date-or-event>"']) assert.deepEqual(printedCalls(line)[0], windowsArgs(line).slice(1), line);
});

// ---- the sources -----------------------------------------------------------------------------------------------------

const SOURCES = fileURLToPath(new URL('../', import.meta.url));
const sourceFiles = () => ['jarl.mjs', 'jarl-usage.mjs', 'record.mjs', ...readdirSync(join(SOURCES, 'lib')).filter((f) => f.endsWith('.mjs')).map((f) => `lib/${f}`)];
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
    // A placeholder built in code: a string that opens one and leaves it open (closed by code or another string after
    // it), or one that closes what another opened.
    if (/<[A-Za-z][\w.:#=-]*$/.test(text) || /^[\w.:#=-]*[A-Za-z0-9-]>/.test(text) || text === '<' || text === '>') {
      if (!/(?:startsWith|endsWith|includes|indexOf|split|===|!==)\(?\s*$/.test(before)) problems.push(`${file}:${line}: a placeholder built in code: ${JSON.stringify(text).slice(0, 60)}`);
    }
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
    "const view = (id) => 'jarl.mjs round ' + id + ' <what-failed' + '-now>';",
    "const view = (what) => `jarl.mjs round 1 <${what}>`;",
  ];
  for (const p of planted) assert.equal(tokenProblems('x', p, L.PLACEHOLDERS).length >= 1, true, p);
  assert.deepEqual(tokenProblems('x', "// <not printed>\nconst re = /<[^>]+>/g;\nconst r = new RegExp(`<${tag}\\\\s*>`);\nconst t = 'jarl.mjs set \"<ids>\" \"<status>\"';", L.PLACEHOLDERS), []);
});

// Every command Jarl prints is built by printCommand (lib/base.mjs), wherever it prints it: a form, a step, a command a
// reason names, the one a note offers, the command of a row of a view. So no string of the sources holds jarl.mjs and a
// command after it (the usage text, which is the grammar and no command to run, aside), and no source but lib/base.mjs
// calls printedLine, the builder of a command that carries no global flag of the call.
export function commandStringProblems(file, src) {
  const problems = [];
  const names = [...Object.keys(J.COMMAND_FLAGS), ...Object.keys(J.REPLACED_COMMANDS), 'merge-driver'];
  const built = new RegExp(`jarl\\.mjs (?:${names.join('|')}|["'<])(?![\\w-])`);
  // A command named without jarl.mjs but written with its placeholders or flags (merged <ids> --sha <sha>) is a command
  // line too: it is printed by the builder, which gives it the call's --root, or said in words.
  const bare = new RegExp(`(?<![\\w.<-])(?:${names.join('|')})(?: <[a-z][a-z-]*>)+ --[a-z][\\w-]*(?: ["']?<[a-z][a-z-]*>)`);
  for (const { line, text } of stringsOf(src)) {
    if (text.startsWith('usage: ')) continue;
    if (built.test(text)) problems.push(`${file}:${line}: a command built as a text: ${text.slice(0, 90)}`);
    else if (bare.test(text)) problems.push(`${file}:${line}: a command written as a text: ${text.slice(0, 90)}`);
  }
  if (file !== 'lib/base.mjs') src.split('\n').forEach((l, i) => { if (!/^\s*\/\//.test(l) && /\bprintedLine\(/.test(l)) problems.push(`${file}:${i + 1}: printedLine carries no global flag of the call`); });
  return problems;
}
test('every command Jarl prints is built by printCommand, which carries the call\'s --root and --json: no source builds one as a text', () => {
  const problems = [];
  for (const f of printingFiles()) problems.push(...commandStringProblems(f, readFileSync(join(SOURCES, f), 'utf8')));
  assert.deepEqual(problems, []);
  // The check reads a command built as a text, in a string or a template, and the builder of a bare command; prose that
  // names jarl.mjs is no command.
  for (const planted of ["const x = 'the issues: jarl.mjs list --all';", 'const x = (id) => `jarl.mjs set ${id} done`;', "const x = 'jarl.mjs \"<ids>\"';", 'const x = printedLine([\'jarl.mjs\', \'verify\']);', "const x = 'a merge: merged <ids> --sha <sha> --ran \"<command>\"';"]) assert.equal(commandStringProblems('lib/x.mjs', planted).length, 1, planted);
  assert.deepEqual(commandStringProblems('lib/x.mjs', "const x = '.jarl/.lock is held by another jarl.mjs (pid 7)';\nconst y = jarlLine('list', '--all');"), []);
  assert.deepEqual(commandStringProblems('lib/x.mjs', "const x = 'a retraction takes a row number, not a new --ran/--saw row; close --force removes the loop';"), [], 'a flag or a command named in prose is no command line');
  // A view and a note print through it with the root of the loop they describe: the command of a note carries --root.
  const said = J.dispatch(copy(PLAIN), 'field', ['3', 'What', 'relies on issue 1 for its data'], { root: 'r', json: true, by: 'jarl' });
  assert.ok(said.warn.some((w) => w.endsWith('jarl.mjs field 3 After "<ids-it-waits-on>" --add --root r')), said.warn.join('\n'));
});

// The commands SKILL.md and the references show (a code span or a line of a fenced block that starts with a command of
// the table, holds jarl.mjs, a flag or a tool call jarl_<tool> { ... }) hold no <...> outside the registry: pasted with
// one value filled, such a command would record the other as a value.
export function docProblems(file, whole, registry, commands) {
  // The blocks between the Runes markers are shared fragments, written in Runes and never here: they are read there.
  const text = whole.replace(/<!-- RUNES:([a-z-]+):START -->[\s\S]*?<!-- RUNES:\1:END -->/g, (m) => m.replace(/[^\n]/g, ' '));
  const problems = [];
  const codes = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => ({ at: m.index, code: m[1] }));
  const outside = text.replace(/```[^\n]*\n[\s\S]*?```/g, (m) => ' '.repeat(m.length));
  for (const m of outside.matchAll(/`([^`\n]+)`/g)) codes.push({ at: m.index, code: m[1] });
  for (const { at, code } of codes) {
    for (const line of code.split('\n')) {
      if (!commands.has(line.trim().split(/\s+/)[0]) && !/jarl\.mjs |--[a-z]|\bjarl_[a-z]+ \{|^\s*(?:Check|Model|Coordinators|Merger|Takeover)\b[^:]*:/.test(line)) continue;
      for (const m of line.replace(/\\\|/g, '|').matchAll(/<[^<>\n]+>/g)) if (!registry.includes(m[0])) problems.push(`${file}:${text.slice(0, at).split('\n').length}: ${m[0]} in ${line.trim().slice(0, 80)}`);
    }
  }
  return problems;
}
test('the commands SKILL.md and the references show hold no placeholder outside the registry', async () => {
  const { skillFiles, skillText } = await import('./helpers.mjs');
  const commands = new Set([...Object.keys(J.COMMAND_FLAGS), 'jarl.mjs']);
  assert.deepEqual(skillFiles().flatMap((f) => docProblems(f, skillText(f), L.PLACEHOLDERS, commands)), []);
  assert.equal(docProblems('x', 'run `evidence 1 --ran "<command>" --saw "<what it printed>"`', L.PLACEHOLDERS, commands).length, 1);
  assert.deepEqual(docProblems('x', 'a `<node>` in prose, and `evidence 1 --saw "<what-it-printed>"`', L.PLACEHOLDERS, commands), []);
  // A tool call shown in a fenced block or a code span is read too, wherever it stands in the line.
  assert.equal(docProblems('x', '```\nRecord it: jarl_review { ids: "7", by: "<your name>", root: "<loop-root>" }\n```\n', L.PLACEHOLDERS, commands).length, 1);
  assert.equal(docProblems('x', 'then `jarl_show { id: "7", root: "<the loop>" }`', L.PLACEHOLDERS, commands).length, 1);
  // And a machine line of the goal shown in a code span, which goal --set takes as it stands.
  assert.equal(docProblems('x', 'the lines `Check (<repository>): <command>` and `Model (<tier>): <models>`', L.PLACEHOLDERS, commands).length, 2);
  // A placeholder of a goal line given to goal --set is refused, never recorded.
  const dir = copy(PLAIN);
  const before = snapshot(dir);
  const r = run(dir, ['goal', '--set', 'Model (light): <model-id>']);
  assert.notEqual(r.status, 0);
  assert.deepEqual(snapshot(dir), before);
});

// A refusal is thrown only by refuse, or by need with a reason and a ready part: no error of any class is made or thrown
// anywhere else. The places that do are named here, each with why: refusalFor makes the one Error a refusal reaches the
// caller as; refuse throws the Refusal it builds, and a TypeError when it is given no ready part; hole throws a TypeError
// at code that names a placeholder outside the registry; withLock throws a TypeError at a library caller that hands it
// async work, a mistake in that caller's code and no refusal of a call.
const ALLOWED_ERRORS = [
  ['jarl.mjs', /return new Error\(`\$\{(?:e\.reason|reasonFor\(e\.reason, call, shell, unprintable\))\}\\n\$\{(?:readyText\(e\.ready, shell\)|commandLine\(e\.ready, shell\)|printed\.map\(\(words\) => printCommand\(words, \{ globals, shell \}\)\)\.join\('\\n'\))\}`\)/],
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
  assert.deepEqual(readyProblems('x', "need(a, 'r', ['jarl.mjs', 'list', '--all']);\nneed(b, 'r', () => ['jarl.mjs', 'ask', hole(\"<question-for-the-owner>\")]);"), []);
  // And the command line gives a form that writes and holds no placeholder one of its own, so it is refused when pasted.
  const said = J.refusalFor(new L.Refusal('a reason', ['jarl.mjs', 'close']), { cmd: 'close', args: [], flags: [] }).message;
  assert.equal(lastLine(said), "jarl.mjs close --by \"<who>\"");
  assert.equal(lastLine(J.refusalFor(new L.Refusal('a reason', { arg: 1, value: 'done' }), { cmd: 'set', args: ['1', 'Done'], flags: [] }).message), "jarl.mjs set \"<ids>\" \"<status>\" --by \"<who>\"");
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
