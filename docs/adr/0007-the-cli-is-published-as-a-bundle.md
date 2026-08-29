# 0007 — The CLI is published as a bundle

- Status: accepted
- Date: 2026-08-28
- Revised: 2026-08-29 — bundler named; `@arethetypeswrong/cli` replaced by a
  pack-and-install smoke test; the dependency count corrected

## Context

`STRUCTURE.md`'s publishing table says `cli` is published and `core` is
**never** published. `cli` depends on `core` as `workspace:*`, which resolves to a
real version at publish time — of a package that is not on the registry. So
`npm i -g @besober/cli` fails while resolving its dependencies, and that command
is the whole subject of `PR-00-01`. The same holds for the dashboard server and
the MCP server, both also "never published" and both consumed by `cli`.

`SCOPE.md`'s Appendix A carried the sentence that hid this: "`workspace:*`
resolves at publish time." It does — but only to something published.

v0 chose the other way out: it published `core` with "not a stable public API" in
its description. `STRUCTURE.md`'s "never" row is a reaction to that, and the
reaction is right. What was missing was what replaces it.

## Decision

`cli` is published as a **bundle**. A build step inlines every workspace
dependency, so the published package declares no `@besober/*` dependency at all.
`schema`, `core`, `server` and `mcp` stay `private: true` and never reach the
registry.

Also settled here, because all three are publishing concerns:

- The dashboard's built assets are written into the CLI's `dist` before packing,
  by a `prepack` script.
- **`publint`** becomes a required CI check on the published package, and so does a
  **pack-and-install smoke test**: pack the tarball, install it globally in a
  temporary directory, run `sober --help`, assert the exit code.
- `engines.node` is `">=22"`, `packageManager` is pinned in the repository, and CI
  installs with `--frozen-lockfile`. Raising the Node floor takes an ADR.

**The bundler is `esbuild`**, called from a build script of roughly twenty lines.
Measured on 2026-08-29: `tsup` had one release in twelve months and `unbuild` had
none, so both are out on maintenance; `tsdown` is actively developed but still
0.22.x, and what it adds over `esbuild` is `.d.ts` bundling and configuration
ergonomics. Nothing published here is imported, so **no `.d.ts` is produced at
all** — which removes the hardest and most fragile part of the job, and with it
most of the reason to take a wrapper.

The choice belongs in phase 0 because it touches `tsconfig`, `turbo.json` and the
CI workflow, all of which the bootstrap sequence writes in its first sitting.

## Consequences

- One install, one version, one changelog. This is the reasoning the publishing
  table already gave for shipping the MCP server as a subcommand rather than a
  package; it now applies to the whole product.
- A `cli` and `core` version mismatch on a user's machine becomes impossible.
- Stack traces point into the bundle, so sourcemaps are required.
- A dependency that loads modules by name at runtime cannot be bundled, and neither
  can a native one. With the local state driver dropped (ADR 0018), the published
  package declares exactly one dependency: `secretlint`, which resolves rule
  packages by name and is therefore left external (ADR 0011). It is pure
  JavaScript with no install script, so `PR-00-01` holds — "no runtime dependency"
  was never the requirement, "nothing to fetch or compile at install" was.
- The smoke test is what proves any of this. It catches a missing file, an
  unbundled dependency, a broken shebang, a wrong `exports` field and a runtime
  module resolution failure, in one check — and it is the only thing that actually
  exercises `PR-00-01`. `@arethetypeswrong/cli` was the earlier choice here and is
  dropped: it checks whether TypeScript consumers get correct types, and this
  package has no importable entry point and no types to get wrong.
- `schema` is no longer published at the end of phase 1. "Frozen" becomes an
  ADR-gated internal rule rather than a version on npm — the argument for keeping
  `core` private applies harder to the contract every phase consumes, since a
  contract is learned by consuming it. Whether `schema` is ever published is a
  post-v1 decision, by ADR.

## Alternatives rejected

- **Publish `core` (and `server`, and `mcp`) with a warning in the description.**
  v0's choice. The publishing table's own reason stands: phases 2–4 are exactly
  when `core` most needs reshaping, and a README note is a request, not a
  contract.
- **Keep `workspace:*` and hope the publish tool resolves it.** It does resolve
  it, into a range that cannot be installed. This is the defect, not the fix.
