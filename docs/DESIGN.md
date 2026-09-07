# SOBER v1 — Design

Mechanism. `CHARTER.md` says what SOBER is, `SCOPE.md` says which capabilities exist, `PRODUCT.md` says how they behave for the user. This file says how they work.

Settled decisions live in `PRODUCT.md`'s decision table and in `docs/adr/`. This file consumes them; it does not re-decide them. Sections marked **OPEN** are not settled and are decided before the phase that consumes them (`STRUCTURE.md`).

Sections marked **M2** or **M3** are v1 capabilities that ADR 0015 orders after the loop closes once. They are designed here so the earlier phases do not build against a shape nobody agreed on.

---

## 1. Storage

### 1.1 Layout

```
.sober/
├── config.jsonc        # human-facing. Comments + $schema. Working tree, tracked on the code branch.
├── project.json        # title, intent, constraints, schema version. Board state.
├── contributors.json   # who is on the project, and what each one works on
├── nodes/<id>.json     # one file per node
├── decisions/<id>.json # one file per decision
├── archive/<id>.json   # archived nodes, same shape
└── local/              # local run state. Gitignored, disposable.
    ├── runs/<runid>.json
    ├── log.jsonl
    └── cache.json
```

One file per entity, always. Granularity is what makes the board mergeable: two people editing different nodes never touch the same file. Merging one file that holds every node is a conflict per session.

The rule reaches into `local/` too, and for a second reason there: one file per run means three parallel agents write three different files, so there is no interleaving to guard against (§1.4).

**Every write is atomic.** One `writeRecord()` in `core` owns it: write a temp file beside the target, `fsync` it, `rename` it over the target. Every writer on every surface goes through that function; nothing calls a bare write. A process that dies mid-write then leaves the old file intact instead of half of the new one, and §8.4's broken-record path stays a hand-editing story rather than a crash story. The append-only log (§1.4) is the one exception — it appends, and a torn last line is already covered.

**Two writers on one machine take a lock.** The CLI, the MCP server and — from M3 — the dashboard server all write `.sober/` on the same machine, and atomic writes do not stop two of them from reading the same record and both writing it back. One project-wide lock under `local/`, held for the length of an action, decided stale by a heartbeat rather than by a signal to a pid. ADR 0025 has the shape and the reasons; §1.2's optimistic concurrency is about a different problem, between machines.

### 1.2 The board branch

Node, decision, and archive files live in the working tree and are **not** tracked on the code branch — they are gitignored there. They reach teammates through an explicit sync onto a separate board branch (D2). `sober init` writes those gitignore entries; nothing else in the design works without them.

The board branch is an orphan branch — no shared history with the code branch, because it holds no code. `sober-graph` is its default name; "the board branch" is its role, and the documents use the role.

Consequences, all of them load-bearing:

- The files are visible and hand-editable. When the tool is broken, an editor still fixes the board. This is why the orphan-branch-**only** design was rejected: the files live in the working tree as well.
- Board churn never appears in a code PR's diff.
- Archiving is a rename _inside_ one directory pair, carried in **one** board commit with the node it archives. Splitting the two across branches would let a teammate sync between the halves and see neither the node nor its archive entry.
- **Pulling is always an explicit action.** The board is never auto-pulled when the dashboard opens: a locally edited but unsynced node would be overwritten by a stale remote copy with no warning, and git's line-based merge can leave literal conflict markers inside files every surface parses.
- **Fetching is not pulling, and may be automatic.** A fetch writes nothing into the working tree and merges nothing; it moves one remote-tracking ref. Neither harm above applies. The digest depends on this (§7.1), so the distinction is stated rather than left to be inferred from the sentence above it.
- Concurrent edits use optimistic concurrency and fail with a conflict. Never last-write-wins — that is silent data loss.

### 1.2.1 Sync — M2

One action, in this order: pull, merge, push (D35). Never automatic, never on dashboard open — §1.2 says why.

If a conflict appears, **the push does not happen**. Conflicts are resolved in the dashboard, one field at a time, and the user never sees a conflict marker and never opens a terminal to fix board state (D36).

#### Why no marker ever reaches a file

Default git behaviour is the opposite of that promise: a conflicted text file gets `<<<<<<<` written into it, and every SOBER surface parses these files. One `.gitattributes` block prevents it (ADR 0013):

```
.sober/project.json            merge=binary -text
.sober/contributors.json       merge=binary -text
.sober/distribution.json       merge=binary -text
.sober/nodes/*.json            merge=binary -text
.sober/decisions/*.json        merge=binary -text
.sober/archive/nodes/*.json    merge=binary -text
.sober/archive/decisions/*.json merge=binary -text
```

`sober init` writes that block, and adds it to a `.gitattributes` a project
already has rather than replacing one — line by line, so a board file added
after `init` ran gets its rule on a repository that already had the block. `sync`
does the same on the way in, which is what carries it to a board somebody cloned. The archive is two directories, not one
flat `archive/`, for the reason §8.4 gives.

`merge=binary` stops git attempting a textual merge. The working-tree file stays as ours, no markers are written, and the path is recorded unmerged with all three versions available in the index. `-text` stops line-ending conversion, which on Windows would otherwise produce phantom diffs and turn a merged file into a conflict on every line.

The three versions are read from the index, never from the working tree: `git show :1:<path>` is the merge base, `:2:` ours, `:3:` theirs.

#### Field-level, not whole-record

With one file per entity, a conflicted file is a conflicted record — so the choice is not between record-level and file-level, it is between **field-level and line-level**. Line-level is a diff of JSON nobody wrote by hand.

Whole-record choice is also lossy. If one person edits a node's `notes` while another edits its `dependsOn`, "which version?" discards one of them for no reason. Three versions are available, so:

- a field only one side changed is taken automatically;
- a field both sides changed is put to the user, one field at a time.

In that example nothing is asked and nothing is lost.

Both surfaces ask the same question in M2. The CLI never prompts — `sober sync`
names the records and stops, `sober resolve <record>` shows the two versions,
and `sober resolve <record> <field>=ours` is the answer, exactly the shape
`sober decide` already has (§4: the CLI is the scriptable surface as well as a
human one). A session asks through elicitation: **one form per record, one enum
per conflicted field**, so a record with three questions is one window rather
than three.

Answers to a merge with several conflicted records are held in
`local/merge.json` until the last one arrives, and the merge lands on it. That
file is disposable like everything else under `local/` — losing it loses no
record, the questions are simply asked again (§1.4). It is dropped the moment
either side moves, because answers to a merge that no longer exists are not
answers.

#### Archive against edit

Archiving is a rename, so a node archived on one side and edited on the other is a different kind of conflict with a different question: "this node was archived by someone else while you edited it — keep the archive, or restore it?"

#### A clean merge can still produce a broken board

One file per entity reduces conflicts, and that is exactly what makes this possible. A node deleted on one side while the other adds a node depending on it touches two different files: git merges cleanly and the result waits on something that no longer exists. Two dependencies, each valid alone, together close a cycle.

§8.3 refuses a severing delete and §3.6 refuses a cycle-closing edge, but both run locally at edit time. A merge is the other edge, and §3.6's own sentence names the cost of missing it: enforcing at the edge is one check, detecting later is a class of bug.

So a **validation pass runs over the merged board** — dangling references and cycles. The merge completes locally, so no work is lost, and the push is blocked until the findings are resolved. That reuses the gate `PR-07-02` already defines rather than adding one.

"Blocked until resolved" is a state, not a moment: the check runs before every
push that has something to send, not only on the sync that merged. Checking only
at the merge would block one sync and wave the same broken board through on the
next one.

All of this needs real git state to exercise. It is the highest-risk code in `core`, and ADR 0014 exists for it.

### 1.3 Formats

Graph files are JSON (D9): the `schema` package takes no dependency but Zod, and Zod validates the parsed object directly. Nobody is expected to open them; the dashboard and the host session are the human surfaces.

`config.jsonc` is the one human-facing file (D10). It carries a `$schema` key so editors give completion and validation, and every setting is present at its default with a comment above it.

> **Trap.** Writing `config.jsonc` back with `JSON.stringify` deletes every comment. Config writes go through `jsonc-parser`'s `modify`/`applyEdits`, which preserve both comments and formatting. This is the only place in the codebase where that rule applies, which is exactly why it will be forgotten — it belongs in a test, not a comment.

### 1.4 Local state

Files, not a database (ADR 0018). Gitignored, disposable: deleting `.sober/local/` loses no decision and no graph data.

- `local/runs/<runid>.json` — one file per dispatch run, with the agent's raw output in `<runid>.log` beside it. One writer per file, so three parallel agents never contend.
- `local/log.jsonl` — an append-only audit log, one line per event, with an `action` discriminator rather than a file per event type.
- `local/cache.json` — the version check cache.

None of it holds decision answers. Those are git records, which is where v0's own reform put them; a second copy here would duplicate the git-tracked truth and let the two disagree.

A torn line in the log falls under §8.4's rule: the record is reported and the rest still loads. That is the right treatment for a disposable log.

If a query ever genuinely needs an index, the move is to `node:sqlite` — present from Node 22.5 on, nothing to install. `better-sqlite3` was the original choice and was dropped: 26 MB and a native binding inside a globally installed CLI, for a list, a log and one cached value, and a native module cannot be bundled (ADR 0007).

---

## 2. Decisions

The one hard block (`CHARTER.md`). ADR 0003 fixes the vocabulary: a decision, never a gate.

### 2.1 A decision is its own record

`.sober/decisions/<id>.json`. A node references decisions; it does not own them.

```jsonc
// decisions/auth-model-k7f2.json — the id is the file name, never a field (ADR 0020)
{
  "category": "data-flow",
  "question": "How does a session get from the login endpoint to a protected route?",
  "options": [
    {
      "id": "cookie",
      "label": "Signed cookie, server-verified per request",
      "reason": "No client storage, revocable, one extra DB read per request",
      "costLater": "Sticky sessions or a shared session store when you scale out",
    },
    {
      "id": "jwt",
      "label": "Stateless JWT in an Authorization header",
      "reason": "No session store, scales flat",
      "costLater": "Revocation needs a denylist you will have to build",
    },
  ],
  "suggested": "cookie",
  "answer": {
    "option": "cookie",
    "rationale": "Single server for now; revocation matters more than scale-out.",
    "by": "memoksin",
    "at": "2026-08-27T10:12:00Z",
  },
  "createdAt": "2026-08-27T09:00:00Z",
}
```

Options carry ids and `answer.option` names one, so a reordered or regenerated list can never move the answer silently. State is derived, never stored: `options` null means not yet opened (§2.6), `answer` null means open, otherwise answered. `suggested` is the agent's proposal; `answer` is the human's (ADR 0020).

Two to four options. Every option carries a reason and what it costs later — this is the whole of SOBER's education pillar in v1 (`SCOPE.md`).

A decision gets its own file rather than living on the node that raised it for two reasons: branches of the graph share decisions, and the board gets re-cut, so a node can be deleted without taking the reasoning with it.

### 2.2 A node binds decisions, and every binding holds it

```jsonc
{
  "decisions": ["auth-model", "error-envelope"],
}
```

`decisions` — every decision that binds this node. Rendered into its brief.

**A node is held if any decision it binds is still open** (ADR 0006). One answer releases every node bound by it, in the same write.

There is no second field marking which node is responsible for a decision. An earlier shape had one — `introduces` — and gated only on it, with the intention that a node merely referencing a decision would "wait on the introducing node like any other dependency". Nothing created that dependency. A node binding a shared decision it did not raise had an empty `introduces` and no path to whichever node did, so it passed §3.2's every check and reached `ready`: dispatchable, with an unanswered decision rendered into its brief. The one hard block was bypassed by leaving an array empty, and that array was empty in the ordinary case.

Where a decision is answered inline is derived instead: the node binding it that sits earliest in the graph, ties broken by id. The decision screen lists every open decision regardless (§2.7), so this only picks which node panel offers it.

This is not v0's earlier failure returning. v0 gave every node its own copy of every category: 22 of 56 nodes sat blocked, needing 22 separate answers, and none opened. A shared record needs one answer.

### 2.3 Who says a node binds a decision

The agent proposes at node-creation time; the human approves (D1). Marking by hand is supported but is not the primary path — a mechanism that depends on humans remembering to tag things is a dead mechanism.

### 2.4 Drafts

A decision with `suggested` set and `answer` null is an agent proposal nobody has picked (ADR 0020). It counts as **open**: every node bound by it stays held, and nothing is recorded as answered.

The human sees the draft pre-filled and accepts **one decision at a time** — never one accept for a batch, which is the rubber stamp this rule exists to prevent. An accepted draft is indistinguishable from a hand-typed answer in the audit trail, which is correct: a human picked it either way.

Since planning happens in a host session (ADR 0009), the rule needs a mechanism that survives a conversation, where "they all look fine, accept them" is one line. ADR 0010 settles it:

- the accept tool takes a single decision id, never a list;
- **the choice comes from MCP elicitation**, not from the agent. The server asks the host to put the question to the human; the human picks; the answer returns. The agent opens the decision and does not supply its answer;
- a host without elicitation cannot accept. The tool refuses and points at the decision screen or the CLI. This is §2.9's pattern applied: where SOBER cannot enforce, it says so rather than claiming enforcement everywhere.

This is D1 in mechanism form: the agent drafts, the human approves, and "approved" is a real state in the file, not an assumption.

### 2.5 Options are pitched at the answerer's level

The decision is the one hard block, so a question the human cannot evaluate does not slow work down — it stops it. The same request that asks an agent for options asks for what the human needs in order to choose: what the category means for _this_ node, what each option costs later, what a project like this usually takes.

Someone who knows the trade-off skims a line; someone who does not gets the reasoning that makes the pick theirs. **Both read the same answer.** Depth lives in the explanation, never in a different option set for a "beginner".

Two things this must never become: a quiz that scores the human before letting them work, and a lecture that pads every decision.

SOBER ships the **categories**, never the literal questions or the options. No question-authoring system, no per-stack template library — it reuses reasoning the calling agent already has.

The category list is fixed at four (D17): `state`, `module-boundaries`, `data-flow`, `error-handling`. Carried from v0, where they were used in the field. A fifth is added by ADR, never by an agent inventing one — a free-form label makes filtering meaningless and drops the "SOBER ships the categories" rule.

### 2.6 Options are generated on demand

Decomposition produces a decision's question and category, not its options (D18). Options are requested when the decision is opened, by the session that opened it.

Two reasons, both practical. A thirty-decision board would otherwise burn thirty option generations up front, most of them never read. And options generated at decomposition time are reasoned against a context that does not exist yet — the upstream decisions they depend on are still open. Asking late means asking with the answers already in hand.

Because the request runs inside the session the user is already in, there is no subprocess to spin up and no spinner to watch. The surface still says that options are being produced, and it never shows an empty option list as though the decision had none.

### 2.7 Where decisions surface

Three entry points onto one record:

- **The host session** — where a decision is usually opened and answered, in the conversation that produced it (ADR 0009, §2.4).
- **The decision screen** — every open decision in the project, in one list. This answers "what do I need to answer to unblock work today". **M3.**
- **The node panel** — the decisions binding the node in front of you, answerable in place. This answers "why is this node waiting". **M3.**

None is a copy of another. All three read and write `.sober/decisions/<id>.json`. Before M3, the session and the CLI are the two surfaces, which is what makes M1 a complete product rather than a preview (ADR 0015).

### 2.8 When a decision changes — M3

Editing an answered decision is a fan-out, so it is previewed before it is saved (D19): the user sees what will change and confirms. An irreversible change is never triggered unseen.

In M1 this edit is **refused**, with "not yet". Being unable to change an answer beats changing it without the preview D19 exists to provide (ADR 0015).

The preview and the save both work on three cases, not two:

| The node | On save |
| --- | --- |
| Has not started | Its brief is re-rendered; brief approval is withdrawn; it returns to `needs-brief` |
| Is `running` or `in-review` | It is **flagged**. Nothing automatic happens |
| Is finished | It is **flagged**. It is _not_ reopened |

The middle row was missing, and its absence had a consequence. `in-review` outranks `needs-brief` in §3.2, so a node whose brief approval had just been withdrawn still read `in-review` and the review screen said nothing. The human accepted work built against an answer they had just changed, the node became finished, and it was never flagged — because at the moment of the change it was not yet finished, so it took the first row's path. Nothing in the system knew.

So the flag's definition is broader than "a finished node whose decision changed": **a node whose bound decision changed after its brief was approved.** It renders above the diff in the review screen, next to the scan findings (§6.2), and if the human accepts anyway, the `accepted` record says so. The flag survives that transition, which puts the node in the stale list (§7.2) with its three actions already defined.

The preview counts running and in-review nodes too, so a user can stop a run that is building against the answer they are about to change. Nothing stops automatically — §7.2 says why.

Editing stays available from every surface; restricting it to one would break `PR-09-08`. On the screen the preview is the screen. On the command line and in a host session it takes ADR 0032's shape rather than a second one: the edit prints the fan-out and refuses, and a second command carrying the confirmation applies it. One confirmation vocabulary, not two.

Letting the change apply forward-only is the alternative, and it leaves half the graph carrying an assumption that is no longer true with nothing on screen saying so.

### 2.9 Enforcement

Three terms, because two words were carrying three meanings (ADR 0009):

| Term | What it is | Version |
| --- | --- | --- |
| **adapter** | SOBER launching a host for a dispatch — headless by default, or **attended** when a human is watching and can reply (ADR 0046) | v1 |
| **plugin** | the bundle installed into a host: MCP configuration, commands, skills | v1, Claude Code |
| **hook enforcement** | a plugin denying an agent spawn while a node is held | v1, Claude Code |

The block lives in SOBER itself: a held node cannot be dispatched, from any surface. That is enforceable everywhere, because it is SOBER's own code path.

Inside a host session it is not, and that is the hole MUST #12 opened: a human can tell the agent to build the held node with its own tools, and there the decision is only advice. The Claude Code plugin closes it (ADR 0047). It declares two hooks, both calling the same binary `.mcp.json` names:

| Hook | What it does |
| --- | --- |
| `PreToolUse` on `Task` | Reads the spawn's description and prompt. If either names a node the board holds, the spawn is denied, and the reason names the node, the unanswered decision, what it asks, and the two ways to answer it. |
| `SessionStart` | Says the guard is live, and which nodes are held. |

Three things about the shape:

**The guard derives nothing.** `sober hook <event>` is a CLI subcommand, so it asks `statusOf` — the same function the board, the CLI and the MCP server ask. A second implementation of `held` would drift, and then be wrong in the one place being wrong is expensive.

**The node id is the whole handle.** A spawn carries a description and a prompt and nothing that names the work as SOBER knows it. An id is a slug plus four characters (ADR 0020), distinctive enough to look for and specific enough that finding one means the agent is being aimed at that node. Denying every spawn while anything is held would be a product that stops you working; guarding the node's declared globs would need a prediction §3.1 does not make.

**There is no override.** The way through is answering the decision. A config switch would put the one hard block behind a setting, and the setting would be turned off exactly once — the first time it was inconvenient.

A guard that is not installed is silent, and silence reads as permission. So the installed one announces itself, and a guard that could not read the board says so rather than reading as clean — the scan's rule (§2.8), applied to the hook.

Hooks in the other two plugins stay v1.x, and v0's two observations are why: Codex hashes hook definitions and silently ignores them until a human runs `/hooks`, and OpenCode has no elicitation for plugins. A host without working hook support is a host where SOBER advises rather than enforces, and ADR 0048 is where that stopped being a rule with nowhere to apply it — neither the Codex nor the OpenCode plugin ships a hook, so neither claims one. Their loop skill says the block is stated here and enforced everywhere SOBER owns the code path, which makes keeping it the reader's.

The same honesty applies to elicitation (§2.4): a host that cannot put a question on screen cannot accept a decision, and the tool says so rather than guessing. What follows from it is the agent's job, not a workaround: stop, put the one question to the user in the conversation, wait, and let `sober decide <id> <option>` record what they say. The pick comes from the human either way — that is ADR 0010's rule, and ADR 0048 keeps the rule while dropping the assumption that elicitation is the only shape it has.

---

## 3. The graph

### 3.0 The project record

`.sober/project.json` holds the title, the intent in free text, any constraints, and an integer `schemaVersion` (ADR 0021). It is board state and syncs with the nodes (D14).

```jsonc
{ "schemaVersion": 1, "title": "…", "intent": "…", "constraints": [] }
```

It is not a node, because it is not work. It is not in `config.jsonc`, because config is machine settings living on the code branch while project intent is board state. Every brief renders against it, which is why a node's brief never has to re-explain what the project is (`PR-02-10`).

### 3.1 The node

`.sober/nodes/<id>.json`. Every field below is a stored fact; status is not among them (§3.2), and neither is a canvas position (§4).

```jsonc
// nodes/auth-api-k7f2.json — the id is the file name, never a field (ADR 0020)
{
  "title": "Session endpoints",
  "description": "Login, logout, and the middleware that reads the session.",
  "notes": "",
  "dependsOn": ["db-schema-m3q8"],
  "decisions": ["auth-model-k7f2", "error-envelope-p2x1"],
  "files": ["src/auth/**", "src/middleware/session.ts"],
  "brief": null,
  "outcome": null,
  "assignee": "memoksin",
  "claim": { "by": "memoksin", "at": "2026-08-27T11:00:00Z" },
  "accepted": null,
  "createdAt": "2026-08-27T09:00:00Z",
}
```

Ids are a slug plus a short random suffix, so two machines adding the same title never produce the same file (ADR 0020). There is no `updatedAt`: "when did this change" is `git log` on the file. `createdAt` stays because it is written once and never conflicts.

- `decisions` — every decision binding this node. Any open one holds it (§2.2).
- `files` — the files this node is expected to touch, as plain globs matched by `picomatch` (ADR 0021). The agent proposes them at decomposition and the human corrects them (D22). It is a **prediction**, refined when the brief is rendered. It feeds two things: the same-files warning (§3.4) and one of the scan's signals (§6.2). It is not a contract enforced before the work runs.
- `brief` — null until rendered. Holds only the agent-written approach and its approval — `{ approach, approval: { by, at, queue } | null }` (ADR 0021); the rest of a brief is rendered from the records at read time (§3.7).
- `outcome` — a short summary of what the finishing agent did, written at the end of a run. Downstream briefs carry it (§3.7).
- `assignee` — a contributor handle, or null. Set by a human, and refused for a handle the project does not hold (ADR 0030).
- `claim` — who is actually working on it, and since when. Written by `sober claim` and again when a run starts (ADR 0030).
- `accepted` — the record of a human accepting the result: `{ by, at, flagged, scan }` (ADR 0021). Its presence is what makes a node finished; there is no `done` boolean to forget to set. `flagged` records whether the node was flagged when it was accepted (§2.8); `scan` records whether the scan was clean, had findings, or did not run (§6.2).

Title and description are always visible in the panel; notes, brief, and decisions are collapsed by default (`PR-01-07`), and every field is editable in place (`PR-01-08`).

### 3.2 Status is derived, never stored

The orchestration pillar is the answer to "what can start now". A stored status is a field someone forgets to update; a derived one cannot disagree with the graph.

Seven statuses (D20), evaluated in this order — the first that matches wins:

| # | Status | When |
| --- | --- | --- |
| 1 | `done` | `accepted` is set |
| 2 | `in-review` | a run finished and its result is waiting for a human |
| 3 | `running` | a run is in flight |
| 4 | `blocked` | any node in `dependsOn` is not `done` |
| 5 | `held` | any decision in `decisions` is still open |
| 6 | `needs-brief` | `brief` is null, or is not approved, or its approval was withdrawn by a decision change |
| 7 | `ready` | none of the above |

`blocked` outranks `held` on purpose. A node whose upstream work is unfinished should not be asking its human to decide yet: options are generated against current context (§2.6), and the upstream answers that would inform this one do not exist. Surfacing the decision early would trade option quality for the appearance of progress.

The corollary of row 5 and that ordering: `held` appears exactly when the upstream is finished and a bound answer is missing. That is when the node panel's question, "why is this node waiting", has a true answer to give.

Two things are deliberately not statuses:

- **Archived** is a location — the file lives in `.sober/archive/`. A status would have to be kept in step with the file's whereabouts, and would eventually disagree with it.
- **Flagged** — a node whose bound decision changed after its brief was approved (§2.8) — is a flag. It does not reopen or stop the node, so it cannot be a status without lying about what happened. Same for "the last run failed" (§8.1).

### 3.3 Contributors, assignment and claim

`.sober/contributors.json` — who is on the project, and what each one works on:

```jsonc
{
  "contributors": [
    {
      "handle": "memoksin",
      "name": "…",
      "role": "maintainer",
      "focus": ["packages/core/**", "packages/cli/**"],
    },
  ],
}
```

Board state, not configuration: it syncs with the graph, because the team is a property of the project rather than of one machine.

Someone is put on the project by hand — `sober contributors add <handle>`, or the same tool in a session. Nobody is added by acting: a list that fills itself is a list nobody curates, and neither `role` nor `focus` can be read off a git config (ADR 0030).

**Assignment** is a human handing a node to a contributor ahead of time. **Claim** is whoever actually starts it. They are separate fields because they answer different questions — one is a plan, the other is a fact.

A claim is a **signal, not a lock** (D23, ADR 0005). SOBER warns; it never blocks. Enforcing exclusivity would need an authority SOBER does not have and does not want: the git host already decides who can push to the board branch, and an outside contributor forks and opens a pull request like anywhere else.

**A run of linked nodes** is claimed and released in one act, named by its two ends — `sober claim auth-schema-m3q8..auth-ui-9x1p`, and the same string on the other two surfaces (ADR 0050). The run is every node lying on a path from the first to the second, which is what keeps a shared foundation everybody else is waiting on out of one person's claim.

It is a claim on each node and nothing more: no record says "these were a run", so a node that lands inside one later, on a teammate's sync, is nobody's until the command is run again. A run crossing somebody else's node is refused once with the names, and the second call is the confirmation (§3.4's shape, ADR 0032). Giving it back never touches a node somebody else holds.

**A distribution** is a session proposing who takes which node (ADR 0051). It reads the board against each contributor's `role` and `focus` and writes a plan to `.sober/distribution.json` — board state beside `contributors.json`, for the same reason: who does what is a property of the project.

`focus` is a list rather than a sentence. Entries that are globs are matched against a node's `files`, which is the one part of the match that is not a judgement; entries that are words are read as words. A glob holds commas, so `--focus` is given once per entry.

**The plan assigns nobody.** Every match carries the sentence that put that node with that person, and a human takes the whole plan or drops it — `sober distribute --accept`, the same on the other two surfaces. This is MUST #10's rule one record over: an agent proposes, a human accepts, nothing lands unreviewed.

The matching itself is not in `core` and never will be. It needs a model, so it happens where every other model-authored operation happens (ADR 0009): in the host session, as `distribute`, beside `propose` and `open_decision`. No surface routes it.

**A node somebody has claimed is passed over**, and named. A claim is a fact and an assignment is a plan; writing the plan over the fact is the one thing a distribution must not do. So is a finished node — a plan for work that already landed says nothing. The skip is checked again at acceptance, because a teammate can claim any of it between the proposal and the day somebody reads it.

### 3.4 The same-files warning

Two active nodes whose `files` overlap are heading for the same merge. SOBER says so and does not stop either one.

The warning is about **nodes, not people**. An earlier requirement scoped it to "two people heading for nodes that declare overlapping files", which would not have caught the failure §5 opens with: v0's last session was one person running three agents that all edited one file. Two of that person's own parallel nodes are the ordinary case, not the exotic one.

So it fires at two moments:

- at **claim** time, when a teammate takes a node someone else is heading for. Two globs overlap when either matches the other read as a path — enough for `src/auth/**` against `src/auth/session.ts`, and honest about what a prediction can carry;
- at **dispatch** time, on any wave, including a single user's own — and there it asks for a confirmation before starting.

The confirmation is not a block. It is the shape §2.8 already uses for an expensive action with a foreseeable outcome: show it, then let the human proceed. It also has one automatic consequence — an overlapping node is never dispatched unattended by "approve and queue" (§5.3), because the confirmation needs a human.

The warning is only as good as the `files` prediction, which is why the field is agent-proposed rather than left to memory (D22).

### 3.5 Decomposition

Intent in, proposed graph out (D13, ADR 0004). The agent returns nodes, **the edges between them**, and the decisions each node binds. A proposal is not board state: it is rendered as a proposal, and the human accepts, edits, or drops it.

This happens in the user's host session, through SOBER's tools (ADR 0009). That session already holds the repository in context, which is why its proposals beat a cold subprocess's — and why the empty state in the dashboard points at `/sober:plan` rather than generating anything itself (ADR 0010).

Proposals are **written to disk as they are made**: nodes as proposals, decisions as records with `suggested` set and no `answer`, which §2.4 already treats as open. A crashed session loses nothing, and the acceptance record lands on the board rather than in a chat log.

Acceptance granularity differs by kind, on purpose. Node proposals may be accepted as a batch — a wrong node title is visible and cheap to fix. Decisions are accepted one at a time (§2.4) — the risk there is that the human did not understand the choice, and a batch accept is exactly the rubber stamp that rule exists to prevent.

Re-running decomposition on a populated board adds proposals. It never replaces or deletes accepted work (`PR-02-09`).

Manual node creation is permanent, not a fallback to be removed once the proposal path works. It is what a user reaches for when the proposal is wrong, and it is the only path in a host with no MCP server.

### 3.6 The graph is a DAG

A dependency that would close a cycle is refused, with the cycle shown (`PR-02-08`). Everything downstream — derived status, "what can start now", topological ordering for dispatch — assumes acyclicity. Enforcing it at the edge is one check; detecting it later is a class of bug.

There are two edges, not one. The second is the merge, where two individually valid dependencies can arrive together as a cycle. §1.2.1's post-merge validation is the same check at that edge.

### 3.7 The brief

A node whose decisions are all answered gets a brief an agent can execute cold, with no second lookup (`SCOPE.md` MUST #3).

**A fixed skeleton plus one written section** (D24):

| Part | Source |
| --- | --- |
| How to approach this | written by an agent |
| What must be true when this is done | written by an agent, approved with the approach (ADR 0022, ADR 0027) |
| Project intent and constraints | `project.json` |
| Node title, description, notes | the node |
| Every bound decision, with the option chosen and its rationale | `decisions/*.json` |
| Declared files | the node's `files` |
| What upstream nodes produced | each finished dependency's `outcome` (D27) |

Only the first two rows are stored on the node. Everything below it is rendered from the records **at read time**, which has two consequences worth stating: the skeleton cannot omit an answered decision, and it cannot go stale, because there is no copy to fall behind.

The written section can still go stale — it was reasoned against answers that may have changed. That is what §2.8 withdraws.

The order of that table is the order the surface shows. The agent-written approach comes first and the rendered skeleton is collapsed beneath it, because the approach is the only part that is new and the only part approval is really about. Reading twenty full briefs is how a per-node approval becomes a rubber stamp through fatigue — the failure D26 exists to prevent, arriving through a different door.

#### Production and approval

Produced on demand (D25): the node sits in `needs-brief` until the user asks. Same reasoning as options (§2.6) — late, with current context, and never for a node nobody intends to run. In practice a session prepares the briefs for a whole wave of ready nodes in one turn, then walks the human through the approvals one at a time; that sequencing lives in the plugin's skill, not in a mechanism.

**Approval is required** (D26). An unapproved brief cannot be dispatched; the Run action is disabled with the reason shown. Approval is per node, never a batch. The user can edit the brief before approving.

There are two approval actions (ADR 0017):

- **Approve** — dispatch now.
- **Approve and queue** — the same human approval, plus the instruction to dispatch when the node becomes ready, without asking again. Stored as `queue: true` on the approval record (ADR 0021).

What "approve and queue" trades is that the approach is approved before the upstream node's outcome exists. The approach is written against the decisions and the node's description rather than an upstream diff, so this is usually harmless — and sometimes it is not, which is why it is per node and never the default. D26 is untouched: approval is still human, still per node, still with no batch. §5.3 holds the rules that make an unattended chain safe.

When a decision changes, approval on every affected brief is **withdrawn** and the node returns to `needs-brief` (§2.8, `PR-04-07`). A node is never dispatched carrying an answer that is no longer current.

#### The outcome summary

A finishing agent writes a short summary of what it did into the node's `outcome`. Downstream briefs carry it, which is what lets them execute cold without the agent reading upstream code or doing git work to find out what happened.

The brief is handed to the host as its prompt argument, and is **not materialised anywhere**. A brief written into the worktree would be a file outside the node's declared `files`, which is one of the scan's six signals (§6.2) — the review would open with a finding SOBER itself caused, on every dispatch. Settled in phase 3.

---

## 4. Surfaces

Three surfaces, one contract. `PR-09-08`: every **state-changing** operation is available on all of them, headless. Hovering and panning are not operations; the contract test is about what changes the board.

- **The host session**, through the MCP server: plan, decide, approve, dispatch, review (MUST #12).
- **The CLI**: the scriptable surface, and the contract test for the other two.
- **The dashboard**: the primary surface for the board (MUST #6). **M3.**

`core` owns every read and write under `.sober/`. The CLI, the dashboard server, and the MCP server call into `core` and never touch storage themselves. This is not a convention: `dependency-cruiser` fails the build on a violation (`STRUCTURE.md`).

The MCP server ships as `sober mcp`, a subcommand of the same binary rather than a second package — one install, one version, one changelog (ADR 0007). It offers one tool per operation: `init` and `board` and `decisions` to read, `propose` to write a graph with its edges in one call, `open_decision` and `write_brief` to author, `run` and `stop` and `logs` to dispatch, `review` and `reject` and `archive` to judge, and `decide`, `approve` and `accept` — the three the agent cannot perform alone.

Those three go to the human through elicitation (ADR 0010). A host that declares no elicitation capability is refused and told to use the command line; the board is the same one either way. Two revisions of the protocol are in the field at once — the newer splits the capability into `form` and `url`, the older declares a bare `elicitation` — so the capability is read before the request is made, and a host is never refused for something it supports.

### 4.1 The dashboard has a server — M3

A browser cannot import `core`: `core` owns the filesystem, git and local state. So the dashboard is two pieces (ADR 0008):

- `apps/dashboard` — the browser client. Imports `schema` only.
- `packages/server` — route handlers over `core`. Started by the CLI.

The wire types live in `schema`, alongside the record types, and are written at the **start** of M3, before any screen. Four `dependency-cruiser` rules make the boundary a build failure rather than a habit: the client may not import `core` or `server`; only `core` may reach `node:fs`, `node:child_process` or `git`; `cli` may not import `apps/*`; no cycles.

The server binds loopback TCP on `127.0.0.1`, port `0`, plus a token — the rule §9 already sets for IPC, applied rather than restated.

**The wire is request/response JSON over HTTP** (ADR 0036). One route per `core` operation, its shapes typed in `schema` beside the record types; no RPC framework, because that would make `schema` a client-server coupling rather than a description of what travels. Freshness is the client asking again: the canvas polls for the slim projection, and a panel fetches the full record when it opens. A channel that stays open is the exception, and its one subject is the run log, where polling is plainly the wrong shape: `GET /watch/logs` holds a connection and sends one window of rendered lines at a time (ADR 0046). It is a streaming `fetch` over newline-delimited JSON rather than SSE — `EventSource` is the one client that cannot send a header, so using it would have moved the loopback token into the URL, and a reader over `response.body` keeps `Authorization` and ADR 0008's rule with it.

**Every state-changing operation has a route, `run` included.** `PR-09-08` requires the parity, and the three operations an agent may not perform alone (ADR 0010) need no elicitation here — the human is at the screen, and the screen is the asking. One consequence is recorded rather than left to be discovered: `accept`, `archive` and editing an answered decision are a single step on the screen and two on the command line, where ADR 0032's confirmation lives.

**The server's lifetime is `sober dashboard`'s, not the browser tab's** (ADR 0037). The command starts the server, prints the URL and the token, and stays in the foreground; closing the tab stops nothing, and `Ctrl-C` stops the server and the runs it started — which is what `sober run` already does. Runs stay owned by the process that started them: no detached spawn, no pid file, no re-attach. The server takes the same file lock every other command takes, so ADR 0025 counts it as a writer.

### 4.2 The canvas — M3

A force-directed canvas of circular nodes, in the manner of Obsidian's graph view (`PR-01-03`), using a ready-made rendering library: **Cytoscape.js**, chosen at the start of M3 by a half-day one-sided spike (ADR 0038). Its `cose` layout and circular styling are built in, and the graph it carries is a queryable model rather than only a picture — which is what the `done` filter, the blocked highlight and the panel's dependency list are all written against.

- **Budget: ~200 active nodes**, with 1,000 as headroom rather than a requirement (ADR 0016). `done` work is archived continuously, so an active board does not pass roughly 200.
- **`done` nodes are filtered by default.** A view filter, free because status is derived — and without it the budget would rest on the user remembering to archive.
- The canvas is served a slim projection: id, title, derived status, dependencies. Full records are fetched when a panel opens.
- **Dragging moves a node. It does not draw an edge.** Dependencies come from decomposition (§3.5) and are corrected as a list in the node panel, which keeps them keyboard-reachable. `PR-02-08`'s cycle refusal runs when that list is saved.
- **Positions are not board state.** Dragging moves a node within the session; the layout re-simulates when the board opens, as Obsidian's does. A stored position would conflict on every move over a coordinate that means nothing on a teammate's screen.

---

## 5. Dispatch

One agent per node, each in its own git worktree on its own branch, running in parallel (`SCOPE.md` MUST #4). Isolation is what makes parallel safe: v0's last session ran three agents that all edited the same file and the merge was manual. That was not an agent problem, it was a missing-isolation problem. No run ever touches the user's checkout or the main branch.

### 5.0 The branch, the worktree and the pull request belong to the node

Not to the run (ADR 0012). A node has one branch, one worktree and one draft pull request for its whole life; attempts add commits.

The alternative was one of each per run, and two rejections then left a node trailing three branches, three worktrees and three open draft pull requests — with cleanup covering only the worktrees and CI spending minutes on every push. The unit that gets accepted is the node (§3.1), so the unit that owns the branch is the node.

By default a retry **keeps the previous attempt's work**: the agent sees what it wrote and the feedback, which is what §6.4's "rejecting is correcting" means in practice. The rejection surface offers "start clean", which resets the branch to its base.

This is the ordinary pull request flow — review comments, more commits, one pull request — and §6.1 already says the pull request is a mechanism rather than a surface. Using the standard mechanism beats inventing one.

### 5.1 The host runs the agent, not SOBER

SOBER shells out to the user's own host CLI, headless — `claude -p`, `codex exec`, `opencode run` (D28). It never asks for an API key and never chooses the model: the tool the user already installed and logged into does the work.

A dispatch has a second mode, **attended**, chosen per run and never the default (ADR 0046). It opens the session's input, adds `--input-format stream-json`, and tells the agent a human is reading — so a person watching on the dashboard, or holding `sober run --watch` in a terminal, can answer it. Everything else is identical: same worktree, same judging, same records. A headless run is still told that nobody can answer it, which is the M2 gate's finding 1 and the reason the two modes are separate rather than one mode with a flag on the prompt.

Calling a model API directly was the alternative, and it makes SOBER an agent framework — owning the tool loop, file access, and sandboxing. That is a different product.

This is the **adapter** (§2.9). It is thin by contract: build an invocation, stream its output, and report how it exited. Anything an adapter needs to know about SOBER's state it gets from `core`. There are three of them (ADR 0048), and what differs between them is a table in `hosts.ts` rather than a shape in the code:

| | Claude Code | Codex | OpenCode |
| --- | --- | --- | --- |
| ready | `auth status --json` | `login status` | `providers list` |
| run | `-p <brief> …` | `exec --json …` | `run --format json …` |
| permissions | `--permission-mode bypassPermissions` | `--dangerously-bypass-approvals-and-sandbox` | `--auto` |
| system prompt | `--append-system-prompt` | none — in front of the brief | none — in front of the brief |
| attendable | yes | no | no |

Two consequences of that table are worth stating on their own. A host SOBER has no adapter for is **refused before the worktree**, naming the three it has: defaulting to the invocation above would send `--permission-mode` to a CLI with no such flag, and the failure would arrive three minutes later as an exit code nobody can read. And an **attended** run is refused on the two hosts that take one message and exit, rather than quietly downgraded to a headless run with somebody watching it.

A run log carries no host of its own. Each adapter recognises its own event shapes and returns nothing for the others, so a run started under one host still reads after `dispatch.host` changes.

Cursor is the one still v1.x, and for the reason every flag in this section has a recording behind it: its headless invocation has no released shape to read one off.

Note what an adapter is _not_ used for. Decomposition, option generation and brief writing are not adapter calls — they happen inside the user's session through the MCP server (ADR 0009). SOBER launches a host only to make a node's code.

The Claude Code invocation, read off the installed CLI at implementation time rather than from memory:

```
claude -p <the brief> --output-format stream-json --verbose --permission-mode bypassPermissions
```

Three things in it are not obvious, and each was a surprise worth recording:

- `--output-format stream-json` is what makes a live tail possible at all (`PR-05-09`). Plain `--print` emits the final answer only, after the run is over.
- **stdin is closed.** A `claude -p` with an inherited stdin waits three seconds for input that never arrives, on every dispatch.
- `--permission-mode bypassPermissions` is what an unattended run needs: an agent that must build and test its own work cannot answer a permission prompt nobody is watching. The containment is the worktree and the review, not the prompt — which is the trade `PR-09-05` already makes explicit by never letting an agent land its own work.

`dispatch.host` is a command line, not just a program name, so `npx claude` and `claude --model opus` are both settable. It is split on whitespace: a host whose path contains a space needs a wrapper script. Which adapter it selects is read off the program name, so a wrapper has to be named after what it wraps.

Each host's invocation was read off its own installed CLI when its adapter was written — never ported from this one. The recordings are in `docs/testing/v1x-4-other-hosts.tdd.md`.

### 5.2 Before a run starts

SOBER checks the host tool is installed and authenticated, and says what is missing _before_ anything starts (`PR-05-04`). A run that fails three minutes in because a login expired is a worse version of the same message.

The same principle covers the worktree. `git worktree add` produces a tree with no `node_modules`, no `venv`, no `target/` — so an agent cannot build or test, and the review gets an unverified diff. What that costs depends entirely on the project's language, so SOBER does not guess:

- **`dispatch.setup`** is a config command, run in the worktree before the agent starts.
- `sober init` **writes a concrete value into it**, detected from the repository — a lockfile gives the install command — with a comment above it. The user sees it and corrects it. This is the shape `PR-00-06` already requires of every setting, and D1's shape applied to configuration: the tool fills it in, the human approves. There is no detection at dispatch time.
- If `dispatch.setup` fails, **the agent is never started**. Otherwise you pay for a session that cannot work.
- Its value is read **from the base ref, not from the branch being worked on** (ADR 0019). It is a shell command SOBER executes, and a dispatched agent can write to the file that holds it; read from the branch, an agent could rewrite what SOBER runs on the next dispatch. Read from the base, that edit is a diff line a human reads first.

  The same rule covers the scan's configuration (§6.2). Stated once: **anything that governs how a run is prepared or how its result is judged comes from the base.** `dispatch.timeoutMinutes` (§5.4) is read from the base for the same reason: a run must not be able to raise its own spending limit. Settings that govern neither — the concurrency limit, `dispatch.draftPr`, the lock windows (ADR 0025), dashboard preferences — are read normally.

Because the worktree belongs to the node (§5.0), that install happens once per node rather than once per attempt.

Sharing one `node_modules` across worktrees by symlink is rejected: branches can carry different dependencies, and concurrent installs corrupt each other. For pnpm projects it is also pointless — the store already hard-links.

### 5.3 Concurrency

A config setting, default 3 (D30). Ready nodes beyond the limit queue and start as slots free.

The default is conservative on purpose: a user's first dispatch should not open twelve sessions and twelve invoices. Unlimited would make "parallel agents" mean "however many the board happens to hold".

That queue is also what "approve and queue" feeds (§3.7). Three rules make an unattended chain safe:

1. **The chain stops at the first rejection or failure.** Four more nodes are never built on top of a result a human turned down.
2. **The concurrency limit applies**, unchanged.
3. **The same-files warning blocks an automatic dispatch** (§3.4). That warning needs a human confirmation, so an overlapping node waits rather than running unattended.

### 5.4 Stopping

A running node can be stopped (D31). The worktree is **preserved** — whatever the agent wrote stays inspectable — and the node returns to `ready` so it can be run again, on the same branch. A stopped run does not enter the review queue: half-finished work in a list called "waiting for review" trains people to ignore the list.

**Stopping is available from every surface** — dashboard, CLI, and MCP. A run started from a host session that can only be stopped in the dashboard is a run the person who started it cannot stop.

**A run also stops itself.** `dispatch.timeoutMinutes` is a config value with a conservative default; a run past it is killed, recorded as `failed` with a timeout error, and its worktree is preserved like any other failure (§8.2). The kill is a real process kill, not a request the agent may ignore: a hung `claude -p` otherwise holds a worktree, a concurrency slot and a metered invoice open with nothing watching it. Concurrency (§5.3) caps how many runs burn at once; only the timeout caps how long one burns.

### 5.5 The run record

In `.sober/local/runs/<runid>.json`, not in git: which node, which host, which branch and worktree, start and end times, and how it exited — `finished`, `stopped` or `failed`, with the error when there is one (ADR 0021). The agent's raw output is appended line by line to `<runid>.log` beside it, so a crash tears a log line, never the record. Local, disposable, rebuildable — a teammate needs to know a node is finished, not how many times someone's laptop tried.

A run that finishes writes the node's `outcome` summary (§3.7), which is board state and does sync.

---

## 6. Review

Nothing lands without a human (`SCOPE.md` MUST #5). An agent can neither merge its own branch nor mark its own result accepted (`PR-09-05`).

Review is available on all three surfaces (§4). In M1 that means the session and the CLI; the dashboard's single review screen is M3.

### 6.1 The pull request is a mechanism, not a surface

When a run finishes, its branch is pushed and a **draft** pull request is opened (D32). CI then runs before a human looks, which is the whole point: human attention should not be spent on a diff that does not compile. v0 learned this and got it right; what it got wrong was letting the review itself move to the git host.

So the pull request is opened, and the review stays in SOBER. One screen carries the diff, the CI result, and the security scan (`PR-06-03`). `PR-01-01` holds, and the flow still works with no network — minus the pull request and CI steps, nothing else changes, which is also why this is M2 and the loop closes without it.

One pull request per node, not per attempt (§5.0). Draft matters: a draft pull request asks nobody to review anything. Opening it is still an outward-facing action that pushes agent output to a remote, so it is a documented config setting (`dispatch.draftPr`), on by default when a remote exists, and never a silent one.

The host is talked to through its own CLI, `gh`, as a subprocess — the same shape as the agent host (§5.1), and for the same reason: SOBER never asks for a token and never holds one (ADR 0031). `SOBER_GH` names the executable when it is not on the PATH. A branch that holds no commit past its base opens nothing: there is no diff for CI to run and none for anyone to read.

CI is read at review time, never cached and never waited for. "Still running" is a true answer; **"could not be read" is not "passing"**, and the line is rendered even when the pull request itself could not be read — a CI line that disappears reads as a clean one.

### 6.0 Review is checks, not reading — ADR 0022

The brief carries an `acceptance` section, approved with it (§3.7). A run ends with `dispatch.verify`, read from the base like `dispatch.setup` (§5.2). The review renders, in order: verification, the scan (§6.2), CI when there is one, the files-outside-declared signal, the `outcome` summary. The diff renders on request.

`dispatch.verify` and every acceptance criterion run **in the node's worktree, after the agent exits**, and their exit codes land on the run record. A run that did not finish is not verified: there is nothing to verify.

A node whose verification, scan and CI are all clean is **green**. Green nodes are accepted together — `sober accept --green` in M1, one list on the review screen in M3. A node that is not green takes the single-node path below. The human performs every accept; nothing lands by itself.

`acceptance` is a list of commands, each carrying the one sentence it proves (ADR 0027). Every criterion runs in the worktree after `dispatch.verify`; **green** means all of them exited 0, verification passed, the scan is clean and CI is green.

**The auditor runs that list, and every surface renders what each command did** (ADR 0049). Three outcomes and never two: exit 0 passed, a non-zero exit failed, and `null` did not run — a command nobody installed, or a run that ended before it got there. `null` is the scan's rule (§6.2) applied where it matters more, because a criterion is the sentence the human approved as the definition of done, and telling them a check failed when nothing checked sends them back to the diff as surely as telling them it passed.

Why a command's output is not on the record: exit codes are what `green` is computed from, and the reason a command failed is prose. It goes to `local/runs/<runid>.log` under a header naming the criterion, which keeps the record small enough that a run killed mid-write leaves a torn log line and never a torn record (ADR 0021).

`sober audit <node>` runs the list again against the worktree that is already there and rewrites the last run's results. A criterion that was wrong, or a check that failed for a reason outside the work, does not deserve a second dispatch. Running the list when the review is *opened* was rejected: that is the slowness M3's gate raised against the review button, and it runs commands at the moment nobody expects them.

Running someone's acceptance list is executing text an agent wrote, so where it runs is stated rather than assumed. Each command runs in the node's worktree, through a shell, with this process's environment, capped by `dispatch.timeoutMinutes` — the reach `dispatch.setup` and `scan.extra` already have, and no sandbox. What holds is not isolation but provenance: **the list is read from the board at the project root, never from the branch under review.** An agent can rewrite `.sober/nodes/<id>.json` inside its own worktree; SOBER never reads that copy. What runs is the list a human approved, which is §5.2's rule reaching `acceptance` by a different route.

A failed criterion holds the node out of `green` and never blocks the accept. A machine that refuses an accept is a gate, and a gate in this product is a decision (ADR 0003). The human reads what failed and still decides — and `accepted.audit` records how the list read at that moment, beside `scan` and for the same reason: the run record is local and disposable (§5.5), so without it a teammate who clones the board a week later knows the work was accepted and nothing about what was true when it was.

### 6.2 The scan sits above the diff

Every dispatch result is scanned before it is shown (`SCOPE.md` MUST #9, ADR 0002). Findings render above the diff, not beside it. A failed scan never auto-rejects and never hides the result — the human still decides.

ADR 0011 settles what runs:

- **Secrets: `secretlint`.** Pure JavaScript with no install script, so nothing is fetched or compiled at install. It resolves rule packages by name, so it is the one dependency the published CLI declares rather than bundles (ADR 0007). It also runs in SOBER's own CI, as `SCOPE.md` rule 4 requires.
- **A project may configure it.** With no configuration — the ordinary case — the bundled default preset runs and nobody writes a file. A project that carries a `secretlint` configuration may add rules for its own secret formats and suppress a known false positive, which matters because a fixture holding a fake key would otherwise produce a finding on every dispatch, and a panel that is always wrong is a panel nobody reads.
- **That configuration is read from the base** (§5.2, ADR 0019). An agent that relaxes the rules in its own diff does not relax the scan of its own diff. Without this the scan guarantees nothing, because the thing being checked writes the rules. The review names which rule set ran.
- **Six named signals**, each a rule with a test, all language-agnostic: a dependency was added; the diff touches files outside the node's declared `files`; dynamic code execution was introduced; a shell command is built from a variable; TLS verification was disabled; a new network call to a hardcoded address.
- A project with `semgrep` or `gitleaks` installed may run them additionally, by configuration.

"Injection-shaped changes" was the earlier wording and is dropped. A real injection analyser needs one rule set per language a user might write in; a named short list keeps a promise the product can keep, and what the scan does _not_ catch is documented next to what it does.

What the six do **not** catch is part of the promise. They read one added line at a time, with no per-language parsing: a URL inside an added comment is reported, a shell call assembled across three lines is not, and neither is anything already in the repository — `PR-09-07` covers that. Each signal is a reason for a human to look, never a proof.

`scan.extra` runs a project's own scanners beside the bundled one, as **commands** rather than tool names — `semgrep scan --error --quiet`. Every scanner's invocation, output format and exit codes differ, and a name would mean SOBER guessing one per tool and ageing badly. A non-zero exit is a finding carrying its first line; a command that is not installed did not run, and says so.

The scan reads the **added lines of the diff**, not the worktree. Scanning the worktree reports everything already in the repository and makes the screen useless; `PR-09-07` covers what is already there.

A scanner that cannot run does not disappear. Review proceeds, "the scan did not run" renders with the weight of a finding, and the fact goes into the `accepted` record. `PR-09-06` requires that a failed scan is never silently dropped, and a broken scanner is the case that would otherwise slip through.

Two other things render in the same place: the flag from §2.8, when the node was built against an answer that has since changed, and CI's result when there is one.

### 6.3 Accept

Configurable, because projects differ (D33): `dispatch.accept` is `merge` or `pull-request`, and it defaults to `merge`. A protected main cannot take a local merge; a repo with no remote cannot take a pull request. Detecting which and switching silently was rejected: accept is the one irreversible command in the product, and it must not change behaviour because somebody added a remote (ADR 0031).

Either way the node's `accepted` record is written, which is what makes it `done` (§3.2), and its `outcome` summary is recorded for downstream briefs (§3.7). The worktree is removed (§8.2).

Leaving every branch unmerged was the third option. It ends with twenty branches and a loop that never visibly closes.

### 6.4 Reject

Rejecting is correcting, not discarding (D34). The user writes what was wrong; the node returns to `ready`, and the next run carries that feedback alongside the brief.

The branch, the worktree and the draft pull request all stay as they are (§5.0), and the next attempt commits on top unless the user asks to start clean. Throwing the work away and saying nothing means the agent repeats the mistake — and deletion is the one thing a review cannot undo.

The feedback is a **local record**, `local/feedback/<node>.json`, and the next dispatch puts it **above** the brief rather than inside it. Three things follow from that shape, and each one was the reason to pick it:

- The approved text stays the approved text. Appending to the brief would have a machine editing what a human signed off, and two rejections in it is a page nobody reads to the end.
- Feedback first, because it is the only part the agent has not already seen. "Rejecting is correcting" fails if the correction is buried under a page the agent wrote itself.
- It is what takes the node **out** of the review queue: a rejection written after the run ended is what makes a `finished` run stop counting as `in-review` (§3.2). There is no field on the run to forget to set.

Local, like the run it answers (§5.5) — a teammate needs to know the node is unfinished, not how many times someone's laptop turned work down. If M2 finds a reason for feedback to travel, it moves to the board then.

---

## 7. Coming back

### 7.1 The digest — M3

Reopening the board shows what changed since you last looked (D38): new nodes, decisions answered, work finished, results waiting for review, nodes flagged.

It is a filter over records that already exist — no new record type and no stored pointer. The two halves get their answers from different places:

| Digest item | Where it comes from |
| --- | --- |
| New nodes | the delta between the local board branch and the fetched remote |
| Decisions answered | the same delta — an `answer` that went from null to a record |
| Work finished | the same delta, or the local run records |
| Results waiting for review | **current state.** No fetch, no delta |
| Nodes flagged | **current state.** No fetch, no delta |

The delta needs only a `git fetch` and two refs. Git already tracks where the last sync left the board, so nothing is stored: `git diff` between the local board branch and its remote-tracking ref, over `.sober/nodes/` and `.sober/decisions/`, is the answer. §1.2 is explicit that a fetch may be automatic while a pull may not.

With no remote, or with no network, the delta half is empty and says so — "the remote could not be checked", per §8.7 — and the snapshot half still works. That snapshot half is the one that matters to a single user anyway: three agents were running when the board closed, and three results are waiting when it opens.

On a forty-node board, "what changed while I was away" is not a question the canvas can answer.

### 7.2 Flagged nodes — M3

A finished node whose bound decision changed is flagged, not reopened (§2.8). Three things can be done with it (D37):

- **Dismiss**, with a reason, which is kept. The answer changed and this node is fine anyway — that is a real judgement and it should be recorded, not lost.
- **Run again**, returning the node to `ready`.
- **Open a new node** carrying the fix, when the correction is its own piece of work.

Nothing happens automatically. Automatic re-running would let one decision change restart thirty nodes silently, which is precisely what the impact preview (§2.8) exists to prevent.

---

## 8. Failure

Each of these is a thing that will happen, not a thing that might.

### 8.1 A run that fails

The node returns to `ready` carrying a **flag**, not a new status (D39): "the last run failed". The error, the log, the branch and the worktree are all kept.

A flag rather than an eighth status, for the same reason §2.8's flag is one: "never run" and "ran and crashed" differ by one line in the panel, and making them different statuses spreads that distinction through every surface that renders a node.

The flag is local — derived from the run record (§5.5). A teammate needs to know the node is unfinished, not that someone's laptop lost its auth token.

A failed run does not enter the review queue, for the reason a stopped one does not (§5.4), and it stops a queued chain (§5.3).

### 8.2 Worktrees

One per node (§5.0). Removed automatically once the work is accepted; kept after a rejection, a stop, or a failure (D40). If the work landed, the worktree has no job left. If it did not, there is something to look at — and `PR-06-08` says a rejection deletes nothing.

**Nothing removes a dirty worktree.** Before any removal — automatic after an accept, or from the cleanup action below — `git status --porcelain` runs in it. If anything is uncommitted or untracked, the removal is refused, the node is named, and so is the worktree's path. Never `worktree remove --force`, and never a directory delete as a fallback: that is exactly how v0 deleted work nobody had committed yet, silently. A refusal the user can act on beats a cleanup that always succeeds.

A cleanup action lists idle worktrees with their size and asks before removing them. Disk fills quietly; a command that reports before it deletes is the whole mitigation. Most of that size is installed dependencies rather than code (§5.2), so the listing separates the two — otherwise the number is unexplainable.

### 8.3 Removing things

**Archive is the normal path.** The node moves to `.sober/archive/`, keeps its history, and can come back. The move is one board commit with the node it archives (§1.2). It is in M1 because without it §8.3's own refusal below leaves a referenced node with no way to be removed at all.

Permanent deletion is **refused** while anything still references the record, and the referencing nodes are named (D41). A delete that severs dependencies leaves nodes waiting on something that no longer exists — a broken graph, and nobody was told.

That refusal runs at edit time. §1.2.1's post-merge validation is the same check at the merge, where the reference can arrive from someone else after the delete.

**An answered decision is never deleted.** It archives, like a node: the record moves to `.sober/archive/`, in one board commit, and the nodes that bound it keep pointing at it and keep reading it. Removing it is refused, and the bound nodes are named — the same refusal as above, with no exception for a decision whose nodes are all finished.

The reason is ADR 0006: a decision holds every node it binds, and that binding is the record of _why_ those nodes are shaped as they are. A finished project whose decisions were tidied away is exactly the outcome `CHARTER.md`'s third pillar exists to prevent (ADR 0024). Archiving keeps the explanation and takes the decision out of the working board, which is all "remove" ever needed to mean here.

Two consequences worth stating, because both would otherwise be inferred:

- **Archiving a decision does not re-gate anything.** Bound nodes stay answered and keep their status. The gate is about an _unanswered_ decision (§3.2); an archived one has an answer.
- **An unanswered draft decision is deletable** (§2.4). It binds nothing, explains nothing, and holds no answer — there is nothing to preserve.

### 8.4 A file that will not parse

The board is hand-editable by design (§1.2), so invalid JSON will occur. A record that cannot be parsed is reported as a broken record, naming the file, and **the rest of the board still loads**. One bad file never takes down the board — that is the failure mode that makes people stop trusting a tool.

The same rule covers a torn line in the local log (§1.4).

### 8.5 Schema versions across a team — M2

`project.json` carries the schema version the board was written with (D42).

- An **older** SOBER seeing a newer board refuses to open it and says to upgrade.
- A **newer** SOBER reads an older board and migrates it when needed — in the CLI, which brings the board forward on its way in and says in one line what it rewrote. The MCP server does not migrate: it may not write to stdout, so it refuses and names the surface that can (ADR 0030).

A migrated record is written back through the current schema, so its field order matches every other record's. Bytes that differ only by key order are a whole-file diff to git and a phantom change to the field-level merge (§1.2.1).

Refusing to read is the only safe direction. A version that does not understand a field drops it on write, and on a shared board that is silent data loss for everyone else.

### 8.6 Losing local state

Deleting `.sober/local/` loses no decision and no graph data (§1.4). Run history and the version cache go; the board does not. This is a property worth keeping true — anything tempted into that directory that cannot be lost belongs in git instead.

The digest is unaffected, because it stores nothing there (§7.1).

### 8.7 Messages

Every failure names what failed and what to do about it. None of them is a stack trace. This is not a style preference: a message the user cannot act on turns a recoverable state into a support request.

---

## 9. Platform

One code path on macOS, Linux and Windows, with no platform branching (`PR-09-04`).

- No POSIX-only primitives: no unix domain sockets, FIFOs, `chmod`, hardcoded `/tmp`, or raw signal numbers. When IPC is needed, loopback TCP on `127.0.0.1` port `0`, plus a token. §4.1 applies this to the dashboard server.
- Always join paths with `node:path`. Never glue `/` or `\` by hand.
- `process.platform` is branched on only for a genuinely OS-specific external tool.

These are Biome `no-restricted-imports` rules, not prose. v0 wrote the same list in `CLAUDE.md` and nothing checked it.

Two Windows-specific rules that are not lint rules:

- Board files carry `-text` in `.gitattributes` (§1.2.1). Without it, line-ending conversion produces phantom diffs and turns a merged file into a conflict on every line.
- The CI matrix includes a Windows job. Not for a native module — there is none (§1.4) — but for git: path separators, line endings, and file locking on worktree removal all behave differently there, and an integration test is the only thing that sees it (ADR 0014).
