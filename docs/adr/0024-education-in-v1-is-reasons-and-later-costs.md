# 0024 — Education in v1 is option reasons and later costs

- Status: accepted
- Date: 2026-08-29
- Amends: `CHARTER.md` (third pillar), `SCOPE.md`

## Context

`CHARTER.md`'s third pillar says the user finishes a project knowing why every decision in it was made. The pillar as first written implied more: explanation surfaces, recall, a sense of what the user has learned. The 2026-08-29 review found the narrowing already applied in the prose but resting on nothing — `CHARTER.md` pointed at ADR 0016, which is the graph view. `BUILD-PLAN.md` §4 requires an ADR for any change to `CHARTER.md`, so the pillar's current wording had no decision behind it.

## Decision

Education in v1 is carried by **one mechanism**: every option on a decision carries its `reason` and its `costLater` (`DESIGN.md` §2.5), and both are kept in the decision record after the answer, so the archive reads as the project's own explanation of itself.

Three things follow, and are what "narrower" means:

1. **Nothing in v1 measures what a user knows.** No quiz, no recall check, no confidence score, no "you have learned N concepts". A claim the product cannot keep weighs down the two pillars that carry mechanisms.
2. **No teaching surface of its own.** No lesson view, no glossary, no tutorial mode. The explanation lives where the decision lives — on the decision record, in the node that binds it, and in the digest (§7.1).
3. **The reason is written for the answerer's level** (§2.5), not for a hypothetical expert reader. That is the whole of the pedagogy.

`CHARTER.md`'s pointer changes from ADR 0016 to this ADR.

## Consequences

- The third pillar is falsifiable: an option without a reason or a later cost is a bug, and that is the only failure this pillar can have in v1.
- A future milestone that wants recall or measurement writes its own ADR and reopens the pillar's wording. Nothing here forecloses it; `PLAYBOOK.md` is where the idea waits.
- Reviewers can stop asking where the education feature is. There is none, on purpose, and this file is the answer.

## Alternatives rejected

- **Drop the pillar.** The reason/cost mechanism is real, is in M1, and is the one thing that separates SOBER from accelerated vibe coding (`CHARTER.md`). Deleting the pillar deletes the product's point.
- **Keep the wide wording and defer the mechanism.** That is v0's "rules as prose" — a promise in a document with nothing enforcing it.
- **Fold this into ADR 0016.** 0016 is about the graph view. A pillar's scope is not a view's detail.
