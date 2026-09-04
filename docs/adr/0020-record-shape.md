# 0020 — Record shape: ids, timestamps, and how an answer is stored

- Status: accepted
- Date: 2026-08-29

## Context

Phase 1 writes the `schema` package, and every later phase consumes it. Four points in the draft record shapes (`DESIGN.md` §2.1, §3.1) would be expensive to change after M1, because the id is the file name and the answer is the one hard block.

1. **Scope.** §3.1 marked `assignee`, `claim` and the flag as M2/M3 fields. Does phase 1 define them, or only what M1 uses?
2. **Ids.** The examples used a readable slug (`auth-api`) that is also the file name. Two people on separate machines adding "Session endpoints" both produce `nodes/session-endpoints.json` — an add/add conflict in the one place §1.1 promises never conflicts, and one ADR 0013's field-level merge cannot resolve, because the two files have no common ancestor. The id was also repeated inside the file, so a copied file carried a second record with the same id.
3. **`updatedAt`.** Every concurrent edit to a node touches it, so ADR 0013's "both sides kept, no question asked" case asks a question every time — "which timestamp?" — and the answer is information git already holds.
4. **The answer.** `chosen: 0` is an index; §2.8 allows editing an answered decision, and a regenerated or reordered option list makes `0` point at a different option silently. `draft` plus `chosen` also admits states that mean nothing (`draft: true, chosen: null`).

## Decision

1. **Phase 1 defines only the fields M1 uses.** M2 and M3 fields are added when their milestone opens. D42's migration rule makes the addition safe, and M1 is internal, so no one carries an older board. ADR 0007's reasoning applies: a contract is learned by consuming it.
2. **Ids are slug plus a short random suffix** — `auth-api-k7f2`. Readable in `dependsOn`, and a collision is structurally impossible. The id lives only in the file name; it is not repeated inside the record.
3. **`updatedAt` is dropped.** `createdAt` stays: written once, never changed, never conflicts, and it is the one thing git does not know before the first sync.
4. **An answer is a record, and options carry ids.**

   ```jsonc
   {
     "category": "data-flow",
     "question": "…",
     "options": [
       { "id": "cookie", "label": "…", "reason": "…", "costLater": "…" },
       { "id": "jwt", "label": "…", "reason": "…", "costLater": "…" },
     ],
     "suggested": "cookie",
     "answer": {
       "option": "cookie",
       "rationale": "…",
       "by": "memoksin",
       "at": "…",
     },
     "createdAt": "…",
   }
   ```

   - `answer.option` names an option id. A reorder cannot move it; a regeneration that removes the option makes the record fail validation instead of pointing at the wrong choice.
   - `draft` is gone. State is derived: `options == null` → not yet opened; `answer == null` → open; otherwise answered. No invalid combination exists.
   - `suggested` is the agent's proposal, `answer` is the human's choice. §2.4's claim that an accepted draft is indistinguishable from a typed answer is now a property of the shape, not a promise.

## Consequences

- §2.4's "draft" is a decision with `suggested` set and `answer` null. ADR 0010's "written to disk with `draft: true`" reads as "written with `suggested`"; the behaviour it describes is unchanged.
- The digest's "decisions answered" (§7.1) reads `answer` going from null to a record.
- "When did this change" is answered by `git log` on the file, never by a field.
- A hand-edited file cannot disagree with its own name about its id.

## Alternatives rejected

- **Pure slug ids.** Best readability, but the add/add conflict above, and the slug goes stale when the title changes.
- **Opaque ids.** No conflict, but `dependsOn: ["k7f2m9"]` defeats §1.2's "an editor can still fix the board".
- **Defining every field in phase 1.** Less typing once; a guessed field that turns out wrong is a migration.
- **Keeping `updatedAt` and merging it by "take the later one".** A special case in the merge for a field that duplicates git.
