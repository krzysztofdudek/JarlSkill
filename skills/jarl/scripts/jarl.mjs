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
  need, resetCaches, withLock, readText, isEntry, cmdSet, cmdField, setRouteOf, eachIssue, cmdRound,
  cmdProfile, cmdArchive, cmdList, cmdNext, renderNext, cmdMode, cmdClose, cmdCheck, cmdBranches, cmdTips, cmdQueue,
  cmdChangelog, cmdHandoffRead, cmdHandoffWrite, cmdReport, cmdImport, cmdSources, cmdAnswerMany, cmdModels, renderModels,
  issuesNaming, questionFor, cmdGoal, cmdGoalSet, cmdRepoBase, whereOf, cmdVerify, renderVerify, renderCheckNotes,
  renderProfile, renderTips, renderQueue, renderResume, renderStatus, renderImport, renderSources, renderList, recordTypeLog, recordRuleLog,
  runDecisionsDriver, mergeFlags, describeNew, renderNewReply, issueView, attachmentStates, evidenceTable, renderBranches, renderDecide, renderDecisions,
  cmdNextAs, renderNextAs, askerSection, cmdTick, withWriter, editorOf, needFormat, formatState, readProfileFile, FORMAT_LINES, cmdRenumber,
} from './jarl-lib.mjs';
import { writeAreaDecision, writeRuleRatification } from './yg-edge.mjs';

export * from './jarl-lib.mjs';

export const USAGE = `usage: jarl.mjs <command> [options]
       jarl.mjs --version                        the version of this install, the one the MCP server reports

commands:
  init "<goal>" [--committed] [--permanent] [--profile <file>] [--by who]
                                                 create .jarl/ with the goal; by default it also writes .jarl/.gitignore
                                                 (* and **/*) so git never sees the loop, and every role working
                                                 outside the loop root passes --root <loop root>;
                                                 --committed ignores only the write lock and temporary files: the loop
                                                 is committed with the work; --permanent is committed too, marks it with
                                                 .jarl/.permanent, and is not tied to a feature branch: close (below)
                                                 keeps the directory instead of removing it; --profile checks the
                                                 profile file (see profile below) and stores it as .jarl/profile.json
  new "<title>" [--kind k] [--prio 1|2|3] [--tier light|standard|strong] [--tags a,b] [--files p,q] [--repo <name|path>] [--found-by who]
      [--where "<w>"] [--what "<w>"] [--why "<w>"] [--acceptance "<line>"]... [--changelog "<entry>"]...
      [--source <dir>#<id>,...] [--after <ids>] [--template <name>] [--field "<Name>=<value>"]... [--section "<Heading>=<text>"]...
      [--person "<name>" --check-when "<when>"] [--by who]
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
                                                 dropped), Source (<dir>#<id>), Where, Resources (the exclusive resources
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
  base <name> <branch> [--by who]                the base branch a declared repository is held against, changed
                                                 with a log line that says what it was (a repository is declared
                                                 when an issue first names it; see --repo below)
  import <findings.json> [--source <dir>] [--kind k] [--prio 1|2|3] [--tier t] [--tags a,b] [--repo <name|path>]
      [--found-by who] [--only <finding ids>] [--adopt] [--dry-run] [--field "<Name>=<value>"]... [--by who]
                                                 one issue per finding, with Source: <dir>#<finding id>; a finding
                                                 whose Source is already on an issue is skipped, so a re-run files
                                                 nothing twice; --dry-run prints what it would file; --adopt writes
                                                 Source onto an existing issue that names the finding id but has none;
                                                 --tags, --repo and --only repeat, or take a comma list
  sources [<findings.json>...] [--source <dir>]  per report: its findings, the issues filed from them and their
                                                 status; with a findings file, the findings nobody filed too
  evidence <ids> "<text>" | --ran "<command>" --saw "<what it printed>" | <id> --file <path> --slot <name> [--by who]
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
  list [--status s] [--kind k] [--tag t] [--prio p] [--grep re] [--match "<field>=<value>"]... [--all]
                                                 the issues not finished (open and in-progress) by default; --all for
                                                 every status; --match keeps those whose header field holds the value
  show <id> [--full]                             print one issue as the done gate sees it: the header, What, Why,
                                                 Acceptance and Changelog, every Proof row (numbered [n]) and every
                                                 verdict in the done gate's window, Notes whole, every "changes" finding no later
                                                 approve answered, one line per round that came before; --full prints the whole
                                                 file; --json is complete; under the header, one line for each header
                                                 field that disagrees with the log (see status), where each repository
                                                 written as a name is on this machine and the worktree git has on the
                                                 lease's branch (--json carries them as where)
  set <ids> <status> "<text>" [--branch <b>] [--worker <name>] [--model <m>] [--worktree <path>] [--handover] [--header] [--by who]
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
                                                 was raised on, as the platform names it (with @<effort> where it has that
                                                 lever), stored as given; --worktree is a check and records nothing: a path
                                                 that exists must be a worktree of a repository of the issue with the
                                                 lease's branch checked out, and the worktree of a lease is found through
                                                 its branch; leaving in-progress removes Worker, Model, Since (and a
                                                 Worktree field a lease holds) and keeps Branch; done notes a merge
                                                 whose CI is not green yet; done needs, inside one window (rows after
                                                 the last start, reopen or filing; approves after those or a red
                                                 round), a --ran/--saw row — a free-text note never counts alone —
                                                 and a live approve, and the owner's tick of every acceptance line only he
                                                 ticks (see tick)
  merged <ids> --sha <sha> [--ran "<check>" --saw "<summary>" | --red <id>] [--ci pending|green|red|none] [--repo <name|path>] [--keep] [--by who] | <ids> --ci <state>
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
                                                 --keep skips it
  next [--limit n] [--all] [--as <who>] [--slice <coordinator>]
                                                 the open issues ready to start: no file shared with an in-progress one, every
                                                 After issue done or dropped, no open stuck or stop question on it; a file is
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
                                                 merged; the jarl the close, and a ruling that
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
  review <ids> approve|changes --by <reviewer> [--model <m>] [--relayed] "<text>"
                                                 the reviewer's verdict; --model is the model the reviewer was raised on
                                                 (stored as given); --relayed marks a verdict recorded by someone else in
                                                 the reviewer's name, for a reviewer that cannot be resumed to record its
                                                 own; --by is required, recorded with its kind
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
                                                 <path, link or artifact> · check: <what to check>" (new and field refuse a
                                                 line so marked that names no material or nothing to check, and its first
                                                 write raises the record format to 3); done refuses while such a line is
                                                 not ticked; tick refuses a name other than the owner's, and a line whose
                                                 material is not there yet: no --ran/--saw row after the work was started or
                                                 sent back, or, for a path, no file under the loop's root, the issue's
                                                 repositories or its worktree; it writes one log line that holds the line
                                                 as written, so a line rewritten after it waits for a new tick, and a red
                                                 round, a start or a reopen spends it as it spends an approve
  models [--group repo|tag] [--with <root>]... [--archives]
                                                 read-only: per model as worker and as reviewer, per Kind · Tier, what the
                                                 record holds (units, clean first passes, changes, rounds, verdicts, checked
                                                 approves), every count with its n and a share only from n >= 5, with the
                                                 words fits, below, new and may clear; work with no recorded model
                                                 is grouped by tier; --group slices by repository or tag; --with reads another
                                                 loop (its root, or an archive directory) and --archives this loop's own
                                                 archives, merged into one table that names the loops it read; a path that
                                                 is not a loop is refused; suggestions only, no lock, nothing written
  scope [<id>] --branch <b> [--base <feature-branch>] [--repo <name|path>]
                                                 commits beyond the base, diff inside the declared files, and the
                                                 change in test files and assertions — numbers, never a verdict;
                                                 notes for the added lines that name a loop issue by its number after
                                                 the word issue or with a hash sign (at most 20 printed, the rest
                                                 counted), which never change ok; a branch no issue records is refused
                                                 with its commit count;
                                                 read in --repo, else the issue's Repo, else the loop's own repository;
                                                 with no id, the diff is bounded by the union of Files of every issue
                                                 that records Branch <b> (a package on one branch, one call)
  branches [--base <feature-branch>] [--repo <name|path>] [--stale-hours n]
                                                 every jarl/7-* branch and every branch an issue records: the
                                                 issues on it, commits beyond the base, worktree state, STALE leases
                                                 (worktree gone, branch gone, idle over n hours, default 6) and
                                                 DONE → delete, NO ISSUE for commits no issue holds; shown only, never
                                                 acted on; read in --repo alone, else in the loop's own
                                                 repository, every repository an open or in-progress issue
                                                 names and every one where an issue not dropped records a Branch
  ask "<text>" [--kind stop|stuck|lower|charter|ratify|escalation|rule] [--target x] [--issue 7] [--slice <coordinator>] [--option "<label>: <effect>"]... [--applies-to "<selectors>" [--until <date|id>] [--to owner]] [--by who]
                                                 a question the owner has to answer; lower needs --target;
                                                 escalation is a coordinator's question to the jarl, who holds it:
                                                 it names its --slice or its --issue (or both), shows on next --as
                                                 jarl and in that slice's views, holds its issue back as stuck does,
                                                 and is answered by the jarl (answer with no --by records the jarl);
                                                 listed at boot until answered; ratify is a choice already made
                                                 under a mandate, awaiting the owner's word, and blocks nothing;
                                                 rule proposes the question's text as a rule with the scope of
                                                 --applies-to (as decide takes it), held by the jarl, or by the owner
                                                 with --to owner, and answered yes, which makes it a rule in force, or reject;
                                                 --option gives the choices, at least two, repeated for each one:
                                                 the question prints with its options for the choice window
  answer <ids> "<text>" | --option <label> [--by who]
                                                 records the answer as a ruling and closes the question: the option
                                                 chosen, marked in the ruling's list of options, or the answer in the
                                                 person's own words; --by records who answered (default owner; the jarl on an escalation) and
                                                 is required on a ratify item, which names no coordinator of the loop;
                                                 several ratify items as a comma list take one answer, one ruling each,
                                                 each naming the batch it was answered in; on a ratify item whose
                                                 ruling names a rule, the rule's ratification names who answered
  resume [--log n] [--ready n] [--ci] [--as <who>] [--slice <coordinator>]
                                                 read-only, the boot: everything a session picks the loop up from,
                                                 assembled live — goal and counts, rulings in force, in flight with
                                                 leases (and stale ones), waiting on After, questions, ratify items,
                                                 the next ready issues (n, default 10), the merge queue, merges with
                                                 CI pending or red, the tips of every repository the issues name,
                                                 loop files not committed, and the last log lines (n, default 15);
                                                 no network unless --ci asks gh for the CI of each pushed tip;
                                                 --as <who> ends it with what next --as <who> prints; --slice
                                                 <coordinator> keeps in flight, waiting, the questions, held and next
                                                 ready to that coordinator's slice, and the rulings, the merge queue,
                                                 the tips and the log whole
  log "<text>" [--by who]                       append one dated note to the journal; a line that reads as a filing, a move,
                                                 a round, a verdict, a retraction, an evidence row, a merge, a CI state or
                                                 a body change is refused, and the refusal names the command that writes it
  decide <slug> "<text>" [--by who [--quote "<words>"]] [--under <slug>] [--supersedes <slug>] [--settles <ids>] [--applies-to "<selectors>" [--until <date|id>]] [--area <type> [--reach n] [--rule <id>]]
                                                 append a ruling (slug: letters, digits, . _ -); refuses a duplicate slug;
                                                 --by records who ruled (the coordinator when it is left out; a name that
                                                 reads as owner is owner); --by owner needs --quote, his own words, kept as
                                                 the ruling's last line, and no other text of the record may hold
                                                 "The owner's words:" in any spelling; --under names the ruling in force a ruling
                                                 by the jarl or a coordinator rests on, kept as the text's last paragraph
                                                 "Made under: <slug>", shown with the ruling by decisions and with a rule by the views; --supersedes marks
                                                 the ruling it replaces "Superseded by" in place; --settles writes the ruling,
                                                 with who ruled, into each named issue's evidence (its status is unchanged); --applies-to makes it
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
  goal --set "<machine line>" [--by who]         one machine line of the goal set, with a log line that says what it
                                                 was and what it is: "Check (<repository>): <command>" or a bare
                                                 "Check: <command>", "Model (<tier>): <models>" (a tier the profile
                                                 declares), "Coordinators: <names>" (each name a coordinator, which runs the slice of
                                                 the issues tagged slice:<name>), "Merger: <name>" (the jarl or one
                                                 coordinator: the one holder that raises the merger, one merge at a time
                                                 for every slice), "Takeover (<kind>): <rounds>" or a bare "Takeover: <rounds>"; the rest of goal.md stays as written
  status [--stale-hours n] [--group repo|tag|kind|prio|<field>] [--tag <t>] [--as <who>] [--slice <coordinator>]
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
  archive "<slug>" [--by who]                    put the current loop away under .jarl/archive/<yyyy.mm.dd>-<slug>/,
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
  tips                                           read-only: per repository the loop's issues name (open, in progress,
                                                 recently merged), the tip of each worker branch in flight, the feature
                                                 branch the checkout is on and main, ahead/behind their upstream as last fetched, and — when
                                                 gh is on PATH — the CI of a tip its upstream holds (else "not pushed");
                                                 nothing is fetched or written
  queue [--repo <name|path>] [--base <b>]        read-only: the branches waiting for the merger — an open or in-progress
                                                 issue on it holds a live approve and the branch is ahead of its base —
                                                 in the order they were approved, per repository, cut into batches whose
                                                 declared files do not overlap; it runs no check and refuses nothing
  changelog <ids> [--repo <name|path>]           print the issues' ## Changelog entries grouped by section (Added,
                                                 Changed, Deprecated, Removed, Fixed, Security), ready to paste under
                                                 [Unreleased]; per repository when they span several; reads only
  mode permanent [--by who]                      switch an existing committed loop to the permanent mode, with a
                                                 log line; refuses a default-mode loop (out of git — a permanent
                                                 record must be committed) and an already-permanent one
  profile [<file>]                               read-only: the loop's profile — its statuses and what each one means
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

options: --json  --help  --root <loop root>   (the directory holding .jarl/; without it the loop at the root of the
         current checkout, or of its main checkout from a worktree: never one in a subdirectory)

The list of what only the command line does, next to the record library, is in the skill: references/composers.md, section "What only the command line does".

git merges (not loop commands: no --root, no lock, no tool of the MCP server):
  merge-driver decisions <base> <ours> <theirs>  the driver git runs for .jarl/decisions.md (%O %A %B): the rulings of
                                                 both sides block by block, written over <ours>, exit 0; conflict
                                                 markers and exit 1 for a ruling both sides superseded, a slug both
                                                 sides added, a ruling both sides rewrote; .jarl/log.md merges by union
  merge-driver flags [--yg "<yg command>"]       the -c settings a merger puts between git and merge on every merge,
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

Lists (the <ids> above; new's --tags, --files, --repo, --source, --after; import's --tags, --repo, --only;
decide's --settles; the value field gives Tags, Files, Repo, After and Source): one item, or several as one
comma list (a,b); a list flag also repeats; a tool takes the same text or a list of strings, one item each.
An item that starts with - is refused (it is a flag in the wrong place). A list written as text is refused:
an item that begins or ends with a quote mark, a name (an id, a tag, a reference, a finding id) that holds
a bracket or a quote, and a path whose brackets do not pair up ([a, b]) or that is a quoted or empty list
in brackets (["a"], []). A path whose brackets pair up is a name: [1], src/[id]/page.tsx, [...slug].

--by who, on every command that writes and on no other, is the author of that one call. On field it is who changed
the description, on review the reviewer, on answer, decide, retract and tick who answered, ruled, retracted or
ticked; on the rest (init, new, import, evidence, set, merged, round, ask, log, goal, base, archive, mode, close,
renumber) it is the writer, written into every log line the call writes, right after the stamp ("- <stamp> by <who>
· ..."); the first such line raises the loop's record format to 3, and where a composer keeps the format the call is
refused with nothing written. Nothing names an author for a call that names none: no server, variable or other call
does, and an unnamed lease shows as "(unnamed)" in a loop whose goal names coordinators. Grouping is --group (status,
models), and --kind is the kind of what a command files or filters.

Writes: every command that writes holds .jarl/.lock while it runs (the holder's pid, host and time are
inside), so parallel calls from workers, reviewers and the merger queue instead of losing each other's
writes; a lock whose holder is gone is taken over, a live one that does not let go within 20 s fails the
call with nothing written. Files are replaced whole, never half-written.

--repo <name|path>: another repository, for a loop that keeps its issues in one repository while its
workers change another: its name (the directory git clone gives it), its checkout, a worktree of it or a
file inside it, always reduced to its main checkout. Branches, the base (that checkout's current
branch), diffs and assertions are then read there. A name resolves to the sibling of the loop's main
checkout (<parent>/<name>); on a machine laid out differently, a symlink beside the loop's checkout
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

Parallel workers in worktrees:
  - Default mode: the loop is out of git and lives in the loop root (the directory that holds .jarl/), so every call, a worker's and the coordinator's, passes --root <loop root>.
  - Committed mode: the merger alone commits .jarl/, and a worker never does.
  - Filing: the coordinator files the issues; a worker reports what it found, or files with --root <loop root>.
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
    only: 'many', adopt: 'bool', 'dry-run': 'bool', field: 'many', by: 'value',
  },
  sources: { source: 'value' },
  evidence: { ran: 'many', saw: 'many', file: 'value', slot: 'value', by: 'value' },
  retract: { by: 'value' }, field: { add: 'bool', remove: 'bool', clear: 'bool', by: 'value' }, base: { by: 'value' },
  list: { status: 'value', kind: 'value', tag: 'value', prio: 'value', grep: 'value', match: 'many', all: 'bool' },
  show: { full: 'bool' }, set: { branch: 'value', worker: 'value', model: 'value', worktree: 'value', handover: 'bool', header: 'bool', by: 'value' },
  next: { limit: 'value', all: 'bool', as: 'value', slice: 'value' },
  review: { by: 'value', model: 'value', relayed: 'bool' }, round: { findings: 'value', by: 'value' }, tick: { by: 'value' },
  models: { group: 'value', with: 'many', archives: 'bool' },
  scope: { branch: 'value', base: 'value', repo: 'value' },
  branches: { base: 'value', repo: 'value', 'stale-hours': 'value' },
  merged: { sha: 'value', ci: 'value', repo: 'value', ran: 'many', saw: 'many', red: 'value', keep: 'bool', by: 'value' },
  ask: { kind: 'value', target: 'value', issue: 'value', slice: 'value', option: 'many', 'applies-to': 'value', until: 'value', to: 'value', by: 'value' },
  answer: { by: 'value', option: 'value' },
  resume: { log: 'value', ready: 'value', ci: 'bool', as: 'value', slice: 'value' },
  handoff: { summary: 'value', next: 'many', log: 'value', ready: 'value', ci: 'bool' },
  log: { by: 'value' }, decide: { settles: 'many', by: 'value', quote: 'value', under: 'value', supersedes: 'value', 'applies-to': 'value', until: 'value', area: 'value', reach: 'value', rule: 'value' }, decisions: { live: 'bool' },
  goal: { set: 'value', by: 'value' },
  status: { 'stale-hours': 'value', group: 'value', tag: 'value', as: 'value', slice: 'value' }, archive: { by: 'value' }, report: { found: 'bool', metrics: 'bool' }, tips: {}, mode: { by: 'value' },
  queue: { repo: 'value', base: 'value' }, changelog: { repo: 'value' },
  close: { force: 'bool', batch: 'bool', by: 'value' }, profile: {}, verify: {},
};

// The commands the command line runs and the tool list leaves out: no tool, and no block in the usage text.
export const INTERNAL_COMMANDS = Object.freeze(['handoff']);
export const flagsOf = (cmd) => ({ ...(COMMAND_FLAGS[cmd] || {}) });
// A flag one command does not take because its meaning is another flag's, or another command's: the refusal is the call
// that does what was asked, built from the words given so far. --by names the author of a write and nothing else.
const REFUSED_FLAGS = {
  status: { by: (value) => `status groups its counts with --group, and --by names the author of a write: jarl.mjs status --group ${value ?? 'repo'}` },
  models: { by: (value) => `models groups its counts with --group, and --by names the author of a write: jarl.mjs models --group ${value ?? 'repo'}` },
  evidence: { retract: (value, positional) => `evidence takes nothing back: a row or a note is taken back with jarl.mjs retract ${positional[1] ?? '<id>'} ${value ?? '<n>'} --by <who> "<text>"` },
};

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  let cmd;
  let rest = false;
  const table = () => ({ ...GLOBAL_FLAGS, ...flagsOf(cmd) });
  const named = (t) => Object.keys(t).map((k) => `--${k}`).join(', ');
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (rest || !a.startsWith('--') || a.length === 2) {
      if (a === '--' && !rest) { rest = true; continue; }
      positional.push(a);
      if (cmd === undefined) {
        cmd = a;
        if (Object.hasOwn(REPLACED_COMMANDS, cmd)) throw new Error(replacedRefusal(cmd, argv.slice(i + 1)));
        need(COMMAND_FLAGS[cmd], `unknown command: ${cmd}\n${USAGE}`);
      }
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    const inline = eq === -1 ? undefined : a.slice(eq + 1);
    const t = table();
    const kind = Object.hasOwn(t, name) ? t[name] : undefined;
    if (kind === undefined) {
      const refused = cmd !== undefined && REFUSED_FLAGS[cmd]?.[name];
      if (refused) throw new Error(refused(inline ?? (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined), positional));
      const where = cmd === undefined ? `before the command — only ${named(GLOBAL_FLAGS)} may come before it` : `for ${cmd} — it takes ${named(t)}`;
      throw new Error(`unknown flag ${a} ${where}. A value that starts with -- goes after a bare --, e.g. evidence 7 -- "--json prints ok"`);
    }
    if (kind === 'bool') {
      need(inline === undefined, `--${name} takes no value`);
      flags[name] = true;
      continue;
    }
    let value = inline;
    if (value === undefined) {
      need(i + 1 < argv.length, `--${name} needs a value`);
      value = argv[i + 1];
      i += 1;
    }
    if (kind === 'many') flags[name] = flags[name] === undefined ? value : [].concat(flags[name], value);
    else {
      need(flags[name] === undefined, `--${name} given twice — it takes one value`);
      flags[name] = value;
    }
  }
  // Words beyond what the command reads are an error, not dropped: after a bare -- that is also where a
  // --root written last would land, and a call that silently lost its --root would write to another loop.
  if (cmd !== undefined && Object.hasOwn(ARITY, cmd)) {
    const extra = positional.slice(1 + ARITY[cmd]);
    need(extra.length === 0, `${cmd} takes at most ${ARITY[cmd]} argument${ARITY[cmd] === 1 ? '' : 's'} — unexpected: ${extra.map((x) => JSON.stringify(x)).join(' ')}${rest ? ' (everything after a bare -- is an argument, so flags such as --root go before it)' : ''}; several ids are one argument: 12,13 or 203-206`);
  }
  return { positional, flags };
}
// The arguments each command reads after its name, in order, named: the MCP server (jarl-mcp.mjs) turns each
// name into a field of that command's tool, so this table and COMMAND_FLAGS are the one source of both the
// CLI and the tools. A name ending in ? may be left out; one ending in ... takes any number of words (tag's
// +a -b, sources' findings files) and has no upper bound. A command's arity is how many names it has.
export const COMMAND_ARGS = {
  init: ['goal'], new: ['title'], renumber: ['id'], import: ['file'], sources: ['files...'],
  evidence: ['ids', 'text?'], retract: ['id', 'entry', 'text'], field: ['ids', 'name', 'value?'], base: ['name', 'branch'],
  list: [], show: ['id'], set: ['ids', 'status', 'text?'],
  merged: ['ids'],
  next: [], review: ['ids', 'verdict', 'text'], round: ['id', 'text'], tick: ['id', 'line'], models: [], scope: ['id?'], branches: [],
  ask: ['text'], answer: ['id', 'text?'], resume: [], handoff: ['action?'], log: ['text'],
  decide: ['slug', 'text'], decisions: [], goal: [], status: [], archive: ['slug'], report: [], tips: [], queue: [],
  changelog: ['ids'], mode: ['mode'], close: [], profile: ['file?'], verify: [],
};
// One sentence per command: what it does, the MCP tool's whole description after "WRITES the loop." or "Read-only.".
// The rest of what a command takes and does is its block of USAGE, which the jarl_help tool and --help print.
export const COMMAND_SUMMARY = {
  init: 'Open a loop: create .jarl/ with the goal, out of git by default, committed or permanent when asked.',
  new: 'File an issue under the next free number, with its fields and its What, Why and Acceptance; a promise (kind promise) or a wait on an outside person (kind wait, with person and check-when).',
  renumber: 'Give a free number to one of the issue files that carry one number after a merge, the one with the key named, keeping every line of the log written about it.',
  import: 'File one issue per finding of a findings file, skipping findings already filed.',
  sources: 'Per findings report: its findings, the issues filed from them and their status.',
  evidence: 'Append a free-text note, or checkable rows of what ran and what it printed, to issues; or record a file as an attachment of a slot (--file, --slot).',
  retract: 'Take back the newest approve of an issue (entry: review), one evidence row by its number (entry: the number) or one evidence note (entry: note-<n>), by an entry that says who and why.',
  field: 'Change one part of the description of issues, a header field (Title, Priority, Tags, Files, After and the rest) or a section (What, Why, Acceptance, Changelog): a value replaces it, add and remove change the items of a list or add to a section, clear empties it; each change logs what the part held and who changed it when named.',
  base: 'Change the base branch a declared repository is held against, logging what it was.',
  list: 'List the issues, the unfinished ones by default, filtered by status, kind, tag, priority or a field.',
  show: 'Print one issue as the done gate sees it (its current window, rows numbered), or the whole file with --full.',
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
  answer: 'Record the owner\'s answer to a question, the option chosen or the words given, as a ruling and close the question; several ratify items take one answer.',
  resume: 'The boot: everything a session picks the loop up from, assembled live; as ends it with what is on the one who asks.',
  handoff: 'read: resume, then the handoff file the loop holds, if any; write: writes nothing.',
  log: 'Append one dated note to the loop\'s journal; a line that reads as a move, a verdict or another line of state is refused.',
  decide: 'Append a ruling, optionally superseding one, settling issues or covering an area of code.',
  decisions: 'The rulings with who ruled and what superseded them.',
  goal: 'The goal as goal.md holds it, or one machine line of it set (Check, Model, Coordinators or Takeover), with a log line that says what it was and what it is now.',
  status: 'The goal, the counts by status, the reviews, stale leases and what awaits ratification; as ends it with what is on the one who asks.',
  archive: 'Put the current loop away under .jarl/archive/ so a new one can open here.',
  report: 'What was done, dropped, deferred and still open, ready for the changelog, with the loop metrics first; set metrics for the metrics alone.',
  tips: 'Per repository the loop names: the tips of worker, feature and main branches, ahead/behind and CI; fetches nothing.',
  queue: 'The branches waiting for the merger, in approval order, cut into batches whose files do not overlap.',
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
  decide: { settles: 'name' },
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
  need(dashed.length === 0, `${field}: an item cannot start with - — got ${dashed.map((s) => JSON.stringify(s)).join(' ')} (everything after a bare -- is an argument, so flags such as --root go before it)`);
  need(!items.some((s) => piecesOfListText(s, kind)), `${field} takes its items one by one: one item, a comma list (a,b) or a list of strings; ${kind === 'name' ? 'a list written as text, an item in quotes or a name holding a bracket or a quote mark' : 'a list written as text or an item in quotes'} is refused — got ${JSON.stringify(text)}`);
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

// The value of field for a header field that holds a list (Tags, Files, Repo, After, Source), read by the one rule of a
// list; any other part's value is one text, passed as it is. Items to remove are split at their commas and checked for a
// leading dash only: they match an item as it is stored, so an item stored with brackets or quotes can still be taken off.
const FIELD_LISTS = { tags: 'name', files: 'path', repo: 'path', after: 'name', source: 'name' };
function fieldListValue(name, value, remove) {
  const kind = FIELD_LISTS[String(name ?? '').trim().toLowerCase()];
  if (kind === undefined || value === undefined) return value;
  if (!remove) return listItems(value, kind, String(name).trim()).join(',');
  const items = [].concat(value).map(String).join(',').split(',').map((s) => s.trim()).filter(Boolean);
  need(!items.some((s) => s.startsWith('-')), `${String(name).trim()}: an item cannot start with - (everything after a bare -- is an argument, so flags such as --root go before it)`);
  return items.join(',');
}

// The commands the command line and the tools do not have, each with the call that does what was asked: the refusal is
// one line that ends with that call, built from the words given where they say enough, so nothing is left to guess.
// Every part of an issue's description is written by field, a repository's base by base, and a branch is measured by scope.
const quoted = (v) => (/^[\w.:/#@,+-]+$/.test(String(v)) ? String(v) : JSON.stringify(String(v)));
function wordsOf(args, bools) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith('--') && a.length > 2) {
      const [name, inline] = a.slice(2).split(/=(.*)/s);
      if (bools.includes(name)) flags[name] = true;
      else (flags[name] = flags[name] || []).push(inline ?? args[(i += 1)]);
    } else if (a !== '--') pos.push(a);
  }
  return { pos, flags };
}
const SECTION_FLAGS = { title: 'Title', where: 'Where', what: 'What', why: 'Why', acceptance: 'Acceptance', changelog: 'Changelog' };
// The words of a call without its --root, which the call that replaces it takes as it was given.
const withoutRoot = (args) => args.filter((a, i) => a !== '--root' && args[i - 1] !== '--root' && !a.startsWith('--root='));
export const REPLACED_COMMANDS = Object.freeze({
  check: (args) => `a branch is measured by scope: jarl.mjs scope ${withoutRoot(args).map(quoted).join(' ') || '[<id>] --branch <b>'}`,
  prio: (args) => { const { pos } = wordsOf(args, []); return `the priority is a field: jarl.mjs field ${pos[0] ?? '<ids>'} Priority ${pos[1] ?? '<1|2|3>'}`; },
  tag: (args) => {
    const { pos } = wordsOf(args, []);
    const ids = pos[0] ?? '<ids>';
    const add = pos.slice(1).filter((o) => o.startsWith('+')).map((o) => o.slice(1));
    const remove = pos.slice(1).filter((o) => o.startsWith('-')).map((o) => o.slice(1));
    const calls = [...(remove.length ? [`jarl.mjs field ${ids} Tags --remove ${remove.join(',')}`] : []), ...(add.length ? [`jarl.mjs field ${ids} Tags --add ${add.join(',')}`] : [])];
    return `tags are a field: ${calls.length ? calls.join(', then ') : `jarl.mjs field ${ids} Tags --add <tag> (or --remove <tag>)`}`;
  },
  files: (args) => { const { pos } = wordsOf(args, []); return `the files are a field: jarl.mjs field ${pos[0] ?? '<ids>'} Files ${pos.length > 1 ? quoted(pos.slice(1).join(',')) : '<path>,<path>'}`; },
  source: (args) => { const { pos } = wordsOf(args, []); return `the source is a field: jarl.mjs field ${pos[0] ?? '<ids>'} Source ${pos.length > 1 ? quoted(pos.slice(1).join(',')) : '<dir>#<id>'}`; },
  after: (args) => { const { pos, flags } = wordsOf(args, ['clear']); return `the issues an issue waits on are a field: jarl.mjs field ${pos[0] ?? '<ids>'} After ${flags.clear ? '--clear' : pos.length > 1 ? pos.slice(1).join(',') : '<ids>'}`; },
  repo: (args) => {
    const { pos, flags } = wordsOf(args, ['clear', 'base']);
    if (flags.base) return `a repository's base is changed by base: jarl.mjs base ${pos[0] ?? '<name>'} ${pos[1] ?? '<branch>'}`;
    return `the repository is a field: jarl.mjs field ${pos[0] ?? '<ids>'} Repo ${flags.clear ? '--clear' : pos.length > 1 ? quoted(pos.slice(1).join(',')) : '<name|path>'}`;
  },
  body: (args) => {
    const { pos, flags } = wordsOf(args, ['append']);
    const ids = pos[0] ?? '<ids>';
    const calls = [];
    for (const [flag, part] of Object.entries(SECTION_FLAGS)) {
      const given = flags[flag];
      if (given === undefined) continue;
      calls.push(`jarl.mjs field ${ids} ${part} ${quoted(given.join('\n'))}${flags.append && flag !== 'title' && flag !== 'where' ? ' --add' : ''}`);
    }
    for (const s of flags.section || []) { const at = String(s).indexOf('='); calls.push(`jarl.mjs field ${ids} ${quoted(String(s).slice(0, at))} ${quoted(String(s).slice(at + 1))}${flags.append ? ' --add' : ''}`); }
    return `every part of the description is written by field: ${calls.length ? calls.join(', then ') : `jarl.mjs field ${ids} <part> "<value>" (Title, Where, What, Why, Acceptance, Changelog or a section the profile declares; --add adds to a section)`}`;
  },
});
export const replacedRefusal = (cmd, args = []) => `${cmd} is not a command; ${REPLACED_COMMANDS[cmd](args)}`;

const ARITY = Object.fromEntries(Object.entries(COMMAND_ARGS).filter(([, a]) => !a.some((n) => n.endsWith('...'))).map(([c, a]) => [c, a.length]));

// The commands that write: each runs under .jarl/.lock (see withLock).
export const MUTATING = new Set(['init', 'new', 'renumber', 'import', 'set', 'field', 'base', 'merged', 'evidence', 'retract', 'review', 'round', 'tick', 'ask', 'answer', 'log', 'decide', 'goal', 'archive', 'mode', 'close']);

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
  console.error('usage: jarl.mjs merge-driver decisions <base> <ours> <theirs> | merge-driver flags [--yg "<yg command>"]');
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
    warn.push(`note: that evidence note is long (${rest[1].trim().length} characters, ${rest[1].trim().split('\n').length} lines) and was written whole; only its first line reaches the log, and a note is not a row that can be retracted by number — for proof of work, record it as --ran "<command>" --saw "<what it printed>"`);
  }
  console.log(flags.json ? JSON.stringify(out, null, 2) : text);
  for (const w of warn) console.error(w);
  if ((cmd === 'scope' || cmd === 'verify') && !out.ok) process.exit(2);
}

// The ratification batch as close prints it: one line per item, then what became of the ones nobody answered.
function renderBatch(batch, loop) {
  if (!batch.items.length && !batch.waiting) return loop === 'open' ? 'no area ruling awaits ratification' : '';
  const head = `\nto ratify (${batch.items.length}${batch.waiting ? `, ${batch.waiting} more at the next close` : ''}) — answer each with yes or reject (tak or nie): jarl.mjs answer <a-id> "yes" --by <who answered>`;
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
  return `\nrules of the loop to promote (${p.items.length}) — answer each with one way: jarl.mjs answer <a-id> --option carry|instructions|law|drop --by owner\n${p.items.map((i) => `- ${i.ask} · ${i.question}`).join('\n')}`;
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
export function dispatch(root, commandName, rest, flags) {
  const cmd = commandName;
  if (Object.hasOwn(REPLACED_COMMANDS, cmd)) throw new Error(replacedRefusal(cmd, rest));
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
      case 'show': { const i = R.findIssue(root, rest[0]); need(i, `no such issue: ${rest[0]}`); const attachments = attachmentStates(root, i); out = { ...i, evidenceRows: evidenceTable(i.sections.evidence).rows.map(({ n, ran, saw, retracted }) => ({ n, ran, saw, retracted })), where: whereOf(root, i), ...(attachments.length ? { attachments } : {}) }; text = issueView(root, i, { full: Boolean(flags.full) }); break; }
      case 'set':
        // A field is written by field, never by set: the refusal is the call that writes it.
        if (setRouteOf(root, rest[1]) === 'field') {
          const clearing = rest[2] === undefined || (typeof rest[2] === 'string' && rest[2].trim() === '');
          throw new Error(`${rest[1]} is a field, not a status: jarl.mjs field ${rest[0] ?? '<ids>'} ${/\s/.test(String(rest[1]).trim()) ? `"${String(rest[1]).trim()}"` : rest[1]} ${clearing ? '--clear' : quoted(rest[2])}`);
        }
        out = setCommand(root, rest[0], rest[1], rest[2], flags);
        text = each(out, (o) => (o.header ? `header of ${o.id} rewritten from the log: ${o.status}` : `${o.id} → ${o.status}${o.branch ? ` · ${o.branch}` : ''}${o.worker ? ` · ${o.worker}` : ''}${o.handover ? ' · handed over' : ''}`)); warn = [].concat(out).filter((o) => o.note).map((o) => `note: ${o.id} ${o.note}`); break;
      case 'field':
        out = cmdField(root, rest[0], rest[1], fieldListValue(rest[1], rest[2], flags.remove === true), { ...flags, caller: 'cli' });
        text = each(out, renderField);
        warn = [].concat(out).flatMap((o) => (o.note ? [o.note] : []).concat((o.notes || []).map((n) => `note: ${n}`)));
        break;
      case 'base':
        out = cmdRepoBase(root, rest[0], rest[1]);
        text = out.unchanged ? `${out.name} base: ${out.base} (unchanged)` : `${out.name} base: ${out.base} (was ${out.was ?? 'none'})`;
        break;
      case 'evidence':
        out = R.addEvidence(root, rest[0], rest[1], flags); text = each(out, renderEvidence); break;
      // One verb takes back a verdict and an evidence row: the review's newest approve, or the row by its number.
      case 'retract':
        need(rest[1] === 'review' || /^(note-)?\d+$/.test(rest[1] ?? ''), `retract takes review (the newest approve) or the number of an evidence row, or note-<n> for a note, got "${rest[1] ?? ''}"`);
        if (rest[1] === 'review') { out = R.review(root, rest[0], 'retract', rest[2], { by: flags.by, caller: 'cli' }); text = each(out, renderReview); warn = [].concat(out).filter((o) => o.note).map((o) => `note: ${o.note}`); } else { out = R.addEvidence(root, rest[0], rest[2], { retract: rest[1], by: flags.by }); text = each(out, renderEvidence); }
        break;
      // One computation of the rows: the ready ones are listed, and the rest says how many are held or waiting.
      case 'next': {
        if (flags.as !== undefined) {
          need(flags.limit === undefined, '--limit counts the ready issues of next; next --as prints at most seven lines, and --all every line');
          need(flags.slice === undefined, '--slice scopes next to one coordinator\'s slice; next --as <coordinator> lists what is on that coordinator, its slice included');
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
        if (rest[1] === 'retract') throw new Error(`a verdict is taken back with retract: jarl.mjs retract ${rest[0] ?? '<id>'} review --by ${flags.by ?? '<who>'} ${rest[2] === undefined ? '"<text>"' : JSON.stringify(String(rest[2]))}`);
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
      case 'answer': out = cmdAnswerMany(root, rest[0], rest[1], flags); break;   // text below: the type log is written outside the lock
      case 'resume': out = R.resumeData(root, flags); text = renderResume(out, R.loadProfile(root), pluginVersionNote(), flags.as !== undefined); ({ out, text } = endWithAsker(root, flags, out, text)); break;
      case 'handoff':
        need(rest[0] === undefined || rest[0] === 'read' || rest[0] === 'write', `handoff takes read or write (got "${rest[0]}") — the state is assembled live by resume`);
        if (rest[0] === 'write') { out = cmdHandoffWrite(); text = out.note; } else { out = cmdHandoffRead(root, flags); text = out.text; }
        break;
      case 'report': out = cmdReport(root, flags); text = out.text; break;
      case 'log': out = R.appendLog(root, rest[0]); text = 'logged'; break;
      case 'decide': out = R.decide(root, rest[0], rest[1], flags); text = renderDecide(out); decideNotes(root, rest[0], out.by, flags, warn); break;
      case 'decisions': out = R.decisions(root, flags); text = renderDecisions(out); break;
      case 'goal': out = flags.set === undefined ? cmdGoal(root) : cmdGoalSet(root, flags.set); text = flags.set === undefined ? out.goal : out.unchanged ? `goal line unchanged: ${out.shown}` : `goal line ${out.replaced ? 'changed' : 'added'}: ${out.shown}${out.replaced ? ` (was ${out.was})` : ''}`; break;
      case 'status': out = R.statusData(root, groupedBy(flags)); text = renderStatus(out, R.loadProfile(root)); ({ out, text } = endWithAsker(root, flags, out, text)); break;
      case 'tips': out = cmdTips(root); text = renderTips(out); break;
      case 'queue': out = cmdQueue(root, flags); text = renderQueue(out); break;
      case 'changelog': out = cmdChangelog(root, rest[0], flags); text = out.text || '(no changelog fragment on these issues)'; warn = out.missing.length ? [`note: no changelog fragment: ${out.missing.join(', ')} — record one with: jarl.mjs field <id> Changelog "Added: …"`] : []; break;
      case 'archive': out = cmdArchive(root, rest[0], { caller: 'cli' }); text = `archived → ${out.archived}${out.leftOpen.length ? ` · ${out.leftOpen.length} still open or in progress: ${out.leftOpen.join(', ')}` : ''} · open a new loop with: jarl.mjs init "<goal>"`; break;
      case 'mode': out = cmdMode(root, rest[0]); text = 'now permanent · not tied to a feature branch; close keeps the directory'; break;
      case 'profile': out = cmdProfile(root, rest[0]); text = renderProfile(out); break;
      case 'verify': out = cmdVerify(root); text = renderVerify(out); break;
      case 'close': out = cmdClose(root, { ...flags, caller: 'cli' }); text = out.closed ? (out.kept ? `kept ${out.kept} · closed as a permanent record` : `removed ${out.removed}${out.archiveKept ? ' (the live loop; .jarl/archive/ is left in place)' : out.archiveRemoved ? ` (with .jarl/archive/: ${out.archiveRemoved.join(', ')})` : ''}`) + (out.deferred.length ? ` · ${out.deferred.length} deferred ${out.kept ? 'still waiting' : 'removed with the loop'}: ${out.deferred.join(', ')}` : '') + (out.uncommitted ? ` · ${out.uncommitted} loop file(s) not committed${out.kept ? ' — commit .jarl/' : ' before the removal'}` : '') + renderBatch(out.batch, out.kept ? 'kept' : 'removed') + renderPromotion(out.promotion, out.kept ? 'kept' : 'removed') : (renderBatch(out.batch, 'open') + renderPromotion(out.promotion, 'open')).trimStart(); break;
      default: throw new Error(`unknown command: ${cmd}\n${USAGE}`);
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
  throw new Error(`${line.what} (--by) needs record format ${line.format}, and this loop stays at format ${profile.format}: its profile names an external scheduler (${profile.scheduler}), the composer that reads this record, so Jarl never raises its format; leave --by out there — nothing was written`);
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
const renderReview = (o) => (o.retracted ? `${o.id} review retracted by ${o.by} (${o.kind}): the approve ${o.retracted}` : `${o.id} review ${o.verdict}${o.by ? ` by ${o.by} (${o.kind})` : ''} · acceptance: ${o.acceptance ? o.acceptance.split('\n').join(' / ') : '(none on file)'}${o.next ? ` · next: ${o.next}` : ''}`);

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
  if (out.typeLog?.state === 'failed') warn.push(`note: ${out.ruling} stays a ruling of this loop; write it by hand in ${out.typeLog.repo}: ${out.typeLog.retry} (add --supersedes <datetime> or --adds when yg lists decisions in force)`);
  if (out.ruleLog?.state === 'failed') warn.push(`note: rule ${out.ruleRatification.rule} is not ratified in its own log; write it by hand in ${out.ruleLog.repo}: ${out.ruleLog.retry}`);
  return `answered a-${out.id}${out.chose ? ` · chose ${out.chose}` : ''}${out.issue ? ` · written into ${out.issue}` : ''}${out.verdict ? ` · ${out.ruling} ${out.verdict}${renderTypeLog(out.typeLog)}${renderRuleLog(out.ruleRatification, out.ruleLog)}` : ''}`;
}

// What the command says of a question it asked: a question with options prints them, ready for the choice window.
function askText(out) {
  if (out.kind === 'ratify') return `filed a-${out.id} for ratification · blocks nothing`;
  if (!out.options) return `asked a-${out.id}`;
  return [`asked a-${out.id}`, out.question, ...out.options.map((o) => `- ${o.label}: ${o.effect}`), 'answer with --option <label>, or in your own words'].join('\n');
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
