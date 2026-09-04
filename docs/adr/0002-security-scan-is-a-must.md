# 0002 — A security scan of every dispatch result is a v1 MUST

- Status: accepted
- Date: 2026-08-27

## Context

`SCOPE.md` lists the Auditor — automated checks on a finished node — as SHOULD, for v1.x. `SCOPE.md` rule 2 requires an ADR naming the new fact before anything moves from SHOULD into MUST.

The requirement that prompted this was "SOBER must not produce code with security holes". As stated it is not testable: SOBER does not write the code, the dispatched agent does, and SOBER cannot guarantee another model's output.

## Decision

Split the Auditor. The security scan of a dispatch result moves into MUST as `PR-09-06`; the rest of the Auditor stays SHOULD.

Every dispatch result is scanned for leaked secrets and injection-shaped changes **before** it is shown for human review. A failed scan is surfaced in the review, never silently dropped and never auto-rejected — the human still decides.

## Consequences

- `SCOPE.md` gains MUST #9.
- Phase 3 (`cli`) or phase 4 (`dashboard`) cannot ship review without the scan.
- The scan is a filter on what the human sees, not a gate on what the agent produces. SOBER guarantees the review path, not the model.

## What new fact justifies it

Review with no scan asks a human to spot a leaked key in a diff they did not write. That is the one review failure a machine reliably prevents and a human reliably does not — so it belongs on the path that already exists (MUST #5), not in a later version that adds a second path.
