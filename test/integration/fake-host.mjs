#!/usr/bin/env node
/**
 * A stand-in for the host CLI. It answers the two things the adapter asks of
 * one — `auth status --json` and `-p <prompt>` streaming JSON events — and its
 * behaviour is set by environment variables so a test can ask for a failure, a
 * hang, or a logged-out host without a second script.
 *
 * The event shapes here were copied off one real `claude -p --output-format
 * stream-json --verbose` invocation, not from memory (BUILD-PLAN §6). If a host
 * release changes them, this file is the thing that has to be re-recorded.
 *
 * Why a fake at all: the real host costs money, takes minutes, and writes
 * something different every time. The invocation itself is verified once by
 * hand at M1's gate (BUILD-PLAN §3), which is the only place a real session
 * proves anything a fake cannot.
 */
const args = process.argv.slice(2)
const say = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)

if (args[0] === 'auth') {
	process.stdout.write(
		`${JSON.stringify({ loggedIn: process.env.FAKE_HOST_LOGGED_OUT !== '1' })}\n`,
	)
	process.exit(0)
}

const prompt = args[args.indexOf('-p') + 1] ?? ''

if (process.env.FAKE_HOST_HANG === '1') {
	// Holds the process open so a stop or a timeout has something to kill.
	// SIGTERM is left at its default, which is what a killed host does.
	say({ type: 'system', subtype: 'init', session_id: 'fake' })
	setInterval(() => {}, 1000)
} else {
	say({ type: 'system', subtype: 'hook_started', hook: 'noise-a-tail-must-drop' })
	say({ type: 'system', subtype: 'init', session_id: 'fake' })
	say({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write' }] } })
	say({
		type: 'assistant',
		message: { content: [{ type: 'text', text: `wrote the file for: ${prompt.split('\n')[0]}` }] },
	})

	if (process.env.FAKE_HOST_WRITE) {
		const { writeFileSync } = await import('node:fs')
		writeFileSync(process.env.FAKE_HOST_WRITE, `${prompt}\n`)
	}

	// A real agent commits its work on the node's branch; a fake that only
	// writes a file leaves an empty branch and an accept that merges nothing.
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
	say({
		type: 'result',
		subtype: failing ? 'error_during_execution' : 'success',
		is_error: failing,
	})
	if (failing) process.stderr.write('the host gave up\n')
	process.exit(failing ? 1 : 0)
}
