# 0019 — Configuration that governs a run or a review is read from the base

- Status: accepted
- Date: 2026-08-29

## Context

Two settings decide what SOBER does with an agent's work, and both live in files inside the repository:

- `dispatch.setup` (`PR-05-05`) — a shell command SOBER runs in a fresh worktree before the agent starts.
- The security scan's rule set and its suppressions (ADR 0011).

A dispatched agent can write to both. Read from the working tree of the branch under review, each becomes a way for the work to change the rules applied to it:

- an agent that adds a secret and relaxes the scan configuration in the same diff passes the scan;
- an agent that rewrites `dispatch.setup` has SOBER execute that command on the next run.

Neither requires bad intent. "The scan is red, let me relax the configuration" is an entirely ordinary thing for an agent to try.

This defeats the whole reason MUST #9 exists. ADR 0002 calls it "the one review failure a machine reliably prevents and a human reliably does not". A machine whose rules are editable by the thing it checks prevents nothing.

An earlier proposal answered this by making the rule set static and un-configurable. That was a restriction rather than a mechanism: the suppressions it still allowed would have lived in `.sober/config.jsonc`, in the same repository, editable by the same agent. A smaller hole, the same hole.

## Decision

**Configuration that governs a run or a review is read from the base ref, never from the branch under review.**

`git show <base>:<path>`, not the working tree. Concretely:

- the scan's rule set and its suppressions;
- `dispatch.setup`, and any other setting that decides how a run is prepared or executed.

An agent that changes one of these in its own branch does not change what is applied to its own branch. The change appears as a diff line the human reads, and it takes effect only once it has been accepted.

The base is the ref the node's branch was cut from. It is a local ref, so this works with no remote — which is M1's case.

If the base carries no such file, the bundled default applies.

## Consequences

- The trust hole closes properly, which is what makes project-specific scan configuration safe to support at all (ADR 0011).
- A suppression the user adds does not apply to the review in front of them until it lands on the base. That is the discipline CI configuration already has, and it is the correct trade.
- `dispatch.timeoutMinutes` (`DESIGN.md` §5.4) is read from the base: a run that could raise its own timeout has no timeout.
- Settings that govern neither a run nor a review — the concurrency limit, `dispatch.draftPr`, the lock windows (ADR 0025), dashboard preferences — are read normally. The rule is about what an agent's own work is measured by, not about all configuration.
- The review shows which rule set ran, so ADR 0011's promise that what the scan does not cover is documented next to what it does stays true.

## Alternatives rejected

- **A static, un-configurable rule set.** Loses project-specific secret formats, for a hole it does not actually close.
- **Catching configuration edits with the declared-files signal.** That signal rests on a prediction (`DESIGN.md` §3.1). Putting the one hard guarantee behind a soft prediction is the inversion MUST #9 exists to prevent.
- **Refusing any agent diff that touches the configuration.** A node that genuinely needs to change the setup command then cannot, and the refusal is a new special case on the review path.
