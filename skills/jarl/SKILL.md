---
name: jarl
description: Runs an issue loop for a session that works on a repository with more issues than one agent can hold. It files everything seen as an issue, has each piece of work carried by a worker on its own branch and checked by a fresh examiner, merges on evidence and closes the loop when nothing is left open. Use when a session develops, tests, stress-tests or researches a repository and the work splits into many issues, when the owner invokes /jarl with a goal, when a .jarl/ directory already exists in the checkout (resume it), or when a worker, an examiner, a merger or a tool that builds on the record needs the rules of its role. A raised agent reads its brief, which the tool prints.
---

# Jarl

Jarl is the loop of the Yggdrasil family: a director files work as issues with lines of proof, raises agents with briefs the tool prints, and a record in `.jarl/` holds what happened. It holds no law and runs no gate of its own: where the repository has a check, the check decides what lands. The terms are in [the glossary](references/glossary.md).

## First moves

- **You were raised to do one job: a worker, an examiner, a merger.** The brief you were given is everything you read. Nothing in this skill is for you; only a director reads it.
- **After a compaction, or any summary of your own context, you are starting a session: run `resume` before the next action.** A summary is not the state: the record is.
- **You run a slice as a coordinator.** Start with `brief --slice <name>`, then `resume --slice <name> --as <name>`: nothing outside it is your business.
- **You are asked what waits on the owner.** `next --as owner --all` prints his digest, most blocking first; `resume` is the director's.
- **A `.jarl/` already holds a loop.** Run `resume`: the whole state, read live. Continue when your task matches the goal; only when it contradicts the goal, ask the owner once whether to continue or archive it (`archive "<slug>"`, then `init "<goal>"`). Read [references/jarl.md](references/jarl.md) once.
- **No loop yet.** Run `init "<goal>"`: the loop lives out of git by default, `--committed` commits it with the work, `--permanent` keeps it as a standing record. Then file what is known and follow [The loop](references/jarl.md#the-loop).

## The roles

| Role | Reads |
|---|---|
| jarl, or a coordinator over a slice: files, shapes, leases, sends rounds | this file and [references/jarl.md](references/jarl.md) once |
| worker: carries one lease on its own branch | `brief <ids>` |
| examiner: gives the verdict on one lease's work | `brief <ids> --role reviewer` |
| merger: lands approved work on a target branch and records it | `brief --role merger` |

Read when the subject comes up:

| Reference | For |
|---|---|
| [repositories.md](references/repositories.md) | a loop over several repositories, leases, worktrees |
| [models.md](references/models.md) | which model sits where, the loop's model lines |
| [commands.md](references/commands.md#the-commands) | every command, its flags and JSON, the tools' fields, imports and templates |
| [profile.md](references/profile.md) | proof, the done gate, the owner's sign-off, retracting, profiles |
| [record.md](references/record.md) | the files of `.jarl/`, the log, the issue file, the library's contract |
| [composers.md](references/composers.md) | building on the record, what Jarl will not grow |
| [family-rules.md](references/family-rules.md) | the wording of evidence, worktrees and MCP that the family's tools share |
| [converting-from-6-2.md](references/converting-from-6-2.md) | a loop the tool refuses as being in another format |

## Calling the tool

**Call the tool through its MCP tools first, when the session has them**: one tool per command, `jarl_<command>`, a flag being the field of the same name; `jarl_help` and [the fields](references/commands.md#the-tools-and-their-fields) say more. **The CLI is the fallback**, in the skill's own directory:

```
node "<skill dir>/scripts/jarl.mjs" <command>
```

`<skill dir>` is `${CLAUDE_PLUGIN_ROOT}/skills/jarl` in a plugin install (`${PLUGIN_ROOT}` for Copilot and `${CURSOR_PLUGIN_ROOT}` for Cursor), and `.claude/skills/jarl` or wherever the directory was copied in a drop-in. If that file is not there where the command runs (a dev container handed the host's path), search once, `find ~ /workspaces -path '*skills/jarl/scripts/jarl.mjs' 2>/dev/null | head -1`, and use that absolute path; with no copy at all, say so and stop, because the loop's state moves only through the tool.

**Pass the loop's root.** The live loop is in the loop root, the directory that holds `.jarl/`, so every call from a worktree, and every brief, carries the absolute path of the loop root as `root` (`--root`). Without it a call finds the loop at the root of the checkout it starts in, and never looks in a subdirectory: a loop kept in one is reached through `root`, `JARL_ROOT` or `use <path>`.

**Every write names its writer with `--by`.** A refused call writes nothing: a refusal ends with the form of the command with a `<placeholder>`; fill the value and run it; never paste it as printed. The commands Jarl prints are written for a POSIX shell (sh, bash, zsh) on macOS and Linux, and on Windows for PowerShell and cmd, whose double quotes Git Bash reads alike but for a path that starts with two backslashes, which it reads with one; replace every `<placeholder>` before running one. `--help` prints a short list, `<command> --help` one command's usage.

## The rules that never bend

- **File first.** Anything anybody saw becomes an issue before anything else happens. Nobody fixes on the side. Two clones can each take one number; `verify` names both files until `renumber <id> --key <key> --by <who>` frees one.
- **One tool moves the record.** Every status, tag, ruling and log line goes through it, never through a hand edit. A record file a merge left conflicted is taken back with the git commands `verify` prints.
- **A code issue is cleared by a fresh examiner**, an agent that neither wrote the code nor runs the loop; the worker never approves its own work, and `done` refuses without a live approve. Where a profile says so, a bot's approve or the owner's waiver stands in.
- **Only the holder of the main checkout commits `.jarl/`**; everyone else writes it through the tool. One merger per target branch.
- **Merging to `main` and pushing are the owner's word.** A worker's branch is never pushed; the feature branch only with his word, once for good in a goal line or a ruling, or each time.
- **Every spawn names its model explicitly.** A model is never inherited.
- **Decide yourself inside the goal; stop and ask the owner when:**
  - the goal or a standing decision would change;
  - something that protects would get weaker: a test, an assertion, a check, a rule, a hook, a CI step;
  - a number would enter the code without an origin you can name;
  - a merge conflict cannot be resolved without losing one side's behaviour;
  - the work would reach outside the session: a push, a release, a cost.

Evidence is what ran and what it printed, recorded as `--ran`/`--saw` rows that name the line they prove; how each role keeps to it is in its brief.
