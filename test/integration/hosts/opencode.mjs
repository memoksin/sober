#!/usr/bin/env node
/**
 * A stand-in for OpenCode, alongside `claude.mjs` and `codex.mjs`.
 *
 * It answers what the adapter asks of one — `providers list` and
 * `run --format json <message>` — and both shapes were recorded off a real
 * `opencode run --format json` invocation at implementation time, never from
 * memory (BUILD-PLAN §6). The recordings are in
 * `docs/testing/v1x-4-other-hosts.tdd.md`.
 *
 * Note what is missing and is missing in the real host too: there is no event
 * for the end of a run, only for the end of each step. How a run ended is read
 * from how the process exited.
 */
const args = process.argv.slice(2)
const say = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)

if (args[0] === 'providers') {
	// The real box is drawn with colour and rules; the count is the only part
	// the adapter reads, so it is the only part worth reproducing.
	const credentials = process.env.FAKE_HOST_LOGGED_OUT === '1' ? 0 : 1
	process.stdout.write(`[0m┌  Credentials\n│\n└  ${credentials} credentials\n`)
	process.exit(0)
}

// `opencode run` takes the message positionally, so the brief is the tail.
const prompt = args.at(-1) ?? ''

if (process.env.FAKE_HOST_HANG === '1') {
	say({ type: 'step_start', part: { type: 'step-start' } })
	setInterval(() => {}, 1000)
} else {
	say({ type: 'step_start', part: { type: 'step-start' } })
	say({
		type: 'tool_use',
		part: { type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'ls' } } },
	})
	say({
		type: 'text',
		part: { type: 'text', text: `wrote the file for: ${prompt.split('\n').at(-1)}` },
	})

	if (process.env.FAKE_HOST_WRITE) {
		const { writeFileSync } = await import('node:fs')
		writeFileSync(process.env.FAKE_HOST_WRITE, `${prompt}\n`)
	}

	if (process.env.FAKE_HOST_COMMIT) {
		const { writeFileSync: write, mkdirSync } = await import('node:fs')
		const { execFileSync } = await import('node:child_process')
		const { dirname } = await import('node:path')
		mkdirSync(dirname(process.env.FAKE_HOST_COMMIT), { recursive: true })
		write(process.env.FAKE_HOST_COMMIT, `${prompt}\n`)
		execFileSync('git', ['add', '-A'])
		execFileSync('git', ['commit', '-m', 'feat: the agent worked'])
	}

	const failing = process.env.FAKE_HOST_FAIL === '1'
	if (failing) {
		process.stderr.write('the host gave up\n')
		process.exit(1)
	}
	say({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop' } })
	process.exit(0)
}
