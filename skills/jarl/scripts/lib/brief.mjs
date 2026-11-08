// brief: the text a role is raised with, assembled from the record when asked and never stored. A worker's or an examiner's
// brief is for one lease, a merger's is for its target branch, and a coordinator's for its slice. Each holds what its reader
// needs and reads nothing else for: the role, the goal, the purpose, the lines with their methods, where the work is, the
// rules that reach it, at most three "you do not" lines, each command with every value the record holds filled, and what
// it reports. It writes nothing and holds no lock.

import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REVIEWER_KIND_SRC, fieldText, hole, jarlLine, need, printCommand } from './base.mjs';
import { jarlDir, today } from './where.mjs';
import { firstLine, firstLineReadings, goalLineOf, goalPath } from './journal.mjs';
import { outOfGit } from './loop-git.mjs';
import { acceptanceLines, evidenceNotes, evidenceTable, issueNamed, reviewEntries } from './issues.mjs';
import { countedRowsOf, lineChanges, lineStates, linesAtFirstLease, readLine, shownRowLines, tierAtFirstLease } from './lines.mjs';
import { gateOf, worksInPlace } from './gate.mjs';
import { readLoop } from './loop.mjs';
import { integrationBranch, sameSlice, sliceNamed, sliceOf } from './slices.mjs';
import { loopRepos, takenOver } from './rounds.mjs';
import { findingOfLog, modelLinesIn } from './models.mjs';
import { loopRules, ruleLines, rulesFor } from './rules.mjs';
import { issueView } from './evidence.mjs';
import { baseOf, isGitRepo, issueRepos, refsIn, repoLabel, worktreeState } from './repositories.mjs';
import { cmpId } from './ids.mjs';
import { sameLease } from './leases.mjs';

// The tool the commands of a brief run: its own absolute path, under the runtime running it now.
const SCRIPT = fileURLToPath(new URL('../jarl.mjs', import.meta.url));
const RUNTIME = basename(process.execPath).replace(/\.exe$/i, '');

// The roles a brief of the tool is written for, besides a coordinator's of its slice: a worker's and an examiner's of one
// lease, a merger's of its target. A worker raised by a takeover is given the worker's brief, with the rules of the
// takeover too.
export const BRIEF_ROLES = Object.freeze(['worker', 'reviewer', 'merger']);
// The moments a coordinator meets while it runs its slice: every moment of work but the close, which is the jarl's.
const COORDINATOR_MOMENTS = Object.freeze(['filing', 'start', 'review', 'round', 'merge', 'done']);
// Where a coordinator's rules are written in full, inside the skill's directory.
const REFERENCES = Object.freeze({ coordinator: { file: 'references/jarl.md', section: 'Coordinators: slices of the backlog' } });

// A rule as a brief carries it: what ruleLines prints it from, and no more.
const ruleOf = (r) => ({ slug: r.slug, scope: r.scope, until: r.until ?? null, by: r.by ?? null, under: r.under ?? null, ...(r.underNotInForce ? { underNotInForce: r.underNotInForce } : {}), builtin: r.builtin === true, source: r.source ?? null, text: r.text });
const sorted = (set) => [...set].sort();

// The text of a Reviews entry as its writer gave it: the escape of a heading or a marker line taken off; and a findings
// text as compared, that and its white space as one space.
const unescaped = (s) => String(s).split('\n').map((l) => l.replace(/^(\s*)\\(?=[#<=>|])/, '$1')).join('\n');
const sameText = (s) => unescaped(s).replace(/\s+/g, ' ').trim();
const WHERE_WHOLE = "the issue's Reviews section";

// What a review line of the log and an entry of the Reviews section each record of one review, in the same fields: the
// verdict (approve, changes or retract), the reviewer and the kind its writer recorded then, the day, the model, the relay
// mark, the batch, and the readings its text is compared by. One writer call writes every field into both alike.
const LINE_HEAD = new RegExp(`^review (approve|changes|retract) · (?:by (.+?) \\((${REVIEWER_KIND_SRC})\\) · )?`);
function lineRecord(e) {
  const said = e.text.slice(e.written.length + 1);
  const head = LINE_HEAD.exec(said);
  if (!head) return { verdict: null, by: null, kind: null, day: e.at.slice(0, 10), model: null, relayed: false, batch: null, artifact: null, readings: [], text: said };
  let text = said.slice(head[0].length);
  const verdict = e.type === 'verdict';
  // A verdict's marks stand right after its reviewer, in a fixed order: the model, the relay mark, the batch, the artifact.
  const model = verdict ? e.model ?? null : null;
  const relayed = verdict && Boolean(e.relayed);
  const batch = verdict ? e.batch ?? null : null;
  const artifact = verdict ? e.artifact ?? null : null;
  if (model) text = text.slice(`model ${model} · `.length);
  if (relayed) text = text.slice('relayed · '.length);
  if (batch) text = text.slice(`batch ${batch} · `.length);
  if (artifact) text = text.slice(`artifact ${artifact} · `.length);
  // A verdict's text as the log holds it, and with the lead-in a writer sets before a finding that opens like a mark taken
  // off, since not every writer sets it; a retraction's names the approve it takes away, then its reason.
  const readings = verdict ? [sameText(text), sameText(findingOfLog(text))] : [sameText(text)];
  return { verdict: head[1], by: head[2] ?? null, kind: head[3] ?? null, day: e.at.slice(0, 10), model, relayed, batch, artifact, readings, ledIn: verdict && findingOfLog(text) !== text, text };
}
// A finding that opens with these words is given a lead-in on its log line by every writer that keeps a Reviews entry, so
// the line of such an entry carries one: a line without it was written by a writer that keeps no entry.
const ALWAYS_LED_IN = /^(?:model |relayed(?: ·|$))/i;
// An entry's marks stand in its heading after the day; a retracted approve's heading is struck through, its closing mark
// after the last of them.
function entryRecord(lines, e) {
  const text = unescaped(lines.slice(e.start + 1, e.end + 1).map((l) => l.replace(/^ {2}/, '')).join('\n').trim());
  const heading = e.retracted ? lines[e.start].replace(/~~\s*$/, '') : lines[e.start];
  const [named, ...reason] = text.split('\n');
  // An entry is compared whole and as the log writes a text of many lines (its first line and where the rest is); a
  // retraction's log line holds what it takes away and the first line of its reason, joined.
  const readings = e.verdict === 'retract' ? [sameText(`${named} · ${firstLine(reason.join('\n'), WHERE_WHOLE)}`)] : [sameText(text), sameText(firstLine(text, WHERE_WHOLE))];
  return {
    verdict: e.verdict, by: e.by, kind: e.kind, day: e.day,
    model: / · model (.+?)(?= · |\s*$)/.exec(heading)?.[1] ?? null, relayed: / · relayed(?= · |\s*$)/.test(heading), batch: / · batch (\S+)/.exec(heading)?.[1] ?? null,
    artifact: e.verdict === 'retract' ? null : / · artifact ([^·\n]+?)\s*$/.exec(heading)?.[1] ?? null,
    readings, ledIn: e.verdict !== 'retract' && ALWAYS_LED_IN.test(text), text,
  };
}
// Whether a review line and a Reviews entry can be one review: they agree on every field both record, the line carries the
// lead-in the entry's writer set, and the entry's text is one the line can be read as. The day alone agrees when one of the
// two records none, as an entry may not.
const SAME_FIELDS = Object.freeze(['verdict', 'by', 'kind', 'model', 'relayed', 'batch', 'artifact']);
const oneReview = (line, entry) => SAME_FIELDS.every((f) => line[f] === entry[f])
  && (line.day === null || entry.day === null || line.day === entry.day)
  && (!entry.ledIn || line.ledIn)
  && entry.readings.some((r) => line.readings.includes(r));

// The pairings of n review lines with m entries over the pairs `fits` allows, each line and each entry in one pair at
// most: the most pairs one holds, and the pairs every pairing with that many makes (`sure`, a line's index to its
// entry's). Those that keep the log's order and the file's are read from the most pairs before and after each place, so
// the cost is the product of the two lengths, however many pairings there are.
function pairsInOrder(n, m, fits) {
  const grid = () => Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const before = grid(); // before[i][j]: the most pairs among the first i lines and the first j entries
  const after = grid(); // after[i][j]: the most pairs among the lines from i on and the entries from j on
  for (let i = 1; i <= n; i += 1) for (let j = 1; j <= m; j += 1) before[i][j] = Math.max(before[i - 1][j], before[i][j - 1], fits(i - 1, j - 1) ? before[i - 1][j - 1] + 1 : 0);
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) after[i][j] = Math.max(after[i + 1][j], after[i][j + 1], fits(i, j) ? after[i + 1][j + 1] + 1 : 0);
  const most = after[0][0];
  const sure = new Map();
  for (let j = 0; j < m; j += 1) {
    // The lines entry j takes in some pairing with the most pairs, and whether one of them leaves it out.
    const lines = [];
    let out = false;
    for (let i = 0; i <= n; i += 1) {
      if (i < n && fits(i, j) && before[i][j] + 1 + after[i + 1][j + 1] === most) lines.push(i);
      if (before[i][j] + after[i][j + 1] === most) out = true;
    }
    if (lines.length === 1 && !out) sure.set(lines[0], j);
  }
  return { most, sure };
}
// The same in any order: one pairing with the most pairs, by augmenting paths from a first pass that pairs each entry with
// the first free line it fits, and the sure pairs read off that one pairing. A pair of it is left out of another pairing
// with as many pairs exactly when swapping along a path or a cycle that alternates between pairs not taken and pairs taken
// frees it: a path from a line no pair takes reaches its entry, a path from an entry no pair takes reaches its line, or a
// cycle runs through it. Each line and entry is asked once whether they fit, and the rest walks the pairs that do.
export function pairsInAnyOrder(n, m, fits) {
  const linesOf = Array.from({ length: m }, (_, j) => Array.from({ length: n }, (_, i) => i).filter((i) => fits(i, j)));
  const entryAt = new Array(n).fill(-1);
  const lineAt = new Array(m).fill(-1);
  const pair = (i, j) => { entryAt[i] = j; lineAt[j] = i; };
  for (let j = 0; j < m; j += 1) { const i = linesOf[j].find((x) => entryAt[x] === -1); if (i !== undefined) pair(i, j); }
  const take = (j, seen) => {
    for (const i of linesOf[j]) {
      if (seen[i]) continue;
      seen[i] = true;
      if (entryAt[i] === -1 || take(entryAt[i], seen)) { pair(i, j); return true; }
    }
    return false;
  };
  for (let j = 0; j < m; j += 1) if (lineAt[j] === -1) take(j, new Array(n).fill(false));
  // The steps of an alternating walk, lines first (0..n-1), then entries (n..n+m-1): from a line to an entry it fits and is
  // not paired with, from an entry to the line it is paired with; and the same steps the other way.
  const ahead = Array.from({ length: n + m }, () => []);
  const back = Array.from({ length: n + m }, () => []);
  const step = (from, to) => { ahead[from].push(to); back[to].push(from); };
  linesOf.forEach((ls, j) => { for (const i of ls) if (entryAt[i] !== j) step(i, n + j); if (lineAt[j] !== -1) step(n + j, lineAt[j]); });
  const reached = (starts, steps) => {
    const seen = new Array(n + m).fill(false);
    const queue = [...starts];
    for (const v of queue) seen[v] = true;
    for (let q = 0; q < queue.length; q += 1) for (const w of steps[queue[q]]) if (!seen[w]) { seen[w] = true; queue.push(w); }
    return seen;
  };
  const fromFreeLines = reached(entryAt.flatMap((j, i) => (j === -1 ? [i] : [])), ahead);
  const fromFreeEntries = reached(lineAt.flatMap((i, j) => (i === -1 ? [n + j] : [])), back);
  // The strongly connected parts of the walk (Tarjan's, kept on a stack of its own): a pair runs through a cycle exactly
  // when its line and its entry are in one part.
  const index = new Array(n + m).fill(-1);
  const low = new Array(n + m).fill(0);
  const part = new Array(n + m).fill(-1);
  const open = [];
  let count = 0;
  let parts = 0;
  for (let s = 0; s < n + m; s += 1) {
    if (index[s] !== -1) continue;
    const work = [[s, 0]];
    index[s] = low[s] = count++; open.push(s);
    while (work.length) {
      const top = work[work.length - 1];
      const v = top[0];
      if (top[1] < ahead[v].length) {
        const w = ahead[v][top[1]++];
        if (index[w] === -1) { index[w] = low[w] = count++; open.push(w); work.push([w, 0]); } else if (part[w] === -1) low[v] = Math.min(low[v], index[w]);
        continue;
      }
      work.pop();
      if (work.length) { const u = work[work.length - 1][0]; low[u] = Math.min(low[u], low[v]); }
      if (low[v] === index[v]) { let w; do { w = open.pop(); part[w] = parts; } while (w !== v); parts += 1; }
    }
  }
  const sure = new Map();
  entryAt.forEach((j, i) => { if (j !== -1 && !fromFreeLines[n + j] && !fromFreeEntries[i] && part[i] !== part[n + j]) sure.set(i, j); });
  return { most: lineAt.filter((i) => i !== -1).length, sure };
}

// The findings of the reviews that sent the work back. The log is the record, which every writer keeps: each "changes"
// verdict line of the issue is one finding, in the log's order, once. Every review line of the issue, approves and
// retractions too, takes part in the pairing with every entry of its file's Reviews section: an entry is a line's, and its
// finding given whole from the file as its writer gave it, when every pairing with the most pairs pairs the two, a pair
// being one review (oneReview). Both the log and the file only ever add at the end, so a pairing keeps both orders, and
// an entry's place tells it apart from another. Where no pairing that keeps them places every entry a line fits, the file
// holds its entries in another order or more of them than the lines they fit (as a merge resolved by hand can leave it):
// their place tells nothing, and the pairings are those in any order. A line no entry is paired with gives its text as
// the log holds it. A changes entry paired with no line is listed after them, marked fileOnly, and `notes` says how many
// match no line at all and how many fit a line that another line or entry of the same reviewer fits as well; whichever
// pairings count, an entry a line fits is left unpaired only then.
function findingsOf(loop, issue, events, notes) {
  const { lines, entries } = reviewEntries(issue.sections.reviews);
  const byN = new Map(events.map((e) => [e.n, e]));
  const said = gateOf(loop, issue.id).trail.map((t) => ({ t, ...lineRecord(byN.get(t.n)) }));
  const kept = entries.map((e) => entryRecord(lines, e));
  const fit = said.map((s) => kept.map((k) => oneReview(s, k)));
  const fits = (i, j) => fit[i][j];
  const fitting = (j) => fit.some((row) => row[j]);
  const inOrder = pairsInOrder(said.length, kept.length, fits);
  const ordered = inOrder.most === kept.filter((_, j) => fitting(j)).length;
  const { sure } = ordered ? inOrder : pairsInAnyOrder(said.length, kept.length, fits);
  const found = said.flatMap(({ t, verdict, text }, i) => (verdict === 'changes' ? [{ by: t.by, kind: t.kind, day: t.at.slice(0, 10), text: sure.has(i) ? kept[sure.get(i)].text : text }] : []));
  const paired = new Set(sure.values());
  const left = kept.map((k, j) => ({ k, j })).filter(({ k, j }) => k.verdict === 'changes' && !paired.has(j));
  const alone = left.filter(({ j }) => !fitting(j)).length;
  const alike = left.length - alone;
  // A finding given as its log line, which says the rest is in the Reviews section, while no entry left there fits it: an
  // entry paired with another line is that line's, so the section holds nothing more of this one.
  const pointing = said.filter(({ verdict, text }, i) => verdict === 'changes' && !sure.has(i) && firstLineReadings(text, WHERE_WHOLE).some((r) => r.more) && !left.some(({ j }) => fit[i][j])).length;
  if (alone) notes.push(`${alone} review(s) of the Reviews section of ${issue.id} match no verdict line of its log, which is the record: listed after the log's, marked in the issue file only`);
  if (alike) notes.push(`${alike} review(s) of the Reviews section of ${issue.id} fit a verdict line of its log that another line or entry of the same reviewer fits as well, and nothing the two record tells which is whose: those verdicts are given as the log's lines, and the entries are listed after them, marked in the issue file only`);
  if (pointing) notes.push(`${pointing} finding(s) of ${issue.id} given as its log's line say the whole text is in its Reviews section, which holds no entry left for them: the first line is all the record keeps`);
  if (!ordered) notes.push(`no pairing in the log's order places every entry of the Reviews section of ${issue.id} that fits a verdict line of its log (the section holds them in another order, or more of them than the lines they fit): each entry is paired by what it records alone, its place telling nothing`);
  return [...found, ...left.map(({ k }) => ({ by: k.by, kind: k.kind, day: k.day, text: k.text, fileOnly: true }))];
}

// The issues a brief is for, as one lease: the ids named, and, when one is leased, every issue of its lease. Two leases, or
// a lease beside work no lease holds, are refused: a brief is for one agent.
function leaseIssues(loop, rawIds) {
  const raw = String(rawIds).split(',').map((s) => s.trim()).filter(Boolean);
  const named = raw.map((rawId) => {
    const issue = issueNamed(loop.issues, rawId);
    need(issue, `no such issue: ${rawId} — the issues: ${jarlLine('list', '--all')}`, () => ({ arg: 0, value: hole('<id>') }));
    return issue;
  });
  const leased = (i) => loop.profile.is(i.status, 'holds-claim') && Boolean(fieldText(i.fields.worker) || fieldText(i.fields.branch));
  const leases = named.filter(leased);
  for (const i of leases) need(sameLease(loop.profile, i, leases[0]) || i === leases[0], `${named.map((x) => x.id).join(', ')} are not one lease: ${leases[0].id} holds ${leaseText(leases[0])}, and ${i.id} holds ${leaseText(i)} — a brief is for one agent on one lease`, () => ({ arg: 0, value: hole('<ids>') }));
  if (leases.length && leases.length !== named.length) need(false, `${named.map((x) => x.id).join(', ')} are not one lease: ${named.find((x) => !leased(x)).id} holds none, and ${leases[0].id} holds ${leaseText(leases[0])} — a brief is for one agent on one lease`, () => ({ arg: 0, value: hole('<ids>') }));
  const mates = leases.length ? loop.issues.filter((i) => !named.includes(i) && sameLease(loop.profile, i, leases[0])) : [];
  return { issues: [...named, ...mates].sort((a, b) => cmpId(a.id, b.id)), added: mates };
}
const leaseText = (i) => [fieldText(i.fields.branch) && `branch ${fieldText(i.fields.branch)}`, fieldText(i.fields.worker) && `worker ${fieldText(i.fields.worker)}`].filter(Boolean).join(', ') || 'no lease';

// How deep an examiner goes: computed from the lines of the lease, each row of the table the deeper of the lines as they
// were at the lease and the lines as they are now, so editing a line never lightens a review. The rows, deepest last:
// compare-only (every line a compare: a light model may do it), mechanical (test or check and no read or owner: at least
// standard, not below the worker), judged (any read or owner: one tier above the worker, at least standard), strongest (an
// issue on the top tier: the strongest tier, a second model family where the top tier's Model line names one).
const DEPTH_ROWS = Object.freeze(['compare-only', 'mechanical', 'judged', 'strongest']);
export function examinerDepth(loop, issues) {
  const { tiers } = loop.profile;
  const rank = (t) => Math.max(tiers.indexOf(t), 0);
  const top = tiers.length - 1;
  const standard = Math.max(tiers.indexOf('standard'), 0);
  // One side of the comparison: the row and the tier the table gives for these lines on these tiers.
  const reading = (lines, issueTiers) => {
    const worker = issueTiers.reduce((m, t) => Math.max(m, rank(t)), 0);
    const methods = lines.map((l) => readLine(l).method);
    const row = issueTiers.some((t) => rank(t) === top) ? 'strongest'
      : methods.length && methods.every((m) => m === 'compare') ? 'compare-only'
        : !methods.length || methods.some((m) => m === 'read' || m === 'owner') ? 'judged' : 'mechanical';
    const tierRank = row === 'compare-only' ? 0 : row === 'mechanical' ? Math.max(standard, worker) : row === 'judged' ? Math.max(standard, Math.min(worker + 1, top)) : top;
    return { row, tierRank, worker };
  };
  const now = reading(issues.flatMap((i) => acceptanceLines(i)), issues.map((i) => i.tier));
  const atLease = reading(issues.flatMap((i) => linesAtFirstLease(loop, i)), issues.map((i) => tierAtFirstLease(loop, i)));
  const order = (r) => [DEPTH_ROWS.indexOf(r.row), r.tierRank];
  const deeper = order(atLease)[0] > order(now)[0] || (order(atLease)[0] === order(now)[0] && order(atLease)[1] > order(now)[1]) ? atLease : now;
  const tier = tiers[deeper.tierRank];
  const secondFamily = deeper.row === 'strongest' ? modelLinesIn(loop.goalLines, loop.profile).byTier[tier]?.[1] ?? null : null;
  return { row: deeper.row, tier, secondFamily, atLease: atLease.row, now: now.row, worker: tiers[deeper.worker], says: depthWords(deeper.row, tier, tiers[deeper.worker], secondFamily) };
}
function depthWords(row, tier, worker, secondFamily) {
  if (row === 'compare-only') return `every line is a compare line, so a ${tier} model is allowed: check that each comparison covers everything the change touched`;
  if (row === 'mechanical') return `test or check lines and no read or owner line: at least ${tier}, never below the worker's tier (${worker})`;
  if (row === 'judged') return `a read or owner line: one tier above the worker (${worker}), at least standard: ${tier}`;
  return `an issue on the top tier: the strongest tier, ${tier}${secondFamily ? `, and a second model family (${secondFamily}) where the Model line has one` : ''}`;
}

// What an issue's text shows the role: the issue as show prints it, without the lines that name a place on this machine;
// and for the examiner without its Evidence and Reviews, so neither the worker's words nor an earlier verdict reach it
// except as the proof rows and the previous findings the brief prints on their own.
function issueText(root, issue, role) {
  const show = issueView(root, issue, { places: false, ...(role === 'reviewer' ? { omit: ['evidence', 'reviews'] } : {}) }).replace(/\s+$/, '');
  const lines = acceptanceLines(issue);
  return lines.length ? `${show}\n\nLines of ${issue.id}, by number:\n${lines.map((l, k) => `${k + 1}. ${l}`).join('\n')}` : show;
}
// The most words of the goal a brief carries: each is a word of the role's own text, under its cap.
const GOAL_WORDS = 60;
// The first paragraph of the goal: the text after its heading, up to the first blank line, a section or a machine line,
// cut at GOAL_WORDS with the pointer to the file that holds the rest.
function goalParagraph(loop, ctx) {
  const lines = String(loop.goal ?? '').replace(/\r\n?/g, '\n').split('\n').slice(1);
  const start = lines.findIndex((l) => l.trim() && !l.startsWith('#') && !goalLineOf(l));
  if (start === -1) return loop.goalLines.goal ?? '';
  const end = lines.slice(start).findIndex((l) => !l.trim() || l.startsWith('#') || goalLineOf(l));
  const words = lines.slice(start, end === -1 ? undefined : start + end).join(' ').trim().split(/\s+/);
  return words.length <= GOAL_WORDS ? words.join(' ') : `${words.slice(0, GOAL_WORDS).join(' ')} … (the rest of the goal: ${goalPath(jarlDir(ctx.root))})`;
}
// The parent an issue is part of, with its purpose: its Why, or its What, or its title.
function parentPurpose(issue) {
  const p = issue.tree?.parent;
  if (!p) return null;
  const why = fieldText(p.sections?.why) || fieldText(p.sections?.what) || fieldText(p.title);
  return { id: p.id, title: p.title, why };
}

// Where a lease works: its branch, worker and model from the record, and for each repository of its issues the base branch
// and the worktree git lists for the branch.
function leaseWhere(root, loop, issues) {
  const first = issues[0];
  const branch = fieldText(first.fields.branch) || null;
  const inPlace = worksInPlace(first);
  const tier = loop.profile.tiers.reduce((best, t) => (issues.some((i) => i.tier === t) ? t : best), first.tier);
  const repos = [...new Set(issues.flatMap((i) => issueRepos(root, i)))].filter(isGitRepo).map((repo) => {
    const wt = branch ? worktreeState(repo, branch, fieldText(first.fields.worktree)) : null;
    return { repo, label: repoLabel(repo), base: baseOf(root, repo), worktree: wt && wt.state === 'here' ? wt.path : null };
  });
  return { branch, worker: fieldText(first.fields.worker) || null, model: fieldText(first.fields.model) || null, inPlace, tier, repos };
}

const toolCommand = (ctx) => (...words) => printCommand([RUNTIME, SCRIPT, ...words, '--root', ctx.root], { globals: [] });

// The commands a role uses, each with every value the record holds filled.
function workerCommands(ctx, issues, lease) {
  const by = lease.worker ?? hole('<who>');
  const tool = toolCommand(ctx);
  const ids = issues.map((i) => i.id).join(',');
  const issueWord = issues.length > 1 ? hole('<id>') : issues[0].id;
  const proofs = issues.map((i) => ({ forIssue: i.id, what: `proof of a line of ${i.id}, one row per run`, command: tool('evidence', i.id, '--ran', hole('<command>'), '--saw', hole('<what-it-printed>'), '--line', hole('<line-number>'), '--by', by) }));
  return [...proofs,
    { what: 'a note, the choice a line leaves open', command: tool('evidence', issueWord, hole('<text>'), '--by', by) },
    { what: 'stuck: a line you cannot meet without weakening a protection (then stop)', command: tool('ask', hole('<text>'), '--kind', 'stuck', '--issue', issueWord, '--by', by) },
    { what: 'the changelog entry, for a change someone sees', command: tool('field', ids, 'Changelog', hole('<changelog-entry>'), '--add', '--by', by) },
  ];
}
function reviewerCommands(ctx, issues, lease) {
  const tool = toolCommand(ctx);
  const ids = issues.map((i) => i.id).join(',');
  const verdict = tool('review', ids, hole('<verdict>'), hole('<findings-with-a-severity>'), '--by', hole('<reviewer>'), '--model', hole('<model-id>'));
  const diffs = lease.branch ? lease.repos.map((r) => ({ what: `the diff in ${r.label}`, command: printCommand(['git', '-C', r.repo, 'diff', `${r.base}...${lease.branch}`], { globals: [] }) })) : [];
  const each = issues.map((i) => ({ forIssue: i.id, what: `a re-run of a line of ${i.id}`, command: tool('evidence', i.id, '--ran', hole('<command>'), '--saw', hole('<what-it-printed>'), '--line', hole('<line-number>'), '--by', hole('<reviewer>')) }));
  return [...diffs, ...each,
    { what: 'the verdict, as the last step (with `--outside "<finding-outside-the-issue>"` for each finding outside the issue, filed as a new issue, never a reason for changes)', command: verdict }];
}

function issueData(root, loop, issue, role) {
  const events = loop.eventsById.get(issue.id) || [];
  const rounds = events.filter((e) => e.type === 'round').map((e, n) => ({ round: n + 1, at: e.at, text: e.text.slice(e.written.length + 1) }));
  const tookOver = takenOver(loop.profile, events);
  const lastLease = [...events].reverse().find((e) => e.type === 'move' && loop.profile.is(e.to, 'holds-claim'));
  const proof = evidenceTable(issue.sections.evidence).rows.filter((r) => !r.retracted).map(({ n, ran, saw, lines }) => ({ n, ran, saw, ...(lines.length ? { lines: shownRowLines(issue, lines) } : {}) }));
  const notes = [];
  if (role === 'worker' && loop.profile.is(issue.status, 'terminal')) notes.push(`${issue.id} is ${issue.status}: a worker starts on it once it is reopened — ${jarlLine('set', issue.id, loop.profile.initial, hole('<why>'))}`);
  const findings = findingsOf(loop, issue, events, notes);
  if (role === 'reviewer' && !proof.length) notes.push(`${issue.id} holds no proof row: a worker's missing rows are an Important finding`);
  const data = {
    id: issue.id, title: issue.title, status: issue.status, tier: issue.tier,
    text: issueText(root, issue, role),
    parent: parentPurpose(issue),
    lines: acceptanceLines(issue).map((text, k) => ({ n: k + 1, method: readLine(text).method, text })),
    takeover: tookOver || lastLease?.handover === true,
    rounds, findings, proof, notes,
  };
  if (role === 'reviewer') {
    data.lineChanges = lineChanges(loop, issue);
    data.assumed = assumedNotes(issue);
    data.reRun = proofToReRun(loop, issue);
  }
  return data;
}
// The notes of an issue that start with Assumed: and are not retracted: what the worker chose, which the examiner weighs.
function assumedNotes(issue) {
  const body = issue.sections.evidence || '';
  const { lines, notes } = evidenceNotes(body);
  return notes.filter((n) => !n.retracted).map((n) => lines.slice(n.start, n.end + 1).join(' ').replace(/^- /, '').trim()).filter((t) => /^assumed:/i.test(t));
}
// The proof of the mechanical lines as commands to re-run: every counted row of a test, check or compare line, by the holder
// of the lease, with the number of the line and what it printed; a line with no such row says so.
function proofToReRun(loop, issue) {
  const states = lineStates(loop, issue).filter((s) => s.method === 'test' || s.method === 'check' || s.method === 'compare');
  const rows = countedRowsOf(issue, loop);
  return states.map((s) => ({ line: s.n, method: s.method, text: s.what, ...(s.declared ? { declared: true } : {}), ...(s.noneDeclared ? { noneDeclared: true } : {}), rows: rows.filter((r) => r.lines.includes(s.digest)).map((r) => ({ ran: r.ran, saw: r.saw, by: r.by })) }));
}

function issueBrief(root, loop, rawIds, role, ctx) {
  const { issues, added } = leaseIssues(loop, rawIds);
  const lease = leaseWhere(root, loop, issues);
  const datas = issues.map((i) => issueData(root, loop, i, role));
  const first = datas[0];
  const rounds = datas.flatMap((d) => d.rounds);
  const findings = datas.flatMap((d) => d.findings);
  const proof = datas.flatMap((d) => d.proof);
  const moments = new Set([role === 'worker' ? 'start' : 'review', ...(rounds.length ? ['round'] : [])]);
  const roles = new Set([role, ...(role === 'worker' && datas.some((d) => d.takeover && takenOver(loop.profile, loop.eventsById.get(d.id) || [])) ? ['takeover'] : [])]);
  const rules = rulesFor(root, loop, { roles, slice: null, moments, issues }, today()).map(ruleOf);
  const notes = [...datas.flatMap((d) => d.notes), ...(added.length ? [`${added.map((i) => i.id).join(', ')} ${added.length === 1 ? 'is' : 'are'} on this lease too: the brief covers the whole lease`] : [])];
  const depth = role === 'reviewer' ? examinerDepth(loop, issues) : null;
  const record = role === 'worker' ? workerCommands(ctx, issues, lease) : reviewerCommands(ctx, issues, lease);
  // A command that names one issue is printed with that issue's own text, so a lease of many issues does not grow the role's.
  for (const d of datas) for (const r of record.filter((x) => x.forIssue === d.id)) d.text += `\n\n- ${r.what}: ${r.command}`;
  return {
    role, id: first.id, ids: datas.map((d) => d.id), title: first.title, status: first.status,
    roles: sorted(roles), moments: sorted(moments),
    goal: goalParagraph(loop, ctx), parents: datas.filter((d) => d.parent).map((d) => ({ id: d.id, parent: d.parent })),
    root: ctx.root, script: ctx.script, lease, ...(depth ? { depth } : {}),
    issues: datas.map(({ notes: _n, ...d }) => d),
    show: datas.map((d) => d.text).join('\n\n'),
    takeover: datas.some((d) => d.takeover),
    doNot: DO_NOT[role],
    rules, rounds, findings, proof, record, notes,
  };
}

// The merger's brief: its target branch, each repository's checkout and queue, and the whole procedure of a landing.
function mergerBrief(root, loop, slice, ctx) {
  const lines = loop.goalLines;
  const m = slice === undefined ? null : lines.mergers[fieldText(slice).toLowerCase()] ?? null;
  need(slice === undefined || m !== null, `no slice ${fieldText(slice)} with a merger of its own on the goal's Merger lines: a Merger (<coordinator>) line names one — ${jarlLine('goal', '--set', hole('<machine-line>'))}`, () => ({ flag: '--slice', value: hole('<coordinator>') }));
  const repos = loopRepos(root, loop.issues).filter(isGitRepo).map((repo) => {
    const base = baseOf(root, repo);
    return { repo, label: repoLabel(repo), base, target: m ? integrationBranch(m.slice) : base };
  });
  const rules = rulesFor(root, loop, { roles: new Set(['merger']), slice: null, moments: new Set(['merge']), issues: [] }, today()).map(ruleOf);
  const tool = toolCommand(ctx);
  const repoFlag = repos.length > 1 ? ['--repo', hole('<name-or-path>')] : [];
  const record = [
    { what: 'what waits for you, branch by branch', command: tool(...(m ? ['next', '--as', m.name, '--all'] : ['resume', ...repoFlag])) },
    { what: 'the settings of the merge drivers', command: printCommand([RUNTIME, SCRIPT, 'merge-driver', 'flags'], { globals: [] }) },
    { what: 'what the branch may touch', command: tool('scope', hole('<id>'), '--branch', hole('<branch>')) },
    { what: 'a green merge', command: tool('merged', hole('<ids>'), '--sha', hole('<sha>'), '--ran', hole('<command>'), '--saw', hole('<what-it-printed>'), ...repoFlag) },
    { what: 'a red, the work\'s fault', command: tool('round', hole('<id>'), hole('<text>')) },
    { what: 'a red from outside the branch', command: tool('new', hole('<what-is-red>'), '--tier', hole('<tier>')) },
    { what: 'a landing on red', command: tool('merged', hole('<ids>'), '--sha', hole('<sha>'), '--red', hole('<id>')) },
    { what: 'closing each issue', command: tool('set', hole('<id>'), 'done', hole('<text>')) },
    { what: 'the in-place commit, its sha printed', command: tool('evidence', hole('<id>'), '--ran', hole('<command>'), '--saw', hole('<what-it-printed>'), '--line', hole('<line-number>')) },
    { what: 'its changelog entries', command: tool('changelog', hole('<ids>')) },
  ];
  return {
    role: 'merger', id: null, ids: [], slice: m ? m.slice : null, merger: m ? m.name : lines.merger, target: m ? integrationBranch(m.slice) : null,
    root: ctx.root, script: ctx.script, goal: goalParagraph(loop, ctx), committed: !outOfGit(root), repos, roles: ['merger'], moments: ['merge'],
    doNot: DO_NOT.merger, rules, record,
    notes: m && repos.length && !repos.some((r) => refsIn(r.repo).has(integrationBranch(m.slice))) ? [`${integrationBranch(m.slice)} does not exist yet: until it is cut, the slice's approved work is the feature branch's merger's`] : [],
  };
}

function sliceBrief(root, loop, name) {
  const slice = sliceNamed(loop.goalLines.coordinators, loop.issues, name);
  const declared = loop.goalLines.coordinators.some((c) => sameSlice(c, slice));
  const inPlay = loop.issues.filter((i) => loop.profile.active(i.status) && sameSlice(sliceOf(i), slice));
  const rules = rulesFor(root, loop, { roles: new Set(['coordinator']), slice, moments: new Set(COORDINATOR_MOMENTS), issues: inPlay }, today()).map(ruleOf);
  const notes = [];
  if (!declared) notes.push(`the goal's Coordinators line does not name ${slice}: its approve counts as fresh and what its slice holds is the jarl's until the line names it — ${jarlLine('goal', '--set', hole('<machine-line>'))}`);
  if (!inPlay.length) notes.push(`no issue of the slice ${slice} is in play`);
  return {
    role: 'coordinator', slice, declared, roles: ['coordinator'], moments: [...COORDINATOR_MOMENTS].sort(),
    issues: inPlay.map((i) => ({ id: i.id, title: i.title, status: i.status, worker: fieldText(i.fields.worker) || null, ...(i.tree && i.tree.parent ? { parent: i.tree.parent.id } : {}) })),
    rules, reference: REFERENCES.coordinator,
    record: [{ what: 'what is on the coordinator now, each line with the command that moves it', command: jarlLine('next', '--as', slice) },
      { what: 'an escalation to the jarl, for one of the four reasons', command: jarlLine('ask', hole('<text>'), '--kind', 'escalation', '--slice', slice, '--by', slice) }],
    notes,
  };
}

// The rulings in force, counted as resume and decisions --live count them (neither superseded nor a rule that has ended):
// a brief prints the rules that reach its reader whole, and names where every ruling of the loop is read.
function rulingsOf(loop) {
  const ended = new Set(loopRules(loop, today()).filter((r) => r.ended).map((r) => r.slug));
  return { inForce: loop.decisions.filter((d) => !d.supersededBy && !ended.has(d.slug)).length, command: jarlLine('decisions', '--live') };
}

// brief <ids> [--role worker|reviewer] | brief --slice <coordinator> | brief --role merger [--slice <slice>]: the data of
// the brief, what --json prints.
export function cmdBrief(root, rawIds, opts = {}) {
  const loop = readLoop(jarlDir(root));
  const ctx = { root: resolve(root), script: SCRIPT };
  const role = opts.role === undefined ? null : fieldText(opts.role).toLowerCase();
  if (opts.slice !== undefined && role !== 'merger') {
    need(rawIds === undefined || rawIds === null, `brief --slice is the coordinator's brief and takes no id; an issue's brief is ${jarlLine('brief', hole('<id>'))}`, () => ({ truncate: 1 }));
    need(opts.role === undefined, `--role names the role of an issue's brief; brief --slice is the coordinator's`, () => ({ drop: '--role' }));
    return { ...sliceBrief(root, loop, opts.slice), rulings: rulingsOf(loop) };
  }
  if (role === 'merger') {
    need(rawIds === undefined || rawIds === null, `brief --role merger is the merger's and takes no id: the branches it takes are its queue, which the brief names`, () => ({ truncate: 1 }));
    return { ...mergerBrief(root, loop, opts.slice, ctx), rulings: rulingsOf(loop) };
  }
  need(rawIds !== undefined && rawIds !== null && String(rawIds).trim(), `brief takes the id of an issue; a coordinator's brief is ${jarlLine('brief', '--slice', hole('<coordinator>'))}`, () => ({ arg: 0, value: hole('<id>') }));
  const issueRole = role ?? 'worker';
  need(BRIEF_ROLES.includes(issueRole), `--role is ${BRIEF_ROLES.join(', ')} (got "${fieldText(opts.role)}"): a coordinator's brief is ${jarlLine('brief', '--slice', hole('<coordinator>'))}, and a merger's takes no id`, () => ({ flag: '--role', value: hole('<role>') }));
  return { ...issueBrief(root, loop, rawIds, issueRole, ctx), rulings: rulingsOf(loop) };
}

// At most three, and each a thing the role is most tempted to do.
const DO_NOT = Object.freeze({
  worker: ['widen the scope: anything else you see goes under "Found" in your report, never into the diff', 'weaken a test, a check, a guard or a hook: if a line seems to need that, record it with the stuck command and stop', 'approve anything: a fresh examiner does'],
  reviewer: ['fix what you find', 'merge anything', 'set the scope'],
  merger: ['edit code, or a conflict by picking a side', 'judge content or scope', 'override a red check'],
});

const FIRST_STEP = (lease) => (lease.inPlace ? 'You work in place: no branch or worktree of your own, only the files the issue declares, where they are checked out in their repository. You commit nothing: once the approve stands, the merger where one runs, else the coordinator, commits them.' : `First: in your worktree, \`git merge ${lease.repos[0]?.base ?? hole('<base-branch>')}\`; \`git status\` must be clean afterwards, and if it is not, stop and report. A platform that gave you a branch of its own name: rename it (\`git branch -m ${lease.branch ?? '<branch>'}\`), never a second branch beside it.`);

// The role's text, built from the record and read by nothing else: each part once, as short as it can be said.
function renderWorker(o, out) {
  const lease = o.lease;
  out.push(`The worker's brief for ${o.ids.length > 1 ? `issues ${o.ids.join(', ')}` : `issue ${o.id}`}, assembled from the record. Read nothing else for this job.`);
  out.push(...o.notes.map((n) => `note: ${n}`), '');
  if (o.takeover) out.push('A takeover: another worker held this lease before you and may have left work behind. The tree may be dirty: keep what you can verify, discard the rest.', '');
  section(out, 'The goal', o.goal);
  for (const p of o.parents) section(out, `Why ${p.id} exists`, `${p.id} is part of ${p.parent.id} (${p.parent.title}): ${p.parent.why}`);
  for (const issue of o.issues) out.push(issue.text, '');
  roundsAndFindings(o, out);
  section(out, 'Where you work', [
    `You are ${lease.worker ?? 'the worker'}${lease.model ? ` on ${lease.model}` : ''}, tier ${lease.tier}${o.ids.length > 1 ? ' (the highest of this lease)' : ''}.`,
    lease.inPlace ? 'No branch: you work in place.' : `Branch ${lease.branch ?? 'not leased yet'}.`,
    ...lease.repos.map((r) => `Repository ${r.label} (${r.repo}), base ${r.base}${lease.branch ? `, worktree ${r.worktree ?? 'not made yet'}` : ''}.`),
    ...(lease.repos.length ? [] : ['The loop is in no git repository here.']),
    `Loop root: ${o.root}. Tool: ${RUNTIME} ${o.script} (every command below is written with both).`,
  ]);
  section(out, 'You do not', o.doNot.map((d) => `- ${d}`));
  section(out, 'How to work', [
    `1. ${FIRST_STEP(lease)}`,
    '2. Work only inside the issue, by the repository\'s own rules too (its CLAUDE.md, AGENTS.md, hooks). No file you write carries a task number: only the commit subject names the issue.',
    (lease.inPlace ? '3. Write the declared files and nothing else, and leave them uncommitted. Never push or touch another branch.' : '3. Commit at the failing test and at the fix, one issue per commit, never amending, no agent trailer. Never push or touch another branch. To hold work aside copy it to a scratch directory: never `git stash`, whose list every worktree shares.'),
    '4. Prove each line by its method. [test]: a test red before the change and green after. [check]: its command, passing after it. [compare]: its command before and after, the outputs identical. Record each run with the proof command; never a row for a command you did not run. [read] and [owner] lines take no row.',
    '5. Run the test files you touch, in the foreground, with your tool\'s own timeout set; the merger runs the whole check on the merged result. Never report "waiting for the test run".',
    '6. A choice the lines leave open: make it and record it with the note command, the note starting `Assumed:`. A line you cannot meet without weakening something: the stuck command, then stop.',
    '7. A refused call writes nothing and ends with the form to run: fill its placeholders. Spawn no agents.',
  ]);
  renderCommon(o, out);
  section(out, 'What you report', `In under 200 words, once ${lease.inPlace ? 'your files are written' : 'the work is committed'} and your checks have finished: what changed, the commands and what they printed, every \`Assumed:\` note, "Found" (what you saw outside the issue)${lease.inPlace ? '' : ', and your commits'}.`);
}

function renderReviewer(o, out) {
  const { lease, depth } = o;
  out.push(`The examiner's brief for ${o.ids.length > 1 ? `issues ${o.ids.join(', ')}` : `issue ${o.id}`}, assembled from the record. Read nothing else for this job. You did not write this code: take no one's word for it.`);
  out.push(...o.notes.map((n) => `note: ${n}`), '');
  section(out, 'The goal', o.goal);
  for (const p of o.parents) section(out, `Why ${p.id} exists`, `${p.id} is part of ${p.parent.id} (${p.parent.title}): ${p.parent.why}`);
  for (const issue of o.issues) out.push(issue.text, '');
  section(out, 'Where to look', [
    `Depth: ${depth.says}. Run at tier ${depth.tier} or above${depth.secondFamily ? `, on ${depth.secondFamily} where you can` : ''}.`,
    lease.inPlace ? 'No branch: the work is in the files the issue declares.' : `Branch ${lease.branch ?? 'none'}.`,
    ...lease.repos.map((r) => `Repository ${r.label} (${r.repo}), base ${r.base}${lease.branch ? `, worktree ${r.worktree ?? 'none here'}` : ''}.`),
    `Loop root: ${o.root}. Tool: ${RUNTIME} ${o.script}. Read-only: never \`git checkout\` in the main checkout; reproduce with \`git show\` or \`git archive\` into a scratch directory.`,
  ]);
  section(out, 'You do not', o.doNot.map((d) => `- ${d}`));
  section(out, 'The six steps', [
    '1. Read every change to the lines below: the worker\'s change is a finding, the director\'s is the new requirement.',
    '2. Ask whether each method proves its line; a [test] must be able to fail for the right reason.',
    '3. Run every [test], [check] and [compare] line again, at any tier, and record each --by your name.',
    '4. Judge the [read] lines and quote them in the verdict.',
    '5. Invent scenarios the lines do not name, at the edges of what the change does, and run them.',
    '6. Check that nothing outside the issue moved and nothing protective was weakened.',
  ]);
  section(out, 'The verdict', 'Rank findings Critical, Important or Minor: Critical or Important is changes and a round, Minor alone is an approve. Record your own verdict last, with your name and model; your answer quotes the line review printed. Spawn nothing.');
  const changes = o.issues.flatMap((i) => (i.lineChanges || []).map((c) => ({ ...c, id: i.id })));
  section(out, 'Changes to the lines since the lease', changes.length ? changes.map(lineChangeText) : ['- (none)']);
  section(out, 'Proof to re-run', proofLines(o));
  const assumed = o.issues.flatMap((i) => (i.assumed || []).map((t) => `- ${i.id}: ${t}`));
  if (assumed.length) section(out, 'What the worker assumed', assumed);
  roundsAndFindings(o, out);
  renderCommon(o, out);
  section(out, 'What you report', 'Your verdict and its findings.');
}

// What went back: the rounds so far and the findings that sent the work back, once there are any, each whole.
function roundsAndFindings(o, out) {
  if (o.rounds.length) section(out, `Rounds so far (${o.rounds.length})`, o.rounds.map((r) => `- ${r.at} · ${r.text}`));
  if (o.findings.length) {
    section(out, `Findings of the reviews that sent it back (${o.findings.length})`, o.findings.flatMap((f) => {
      const [first, ...rest] = f.text.split('\n');
      return [`- ${f.day ?? ''}${f.by ? ` · by ${f.by}${f.kind ? ` (${f.kind})` : ''}` : ''}${f.fileOnly ? ' · in the issue file only' : ''} — ${first}`, ...rest.map((l) => `  ${l}`)];
    }));
  }
}

function lineChangeText(c) {
  const what = c.tier ? ` · Tier was ${c.tier.was}, now ${c.tier.now}` : `${c.removed.length ? ` · was: ${c.removed.join(' | ')}` : ''}${c.added.length ? ` · now: ${c.added.join(' | ')}` : ''}`;
  return `- ${c.id} · ${c.at}${c.by ? ` · by ${c.by}` : ' · by an unnamed writer'}${what}`;
}
function proofLines(o) {
  const out = o.issues.flatMap((i) => (i.reRun || []).map((r) => (r.rows.length
    ? `- ${i.id} line ${r.line} [${r.method}]: re-run ${r.rows.map((x) => `${x.ran} (saw: ${x.saw}${x.by ? `, by ${x.by}` : ''})`).join(' · ')}`
    : r.declared
      ? `- ${i.id} line ${r.line} [${r.method}]: on the declared check, which the landing proves: no row is owed`
      : r.noneDeclared
        ? `- ${i.id} line ${r.line} [${r.method}]: the goal declares no check for it, so done asks for rows: a row by the worker and one by you, each naming the line`
        : `- ${i.id} line ${r.line} [${r.method}]: no row names it: run it yourself; the worker's missing row is an Important finding`)));
  return out.length ? out : ['- (no test, check or compare line)'];
}

function renderMerger(o, out) {
  const target = o.target ?? 'the feature branch';
  out.push(`The merger's brief${o.slice ? ` of the slice ${o.slice}` : ''}, assembled from the record. Read nothing else for this job.`);
  out.push(...o.notes.map((n) => `note: ${n}`), '');
  section(out, 'The goal', o.goal);
  section(out, 'Where you merge', [
    `You are ${o.merger ?? 'the merger'}. Your target: ${o.target ?? o.repos.map((r) => `${r.base} in ${r.label}`).join(', ') ?? 'the branch the loop lands on'}.`,
    ...o.repos.map((r) => `Repository ${r.label} (${r.repo}), base ${r.base}${o.target ? `, target ${r.target}` : ''}.`),
    `Loop root: ${o.root}. Tool: ${RUNTIME} ${o.script} (every command below is written with both).`,
    'One writer per target branch: only you merge into it, in a worktree of your own, never a checkout another merger uses. You write the record through the tool; only the holder of the main checkout commits `.jarl/`.',
    o.committed
      ? 'The loop is committed: if you hold the main checkout, commit `.jarl/` before each merge and again after each landing, even one in another repository. If you do not, you never commit `.jarl/`.'
      : 'The loop is out of git: you never commit `.jarl/`, and a diff that touches it is reported, not merged, since a merge would overwrite the ignored loop.',
  ]);
  section(out, 'You do not', o.doNot.map((d) => `- ${d}`));
  section(out, 'Each branch, serially', [
    '1. Read the scope and the diff. A branch without a fresh reviewer\'s approve waits; report it.',
    `2. Merge into ${target}, in your own worktree: git, then the settings the merge-driver command prints, on every merge, then \`merge --no-ff\` and the branch. Where the repository has .yggdrasil/, add \`--yg "<command>"\` to the merge-driver call and run \`yg log merge-resolve\` right after.`,
    '3. A conflict the drivers stopped on: `git merge --abort` and report. Any other: resolve only when one side is plainly a superset or the hunks are independent, else abort and report the files.',
    '4. Branches sharing no file may be merged one after another and checked once as a batch; never batch two that touch one file.',
    '5. Run the repository\'s check on the merged result, in the foreground, with your tool\'s own timeout set; report only after it has finished.',
    '6. Green: the green-merge command for the issues on the branch, close each issue, then `show` it and confirm it reads done. `NO PROOF FROM THE WORKER`: done waits for the worker\'s row. `MERGE WITHOUT THE BRANCH` or `WITHOUT THE BASE`: merge and check again. `APPROVED ON ANOTHER TIP`: report the two tips.',
    '7. Changelog entries, once the batch is green: paste them under `[Unreleased]`, edited into the repository\'s register, committed as that file alone.',
    '8. An issue worked in place brings no branch, and none of these steps apply: once its approve stands, commit its declared files, a commit of their own between two merges, record the commit as a row with the in-place command, then close it.',
  ]);
  section(out, 'A red check', [
    'Roll back with `git reset --keep ORIG_HEAD`, never `--hard`, which throws away what others wrote meanwhile. Then one of three cases:',
    '1. A batch went red: reset to before its first merge, and land the branches one at a time, so the branch that fails is found.',
    '2. One branch\'s work fails it, or two good branches break together: that branch (the later of the two) gets a round with what failed, goes back to a worker, is rebuilt on what landed first, and is examined again.',
    '3. The cause is outside the branch (the base is red without it): file the cause as its own issue, leave the branch approved in the queue; it lands on red only on the jarl\'s ruling.',
    'Nobody repairs the target branch directly: a defect found after a landing is a small issue whose Found by names the landed issue.',
  ]);
  renderCommon(o, out);
  section(out, 'What you report', 'One line per branch: merged <sha> | red: <what-is-red> | conflict: <paths> | nothing to merge. Spawn no agents.');
}

function renderCommon(o, out) {
  // A role's own shipped rules are the steps above, said once there; what is listed here is what the loop's own rulings add.
  const ofLoop = o.rules.filter((r) => !r.builtin);
  section(out, 'Rules that reach you', ofLoop.length ? ofLoop.flatMap(ruleLines) : ['- (none of the loop\'s own)']);
  if (o.rulings.inForce) out.push(`${o.rulings.inForce} ruling(s) in force in the loop: ${o.rulings.command}`, '');
  section(out, 'Commands', o.record.filter((r) => !r.forIssue).map((r) => `- ${r.what}: ${r.command}`));
}
function section(out, title, body) { out.push(`## ${title}`, ...(Array.isArray(body) ? body : [body]), ''); }

// The brief as text: what it is, its notes, then each part under a heading of its own, every part whole.
export function renderBrief(o) {
  const out = [];
  if (o.role === 'coordinator') {
    out.push(`The coordinator's brief for the slice ${o.slice} (slice:${o.slice}), assembled from the record; it writes nothing.`);
    out.push(...o.notes.map((n) => `note: ${n}`), '');
    out.push(`## The issues of the slice in play (${o.issues.length})`);
    out.push(...(o.issues.length ? o.issues.map((i) => `- ${i.id} ${i.status}${i.worker ? ` · ${i.worker}` : ''} · ${i.title}${i.parent ? ` · sub-issue of ${i.parent}` : ''}`) : ['- (none)']));
    out.push('', `## Rules for the coordinator of the slice ${o.slice} (${o.rules.length})`, ...(o.rules.length ? o.rules.flatMap(ruleLines) : ['- (none)']), `${o.rulings.inForce} ruling(s) in force in the loop: ${o.rulings.command}`);
    out.push('', '## The role', `${o.reference.file}, section "${o.reference.section}", in the jarl skill's directory: the role in full; this brief adds what the record holds.`);
    out.push('', '## Recording the result', ...o.record.map((r) => `- ${r.what}: ${r.command}`));
    return out.join('\n');
  }
  if (o.role === 'merger') renderMerger(o, out);
  else if (o.role === 'reviewer') renderReviewer(o, out);
  else renderWorker(o, out);
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}
