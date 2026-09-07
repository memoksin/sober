import { expect, test } from 'vitest'
import { NO_HUMAN } from './host.js'
import { adapterFor, UnknownHostError } from './hosts.js'

test('the adapter is chosen from the host command, whatever else is on the line', () => {
	// `dispatch.host` is a command line, not a program name (host.ts), so the
	// adapter has to survive `npx codex` and `claude --model opus` alike.
	expect(adapterFor('claude').id).toBe('claude')
	expect(adapterFor('npx codex').id).toBe('codex')
	expect(adapterFor('opencode --model anthropic/claude-sonnet-4-5').id).toBe('opencode')
	expect(adapterFor('/opt/homebrew/bin/codex').id).toBe('codex')
})

test('a host SOBER has no adapter for is refused by name, with the ones it has', () => {
	// Silently falling back to the Claude Code invocation would send
	// `--permission-mode` to a CLI that has no such flag, and the failure would
	// arrive three minutes later as an unreadable exit code.
	expect(() => adapterFor('aider')).toThrow(UnknownHostError)
	expect(() => adapterFor('aider')).toThrow(/claude, codex, opencode/)
})

test('every adapter tells a headless run that nobody can answer it', () => {
	// The M2 gate's finding 1 is not a Claude Code fact: any host discovers the
	// operator's own rules file, and a rule there stopped two of five
	// dispatches dead. Claude Code has a flag for it; the other two do not, so
	// the same sentence goes in front of the brief.
	for (const host of ['claude', 'codex', 'opencode']) {
		const argv = adapterFor(host).argv('build the node', false)
		expect(argv.join('\n'), host).toContain(NO_HUMAN)
	}
})

test('the brief is an argument, never a shell string, in every adapter', () => {
	// A brief carrying a backtick is text. `startAgent` never uses a shell, and
	// the adapters must not hand one a single joined string either.
	for (const host of ['claude', 'codex', 'opencode']) {
		const argv = adapterFor(host).argv('rm -rf `pwd`', false)
		expect(
			argv.some((arg) => arg.includes('rm -rf `pwd`')),
			host,
		).toBe(true)
	}
})

test('only Claude Code can be attended, and the other two say so rather than pretend', () => {
	// ADR 0046's conversation needs a host that reads stdin as it runs.
	// `codex exec` and `opencode run` take one message and exit, so an attended
	// run there would be a monologue with a watcher in front of it.
	expect(adapterFor('claude').attendable).toBe(true)
	expect(adapterFor('codex').attendable).toBe(false)
	expect(adapterFor('opencode').attendable).toBe(false)
})

test('each adapter asks its own host whether it is ready, in that host’s words', () => {
	// Read off each CLI at implementation time (BUILD-PLAN §6): Claude Code has
	// `auth status --json`, Codex has `login status` and prints a sentence,
	// OpenCode has `providers list` and prints how many credentials it holds.
	expect(adapterFor('claude').probe).toEqual(['auth', 'status', '--json'])
	expect(adapterFor('codex').probe).toEqual(['login', 'status'])
	expect(adapterFor('opencode').probe).toEqual(['providers', 'list'])
})

test('a logged-in host reads as ready, and a logged-out one as not', () => {
	const claude = adapterFor('claude')
	expect(claude.loggedIn(JSON.stringify({ loggedIn: true }))).toBe(true)
	expect(claude.loggedIn(JSON.stringify({ loggedIn: false }))).toBe(false)

	const codex = adapterFor('codex')
	expect(codex.loggedIn('Logged in using ChatGPT\n')).toBe(true)
	expect(codex.loggedIn('Not logged in\n')).toBe(false)

	// The box OpenCode prints is coloured, so the answer has to survive escapes.
	const opencode = adapterFor('opencode')
	expect(opencode.loggedIn('[0m┌  Credentials\n│\n●  OpenRouter\n└  1 credentials\n')).toBe(true)
	expect(opencode.loggedIn('┌  Credentials\n│\n└  0 credentials\n')).toBe(false)
})

test('a status no adapter can read is a refusal, never a silent pass', () => {
	// §2.8's rule, applied to the login check: not knowing is not the same as
	// being fine, and a run started on a logged-out host dies three minutes in.
	for (const host of ['claude', 'codex', 'opencode']) {
		expect(adapterFor(host).loggedIn('<html>504 Gateway Timeout</html>'), host).toBeNull()
	}
})
