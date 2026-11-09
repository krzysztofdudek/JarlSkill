# Which model sits where

The tiers, the model lines of a loop, recording a model and what `models` derives. Read it when a model question comes up. Terms: [glossary.md](glossary.md).

## Contents

- [Which model sits where](#which-model-sits-where)
- [The tiers](#the-tiers)
- [The loop's models](#the-loops-models)
- [Recording](#recording)
- [The approve that clears an issue](#the-approve-that-clears-an-issue)
- [A new model](#a-new-model)
- [What models shows](#what-models-shows)

## Which model sits where

Every spawn names its model explicitly and never inherits it: a spawn that carries none runs on whatever the session runs, and the record cannot tell which. Any provider's model is allowed; Jarl keeps no list and refuses none. Opening the loop needs the strongest model in the room. Directing a loop is clerical work over a tool that refuses what is wrong, so coordinators run on the standard tier (see [Coordinators](jarl.md#coordinators-slices-of-the-backlog)). Workers start on the tier the issue's `Tier:` names, and a takeover offers a tier up, another model or a changed approach. The reviewer whose approve clears the issue is never of the worker's own model and never ranked below the worker's model, every model that has held the issue's lease, and not the issue's tier. Readers and the merger run on the standard tier. A lone agent holds every role but the examiner's, the merger's included, on the model it runs on.

## The tiers

`light`, `standard` and `strong`, weakest first; `standard` is the default, and a profile that declares its own tiers keeps their order. `light`: a check or test decides, the scope is written down, nothing protective changes. `standard`: a clear acceptance and a known place in the code. `strong`: an unknown cause, a design, a record format or contract, security, anything that weakens a protection, a takeover.

## The loop's models

One line per tier in `goal.md`: `Model (strong): <model-id>[, <model-id>…]`. The first model on a line is the tier's default, the others in the pool at that rank, and the order of the tiers ranks the models. A model on no line is unplaced: it may run, its rank is unknown, and as a reviewer it ranks below every placed model. A rule or brief never names a model: the lines do, because ids go stale within weeks.

A profile's `"models": { "ceiling": "<model-id>", "barred": ["<model-id>"] }` is the owner's lever for cost: the strongest model the loop may use and the models it may not use. Jarl refuses no lease or verdict for these; it records a note, and `next`, `resume`, the takeover and the reviewer note keep under them, and say so when the review the rule needs is beyond what the profile allows.

The levers, not the names: pick a model per spawn wherever the host allows it and record the resolved id, never a moving alias; a host that cannot choose runs every agent on the session's model, recorded all the same. A higher effort on the same model is a cheaper step than a higher tier: recorded as `<model-id>@<effort>`, so the two are two records.

## Recording

The one who spawns an agent knows the model it asked for, so the director passes `--model` on the lease (`set <ids> in-progress "<text>" --branch <worker-branch> --worker <name> --model <model-id>`) and writes the reviewer's model into its brief (`review <id> <verdict> --by <name> --model <model-id> "<text>"`). `--model` is required on both.

## The approve that clears an issue

It is the profile's done gate's `"reviewer"`. By default (`"agent"`) it is the approve of an agent other than the worker, whatever its model; the model counts as advice: the better approve is never of the worker's own model and never ranked below the worker's model (every model that has held the issue's lease, whatever the issue's tier), and an approve that is not is accepted by `done` with a note that says so. `"other-model"` makes the first half a gate, `"model-rank"` the second. The owner's live waiver of the review clears the issue either way ([The owner's waiver of review](profile.md#the-owners-waiver-of-review)).

## A new model

It is raised with an explicit `--model` on small issues, and the approve that clears its work comes from a placed model at least as high as the model that did the work. After five reviewed units in a kind `models` says `fits` or `below` against that kind's baseline, and after five approves checked by a reviewer able to clear, `may clear <kind>`. A verdict recorded for a reviewer that cannot be resumed is `review --relayed`, and it counts, marked.

## What models shows

Per model, as worker and as reviewer, per kind of issue (`Kind · Tier`; `--group repo|tag` slices it), the clean first passes, changes, rounds and follow-ups as counts, shares from five units up; a model is measured only on the work it was given, so compare inside a kind. It suggests; it never reroutes anything.
