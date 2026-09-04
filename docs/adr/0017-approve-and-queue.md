# 0017 — Approve and queue

- Status: accepted
- Date: 2026-08-28
- Extends: D26

## Context

`SCOPE.md`'s fifth step reads "**Dispatch** — every ready node runs as an isolated agent session, in parallel." Every requirement makes it a human action: `PR-01-09` puts Run on the node panel, `PR-05-01` enables it only on a ready node with an approved brief. On a twenty-node graph four to six dependency levels deep, that is four to six returns to the board — each one opening a session, generating briefs, approving, dispatching.

So the planning time is paid and nothing pays it back. Measured against the requirements as they stand, the time to a first working agent is 12–22 minutes for a twenty-node project, against roughly 2–5 minutes for unplanned prompting. That gap is acceptable and the charter accepts it — "speed is a side effect, never the goal". Four to six unnecessary returns are not.

Full automation is blocked by two decisions, both correct. D26 makes brief approval a human act, per node. D27 puts the upstream node's outcome summary in the brief, so a brief cannot be fully rendered before its upstream finishes.

## Decision

A second approval action, alongside **Approve**: **Approve and queue**.

Approve dispatches now. Approve and queue records the same human approval of the same brief, plus the instruction to dispatch when the node becomes ready, without asking again.

What it trades: the approach is approved before the upstream node's result exists. The approach is written against the decisions and the node's description, not against an upstream diff, so this is usually harmless — and sometimes it is not. That is why it is **per node and never the default**. D26 is untouched: approval is still human, still per node, still with no batch.

Three safety rules:

1. **A queued chain stops at the first rejection or failure.** Four more nodes are never built on top of a result a human turned down.
2. **The concurrency limit applies.** D30's queue already exists — "ready nodes beyond the limit queue and start as slots free" — and this feeds it.
3. **The same-files warning blocks an automatic dispatch.** That warning requires a human confirmation, so an overlapping node waits rather than running unattended.

## Consequences

- A dependency chain can be approved in one sitting and run unattended. Returns drop from four to six per project to two or three.
- This is the mechanism that answers "planning time must be paid back by auto-dispatch". Without it, SOBER costs fifteen minutes up front _and_ more visits than unplanned prompting — slower on both counts.
- The review queue fills while the user is away, which is what the digest (§7.1) exists to summarise.
- One flag on the brief's approval record. No new record type.

## Alternatives rejected

- **Dispatch every ready node automatically.** Removes D26's approval, which is the last thing a human sees before an agent starts working.
- **Generate briefs automatically when a node becomes ready, and approve later.** The generation needs a host session, and after ADR 0009 the session is the user's own and may be closed. This would resurrect the advisory subprocess that ADR 0009 removed.
- **Approve-ahead as the default.** Puts every user in the trade before they know it exists.
