# The jarl

The director's reference. Read it once when you open or resume a loop as the jarl or run a slice as a coordinator; a raised worker, examiner or merger reads only its brief. Terms: [glossary.md](glossary.md).

## Contents

- [Opening a loop](#opening-a-loop)
- [The loop](#the-loop)
- [Resuming a loop](#resuming-a-loop)
- [Filing](#filing)
- [The shape of the work](#the-shape-of-the-work)
- [Who decides what](#who-decides-what)
- [When something fails](#when-something-fails)
- [Coordinators: slices of the backlog](#coordinators-slices-of-the-backlog)
- [Closing the branch](#closing-the-branch)

## Opening a loop

`init "<goal>" --by <who>` opens it; a `Check: <command>` line in the goal names what decides a landing. Before the first worker run `git status`: a worker sees only what is committed, so commit what lives only in the main checkout's tree or tell the owner it waits, and never hand a worker an issue whose files hold uncommitted changes. A loop works on a feature branch: cut one if the work started on `main`, because a merge to `main` is reserved.

## The loop

Every turn, in order:

1. **Boot.** `resume`, the whole state read live, then `branches` (a worker branch ahead of its base is a report, whether or not the worker said so). Open questions first: the owner may have answered.
2. **File.** Anything anybody saw becomes an issue before anything else happens.
3. **Pick.** `next --as <who>` lists what is on you, each move with its command; `next` lists what can start now.
4. **Lease.** `set <ids> in-progress "<text>" --branch <worker-branch> --worker <name> --model <model-id> --by <who>`, then make its worktree in the repository the work lands in, outside the checkout, on a branch named `jarl/<first-issue>-<slug>` for the lease's first issue: `git worktree add <path> -b <worker-branch> <base-branch>` (`--root` still names the loop: see [Parallel workers](repositories.md#parallel-workers-in-worktrees)). An issue tagged `in-place` writes only its declared files, with no branch (see [Worked in place](commands.md#worked-in-place)).
5. **Raise the worker** with the output of `brief <ids>`, its model set explicitly ([Which model sits where](models.md#which-model-sits-where)). It spawns nothing and reads nothing else.
6. **Examine.** A worker's report is a hypothesis. Raise a fresh one-shot examiner for every branch with `brief <ids> --role reviewer`: never the worker, never the merger. Its brief gives its depth and its model tier, computed from the lines. Three rules reach it:
   - Every round, re-check every acceptance line of the issue, not only the findings of the round before.
   - Work on a record format, a contract or what a person sees is reviewed a tier above the worker.
   - The verdict judges the issue's acceptance and what the change itself broke; a finding outside that is filed as a new issue and never turns the verdict to changes.
7. **Land.** Raise the merger with `brief --role merger`: it merges serially, runs the check on the merged result, records `merged` and sets each issue done. Land as approvals arrive; nothing waits to form a batch.
8. **Repeat** until nothing is open, then close the branch.

Testing, stress and research sessions are the same loop with a different mix: some workers produce issues while others take them down.

## Resuming a loop

`resume` writes nothing and reads everything live, so a session cut off mid-turn loses nothing. What the next session needs lives where it reads: what comes next is **Priority:** and **After:**, why is a ruling or an issue's What and Why, what is on a branch is the lease and the rows, what waits on the owner is an `ask`, never prose.

## Filing

A good issue has a Why, checkable lines with methods, Files or Resources, a Tier and After where it waits; many lines on one issue are normal. `new "<title>" --why "<text>" --acceptance "<test-check-compare-read-or-owner-line>"... --by <who>`, or `field <id> <part> "<value>" --by <who>` later. A finding with a reproduction or a broken line is an issue; wording or taste stays a Minor point of a verdict; in doubt, a defect.

**Every line carries one method**, chosen by whoever files it, never by the worker on the lease: the cheapest that can actually fail. A `test` must be shown red first; a `check` must name a command whose result depends on the change. If no method can fail, the line is `read`.

| Method | The line says | `done` asks for |
|---|---|---|
| `test` | a behaviour a test proves | a counted row naming the line by the holder of the lease and one by someone else |
| `check` | a command (`· by: <command>`), or the goal's declared check when none is given | the same rows, or the landing on the declared check |
| `compare` | output that stays the same (`· by: <command>` required) | those rows, two of the holder's with identical `--saw` |
| `read` | what only judgement proves | a live approve that quotes it |
| `owner` | what the owner looks at (`· material: <what-he-reviews> · check: <what-he-checks>`) | his tick: `tick <id> <line-number> --by owner` |

A line with no mark reads as `read`. An `[owner]` line is agreed with him while the backlog is written, so he is handed the stage instead of having to call a pause.

`--after <ids>` holds an issue until those are settled, and `next` never offers it. `set` still lets you lease it, so leave a blocked issue open instead of parking it in-progress. A text that cites an unfinished issue by number with no After between them draws a note from `verify`, `new` and `field`. A piece easier done smaller becomes sub-issues: file them, then `split <id> --line <n>=<id>... --by <who>` shares the parent's lines out and refuses to lose one. A parent keeps a line of its own that proves the whole. Research findings come through `import` and repeated shapes from templates: see [Research import](commands.md#research-import) and [Templates](commands.md#templates).

## The shape of the work

The unit of record is the line; the unit of work is the lease. **The default is one agent on the whole issue, cut only where it stalls or where the problem clearly falls apart.** One examiner reviews one lease as one diff, however many issues it carries.

| Shape | Use it when | How |
|---|---|---|
| one agent, one spec | the default | one issue, many lines, one lease |
| package | small issues that sit near each other | `set <ids> in-progress` on one branch, one commit per issue |
| fan-out | territories with no shared file or resource, interfaces fixed first | a parent with sub-issues, each its own lease |
| sequence | one step's output is the next step's input | sub-issues chained by After |
| a change by tool | a mechanical change across many files | one lease; the examiner reads the tool and a sample |
| a probe | what is wanted is unknown | a research issue whose product is findings |

The director that takes the lease chooses by judgement; tag `shape:<name>` to have `status --group tag` and `models --group tag` count it. As many agents run at once as have territories that share no file or resource and that you and the merger can read reports for.

**The Tier sets the prior:** `light` when an executable check will catch a mistake, `strong` when only judgement would (a design, a format, an unknown cause), `standard` otherwise.

**Committing early.** A worker commits at the failing test and at the fix, so that long thinking still shows in `branches` and a replacement can continue from the tree.

**Same worker or a fresh one.** Findings go back to the same worker with `round <ids> "<text>" --by <who>` while its context is alive and they are local. Past the limit (three rounds unless a `Takeover` line of the goal changes it), or with its context gone, a fresh worker takes over after a handover (`set --handover`), with the old diff to use or discard. A retry must differ in model, tier or approach.

## Who decides what

Three questions, and one rule beside them: **who does the work never judges it, and cannot ease its own review.**

1. **Is it reserved to the owner?** What leaves the machine or cannot be taken back: a publish, a push, a tag, a deleted branch, a merge to `main`. What the tools' law keeps for a person: ratifying a rule, a suppression, a `review_by`, the architecture file. What the product is and when it ships. And the five stop cases of [SKILL.md](../SKILL.md#the-rules-that-never-bend). An unknown case counts as reserved. Ask, and hold only what depends on the answer.
2. **Whom does it bind?** One issue: its worker. One slice: its coordinator. The loop: the jarl. The goal or a whole type of code: the owner.
3. **The owner's by reach and not reserved?** Decide provisionally: `decide <slug> "<text>" --by jarl`, then `ask "<text>" --kind ratify --issue <id> --by jarl`. It blocks nothing; a rejected choice is undone by a new issue.

To ask, `ask "<text>" --by <who>` with what you found, the options with their cost and your recommendation; `answer <id> "<text>" --by <who>` records his answer as a ruling. `--kind stuck --issue <id>` holds one issue; everything else keeps moving, and the loop neither waits for him nor guesses for him. A worker's `stuck` goes to its director, a coordinator's escalation to the jarl, the jarl's to the owner.

A ruling that reaches every file of one type of code is `decide <slug> "<text>" --by <who> --area <type> --reach <n>` (and `--rule <id>` for a rule of the graph); `close` batches them for the owner (see [Area rulings](commands.md#area-rulings)). A rule for one role, slice, tag or moment takes `--applies-to` and reaches whoever matches it through `resume --as` and `next --as`.

To the owner: one sentence of state at boot, plain words, no internal names; "how is it going" gets an assessment, not a list. `next --as owner --all` is what is on him.

## When something fails

| Fails | Seen by | Do |
|---|---|---|
| a worker dies | `branches` marks the lease stale (30 minutes of no commit, row or log line, or the goal's `Liveness: <minutes>`) | hand the whole lease over with `set --handover`: the same worktree if the old agent is certainly gone, else a new branch from the old tip |
| a worker goes in circles | the round limit | a fresh worker one tier up, on another model, or with a changed approach |
| an examiner dies | proof with no verdict past the threshold | raise another; two verdicts corrupt nothing |
| a merge goes red | the merger's check | the merger's brief has the three cases |
| the merger dies | the checkout holds a merge no `merged` line names | look at git and the record, re-run the check, then record it or reset to the merge's parent; never infer the check from git |
| you compact | your next turn | `resume --as <who>`; a coordinator `brief --slice <name>`, then `resume --slice <name> --as <name>` |
| two clones worked apart | `verify` | `renumber <id> --key <key> --by <who>`, the git commands it prints for a conflicted record file, a handover naming the lease to keep |
| the directing session dies | nothing inside Jarl | a host runs `resume` when `next --as jarl` holds a move and nothing has written for a set time; Jarl raises nobody |

A merger's report is the only signal that it left the main checkout: nobody runs git there or raises a second merger before it arrives. Only worker leases are recorded, so what a dead merger left is read from git and the record.

## Coordinators: slices of the backlog

Add a slice when you hold more than you can read reports for. The goal's `Coordinators:` line names them, and each one's slice is the issues tagged `slice:<name>`, cut by area so files and most After chains stay inside it; an issue in no slice is the jarl's. A coordinator runs this reference over its slice, except that it never talks to the owner, and starts from `brief --slice <name>`, then `resume --slice <name> --as <name>`: its slice is its whole business, and what `resume` without `--slice` or the record files show of another slice is the jarl's.

**A level waits on the agents it raised, and returns only when the ball is on someone it did not raise.**

**The four reasons a coordinator escalates.** It goes up with `ask "<text>" --kind escalation --slice <name>` (and `--issue <id>` when one issue is the subject), which the jarl holds and answers, for these four and no other:

1. a gap or a finding outside its slice's goal;
2. a decision that is the jarl's or the owner's;
3. its slice empty, or blocked by another slice;
4. a takeover that failed too.

Counts are never pushed up: the jarl reads them with `status --slice <name>`. Pull before leasing and push right after when the loop is shared between clones. An issue's scope does not grow once it is leased: a new ask becomes a new issue.

The goal's `Merger: <name>` line names the one holder, the jarl or one coordinator, that raises the merger; `Merger (<coordinator>): <name>` gives a slice its own, into its own integration branch, in a worktree of its own. Mergers never share a checkout, and only the holder of the main checkout commits `.jarl/`. Every agent names itself with `--by`. A coordinator does not guess whether it can raise agents: at boot it looks for a spawn tool in its reach, or makes one real attempt on its first worker. If it cannot, it reports `no-spawn` to the jarl in one line, and for the rest of the loop writes each brief to a file and sends one line per spawn (`spawn <role> <id> tier=<tier> worktree=<path> brief=<path>`), or `resume <id> brief=<path>` for a second round or to feed the merger again; the jarl raises or resumes from that line without reading the brief and forwards the report's last line back.

## Closing the branch

Every issue `done`, `dropped` or `deferred` with a reason, or listed to the owner as open; the check green on the tip; `report` and `changelog <ids>` feed the changelog. `close --batch --by <who>` puts the area rulings and rules to him; `close --by <who>` then removes `.jarl/` (a permanent loop keeps it). Pushing and merging to `main` are his word, unless a goal line or ruling grants it once for good, naming the branch. Worker branches are never pushed.
