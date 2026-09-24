# 0052 — Cursor gets a plugin and an adapter, from a published reference rather than a running binary

- Status: accepted
- Date: 2026-09-08
- Moves: SCOPE SHOULD → MUST #20
- Refines: ADR 0010, ADR 0046, ADR 0048, `DESIGN.md` §2.9, §5.1, `BUILD-PLAN.md` §6

## Context

ADR 0048 built two of the three candidate hosts and said plainly why it stopped there: "Cursor's headless invocation cannot be read off an installed CLI here, so its adapter would be written from memory — which is the one thing BUILD-PLAN §6 forbids." `SCOPE.md` has carried that sentence as its reason ever since.

The fact underneath it has changed. Cursor now publishes a CLI reference: a parameters table, an authentication page, a headless page, and an output-format page that prints a complete NDJSON event sequence as its own worked example. That is what BUILD-PLAN §6 asks for — its wording is "each host's current documentation, at the moment you implement the adapter" — and it covers every row the adapter table has: the probe, the run, the permission flags, and five event shapes.

What has not changed is that the CLI is not installed on the machine this was built on. So this work meets BUILD-PLAN §6's bar and not ADR 0048's, which was higher: every Codex and OpenCode flag has a recorded invocation behind it. The gap is named here rather than glossed, and it is named again in `docs/testing/v1x-5-cursor.tdd.md`, because a reader who assumes a recording exists will trust the two unknowns as much as the twenty knowns.

## Decision

**MUST #20 — Cursor, plugin and adapter.** The fourth host, built the same way as the second and third: a table row in `hosts.ts`, a plugin package, and the same skills from the same source.

Five things are settled with it.

**The evidence bar is the published reference, and the two unknowns are written down.** The flags, the probe and the event shapes are all in the reference. Two things are not: the name the installer actually puts on the PATH, and the keys of the object `status --format json` prints. The first is handled by accepting two names (below); the second by not using the flag at all — `status` prints a sentence the authentication page documents, and the sentence is what the adapter reads. Guessing a JSON key would be exactly the invention §6 exists to prevent.

**A host is found by a name that is its own.** Cursor installs its CLI as `agent`. Accepting that word would make every wrapper script called `agent` a Cursor invocation by accident — the small version of the unknown-host default ADR 0048 refused, and the same failure mode: a machine where the user believed it was configured. So the adapter answers to `cursor` and to `cursor-agent`, and a bare `agent` is refused by name, with the refusal saying what to do about it. This is the first adapter with an alias; the field exists because one host needs it, not because a host might.

**Two flags are the invocation, and neither is obvious.** `--force` is the analogue of `bypassPermissions` — the reference is blunt that without it "changes are only proposed, not applied", which is the empty-branch failure the M2 gate found in another costume. `--trust` is Cursor's alone: a dispatch cuts a worktree the host has never seen, and an untrusted workspace stops for a prompt nobody is there to answer. It is documented as headless-only, which is exactly this case.

**A colliding stream is not a new rule, and one collision is not benign.** Cursor's `stream-json` is Claude Code's, event for event, except for tool calls. ADR 0048's rule — the first adapter that recognises the shape owns the line — turns out to need no change: four of the five shapes are rendered correctly by an adapter with another host's name on it, and Cursor's adapter adds only the fifth. Writing a second full renderer would be two copies of one shape waiting to disagree, with half of it unreachable.

The exception is `type: "user"`. Claude Code emits it only under `--replay-user-messages`, which is attended mode, and what it carries is what the human said (ADR 0046). Cursor emits it on **every** run, carrying the brief SOBER itself just sent. Left alone, every Cursor run log opened with the whole brief — `NO_HUMAN` included — in the half of the transcript kept for the human's own words, on a host that cannot be attended at all. So the answer line is keyed on what SOBER writes rather than on the event's name: an answer goes to stdin as `{type, message}` and comes back echoed, with no session on it, while a host echoing its own prompt stamps the session it belongs to.

**Where a host can ask, it asks.** Cursor's MCP client supports elicitation, so `decide` puts the question on screen here rather than refusing. This is the second host where ADR 0010's mechanism is available rather than merely described, and it is what ADR 0048 meant by keeping the rule while dropping the assumption: the pick comes from the human, and elicitation is one shape of asking rather than the definition of it.

The plugin ships in Cursor's own format (`.cursor-plugin/plugin.json`) rather than the portable Agent Plugins one, because Cursor's is the only one of the two that can later carry a hook, and hook enforcement beyond Claude Code is the SHOULD this host is the best candidate for.

## Consequences

- `SCOPE.md` gains MUST #20 and loses the Cursor SHOULD row. Its SHOULD list keeps hook enforcement beyond Claude Code — now with Cursor named as the host where it is a scope decision rather than a host limitation — keeps attended dispatch beyond Claude Code, and gains one new line: that Cursor's adapter has a reference behind it rather than a recording.
- `DESIGN.md` §5.1's table gains a fourth column and a third consequence; §2.9 gains the two sentences that separate "this host cannot" from "this plugin does not".
- `core` gains one optional field on `Adapter` and two on `Event`. No new export, so the ceiling does not move (ADR 0028).
- `packages/cursor-plugin` is new. `scripts/build-plugins.mjs` writes a fourth copy of the same six skills.
- The fake host set gains `test/integration/hosts/cursor.mjs`, and it is the first one whose header says its shapes came from a reference rather than an invocation.
- `hosts.test.ts` and `test/integration/other-hosts.test.ts` cover four hosts where they covered three, and the latter gains an assertion that no headless run produces an `answer` line — the property the prompt echo broke.
- **What is proven and what is not.** The tests dispatch to Cursor end to end against a real repository, a real worktree and a real child process, with the host faked (ADR 0014) from the published sequence. They do not prove that a live Cursor session drives the loop, that the installed binary is named what the reference says, or that `agent status` prints the sentence the authentication page quotes. That is a gate, and `docs/testing/v1x-5-cursor.tdd.md` says so rather than claiming what it did not run.

## Alternatives rejected

- **Installing Cursor's CLI to record the flags off a running binary.** ADR 0048's bar, and it buys the last two unknowns at the price of installing software and spending a Cursor account on the machine the product is built on. §6 names documentation as the source; the reference now is one. The cost is disclosed instead of paid.
- **Waiting for the CLI to be installed before building either half.** The same wait ADR 0048 already priced once, now against a published reference rather than against nothing. The thing that was missing has shipped.
- **Accepting `agent` as a name for Cursor.** See above: least surprising to type, and the most generic word on anybody's PATH.
- **Giving Cursor a full event renderer of its own.** Four of five shapes are Claude Code's, key for key. Half the renderer would be unreachable and all of it would be a second opinion about one shape.
- **Leaving the prompt echo labelled as an answer.** No diff at all — it already rendered. What it rendered was a machine's own instructions in the human's half of an audit trail.
- **Keying the answer line on the absence of a `session_id` in Cursor's adapter instead.** The same discriminator, expressed as a new concept in the adapter table ("events this host writes that render as nothing"). One extra field and one extra branch in `renderLine` to say what one condition already says.
- **The portable Agent Plugins manifest.** Cursor reads it, and it is the shape the Codex plugin already nearly has. It cannot carry a hook, and the hook is the one thing this host might get next.
- **Shipping a hook in the Cursor plugin now.** It would move a second `SCOPE.md` line inside one ADR, and the plugin that claims a guard it has not been tested with is worse than the one that says it has none.
