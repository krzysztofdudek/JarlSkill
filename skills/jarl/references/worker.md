# The worker

Read it when you are raised as a worker, or when the jarl writes a worker's brief. The terms are defined in [glossary.md](glossary.md).

## Contents

- [Worker branches](#worker-branches): the branch name, where it lives, what it carries
- [The worker's brief](#the-workers-brief): the text the jarl hands the worker
- [Changelog fragments](#changelog-fragments): the entry lives on the issue until the merge

## Worker branches

The worker's own-worktree rule is in [SKILL.md](../SKILL.md#the-rules-that-never-bend). The prefix is `jarl`, so a worker's branch is `jarl/7-slug`, the issue's own slug after its number: two workers never share a name and a branch reads as its issue. Two loops sharing one clone prefix the branch with the feature branch's last path segment (`<segment>/jarl/7-slug`), and the tool reads that name as the same issue number. Such a branch exists only in the clone running the loop: it is cut from the feature branch, merged back into it by the merger with `--no-ff` and a message naming the issue, and deleted together with its worktree. **It is never pushed** — the feature branch is the only branch of this loop that ever leaves the machine, and only on the owner's word. In the default mode a worker branch never carries `.jarl/`; in the committed mode it carries the copy it was cut with, which nobody writes — the loop's live state is the main checkout's, reached with `--root`.

## The worker's brief

```
You are worker <name> on issue <id> of branch <feature-branch>, in worktree <path>, on branch jarl/7-slug.
(When the issue carries a **Repo:** field, <feature-branch>, <path> and the branch are all in THAT repository, not in the loop's own: run git and the repository's check there.)
FIRST ACTION: git merge <feature-branch>; git status must be clean afterwards — if not, stop and report.
If your worktree was made for you by the platform and starts on a branch it named, RENAME that branch
(`git branch -m jarl/7-slug`); never create a second branch beside it, which leaves the first one behind.
Your scope is the issue below and nothing else. Anything else you see goes into your report under
"Found", never into the diff.
No file of the repository carries a task number or a description of a task: no loop issue number appears in code, comments, tests, docs or graph entries, because the loop ends and the number then points nowhere. A comment says what the code does and why it must be so, and a test title says what behaviour it proves. Only the commit subject names the issue (`… (issue <id>)`).
The loop's tools are the jarl MCP tools (jarl_show, jarl_evidence, jarl_body, …); pass root: "<main checkout>"
on every call — your worktree has no live `.jarl/` of its own — and never add `.jarl/` to your branch. If your
session has no jarl_* tools, run the same commands as `node <absolute path to jarl.mjs> <command> --root <main checkout>`.
If the change is user-visible, record its changelog entry on the issue:
jarl_body { id: "7", changelog: ["Added: …"], root: "<main checkout>" } (Changed, Fixed, … — one item per line). Edit
CHANGELOG.md on your branch as well only where the repository's own rules (its CLAUDE.md, AGENTS.md or hooks) require
the entry to come with the change; otherwise leave CHANGELOG.md to the merger.
Read the rulings in force first (jarl_decisions { live: true, root: "<main checkout>" }): a ruling that names your issue or its files binds you.
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
Evidence is for proof: the --ran/--saw rows prove, and a free-text note is a line or two that explains them. Your long report goes to the jarl, not into the evidence.
Before you report, go through the closing checklist, every item, whatever the tier of the issue: the work is committed on your branch; red and green are recorded as evidence rows (jarl_evidence with ran and saw), not only in the report; every check this brief names was waited for to its end, and what it printed is in a row; the changelog fragment is written on the issue, or the change is one nobody sees; the report is sent. A report that skips an item is not yet a report.

<the output of jarl_show for the issue (its current window), not the file>
```

## Changelog fragments

Parallel branches that each add a line to `CHANGELOG.md` under `[Unreleased]` conflict at nearly every merge, in the one place every issue touches. So the entry lives on the issue until the merge: the worker records it with `body <id> --changelog "Added: …"` (repeat the flag for more lines; the jarl can file it with `new --changelog`), and leaves `CHANGELOG.md` alone on its branch — unless the repository's own rules (its CLAUDE.md, AGENTS.md or a hook) require the entry to come with the change, in which case it edits the file as those rules say and records the fragment too. An entry opens with its Keep a Changelog section — `Added:`, `Changed:`, `Deprecated:`, `Removed:`, `Fixed:` or `Security:` — and one without goes under Fixed for a `bug` and Changed for anything else. An issue with no user-visible change has no Changelog section.

`changelog <ids>` prints the entries of those issues grouped by section, in Keep a Changelog order, ready to paste under `[Unreleased]`; when the issues span several repositories it prints one block per repository (an issue naming two appears in both), and `--repo <path>` keeps one. An issue without an entry is named on stderr. The merger writes `CHANGELOG.md` once, after the merge (or the batch) is green, in its own commit on the feature branch: the entries are material, edited into the register the repository asks for and merged into an existing `[Unreleased]` entry when they cover the same feature, as in [Closing the branch](jarl.md#closing-the-branch). Nothing changes in the repository's layout: the fragment is a section of the issue, and the repository keeps its one changelog. A loop whose workers edit `CHANGELOG.md` themselves works the same way: `scope` counts a changelog edit as in scope.
