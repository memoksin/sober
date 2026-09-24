# 0037 — The dashboard's server outlives the browser tab

- Status: accepted
- Date: 2026-09-06
- Corrects: ADR 0008

## Context

ADR 0008 drew a line between a hosted service, which `SCOPE.md` excludes, and
the thing the dashboard actually needs. It described the latter as "a process on
the user's own machine that dies when the dashboard closes." That sentence was
written to say *not hosted, not an account, not a daemon that lives forever*,
and for that purpose it was right.

ADR 0036 then put `run` on the dashboard. A dispatch spawns an agent process,
owns a git worktree, opens a draft pull request, and spends real money. Read
literally, ADR 0008's sentence ties the most expensive operation in the product
to the most casual gesture in the operating system: closing a tab.

The M2 gate is the reason this is not a hypothetical. Two of five dispatches
finished with an empty branch and their work staged in a worktree (ADR 0034),
and the thing that made it recoverable was that the run record and the worktree
outlived the confusion. A run killed by a closed tab would leave the same debris
with less explanation.

There is a second, quieter reason. `sober stop` has already been wrong once in
exactly this area: `c708806` fixed a version that could kill the process which
*owned* the run rather than the run itself. Process ownership in this product
has drawn blood, and the cheapest defence is to not add a second ownership
model.

## Decision

**The server's lifetime is `sober dashboard`'s.** The command starts the server,
prints the loopback URL and the token, and stays in the foreground. Closing the
browser tab stops nothing. `Ctrl-C` in that terminal stops the server, and the
runs it started go with it — which is precisely what `sober run` does today, so
it is the behaviour the user already has rather than a new one to learn.

**Runs stay owned by the process that started them.** No detached spawn, no pid
file, no re-attach on restart. `core`'s dispatch code is unchanged by the
dashboard's arrival; the server calls the same function the CLI calls.

**ADR 0008's sentence is corrected**, not reinterpreted. The clause that
mattered — no hosted service, no account, nothing that survives a reboot or
listens off `127.0.0.1` — stands exactly as written. What is withdrawn is the
implication that the browser is what holds the process up.

## Consequences

- `sober dashboard` is a foreground command, and its help text says what
  `Ctrl-C` takes with it. A dispatch started from the screen and abandoned by
  closing the terminal is a documented outcome rather than a surprise.
- ADR 0025 is unchanged and now covers one more caller: the server takes the
  same file lock every `sober` command takes, so a command run in a second
  terminal while the dashboard is open meets the lock and says so. One writer at
  a time on one machine, with the server counted as a writer.
- Nothing in `core` grows a lifecycle. The dashboard is a surface over the same
  dispatch path, which is what keeps the M3 contract test meaningful.
- The M3 gate gets a step it would not otherwise have had: start a run from the
  screen, close the tab, reopen it, and find the run still there.

## Alternatives rejected

- **Detach the agent and re-attach by pid.** It makes runs survive everything,
  and it buys that with the failure class this product has already shipped once:
  a pid that outlived its process, and a `stop` that killed the wrong thing.
  Worth revisiting the day someone actually wants a run to survive a reboot; no
  one has asked.
- **Let the tab own the server.** ADR 0008 read literally. It ends with a
  half-finished dispatch every time someone closes a window, and the evidence
  from the M2 gate is that a silently abandoned run is the expensive kind.
- **Take `run` off the dashboard** (ADR 0036's rejected parity-minus-dispatch).
  It answers the lifetime question by deleting the operation, breaks
  `PR-09-08`, and makes "the same loop with no terminal" untestable.
- **A background daemon started on demand.** This is the thing `SCOPE.md` and
  ADR 0008 were jointly refusing. A process the user did not start and cannot
  see is not a local tool.
