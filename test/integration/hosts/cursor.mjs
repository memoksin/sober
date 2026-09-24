#!/usr/bin/env node
/**
 * A stand-in for Cursor, alongside `claude.mjs`, `codex.mjs` and
 * `opencode.mjs`, and for the same reason: the real host costs money, takes
 * minutes, and answers differently every time.
 *
 * The two things it has to answer are what the adapter asks of one — `status`
 * and `-p … --output-format stream-json` — and unlike its three siblings these
 * were read off Cursor's published CLI reference on 2026-09-08 rather than off
 * an installed binary, because there is none here. The event sequence below is
 * the one the reference prints as its own example. What that does and does not
 * prove is written down in `docs/testing/v1x-5-cursor.tdd.md`; if a Cursor
 * release changes the shapes, this file is what has to be re-read.
 */
const args = process.argv.slice(2)
const say = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)
const session = 'c6b62c6f-7ead-4fd6-9922-e952131177ff'

if (args[0] === 'status') {
	process.stdout.write(
		process.env.FAKE_HOST_LOGGED_OUT === '1'
			? 'Not authenticated\n'
			: 'Logged in as someone@example.com\nAuthenticated\n',
	)
	process.exit(0)
}

// `-p, --print` is a boolean and the prompt is positional, so the brief is the
// tail of the line rather than the value of a flag.
const prompt = args.at(-1) ?? ''

say({
	type: 'system',
	subtype: 'init',
	apiKeySource: 'login',
	cwd: process.cwd(),
	session_id: session,
	model: 'Claude 4 Sonnet',
	permissionMode: 'default',
})

if (process.env.FAKE_HOST_HANG === '1') {
	setInterval(() => {}, 1000)
} else {
	say({
		type: 'user',
		message: { role: 'user', content: [{ type: 'text', text: prompt }] },
		session_id: session,
	})
	say({
		type: 'tool_call',
		subtype: 'started',
		call_id: 'toolu_fake_0',
		tool_call: { readToolCall: { args: { path: 'README.md' } } },
		session_id: session,
	})
	say({
		type: 'tool_call',
		subtype: 'completed',
		call_id: 'toolu_fake_0',
		tool_call: {
			readToolCall: { args: { path: 'README.md' }, result: { success: { totalLines: 1 } } },
		},
		session_id: session,
	})

	const text = `wrote the file for: ${prompt.split('\n').at(-1)}`
	say({
		type: 'assistant',
		message: { role: 'assistant', content: [{ type: 'text', text }] },
		session_id: session,
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

	// The reference is explicit that a failed run exits non-zero and may end
	// without a terminal event, with the reason on stderr.
	if (process.env.FAKE_HOST_FAIL === '1') {
		process.stderr.write('the host gave up\n')
		process.exit(1)
	}

	say({
		type: 'result',
		subtype: 'success',
		is_error: false,
		duration_ms: 12,
		duration_api_ms: 12,
		result: text,
		session_id: session,
	})
	process.exit(0)
}
