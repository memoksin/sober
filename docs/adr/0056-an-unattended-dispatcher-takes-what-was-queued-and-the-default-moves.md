# 0056 — An unattended dispatcher takes what was queued, and the default moves

- **Status:** accepted
- **Date:** 2026-09-09
- **Supersedes:** [ADR 0017](0017-approve-and-queue.md) — the two approval
  actions and both safety rules survive unchanged. What does not survive is
  0017's stated reason for rejecting automatic dispatch, which is not accurate
  about the code, and its "never the default", which becomes a setting whose
  default is still off.

## Context

The ask is that the dispatcher start every node that reaches `ready`, not only
those whose approval carries `queue: true`. ADR 0017 lists "Dispatch every ready
node automatically" under rejected alternatives, so it is settled here rather
than edited quietly into the predicate in `packages/core/src/queue.ts`.

### `ready` already means approved

0017 rejected automatic dispatch because it "removes D26's approval, which is
the last thing a human sees before an agent starts working". That sentence is
not true of the code. `packages/core/src/status.ts:46-48` reads:

```ts
if (node.brief === null) return 'needs-brief'
if (node.brief.approval === null) return 'needs-approval'
return 'ready'
```

A node with no brief is `needs-brief`. A brief with no approval is
`needs-approval`. `ready` is what is left, and it is only reachable through a
human approval record. Dispatching every ready node therefore removes nothing:
D26 holds, and the charter's "nothing runs without a human-approved brief" holds
with it. Any ADR that keeps the flag has to argue for it on some other ground,
and inheriting 0017's ground would be inheriting a mistake.

### What the flag actually distinguishes

The real trade is narrower than the ask, and 0017 already names it:

- Plain **Approve** means start now. The human approved an approach and expected
  an agent immediately.
- **Approve and queue** means start later, unattended, without asking again —
  and what it trades is that "the approach is approved before the upstream
  node's result exists […] so this is usually harmless — and sometimes it is
  not."

So a ready node whose approval carries `queue: false` and that has never run is
not a node waiting for permission. It is a node that was approved **for
immediate work and did not start** — its dispatch failed, it was stopped before
it began, or it was approved while something else still blocked it. Starting it
hours later, unattended, hands it exactly the trade its approver declined, on a
brief written against a state of the graph that has since moved. That is the
cost, and it is a cost the person who pressed Approve did not agree to pay.

### Where the friction actually is

The complaint behind the ask is real, and it is not about safety. `queue: true`
is hard to reach: it is off by default in the MCP `approve` tool's schema, off
unless `sober approve --queue` is typed, and 0017's "never the default" made
that a rule rather than a setting. A board owner who wants every approval queued
has to remember, per node, every time. One forgotten flag is a correct queue
sitting idle, which reads to the user as the dispatcher being broken.

## Decision

**1. An unattended dispatcher takes only what was queued.** The first condition
of `queued()` — `brief.approval.queue === true` — stays. Not because ready is
unapproved, which it is not, but because `queue: false` with no run is a
recorded preference for attended work, and the queue is the one code path with
no human at the other end. `packages/core/src/queue.ts` is unchanged apart from
a pointer to this ADR.

**2. The friction closes from the other side.** A new setting,
`dispatch.queueByDefault`, default `false`, decides which of the two approval
actions a surface offers when the caller does not say. `approveBrief` resolves
it, so both surfaces get it from one place: the CLI's `sober approve` without
`--queue` and the MCP `approve` tool without `queue` now follow the board's
setting instead of a hard-coded `false`. This is a default and a prompt, not new
machinery — the tool already took a `queue` boolean and the record already had
the field.

This is where 0017's "per node and never the default" is superseded. Approval
stays per node, human, and never a batch: D26 is untouched, and the human still
sees which of the two actions they are confirming, because the prompt is
labelled from the resolved value. What moves is who decides the starting
position — once, in a config file they can read, rather than never.

The setting is read normally, not from the base ref. ADR 0019 sends a setting to
the base when it governs **how a run is prepared or how its result is judged**;
this one governs a default in a prompt a human answers on their own checkout,
like the concurrency limit beside it.

**3. Retry stays out, and is now a decision rather than a filter.** The third
condition of `queued()` is `lastRun(board, id) === null`, and the comment above
it already says why:

> a run that failed leaves the node `ready` again, and a run a human turned down
> does too, and neither may be started a second time by something the human is
> not watching. From then on it is theirs.

A dispatcher that retries a failed run unattended repeats whatever caused the
failure, on the same brief, and bills for it. A dispatcher that restarts a
rejected run builds on top of a result a human has already refused. Both are the
first safety rule below, arriving through a different door. Retrying is a human
action — `sober run` on a node the human is looking at.

**4. Both of 0017's safety rules are carried forward by name, unchanged.**

1. **A queued chain stops at the first rejection or failure.** Four more nodes
   are never built on top of a result a human turned down. Implemented in
   `dispatchWave`, which is inherited here, not modified.
2. **An overlapping node is never started unattended.** The same-files warning
   needs a human confirmation, so an overlapping node waits. This one carries
   extra weight now: it, the claim check, and the concurrency limit are the rules
   that make the flagged predicate safe, and none of them is relaxed.

0017's third rule — the concurrency limit applies — also stands, unchanged
(D30, §5.3). The concurrency limit, `dispatchWave` and the lock are inherited by
this ADR, not modified by it.

0017's remaining rejected alternatives keep their reasons. "Generate briefs
automatically" is still rejected on ADR 0009's ground, which this ADR does not
touch. "Dispatch every ready node automatically" is still rejected, but for the
reason in decision 1 rather than the one 0017 gave.

## Consequences

- The dispatcher's behaviour is unchanged: same predicate, same three
  conditions, same held reasons.
- A board that wants everything queued sets one line of config once, instead of
  remembering a flag per approval. The trade 0017 named is still taken per node
  and still visible in the prompt — it is the starting position that moved.
- A node approved for now that did not start stays the human's. They see it
  `ready` on the board and press Run, which is the same act they were making
  when they approved it.
- `dispatch.queueByDefault: true` on a shared board makes every teammate's
  default the queue's. That is the point of a board-wide setting, and it is why
  the default ships `false`: a user is put in a trade by editing a file, not by
  installing SOBER.

## Alternatives rejected

- **Take every ready node with no flag at all.** Answered above: `queue: false`
  and no run is a recorded preference for attended work, and overriding it
  silently is the one thing this ADR is about.
- **Take flagless ready nodes only when they have never run.** Which is the same
  thing — every flagless candidate the queue would gain has never run, because
  `lastRun === null` already excludes the rest. It is decision 1 with the
  argument left out.
- **Make `queue: true` the shipped default.** Puts every user in 0017's trade
  before they know it exists, which is 0017's own reason for rejecting
  approve-ahead as a default and is still right.
- **A board-state setting in `project.json` instead of a config key.** How much
  a board spends unattended is a property of the machine and the person at it,
  not of the project's intent, and `.sober/config.jsonc` is where the other
  dispatch settings already live (§1.3).
