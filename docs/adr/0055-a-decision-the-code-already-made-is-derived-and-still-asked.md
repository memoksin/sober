# 0055 — A decision the code already made is derived, and still asked

- Status: accepted
- Date: 2026-09-08
- Refines: ADR 0010, ADR 0020, ADR 0024

## Context

SOBER assumes an empty repository. Run `plan` in one that has been built in for two years and it opens the same four questions the project settled long ago — where state lives, where the module boundaries fall, how data flows, how errors are handled — and the answers are already in `docs/adr/`, in `CLAUDE.md`, in the dependency list, in the shape of the directories. Asking them from scratch is not rigour. It is the tool failing to read the room, and it is the fastest way to teach somebody that the decision step is noise to be clicked through.

The obvious fix is the one that cannot be taken. Writing the answer directly — an agent reading the code and filling in `answer` — crosses the one line this product has: the choice comes from the human, never from the agent that opened the decision (ADR 0010, `PR-03-09`). A derived answer that nobody looked at is worse than a question nobody was asked, because it looks settled.

Two smaller questions came with it. Where the derivation lives, given that `@besober/core` is plain TypeScript and reading a repository for intent is an LLM's job. And what happens to something read off the code that is not one of the four categories, since there is no fifth and ADR 0024 says one is added by ADR rather than by an agent.

## Decision

**Derivation produces options, never an answer.** Where the repository has already settled one of the four categories, the plan writes that choice as an option, points `suggested` at it, and sets a new field, `derived`, to where it was read: a path, a file, "the import graph". The other options are written anyway — a choice with nothing beside it is not a choice, and a project changes its mind. The question then goes to the human through `decide` exactly as any other does, one at a time, and `AnswerLockedError`, `askChoice` and the batch-accept refusal are all untouched.

**`derived` lives on the decision and is copied onto the answer when one is made.** Whoever answers is usually not whoever opened it, often a session later; a provenance passed as an argument to `decide` would have to survive that gap and would not. So `propose` and `open_decision` take it, `answerDecision` copies `record.derived` into `answer.derived`, and `editDecision` writes `null` — an edit is a person changing their mind, whatever the first answer was read off.

**The derivation is a skill, not code.** It is prose in `plugins/skills/plan/SKILL.md`, generated to all four hosts. `@besober/core` gains one field and one copy; nothing in it reads a repository for intent. `sober init` is unchanged, and there is no `--derive`: derived decisions must bind nodes like every other decision (`propose` refuses a loose one), and nodes only exist once there is work to plan.

**The sources are `docs/adr/` and anything ADR-shaped, `CLAUDE.md` or `AGENTS.md`, the dependency manifest, and the directory layout with the imports between directories.** What is read off the code that fits none of the four categories is reported back to the user in a line and not written: no category is stretched to hold it, and no fifth is invented.

## Consequences

- Neither field forces a migration. Both default to `null`, so a decision written before v1.1 parses unchanged, and `SCHEMA_VERSION` stays at 5. A decision has never had a migration hook, and building one to write `null` into records that already read as `null` is more machinery than the field is worth.
- A record now distinguishes "somebody worked this out" from "somebody confirmed what the code already said". The second is a weaker claim, and a reader — the auditor, a new contributor, the digest — is entitled to know which one they are looking at.
- The `decide` skill names the source before it shows the options, so the user reads where the suggestion came from rather than only that there is one.
- Nothing stops an agent setting `derived` to a guess. The skill says not to, and that is all: this is prose enforcement, of the kind §2.9 requires SOBER to admit to rather than pretend away.
- A project that has already answered a question and then changes its mind pays nothing extra — the answer is a normal answer, and `edit` reaches it the same way.
