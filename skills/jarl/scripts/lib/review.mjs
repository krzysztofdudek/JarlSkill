// The review command.

import { isAbsolute } from 'node:path';
import { Refusal, echoWord, fieldText, hole, jarlLine, need, refuse } from './base.mjs';
import { needNoOwnersWords } from './owner.mjs';
import { jarlDir, stamp } from './where.mjs';
import { readText, writeAtomic } from './files.mjs';
import { isBulk, newIssueKey } from './ids.mjs';
import { appendLog, appendLogLines, firstLine } from './journal.mjs';
import { bodyText, parseIssue, reviewEntries, setSection, unattributedRefusal } from './issues.mjs';
import { needFormat, tipLinesOf } from './repositories.mjs';
import { FORMAT_LINES, formatState, loadProfile, reviewerRule } from './profile.mjs';
import { carriesCode, gateOf, readLoop, reviewerKind, unclearedText } from './loop.mjs';
import { SEVERITIES, limitNote, loggedFinding, modelLines, modelRefusalOf, modelReviewForm, modelValue, reviewModelNotes, spellingNote } from './models.mjs';
import { EVIDENCE_HOW, cmdNew, issuesFor, nextIssueNumber, nothingWritten, oneOrMany, proofSince, refiled } from './commands.mjs';
import { REVIEW_MIN_WORDS, needSaid, raisedText, retractedBy, struck } from './evidence.mjs';
import { linesText, ownerLineWait, unprovedLines } from './owner-lines.mjs';
import { resetCaches } from './tips.mjs';

// ---- commands: review ---------------------------------------------------------------------------------

function retractReview(root, rawIds, reason, flags) {
  need(!isBulk(rawIds), 'retract names one issue', () => ({ arg: 0, value: hole('<id>') }));
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
  need(g.lastApprove || target, `${issue.id} has no approve to retract — a retraction takes away the newest approve (review), never a "changes" verdict; a row or a note is retracted by its number`, () => ({ arg: 1, value: '<n-or-note-n>' }));
  const who = g.lastApprove || target;
  const kind = reviewerKind(by, g.workers, coordinators, loop.bots);
  // The first retraction of a loop raises the record format, before its line is written: a reader of format 1 does not
  // read a retraction and would go on counting the approve, so it must refuse the loop instead.
  const raised = needFormat(root, 'retraction');
  const lines = table.lines.slice();
  if (target) lines[target.start] = `${struck(lines[target.start])}~~`;
  const named = `${who.by ? `by ${who.by}${who.kind ? ` (${who.kind})` : ''}` : 'with no reviewer recorded'}${(who.at || who.day) ? ` of ${(who.at || who.day).slice(0, 10)}` : ''}`;
  const entry = `- **retract** · by ${by} (${kind}) · ${stamp().slice(0, 10)}\n  retracts the approve ${named}\n${bodyText(reason).split('\n').map((l) => (l ? `  ${l}` : '')).join('\n')}`;
  const current = lines.join('\n').trim();
  writeAtomic(issue.file, setSection(raisedText(issue, text, raised), 'Reviews', current ? `${current}\n${entry}` : entry));
  appendLog(root, `${issue.id} review retract · by ${by} (${kind}) · retracts the approve ${named} · ${firstLine(reason, "the issue's Reviews section")}`);
  return { id: issue.id, verdict: 'retract', by, kind, retracted: named, severities: [], acceptance: (issue.sections.acceptance || '').trim() };
}
export function cmdReview(root, rawIds, verdict, findings, flags = {}) {
  needNoOwnersWords('the review', findings, flags);
  need(verdict === 'approve' || verdict === 'changes' || verdict === 'retract', `review takes approve or changes (got "${verdict}")`, () => [...(rawIds === undefined ? [{ arg: 0, value: '<ids>' }] : []), { arg: 1, value: hole('<verdict>') }, ...(findings === undefined ? [{ arg: 2, value: '<what-was-read-and-found>' }] : []), ...(flags.by === undefined ? [{ flag: '--by', value: '<reviewer>' }] : [])]);
  // A retraction takes an approve back and files nothing: a finding outside the issue, or a field for one, goes with a verdict.
  need(verdict !== 'retract' || (flags.outside === undefined && flags.field === undefined), 'a retraction files no finding outside the issue: a finding outside the issue goes with a verdict, review <ids> <verdict> --outside', () => [{ drop: '--outside' }, { drop: '--field' }]);
  if (verdict === 'retract') return retractReview(root, rawIds, findings, flags);
  need(findings, `review requires "<text>" — what was read and what was found, even when nothing`, () => ({ arg: 2, value: '<what-was-read-and-found>' }));
  const words = String(findings).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  need(words >= REVIEW_MIN_WORDS, `the findings of a review need at least ${REVIEW_MIN_WORDS} words — what was read and what was found, even when nothing (got ${words} word${words === 1 ? '' : 's'}: "${String(findings).trim().slice(0, 40)}")`, () => ({ arg: 2, value: hole('<what-was-read-and-found>') }));
  need(flags.by === undefined || fieldText(flags.by), '--by needs a value — the reviewer\'s name', () => ({ flag: '--by', value: '<reviewer>' }));
  need(flags.by !== undefined, `a verdict needs --by <reviewer> — who read the diff: a fresh reviewer's name, or jarl when the loop's director reviewed it`, () => ({ flag: '--by', value: '<reviewer>' }));
  const issues = issuesFor(root, rawIds);
  if (verdict === 'approve') for (const issue of issues) { const refusal = unattributedRefusal(issue, 'approved'); need(!refusal, issues.length > 1 ? nothingWritten(refusal) : refusal, refiled); }
  const severities = SEVERITIES.filter((s) => findings.includes(s));
  const outside = outsideFindings(flags.outside);
  need(flags.field === undefined || outside.length, '--field names a field of the issues --outside files, and the call gives no --outside', () => ({ drop: '--field' }));
  // The model the call named stays in every form it is refused with.
  const withModel = flags.model !== undefined ? [{ flag: '--model', value: hole('<model-id>') }] : [];
  if (verdict === 'changes') {
    // The verdict judges the issue: a finding outside it is filed and never sends the work back, so a changes verdict needs
    // a Critical or Important finding of its own, not only one given with --outside.
    const weighty = (text) => SEVERITIES.some((s) => s !== 'Minor' && text.includes(s));
    need(!outside.some((o) => weighty(o.text)) || weighty(findings), `"changes" sends the work back for a finding of the issue, and its only Critical or Important findings are outside the issue (--outside): each is filed as a new issue and never turns the verdict to changes — the verdict is the one the issue's own findings give`, () => [{ arg: 1, value: hole('<verdict>') }, { flag: '--by', value: hole('<reviewer>') }, ...withModel]);
    need(severities.length > 0, `"changes" needs at least one finding ranked ${SEVERITIES.join('/')} — name the severity, not just the problem (got ${JSON.stringify(findings)})`, () => ({ arg: 2, value: hole('<findings-with-a-severity>') }));
    need(severities.some((s) => s !== 'Minor'), `"changes" needs a Critical or Important finding — Minor alone goes to evidence on an approve, it never bounces a branch`, () => ({ arg: 1, value: '<verdict>' }));
  }
  const by = flags.by !== undefined ? fieldText(flags.by) : null;
  const model = flags.model !== undefined ? modelValue(flags.model) : undefined;
  const artifact = flags.artifact !== undefined ? artifactValue(flags.artifact) : undefined;
  need(flags.relayed === undefined || flags.relayed === true, '--relayed takes no value', () => ({ rename: '--relayed', to: hole('<no-flag-here>') }));
  const relayed = flags.relayed === true;
  need(flags.bot === undefined || flags.bot === true, '--bot takes no value', () => ({ rename: '--bot', to: hole('<no-flag-here>') }));
  // The whole loop, not just the issues under review: a sibling elsewhere on the same Branch still counts for self.
  const loop = by ? readLoop(jarlDir(root)) : null;
  const kinds = issues.map((issue) => {
    if (!by) return null;
    // Self is everyone who has ever held this issue's lease — its own worker across every takeover, and the
    // worker of any other issue sharing its Branch (a package) — not only its current Worker field.
    const self = [...gateOf(loop, issue.id).workers];
    const kind = reviewerKind(by, self, loop.coordinators, loop.bots);
    const who = self.length === 1 ? `${self[0]} is the issue's worker` : self.length > 1 ? `${self.join(', ')} have all held ${issue.id}'s lease` : '';
    need(verdict !== 'approve' || kind !== 'self', `${issue.id}: an approve by ${by} is a self-approve${who ? ` (${who})` : ''} and does not count as review — a fresh reviewer, or the jarl, reads the diff${issues.length > 1 ? ' — nothing was written' : ''}`, () => ({ flag: '--by', value: hole('<a-fresh-reviewer>') }));
    // --bot records the verdict as a bot's: never the verdict of the loop's director, nor of anyone who held the lease.
    need(flags.bot !== true || kind !== 'coordinator', `${by} reviews as the loop's director (coordinator), and --bot records a bot's verdict — a bot is named by its own name${issues.length > 1 ? ' — nothing was written' : ''}`, () => ({ flag: '--by', value: hole('<reviewer>') }));
    return flags.bot === true && kind === 'fresh' ? 'bot' : kind;
  });
  // Every finding outside the issue passes every check of a filing before anything is written, so a review refused for one
  // of them writes nothing at all; then each is filed, as a new issue, and the verdict's entry names the issue it became
  // under the findings of the issue itself. They are filed in the order given, each taking the next number, so each is
  // checked with the number it would take: one the loop's record format cannot hold refuses the review before the first.
  const first = outside.length ? nextIssueNumber(root) : 0;
  outside.forEach((o, k) => fileOutside(root, issues, by, o, flags, withModel, true, first + k));
  // One verdict given on several issues is one review: each of its lines carries the same batch id. The id is a line of
  // record format 3, which a reader of the formats below would count as several reviews, so the first one raises the loop
  // once every check has passed; a loop whose format a composer keeps records the verdict without it.
  // A bot's verdict is a line of record format 3 too: a reader of the formats below would read it as an approve with no
  // reviewer recorded. Where a composer keeps the loop's format it is refused, with nothing written.
  const botRaised = kinds.includes('bot') ? needBotFormat(root) : false;
  const batch = issues.length > 1 && holdsBatches(root) ? newIssueKey(stamp()) : null;
  // The artifact a verdict judged is a line of record format 3 too: a reader of the formats below would read it as the
  // first words of the findings. Only a verdict that names one raises the loop.
  const artifactRaised = artifact !== undefined ? needFormat(root, 'artifact') : false;
  const raised = (batch ? needFormat(root, 'batch') : false) || botRaised || artifactRaised;
  const filed = outside.map((o) => fileOutside(root, issues, by, o, flags, withModel, false));
  const recorded = filed.length ? `${String(findings).trim()}\n${filed.map((f) => `outside the issue, filed as ${f.id}: ${f.first}`).join('\n')}` : findings;
  // The whole findings go under the issue's ## Reviews (before Evidence, which stays last); the log keeps the verdict
  // line the gate reads, the first line of the findings and a pointer.
  const day = stamp().slice(0, 10);
  for (const [n, issue] of issues.entries()) {
    const text = readText(issue.file);
    const current = (parseIssue(text, issue.file).sections.reviews || '').trim();
    const entry = `- **${verdict}** · ${by ? `by ${by} (${kinds[n]}) · ` : ''}${day}${model !== undefined ? ` · model ${model}` : ''}${relayed ? ' · relayed' : ''}${batch ? ` · batch ${batch}` : ''}${artifact !== undefined ? ` · artifact ${artifact}` : ''}\n${bodyText(recorded).split('\n').map((l) => (l ? `  ${l}` : '')).join('\n')}`;
    writeAtomic(issue.file, setSection(text, 'Reviews', current ? `${current}\n${entry}` : entry));
  }
  // The model, the relay mark, the batch and the artifact come after the kind: a reader that parses only the name and the
  // kind ignores what follows.
  const marks = `${model !== undefined ? `model ${model} · ` : ''}${relayed ? 'relayed · ' : ''}${batch ? `batch ${batch} · ` : ''}${artifact !== undefined ? `artifact ${artifact} · ` : ''}`;
  // Each verdict line is followed by the tip of the issue's branch: the code the verdict was given on. A filing or the batch
  // may have raised the loop's format, which writes a bare format-1 path with a leading ./ and reads a bare word as a name:
  // the issues are read again, and every lookup of a repository is made anew, so the tip is read where the Repo points now.
  const again = filed.length > 0 || raised;
  if (again) resetCaches();
  const reviewed = again ? issuesFor(root, rawIds) : issues;
  const tips = tipLinesOf(root, reviewed);
  appendLogLines(root, reviewed.flatMap((issue, n) => [`${issue.id} review ${verdict} · ${by ? `by ${by} (${kinds[n]}) · ` : ''}${marks}${loggedFinding(firstLine(recorded, "the issue's Reviews section"))}`, ...tips(issue)]));
  // Recorded, never refused: a coordinator's approve on a code issue is a fact of the record, but it does not clear
  // the issue for done or the merge queue — the output says so at once. On the command line, in a loop that declares
  // its models, the model notes join it (see reviewModelNotes).
  const lines = flags.caller === 'cli' ? modelLines(root) : null;
  const rule = loop ? reviewerRule(loop.profile) : 'agent';
  const noteOf = (issue, n) => {
    const said = [
      verdict === 'approve' && kinds[n] === 'coordinator' && carriesCode(issue) ? `${issue.id} carries code and ${by} is a coordinator — the fresh-review rule: this approve is recorded but does not clear it for done or the merge queue; a fresh reviewer's approve does` : null,
      flags.caller === 'cli' && verdict === 'approve' && proofSince(gateOf(loop, issue.id), issue) === 0 ? `${issue.id} holds no Proof row since the gate's window opened — done needs the worker's row, and the merger's check does not stand in for it: ${EVIDENCE_HOW(issue.id)}` : null,
      flags.caller === 'cli' && verdict === 'approve' ? unprovedNote(loop, issue) : null,
      ...(lines && (lines.declared || rule !== 'agent') ? reviewModelNotes(loop, issue, verdict, model, lines, loop.eventsById.get(issue.id) || [], rule) : []),
      flags.caller === 'cli' && model !== undefined ? spellingNote(loop, model) : null,
      flags.caller === 'cli' && n === 0 ? limitNote(root, model) : null,
    ].filter(Boolean);
    return said.length ? { note: said.join('; ') } : {};
  };
  // The verdict comes back with the acceptance it was given against, so a reviewer (and the merger reading
  // the output) sees what the approve claims is met — or that there was nothing to meet.
  // Under a reviewer rule that judges the model, whether done refuses the approve just written for it is read from the loop
  // as it stands now, by the reading done itself uses, so the step the reply names is one that works.
  // The same holds for a bot's approve and for a loop that defines its approved issue: whether the approves clear the issue
  // is read from the loop as it stands now.
  const judged = rule !== 'agent' || kinds.includes('bot') || Boolean(loop && loop.profile.doneGate.clears);
  const written = flags.caller === 'cli' && verdict === 'approve' && judged ? readLoop(jarlDir(root)) : null;
  const writtenOf = (issue) => (written && written.byId.has(issue.id) ? written.byId.get(issue.id) : null);
  const modelOf = (issue) => ({ rule, refused: Boolean(writtenOf(issue) && modelRefusalOf(root, written, writtenOf(issue))) });
  const unclearedOf = (issue) => {
    const now = writtenOf(issue);
    const g = now ? gateOf(written, now.id) : null;
    const text = g ? unclearedText(written, now, g) : null;
    return text ? { text, cause: g.uncleared.cause } : null;
  };
  return oneOrMany(rawIds, issues.map((issue, n) => ({ id: issue.id, verdict, ...(by ? { by, kind: kinds[n] } : {}), ...(model !== undefined ? { model } : {}), ...(relayed ? { relayed } : {}), ...(batch ? { batch } : {}), ...(artifact !== undefined ? { artifact } : {}), severities, ...(filed.length ? { filed: filed.map((f) => f.id) } : {}), acceptance: (issue.sections.acceptance || '').trim(), ...(flags.caller === 'cli' ? { next: nextAfterVerdict(issue, verdict, kinds[n], loop && verdict === 'approve' ? ownerLineWait(root, loop, issue) : null, modelOf(issue), unclearedOf(issue)) } : {}), ...noteOf(issue, n) })));
}

// An --artifact value: the render or file a verdict judged, stored as given, trimmed. The record is read on other machines
// and is public, so it holds no place on one machine: a path that is absolute (on any platform, a home ~ included), a
// variable of a shell ($HOME, %USERPROFILE%), an address with a scheme (file://, https://) or a path that climbs above
// the root it is read from with .. is refused. A path is read against the root of the repository the work is
// in, and a / or a \ both part its segments. It is one segment of the verdict line: no separator and no line break.
function artifactValue(raw) {
  const p = typeof raw === 'string' ? raw.trim() : '';
  const form = () => ({ flag: '--artifact', value: hole('<path>') });
  need(p !== '', '--artifact needs a value — the path of the render or file the verdict judged, inside the repository the work is in', form);
  need(!/[\u0000-\u001f\u007f\u0085\u2028\u2029·]/.test(p), '--artifact is one path on one line, with no · in it', form);
  need(!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(p), `--artifact names a path inside the repository the work is in, relative to its root, and ${echoWord(p)} is an address with a scheme, which names no path inside the repository (a file:// address names a place on one machine)`, form);
  need(!/\$\{?[A-Za-z_]|%[A-Za-z_][A-Za-z0-9_]*%/.test(p), `--artifact names a path inside the repository the work is in, relative to its root, and ${echoWord(p)} holds a variable of a shell, which stands for a place on one machine`, form);
  need(!isAbsolute(p) && !/^[\\/~]/.test(p) && !/^[A-Za-z]:/.test(p), `--artifact names a path inside the repository the work is in, relative to its root, and ${echoWord(p)} is a place on one machine, which the record never holds`, form);
  let depth = 0;
  for (const s of p.split(/[\\/]/)) {
    if (s === '..') depth -= 1; else if (s !== '' && s !== '.') depth += 1;
    need(depth >= 0, `--artifact names a path inside the repository the work is in, and ${echoWord(p)} climbs out of it with ..`, form);
  }
  return p;
}

// The record format a bot's verdict needs, raised before the verdict is written. Where a composer keeps the loop's format,
// the refusal ends with the profile view, which shows the format the profile says, and then the call's own form: --bot
// takes no value, so no placeholder follows it.
function needBotFormat(root) {
  try { return needFormat(root, 'bot-verdict'); } catch (e) {
    if (!(e instanceof Refusal) || formatState(loadProfile(root)).raises) throw e;
    return refuse(e.reason, [{ first: ['jarl.mjs', 'profile'] }, { retry: true }]);
  }
}

// What an approve says of the acceptance lines no row names, in a loop that names them: done refuses the close without a
// reason, so the note names the lines and the close that gives one. Null where every line is named, or the loop names none.
function unprovedNote(loop, issue) {
  const left = unprovedLines(loop, issue) || [];
  return left.length ? `${issue.id}: no Proof row names acceptance ${linesText(left)}, and done closes it only with a reason given: ${jarlLine('set', issue.id, 'done', '<why>')}, or a row that names each, ${jarlLine('evidence', issue.id, '--ran', '<command>', '--saw', '<what-it-printed>', '--line', '<line>')}` : null;
}

// Whether the loop holds a batch id: it is in the format that holds one, or Jarl may raise it there.
function holdsBatches(root) {
  const profile = loadProfile(root);
  return profile.format >= FORMAT_LINES.batch.format || formatState(profile).raises;
}

// The findings a review gives outside the issue (--outside, repeatable), each a text with words in it, as written.
function outsideFindings(raw) {
  const given = raw === undefined ? [] : [].concat(raw);
  for (const v of given) {
    const said = (String(v ?? '').match(/[\p{L}\p{N}]/gu) || []).length;
    need(typeof v === 'string' && said >= 2, `a finding outside the issue needs words — what was found and where (got "${String(v ?? '').trim().slice(0, 20)}")`, () => ({ replace: String(v ?? ''), value: hole('<finding-outside-the-issue>') }));
  }
  return given.map((v) => ({ given: v, text: bodyText(v).trim() }));
}
// The most of a finding's first line a title keeps; the finding is the issue's What, whole.
const OUTSIDE_TITLE_CHARS = 100;
// The fixes of a filing's refusal that are also fixes of the review: a field of the profile (--field) and the loop's root.
const REVIEW_TAKES = new Set(['--field', '--root']);
// One finding outside the reviewed issues, filed as a new issue (Found by the reviewer, Where the review of the reviewed
// issues, ruling outside-finding-found-by-reviewer-where-names-the-review): its title the finding's first line, its What
// the finding, the fields the review's --field gives (a field the profile defaults takes its default), and the Repo the
// reviewed issues hold once the filing's raises have run. Dry, it runs every check of the filing with the number it would
// take (`number`) and writes nothing; a refusal names the finding, and ends with the form of the review: the filing's own
// fix where review takes it, else the finding's place.
function fileOutside(root, issues, by, o, flags, withModel, dry, number) {
  const first = o.text.split('\n')[0].trim();
  const title = first.length > OUTSIDE_TITLE_CHARS ? `${first.slice(0, OUTSIDE_TITLE_CHARS - 1)}…` : first;
  const opts = { what: o.text, 'found-by': by, where: `the review of ${issues.map((i) => i.id).join(', ')}`, ...(flags.field !== undefined ? { field: flags.field } : {}) };
  const from = { dry, repoOf: issues.map((i) => i.file), ...(dry ? { number } : {}) };
  if (!dry) return { id: cmdNew(root, title, opts, from).id, first };
  try { cmdNew(root, title, opts, from); } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    const fixes = [].concat(e.ready);
    const kept = fixes.every((f) => f && typeof f === 'object' && REVIEW_TAKES.has(f.flag));
    const shown = first.length > 60 ? `${first.slice(0, 59)}…` : first;
    // A field's tag pair in the finding: the filing's reason names a flag of new, which review does not take.
    const tag = /holds an opening and a closing (\w+) tag in angle brackets/.exec(e.reason);
    const why = tag ? `it holds an opening and a closing ${tag[1]} tag in angle brackets, which the text of an issue never holds: write the finding without the tag pair, or put the tags in backticks` : e.reason;
    refuse(`the finding outside the issue "${shown}" cannot be filed: ${why}${/nothing was written/.test(why) ? '' : ' — nothing was written'}`, [...(kept ? fixes : [{ replace: String(o.given), value: hole('<finding-outside-the-issue>') }]), { flag: '--by', value: hole('<reviewer>') }, ...withModel]);
  }
  return null;
}

// The one step a verdict leaves, named in its reply so nobody has to know the flow: an approve is followed by the merge
// (the merger lands it and records it with one call) and then done, which a worker never sets; changes are followed by a
// round, which sends the work back to a worker raised again. A coordinator's approve on code does not clear it: a fresh
// reviewer's approve is the next step. `wait` is what done also waits for: the owner's tick of a line only he ticks.
// `model` is the loop's reviewer rule and whether done refuses this approve for its model: under a rule that judges the
// model, the fresh reviewer's approve is given with --model, and an approve the rule refuses is followed by the review
// form that carries the model, before any step that depends on done accepting it.
// `uncleared` is why the approves the issue holds now do not clear it, other than the fresh-review rule: a bot the done
// gate does not name, or the loop's own definition of an approved issue; an approve that clears it is then next.
function nextAfterVerdict(issue, verdict, kind, wait = null, model = { rule: 'agent', refused: false }, uncleared = null) {
  if (verdict === 'changes') return `the jarl records the round — ${jarlLine('round', issue.id, '<text>')} — and a worker is raised again to fix it`;
  if (uncleared) return `${uncleared.text} — an approve that clears it is next — ${jarlLine('review', issue.id, '<verdict>', '--by', uncleared.cause === 'bot' ? '<a-fresh-reviewer>' : '<reviewer>', '<text>')}`;
  if (carriesCode(issue) && kind === 'coordinator') return `a fresh reviewer's approve is next — ${model.rule === 'agent' ? jarlLine('review', issue.id, '<verdict>', '--by', '<a-fresh-reviewer>', '<text>') : modelReviewForm(issue.id)} — then the merger lands it`;
  const after = carriesCode(issue)
    ? `the merger merges the branch and records it with one call — ${jarlLine('merged', issue.id, '--sha', '<sha>', '--ran', '<command>', '--saw', '<what-it-printed>')} — then ${wait ? `${wait}, then ` : ''}${jarlLine('set', issue.id, 'done', '<why>')}, which needs a Proof row from the worker (the merge check is the merger's and is no proof); a worker never sets done`
    : `${wait ? `${wait}, then ` : ''}${jarlLine('set', issue.id, 'done', '<why>')} once the worker's Proof rows are recorded; a worker never sets done`;
  if (model.refused) return `done refuses this approve for its model (done-gate "reviewer": "${model.rule}"), so an approve that names a model the rule accepts is next — ${modelReviewForm(issue.id)} — then ${after}`;
  return after;
}
