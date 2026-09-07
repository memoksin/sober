import { expect, test } from 'vitest'
import { NO_HUMAN } from './host.js'
import { adapterFor, renderLine, UnknownHostError } from './hosts.js'

test('the adapter is chosen from the host command, whatever else is on the line', () => {
	// `dispatch.host` is a command line, not a program name (host.ts), so the
	// adapter has to survive `npx codex` and `claude --model opus` alike.
	expect(adapterFor('claude').id).toBe('claude')
	expect(adapterFor('npx codex').id).toBe('codex')
	expect(adapterFor('opencode --model anthropic/claude-sonnet-4-5').id).toBe('opencode')
	expect(adapterFor('/opt/homebrew/bin/codex').id).toBe('codex')
})

test('Cursor answers to its own name and to the binary’s, and not to `agent`', () => {
	// Cursor's installed binary is called `agent` — the most generic word on
	// anybody's PATH. Accepting it would make every wrapper script called
	// `agent` silently a Cursor invocation, which is the small version of the
	// unknown-host default ADR 0048 refused. So the adapter answers to `cursor`
	// and to `cursor-agent`, and a bare `agent` is refused by name.
	expect(adapterFor('cursor').id).toBe('cursor')
	expect(adapterFor('cursor-agent').id).toBe('cursor')
	expect(adapterFor('npx cursor-agent --model auto').id).toBe('cursor')
	expect(() => adapterFor('agent')).toThrow(UnknownHostError)
})

test('a host SOBER has no adapter for is refused by name, with the ones it has', () => {
	// Silently falling back to the Claude Code invocation would send
	// `--permission-mode` to a CLI that has no such flag, and the failure would
	// arrive three minutes later as an unreadable exit code.
	expect(() => adapterFor('aider')).toThrow(UnknownHostError)
	expect(() => adapterFor('aider')).toThrow(/claude, codex, opencode, cursor/)
})

test('every adapter tells a headless run that nobody can answer it', () => {
	// The M2 gate's finding 1 is not a Claude Code fact: any host discovers the
	// operator's own rules file, and a rule there stopped two of five
	// dispatches dead. Claude Code has a flag for it; the other two do not, so
	// the same sentence goes in front of the brief.
	for (const host of ['claude', 'codex', 'opencode', 'cursor']) {
		const argv = adapterFor(host).argv('build the node', false)
		expect(argv.join('\n'), host).toContain(NO_HUMAN)
	}
})

test('the brief is an argument, never a shell string, in every adapter', () => {
	// A brief carrying a backtick is text. `startAgent` never uses a shell, and
	// the adapters must not hand one a single joined string either.
	for (const host of ['claude', 'codex', 'opencode', 'cursor']) {
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
	expect(adapterFor('cursor').attendable).toBe(false)
})

test('each adapter asks its own host whether it is ready, in that host’s words', () => {
	// Read off each CLI at implementation time (BUILD-PLAN §6): Claude Code has
	// `auth status --json`, Codex has `login status` and prints a sentence,
	// OpenCode has `providers list` and prints how many credentials it holds.
	expect(adapterFor('claude').probe).toEqual(['auth', 'status', '--json'])
	expect(adapterFor('codex').probe).toEqual(['login', 'status'])
	expect(adapterFor('opencode').probe).toEqual(['providers', 'list'])
	// Cursor's `status` takes `--format json` too, but the keys of that object
	// are not in the reference, and guessing one is what BUILD-PLAN §6 forbids.
	// The sentence it prints is documented; the JSON's shape is not.
	expect(adapterFor('cursor').probe).toEqual(['status'])
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

	const cursor = adapterFor('cursor')
	expect(cursor.loggedIn('Logged in as someone@example.com\nAuthenticated\n')).toBe(true)
	expect(cursor.loggedIn('Not authenticated\n')).toBe(false)
})

test('a status no adapter can read is a refusal, never a silent pass', () => {
	// §2.8's rule, applied to the login check: not knowing is not the same as
	// being fine, and a run started on a logged-out host dies three minutes in.
	for (const host of ['claude', 'codex', 'opencode', 'cursor']) {
		expect(adapterFor(host).loggedIn('<html>504 Gateway Timeout</html>'), host).toBeNull()
	}
})

test('a Cursor tool call renders, and the four events it shares with Claude Code still do', () => {
	// Cursor's `--output-format stream-json` emits Claude Code's shapes for
	// `system`, `user`, `assistant` and `result` — the same keys, the same
	// nesting. `renderLine` gives a line to the first adapter that recognises
	// it, so those four are already rendered correctly by an adapter with
	// another host's name on it, and only `tool_call` is Cursor's own.
	expect(renderLine({ type: 'system', subtype: 'init' })).toMatchObject({ kind: 'started' })
	expect(
		renderLine({ type: 'assistant', message: { content: [{ type: 'text', text: 'reading' }] } }),
	).toMatchObject({ kind: 'text', text: 'reading' })
	expect(renderLine({ type: 'result', subtype: 'success', is_error: false })).toMatchObject({
		kind: 'result',
	})

	expect(
		renderLine({
			type: 'tool_call',
			subtype: 'started',
			tool_call: { readToolCall: { args: { path: 'README.md' } } },
		}),
	).toMatchObject({ kind: 'tool', text: 'read README.md' })
})

test('a Cursor tool call is one line, at the start, not two around the work', () => {
	// Cursor reports a call twice, `started` then `completed`. Rendering both
	// would double every tool in the log, and the half a reader wants is the
	// one that says what is happening now.
	expect(
		renderLine({
			type: 'tool_call',
			subtype: 'completed',
			tool_call: { writeToolCall: { args: { path: 'out.txt' } } },
		}),
	).toBeNull()
})

test('a host echoing its own prompt back is not a human answering', () => {
	// Cursor emits `type: "user"` on every run, carrying the brief SOBER just
	// sent, and its shape is Claude Code's. Rendered as an answer it would put a
	// machine's own instructions — `NO_HUMAN` among them — into the half of the
	// transcript ADR 0046 keeps for what the human actually said.
	//
	// What separates them is what SOBER itself writes: an attended answer goes
	// to stdin as `{type, message}` and comes back echoed, with no session on
	// it. A host echoing its own prompt stamps the session it belongs to.
	expect(
		renderLine({ type: 'user', message: { content: [{ type: 'text', text: 'ship it' }] } }),
	).toMatchObject({ kind: 'answer', text: 'ship it' })

	expect(
		renderLine({
			type: 'user',
			session_id: 'c6b62c6f-7ead-4fd6-9922-e952131177ff',
			message: { content: [{ type: 'text', text: 'the whole brief' }] },
		}),
	).toBeNull()
})

test('a Cursor tool with no path of its own still says which tool it was', () => {
	// Read and write name themselves and carry a path. The reference says
	// everything else arrives under `function`, with its name inside — so a
	// shell command renders as a line rather than as nothing.
	expect(
		renderLine({
			type: 'tool_call',
			subtype: 'started',
			tool_call: { function: { name: 'shell' } },
		}),
	).toMatchObject({ kind: 'tool', text: 'shell' })

	// A shape with no tool in it at all is not a line, and not a crash either.
	expect(renderLine({ type: 'tool_call', subtype: 'started', tool_call: {} })).toBeNull()
})
