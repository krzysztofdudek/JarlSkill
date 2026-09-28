# Jarl

**Your feature branch has more issues than one agent can hold in its head, so it fixes one, forgets two, and loses the third in the diff.** Jarl makes the agent direct a crew instead of working alone.

Invoke it on a branch and the agent becomes the **jarl** of that branch: everything anybody sees becomes an issue in a `.jarl/` directory that git never sees, one worker per issue works in its own worktree, nothing merges without evidence the jarl has reproduced itself, and closing the loop removes the whole directory. Nothing ships, nothing lingers. A repository that wants the loop in its history opens it committed instead ([both modes in the FAQ](#faq)).

```
/plugin marketplace add krzysztofdudek/JarlSkill
/plugin install jarl@jarl-marketplace
```

Run both, then `/reload-plugins` to activate it in this session (or restart Claude Code). Needs Node.js 22 or later on your `PATH`; no config, no API key. Then `/jarl <goal>` on a feature branch, or just start a session in a checkout that already carries `.jarl/` — the skill resumes on its own.

> MIT licensed · one markdown file and one zero-dependency Node tool · works with any agent that reads skills · part of the [Yggdrasil family](#the-yggdrasil-family) · [full skill body](skills/jarl/SKILL.md)

---

## See it

**`/jarl make the export command handle every fixture in tests/fixtures`** on branch `export-fixtures`.

The jarl writes `.jarl/goal.md`, reads the fixtures, and files what it sees: three fixtures the command refuses, one it accepts and gets wrong, a flag the docs promise that does not exist. Five issues, numbered, each with a checkable acceptance line. Two of them touch the same parser, so those run in series; the other three get a worker each, in its own worktree, with the issue pasted into the brief verbatim.

A worker reports done. The jarl does not take its word: it reads the diff, runs the test suite itself, checks that the new test was red before the change, and only then merges into the branch with a commit that names the issue. One worker reports something else it noticed in passing — the jarl files issue 006 rather than letting the worker fix it on the side.

When nothing is open, the jarl closes the branch: changelog carries every user-visible change, the suite is green on the tip, and `.jarl/` is deleted — git never saw it, so the branch carries no trace. Merging and pushing wait for your word.

---

## What it does

| The jarl | And nobody else |
|---|---|
| **Files** everything seen as an issue before anything is touched | no side fixes, no "while I'm here" |
| **Picks** what runs in parallel by which files it touches | overlapping issues run in series |
| **Raises** one worker per issue, or per package of small neighbouring issues, in its own worktree, model set explicitly; each in-progress issue records who works on it, where and since when | workers spawn nothing of their own; a stale lease is shown, never taken over |
| **Verifies** by reproducing the acceptance line and the red-before, green-after test | a worker's report is a hypothesis |
| **Merges** into the branch on evidence, with a commit that names the issue, and records the merge sha and CI state as fields | three red rounds become an issue about the issue |
| **Asks you** when a protection would weaken, the goal would change, or work reaches outside the session | never a guess on a decision that is yours |
| **Closes** the branch: changelog, green check, `.jarl/` removed | main never carries the loop |

Testing, stress and research sessions run on the same loop: some workers produce issues (they test, probe, read) while others take them down. The stream never waits for the other side.

---

## Install

### Claude Code plugin (recommended)

```
/plugin marketplace add krzysztofdudek/JarlSkill
/plugin install jarl@jarl-marketplace
```

Then `/reload-plugins`. To upgrade later:

```
/plugin marketplace update jarl-marketplace
/plugin install jarl@jarl-marketplace
```

### GitHub Copilot CLI plugin

```
copilot plugin marketplace add krzysztofdudek/JarlSkill
copilot plugin install jarl@jarl-marketplace
```

To upgrade later: `copilot plugin update jarl`.

### Codex CLI plugin

```
codex plugin marketplace add krzysztofdudek/JarlSkill
codex plugin install jarl@jarl-marketplace
```

To upgrade later: `codex plugin marketplace upgrade jarl-marketplace`. Or drop the single file into `~/.agents/skills/jarl/SKILL.md` (user-level) or `.agents/skills/jarl/SKILL.md` (project-level).

### Cursor plugin

```
git clone https://github.com/krzysztofdudek/JarlSkill.git
ln -s "$(pwd)/JarlSkill" ~/.cursor/plugins/local/jarl
```

Then reload Cursor (**Developer: Reload Window**). Or drop the single file into `~/.cursor/skills/jarl/SKILL.md` (user-level) or `.cursor/skills/jarl/SKILL.md` (project-level).

### The MCP tools

A plugin install also starts an MCP server, `jarl`, with nothing to configure: Claude Code reads it from `.mcp.json`, and hosts that follow the Agent Plugins spec (Copilot) from `mcp.json`. Every command of the tool is an MCP tool — `jarl_resume`, `jarl_status`, `jarl_new`, `jarl_set`, `jarl_evidence` and the rest, the ones that write included — with the same arguments and flags as fields, and the skill calls these instead of running a script. Each tool's description says whether it writes. They are generated from the command line's own table and run the same code under the same lock, so the two never disagree; a test fails the build if a command or a flag has no matching tool or field.

A call reaches the loop its `root` field names; without it, the one `JARL_ROOT` names in the server's environment; without that, the loop found from the directory the session started in. With a drop-in copy, register the server yourself if your agent speaks MCP (for Claude Code: `claude mcp add jarl -- node /absolute/path/to/skills/jarl/scripts/jarl-mcp.mjs`), or let the skill use the command line, which it falls back to whenever the tools are not there.

### Drop-in (any agent)

The whole skill is the [`skills/jarl/`](skills/jarl/) directory: one frontmatter-tagged markdown file, one Node tool and the MCP server over it. Copy the directory into your agent's skill directory; Node 22 or later on your `PATH` is the only requirement.

- **Claude Code, user-level:** `~/.claude/skills/jarl/`
- **Claude Code, project-level:** `.claude/skills/jarl/` in your repo
- **Other agents:** wherever your tool reads markdown skills

Nothing else in this repo affects behavior — all of it lives in that directory.

**For tool authors.** `skills/jarl/scripts/record.mjs` is the one stable surface another tool may vendor to read and write a Jarl loop: an enumerated list of exports under the contract version `RECORD_API` (`jarl-record/1`), vendored together with `jarl-lib.mjs`. Nothing else is a contract — not `jarl.mjs`, whose exports are internal, and not `jarl-lib.mjs`. See [the record as a library](skills/jarl/SKILL.md#the-record-as-a-library).

---

## What it doesn't claim

Jarl is a working loop, not a guarantee. It does not enforce architecture, it does not gate a merge with a machine check of its own, and it does not hold a client's charter — that is [Horde](https://github.com/krzysztofdudek/Horde), whose missions run on this same loop, with the graph and the rails. Where your repository has a check, the check decides what lands and a reviewer's approval is testimony; name it with a `Check:` line in the loop's goal. Without one, the loop lands on testimony alone, and `status` and `report` say so at the top. The state is four kinds of markdown file in `.jarl/`, moved by one small tool; the discipline is the agent's.

Jarl records, derives and displays; it never blocks code from landing. Jarl itself ships no merge queue that runs your check and refuses the merge, no `done` that waits for green CI, no leases that expire and are taken over, no release mode that refuses to tag, and no planner that computes a schedule. Each of those is a rail. A loop can be opened with a **profile**, a JSON file that names its statuses (and what each one means: offered, worked on, settling what waits on it, finished, closing the record, needing a reason), the fields its issues carry with their allowed values, and extra sections. A composer such as Horde brings its own profile. A profile is data only: Jarl never runs commands a profile supplies, and a composer keeps its own rails in its own code, writing to the loop through `record.mjs`. A loop without a profile works exactly as before. [The list, and what stays on Jarl's side, is in the skill](skills/jarl/SKILL.md#what-jarl-will-not-grow); [profiles are there too](skills/jarl/SKILL.md#profiles).

---

## FAQ

<details>
<summary><b>Is the loop committed to git?</b></summary>

Not by default. The files are the state — goal, decisions, issues, log — so the next session picks up where this one stopped, because an agent's memory does not survive a session. Nobody writes a handoff for it: the next session runs `resume`, which reads the whole state from those files and the repositories they name — the rulings in force, what is in flight and who holds it, what waits, the open questions, what is ready next, the merge queue, where each branch stands, the last log lines. By default they sit in your main checkout next to the work and git ignores them, so they never show up in the branch's history, diffs or merges. That also means the loop exists only in that one checkout: another clone, or the same repository on another machine, does not have it. A worktree cannot see an ignored directory, so the workers, the reviewers and the merger all call the tool with `--root <main checkout>`, and the merger never commits the loop.

Open the loop with `init "<goal>" --committed` when the loop should travel with the branch: the files are committed with the work at every merge, other clones see them, and the last commit before the branch merges to main removes them. Open it with `init "<goal>" --permanent` when the repository should keep the loop as a lasting record: it is committed like a committed loop, is not tied to a feature branch, and `close` keeps the directory instead of removing it. A committed loop that turns out to be worth keeping becomes permanent with `mode permanent`; a loop out of git cannot, because a permanent record has to be committed. When one loop is finished and the next begins in the same place, `archive "<slug>"` puts the current one away under `.jarl/archive/` and `init` opens the new one in the same mode.
</details>

<details>
<summary><b>Can the issues live in one repository while the code is in another?</b></summary>

Yes. Name the other repository when you file an issue (`new "<title>" --repo <path>`, or `repo <id> <path>` later) and the loop keeps the issue where it is while the worker, the reviewer and the merger work in that repository, on its own feature branch. Files are then listed with the repository's name first (`tool/src/a.mjs`), so `next` still keeps two workers off the same file across repositories, and `check` and `branches` look in the repository the issue names. This is how a release that spans several repositories keeps one backlog in one place. An issue whose change spans several repositories names them all (`--repo ../tool,../lib`), `report` groups the done work per repository for each one's changelog, and `tips` shows, read-only, where each repository's worker branches, release branch and `main` stand against their remotes and, when `gh` is installed, the CI of each tip. A loop kept committed in the planning repository names its own uncommitted files in `status`, `resume` and `close`, because no merge in that repository commits it for you.
</details>

<details>
<summary><b>Can a research report become issues?</b></summary>

Yes. `import <findings.json>` files one issue per finding, with its body filled in and a **Source:** that names the report and the finding, and a second run files nothing twice. `sources` then shows, per report, which findings became which issues and where they stand, and which ones nobody filed. [The mapping is in the skill](skills/jarl/SKILL.md#from-research-to-issues).
</details>

<details>
<summary><b>How does the merger know what to merge, and why don't the changelogs conflict?</b></summary>

`queue` lists the branches waiting to merge, computed from the record each time: an issue on the branch holds an approve from a fresh reviewer (the jarl's own approve does not count), and the branch has commits its base does not. They come in the order they were approved, cut into batches whose declared files do not overlap. It runs nothing and refuses nothing. The changelog is the one file every branch touches, so a worker does not edit it: it records its entry on the issue (`body <id> --changelog "Added: …"`), and at merge time `changelog <ids>` prints the entries of those issues grouped by section, ready to paste under `[Unreleased]`. Your repository's layout does not change.
</details>

<details>
<summary><b>Can I get a dashboard or a release checklist out of it?</b></summary>

Out of the record, yes, as outputs rather than new modes. `status --by repo|tag|kind|prio` counts per group, and `status --json`, `resume --json`, `report --json` (one row per issue), `queue --json` and `tips --json` have documented, stable shapes, so a page or a script renders the dashboard. A checklist that repeats (a release, a triage) is an issue template in `.jarl/templates/<name>.md`, filed with `new "<title>" --template <name>` and chained with `--after`, one issue per phase. [Both are in the skill](skills/jarl/SKILL.md#views-for-dashboards).
</details>

<details>
<summary><b>What does closing an issue take?</b></summary>

At least one `--ran`/`--saw` evidence row — the command that was run and what it printed — recorded after the issue was last started or reopened (after its filing, when it was never started); a free-text note never counts on its own, so a note written when the issue was filed cannot close it. And an approving review, named with `--by`, that no later round, restart or reopen has spent. The tool refuses an approve by the issue's own worker, and `status` and `report` say who reviewed the done work: a fresh reviewer, the jarl, or nobody recorded. When the issue carries code, meaning it records a branch or a merge, the approve must come from a fresh reviewer: an agent that neither wrote the code nor runs the loop. The jarl's own approve (`--by jarl`, `coordinator`, `reeve`, the loop's name, or a name a `Coordinators:` line in `goal.md` lists) is recorded but does not close it, and its branch stays out of `queue`. An issue with no branch and no merge, such as a ruling or a document, still closes on the jarl's approve. `merged` records a merge that had no fresh review and says so loudly. It gates the record only; nothing stops code from landing.
</details>

<details>
<summary><b>Does Jarl need Yggdrasil?</b></summary>

No. It works alone, and it touches Yggdrasil in one place only. A ruling about a whole type of code (`decide --area <type> --reach <n>`) is put to you when the loop closes, in one batch of at most ten, each one sentence you answer with yes or reject (tak or nie); not answering never holds the close. When the repository has a Yggdrasil graph and a working `yg`, a ruling you ratified is written into that type's decision log with `yg log add --type`, so the next agent touching any file of the type reads it. A ruling that names one of the graph's rules (`--rule <id>`) also ratifies that rule in its own log (`yg log add --aspect <id> --ratify`) on every type it reaches, as the question says, so it may stand enforced there. Without either, it stays one of the loop's rulings, and nothing else happens.
</details>

<details>
<summary><b>Why one script, and why so small?</b></summary>

Jarl is the loop and nothing more. Four markdown files and one rule: a status that changed without a log line did not change. The tool exists so that rule is enforced rather than promised — it files, lists, searches, moves a status with its reason, records evidence, says what can run in parallel and closes the loop. When the work needs a plan made before anyone writes, a gate and a charter, that is Horde, and a Horde mission is a Jarl loop underneath — the vocabulary carries over because the record is the same.
</details>

<details>
<summary><b>Does it conflict with TDD, Urd or other skills?</b></summary>

No — it composes. Jarl is the loop; discipline skills still hold inside every worker, and Urd's "ask, don't guess" holds inside the jarl.
</details>

<details>
<summary><b>Why "Jarl"?</b></summary>

A jarl is the Norse chieftain who commands the hird — the retinue the word "horde" descends from. The jarl directs; the hird works. It's part of the [Yggdrasil family](#the-yggdrasil-family).
</details>

---

## The Yggdrasil family

**Jarl** is the loop. **[Yggdrasil](https://github.com/krzysztofdudek/Yggdrasil)** is the law. **[Grain](https://github.com/krzysztofdudek/Grain)** is the survey. **[Horde](https://github.com/krzysztofdudek/Horde)** plans the mission onto the law before anyone writes, lands every change through a gate no agent can argue with, and turns what the mission learned into law — on Jarl's loop, with Grain in the architect's hands. Those four are the core, and they ship under one version number, Jarl on it from 6.1.0: one set of tools built and tested against each other. Yggdrasil, Grain and Jarl each work alone; Horde is the one built on the other three. Where a repository has a check, the check decides what lands, in a Horde mission and in a Jarl loop alike: a fresh reviewer can only stop a change, never make a failing check pass, and its word is recorded as testimony. A Jarl loop in a repository with no check lands on testimony alone, and says so. Law that stays inside one component is raised freely by the agent working it. Law or decisions that reach a whole type of code are shared vocabulary: the agent proposes them and they run as advice at once, and the client — the one person the whole system answers to — admits them in one batch when the work closes. Only the client lowers or vetoes law. The core's shared machine contracts are registered on [one page](https://krzysztofdudek.github.io/Yggdrasil/family-contracts).

Start where it hurts; there is no ladder to climb first.

| Where it hurts | Start with |
|---|---|
| More issues than one agent can hold in its head | **Jarl** |
| The agent keeps breaking what was agreed | **Yggdrasil** |
| Nobody knows what was agreed | **Grain**, which earns its keep the moment you are about to write law |
| A task too big for one head to plan up front, in a repository that already has law | **Horde** |

| Core | What it holds |
|---|---|
| **Jarl** (this one) | The loop. Everything seen becomes an issue, each issue gets one worker in its own worktree, and nothing closes without evidence and a fresh reviewer's word. Rulings keep their history, and a ruling about a whole type of code goes to the client in one batch when the loop closes. |
| **[Yggdrasil](https://github.com/krzysztofdudek/Yggdrasil)** | The law. The architecture graph, the rules over it and the log of why, checked before the agent moves on and re-proved in CI without a key. A rule that reaches a whole type runs as advice until the client ratifies it. |
| **[Grain](https://github.com/krzysztofdudek/Grain)** | The survey. Mines a repository's own code and history into a first graph — components, dependencies, and the rules the code already keeps, each with the count of places that break it today; Yggdrasil accepts it with one command. It measures and never blocks. |
| **[Horde](https://github.com/krzysztofdudek/Horde)** | The mission on the law. A one-shot architect plans the whole mission onto the graph once, measuring with Grain; a worker per ticket in its own worktree; every change lands through a nine-item gate; what the mission learned becomes law. Its record is a Jarl loop. The client orders the mission and is the only one who can lower or veto a rule. |

Four add-ons attach to the agent rather than to the graph; each works alone, depends on nothing in the family and keeps its own version. Horde doesn't assume any of them is installed — it carries its own minimum discipline in each role's law — but uses Ratatoskr, Urd and Researcher when they are, one sentence per row below.

| Add-on | Stage | What it makes the agent prove | In Horde's loop |
|---|---|---|---|
| **[Ratatoskr](https://github.com/krzysztofdudek/RatatoskrSkill)** | request → intent | Keeps the agent talking to you in plain words, not code, so you can follow what it's doing. | Keeps the client's plain-language registry open at both ends of a mission. |
| **[Urd](https://github.com/krzysztofdudek/UrdSkill)** | intent → code | When the spec is ambiguous, it consults the source of truth and asks, it doesn't guess. | The stop a worker hits before it guesses. |
| **[Researcher](https://github.com/krzysztofdudek/ResearcherSkill)** | code → measured result | Point it at a metric and it runs experiments, hypotheses kept and discarded. | Runs the retrospective's measurement. |
| **[Skald](https://github.com/krzysztofdudek/SkaldSkill)** | running product → film | A film of your software shows the real running product, never a rebuilt one, and every number and claim on screen traces back to the product's own logs. | None. Horde does not call it. |

## License

MIT © [Krzysztof Dudek](https://github.com/krzysztofdudek)

---

<div align="center">
  <img src="yggdrasil.svg" alt="Yggdrasil" width="150" />
</div>
