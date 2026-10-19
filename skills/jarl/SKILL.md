---
name: jarl
description: Use when a session works ON a repository (developing, testing, stress-testing or researching it) with more issues than one agent's hands — invoke as /jarl <goal> to open an issue loop, on the current feature branch or as a permanent record, or resume it at the start of any session where .jarl/ already exists. You become the jarl — the director of that loop — file everything seen as issues, raise a worker per issue in its own worktree, verify by evidence, merge into the branch, and close the loop (removing it before a feature branch merges to main; a permanent loop stays as the record).
---

# Jarl

You are the **jarl of this branch**: the one who directs the work, not the one who does it. The owner is
the one who rules. You talk to them in plain words, you ask them only what is theirs to decide, and you never
spend their trust on a guess.

Jarl is the loop of the Yggdrasil family: issue, worker, evidence, ask, and the record they leave. It holds no law and runs no gate of its own. The law is Yggdrasil's, and where the repository has a check, the check decides what lands, not Jarl: a fresh reviewer can only stop a change, and its word is recorded as testimony. A loop none of whose merges carries the declared check lands on testimony alone, and says so; otherwise it says, per repository, how many merges carry it (see [Loop metrics](#loop-metrics)). A branch, a directory of issues, one tool, a loop. Horde, the family's mission tool, runs its missions on this same loop and adds what Jarl will not grow: an architect who plans the mission onto the graph first, a landing gate and the owner's charter. A loop may be opened with a profile, data that names its statuses and fields (see [Profiles](#profiles)); Jarl reads the profile and never grows rails of its own (see [What Jarl will not grow](#what-jarl-will-not-grow)).

## Glossary

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

## The one place

Everything lives in `.jarl/` in the main checkout the loop runs in. On a feature branch it never
reaches `main`; opened as a permanent record it lives on, wherever `--root` names, for good. The
loop runs in one of three modes, chosen once at `init`:

- **Default — out of git.** `init` writes `.jarl/.gitignore` with two lines, `*` and `**/*`, so git never sees the loop: it stays out of the branch's history, its diffs and its merges. The loop exists only in the main checkout's working tree — it belongs to that checkout, not to the branch, and no other clone or worktree has it. A worker's worktree therefore sees no `.jarl/`, so the worker, the reviewer and the merger always pass the main checkout as `root` (`--root` on the CLI), and nobody ever commits `.jarl/`.
- **Committed — `init --committed`.** `.jarl/.gitignore` ignores only the tool's write lock and the temporary files a write leaves for an instant (`/.lock`, `/.lock.break`, `.*.tmp`), so a `git add` made while a call runs never commits them; the loop itself is committed with the work on the feature branch. `.jarl/.gitattributes` tells git how the loop merges when two branches carrying it meet: `log.md` by union (one dated line per event), `decisions.md` never by union but by Jarl's own driver, `jarl.mjs merge-driver decisions %O %A %B`, which keeps both sides' rulings block by block and stops with conflict markers when both sides superseded the same ruling, used one slug for two rulings, or rewrote one ruling. The tool configures that driver in the repository's local git configuration (a local command, never committed) at `init` and at the first write of a committed loop that lacks it, with a fallback to git's own conflict markers when the script is gone: a driver git is told to run but cannot start keeps ours and drops theirs without a word. A clone that never configured it gets plain markers. The merger passes the driver on every merge anyway (`merge-driver flags`, see [The merger](#the-merger)); GitHub's merge button runs no driver, so a loop's branches merge locally. The merger commits `.jarl/` with every merge, and the last commit before the branch merges to `main` removes the whole directory.
- **Permanent — `init --permanent`.** Committed the same way, with the same narrow `.gitignore` — a record that must survive is always committed — and `init` additionally writes `.jarl/.permanent`, so a later session reads the mode from the loop itself rather than being told. This loop does not live on a feature branch at all: it lives wherever `--root` points, kept as a standing record, for example a repository that keeps one loop per release as that release's record, driving work in other repositories. Everything above — the four files, the issue format, the roles, the tool — is the same; only closing differs, in [Closing the branch](#closing-the-branch) below.

A loop whose `.jarl/.gitignore` ignores everything (a line `*`) is in the default mode; one without that
line, or with no ignore file at all, is committed, and one that also carries `.jarl/.permanent` is the
permanent mode. Only `init` decides the mode of a new loop. A committed loop without the narrow
ignore file is given it by its first write, which changes nothing about its mode; no command
ever turns one mode's ignore file into the other's.
`mode permanent` is the one exception: it turns an *existing, committed* loop into the permanent mode
in place, for a committed loop (one opened `--committed`) — a release loop opened that way is
exactly this case. It refuses a default-mode loop (out of git): a permanent record must be committed,
and there is no in-place way to add git tracking to one, so start a fresh loop with `init --permanent`
instead. It refuses an already-permanent loop too, clearly, rather than silently doing nothing. See the
command table below. Four things:

| Path | What | Who writes |
|---|---|---|
| `.jarl/goal.md` | Why this branch exists, in one paragraph; the standing assumptions; the rules that apply here. Written once at the start, amended only with the owner's word. A `Coordinators: a, b` line (plain, a list item, or bold) names extra reviewers who count as `coordinator` rather than `fresh`, alongside `coordinator`, `jarl`, `reeve` and the loop's own name — the directory holding `.jarl/` — which count as coordinators without being declared. `Model (<tier>): <model>[, <model>…]` lines (the same forms, one per tier) say which models run on each tier: the first is the tier's default, the order of the tiers ranks the models, and a model on no line is unplaced (see [Which model sits where](#which-model-sits-where)). A `Check: <command>` line (the same forms, one per check, several allowed) names the check that decides what lands — the repository's own test or gate — and a `Check (<repo>): <command>` line names one repository's, `<repo>` being the name its Files prefix writes; Jarl never runs it. A merge carries the check when its `--ran` text (`merged --ran --saw`) equals a declared command; `status` and `report` say per repository how many merges carry it, and that the loop lands on testimony alone while none does or while the goal declares no check (see [Loop metrics](#loop-metrics)). | jarl |
| `.jarl/decisions.md` | Rulings: `## YYYY-MM-DD · slug`, the ruling, **By:** who ruled. New rulings are appended and a ruling's text is never edited; the one change the tool makes to a written entry is `decide --supersedes`, which adds a **Superseded by:** line to its closing block. Read before deciding anything; never re-derive a ruling that is here. A ruling marked **Superseded by:** is not in force — the one that superseded it is; `decisions --live` lists only the rulings in force. | jarl |
| `.jarl/issues/7-slug.md` | One issue per file, numbered in filing order from 1. A number is written plain (7, 42, 1000); a number written with leading zeros, as 007, is the same issue as 7. Format below. | jarl (header, status), worker (evidence) |
| `.jarl/log.md` | The journal, append-only, one dated line per event: filed, started, done, dropped, merged, asked, decided. A text of several lines never breaks a line: the whole of it is kept where it belongs (the issue, `asks.md`, `decisions.md`) and the line holds its first line and a pointer. The one exception to append-only: the format raise rewrites the repository part of the tool's own merge lines, once, under the lock. | everyone, through the jarl |
| `.jarl/repos.md` | The repositories the issues name by name, one line each: the name, the repository's root commits (all of them), its origin as found and its base branch, and no path. Written only when an issue first names a repository by name, and by `repo --base`; each write is a log line. | jarl |

**The log is the record, and one tool moves it**: `scripts/jarl.mjs` (Node, zero dependencies). An issue's status, its lease (Branch, Worker, Model, Since), its merge and CI state, its evidence rows and its verdicts are what the lines of `.jarl/log.md` say, read in order. The header fields of an issue file that show the status, the lease, the merge and the CI state are the tool's rendering of those lines, written in the same call, and every view and the done gate read the log. Every status change, tag, priority, ruling and log line goes through the tool, never through a hand edit — a status that changed without a log line did not change, and the tool is what makes that true rather than promised. A header edited by hand is never believed: it is printed as a disagreement (see [When a header disagrees with the log](#when-a-header-disagrees-with-the-log)).

<!-- RUNES:mcp-first:START -->
**Call the tool through its MCP tools first, when the session has them.** A tool with an MCP server offers every command of its CLI as an MCP tool named after the tool and the command (`<tool>_<command>`, a subcommand joined with `_`); the server may start by itself (installed as a plugin) or be configured by hand. The tools are generated from the same command table as the CLI and run the same code, with the same checks, so they are not a second implementation and a tool's answer is the CLI's answer. A tool's description starts by saying whether it writes; when the server also offers a help tool, it prints the full usage text.

- A flag is the field of the same name without the dashes; a flag that takes no value is `true`; a repeatable flag is a list, one item per repetition.
- An argument is the field its usage names, in the usage's order. An argument in brackets may be left out, but not one that comes before another you give.
- The server does not run in your working directory, so a field naming a file or directory the command would look up from there must be an absolute path; a relative one is refused.
- `json: true` answers with the JSON document `--json` prints, as exactly one text block; notes ride in `_meta`.
- Input that does not fit the tool is refused before anything runs (a JSON-RPC -32602 error naming the field). A refusal or a failed check comes back with `isError: true`; where the tool answers a refusal with an error document (`<tool>-error/1`), read its `code`, never its wording.
- A call that runs past the server's time limit, where it sets one, is stopped with everything it started, and the answer says so and how to allow longer.

**The CLI is the fallback.** When a session has no such tools (a host without MCP, a subagent given none, a server that is not installed or not running), run the same command through the CLI, with the same effect; its help prints the usage.
<!-- RUNES:mcp-first:END -->

**Jarl's server.** Installed as a plugin, Jarl starts an MCP server named `jarl` by itself, every command of the tool a tool: `jarl_resume`, `jarl_status`, `jarl_new`, `jarl_set`, `jarl_evidence`, `jarl_review` and the rest, the writing ones included, plus `jarl_help`. The tools also take the same lock as the CLI. A description starts with `WRITES the loop` or `Read-only` and says in one sentence what the command does; `jarl_help` prints the full usage of every command, the same text as `--help`. This skill writes each command the way the tool's usage does (`set <ids> <status> "<why>" [--branch <b>]`), because that one table is what both the CLI and the tools are built from. The fields, command by command:

- the flags `--acceptance`, `--changelog`, `--ran`, `--saw` and `--next` repeat, so their fields are lists, and `ran` and `saw` pair up by position. The flag fields: `init` committed, permanent, profile · `new` kind, prio, tier, tags, files, repo, found-by, where, what, why, acceptance, source, after, changelog, template, field, section · `body` title, where, what, why, acceptance, changelog, section · `import` source, kind, prio, tier, tags, repo, found-by, only, adopt, dry-run, field · `sources` source · `after` clear · `evidence` ran, saw, file, slot · `retract` by · `field` clear · `list` status, kind, tag, prio, grep, match, all · `show` full · `set` branch, worker, model, worktree, header · `repo` clear, base · `next` limit, all · `review` by, model, relayed · `models` by, with, archives · `scope` branch, base, repo · `branches` base, repo, stale-hours · `merged` sha, ci, repo, ran, saw, red, keep · `ask` kind, target, issue, option · `answer` by, option · `resume` log, ready, ci · `handoff` summary, next, log, ready, ci · `decide` settles, by, supersedes, area, reach, rule · `decisions` live · `goal` set · `status` stale-hours, by, tag · `report` found · `queue` repo, base · `changelog` repo · `close` force, batch;
- the argument fields, in the order the usage writes them: `init` goal · `new` title · `body` id · `import` file · `sources` files · `source` id, refs · `after` id, ids · `evidence` ids, text · `retract` id, what, reason · `field` ids, name, value · `show` id · `set` ids, status, why · `merged` ids · `tag` ids, ops · `prio` ids, priority · `files` id, paths · `repo` id, path · `review` ids, verdict, findings · `round` id, what · `scope` id · `ask` question · `answer` id, answer · `handoff` action · `log` event · `decide` slug, ruling · `archive` slug · `changelog` ids · `mode` mode · `profile` file (`sources` and `tag` take a list: the findings files, the `+a`/`-b` operations; the `id` of `body`, `source`, `after`, `files`, `repo` and `round` takes one id or a list with ranges, and the call lands on every id or on none); the absolute paths are `import`'s `file`, `sources`' `files`, `init`'s `profile` and `profile`'s `file`;
- every tool takes `json` (true answers with what `--json` prints) and `root` (what `--root` is: the checkout that holds `.jarl/`, as an absolute path — a relative or empty one is refused).

The answer is the text the command prints; a note the command prints on stderr comes as a second block. A refusal is an error result with its reason, and nothing was written; a `scope` that found something wrong is an error result too, with its items (the CLI's exit code 2). Jarl has no error document: with `json: true` a refusal's one block is the reason as plain text. A value that starts with `--` is just a value in a field. When a call gave no `root`, the answer names the loop it reached: as a block after the text, or, with `json: true`, in `_meta['jarl/loop']` instead, and the CLI's stderr notes go into `_meta['jarl/warn']` the same way, so a host that parses the one JSON block never has to skip anything.

**Which loop a call reaches:** its `root` field; without it, the server's `JARL_ROOT` environment variable (set it in the server's configuration to pin one loop — as an absolute path: a relative one is refused, for the same reason a relative `root` is, rather than resolved against the server's own working directory); without that, the loop found from the directory the host started the server in — the session's project — the way the CLI finds it from its own working directory. The server lives as long as the session, not in the worktree a role works in, so every brief says to pass `root` on every call (see [The CLI, when the tools are not there](#the-cli-when-the-tools-are-not-there) for the same rule on the command line).

| Command | What it does |
|---|---|
| `init "<goal>" [--committed] [--permanent]` | creates `.jarl/` with the goal and a `.gitignore` that keeps the loop out of git; `--committed` writes a `.gitignore` that ignores only the write lock and temporary files, so the loop is committed with the work; `--permanent` is committed the same way, adds `.jarl/.permanent`, and opens the loop with no feature branch of its own — see [The one place](#the-one-place); on the command line it says once when the goal names no `Check` line: the loop then lands on testimony alone, whatever its merges record, until the goal declares one |
| `new "<title>" [--kind k] [--prio 1\|2\|3] [--tier light\|standard\|strong] [--tags a,b] [--files p,q] [--repo <path>] [--found-by who] [--where w] [--what w] [--why w] [--acceptance line]... [--changelog entry]... [--source <dir>#<id>] [--after <ids>] [--template <name>]` | files an issue under the next free number; without `--tier` it records `standard` and says so on stderr, with what each tier is for (see [Which model sits where](#which-model-sits-where)); `--repo` names the repository its code lives in when that is not the loop's own (see [Code in another repository](#code-in-another-repository)); `--where`, `--what`, `--why` and `--acceptance` (repeat it, one checkable line each) write the body in the same call, `--changelog` its changelog entry (see [Changelog fragments](#changelog-fragments)), `--source` names the research finding it comes from, `--after` the issues it waits on; `--template` starts from `.jarl/templates/<name>.md` (see [Templates](#templates)); the reply's first line is `filed 7 · file`, then it lists what was parsed (priority, tier, kind, tags, acceptance lines, the length of What and Why) and every field left empty with the command that fills it; a What, Why or section text that holds a matched `<why>…</why>` pair (the name of any field) outside code is refused, because the fields belong in their own parameters; from a linked worktree of a committed loop whose main checkout holds the same loop, `new` refuses and names the main checkout as the root to pass, and from anywhere else the number is the highest over the main checkout and every linked worktree, plus one |
| `body <ids> [--title t] [--where w] [--what w] [--why w] [--acceptance line]... [--changelog entry]...` | sets or replaces the title (the heading only; the file keeps its name, and the log line records the title it replaces), the **Where:** field and the What, Why, Acceptance and Changelog sections of a filed issue, with a log line; Evidence is never written here |
| `import <findings.json> [--source <dir>] [--kind k] [--prio p] [--tier t] [--tags a,b] [--repo <path>] [--found-by who] [--only <ids>] [--adopt] [--dry-run]` · `sources [<findings.json>...] [--source <dir>]` · `source <ids> <dir>#<id>,...` | research findings into issues, once each, and the coverage view — see [From research to issues](#from-research-to-issues) |
| `after <ids> <after-ids>` · `after <ids> --clear` | the issues these wait on (**After:**): `next` does not offer one until each of its After issues is done or dropped, and `status` counts it as waiting instead of open or in flight; a chain that would come back to the issue is refused |
| `list [--status s] [--kind k] [--tag t] [--prio p] [--grep re] [--all]` | open and in-progress by default, sorted by priority |
| `show <id> [--full]` · `status [--stale-hours n] [--by repo\|tag\|kind\|prio] [--tag <t>]` | one issue as the done gate sees it — the header, What, Why, Acceptance and Changelog; every `--ran`/`--saw` row (numbered `[n]` over the whole Evidence section, the number `retract` takes) and every verdict in [the gate's window](#the-window-of-the-done-gate); every `changes` finding no later approve has answered; one line for each round that came before; last, the exact call that prints everything — `--full` prints the file (rows still numbered), `--json` is complete; under the header, where each repository written as a name is on this machine and the worktree git has on the lease's branch (`--json`: `where`), on stdout only · the loop's goal, when it was opened and when anything last happened, then one line of counts (open, in flight, waiting, done, dropped, deferred, questions, to ratify, merged with CI pending or red), then the landing banner — one line per repository, `k of n merges carry the declared check`, or the testimony mark for a repository that declares no check and while no merge carries the declared check — and, with `--by repo`, the merges of each repository by what they carry (the declared check, not, landed on red), then the choices awaiting ratification, the stale leases, the merges waiting on CI, the waiting issues, the issues in flight with no acceptance line, one line for each issue in flight that says what the record shows and what comes next (`no evidence rows since the start`; `evidence rows recorded, no verdict` — it waits for a reviewer; `changes requested` — back with the worker; `approved and queued` — the merger lands it, then it is set done; `approved by a coordinator only` on an issue that carries code — the merge queue and done refuse that, it waits for a fresh reviewer; `merged, CI not green yet` — record the CI result; `merged` — set it done; derived from the evidence rows and verdicts since the last start or round, never stored, so no status carries it) and, in a committed or permanent loop, how many loop files git has not committed; `--by` adds the five status counts per repository, tag, kind or priority (see [Views for dashboards](#views-for-dashboards)); `--tag <t>` computes every part of `status` (the counts, in flight, stale, waiting, CI, the questions that name those issues, the reviews) over the issues carrying that tag only, for a jarl directing one scope of a large loop — the tag is refused when no issue carries it, `--json` has the same shape plus `tag`, and the goal, the loop files not committed and the check state stay the loop's own; all three print one `record:` line for each header field that disagrees with the log (`disagreements` in their `--json`, only when there are any), see [When a header disagrees with the log](#when-a-header-disagrees-with-the-log) |
| `archive "<slug>"` | puts the current loop away under `.jarl/archive/<yyyy.mm.dd>-<slug>/` — issues, goal, decisions, log and any handoff file kept from before — and leaves the archive, the mode markers (`.gitignore`, `.permanent`) and the templates (`.jarl/templates/`), so the next `init` here opens a new loop in the same mode; open work does not refuse it, but the result and the archived log name it |
| `set <ids> <status> "<why>" [--branch <b>] [--worker <name>] [--model <m>] [--worktree <path>] [--header]` | changes status and writes the log line in one move; `in-progress` writes the lease (see [Packages and leases](#packages-and-leases)), and `--model` the model the worker was raised on, as the platform names it, `@<effort>` included where the platform has that lever, stored as given (a **Model:** field removed with **Worker:**, and `· model <m>` in the lease's log line, before the worker); in a loop with `Model (<tier>):` lines, a lease without `--model` is noted on stderr; `done` needs at least one `--ran`/`--saw` evidence row (an attachment row counts as one) and a live approve, both inside the gate's window (see [the window of the done gate](#the-window-of-the-done-gate)), and every slot a profile requires of the issue's kind (see [Attachments](#attachments)); a free-text note never counts on its own, so nothing written at filing time is proof of the work; issues already done stay done, only the next move to done is checked (and it notes on stderr, never refusing, an issue with no acceptance line, with fewer `--ran`/`--saw` rows than acceptance lines, or with a recorded merge whose CI is not green yet), `dropped` and `deferred` need a reason (`deferred` is work that waits, not work that is gone: the default `list` hides it, `list --status deferred` shows it, `status` and `report` count it apart, and `close` says what it leaves waiting) |
| `tag <ids> +a -b` · `prio <ids> 1\|2\|3` · `files <ids> p,q` · `repo <ids> <name\|path>[,<name\|path>...]` · `repo <ids> --clear` · `repo --base <name> <branch>` | header fields; **Repo:** may name several repositories, by name or by path, and `repo --base` changes the base a declared repository is held against (see [Code in another repository](#code-in-another-repository)) |
| `field <ids> <name> "<value>"` · `field <ids> <name> --clear` | writes one field on every issue: **Resources:** (the exclusive resources an issue holds while its lease lasts, see [An issue](#an-issue)) or a field the loop's profile declares, checked against its values, with a log line per issue; `--clear` empties it, and the same `--clear` empties **Files:**, **Source:**, **Where:**, **Tags:**, **After:** and **Repo:** (each is written by its own command: `files`, `source`, `body --where`, `tag`, `after`, `repo`), and a field the profile requires is never empty; `set` takes a status and nothing else |
| `evidence <ids> "<text>"` \| `evidence <ids> --ran "<command>" --saw "<what it printed>"` \| `evidence <id> --file <path> --slot <name>` | appends a free-text note, or one checkable row per `--ran`/`--saw` pair (repeat the pair for more rows, in one call or several) — `--ran`/`--saw` for what proves the work, free text for what only explains it (rows go to Proof and text to Notes, see [Proof, Notes and the merge record](#proof-notes-and-the-merge-record)); `--file`/`--slot` records one file as an attachment, a Proof row of its own (see [Attachments](#attachments)); nothing already recorded is ever replaced; a free-text note that runs long is written whole and noted on stderr (command line only) |
| `retract <id> review --by <who> "<reason>"` · `retract <id> <n> --by <who> "<reason>"` | takes a record back by an appended entry that says who and why: `review` retracts the newest approve not yet retracted, `<n>` the n-th evidence row (the number `show` prints); the approve or the row stays, struck through, and `done` and the metrics do not count it; never a `changes` verdict (see [Retracting](#retracting-a-verdict-or-an-evidence-row)) |
| `next [--limit n] [--all]` | only the open issues ready to start: they share no file with any in-progress one, their **After:** issues are all done or dropped, and no open `stuck` or `stop` question names them — what can run in parallel now; a file is its repository and its path, so the same path in two repositories never holds an issue back; an issue offered with no acceptance line is marked `(no acceptance yet)`, one with no declared files `(no files declared)`. `--all` adds the rest under headers: held by a file another issue holds (and by which issue), held by a resource another issue holds, waiting on **After:** (on which issues), held by an open question (which one). In a loop with `Model (<tier>):` lines each ready row also shows the model of its tier and, when the record measured a lower-ranked model fitting that kind of issue while the default does no better there, `suggest <model>` with its numbers (`--json`: `model: { default, suggested, basis }`). `--json` rows keep their fields and carry `group`: `ready`, `held-by-file`, `held-by-resource` (an in-progress issue or one offered before it holds a **Resources:** name; `resources` and `heldBy` name them), `waiting-after` or `held-by-question` (`heldBy`, `after` or `questions` name the holder); without `--all` only the `ready` rows are listed, and when none is ready the text says how many are held or waiting |
| `review <ids> approve\|changes --by <reviewer> [--model <m>] [--relayed] "<findings>"` | the reviewer's verdict; `--model` is the model the reviewer was raised on (stored as given; the log line carries `· model <m>` after the standing, and the `## Reviews` entry after the date), and `--relayed` marks a verdict recorded by someone else in the reviewer's name (`· relayed`) — only for a reviewer that cannot be resumed to record its own (see [Which model sits where](#which-model-sits-where)); in a loop with `Model (<tier>):` lines, a verdict without `--model`, an approve by the model leased on the issue and an approve by a model ranked below the worker's are noted on stderr, never refused; the whole findings go under the issue's `## Reviews` section (verdict, reviewer, standing, date, every line) and the log line keeps the first line and a pointer; `changes` needs a finding ranked Critical or Important in the text — Minor alone cannot bounce a branch, it rides an approve into evidence; every verdict needs `--by`, the reviewer's name, and the log line records it with its standing — `self` (the issue's worker, from **Worker:** or its last lease, or `--by self`), `coordinator` (`coordinator`, `jarl`, `reeve`, the loop's own name — the directory holding `.jarl/` — and any name a `Coordinators: a, b` line in `goal.md` lists) or `fresh` (anyone else); an approve by the worker is refused, because a self-approve is not a review (a `changes` by the worker is recorded, not refused); `done` refuses without a live approve inside the gate's window (see [the window of the done gate](#the-window-of-the-done-gate)); on an issue that carries code — it records **Branch:** or **Merged:** — that approve must be `fresh` (the fresh-review rule): a coordinator's approve is recorded, noted on stderr as not clearing the issue, and refused by `done`, while an issue with neither field (a ruling, a document) still closes on it; a name declared a coordinator after its approve was logged does not count as fresh; `status` and `report` print who reviewed the done work (`fresh a · coordinator b · self c · unrecorded d`, unrecorded for approves that name no reviewer); the output repeats the issue's acceptance, so the verdict is read against it, and ends with one `next:` line naming the step that follows — after an approve of code the merger's one `merged <id> --sha <sha> --ran "<check>" --saw "<summary>"` call and then `set <id> done` (a worker never sets done), after an approve of an issue with no code `set <id> done` once the worker's Proof rows are recorded, after a coordinator's approve of code the fresh reviewer's approve, after `changes` the `round <id>` that sends it back to a worker raised again; findings need at least three words (not `ok`, `x` or `-`) |
| `round <ids> "<what failed>"` | one red round on each issue; the third prints a takeover block for a fresh worker, which says to raise it one tier up or on another model than the one the lease names |
| `models [--by repo\|tag] [--with <root>]... [--archives]` | read-only, no lock: per model, as worker and as reviewer, per kind of issue (`Kind · Tier`), what the record holds — units, clean first passes, changes, rounds, red after approve, handed over, evidence rows before review, follow-ups; verdicts, approves checked by a later reviewer of another model, misses, relayed verdicts, clearing approves on the worker's own or a lower-ranked model — every count with its n and a share only from n ≥ 5, then the words `fits` and `below` (the model's clean share against its kind's baseline), `new` (n < 5 in every kind) and `may clear <kind>` (see [Which model sits where](#which-model-sits-where)); work whose lease or verdict carries no model is grouped `(not recorded) · tier <t>`; `--by` slices by repository or tag; `--with <root>` (repeatable) reads another loop, a root or an archive directory under `.jarl/archive/`, and `--archives` this loop's own archives, each merged into one table that groups by the model value as recorded and names the loops it read, so a model is calibrated over several loops (thresholds of n ≥ 5 are reached across loops long before they are reached in one); a path that is not a loop is refused and nothing is written; suggestions only |
| `merged <ids> --sha <sha> [--ran "<check>" --saw "<summary>" \| --red <id>] [--ci pending\|green\|red\|none] [--repo <path>] [--keep]` · `merged <ids> --ci <state>` | the merge as fields, not prose: **Merged:** the sha (and where, with `--repo`), **CI:** only when given (`pending`: a pushed commit whose CI will report; `none`: the repository has no CI to wait for), and a log line per issue. `--ran` and `--saw` (paired like `evidence`'s) record the check that decided the merge in the same call, in the merge record of every issue (the **Merge check:** field and the merge line); they write no evidence row, because the merger's check is not the worker's proof (see [Proof, Notes and the merge record](#proof-notes-and-the-merge-record)), and the reply says so for each issue that holds no Proof row. `--red <id>` records instead a merge that landed while its check was red for a cause outside the branch, which issue `<id>` (it must exist, and is not one of the merged) tracks; it is never counted as a passing check, and the merger uses it only on the jarl's ruling. After it records a sha, it removes each merged issue's worktree and its local branch when that is safe (see the merger's steps) and names what it removed or why it kept it; `--keep` skips that. `--ci` alone moves the CI state of issues that already record a merge; a sha the repository does not know is noted, never refused. `status` counts `merged, CI pending`, `report` prints the sha per done issue |
| `scope [<id>] --branch <b> [--repo <path>]` | a worker branch before merge — with no id, the package on it: the diff is bounded by the union of **Files** of every issue that records **Branch:** `<b>`, so a shared branch passes in one call: commits beyond the base, diff inside the declared files, test files removed, assertions before and after, each item's own ok/not — read the items, not just the exit code; a script gate can use the exit code (0 clean, 2 something failed), a reader should not stop there. Notes sit beside the items and never change the exit code: each added line of the branch that names an issue of this loop by its number, after the word issue or with a hash sign, is listed with its file and line (only a number the loop holds counts; removed lines and commit subjects are not read), at most 20 of them, the rest counted. A branch that no issue records is refused, and the refusal says how many commits it carries beyond the base and what to file. Read in `--repo`, else in the repository the issue's **Repo:** names, else in the loop's own |
| `branches [--repo <path>] [--stale-hours n]` | each branch with the issues it carries (`jarl/163-packages → 163, 164, 165`), `STALE` when a lease on it looks wrong and `DONE → delete` when every issue on it is settled, its tip is in the base and its worktree is clean (see [Packages and leases](#packages-and-leases) for the softer marks); with no `--repo`, in the loop's own repository, in every repository an open or in-progress issue names, and in every repository where an issue that is not dropped records a **Branch:** (rows of another repository are labelled `[name]`); with it, in that one repository: every `jarl/7-*` branch, and every other branch a worktree has checked out (marked UNNAMED when a worker never renamed its branch), with commits beyond the base and worktree state; a branch with commits that no issue holds by its **Branch:** or a lease is marked `NO ISSUE` (`unticketed` in `--json`), except the base and release branches — a branch with commits is a report whether or not the worker said so. Read in `--repo`, else in the loop's own repository |
| `ask "<question>" --kind stop\|stuck\|lower\|charter\|ratify [--target x] [--issue <id>] [--option "<label>: <effect>"]...` · `answer <ids> "<answer>" [--by who]` or `answer <ids> --option <label> [--by who]` | questions only the owner can answer, in a closed set of types — `stop` halts everything, `stuck` blocks one issue, `lower` weakens something protected (`--target` names it), `charter` questions the goal, `ratify` is a choice already made under a mandate that waits for the owner's word and blocks nothing (see [What goes to the owner](#what-goes-to-the-owner)); open ones show in `status`; `--option` (at least two, one per choice) gives the question its options, printed ready for the choice window; an answer is either the label of the option chosen, which the ruling lists with the chosen one marked, or the person's own words, which the ruling quotes as his words; an answer becomes a ruling, by the owner unless `--by` names who answered, and with `--issue` it is written into that issue's evidence too; a ratify item needs `--by` and names no coordinator of the loop, and several ratify items as a comma list take one answer, one ruling each, each naming the batch it was answered in; `decide --supersedes <slug>` names on stderr the open issues whose What, Why or Acceptance still cite the ruling it replaces |
| `goal` · `goal --set "<machine line>"` | the goal as `goal.md` holds it; `--set` changes one machine line of it — `Check (<repository>): <command>` or a bare `Check:`, `Model (<tier>): <models>` for a tier the profile declares, or `Coordinators: <names>` — replacing that line where it stands and leaving the rest of the file as written, with a log line that says what it was and what it is now; a repository is not declared by a goal line |
| `resume [--log n] [--ready n] [--ci]` | read-only, the boot: everything a session picks the loop up from, assembled live from the loop and the repositories its issues name — the goal and the counts line of `status`; the rulings in force (`decisions --live`, one line each); in flight with each lease (branch, worker, since) and any stale one; waiting on After (in progress or not, with the lease and any stale one); held — open issues whose declared file is taken by work in flight, with who holds it, or that an open question names; the open questions and the ratify items; the next ready issues (`--ready n`, default 10, with how many are ready in all); the merge queue; merges whose CI is pending or red; the `tips` of every repository (no network: CI is left out unless `--ci` asks `gh`); the loop files git has not committed; the last log lines (`--log n`, default 15; 0 leaves them out). In flight, waiting, and held plus ready are as many as the counts line says. No lock, nothing written. See [Resuming a loop](#resuming-a-loop) |
| `handoff read [--log n] [--ready n] [--ci]` · `handoff write [--summary s] [--next x]...` | the retired handoff file. `read` prints what `resume` prints, then a `.jarl/handoff.md` kept from before as history — below the live state, its headings one level down, with its age — never as the state; `write` takes the same flags and writes nothing (no file, no log line), prints that it is retired and exits 0 |
| `log "<event>"` · `decide <slug> "<ruling>" [--by who] [--supersedes <slug>] [--settles <ids>] [--area <type> [--reach n]]` · `decisions [--live]` | the journal and the rulings; `log` writes a note and refuses a line that reads as a filing, a move, a round, a verdict, a retraction, an evidence row, a merge, a CI state or a body change, naming the command that writes it; a slug is letters, digits and `. _ -` and is compared as it is written, so only the same slug is a duplicate; `--by` records who ruled (`owner` unless given — `jarl` for a choice made under a mandate); `--supersedes` marks the ruling it replaces **Superseded by:** in place and the new one **Supersedes:**; `--settles` names the issues a ruling settles and writes the ruling into each one's evidence, leaving its status to `set`; `--area` marks a ruling about a whole type of code (**Area:**) and `--reach` how many files that type holds (**Reach:**), so `close` puts it to the owner for ratification (see [Rulings about an area](#rulings-about-an-area)); `decisions` lists the rulings with who ruled, their area and whether it was ratified or rejected, and what superseded them, `--live` only those in force |
| `report [--found]` | done — per repository when the done work spans several, an issue naming two listed under each, so each repository's changelog reads its own section — with who reviewed it, dropped and deferred with reasons, still open; `--found` adds the issues found by someone other than the jarl — the material for the changelog; then the [loop metrics](#loop-metrics), with the testimony mark at the top while no merge carries the declared check, and, per repository, the merges that carry the declared check, those that do not and those landed on red; `--json` also carries one row per issue and the metrics (see [Views for dashboards](#views-for-dashboards)) |
| `queue [--repo <path>] [--base <b>]` | read-only: the merge queue, computed and never stored — see [The merge queue](#the-merge-queue) |
| `changelog <ids> [--repo <path>]` | prints the issues' changelog entries grouped by section, ready to paste under `[Unreleased]` — see [Changelog fragments](#changelog-fragments); reads only |
| `verify` | read-only, no lock, no network, nothing written: the record read by its own readers in their strict mode, each listing what it does not place. The log lists a line that reads as an event and does not parse, a line that is not dated, a struck-through line, a lease or a verdict whose model mark does not parse, and a retraction that points at a row the log does not hold or at an approve the reviewer did not give. The goal lists a Check, Model or Coordinators line the grammar does not place. The issues list an unparsable header, a Resources name that is not a word, a file that is not an issue, and an After naming an issue the loop does not hold. The questions list a line that is neither a question, an option nor a continuation, and an option of no question; the rulings list text before the first ruling and a slug ruled twice. The profile is checked as its own reader checks it. An id of 1000 or more, or a retraction, is found in a loop whose record format was not raised. A header that disagrees with the log is listed in the words the views use. Each repository the issues name by name is checked against its declaration in `.jarl/repos.md` and the checkout on this machine (undeclared, not resolved, another repository; a different origin is a note, a shallow checkout is unverified); a Repo that holds a path is not checked. A lease's worktree must belong to a repository its issue resolves to, and an open issue that cites a superseded ruling by its slug is listed. The output prints each check with its first 20 findings and a count of the rest; `--json` gives the findings, the checks and the notes. Exit 2 when it finds something, 0 when it finds nothing. The test that runs `verify` on real loops is skipped unless `JARL_LIVE_LOOP` names copies of them (each the directory that holds the copy's `.jarl`, several separated by the platform's path separator); `JARL_LIVE_KNOWN=1` also checks the two findings a frozen copy of the release loop is known to hold, a struck-through verdict line and an open issue citing a superseded ruling |
| `tips` | read-only: for the loop's own repository and every repository an open, in-progress or recently merged issue names (CI pending or red, or merged in the last 7 days), the tip of each worker branch in flight (against its own remote branch when pushed, else against the feature branch), the feature branch (the checkout's current branch) and `main`, ahead/behind their upstream as last fetched — nothing is fetched — and, when `gh` is on PATH, the CI of that exact commit (`gh run list --commit`) for a tip its upstream already holds (anything else reads `not pushed`); repositories are told apart by their root, so a loop in a subdirectory and a **Repo:** naming that repository's root are one; a worker branch of an issue naming several repositories is shown where it is and `GONE` only when none of them has it: `green`, `red`, `pending` or `none`; without `gh`, or when `gh` fails, CI is left out, never guessed. It gates nothing |
| `mode permanent` | turns an existing, committed loop into the permanent mode, with a log line — for a loop opened `--committed`; refuses a default-mode loop (out of git — a permanent record must be committed) and an already-permanent loop |
| `close [--force] [--batch]` | refuses while anything is open or in progress, and, where it removes `.jarl/`, while anything is deferred, because deferred work waits and removing the directory would leave it waiting nowhere: the refusal names `archive "<slug>"`, which keeps the loop under `.jarl/archive/` with its deferred issues, and `--force`, which removes the loop with its open and deferred issues and keeps no copy (the output names the deferred issues as removed); otherwise removes the live loop's files, and `.jarl/` itself when it holds no archive. In the default mode `close` and `init` leave `.jarl/archive/` in place, and `close` says so; in the committed mode the archive is committed content, so `close` refuses while `.jarl/archive/` holds anything, names it, and says to move it out of the tree or pass `--force`, which removes the whole directory and says so (an empty archive directory is fine); in the permanent mode it keeps the directory instead and logs the close; in a committed or permanent loop it names the loop files git has not committed; first it files the ratification batch (see [Rulings about an area](#rulings-about-an-area)) and never waits for it; `--batch` files the batch and closes nothing |

`<ids>` on `evidence`, `review`, `set`, `tag`, `prio` and `merged` is one id or several, written as one comma list with ranges: `12,13,14` or `203-206,209`. The tool resolves every id and checks every precondition before it writes anything, so a package of issues merged together closes in four calls (evidence, review, evidence of the merge, `set done`) instead of four per issue, and one missing id or one issue not ready for `done` leaves all of them untouched. Each issue still gets its own log line.

Every command that writes holds `.jarl/.lock` while it runs, and every file is replaced whole, so the workers, reviewers and the merger can all call the tool at the same moment — through the tools or the CLI, from one session or several — without losing each other's rows, log lines or issue numbers. One server runs its calls one at a time, in the order they came, so a call waiting on the lock, or a slow `resume` or `tips`, delays the next call to that server; against every other writer (another session's server, a CLI call) the lock decides. A lock is taken over when its holder is gone: on the same machine, as soon as the holder's process is not running; a lock left empty (the holder died between creating and filling it) after 2 seconds; a lock from another machine sharing the checkout, or one whose holder cannot be read, only after 30 seconds; and a lock whose process id is running again, against a reused id, after 10 minutes. A call waits at most 20 seconds and then fails with nothing written, naming the holder: retry it. So the first call after a crash on another machine can fail once before the 30 seconds pass, and one after a reused process id waits out the 10 minutes or needs the lock removed by hand. Breaking a stale lock is itself serialized (`.jarl/.lock.break`), so it never hands the lock to two callers. Never delete the lock by hand while a call may still be running.

### The CLI, when the tools are not there

With no `jarl_*` tools in the session (the skill copied into an agent's skill directory rather than installed as a plugin, for one), the script is the CLI:

```
node "${CLAUDE_PLUGIN_ROOT:-.claude/skills/jarl}/scripts/jarl.mjs" <command>
```

If that file does not exist where the command runs, the path belongs to another machine: VS Code
attached to a dev container, for one, hands the agent the host's install path, which the container
cannot see. Do not work around the tool. Find the copy this environment has: the directory this
`SKILL.md` was read from, plus `scripts/jarl.mjs`, when that directory exists here; otherwise search
once, `find ~ /workspaces -path '*skills/jarl/scripts/jarl.mjs' 2>/dev/null | head -1`. Use the
absolute path it gives for the rest of the session, and hand that same path to every role you raise.
If there is no copy at all, say so and stop: the loop's state moves only through the tool.

A flag a command does not take is refused with the list of the ones it does, never ignored. A value flag takes the next argument whatever it starts with, so `--ran "--help"` or `--saw "--- FAIL"` records the row; `--flag=value` works too. A note or a title that itself starts with `--` goes after a bare `--` (`evidence 012 -- "--json drops a key"`), and every flag, `--root` included, goes before that `--`: arguments beyond what a command reads are refused, so a stray `--root` can never be dropped silently.

Every command takes `--json` and `--help`. A subagent does not always inherit `CLAUDE_PLUGIN_ROOT`, so
a worker's brief carries the absolute path to the script as well as the tools. Run from a worktree of the repository whose main checkout holds the loop, the script finds the
loop there by itself (default mode: the worktree has none of its own); `--root` still wins when given, and every brief carries the absolute path of
the loop's checkout for it anyway, because a loop that lives in another repository (a hub directing code elsewhere) is not found from the code's worktree,
and in committed mode a worktree holds only the copy it was cut with.

### An issue

```
# 7 · title

**Status:** open | in-progress | done | dropped | deferred
**Kind:** bug | gap | cleanup | docs | test | research | process
**Priority:** 1 | 2 | 3
**Tier:** light | standard | strong, weakest first — the tier of model the worker is raised on, explicit in the file, never implied; the loop's `Model (<tier>):` lines in `goal.md` say which models run on each tier, and the criteria are in [Which model sits where](#which-model-sits-where)
**Tags:** comma, separated
**Files:** the files it touches, comma separated — what `next` uses to keep workers apart; when **Repo:** is set, each starts with that repository's directory name (`tool/src/a.mjs`)
**Repo:** only when the code lives in another repository than the loop — its name, or the path to its main checkout where it is not a sibling of the loop's (see [Code in another repository](#code-in-another-repository))
**After:** only when it waits on other issues — their ids; `next` holds it until each is done or dropped
**Resources:** only when the work uses something no other work may use at the same time — names, comma separated, loop-wide and not files (a port, a database server, `gate` for the machine's load); written with `field <ids> resources "gate, db"`, and emptied with `field <ids> resources --clear`. Only `next` reads it: it does not offer an issue whose resource an in-progress issue holds, nor two issues that declare the same one at once, across repositories too, and `next --all` names the holder under *held by a resource another issue holds*. A resource is held for a lease's whole life: there is no capacity and no lock at run time, `check`, `queue` and the file rules never read it, contention during a test run belongs to the repository's own harness or the workspace's run lock, and how many heavy workers run at once stays the jarl's choice. `Resources` is a field Jarl writes itself, so a profile cannot declare a field of that name.
**Found by:** who, doing what
**Source:** only when it comes from research — <report dir>#<finding id>, several comma separated
**Where:** file:line, or the command and what it printed
**Branch:** only once it is in progress with --branch — the worker branch it is done on, shared by a package; kept after done
**Worker:** · **Model:** · **Since:** the lease, only while in progress — who, on which model (only when `--model` was given), since when (UTC); the lease records no worktree, which is found through the branch (a lease that holds a **Worktree:** field keeps it until it ends)
**Merged:** · **Merge check:** · **CI:** only once `merged` records it — the sha (and where), the check that decided the merge and what it printed (only when `--ran`/`--saw` were given), and pending | green | red | none

## What
One paragraph: the fact.

## Why
What it costs if left as is.

## Acceptance
Checkable. A test name, a command and its expected output, a sentence that is true or false.

## Changelog
Only when the change is user-visible: `- Added: …` (or Changed, Deprecated, Removed, Fixed, Security), one line each.

## Reviews
Written by `review` and `retract`: one entry per verdict — `approve`, `changes` or `retract`, the reviewer and its standing, the date, then the whole findings or reason. Before Evidence, which stays last.

## Evidence
Filled as the work goes: ### Proof, the worker's rows of what was run and what it printed; ### Notes, what only explains.
```

#### Retracting a verdict or an evidence row

The record is never edited to take something back; a wrong entry is retracted by an entry that says who and why. `retract <id> review --by <who> "<reason>"` retracts the newest approve not yet retracted; `retract <id> <n> --by <who> "<reason>"` retracts the n-th evidence row, `n` the ordinal `show` prints before the row, counted over the whole Evidence section and never reused. The one verb takes the same arguments for both and names one issue. The original stays in the issue, struck through (`~~…~~`), the retraction is an entry of its own in the issue and a line in the log, and the done gate and the metrics do not count it. A retraction only tightens: it takes an approve or a row away, never a `changes` verdict (which would revive an acceptance the record already answers), and it never overrides a reviewer — a reviewer who disagrees records a verdict of their own. The first retraction in a loop raises the loop's record format to 2 before its line is written, so that a reader that knows only format 1, which cannot read a retraction and would still count the approve or the row, refuses the loop instead of passing `done` where this Jarl refuses.

These are the built-in statuses, kinds and tiers. A loop opened with a [profile](#profiles) carries the statuses, kinds, tiers, fields and sections its profile names instead.

`dropped` and `deferred` always carry a reason under **Evidence**, in Notes, after whatever was already written there. A `research` issue produces a written result
and files new issues; it never edits code.

<!-- RUNES:evidence:START -->
**Evidence is what ran and what it printed.** A piece of work counts as done only with evidence a reader can check, recorded as pairs:

- `--ran "<command>"`: the exact command, as it can be run again, with where it ran (the repository or worktree, the commit or branch) when that is not obvious.
- `--saw "<what it printed>"`: the observed result, quoted or counted from the output (`tests 138, pass 138, fail 0`, the line that proves the point), never a verdict such as "works" or "all good".

One pair per check; repeat the pair for more, and `--ran` and `--saw` pair up by position. A free-text note may explain, but it never proves: the work is proven by the pairs alone, and nothing written before the work started counts. A fix to a bug carries a pair showing the check failing without the fix and passing with it. Evidence is appended, never replaced; a later run that disagrees is recorded next to the earlier one, not over it.
<!-- RUNES:evidence:END -->

In Jarl a pair is one row of `evidence <ids> --ran "<command>" --saw "<what it printed>"`, and `set done` needs at least one such row inside the gate's window.

#### Proof, Notes and the merge record

An issue keeps what proves the work apart from what explains it, and apart from the merge. **Proof** holds the worker's `--ran`/`--saw` rows. **Notes** holds free text, rulings (`decide --settles`, `answer --issue`), the reasons of a drop or a deferral (`Dropped: …`, `Deferred: …`) and the entries that retract a row. The merger's check lives in the **merge record**, beside **Merged:** and **CI:**: `merged --ran … --saw …` writes the **Merge check:** header field and names the check on the merge line, and writes no row, so the merger's check never stands in for the worker's proof. `set done` counts only Proof, and when the merge record holds a check but Proof is empty, its refusal says that the row is the worker's and the merge check does not stand in for it; `merged` and an approve say so too when the issue holds no Proof row yet.

The two parts are two sub-headings inside `## Evidence`, `### Proof` and then `### Notes`. A sub-heading is written with the first entry that belongs under it, so a new issue's Evidence is empty until then, and a section holding only Notes gets `### Proof` in front of them with its first row. Where an entry goes:

- A row goes after the last row of the section, wherever that is, so a row never goes in front of another and the ordinals `show` prints and `retract` takes never move; with no row yet it goes at the end of Proof, in front of an existing Notes. Once a row written by a writer that does not know the parts sits under Notes, later rows follow it there.
- An attachment of an issue's proof goes where a row goes: after the last row, at the end of Proof.
- A note, a ruling, a reason and a retraction entry go at the end of the section, in Notes. A retracted row stays where it is, struck through.
- Free text and reasons cannot hold a line that reads as a sub-heading: such a line is escaped.
- A section that already holds content and neither sub-heading is read as it stands and never converted: every writer appends at its end. A section holding only Notes reads as having no evidence yet.

Two limits are plain. A writer that does not know the parts appends at the end of the section, so when it records a merge check as a row on an issue in parts, that row sits under Notes and counts as a row. And a composer that closes issues through the record library, such as Horde, writes its own row with `addEvidence` after `recordMerged`: that row goes to Proof, by design, and satisfies the gate it asks for.

#### Attachments

A profile can make an issue carry files before it is done, a picture before the fix and a picture after it, for instance. The done gate declares them: `"requires-slots"` names, per kind of issue, the slots the issue must fill, and `"slots"` declares each slot's **place** (a path under the loop root, with `<id>` for the issue's number and at most one `*`, in the file name, such as `attachments/<id>/before.*`), its **extensions** (lower case, without the dot) and its **minimum size** in bytes (at least 1, the default); `"requires-slots"` names at least one kind. Jarl holds no store: the file stays where the agent put it.

`evidence <id> --file <path> --slot <name>` records the attachment as one Proof row, `attach <slot> <path> sha256:<hex> size:<bytes>`: the slot, the path relative to the loop root, the sha256 of the file's bytes and its size. It refuses a file that does not exist, an empty one, one under the slot's minimum size or over 64 MiB, a slot the profile does not declare for the issue's kind, a path outside the slot's place, an extension the slot does not allow (compared in lower case), and a path that is absolute, climbs out with `..`, holds whitespace, is a directory, a pipe, a socket or a device (anything that is not a regular file is refused before it is opened, so a pipe never blocks Jarl), or is or sits under a symlink. The path recorded is the file's name as the disk spells it. A row of that shape is written only by this command: `--ran` refuses a command that reads as one once the log's own trimming and first-line cut are applied, in any case. A slot is recorded again by a new row, and the newest row of a slot is the one that counts; retracting it leaves the slot empty and never brings a replaced row back. An attachment row is a Proof row, so it also counts as a `--ran`/`--saw` row for the done gate.

`set <id> done` reads every slot the issue's kind requires, on the disk, inside [the gate's window](#the-window-of-the-done-gate), and refuses with one line per slot that is not filled, naming the problem and the `evidence` command that fills it: no row recorded (a row from before the last start or reopen is outside the window and does not count), the file gone, a disallowed extension or a size under the minimum, or bytes whose sha256 differs from the recorded one. An issue of a kind that requires no slots is not affected, and a loop whose profile has no `"requires-slots"` behaves as if slots did not exist. `status`, `resume` and `report` flag a closed issue whose slot is broken on the disk, like any closed gate that does not hold; they check existence and size only and never read the bytes, so a same-size rewrite is caught by `done` and `verify`, which read them. `show` ends with the issue's slots, each with its recorded path, size, a short hash and its state, so a reviewer agent can open the files: `filled`, `gone`, `changed` (the bytes differ from the recorded ones), `refused` (with its reason: a disallowed extension, a size under the minimum, a path outside the place), `outside` (only a row from before the gate's window exists) or `not recorded` (with its place and extensions); `show --json` carries the same states under `attachments`. `verify` reports a slot row whose file is gone or whose bytes changed. Jarl does not judge what a picture shows: the gate guarantees that the proof exists, has the right shape and is the file that was recorded, and the reviewer reads it.

A bug hunt files many issues, and each becomes its own pull request with a description and pictures. With the profile `{ "jarl-profile": 1, "statuses": …, "done-gate": { "requires-slots": { "bug": ["before", "after"] }, "slots": { "before": { "place": "attachments/<id>/before.*", "extensions": ["png"], "min-size": 1000 }, "after": { "place": "attachments/<id>/after.*", "extensions": ["png"], "min-size": 1000 } } } }`, each worker takes the before picture first, records it with `evidence <id> --file attachments/<id>/before.png --slot before`, fixes the bug, takes the after picture and records it the same way, so the issue holds both pictures and its `--ran`/`--saw` rows beside each other, and the pull request description is written from the issue and its two files. The reviewer opens the files `show` lists. The attachments directory is the loop's to keep or to commit; Jarl records paths and hashes only.

#### The window of the done gate

One window decides which rows and which approves count: a row counts when it is logged after the last start, reopen or filing, and an approve counts when it is logged after the last start, reopen, filing or red round. A start is a move into in progress from another status; a reopen is any move out of a status that closes the record, or a move back to open from in progress; the filing counts for an issue never in progress. A start and a reopen reset the rows and the approves together, so an issue that is closed, reopened and closed again needs a new row as well as a new approve. A red round resets the approves alone: it spends the approve, and the rows the worker logged stay true. A retraction takes an approve or a row out of the window, never into it.

**The gate is checked at the move, and the views flag a gate that does not hold.** The record can change after an issue is closed: its approve or its proof row retracted, a restart that spent the approve, a merge recorded after it went done or on a dropped or deferred issue, a code issue done with no merge. `status`, `report` and `resume` list each such closed issue on one line, `closed, gate does not hold: <id> · <reason> — repair: <command>` (`closedGate`, an array of `{id, reason, repair}`, in their `--json`), computed from the log every time and never stored. The repair is a fresh `review`, a new `--ran`/`--saw` row, or `set <id> open` to reopen it. Nothing is refused for it, and `report` counts a retracted approve as retracted, not as unrecorded.

**File the body with the issue.** `new` takes `--where`, `--what`, `--why` and `--acceptance` (one checkable line per flag), so an issue is written whole in the call that files it; `body <id>` fills or replaces them later. None of it is required, and an issue filed without it reads exactly as before, but an issue with no acceptance line gives the worker nothing to prove and the reviewer nothing to check. So the tool says so without refusing anything: `next` marks such an issue `(no acceptance yet)`, `status` lists the in-progress ones that have none, and `set done` notes it on stderr, together with an issue that has fewer `--ran`/`--saw` rows than acceptance lines (none included). Fill it (`body <id> --acceptance "…"`) before `set <id> in-progress`.

**An issue that waits on another says so.** `after <id> <ids>` (or `new --after`) records **After:**. `next` never offers it while any of those issues is still open, in progress or deferred, and `status` counts it as waiting, not as open or in flight, so "in flight" keeps meaning that someone is working on it. Do not park a blocked issue in `in-progress`. It is ordering and bookkeeping, not a schedule: no computed plan, no critical path. A ruling that settles issues names them, `decide <slug> "…" --settles <ids>`, and the ruling is written into each one's evidence. Closing the issue is still `set`, and `done` does not count a `Ruling …`, `Dropped:` or `Deferred:` line as evidence of the work.

### When a header disagrees with the log

What the log says of an issue is folded in file order, the way the commands write it. The status is the target of the last move (the filing counts as a move into the profile's first status). A move into a status that holds the claim sets Since to the line's stamp, replaces Branch when the line names one, replaces Worker when it names one (and then Model with the line's own, or none), and replaces Model alone when only a model is named; a move into any other status removes Worker, Model and Since and keeps Branch. A merge line sets Merged and Merge check (the check and what it printed, none when it names none) and takes that line's CI state, none when it names none, and a CI line replaces the CI state alone. `set` and `merged` write the line first and the file second, with one stamp for Since and its line, so a write that stops between the two leaves the log ahead of the file and never the file ahead of the log.

**Where the file says something else, the log wins and the view says so.** `status`, `resume` and `show` print one line for each of Status, Branch, Worker, Model, Since, Merged, Merge check and CI whose header differs from the log, and no count, mark, offer, queue row, report row or gate decision follows the file:

`record: 7 Status reads done in the file and in-progress in the log, which is the record — to follow the log, write **Status:** in-progress back into the header; to make the file's value the record, jarl.mjs set 7 done (a move into done, through its checks)`

`set <ids> <status-in-the-log> --header` rewrites the header fields the log renders from the log, writes no log line and is never a move; it settles every line of an issue at once (a write that stopped between the log and the file is repaired by it, and the move stays recorded). Writing a header back to the log's value by hand settles its line too. The command the line names for the other direction is a real change of the record and writes a line of its own: `set` writes a move line (and, in a lease, stamps Since again), `merged` writes a merge line, `merged <id> --ci <state>` a CI line. Since has no command of its own, so a header Since that differs is only written back. A line that is printed for a field the log has no value for says the header should lose it. An issue the log holds no filing and no move of (a file made by hand, or one the log knows only by merge or CI lines) reads its header as it stands and is printed as not in the log; `set <id> <status>` puts it there. A hand edit of a profile's status list changes which past lines read as moves: a line of the shape the tool writes for a move (`<id> → <status>`, the status a lower-case word) into a status the list does not name reads as a note, and `status` prints it once and follows the list as it stands. Any other line with an arrow is a note and is never printed. A move line is read by position: after the status come the free reason, never searched for fields, and the lease fields in the order `set` writes them (branch, model, worker, worktree); a reason that opens with a lease field's name is closed by a `(reason)` segment, and the reason of a move that opens with a lease word is read as the tool wrote it; lines written before the marker follow the comma rule, where a `worker` or `model` text with a comma is a sentence and one without is a name, so an old reason that is only `branch <word>` or `worker <name>` reads as the lease field. `set` refuses a worker or model with a comma, a branch git would not accept (a space among the characters it refuses) and any lease value on more than one line, so every value it writes reads back identical from the log and from the header. `set --header` restores no `Deferred:` or `Dropped:` reason under Evidence; the reason stays in the log line.

**The file is the authority for everything the log does not hold as state**: the title, Kind, Priority, Tier, Tags, Files, Repo, After, Source, Where, Resources, Found by, a profile's own fields, Worktree and the text of every section. The lines `after …`, `source …`, `field …` (Resources and a profile's fields) and `body …` that their commands write are an audit of the change, and nothing reads them as state.

**A Branch the log has recorded cannot be cleared.** Branch stays after the issue leaves in-progress, as the record of where the work was done, and it marks the issue as carrying code. A Branch recorded by mistake is replaced by the right one with `set <ids> in-progress --branch <b>`; no command removes it, and a hand edit of the header that removes it is printed as a disagreement and changes nothing.

**In a committed loop**, git merges `log.md` by union, which places the lines of two branches in the order of the merge direction. When both branches moved one issue, the clone that merged one way and the clone that merged the other way hold the same lines in two orders, and each folds its own log: the later move in its file decides, which is the order the done gate replays. The issue file has no merge driver and conflicts on the changed header lines; a resolution by hand that differs from the log the clone holds is printed as a disagreement, and writing the header back settles it. Two clones that hold the same log text read the same.

**The log's own door is shut to forged state.** `log` writes a note, and a line that starts with an id and an arrow, or reads as a filing, a move, a round, a verdict, a retraction, an evidence row, a merge, a CI state or a body change is refused, with the command that writes it. A composer's `record.appendLog` is refused the same way, and `record.writeAtomic` writes any file but the journal whole. A well-formed line written into `log.md` by hand cannot be told from a real one; only the commands keep the lines true.

### Packages and leases

The unit of work is often a **package**: two to ten small issues that touch neighbouring files, handed to one worker on one branch. That is a first-class shape, not a workaround. `set 163-168 in-progress "<who>" --branch jarl/163-packages --worker <name>` writes one lease on every issue in the call: **Branch:**, **Worker:** and **Since:** (the moment, UTC). `set <ids> in-progress` without the flags still writes **Since:**. A lease records no worktree: git allows a branch in at most one worktree of a repository, so the worktree is found through the branch. `--worktree <path>` is a check on the command line and in the tools and stores nothing: a path that exists must be a worktree of a repository of the issue with the lease's branch checked out, or the call is refused. Leaving in-progress (done, dropped, deferred, open) removes Worker, Since (and a **Worktree:** field a lease holds) and keeps Branch, the record of where the work was done.

- `scope --branch jarl/163-packages` with no id bounds the diff by the union of the **Files** of every issue that records that branch (in progress or done), so the package passes in one call. `scope <id> --branch …` still bounds it by that one issue.
- `branches` prints each branch with the issues on it. A lease's worktree is looked up through git (`git worktree list --porcelain` in each repository the issue names), by the lease's branch, and by the stored **Worktree:** path for an old lease that has one; `status`, `resume` and `branches` all read it the same way. It is in one of five states: here (its directory is on this machine); elsewhere (git lists it locked, with a reason, and its directory is not visible from here, as with a worktree made in a devcontainer); not visible from here (git lists it, but neither it nor its parent directory is on this machine); gone (its directory is missing while the parent directory is here, removed under a live lease); or no worktree holds the branch. Only gone is a problem: a worktree in a container is never reported gone. `branches` shows the state next to the path. It marks a lease **STALE** when the worktree it names is gone, the branch it names is gone (listed as `GONE`), or the lease is at least `--stale-hours` old (default 6) while the branch has no commit that recent. It marks a branch **DONE → delete** when every issue on it is done or dropped (one at least done), its tip is in the base — an ancestor of the base, or else an ancestor of every **Merged:** sha its done issues record (a merge made on another branch) — and its worktree holds nothing uncommitted. A branch whose tip is in no recorded merge (commits after the merge, or a squash merge) reads `DONE (merged by record, branch not in base) — verify`; one whose worktree has uncommitted files reads `DONE (worktree dirty)`, and one whose worktree is listed but cannot be inspected from here (elsewhere, or not visible) reads `DONE (worktree state unknown)` and is never marked for deletion, because its uncommitted changes cannot be counted. A branch matched to another issue only by its `jarl/7-` number, with no **Branch:** behind it, is judged by ancestry to the base alone. `status` lists the same stale leases. A branch marked `DONE → delete` is what `merged` removes by itself when it records the merge; one that is still listed is one `merged` kept, for the reason it named.
- A stale lease is shown for the jarl to act on — ask the worker, re-raise, or set the issues back to `open`. Nothing expires and nothing is taken over automatically: that is Horde's territory.

**A merge is a field.** After the check is green on the merged result, the merger runs one call, `merged <ids> --sha <merge sha> --ran "<the check command>" --saw "<its summary line>"` (`--repo <path>` when it landed in another repository than the issue's): it records **Merged:**, **Merge check:** and one log line per issue that names the check and what it printed, and no evidence row (the worker's row is what `done` asks for). **CI:** is recorded only when `--ci pending|green|red|none` is given (`pending` for a pushed commit whose CI will report, `none` for a repository with no CI); `merged <ids> --ci green|red` moves it when CI reports. `status` counts `merged, CI pending N` and `CI red N`. A merge that landed while its check was red for a cause outside the branch is recorded with `--red <id>` instead of `--ran`/`--saw`, `<id>` being the issue that tracks the cause; it counts apart from the merges that carry a passing check. `set done` on an issue whose CI is not green says so on stderr, unless the merge carries its check, and closes it anyway — it records, it never gates the landing and never waits for a check.

**The cleanup a merge makes redundant.** Jarl changes git in one place only, and only after a recorded merge: `merged --sha`, on the command line and in the tools, removes each merged issue's worktree with `git worktree remove` and its local branch with `git branch -d`, and says what it removed or why it kept it. It never forces, removes nothing by any other means, pushes nothing and touches no remote branch. It keeps the branch and the worktree, naming the condition, unless all hold: the branch is not the base, a release branch or a trunk name; its tip is an ancestor of the base or of the recorded merge; no other issue that is still open or in progress holds a lease on it (a package); its worktree, when it has one, is on this machine, is the one the lease names, is not the main checkout nor the one the loop or the command lives in, and holds nothing uncommitted, nothing untracked and no ignored file; and git accepts both commands. A worktree is removed only when git lists it on exactly the issue's branch: the path the lease names is never removed when it is detached, on another branch or not listed. Nothing untracked or ignored is ever removed: a worktree holding ignored files (git would delete them with it) is kept, the reason names the first of them, and the exact git commands that remove it are printed for a person to run after looking. `--keep` skips the cleanup. A library caller of the record code (`record.mjs`) gets none of it.

### The merge queue

`queue` is what waits for the merger, computed from the record every time and never stored: a branch is in it when an open or in-progress issue on it holds a live approve (one no round, restart or reopen has spent) by a fresh reviewer — the done gate's reading for an issue that carries code, so an approve by the coordinator alone keeps the branch out and the branch has commits its base does not. The branch is the issue's **Branch:**, or for an issue from before that field the one `jarl/7-*` branch carrying its number. Rows come in the order the branches were approved and, per repository, are cut into batches the way the merger's brief batches them: a branch joins the current batch while its declared files share none with the batch, and starts the next one otherwise (a branch with no files declared rides alone). A package whose other issues still wait for their review is listed with them (`waiting for review: 164`). Once the branch is merged into its base it drops out by itself. With no `--repo` it reads the loop's own repository and every repository an issue names; `--base` replaces the checkout's current branch as the base.

It is a view, not a gate: it runs no check, holds no lock, refuses no merge and orders nothing on its own. The merger reads it instead of waiting for the jarl to name branches, and still verifies every branch as its brief says.

### Changelog fragments

Parallel branches that each add a line to `CHANGELOG.md` under `[Unreleased]` conflict at nearly every merge, in the one place every issue touches. So the entry lives on the issue until the merge: the worker records it with `body <id> --changelog "Added: …"` (repeat the flag for more lines; the jarl can file it with `new --changelog`), and leaves `CHANGELOG.md` alone on its branch — unless the repository's own rules (its CLAUDE.md, AGENTS.md or a hook) require the entry to come with the change, in which case it edits the file as those rules say and records the fragment too. An entry opens with its Keep a Changelog section — `Added:`, `Changed:`, `Deprecated:`, `Removed:`, `Fixed:` or `Security:` — and one without goes under Fixed for a `bug` and Changed for anything else. An issue with no user-visible change has no Changelog section.

`changelog <ids>` prints the entries of those issues grouped by section, in Keep a Changelog order, ready to paste under `[Unreleased]`; when the issues span several repositories it prints one block per repository (an issue naming two appears in both), and `--repo <path>` keeps one. An issue without an entry is named on stderr. The merger writes `CHANGELOG.md` once, after the merge (or the batch) is green, in its own commit on the feature branch: the entries are material, edited into the register the repository asks for and merged into an existing `[Unreleased]` entry when they cover the same feature, as in [Closing the branch](#closing-the-branch). Nothing changes in the repository's layout: the fragment is a section of the issue, and the repository keeps its one changelog. A loop whose workers already edit `CHANGELOG.md` keeps working as before; `check` still counts a changelog edit as in scope.

**A committed loop commits itself.** In the committed and permanent modes, `status` and `close` name how many loop files git has not committed and `resume` lists them (`git status` of `.jarl/` in the loop's repository). A loop whose code lives in another repository has no merge in its own repository to ride on, so without this the record in git contradicts itself. The count is silent in the default mode and outside a git repository.

### From research to issues

A research round leaves a `findings.json` beside its report. `import <findings.json>` files one issue per finding, and each carries **Source:** `<report dir>#<finding id>`. The report directory is dated, so that pair names one finding for good. The directory is the one holding the file, written from the root of its repository (`core/research/2026-09-25-jarl`), or given with `--source <dir>`. Import is idempotent. A finding whose Source an issue already carries is skipped, so a re-run files nothing twice. A finding named by an issue that has no **Source:** is not filed again either: `import` reports it, and `--adopt` writes the Source onto that issue. "Named" is read narrowly: the issue's title and its What, Why and Acceptance count, a header field never does, and Evidence only under the strictest rule: an id that reads as unique on its own, on an Evidence line that also names the report directory (a package issue's `Source: <report dir>/report.md … Ids: a-b-01, a-b-02`). An id that reads as unique on its own (a dash and at least eight characters, like `jarl-2-B2`) is enough there by itself. A short id (`F1`, `C1`, `2`), or any id from the angles shape, also needs its report named in the same issue: the report directory's name, or the full `<angle>/<id>`. When two issues name it, import reports it as ambiguous and leaves both alone. `--dry-run` prints what it would do, and `--only <ids>` takes part of the file. `--kind`, `--prio`, `--tier`, `--tags`, `--repo` and `--found-by` replace the mapped values for every issue filed.

Three shapes are read: a flat array of findings; an array of angles, each with its findings under `surviving`; and `{ "results": [{ "area", "kept": [...] }] }`. In the angles shape an id is unique only inside its angle, so the key there is always `<angle>/<id>`, with the angle name slugified (`First Hour` → `first-hour`). Every finding needs an id, and a repeated id refuses the whole file. The mapping:

| Issue | From the finding |
|---|---|
| title | `title`, else the first sentence of `claim`, else the id |
| **Kind:** | `kind` when it is one of the loop's kinds; `defect` and `inconsistency` → bug, `risk` and `opportunity` → gap, anything else → bug |
| **Priority:** | `priority`, else `severity`: `blocker`, `critical`, `high` → 1; `medium`, `major`, `important` → 2; `low`, `minor` → 3; 1, 2 or 3 as they are; anything else → 2 |
| **Where:** | `where`, else `surfaces` |
| What | `Claim:` `claim`, `Truth:` `truth`, then `evidence` |
| Why | `impact` or `adopter_impact`, and the finding's `effort` estimate |
| Acceptance | `proposal`, `suggested_fix` or `fix`, as one line starting `Proposed by the finding`. That line is not counted as an acceptance line, so `next` keeps marking the issue until it is rewritten into something checkable. |
| Evidence | nothing. `done` still needs evidence of the work. |

`sources [<findings.json>...]` is the coverage view. Per report it shows the findings, how many were filed, the unfiled ones (when the file is given) and the status of the issues filed from them, with one row per finding. A finding deliberately left unfiled is recorded as a ruling that names it, never as silence. An issue filed by hand from a finding takes `new --source` or `source <id> <dir>#<id>`.

### Templates

An issue that is filed again and again in the same shape — a release phase, a triage of a bug report, a dependency bump — is written once as a template: `.jarl/templates/<name>.md`, an issue file without a number. Its header fields **Kind:**, **Priority:**, **Tier:**, **Tags:** and **Files:** are defaults, and its What, Why, Acceptance and Changelog sections are the body. `new "<title>" --template <name>` files an issue from it; any flag given on the call replaces the template's value, field by field and section by section. The first line is a title and is ignored, unless it is already a field (`**Kind:** process`), which is read as one; a name is letters, digits and `. _ -`. Templates belong to the place, not to one loop: `archive` leaves them in `.jarl/`. In the default mode they are out of git like the rest of the loop, and `close` removes them with it.

A release checklist is issues filed from a template, not a mode. The checklist lives where the release procedure lives (for a family of repositories, in the skill that runs its releases), and the loop files one issue per phase, chained with `--after`, so `next` sequences them and `status` counts them like any other work:

```
# .jarl/templates/release-phase.md
# release phase

**Kind:** process
**Priority:** 1
**Tags:** release

## What
One phase of the release checklist, done in the order the After chain gives.

## Why
A phase skipped here is found by someone who uses it after the tag.

## Acceptance
- every step of the phase is done, with a --ran/--saw row per step
- the phase's own check is green
```

```
jarl_new { title: "Release X · A: freeze and dry run", template: "release-phase", acceptance: ["dry run prints no finding", "every repository's release branch is cut"] }
jarl_new { title: "Release X · B: versions and changelogs", template: "release-phase", after: "301" }
jarl_new { title: "Release X · C: tags and CI", template: "release-phase", after: "302" }
```

Each acceptance line is one step, and `set done` notes a phase closed with fewer `--ran`/`--saw` rows than steps. Nothing here tags, releases or refuses anything; see [What Jarl will not grow](#what-jarl-will-not-grow).

### Profiles

A loop may be opened with a profile: `init "<goal>" --profile <file>` checks the file and stores it as `.jarl/profile.json`; `profile` prints the loop's profile, and `profile <file>` checks a file without touching the loop. A profile is data. It says which statuses an issue moves through and what each one means to the tool, which header fields and sections its issues carry, and the heading their acceptance lives under. A loop with no profile runs on the built-in one, the five statuses above, and behaves exactly as it always did. A composer that runs on Jarl (Horde is the one this was made for) brings its own profile; a loop you open by hand rarely needs one.

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

A status is at most one of `dispatchable`, `lease` and `terminal`, and `closes-record` is terminal too. A profile needs at least one dispatchable, one lease, one terminal and one settles-dependents status (without the last, every issue waiting on another with After would wait for good). A status may not take a name the views already print or key for something else: `waiting`, `ready`, `in-flight`, `questions`, `ratify`, `to-ratify`, `goal`, `opened`, `archived`, `stale`, `handoff`, `reviews`, `uncommitted`, `by` and `statuses` are reserved, and the refusal lists them. A composer whose own queue has a waiting state names that status otherwise (`held`, `parked`). A new issue starts in `initial`, else in the first status listed, which may not be terminal or hold the claim; a status with no flags is one an issue waits in (a proposal not yet accepted, a block), counted by name and never offered. `branches` marks a branch DONE → delete when every issue on it is closed (closes-record) or given up (terminal and settles-dependents without closing the record, built-in: dropped), at least one closed; an issue in a terminal status that settles nothing (deferred) keeps its branch. `queue` takes only issues in play (dispatchable or lease), never one waiting in a status with neither. A few views keep reading two built-in words as they always did: the leases `branches` lists, `tips` and the CI counts of `status` pass over a status named `dropped`, `close` names the issues left in a status named `deferred`, and `report --json` keeps its `dropped` and `deferred` counts by those names.

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
| `"done-gate": { "approve": "fresh" \| "none", "requires-merged": bool }` | `requires-merged: true` adds to the done gate a recorded merge (`merged --sha`) whose commit is in the base: the branch checked out in the repository the merge names (else the issue's Repo, else the loop's own), or the branch a composer names as `base` on its `record.mjs` `setStatus` call when it landed the merge into a branch nobody has checked out (a team branch); the command line has no `--base`. `approve: "none"`, allowed only with `requires-merged: true`, drops the approve, since the gate that landed the merge stands behind the issue; the evidence row is asked for either way, `merged` then owes no fresh review, and `status` and `report` say the issues closed on a merge. The default is `{ "approve": "fresh", "requires-merged": false }`: the gate above. The same object may also hold `"requires-slots": { "<kind>": ["<slot>", ...] }` and `"slots": { "<slot>": { "place": "attachments/<id>/before.*", "extensions": ["png"], "min-size": 1000 } }`: the files an issue of that kind must carry before it is done (see [Attachments](#attachments)); a kind must be one the profile allows, every required slot needs its entry in `"slots"`, and a slot no kind requires is refused |
| `"lifecycle": { "close": "any" \| "record", "archive": "any" \| "record", "command": "<command>" }` | who may end the loop. `"record"` makes `close` (with `--batch` and `--force` too) or `archive`, and the `jarl_close` or `jarl_archive` tool, refuse before anything is written, removed or moved, naming `command`, the composer's own way to close or archive the loop; the composer keeps its own lifecycle, since a loop run on a record it owns (Horde's mission) would otherwise be deleted by `close` with no way back, or moved out from under it by `archive`. A library caller of `jarl-lib.mjs` passes (`caller` other than `cli`). The default is `"any"` for both, the behaviour above |
| `"format": N` | the record format the profile was written for. A format this Jarl does not read is refused before anything else in the file, on every command, so a vendored copy and an installed Jarl that drifted apart stop loudly. This Jarl reads formats 1 and 2. A loop without the key is format 1; the first write of anything a reader that knows only format 1 would read wrongly in silence (a repository name in `Repo:`, an issue or ask numbered 1000 or more or written plain below 100, a retraction line) first writes `.jarl/profile.json` holding only `"jarl-profile": 1` and `"format": 2` (a loop that has a profile gets the key added), and such a reader then refuses the loop on every command instead of misreading it. A profile holding only those two keys changes nothing else: the loop keeps the built-in profile |

`profile` prints all five. A key the schema does not name is refused, so a profile written for a later Jarl fails loudly here instead of being half-read, and a profile file broken by hand refuses every command rather than falling back to the built-in one. `archive` takes the profile away with the loop. With a profile, `status --json` (and the `status` inside `resume --json`) keeps the count per status under its own key, `statuses: { <status>: n }`, instead of the five top-level counts a loop without a profile has, so no status name can overwrite a key of the view; `report --json` adds `statuses` (the count per status), `resume --json` rows of work in flight and ready carry `fields`, and the text of `status` and `resume` names the profile.

### Views for dashboards

Jarl ships no UI. A dashboard, a release board or a weekly summary is rendered by the host (a page, an artifact, a script) from the JSON the tool already prints, so every number on it comes from the record. Every command takes `--json` (the `json` field of its tool). The shapes below are stable: keys are added over time and never renamed or removed without a note in the changelog.

- **`status --json`**: `open`, `in-progress`, `done`, `dropped`, `deferred` (counts per status); `ready` (open, not waiting; null under a profile's `external-scheduler`, which adds `scheduler`), `inFlight` (in progress, not waiting), `waiting` and `waitingIds` (After not settled); `noAcceptance` (in-progress ids with no acceptance line); `questions` (open asks that are not ratify), `ratify` and `toRatify` (`[{ id, state, kind, target, issue, question }]`); `goal`, `opened`, `lastActivity` (log stamps, `YYYY-MM-DD HH:MM` UTC), `archived` (how many archived loops); `stale` (`[{ id, problems: [text] }]`); `ciPending`, `ciRed` (ids); `handoff` (the age of the `.jarl/handoff.md` file: `{ at, ageMs, staleByMs, stale }`, or null when there is none); `reviews` (`{ fresh, coordinator, self, unrecorded }`, plus `retracted` when a closed issue's approve was retracted and none stands); `closedGate` (`[{ id, reason, repair }]`, the closed issues whose done gate does not hold, empty when all hold; it follows `inFlightRows` and precedes `uncommitted` in the output); `uncommitted` (count, or null outside the committed modes). With `--by repo|tag|kind|prio`, also `by: { key, groups: { <name>: { open, in-progress, done, dropped, deferred } } }` — an issue naming two repositories, or carrying two tags, counts in each group; an untagged one under `(none)`. `inFlightRows` (`[{ id, title, branch, worker, since, mark, next }]`, one per issue in flight; `mark` is `no-rows`, `rows-no-verdict`, `changes-requested`, `approved`, `approved-not-fresh`, `merged-ci` or `merged`, and `next` says what comes next in words), placed before `uncommitted`; with `--tag`, `tag` comes just before the last key. Last, `check` (`{ declared, checks, landsOn, merges, byRepo }`: the `Check` lines of `goal.md` and what the loop's merges say of its checks, see [Loop metrics](#loop-metrics)). `set <id> ready` (or `review`) is refused naming this view, since those are views and not statuses; a loop that wants an explicit review status declares one in its profile.
- **`report --json`**: `done`, `dropped`, `deferred`, `left`, `found` (counts); `reviews` (as above); `byRepo` (`{ <repo>: [done ids] }`); `text` (the report as printed); `issues`, one row per issue: `{ id, title, status, kind, priority, tier, tags, repos, branch, after, sources, merged, ci, review }`, where `repos` are the repository names it counts under, `merged` the recorded sha or null, `ci` its state or null, and `review` the last approve as `{ by, kind, at }` (`kind` is the reviewer's standing; by and kind are null for an approve that names no reviewer) or null; `check` (as in `status`); `closedGate` (as in `status`); `metrics` (see [Loop metrics](#loop-metrics)).
- **`queue --json`**: `repos: [{ repo, path, base, rows: [{ branch, issues, waitingReview, ready, ahead, approvedAt, by, files, batch }] }]`, rows in merge order. Under a profile's `external-scheduler`: `{ scheduler, note, repos: [] }`.
- **`tips --json`**: `gh` (whether CI could be asked), `ci` (true: `tips` always asks; `resume` asks only with `--ci`) and `repos: [{ repo, path, rows: [{ role, branch, sha, upstream, against, ahead, behind, pushed, issues?, ci? }], merged? }]`; a branch that is gone is `{ role, branch, sha: null, missing: true }`.
- **`resume --json`**: `goal`, `opened`, `lastActivity`, `archived`; `status` (the whole `status --json` object); `rulings` (`[{ date, slug, by, line }]`, in force only, `line` the ruling's first line); `inFlight` (`[{ id, title, branch, worker, since, stale, mark }]`, `mark` as in `status --json`; in progress and not waiting — as many as `status.inFlight`); `waiting` (`[{ id, title, status, after }]`, open or in-progress issues whose After is not settled — as many as `status.waiting`; an in-progress row also carries `branch`, `worker`, `since`, `stale`); `held` (`[{ id, title, priority, files, heldBy }]`, open issues a taken file holds back, and, with `questions` instead of a holder, those an open question names; `held` and `readyTotal` together are `status.ready`); `questions` and `ratify` (open asks, as in `status`); `next` (`[{ id, title, priority, noAcceptance? }]`, the first `--ready n`) and `readyTotal` (under a profile's `external-scheduler`: `next` and `held` empty, `readyTotal` null, and `scheduler` added); `queue` (the `queue --json` object); `merged` (`[{ id, title, sha, repo, ci }]`, CI pending or red); `tips` (the `tips --json` object); `uncommitted` (paths, or null outside the committed modes); `log` (the last `--log n` lines, without the leading `- `; null with `--log 0`); `legacyHandoff` (`{ path, at, ageMs }` of a kept `.jarl/handoff.md`, or null). `handoff read --json` adds `history` (that file's text, or null).
- **`list --json`**, **`show <id> --json`**: the parsed issue (`list` an array of them) — `file`, `id`, `title`, `status`, `kind`, `priority`, `tier`, `tags`, `files`, `after`, `sources`, `fields` (every header field by lower-case name) and `sections` (every section's text by lower-case name); `show --json` also carries `evidenceRows`, each row with its ordinal `n` (the number `retract` takes), `ran`, `saw` and whether it is `retracted`, and is complete whatever the text view cuts.

### Loop metrics

`report` ends with the loop's metrics, and `report --json` carries them under `metrics`. They are read from the record alone — the journal and the issue files, never git or a network — so they are as good as the record: a number the record cannot back says **no data**, with the reason in `noData` and null values, never a zero. An approve that names no reviewer has no standing, a loop with no merge has no CI after one. Every metric carries `n`, the issues it was read from; a closed issue is one in a status that closes the record (`done`).

- `check`: `{ declared, checks, landsOn, merges, byRepo }`. Where the repository has a check, the check decides what lands; a fresh reviewer can only stop a change, and its word is recorded as testimony. `goal.md` names the commands: a `Check: <command>` line for the whole loop, a `Check (<repo>): <command>` line for one repository, `<repo>` being the name its Files prefix writes (`declared` and `checks` list them). A repository's declared check is its own `Check (<repo>)` lines, else the loop's `Check:` lines. A merge carries the declared check when the `--ran` text of its merge line equals a declared command after trimming whitespace; a row with any other text, a merge with no row and a repository that declares nothing carry none. `landsOn` is `check` when every merge carries the declared check, `testimony` when none does, `partial` between, and `status` and `report` print the testimony mark for `testimony` and, per repository, `k of n merges carry the declared check`. `merges` is `{ merges, withCheck, noCheck, red }` over the merged issues, counted by each issue's last merge line: `withCheck` carries the declared check, `noCheck` does not (no row, or another command), `red` is `[{ id, cause }]` for merges landed with `--red`. `byRepo` is `{ <repo>: { repo, merges, withCheck, noCheck, red, declared, landsOn, k, n } }`, `k` the merges carrying the declared check and `n` all its merges, an issue naming two repositories counting in each; `status --by repo` and `report` print it.
- `cycleTime`: the first move into progress to the last close, per closed issue: `{ n, of, medianHours, p90Hours, maxHours }`. `leadTime`: the same from the filing.
- `rounds`: `round` lines and `changes` verdicts on the closed issues: `{ n, rounds, issuesWithRounds, changes, issuesWithChanges }`.
- `reopenings`: moves out of a closing status (done back to open or in progress), on every issue the journal tracks: `{ n, times, issues }`. Deferred or dropped work brought back is not a reopening.
- `freshReviews`: the standing of the live approve that cleared each closed issue — `{ n, recorded, fresh, coordinator, self, unrecorded, share }`, `share` fresh among those with a recorded standing; `code`, the same for the closed issues that carry code; `reviewers`, how many each fresh reviewer cleared.
- `redCiAfterMerge`: the merged issues whose CI was recorded red at any point after the merge, among those whose CI settled green or red: `{ n, settled, red, issues, share, pending, none }`.
- `followUps`: an issue filed within 7 days after a closed issue first closed, whose **Found by** names that issue's number (a reviewer's name such as `reviewer-450` counts; a number inside a sha does not): `{ windowDays, n, windowOpen, withFollowUps, windowClosed, windowClosedWithFollowUps, share, followUps: [{ id, followUps }] }`. A closed research issue is left out: the issues filed from it are its product. `windowOpen` counts the closes whose 7 days have not passed yet; `share` is taken over the `windowClosed` ones only, since a close whose window is still open has not yet shown it has no follow-up (null while none has passed).

## The loop

Every turn, in this order:

0. **Continue or archive — once per session.** When a session first meets a `.jarl/` that already holds
   a loop, run `status` (goal, when it was opened, last activity) and ask the owner once whether this
   session continues that loop or archives it (`archive "<slug>"`, then `init "<goal>"`). Ask only at
   that first contact, never again on each `new` or `evidence` in the same work.
1. **Boot.** `resume` — one command, the whole state, read live (see [Resuming a loop](#resuming-a-loop)). Then `branches` for each repository the in-flight issues name: a worker branch with commits beyond the feature branch is a report, whether or not the worker said so. Open questions come first: the owner may have answered one since. Read `goal.md` whole, an issue with `show`, or log lines further back only when the section in `resume` is not enough.
2. **File.** Anything anybody saw becomes an issue before anything else happens. Nobody fixes on the
   side. A worker reports what it found; the jarl files it, so numbers never collide.
3. **Pick.** `next` lists what can run now: open issues whose files do not overlap with anything
   in progress, whose **After:** issues are settled and that no open question holds (`next --all` shows the rest and why). Priority first, then whatever unblocks the most.
   An issue marked `(no acceptance yet)` gets its acceptance line first (`body <id> --acceptance`).
   `set <ids> in-progress "<who>" --branch jarl/7-slug --worker <name>` before
   raising the worker — one issue, or a package of small neighbouring ones on one branch (see
   [Packages and leases](#packages-and-leases)).
4. **Raise a worker.** One worker per issue or per package, in its own worktree, on branch `jarl/7-slug` (7 the package's first issue) cut from
   the feature branch — every agent that may write anything, a research issue's worker included,
   gets its own worktree (see [Worker branches](#worker-branches)); only the jarl and the merger work in the main checkout, and read-only readers and
   verifiers need none — on the tier the issue names — its model set explicitly on every spawn, never inherited, and recorded with the lease (`--model`) —
   and tell the worker it spawns nothing itself. The brief is below; the output of `show <id>` (the issue's current window, not the whole file) is pasted into it,
   and after three red rounds the takeover block from `round` goes in too, for a fresh worker.
5. **Review.** A worker's report is a hypothesis. A **fresh one-shot reviewer** — never the worker, never the merger — reads the issue and the diff and answers with the review discipline's three words: Critical, Important, Minor. Critical or Important is `review <id> changes --by <reviewer> "…"` and a round back to the worker; Minor alone is `review <id> approve --by <reviewer> "…"` with the minor points in the findings, never a bounce. `--by` names who reviewed; the tool refuses an approve by the issue's worker. **A code issue — one that records a Branch or a Merged field — needs a fresh reviewer**: an agent that neither wrote the code nor runs the loop. The jarl's or the reeve's own approve is recorded but does not clear it for `done` or the merge queue; only issues with no code (a ruling, a document) close on it. So the jarl raises a reviewer for every branch, however small. The reviewer checks that the new test was red before the change and green after, that the acceptance line is met literally, and that nothing outside the issue moved. The reviewer's brief is below.
6. **Merge.** The merger (below) does it: into the feature branch with a merge commit that names
   the issue, then `merged <id> --sha <merge sha> --ran "<check>" --saw "<what it printed>"`, `set <id> done` (which needs the worker's Proof row), worktree and branch removed. Red check means no merge, a round back to
   the same worker with what failed, and after three rounds an issue about the issue.
7. **Repeat** until nothing is open, then close the branch (below). Nothing is written for the next
   session: it boots from `resume`, so keep intent where `resume` reads it (below).

Testing, stress and research sessions are the same loop with a different mix: some workers produce
issues (they test, they probe, they read) while others take issues down. The stream never waits for
the other side.

### Resuming a loop

There is no handoff file to write. Everything a new session needs is already in the loop's own files — the goal, the rulings, the issues with their leases and **After:**, the asks, the log — and in the repositories its issues name, so `resume` reads it all at the moment it is asked: nothing it prints can be stale, and a session that is cut off mid-turn leaves nothing unsaid. It holds no lock and writes nothing, so any role may run it at any time, and it needs no network (`--ci` adds the CI of each pushed tip through `gh`).

What a handoff carries lives where `resume` reads it:

- **What comes next** is the order of the issues: priorities (`prio`) and **After:** (`after`). The next session reads it in the ready list and the waiting list.
- **Why** is a ruling (`decide`, or the owner's `answer`) or the issue's own body (`body --what/--why`). A reason worth keeping is never only in a summary.
- **What is going on in a branch** is the lease (`set in-progress --branch --worker`), the evidence rows and the log line each command writes.
- **What waits on the owner** is an `ask`, never a sentence in prose.

`handoff read` still works and prints the same, followed by a `.jarl/handoff.md` from before as history; `handoff write` writes nothing.

### Worker branches

<!-- RUNES:worker-worktree:START -->
**A worker works in its own worktree, on its own branch.** The main checkout belongs to the coordinator and to whoever merges for it; every worker gets a fresh worktree cut from the branch the work lands on, on a branch named for its issue (`<prefix>/NNN-slug`, NNN the first issue it carries), and never touches another worker's worktree or the main checkout's working tree.

- **One issue per commit.** Each commit carries one issue's change and names it in its message (`… (issue NNN)`). A package of small issues on one branch still commits them one by one, so a review, a revert or a bisect can take one issue at a time.
- **State lives in the main checkout.** A worktree may not see the coordinator's state at all. Every call that reads or writes it passes the main checkout's absolute path explicitly (the `root` field, or its CLI flag), from wherever the worker stands.
- **Stay in your lane.** Change only what the issue needs. Something else seen on the way is reported for filing, not fixed in passing.
- **Scratch goes to scratch.** Temporary files go to the scratch directory the brief names, or a temporary directory, never into the repository.
- **Leave it mergeable.** The work is committed on the branch and the checks the brief names pass there before the work is reported; the branch is not pushed, merged or rebased onto others unless the brief says so. Merging, and removing the worktree and the branch afterwards, is never the worker's job.
<!-- RUNES:worker-worktree:END -->

In Jarl the coordinator is the jarl and the one who merges is the merger. The prefix is `jarl`, so a worker's branch is `jarl/7-slug`, the issue's own slug after its number: two workers never share a name and a branch reads as its issue. Two loops sharing one clone put the feature branch's last path segment in front of it. Such a branch exists only in the clone running the loop: it is cut from the feature branch, merged back into it by the merger with `--no-ff` and a message naming the issue, and deleted together with its worktree. **It is never pushed** — the feature branch is the only branch of this loop that ever leaves the machine, and only on the owner's word. In the default mode a worker branch never carries `.jarl/`; in the committed mode it carries the copy it was cut with, which nobody writes — the loop's live state is the main checkout's, reached with `--root`.

### Code in another repository

A loop can keep its issues in one repository while its workers change another: a repository of plans and notes directing work in the code beside it, or one loop directing several repositories at once. The loop stays where `.jarl/` lives, in either mode, and every role still reaches it with `--root` pointing there. The code side moves to the other repository:

- **The issue names it.** `new --repo <name|path>` writes **Repo:** into the issue; `repo <id> <name|path>` sets it on an issue already filed. `--repo` takes the repository's name (the directory `git clone` gives it), its checkout, a worktree of it or a file inside it, and always reduces it to the repository's main checkout. Where that checkout sits beside the main checkout of the loop (`<parent>/<name>`), **Repo:** stores the name; anywhere else it stores the path, and a note on stderr says why, so two repositories that share a directory name stay apart. An issue whose change spans several repositories names them all as one comma list (`--repo tool,lib` → **Repo:** `tool, lib`); each of its files then starts with the name of the repository it is in (`tool/src/a.mjs, lib/src/a.mjs`), a file with none of the names is in the first one, `next` keeps each (repository, path) pair apart, `check` on it takes `--repo` to say which repository to read and bounds the diff by the files declared in that one, `branches` and `tips` read all of them, and `report` lists the issue under each. An issue without **Repo:** is read in the loop's own repository.
- **A name holds no path.** It resolves, in one place, to `<parent of the loop's main checkout>/<name>`, the main checkout found through git's common directory, so a loop opened in a linked worktree finds its siblings beside the main checkout. On a machine laid out differently, put a symlink to the checkout beside the loop's checkout. A name that does not resolve is shown with its fix (put the checkout, or a symlink to it, at that place), refused by the commands that act on it (`check`, `merged`, `repo`, `new --repo`, `import --repo`) and marked by the views. Jarl declares a name once, itself, in `.jarl/repos.md`: its root commits (all of them), its origin as found and its base branch, and no path; `repo --base <name> <branch>` changes the base, and every change of `repo` is a log line. A path is read from the loop's root (the directory holding `.jarl/`), never from wherever the tool is called. Which a value is depends on the loop's record format: in format 1 every value is a path; in format 2 a value that starts with `.` or `/` (or a drive letter) is a path and anything else is a name. The first name a loop stores raises the format, under the same lock, and writes a bare-word path as `./<word>`, and a record carries its format: Jarl reads the formats it knows and refuses a higher one.
- **Where it is on this machine** is printed, never stored: `show` (and `show --json`, as `where`) prints where each repository written as a name is and the worktree git has on the lease's branch, and `status --by repo` prints where each repository is, its base and whether its checkout is on it (a warning only).
- **Its files carry the repository's name.** Each file in **Files:** starts with that repository's directory name — a name is its own, a path ends in it — and goes on with the path inside it: **Repo:** `tool` → **Files:** `tool/src/a.mjs, tool/CHANGELOG.md`. A reader of the issue sees where each file lives, and `next` reads a file as its repository and its path: `CHANGELOG.md` in two repositories never holds an issue back, two repositories that share a directory name are still told apart by their **Repo:**, and two issues on the same file in one repository still wait for each other. An issue without **Repo:** writes its paths without a name, as in a single-repository loop. One case is decided by rule, not by guess: a repository that has a directory of its own name inside it (repository `app` with `app/x.mjs`). There the prefix is required — `app/app/x.mjs` is `app/x.mjs` inside the repository — and an entry that starts with `app/` but not `app/app/` is a path inside the repository and is never stripped. A repository is one repository however its **Repo:** path is spelled (a symlink, or another case where the file system ignores case), and `--repo` on `check` reads Files the same way the field does.
- **`scope` reads there.** Commits, files and assertions come from the worker branch in that repository, against its current branch as the base; `--repo <path>` on one call does the same and wins over the field. The repository's name is dropped from each declared file, and the path after it is matched against the branch's changed files.
- **`branches` reads there with `--repo <path>`.** Without it, it lists the loop's own repository only, so at boot run it once per repository the open issues name.
- **The worker, the reviewer and the merger work there.** The worker's worktree and its `jarl/7-slug` branch are cut in that repository from its own feature branch, and that is the branch the brief names; the reviewer diffs there; the merger merges and runs the check in that repository's main checkout. `.jarl/` never enters that repository.
- **`resume` and `tips`** show where that repository's branches stand, beside the loop's own.

### The worker's brief

```
You are worker <name> on issue <id> of branch <feature-branch>, in worktree <path>, on branch jarl/7-slug.
(When the issue carries a **Repo:** field, <feature-branch>, <path> and the branch are all in THAT repository, not in the loop's own: run git and the repository's check there.)
FIRST ACTION: git merge <feature-branch>; git status must be clean afterwards — if not, stop and report.
If your worktree was made for you by the platform and starts on a branch it named, RENAME that branch
(`git branch -m jarl/7-slug`); never create a second branch beside it, which leaves the first one behind.
Your scope is the issue below and nothing else. Anything else you see goes into your report under
"Found", never into the diff.
No file of the repository carries a task number or a description of a task: a comment says what the code does and why it must be so, and a test title says what behaviour it proves.
The loop's tools are the jarl MCP tools (jarl_show, jarl_evidence, jarl_body, …); pass root: "<main checkout>"
on every call — your worktree has no live `.jarl/` of its own — and never add `.jarl/` to your branch. If your
session has no jarl_* tools, run the same commands as `node <absolute path to jarl.mjs> <command> --root <main checkout>`.
If the change is user-visible, record its changelog entry on the issue:
jarl_body { id: "7", changelog: ["Added: …"], root: "<main checkout>" } (Changed, Fixed, … — one item per line). Edit
CHANGELOG.md on your branch as well only where the repository's own rules (its CLAUDE.md, AGENTS.md or hooks) require
the entry to come with the change; otherwise leave CHANGELOG.md to the merger.
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

<the output of jarl_show for the issue (its current window), not the file>
```

### The reviewer's brief

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

### The merger

Verifying and merging eats context, and the jarl's context is the scarcest thing in the loop. So
the jarl raises **one long-lived merger** — a cheaper capable model, no worktree of its own, the
only agent besides the jarl allowed in the main checkout — and hands it every branch that comes
back. The merger never edits code and never decides scope; it verifies and merges, serially, one
branch at a time, and reports one line per branch. When a merger exists the jarl merges nothing
itself, and **the merger is the only committer in the main checkout**: everybody else writes
`.jarl/` through the tool and never runs a commit there — two committers in one checkout, one of
them mid-merge, is how a conflict swallows the other's files. In the committed mode the merger commits `.jarl/` together
with every merge, so the loop's state always rides the code it describes; in the default mode git never
sees `.jarl/`, so the merger never commits it. Its brief:

```
You are the merger of branch <feature-branch> in <repo root>; the loop's tools are the jarl MCP tools, always
called with root: "<repo root>" (with no jarl_* tools in your session, `node <absolute path to jarl.mjs>
<command> --root <repo root>`); below, `jarl_x a --f v` is the tool jarl_x with those fields. The loop is in the <default | committed | permanent> mode. In
the permanent mode `.jarl/` is committed exactly as in the committed mode, and that commit is never
later stripped — there is no last commit before a merge to `main` that removes it, because a permanent
loop is never merged to `main` and never closed by removing `.jarl/`. Merging itself does not otherwise
differ: an issue that names another repository (**Repo:**) still merges there, into that repository's
own current branch, exactly as in every other mode — a permanent loop has no feature branch of its own,
so it holds no worker branches to merge unless an issue names none, in which case it merges directly
into whatever branch the loop's root already sits on (there is no throwaway feature branch of the
loop's own to merge into and later discard).
When an issue's **Repo:** names another repository, its branch, its merge and its check live in that
repository's main checkout — run git and the check there, list its branches with
`jarl_branches --repo <path>`; `jarl_scope` reads there on its own; `.jarl/`, `root` and,
in the committed mode, the commit of `.jarl/` stay in <repo root>.
You work in the main checkout, serially, one branch at a time. You never edit source files, never
push a worker's branch, never push anything the loop's rules do not allow (see "Standing permission
to push" in the jarl's own instructions: when `goal.md` or a ruling gives it, the merger's brief says
so and names the feature branch), never resolve a conflict by picking a side blindly, never weaken a
test or a check.
For each branch the jarl names, or that `jarl_queue` lists (approved, ahead of its base, in merge order and
batches), or that `jarl_branches` shows with commits beyond the base:
1. `jarl_scope <id> --branch <b>` (`jarl_scope --branch <b>` for a package); read the diff (`git diff <feature-branch>...<b>`); a worker worktree with an uncommitted but complete diff is committed on its branch first, with a log line saying the merger committed it; a branch the worker never renamed (UNNAMED in `branches`) is renamed to `jarl/7-slug` in its worktree (`git branch -m`) before anything else. A branch without a fresh reviewer's approve (`jarl_set` will refuse `done` without one, and a coordinator's approve does not count for a branch) waits for the reviewer; it is not the merger's call. If you merge one anyway, `jarl_merged` says so loudly — report it. In the default mode a branch whose diff touches `.jarl/` is not merged — git treats the ignored loop as expendable and would overwrite it — it is reported.
2. In the committed mode, commit whatever `.jarl/` holds first (the reeve writes there while you work, and an uncommitted
   file in a checkout you are about to reset is a file about to vanish); in the default mode there is
   nothing to commit, and neither a merge nor a reset touches the ignored loop. Then merge into the feature branch with the merge drivers passed on the command line, on every merge — never rely on the clone's own configuration: `git <settings> merge --no-ff <b>`, where <settings> is what `node <absolute path to jarl.mjs> merge-driver flags` prints (add `--yg "<yg command>"` when the repository has `.yggdrasil/` and that command answers `--version`, so Yggdrasil's log.md and lock files merge by their own drivers too). In such a repository, run `yg log merge-resolve` with no log named right after the merge: it records the baseline of every log the merge changed; when it changed the lock files, `git add` them and `git commit --amend --no-edit` (the merge is not pushed yet). A conflict the drivers stopped on — a ruling or a log entry both sides superseded, a slug both sides used, a rewritten history — is never resolved by picking a side: `git merge --abort` and report it. Any other conflict: resolve only when one side is plainly a superset or the hunks
   are independent; otherwise `git merge --abort` and report the files.
3. Run the repository's own check in the foreground, with the shell tool's own timeout parameter set
   for the whole run, and wait for it. Red: roll back with `git reset --keep ORIG_HEAD` — never
   `--hard`, which would also discard what others wrote meanwhile — then
   `jarl_round <id> "<what failed>"`, report. A red whose cause lies outside the branch (the base is red
   without it) is not a round: rounds count the worker's failures, and the third raises a takeover of work that
   was right. Roll back, file the cause as its own issue, and leave the branch approved in the queue until the
   check is green; only on the jarl's ruling is it landed on red, with `jarl_merged <ids> --sha <merge sha> --red <cause id>`.
4. Green: one call, `jarl_merged <ids> --sha <merge sha> --ran "<the check command>" --saw "<its summary line>"`
   (`--ci pending|green|red|none` too when CI is known: `none` when the repository has no CI; else
   `jarl_merged <ids> --ci green|red` once it reports), then `jarl_set <id> done`. The check goes in the merge record and is no
   Proof: if the call answers `NO PROOF FROM THE WORKER` for an issue, `done` waits for the worker's row; do not type one in the worker's name.
   The same `jarl_merged` call has already removed each issue's worktree and its local branch when that was safe,
   and its output says what it removed and why it kept anything (`--keep` skips the cleanup). A branch it
   keeps (the reason is named: uncommitted or untracked files, another issue still on the branch, a tip that is
   not in the base or the merge, the branch checked out elsewhere, the base or a release branch, a worktree
   not on this machine, or a refusal by git itself) is the merger's to look at: fix what the reason names and
   remove it with `git worktree remove` and `git branch -d`. The tool never forces; for a worktree that holds ignored
   files it prints commands that carry git's force flag, which a person who has looked at those files may run. When the worker began on a branch of
   another name and made `jarl/7-slug` beside it instead of renaming it, that original branch is not the
   issue's Branch and stays for the merger to delete (read it off `git worktree list` and `jarl_branches`, which
   marks it `DONE → delete`). Then, in the committed and permanent modes only, commit `.jarl/` (everything in it, including what the reeve wrote meanwhile) on the
   feature branch — you are its only committer; in the default mode `.jarl/` is never committed. When the
   merge happened in another repository, commit `.jarl/` in the loop's repository after recording it: nothing
   else will, and `status` counts the loop files left uncommitted.
   When the issues carry changelog entries and the branch did not already add them, `jarl_changelog <ids> --repo
   <path>` prints them; paste them under `[Unreleased]` in that repository's CHANGELOG.md, edited into the register
   the repository asks for, merged into an existing `[Unreleased]` entry when they cover the same feature, and commit
   that file alone ("changelog: <ids>") — the one file you write.
   Before moving to the next branch, `jarl_show <id>` and confirm it reads
   `done` — a write that silently failed to land is worse than one that never ran. The tool locks
   and refuses loudly now, but a call whose error result (or exit code) nobody read is still a write nobody saw.
Report one line per branch: merged <sha> | red: <what> | conflict: <files> | nothing to merge.
When several approved branches wait and their declared files do not overlap, merge them one after
another and run the check once for the batch; a red batch is rolled back whole (`git reset --keep`
to the commit before the first merge) and re-done one branch at a time, so the red one is found and
the green ones still land. Never batch two branches that touch the same file.
Spawn no agents.
```

## What goes to the owner

Decide yourself inside the goal. Stop and ask when:

- the goal or a standing decision would change;
- something that protects would get weaker: a test, an assertion, a check, a rule, a hook, a CI step;
- a number would enter the code without an origin you can name;
- a merge conflict cannot be resolved without losing one side's behaviour;
- the work would reach outside the session — a push, a release, a cost.

Ask well: where you are, what you found, the options with trade-offs, your recommendation. Never an
open "what should I do". File it with `ask`, keep the rest of the loop moving, and record the answer
with `answer` — it becomes a ruling in `decisions.md`.

**Decided under a mandate.** When the owner has handed the loop a mandate to decide on its own ("decide
and go on, I'll look later") and it decides something that is the owner's (from the list above), the
choice is always filed as `ask --kind ratify [--issue <id>] "<what was decided, and why>"`, never left in
evidence prose. A ratify item blocks nothing: the work goes on, `next` and `done` ignore it. It is
listed in `status` (`to ratify N`, one line each) and under its own heading in `resume` until the
owner answers. `answer` records the answer as a ruling and writes it into the issue's evidence. When the
owner rejects the choice, file the undoing as a new issue.

### Rulings about an area

A ruling that reaches every file of one type of code — every handler, every migration — is not the loop's alone: the next agent touching any other file of that type has to know it, long after the loop is gone. Such a ruling is written with `decide <slug> "<ruling>" --area <type> --reach <n>`: the type as the repository's graph names it, and how many files it holds. When the ruling admits a rule of the graph on that type — the rule stands `advisory` there until the owner admits it — add `--rule <id>`, the rule's id as the graph names it. It works as a ruling of the loop at once; it becomes the type's own only when the owner admits it. The test for `--area` is the owner's: would an agent touching another file of this type need to know it? Only the thick ones pass.

The owner admits them in one batch when the loop closes. `close` files the batch as ratify items — at most 10, widest reach first; the rest wait for the next close — each one sentence of the ruling, its type and the number of files. `close --batch` files it without closing, so the owner can answer before the loop goes: `answer <a-id> "yes"` admits a ruling, `answer <a-id> "reject"` rejects it; the first word decides (`yes`, `ok`, `tak`, … or `reject`, `nie`), anything else is refused. A bare `no` decides nothing — it is English no and colloquial Polish yes — so the word after it decides (`no tak` ratifies, `no nie` rejects), and `no` alone is refused with a request for `tak` or `nie`. The batch never holds the close: a ruling nobody ratified stays a ruling of the loop — kept with a permanent loop, gone with a loop on a branch — and never enters the type's decisions.

A ratified area ruling is written into the type's decision log (`yg log add --type <type>`, from the repository holding the loop) when that repository has a Yggdrasil graph (`.yggdrasil/`) and a working `yg` answers `npx --no-install yg --version`; a ruling that supersedes one written there replaces it there too. Without a graph or a working `yg`, nothing is sent. A write `yg` refuses — an unknown type, or decisions already in force that the new one says nothing about — is reported with the command to run by hand, and the ruling stays in `decisions.md`, marked **Ratified:**. A ratified ruling that names a rule (`--rule`) is also written into that rule's own log as a ratification (`yg log add --aspect <id> --ratify --by <who>`), naming as who admitted it the one the answer named (`answer <a-id> "yes" --by <who>`), else the name git's configuration gives that repository, else "the owner"; Yggdrasil reads the types and the version admitted from the graph — every type the rule reaches, not only the ruling's area, so the batch question for such a ruling says so — and the rule may then stand `enforced` on them without its `type-law-unratified` finding. It is written after the type's decision and independently of it; a rule `yg` does not know, or one no type reaches, is refused and reported with the command to run by hand, and the answer still stands. Entries a graph upgrade recorded for rules already in force name the graph, not a person: they are never the owner's word, and Jarl never skips its write because one is there. This is Jarl's one optional edge to another tool, and its only one. A loop run by a composer — its profile keeps `close` to the record (`lifecycle`), as Horde's mission does — is written into the graph by that composer, with its own code and into the tree it hands over: there `answer` records the verdict and sends nothing, and says so, so no entry is written twice or into a checkout the composer's work never reaches. A composer files its own batch through the record library (`ask` with `kind: 'ratify'` and `ruling: <slug>`), which refuses a ruling that is not an area ruling in force or was asked about already.

## Closing the branch

Before the feature branch merges to `main`, in this order:

1. Every issue is `done` with evidence, or `dropped` or `deferred` with a reason, or listed to the owner as still open.
2. `report` is the material: the repository's changelog carries every user-visible change from it, in the
   register the repository asks for; entries still on issues (see [Changelog fragments](#changelog-fragments)) are
   printed by `changelog <ids>`.
3. The repository's own check is green on the branch tip.
4. `jarl_close` with `batch` (`close --batch`) puts the area rulings to the owner (see [Rulings about an area](#rulings-about-an-area)); answer what they answer, and go on either way.
5. `jarl_close` removes `.jarl/` — it refuses while anything is still open or deferred: `archive "<slug>"` keeps the deferred work under `.jarl/archive/`, and `close --force` removes the loop with it and keeps no copy. In the committed mode
   that removal is the last commit, so `main` never carries the directory; for that reason `close` also
   refuses while `.jarl/archive/` holds anything (move it out of the tree, or pass `--force`, which
   removes the whole directory). In the default mode there is nothing to commit — git never saw it —
   and `close` leaves `.jarl/archive/` in place.

Merging and pushing are the owner's word, never yours.

### Standing permission to push the feature branch

Some loops have that word already, for good: the owner has said the loop commits and pushes the
feature branch as it goes (a release loop that keeps `release/<version>` on the remote, say). That
permission is a rule of the loop, so it is written where the loop's rules live: a line in `goal.md`'s
rules, or a ruling in `decisions.md` quoting the owner's words, naming the branch it covers. With it
on file, the merger's brief says so: after a green merge into the feature branch, push that branch.
A worker's branch `jarl/7-slug` is never pushed, with or without it, and nothing beyond the
feature branch is covered by it. Without such a line, a push is still the owner's word each time.

### Closing a permanent loop

A loop opened with `init --permanent` has no feature branch to close, so this section applies with
one difference, at step 5: nothing above it changes — every issue still needs to be `done` or
`dropped` before closing, `report` still feeds the changelog, the repository's own check still needs
to be green. But `jarl_close` in this mode never removes `.jarl/`: it refuses exactly as above
while anything is open or in progress, and once clean it appends a closing line to `log.md` and
leaves the directory in place — the record `--root` named stays where it was, for the next release,
or the next session, to read.

## The reeve: handing the loop down

The jarl's context is spent best on the owner and on judgement, so once the loop is open the
jarl raises **one long-lived reeve** on the standard tier and hands it the loop. The reeve runs
this skill exactly as the jarl would — boot, file, pick, raise workers and reviewers, keep the
merger fed — with one difference: it never talks to the owner. It reports to the
jarl, in one line, on four occasions only: a research issue or a gap the goal did not foresee; a
question the owner answered in a way that changes the goal; every few merges, the counts; and an
empty queue. The jarl stays the one who answers the owner and rules on what the reeve raises.
Everything the reeve raises is its own to reach — a worker, a reviewer, a merger — so the reeve
holds all of them and the jarl holds the reeve. Its brief is this whole skill, plus the repository,
the feature branch, the absolute path of the script for a session without the jarl tools, and the four occasions above.

A merger's report is the only signal that it has stopped touching the main checkout — not a delay,
not an assumption that it "must be done by now", not a status the loop tracks some other way. The
main checkout has exactly one writer at a time: while a merger's report is outstanding, nobody —
not the reeve, not the jarl — runs a git command there or treats its work as settled, and no second
merger is raised into it. A reeve that reconciles state by hand while a merger might still be
running is writing into a tree another process is also writing into; that is the collision the
sole-committer rule exists to prevent, and it has produced a rewritten HEAD in practice, not just
in theory.

The reeve does not guess which mode it is in. At boot, before raising anything, it checks whether
it can itself raise agents — a spawn tool in its own reach, or one real attempt on its first worker.
If it can, it holds every worker, reviewer and merger itself, exactly as above. If it cannot, it
reports `no-spawn` to the jarl in one line and the relay below begins for the rest of the loop.

On a platform where an agent raised by the jarl cannot raise agents of its own, the split stays and
only the spawning moves: the reeve writes every brief to a file and sends the jarl one line per
spawn (`spawn <role> <id> tier=… worktree=… brief=<path>`); the jarl spawns from that line without
reading the brief; every raised agent writes its report to a file and ends with one line naming it;
the jarl forwards that one line to the reeve. A second round for the same worker, or feeding the
merger again, is a resume, not a new spawn — the reeve sends `resume <id> brief=<path>` instead, and
the jarl resumes that same agent without reading the brief. The jarl's context then carries
pointers, not briefs and reports.

## Which model sits where

Every spawn names its model explicitly and never inherits the coordinator's model: a spawn that carries none runs on whatever the session runs, which puts a clerk's task on the strongest model or a design on the weakest, and the record cannot tell which. Any provider's model is allowed; Jarl keeps no list of models and refuses none. It records which model did which kind of work, derives from the record how often that work passed without changes, and suggests; it never reroutes anything.

Opening the loop — reading the repository whole, writing the goal, the first rulings and the first
issues — is the one part that needs the strongest model in the room. The loop itself is clerical
work over a tool that refuses what is wrong: the reeve, on the standard tier, runs it, hands out
issues, reads reports and keeps the journal, and hands back to the jarl only on the four occasions
above. Workers, readers, reviewers and the merger run on the standard tier unless an
issue's own `Tier:` says otherwise. Say which tier is running in every report.

**The tiers, and when each fits.** The built-in tiers are `light`, `standard` and `strong`, weakest first; `standard` is the default, and a profile that declares its own tiers keeps their order. The criteria are a prior that the measurements below refine:

- `light`: a check or a test decides whether the work is right, the scope is written down, and nothing that protects changes — a mechanical edit, a filing from notes, a read-only inquiry, a first-pass review.
- `standard`: a clear acceptance and a known place in the code — ordinary code, tests and documents.
- `strong`: the cause is unknown (a flaky test included: it is often a real defect), a design, a record format or a contract, security or data integrity, anything that weakens or changes a protection, a takeover after three rounds, finishing another worker's uncommitted work.

`new` without `--tier` records `standard` and says so on stderr (the command line only), with these criteria in a few words. The takeover block that the third `round` prints says to raise the fresh worker one tier up, or on another model than the one that failed, which the lease names.

**The loop's models.** A loop says which models it runs on, per tier, in `goal.md`: one line per tier, `Model (strong): <model>[, <model>…]`, in the same forms as `Check:` (a plain line, a list item, or bold). The first model on a line is the tier's default, the one raised unless a suggestion says otherwise; the other models are in the pool at that rank. The order of the tiers is the order of strength, so it ranks the models, the same id at another effort sitting where the id sits. A model on no line is unplaced: it may run, since nothing is refused, but its rank is unknown and as a reviewer it ranks below every placed model. A rule, a brief or this skill never names a model: the lines do, because ids go stale within weeks. The person who owns the loop edits them, or the jarl under a mandate with a ratify item; nothing moves by itself.

**How each platform maps the tiers.** The levers, not the names (families are examples, never a rule). In Claude Code the Agent tool takes a `model` (an alias such as the family name resolves to an id: record the id) and an `effort`; the families run by size from small to large. In OpenAI's Codex a run takes a model and a reasoning effort; the families run from the mini through the standard to the largest reasoning model. On any other host, use whatever its picker allows per agent. A host that cannot choose a model per spawn runs every agent on the session's model: record it all the same. The note on an approve by the worker's own model then fires every time, which is the truth about that loop: a fresh instance is still a fresh reviewer, and the correlation risk is real and visible.

**Effort is the second lever.** For an issue that is hard but clear, a higher effort on the same model is a cheaper step than a higher tier. The recorded value is the model id with `@<effort>` where the platform has the lever (`<model id>@high`), so the same model at two efforts is two workers with two records. Record the resolved id, never a moving alias: an alias would silently merge two models' records after a release.

**Recording.** The one who spawns an agent knows the model it asked for; the agent often cannot name itself reliably. So the coordinator passes `--model` on the lease it writes before raising a worker (`set <ids> in-progress "<why>" --branch <b> --worker <name> --model <m>`), and writes the reviewer's model into the reviewer's brief, whose recording command carries it (`review <id> approve|changes --by <name> --model <the model you were raised on> "<findings>"`). In a loop with model lines, a lease or a verdict without `--model` is noted on stderr, never refused.

**The approve that clears an issue** is never of the worker's own model and never ranked below it, until `models` shows `may clear <kind>` for that kind of issue. A lighter or same-model reviewer that adds a `changes` before the clearing approve is welcome: a cheap first reading that finds something saves a round. A breach is a note on the verdict and a count in `models`, never a refusal; the done gate and the fresh-review rule stand as they are.

**How a new model enters.** It is raised with an explicit `--model` and is unplaced and new. It starts on small issues (light, or standard with a clear acceptance), and the approve that clears its work comes from a placed model of at least the issue's tier. As a reviewer it starts first, beside a placed reviewer that clears. After five reviewed units in a kind, `models` says `fits` or `below` against the kind's own baseline; after five approves that a reviewer able to clear then checked, with no miss, it says `may clear <kind>`. When a model fits a kind at a tier, `models` suggests adding it to that tier's line.

**Relaying a verdict.** A reviewer records its own verdict. A reviewer that came back without recording it is resumed to record it. `review --relayed` is for the one case that cannot cover, a reviewer that cannot be resumed (its session ended, an outside interruption): the coordinator records the verdict the reviewer gave, from its report, and marks it. It still counts as the reviewer's standing, because the reviewer did review; the mark makes the second-hand provenance true and makes the reviewer model's slip countable.

**What `models` shows.** Per model, as worker and as reviewer, per kind of issue (`Kind · Tier`; both fields are on every issue and are closed sets, so the cells are few and comparable; repository and tags are slices with `--by`). As a worker, a unit is one lease: one worker on one branch, which is one issue or one package, and a takeover starts a new unit. Per cell: the units settled and reviewed, the clean first pass (every issue of the unit closed with no `changes` verdict and no round), changes, rounds, red after approve, handed over, units that ended before any review (kept out of the clean share's n, because an outside interruption is not a quality signal), units whose proof was recorded as evidence rows before the first review, and follow-ups. As a reviewer: verdicts, changes, approves checked by a later reviewer of another model, misses (the later verdict was `changes`, or a round or a reopen followed the approve), relayed verdicts and clearing approves on the worker's own or a lower-ranked model. Every count carries its n and a share appears only from n ≥ 5; below that the view prints counts and no word. `fits` is a clean share at least the kind's baseline (all units of that kind in the loop), `below` the opposite, `new` a model under five units in every kind, `may clear <kind>` a reviewer on the worker's own or a lower model with five approves of that kind checked afterwards by a reviewer able to clear and no miss among them. Below five units in a cell the view also gives the model's numbers across the kinds of that tier. Work whose lease or verdict carries no model is grouped `(not recorded) · tier <t>`. Two biases are named: a model is measured only on the work it was given, so compare inside a kind; and a worker's clean share is as strict as its reviewers, so compare inside one review practice. Not derived: whether a finding was right, cost, and every slip that never reaches the record (a report sent before the check finished, a forbidden command form) — the cure for those is the brief. On `next` and `resume`, a ready issue of a loop with model lines shows the tier's default model, and `suggest <model>` when a lower-ranked placed model fits that kind of issue while the default does no better there. A wrong suggestion costs a round, never a defect: the review and the repository's check still stand in front of every landing.

## Talking to the owner

One sentence of state at boot: how many open, how many in flight, what you do first. "How is it going"
gets an assessment, not a list. Plain words, no internal names; the owner reads what happened, not how
the loop works.

### The record as a library

Another tool that stands on Jarl's record (a composer such as Horde, whose mission is a real Jarl loop under `--root`) reads and writes it through `scripts/record.mjs`, and only that module. It declares its contract as `RECORD_API` (`jarl-record/1`) and exports, each named by hand: opening and reading a loop, an issue as text, the profile, the write lock and the atomic write, the operations on the record (filing, status moves with the profile's checks, fields, sections, evidence, reviews, merges, rounds, rulings, questions, log lines) and the data behind `status` and `resume`. The list, with every function's parameters and `opts` keys, lives in [`scripts/record.mjs`](scripts/record.mjs) itself and nowhere else. Each operation holds `.jarl/.lock`, refuses with the CLI's own words, writes the same files and log lines, and returns what the command's `--json` prints. `loadIssues` and `findIssue` return the record, so an issue's status, lease, merge and CI are what the log says, while `parseIssue` reads a text alone; `statusData` and `resumeData` carry `disagreements` when a header differs from the log; `appendLog` refuses a line that reads as state and `writeAtomic` refuses the journal. A composer therefore writes status, lease, merge and CI through the operations and keeps to the file only for the fields the log does not hold (see [When a header disagrees with the log](#when-a-header-disagrees-with-the-log)). A status move says who asked: `record` for a library call, `cli` for the command line and the MCP tools. The lock is re-entrant per loop and takes synchronous work only; waiting for it blocks the thread for up to 20 s. A vendored copy is `record.mjs` with `jarl-lib.mjs` beside it. The library never reaches another tool: an answer to an area ruling's ratify item hands back its `typeDecision` (`{ type, text, supersedes }`), which the command line writes into the type's decision log and a composer writes with its own code, or not at all. Nothing else here is a contract: `jarl.mjs` is the command line over `record.mjs`, and `jarl-lib.mjs` and every export of `jarl.mjs` change without notice. A change to `record.mjs`'s exports or their parameters bumps `RECORD_API`; the suite fails until it does.

### What only the command line does

The library and the command line write the same files and log lines for every operation of the record, except the rows of this table. Each row is one difference that stays, with what the command line does, what the library does and the reason. The rows are the one list; a test in the suite holds this table to it.

| Item | Command line | Library | Why |
|---|---|---|---|
| Merge with no CI state | records no CI state unless `--ci` is given | records `pending` when a sha is given without a CI state | a composer that records a merge before CI has run says so in the record; a person at the command line gives the state when it is known |
| Numbers of issues and questions | writes them plain (`3`, `a-1`), and raises the record format for a plain number under three digits | writes three digits (`003`, `a-001`) | a composer's files sort by name, and the contract returns the three-digit ids |
| Merge cleanup | removes the merged issue's worktree and local branch when that is safe, unless `--keep` is given | removes nothing | removing git worktrees and branches is a step a person asks for at the command line; a composer removes the ones it made |
| Caller of a status or field move | asks as `cli`, so a status the profile marks `set-by: record` is refused | asks as `record` unless `caller: cli` is passed | a status the profile gives to the record's own tool is moved by the composer that runs the loop, not by a person at the command line |
| Worktree of a lease | refuses a `--worktree` that exists and is not a worktree of the lease's repository, or has another branch checked out | accepts it and stores nothing | the worktree of a lease is found through its branch; a composer that tracks worktrees checks them itself |
| Base of a done check | checks a done against the branch checked out in the merge's repository, and takes no base | takes `base`, the branch or ref a merge landed in, for a composer that lands into a branch not checked out | a person's merge lands in the checked-out branch; a composer names its own target, and no command-line call can name one |
| Who answered | records `--by` (default: owner) | records the owner; the contract's answer takes no name | a composer cannot name the ratifier through the library, because the answer keeps the arguments the contract names |
| Ratified area rulings | writes the type's decision log and the rule's log through the Yggdrasil edge | returns the entries and writes neither | the Yggdrasil write is the only call from Jarl to another family tool; a composer writes into its own graph; no twin case exists, because it needs a loop with an area ruling and a graph |
| Replies and notes | prints notes and replies that depend on the caller: the goal that names no check (`init`), the tier of a new issue (`new`), the lease notes (`set`), the proof and fresh-review notes (`merged`), the model and proof notes and the next step (`review`), the owner's word with no question (`decide`), and a long free-text note (`evidence`) | writes the same files and prints none of them | the notes are for a person at the command line; the twin cases compare files and log lines, and the notes are neither |
| Lists of ids | takes a list of ids (`12,13`, `203-206`) for `files`, `repo`, `after`, `body`, `round` and `source`, and checks every id before it writes one | takes one id for each of those operations | a person at the command line writes a package of issues in one call; a composer calls the operation for each id it holds and decides what a refusal on one of them means; no twin case exists, because the twin loops run one id |
| The verbs `retract` and `field` | retracts an approve or an evidence row with `retract`, and writes Resources or a profile field with `field`, emptied with `--clear` | retracts with `review` (verdict `retract`) and `addEvidence` (`retract`); `setField` writes a field the profile declares, and `setStatus` with the name `resources` writes Resources; both empty a field with an empty value | the verbs are the command line's grammar over the operations; the library keeps the operations its contract names |
| `close` | ends the loop: removes it, or keeps it as a permanent record | no function | ending a loop belongs to whoever runs it, and a profile may hand that to a composer |
| `archive` | moves the loop under an archive directory and leaves the open issues named | no function | ending a loop belongs to whoever runs it, and a profile may hand that to a composer |
| `mode` | makes the loop permanent, a mode of git | no function | the mode is written at init, and a change of it is a decision of the person who commits the record |
| `import` | files issues from a Markdown source | no function; newIssue files one issue | filing from a source is the composer's choice |
| `next` | lists the open issues that can start now | no function; statusData carries the counts | ordering work is a composer's planner; Jarl offers what can run now |
| `queue` | lists the merge queue | no function | a listing for a person; a composer decides what lands |
| `report` | writes the loop's text report with its metrics | no function | a summary for a person; a composer reports from its own record |
| `scope` | reads a worker branch's diff against the files its issues declare | no function | it reads git; a composer's gate decides what lands |
| Typing a command under another name | prints a note on stderr that gives the command's own name | no command names, only functions called by name | a note for a person typing at the command line; the tools and composers call a command by its own name |
| `branches` | lists each branch with the issues it carries and its state | no function | it reads git in the repositories the issues name; a view for a person |
| `tips` | lists the tip of each worker branch in flight | no function | it reads git in every repository the issues name; a view for a person |
| `verify` | checks the record with its own readers in strict mode | no function; the readers are the library's | a consistency read for a person; a composer uses the readers |
| `models` | shows, per model, what the record holds as worker and as reviewer | no function | a reading of the record for choosing models; a view for a person |
| `goal` | reads or sets the goal line | no function; initLoop writes the goal | the goal is written at init; a change of it is a decision of the person who runs the loop |
| `show` | shows one issue as text, with its evidence rows and where its branch sits | no function; findIssue returns the same record as data | text for a person |
| `list` | lists the issues as a table | no function; loadIssues returns the same record as data | a table for a person |
| `changelog` | shows the changelog fragments of issues as text | no function | the release step writes the release text once, from the fragments |
| `handoff` | reads and writes a session's handoff note | no function | the handoff is a note of a session, not part of the record |
| `sources` | lists the sources of issues | no function; setSource writes them | a view for a person |
| `profile` | shows the profile in use, as text | no function; loadProfile and describeProfile return it as data | text for a person |

## What Jarl will not grow

Jarl records, derives and displays; it never blocks code from landing. Every scale request is measured against that line. On Jarl's side: filing and importing issues, refusals at the level of the record (a `done` without evidence or a fresh approve, a self-approve, a cycle of After), review provenance, read-only views (`resume`, `status`, `report`, `tips`, `queue`, `branches`), ordering by After, branch packages, leases that are shown and never expire, merges and CI recorded as fields, changelog fragments, templates, and a profile that says, as data, which statuses and fields a loop's issues carry. Jarl itself ships none of the following, and a loop without a profile has none of them:

1. **A merge queue that runs the repository's check and refuses the merge.** `queue` lists; it never lands anything.
2. **A `done` that waits for green CI.** CI is recorded and noted (`set done` says when it is not green), never required.
3. **Leases that expire or are taken over automatically, or territory locks across loops.** A stale lease is shown for the jarl to act on; nothing moves by itself.
4. **A release mode that refuses to tag or release.** A release checklist is issues filed from a template; the procedure belongs to the skill that runs releases, and the tags to each repository's own release workflow.
5. **A computed schedule or critical-path planner.** `next` offers what can run now; After is ordering and bookkeeping, not a schedule.

The line holds for Jarl's own code. A profile is data only: statuses and who may set them, fields, sections, the scheduler it defers to, what its done gate asks for and who may end the loop. Jarl does not run commands a profile supplies, now or later. A composer that needs a gate, a planner or a lease that acts, as Horde does, keeps them in its own code beside the record and writes to the record through `record.mjs`. The only Jarl code that calls another tool of the family is the optional write of ratified rulings to Yggdrasil (see [Rulings about an area](#rulings-about-an-area)). A request for one of the five above is a request for such a composer, not for a bigger Jarl.

## Boundary with other skills

Jarl is the loop; it does not replace discipline. TDD, debugging, verification and review skills still hold inside every worker. Urd's "ask, don't guess" holds inside the jarl. When a mission needs the graph, a plan made before anyone writes, the gate and the owner's charter, that is Horde, whose mission is a Jarl loop run under its own profile — the vocabulary carries over because the record is the same.
