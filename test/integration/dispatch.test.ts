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
import { afterEach, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * Dispatch against a real git repository and a real child process, with the
 * host itself faked (ADR 0014): the host is the one thing that costs money and
 * answers differently every time. Everything between SOBER and it — the
 * worktree, the setup command, the run record, the log, the kill — is real.
 */
const FAKE_HOST = `${process.execPath} ${fileURLToPath(new URL('./fake-host.mjs', import.meta.url))}`

const aNode = (title: string) => ({
	title,
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
	expect(rendered.map((line) => line.kind)).toEqual(['started', 'tool', 'text', 'result'])
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
	expect(await checkHost('sober-no-such-host')).toMatchObject({
		ok: false,
		reason: expect.stringContaining('sober-no-such-host'),
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
