# The jarl

The role that directs the loop: files, picks, raises workers and reviewers, keeps the merger fed, asks the owner what is theirs, and closes the loop. Read it when you open or resume a loop as the jarl, or when you hand the loop to a reeve.

## Contents

- [The loop](#the-loop): the turn, in order
- [Resuming a loop](#resuming-a-loop): where a new session finds what it needs
- [Filing an issue](#filing-an-issue): the body in the call that files, issues that wait
- [From research to issues](#from-research-to-issues): `import` and `sources`
- [Templates](#templates): issues filed again and again in one shape, a release checklist
- [What goes to the owner](#what-goes-to-the-owner): asking well, decisions made under a mandate
- [Rulings about an area](#rulings-about-an-area): rulings that reach every file of one type of code
- [Closing the branch](#closing-the-branch): the steps before the feature branch merges to `main`
- [Standing permission to push the feature branch](#standing-permission-to-push-the-feature-branch)
- [Closing a permanent loop](#closing-a-permanent-loop)
- [The reeve: handing the loop down](#the-reeve-handing-the-loop-down): a long-lived assistant that runs the loop
- [Talking to the owner](#talking-to-the-owner)

## The loop

Every turn, in this order:

0. **Continue or archive — once per session.** See First moves in [SKILL.md](../SKILL.md#first-moves): ask the owner once, at the first contact with a loop, never again on each `new` or `evidence` in the same work.
1. **Boot.** `resume` — one command, the whole state, read live (see [Resuming a loop](#resuming-a-loop)). Then `branches` for each repository the in-flight issues name: a worker branch with commits beyond the feature branch is a report, whether or not the worker said so. Open questions come first: the owner may have answered one in the meantime. Read `goal.md` whole, an issue with `show`, or log lines further back only when the section in `resume` is not enough.
2. **File.** Anything anybody saw becomes an issue before anything else happens. Nobody fixes on the
   side. A worker reports what it found; the jarl files it, so numbers never collide.
3. **Pick.** `next` lists what can run now: open issues whose files do not overlap with anything
   in progress, whose **After:** issues are settled and that no open question holds (`next --all` shows the rest and why). Priority first, then whatever unblocks the most.
   An issue marked `(no acceptance yet)` gets its acceptance line first (`body <id> --acceptance`).
   `set <ids> in-progress "<who>" --branch jarl/7-slug --worker <name>` before
   raising the worker — one issue, or a package of small neighbouring ones on one branch (see
   [Packages and leases](repositories.md#packages-and-leases)).
4. **Raise a worker.** One worker per issue or per package, in its own worktree, on branch `jarl/7-slug` (7 the package's first issue) cut from
   the feature branch — every agent that may write anything, a research issue's worker included,
   gets its own worktree (see [Worker branches](worker.md#worker-branches)); only the jarl and the merger work in the main checkout, and read-only readers and
   verifiers need none — on the tier the issue names — its model set explicitly on every spawn, never inherited, and recorded with the lease (`--model`; see [Which model sits where](models.md#which-model-sits-where)) —
   and tell the worker it spawns nothing itself. The brief is in [worker.md](worker.md#the-workers-brief); the output of `show <id>` (the issue's current window, not the whole file) is pasted into it,
   and after three red rounds the takeover block from `round` goes in too, for a fresh worker.
5. **Review.** A worker's report is a hypothesis. Raise a **fresh one-shot reviewer** for every branch, however small: never the worker, never the merger. The discipline, the verdicts and the reviewer's brief are in [reviewer.md](reviewer.md).
6. **Merge.** The merger (see [merger.md](merger.md)) does it: into the feature branch with a merge commit that names
   the issue, then `merged <id> --sha <merge sha> --ran "<check>" --saw "<what it printed>"`, `set <id> done` (which needs the worker's Proof row), worktree and branch removed. Red check means no merge, a round back to
   the same worker with what failed, and after three rounds an issue about the issue.
7. **Repeat** until nothing is open, then close the branch (see [Closing the branch](#closing-the-branch)). Nothing is written for the next
   session: it boots from `resume`, so keep intent where `resume` reads it (see [Resuming a loop](#resuming-a-loop)).

Testing, stress and research sessions are the same loop with a different mix: some workers produce
issues (they test, they probe, they read) while others take issues down. The stream never waits for
the other side.

## Resuming a loop

There is no handoff file to write. Everything a new session needs is already in the loop's own files — the goal, the rulings, the issues with their leases and **After:**, the asks, the log — and in the repositories its issues name, so `resume` reads it all at the moment it is asked: nothing it prints can be stale, and a session that is cut off mid-turn leaves nothing unsaid. It holds no lock and writes nothing, so any role may run it at any time, and it needs no network (`--ci` adds the CI of each pushed tip through `gh`).

What a handoff carries lives where `resume` reads it:

- **What comes next** is the order of the issues: priorities (`prio`) and **After:** (`after`). The next session reads it in the ready list and the waiting list.
- **Why** is a ruling (`decide`, or the owner's `answer`) or the issue's own body (`body --what/--why`). A reason worth keeping is never only in a summary.
- **What is going on in a branch** is the lease (`set in-progress --branch --worker`), the evidence rows and the log line each command writes.
- **What waits on the owner** is an `ask`, never a sentence in prose.

`handoff read` prints the same, followed by the `.jarl/handoff.md` the loop holds, if any, as history; `handoff write` writes nothing.

## Filing an issue

**File the body with the issue.** `new` takes `--where`, `--what`, `--why` and `--acceptance` (one checkable line per flag), so an issue is written whole in the call that files it; `body <id>` fills or replaces them later. None of it is required, but an issue with no acceptance line gives the worker nothing to prove and the reviewer nothing to check. So the tool says so without refusing anything: `next` marks such an issue `(no acceptance yet)`, `status` lists the in-progress ones that have none, and `set done` notes it on stderr, together with an issue that has fewer `--ran`/`--saw` rows than acceptance lines (none included). Fill it (`body <id> --acceptance "…"`) before `set <id> in-progress`.

**An issue that waits on another says so.** `after <id> <ids>` (or `new --after`) records **After:**. `next` never offers it while any of those issues is still open, in progress or deferred, and `status` counts it as waiting, not as open or in flight, so "in flight" keeps meaning that someone is working on it. Do not park a blocked issue in `in-progress`. It is ordering and bookkeeping, not a schedule: no computed plan, no critical path. A ruling that settles issues names them, `decide <slug> "…" --settles <ids>`, and the ruling is written into each one's evidence. Closing the issue is still `set`, and `done` does not count a `Ruling …`, `Dropped:` or `Deferred:` line as evidence of the work.

## From research to issues

A research round leaves a `findings.json` beside its report. `import <findings.json>` files one issue per finding, and each carries **Source:** `<report dir>#<finding id>`. The report directory is dated, so that pair names one finding for good. The directory is the one holding the file, written from the root of its repository (`core/research/2026-09-25-jarl`), or given with `--source <dir>`. Import is idempotent. A finding whose Source an issue already carries is skipped, so a re-run files nothing twice. A finding named by an issue that has no **Source:** is not filed again either: `import` reports it, and `--adopt` writes the Source onto that issue. "Named" is read narrowly: the issue's title and its What, Why and Acceptance count, a header field never does, and Evidence only under the strictest rule: an id that reads as unique on its own, on an Evidence line that also names the report directory (a package issue's `Source: <report dir>/report.md … Ids: a-b-01, a-b-02`). An id that reads as unique on its own (a dash and at least eight characters, like `jarl-2-B2`) is enough there by itself. A short id (`F1`, `C1`, `2`), or any id from the angles shape, also needs its report named in the same issue: the report directory's name, or the full `<angle>/<id>`. When two issues name it, import reports it as ambiguous and leaves both alone. `--dry-run` prints what it would do, and `--only <ids>` takes part of the file. `--kind`, `--prio`, `--tier`, `--tags`, `--repo` and `--found-by` replace the mapped values for every issue filed.

Three shapes are read: a flat array of findings; an array of angles, each with its findings under `surviving`; and `{ "results": [{ "area", "kept": [...] }] }`. In the angles shape an id is unique only inside its angle, so the key there is always `<angle>/<id>`, with the angle name slugified (`First Hour` → `first-hour`). Every finding needs an id, and a repeated id refuses the whole file. The mapping:

| Issue | From the finding |
|---|---|
| title | `title`, else the first sentence of `claim`, else the id |
| **Kind:** | `kind` when it is one of the loop's kinds; `defect` and `inconsistency` → bug, `risk` and `opportunity` → gap, anything else → bug |
| **Priority:** | `priority`, else `severity`: `blocker`, `critical`, `high` → 1; `medium`, `major`, `important` → 2; `low`, `minor` → 3; 1, 2 or 3 as they are; anything else → 2 |
| **Where:** | `where`, else `surfaces` |
| What | `Claim:` `claim`, `Truth:` `truth`, then `evidence` |
| Why | `impact` or `adopter_impact`, and the finding's `effort` estimate |
| Acceptance | `proposal`, `suggested_fix` or `fix`, as one line starting `Proposed by the finding`. That line is not counted as an acceptance line, so `next` keeps marking the issue until it is rewritten into something checkable. |
| Evidence | nothing. `done` still needs evidence of the work. |

`sources [<findings.json>...]` is the coverage view. Per report it shows the findings, how many were filed, the unfiled ones (when the file is given) and the status of the issues filed from them, with one row per finding. A finding deliberately left unfiled is recorded as a ruling that names it, never as silence. An issue filed by hand from a finding takes `new --source` or `source <id> <dir>#<id>`.

## Templates

An issue that is filed again and again in the same shape — a release phase, a triage of a bug report, a dependency bump — is written once as a template: `.jarl/templates/<name>.md`, an issue file without a number. Its header fields **Kind:**, **Priority:**, **Tier:**, **Tags:** and **Files:** are defaults, and its What, Why, Acceptance and Changelog sections are the body. `new "<title>" --template <name>` files an issue from it; any flag given on the call replaces the template's value, field by field and section by section. The first line is a title and is ignored, unless it is already a field (`**Kind:** process`), which is read as one; a name is letters, digits and `. _ -`. Templates belong to the place, not to one loop: `archive` leaves them in `.jarl/`. In the default mode they are out of git like the rest of the loop, and `close` removes them with it.

A release checklist is issues filed from a template, not a mode. The checklist lives where the release procedure lives (for a family of repositories, in the skill that runs its releases), and the loop files one issue per phase, chained with `--after`, so `next` sequences them and `status` counts them like any other work:

```
# .jarl/templates/release-phase.md
# release phase

**Kind:** process
**Priority:** 1
**Tags:** release

## What
One phase of the release checklist, done in the order the After chain gives.

## Why
A phase skipped here is found by someone who uses it after the tag.

## Acceptance
- every step of the phase is done, with a --ran/--saw row per step
- the phase's own check is green
```

```
jarl_new { title: "Release X · A: freeze and dry run", template: "release-phase", acceptance: ["dry run prints no finding", "every repository's release branch is cut"] }
jarl_new { title: "Release X · B: versions and changelogs", template: "release-phase", after: "301" }
jarl_new { title: "Release X · C: tags and CI", template: "release-phase", after: "302" }
```

Each acceptance line is one step, and `set done` notes a phase closed with fewer `--ran`/`--saw` rows than steps. Nothing here tags, releases or refuses anything; see [What Jarl will not grow](composers.md#what-jarl-will-not-grow).

## What goes to the owner

Decide yourself inside the goal; the cases that stop the loop and go to the owner are listed under the rules that never bend in [SKILL.md](../SKILL.md#the-rules-that-never-bend).

Ask well: where you are, what you found, the options with trade-offs, your recommendation. Never an
open "what should I do". File it with `ask`, keep the rest of the loop moving, and record the answer
with `answer` — it becomes a ruling in `decisions.md`.

**Decided under a mandate.** When the owner has handed the loop a mandate to decide on its own ("decide
and go on, I'll look later") and it decides something that is the owner's (from the list in SKILL.md), the
choice is always filed as `ask --kind ratify [--issue <id>] "<what was decided, and why>"`, never left in
evidence prose. A ratify item blocks nothing: the work goes on, `next` and `done` ignore it. It is
listed in `status` (`to ratify N`, one line each) and under its own heading in `resume` until the
owner answers. `answer` records the answer as a ruling and writes it into the issue's evidence. When the
owner rejects the choice, file the undoing as a new issue.

## Rulings about an area

A ruling that reaches every file of one type of code — every handler, every migration — is not the loop's alone: the next agent touching any other file of that type has to know it, long after the loop is gone. Such a ruling is written with `decide <slug> "<ruling>" --area <type> --reach <n>`: the type as the repository's graph names it, and how many files it holds. When the ruling admits a rule of the graph on that type — the rule stands `advisory` there until the owner admits it — add `--rule <id>`, the rule's id as the graph names it. It works as a ruling of the loop at once; it becomes the type's own only when the owner admits it. The test for `--area` is the owner's: would an agent touching another file of this type need to know it? Only the thick ones pass.

The owner admits them in one batch when the loop closes. `close` files the batch as ratify items — at most 10, widest reach first; the rest wait for the next close — each one sentence of the ruling, its type and the number of files. `close --batch` files it without closing, so the owner can answer before the loop goes: `answer <a-id> "yes"` admits a ruling, `answer <a-id> "reject"` rejects it; the first word decides (`yes`, `ok`, `tak`, … or `reject`, `nie`), anything else is refused. A bare `no` decides nothing — it is English no and colloquial Polish yes — so the word after it decides (`no tak` ratifies, `no nie` rejects), and `no` alone is refused with a request for `tak` or `nie`. The batch never holds the close: a ruling nobody ratified stays a ruling of the loop — kept with a permanent loop, gone with a loop on a branch — and never enters the type's decisions.

A ratified area ruling is written into the type's decision log (`yg log add --type <type>`, from the repository holding the loop) when that repository has a Yggdrasil graph (`.yggdrasil/`) and a working `yg` answers `npx --no-install yg --version`; a ruling that supersedes one written there replaces it there too. Without a graph or a working `yg`, nothing is sent. A write `yg` refuses — an unknown type, or decisions already in force that the new one says nothing about — is reported with the command to run by hand, and the ruling stays in `decisions.md`, marked **Ratified:**. A ratified ruling that names a rule (`--rule`) is also written into that rule's own log as a ratification (`yg log add --aspect <id> --ratify --by <who>`), naming as who admitted it the one the answer named (`answer <a-id> "yes" --by <who>`), else the name git's configuration gives that repository, else "the owner"; Yggdrasil reads the types and the version admitted from the graph — every type the rule reaches, not only the ruling's area, so the batch question for such a ruling says so — and the rule may then stand `enforced` on them without its `type-law-unratified` finding. It is written after the type's decision and independently of it; a rule `yg` does not know, or one no type reaches, is refused and reported with the command to run by hand, and the answer still stands. Entries a graph upgrade recorded for rules already in force name the graph, not a person: they are never the owner's word, and Jarl never skips its write because one is there. This is Jarl's one optional edge to another tool, and its only one. A loop run by a composer — its profile keeps `close` to the record (`lifecycle`), as Horde's mission does — is written into the graph by that composer, with its own code and into the tree it hands over: there `answer` records the verdict and sends nothing, and says so, so no entry is written twice or into a checkout the composer's work never reaches. A composer files its own batch through the record library (`ask` with `kind: 'ratify'` and `ruling: <slug>`), which refuses a ruling that is not an area ruling in force or was asked about already.

## Closing the branch

Before the feature branch merges to `main`, in this order:

1. Every issue is `done` with evidence, or `dropped` or `deferred` with a reason, or listed to the owner as still open.
2. `report` is the material: the repository's changelog carries every user-visible change from it, in the
   register the repository asks for; entries still on issues (see [Changelog fragments](worker.md#changelog-fragments)) are
   printed by `changelog <ids>`.
3. The repository's own check is green on the branch tip.
4. `jarl_close` with `batch` (`close --batch`) puts the area rulings to the owner (see [Rulings about an area](#rulings-about-an-area)); answer what they answer, and go on either way.
5. `jarl_close` removes `.jarl/` — it refuses while anything is still open or deferred: `archive "<slug>"` keeps the deferred work under `.jarl/archive/`, and `close --force` removes the loop with it and keeps no copy. In the committed mode
   that removal is the last commit, so `main` never carries the directory; for that reason `close` also
   refuses while `.jarl/archive/` holds anything (move it out of the tree, or pass `--force`, which
   removes the whole directory). In the default mode there is nothing to commit — git never saw it —
   and `close` leaves `.jarl/archive/` in place.

Merging and pushing are the owner's word, never yours.

## Standing permission to push the feature branch

Some loops have that word already, for good: the owner has said the loop commits and pushes the
feature branch as it goes (a release loop that keeps `release/<version>` on the remote, say). That
permission is a rule of the loop, so it is written where the loop's rules live: a line in `goal.md`'s
rules, or a ruling in `decisions.md` quoting the owner's words, naming the branch it covers. With it
on file, the merger's brief says so: after a green merge into the feature branch, push that branch.
A worker's branch `jarl/7-slug` is never pushed, with or without it, and nothing beyond the
feature branch is covered by it. Without such a line, a push is still the owner's word each time.

## Closing a permanent loop

A loop opened with `init --permanent` has no feature branch to close, so this section applies with
one difference, at step 5: nothing above it changes — every issue still needs to be `done` or
`dropped` before closing, `report` still feeds the changelog, the repository's own check still needs
to be green. But `jarl_close` in this mode never removes `.jarl/`: it refuses exactly as above
while anything is open or in progress, and once clean it appends a closing line to `log.md` and
leaves the directory in place — the record `--root` named stays where it was, for the next release,
or the next session, to read.

## The reeve: handing the loop down

The jarl's context is spent best on the owner and on judgement, so once the loop is open the
jarl raises **one long-lived reeve** on the standard tier and hands it the loop. The reeve runs
this skill exactly as the jarl would — boot, file, pick, raise workers and reviewers, keep the
merger fed — with one difference: it never talks to the owner. It reports to the
jarl, in one line, on four occasions only: a research issue or a gap the goal did not foresee; a
question the owner answered in a way that changes the goal; every few merges, the counts; and an
empty queue. The jarl stays the one who answers the owner and rules on what the reeve raises.
Everything the reeve raises is its own to reach — a worker, a reviewer, a merger — so the reeve
holds all of them and the jarl holds the reeve. Its brief is this whole skill, plus the repository,
the feature branch, the absolute path of the script for a session without the jarl tools, and the four occasions above.

A merger's report is the only signal that it has stopped touching the main checkout — not a delay,
not an assumption that it "must be done by now", not a status the loop tracks some other way. The
main checkout has exactly one writer at a time: while a merger's report is outstanding, nobody —
not the reeve, not the jarl — runs a git command there or treats its work as settled, and no second
merger is raised into it. A reeve that reconciles state by hand while a merger might still be
running is writing into a tree another process is also writing into; that is the collision the
sole-committer rule exists to prevent, and it has produced a rewritten HEAD in practice, not just
in theory.

The reeve does not guess which mode it is in. At boot, before raising anything, it checks whether
it can itself raise agents — a spawn tool in its own reach, or one real attempt on its first worker.
If it can, it holds every worker, reviewer and merger itself, exactly as above. If it cannot, it
reports `no-spawn` to the jarl in one line and the relay below begins for the rest of the loop.

On a platform where an agent raised by the jarl cannot raise agents of its own, the split stays and
only the spawning moves: the reeve writes every brief to a file and sends the jarl one line per
spawn (`spawn <role> <id> tier=… worktree=… brief=<path>`); the jarl spawns from that line without
reading the brief; every raised agent writes its report to a file and ends with one line naming it;
the jarl forwards that one line to the reeve. A second round for the same worker, or feeding the
merger again, is a resume, not a new spawn — the reeve sends `resume <id> brief=<path>` instead, and
the jarl resumes that same agent without reading the brief. The jarl's context then carries
pointers, not briefs and reports.

## Talking to the owner

One sentence of state at boot: how many open, how many in flight, what you do first. "How is it going"
gets an assessment, not a list. Plain words, no internal names; the owner reads what happened, not how
the loop works.
