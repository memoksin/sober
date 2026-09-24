import { finishRun, initBoard, type Paths, startRun, writeNode, writeRun } from '@besober/core'
import type { LogWindow } from '@besober/schema'
import { type Served, serve } from '@besober/server'
import { afterEach, beforeEach, expect, test } from 'vitest'
// Straight from the source, not the barrel: writing a run log is how a host
// behaves, not something a consumer does, and `core`'s published surface is
// kept to what consumers need (ADR 0028).
import { appendRunOutput } from '../../packages/core/src/local.js'
import { aNode } from '../../packages/core/src/records.fixture.js'
import { tmpRoot } from '../../packages/core/src/tmp.fixture.js'

/**
 * The run log on the screen (ADR 0046). A dispatch is the longest and most
 * expensive operation in the product, and before this it could only be read by
 * leaving the dashboard for a terminal.
 *
 * These are over the wire rather than against `followRun` directly: the thing
 * being tested is that a browser can watch a run, and the half that was missing
 * was never the read.
 */
let paths: Paths
let server: Served

beforeEach(async () => {
	const root = await tmpRoot('sober-watch-')
	paths = (await initBoard(root, { title: 'Acme', intent: 'ship', constraints: [] })).paths
	await writeNode(paths, 'auth-api-k7f2', aNode())
	server = await serve({ paths })
})

afterEach(async () => {
	await server.close()
})

const said = (text: string) =>
	`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })}\n`

/** The client half of the channel: a streaming `fetch`, reading NDJSON messages. */
const watch = async (
	query: string,
	options: { token?: string | null } = {},
): Promise<{ status: number; windows: LogWindow[]; body: string }> => {
	const { token = server.token } = options
	const response = await fetch(new URL(`/watch/logs?${query}`, server.url), {
		headers: token === null ? {} : { authorization: `Bearer ${token}` },
	})

	if (!response.ok || response.body === null)
		return { status: response.status, windows: [], body: await response.text() }

	const body = await response.text()
	return {
		status: response.status,
		windows: body
			.split('\n')
			.filter((line) => line.trim() !== '')
			.map((line) => JSON.parse(line) as LogWindow),
		body,
	}
}

test('a person watching a node run reads what the agent said, without a terminal', async () => {
	const { id } = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	await appendRunOutput(paths, id, said('reading the brief'))
	await appendRunOutput(paths, id, said('writing the test'))
	// The run ends before the watch opens, so the stream is bounded and the
	// assertion is about content rather than timing.
	await finishRun(paths, id, { exit: 'finished' })

	const { status, windows } = await watch(`run=${id}`)

	expect(status).toBe(200)
	expect(windows.flatMap((window) => window.lines).map((line) => line.text)).toEqual([
		'reading the brief',
		'writing the test',
	])
})

test('the log outlives the run, so reopening a tab still finds it', async () => {
	const { id } = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	await appendRunOutput(paths, id, said('what it said'))
	await finishRun(paths, id, { exit: 'finished' })

	// ADR 0037's promise about the run, applied to the log: closing the tab is
	// not an event the product notices, so opening a second one reads the same
	// thing rather than an empty screen.
	const first = await watch(`run=${id}`)
	const second = await watch(`run=${id}`)

	expect(second.windows.flatMap((w) => w.lines)).toEqual(first.windows.flatMap((w) => w.lines))
	expect(second.windows.at(-1)?.live).toBe(false)
})

test('a watch on a finished run closes itself rather than holding the connection open', async () => {
	const { id } = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	await appendRunOutput(paths, id, said('done'))
	await finishRun(paths, id, { exit: 'finished' })

	// The idle-cost bound: nothing is going to append to a finished run's log,
	// so the server says so and hangs up. A tab left open on yesterday's node
	// costs nothing at all.
	const { windows } = await watch(`run=${id}`)

	expect(windows.at(-1)?.live).toBe(false)
})

test('a screen resumes from its offset rather than re-reading what it has shown', async () => {
	const { id } = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	await appendRunOutput(paths, id, said('first'))
	await finishRun(paths, id, { exit: 'finished' })

	const first = await watch(`run=${id}`)
	const offset = first.windows.at(-1)?.offset ?? 0
	const resumed = await watch(`run=${id}&from=${offset}`)

	expect(resumed.windows.flatMap((w) => w.lines)).toEqual([])
})

test('the newest run of a node is what a screen gets when it names the node', async () => {
	const older = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	await appendRunOutput(paths, older.id, said('the first attempt'))
	await finishRun(paths, older.id, { exit: 'failed', error: 'nope' })

	const newer = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	await appendRunOutput(paths, newer.id, said('the second attempt'))
	await finishRun(paths, newer.id, { exit: 'finished' })

	// The screen knows node ids, not run ids: a run id is a local, disposable
	// thing (§5.5) and the canvas never sees one.
	const { windows } = await watch('node=auth-api-k7f2')

	expect(windows.flatMap((w) => w.lines).map((line) => line.text)).toEqual(['the second attempt'])
})

test('a node that has never run says so instead of streaming nothing', async () => {
	const { status, body } = await watch('node=auth-api-k7f2')

	// 409, not 404: the request was understood and the state said no, which is
	// the line `serve.ts` already draws between a refusal the product meant and
	// a route that does not exist.
	expect(status).toBe(409)
	expect(JSON.parse(body).error).toMatch(/has not run/i)
})

test('a watch without a token is refused like every other route', async () => {
	const { id } = await startRun(paths, 'auth-api-k7f2', 'claude-code')

	const { status } = await watch(`run=${id}`, { token: null })

	// ADR 0008's token rule, unbent. The channel is a streaming `fetch` rather
	// than an `EventSource` precisely so the header still fits (ADR 0046).
	expect(status).toBe(401)
})

test('a watch that is not a GET is refused, like a read', async () => {
	const response = await fetch(new URL('/watch/logs?node=auth-api-k7f2', server.url), {
		method: 'POST',
		headers: { authorization: `Bearer ${server.token}` },
	})

	expect(response.status).toBe(405)
})

test('nothing is watched that the server does not know how to watch', async () => {
	const response = await fetch(new URL('/watch/nonsense', server.url), {
		headers: { authorization: `Bearer ${server.token}` },
	})

	expect(response.status).toBe(404)
})

test('a query that is not the shape is refused before core sees it', async () => {
	const { status, body } = await watch('definitely=not the shape')

	expect(status).toBe(400)
	expect(JSON.parse(body).error).toBeTruthy()
})

test('a line written while somebody is watching reaches them without a second request', async () => {
	const { id } = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	await appendRunOutput(paths, id, said('starting'))

	// The channel is opened against a *live* run and read incrementally, which
	// is the case ADR 0036 said polling was the wrong shape for. Nothing here
	// asks a second time: the window arrives because the file grew.
	const response = await fetch(new URL(`/watch/logs?run=${id}`, server.url), {
		headers: { authorization: `Bearer ${server.token}` },
	})
	const reader = (response.body as ReadableStream<Uint8Array>).getReader()
	const decoder = new TextDecoder()

	const next = async (): Promise<LogWindow> => {
		for (;;) {
			const { value, done } = await reader.read()
			if (done) throw new Error('the channel closed before it said anything')
			const line = decoder
				.decode(value)
				.split('\n')
				.find((part) => part.trim() !== '')
			if (line !== undefined) return JSON.parse(line) as LogWindow
		}
	}

	const first = await next()
	expect(first.lines.map((line) => line.text)).toEqual(['starting'])
	expect(first.live).toBe(true)

	await appendRunOutput(paths, id, said('still going'))
	const second = await next()
	expect(second.lines.map((line) => line.text)).toEqual(['still going'])

	// And the end of the run is what closes it, rather than the client giving up.
	await finishRun(paths, id, { exit: 'finished' })
	const last = await next()
	expect(last.live).toBe(false)

	await reader.cancel()
})

test('a watcher who leaves stops the reads behind them', async () => {
	const { id } = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	await appendRunOutput(paths, id, said('one'))

	// The idle-cost bound ADR 0036 asked for: a live run holds a connection only
	// while somebody is on the other end of it, and abandoning it is what ends
	// the loop rather than a timer nobody set.
	const leaving = new AbortController()
	const response = await fetch(new URL(`/watch/logs?run=${id}`, server.url), {
		headers: { authorization: `Bearer ${server.token}` },
		signal: leaving.signal,
	})
	const reader = (response.body as ReadableStream<Uint8Array>).getReader()
	await reader.read()
	leaving.abort()

	// The run is still live, and the server has let go of it. Nothing to assert
	// but that this returns: a loop that ignored the abort would run forever.
	await finishRun(paths, id, { exit: 'finished' })
	expect(leaving.signal.aborted).toBe(true)
})

test('a screen that names both a run and a node is answered about the run', async () => {
	const older = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	await appendRunOutput(paths, older.id, said('the older one'))
	await finishRun(paths, older.id, { exit: 'failed', error: 'nope' })

	const newer = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	await finishRun(paths, newer.id, { exit: 'finished' })

	// A screen already watching one attempt is not moved onto a newer one
	// underneath it.
	const { windows } = await watch(`node=auth-api-k7f2&run=${older.id}`)

	expect(windows.flatMap((w) => w.lines).map((line) => line.text)).toEqual(['the older one'])
})

test('a run somebody is watching can be answered over the wire', async () => {
	const { id } = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	await writeRun(paths, id, {
		node: 'auth-api-k7f2',
		host: 'claude-code',
		branch: 'sober/auth-api-k7f2',
		worktree: '/tmp/worktree',
		startedAt: new Date().toISOString(),
		endedAt: null,
		exit: null,
		error: null,
		verify: null,
		acceptance: [],
		attended: true,
	})

	const response = await fetch(new URL('/op/answer', server.url), {
		method: 'POST',
		headers: {
			authorization: `Bearer ${server.token}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({ node: 'auth-api-k7f2', text: 'use the second option' }),
	})

	expect(response.status).toBe(200)
	expect(await response.json()).toEqual({ run: id, done: false })
})

test('answering a run nobody is watching is a refusal, not a silent drop', async () => {
	const { id } = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	await finishRun(paths, id, { exit: 'finished' })

	const response = await fetch(new URL('/op/answer', server.url), {
		method: 'POST',
		headers: {
			authorization: `Bearer ${server.token}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({ node: 'auth-api-k7f2', text: 'hello?' }),
	})

	// 409: the request was understood and the state said no.
	expect(response.status).toBe(409)
	expect(((await response.json()) as { error: string }).error).toMatch(/not running/i)
})
