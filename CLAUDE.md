# JarlSkill

## Purpose

This repository exists solely so the author can develop and version the jarl skill. The canonical file is `skills/jarl/SKILL.md` — people install it as a Claude Code plugin (or copy that one file into their agent's skill dir). Nothing in this repo (CLAUDE.md, CHANGELOG.md, README.md, CI, etc.) may affect the skill's mechanics. All behavior must be self-contained in `skills/jarl/SKILL.md`.

Jarl is an add-on in the Yggdrasil family: it attaches to the agent, not to the graph, and works alone. It is the **light version of Horde** — the same words (issue, worker, evidence, ask) without the rails: no architecture graph, no landing gate, no charter. It owns the **issues → merged branch** stage: a session that works on a repository opens a committed issue loop on its feature branch, raises a worker per issue in its own worktree, merges on evidence, and removes the loop before the branch merges to main. The family's core is Yggdrasil (the law), Grain (the first graph, mined) and Horde (the software house on the law); Ratatoskr, Urd, Researcher and Jarl are the add-ons beside them, each with no dependency of its own.

## Plugin scaffolding

Layout mirrors the sibling repos (UrdSkill, RatatoskrSkill, ResearcherSkill):
- `.claude-plugin/plugin.json` — plugin manifest. `version` MUST match the latest released version in `CHANGELOG.md` and is bumped together with it.
- `.claude-plugin/marketplace.json` — single-plugin marketplace listing for Claude Code (`/plugin install jarl@jarl-marketplace`). Codex discovers the marketplace from the same file.
- `.github/plugin/marketplace.json` — the listing GitHub Copilot CLI reads; carries `version` and the `skills` array. Its `version` MUST be kept in lockstep with `plugin.json`.
- `.codex-plugin/plugin.json` — manifest for OpenAI Codex CLI, bundling the skill via `"skills": "./skills/"`. Version in lockstep.
- `.cursor-plugin/plugin.json` — manifest for Cursor (single-plugin-at-root; `skills/jarl/` is auto-discovered). Version in lockstep.
- `skills/jarl/SKILL.md` — the canonical skill body. Editing this file IS editing the skill.

When bumping version, update the `version` in all four manifests in lockstep with the CHANGELOG section header.

## Versioning

This project uses [Semantic Versioning](https://semver.org/) and maintains a [CHANGELOG.md](CHANGELOG.md) following the [Keep a Changelog](https://keepachangelog.com/) format.

When the user says "bump version":
1. Move `[Unreleased]` entries in `CHANGELOG.md` into a new version section with today's date
2. Update the comparison links at the bottom of `CHANGELOG.md`
3. Update the `version` in `.claude-plugin/plugin.json`, `.github/plugin/marketplace.json` (plugin entry), `.codex-plugin/plugin.json`, and `.cursor-plugin/plugin.json` to match
4. Commit the bump and push to `main` — that's it.

Do not create or push tags manually. The `.github/workflows/release.yml` workflow runs on every push to `main`, reads the top version from `CHANGELOG.md`, and if `v<version>` does not already exist it creates the tag, pushes it, and publishes a GitHub Release with notes extracted from the matching changelog section.

### Changelog register

`CHANGELOG.md` is written for the adopter, not the developer. Plain language, zero jargon, zero narration, facts only — no file names, no internal mechanics. State only what changed, the way someone deciding whether to install this would want to read it.
