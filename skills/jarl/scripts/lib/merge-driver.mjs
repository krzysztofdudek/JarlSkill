// Git merges the loop's own files: the decisions driver and the flags a merger passes.

import { writeFileSync } from 'node:fs';
import { git } from './git.mjs';
import { readText } from './files.mjs';
import { DECISIONS_FILE, DECISION_HEAD, DECISION_META } from './journal.mjs';
import { decisionsDriverCommand, guardedDriver } from './loop-git.mjs';

// ---- git merges the loop's own files ----------------------------------------------------------------
//
// A committed loop travels with the branches, so git merges its files whenever two of them meet. The journal is one
// dated line per event, so a union of both sides is its merge. The decisions are never a union: a union joins lines,
// and a ruling is a block whose closing fields (Superseded by, Ratified, …) are added in place later — a union can
// pin a `**Superseded by:**` line to the wrong ruling and let two rulings each supersede one ruling. They get a
// driver of their own, mergeDecisionsTexts, run by git as `jarl.mjs merge-driver decisions %O %A %B`.

const SINGLE_VALUED = new Set(['By', 'Supersedes', 'Superseded by', 'Area', 'Reach', 'Ratified', 'Rejected', 'Type log']);

// The decisions as blocks: the text before the first ruling, then one block per `## <date> · <slug>` heading — the
// same reading loadDecisions makes — each with its ruling text and its closing field lines kept apart.
function decisionBlocks(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const pre = [];
  const blocks = [];
  for (const line of lines) {
    const h = DECISION_HEAD.exec(line);
    if (h) { blocks.push({ slug: h[2], head: line, body: [] }); continue; }
    (blocks.length ? blocks[blocks.length - 1].body : pre).push(line);
  }
  const trimEnd = (a) => { const out = [...a]; while (out.length && out[out.length - 1].trim() === '') out.pop(); return out; };
  return {
    pre: trimEnd(pre).join('\n'),
    blocks: blocks.map((b) => {
      const body = trimEnd(b.body);
      let cut = body.length;
      while (cut > 0 && (body[cut - 1].trim() === '' || DECISION_META.test(body[cut - 1]))) cut -= 1;
      const meta = body.slice(cut).filter((l) => l.trim() !== '');
      return { slug: b.slug, head: b.head, ruling: trimEnd(body.slice(0, cut)).join('\n'), meta, text: [b.head, ...body].join('\n') };
    }),
  };
}

// One ruling both sides changed since the base: mergeable only when both kept the heading and the ruling text and
// only added closing fields — their union, base's first, then ours', then theirs'. A field that holds one value
// (Superseded by, Ratified, …) given two different values is a conflict, and two successors is the double
// supersession this driver exists to refuse.
function mergeRuling(b, o, t) {
  if (o.head !== t.head || o.ruling !== t.ruling || (b && (b.head !== o.head || b.ruling !== o.ruling))) return { conflict: `${o.slug}: both sides changed the ruling's text` };
  const meta = [...(b ? b.meta : [])];
  for (const line of [...o.meta, ...t.meta]) if (!meta.includes(line)) meta.push(line);
  const byField = new Map();
  for (const line of meta) {
    const m = DECISION_META.exec(line);
    if (!m || !SINGLE_VALUED.has(m[1])) continue;
    const value = m[1] === 'Superseded by' ? m[2].trim().split(/\s/)[0] : m[2].trim();
    const seen = byField.get(m[1]);
    if (seen !== undefined && seen !== value) {
      return { conflict: m[1] === 'Superseded by' ? `${o.slug} is superseded on both sides — by ${seen} and by ${value}` : `${o.slug}: both sides wrote **${m[1]}:** with different values` };
    }
    byField.set(m[1], value);
  }
  return { text: [o.head, ...(o.ruling ? [o.ruling] : []), ...(meta.length ? ['', ...meta] : [])].join('\n') };
}

// What git's decisions driver writes: { ok: true, text } for a clean merge, or { ok: false, text, conflicts } with
// every conflicting ruling between conflict markers (ours, then theirs) and every other ruling merged, so the person
// resolving sees each conflict where it is. Refused: a ruling both sides superseded (two successors in force), a slug
// both sides added with different rulings, a ruling both sides rewrote, and one side changed while the other removed
// it. Blocks keep ours' order, then theirs' new ones; a ruling one side changed and the other did not takes the change.
export function mergeDecisionsTexts(base, ours, theirs) {
  const B = decisionBlocks(base);
  const O = decisionBlocks(ours);
  const T = decisionBlocks(theirs);
  const index = (d) => new Map(d.blocks.map((b) => [b.slug, b]));
  const [bi, oi, ti] = [index(B), index(O), index(T)];
  const conflicts = [];
  const out = [];
  const marked = (o, t, why) => { conflicts.push(why); out.push(`<<<<<<< ours\n${o ? o.text : ''}\n=======\n${t ? t.text : ''}\n>>>>>>> theirs`); };
  const one = (b, o, t) => {
    const same = (x, y) => (x ? x.text : null) === (y ? y.text : null);
    if (same(o, t)) { if (o) out.push(o.text); return; }
    if (same(o, b)) { if (t) out.push(t.text); return; }
    if (same(t, b)) { if (o) out.push(o.text); return; }
    if (!o || !t) { marked(o, t, `${(o || t).slug}: one side changed the ruling, the other removed it`); return; }
    if (!b) { marked(o, t, `${o.slug}: both sides added a ruling with this slug`); return; }
    const r = mergeRuling(b, o, t);
    if (r.conflict) marked(o, t, r.conflict); else out.push(r.text);
  };
  for (const o of O.blocks) one(bi.get(o.slug), o, ti.get(o.slug));
  for (const t of T.blocks) if (!oi.has(t.slug)) one(bi.get(t.slug), undefined, t);
  // Two new rulings that each supersede the same one: caught above when both marked it, and here when a side's mark
  // is missing (a hand edit), since a merge must never leave two successors of one ruling in force.
  const successors = new Map();
  for (const [side, d] of [['ours', O], ['theirs', T]]) {
    for (const b of d.blocks) {
      if (bi.has(b.slug)) continue;
      const m = b.meta.map((l) => DECISION_META.exec(l)).find((x) => x && x[1] === 'Supersedes');
      if (!m) continue;
      const target = m[2].trim();
      const was = successors.get(target);
      if (was && was.side !== side && was.slug !== b.slug) conflicts.push(`${target} is superseded on both sides — by ${was.slug} and by ${b.slug}`);
      else successors.set(target, { side, slug: b.slug });
    }
  }
  let pre = O.pre;
  if (O.pre !== T.pre) {
    if (O.pre === B.pre) pre = T.pre;
    else if (T.pre !== B.pre) { conflicts.push('both sides changed the text before the first ruling'); pre = `<<<<<<< ours\n${O.pre}\n=======\n${T.pre}\n>>>>>>> theirs`; }
  }
  const text = `${[pre, ...out].filter((s) => s !== '').join('\n\n')}\n`;
  if (!conflicts.length) return { ok: true, text };
  // A conflict found only by the successor scan leaves no marker of its own: mark the whole merge, so git stops.
  const line = (x) => (x === '' || x.endsWith('\n') ? x : `${x}\n`);
  return { ok: false, conflicts, text: text.includes('\n<<<<<<< ours\n') || text.startsWith('<<<<<<< ours\n') ? text : `<<<<<<< ours\n${line(ours)}=======\n${line(theirs)}>>>>>>> theirs\n` };
}

// The `-c` settings a merger passes on every `git merge`, so the drivers run whatever the clone's own configuration
// holds: the decisions driver always, and Yggdrasil's log and lock drivers when a Yggdrasil command is given (a
// repository with a graph). One shell-quoted line, ready to put between `git` and `merge`.
export function mergeFlags({ yg } = {}) {
  const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const pairs = [['merge.jarl-decisions.name', `jarl ${DECISIONS_FILE}`], ['merge.jarl-decisions.driver', decisionsDriverCommand()]];
  if (yg) {
    for (const kind of ['log', 'lock']) {
      pairs.push([`merge.yg-${kind}.name`, `Yggdrasil ${kind}`], [`merge.yg-${kind}.driver`, guardedDriver(`${yg} merge-driver ${kind} %O %A %B %P`)]);
    }
  }
  return pairs.map(([k, v]) => `-c ${sq(`${k}=${v}`)}`).join(' ');
}

// jarl.mjs merge-driver decisions <base> <ours> <theirs> — what git runs. The result always replaces <ours> before a
// clean exit; a refusal writes the markers and exits 1 so git stops on the file; anything unexpected hands the file
// to git's own text merge with markers, so ours is never left alone as if it were the answer.
export function runDecisionsDriver(basePath, oursPath, theirsPath) {
  try {
    const r = mergeDecisionsTexts(readText(basePath), readText(oursPath), readText(theirsPath));
    writeFileSync(oursPath, r.text);
    if (r.ok) return { code: 0, conflicts: [] };
    return { code: 1, conflicts: r.conflicts };
  } catch (e) {
    git(process.cwd(), ['merge-file', '-L', 'ours', '-L', 'base', '-L', 'theirs', oursPath, basePath, theirsPath]);   // merge-file exits with the number of conflicts
    return { code: 1, conflicts: [`the decisions driver failed (${e.message}); git's text merge with markers was written instead`] };
  }
}
