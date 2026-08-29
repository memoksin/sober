# 0008 — The dashboard has a server, and the wire contract lives in `schema`

- Status: accepted
- Date: 2026-08-28

## Context

`DESIGN.md` §4 names a dashboard server: "The CLI, the dashboard server, and later
the MCP server call into `core` and never touch storage themselves."

`STRUCTURE.md` has no such package. Its layout carries `apps/dashboard # React +
Vite`, and its build order gates that phase on "consumes `core` only".

That gate cannot be met. `core` owns the filesystem, git, and local state. A
browser bundle cannot import it — Vite fails to resolve `node:fs`. So an HTTP
boundary exists in every working version of this product, and it appeared in no
layout, no phase, and no dependency-cruiser rule. It is also where the heaviest
phase begins: v0's dashboard was 42,696 lines against `core`'s 13,352.

A second confusion sits next to it. `SCOPE.md`'s WON'T table excludes "Hosted
sync, accounts, a server". That means a remote, account-holding service. The
dashboard needs a process on the user's own machine that dies when the dashboard
closes. One word, two things.

## Decision

The server is its own package, `packages/server`. `apps/dashboard` is the browser
client and imports `schema` only. The CLI starts the server; the server calls
`core`.

The wire types — request and response shapes — live in `schema`, alongside the
record types. No new package, no new dependency. They are written at the **start**
of M3, before any screen.

Four rules go into `.dependency-cruiser.cjs`:

1. `apps/dashboard` may not import `core` or `server` — only `schema`.
2. Only `core` may import `node:fs`, `node:child_process`, or run `git`.
3. `cli` may not import `apps/*`.
4. No cycles.

The server binds loopback TCP on `127.0.0.1`, port `0`, plus a token — the rule
`DESIGN.md` §9 already sets for IPC, applied here rather than restated.

The canvas is served a slim projection — id, title, derived status, dependencies —
not full node records. Full records are fetched when a panel opens.

`SCOPE.md`'s WON'T row becomes "a **hosted** server".

## Consequences

- Rule 1 turns "the dashboard consumes `core`" from a sentence that cannot be true
  into a build failure when someone tries.
- `cli` stays thin, as its layout comment claims.
- One package more. With ADR 0007's bundling, the user still installs one thing.
- M3 opens by writing the contract instead of discovering it, which is what keeps
  the largest phase from growing against a boundary nobody agreed on.

## Alternatives rejected

- **Put the server inside `cli`.** Defensible, and simpler by one package. But the
  layout calls `cli` thin, and the client/server boundary would then run through
  the middle of a package, where dependency-cruiser cannot name it. v0's `server.ts`
  was the file three parallel agents collided on; that layer does not stay small.
- **A separate `packages/api` for the wire types.** A package for a handful of
  types, before anything has shown they churn differently from the records.

> Correction, 2026-08-29: the dashboard figure above is wrong. Re-measured with `git ls-files`, v0's dashboard was 8,892 lines of TypeScript against `core`'s 13,352; the old number counted `dist/`. The argument stands on order, not size (`REVIEW-2026-08-29.md` §2.1).
