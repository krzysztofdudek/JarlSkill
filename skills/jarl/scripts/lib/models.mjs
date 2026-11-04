// The model of every worker and reviewer.

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fieldText, need } from './base.mjs';
import { canonical, jarlDir } from './where.mjs';
import { cmpId } from './ids.mjs';
import { loadProfile } from './profile.mjs';
import { GOAL_FILE, LOG_FILE, goalLines, logPath, readGoal } from './journal.mjs';
import { repoLabel, reposNamed } from './repositories.mjs';
import { readLoop } from './loop.mjs';
import { filedAndClosed, followUpsOf, share } from './metrics.mjs';

// ---- the model of every worker and reviewer ------------------------------------------------------------------------
//
// The record names who worked and who reviewed; the model is the one missing fact. It rides the two calls that name the
// agent anyway (set in-progress --model, review --model), is stored as given (the platform's model id, with @<effort> where
// the platform has that lever, so the calibrated unit is the pair), and Jarl keeps no list of models. Everything derived
// from it is read-only and only ever suggests: Jarl never refuses, reroutes or changes anything by model.

export const MODEL_MIN_N = 5;
// A finding that opens like a field would read as one: its line gets a lead-in, so no free text is ever a model or a relay mark.
const loggedFinding = (line) => (/^(model |relayed( ·|$))/i.test(line) ? `findings: ${line}` : line);

// A --model value: the platform's model id as given, trimmed. One value, and never the log's own separator.
function modelValue(raw) {
  const m = fieldText(raw);
  need(typeof raw === 'string' && m, '--model needs a value — the platform\'s model id, with @<effort> where the platform has a reasoning-effort lever');
  need(!m.includes(' · '), `--model is one value, the model id as the platform names it — not a phrase with " · " in it (got "${m}")`);
  return m;
}
const baseModelId = (m) => String(m).split('@')[0];
// The identity of a model: ids that are the same once every '.' is written as '-' are one model, with or without
// @<effort>. Every comparison of models in this module goes through it; the log keeps each id as it was written.
const modelKey = (m) => (m == null ? m : String(m).replace(/\./g, '-'));

// The model lines of the goal: `Model (<tier>): <model>[, <model>…]` (see goalLines). The first model of a line is the
// tier's default; the order of the profile's tiers, weakest first, ranks the models; a model on no line is unplaced and
// ranks below every placed one. The same id at another effort sits where the id sits.
export function modelLines(root) { return modelLinesIn(goalLines(readGoal(jarlDir(root))), loadProfile(root)); }
function modelLinesIn(lines, profile) {
  const byTier = {};
  for (const line of lines.models) {
    const tier = profile.tiers.find((t) => t.toLowerCase() === line.tier.toLowerCase());
    if (!tier) continue;
    byTier[tier] = [...(byTier[tier] || []), ...line.models];
  }
  const exact = new Map();
  const base = new Map();
  profile.tiers.forEach((t, k) => (byTier[t] || []).forEach((m) => {
    const key = modelKey(m);
    exact.set(key, Math.max(k, exact.get(key) ?? -1));
    base.set(baseModelId(key), Math.max(k, base.get(baseModelId(key)) ?? -1));
  }));
  const rank = (model) => {
    if (model == null) return -1;
    const key = modelKey(model);
    return exact.has(key) ? exact.get(key) : base.get(baseModelId(key)) ?? -1;
  };
  return {
    declared: Object.keys(byTier).length > 0, byTier, tiers: profile.tiers, rank,
    defaultOf: (tier) => (byTier[tier] || [])[0] || null,
    placedTier: (model) => (rank(model) >= 0 ? profile.tiers[rank(model)] : null),
  };
}

// Every model an issue was leased on, from its own journal (a takeover adds one).
function leaseModels(events) {
  return events.filter((e) => e.type === 'move' && e.model).map((e) => e.model);
}

// The notes a verdict gets on the command line in a loop that declares model lines: never a refusal.
function reviewModelNotes(issue, verdict, model, lines, events) {
  if (model === undefined) return [`${issue.id}: no --model on this verdict — the loop declares its models; record the model this reviewer was raised on`];
  if (verdict !== 'approve') return [];
  const leased = [...new Set(leaseModels(events))];
  if (!leased.length) return [];
  if (leased.some((w) => modelKey(w) === modelKey(model))) return [`${issue.id}: an approve by the same model as the worker's (${model}) — a fresh instance is still a fresh reviewer, but the correlation risk is real; the approve that clears an issue comes from another model, not a lower-ranked one, until \`models\` says otherwise`];
  const top = Math.max(...leased.map(lines.rank));
  if (top >= 0 && lines.rank(model) < top) return [`${issue.id}: ${model} ranks below the worker's model (${leased.find((w) => lines.rank(w) === top)})${lines.rank(model) < 0 ? ' — it is on no model line, and an unplaced model ranks below every placed one' : ''}; the approve that clears an issue comes from a model of at least the worker's rank, until \`models\` says it may clear`];
  return [];
}

// The note a call gets on the command line when its --model spells a model the record holds in another spelling: null
// when the record holds this spelling, or holds no spelling of the model. The loop is read before the call writes its line.
function spellingNote(loop, model) {
  if (model === undefined) return null;
  const held = [...new Set(loop.events.map((e) => e.model).filter((m) => m && modelKey(m) === modelKey(model)))];
  if (!held.length || held.includes(model)) return null;
  return `${model} is another spelling of ${held.join(', ')}, which the record holds; models counts both as one model.`;
}

const issueRepoLabels = (dir, issue) => {
  const named = reposNamed(issue);
  return named.length ? [...new Set(named.map((n) => repoLabel(n, dir)))] : [repoLabel(resolve(dir))];
};

// What one loop's record shows of its workers (one row per unit: one worker on one branch, which is one issue or one
// package leased in one call; a takeover starts a new unit) and of its verdicts, each with the model beside the name.
function modelFacts(loop, label, lines) {
  builds.modelsTable += 1;
  const { profile, issues, byId } = loop;
  const dir = loop.root;
  const journal = loop.eventsById;
  const closes = (st) => profile.is(st, 'closes-record');
  const claims = (st) => profile.is(st, 'holds-claim');
  const eventsOf = (id) => journal.get(id) || [];
  const { filed, firstClose } = filedAndClosed(issues, journal, profile);
  const follow = followUpsOf(issues, filed, firstClose, profile);

  // The units: every lease that names a worker, grouped by branch, worker and model. The model is grouped by its key, so two
  // spellings of one model make one unit, and the unit keeps each spelling its leases were written with.
  const unitMap = new Map();
  for (const { id } of issues) {
    for (const e of eventsOf(id)) {
      if (e.type !== 'move' || !e.lease) continue;
      const key = `${e.lease.branch || id}\n${e.lease.worker}\n${modelKey(e.lease.model) || ''}`;
      const u = unitMap.get(key) || { worker: e.lease.worker, model: e.lease.model, spellings: new Set(), issues: new Map() };
      if (e.lease.model) u.spellings.add(e.lease.model);
      if (!u.issues.has(id)) u.issues.set(id, e.n);
      unitMap.set(key, u);
    }
  }
  // One issue inside one unit: from its lease to the next lease of another worker or model on it (a handover), or the end.
  const inUnit = (id, from, worker, model) => {
    const ev = eventsOf(id);
    const handover = ev.find((e) => e.n > from && e.type === 'move' && e.lease && (e.lease.worker !== worker || (e.lease.model && modelKey(e.lease.model) !== modelKey(model))));
    const win = ev.filter((e) => e.n > from && (!handover || e.n < handover.n));
    let status = 'in-progress';
    let closed = false;
    for (const e of win) if (e.type === 'move') { status = e.to; if (closes(status)) closed = true; }
    const verdicts = win.filter((e) => e.type === 'verdict');
    const first = verdicts[0] || null;
    const firstApprove = verdicts.find((v) => v.verdict === 'approve');
    const rounds = win.filter((e) => e.type === 'round');
    const active = !closed && !handover && claims(status);
    return {
      closed, handedOver: Boolean(handover), active, ended: !closed && !handover && !active,
      changes: verdicts.filter((v) => v.verdict === 'changes').length, rounds: rounds.length,
      redAfterApprove: Boolean(firstApprove && rounds.some((r) => r.n > firstApprove.n)),
      rowsBeforeReview: win.filter((e) => e.type === 'row' && (!first || e.n < first.n)).length, reviewed: verdicts.length > 0,
    };
  };
  const units = [];
  for (const u of unitMap.values()) {
    const per = [...u.issues].map(([id, from]) => ({ id, ...inUnit(id, from, u.worker, u.model) }));
    if (per.some((p) => p.active)) continue;
    const lead = byId.get([...u.issues.keys()].sort(cmpId)[0]);
    const reviewed = per.some((p) => p.reviewed);
    const settled = per.every((p) => p.closed || p.handedOver);
    units.push({
      loop: label, model: u.model, spellings: [...u.spellings], worker: u.worker, kind: lead.kind || '(none)', tier: lead.tier, repos: issueRepoLabels(dir, lead), tags: lead.tags,
      ended: !settled, reviewed,
      clean: per.every((p) => p.closed && !p.changes && !p.rounds && !p.handedOver),
      changes: per.reduce((s, p) => s + p.changes, 0), rounds: per.reduce((s, p) => s + p.rounds, 0),
      redAfterApprove: per.some((p) => p.redAfterApprove), handedOver: per.some((p) => p.handedOver),
      rowsBefore: per.filter((p) => p.reviewed).every((p) => p.rowsBeforeReview > 0) && reviewed,
      followUps: per.reduce((s, p) => s + (follow.get(p.id) || []).length, 0),
    });
  }

  // The verdicts: per approve, whether a later reviewer of another model checked it, whether it missed, and whether it
  // is the approve that cleared the issue on the worker's own model or a lower-ranked one.
  const verdicts = [];
  for (const issue of issues) {
    const { id } = issue;
    const ev = eventsOf(id);
    const workers = new Set(leaseModels(ev).map(modelKey));
    const top = Math.max(-1, ...[...workers].map(lines.rank));
    const ownOrLower = (m) => m != null && workers.size > 0 && (workers.has(modelKey(m)) || (top >= 0 && lines.rank(m) < top));
    const seq = ev.filter((e) => e.type === 'verdict' && e.by || e.type === 'round' || e.type === 'move');
    let lastDone = -1;
    seq.forEach((e, k) => { if (e.type === 'move' && closes(e.to)) lastDone = k; });
    let clearing = -1;
    seq.forEach((e, k) => { if (k < lastDone && e.type === 'verdict' && e.verdict === 'approve' && e.kind !== 'self') clearing = k; });
    seq.forEach((e, k) => {
      if (e.type !== 'verdict') return;
      const row = {
        loop: label, model: e.model, by: e.by, relayed: e.relayed, verdict: e.verdict, kind: issue.kind || '(none)', tier: issue.tier,
        repos: issueRepoLabels(dir, issue), tags: issue.tags, checked: false, miss: false, ownOrLower: false, clearing: false, lowChecked: false,
      };
      if (e.verdict === 'approve') {
        row.ownOrLower = ownOrLower(e.model);
        row.clearing = k === clearing && row.ownOrLower;
        for (const y of seq.slice(k + 1)) {
          if (y.type === 'round') { row.miss = true; break; }
          if (y.type === 'move') {
            if (y.from != null && closes(y.from) && !closes(y.to)) { row.miss = true; break; }
            if (!closes(y.to) && !(y.from != null && claims(y.from) && claims(y.to))) break;
            continue;
          }
          const same = y.model != null && e.model != null ? modelKey(y.model) === modelKey(e.model) : y.by === e.by;
          if (same) continue;
          row.checked = true;
          if (y.verdict === 'changes') row.miss = true;
          row.lowChecked = row.ownOrLower && y.model != null && !ownOrLower(y.model);
          break;
        }
      }
      verdicts.push(row);
    });
  }
  return { label, issues: issues.length, units, verdicts };
}

// Worker rows: one per model, one cell per kind of task (Kind · Tier); work with no model is grouped by tier alone.
const cellKey = (r) => (r.model == null ? `tier ${r.tier}` : `${r.kind} · ${r.tier}`);
const byLabel = (a, b) => (a.model == null) - (b.model == null) || String(a.model).localeCompare(String(b.model));
function workerCell(key, rows, extra = {}) {
  builds.modelsTable += 1;
  const n = rows.filter((r) => !r.ended);
  const c = (f) => n.filter(f).length;
  return {
    key, kind: rows[0].model == null ? null : rows[0].kind, tier: rows[0].tier,
    units: n.length, reviewed: c((r) => r.reviewed), clean: c((r) => r.clean), share: n.length >= MODEL_MIN_N ? share(c((r) => r.clean), n.length) : null,
    changes: n.reduce((s, r) => s + r.changes, 0), rounds: n.reduce((s, r) => s + r.rounds, 0), redAfterApprove: c((r) => r.redAfterApprove), handedOver: c((r) => r.handedOver),
    endedBeforeReview: rows.filter((r) => r.ended && !r.reviewed).length, endedAfterReview: rows.filter((r) => r.ended && r.reviewed).length, rowsBeforeReview: c((r) => r.rowsBefore),
    rowsShare: n.length >= MODEL_MIN_N ? share(c((r) => r.rowsBefore), n.length) : null, followUps: n.reduce((s, r) => s + r.followUps, 0),
    word: null, rollup: false, ...extra,
  };
}
const groupBy = (list, f) => { const g = new Map(); for (const x of list) { const k = f(x); g.set(k, [...(g.get(k) || []), x]); } return g; };
const atLeastShare = (a, b) => a.clean * b.units >= b.clean * a.units;   // a's clean share is at least b's, without rounding
// The spellings a model's rows carry, the most used first (ties in name order); the first one names the row.
function spellingsOf(list) {
  const count = new Map();
  for (const m of list) if (m) count.set(m, (count.get(m) || 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([m]) => m);
}

function workerTable(unitRows, lines) {
  builds.modelsTable += 1;
  const baseline = new Map([...groupBy(unitRows.filter((r) => !r.ended), (r) => `${r.kind} · ${r.tier}`)].map(([k, rs]) => [k, { key: k, units: rs.length, clean: rs.filter((r) => r.clean).length }]));
  const tierBase = new Map([...groupBy(unitRows.filter((r) => !r.ended), (r) => r.tier)].map(([k, rs]) => [k, { key: `all kinds · ${k}`, units: rs.length, clean: rs.filter((r) => r.clean).length }]));
  const rows = [...groupBy(unitRows, (r) => modelKey(r.model) ?? '')].map(([key, rs]) => {
    const spellings = key === '' ? [] : spellingsOf(rs.flatMap((r) => r.spellings));
    const model = key === '' ? null : spellings[0];
    const cells = [...groupBy(rs, cellKey)].map(([cell, list]) => workerCell(cell, list)).sort((a, b) => a.key.localeCompare(b.key));
    if (model !== null) {
      for (const c of cells) if (c.units >= MODEL_MIN_N) c.word = atLeastShare(c, baseline.get(c.key)) ? 'fits' : 'below';
      // Below five units in a cell the view falls back once, to the model's numbers across the kinds at that tier.
      for (const [tier, list] of groupBy(cells, (c) => c.tier)) {
        if (list.length < 2) continue;
        const roll = workerCell(`all kinds · ${tier}`, rs.filter((r) => r.tier === tier), { rollup: true, kind: null });
        if (roll.units >= MODEL_MIN_N) roll.word = atLeastShare(roll, tierBase.get(tier)) ? 'fits' : 'below';
        cells.push(roll);
      }
    }
    return {
      model, label: model ?? '(not recorded)', spellings, tier: model === null ? null : lines.placedTier(model),
      placed: model !== null && lines.rank(model) >= 0, unplaced: model !== null && lines.declared && lines.rank(model) < 0,
      new: model !== null && cells.every((c) => c.units < MODEL_MIN_N), loops: new Set(rs.map((r) => r.loop)).size, cells,
    };
  }).sort(byLabel);
  return { rows, baselines: [...baseline.values()].sort((a, b) => a.key.localeCompare(b.key)).map((b) => ({ ...b, share: b.units >= MODEL_MIN_N ? share(b.clean, b.units) : null })) };
}

function reviewerTable(verdictRows) {
  builds.modelsTable += 1;
  return [...groupBy(verdictRows, (r) => modelKey(r.model) ?? '')].map(([key, rs]) => {
    const spellings = key === '' ? [] : spellingsOf(rs.map((r) => r.model));
    const model = key === '' ? null : spellings[0];
    const cells = [...groupBy(rs, cellKey)].map(([cell, list]) => {
      const approves = list.filter((r) => r.verdict === 'approve');
      const lowChecked = approves.filter((r) => r.lowChecked).length;
      const lowMisses = approves.filter((r) => r.ownOrLower && r.miss).length;
      return {
        key: cell, kind: model === null ? null : list[0].kind, tier: list[0].tier, verdicts: list.length, changes: list.length - approves.length, approves: approves.length,
        checked: approves.filter((r) => r.checked).length, misses: approves.filter((r) => r.miss).length, relayed: list.filter((r) => r.relayed).length,
        clearingOwnOrLower: approves.filter((r) => r.clearing).length, lowChecked, lowMisses,
        word: model !== null && lowChecked >= MODEL_MIN_N && lowMisses === 0 ? `may clear ${cell}` : null,
      };
    }).sort((a, b) => a.key.localeCompare(b.key));
    return { model, label: model ?? '(not recorded)', spellings, loops: new Set(rs.map((r) => r.loop)).size, cells };
  }).sort(byLabel);
}

// The loops models reads: this one (when it has a live record), its own archives when asked (--archives), and every
// --with <root> (a root, or an archive directory under .jarl/archive/). A path that is not a loop is refused with a
// message. Read-only: no lock is taken and nothing is written.
// A root holds a log: a loop with no issue yet has no issues folder, since git keeps no empty folder in a clone.
function loopShape(path) {
  if (existsSync(logPath(join(path, '.jarl')))) return 'root';
  if (existsSync(logPath(path)) && existsSync(join(path, 'issues'))) return 'archive';
  return null;
}
export function cmdModels(root, flags = {}) {
  builds.modelsTable += 1;
  need(flags.by === undefined || ['repo', 'tag'].includes(flags.by), `--group is one of: repo, tag (got "${flags.by}"): jarl.mjs models --group repo`);
  need(flags.archives === undefined || flags.archives === true, '--archives takes no value');
  const lines = modelLines(root);
  const sources = [];
  const seen = new Set();
  const add = (label, path, shape) => { const key = canonical(path); if (!seen.has(key)) { seen.add(key); sources.push({ label, path, shape }); } };
  if (loopShape(root) === 'root') add('this loop', root, 'root');
  if (flags.archives === true) {
    const dir = join(jarlDir(root), 'archive');
    if (existsSync(dir)) for (const name of readdirSync(dir).sort()) if (loopShape(join(dir, name)) === 'archive') add(`archive ${name}`, join(dir, name), 'archive');
  }
  for (const p of [].concat(flags.with ?? [])) {
    need(typeof p === 'string' && p, '--with takes a loop: the directory holding .jarl/, or an archived loop under .jarl/archive/');
    let path = resolve(p);
    // A root's own .jarl/ is the same loop as the root.
    if (basename(path) === '.jarl' && loopShape(dirname(path)) === 'root') path = dirname(path);
    const shape = loopShape(path);
    need(shape, `${p} is not a loop: it holds no .jarl/ with a log and issues, and is not an archived loop (an archive directory holds ${LOG_FILE} and issues/) — nothing was read`);
    add(p, path, shape);
  }
  need(sources.length, `no loop to read here: ${root} holds no live loop — name one with --with <root>, or its archives with --archives`);
  const facts = sources.map((s) => modelFacts(readLoop(s.shape === 'archive' ? s.path : jarlDir(s.path)), s.label, lines));
  const unitRows = facts.flatMap((f) => f.units);
  const verdictRows = facts.flatMap((f) => f.verdicts);
  const tables = (u, v) => { const w = workerTable(u, lines); return { workers: w.rows, reviewers: reviewerTable(v), baselines: w.baselines }; };
  const out = {
    loops: facts.map((f) => ({ label: f.label, issues: f.issues, units: f.units.length, verdicts: f.verdicts.length })),
    by: flags.by ?? null, minN: MODEL_MIN_N, modelLines: { declared: lines.declared, byTier: lines.byTier },
  };
  if (flags.by === undefined) return { ...out, ...tables(unitRows, verdictRows) };
  const of = (r) => (flags.by === 'repo' ? r.repos : r.tags.length ? r.tags : ['(none)']);
  const values = [...new Set([...unitRows, ...verdictRows].flatMap(of))].sort();
  return { ...out, slices: values.map((value) => ({ value, ...tables(unitRows.filter((r) => of(r).includes(value)), verdictRows.filter((r) => of(r).includes(value))) })) };
}

const countOfN = (k, n) => `${k} of ${n}`;
export function renderModels(m) {
  const pc = (s) => (s == null ? '' : ` (${Math.round(s * 100)}%)`);
  const workerLine = (c, lead) => `  ${lead}  units ${c.units} · clean first pass ${countOfN(c.clean, c.units)}${pc(c.share)} · changes ${c.changes} · rounds ${c.rounds} · red after approve ${c.redAfterApprove} · handed over ${c.handedOver} · rows before review ${countOfN(c.rowsBeforeReview, c.units)}${pc(c.rowsShare)} · follow-ups ${c.followUps}${c.endedBeforeReview ? ` · ended before any review ${c.endedBeforeReview} (not in the units)` : ''}${c.endedAfterReview ? ` · ended after a review without closing ${c.endedAfterReview} (not in the units)` : ''}${c.word ? ` · ${c.word}` : ''}${c.rollup ? ' (all kinds at that tier)' : ''}`;
  const reviewerLine = (c, lead) => `  ${lead}  verdicts ${c.verdicts} (changes ${c.changes}, approves ${c.approves}) · approves checked by a later reviewer of another model ${c.checked} of ${c.approves} · misses ${c.misses} · relayed ${c.relayed} · clearing approves on its own or a lower-ranked model ${c.clearingOwnOrLower}${c.word ? ` · ${c.word}` : ''}`;
  const heading = (r) => `${r.label}${r.model == null ? '' : `${r.tier ? ` (${r.tier})` : ''}${r.unplaced ? ' [unplaced]' : ''}${r.new ? ' [new]' : ''}`}${r.spellings.length > 1 ? ` · spellings folded: ${r.spellings.join(', ')}` : ''}${r.loops > 1 ? ` · from ${r.loops} loops` : ''}`;
  const block = (t) => [
    '## As worker',
    ...(t.workers.length ? t.workers.flatMap((r) => [heading(r),...r.cells.map((c) => workerLine(c, r.model == null ? `(not recorded) · ${c.key}` : c.key))]) : ['(no unit of work yet)']),
    '', '## As reviewer',
    ...(t.reviewers.length ? t.reviewers.flatMap((r) => [heading({ ...r, tier: null }),...r.cells.map((c) => reviewerLine(c, r.model == null ? `(not recorded) · ${c.key}` : c.key))]) : ['(no verdict yet)']),
  ];
  return [
    `# Models · ${m.loops.map((l) => `${l.label} (${l.issues} issues, ${l.units} units, ${l.verdicts} verdicts)`).join(' · ')}`,
    `Grouped by the model as recorded: ids that are the same once every '.' is written as '-' are one model, and a row names the spellings it folded. A kind of task is Kind · Tier. Every count carries its n and a share appears only from n >= ${m.minN}; fits and below compare a model's clean share with its kind's own baseline; may clear needs ${m.minN} approves by a lower-ranked or same-model reviewer that a reviewer able to clear checked afterwards, with no miss. Compare inside a kind: a model is measured on the work it was given, and a worker's clean share is only as strict as its reviewers. Not derived: whether a finding was right, cost, and every slip that never reached the record. Suggestions only; nothing here refuses or changes anything.`,
    m.modelLines.declared ? `Model lines: ${Object.entries(m.modelLines.byTier).map(([t, ms]) => `${t}: ${ms.join(', ')}`).join(' · ')}` : `This loop declares no Model (<tier>) lines in ${GOAL_FILE}, so no model is placed and no rank is known.`,
    '',
    ...(m.slices ? m.slices.flatMap((s) => [`# By ${m.by}: ${s.value}`, ...block(s), '']) : block(m)),
  ].join('\n').replace(/\n+$/, '');
}

// What next and resume show per ready issue: the default model of the issue's tier, read from the goal's Model lines
// alone. The models table is never built for it; `models` is the view that builds it. Nothing in a loop without model lines.
export function modelMarks(root, rows) {
  const lines = modelLines(root);
  if (!lines.declared || !rows.length) return new Map();
  return new Map(rows.map((r) => [r.id, { default: lines.defaultOf(r.tier) }]));
}

const SEVERITIES = ['Critical', 'Important', 'Minor'];

// A "changes" verdict names at least one Critical or Important finding — Minor alone never bounces
// a branch back to a worker, it goes to evidence and the branch still merges (the review discipline's
// own rule, enforced here rather than left to a reviewer's judgement).
//
// --by names the reviewer, and every verdict needs it: the line records the name and its kind (fresh, coordinator,
// self). An approve by the issue's own worker — its Worker field, or the worker of its last lease — is refused:
// a self-approve is not a review.
//
// review <id> retract --by <who> "<reason>" retracts the newest approve not yet retracted, by an appended entry: the
// approve stays in the issue, struck through, and the done gate and the metrics stop counting it. It only tightens:
// a "changes" verdict is never retracted (that would revive an earlier acceptance) and a retraction is never retracted.

// How many times the costly reads ran in this process: the steps that build the models table (the command, the facts of
// a loop, the worker and reviewer tables and each worker cell) and the rows next computes. A view that must
// not build the table, or must build its rows once, is held to it by a test that reads these.
const builds = { modelsTable: 0, nextRows: 0 };

// Used by the other modules of the library, and not part of what jarl-lib.mjs exports.
export { SEVERITIES, builds, loggedFinding, modelValue, reviewModelNotes, spellingNote };
