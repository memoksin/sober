# 0036 — The wire is JSON over HTTP, every operation has a route, and the dashboard asks again

- Status: accepted
- Date: 2026-09-06
- Refines: ADR 0008, `PR-09-08`

## Context

ADR 0008 gave the dashboard a server, put the wire types in `schema`, and said
they are written at the **start** of M3, before any screen. It did not say what
the wire is. `BUILD-PLAN.md` §2 makes the contract the first item of the phase,
so the transport has to be settled before the first route.

Two questions were open, and they are one contract.

**How fresh does the screen stay.** The dashboard shows derived status, and
status changes underneath it: a run finishes, CI turns green, a teammate's sync
lands. Four shapes were considered — request/response with the client polling,
the same plus a server-sent-event channel, a WebSocket, and a typed RPC layer.

**What the dashboard is allowed to write.** `PR-09-08` says every
state-changing operation is available on all three surfaces, headless. A
read-only dashboard would contradict an accepted requirement, so the real
question is narrower: whether `run` — the one operation that spawns an agent and
spends money — belongs on a surface reachable by a click.

## Decision

**The wire is request/response JSON over HTTP.** One route per `core` operation,
its request and response shapes typed in `schema` beside the record types. No
RPC framework: ADR 0008 said no new package and no new dependency for the wire
types, and a framework would make `schema` a coupling between client and server
rather than a description of what travels.

**Freshness is the client asking again.** The dashboard polls; the canvas reads
the slim projection ADR 0008 already specified, and a panel fetches the full
record when it opens. This is the fewest moving parts that is correct, and
`core` reading files is already the cost floor underneath it.

**SSE is the named next move, and its first subject is the run log.** Polling is
the wrong shape for tailing a running agent's output, and that is the only place
in M3 where it is clearly wrong. Adding an event channel later is additive — no
route changes, no contract break — which is what makes deferring it honest
rather than optimistic. It is not free when it arrives: `EventSource` cannot set
a request header, so the loopback token moves into the URL, and ADR 0008's token
rule gains a stated exception rather than a quiet one.

**Every state-changing operation gets a route, `run` included.** Full parity, as
`PR-09-08` requires. The three operations an agent may not perform alone (ADR
0010) need no elicitation here: the human is at the screen, and the screen is
the asking.

## Consequences

- The M3 contract test is one list read three ways — CLI, MCP tools, HTTP routes
  — against `core`'s state-changing operations. A new operation that reaches two
  surfaces fails it.
- **The irreversible operations are one step in the dashboard and two in the
  CLI.** `accept`, `archive` and editing an answered decision carry ADR 0032's
  second command on the command line and a single click on the screen. This is a
  deliberate asymmetry, recorded here rather than discovered later, and it is on
  the list of things the M3 gate is watching. Editing an answered decision is
  the mildest case of the three, because DESIGN §2.8 puts an impact preview in
  front of it on every surface.
- Polling has a cost the phase must not let drift: a board open in a tab reads
  files on a timer forever. The interval is configuration with a stated default,
  and the canvas asks for the projection, never for full records.
- If polling turns out to be the wrong shape somewhere other than the run log,
  that is the evidence that earns SSE early rather than late.

## Alternatives rejected

- **REST plus SSE from the start.** The right end state, probably, and still the
  wrong opening: it puts a second lifecycle — subscribe, reconnect, replay —
  into the first week of the phase whose named risk is running long, to solve a
  problem only the log view has.
- **WebSocket.** Bidirectional, and nothing here is bidirectional. The
  dashboard's writes are one-shot commands that want a status code back.
- **tRPC or JSON-RPC.** Types for free, at the price ADR 0008 refused: a
  dependency, and `schema` becoming a client-server coupling instead of a
  description of records and wire shapes.
- **A read-only dashboard, with writes left to the CLI.** It breaks `PR-09-08`,
  and it makes the M3 gate — the same loop with no terminal — impossible to run.
- **Parity minus dispatch.** The same objection, narrower. The reason to consider
  it was the lifetime of a run started from a browser, and that is answered in
  ADR 0037 instead of by removing the operation.
