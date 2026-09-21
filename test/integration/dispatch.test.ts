import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	checkHost,
	dispatch,
	dispatchWave,
	HostError,
	initBoard,
	type Paths,
	readNodes,
	readRuns,
	rejectWork,
	runLog,
	SetupFailedError,
	setSetting,
	stopRun,
	tail,
	wasStopped,
	writeBrief,
	writeNode,
	writeRun,
	writeRunPid,
} from '@besober/core'
import { afterEach, expect, test, vi } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * Dispatch against a real git repository and a real child process, with the
 * host itself faked (ADR 0014): the host is the one thing that costs money and
 * answers differently every time. Everything between SOBER and it — the
 * worktree, the setup command, the run record, the log, the kill — is real.
 */
const FAKE_HOST = `${process.execPath} ${fileURLToPath(new URL('./hosts/claude.mjs', import.meta.url))}`

const aNode = (title: string) => ({
	title,
	name: title,
	description: 'Sign in and sign out.',
	notes: '',
	dependsOn: [],
	decisions: [],
	files: ['src/auth.ts'],
	brief: null,
	outcome: null,
	assignee: null,
	claim: null,
	accepted: null,
	dismissal: null,
	createdAt: '2026-09-04T00:00:00.000Z',
})

let repo: TempRepo | undefined

afterEach(() => {
	repo?.cleanup()
	repo = undefined
	vi.unstubAllGlobals()
	delete process.env.JEV_API_KEY
	delete process.env.FAKE_HOST_FAIL
	delete process.env.FAKE_HOST_HANG
	delete process.env.FAKE_HOST_LOGGED_OUT
	delete process.env.FAKE_HOST_WRITE
	delete process.env.FAKE_HOST_COMMIT
	delete process.env.SOBER_GH
	delete process.env.FAKE_GH_STATE
})

const FAKE_GH = fileURLToPath(new URL('./fake-gh.mjs', import.meta.url))

/** Points SOBER at a `gh` that touches no network, and says where it wrote. */
const fakeGh = (paths: Paths): string => {
	const state = join(paths.local, 'fake-gh.json')
	process.env.SOBER_GH = `${process.execPath} ${FAKE_GH}`
	process.env.FAKE_GH_STATE = state
	return state
}

const ghCalls = (state: string): string[][] =>
	existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')).calls : []

const board = async (settings: Record<string, unknown> = {}): Promise<Paths> => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# fixture\n')
	created.git('add', 'README.md')
	created.git('commit', '-m', 'chore: first')

	const { paths } = await initBoard(created.dir, { title: 'Acme', intent: 'ship', constraints: [] })
	let config = readFileSync(paths.config, 'utf8')
	config = setSetting(config, ['dispatch', 'host'], FAKE_HOST)
	for (const [key, value] of Object.entries(settings))
		config = setSetting(config, ['dispatch', key], value)
	writeFileSync(paths.config, config)

	await writeNode(paths, 'auth-api-k7f2', aNode('The auth API'))

	// Settings are read from the base ref, never from the branch under review
	// (ADR 0019) — so the base has to carry them.
	created.git('add', '.gitignore', '.sober/config.jsonc')
	created.git('commit', '-m', 'chore: sober')
	return paths
}

test('a dispatch runs the host in the node’s worktree and records how it exited', async () => {
	const paths = await board()
	const written = join(paths.root, 'seen-by-the-agent.txt')
	process.env.FAKE_HOST_WRITE = written

	const result = await dispatch(paths, 'auth-api-k7f2', {
		base: 'main',
		prompt: '# The auth API\n\nSign in and sign out.',
	})

	expect(result).toMatchObject({ exit: 'finished', error: null, prepared: true })
	expect(existsSync(result.worktree)).toBe(true)

	const runs = await readRuns(paths)
	expect(runs.records.size).toBe(1)
	const record = [...runs.records.values()][0]
	expect(record).toMatchObject({
		node: 'auth-api-k7f2',
		branch: 'sober/auth-api-k7f2',
		exit: 'finished',
		error: null,
	})
	expect(record?.endedAt).not.toBeNull()

	// The brief reached the host as its prompt, and no brief file was left in
	// the worktree for the scan to report as an undeclared file.
	expect(readFileSync(written, 'utf8')).toContain('Sign in and sign out.')
	expect(existsSync(join(result.worktree, 'brief.md'))).toBe(false)
})

test('starting work claims the node, so a teammate sees who is on it', async () => {
	const paths = await board()
	expect((await readNodes(paths)).records.get('auth-api-k7f2')?.claim).toBeNull()

	await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })

	// git's `user.name` in the fixture repository — the same name every other
	// surface attributes with (DESIGN §3.3, ADR 0030).
	const after = (await readNodes(paths)).records.get('auth-api-k7f2')
	expect(after?.claim?.by).toBe('SOBER Test')
})

test('the raw log is kept, and the tail renders it without the host’s own noise', async () => {
	const paths = await board()
	const result = await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })

	const raw = readFileSync(runLog(paths, result.run), 'utf8')
	expect(raw).toContain('hook_started')

	const rendered = tail(raw)
	expect(rendered.map((line) => line.kind)).toEqual([
		'started',
		'thinking',
		'tool',
		'text',
		'result',
	])
	expect(rendered.at(-1)?.text).toBe('finished')
	expect(rendered.some((line) => line.text.includes('noise-a-tail-must-drop'))).toBe(false)
})

test('a host that exits non-zero is a failed run, and the worktree is preserved', async () => {
	const paths = await board()
	process.env.FAKE_HOST_FAIL = '1'

	const result = await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })

	expect(result.exit).toBe('failed')
	expect(result.error).toContain('the host gave up')
	expect(existsSync(result.worktree)).toBe(true)
})

test('a logged-out host is refused before a worktree exists', async () => {
	const paths = await board()
	process.env.FAKE_HOST_LOGGED_OUT = '1'

	await expect(
		dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' }),
	).rejects.toBeInstanceOf(HostError)

	expect(await readRuns(paths).then((runs) => runs.records.size)).toBe(0)
	expect(existsSync(join(paths.local, 'worktrees', 'auth-api-k7f2'))).toBe(false)
})

test('a failing setup command stops the agent from starting at all', async () => {
	const paths = await board({ setup: 'node -e "process.exit(3)"' })

	await expect(
		dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' }),
	).rejects.toBeInstanceOf(SetupFailedError)

	expect(await readRuns(paths).then((runs) => runs.records.size)).toBe(0)
})

test('a run past its timeout is killed and recorded as failed, not as a stop', async () => {
	const paths = await board({ timeoutMinutes: 1 })
	process.env.FAKE_HOST_HANG = '1'

	// One minute is the smallest a user can configure; the test drives the same
	// path with a limit it can wait for.
	const result = await withTimeoutOf(0.02, () =>
		dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' }),
	)

	expect(result.exit).toBe('failed')
	expect(result.error).toContain('killed')
	expect(existsSync(result.worktree)).toBe(true)
})

test('stopping a run leaves its worktree and returns it as stopped', async () => {
	const paths = await board()
	process.env.FAKE_HOST_HANG = '1'

	const running = dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })
	await until(async () => (await readRuns(paths)).records.size === 1)
	const id = [...(await readRuns(paths)).records.keys()][0]
	expect(id).toBeDefined()

	await until(() => stopRun(paths, id as string))
	const result = await running

	expect(result.exit).toBe('stopped')
	expect(existsSync(result.worktree)).toBe(true)
})

test('stopping a run that has already ended is not an error, and marks nothing', async () => {
	const paths = await board()
	await writeRun(paths, 'run-gone-k7f2', {
		node: 'auth-api-k7f2',
		host: 'fake',
		branch: 'sober/auth-api-k7f2',
		worktree: '.sober/local/worktrees/auth-api-k7f2',
		startedAt: '2026-09-04T00:00:00.000Z',
		endedAt: null,
		exit: null,
		error: null,
		verify: null,
		acceptance: [],
	})
	// A pid nothing answers to: the run ended between the read and the kill,
	// which is the outcome the caller wanted rather than a failure.
	await writeRunPid(paths, 'run-gone-k7f2', 2 ** 30)

	expect(await stopRun(paths, 'run-gone-k7f2')).toBe(false)
	// And the stop is taken back, because nothing was stopped — a run that ends
	// on its own must not be recorded as one somebody halted.
	expect(await wasStopped(paths, 'run-gone-k7f2')).toBe(false)
})

test('a wave stops queueing after the first run that does not finish', async () => {
	const paths = await board({ concurrency: 1 })
	process.env.FAKE_HOST_FAIL = '1'
	// Its own files: two nodes heading for one file is §3.4's warning, and this
	// test is about the halt, not about that.
	await writeNode(paths, 'billing-ui-p3x9', { ...aNode('Billing'), files: ['src/billing.ts'] })

	const results = await dispatchWave(
		paths,
		[
			{ node: 'auth-api-k7f2', options: { base: 'main', prompt: 'first' } },
			{ node: 'billing-ui-p3x9', options: { base: 'main', prompt: 'second' } },
		],
		'main',
	)

	expect(results).toHaveLength(1)
	expect(existsSync(join(paths.local, 'worktrees', 'billing-ui-p3x9'))).toBe(false)
})

test('with no prompt given, the brief is built here — with any rejection above it', async () => {
	const paths = await board()
	await writeBrief(paths, 'auth-api-k7f2', {
		approach: 'Add the endpoints, then the middleware.',
		acceptance: [{ run: 'npm test', proves: 'They answer.' }],
	})
	await rejectWork(paths, 'auth-api-k7f2', { by: 'memoksin', text: 'Nothing checks the session.' })

	const written = join(dirname(paths.root), 'agent-saw.txt')
	process.env.FAKE_HOST_WRITE = written
	await dispatch(paths, 'auth-api-k7f2', { base: 'main' })

	// Feedback first: it is the only part the agent has not already seen, and
	// "rejecting is correcting" fails if the correction is buried (§6.4).
	const seen = readFileSync(written, 'utf8')
	expect(seen).toContain('Nothing checks the session.')
	expect(seen.indexOf('Nothing checks the session.')).toBeLessThan(
		seen.indexOf('Add the endpoints'),
	)
})

test('a host that is not installed says so, and names the command it looked for', async () => {
	// A path, because SOBER reads which host it is talking to off the program
	// name (`hosts.ts`) — a name it has no adapter for is a different refusal.
	expect(await checkHost('/nonexistent/bin/claude')).toMatchObject({
		ok: false,
		reason: expect.stringContaining('/nonexistent/bin/claude'),
	})
})

/** Drives the real timeout path with a limit a test can wait for. */
const withTimeoutOf = async <T>(minutes: number, run: () => Promise<T>): Promise<T> => {
	const real = setTimeout
	const patched = ((fn: () => void, ms?: number) =>
		real(fn, ms !== undefined && ms >= 60_000 ? minutes * 60_000 : ms)) as typeof setTimeout
	globalThis.setTimeout = patched
	try {
		return await run()
	} finally {
		globalThis.setTimeout = real
	}
}

const until = async (check: () => Promise<boolean> | boolean): Promise<void> => {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (await check()) return
		await new Promise((resolve) => setTimeout(resolve, 25))
	}
	throw new Error('condition never became true')
}

test('a finished run pushes its branch and opens the node’s draft pull request', async () => {
	const paths = await board()
	const state = fakeGh(paths)
	// A branch with no commit on it has no diff, so there is nothing to open a
	// pull request over — the agent has to have committed something.
	process.env.FAKE_HOST_COMMIT = 'src/auth.ts'

	const result = await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })

	expect(result.pr).toMatchObject({ kind: 'opened' })
	expect(ghCalls(state).some((call) => call[1] === 'create')).toBe(true)
})

test('with draftPr off, a run finishes and the git host is never called', async () => {
	const paths = await board({ draftPr: false })
	const state = fakeGh(paths)

	const result = await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })

	expect(result.exit).toBe('finished')
	expect(result.pr).toBeNull()
	expect(ghCalls(state)).toEqual([])
})

test('a pull request that cannot be opened does not fail the run', async () => {
	const paths = await board()
	fakeGh(paths)
	process.env.FAKE_GH_FAIL = '1'

	const result = await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })

	expect(result.exit).toBe('finished')
	expect(result.pr).toMatchObject({ kind: 'skipped' })
	delete process.env.FAKE_GH_FAIL
})

test('a finished run is verified and its acceptance commands are run, in the worktree', async () => {
	const paths = await board({ verify: 'exit 0' })
	await writeBrief(paths, 'auth-api-k7f2', {
		approach: 'Write it.',
		acceptance: [
			{ run: 'exit 0', proves: 'it signs in' },
			{ run: 'exit 3', proves: 'it signs out' },
		],
	})

	const result = await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })

	const run = (await readRuns(paths)).records.get(result.run)
	expect(run?.verify).toEqual({ exit: 0 })
	// Parallel to the brief's criteria, by index (ADR 0027).
	expect(run?.acceptance).toEqual([{ exit: 0 }, { exit: 3 }])
})

test('a failed verification is recorded, and does not turn the run into a failure', async () => {
	const paths = await board({ verify: 'exit 1' })

	const result = await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })

	expect(result.exit).toBe('finished')
	expect((await readRuns(paths)).records.get(result.run)?.verify).toEqual({ exit: 1 })
})

test('a run that did not finish verifies nothing — there is nothing to verify', async () => {
	const paths = await board({ verify: 'exit 0' })
	process.env.FAKE_HOST_FAIL = '1'

	const result = await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })

	expect(result.exit).toBe('failed')
	expect((await readRuns(paths)).records.get(result.run)?.verify).toBeNull()
})

/** Scores the node, so dispatch has a tier to pick. */
const score = async (paths: Paths, complexity: number | null): Promise<void> => {
	await writeBrief(paths, 'auth-api-k7f2', {
		approach: 'Add the endpoints.',
		acceptance: [{ run: 'npm test', proves: 'They answer.' }],
	})
	const node = (await readNodes(paths)).records.get('auth-api-k7f2')
	if (node?.brief == null) throw new Error('no brief')
	await writeNode(paths, 'auth-api-k7f2', { ...node, brief: { ...node.brief, complexity } })
}

const TIERS = {
	high: `${FAKE_HOST} --model big`,
	mid: `${FAKE_HOST} --model medium`,
	low: `${FAKE_HOST} --model small`,
}

const ran = async (paths: Paths) => [...(await readRuns(paths)).records.values()][0]

test.each([
	[9, 'high'],
	[8, 'high'],
	[5, 'mid'],
	[4, 'mid'],
	[3, 'low'],
] as const)('complexity %i runs the %s tier’s command line', async (complexity, tier) => {
	const paths = await board({ tiers: TIERS })
	await score(paths, complexity)

	await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'go' })

	expect(await ran(paths)).toMatchObject({ host: TIERS[tier], tier, fallback: false })
})

test('a tier that names no host runs dispatch.host, and the record says so', async () => {
	const paths = await board({ tiers: { ...TIERS, low: null } })
	await score(paths, 2)

	await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'go' })

	expect(await ran(paths)).toMatchObject({ host: FAKE_HOST, tier: 'low', fallback: true })
})

test('an unscored node runs dispatch.host with no tier', async () => {
	const paths = await board({ tiers: TIERS })
	await score(paths, null)

	await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'go' })

	expect(await ran(paths)).toMatchObject({ host: FAKE_HOST, tier: null, fallback: false })
})

test('a tier host that is not installed is refused before a worktree, naming the node, tier and key', async () => {
	const paths = await board({ tiers: { ...TIERS, high: '/nonexistent/bin/claude --model big' } })
	await score(paths, 9)

	const refusal = dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'go' })
	await expect(refusal).rejects.toBeInstanceOf(HostError)
	await expect(refusal).rejects.toThrow(
		/^auth-api-k7f2 was not started \(the high tier\): .*not installed.*or change `dispatch\.tiers\.high`$/,
	)
	expect(existsSync(join(paths.local, 'worktrees', 'auth-api-k7f2'))).toBe(false)
})

/**
 * Jev is the one thing in dispatch that reaches the network, so it is faked the
 * same way the host is (ADR 0014): everything between SOBER and it is real.
 */
const jevAnswers = (score: number, skills: Record<string, number> = {}) => ({
	answers: {
		complexity: { type: 'score', score },
		...Object.fromEntries(
			Object.entries(skills).map(([name, probability]) => [
				`skill:${name}`,
				{ type: 'noul', noul: probability },
			]),
		),
	},
})

test('with jevMode on, Jev picks the tier and its skills reach the agent', async () => {
	const paths = await board({ tiers: TIERS, jevMode: true, jevSkills: ['ponytail', 'unwanted'] })
	// The brief scores it low; Jev says high, and Jev is what runs.
	await score(paths, 2)
	const written = join(paths.root, 'seen-by-the-agent.txt')
	process.env.FAKE_HOST_WRITE = written
	process.env.JEV_API_KEY = 'sk-test'
	vi.stubGlobal(
		'fetch',
		async () => new Response(JSON.stringify(jevAnswers(8, { ponytail: 0.9, unwanted: 0.2 }))),
	)

	await dispatch(paths, 'auth-api-k7f2', { base: 'main' })

	expect(await ran(paths)).toMatchObject({ host: TIERS.high, tier: 'high', fallback: false })
	const prompt = readFileSync(written, 'utf8')
	expect(prompt).toContain('Use the `ponytail` skill.')
	expect(prompt).not.toContain('unwanted')
})

test('a Jev that cannot answer stops the dispatch before the worktree', async () => {
	const paths = await board({ tiers: TIERS, jevMode: true })
	await score(paths, 2)
	delete process.env.JEV_API_KEY

	await expect(dispatch(paths, 'auth-api-k7f2', { base: 'main' })).rejects.toThrow(/JEV_API_KEY/)

	expect((await readRuns(paths)).records.size).toBe(0)
})

const MODELS = [
	{ name: 'free', run: `${FAKE_HOST} --model free`, complexity: [1, 3], about: 'Free.' },
	{ name: 'codex', run: `${FAKE_HOST} --model codex`, complexity: [3, 7], about: 'Plumbing.' },
	{ name: 'big', run: `${FAKE_HOST} --model big`, complexity: [8, 10] },
]

test('a models list wins over the tiers: the first entry covering the score runs', async () => {
	const paths = await board({ tiers: TIERS, models: MODELS })
	await score(paths, 3)

	await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'go' })

	expect(await ran(paths)).toMatchObject({ host: MODELS[0]?.run, tier: 'free', fallback: false })
})

test('a score no entry covers runs dispatch.host, and the record says so', async () => {
	const paths = await board({ models: MODELS.slice(0, 2) })
	await score(paths, 9)

	await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'go' })

	expect(await ran(paths)).toMatchObject({ host: FAKE_HOST, tier: null, fallback: true })
})

test('with jevMode on and a models list, Jev picks among the entries that cover its score', async () => {
	const paths = await board({ models: MODELS, jevMode: true })
	await score(paths, 9)
	process.env.JEV_API_KEY = 'sk-test'
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(new Response(JSON.stringify(jevAnswers(2))))
		.mockResolvedValueOnce(
			new Response(JSON.stringify({ answers: { model: { type: 'choice', choice: 'codex' } } })),
		)
	vi.stubGlobal('fetch', fetch)

	await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'go' })

	expect(fetch).toHaveBeenCalledTimes(2)
	expect(await ran(paths)).toMatchObject({ host: MODELS[1]?.run, tier: 'codex', fallback: false })
})

test('a tier naming a host no adapter knows is refused the same way, not as a bare unknown host', async () => {
	const paths = await board({ tiers: { ...TIERS, high: 'claud --model big' } })
	await score(paths, 9)

	const refusal = dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'go' })
	await expect(refusal).rejects.toBeInstanceOf(HostError)
	await expect(refusal).rejects.toThrow(
		'auth-api-k7f2 was not started (the high tier): SOBER has no adapter for `claud --model big` — change `dispatch.tiers.high`',
	)
})

test('an unscored node’s refusal names dispatch.host and no tier key', async () => {
	const paths = await board({ tiers: TIERS })
	await score(paths, null)
	process.env.FAKE_HOST_LOGGED_OUT = '1'

	const refusal = dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'go' })
	await expect(refusal).rejects.toThrow(
		/^auth-api-k7f2 was not started: .*or change `dispatch\.host`$/,
	)
	await expect(refusal).rejects.not.toThrow(/dispatch\.tiers|tier\)/)
})

test('tiers are read from the base, never from the working copy', async () => {
	const paths = await board()
	await score(paths, 9)
	writeFileSync(
		paths.config,
		setSetting(readFileSync(paths.config, 'utf8'), ['dispatch', 'tiers', 'high'], TIERS.high),
	)

	await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'go' })

	expect(await ran(paths)).toMatchObject({ host: FAKE_HOST, tier: 'high', fallback: true })
})
