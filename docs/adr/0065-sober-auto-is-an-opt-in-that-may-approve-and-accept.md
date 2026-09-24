# 0065 — sober:auto is an opt-in that may approve and accept

- **Status:** accepted
- **Date:** 2026-09-24
- **Supersedes:** D26's "approval is human" (`DESIGN.md` §3.7, *Production and
  approval*), `SCOPE.md` MUST #5 and `PR-09-05` ("only a human can accept"),
  and ADR 0056's "approval stays per node, human" — each only for an explicit
  `sober:auto` invocation, and only as far as this ADR's gate lets it go. What
  survives unchanged: ADR 0010 / §2.4 — auto never answers, suggests-into-
  answers, or edits a decision; decisions stay human, always. ADR 0056
  decision 3 — no unattended retry. Both of ADR 0017's safety rules, carried
  by ADR 0056. ADR 0059 / ADR 0053 — a merge into `main` is a release, and it
  is the human's. The attended flow, its tools, and every rule above when
  `sober:auto` is not the invocation in use.

## Context

Every approval and acceptance in SOBER today is a human act: D26 requires a
human to approve a brief, `SCOPE.md` MUST #5 and `PR-09-05` require a human
to accept a result, and ADR 0056's unattended dispatcher only ever *starts*
work that a human already approved — it never approves or accepts anything
itself. That is correct for a product whose one hard block is a human
decision (ADR 0003, §2.4), and it is why an agent can draft a decision but
never answer one.

`sober:auto` asks for something narrower: a named, explicit invocation under
which an agent may also approve a brief and accept a result, so a run can go
from `ready` to merged with nobody watching it in real time. That is new
authority, not a bigger default — every other SOBER invocation, and every
surface when `sober:auto` is not the one in use, keeps today's human path
exactly as it is.

The risk this ADR has to close is the one D26 and MUST #5 exist to prevent:
a machine rubber-stamping its own work. The two existing safety rails — the
one hard block (a node bound by an open decision is held) and human review —
were built assuming a human is the one pressing the buttons. Handing the
buttons to an agent means restating both rails as checks a machine can run
and fail honestly, not as advice it can talk itself past.

## Decision

### 1. Opt-in, never a setting

`sober:auto` is an explicit invocation — a named skill/command a human runs
on a node or a wave, the way `sober:next` is invoked today. It is not a
board-wide setting, not a config flag that turns itself on, and never the
default for `approve` or `accept` on any surface. Without that invocation,
every path — CLI, MCP, dashboard — is today's attended path, unchanged. A
project that never runs `sober:auto` sees no behavioural difference from
before this ADR.

### 2. Authority lives in core (decision: Core auto modu)

The gate in §3 below, and the records it writes, are enforced in
`packages/core`, not in the skill that drives `sober:auto`. The skill
sequences the run — brief, dispatch, review, accept — but every consequential
transition calls into a core function that rechecks the gate and refuses if
it fails. This is what makes CLI, MCP and the dashboard share one rule
instead of three interpretations of it, the same reasoning ADR 0008 already
applies to storage.

Cost named: this grows the schema (autonomous-provenance fields, §6) and the
core API (an auto-aware approve/accept path alongside the human one), and the
two paths have to share code — the actual approval and acceptance mechanics —
without the auto path silently picking up a shortcut the attended path does
not also get, or vice versa.

### 3. The gate

Before each consequential transition an auto invocation makes — approving a
brief, dispatching, accepting a result — core rechecks, fresh, not from a
cached read, that the board holds zero open, non-archived decisions anywhere:

- **Zero open, non-archived decisions anywhere on the board.** Not only
  decisions bound to this node: any open decision on the board holds every
  auto transition, the same way §2.4 already treats a draft (`suggested` set,
  no `answer`) as open. This is wider than the one-hard-block rule, which
  only holds the nodes a decision binds — here, one open question anywhere
  is enough to stop auto, because auto has no human in the loop to notice a
  board-wide implication a node-local check would miss.
- **A board that loads clean.** No broken record (§8.4) and a graph that is
  still a DAG (§3.6). A board that cannot be trusted to describe itself is
  not one auto acts on.
- **The node is actionable.** Its derived status (§3.2) is the one the
  transition expects, nothing else holds a claim on it, no other active node
  shares its declared `files` (§3.4), and it is not flagged by a decision
  that changed since its brief was written (§2.8).
- **The brief carries a non-empty acceptance list** of runnable commands
  (§3.7, §6.0) — auto never accepts against an empty definition of done.

Any single failure refuses the transition. The node goes back to the human
exactly as it would if a person had tried the same action and been blocked —
nothing is retried, skipped, or silently worked around by auto itself.

### 4. Forbidden

An auto invocation never:

- targets `main` or a release branch — it lands on the project's configured
  base (`development` in this repository), the same base every attended run
  uses (§5.0);
- opens or merges a pull request into `main`, or writes a changeset — a
  release is a human decision (ADR 0059, ADR 0053) and stays one;
- retries a run that failed, was stopped, or was rejected. ADR 0056 decision
  3 already settles this for the unattended dispatcher — "a run a human
  turned down... may not be started a second time by something the human is
  not watching. From then on it is theirs" — and auto is the same door.

### 5. Accept threshold

Auto accepts only a conclusively green result (§6.0): every command in the
brief's acceptance list exited 0, the scan is clean (not `did-not-run`), and
CI is green wherever the project has CI configured, with no §2.8 flag on the
node. Anything short of that is not a maybe — it is a stop:

- **Inconclusive** (a scan that could not run, CI that could not be read, a
  criterion that did not run) leaves the node in review for a human. Auto
  does not accept on a partial read, the same way §6.2 already treats "could
  not be read" as never meaning "passing".
- **A clear failure** is rejected, the same shape §6.4 already gives a human
  reject: the node returns to `ready` carrying actionable feedback naming
  what failed. A node rejected by auto is the human's thereafter — §4's
  no-retry rule applies to it exactly as it applies to a human rejection.

### 6. Provenance

An approval or acceptance made under `sober:auto` is recorded as autonomous,
never attributed to a human who did not see it. The record states that the
action was automated, which invocation performed it, and who invoked
`sober:auto` — the same audit expectation §2.4 already sets for a relayed
decision pick ("the record cannot tell a relayed pick from a human one... the
skills and hooks hold the rule"), except here the record itself must be able
to tell the two apart, because nobody relays anything for auto to attribute
to a human by default. The exact field shape belongs to auto-eligibility-jd7h.

### 7. Mid-run gate change

If, while an auto run is in flight, a decision opens anywhere on the board,
the graph breaks, or the node is claimed out from under it, the run itself is
not killed — stopping a run is a human act (§5.4, D31) and auto changing that
would be auto reaching for authority this ADR does not give it. What changes
is the next transition: auto takes no further approve, dispatch, or accept
step on that node. The result, whatever state it reaches, waits in review for
a human, and auto stops advancing it. This is the gate in §3 applied
continuously, not just at the first check — a mid-run gate change stops the
next transition, not the run.

### 8. Decision threshold and catalog (decision: Katalog ve arama)

A `sober:auto` run's brief carries the decisions already bound and answered
at brief time (§3.7). When the agent meets a choice the brief does not
answer:

- it searches the board's answered-decision catalog over MCP, looking for an
  existing answer in the same category that already settles the question
  elsewhere on the board;
- **found** → it follows that answer;
- **not found, and the choice is node-local** — an implementation detail
  contained inside the node's own declared files, with no bearing on any
  other node — the agent decides and records what it decided and why in the
  node's `outcome`, the way any implementation choice already ends up there;
- **not found, and the choice would change the shape of more than one node**
  in one of the four categories `state`, `module-boundaries`, `data-flow`,
  `error-handling` (§2.5) — the agent stops and asks the human to open and
  answer a decision. Auto never opens *and* answers a decision itself; it may
  only draft the question the way any agent already can (§2.3), and then it
  waits, exactly as an attended node waits on an open decision today.

Cost named: "when to search" has to be described reliably enough that an
agent does not skip the catalog on a choice that actually was cross-node, and
an unmatched question has to be visible to the human rather than silently
decided node-local because searching felt unnecessary.

## Consequences

- Everything about the attended flow — the CLI, the MCP tools, the
  dashboard, every rule this ADR does not name — is unchanged. A project
  that never invokes `sober:auto` sees nothing different.
- `packages/core`'s schema and API grow by an auto-aware approve/accept path
  and provenance fields; the attended path is not rewritten to share it, only
  to route through the same underlying mechanics.
- A board with any open decision anywhere stops every auto transition, even
  ones on nodes that bind no decisions themselves — auto is more
  conservative than a human working the same board attended, because it has
  no chance to notice an implication the one-hard-block rule would miss.
- Auto can now close the loop from `ready` to merged into the project's base
  with no human present for an individual approve or accept — but never past
  `main`, never on a retry, and never past an inconclusive result.
- A rejected or flagged auto run is handed to a human exactly like a rejected
  or flagged attended run — nothing new to learn there.

## Alternatives rejected

- **Skill-only enforcement.** Each surface — CLI, MCP, dashboard — would need
  to reimplement the gate, and any one of them getting it wrong routes around
  it entirely. The same reasoning that put storage authority in `core`
  (ADR 0008) applies to auto's authority.
- **A board-wide setting that makes everything auto.** ADR 0056 already
  rejected the equivalent move for dispatch, on the ground that it "puts a
  user in a trade by editing a file, not by installing SOBER". Making
  approval or acceptance itself a flip-a-flag default would be the same
  mistake at a higher stake.
- **Gating only on bound decisions**, the way the one hard block already
  does for a human. An unbound open decision is exactly the cross-node
  question §8's catalog lookup exists to route to a human; gating narrower
  than board-wide would let auto guess past precisely the case it must not
  guess past.
- **Letting auto answer a decision with a written rationale.** ADR 0010
  already rejected this for the attended path — "the rubber stamp with a
  paper trail" — and nothing about running unattended makes a
  machine-written rationale a human judgement. Decisions stay human, always.
