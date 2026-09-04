import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	acceptWork,
	addWorktree,
	checksOf,
	greenNodes,
	initBoard,
	type Paths,
	publish,
	pullRequestOf,
	reviewNode,
	setSetting,
	writeBrief,
	writeNode,
	writeRun,
} from '@besober/core'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * The pull request is a mechanism, not a surface (DESIGN §6.1). Everything here
 * is real — a real branch, a real push, a real bare remote — except the git
 * host's own API, which a test may not call on somebody's account. `fake-gh.mjs`
 * stands in for `gh` and records what SOBER asked it to do.
 */
const FAKE_GH = fileURLToPath(new URL('./fake-gh.mjs', import.meta.url))

let repo: TempRepo | undefined
let state: string

afterEach(() => {
	repo?.cleanup()
	repo = undefined
	delete process.env.SOBER_GH
	delete process.env.FAKE_GH_STATE
	delete process.env.FAKE_GH_CHECKS
	delete process.env.FAKE_GH_FAIL
})

const node = (title: string, files: string[] = []) => ({
	title,
	description: '',
	notes: '',
	dependsOn: [],
	decisions: [],
	files,
	brief: null,
	outcome: null,
	assignee: null,
	claim: null,
	accepted: null,
	createdAt: '2026-09-05T00:00:00.000Z',
})

/** A board with one node, its worktree, and one commit on its branch. */
const board = async (options: { remote?: boolean } = {}): Promise<Paths> => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# acme\n')
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: first')
	created.git('push', '-u', 'origin', 'main')
	if (options.remote === false) created.git('remote', 'remove', 'origin')

	const { paths } = await initBoard(created.dir, { title: 'Acme', intent: '', constraints: [] })
	await writeNode(paths, 'auth-api-k7f2', node('The auth API', ['src/auth/**']))

	const worktree = await addWorktree(paths, 'auth-api-k7f2', 'main')
	// Inside the node's declared files, so the scan has nothing to say about it
	// and the green tests are about CI rather than about the fixture.
	mkdirSync(join(worktree.path, 'src/auth'), { recursive: true })
	writeFileSync(join(worktree.path, 'src/auth/session.ts'), 'export const signIn = () => {}\n')
	execFileSync('git', ['add', '-A'], { cwd: worktree.path })
	execFileSync('git', ['commit', '-m', 'feat: sign in'], { cwd: worktree.path })
	return paths
}

beforeEach(() => {
	state = join(tmpdir(), `fake-gh-${Math.random().toString(36).slice(2)}.json`)
	process.env.FAKE_GH_STATE = state
	process.env.SOBER_GH = `${process.execPath} ${FAKE_GH}`
})

const calls = (): string[][] =>
	existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')).calls : []

const said = (command: string): string[][] =>
	calls().filter((call) => call.slice(0, 2).join(' ') === command)

test('a finished run pushes the branch and opens one draft pull request', async () => {
	const paths = await board()

	const published = await publish(paths, 'auth-api-k7f2', 'main')

	expect(published).toMatchObject({ kind: 'opened', pr: { number: 1, draft: true } })
	expect(said('pr create')[0]).toContain('--draft')
	// The branch is on the remote, which is the whole point: CI runs on it.
	expect(repo?.git('ls-remote', '--heads', 'origin', 'sober/auth-api-k7f2')).toContain(
		'sober/auth-api-k7f2',
	)
})

test('a branch with nothing on it opens nothing — there is no diff to review', async () => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# acme\n')
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: first')
	created.git('push', '-u', 'origin', 'main')
	const { paths } = await initBoard(created.dir, { title: 'Acme', intent: '', constraints: [] })
	await writeNode(paths, 'auth-api-k7f2', node('The auth API'))
	await addWorktree(paths, 'auth-api-k7f2', 'main')

	const published = await publish(paths, 'auth-api-k7f2', 'main')

	expect(published.kind).toBe('skipped')
	expect(published.kind === 'skipped' && published.reason).toContain('nothing committed')
	expect(said('pr create')).toEqual([])
})

test('a second run updates that pull request and never opens a second one', async () => {
	const paths = await board()
	await publish(paths, 'auth-api-k7f2', 'main')

	const again = await publish(paths, 'auth-api-k7f2', 'main')

	expect(again).toMatchObject({ kind: 'updated', pr: { number: 1 } })
	expect(said('pr create')).toHaveLength(1)
})

test('with no remote the flow is identical, minus the pull request', async () => {
	const paths = await board({ remote: false })

	expect(await publish(paths, 'auth-api-k7f2', 'main')).toMatchObject({ kind: 'skipped' })
	expect(calls()).toEqual([])
})

test('a git host that will not answer is said out loud, and nothing else changes', async () => {
	const paths = await board()
	process.env.FAKE_GH_FAIL = '1'

	const published = await publish(paths, 'auth-api-k7f2', 'main')

	expect(published.kind).toBe('skipped')
	expect(published.kind === 'skipped' && published.reason).toContain('gh auth login')
})

test('a repository with no gh at all opens nothing and refuses nothing', async () => {
	const paths = await board()
	process.env.SOBER_GH = `${process.execPath} ${join(paths.root, 'no-such-gh.mjs')}`

	expect((await publish(paths, 'auth-api-k7f2', 'main')).kind).toBe('skipped')
})

test('the pull request is found again by the branch, so nothing has to be stored', async () => {
	const paths = await board()
	expect(await pullRequestOf(paths, 'auth-api-k7f2')).toBeNull()

	await publish(paths, 'auth-api-k7f2', 'main')

	expect(await pullRequestOf(paths, 'auth-api-k7f2')).toMatchObject({ number: 1, draft: true })
})

test('a repository with no remote has no pull request to look up, and none is spawned', async () => {
	const paths = await board()
	await publish(paths, 'auth-api-k7f2', 'main')
	repo?.git('remote', 'remove', 'origin')
	const before = calls().length

	expect(await pullRequestOf(paths, 'auth-api-k7f2')).toBeNull()
	expect(calls()).toHaveLength(before)
})

test('CI is read from the pull request, in every state it can be in', async () => {
	const paths = await board()
	await publish(paths, 'auth-api-k7f2', 'main')

	expect(await checksOf(paths, 'auth-api-k7f2')).toEqual({ kind: 'none' })

	process.env.FAKE_GH_CHECKS = 'pending'
	expect(await checksOf(paths, 'auth-api-k7f2')).toEqual({ kind: 'pending' })

	process.env.FAKE_GH_CHECKS = 'pass'
	expect(await checksOf(paths, 'auth-api-k7f2')).toEqual({ kind: 'passing' })

	process.env.FAKE_GH_CHECKS = 'fail'
	expect(await checksOf(paths, 'auth-api-k7f2')).toEqual({ kind: 'failing', failed: ['test'] })
})

test('with no pull request there is no CI, and that is not a failure', async () => {
	const paths = await board()

	expect(await checksOf(paths, 'auth-api-k7f2')).toEqual({ kind: 'none' })
})

test('a scanner-shaped honesty: a git host that cannot be reached is not a passing CI', async () => {
	const paths = await board()
	await publish(paths, 'auth-api-k7f2', 'main')
	process.env.FAKE_GH_FAIL = '1'

	expect((await checksOf(paths, 'auth-api-k7f2')).kind).toBe('unavailable')
})

test('an answer that is not JSON is not "no checks" — it is an answer nobody could read', async () => {
	const paths = await board()
	await publish(paths, 'auth-api-k7f2', 'main')
	process.env.FAKE_GH_CHECKS = 'garbage'

	expect((await checksOf(paths, 'auth-api-k7f2')).kind).toBe('unavailable')
})

test('the review carries CI beside the scan, from the same core function', async () => {
	const paths = await board()
	await publish(paths, 'auth-api-k7f2', 'main')
	process.env.FAKE_GH_CHECKS = 'fail'

	const review = await reviewNode(paths, 'auth-api-k7f2', 'main')

	expect(review?.ci).toEqual({ kind: 'failing', failed: ['test'] })
})

test('accept lands locally by default, and never touches the git host', async () => {
	const paths = await board()
	await publish(paths, 'auth-api-k7f2', 'main')
	const before = said('pr merge').length

	await acceptWork(paths, 'auth-api-k7f2', { by: 'alice', base: 'main', scan: 'clean' })

	expect(said('pr merge')).toHaveLength(before)
	expect(repo?.git('log', '--oneline', 'main')).toContain('sober: auth-api-k7f2')
})

test('a project set to the pull request marks it ready and merges it there', async () => {
	const paths = await board()
	writeFileSync(
		paths.config,
		setSetting(readFileSync(paths.config, 'utf8'), ['dispatch', 'accept'], 'pull-request'),
	)
	await publish(paths, 'auth-api-k7f2', 'main')

	await acceptWork(paths, 'auth-api-k7f2', { by: 'alice', base: 'main', scan: 'clean' })

	expect(said('pr ready')).toHaveLength(1)
	expect(said('pr merge')).toHaveLength(1)
	// The node is done either way: the record is what makes it so (§3.2).
	expect(readFileSync(join(paths.nodes, 'auth-api-k7f2.json'), 'utf8')).toContain('"by": "alice"')
})

test('a push the remote will not take is a step that did not happen, not a crash', async () => {
	const paths = await board()
	repo?.git('remote', 'set-url', 'origin', join(paths.root, 'nowhere.git'))

	const published = await publish(paths, 'auth-api-k7f2', 'main')

	expect(published.kind).toBe('skipped')
	expect(said('pr create')).toEqual([])
})

test('the pull request path refuses when there is no pull request to merge', async () => {
	const paths = await board()
	writeFileSync(
		paths.config,
		setSetting(readFileSync(paths.config, 'utf8'), ['dispatch', 'accept'], 'pull-request'),
	)

	await expect(
		acceptWork(paths, 'auth-api-k7f2', { by: 'alice', base: 'main', scan: 'clean' }),
	).rejects.toThrow(/pull request/i)
})

/** A finished run, with whatever it is supposed to have proved. */
const finished = (
	paths: Paths,
	options: {
		verify?: { exit: number } | null
		acceptance?: ({ exit: number } | null)[]
	} = {},
) =>
	writeRun(paths, 'run-k7f2', {
		node: 'auth-api-k7f2',
		host: 'fake',
		branch: 'sober/auth-api-k7f2',
		worktree: '/tmp/worktree',
		startedAt: '2026-09-05T09:00:00.000Z',
		endedAt: '2026-09-05T09:10:00.000Z',
		exit: 'finished',
		error: null,
		verify: options.verify ?? null,
		acceptance: options.acceptance ?? [],
	})

test('green is verification, the scan, the acceptance commands and CI — all of them', async () => {
	const paths = await board()
	await publish(paths, 'auth-api-k7f2', 'main')
	process.env.FAKE_GH_CHECKS = 'pass'
	await writeBrief(paths, 'auth-api-k7f2', {
		approach: 'Write it.',
		acceptance: [{ run: 'pnpm test', proves: 'it signs in' }],
	})
	await finished(paths, { verify: { exit: 0 }, acceptance: [{ exit: 0 }] })

	expect(await greenNodes(paths, 'main')).toMatchObject({ green: ['auth-api-k7f2'], held: [] })
})

test('a failing check holds a node back, and says which one did', async () => {
	const paths = await board()
	await publish(paths, 'auth-api-k7f2', 'main')
	process.env.FAKE_GH_CHECKS = 'fail'
	await finished(paths, { verify: { exit: 0 } })

	const found = await greenNodes(paths, 'main')
	expect(found.green).toEqual([])
	expect(found.held[0]?.why).toContain('CI')
})

test('an acceptance command that did not run is not a passing one', async () => {
	const paths = await board()
	await writeBrief(paths, 'auth-api-k7f2', {
		approach: 'Write it.',
		acceptance: [{ run: 'pnpm test', proves: 'it signs in' }],
	})
	await finished(paths, { acceptance: [null] })

	const found = await greenNodes(paths, 'main')
	expect(found.green).toEqual([])
	expect(found.held[0]?.why).toContain('did not run')
})

test('a failed verification holds it back too', async () => {
	const paths = await board()
	await finished(paths, { verify: { exit: 1 } })

	expect((await greenNodes(paths, 'main')).held[0]?.why).toContain('verification')
})

test('a node nobody is reviewing is neither green nor held — it is not in the queue', async () => {
	const paths = await board()

	expect(await greenNodes(paths, 'main')).toEqual({ green: [], held: [] })
})

// The CLI is the contract test for the other surfaces (`PR-09-08`), and it runs
// the built binary: a contract test that imports the implementation proves less
// than one that runs what a user installs.
const SOBER = fileURLToPath(new URL('../../packages/cli/dist/sober.js', import.meta.url))

const sober = (cwd: string, ...args: string[]): string =>
	execFileSync(process.execPath, [SOBER, ...args], {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, NO_COLOR: '1' },
	})

test('the review shows CI beside the scan, and the draft it read it from', async () => {
	const paths = await board()
	await publish(paths, 'auth-api-k7f2', 'main')
	process.env.FAKE_GH_CHECKS = 'fail'

	const said_ = sober(paths.root, 'review', 'auth-api-k7f2', '--base', 'main')

	expect(said_).toContain('CI failed — test')
	expect(said_).toContain('draft #1')
})

test('a node that has never run reviews as empty, not as a git error', async () => {
	const paths = await board()
	await writeNode(paths, 'billing-p2x1', node('Billing'))

	const review = await reviewNode(paths, 'billing-p2x1', 'main')

	expect(review).toMatchObject({ node: 'billing-p2x1', diff: '', files: [], exit: null })
	expect(sober(paths.root, 'review', 'billing-p2x1', '--base', 'main')).toContain('not run')
})

test('a record that will not parse is named, not reported as a node nobody wrote', async () => {
	const paths = await board()
	writeFileSync(join(paths.nodes, 'broken-m3q8.json'), '{ not json')

	let said_ = ''
	try {
		sober(paths.root, 'review', 'broken-m3q8', '--base', 'main')
	} catch (error) {
		const failure = error as { stdout?: string; stderr?: string }
		said_ = `${failure.stdout ?? ''}${failure.stderr ?? ''}`
	}
	expect(said_).toContain('broken-m3q8.json')
})

test('a git host that could not be read is said in the review, never dropped', async () => {
	const paths = await board()
	await publish(paths, 'auth-api-k7f2', 'main')
	process.env.FAKE_GH_FAIL = '1'

	// The pull request cannot be read either, so a line gated on having one
	// would drop the whole sentence — which is the failure §6.2 exists to stop.
	expect(sober(paths.root, 'review', 'auth-api-k7f2', '--base', 'main')).toContain(
		'CI could not be read',
	)
})

test('`accept --green` lands what is green and says why the rest is not', async () => {
	const paths = await board()
	await writeNode(paths, 'billing-p2x1', node('Billing'))
	await publish(paths, 'auth-api-k7f2', 'main')
	process.env.FAKE_GH_CHECKS = 'pass'
	await finished(paths, { verify: { exit: 0 } })
	await writeRun(paths, 'run-p2x1', {
		node: 'billing-p2x1',
		host: 'fake',
		branch: 'sober/billing-p2x1',
		worktree: '/tmp/worktree',
		startedAt: '2026-09-05T09:00:00.000Z',
		endedAt: '2026-09-05T09:10:00.000Z',
		exit: 'finished',
		error: null,
		verify: { exit: 1 },
		acceptance: [],
	})

	const said_ = sober(paths.root, 'accept', '--green', '--base', 'main')

	expect(said_).toContain('auth-api-k7f2 is done')
	expect(said_).toContain('1 node not green')
	expect(said_).toContain('verification failed')
})

test('`accept --green` on a board nobody is reviewing says exactly that', async () => {
	const paths = await board()

	expect(sober(paths.root, 'accept', '--green', '--base', 'main')).toContain(
		'nothing is waiting on a review',
	)
})
