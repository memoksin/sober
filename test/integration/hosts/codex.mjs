#!/usr/bin/env node
/**
 * A stand-in for Codex, alongside `claude.mjs` and for the same reason: the
 * real host costs money, takes minutes, and answers differently every time.
 *
 * The two things it has to answer are what the adapter asks of one — `login
 * status` and `exec --json <prompt>` — and both were recorded off a real
 * `codex exec --json` invocation at implementation time, never from memory
 * (BUILD-PLAN §6). The recordings are in `docs/testing/v1x-4-other-hosts.tdd.md`.
 * If a Codex release changes them, this file is what has to be re-recorded.
 */
const args = process.argv.slice(2)
const say = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)

if (args[0] === 'login') {
	process.stdout.write(
		process.env.FAKE_HOST_LOGGED_OUT === '1' ? 'Not logged in\n' : 'Logged in using ChatGPT\n',
	)
	process.exit(0)
}

// `codex exec` takes the prompt as its last argument, so the brief is the tail
// of the line rather than the value of a flag.
const prompt = args.at(-1) ?? ''

if (process.env.FAKE_HOST_HANG === '1') {
	say({ type: 'thread.started', thread_id: 'fake' })
	setInterval(() => {}, 1000)
} else {
	say({ type: 'thread.started', thread_id: 'fake' })
	say({ type: 'turn.started' })
	// Codex reports its own complaints as items rather than on stderr. This one
	// is real: it arrived on the very first invocation this adapter recorded.
	say({
		type: 'item.completed',
		item: { id: 'item_0', type: 'error', message: 'Exceeded skills context budget.' },
	})
	say({
		type: 'item.completed',
		item: { id: 'item_1', type: 'command_execution', command: '/bin/zsh -lc ls', exit_code: 0 },
	})
	say({
		type: 'item.completed',
		item: {
			id: 'item_2',
			type: 'agent_message',
			text: `wrote the file for: ${prompt.split('\n').at(-1)}`,
		},
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
	say({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } })
	process.exit(0)
}
