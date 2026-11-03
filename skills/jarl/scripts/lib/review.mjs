// The review command.

import { fieldText, need } from './base.mjs';
import { needNoOwnersWords } from './owner.mjs';
import { jarlDir, stamp } from './where.mjs';
import { readText, writeAtomic } from './files.mjs';
import { isBulk } from './ids.mjs';
import { appendLog, appendLogLines, firstLine } from './journal.mjs';
import { bodyText, parseIssue, reviewEntries, setSection } from './issues.mjs';
import { raiseFormat, tipLines } from './repositories.mjs';
import { carriesCode, gateOf, readLoop, reviewerKind } from './loop.mjs';
import { SEVERITIES, loggedFinding, modelLines, modelValue, reviewModelNotes } from './models.mjs';
import { EVIDENCE_HOW, issuesFor, oneOrMany, proofSince } from './commands.mjs';
import { REVIEW_MIN_WORDS, needSaid, retractedBy, struck } from './evidence.mjs';

// ---- commands: review ---------------------------------------------------------------------------------

function retractReview(root, rawIds, reason, flags) {
  need(!isBulk(rawIds), 'retract names one issue');
  const by = retractedBy(flags, 'a retraction');
  needSaid(reason, 'a retraction');
  const [issue] = issuesFor(root, rawIds);
  const loop = readLoop(jarlDir(root));
  const { coordinators } = loop;
  const g = gateOf(loop, issue.id);
  const text = readText(issue.file);
  const table = reviewEntries(parseIssue(text, issue.file).sections.reviews);
  let target = null;
  for (let k = table.entries.length - 1; k >= 0; k -= 1) { const e = table.entries[k]; if (e.verdict === 'approve' && !e.retracted) { target = e; break; } }
  need(g.lastApprove || target, `${issue.id} has no approve to retract — a retraction takes away the newest approve, never a "changes" verdict`);
  const who = g.lastApprove || target;
  const kind = reviewerKind(by, g.workers, coordinators);
  // The first retraction of a loop raises the record format, before its line is written: a reader of format 1 does not
  // read a retraction and would go on counting the approve, so it must refuse the loop instead.
  raiseFormat(root);
  const lines = table.lines.slice();
  if (target) lines[target.start] = `${struck(lines[target.start])}~~`;
  const named = `${who.by ? `by ${who.by}${who.kind ? ` (${who.kind})` : ''}` : 'with no reviewer recorded'}${(who.at || who.day) ? ` of ${(who.at || who.day).slice(0, 10)}` : ''}`;
  const entry = `- **retract** · by ${by} (${kind}) · ${stamp().slice(0, 10)}\n  retracts the approve ${named}\n${bodyText(reason).split('\n').map((l) => (l ? `  ${l}` : '')).join('\n')}`;
  const current = lines.join('\n').trim();
  writeAtomic(issue.file, setSection(text, 'Reviews', current ? `${current}\n${entry}` : entry));
  appendLog(root, `${issue.id} review retract · by ${by} (${kind}) · retracts the approve ${named} · ${firstLine(reason, "the issue's Reviews section")}`);
  return { id: issue.id, verdict: 'retract', by, kind, retracted: named, severities: [], acceptance: (issue.sections.acceptance || '').trim() };
}
export function cmdReview(root, rawIds, verdict, findings, flags = {}) {
  needNoOwnersWords('the review', findings, flags);
  need(verdict === 'approve' || verdict === 'changes' || verdict === 'retract', 'review requires approve|changes|retract');
  if (verdict === 'retract') return retractReview(root, rawIds, findings, flags);
  need(findings, 'review requires "<findings>" — what was read and what was found, even when nothing');
  const words = String(findings).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  need(words >= REVIEW_MIN_WORDS, `the findings of a review need at least ${REVIEW_MIN_WORDS} words — what was read and what was found, even when nothing (got ${words} word${words === 1 ? '' : 's'}: "${String(findings).trim().slice(0, 40)}")`);
  need(flags.by === undefined || fieldText(flags.by), '--by needs a value — the reviewer\'s name');
  need(flags.by !== undefined, `a verdict needs --by <reviewer> — who read the diff: a fresh reviewer's name, or jarl when the loop's director reviewed it`);
  const issues = issuesFor(root, rawIds);
  const severities = SEVERITIES.filter((s) => findings.includes(s));
  if (verdict === 'changes') {
    need(severities.length > 0, `"changes" needs at least one finding ranked ${SEVERITIES.join('/')} — name the severity, not just the problem`);
    need(severities.some((s) => s !== 'Minor'), '"changes" needs a Critical or Important finding — Minor alone goes to evidence on an approve, it never bounces a branch');
  }
  const by = flags.by !== undefined ? fieldText(flags.by) : null;
  const model = flags.model !== undefined ? modelValue(flags.model) : undefined;
  need(flags.relayed === undefined || flags.relayed === true, '--relayed takes no value');
  const relayed = flags.relayed === true;
  // The whole loop, not just the issues under review: a sibling elsewhere on the same Branch still counts for self.
  const loop = by ? readLoop(jarlDir(root)) : null;
  const kinds = issues.map((issue) => {
    if (!by) return null;
    // Self is everyone who has ever held this issue's lease — its own worker across every takeover, and the
    // worker of any other issue sharing its Branch (a package) — not only its current Worker field.
    const self = [...gateOf(loop, issue.id).workers];
    const kind = reviewerKind(by, self, loop.coordinators);
    const who = self.length === 1 ? `${self[0]} is the issue's worker` : self.length > 1 ? `${self.join(', ')} have all held ${issue.id}'s lease` : '';
    need(verdict !== 'approve' || kind !== 'self', `${issue.id}: an approve by ${by} is a self-approve${who ? ` (${who})` : ''} and does not count as review — a fresh reviewer, or the jarl, reads the diff${issues.length > 1 ? ' — nothing was written' : ''}`);
    return kind;
  });
  // The whole findings go under the issue's ## Reviews (before Evidence, which stays last); the log keeps the verdict
  // line the gate reads, the first line of the findings and a pointer.
  const day = stamp().slice(0, 10);
  for (const [n, issue] of issues.entries()) {
    const text = readText(issue.file);
    const current = (parseIssue(text, issue.file).sections.reviews || '').trim();
    const entry = `- **${verdict}** · ${by ? `by ${by} (${kinds[n]}) · ` : ''}${day}${model !== undefined ? ` · model ${model}` : ''}${relayed ? ' · relayed' : ''}\n${bodyText(findings).split('\n').map((l) => (l ? `  ${l}` : '')).join('\n')}`;
    writeAtomic(issue.file, setSection(text, 'Reviews', current ? `${current}\n${entry}` : entry));
  }
  // The model and the relay mark come after the kind: a reader that parses only the name and the kind ignores what follows.
  const marks = `${model !== undefined ? `model ${model} · ` : ''}${relayed ? 'relayed · ' : ''}`;
  // Each verdict line is followed by the tip of the issue's branch: the code the verdict was given on.
  appendLogLines(root, issues.flatMap((issue, n) => [`${issue.id} review ${verdict} · ${by ? `by ${by} (${kinds[n]}) · ` : ''}${marks}${loggedFinding(firstLine(findings, "the issue's Reviews section"))}`, ...tipLines(root, issue)]));
  // Recorded, never refused: a coordinator's approve on a code issue is a fact of the record, but it does not clear
  // the issue for done or the merge queue — the output says so at once. On the command line, in a loop that declares
  // its models, the model notes join it (see reviewModelNotes).
  const lines = flags.caller === 'cli' ? modelLines(root) : null;
  const noteOf = (issue, n) => {
    const said = [
      verdict === 'approve' && kinds[n] === 'coordinator' && carriesCode(issue) ? `${issue.id} carries code and ${by} is a coordinator — the fresh-review rule: this approve is recorded but does not clear it for done or the merge queue; a fresh reviewer's approve does` : null,
      flags.caller === 'cli' && verdict === 'approve' && proofSince(gateOf(loop, issue.id), issue) === 0 ? `${issue.id} holds no Proof row since the gate's window opened — done needs the worker's row, and the merger's check does not stand in for it: ${EVIDENCE_HOW(issue.id)}` : null,
      ...(lines && lines.declared ? reviewModelNotes(issue, verdict, model, lines, loop.eventsById.get(issue.id) || []) : []),
    ].filter(Boolean);
    return said.length ? { note: said.join('; ') } : {};
  };
  // The verdict comes back with the acceptance it was given against, so a reviewer (and the merger reading
  // the output) sees what the approve claims is met — or that there was nothing to meet.
  return oneOrMany(rawIds, issues.map((issue, n) => ({ id: issue.id, verdict, ...(by ? { by, kind: kinds[n] } : {}), ...(model !== undefined ? { model } : {}), ...(relayed ? { relayed } : {}), severities, acceptance: (issue.sections.acceptance || '').trim(), ...(flags.caller === 'cli' ? { next: nextAfterVerdict(issue, verdict, kinds[n]) } : {}), ...noteOf(issue, n) })));
}

// The one step a verdict leaves, named in its reply so nobody has to know the flow: an approve is followed by the merge
// (the merger lands it and records it with one call) and then done, which a worker never sets; changes are followed by a
// round, which sends the work back to a worker raised again. A coordinator's approve on code does not clear it: a fresh
// reviewer's approve is the next step.
function nextAfterVerdict(issue, verdict, kind) {
  if (verdict === 'changes') return `the jarl records the round — jarl.mjs round ${issue.id} "<what failed>" — and a worker is raised again to fix it`;
  if (carriesCode(issue) && kind === 'coordinator') return `a fresh reviewer's approve is next — jarl.mjs review ${issue.id} approve|changes --by <fresh reviewer> "<findings>" — then the merger lands it`;
  if (carriesCode(issue)) return `the merger merges the branch and records it with one call — jarl.mjs merged ${issue.id} --sha <sha> --ran "<check>" --saw "<summary>" — then jarl.mjs set ${issue.id} done, which needs a Proof row from the worker (the merge check is the merger's and is no proof); a worker never sets done`;
  return `jarl.mjs set ${issue.id} done once the worker's Proof rows are recorded; a worker never sets done`;
}
