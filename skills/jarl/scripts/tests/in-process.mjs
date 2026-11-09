// The command line run inside this process: the words a process would be given, its answer as the result of a spawn
// ({ status, stdout, stderr, signal }), each stream as written. A test that makes many calls pays for one start of node
// instead of one per call; everything from the reading of the words to what is printed and the status is the same code,
// `cliMain`, that a process runs, and tests/in-process.test.mjs holds the two alike on a range of calls. A test that needs
// a process of its own (an environment or a timeout of its own, a hung child, what a shell starts) spawns one.
//
// Only one call runs at a time, as the test files of the suite run their calls one after another: while it runs the
// console and process.exit are the call's, and with `cwd` so is the working directory.
//
// A call has a time limit, as a spawned process does, and one that overruns it fails the test instead of hanging it: the
// code runs under a vm timeout, which stops even a loop that never yields, and each child it starts is given the same limit.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { format } from 'node:util';
import vm from 'node:vm';
import { cliMain } from '../jarl.mjs';

class Exit extends Error {
  constructor(code) { super(`exit ${code}`); this.code = code; }
}

const LIMIT_MS = 120_000;
const CALL = Symbol.for('jarl.in-process.call');
const UNDER_LIMIT = new vm.Script("globalThis[Symbol.for('jarl.in-process.call')]()", { filename: 'in-process-call' });
// Jarl starts every child through execFileSync (a live binding, so this reaches it). Outside a call it is left as it is.
let childLimit = null;
let childOverran = false;
const execFileSyncAlone = childProcess.execFileSync;
childProcess.execFileSync = (file, args, options) => {
  if (childLimit === null || options?.timeout !== undefined) return execFileSyncAlone(file, args, options);
  try { return execFileSyncAlone(file, args, { ...options, timeout: childLimit }); } catch (e) {
    if (e.code === 'ETIMEDOUT') childOverran = true;
    throw e;
  }
};
syncBuiltinESMExports();

export function runInProcess(words, { cwd, timeout = LIMIT_MS, main = cliMain } = {}) {
  const out = [];
  const err = [];
  const saved = { log: console.log, error: console.error, exit: process.exit, stdout: process.stdout.write, stderr: process.stderr.write, here: process.cwd() };
  console.log = (...a) => { out.push(`${format(...a)}\n`); };
  console.error = (...a) => { err.push(`${format(...a)}\n`); };
  process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
  process.exit = (code = 0) => { throw new Exit(code); };
  if (cwd !== undefined) process.chdir(cwd);
  let status = 0;
  let overran = false;
  childLimit = timeout;
  childOverran = false;
  globalThis[CALL] = () => main(words.map(String));
  try {
    UNDER_LIMIT.runInThisContext({ timeout });
  } catch (e) {
    if (e instanceof Exit) status = e.code;
    else if (e?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') overran = true;
    else { err.push(`${e?.stack ?? e}\n`); status = 1; }   // an exception nothing caught: a process prints it and exits with 1
  } finally {
    childLimit = null;
    delete globalThis[CALL];
    console.log = saved.log;
    console.error = saved.error;
    process.exit = saved.exit;
    process.stdout.write = saved.stdout;
    process.stderr.write = saved.stderr;
    if (cwd !== undefined) process.chdir(saved.here);
  }
  if (overran || childOverran) throw new Error(`jarl ${words.join(' ')} did not end within ${timeout} ms`);
  return { status, stdout: out.join(''), stderr: err.join(''), signal: null };
}
