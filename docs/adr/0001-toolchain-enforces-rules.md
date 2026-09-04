# 0001 — The toolchain is chosen to enforce rules, not to be fast

- Status: accepted
- Date: 2026-08-27

## Context

v0 shipped a working product and failed by its own charter. Its rules lived in `CLAUDE.md` as prose: "core is the only package that touches `.sober/*`", "no POSIX-only primitives", "80% coverage", "one package, one concern". None of them could fail a build. Nothing in the repository type-checked at all. Three runtime defects reached the browser in a single session with 192 tests green.

The failure was not the rules. The rules were right. The failure was that no mechanism made breaking one cost anything.

## Decision

Rebuild rather than reform, and select every tool in the v1 toolchain against one criterion: **which prose rule does this turn into a red CI check?**

| Tool | The rule it enforces |
| --- | --- |
| pnpm | A package importing something it does not declare fails to resolve. Phantom dependencies become impossible, not discouraged. |
| Turborepo | `typecheck`, `test`, `build` in dependency order, cached. One command, one answer, locally and in CI. |
| tsc + project references | `strict`, `noUncheckedIndexedAccess`. Zero errors is the floor. |
| dependency-cruiser | "Only `core` touches storage" becomes a checked graph rule. Also forbids cycles and app-to-app imports. |
| Biome | Lint and format in one tool, and the `no-restricted-imports` rules for POSIX-only primitives. |
| Vitest + coverage threshold | 80% is a config value that fails the build, not a sentence in a doc. |
| Changesets | A PR without a changeset cannot merge. Changelogs are generated, never written. |
| commitlint | Conventional commits, checked on every commit and the PR title. |
| GitHub Actions | Five required checks on every PR — `lint`, `typecheck`, `test`, `boundaries`, `build` — with no admin bypass. v0 allowed the bypass and it was used. |

CI must be green on the empty repository before any product code exists. The ratchet predates the work.

## Consequences

- Setup is slower than v0's. That is the price and it is paid once.
- A rule that cannot be expressed as a check does not get written down as a rule. It gets written down as a preference, in `MANIFESTO.md`, and it binds nobody.
- The v0 repository is kept private as `memoksin/sober-v0`, tagged `archive/v0`. It is a source to mine, never a base to build on.

## Alternatives rejected

- **Reform v0 in place.** The debt was not in the code, it was in 57 board nodes that patched decisions nobody had recorded. Carrying the board forward carries the debt forward.
- **Add the checks to v0 and fix what goes red.** Nothing type-checked; the first `tsc` run would have been a rewrite wearing a migration's clothes.
