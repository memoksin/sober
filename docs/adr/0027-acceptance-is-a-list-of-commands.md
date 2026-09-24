# 0027 — `acceptance` is a list of commands, each with the sentence it proves

- Status: accepted
- Date: 2026-09-04
- Refines: ADR 0022
- Amends: ADR 0021 §3 (the run record); `DESIGN.md` §3.7, §6.0

## Context

`DESIGN.md` §6.0 carried the last OPEN marker owed to phase 1: the shape of the brief's `acceptance` field in `schema` — free text an agent turns into tests, or a list of commands. ADR 0021 settled every other record shape; this one was left because ADR 0022 had just made the field load-bearing and its wording covered both readings: "what must be true when the node is done, as checks a machine can run — test names, commands, observable behaviour".

The field decides what review is. ADR 0022 ruled that review is the human reading check results against criteria they approved. A criterion that does not produce a result is not a check; it is a sentence somebody still has to read a diff to evaluate, which is the cost that ADR was written to remove. And `green` — the batch-accept condition — has to be computed, so the criteria have to run.

The competing pull is that ADR 0022 also names "observable behaviour", and the education pillar is served by the human understanding what they are approving. A bare command list satisfies the machine and tells the human nothing: `pnpm test src/auth` approved twenty times is the rubber stamp D26 exists to prevent, arriving through a third door.

## Decision

**`acceptance` is a non-empty array. Each criterion is a command SOBER runs and one sentence saying what passing it proves.**

```jsonc
"brief": {
  "approach": "…",
  "acceptance": [
    {
      "run": "pnpm test packages/core/src/status",
      "proves": "a node whose only open decision is answered leaves `blocked` in the same write"
    }
  ],
  "approval": { "by": "memoksin", "at": "…", "queue": false }
}
```

1. **`run` is a shell command, executed in the worktree**, after `dispatch.verify` and before the scan. It inherits `dispatch.verify`'s working directory, environment and timeout (ADR 0019, ADR 0022 §2) — one execution model, not two. Exit 0 is the only pass.

2. **`proves` is the half the human approves.** It is written in the language of the node, not of the test runner, and it is what the review renders beside each result. A criterion whose `proves` sentence the human cannot evaluate is the teaching failure `CHARTER.md` names, and it is visible at approval time, which is the whole reason the sentence is stored.

3. **An empty list is not an approvable brief** (ADR 0022 §1). The agent drafts the list with the approach; `approval` is set on the pair or on neither. Withdrawing approval (§2.8) keeps both and clears `approval`, as ADR 0021 §1 already says.

4. **A criterion no command can express does not become an `acceptance` entry.** It belongs in `approach`, where it directs the agent, and it is not part of `green`. `green` means every criterion exited 0, `dispatch.verify` passed, the scan is clean and CI is green — four machine facts, no human judgement inside the batch.

5. **Results extend the run record** (ADR 0021 §3), parallel to the criteria and by index:

   ```jsonc
   "verify": { "exit": 0 },
   "acceptance": [{ "exit": 1 }]
   ```

   Output goes to `local/runs/<runid>.log` with everything else. `null` where a criterion did not run, so "did not run" is never read as "passed" — the same rule ADR 0021 §4 applies to the scan.

6. **Rejection edits the list** (ADR 0022 §4). The next attempt runs against the corrected `acceptance`, and the correction is a criterion, not a description of the code.

## Consequences

- `schema` can be written. This closes the last phase-1 OPEN marker; the remaining three belong to phases 2 and 3.
- Review renders a list of sentences with a pass or fail beside each. That is the review screen's content in M3 and `sober review`'s output in M1 — and it is readable without the repository open, which the diff never was.
- The trivially-satisfiable criterion that ADR 0022 flags stays possible, but now it is visible twice: in the `proves` sentence at approval, and as a command a human can read at review. A rule constraining criteria shape is still a later ADR if it proves common.
- Nodes whose real acceptance is a human looking at a screen — most of phase 5 — will carry short lists and long approaches. That is the honest reading of what those nodes are, and it keeps `green` meaning one thing everywhere rather than two.
- SOBER's own build obeys this from phase 1: the acceptance list `BUILD-PLAN.md` §5 requires before handing work to an agent is this shape, written by hand until SOBER can write it.

## Alternatives rejected

- **Free text the agent turns into tests.** Expressive, and it produces no result. `green` cannot be computed from it, so batch accept dies and review returns to reading the diff — undoing ADR 0022 in the field that implements it.
- **A bare `string[]` of commands.** The shortest shape, and it makes approval meaningless: the human approves runner invocations, not what the node must do. The education pillar and D26 both fail quietly.
- **Test names rather than commands.** Assumes a test runner, one project layout, and one language. `dispatch.verify` already refused that assumption for the same reason (ADR 0019).
- **A structured criterion type — `{ kind: "test" | "command" | "manual" }`.** A union with one branch that runs, one that is the same branch, and one that breaks `green`. Speculative generality before a single node exists.
