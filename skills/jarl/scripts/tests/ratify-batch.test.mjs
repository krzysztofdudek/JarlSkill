// Rulings about a whole area of code (issue 475): `decide --area <type> [--reach n]` marks one; `close` files the
// ratification batch — at most ten, widest reach first, each a ratify item answered with one word — and never waits
// for it; a ratified area ruling is written into the type's decision log through yg-edge.mjs when the repository
// has a graph and a working yg, and stays a ruling of the loop when it has neither or the write fails.
// JARL_YG stands in for `npx --no-install yg`: a stub that records every call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));

// A yg stand-in: appends each call (its arguments and the text of --reason-file) as a JSON line to calls.jsonl beside
// it; `mode` decides what it answers: ok, refuse (the write fails with a message), dead (even --version fails).
function stub(mode = 'ok') {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-yg-'));
  const bin = join(dir, 'yg-stub.mjs');
  writeFileSync(bin, `import { appendFileSync, readFileSync } from 'fs';
const args = process.argv.slice(2);
const at = args.indexOf('--reason-file');
appendFileSync(${JSON.stringify(join(dir, 'calls.jsonl'))}, JSON.stringify({ args, cwd: process.cwd(), text: at >= 0 ? readFileSync(args[at + 1], 'utf8') : null }) + '\\n');
const mode = ${JSON.stringify(mode)};
if (mode === 'dead') process.exit(1);
if (args[0] === '--version') { console.log('6.1.0'); process.exit(0); }
if (mode === 'writer') {
  // Another writer of the loop while the type log is being written: it must not find the loop's lock held.
  const { spawnSync } = await import('child_process');
  const r = spawnSync(process.execPath, [${JSON.stringify(SCRIPT)}, 'log', 'meanwhile', '--root', process.env.JARL_TEST_ROOT], { encoding: 'utf8', env: { ...process.env, JARL_LOCK_WAIT_MS: '300' } });
  appendFileSync(${JSON.stringify(join(dir, 'calls.jsonl'))}, JSON.stringify({ args: ['meanwhile'], status: r.status, stderr: r.stderr }) + '\\n');
}
if (mode === 'refuse') { console.error("error[type-not-found]: node type '" + args[3] + "' is not defined"); process.exit(1); }
if (mode === 'no-type' && args[2] === '--aspect') { console.error("error[aspect-ratify-no-type]: Rule '" + args[3] + "' reaches no node type"); process.exit(1); }
console.log(args[2] === '--aspect' ? "Added a log entry to rule '" + args[3] + "'." : 'Added log entry to .yggdrasil/types/' + args[3] + '/log.md');
console.log('Timestamp: 2026-09-27T10:00:0' + (readFileSync(${JSON.stringify(join(dir, 'calls.jsonl'))}, 'utf8').trim().split('\\n').length) + '.000Z');
`);
  return { bin, calls: () => (existsSync(join(dir, 'calls.jsonl')) ? readFileSync(join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []) };
}

function loop({ graph = false, permanent = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jarl-ratify-'));
  mkdirSync(join(root, '.git'));
  if (graph) mkdirSync(join(root, '.yggdrasil'));
  jarl(root, {}, 'init', 'goal', ...(permanent ? ['--permanent'] : []));
  return root;
}
function run(root, env, args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8', env: { ...process.env, JARL_YG: '', ...env } });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}
function jarl(root, env, ...args) {
  const r = run(root, env, args);
  if (r.status !== 0) throw new Error(`jarl ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}
const json = (root, env, ...args) => JSON.parse(jarl(root, env, ...args, '--json'));
const decisions = (root) => readFileSync(join(root, '.jarl', 'decisions.md'), 'utf8');

test('decide --area records the area and its reach; --reach needs --area and a whole number; a bad type name is refused', () => {
  const root = loop();
  const out = json(root, {}, 'decide', 'boundary', 'Every handler validates its input.', '--area', 'handler', '--reach', '40');
  assert.equal(out.area, 'handler');
  assert.equal(out.reach, 40);
  assert.match(decisions(root), /\*\*Area:\*\* handler\n\*\*Reach:\*\* 40/);
  const d = json(root, {}, 'decisions').find((x) => x.slug === 'boundary');
  assert.equal(d.area, 'handler');
  assert.equal(d.reach, 40);
  assert.equal(d.ratified, null);
  assert.match(run(root, {}, ['decide', 'x', 'r', '--reach', '3']).stderr, /needs --area/);
  assert.match(run(root, {}, ['decide', 'y', 'r', '--area', 'a', '--reach', 'many']).stderr, /whole number/);
  assert.match(run(root, {}, ['decide', 'z', 'r', '--area', 'a/b']).stderr, /one word/);
  assert.equal(json(root, {}, 'decide', 'plain', 'not about an area').area, undefined);
});

test('close --batch files at most ten items, widest reach first, closes nothing, and never asks about a ruling twice', () => {
  const root = loop();
  for (let n = 1; n <= 12; n += 1) jarl(root, {}, 'decide', `r${n}`, `Ruling ${n}. More text.`, '--area', `t${n}`, '--reach', String(n));
  jarl(root, {}, 'decide', 'uncounted', 'No count given.', '--area', 'tx');
  jarl(root, {}, 'decide', 'plain', 'Not about an area.');
  jarl(root, {}, 'decide', 'old', 'Replaced before anyone saw it.', '--area', 'ty', '--reach', '99');
  jarl(root, {}, 'decide', 'new', 'The replacement.', '--area', 'ty', '--reach', '99', '--supersedes', 'old');
  const first = json(root, {}, 'close', '--batch');
  assert.equal(first.closed, false);
  assert.ok(existsSync(join(root, '.jarl')));
  assert.equal(first.batch.items.length, 10);
  assert.deepEqual(first.batch.items.map((i) => i.ruling), ['new', 'r12', 'r11', 'r10', 'r9', 'r8', 'r7', 'r6', 'r5', 'r4']);
  assert.equal(first.batch.waiting, 4);   // r3, r2, r1 and the uncounted one
  assert.match(first.batch.items[1].question, /^area t12 · 12 files · r12: "Ruling 12\." — yes/);
  const again = json(root, {}, 'close', '--batch');
  assert.deepEqual(again.batch.filed, []);
  assert.equal(again.batch.items.length, 10);
  // Two answered make room for two more; the uncounted one comes last.
  jarl(root, {}, 'answer', first.batch.items[0].ask, 'reject');
  jarl(root, {}, 'answer', first.batch.items[1].ask, 'yes');
  const third = json(root, {}, 'close', '--batch');
  assert.deepEqual(third.batch.items.slice(-2).map((i) => i.ruling), ['r3', 'r2']);
  assert.equal(third.batch.waiting, 2);
  const status = json(root, {}, 'status');
  assert.equal(status.ratify, 10);
  assert.equal(status.questions, 0, 'a ratify item is not a question the loop waits on');
});

test('a ratification is answered with one word first: anything else is refused and nothing is written', () => {
  const root = loop();
  jarl(root, {}, 'decide', 'r', 'A rule.', '--area', 'svc', '--reach', '3');
  const { ask } = json(root, {}, 'close', '--batch').batch.items[0];
  const before = decisions(root);
  assert.match(run(root, {}, ['answer', ask, 'maybe later']).stderr, /starts with one word — yes/);
  assert.equal(decisions(root), before);
  assert.match(jarl(root, {}, 'answer', ask, 'Nie.'), /r rejected/);
  assert.match(decisions(root), /\*\*Rejected:\*\* a-001/);
  assert.equal(json(root, {}, 'decisions').find((d) => d.slug === 'r').rejected, 'a-001');
  assert.deepEqual(json(root, {}, 'close', '--batch').batch.items, [], 'a rejected ruling is never asked again');
});

test('"no" decides nothing alone — English no, colloquial Polish yes: the next word decides, a bare "no" is refused (issue 496)', () => {
  const root = loop();
  for (const r of ['a', 'b', 'c', 'd']) jarl(root, {}, 'decide', r, 'A rule.', '--area', 'svc', '--reach', '3');
  const items = json(root, {}, 'close', '--batch').batch.items;
  const ask = (slug) => items.find((i) => i.ruling === slug).ask;
  const before = decisions(root);
  for (const bare of ['no', 'No.', 'no!', 'no maybe']) {
    const r = run(root, {}, ['answer', ask('a'), bare]);
    assert.notEqual(r.status, 0, `"${bare}" is refused`);
    assert.match(r.stderr, /English no and colloquial Polish yes[\s\S]*answer tak or nie/);
  }
  assert.equal(decisions(root), before, 'a refused answer writes nothing: no Rejected mark');
  assert.match(jarl(root, {}, 'answer', ask('a'), 'no tak'), /a ratified/);
  assert.match(jarl(root, {}, 'answer', ask('b'), 'No, tak.'), /b ratified/);
  assert.match(jarl(root, {}, 'answer', ask('c'), 'no nie'), /c rejected/);
  assert.match(jarl(root, {}, 'answer', ask('d'), 'reject'), /d rejected/);
  const ds = json(root, {}, 'decisions');
  assert.deepEqual(['a', 'b', 'c', 'd'].map((s) => [ds.find((d) => d.slug === s).ratified, ds.find((d) => d.slug === s).rejected]), [[ask('a'), null], [ask('b'), null], [null, ask('c')], [null, ask('d')]]);
});

test('close goes through without any ratification: a branch loop is removed, a permanent one keeps its open items', () => {
  const root = loop();
  jarl(root, {}, 'decide', 'r', 'A rule.', '--area', 'svc', '--reach', '3');
  const closed = json(root, {}, 'close');
  assert.equal(closed.closed, true);
  assert.equal(closed.batch.items.length, 1);
  assert.ok(!existsSync(join(root, '.jarl')));

  const perm = loop({ permanent: true });
  jarl(perm, {}, 'decide', 'r', 'A rule.', '--area', 'svc', '--reach', '3');
  assert.match(jarl(perm, {}, 'close'), /closed as a permanent record[\s\S]*to ratify \(1\)[\s\S]*unanswered items stay open/);
  assert.equal(json(perm, {}, 'status').ratify, 1);
  assert.match(jarl(perm, {}, 'answer', 'a-001', 'yes'), /r ratified · not written into a type log: no \.yggdrasil\//);
});

test('without a graph, a ratified area ruling is never sent anywhere', () => {
  const yg = stub();
  const root = loop();
  jarl(root, {}, 'decide', 'r', 'A rule.', '--area', 'svc', '--reach', '3');
  jarl(root, {}, 'close', '--batch');
  const out = json(root, { JARL_YG: yg.bin }, 'answer', 'a-001', 'yes');
  assert.equal(out.verdict, 'ratified');
  assert.equal(out.typeLog.state, 'skipped');
  assert.deepEqual(yg.calls(), []);
  assert.match(decisions(root), /\*\*Ratified:\*\* a-001/);
  assert.doesNotMatch(decisions(root), /Type log/);
});

test('with a graph and a working yg, a ratified area ruling goes into the type log, and replaces there what its predecessor wrote', () => {
  const yg = stub();
  const root = loop({ graph: true });
  const env = { JARL_YG: yg.bin };
  jarl(root, env, 'decide', 'one', 'Every service validates its input.', '--area', 'service', '--reach', '12');
  jarl(root, env, 'close', '--batch');
  const first = json(root, env, 'answer', 'a-001', 'yes');
  assert.deepEqual(first.typeLog, { state: 'written', repo: root, datetime: '2026-09-27T10:00:02.000Z' });
  const [probe, write] = yg.calls();
  assert.deepEqual(probe.args, ['--version']);
  assert.deepEqual(write.args.slice(0, 4), ['log', 'add', '--type', 'service']);
  assert.equal(write.args[4], '--reason-file');
  assert.equal(write.args.length, 6, 'no --supersedes and no --adds: the type log decides whether one is needed');
  assert.match(write.text, /^Every service validates its input\.\n\n\(ratified: one, a-001\)\n$/);
  assert.match(decisions(root), /\*\*Type log:\*\* service · 2026-09-27T10:00:02\.000Z/);
  // A ruling that supersedes one Jarl wrote into the same type log replaces it there too.
  jarl(root, env, 'decide', 'two', 'Services validate with the shared schema.', '--area', 'service', '--reach', '12', '--supersedes', 'one');
  jarl(root, env, 'close', '--batch');
  const second = json(root, env, 'answer', 'a-002', 'ok');
  assert.equal(second.typeLog.state, 'written');
  assert.deepEqual(yg.calls()[3].args.slice(-2), ['--supersedes', '2026-09-27T10:00:02.000Z']);
  // A rejection sends nothing.
  jarl(root, env, 'decide', 'three', 'Not this one.', '--area', 'service', '--reach', '12');
  jarl(root, env, 'close', '--batch');
  jarl(root, env, 'answer', 'a-003', 'nie');
  assert.equal(yg.calls().length, 4);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /one written into the decision log of type service/);
});

test('a write yg refuses is reported, never fatal: the ruling stays in decisions.md, ratified, with no type log', () => {
  const yg = stub('refuse');
  const root = loop({ graph: true });
  const env = { JARL_YG: yg.bin };
  jarl(root, env, 'decide', 'r', 'A rule.', '--area', 'ghost', '--reach', '1');
  jarl(root, env, 'close', '--batch');
  const r = run(root, env, ['answer', 'a-001', 'yes']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /NOT written into the type log: error\[type-not-found\]/);
  assert.match(r.stderr, /note: r stays a ruling of this loop; write it by hand in .*: yg log add --type ghost/);
  assert.match(decisions(root), /\*\*Ratified:\*\* a-001/);
  assert.doesNotMatch(decisions(root), /Type log/);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /r NOT written into the decision log of type ghost/);
});

test('a graph without a working yg writes nothing and says why', () => {
  const yg = stub('dead');
  const root = loop({ graph: true });
  jarl(root, {}, 'decide', 'r', 'A rule.', '--area', 'svc', '--reach', '1');
  jarl(root, {}, 'close', '--batch');
  const out = json(root, { JARL_YG: yg.bin }, 'answer', 'a-001', 'yes');
  assert.equal(out.typeLog.state, 'skipped');
  assert.match(out.typeLog.reason, /no working yg/);
  assert.deepEqual(yg.calls().map((c) => c.args), [['--version']]);
});

test('the whole close with a graph: batch, answers, close — and the loop closes with an item still unanswered', () => {
  const yg = stub();
  const root = loop({ graph: true });
  const env = { JARL_YG: yg.bin };
  jarl(root, env, 'decide', 'wide', 'Handlers never touch the database.', '--area', 'handler', '--reach', '40');
  jarl(root, env, 'decide', 'narrow', 'Jobs retry three times.', '--area', 'job', '--reach', '4');
  const text = jarl(root, env, 'close', '--batch');
  assert.match(text, /^to ratify \(2\)[\s\S]*a-001 · area handler · 40 files · wide[\s\S]*a-002 · area job · 4 files · narrow[\s\S]*nothing closed/);
  jarl(root, env, 'answer', 'a-001', 'yes');
  const closed = json(root, env, 'close');
  assert.equal(closed.closed, true);
  assert.deepEqual(closed.batch.items.map((i) => i.ruling), ['narrow']);
  assert.ok(!existsSync(join(root, '.jarl')));
  assert.deepEqual(yg.calls().filter((c) => c.args[0] === 'log').map((c) => c.args[3]), ['handler']);
});

test('the library never reaches another tool: record.mjs answer hands back the type log entry and writes nothing there', async () => {
  const R = await import('../record.mjs');
  const yg = stub();
  const root = loop({ graph: true });
  jarl(root, {}, 'decide', 'r', 'A rule for every job.', '--area', 'job', '--reach', '7');
  jarl(root, {}, 'close', '--batch');
  const before = process.env.JARL_YG;
  process.env.JARL_YG = yg.bin;
  try {
    const out = R.answer(root, 'a-001', 'yes');
    assert.equal(out.verdict, 'ratified');
    assert.deepEqual(out.typeDecision, { type: 'job', text: 'A rule for every job.\n\n(ratified: r, a-001)', supersedes: null });
    assert.equal(out.typeLog, null);
  } finally {
    if (before === undefined) delete process.env.JARL_YG; else process.env.JARL_YG = before;
  }
  assert.deepEqual(yg.calls(), []);
});

test('the type log is written with the loop lock let go: another writer of the loop does not wait on yg', () => {
  const yg = stub('writer');
  const root = loop({ graph: true });
  const env = { JARL_YG: yg.bin, JARL_TEST_ROOT: root };
  jarl(root, env, 'decide', 'r', 'A rule.', '--area', 'svc', '--reach', '2');
  jarl(root, env, 'close', '--batch');
  assert.equal(json(root, env, 'answer', 'a-001', 'yes').typeLog.state, 'written');
  const meanwhile = yg.calls().find((c) => c.args[0] === 'meanwhile');
  assert.equal(meanwhile.status, 0, meanwhile.stderr);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /meanwhile[\s\S]*r written into the decision log of type svc/);
});

test('what decisions.md holds is checked again before it reaches yg: a bad type is never sent, a bad timestamp never superseded', async () => {
  const { writeAreaDecision } = await import('../yg-edge.mjs');
  const yg = stub();
  const root = mkdtempSync(join(tmpdir(), 'jarl-edge-'));
  mkdirSync(join(root, '.yggdrasil'));
  const before = process.env.JARL_YG;
  process.env.JARL_YG = yg.bin;
  try {
    const bad = writeAreaDecision(root, { type: 'svc" & calc & "', text: 'x', supersedes: null });
    assert.equal(bad.state, 'skipped');
    assert.deepEqual(yg.calls(), []);
    const out = writeAreaDecision(root, { type: 'svc', text: 'x', supersedes: 'unknown' });
    assert.equal(out.state, 'written');
    assert.ok(!yg.calls().some((c) => c.args.includes('--supersedes')));
  } finally {
    if (before === undefined) delete process.env.JARL_YG; else process.env.JARL_YG = before;
  }
});

// On Windows `npx` is npx.cmd, which runs only through cmd.exe: yg-edge.mjs builds that command line itself. A .cmd
// stand-in for yg takes the same road there (a JARL_YG not ending in .js goes through the shell), so the Windows CI
// job runs the real path a user's npx.cmd would take (issue 496).
test('on Windows a .cmd yg runs through the shell and the ratified ruling and its rule reach it intact', { skip: process.platform !== 'win32' && 'the shell road is taken on Windows only' }, () => {
  const yg = stub();
  const cmd = join(yg.bin, '..', 'yg.cmd');
  writeFileSync(cmd, `@echo off\r\n"${process.execPath}" "${yg.bin}" %*\r\n`);
  const root = loop({ graph: true });
  const env = { JARL_YG: cmd, ...gitName('Jane Doe') };
  jarl(root, env, 'decide', 'r', 'Every service validates its input.', '--area', 'service', '--reach', '2', '--rule', 'boundary/validates-input');
  jarl(root, env, 'close', '--batch');
  const out = json(root, env, 'answer', 'a-001', 'yes');
  assert.equal(out.typeLog.state, 'written', JSON.stringify(out.typeLog));
  assert.equal(out.ruleLog.state, 'written', JSON.stringify(out.ruleLog));
  const [write, ratification] = yg.calls().filter((c) => c.args[0] === 'log');
  assert.deepEqual(write.args.slice(0, 5), ['log', 'add', '--type', 'service', '--reason-file']);
  assert.match(write.text, /^Every service validates its input\./);
  assert.deepEqual(ratification.args.slice(0, 8), ['log', 'add', '--aspect', 'boundary/validates-input', '--ratify', '--by', 'Jane Doe', '--reason-file']);
  assert.match(ratification.text, /^Every service validates its input\./);
});

// A ruling that names a rule of the graph (issue 502): the user's yes also ratifies that rule in its own log, naming
// who admitted it — the person git names in the graph's repository — so Yggdrasil's type-law-unratified clears.
function gitName(name) {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-gitcfg-'));
  const file = join(dir, 'gitconfig');
  writeFileSync(file, name ? `[user]\n\tname = ${name}\n` : '');
  return { GIT_CONFIG_GLOBAL: file, GIT_CONFIG_NOSYSTEM: '1' };
}

test('decide --rule names the rule an area ruling admits: it needs --area and a rule id, and the batch item names it', () => {
  const root = loop();
  const out = json(root, {}, 'decide', 'todo', 'No TODO comments in services.', '--area', 'service', '--reach', '12', '--rule', 'no-todo-comments');
  assert.equal(out.rule, 'no-todo-comments');
  assert.match(decisions(root), /\*\*Area:\*\* service\n\*\*Reach:\*\* 12\n\*\*Rule:\*\* no-todo-comments/);
  assert.equal(json(root, {}, 'decisions').find((d) => d.slug === 'todo').rule, 'no-todo-comments');
  assert.match(run(root, {}, ['decide', 'x', 'r', '--rule', 'no-todo-comments']).stderr, /needs --area/);
  for (const bad of ['a/../b', 'x y', 'a"b', '..']) assert.match(run(root, {}, ['decide', 'y', 'r', '--area', 'svc', '--rule', bad]).stderr, /--rule names a rule/);
  assert.equal(json(root, {}, 'decide', 'nested', 'r', '--area', 'svc', '--rule', 'boundary/clean-core').rule, 'boundary/clean-core');
  const item = json(root, {}, 'close', '--batch').batch.items.find((i) => i.ruling === 'todo');
  assert.equal(item.rule, 'no-todo-comments');
  assert.match(item.question, /^area service · rule no-todo-comments · 12 files · todo:/);
  // yg ratifies a rule on every type it reaches, not only the area asked about: the question says so.
  assert.match(item.question, /ratify rule no-todo-comments as it stands now on every type the graph has it reach \(not only service\)/);
  jarl(root, {}, 'decide', 'plain', 'Handlers log once.', '--area', 'handler', '--reach', '3');
  assert.doesNotMatch(json(root, {}, 'close', '--batch').batch.items.find((i) => i.ruling === 'plain').question, /ratify rule|every type/);
});

test('a ratified ruling naming a rule writes the type decision and then the rule ratification, by the person git names', () => {
  const yg = stub();
  const root = loop({ graph: true });
  const env = { JARL_YG: yg.bin, ...gitName('Jane Doe') };
  jarl(root, env, 'decide', 'todo', 'No TODO comments in services.', '--area', 'service', '--reach', '12', '--rule', 'no-todo-comments');
  jarl(root, env, 'close', '--batch');
  const out = json(root, env, 'answer', 'a-001', 'tak');
  assert.equal(out.typeLog.state, 'written');
  assert.deepEqual(out.ruleRatification, { rule: 'no-todo-comments', text: 'No TODO comments in services.\n\n(ratified: todo, a-001)' });
  assert.equal(out.ruleLog.state, 'written');
  assert.equal(out.ruleLog.by, 'Jane Doe');
  const writes = yg.calls().filter((c) => c.args[0] === 'log');
  assert.deepEqual(writes.map((c) => c.args.slice(0, 4)), [['log', 'add', '--type', 'service'], ['log', 'add', '--aspect', 'no-todo-comments']]);
  assert.deepEqual(writes[1].args.slice(4, 8), ['--ratify', '--by', 'Jane Doe', '--reason-file']);
  assert.equal(writes[1].args.length, 9);
  assert.match(writes[1].text, /^No TODO comments in services\.\n\n\(ratified: todo, a-001\)\n$/);
  assert.match(decisions(root), /\*\*Rule log:\*\* no-todo-comments · 2026-09-27T10:00:0\d\.000Z/);
  assert.equal(json(root, env, 'decisions').find((d) => d.slug === 'todo').ruleLog.rule, 'no-todo-comments');
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /todo ratified rule no-todo-comments in its own log · by Jane Doe/);
  // No name in git: the ratification says "the owner" rather than nobody.
  const env2 = { JARL_YG: yg.bin, ...gitName('') };
  jarl(root, env2, 'decide', 'two', 'Another.', '--area', 'service', '--rule', 'no-console');
  jarl(root, env2, 'close', '--batch');
  assert.equal(json(root, env2, 'answer', 'a-002', 'yes').ruleLog.by, 'the owner');
});

test('a rejected ruling, one without a graph and one without --rule send no ratification', () => {
  const yg = stub();
  const root = loop({ graph: true });
  const env = { JARL_YG: yg.bin };
  jarl(root, env, 'decide', 'r', 'A rule.', '--area', 'svc', '--rule', 'no-todo-comments');
  jarl(root, env, 'decide', 'plain', 'No rule named.', '--area', 'svc');
  jarl(root, env, 'close', '--batch');
  jarl(root, env, 'answer', 'a-001', 'nie');
  assert.equal(json(root, env, 'answer', 'a-002', 'yes').ruleLog, null);
  assert.ok(!yg.calls().some((c) => c.args.includes('--aspect')));
  const bare = loop();
  jarl(bare, env, 'decide', 'r', 'A rule.', '--area', 'svc', '--rule', 'no-todo-comments');
  jarl(bare, env, 'close', '--batch');
  const out = json(bare, env, 'answer', 'a-001', 'yes');
  assert.equal(out.ruleLog.state, 'skipped');
  assert.match(out.ruleLog.reason, /no \.yggdrasil\//);
  assert.match(decisions(bare), /\*\*Ratified:\*\* a-001/);
});

test('a ratification yg refuses is reported with the command to run by hand; the type decision and the ruling stand', () => {
  const yg = stub('no-type');
  const root = loop({ graph: true });
  const env = { JARL_YG: yg.bin, ...gitName('Jane Doe') };
  jarl(root, env, 'decide', 'r', 'A rule.', '--area', 'svc', '--rule', 'lonely');
  jarl(root, env, 'close', '--batch');
  const r = run(root, env, ['answer', 'a-001', 'yes']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /written into the type's decision log[\s\S]*rule lonely NOT ratified in its own log: error\[aspect-ratify-no-type\]/);
  assert.match(r.stderr, /note: rule lonely is not ratified in its own log; write it by hand in .*: yg log add --aspect lonely --ratify --by 'Jane Doe'/);
  assert.match(decisions(root), /\*\*Ratified:\*\* a-001/);
  assert.match(decisions(root), /\*\*Type log:\*\* svc/);
  assert.doesNotMatch(decisions(root), /Rule log/);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /r did NOT ratify rule lonely in its own log/);
});
