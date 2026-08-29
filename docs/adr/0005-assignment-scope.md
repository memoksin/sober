# 0005 — Claim and assignment in v1, distribution in v1.x

- Status: accepted
- Date: 2026-08-27

## Context

`SCOPE.md` MUST #8 requires the board to travel over git for "a small team, human
and agent, working one project in parallel". It says nothing about who works on
what. Four capabilities were proposed:

1. a claim — one person takes a node, and the team sees it;
2. assignment — nodes handed to named contributors ahead of time;
3. AI distribution — nodes allocated by matching each contributor's role and focus;
4. chain claim — one developer taking a whole dependency chain as a unit.

## Decision

**Into MUST #11:** a contributor list (`.sober/contributors.json`) and per-node
assignment and claim. A node can be assigned to a named contributor, and claimed
by whoever starts it. Both travel with the board.

**Into SHOULD (v1.x):** AI distribution by role, and chain claim.

The split is where the loop stops needing the feature. Two people cannot work in
parallel without knowing who has what, so claim and assignment are v1. Allocating
work *intelligently* only improves a loop that already closes.

## Claim is a signal, not a lock

SOBER does not build permissions. `SCOPE.md`'s WON'T list already rules out
accounts and a server, and the access control question is answered by the git host:
someone who cannot push to the board branch cannot break a claim, and an outside
contributor forks and opens a pull request as they would on any project.

So a claim announces intent to the team; it does not enforce exclusivity. SOBER
warns when two people are heading for the same node. It does not stop them, because
stopping them would require an authority SOBER deliberately does not have.

## Consequences

- `SCOPE.md` gains MUST #11; AI distribution and chain claim join SHOULD.
- `contributors.json` is board state, on the board branch, not configuration.
- No request-and-approve flow and no claim expiry in v1. Both were considered:
  a request flow adds a record type and a screen for a problem a pull request
  already solves, and expiry depends on detecting abandonment, which is not
  reliable.
