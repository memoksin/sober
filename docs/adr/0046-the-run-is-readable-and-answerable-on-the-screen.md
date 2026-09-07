# 0046 — The run is readable on the screen, and a watched one can be answered

- Status: accepted
- Date: 2026-09-07
- Reverses: ADR 0045
- Refines: ADR 0008, ADR 0036, ADR 0037
- Moves: `SCOPE.md` SHOULD "Live session view" → MUST #14

## Context

ADR 0045 examined the M3 gate's finding 4 — a run cannot be watched from the
dashboard at all — and left it out of v1. Its reasoning was sound and its
conclusion was scoped to v1: "the gate found a real gap and not a new fact",
and "SSE is the shape when it arrives, and the run log is its first subject".

v1 is code-complete. This is the first item of v1.x, and it is the item ADR 0045
named. Nothing here contradicts that record; it spends the price that record
stated.

Two things found while building changed what the price is.

**`EventSource` is not the only push shape.** ADR 0036 priced this work at
moving the loopback token into the URL, because `EventSource` cannot set a
request header, and ADR 0045 repeated that price. It is `EventSource`'s price,
not the channel's. A streaming `fetch` reading `response.body` *can* set
`Authorization`, and `serve.ts` has an explicit argument for keeping the token
out of the query string — "a query string would put it in the server's log line
and in `Referer`". The exception ADR 0008 was told to expect does not have to be
spent.

**"Answering its prompts" is two different features wearing one sentence.**
`SCOPE.md`'s SHOULD line reads "Live session view — watching a dispatched agent,
answering its prompts". A dispatched agent today cannot ask anything: `host.ts`
gives it `stdio: ['ignore', …]`, `--permission-mode bypassPermissions`, and a
system prompt (`NO_HUMAN`) that tells it in as many words that no question it
asks can be answered. That prompt is the M2 gate's finding 1: two of five
dispatches stopped to ask a permission nobody was there to give and finished
with an empty branch.

So there are two things underneath "answering its prompts":

1. **The conversation.** The agent says something and a human replies. This
   needs an open stdin, `--input-format stream-json`, and a system prompt that
   says somebody is reading.
2. **Tool-permission prompts.** These do not travel as messages. The host routes
   them through a control protocol to an SDK host
   (`claude --permission-prompts host`), which is a second protocol to
   implement.

## Decision

**The run is readable on the screen, live, on a screen of its own.** A watch
channel, `GET /watch/logs`, holds a connection open and sends one window of
rendered lines at a time. `core` gains `followRun`, which reads a run's log from
a byte offset and reports whether the run is still live.

**The channel is a streaming `fetch` over newline-delimited JSON, not SSE.**
`EventSource` is the only client that needs SSE's framing and the one client
that cannot send a header, so choosing it would spend ADR 0008's token exception
to buy a format nothing here reads. **ADR 0008's token rule is unchanged, and
the exception ADR 0036 and ADR 0045 both pre-authorised is not spent.** It
remains available for whoever needs a real `EventSource`.

**Attended dispatch is a second mode, opt-in, and never the default.**
`dispatch(paths, node, { attended: true })` opens stdin, adds
`--input-format stream-json` and `--replay-user-messages`, and swaps `NO_HUMAN`
for `A_HUMAN_IS_WATCHING`. Everything else about the run is identical — same
worktree, same judging, same records — so there is one dispatch path rather than
two.

`bypassPermissions` **stays in both modes.** What moves is who the agent is told
is reading, not whether it must ask before acting. Answering tool-permission
prompts stays on the SHOULD list as its own line.

**An answer is a file, not a pipe.** `answerRun` appends to `<run>.in`; the
process that owns the host reads that file and relays each line to the child's
stdin. Answering is available from every surface (`PR-09-08`), so the writer is
usually a second process — the dashboard server, or a second terminal — and a
file is what the two share. This is exactly the mechanism `stop` already uses,
and it was chosen for the same two reasons: it works on all three platforms, and
nothing reaches into a process it does not own. `c708806` is why that second
reason is not theoretical.

**`answer` is an operation, so it is on all three surfaces.** `sober say`, the
session's `answer` tool, `POST /op/answer`. `stop` sets the precedent: it
changes no board record either, and `PR-09-08` is about abilities a surface has
rather than which file an operation writes.

**A run ends the way it always did.** An attended session exits when its input
closes, which `answer --done` does; `stop` still kills one, and the dispatch
timeout is still the backstop. No new lifecycle, no re-attach, no pid file
beyond the one that exists.

## Consequences

- **`SCOPE.md` gains MUST #14** and loses the SHOULD line, which is what the
  scope rule requires. Tool-permission prompts are added to SHOULD in its place,
  so the half that was not built is written down rather than implied.
- **The wire gains a third shape.** `/op` and `/read` answer once; `/watch`
  stays open. `routes.test.ts` pins `WATCHES` to exactly `logs`, beside the
  assertion that pins `READS` — a sixth read and a second watch both have to
  argue for themselves.
- **`READS` is unchanged.** ADR 0045's "the wire contract gains no fifth read"
  survives: the log is watched, not read, which is the distinction ADR 0036 drew
  when it named the run log as polling's one exception.
- **`core`'s barrel is at 100 of 100** (ADR 0028) — `followRun` and `answerRun`,
  and nothing else. ADR 0045 said a new export would be "a signal to check the
  design before writing an ADR to raise the ceiling". Two new capabilities `core`
  must own because only `core` touches the filesystem, and the ceiling is met
  rather than raised. **The next name to go in needs an ADR.**
- **The panel stops pointing at a terminal.** ADR 0045's landing — a running node
  naming `sober logs <node>` — was the honest thing to say while the screen could
  not show a run. It now says "Watch the run", because a pointer somewhere else
  is what a surface says only while it is missing the thing.
- **An idle tab costs nothing.** The channel is opened by the log screen and
  closed when it unmounts; a live run's log is `stat`ed every 250ms *while
  somebody is reading it*, and a finished run's channel closes itself because
  nothing will append to that file again. This is the answer to the cost question
  ADR 0036 said the phase must not let drift. The server-side `stat` is not the
  polling ADR 0036 ruled out: that objection is about the wire, and the wire here
  carries a line exactly when there is one.
- **An attended run left alone waits.** It stays open for a reply until `stop` or
  the timeout, which is why "Run and watch" is a second button rather than what
  "Run" does. A wave and the queue never set it.
- **The M2 gate's finding 1 is pinned by a test**, not by the absence of a
  reason to break it: `HOST_ARGS` must contain `NO_HUMAN` and must not contain
  `--input-format`.

## Alternatives rejected

- **`EventSource` with the token in the query string.** What ADR 0036 and ADR
  0045 both expected. Rejected once a streaming `fetch` was shown to keep the
  header: the auto-reconnect it buys is worth little here, because the server's
  lifetime is `sober dashboard`'s (ADR 0037) and a dropped channel means the
  command stopped — reconnecting to a process that is gone is a spinner instead
  of a sentence.
- **A sixth polled read, `GET /read/logs`.** ADR 0045 rejected this for v1 and
  the reason has not changed: ADR 0036 named the run log as the one place
  polling is clearly the wrong shape.
- **A refreshing tail instead of a live one.** Smaller, and it would have
  satisfied "readable after the run ends". It was offered and turned down: the
  SHOULD line says *live session view*, and half of it is the conversation, which
  a refresh cannot carry.
- **One dispatch mode, with `NO_HUMAN` dropped everywhere.** The honest version
  of "just make runs answerable". It reinstates the M2 gate's finding 1 exactly:
  a wave stalls on question one of node one with nobody watching.
- **Answering tool-permission prompts in this change.** A second protocol
  (`--permission-prompts host` and its control messages) for the half of the
  feature nobody named as the reason the gate found this. It is on SHOULD with
  its own line, which is where the next person will find it.
- **An in-process registry of live attended runs instead of a file.** Simpler,
  and it makes `sober say` impossible from a second terminal — which breaks
  `PR-09-08` for the operation this ADR just added to the catalogue.
