# 0025 — One writer at a time on one machine

- Status: accepted
- Date: 2026-08-29
- Amends: `DESIGN.md` §1.1, §1.2

## Context

`DESIGN.md` §1.2 defines optimistic concurrency, but only for board-branch sync between machines (M2). Nothing covers two writers on the _same_ machine, and there are three from M1 onward: the CLI, the MCP server inside a host session, and — from phase 5 — the dashboard server. All three write `.sober/` directly.

The failure is a lost update, not a corrupt file: accept a node in the dashboard while `sober run` writes the same record, and one of the two writes disappears with no error. Per-file granularity (§1.1) narrows the window; it does not close it, because a single action touches several files (a node, its decision, the project record) and must land as one unit.

v0 solved this — `storage.ts:336-370`, an `O_EXCL` lock file plus a PID liveness check — and v1 inherited none of it. The PID check was also POSIX-only (`process.kill(pid, 0)`), and v1's CI runs on Windows (ADR 0014).

## Decision

**One lock per project, held for the length of a write.**

- `.sober/local/lock` — under `local/`, so it is gitignored and never syncs.
- Acquired with `O_EXCL`. The file holds the owning process's id, its host, the action name, and a `heartbeat` timestamp refreshed while the lock is held.
- **Staleness is decided by the heartbeat, never by a signal to a pid.** A lock whose heartbeat is older than the stale window is broken and taken over, and the takeover is reported. Pid-liveness is not portable and a recycled pid is a false positive on every platform.
- Waiting is bounded: a writer that cannot acquire within the wait window fails with a message naming the holding action and host. It never blocks forever, and it never proceeds without the lock.
- **Reads do not take the lock.** A reader that hits a half-written file falls to the broken-record path (§8.4). Atomic writes (§1.1) make that window empty in practice; the lock exists for lost updates, not for torn reads.
- The lock covers a whole action, not a single file, so a multi-file action is all-or-nothing against other local writers.

Both windows — stale and wait — are config values, not constants in code, because a slow filesystem is a real machine and not a bug to be argued with.

## Consequences

- Every writer in `core` goes through one acquire/release path, next to `writeRecord()` (§1.1). A surface that writes `.sober/` without it is a bug that the phase 2 review looks for by name.
- Cross-machine conflicts stay §1.2's problem; this lock says nothing about them.
- A crashed process leaves a lock that the next writer breaks after the stale window, and says so. No manual cleanup step, and no silent takeover.
- A dispatch that hangs does not hold the lock for its whole run: the lock spans the write, not the agent's session. Run duration is `DESIGN.md` §5.4's timeout.

## Alternatives rejected

- **Lock per file.** A single action writes several records; per-file locks make half an action visible to the other writer, and add deadlock ordering rules for nothing.
- **Port v0's pid-liveness check.** POSIX-only, and wrong on a recycled pid. The heartbeat is the same amount of code and works on all three platforms.
- **A lock daemon or a socket.** A server process to protect a directory of JSON files, in a tool whose local state is deliberately files (ADR 0018).
- **Rely on atomic writes alone.** Atomic writes prevent torn files; they do nothing about two writers reading the same record and both writing it back.
