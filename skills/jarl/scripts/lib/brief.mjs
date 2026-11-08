// brief: the text a role is raised with, assembled from the record when asked and never stored. For an issue's worker or
// reviewer: the issue as show prints it, the rules that reach that reader, the rounds so far and the findings of the
// reviews that sent the work back, the proof rows, the role's reference and the commands that record the result. For a
// slice's coordinator: its issues in play, its rules, its reference and its commands. It writes nothing and holds no lock.
// A brief adds what the record holds to the role's reference, and never replaces it.

import { IDENTICAL_OUTPUT_TAG, REVIEWER_KIND_SRC, fieldText, hole, jarlLine, meantToAlterNothing, need } from './base.mjs';
import { jarlDir, today } from './where.mjs';
import { firstLine } from './journal.mjs';
import { evidenceTable, issueNamed, reviewEntries } from './issues.mjs';
import { gateOf, readLoop, sameSlice, sliceNamed, sliceOf } from './loop.mjs';
import { takenOver } from './rounds.mjs';
import { findingOfLog } from './models.mjs';
import { loopRules, ruleLines, rulesFor } from './rules.mjs';
import { issueView } from './evidence.mjs';

// The roles an issue's brief is written for. A merger's brief is one for the whole loop, its branches the merge queue of
// resume; a coordinator's is the brief of its slice; a worker raised by a takeover is given the worker's brief, with the
// rules of the takeover too.
export const BRIEF_ROLES = Object.freeze(['worker', 'reviewer']);
// The moments a coordinator meets while it runs its slice: every moment of work but the close, which is the jarl's.
const COORDINATOR_MOMENTS = Object.freeze(['filing', 'start', 'review', 'round', 'merge', 'done']);
// Where each role's rules are written in full, inside the skill's directory.
const REFERENCES = Object.freeze({
  worker: { file: 'references/worker.md', section: "The worker's brief" },
  reviewer: { file: 'references/reviewer.md', section: "The reviewer's brief" },
  coordinator: { file: 'references/jarl.md', section: 'Coordinators: slices of the backlog' },
});

// A rule as a brief carries it: what ruleLines prints it from, and no more.
const ruleOf = (r) => ({ slug: r.slug, scope: r.scope, until: r.until ?? null, by: r.by ?? null, under: r.under ?? null, builtin: r.builtin === true, source: r.source ?? null, text: r.text });
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
  if (!head) return { verdict: null, by: null, kind: null, day: e.at.slice(0, 10), model: null, relayed: false, batch: null, readings: [], text: said };
  let text = said.slice(head[0].length);
  const verdict = e.type === 'verdict';
  // A verdict's marks stand right after its reviewer, in a fixed order: the model, the relay mark, the batch.
  const model = verdict ? e.model ?? null : null;
  const relayed = verdict && Boolean(e.relayed);
  const batch = verdict ? e.batch ?? null : null;
  if (model) text = text.slice(`model ${model} · `.length);
  if (relayed) text = text.slice('relayed · '.length);
  if (batch) text = text.slice(`batch ${batch} · `.length);
  // A verdict's text as the log holds it, and with the lead-in a writer sets before a finding that opens like a mark taken
  // off, since not every writer sets it; a retraction's names the approve it takes away, then its reason.
  const readings = verdict ? [sameText(text), sameText(findingOfLog(text))] : [sameText(text)];
  return { verdict: head[1], by: head[2] ?? null, kind: head[3] ?? null, day: e.at.slice(0, 10), model, relayed, batch, readings, text };
}
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
    readings, text,
  };
}
// Whether a review line and a Reviews entry can be one review: they agree on every field both record, and the entry's text
// is one the line can be read as. The day alone agrees when one of the two records none, as an entry may not.
const SAME_FIELDS = Object.freeze(['verdict', 'by', 'kind', 'model', 'relayed', 'batch']);
const oneReview = (line, entry) => SAME_FIELDS.every((f) => line[f] === entry[f])
  && (line.day === null || entry.day === null || line.day === entry.day)
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
// The same in any order: the most pairs by augmenting paths, and a pair of one such pairing is sure when, taken away, it
// leaves fewer pairs possible.
function pairsInAnyOrder(n, m, fits) {
  const most = (allowed) => {
    const entryAt = new Array(n).fill(-1);
    const take = (j, seen) => {
      for (let i = 0; i < n; i += 1) {
        if (seen[i] || !allowed(i, j)) continue;
        seen[i] = true;
        if (entryAt[i] === -1 || take(entryAt[i], seen)) { entryAt[i] = j; return true; }
      }
      return false;
    };
    let size = 0;
    for (let j = 0; j < m; j += 1) if (take(j, new Array(n).fill(false))) size += 1;
    return { size, entryAt };
  };
  const all = most(fits);
  const sure = new Map();
  all.entryAt.forEach((j, i) => { if (j !== -1 && most((a, b) => fits(a, b) && !(a === i && b === j)).size < all.size) sure.set(i, j); });
  return { most: all.size, sure };
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
  if (alone) notes.push(`${alone} review(s) of the Reviews section of ${issue.id} match no verdict line of its log, which is the record: listed after the log's, marked in the issue file only`);
  if (alike) notes.push(`${alike} review(s) of the Reviews section of ${issue.id} fit a verdict line of its log that another line or entry of the same reviewer fits as well, and nothing the two record tells which is whose: those verdicts are given as the log's lines, and the entries are listed after them, marked in the issue file only`);
  if (!ordered) notes.push(`no pairing in the log's order places every entry of the Reviews section of ${issue.id} that fits a verdict line of its log (the section holds them in another order, or more of them than the lines they fit): each entry is paired by what it records alone, its place telling nothing`);
  return [...found, ...left.map(({ k }) => ({ by: k.by, kind: k.kind, day: k.day, text: k.text, fileOnly: true }))];
}

function issueBrief(root, loop, rawId, role) {
  const issue = issueNamed(loop.issues, rawId);
  need(issue, `no such issue: ${rawId} — the issues: ${jarlLine('list', '--all')}`, () => ({ arg: 0, value: hole('<id>') }));
  const events = loop.eventsById.get(issue.id) || [];
  const rounds = events.filter((e) => e.type === 'round').map((e, n) => ({ round: n + 1, at: e.at, text: e.text.slice(e.written.length + 1) }));
  // A takeover as the record names one: a lease handed to a new worker with a reason that names a takeover (see takenOver).
  const tookOver = takenOver(loop.profile, events);
  const roles = new Set([role, ...(role === 'worker' && tookOver ? ['takeover'] : [])]);
  const moments = new Set([role === 'worker' ? 'start' : 'review', ...(rounds.length ? ['round'] : [])]);
  // The reader the rules are matched against, as next --as and resume --as match theirs: the role, the moment and the issue.
  const rules = rulesFor(root, loop, { roles, slice: null, moments, issues: [issue] }, today()).map(ruleOf);
  const proof = evidenceTable(issue.sections.evidence).rows.filter((r) => !r.retracted).map(({ n, ran, saw }) => ({ n, ran, saw }));
  const { profile } = loop;
  const notes = [];
  if (role === 'worker' && profile.is(issue.status, 'terminal')) notes.push(`${issue.id} is ${issue.status}: a worker starts on it once it is reopened — ${jarlLine('set', issue.id, profile.initial, hole('<why>'))}`);
  const findings = findingsOf(loop, issue, events, notes);
  if (role === 'reviewer' && !proof.length) notes.push(`${issue.id} holds no proof row: a worker's missing rows are an Important finding`);
  // A change meant to alter nothing: its worker records the comparison as a proof row, and its review may be light.
  if (meantToAlterNothing(issue)) {
    const meant = `${issue.id} is a change meant to alter nothing (tag ${IDENTICAL_OUTPUT_TAG})`;
    notes.push(role === 'worker'
      ? `${meant}: its comparison of the output before and after is a proof row, the command and what it printed — ${jarlLine('evidence', issue.id, '--ran', hole('<command>'), '--saw', hole('<what-it-printed>'))}`
      : `${meant}: its review may be a light one, and it checks that the comparison in its proof rows covers everything the change touched; the comparison never stands in for the review`);
  }
  const record = role === 'worker'
    ? [{ what: 'proof, one row per check', command: jarlLine('evidence', issue.id, '--ran', hole('<command>'), '--saw', hole('<what-it-printed>'), '--by', hole('<who>')) },
      { what: 'the changelog entry, for a change someone sees', command: jarlLine('field', issue.id, 'Changelog', hole('<changelog-entry>'), '--add', '--by', hole('<who>')) }]
    : [{ what: 'the verdict when a finding lies outside the issue, one --outside each (filed as a new issue, never a reason for changes)', command: jarlLine('review', issue.id, hole('<verdict>'), hole('<findings-with-a-severity>'), '--by', hole('<reviewer>'), '--model', hole('<model-id>'), '--outside', hole('<finding-outside-the-issue>')) },
      { what: 'the verdict, as the last step', command: jarlLine('review', issue.id, hole('<verdict>'), hole('<findings-with-a-severity>'), '--by', hole('<reviewer>'), '--model', hole('<model-id>')) }];
  return {
    role, id: issue.id, title: issue.title, status: issue.status, roles: sorted(roles), moments: sorted(moments),
    show: issueView(root, issue, { places: false }).replace(/\s+$/, ''),
    rules, rounds, findings, proof, reference: REFERENCES[role], record, notes,
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

// brief <id> [--role worker|reviewer] | brief --slice <coordinator>: the data of the brief, what --json prints.
export function cmdBrief(root, rawId, opts = {}) {
  const loop = readLoop(jarlDir(root));
  if (opts.slice !== undefined) {
    need(rawId === undefined || rawId === null, `brief --slice is the coordinator's brief and takes no id; an issue's brief is ${jarlLine('brief', hole('<id>'))}`, () => ({ truncate: 1 }));
    need(opts.role === undefined, `--role names the role of an issue's brief; brief --slice is the coordinator's`, () => ({ drop: '--role' }));
    return { ...sliceBrief(root, loop, opts.slice), rulings: rulingsOf(loop) };
  }
  need(rawId !== undefined && rawId !== null && String(rawId).trim(), `brief takes the id of an issue; a coordinator's brief is ${jarlLine('brief', '--slice', hole('<coordinator>'))}`, () => ({ arg: 0, value: hole('<id>') }));
  const role = opts.role === undefined ? 'worker' : fieldText(opts.role).toLowerCase();
  need(BRIEF_ROLES.includes(role), `--role is ${BRIEF_ROLES.join(' or ')} (got "${fieldText(opts.role)}"): a merger's brief is one for the whole loop (references/merger.md), its branches the merge queue of resume, and a coordinator's is ${jarlLine('brief', '--slice', hole('<coordinator>'))}`, () => ({ flag: '--role', value: hole('<role>') }));
  return { ...issueBrief(root, loop, rawId, role), rulings: rulingsOf(loop) };
}

const ROLE_WORD = { worker: "worker's", reviewer: "reviewer's", coordinator: "coordinator's" };
// The brief as text: what it is, its notes, then each part under a heading of its own, every part whole.
export function renderBrief(o) {
  const out = [];
  const reader = o.role === 'coordinator' ? `the coordinator of the slice ${o.slice}` : `the ${o.role} of ${o.id}`;
  if (o.role === 'coordinator') {
    out.push(`The coordinator's brief for the slice ${o.slice} (slice:${o.slice}), assembled from the record; it writes nothing.`);
    out.push(...o.notes.map((n) => `note: ${n}`), '');
    out.push(`## The issues of the slice in play (${o.issues.length})`);
    out.push(...(o.issues.length ? o.issues.map((i) => `- ${i.id} ${i.status}${i.worker ? ` · ${i.worker}` : ''} · ${i.title}${i.parent ? ` · sub-issue of ${i.parent}` : ''}`) : ['- (none)']));
  } else {
    out.push(`The ${ROLE_WORD[o.role]} brief for issue ${o.id}, assembled from the record; it writes nothing.`);
    out.push(...o.notes.map((n) => `note: ${n}`), '', o.show);
  }
  out.push('', `## Rules for ${reader} (${o.rules.length})`, ...(o.rules.length ? o.rules.flatMap(ruleLines) : ['- (none)']), `${o.rulings.inForce} ruling(s) in force in the loop: ${o.rulings.command}`);
  if (o.role !== 'coordinator') {
    out.push('', `## Rounds so far (${o.rounds.length})`, ...(o.rounds.length ? o.rounds.map((r) => `- ${r.at} · ${r.text}`) : ['- (none)']));
    out.push('', `## Findings of the reviews that sent it back (${o.findings.length})`);
    if (!o.findings.length) out.push('- (none)');
    for (const f of o.findings) {
      const [first, ...rest] = f.text.split('\n');
      out.push(`- ${f.day ?? ''}${f.by ? ` · by ${f.by}${f.kind ? ` (${f.kind})` : ''}` : ''}${f.fileOnly ? ' · in the issue file only' : ''} — ${first}`, ...rest.map((l) => `  ${l}`));
    }
    out.push('', `## Proof rows (${o.proof.length})`, ...(o.proof.length ? o.proof.map((r) => `- [${r.n}] ran: ${r.ran} · saw: ${r.saw}`) : ['- (none)']));
  }
  out.push('', '## The role', `${o.reference.file}, section "${o.reference.section}", in the jarl skill's directory: the role in full; this brief adds what the record holds.`);
  out.push('', '## Recording the result', ...o.record.map((r) => `- ${r.what}: ${r.command}`));
  return out.join('\n');
}
