# 0018 — Local run state is files, not SQLite

- Status: accepted
- Date: 2026-08-28
- Replaces: D3's and D12's choice of a database

## Context

D12 chose `better-sqlite3` for `.sober/state.db`, and D3 scoped that file to local
run state: "dispatch runs, an append-only audit log, and the version cache."

Three things changed the arithmetic.

`better-sqlite3` 13.0.3 unpacks to **26 MB across 68 files** with a native binding
and requires Node ≥ 22. It no longer has an install script, so `PR-00-01` is not
violated — but that is 26 MB inside a globally installed CLI, to hold a list of
runs, an append-only log, and one cached value.

ADR 0007 publishes the CLI as a bundle. A native module cannot be bundled, so
`better-sqlite3` would be the published package's only runtime dependency.
Dropping it leaves none.

And ADR 0013 removed the one thing that might have needed a query: the digest's
last-sync pointer, which turned out to be computable from git's own refs.

## Decision

No database. Local state is files, following §1.1's existing rule — one file per
entity:

```
.sober/local/runs/<runid>.json   # one file per run
.sober/local/log.jsonl           # append-only audit log
.sober/local/cache.json          # version check cache
```

`.sober/local/` is gitignored, one line.

One file per run answers the concurrency question outright: three parallel agents
write three different files, so there is no interleaving to guard against. A torn
line in the log falls under §8.4's existing rule — an unparseable record is
reported and the rest still loads, which is the right treatment for a disposable
log.

If a query ever genuinely needs an index, the move is to `node:sqlite`, which is
present in Node 22.5 and later and adds nothing to install. Verified on Node
24.19.0: it loads with no flag and no experimental warning.

## Consequences

- The published CLI carries no native dependency, and nothing that has to be
  fetched or compiled at install. One pure-JavaScript dependency remains —
  `secretlint`, which resolves its rule packages by name and so cannot be bundled
  (ADR 0007, ADR 0011).
- 26 MB and a native binding leave the install.
- `.sober/state.db` disappears from every document. §8.6's property is unchanged
  and slightly stronger: deleting `.sober/local/` loses run history and the version
  cache, and no decision or graph data.
- The Windows CI job is still required — ADR 0014 needs it for git behaviour, which
  is a better reason than a native module was.

## Alternatives rejected

- **Keep `better-sqlite3`.** A database for a few hundred rows of disposable local
  state, at 26 MB, in a package whose first requirement is a clean global install.
- **`node:sqlite` now.** Zero install cost, but still a schema, migrations, and a
  connection lifecycle for data that is a list, a log, and one value. Available the
  moment a query justifies it.
- **A single JSONL file for runs as well as the log.** One writer per file is what
  removes the concurrency question; three agents appending to one file is what
  reintroduces it.
