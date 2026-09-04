import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test } from 'vitest'
import { acquire, LockBusyError, withLock } from './lock.js'
import { paths } from './paths.js'

const WINDOWS = { staleSeconds: 60, waitSeconds: 1 }

let board: ReturnType<typeof paths>

beforeEach(async () => {
	board = paths(await mkdtemp(join(tmpdir(), 'sober-lock-')))
	await mkdir(board.local, { recursive: true })
})

test('a second writer fails within the wait window, naming who holds the lock', async () => {
	const held = await acquire(board, 'accept', WINDOWS)

	await expect(acquire(board, 'run', WINDOWS)).rejects.toThrow(LockBusyError)
	await expect(acquire(board, 'run', WINDOWS)).rejects.toThrow(/accept/)

	await held.release()
	await expect(acquire(board, 'run', WINDOWS)).resolves.toBeTruthy()
})

test('a lock past its stale window is taken over, and the takeover is reported', async () => {
	await writeFile(
		board.lock,
		JSON.stringify({
			token: 'crashed',
			pid: 1,
			host: 'other-machine',
			action: 'run',
			heartbeat: Date.now() - 120_000,
		}),
	)

	const held = await acquire(board, 'accept', WINDOWS)

	expect(held.tookOver).toEqual({ action: 'run', host: 'other-machine' })
})

test('releasing does not delete a lock that was taken over from us', async () => {
	const held = await acquire(board, 'accept', WINDOWS)
	await writeFile(
		board.lock,
		JSON.stringify({
			token: 'someone-else',
			pid: 2,
			host: 'h',
			action: 'run',
			heartbeat: Date.now(),
		}),
	)

	await held.release()

	expect(JSON.parse(await readFile(board.lock, 'utf8')).token).toBe('someone-else')
})

test('withLock releases when the action throws', async () => {
	await expect(
		withLock(
			board,
			'accept',
			async () => {
				throw new Error('the write failed')
			},
			WINDOWS,
		),
	).rejects.toThrow('the write failed')

	await expect(acquire(board, 'run', WINDOWS)).resolves.toBeTruthy()
})
