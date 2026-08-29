# 0022 — Review is checks, not reading

- Status: accepted
- Date: 2026-08-29
- Amends: `SCOPE.md` MUST #5 (interpretation), D26, D32; `DESIGN.md` §3.7, §6

## Context

MUST #5 says "human review before anything lands", and every surface built on it
so far assumes review means a human reading the diff. `DESIGN.md` §6.2 renders the
scan above the diff; `sober review <node>` shows the diff; accept is per node.

Measured on a six-node feature (`REVIEW-2026-08-29.md` §4.1): 41 minutes of
human-active time, 18 of them reading diffs, one node at a time. Approve and queue
(ADR 0017) recovers agent wall-clock, not human time, because review stays serial.

The owner's ruling: a human should not read agent-written code. Reading the output
is slower than forcing the output — strict rules the agent must satisfy and strict
tests it must pass — and nearly as safe. The charter already draws this line:
the human owns intent, the agent owns technique. A diff is technique. What the
human owns is *what the result must do*, and that is written before the run, not
inferred from a diff after it.

## Decision

**Review is the human reading check results against criteria they approved, and
deciding. Reading the diff is available, never required.**

1. **A node carries acceptance criteria.** The brief (D24) gains a second
   agent-written section, `acceptance`: what must be true when the node is done,
   as checks a machine can run — test names, commands, observable behaviour. The
   agent drafts it, the human approves it with the brief (D26). A brief without
   an approved `acceptance` section is not approved. This is the specification
   half of the human/agent line, made mandatory.

2. **A run ends with verification.** After the agent exits, SOBER runs
   `dispatch.verify` in the worktree — a config command read from the base
   (ADR 0019), written by `sober init` from the lockfile like `dispatch.setup`.
   Its result, the scan (§6.2), CI when there is one, the files-outside-declared
   signal and the agent's `outcome` summary are the review. They render first.
   The diff renders on request.

3. **Accept is batchable.** A node whose verification passed, whose scan is clean,
   and whose CI is green is **green**. Green nodes are accepted together, in one
   action, from one list — `sober accept --green` in M1, the review screen in M3.
   Any node not green goes through the single-node path, where the human reads
   what failed. The human still performs the accept; nothing lands by itself.
   MUST #5 is kept: a human saw the checks and decided.

4. **Feedback is criteria.** Rejecting (D34) means adding or correcting a
   criterion, not describing the code. The next attempt runs against the
   corrected `acceptance`.

## Consequences

- Review time on the six-node model drops from ~18 minutes to ~4; total
  human-active time from ~41 to ~27, against ~22 for unreviewed prompting. The
  remaining difference is the decisions, which is the education pillar's price.
- `acceptance` and `dispatch.verify` move into M1. Batch accept is a CLI flag in
  M1, a screen in M3.
- The education pillar is unchanged: it lives in decision options, not in code
  reading. Nothing here touches ADR 0006 or ADR 0010.
- The same rule governs SOBER's own build. `BUILD-PLAN.md` §5's cap of two
  agents remains, but the binding capacity is writing two acceptance lists and
  reading two check results in a day, not reading two diffs. ADR 0023 carries
  the wording.
- A criterion the agent can satisfy trivially — a test that asserts nothing — is
  the new failure mode. It is visible in the `acceptance` section the human
  approves, which is the point of approving it. If it proves common, a rule for
  criteria shape is a later ADR.

## Alternatives rejected

- **Keep per-node diff review, add a digest.** Triages the queue, still serial.
  Measured cost stays.
- **Auto-accept green nodes.** Removes the human from the last step. An agent
  whose work lands unseen owns intent; MUST #5 is not an interpretation question
  there.
- **Diff review as the default, batch as opt-in.** Every user pays the reading
  cost until they find the flag. The ruling is that reading is the exception.
