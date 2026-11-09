# Building on the record

What a tool that builds on Jarl's record may rely on, and what Jarl will not grow. Terms: [glossary.md](glossary.md).

## The record as a library

Another tool reads and writes a loop through `scripts/record.mjs` and nothing else. Its contract is `RECORD_API` (`jarl-record/4`), with every export and its parameters listed in the file itself; each operation holds `.jarl/.lock`, refuses with the CLI's reason and writes the same lines. Nothing else here is a contract. Where the library and the command line differ is listed in [What only the command line does](record.md#what-only-the-command-line-does). A library call that names no writer writes `unrecorded`.

## What Jarl will not grow

Jarl records, derives and displays; it never blocks code from landing. Each of these stays out for its own reason:

1. **A merge queue that runs the check and refuses a merge.** The landing belongs to the repository's check; a second gate in Jarl would disagree with it.
2. **A `done` that waits for green CI.** CI is an outside witness recorded when known, and a loop must close when CI is absent or late.
3. **Leases that expire or move by themselves.** A false takeover duplicates long work; a stale lease is shown and a person or a director acts.
4. **A release mode that refuses to tag.** A release is issues chained by After under the owner's word; the tags belong to each repository's own release workflow.
5. **A computed schedule or critical path.** `next` offers what can run now; estimates that a schedule needs are noise, so After is ordering and nothing more.

## Boundary with other skills

Jarl is the loop; it does not replace discipline. TDD, debugging, verification and review skills hold inside every worker, and Urd's "ask, don't guess" holds inside the jarl.
