# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-13

### Added
- The `jarl` skill. Invoke `/jarl <goal>` on a feature branch and the agent becomes the director of that branch: everything anybody sees becomes an issue in a committed `.jarl/` directory, one worker per issue works in its own worktree, nothing merges without evidence the agent has reproduced itself, and the directory is removed by the last commit before the branch merges to main. Testing, stress and research sessions run on the same loop, with some workers producing issues while others take them down.
- One small tool, `jarl.mjs`, that every change of state goes through: file an issue, list and search by status, kind, tag, priority or text, change a status with its reason written to the journal in the same move, tag and prioritise, ask the user a question of one of four closed kinds (stop, stuck, lower with a named target, charter) rather than free text, record evidence — free text, or a repeatable checkable row naming the command and what it printed —, record a review verdict where "changes" must name a Critical or Important finding (Minor alone rides an approve instead of bouncing the branch), ask what can run in parallel right now, count red rounds and hand an issue to a fresh worker after three, check a worker's branch before merge (commits, files outside the declared scope, test files removed, assertions before and after), list worker branches with unmerged commits, file questions only the user can answer and turn their answers into rulings, write a handoff for the next session, produce the closing report, and close the loop; its worker guidance now steers a scratch copy over `git stash` for holding work aside, since the stash list is shared across every worktree of a repository, and never checks out a ref in the main checkout — the merger alone moves it — which refuses while anything is still open. Node, no dependencies.
- Three standing helpers the loop raises so the director's own context is spent on the client: a reeve that runs the loop day to day and reports back on four occasions only, a fresh reviewer per branch, and a merger that verifies and merges one branch at a time. Worker branches are named by issue and never leave the machine.
- Installable as a Claude Code plugin, a GitHub Copilot CLI plugin, a Codex CLI plugin and a Cursor plugin, or as a single file dropped into any agent's skill directory.

[Unreleased]: https://github.com/krzysztofdudek/JarlSkill/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/krzysztofdudek/JarlSkill/releases/tag/v0.1.0
