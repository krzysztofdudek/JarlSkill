# Glossary

Each term below is defined here, once; the rest of the skill uses it in that sense and links here instead of defining it again.

| Term | Meaning |
|---|---|
| `issue` | A unit of work filed under a number in the loop, with its fields and its acceptance lines. |
| `loop` | The `.jarl/` directory and everything kept in it for one run of Jarl: the goal, the rulings, the issues and the log. |
| `lease` | One agent, one branch and one or many issues, the unit of work, written as Since, Branch, Worker and Model. |
| `package` | A lease of several small neighbouring issues that are examined and merged together. |
| `round` | One red attempt by a worker on an issue; the round that reaches the takeover limit after the last takeover (the goal's `Takeover` line for the issue's kind, read at each round, and three where it sets none) sends the issue to a takeover. |
| `evidence row` | A numbered `--ran` and `--saw` pair under an issue's Evidence, the checkable record of what a command printed. |
| `proof` | The evidence rows an issue holds, which the done gate reads as proof of the work. |
| `note` | Free text under an issue's Notes, which explains the work and never counts as proof. |
| `verdict` | A reviewer's `approve` or `changes` on an issue, with who gave it and its findings. |
| `standing` | The reviewer's standing, `fresh`, `coordinator` or `self`, which says how independent the review was. |
| `gate` | The done gate: the test an issue passes before it is set done, made of its proof and a live approve. |
| `merge record` | The sha, the CI state and the merge check that a merge leaves on each issue it lands. |
| `ruling` | A decision recorded in `decisions.md` with its slug, its date and who ruled it. |
| `question` | An `ask` the owner must answer, of one type, which waits in the record until it is answered. |
| `type` | The closed category of a question: `stop`, `stuck`, `lower`, `charter`, `ratify` or `escalation`. |
| `profile` | The file that names a loop's statuses, flags, fields and sections, read as data and never as rails of its own. |
| `tier` | The strength an issue is given, `light`, `standard` or `strong`, which picks the models it may run on. |
| `model` | The name of the model a worker or a reviewer ran on, recorded with the lease or the verdict. |
| `mode` | How the loop lives in git: `default` out of git, `committed` with the work, or `permanent` as a standing record. |
| `format` | The one machine line `Format: 4` in `goal.md` that says what shape the loop's files are in, which Jarl reads and refuses any other. |
| `owner` | The one who rules: sets the goal, answers the questions and decides what is theirs to decide. |
| `jarl` | The director of the loop, the role that files issues, raises workers, records verdicts and merges on evidence. |
| `worker` | The agent that does one issue in its own worktree, on its worker branch, and records the proof. |
| `reviewer` | The agent that gives a verdict on an issue, with a standing. |
| `merger` | The agent that lands an approved branch into the feature branch and records the merge. |
| `composer` | A tool that runs its own loop on Jarl's record through the record library. |
| `examiner` | The fresh agent that gives the verdict on one lease's work, called the reviewer in the record and the commands. |
| `director` | The agent that files, shapes, leases and sends rounds: the jarl, or a coordinator over a slice. |
| `method` | How a line will be proved, one of `test`, `check`, `compare`, `read` and `owner`, chosen when the line is written. |
| `shape` | How lines are carried by agents, read from the leases, one agent on the whole issue by default. |
| `holder` | Who moves next on an open thing, computed by `next --as`. |
| `slice` | The part of the backlog under one coordinator, tagged `slice:<name>`. |
| `scope` | The measure of a worker branch against its base: its commits, its diff inside the declared files and its test changes, as numbers with no verdict. |
| `check` | The check that decides whether work lands: a goal's `Check` line, or the check the merger ran for a merge. |
