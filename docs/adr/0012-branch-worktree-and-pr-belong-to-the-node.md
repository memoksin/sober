# 0012 — The branch, the worktree and the pull request belong to the node

- Status: accepted
- Date: 2026-08-28
- Reinterprets: D31, D34, D40

## Context

Everything about a run was scoped to the run. Each dispatch got a branch, a
worktree, and a draft pull request (§6.1). Rejection preserved all three and
returned the node to `ready` (§6.4, `PR-06-08`); so did stopping (§5.4) and failing
(§8.1). The next attempt was a new run.

Two rejections therefore left a node trailing **three branches, three worktrees and
three open draft pull requests**. Cleanup covered one of them: §8.2 lists idle
worktrees by size. Nothing collected branches or pull requests, and every push
spent CI minutes.

§8.2's rule — "if the work landed, the worktree has no job left" — is written in the
singular. When the third attempt is accepted, the first two attempts' branches and
draft pull requests are never revisited. They stay open after the node is `done`.

The mismatch is in what the unit is. §3.1 is clear about what gets accepted:
"`accepted` — the record of a human accepting the result. Its presence is what
makes a node finished." The node is the unit. The branch, the worktree and the pull
request were not.

## Decision

**A node has one branch, one worktree and one draft pull request, for its whole
life.** Attempts add commits.

- Rejection, stopping and failure change nothing about those three. The node
  returns to `ready`; the next run continues on the same branch, in the same
  worktree.
- By default the next run **keeps the previous attempt's work** — the agent sees
  what it wrote and the feedback, which is how §6.4's "rejecting is correcting"
  actually reads in practice. The rejection surface offers "start clean", which
  resets the branch to its base.
- Acceptance merges the branch, closes the pull request, and removes the worktree.

## Consequences

- After three attempts: one branch, one worktree, one pull request whose diff
  against the base shows the net result and whose CI history shows the attempts in
  order.
- `PR-06-08` still holds. Rejection deletes nothing: the worktree is there, the
  branch is there, the pull request is still a draft. The next run adds to it.
- This is the ordinary pull request flow — review comments, more commits, one pull
  request. §6.1 already says "the pull request is a mechanism, not a surface";
  using the standard mechanism beats inventing one.
- Dependency installation (`dispatch.setup`) happens once per node instead of once
  per attempt. On a three-attempt node that is two installs saved, and the disk
  cost stops multiplying.
- Two runs of one node never overlap — a running node cannot be dispatched — so a
  single worktree is safe under any concurrency setting.

## Alternatives rejected

- **A new branch per attempt, closing the previous draft pull request on
  re-dispatch.** Keeps each attempt's remote history intact, at the cost of N
  branches and N closed pull requests per node, plus a close step that can fail
  and leave the mess it was meant to prevent.
- **Force-pushing a fresh attempt over the branch.** Discards the previous attempt
  from the remote for no gain: the reviewer wants the net diff, which a merge
  commit-free branch already gives.
- **Leaving it as it was.** Twenty stale draft pull requests on a ten-node project,
  and CI minutes spent on every one.
