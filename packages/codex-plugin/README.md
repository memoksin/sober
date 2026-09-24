# SOBER for Codex

The same board, the same tools and the same loop as the Claude Code plugin —
`.codex-plugin/plugin.json`, the MCP server in `.mcp.json`, and six skills.

## Install

A checkout of this repository is required: `.agents/plugins/marketplace.json`
at the repository root declares `{"source": "local", "path":
"./packages/codex-plugin"}`, and `codex plugin marketplace add` takes a real
path on disk.

```
codex plugin marketplace add /path/to/sober
codex plugin add sober@sober
```

`sober` itself has to be on the PATH — `npm i -g @besober/cli` — because that is
the command `.mcp.json` names.

See [Install the plugin for your host](../../README.md#install-the-plugin-for-your-host)
for the other three.

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

**Asking is per turn.** Codex offers `request_user_input` by mode — it is
there in interactive Default and Plan modes, never under `codex exec` — so the
skills use it when it is listed in the turn's tools and fall back to asking in
the chat when it is missing. Verified against codex-cli 0.154.0.

**A tool-call timeout that outlasts a run.** Codex cuts an MCP tool call off at
its own built-in limit unless the server's config names `tool_timeout_sec`, so
`.mcp.json` here sets it to 1860 seconds — one minute past `dispatch
.timeoutMinutes` (30 minutes, `packages/core/src/config.ts`), so SOBER's own
timeout fires first and a run ends as `failed` for its own reason, never cut
by the host. Raising `timeoutMinutes` past 30 needs `tool_timeout_sec` raised
to match — in this file if it is yours to edit, otherwise under
`[mcp_servers.sober]` in `~/.codex/config.toml`. The hosted ChatGPT client may
still cap a call regardless of this setting.

## Do not edit the skills here

`skills/` is generated from `plugins/skills/` by `scripts/build-plugins.mjs`.
Edit the source and run `pnpm plugins`; a hand-edited file is reverted by the
next build and fails `test/integration/plugin.test.ts` in the meantime.
