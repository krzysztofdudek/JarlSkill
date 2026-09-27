// What the tests need from the machine, the same on every OS.
//
// sh: a bash script run in a directory. Windows has no bash on its own, and `bash` on its PATH may be WSL's launcher,
// which runs in another file system; the bash Git for Windows ships beside git is the one used there, found from
// `git --exec-path`. A Windows path spelled into a script (C:\Users\...) has its backslashes turned into slashes,
// which that bash reads as the same path and which it would otherwise take as escapes.
//
// ghStub: a stand-in for gh that records its calls and prints the given runs. It is a node script, not a shell one:
// jarl runs a JARL_GH ending in .mjs with node, so the stub works where a shebang does not.
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

let BASH;
export function bashBin() {
  if (BASH) return BASH;
  if (process.platform !== 'win32') return (BASH = 'bash');
  const exec = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();   // <git>/mingw64/libexec/git-core
  const found = [resolve(exec, '..', '..', '..', 'bin', 'bash.exe'), resolve(exec, '..', '..', '..', 'usr', 'bin', 'bash.exe')].find((p) => existsSync(p));
  if (!found) throw new Error(`no Git for Windows bash beside ${exec}: the tests need it`);
  return (BASH = found);
}
// Git for Windows refuses /dev/null (it reads as nul) as core.excludesFile; a file that does not exist does the same
// job there — no global excludes — and git passes over a missing one silently.
export const NO_EXCLUDES = process.platform === 'win32' ? '.git/no-global-excludes' : '/dev/null';
export const slashed = (script) => (process.platform === 'win32'
  ? script.replace(/\b[A-Za-z]:\\[^\s'"`;&|<>]*/g, (p) => p.replace(/\\/g, '/')).replace(/core\.excludesFile \/dev\/null/g, `core.excludesFile ${NO_EXCLUDES}`)
  : script);
export function sh(cwd, script) {
  return execFileSync(bashBin(), ['-c', slashed(script)], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function ghStub(dir, runs = [{ conclusion: 'success', status: 'completed', databaseId: 7, workflowName: 'CI' }]) {
  const bin = join(dir, 'gh-stub.mjs');
  writeFileSync(bin, [
    "import { appendFileSync } from 'node:fs';",
    'const args = process.argv.slice(2);',
    "if (args[0] === '--version') { console.log('stub'); process.exit(0); }",
    `appendFileSync(${JSON.stringify(join(dir, 'gh-calls'))}, args.join(' ') + '\\n');`,
    `process.stdout.write(${JSON.stringify(`${JSON.stringify(runs)}\n`)});`,
    '',
  ].join('\n'));
  return bin;
}
