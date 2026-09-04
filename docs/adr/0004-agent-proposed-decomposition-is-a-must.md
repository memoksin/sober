# 0004 — Agent-proposed decomposition is a v1 MUST

- Status: accepted
- Date: 2026-08-27

## Context

`SCOPE.md` listed "agent-proposed decomposition (brain dump → nodes + edges + decisions, human approves)" as SHOULD, for v1.x, and its WON'T table excluded "auto-decomposition by LLM" on the grounds that the human owns intent.

Read together, v1 required every node to be created by hand. That produces a first-run experience of an empty board and thirty manual node creations, and it contradicts `MANIFESTO.md`: the user is an orchestrator who states what they want and approves what comes back.

The two entries were also conflating different things. _Auto_-decomposition means a machine graph nobody evaluated. _Proposed_ decomposition means a draft a human accepts, edits, or drops — the same shape already accepted for decisions and briefs in D1.

## Decision

Agent-proposed decomposition moves into MUST as #10.

The user states intent in free text. An agent proposes nodes, the dependencies between them, and the decisions each node introduces. **Nothing exists on the board until a human accepts it.** Manual node creation stays available and is never removed — it is the escape hatch when the proposal is wrong.

The WON'T entry is reworded: what stays excluded is decomposition that _lands_ without human approval, not decomposition that is _proposed_ by an agent.

## Consequences

- `SCOPE.md` gains MUST #10; the SHOULD entry is removed and the WON'T entry is narrowed.
- Phase 2 (`core`) and phase 3 (`cli`) both grow: proposals need a representation that is distinct from accepted board state.
- Acceptance granularity differs by kind, deliberately: **decisions are accepted one at a time** (§2.4 of `DESIGN.md` — batch accept is the rubber stamp that rule exists to prevent), **node proposals may be accepted as a batch**. The risk on a decision is that the human did not understand it; the risk on a node title is that it is wrong, which is visible and cheap to fix later.

## Alternatives rejected

- **Keep it SHOULD and ship v1 with manual node creation.** The loop would close, but on a product nobody would use twice.
- **Let the agent write nodes straight to the board.** That is the auto- decomposition the charter rules out: a plausible graph nobody evaluated.
