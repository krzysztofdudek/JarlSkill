# Glossary

Each term below is defined here, once; the rest of the skill uses it in that sense and links here instead of defining it again.

| Term | Meaning |
|---|---|
| `issue` | A unit of work filed under a number in the loop, with its fields and its acceptance lines; Horde calls it a ticket. |
| `loop` | The `.jarl/` directory and everything kept in it for one run of Jarl: the goal, the rulings, the issues and the log. |
| `lease` | The claim an in-progress issue holds on its files, its branch and its worker, written as Since, Branch, Worker and Model. |
| `package` | A set of issues that share one worker branch and are checked and merged together. |
| `round` | One red attempt by a worker on an issue; the third round sends the issue to a takeover. |
| `evidence row` | A numbered `--ran` and `--saw` pair under an issue's Evidence, the checkable record of what a command printed. |
| `proof` | The evidence rows an issue holds, which the done gate reads as proof of the work. |
| `note` | Free text under an issue's Notes, which explains the work and never counts as proof. |
| `verdict` | A reviewer's `approve` or `changes` on an issue, with who gave it and its findings. |
| `standing` | The reviewer's standing, `fresh`, `coordinator` or `self`, which says how independent the review was. |
| `gate` | The done gate: the test an issue passes before it is set done, made of its proof and a live approve. |
| `merge record` | The sha, the CI state and the merge check that a merge leaves on each issue it lands. |
| `ruling` | A decision recorded in `decisions.md` with its slug, its date and who ruled it. |
| `question` | An `ask` the owner must answer, of one type, which waits in the record until it is answered. |
| `type` | The closed category of a question: `stop`, `stuck`, `lower`, `charter` or `ratify`. |
| `profile` | The file that names a loop's statuses, flags, fields and sections, read as data and never as rails of its own. |
| `tier` | The strength an issue is given, `light`, `standard` or `strong`, which picks the models it may run on. |
| `model` | The name of the model a worker or a reviewer ran on, recorded with the lease or the verdict. |
| `mode` | How the loop lives in git: `default` out of git, `committed` with the work, or `permanent` as a standing record. |
| `format` | The record format a loop's files are written in; Jarl reads the formats it knows and refuses a higher one. |
| `owner` | The one who rules: sets the goal, answers the questions and decides what is theirs to decide. |
| `jarl` | The director of the loop, the role that files issues, raises workers, records verdicts and merges on evidence. |
| `worker` | The agent that does one issue in its own worktree, on its worker branch, and records the proof. |
| `reviewer` | The agent that gives a verdict on an issue, with a standing. |
| `merger` | The agent that lands an approved branch into the feature branch and records the merge. |
| `composer` | A tool that runs its own loop on Jarl's record through the record library, such as Horde. |
| `scope` | The measure of a worker branch against its base: its commits, its diff inside the declared files and its test changes, as numbers with no verdict. |
| `check` | The check that decides whether work lands: a goal's `Check` line, or the check the merger ran for a merge. |
