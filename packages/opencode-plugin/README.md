# SOBER for OpenCode

The same board, the same tools and the same loop as the Claude Code plugin. It
is not a marketplace package: OpenCode's installable plugin is a JavaScript
module, and SOBER ships no code into a host — what it ships is a server
declaration and prose. Both are configuration here.

## Install

Per project, from a checkout of this repository:

```
cp -r packages/opencode-plugin/.opencode <your project>/.opencode
```

and merge `opencode.json`'s `mcp` block into the project's own `opencode.json`.

Globally, the same two into `~/.config/opencode/`.

`sober` itself has to be on the PATH — `npm i -g @besober/cli` — because that is
the command `opencode.json` names.

## What is different from Claude Code

**No hook enforcement.** Claude Code's plugin denies an agent spawn onto a held
node from inside a session. OpenCode gets no such hook here, so SOBER states the
rule and cannot enforce it in-session. The block itself is unchanged everywhere
SOBER owns the code path: a held node cannot be dispatched from the CLI, the
dashboard or the MCP server.

**No elicitation.** OpenCode's MCP client cannot put a question on screen for a
tool, so `decide` refuses rather than guessing, and the skill says what to do
instead: put the one question to the user in the conversation, wait, and record
what they say with `sober decide <id> <option>`. The answer stays theirs.

**No attended dispatch.** `opencode run` takes one message and exits, so a run
dispatched here cannot be answered while it runs. SOBER refuses an attended run
on this host rather than putting somebody in front of a session that cannot hear
them.

## Do not edit the skills here

`.opencode/skills/` is generated from `plugins/skills/` by
`scripts/build-plugins.mjs`. Edit the source and run `pnpm plugins`; a
hand-edited file is reverted by the next build and fails
`test/integration/plugin.test.ts` in the meantime.
