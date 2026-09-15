import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquire, type Config, type Paths, runQueue } from '@besober/core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { dispatcher } from './queue.js'

vi.mock('@besober/core', async (original) => ({
	...(await original<typeof import('@besober/core')>()),
	runQueue: vi.fn(),
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
	paths = { lock: join(dir, 'lock') } as Paths
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
