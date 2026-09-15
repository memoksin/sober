# SOBER for Claude Code

The board, the tools and the loop inside a Claude Code session —
`.claude-plugin/plugin.json`, the hooks in `hooks/hooks.json`, the MCP server in
`.mcp.json`, and six skills.

`hooks/hooks.json` carries two hooks:

- `PreToolUse` on `Task` runs `sober hook spawn`, which denies an agent spawn
  onto a held node.
- `SessionStart` runs `sober hook session`, which tells the session what the
  board holds right now.

## Install

No checkout needed. In a session:

```
/plugin marketplace add memoksin/sober
/plugin install sober@sober
```

Claude Code clones the repository itself and reads the root
`.claude-plugin/marketplace.json`, which points at this package.

For a team that wants the plugin present on checkout, put the same two in the
project's `.claude/settings.json` instead:

```json
{
  "extraKnownMarketplaces": {
    "sober": { "source": { "source": "github", "repo": "memoksin/sober" } }
  },
  "enabledPlugins": { "sober@sober": true }
}
```

`sober` itself has to be on the PATH — `npm i -g @besober/cli` — because both
hooks and `.mcp.json` run that command.

## What is different from the other hosts

**Hook enforcement.** This is the only host whose plugin enforces the block from
inside a session: the `PreToolUse` hook denies a spawn onto a held node, and the
only way through is answering the decision that holds it. Everywhere else SOBER
states the rule in-session and enforces it only where it owns the code path —
the CLI, the dashboard and the MCP server.

**Decisions can be asked here.** Claude Code's MCP client supports elicitation,
so `decide` puts the question on screen rather than refusing — the same as
Cursor, and unlike Codex and OpenCode.

**Attended dispatch.** A run dispatched to Claude Code can be answered while it
runs, so SOBER allows an attended run on this host.

## Do not edit the skills here

`skills/` is generated from `plugins/skills/` by `scripts/build-plugins.mjs`.
Edit the source and run `pnpm plugins`; a hand-edited file is reverted by the
next build and fails `test/integration/plugin.test.ts` in the meantime.
