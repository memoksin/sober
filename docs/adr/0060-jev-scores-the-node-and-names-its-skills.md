# 0060 — Jev scores the node and names its skills

- **Status:** accepted
- **Date:** 2026-09-21
- **Refines:** [ADR 0058](0058-a-tier-names-its-host-and-model.md), DESIGN §5.1

## Context

ADR 0058 made the model a function of one number: `Brief.complexity`, 1–10,
written by whoever wrote the brief. The number works — `tierFor` and
`hostForTier` are four lines between them — but the number is a guess. Two
people score the same node differently, the same person scores differently on
a Tuesday, and nothing on the board says which is right.

Skills are worse off: there is no node↔skill binding at all. Skills are
build-time prose generated per host by `scripts/build-plugins.mjs`, and a
dispatched agent is left to work out for itself which of the user's installed
skills the node calls for.

TypeSafe's Jev is a System One model: it takes a state and typed questions and
returns a choice, a score or a probability — no prose, no tool loop. That is
exactly the shape of both questions, and it is small enough that asking it
costs a fraction of the run it is sizing.

## Decision

A new `dispatch.jevMode`, **off by default**. On, every dispatch shows Jev the
node's rendered brief and asks it one score question — how hard is this, on ten
named rungs — and one yes/no question (`noul` on the wire) per name in `dispatch.jevSkills`.

Three consequences of that shape, each deliberate:

**The brief's own complexity is ignored, not merged.** The point of the mode is
that nobody has to guess a number. A "Jev only when the brief is silent" rule
would leave the guess in place wherever somebody happened to make one.

**Jev's score still runs through `dispatch.thresholds`.** Asking Jev for the
tier directly would have been less code and fewer rungs. It would also have
taken away the one knob the user has: which score belongs to which model is a
budget question, and a budget is not something a model should hold.

**Skills are named in the prompt, not written to the record.** `Brief` does not
gain a field and the schema version does not move. The names go into a `# Skills`
block ahead of the closing instructions, and the agent looks each one up in its
own host. A stored binding would be a schema step and a migration for something
re-decided on every dispatch anyway.

Transport is three env vars and one `fetch` — no SDK. They are read from the
shell, or from `.sober/.env`, which `.sober/*` already gitignores and which
every `sober` command loads first, so the host that spawns `sober mcp` sees
them without a restarted shell; a variable the shell set is never overwritten.

| env | required | default |
|---|---|---|
| `JEV_API_KEY` | yes | — |
| `JEV_BASE_URL` | no | `https://api.typesafe.ai/v1` |
| `JEV_MODEL` | no | `typesafe-ai/jev` |

OpenRouter, TypeSafe direct and the Vercel AI Gateway all serve
`POST {base}/systemone` with `{ model, state, questions }`, so one function
reaches all three and the user's router stays the user's business.

**A Jev that cannot answer stops the dispatch**, before the worktree and before
the spend, with a sentence — the same contract `checkHost` already has. It does
not fall back to the brief's score. A mode you believe is on and is silently is
not is worse than a mode that failed out loud.

## Consequences

- This is SOBER's first outbound HTTP call and its first API key. DESIGN §5.1's
  "never asks for an API key" now reads "unless you turn Jev on" — the reason
  behind it (SOBER does not own the tool loop) is untouched, because Jev owns no
  loop either. It answers questions; it does not run the node.
- The config is read from the base ref (ADR 0019), so a run cannot turn Jev on,
  point it at another router, or widen its own skill list.
- `dispatch.jevSkills` is maintained by hand. SOBER cannot enumerate the skills
  a host has installed, and guessing at a list would be worse than an empty one.
- An extra round trip on every dispatch when the mode is on.

## Alternatives rejected

- **Jev picks the tier directly.** Fewer moving parts, but it takes the budget
  decision away from the person paying the bill.
- **A `brief.skills` field, schema v6.** Auditable and visible on the board, at
  the cost of a schema step and a migration for a value that is re-derived every
  time anyway.
- **The AI SDK's `experimental_evaluate`.** The first npm LLM dependency in the
  repo, and it still needs per-router provider wiring for the two routers that
  are not the Gateway. The wire format is one POST; a dependency is not warranted.
