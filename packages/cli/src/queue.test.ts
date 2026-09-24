import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	acquire,
	type Board,
	type Config,
	loadBoard,
	type Paths,
	plan,
	runQueue,
} from '@besober/core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { dispatcher, drain, queue } from './queue.js'

vi.mock('@besober/core', async (original) => ({
	...(await original<typeof import('@besober/core')>()),
	runQueue: vi.fn(),
	loadBoard: vi.fn(),
	whoami: vi.fn(async () => 'me'),
}))

const config = {
	dispatch: { pollSeconds: 5 },
	lock: { staleSeconds: 60, waitSeconds: 1 },
} as unknown as Config

let dir: string
let paths: Paths
let out: string[]

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'sober-dispatch-'))
	paths = { lock: join(dir, 'lock'), root: dir } as Paths
	out = []
	vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
		out.push(String(chunk))
		return true
	})
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.mocked(runQueue).mockReset()
	rmSync(dir, { recursive: true, force: true })
})

const idle = { started: [], dispatched: [], held: [] }

test('a node that became ready between two ticks is started by the second', async () => {
	vi.mocked(runQueue)
		.mockResolvedValueOnce(idle)
		.mockResolvedValueOnce({
			started: ['a-node'],
			dispatched: [{ exit: 'finished' } as never],
			held: [],
		})
		.mockResolvedValueOnce({
			started: ['b-node'],
			dispatched: [{ exit: 'failed', error: null } as never],
			held: [],
		})
	const waits: number[] = []

	const code = await dispatcher(paths, 'main', {
		config,
		wait: async (ms) => {
			waits.push(ms)
		},
	})

	expect(runQueue).toHaveBeenCalledTimes(3)
	expect(waits).toEqual([5000, 5000])
	expect(out.join('')).toContain('a-node finished')
	expect(code).toBe(1)
})

test('a failed dispatch ends the loop non-zero instead of carrying on next tick', async () => {
	const tick = vi.fn().mockResolvedValue({ failed: true })
	const wait = vi.fn()

	const code = await dispatcher(paths, 'main', { config, wait, tick })

	expect(code).toBe(1)
	expect(tick).toHaveBeenCalledTimes(1)
	expect(wait).not.toHaveBeenCalled()
	expect(out.join('')).toContain('a human has to look')
})

test('a second dispatcher refuses while the first holds the lock, and names it', async () => {
	const first = await acquire({ ...paths, lock: `${paths.lock}-dispatch` }, 'dispatch', config.lock)
	const tick = vi.fn()
	try {
		const code = await dispatcher(paths, 'main', { config, tick })
		expect(code).toBe(1)
		expect(tick).not.toHaveBeenCalled()
		expect(out.join('')).toMatch(/already draining this board: dispatch on /)
	} finally {
		await first.release()
	}
})

const AT = '2026-09-04T00:00:00.000Z'

const node = (claim: string | null) =>
	({
		dependsOn: [],
		decisions: [],
		files: [],
		accepted: null,
		claim: claim === null ? null : { by: claim, at: AT },
		brief: {
			approach: '',
			complexity: null,
			acceptance: [],
			approval: { by: 'me', at: AT, queue: true },
		},
	}) as never

const aBoard = (claim: string | null, run: object | null): Board =>
	({
		project: null,
		nodes: new Map([['a-node', node(claim)]]),
		decisions: new Map(),
		archivedDecisions: new Set(),
		runs: new Map(run === null ? [] : [['run-1', { node: 'a-node', startedAt: AT, ...run }]]),
		feedback: new Map(),
		broken: [],
	}) as never

const lineOf = (text: string) => text.split('\n').find((line) => line.includes('a-node'))

test('a held node reads the same in the queue as in the drain', async () => {
	const board = aBoard('someone-else', null)
	vi.mocked(loadBoard).mockResolvedValue(board)
	vi.mocked(runQueue).mockResolvedValue({
		started: [],
		dispatched: [],
		held: plan(board, 'me').held,
	})

	await drain(paths, 'main')
	const drained = lineOf(out.join(''))
	out.length = 0
	await queue(paths, { config })

	expect(drained).toContain('someone-else has claimed it')
	expect(lineOf(out.join(''))).toEqual(drained)
})

test('the watch shows held, running and finished across three cycles without restarting', async () => {
	vi.mocked(loadBoard)
		.mockResolvedValueOnce(aBoard('someone-else', null))
		.mockResolvedValueOnce(aBoard(null, { endedAt: null, exit: null }))
		.mockResolvedValueOnce(aBoard(null, { endedAt: AT, exit: 'finished' }))
	const lines: (string | undefined)[] = []
	let cycles = 0
	const wait = async () => {
		lines.push(lineOf(out.join('')))
		out.length = 0
		if (++cycles === 3) throw new Error('closed')
	}

	await expect(queue(paths, { config, watch: true, wait })).rejects.toThrow('closed')

	expect(lines[0]).toContain('claimed it')
	expect(lines[1]).toContain('running')
	expect(lines[2]).toContain('finished')
	expect(new Set(lines).size).toBe(3)
})

test('the header says nothing is draining when the lock is free, and names the holder when it is held', async () => {
	vi.mocked(loadBoard).mockResolvedValue(aBoard(null, null))
	await queue(paths, { config })
	expect(out.join('')).toContain('nothing is draining')

	const first = await acquire({ ...paths, lock: `${paths.lock}-dispatch` }, 'dispatch', config.lock)
	out.length = 0
	try {
		await queue(paths, { config })
		expect(out.join('')).toMatch(/a dispatcher is draining this board: dispatch on /)
	} finally {
		await first.release()
	}
})
