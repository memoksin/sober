# 0010 — What a host session may accept

- Status: accepted
- Date: 2026-08-28

## Context

ADR 0009 moves planning into a host session. That raises the question the one hard block exists for: can a decision be answered there?

`DESIGN.md` §2.4 sets the rule and its reason: "The human sees the draft pre-filled and accepts **one decision at a time** — never one accept for a batch, which is the rubber stamp this rule exists to prevent."

A conversation is the easiest place in the world to rubber-stamp. "They all look fine, accept them" is one line. The alternative — leaving the session to answer in the dashboard — is friction with nothing to show for it: the human has already read the options in front of them.

There is a second, subtler risk. A tool that takes a decision id, a choice and a rationale can be called eight times by the agent itself: "given what you said earlier, option 1 fits all of these." That is the same rubber stamp, executed by the agent.

## Decision

**A session may accept, one record per call.** The tool takes a single decision id, never a list. The same applies to brief approval, which `PR-04-05` already scopes to one node at a time. Node proposals may be accepted as a batch, as `PR-02-05` already allows.

**The choice comes from MCP elicitation, not from the agent.** The server asks the host to put the question to the human; the host shows it; the human picks; the answer returns to the server. The agent opens the decision and does not supply its answer.

**A host without elicitation cannot accept.** The tool refuses and points at the decision screen or the CLI. This is §2.9's existing pattern, applied: "A host without working hook support is a host where SOBER advises rather than enforces, and the docs must say so rather than claim enforcement everywhere."

**Proposals are written to disk as they are made**, with `suggested` set and no `answer` (the shape ADR 0020 replaced `draft: true` with). §2.4 already defines a draft as open, so a drafted decision holds its nodes exactly as an unanswered one does. Acceptance is a separate call.

**The dashboard does not generate proposals.** Its empty state points at `/sober-plan`. A user with no MCP-capable host creates nodes by hand, which `PR-02-06` keeps available permanently.

## Consequences

- The one hard block survives the move into a conversation: the pick is a human action the agent cannot perform, and it happens once per decision.
- Nothing is lost if a session crashes mid-planning. The drafts are on disk, and the audit trail shows who accepted what and when — §2.4's requirement that an accepted draft be indistinguishable from a typed answer still holds.
- Elicitation support becomes a documented per-host property, not an assumption.
- Two surfaces are enough for M1: the session for authoring and approving, the CLI for dispatch and review. The dashboard is M3.

## Alternatives rejected

- **Read-only tools; every acceptance in the dashboard or the CLI.** Safest, and it was the first proposal. Rejected because the human has just read the options in the session; sending them elsewhere to click the same choice again is friction that teaches people to avoid the tool.
- **Let the agent supply the answer, with a written rationale.** Unenforceable — the agent can write the rationale too. This is the rubber stamp with a paper trail.
- **Hold proposals in the session until accepted.** Attractive while the conversation is open; loses everything when it is not, and puts the acceptance record in a chat log instead of the board.
