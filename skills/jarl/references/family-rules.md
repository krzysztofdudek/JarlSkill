# The family's shared rules

The passages every tool of the family says alike, kept word for word from one source. A director reads them when the subject comes up; a raised agent gets what it needs from its brief. Terms: [glossary.md](glossary.md).

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

<!-- RUNES:evidence:START -->
**Evidence is what ran and what it printed.** A piece of work counts as done only with evidence a reader can check, recorded as pairs:

- `--ran "<command>"`: the exact command, as it can be run again, with where it ran (the repository or worktree, the commit or branch) when that is not obvious.
- `--saw "<what it printed>"`: the observed result, quoted or counted from the output (`tests 138, pass 138, fail 0`, the line that proves the point), never a verdict such as "works" or "all good".

One pair per check; repeat the pair for more, and `--ran` and `--saw` pair up by position. A free-text note may explain, but it never proves: the work is proven by the pairs alone, and nothing written before the work started counts. A fix to a bug carries a pair showing the check failing without the fix and passing with it. Evidence is appended, never replaced; a later run that disagrees is recorded next to the earlier one, not over it.
<!-- RUNES:evidence:END -->

<!-- RUNES:worker-worktree:START -->
**A worker works in its own worktree, on its own branch.** The main checkout belongs to the coordinator and to whoever merges for it; every worker gets a fresh worktree cut from the branch the work lands on, on a branch named for its issue (`<prefix>/NNN-slug`, NNN the first issue it carries), and never touches another worker's worktree or the main checkout's working tree.

- **One issue per commit.** Each commit carries one issue's change and names it in its message (`… (issue NNN)`). A package of small issues on one branch still commits them one by one, so a review, a revert or a bisect can take one issue at a time.
- **State lives in the main checkout.** A worktree may not see the coordinator's state at all. Every call that reads or writes it passes the main checkout's absolute path explicitly (the `root` field, or its CLI flag), from wherever the worker stands.
- **Stay in your lane.** Change only what the issue needs. Something else seen on the way is reported for filing, not fixed in passing.
- **Scratch goes to scratch.** Temporary files go to the scratch directory the brief names, or a temporary directory, never into the repository.
- **Leave it mergeable.** The work is committed on the branch and the checks the brief names pass there before the work is reported; the branch is not pushed, merged or rebased onto others unless the brief says so. Merging, and removing the worktree and the branch afterwards, is never the worker's job.
<!-- RUNES:worker-worktree:END -->

In Jarl the root a call passes is the loop root, the directory that holds `.jarl/` (the main checkout only when the loop lives at its root). In Jarl the coordinator is the jarl, or a coordinator the goal names over its slice of the backlog, and the one who merges is the merger.
