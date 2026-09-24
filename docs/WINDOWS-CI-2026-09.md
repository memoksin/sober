# Where the Windows integration minutes go (2026-09)

Measurement only. Nothing here changes a test's behaviour; the fix, if any, is a later node.

## Sources

- **CI** — run 34283791186 (PR #8), read from `gh run view --json jobs` step times and `gh run view --log`. Reproducible by anyone with repo access.
- **Local** — one full `SOBER_FIXTURE_STATS=1 pnpm integration` on an Apple Silicon Mac, 2026-09-15, green (29 files). Reproducible by running that command.
- **Pending** — the Windows fixture counters. This node may not push; the instrumentation that produces them is committed (below), so the next CI run on this branch prints them. See "Open".

## Instrumentation left in place

- `.github/workflows/ci.yml`: `pnpm integration` is split into `pnpm build` and `pnpm vitest run --project integration`, so GitHub times each step. Same commands, same order.
- `test/integration/fixture.ts`: with `SOBER_FIXTURE_STATS` set, one stderr line per repository created (`sober-fixture create <ms>`) and per cleanup (`sober-fixture cleanup <ms>`). Unset, it prints nothing. The `rmSync` call and its options are unchanged; it is only timed.
- Read a run with: `rg -o 'sober-fixture (create|cleanup) \d+ms'` on the job log.

## 1. Phase timings (CI, run 34283791186)

| Phase | ubuntu | macos | windows |
|---|---|---|---|
| Job total | 2m47s | 4m09s | 14m14s |
| Setup (checkout, pnpm, node) | 6s | 11s | 24s |
| `pnpm install --frozen-lockfile` | 4s | 5s | 9s |
| Build (`turbo run build`) | 10.4s | 6.9s | 12.5s |
| Suite (`vitest run`, Duration) | 144.3s | 222.1s | 803.2s |

Job totals are from step timestamps (the node's 2m49s / 4m11s / 14m16s include queueing). Build and suite are from turbo's `Time:` and vitest's `Duration:` lines inside the single `pnpm integration` step.

**Finding:** the install hypothesis is wrong. Install is 9s on Windows. The suite is 94% of the Windows job, and 659s of the 687s gap to ubuntu.

## 2. Ten slowest test files (CI, per file ms, test count in brackets)

| # | ubuntu | macos | windows |
|---|---|---|---|
| 1 | cli 25.6s (18) | conflict 31.9s (23) | conflict 124.0s (23) |
| 2 | sync 17.6s (14) | sync 30.0s (14) | sync 94.2s (14) |
| 3 | pr 10.2s (28) | cli 21.2s (18) | board 63.7s (17) |
| 4 | mcp 9.7s (45) | pr 18.4s (28) | mcp 63.3s (45) |
| 5 | conflict 9.7s (23) | mcp 14.2s (45) | pr 61.9s (28) |
| 6 | team 8.7s (15) | board 12.7s (17) | cli 60.1s (18) |
| 7 | wire 7.1s (24) | team 10.0s (15) | pack-install 34.3s (1) |
| 8 | distribute 6.5s (9) | wire 8.2s (24) | audit 33.4s (14) |
| 9 | pack-install 5.3s (1) | review 7.8s (20) | queue 29.4s (15) |
| 10 | review 5.1s (20) | distribute 7.0s (9) | dispatch 27.7s (18) |

Windows/ubuntu ratio per file ranges from 1.3x (`theme`, no git) to 22x (`worktree`). The git-heavy files are the 12–17x ones: `board` 16.6x, `fixture` 16.1x, `digest` 14.6x, `conflict` 12.8x. The slowdown follows git and filesystem work, not test count.

## 3. Process spawning (local)

- Repositories created in a full run: **347** (one per `createTempRepo()`; 29 files).
- `createTempRepo()` spawns six `git` processes. Measured on macOS: median 57ms, max 82ms, total **20.0s** of a 176.6s suite (11%).
- Upper bound from the fixture alone on macOS: 347 × 82ms = 28s. This excludes the git calls the tests make themselves, which are far more numerous.
- Windows: not measured yet. Process creation on Windows is known to cost several times more than on Unix, but that is a hypothesis; the CI counter answers it.

## 4. Cleanup retries (local)

- 347 cleanups, total **3.4s**, median 8ms, max 26ms. **Zero** took ≥100ms, so on macOS the `maxRetries: 10, retryDelay: 100` budget never fired and costs nothing.
- Windows: not measured yet. A cleanup ≥100ms in the CI counter means at least one retry fired; the count of such lines is the answer.

## Open

- Push this branch (or let `sober run`'s draft PR do it) and read the Windows `sober-fixture` lines to fill in sections 3 and 4 for Windows and the split build/suite steps. Until then, sections 3–4 are macOS-only.

## Options not taken

Considered and deliberately left alone, one line each:

- Share one temp repository between cases in a file — rejected here: breaks ADR 0014's no-shared-state rule.
- Mock git on Windows — rejected here: ADR 0014 requires real git.
- Drop or narrow the Windows matrix leg (e.g. run it only on `main`) — not taken; path separators, line endings and worktree locking are why it exists.
- Split or shard the suite across Windows runners — not taken; out of scope.
- Reorder the suite so git-heavy files run first or in parallel — not taken; `fileParallelism: false` is deliberate.
- Template repository copied instead of six `git` spawns per fixture — not taken; changes how the fixture creates a repo.
- Turn off Defender scanning of the temp directory, or move `TMP` to a Dev Drive — not taken; changes the runner, not measured.
- Lower or remove the `rmSync` retry budget — not taken; locally it never fires, Windows pending.
- Change the 25-minute timeout — not taken; nothing is failing.
