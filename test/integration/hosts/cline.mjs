#!/usr/bin/env node
/**
 * A stand-in for Cline, alongside `claude.mjs`, `codex.mjs`, `opencode.mjs`
 * and `cursor.mjs`, and for the same reason: the real host costs money, takes
 * minutes, and answers differently every time.
 *
 * `version` and the `--json --auto-approve true <brief>` invocation are what
 * the adapter asks of one, read off the published npm `cline` CLI reference
 * (https://docs.cline.bot/cli/cli-reference,
 * https://docs.cline.bot/usage/cli-overview, fetched 2026-09-24). The event
 * sequence below — a streaming `partial` line followed by the completed one —
 * is the shape the reference's own worked example shows. What that does and
 * does not prove is written down in `docs/testing/v1x-4-other-hosts.tdd.md`.
 *
 * There is no fake "logged out" mode here, unlike the other three: the
 * reference documents no non-interactive way for the real CLI to say so
 * either, and `loggedIn` in `hosts.ts` always answers `null` for that reason
 * (ADR 0063). `checkHost` refuses this host on every run, real or fake, and
 * that refusal is exercised directly rather than toggled by an env var.
 */
const args = process.argv.slice(2)
const say = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)

if (args[0] === 'version') {
	process.stdout.write('cline 1.2.3\n')
	process.exit(0)
}

// `cline` takes the prompt positionally, at the tail of the line.
const prompt = args.at(-1) ?? ''

if (process.env.FAKE_HOST_HANG === '1') {
	say({ type: 'say', text: 'wor', ts: Date.now(), say: 'text', partial: true })
	setInterval(() => {}, 1000)
} else {
	// A streaming chunk, dropped by the adapter, then the completed line it
	// belongs to — the reference's own documented shape.
	say({ type: 'say', text: 'I', ts: Date.now(), say: 'text', partial: true })
	say({
		type: 'say',
		text: `wrote the file for: ${prompt.split('\n').at(-1)}`,
		ts: Date.now(),
		say: 'text',
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

	if (process.env.FAKE_HOST_FAIL === '1') {
		process.stderr.write('the host gave up\n')
		process.exit(1)
	}
	process.exit(0)
}
