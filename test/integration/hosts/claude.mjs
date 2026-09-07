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

/**
 * Attended mode (ADR 0046). Recorded off the same kind of real invocation as
 * everything else here: `--input-format stream-json` keeps the session open,
 * a user message arrives on stdin as one JSON line, `--replay-user-messages`
 * echoes it back on stdout, and the process exits when stdin closes.
 */
if (args.includes('--input-format')) {
	say({ type: 'system', subtype: 'init', session_id: 'fake' })
	say({
		type: 'assistant',
		message: { content: [{ type: 'text', text: `working on: ${prompt.split('\n')[0]}` }] },
	})
	// The turn ends, and the session does not: this is the state a human is
	// meant to answer into.
	say({ type: 'result', subtype: 'success', is_error: false })

	let buffer = ''
	process.stdin.setEncoding('utf8')
	process.stdin.on('data', (chunk) => {
		buffer += chunk
		const parts = buffer.split('\n')
		buffer = parts.pop() ?? ''
		for (const part of parts) {
			if (part.trim() === '') continue
			const message = JSON.parse(part)
			// `--replay-user-messages`: what the human said goes back on stdout, so
			// the run log holds both halves of the conversation.
			say(message)
			const text = message.message?.content?.[0]?.text ?? ''
			say({
				type: 'assistant',
				message: { content: [{ type: 'text', text: `you said: ${text}` }] },
			})
			say({ type: 'result', subtype: 'success', is_error: false })
		}
	})
	process.stdin.on('end', () => process.exit(0))
} else if (process.env.FAKE_HOST_HANG === '1') {
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
