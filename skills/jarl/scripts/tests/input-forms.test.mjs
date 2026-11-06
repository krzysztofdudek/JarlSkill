// A refusal of a tool call's input (a root that is not absolute, a field the tool does not take, a value of the wrong
// type, a field left out) ends with the form of that tool's call, each value a placeholder of the closed registry. A list
// filter that names a status, kind or priority the loop does not know is refused with the values it knows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jarl, refuses } from './helpers.mjs';
import { isPlaceholder } from '../jarl-lib.mjs';

const mcp = await import('../jarl-mcp.mjs');

function loopDir() {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-input-forms-'));
  jarl(dir, 'init', 'a goal');
  return dir;
}
const refusal = (fn) => { try { fn(); } catch (e) { return e; } assert.fail('expected a refusal'); };
// The last line of a refusal: `jarl_<tool> {json}`, whose every string is a placeholder or the root given.
function formOf(message, tool, root) {
  const last = message.split('\n').at(-1);
  assert.ok(last.startsWith(`${tool} {`), `${tool}: the refusal ends with its form: ${last}`);
  const fields = JSON.parse(last.slice(tool.length + 1));
  for (const [k, v] of Object.entries(fields)) assert.ok(typeof v === 'boolean' || isPlaceholder(v) || v === root, `${tool}: ${k} is a placeholder, got ${JSON.stringify(v)}`);
  return fields;
}

test('a root that is not absolute is refused with the form of the call and the root as a placeholder', () => {
  const e = refusal(() => mcp.callTool('jarl_new', { title: 't', root: 'some/loop' }));
  assert.equal(e.code, -32602);
  assert.match(e.message, /"root" must be the absolute path/);
  assert.deepEqual(formOf(e.message, 'jarl_new'), { title: '<title>', root: '<loop-root>' });
  assert.deepEqual(formOf(refusal(() => mcp.callTool('jarl_status', { root: '' })).message, 'jarl_status'), { root: '<loop-root>' });
  assert.deepEqual(formOf(refusal(() => mcp.callTool('jarl_decide', { slug: 's', text: 't', by: 'jarl', root: 5 })).message, 'jarl_decide'), { slug: '<slug>', text: '<text>', by: '<who>', root: '<loop-root>' });
});

test('a JARL_ROOT that is not absolute is refused with the form of the call and the root as a placeholder', () => {
  const e = refusal(() => mcp.callTool('jarl_status', {}, { JARL_ROOT: 'rel/loop' }, tmpdir()));
  assert.match(e.message, /^JARL_ROOT must be an absolute path/);
  assert.deepEqual(formOf(e.message, 'jarl_status'), { root: '<loop-root>' });
});

test('a field the tool does not take, a wrong type and a missing argument are refused with the form of the call and the root given', () => {
  const root = loopDir();
  let e = refusal(() => mcp.callTool('jarl_set', { ids: '1', status: 'done', bogus: 1, root }));
  assert.match(e.message, /unknown field "bogus"/);
  assert.deepEqual(formOf(e.message, 'jarl_set', root), { ids: '<ids>', status: '<status>', root });
  e = refusal(() => mcp.callTool('jarl_decisions', { live: 'true', root, json: true }));
  assert.match(e.message, /"live" must be true or false/);
  assert.deepEqual(formOf(e.message, 'jarl_decisions', root), { root, json: true });
  e = refusal(() => mcp.callTool('jarl_field', { name: 'After', clear: true, root }));
  assert.match(e.message, /"ids" is required/);
  assert.deepEqual(formOf(e.message, 'jarl_field', root), { ids: '<ids>', name: '<name>', root });
  e = refusal(() => mcp.callTool('jarl_help', { bogus: 1 }));
  assert.match(e.message, /unknown field "bogus"/);
  assert.deepEqual(formOf(e.message, 'jarl_help'), {});
});

test('a refusal that names the field a value belongs in carries one form, not two', () => {
  const root = loopDir();
  const e = refusal(() => mcp.callTool('jarl_set', { ids: '1', status: 'deferred', why: 'later', root }));
  assert.equal(e.message.split('jarl_set {').length, 2, e.message);
});

test('the server answers a refused input with the form in the error message', () => {
  const answered = mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'jarl_status', arguments: { root: 'rel' } } });
  assert.equal(answered.error.code, -32602);
  assert.match(answered.error.message, /\njarl_status \{"root":"<loop-root>"\}$/);
});

test('list refuses a status, a kind and a priority the loop does not know, naming the values it knows', () => {
  const root = loopDir();
  jarl(root, 'new', 'a thing', '--kind', 'gap', '--prio', '1');
  assert.equal(refuses(root, 'list', '--status', 'bogus').trim(), '--status must be one of: open, in-progress, done, dropped, deferred (got "bogus")\njarl.mjs list --status "<status>"');
  assert.equal(refuses(root, 'list', '--kind', 'task').trim(), '--kind must be one of: bug, gap, cleanup, docs, test, research, process, promise, wait (got "task")\njarl.mjs list --kind "<kind>"');
  assert.equal(refuses(root, 'list', '--prio', '7').trim(), '--prio must be one of: 1, 2, 3 (got "7")\njarl.mjs list --prio "<prio>"');
  assert.match(jarl(root, 'list', '--status', 'done'), /^\(none\)$/);
  assert.match(jarl(root, 'list', '--kind', 'gap', '--prio', '1'), /a thing/);
  const said = mcp.callTool('jarl_list', { status: 'bogus', root });
  assert.ok(said.isError);
  assert.match(said.content[0].text, /^--status must be one of: open, /);
});
