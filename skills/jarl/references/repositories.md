# Leases and several repositories

How a package shares one branch and one lease, what a lease shows in git, how one loop directs work in other repositories, and the rules for parallel workers. Read it when an issue names a repository other than the loop's own, or to read a stale lease. Terms: [glossary.md](glossary.md).

## Contents

- [Leases](#leases): one worker, one branch, one or many issues
- [Code in another repository](#code-in-another-repository)
- [Parallel workers in worktrees](#parallel-workers-in-worktrees)

## Leases

`set 163-168 in-progress "<text>" --branch jarl/163-packages --worker <name> --model <model-id> --by <who>` writes one lease on every issue in the call: **Branch:**, **Worker:**, **Model:** and **Since:**. A lease records no worktree: git allows a branch in at most one worktree, so it is found through the branch. `--worktree <path>` is a check and stores nothing. Leaving in-progress removes Worker, Model and Since and keeps Branch, the record of where the work was done.

- **Measuring.** `scope --branch jarl/163-packages` bounds the diff by the Files of every issue on that branch; `scope <id> --branch …` by one issue's.
- **`branches`** prints each branch with its issues and the state of its worktree, looked up through git: here, elsewhere (locked with a reason, as in a dev container), not visible from here, or gone (its directory missing while its parent is here). A worktree in a container is never reported gone. It marks a lease **STALE** when its worktree or branch is gone, or it has shown no commit, row or log line for the goal's `Liveness: <minutes>` (30 by default, `--stale-hours` for one call), and a branch **DONE → delete** when every issue on it is done or dropped and its tip is in the base with its worktree clean; a branch that looks done another way reads a `DONE (...)` of its own. A branch marked `DONE → delete` is what `merged` removes by itself; one still listed is one `merged` kept, for the reason it named. A worktree listed but not inspectable from here is never marked for deletion, because its uncommitted changes cannot be counted.
- **A lease holds.** Under the write lock, a move into in-progress is refused for an issue another worker or branch holds, and for a file or resource another lease holds, naming the holding issue, its worker and its branch. Issues leased in one call share one lease.
- **A handover** gives a whole lease to a new worker or branch: `set <ids> in-progress "<why-the-worker-changed>" --branch <worker-branch> --worker <the-new-worker> --handover --by <who>`. Handing over one issue of a shared lease is refused. A takeover, after as many red rounds as the goal's limit allows (three unless it says otherwise), is a handover too. A stale lease is shown for its slice's coordinator to act on (ask the worker, hand it over, or set the issues back to `open`); nothing moves by itself.

## Code in another repository

A loop can keep its issues in one repository while its workers change another, or direct several at once. The loop stays where `.jarl/` lives, reached with `--root`; the code side moves.

- **The issue names it.** `new --repo <name-or-path>` writes **Repo:**; several as a comma list, each of its files then starting with the name of the repository it is in (a file with none of the names is in the first one), and `scope` on such an issue takes `--repo` to say which it reads. `--repo` takes the repository's name (its directory name), its checkout, a worktree or a file inside it, and reduces it to the main checkout. **Repo:** stores the name where the checkout sits beside the loop's main checkout, and the path anywhere else. A name resolves to `<parent of the loop's main checkout>/<name>`; on a machine laid out differently, a symlink beside the loop's checkout puts it there. A name that does not resolve is refused by the commands that act on it. Jarl declares a name once in `.jarl/repos.md`: its root commits, its origin as found and its base branch, no path; `base <name> <branch> --by <who>` changes the base.
- **Its files carry the name.** Each entry of **Files:** starts with that repository's directory name (**Repo:** `tool` → **Files:** `tool/src/a.mjs`), so `next` keeps the same path in two repositories apart. A repository holding a directory of its own name (`app/app/x.mjs`) needs the prefix; an entry starting with `app/` but not `app/app/` is a path inside the repository.
- **`scope`, `branches` and `resume` read there**, against that repository's base: the one declared where the branch exists, else the branch its checkout has open; `--repo` on one call wins. Without `--repo`, `branches` covers every repository an issue names.
- **The worker, the examiner and the merger work there.** The worktree and its branch are cut in that repository from its own feature branch, which the brief names; the merger merges and runs the check in that repository's checkout. `.jarl/` never enters it, and the merger commits it where the loop lives.
- **Where it is on this machine** is printed, never stored: `show` and `status --group repo` say it.
- **One `Check (<name>): <command>` line per repository** names the command the landing is held to, `<name>` as the issue's Repo ends.

## Parallel workers in worktrees

The rules of a session with several workers; `--help` ends with the same list.

- **The default mode keeps the loop out of git.** It lives in the loop root, which a worktree cannot see, so every call from a worktree passes the loop root (the directory that holds `.jarl/`) as `root`; writers queue on the lock and lose nothing, and the one `log.md` is shared on purpose.
- **In the committed mode the merger alone commits `.jarl/`**; a worker never does.
- **The coordinator files the issues**, or a worker files with `root` set to the loop root, so numbers never collide in one clone. Two clones that both file before fetching can share a number: `verify` names both files with their keys, the commands refuse that number, and `renumber <id> --key <key> --by <who>` gives one a free number. Each log line names the key of the issue it is about, so neither loses a line.
- **An issue in progress is held by a worker**: `resume` shows it with its worker, branch and start.
- **`list` hides finished and deferred work**; `--all`, `--tag`, `--status`, `--prio` and `--grep` widen or narrow it.
