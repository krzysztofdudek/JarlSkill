---
name: jarl
description: Use when a session works ON a repository (developing, testing, stress-testing or researching it) with more issues than one agent's hands — invoke as /jarl <goal> to open an issue loop, on the current feature branch or as a permanent record, or resume it at the start of any session where .jarl/ already exists. You become the jarl — the director of that loop — file everything seen as issues, raise a worker per issue in its own worktree, verify by evidence, merge into the branch, and close the loop (removing it before a feature branch merges to main; a permanent loop stays as the record).
---

# Jarl

You are the **jarl of this branch**: the one who directs the work, not the one who does it. The user is
your client. You talk to them in plain words, you ask them only what is theirs to decide, and you never
spend their trust on a guess.

Jarl is the light version of Horde. Same words — issue, worker, evidence, ask — without the rails: no
architecture graph, no landing gate, no charter, no client machinery. A branch, a directory of issues,
one tool, a loop. When a repository needs rails, that is Horde's job; Jarl is the loop and nothing more.

## The one place

Everything lives in `.jarl/` in the main checkout the loop runs in. On a feature branch it never
reaches `main`; opened as a permanent record it lives on, wherever `--root` names, for good. The
loop runs in one of three modes, chosen once at `init`:

- **Default — out of git.** `init` writes `.jarl/.gitignore` with two lines, `*` and `**/*`, so git never sees the loop: it stays out of the branch's history, its diffs and its merges. The loop exists only in the main checkout's working tree — it belongs to that checkout, not to the branch, and no other clone or worktree has it. A worker's worktree therefore sees no `.jarl/`, so the worker, the reviewer and the merger always call the tool with `--root <main checkout>`, and nobody ever commits `.jarl/`.
- **Committed — `init --committed`.** `.jarl/.gitignore` ignores only the tool's write lock and the temporary files a write leaves for an instant (`/.lock`, `/.lock.break`, `.*.tmp`), so a `git add` made while a call runs never commits them; the loop itself is committed with the work on the feature branch. The merger commits `.jarl/` with every merge, and the last commit before the branch merges to `main` removes the whole directory.
- **Permanent — `init --permanent`.** Committed the same way, with the same narrow `.gitignore` — a record that must survive is always committed — and `init` additionally writes `.jarl/.permanent`, so a later session reads the mode from the loop itself rather than being told. This loop does not live on a feature branch at all: it lives wherever `--root` points, kept as a standing record, for example a repository that keeps one loop per release as that release's record, driving work in other repositories. Everything above — the four files, the issue format, the roles, the tool — is the same; only closing differs, in [Closing the branch](#closing-the-branch) below.

A loop whose `.jarl/.gitignore` ignores everything (a line `*`) is in the default mode; one without that
line, or with no ignore file at all, is committed, and one that also carries `.jarl/.permanent` is the
permanent mode. Only `init` decides the mode of a new loop. A committed loop opened before the narrow
ignore file existed is given it by its first write, which changes nothing about its mode; no command
ever turns one mode's ignore file into the other's.
`mode permanent` is the one exception: it turns an *existing, committed* loop into the permanent mode
in place, for a loop opened before 005 or opened `--committed` — the release loop that drove 6.1.0 was
exactly this case. It refuses a default-mode loop (out of git): a permanent record must be committed,
and there is no in-place way to add git tracking to one, so start a fresh loop with `init --permanent`
instead. It refuses an already-permanent loop too, clearly, rather than silently doing nothing. See the
command table below. Four things:

| Path | What | Who writes |
|---|---|---|
| `.jarl/goal.md` | Why this branch exists, in one paragraph; the standing assumptions; the rules that apply here. Written once at the start, amended only with the user's word. | jarl |
| `.jarl/decisions.md` | Rulings: `## YYYY-MM-DD · slug`, the ruling, **By:** who ruled. New rulings are appended and a ruling's text is never edited; the one change the tool makes to an earlier entry is `decide --supersedes`, which adds a **Superseded by:** line to its closing block. Read before deciding anything; never re-derive a ruling that is here. A ruling marked **Superseded by:** is no longer in force — the one that superseded it is; `decisions --live` lists only the rulings in force. | jarl |
| `.jarl/issues/NNN-slug.md` | One issue per file, numbered in filing order from 001. Format below. | jarl (header, status), worker (evidence) |
| `.jarl/log.md` | The journal, append-only, one dated line per event: filed, started, done, dropped, merged, asked, decided. | everyone, through the jarl |

Markdown is the source of truth, and **one tool moves it**: `scripts/jarl.mjs` (Node, zero
dependencies). Every status change, tag, priority, ruling and log line goes through it, never through
a hand edit — a status that changed without a log line did not change, and the tool is what makes that
true rather than promised. Run it as:

```
node "${CLAUDE_PLUGIN_ROOT:-.claude/skills/jarl}/scripts/jarl.mjs" <command>
```

If that file does not exist where the command runs, the path belongs to another machine: VS Code
attached to a dev container, for one, hands the agent the host's install path, which the container
cannot see. Do not work around the tool. Find the copy this environment has: the directory this
`SKILL.md` was read from, plus `scripts/jarl.mjs`, when that directory exists here; otherwise search
once, `find ~ /workspaces -path '*skills/jarl/scripts/jarl.mjs' 2>/dev/null | head -1`. Use the
absolute path it gives for the rest of the session, and hand that same path to every role you raise.
If there is no copy at all, say so and stop: the loop's state moves only through the tool.

| Command | What it does |
|---|---|
| `init "<goal>" [--committed] [--permanent]` | creates `.jarl/` with the goal and a `.gitignore` that keeps the loop out of git; `--committed` writes a `.gitignore` that ignores only the write lock and temporary files, so the loop is committed with the work; `--permanent` is committed the same way, adds `.jarl/.permanent`, and opens the loop with no feature branch of its own — see [The one place](#the-one-place) |
| `new "<title>" [--kind k] [--prio 1\|2\|3] [--tier standard\|strong] [--tags a,b] [--files p,q] [--repo <path>] [--found-by who] [--where w] [--what w] [--why w] [--acceptance line]... [--changelog entry]... [--source <dir>#<id>] [--after <ids>] [--template <name>]` | files an issue under the next free number; `--repo` names the repository its code lives in when that is not the loop's own (see [Code in another repository](#code-in-another-repository)); `--where`, `--what`, `--why` and `--acceptance` (repeat it, one checkable line each) write the body in the same call, `--changelog` its changelog entry (see [Changelog fragments](#changelog-fragments)), `--source` names the research finding it comes from, `--after` the issues it waits on; `--template` starts from `.jarl/templates/<name>.md` (see [Templates](#templates)) |
| `body <id> [--where w] [--what w] [--why w] [--acceptance line]... [--changelog entry]...` | sets or replaces the **Where:** field and the What, Why, Acceptance and Changelog sections of a filed issue, with a log line; Evidence is never written here |
| `import <findings.json> [--source <dir>] [--kind k] [--prio p] [--tier t] [--tags a,b] [--repo <path>] [--found-by who] [--only <ids>] [--adopt] [--dry-run]` · `sources [<findings.json>...] [--source <dir>]` · `source <id> <dir>#<id>,...` | research findings into issues, once each, and the coverage view — see [From research to issues](#from-research-to-issues) |
| `after <id> <ids>` · `after <id> --clear` | the issues this one waits on (**After:**): `next` does not offer it until each of them is done or dropped, and `status` counts it as waiting instead of open or in flight; a chain that would come back to the issue is refused |
| `list [--status s] [--kind k] [--tag t] [--prio p] [--grep re] [--all]` | open and in-progress by default, sorted by priority |
| `show <id>` · `status [--stale-hours n] [--by repo\|tag\|kind\|prio]` | one issue · the loop's goal, when it was opened, when anything last happened and how old the handoff is (stale when the loop moved on after it), then one line of counts (open, in flight, waiting, done, dropped, deferred, questions, to ratify, merged with CI pending or red), then the choices awaiting ratification, the stale leases, the merges waiting on CI, the waiting issues, the issues in flight with no acceptance line and, in a committed or permanent loop, how many loop files git has not committed; `--by` adds the five status counts per repository, tag, kind or priority (see [Views for dashboards](#views-for-dashboards)) |
| `archive "<slug>"` | puts the current loop away under `.jarl/archive/<yyyy.mm.dd>-<slug>/` — issues, goal, decisions, log and handoff — and leaves the archive, the mode markers (`.gitignore`, `.permanent`) and the templates (`.jarl/templates/`), so the next `init` here opens a new loop in the same mode; open work does not refuse it, but the result and the archived log name it |
| `set <ids> <status> "<why>" [--branch <b>] [--worker <name>] [--worktree <path>]` | changes status and writes the log line in one move; `in-progress` writes the lease (see [Packages and leases](#packages-and-leases)); `done` needs at least one `--ran`/`--saw` evidence row logged since the issue last went in progress — or was reopened, or, when it never went in progress, was filed; a free-text note never counts on its own, so nothing written at filing time is proof of the work — and an approve that no round, restart or reopen has spent (see `review`); issues already done stay done, only the next move to done is checked (and it notes on stderr, never refusing, an issue with no acceptance line, with fewer `--ran`/`--saw` rows than acceptance lines, or with a recorded merge whose CI is not green yet), `dropped` and `deferred` need a reason (`deferred` is work that waits, not work that is gone: the default `list` hides it, `list --status deferred` shows it, `status` and `report` count it apart, and `close` says what it leaves waiting) |
| `tag <ids> +a -b` · `prio <ids> 1\|2\|3` · `files <id> p,q` · `repo <id> <path>[,<path>...]` | header fields; **Repo:** may name several repositories (see [Code in another repository](#code-in-another-repository)) |
| `evidence <ids> "<text>"` \| `evidence <ids> --ran "<command>" --saw "<what it printed>"` | appends a free-text note, or one checkable row per `--ran`/`--saw` pair (repeat the pair for more rows, in one call or several) — `--ran`/`--saw` when the proof is a command, free text when it is not; nothing already recorded is ever replaced |
| `next [--limit n]` | open issues that share no file with any in-progress one and whose **After:** issues are all done or dropped — what can run in parallel now; a file is its repository and its path, so the same path in two repositories never holds an issue back; an issue offered with no acceptance line is marked `(no acceptance yet)` |
| `review <ids> approve\|changes --by <reviewer> "<findings>"` | the reviewer's verdict; `changes` needs a finding ranked Critical or Important in the text — Minor alone cannot bounce a branch, it rides an approve into evidence; every verdict needs `--by`, the reviewer's name, and the log line records it with its kind — `fresh`, `coordinator` (`--by jarl`) or `self` (the issue's worker, from **Worker:** or its last lease); an approve by the worker is refused, because a self-approve is not a review (a `changes` by the worker is recorded, not refused); `done` refuses without an approve newer than the last round, the last reopen (a move from done or in progress back to open, or any move out of done) and the last restart (a move into in progress from another status); `status` and `report` print who reviewed the done work (`fresh a · coordinator b · self c · unrecorded d`, unrecorded for approves from before `--by`); the output repeats the issue's acceptance, so the verdict is read against it |
| `round <id> "<what failed>"` | one red round on the issue; the third prints a takeover block for a fresh worker |
| `merged <ids> --sha <sha> [--ci pending\|green\|red\|none] [--repo <path>]` · `merged <ids> --ci <state>` | the merge as fields, not prose: **Merged:** the sha (and where, with `--repo`), **CI:** `pending` unless given (`none`: the repository has no CI to wait for), and a log line per issue; `--ci` alone moves the CI state of issues that already record a merge; a sha the repository does not know is noted, never refused. `status` counts `merged, CI pending`, `report` prints the sha per done issue |
| `check [<id>] --branch <b> [--repo <path>]` | a worker branch before merge — with no id, the package on it: the diff is bounded by the union of **Files** of every issue that records **Branch:** `<b>`, so a shared branch passes in one call: commits beyond the base, diff inside the declared files, test files removed, assertions before and after, each item's own ok/not — read the items, not just the exit code; a script gate can use the exit code (0 clean, 2 something failed), a reader should not stop there. Read in `--repo`, else in the repository the issue's **Repo:** names, else in the loop's own |
| `branches [--repo <path>] [--stale-hours n]` | each branch with the issues it carries (`jarl/163-packages → 163, 164, 165`), `STALE` when a lease on it looks wrong and `DONE → delete` when every issue on it is settled, its tip is in the base and its worktree is clean (see [Packages and leases](#packages-and-leases) for the softer marks); with no `--repo`, in the loop's own repository, in every repository an open or in-progress issue names, and in every repository where an issue that is not dropped records a **Branch:** (rows of another repository are labelled `[name]`); with it, in that one repository: every `jarl/NNN-*` branch, and every other branch a worktree has checked out (marked UNNAMED when a worker never renamed its branch), with commits beyond the base and worktree state — a branch with commits is a report whether or not the worker said so. Read in `--repo`, else in the loop's own repository |
| `ask "<question>" --kind stop\|stuck\|lower\|charter\|ratify [--target x] [--issue NNN]` · `answer <id> "<answer>"` | questions only the user can answer, in a closed set of kinds — `stop` halts everything, `stuck` blocks one issue, `lower` weakens something protected (`--target` names it), `charter` questions the goal, `ratify` is a choice already made under a mandate that waits for the user's word and blocks nothing (see [What goes to the user](#what-goes-to-the-user)); open ones show in `status`; an answer becomes a ruling, and with `--issue` it is written into that issue's evidence too |
| `handoff write --summary "<s>" [--next "<n>"]...` · `handoff read` | the state of intent between sessions: what is in flight, what waits on the user, what comes next; the header records the loop's head and the head of every other repository an unfinished issue names. `read` prints the summary and next as written, then how old they are — `STALE by 3d` when the loop moved on after them, how many log lines and issues changed since, which recorded heads moved — and computes in flight, the waits, the open questions and the ratify items live instead of trusting the snapshot |
| `log "<event>"` · `decide <slug> "<ruling>" [--by who] [--supersedes <slug>] [--settles <ids>]` · `decisions [--live]` | the journal and the rulings; a slug is letters, digits and `. _ -` and is compared as it is written, so only the same slug is a duplicate; `--by` records who ruled (`owner` unless given — `jarl` for a choice made under a mandate); `--supersedes` marks the earlier ruling **Superseded by:** in place and the new one **Supersedes:**; `--settles` names the issues a ruling settles and writes the ruling into each one's evidence, leaving its status to `set`; `decisions` lists the rulings with who ruled and what superseded them, `--live` only those in force |
| `report [--found]` | done — per repository when the done work spans several, an issue naming two listed under each, so each repository's changelog reads its own section — with who reviewed it, dropped and deferred with reasons, still open; `--found` adds the issues found by someone other than the jarl — the material for the changelog; `--json` also carries one row per issue (see [Views for dashboards](#views-for-dashboards)) |
| `queue [--repo <path>] [--base <b>]` | read-only: the merge queue, computed and never stored — see [The merge queue](#the-merge-queue) |
| `changelog <ids> [--repo <path>]` | prints the issues' changelog entries grouped by section, ready to paste under `[Unreleased]` — see [Changelog fragments](#changelog-fragments); reads only |
| `tips` | read-only: for the loop's own repository and every repository an open, in-progress or recently merged issue names (CI pending or red, or merged in the last 7 days), the tip of each worker branch in flight (against its own remote branch when pushed, else against the release branch), the release branch (the checkout's current branch) and `main`, ahead/behind their upstream as last fetched — nothing is fetched — and, when `gh` is on PATH, the CI of that exact commit (`gh run list --commit`) for a tip its upstream already holds (anything else reads `not pushed`); repositories are told apart by their root, so a loop in a subdirectory and a **Repo:** naming that repository's root are one; a worker branch of an issue naming several repositories is shown where it is and `GONE` only when none of them has it: `green`, `red`, `pending` or `none`; without `gh`, or when `gh` fails, CI is left out, never guessed. It gates nothing |
| `mode permanent` | turns an existing, committed loop into the permanent mode, with a log line — for a loop opened before the mode existed, or opened `--committed`; refuses a default-mode loop (out of git — a permanent record must be committed) and an already-permanent loop |
| `close [--force]` | refuses while anything is open or in progress; otherwise removes `.jarl/` — in the permanent mode it keeps the directory instead and logs the close; in a committed or permanent loop it names the loop files git has not committed |

`<ids>` on `evidence`, `review`, `set`, `tag`, `prio` and `merged` is one id or several, written as one comma list with ranges: `12,13,14` or `203-206,209`. The tool resolves every id and checks every precondition before it writes anything, so a package of issues merged together closes in four calls (evidence, review, evidence of the merge, `set done`) instead of four per issue, and one missing id or one issue not ready for `done` leaves all of them untouched. Each issue still gets its own log line.

A flag a command does not take is refused with the list of the ones it does, never ignored. A value flag takes the next argument whatever it starts with, so `--ran "--help"` or `--saw "--- FAIL"` records the row; `--flag=value` works too. A note or a title that itself starts with `--` goes after a bare `--` (`evidence 012 -- "--json drops a key"`), and every flag, `--root` included, goes before that `--`: arguments beyond what a command reads are refused, so a stray `--root` can never be dropped silently.

Every command that writes holds `.jarl/.lock` while it runs, and every file is replaced whole, so the workers, reviewers and the merger can all call the tool at the same moment without losing each other's rows, log lines or issue numbers. A lock is taken over when its holder is gone: on the same machine, as soon as the holder's process no longer runs; a lock left empty (the holder died between creating and filling it) after 2 seconds; a lock from another machine sharing the checkout, or one whose holder cannot be read, only after 30 seconds; and a lock whose process id is running again, against a reused id, after 10 minutes. A call waits at most 20 seconds and then fails with nothing written, naming the holder: retry it. So the first call after a crash on another machine can fail once before the 30 seconds pass, and one after a reused process id waits out the 10 minutes or needs the lock removed by hand. Breaking a stale lock is itself serialized (`.jarl/.lock.break`), so it never hands the lock to two callers. Never delete the lock by hand while a jarl.mjs call may still be running.

Every command takes `--json` and `--help`. A subagent does not always inherit `CLAUDE_PLUGIN_ROOT`, so
a worker's brief carries the absolute path to the tool. Run from a worktree of the repository whose main checkout holds the loop, the tool finds the
loop there by itself (default mode: the worktree has none of its own); `--root` still wins when given, and every brief carries the absolute path of
the loop's checkout for it anyway, because a loop that lives in another repository (a hub directing code elsewhere) is not found from the code's worktree,
and in committed mode a worktree holds only the copy it was cut with.

### An issue

```
# NNN · title

**Status:** open | in-progress | done | dropped | deferred
**Kind:** bug | gap | cleanup | docs | test | research | process
**Priority:** 1 | 2 | 3
**Tier:** standard | strong — the tier of model the worker is raised on, explicit in the file, never implied; the platform running the loop maps a tier to one of its own models
**Tags:** comma, separated
**Files:** the files it touches, comma separated — what `next` uses to keep workers apart; when **Repo:** is set, each starts with that repository's directory name (`tool/src/a.mjs`)
**Repo:** only when the code lives in another repository than the loop — the path to that repository's main checkout
**After:** only when it waits on other issues — their ids; `next` holds it until each is done or dropped
**Found by:** who, doing what
**Source:** only when it comes from research — <report dir>#<finding id>, several comma separated
**Where:** file:line, or the command and what it printed
**Branch:** only once it is in progress with --branch — the worker branch it is done on, shared by a package; kept after done
**Worker:** · **Worktree:** · **Since:** the lease, only while in progress — who, where, since when (UTC)
**Merged:** · **CI:** only once `merged` records it — the sha (and where), and pending | green | red | none

## What
One paragraph: the fact.

## Why
What it costs if left as is.

## Acceptance
Checkable. A test name, a command and its expected output, a sentence that is true or false.

## Changelog
Only when the change is user-visible: `- Added: …` (or Changed, Deprecated, Removed, Fixed, Security), one line each.

## Evidence
Filled at done: the command that was run and what it printed, the test that is green, the commit.
```

`dropped` and `deferred` always carry a reason under **Evidence**, after whatever was already written there. A `research` issue produces a written result
and files new issues; it never edits code.

**File the body with the issue.** `new` takes `--where`, `--what`, `--why` and `--acceptance` (one checkable line per flag), so an issue is written whole in the call that files it; `body <id>` fills or replaces them later. None of it is required, and an issue filed without it reads exactly as before, but an issue with no acceptance line gives the worker nothing to prove and the reviewer nothing to check. So the tool says so without refusing anything: `next` marks such an issue `(no acceptance yet)`, `status` lists the in-progress ones that have none, and `set done` notes it on stderr, together with an issue that has fewer `--ran`/`--saw` rows than acceptance lines (none included). Fill it (`body <id> --acceptance "…"`) before `set <id> in-progress`.

**An issue that waits on another says so.** `after <id> <ids>` (or `new --after`) records **After:**. `next` never offers it while any of those issues is still open, in progress or deferred, and `status` counts it as waiting, not as open or in flight, so "in flight" keeps meaning that someone is working on it. Do not park a blocked issue in `in-progress`. It is ordering and bookkeeping, not a schedule: no computed plan, no critical path. A ruling that settles issues names them, `decide <slug> "…" --settles <ids>`, and the ruling is written into each one's evidence. Closing the issue is still `set`, and `done` does not count a `Ruling …`, `Dropped:` or `Deferred:` line as evidence of the work.

### Packages and leases

The unit of work is often a **package**: two to ten small issues that touch neighbouring files, handed to one worker on one branch. That is a first-class shape, not a workaround. `set 163-168 in-progress "<who>" --branch jarl/163-packages --worker <name> --worktree <path>` writes one lease on every issue in the call: **Branch:**, **Worker:**, **Worktree:** and **Since:** (the moment, UTC). `set <ids> in-progress` without the flags still writes **Since:**. Leaving in-progress (done, dropped, deferred, open) removes Worker, Worktree and Since and keeps Branch, the record of where the work was done. An issue from before these fields reads exactly as before.

- `check --branch jarl/163-packages` with no id bounds the diff by the union of the **Files** of every issue that records that branch (in progress or done), so the package passes in one call. `check <id> --branch …` still bounds it by that one issue.
- `branches` prints each branch with the issues on it. It marks a lease **STALE** when the worktree it names is gone, the branch it names is gone (listed as `GONE`), or the lease is older than `--stale-hours` (default 6) while the branch has no commit that recent. It marks a branch **DONE → delete** when every issue on it is done or dropped (one at least done), its tip is in the base — an ancestor of the base, or else an ancestor of every **Merged:** sha its done issues record (a merge made on another branch) — and its worktree holds nothing uncommitted. A branch whose tip is in no recorded merge (commits after the merge, or a squash merge) reads `DONE (merged by record, branch not in base) — verify`; one whose worktree has uncommitted files reads `DONE (worktree dirty)`. A branch matched to an older issue only by its `jarl/NNN-` number, with no **Branch:** behind it, is judged by ancestry to the base alone. `status` lists the same stale leases.
- A stale lease is shown for the jarl to act on — ask the worker, re-raise, or set the issues back to `open`. Nothing expires and nothing is taken over automatically: that is Horde's territory.

**A merge is a field.** After merging, the merger runs `merged <ids> --sha <merge sha>` (`--repo <path>` when it landed in another repository than the issue's), which records **Merged:** and **CI:** `pending` with one log line per issue, then `merged <ids> --ci green|red` when CI reports (`--ci none` for a repository with no CI). `status` counts `merged, CI pending N` and `CI red N`. `set done` on an issue whose CI is not green says so on stderr and closes it anyway — it records, it never gates the landing.

### The merge queue

`queue` is what waits for the merger, computed from the record every time and never stored: a branch is in it when an open or in-progress issue on it holds a live approve (one no round, restart or reopen has spent, by someone other than its worker — the same reading as the done gate) and the branch has commits its base does not. The branch is the issue's **Branch:**, or for an issue from before that field the one `jarl/NNN-*` branch carrying its number. Rows come in the order the branches were approved and, per repository, are cut into batches the way the merger's brief batches them: a branch joins the current batch while its declared files share none with the batch, and starts the next one otherwise (a branch with no files declared rides alone). A package whose other issues still wait for their review is listed with them (`waiting for review: 164`). Once the branch is merged into its base it drops out by itself. With no `--repo` it reads the loop's own repository and every repository an issue names; `--base` replaces the checkout's current branch as the base.

It is a view, not a gate: it runs no check, holds no lock, refuses no merge and orders nothing on its own. The merger reads it instead of waiting for the jarl to name branches, and still verifies every branch as its brief says.

### Changelog fragments

Parallel branches that each add a line to `CHANGELOG.md` under `[Unreleased]` conflict at nearly every merge, in the one place every issue touches. So the entry lives on the issue until the merge: the worker records it with `body <id> --changelog "Added: …"` (repeat the flag for more lines; the jarl can file it with `new --changelog`), and never edits `CHANGELOG.md` on its branch. An entry opens with its Keep a Changelog section — `Added:`, `Changed:`, `Deprecated:`, `Removed:`, `Fixed:` or `Security:` — and one without goes under Fixed for a `bug` and Changed for anything else. An issue with no user-visible change has no Changelog section.

`changelog <ids>` prints the entries of those issues grouped by section, in Keep a Changelog order, ready to paste under `[Unreleased]`; when the issues span several repositories it prints one block per repository (an issue naming two appears in both), and `--repo <path>` keeps one. An issue without an entry is named on stderr. The merger writes `CHANGELOG.md` once, after the merge (or the batch) is green, in its own commit on the feature branch. Nothing changes in the repository's layout: the fragment is a section of the issue, and the repository keeps its one changelog. A loop whose workers already edit `CHANGELOG.md` keeps working as before; `check` still counts a changelog edit as in scope.

**A committed loop commits itself.** In the committed and permanent modes, `status`, `handoff write`, `handoff read` and `close` name how many loop files git has not committed (`git status` of `.jarl/` in the loop's repository). A loop whose code lives in another repository has no merge in its own repository to ride on, so without this the record in git contradicts itself. The count is silent in the default mode and outside a git repository.

### From research to issues

A research round leaves a `findings.json` beside its report. `import <findings.json>` files one issue per finding, and each carries **Source:** `<report dir>#<finding id>`. The report directory is dated, so that pair names one finding for good. The directory is the one holding the file, written from the root of its repository (`core/research/2026-09-25-jarl`), or given with `--source <dir>`. Import is idempotent. A finding whose Source an issue already carries is skipped, so a re-run files nothing twice. A finding named by an older issue that has no **Source:** is not filed again either: `import` reports it, and `--adopt` writes the Source onto that issue. "Named" is read narrowly: the issue's title and its What, Why and Acceptance count, a header field never does, and Evidence only under the strictest rule: an id that reads as unique on its own, on an Evidence line that also names the report directory (a package issue's `Source: <report dir>/report.md … Ids: a-b-01, a-b-02`). An id that reads as unique on its own (a dash and at least eight characters, like `jarl-2-B2`) is enough there by itself. A short id (`F1`, `C1`, `2`), or any id from the angles shape, also needs its report named in the same issue: the report directory's name, or the full `<angle>/<id>`. When two issues name it, import reports it as ambiguous and leaves both alone. `--dry-run` prints what it would do, and `--only <ids>` takes part of the file. `--kind`, `--prio`, `--tier`, `--tags`, `--repo` and `--found-by` replace the mapped values for every issue filed.

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

### Templates

An issue that is filed again and again in the same shape — a release phase, a triage of a bug report, a dependency bump — is written once as a template: `.jarl/templates/<name>.md`, an issue file without a number. Its header fields **Kind:**, **Priority:**, **Tier:**, **Tags:** and **Files:** are defaults, and its What, Why, Acceptance and Changelog sections are the body. `new "<title>" --template <name>` files an issue from it; any flag given on the call replaces the template's value, field by field and section by section. The first line of the template is ignored, and a name is letters, digits and `. _ -`. Templates belong to the place, not to one loop: `archive` leaves them in `.jarl/`. In the default mode they are out of git like the rest of the loop, and `close` removes them with it.

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
A phase skipped here is found by a user after the tag.

## Acceptance
- every step of the phase is done, with a --ran/--saw row per step
- the phase's own check is green
```

```
jarl.mjs new "Release 7.0.0 · A: freeze and dry run" --template release-phase --acceptance "dry run prints no finding" --acceptance "every repository's release branch is cut"
jarl.mjs new "Release 7.0.0 · B: versions and changelogs" --template release-phase --after 301
jarl.mjs new "Release 7.0.0 · C: tags and CI" --template release-phase --after 302
```

Each acceptance line is one step, and `set done` notes a phase closed with fewer `--ran`/`--saw` rows than steps. Nothing here tags, releases or refuses anything; see [What Jarl will not grow](#what-jarl-will-not-grow).

### Views for dashboards

Jarl ships no UI. A dashboard, a release board or a weekly summary is rendered by the host (a page, an artifact, a script) from the JSON the tool already prints, so every number on it comes from the record. Every command takes `--json`. The shapes below are stable: keys are added over time and never renamed or removed without a note in the changelog.

- **`status --json`**: `open`, `in-progress`, `done`, `dropped`, `deferred` (counts per status); `ready` (open, not waiting), `inFlight` (in progress, not waiting), `waiting` and `waitingIds` (After not settled); `noAcceptance` (in-progress ids with no acceptance line); `questions` (open asks that are not ratify), `ratify` and `toRatify` (`[{ id, state, kind, target, issue, question }]`); `goal`, `opened`, `lastActivity` (log stamps, `YYYY-MM-DD HH:MM` UTC), `archived` (how many archived loops); `stale` (`[{ id, problems: [text] }]`); `ciPending`, `ciRed` (ids); `handoff` (`{ at, ageMs, staleByMs, stale }` or null); `reviews` (`{ fresh, coordinator, self, unrecorded }`); `uncommitted` (count, or null outside the committed modes). With `--by repo|tag|kind|prio`, also `by: { key, groups: { <name>: { open, in-progress, done, dropped, deferred } } }` — an issue naming two repositories, or carrying two tags, counts in each group; an untagged one under `(none)`.
- **`report --json`**: `done`, `dropped`, `deferred`, `left`, `found` (counts); `reviews` (as above); `byRepo` (`{ <repo>: [done ids] }`); `text` (the report as printed); `issues`, one row per issue: `{ id, title, status, kind, priority, tier, tags, repos, branch, after, sources, merged, ci, review }`, where `repos` are the repository names it counts under, `merged` the recorded sha or null, `ci` its state or null, and `review` the last approve as `{ by, kind, at }` (by and kind null for an approve from before `--by`) or null.
- **`queue --json`**: `repos: [{ repo, path, base, rows: [{ branch, issues, waitingReview, ready, ahead, approvedAt, by, files, batch }] }]`, rows in merge order.
- **`tips --json`**: `gh` (whether CI could be asked) and `repos: [{ repo, path, rows: [{ role, branch, sha, upstream, against, ahead, behind, pushed, issues?, ci? }], merged? }]`; a branch that is gone is `{ role, branch, sha: null, missing: true }`.
- **`list --json`**, **`show <id> --json`**: the parsed issue (`list` an array of them) — `file`, `id`, `title`, `status`, `kind`, `priority`, `tier`, `tags`, `files`, `after`, `sources`, `fields` (every header field by lower-case name) and `sections` (every section's text by lower-case name).

## The loop

Every turn, in this order:

0. **Continue or archive — once per session.** When a session first meets a `.jarl/` that already holds
   a loop, run `status` (goal, when it was opened, last activity) and ask the user once whether this
   session continues that loop or archives it (`archive "<slug>"`, then `init "<goal>"`). Ask only at
   that first contact, never again on each `new` or `evidence` in the same work.
1. **Boot.** `handoff read` (a handoff marked STALE is a pointer, not the state: trust the live parts it prints), then `goal.md`, `decisions --live` (the rulings in force), the tail of `log.md`, `status`, `list`, `tips` when the loop's issues name other repositories, `queue`, and
   `branches` — a worker branch with commits beyond the feature branch is a report, whether or not the
   worker said so. Open questions come first: the user may have answered one since.
2. **File.** Anything anybody saw becomes an issue before anything else happens. Nobody fixes on the
   side. A worker reports what it found; the jarl files it, so numbers never collide.
3. **Pick.** `jarl.mjs next` lists what can run now: open issues whose files do not overlap with anything
   in progress and whose **After:** issues are settled. Priority first, then whatever unblocks the most.
   An issue marked `(no acceptance yet)` gets its acceptance line first (`body <id> --acceptance`).
   `set <ids> in-progress "<who>" --branch jarl/NNN-slug --worker <name> --worktree <path>` before
   raising the worker — one issue, or a package of small neighbouring ones on one branch (see
   [Packages and leases](#packages-and-leases)).
4. **Raise a worker.** One worker per issue or per package, in its own worktree, on branch `jarl/NNN-slug` (NNN the package's first issue) cut from
   the feature branch — every agent that may write anything, a research issue's worker included,
   gets its own worktree; only the jarl works in the main checkout, and read-only readers and
   verifiers need none — on the tier the issue names — set it explicitly on every spawn, never inherited —
   and tell the worker it spawns nothing itself. The brief is below; the issue file is pasted into it
   verbatim, and after three red rounds the takeover block from `round` goes in too, for a fresh worker.
5. **Review.** A worker's report is a hypothesis. A **fresh one-shot reviewer** — never the worker,
   never the merger — reads the issue and the diff and answers with the review discipline's three
   words: Critical, Important, Minor. Critical or Important is `review <id> changes --by <reviewer> "…"` and a round
   back to the worker; Minor alone is `review <id> approve --by <reviewer> "…"` with the minor points in the findings,
   never a bounce. `--by` names who reviewed; the tool refuses an approve by the issue's worker. The reviewer checks that the new test was red before the change and green after,
   that the acceptance line is met literally, and that nothing outside the issue moved. The reviewer's
   brief is below.
6. **Merge.** The merger (below) does it: into the feature branch with a merge commit that names
   the issue, then `evidence <id> --ran "<check>" --saw "<what it printed, merge sha>"`, `set <id> done`, worktree and branch removed. Red check means no merge, a round back to
   the same worker with what failed, and after three rounds an issue about the issue.
7. **Repeat** until nothing is open, then close the branch (below). Before the session ends, or every
   few merges, `handoff write` — the next session boots from it.

Testing, stress and research sessions are the same loop with a different mix: some workers produce
issues (they test, they probe, they read) while others take issues down. The stream never waits for
the other side.

### Worker branches

A worker's branch is `jarl/NNN-slug`: the issue number and the issue's own slug, so two workers can
never share a name and a branch reads as its issue. Such a branch exists only in the clone running
the loop: it is cut from the feature branch, merged back into it by the merger with `--no-ff` and a
message naming the issue, and deleted together with its worktree. **It is never pushed** — the
feature branch is the only branch of this loop that ever leaves the machine, and only on the user's
word. Two loops sharing one clone prefix the branch with the feature branch's last path segment.
In the default mode a worker branch never carries `.jarl/`; in the committed mode it carries the copy
it was cut with, which nobody writes — the loop's live state is the main checkout's, reached with `--root`.

### Code in another repository

A loop can keep its issues in one repository while its workers change another: a repository of plans and notes directing work in the code beside it, or one loop directing several repositories at once. The loop stays where `.jarl/` lives, in either mode, and every role still reaches it with `--root` pointing there. The code side moves to the other repository:

- **The issue names it.** `new --repo <path>` writes **Repo:** into the issue; `repo <id> <path>` sets it on an issue already filed. The path is that repository's main checkout. An issue whose change spans several repositories names them all as one comma list (`--repo ../tool,../lib` → **Repo:** `../tool, ../lib`); each of its files then starts with the name of the repository it is in (`tool/src/a.mjs, lib/src/a.mjs`), a file with none of the names is in the first one, `next` keeps each (repository, path) pair apart, `check` on it takes `--repo` to say which repository to read and bounds the diff by the files declared in that one, `branches` and `tips` read all of them, and `report` lists the issue under each. A relative path is read from the loop's root (the directory holding `.jarl/`), never from wherever the tool is called, so every role resolves it the same. An issue without **Repo:** is read in the loop's own repository, as always.
- **Its files carry the repository's name.** Each file in **Files:** starts with that repository's directory name — the last segment of the **Repo:** path — and goes on with the path inside it: **Repo:** `../tool` → **Files:** `tool/src/a.mjs, tool/CHANGELOG.md`. A reader of the issue sees where each file lives, and `next` reads a file as its repository and its path: `CHANGELOG.md` in two repositories never holds an issue back, two repositories that share a directory name are still told apart by their **Repo:**, and two issues on the same file in one repository still wait for each other. An issue without **Repo:** writes its paths without a name, as in a single-repository loop. One case is decided by rule, not by guess: a repository that has a directory of its own name inside it (repository `app` with `app/x.mjs`). There the prefix is required — `app/app/x.mjs` is `app/x.mjs` inside the repository — and an entry that starts with `app/` but not `app/app/` is a path inside the repository and is never stripped. A repository is one repository however its **Repo:** path is spelled (a symlink, or another case where the file system ignores case), and `--repo` on `check` reads Files the same way the field does.
- **`check` reads there.** Commits, files and assertions come from the worker branch in that repository, against its current branch as the base; `--repo <path>` on one call does the same and wins over the field. The repository's name is dropped from each declared file, and the path after it is matched against the branch's changed files.
- **`branches` reads there with `--repo <path>`.** Without it, it lists the loop's own repository only, so at boot run it once per repository the open issues name.
- **The worker, the reviewer and the merger work there.** The worker's worktree and its `jarl/NNN-slug` branch are cut in that repository from its own feature branch, and that is the branch the brief names; the reviewer diffs there; the merger merges and runs the check in that repository's main checkout. `.jarl/` never enters that repository.
- **`handoff write`** records that repository's head beside the loop's own.

### The worker's brief

```
You are worker <name> on issue NNN of branch <feature-branch>, in worktree <path>, on branch jarl/NNN-slug.
(When the issue carries a **Repo:** field, <feature-branch>, <path> and the branch are all in THAT repository, not in the loop's own: run git and the repository's check there.)
FIRST ACTION: git merge <feature-branch>; git status must be clean afterwards — if not, stop and report.
If your worktree was made for you by the platform and starts on a branch it named, RENAME that branch
(`git branch -m jarl/NNN-slug`); never create a second branch beside it, which leaves the first one behind.
Your scope is the issue below and nothing else. Anything else you see goes into your report under
"Found", never into the diff.
The loop's tool is <absolute path to jarl.mjs>; call it with `--root <main checkout>` (from a worktree of the same repository it finds the loop by itself, but pass it anyway) — your
worktree has no live `.jarl/` of its own — and never add `.jarl/` to your branch.
If the change is user-visible and the repository keeps a CHANGELOG.md, do not edit it: record the entry on the issue,
`jarl.mjs body NNN --changelog "Added: …" --root <main checkout>` (Changed, Fixed, … — one flag per line); the merger
writes the changelog.
Prove the change: a test that is red before and green after. Run the test files your change touches,
in the foreground, with the shell tool's own timeout parameter set (a run that outlives the tool's
default timeout is moved to the background and you will sit waiting for a notification that is not
a report). Do not run the repository's whole check yourself: the merger runs it on the merged result
and that run is the one that counts. A report that says "waiting for the test run" is not a report.
Commit on your branch. Never push. Never touch another branch. Never weaken a test, a check, a rule
or a hook — if the issue seems to need that, stop and report. To hold work aside while you check a
red-before state, copy the file to a scratch path (a tmpdir), never `git stash` — the stash list is
one shared list across every worktree of this repository, and a worker that stashes while another
does the same can pop the wrong entry.
Report in under 200 words: what changed, the evidence (commands and what they printed),
"Found" (new issues, if any), and `git log -1 --oneline` of your commit.
You spawn no agents of your own.

<the issue file, verbatim>
```

### The reviewer's brief

```
You are the reviewer of issue NNN on branch jarl/NNN-slug of <repo root>. The loop's tool is
<absolute path to jarl.mjs>, always called with `--root <repo root>` (in the default mode the issue
exists only there, never in git). Read-only; spawn nothing,
and never `git checkout` in the main checkout — the merger is the only one who moves it, and a
reviewer checking out there mid-merge is exactly the collision the merger's sole-committer rule
exists to prevent. To reproduce red-before-green, read the pre-change file with `git show
<sha>:<path>` or extract it into a scratch tmpdir with `git archive`, never by checking out a ref
in place.
Read the issue (`jarl.mjs show NNN --root <repo root>`), then `git diff <feature-branch>...jarl/NNN-slug` — in
the repository the issue's **Repo:** names when it names one, the loop's own otherwise. Answer three questions with
evidence: does the diff meet the acceptance line literally (quote it in the findings; an issue with none is
itself a finding); was the new test red before the change
and green after; did anything outside the issue's scope move. Rank every finding Critical / Important / Minor. Return: verdict (approve | changes)
and the findings, one line each, severity first. Minor findings alone are an approve.
```

### The merger

Verifying and merging eats context, and the jarl's context is the scarcest thing in the loop. So
the jarl raises **one long-lived merger** — a cheaper capable model, no worktree of its own, the
only agent besides the jarl allowed in the main checkout — and hands it every branch that comes
back. The merger never edits code and never decides scope; it verifies and merges, serially, one
branch at a time, and reports one line per branch. When a merger exists the jarl merges nothing
itself, and **the merger is the only committer in the main checkout**: everybody else writes
`.jarl/` through the tool and never runs a commit there — two committers in one checkout, one of
them mid-merge, is how a conflict swallows the other's files. In the committed mode the merger commits `.jarl/` together
with every merge, so the loop's state always rides the code it describes; in the default mode git never
sees `.jarl/`, so the merger never commits it. Its brief:

```
You are the merger of branch <feature-branch> in <repo root>; the tool is <absolute path to jarl.mjs>,
always called with `--root <repo root>`. The loop is in the <default | committed | permanent> mode. In
the permanent mode `.jarl/` is committed exactly as in the committed mode, and that commit is never
later stripped — there is no last commit before a merge to `main` that removes it, because a permanent
loop is never merged to `main` and never closed by removing `.jarl/`. Merging itself does not otherwise
differ: an issue that names another repository (**Repo:**) still merges there, into that repository's
own current branch, exactly as in every other mode — a permanent loop has no feature branch of its own,
so it holds no worker branches to merge unless an issue names none, in which case it merges directly
into whatever branch the loop's root already sits on (there is no throwaway feature branch of the
loop's own to merge into and later discard).
When an issue's **Repo:** names another repository, its branch, its merge and its check live in that
repository's main checkout — run git and the check there, list its branches with
`jarl.mjs branches --repo <path>`; `jarl.mjs check` reads there on its own; `.jarl/`, `--root` and,
in the committed mode, the commit of `.jarl/` stay in <repo root>.
You work in the main checkout, serially, one branch at a time. You never edit source files, never
push a worker's branch, never push anything the loop's rules do not allow (see "Standing permission
to push" in the jarl's own instructions: when `goal.md` or a ruling gives it, the merger's brief says
so and names the feature branch), never resolve a conflict by picking a side blindly, never weaken a
test or a check.
For each branch the jarl names, or that `jarl.mjs queue` lists (approved, ahead of its base, in merge order and
batches), or that `jarl.mjs branches` shows with commits beyond the base:
1. `jarl.mjs check <id> --branch <b>` (`jarl.mjs check --branch <b>` for a package); read the diff (`git diff <feature-branch>...<b>`); a worker
   worktree with an uncommitted but complete diff is committed on its branch first, with a log line
   saying the merger committed it; a branch the worker never renamed (UNNAMED in `branches`) is
   renamed to `jarl/NNN-slug` in its worktree (`git branch -m`) before anything else. A branch without an approving review (`jarl.mjs set` will refuse
   `done` without one) waits for the reviewer; it is not the merger's call. In the default mode a
   branch whose diff touches `.jarl/` is not merged — git treats the ignored loop as expendable and
   would overwrite it — it is reported.
2. In the committed mode, commit whatever `.jarl/` holds first (the reeve writes there while you work, and an uncommitted
   file in a checkout you are about to reset is a file about to vanish); in the default mode there is
   nothing to commit, and neither a merge nor a reset touches the ignored loop. Then `git merge --no-ff <b>`
   into the feature branch. A conflict: resolve only when one side is plainly a superset or the hunks
   are independent; otherwise `git merge --abort` and report the files.
3. Run the repository's own check in the foreground, with the shell tool's own timeout parameter set
   for the whole run, and wait for it. Red: roll back with `git reset --keep ORIG_HEAD` — never
   `--hard`, which would also discard what others wrote meanwhile — then
   `jarl.mjs round <id> "<what failed>"`, report.
4. Green: `jarl.mjs merged <ids> --sha <merge sha>` (`--ci none` when the repository has no CI; else
   `jarl.mjs merged <ids> --ci green|red` once it reports), `jarl.mjs evidence <id> --ran "<the check command>" --saw "<its summary line, merge sha>"`, `jarl.mjs set <id> done`,
   remove the worktree and the branch — `jarl/NNN-slug` AND, when the worker began on a branch of another
   name and made `jarl/NNN-slug` beside it instead of renaming it, that original branch too (read it off
   `git worktree list` before removing the worktree, and off `jarl.mjs branches`; a branch left behind is a
   dead branch someone cleans up by hand; `jarl.mjs branches` marks it `DONE → delete`) — then, in the committed
   and permanent modes only, commit `.jarl/` (everything in it, including what the reeve wrote meanwhile) on the
   feature branch — you are its only committer; in the default mode `.jarl/` is never committed. When the
   merge happened in another repository, commit `.jarl/` in the loop's repository after recording it: nothing
   else will, and `status` counts the loop files left uncommitted.
   When the issues carry changelog entries, `jarl.mjs changelog <ids> --repo <path>` prints them; paste them under
   `[Unreleased]` in that repository's CHANGELOG.md, verbatim, and commit that file alone ("changelog: <ids>") —
   the one file you write, and only from the tool's output.
   Before moving to the next branch, `jarl.mjs show <id>` and confirm it reads
   `done` — a write that silently failed to land is worse than one that never ran. The tool locks
   and refuses loudly now, but a call whose exit code nobody read is still a write nobody saw.
Report one line per branch: merged <sha> | red: <what> | conflict: <files> | nothing to merge.
When several approved branches wait and their declared files do not overlap, merge them one after
another and run the check once for the batch; a red batch is rolled back whole (`git reset --keep`
to the commit before the first merge) and re-done one branch at a time, so the red one is found and
the green ones still land. Never batch two branches that touch the same file.
Spawn no agents.
```

## What goes to the user

Decide yourself inside the goal. Stop and ask when:

- the goal or a standing decision would change;
- something that protects would get weaker: a test, an assertion, a check, a rule, a hook, a CI step;
- a number would enter the code without an origin you can name;
- a merge conflict cannot be resolved without losing one side's behaviour;
- the work would reach outside the session — a push, a release, a cost.

Ask well: where you are, what you found, the options with trade-offs, your recommendation. Never an
open "what should I do". File it with `ask`, keep the rest of the loop moving, and record the answer
with `answer` — it becomes a ruling in `decisions.md`.

**Decided under a mandate.** When the user has handed the loop a mandate to decide on its own ("decide
and go on, I'll look later") and it decides something that is the user's (from the list above), the
choice is always filed as `ask --kind ratify [--issue NNN] "<what was decided, and why>"`, never left in
evidence prose. A ratify item blocks nothing: the work goes on, `next` and `done` ignore it. It is
listed in `status` (`to ratify N`, one line each) and under its own heading in the handoff until the
user answers. `answer` records the answer as a ruling and writes it into the issue's evidence. When the
user rejects the choice, file the undoing as a new issue.

## Closing the branch

Before the feature branch merges to `main`, in this order:

1. Every issue is `done` with evidence, or `dropped` or `deferred` with a reason, or listed to the user as still open.
2. `report` is the material: the repository's changelog carries every user-visible change from it, in the
   register the repository asks for; entries still on issues (see [Changelog fragments](#changelog-fragments)) are
   printed by `changelog <ids>`.
3. The repository's own check is green on the branch tip.
4. `jarl.mjs close` removes `.jarl/` — it refuses while anything is still open. In the committed mode
   that removal is the last commit, so `main` never carries the directory; in the default mode there
   is nothing to commit — git never saw it.

Merging and pushing are the user's word, never yours.

### Standing permission to push the feature branch

Some loops have that word already, for good: the user has said the loop commits and pushes the
feature branch as it goes (a release loop that keeps `release/<version>` on the remote, say). That
permission is a rule of the loop, so it is written where the loop's rules live: a line in `goal.md`'s
rules, or a ruling in `decisions.md` quoting the user's words, naming the branch it covers. With it
on file, the merger's brief says so: after a green merge into the feature branch, push that branch.
A worker's branch `jarl/NNN-slug` is never pushed, with or without it, and nothing beyond the
feature branch is covered by it. Without such a line, a push is still the user's word each time.

### Closing a permanent loop

A loop opened with `init --permanent` has no feature branch to close, so this section applies with
one difference, at step 4: nothing above it changes — every issue still needs to be `done` or
`dropped` before closing, `report` still feeds the changelog, the repository's own check still needs
to be green. But `jarl.mjs close` in this mode never removes `.jarl/`: it refuses exactly as above
while anything is open or in progress, and once clean it appends a closing line to `log.md` and
leaves the directory in place — the record `--root` named stays where it was, for the next release,
or the next session, to read.

## The reeve: handing the loop down

The jarl's context is spent best on the client and on judgement, so once the loop is open the
jarl raises **one long-lived reeve** on the standard tier and hands it the loop. The reeve runs
this skill exactly as the jarl would — boot, file, pick, raise workers and reviewers, keep the
merger fed, write the handoff — with one difference: it never talks to the user. It reports to the
jarl, in one line, on four occasions only: a research issue or a gap the goal did not foresee; a
question the user answered in a way that changes the goal; every few merges, the counts; and an
empty queue. The jarl stays the one who answers the client and rules on what the reeve raises.
Everything the reeve raises is its own to reach — a worker, a reviewer, a merger — so the reeve
holds all of them and the jarl holds the reeve. Its brief is this whole skill, plus the repository,
the feature branch, the absolute path of the tool, and the four occasions above.

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

## Which model sits where

Opening the loop — reading the repository whole, writing the goal, the first rulings and the first
issues — is the one part that needs the strongest model in the room. The loop itself is clerical
work over a tool that refuses what is wrong: the reeve, on the standard tier, runs it, hands out
issues, reads reports and keeps the journal, and hands back to the jarl only on the four occasions
above. Workers, readers, reviewers and the merger run on the standard tier unless an
issue's own `Tier:` says otherwise. Say which tier is running at every handoff.

## Talking to the user

One sentence of state at boot: how many open, how many in flight, what you do first. "How is it going"
gets an assessment, not a list. Plain words, no internal names; the user reads what happened, not how
the loop works.

## What Jarl will not grow

Jarl records, derives and displays; it never blocks code from landing. Every scale request is measured against that line. On Jarl's side: filing and importing issues, refusals at the level of the record (a `done` without evidence or a fresh approve, a self-approve, a cycle of After), review provenance, read-only views (`status`, `report`, `tips`, `queue`, `branches`), ordering by After, branch packages, leases that are shown and never expire, merges and CI recorded as fields, changelog fragments, templates. Past the line, and so Horde's, not Jarl's:

1. **A merge queue that runs the repository's check and refuses the merge.** `queue` lists; it never lands anything. Running the check and saying no is Horde's land.
2. **A `done` that waits for green CI.** CI is recorded and noted (`set done` says when it is not green), never required: a CI-gated `done` is a landing gate in all but name.
3. **Leases that expire or are taken over automatically, or territory locks across loops.** A stale lease is shown for the jarl to act on; nothing moves by itself.
4. **A release mode that refuses to tag or release.** A release checklist is issues filed from a template; the procedure belongs to the skill that runs releases, and the tags to each repository's own release workflow.
5. **A computed wave or critical-path planner.** `next` offers what can run now; After is ordering and bookkeeping, not a schedule.

A request that needs any of these needs Horde's rails, not a bigger Jarl.

## Boundary with other skills

Jarl is the loop; it does not replace discipline. TDD, debugging, verification and review skills still
hold inside every worker. Urd's "ask, don't guess" holds inside the jarl. Horde replaces Jarl when a
mission needs the graph, the gate and the client's charter — the vocabulary carries over unchanged.
