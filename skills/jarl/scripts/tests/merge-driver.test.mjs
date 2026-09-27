// git merges the loop's own files: decisions.md through Jarl's own driver (never a union), the journal and a
// CHANGELOG by union. The driver is pinned on its text merge, then against real `git merge` runs with the settings
// a merger passes by `-c` on every merge, and on the three ways a merge driver loses work without a word: no driver
// defined for the attribute, a driver configured whose program is gone, and a driver that exits 0 without writing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeDecisionsTexts, decisionsDriverCommand, mergeFlags, JARL_GITATTRIBUTES } from '../jarl-lib.mjs';
import { NO_EXCLUDES } from './portable.mjs';

const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const ruling = (date, slug, text, ...meta) => `## ${date} · ${slug}\n${text}\n${meta.length ? `\n${meta.join('\n')}\n` : ''}`;
const file = (...blocks) => `# Decisions\n\n${blocks.join('\n')}`;

test('decisions: new rulings of both sides are kept, ours first, and the marks one side added land on their ruling', () => {
  const base = file(ruling('2026-01-01', 'a', 'Ruling a.'));
  const ours = file(ruling('2026-01-01', 'a', 'Ruling a.', '**Ratified:** yes (2026-01-03)'), ruling('2026-01-02', 'b', 'Ruling b.'));
  const theirs = file(ruling('2026-01-01', 'a', 'Ruling a.', '**Type log:** service · 2026-01-04T00:00:00.000Z'), ruling('2026-01-02', 'c', 'Ruling c.'));
  const r = mergeDecisionsTexts(base, ours, theirs);
  assert.equal(r.ok, true, r.conflicts && r.conflicts.join('; '));
  assert.match(r.text, /## 2026-01-01 · a\nRuling a\.\n\n\*\*Ratified:\*\* yes \(2026-01-03\)\n\*\*Type log:\*\* service/);
  assert.ok(r.text.indexOf('· b') < r.text.indexOf('· c'), 'ours before theirs');
});

test('decisions: a ruling both sides superseded is refused with markers — never two successors in force', () => {
  const base = file(ruling('2026-01-01', 'x', 'The ruling.'));
  const ours = file(ruling('2026-01-01', 'x', 'The ruling.', '**Superseded by:** y (2026-01-02)'), ruling('2026-01-02', 'y', 'Ours replaces it.', '**Supersedes:** x'));
  const theirs = file(ruling('2026-01-01', 'x', 'The ruling.', '**Superseded by:** z (2026-01-02)'), ruling('2026-01-02', 'z', 'Theirs replaces it.', '**Supersedes:** x'));
  const r = mergeDecisionsTexts(base, ours, theirs);
  assert.equal(r.ok, false);
  assert.match(r.conflicts.join('\n'), /x is superseded on both sides/);
  assert.match(r.text, /^<<<<<<< ours$/m);
  assert.match(r.text, /Ours replaces it\./);
  assert.match(r.text, /Theirs replaces it\./);
});

test('decisions: two successors are refused even when a side\'s mark on the old ruling is missing', () => {
  const base = file(ruling('2026-01-01', 'x', 'The ruling.'));
  const ours = file(ruling('2026-01-01', 'x', 'The ruling.'), ruling('2026-01-02', 'y', 'Ours.', '**Supersedes:** x'));
  const theirs = file(ruling('2026-01-01', 'x', 'The ruling.'), ruling('2026-01-02', 'z', 'Theirs.', '**Supersedes:** x'));
  const r = mergeDecisionsTexts(base, ours, theirs);
  assert.equal(r.ok, false);
  assert.match(r.text, /^<<<<<<< ours$/m);
});

test('decisions: a slug both sides added with different rulings is refused; the same ruling added twice is one', () => {
  const base = file(ruling('2026-01-01', 'a', 'A.'));
  const dup = mergeDecisionsTexts(base, file(ruling('2026-01-01', 'a', 'A.'), ruling('2026-01-02', 'n', 'Ours.')), file(ruling('2026-01-01', 'a', 'A.'), ruling('2026-01-02', 'n', 'Theirs.')));
  assert.equal(dup.ok, false);
  assert.match(dup.conflicts.join('\n'), /n: both sides added a ruling with this slug/);
  const same = mergeDecisionsTexts(base, file(ruling('2026-01-01', 'a', 'A.'), ruling('2026-01-02', 'n', 'Same.')), file(ruling('2026-01-01', 'a', 'A.'), ruling('2026-01-02', 'n', 'Same.')));
  assert.equal(same.ok, true);
  assert.equal((same.text.match(/· n$/gm) || []).length, 1);
});

test('decisions: a ruling both sides rewrote is refused', () => {
  const base = file(ruling('2026-01-01', 'a', 'A.'));
  const r = mergeDecisionsTexts(base, file(ruling('2026-01-01', 'a', 'A, ours.')), file(ruling('2026-01-01', 'a', 'A, theirs.')));
  assert.equal(r.ok, false);
});

// ---- real merges ------------------------------------------------------------------------------------

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-merge-'));
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'core.excludesFile', NO_EXCLUDES);
  const jarl = (...args) => execFileSync(process.execPath, [SCRIPT, ...args, '--root', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = (m) => { g('add', '-A'); g('commit', '-qm', m); };
  const merge = (branch, settings = []) => spawnSync('git', [...settings, 'merge', '--no-edit', branch], { cwd: dir, encoding: 'utf8' });
  return { dir, g, jarl, commit, merge, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const decisionsOf = (dir) => readFileSync(join(dir, '.jarl', 'decisions.md'), 'utf8');
/** The `-c` settings mergeFlags prints, as git arguments. */
const settings = (driver = decisionsDriverCommand()) => ['-c', `merge.jarl-decisions.driver=${driver}`];

test('a committed loop gets its merge setup: .jarl/.gitattributes and the decisions driver in the local configuration', () => {
  const r = repo();
  try {
    r.jarl('init', 'goal', '--committed');
    assert.equal(readFileSync(join(r.dir, '.jarl', '.gitattributes'), 'utf8'), JARL_GITATTRIBUTES);
    assert.equal(r.g('config', '--local', '--get', 'merge.jarl-decisions.driver'), decisionsDriverCommand());
    const flags = mergeFlags({ yg: 'yg' });
    assert.match(flags, /merge\.jarl-decisions\.driver=/);
    assert.match(flags, /merge\.yg-log\.driver=yg merge-driver log %O %A %B %P/);
    assert.match(flags, /merge\.yg-lock\.driver=yg merge-driver lock %O %A %B %P/);
    const out = execFileSync(process.execPath, [SCRIPT, 'merge-driver', 'flags'], { encoding: 'utf8' });
    assert.match(out, /^-c 'merge\.jarl-decisions\.name=/);
  } finally { r.done(); }
});

test('a loop out of git gets no merge setup', () => {
  const r = repo();
  try {
    r.jarl('init', 'goal');
    assert.equal(existsSync(join(r.dir, '.jarl', '.gitattributes')), false);
    assert.equal(spawnSync('git', ['config', '--local', '--get', 'merge.jarl-decisions.driver'], { cwd: r.dir }).status, 1);
  } finally { r.done(); }
});

function twoBranchesDecide(r, onB, onMain) {
  r.jarl('init', 'goal', '--committed');
  r.jarl('decide', 'base-ruling', 'The ruling both start from.');
  r.commit('base');
  r.g('checkout', '-q', '-b', 'b');
  onB();
  r.commit('b');
  r.g('checkout', '-q', 'main');
  onMain();
  r.commit('main');
}

test('git merge with the -c settings: both sides\' rulings and journal lines are kept, no conflict', () => {
  const r = repo();
  try {
    twoBranchesDecide(r, () => r.jarl('decide', 'from-b', 'Side b rules this.'), () => r.jarl('decide', 'from-main', 'Side main rules that.'));
    const m = r.merge('b', settings());
    assert.equal(m.status, 0, m.stderr);
    const text = decisionsOf(r.dir);
    assert.match(text, /· from-b\n/);
    assert.match(text, /· from-main\n/);
    assert.doesNotMatch(text, /^<<<<<<< /m);
    const log = readFileSync(join(r.dir, '.jarl', 'log.md'), 'utf8');
    assert.match(log, /from-b/);
    assert.match(log, /from-main/);
    assert.doesNotMatch(log, /^<<<<<<< /m);
  } finally { r.done(); }
});

test('git merge with the -c settings: two branches superseding one ruling stop on decisions.md, with markers', () => {
  const r = repo();
  try {
    twoBranchesDecide(r,
      () => r.jarl('decide', 'from-b', 'Side b replaces it.', '--supersedes', 'base-ruling'),
      () => r.jarl('decide', 'from-main', 'Side main replaces it.', '--supersedes', 'base-ruling'));
    const m = r.merge('b', settings());
    assert.notEqual(m.status, 0);
    assert.match(m.stderr, /base-ruling is superseded on both sides/);
    const text = decisionsOf(r.dir);
    assert.match(text, /^<<<<<<< ours$/m);
    assert.match(text, /Side b replaces it\./);
    assert.match(text, /Side main replaces it\./);
  } finally { r.done(); }
});

test('fact 13, a: an attribute naming a driver nobody defined gives git\'s own markers, never a union', () => {
  const r = repo();
  try {
    twoBranchesDecide(r, () => r.jarl('decide', 'from-b', 'B.'), () => r.jarl('decide', 'from-main', 'M.'));
    r.g('config', '--local', '--remove-section', 'merge.jarl-decisions');
    const m = r.merge('b');
    assert.notEqual(m.status, 0);
    assert.match(decisionsOf(r.dir), /^<<<<<<< /m);
  } finally { r.done(); }
});

test('fact 13, b: a driver configured whose script is gone falls back to markers instead of keeping ours alone', () => {
  const r = repo();
  try {
    twoBranchesDecide(r, () => r.jarl('decide', 'from-b', 'B.'), () => r.jarl('decide', 'from-main', 'M.'));
    const m = r.merge('b', settings(decisionsDriverCommand(process.execPath, join(r.dir, 'gone', 'jarl.mjs'))));
    assert.notEqual(m.status, 0);
    const text = decisionsOf(r.dir);
    assert.match(text, /^<<<<<<< /m);
    assert.match(text, /from-b/);
  } finally { r.done(); }
});

test('fact 13, b\': a driver program that is there but fails without writing (an older yg with no merge-driver) still gives markers', () => {
  const r = repo();
  try {
    writeFileSync(join(r.dir, '.gitattributes'), '/x.md merge=yg-log\n/decisions.md merge=jarl-decisions\n');
    writeFileSync(join(r.dir, 'x.md'), 'base\n');
    writeFileSync(join(r.dir, 'decisions.md'), file(ruling('2026-01-01', 'a', 'A.')));
    r.commit('base');
    r.g('checkout', '-q', '-b', 'b');
    writeFileSync(join(r.dir, 'x.md'), 'from b\n');
    writeFileSync(join(r.dir, 'decisions.md'), file(ruling('2026-01-01', 'a', 'A.'), ruling('2026-01-02', 'b', 'B.')));
    r.commit('b');
    r.g('checkout', '-q', 'main');
    writeFileSync(join(r.dir, 'x.md'), 'from main\n');
    writeFileSync(join(r.dir, 'decisions.md'), file(ruling('2026-01-01', 'a', 'A.'), ruling('2026-01-02', 'm', 'M.')));
    r.commit('main');
    // An "older yg" at a path with a space: it knows no merge-driver command, exits 1 and writes nothing.
    const old = join(r.dir, 'old yg.mjs');
    writeFileSync(old, "console.error(\"error: unknown command 'merge-driver'\"); process.exit(1);\n");
    const flags = mergeFlags({ yg: `"${process.execPath.replace(/\\/g, '/')}" "${old.replace(/\\/g, '/')}"` });
    const m = spawnSync('sh', ['-c', `git ${flags} merge --no-edit b`], { cwd: r.dir, encoding: 'utf8' });
    assert.notEqual(m.status, 0);
    const x = readFileSync(join(r.dir, 'x.md'), 'utf8');
    assert.match(x, /^<<<<<<< /m, 'markers, not ours alone');
    assert.match(x, /from b/);
    // The decisions driver in the same line still merged its file cleanly.
    assert.match(readFileSync(join(r.dir, 'decisions.md'), 'utf8'), /· b\n[\s\S]*· m\n|· m\n[\s\S]*· b\n/);
  } finally { r.done(); }
});

test('fact 13, c: the driver never exits 0 without writing — a clean merge leaves the merged rulings in the file', () => {
  const r = repo();
  try {
    twoBranchesDecide(r, () => r.jarl('decide', 'from-b', 'B.'), () => r.jarl('decide', 'from-main', 'M.'));
    const before = decisionsOf(r.dir);
    const m = r.merge('b', settings());
    assert.equal(m.status, 0, m.stderr);
    assert.notEqual(decisionsOf(r.dir), before);
    assert.match(decisionsOf(r.dir), /from-b/);
    // And the driver itself, run directly: exit 0 means <ours> holds the merge.
    const dir = mkdtempSync(join(tmpdir(), 'jarl-drv-'));
    try {
      const [o, a, b] = ['O', 'A', 'B'].map((n) => join(dir, n));
      writeFileSync(o, file(ruling('2026-01-01', 'a', 'A.')));
      writeFileSync(a, file(ruling('2026-01-01', 'a', 'A.'), ruling('2026-01-02', 'o', 'O.')));
      writeFileSync(b, file(ruling('2026-01-01', 'a', 'A.'), ruling('2026-01-02', 't', 'T.')));
      const run = spawnSync(process.execPath, [SCRIPT, 'merge-driver', 'decisions', o, a, b], { encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
      assert.match(readFileSync(a, 'utf8'), /· o\n[\s\S]*· t\n/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  } finally { r.done(); }
});

test('CHANGELOG by union: entries both sides add under [Unreleased] stay under their own headings, never interleaved', () => {
  const r = repo();
  try {
    writeFileSync(join(r.dir, '.gitattributes'), '/CHANGELOG.md merge=union\n');
    const log = (added, fixed) => `# Changelog\n\n## [Unreleased]\n\n### Added\n\n${added.map((a) => `- ${a}\n`).join('')}\n### Fixed\n\n${fixed.map((f) => `- ${f}\n`).join('')}\n## [1.0.0] - 2026-01-01\n\n### Added\n\n- First.\n`;
    writeFileSync(join(r.dir, 'CHANGELOG.md'), log(['Base.'], ['Base fix.']));
    r.commit('base');
    r.g('checkout', '-q', '-b', 'b');
    writeFileSync(join(r.dir, 'CHANGELOG.md'), log(['Base.', 'From b.'], ['Base fix.', 'Fix from b.']));
    r.commit('b');
    r.g('checkout', '-q', 'main');
    writeFileSync(join(r.dir, 'CHANGELOG.md'), log(['Base.', 'From main.'], ['Base fix.', 'Fix from main.']));
    r.commit('main');
    const m = r.merge('b');
    assert.equal(m.status, 0, m.stderr);
    const text = readFileSync(join(r.dir, 'CHANGELOG.md'), 'utf8');
    const section = (from, to) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from) + from.length));
    const added = section('### Added', '### Fixed');
    const fixed = section('### Fixed', '## [1.0.0]');
    for (const e of ['Base.', 'From b.', 'From main.']) assert.ok(added.includes(`- ${e}`), `${e} under Added`);
    for (const e of ['Base fix.', 'Fix from b.', 'Fix from main.']) assert.ok(fixed.includes(`- ${e}`), `${e} under Fixed`);
    assert.equal((text.match(/^## \[Unreleased\]$/gm) || []).length, 1);
  } finally { r.done(); }
});
