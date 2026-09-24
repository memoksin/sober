import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LogLineInput as LogLine } from '@besober/schema'
import { afterEach, expect, test } from 'vitest'
import { runAgent } from './agent.js'

let dir: string | undefined
afterEach(() => {
	if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
})

const setup = (): string => {
	dir = mkdtempSync(join(tmpdir(), 'sober-agent-'))
	writeFileSync(join(dir, 'CLAUDE.md'), 'Never use var.')
	writeFileSync(join(dir, 'target.txt'), 'hello world')
	return dir
}

const jsonResponse = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status })

const toolCallResponse = (name: string, args: Record<string, unknown>) =>
	jsonResponse({
		choices: [
			{
				message: {
					role: 'assistant',
					content: null,
					tool_calls: [
						{ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } },
					],
				},
			},
		],
		usage: { prompt_tokens: 10, completion_tokens: 5 },
	})

const textResponse = (text: string) =>
	jsonResponse({
		choices: [{ message: { role: 'assistant', content: text } }],
		usage: { prompt_tokens: 3, completion_tokens: 2 },
	})

test('edits a file through a tool call, carries CLAUDE.md and NO_HUMAN, and finishes', async () => {
	const cwd = setup()
	const calls: { url: string; body: string }[] = []
	const fetchFn = (async (url: string, init?: RequestInit) => {
		calls.push({ url, body: String(init?.body) })
		return calls.length === 1
			? toolCallResponse('edit_file', { path: 'target.txt', old: 'world', new: 'there' })
			: textResponse('done')
	}) as typeof fetch

	const lines: LogLine[] = []
	const exit = await runAgent({
		model: 'test-model',
		apiKey: 'key',
		cwd,
		prompt: 'edit the file',
		onLine: (line) => lines.push(line),
		fetch: fetchFn,
	})

	expect(exit).toEqual({ kind: 'finished' })
	expect(readFileSync(join(cwd, 'target.txt'), 'utf8')).toBe('hello there')
	expect(lines.map((l) => l.kind)).toEqual(['tool', 'output', 'text', 'result'])

	const firstBody = JSON.parse(calls[0]?.body ?? '{}') as {
		messages: { role: string; content: string }[]
	}
	expect(firstBody.messages[0]?.content).toContain('Never use var.')
	expect(firstBody.messages[0]?.content).toContain('No human is reading this session')
})

test('retries a 429 once, logs a waiting line, then finishes', async () => {
	const cwd = setup()
	let attempt = 0
	const fetchFn = (async () => {
		attempt++
		return attempt === 1 ? jsonResponse({ error: 'rate limited' }, 429) : textResponse('ok')
	}) as typeof fetch

	const lines: LogLine[] = []
	const exit = await runAgent({
		model: 'm',
		apiKey: 'k',
		cwd,
		prompt: 'p',
		onLine: (line) => lines.push(line),
		fetch: fetchFn,
		backoffMs: [0, 0],
	})

	expect(exit).toEqual({ kind: 'finished' })
	expect(lines.filter((l) => l.kind === 'raw')).toHaveLength(1)
	expect(lines[0]?.text).toContain('waiting on 429')
})

test('fails after four 429s naming the status', async () => {
	const cwd = setup()
	const fetchFn = (async () => jsonResponse({ error: 'rate limited' }, 429)) as typeof fetch

	const exit = await runAgent({
		model: 'm',
		apiKey: 'k',
		cwd,
		prompt: 'p',
		onLine: () => {},
		fetch: fetchFn,
		backoffMs: [0, 0],
	})

	expect(exit.kind).toBe('failed')
	expect((exit as { reason: string }).reason).toContain('429')
})

test('fails at once on a 401 with no waiting line', async () => {
	const cwd = setup()
	const fetchFn = (async () => jsonResponse({ error: 'unauthorized' }, 401)) as typeof fetch

	const lines: LogLine[] = []
	const exit = await runAgent({
		model: 'm',
		apiKey: 'k',
		cwd,
		prompt: 'p',
		onLine: (line) => lines.push(line),
		fetch: fetchFn,
	})

	expect(exit.kind).toBe('failed')
	expect((exit as { reason: string }).reason).toContain('401')
	expect(lines.filter((l) => l.kind === 'raw')).toHaveLength(0)
})

test('a pre-aborted signal stops without a request', async () => {
	const cwd = setup()
	const controller = new AbortController()
	controller.abort()
	let called = false
	const fetchFn = (async () => {
		called = true
		return textResponse('unused')
	}) as typeof fetch

	const exit = await runAgent({
		model: 'm',
		apiKey: 'k',
		cwd,
		prompt: 'p',
		onLine: () => {},
		fetch: fetchFn,
		signal: controller.signal,
	})

	expect(exit).toEqual({ kind: 'stopped' })
	expect(called).toBe(false)
})

test('edit_file with a non-unique old is refused and the loop continues', async () => {
	const cwd = setup()
	writeFileSync(join(cwd, 'target.txt'), 'aa')
	let attempt = 0
	const toolResults: string[] = []
	const fetchFn = (async (_url: string, init?: RequestInit) => {
		attempt++
		if (attempt === 1)
			return toolCallResponse('edit_file', { path: 'target.txt', old: 'a', new: 'b' })
		const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] }
		const last = body.messages.at(-1)
		if (last?.role === 'tool') toolResults.push(last.content)
		return textResponse('done')
	}) as typeof fetch

	const exit = await runAgent({
		model: 'm',
		apiKey: 'k',
		cwd,
		prompt: 'p',
		onLine: () => {},
		fetch: fetchFn,
	})

	expect(exit).toEqual({ kind: 'finished' })
	expect(toolResults[0]).toContain('not unique')
	expect(readFileSync(join(cwd, 'target.txt'), 'utf8')).toBe('aa')
})

test('a path outside cwd is refused in the tool result', async () => {
	const cwd = setup()
	let attempt = 0
	const toolResults: string[] = []
	const fetchFn = (async (_url: string, init?: RequestInit) => {
		attempt++
		if (attempt === 1) return toolCallResponse('read_file', { path: '../outside' })
		const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] }
		const last = body.messages.at(-1)
		if (last?.role === 'tool') toolResults.push(last.content)
		return textResponse('done')
	}) as typeof fetch

	const exit = await runAgent({
		model: 'm',
		apiKey: 'k',
		cwd,
		prompt: 'p',
		onLine: () => {},
		fetch: fetchFn,
	})

	expect(exit).toEqual({ kind: 'finished' })
	expect(toolResults[0]).toContain('outside the working directory')
})

test('a bash tool call whose signal is aborted while it runs returns stopped', async () => {
	const cwd = setup()
	const controller = new AbortController()
	const fetchFn = (async () => toolCallResponse('bash', { command: 'sleep 5' })) as typeof fetch

	const promise = runAgent({
		model: 'm',
		apiKey: 'k',
		cwd,
		prompt: 'p',
		onLine: () => {},
		fetch: fetchFn,
		signal: controller.signal,
	})
	setTimeout(() => controller.abort(), 50)

	const exit = await promise
	expect(exit).toEqual({ kind: 'stopped' })
})

/** One scripted run: each entry is what the model asks next, in order. */
const scripted = (
	turns: readonly ({ tool: string; args: Record<string, unknown> } | { raw: Response })[],
): { fetchFn: typeof fetch; toolResults: string[] } => {
	const toolResults: string[] = []
	let turn = 0
	const fetchFn = (async (_url: string, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] }
		const last = body.messages.at(-1)
		if (last?.role === 'tool') toolResults.push(last.content)
		const next = turns[turn++]
		if (next === undefined) return textResponse('done')
		if ('raw' in next) return next.raw
		return toolCallResponse(next.tool, next.args)
	}) as typeof fetch
	return { fetchFn, toolResults }
}

test('every tool answers, and a bad call is a tool result rather than a crash', async () => {
	const cwd = setup()
	writeFileSync(join(cwd, 'AGENTS.md'), 'Agents rule.')
	const { fetchFn, toolResults } = scripted([
		{ tool: 'bash', args: { command: 'echo hi; echo err >&2' } },
		{ tool: 'read_file', args: { path: 'target.txt' } },
		{ tool: 'read_file', args: { path: 'missing.txt' } },
		{ tool: 'write_file', args: { path: 'deep/new.txt', content: 'made' } },
		{ tool: 'edit_file', args: { path: 'target.txt', old: 'absent', new: 'x' } },
		{ tool: 'edit_file', args: { path: 'missing.txt', old: 'a', new: 'b' } },
		{ tool: 'nope', args: {} },
		{
			raw: jsonResponse({
				choices: [
					{
						message: {
							role: 'assistant',
							tool_calls: [
								{ id: 'c', type: 'function', function: { name: 'bash', arguments: '{not json' } },
							],
						},
					},
				],
			}),
		},
	])
	const calls: string[] = []
	const exit = await runAgent({
		model: 'm',
		apiKey: 'k',
		cwd,
		prompt: 'p',
		onLine: (line) => calls.push(`${line.kind} ${line.text}`),
		fetch: fetchFn,
	})

	expect(exit).toEqual({ kind: 'finished' })
	expect(toolResults[0]).toContain('hi\nerr\n\nexit code: 0')
	expect(toolResults[1]).toBe('hello world')
	expect(toolResults[2]).toMatch(/ENOENT/)
	expect(readFileSync(join(cwd, 'deep/new.txt'), 'utf8')).toBe('made')
	expect(toolResults[3]).toBe('written')
	expect(toolResults[4]).toContain('does not appear')
	expect(toolResults[5]).toMatch(/ENOENT/)
	expect(toolResults[6]).toBe('unknown tool: nope')
	expect(toolResults[7]).toContain('invalid arguments')
	expect(calls[0]).toBe('tool bash echo hi; echo err >&2')
	expect(calls.filter((c) => c.startsWith('tool ')).at(-1)).toBe('tool bash {not json')
})

test('a network error is retried like a 5xx, and a malformed body fails', async () => {
	const cwd = setup()
	let attempt = 0
	const fetchFn = (async () => {
		attempt++
		if (attempt === 1) throw new Error('ECONNRESET')
		return jsonResponse({ choices: [] })
	}) as typeof fetch
	const lines: LogLine[] = []
	const exit = await runAgent({
		model: 'm',
		apiKey: 'k',
		cwd,
		prompt: 'p',
		onLine: (line) => lines.push(line),
		fetch: fetchFn,
		backoffMs: [0, 0],
	})
	expect(lines[0]?.text).toContain('waiting on network error')
	expect(exit).toEqual({ kind: 'failed', reason: expect.stringContaining('malformed') })
})

test('a network error that never clears fails naming the endpoint', async () => {
	const cwd = setup()
	const fetchFn = (async () => {
		throw new Error('ECONNRESET')
	}) as typeof fetch
	const exit = await runAgent({
		model: 'm',
		apiKey: 'k',
		cwd,
		prompt: 'p',
		onLine: () => {},
		fetch: fetchFn,
		backoffMs: [0, 0],
	})
	expect(exit).toEqual({ kind: 'failed', reason: expect.stringContaining('could not be reached') })
})

test('a model that never stops calling tools hits the turn cap', async () => {
	const cwd = setup()
	const fetchFn = (async () =>
		toolCallResponse('read_file', { path: 'target.txt' })) as typeof fetch
	const exit = await runAgent({
		model: 'm',
		apiKey: 'k',
		cwd,
		prompt: 'p',
		onLine: () => {},
		fetch: fetchFn,
	})
	expect(exit).toEqual({ kind: 'failed', reason: expect.stringContaining('200-turn cap') })
})

test('write_file and edit_file refuse a path outside cwd, and a write into a file-as-directory fails', async () => {
	const cwd = setup()
	const { fetchFn, toolResults } = scripted([
		{ tool: 'write_file', args: { path: '../escape.txt', content: 'x' } },
		{ tool: 'edit_file', args: { path: '/etc/hosts', old: 'a', new: 'b' } },
		{ tool: 'write_file', args: { path: 'target.txt/child.txt', content: 'x' } },
	])
	const exit = await runAgent({
		model: 'm',
		apiKey: 'k',
		cwd,
		prompt: 'p',
		onLine: () => {},
		fetch: fetchFn,
	})
	expect(exit).toEqual({ kind: 'finished' })
	expect(toolResults[0]).toContain('outside the working directory')
	expect(toolResults[1]).toContain('outside the working directory')
	expect(toolResults[2]).toMatch(/ENOTDIR|EEXIST/)
})

test('an instructions file that cannot be read is a failed run, not a silent omission', async () => {
	const cwd = setup()
	rmSync(join(cwd, 'CLAUDE.md'))
	mkdirSync(join(cwd, 'CLAUDE.md'))
	await expect(
		runAgent({
			model: 'm',
			apiKey: 'k',
			cwd,
			prompt: 'p',
			onLine: () => {},
			fetch: (async () => textResponse('unused')) as typeof fetch,
		}),
	).rejects.toThrow(/EISDIR/)
})

test('a stop during the backoff wait ends the run as stopped', async () => {
	const cwd = setup()
	const controller = new AbortController()
	const fetchFn = (async () => {
		setTimeout(() => controller.abort(), 5)
		return jsonResponse({ error: 'busy' }, 503)
	}) as typeof fetch
	const exit = await runAgent({
		model: 'm',
		apiKey: 'k',
		cwd,
		prompt: 'p',
		onLine: () => {},
		fetch: fetchFn,
		signal: controller.signal,
		backoffMs: [10_000],
	})
	expect(exit).toEqual({ kind: 'stopped' })
})

test('a stop that lands between two tool calls is honoured before the second one', async () => {
	const cwd = setup()
	const controller = new AbortController()
	const fetchFn = (async () =>
		jsonResponse({
			choices: [
				{
					message: {
						role: 'assistant',
						content: null,
						tool_calls: [
							{
								id: 'a',
								type: 'function',
								function: { name: 'bash', arguments: '{"command":"true"}' },
							},
							{
								id: 'b',
								type: 'function',
								function: { name: 'bash', arguments: '{"command":"true"}' },
							},
						],
					},
				},
			],
		})) as typeof fetch
	let seen = 0
	const exit = await runAgent({
		model: 'm',
		apiKey: 'k',
		cwd,
		prompt: 'p',
		onLine: (line) => {
			if (line.kind === 'tool' && ++seen === 1) controller.abort()
		},
		fetch: fetchFn,
		signal: controller.signal,
	})
	expect(exit).toEqual({ kind: 'stopped' })
	expect(seen).toBe(1)
})

test('a tool line carries its call and argument, and its result follows as an output line', async () => {
	const cwd = setup()
	let turn = 0
	const fetchFn = (async () =>
		++turn === 1
			? toolCallResponse('bash', { command: 'echo hi' })
			: textResponse('done')) as typeof fetch
	const lines: LogLine[] = []
	await runAgent({
		model: 'm',
		apiKey: 'k',
		cwd,
		prompt: 'p',
		onLine: (line) => lines.push(line),
		fetch: fetchFn,
	})

	expect(lines[0]).toMatchObject({ kind: 'tool', tool: 'bash', call: 'call_1', detail: 'echo hi' })
	expect(lines[1]).toMatchObject({ kind: 'output', text: 'exit 0', tool: 'bash', call: 'call_1' })
	expect(lines[1]?.body).toContain('hi')
})
