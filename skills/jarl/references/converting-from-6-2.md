# Converting a loop from 6.2

The tool reads one record format, the one whose `goal.md` holds the line `Format: 4`, and refuses any other loop on every command, naming this file. There is no conversion command: an agent converts a loop by hand, once, by following this page, and a script it writes for the mechanical part is the natural way to do it. Read it whole first. The terms are in [glossary.md](glossary.md).

The loop a 6.2 Jarl, or a driver older than 6.2 wrote, holds no `Format:` line, no writers, no issue keys and rows that name no acceptance line. What cannot be invented stays visibly absent: a writer becomes the fixed word `unrecorded`, a row becomes a history row that counts for no line.

## Contents

- [Before you start](#before-you-start)
- [What each file holds and what it becomes](#what-each-file-holds-and-what-it-becomes)
- [The log, line by line](#the-log-line-by-line)
- [The order of the work](#the-order-of-the-work)
- [How you know it worked](#how-you-know-it-worked)
- [What changes for the work in progress](#what-changes-for-the-work-in-progress)

## Before you start

Nobody else writes the loop while it is converted: stop the workers and any other session. Make a copy of `.jarl/` first, or be sure it is committed. The tool cannot help (it refuses the loop until the last step); read and write the files of `.jarl/` directly, and only those named below. Every file keeps its line endings.

## What each file holds and what it becomes

| File | Holds | Becomes |
|---|---|---|
| `goal.md` | no `Format:` line | one line `Format: 4`, alone on its line, after the goal's paragraph and before `## Assumptions`, added last of all (see [The order of the work](#the-order-of-the-work)) |
| `goal.md` | a check line written in words: `Check: <command> (in <name>)` | `Check (<name>): <command>`, with `<name>` the repository as an issue's `Repo` value ends: `Check (JarlSkill): cd skills/jarl/scripts && npm test`, for `Repo: ../../../JarlSkill`. A check of the loop's own repository stays bare: `Check: <command>`. A line naming a repository no issue names and no `Repo` value ends with is written the same way, under the name the line gives |
| `goal.md` | a list item naming the repository first: ``- Check: <name>, `<command>` `` with any words after the closing backtick | `Check (<name>): <command>`, the text inside the backticks only, under `<name>` as an issue's `Repo` value ends (`- Check: Jarl, ...` where issues name `JarlSkill` becomes `Check (JarlSkill): ...`), and a bare `Check: <command>` for the loop's own repository |
| `goal.md` | `Check:`, `Model (<tier>):`, `Coordinators:` lines in the grammar above | stay as they are |
| `issues/<n>-<slug>.md` | no key | one line `**Key:** <yyyymmdd>T<hhmm>-<four-letters>`, directly above `**Tags:**`: the stamp of the issue's filing line in `log.md`, the minute of it, and four random lower-case letters, a different key for every issue |
| `issues/<n>-<slug>.md` | evidence rows: `- **ran:** <command> · **saw:** <printed>`, and struck through, `- ~~**ran:** ... **saw:** ...~~` | `- **ran (history):** ...`, `- ~~**ran (history):** ...`: the word `(history)` goes after `ran`, inside the bold, on every row, and nothing else in the row changes. A row of this format named no acceptance line, so it proves none |
| `issues/<n>-<slug>.md` | anything else: the header, the sections, the Reviews, the notes | stays as it is. An acceptance line with no mark reads as `read`; a line that already reads `[owner] ...` keeps it |
| `profile.json` | `"format": <n>` as a key | the key is removed; a file left holding only `"jarl-profile"` is deleted. A file with a key `"external-scheduler"` loses that key too |
| `log.md` | the journal | see [The log, line by line](#the-log-line-by-line) |
| `asks.md`, `decisions.md`, `repos.md`, `.gitignore`, `.gitattributes`, `.permanent`, `templates/`, `archive/` | | stay as they are |

Repo values, branches, worktrees, leases, reviews and merge lines are all read as they stand.

## The log, line by line

Go through `log.md` from the top. The heading `# Log` and blank lines stay.

| A line | Becomes |
|---|---|
| a dated line about the loop: `- <stamp> · <text>`, `<text>` not beginning with the number of an issue | `- <stamp> by unrecorded · <text>` |
| a dated line about an issue: `- <stamp> · <text>`, `<text>` beginning, as a whole word, with `filed <n>` or `<n>` where a file in `issues/` carries that number (`031`, `31` and `0031` are one number) | `- <stamp> key <key> by unrecorded · <text>`, `<key>` the key of that issue's file |
| a line that is neither dated, nor a heading, nor blank: part of a text of several lines written whole under a driver older than 6.2 (`opened`'s goal and the check lines it copied, for one), sometimes after a blank line | joined to the dated line above it with ` ⏎ ` between them, the line and any blank lines before it removed |
| a dated line that reads `<n> evidence row · <command>` | the same with `(history)`: `- <stamp> key <key> by unrecorded · <n> evidence row (history) · <command>` |
| a dated line whose text was struck through by hand: `- <stamp> · ~~<struck text>~~ <anything after>` | a note about the loop: `- <stamp> by unrecorded · struck through by hand: <struck text> <anything after>`, the `~~` marks gone. A strike never voided anything, so the line must not read as the verdict or move it shows; the words stay, for whoever reads the log |

Every other dated line, a move, a round, a verdict, a merge, a body change, a retraction, a note, keeps its text; only its head changes. A line a later Jarl wrote (one that already holds `key <key>` or `by <who>`) stays as it is, and a row that already names `(line <digest>)` keeps it and proves its line.

The last line of the file is new, written after everything above, with the stamp of the moment of the conversion:

```
- <stamp> by <who> · converted
```

`<who>` is the converting agent's name; `<stamp>` is `yyyy-mm-dd hh:mm`, UTC, as every other line's. No other line is added, moved or reworded beyond what the table above says. This line is what the record reads as the boundary: an issue closed before it is not read against today's gate.

## The order of the work

1. Pick the keys: one per issue file.
2. Rewrite every issue file: the Key line and the history rows.
3. Rewrite `log.md`, then add the `converted` line.
4. Clean `profile.json`.
5. Rewrite the check lines of `goal.md`, and only then add the line `Format: 4`.

Adding `Format: 4` last means a conversion that stops halfway is refused like any other old loop, and nothing reads a half-converted record.

## How you know it worked

Run `verify` on the loop, with `--root <loop-root>`: it is clean, or it names each line it could not place, and each line it names is fixed in the file, not explained away. A row that `verify` names as naming no line was missed in step 2; a line named as `not a line of the current shape` was missed in the log pass. Then `status`: the counts of issues and of their statuses are what they were, and `resume` prints the goal and the questions as before. A `done` issue remains done: the record closes it before the `converted` line. An issue that cites a ruling superseded before the conversion keeps its words: `verify` prints it as a note, and no text is rewritten for it.

## What changes for the work in progress

An issue not closed before the conversion is read by the rules as they are. Its history rows prove nothing, so each of its `test`, `check` and `compare` lines needs its proof recorded again, by the holder of its lease and by someone else; a line with no mark is a `read` line, cleared by a live approve. A lease goes on as it stands.
