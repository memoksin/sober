# 0068 — A worker runs isolated, and at an effort its score sets

- **Status:** accepted
- **Date:** 2026-09-26
- **Refines:** DESIGN §5.1, ADR 0058, ADR 0060
- **Evidence:** `docs/RUN-COST-TODO.md` (baseline, W1–W3)

## Context

A headless `claude -p` worker loaded the operator's whole `~/.claude`: the global
CLAUDE.md, user hooks, six MCP servers (Gmail, Drive, Calendar among them), nine
plugins and 71 tools. Measured on sonnet, that is ~8k tokens of context on every
turn, and a run is 50–96 turns. It also leaked into behaviour: a worker answered
in the operator's language, and a worker could write to the board through the
sober MCP server.

Every worker also ran at the operator's own `effortLevel` (`high` here), whatever
the node was.

## Decision

- **A Claude worker starts without the operator's environment.** The adapter adds
  `--strict-mcp-config --setting-sources project,local --settings
  '{"enabledPlugins":{…}}'`. The project's `.claude` settings still load.
  `dispatch.plugins` lists the plugins a worker keeps (default `[]`); `null`
  turns isolation off and keeps today's behaviour.
- **Not `--bare`.** It reads only `ANTHROPIC_API_KEY` and never the OAuth login
  that DESIGN §5.1 relies on. **Not `--disable-slash-commands`:** `jevSkills`
  needs skills.
- **Effort comes from the node's score.** `dispatch.effort` defaults to `"auto"`:
  the score's tier under `dispatch.thresholds` maps `low → low`, `mid → medium`,
  `high → high`. An unscored node gets no flag. A fixed level applies to every
  run; `null` passes nothing. Claude takes `--effort`; Codex takes
  `-c model_reasoning_effort=…`, with `max` capped to its `xhigh`. The run
  record keeps the effort.
- **Workers cannot publish or change Git state.** Claude's `--settings` adds
  deny rules for `git push`, `git merge`, `git switch`, and `gh pr merge` through
  Bash and PowerShell. `dispatch.workerSettings` may add settings, but cannot
  remove these denies. The rules were checked under `bypassPermissions` too.
- **A Codex worker skips `~/.codex/config.toml`** under the same switch:
  `codex exec --ignore-user-config` drops the operator's MCP servers, plugins and
  default model, and keeps the login (`CODEX_HOME` still holds `auth.json`).
  The Codex probe runs the same way. A plugin cannot be kept by name there: its
  marketplace lives in the skipped file.
- **A missing skill is said out loud.** When Claude's `init` event lists the
  skills it loaded and one the prompt names is not among them, the run log says
  so. The run goes on; the fix is `dispatch.plugins` or `dispatch.jevSkills`.

## Consequences

- The operator's user-level hooks (for example an output-compressing PreToolUse
  hook) no longer run in workers. Hooks supplied through `--settings` did not
  fire in a CLI check; put worker hooks in project `.claude/settings.json` or a
  plugin. A worker that needs a plugin gets it by name.
- Isolation drops `effortLevel` from user settings, so "auto" is the default, not
  an option. It saves nothing measurable on a small node: 9 isolated runs of one
  task, 3 per band, cost $0.26–0.29 each on average, all passing, with more
  spread inside a band than between bands (`docs/RUN-COST-TODO.md`, Log). It
  stays because it costs nothing and keeps `high` for hard nodes; `sober status`
  re-checks it on real runs.
- An isolated Codex worker uses Codex's default model unless its line names one
  (`codex --model …`), the same as Claude drops the model in user settings.
- The Codex saving is not measured yet: the account was spent when this landed.
  Compare `turn.completed` usage with and without the flag.
- OpenCode, Cursor and Cline are not isolated here. They read their own
  configuration, and no measurement shows a problem there yet.
- `sober status` shows spend by effort, and a node's last run with its turns,
  peak context, cost and session. That table is what keeps or drops "auto".
