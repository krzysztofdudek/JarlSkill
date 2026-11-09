// Run by tests/jarl-root-isolation.test.mjs in a process whose environment exports JARL_ROOT: it loads the shared test
// helpers, as every test file does, then makes calls that name no loop from the checkout its argument names, the way the
// test files make them: the command line spawned with the inherited environment, a POSIX shell that runs it, and a tool
// call of the server in this process. It prints what it saw as JSON.
import { spawnSync } from 'node:child_process';
import { SCRIPT, SPAWN_TIMEOUT } from '../helpers.mjs';
import * as mcp from '../../jarl-mcp.mjs';

const cwd = process.argv[2];
const spawned = spawnSync(process.execPath, [SCRIPT, 'new', 'filed by a spawned call', '--by', 'jarl'], { cwd, encoding: 'utf8', timeout: SPAWN_TIMEOUT });
const shell = process.platform === 'win32' ? null : spawnSync('/bin/sh', ['-c', `"$0" "$1" new 'filed through a shell' --by jarl`, process.execPath, SCRIPT], { cwd, encoding: 'utf8', timeout: SPAWN_TIMEOUT });
const tool = mcp.callTool('jarl_new', { title: 'filed by a tool call', by: 'jarl' }, process.env, cwd, { root: null });
process.stdout.write(JSON.stringify({ inherited: process.env.JARL_ROOT ?? null, spawned: spawned.status, shell: shell ? shell.status : null, tool: tool.isError }));
