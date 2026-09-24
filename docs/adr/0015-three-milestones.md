# 0015 — Three milestones, and what M1's gate is

- Status: accepted
- Date: 2026-08-28

## Context

After ADRs 0006–0014, v1 carries 13 MUSTs, roughly 100 requirements and 18 ADRs, for one junior developer. In several dimensions that is larger than what v0 actually shipped, and v0 failed.

The build order made it worse by putting the first end-to-end run at the end of the dashboard phase. So sync, conflict resolution, the digest, the stale flow and the pull request path would all be built before the loop had ever closed once — and the dashboard, which was 42,696 lines in v0 against `core`'s 13,352, would be written while the product was still being discovered.

ADR 0009 changed what is possible here. With planning in a host session, the dashboard is no longer on the path to a working product. Walking `SCOPE.md`'s seven steps: frame, decompose, decide and brief happen in a session; dispatch, review and advance happen in the CLI. None of the seven needs a screen.

`SCOPE.md` already defines this test, for its SHOULD list: "None of them is required for the loop to close once. That is the whole test." This applies the same test one level down, to ordering inside v1.

## Decision

The MUST list does not change. Three milestones order it.

**M1 — first light.** Phases 0–3. `schema` (records), `core` (storage, derived status, DAG, brief rendering, worktree lifecycle, run log, error taxonomy, archive), `cli`, `mcp`, the plugin, the Claude Code adapter, `secretlint`, and the integration harness. Not in M1: the board branch and sync, conflict resolution, contributors and claim, the dashboard, the draft pull request and CI, the digest, the stale flow and impact preview, schema migration.

**M2 — team.** Phase 4. Board branch, sync, field-level conflict resolution and post-merge validation (ADR 0013), contributors, assignment, claim, the same-files warning at dispatch, the draft pull request and CI. Before the dashboard, because it is `core` and `cli` work and `STRUCTURE.md`'s own rule is that parallel work sits behind a frozen contract — the dashboard should consume a finished `core`, not grow beside one.

**M3 — dashboard.** Phase 5. `packages/server` and the wire contract (ADR 0008), canvas, node panel, decision screen, review screen, digest, stale flow, impact preview.

**M1's gate is a script, not a sentence.** On a real repository:

1. `npm i -g @besober/cli`, then `sober init`
2. In a Claude Code session, `/sober-plan`, intent in free text
3. See the proposed nodes and edges; accept as a batch
4. Open a decision, options are produced, pick through elicitation
5. Ask for a node's brief, read it, approve it
6. `sober run <node>` — worktree created, `dispatch.setup` runs, the agent works
7. The run finishes, the scan runs, `sober review <node>` shows the diff and the findings
8. `sober accept <node>` — local merge, worktree removed
9. A downstream node moves off `blocked`

Two deliberate cuts in M1:

- **Editing an answered decision is refused**, with "not yet". The impact preview (D19) and the stale flow are M3. Being unable to do something beats doing it without the preview D19 exists to provide.
- **Archive stays in M1.** It is a file move, and without it §8.3 leaves a referenced node with no way to be removed at all.

## Consequences

Estimates, in focused days of 5–6 hours:

| Phase                                 | Days  | Cumulative                  |
| ------------------------------------- | ----- | --------------------------- |
| 0 skeleton, CI, harness, packaging    | 3–4   | 4                           |
| 1 `schema`                            | 2–3   | 7                           |
| 2 `core`, no sync                     | 8–11  | 18                          |
| 3 `cli`, `mcp`, plugin, adapter, scan | 8–11  | **21–29 — M1**              |
| 4 sync, team, pull request and CI     | 8–12  | **29–41 — M2**              |
| 5 dashboard and server                | 14–20 | **43–61 — M3, v1 complete** |

M1 is roughly 5–7 calendar weeks at four days a week; v1 is 3–4 months part-time. The total came down from an earlier 54–81 even though MUST grew from 11 to 13, because the dashboard left the critical path and the advisory subprocess was dropped.

The least reliable estimate in the table is the last row, which is where the least reliable estimate belongs.

`CHARTER.md` is not weakened. v1 ships with a dashboard and it is the primary surface. M1 is an internal milestone — the version shipped to oneself. `SCOPE.md` rule 1 is untouched: nothing outside MUST is built.

The value of the cut is arithmetic. If the product is wrong, M1 finds out after 21–29 days instead of 43–61.

## Alternatives rejected

- **Build in the documented phase order.** The loop first closes at the end of the dashboard phase, which repeats v0's shape: most of the code written before the product is understood.
- **Cut requirements instead of ordering them.** `SCOPE.md` rule 1 forbids building outside MUST; it says nothing about sequence. Ordering needs no requirement to be dropped.
- **Dashboard before sync.** Puts the largest phase against a `core` that is still changing underneath it.

> Correction, 2026-08-29: the dashboard figure above is wrong. Re-measured with `git ls-files`, v0's dashboard was 8,892 lines of TypeScript against `core`'s 13,352; the old number counted `dist/`. The argument stands on order, not size (`REVIEW-2026-08-29.md` §2.1).
