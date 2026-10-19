# Composers and the record library

What a tool that builds on Jarl's record may rely on, where the command line and the library differ, and what Jarl will not grow. Read it when you write or review code that reads or writes the record through `record.mjs`, or when someone asks Jarl for a gate, a queue that lands, or a planner.

## Contents

- [The record as a library](#the-record-as-a-library): the contract, the lock, what is not a contract
- [What only the command line does](#what-only-the-command-line-does): the library parity list
- [What Jarl will not grow](#what-jarl-will-not-grow): the five rails Jarl does not ship
- [Boundary with other skills](#boundary-with-other-skills)

## The record as a library

Another tool that stands on Jarl's record (a composer such as Horde, whose mission is a real Jarl loop under `--root`) reads and writes it through `scripts/record.mjs`, and only that module. It declares its contract as `RECORD_API` (`jarl-record/1`) and exports, each named by hand: opening and reading a loop, an issue as text, the profile, the write lock and the atomic write, the operations on the record (filing, status moves with the profile's checks, fields, sections, evidence, reviews, merges, rounds, rulings, questions, log lines) and the data behind `status` and `resume`. The list, with every function's parameters and `opts` keys, lives in [`scripts/record.mjs`](../scripts/record.mjs) itself and nowhere else. Each operation holds `.jarl/.lock`, refuses with the CLI's own words, writes the same files and log lines, and returns what the command's `--json` prints. `loadIssues` and `findIssue` return the record, so an issue's status, lease, merge and CI are what the log says, while `parseIssue` reads a text alone; `statusData` and `resumeData` carry `disagreements` when a header differs from the log; `appendLog` refuses a line that reads as state and `writeAtomic` refuses the journal. A composer therefore writes status, lease, merge and CI through the operations and keeps to the file only for the fields the log does not hold (see [When a header disagrees with the log](record.md#when-a-header-disagrees-with-the-log)). A status move says who asked: `record` for a library call, `cli` for the command line and the MCP tools. The lock is re-entrant per loop and takes synchronous work only; waiting for it blocks the thread for up to 20 s. A vendored copy is `record.mjs` with `jarl-lib.mjs` beside it. The library never reaches another tool: an answer to an area ruling's ratify item hands back its `typeDecision` (`{ type, text, supersedes }`), which the command line writes into the type's decision log and a composer writes with its own code, or not at all. Nothing else here is a contract: `jarl.mjs` is the command line over `record.mjs`, and `jarl-lib.mjs` and every export of `jarl.mjs` change without notice. A change to `record.mjs`'s exports or their parameters bumps `RECORD_API`; the suite fails until it does.

## What only the command line does

The library and the command line write the same files and log lines for every operation of the record, except the rows of this table. Each row is one difference that stays, with what the command line does, what the library does and the reason. The rows are the one list; a test in the suite holds this table to it.

| Item | Command line | Library | Why |
|---|---|---|---|
| Merge with no CI state | records no CI state unless `--ci` is given | records `pending` when a sha is given without a CI state | a composer that records a merge before CI has run says so in the record; a person at the command line gives the state when it is known |
| Numbers of issues and questions | writes them plain (`3`, `a-1`), and raises the record format for a plain number under three digits | writes three digits (`003`, `a-001`) | a composer's files sort by name, and the contract returns the three-digit ids |
| Merge cleanup | removes the merged issue's worktree and local branch when that is safe, unless `--keep` is given | removes nothing | removing git worktrees and branches is a step a person asks for at the command line; a composer removes the ones it made |
| Caller of a status or field move | asks as `cli`, so a status the profile marks `set-by: record` is refused | asks as `record` unless `caller: cli` is passed | a status the profile gives to the record's own tool is moved by the composer that runs the loop, not by a person at the command line |
| Worktree of a lease | refuses a `--worktree` that exists and is not a worktree of the lease's repository, or has another branch checked out | accepts it and stores nothing | the worktree of a lease is found through its branch; a composer that tracks worktrees checks them itself |
| Base of a done check | checks a done against the branch checked out in the merge's repository, and takes no base | takes `base`, the branch or ref a merge landed in, for a composer that lands into a branch not checked out | a person's merge lands in the checked-out branch; a composer names its own target, and no command-line call can name one |
| Who answered | records `--by` (default: owner) | records the owner; the contract's answer takes no name | a composer cannot name the ratifier through the library, because the answer keeps the arguments the contract names |
| Ratified area rulings | writes the type's decision log and the rule's log through the Yggdrasil edge | returns the entries and writes neither | the Yggdrasil write is the only call from Jarl to another family tool; a composer writes into its own graph; no twin case exists, because it needs a loop with an area ruling and a graph |
| Replies and notes | prints notes and replies that depend on the caller: the goal that names no check (`init`), the tier of a new issue (`new`), the lease notes (`set`), the proof and fresh-review notes (`merged`), the model and proof notes and the next step (`review`), the owner's word with no question (`decide`), and a long free-text note (`evidence`) | writes the same files and prints none of them | the notes are for a person at the command line; the twin cases compare files and log lines, and the notes are neither |
| Lists of ids | takes a list of ids (`12,13`, `203-206`) for `files`, `repo`, `after`, `body`, `round` and `source`, and checks every id before it writes one | takes one id for each of those operations | a person at the command line writes a package of issues in one call; a composer calls the operation for each id it holds and decides what a refusal on one of them means; no twin case exists, because the twin loops run one id |
| The verbs `retract` and `field` | retracts an approve or an evidence row with `retract`, and writes Resources or a profile field with `field`, emptied with `--clear` | retracts with `review` (verdict `retract`) and `addEvidence` (`retract`); `setField` writes a field the profile declares, and `setStatus` with the name `resources` writes Resources; both empty a field with an empty value | the verbs are the command line's grammar over the operations; the library keeps the operations its contract names |
| `close` | ends the loop: removes it, or keeps it as a permanent record | no function | ending a loop belongs to whoever runs it, and a profile may hand that to a composer |
| `archive` | moves the loop under an archive directory and leaves the open issues named | no function | ending a loop belongs to whoever runs it, and a profile may hand that to a composer |
| `mode` | makes the loop permanent, a mode of git | no function | the mode is written at init, and a change of it is a decision of the person who commits the record |
| `import` | files issues from a Markdown source | no function; newIssue files one issue | filing from a source is the composer's choice |
| `next` | lists the open issues that can start now | no function; statusData carries the counts | ordering work is a composer's planner; Jarl offers what can run now |
| `queue` | lists the merge queue | no function | a listing for a person; a composer decides what lands |
| `report` | writes the loop's text report with its metrics | no function | a summary for a person; a composer reports from its own record |
| `scope` | reads a worker branch's diff against the files its issues declare | no function | it reads git; a composer's gate decides what lands |
| Typing a command under another name | prints a note on stderr that gives the command's own name | no command names, only functions called by name | a note for a person typing at the command line; the tools and composers call a command by its own name |
| `branches` | lists each branch with the issues it carries and its state | no function | it reads git in the repositories the issues name; a view for a person |
| `tips` | lists the tip of each worker branch in flight | no function | it reads git in every repository the issues name; a view for a person |
| `verify` | checks the record with its own readers in strict mode | no function; the readers are the library's | a consistency read for a person; a composer uses the readers |
| `models` | shows, per model, what the record holds as worker and as reviewer | no function | a reading of the record for choosing models; a view for a person |
| `goal` | reads or sets the goal line | no function; initLoop writes the goal | the goal is written at init; a change of it is a decision of the person who runs the loop |
| `show` | shows one issue as text, with its evidence rows and where its branch sits | no function; findIssue returns the same record as data | text for a person |
| `list` | lists the issues as a table | no function; loadIssues returns the same record as data | a table for a person |
| `changelog` | shows the changelog fragments of issues as text | no function | the release step writes the release text once, from the fragments |
| `handoff` | reads and writes a session's handoff note | no function | the handoff is a note of a session, not part of the record |
| `sources` | lists the sources of issues | no function; setSource writes them | a view for a person |
| `profile` | shows the profile in use, as text | no function; loadProfile and describeProfile return it as data | text for a person |

## What Jarl will not grow

Jarl records, derives and displays; it never blocks code from landing. Every scale request is measured against that line. On Jarl's side: filing and importing issues, refusals at the level of the record (a `done` without evidence or a fresh approve, a self-approve, a cycle of After), review provenance, read-only views (`resume`, `status`, `report`, `tips`, `queue`, `branches`), ordering by After, branch packages, leases that are shown and never expire, merges and CI recorded as fields, changelog fragments, templates, and a profile that says, as data, which statuses and fields a loop's issues carry. Jarl itself ships none of the following, and a loop without a profile has none of them:

1. **A merge queue that runs the repository's check and refuses the merge.** `queue` lists; it never lands anything.
2. **A `done` that waits for green CI.** CI is recorded and noted (`set done` says when it is not green), never required.
3. **Leases that expire or are taken over automatically, or territory locks across loops.** A stale lease is shown for the jarl to act on; nothing moves by itself.
4. **A release mode that refuses to tag or release.** A release checklist is issues filed from a template; the procedure belongs to the skill that runs releases, and the tags to each repository's own release workflow.
5. **A computed schedule or critical-path planner.** `next` offers what can run now; After is ordering and bookkeeping, not a schedule.

The line holds for Jarl's own code. A profile is data only: statuses and who may set them, fields, sections, the scheduler it defers to, what its done gate asks for and who may end the loop. Jarl does not run commands a profile supplies, now or later. A composer that needs a gate, a planner or a lease that acts, as Horde does, keeps them in its own code beside the record and writes to the record through `record.mjs`. The only Jarl code that calls another tool of the family is the optional write of ratified rulings to Yggdrasil (see [Rulings about an area](jarl.md#rulings-about-an-area)). A request for one of the five above is a request for such a composer, not for a bigger Jarl.

## Boundary with other skills

Jarl is the loop; it does not replace discipline. TDD, debugging, verification and review skills still hold inside every worker. Urd's "ask, don't guess" holds inside the jarl. When a mission needs the graph, a plan made before anyone writes, the gate and the owner's charter, that is Horde, whose mission is a Jarl loop run under its own profile — the vocabulary carries over because the record is the same.
