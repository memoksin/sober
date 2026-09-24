# 0045 — The run is not readable on the screen in v1, and SSE is the shape when it is

- Status: accepted
- Date: 2026-09-07
- Answers: `M3-GATE.md` finding 4
- Refines: ADR 0036, `SCOPE.md` SHOULD

## Context

M3's gate ran green and found five things, all of them about what the screen
says rather than what it does. Four are repairs — the product already claims
them and the screen was silent. The fourth is not:

> A run cannot be watched from the screen at all. `logs` does not appear in one
> line of `apps/dashboard/src` or `packages/server/src`. `sober logs <node>` is
> the only way to read what the agent said, and it is a terminal command.

The gate's own record left the reading of it open: "Whether that is v1.x or a
defect is a product decision, not this record's."

It is a scope answer either way, so it takes an ADR either way. Three documents
already have half of one.

- **`SCOPE.md`'s SHOULD list** carries "Live session view — watching a
  dispatched agent, answering its prompts" — designed for, not built, v1.x. The
  scope rule says a feature moves into MUST only by an ADR naming what new fact
  justified it.
- **ADR 0036** says polling is the wrong shape for tailing a running agent, that
  SSE is the named next move, and that **the run log is its first subject**. It
  also priced it: `EventSource` cannot set a request header, so the loopback
  token moves into the URL and ADR 0008's token rule gains a stated exception.
- **`core` already exports `tail`.** The cost objection is not the code. A route
  reading it needs no new export and the ceiling (ADR 0028, at 99 of 100) is not
  in the way.

So the question is not "can this be built cheaply" — it can. It is whether the
gate found a new fact.

## Decision

**It stays out of v1.** The gate found a real gap and not a new fact: it found
the SHOULD line, from the inside, at the moment it costs most. That is what a
SHOULD line is — a feature whose absence is felt and whose absence does not stop
the loop. Step 6 passed: the run started, survived a closed tab, and finished.

**SSE is the shape when it arrives, and the run log is its first subject**, as
ADR 0036 already said. A sixth polled read was considered and is the wrong first
move: it would ship a second freshness mechanism for the one place ADR 0036
named as polling's exception, and then be replaced.

**The screen says where the run can be read instead.** This is the part of
finding 4 that lands now, inside finding 2's fix: a node on `running` names
`sober logs <node>` in the panel, with the node's real id in it. A surface that
cannot show a thing and does not say where it is shown is the failure; a surface
that points at the one place it lives is honest.

## Consequences

- `SCOPE.md` is unchanged. The SHOULD line stays a SHOULD line, and this ADR is
  the record that it was examined against real use and left there.
- v1 ships with the longest and most expensive operation in the product
  observable on the screen only as a status. The panel's sentence is what stands
  between that and silence.
- The wire contract (ADR 0036) gains no fifth read. `packages/server`'s
  `READS` stays `board`, `digest`, `impact`, `projection`, `review`, and the
  route test that pins that list is unchanged.
- `core`'s `tail` keeps its one consumer, the CLI. When SSE arrives it gains a
  second and needs no new export.
- The next milestone that opens this takes ADR 0008's token exception with it.
  That price is stated here so the ADR that spends it does not rediscover it.

## Alternatives rejected

- **A sixth polled read, `GET /read/logs?node=`, in this commit.** Cheap, no new
  core export, and it works. It is rejected for what it is rather than what it
  costs: ADR 0036 named the run log as the one place polling is clearly the
  wrong shape, and building it by polling anyway is choosing the mechanism the
  ADR already ruled out because it is the mechanism already there.
- **The log on the review screen only, after the run ends.** Narrower and
  defensible — no live cadence question, and the output beside the diff. Still a
  v1 feature nobody asked for on a screen ADR 0022 deliberately keeps short: the
  review is checks, not reading, and a run log is the longest reading in the
  product.
- **Move the SHOULD line into MUST and build the live view.** The honest version
  of "it is a defect". It is a week — SSE, reconnect, replay, the token
  exception, and answering the agent's prompts is a second feature underneath
  the first — spent on a milestone whose named risk is running long, to fix
  something that stopped no step of the gate.
