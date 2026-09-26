# Jarl

**Your feature branch has more issues than one agent can hold in its head, so it fixes one, forgets two, and loses the third in the diff.** Jarl makes the agent direct a crew instead of working alone.

Invoke it on a branch and the agent becomes the **jarl** of that branch: everything anybody sees becomes an issue in a `.jarl/` directory that git never sees, one worker per issue works in its own worktree, nothing merges without evidence the jarl has reproduced itself, and closing the loop removes the whole directory. Nothing ships, nothing lingers. A repository that wants the loop in its history opens it committed instead ([both modes in the FAQ](#faq)).

```
/plugin marketplace add krzysztofdudek/JarlSkill
/plugin install jarl@jarl-marketplace
```

Run both, then `/reload-plugins` to activate it in this session (or restart Claude Code). Needs Node.js on your `PATH`; no config, no API key. Then `/jarl <goal>` on a feature branch, or just start a session in a checkout that already carries `.jarl/` — the skill resumes on its own.

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

### Drop-in (any agent)

The whole skill is the [`skills/jarl/`](skills/jarl/) directory: one frontmatter-tagged markdown file and one Node tool. Copy the directory into your agent's skill directory; Node on your `PATH` is the only requirement.

- **Claude Code, user-level:** `~/.claude/skills/jarl/`
- **Claude Code, project-level:** `.claude/skills/jarl/` in your repo
- **Other agents:** wherever your tool reads markdown skills

Nothing else in this repo affects behavior — all of it lives in that directory.

---

## What it doesn't claim

Jarl is a working loop, not a guarantee. It does not enforce architecture, it does not gate a merge with a machine check, and it does not hold a client's charter — that is [Horde](https://github.com/krzysztofdudek/Horde), with the graph and the rails. Jarl is what you use when a branch needs more hands than one agent and no rails yet: the same words as Horde, none of the machinery. The state is four kinds of markdown file in `.jarl/`, moved by one small tool; the discipline is the agent's.

Jarl records, derives and displays; it never blocks code from landing. So it will not grow a merge queue that runs your check and refuses the merge, a `done` that waits for green CI, leases that expire and are taken over, a release mode that refuses to tag, or a planner that computes waves. Each of those is a rail, and rails are Horde's. [The list, and what stays on Jarl's side, is in the skill](skills/jarl/SKILL.md#what-jarl-will-not-grow).

---

## FAQ

<details>
<summary><b>Is the loop committed to git?</b></summary>

Not by default. The files are the state — goal, decisions, issues, log — so the next session picks up where this one stopped, because an agent's memory does not survive a session. By default they sit in your main checkout next to the work and git ignores them, so they never show up in the branch's history, diffs or merges. That also means the loop exists only in that one checkout: another clone, or the same repository on another machine, does not have it. A worktree cannot see an ignored directory, so the workers, the reviewers and the merger all call the tool with `--root <main checkout>`, and the merger never commits the loop.

Open the loop with `init "<goal>" --committed` when the loop should travel with the branch: the files are committed with the work at every merge, other clones see them, and the last commit before the branch merges to main removes them. Open it with `init "<goal>" --permanent` when the repository should keep the loop as a lasting record: it is committed like a committed loop, is not tied to a feature branch, and `close` keeps the directory instead of removing it. A committed loop that turns out to be worth keeping becomes permanent with `mode permanent`; a loop out of git cannot, because a permanent record has to be committed. When one loop is finished and the next begins in the same place, `archive "<slug>"` puts the current one away under `.jarl/archive/` and `init` opens the new one in the same mode.
</details>

<details>
<summary><b>Can the issues live in one repository while the code is in another?</b></summary>

Yes. Name the other repository when you file an issue (`new "<title>" --repo <path>`, or `repo <id> <path>` later) and the loop keeps the issue where it is while the worker, the reviewer and the merger work in that repository, on its own feature branch. Files are then listed with the repository's name first (`tool/src/a.mjs`), so `next` still keeps two workers off the same file across repositories, and `check` and `branches` look in the repository the issue names. This is how a release that spans several repositories keeps one backlog in one place. An issue whose change spans several repositories names them all (`--repo ../tool,../lib`), `report` groups the done work per repository for each one's changelog, and `tips` shows, read-only, where each repository's worker branches, release branch and `main` stand against their remotes and, when `gh` is installed, the CI of each tip. A loop kept committed in the planning repository names its own uncommitted files in `status`, the handoff and `close`, because no merge in that repository commits it for you.
</details>

<details>
<summary><b>Can a research report become issues?</b></summary>

Yes. `import <findings.json>` files one issue per finding, with its body filled in and a **Source:** that names the report and the finding, and a second run files nothing twice. `sources` then shows, per report, which findings became which issues and where they stand, and which ones nobody filed. [The mapping is in the skill](skills/jarl/SKILL.md#from-research-to-issues).
</details>

<details>
<summary><b>How does the merger know what to merge, and why don't the changelogs conflict?</b></summary>

`queue` lists the branches waiting to merge, computed from the record each time: an issue on the branch is approved by a fresh review, and the branch has commits its base does not. They come in the order they were approved, cut into batches whose declared files do not overlap. It runs nothing and refuses nothing. The changelog is the one file every branch touches, so a worker does not edit it: it records its entry on the issue (`body <id> --changelog "Added: …"`), and at merge time `changelog <ids>` prints the entries of those issues grouped by section, ready to paste under `[Unreleased]`. Your repository's layout does not change.
</details>

<details>
<summary><b>Can I get a dashboard or a release checklist out of it?</b></summary>

Out of the record, yes, as outputs rather than new modes. `status --by repo|tag|kind|prio` counts per group, and `status --json`, `report --json` (one row per issue), `queue --json` and `tips --json` have documented, stable shapes, so a page or a script renders the dashboard. A checklist that repeats (a release, a triage) is an issue template in `.jarl/templates/<name>.md`, filed with `new "<title>" --template <name>` and chained with `--after`, one issue per phase. [Both are in the skill](skills/jarl/SKILL.md#views-for-dashboards).
</details>

<details>
<summary><b>What does closing an issue take?</b></summary>

At least one `--ran`/`--saw` evidence row — the command that was run and what it printed — recorded after the issue was last started or reopened (after its filing, when it was never started); a free-text note never counts on its own, so a note written when the issue was filed cannot close it. And an approving review, named with `--by`, that no later round, restart or reopen has spent. The tool refuses an approve by the issue's own worker, and `status` and `report` say who reviewed the done work: a fresh reviewer, the jarl, or nobody recorded. It gates the record only; nothing stops code from landing.
</details>

<details>
<summary><b>Why one script, and why so small?</b></summary>

Jarl is the light version. Four markdown files and one rule: a status that changed without a log line did not change. The tool exists so that rule is enforced rather than promised — it files, lists, searches, moves a status with its reason, records evidence, says what can run in parallel and closes the loop. When the bookkeeping needs a gate and a charter, that is the moment to move to Horde — the vocabulary carries over unchanged.
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

**Three jobs, one core, in layers.** **[Yggdrasil](https://github.com/krzysztofdudek/Yggdrasil)** is the law: the architecture graph and the rails that hold every change to it. **[Grain](https://github.com/krzysztofdudek/Grain)** surveys the terrain: it mines that graph from a repository's own code and history, so there is a rule-backed map before anyone writes a rule by hand. **[Horde](https://github.com/krzysztofdudek/Horde)** is the software house that builds on the law: zero standing roles, a worker per ticket and a one-shot architect who rules the whole plan once, each ticket refined onto the graph and given a tick. Adoption runs Grain first — install it day zero for a soft, draft-only law that never blocks — then Yggdrasil as the core you keep long term, hard law with proof and CI. Work too big for one agent has two doors. Horde is the door for a mission held to Yggdrasil's law, and the add-on **Jarl** is the lighter door beside it: an issue loop, a worker per issue and evidence before each merge, with no law and no landing gate. From 6.0.0 the core ships as one version; the add-ons keep their own. In the family, law is raised by whichever agent does the work in its own territory, and only the client — the one person the whole system answers to — lowers or vetoes it. The three core repositories' shared machine contracts are registered on [one page](https://krzysztofdudek.github.io/Yggdrasil/family-contracts).

| Core | What it holds |
|---|---|
| **[Yggdrasil](https://github.com/krzysztofdudek/Yggdrasil)** | The law. The architecture graph and the rails that hold every change to it, checked before the agent moves on, re-proved in CI without a key. |
| **[Grain](https://github.com/krzysztofdudek/Grain)** | The terrain survey. Mines a repository's own code and history into a first graph — components, dependencies, and the rules the code already keeps, each with the count of places that break it today; Yggdrasil accepts it with one command. |
| **[Horde](https://github.com/krzysztofdudek/Horde)** | The software house on the law. Zero standing roles: a worker per ticket in its own worktree, refined onto the graph and given a tick by a nine-item merge checklist; a one-shot architect rules the whole plan once; the client orders the mission and is the only one who can lower or veto a rule. |

Four add-ons attach to the agent rather than to the graph, and each works alone. Horde doesn't assume any of them is installed — it carries its own minimum discipline in each role's law — but uses Ratatoskr, Urd and Researcher when they are, one sentence per row below.

| Add-on | Stage | What it makes the agent prove | In Horde's loop |
|---|---|---|---|
| **[Ratatoskr](https://github.com/krzysztofdudek/RatatoskrSkill)** | request → intent | Keeps the agent talking to you in plain words, not code, so you can follow what it's doing. | Keeps the client's plain-language registry open at both ends of a mission. |
| **[Urd](https://github.com/krzysztofdudek/UrdSkill)** | intent → code | When the spec is ambiguous, it consults the source of truth and asks, it doesn't guess. | The stop a worker hits before it guesses. |
| **[Researcher](https://github.com/krzysztofdudek/ResearcherSkill)** | code → measured result | Point it at a metric and it runs experiments, hypotheses kept and discarded. | Runs the retrospective's measurement. |
| **Jarl** (this one) | issues → merged branch | The agent directs a crew: it files what it sees as issues, gives each issue a worker in its own worktree, and merges a worker's branch only after a fresh reviewer approves it. | None. Jarl runs beside Horde, for work that needs more hands than one agent and no architecture graph. |

## License

MIT © [Krzysztof Dudek](https://github.com/krzysztofdudek)

---

<div align="center">
  <img src="yggdrasil.svg" alt="Yggdrasil" width="150" />
</div>
