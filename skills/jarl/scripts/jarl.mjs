#!/usr/bin/env node
// jarl.mjs — the one tool the jarl skill's state moves through: the command line over record.mjs.
//
// Markdown is the source of truth: the loop's goal, decisions and log, and one
// .jarl/issues/7-slug.md per issue. This script only reads and writes those files, so anything
// it does can be checked by opening them. Zero dependencies, Node 22+.
//
// What is here: the usage text, the flag and argument tables, the parser and dispatch — one command, run and rendered.
// Every operation on the record goes through record.mjs, the stable surface another tool may vendor; the rest of the
// commands (the views over git, import, report and the like) come from jarl-lib.mjs, the implementation behind both.
// This module re-exports jarl-lib.mjs whole, but none of those exports is a contract: only
// record.mjs (RECORD_API) is.

import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from './record.mjs';
import {
  need, refuse, Refusal, isFix, isExternal, isPlaceholder, hole, HOLE, commandOf, printedLine, commandLine, readyText, breaksLine, escapedEchoes, shellWord, shellOf, printable, printCommand, printingFor, jarlLine, rootPrintable, resetCaches, withLock, readText, isEntry, cmdSet, cmdField, setRouteOf, eachIssue, cmdRound,
  cmdProfile, cmdArchive, cmdList, cmdNext, renderNext, cmdMode, cmdClose, cmdCheck, cmdBranches,
  cmdChangelog, cmdHandoffRead, cmdHandoffWrite, cmdReport, cmdImport, cmdSources, cmdAnswerMany, cmdModels, renderModels,
  issuesNaming, questionFor, cmdGoal, cmdGoalSet, cmdRepoBase, whereOf, cmdVerify, renderVerify, renderCheckNotes,
  renderProfile, renderResume, renderStatus, renderImport, renderSources, renderList, recordTypeLog, recordRuleLog,
  runDecisionsDriver, mergeFlags, describeNew, renderNewReply, issueView, attachmentStates, evidenceTable, renderBranches, renderDecide, renderDecisions,
  needLoop, cmdNextAs, renderNextAs, askerSection, renderBrief, cmdTick, withWriter, editorOf, needFormat, formatState, readProfileFile, FORMAT_LINES, cmdRenumber, cmdSplit,
} from './jarl-lib.mjs';
import { writeAreaDecision, writeRuleRatification } from './yg-edge.mjs';

export * from './jarl-lib.mjs';

export const USAGE = `usage: jarl.mjs "<a-jarl-command>" [options]
       jarl.mjs --version                        the version of this install, the one the MCP server reports

commands:
  init "<goal>" [--committed] [--permanent] [--profile <profile.json>] [--by who]
                                                 create .jarl/ with the goal; by default it also writes .jarl/.gitignore
                                                 (* and **/*) so git never sees the loop, and every role working
                                                 outside the loop root passes --root <loop-root>;
                                                 --committed ignores only the write lock and temporary files: the loop
                                                 is committed with the work; --permanent is committed too, marks it with
                                                 .jarl/.permanent, and is not tied to a feature branch: close (below)
                                                 keeps the directory instead of removing it; --profile checks the
                                                 profile file (see profile below) and stores it as .jarl/profile.json
  new "<title>" [--kind k] [--prio 1|2|3] [--tier light|standard|strong] [--tags a,b] [--files p,q] [--repo <name-or-path>] [--found-by who]
      [--where "<text>"] [--what "<text>"] [--why "<text>"] [--acceptance "<line>"]... [--changelog "<changelog-entry>"]...
      [--source <report-dir#finding-id>,...] [--after <ids>] [--template <name>] [--field "<name=value>"]... [--section "<name=value>"]...
      [--person "<name>" --check-when "<date-or-event>"] [--by who]
                                                 file an issue under the next free number; without --tier it records
                                                 standard and says so on stderr, with what each tier is for (light: a check
                                                 or test decides; strong: unknown cause, design, record format, security);
                                                 --repo names the repository
                                                 its code lives in when that is not the loop's own, several as one comma
                                                 list (see --repo below); --tags, --files, --source, --after and --repo
                                                 repeat, or take a comma list (see Lists below);
                                                 --what, --why and --acceptance (one per line, repeatable) write the body,
                                                 --source names the finding(s) it comes from, --after the issues it waits on;
                                                 --changelog (repeatable) is the issue's changelog entry, "Added: …" etc.;
                                                 --template reads .jarl/templates/<name>.md: its Kind, Priority, Tier, Tags
                                                 and Files are defaults and its What, Why, Acceptance and Changelog the body,
                                                 each replaced by the flag when given; --field and --section
                                                 (repeatable) write the fields and sections the loop's profile declares
                                                 (a field's default when not given; a required one must be given);
                                                 two kinds are kept, never worked by a worker, and next never offers them:
                                                 --kind promise is a promise, kept by whoever its --found-by names (the
                                                 jarl when none), and --kind wait a wait on an outside person, which needs
                                                 --person (who it is held by, the name next --as answers to) and
                                                 --check-when (a date, or the event to check after); either ends when its
                                                 issue closes
  renumber <id> --key <key> [--by who]
                                                 of the issue files that carry one number after a merge of two copies
                                                 of the loop, give the one whose header carries --key the next free
                                                 number: its file is renamed and its first line rewritten; every log
                                                 line about it names its key, so it keeps them, and no line is
                                                 rewritten (verify names the files and their keys)
  field <ids> <name> ["<value>"] [--add | --remove | --clear] [--by who]
                                                 change one part of the description of every id, the one command for
                                                 it: the header fields Title (the file keeps its name), Priority (1|2|3),
                                                 Tier, Kind, Found by, Tags, Files, Repo (as --repo below), After (the
                                                 issues it waits on: next does not offer it until each is done or
                                                 dropped), Parent (the one issue it is a sub-issue of: a parent waits on
                                                 its sub-issues, a sub-issue on its parent's After, and a sub-issue with no
                                                 slice tag is in its parent's slice; a parent that would sit under its own
                                                 sub-issue, a wait in a circle and a finished parent are refused, and the
                                                 first Parent raises the record format to 3), Source (<report-dir#finding-id>), Where, Resources (the exclusive resources
                                                 the issue holds while its lease lasts, loop-wide names; next never
                                                 offers two issues holding one), Person and Check when (whom a wait is
                                                 held by and when to check it: Kind becomes wait only once both are
                                                 written, and neither is emptied on a wait), a field the loop's profile
                                                 declares, and the sections What, Why, Acceptance, Changelog and the ones
                                                 the profile declares; a name is matched in any case, and one with a
                                                 space is quoted ("Found by"). A value alone replaces what the part
                                                 holds; --add adds the items of a list field (Tags, Files, Repo, After,
                                                 Source, Resources) or the value after what a section holds (Acceptance
                                                 and Changelog gain lines, the others a paragraph); --remove takes items
                                                 off a list field; --clear empties an optional part (Title, Priority,
                                                 Tier, Kind, Found by and a required field are never empty). A list
                                                 field takes a comma list, and Acceptance and Changelog one item per
                                                 line. Each value is checked as at filing (Tier and Kind against the
                                                 profile; one slice:<coordinator> tag per issue, which puts it in that
                                                 coordinator's slice), and each change writes one log line per issue
                                                 and part with what the part held before and, when --by names one, who
                                                 changed it (a value it already holds writes none); the history
                                                 (evidence, verdicts, merges, rulings, answers) has no edit, only
                                                 retract and decide --supersedes, and the status moves only with set;
                                                 any other name is refused with the names field writes and the command
                                                 that writes it instead
  split <id> --line "<line=id>"... [--by who]
                                                 share out the acceptance of a parent among its sub-issues in one
                                                 write: each --line <n>=<id> moves acceptance line n to issue <id>, or
                                                 keeps it on the parent when <id> is the parent's own; every line is
                                                 named once, and a line named nowhere is refused, so none is lost; each
                                                 issue a line moves to becomes a sub-issue of the parent, as field Parent
                                                 makes one, and gains the line after the ones it holds
  base <name> <branch> [--by who]                the base branch a declared repository is held against, changed
                                                 with a log line that says what it was (a repository is declared
                                                 when an issue first names it; see --repo below)
  import <findings.json> [--source <report-dir>] [--kind k] [--prio 1|2|3] [--tier t] [--tags a,b] [--repo <name-or-path>]
      [--found-by who] [--only <finding-ids>] [--adopt] [--dry-run] [--field "<name=value>"]... [--parent <id>] [--by who]
                                                 one issue per finding, with Source: <report-dir#finding-id>; a finding
                                                 whose Source is already on an issue is skipped, so a re-run files
                                                 nothing twice, and one whose text differs from the What or Why of
                                                 the issue import filed for it is reported with both texts (the
                                                 issue is never rewritten); a finding with neither a claim nor a
                                                 truth is not compared;
                                                 --dry-run prints what it would file; --adopt writes
                                                 Source onto an existing issue that names the finding id but has none;
                                                 every finding is checked before the first write, so a refused import
                                                 writes nothing; --parent files each issue it files under that parent;
                                                 --tags, --repo and --only repeat, or take a comma list
  sources [<findings.json>...] [--source <report-dir>] per report: its findings, the issues filed from them and their
                                                 status; with a findings file, the findings nobody filed too
  evidence <ids> "<text>" | --ran "<command>" --saw "<what-it-printed>" | <id> --file <path> --slot <name> [--by who]
                                                 append a free-text note (under ### Notes), or one checkable row per --ran/--saw
                                                 pair (repeatable; under ### Proof, after the last row);
                                                 --file --slot records one attachment as a Proof row: the slot, the path
                                                 under the loop root (relative, no .., no symlink), the file's sha256 and its
                                                 size; nothing is copied. The slot is one the profile's done gate requires of
                                                 the issue's kind, and the file lies at the slot's place, has an allowed
                                                 extension and at least the minimum size (at most 64 MiB); done checks every
                                                 required slot again on the disk
  retract <id> review|<n>|note-<n> --by <who> "<text>"  take a record back by an appended entry that says who and why; review retracts
                                                 the newest approve not yet retracted (never a "changes" verdict), and the
                                                 approve stays, struck through; <n> retracts the n-th evidence row (the
                                                 number show prints before each row, counted over the whole Evidence
                                                 section) and note-<n> the n-th free-text note (show prints note-<n> before it): the row or note stays, struck
                                                 through, and show leaves a retracted note and its reason out unless --full; the done gate and the metrics
                                                 do not count what is retracted; the first retraction of a loop raises its record format to
                                                 2, so a reader that knows only format 1 refuses the loop instead of
                                                 counting what was taken back
  list [--status s] [--kind k] [--tag t] [--prio p] [--grep re] [--match "<field=value>"]... [--all]
                                                 the issues not finished (open and in-progress) by default; --all for
                                                 every status; --match keeps those whose header field holds the value;
                                                 each sub-issue stands indented under its parent
  show <id> [--full]                             print one issue as the done gate sees it: the header, What, Why,
                                                 Acceptance and Changelog, every Proof row (numbered [n]) and every
                                                 verdict in the done gate's window, Notes whole, every "changes" finding no later
                                                 approve answered, one line per round that came before; --full prints the whole
                                                 file; --json is complete; under the header, one line for each header
                                                 field that disagrees with the log (see status), where each repository
                                                 written as a name is on this machine and the worktree git has on the
                                                 lease's branch (--json carries them as where)
  brief <id> [--role worker|reviewer] | brief --slice <coordinator>
                                                 read-only: the brief a role is raised with, assembled from the record:
                                                 for an issue's worker (the default) or reviewer, the issue as show
                                                 prints it (without the lines that name where a repository or a
                                                 worktree is on this machine, a Worktree field of the header among
                                                 them), the rules with a scope that reach that reader (the role, its
                                                 moment, the issue) and Jarl's own, the rounds so far, the findings of
                                                 the reviews that sent it back, the proof rows, the role's reference and
                                                 the commands that record the result; with --slice, for that slice's
                                                 coordinator: its issues in play, its rules, its reference and its
                                                 commands; every part whole. A merger's brief is one for the whole loop
                                                 (references/merger.md), and a worker after a takeover is given the
                                                 rules of the takeover too
  set <ids> <status> "<text>" [--branch <worker-branch>] [--worker <name>] [--model <model-id>] [--worktree <path>] [--handover] [--header] [--by who]
                                                 (<ids> <status-in-the-log> --header rewrites the header fields the log
                                                 renders from the log, writes no log line and is never a move)
                                                 change status; writes the log line in the same move; in-progress
                                                 writes Since (and Branch, Worker, Model when given) — one lease
                                                 for every id, so a package shares it; a lease holds: under the lock
                                                 it refuses an issue another worker or branch holds and a file or
                                                 resource another lease holds (naming the holder and its slice: tag),
                                                 and, while more than one slice has an issue in play, a lease on an
                                                 issue that declares no Files or Resources, naming the call that
                                                 declares them,
                                                 and --handover hands a leased issue to a new worker or branch, with
                                                 "<text>" as the reason the worker changed, logged with the move and
                                                 ending the old lease (its Worktree field goes); --model is the model the worker
                                                 was raised on, as the platform names it (with @effort where it has that
                                                 lever), stored as given; --worktree is a check and records nothing: a path
                                                 that exists must be a worktree of a repository of the issue with the
                                                 lease's branch checked out, and the worktree of a lease is found through
                                                 its branch; leaving in-progress removes Worker, Model, Since (and a
                                                 Worktree field a lease holds) and keeps Branch; done notes a merge
                                                 whose CI is not green yet; done needs, inside one window (rows after
                                                 the last start, reopen or filing; approves after those or a red
                                                 round), a --ran/--saw row — a free-text note never counts alone —
                                                 and a live approve, on an issue whose lease records a Branch a merge
                                                 recorded (merged), and the owner's tick of every acceptance line only he
                                                 ticks (see tick)
  merged <ids> --sha <sha> [--ran "<command>" --saw "<what-it-printed>" | --red <id>] [--ci pending|green|red|none] [--repo <name-or-path>] [--keep] [--by who] | <ids> --ci <ci-state>
                                                 the merge as fields: Merged (sha, and where with --repo) and CI
                                                 (only when given; pending: a pushed commit whose CI will report;
                                                 none: no CI to wait for), and a log line. --ran/--saw record the
                                                 check that decided the merge and what it printed, in the merge
                                                 record (the Merge check field and the merge line): never as a Proof
                                                 row, because the merger's check is not the worker's proof (done
                                                 asks the worker for the row; the reply says when none is there).
                                                 --red <id> records a merge that
                                                 landed while its check was red for a cause outside the branch, which
                                                 issue <id> tracks; it is never counted as a passing check, and the
                                                 jarl rules on it first. --ci alone moves the CI of issues already
                                                 merged. After it records a sha it removes the issue's worktree and
                                                 local branch (git worktree remove, git branch -d, never a force)
                                                 when that is safe, and names why it kept them when it is not;
                                                 --keep skips it. It notes, and never refuses, a commit that lacks the
                                                 branch tip or the base (the repository's declared base, else the branch
                                                 its main checkout has open), a squash or rebase merge, and what the commit
                                                 brings into its first parent that starts a conflict marker or is an
                                                 added file over 64 MiB
  next [--limit n] [--all] [--as <who>] [--slice <coordinator>]
                                                 the open issues ready to start: no file shared with an in-progress one, every
                                                 After issue done or dropped (its parent's too), every sub-issue done or
                                                 dropped, no open stuck or stop question on it; a file is
                                                 its repository and its path (see --repo below); one with no acceptance line
                                                 or no declared files is marked; --all adds the others in groups (held by a
                                                 file and by whom, waiting on After, held by a question, the promises and
                                                 the waits, which it never offers), --json rows carry a group;
                                                 --as <who> lists instead what is on the owner, the jarl, a coordinator or
                                                 a person by name now, each line with the command that moves it (it takes
                                                 no --limit): the owner holds the questions and the items to ratify; the
                                                 coordinator of an issue's slice (the jarl, for an issue in no slice) its
                                                 ready issue, its lease, a proof with no verdict and changes asked; the
                                                 holder the goal's Merger line names (else the jarl) an approve not
                                                 merged; a parent whose sub-issues are all done or dropped is its
                                                 coordinator's to check its own acceptance against the whole, a proof
                                                 row done waits for; the jarl the close, and a ruling that
                                                 settles issues none of which is live; an acceptance line only the owner
                                                 ticks is the jarl's (its worker producing it) until its material is
                                                 there, then the owner's, with the material and what to check (with no slice in the loop, a
                                                 coordinator's lines are the jarl's); a promise is on whoever its Found by
                                                 names, and a wait on its Person, with when to check, until what was
                                                 waited for is recorded, then on the jarl; derived from the profile's status
                                                 flags, the verdicts, the questions and the rulings; at most seven lines,
                                                 the owner's first, then by how many issues each holds up, then how many
                                                 more; --all every line and the issues waiting on that one, "waits on X
                                                 via N"; under an external scheduler the issues in play are left out and
                                                 the composer's command named; --slice <coordinator> offers only the
                                                 issues of that coordinator's slice: across slices only leases hold, and
                                                 an open issue reserves its files against the issues of its own slice
  review <ids> <verdict> --by <reviewer> [--model <model-id>] [--relayed] [--outside "<finding-outside-the-issue>"]... [--field "<name=value>"]... "<text>"
                                                 the reviewer's verdict; --model is the model the reviewer was raised on
                                                 (stored as given); --relayed marks a verdict recorded by someone else in
                                                 the reviewer's name, for a reviewer that cannot be resumed to record its
                                                 own; --outside (repeatable) is a finding outside the issue: each is
                                                 filed as a new issue, Found by the reviewer and Where the review, and
                                                 never turns the verdict to changes, so changes whose only Critical or
                                                 Important findings are outside is refused; --field (repeatable) is a
                                                 field the profile declares, on each issue --outside files; every finding
                                                 passes the filing's checks before anything is written; --by is required, recorded with its kind
                                                 (self for "self" or anyone who has held the issue's lease, across
                                                 takeovers, or the lease of another issue on its Branch — refused on an approve;
                                                 coordinator for coordinator, jarl, reeve, the loop's own name and
                                                 names on a "Coordinators:" line in goal.md; fresh for anyone else);
                                                 "done" needs an approve inside the gate's window, and a
                                                 fresh one when the issue carries code (a Branch or Merged field), and
                                                 the worker's Proof row; an approve on an issue with no Proof row says so;
                                                 findings need at least three words; a verdict is taken back with retract
  round <ids> "<text>" [--findings <n>] [--by who]
                                                 one red round on each, with the count of findings it left if given; every third round,
                                                 or every n-th where the goal's "Takeover (<kind>): <n>" line for the issue's kind
                                                 or its bare "Takeover: <n>" line says so, prints the takeover block for a fresh
                                                 worker: a tier up, another model or a changed approach. The limit is read from the
                                                 goal at each round and the rounds are counted from the last takeover, so a changed
                                                 limit takes effect at the next round
  tick <id> <line> --by owner                    the owner's tick of an acceptance line only he ticks, by its number among
                                                 the issue's acceptance lines: a line written "[owner] <line> · material:
                                                 <material> · check: <what-to-check>" (new and field refuse a
                                                 line so marked that names no material or nothing to check, and its first
                                                 write raises the record format to 3); done refuses while such a line is
                                                 not ticked; tick refuses a name other than the owner's, and a line whose
                                                 material is not there yet: no --ran/--saw row after the work was started or
                                                 sent back, or, for a path, no file under the loop's root, the issue's
                                                 repositories or its worktree; it writes one log line that holds the line
                                                 as written, so a line rewritten after it waits for a new tick, and a red
                                                 round, a start or a reopen spends it as it spends an approve
  models [--group repo|tag] [--with <loop-root>]... [--archives]
                                                 read-only: per model as worker and as reviewer, per Kind · Tier, what the
                                                 record holds (units, clean first passes, changes, rounds, verdicts, checked
                                                 approves), every count with its n and a share only from n >= 5, with the
                                                 words fits, below, new and may clear; work with no recorded model
                                                 is grouped by tier; --group slices by repository or tag; --with reads another
                                                 loop (its root, or an archive directory) and --archives this loop's own
                                                 archives, merged into one table that names the loops it read; a path that
                                                 is not a loop is refused; suggestions only, no lock, nothing written
  scope [<id>] --branch <worker-branch> [--base <base-branch>] [--repo <name-or-path>]
                                                 commits beyond the base, diff inside the declared files, and the
                                                 change in test files and assertions — numbers, never a verdict;
                                                 notes for the added lines that name a loop issue by its number after
                                                 the word issue or with a hash sign, the added lines that start a
                                                 conflict marker, and the added files over 64 MiB, the largest file
                                                 Jarl accepts as an attachment (at most 20 printed, the rest
                                                 counted), which never change ok; a branch no issue records is refused
                                                 with its commit count;
                                                 read in --repo, else the issue's Repo, else the loop's own repository;
                                                 with no id, the diff is bounded by the union of Files of every issue
                                                 that records that branch (a package on one branch, one call)
  branches [--base <base-branch>] [--repo <name-or-path>] [--stale-hours n]
                                                 every jarl/7-* branch and every branch an issue records: the
                                                 issues on it, commits beyond the base, worktree state, STALE leases
                                                 (worktree gone, branch gone, idle: no commit, row or log line for the
                                                 goal's "Liveness: <minutes>", default 30, or n hours) and
                                                 DONE → delete, NO ISSUE for commits no issue holds; shown only, never
                                                 acted on; read in --repo alone, else in the loop's own
                                                 repository, every repository an open or in-progress issue
                                                 names and every one where an issue not dropped records a Branch
  ask "<text>" [--kind stop|stuck|lower|charter|ratify|escalation|rule] [--target x] [--issue 7] [--slice <coordinator>] [--option "<label:effect>"]... [--applies-to "<selectors>" [--until <date-or-id>] [--to owner]] [--by who]
                                                 a question the owner has to answer; lower needs --target;
                                                 escalation is a coordinator's question to the jarl, who holds it:
                                                 it names its --slice or its --issue (or both), shows on next --as
                                                 jarl and in that slice's views, holds its issue back as stuck does,
                                                 and is answered by the jarl (answer a-<n> "<text>" --by jarl);
                                                 listed at boot until answered; ratify is a choice already made
                                                 under a mandate, awaiting the owner's word, and blocks nothing:
                                                 its answer starts with yes or reject (ok, tak, nie, … as the
                                                 refusal lists them), and any other is refused;
                                                 rule proposes the question's text as a rule with the scope of
                                                 --applies-to (as decide takes it), held by the jarl, or by the owner
                                                 with --to owner, and answered yes, which makes it a rule in force, or reject;
                                                 --option gives the choices, at least two, repeated for each one:
                                                 the question prints with its options for the choice window
  answer <ids> "<text>" --by <who> | <ids> --option <option> --by <who>
                                                 records the answer as a ruling and closes the question: the option
                                                 chosen, marked in the ruling's list of options, or the answer in the
                                                 person's own words; --by, which every answer takes, records who answered (owner
                                                 for the owner, jarl on an escalation), and on a ratify item is owner,
                                                 whose item it is;
                                                 several ratify items as a comma list take one answer, one ruling each,
                                                 each naming the batch it was answered in; on a ratify item whose
                                                 ruling names a rule, the rule's ratification names the owner
  resume [--log n] [--ready n] [--gh] [--repo <name-or-path>] [--base <base-branch>] [--as <who>] [--slice <coordinator>]
                                                 read-only, the boot: everything a session picks the loop up from,
                                                 assembled live — goal and counts, rulings in force, in flight with
                                                 leases (and stale ones), waiting on After, questions, ratify items,
                                                 the next ready issues (n, default 10), the merge queue (the branches
                                                 waiting for the merger — an open or in-progress issue on it holds a
                                                 live approve and the branch is ahead of its base — in the order they
                                                 were approved, per repository, cut into batches whose declared files
                                                 do not overlap; it runs no check and refuses nothing), merges with
                                                 CI pending or red, the tips (per repository the issues name, open, in
                                                 progress or recently merged: each worker branch in flight, the
                                                 feature branch the checkout is on and main, ahead/behind their
                                                 upstream as last fetched, and the recent merges with their CI), loop
                                                 files not committed, and the last log lines (n, default 15); nothing
                                                 is fetched, and no network unless --gh asks gh for the CI of each
                                                 tip its upstream holds (else "not pushed"); --repo narrows the merge
                                                 queue and the tips to one repository, and --base replaces the
                                                 checkout's current branch as the merge queue's base;
                                                 --as <who> ends it with what next --as <who> prints; --slice
                                                 <coordinator> keeps in flight, waiting, the questions, held and next
                                                 ready to that coordinator's slice, and the rulings, the merge queue,
                                                 the tips and the log whole
  log "<text>" [--by who]                       append one dated note to the journal; a line that reads as a filing, a move,
                                                 a round, a verdict, a retraction, an evidence row, a merge, a CI state or
                                                 a body change is refused, and the refusal names the command that writes it
  decide <slug> "<text>" --by <who> [--quote "<his-own-words>"] [--under <slug>] [--supersedes <slug>] [--settles <ids>] [--waives-review <ids>] [--applies-to "<selectors>" [--until <date-or-id>]] [--area <type> [--reach n] [--rule <id>]]
                                                 append a ruling (slug: letters, digits, . _ -); refuses a duplicate slug;
                                                 --by, which every ruling takes, records who ruled (jarl for a choice
                                                 made under a mandate; a name that reads as owner is owner); --by owner needs --quote, his own words, kept as
                                                 the ruling's last line, and no other text of the record may hold
                                                 "The owner's words:" in any spelling; --under names the ruling in force a ruling
                                                 by the jarl or a coordinator rests on, kept as the text's last paragraph
                                                 "Made under: <slug>", shown with the ruling by decisions and with a rule by the views; --supersedes marks
                                                 the ruling it replaces "Superseded by" in place; --settles writes the ruling,
                                                 with who ruled, into each named issue's evidence (its status is unchanged);
                                                 --waives-review, on a ruling by the owner alone, closes the named
                                                 issues without a review: done and the merge queue take it for the
                                                 approve until a round, a reopen or a new commit spends it; --applies-to makes it
                                                 a rule with a scope, printed whole to every reader it matches: loop, or
                                                 selectors joined by "and" (role, slice, moment, issue, tag, kind, tier,
                                                 files, repo, each with one value); --until ends it after a date or when
                                                 an issue closes, and a ruling that supersedes it revokes it; --area marks a ruling
                                                 about a whole type of code, --reach how many files that type holds,
                                                 --rule the graph's rule it admits on that type (its id):
                                                 close puts it to the owner for ratification
  decisions [--live]                             the rulings with who ruled and what superseded them; --live only
                                                 those still in force
  goal                                           the goal as goal.md holds it
  goal --set "<machine-line>" [--by who]         one machine line of the goal set, with a log line that says what it
                                                 was and what it is: "Check (<name>): <command>" or a bare
                                                 "Check: <command>", "Model (<tier>): <model-id>" (a tier the profile
                                                 declares), "Coordinators: <names>" (each name a coordinator, which runs the slice of
                                                 the issues tagged slice:<name>), "Merger: <name>" (the jarl or one
                                                 coordinator: the one holder that raises the merger, one merge at a time
                                                 for every slice), "Takeover (<kind>): <rounds>" or a bare "Takeover: <rounds>",
                                                 "Liveness: <minutes>" (a lease or a proof with no commit, row or log line
                                                 for longer is idle, on its coordinator's list; default 30, and
                                                 --stale-hours overrides it for one call); the rest of goal.md stays as written
  status [--stale-hours n] [--group repo|tag|kind|prio|<name>] [--tag <tag>] [--as <who>] [--slice <coordinator>]
                                                 --tag computes every part of status over the issues carrying that tag only;
                                                 --slice the same over one coordinator's slice (the issues tagged
                                                 slice:<coordinator>), with the questions on them and the escalations
                                                 that name the slice;
                                                 --as <who> ends it with what next --as <who> prints;
                                                 once an issue carries a slice: tag, one line names each coordinator
                                                 with its slice and how many of its issues are in play, and a slice
                                                 whose coordinator the Coordinators line does not name;
                                                 the log is the record of an issue's status, lease, merge and CI; a header
                                                 that disagrees is never believed, and status prints one "record:" line
                                                 for it, with how to write the header back or make it the record (resume
                                                 and show print it too; --json carries disagreements when there are any)
                                                 the goal, when the loop opened and last moved, its record format (and,
                                                 where a composer runs the loop, what is off there),
                                                 then one line: open, in flight, waiting, done, dropped, deferred,
                                                 open questions, to ratify, merged with CI pending or red; then who
                                                 reviewed the done work (fresh, coordinator, self, unrecorded); then,
                                                 per repository, "k of n merges carry the declared check" (a merge
                                                 carries it when its --ran text equals a command a Check line of
                                                 goal.md declares), the testimony mark for a repository that declares
                                                 none and while no merge carries the declared check; then the choices awaiting ratification, stale
                                                 leases, the issues in flight with no acceptance line, and —
                                                 committed loops — the loop files
                                                 git has not committed; --group adds the status counts per
                                                 repository, tag, kind, priority or a field the profile declares; --group repo
                                                 also prints where each repository is on this machine, its base and
                                                 whether its checkout is on it
  archive "<slug>" [--by who]                    put the current loop away under .jarl/archive/yyyy.mm.dd-<slug>/,
                                                 keeping the archive, the mode markers and .jarl/templates/, so init
                                                 can open a new loop here in the same mode; refused under a profile
                                                 whose "lifecycle" keeps archive to the record (it names the command)
  report [--found] [--metrics]                   the loop metrics first (cycle time, rounds, reopenings, the share of fresh
                                                 reviews, red CI after merge, follow-ups within 7 days — "no data" where the
                                                 record holds none) and the landing banner, per repository "k of n merges carry
                                                 the declared check", with the testimony mark as status shows it; then what was
                                                 done (per repository when it spans several), who reviewed it, dropped, deferred
                                                 and still open — ready for the changelog; --found adds the issues found by
                                                 someone other than the jarl; --metrics prints the heading, the goal and the
                                                 metrics alone; --json also carries one row per issue and the metrics (see
                                                 references/commands.md, "Loop metrics")
  changelog <ids> [--repo <name-or-path>]           print the issues' ## Changelog entries grouped by section (Added,
                                                 Changed, Deprecated, Removed, Fixed, Security), ready to paste under
                                                 [Unreleased]; per repository when they span several; reads only
  mode permanent [--by who]                      switch an existing committed loop to the permanent mode, with a
                                                 log line; refuses a default-mode loop (out of git — a permanent
                                                 record must be committed) and an already-permanent one
  profile [<profile.json>]                       read-only: the loop's profile — its statuses and what each one means
                                                 (dispatchable, lease, settles-dependents, terminal, closes-record,
                                                 needs-reason), the status a new issue starts in, the values of Kind and
                                                 Tier, the fields and sections its issues carry and the heading of their
                                                 acceptance, the record format beside the formats this Jarl reads; the
                                                 built-in one when the loop has none; with a file, that file checked
                                                 against the profile schema instead
  verify                                         read-only, with no lock and no network: the record read strictly. Each
                                                 reader lists the lines it does not place (the log, the goal, the issue
                                                 headers, the questions and the rulings), the profile is checked, a
                                                 retraction must point at an entry the log holds, a line that needs the
                                                 raised record format is found in a loop that is not in it (the check
                                                 names the loop's format), a header
                                                 that disagrees with the log is listed, each declared repository is
                                                 checked by name and root commits, each worktree a lease holds belongs
                                                 to a repository its issue names, and an open issue that cites a
                                                 superseded ruling is listed; prints each check with its first findings,
                                                 and exits 2 when it finds something
  close [--force] [--batch] [--by who]           refuse while anything is open or in progress, and, where it removes .jarl/,
                                                 while anything is deferred (the refusal names archive "<slug>", which
                                                 keeps the loop under .jarl/archive/, and --force, which removes the
                                                 loop with its open and deferred issues, keeping no copy); else remove the live
                                                 loop (in the default mode close and init leave .jarl/archive/ in place;
                                                 in the committed mode close refuses while it holds anything, naming it —
                                                 move it out of the tree, or --force removes it with the loop)
                                                 — a permanent loop (see init --permanent, or mode permanent) is
                                                 kept instead: it logs the close and the directory stays as the record;
                                                 first it files the ratification batch — at most 10 area rulings, widest
                                                 reach first, each a ratify item answered yes or reject — and never waits
                                                 for it, and offers each rule of the loop with a scope for promotion,
                                                 a question on the owner answered --option carry, instructions, law or
                                                 drop; --batch files the batch only and closes nothing; a ratified
                                                 area ruling is written into the type's decision log (yg log add
                                                 --type) when the repository has a graph and a working yg, and one
                                                 naming a rule also ratifies it (yg log add --aspect --ratify);
                                                 refused under a profile whose "lifecycle" keeps close to the record

options: --json  --help  --root <loop-root>   (the directory holding .jarl/; without it the loop at the root of the
         current checkout, or of its main checkout from a worktree: never one in a subdirectory)

The list of what only the command line does, next to the record library, is in the skill: references/composers.md, section "What only the command line does".

git merges (not loop commands: no --root, no lock, no tool of the MCP server):
  merge-driver decisions %O %A %B                the driver git runs for .jarl/decisions.md (%O %A %B): the rulings of
                                                 both sides block by block, written over ours (%A), exit 0; conflict
                                                 markers and exit 1 for a ruling both sides superseded, a slug both
                                                 sides added, a ruling both sides rewrote; .jarl/log.md merges by union
  merge-driver flags [--yg "<command>"]          the -c settings a merger puts between git and merge on every merge,
                                                 so the drivers run whatever the clone holds: the decisions driver, and
                                                 with --yg Yggdrasil's log and lock drivers too

<ids> (field, round, evidence, review, set, merged, changelog): one id, or several as one comma list with ranges — 12,13,14 or
203-206,209. Every id and every precondition is checked before anything is written, so the call lands on
all of them or on none, with one log line per issue.

An issue number is a plain number: 7, 195, 1000. A number written with leading zeros (007) or with a # (#7) is the
same issue as 7. Questions are numbered the same way (a-7, a-1000). Numbers are compared as numbers, so 999 comes
before 1000. Jarl never raises the record format of a loop whose profile names an external scheduler: a new number
is written there with three digits (007), which every record format reads, and a write that needs a raised format (a
retraction, a repository given by its name alone, a number of 1000 or more) is refused, naming what it would have
written; a repository given by its path keeps its path there.

Flags: a flag the command does not take is an error. A value flag takes the next argument whatever it
starts with (--ran "--help" records a row), or inline as --flag=value. A bare -- ends the flags: put a
note or a title that starts with -- after it, and every flag (--root too) before it. Words beyond what a
command reads are an error.

Refusals: a refused call writes nothing. It says what is wrong, naming the word of the call that is, and its last
line is the form of the command that does what was meant, a placeholder in angle brackets for each value only the
caller knows: fill the values and run it, never paste it as printed (pasted as printed, it is refused for its
placeholder). A step to take first is a command on its own line. The form keeps the call's --root and --json as
given, wherever the call wrote them, and holds every flag the command needs; every other command Jarl prints, in a
reason, a note or a view, carries the call's --root. The commands Jarl prints are written for a POSIX shell (sh, bash,
zsh) on macOS and Linux, and on Windows for PowerShell and cmd, whose double quotes Git Bash reads alike but for a
path that starts with two backslashes, which it reads with one; each word is quoted for that shell and each
placeholder is in double quotes; a word that shell cannot carry as it is stands as its placeholder, and the reason
says why; replace every "<placeholder>" before running one. A value that is one of Jarl's placeholders is refused
wherever a value is taken, so it is never recorded; any other text in angle brackets is a value.

Lists (the <ids> above; new's --tags, --files, --repo, --source, --after; import's --tags, --repo, --only;
decide's --settles and --waives-review; the value field gives Tags, Files, Repo, After and Source): one item, or several as one
comma list (a,b); a list flag also repeats; a tool takes the same text or a list of strings, one item each.
An item that starts with - is refused (it is a flag in the wrong place). A list written as text is refused:
an item that begins or ends with a quote mark, a name (an id, a tag, a reference, a finding id) that holds
a bracket or a quote, and a path whose brackets do not pair up ([a, b]) or that is a quoted or empty list
in brackets (["a"], []). A path whose brackets pair up is a name: [1], src/[id]/page.tsx, [...slug].

--by who, on every command that writes and on no other, is the author of that one call. On field and split it is who
changed the description, on review the reviewer, on answer, decide, retract and tick who answered, ruled, retracted or
ticked; on the rest (init, new, import, evidence, set, merged, round, ask, log, goal, base, archive, mode, close,
renumber) it is the writer, written into every log line the call writes, right after the stamp ("- yyyy-mm-dd hh:mm by <who>
· ..."); the first such line raises the loop's record format to 3, and where a composer keeps the format the call is
refused with nothing written. Nothing names an author for a call that names none: no server, variable or other call
does, and an unnamed lease shows as "(unnamed)" in a loop whose goal names coordinators. Grouping is --group (status,
models), and --kind is the kind of what a command files or filters.

Writes: every command that writes holds .jarl/.lock while it runs (the holder's pid, host and time are
inside), so parallel calls from workers, reviewers and the merger queue instead of losing each other's
writes; a lock whose holder is gone is taken over, a live one that does not let go within 20 s fails the
call with nothing written. Files are replaced whole, never half-written.

--repo <name-or-path>: another repository, for a loop that keeps its issues in one repository while its
workers change another: its name (the directory git clone gives it), its checkout, a worktree of it or a
file inside it, always reduced to its main checkout. Branches, the base (that checkout's current
branch), diffs and assertions are then read there. A name resolves to the sibling of the loop's main
checkout (beside it, under its name); on a machine laid out differently, a symlink beside the loop's checkout
puts it there. The Repo field stores the name where the checkout sits at that place, and the path
otherwise (a note on stderr says why); a path is read from the loop's root, so it means the same from
any worktree. A name needs no path in the record: Jarl declares it once in .jarl/repos.md, with the
repository's root commits, its origin as found and its base branch, and the loop's record format
rises with the first name (a record carries its format, and Jarl refuses a format it does not read). In a loop of the
raised format a Repo value that starts with . or / (or a drive letter) is a path and anything else
a name. An issue that names a repository writes each of its files with that repository's directory
name first (tool/src/a.mjs for Repo tool): next then keeps the same path in two repositories apart,
and scope matches the path after the name. An issue may name several repositories (Repo: tool, lib):
each file then starts with the name of the one it is in (one with no such name is in the first), and
scope on it takes --repo to say which one to read. show and status --group repo print where each
repository, and the worktree of a lease, is on this machine; nothing resolved is written.

views, one purpose each (read-only; resume, the boot, prints the parts of several of them):
  resume      everything a session picks the loop up from, read live, the merge queue and the tips included
  status      where the loop stands, in counts
  next        what can start now; with --as, what is on one holder and the command that moves it
  list        the issues, filtered
  show        one issue as the done gate sees it
  brief       what a worker, a reviewer or a coordinator is raised with
  decisions   the rulings and what superseded them
  report      what was done, with the loop metrics
  changelog   the changelog entries of issues
  sources     a research report's findings against the issues filed from them
  branches    every worker branch with its issues and its state
  scope       one worker branch measured against its issues' files
  models      what the record says of each model as worker and reviewer
  profile     the loop's profile, or a profile file checked
  verify      the record read strictly, for what its readers do not place

Parallel workers in worktrees:
  - Default mode: the loop is out of git and lives in the loop root (the directory that holds .jarl/), so every call, a worker's and the coordinator's, passes --root <loop-root>.
  - Committed mode: the merger alone commits .jarl/, and a worker never does.
  - Filing: the coordinator files the issues; a worker reports what it found, or files with --root <loop-root>.
  - Lease: an issue in progress is held by a worker, whose name, branch and start the lease records.
  - Finished work: list hides finished and deferred work; --all shows every status, and --tag, --status, --prio and --grep filter by tag, status, priority and text.`;
// ---- main --------------------------------------------------------------------------------------

// Every flag a command accepts, and what it takes: 'bool' takes no value, 'value' takes exactly one,
// 'many' may repeat (one value each time). A value flag always consumes the next argument, whatever it
// starts with — `--ran "--help"` records a row whose command is --help — or takes it inline as
// --flag=value. A bare `--` ends the flags: everything after it is positional, so a free-text note or
// a title that starts with -- goes there. A flag the command does not know is an error that names the
// ones it does, never silently dropped.
export const GLOBAL_FLAGS = { json: 'bool', help: 'bool', root: 'value' };
export const COMMAND_FLAGS = {
  init: { committed: 'bool', permanent: 'bool', profile: 'value', by: 'value' },
  renumber: { key: 'value', by: 'value' },
  new: {
    kind: 'value', prio: 'value', tier: 'value', tags: 'many', files: 'many', repo: 'many', 'found-by': 'value',
    where: 'value', what: 'value', why: 'value', acceptance: 'many', source: 'many', after: 'many', changelog: 'many', template: 'value',
    field: 'many', section: 'many', person: 'value', 'check-when': 'value', by: 'value',
  },
  import: {
    source: 'value', kind: 'value', prio: 'value', tier: 'value', tags: 'many', repo: 'many', 'found-by': 'value',
    only: 'many', adopt: 'bool', 'dry-run': 'bool', field: 'many', parent: 'value', by: 'value',
  },
  sources: { source: 'value' },
  evidence: { ran: 'many', saw: 'many', file: 'value', slot: 'value', by: 'value' },
  retract: { by: 'value' }, field: { add: 'bool', remove: 'bool', clear: 'bool', by: 'value' }, split: { line: 'many', by: 'value' }, base: { by: 'value' },
  list: { status: 'value', kind: 'value', tag: 'value', prio: 'value', grep: 'value', match: 'many', all: 'bool' },
  show: { full: 'bool' }, brief: { role: 'value', slice: 'value' }, set: { branch: 'value', worker: 'value', model: 'value', worktree: 'value', handover: 'bool', header: 'bool', by: 'value' },
  next: { limit: 'value', all: 'bool', as: 'value', slice: 'value' },
  review: { by: 'value', model: 'value', relayed: 'bool', outside: 'many', field: 'many' }, round: { findings: 'value', by: 'value' }, tick: { by: 'value' },
  models: { group: 'value', with: 'many', archives: 'bool' },
  scope: { branch: 'value', base: 'value', repo: 'value' },
  branches: { base: 'value', repo: 'value', 'stale-hours': 'value' },
  merged: { sha: 'value', ci: 'value', repo: 'value', ran: 'many', saw: 'many', red: 'value', keep: 'bool', by: 'value' },
  ask: { kind: 'value', target: 'value', issue: 'value', slice: 'value', option: 'many', 'applies-to': 'value', until: 'value', to: 'value', by: 'value' },
  answer: { by: 'value', option: 'value' },
  resume: { log: 'value', ready: 'value', gh: 'bool', repo: 'value', base: 'value', as: 'value', slice: 'value' },
  handoff: { summary: 'value', next: 'many', log: 'value', ready: 'value', gh: 'bool' },
  log: { by: 'value' }, decide: { settles: 'many', 'waives-review': 'many', by: 'value', quote: 'value', under: 'value', supersedes: 'value', 'applies-to': 'value', until: 'value', area: 'value', reach: 'value', rule: 'value' }, decisions: { live: 'bool' },
  goal: { set: 'value', by: 'value' },
  status: { 'stale-hours': 'value', group: 'value', tag: 'value', as: 'value', slice: 'value' }, archive: { by: 'value' }, report: { found: 'bool', metrics: 'bool' }, mode: { by: 'value' },
  changelog: { repo: 'value' },
  close: { force: 'bool', batch: 'bool', by: 'value' }, profile: {}, verify: {},
};

// The commands the command line runs and the tool list leaves out: no tool, and no block in the usage text.
export const INTERNAL_COMMANDS = Object.freeze(['handoff']);
export const flagsOf = (cmd) => ({ ...(COMMAND_FLAGS[cmd] || {}) });
// A flag one command does not take because its meaning is another flag's, or another command's: the refusal ends with the
// form of the call that does what was asked. --by names the author of a write and nothing else.
const RENAMED_FLAGS = {
  status: { by: { to: '--group', why: 'status groups its counts with --group, and --by names the author of a write' } },
  models: { by: { to: '--group', why: 'models groups its counts with --group, and --by names the author of a write' } },
  resume: { ci: { to: '--gh', why: 'resume asks gh for the CI of the tips with --gh; --ci is the CI state merged records' } },
  handoff: { ci: { to: '--gh', why: 'resume asks gh for the CI of the tips with --gh; --ci is the CI state merged records' } },
};
// The forms of the commands that take a removed form's place: a row or a note is taken back by retract, a verdict too.
const RETRACT_FORM = ['jarl.mjs', 'retract', hole('<id>'), hole('<n-or-note-n>'), hole('<why>'), '--by', hole('<who>')];
const RETRACT_REVIEW_FORM = ['jarl.mjs', 'retract', hole('<id>'), 'review', hole('<why>'), '--by', hole('<who>')];
// The form of field writing one part: its value the placeholder of the part, or --clear; --by where the call named one.
const fieldForm = (part, { clear = false, by = false, add = false, remove = false } = {}) => ['jarl.mjs', 'field', hole('<ids>'), part, ...(clear ? ['--clear'] : [hole(PART_HOLES[String(part).trim().toLowerCase()] ?? '<value>')]), ...(add ? ['--add'] : []), ...(remove ? ['--remove'] : []), ...(by ? ['--by', hole('<who>')] : [])];
// The flags whose name the surface does not have, each with what replaces it: a flag of the same command, or a call.
export const REMOVED_FLAGS = Object.freeze({ ...Object.fromEntries(Object.entries(RENAMED_FLAGS).map(([c, f]) => [c, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.to]))])), evidence: { retract: 'retract' } });
// The names a command's free text had in the tools, where it is now text: a flag or a tool field of that name is the text,
// and the refusal's form has the text's placeholder where the text goes.
export const GONE_TEXT_NAMES = Object.freeze({ set: 'why', review: 'findings', round: 'what', ask: 'question', answer: 'answer', log: 'event', decide: 'ruling', retract: 'reason' });
// The forms of a call the surface does not have because another command does what they ask, each with that command: a
// field's name where set takes a status (field writes it), a line given to log that reads as a line another command writes
// with its checks, a retraction asked of evidence or of review, a handoff action resume answers, a close that only the
// owner may let go on (the question put to him) or that archive does without losing work, and a loop made permanent in
// place where only init makes one. A refusal of such a call ends with the form of that command; a refusal of any other call
// ends with the form of the call itself, or with a step to take first.
export const REMOVED_FORMS = Object.freeze({
  set: ['field'],
  close: ['ask', 'archive'],
  mode: ['init'],
  log: ['new', 'set', 'round', 'review', 'retract', 'evidence', 'merged', 'field', 'tick'],
  evidence: ['retract'],
  review: ['retract'],
  handoff: ['resume'],
});
// A word that starts with -- and holds a space is no flag: a flag's name holds none, so it is a text given where a text
// goes, without the bare -- before it.
const textNotFlag = (a) => a.startsWith('--') && a.length > 2 && /\s/.test(a.indexOf('=') === -1 ? a.slice(2) : a.slice(2, a.indexOf('=')));
// The argument a flag of a command names when the command takes it as an argument: its own name (--title on new, --status
// on set), or text, or the name the text had (GONE_TEXT_NAMES), for the command's free text, its last argument. -1 when it
// names none.
const FREE_TEXT_ARGS = ['text', 'value', 'title', 'goal'];
const argumentNames = (cmd) => (COMMAND_ARGS[cmd] || []).map((a) => a.replace(/[?.]+$/, ''));
export function argumentOfFlag(cmd, name) {
  const names = argumentNames(cmd);
  const own = names.indexOf(name);
  if (own !== -1) return own;
  const last = names.length - 1;
  return (name === 'text' || GONE_TEXT_NAMES[cmd] === name) && FREE_TEXT_ARGS.includes(names[last]) ? last : -1;
}
// The placeholder where a flag the command does not take was given: the caller names the flag, or leaves it out.
const flagHole = () => hole('<a-flag-it-takes-or-none>');

// The name of a flag a word after a bare -- is, when it is one: a global flag (--root, --json) or a flag of the command,
// by its name alone or as --name=value. Such a word was written there by mistake (a flag goes before the --), and the
// refusal of the call reads it as the flag it names, so the form carries it where it goes; any other word is an argument.
export function flagAfterDashes(cmd, word) {
  const m = /^--([A-Za-z][\w-]*)(?:=|$)/.exec(String(word));
  return m && (Object.hasOwn(GLOBAL_FLAGS, m[1]) || Object.hasOwn(COMMAND_FLAGS[cmd] || {}, m[1])) ? m[1] : null;
}
// A call as the refusal of it sees it: the command, its flags in the order given ([name, value], true for a switch) and
// its arguments. Read from the words of the command line leniently, so a call the parser refused is read as well; a flag
// written after a bare -- is read as that flag (flagAfterDashes).
export function callOfArgv(argv) {
  const call = { cmd: undefined, flags: [], args: [] };
  let rest = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i]);
    if (!rest && a === '--') { rest = true; continue; }
    const word = rest ? call.cmd === undefined || flagAfterDashes(call.cmd, a) === null : !a.startsWith('--') || a.length === 2 || textNotFlag(a);
    if (word) { if (call.cmd === undefined) call.cmd = a; else call.args.push(a); continue; }
    const eq = a.indexOf('=');
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    const shape = { ...GLOBAL_FLAGS, ...(COMMAND_FLAGS[call.cmd] || {}) }[name];
    // An unknown flag before the command takes no word: the word after it is the command.
    if (eq !== -1) call.flags.push([name, a.slice(eq + 1), '=']);
    else if (shape === 'bool' || (shape === undefined && (call.cmd === undefined || i + 1 >= argv.length || String(argv[i + 1]).startsWith('-')))) call.flags.push([name, true]);
    else { call.flags.push([name, argv[i + 1] === undefined ? undefined : String(argv[i + 1])]); i += 1; }
  }
  return call;
}
// A call that dispatch holds: the command, its flags and its arguments, as the refusal of it sees them. A flag given as
// --name=value is marked so ('='), and printed so.
function callOf(cmd, rest, flags) {
  const out = [];
  const inline = flags[INLINE] || new Set();
  for (const [k, v] of Object.entries(flags)) {
    if (k === 'caller' || v === undefined || v === false) continue;
    if (v === true) out.push([k, true]); else for (const x of [].concat(v)) out.push([k, String(x), ...(inline.has(k) ? ['='] : [])]);
  }
  return { cmd, flags: out, args: rest.map((x) => (x === undefined ? '' : String(x))) };
}
// The shape of the call a refusal's ready part asks for: the call with its parts put in, taken out, renamed or moved. Its
// values are the caller's, and formOf prints none of them but the placeholders a part puts in.
function shapeOf(call, fixes) {
  const c = { cmd: call.cmd, flags: call.flags.map((f) => [...f]), args: [...call.args] };
  for (const f of [].concat(fixes)) {
    // A word replaced stands where the call gave it, and in a form every value is its placeholder already.
    if (f.retry || f.dashes || f.replace !== undefined || f.first !== undefined) continue;
    if (f.command !== undefined) { c.cmd = String(f.command); continue; }
    // Words beyond what the command reads: the free text they may be written in one with, or a placeholder after them.
    if (f.truncate !== undefined) { c.args = c.args.slice(0, Math.max(0, f.truncate - 1)); if (f.value !== undefined) { if (f.text && c.args.length) c.args[c.args.length - 1] = String(f.value); else c.args.push(String(f.value)); } continue; }
    if (f.rename !== undefined) { const to = f.to.startsWith('<') ? String(f.to) : f.to.replace(/^--/, ''); c.flags = c.flags.map(([k, v, ...s]) => (k === f.rename.replace(/^--/, '') ? [to, v, ...(to.startsWith('<') ? [] : s)] : [k, v, ...s])); continue; }
    // The value of a flag that names an argument goes where that argument goes, when the arguments given leave its place
    // free; else the flag's name becomes a placeholder.
    if (f.toArg !== undefined) {
      const name = f.toArg.replace(/^--/, '');
      const at = c.flags.findIndex(([k]) => k === name);
      if (at === -1) continue;
      const value = c.flags[at][1];
      const arity = (COMMAND_ARGS[c.cmd] || []).length;
      if (typeof value === 'string' && c.flags.filter(([k]) => k === name).length === 1 && c.args.length >= f.at && c.args.length < arity) { c.flags.splice(at, 1); c.args.splice(f.at, 0, value); } else c.flags[at] = [flagHole(c.cmd), value];
      continue;
    }
    if (f.drop !== undefined) {
      const name = f.drop.replace(/^--/, '');
      const at = f.value === undefined ? -1 : c.flags.findLastIndex(([k, v]) => k === name && (f.value === null ? v === undefined : v === String(f.value)));
      c.flags = f.value === undefined ? c.flags.filter(([k]) => k !== name) : c.flags.filter((_, i) => i !== at);
      continue;
    }
    if (f.flag !== undefined) {
      const name = f.flag.replace(/^--/, '');
      const value = f.value === undefined ? true : String(f.value);
      const empty = c.flags.findIndex(([k, v]) => k === name && v === undefined);
      const at = empty !== -1 && !f.add ? empty : c.flags.findIndex(([k]) => k === name);
      if (at === -1 || f.add) c.flags.push([name, value]); else c.flags[at] = [name, value];
      continue;
    }
    if (f.arg !== undefined) { while (c.args.length < f.arg) c.args.push(hole('<argument>')); c.args[f.arg] = String(f.value); }
  }
  return c;
}
// The placeholder of each argument and of each flag's value in a form, by command and name, else by name, else <value>;
// and of the value field writes, by the part it writes.
const ARG_HOLES = {
  ids: '<ids>', id: '<id>', title: '<title>', goal: '<goal>', files: '<findings.json>', 'import file': '<findings.json>', 'profile file': '<profile.json>',
  'retract entry': '<review-n-or-note-n>', 'retract text': '<why>', 'field name': '<part>', 'base name': '<name>', 'base branch': '<branch>',
  'set status': '<status>', 'set text': '<why>', 'review verdict': '<verdict>', 'review text': '<what-was-read-and-found>', 'round text': '<what-failed>',
  'tick line': '<line>', 'answer id': '<question>', 'decide slug': '<slug>', 'decide text': '<a-ruling>', 'archive slug': '<slug>', 'mode mode': '<mode>',
  text: '<text>',
};
const FLAG_HOLES = {
  by: '<who>', kind: '<kind>', 'ask kind': '<ask-kind>', prio: '<prio>', tier: '<tier>', tags: '<tag>', tag: '<tag>', files: '<paths>', repo: '<name-or-path>',
  'found-by': '<who>', where: '<text>', what: '<text>', why: '<text>', acceptance: '<line>', source: '<report-dir#finding-id>', 'sources source': '<report-dir>',
  'import source': '<report-dir>', after: '<ids-it-waits-on>', changelog: '<changelog-entry>', template: '<template>', field: '<name=value>', section: '<name=value>',
  person: '<name>', 'check-when': '<date-or-event>', profile: '<profile.json>', key: '<key>', only: '<finding-ids>', ran: '<command>', saw: '<what-it-printed>',
  file: '<path>', slot: '<slot>', status: '<status>', grep: '<text>', match: '<field=value>', branch: '<worker-branch>', worker: '<the-new-worker>',
  model: '<model-id>', worktree: '<the-worktree-of-the-lease>', limit: '<whole-number>', as: '<who>', slice: '<coordinator>', findings: '<count>', role: '<role>',
  group: '<group>', with: '<loop-root>', base: '<base-branch>', 'stale-hours': '<hours>', sha: '<sha>', ci: '<ci-state>', red: '<another-issue>',
  target: '<what-would-get-weaker>', issue: '<id>', option: '<option>', 'ask option': '<label:effect>', 'applies-to': '<selectors>', until: '<date-or-id>', to: '<jarl-or-owner>', log: '<count>',
  ready: '<count>', summary: '<text>', next: '<text>', settles: '<ids>', 'waives-review': '<ids>', quote: '<his-own-words>', under: '<a-ruling-in-force>', supersedes: '<a-ruling-in-force>',
  rule: '<rule-id>', area: '<type>', reach: '<number-of-files>', set: '<machine-line>', line: '<line=id>', outside: '<finding-outside-the-issue>', parent: '<id>',
};
const PART_HOLES = {
  title: '<title>', priority: '<prio>', tier: '<tier>', kind: '<kind>', tags: '<tag>', files: '<paths>', repo: '<name-or-path>', after: '<ids-it-waits-on>', parent: '<id>',
  source: '<report-dir#finding-id>', acceptance: '<line>', changelog: '<changelog-entry>', person: '<name>', 'check when': '<date-or-event>',
  resources: '<resource-name>', 'found by': '<who>', where: '<text>', what: '<text>', why: '<text>',
};
const argHole = (c, i) => {
  const name = argumentNames(c.cmd)[i];
  if (c.cmd === 'field' && name === 'value') return hole(PART_HOLES[String(c.args[1] ?? '').trim().toLowerCase()] ?? '<value>');
  return hole(ARG_HOLES[`${c.cmd} ${name}`] ?? ARG_HOLES[name] ?? '<value>');
};
const valueHole = (cmd, k) => hole(FLAG_HOLES[`${cmd} ${k}`] ?? FLAG_HOLES[k] ?? '<value>');
// The global flags of a call a printed command carries (see printCommand in lib/base.mjs). A refusal's forms and steps
// carry its --root and its --json: they are the call itself, filled. Every other command the call prints (in a reason,
// a note, a hint or a row of a view) carries its --root, so it reaches the loop the call named; the --json says how that
// call prints, and another command prints as its own caller asks.
export const callGlobals = (call) => (call?.flags || []).filter(([k]) => k === 'root' || k === 'json');
const rootOfCall = (call) => callGlobals(call).filter(([k]) => k === 'root');
// The flags a call of a command needs beside the ones it gives, so that its form, filled, is a call the command takes and
// not one refused for a part the form left out: the flag each command requires (the author of a judgement, the key of a
// renumbering, the sha of a merge that moves no CI state alone), and the flags one given goes with (a row's --ran and
// --saw, an attachment's --file and --slot, a wait's --person and --check-when with its --kind, the kind a question's
// --target, --slice or rule scope belongs to, the scope a rule's --until and --to end and hold, the area a ruling's
// --reach counts and its --rule is on). A flag named here as needed is refused when it is missing, by the command itself.
export const GOES_WITH = Object.freeze({
  evidence: { ran: ['saw'], saw: ['ran'], file: ['slot'], slot: ['file'] },
  merged: { ran: ['saw'], saw: ['ran'] },
  new: { person: ['check-when', 'kind'], 'check-when': ['person', 'kind'] },
  ask: { target: ['kind'], slice: ['kind'], 'applies-to': ['kind'], until: ['applies-to', 'kind'], to: ['applies-to', 'kind'] },
  decide: { reach: ['area'], rule: ['area'], until: ['applies-to'] },
});
// What a form of `cmd` holds when its call gives the flags named in `given`: the flags it needs (above), how many
// arguments at least, the optional last one included where no flag of the call stands in for it (the value field writes,
// but with --clear; the words of an answer, but with --option; a note, but with a row or a file), and how many at most,
// that last one left out where such a flag stands in for it, the command taking one or the other and never both.
export function formNeeds(cmd, given) {
  const has = (k) => given.has(k);
  const flags = [...(Object.hasOwn(AUTHOR_REQUIRED, cmd) ? ['by'] : []), ...(cmd === 'renumber' ? ['key'] : []), ...(cmd === 'merged' && !has('ci') ? ['sha'] : [])];
  for (let grew = true; grew;) {
    grew = false;
    for (const k of [...given, ...flags]) for (const w of GOES_WITH[cmd]?.[k] || []) if (!flags.includes(w)) { flags.push(w); grew = true; }
  }
  const valued = { field: !has('clear'), answer: !has('option'), evidence: !['ran', 'saw', 'file', 'slot'].some(has) }[cmd];
  const required = (COMMAND_ARGS[cmd] || []).filter((a) => !/[?.]$/.test(a)).length;
  const all = argumentNames(cmd).length;
  return { flags: flags.filter((k) => !given.has(k)), args: valued ? all : required, most: valued === false ? all - 1 : all };
}
// The form of a call: jarl.mjs, its command, the placeholder of each argument it takes (the ones it needs, and the ones
// the call gave), each flag of the call with the placeholder of its value (a switch as it is, one flag of a name, but a
// row's --ran and --saw as one pair for each row the call gave), and each flag it needs beside them (formNeeds); its
// global flags are carried by printCommand. A placeholder the shape put in stands where it goes; no other value of the
// call is printed, but the name of the part field writes. With dashes, the arguments come after a bare --.
function formOf(c, dashes) {
  if (!Object.hasOwn(COMMAND_FLAGS, c.cmd)) return ['jarl.mjs', hole('<a-jarl-command>')];
  const names = argumentNames(c.cmd);
  const rows = c.cmd === 'evidence' || c.cmd === 'merged' ? Math.max(...['ran', 'saw'].map((r) => c.flags.filter(([k]) => k === r).length)) : 0;
  const needs = formNeeds(c.cmd, new Set([...c.flags.map(([k]) => k), ...(rows ? ['ran', 'saw'] : [])]));
  const args = [];
  for (let i = 0; i < Math.min(needs.most, Math.max(needs.args, Math.min(c.args.length, names.length))); i += 1) {
    const v = c.args[i];
    // A placeholder the shape put in stands, but the generic one, where the argument has its own.
    if (isPlaceholder(v) && v.trim() !== '<value>') args.push(v.trim());
    else if (c.cmd === 'field' && i === 1 && typeof v === 'string' && v.trim()) args.push(v.trim());
    else args.push(argHole(c, i));
  }
  const flags = [];
  const seen = new Set();
  for (const [k, v] of c.flags) {
    // One flag of a name, but one more of a flag that repeats where the shape put in a placeholder of its own for it.
    const key = typeof v === 'string' && isPlaceholder(v) && v.trim() !== '<value>' && flagsOf(c.cmd)[k] === 'many' ? `${k} ${v.trim()}` : k;
    if (seen.has(key) || Object.hasOwn(GLOBAL_FLAGS, k)) continue;
    seen.add(key);
    // A flag that goes away is left out; a flag the caller is to name keeps a place for its value.
    if (k === '<no-flag-here>') continue;
    else if (rows && (k === 'ran' || k === 'saw')) { if (!seen.has('rows')) for (let n = 0; n < rows; n += 1) flags.push('--ran', valueHole(c.cmd, 'ran'), '--saw', valueHole(c.cmd, 'saw')); seen.add('rows'); }
    else if (k.startsWith('<')) flags.push(k, ...(typeof v === 'string' ? [hole('<value>')] : []));
    else if (v === true || flagsOf(c.cmd)[k] === 'bool') flags.push(`--${k}`);
    else flags.push(`--${k}`, isPlaceholder(v) && v.trim() !== '<value>' ? v.trim() : valueHole(c.cmd, k));
  }
  // Each flag the form needs that the call did not give, with the placeholder of its value.
  flags.push(...needs.flags.flatMap((k) => [`--${k}`, valueHole(c.cmd, k)]));
  return dashes ? ['jarl.mjs', c.cmd, ...flags, '--', ...args] : ['jarl.mjs', c.cmd, ...args, ...flags];
}
// The one way a refusal reaches whoever made the call: its reason, then its ready part, the last line (see lib/base.mjs,
// "refusals"). A shape of the call is printed as the call's form, after the view it names first on a line of its own; a
// command is printed alone, never joined to the call; a command of the tool that runs the loop ({ external }) as it is.
// Every command printed is built by printCommand (lib/base.mjs): it carries the global flags of the call as they were
// given, wherever the call wrote them, so a form filled where the call was made reaches the loop the call named, and is
// written for the shell of the platform it is printed on (shellOf): a POSIX shell on macOS and Linux, PowerShell and cmd
// on Windows; `platform` names another one where a test asks for it. A word of a form that shell cannot carry as it is
// (printable) is printed as its placeholder, and the reason says why. A form that writes and holds no placeholder gets
// one, so pasted as printed it is refused and writes nothing.
export function refusalFor(e, call, platform = process.platform) {
  if (!(e instanceof Refusal)) return e;
  const shell = shellOf(platform);
  if (isExternal(e.ready)) return new Error(`${e.reason}\n${commandLine(e.ready, shell)}`);
  if (!call) return new Error(`${e.reason}\n${readyText(e.ready, shell)}`);
  const fixes = [].concat(e.ready).filter(isFix);
  const shaped = fixes.length ? shapeOf(call, fixes) : call;
  const lines = fixes.length
    ? [...fixes.filter((f) => f.first !== undefined).map((f) => commandOf(f.first)), formOf(shaped, fixes.some((f) => f.dashes))]
    : [commandOf(e.ready)];
  let unprintable = false;
  const printed = lines.map((words) => words.map((w) => (printable(w, shell) ? w : ((unprintable = true), hole('<value>')))))
    .map((words) => (writes(words) && !words.some((w) => HOLE.test(String(w))) ? [...words, hole('<as-the-reason-says>')] : words));
  // The globals of the call as the shape left them: a shape may name the loop root the form is for.
  const globals = callGlobals(shaped);
  return new Error(`${reasonFor(e.reason, call, shell, unprintable)}\n${printed.map((words) => printCommand(words, { globals, shell })).join('\n')}`);
}
// The reason as printed: every word of the call it echoes with its line breaks escaped, so no word of the caller starts
// a line (but the global flags, which it prints only inside the commands printCommand built); and where the call's
// --root, or another word of the form, is one the shell of the form cannot carry, why the form names it by its
// placeholder.
function reasonFor(reason, call, shell = 'posix', unprintable = false) {
  const root = call.flags.find(([k]) => k === 'root')?.[1];
  const words = [call.cmd, ...call.args, ...call.flags.filter(([k]) => !Object.hasOwn(GLOBAL_FLAGS, k)).flatMap(([k, v]) => [k, `--${k}`, v])].filter((w) => typeof w === 'string');
  const rootNote = typeof root !== 'string' || isPlaceholder(root) || rootPrintable(root, shell) ? ''
    : breaksLine(root) ? ' (the --root given holds a line break, which no printed line carries: the form names the loop root by its placeholder)'
      : ' (the --root given holds a character that cmd and PowerShell read apart, or ends with a backslash a program reads as an escape: the form names the loop root by its placeholder)';
  const wordNote = unprintable ? ' (a word of the form holds a character that cmd and PowerShell read apart: the form names it by its placeholder)' : '';
  return `${escapedEchoes(reason, words)}${rootNote}${wordNote}`;
}

// The names of the flags a call gave as --name=value, held on its parsed flags out of sight of every reader of them.
const INLINE = Symbol('flags given as --name=value');
// A call read is read for its own globals: a command a reason prints while the call is read carries them.
export function parseArgs(argv) {
  const call = callOfArgv(argv);
  try { return printingFor(rootOfCall(call), () => { needNoPlaceholderWord(argv); return parseWords(argv); }); } catch (e) { throw refusalFor(e, call); }
}
// A word of the call that is one of the tool's placeholders, wherever it stands (the command, an argument, a flag's place,
// a flag's value, the value of --name=value, a global flag's value such as --root's), is refused before the call is read,
// so a form pasted as printed, unfilled, writes nothing and opens no loop.
function needNoPlaceholderWord(argv) {
  const holes = argv.map(String).map((a) => (a.startsWith('--') && a.includes('=') ? a.slice(a.indexOf('=') + 1) : a)).filter(isPlaceholder);
  need(holes.length === 0, `${[...new Set(holes)].map(shellWord).join(', ')} ${new Set(holes).size === 1 ? 'is a placeholder' : 'are placeholders'} of a form Jarl printed — write the value in its place; nothing was written`, { retry: true });
}
function parseWords(argv) {
  const positional = [];
  const flags = {};
  const inlineNames = new Set();
  let cmd;
  let rest = false;
  let dashAt = -1;
  const table = () => ({ ...GLOBAL_FLAGS, ...flagsOf(cmd) });
  const named = (t) => Object.keys(t).map((k) => `--${k}`).join(', ');
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (rest || !a.startsWith('--') || a.length === 2) {
      if (a === '--' && !rest) { rest = true; dashAt = positional.length; continue; }
      positional.push(a);
      if (cmd === undefined) {
        cmd = a;
        if (Object.hasOwn(REPLACED_COMMANDS, cmd)) replacedRefusal(cmd, argv.slice(i + 1));
        need(COMMAND_FLAGS[cmd], `unknown command: ${cmd} — the commands are ${Object.keys(COMMAND_FLAGS).filter((c) => !INTERNAL_COMMANDS.includes(c)).join(', ')}`, () => ({ command: hole('<a-jarl-command>') }));
      }
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    const inline = eq === -1 ? undefined : a.slice(eq + 1);
    const t = table();
    const kind = Object.hasOwn(t, name) ? t[name] : undefined;
    if (kind === undefined) {
      const renamed = cmd !== undefined && RENAMED_FLAGS[cmd]?.[name];
      if (renamed) refuse(renamed.why, { rename: `--${name}`, to: renamed.to });
      if (cmd === 'evidence' && name === 'retract') refuse('evidence takes nothing back with --retract: a row or a note is taken back with retract', RETRACT_FORM);
      if (cmd === undefined) refuse(`unknown flag ${a} before the command — only ${named(GLOBAL_FLAGS)} may come before it`, { drop: `--${name}` });
      if (textNotFlag(a)) refuse(`${JSON.stringify(a)} is a text, not a flag: a text that starts with -- goes after a bare --, with every flag before it`, { dashes: true });
      // A flag named as an argument of the command (its own name, text, or the name its text had) is that argument.
      const at = argumentOfFlag(cmd, name);
      if (at !== -1) refuse(`${cmd} takes its ${COMMAND_ARGS[cmd][at].replace(/[?.]+$/, '')} as argument ${at + 1}, not as --${name}`, { toArg: `--${name}`, at });
      refuse(`unknown flag ${a} for ${cmd} — it takes ${named(flagsOf(cmd))}; a text that starts with -- goes after a bare --`, { rename: `--${name}`, to: flagHole(cmd) });
    }
    if (kind === 'bool') {
      need(inline === undefined, `--${name} takes no value: it is given, or left out (got ${JSON.stringify(a)})`, () => (name === 'json' ? { flag: '--json' } : name === 'help' ? { drop: '--help' } : { rename: `--${name}`, to: hole('<no-flag-here>') }));
      flags[name] = true;
      continue;
    }
    let value = inline;
    if (value === undefined) {
      // A flag given once already loses the word with no value; else the word gets one.
      const before = flags[name] !== undefined && kind !== 'many';
      need(i + 1 < argv.length, `--${name} needs a value${before ? ` (it is given ${JSON.stringify(flags[name])} before, and takes one value)` : ''}`, () => (before ? [{ drop: `--${name}`, value: null }, { flag: `--${name}`, value: hole('<value>') }] : { flag: `--${name}`, value: hole('<value>') }));
      value = argv[i + 1];
      i += 1;
    } else inlineNames.add(name);
    if (kind === 'many') flags[name] = flags[name] === undefined ? value : [].concat(flags[name], value);
    else {
      // The same value twice is one; two values leave which one was meant open.
      need(flags[name] === undefined, `--${name} given twice (${JSON.stringify(flags[name])} and ${JSON.stringify(value)}) — it takes one value`, () => ([{ drop: `--${name}`, value }, { flag: `--${name}`, value: hole('<value>') }]));
      flags[name] = value;
    }
  }
  // Words beyond what the command reads are an error, not dropped: after a bare -- that is also where a
  // --root written last would land, and a call that silently lost its --root would write to another loop.
  if (cmd !== undefined && Object.hasOwn(ARITY, cmd)) {
    const extra = positional.slice(1 + ARITY[cmd]);
    // A flag written after the bare -- (with the value it takes there) is a flag in the wrong place, never a word of a text:
    // the reason says it goes before the --, and the form, which reads it as that flag, puts it there.
    const flagsMoved = [];
    const plain = [];
    for (let at = 0; at < positional.length; at += 1) {
      const w = positional[at];
      const name = dashAt !== -1 && at >= Math.max(dashAt, 1) ? flagAfterDashes(cmd, w) : null;
      if (name === null) { plain.push(w); continue; }
      flagsMoved.push(w);
      // Its value is the word after it, as the flag would take it before the --.
      if (table()[name] !== 'bool' && !w.includes('=')) at += 1;
    }
    const left = plain.slice(1 + ARITY[cmd]);
    const text = FREE_TEXT_ARGS.includes(argumentNames(cmd).at(-1));
    const words = text ? plain.slice(ARITY[cmd]) : left;
    const movedNames = [...new Set(flagsMoved.map((x) => x.split('=')[0]))];
    const where = movedNames.length ? `; ${movedNames.map((x) => JSON.stringify(x)).join(' and ')} ${movedNames.length === 1 ? 'is a flag, which goes' : 'are flags, which go'} before the bare --` : rest ? ' (everything after a bare -- is an argument, so flags such as --root go before it)' : '';
    need(extra.length === 0, `${cmd} takes at most ${ARITY[cmd]} argument${ARITY[cmd] === 1 ? '' : 's'} — unexpected: ${extra.map((x) => JSON.stringify(x)).join(' ')}${where}${left.length ? `; several ids are one argument: 12,13 or 203-206${text ? `; the words ${words.map((x) => JSON.stringify(x)).join(' ')} are one ${argumentNames(cmd).at(-1)} only when quoted as one word` : ''}` : ''}`,
      () => [{ truncate: 1 + ARITY[cmd], text, ...(left.length ? { value: text ? hole('<one-quoted-text>') : hole('<no-word-here>') } : {}) }, ...(rest ? [{ dashes: true }] : [])]);
  }
  // The flags given as --name=value, so a line printed for the call writes them as they were given.
  Object.defineProperty(flags, INLINE, { value: inlineNames });
  return { positional, flags };
}
// The arguments each command reads after its name, in order, named: the MCP server (jarl-mcp.mjs) turns each
// name into a field of that command's tool, so this table and COMMAND_FLAGS are the one source of both the
// CLI and the tools. A name ending in ? may be left out; one ending in ... takes any number of words (tag's
// +a -b, sources' findings files) and has no upper bound. A command's arity is how many names it has.
export const COMMAND_ARGS = {
  init: ['goal'], new: ['title'], renumber: ['id'], import: ['file'], sources: ['files...'],
  evidence: ['ids', 'text?'], retract: ['id', 'entry', 'text'], field: ['ids', 'name', 'value?'], split: ['id'], base: ['name', 'branch'],
  list: [], show: ['id'], brief: ['id?'], set: ['ids', 'status', 'text?'],
  merged: ['ids'],
  next: [], review: ['ids', 'verdict', 'text'], round: ['id', 'text'], tick: ['id', 'line'], models: [], scope: ['id?'], branches: [],
  ask: ['text'], answer: ['id', 'text?'], resume: [], handoff: ['action?'], log: ['text'],
  decide: ['slug', 'text'], decisions: [], goal: [], status: [], archive: ['slug'], report: [],
  changelog: ['ids'], mode: ['mode'], close: [], profile: ['file?'], verify: [],
};
// One sentence per command: what it does, the MCP tool's whole description after "WRITES the loop." or "Read-only.".
// The rest of what a command takes and does is its block of USAGE, which the jarl_help tool and --help print.
// The writes that record a judgement, each with the author its --by names: every call of one names it, and its tool
// requires the field by.
export const AUTHOR_REQUIRED = Object.freeze({
  answer: 'who answered: owner for the owner, jarl on an escalation, or a name',
  decide: 'who ruled: jarl for a choice made under a mandate, owner with quote, or a coordinator',
  review: 'who reviewed: a fresh reviewer\'s name, or jarl',
  retract: 'who takes the record back',
  tick: 'who ticks: owner, as only the owner ticks an owner line',
});
export const COMMAND_SUMMARY = {
  init: 'Open a loop: create .jarl/ with the goal, out of git by default, committed or permanent when asked.',
  new: 'File an issue under the next free number, with its fields and its What, Why and Acceptance; a promise (kind promise) or a wait on an outside person (kind wait, with person and check-when).',
  renumber: 'Give a free number to one of the issue files that carry one number after a merge, the one with the key named, keeping every line of the log written about it.',
  import: 'File one issue per finding of a findings file, skipping findings already filed and reporting those whose text changed; a finding with neither a claim nor a truth is not compared.',
  sources: 'Per findings report: its findings, the issues filed from them and their status.',
  evidence: 'Append a free-text note, or checkable rows of what ran and what it printed, to issues; or record a file as an attachment of a slot (--file, --slot).',
  retract: 'Take back the newest approve of an issue (entry: review), one evidence row by its number (entry: the number) or one evidence note (entry: note-<n>), by an entry that says who and why.',
  field: 'Change one part of the description of issues, a header field (Title, Priority, Tags, Files, After and the rest) or a section (What, Why, Acceptance, Changelog): a value replaces it, add and remove change the items of a list or add to a section, clear empties it; each change logs what the part held and who changed it when named.',
  split: 'Share out the acceptance lines of a parent among its sub-issues in one write: each line is moved to an issue, which becomes a sub-issue, or kept on the parent, and a line moved nowhere is refused.',
  base: 'Change the base branch a declared repository is held against, logging what it was.',
  list: 'List the issues, the unfinished ones by default, filtered by status, kind, tag, priority or a field.',
  show: 'Print one issue as the done gate sees it (its current window, rows numbered), or the whole file with --full.',
  brief: 'The brief an issue\'s worker or reviewer, or a slice\'s coordinator, is raised with, assembled from the record: the issue as show prints it, the rules that reach that reader, the rounds so far and their findings, the proof rows, the role\'s reference and the commands that record the result.',
  set: 'Change the status of issues, with the reason logged.',
  merged: 'Record a merge (sha, repository, the check that decided it, CI state) on issues and remove their finished worktree and branch when that is safe, or move the CI state of issues already merged.',
  next: 'The open issues ready to start: no file shared with work in progress, every After issue settled, no open question on them, never a promise or a wait; all adds the held and waiting ones in groups; as lists what is on the owner, the jarl or a named person (a promise on its maker, a wait on its person), each line with its command.',
  review: 'Record a reviewer\'s verdict (approve or changes) on issues, with the reviewer and the findings.',
  round: 'Record one red round on issues; every third (or the count the goal sets for the kind of issue) prints the takeover block for a fresh worker.',
  tick: 'Record the owner\'s tick of an acceptance line only he ticks, once he has reviewed the material it names.',
  models: 'Per model as worker and as reviewer, per kind of issue: the counts, clean first passes and verdicts the record holds, with the words fits, below, new and may clear; reads other loops and archives too.',
  scope: 'Measure the scope of a worker branch against its base: commits, diff inside the declared files, test changes; numbers, never a verdict.',
  branches: 'Every worker branch with its issues, commits beyond the base, worktree state, stale leases and done branches, in the loop\'s repository and every repository its issues name (repo narrows it to one).',
  ask: 'File a question the owner has to answer (stop, stuck, lower, charter or ratify).',
  answer: 'Record the answer to a question, the option chosen or the words given, as a ruling by whoever by names, and close the question; several ratify items take one answer.',
  resume: 'The boot: everything a session picks the loop up from, assembled live, the merge queue in its batches and the tips of every repository included (repo narrows those to one, gh asks gh for the tips\' CI); as ends it with what is on the one who asks.',
  handoff: 'read: resume, then the handoff file the loop holds, if any; write: writes nothing.',
  log: 'Append one dated note to the loop\'s journal; a line that reads as a move, a verdict or another line of state is refused.',
  decide: 'Append a ruling, optionally superseding one, settling issues or covering an area of code.',
  decisions: 'The rulings with who ruled and what superseded them.',
  goal: 'The goal as goal.md holds it, or one machine line of it set (Check, Model, Coordinators, Takeover or Liveness), with a log line that says what it was and what it is now.',
  status: 'The goal, the counts by status, the reviews, stale leases and what awaits ratification; as ends it with what is on the one who asks.',
  archive: 'Put the current loop away under .jarl/archive/ so a new one can open here.',
  report: 'What was done, dropped, deferred and still open, ready for the changelog, with the loop metrics first; set metrics for the metrics alone.',
  changelog: 'Print the issues\' changelog entries grouped by section, ready to paste under [Unreleased].',
  mode: 'Switch a committed loop to the permanent mode.',
  profile: 'The loop\'s profile (statuses, fields, sections), or a profile file checked against the schema.',
  verify: 'Check the record strictly, without a lock: the lines each reader does not place, the headers that disagree with the log, the repositories, leases and superseded rulings the issues name; exit 2 on a finding.',
  close: 'Close the loop, filing the ratification batch first; it refuses while issues are open or in progress, or deferred where it removes the loop, unless force is set.',
};
// The fields that hold a list, per command: an argument (named as in COMMAND_ARGS) or a flag, and what one item is.
// A name (an issue or question id, a tag, a finding's reference or id) never holds a bracket or a quote; a path (Files,
// Repo) may hold brackets that pair up, as file names do (src/[id]/page.tsx). tag's operations add names. The tools take
// each of these fields as one text or as a list of strings (jarl-mcp.mjs), and dispatch reads every one through
// listItems, so the command line and the tools follow one rule.
export const LIST_FIELDS = {
  new: { tags: 'name', files: 'path', repo: 'path', source: 'name', after: 'name' },
  import: { tags: 'name', repo: 'path', only: 'name' },
  decide: { settles: 'name', 'waives-review': 'name' },
  round: { id: 'name' }, answer: { id: 'name' },
  evidence: { ids: 'name' }, field: { ids: 'name' }, set: { ids: 'name' }, merged: { ids: 'name' },
  review: { ids: 'name' }, changelog: { ids: 'name' },
};
const QUOTED = /^["'`]|["'`]$/;
// Whether one item of a list is a piece of a list written out as text: it begins or ends with a quote mark, or, for a
// name, holds a bracket or a quote at all; for a path, its brackets do not pair up (what a comma inside "[a, b]"
// leaves), or it is an empty or quoted list in brackets ("[]", "["a"]"). A path in brackets with nothing else to
// tell it from a name ([1], [...slug]) is a name.
function piecesOfListText(item, kind) {
  if (QUOTED.test(item)) return true;
  if (kind === 'name') return /[[\]"'`]/.test(item);
  let depth = 0;
  for (const c of item) {
    if (c === '[') depth += 1;
    else if (c === ']' && --depth < 0) return true;
  }
  if (depth !== 0) return true;
  const inner = /^\[(.*)\]$/.exec(item)?.[1].trim();
  return inner !== undefined && (inner === '' || QUOTED.test(inner));
}
// The one rule of a list field: the items of one text written as a comma list, or of a list of such texts, each
// trimmed, the empty ones dropped. An item that starts with - is a flag in the wrong place (after a bare -- it is
// where a --root written last lands), and a piece of a list written as text would store its brackets and quotes:
// both are refused, naming the field.
export function listItems(value, kind, field) {
  const text = [].concat(value ?? []).map(String).join(',');
  const items = text.split(',').map((s) => s.trim()).filter(Boolean);
  const dashed = items.filter((s) => s.startsWith('-'));
  need(dashed.length === 0, `${field}: an item cannot start with - — got ${dashed.map((s) => JSON.stringify(s)).join(' ')} (everything after a bare -- is an argument, so flags such as --root go before it)`, () => ({ replace: dashed[0], value: hole('<an-item-with-no-leading-dash>') }));
  const holes = items.filter(isPlaceholder);
  need(holes.length === 0, `${field}: ${holes.map(shellWord).join(', ')} ${holes.length === 1 ? 'is a placeholder' : 'are placeholders'} — write the value in its place; nothing was written`, { retry: true });
  need(!items.some((s) => piecesOfListText(s, kind)), `${field} takes its items one by one: one item, a comma list (a,b) or a list of strings; ${kind === 'name' ? 'a list written as text, an item in quotes or a name holding a bracket or a quote mark' : 'a list written as text or an item in quotes'} is refused — got ${JSON.stringify(text)}`, () => { const bad = items.find((s) => piecesOfListText(s, kind)); return { replace: bad, value: hole('<an-item-without-quotes>') }; });
  return items;
}
// A command's arguments and flags with every list field read by listItems and written back as the one comma list the
// commands read: a list argument that is last takes every word left, and a list flag repeats.
function readLists(cmd, rest, flags) {
  const fields = LIST_FIELDS[cmd];
  if (!fields) return { rest, flags };
  const out = { rest: [...rest], flags: { ...flags } };
  COMMAND_ARGS[cmd].forEach((a, at) => {
    const field = a.replace(/[?.]+$/, '');
    const kind = fields[field];
    if (kind === undefined) return;
    const given = a.endsWith('...') ? (rest.length > at ? rest.slice(at) : undefined) : rest[at];
    if (given === undefined) return;
    out.rest.splice(at, a.endsWith('...') ? Infinity : 1, listItems(given, kind, field).join(','));
  });
  for (const [field, kind] of Object.entries(fields)) {
    if (Object.hasOwn(flagsOf(cmd), field) && flags[field] !== undefined) out.flags[field] = listItems(flags[field], kind, `--${field}`).join(',');
  }
  return out;
}

// The placeholders a call holds where a value goes: a whole value, a line of a value that holds one item per line, or the
// value part of a value written in parts — the value side of Name=value (--field, --section) and of Label: effect
// (--option), each side of dir#id (--source and the Source field), the entry of Section: entry (--changelog and the
// Changelog section), the qualifier, the value and each comma item of the value of a goal line (Model (light): opus,
// haiku), and each selector of --applies-to and its value (role worker). A text that holds <x> among other words is a
// text, and is not one of them.
const PART_OF = {
  field: (v) => [v.slice(v.indexOf('=') + 1)], section: (v) => [v.slice(v.indexOf('=') + 1)], option: (v) => [v.slice(v.indexOf(':') + 1)], line: (v) => (v.includes('=') ? [v.slice(0, v.indexOf('=')), v.slice(v.indexOf('=') + 1)] : []),
  source: (v) => v.split(',').flatMap((s) => s.split('#')), changelog: (v) => v.split('\n').map((l) => l.slice(l.indexOf(':') + 1)),
  set: (v) => { const m = /^[^:(]*(?:\(([^)]*)\))?\s*:(.*)$/s.exec(v); return m ? [m[1] ?? '', m[2], ...m[2].split(',')] : []; },
  'applies-to': (v) => v.split(/\s+and\s+/i).flatMap((s) => [s.trim(), s.trim().split(/\s+/).slice(1).join(' ')]),
};
// The parts that hold one item per line.
const LINE_PARTS = ['acceptance', 'changelog'];
function placeholdersIn(cmd, rest, flags) {
  const found = [];
  const look = (v, parts, lines) => { for (const p of [v, ...(lines ? String(v).split('\n') : []), ...(parts ? parts(String(v)) : [])]) if (isPlaceholder(p)) { found.push(String(v)); return; } };
  const name = String(rest[1] ?? '').trim().toLowerCase();
  rest.forEach((v, i) => look(v, cmd === 'field' && i === 2 ? PART_OF[name] : undefined, cmd === 'field' && i === 2 && LINE_PARTS.includes(name)));
  for (const [k, v] of Object.entries(flags)) if (k !== 'caller') for (const x of [].concat(v)) if (typeof x === 'string') look(x, PART_OF[k], LINE_PARTS.includes(k));
  return [...new Set(found)];
}

// The value of field for a header field that holds a list (Tags, Files, Repo, After, Source), read by the one rule of a
// list; any other part's value is one text, passed as it is. Items to remove are split at their commas and checked for a
// leading dash only: they match an item as it is stored, so an item stored with brackets or quotes can still be taken off.
const FIELD_LISTS = { tags: 'name', files: 'path', repo: 'path', after: 'name', source: 'name' };
function fieldListValue(name, value, remove) {
  const kind = FIELD_LISTS[String(name ?? '').trim().toLowerCase()];
  if (kind === undefined || value === undefined) return value;
  if (!remove) return listItems(value, kind, String(name).trim()).join(',');
  const items = [].concat(value).map(String).join(',').split(',').map((s) => s.trim()).filter(Boolean);
  const dashed = items.find((s) => s.startsWith('-'));
  need(dashed === undefined, `${String(name).trim()}: an item cannot start with - — got ${JSON.stringify(dashed)} (everything after a bare -- is an argument, so flags such as --root go before it)`, () => ({ replace: dashed, value: hole('<an-item-with-no-leading-dash>') }));
  need(!items.some(isPlaceholder), `${String(name).trim()}: ${items.filter(isPlaceholder).map(shellWord).join(', ')} — a placeholder: write the value in its place; nothing was written`, { retry: true });
  return items.join(',');
}

// The commands the command line and the tools do not have, each with the form of the command that does what was asked:
// every part of an issue's description is written by field, a repository's base by base, a branch is measured by scope,
// and the tips and the merge queue are sections of resume. The refusal names the command given and ends with that form,
// each value a placeholder, never a call built from the words given; --by stays in the form where the call gave it, and
// refusalFor writes the call's --root and --json into it as they were given.
function wordsOf(args, bools) {
  const pos = [];
  const flags = {};
  let rest = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = String(args[i]);
    if (!rest && a === '--') { rest = true; continue; }
    if (!rest && a.startsWith('--') && a.length > 2) {
      const [name, inline] = a.slice(2).split(/=(.*)/s);
      if (name === 'root') { if (inline === undefined) i += 1; continue; }
      if (bools.includes(name)) flags[name] = true;
      else (flags[name] = flags[name] || []).push(inline ?? (i + 1 < args.length ? String(args[(i += 1)]) : null));
    } else pos.push(a);
  }
  return { pos, flags };
}
const SECTION_FLAGS = { title: 'Title', where: 'Where', what: 'What', why: 'Why', acceptance: 'Acceptance', changelog: 'Changelog' };
const BOOLS = ['json', 'help', 'clear', 'append', 'gh'];
// The flags of a removed command that the command replacing it takes, each with the placeholder of its value.
const keptFlags = (cmd, flags) => Object.keys(flags).filter((k) => k !== 'json' && Object.hasOwn(flagsOf(cmd), k)).flatMap((k) => (flagsOf(cmd)[k] === 'bool' ? [`--${k}`] : [`--${k}`, valueHole(cmd, k)]));
export const REPLACED_COMMANDS = Object.freeze({
  tips: (args) => { const { flags } = wordsOf(args, BOOLS); return { why: 'the tips are a section of resume, which asks gh for their CI with --gh', form: ['jarl.mjs', 'resume', '--gh', ...keptFlags('resume', flags).filter((w) => w !== '--gh')] }; },
  queue: (args) => { const { flags } = wordsOf(args, BOOLS); return { why: 'the merge queue is a section of resume, its batches included', form: ['jarl.mjs', 'resume', ...keptFlags('resume', flags)] }; },
  check: (args) => { const { flags } = wordsOf(args, BOOLS); return { why: 'a branch is measured by scope', form: ['jarl.mjs', 'scope', hole('<id>'), '--branch', hole('<worker-branch>'), ...keptFlags('scope', flags).filter((w, i, all) => w !== '--branch' && all[i - 1] !== '--branch')] }; },
  prio: (args) => { const { flags } = wordsOf(args, BOOLS); return { why: 'the priority is a field', form: fieldForm('Priority', { by: flags.by !== undefined }) }; },
  tag: (args) => {
    const { pos, flags } = wordsOf(args, BOOLS);
    const remove = pos.slice(1).length > 0 && pos.slice(1).every((o) => o.startsWith('-'));
    return { why: 'tags are a field: field adds them with --add and takes them off with --remove, one call each', form: fieldForm('Tags', { add: !remove, remove, by: flags.by !== undefined }) };
  },
  files: (args) => {
    const { pos, flags } = wordsOf(args, BOOLS);
    const clearing = pos.length > 1 && !pos.slice(1).some((p) => p.trim().replace(/,/g, ''));
    return { why: 'the files are a field', form: fieldForm('Files', { clear: clearing, by: flags.by !== undefined }) };
  },
  source: (args) => { const { flags } = wordsOf(args, BOOLS); return { why: 'the source is a field', form: fieldForm('Source', { by: flags.by !== undefined }) }; },
  after: (args) => { const { flags } = wordsOf(args, BOOLS); return { why: 'the issues an issue waits on are a field', form: fieldForm('After', { clear: flags.clear === true, by: flags.by !== undefined }) }; },
  repo: (args) => {
    const { flags } = wordsOf(args, [...BOOLS, 'base']);
    if (flags.base) return { why: 'a repository\'s base is changed by base', form: ['jarl.mjs', 'base', hole('<name>'), hole('<branch>'), ...(flags.by !== undefined ? ['--by', hole('<who>')] : [])] };
    return { why: 'the repository is a field', form: fieldForm('Repo', { clear: flags.clear === true, by: flags.by !== undefined }) };
  },
  body: (args) => {
    const { flags } = wordsOf(args, BOOLS);
    const given = Object.entries(SECTION_FLAGS).filter(([flag]) => flags[flag] !== undefined);
    const parts = [...given.map(([flag, part]) => `--${flag} is ${part}`), ...(flags.section ? ['--section Name=value is the part Name'] : []), ...(flags.append ? ['--append is --add'] : [])];
    const why = `every part of the description is written by field, one call per part${parts.length ? ` (${parts.join(', ')})` : ' (Title, Where, What, Why, Acceptance, Changelog or a section the profile declares; --add adds to a section)'}`;
    const by = flags.by !== undefined;
    if (given.length === 1 && !flags.section) return { why, form: fieldForm(given[0][1], { add: flags.append === true && !['title', 'where'].includes(given[0][0]), by }) };
    return { why, form: ['jarl.mjs', 'field', hole('<ids>'), hole('<part>'), hole('<value>'), ...(flags.append ? ['--add'] : []), ...(by ? ['--by', hole('<who>')] : [])] };
  },
});
// The refusal of a command the surface does not have: what replaces it, and last the form of the command that does what
// was asked.
export function replacedRefusal(cmd, args = []) {
  const { why, form } = REPLACED_COMMANDS[cmd](args);
  refuse(`${cmd} is not a command; ${why}`, form);
}
// The same refusal as text, for a caller that reports it in a message of its own (the MCP server's unknown tool), its
// form carrying the root the call named.
export function replacedMessage(cmd, args = [], root = null) {
  try { replacedRefusal(cmd, args); } catch (e) { return refusalFor(e, { cmd, args: [], flags: root === null ? [] : [['root', root, '=']] }).message; }
  return '';
}

const ARITY = Object.fromEntries(Object.entries(COMMAND_ARGS).filter(([, a]) => !a.some((n) => n.endsWith('...'))).map(([c, a]) => [c, a.length]));

// The commands that write: each runs under .jarl/.lock (see withLock).
export const MUTATING = new Set(['init', 'new', 'renumber', 'import', 'set', 'field', 'split', 'base', 'merged', 'evidence', 'retract', 'review', 'round', 'tick', 'ask', 'answer', 'log', 'decide', 'goal', 'archive', 'mode', 'close']);
// Whether a printed command (jarl.mjs, then its words) writes: a command of the set above, but goal, which writes only
// with --set and else reads the goal.
export const writes = (words) => MUTATING.has(words[1]) && !(words[1] === 'goal' && !words.some((w) => w === '--set' || String(w).startsWith('--set=')));

// git's side of the loop: the merge driver git runs, and the settings a merger passes it. Neither reads a loop.
function mergeDriverMain(args) {
  const [what, ...rest] = args;
  if (what === 'decisions' && rest.length === 3) {
    const r = runDecisionsDriver(rest[0], rest[1], rest[2]);
    for (const c of r.conflicts) console.error(`jarl: decisions.md conflict — ${c}`);
    process.exit(r.code);
  }
  if (what === 'flags' && (rest.length === 0 || (rest.length === 2 && rest[0] === '--yg'))) {
    console.log(mergeFlags({ yg: rest[1] }));
    process.exit(0);
  }
  console.error('usage: jarl.mjs merge-driver decisions %O %A %B | merge-driver flags [--yg "<command>"]');
  process.exit(1);
}

const LONG_NOTE_CHARS = 600;
const LONG_NOTE_LINES = 6;

// The version of this install: the plugin manifest at the plugin root, three directories above this script. A copy with
// no manifest reports a fallback version. The MCP server reads the same value, so the command line and the server of one install agree.
export function installVersion() {
  try { return JSON.parse(readFileSync(new URL('../../../plugin.json', import.meta.url), 'utf8')).version || '0.0.0'; } catch { return '0.0.0'; }
}

// The line resume prints when the host names a plugin root in CLAUDE_PLUGIN_ROOT and the manifest there names another
// version than this script. The plugin's server runs the Jarl tools, so a different version there means the tools in the
// session and this script differ. Null when the variable is unset or empty, when the manifest is missing, unreadable or
// names no version, and when the two versions are equal. It never throws: a resume is never refused by it.
export function pluginVersionNote(env = process.env, script = installVersion()) {
  try {
    const root = (env.CLAUDE_PLUGIN_ROOT ?? '').trim();
    if (!root) return null;
    const plugin = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8')).version;
    if (typeof plugin !== 'string' || !plugin || plugin === script) return null;
    return `note: the plugin at CLAUDE_PLUGIN_ROOT, whose server runs the Jarl tools, is version ${plugin}; this script is version ${script}.`;
  } catch { return null; }
}

function main() {
  if (process.argv[2] === 'merge-driver') mergeDriverMain(process.argv.slice(3));
  if (process.argv.length === 3 && process.argv[2] === '--version') { console.log(installVersion()); process.exit(0); }
  let parsed;
  try { parsed = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
  const { positional, flags } = parsed;
  const [cmd, ...rest] = positional;
  if (!cmd || flags.help) { console.log(USAGE); process.exit(flags.help ? 0 : 1); }
  const root = R.resolveRoot(flags.root);
  let r;
  try { r = dispatch(root, cmd, rest, flags); } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const { out, text, warn } = r;
  // Said on the command line only, after the note is written whole: a long free-text note is hard to read back and
  // cannot be retracted by number; nothing is refused or cut.
  if (cmd === 'evidence' && flags.ran === undefined && typeof rest[1] === 'string' && (rest[1].length > LONG_NOTE_CHARS || rest[1].trim().split('\n').length > LONG_NOTE_LINES)) {
    warn.push(`note: that evidence note is long (${rest[1].trim().length} characters, ${rest[1].trim().split('\n').length} lines) and was written whole; only its first line reaches the log, and a note is not a row that can be retracted by number — for proof of work, record it as --ran "<command>" --saw "<what-it-printed>"`);
  }
  console.log(flags.json ? JSON.stringify(out, null, 2) : text);
  for (const w of warn) console.error(w);
  if ((cmd === 'scope' || cmd === 'verify') && !out.ok) process.exit(2);
}

// The ratification batch as close prints it: one line per item, then what became of the ones nobody answered.
function renderBatch(batch, loop) {
  if (!batch.items.length && !batch.waiting) return loop === 'open' ? 'no area ruling awaits ratification' : '';
  const head = `\nto ratify (${batch.items.length}${batch.waiting ? `, ${batch.waiting} more at the next close` : ''}) — answer each with yes or reject (tak or nie): ${jarlLine('answer', '<question>', 'yes', '--by', '<who>')}`;
  const tail = { open: 'nothing closed; the loop goes on', kept: 'unanswered items stay open in the record', removed: 'unanswered, they left with the loop as its own rulings' }[loop];
  return `${head}\n${batch.items.map((i) => `- ${i.ask} · ${i.question}`).join('\n')}\n${tail}`;
}
// The rules of the loop offered for promotion at its close, each a question on the owner with the four ways it goes on.
// Where close removed the loop the questions went with it, so no answer is offered for them.
function renderPromotion(p, loop) {
  if (!p) return '';
  if (p.off) return `\n${p.off}`;
  if (!p.items.length) return '';
  if (loop === 'removed') return `\n${p.items.length} rule(s) of the loop were offered for promotion and left with it unanswered: close --batch offers them before the loop goes`;
  return `\nrules of the loop to promote (${p.items.length}) — answer each with one way (carry, instructions, law or drop): ${jarlLine('answer', '<question>', '--option', '<option>', '--by', '<who>')}\n${p.items.map((i) => `- ${i.ask} · ${i.question}`).join('\n')}`;
}
function renderRuleLog(r, t) {
  if (!r || !t) return '';
  if (t.state === 'written') return ` · rule ${r.rule} ratified in its own log (by ${t.by}${t.datetime ? `, ${t.datetime}` : ''})`;
  if (t.state === 'skipped') return ` · rule ${r.rule} not ratified in its own log: ${t.reason}`;
  return ` · rule ${r.rule} NOT ratified in its own log: ${t.reason}`;
}
// A loop whose profile keeps close to the record belongs to the composer that runs it: what the answer says instead of
// a write, naming the composer and its command.
function composerOf(root) {
  const profile = R.loadProfile(root);
  if (profile.lifecycle.close !== 'record') return null;
  return { state: 'skipped', reason: `this loop is run by ${profile.name}, which writes it into the graph with its own code${profile.lifecycle.command ? ` — ${profile.lifecycle.command}` : ''}` };
}
function renderTypeLog(t) {
  if (!t) return '';
  if (t.state === 'written') return ` · written into the type's decision log${t.datetime ? ` (${t.datetime})` : ''}`;
  if (t.state === 'skipped') return ` · not written into a type log: ${t.reason}`;
  return ` · NOT written into the type log: ${t.reason}`;
}

// set <ids> <status> [why] or set <ids> <field> <value>: the library decides which one the name is (see setRoute). The
// command line (and the MCP tools, which run through dispatch) always sets as caller 'cli'.
function setCommand(root, ids, name, value, flags) { return cmdSet(root, ids, name, value, { ...flags, caller: 'cli' }); }

// One command, run: its result (what --json prints), its text and the notes said on stderr. Throws on a refusal.
// Every call starts from empty caches, so a caller that runs many commands in one process (a server) sees each
// time what is on disk and in git now, exactly as a fresh process would.
// Every command the call prints, in its answer, its notes, its JSON or its refusal, carries the call's --root and --json
// (printingFor): a view and a note describe the loop the call named, and their commands reach it.
export function dispatch(root, commandName, rest, flags) {
  const call = callOf(commandName, rest, flags);
  let r;
  try { r = printingFor(rootOfCall(call), () => dispatchCall(root, commandName, rest, flags)); } catch (e) { throw refusalFor(e, call); }
  // A note echoes words of the call as a reason does: line breaks escaped, a word a shell acts on in single quotes; the
  // global flags it prints only inside the commands printCommand built.
  const words = [commandName, ...rest, ...Object.entries(flags).filter(([k]) => !Object.hasOwn(GLOBAL_FLAGS, k)).flatMap(([, v]) => [].concat(v))].filter((w) => typeof w === 'string');
  return { ...r, warn: (r.warn || []).map((w) => escapedEchoes(w, words)) };
}
// The writing commands that run where no loop is: init makes one. Every other write needs the loop to exist; the views
// read an empty one where none is.
const NEEDS_NO_LOOP = ['init'];
function dispatchCall(root, commandName, rest, flags) {
  const cmd = commandName;
  if (Object.hasOwn(REPLACED_COMMANDS, cmd)) replacedRefusal(cmd, rest);
  // A placeholder a refusal printed, pasted unfilled, is never recorded: every value the call takes is checked for one.
  // The reason names the placeholders a value holds, never the value, which may hold a line break or anything else.
  const holes = placeholdersIn(cmd, rest, flags);
  const named = () => { const found = [...new Set(holes.flatMap((v) => String(v).match(new RegExp(HOLE.source, 'g')) || []))]; return `${found.map((p) => shellWord(p)).join(', ')} ${found.length === 1 ? 'is a placeholder' : 'are placeholders'} of a form Jarl printed, left in ${holes.length === 1 ? 'a value' : `${holes.length} values`} of the call`; };
  need(holes.length === 0, holes.length ? `${named()}: write the value in its place — nothing was written` : '', { retry: true });
  // An argument the command requires and the call left out is named, and the form has a placeholder for it.
  const missing = (COMMAND_ARGS[cmd] || []).filter((a, n) => !/[?.]$/.test(a) && rest[n] === undefined && !(cmd === 'set' && a === 'status' && flags.header));
  need(missing.length === 0, `${cmd} requires ${missing.map((a) => `its ${a}`).join(' and ')}: the form below has a placeholder for each value`, { retry: true });
  if (MUTATING.has(cmd) && !NEEDS_NO_LOOP.includes(cmd)) needLoop(root);
  ({ rest, flags } = readLists(cmd, rest, flags));
  resetCaches();
  let out;
  let text;
  let warn = [];   // said on stderr, so a caller reading stdout sees the result alone
  const each = (o, f) => [].concat(o).map(f).join('\n');
  const writes = MUTATING.has(cmd);
  const writer = writerOf(root, cmd, rest, flags);
  {
    (writes ? (fn) => withLock(root, fn) : (fn) => fn())(() => withWriter(writer, writer === null ? null : (r) => needFormat(r, 'writer'), () => {
    if (writer !== null) needWriterFormat(root, cmd, flags);
    switch (cmd) {
      case 'init': out = R.initLoop(root, rest[0], { ...flags, caller: 'cli' }); text = `opened ${out.dir} · ${out.permanent ? 'permanent record, no branch' : out.committed ? 'committed with the work' : 'kept out of git'}${out.profile ? ` · profile ${out.profile}` : ''}`; warn = out.note ? [`note: ${out.note}`] : []; break;
      // The command line says caller 'cli': the notes (the tier a new issue got) are for it, never for a library caller.
      case 'new': out = R.newIssue(root, rest[0], { ...flags, caller: 'cli', width: undefined }); out = { ...out, ...describeNew(out.file) }; text = renderNewReply(out); warn = out.note ? [out.note] : []; break;
      case 'renumber': out = cmdRenumber(root, rest[0], flags); text = `${out.from} → ${out.id} · issues/${basename(out.file)} · key ${out.key}`; break;
      case 'import': out = cmdImport(root, rest[0], flags); text = renderImport(out); break;
      case 'sources': out = cmdSources(root, rest, flags); text = renderSources(out); break;
      case 'list': out = cmdList(root, flags); text = renderList(out, R.loadProfile(root)); break;
      case 'show': { const i = R.findIssue(root, rest[0]); need(i, `no such issue: ${rest[0]} — the issues: ${jarlLine('list', '--all')}`, { arg: 0, value: '<id>' }); const attachments = attachmentStates(root, i); out = { ...i, evidenceRows: evidenceTable(i.sections.evidence).rows.map(({ n, ran, saw, retracted }) => ({ n, ran, saw, retracted })), where: whereOf(root, i), ...(attachments.length ? { attachments } : {}) }; text = issueView(root, i, { full: Boolean(flags.full) }); break; }
      case 'brief': out = R.briefData(root, rest[0], flags); text = renderBrief(out); break;
      case 'set':
        // A field is written by field, never by set: the refusal ends with the form of the call that writes it.
        if (setRouteOf(root, rest[1]) === 'field') {
          const clearing = rest[2] === undefined || (typeof rest[2] === 'string' && rest[2].trim() === '');
          refuse(`${rest[1]} is a field, not a status: field writes it`, fieldForm(String(rest[1]).trim(), { clear: clearing, by: flags.by !== undefined }));
        }
        out = setCommand(root, rest[0], rest[1], rest[2], flags);
        text = each(out, (o) => (o.header ? `header of ${o.id} rewritten from the log: ${o.status}` : `${o.id} → ${o.status}${o.branch ? ` · ${o.branch}` : ''}${o.worker ? ` · ${o.worker}` : ''}${o.handover ? ' · handed over' : ''}`)); warn = [].concat(out).filter((o) => o.note).map((o) => `note: ${o.id} ${o.note}`); break;
      case 'field':
        out = cmdField(root, rest[0], rest[1], fieldListValue(rest[1], rest[2], flags.remove === true), { ...flags, caller: 'cli' });
        text = each(out, renderField);
        warn = [].concat(out).flatMap((o) => (o.note ? [o.note] : []).concat((o.notes || []).map((n) => `note: ${n}`)));
        break;
      case 'split':
        out = cmdSplit(root, rest[0], flags);
        text = `${out.id} split: ${out.lines.map((l) => (l.kept ? `line ${l.line} kept` : `line ${l.line} → ${l.to}`)).join(', ')} · sub-issues ${out.subs.join(', ')}`;
        warn = out.notes || [];
        break;
      case 'base':
        out = cmdRepoBase(root, rest[0], rest[1]);
        text = out.unchanged ? `${out.name} base: ${out.base} (unchanged)` : `${out.name} base: ${out.base} (was ${out.was ?? 'none'})`;
        break;
      case 'evidence':
        out = R.addEvidence(root, rest[0], rest[1], flags); text = each(out, renderEvidence); break;
      // One verb takes back a verdict and an evidence row: the review's newest approve, or the row by its number.
      case 'retract':
        need(rest[1] === 'review' || /^(note-)?\d+$/.test(rest[1] ?? ''), `retract takes review (the newest approve) or the number of an evidence row, or note-<n> for a note, got "${rest[1] ?? ''}"`, () => [...(rest[0] === undefined ? [{ arg: 0, value: '<id>' }] : []), { arg: 1, value: '<review-n-or-note-n>' }, ...(rest[2] === undefined ? [{ arg: 2, value: '<what-was-wrong>' }] : []), ...(flags.by === undefined ? [{ flag: '--by', value: '<who>' }] : [])]);
        if (rest[1] === 'review') { out = R.review(root, rest[0], 'retract', rest[2], { by: flags.by, caller: 'cli' }); text = each(out, renderReview); warn = [].concat(out).filter((o) => o.note).map((o) => `note: ${o.note}`); } else { out = R.addEvidence(root, rest[0], rest[2], { retract: rest[1], by: flags.by }); text = each(out, renderEvidence); }
        break;
      // One computation of the rows: the ready ones are listed, and the rest says how many are held or waiting.
      case 'next': {
        if (flags.as !== undefined) {
          need(flags.limit === undefined, '--limit counts the ready issues of next; next --as prints at most seven lines, and --all every line', () => ({ rename: '--limit', to: '<no-flag-here>' }));
          need(flags.slice === undefined, '--slice scopes next to one coordinator\'s slice; next --as <coordinator> lists what is on that coordinator, its slice included', () => ({ rename: '--slice', to: '<no-flag-here>' }));
          out = cmdNextAs(root, flags); text = renderNextAs(out);
          break;
        }
        const rows = cmdNext(root, { ...flags, all: true });
        out = rows.scheduler || flags.all ? rows : rows.filter((r) => r.ready);
        text = rows.scheduler ? rows.note : renderNext(out, flags.all === true, rows.length - out.length);
        break;
      }
      case 'review':
        // A verdict is taken back by retract alone: the refusal is that call, with the words given.
        if (rest[1] === 'retract') refuse('a verdict is taken back with retract, not with review retract', RETRACT_REVIEW_FORM);
        out = R.review(root, rest[0], rest[1], rest[2], { ...flags, caller: 'cli' }); text = each(out, renderReview); warn = [].concat(out).filter((o) => o.note).map((o) => `note: ${o.note}`); break;
      case 'tick': out = cmdTick(root, rest[0], rest[1], flags); text = `${out.id} acceptance line ${out.line} ticked by ${out.by} at ${out.at}`; break;
      // --group is the grouping the views and the record library read as by.
      case 'models': out = cmdModels(root, groupedBy(flags)); text = renderModels(out); break;
      case 'round': out = eachIssue(root, rest[0], (id, dry) => cmdRound(root, id, rest[1], dry, flags)); text = each(out, (o) => (o.takeover ? `${o.id} round ${o.round} — takeover:\n\n${o.block}` : `${o.id} round ${o.round}: ${o.since} of ${o.limit} before a takeover; the rounds so far: show ${o.id}`)); break;
      case 'merged': out = R.recordMerged(root, rest[0], { ...flags, caller: 'cli' }); text = `${out.ids.join(', ')} ${out.sha ? `merged ${out.sha}` : 'merge'}${out.check ? ` · check ${out.check}` : ''}${out.red ? ` · landed red, cause ${out.red}` : ''}${out.ci ? ` · CI ${out.ci}` : ''}${(out.cleanup || []).map((c) => `\n${c.kept ? `kept ${c.branch}${c.worktree ? ` (worktree ${c.worktree} removed)` : ''} — ${c.kept}` : `removed ${c.worktree ? `the worktree ${c.worktree} and ` : ''}the branch ${c.branch}`}${(c.commands || []).length ? `\nafter looking at the files, remove them with:\n${c.commands.map((x) => `  ${x}`).join('\n')}` : ''}${out.cleanup.some((x) => x.repo !== c.repo) ? ` [${c.repo}]` : ''}`).join('')}`; warn = out.notes.map((n) => `note: ${n}`); break;
      case 'scope': out = cmdCheck(root, rest[0], flags); text = `${out.id === null ? `package ${out.ids.join(', ')} on ${out.branch}\n` : ''}${out.repo === root ? '' : `in ${out.repo}\n`}${out.items.map((i) => `${i.ok ? '✓' : '✗'} ${i.name} — ${i.note}`).join('\n')}${out.notes.length || out.notesOmitted ? `\n${renderCheckNotes(out)}` : ''}`; break;
      case 'branches': out = cmdBranches(root, flags); text = renderBranches(out, root); break;
      case 'ask': out = R.ask(root, rest[0], { ...flags, width: undefined }); text = askText(out); break;
      // The library's answer (jarl-record/1) takes no opts: --by and --option reach the answer through jarl-lib.mjs, under the lock held here.
      // A judgement names its author: an answer and a ruling are refused without --by, with the call that names one.
      case 'answer':
        need(flags.by !== undefined, 'answer records who answered with --by, owner for the owner', () => ([{ flag: '--by', value: '<who>' }, ...(rest[1] === undefined && flags.option === undefined ? [{ arg: 1, value: '<text>' }] : [])]));
        out = cmdAnswerMany(root, rest[0], rest[1], flags); break;   // text below: the type log is written outside the lock
      case 'resume': out = R.resumeData(root, flags); text = renderResume(out, R.loadProfile(root), pluginVersionNote(), flags.as !== undefined); ({ out, text } = endWithAsker(root, flags, out, text)); break;
      case 'handoff':
        need(rest[0] === undefined || rest[0] === 'read' || rest[0] === 'write', `handoff takes read or write (got "${rest[0]}") — the state is assembled live by resume`, ['jarl.mjs', 'resume']);
        if (rest[0] === 'write') { out = cmdHandoffWrite(); text = out.note; } else { out = cmdHandoffRead(root, flags); text = out.text; }
        break;
      case 'report': out = cmdReport(root, flags); text = out.text; break;
      case 'log':
        need(typeof rest[0] === 'string' && rest[0].trim(), 'log requires "<text>"', () => ({ arg: 0, value: '<text>' }));
        out = R.appendLog(root, rest[0]); text = 'logged'; break;
      case 'decide':
        need(flags.by !== undefined, 'decide records who ruled with --by, jarl under a mandate, owner with --quote "<his-own-words>"', () => ([{ flag: '--by', value: '<who>' }, ...(rest[1] === undefined ? [{ arg: 1, value: '<text>' }] : [])]));
        out = R.decide(root, rest[0], rest[1], flags); text = renderDecide(out); decideNotes(root, rest[0], out.by, flags, warn); break;
      case 'decisions': out = R.decisions(root, flags); text = renderDecisions(out); break;
      case 'goal': out = flags.set === undefined ? cmdGoal(root) : cmdGoalSet(root, flags.set); text = flags.set === undefined ? out.goal : out.unchanged ? `goal line unchanged: ${out.shown}` : `goal line ${out.replaced ? 'changed' : 'added'}: ${out.shown}${out.replaced ? ` (was ${out.was})` : ''}`; break;
      case 'status': out = R.statusData(root, groupedBy(flags)); text = renderStatus(out, R.loadProfile(root)); ({ out, text } = endWithAsker(root, flags, out, text)); break;
      case 'changelog': out = cmdChangelog(root, rest[0], flags); text = out.text || '(no changelog fragment on these issues)'; warn = out.missing.length ? [`note: no changelog fragment: ${out.missing.join(', ')} — record one with: ${jarlLine('field', '<id>', 'Changelog', '<changelog-entry>', '--add')}, its section first (Added, Changed, Deprecated, Removed, Fixed or Security, then a colon)`] : []; break;
      case 'archive': out = cmdArchive(root, rest[0], { caller: 'cli' }); text = `archived → ${out.archived}${out.leftOpen.length ? ` · ${out.leftOpen.length} still open or in progress: ${out.leftOpen.join(', ')}` : ''} · open a new loop with: ${jarlLine('init', '<goal>')}`; break;
      case 'mode': out = cmdMode(root, rest[0]); text = 'now permanent · not tied to a feature branch; close keeps the directory'; break;
      case 'profile': out = cmdProfile(root, rest[0]); text = renderProfile(out); break;
      case 'verify': out = cmdVerify(root); text = renderVerify(out); break;
      case 'close': out = cmdClose(root, { ...flags, caller: 'cli' }); text = out.closed ? (out.kept ? `kept ${out.kept} · closed as a permanent record` : `removed ${out.removed}${out.archiveKept ? ' (the live loop; .jarl/archive/ is left in place)' : out.archiveRemoved ? ` (with .jarl/archive/: ${out.archiveRemoved.join(', ')})` : ''}`) + (out.deferred.length ? ` · ${out.deferred.length} deferred ${out.kept ? 'still waiting' : 'removed with the loop'}: ${out.deferred.join(', ')}` : '') + (out.uncommitted ? ` · ${out.uncommitted} loop file(s) not committed${out.kept ? ' — commit .jarl/' : ' before the removal'}` : '') + renderBatch(out.batch, out.kept ? 'kept' : 'removed') + renderPromotion(out.promotion, out.kept ? 'kept' : 'removed') : (renderBatch(out.batch, 'open') + renderPromotion(out.promotion, 'open')).trimStart(); break;
      default: refuse(`unknown command: ${cmd}`, { command: hole('<a-jarl-command>') });
    }
    }));
  }
  // A ratified area ruling goes to the type's decision log after the answer is recorded and the lock let go: the
  // probe and the write run another tool, which may take a while, and other writers of the loop must not wait on it.
  // A loop run by a composer (its profile keeps close to the record) is written into the graph by that composer, with
  // its own code and into the tree it hands over: here the answer is recorded and nothing is sent, so no entry is ever
  // written twice, nor into a checkout the composer's work never reaches.
  if (cmd === 'answer') text = [].concat(out).map((one) => answered(root, one, warn)).join('\n');
  return { out, text, warn };
}

// The commands whose --by names the writer of the call: every line the call writes into the log carries it, in its fixed
// place after the stamp, under record format 3. The commands whose --by is part of what they record (the author of a
// description change, the reviewer, who answered, ruled or retracted) keep it there: set naming a field and evidence
// taking a row back are those too.
export const WRITER_COMMANDS = Object.freeze(['init', 'new', 'renumber', 'import', 'evidence', 'set', 'merged', 'round', 'ask', 'log', 'goal', 'base', 'archive', 'mode', 'close']);
function writerOf(root, cmd, rest, flags) {
  if (!WRITER_COMMANDS.includes(cmd) || flags.by === undefined) return null;
  if (cmd === 'set' && setRouteOf(root, rest[1]) === 'field') return null;
  return editorOf(flags.by);
}
// A writer is written in record format 3: a loop that cannot be raised to it (its profile names an external scheduler,
// or init's profile does) refuses the call before anything is written. The raise itself comes with the call's first line.
function needWriterFormat(root, cmd, flags) {
  const line = FORMAT_LINES.writer;
  const profile = cmd === 'init' ? (flags.profile !== undefined ? readProfileFile(flags.profile).profile : null) : R.loadProfile(root);
  if (profile === null || profile.format >= line.format || formatState(profile).raises) return;
  refuse(`${line.what} (--by) needs record format ${line.format}, and this loop stays at format ${profile.format}: its profile names an external scheduler (${profile.scheduler}), the composer that reads this record, so Jarl never raises its format; leave --by out there — nothing was written`, { rename: '--by', to: '<no-flag-here>' });
}

// The flags of a grouping view with --group handed on as the grouping the library reads (by).
function groupedBy(flags) {
  const { group, ...rest } = flags;
  return group === undefined ? rest : { ...rest, by: group };
}

// status --as and resume --as: the view, then the asker's list as next --as prints it (`as` in --json).
function endWithAsker(root, flags, out, text) {
  if (flags.as === undefined) return { out, text };
  const asker = askerSection(root, flags.as);
  return { out: { ...out, as: asker.as }, text: `${text}\n\n${asker.text}` };
}

// The line each command prints for one result.
// A section's text on one line, cut where it runs long; a header field as it is.
const FIELD_SHOWN = 120;
const renderField = (o) => { const v = String(o.value ?? '').split('\n').map((l) => l.trim()).filter(Boolean).join(' / '); return `${o.id} ${o.field}: ${v ? (v.length > FIELD_SHOWN ? `${v.slice(0, FIELD_SHOWN)}…` : v) : '(cleared)'}`; };
const renderEvidence = (o) => (o.retractedNote ? `${o.id} evidence note ${o.retractedNote} retracted by ${o.by}` : o.retracted ? `${o.id} evidence row ${o.retracted} retracted by ${o.by}` : o.rows ? `${o.id} evidence row${o.rows.length > 1 ? 's' : ''} recorded` : `${o.id} evidence recorded`);
const renderReview = (o) => (o.retracted ? `${o.id} review retracted by ${o.by} (${o.kind}): the approve ${o.retracted}` : `${o.id} review ${o.verdict}${o.by ? ` by ${o.by} (${o.kind})` : ''} · acceptance: ${o.acceptance ? o.acceptance.split('\n').join(' / ') : '(none on file)'}${o.filed ? ` · filed outside the issue: ${o.filed.join(', ')}` : ''}${o.next ? ` · next: ${o.next}` : ''}`);

// One answer, after its ruling is recorded: a ratified area ruling goes to the type's decision log (and a rule's ratification
// to the rule's own log) through the composer or the graph's tool, then the line the command prints for it.
function answered(root, out, warn) {
  const composer = (out.typeDecision || out.ruleRatification) ? composerOf(root) : null;
  if (out.typeDecision) {
    out.typeLog = composer || writeAreaDecision(root, out.typeDecision);
    try { withLock(root, () => recordTypeLog(root, out.ruling, out.typeDecision, out.typeLog)); } catch (e) { warn.push(`note: what became of ${out.ruling} in the type log was not recorded in the loop: ${e.message}`); }
  }
  // The rule's ratification is written after the type's decision, and independently of it: either may fail alone.
  if (out.ruleRatification) {
    out.ruleLog = composer || writeRuleRatification(root, out.ruleRatification);
    try { withLock(root, () => recordRuleLog(root, out.ruling, out.ruleRatification, out.ruleLog)); } catch (e) { warn.push(`note: what became of ${out.ruling} in the rule's log was not recorded in the loop: ${e.message}`); }
  }
  if (out.typeLog?.state === 'failed') warn.push(`note: ${out.ruling} stays a ruling of this loop; write it by hand in ${out.typeLog.repo}: ${out.typeLog.retry} (add --supersedes and the date and time of the decision it replaces, or --adds, when yg lists decisions in force)`);
  if (out.ruleLog?.state === 'failed') warn.push(`note: rule ${out.ruleRatification.rule} is not ratified in its own log; write it by hand in ${out.ruleLog.repo}: ${out.ruleLog.retry}`);
  return `answered a-${out.id}${out.chose ? ` · chose ${out.chose}` : ''}${out.issue ? ` · written into ${out.issue}` : ''}${out.verdict ? ` · ${out.ruling} ${out.verdict}${renderTypeLog(out.typeLog)}${renderRuleLog(out.ruleRatification, out.ruleLog)}` : ''}`;
}

// What the command says of a question it asked: a question with options prints them, ready for the choice window.
function askText(out) {
  if (out.kind === 'ratify') return `filed a-${out.id} for ratification · blocks nothing`;
  if (!out.options) return `asked a-${out.id}`;
  return [`asked a-${out.id}`, out.question, ...out.options.map((o) => `- ${o.label}: ${o.effect}`), 'answer with --option <option>, or in your own words'].join('\n');
}

// The notes a decide says on stderr: the owner's word with no question in the record behind it, and the open issues that name the
// ruling a supersession replaces, so the jarl rewrites them now.
function decideNotes(root, slug, by, flags, warn) {
  if (by === 'owner' && !questionFor(root, slug)) warn.push(`note: no question in the record asks about ${slug}: a ruling by the owner with no question behind it is recorded as he gave it`);
  if (flags.supersedes !== undefined) {
    const open = issuesNaming(root, flags.supersedes);
    if (open.length) warn.push(`note: open issues name ${flags.supersedes}: ${open.map((i) => i.id).join(', ')} — rewrite them to ${slug}`);
  }
}

if (isEntry(process.argv[1], fileURLToPath(import.meta.url))) main();
