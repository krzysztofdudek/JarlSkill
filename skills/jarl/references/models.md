# Which model sits where

The tiers, the model lines of a loop, how each platform maps them, how a spawn records its model, and what `models` derives from the record. Read it before raising any agent, and when a loop's model lines or a `models` table is in question.

## Contents

- [Which model sits where](#which-model-sits-where): the rule, and who runs the loop
- [The tiers, and when each fits](#the-tiers-and-when-each-fits)
- [The loop's models](#the-loops-models)
- [How each platform maps the tiers](#how-each-platform-maps-the-tiers)
- [Effort is the second lever](#effort-is-the-second-lever)
- [Recording](#recording)
- [The approve that clears an issue](#the-approve-that-clears-an-issue)
- [How a new model enters](#how-a-new-model-enters)
- [Relaying a verdict](#relaying-a-verdict)
- [What models shows](#what-models-shows)

## Which model sits where

Every spawn names its model explicitly and never inherits the coordinator's model: a spawn that carries none runs on whatever the session runs, which puts a clerk's task on the strongest model or a design on the weakest, and the record cannot tell which. Any provider's model is allowed; Jarl keeps no list of models and refuses none. It records which model did which kind of work, derives from the record how often that work passed without changes, and suggests; it never reroutes anything.

Opening the loop — reading the repository whole, writing the goal, the first rulings and the first
issues — is the one part that needs the strongest model in the room. The loop itself is clerical
work over a tool that refuses what is wrong: the reeve, on the standard tier, runs it, hands out
issues, reads reports and keeps the journal, and hands back to the jarl only on the four occasions
named in [The reeve](jarl.md#the-reeve-handing-the-loop-down). Workers, readers, reviewers and the merger run on the standard tier unless an
issue's own `Tier:` says otherwise. Say which tier is running in every report.

## The tiers, and when each fits

The built-in tiers are `light`, `standard` and `strong`, weakest first; `standard` is the default, and a profile that declares its own tiers keeps their order. The criteria are a prior that the measurements below refine:

- `light`: a check or a test decides whether the work is right, the scope is written down, and nothing that protects changes — a mechanical edit, a filing from notes, a read-only inquiry, a first-pass review.
- `standard`: a clear acceptance and a known place in the code — ordinary code, tests and documents.
- `strong`: the cause is unknown (a flaky test included: it is often a real defect), a design, a record format or a contract, security or data integrity, anything that weakens or changes a protection, a takeover after three rounds, finishing another worker's uncommitted work.

`new` without `--tier` records `standard` and says so on stderr (the command line only), with these criteria in a few words. The takeover block that the third `round` prints says to raise the fresh worker one tier up, or on another model than the one that failed, which the lease names.

## The loop's models

A loop says which models it runs on, per tier, in `goal.md`: one line per tier, `Model (strong): <model>[, <model>…]`, in the same forms as `Check:` (a plain line, a list item, or bold). The first model on a line is the tier's default, the one raised unless a suggestion says otherwise; the other models are in the pool at that rank. The order of the tiers is the order of strength, so it ranks the models, the same id at another effort sitting where the id sits. A model on no line is unplaced: it may run, since nothing is refused, but its rank is unknown and as a reviewer it ranks below every placed model. A rule, a brief or this skill never names a model: the lines do, because ids go stale within weeks. The person who owns the loop edits them, or the jarl under a mandate with a ratify item; nothing moves by itself.

## How each platform maps the tiers

The levers, not the names (families are examples, never a rule). In Claude Code the Agent tool takes a `model` (an alias such as the family name resolves to an id: record the id) and an `effort`; the families run by size from small to large. In OpenAI's Codex a run takes a model and a reasoning effort; the families run from the mini through the standard to the largest reasoning model. On any other host, use whatever its picker allows per agent. A host that cannot choose a model per spawn runs every agent on the session's model: record it all the same. The note on an approve by the worker's own model then fires every time, which is the truth about that loop: a fresh instance is still a fresh reviewer, and the correlation risk is real and visible.

## Effort is the second lever

For an issue that is hard but clear, a higher effort on the same model is a cheaper step than a higher tier. The recorded value is the model id with `@<effort>` where the platform has the lever (`<model id>@high`), so the same model at two efforts is two workers with two records. Record the resolved id, never a moving alias: an alias would silently merge two models' records after a release.

## Recording

The one who spawns an agent knows the model it asked for; the agent often cannot name itself reliably. So the coordinator passes `--model` on the lease it writes before raising a worker (`set <ids> in-progress "<why>" --branch <b> --worker <name> --model <m>`), and writes the reviewer's model into the reviewer's brief, whose recording command carries it (`review <id> approve|changes --by <name> --model <the model you were raised on> "<findings>"`). In a loop with model lines, a lease or a verdict without `--model` is noted on stderr, never refused.

## The approve that clears an issue

The approve that clears an issue is never of the worker's own model and never ranked below it, until `models` shows `may clear <kind>` for that kind of issue. A lighter or same-model reviewer that adds a `changes` before the clearing approve is welcome: a cheap first reading that finds something saves a round. A breach is a note on the verdict and a count in `models`, never a refusal; the done gate and the fresh-review rule stand as they are.

## How a new model enters

It is raised with an explicit `--model` and is unplaced and new. It starts on small issues (light, or standard with a clear acceptance), and the approve that clears its work comes from a placed model of at least the issue's tier. As a reviewer it starts first, beside a placed reviewer that clears. After five reviewed units in a kind, `models` says `fits` or `below` against the kind's own baseline; after five approves that a reviewer able to clear then checked, with no miss, it says `may clear <kind>`. When a model fits a kind at a tier, `models` suggests adding it to that tier's line.

## Relaying a verdict

A reviewer records its own verdict. A reviewer that came back without recording it is resumed to record it. `review --relayed` is for the one case that cannot cover, a reviewer that cannot be resumed (its session ended, an outside interruption): the coordinator records the verdict the reviewer gave, from its report, and marks it. It still counts as the reviewer's standing, because the reviewer did review; the mark makes the second-hand provenance true and makes the reviewer model's slip countable.

## What models shows

Per model, as worker and as reviewer, per kind of issue (`Kind · Tier`; both fields are on every issue and are closed sets, so the cells are few and comparable; repository and tags are slices with `--by`). As a worker, a unit is one lease: one worker on one branch, which is one issue or one package, and a takeover starts a new unit. Per cell: the units settled and reviewed, the clean first pass (every issue of the unit closed with no `changes` verdict and no round), changes, rounds, red after approve, handed over, units that ended before any review (kept out of the clean share's n, because an outside interruption is not a quality signal), units whose proof was recorded as evidence rows before the first review, and follow-ups. As a reviewer: verdicts, changes, approves checked by a later reviewer of another model, misses (the later verdict was `changes`, or a round or a reopen followed the approve), relayed verdicts and clearing approves on the worker's own or a lower-ranked model. Every count carries its n and a share appears only from n ≥ 5; below that the view prints counts and no word. `fits` is a clean share at least the kind's baseline (all units of that kind in the loop), `below` the opposite, `new` a model under five units in every kind, `may clear <kind>` a reviewer on the worker's own or a lower model with five approves of that kind checked afterwards by a reviewer able to clear and no miss among them. Below five units in a cell the view also gives the model's numbers across the kinds of that tier. Work whose lease or verdict carries no model is grouped `(not recorded) · tier <t>`. Two biases are named: a model is measured only on the work it was given, so compare inside a kind; and a worker's clean share is as strict as its reviewers, so compare inside one review practice. Not derived: whether a finding was right, cost, and every slip that never reaches the record (a report sent before the check finished, a forbidden command form) — the cure for those is the brief. On `next` and `resume`, a ready issue of a loop with model lines shows the tier's default model, and `suggest <model>` when a lower-ranked placed model fits that kind of issue while the default does no better there. A wrong suggestion costs a round, never a defect: the review and the repository's check still stand in front of every landing.
