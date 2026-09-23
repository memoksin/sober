import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { initBoard } from './board.js'
import { applySetting, type Config, DEFAULT_CONFIG } from './config.js'
import { dispatch, stopRun } from './dispatch.js'
import { loadBoard } from './graph.js'
import { readLog, readRun, writeRunPid } from './local.js'
import type { Paths } from './paths.js'
import { aNode } from './records.fixture.js'
import { writeNode } from './records.js'
import { startRun } from './run.js'
import { statusOf } from './status.js'
import { tmpRoot } from './tmp.fixture.js'

// The base-ref config read (ADR 0019) needs a real git ref, which a tmp
// board does not have. Every other dispatch test relies on `showFromRef`
// failing closed to `DEFAULT_CONFIG`; the two below need to control
// `dispatch.models`/`dispatch.sources`, so they replace the reader instead.
vi.mock('./config.js', async (original) => ({
	...(await original<typeof import('./config.js')>()),
	readConfigFromBase: vi.fn(),
}))
vi.mock('./host.js', async (original) => ({
	...(await original<typeof import('./host.js')>()),
	checkHost: vi.fn(async () => ({ ok: true, reason: null })),
	startAgent: vi.fn(async ({ onStart }: { onStart: (pid: number) => void }) => {
		onStart(1)
		return { kind: 'finished' }
	}),
}))
vi.mock('./worktree.js', async (original) => ({
	...(await original<typeof import('./worktree.js')>()),
	addWorktree: vi.fn(async () => ({
		path: '/tmp/sober-dispatch-test',
		branch: 'x',
		created: false,
	})),
}))
vi.mock('./audit.js', async (original) => ({
	...(await original<typeof import('./audit.js')>()),
	runAudit: vi.fn(async () => ({ verify: null, acceptance: [] })),
}))
vi.mock('./models.js', async (original) => ({
	...(await original<typeof import('./models.js')>()),
	liveModels: vi.fn(),
}))
vi.mock('./jev.js', async (original) => ({
	...(await original<typeof import('./jev.js')>()),
	askJev: vi.fn(),
}))

let paths: Paths

beforeEach(async () => {
	const root = await tmpRoot('sober-dispatch-')
	paths = (await initBoard(root, { title: 'Acme', intent: 'ship', constraints: [] })).paths
	await writeNode(paths, 'auth-api-k7f2', aNode())
})

test('stopping a run whose owning process is gone closes it as failed', async () => {
	const started = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	// A pid that just exited, so it cannot collide with a live process.
	const child = spawn(process.execPath, ['-e', ''])
	await once(child, 'exit')
	await writeRunPid(paths, started.id, child.pid as number)

	expect(await stopRun(paths, started.id)).toBe(false)

	const run = await readRun(paths, started.id)
	expect(run).toMatchObject({ value: { exit: 'failed', error: expect.stringMatching(/gone/) } })
	expect(statusOf(await loadBoard(paths), 'auth-api-k7f2')).not.toBe('running')
	await expect(startRun(paths, 'auth-api-k7f2', 'claude-code')).resolves.toBeDefined()
})

afterEach(() => vi.resetAllMocks())

test('dispatch logs one models event naming what liveModels built and dropped', async () => {
	const { readConfigFromBase } = await import('./config.js')
	const { liveModels } = await import('./models.js')
	const config: Config = {
		...DEFAULT_CONFIG,
		dispatch: { ...DEFAULT_CONFIG.dispatch, draftPr: false },
	}
	vi.mocked(readConfigFromBase).mockResolvedValue({ kind: 'ok', value: config })
	vi.mocked(liveModels).mockResolvedValue({
		models: [{ name: 'free', run: 'codex --model x', complexity: [1, 10], about: '' }],
		dropped: ['stale: pinned but retired from codex'],
	})
	await applySetting(paths, ['dispatch', 'draftPr'], false)

	await dispatch(paths, 'auth-api-k7f2', { base: 'main' })

	const { events } = await readLog(paths)
	expect(events).toContainEqual(
		expect.objectContaining({
			action: 'models',
			node: 'auth-api-k7f2',
			count: 1,
			dropped: ['stale: pinned but retired from codex'],
		}),
	)
})

test('with jevMode on, Jev is asked among the list liveModels built, and its pick chooses the host line', async () => {
	const { readConfigFromBase } = await import('./config.js')
	const { liveModels } = await import('./models.js')
	const { askJev } = await import('./jev.js')
	const { startAgent } = await import('./host.js')
	const built = [
		{
			name: 'free',
			run: 'codex --model built-only',
			complexity: [1, 10] as [number, number],
			about: '',
		},
	]
	const config: Config = {
		...DEFAULT_CONFIG,
		dispatch: { ...DEFAULT_CONFIG.dispatch, draftPr: false, jevMode: true, models: [] },
	}
	vi.mocked(readConfigFromBase).mockResolvedValue({ kind: 'ok', value: config })
	vi.mocked(liveModels).mockResolvedValue({ models: built, dropped: [] })
	vi.mocked(askJev).mockResolvedValue({ complexity: 5, skills: [], model: 'free' })

	await dispatch(paths, 'auth-api-k7f2', { base: 'main' })

	expect(vi.mocked(askJev)).toHaveBeenCalledWith(expect.any(String), { skills: [], models: built })
	expect(vi.mocked(startAgent)).toHaveBeenCalledWith(
		expect.objectContaining({ host: 'codex --model built-only' }),
	)
})
