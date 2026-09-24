# 0054 — The published package carries no source map

- Status: accepted
- Date: 2026-09-08
- Refines: ADR 0007

## Context

ADR 0007 ends one of its consequences with a requirement: "Stack traces point into the bundle, so sourcemaps are required." The observation is right and the requirement was never met, because producing a source map and reading one are different acts, and only the first was built.

Node does not read a source map unless it is told to. `process.sourceMapsEnabled` is `false` by default on every version this package supports — measured on Node 24.19.0, two majors past the `>=22` floor — and nothing in the bundle turns it on: the shebang is a plain `#!/usr/bin/env node` and no call to `process.setSourceMapsEnabled` exists. So `dist/sober.js.map` was downloaded by every install and read by none of them.

The size it cost is not marginal. Of a 1.36 MB tarball the map was 0.83 MB gzipped — 60% of what a user downloads — and 3.79 MB of the 6.33 MB unpacked.

**Turning it on was tried first, and rejected on evidence.** A banner calling `process.setSourceMapsEnabled(true)` does not work: it runs inside the file whose map it would need, and by then the frames are already fixed — measured, the trace still pointed at `out.js`. What does work is `#!/usr/bin/env -S node --enable-source-maps`, which resolved a test bundle's frames back to `src/boom.ts`. It was rejected anyway, for two reasons that compound: `env -S` needs coreutils 8.30 or newer, and on Windows the shebang is not run at all — npm writes a shim, and whether that shim carries the argument through is exactly the kind of thing this repository has no check for. ADR 0007 promised a pack-and-install smoke test as a required CI check; it exists only inside `scripts/m1-gate.mjs` and its successors, which a human runs. Shipping a shebang whose failure mode is "the CLI does not start at all" behind no automated check is the trade this ADR declines.

## Decision

`packages/cli/package.json`'s `files` becomes `["dist", "!dist/**/*.map"]`. The build still writes the map — `esbuild`'s `sourcemap: true` stays — so anyone working in the repository keeps it. It simply stops being published.

ADR 0007's sentence is amended in place, because a reader who finds it there and believes it will look for something that is not in the tarball.

## Consequences

- The tarball goes from 1.36 MB to 0.54 MB packed, and from 6.33 MB to 2.54 MB unpacked. `publint --strict` passes on the narrower shape.
- A crash report from a user carries bundle coordinates — `sober.js:48231:12` — and turning that into a source location means building the same version and resolving it locally. The build is deterministic enough for that to work, and nothing guarantees it stays so.
- `dist/sober.js` keeps its trailing `//# sourceMappingURL=sober.js.map` comment, pointing at a file the tarball does not contain. Node ignores it unless source maps are enabled, and then fails to find it silently.
- The exclusion is written as a negation rather than a list of what to include, so a file added to `dist` later ships by default and only maps are held back.
- If a real crash report ever proves unreadable, the way back is the shebang above plus the smoke test ADR 0007 already asked for — in that order, not the reverse.
