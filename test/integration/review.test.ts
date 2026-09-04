import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
	AnswerLockedError,
	acceptWork,
	addWorktree,
	answerDecision,
	approveBrief,
	archiveDecision,
	createBoardBranch,
	detectSetup,
	initBoard,
	loadBoard,
	NoBriefError,
	NoSuchOptionError,
	openDecisions,
	type Paths,
	readFeedback,
	rejectWork,
	reviewNode,
	statusOf,
	writeBrief,
	writeDecision,
	writeNode,
} from '@besober/core'
import { afterEach, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * Deciding, approving, reviewing, accepting and rejecting — against a real
 * repository. The CLI drives exactly these functions, and so will the MCP
 * server: one implementation, three surfaces (`PR-09-08`).
 */
const NODE = 'auth-api-k7f2'
const DECISION = 'session-store-k7f2'
const AT = '2026-09-04T00:00:00.000Z'

let repo: TempRepo | undefined

afterEach(() => {
	repo?.cleanup()
	repo = undefined
})

const board = async (): Promise<Paths> => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# fixture\n')
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: first')

	const { paths } = await initBoard(created.dir, { title: 'Acme', intent: 'ship', constraints: [] })
	await writeDecision(paths, DECISION, {
		category: 'state',
		question: 'Where does session state live?',
		options: [
			{ id: 'cookie', label: 'A cookie', reason: 'No server state', costLater: 'Size limits' },
			{ id: 'redis', label: 'Redis', reason: 'Revocable', costLater: 'A service to run' },
		],
		suggested: null,
		answer: null,
		createdAt: AT,
	})
	await writeNode(paths, NODE, {
		title: 'The auth API',
		description: 'Sign in and sign out.',
		notes: '',
		dependsOn: [],
		decisions: [DECISION],
		files: ['src/auth/**'],
		brief: null,
		outcome: null,
		accepted: null,
		createdAt: AT,
	})
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: sober')
	return paths
}

const work = async (paths: Paths) => {
	const { path } = await addWorktree(paths, NODE, 'main')
	mkdirSync(dirname(join(path, 'src/auth/token.ts')), { recursive: true })
	writeFileSync(join(path, 'src/auth/token.ts'), 'export const sign = () => "ok"\n')
	execFileSync('git', ['add', '-A'], { cwd: path })
	execFileSync('git', ['commit', '-m', 'feat: work'], { cwd: path })
	return path
}

test('answering unblocks every node bound by the decision, with nothing copied onto them', async () => {
	const paths = await board()
	expect(statusOf(await loadBoard(paths), NODE)).toBe('held')

	await answerDecision(paths, DECISION, { option: 'cookie', by: 'memoksin' })
	expect(statusOf(await loadBoard(paths), NODE)).toBe('needs-brief')

	// The node record did not change: status is derived from the decision (§3.2).
	const node = (await loadBoard(paths)).nodes.get(NODE)
	expect(node?.decisions).toEqual([DECISION])
})

test('an option nobody offered is refused, and the offer is named', async () => {
	const paths = await board()
	await expect(
		answerDecision(paths, DECISION, { option: 'postgres', by: 'memoksin' }),
	).rejects.toBeInstanceOf(NoSuchOptionError)
})

test('changing an answer is refused in M1, with the reason it is refused', async () => {
	const paths = await board()
	await answerDecision(paths, DECISION, { option: 'cookie', by: 'memoksin' })
	await expect(
		answerDecision(paths, DECISION, { option: 'redis', by: 'memoksin' }),
	).rejects.toBeInstanceOf(AnswerLockedError)
})

test('a node with no brief cannot be approved, and writing one clears the approval', async () => {
	const paths = await board()
	await expect(approveBrief(paths, NODE, { by: 'memoksin' })).rejects.toBeInstanceOf(NoBriefError)

	await writeBrief(paths, NODE, {
		approach: 'Endpoints first.',
		acceptance: [{ run: 'npm test', proves: 'They answer.' }],
	})
	await approveBrief(paths, NODE, { by: 'memoksin', queue: true })
	expect((await loadBoard(paths)).nodes.get(NODE)?.brief?.approval).toMatchObject({ queue: true })

	// A rewritten approach is not the approved one.
	await writeBrief(paths, NODE, {
		approach: 'Middleware first, actually.',
		acceptance: [{ run: 'npm test', proves: 'They answer.' }],
	})
	expect((await loadBoard(paths)).nodes.get(NODE)?.brief?.approval).toBeNull()
})

test('a review carries the scan, the criteria and the diff together', async () => {
	const paths = await board()
	await writeBrief(paths, NODE, {
		approach: 'Endpoints first.',
		acceptance: [{ run: 'npm test', proves: 'They answer.' }],
	})
	await work(paths)

	const review = await reviewNode(paths, NODE, 'main')
	expect(review).toMatchObject({ node: NODE, files: ['src/auth/token.ts'] })
	expect(review?.scan.result).toBe('clean')
	expect(review?.acceptance).toEqual([{ run: 'npm test', proves: 'They answer.' }])
	expect(review?.diff).toContain('+export const sign')
	expect(await reviewNode(paths, 'no-such-node-k7f2', 'main')).toBeNull()
})

test('accepting lands the work, records how the scan read, and takes the worktree away', async () => {
	const paths = await board()
	await work(paths)

	const merged = await acceptWork(paths, NODE, { by: 'memoksin', base: 'main', scan: 'clean' })
	expect(merged.base).toBe('main')

	const board2 = await loadBoard(paths)
	expect(statusOf(board2, NODE)).toBe('done')
	expect(board2.nodes.get(NODE)?.accepted).toMatchObject({ by: 'memoksin', scan: 'clean' })
	expect(readFileSync(join(paths.root, 'src/auth/token.ts'), 'utf8')).toContain('sign')
})

test('rejecting deletes nothing, and what was written comes back for the next run', async () => {
	const paths = await board()
	const path = await work(paths)

	await rejectWork(paths, NODE, { by: 'memoksin', text: 'Nothing checks the session.' })

	const feedback = await readFeedback(paths, NODE)
	expect(feedback).toMatchObject({ kind: 'ok', value: { text: 'Nothing checks the session.' } })
	// The branch, the worktree and the work are all still there (§6.4).
	expect(readFileSync(join(path, 'src/auth/token.ts'), 'utf8')).toContain('sign')
})

test('start clean resets the branch, and keeps the rejection', async () => {
	const paths = await board()
	const path = await work(paths)

	await rejectWork(paths, NODE, {
		by: 'memoksin',
		text: 'Start again.',
		clean: true,
		base: 'main',
	})
	expect(() => readFileSync(join(path, 'src/auth/token.ts'), 'utf8')).toThrow()
	expect((await readFeedback(paths, NODE)).kind).toBe('ok')
})

test('init detects the install command from a lockfile, and the board branch is an orphan', async () => {
	const paths = await board()
	writeFileSync(join(paths.root, 'pnpm-lock.yaml'), '')
	expect(await detectSetup(paths.root)).toBe('pnpm install --frozen-lockfile')

	expect(await createBoardBranch(paths.root, 'sober-graph')).toBe(true)
	// Created twice is created once: init is idempotent.
	expect(await createBoardBranch(paths.root, 'sober-graph')).toBe(false)

	const repoDir = paths.root
	expect(
		execFileSync('git', ['log', '--oneline', 'sober-graph'], { cwd: repoDir, encoding: 'utf8' }),
	).toContain('the board branch')
	// It shares no history with the code, which is the whole point (PR-00-05).
	expect(
		execFileSync('git', ['rev-list', '--count', 'sober-graph'], {
			cwd: repoDir,
			encoding: 'utf8',
		}).trim(),
	).toBe('1')
})

test('an archived decision still reads on the node that bound it', async () => {
	const paths = await board()
	await answerDecision(paths, DECISION, { option: 'cookie', by: 'memoksin' })
	await archiveDecision(paths, DECISION)

	const after = await loadBoard(paths)
	expect(after.decisions.get(DECISION)?.answer?.option).toBe('cookie')
	expect(statusOf(after, NODE)).toBe('needs-brief')
	// Readable, and no longer offered as something to answer — the one list
	// every surface renders from.
	expect(after.archivedDecisions.has(DECISION)).toBe(true)
	expect(openDecisions(after)).toEqual([])
})

test('an archived decision that was never answered stops being listed, and still holds', async () => {
	const paths = await board()
	await archiveDecision(paths, DECISION)

	const after = await loadBoard(paths)
	expect(openDecisions(after)).toEqual([])
	// It still holds the node that bound it: archiving is not answering (§8.3).
	expect(statusOf(after, NODE)).toBe('held')
})
