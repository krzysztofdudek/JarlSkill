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
- **Committed — `init --committed`.** No `.gitignore` is written; the loop is committed with the work on the feature branch. The merger commits `.jarl/` with every merge, and the last commit before the branch merges to `main` removes the whole directory.
- **Permanent — `init --permanent`.** No `.gitignore` either — a record that must survive is always committed — and `init` additionally writes `.jarl/.permanent`, so a later session reads the mode from the loop itself rather than being told. This loop does not live on a feature branch at all: it lives wherever `--root` points, kept as a standing record, for example a repository that keeps one loop per release as that release's record, driving work in other repositories. Everything above — the four files, the issue format, the roles, the tool — is the same; only closing differs, in [Closing the branch](#closing-the-branch) below.

A loop with `.jarl/.gitignore` is in the default mode; one without it is committed, and one that also
carries `.jarl/.permanent` is the permanent mode. Only `init` decides the mode of a new loop — no other
command touches `.jarl/.gitignore`, so a loop opened before a mode existed keeps behaving as it did.
`mode permanent` is the one exception: it turns an *existing, committed* loop into the permanent mode
in place, for a loop opened before 005 or opened `--committed` — the release loop that drove 6.1.0 was
exactly this case. It refuses a default-mode loop (out of git): a permanent record must be committed,
and there is no in-place way to add git tracking to one, so start a fresh loop with `init --permanent`
instead. It refuses an already-permanent loop too, clearly, rather than silently doing nothing. See the
command table below. Four things:

| Path | What | Who writes |
|---|---|---|
| `.jarl/goal.md` | Why this branch exists, in one paragraph; the standing assumptions; the rules that apply here. Written once at the start, amended only with the user's word. | jarl |
| `.jarl/decisions.md` | Rulings, append-only: `## YYYY-MM-DD · slug` and the ruling. Read before deciding anything; never re-derive a ruling that is here. | jarl |
| `.jarl/issues/NNN-slug.md` | One issue per file, numbered in filing order from 001. Format below. | jarl (header, status), worker (evidence) |
| `.jarl/log.md` | The journal, append-only, one dated line per event: filed, started, done, dropped, merged, asked, decided. | everyone, through the jarl |

Markdown is the source of truth, and **one tool moves it**: `scripts/jarl.mjs` (Node, zero
dependencies). Every status change, tag, priority, ruling and log line goes through it, never through
a hand edit — a status that changed without a log line did not change, and the tool is what makes that
true rather than promised. Run it as:

```
node "${CLAUDE_PLUGIN_ROOT:-.claude/skills/jarl}/scripts/jarl.mjs" <command>
```

| Command | What it does |
|---|---|
| `init "<goal>" [--committed] [--permanent]` | creates `.jarl/` with the goal and a `.gitignore` that keeps the loop out of git; `--committed` writes no `.gitignore`, so the loop is committed with the work; `--permanent` also writes no `.gitignore`, adds `.jarl/.permanent`, and opens the loop with no feature branch of its own — see [The one place](#the-one-place) |
| `new "<title>" [--kind k] [--prio 1\|2\|3] [--tier standard\|strong] [--tags a,b] [--files p,q] [--repo <path>] [--found-by who]` | files an issue under the next free number; `--repo` names the repository its code lives in when that is not the loop's own (see [Code in another repository](#code-in-another-repository)) |
| `list [--status s] [--kind k] [--tag t] [--prio p] [--grep re] [--all]` | open and in-progress by default, sorted by priority |
| `show <id>` · `status` | one issue · one line of counts |
| `set <id> <status> "<why>"` | changes status and writes the log line in one move; `done` needs evidence on file, `dropped` and `deferred` need a reason (`deferred` is work that waits, not work that is gone: the default `list` hides it, `list --status deferred` shows it, `status` and `report` count it apart, and `close` says what it leaves waiting) |
| `tag <id> +a -b` · `prio <id> 1\|2\|3` · `files <id> p,q` · `repo <id> <path>` | header fields |
| `evidence <id> "<text>"` \| `evidence <id> --ran "<command>" --saw "<what it printed>"` | appends a free-text note, or one checkable row per `--ran`/`--saw` pair (repeat the pair for more rows, in one call or several) — `--ran`/`--saw` when the proof is a command, free text when it is not; nothing already recorded is ever replaced |
| `next [--limit n]` | open issues that share no file with any in-progress one — what can run in parallel now; a file is its repository and its path, so the same path in two repositories never holds an issue back |
| `review <id> approve\|changes "<findings>"` | the reviewer's verdict; `changes` needs a finding ranked Critical or Important in the text — Minor alone cannot bounce a branch, it rides an approve into evidence; `done` refuses without an approve newer than the last round |
| `round <id> "<what failed>"` | one red round on the issue; the third prints a takeover block for a fresh worker |
| `check <id> --branch <b> [--repo <path>]` | a worker branch before merge: commits beyond the base, diff inside the declared files, test files removed, assertions before and after, each item's own ok/not — read the items, not just the exit code; a script gate can use the exit code (0 clean, 2 something failed), a reader should not stop there. Read in `--repo`, else in the repository the issue's **Repo:** names, else in the loop's own |
| `branches [--repo <path>]` | with no `--repo`, in the loop's own repository and in every repository an open or in-progress issue names (rows of another repository are labelled `[name]`); with it, in that one repository: every `jarl/NNN-*` branch, and every other branch a worktree has checked out (marked UNNAMED when a worker never renamed its branch), with commits beyond the base and worktree state — a branch with commits is a report whether or not the worker said so. Read in `--repo`, else in the loop's own repository |
| `ask "<question>" --kind stop\|stuck\|lower\|charter [--target x] [--issue NNN]` · `answer <id> "<answer>"` | questions only the user can answer, in a closed set of kinds — `stop` halts everything, `stuck` blocks one issue, `lower` weakens something protected (`--target` names it), `charter` questions the goal; open ones show in `status`; an answer becomes a ruling |
| `handoff write --summary "<s>" [--next "<n>"]...` · `handoff read` | the state of intent between sessions: what is in flight, what waits on the user, what comes next; the header records the loop's head and the head of every other repository an unfinished issue names |
| `log "<event>"` · `decide <slug> "<ruling>"` | the journal and the rulings |
| `report` | done, dropped and deferred with reasons, still open, found along the way — the material for the changelog |
| `mode permanent` | turns an existing, committed loop into the permanent mode, with a log line — for a loop opened before the mode existed, or opened `--committed`; refuses a default-mode loop (out of git — a permanent record must be committed) and an already-permanent loop |
| `close [--force]` | refuses while anything is open or in progress; otherwise removes `.jarl/` — in the permanent mode it keeps the directory instead and logs the close |

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
**Found by:** who, doing what
**Where:** file:line, or the command and what it printed

## What
One paragraph: the fact.

## Why
What it costs if left as is.

## Acceptance
Checkable. A test name, a command and its expected output, a sentence that is true or false.

## Evidence
Filled at done: the command that was run and what it printed, the test that is green, the commit.
```

`dropped` and `deferred` always carry a reason under **Evidence**, after whatever was already written there. A `research` issue produces a written result
and files new issues; it never edits code.

## The loop

Every turn, in this order:

1. **Boot.** `handoff read`, then `goal.md`, `decisions.md`, the tail of `log.md`, `status`, `list`, and
   `branches` — a worker branch with commits beyond the feature branch is a report, whether or not the
   worker said so. Open questions come first: the user may have answered one since.
2. **File.** Anything anybody saw becomes an issue before anything else happens. Nobody fixes on the
   side. A worker reports what it found; the jarl files it, so numbers never collide.
3. **Pick.** `jarl.mjs next` lists what can run now: open issues whose files do not overlap with anything
   in progress. Priority first, then whatever unblocks the most. `set <id> in-progress "<who>"` before
   raising the worker.
4. **Raise a worker.** One worker per issue, in its own worktree, on branch `jarl/NNN-slug` cut from
   the feature branch — every agent that may write anything, a research issue's worker included,
   gets its own worktree; only the jarl works in the main checkout, and read-only readers and
   verifiers need none — on the tier the issue names — set it explicitly on every spawn, never inherited —
   and tell the worker it spawns nothing itself. The brief is below; the issue file is pasted into it
   verbatim, and after three red rounds the takeover block from `round` goes in too, for a fresh worker.
5. **Review.** A worker's report is a hypothesis. A **fresh one-shot reviewer** — never the worker,
   never the merger — reads the issue and the diff and answers with the review discipline's three
   words: Critical, Important, Minor. Critical or Important is `review <id> changes "…"` and a round
   back to the worker; Minor alone is `review <id> approve "…"` with the minor points in the findings,
   never a bounce. The reviewer checks that the new test was red before the change and green after,
   that the acceptance line is met literally, and that nothing outside the issue moved. The reviewer's
   brief is below.
6. **Merge.** The merger (below) does it: into the feature branch with a merge commit that names
   the issue, then `evidence <id> "…"`, `set <id> done`, worktree and branch removed. Red check means no merge, a round back to
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

- **The issue names it.** `new --repo <path>` writes **Repo:** into the issue; `repo <id> <path>` sets it on an issue already filed. The path is that repository's main checkout. A relative path is read from the loop's root (the directory holding `.jarl/`), never from wherever the tool is called, so every role resolves it the same. An issue without **Repo:** is read in the loop's own repository, as always.
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
evidence: does the diff meet the acceptance line literally; was the new test red before the change
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
For each branch the jarl names (or that `jarl.mjs branches` shows with commits beyond the base):
1. `jarl.mjs check <id> --branch <b>`; read the diff (`git diff <feature-branch>...<b>`); a worker
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
4. Green: `jarl.mjs evidence <id> "<check summary line, merge sha>"`, `jarl.mjs set <id> done`,
   remove the worktree and the branch — `jarl/NNN-slug` AND, when the worker began on a branch of another
   name and made `jarl/NNN-slug` beside it instead of renaming it, that original branch too (read it off
   `git worktree list` before removing the worktree, and off `jarl.mjs branches`; a branch left behind is a
   dead branch someone cleans up by hand) — `jarl.mjs log "merged <id> <sha>"`, then, in the committed
   mode only, commit `.jarl/` (everything in it, including what the reeve wrote meanwhile) on the
   feature branch — you are its only committer; in the default mode `.jarl/` is never committed.
   Before moving to the next branch, `jarl.mjs show <id>` and confirm it reads
   `done` — a write that silently failed to land is worse than one that never ran, and it has
   happened.
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

## Closing the branch

Before the feature branch merges to `main`, in this order:

1. Every issue is `done` with evidence, or `dropped` or `deferred` with a reason, or listed to the user as still open.
2. `report` is the material: the repository's changelog carries every user-visible change from it, in the
   register the repository asks for.
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

## Boundary with other skills

Jarl is the loop; it does not replace discipline. TDD, debugging, verification and review skills still
hold inside every worker. Urd's "ask, don't guess" holds inside the jarl. Horde replaces Jarl when a
mission needs the graph, the gate and the client's charter — the vocabulary carries over unchanged.
