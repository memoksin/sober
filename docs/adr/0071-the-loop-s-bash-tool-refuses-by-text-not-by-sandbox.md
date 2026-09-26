# 0071 — The loop's bash tool refuses by text, not by sandbox

- **Status:** accepted
- **Date:** 2026-09-27
- **Amends:** [ADR 0062](0062-sober-reaches-an-openai-compatible-endpoint-itself.md) (Consequences)

## Context

ADR 0062 gave the OpenRouter loop a `bash` tool that runs any command via
`sh -c` in the node's worktree, and said plainly that the loop "has no
sandbox beyond the node's own worktree". `read_file`, `write_file` and
`edit_file` already refuse a path that resolves outside cwd (`withinCwd`);
`bash` did not, and a command that runs `git push`, `sudo`, or reads/writes an
absolute or `..` path was passed straight to the shell.

## Decision

**`bash` gains a textual pre-check, `refuseBash`, run before the command is
spawned.** It rejects a command whose top-level segments (split on `&&`,
`||`, `|`, `;`) contain: `sudo`; `git` followed by a remote-changing
subcommand (`push`); or a token that looks like a path (contains `/` or
`..`, and is not a flag) and resolves outside cwd via the same `withinCwd`
the file tools use. A refused command is never spawned — its refusal string
comes back as the tool result, the same shape as a file tool's refusal, so
the model sees it on the next turn and can correct its command instead of
the run dying.

This is a string check on the command as written, not sandboxing the
process it would spawn. It stops the direct, literal form of each prohibited
pattern and nothing more. It does **not** stop:

- **Quoting and escaping** — `git "pu""sh"` or `git\ push` never contains the
  literal substring the check looks for.
- **Shell expansion** — `$VAR` where `VAR=push`, backticks, `$(...)`, or a
  heredoc that assembles the forbidden word at runtime, after the check has
  already passed the string.
- **Runtime-built commands** — a script written by an earlier tool call
  (`write_file`) that itself runs `git push` when `bash` later executes it;
  the check only reads the `bash` argument, not files on disk.
- **Symlinks** — a symlink inside the worktree pointing at a target outside
  it; `withinCwd` resolves the string path lexically, not the filesystem
  target.
- **Subprocesses spawned by the command** — `make deploy` or any script that
  itself shells out to `git push` or `sudo` two levels down.

None of this is closable by a better regex; closing it means an actual
sandbox (a container, a restricted shell, a seccomp profile) around the
spawned process, which is out of scope for this node and remains a gap ADR
0062 already named. This decision only narrows the *directly typed* forms of
the worst commands — the ones a model reaches for by default — not the
adversarial ones.

## Consequences

- ADR 0062's Consequences gains this paragraph: the loop's `bash` tool
  refuses direct `git push` and other remote-changing git commands, `sudo`,
  and literal absolute or `..` path operands outside the worktree, by
  inspecting the command text before it is spawned. This is a guardrail
  against the model's own direct mistakes, not a security boundary — the
  loop still has "no sandbox beyond the node's own worktree", exactly as
  0062 said.
- A refusal is a normal tool result (`content` on the `tool` message), not a
  thrown error, so the run continues and the next model turn sees why its
  command did not run.
- The check runs once, on the raw string; it does not parse shell syntax, so
  a command that legitimately needs a slash in a non-path argument (a commit
  message, a URL) can be misread as a path operand if that argument is
  unquoted-looking to the tokenizer. This is a known false-positive surface,
  not a bug to chase — the fix is quoting the argument or a future,
  narrower tokenizer, not loosening the path check.

## Alternatives rejected

- **Treat this as a sandbox and document it as one.** It would mislead
  anyone reading `hosts.ts` or the loop's tool list into trusting a boundary
  that a runtime-built command walks straight through. The refusal is real
  and worth having; calling it a sandbox is not.
- **Parse the command with a real shell grammar before running it.** Correct
  parsing of arbitrary POSIX shell (subshells, expansions, here-docs) is a
  parser project on its own, for a check whose job is to catch the model's
  direct, undisguised mistakes — the common case, not the adversarial one.
