---
name: jarl
description: Runs an issue loop for a session that works on a repository with more issues than one agent can hold. It files everything seen as an issue, raises one worker per issue in its own worktree, has a fresh reviewer check each branch, merges on evidence and closes the loop when nothing is left open. Use when a session develops, tests, stress-tests or researches a repository and the work splits into many issues, when the owner invokes /jarl with a goal, when a .jarl/ directory already exists in the checkout (resume it), or when a worker, a reviewer, a merger or a tool that builds on the record needs the rules of its role.
---

# Jarl

This skill is an issue loop for work on a repository: a jarl directs it, workers, reviewers and a merger do the work, and a record in `.jarl/` holds what happened. Every session that uses the skill loads this file; read the reference of your role next (see [The roles](#the-roles)), and the terms in [references/glossary.md](references/glossary.md). Whoever runs a session as the jarl directs the work and does not do it. The owner rules: talk to them in plain words, ask only what is theirs to decide, and never spend their trust on a guess.

Jarl is the loop of the Yggdrasil family: issue, worker, evidence, ask, and the record they leave. It holds no law and runs no gate of its own. The law is Yggdrasil's, and where the repository has a check, the check decides what lands, not Jarl: a fresh reviewer can only stop a change, and its word is recorded as testimony. A loop none of whose merges carries the declared check lands on testimony alone, and says so; otherwise it says, per repository, how many merges carry it (see [Loop metrics](references/commands.md#loop-metrics)). A branch, a directory of issues, one tool, a loop. Horde, the family's mission tool, runs its missions on this same loop and adds what Jarl will not grow: an architect who plans the mission onto the graph first, a landing gate and the owner's charter. A loop may be opened with a profile, data that names its statuses and fields (see [Profiles](references/profile.md#profiles)); Jarl reads the profile and never grows rails of its own (see [What Jarl will not grow](references/composers.md#what-jarl-will-not-grow)).

## First moves

- **A `.jarl/` already holds a loop.** At the first contact of a session with it, run `status` (goal, when it was opened, last activity) and ask the owner once whether this session continues that loop or archives it (`archive "<slug>"`, then `init "<goal>"`). Ask only at that first contact, never again on each `new` or `evidence` in the same work. Then run `resume`: one command, the whole state, read live. Read [jarl.md](references/jarl.md) to run the loop, or the reference of your own role.
- **After a compaction, or any summary of your own context, you are starting a session: run `resume` before the next action.** A summary is not the state: the record is.
- **No loop yet.** Run `init "<goal>"`: the loop lives out of git by default, `--committed` commits it with the work, `--permanent` keeps it as a standing record (see [Where the loop lives](references/record.md#where-the-loop-lives)). Put a `Check: <command>` line in the goal when the repository has a check that decides what lands. Then file what is known as issues and follow the loop in [jarl.md](references/jarl.md#the-loop).
- **You were raised to do one job.** Read your role's reference first: the table below says which.

## The roles

| Role | What it does | Read |
|---|---|---|
| jarl | directs the loop: files issues, picks, raises the others, records verdicts, asks the owner, closes the loop; its moments of work are in [The moments of work](references/jarl.md#the-moments-of-work) | [references/jarl.md](references/jarl.md) |
| worker | does one issue, or one package, in its own worktree and records the proof | [references/worker.md](references/worker.md) |
| reviewer | gives a verdict on an issue, with a standing | [references/reviewer.md](references/reviewer.md) |
| merger | lands approved branches into the feature branch and records the merge | [references/merger.md](references/merger.md) |
| composer | a tool that runs its own loop on Jarl's record through the record library, such as Horde | [references/composers.md](references/composers.md) |

The other references, each read when its subject comes up:

| Reference | Read it for |
|---|---|
| [references/commands.md](references/commands.md) | every command with its flags, the fields of the MCP tools, the JSON of each view, the loop metrics |
| [references/profile.md](references/profile.md) | proof, notes and the merge record, attachments, the done gate, retracting, profiles |
| [references/record.md](references/record.md) | the modes, the files of `.jarl/`, the log as the record, the issue file, the format marker, the write lock |
| [references/models.md](references/models.md) | tiers, the loop's model lines, recording a model, calibration |
| [references/repositories.md](references/repositories.md) | packages and leases, worktrees, a loop that directs several repositories, the rules for parallel workers in worktrees |
| [references/glossary.md](references/glossary.md) | each term of the skill, defined once |

## The daily commands

| Command | What it does |
|---|---|
| `resume` | the whole state of the loop, read live; the first call of every session |
| `status` | the goal, the counts, stale leases, what waits |
| `next` | the open issues ready to start; `--all` adds the held and waiting ones, in groups |
| `new "<title>" --what … --acceptance …` | files an issue with its body |
| `set <ids> in-progress "<why>" --branch <b> --worker <name> --model <m>` | leases issues before a worker is raised |
| `evidence <ids> --ran "<command>" --saw "<what it printed>"` | records proof |
| `review <ids> approve\|changes --by <name> --model <m> "<findings>"` | records a verdict |
| `merged <ids> --sha <sha> --ran "<check>" --saw "<summary>"` | records a merge |
| `set <ids> done "<why>"` | closes an issue: needs proof and a live approve |
| `ask` · `answer` · `decide` | the owner's questions and the rulings |
| `report` · `close` | what was done; ends the loop |

Every command, its flags and its JSON are in [references/commands.md](references/commands.md#the-commands). The exact options are printed by the tool: run `jarl.mjs --help`, or call `jarl_help`.

## Calling the tool

<!-- RUNES:mcp-first:START -->
**Call the tool through its MCP tools first, when the session has them.** A tool with an MCP server offers every command of its CLI as an MCP tool named after the tool and the command (`<tool>_<command>`, a subcommand joined with `_`); the server may start by itself (installed as a plugin) or be configured by hand. The tools are generated from the same command table as the CLI and run the same code, with the same checks, so they are not a second implementation and a tool's answer is the CLI's answer. A tool's description starts by saying whether it writes; when the server also offers a help tool, it prints the full usage text.

- A flag is the field of the same name without the dashes; a flag that takes no value is `true`; a repeatable flag is a list, one item per repetition.
- An argument is the field its usage names, in the usage's order. An argument in brackets may be left out, but not one that comes before another you give.
- The server does not run in your working directory, so a field naming a file or directory the command would look up from there must be an absolute path; a relative one is refused.
- `json: true` answers with the JSON document `--json` prints, as exactly one text block; notes ride in `_meta`.
- Input that does not fit the tool is refused before anything runs (a JSON-RPC -32602 error naming the field). A refusal or a failed check comes back with `isError: true`; where the tool answers a refusal with an error document (`<tool>-error/1`), read its `code`, never its wording.
- A call that runs past the server's time limit, where it sets one, is stopped with everything it started, and the answer says so and how to allow longer.

**The CLI is the fallback.** When a session has no such tools (a host without MCP, a subagent given none, a server that is not installed or not running), run the same command through the CLI, with the same effect; its help prints the usage.
<!-- RUNES:mcp-first:END -->

**Jarl's server.** Installed as a plugin, Jarl starts an MCP server named `jarl` by itself, every command of the tool a tool: `jarl_resume`, `jarl_status`, `jarl_new`, `jarl_set`, `jarl_evidence`, `jarl_review` and the rest, the writing ones included, plus `jarl_help`. The tools also take the same lock as the CLI. A description starts with `WRITES the loop` or `Read-only` and says in one sentence what the command does; `jarl_help` prints the full usage of every command, the same text as `--help`. This skill writes each command the way the tool's usage does (`set <ids> <status> "<why>" [--branch <b>]`), because that one table is what both the CLI and the tools are built from. The fields of every tool, and which loop a call reaches, are in [references/commands.md](references/commands.md#the-tools-and-their-fields). The server lives as long as the session, not in the worktree a role works in, so every brief says to pass `root` on every call.

### The CLI, when the tools are not there

With no `jarl_*` tools in the session (the skill copied into an agent's skill directory rather than installed as a plugin, for one), the script is the CLI. It sits in the skill's own directory, so the command names it by the directory this `SKILL.md` was read from:

```
node "<skill dir>/scripts/jarl.mjs" <command>
```

`<skill dir>` is `${CLAUDE_PLUGIN_ROOT}/skills/jarl` in a plugin install, and `.claude/skills/jarl` (or wherever the directory was copied to) in a drop-in.

If that file does not exist where the command runs, the path belongs to another machine: VS Code
attached to a dev container, for one, hands the agent the host's install path, which the container
cannot see. Do not work around the tool. Find the copy this environment has: the directory this
`SKILL.md` was read from, plus `scripts/jarl.mjs`, when that directory exists here; otherwise search
once, `find ~ /workspaces -path '*skills/jarl/scripts/jarl.mjs' 2>/dev/null | head -1`. Use the
absolute path it gives for the rest of the session, and hand that same path to every role you raise.
If there is no copy at all, say so and stop: the loop's state moves only through the tool.

**Which loop a call reaches.** A tool call: its `root` field; without it the server's `JARL_ROOT`; without that, discovery. A command line: `--root`; without it, discovery. Discovery finds the loop at the root of the checkout the call starts in (from a worktree that holds none, the root of its main checkout) and never looks in a subdirectory: a loop kept in one is reached only through `root`, `--root` or `JARL_ROOT`.

The grammar of the command line (the flags, `--json`, `--help` and `--root`) is in [references/commands.md](references/commands.md#the-command-line).

## The rules that never bend

- **File first.** Anything anybody saw becomes an issue before anything else happens. Nobody fixes on the side: a worker reports what it found, and the jarl files it, or the worker files it with `root` set to the main checkout; either way the write lock hands out the numbers, so they never collide.
- **One tool moves the record.** Every status change, tag, priority, ruling and log line goes through the tool, never through a hand edit; a header edited by hand is never believed (see [The log is the record](references/record.md#the-log-is-the-record)).
- **Pass the loop's root.** The live loop is in the main checkout, so every call from a worktree, and every brief, carries the absolute path of the main checkout as `root`.
- **A code issue is cleared by a fresh reviewer.** An issue that records a Branch or a Merged field is cleared by the approve of an agent that neither wrote the code nor runs the loop. The worker never approves its own work, and `done` refuses without a live approve (see [references/reviewer.md](references/reviewer.md)).
- **Only the merger commits in the main checkout.** Everybody else writes `.jarl/` through the tool and never runs a commit there (see [references/merger.md](references/merger.md)).
- **Merging to `main` and pushing are the owner's word.** A worker's branch is never pushed. The feature branch is pushed only when the owner has said so, once for good in a line of `goal.md` or a ruling, or each time (see [references/jarl.md](references/jarl.md#standing-permission-to-push-the-feature-branch)).
- **Every spawn names its model explicitly.** A model is never inherited from the coordinator, and it is recorded with the lease or the verdict (see [references/models.md](references/models.md)).
- **Decide yourself inside the goal; stop and ask the owner when:**
  - the goal or a standing decision would change;
  - something that protects would get weaker: a test, an assertion, a check, a rule, a hook, a CI step;
  - a number would enter the code without an origin you can name;
  - a merge conflict cannot be resolved without losing one side's behaviour;
  - the work would reach outside the session — a push, a release, a cost.

  How to ask, and what is decided under a mandate, is in [references/jarl.md](references/jarl.md#what-goes-to-the-owner).

<!-- RUNES:evidence:START -->
**Evidence is what ran and what it printed.** A piece of work counts as done only with evidence a reader can check, recorded as pairs:

- `--ran "<command>"`: the exact command, as it can be run again, with where it ran (the repository or worktree, the commit or branch) when that is not obvious.
- `--saw "<what it printed>"`: the observed result, quoted or counted from the output (`tests 138, pass 138, fail 0`, the line that proves the point), never a verdict such as "works" or "all good".

One pair per check; repeat the pair for more, and `--ran` and `--saw` pair up by position. A free-text note may explain, but it never proves: the work is proven by the pairs alone, and nothing written before the work started counts. A fix to a bug carries a pair showing the check failing without the fix and passing with it. Evidence is appended, never replaced; a later run that disagrees is recorded next to the earlier one, not over it.
<!-- RUNES:evidence:END -->

How rows, notes and the merge check sit in an issue, and when an issue may be set done, is in [references/profile.md](references/profile.md#proof-notes-and-the-merge-record).

<!-- RUNES:worker-worktree:START -->
**A worker works in its own worktree, on its own branch.** The main checkout belongs to the coordinator and to whoever merges for it; every worker gets a fresh worktree cut from the branch the work lands on, on a branch named for its issue (`<prefix>/NNN-slug`, NNN the first issue it carries), and never touches another worker's worktree or the main checkout's working tree.

- **One issue per commit.** Each commit carries one issue's change and names it in its message (`… (issue NNN)`). A package of small issues on one branch still commits them one by one, so a review, a revert or a bisect can take one issue at a time.
- **State lives in the main checkout.** A worktree may not see the coordinator's state at all. Every call that reads or writes it passes the main checkout's absolute path explicitly (the `root` field, or its CLI flag), from wherever the worker stands.
- **Stay in your lane.** Change only what the issue needs. Something else seen on the way is reported for filing, not fixed in passing.
- **Scratch goes to scratch.** Temporary files go to the scratch directory the brief names, or a temporary directory, never into the repository.
- **Leave it mergeable.** The work is committed on the branch and the checks the brief names pass there before the work is reported; the branch is not pushed, merged or rebased onto others unless the brief says so. Merging, and removing the worktree and the branch afterwards, is never the worker's job.
<!-- RUNES:worker-worktree:END -->

In Jarl the coordinator is the jarl and the one who merges is the merger. The branch naming and the rest of the worker's rules are in [references/worker.md](references/worker.md#worker-branches).
