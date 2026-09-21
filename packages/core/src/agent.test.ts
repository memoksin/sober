import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LogLine } from '@besober/schema'
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
	expect(lines.map((l) => l.kind)).toEqual(['tool', 'text', 'result'])

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
