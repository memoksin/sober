# M1 — the gate, run

- Date: 2026-09-04
- Repository: a throwaway `ledger` project, built by `scripts/m1-gate.mjs` — real `package.json`, real lockfile, real `node --test`
- CLI: installed globally from its own tarball, never from the checkout
- Host: Claude Code 2.1.260 on Haiku 4.5, real, for one dispatch

`BUILD-PLAN.md` §3 says the gate is a script, not a sentence. All nine steps ran.

| # | Step | Result |
| --- | --- | --- |
| 1 | install globally, `sober init` | `dispatch.setup` detected as `npm ci` from the lockfile |
| 2 | `/sober:plan`, intent in free text | two nodes, the edge between them, three decisions |
| 3 | see the proposal, accept as a batch | code and tests in one node each; every decision bound |
| 4 | open a decision, pick through elicitation | three answers, each one a prompt the agent could not fill |
| 5 | read the brief, approve it | approach named real files; approval refused to the agent |
| 6 | `sober run <node>` | worktree, `npm ci`, a real `claude -p`, committed as `55d8e54` |
| 7 | `sober review <node>` | scan found two undeclared files — real, and correct |
| 8 | `sober accept <node>` | merged as `2d5b631`, worktree removed, branch deleted |
| 9 | `sober status` | the downstream node moved off `blocked` |

**Green. The product exists.**

The `accepted` record reads `scan: "findings"`, not `clean` — the two undeclared
files were accepted knowingly, which is the whole of `PR-09-06`.

## What it found

Fourteen defects, none of which 189 tests against a faked host could see. Each
one is fixed and carries a test, except where noted.

**The graph**

1. `propose` wrote decisions that bound no node. Two of the first three held
   nothing, so answering them would have unblocked nothing and the node they
   were about was already `needs-brief`. Refused now, before anything is
   written, naming the loose keys.
2. There was no way to correct an edge. `DESIGN.md` §2.3 says marking by hand is
   supported; it was not, on any surface. `bind` exists now, in `core`, on both
   — and it replaces the list rather than adding to it, because removing a wrong
   edge was the case that made it necessary.
3. A decision nothing binds is now named on the board, for boards that already
   have one.
4. Ids dropped every letter they could not spell: `Geçersiz para birimleri`
   became `ge-ersiz-para-birimleri`. Transliterated now — NFD, plus a small
   table for the letters NFD cannot decompose (`ı`, `ß`, `ø`).

**The session**

5. The host reconstructed the board in `bash` — *"Mock the board output since we
   can't call MCP from bash"* — and handed the user invented ids. Every skill now
   says the tools are tools, and says what a reconstructed board is worth.
6. The plan put code and its tests in separate nodes, which leaves the code node
   with no acceptance criterion anybody can run. The plan skill says they are one
   node.
7. The decide skill let the host suggest `/sober:decide <id> <option>`. It now
   says the argument is an id and never an answer.

**Elicitation**

8. The whole question and every option went into one `message`, which the host
   truncated to two lines: the human was asked to choose between reasons they
   could not read. The message is the question alone now.
9. Option labels carrying `costLater` were cut by narrow terminals — a host
   truncates rather than wraps, so the long thing is exactly what disappears.
   Labels only; the reasoning is read in the conversation first, and the decide
   skill has to show it.
10. Elicitation used the SDK's default one-minute timeout, and a decision the
    human was still reading timed out. Thirty minutes now: the one hard block
    exists to make someone stop and think.
11. Confirmations were enum fields, which the host renders collapsed behind a
    `→ to expand`. Approve and accept are booleans now — two extra keystrokes,
    on every approval, before the question was even visible.

**The run and the review**

12. **Nothing told the dispatched agent to commit.** It wrote both files and left
    them uncommitted; `git diff base...branch` is empty until there is a commit,
    so the review was empty and correct and useless. The prompt carries a closing
    section now — not in the brief, which is what a human approves, but in the
    prompt, which is a fact about the machinery.
13. A review of an agent that wrote everything and committed nothing read exactly
    like a review of an agent that did nothing. Both surfaces now name the
    uncommitted files above the scan.
14. **`accept` succeeded with nothing to merge.** `git merge` on a branch the base
    already contains does nothing and reports success, so the node read `done`
    over an unchanged `main`, with the work still in the worktree. The record is
    written before the merge on purpose — a merge that lands with no record is
    worse — but that ordering is only harmless when there is a merge. Accepting
    is refused now when the branch holds no commit past the base, before anything
    is recorded, and it names the uncommitted files if that is why.
15. `accept` was refused by SOBER's own files: `init` writes `.gitignore` and
    `.sober/` and does not commit them, and the merge check treated untracked
    files as dirt. Merges ask about tracked changes only; worktree removal still
    asks about both, because there both are work.

## Left open

- **There is no way to undo an accept.** Defect 14 put the board in a state with
  no product path out of it, and it was repaired by editing the record. The state
  cannot be reached any more, but a board already in it has no command. Not M1.
- The first plan's decision questions became forty-character ids
  (`how-should-exchange-rates-be-stored-and-b4ag`). Readable, long. No fix.
- One defect was the gate fixture's own: `node --test src` fails on Node 24.19,
  which cost the run a detour. Fixed in `scripts/m1-gate.mjs`.

## Running it again

```
pnpm gate:m1
```

It packs the CLI, installs it globally, builds the repository, and prints the
nine steps. Step 6 spends real money; everything else is free.
