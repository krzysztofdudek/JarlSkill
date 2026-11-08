// What a lease must hold before an issue is taken: the lease flags, the tree, the other leases and the worktree.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fieldText, hole, jarlLine, need, splitList } from './base.mjs';
import { jarlDir } from './where.mjs';
import { branchNameProblem } from './ids.mjs';
import { loadProfile } from './profile.mjs';
import { acceptanceLineCount, loadIssues } from './issues.mjs';
import { fileKeysOf, isGitRepo, issueRepoPaths, repoLabel, worktreesOf } from './repositories.mjs';
import { activeSlices, sliceOf } from './slices.mjs';
import { leaseConflictOf } from './gate.mjs';
import { readLoop } from './loop.mjs';
import { LINE_FORM } from './lines.mjs';
import { declaredInCall, sameDir } from './shared.mjs';

// The lease flags (--branch, --worker, --model, --worktree) a call gives. They belong to a move into a status that holds
// a claim; a call that writes a field refuses them.
const LEASE_FLAGS = ['branch', 'worker', 'model', 'worktree'];

export function leaseFlagsGiven(flags) { return LEASE_FLAGS.filter((k) => flags[k] !== undefined); }

export function needNoLeaseFlags(flags, what) {
  const lease = [...leaseFlagsGiven(flags), ...(flags.handover !== undefined ? ['handover'] : [])];
  need(!lease.length, `--${lease[0]} goes with a status, not with ${what}`, () => ({ rename: `--${lease[0]}`, to: hole('<no-flag-here>') }));
}

// The tree holds through a move, so no unfinished issue sits under a finished one. An issue moved into a finished status
// (terminal) takes its unfinished sub-issues along in the same call, a drop or a deferral of the whole; a move into the
// status that closes the record waits instead in the done gate, for every sub-issue settled and the parent's own check.
// An issue moved back into play is not under a finished issue, unless that one moves back into play in the same call.
export function needTreeHolds(profile, issues, status, nothing) {
  const moving = new Set(issues.map((i) => i.id));
  const form = () => ({ arg: 0, value: hole('<ids>') });
  if (profile.is(status, 'terminal')) {
    if (profile.is(status, 'closes-record')) return;
    for (const issue of issues) {
      const left = (issue.tree ? issue.tree.children : []).filter((c) => profile.unfinished(c.status) && !moving.has(c.id));
      need(!left.length, `${issue.id} has sub-issues not finished: ${left.map((c) => `${c.id} (${c.status})`).join(', ')} — an issue goes ${status} with its sub-issues, so name them in the same call, or finish them first${nothing}`, form);
    }
    return;
  }
  for (const issue of issues) {
    const above = (issue.tree ? issue.tree.ancestors : []).find((a) => profile.is(a.status, 'terminal') && !moving.has(a.id));
    need(!above, `${issue.id} is under ${above?.id}, which is ${above?.status}: an issue is in play only under issues in play, so move ${above?.id} back into play in the same call, or first${nothing}`, form);
  }
}

// A lease holds. Called under the write lock with the issues just read from the record, before anything is written:
// - an issue a lease holds (a status that holds the claim, with a worker or a branch) is refused a lease that names
//   another worker or branch, unless the call hands it over (--handover, with the move's reason as why); a handover
//   needs a lease to replace and a holder that changes;
// - an issue that takes a lease (a new one, or a handover) is refused a file or a resource that another issue's lease
//   holds, unless it joins that lease: the same branch, and the same worker when both name one. Issues leased in one
//   call share one lease.
// A move that names no new holder, or restates the one the issue has, takes nothing new and is never refused here.
// A loop whose profile names an external scheduler is leased by its composer, which decides who holds what (several
// issues it runs at once may share a file there), so neither refusal runs in it; a handover there is still checked
// and logged.
export function needLeaseHolds(root, profile, issues, status, why, flags, handover, nothing) {
  const composed = profile.scheduler !== null && profile.scheduler !== undefined;
  const named = (k) => (flags[k] !== undefined ? fieldText(flags[k]) : null);
  const leaseFlags = ['branch', 'model', 'worker'].filter((k) => named(k) !== null).flatMap((k) => [`--${k}`, named(k)]);
  const taken = new Set(issues.map((i) => i.id));
  const leased = (i) => profile.is(i.status, 'holds-claim') && Boolean(i.fields.worker || i.fields.branch);
  // Another holder named by the call: a worker or a branch other than the one the lease already names.
  const replaces = (i) => ['worker', 'branch'].some((k) => named(k) !== null && i.fields[k] && named(k) !== fieldText(i.fields[k]));
  if (handover) need(why, `--handover says why the work changes hands: ${jarlLine('set', issues.map((i) => i.id).join(','), status, '<why-the-worker-changed>', ...leaseFlags, '--handover')}`, () => ({ arg: 2, value: '<why-the-worker-changed>' }));
  // A worker raised on an issue with no line has nothing to prove and a reviewer nothing to check it against.
  for (const issue of issues) need(acceptanceLineCount(issue) > 0, `${issue.id} has no acceptance line, so a lease would hold a worker to nothing that can be proved — every issue carries at least one line before it is leased${nothing}`, () => ['jarl.mjs', 'field', hole('<id>'), 'Acceptance', LINE_FORM]);
  const everyIssue = handover && !composed ? loadIssues(root) : [];
  for (const issue of issues) {
    if (handover) {
      need(leased(issue), `${issue.id} holds no lease to hand over${nothing} — lease it without --handover: ${jarlLine('set', issue.id, status, '<text>', ...leaseFlags)}`, () => ({ rename: '--handover', to: hole('<no-flag-here>') }));
      const left = everyIssue.filter((i) => !taken.has(i.id) && sameLease(profile, i, issue));
      need(!left.length, `${issue.id} shares its lease with ${left.map((i) => i.id).join(', ')} (${leaseWords(issue)}): a handover moves the whole lease or nothing, or two workers would hold one branch — name every issue of the lease${nothing}`, () => ['jarl.mjs', 'set', hole('<ids>'), status, hole('<why-the-worker-changed>'), '--worker', hole('<the-new-worker>'), '--handover', '--by', hole('<who>')]);
      // A lease the log holds twice is settled by a handover to either of its two holders, the one the issue's header already names too.
      need(replaces(issue) || ((named('worker') !== null || named('branch') !== null) && leaseConflictOf(readLoop(jarlDir(root)), issue) !== null), `--handover names the lease ${issue.id} already has (${holderText(issue)}) — a handover names the new --worker or --branch${nothing}`, () => ({ flag: '--worker', value: '<the-new-worker>' }));
    } else if (!composed) {
      need(!(leased(issue) && replaces(issue)), `${issue.id} is leased already (${holderText(issue)}) — a second lease would replace it in silence, and ${fieldText(issue.fields.worker) || 'its worker'} would go on working on a branch the record does not name; when the work changes hands, say why: ${jarlLine('set', [issue.id, ...loadIssues(root).filter((x) => x.id !== issue.id && sameLease(profile, x, issue)).map((x) => x.id)].join(','), status, '<why-the-worker-changed>', ...leaseFlags, '--handover')}${nothing}`, () => ([...(why ? [] : [{ arg: 2, value: '<why-the-worker-changed>' }]), { flag: hole('<--handover-or-none>') }]));
    }
  }
  if (composed) return;
  // With more than one slice in play, a lease holds only what its issue declares, so one that declares nothing would
  // collide with another slice's work unseen: it is refused until the issue declares its files or its resources. The issues
  // in no slice, the jarl's own, are one more slice of work beside the coordinators' when one of them is in play. The
  // reason names the issue; the forms carry a placeholder for the ids.
  const loop = readLoop(jarlDir(root));
  const unsliced = loop.issues.some((i) => sliceOf(i) === null && loop.profile.active(i.status));
  const slices = [...activeSlices(loop).map((x) => x.tag), ...(unsliced ? ['the issues in no slice'] : [])];
  if (slices.length > 1) {
    for (const issue of issues) {
      if ((leased(issue) && !handover) || issue.files.length || issue.resources.length) continue;
      need(false, `${issue.id} declares no Files or Resources, and ${slices.length} slices are in play (${slices.join(', ')}): across slices only leases hold, and a lease holds only what its issue declares — declare them first, its files or its resources (${jarlLine('field', '<ids>', 'Resources', '<resource-name>')})${nothing}`, () => [{ first: ['jarl.mjs', 'field', hole('<ids>'), 'Files', hole('<paths>')] }, { retry: true }]);
    }
  }
  const others = otherLeases(root, profile, taken);
  for (const issue of issues) {
    if (leased(issue) && !handover) continue;
    const held = heldByOthers(root, others, issue, named('branch') ?? fieldText(issue.fields.branch), named('worker') ?? fieldText(issue.fields.worker), fileKeysOf(root, issue), issue.resources);
    if (!held.length) continue;
    const { what, by } = held[0];
    const join = by.fields.branch ? `, or put ${issue.id} in ${by.id}'s lease: set ${issue.id} ${status} "<text>" --branch ${fieldText(by.fields.branch)}${by.fields.worker ? ` --worker ${fieldText(by.fields.worker)}` : ''}` : '';
    need(false, `${issue.id} ${what}, which ${by.id} holds in its lease (${holderText(by)}) — two leases on one file or resource collide; wait until ${by.id} leaves its lease (next offers ${issue.id} then)${join}${nothing}; what is ready: ${jarlLine('next')}`, () => ({ arg: 0, value: '<an-issue-next-offers>' }));
  }
}

// Two issues on one lease: both hold a claim, on one branch of one repository, or both worked in place by one worker.
export function sameLease(profile, a, b) {
  if (!profile.is(a.status, 'holds-claim') || !profile.is(b.status, 'holds-claim')) return false;
  const [ba, bb] = [fieldText(a.fields.branch), fieldText(b.fields.branch)];
  if (ba || bb) return ba === bb && fieldText(a.fields.repo) === fieldText(b.fields.repo);
  return Boolean(fieldText(a.fields.worker)) && fieldText(a.fields.worker) === fieldText(b.fields.worker);
}
const leaseWords = (issue) => [fieldText(issue.fields.worker) && `worker ${fieldText(issue.fields.worker)}`, fieldText(issue.fields.branch) && `branch ${fieldText(issue.fields.branch)}`].filter(Boolean).join(', ');

// What the leases of the issues outside `taken` hold: each file key and each resource, with the issue whose lease holds it.
// The first holder of each, in the order of the record, so a refusal names the same issue every time.
function otherLeases(root, profile, taken) {
  const files = new Map();
  const resources = new Map();
  for (const held of loadIssues(root).filter((x) => !taken.has(x.id) && profile.is(x.status, 'holds-claim'))) {
    const i = declaredInCall?.has(held.id) ? { ...held, ...declaredInCall.get(held.id) } : held;
    for (const k of fileKeysOf(root, i)) if (!files.has(k.key)) files.set(k.key, held);
    for (const r of i.resources) if (!resources.has(r.toLowerCase())) resources.set(r.toLowerCase(), held);
  }
  return { files, resources };
}

// The files (as fileKeysOf gives them) and resources of an issue that another lease holds, as { what, by }, leaving out what
// the lease of `branch` and `worker` joins: the holder's own branch, and its worker when both name one.
function heldByOthers(root, others, issue, branch, worker, fileKeys, resourceNames) {
  const joins = (h) => (branch && h.fields.branch ? branch === fieldText(h.fields.branch) && (!worker || !h.fields.worker || worker === fieldText(h.fields.worker)) : !branch && !h.fields.branch && Boolean(worker) && worker === fieldText(h.fields.worker));
  return [
    ...fileKeys.filter((k) => others.files.has(k.key)).map((k) => ({ what: `declares ${k.f}`, by: others.files.get(k.key) })),
    ...resourceNames.filter((r) => others.resources.has(r.toLowerCase())).map((r) => ({ what: `uses the resource ${r}`, by: others.resources.get(r.toLowerCase()) })),
  ].filter((h) => !joins(h.by));
}

// A file or a resource declared on an issue a lease holds is taken into that lease, so it is refused when another lease holds
// it, as a lease taken on it would be: a lease that guards what an issue declares is guarded wherever it is declared. What
// the issue's own lease joins is allowed; an issue no lease holds is checked when it takes one; a loop its composer schedules
// leaves the decision to the composer. `files` and `resources` are what the call adds; `next` is what the issue holds once
// the call is written, which a call over several issues keeps for the issues checked after this one.
export function needFreeOfOtherLeases(root, issue, files, resources, next) {
  const profile = loadProfile(root);
  if (profile.scheduler !== null && profile.scheduler !== undefined) return;
  if (!profile.is(issue.status, 'holds-claim') || !(issue.fields.worker || issue.fields.branch)) return;
  const held = heldByOthers(root, otherLeases(root, profile, new Set([issue.id])), issue, fieldText(issue.fields.branch), fieldText(issue.fields.worker), fileKeysOf(root, { ...issue, files }), resources);
  if (!held.length) {
    declaredInCall?.set(issue.id, { files: next.files ?? issue.files, resources: next.resources ?? issue.resources });
    return;
  }
  const { what, by } = held[0];
  const join = by.fields.branch ? `, or put ${issue.id} in ${by.id}'s lease: ${jarlLine('set', issue.id, issue.status, '<why-the-worker-changed>', '--branch', fieldText(by.fields.branch), ...(by.fields.worker ? ['--worker', fieldText(by.fields.worker)] : []), '--handover')}` : '';
  need(false, `${issue.id} ${what}, which ${by.id} holds in its lease (${holderText(by)}) — two leases on one file or resource collide; leave it out, or wait until ${by.id} leaves its lease${join}`, () => ({ arg: 2, value: resources.length ? '<resource-name>' : '<paths>' }));
}

// Who holds an issue's lease, as the refusals name it: its worker, branch and start, and its slice tag when it has one.
function holderText(issue) {
  const name = sliceOf(issue);
  const slice = name === null ? null : `slice:${name}`;
  return [issue.fields.worker && `worker ${fieldText(issue.fields.worker)}`, issue.fields.branch && `branch ${fieldText(issue.fields.branch)}`, issue.fields.since && `since ${fieldText(issue.fields.since)}`, slice].filter(Boolean).join(', ') || 'no worker or branch named';
}

// The check behind set --worktree: a path that exists is a worktree of one of the repositories the issue names (or the
// loop's own) with `branch` checked out; a path that does not exist is not checked.
export function needWorktreeOfLease(root, issue, branch, path) {
  if (!existsSync(path)) return;
  const repos = issueRepoPaths(root, issue).filter(isGitRepo);
  const listed = repos.flatMap((r) => (worktreesOf(r) || []).filter((w) => sameDir(w.path, path)));
  need(listed.length > 0, `--worktree ${path} is not a worktree of ${repos.length ? repos.map((r) => repoLabel(r)).join(' or ') : 'a repository of ' + issue.id} — a lease is its branch, and the worktree is found through it`, () => ({ flag: '--worktree', value: '<the-worktree-of-the-lease>' }));
  need(!branch || listed.some((w) => w.branch === branch), `--worktree ${path} has ${listed[0].branch ?? 'no branch'} checked out, not ${branch}, the branch of the lease`, () => ({ flag: '--worktree', value: '<the-worktree-of-the-lease>' }));
}

// Why a lease value (--branch, --worker, --model, --worktree) cannot be written, or null when the lease line gives it
// back unchanged: one line in all four; no comma in a worker or a model (a comma marks a sentence, not a name); and a
// branch is a name git accepts, which has no space.
export function leaseValueProblem(flag, raw) {
  const v = fieldText(raw);
  if (/[\r\n]/.test(String(raw).trim())) return 'is on more than one line: the lease line is one line';
  if (flag === 'worker' || flag === 'model') return v.includes(',') ? 'holds a comma: the lease line is read by position and a comma marks a sentence, not a name — use a name without one' : null;
  if (flag === 'branch') return branchNameProblem(v);
  return null;
}

// field <ids> resources "a, b": the exclusive resources an issue holds for the whole life of its lease (a port, a database
// server, the machine's load), loop-wide and not files. Names are single words; an empty value clears the field. Only next
// reads it: check, queue and the file rules do not.
// The names of a Resources value, checked: single words, each kept once whatever its case.
export function resourceNames(value) {
  const names = [];
  for (const n of splitList(fieldText(value))) {
    need(/^[A-Za-z0-9._:/-]+$/.test(n), `resource names are single words of letters, digits and . _ : / - ("${n}" is not), naming the thing`, () => ({ replace: n, value: hole('<resource-name>') }));
    if (!names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
  }
  return names;
}
