// The commands that open and put away a loop: init and archive, and the templates a loop keeps.

import { existsSync, mkdirSync, readdirSync, readFileSync, openSync, closeSync, writeSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { hole, jarlLine, need, refuse, slugify } from './base.mjs';
import { issuesDir, jarlDir, today } from './where.mjs';
import { readText, renameRetry, writeAtomic } from './files.mjs';
import { loadProfile, profilePath, readProfileFile } from './profile.mjs';
import { appendLog, decisionsPath, goalPath, logPath } from './journal.mjs';
import { JARL_GITIGNORE, JARL_GITIGNORE_COMMITTED, ensureLoopMerge, outOfGit } from './loop-git.mjs';
import { FIELD_RE, loadIssues, parseIssue } from './issues.mjs';
import { declaredChecks } from './metrics.mjs';
import { modelLines } from './models.mjs';
import { hasLiveLoop, needLifecycle } from './shared.mjs';

export const PERMANENT_MARKER = 'This loop is a permanent record: it is not tied to a feature branch, and `close` never removes this directory. See SKILL.md.\n';

export function cmdInit(root, goal, flags = {}) {
  need(flags.committed === undefined || flags.committed === true, '--committed takes no value — put the goal first: init "<goal>" --committed', () => ({ rename: '--committed', to: hole('<no-flag-here>') }));
  need(flags.permanent === undefined || flags.permanent === true, '--permanent takes no value — put the goal first: init "<goal>" --permanent', () => ({ rename: '--permanent', to: hole('<no-flag-here>') }));
  need(goal, 'init requires "<goal>"', () => ({ arg: 0, value: '<goal>' }));
  need(!hasLiveLoop(root), '.jarl/ already exists here with a live loop — resume it, or archive it first', ['jarl.mjs', 'archive', '<slug>']);
  // The profile is read and checked before anything is written: a bad one leaves no half-opened loop behind.
  const prof = flags.profile !== undefined ? readProfileFile(flags.profile) : null;
  // A .jarl/ left behind by `archive` holds only archive/ and the mode markers, and the new loop
  // keeps that mode: the markers are the loop's own record of how it lives in git.
  const archived = existsSync(jarlDir(root));
  let permanent = flags.permanent === true;
  let committed = flags.committed === true || permanent;
  if (archived) {
    const kept = existsSync(join(jarlDir(root), '.permanent')) ? 'permanent' : outOfGit(root) ? 'default' : 'committed';
    const asked = permanent ? 'permanent' : committed ? 'committed' : null;
    need(asked === null || asked === kept, `this .jarl/ keeps its archived loops in the ${kept} mode, and a new loop here keeps that mode — run init without --${asked}`, () => ({ rename: `--${asked}`, to: hole('<no-flag-here>') }));
    permanent = kept === 'permanent';
    committed = kept !== 'default';
  }
  mkdirSync(issuesDir(root), { recursive: true });
  if (!archived) writeAtomic(join(jarlDir(root), '.gitignore'), committed ? JARL_GITIGNORE_COMMITTED : JARL_GITIGNORE);
  if (!archived && permanent) writeAtomic(join(jarlDir(root), '.permanent'), PERMANENT_MARKER);
  writeAtomic(goalPath(jarlDir(root)), `# Goal\n\n${goal.trim()}\n\n## Assumptions\n\n## Rules that apply here\n`);
  writeAtomic(decisionsPath(jarlDir(root)), '# Decisions\n');
  writeAtomic(logPath(jarlDir(root)), '# Log\n\n');
  if (prof) writeAtomic(profilePath(root), `${JSON.stringify(prof.json, null, 2)}\n`);
  if (committed) ensureLoopMerge(root);
  appendLog(root, `opened · ${goal.trim()}${prof ? ` · profile ${prof.profile.name}` : ''}`);
  // Said once, on the command line: a goal that names no check lands its merges on testimony, whatever they record.
  const noCheck = flags.caller === 'cli' && declaredChecks(root).length === 0;
  // The same for the models: a goal with no Model line leaves every model unplaced, and `models` can rank nothing.
  const noModels = flags.caller === 'cli' && !modelLines(root).declared;
  return { dir: jarlDir(root), committed, permanent, ...(prof ? { profile: prof.profile.name } : {}),
    ...(noModels ? { modelNote: `the goal declares no Model line ("Model (<tier>): <model-id>"), so models places no model and ranks none until it does — add one for each tier: ${jarlLine('goal', '--set', hole('<machine-line>'))}` } : {}), ...(noCheck ? { note: 'the goal names no check (a "Check: <command>" line, or "Check (<name>): <command>" for one repository) — this loop lands on testimony alone, whatever its merges record, until the goal declares one' } : {}) };
}

// What stays in .jarl/ when a loop is archived: the archive itself, the markers that say how the loop lives in
// git, so the next loop opened here keeps the same mode, and the issue templates, which belong to the place, not
// to one loop.
export const ARCHIVE_KEEPS = new Set(['archive', 'templates', '.gitignore', '.gitattributes', '.permanent', '.lock', '.lock.break']);

// archive "<slug>" — put the current loop away under .jarl/archive/<yyyy.mm.dd>-<slug>/ so a new one
// can be opened here with init. Everything but the archive and the mode markers moves: issues, goal,
// decisions, log, handoff. Open work is not a refusal (archiving is how a session sets old work
// aside), but the result names it, and the loop's own log records the move before it goes.
export function cmdArchive(root, slug, flags = {}) {
  need(slug, 'archive requires "<slug>", a short name for the loop being put away', () => ({ arg: 0, value: '<slug>' }));
  need(hasLiveLoop(root), existsSync(jarlDir(root)) ? `no loop to archive here — .jarl/ holds only earlier archives; open one with: ${jarlLine('init', '<goal>')}` : 'no .jarl/ here', () => (['jarl.mjs', 'init', '<goal>']));
  needLifecycle(root, 'archive', flags.caller);
  const name = `${today().replace(/-/g, '.')}-${slugify(slug)}`;
  const dest = join(jarlDir(root), 'archive', name);
  need(!existsSync(dest), `.jarl/archive/${name} already exists — pick another slug`, () => ({ replace: slug, value: '<a-new-slug>' }));
  const profile = loadProfile(root);
  const left = loadIssues(root).filter((i) => profile.unfinished(i.status)).map((i) => i.id);
  appendLog(root, `archived → .jarl/archive/${name}${left.length ? ` · ${left.length} still open or in progress: ${left.join(', ')}` : ''}`);
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(jarlDir(root))) {
    if (ARCHIVE_KEEPS.has(entry)) continue;
    renameRetry(join(jarlDir(root), entry), join(dest, entry));
  }
  return { archived: dest, leftOpen: left };
}

// Put a written temporary file in place under a name that must not exist yet: a hard link never overwrites,
// so it is the claim. On a file system without hard links, an exclusive create and a copy of the content
// do the same (the lock already keeps other writers out; readers may see the file an instant before it
// is complete). False when the name is taken.
const NO_LINKS = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV']);

export function claimFile(tmp, file, link = linkSync) {
  try { link(tmp, file); return true; } catch (e) {
    if (e.code === 'EEXIST') return false;
    if (!NO_LINKS.has(e.code)) throw e;
  }
  let fd;
  try { fd = openSync(file, 'wx'); } catch (e) { if (e.code === 'EEXIST') return false; throw e; }
  try { writeSync(fd, readFileSync(tmp)); } finally { closeSync(fd); }
  return true;
}

// A template is .jarl/templates/<name>.md: an issue file without a number — header fields (Kind, Priority, Tier, Tags,
// Files) as defaults and What, Why, Acceptance and Changelog sections as the body. A flag given on the call wins over
// the template, field by field and section by section. Templates are the loop's own and outlive it: archive keeps them.
export const TEMPLATE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export function templatesDir(root) { return join(jarlDir(root), 'templates'); }

export function readTemplate(root, name) {
  need(typeof name === 'string' && TEMPLATE_RE.test(name), `a template is named by letters, digits and . _ - (the file .jarl/templates/<name>.md) — not "${name}"`, () => ({ replace: name, value: '<template>' }));
  const path = join(templatesDir(root), `${name}.md`);
  if (!existsSync(path)) {
    const have = existsSync(templatesDir(root)) ? readdirSync(templatesDir(root)).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)) : [];
    refuse(`no template ${name} in ${templatesDir(root)} — ${have.length ? `templates here: ${have.join(', ')}` : 'none here yet; write one as an issue file without a number (see references/jarl.md, "Templates")'}, or file it without one`, { replace: name, value: hole('<template>') });
  }
  // The template is read as an issue whose title line may be anything: only its fields and sections count. A template
  // that starts straight with a field has no title line, so that first field is read as a field, not dropped.
  const raw = readText(path);
  const t = parseIssue(FIELD_RE.test(raw.split('\n')[0]) ? `# template\n${raw}` : raw, path);
  const section = (k) => (t.sections[k] !== undefined && t.sections[k].trim() ? t.sections[k].trim() : undefined);
  return {
    kind: t.fields.kind || undefined, prio: t.fields.priority || undefined, tier: t.fields.tier || undefined,
    tags: t.fields.tags || undefined, files: t.fields.files || undefined,
    what: section('what'), why: section('why'), acceptance: section('acceptance'), changelog: section('changelog'),
    // Every field and section as read, for the ones a loop's profile declares (see cmdNew).
    allFields: t.fields, section,
  };
}
