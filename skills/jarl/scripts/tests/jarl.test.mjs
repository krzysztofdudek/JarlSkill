import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync, readdirSync, rmSync, symlinkSync, renameSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { sh, NO_EXCLUDES } from './portable.mjs';
import { run, jarl, refuses, gitRepo, SPAWN_TIMEOUT } from './helpers.mjs';
import { fileURLToPath } from 'node:url';
import { FINDINGS } from './findings.mjs';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const { JARL_GITIGNORE_COMMITTED, mainCheckoutOf, worktreeState } = await import(new URL('../jarl.mjs', import.meta.url).href);

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-'));
  mkdirSync(join(dir, '.git'));
  return dir;
}

test('init, new, list, show', () => {
  const root = repo();
  jarl(root, 'init', 'make the export command handle every fixture');
  assert.ok(existsSync(join(root, '.jarl', 'goal.md')));
  const a = JSON.parse(jarl(root, 'new', 'parser refuses fixture three', '--kind', 'bug', '--prio', '1', '--tags', 'parser', '--files', 'src/parser.mjs', '--json'));
  const b = JSON.parse(jarl(root, 'new', 'docs promise a flag that does not exist', '--kind', 'docs', '--json'));
  assert.equal(a.id, '1'); assert.equal(b.id, '2');
  const rows = JSON.parse(jarl(root, 'list', '--json'));
  assert.deepEqual(rows.map((r) => r.id), ['1', '2']);
  assert.equal(JSON.parse(jarl(root, 'list', '--tag', 'parser', '--json')).length, 1);
  assert.equal(JSON.parse(jarl(root, 'list', '--grep', 'flag that does not', '--json')).length, 1);
  assert.match(jarl(root, 'show', '1'), /^# 1 · parser refuses fixture three/);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /filed 1/);
});

test('slugify keeps the letters NFKD does not decompose: ł, ø, ß and the like become their plain-Latin spelling, not a hole', async () => {
  const { slugify } = await import(new URL('../jarl.mjs', import.meta.url).href);
  assert.equal(slugify('gałęzi całą dosłownie'), 'galezi-cala-doslownie');
  assert.equal(slugify('Øresund straße'), 'oresund-strasse');
  assert.equal(slugify('Ærø đường þing'), 'aero-duong-thing');
  assert.equal(slugify('plain ASCII stays'), 'plain-ascii-stays');
  assert.equal(slugify('ł'), 'l');
});

test('slugify cuts at 60 characters and then trims dashes: no name starts or ends with a dash', async () => {
  const { slugify } = await import(new URL('../jarl.mjs', import.meta.url).href);
  // The 60th character of this slug is the dash after "is": cutting before trimming left it at the end.
  const cut = slugify('Jarl: an issue file name can end in a dash when the title is cut at 60 characters');
  assert.equal(cut, 'jarl-an-issue-file-name-can-end-in-a-dash-when-the-title-is');
  assert.equal(cut.length, 59);
  // The 60th character is punctuation that becomes a dash, and a title that is all punctuation falls back.
  assert.equal(slugify(`${'a'.repeat(59)}, and then more words`), 'a'.repeat(59));
  assert.equal(slugify(`${'a'.repeat(60)} tail`), 'a'.repeat(60));
  assert.equal(slugify('--- !!! ---'), 'issue');
  for (const t of ['x '.repeat(40), 'ab cd '.repeat(20), '.'.repeat(70) + ' ok']) assert.doesNotMatch(slugify(t), /^-|-$/);
});

test('new refuses a text that holds a matched pair named after one of its own fields, outside code, and body does too', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  const pair = '<what>the thing</what><why>because</why><prio>1</prio>';
  assert.match(refuses(root, 'new', 't', '--what', pair), /the What text holds a <what>…<\/what> pair: a field goes in its own parameter \(--what\)/);
  assert.match(refuses(root, 'new', 't', '--why', 'because <acceptance>\n- it works\n</acceptance>'), /the Why text holds a <acceptance>…<\/acceptance> pair.*\(--acceptance\)/);
  assert.match(refuses(root, 'new', 't', '--what', 'fine', '--why', '<TAGS>a,b</Tags>'), /<tags>…<\/tags>/);
  assert.equal(readdirSync(join(root, '.jarl', 'issues')).length, 0, 'nothing was written');
  jarl(root, 'new', 'ok', '--what', 'fine');
  assert.match(refuses(root, 'body', '1', '--why', '<files>a.mjs</files>'), /the Why text holds a <files>…<\/files> pair.*\(--files\)/);
  assert.match(refuses(root, 'body', '1', '--what', pair), /the What text holds a <what>/);
  assert.doesNotMatch(readFileSync(join(root, '.jarl', 'issues', '1-ok.md'), 'utf8'), /<files>/);
});

test('a lone tag, a pair in a code span and a pair in a fenced block are accepted, and so is the text of an issue heading', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'lone', '--what', 'a lone <why> and a closing </what> are text');
  jarl(root, 'new', 'span', '--what', 'the tags `<why>` and `</why>` are named, or `<why>x</why>` whole');
  jarl(root, 'new', 'fence', '--what', 'see:\n```\n<what>the thing</what>\n<why>because</why>\n```\nand\n~~~~\n<tags>a</tags>\n~~~~\nend');
  const own = 'A caller whose tool call carried every field inside the What parameter got tickets with no tags. The refusal must not catch a tag that is quoted, because this issue names such tags in code spans (`<what>`, `<why>`, `<prio>`); so only a matched opening and closing pair of a field name, outside code, is refused.';
  jarl(root, 'new', 'own', '--what', own);
  assert.equal(readdirSync(join(root, '.jarl', 'issues')).length, 4);
});

test('the reply of new keeps its first line, then lists what was parsed and each empty field with the command that fills it', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  const bare = jarl(root, 'new', 'bare').split('\n');
  assert.match(bare[0], /^filed 1 · .*1-bare\.md$/);
  assert.match(bare[1], /^parsed: priority 2 · tier standard · kind bug · tags \(none\) · 0 acceptance lines · What 0 characters · Why 0 characters$/);
  for (const [field, command] of [['why', 'body 1 --why'], ['acceptance', 'body 1 --acceptance'], ['files', 'files 1 p,q'], ['after', 'after 1 <ids>'], ['where', 'body 1 --where']]) {
    assert.ok(bare[2].includes(`${field} (jarl.mjs ${command}`), `${field} is named with ${command}`);
  }
  const full = jarl(root, 'new', 'full', '--what', 'seven', '--why', 'yy', '--acceptance', 'a', '--acceptance', 'b', '--prio', '1', '--tags', 'x,y', '--files', 'a.mjs', '--where', 'here', '--after', '1').split('\n');
  assert.match(full[1], /priority 1 · tier standard · kind bug · tags x,y · 2 acceptance lines · What 5 characters · Why 2 characters/);
  assert.equal(full.length, 2, 'nothing is left empty');
  const json = JSON.parse(jarl(root, 'new', 'j', '--json'));
  assert.equal(json.id, '3');
  assert.deepEqual(json.empty.map((e) => e.field), ['why', 'acceptance', 'files', 'after', 'where']);
  assert.equal(json.parsed.tags.length, 0);
});

test('new from a linked worktree of a committed loop is refused and names the main checkout; on the main checkout the number is the highest over every worktree', () => {
  const root = repo();
  rmSync(join(root, '.git'), { recursive: true, force: true });
  const wt = `${root}-wt`;
  sh(root, 'git init -q -b feature && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null && echo a > a.txt && git add -A && git commit -qm base');
  jarl(root, 'init', 'goal', '--committed');
  jarl(root, 'new', 'first');
  sh(root, `git add -A && git commit -qm loop && git worktree add -q -b w1 ${wt}`);
  // The main checkout moves on by two issues; the worktree keeps the copy it was cut with.
  jarl(root, 'new', 'second'); jarl(root, 'new', 'third');
  assert.deepEqual(readdirSync(join(wt, '.jarl', 'issues')), ['1-first.md']);
  const said = refuses(wt, 'new', 'from the worktree');
  assert.match(said, /is a linked worktree of .*, which holds this loop/);
  assert.ok(said.includes(basename(root)), 'it names the main checkout as the root to pass');
  assert.deepEqual(readdirSync(join(wt, '.jarl', 'issues')), ['1-first.md'], 'nothing was written');
  // A worktree copy that holds a higher number (999 here) than the main checkout counts: the next number is 1000.
  const high = join(wt, '.jarl', 'issues', '999-high.md');
  writeFileSync(high, '# 999 · high\n\n**Status:** open\n**Kind:** task\n**Priority:** 2\n**Tier:** standard\n\n## What\nx\n');
  const made = JSON.parse(jarl(root, 'new', 'after the high one', '--json'));
  assert.equal(made.id, '1000');
  assert.match(made.file, /1000-after-the-high-one\.md$/);
  // Without the worktree's higher copy the main checkout files the next number as always.
  const plain = repo();
  jarl(plain, 'init', 'goal');
  assert.equal(JSON.parse(jarl(plain, 'new', 'a', '--json')).id, '1');
});

test('the main checkout is found through git by one helper: a linked worktree knows its main checkout and every copy of the loop', () => {
  const root = repo();
  rmSync(join(root, '.git'), { recursive: true, force: true });
  const wt = `${root}-wt2`;
  sh(root, 'git init -q -b feature && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null && echo a > a.txt && git add -A && git commit -qm base');
  sh(root, `git worktree add -q -b w2 ${wt}`);
  const here = mainCheckoutOf(root);
  const there = mainCheckoutOf(wt);
  assert.equal(here.linked, false);
  assert.equal(there.linked, true);
  assert.equal(there.main, here.main);
  assert.equal(there.mainRoot, here.mainRoot);
  assert.equal(there.copies.length, 2);
  assert.equal(mainCheckoutOf(mkdtempSync(join(tmpdir(), 'jarl-nogit-'))), null);
});

test('dropping an issue keeps the evidence already written, and the report prints only the reason', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'thing that goes away');
  jarl(root, 'evidence', '1', 'tried a fix, saw it hang');
  jarl(root, 'set', '1', 'dropped', 'the client said not now');
  const shown = jarl(root, 'show', '1');
  assert.match(shown, /tried a fix, saw it hang/, 'the evidence written before the drop is still there');
  assert.match(shown, /Dropped: the client said not now/);
  const report = jarl(root, 'report');
  assert.match(report, /## Dropped \(1\)\n- 1 thing that goes away — the client said not now/);
  assert.doesNotMatch(report, /tried a fix/, 'the report carries the reason, not the notes');
  // An issue with no evidence yet reads the same as before.
  jarl(root, 'new', 'never started');
  jarl(root, 'set', '2', 'dropped', 'duplicate of 1');
  assert.match(jarl(root, 'report'), /- 2 never started — duplicate of 1/);
});

test('deferred is its own status: it needs a reason, stays out of the default list, is counted apart and reported apart', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'waits for the client');
  jarl(root, 'new', 'still to do');
  jarl(root, 'new', 'gone for good');
  assert.match(refuses(root, 'set', '1', 'deferred'), /deferred needs a reason/);
  jarl(root, 'evidence', '1', 'half a fix on a branch');
  jarl(root, 'set', '1', 'deferred', 'the client wants to decide first');
  jarl(root, 'set', '3', 'dropped', 'duplicate');
  // Not in the default list, in --status deferred and in --all.
  assert.doesNotMatch(jarl(root, 'list'), /waits for the client/);
  assert.match(jarl(root, 'list', '--status', 'deferred'), /waits for the client/);
  assert.match(jarl(root, 'list', '--all'), /waits for the client/);
  // Counted apart from open and dropped.
  const status = JSON.parse(jarl(root, 'status', '--json'));
  assert.equal(status.deferred, 1);
  assert.equal(status.dropped, 1);
  assert.equal(status.open, 1);
  assert.match(jarl(root, 'status'), /deferred 1/);
  // Reported apart, with the reason, and the evidence already written stays.
  const report = jarl(root, 'report');
  assert.match(report, /## Deferred \(1\)\n- 1 waits for the client — the client wants to decide first/);
  assert.match(report, /## Dropped \(1\)\n- 3 gone for good — duplicate/);
  assert.match(jarl(root, 'show', '1'), /half a fix on a branch/);
  // A loop with only deferred work left is closed by --force, and names the deferred issues it removed.
  jarl(root, 'set', '2', 'dropped', 'no longer needed');
  const closed = JSON.parse(jarl(root, 'close', '--force', '--json'));
  assert.deepEqual(closed.deferred, ['1']);
});

// In the default mode the loop lives in the main checkout and a worktree cannot see it. The tool used to need
// `--root <main checkout>` from every worktree; now a run in a worktree of a repository whose main checkout
// holds a loop finds that loop by itself, and an explicit --root still wins.
function gitRepoWithWorktree() {
  const main = mkdtempSync(join(tmpdir(), 'jarl-main-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', timeout: SPAWN_TIMEOUT }).trim();
  git(main, 'init', '-q', '-b', 'feature');
  writeFileSync(join(main, 'a.txt'), 'a\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'init');
  const wt = join(mkdtempSync(join(tmpdir(), 'jarl-wt-')), 'worker');
  git(main, 'worktree', 'add', '-q', '-b', 'jarl/1-thing', wt);
  return { main, wt, git };
}
const jarlIn = (cwd, ...args) => execFileSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: SPAWN_TIMEOUT }).trim();

test('a run in a worktree finds the loop in the main checkout by itself, and an explicit --root still wins', () => {
  const { main, wt, git } = gitRepoWithWorktree();
  jarl(main, 'init', 'goal');
  jarl(main, 'new', 'thing to fix');
  // No --root: the worktree has no .jarl/ of its own, the main checkout does.
  assert.match(jarlIn(wt, 'list'), /thing to fix/);
  assert.equal(JSON.parse(jarlIn(wt, 'show', '1', '--json')).title, 'thing to fix');
  jarlIn(wt, 'evidence', '1', 'ran it in the worktree');
  assert.match(jarl(main, 'show', '1'), /ran it in the worktree/, 'the write landed in the main checkout\'s loop');
  // check and branches read the repository from there too.
  git(wt, 'commit', '-q', '--allow-empty', '-m', 'worker change');
  assert.match(jarlIn(wt, 'branches'), /jarl\/1-thing/);
  const checked = JSON.parse(jarlIn(wt, 'check', '1', '--branch', 'jarl/1-thing', '--json'));
  assert.match(checked.items.find((i) => i.name === 'commits beyond base').note, /1 commit\(s\) on jarl\/1-thing beyond/);
  // Explicit --root wins, even one that has no loop.
  const elsewhere = repo();
  assert.match(String(refuses(elsewhere, 'new', 'x')), /no \.jarl\//);
  assert.match(execFileSync(process.execPath, [SCRIPT, 'list', '--root', main], { cwd: wt, encoding: 'utf8', timeout: SPAWN_TIMEOUT }), /thing to fix/);
  // A worktree of a repository whose main checkout has no loop still says so plainly.
  const bare = gitRepoWithWorktree();
  assert.throws(() => execFileSync(process.execPath, [SCRIPT, 'new', 'x'], { cwd: bare.wt, encoding: 'utf8', stdio: 'pipe', timeout: SPAWN_TIMEOUT }), (e) => /no \.jarl\//.test(String(e.stderr)));
});

test('a directory or a file inside a repository names that repository, a stored path into a subdirectory is refused, and the Repo field can be cleared', () => {
  const parent = mkdtempSync(join(tmpdir(), 'jarl-repo-'));
  const hub = join(parent, 'hub'); const tool = join(parent, 'tool');
  mkdirSync(hub); mkdirSync(join(tool, 'src'), { recursive: true });
  const setup = (b) => `git init -q -b ${b} && git config user.email t@t && git config user.name t`;
  sh(hub, `${setup('main')} && echo notes > notes.md && git add -A && git commit -qm base`);
  sh(tool, `${setup('feature')} && echo 'x' > src/a.mjs && git add -A && git commit -qm base`);
  jarl(hub, 'init', 'goal');
  jarl(hub, 'new', 'change a', '--files', 'src/a.mjs');
  // A subdirectory or a file given for a repository is reduced to the repository's main checkout wherever a repository is
  // named, so its paths are never read from the wrong place.
  assert.equal(jarl(hub, 'repo', '1', '../tool/src'), '1 repo: tool');
  assert.equal(jarl(hub, 'repo', '1', '../tool/src/a.mjs'), '1 repo: tool (unchanged)');
  jarl(hub, 'new', 'other', '--repo', '../tool/src');
  assert.match(jarl(hub, 'show', '2'), /^\*\*Repo:\*\* tool$/m);
  assert.deepEqual(JSON.parse(jarl(hub, 'branches', '--repo', '../tool/src', '--json')), []);
  assert.doesNotMatch(run(hub, ['check', '1', '--branch', 'feature', '--repo', '../tool/src']).stderr, /not its root/);
  // A path stored into a subdirectory (written by hand) is not a repository's root: refused, naming the root to give.
  const issueFile = join(hub, '.jarl', 'issues', readdirSync(join(hub, '.jarl', 'issues')).find((f) => f.startsWith('1-')));
  writeFileSync(issueFile, readFileSync(issueFile, 'utf8').replace(/^\*\*Repo:\*\* .*$/m, '**Repo:** ../tool/src'));
  assert.match(refuses(hub, 'check', '1', '--branch', 'feature'), /is inside the repository at .*tool, not its root — name the root: \.\.\/tool/);
  // The root itself is fine, and the field can be cleared again.
  jarl(hub, 'repo', '1', '../tool');
  assert.match(jarl(hub, 'show', '1'), /^\*\*Repo:\*\* tool$/m);
  assert.match(jarl(hub, 'repo', '1', '--clear'), /1 repo: cleared/);
  assert.doesNotMatch(jarl(hub, 'show', '1'), /\*\*Repo:\*\*/);
  assert.match(refuses(hub, 'repo', '1', '--clear'), /no Repo field/);
});

// Files are compared as (repository, path) pairs; three ways the pair used to be read wrongly, each silently.
test('the repository name in Files: --repo strips it like the field does, an inner directory of the same name is not stripped, and a repository is one repository however its path is spelled', () => {
  const parent = mkdtempSync(join(tmpdir(), 'jarl-name-'));
  const hub = join(parent, 'hub'); const tool = join(parent, 'tool'); const app = join(parent, 'app');
  mkdirSync(hub); mkdirSync(join(tool, 'src'), { recursive: true }); mkdirSync(join(app, 'app'), { recursive: true });
  const setup = (b) => `git init -q -b ${b} && git config user.email t@t && git config user.name t`;
  sh(hub, `${setup('main')} && echo notes > notes.md && git add -A && git commit -qm base`);
  sh(tool, `${setup('feature')} && echo x > src/a.mjs && git add -A && git commit -qm base`);
  sh(app, `${setup('feature')} && echo x > app/x.mjs && git add -A && git commit -qm base`);
  sh(tool, `git worktree add -q -b jarl/1-a ${parent}/wt-1 && cd ${parent}/wt-1 && echo y > src/a.mjs && git commit -qam change`);
  jarl(hub, 'init', 'goal');

  // 1. `check --repo` on an issue with no Repo field strips the name as the field would: tool/src/a.mjs is src/a.mjs.
  jarl(hub, 'new', 'change a', '--files', 'tool/src/a.mjs');
  const byRepoFlag = JSON.parse(jarl(hub, 'check', '1', '--branch', 'jarl/1-a', '--repo', '../tool', '--json'));
  const scope = byRepoFlag.items.find((i) => i.name === 'diff inside declared files');
  assert.equal(scope.ok, true, scope.note);

  // 2. In a repository that has a directory of its own name, the prefix is required: `app/app/x.mjs` is app/x.mjs
  // inside the repository app, and `app/x.mjs` already IS that path, so the two meet in next instead of passing.
  jarl(hub, 'new', 'first on app/x', '--files', 'app/app/x.mjs', '--repo', '../app');
  jarl(hub, 'new', 'second on app/x', '--files', 'app/x.mjs', '--repo', '../app');
  jarl(hub, 'set', '2', 'in-progress', 'worker raised');
  const next = JSON.parse(jarl(hub, 'next', '--all', '--json'));
  assert.deepEqual(next.find((r) => r.id === '3').waitsOn, ['app/x.mjs'], 'the same file in one repository always holds an issue back');

  // 3. One repository however its path is spelled: through a symlink, and (where the file system ignores case) in
  // another case.
  const spellings = ['../link'];
  symlinkSync(tool, join(parent, 'link'), 'junction');   // a junction on Windows: no privilege needed
  if (existsSync(join(parent, 'TOOL'))) spellings.push('../TOOL');
  jarl(hub, 'new', 'holds src/a.mjs', '--files', 'tool/src/b.mjs', '--repo', '../tool');
  jarl(hub, 'set', '4', 'in-progress', 'worker raised');
  spellings.forEach((spelling, k) => {
    const id = String(5 + k);
    jarl(hub, 'new', `spelled ${spelling}`, '--files', `${spelling.replace('../', '')}/src/b.mjs`, '--repo', spelling);
    const row = JSON.parse(jarl(hub, 'next', '--all', '--json')).find((r) => r.id === id);
    assert.ok(row && row.waitsOn, `${spelling}: the same repository, so the same file, so it waits`);
  });
});

test('status moves only with a log line; done needs evidence; dropped needs a reason', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'thing');
  assert.match(refuses(root, 'set', '1', 'done'), /no evidence yet/);
  assert.match(refuses(root, 'set', '1', 'dropped'), /needs a reason/);
  jarl(root, 'set', '1', 'in-progress', 'worker raised');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', '12 pass, 0 fail');
  assert.match(refuses(root, 'set', '1', 'done'), /no approving review/);
  jarl(root, 'review', '1', 'changes', '--by', 'rev', 'Important: the new test never goes red');
  assert.match(refuses(root, 'set', '1', 'done'), /no approving review/);
  jarl(root, 'review', '1', 'approve', '--by', 'rev', 'read the diff; test red before, green after');
  jarl(root, 'set', '1', 'done');
  const log = readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
  assert.match(log, /1 → in-progress · worker raised/);
  assert.match(log, /1 → done/);
  assert.match(readFileSync(join(root, '.jarl', 'issues', '1-thing.md'), 'utf8'), /\*\*Status:\*\* done/);
  assert.match(refuses(root, 'set', '1', 'verified'), /status must be one of/);
});

test('tags, priority and next respect file overlap', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'one', '--files', 'a.mjs', '--prio', '3');
  jarl(root, 'new', 'two', '--files', 'a.mjs,b.mjs', '--prio', '1');
  jarl(root, 'new', 'three', '--files', 'c.mjs');
  jarl(root, 'tag', '1', '+parser', '+docs', '-parser');
  assert.match(jarl(root, 'show', '1'), /\*\*Tags:\*\* docs/);
  jarl(root, 'prio', '3', '1');
  const next = JSON.parse(jarl(root, 'next', '--all', '--json'));
  assert.deepEqual(next.filter((r) => r.ready).map((r) => r.id), ['2', '3']);
  assert.deepEqual(next.find((r) => r.id === '1').waitsOn, ['a.mjs']);
  jarl(root, 'set', '2', 'in-progress', 'raised');
  assert.deepEqual(JSON.parse(jarl(root, 'next', '--json')).filter((r) => r.ready).map((r) => r.id), ['3']);
});

test('decide refuses a duplicate slug; close refuses while open, removes when clean', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'decide', 'no-new-constants', 'every number needs an origin');
  assert.match(refuses(root, 'decide', 'no-new-constants', 'again'), /duplicate slug/);
  jarl(root, 'new', 'thing');
  assert.match(refuses(root, 'close'), /still open/);
  jarl(root, 'set', '1', 'dropped', 'out of scope');
  assert.match(jarl(root, 'status'), /dropped 1/);
  jarl(root, 'close');
  assert.equal(existsSync(join(root, '.jarl')), false);
});

test('tier field, rounds and takeover, asks and answers, handoff, report', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  assert.match(refuses(root, 'new', 'x', '--tier', 'huge'), /--tier must be one of/);
  jarl(root, 'new', 'hard thing', '--tier', 'strong', '--found-by', 'tester, running the suite');
  assert.match(jarl(root, 'show', '1'), /\*\*Tier:\*\* strong/);
  assert.match(jarl(root, 'round', '1', 'suite red'), /round 1 of 3/);
  jarl(root, 'round', '1', 'still red');
  const r = JSON.parse(jarl(root, 'round', '1', 'red again', '--json'));
  assert.equal(r.takeover, true);
  assert.match(r.block, /attempted issue 1 3 times/);
  const a = JSON.parse(jarl(root, 'ask', 'keep the old flag?', '--issue', '1', '--json'));
  assert.equal(a.id, '1');
  assert.match(jarl(root, 'status'), /questions 1/);
  jarl(root, 'answer', 'a-1', 'yes, keep it');
  assert.match(readFileSync(join(root, '.jarl', 'decisions.md'), 'utf8'), /ask-1[\s\S]*yes, keep it/);
  assert.match(refuses(root, 'answer', '1', 'again'), /already answered/);
  assert.doesNotMatch(jarl(root, 'handoff', 'read'), /Earlier handoff/, 'no handoff file: nothing shown as history');
  jarl(root, 'set', '1', 'in-progress', 'raised');
  const h = jarl(root, 'resume');
  assert.match(h, /## In flight \(1\)\n- 1 hard thing/);
  assert.match(h, /## Rulings in force \(1\)\n- \S+ · ask-1 · by owner — \*\*Question:\*\* keep the old flag\?/);
  const rep = jarl(root, 'report');
  assert.doesNotMatch(rep, /Found along the way/, 'the found section is opt-in');
  assert.match(jarl(root, 'report', '--found'), /Found along the way \(1\)/);
});

test('check reads a worker branch: commits, declared files, removed tests, assertions', () => {
  const root = repo();
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: SPAWN_TIMEOUT }).trim();
  rmSync(join(root, '.git'), { recursive: true, force: true });
  g('init', '-q', '-b', 'feature');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'tests'));
  sh(root, `echo 'export const a = 1;' > src/a.mjs && printf 'assert.equal(1,1);\\nassert.equal(2,2);\\n' > tests/a.test.mjs && git add -A && git commit -qm base`);
  jarl(root, 'init', 'goal', '--committed');
  jarl(root, 'new', 'change a', '--files', 'src/a.mjs,tests/a.test.mjs');
  sh(root, `git add -A && git commit -qm jarl && git checkout -qb jarl/1-change-a && echo 'export const a = 2;' > src/a.mjs && printf 'assert.equal(1,1);\\n' > tests/a.test.mjs && echo x > src/b.mjs && echo '- entry' >> CHANGELOG.md && echo 'export {};' > tests/new.test.mjs && git add -A && git commit -qm work && git checkout -q feature`);
  let out;
  try { jarl(root, 'check', '1', '--branch', 'jarl/1-change-a', '--base', 'feature', '--json'); } catch (e) { out = JSON.parse(e.stdout); }
  assert.equal(out.ok, false);
  const byName = Object.fromEntries(out.items.map((i) => [i.name, i]));
  assert.equal(byName['commits beyond base'].ok, true);
  assert.match(byName['diff inside declared files'].note, /src\/b\.mjs/);
  assert.doesNotMatch(byName['diff inside declared files'].note, /CHANGELOG|new\.test/, 'changelog and tests are never outside scope');
  assert.equal(byName['assertions in touched tests'].note, '2 → 1');
  assert.equal(byName['test files'].ok, true);
});

test('check matches a declared file relative to a subdirectory, not just the repo root', () => {
  const root = repo();
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: SPAWN_TIMEOUT }).trim();
  rmSync(join(root, '.git'), { recursive: true, force: true });
  g('init', '-q', '-b', 'feature');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  mkdirSync(join(root, 'skills', 'x'), { recursive: true });
  sh(root, `echo one > skills/x/SKILL.md && git add -A && git commit -qm base`);
  jarl(root, 'init', 'goal', '--committed');
  jarl(root, 'new', 'change the skill body', '--files', 'SKILL.md');
  sh(root, `git add -A && git commit -qm jarl && git checkout -qb jarl/1-change-the-skill-body && echo two > skills/x/SKILL.md && git add -A && git commit -qm work && git checkout -q feature`);
  const out = JSON.parse(jarl(root, 'check', '1', '--branch', 'jarl/1-change-the-skill-body', '--base', 'feature', '--json'));
  const byName = Object.fromEntries(out.items.map((i) => [i.name, i]));
  assert.equal(byName['diff inside declared files'].ok, true, byName['diff inside declared files'].note);
});

test('a round after an approve spends the approve', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'thing');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'suite green');
  jarl(root, 'review', '1', 'approve', '--by', 'rev', FINDINGS);
  jarl(root, 'round', '1', 'merger: suite red after merge');
  assert.match(refuses(root, 'set', '1', 'done'), /no approving review/);
  assert.match(refuses(root, 'review', '1', 'maybe', 'x'), /approve\|changes/);
  jarl(root, 'review', '1', 'approve', '--by', 'rev', FINDINGS);
  jarl(root, 'set', '1', 'done');
});

test('branches lists a worktree branch a worker never renamed, marked unnamed', () => {
  const root = repo();
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: SPAWN_TIMEOUT }).trim();
  rmSync(join(root, '.git'), { recursive: true, force: true });
  g('init', '-q', '-b', 'feature'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  sh(root, `echo a > a.txt && git add -A && git commit -qm base`);
  jarl(root, 'init', 'goal', '--committed');
  sh(root, `git add -A && git commit -qm jarl && git worktree add -q -b worktree-agent-x ${root}/.wt-x && cd ${root}/.wt-x && echo b > b.txt && git add -A && git commit -qm work`);
  const rows = JSON.parse(jarl(root, 'branches', '--base', 'feature', '--json'));
  const row = rows.find((r) => r.branch === 'worktree-agent-x');
  assert.ok(row, 'the unnamed worktree branch is listed');
  assert.equal(row.ahead, 1); assert.equal(row.unnamed, true);
  assert.match(jarl(root, 'branches', '--base', 'feature'), /UNNAMED/);
});

test('evidence accepts free text or structured rows; rows are readable back', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'thing');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', '12 pass, 0 fail');
  jarl(root, 'evidence', '1', '--ran', 'node --test tests/a.test.mjs', '--saw', '3 pass');
  assert.match(jarl(root, 'show', '1'), /\*\*ran:\*\* npm test · \*\*saw:\*\* 12 pass, 0 fail/);
  assert.match(refuses(root, 'evidence', '1', '--ran', 'x'), /needs both --ran/);
  jarl(root, 'review', '1', 'approve', '--by', 'rev', FINDINGS);
  jarl(root, 'set', '1', 'done');
});

test('free-text evidence appends, it never overwrites earlier evidence', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'thing');
  jarl(root, 'evidence', '1', 'first note');
  jarl(root, 'evidence', '1', 'second note');
  const shown = jarl(root, 'show', '1');
  assert.ok(shown.indexOf('first note') > -1 && shown.indexOf('first note') < shown.indexOf('second note'), 'both notes kept, in order');
  jarl(root, 'new', 'merged thing');
  jarl(root, 'evidence', '2', '--ran', 'npm test', '--saw', '12 pass');
  jarl(root, 'evidence', '2', 'check green, merged abc1234');
  const merged = jarl(root, 'show', '2');
  assert.match(merged, /\*\*ran:\*\* npm test · \*\*saw:\*\* 12 pass/, "the worker's row survives the merger's note");
  assert.match(merged, /merged abc1234/);
});

test('repeated --ran/--saw in one call produce one row per pair, not a comma-joined mess', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'thing');
  jarl(root, 'evidence', '1', '--ran', 'cmd one', '--saw', 'result one', '--ran', 'cmd two', '--saw', 'result two');
  const shown = jarl(root, 'show', '1');
  assert.match(shown, /^- \[1\] \*\*ran:\*\* cmd one · \*\*saw:\*\* result one$/m);
  assert.match(shown, /^- \[2\] \*\*ran:\*\* cmd two · \*\*saw:\*\* result two$/m);
  const log = readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
  assert.match(log, /1 evidence row · cmd one$/m);
  assert.match(log, /1 evidence row · cmd two$/m);
  assert.match(refuses(root, 'evidence', '1', '--ran', 'a', '--ran', 'b', '--saw', 'only one'), /must repeat the same number of times/);
  assert.match(refuses(root, 'evidence', '1', '--ran', '--saw', 'x'), /needs both --ran/);
});

// A real repository, not the fake .git directory repo() makes (gitRepo of the helpers): these tests ask git itself what it sees.

test('init keeps the loop out of git by default: .jarl/.gitignore holds exactly * and **/*', () => {
  const { dir: root, g } = gitRepo();
  jarl(root, 'init', 'goal');
  assert.equal(readFileSync(join(root, '.jarl', '.gitignore'), 'utf8'), '*\n**/*\n');
  jarl(root, 'new', 'thing', '--files', 'a.txt');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', '1 pass');
  jarl(root, 'evidence', '1', 'merged abc1234');
  assert.equal(g('status', '--porcelain'), '', 'git status shows nothing from .jarl/');
  assert.equal(g('status', '--porcelain', '--untracked-files=all'), '', 'not even file by file');
  g('add', '-A');
  assert.equal(g('ls-files', '.jarl'), '', 'git add -A stages nothing from .jarl/');
});

test('init --committed ignores only the lock and temporary files, and git sees the loop', () => {
  const { dir: root, g } = gitRepo();
  const opened = JSON.parse(jarl(root, 'init', 'goal', '--committed', '--json'));
  assert.equal(opened.committed, true);
  // --committed takes no value, so the goal after it is the goal, not the flag's value.
  const before = gitRepo().dir;
  assert.equal(JSON.parse(jarl(before, 'init', '--committed', 'goal first', '--json')).committed, true);
  assert.match(readFileSync(join(before, '.jarl', 'goal.md'), 'utf8'), /goal first/);
  assert.match(refuses(gitRepo().dir, 'init', 'goal', '--committed=yes'), /--committed takes no value/);
  assert.equal(readFileSync(join(root, '.jarl', '.gitignore'), 'utf8'), JARL_GITIGNORE_COMMITTED);
  jarl(root, 'new', 'thing');
  jarl(root, 'evidence', '1', 'note');
  const seen = g('status', '--porcelain', '--untracked-files=all');
  assert.match(seen, /^\?\? \.jarl\/goal\.md$/m);
  assert.match(seen, /^\?\? \.jarl\/issues\/1-thing\.md$/m);
  g('add', '-A');
  assert.match(g('ls-files', '.jarl'), /\.jarl\/log\.md/);
  assert.match(refuses(root, 'init', 'again'), /already exists/);
  assert.equal(readFileSync(join(root, '.jarl', '.gitignore'), 'utf8'), JARL_GITIGNORE_COMMITTED, 'no command widens it to the default mode');
});

test('init --permanent commits the loop and marks it as a record; close then keeps the directory but still refuses while open', () => {
  const root = repo();
  const opened = JSON.parse(jarl(root, 'init', 'goal', '--permanent', '--json'));
  assert.equal(opened.committed, true, 'a permanent record is always committed, like --committed');
  assert.equal(opened.permanent, true);
  assert.equal(readFileSync(join(root, '.jarl', '.gitignore'), 'utf8'), JARL_GITIGNORE_COMMITTED, 'committed: only the lock and temporary files are ignored');
  assert.equal(existsSync(join(root, '.jarl', '.permanent')), true, 'the marker a later session reads to tell the mode');
  assert.equal(JSON.parse(jarl(repo(), 'init', '--permanent', 'goal', '--json')).permanent, true, 'the goal after --permanent is the goal');
  assert.match(refuses(repo(), 'init', 'goal', '--permanent=yes'), /--permanent takes no value/);
  jarl(root, 'new', 'thing');
  assert.match(refuses(root, 'close'), /still open/, 'the open-issue refusal is unchanged in the permanent mode');
  jarl(root, 'set', '1', 'dropped', 'out of scope');
  jarl(root, 'close');
  assert.equal(existsSync(join(root, '.jarl')), true, 'a permanent loop keeps its directory once clean');
  assert.equal(existsSync(join(root, '.jarl', 'issues', '1-thing.md')), true);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /closed · kept as a permanent record/);
});

test('mode permanent turns an existing committed loop into a permanent record; a committed loop becomes permanent and close then keeps it', () => {
  const root = repo();
  jarl(root, 'init', 'goal', '--committed');
  assert.equal(existsSync(join(root, '.jarl', '.permanent')), false, 'committed, not yet permanent');
  const out = JSON.parse(jarl(root, 'mode', 'permanent', '--json'));
  assert.equal(out.permanent, true);
  assert.equal(existsSync(join(root, '.jarl', '.permanent')), true);
  assert.equal(readFileSync(join(root, '.jarl', '.gitignore'), 'utf8'), JARL_GITIGNORE_COMMITTED, 'still committed, as it always was');
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /mode → permanent/);
  jarl(root, 'new', 'thing');
  jarl(root, 'set', '1', 'dropped', 'out of scope');
  jarl(root, 'close');
  assert.equal(existsSync(join(root, '.jarl')), true, 'a loop switched to permanent keeps its directory on close, like one opened with init --permanent');
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /closed · kept as a permanent record/);
});

test('mode permanent refuses a default-mode loop (out of git) and explains why', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  assert.equal(existsSync(join(root, '.jarl', '.gitignore')), true);
  assert.match(refuses(root, 'mode', 'permanent'), /out of git.*must be committed/s);
  assert.equal(existsSync(join(root, '.jarl', '.permanent')), false, 'refused, nothing written');
});

test('mode permanent on an already permanent loop refuses clearly instead of silently repeating', () => {
  const root = repo();
  jarl(root, 'init', 'goal', '--permanent');
  assert.match(refuses(root, 'mode', 'permanent'), /already a permanent record/);
});

test('a branch loop, default or --committed, still removes the directory on close', () => {
  for (const args of [[], ['--committed']]) {
    const root = repo();
    jarl(root, 'init', 'goal', ...args);
    jarl(root, 'new', 'thing');
    jarl(root, 'set', '1', 'dropped', 'out of scope');
    jarl(root, 'close');
    assert.equal(existsSync(join(root, '.jarl')), false);
  }
});

// A loop that keeps its issues in one repository while its workers change another: two real
// repositories side by side, the loop in "hub" on main, the code and the worker branch in "tool" on feature.
test('check, branches and handoff read the repository an issue names, not the loop\'s own, in both loop modes', () => {
  for (const committed of [false, true]) {
    const parent = mkdtempSync(join(tmpdir(), 'jarl-two-'));
    const hub = join(parent, 'hub'); const tool = join(parent, 'tool');
    mkdirSync(hub); mkdirSync(tool);
    const setup = (b) => `git init -q -b ${b} && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null`;
    sh(hub, `${setup('main')} && echo notes > notes.md && git add -A && git commit -qm base`);
    sh(tool, `${setup('feature')} && mkdir src tests && echo 'export const a = 1;' > src/a.mjs && printf 'assert.equal(1,1);\\n' > tests/a.test.mjs && git add -A && git commit -qm base`);
    jarl(hub, 'init', 'goal', ...(committed ? ['--committed'] : []));
    jarl(hub, 'new', 'change a', '--files', 'src/a.mjs,tests/a.test.mjs', '--repo', '../tool');
    jarl(hub, 'new', 'other', '--files', 'src/a.mjs');
    if (committed) sh(hub, 'git add -A && git commit -qm jarl');
    sh(tool, `git worktree add -q -b jarl/1-change-a ${parent}/wt-1 && cd ${parent}/wt-1 && echo 'export const a = 2;' > src/a.mjs && printf 'assert.equal(1,1);\\nassert.equal(2,2);\\n' > tests/a.test.mjs && git add -A && git commit -qm work`);
    const mode = committed ? 'committed' : 'default';

    // The issue's Repo field: the branch, its base and its files all come from the tool repository.
    const out = JSON.parse(jarl(hub, 'check', '1', '--branch', 'jarl/1-change-a', '--json'));
    const byName = Object.fromEntries(out.items.map((i) => [i.name, i]));
    assert.equal(out.base, 'feature', `${mode}: the base is the tool repository's current branch, not the hub's`);
    assert.equal(out.mergeBase, sh(tool, 'git rev-parse feature'), mode);
    assert.equal(byName['commits beyond base'].ok, true, byName['commits beyond base'].note);
    assert.match(byName['commits beyond base'].note, /^1 commit\(s\) on jarl\/1-change-a/);
    assert.deepEqual(out.changed, ['src/a.mjs', 'tests/a.test.mjs']);
    assert.equal(byName['diff inside declared files'].ok, true, byName['diff inside declared files'].note);
    assert.equal(byName['assertions in touched tests'].note, '1 → 2');
    assert.equal(out.ok, true, mode);
    assert.match(jarl(hub, 'show', '1'), /^\*\*Repo:\*\* tool$/m);
    assert.doesNotMatch(jarl(hub, 'show', '2'), /\*\*Repo:\*\*/, 'an issue that names no repository carries no Repo line');

    // --repo on the command does the same for an issue that names no repository; without it, the loop's own repository is read, as before.
    assert.match(refuses(hub, 'check', '2', '--branch', 'jarl/1-change-a'), /no such branch/);
    assert.equal(JSON.parse(jarl(hub, 'check', '2', '--branch', 'jarl/1-change-a', '--repo', '../tool', '--json')).ok, true, mode);
    assert.match(refuses(hub, 'check', '1', '--branch', 'jarl/1-change-a', '--repo', '../nowhere'), /not a git repository/);
    jarl(hub, 'repo', '2', '../tool');
    assert.match(jarl(hub, 'show', '2'), /^\*\*Repo:\*\* tool$/m);
    assert.equal(JSON.parse(jarl(hub, 'check', '2', '--branch', 'jarl/1-change-a', '--json')).base, 'feature', mode);

    // branches lists the worker branch in the tool repository, and the hub's own listing stays empty.
    const rows = JSON.parse(jarl(hub, 'branches', '--repo', '../tool', '--json'));
    assert.deepEqual(rows.map((r) => r.branch), ['jarl/1-change-a'], mode);
    assert.equal(rows[0].ahead, 1);
    assert.ok(rows[0].worktree.endsWith('wt-1'), rows[0].worktree);
    assert.equal(rows[0].dirty, 0);
    assert.equal(rows[0].repo, 'tool');
    // With no --repo, branches looks in the loop's own repository and in every repository an open issue names,
    // each row carrying the repository's name: the hub has no worker branches of its own, the tool repository has one.
    const all = JSON.parse(jarl(hub, 'branches', '--json'));
    assert.deepEqual(all.map((r) => [r.repo, r.branch]), [['tool', 'jarl/1-change-a']], `${mode}: the worker branch in the tool repository is seen from the hub`);
    assert.match(jarl(hub, 'branches'), /^\[tool\] jarl\/1-change-a → 1  \+1 /, mode);
    // Once nothing open or in progress names the tool repository any more, the hub is left with its own.
    jarl(hub, 'set', '1', 'dropped', 'not needed');
    jarl(hub, 'set', '2', 'dropped', 'not needed');
    assert.deepEqual(JSON.parse(jarl(hub, 'branches', '--json')), [], `${mode}: the hub itself has no worker branches`);
    jarl(hub, 'set', '1', 'open', 'back');
    jarl(hub, 'set', '2', 'open', 'back');

    // resume shows where the tool repository stands, beside the hub's own tips.
    jarl(hub, 'set', '1', 'in-progress', 'worker raised in tool', '--branch', 'jarl/1-change-a');
    const res = jarl(hub, 'resume');
    assert.match(res, new RegExp(`^\\[tool\\] .*\\n(  .*\\n)*  release  feature ${sh(tool, 'git rev-parse --short=12 feature')}`, 'm'), `${mode}: the tool repository's tip is shown`);
    assert.match(res, /^  feature  jarl\/1-change-a [0-9a-f]{12}  \+1\/-0 vs feature  not pushed  → 1$/m, mode);

    assert.equal(sh(tool, 'git status --porcelain --untracked-files=all'), '', `${mode}: the loop never writes into the tool repository`);
  }
});

// Real repositories beside a hub that holds the loop; each is a git repository on its own branch.
function reposBeside(...names) {
  const parent = mkdtempSync(join(tmpdir(), 'jarl-many-'));
  const dirs = {};
  for (const name of ['hub', ...names]) {
    const dir = join(parent, name);
    mkdirSync(dir, { recursive: true });
    sh(dir, `git init -q -b ${name === 'hub' ? 'main' : 'feature'} && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null && mkdir src tests && echo 'export const a = 1;' > src/a.mjs && echo 'export const b = 1;' > src/b.mjs && printf 'assert.equal(1,1);\\n' > tests/a.test.mjs && echo '# Changelog' > CHANGELOG.md && git add -A && git commit -qm base`);
    dirs[name] = dir;
  }
  return { parent, sh, ...dirs };
}

// In a loop over several repositories, an issue that names one writes its files with that
// repository's directory name first. A file is its repository and its path there.
test('next keeps the same path in two repositories apart and still holds a collision inside one', () => {
  const { hub } = reposBeside('tool', 'other', 'vendor/tool');
  jarl(hub, 'init', 'goal');
  jarl(hub, 'new', 'in flight in tool', '--repo', '../tool', '--files', 'tool/CHANGELOG.md,tool/src/a.mjs');
  jarl(hub, 'new', 'same changelog path, other repository', '--repo', '../other', '--files', 'other/CHANGELOG.md');
  jarl(hub, 'new', 'same changelog path, a second repository also named tool', '--repo', '../vendor/tool', '--files', 'tool/CHANGELOG.md');
  jarl(hub, 'new', 'same source file, same repository', '--repo', '../tool/', '--files', 'tool/src/a.mjs');
  jarl(hub, 'new', 'the hub\'s own changelog', '--files', 'CHANGELOG.md');
  jarl(hub, 'new', 'other repository again, behind the first one there', '--repo', '../other', '--files', 'other/CHANGELOG.md');
  jarl(hub, 'set', '1', 'in-progress', 'worker raised in tool');
  const rows = JSON.parse(jarl(hub, 'next', '--all', '--json'));
  assert.deepEqual(rows.filter((r) => r.ready).map((r) => r.id), ['2', '3', '5'], 'the same path in another repository never waits');
  assert.deepEqual(rows.find((r) => r.id === '4').waitsOn, ['tool/src/a.mjs'], 'the same file in the same repository still waits, however the Repo path is spelled');
  assert.deepEqual(rows.find((r) => r.id === '6').waitsOn, ['other/CHANGELOG.md'], 'two open issues on one file in one repository do not both run');
  assert.match(jarl(hub, 'next', '--all'), /^4 {2}P2 {2}same source file, same repository {2}\(waits on tool\/src\/a\.mjs, held by 1\)$/m);
});

test('check matches a changed file against the files an issue declares in its own repository', () => {
  const { parent, sh, hub, tool } = reposBeside('tool');
  jarl(hub, 'init', 'goal');
  jarl(hub, 'new', 'change a in tool', '--repo', '../tool', '--files', 'tool/src/a.mjs');
  jarl(hub, 'new', 'change b in tool', '--repo', '../tool', '--files', 'tool/src/b.mjs');
  sh(tool, `git worktree add -q -b jarl/1-change-a-in-tool ${parent}/wt-1 && cd ${parent}/wt-1 && echo 'export const a = 2;' > src/a.mjs && printf 'assert.equal(1,1);\\nassert.equal(2,2);\\n' > tests/a.test.mjs && echo '- a' >> CHANGELOG.md && git add -A && git commit -qm work`);

  const out = JSON.parse(jarl(hub, 'check', '1', '--branch', 'jarl/1-change-a-in-tool', '--json'));
  const byName = Object.fromEntries(out.items.map((i) => [i.name, i]));
  assert.deepEqual(out.changed, ['CHANGELOG.md', 'src/a.mjs', 'tests/a.test.mjs']);
  assert.equal(byName['diff inside declared files'].ok, true, byName['diff inside declared files'].note);
  assert.equal(byName['diff inside declared files'].note, '3 file(s), all inside');
  assert.equal(out.ok, true);
  assert.match(jarl(hub, 'check', '1', '--branch', 'jarl/1-change-a-in-tool'), /^✓ diff inside declared files — 3 file\(s\), all inside$/m);

  // Dropping the name does not widen the scope: another file of the same repository stays outside.
  let other;
  try { jarl(hub, 'check', '2', '--branch', 'jarl/1-change-a-in-tool', '--json'); } catch (e) { other = JSON.parse(e.stdout); }
  const otherByName = Object.fromEntries(other.items.map((i) => [i.name, i]));
  assert.equal(otherByName['diff inside declared files'].ok, false);
  assert.equal(otherByName['diff inside declared files'].note, 'outside tool/src/b.mjs: src/a.mjs');
});

test('ask kinds are closed; lower needs a target', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  assert.match(refuses(root, 'ask', 'what now', '--kind', 'panic'), /--kind must be one of/);
  assert.match(refuses(root, 'ask', 'weaken what', '--kind', 'lower'), /--target is required for kind lower/);
  const a = JSON.parse(jarl(root, 'ask', 'drop this test?', '--kind', 'lower', '--target', 'coverage-check', '--json'));
  assert.equal(a.kind, 'lower');
  const asks = JSON.parse(jarl(root, 'ask', 'plain question', '--json'));
  assert.equal(asks.kind, 'stuck');
  assert.match(refuses(root, 'ask', 'x', '--kind', 'stop', '--target', 'y'), /--target has no meaning/);
});

test('review changes requires a Critical or Important finding; Minor alone is rejected', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'thing');
  assert.match(refuses(root, 'review', '1', 'changes', '--by', 'rev', 'looks a bit off'), /needs at least one finding ranked/);
  assert.match(refuses(root, 'review', '1', 'changes', '--by', 'rev', 'Minor: naming could be better'), /Minor alone goes to evidence/);
  jarl(root, 'review', '1', 'changes', '--by', 'rev', 'Important: the new test never goes red');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'fixed');
  jarl(root, 'review', '1', 'approve', '--by', 'rev', 'Minor: could still tidy the naming, but fine to land');
  jarl(root, 'set', '1', 'done');
});

// A loop is put away with `archive`, not deleted, and a new one opens in its place. Everything but
// the archive and the mode markers moves, so the next loop keeps the same way of living in git.
test('archive puts the loop away under .jarl/archive/<date>-<slug>/, and init opens a new one in the same mode', () => {
  const root = repo();
  jarl(root, 'init', 'first goal');
  jarl(root, 'new', 'left unfinished');
  assert.match(refuses(root, 'init', 'second goal'), /archive it first: jarl\.mjs archive/);

  const out = JSON.parse(jarl(root, 'archive', 'first round', '--json'));
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  assert.equal(out.archived, join(root, '.jarl', 'archive', `${day}-first-round`));
  assert.deepEqual(out.leftOpen, ['1']);
  for (const f of ['goal.md', 'log.md', 'decisions.md', 'issues']) {
    assert.ok(existsSync(join(out.archived, f)), `${f} moved into the archive`);
    assert.ok(!existsSync(join(root, '.jarl', f)), `${f} is no longer live`);
  }
  assert.match(readFileSync(join(out.archived, 'log.md'), 'utf8'), /archived → \.jarl\/archive\/.*first-round · 1 still open or in progress: 1/);
  assert.equal(readFileSync(join(root, '.jarl', '.gitignore'), 'utf8'), '*\n**/*\n', 'the mode marker stays');

  assert.match(refuses(root, 'new', 'into nothing'), /no live loop here — \.jarl\/ holds only archived loops/);
  assert.match(refuses(root, 'close'), /no live loop here/);
  assert.match(refuses(root, 'archive', 'again'), /holds only earlier archives/);

  assert.match(jarl(root, 'init', 'second goal'), /kept out of git/);
  assert.match(jarl(root, 'new', 'fresh work'), /filed 1/);
  const status = jarl(root, 'status');
  assert.match(status, /^goal: second goal$/m);
  assert.match(status, /opened \d{4}-\d{2}-\d{2} \d{2}:\d{2} · last activity \d{4}-\d{2}-\d{2} \d{2}:\d{2} · 1 archived loop\(s\)/);
});

test('a new loop after an archive keeps the archived mode, and a flag that contradicts it is refused', () => {
  const root = repo();
  jarl(root, 'init', 'record', '--permanent');
  jarl(root, 'archive', 'one');
  assert.ok(existsSync(join(root, '.jarl', '.permanent')));
  assert.match(refuses(root, 'init', 'next', '--committed'), /keeps its archived loops in the permanent mode/);
  assert.match(jarl(root, 'init', 'next'), /permanent record/);
  assert.match(refuses(root, 'archive', 'one'), /pick another slug|already exists/);
});

// ---- concurrency: one writer at a time -------------------------------------------------------

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const jarlAsync = (root, ...args) => promisify(execFile)(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8' });

test('20 parallel evidence calls land 20 rows and 20 log lines; 10 parallel new calls get 10 distinct numbers', async () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'target');
  await Promise.all(Array.from({ length: 20 }, (_, n) => jarlAsync(root, 'evidence', '1', '--ran', `w${n}`, '--saw', 'ok')));
  const shown = jarl(root, 'show', '1');
  assert.equal((shown.match(/^- \[\d+\] \*\*ran:\*\* w\d+ · \*\*saw:\*\* ok$/gm) || []).length, 20);
  const log = readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
  assert.equal((log.match(/· 1 evidence row · w\d+$/gm) || []).length, 20);
  const filed = await Promise.all(Array.from({ length: 10 }, (_, n) => jarlAsync(root, 'new', `parallel ${n}`, '--json')));
  const ids = filed.map((r) => JSON.parse(r.stdout).id);
  assert.equal(new Set(ids).size, 10, `distinct ids, got ${ids.join(' ')}`);
  assert.deepEqual([...ids].sort((a, b) => Number(a) - Number(b)), ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
  assert.equal(existsSync(join(root, '.jarl', '.lock')), false, 'the lock is released after every call');
  const { readdirSync } = await import('node:fs');
  assert.deepEqual(readdirSync(join(root, '.jarl', 'issues')).filter((f) => f.endsWith('.tmp')), [], 'no temporary file is left behind');
});

test('a lock left by a process that is gone is broken; a live holder makes the caller fail loudly, writing nothing', async () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'target');
  const lock = join(root, '.jarl', '.lock');
  const { hostname } = await import('node:os');
  // A pid that cannot be running (above the kernel's pid range).
  writeFileSync(lock, `99999999 ${hostname()} 2026-01-01T00:00:00.000Z\n`);
  jarl(root, 'evidence', '1', 'after a crash');
  assert.match(jarl(root, 'show', '1'), /after a crash/);
  assert.equal(existsSync(lock), false);
  // A live holder (this test's own process) that does not let go: the call waits out its limit, then refuses.
  const { withLock } = await import(new URL('../jarl.mjs', import.meta.url).href);
  writeFileSync(lock, `${process.pid} ${hostname()} ${new Date().toISOString()}\n`);
  const env = { ...process.env, JARL_LOCK_WAIT_MS: '300' };
  let err;
  try { execFileSync(process.execPath, [SCRIPT, 'evidence', '1', 'blocked', '--root', root], { encoding: 'utf8', env, stdio: 'pipe', timeout: SPAWN_TIMEOUT }); } catch (e) { err = e; }
  assert.ok(err, 'a held lock refuses instead of writing without it');
  assert.match(String(err.stderr), new RegExp(`\\.jarl/\\.lock is held by another jarl\\.mjs \\(${process.pid} .*\\) — nothing was written`));
  assert.doesNotMatch(jarl(root, 'show', '1'), /blocked/);
  assert.equal(typeof withLock, 'function');
});

// ---- the argument parser ---------------------------------------------------------------------

test('a value flag takes the next argument whatever it starts with; -- ends the flags; unknown flags are refused', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'target');
  // --ran "--help" is a row, not a request for the usage text.
  assert.equal(jarl(root, 'evidence', '1', '--ran', '--help', '--saw', 'usage'), '1 evidence row recorded');
  jarl(root, 'evidence', '1', '--ran', 'yg check', '--saw', '--- FAIL: 3 pairs');
  jarl(root, 'evidence', '1', '--ran=go test ./...', '--saw=ok=all');
  const raw = (...args) => execFileSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8', timeout: SPAWN_TIMEOUT }).trim();
  raw('evidence', '1', '--', '--json prints ok');
  // A --root written after the bare -- is an argument, and a surplus one is refused rather than dropped.
  assert.match(refuses(root, 'evidence', '1', '--', 'x'), /unexpected: "--root".*flags such as --root go before it/s);
  assert.match(refuses(root, 'set', '1', '2', 'done', 'why'), /set takes at most 3 arguments — unexpected: "why".*12,13/s);
  const shown = jarl(root, 'show', '1');
  assert.match(shown, /^- \[1\] \*\*ran:\*\* --help · \*\*saw:\*\* usage$/m);
  assert.match(shown, /^- \[2\] \*\*ran:\*\* yg check · \*\*saw:\*\* --- FAIL: 3 pairs$/m);
  assert.match(shown, /^- \[3\] \*\*ran:\*\* go test \.\/\.\.\. · \*\*saw:\*\* ok=all$/m);
  assert.match(shown, /^--json prints ok$/m);
  assert.match(raw('new', '--', '--json output drops key'), /^filed 2 /);
  // Refused loudly, naming what the command takes.
  assert.match(refuses(root, 'new', 'd', '--kidn', 'gap'), /unknown flag --kidn for new — it takes .*--kind/);
  assert.match(refuses(root, 'evidence', '1', '--json prints ok'), /unknown flag --json prints ok for evidence.*bare --/s);
  assert.throws(() => raw('evidence', '1', '--ran'), (e) => /--ran needs a value/.test(String(e.stderr)));
  assert.match(refuses(root, 'new', 'x', '--kind', 'bug', '--kind', 'gap'), /--kind given twice/);
  assert.match(refuses(root, 'list', '--all=yes'), /--all takes no value/);
  assert.match(refuses(root, 'evidence', '1', 'note', '--ran', 'a', '--saw', 'b'), /not both/);
  assert.match(refuses(root, '--kind', 'bug', 'new', 'x'), /before the command/);
  assert.match(refuses(root, 'frobnicate'), /unknown command: frobnicate/);
  // Nothing refused above wrote anything.
  assert.equal(JSON.parse(jarl(root, 'list', '--all', '--json')).length, 2);
  // --help still prints the usage when it is a flag of its own.
  assert.match(jarl(root, 'list', '--help'), /^usage: jarl\.mjs/);
});

test('every flag the usage text names is one its command accepts', async () => {
  const { COMMAND_FLAGS } = await import(new URL('../jarl.mjs', import.meta.url).href);
  const usage = readFileSync(SCRIPT, 'utf8').split('const USAGE = `')[1].split('`;')[0];
  for (const line of usage.split('\n')) {
    const m = /^ {2}([a-z]+) /.exec(line);
    if (!m || !COMMAND_FLAGS[m[1]]) continue;
    for (const [, flag] of line.matchAll(/--([a-z][a-z-]*)/g)) {
      assert.ok(Object.hasOwn(COMMAND_FLAGS[m[1]], flag) || ['json', 'help', 'root'].includes(flag), `${m[1]} --${flag} is in the usage but not accepted`);
    }
  }
});

// ---- bulk ids ------------------------------------------------------------------------------------

test('evidence, review, set, tag and prio take a comma list with ranges, all or nothing, one log line per issue', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  for (const t of ['a', 'b', 'c', 'd', 'e']) jarl(root, 'new', t);
  // A four-issue package closes in four calls.
  assert.equal(jarl(root, 'evidence', '1-3,5', '--ran', 'npm test', '--saw', 'pass 40'), '1 evidence row recorded\n2 evidence row recorded\n3 evidence row recorded\n5 evidence row recorded');
  jarl(root, 'review', '1-3,5', 'approve', '--by', 'rev', 'read the diff, nothing found');
  jarl(root, 'evidence', '1,2,3,5', 'merged abc1234');
  assert.equal(jarl(root, 'set', '1-3,5', 'done', 'merged abc1234'), '1 → done\n2 → done\n3 → done\n5 → done');
  const rows = JSON.parse(jarl(root, 'list', '--all', '--json'));
  assert.deepEqual(rows.filter((r) => r.status === 'done').map((r) => r.id), ['1', '2', '3', '5']);
  const log = readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
  assert.equal((log.match(/· [1235] → done · merged abc1234$/gm) || []).length, 4, 'one log line per issue');
  assert.equal((log.match(/· [1235] review approve · /gm) || []).length, 4);
  // tag and prio.
  jarl(root, 'tag', '4,5', '+later', '-none');
  jarl(root, 'prio', '4-5', '1');
  const [d, e] = ['4', '5'].map((id) => jarl(root, 'show', id));
  for (const t of [d, e]) { assert.match(t, /^\*\*Tags:\*\* later$/m); assert.match(t, /^\*\*Priority:\*\* 1$/m); }
  // A JSON caller gets an array for a list, the old object for one id.
  assert.ok(Array.isArray(JSON.parse(jarl(root, 'prio', '4,5', '2', '--json'))));
  assert.equal(JSON.parse(jarl(root, 'prio', '4', '3', '--json')).id, '4');
});

test('a bulk call with one bad id, or one issue failing its precondition, writes nothing at all', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  for (const t of ['a', 'b']) jarl(root, 'new', t);
  const before = () => [readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), jarl(root, 'show', '1'), jarl(root, 'show', '2')].join('\n');
  const snap = before();
  assert.match(refuses(root, 'evidence', '1,2,9', 'note'), /no such issue: 9 — nothing was written/);
  assert.match(refuses(root, 'tag', '1-3', '+x'), /no such issue: 3/);
  assert.match(refuses(root, 'set', '1,2', 'bogus'), /status must be one of/);
  // 1 is ready for done, 2 is not: neither moves.
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'proof');
  jarl(root, 'review', '1', 'approve', '--by', 'rev', FINDINGS);
  assert.match(refuses(root, 'set', '1,2', 'done'), /2 has no evidence yet.*nothing was written/s);
  assert.match(jarl(root, 'show', '1'), /^\*\*Status:\*\* open$/m);
  assert.match(refuses(root, 'prio', '1,x', '1'), /not an issue id: "x"/);
  assert.match(refuses(root, 'prio', '5-2', '1'), /runs backwards/);
  assert.notEqual(before(), snap, 'the evidence and review above did land');
  assert.doesNotMatch(jarl(root, 'show', '2'), /note/);
});

test('a committed loop keeps the lock and temporary files out of git; an older committed loop is given the narrow ignore file by its first write', () => {
  for (const mode of ['--committed', '--permanent']) {
    const { dir: root, g } = gitRepo();
    jarl(root, 'init', 'goal', mode);
    jarl(root, 'new', 'thing');
    // What a `git add .jarl` sees in the middle of a call: the lock, a stale lock moved aside, temp files.
    writeFileSync(join(root, '.jarl', '.lock'), '1 host 2026-01-01\n');
    writeFileSync(join(root, '.jarl', '.lock.break'), '');
    writeFileSync(join(root, '.jarl', '.log.md.123.tmp'), '');
    writeFileSync(join(root, '.jarl', 'issues', '.2.123.tmp'), '');
    g('add', '-A');
    const staged = g('ls-files', '.jarl').split('\n');
    assert.ok(staged.includes('.jarl/.gitignore') && staged.includes('.jarl/issues/1-thing.md') && staged.includes('.jarl/log.md'), `${mode}: the loop is committed`);
    assert.deepEqual(staged.filter((f) => /lock|\.tmp$/.test(f)), [], `${mode}: the lock and temp files are not`);
  }
  // A committed loop opened before the narrow file existed has no ignore file at all.
  const root = repo();
  jarl(root, 'init', 'goal', '--committed');
  rmSync(join(root, '.jarl', '.gitignore'));
  jarl(root, 'new', 'thing');
  assert.equal(readFileSync(join(root, '.jarl', '.gitignore'), 'utf8'), JARL_GITIGNORE_COMMITTED);
  // The mode reads the same: still committed, so mode permanent works, and an archive keeps the mode.
  jarl(root, 'mode', 'permanent');
  jarl(root, 'set', '1', 'dropped', 'x');
  jarl(root, 'archive', 'first');
  assert.equal(JSON.parse(jarl(root, 'init', 'next', '--json')).permanent, true);
  // The default mode's file is still the ignore-everything one, and mode permanent still refuses it.
  const out = repo();
  jarl(out, 'init', 'goal');
  jarl(out, 'new', 'thing');
  assert.equal(readFileSync(join(out, '.jarl', '.gitignore'), 'utf8'), '*\n**/*\n');
  assert.match(refuses(out, 'mode', 'permanent'), /out of git/);
});

test('many callers on a lock left by a dead process: one breaks it, none loses a row; an empty lock is broken after two seconds', async () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'target');
  const { hostname } = await import('node:os');
  const { utimesSync, readdirSync } = await import('node:fs');
  const lock = join(root, '.jarl', '.lock');
  writeFileSync(lock, `99999999 ${hostname()} 2026-01-01T00:00:00.000Z\n`);
  await Promise.all(Array.from({ length: 20 }, (_, n) => jarlAsync(root, 'evidence', '1', '--ran', `b${n}`, '--saw', 'ok')));
  assert.equal((jarl(root, 'show', '1').match(/^- \[\d+\] \*\*ran:\*\* b\d+ · /gm) || []).length, 20);
  assert.equal((readFileSync(join(root, '.jarl', 'log.md'), 'utf8').match(/· 1 evidence row · b\d+$/gm) || []).length, 20);
  assert.deepEqual(readdirSync(join(root, '.jarl')).filter((f) => f.startsWith('.lock')), [], 'neither the lock nor the breaker lock is left');
  // A holder that died between creating the lock and writing its name: empty, and broken once two seconds old.
  writeFileSync(lock, '');
  const old = new Date(Date.now() - 5_000);
  utimesSync(lock, old, old);
  const t0 = Date.now();
  jarl(root, 'evidence', '1', 'after an empty lock');
  assert.ok(Date.now() - t0 < 10_000, 'well inside the wait limit');
  assert.match(jarl(root, 'show', '1'), /after an empty lock/);
  // A breaker that died holding the breaker lock does not block for good.
  writeFileSync(lock, `99999999 ${hostname()} 2026-01-01T00:00:00.000Z\n`);
  writeFileSync(join(root, '.jarl', '.lock.break'), '');
  const older = new Date(Date.now() - 60_000);
  utimesSync(join(root, '.jarl', '.lock.break'), older, older);
  jarl(root, 'evidence', '1', 'after a dead breaker');
  assert.match(jarl(root, 'show', '1'), /after a dead breaker/);
});

test('new claims its file with a hard link, and without hard links falls back to an exclusive create', async () => {
  const { claimFile } = await import(new URL('../jarl.mjs', import.meta.url).href);
  const dir = mkdtempSync(join(tmpdir(), 'jarl-claim-'));
  const tmp = join(dir, '.tmp'); writeFileSync(tmp, 'body');
  const noLinks = () => { const e = new Error('no links'); e.code = 'EPERM'; throw e; };
  assert.equal(claimFile(tmp, join(dir, '1-a.md'), noLinks), true);
  assert.equal(readFileSync(join(dir, '1-a.md'), 'utf8'), 'body');
  assert.equal(claimFile(tmp, join(dir, '1-a.md'), noLinks), false, 'a taken name is not overwritten');
  assert.equal(claimFile(tmp, join(dir, '2-b.md')), true);
  assert.equal(claimFile(tmp, join(dir, '2-b.md')), false);
  const other = () => { const e = new Error('disk'); e.code = 'EIO'; throw e; };
  assert.throws(() => claimFile(tmp, join(dir, '3-c.md'), other), /disk/);
});

test('a command refused by the parser or its own checks does not backfill the ignore file', () => {
  const root = repo();
  jarl(root, 'init', 'goal', '--committed');
  rmSync(join(root, '.jarl', '.gitignore'));
  refuses(root, 'evidence', '1', '--bogus');
  assert.equal(existsSync(join(root, '.jarl', '.gitignore')), false, 'the parser refused before any lock');
  refuses(root, 'set', '999', 'done');
  assert.equal(existsSync(join(root, '.jarl', '.gitignore')), false, 'a command refused under the lock writes nothing');
  jarl(root, 'list');
  assert.equal(existsSync(join(root, '.jarl', '.gitignore')), false, 'a read takes no lock and writes nothing');
  jarl(root, 'new', 'thing');
  assert.equal(readFileSync(join(root, '.jarl', '.gitignore'), 'utf8'), JARL_GITIGNORE_COMMITTED, 'the first write that lands backfills it');
});

// ---- bodies, research import, ratify, After ----------------------------------------------------------

test('new writes the body at filing time, body replaces it later, and neither is required', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'with a body', '--where', 'src/a.mjs:12', '--what', 'the parser drops the last row', '--why', 'exports lose data',
    '--acceptance', 'npm test -- parser passes', '--acceptance', 'fixture 3 exports 10 rows');
  const shown = jarl(root, 'show', '1');
  assert.match(shown, /^\*\*Where:\*\* src\/a\.mjs:12$/m);
  assert.match(shown, /## What\nthe parser drops the last row\n\n## Why\nexports lose data\n\n## Acceptance\n- npm test -- parser passes\n- fixture 3 exports 10 rows\n\n## Evidence/);
  // A body line that looks like a heading stays inside its section.
  jarl(root, 'body', '1', '--what', 'line one\n## not a section');
  const issue = JSON.parse(jarl(root, 'show', '1', '--json'));
  assert.match(issue.sections.what, /line one\n\\## not a section/);
  assert.equal(Object.keys(issue.sections).join(','), 'what,why,acceptance,evidence');
  assert.match(refuses(root, 'body', '1'), /at least one of/);
  // A bare ## line is escaped too.
  jarl(root, 'body', '1', '--why', 'a\n##\nb');
  assert.match(JSON.parse(jarl(root, 'show', '1', '--json')).sections.why, /^a\n\\##\nb/);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /1 body · what/);
  // Without any of it, an issue reads exactly as before.
  jarl(root, 'new', 'bare');
  assert.match(jarl(root, 'show', '2', '--full'), /\*\*Where:\*\*\n\n## What\n\n\n## Why\n\n\n## Acceptance\n\n\n## Evidence$/);
});

test('next and status flag work with no acceptance line, done says so on stderr, review echoes the acceptance', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'no acceptance');
  jarl(root, 'new', 'has acceptance', '--acceptance', 'a', '--acceptance', 'b');
  const next = JSON.parse(jarl(root, 'next', '--json'));
  assert.equal(next[0].noAcceptance, true); assert.equal(next[1].noAcceptance, undefined);
  assert.match(jarl(root, 'next'), /1 {2}P2 {2}no acceptance {2}\(no acceptance yet\)/);
  jarl(root, 'set', '1,2', 'in-progress', 'raised');
  assert.match(jarl(root, 'status'), /in flight with no acceptance line: 1$/m);
  assert.match(jarl(root, 'review', '2', 'approve', '--by', 'rev', FINDINGS), /2 review approve by rev \(fresh\) · acceptance: - a \/ - b/);
  jarl(root, 'evidence', '2', '--ran', 'x', '--saw', 'y');
  const r = execFileSync(process.execPath, [SCRIPT, 'set', '2', 'done', 'merged', '--root', root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: SPAWN_TIMEOUT });
  assert.equal(r.trim(), '2 → done', 'stdout is unchanged');
  const child = (() => { try { return sh(tmpdir(), `node ${SCRIPT} review 1 approve --by rev "${FINDINGS}" --root ${root} >/dev/null && node ${SCRIPT} evidence 1 --ran t --saw ok --root ${root} >/dev/null && node ${SCRIPT} set 1 done m --root ${root} 2>&1 >/dev/null`); } catch (e) { return String(e.stdout); } })();
  assert.match(child, /note: 1 no acceptance line on file/, 'done is never refused for it, only noted');
});

const FLAT = [
  { id: 'jarl-2-B2', kind: 'defect', priority: 'high', title: 'issues have no body', where: 'jarl.mjs:297', evidence: 'ran new, saw an empty What', proposal: 'add --what', effort: 'S' },
  { id: 'jarl-2-B5', kind: 'opportunity', priority: 'low', title: 'no After relation', where: 'jarl.mjs:478', evidence: 'e', proposal: 'p', effort: 'M' },
];

function findingsDir(json) {
  const dir = mkdtempSync(join(tmpdir(), 'report-2026-09-25-'));
  writeFileSync(join(dir, 'findings.json'), JSON.stringify(json));
  return join(dir, 'findings.json');
}

test('import files one issue per finding with a Source, never twice, and keeps Evidence empty', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  const file = findingsDir(FLAT);
  const dry = JSON.parse(jarl(root, 'import', file, '--source', 'core/research/2026-09-25-jarl', '--dry-run', '--json'));
  assert.equal(dry.filed.length, 2); assert.equal(JSON.parse(jarl(root, 'list', '--all', '--json')).length, 0, 'a dry run files nothing');
  const out = JSON.parse(jarl(root, 'import', file, '--source', 'core/research/2026-09-25-jarl', '--tags', 'research', '--json'));
  assert.deepEqual(out.filed.map((f) => [f.id, f.finding, f.kind, f.priority]), [['1', 'jarl-2-B2', 'bug', '1'], ['2', 'jarl-2-B5', 'gap', '3']]);
  const one = JSON.parse(jarl(root, 'show', '1', '--json'));
  assert.equal(one.fields.source, 'core/research/2026-09-25-jarl#jarl-2-B2');
  assert.equal(one.fields.where, 'jarl.mjs:297');
  assert.deepEqual(one.tags, ['research']);
  assert.match(one.sections.what, /ran new, saw an empty What/);
  assert.match(one.sections.why, /Effort \(the finding's estimate\): S/);
  assert.match(one.sections.acceptance, /Proposed by the finding .*add --what/);
  assert.equal(one.sections.evidence.trim(), '', 'nothing in Evidence: done still needs real evidence');
  // A re-run files nothing; a hand-filed issue with --source counts as filed too.
  assert.match(jarl(root, 'import', file, '--source', 'core/research/2026-09-25-jarl'), /filed 0 · already filed 2/);
  jarl(root, 'new', 'by hand', '--source', 'core/research/2026-09-25-other#X-1');
  assert.match(refuses(root, 'new', 'bad', '--source', 'no-hash'), /a source is <report dir>#<finding id>/);
  // Flags override the mapping.
  const file2 = findingsDir([{ id: 'Q-1', title: 'q', priority: 'high' }]);
  const o2 = JSON.parse(jarl(root, 'import', file2, '--source', 'r2', '--kind', 'docs', '--prio', '3', '--json'));
  assert.deepEqual([o2.filed[0].kind, o2.filed[0].priority], ['docs', '3']);
  const sources = jarl(root, 'sources', file, '--source', 'core/research/2026-09-25-jarl');
  assert.match(sources, /^core\/research\/2026-09-25-jarl · 2 finding\(s\) · 2 filed · 0 unfiled · issues: open 2$/m);
  assert.match(sources, /^ {2}jarl-2-B2 {2}1 open$/m);
  const all = JSON.parse(jarl(root, 'sources', '--json'));
  assert.deepEqual(all.map((r) => r.source).sort(), ['core/research/2026-09-25-jarl', 'core/research/2026-09-25-other', 'r2']);
});

test('import reads the angles shape and the results/kept shape; refuses a finding with no id or a repeated one', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  const angles = findingsDir([
    { angle: 'first-hour', summary: 's', surviving: [{ id: 'F1', title: 'a', severity: 'major', where: 'w', evidence: 'e', adopter_impact: 'hurts', suggested_fix: 'fix it' }], refuted: [] },
    { angle: 'ci', summary: 's', surviving: [{ id: 'F1', title: 'b', severity: 'minor' }], refuted: [] },
  ]);
  const a = JSON.parse(jarl(root, 'import', angles, '--source', 'r-angles', '--json'));
  assert.deepEqual(a.filed.map((f) => [f.finding, f.priority]), [['first-hour/F1', '2'], ['ci/F1', '3']]);
  assert.match(JSON.parse(jarl(root, 'show', '1', '--json')).sections.why, /hurts/);
  const kept = findingsDir({ results: [{ area: 'check', summary: 's', kept: [{ id: 'check-F1', severity: 'minor', surfaces: 'docs', claim: 'The gate is all-or-nothing. More text.', truth: 'It is per node.', evidence: 'docs:135', fix: 'reword' }], dropped: [] }] });
  const k = JSON.parse(jarl(root, 'import', kept, '--source', 'r-kept', '--json'));
  assert.equal(k.filed[0].title, 'The gate is all-or-nothing.');
  const shown = JSON.parse(jarl(root, 'show', k.filed[0].id, '--json'));
  assert.match(shown.sections.what, /Claim: The gate[\s\S]*Truth: It is per node\.[\s\S]*docs:135/);
  assert.equal(shown.fields.where, 'docs');
  assert.match(refuses(root, 'import', findingsDir([{ title: 'no id' }])), /has no id/);
  assert.match(refuses(root, 'import', findingsDir([{ id: 'A' }, { id: 'A' }])), /appears twice/);
  assert.match(refuses(root, 'import', findingsDir({ nope: 1 })), /not a findings file/);
});

test('import --adopt links older issues that name the finding, once, without filing a duplicate', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'Jarl: bodies (jarl-2-B2)');
  jarl(root, 'new', 'minor package');
  jarl(root, 'body', '2', '--what', 'covers jarl-2-B5 and jarl-9-Z9');
  const file = findingsDir([...FLAT, { id: 'jarl-9-Z9', title: 'z' }, { id: 'jarl-2-B20', title: 'no one names me' }]);
  assert.match(jarl(root, 'import', file, '--source', 'r'), /filed 1 · already filed 0 · named by an issue without Source 3/);
  const o = JSON.parse(jarl(root, 'import', file, '--source', 'r', '--adopt', '--json'));
  assert.deepEqual(o.adopted.map((a) => [a.finding, a.issue]), [['jarl-2-B2', '1'], ['jarl-2-B5', '2'], ['jarl-9-Z9', '2']]);
  assert.equal(JSON.parse(jarl(root, 'show', '2', '--json')).fields.source, 'r#jarl-2-B5, r#jarl-9-Z9');
  assert.match(jarl(root, 'import', file, '--source', 'r'), /filed 0 · already filed 4/);
});

test('ask --kind ratify blocks nothing, is listed in status and the handoff, and its answer lands on the issue', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'limit raised');
  jarl(root, 'set', '1', 'in-progress', 'w');
  assert.match(jarl(root, 'ask', 'raised the prompt limit to 96000 under the mandate', '--kind', 'ratify', '--issue', '1'), /filed a-1 for ratification · blocks nothing/);
  assert.match(refuses(root, 'ask', 'x', '--kind', 'ratify', '--issue', '9'), /no such issue: 9/);
  const st = jarl(root, 'status');
  assert.match(st, /questions 0 · to ratify 1/);
  assert.match(st, /^ratify a-1 \(issue 1\) · raised the prompt limit/m);
  assert.match(jarl(root, 'resume'), /## Questions to the user \(0\)\n- \(nothing\)\n\n## To ratify \(1\)\n- a-1 \(issue 1\) · raised/);
  // It holds nothing back: next, done.
  jarl(root, 'review', '1', 'approve', '--by', 'rev', FINDINGS);
  jarl(root, 'evidence', '1', '--ran', 'check', '--saw', 'green');
  jarl(root, 'set', '1', 'done', 'merged');
  jarl(root, 'answer', 'a-1', 'ratified', '--by', 'owner');
  assert.match(jarl(root, 'show', '1'), /Ruling ask-1 \(ratify\): ratified/);
  assert.match(jarl(root, 'status'), /questions 0$/m);
});

test('After holds an issue out of next and counts it as waiting; decide --settles writes the ruling into issues', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  for (const t of ['release', 'cleanup', 'profile', 'numbers']) jarl(root, 'new', t);
  jarl(root, 'new', 'after the release', '--after', '1');
  jarl(root, 'set', '2,3', 'in-progress', 'raised');
  jarl(root, 'after', '2', '1'); jarl(root, 'after', '3', '1');
  assert.match(jarl(root, 'status'), /open 2 · in flight 0 · waiting 3 ·/);
  const st = JSON.parse(jarl(root, 'status', '--json'));
  assert.deepEqual([st.open, st['in-progress'], st.waiting], [3, 2, 3], 'the status counts stay counts of statuses');
  const next = jarl(root, 'next', '--all');
  assert.match(next, /^5 {2}P2 {2}after the release {2}\(after 1\)$/m);
  assert.match(next, /^1 {2}P2 {2}release/m);
  assert.match(refuses(root, 'after', '1', '5'), /would close a cycle/);
  assert.match(refuses(root, 'after', '1', '1'), /cannot wait on itself/);
  assert.match(refuses(root, 'new', 'x', '--after', '99'), /no such issue: 99/);
  jarl(root, 'set', '1', 'dropped', 'not this release');
  assert.match(jarl(root, 'status'), /in flight 2 · done/);
  assert.match(jarl(root, 'next'), /^5 {2}P2 {2}after the release/m, 'dropping 1 releases 5: it is listed as ready');
  assert.doesNotMatch(jarl(root, 'next', '--all'), /Waiting on After/, 'and no issue is left in the waiting group');
  jarl(root, 'after', '5', '--clear');
  assert.equal(JSON.parse(jarl(root, 'show', '5', '--json')).fields.after, undefined);
  // A ruling names what it settles: the ruling goes into each issue's evidence, the status stays.
  assert.match(jarl(root, 'decide', 'numbers', 'the core ships on one number', '--settles', '4'), /decided numbers · by owner · written into 4/);
  const four = JSON.parse(jarl(root, 'show', '4', '--json'));
  assert.equal(four.status, 'open');
  assert.match(four.sections.evidence, /Ruling numbers: the core ships on one number/);
  assert.match(readFileSync(join(root, '.jarl', 'decisions.md'), 'utf8'), /the core ships on one number\n\n\*\*Settles:\*\* 4/);
  assert.match(refuses(root, 'decide', 'other', 'x', '--settles', '4,77'), /no such issue: 77/);
  assert.doesNotMatch(readFileSync(join(root, '.jarl', 'decisions.md'), 'utf8'), /other/, 'a refused ruling writes nothing');
});

test('an issue file from before these fields reads and moves unchanged', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  const old = '# 1 · old one\n\n**Status:** open\n**Kind:** bug\n**Priority:** 1\n**Tier:** standard\n**Tags:** \n**Files:** a.mjs\n**Found by:** jarl\n**Where:**\n\n## What\n\n\n## Why\n\n\n## Acceptance\n\n\n## Evidence\n\n';
  writeFileSync(join(root, '.jarl', 'issues', '1-old-one.md'), old);
  const i = JSON.parse(jarl(root, 'show', '1', '--json'));
  assert.deepEqual([i.after, i.sources], [[], []]);
  assert.match(jarl(root, 'next'), /^1 {2}P1 {2}old one/);
  assert.match(jarl(root, 'status'), /open 1 · in flight 0 · done 0/);
  jarl(root, 'source', '1', 'r#A-1');
  assert.match(readFileSync(join(root, '.jarl', 'issues', '1-old-one.md'), 'utf8'), /\*\*Where:\*\*\n\*\*Source:\*\* r#A-1\n\n## What/);
});

test('replacement patterns in user text are written as they are: $1, $&, $\' and $` never expand', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'dollars', '--what', 'w');
  jarl(root, 'body', '1', '--why', "use $' here and $` and $& and $1");
  jarl(root, 'evidence', '1', "saw $' and $1");
  jarl(root, 'evidence', '1', "then $& too");
  const text = jarl(root, 'show', '1');
  assert.equal((text.match(/^## /gm) || []).length, 4, 'no section duplicated');
  const i = JSON.parse(jarl(root, 'show', '1', '--json'));
  assert.equal(i.sections.why.trim(), "use $' here and $` and $& and $1");
  assert.equal(i.sections.evidence.trim(), "### Notes\n\nsaw $' and $1\n\nthen $& too");
});

test('done: a ruling, a drop reason or a free-text note alone is not evidence; a proposal is not an acceptance line; fewer rows than lines is noted', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'settled', '--acceptance', 'npm test passes', '--acceptance', 'docs say so');
  jarl(root, 'decide', 'rule', 'keep it', '--settles', '1');
  jarl(root, 'review', '1', 'approve', '--by', 'rev', FINDINGS);
  assert.match(refuses(root, 'set', '1', 'done', 'x'), /1 has no evidence yet/);
  jarl(root, 'evidence', '1', 'merged abc');
  assert.match(refuses(root, 'set', '1', 'done', 'x'), /1 has no evidence yet/, 'a note alone sits under Notes and is not evidence of the work');
  jarl(root, 'evidence', '1', '--ran', 'npm test', '--saw', 'pass');
  const r = (() => { try { return sh(tmpdir(), `node ${SCRIPT} set 1 done m --root ${root} 2>&1`); } catch (e) { return String(e.stdout); } })();
  assert.match(r, /note: 1 2 acceptance line\(s\), 1 --ran\/--saw row\(s\)/);
  const file = findingsDir([{ id: 'jarl-3-X1', title: 'x', proposal: 'do it' }]);
  const o = JSON.parse(jarl(root, 'import', file, '--source', 'r', '--json'));
  const next = JSON.parse(jarl(root, 'next', '--json')).find((x) => x.id === o.filed[0].id);
  assert.equal(next.noAcceptance, true, 'the copied proposal is not an acceptance line yet');
  assert.deepEqual([next.waitsOn, next.after], [[], []], 'every next row carries both lists');
});

test('import never takes a short id, a header field or Evidence for a mention of the finding', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'unrelated F1 in a title', '--what', 'see F4 and C1 here');   // short ids in prose, no report named
  jarl(root, 'new', 'another', '--prio', '2');                                    // **Priority:** 2
  jarl(root, 'new', 'notes');
  jarl(root, 'evidence', '3', 'also touches jarl-2-B2');                          // named only in Evidence
  jarl(root, 'new', 'package', '--what', 'from report-x: F7 and C9');              // short id with its report named
  const file = findingsDir([{ id: 'F1', title: 'a' }, { id: 'F4', title: 'b' }, { id: 'C1', title: 'c' }, { id: '2', title: 'd' }, { id: 'jarl-2-B2', title: 'e' }, { id: 'F7', title: 'f' }]);
  const o = JSON.parse(jarl(root, 'import', file, '--source', 'core/research/report-x', '--adopt', '--dry-run', '--json'));
  assert.deepEqual(o.adopted.map((a) => [a.finding, a.issue]), [['F7', '4']]);
  assert.deepEqual(o.filed.map((f) => f.finding), ['F1', 'F4', 'C1', '2', 'jarl-2-B2']);
  // The angles shape: a bare id needs its <angle>/<id> or its report; the angle name is slugified into the key.
  const angles = findingsDir([{ angle: 'First Hour', surviving: [{ id: 'prime-teaches-removed-verdict', title: 'p' }] }]);
  const a = JSON.parse(jarl(root, 'import', angles, '--source', 'r-angles', '--dry-run', '--json'));
  assert.equal(a.filed[0].finding, 'first-hour/prime-teaches-removed-verdict');
  jarl(root, 'new', 'names it', '--what', 'first-hour/prime-teaches-removed-verdict');
  const a2 = JSON.parse(jarl(root, 'import', angles, '--source', 'r-angles', '--dry-run', '--json'));
  assert.deepEqual(a2.mentioned.map((m) => m.issue), ['5']);
});

test('import adopts a package issue whose Evidence names the report and lists the ids; short ids and other lines never match there', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'minor package');
  jarl(root, 'evidence', '1', 'Source: core/research/2026-09-25-x-audit/report.md §3, findings.json area a. Ids: area-a-01, area-a-02, F1');
  jarl(root, 'new', 'other work');
  jarl(root, 'evidence', '2', 'touches area-a-03 as well');                                  // unique id, report not on the line
  jarl(root, 'evidence', '2', 'see core/research/2026-09-25-x-audit/report.md');
  const file = findingsDir([{ id: 'area-a-01', title: 'a' }, { id: 'area-a-02', title: 'b' }, { id: 'area-a-03', title: 'c' }, { id: 'F1', title: 'd' }]);
  const o = JSON.parse(jarl(root, 'import', file, '--source', 'core/research/2026-09-25-x-audit', '--adopt', '--json'));
  assert.deepEqual(o.adopted.map((x) => [x.finding, x.issue]), [['area-a-01', '1'], ['area-a-02', '1']]);
  assert.deepEqual(o.filed.map((f) => f.finding), ['area-a-03', 'F1']);
  assert.match(jarl(root, 'import', file, '--source', 'core/research/2026-09-25-x-audit'), /filed 0 · already filed 4/);
});

// ---- packages, leases, merges, record hygiene -------------------------------------------------------

function gitLoop(...initFlags) {
  const root = mkdtempSync(join(tmpdir(), 'jarl-pkg-'));
  const run = (script, cwd = root) => sh(cwd, script);
  run('git init -q -b main && git config user.email t@t && git config user.name t && git config core.excludesFile /dev/null && echo a > a.txt && echo b > b.txt && echo c > c.txt && git add -A && git commit -qm base');
  jarl(root, 'init', 'goal', ...initFlags);
  return { root, sh: run };
}
const withStderr = (root, ...args) => run(root, args);
function editIssue(root, id, fn) {
  const dir = join(root, '.jarl', 'issues');
  const file = join(dir, readdirSync(dir).find((f) => f.startsWith(`${id}-`)));
  writeFileSync(file, fn(readFileSync(file, 'utf8')));
}

test('a worktree is looked up through git by the lease branch: locked, invisible, found without a stored path, and truly removed', () => {
  const { root, sh } = gitLoop();
  for (const t of ['locked', 'invisible', 'removed', 'closed']) jarl(root, 'new', t, '--files', 'a.txt');
  const away = join(root, '..', `${basename(root)}-away`);
  mkdirSync(away);
  // 1: locked with a reason, its directory not on this machine (a container's); the lease stores the path.
  const wt1 = join(root, '..', `${basename(root)}-wt1`);
  jarl(root, 'set', '1', 'in-progress', 'w', '--branch', 'jarl/1-locked', '--worktree', wt1);
  sh(`git worktree add -q -b jarl/1-locked ${wt1} && git worktree lock --reason devcontainer ${wt1}`);
  renameSync(wt1, join(away, 'wt1'));
  // 2: unlocked, no stored path, its whole parent directory not visible from here.
  const parent2 = join(root, '..', `${basename(root)}-p2`);
  mkdirSync(parent2);
  jarl(root, 'set', '2', 'in-progress', 'w', '--branch', 'jarl/2-invisible');
  sh(`git worktree add -q -b jarl/2-invisible ${join(parent2, 'wt')}`);
  renameSync(parent2, join(away, 'p2'));
  // 3: no stored path, directory removed under a live lease while its parent is still here.
  const wt3 = join(root, '..', `${basename(root)}-wt3`);
  jarl(root, 'set', '3', 'in-progress', 'w', '--branch', 'jarl/3-removed');
  sh(`git worktree add -q -b jarl/3-removed ${wt3}`);
  rmSync(wt3, { recursive: true, force: true });
  // 4: finished and in the base, but its locked worktree cannot be inspected from here.
  const wt4 = join(root, '..', `${basename(root)}-wt4`);
  jarl(root, 'set', '4', 'in-progress', 'w', '--branch', 'jarl/4-closed');
  sh(`git worktree add -q -b jarl/4-closed ${wt4} && git worktree lock --reason devcontainer ${wt4}`);
  renameSync(wt4, join(away, 'wt4'));
  jarl(root, 'review', '4', 'approve', '--by', 'rev', FINDINGS);
  jarl(root, 'evidence', '4', '--ran', 'check', '--saw', 'green');
  jarl(root, 'set', '4', 'done', 'merged');

  const state = (branch, stored) => worktreeState(root, branch, stored);
  assert.deepEqual([state('jarl/1-locked', wt1).state, state('jarl/1-locked').state], ['elsewhere', 'elsewhere']);
  assert.equal(state('jarl/1-locked').reason, 'devcontainer');
  assert.equal(state('jarl/2-invisible').state, 'invisible');
  assert.equal(state('jarl/3-removed').state, 'gone');
  assert.equal(state('jarl/9-nobody').state, 'none');
  assert.equal(state('jarl/9-nobody', join(root, '..', 'never-was-here')).state, 'gone');
  assert.equal(state('jarl/none-but-here', root).state, 'here');

  const st = JSON.parse(jarl(root, 'status', '--json'));
  assert.deepEqual(st.stale.map((x) => x.id), ['3']);
  assert.match(st.stale[0].problems[0], /^worktree gone: /);
  const br = jarl(root, 'branches');
  assert.match(br, /^jarl\/1-locked → 1  \+0  \S+ \(elsewhere: devcontainer\)$/m);
  assert.match(br, /^jarl\/2-invisible → 2  \+0  \S+ \(not visible from here\)$/m);
  assert.match(br, /^jarl\/3-removed → 3  \+0  \S+ \(gone\)  STALE: 3 worktree gone: /m);
  assert.match(br, /^jarl\/4-closed → 4  \+0  \S+ \(elsewhere: devcontainer\)  DONE \(worktree state unknown\)$/m);
  assert.doesNotMatch(br, /DONE → delete/);
  assert.equal(JSON.parse(jarl(root, 'branches', '--json')).find((r) => r.branch === 'jarl/4-closed').deletable, false);
});

test('a package is one lease on one branch: set records it, check --branch bounds the diff by the union, branches maps it', () => {
  const { root, sh } = gitLoop();
  jarl(root, 'new', 'one', '--files', 'a.txt');
  jarl(root, 'new', 'two', '--files', 'b.txt');
  jarl(root, 'new', 'three', '--files', 'c.txt');
  const wt = join(root, '..', `${basename(root)}-wt`);
  assert.match(jarl(root, 'set', '1-2', 'in-progress', 'package raised', '--branch', 'jarl/1-pkg', '--worker', 'w1', '--worktree', wt), /^1 → in-progress · jarl\/1-pkg · w1\n2 → in-progress · jarl\/1-pkg · w1$/);
  const shown = jarl(root, 'show', '2');
  assert.match(shown, /^\*\*Branch:\*\* jarl\/1-pkg$/m);
  assert.match(shown, /^\*\*Worker:\*\* w1$/m);
  assert.doesNotMatch(shown, /\*\*Worktree:\*\*/, 'a lease stores no worktree');
  assert.match(shown, /^\*\*Since:\*\* \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/m);
  const log = readFileSync(join(root, '.jarl', 'log.md'), 'utf8');
  assert.match(log, /2 → in-progress · package raised · branch jarl\/1-pkg · worker w1\n/);
  assert.doesNotMatch(log, /worktree/);
  assert.match(refuses(root, 'set', '3', 'open', 'x', '--branch', 'b'), /--branch goes with in-progress only/);

  sh(`git worktree add -q -b jarl/1-pkg ${wt} && cd ${wt} && echo A > a.txt && echo B > b.txt && git commit -qam work`);
  // One issue alone still fails for the files of the other; the package passes in one call.
  const alone = withStderr(root, 'check', '1', '--branch', 'jarl/1-pkg');
  assert.equal(alone.status, 2);
  assert.match(alone.stdout, /✗ diff inside declared files — outside a\.txt: b\.txt/);
  const pkg = JSON.parse(jarl(root, 'check', '--branch', 'jarl/1-pkg', '--json'));
  assert.equal(pkg.ok, true, JSON.stringify(pkg.items));
  assert.deepEqual([pkg.id, pkg.ids], [null, ['1', '2']]);
  assert.match(jarl(root, 'check', '--branch', 'jarl/1-pkg'), /^package 1, 2 on jarl\/1-pkg\n/);
  assert.match(refuses(root, 'check', '--branch', 'jarl/none'), /no issue records branch jarl\/none/);

  const rows = JSON.parse(jarl(root, 'branches', '--json'));
  assert.deepEqual(rows.map((r) => [r.branch, r.issues, r.stale, r.deletable]), [['jarl/1-pkg', ['1', '2'], [], false]]);
  assert.match(jarl(root, 'branches'), /^jarl\/1-pkg → 1, 2  \+1 /);
  assert.doesNotMatch(jarl(root, 'status'), /stale/);
});

test('check --branch notes each added line that names a loop issue by its number, and no other line', () => {
  const { root, sh: git } = gitLoop();
  for (const t of ['one', 'two', 'three']) jarl(root, 'new', t, '--files', 'a.txt');
  git('echo "old: see issue 1" > a.txt && git commit -qam base');
  git('git checkout -q -b feature');
  writeFileSync(join(root, 'a.txt'), 'keep\nsee issue 2 for it\nthe same as #3\nissue 9 is not ours\nyear 2026 and 2026-10-15\ntimeout 3 seconds\n');
  git('git commit -qam "work for issue 1"');
  const out = JSON.parse(jarl(root, 'check', '1', '--branch', 'feature', '--base', 'main', '--json'));
  assert.equal(out.ok, true, 'the notes never change ok');
  assert.deepEqual(out.notes, [
    { kind: 'issue-number', file: 'a.txt', line: 2, ids: ['2'], text: 'see issue 2 for it' },
    { kind: 'issue-number', file: 'a.txt', line: 3, ids: ['3'], text: 'the same as #3' },
  ]);
  assert.equal(out.notesOmitted, 0);
  const text = jarl(root, 'check', '1', '--branch', 'feature', '--base', 'main');
  assert.match(text, /^note a\.txt:2 names issue 2 · see issue 2 for it$/m);
  assert.match(text, /^note a\.txt:3 names issue 3 · the same as #3$/m);
});

test('check --branch refuses a branch no issue holds, and says how many commits it carries and what to file', () => {
  const { root, sh: git } = gitLoop();
  jarl(root, 'new', 'one', '--files', 'a.txt');
  git('git checkout -q -b feature && echo more >> a.txt && git commit -qam work && git checkout -q main');
  const msg = refuses(root, 'check', '--branch', 'feature', '--base', 'main');
  assert.match(msg, /^no issue records branch feature: it carries 1 commit\(s\) beyond main and no issue holds it \(work without a ticket\) — file the issue, then set it in-progress --branch feature\n$/);
  assert.match(refuses(root, 'check', '--branch', 'jarl/none'), /^no issue records branch jarl\/none — name one/);
});

test('branches marks with NO ISSUE a branch with commits that no issue holds, and no leased, empty, base or release branch', () => {
  const { root, sh: git } = gitLoop();
  jarl(root, 'new', 'one', '--files', 'a.txt');
  git('git checkout -q -b jarl/1-pkg && echo x >> a.txt && git commit -qam work && git checkout -q main');
  jarl(root, 'set', '1', 'in-progress', 'package raised', '--branch', 'jarl/1-pkg', '--worker', 'w1');
  git('git checkout -q -b jarl/9-orphan && echo y >> b.txt && git commit -qam orphan && git checkout -q main');
  git('git branch jarl/7-empty');
  const wt = join(root, '..', `${basename(root)}-rel`);
  git(`git worktree add -q -b release/9.0 ${wt} && cd ${wt} && echo r >> c.txt && git commit -qam rel && cd ${root}`);
  const text = jarl(root, 'branches');
  assert.match(text, /^jarl\/9-orphan .*NO ISSUE$/m);
  assert.doesNotMatch(text, /^jarl\/1-pkg .*NO ISSUE/m);
  assert.doesNotMatch(text, /^jarl\/7-empty .*NO ISSUE/m);
  assert.doesNotMatch(text, /^release\/9\.0 .*NO ISSUE/m);
  const rows = JSON.parse(jarl(root, 'branches', '--json'));
  const flag = Object.fromEntries(rows.map((r) => [r.branch, r.unticketed]));
  assert.deepEqual(flag, { 'jarl/1-pkg': false, 'jarl/9-orphan': true, 'jarl/7-empty': false, 'release/9.0': false });
});

test('check --branch prints at most twenty issue notes and counts the rest', () => {
  const { root, sh: git } = gitLoop();
  for (const t of ['one', 'two']) jarl(root, 'new', t, '--files', 'a.txt');
  git('git checkout -q -b feature');
  writeFileSync(join(root, 'a.txt'), Array.from({ length: 25 }, (_, i) => `line ${i} cites issue 2`).join('\n') + '\n');
  git('git commit -qam work');
  const out = JSON.parse(jarl(root, 'check', '1', '--branch', 'feature', '--base', 'main', '--json'));
  assert.equal(out.notes.length, 20);
  assert.equal(out.notesOmitted, 5);
  assert.equal(out.ok, true);
  assert.match(jarl(root, 'check', '1', '--branch', 'feature', '--base', 'main'), /^… and 5 more notes not shown$/m);
});

test('stale leases are shown, never acted on: worktree gone, branch gone, idle', () => {
  const { root, sh } = gitLoop();
  jarl(root, 'new', 'one', '--files', 'a.txt');
  jarl(root, 'new', 'two', '--files', 'b.txt');
  jarl(root, 'new', 'three', '--files', 'c.txt');
  const wt = join(root, '..', `${basename(root)}-wt`);
  jarl(root, 'set', '1', 'in-progress', 'w', '--branch', 'jarl/1-one', '--worker', 'w1', '--worktree', wt);
  sh(`git worktree add -q -b jarl/1-one ${wt} && cd ${wt} && echo A > a.txt && git commit -qam work`);
  jarl(root, 'set', '2', 'in-progress', 'w', '--branch', 'jarl/2-never-made');
  jarl(root, 'set', '3', 'in-progress', 'w');
  // The lease is as old as the journal's line for it: the stamp of that line is what ages it.
  const log = join(root, '.jarl', 'log.md');
  writeFileSync(log, readFileSync(log, 'utf8').replace(/^- \d{4}-\d{2}-\d{2} \d{2}:\d{2}( · 3 → in-progress)/m, '- 2026-01-01 00:00$1'));
  // The 2026-09-21 loss: a worktree deleted under a live lease.
  rmSync(wt, { recursive: true, force: true });
  const st = JSON.parse(jarl(root, 'status', '--json'));
  assert.deepEqual(st.stale.map((x) => x.id), ['1', '2', '3']);
  assert.match(st.stale[0].problems[0], /^worktree gone: /);
  assert.match(st.stale[1].problems[0], /^branch gone: jarl\/2-never-made$/);
  assert.match(st.stale[2].problems[0], /^idle \d+d: lease since 2026-01-01 00:00$/);
  const text = jarl(root, 'status');
  assert.match(text, /^stale 1 · worktree gone: /m);
  assert.match(text, /^stale 3 · idle /m);
  // A lease younger than --stale-hours is not idle; the lease is only shown, the issue stays in progress.
  assert.equal(JSON.parse(jarl(root, 'status', '--stale-hours', '1000000', '--json')).stale.length, 2);
  assert.match(refuses(root, 'status', '--stale-hours', 'soon'), /--stale-hours takes a positive number/);
  const br = jarl(root, 'branches');
  assert.match(br, /^jarl\/1-one → 1  \+1  \S+ \(gone\)  STALE: 1 worktree gone: /m);
  assert.match(br, /^jarl\/2-never-made → 2  GONE  STALE: 2 branch gone: jarl\/2-never-made$/m);
  assert.equal(JSON.parse(jarl(root, 'show', '1', '--json')).status, 'in-progress');
  // Leaving in-progress removes the lease and keeps the branch.
  jarl(root, 'set', '3', 'open', 'back to the queue');
  const three = jarl(root, 'show', '3');
  assert.doesNotMatch(three, /\*\*(Worker|Worktree|Since):\*\*/);
});

test('merged records the sha and CI as fields; status counts CI pending; done notes it, never refuses; branches marks done → delete', () => {
  const { root, sh } = gitLoop();
  jarl(root, 'new', 'one', '--files', 'a.txt', '--acceptance', 'a is A');
  jarl(root, 'new', 'two', '--files', 'b.txt', '--acceptance', 'b is B');
  jarl(root, 'set', '1,2', 'in-progress', 'w', '--branch', 'jarl/1-pkg', '--worker', 'w1');
  sh('git checkout -q -b jarl/1-pkg && echo A > a.txt && echo B > b.txt && git commit -qam work && git checkout -q main && git merge -q --no-ff -m "merge 1-2" jarl/1-pkg');
  const sha = sh('git rev-parse --short HEAD');
  assert.match(refuses(root, 'merged', '1'), /merged needs --sha/);
  assert.match(refuses(root, 'merged', '1', '--sha', 'nothex!'), /--sha is a commit id/);
  assert.match(refuses(root, 'merged', '1', '--ci', 'green'), /1 records no merge yet/);
  assert.match(refuses(root, 'merged', '1', '--sha', sha, '--ci', 'blue'), /--ci must be one of: pending, green, red, none/);
  assert.equal(jarl(root, 'merged', '1,2', '--sha', sha, '--keep'), `1, 2 merged ${sha}`, 'no --ci given: no CI state is recorded');
  assert.doesNotMatch(jarl(root, 'show', '1'), /\*\*CI:\*\*/);
  assert.equal(jarl(root, 'merged', '1,2', '--sha', sha, '--ci', 'pending', '--keep'),`1, 2 merged ${sha} · CI pending`);
  assert.match(jarl(root, 'show', '1'), new RegExp(`^\\*\\*Merged:\\*\\* ${sha}\\n\\*\\*CI:\\*\\* pending$`, 'm'));
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), new RegExp(`2 merged ${sha} · CI pending`));
  const st = jarl(root, 'status');
  assert.match(st, /· merged, CI pending 2/);
  assert.match(st, /^merged, CI pending: 1, 2$/m);
  // An unknown sha is recorded as given, with a note.
  assert.match(withStderr(root, 'merged', '1', '--sha', 'deadbeef').stderr, /deadbeef is not a commit in/);
  jarl(root, 'merged', '1', '--sha', sha, '--ci', 'pending', '--keep');
  jarl(root, 'review', '1,2', 'approve', '--by', 'rev', FINDINGS);
  jarl(root, 'evidence', '1,2', '--ran', 'check', '--saw', 'green');
  const done = withStderr(root, 'set', '1,2', 'done', 'merged');
  assert.equal(done.status, 0);
  assert.match(done.stderr, new RegExp(`note: 1 merged ${sha}, CI pending`));
  assert.doesNotMatch(jarl(root, 'show', '1'), /\*\*(Worker|Since):\*\*/, 'done ends the lease');
  assert.match(jarl(root, 'show', '1'), /^\*\*Branch:\*\* jarl\/1-pkg$/m, 'done keeps the branch');
  jarl(root, 'merged', '1,2', '--ci', 'green');
  assert.doesNotMatch(jarl(root, 'status'), /CI pending/);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /1 CI green/);
  assert.match(jarl(root, 'report'), new RegExp(`- 1 one \\(bug\\) · merged ${sha}`));
  assert.match(jarl(root, 'branches'), /^jarl\/1-pkg → 1, 2  \+0  \(no worktree\)  DONE → delete$/m);
  // A red CI is counted apart.
  jarl(root, 'merged', '2', '--ci', 'red');
  assert.match(jarl(root, 'status'), /· CI red 1/);
});

test('a committed loop names the loop files git has not committed in status, handoff and close; the default mode stays silent', async () => {
  const { root, sh } = gitLoop('--permanent');
  sh('git add -A && git commit -qm loop');
  assert.equal(JSON.parse(jarl(root, 'status', '--json')).uncommitted, 0);
  assert.doesNotMatch(jarl(root, 'status'), /not committed/);
  // Filed by the library: its number has three digits, so the loop keeps its format and writes no profile file.
  (await import(new URL('../record.mjs', import.meta.url).href)).newIssue(root, 'one');
  assert.match(jarl(root, 'status'), /^2 loop file\(s\) not committed — commit \.jarl\/ in the loop's repository$/m);
  assert.match(jarl(root, 'resume'), /^## Loop files not committed \(2\) — commit \.jarl\/\n- \.jarl\/issues\/001-one\.md\n- \.jarl\/log\.md$/m);
  jarl(root, 'set', '1', 'dropped', 'no');
  assert.match(jarl(root, 'close'), /closed as a permanent record · 2 loop file\(s\) not committed — commit \.jarl\//);
  sh('git add -A && git commit -qm record');
  assert.equal(JSON.parse(jarl(root, 'status', '--json')).uncommitted, 0);

  const dflt = gitLoop();
  jarl(dflt.root, 'new', 'one');
  assert.equal(JSON.parse(jarl(dflt.root, 'status', '--json')).uncommitted, null);
  const loose = repo();   // not a git repository at all
  jarl(loose, 'init', 'goal', '--committed');
  jarl(loose, 'new', 'one');
  assert.equal(JSON.parse(jarl(loose, 'status', '--json')).uncommitted, null);
});

test('issues and handoffs from before leases and merges read unchanged', () => {
  const { root } = gitLoop();
  const old = '# 1 · old one\n\n**Status:** in-progress\n**Kind:** bug\n**Priority:** 1\n**Tier:** standard\n**Tags:** \n**Files:** a.txt\n**Found by:** jarl\n**Where:**\n\n## What\n\n\n## Why\n\n\n## Acceptance\n\n\n## Evidence\n\n';
  writeFileSync(join(root, '.jarl', 'issues', '1-old-one.md'), old);
  writeFileSync(join(root, '.jarl', 'handoff.md'), '# Handoff\n\n**At:** 2026-01-01 00:00 · **Head:** main@abc1234\n\n## Summary\nold\n\n## In flight\n- 999 gone\n\n## Waiting on the user\n- (nothing)\n\n## Next\n- (nothing recorded)\n');
  const st = JSON.parse(jarl(root, 'status', '--json'));
  assert.deepEqual([st.stale, st.ciPending, st.ciRed], [[], [], []]);
  assert.equal(readFileSync(join(root, '.jarl', 'issues', '1-old-one.md'), 'utf8'), old, 'reading never writes');
  const h = jarl(root, 'handoff', 'read');
  assert.match(h, /## In flight \(1\)\n- 1 old one\n/);
  // The old file is shown whole, but below the live state and one heading level down, as history.
  assert.match(h, /\n## Earlier handoff — history, written 2026-01-01 00:00, \d+d ago; not the current state\n\*\*At:\*\* 2026-01-01 00:00 · \*\*Head:\*\* main@abc1234\n\n### Summary\nold\n\n### In flight\n- 999 gone\n/);
  assert.ok(h.indexOf('999 gone') > h.indexOf('## Last '), 'the snapshot comes after the live sections');
  assert.match(jarl(root, 'resume'), /a handoff file from before resume is kept at \.jarl\/handoff\.md, written 2026-01-01 00:00 — history, not the state; handoff read prints it\)$/);
  assert.doesNotMatch(jarl(root, 'resume'), /999 gone/, 'resume itself never prints the old snapshot');
  assert.deepEqual(JSON.parse(jarl(root, 'branches', '--json')), []);
});

test('DONE → delete needs the branch tip in the base, or in every recorded merge, and a clean worktree; a number-only match trusts ancestry alone', () => {
  const { root, sh } = gitLoop();
  const mark = (branch) => JSON.parse(jarl(root, 'branches', '--json')).find((r) => r.branch === branch)?.done ?? null;
  const close = (id) => { jarl(root, 'review', id, 'approve', '--by', 'rev', FINDINGS); jarl(root, 'evidence', id, '--ran', 'check', '--saw', 'green'); jarl(root, 'set', id, 'done', 'merged'); };
  // Merged elsewhere (a release branch, not the base): the tip is in the recorded merge, so it can go.
  jarl(root, 'new', 'elsewhere', '--files', 'a.txt');
  jarl(root, 'set', '1', 'in-progress', 'w', '--branch', 'jarl/1-else');
  sh('git checkout -q -b jarl/1-else && echo A > a.txt && git commit -qam w && git checkout -q -b rel main && git merge -q --no-ff -m m jarl/1-else && git checkout -q main');
  jarl(root, 'merged', '1', '--sha', sh('git rev-parse rel'));
  close('1');
  assert.equal(mark('jarl/1-else'), 'delete');
  // A commit on the branch after the merge: the record no longer covers it.
  sh('git checkout -q jarl/1-else && echo AA > a.txt && git commit -qam later && git checkout -q main');
  assert.equal(mark('jarl/1-else'), 'unverified');
  assert.match(jarl(root, 'branches'), /^jarl\/1-else → 1 .*DONE \(merged by record, branch not in base\) — verify$/m);
  // A squash merge, then an extra commit: never taken as merged.
  jarl(root, 'new', 'squashed', '--files', 'b.txt');
  jarl(root, 'set', '2', 'in-progress', 'w', '--branch', 'jarl/2-sq');
  sh('git checkout -q -b jarl/2-sq && echo B > b.txt && git commit -qam w && git checkout -q main && git merge -q --squash jarl/2-sq && git commit -qm squash && git checkout -q jarl/2-sq && echo BB > b.txt && git commit -qam extra && git checkout -q main');
  jarl(root, 'merged', '2', '--sha', sh('git rev-parse HEAD'));
  close('2');
  assert.equal(mark('jarl/2-sq'), 'unverified');
  // An issue from before Branch, matched by the branch's number only: a recorded merge is not trusted there.
  jarl(root, 'new', 'legacy', '--files', 'c.txt');
  sh('git checkout -q -b jarl/3-legacy && echo C > c.txt && git commit -qam w && git checkout -q -b rel3 main && git merge -q --no-ff -m m jarl/3-legacy && git checkout -q main');
  jarl(root, 'merged', '3', '--sha', sh('git rev-parse rel3'));
  close('3');
  assert.equal(mark('jarl/3-legacy'), null);
  // In the base, but its worktree holds uncommitted files.
  jarl(root, 'new', 'dirty', '--files', 'd.txt');
  const wt = join(root, '..', `${basename(root)}-wt4`);
  jarl(root, 'set', '4', 'in-progress', 'w', '--branch', 'jarl/4-dirty', '--worktree', wt);
  sh(`git worktree add -q -b jarl/4-dirty ${wt} && cd ${wt} && echo D > d.txt && git add d.txt && git commit -qm w && echo scratch > notes.txt`);
  sh('git merge -q --no-ff -m m4 jarl/4-dirty');
  close('4');
  assert.equal(mark('jarl/4-dirty'), 'dirty');
  assert.match(jarl(root, 'branches'), /^jarl\/4-dirty → 4 .*\(1 uncommitted\)  DONE \(worktree dirty\)$/m);
  rmSync(join(wt, 'notes.txt'));
  assert.equal(mark('jarl/4-dirty'), 'delete');
});

test('outside a git repository a Branch lease is not reported gone, and resume shows it with no tips', () => {
  const loose = repo();
  jarl(loose, 'init', 'goal');
  jarl(loose, 'new', 'one');
  jarl(loose, 'set', '1', 'in-progress', 'w', '--branch', 'jarl/1-one');
  assert.deepEqual(JSON.parse(jarl(loose, 'status', '--json')).stale, []);
  const r = jarl(loose, 'resume');
  assert.match(r, /- 1 one · branch jarl\/1-one · since \S+ \S+\n/);
  assert.doesNotMatch(r, /STALE|## Tips/);
});

// ---- questions with options, and their answers ------------------------------------------------------------------

const RECORD = await import(new URL('../record.mjs', import.meta.url).href);
const { oldJarl, oldJarlIsPinned } = await import(new URL('./old-jarl.mjs', import.meta.url).href);
const { noSeparators: escapeFreeText } = await import(new URL('../jarl-lib.mjs', import.meta.url).href);
const readRecord = (root, name) => readFileSync(join(root, '.jarl', name), 'utf8');

test('ask records its options and prints them, ready for the choice window; a question without options prints its number alone', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  const out = jarl(root, 'ask', 'which way?', '--option', 'Keep: the flag stays', '--option', 'Drop: the flag goes');
  assert.match(out, /^asked a-1/);
  assert.match(out, /^- Keep: the flag stays$/m);
  assert.match(out, /^- Drop: the flag goes$/m);
  assert.deepEqual(RECORD.loadAsks(root)[0].options, [{ label: 'Keep', effect: 'the flag stays' }, { label: 'Drop', effect: 'the flag goes' }]);
  assert.equal(jarl(root, 'ask', 'plain yes or no?'), 'asked a-2');
  assert.equal(RECORD.loadAsks(root)[1].options, undefined);
  assert.match(refuses(root, 'ask', 'x', '--option', 'only one: alone'), /at least two options/);
  assert.match(refuses(root, 'ask', 'x', '--option', 'no colon here'), /<label>: <effect>/);
  assert.match(refuses(root, 'ask', 'x', '--kind', 'ratify', '--option', 'A: a', '--option', 'B: b'), /ratify item is answered yes or reject/);
});

test('answer with --option marks the option chosen in the ruling; the answer in the person\'s own words is quoted as his words', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'ask', 'which way?', '--option', 'Keep: the flag stays', '--option', 'Drop: the flag goes');
  jarl(root, 'ask', 'which pair?', '--option', 'A: a', '--option', 'B: b');
  assert.match(refuses(root, 'answer', 'a-1', '--option', 'Nope'), /none of the options of a-1: Keep, Drop/);
  assert.match(refuses(root, 'answer', 'a-1', 'my words', '--option', 'Keep'), /not both/);
  assert.match(refuses(root, 'answer', 'a-2'), /answer requires/);
  jarl(root, 'answer', 'a-1', '--option', 'Drop');
  const first = readRecord(root, 'decisions.md');
  assert.match(first, /\*\*Chose:\*\* Drop/);
  assert.match(first, /^- Drop: the flag goes \(chosen\)$/m);
  assert.match(first, /^- Keep: the flag stays$/m);
  jarl(root, 'answer', 'a-2', 'both A and B');
  const second = readRecord(root, 'decisions.md').split('## ').at(-1);
  assert.match(second, /\*\*Answer in own words:\*\* both A and B/);
  assert.doesNotMatch(second, /chosen|\*\*Chose:\*\*/);
  assert.match(refuses(root, 'answer', 'a-1', '--option', 'Keep'), /already answered/);
});

test('answer takes a comma list of ratify items with one verdict, writes one ruling each naming the batch, and needs a named answerer', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'ask', 'raised the limit', '--kind', 'ratify');
  jarl(root, 'ask', 'kept the flag', '--kind', 'ratify');
  jarl(root, 'ask', 'a stuck question', '--kind', 'stuck');
  assert.match(refuses(root, 'answer', 'a-1', 'yes'), /needs --by/);
  for (const name of ['jarl', 'reeve', 'coordinator', basename(root)]) assert.match(refuses(root, 'answer', 'a-1', 'yes', '--by', name), /coordinator/);
  assert.match(refuses(root, 'answer', 'a-1,a-3', 'yes', '--by', 'owner'), /answered together only when each is a ratify item/);
  jarl(root, 'answer', '1,2', 'yes', '--by', 'owner');
  const text = readRecord(root, 'decisions.md');
  for (const n of [1, 2]) assert.match(text.split('## ').find((s) => s.includes(`ask-${n}`)), /\*\*Batch:\*\* answered together with a-1, a-2/);
  assert.equal(RECORD.loadAsks(root).filter((a) => a.state === 'answered').length, 2);
  assert.match(readRecord(root, 'decisions.md'), /\*\*By:\*\* owner/);
});

test('decide --by owner with no question in the record prints a notice on stderr; --supersedes names the open issues that name the old ruling', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'new', 'rewrite the flag handling', '--what', 'Follows flag-rule as it stands.');
  assert.match(run(root, ['decide', 'quiet-rule', 'Keep the default.', '--by', 'owner']).stderr, /no question in the record/);
  assert.equal(run(root, ['decide', 'mandate-rule', 'Keep the default.', '--by', 'jarl']).stderr, '');
  jarl(root, 'decide', 'flag-rule', 'Keep the flag.', '--by', 'jarl');
  const r = run(root, ['decide', 'flag-rule-two', 'Keep the flag, now.', '--by', 'jarl', '--supersedes', 'flag-rule']);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /open issues name flag-rule: 1 — rewrite them to flag-rule-two/);
});

test('a question with options whose label or answer holds any separator and words reads back as one field', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  const words = ['·', ' ', 'option', 'chose', 'worker', 'branch', 'x'];
  let seed = 5;
  const next = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const samples = Array.from({ length: 40 }, () => Array.from({ length: 1 + Math.floor(next() * 8) }, () => words[Math.floor(next() * words.length)]).join(''));
  const want = (s) => escapeFreeText(s);
  let n = 0;
  for (const s of samples.filter((x) => want(x) !== '')) {
    n += 1;
    jarl(root, 'ask', `question ${n}`, '--option', `${s}: effect ${n}`, '--option', `other ${n}: effect`);
    const ask = RECORD.loadAsks(root).find((a) => a.id === String(n));
    assert.equal(ask.options[0].label, want(s), `the label of ${JSON.stringify(s)}`);
    assert.equal(ask.options[0].effect, `effect ${n}`);
    jarl(root, 'answer', `a-${n}`, '--option', s);
    const line = readRecord(root, 'log.md').split('\n').find((l) => l.includes(`answered a-${n} ·`));
    const parts = line.split(' · ');
    assert.equal(parts.length, 3, `the log line of ${JSON.stringify(s)} has three fields: ${line}`);
    assert.equal(parts[2], want(s));
    assert.match(readRecord(root, 'decisions.md'), new RegExp(`\\*\\*Chose:\\*\\* ${want(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
  }
  assert.ok(n >= 20);
});

test('questions with options and their answers read through the frozen reader: the loop is read, the worker parsed, a self-approve refused, done passes', () => {
  assert.equal(oldJarlIsPinned(), true);
  const root = repo();
  jarl(root, 'init', 'goal');
  // The library writes three-digit numbers, which every reader of the format reads; the command line's plain numbers raise
  // the format by their own rule (a number under three digits), which this test does not exercise.
  RECORD.newIssue(root, 'flag work');
  RECORD.setStatus(root, '001', 'in-progress', 'started', { branch: 'jarl/001-flag-work', worker: 'w-one' });
  RECORD.ask(root, 'which way?', { option: ['Keep: the flag stays', 'Drop: the flag goes'] });
  jarl(root, 'answer', 'a-001', '--option', 'Keep');
  RECORD.ask(root, 'still open?', { option: ['Yes: wait: then', 'No: go on'] });
  for (const command of ['list', 'status', 'next', 'queue']) assert.deepEqual(oldJarl(root, command, {}).error ?? null, null, command);
  assert.match(JSON.stringify(oldJarl(root, 'list', {}).value), /w-one/, 'the worker is parsed');
  assert.match(refuses(root, 'review', '001', 'approve', '--by', 'w-one', FINDINGS), /worker|own/i);
  jarl(root, 'review', '001', 'approve', '--by', 'rev', FINDINGS);
  jarl(root, 'evidence', '001', '--ran', 'check', '--saw', 'green');
  assert.deepEqual(oldJarl(root, 'set', {}, ['001', 'done', 'merged', {}]).error ?? null, null, 'done passes');
});

test('the MCP answer tool takes one id, or a comma list of ratify items through its field id, as the command line does', async () => {
  const mcp = await import(new URL('../jarl-mcp.mjs', import.meta.url).href);
  const root = repo();
  mcp.callTool('jarl_init', { goal: 'goal', root });
  for (const question of ['raised the limit', 'kept the flag', 'dropped the old flag']) mcp.callTool('jarl_ask', { question, kind: 'ratify', root });
  const one = mcp.callTool('jarl_answer', { id: 'a-1', answer: 'yes', by: 'owner', root });
  assert.equal(one.isError, false);
  assert.match(one.content[0].text, /answered a-1/);
  const list = mcp.callTool('jarl_answer', { id: 'a-2,a-3', answer: 'yes', by: 'owner', root });
  assert.equal(list.isError, false);
  assert.match(list.content[0].text, /answered a-2[\s\S]*answered a-3/);
  assert.equal(RECORD.loadAsks(root).filter((a) => a.state === 'answered').length, 3);
});

// ---- the goal: printed, and its machine lines set ---------------------------------------------------------------

const LIB = await import(new URL('../jarl-lib.mjs', import.meta.url).href);

test('goal prints the goal; goal --set changes one machine line of each kind, with a log line that says what it was', () => {
  const root = repo();
  jarl(root, 'init', 'Ship the flag change.');
  assert.match(jarl(root, 'goal'), /^# Goal\n\nShip the flag change\.\n/);
  assert.match(jarl(root, 'goal', '--set', 'Check (Grain): cd plugins/grain && npm test'), /^goal line added: Check \(Grain\): cd plugins\/grain && npm test$/);
  jarl(root, 'goal', '--set', 'Check: npm test');
  jarl(root, 'goal', '--set', 'Model (standard): sonnet');
  jarl(root, 'goal', '--set', 'Coordinators: Ada, Grace');
  assert.match(jarl(root, 'goal', '--set', 'Check (Grain): cd plugins/grain && npm run check'), /^goal line changed: Check \(Grain\): cd plugins\/grain && npm run check \(was cd plugins\/grain && npm test\)$/);
  jarl(root, 'goal', '--set', 'Model (STANDARD): opus');
  const text = readRecord(root, 'goal.md');
  assert.equal(text.match(/^Check \(Grain\):/gm).length, 1, 'one line per kind and repository');
  assert.equal(text.match(/^Model \(standard\):/gim).length, 1);
  assert.match(text, /^Ship the flag change\.$/m, 'the goal\'s own text stays as written');
  const log = readRecord(root, 'log.md');
  assert.match(log, /goal line changed · Check \(Grain\): cd plugins\/grain && npm run check · was cd plugins\/grain && npm test$/m);
  assert.match(log, /goal line added · Coordinators: Ada, Grace$/m);
  const g = LIB.goalLines(text);
  assert.deepEqual(g.checksByRepo.repos.Grain, ['cd plugins/grain && npm run check']);
  assert.deepEqual(g.checksByRepo.bare, ['npm test']);
  assert.deepEqual(g.models, [{ tier: 'standard', models: ['opus'] }]);
  assert.deepEqual(g.coordinators, ['Ada', 'Grace']);
});

test('goal --set refuses a Model line for a tier the profile does not declare, a repository line, a Coordinators qualifier and --amend', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  assert.match(refuses(root, 'goal', '--set', 'Model (vintage): opus'), /declares no tier vintage/);
  assert.match(refuses(root, 'goal', '--set', 'Model: opus'), /names its tier/);
  assert.match(refuses(root, 'goal', '--set', 'Repository: grain'), /takes one machine line/);
  assert.match(refuses(root, 'goal', '--set', 'Coordinators (x): Ada'), /takes no qualifier/);
  assert.match(refuses(root, 'goal', '--set', 'Check (Grain):   '), /takes one machine line/);
  assert.match(refuses(root, 'goal', '--amend', 'a new paragraph'), /unknown flag --amend/);
  assert.doesNotMatch(readRecord(root, 'goal.md'), /Model|Repository|Coordinators/);
});

test('goal --set escapes the value: a separator in it reads back as a dash, and the log line keeps three fields', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'goal', '--set', 'Check (Grain): build · test');
  assert.equal(LIB.goalLines(readRecord(root, 'goal.md')).checksByRepo.repos.Grain[0], 'build - test');
  const line = readRecord(root, 'log.md').split('\n').find((l) => l.includes('goal line added'));
  assert.equal(line.split(' · ').length, 3, line);
  // Seeded samples over separators and words: each value reads back as the escaped text, and its log line has three fields.
  const words = ['·', ' ', 'option', 'chose', 'worker', 'branch', 'x'];
  let seed = 9;
  const next = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const samples = Array.from({ length: 30 }, () => Array.from({ length: 1 + Math.floor(next() * 8) }, () => words[Math.floor(next() * words.length)]).join(''));
  let n = 0;
  for (const s of samples.filter((x) => escapeFreeText(x) !== '')) {
    n += 1;
    jarl(root, 'goal', '--set', `Check (Repo${n}): ${s}`);
    assert.equal(LIB.goalLines(readRecord(root, 'goal.md')).checksByRepo.repos[`Repo${n}`][0], escapeFreeText(s).replace(/\s+/g, ' '), JSON.stringify(s));
    const logged = readRecord(root, 'log.md').split('\n').find((l) => l.includes(`Check (Repo${n}): `) && l.includes('goal line added'));
    assert.equal(logged.split(' · ').length, 3, logged);
  }
  assert.ok(n >= 15);
});

test('an answer in the person\'s own words and a batch answer read through the frozen reader: worker parsed, self-approve refused, done passes, questions counted', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  RECORD.newIssue(root, 'flag work');
  RECORD.setStatus(root, '001', 'in-progress', 'started', { branch: 'jarl/001-flag-work', worker: 'w-one' });
  RECORD.ask(root, 'which way?', { option: ['Keep: stays', 'Drop: goes'] });
  jarl(root, 'answer', 'a-001', 'x\n**Chose:** Keep\n- Keep: stays (chosen)');
  RECORD.ask(root, 'raised one', { kind: 'ratify' });
  RECORD.ask(root, 'raised two', { kind: 'ratify' });
  RECORD.ask(root, 'still open?');
  jarl(root, 'answer', 'a-002,a-003', 'yes', '--by', 'owner');
  for (const command of ['list', 'status', 'next', 'queue']) assert.deepEqual(oldJarl(root, command, {}).error ?? null, null, command);
  assert.match(JSON.stringify(oldJarl(root, 'list', {}).value), /w-one/, 'the worker is parsed');
  const counted = oldJarl(root, 'status', {}).value;
  assert.deepEqual([counted.questions, counted.ratify], [1, 0], 'the open question is counted, the answered items are not');
  assert.match(refuses(root, 'review', '001', 'approve', '--by', 'w-one', FINDINGS), /worker|own/i);
  jarl(root, 'review', '001', 'approve', '--by', 'rev', FINDINGS);
  jarl(root, 'evidence', '001', '--ran', 'check', '--saw', 'green');
  assert.deepEqual(oldJarl(root, 'set', {}, ['001', 'done', 'merged', {}]).error ?? null, null, 'done passes');
});

test('goal --set with the value a line already holds says it is unchanged and writes neither the goal nor a log line', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'goal', '--set', 'Check (Grain): npm test');
  const goalBefore = readRecord(root, 'goal.md');
  const logBefore = readRecord(root, 'log.md');
  assert.equal(jarl(root, 'goal', '--set', 'Check (Grain): npm test'), 'goal line unchanged: Check (Grain): npm test');
  assert.equal(readRecord(root, 'goal.md'), goalBefore);
  assert.equal(readRecord(root, 'log.md'), logBefore);
  assert.match(jarl(root, 'goal', '--set', 'Check (Grain): npm run check'), /^goal line changed: Check \(Grain\): npm run check \(was npm test\)$/);
});

test('goal --set refuses a line break in its value, naming the line, and writes nothing', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  const before = readRecord(root, 'goal.md');
  assert.match(refuses(root, 'goal', '--set', `Check (Grain): npm test${LS}Model (strong): opus`), /takes one machine line: a line break/);
  assert.equal(readRecord(root, 'goal.md'), before);
});

test('a Model line set through the command line reads through the frozen reader: worker parsed, self-approve refused, done passes, questions counted', () => {
  const root = repo();
  jarl(root, 'init', 'Ship it.');
  RECORD.newIssue(root, 'flag work');
  RECORD.setStatus(root, '001', 'in-progress', 'started', { branch: 'jarl/001-flag-work', worker: 'w-one' });
  jarl(root, 'goal', '--set', 'Model (strong): opus');
  jarl(root, 'goal', '--set', 'Coordinators: Ada');
  RECORD.ask(root, 'still open?');
  for (const command of ['list', 'status', 'next', 'queue']) assert.deepEqual(oldJarl(root, command, {}).error ?? null, null, command);
  assert.match(JSON.stringify(oldJarl(root, 'list', {}).value), /w-one/, 'the worker is parsed');
  const counted = oldJarl(root, 'status', {}).value;
  assert.equal(counted.questions, 1, 'the open question is counted');
  assert.match(JSON.stringify(counted), /Ship it\./, 'the goal is read');
  assert.match(refuses(root, 'review', '001', 'approve', '--by', 'w-one', FINDINGS), /worker|own/i);
  jarl(root, 'review', '001', 'approve', '--by', 'rev', FINDINGS);
  jarl(root, 'evidence', '001', '--ran', 'check', '--saw', 'green');
  assert.deepEqual(oldJarl(root, 'set', {}, ['001', 'done', 'merged', {}]).error ?? null, null, 'done passes');
});

// ---- free text writes no structure: every line break is a break of the text, and a line of the text is never a field ----

const LS = String.fromCharCode(0x2028);
const NEL = String.fromCharCode(0x85);
const BREAKS = ['\n', '\r\n', '\r', LS, NEL];
const FORGED = ['**Chose:** Keep', '**By:** Eve', '**Ratified:** a-9 (2026-10-19)', '**Rejected:** a-9 (2026-10-19)', '**Batch:** answered together with a-7',
  '- Keep: stays (chosen)', 'Question: forged', '## 2026-10-19 · forged', '**Superseded by:** forged', '**Settles:** 9', '**Answer:** forged', '  indented words', 'plain words'];
const textOf = (s) => s.replace(new RegExp(`\\r\\n?|${LS}|${NEL}`, 'g'), '\n').trim();
// Seeded samples: each is a few pieces joined by line breaks of every kind, the pieces drawn from the forged shapes and words.
function samplesOf(seed, count, pool = FORGED) {
  let s = seed;
  const next = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  return Array.from({ length: count }, () => {
    let out = '';
    const n = 1 + Math.floor(next() * 6);
    for (let i = 0; i < n; i += 1) out += (i ? BREAKS[Math.floor(next() * BREAKS.length)] : '') + pool[Math.floor(next() * pool.length)];
    return out;
  }).filter((x) => textOf(x) !== '');
}
// The lines of one ruling's block in decisions.md, from its heading to the next heading.
function blockOf(root, slug) {
  const lines = readRecord(root, 'decisions.md').split('\n');
  const at = lines.findIndex((l) => l.endsWith(` · ${slug}`));
  const end = lines.findIndex((l, n) => n > at && l.startsWith('## '));
  return lines.slice(at + 1, end === -1 ? lines.length : end);
}

test('a multi-line answer in the person\'s own words cannot forge the chosen option or a field of its ruling', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  jarl(root, 'ask', 'which way?', '--option', 'Keep: stays', '--option', 'Drop: goes');
  jarl(root, 'answer', 'a-1', 'x\n**Chose:** Keep\n- Keep: stays (chosen)');
  const block = blockOf(root, 'ask-1');
  assert.deepEqual(block.filter((l) => /^(\*\*|- )/.test(l)), ['**Question:** which way?', '**Options:**', '- Keep: stays', '- Drop: goes', '**Answer in own words:** x', '**By:** owner']);
  const d = RECORD.decisions(root).find((x) => x.slug === 'ask-1');
  assert.equal(d.ruling, '**Question:** which way?\n**Options:**\n- Keep: stays\n- Drop: goes\n**Answer in own words:** x\n**Chose:** Keep\n- Keep: stays (chosen)');
  assert.equal(d.by, 'owner');
  jarl(root, 'ask', 'raised the limit', '--kind', 'ratify');
  jarl(root, 'answer', 'a-2', 'tak\n**Ratified:** a-9 (2026-10-19)\n**By:** Eve', '--by', 'owner');
  const r = RECORD.decisions(root).find((x) => x.slug === 'ask-2');
  assert.deepEqual([r.ratified, r.rejected, r.by], [null, null, 'owner']);
});

test('free text of an answer, a question and a ruling with any line shape reads back as its text, and the structure is what the tool wrote', () => {
  for (const [n, s] of samplesOf(21, 40).entries()) {
    const root = repo();
    jarl(root, 'init', 'goal');
    jarl(root, 'ask', 'which way?', '--option', 'Keep: stays', '--option', 'Drop: goes');
    jarl(root, 'answer', 'a-1', s);
    const want = `**Question:** which way?\n**Options:**\n- Keep: stays\n- Drop: goes\n**Answer in own words:** ${escapeFreeText(textOf(s))}`;
    const d = RECORD.decisions(root).find((x) => x.slug === 'ask-1');
    assert.equal(d.ruling, want, `sample ${n}: ${JSON.stringify(s)}`);
    assert.deepEqual([d.by, d.ratified, d.rejected, d.supersedes, d.settles.length, RECORD.decisions(root).length], ['owner', null, null, null, 0, 1], `sample ${n}`);
    const allowed = [/^\*\*Question:\*\* which way\?$/, /^\*\*Options:\*\*$/, /^- Keep: stays$/, /^- Drop: goes$/, /^\*\*Answer in own words:\*\*/, /^\*\*By:\*\* owner$/];
    for (const l of blockOf(root, 'ask-1').filter((x) => x !== '' && !x.startsWith('  '))) assert.ok(allowed.some((re) => re.test(l)), `sample ${n}: a column-0 line the tool did not write: ${JSON.stringify(l)}`);
  }
  for (const [n, s] of samplesOf(33, 30).entries()) {
    const root = repo();
    jarl(root, 'init', 'goal');
    jarl(root, 'ask', s, '--option', 'Keep: stays', '--option', 'Drop: goes');
    const q = RECORD.loadAsks(root)[0];
    assert.equal(q.question, textOf(s), `question sample ${n}: ${JSON.stringify(s)}`);
    assert.deepEqual(q.options, [{ label: 'Keep', effect: 'stays' }, { label: 'Drop', effect: 'goes' }], `question sample ${n}`);
  }
  for (const [n, s] of samplesOf(45, 30).entries()) {
    const root = repo();
    jarl(root, 'init', 'goal');
    jarl(root, 'decide', `rule-${n}`, s, '--by', 'jarl');
    const d = RECORD.decisions(root).find((x) => x.slug === `rule-${n}`);
    assert.equal(d.ruling, textOf(s), `ruling sample ${n}: ${JSON.stringify(s)}`);
    assert.deepEqual([d.by, d.settles, d.supersedes, d.ratified, d.rejected], ['jarl', [], null, null, null], `ruling sample ${n}`);
  }
});

test('a line break in an option label or effect is refused, naming the flag', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  assert.match(refuses(root, 'ask', 'q', '--option', 'Keep\nx: stays', '--option', 'Drop: goes'), /--option takes one line/);
  assert.match(refuses(root, 'ask', 'q', '--option', 'Keep: stays\r', '--option', 'Drop: goes'), /--option takes one line/);
  assert.match(refuses(root, 'ask', 'q', '--option', `Keep: a${LS}b`, '--option', 'Drop: goes'), /--option takes one line/);
  assert.equal(RECORD.loadAsks(root).length, 0, 'nothing is written');
});

test('answer 6,6 writes one ruling and no error; a list with a missing or non-ratify id writes nothing', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  for (const t of ['first', 'second', 'third']) jarl(root, 'ask', t, '--kind', 'ratify');
  assert.equal(jarl(root, 'answer', 'a-1,a-1', 'yes', '--by', 'owner').split('\n').length, 1);
  assert.equal(RECORD.decisions(root).filter((d) => d.slug === 'ask-1').length, 1);
  assert.equal(RECORD.loadAsks(root).filter((a) => a.state === 'answered').length, 1);
  jarl(root, 'answer', 'a-2,a-3,a-2', 'yes', '--by', 'owner');
  assert.equal(RECORD.decisions(root).filter((d) => d.slug === 'ask-2').length, 1);
  assert.match(readRecord(root, 'decisions.md'), /\*\*Batch:\*\* answered together with a-2, a-3/);
  const before = readRecord(root, 'decisions.md');
  jarl(root, 'ask', 'stuck one', '--kind', 'stuck');
  assert.match(refuses(root, 'answer', 'a-4,a-9', 'yes', '--by', 'owner'), /no such question: a-9/);
  assert.match(refuses(root, 'answer', 'a-4,a-1', 'yes', '--by', 'owner'), /only when each is a ratify item/);
  assert.equal(readRecord(root, 'decisions.md'), before, 'a refused list writes nothing');
});

test('the supersession notice finds a slug at the end of a sentence and does not find a longer hyphenated slug', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  const ends = ['Obeys flag-rule.', 'Obeys flag-rule,', 'Obeys flag-rule;', 'Obeys flag-rule:', 'Obeys flag-rule!', 'Obeys flag-rule?', 'Obeys "flag-rule"', "Obeys 'flag-rule'", 'Obeys (flag-rule)'];
  ends.forEach((what, n) => jarl(root, 'new', `issue ${n}`, '--what', what));
  jarl(root, 'new', 'longer', '--what', 'Obeys flag-rule-two and flag-rule.v2 only.');
  jarl(root, 'decide', 'flag-rule', 'Keep the flag.', '--by', 'jarl');
  const r = run(root, ['decide', 'flag-rule-two', 'Keep the flag, now.', '--by', 'jarl', '--supersedes', 'flag-rule']);
  assert.match(r.stderr, /open issues name flag-rule: 1, 2, 3, 4, 5, 6, 7, 8, 9 — rewrite them to flag-rule-two/);
  assert.doesNotMatch(r.stderr, /, 10\b/, 'the longer slug is not found');
});

test('decide with no --by prints no notice: the owner is the default, and a notice is for an owner named on the command line', () => {
  const root = repo();
  jarl(root, 'init', 'goal');
  assert.equal(run(root, ['decide', 'default-rule', 'Keep it.']).stderr, '');
});

test('goal lines set through the command line read through the frozen reader: the loop is read, the worker parsed, done passes', () => {
  const root = repo();
  jarl(root, 'init', 'Ship it.');
  RECORD.newIssue(root, 'flag work');
  RECORD.setStatus(root, '001', 'in-progress', 'started', { branch: 'jarl/001-flag-work', worker: 'w-one' });
  jarl(root, 'goal', '--set', 'Check (Grain): npm test');
  jarl(root, 'goal', '--set', 'Model (strong): opus');
  jarl(root, 'goal', '--set', 'Coordinators: Ada');
  jarl(root, 'goal', '--set', 'Check (Grain): npm run check');
  for (const command of ['list', 'status', 'next', 'queue']) assert.deepEqual(oldJarl(root, command, {}).error ?? null, null, command);
  assert.match(JSON.stringify(oldJarl(root, 'list', {}).value), /w-one/, 'the worker is parsed');
  assert.match(JSON.stringify(oldJarl(root, 'status', {}).value), /Ship it\./, 'the goal is read');
  assert.match(refuses(root, 'review', '001', 'approve', '--by', 'w-one', FINDINGS), /worker|own/i);
  jarl(root, 'review', '001', 'approve', '--by', 'rev', FINDINGS);
  jarl(root, 'evidence', '001', '--ran', 'check', '--saw', 'green');
  assert.deepEqual(oldJarl(root, 'set', {}, ['001', 'done', 'merged', {}]).error ?? null, null, 'done passes');
});
