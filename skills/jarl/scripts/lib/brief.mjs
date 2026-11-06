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

// The findings of the reviews that sent the work back. The log is the record, which every writer keeps: each "changes"
// verdict line of the issue is one finding, in the log's order, once. An entry of the file's Reviews section is the same
// verdict when it names the same reviewer and its text is the line's, whole or as the log writes a text of many lines (its
// first line and where the rest is): then the finding is given whole from the file. Nothing is paired by order, by
// verdict word or by day. A "changes" entry that is no verdict line of the log is listed after them, marked fileOnly, and
// `notes` gains a note that says how many there are.
function findingsOf(loop, issue, events, notes) {
  const { lines, entries } = reviewEntries(issue.sections.reviews);
  const fromFile = (e) => ({ by: e.by, kind: e.kind, day: e.day, text: lines.slice(e.start + 1, e.end + 1).map((l) => l.replace(/^ {2}/, '')).join('\n').trim() });
  const unmatched = entries.filter((e) => e.verdict === 'changes').map(fromFile);
  const found = gateOf(loop, issue.id).trail.filter((t) => t.verdict === 'changes').map((t) => {
    const e = events.find((x) => x.n === t.n);
    // What the line holds after its verdict, its reviewer and the marks of a model, a relay and a batch.
    let text = e.text.slice(e.written.length + 1).replace(new RegExp(`^review changes · (?:by .+? \\((?:${REVIEWER_KIND_SRC})\\) · )?`), '');
    if (e.model) text = text.replace(`model ${e.model} · `, '');
    if (e.relayed) text = text.replace(/^relayed · /, '');
    if (e.batch) text = text.replace(`batch ${e.batch} · `, '');
    text = text.replace(/^findings: (?=model |relayed|batch )/i, '');
    const at = unmatched.findIndex((f) => f.by === t.by && [sameText(f.text), sameText(firstLine(unescaped(f.text), WHERE_WHOLE))].includes(sameText(text)));
    const whole = at === -1 ? null : unmatched.splice(at, 1)[0];
    return { by: t.by, kind: t.kind, day: t.at.slice(0, 10), text: whole ? whole.text : text };
  });
  if (unmatched.length) notes.push(`${unmatched.length} review(s) of the Reviews section of ${issue.id} match no verdict line of its log, which is the record: listed after the log's, marked in the issue file only`);
  return [...found, ...unmatched.map((f) => ({ ...f, fileOnly: true }))];
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
