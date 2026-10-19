# The record

What lives in `.jarl/`, in which mode, in which format, and how the log decides what is true. Read it before touching the files of a loop, when a header and the log disagree, or when a loop will not open. The terms are defined in [glossary.md](glossary.md).

## Contents

- [Where the loop lives](#where-the-loop-lives): the three modes, the ignore file, the merge drivers
- [The files of the loop](#the-files-of-the-loop): `goal.md`, `decisions.md`, the issues, `log.md`, `repos.md`
- [The log is the record](#the-log-is-the-record): the one tool that moves it
- [When a header disagrees with the log](#when-a-header-disagrees-with-the-log): what the log says, what the file says, how to settle it
- [The write lock](#the-write-lock): concurrent writers, taking over a stale lock
- [The issue file](#the-issue-file): the format of one issue, the built-in statuses, kinds and tiers
- [The format marker](#the-format-marker): the record format, the formats Jarl reads, what raises it

## Where the loop lives

Everything lives in `.jarl/` in the main checkout the loop runs in. On a feature branch it never
reaches `main`; opened as a permanent record it lives on, wherever `--root` names, for good. The
loop runs in one of three modes, chosen once at `init`:

- **Default — out of git.** `init` writes `.jarl/.gitignore` with two lines, `*` and `**/*`, so git never sees the loop: it stays out of the branch's history, its diffs and its merges. The loop exists only in the main checkout's working tree — it belongs to that checkout, not to the branch, and no other clone or worktree has it. A worker's worktree therefore sees no `.jarl/`, so the worker, the reviewer and the merger always pass the main checkout as `root` (`--root` on the CLI), and nobody ever commits `.jarl/`.
- **Committed — `init --committed`.** `.jarl/.gitignore` ignores only the tool's write lock and the temporary files a write leaves for an instant (`/.lock`, `/.lock.break`, `.*.tmp`), so a `git add` made while a call runs never commits them; the loop itself is committed with the work on the feature branch. `.jarl/.gitattributes` tells git how the loop merges when two branches carrying it meet: `log.md` by union (one dated line per event), `decisions.md` never by union but by Jarl's own driver, `jarl.mjs merge-driver decisions %O %A %B`, which keeps both sides' rulings block by block and stops with conflict markers when both sides superseded the same ruling, used one slug for two rulings, or rewrote one ruling. The tool configures that driver in the repository's local git configuration (a local command, never committed) at `init` and at the first write of a committed loop that lacks it, with a fallback to git's own conflict markers when the script is gone: a driver git is told to run but cannot start keeps ours and drops theirs without a word. A clone that never configured it gets plain markers. The merger passes the driver on every merge anyway (`merge-driver flags`, see [The merger](merger.md#the-merger)); GitHub's merge button runs no driver, so a loop's branches merge locally. The merger commits `.jarl/` with every merge, and the last commit before the branch merges to `main` removes the whole directory.
- **Permanent — `init --permanent`.** Committed the same way, with the same narrow `.gitignore` — a record that must survive is always committed — and `init` additionally writes `.jarl/.permanent`, so a later session reads the mode from the loop itself rather than being told. This loop does not live on a feature branch at all: it lives wherever `--root` points, kept as a standing record, for example a repository that keeps one loop per release as that release's record, driving work in other repositories. Everything above — the files of the loop, the issue format, the roles, the tool — is the same; only closing differs, in [Closing the branch](jarl.md#closing-the-branch).

A loop whose `.jarl/.gitignore` ignores everything (a line `*`) is in the default mode; one without that
line, or with no ignore file at all, is committed, and one that also carries `.jarl/.permanent` is the
permanent mode. Only `init` decides the mode of a new loop. A committed loop without the narrow
ignore file is given it by its first write, which changes nothing about its mode; no command
ever turns one mode's ignore file into the other's.
`mode permanent` is the one exception: it turns an *existing, committed* loop into the permanent mode
in place, for a committed loop (one opened `--committed`). It refuses a default-mode loop (out of git): a permanent record must be committed,
and there is no in-place way to add git tracking to one, so start a fresh loop with `init --permanent`
instead. It refuses an already-permanent loop too, clearly, rather than silently doing nothing. See the
command table in [commands.md](commands.md#the-commands).

**A committed loop commits itself.** In the committed and permanent modes, `status` and `close` name how many loop files git has not committed and `resume` lists them (`git status` of `.jarl/` in the loop's repository). A loop whose code lives in another repository has no merge in its own repository to ride on, so without this the record in git contradicts itself. The count is silent in the default mode and outside a git repository.

## The files of the loop

The tool writes thirteen paths in `.jarl/`, listed below, and the temporary files (`.*.tmp`) a write leaves for an instant. It reads two things it never writes: the issue templates in `.jarl/templates/`, which the owner or the jarl writes by hand (`archive` leaves them in place, see [Templates](jarl.md#templates)), and a `handoff.md` left in a loop, which `resume` names and `handoff read` prints, as history and never as state.

| Path | What | Who writes |
|---|---|---|
| `.jarl/goal.md` | Why this branch exists, in one paragraph; the standing assumptions; the rules that apply here. Written once at the start, amended only with the owner's word. A `Coordinators: a, b` line (plain, a list item, or bold) names extra reviewers who count as `coordinator` rather than `fresh`, alongside `coordinator`, `jarl`, `reeve` and the loop's own name — the directory holding `.jarl/` — which count as coordinators without being declared. `Model (<tier>): <model>[, <model>…]` lines (the same forms, one per tier) say which models run on each tier: the first is the tier's default, the order of the tiers ranks the models, and a model on no line is unplaced (see [Which model sits where](models.md#which-model-sits-where)). A `Check: <command>` line (the same forms, one per check, several allowed) names the check that decides what lands — the repository's own test or gate — and a `Check (<repo>): <command>` line names one repository's, `<repo>` being the name its Files prefix writes; Jarl never runs it. A merge carries the check when its `--ran` text (`merged --ran --saw`) equals a declared command; `status` and `report` say per repository how many merges carry it, and that the loop lands on testimony alone while none does or while the goal declares no check (see [Loop metrics](commands.md#loop-metrics)). | jarl |
| `.jarl/decisions.md` | Rulings: `## YYYY-MM-DD · slug`, the ruling, **By:** who ruled. New rulings are appended and a ruling's text is never edited; the one change the tool makes to a written entry is `decide --supersedes`, which adds a **Superseded by:** line to its closing block. Read before deciding anything; never re-derive a ruling that is here. A ruling marked **Superseded by:** is not in force — the one that superseded it is; `decisions --live` lists only the rulings in force. | jarl |
| `.jarl/issues/7-slug.md` | One issue per file, numbered in filing order from 1. A number is written plain (7, 42, 1000); a number written with leading zeros, as 007, is the same issue as 7. Format below. | jarl (header, status), worker (evidence) |
| `.jarl/log.md` | The journal, append-only, one dated line per event: filed, started, done, dropped, merged, asked, decided. A text of several lines never breaks a line: the whole of it is kept where it belongs (the issue, `asks.md`, `decisions.md`) and the line holds its first line and a pointer. The one exception to append-only: the format raise rewrites the repository part of the tool's own merge lines, once, under the lock. | everyone, through the jarl |
| `.jarl/repos.md` | The repositories the issues name by name, one line each: the name, the repository's root commits (all of them), its origin as found and its base branch, and no path. Written only when an issue first names a repository by name, and by `repo --base`; each write is a log line. | jarl |
| `.jarl/asks.md` | The questions for the owner, one block per question: its type, its options and its answer; the ids are `a-1`, `a-2` and so on. | jarl (`ask`, `answer`) |
| `.jarl/profile.json` | The loop's profile, read as data (see [Profiles](profile.md#profiles)); written by `init --profile`, and by the first write that raises the record format (see [The format marker](#the-format-marker)). | jarl |
| `.jarl/archive/` | The archived loops, one directory `<yyyy.mm.dd>-<slug>/` each. | jarl (`archive`) |
| `.jarl/.gitignore` · `.jarl/.gitattributes` · `.jarl/.permanent` | The mode of the loop and how git merges it (see [Where the loop lives](#where-the-loop-lives)). | jarl (`init`) |
| `.jarl/.lock` · `.jarl/.lock.break` | The write lock (see [The write lock](#the-write-lock)). | every command that writes |

## The log is the record

**The log is the record, and one tool moves it**: `scripts/jarl.mjs` (Node, zero dependencies). An issue's status, its lease (Branch, Worker, Model, Since), its merge and CI state, its evidence rows and its verdicts are what the lines of `.jarl/log.md` say, read in order. The header fields of an issue file that show the status, the lease, the merge and the CI state are the tool's rendering of those lines, written in the same call, and every view and the done gate read the log. Every status change, tag, priority, ruling and log line goes through the tool, never through a hand edit — a status that changed without a log line did not change, and the tool is what makes that true rather than promised. A header edited by hand is never believed: it is printed as a disagreement (see [When a header disagrees with the log](#when-a-header-disagrees-with-the-log)).

## When a header disagrees with the log

What the log says of an issue is folded in file order, the way the commands write it. The status is the target of the last move (the filing counts as a move into the profile's first status). A move into a status that holds the lease sets Since to the line's stamp, replaces Branch when the line names one, replaces Worker when it names one (and then Model with the line's own, or none), and replaces Model alone when only a model is named; a move into any other status removes Worker, Model and Since and keeps Branch. A merge line sets Merged and Merge check (the check and what it printed, none when it names none) and takes that line's CI state, none when it names none, and a CI line replaces the CI state alone. `set` and `merged` write the line first and the file second, with one stamp for Since and its line, so a write that stops between the two leaves the log ahead of the file and never the file ahead of the log.

**Where the file says something else, the log wins and the view says so.** `status`, `resume` and `show` print one line for each of Status, Branch, Worker, Model, Since, Merged, Merge check and CI whose header differs from the log, and no count, mark, offer, queue row, report row or gate decision follows the file:

`record: 7 Status reads done in the file and in-progress in the log, which is the record — to follow the log, write **Status:** in-progress back into the header; to make the file's value the record, jarl.mjs set 7 done (a move into done, through its checks)`

`set <ids> <status-in-the-log> --header` rewrites the header fields the log renders from the log, writes no log line and is never a move; it settles every line of an issue at once (a write that stopped between the log and the file is repaired by it, and the move stays recorded). Writing a header back to the log's value by hand settles its line too. The command the line names for the other direction is a real change of the record and writes a line of its own: `set` writes a move line (and, in a lease, stamps Since again), `merged` writes a merge line, `merged <id> --ci <state>` a CI line. The Since field has no command of its own, so a header Since that differs is only written back. A line that is printed for a field the log has no value for says the header should lose it. An issue the log holds no filing and no move of (a file made by hand, or one the log knows only by merge or CI lines) reads its header as it stands and is printed as not in the log; `set <id> <status>` puts it there. A hand edit of a profile's status list changes which past lines read as moves: a line of the shape the tool writes for a move (`<id> → <status>`, the status a lower-case word) into a status the list does not name reads as a note, and `status` prints it once and follows the list as it stands. Any other line with an arrow is a note and is never printed. A move line is read by position: after the status come the free reason, never searched for fields, and the lease fields in the order `set` writes them (branch, model, worker, worktree); a reason that opens with a lease field's name is closed by a `(reason)` segment, and the reason of a move that opens with a lease word is read as the tool wrote it; lines written before the marker follow the comma rule, where a `worker` or `model` text with a comma is a sentence and one without is a name, so an old reason that is only `branch <word>` or `worker <name>` reads as the lease field. `set` refuses a worker or model with a comma, a branch git would not accept (a space among the characters it refuses) and any lease value on more than one line, so every value it writes reads back identical from the log and from the header. `set --header` restores no `Deferred:` or `Dropped:` reason under Evidence; the reason stays in the log line.

**The file is the authority for everything the log does not hold as state**: the title, Kind, Priority, Tier, Tags, Files, Repo, After, Source, Where, Resources, Found by, a profile's own fields, Worktree and the text of every section. The lines `after …`, `source …`, `field …` (Resources and a profile's fields) and `body …` that their commands write are an audit of the change, and nothing reads them as state.

**A Branch the log has recorded cannot be cleared.** Branch stays after the issue leaves in-progress, as the record of where the work was done, and it marks the issue as carrying code. A Branch recorded by mistake is replaced by the right one with `set <ids> in-progress --branch <b>`; no command removes it, and a hand edit of the header that removes it is printed as a disagreement and changes nothing.

**In a committed loop**, git merges `log.md` by union, which places the lines of two branches in the order of the merge direction. When both branches moved one issue, the clone that merged one way and the clone that merged the other way hold the same lines in two orders, and each folds its own log: the later move in its file decides, which is the order the done gate replays. The issue file has no merge driver and conflicts on the changed header lines; a resolution by hand that differs from the log the clone holds is printed as a disagreement, and writing the header back settles it. Two clones that hold the same log text read the same.

**The log's own door is shut to forged state.** `log` writes a note, and a line that starts with an id and an arrow, or reads as a filing, a move, a round, a verdict, a retraction, an evidence row, a merge, a CI state or a body change is refused, with the command that writes it. A composer's `record.appendLog` is refused the same way, and `record.writeAtomic` writes any file but the journal whole. A well-formed line written into `log.md` by hand cannot be told from a real one; only the commands keep the lines true.

## The write lock

Every command that writes holds `.jarl/.lock` while it runs, and every file is replaced whole, so the workers, reviewers and the merger can all call the tool at the same moment — through the tools or the CLI, from one session or several — without losing each other's rows, log lines or issue numbers. One server runs its calls one at a time, in the order they came, so a call waiting on the lock, or a slow `resume` or `tips`, delays the next call to that server; against every other writer (another session's server, a CLI call) the lock decides. A lock is taken over when its holder is gone: on the same machine, as soon as the holder's process is not running; a lock left empty (the holder died between creating and filling it) after 2 seconds; a lock from another machine sharing the checkout, or one whose holder cannot be read, only after 30 seconds; and a lock whose process id is running again, against a reused id, after 10 minutes. A call waits at most 20 seconds and then fails with nothing written, naming the holder: retry it. So the first call after a crash on another machine can fail once before the 30 seconds pass, and one after a reused process id waits out the 10 minutes or needs the lock removed by hand. Breaking a stale lock is itself serialized (`.jarl/.lock.break`), so it never hands the lock to two callers. Never delete the lock by hand while a call may still be running.

## The issue file

```
# 7 · title

**Status:** open | in-progress | done | dropped | deferred
**Kind:** bug | gap | cleanup | docs | test | research | process
**Priority:** 1 | 2 | 3
**Tier:** light | standard | strong, weakest first — the tier of model the worker is raised on, explicit in the file, never implied; the loop's `Model (<tier>):` lines in `goal.md` say which models run on each tier, and the criteria are in [Which model sits where](models.md#which-model-sits-where)
**Tags:** comma, separated
**Files:** the files it touches, comma separated — what `next` uses to keep workers apart; when **Repo:** is set, each starts with that repository's directory name (`tool/src/a.mjs`)
**Repo:** only when the code lives in another repository than the loop — its name, or the path to its main checkout where it is not a sibling of the loop's (see [Code in another repository](repositories.md#code-in-another-repository))
**After:** only when it waits on other issues — their ids; `next` holds it until each is done or dropped
**Resources:** only when the work uses something no other work may use at the same time — names, comma separated, loop-wide and not files (a port, a database server, `gate` for the machine's load); written with `field <ids> resources "gate, db"`, and emptied with `field <ids> resources --clear`. Only `next` reads it: it does not offer an issue whose resource an in-progress issue holds, nor two issues that declare the same one at once, across repositories too, and `next --all` names the holder under *held by a resource another issue holds*. A resource is held for a lease's whole life: there is no capacity and no lock at run time, `scope`, `queue` and the file rules never read it, contention during a test run belongs to the repository's own harness or the workspace's run lock, and how many heavy workers run at once stays the jarl's choice. `Resources` is a field Jarl writes itself, so a profile cannot declare a field of that name.
**Found by:** who, doing what
**Source:** only when it comes from research — <report dir>#<finding id>, several comma separated
**Where:** file:line, or the command and what it printed
**Branch:** only once it is in progress with --branch — the worker branch it is done on, shared by a package; kept after done
**Worker:** · **Model:** · **Since:** the lease, only while in progress — who, on which model (only when `--model` was given), from when (UTC); the lease records no worktree, which is found through the branch (a lease that holds a **Worktree:** field keeps it until it ends)
**Merged:** · **Merge check:** · **CI:** only once `merged` records it — the sha (and where), the check that decided the merge and what it printed (only when `--ran`/`--saw` were given), and pending | green | red | none

## What
One paragraph: the fact.

## Why
What it costs if left as is.

## Acceptance
Checkable. A test name, a command and its expected output, a sentence that is true or false.

## Changelog
Only when the change is user-visible: `- Added: …` (or Changed, Deprecated, Removed, Fixed, Security), one line each.

## Reviews
Written by `review` and `retract`: one entry per verdict — `approve`, `changes` or `retract`, the reviewer and its standing, the date, then the whole findings or reason. Before Evidence, which stays last.

## Evidence
Filled as the work goes: ### Proof, the worker's rows of what was run and what it printed; ### Notes, what only explains.
```

These are the built-in statuses, kinds and tiers. A loop opened with a [profile](profile.md#profiles) carries the statuses, kinds, tiers, fields and sections its profile names instead.

`dropped` and `deferred` always carry a reason under **Evidence**, in Notes, after whatever was already written there. A `research` issue produces a written result
and files new issues; it never edits code.

## The format marker

A record carries its format: Jarl reads the formats it knows and refuses a higher one. A format Jarl does not read is refused before anything else in the file, on every command, so a vendored copy and an installed Jarl that drifted apart stop loudly. Jarl reads formats 1 and 2. A loop without the marker is format 1; the first write of anything a reader that knows only format 1 would read wrongly in silence (a repository name in `Repo:`, an issue or ask numbered 1000 or more or written plain below 100, a retraction line) first writes `.jarl/profile.json` holding only `"jarl-profile": 1` and `"format": 2` (a loop that has a profile gets the key added), and such a reader then refuses the loop on every command instead of misreading it. A profile holding only those two keys changes nothing else: the loop keeps the built-in profile.

The first retraction in a loop raises the loop's record format to 2 before its line is written, so that a reader that knows only format 1, which cannot read a retraction and would still count the approve or the row, refuses the loop instead of passing `done` where Jarl refuses. The first repository name a loop stores in `Repo:` raises the format, under the same lock, and writes a bare-word path as `./<word>`; what a `Repo:` value is in each format is in [Code in another repository](repositories.md#code-in-another-repository).
