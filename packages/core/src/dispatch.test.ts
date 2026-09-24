import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { initBoard } from './board.js'
import { applySetting, type Config, DEFAULT_CONFIG } from './config.js'
import { dispatch, stopRun } from './dispatch.js'
import { NotOnBoardError } from './errors.js'
import { loadBoard } from './graph.js'
import { HostError } from './host.js'
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
	// Never spawn a real host CLI from a unit test: every host here answers
	// ready unless a test overrides it.
	hostAvailability: vi.fn(async () => ({})),
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

test('closing instructions keep the foreground rule before the commit instruction', async () => {
	const { readConfigFromBase } = await import('./config.js')
	const { liveModels } = await import('./models.js')
	const config: Config = {
		...DEFAULT_CONFIG,
		dispatch: { ...DEFAULT_CONFIG.dispatch, draftPr: false },
	}
	vi.mocked(readConfigFromBase).mockResolvedValue({ kind: 'ok', value: config })
	vi.mocked(liveModels).mockResolvedValue({ models: [], dropped: [] })

	await dispatch(paths, 'auth-api-k7f2', { base: 'main' })

	const { startAgent } = await import('./host.js')
	// `startAgent` is the fake host; inspect the prompt in its recorded call
	// input rather than exporting the private closing-instructions constant.
	const prompt = vi.mocked(startAgent).mock.calls[0]?.[0]?.prompt
	expect(prompt).toContain('Run every command in the foreground')
	expect(prompt).toContain('Commit your work on this branch')
	expect(prompt?.indexOf('Commit your work on this branch')).toBeGreaterThan(
		prompt?.indexOf('Run every command in the foreground') ?? -1,
	)
})

test('dispatching a node that is not on the board is refused before any host is touched', async () => {
	const { readConfigFromBase } = await import('./config.js')
	vi.mocked(readConfigFromBase).mockResolvedValue({ kind: 'ok', value: DEFAULT_CONFIG })

	await expect(dispatch(paths, 'no-such-node-zzzz', { base: 'main' })).rejects.toBeInstanceOf(
		NotOnBoardError,
	)
})

test('dispatch refuses when config.jsonc on the base cannot be read', async () => {
	const { readConfigFromBase } = await import('./config.js')
	vi.mocked(readConfigFromBase).mockResolvedValue({
		kind: 'broken',
		file: 'main:.sober/config.jsonc',
		reason: 'not valid JSONC',
	})

	await expect(dispatch(paths, 'auth-api-k7f2', { base: 'main' })).rejects.toThrow(
		'config.jsonc on main cannot be read: not valid JSONC',
	)
})

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
	vi.mocked(askJev).mockResolvedValue({ complexity: 5, skills: [], model: 'free', backup: null })

	await dispatch(paths, 'auth-api-k7f2', { base: 'main' })

	expect(vi.mocked(askJev)).toHaveBeenCalledWith(expect.any(String), { skills: [], models: built })
	expect(vi.mocked(startAgent)).toHaveBeenCalledWith(
		expect.objectContaining({ host: 'codex --model built-only' }),
	)
})

test('a spent host’s models never reach Jev, and the log names it', async () => {
	const { readConfigFromBase } = await import('./config.js')
	const { liveModels } = await import('./models.js')
	const { askJev } = await import('./jev.js')
	const { hostAvailability } = await import('./host.js')
	const built = [
		{ name: 'out', run: 'claude --model opus', complexity: [1, 10] as [number, number], about: '' },
		{ name: 'in', run: 'codex --model x', complexity: [1, 10] as [number, number], about: '' },
	]
	const config: Config = {
		...DEFAULT_CONFIG,
		dispatch: { ...DEFAULT_CONFIG.dispatch, draftPr: false, jevMode: true, models: [] },
	}
	vi.mocked(readConfigFromBase).mockResolvedValue({ kind: 'ok', value: config })
	vi.mocked(liveModels).mockResolvedValue({ models: built, dropped: [] })
	vi.mocked(hostAvailability).mockResolvedValue({
		claude: { state: 'spent', reason: 'five-hour limit, resets 14:59' },
	})
	vi.mocked(askJev).mockResolvedValue({ complexity: 5, skills: [], model: 'in', backup: null })

	await dispatch(paths, 'auth-api-k7f2', { base: 'main' })

	expect(vi.mocked(askJev)).toHaveBeenCalledWith(expect.any(String), {
		skills: [],
		models: [built[1]],
	})
	const { events } = await readLog(paths)
	expect(events).toContainEqual(
		expect.objectContaining({
			action: 'hosts',
			node: 'auth-api-k7f2',
			removed: [{ host: 'claude', reason: 'five-hour limit, resets 14:59' }],
			unknown: [],
		}),
	)
})

test('when every host is spent, dispatch refuses before the worktree, naming every reason', async () => {
	const { readConfigFromBase } = await import('./config.js')
	const { liveModels } = await import('./models.js')
	const { hostAvailability } = await import('./host.js')
	const { addWorktree } = await import('./worktree.js')
	const built = [
		{ name: 'a', run: 'claude --model opus', complexity: [1, 10] as [number, number], about: '' },
		{ name: 'b', run: 'codex --model x', complexity: [1, 10] as [number, number], about: '' },
	]
	const config: Config = {
		...DEFAULT_CONFIG,
		dispatch: { ...DEFAULT_CONFIG.dispatch, draftPr: false, models: [] },
	}
	vi.mocked(readConfigFromBase).mockResolvedValue({ kind: 'ok', value: config })
	vi.mocked(liveModels).mockResolvedValue({ models: built, dropped: [] })
	vi.mocked(hostAvailability).mockResolvedValue({
		claude: { state: 'spent', reason: 'five-hour limit, resets 14:59' },
		codex: { state: 'spent', reason: 'usage limit, try again at 2:59 PM' },
	})

	await expect(dispatch(paths, 'auth-api-k7f2', { base: 'main' })).rejects.toThrow(
		/every host is out — claude: five-hour limit, resets 14:59; codex: usage limit, try again at 2:59 PM/,
	)
	expect(vi.mocked(addWorktree)).not.toHaveBeenCalled()
})

test('a host whose state cannot be read is kept — the fallback catches what the probe missed', async () => {
	const { readConfigFromBase } = await import('./config.js')
	const { liveModels } = await import('./models.js')
	const { hostAvailability } = await import('./host.js')
	const { startAgent } = await import('./host.js')
	const built = [
		{ name: 'a', run: 'claude --model opus', complexity: [1, 10] as [number, number], about: '' },
	]
	const config: Config = {
		...DEFAULT_CONFIG,
		dispatch: { ...DEFAULT_CONFIG.dispatch, draftPr: false, models: [] },
	}
	vi.mocked(readConfigFromBase).mockResolvedValue({ kind: 'ok', value: config })
	vi.mocked(liveModels).mockResolvedValue({ models: built, dropped: [] })
	vi.mocked(hostAvailability).mockResolvedValue({ claude: { state: 'unknown', reason: null } })

	await dispatch(paths, 'auth-api-k7f2', { base: 'main' })

	expect(vi.mocked(startAgent)).toHaveBeenCalled()
	const { events } = await readLog(paths)
	expect(events).toContainEqual(
		expect.objectContaining({
			action: 'hosts',
			node: 'auth-api-k7f2',
			removed: [],
			unknown: ['claude'],
		}),
	)
})

// Codex's own words for a spent account, as `hosts.ts` captured them.
const CODEX_SPENT =
	'{"type":"error","message":"You\'ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 2:59 PM."}'
const CODEX_TOOL = JSON.stringify({
	type: 'item.completed',
	item: { type: 'command_execution', command: 'ls', status: 'completed' },
})

const withBackup = async (
	models = [
		{ name: 'gpt', run: 'codex --model gpt', complexity: [1, 10] as [number, number], about: '' },
		{
			name: 'opus',
			run: 'claude --model opus',
			complexity: [1, 10] as [number, number],
			about: '',
		},
	],
) => {
	const { readConfigFromBase } = await import('./config.js')
	const { liveModels } = await import('./models.js')
	// The node is unscored, so `dispatch.host` — the first model — is the primary.
	const config: Config = {
		...DEFAULT_CONFIG,
		dispatch: {
			...DEFAULT_CONFIG.dispatch,
			draftPr: false,
			models: [],
			host: models[0]?.run ?? 'codex --model gpt',
		},
	}
	vi.mocked(readConfigFromBase).mockResolvedValue({ kind: 'ok', value: config })
	vi.mocked(liveModels).mockResolvedValue({ models, dropped: [] })
	const { hostAvailability, checkHost, startAgent } = await import('./host.js')
	vi.mocked(hostAvailability).mockResolvedValue({})
	return { checkHost: vi.mocked(checkHost), startAgent: vi.mocked(startAgent) }
}

const onlyRun = async () => {
	const runs = (await readLog(paths)).events.filter((e) => e.action === 'run.started')
	const run = await readRun(paths, String(runs[0]?.run))
	if (run.kind !== 'ok') throw new Error('no run record')
	return run.value
}

test('a primary whose checkHost refuses runs on the backup, and the record says so', async () => {
	const { checkHost, startAgent } = await withBackup()
	checkHost.mockImplementation(async (line) =>
		line.startsWith('codex')
			? { ok: false, reason: 'codex is installed but not logged in' }
			: { ok: true, reason: null },
	)
	startAgent.mockImplementation(async ({ onStart }) => {
		onStart?.(1)
		return { kind: 'finished' }
	})

	await dispatch(paths, 'auth-api-k7f2', { base: 'main' })

	expect(startAgent).toHaveBeenCalledTimes(1)
	expect(startAgent).toHaveBeenCalledWith(expect.objectContaining({ host: 'claude --model opus' }))
	expect(await onlyRun()).toMatchObject({
		host: 'claude --model opus',
		backup: 'claude --model opus',
		ran: 'backup',
		fellBack: 'codex is installed but not logged in',
	})
})

test('a limit-classified exit before any tool line re-runs once on the backup, in the same worktree', async () => {
	const { checkHost, startAgent } = await withBackup()
	checkHost.mockResolvedValue({ ok: true, reason: null })
	startAgent
		.mockImplementationOnce(async ({ onStart, onLine }) => {
			onStart?.(1)
			onLine(CODEX_SPENT)
			return { kind: 'failed', reason: 'codex --model gpt exited with code 1' }
		})
		.mockImplementationOnce(async ({ onStart }) => {
			onStart?.(2)
			return { kind: 'finished' }
		})

	const done = await dispatch(paths, 'auth-api-k7f2', { base: 'main' })

	expect(done.exit).toBe('finished')
	expect(startAgent).toHaveBeenCalledTimes(2)
	const [first, second] = startAgent.mock.calls.map(([options]) => options)
	expect(first).toMatchObject({ host: 'codex --model gpt' })
	expect(second).toMatchObject({ host: 'claude --model opus', cwd: first?.cwd })
	expect(await onlyRun()).toMatchObject({
		host: 'claude --model opus',
		backup: 'claude --model opus',
		ran: 'backup',
		fellBack: 'usage limit, try again at 2:59 PM',
		exit: 'finished',
	})
	const { readRunOutput } = await import('./local.js')
	expect(await readRunOutput(paths, done.run)).toContain(
		'primary codex --model gpt stopped: usage limit, try again at 2:59 PM — running on claude --model opus',
	)
})

test('the same exit after a tool line is not re-run', async () => {
	const { checkHost, startAgent } = await withBackup()
	checkHost.mockResolvedValue({ ok: true, reason: null })
	startAgent.mockImplementationOnce(async ({ onStart, onLine }) => {
		onStart?.(1)
		onLine(CODEX_TOOL)
		onLine(CODEX_SPENT)
		return { kind: 'failed', reason: 'codex --model gpt exited with code 1' }
	})

	const done = await dispatch(paths, 'auth-api-k7f2', { base: 'main' })

	expect(done.exit).toBe('failed')
	expect(startAgent).toHaveBeenCalledTimes(1)
	expect(await onlyRun()).toMatchObject({
		host: 'codex --model gpt',
		backup: 'claude --model opus',
		ran: 'primary',
		fellBack: null,
	})
})

test('with no backup, a refused primary is today’s refusal, word for word', async () => {
	const { checkHost } = await withBackup([
		{ name: 'gpt', run: 'codex --model gpt', complexity: [1, 10], about: '' },
	])
	checkHost.mockResolvedValue({ ok: false, reason: 'codex is installed but not logged in' })
	const { addWorktree } = await import('./worktree.js')

	await expect(dispatch(paths, 'auth-api-k7f2', { base: 'main' })).rejects.toThrow(
		'auth-api-k7f2 was not started: codex is installed but not logged in — or change `dispatch.host`',
	)
	expect(vi.mocked(addWorktree)).not.toHaveBeenCalled()
})

const OPUS = {
	name: 'opus',
	run: 'claude --model opus',
	complexity: [1, 10] as [number, number],
	about: '',
}
// Built from the captured `allowed` event, as in `hosts.test.ts`.
const CLAUDE_SPENT = JSON.stringify({
	type: 'rate_limit_event',
	rate_limit_info: {
		status: 'rejected',
		resetsAt: 1_789_471_200,
		rateLimitType: 'five_hour',
		unifiedWindows: { five_hour: { utilization: 0.07 } },
	},
})

test('an attended run whose primary hits its limit before a tool line is not re-run on a backup that cannot hear the human', async () => {
	const { checkHost, startAgent } = await withBackup([
		OPUS,
		{ name: 'gpt', run: 'codex --model gpt', complexity: [1, 10], about: '' },
	])
	checkHost.mockResolvedValue({ ok: true, reason: null })
	startAgent.mockImplementationOnce(async ({ onStart, onLine }) => {
		onStart?.(1)
		onLine(CLAUDE_SPENT)
		return { kind: 'failed', reason: 'claude --model opus exited with code 1' }
	})

	const done = await dispatch(paths, 'auth-api-k7f2', { base: 'main', attended: true })

	expect(done.exit).toBe('failed')
	expect(startAgent).toHaveBeenCalledTimes(1)
	expect(await onlyRun()).toMatchObject({
		host: 'claude --model opus',
		backup: null,
		ran: 'primary',
		fellBack: null,
	})
	const { events } = await readLog(paths)
	expect(events).toContainEqual(
		expect.objectContaining({
			action: 'backup',
			host: 'codex --model gpt',
			reason:
				'skipped: codex --model gpt cannot be answered while it runs, and this run is attended',
		}),
	)
})

test('an attended run with a refused primary and a backup that cannot hear the human gets the primary’s refusal', async () => {
	const { checkHost, startAgent } = await withBackup([
		OPUS,
		{ name: 'gpt', run: 'codex --model gpt', complexity: [1, 10], about: '' },
	])
	checkHost.mockImplementation(async (line) =>
		line.startsWith('claude')
			? { ok: false, reason: 'claude is installed but not logged in' }
			: { ok: true, reason: null },
	)

	const refused = dispatch(paths, 'auth-api-k7f2', { base: 'main', attended: true })

	await expect(refused).rejects.toThrow(HostError)
	await expect(refused).rejects.toThrow('claude is installed but not logged in')
	await expect(refused).rejects.not.toThrow('takes one message and exits')
	expect(startAgent).not.toHaveBeenCalled()
})

test('an attended run still falls to a backup that can hear the human', async () => {
	const { checkHost, startAgent } = await withBackup([
		OPUS,
		{ name: 'sonnet', run: 'claude --model sonnet', complexity: [1, 10], about: '' },
	])
	checkHost.mockResolvedValue({ ok: true, reason: null })
	startAgent
		.mockImplementationOnce(async ({ onStart, onLine }) => {
			onStart?.(1)
			onLine(CLAUDE_SPENT)
			return { kind: 'failed', reason: 'claude --model opus exited with code 1' }
		})
		.mockImplementationOnce(async ({ onStart }) => {
			onStart?.(2)
			return { kind: 'finished' }
		})

	const done = await dispatch(paths, 'auth-api-k7f2', { base: 'main', attended: true })

	expect(done.exit).toBe('finished')
	expect(startAgent).toHaveBeenCalledTimes(2)
	expect(startAgent.mock.calls[1]?.[0]).toMatchObject({
		host: 'claude --model sonnet',
		attended: true,
	})
	expect(await onlyRun()).toMatchObject({
		host: 'claude --model sonnet',
		backup: 'claude --model sonnet',
		ran: 'backup',
	})
})
