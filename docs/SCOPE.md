# SOBER v1 — Scope

Derived from the charter, not from the v0 board. The v0 board was 57 patches on decisions that were never written down; reusing it would import the same debt.

This file says **which** capabilities exist. It says nothing about order: the build order lives in `BUILD-PLAN.md`, and ADR 0015 splits v1 into three milestones without moving anything on or off the lists below.

## The loop

SOBER exists to run one loop. Everything in v1 serves a step of it; anything that serves none is out.

1. **Frame** — the human states intent for one project.
2. **Decompose** — that intent becomes nodes with dependencies.
3. **Decide** — a node bound by an open decision is held. Options carry their reason and what they cost later. The human picks.
4. **Brief** — a node whose decisions are all answered gets a prompt an agent can execute cold, with no second lookup.
5. **Dispatch** — every ready node runs as an isolated agent session, in parallel.
6. **Review** — the human sees what came back before it lands.
7. **Advance** — the graph recomputes: what is now unblocked, what can start.

If a proposed feature does not make one of these seven steps possible or correct, it is not v1.

## MUST — v1

| # | Capability | Which step | Why it cannot be cut |
| --- | --- | --- | --- |
| 1 | Graph model: nodes, dependencies, derived status | 2, 7 | "What can start now" is the orchestration pillar. Without derived status the graph is a to-do list. |
| 2 | Decision records: own records, nodes bind them, gate on any bound-and-open | 3 | The one hard block. Cutting it makes SOBER accelerated vibe coding — the exact failure the charter names. Gating on the _binding_ rather than on one flagged node is ADR 0006. |
| 3 | Node brief, required before dispatch | 4 | An agent that has to ask a second question has not been briefed. This is what makes automation safe. |
| 4 | Parallel dispatch: N isolated agent sessions, one branch each | 5 | The automation pillar is _parallel_ agents. One-at-a-time is a different product. |
| 5 | Human review before anything lands | 6 | The human owns intent. An agent that merges its own work owns intent. Review means check results against approved acceptance criteria; reading the diff is available, never required (ADR 0022). |
| 6 | Dashboard: graph canvas, node panel, decision screen, review screen | 1–7 | The charter names the dashboard the primary surface for the board. A dashboard-shaped gap is a product gap. |
| 7 | CLI mirroring every state-changing operation | 1–7 | The scriptable surface. Also the contract test: anything the dashboard can change, the CLI can change headless. |
| 8 | Team sync: the board travels over git | 2, 7 | "A small team, human and agent, working one project in parallel" needs a shared board. |
| 9 | Security scan of every dispatch result, before review | 6 | Review with no scan asks a human to spot a leaked key in a diff they did not write. Moved from SHOULD by ADR 0002; its tool and its rule list are ADR 0011. |
| 10 | Agent-proposed decomposition: intent → proposed nodes, edges and decisions, nothing landing without human acceptance | 1, 2 | Without it v1's first run is an empty board and thirty manual node creations. Moved from SHOULD by ADR 0004. |
| 11 | Contributors, assignment and claim, travelling with the board | 8 | Two people cannot work in parallel without knowing who has what. Added by ADR 0005. |
| 12 | MCP server: an agent inside a host session reads the board, proposes, opens decisions, writes brief approaches, and reviews | 1–7 | Three of the MUSTs above are agent work, and this is where that work happens — in the session the user already opened, with the repository already in context. Moved from SHOULD by ADR 0009. |
| 13 | The first host plugin: MCP configuration, commands, one skill | 1–4 | How MUST #12 reaches a host, and how a session learns the loop without being told again every time. Added by ADR 0009. |
| 14 | Live session view: watching a dispatched agent on the dashboard, and answering it | 5 | A dispatch is the longest and most expensive operation in the product, and it was the one thing the screen could not show. Moved from SHOULD by ADR 0046 — the new fact is the M3 gate's finding 4, which found the gap from inside the loop at the moment it costs most. |
| 15 | Hook enforcement in the Claude Code plugin: an agent spawn that names a held node is denied | 3 | MUST #2 is the one hard block, and MUST #12 opened the hole in it — inside a session the decision was only advice. Moved from SHOULD by ADR 0047, on the fact that the host it ships for does honour hook definitions. |
| 16 | Two more hosts, plugin and adapter each: Codex and OpenCode | 1–6 | One host is not an abstraction, it is a hard-coded invocation, and every host-shaped line in the product was written against Claude Code's. Moved from SHOULD by ADR 0048 — the new fact is that both now ship a skills directory and an MCP client, so the distance between them turned out to be four flags and three event shapes rather than a design. |
| 17 | The auditor: the acceptance list runs, and the review says what each command did | 6 | ADR 0022 made review "check results against approved criteria" and ADR 0027 made a criterion a command. Nothing ran them, so the review showed the list as text and asked a human to believe it — which is the diff-reading cost those two ADRs exist to remove. Moved from SHOULD by ADR 0049. |
| 18 | Chain claim: a run of linked nodes, named by its two ends, claimed and released in one act | 8 | Claiming one node at a time charged the most to whoever planned furthest ahead: a run of five linked nodes meant coming back four times, and between any two of them a teammate could take the next. Moved from SHOULD by ADR 0050 — the new fact is that the three readings of "a chain" return sets that do not overlap on a real graph, so it could not be built without first deciding which one it was. |
| 19 | AI distribution: a session proposes who takes which node, and a human accepts it or drops it | 2, 8 | A person looking at thirty nodes and four contributors had no help at all, and assignment was one node at a time by hand. Moved from SHOULD by ADR 0051 — two new facts: `focus` was free text nothing could match against, so the feature ADR 0005 described could not be built against the record it shipped; and ADR 0009's host session is now where a model runs, which is where the matching belongs rather than as a heuristic in `core`. It obeys the WON'T list's rule the same way MUST #10 does: it is proposed, never applied. |
| 20 | Cursor, plugin and adapter | 1–6 | The last of the four hosts, and the one ADR 0048 held back because its headless invocation had no released shape to read flags off. Moved from SHOULD by ADR 0052 — the new fact is that Cursor now publishes a CLI reference for `-p --output-format stream-json`, its flags and its event shapes, which is the source BUILD-PLAN §6 names. It is also the first host whose stream collides with another's, and the first outside Claude Code that can put a decision's question on screen. |

Derived from `CHARTER.md`. The vocabulary is fixed by ADR 0003 — a **decision**, never a "gate" — and by ADR 0009 for the three host-facing terms: an **adapter** launches a host headless, a **plugin** is installed into a host, and **hook enforcement** is what a plugin does about a held node.

**Education in v1 is exactly one thing:** every decision option shows its reason and what it costs later, and the same control serves the expert and the learner. No learner model, no knowledge map, no assessment. That is a v2 research problem wearing a v1 costume.

## SHOULD — v1.x, designed for but not built

- **Hook enforcement in the plugins beyond Claude Code.** For Codex and OpenCode this is still "host-dependent": Codex hashes hook definitions and silently ignores them until a human runs `/hooks`, and OpenCode has no elicitation for plugins (`DESIGN.md` §2.9). Cursor is different — it has hooks SOBER could use, and shipping none is a scope decision rather than a host limitation (ADR 0052). All three plugins ship saying so rather than implying a guard they do not have
- **Attended dispatch beyond Claude Code.** `codex exec`, `opencode run` and `agent -p` each take one message and exit, so a run dispatched to any of them cannot be answered while it runs, and SOBER refuses an attended run there rather than seating somebody in front of a session that cannot hear them (ADR 0048, ADR 0052)
- **A recording behind Cursor's adapter.** Every other flag in this product was read off an installed CLI; Cursor's were read off its published reference, because the CLI is not installed on the machine this was built on. What that does and does not prove is written down rather than glossed (`docs/testing/v1x-5-cursor.tdd.md`, ADR 0052)
- Answering a host's **tool-permission** prompts. MUST #14 is the conversation — the agent asks in a message and a human replies. A permission prompt travels a different way (`claude --permission-prompts host`, a control protocol to an SDK host), and it is a second protocol rather than a second button (ADR 0046)
- An agent definition shipped in the plugin, beyond the skill

Each of these is a real feature. None of them is required for the loop to close once. That is the whole test.

## WON'T — v1

| Not building | Why not |
| --- | --- |
| Hosted sync, accounts, a **hosted** server | The board is git-native. A hosted tier is a business decision, not a v1 feature. This does not exclude the local process the dashboard talks to (ADR 0008) — that dies when the dashboard closes. |
| Multi-project workspace | One project, one graph. Multi-project is a UI problem you cannot see until one project works. |
| Knowledge map, learner-level assessment, education analytics | Modelling what a human knows is unbounded research. The charter's education pillar is served by option reasons and costs. |
| Decomposition that lands without human acceptance | The human owns intent. A machine graph nobody evaluated is plausible and unevaluable at once. Proposing is MUST #10; landing unreviewed stays out (ADR 0004). |
| A distribution that lands without human acceptance | The same rule, one record over. Thirty nodes quietly acquiring an owner is a change nobody reviewed, and "an assignment is only a plan, so it is reversible" is not the test — "nobody evaluated it" is (ADR 0051). |
| Per-language static analysis of dispatch results | The scan ships a short, named signal list (ADR 0011). A real injection analyser needs one rule set per language a user might write in. |
| Anything that serves none of the three pillars | The charter's own rule. |

The WON'T list is the load-bearing half. A feature moves off it only by an ADR that says what changed.

## The scope rule

1. Nothing gets built that is not in MUST.
2. Moving something from SHOULD or WON'T into MUST requires an ADR in `docs/adr/` naming what new fact justified it.
3. A pull request touching code outside its node's declared files is **flagged in review**, next to the security scan findings (ADR 0011). The declared file list is a prediction (`DESIGN.md` §3.1); hardening this into a closed pull request waits until the prediction's accuracy has been measured, and takes an ADR.
4. SOBER gates itself from the first commit. If the gate is too heavy to dogfood, it is too heavy to ship.

---

## Appendix A — rejected alternatives

Ported from v0, where each was considered and rejected for a stated reason, and extended on 2026-08-28 by the review that produced ADRs 0006–0018. Reopen one only with new evidence, by ADR. The WON'T table above is scope; this appendix is mechanism.

### From v0

- **A shared server for team sync.** Means auth, hosting and a SaaS-shaped product — a different company. Git is the sync layer; merge conflicts on board files _are_ the collision detector.
- **Splitting node storage across two branches.** Archiving is a rename across the two, so a split puts a review gate between the halves of one move: a teammate syncing in between sees neither the node nor its archive entry, and everything downstream reads as blocked.
- **Auto-pulling the board when the dashboard opens.** Two concrete harms: a locally claimed but uncommitted node gets overwritten by the remote's stale copy with no warning; and git's line-based merge can leave literal conflict markers inside files every surface parses. Pulling is an explicit action. Fetching is not — see `DESIGN.md` §1.2.
- **Last-write-wins on concurrent edits.** Same silent-data-loss class. Optimistic concurrency with a 409 instead.
- **A workflow engine (Temporal, Airflow) for the DAG.** Infrastructure for distributed, long-running, cross-machine jobs. None of that applies to a few hundred local nodes.
- **Postgres for local state.** No multi-writer, no network client. SQLite covers it — and ADR 0018 found that files cover it without SQLite.
- **Independent per-package semver.** A caret range between siblings makes "which cli was tested against which core" unknowable. ADR 0007 settles this differently from the original note: the CLI ships as a bundle, so there is no inter-package range to get wrong.
- **A decision on every node with its own copy of every category** (v0's shape before 2026-08-27). 22 of 56 nodes sat blocked and none opened; four nodes existed only to patch the mechanism. Repetition, not rigour.
- **Deleting the hard block, or softening it to a warning.** It is SOBER's only enforcement mechanism and the surface where all three pillars meet. Without it the product is accelerated vibe coding, which the charter rules out.
- **Second-approver waivers.** Speculative approval flow. Self-waive with a logged reason until abuse is observed.
- **A question-authoring system or a per-stack template library.** SOBER ships the categories; the calling agent already has the reasoning to propose options.
- **Scoring the human's knowledge to tailor the question.** Depth belongs in the explanation, never in a different option set for a "beginner". A quiz before work is not education.

### From the 2026-08-28 review

- **Gating on a node's own `introduces` list.** A node binding a shared decision it did not raise passed every status check and reached `ready` — dispatchable, with an unanswered decision rendered into its brief. ADR 0006.
- **Deriving a dependency edge from a shared decision.** Makes a node wait for the introducer to be _accepted_ when all it needed was the answer. Serialises every shared decision and contradicts MUST #4. ADR 0006.
- **Publishing `core` with "not a stable public API" in its description.** v0's choice. A README note is a request, not a contract, and phases 2–4 are when `core` most needs reshaping. ADR 0007.
- **Publishing and freezing `schema` at the end of phase 1.** A contract is learned by consuming it; freezing it before four consumers exist is the brake the publishing table already refused for `core`. ADR 0007.
- **An advisory subprocess for decomposition, options and brief writing.** Eight unanswered questions — JSON enforcement, timeouts, cancellation, session cost, where it runs — for a worse result than a session that already holds the repository in context. ADR 0009.
- **Read-only MCP tools, with every acceptance in the dashboard.** Safest, and friction with nothing to show for it: the human has just read the options in the session. ADR 0010.
- **Letting the session's agent supply a decision's answer.** Unenforceable — it can write the rationale too. The pick comes from elicitation. ADR 0010.
- **`gitleaks`, `trufflehog`, or hand-written secret regexes.** The first two are separate binaries to fetch, against `PR-00-01`; the third is the reinvention this rebuild exists to avoid. ADR 0011.
- **A branch, worktree and draft pull request per attempt.** Two rejections left three of each, nothing collected the branches or the pull requests, and CI ran on every push. ADR 0012.
- **Whole-record conflict resolution.** Discards a co-editor's work whenever two people touch one record for different reasons. Field-level three-way merge instead. ADR 0013.
- **A custom git merge driver.** More machinery than one `merge=binary` attribute for the same outcome. ADR 0013.
- **Unit tests with git mocked at the module boundary.** Tests the mock. Every defect the merge rules exist to prevent lives in real git's behaviour. ADR 0014.
- **`better-sqlite3` for local run state.** 26 MB across 68 files with a native binding, inside a globally installed CLI, to hold a list, a log and one cached value — and a native module cannot be bundled. ADR 0018.
- **Drag-to-connect on the canvas.** Edges come from decomposition; manual editing is correction, which suits a list. It was also the only criterion separating the candidate graph libraries, and the one that required a five-year-old extension. ADR 0016.
- **Storing node positions on the board.** A conflict on every node move, over coordinates that mean nothing on a teammate's screen. ADR 0016.
- **Automatic dispatch of every ready node.** Removes the approval that is the last thing a human sees before an agent starts working. "Approve and queue" is per-node and opt-in instead. ADR 0017.

### From the v1.x work

- **Allocating work by a rule in `core` over `role` and `focus`.** Testable and reproducible, and what it buys is a score nobody can explain a week later. It also forces `focus` into whatever shape the rule can read, which is the controlled vocabulary the schema refused two milestones earlier. ADR 0051.
- **A distribution proposed in the conversation and never written down.** The smallest diff by a distance — `assign` is already on all three surfaces — and the plan then lives in a window that closes. A plan about four people that only one of them can see is not a plan the team can argue with. ADR 0051.
- **Writing `assignee` directly, on the grounds that §3.3 already calls it a plan.** The most defensible reading of the existing vocabulary, and it fails on volume: thirty silent owners is the unreviewed landing the WON'T list rules out. ADR 0051.
- **Reassigning a claimed node behind a confirmation.** ADR 0032's shape, which does not transfer: there the second call overwrites a claim with a claim, fact with fact. Here it would overwrite a fact with a plan, and the person holding the node finds out from a diff. ADR 0051.
- **Installing Cursor's CLI to record its flags off a running binary.** The bar ADR 0048 set, and it buys the last unknowns — the binary's real name, and the keys of `status --format json` — at the price of installing software and spending a Cursor account on the machine the product is built on. BUILD-PLAN §6 names *current documentation* as the source, and the reference now publishes both the flags and a full event sequence. What is not proven is written down instead of implied. ADR 0052.
- **Accepting `agent` as a name for Cursor.** It is what the installer puts on the PATH, so it is the least surprising thing for a user to type — and it is the most generic word on anybody's PATH. Any wrapper script called `agent` would become a Cursor invocation by accident, which is the small version of the unknown-host default ADR 0048 already refused. ADR 0052.
- **Giving Cursor a full event renderer of its own.** Four of its five shapes are Claude Code's, key for key, so a second copy would be two renderers for one shape waiting to disagree, and half of it would be unreachable behind the adapter that runs first. ADR 0052.
- **Leaving the prompt echo labelled as an answer.** The smallest possible diff: Cursor's `type: "user"` event already rendered, through Claude Code's adapter. What it rendered was the whole brief, `NO_HUMAN` included, in the half of the transcript ADR 0046 keeps for what the human said — on a host nobody can be watching. ADR 0052.
- **Shipping a hook in the Cursor plugin.** Cursor has hooks, so this is the first plugin beyond Claude Code where the guard could be real rather than advisory. It is also a SHOULD, and building it here would move a second scope line inside one ADR. ADR 0052.

v0 rejections tied to its Bun stack (`bun build --compile` single binaries, `bundleDependencies`) are not carried: v1's stack differs, so they have to be re-decided rather than inherited.
