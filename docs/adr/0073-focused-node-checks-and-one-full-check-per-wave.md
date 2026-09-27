# 0073 — Focused node checks and one full check per wave

Date: 2026-09-28

Status: accepted by the user in the implementation request.

## Decision

`dispatch.verify` checks each node. An optional `dispatch.waveVerify` checks the
combined tree once before accepting up to four reviewed nodes. It is opt-in and
supports local merge acceptance. A single accept still runs the full wave gate;
batching is explicit, through `sober accept --green` or MCP `accept_wave`.

Every node in a wave must have passed its node checks and acceptance commands,
have a clean scan and clean worktree, and have no decision flag. CI, when present,
must have passed. The human accepts the exact reviewed list; approval of a brief
remains per node. This extends ADR 0057's single-node acceptance invocation only
for an explicitly reviewed wave.

Merge all members, run the full command once, then record acceptance. A merge or
verification failure restores the base and retains every node branch/worktree.
If the checkout changes, refuse acceptance and keep the merges for manual recovery.
Recheck node records, run identity, branch heads and the clean checkout before
recording acceptance. Refresh dependencies when a merged lockfile changes.

## This repository

`pnpm verify:node` compares committed changes with the base. It runs lint, typecheck
and the touched packages' tests, plus explicitly changed integration tests. Docs
only need lint. Shared exports, build/test configuration, lockfiles and unmapped
files fall back to `pnpm verify`. The selection is deterministic and printed.
This is a repository script, not a universal language-specific rule inside SOBER.

SOBER node PRs into development get focused checks. Development pushes and other
PRs retain the full coverage gate and the three-platform integration matrix.
The coverage floor is checked on the full combined suite, never on partial coverage.

## Consequences

Four small nodes share one full verification instead of four. Package tests are
the first version's unit of selection; dependency effects are covered by the wave
gate. No cached test result is reused across changed trees. Full verification is
still needed for larger changes and can still fail on the existing coverage debt.
