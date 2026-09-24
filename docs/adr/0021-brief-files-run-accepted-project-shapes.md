# 0021 — The shape of brief, files, the run record, accepted, and project.json

- Status: accepted
- Date: 2026-08-29

## Context

ADR 0020 settled ids, timestamps and the answer record. Five smaller shapes remain before phase 1 can write the `schema` package. Each is small; each is consumed by more than one place, so a guess here costs a migration later.

## Decision

1. **`brief`** stores only what D24 says is stored — the agent-written approach and its approval. Approval follows the answer record's pattern (ADR 0020): a record or null, no boolean beside it. ADR 0017's "approve and queue" is one field on that record.

   ```jsonc
   "brief": {
     "approach": "…",
     "approval": { "by": "memoksin", "at": "…", "queue": false }
   }
   ```

   Withdrawing approval (§2.8) sets `approval` to null and keeps `approach`.

2. **`files` globs are matched by `picomatch`**, plain glob semantics (`src/auth/**`), not gitignore semantics. Pure JavaScript, bundled (ADR 0007). §3.4 and §6.2 read the same list through the same matcher, so one list can never give two answers. `node:path.matchesGlob` is the move once it leaves experimental.

3. **The run record** is small and the agent's output lives beside it.

   ```jsonc
   // local/runs/<runid>.json
   {
     "node": "auth-api-k7f2",
     "host": "claude-code",
     "branch": "sober/auth-api-k7f2",
     "worktree": "…",
     "startedAt": "…",
     "endedAt": null,
     "exit": null, // "finished" | "stopped" | "failed"
     "error": null,
   }
   ```

   Raw agent output goes to `local/runs/<runid>.log`, appended line by line. A run killed mid-write leaves a torn log line (§8.4), never a torn JSON record.

4. **`accepted`** records who, when, and the two facts §2.8 and §6.2 say must survive acceptance.

   ```jsonc
   "accepted": {
     "by": "memoksin",
     "at": "…",
     "flagged": false,           // §2.8: accepted while flagged
     "scan": "clean"             // "clean" | "findings" | "did-not-run"
   }
   ```

   `scan: "did-not-run"` is `PR-09-06` in the record: a scan that failed to run is never silently dropped.

5. **`project.json`** carries an integer schema version, present from M1.

   ```jsonc
   { "schemaVersion": 1, "title": "…", "intent": "…", "constraints": [] }
   ```

   An integer, not semver: the only reader is SOBER, and the only question is "newer than mine?" (D42). The field exists in M1 so that the first board ever written has a version; D42's refuse-or-migrate rule is M2.

## Consequences

- Every "is this approved / accepted / answered" question is answered by whether a record is null. No boolean can disagree with the record it stands beside.
- `picomatch` joins `secretlint` as a dependency, but bundled, not declared (ADR 0007).
- The `.log` file is what the panel shows for a failed run (§8.1); the JSON record is what the flag is derived from.

## Alternatives rejected

- **`approved: true` beside `approval`.** Two fields that can disagree.
- **gitignore-style matching for `files`.** Negation and directory-anchoring rules nobody writing a file list expects.
- **Agent output inside the run JSON.** A large file that a crash leaves invalid.
- **Semver for the schema.** Three numbers where one comparison is made.
