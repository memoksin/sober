# SOBER for Codex

The same board, the same tools and the same loop as the Claude Code plugin —
`.codex-plugin/plugin.json`, the MCP server in `.mcp.json`, and five skills.

## Install

From a checkout of this repository:

```
codex plugin marketplace add /path/to/sober
codex plugin add sober@sober
```

The marketplace manifest is `.agents/plugins/marketplace.json` at the repository
root; it points here.

`sober` itself has to be on the PATH — `npm i -g @besober/cli` — because that is
the command `.mcp.json` names.

## What is different from Claude Code

**No hook enforcement.** Claude Code's plugin denies an agent spawn onto a held
node from inside a session. Codex gets no such hook here, so SOBER states the
rule and cannot enforce it in-session. The block itself is unchanged everywhere
SOBER owns the code path: a held node cannot be dispatched from the CLI, the
dashboard or the MCP server.

**No attended dispatch.** `codex exec` takes one message and exits, so a run
dispatched to Codex cannot be answered while it runs. SOBER refuses an attended
run on this host rather than putting somebody in front of a session that cannot
hear them.

## Do not edit the skills here

`skills/` is generated from `plugins/skills/` by `scripts/build-plugins.mjs`.
Edit the source and run `pnpm plugins`; a hand-edited file is reverted by the
next build and fails `test/integration/plugin.test.ts` in the meantime.
