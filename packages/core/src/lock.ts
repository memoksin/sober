import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { Config } from './config.js'
import { DEFAULT_CONFIG } from './config.js'
import type { Paths } from './paths.js'

/**
 * One lock per project, held for the length of a write (ADR 0025). It exists for
 * lost updates between the CLI, the MCP server and — from M3 — the dashboard
 * server, all writing `.sober/` on one machine. Reads never take it: a reader
 * that hits a half-written file falls to the broken-record path (DESIGN §8.4).
 */
const Holder = z.strictObject({
	token: z.string().min(1),
	pid: z.int(),
	host: z.string(),
	action: z.string(),
	heartbeat: z.number(),
})

type Holder = z.infer<typeof Holder>

const POLL_MS = 100

export interface Held {
	/** Set when a lock past its stale window was broken. A takeover is never silent. */
	readonly tookOver: { readonly action: string; readonly host: string } | null
	readonly release: () => Promise<void>
}

export class LockBusyError extends Error {
	constructor(
		readonly action: string,
		readonly host: string,
	) {
		super(`another SOBER action is writing this board: ${action} on ${host}`)
		this.name = 'LockBusyError'
	}
}

const readHolder = async (file: string): Promise<Holder | null> => {
	try {
		const parsed = Holder.safeParse(JSON.parse(await readFile(file, 'utf8')))
		return parsed.success ? parsed.data : null
	} catch {
		// Missing, torn or unparseable: there is nothing to wait for.
		return null
	}
}

const write = (file: string, holder: Holder, flag: 'wx' | 'w'): Promise<void> =>
	open(file, flag).then(async (handle) => {
		try {
			await handle.writeFile(JSON.stringify(holder), 'utf8')
			await handle.sync()
		} finally {
			await handle.close()
		}
	})

/**
 * Acquires the project lock, or fails within the wait window naming who holds it.
 * It never blocks forever, and it never proceeds without the lock.
 */
export const acquire = async (
	paths: Paths,
	action: string,
	windows: Config['lock'] = DEFAULT_CONFIG.lock,
): Promise<Held> => {
	await mkdir(dirname(paths.lock), { recursive: true })
	const holder: Holder = {
		token: `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		pid: process.pid,
		host: hostname(),
		action,
		heartbeat: Date.now(),
	}
	const deadline = Date.now() + windows.waitSeconds * 1000
	let tookOver: Held['tookOver'] = null

	for (;;) {
		try {
			await write(paths.lock, { ...holder, heartbeat: Date.now() }, 'wx')
			break
		} catch (error) {
			if ((error as { code?: string }).code !== 'EEXIST') throw error
		}

		const current = await readHolder(paths.lock)
		const stale = current === null || Date.now() - current.heartbeat > windows.staleSeconds * 1000
		if (stale) {
			// Staleness is the heartbeat, never a signal to a pid: pid liveness is
			// not portable and a recycled pid is a false positive everywhere.
			if (current !== null) tookOver = { action: current.action, host: current.host }
			await unlink(paths.lock).catch(() => {})
			continue
		}
		if (Date.now() >= deadline) throw new LockBusyError(current.action, current.host)
		await new Promise((resolve) => setTimeout(resolve, POLL_MS))
	}

	const beat = setInterval(
		() => {
			void write(paths.lock, { ...holder, heartbeat: Date.now() }, 'w').catch(() => {})
		},
		Math.max((windows.staleSeconds * 1000) / 3, POLL_MS),
	)
	beat.unref()

	return {
		tookOver,
		release: async () => {
			clearInterval(beat)
			// Only if it is still ours: a lock broken as stale now belongs to someone else.
			const current = await readHolder(paths.lock)
			if (current?.token === holder.token) await unlink(paths.lock).catch(() => {})
		},
	}
}

/** The lock covers a whole action, so a multi-file write is all-or-nothing against other writers. */
export const withLock = async <T>(
	paths: Paths,
	action: string,
	run: (held: Held) => Promise<T>,
	windows?: Config['lock'],
): Promise<T> => {
	const held = await acquire(paths, action, windows)
	try {
		return await run(held)
	} finally {
		await held.release()
	}
}
