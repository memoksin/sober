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
