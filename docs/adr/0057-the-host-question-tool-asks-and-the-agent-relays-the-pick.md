# 0057 — The host's question tool asks, and the agent relays the pick

- **Status:** accepted
- **Date:** 2026-09-10
- **Supersedes in part:** [ADR 0010](0010-what-a-host-session-may-accept.md) —
  "The choice comes from MCP elicitation, not from the agent" and "A host
  without elicitation cannot accept". [ADR 0048](0048-codex-and-opencode-get-a-plugin-and-an-adapter.md)
  — "no tool takes an answer". The rest of both stands: one record per call,
  no batch, no default, and no earlier remark treated as a reply.

## Context

On 2026-09-10, in Claude Desktop, `decide` on
`kullanici-isini-yaparken-yakalanan-bir-o-bqou` returned "The human did not
answer. Nothing was recorded." No prompt ever appeared on screen. The host
declares the elicitation capability, so `NoElicitationError` never fired; the
form was simply not shown, and the result came back as a non-accept, which
`askChoice` read as a dismissal. The refusal path 0010 and 0048 rely on was
skipped, and the human was told they declined something they never saw.
`approve` and `accept` go through `askYes` and fail the same way. Codex is
likely the same; unverified.

0048 had already moved the rule from mechanism to reason — the pick comes from
the human, never from the agent — and told the skills to use the host's own way
of asking. But it kept "no tool takes an answer", so a host's own question tool
(AskUserQuestion in Claude Code and Claude Desktop, and its equivalent in each
other adapter) had nowhere to hand the answer except the CLI.

## Decision

**The host's own question tool asks, and the agent relays the pick.** On every
adapter the skills ask with that tool: for a decision, the question and the
option labels only; for a brief or a merge, a yes and a no. OpenCode has no such
tool, so there the agent asks in the conversation and waits for a reply that
names the option.

**`decide`, `approve` and `accept` take the answer and no longer elicit.**
`decide` requires `option`; `approve` and `accept` require `confirmed: true`, so
the call itself is the human's yes. Core still refuses an option the decision
does not offer and a decision already answered. `askChoice` is deleted.

Every tool description and skill says the same thing: one question per call,
the labels exactly as listed, and pass exactly what the human picked — never an
option they did not pick, never a pick carried over from earlier in the
conversation, never a list. A reply that matches no option is not mapped to the
nearest one; the agent says so and asks again.

## Consequences

- A question that never renders no longer reads as a decline. The human sees
  the question in the same control every other question uses.
- **The record cannot tell a relayed pick from a human one.** `Answer` in
  `packages/schema/src/decision.ts` is unchanged, and nothing stops an agent that
  ignores the skill from answering alone. Every `approve` and `accept` inherits
  the same hole. This is accepted because a question that never renders is
  worse: it fails the human every time, on hosts that claim to support it.
- Hooks and the skills are what hold the rule now, not the protocol. Where a
  host does not load the skills, SOBER advises rather than enforces, as §2.9
  already says.
- **The elicitation-only remainder.** These still ask through elicitation and
  still refuse on a host without it: `edit_decision`, the overlap confirmation
  in `run` (`packages/mcp/src/tools/build.ts`), `sync`'s conflict form
  (`askFields`), `team.ts` and `distribute.ts`. A host whose elicitation does
  not render fails there the same way. They move when they are next touched.

## Alternatives rejected

- **Keep elicitation and detect a form that never rendered.** The protocol gives
  no way to tell a dismissal from a form that was never shown.
- **Relay only through the CLI.** `sober decide <id> <option>` works, but a
  question tool that has nowhere to hand its answer except a shell command is
  the friction 0010 rejected in the first place.
