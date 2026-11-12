// The usage text: every command with its flags and what it does, which --help and the jarl_help tool print.

export const USAGE = `usage: jarl.mjs "<a-jarl-command>" [options]
       jarl.mjs --version                        the version of this install, the one the MCP server reports

commands:
  init "<goal>" [--committed] [--permanent] [--profile <profile.json>] --by who
                                                 create .jarl/ with the goal; by default it also writes .jarl/.gitignore
                                                 (* and **/*) so git never sees the loop, and every role working
                                                 outside the loop root passes --root <loop-root>;
                                                 --committed ignores only the write lock and temporary files: the loop
                                                 is committed with the work; --permanent is committed too, marks it with
                                                 .jarl/.permanent, and is not tied to a feature branch: close (below)
                                                 keeps the directory instead of removing it; --profile checks the
                                                 profile file (see profile below) and stores it as .jarl/profile.json
  new "<title>" [--kind k] [--prio 1|2|3] [--tier light|standard|strong] [--tags a,b] [--files p,q] [--repo <name-or-path>] [--found-by who]
      [--where "<text>"] [--what "<text>"] [--why "<text>"] [--acceptance "<line>"]... [--changelog "<changelog-entry>"]...
      [--source <report-dir#finding-id>,...] [--after <ids>] [--template <name>] [--field "<name=value>"]... [--section "<name=value>"]...
      [--person "<name>" --check-when "<date-or-event>"] [--range <name>] --by who
                                                 file an issue under the next free number outside every range the goal
                                                 declares, or with --range under the next free number of that range
                                                 (a Range line of the goal);
                                                 without --tier it records
                                                 standard and says so on stderr, with what each tier is for (light: a check
                                                 or test decides; strong: unknown cause, design, record format, security);
                                                 --repo names the repository
                                                 its code lives in when that is not the loop's own, several as one comma
                                                 list (see --repo below); --tags, --files, --source, --after and --repo
                                                 repeat, or take a comma list (see Lists below);
                                                 --what, --why and --acceptance (one per line, repeatable) write the body,
                                                 --source names the finding(s) it comes from, --after the issues it waits on;
                                                 --changelog (repeatable) is the issue's changelog entry, "Added: …" etc.;
                                                 --template reads .jarl/templates/<name>.md: its Kind, Priority, Tier, Tags
                                                 and Files are defaults and its What, Why, Acceptance and Changelog the body,
                                                 each replaced by the flag when given; --field and --section
                                                 (repeatable) write the fields and sections the loop's profile declares
                                                 (a field's default when not given; a required one must be given);
                                                 two kinds are kept, never worked by a worker, and next never offers them:
                                                 --kind promise is a promise, kept by whoever its --found-by names (the
                                                 jarl when none), and --kind wait a wait on an outside person, which needs
                                                 --person (who it is held by, the name next --as answers to) and
                                                 --check-when (a date, or the event to check after); either ends when its
                                                 issue closes
  renumber <id> --key <key> --by who
                                                 of the issue files that carry one number after a merge of two copies
                                                 of the loop, give the one whose header carries --key the next free
                                                 number: its file is renamed and its first line rewritten; every log
                                                 line about it names its key, so it keeps them, and no line is
                                                 rewritten (verify names the files and their keys)
  field <ids> <name> ["<value>"] [--add | --remove | --clear] --by who
                                                 change one part of the description of every id, the one command for
                                                 it: the header fields Title (the file keeps its name), Priority (1|2|3),
                                                 Tier, Kind, Found by, Tags, Files, Repo (as --repo below), After (the
                                                 issues it waits on: next does not offer it until each is done or
                                                 dropped), Parent (the one issue it is a sub-issue of: a parent waits on
                                                 its sub-issues, a sub-issue on its parent's After, and a sub-issue with no
                                                 slice tag is in its parent's slice; a parent that would sit under its own
                                                 sub-issue, a wait in a circle and a finished parent are refused), Source (<report-dir#finding-id>), Where, Resources (the exclusive resources
                                                 the issue holds while its lease lasts, loop-wide names; next never
                                                 offers two issues holding one), Person and Check when (whom a wait is
                                                 held by and when to check it: Kind becomes wait only once both are
                                                 written, and neither is emptied on a wait), a field the loop's profile
                                                 declares, and the sections What, Why, Acceptance, Changelog and the ones
                                                 the profile declares; a name is matched in any case, and one with a
                                                 space is quoted ("Found by"). A value alone replaces what the part
                                                 holds; --add adds the items of a list field (Tags, Files, Repo, After,
                                                 Source, Resources) or the value after what a section holds (Acceptance
                                                 and Changelog gain lines, the others a paragraph); --remove takes items
                                                 off a list field; --clear empties an optional part (Title, Priority,
                                                 Tier, Kind, Found by and a required field are never empty). A list
                                                 field takes a comma list, and Acceptance and Changelog one item per
                                                 line. Each value is checked as at filing (Tier and Kind against the
                                                 profile; one slice:<coordinator> tag per issue, which puts it in that
                                                 coordinator's slice), and each change writes one log line per issue
                                                 and part with what the part held before and, when --by names one, who
                                                 changed it (a value it already holds writes none); the history
                                                 (evidence, verdicts, merges, rulings, answers) has no edit, only
                                                 retract and decide --supersedes, and the status moves only with set;
                                                 any other name is refused with the names field writes and the command
                                                 that writes it instead
  split <id> --line "<line=id>"... --by who
                                                 share out the acceptance of a parent among its sub-issues in one
                                                 write: each --line <n>=<id> moves acceptance line n to issue <id>, or
                                                 keeps it on the parent when <id> is the parent's own; every line is
                                                 named once, and a line named nowhere is refused, so none is lost; each
                                                 issue a line moves to becomes a sub-issue of the parent, as field Parent
                                                 makes one, and gains the line after the ones it holds
  base <name> <branch> --by who                the base branch a declared repository is held against, changed
                                                 with a log line that says what it was (a repository is declared
                                                 when an issue first names it; see --repo below)
  import <findings.json> [--source <report-dir>] [--kind k] [--prio 1|2|3] [--tier t] [--tags a,b] [--repo <name-or-path>]
      [--found-by who] [--only <finding-ids>] [--adopt] [--dry-run] [--field "<name=value>"]... [--parent <id>] --by who
                                                 one issue per finding, with Source: <report-dir#finding-id>; a finding
                                                 whose Source is already on an issue is skipped, so a re-run files
                                                 nothing twice, and one whose text differs from the What or Why of
                                                 the issue import filed for it is reported with both texts (the
                                                 issue is never rewritten); a finding with neither a claim nor a
                                                 truth is not compared;
                                                 --dry-run prints what it would file; --adopt writes
                                                 Source onto an existing issue that names the finding id but has none;
                                                 every finding is checked before the first write, so a refused import
                                                 writes nothing; --parent files each issue it files under that parent;
                                                 --tags, --repo and --only repeat, or take a comma list
  sources [<findings.json>...] [--source <report-dir>] per report: its findings, the issues filed from them and their
                                                 status; with a findings file, the findings nobody filed too
  evidence <ids> "<text>" --by who | --ran "<command>" --saw "<what-it-printed>" --line <line-number> --by who | <id> --file <path> --slot <name> --by who
                                                 append a free-text note (under ### Notes), or one checkable row per --ran/--saw
                                                 pair (repeatable; under ### Proof, after the last row);
                                                 --line names the acceptance lines each row of the call proves, 1 for
                                                 the first (repeat it, or a comma list), and a row names at least one:
                                                 the row stores a digest of the line's text, so it counts only while that
                                                 text stands; --by names who ran it, and done asks of each line what its
                                                 method asks (see set);
                                                 --file --slot records one attachment as a Proof row: the slot, the path
                                                 under the loop root (relative, no .., no symlink), the file's sha256 and its
                                                 size; nothing is copied. The slot is one the profile's done gate requires of
                                                 the issue's kind, and the file lies at the slot's place, has an allowed
                                                 extension and at least the minimum size (at most 64 MiB); done checks every
                                                 required slot again on the disk
  retract <id> review|<n>|note-<n>|tick-<n> --by <who> "<text>"  take a record back by an appended entry that says who and why; review retracts
                                                 the newest approve not yet retracted (never a "changes" verdict), and the
                                                 approve stays, struck through; <n> retracts the n-th evidence row (the
                                                 number show prints before each row, counted over the whole Evidence
                                                 section) and note-<n> the n-th free-text note (show prints note-<n> before it): the row or note stays, struck
                                                 through, and show leaves a retracted note and its reason out unless --full; the done gate and the metrics
                                                 do not count what is retracted; tick-<n>, --by owner alone, takes back
                                                 his tick of acceptance line n, and done waits for his tick again;
                                                 retract <slug> supersession --by <who> "<text>" takes back the
                                                 supersession of a ruling written by mistake: the ruling is in force
                                                 again, the line saying who and why is appended to it and logged
  list [--status s] [--kind k] [--tag t] [--prio p] [--grep re] [--match "<field=value>"]... [--all]
                                                 the issues not finished (open and in-progress) by default; --all for
                                                 every status; --match keeps those whose header field holds the value;
                                                 each sub-issue stands indented under its parent
  show <id> [--full] [--at-lease]                print one issue as the done gate sees it: the header, What, Why,
                                                 Acceptance and Changelog, every Proof row (numbered [n]) and every
                                                 verdict in the done gate's window, Notes whole, every "changes" finding no later
                                                 approve answered, one line per round that came before; --full prints the whole
                                                 file; --json is complete; under the header, one line for each header
                                                 field that disagrees with the log (see status), where each repository
                                                 written as a name is on this machine and the worktree git has on the
                                                 lease's branch (--json carries them as where)
  brief <ids> [--role worker|reviewer] | brief --role merger [--slice <coordinator>] | brief --slice <coordinator>
                                                 read-only: the text an agent is raised with, assembled from the record,
                                                 which it reads instead of the skill. <ids> are the issues of one lease
                                                 (part of a lease is completed; two leases are refused). A worker's
                                                 brief holds its role, the goal's first paragraph, each parent's
                                                 purpose, the issue with its lines and their methods, the rules that
                                                 reach it, the branch and worktree of the lease, the loop root and the
                                                 tool's absolute path, each command with every known value filled, what
                                                 it reports, and, after a handover, that the tree may be dirty. An
                                                 examiner's (--role reviewer) holds its depth and tier, computed from
                                                 the lines, the six steps, the changes to the lines since the lease, the
                                                 proof as commands to re-run, the Assumed: notes and the previous
                                                 findings, and no other note. A merger's (--role merger; --slice for a
                                                 slice's own merger) is its whole procedure. With --slice alone, a
                                                 slice's coordinator: its issues in play, its rules, its reference and
                                                 its commands. Every part whole, except a finding the issue file has no
                                                 entry for: it shows as the log's line holds it, its first line and a
                                                 count of the lines left out
  set <ids> <status> "<text>" [--branch <worker-branch>] [--worker <name>] [--model <model-id>] [--worktree <path>] [--handover] [--header] --by who
                                                 (<ids> <status-in-the-log> --header rewrites the header fields the log
                                                 renders from the log, writes no log line and is never a move)
                                                 change status; writes the log line in the same move; in-progress
                                                 writes Since, Worker and Model (a lease names who holds it and the
                                                 model it runs on, or restates the one it has) and Branch when
                                                 given — one lease for every id, so a package shares it; a lease holds: under the lock
                                                 it refuses an issue another worker or branch holds and a file or
                                                 resource another lease holds (naming the holder and its slice: tag),
                                                 and, while more than one slice has an issue in play (the issues in
                                                 no slice count as one), a lease on an
                                                 issue that declares no Files or Resources, naming the call that
                                                 declares them,
                                                 and --handover hands a leased issue to a new worker or branch, with
                                                 "<text>" as the reason the worker changed, logged with the move and
                                                 ending the old lease (its Worktree field goes); --model is the model the worker
                                                 was raised on, as the platform names it (with @effort where it has that
                                                 lever), stored as given; --worktree is a check and records nothing: a path
                                                 that exists must be a worktree of a repository of the issue with the
                                                 lease's branch checked out, and the worktree of a lease is found through
                                                 its branch; leaving in-progress removes Worker, Model, Since (and a
                                                 Worktree field a lease holds) and keeps Branch; done notes a merge
                                                 whose CI is not green yet; done asks of each line what its method
                                                 asks: for test, check and compare a row naming it by the holder of the
                                                 lease and one by a name that has not held it, inside one window (rows
                                                 after the last start, reopen or filing), the landing's check for a
                                                 check on the declared command, and for compare two of the holder's rows
                                                 with identical --saw; a live approve for read; the owner's tick for
                                                 owner (see tick). A live approve (with no changes verdict standing, as a
                                                 changes stands until a round or a new commit) and, on an issue whose
                                                 lease records a Branch, a merge recorded (merged) are asked for too
  merged <ids> --sha <sha> [--ran "<command>" --saw "<what-it-printed>" | --red <id>] [--ci pending|green|red|none] [--repo <name-or-path>] [--keep] --by who | <ids> --ci <ci-state> --by who
                                                 the merge as fields: Merged (sha, and where with --repo) and CI
                                                 (only when given; pending: a pushed commit whose CI will report;
                                                 none: no CI to wait for), and a log line. --ran/--saw record the
                                                 check that decided the merge and what it printed, in the merge
                                                 record (the Merge check field and the merge line): never as a Proof
                                                 row, because the merger's check is not the worker's proof (done
                                                 asks the worker for the row; the reply says when none is there).
                                                 --red <id> records a merge that
                                                 landed while its check was red for a cause outside the branch, which
                                                 issue <id> tracks; it is never counted as a passing check, and the
                                                 jarl rules on it first. --ci alone moves the CI of issues already
                                                 merged. After it records a sha it removes the issue's worktree and
                                                 local branch (git worktree remove, git branch -d, never a force)
                                                 when that is safe, and names why it kept them when it is not;
                                                 --keep skips it. It notes, and never refuses, a commit that lacks the
                                                 branch tip or the base (the repository's declared base, else the branch
                                                 its main checkout has open), a squash or rebase merge, and what the commit
                                                 brings into its first parent that starts a conflict marker or is an
                                                 added file over 64 MiB
  next [--limit n] [--all] [--as <who>] [--slice <coordinator>]
                                                 the open issues ready to start: no file shared with an in-progress one, every
                                                 After issue done or dropped (its parent's too), every sub-issue done or
                                                 dropped, no open stuck or stop question on it; a file is
                                                 its repository and its path (see --repo below); one with no acceptance line
                                                 or no declared files is marked; --all adds the others in groups (held by a
                                                 file and by whom, waiting on After, held by a question, the promises and
                                                 the waits, which it never offers), --json rows carry a group;
                                                 --as <who> lists instead what is on the owner, the jarl, a coordinator or
                                                 a person by name now, each line with the command that moves it (it takes
                                                 no --limit): the owner holds the questions and the items to ratify; the
                                                 coordinator of an issue's slice (the jarl, for an issue in no slice) its
                                                 ready issue, its lease, a proof with no verdict and changes asked, the
                                                 proofs of code with no verdict on one line cut into units one fresh
                                                 reviewer takes (the issues of one branch are one unit, named by
                                                 its branch; every other issue alone); the
                                                 holder the goal's Merger line names (else the jarl) an approve not
                                                 merged; a parent whose sub-issues are all done or dropped is its
                                                 coordinator's to check its own acceptance against the whole, a proof
                                                 row done waits for; the jarl the close, and a ruling that
                                                 settles issues none of which is live; an acceptance line only the owner
                                                 ticks is the jarl's (its worker producing it) until its material is
                                                 there, then the owner's, with the material and what to check (with no slice in the loop, a
                                                 coordinator's lines are the jarl's); a promise is on whoever its Found by
                                                 names, and a wait on its Person, with when to check, until what was
                                                 waited for is recorded, then on the jarl; derived from the profile's status
                                                 flags, the verdicts, the questions and the rulings; at most seven lines,
                                                 the owner's first, then by how many issues each holds up, then how many
                                                 more; --all every line and the issues waiting on that one, "waits on X
                                                 via N"; --slice <coordinator> offers only the
                                                 issues of that coordinator's slice: across slices only leases hold, and
                                                 an open issue reserves its files against the issues of its own slice
  review <ids> <verdict> --by <reviewer> --model <model-id> [--relayed] [--bot] [--artifact <path>] [--outside "<finding-outside-the-issue>"]... [--field "<name=value>"]... "<text>"
                                                 the reviewer's verdict; --model is the model the reviewer was raised on
                                                 (stored as given); --artifact is the render or file the verdict judged:
                                                 the value is a relative path inside the repository the work is in,
                                                 written in plain characters: letters and digits with their marks, spaces
                                                 and . _ - + @ # , = ( ) [ ], a $ only between two letters or digits, a %
                                                 only where it is neither first in a segment nor before two hex digits,
                                                 and / or \\ between segments; no segment is empty, ends with a dot or a
                                                 space (but for the ./ the value may open with) or is a device name of
                                                 Windows (CON, PRN, AUX, NUL, or COM or LPT with one of 0 to 9, ¹, ², ³,
                                                 with any spaces and extension after it); the value never opens with a
                                                 dash, holds at most 260 characters, reads the same after Unicode
                                                 normalization (NFC) and holds no letter, digit or mark whose NFKC form
                                                 holds anything but letters, digits and marks; any other character (a
                                                 colon, a quote, a ~ or a !, a control, format or invisible character,
                                                 another space) is refused; it is stored as given, trimmed of the spaces
                                                 around it; show prints it with the verdict and report counts it; it
                                                 gates nothing; --relayed
                                                 marks a verdict recorded by someone else in
                                                 the reviewer's name, for a reviewer that cannot be resumed to record its
                                                 own; --bot records it as the verdict of the bot --by names; --outside (repeatable) is a finding outside the issue: each is
                                                 filed as a new issue, Found by the reviewer and Where the review, and
                                                 never turns the verdict to changes, so changes whose only Critical or
                                                 Important findings are outside is refused; --field (repeatable) is a
                                                 field the profile declares, on each issue --outside files; every finding
                                                 passes the filing's checks before anything is written; --by is required, recorded with its kind
                                                 (self for "self" or anyone who has held the issue's lease, across
                                                 takeovers, or the lease of another issue on its Branch — refused on an approve;
                                                 coordinator for coordinator, jarl, reeve, the loop's own name and
                                                 names on a "Coordinators:" line in goal.md; bot for --bot and a bot the
                                                 profile's done gate names; fresh for anyone else);
                                                 "done" needs an approve inside the gate's window, and a
                                                 fresh one when the issue carries code (a Branch or Merged field), or
                                                 the approves the profile's done gate "clears" names (a bot's approve
                                                 clears only there), and the worker's Proof row; an approve on an issue with no Proof row says so;
                                                 findings need at least three words; a verdict is taken back with retract;
                                                 a verdict on several ids is one review: each of its lines carries one
                                                 batch id
  round <ids> "<text>" [--findings <n>] --by who
                                                 one red round on each, with the count of findings it left if given; every third round,
                                                 or every n-th where the goal's "Takeover (<kind>): <n>" line for the issue's kind
                                                 or its bare "Takeover: <n>" line says so, prints the takeover block for a fresh
                                                 worker: a tier up, another model or a changed approach. The limit is read from the
                                                 goal at each round and the rounds are counted from the last takeover, so a changed
                                                 limit takes effect at the next round
  tick <id> <line-number> --by owner             the owner's tick of an acceptance line only he ticks, by its number among
                                                 the issue's acceptance lines: a line written "[owner] <line> · material:
                                                 <material> · check: <what-to-check>" (new and field refuse a
                                                 line so marked that names no material or nothing to check); done refuses while such a line is
                                                 not ticked; tick refuses a name other than the owner's, and a line whose
                                                 material is not there yet: no --ran/--saw row after the work was started or
                                                 sent back, or, for a path, no file under the loop's root, the issue's
                                                 repositories or its worktree; it writes one log line that holds the line
                                                 as written, so a line rewritten after it waits for a new tick, and a red
                                                 round, a start or a reopen spends it as it spends an approve
  models [--group repo|tag] [--with <loop-root>]... [--archives]
                                                 read-only: per model as worker and as reviewer, per Kind · Tier, what the
                                                 record holds (units, clean first passes, changes, rounds, verdicts, checked
                                                 approves), every count with its n and a share only from n >= 5, with the
                                                 words fits, below, new and may clear; work with no recorded model
                                                 is grouped by tier; --group slices by repository or tag; --with reads another
                                                 loop (its root, or an archive directory) and --archives this loop's own
                                                 archives, merged into one table that names the loops it read; a path that
                                                 is not a loop is refused; suggestions only, no lock, nothing written
  scope [<id>] --branch <worker-branch> [--base <base-branch>] [--repo <name-or-path>]
                                                 commits beyond the base, diff inside the declared files, and the
                                                 change in test files and assertions — numbers, never a verdict;
                                                 notes for the added lines that name a loop issue by its number after
                                                 the word issue or with a hash sign, the added lines that start a
                                                 conflict marker, and the added files over 64 MiB, the largest file
                                                 Jarl accepts as an attachment (at most 20 printed, the rest
                                                 counted), which never change ok; a branch no issue records is refused
                                                 with its commit count;
                                                 read in --repo, else the issue's Repo, else the loop's own repository;
                                                 with no id, the diff is bounded by the union of Files of every issue
                                                 that records that branch (a package on one branch, one call)
  branches [--base <base-branch>] [--repo <name-or-path>] [--stale-hours n]
                                                 every jarl/7-* branch and every branch an issue records: the
                                                 issues on it, commits beyond the base, worktree state, STALE leases
                                                 (worktree gone, branch gone, idle: no commit, row, log line or change in its worktree for the
                                                 goal's "Liveness: <minutes>", default 30, or n hours) and
                                                 DONE → delete, NO ISSUE for commits no issue holds; shown only, never
                                                 acted on; read in --repo alone, else in the loop's own
                                                 repository, every repository an open or in-progress issue
                                                 names and every one where an issue not dropped records a Branch
  ask "<text>" [--kind stop|stuck|lower|charter|ratify|escalation|rule] [--target x] [--issue 7] [--slice <coordinator>] [--option "<label:effect>"]... [--applies-to "<selectors>" [--until <date-or-id>] [--to owner]] --by who
                                                 a question the owner has to answer, of kind stuck unless --kind says otherwise; lower needs --target; stuck with
                                                 --issue and --by the holder of its lease goes up instead, to the
                                                 director of the issue's slice (the jarl with no slice), and to the
                                                 owner when the asker is the director;
                                                 escalation is a coordinator's question to the jarl, who holds it:
                                                 it names its --slice or its --issue (or both), shows on next --as
                                                 jarl and in that slice's views, holds its issue back as stuck does,
                                                 and is answered by the jarl (answer a-<n> "<text>" --by jarl);
                                                 listed at boot until answered; ratify is a choice already made
                                                 under a mandate, awaiting the owner's word, and blocks nothing:
                                                 its answer starts with yes or reject (ok, tak, nie, … as the
                                                 refusal lists them), and any other is refused;
                                                 rule proposes the question's text as a rule with the scope of
                                                 --applies-to (as decide takes it), held by the jarl, or by the owner
                                                 with --to owner, and answered yes, which makes it a rule in force, or reject;
                                                 --option gives the choices, at least two, repeated for each one:
                                                 the question prints with its options for the choice window
  answer <ids> "<text>" --by <who> | <ids> --option <option> --by <who>
                                                 records the answer as a ruling and closes the question: the option
                                                 chosen, marked in the ruling's list of options, or the answer in the
                                                 person's own words; --by, which every answer takes, records who answered (owner
                                                 for the owner, jarl on an escalation), and on a ratify item is owner,
                                                 whose item it is;
                                                 several ratify items as a comma list take one answer, one ruling each,
                                                 each naming the batch it was answered in; on a ratify item whose
                                                 ruling names a rule, the rule's ratification names the owner
  resume [--log n] [--ready n] [--gh] [--repo <name-or-path>] [--base <base-branch>] [--as <who>] [--slice <coordinator>]
                                                 read-only, the boot: everything a session picks the loop up from,
                                                 assembled live — goal and counts, rulings in force, in flight with
                                                 leases (and stale ones), waiting on After, questions, ratify items,
                                                 the next ready issues (n, default 10), the merge queue (the branches
                                                 waiting for the merger — an open or in-progress issue on it holds a
                                                 live approve and the branch is ahead of its base — in the order they
                                                 were approved, per repository, cut into batches whose declared files
                                                 do not overlap; it runs no check and refuses nothing), merges with
                                                 CI pending or red, the tips (per repository the issues name, open, in
                                                 progress or recently merged: each worker branch in flight, the
                                                 feature branch the checkout is on and main, ahead/behind their
                                                 upstream as last fetched, and the recent merges with their CI), loop
                                                 files not committed, and the last log lines (n, default 15); nothing
                                                 is fetched, and no network unless --gh asks gh for the CI of each
                                                 tip its upstream holds (else "not pushed"); --repo narrows the merge
                                                 queue and the tips to one repository, and --base replaces the
                                                 checkout's current branch as the merge queue's base;
                                                 --as <who> ends it with what next --as <who> prints; --slice
                                                 <coordinator> keeps in flight, waiting, the questions, held and next
                                                 ready to that coordinator's slice, and the rulings, the merge queue,
                                                 the tips and the log whole
  log "<text>" --by who                       append one dated note to the journal; a line that reads as a filing, a move,
                                                 a round, a verdict, a retraction, an evidence row, a merge, a CI state or
                                                 a body change is refused, and the refusal names the command that writes it
  decide <slug> "<text>" --by <who> [--quote "<his-own-words>"] [--under <slug>] [--supersedes <slug>[,<slug>...]] [--settles <ids>] [--waives-review <ids>] [--applies-to "<selectors>" [--until <date-or-id>]] [--area <type> [--reach n] [--rule <id>]]
                                                 append a ruling (slug: letters, digits, . _ -); refuses a duplicate slug;
                                                 --by, which every ruling takes, records who ruled (jarl for a choice
                                                 made under a mandate; a name that reads as owner is owner); --by owner needs --quote, his own words, kept as
                                                 the ruling's last line, and no other text of the record may hold
                                                 "The owner's words:" in the spellings Jarl reads (case, accents, look-alike
                                                 letters, hidden characters, other quotation marks, HTML and Markdown marks); --under names the ruling in force a ruling
                                                 by the jarl or a coordinator rests on, kept as the text's last paragraph
                                                 "Made under: <slug>", shown with the ruling by decisions and with a rule by the views; --supersedes marks
                                                 each ruling it replaces (one slug, a comma list, or the flag repeated)
                                                 "Superseded by" in place, all in one write or none; --settles writes the ruling,
                                                 with who ruled, into each named issue's evidence (its status is unchanged);
                                                 --waives-review, on a ruling by the owner alone, closes the named
                                                 issues without a review: done and the merge queue take it for the
                                                 approve until a round, a reopen or a new commit spends it; a ruling with no
                                                 --applies-to is a record that reaches no reader, and decide says so when its
                                                 words read as an instruction; --applies-to makes it
                                                 a rule with a scope, printed whole to every reader it matches: loop, or
                                                 selectors joined by "and" (role, slice, moment, issue, tag, kind, tier,
                                                 files, repo, each with one value); --until ends it after a date or when
                                                 an issue closes, and a ruling that supersedes it revokes it; --area marks a ruling
                                                 about a whole type of code, --reach how many files that type holds,
                                                 --rule the graph's rule it admits on that type (its id):
                                                 close puts it to the owner for ratification
  decisions [--live] [--as <role>]               the rulings with who ruled and what superseded them; --live only
                                                 those still in force; --as <role> only the rules that reach that role
                                                 (a rule scoped to an issue, a moment or a slice is kept, because it
                                                 reaches the role on the work it matches)
  goal                                           the goal as goal.md holds it
  goal --set "<machine-line>" --by who         one machine line of the goal set, with a log line that says what it
                                                 was and what it is: "Check (<name>): <command>" or a bare
                                                 "Check: <command>", "Model (<tier>): <model-id>" (a tier the profile
                                                 declares), "Coordinators: <names>" (each name a coordinator, which runs the slice of
                                                 the issues tagged slice:<name>), "Merger: <name>" (the jarl or one
                                                 coordinator: the one holder that raises the merger of the feature branch),
                                                 "Merger (<coordinator>): <name>" (a slice's own merger, in a worktree of its own, landing
                                                 the slice's work on its integration branch jarl/slice-<coordinator>, which then lands on the
                                                 feature branch as a merge with its check), "Takeover (<kind>): <rounds>" or a bare "Takeover: <rounds>",
                                                 "Liveness: <minutes>" (a lease or a proof with no commit, row, log line or change in its worktree
                                                 for longer is idle, on its coordinator's list; default 30, and
                                                 --stale-hours overrides it for one call), "Range (<name>): <from-to>" (the
                                                 numbers new --range <name> files under: no two ranges share a number, and a
                                                 range keeps the numbers it holds and takes in none filed outside it); the
                                                 rest of goal.md stays as written
  status [--stale-hours n] [--group repo|tag|kind|prio|<name>] [--tag <tag>] [--as <who>] [--slice <coordinator>]
                                                 --tag computes every part of status over the issues carrying that tag only;
                                                 --slice the same over one coordinator's slice (the issues tagged
                                                 slice:<coordinator>), with the questions on them and the escalations
                                                 that name the slice;
                                                 --as <who> ends it with what next --as <who> prints;
                                                 once an issue carries a slice: tag, one line names each coordinator
                                                 with its slice and how many of its issues are in play, and a slice
                                                 whose coordinator the Coordinators line does not name;
                                                 the log is the record of an issue's status, lease, merge and CI; a header
                                                 that disagrees is never believed, and status prints one "record:" line
                                                 for it, with how to write the header back or make it the record (resume
                                                 and show print it too; --json carries disagreements when there are any)
                                                 the goal, when the loop opened and last moved,
                                                 then one line: open, in flight, waiting, done, dropped, deferred,
                                                 open questions, to ratify, merged with CI pending or red; then who
                                                 reviewed the done work (fresh, coordinator, self, unrecorded, and
                                                 relayed and bot verdicts apart from fresh ones); then,
                                                 per repository, "k of n merges carry the declared check" (a merge
                                                 carries it when its --ran text equals a command a Check line of
                                                 goal.md declares), the testimony mark for a repository that declares
                                                 none and while no merge carries the declared check; then the choices awaiting ratification, stale
                                                 leases, the issues in flight with no acceptance line, and —
                                                 committed loops — the loop files
                                                 git has not committed; --group adds the status counts per
                                                 repository, tag, kind, priority or a field the profile declares; --group repo
                                                 also prints where each repository is on this machine, its base and
                                                 whether its checkout is on it
  archive "<slug>" --by who                    put the current loop away under .jarl/archive/yyyy.mm.dd-<slug>/,
                                                 keeping the archive, the mode markers and .jarl/templates/, so init
                                                 can open a new loop here in the same mode; refused under a profile
                                                 whose "lifecycle" keeps archive to the record (it names the command)
  report [--found] [--metrics]                   the loop metrics first (cycle time, rounds, reopenings, the share of fresh
                                                 reviews, red CI after merge, follow-ups within 7 days, the batched reviews
                                                 with their sizes and the rounds after each, the verdicts that name an
                                                 artifact where there are any — "no data" where the
                                                 record holds none) and the landing banner, per repository "k of n merges carry
                                                 the declared check", with the testimony mark as status shows it; then what was
                                                 done (per repository when it spans several), who reviewed it, dropped, deferred
                                                 and still open — ready for the changelog; --found adds the issues found by
                                                 someone other than the jarl; --metrics prints the heading, the goal and the
                                                 metrics alone; --json also carries one row per issue and the metrics (see
                                                 references/commands.md, "Loop metrics")
  changelog <ids> [--repo <name-or-path>]           print the issues' ## Changelog entries grouped by section (Added,
                                                 Changed, Deprecated, Removed, Fixed, Security), ready to paste under
                                                 [Unreleased]; per repository when they span several; reads only
  mode permanent --by who                      switch an existing committed loop to the permanent mode, with a
                                                 log line; refuses a default-mode loop (out of git — a permanent
                                                 record must be committed) and an already-permanent one
  profile [<profile.json>]                       read-only: the loop's profile — its statuses and what each one means
                                                 (dispatchable, lease, settles-dependents, terminal, closes-record,
                                                 needs-reason), the status a new issue starts in, the values of Kind and
                                                 Tier, the fields and sections its issues carry and the heading of their
                                                 acceptance; the
                                                 built-in one when the loop has none; with a file, that file checked
                                                 against the profile schema instead; a profile's "models" names the
                                                 strongest model the loop may use ("ceiling", read by its tier) and the
                                                 ones it may not ("barred"): the owner's lever for cost, as Jarl reads
                                                 no usage or budget from the host; next, the takeover and the notes of the
                                                 fresh-review rule keep under it, and profile refuses a model no Model
                                                 line of the goal places
  extend section "<name>" --by who | extend field "<name>" [--values "<items>"] [--default "<value>"] [--required] --by who
                                                 add one section or one field to the profile of a live loop (a loop
                                                 with none gets one, with the built-in statuses), checked as profile
                                                 <profile.json> checks a file, with a log line; the issues already filed
                                                 are not rewritten and carry the part once field writes it, a new issue
                                                 is filed with it (a field's default when none is given); refused in a
                                                 loop whose profile keeps its lifecycle to the record
  use [<path>]                                   read-only: with no path, the loops under this checkout, found by a walk
                                                 at most 4 levels down that enters no hidden directory, no node_modules
                                                 or vendor, and no other checkout (a worktree, a submodule); with a path
                                                 (as the list prints it, or absolute), the loop the calls that follow
                                                 reach when they name none: a tool session keeps it until use names
                                                 another, and the command line, which keeps nothing between runs, prints
                                                 the JARL_ROOT setting to export for each shell
  verify                                         read-only, with no lock and no network: the record read strictly. Each
                                                 reader lists the lines it does not place (the log, the goal, the issue
                                                 headers, the questions and the rulings), the profile is checked, a
                                                 retraction must point at an entry the log holds, a header
                                                 that disagrees with the log is listed, each declared repository is
                                                 checked by name and root commits, each worktree a lease holds belongs
                                                 to a repository its issue names, and an open issue that cites a
                                                 superseded ruling is listed; prints each check with its first findings,
                                                 and exits 2 when it finds something
  close [--force] [--batch] --by who           refuse while anything is open or in progress, and, where it removes .jarl/,
                                                 while anything is deferred (the refusal names archive "<slug>", which
                                                 keeps the loop under .jarl/archive/, and --force, which removes the
                                                 loop with its open and deferred issues, keeping no copy); else remove the live
                                                 loop (in the default mode close and init leave .jarl/archive/ in place;
                                                 in the committed mode close refuses while it holds anything, naming it —
                                                 move it out of the tree, or --force removes it with the loop)
                                                 — a permanent loop (see init --permanent, or mode permanent) is
                                                 kept instead: it logs the close and the directory stays as the record;
                                                 first it files the ratification batch — at most 10 area rulings, widest
                                                 reach first, each a ratify item answered yes or reject — and never waits
                                                 for it, and offers each rule of the loop with a scope for promotion,
                                                 a question on the owner answered --option carry, instructions, law or
                                                 drop; --batch files the batch only and closes nothing; a ratified
                                                 area ruling is written into the type's decision log (yg log add
                                                 --type) when the repository has a graph and a working yg, and one
                                                 naming a rule also ratifies it (yg log add --aspect --ratify);
                                                 refused under a profile whose "lifecycle" keeps close to the record

options: --json  --help  --root <loop-root>   (the directory holding .jarl/; without it JARL_ROOT, an absolute path,
         else the loop at the root of the current checkout, or of its main checkout from a worktree: never one in a
         subdirectory; a note names the loops below it, and where the root holds none and loops are below, a call
         that names none is refused with their list, init, use and profile with a file excepted)

The list of what only the command line does, next to the record library, is in the skill's references, in the section "What only the command line does".

git merges (not loop commands: no --root, no lock, no tool of the MCP server):
  merge-driver decisions %O %A %B                the driver git runs for .jarl/decisions.md (%O %A %B): the rulings of
                                                 both sides block by block, written over ours (%A), exit 0; conflict
                                                 markers and exit 1 for a ruling both sides superseded, a slug both
                                                 sides added, a ruling both sides rewrote; .jarl/log.md merges by union
  merge-driver flags [--yg "<command>"]          the -c settings a merger puts between git and merge on every merge,
                                                 so the drivers run whatever the clone holds: the decisions driver, and
                                                 with --yg Yggdrasil's log and lock drivers too

<ids> (field, round, evidence, review, set, merged, changelog): one id, or several as one comma list with ranges — 12,13,14 or
203-206,209. Every id and every precondition is checked before anything is written, so the call lands on
all of them or on none, with one log line per issue.

An issue number is a plain number: 7, 195, 1000. A number written with leading zeros (007) or with a # (#7) is the
same issue as 7. Questions are numbered the same way (a-7, a-1000). Numbers are compared as numbers, so 999 comes
before 1000.

Flags: a flag the command does not take is an error. A value flag takes the next argument whatever it
starts with (--ran "--help" records a row), or inline as --flag=value. A bare -- ends the flags: put a
note or a title that starts with -- after it, and every flag (--root too) before it. Words beyond what a
command reads are an error.

Refusals: a refused call writes nothing. It says what is wrong, naming the word of the call that is, and its last
line is the form of the command that does what was meant, a placeholder in angle brackets for each value only the
caller knows: fill the values and run it, never paste it as printed (pasted as printed, it is refused for its
placeholder). A step to take first is a command on its own line. The form keeps the call's --root and --json as
given, wherever the call wrote them, and holds every flag the command needs; every other command Jarl prints, in a
reason, a note or a view, carries the call's --root. The commands Jarl prints are written for a POSIX shell (sh, bash,
zsh) on macOS and Linux, and on Windows for PowerShell and cmd, whose double quotes Git Bash reads alike but for a
path that starts with two backslashes, which it reads with one; each word is quoted for that shell and each
placeholder is in double quotes; a word that shell cannot carry as it is stands as its placeholder, and the reason
says why; replace every "<placeholder>" before running one. A value that is one of Jarl's placeholders is refused
wherever a value is taken, so it is never recorded; any other text in angle brackets is a value.

Lists (the <ids> above; new's --tags, --files, --repo, --source, --after; import's --tags, --repo, --only;
decide's --settles and --waives-review; the value field gives Tags, Files, Repo, After and Source): one item, or several as one
comma list (a,b); a list flag also repeats; a tool takes the same text or a list of strings, one item each.
An item that starts with - is refused (it is a flag in the wrong place). A list written as text is refused:
an item that begins or ends with a quote mark, a name (an id, a tag, a reference, a finding id) that holds
a bracket or a quote, and a path whose brackets do not pair up ([a, b]) or that is a quoted or empty list
in brackets (["a"], []). A path whose brackets pair up is a name: [1], src/[id]/page.tsx, [...slug].

--by who is required on every command that writes, and is written into every log line the call writes, right after the
stamp ("- yyyy-mm-dd hh:mm by <who> · ..."); on field and split it is also who changed the description, on review the
reviewer, on answer, decide, retract and tick who answered, ruled, retracted or ticked. A write with no --by is refused:
every write says who made it, and the name is never read from a server, a variable or another call. A lease and a verdict
name their model with --model, a lease its worker with --worker. Grouping is --group (status, models), and --kind is the
kind of what a command files or filters.

Writes: every command that writes holds .jarl/.lock while it runs (the holder's pid, host and time are
inside), so parallel calls from workers, reviewers and the merger queue instead of losing each other's
writes; a lock whose holder is gone is taken over, a live one that does not let go within 20 s fails the
call with nothing written. Files are replaced whole, never half-written.

--repo <name-or-path>: another repository, for a loop that keeps its issues in one repository while its
workers change another: its name (the directory git clone gives it), its checkout, a worktree of it or a
file inside it, always reduced to its main checkout. Branches, the base (that checkout's current
branch), diffs and assertions are then read there. A name resolves to the sibling of the loop's main
checkout (beside it, under its name); on a machine laid out differently, a symlink beside the loop's checkout
puts it there. The Repo field stores the name where the checkout sits at that place, and the path
otherwise (a note on stderr says why); a path is read from the loop's root, so it means the same from
any worktree. A name needs no path in the record: Jarl declares it once in .jarl/repos.md, with the
repository's root commits, its origin as found and its base branch. A Repo value that starts with . or / (or a drive
letter) is a path and anything else a name. An issue that names a repository writes each of its files with that repository's directory
name first (tool/src/a.mjs for Repo tool): next then keeps the same path in two repositories apart,
and scope matches the path after the name. An issue may name several repositories (Repo: tool, lib):
each file then starts with the name of the one it is in (one with no such name is in the first), and
scope on it takes --repo to say which one to read. show and status --group repo print where each
repository, and the worktree of a lease, is on this machine; nothing resolved is written.

views, one purpose each (read-only; resume, the boot, prints the parts of several of them):
  resume      everything a session picks the loop up from, read live, the merge queue and the tips included
  status      where the loop stands, in counts
  next        what can start now; with --as, what is on one holder and the command that moves it
  list        the issues, filtered
  show        one issue as the done gate sees it
  brief       what a worker, a reviewer or a coordinator is raised with
  decisions   the rulings and what superseded them
  report      what was done, with the loop metrics
  changelog   the changelog entries of issues
  sources     a research report's findings against the issues filed from them
  branches    every worker branch with its issues and its state
  scope       one worker branch measured against its issues' files
  models      what the record says of each model as worker and reviewer
  profile     the loop's profile, or a profile file checked
  verify      the record read strictly, for what its readers do not place
  use         the loops under this checkout, or the one the calls that follow reach

Parallel workers in worktrees:
  - Default mode: the loop is out of git and lives in the loop root (the directory that holds .jarl/), so every call, a worker's and the coordinator's, passes --root <loop-root>.
  - Committed mode: the merger alone commits .jarl/, and a worker never does.
  - Filing: the coordinator files the issues; a worker reports what it found, or files with --root <loop-root>.
  - Lease: an issue in progress is held by a worker, whose name, branch and start the lease records.
  - Finished work: list hides finished and deferred work; --all shows every status, and --tag, --status, --prio and --grep filter by tag, status, priority and text.`;
