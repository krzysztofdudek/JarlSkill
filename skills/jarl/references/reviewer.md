# The reviewer

Read it when you are raised as a reviewer, or when the jarl raises one. The terms are defined in [glossary.md](glossary.md).

## Contents

- [The review](#the-review): who reviews, the three words, what a code issue needs
- [The reviewer's brief](#the-reviewers-brief): the text the jarl hands the reviewer

## The review

A worker's report is a hypothesis. A **fresh one-shot reviewer** — never the worker, never the merger — reads the issue and the diff and answers with the review discipline's three words: Critical, Important, Minor. Critical or Important is `review <id> changes --by <reviewer> "…"` and a round back to the worker; Minor alone is `review <id> approve --by <reviewer> "…"` with the minor points in the findings, never a bounce. `--by` names who reviewed; the tool refuses an approve by a self: the issue's worker, anyone who has held its lease, and the workers of any other issue on the same Branch. **A code issue — one that records a Branch or a Merged field — needs a fresh reviewer**: an agent that neither wrote the code nor runs the loop. The jarl's or the reeve's own approve is recorded but does not clear it for `done` or the merge queue; only issues with no code (a ruling, a document) close on it. So the jarl raises a reviewer for every branch, however small. The reviewer checks that the new test was red before the change and green after, that the acceptance line is met literally, that nothing outside the issue moved, and that the change weakened nothing that worked or protected before.

**After a round**, the gate counts the reviewer of the previous round as fresh, so it may approve again. The practice, for quality, is a new one-shot reviewer for each round, handed the findings of the previous round to check.

**The reviewer's rules.** Jarl gives these to every reviewer they reach, as rules of the reviewer's role:

- Every round, re-check every acceptance line of the issue, not only the findings of the round before.
- On work done on the light tier, re-run each command a proof row names.
- Work on a record format, a contract or what a person sees is reviewed a tier above the worker.
- A change meant to alter nothing is reviewed by checking that its comparison of the output before and after covers everything the change touched.
- The verdict judges the issue's acceptance and what the change itself broke; a finding outside that is filed as a new issue and never turns the verdict to changes.

A change meant to alter nothing carries the tag `identical-output` and records that comparison as a proof row, the command and what it printed; its review may be on the light tier, and the comparison never stands in for it. The light tier counts only for an issue that carries the tag and a proof row whose command or output names the comparison (a word such as compare, diff, cmp, identical, checksum or hash), recorded after the issue's last round or reopen and not retracted: a comparison made before the work was sent back is not the comparison of the change as it stands. The tag alone changes nothing, and the rank note, the reviewer rule and `models` all read the issue that way. The tag is the jarl's or a coordinator's to set, or the filer's when the issue is filed with it; the issue's own worker never sets it, because the worker is the party the rule guards against. A reviewer who finds the tag set by the worker, or a comparison that covers less than the change touched, reviews the change as any other and says so in the verdict.

A finding outside the issue is given with the verdict, `review <id> <verdict> --by <reviewer> --outside "<finding-outside-the-issue>" "<text>"`, one `--outside` each (and `--field "<name=value>"` for a field the loop's profile requires): Jarl files it as a new issue whose Found by is the reviewer and whose Where is `the review of <id>`, and refuses `changes` whose only Critical or Important findings are those.

A verdict that judged one render or file names it with `--artifact <path>`. The record holds no place on one machine and is read on every platform, so the rule is one allowlist: the value is a relative path inside the repository the work is in, written in plain characters: letters and digits with their marks, spaces and `. _ - + @ # , = ( ) [ ]`, a `$` only between two letters or digits, a `%` only where it is neither first in a segment nor before two hex digits, and `/` or `\` between segments; no segment is empty, ends with a dot or a space (but for the `./` the value may open with) or is a device name of Windows (`CON`, `PRN`, `AUX`, `NUL`, or `COM` or `LPT` with one of 0 to 9, ¹, ², ³, with any spaces and extension after it); the value never opens with a dash, holds at most 260 characters, reads the same after Unicode normalization (NFC) and holds no letter, digit or mark whose NFKC form holds anything but letters, digits and marks; any other character (a colon, a quote, a `~` or a `!`, a control, format or invisible character, another space) is refused. A colon is refused wherever it stands: it parts a scheme, a host and its port, a drive and a stream, and a name with a colon cannot be written on Windows. Inside a name a `$` or a `%` is the name's own (`price$total.png`, `50%.png`), and a shell variable that opens a segment is refused (`$HOME/x.png`, `%TEMP%\x.png`). The value is stored as given, trimmed of the spaces around it. `show` prints it with the verdict, `report` counts the verdicts that name one, and the first raises the loop to record format 3. It gates nothing: Jarl never holds a landing back for a look, and a look the owner takes himself is an acceptance line only he ticks (see [The owner's sign-off](profile.md#the-owners-sign-off)).

**A reviewer records its own verdict**, as the last step of its brief. One that returned without recording is resumed to record it; the jarl relays the verdict (`review --relayed`) only when the reviewer cannot be resumed. Any verdict meant to clear an issue is recorded with `review`, never as an evidence note, and a verdict relayed by someone else is recorded with `review --relayed`. The reviewer's brief follows; `brief <id> --role reviewer` prints what the record holds for it: the issue, the rules that reach its reviewer, the rounds so far with their findings, the proof rows and the command that records the verdict.

## The reviewer's brief

```
You are the reviewer of issue <id> on branch jarl/7-slug of <repo root>. The loop's tools are the jarl
MCP tools, always called with root: "<loop-root>" (the directory holding .jarl/; in the default mode the issue exists only there, never in
git); with no jarl_* tools in your session, `node <path-of-jarl.mjs> <command> --root <loop-root>`.
A refused call writes nothing: a refusal ends with the form of the command with a `<placeholder>`; fill the value and run it; never paste it as printed. The commands Jarl prints are written for a POSIX shell (sh, bash, zsh) on macOS and Linux, and on Windows for PowerShell and cmd, whose double quotes Git Bash reads alike but for a path that starts with two backslashes, which it reads with one; replace every `<placeholder>` before running one.
Read-only; spawn nothing,
and never `git checkout` in the main checkout — the merger is the only one who moves it, and a
reviewer checking out there mid-merge is exactly the collision the merger's sole-committer rule
exists to prevent. To reproduce red-before-green, read the pre-change file with `git show
<sha>:<path>` or extract it into a scratch tmpdir with `git archive`, never by checking out a ref
in place.
Read the issue (jarl_show { id: "7", root: "<loop-root>" }), then `git diff <base-branch>...jarl/7-slug` — in
the repository the issue's **Repo:** names when it names one, the loop's own otherwise.
Read the rulings in force (jarl_decisions { live: true, root: "<loop-root>" }): a change that goes against one is a finding.
Read the evidence rows the worker recorded: a worker's missing rows, red and green not recorded as --ran/--saw rows, are an Important finding.
Answer four questions with evidence: does the diff meet the acceptance line literally (quote it in the findings; an issue with none is itself a finding); was the new test red before the change and green after; did anything outside the issue's scope move; and, for every review and above all after a round, did the change or the fix weaken anything that worked or protected before (a mode, a default, a guard, a test)?
Rank every finding Critical / Important / Minor. Minor findings alone are an approve.
Record your own verdict as your last step, with every field filled: jarl_review { ids: "7", verdict: "approve" or "changes", text: "<findings-with-a-severity>", by: "<reviewer>", model: "<model-id>", root: "<loop-root>" }, with one line each in text, its severity first, your own name in by and the model you run on in model. A finding outside the issue goes in outside, one item each, never in text: it is filed as a new issue and never turns the verdict to changes. Your answer is that verdict and the findings, and it quotes the line review printed.
```
