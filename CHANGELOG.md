# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Up to 0.1.0 Jarl followed Semantic Versioning on its own number. From 6.1.0 it follows the Yggdrasil family's one-number policy instead: the core of the family (Yggdrasil, Grain, Jarl and Horde) ships together under one number, so a minor release can include changes that ask something of you, and its section lists them under **Before you upgrade**. A release in which Jarl does not change says "No changes in Jarl."

## [Unreleased]

### Added

- A note written on a task can be taken back, as an evidence row can, with who took it back and why. The issue view that a worker reads leaves a retracted note out, and the full view shows it struck through.
- Every part of an issue's description can now be corrected, including its tier, its kind and who found it, and the record keeps who changed it and what it said before. What happened to an issue, such as its test results, reviews and merges, is never edited, only taken back or replaced.
- You can ask Jarl what is waiting on one person: the owner's open questions, or the next step of every task for whoever runs the loop, each with the command that takes it. The status and the resume of a loop can end with that list. Work on code that waits for a review shows as one line naming all the tasks, with the question that asks the owner to start a fresh session if no reviewer can be raised; once that question is asked, the work shows on the owner's list.
- A ruling made by the jarl or a coordinator can now name the ruling it rests on, such as the owner's mandate. The name is shown with the ruling in the list of rulings and in the resume, and a name that is not a ruling in force is refused.
- When the text of an open issue mentions another unfinished issue by number and nothing orders the two, filing or editing that text and checking the record now print a note naming both, so you can say which comes first. The note changes nothing and never stops anything.
- A task can be handed to a new worker on purpose, with the reason it changed hands, and the record keeps that reason. The old worker's branch and folder are then no longer reported as a problem.
- A loop can now say after how many failed rounds a kind of task is handed to a fresh worker, with a line such as `Takeover (docs): 2` in its goal. A line `Takeover: 4` sets it for every other kind, and a loop that says nothing keeps three. A changed number counts from the next failed round, and the rounds are counted from the last handover. Each round line now ends with its place in that count, which older Jarl versions and Horde read as a plain round; rounds an older Jarl wrote count a handover every third.
- A coordinator named in the goal can run its own part of the backlog: tag an issue `slice:<name>` to put it in that coordinator's part. An issue belongs to one part at most, and the status shows who runs which part.
- A coordinator can look at its own part of the backlog alone: what to start next, the status and the resume each take the part's name. A task waiting in one part never holds back a task in another; only work already started does.

### Changed

- A task another worker already holds, or one that would touch a file or resource another worker holds, is now refused when you start it, naming who holds it, instead of quietly replacing that worker. To give a held task to someone else, say it is a handover and why.
- A loop is marked with a new format, format 3, the first time Jarl writes into it one of the new kinds of entries this release adds. Format 3 is the format of Jarl 6.3.0: from then on an earlier Jarl refuses that loop with a clear message, saying it needs a Jarl that knows format 3, instead of misreading it, so every copy of Jarl that works on the loop must be 6.3.0 or later. The status, the check of the record and the profile now show which format a loop is in.
- Jarl no longer changes the format of a loop that another tool runs, such as a Horde mission, so that tool can always read it. New issues and questions there get three-digit numbers, and anything that would need a newer format, such as taking back a piece of proof or naming a repository by a bare name, is refused with a message that says why. Jarl shows what is switched off in such a loop.
- Tools that build on Jarl's record library get a new version of its contract, which keeps everything the previous version offered.
- If you copy Jarl's record library into your own tool, copy the `scripts/lib/` folder too. It now sits next to `record.mjs` and `jarl-lib.mjs`, and the library does not work without it.
- When a new issue is filed without a kind or a priority, Jarl says which one it took and names the option that sets it, as it already does for the tier.

### Fixed

- A research findings file with a misspelled field name is now refused, and the finding and the field are named, instead of filing the issue with that part left empty. A dry run refuses it the same way.
- `models` on a loop that has no issue yet, such as a fresh copy of a committed loop, now reports an empty loop. Before, it said the loop was missing.
- A ruling recorded as the owner's now needs the owner's own words, which are kept with the ruling and shown beside it. A ruling recorded without a name is now the coordinator's, no longer the owner's.
- Every ruling written into an issue now says who made it. No other text in the record can look like the owner's own words, whatever spelling it uses.
- Every tool now refuses a field it does not take, including the help tool, and names the fields it does take, so a misspelled field is never dropped without a word.
- A merge recorded before its test run has finished now shows as waiting for its check in the status, the resume and the issue itself, with the command that records the check. It stops showing once the check, or the red check it landed on, is recorded.
- Recording a merge now warns when the commit you give does not contain the branch's latest work or the latest state of the branch it is merged into, so a check that ran on the wrong version is noticed at once.
- When a merge is recorded without its commit, Jarl now shows the latest commit of the issue's branch and the exact command that records it, so you do not have to look the commit up and retype the command.
- When an issue cannot be finished because its latest review asks for changes, the message now names that review, with its reviewer and date, instead of a review round that was never recorded.
- The first issue can be filed in a fresh copy of a loop that is kept in git, even when the loop had no issue yet when it was committed. Before, it stopped with an error about a missing folder.
- After three failed rounds on a task, Jarl suggests a different model or a changed approach for the next worker, and never a level above the strongest. The next suggestion comes after three more rounds, not on every round. A round can record how many findings it left, so a task that is getting better can be told from one that is stuck.
- Pausing a task and picking it up again no longer throws away its test results and its review, as long as nobody changed its code in between. A new change to the code still asks for new results and a new review.
- Tags, files, issue numbers and the other lists can be given to the tools as a real list, and each item is stored on its own, so filtering by a tag finds the issue. A list typed out as text, in brackets with more than one item or with quotes, is refused with a message that says how to write it, and so is a tag or an issue number that holds a bracket or a quote mark, and any item that starts with a dash. A file name in brackets, such as [id], is kept as a path.
- When two copies of a shared loop each file an issue and are then merged, both issues can get the same number. Jarl now says so and names both files, refuses to change either one by that number, and shows each one at the status its own file says, so one issue's status is never copied into the other. Neither can be closed or approved under that number, because Jarl cannot tell whose test results and reviews are whose: you file the work again under a new number. It also says how to give one of them a new number by hand.
- When a repository is kept by its path rather than by its name, Jarl explains why the first time it happens in a loop. It no longer repeats that explanation on every new issue that names the same repository.
- Recording a merge now warns when the branch got new commits after its review was approved. The warning names the reviewed commit and the merged one, and gives the commands that show the difference and record a new review. The merge is still recorded.
- `resume` and `decisions` show an answered question with its answer first, then the question.
- `models` counts a model written with dots and the same model written with dashes, such as `claude-opus-5.5` and `claude-opus-5-5`, as one model, and its row names both spellings. A review or a task that uses the other spelling gets a note naming the spelling the record holds.

## [6.2.0] - 2026-10-19

Jarl 6.2.0 makes the record of a loop more complete and more honest, and it keeps track of who did what. The file your assistant reads first is also shorter and clearer.

### Before you upgrade

- A loop, the record Jarl keeps of a piece of work, is marked with a new format the first time anything is written to it that an older Jarl would misread: a repository name, an issue or question number of 1000 or more, a retraction, or a new issue or question number below 100 written without leading zeros (3, not 003). A new loop, or any loop with fewer than 100 issues, is marked at its first new issue or question.
- From then on every copy of Jarl that touches that loop must be this release, including copies of Jarl installed in assistants in other sessions and other copies of the project. A copy of the previous release refuses such a loop with a clear message instead of misreading it.
- Nothing is migrated. Loops are read as written, with two exceptions. A repository path written as a bare word, such as `sub`, becomes `./sub` when the loop is first marked, with the same meaning. A status, lease, merge or build-check line that was only edited by hand in an issue file no longer counts: the log is the record now, and such an edit does not move the issue.
- Recording a merge no longer sets the result of the build checks to pending. Add `--ci <state>` when you want one; a tool built on Jarl's record keeps the old default.
- `merged` now deletes the issue's worktree and its branch on this machine when that is safe. `--keep` stops it.
- `show` prints the part of an issue that matters, and `show <id> --full` prints everything. `next` lists only what can start now, and `next --all` lists the rest.
- The assistant tools no longer include `handoff`. Start a session from `resume`.
- `review` refuses findings of fewer than three words, so `LGTM` no longer passes; say what was read and what was found.
- `close` refuses while any issue is deferred. Use `archive` to keep the work, or `close --force` to remove it; a permanent loop keeps its record and lists the deferred issues.
- An answer to a question that waits for the owner's ratification must say who gave it, with `--by`.
- The `handoff` entry in `status --json` and the `legacyHandoff` entry in `resume --json` are no longer part of the documented output. They are still printed.
- The file your assistant reads first is now short, with a `references` directory beside it. A plugin install gets both. If you copy the skill by hand, copy the whole directory.

### Added
- An issue can need files before it is done, such as a picture before a fix and one after it, and Jarl will not close it until they are there.
- A new command, `verify`, checks that a loop's record is in good order and changes nothing.
- A wrong verdict, the reviewer's decision, or a wrong piece of proof can be taken back with `retract`. The original stays visible, struck through, with who took it back and why.
- Jarl keeps which model did each piece of work and which model reviewed it, and `models` shows how well each one did.
- A loop can name its repositories, so the record holds nothing that belongs to one machine.
- A question can offer choices, and several questions that wait for ratification can be answered at once.
- Status, resume and report list a closed issue whose conditions for being done no longer hold, such as a proof that was taken back, with the command that repairs it.

### Changed
- `status` and `resume` say what each issue in progress is waiting for.
- There are three tiers of worker, `light`, `standard` and `strong`, and `standard` stays the default.
- A new lease, the claim an issue holds while it is in progress, no longer records where its worktree is. Jarl finds the worktree through the branch.
- Issue numbers are plain: 7, not 007. Both mean the same issue, so type either.
- `check` is now `scope`, and `check` still works as a name for it.
- `set <ids> <field> "<value>"` still writes a field and an empty value still clears it, with a note that points to `field`. `field` writes only `Resources` and the fields a loop's profile declares; the other fields keep their own commands.

### Fixed
- Long findings and notes are kept whole instead of cut to their first line.

## [6.1.1] - 2026-10-13

### Fixed
- Jarl's tools now start in Cursor, from an entry of the plugin made for Cursor.

## [6.1.0] - 2026-09-29

Jarl 6.1.0 lets one loop drive work across several repositories, keeps the loop out of your git history by default, and starts each new session from a single `resume`. Your agent reaches every command as an MCP tool, and the record gets firmer: an issue closes on recorded proof, and code on a fresh reviewer's approve. Jarl now shares one version number with the rest of the Yggdrasil family's core (Yggdrasil, Grain and Horde), so it moves from 0.1.0 straight to 6.1.0. Under that shared number a minor release can carry upgrade steps, and this one has a few.

### Before you upgrade

- Jarl runs on Node.js 22 or later (0.1.0 ran on Node 18). Install Node 22 first.
- New loops stay out of git: `init` has git ignore `.jarl/`, and worktrees of the same repository still find it. To carry a loop to another clone or machine, open it with `init "<goal>" --committed`, which keeps it on the branch as 0.1.0 did. Loops opened with 0.1.0 stay committed.
- `set <id> done` closes an issue once it has a `--ran`/`--saw` evidence row recorded since it last went in progress or was reopened; a free-text note, a ruling or a drop or defer reason does not count on its own. An approve holds until the next red round, reopen or restart. Record a row with `evidence <id> --ran "<command>" --saw "<output>"` before you close. Issues already done stay done.
- Every `review` names its reviewer with `--by <reviewer>`, and Jarl refuses an approve from anyone who worked the issue or its branch. An issue that records a branch or a merge closes on a fresh reviewer's approve, from someone who neither wrote the code nor runs the loop; the coordinator (`jarl`, `reeve`, `coordinator`, the loop's directory name, or a name on a `Coordinators:` line in `goal.md`) closes rulings and documents. Raise a fresh reviewer for every branch.
- The command line checks its input: it refuses an unknown flag or an extra argument with exit code 1, and for a flag it names the ones the command takes. A value starting with `--` belongs to the flag before it; a note or title starting with `--` goes after a bare `--`. `decide` takes slugs of letters, digits and `. _ -`, and `ask --issue` takes an existing issue. Adjust any call the tool refuses.
- `resume` takes over from the handoff and assembles the state live. `handoff write` succeeds and writes nothing, `handoff read` prints what `resume` prints and needs a loop, and `status` leaves out the handoff's age. Start sessions from `resume`.
- `report` prints "Found along the way" when you pass `--found`. Add the flag wherever you want that section.
- The journal's review line reads `NNN review approve · by <name> (<kind>) · <findings>`. Update anything that parses it.

### Upgrading from 0.1.0

1. Install Node.js 22 or later.
2. Update the plugin. In Claude Code: `/plugin marketplace update jarl-marketplace`, `/plugin install jarl@jarl-marketplace`, then `/reload-plugins`; the README covers Copilot, Codex and Cursor. A drop-in copy takes the whole `skills/jarl/` directory.
3. A loop opened with 0.1.0 carries on as a committed loop. On its first write, Jarl adds an ignore file and merge settings inside `.jarl/` and a merge driver to the repository's local git configuration. Commit the new `.jarl/` files with the loop.
4. Bring scripts and agent instructions that call the tool in line with the list above.
5. To have ratified rulings written into Yggdrasil's logs, use Yggdrasil 6.1.0 or later. With an older `yg`, Jarl prints the command to run by hand.

### Added

- One loop can drive work in several repositories. Name the repository root on the issue (`new --repo <path>` or `repo <id> <path>`) and its files carry that repository's name first (`tool/src/a.mjs`, or `app/app/x.mjs` when the repository holds a directory of its own name). `next`, `check`, `resume`, `report` and the other views follow the issue there.
- From any worktree of the repository, the tool finds the loop without `--root`.
- `resume` gives a new session everything in one read, from the goal and the rulings in force to the work in flight, the merge queue and CI. It writes nothing and needs no network unless you pass `--ci`.
- `init "<goal>" --permanent` keeps a loop after `close` as a record, and `mode permanent` turns a committed loop into one. `archive "<slug>"` puts a finished loop away so a new one can open in its place, and `set <id> deferred "<why>"` parks work that waits on someone.
- A committed loop merges cleanly when two branches carrying it meet, and stops with conflict markers when both changed the same ruling. `merge-driver flags` prints the settings for `git merge`.
- Fuller issues. `new --where --what --why --acceptance` and `body <id>` write the body, `after <id> <ids>` orders issues, `new --template <name>` starts from a template, and `--changelog "Added: …"` keeps the issue's changelog entry until `changelog <ids>` prints it at merge time. `evidence`, `review`, `set`, `tag` and `prio` take id lists such as `203-206`, all or nothing.
- Branches, merges and CI on the record: `set <ids> in-progress --branch <b>` leases a package of issues, `merged <ids> --sha <sha> --ci <state>` records a merge, `queue` shows the merge queue, and `tips` shows each repository's branches with their CI. None of them blocks a merge.
- `report` ends with loop metrics: cycle and lead time, rounds, reopenings, the share of fresh reviews, red CI after a merge, and follow-ups. A `Check: <command>` line in `goal.md` names the check that decides what lands.
- Rulings can supersede one another (`decide --supersedes`, `decisions --live`), and `ask --kind ratify` records a choice that waits for your word. `decide --area <type> --reach <n>` marks a ruling for every file of a type; `close` puts these to you in one batch and, in a repository with a Yggdrasil graph, writes each one you ratify into that type's decision log. Add `--rule <id>` to name one of the graph's rules, and your yes also ratifies that rule in Yggdrasil so it can stand enforced, for every type the rule reaches.
- `import <findings.json>` files one issue per research finding, once, and `sources` shows what was filed.
- An MCP server starts with the plugin. Every command is a tool with the same arguments, marked as writing or read-only, and the whole list costs an agent about 7,000 tokens. `JARL_ROOT`, if you set it, takes an absolute path.
- Profiles let a tool such as Horde run its work as Jarl loops: `init "<goal>" --profile <file>` sets statuses, fields and sections, and can hand scheduling, the done check, `close` and `archive` to that tool.
- A versioned library, `jarl-record/1`, lets a tool read and write a loop without the command line.
- JSON for dashboards: `status --by repo|tag|kind|prio`, more counts in `status --json`, one row per issue in `report --json`, and `waitsOn` and `after` as lists on every `next --json` row. The skill documents these shapes as stable.
- Jarl runs on Windows, checkouts with Windows line endings included, and Copilot and Codex can install it from a portable Agent Plugins 1.0 manifest.

### Changed

- `branches` without `--repo` covers every repository an open or in-progress issue names, and marks stale leases and branches ready to delete.
- A line in `goal.md`'s rules, or a ruling, can give standing permission to push the feature branch; the merger then pushes it after each green merge. Worker branches stay local.
- Where a helper agent cannot start agents of its own, the loop notices at the start and relays every spawn through files, second rounds included.

### Fixed

- Workers, reviewers and the merger can write at once: each write waits its turn behind a lock, so every evidence row, log line and issue number lands.
- Evidence grows line by line: a note, a drop reason and each `--ran`/`--saw` pair add a line of their own to what the issue already holds, text with `$&` or `$1` included.
- `check` counts a file an issue names relative to a subdirectory as in scope.
- The merger also removes the branch a worker started on when the platform created its worktree.
- Titles with `ł`, `ø`, `ß` and similar letters give readable file names: `gałęzi` becomes `galezi`.
- In a dev container handed the host's install path, the skill uses its own copy of the tool, or stops if there is none.

## [0.1.0] - 2026-09-13

### Added
- The `jarl` skill. Invoke `/jarl <goal>` on a feature branch and the agent becomes the director of that branch: everything anybody sees becomes an issue in a committed `.jarl/` directory, one worker per issue works in its own worktree, nothing merges without evidence the agent has reproduced itself, and the directory is removed by the last commit before the branch merges to main. Testing, stress and research sessions run on the same loop, with some workers producing issues while others take them down.
- One small tool, `jarl.mjs`, that every change of state goes through: file an issue, list and search by status, kind, tag, priority or text, change a status with its reason written to the journal in the same move, tag and prioritise, ask the user a question of one of four closed kinds (stop, stuck, lower with a named target, charter) rather than free text, record evidence — free text, or a repeatable checkable row naming the command and what it printed —, record a review verdict where "changes" must name a Critical or Important finding (Minor alone rides an approve instead of bouncing the branch), ask what can run in parallel right now, count red rounds and hand an issue to a fresh worker after three, check a worker's branch before merge (commits, files outside the declared scope, test files removed, assertions before and after), list worker branches with unmerged commits, file questions only the user can answer and turn their answers into rulings, write a handoff for the next session, produce the closing report, and close the loop; its worker guidance now steers a scratch copy over `git stash` for holding work aside, since the stash list is shared across every worktree of a repository, and never checks out a ref in the main checkout — the merger alone moves it, and now confirms each `done` actually landed before moving to the next branch; the loop now treats a merger's own report as the only signal it has stopped touching the main checkout, after a rewritten HEAD surfaced when that was assumed instead of confirmed — which refuses while anything is still open. Node, no dependencies.
- Three standing helpers the loop raises so the director's own context is spent on the client: a reeve that runs the loop day to day and reports back on four occasions only, a fresh reviewer per branch, and a merger that verifies and merges one branch at a time. Worker branches are named by issue and never leave the machine.
- Installable as a Claude Code plugin, a GitHub Copilot CLI plugin, a Codex CLI plugin and a Cursor plugin, or as a single file dropped into any agent's skill directory.

[Unreleased]: https://github.com/krzysztofdudek/JarlSkill/compare/v6.2.0...HEAD
[6.2.0]: https://github.com/krzysztofdudek/JarlSkill/compare/v6.1.1...v6.2.0
[6.1.1]: https://github.com/krzysztofdudek/JarlSkill/compare/v6.1.0...v6.1.1
[6.1.0]: https://github.com/krzysztofdudek/JarlSkill/compare/v0.1.0...v6.1.0
[0.1.0]: https://github.com/krzysztofdudek/JarlSkill/releases/tag/v0.1.0
