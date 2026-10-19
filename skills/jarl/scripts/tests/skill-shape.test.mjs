// The shape of the skill: a short SKILL.md that every session loads, and references one level below it that a role loads
// when it needs them. `shapeProblems` reads a skill directory (SKILL.md and references/) and lists every way it breaks
// the shape; the first test holds the real skill to it, and each test after it breaks one condition in a scratch copy
// and proves the check names it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { SKILL_DIR } from './helpers.mjs';

const MAX_LINES = 250;
const MAX_BYTES = 25 * 1024;
const MAX_DESCRIPTION = 1024;
const MAX_NAME = 64;
// A reference over either size opens with a table of contents.
const TOC_FROM_LINES = 60;
const TOC_FROM_BYTES = 20 * 1024;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FILE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const FIRST_PERSON = /\b(?:I|I'm|I'll|I've|my|mine|me|we|our|ours|us|you|your|yours)\b/i;
// A version number or a version-shaped token: dotted numbers, a number with an x, a v with digits.
const VERSIONED = /\b\d+\.\d+(?:\.\d+)?\b|\b\d+\.x\b|\bv\d+(?:\.\d+)*\b/;
// A word of history: the skill speaks only of Jarl as it is now. Code is data and is left out of this reading.
const HISTORY = /\b(?:older|earlier|no longer|new in|used to|legacy|backward|compatible with|predates?|formerly|from before|as before|as (?:it|they) always did)\b/i;
const SINCE = /\bsince\b|(?:^|[.!?]\s)Since\b(?![:,*])/m;
// A task by number or its story: the word issue, ticket, package or round followed by a number, a bare hash number,
// or the words of a report on a task.
// Also the words that tell what once happened instead of stating the rule.
const TASK = /\((?:issues?|tickets?|packages?|rounds?|tasks?)\s+#?\d+|\(#?\d{2,4}\)|(?:^|[^a-z])(?:issues?|tickets?|packages?|rounds?|tasks?)\s+#?\d+|#\d+|field report|\bin practice\b|\bhas produced\b/i;
// The words the owner ruled out: the old flag name of the lease, the old name of the command that measures a branch,
// and the claim as a name of the lease. Code spans keep the key `claim` of a research finding.
const OLD_NAMES = [
  [/holds-claim/, 'the old flag name of the lease'],
  [/\bjarl(?:\.mjs)? check\b|`check [<\[-]|`check` (?:on|takes|reads|refuses)|\bon `check`|\(`check`,/, 'check as the name of the command that measures a branch (it is scope)'],
];
const CLAIM = /\bclaim\b/i;
// A list item glued to the line before it: the closing mark of a sentence or a bracket, then a list marker and the start
// of an entry (bold, a code span or a link) with no space or line break between; or a table row glued to the row before.
const GLUED = /[.;:)\]]- (?:\*\*|`|\[)|\|\|\s*`/;
// The sentences outside the glossary that open with a glossary term and is or are without defining it, as
// [file, a fragment of the line]. Each states a rule or a fact about the term; none defines it.
const DEFINITION_ALLOWED = [
  ['references/commands.md', 'The profile is checked as its own reader checks it'],
  ['references/composers.md', 'the notes are for a person at the command line'],
  ['references/composers.md', 'the mode is written at init'],
  ['references/models.md', 'a model is measured only on the work it was given'],
  ['references/profile.md', 'the evidence row is asked for either way'],
  ['references/profile.md', 'The gate is checked at the move'],
];

const lf = (text) => text.replace(/\r\n/g, '\n');
// The lines outside fenced code blocks, as [{ n, text }].
function proseLines(text) {
  const out = [];
  let fenced = false;
  lf(text).split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return; }
    if (!fenced) out.push({ n: i + 1, text: line });
  });
  return out;
}
const withoutCodeSpans = (line) => line.replace(/`[^`\n]*`/g, '');
const slugOf = (heading) => heading.replace(/`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*/g, '').toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-');
// The anchors a file offers: one per heading outside code, a repeated heading numbered the way GitHub numbers it.
function anchorsOf(text) {
  const seen = new Map();
  const out = new Set();
  for (const { text: line } of proseLines(text)) {
    const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!h) continue;
    const base = slugOf(h[1]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    out.add(count ? `${base}-${count}` : base);
  }
  return out;
}
function frontmatterOf(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(lf(text));
  if (!m) return null;
  const fields = {};
  const lines = m[1].split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[2];
    if (/^[>|][+-]?$/.test(value)) {
      value = '';
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) { i += 1; value += `${value ? ' ' : ''}${lines[i].trim()}`; }
    }
    fields[kv[1]] = value.replace(/^(["'])(.*)\1$/, '$2');
  }
  return fields;
}
const hasTableOfContents = (text) => {
  const lines = lf(text).split('\n');
  const at = lines.slice(0, 30).findIndex((l) => /^##\s+(?:table of )?contents\s*$/i.test(l));
  if (at < 0) return false;
  let entries = 0;
  for (const l of lines.slice(at + 1)) {
    if (/^#{1,6}\s/.test(l)) break;
    if (/^\s*[-*]\s.*\]\(#[^)]+\)/.test(l)) entries += 1;
  }
  return entries >= 2;
};

// Every way the skill directory `dir` breaks the shape, one sentence each.
export function shapeProblems(dir) {
  const problems = [];
  const skillPath = join(dir, 'SKILL.md');
  if (!existsSync(skillPath)) return ['SKILL.md is missing'];
  const refsDir = join(dir, 'references');
  const entries = existsSync(refsDir) ? readdirSync(refsDir, { withFileTypes: true }) : [];
  const refs = [];
  for (const e of entries) {
    if (e.isDirectory()) problems.push(`references/${e.name} is a directory: references sit one level below SKILL.md, never nested`);
    else if (!FILE_NAME.test(e.name)) problems.push(`references/${e.name} is not a descriptive lower-case hyphenated .md file name`);
    else refs.push(`references/${e.name}`);
  }
  const files = ['SKILL.md', ...refs.sort()];
  const text = new Map(files.map((f) => [f, lf(readFileSync(join(dir, f), 'utf8'))]));

  const skill = text.get('SKILL.md');
  const skillLines = skill.replace(/\n$/, '').split('\n').length;
  if (skillLines > MAX_LINES) problems.push(`SKILL.md has ${skillLines} lines, over ${MAX_LINES}`);
  const skillBytes = Buffer.byteLength(skill);
  if (skillBytes > MAX_BYTES) problems.push(`SKILL.md has ${skillBytes} bytes, over ${MAX_BYTES}`);

  const front = frontmatterOf(skill);
  if (!front) problems.push('SKILL.md has no frontmatter');
  else {
    if (!front.name || !NAME.test(front.name) || front.name.length > MAX_NAME) problems.push(`frontmatter name "${front.name}" is not lower-case hyphenated of at most ${MAX_NAME} characters`);
    if (!front.description) problems.push('frontmatter has no description');
    else {
      if (front.description.length > MAX_DESCRIPTION) problems.push(`frontmatter description has ${front.description.length} characters, over ${MAX_DESCRIPTION}`);
      const person = FIRST_PERSON.exec(front.description);
      if (person) problems.push(`frontmatter description is not third person: "${person[0]}"`);
    }
  }

  const anchors = new Map(files.map((f) => [f, anchorsOf(text.get(f))]));
  const linkedFromSkill = new Set();
  for (const f of files) {
    for (const { n, text: line } of proseLines(text.get(f))) {
      for (const m of withoutCodeSpans(line).matchAll(/\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g)) {
        const target = m[1];
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
        const where = `${f}:${n}`;
        if (target.includes('\\')) { problems.push(`${where}: link "${target}" uses a backslash`); continue; }
        const [path, anchor] = target.split('#');
        const targetPath = path ? relative(dir, resolve(dirname(join(dir, f)), path)).split('\\').join('/') : f;
        if (path && !existsSync(join(dir, targetPath))) { problems.push(`${where}: link "${target}" names a missing file`); continue; }
        if (f === 'SKILL.md' && path && refs.includes(targetPath)) linkedFromSkill.add(targetPath);
        if (anchor !== undefined && anchor !== '') {
          const known = anchors.get(targetPath) ?? (targetPath.endsWith('.md') && existsSync(join(dir, targetPath)) ? anchorsOf(lf(readFileSync(join(dir, targetPath), 'utf8'))) : null);
          if (!known) problems.push(`${where}: link "${target}" has an anchor on a file that has none`);
          else if (!known.has(anchor)) problems.push(`${where}: link "${target}" names an anchor that does not exist`);
        }
      }
    }
  }
  for (const r of refs) if (!linkedFromSkill.has(r)) problems.push(`${r} is not linked from SKILL.md`);

  for (const r of refs) {
    const lines = text.get(r).replace(/\n$/, '').split('\n').length;
    const bytes = Buffer.byteLength(text.get(r));
    if ((lines > TOC_FROM_LINES || bytes > TOC_FROM_BYTES) && !hasTableOfContents(text.get(r))) problems.push(`${r} has ${lines} lines and ${bytes} bytes and no table of contents at the top`);
  }

  // A term of the glossary is defined in the glossary and nowhere else: no other file opens a sentence with the term
  // followed by is or are. Fenced code, code spans and the Runes blocks are not read.
  const glossary = text.get('references/glossary.md') ?? '';
  const terms = [...glossary.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
  for (const f of files.filter((x) => x !== 'references/glossary.md')) {
    const owned = runesLines(text.get(f));
    for (const { n, text: line } of proseLines(text.get(f))) {
      if (owned.has(n)) continue;
      const prose = withoutCodeSpans(line);
      for (const term of terms) {
        const re = new RegExp(`(?:^|[.!?:;]\\s+|\\|\\s+|^[-*\\s]+)(?:\\*\\*)?(?:the|a|an) ${term}s?(?:\\*\\*)? (?:is|are) `, 'i');
        if (re.test(prose) && !DEFINITION_ALLOWED.some(([file, fragment]) => file === f && line.includes(fragment))) problems.push(`${f}:${n}: defines "${term}", which glossary.md defines: ${line.trim().slice(0, 60)}`);
      }
    }
  }

  for (const f of files) {
    const owned = runesLines(text.get(f));
    for (const [re, what] of OLD_NAMES) text.get(f).split('\n').forEach((line, i) => { if (!owned.has(i + 1) && re.test(line)) problems.push(`${f}:${i + 1}: ${what}: ${line.trim().slice(0, 60)}`); });
    for (const { n, text: line } of proseLines(text.get(f))) if (!owned.has(n) && CLAIM.test(withoutCodeSpans(line))) problems.push(`${f}:${n}: claim as a name of the lease (say lease): ${line.trim().slice(0, 60)}`);
  }

  for (const f of files) {
    const body = text.get(f);
    const owned = runesLines(body);
    body.split('\n').forEach((line, i) => {
      if (owned.has(i + 1)) return;
      if (VERSIONED.test(line)) problems.push(`${f}:${i + 1}: a version number: ${line.trim().slice(0, 60)}`);
      if (TASK.test(line)) problems.push(`${f}:${i + 1}: a task number or story: ${line.trim().slice(0, 60)}`);
    });
    for (const { n, text: line } of proseLines(body)) {
      if (owned.has(n)) continue;
      // Two list items or entries on one line: the end of a sentence, a bracket or a code span followed at once by the
      // marker of the next item, with no line break between them.
      if (GLUED.test(line)) problems.push(`${f}:${n}: a list item or table row glued to the one before it: ${line.trim().slice(0, 60)}`);
      const prose = withoutCodeSpans(line);
      if (HISTORY.test(prose) || SINCE.test(prose)) problems.push(`${f}:${n}: a word of history: ${line.trim().slice(0, 60)}`);
    }
  }
  return problems;
}
// The numbers of the lines inside the blocks between the Runes markers: shared fragments that Runes writes and the
// vendoring pins, changed in Runes and never here, so the words of this check do not read them.
function runesLines(text) {
  const out = new Set();
  let inside = false;
  text.split('\n').forEach((line, i) => {
    if (/^<!-- RUNES:[a-z-]+:START -->$/.test(line)) inside = true;
    if (inside) out.add(i + 1);
    if (/^<!-- RUNES:[a-z-]+:END -->$/.test(line)) inside = false;
  });
  return out;
}

test('the skill is a short SKILL.md with references one level below it, each linked from it, and it speaks only of the present', () => {
  assert.deepEqual(shapeProblems(SKILL_DIR), []);
});

// ---- each condition broken in a scratch copy of the skill's markdown --------------------------------------------------

function scratchCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'jarl-shape-'));
  cpSync(join(SKILL_DIR, 'SKILL.md'), join(dir, 'SKILL.md'));
  cpSync(join(SKILL_DIR, 'references'), join(dir, 'references'), { recursive: true });
  // The one file outside the markdown that the references link.
  mkdirSync(join(dir, 'scripts'));
  cpSync(join(SKILL_DIR, 'scripts', 'record.mjs'), join(dir, 'scripts', 'record.mjs'));
  return dir;
}
// Breaks one file of a scratch copy with `change(text)` and returns what the check says.
function broken(file, change) {
  const dir = scratchCopy();
  const path = join(dir, file);
  const before = readFileSync(path, 'utf8');
  const after = change(before);
  assert.notEqual(after, before, 'the mutation changed the file');
  writeFileSync(path, after);
  return shapeProblems(dir);
}
const names = (problems, fragment) => problems.filter((p) => p.includes(fragment));
const frontmatter = (fields) => (t) => t.replace(/^---\n[\s\S]*?\n---\n/, `---\n${fields}\n---\n`);

test('a scratch copy that is not broken passes, so every failure below comes from its mutation', () => {
  assert.deepEqual(shapeProblems(scratchCopy()), []);
});

test('a SKILL.md over its line budget fails', () => {
  assert.ok(names(broken('SKILL.md', (t) => `${t}${'a line\n'.repeat(MAX_LINES)}`), 'lines, over').length);
});

test('a SKILL.md over its byte budget fails', () => {
  assert.ok(names(broken('SKILL.md', (t) => `${t}\n${'x'.repeat(MAX_BYTES)}\n`), 'bytes, over').length);
});

test('a link to a file that is not there fails', () => {
  assert.ok(names(broken('SKILL.md', (t) => t.replace('(references/glossary.md)', '(references/none.md)')), 'missing file').length);
});

test('a link to an anchor that is not there fails, in SKILL.md and in a reference', () => {
  assert.ok(names(broken('SKILL.md', (t) => t.replace('commands.md#the-commands', 'commands.md#no-such-heading')), 'anchor that does not exist').length);
  assert.ok(names(broken('references/jarl.md', (t) => t.replace('(#resuming-a-loop)', '(#no-such-heading)')), 'anchor that does not exist').length);
});

test('a link that uses a backslash fails', () => {
  assert.ok(names(broken('SKILL.md', (t) => t.replace('(references/glossary.md)', '(references\\glossary.md)')), 'backslash').length);
});

test('a reference that SKILL.md does not link fails', () => {
  const dir = scratchCopy();
  writeFileSync(join(dir, 'references', 'extra.md'), '# Extra\n\nText.\n');
  assert.deepEqual(names(shapeProblems(dir), 'not linked from SKILL.md'), ['references/extra.md is not linked from SKILL.md']);
});

test('a reference over 100 lines with no table of contents fails, and one with a table passes', () => {
  assert.ok(names(broken('references/jarl.md', (t) => t.replace('## Contents', '## Overview')), 'no table of contents').length);
  assert.ok(names(broken('references/jarl.md', (t) => t.replace(/- \[The loop\]\(#the-loop\).*\n/, '')), 'no table of contents').length === 0);
});

test('a reference file name that is not lower-case hyphenated, and a nested reference directory, fail', () => {
  const dir = scratchCopy();
  writeFileSync(join(dir, 'references', 'Bad_Name.md'), '# Bad\n');
  mkdirSync(join(dir, 'references', 'deeper'));
  writeFileSync(join(dir, 'references', 'deeper', 'more.md'), '# More\n');
  const problems = shapeProblems(dir);
  assert.ok(names(problems, 'descriptive lower-case').length, problems.join('\n'));
  assert.ok(names(problems, 'never nested').length, problems.join('\n'));
});

test('a frontmatter description over its limit, in the first person, or missing fails', () => {
  assert.ok(names(broken('SKILL.md', frontmatter(`name: jarl\ndescription: ${'word '.repeat(300)}`)), 'characters, over').length);
  assert.ok(names(broken('SKILL.md', frontmatter('name: jarl\ndescription: I run a loop of issues and my workers do them.')), 'third person').length);
  assert.ok(names(broken('SKILL.md', frontmatter('name: jarl\ndescription: Runs a loop. Use it when you have many issues.')), 'third person').length);
  assert.ok(names(broken('SKILL.md', frontmatter('name: jarl')), 'no description').length);
});

test('a frontmatter name that is not lower-case hyphenated, or is over 64 characters, fails', () => {
  assert.ok(names(broken('SKILL.md', frontmatter('name: Jarl_Skill\ndescription: Runs a loop.')), 'frontmatter name').length);
  assert.ok(names(broken('SKILL.md', frontmatter(`name: ${'a'.repeat(65)}\ndescription: Runs a loop.`)), 'frontmatter name').length);
  assert.ok(names(broken('SKILL.md', (t) => t.replace(/^---\n[\s\S]*?\n---\n/, '')), 'no frontmatter').length);
});

test('a version number or a version-shaped token in SKILL.md or a reference fails', () => {
  for (const [file, text] of [['SKILL.md', 'Jarl 6.2.0 reads it.'], ['references/models.md', 'It works with 1.0.'], ['references/record.md', 'A 6.x loop.'], ['references/worker.md', 'The v2 shape.']]) {
    assert.ok(names(broken(file, (t) => `${t}\n${text}\n`), 'a version number').length, text);
  }
});

test('a word of history in SKILL.md or a reference fails, and the same word inside code does not', () => {
  const sentences = ['The loop reads older files.', 'An earlier reader refuses it.', 'It no longer works.', 'Text that is new in the tool.', 'It used to work.', 'A legacy file.', 'Backward rules.', 'It stays compatible with the reader.', 'It runs since the start.', 'Since the last start it works.', 'A file kept from before.'];
  for (const sentence of sentences) assert.ok(names(broken('references/worker.md', (t) => `${t}\n${sentence}\n`), 'a word of history').length, sentence);
  assert.deepEqual(names(broken('references/worker.md', (t) => `${t}\nThe key \`since\` and the field **Since:** and \`legacyHandoff\`.\n`), 'a word of history'), []);
});

test('a task number or the story of a task in SKILL.md or a reference fails', () => {
  for (const text of ['It was fixed (issue 12).', 'See ticket 3.', 'The package 4 ships.', 'In round 5 it failed.', 'The #281 shape.']) {
    assert.ok(names(broken('references/merger.md', (t) => `${t}\n${text}\n`), 'a task number').length, text);
  }
});

test('a sentence outside the glossary that defines a glossary term fails, and a sentence that only uses the term does not', () => {
  for (const sentence of ['The worker is an agent that does one issue.', 'A reviewer is the agent that gives a verdict.', 'The merger is the agent that lands a branch.', 'A lease is what an issue holds.', '- The profile is a file that names statuses.']) {
    assert.ok(names(broken('references/worker.md', (t) => `${t}\n${sentence}\n`), 'which glossary.md defines').length, sentence);
  }
  assert.deepEqual(names(broken('references/worker.md', (t) => `${t}\nThe worker records the proof and the reviewer reads it.\nThe key \`the worker is\` is code.\n`), 'which glossary.md defines'), []);
});

test('the old name of the lease flag, the old name of the scope command and the claim as a name of the lease fail', () => {
  assert.ok(names(broken('references/profile.md', (t) => `${t}\nThe flag holds-claim marks it.\n`), 'old flag name').length);
  for (const text of ['Run jarl check on the branch.', 'Run jarl.mjs check 7 --branch b.', 'The `check <id>` command reads it.', 'The `check` on it takes --repo.']) {
    assert.ok(names(broken('references/repositories.md', (t) => `${t}\n${text}\n`), 'it is scope').length, text);
  }
  assert.ok(names(broken('references/profile.md', (t) => `${t}\nA status that holds the claim.\n`), 'claim as a name of the lease').length);
  assert.deepEqual(names(broken('references/profile.md', (t) => `${t}\nThe finding key \`claim\` and the check that decides landing, \`check\`.\n`), 'it is scope'), []);
  assert.deepEqual(names(broken('references/profile.md', (t) => `${t}\nThe finding key \`claim\`.\n`), 'claim as a name'), []);
});

test('a reference over 60 lines, or over 20 KB, with no table of contents fails; so does a link with a title to a missing file', () => {
  for (const [name, body] of [['long', `# Long\n\n${'A line.\n'.repeat(70)}`], ['heavy', `# Heavy\n\n${`${'x'.repeat(2000)}\n`.repeat(11)}`]]) {
    const dir = scratchCopy();
    writeFileSync(join(dir, 'references', `${name}.md`), body);
    assert.ok(names(shapeProblems(dir), `references/${name}.md has`).length, name);
  }
  assert.ok(names(broken('SKILL.md', (t) => `${t}\n[x](references/none.md "a title")\n`), 'missing file').length);
});

test('a task by a bare hash number, by the word task, or told as a story fails', () => {
  for (const text of ['See #7 for it.', 'The task 12 ships it.', 'It has produced a rewritten HEAD in practice.', 'In practice it broke.']) {
    assert.ok(names(broken('references/merger.md', (t) => `${t}\n${text}\n`), 'a task number').length, text);
  }
});

test('a list item or a table row glued onto the end of the line before it fails, and a list that is broken into lines does not', () => {
  const glued = names(broken('references/commands.md', (t) => t.replace(/\)\.\n(- \*\*`list --json`\*\*)/, ').$1')), 'glued');
  assert.equal(glued.length, 1, glued.join('\n'));
  assert.ok(names(broken('references/jarl.md', (t) => `${t}\n- one item.- **two** items\n`), 'glued').length);
  assert.ok(names(broken('references/jarl.md', (t) => `${t}\n| a | b |\n|---|---|\n| \`x\` | y || \`z\` | w |\n`), 'glued').length);
  assert.deepEqual(names(broken('references/jarl.md', (t) => `${t}\n- one item.\n- **two** items\n`), 'glued'), []);
});

test('the checks read the files a scratch copy was made of, not the real skill', () => {
  const dir = scratchCopy();
  assert.notEqual(resolve(dir), resolve(SKILL_DIR));
  assert.ok(statSync(join(dir, 'SKILL.md')).isFile());
});
