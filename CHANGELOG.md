# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Up to 0.1.0 Jarl followed Semantic Versioning on its own number. From 6.1.0 it follows the Yggdrasil family's one-number policy instead: the core of the family (Yggdrasil, Grain, Jarl and Horde) ships together under one number, so a minor release can include changes that ask something of you, and its section lists them under **Before you upgrade**. A release in which Jarl does not change says "No changes in Jarl."

## [Unreleased]

## [6.1.0] - 2026-09-29

Jarl 6.1.0 lets one loop drive work across several repositories, keeps the loop out of your git history by default, and starts each new session from a single `resume`. Your agent reaches every command as an MCP tool, and the record gets firmer: an issue closes on recorded proof, and code on a fresh reviewer's approve. Jarl now shares one version number with the rest of the Yggdrasil family's core (Yggdrasil, Grain and Horde), so it moves from 0.1.0 straight to 6.1.0. Under that shared number a minor release can carry upgrade steps, and this one has a few.

### Before you upgrade

- Jarl runs on Node.js 22 or later (0.1.0 ran on Node 18). Install Node 22 first.
- New loops stay out of git: `init` has git ignore `.jarl/`, and worktrees of the same repository still find it. To carry a loop to another clone or machine, open it with `init "<goal>" --committed`, which keeps it on the branch as 0.1.0 did. Loops opened with 0.1.0 stay committed.
- `set <id> done` closes an issue once it has a `--ran`/`--saw` evidence row recorded since it last went in progress or was reopened; a free-text note, a ruling or a drop or defer reason does not count on its own. An approve holds until the next red round, reopen or restart. Record a row with `evidence <id> --ran "<command>" --saw "<output>"` before you close. Issues already done stay done.
- Every `review` names its reviewer with `--by <reviewer>`, and Jarl refuses an approve from anyone who worked the issue or its branch. An issue that records a branch or a merge closes on a fresh reviewer's approve, from someone who neither wrote the code nor runs the loop; the coordinator (`jarl`, `reeve`, `coordinator`, the loop's directory name, or a name on a `Coordinators:` line in `goal.md`) closes rulings and documents. Raise a fresh reviewer for every branch.
- The command line checks its input: it refuses an unknown flag or an extra argument with exit code 1, and for a flag it names the ones the command takes. A value starting with `--` belongs to the flag before it; a note or title starting with `--` goes after a bare `--`. `decide` takes slugs of letters, digits and `. _ -`, and `ask --issue` takes an existing issue. Adjust any call the tool refuses.
- `resume` takes over from the handoff and assembles the state live. `handoff write` succeeds and writes nothing, `handoff read` prints what `resume` prints and needs a loop, and `status` leaves out the handoff's age. Start sessions from `resume`.
- `report` prints "Found along the way" when you pass `--found`. Add the flag wherever you want that section.
- The journal's review line reads `NNN review approve · by <name> (<kind>) · <findings>`. Update anything that parses it.

### Upgrading from 0.1.0

1. Install Node.js 22 or later.
2. Update the plugin. In Claude Code: `/plugin marketplace update jarl-marketplace`, `/plugin install jarl@jarl-marketplace`, then `/reload-plugins`; the README covers Copilot, Codex and Cursor. A drop-in copy takes the whole `skills/jarl/` directory.
3. A loop opened with 0.1.0 carries on as a committed loop. On its first write, Jarl adds an ignore file and merge settings inside `.jarl/` and a merge driver to the repository's local git configuration. Commit the new `.jarl/` files with the loop.
4. Bring scripts and agent instructions that call the tool in line with the list above.
5. To have ratified rulings written into Yggdrasil's logs, use Yggdrasil 6.1.0 or later. With an older `yg`, Jarl prints the command to run by hand.

### Added

- One loop can drive work in several repositories. Name the repository root on the issue (`new --repo <path>` or `repo <id> <path>`) and its files carry that repository's name first (`tool/src/a.mjs`, or `app/app/x.mjs` when the repository holds a directory of its own name). `next`, `check`, `resume`, `report` and the other views follow the issue there.
- From any worktree of the repository, the tool finds the loop without `--root`.
- `resume` gives a new session everything in one read, from the goal and the rulings in force to the work in flight, the merge queue and CI. It writes nothing and needs no network unless you pass `--ci`.
- `init "<goal>" --permanent` keeps a loop after `close` as a record, and `mode permanent` turns a committed loop into one. `archive "<slug>"` puts a finished loop away so a new one can open in its place, and `set <id> deferred "<why>"` parks work that waits on someone.
- A committed loop merges cleanly when two branches carrying it meet, and stops with conflict markers when both changed the same ruling. `merge-driver flags` prints the settings for `git merge`.
- Fuller issues. `new --where --what --why --acceptance` and `body <id>` write the body, `after <id> <ids>` orders issues, `new --template <name>` starts from a template, and `--changelog "Added: …"` keeps the issue's changelog entry until `changelog <ids>` prints it at merge time. `evidence`, `review`, `set`, `tag` and `prio` take id lists such as `203-206`, all or nothing.
- Branches, merges and CI on the record: `set <ids> in-progress --branch <b>` leases a package of issues, `merged <ids> --sha <sha> --ci <state>` records a merge, `queue` shows the merge queue, and `tips` shows each repository's branches with their CI. None of them blocks a merge.
- `report` ends with loop metrics: cycle and lead time, rounds, reopenings, the share of fresh reviews, red CI after a merge, and follow-ups. A `Check: <command>` line in `goal.md` names the check that decides what lands.
- Rulings can supersede one another (`decide --supersedes`, `decisions --live`), and `ask --kind ratify` records a choice that waits for your word. `decide --area <type> --reach <n>` marks a ruling for every file of a type; `close` puts these to you in one batch and, in a repository with a Yggdrasil graph, writes each one you ratify into that type's decision log. Add `--rule <id>` to name one of the graph's rules, and your yes also ratifies that rule in Yggdrasil so it can stand enforced, for every type the rule reaches.
- `import <findings.json>` files one issue per research finding, once, and `sources` shows what was filed.
- An MCP server starts with the plugin. Every command is a tool with the same arguments, marked as writing or read-only, and the whole list costs an agent about 7,000 tokens. `JARL_ROOT`, if you set it, takes an absolute path.
- Profiles let a tool such as Horde run its work as Jarl loops: `init "<goal>" --profile <file>` sets statuses, fields and sections, and can hand scheduling, the done check, `close` and `archive` to that tool.
- A versioned library, `jarl-record/1`, lets a tool read and write a loop without the command line.
- JSON for dashboards: `status --by repo|tag|kind|prio`, more counts in `status --json`, one row per issue in `report --json`, and `waitsOn` and `after` as lists on every `next --json` row. The skill documents these shapes as stable.
- Jarl runs on Windows, checkouts with Windows line endings included, and Copilot and Codex can install it from a portable Agent Plugins 1.0 manifest.

### Changed

- `branches` without `--repo` covers every repository an open or in-progress issue names, and marks stale leases and branches ready to delete.
- A line in `goal.md`'s rules, or a ruling, can give standing permission to push the feature branch; the merger then pushes it after each green merge. Worker branches stay local.
- Where a helper agent cannot start agents of its own, the loop notices at the start and relays every spawn through files, second rounds included.

### Fixed

- Workers, reviewers and the merger can write at once: each write waits its turn behind a lock, so every evidence row, log line and issue number lands.
- Evidence grows line by line: a note, a drop reason and each `--ran`/`--saw` pair add a line of their own to what the issue already holds, text with `$&` or `$1` included.
- `check` counts a file an issue names relative to a subdirectory as in scope.
- The merger also removes the branch a worker started on when the platform created its worktree.
- Titles with `ł`, `ø`, `ß` and similar letters give readable file names: `gałęzi` becomes `galezi`.
- In a dev container handed the host's install path, the skill uses its own copy of the tool, or stops if there is none.

## [0.1.0] - 2026-09-13

### Added
- The `jarl` skill. Invoke `/jarl <goal>` on a feature branch and the agent becomes the director of that branch: everything anybody sees becomes an issue in a committed `.jarl/` directory, one worker per issue works in its own worktree, nothing merges without evidence the agent has reproduced itself, and the directory is removed by the last commit before the branch merges to main. Testing, stress and research sessions run on the same loop, with some workers producing issues while others take them down.
- One small tool, `jarl.mjs`, that every change of state goes through: file an issue, list and search by status, kind, tag, priority or text, change a status with its reason written to the journal in the same move, tag and prioritise, ask the user a question of one of four closed kinds (stop, stuck, lower with a named target, charter) rather than free text, record evidence — free text, or a repeatable checkable row naming the command and what it printed —, record a review verdict where "changes" must name a Critical or Important finding (Minor alone rides an approve instead of bouncing the branch), ask what can run in parallel right now, count red rounds and hand an issue to a fresh worker after three, check a worker's branch before merge (commits, files outside the declared scope, test files removed, assertions before and after), list worker branches with unmerged commits, file questions only the user can answer and turn their answers into rulings, write a handoff for the next session, produce the closing report, and close the loop; its worker guidance now steers a scratch copy over `git stash` for holding work aside, since the stash list is shared across every worktree of a repository, and never checks out a ref in the main checkout — the merger alone moves it, and now confirms each `done` actually landed before moving to the next branch; the loop now treats a merger's own report as the only signal it has stopped touching the main checkout, after a rewritten HEAD surfaced when that was assumed instead of confirmed — which refuses while anything is still open. Node, no dependencies.
- Three standing helpers the loop raises so the director's own context is spent on the client: a reeve that runs the loop day to day and reports back on four occasions only, a fresh reviewer per branch, and a merger that verifies and merges one branch at a time. Worker branches are named by issue and never leave the machine.
- Installable as a Claude Code plugin, a GitHub Copilot CLI plugin, a Codex CLI plugin and a Cursor plugin, or as a single file dropped into any agent's skill directory.

[Unreleased]: https://github.com/krzysztofdudek/JarlSkill/compare/v6.1.0...HEAD
[6.1.0]: https://github.com/krzysztofdudek/JarlSkill/compare/v0.1.0...v6.1.0
[0.1.0]: https://github.com/krzysztofdudek/JarlSkill/releases/tag/v0.1.0
