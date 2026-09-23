import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { LogLineInput } from '@besober/schema'
import type { AgentExit } from './host.js'
import { capBody, NO_HUMAN, summarize } from './hosts.js'

export type { AgentExit }

export interface LoopOptions {
	readonly baseUrl?: string
	readonly model: string
	readonly apiKey: string
	readonly cwd: string
	readonly prompt: string
	readonly onLine: (line: LogLineInput) => void
	readonly signal?: AbortSignal
	readonly fetch?: typeof fetch
	readonly backoffMs?: readonly number[]
}

const MAX_TURNS = 200
const MAX_RETRIES = 3
const DEFAULT_BACKOFF_MS = [2000, 4000]
const BASH_TIMEOUT_MS = 120_000

interface ToolDef {
	readonly type: 'function'
	readonly function: {
		readonly name: string
		readonly description: string
		readonly parameters: Record<string, unknown>
	}
}

const TOOLS: readonly ToolDef[] = [
	{
		type: 'function',
		function: {
			name: 'bash',
			description: 'Run a shell command in the working directory.',
			parameters: {
				type: 'object',
				properties: { command: { type: 'string' } },
				required: ['command'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'read_file',
			description: 'Read a file, given a path relative to the working directory.',
			parameters: {
				type: 'object',
				properties: { path: { type: 'string' } },
				required: ['path'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'write_file',
			description: 'Write a file, given a path relative to the working directory and its content.',
			parameters: {
				type: 'object',
				properties: { path: { type: 'string' }, content: { type: 'string' } },
				required: ['path', 'content'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'edit_file',
			description: 'Replace an exact, unique substring of a file with another.',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string' },
					old: { type: 'string' },
					new: { type: 'string' },
				},
				required: ['path', 'old', 'new'],
			},
		},
	},
]

interface ToolCall {
	readonly id: string
	readonly type: 'function'
	readonly function: { readonly name: string; readonly arguments: string }
}

interface Message {
	readonly role: 'system' | 'user' | 'assistant' | 'tool'
	readonly content?: string | null
	readonly tool_calls?: readonly ToolCall[]
	readonly tool_call_id?: string
}

interface ChatResponse {
	readonly choices?: readonly { readonly message?: Message }[]
	readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number }
}

const readIfExists = async (path: string): Promise<string | null> => {
	try {
		return await readFile(path, 'utf8')
	} catch (error) {
		if ((error as { code?: string }).code === 'ENOENT') return null
		throw error
	}
}

const systemPrompt = async (cwd: string): Promise<string> => {
	const parts = [NO_HUMAN]
	const claude = await readIfExists(join(cwd, 'CLAUDE.md'))
	if (claude !== null) parts.push(`# CLAUDE.md\n\n${claude}`)
	const agents = await readIfExists(join(cwd, 'AGENTS.md'))
	if (agents !== null) parts.push(`# AGENTS.md\n\n${agents}`)
	parts.push(
		'You have four tools: bash, read_file, write_file, edit_file. Use them to do the work described, and commit it when done.',
	)
	return parts.join('\n\n---\n\n')
}

/** Refuses a path that escapes `cwd` after resolving `..` and symlink-free joins. */
const withinCwd = (cwd: string, path: string): string | null => {
	const target = isAbsolute(path) ? resolve(path) : resolve(cwd, path)
	const rel = relative(cwd, target)
	if (rel.startsWith('..') || isAbsolute(rel)) return null
	return target
}

const runBash = (command: string, cwd: string, signal?: AbortSignal): Promise<string> =>
	new Promise((resolvePromise) => {
		let done = false
		const res = (value: string): void => {
			if (done) return
			done = true
			resolvePromise(value)
		}
		const child = spawn('sh', ['-c', command], { cwd, signal })
		let output = ''
		child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
		child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
		let timedOut = false
		const timer = setTimeout(() => {
			timedOut = true
			child.kill('SIGTERM')
		}, BASH_TIMEOUT_MS)
		child.on('error', (error) => {
			clearTimeout(timer)
			res(`error: ${error.message}\nexit code: null`)
		})
		child.on('close', (code) => {
			clearTimeout(timer)
			const note = timedOut ? '\n[timed out after 120s, killed]' : ''
			res(`${output}${note}\nexit code: ${code}`)
		})
	})

const runTool = async (
	name: string,
	rawArgs: string,
	cwd: string,
	signal?: AbortSignal,
): Promise<string> => {
	let args: Record<string, unknown>
	try {
		args = JSON.parse(rawArgs) as Record<string, unknown>
	} catch {
		return `invalid arguments: ${rawArgs}`
	}

	if (name === 'bash') return runBash(String(args.command ?? ''), cwd, signal)

	if (name === 'read_file') {
		const target = withinCwd(cwd, String(args.path ?? ''))
		if (target === null) return `refused: path is outside the working directory`
		try {
			return await readFile(target, 'utf8')
		} catch (error) {
			return (error as Error).message
		}
	}

	if (name === 'write_file') {
		const target = withinCwd(cwd, String(args.path ?? ''))
		if (target === null) return `refused: path is outside the working directory`
		try {
			await mkdir(dirname(target), { recursive: true })
			await writeFile(target, String(args.content ?? ''), 'utf8')
			return 'written'
		} catch (error) {
			return (error as Error).message
		}
	}

	if (name === 'edit_file') {
		const target = withinCwd(cwd, String(args.path ?? ''))
		if (target === null) return `refused: path is outside the working directory`
		const oldText = String(args.old ?? '')
		const newText = String(args.new ?? '')
		try {
			const content = await readFile(target, 'utf8')
			const first = content.indexOf(oldText)
			if (first === -1) return `refused: 'old' does not appear in the file`
			if (content.indexOf(oldText, first + 1) !== -1)
				return `refused: 'old' is not unique in the file`
			await writeFile(
				target,
				content.slice(0, first) + newText + content.slice(first + oldText.length),
				'utf8',
			)
			return 'edited'
		} catch (error) {
			return (error as Error).message
		}
	}

	return `unknown tool: ${name}`
}

const oneLineArg = (rawArgs: string): string => {
	try {
		const args = JSON.parse(rawArgs) as Record<string, unknown>
		const first = Object.values(args)[0]
		return typeof first === 'string' ? (first.split('\n')[0] ?? '') : JSON.stringify(args)
	} catch {
		return rawArgs
	}
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
	new Promise((res) => {
		const timer = setTimeout(res, ms)
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(timer)
				res()
			},
			{ once: true },
		)
	})

const firstLine = (body: string): string => (body.split('\n')[0] ?? '').trim()

export const runAgent = async (options: LoopOptions): Promise<AgentExit> => {
	const baseUrl = (options.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '')
	const fetchFn = options.fetch ?? fetch
	const { signal } = options
	const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS

	const messages: Message[] = [
		{ role: 'system', content: await systemPrompt(options.cwd) },
		{ role: 'user', content: options.prompt },
	]

	let promptTokens = 0
	let completionTokens = 0

	for (let turn = 0; turn < MAX_TURNS; turn++) {
		if (signal?.aborted) return { kind: 'stopped' }

		let response: ChatResponse | null = null
		for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
			if (signal?.aborted) return { kind: 'stopped' }

			let res: Response
			try {
				res = await fetchFn(`${baseUrl}/chat/completions`, {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						authorization: `Bearer ${options.apiKey}`,
					},
					body: JSON.stringify({ model: options.model, messages, tools: TOOLS, stream: false }),
					signal,
				})
			} catch (error) {
				if (signal?.aborted) return { kind: 'stopped' }
				if (attempt > MAX_RETRIES)
					return {
						kind: 'failed',
						reason: `${baseUrl} could not be reached: ${(error as Error).message}`,
					}
				options.onLine({
					kind: 'raw',
					text: `waiting on network error, try ${attempt} of ${MAX_RETRIES}`,
					tool: null,
				})
				await sleep(backoffMs[attempt - 1] ?? backoffMs.at(-1) ?? 4000, signal)
				continue
			}

			if (res.ok) {
				response = (await res.json()) as ChatResponse
				break
			}

			const retryable = res.status === 429 || res.status >= 500
			if (!retryable || attempt > MAX_RETRIES) {
				const body = await res.text()
				return {
					kind: 'failed',
					reason: `${baseUrl} answered ${res.status}: ${firstLine(body)}`,
				}
			}
			options.onLine({
				kind: 'raw',
				text: `waiting on ${res.status}, try ${attempt} of ${MAX_RETRIES}`,
				tool: null,
			})
			await sleep(backoffMs[attempt - 1] ?? backoffMs.at(-1) ?? 4000, signal)
		}

		if (response === null) return { kind: 'failed', reason: `${baseUrl} gave no response` }

		const message = response.choices?.[0]?.message
		if (message === undefined)
			return { kind: 'failed', reason: `${baseUrl} sent a malformed response body` }

		promptTokens += response.usage?.prompt_tokens ?? 0
		completionTokens += response.usage?.completion_tokens ?? 0

		messages.push(message)

		if (message.content !== undefined && message.content !== null && message.content.length > 0)
			options.onLine({ kind: 'text', text: message.content, tool: null })

		const toolCalls = message.tool_calls ?? []
		if (toolCalls.length === 0) {
			options.onLine({
				kind: 'result',
				text: `finished — ${promptTokens} in, ${completionTokens} out`,
				tool: null,
			})
			return { kind: 'finished' }
		}

		for (const call of toolCalls) {
			const detail = oneLineArg(call.function.arguments)
			const tool = call.function.name
			options.onLine({ kind: 'tool', text: `${tool} ${detail}`, tool, call: call.id, detail })
			if (signal?.aborted) return { kind: 'stopped' }
			const result = await runTool(tool, call.function.arguments, options.cwd, signal)
			options.onLine({
				kind: 'output',
				text: summarize(result),
				tool,
				call: call.id,
				body: capBody(result),
			})
			messages.push({ role: 'tool', tool_call_id: call.id, content: result })
		}
	}

	return { kind: 'failed', reason: `ponytail: hit the ${MAX_TURNS}-turn cap` }
}
