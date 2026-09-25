#!/usr/bin/env node
/**
 * A stand-in for Cline, alongside `claude.mjs`, `codex.mjs`, `opencode.mjs`
 * and `cursor.mjs`, and for the same reason: the real host costs money, takes
 * minutes, and answers differently every time.
 *
 * Unlike its siblings, Cline's probe and its real run share one flag set —
 * `--json --auto-approve true <prompt>` — because the CLI has no dedicated
 * status command (ADR 0066). The two are told apart the way `hosts.ts` itself
 * tells them apart: by the prompt. `Reply with ok.` is the exact probe prompt
 * `adapterFor('cline').probe` sends; anything else is a real dispatch.
 *
 * The event shapes are `AgentEvent`s wrapped as `{ts, type: 'agent_event',
 * event}` (`apps/cli/src/utils/events.ts`, `sdk/packages/shared/src/agents/types.ts`,
 * `cline@3.0.65`) — read from the installed source rather than from
 * docs.cline.bot, which documents a shape the shipped CLI does not emit. What
 * that does and does not prove is written down in
 * `docs/testing/v1x-4-other-hosts.tdd.md`; if a Cline release changes the
 * shapes, this file is what has to be re-read.
 */
const args = process.argv.slice(2)
const say = (event) => process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`)
const agentEvent = (event) => say({ type: 'agent_event', event })
const prompt = args.at(-1) ?? ''

if (prompt === 'Reply with ok.') {
	if (process.env.FAKE_HOST_LOGGED_OUT === '1') {
		// `AGENTS.md`, verbatim: "the default `cline` provider fails fast with
		// an `Unauthorized` error" when no credentials are saved.
		agentEvent({
			type: 'error',
			error: { name: 'Error', message: 'Unauthorized' },
			recoverable: false,
			iteration: 1,
		})
		process.exit(1)
	}
	agentEvent({ type: 'done', reason: 'completed', text: 'ok', iterations: 1 })
	process.exit(0)
}

if (process.env.FAKE_HOST_HANG === '1') {
	setInterval(() => {}, 1000)
} else {
	agentEvent({
		type: 'content_start',
		contentType: 'tool',
		toolName: 'write_to_file',
		toolCallId: 'call_0',
	})

	if (process.env.FAKE_HOST_WRITE) {
		const { writeFileSync } = await import('node:fs')
		writeFileSync(process.env.FAKE_HOST_WRITE, `${prompt}\n`)
	}

	agentEvent({
		type: 'content_end',
		contentType: 'tool',
		toolName: 'write_to_file',
		toolCallId: 'call_0',
		output: 'wrote 1 file',
	})

	agentEvent({
		type: 'content_end',
		contentType: 'text',
		text: `wrote the file for: ${prompt.split('\n').at(-1)}`,
	})

	if (process.env.FAKE_HOST_COMMIT) {
		const { writeFileSync: write, mkdirSync } = await import('node:fs')
		const { execFileSync } = await import('node:child_process')
		const { dirname } = await import('node:path')
		mkdirSync(dirname(process.env.FAKE_HOST_COMMIT), { recursive: true })
		write(process.env.FAKE_HOST_COMMIT, `${prompt}\n`)
		execFileSync('git', ['add', '-A'])
		execFileSync('git', ['commit', '-m', 'feat: the agent worked'])
	}

	if (process.env.FAKE_HOST_FAIL === '1') {
		agentEvent({
			type: 'error',
			error: { name: 'Error', message: 'the host gave up' },
			recoverable: false,
			iteration: 1,
		})
		process.exit(1)
	}

	agentEvent({ type: 'done', reason: 'completed', text: 'done', iterations: 1 })
	process.exit(0)
}
