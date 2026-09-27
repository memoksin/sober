# TODO — CI, verify and node runs

Shared work list for any agent (Claude Code, Codex, …) on `development`. Same rules as `docs/RUN-COST-TODO.md`: take the first `[ ]`, mark `[~]` while on it and `[x]` when done, add one Log line, commit only when the user asks.

---

- **Date:** 2026-09-27
- **Why:** almost every node PR failed CI. Root causes found:
  - `dispatch.verify` was `null`, so no CI gate ran on a node.
  - The prompt never named the gates: coverage ratchet, exports snapshot, biome.
  - Local `development` was 23 commits ahead of origin, so PR CI judged each branch against a base it did not have.
- **Done on 2026-09-27:**
  - Checks and gates:
    - `pnpm verify` (lint, typecheck, boundaries, coverage, ratchet) is now `dispatch.verify`.
    - The ratchet notes a rise; only a drop fails.
    - Core and exports tests got longer timeouts.
    - Integration retries twice.
  - Runs:
    - A running node is not started twice.
    - A failed run's uncommitted work is committed on its branch.
    - Claude's limit result is recorded with its words.
    - A red verify resumes the session once.
  - Accept and PRs:
    - Accept verifies the merged tree when the base moved.
    - A draft PR is held while the base is ahead of its remote.
    - MCP waves send progress.
- **Verify time on this machine:**
  - 35 min before the Windows Defender exclusions (repo, `%TEMP%`, `git.exe`, `node.exe`).
  - 10 min after.
  - Without the exclusions, a git spawn costs ~108 ms idle.

## Open

- [ ] **Coverage below baseline on `development` (blocks every node's verify).** Measured on clean HEAD 89fe877; none of it comes from the 2026-09-27 changes:

  | Package | Baseline | HEAD 89fe877 |
  |---|---|---|
  | cli | 21.86 | 21.71 |
  | core | 98.48 | 97.15 |
  | dashboard | 74.46 | 74.13 |
  | server | 95.90 | 95.19 |

  Worst files:
  - core: `host.ts` 188–222, 281–283; `models.ts`; `sync.ts`
  - server: `routes.ts`
  - dashboard: `models/Models.tsx` (59 lines), `panel/Correct.tsx`

  Fix with tests. Never lower `coverage-baseline.json`.
- [ ] **Integration flakes behind `retry: 2`** (`vitest.config.ts`). Two are known:
  - Windows: `test/integration/review.test.ts` fails with "fatal: not a git repository" mid-suite.
  - macOS: a git clone race fails with "failed to copy file … No such file or directory".

  No cause was found; each test has its own `mkdtemp` root. Find the cause, then remove the retry.
- [ ] **`dispatch.timeoutMinutes` is 30.**
  - decision-open-ix9z run pt1y was killed at 30:00 while a 210 s test command ran.
  - Decide: raise it, or split large nodes.
- [ ] **Test the timeout branch of the verify fix.** When a resumed fix hits the time limit, `keepUncommitted` runs (`dispatch.ts`). This branch is not covered.
- [ ] **The keep commit runs git hooks.** There are none today. If a pre-commit hook is added, it can refuse half-done code and the files stay uncommitted (a log line says so). Decide whether to use `--no-verify` there.
- [ ] **A verify that cannot run at all does not block accept** (`verifyMerged` in `review.ts`, when `judge` returns null). This matches `greenNodes`. Decide whether it should refuse instead.
- [ ] **Accept-time verify is slow.**
  - It runs the full `pnpm verify` (~10 min) in the main checkout, and MCP `accept` blocks for that time.
  - It does not run `pnpm install` when the merge changed the lockfile.
- [ ] **Shared registries are only a planning convention** (CLAUDE.md "Agent checks"). The overlap guard sees them only if a node's `files` lists them. Enforcing this in `plan` or `overlaps` is not done.
- [ ] **The coverage floor rises only by hand.** A rise no longer fails, so someone has to run `pnpm coverage:update` on `development` now and then. Consider running it at release.
- [ ] **Leftover node state from 2026-09-27:**
  - decision-open-ix9z: its last run failed on the timeout; 8 uncommitted files are in its worktree; its acceptance never ran.
  - why-report-mglr: its branch holds snapshot fix 44b5975, not pushed. It shows "last run failed" because of the double-run bug, which is now fixed.
  - Re-run CI on the open draft PRs #88–#98 after `development` is pushed.

## Log

- 2026-09-27 · Claude Code · Research (Jev-ranked) and all recommendations implemented. Full `pnpm verify`: 1340 tests pass in 10 min; the ratchet fails only on the pre-existing drops above.
