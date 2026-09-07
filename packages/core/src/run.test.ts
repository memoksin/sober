import { beforeEach, expect, test } from 'vitest'
import { initBoard } from './board.js'
import { NotOnBoardError } from './errors.js'
import { loadBoard } from './graph.js'
import { readLog, readRun } from './local.js'
import type { Paths } from './paths.js'
import { aNode } from './records.fixture.js'
import { writeNode } from './records.js'
import { acceptNode, finishRun, recordOutcome, startRun } from './run.js'
import { statusOf } from './status.js'
import { tmpRoot } from './tmp.fixture.js'

let paths: Paths

beforeEach(async () => {
	const root = await tmpRoot('sober-run-')
	paths = (await initBoard(root, { title: 'Acme', intent: 'ship', constraints: [] })).paths
	await writeNode(paths, 'auth-api-k7f2', aNode())
})

test('a run is started, finished, and both ends are in the audit log', async () => {
	const started = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	expect(statusOf(await loadBoard(paths), 'auth-api-k7f2')).toBe('running')

	const finished = await finishRun(paths, started.id, {
		exit: 'finished',
		verify: { exit: 0 },
		acceptance: [{ exit: 0 }, null],
	})

	expect(finished.endedAt).not.toBe(null)
	expect(finished.acceptance).toEqual([{ exit: 0 }, null])
	expect(statusOf(await loadBoard(paths), 'auth-api-k7f2')).toBe('in-review')
	expect((await readLog(paths)).events.map((event) => event.action)).toEqual([
		'run.started',
		'run.finished',
	])
})

test('a failed run records its error and returns the node to ready', async () => {
	const started = await startRun(paths, 'auth-api-k7f2', 'claude-code')

	await finishRun(paths, started.id, { exit: 'failed', error: 'the host was not authenticated' })

	const run = await readRun(paths, started.id)
	expect(run).toMatchObject({ value: { exit: 'failed', error: 'the host was not authenticated' } })
	expect(statusOf(await loadBoard(paths), 'auth-api-k7f2')).toBe('needs-brief')
})

test('a run against a node the board does not hold is refused', async () => {
	await expect(startRun(paths, 'gone-node-x9y8', 'claude-code')).rejects.toBeInstanceOf(
		NotOnBoardError,
	)
})

test('the outcome is board state, and accepting is what makes a node done', async () => {
	await recordOutcome(paths, 'auth-api-k7f2', 'Added the session endpoints and the middleware.')
	await acceptNode(paths, 'auth-api-k7f2', {
		by: 'memoksin',
		at: '2026-09-04T00:00:00.000Z',
		flagged: false,
		scan: 'clean',
		audit: 'passed',
	})

	const board = await loadBoard(paths)
	expect(board.nodes.get('auth-api-k7f2')?.outcome).toContain('session endpoints')
	expect(statusOf(board, 'auth-api-k7f2')).toBe('done')
	expect((await readLog(paths)).events.at(-1)?.action).toBe('node.accepted')
})
