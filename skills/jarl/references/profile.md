# Proof, the done gate and profiles

What counts as proof, what an issue needs before it is done, how a record is taken back, and how a loop's statuses, fields and sections are declared as data. Read it before recording evidence, before setting an issue done, and before writing or reading a profile.

## Contents

- [Proof, Notes and the merge record](#proof-notes-and-the-merge-record): which entry goes where in an issue's Evidence
- [Attachments](#attachments): files a profile makes an issue carry before it is done
- [The window of the done gate](#the-window-of-the-done-gate): which rows and approves count, and how the views flag a gate that does not hold
- [Retracting a verdict or an evidence row](#retracting-a-verdict-or-an-evidence-row): taking a record back
- [Profiles](#profiles): statuses and their flags, fields, sections, and the keys a composer uses

## Proof, Notes and the merge record

Evidence is recorded as pairs of `--ran` and `--saw` (the rule is in [SKILL.md](../SKILL.md#the-rules-that-never-bend)). In Jarl a pair is one row of `evidence <ids> --ran "<command>" --saw "<what it printed>"`, and `set done` needs at least one such row inside the gate's window.

An issue keeps what proves the work apart from what explains it, and apart from the merge. **Proof** holds the worker's `--ran`/`--saw` rows. **Notes** holds free text, rulings (`decide --settles`, `answer --issue`), the reasons of a drop or a deferral (`Dropped: …`, `Deferred: …`) and the entries that retract a row. The merger's check lives in the **merge record**, beside **Merged:** and **CI:**: `merged --ran … --saw …` writes the **Merge check:** header field and names the check on the merge line, and writes no row, so the merger's check never stands in for the worker's proof. `set done` counts only Proof, and when the merge record holds a check but Proof is empty, its refusal says that the row is the worker's and the merge check does not stand in for it; `merged` and an approve say so too when the issue holds no Proof row yet.

The two parts are two sub-headings inside `## Evidence`, `### Proof` and then `### Notes`. A sub-heading is written with the first entry that belongs under it, so a new issue's Evidence is empty until then, and a section holding only Notes gets `### Proof` in front of them with its first row. Where an entry goes:

- A row goes after the last row of the section, wherever that is, so a row never goes in front of another and the ordinals `show` prints and `retract` takes never move; with no row yet it goes at the end of Proof, in front of an existing Notes. Once a row written by a writer that does not know the parts sits under Notes, later rows follow it there.
- An attachment of an issue's proof goes where a row goes: after the last row, at the end of Proof.
- A note, a ruling, a reason and a retraction entry go at the end of the section, in Notes. A retracted row stays where it is, struck through.
- Free text and reasons cannot hold a line that reads as a sub-heading: such a line is escaped.
- A section that already holds content and neither sub-heading is read as it stands and never converted: every writer appends at its end. A section holding only Notes reads as having no evidence yet.

Two limits are plain. A writer that does not know the parts appends at the end of the section, so when it records a merge check as a row on an issue in parts, that row sits under Notes and counts as a row. And a composer that closes issues through the record library, such as Horde, writes its own row with `addEvidence` after `recordMerged`: that row goes to Proof, by design, and satisfies the gate it asks for.

## Attachments

A profile can make an issue carry files before it is done, a picture before the fix and a picture after it, for instance. The done gate declares them: `"requires-slots"` names, per kind of issue, the slots the issue must fill, and `"slots"` declares each slot's **place** (a path under the loop root, with `<id>` for the issue's number and at most one `*`, in the file name, such as `attachments/<id>/before.*`), its **extensions** (lower case, without the dot) and its **minimum size** in bytes (at least 1, the default); `"requires-slots"` names at least one kind. Jarl holds no store: the file stays where the agent put it.

`evidence <id> --file <path> --slot <name>` records the attachment as one Proof row, `attach <slot> <path> sha256:<hex> size:<bytes>`: the slot, the path relative to the loop root, the sha256 of the file's bytes and its size. It refuses a file that does not exist, an empty one, one under the slot's minimum size or over 64 MiB, a slot the profile does not declare for the issue's kind, a path outside the slot's place, an extension the slot does not allow (compared in lower case), and a path that is absolute, climbs out with `..`, holds whitespace, is a directory, a pipe, a socket or a device (anything that is not a regular file is refused before it is opened, so a pipe never blocks Jarl), or is or sits under a symlink. The path recorded is the file's name as the disk spells it. A row of that shape is written only by this command: `--ran` refuses a command that reads as one once the log's own trimming and first-line cut are applied, in any case. A slot is recorded again by a new row, and the newest row of a slot is the one that counts; retracting it leaves the slot empty and never brings a replaced row back. An attachment row is a Proof row, so it also counts as a `--ran`/`--saw` row for the done gate.

`set <id> done` reads every slot the issue's kind requires, on the disk, inside [the gate's window](#the-window-of-the-done-gate), and refuses with one line per slot that is not filled, naming the problem and the `evidence` command that fills it: no row recorded (a row logged before the last start or reopen is outside the window and does not count), the file gone, a disallowed extension or a size under the minimum, or bytes whose sha256 differs from the recorded one. An issue of a kind that requires no slots is not affected, and a loop whose profile has no `"requires-slots"` behaves as if slots did not exist. `status`, `resume` and `report` flag a closed issue whose slot is broken on the disk, like any closed gate that does not hold; they check existence and size only and never read the bytes, so a same-size rewrite is caught by `done` and `verify`, which read them. `show` ends with the issue's slots, each with its recorded path, size, a short hash and its state, so a reviewer agent can open the files: `filled`, `gone`, `changed` (the bytes differ from the recorded ones), `refused` (with its reason: a disallowed extension, a size under the minimum, a path outside the place), `outside` (only a row logged before the gate's window exists) or `not recorded` (with its place and extensions); `show --json` carries the same states under `attachments`. `verify` reports a slot row whose file is gone or whose bytes changed. Jarl does not judge what a picture shows: the gate guarantees that the proof exists, has the right shape and is the file that was recorded, and the reviewer reads it.

A bug hunt files many issues, and each becomes its own pull request with a description and pictures. With the profile `{ "jarl-profile": 1, "statuses": …, "done-gate": { "requires-slots": { "bug": ["before", "after"] }, "slots": { "before": { "place": "attachments/<id>/before.*", "extensions": ["png"], "min-size": 1000 }, "after": { "place": "attachments/<id>/after.*", "extensions": ["png"], "min-size": 1000 } } } }`, each worker takes the before picture first, records it with `evidence <id> --file attachments/<id>/before.png --slot before`, fixes the bug, takes the after picture and records it the same way, so the issue holds both pictures and its `--ran`/`--saw` rows beside each other, and the pull request description is written from the issue and its two files. The reviewer opens the files `show` lists. The attachments directory is the loop's to keep or to commit; Jarl records paths and hashes only.

## The window of the done gate

One window decides which rows and which approves count: a row counts when it is logged after the last start, reopen or filing, and an approve counts when it is logged after the last start, reopen, filing or red round. A start is a move into in progress from another status; a reopen is any move out of a status that closes the record, or a move back to open from in progress; the filing counts for an issue never in progress. A start and a reopen reset the rows and the approves together, so an issue that is closed, reopened and closed again needs a new row as well as a new approve. A red round resets the approves alone: it spends the approve, and the rows the worker logged stay true. A retraction takes an approve or a row out of the window, never into it.

**The gate is checked at the move, and the views flag a gate that does not hold.** The record can change after an issue is closed: its approve or its proof row retracted, a restart that spent the approve, a merge recorded after it went done or on a dropped or deferred issue, a code issue done with no merge. `status`, `report` and `resume` list each such closed issue on one line, `closed, gate does not hold: <id> · <reason> — repair: <command>` (`closedGate`, an array of `{id, reason, repair}`, in their `--json`), computed from the log every time and never stored. The repair is a fresh `review`, a new `--ran`/`--saw` row, or `set <id> open` to reopen it. Nothing is refused for it, and `report` counts a retracted approve as retracted, not as unrecorded.

## Retracting a verdict or an evidence row

The record is never edited to take something back; a wrong entry is retracted by an entry that says who and why. `retract <id> review --by <who> "<reason>"` retracts the newest approve not yet retracted; `retract <id> <n> --by <who> "<reason>"` retracts the n-th evidence row, `n` the ordinal `show` prints before the row, counted over the whole Evidence section and never reused. The one verb takes the same arguments for both and names one issue. The original stays in the issue, struck through (`~~…~~`), the retraction is an entry of its own in the issue and a line in the log, and the done gate and the metrics do not count it. A retraction only tightens: it takes an approve or a row away, never a `changes` verdict (which would revive an acceptance the record already answers), and it never overrides a reviewer — a reviewer who disagrees records a verdict of their own. The first retraction in a loop raises the loop's record format (see [The format marker](record.md#the-format-marker)).

## Profiles

A loop may be opened with a profile: `init "<goal>" --profile <file>` checks the file and stores it as `.jarl/profile.json`; `profile` prints the loop's profile, and `profile <file>` checks a file without touching the loop. A profile is data. It says which statuses an issue moves through and what each one means to the tool, which header fields and sections its issues carry, and the heading their acceptance lives under. A loop with no profile runs on the built-in one, the five statuses of [the issue file](record.md#the-issue-file). A composer that runs on Jarl (Horde is the one this was made for) brings its own profile; a loop you open by hand rarely needs one.

```json
{
  "jarl-profile": 1,
  "name": "house",
  "statuses": {
    "proposed": [],
    "queued":   ["dispatchable"],
    "running":  ["lease"],
    "landed":   ["lease"],
    "merged":   ["settles-dependents", "terminal", "closes-record"],
    "blocked":  [],
    "dropped":  ["terminal", "needs-reason"]
  },
  "initial": "proposed",
  "fields": {
    "Kind":   { "enum": ["feature", "fix", "chore"], "default": "feature" },
    "Area-2": { "enum": ["core", "cli"], "required": true },
    "Class":  { "default": "b" }
  },
  "sections": ["Plan"],
  "acceptance-heading": "Acceptance — evidence"
}
```

What a status means is said by its flags, never by its name:

| Flag | What the tool does with it | Built in |
|---|---|---|
| `dispatchable` | `next` offers the issue | open |
| `lease` | the issue holds its files against the others and carries the lease: a move into it writes Since (and Branch, Worker, Model when given), leaving it removes the lease | in-progress |
| `settles-dependents` | the issue does not hold back the issues that wait on it with After | done, dropped |
| `terminal` | finished business: `list` hides it by default, `close` and `archive` do not wait for it | done, dropped, deferred |
| `closes-record` | a move into it passes the done gate (evidence since the claim, a live approve, fresh for code), and `status`, `report` and `review` count it as done work | done |
| `needs-reason` | a move into it needs a reason, written under Evidence as `<Status>: <why>` | dropped, deferred |

A status is at most one of `dispatchable`, `lease` and `terminal`, and `closes-record` is terminal too. A profile needs at least one dispatchable, one lease, one terminal and one settles-dependents status (without the last, every issue waiting on another with After would wait for good). A status may not take a name the views already print or key for something else: `waiting`, `ready`, `in-flight`, `questions`, `ratify`, `to-ratify`, `goal`, `opened`, `archived`, `stale`, `handoff`, `reviews`, `uncommitted`, `by` and `statuses` are reserved, and the refusal lists them. A composer whose own queue has a waiting state names that status otherwise (`held`, `parked`). A new issue starts in `initial`, else in the first status listed, which may not be terminal or hold the claim; a status with no flags is one an issue waits in (a proposal not yet accepted, a block), counted by name and never offered. `branches` marks a branch DONE → delete when every issue on it is closed (closes-record) or given up (terminal and settles-dependents without closing the record, built-in: dropped), at least one closed; an issue in a terminal status that settles nothing (deferred) keeps its branch. `queue` takes only issues in play (dispatchable or lease), never one waiting in a status with neither. A few views read two built-in words by name: the leases `branches` lists, `tips` and the CI counts of `status` pass over a status named `dropped`, `close` names the issues left in a status named `deferred`, and `report --json` keeps its `dropped` and `deferred` counts by those names.

Fields: a name is letters, digits, spaces and dashes (`Area-2`). A field may carry `enum` (its values), `default` and `required`. `new` writes every declared field after **Where:** (the `--field "<Name>=<value>"` given, else the template's, else the default; a required one with none is refused, and a value outside the enum is refused), `list` and `resume` show the ones an issue holds, `field <ids> <field> "<value>"` writes one on several issues at once (a field may not share a name with a status), `list --match <field>=<value>` filters on any header field, and `status --by <field>` counts per value. Declaring `Kind` or `Tier` with an `enum` replaces their built-in values. The fields the tool writes itself (Status, Priority, Tags, Files, Repo, After, Found by, Source, Where, Branch, Worker, Worktree, Since, Merged, CI) cannot be declared. Sections: extra headings, written after the acceptance and filled with `new`/`body --section "<Heading>=<text>"`. `acceptance-heading` names the heading the loop's issues keep their acceptance under; it counts exactly as `## Acceptance` does, and `body --acceptance` writes under whichever of the two the issue has.

Five more keys are for a composer that runs the loop's scheduling and landing itself (Horde's mission is one). Each is data; a loop without them behaves as above.

```json
{
  "jarl-profile": 1,
  "format": 1,
  "statuses": {
    "proposed": { "flags": [], "set-by": "record" },
    "queued":   { "flags": ["dispatchable"], "set-by": "record" },
    "running":  ["lease"],
    "merged":   { "flags": ["settles-dependents", "terminal", "closes-record"], "set-by": "record" },
    "dropped":  ["settles-dependents", "terminal", "needs-reason"]
  },
  "external-scheduler": "horde tick",
  "done-gate": { "approve": "none", "requires-merged": true },
  "lifecycle": { "close": "record", "archive": "record", "command": "horde done <mission>, then horde archive <mission>" }
}
```

| Key | What it does |
|---|---|
| `"set-by": "record"` on a status | a status may be written as `{ "flags": [...], "set-by": "record" }`: `set` and the `jarl_set` tool refuse to move an issue into it, and only a library call through `record.mjs` (the composer) can. Moving out of it, and filing an issue that starts in it, stay open. `"any"` (the default) is the list form's meaning |
| `"external-scheduler": "<command>"` | the composer schedules the loop's work, so Jarl computes no ready list it cannot know the edges of: `next` and `queue` print `scheduling is led by the composer: <command>` (`--json`: `{ scheduler, note }`, and `queue` with `repos: []`), `status` counts each dispatchable status by name instead of `ready` (`--json`: `ready: null`, `scheduler`), and `resume` shows that line in place of its next-ready list and merge queue (`next: []`, `held: []`, `readyTotal: null`, `scheduler`) |
| `"done-gate": { "approve": "fresh" \| "none", "requires-merged": bool }` | `requires-merged: true` adds to the done gate a recorded merge (`merged --sha`) whose commit is in the base: the branch checked out in the repository the merge names (else the issue's Repo, else the loop's own), or the branch a composer names as `base` on its `record.mjs` `setStatus` call when it landed the merge into a branch nobody has checked out (a team branch); the command line has no `--base`. `approve: "none"`, allowed only with `requires-merged: true`, drops the approve, because the gate that landed the merge stands behind the issue; the evidence row is asked for either way, `merged` then owes no fresh review, and `status` and `report` say the issues closed on a merge. The default is `{ "approve": "fresh", "requires-merged": false }`: the done gate of [the window above](#the-window-of-the-done-gate). The same object may also hold `"requires-slots": { "<kind>": ["<slot>", ...] }` and `"slots": { "<slot>": { "place": "attachments/<id>/before.*", "extensions": ["png"], "min-size": 1000 } }`: the files an issue of that kind must carry before it is done (see [Attachments](#attachments)); a kind must be one the profile allows, every required slot needs its entry in `"slots"`, and a slot no kind requires is refused |
| `"lifecycle": { "close": "any" \| "record", "archive": "any" \| "record", "command": "<command>" }` | who may end the loop. `"record"` makes `close` (with `--batch` and `--force` too) or `archive`, and the `jarl_close` or `jarl_archive` tool, refuse before anything is written, removed or moved, naming `command`, the composer's own way to close or archive the loop; the composer keeps its own lifecycle, because a loop run on a record it owns (Horde's mission) would otherwise be deleted by `close` with no way back, or moved out from under it by `archive`. A library caller of `jarl-lib.mjs` passes (`caller` other than `cli`). The default is `"any"` for both: any caller may end the loop |
| `"format": N` | the record format the profile was written for; the rule, what raises it and which formats are read are in [The format marker](record.md#the-format-marker) |

`profile` prints all five. A key the schema does not name is refused, so a profile with an unknown key fails loudly instead of being half-read, and a profile file broken by hand refuses every command rather than falling back to the built-in one. `archive` takes the profile away with the loop. With a profile, `status --json` (and the `status` inside `resume --json`) keeps the count per status under its own key, `statuses: { <status>: n }`, instead of the five top-level counts a loop without a profile has, so no status name can overwrite a key of the view; `report --json` adds `statuses` (the count per status), `resume --json` rows of work in flight and ready carry `fields`, and the text of `status` and `resume` names the profile.
