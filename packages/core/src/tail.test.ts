import { beforeEach, expect, test } from 'vitest'
import { initBoard } from './board.js'
import { appendRunOutput } from './local.js'
import type { Paths } from './paths.js'
import { aNode } from './records.fixture.js'
import { writeNode } from './records.js'
import { finishRun, startRun } from './run.js'
import { followRun, tail } from './tail.js'
import { tmpRoot } from './tmp.fixture.js'

let paths: Paths

beforeEach(async () => {
	const root = await tmpRoot('sober-tail-')
	paths = (await initBoard(root, { title: 'Acme', intent: 'ship', constraints: [] })).paths
	await writeNode(paths, 'auth-api-k7f2', aNode())
})

const said = (text: string) =>
	`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })}\n`

test('a window on a log nobody has read yet starts at the top and says where to ask again', async () => {
	const { id } = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	await appendRunOutput(paths, id, said('first'))

	const window = await followRun(paths, id)

	expect(window.lines.map((line) => line.text)).toEqual(['first'])
	expect(window.offset).toBeGreaterThan(0)
	expect(window.live).toBe(true)
})

test('asking again from the offset returns only what arrived since', async () => {
	const { id } = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	await appendRunOutput(paths, id, said('first'))
	const first = await followRun(paths, id)

	await appendRunOutput(paths, id, said('second'))
	const second = await followRun(paths, id, { from: first.offset })

	// The point of the offset: an open screen re-sends nothing it has shown.
	expect(second.lines.map((line) => line.text)).toEqual(['second'])
})

test('a log that has not grown answers with nothing rather than repeating itself', async () => {
	const { id } = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	await appendRunOutput(paths, id, said('only'))
	const first = await followRun(paths, id)

	const again = await followRun(paths, id, { from: first.offset })

	expect(again.lines).toEqual([])
	expect(again.offset).toBe(first.offset)
})

test('a half-written line is left for the next read rather than parsed in pieces', async () => {
	const { id } = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	// The host writes JSON in chunks (`host.ts` splits on newlines across chunk
	// boundaries for the same reason). A reader that does not is what turns one
	// event into two `raw` lines of broken JSON in front of the user.
	const whole = said('torn')
	await appendRunOutput(paths, id, whole.slice(0, 20))

	const partial = await followRun(paths, id)
	expect(partial.lines).toEqual([])

	await appendRunOutput(paths, id, whole.slice(20))
	const rest = await followRun(paths, id, { from: partial.offset })

	expect(rest.lines.map((line) => line.text)).toEqual(['torn'])
})

test('the first window is bounded, so opening a long run does not send the whole file', async () => {
	const { id } = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	for (let index = 0; index < 50; index++) await appendRunOutput(paths, id, said(`line ${index}`))

	const window = await followRun(paths, id, { last: 10 })

	// The last ten, not the first ten: a person opening a running node wants
	// what it is saying now, not how it started.
	expect(window.lines).toHaveLength(10)
	expect(window.lines.at(-1)?.text).toBe('line 49')
	expect(window.lines.at(0)?.text).toBe('line 40')
})

test('a finished run is not live, so a screen watching it knows to stop asking', async () => {
	const { id } = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	await appendRunOutput(paths, id, said('done'))
	await finishRun(paths, id, { exit: 'finished' })

	const window = await followRun(paths, id)

	expect(window.live).toBe(false)
	// Still readable after the run ends (ADR 0037's reason, applied to the log).
	expect(window.lines.map((line) => line.text)).toEqual(['done'])
})

test('a run that has written nothing yet reads as empty, never as an error', async () => {
	const { id } = await startRun(paths, 'auth-api-k7f2', 'claude-code')

	const window = await followRun(paths, id)

	expect(window.lines).toEqual([])
	expect(window.offset).toBe(0)
})

// --- What `tail` renders. These predate `followRun` and are unchanged. ---

const log = (...events: unknown[]): string => events.map((e) => JSON.stringify(e)).join('\n')

test('an event type the tail does not know is dropped, not shown', () => {
	// The allowlist is the point: a host adds event types between releases, and
	// a denylist puts every new one in front of the user the day it ships.
	const rendered = tail(
		log(
			{ type: 'system', subtype: 'hook_started', hook: 'noise' },
			{ type: 'rate_limit_event', limit: 1 },
			{ type: 'system', subtype: 'init' },
		),
	)
	expect(rendered).toEqual([{ kind: 'started', text: 'session started' }])
})

test('an assistant turn renders its text, and a tool call renders the tool', () => {
	const rendered = tail(
		log(
			{ type: 'assistant', message: { content: [{ type: 'text', text: '  wrote the file  ' }] } },
			{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit' }] } },
		),
	)
	expect(rendered).toEqual([
		{ kind: 'text', text: 'wrote the file' },
		{ kind: 'tool', text: 'Edit' },
	])
})

test('a failing result says so, where the last line is what a reader looks at', () => {
	const rendered = tail(log({ type: 'result', subtype: 'error_during_execution', is_error: true }))
	expect(rendered.at(-1)).toEqual({ kind: 'result', text: 'failed: error_during_execution' })
})

test('a line that is not JSON is the host’s own stderr, and it is never hidden', () => {
	// The one thing a failing run always has, and the last thing to drop.
	expect(tail('claude: command not found\n')).toEqual([
		{ kind: 'raw', text: 'claude: command not found' },
	])
})

test('an empty log renders nothing rather than a blank line', () => {
	expect(tail('')).toEqual([])
	expect(tail('\n\n')).toEqual([])
})

// --- The other three hosts. Every Codex and OpenCode event below was recorded
// off a real invocation at implementation time (BUILD-PLAN §6), never written
// from memory: `codex exec --json` and `opencode run --format json`. Cursor's
// CLI is not installed here, so its events are the sequence its own reference
// publishes — `docs/testing/v1x-5-cursor.tdd.md` says what that does and does
// not prove. ---

test('a Codex run renders its start, its message, its command and its end', () => {
	const rendered = tail(
		log(
			{ type: 'thread.started', thread_id: '01a07d3d-0fee-7e70-ac4f-ea76f7f0bf68' },
			{ type: 'turn.started' },
			{ type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: '  ok  ' } },
			{
				type: 'item.completed',
				item: { id: 'item_3', type: 'command_execution', command: '/bin/zsh -lc ls', exit_code: 0 },
			},
			{ type: 'turn.completed', usage: { input_tokens: 22995, output_tokens: 5 } },
		),
	)
	expect(rendered).toEqual([
		{ kind: 'started', text: 'session started' },
		{ kind: 'text', text: 'ok' },
		{ kind: 'tool', text: '/bin/zsh -lc ls' },
		{ kind: 'result', text: 'finished' },
	])
})

test('a warning Codex prints about itself is shown, not swallowed', () => {
	// It arrives as an item rather than on stderr, and it is the sentence that
	// explains why a run behaved oddly — "Exceeded skills context budget" was
	// the first one this adapter ever saw.
	const rendered = tail(
		log({
			type: 'item.completed',
			item: { id: 'item_1', type: 'error', message: 'Exceeded skills context budget.' },
		}),
	)
	expect(rendered).toEqual([{ kind: 'raw', text: 'Exceeded skills context budget.' }])
})

test('an OpenCode run renders what it said and which tool it used', () => {
	const rendered = tail(
		log(
			{ type: 'step_start', part: { type: 'step-start' } },
			{ type: 'text', part: { type: 'text', text: "I'll run ls to list the files.\n" } },
			{ type: 'tool_use', part: { type: 'tool', tool: 'bash', state: { status: 'completed' } } },
			{ type: 'step_finish', part: { type: 'step-finish', reason: 'stop' } },
		),
	)
	expect(rendered).toEqual([
		{ kind: 'text', text: "I'll run ls to list the files." },
		{ kind: 'tool', text: 'bash' },
	])
})

test('a Cursor run renders its start, its tools, what it said and its end', () => {
	const session = 'c6b62c6f-7ead-4fd6-9922-e952131177ff'
	const rendered = tail(
		log(
			{ type: 'system', subtype: 'init', session_id: session, model: 'Claude 4 Sonnet' },
			// The prompt, echoed back. It is SOBER's own brief, so it is not a
			// line in the transcript — see hosts.test.ts.
			{
				type: 'user',
				session_id: session,
				message: { role: 'user', content: [{ type: 'text', text: 'build the node' }] },
			},
			{
				type: 'tool_call',
				subtype: 'started',
				call_id: 'toolu_0',
				tool_call: { readToolCall: { args: { path: 'README.md' } } },
				session_id: session,
			},
			{
				type: 'tool_call',
				subtype: 'completed',
				call_id: 'toolu_0',
				tool_call: { readToolCall: { args: { path: 'README.md' } } },
				session_id: session,
			},
			{
				type: 'assistant',
				session_id: session,
				message: { role: 'assistant', content: [{ type: 'text', text: 'Done!' }] },
			},
			{ type: 'result', subtype: 'success', is_error: false, session_id: session },
		),
	)
	expect(rendered).toEqual([
		{ kind: 'started', text: 'session started' },
		{ kind: 'tool', text: 'read README.md' },
		{ kind: 'text', text: 'Done!' },
		{ kind: 'result', text: 'finished' },
	])
})

test('one host’s events are never read as another’s', () => {
	// Every log carries its own shape, so a run started under one host still
	// reads after `dispatch.host` changes — and Claude Code's `type: "user"` is
	// not OpenCode's `type: "text"`.
	expect(tail(log({ type: 'text', part: { type: 'text', text: 'from opencode' } }))).toEqual([
		{ kind: 'text', text: 'from opencode' },
	])
	expect(
		tail(log({ type: 'assistant', message: { content: [{ type: 'text', text: 'from claude' }] } })),
	).toEqual([{ kind: 'text', text: 'from claude' }])
})
