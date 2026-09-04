# SOBER v1 — Monorepo structure and toolchain

## Why this shape

v0's rules lived in `CLAUDE.md` as prose: "core is the only package that touches `.sober/*`", "no POSIX-only primitives", "80% coverage", "one package, one concern". None of them failed a build. Measured in the archived repository: **zero** `tsconfig.json` files, one CI job (`bun install && bun test`, Ubuntu only), 69 test files. Three runtime defects reached the browser.

Every tool below is chosen for the rule it turns into a red CI check. That is the only selection criterion (ADR 0001).

## Layout

```
sober/
├── .changeset/                 # release notes + version bumps
├── .github/
│   ├── CODEOWNERS              # * @memoksin; the ruleset requires a code-owner review
│   └── workflows/ci.yml
├── apps/
│   └── dashboard/              # React + Vite. Browser only. Imports schema.
├── packages/
│   ├── schema/                 # types + Zod, records and wire. THE CONTRACT.
│   ├── core/                   # graph model, storage, status derivation, git
│   ├── server/                 # HTTP over core. Serves the dashboard.
│   ├── mcp/                    # MCP server over core. Ships as `sober mcp`.
│   ├── cli/                    # bin: sober. Thin.
│   ├── claude-code-plugin/     # MCP config, commands, one skill
│   └── tsconfig/               # shared tsconfig presets
├── test/
│   └── integration/            # temp-repo fixture, fake host, fake gh
├── scripts/
│   └── coverage-ratchet.mjs    # coverage may not drop, per package
├── docs/
│   ├── CHARTER.md              # what SOBER is and is not
│   ├── SCOPE.md                # MUST / SHOULD / WON'T, + rejected alternatives
│   ├── PRODUCT.md              # requirements + the decision table
│   ├── DESIGN.md               # mechanism
│   ├── STRUCTURE.md            # this file
│   ├── BUILD-PLAN.md           # how it gets built, in what order, at what pace
│   ├── MANIFESTO.md            # how SOBER gets built
│   └── adr/NNNN-*.md           # one decision per file, MADR format
├── .gitattributes
├── biome.json
├── .dependency-cruiser.cjs
├── commitlint.config.js
├── coverage-baseline.json      # the committed floor the ratchet compares against
├── pnpm-workspace.yaml
├── renovate.json               # one grouped pull request a week
├── tsconfig.base.json
├── turbo.json
└── vitest.config.ts           # test.projects — vitest.workspace.ts was removed in Vitest 4
```

`apps/` vs `packages/` is the Turborepo convention: an app is deployed, a package is consumed. The dashboard client is an app; everything else is a package.

`server` exists because a browser cannot import `core` — `core` owns the filesystem, git and local state (ADR 0008). Leaving it out was the gap that would have surfaced in the last phase, where v0 wrote its dashboard — 8,892 lines, 427 commits — before the loop had ever closed.

## Toolchain

| Layer | Tool | The rule it enforces |
| --- | --- | --- |
| Workspace | **pnpm** | Strict `node_modules`. A package importing something it does not declare fails to resolve — phantom dependencies become impossible, not discouraged. |
| Task graph | **Turborepo** | `typecheck`, `test`, `build` run in dependency order with caching. One command, one answer, locally and in CI. |
| Types | **tsc + project references** | `strict: true`, `noUncheckedIndexedAccess`. Zero errors is the floor, not the goal. Never `any`, never `@ts-ignore` without an ADR. The full option list and the version pin are below. |
| Boundaries | **dependency-cruiser** | Four rules (ADR 0008): the dashboard client may not import `core` or `server`; only `core` may reach `node:fs`, `node:child_process` or run `git`; `cli` may not import `apps/*`; no cycles. |
| Lint + format | **Biome** | One tool for both. Also carries the `no-restricted-imports` rules for POSIX-only primitives. |
| Unit test | **Vitest** | Per-package coverage, ratcheted — never lower than the last commit. Vitest offers only a fixed threshold, so `scripts/coverage-ratchet.mjs` compares each package against the committed `coverage-baseline.json`: a drop is red, and a rise of more than a point is red until the baseline is refreshed in the same commit. A ratchet whose floor never rises is a threshold. `schema` excluded: a threshold on a types-and-Zod package produces tests written to reach a number. |
| Integration test | **Vitest + a temp-repo fixture** | Real git, real worktrees, a bare repository as the remote, a fake host executable, a fake `gh`, and the pack-and-install smoke test (ADR 0014). Its coverage counts toward the same number, or the git code contributes nothing and the ratchet points away from the risk. |
| Bundling | **esbuild** | `cli` publishes with workspace dependencies inlined, so the published package declares no `@besober/*` dependency (ADR 0007). No `.d.ts` is produced — nothing published here is imported. **Caveat to check in phase 0:** import the MCP SDK by subpath (`/server/mcp.js`, `/server/stdio.js`) so its HTTP transports do not drag `express` and `hono` into the bundle; the package is 4.1 MB across 693 files. |
| Publish shape | **publint** + a pack-and-install smoke test | `publint` checks `exports`, the file list and ESM/CJS shape. The smoke test installs the tarball in a temp directory and runs it — the only check that exercises `PR-00-01`. `@arethetypeswrong/cli` is not used: nothing here is importable, so there are no types to get wrong. |
| Secrets | **secretlint** | MUST #9's scanner, and a check on SOBER's own commits — `SCOPE.md` rule 4 applies to SOBER first. It resolves rule packages by name, so it is left external and is the published package's one dependency. |
| Versioning | **Changesets** | A PR without a changeset cannot be merged. Changelogs are generated, never written. Private packages are ignored, so the requirement stays meaningful. |
| Commits | **commitlint** | Conventional commits, checked on the PR title and every commit. |
| CI | **GitHub Actions** | Six required checks on every PR: `lint`, `typecheck`, `test`, `integration`, `boundaries`, `build`. `integration` runs on Windows, macOS and Linux, so `required_status_checks` names eight contexts. A seventh job, `audit`, reports CVEs and is deliberately **not** required — a vulnerability published tomorrow would block every merge for a reason no pull request caused. The owner's bypass is ADR 0026. |
| Dependencies | **Renovate** | One grouped pull request a week for minor and patch; a major waits on the dependency dashboard and is read on its own; GitHub Actions move together, monthly. Ungrouped, this is ten pull requests a week and they stop being read. |

Node is pinned at `>=22` in `engines`, `packageManager` is pinned in the repository, and CI installs with `--frozen-lockfile` (ADR 0007). There is no native module: local state is files (ADR 0018). The Windows job exists for git's behaviour — path separators, line endings, file locking on worktree removal — which is a better reason than a native module was.

## The TypeScript configuration

`tsconfig.base.json` is the one place compiler options are set; `packages/tsconfig` adds `types: ["node"]` and every package extends that. Each option is a rule, not a preference:

| Option | What it forbids |
| --- | --- |
| `strict` | The whole family, `strictNullChecks` first. |
| `noUncheckedIndexedAccess` | `arr[i]` typed as `T` when it is `T \| undefined`. Nearly every crash v0 shipped was an index or a `Map.get` treated as present. |
| `module` / `moduleResolution: nodenext` | Guessing. The repository is **ESM only**: every relative import carries its `.js` extension, and a CJS-only dependency has to be handled deliberately, not discovered at runtime. |
| `verbatimModuleSyntax` | An import of a type that survives into the emitted JavaScript. Type imports must say `import type`. This is what keeps `packages/schema` from pulling runtime weight into `apps/dashboard`. |
| `isolatedModules` | Anything a single-file transpiler cannot compile — `const enum`, re-exported types without `export type`. esbuild compiles file by file, so this is not a style rule; without it the bundle is wrong. |
| `noUnusedLocals` / `noUnusedParameters` | Dead code, at the moment it is written. |
| `noImplicitOverride` / `noFallthroughCasesInSwitch` | Two silent-failure shapes: a method that stops overriding after a rename, and a `case` that falls through by accident. |
| `composite` / `declaration` | Project references need both; `tsc --build` then rebuilds only what changed. `cli` opts out — nothing imports it, and esbuild does its build. |

**TypeScript is pinned at 6.x, deliberately.** `create-turbo` scaffolds 7.0.2, but dependency-cruiser declares `typescript: >=2.0.0 <7.0.0` and says TypeScript 7 support waits on its API being published and stable. Taking 7 today means losing `boundaries`, and a required check outranks a compiler version. The pin is enforced by a Renovate rule as well as the lockfile, and lifts when dependency-cruiser ships TypeScript 7 support.

## Publishing

**One package is published, and it is published as a bundle** (ADR 0007).

| Package | Published | Why |
| --- | --- | --- |
| `cli` | **yes, bundled** | The gateway. Humans run it via `npx` / `-g`. Its build inlines every workspace dependency and every bundleable npm one, so it declares exactly one dependency — `secretlint`, which resolves rule packages by name and cannot be bundled. Pure JavaScript, no install script: nothing is fetched or compiled at install. |
| `schema` | no, in v1 | A contract is learned by consuming it; freezing it before four consumers exist is the brake the row below refuses for `core`. "Frozen" is an ADR-gated internal rule. Whether it is ever published is a post-v1 ADR. |
| `core` | never | Publishing it turns the internal API into a public API, and phases 2–4 are exactly when `core` most needs to be reshaped. |
| `server`, `mcp` | no | Bundled into `cli`. `mcp` ships as the `sober mcp` subcommand: one install, one version, one changelog. |
| `dashboard` | no | An app. Its built assets are written into the CLI's `dist` by a `prepack` script and shipped inside it. |
| `claude-code-plugin` | no | Distributed as a plugin, not on npm. |

Owning the `@besober` org means the whole namespace is already reserved. So publishing is never about claiming a name — it is only ever about taking on a semver contract, and exactly one package takes one.

## Build order

**The rule: parallel work is only safe behind a frozen contract.** v0's last session ran three agents in parallel and all three edited `server.ts`; the merge was manual. That is not an agent problem, it is a missing-interface problem.

The order groups into three milestones (ADR 0015). The MUST list does not change; only the sequence does.

| Phase | Package(s) | Mode | Gate to the next phase |
| --- | --- | --- | --- |
| 0 | repo skeleton, CI, integration fixture, docs | — | Six checks green on an empty repo, and one of them seen to fail on purpose. The ratchet exists before any code does. |
| 1 | `schema` | solo | Every type and Zod schema for project, node, decision and run — the fields M1 uses, no more (ADR 0020). Not published. |
| 2 | `core` | solo | Graph model, storage, derived status, DAG, brief rendering, worktree lifecycle, run log, error taxonomy, archive. No sync yet. Integration harness green against a real repository. The export-ceiling alarm ships beside the surface snapshot (`BUILD-PLAN.md` §10). |
| 3 | `cli`, `mcp`, `claude-code-plugin`, the Claude Code adapter, `secretlint` | solo | **M1 — the loop closes once**, on a real repository: planning from a host session, dispatch and review headless. The nine-step script is in `BUILD-PLAN.md`. The release workflow publishes with provenance and trusted publishing (`BUILD-PLAN.md` §10). |
| 4 | `core` sync, contributors, the pull request path | solo | **M2 — the board travels.** Two people share one board; conflicts resolve field by field; a merge cannot push a broken graph. CODEOWNERS names the barrels, and the admin bypass narrows (`BUILD-PLAN.md` §10, ADR 0026). |
| 5 | `packages/server`, `apps/dashboard` | solo | **M3 — v1.** The same loop closes from the dashboard with no terminal. |
| 6 | other host plugins and adapters, hook enforcement | **parallel** | v1.x. All SHOULD in `SCOPE.md`. Parallel because by then nothing new is being defined. |

Phases 1–3 are sequential because each one _defines_ what the next consumes. Phase 4 is before phase 5 for the same reason the rule above gives: the dashboard should consume a finished `core`, not grow beside one.

Requirements are elicited phase by phase, not all up front — see the elicitation table in `docs/PRODUCT.md`. A phase does not start before the sections it consumes are written. M3 opens by writing the wire contract into `schema`, before any screen.

## Definition of Done — every PR

1. Linked to a node whose decisions are all answered
2. Its diff stays inside that node's declared files. A diff outside them is **flagged in review**, next to the scan findings — the list is a prediction (`DESIGN.md` §3.1), and hardening this into a closed PR takes an ADR once the prediction's accuracy has been measured
3. `lint`, `typecheck`, `test`, `integration`, `boundaries`, `build` green
4. Coverage did not drop, in the package that changed
5. A changeset, unless the change ships nothing
6. New behaviour has a test that fails without the change. For behaviour that depends on real git state or a real subprocess, that test is an **integration** test — a unit test with git mocked tests the mock

## Bootstrap sequence

1. `pnpm dlx create-turbo@latest` into a clean directory, pnpm as the package manager
2. Strip the example apps and packages down to the layout above. Pin `packageManager` and `engines.node`
3. Add Biome, the root `vitest.config.ts` with `test.projects`, dependency-cruiser, commitlint, Changesets
4. Add `esbuild` and the `cli` build script, plus `publint`
5. Add `secretlint`, and `.gitattributes` with `merge=binary -text` for the board paths (`DESIGN.md` §1.2.1)
6. Build the integration fixture: a temp git repository, a bare repository as its remote, one trivial test that commits and pushes between them, and the pack-and-install smoke test
7. Write `.github/workflows/ci.yml` with the six required checks, `integration` on three platforms, `--frozen-lockfile` everywhere
8. Turn on branch protection for `main`: all six checks required, **no admin bypass**
9. Copy `CHARTER.md` and `SCOPE.md` in; ADRs 0001–0025 are already written
10. Break the ratchet on purpose: open a PR with a type error and watch it go red. A check nobody has seen fail is not known to work
11. Only then: phase 1
