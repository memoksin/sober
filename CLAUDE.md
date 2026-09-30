# sober

## Open work

- `docs/RUN-COST-TODO.md` — shared todo for run cost, limits and sessions. Read it before you start. Take the next item, tick it, and log it.
- `docs/CI-VERIFY-TODO.md` — shared todo for CI, `pnpm verify` and node runs. Same rules.

## Branch model

- Every change goes to `development` unless the user explicitly says otherwise.
- A PR into `main` is opened only when the user explicitly asks for one.
- A merge into `main` is a release. The user decides when a release happens — never open or merge one on your own initiative.
- Each release names its bump: patch, minor, or major.

## Changesets

- Never write a changeset for a node. A bump — patch, minor, major — is the user's choice at the release, not something a node guesses.
- CI asks for a changeset only on a pull request into `main`, which is the release.
- `@besober/cli` is the only published package. Everything else is `private: true` and ships inside that bundle (ADR 0007).

## Agent checks

- `pnpm verify` is exactly what CI gates, and SOBER runs it after every node run. It takes ~35 min on Windows — longer than a run's limit.
- Before you stop, run the fast part: `pnpm lint`, `pnpm typecheck`, and `pnpm exec vitest run --project <pkg>` for each package you changed.
- Changing a package's exports changes `exports.test.ts` snapshots: update them on purpose with `pnpm exec vitest run <pkg>/src/exports.test.ts -u` for that package only (running core and schema together with -u once deleted a snapshot file), and say so in the final message.
- Never edit `coverage-baseline.json` in a node; a drop is fixed with tests.
- Shared registries (apps/dashboard/src/App.tsx, apps/dashboard/src/covers.ts, packages/server/src/routes.ts, packages/core/src/index.ts, */src/__snapshots__/exports.test.ts.snap) go in a node's `files` when planning, so SOBER's overlap guard serialises nodes that touch them.

## Platform support

SOBER OS agnostic olmalıdır: CLI, çekirdek davranış ve testler Windows, macOS ve Linux üzerinde yerel olarak çalışmalıdır. Taşınabilir Node yol ve süreç API'lerini kullan. Harici araçlar için gereken OS farklarını ortak adaptörlerde tut ve üç platformun CI işlerinde doğrula. Platform hatalarını tekrar deneme veya test atlama ile örtmeden önce nedenini araştır.
