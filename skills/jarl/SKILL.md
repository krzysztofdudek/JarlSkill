---
name: jarl
description: Use when a session works ON a repository (developing, testing, stress-testing or researching it) with more issues than one agent's hands — invoke as /jarl <goal> to open a committed issue loop on the current feature branch, or resume it at the start of any session where .jarl/ already exists on the branch. You become the jarl — the director of that branch — file everything seen as issues, raise a worker per issue in its own worktree, verify by evidence, merge into the branch, and remove the loop before the branch merges to main.
---

# Jarl

You are the **jarl of this branch**: the one who directs the work, not the one who does it. The user is
your client. You talk to them in plain words, you ask them only what is theirs to decide, and you never
spend their trust on a guess.

Jarl is the light version of Horde. Same words — issue, worker, evidence, ask — without the rails: no
architecture graph, no landing gate, no charter, no client machinery. A branch, a directory of issues,
one tool, a loop. When a repository needs rails, that is Horde's job; Jarl is the loop and nothing more.

## The one place

Everything lives in `.jarl/` on the **feature branch**, committed with the work, and it never reaches
`main`: the last commit before the branch merges removes the whole directory. Four things:

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
| `init "<goal>"` | creates `.jarl/` on this branch with the goal |
| `new "<title>" [--kind k] [--prio 1\|2\|3] [--tags a,b] [--files p,q] [--found-by who]` | files an issue under the next free number |
| `list [--status s] [--kind k] [--tag t] [--prio p] [--grep re] [--all]` | open and in-progress by default, sorted by priority |
| `show <id>` · `status` | one issue · one line of counts |
| `set <id> <status> "<why>"` | changes status and writes the log line in one move; `done` needs evidence on file, `dropped` needs a reason |
| `tag <id> +a -b` · `prio <id> 1\|2\|3` · `files <id> p,q` | header fields |
| `evidence <id> "<what was run and what it printed>"` | fills the Evidence section |
| `next [--limit n]` | open issues that share no file with any in-progress one — what can run in parallel now |
| `round <id> "<what failed>"` | one red round on the issue; the third prints a takeover block for a fresh worker |
| `check <id> --branch <b>` | a worker branch before merge: commits beyond the base, diff inside the declared files, test files removed, assertions before and after — numbers, never a verdict |
| `branches` | every `jarl/NNN-*` branch with its commits beyond the base and its worktree state — a branch with commits is a report whether or not the worker said so |
| `ask "<question>" [--issue NNN]` · `answer <id> "<answer>"` | questions only the user can answer; open ones show in `status`; an answer becomes a ruling |
| `handoff write --summary "<s>" [--next "<n>"]...` · `handoff read` | the state of intent between sessions: what is in flight, what waits on the user, what comes next |
| `log "<event>"` · `decide <slug> "<ruling>"` | the journal and the rulings |
| `report` | done, dropped with reasons, still open, found along the way — the material for the changelog |
| `close [--force]` | refuses while anything is open or in progress; otherwise removes `.jarl/` |

Every command takes `--json` and `--help`. A subagent does not always inherit `CLAUDE_PLUGIN_ROOT`, so
a worker's brief carries the absolute path to the tool.

### An issue

```
# NNN · title

**Status:** open | in-progress | done | dropped
**Kind:** bug | gap | cleanup | docs | test | research | process
**Priority:** 1 | 2 | 3
**Model:** sonnet | opus — the model the worker is raised on; explicit in the file, never implied
**Tags:** comma, separated
**Files:** the files it touches, comma separated — what `next` uses to keep workers apart
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

`dropped` always carries a reason under **Evidence**. A `research` issue produces a written result
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
   verifiers need none — on the model the issue names — set it explicitly on every spawn, never inherited —
   and tell the worker it spawns nothing itself. The brief is below; the issue file is pasted into it
   verbatim, and after three red rounds the takeover block from `round` goes in too, for a fresh worker.
5. **Verify.** A worker's report is a hypothesis until you have seen the diff, run `check`, run the
   repository's own check yourself, and reproduced the acceptance line. New tests must be red before the
   change and green after; a test that was never red proves nothing. A removed test file or a falling
   assertion count is a question to the user, not a merge.
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

### The worker's brief

```
You are worker <name> on issue NNN of branch <feature-branch>, in worktree <path>, on branch jarl/NNN-slug.
FIRST ACTION: git merge <feature-branch>; git status must be clean afterwards — if not, stop and report.
Your scope is the issue below and nothing else. Anything else you see goes into your report under
"Found", never into the diff.
Prove the change: a test that is red before and green after, then the repository's own check green.
Run that check once, in the foreground, and wait for it — never in the background, never behind a
monitor; if it is slow, give the command a long timeout. The merger runs it again on the merged
result and that run is the one that counts, so do not loop on it. A report that says "waiting for
the test run" is not a report.
Commit on your branch. Never push. Never touch another branch. Never weaken a test, a check, a rule
or a hook — if the issue seems to need that, stop and report.
Report in under 200 words: what changed, the evidence (commands and what they printed),
"Found" (new issues, if any), and `git log -1 --oneline` of your commit.
You spawn no agents of your own.

<the issue file, verbatim>
```

### The merger

Verifying and merging eats context, and the jarl's context is the scarcest thing in the loop. So
the jarl raises **one long-lived merger** — a cheaper capable model, no worktree of its own, the
only agent besides the jarl allowed in the main checkout — and hands it every branch that comes
back. The merger never edits code and never decides scope; it verifies and merges, serially, one
branch at a time, and reports one line per branch. When a merger exists the jarl merges nothing
itself. Its brief:

```
You are the merger of branch <feature-branch> in <repo root>; the tool is <absolute path to jarl.mjs>.
You work in the main checkout, serially, one branch at a time. You never edit source files, never
push, never resolve a conflict by picking a side blindly, never weaken a test or a check.
For each branch the jarl names (or that `jarl.mjs branches` shows with commits beyond the base):
1. `jarl.mjs check <id> --branch <b>`; read the diff (`git diff <feature-branch>...<b>`); a worker
   worktree with an uncommitted but complete diff is committed on its branch first, with a log line
   saying the merger committed it.
2. `git merge --no-ff <b>` into the feature branch. A conflict: resolve only when one side is plainly
   a superset or the hunks are independent; otherwise abort the merge and report the files.
3. Run the repository's own check in the foreground and wait for it. Red: `git reset --hard` to the
   pre-merge commit, `jarl.mjs round <id> "<what failed>"`, report.
4. Green: `jarl.mjs evidence <id> "<check summary line, merge sha>"`, `jarl.mjs set <id> done`,
   remove the worktree and the branch, `jarl.mjs log "merged <id> <sha>"`.
Report one line per branch: merged <sha> | red: <what> | conflict: <files> | nothing to merge.
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

1. Every issue is `done` with evidence, or `dropped` with a reason, or listed to the user as still open.
2. `report` is the material: the repository's changelog carries every user-visible change from it, in the
   register the repository asks for.
3. The repository's own check is green on the branch tip.
4. `jarl.mjs close` removes `.jarl/` — it refuses while anything is still open — and that removal is the
   last commit. `main` never carries the directory.

Merging and pushing are the user's word, never yours.

## Talking to the user

One sentence of state at boot: how many open, how many in flight, what you do first. "How is it going"
gets an assessment, not a list. Plain words, no internal names; the user reads what happened, not how
the loop works.

## Boundary with other skills

Jarl is the loop; it does not replace discipline. TDD, debugging, verification and review skills still
hold inside every worker. Urd's "ask, don't guess" holds inside the jarl. Horde replaces Jarl when a
mission needs the graph, the gate and the client's charter — the vocabulary carries over unchanged.
