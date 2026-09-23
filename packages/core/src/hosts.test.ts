import { expect, test } from 'vitest'
import { NO_HUMAN } from './host.js'
import { adapterFor, capBody, renderLine, summarize, UnknownHostError } from './hosts.js'

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
	expect(() => adapterFor('aider')).toThrow(/claude, codex, opencode, cursor, openrouter/)
})

test('every adapter tells a headless run that nobody can answer it', () => {
	// The M2 gate's finding 1 is not a Claude Code fact: any host discovers the
	// operator's own rules file, and a rule there stopped two of five
	// dispatches dead. Claude Code has a flag for it; the other two do not, so
	// the same sentence goes in front of the brief.
	for (const host of ['claude', 'codex', 'opencode', 'cursor', 'openrouter']) {
		const argv = adapterFor(host).argv('build the node', false)
		expect(argv.join('\n'), host).toContain(NO_HUMAN)
	}
})

test('the brief is an argument, never a shell string, in every adapter', () => {
	// A brief carrying a backtick is text. `startAgent` never uses a shell, and
	// the adapters must not hand one a single joined string either.
	for (const host of ['claude', 'codex', 'opencode', 'cursor', 'openrouter']) {
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
	for (const host of ['claude', 'codex', 'opencode', 'cursor', 'openrouter']) {
		expect(adapterFor(host).loggedIn('<html>504 Gateway Timeout</html>'), host).toBeNull()
	}
})

test('a Cursor tool call renders, and the four events it shares with Claude Code still do', () => {
	// Cursor's `--output-format stream-json` emits Claude Code's shapes for
	// `system`, `user`, `assistant` and `result` — the same keys, the same
	// nesting. `renderLine` gives a line to the first adapter that recognises
	// it, so those four are already rendered correctly by an adapter with
	// another host's name on it, and only `tool_call` is Cursor's own.
	expect(renderLine({ type: 'system', subtype: 'init' })).toMatchObject([{ kind: 'started' }])
	expect(
		renderLine({ type: 'assistant', message: { content: [{ type: 'text', text: 'reading' }] } }),
	).toMatchObject([{ kind: 'text', text: 'reading' }])
	expect(renderLine({ type: 'result', subtype: 'success', is_error: false })).toMatchObject([
		{
			kind: 'result',
		},
	])

	expect(
		renderLine({
			type: 'tool_call',
			subtype: 'started',
			tool_call: { readToolCall: { args: { path: 'README.md' } } },
		}),
	).toMatchObject([{ kind: 'tool', text: 'read README.md' }])
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
	).toEqual([])
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
	).toMatchObject([{ kind: 'answer', text: 'ship it' }])

	expect(
		renderLine({
			type: 'user',
			session_id: 'c6b62c6f-7ead-4fd6-9922-e952131177ff',
			message: { content: [{ type: 'text', text: 'the whole brief' }] },
		}),
	).toEqual([])
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
	).toMatchObject([{ kind: 'tool', text: 'shell' }])

	// A shape with no tool in it at all is not a line, and not a crash either.
	expect(renderLine({ type: 'tool_call', subtype: 'started', tool_call: {} })).toEqual([])
})

test('one Claude assistant event is a line per part, each tool named, thinking kept', () => {
	expect(
		renderLine({
			type: 'assistant',
			message: {
				content: [
					{ type: 'thinking', thinking: ' weighing it ' },
					{ type: 'text', text: 'Reading the brief.' },
					{ type: 'tool_use', name: 'Read' },
					{ type: 'tool_use', name: 'Bash' },
				],
			},
		}),
	).toMatchObject([
		{ kind: 'thinking', text: 'weighing it', tool: null },
		{ kind: 'text', text: 'Reading the brief.', tool: null },
		{ kind: 'tool', text: 'Read', tool: 'Read' },
		{ kind: 'tool', text: 'Bash', tool: 'Bash' },
	])
})

test('a Claude init event names the resolved model, so an alias run still says what ran', () => {
	expect(renderLine({ type: 'system', subtype: 'init' })).toMatchObject([
		{ kind: 'started', text: 'session started', tool: null },
	])
	expect(renderLine({ type: 'system', subtype: 'init', model: 'claude-opus-4-6' })).toMatchObject([
		{ kind: 'started', text: 'session started (claude-opus-4-6)', tool: null },
	])
})

test('every host carries the tool name on the line', () => {
	expect(
		renderLine({ type: 'item.completed', item: { type: 'command_execution', command: 'ls -la' } }),
	).toMatchObject([{ kind: 'tool', text: 'ls -la', tool: 'command' }])
	expect(renderLine({ type: 'tool_use', part: { tool: 'edit' } })).toMatchObject([
		{ kind: 'tool', text: 'edit', tool: 'edit' },
	])
	expect(
		renderLine({
			type: 'tool_call',
			subtype: 'started',
			tool_call: { readToolCall: { args: { path: 'README.md' } } },
		}),
	).toMatchObject([{ kind: 'tool', text: 'read README.md', tool: 'read' }])
})

test('openrouter is found from its run line and spawns `sober`, not a CLI called openrouter', () => {
	// ADR 0062: the host is SOBER's own loop, so the row names the binary that
	// runs it. The run line's args go first, then the subcommand and the brief.
	const adapter = adapterFor('openrouter --model qwen/qwen3.8-27b:free')
	expect(adapter.id).toBe('openrouter')
	expect(adapter.command).toBe('sober')
	expect(adapter.probe).toEqual(['agent', '--check'])
	expect(adapter.attendable).toBe(false)
	const argv = adapter.argv('build the node', false)
	expect(argv[0]).toBe('agent')
	expect(argv).toHaveLength(2)
	expect(adapter.loggedIn('ok\n')).toBe(true)
	expect(adapter.loggedIn('no key: set OPENROUTER_API_KEY in .sober/.env\n')).toBe(false)
	expect(adapter.loggedIn('401: the key was refused\n')).toBe(false)
	expect(adapter.signIn('openrouter')).toContain('OPENROUTER_API_KEY')
})

test('the loop’s own JSON events render, and a kind it does not know is dropped', () => {
	expect(renderLine({ type: 'sober', kind: 'tool', text: 'bash ls', tool: 'bash' })).toMatchObject([
		{ kind: 'tool', text: 'bash ls', tool: 'bash' },
	])
	expect(renderLine({ type: 'sober', kind: 'nope' })).toEqual([])
	// Not the loop's shape: the other adapters still own theirs.
	expect(renderLine({ type: 'system', subtype: 'init' })).toMatchObject([{ kind: 'started' }])
})

test('a Claude tool call carries its call id and the argument a person reads', () => {
	const tool = (name: string, input: Record<string, unknown>) =>
		renderLine({
			type: 'assistant',
			message: { content: [{ type: 'tool_use', id: 'toolu_1', name, input }] },
		})
	expect(tool('Read', { file_path: 'src/a.ts' })).toMatchObject([
		{ kind: 'tool', tool: 'Read', call: 'toolu_1', detail: 'src/a.ts' },
	])
	expect(tool('Bash', { command: 'pnpm test\n--run' })).toMatchObject([{ detail: 'pnpm test' }])
	expect(tool('Grep', { pattern: 'TODO' })).toMatchObject([{ detail: 'TODO' }])
	expect(tool('WebFetch', { url: 'https://x.dev' })).toMatchObject([{ detail: 'https://x.dev' }])
	expect(tool('Task', { description: 'find it' })).toMatchObject([{ detail: 'find it' }])
	// A tool whose argument SOBER does not know is named, never guessed at.
	expect(tool('TodoWrite', { todos: [] })).toMatchObject([{ detail: null }])
})

test('a Claude tool result is an output line paired by tool_use_id, with a summary', () => {
	const result = (content: unknown, is_error?: boolean) =>
		renderLine({
			type: 'user',
			session_id: 's',
			message: {
				content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content, is_error } as never],
			},
		})
	const file = Array.from({ length: 92 }, (_, i) => `line ${i}`).join('\n')
	expect(result(file)).toMatchObject([
		{ kind: 'output', text: '92 lines', call: 'toolu_1', tool: null, at: null },
	])
	expect(result([{ type: 'text', text: 'done' }])).toMatchObject([{ text: 'done', body: 'done' }])
	expect(result('Exit code 2\nboom', true)).toMatchObject([{ text: 'error: Exit code 2' }])
	expect(result('Exit code 2\nboom')).toMatchObject([{ text: 'exit 2' }])
})

test('a Codex command carries its item id, and its exit code and output become an output line', () => {
	expect(
		renderLine({
			type: 'item.completed',
			item: {
				id: 'item_3',
				type: 'command_execution',
				command: 'ls',
				aggregated_output: 'a\nb\n',
				exit_code: 1,
			},
		}),
	).toMatchObject([
		{ kind: 'tool', text: 'ls', call: 'item_3', detail: 'ls' },
		{ kind: 'output', text: 'exit 1', call: 'item_3', body: 'a\nb\n' },
	])
})

test('an OpenCode tool carries its callID, its command, and its completed output', () => {
	expect(
		renderLine({
			type: 'tool_use',
			part: {
				type: 'tool',
				tool: 'bash',
				callID: 'c1',
				state: { status: 'completed', input: { command: 'ls' }, output: 'a\nb' },
			},
		}),
	).toMatchObject([
		{ kind: 'tool', tool: 'bash', call: 'c1', detail: 'ls' },
		{ kind: 'output', text: '2 lines', tool: 'bash', call: 'c1', body: 'a\nb' },
	])
})

test('a host whose stream carries no correlator leaves call, detail and at null', () => {
	// Cursor's documented tool_call has no id pairing `started` to `completed`.
	expect(
		renderLine({
			type: 'tool_call',
			subtype: 'started',
			tool_call: { readToolCall: { args: { path: 'README.md' } } },
		}),
	).toEqual([
		{
			kind: 'tool',
			text: 'read README.md',
			tool: 'read',
			at: null,
			call: null,
			detail: null,
			body: null,
		},
	])
})

test('the loop’s output line survives the round trip through its own JSON', () => {
	expect(
		renderLine({
			type: 'sober',
			kind: 'output',
			text: 'exit 0',
			tool: 'bash',
			call: 'c',
			body: 'hi',
		}),
	).toMatchObject([{ kind: 'output', text: 'exit 0', call: 'c', body: 'hi' }])
})

test('a body is capped at 40 lines or 4 KB, and says so', () => {
	expect(capBody('short')).toBe('short')
	const long = Array.from({ length: 50 }, (_, i) => `${i}`).join('\n')
	expect(capBody(long).split('\n')).toHaveLength(41)
	expect(capBody(long)).toMatch(/\n… \(truncated\)$/)
	expect(capBody('x'.repeat(5000))).toHaveLength(4096 + '\n… (truncated)'.length)
	expect(summarize('hi\nerr\n\nexit code: 0')).toBe('exit 0')
})
