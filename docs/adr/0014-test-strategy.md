# 0014 — Test strategy: unit, integration, and a fake host

- Status: accepted
- Date: 2026-08-28

## Context

`STRUCTURE.md`'s test gate is Vitest with an 80% coverage threshold — a real improvement on v0, which had 69 test files, one CI job (`bun install && bun test`, Ubuntu only), and no `tsconfig.json` anywhere in the repository.

But the gate measures the wrong surface. Going through what v1 actually does: status derivation, cycle checking and brief rendering are pure functions over records, unit-testable in full. Everything else is not. Board sync, conflict resolution and post-merge validation (ADR 0013), worktree lifecycle, `dispatch.setup`, the host adapter, the draft pull request path, and the MCP server all need real git state or a real subprocess.

A global line-coverage threshold does not distinguish which lines. It permits 20% uncovered, and the natural 20% to leave uncovered is the 20% that is hard to test — which is exactly the git and subprocess code. The gate's incentive points away from the risk.

ADR 0001 records what that shape produced in v0: "Three runtime defects reached the browser in a single session with 192 tests green." v1 adds type checking, which would have caught some of them. The shape — a green gate over the wrong surface — is unchanged.

## Decision

**An integration harness, from phase 0.** Three pieces:

1. **A temp-repo fixture.** Each test creates a real git repository in a temporary directory, runs real `core` or the real CLI against it, and asserts on real git state. A second temporary directory holds a `git init --bare` repository, which is a fully functional remote: push, fetch, merge and conflict all work with no network and no GitHub. Everything in ADR 0013 is testable this way.
2. **A fake host executable.** A small script on `PATH` that behaves like `claude -p`: it writes a predetermined diff and exits 0 or 1. This makes the whole seven-step loop deterministic and free, and it lets M3's dashboard be developed without spending agent sessions.
3. **A fake `gh`.** Same pattern, for §6.1's draft pull request path.
4. **A pack-and-install smoke test.** Pack the tarball, install it globally into a temporary directory, run `sober --help`, assert the exit code and that the published `package.json` declares only the dependencies it is supposed to. This is the only check that actually exercises `PR-00-01`, and it catches a missing file, an unbundled dependency, a broken shebang, a wrong `exports` field and a runtime module resolution failure in one run (ADR 0007).

**CI shape:**

- `integration` becomes a sixth required check, run on all three operating systems. Windows especially: path separators, line endings, and file locking on worktree removal all differ there.
- **Integration coverage counts toward the same number.** Kept separate, the git code would still contribute nothing and the incentive above would survive.
- The coverage threshold becomes per-package and ratcheted — never lower than the last commit — with `schema` excluded. A fixed 80% on a types-and-Zod package produces tests written to reach a number.
- The Definition of Done gains a clause: for git or subprocess behaviour, the test that fails without the change is an **integration** test.
- Integration tests share no state; each uses its own temporary directory. A flaky test is quarantined, not retried.

The fixture is built in phase 0, before the first git code, per `BUILD-PLAN.md`'s first law. There is no `core` to test yet, so one trivial test proves the harness itself: create a repository, commit, push to the bare remote, assert the log. The fake host and fake `gh` arrive when dispatch does.

## Consequences

- Roughly two focused days: one in phase 0, one in phase 2. Phase 0's estimate moves from 2–3 days to 3–4.
- CI gets 2–5 minutes slower per pull request.
- In exchange, the riskiest half of `core` becomes testable, and M3 can be built without paying for a model on every iteration.

## Alternatives rejected

- **Unit tests with git mocked at the module boundary.** Tests the mock. Every defect ADR 0013 exists to prevent lives in real git's behaviour, not in the call signature.
- **Integration tests without a coverage contribution.** Leaves the threshold satisfiable by the easy half, which is the defect being fixed.
- **A real GitHub repository in CI.** Slow, rate-limited, and unavailable to a contributor's fork. The bare-repository fixture covers everything except the pull request API, which the fake `gh` covers.
