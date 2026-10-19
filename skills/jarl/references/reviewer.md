# The reviewer

The agent that gives a verdict on an issue, with a standing. Read it when you are raised as a reviewer, or when the jarl raises one.

## Contents

- [The review](#the-review): who reviews, the three words, what a code issue needs
- [The reviewer's brief](#the-reviewers-brief): the text the jarl hands the reviewer

## The review

A worker's report is a hypothesis. A **fresh one-shot reviewer** — never the worker, never the merger — reads the issue and the diff and answers with the review discipline's three words: Critical, Important, Minor. Critical or Important is `review <id> changes --by <reviewer> "…"` and a round back to the worker; Minor alone is `review <id> approve --by <reviewer> "…"` with the minor points in the findings, never a bounce. `--by` names who reviewed; the tool refuses an approve by the issue's worker. **A code issue — one that records a Branch or a Merged field — needs a fresh reviewer**: an agent that neither wrote the code nor runs the loop. The jarl's or the reeve's own approve is recorded but does not clear it for `done` or the merge queue; only issues with no code (a ruling, a document) close on it. So the jarl raises a reviewer for every branch, however small. The reviewer checks that the new test was red before the change and green after, that the acceptance line is met literally, and that nothing outside the issue moved. The reviewer's brief follows.

## The reviewer's brief

```
You are the reviewer of issue <id> on branch jarl/7-slug of <repo root>. The loop's tools are the jarl
MCP tools, always called with root: "<repo root>" (in the default mode the issue exists only there, never in
git); with no jarl_* tools in your session, `node <absolute path to jarl.mjs> <command> --root <repo root>`.
Read-only; spawn nothing,
and never `git checkout` in the main checkout — the merger is the only one who moves it, and a
reviewer checking out there mid-merge is exactly the collision the merger's sole-committer rule
exists to prevent. To reproduce red-before-green, read the pre-change file with `git show
<sha>:<path>` or extract it into a scratch tmpdir with `git archive`, never by checking out a ref
in place.
Read the issue (jarl_show { id: "7", root: "<repo root>" }), then `git diff <feature-branch>...jarl/7-slug` — in
the repository the issue's **Repo:** names when it names one, the loop's own otherwise. Answer three questions with
evidence: does the diff meet the acceptance line literally (quote it in the findings; an issue with none is
itself a finding); was the new test red before the change
and green after; did anything outside the issue's scope move. Rank every finding Critical / Important / Minor. Return: verdict (approve | changes)
and the findings, one line each, severity first. Minor findings alone are an approve.
```
