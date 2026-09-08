import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
	AcceptedAlreadyError,
	AnswerLockedError,
	acceptNode,
	acceptWork,
	addWorktree,
	answerDecision,
	approveBrief,
	archiveDecision,
	createBoardBranch,
	detectSetup,
	dismissFlag,
	initBoard,
	loadBoard,
	NoBriefError,
	NoSuchOptionError,
	openDecisions,
	type Paths,
	readFeedback,
	readNodes,
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
		derived: null,
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
		assignee: null,
		claim: null,
		accepted: null,
		dismissal: null,
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

test('a node that is already done cannot be approved again', async () => {
	const paths = await board()
	await writeBrief(paths, NODE, {
		approach: 'Endpoints first.',
		acceptance: [{ run: 'npm test', proves: 'They answer.' }],
	})
	await approveBrief(paths, NODE, { by: 'memoksin' })
	await acceptNode(paths, NODE, {
		by: 'memoksin',
		at: '2026-09-05T21:06:47.698Z',
		flagged: false,
		scan: 'clean',
		audit: 'passed',
	})

	// M2 gate finding 3: this wrote a fresh approval onto an accepted node, so
	// the record said the approval came after the acceptance.
	await expect(approveBrief(paths, NODE, { by: 'memoksin' })).rejects.toBeInstanceOf(
		AcceptedAlreadyError,
	)
	expect((await loadBoard(paths)).nodes.get(NODE)?.brief?.approval?.at).not.toBe(
		'2026-09-05T21:06:47.698Z',
	)
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
	// The criterion and what running it did (ADR 0049). Nothing has run here, so
	// the result is null — which is "did not run", never a pass.
	expect(review?.acceptance).toEqual([{ run: 'npm test', proves: 'They answer.', result: null }])
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

test('work that was written but never committed is named, not reviewed as nothing', async () => {
	const paths = await board()
	const { path } = await addWorktree(paths, NODE, 'main')
	mkdirSync(dirname(join(path, 'src/auth/token.ts')), { recursive: true })
	writeFileSync(join(path, 'src/auth/token.ts'), 'export const sign = () => "ok"\n')
	// No commit. This is what the M1 gate produced: an agent that wrote
	// everything, committed nothing, and reviewed as if it had done nothing.

	const review = await reviewNode(paths, NODE, 'main')
	expect(review?.diff).toBe('')
	expect(review?.files).toEqual([])
	expect(review?.uncommitted).toEqual(['src/auth/token.ts'])
})

test('untracked files in the repository do not refuse a merge', async () => {
	const paths = await board()
	await work(paths)
	// `sober init` writes .gitignore and .sober/ and does not commit them, so
	// the first accept on a fresh board was refused by SOBER's own files.
	writeFileSync(join(paths.root, 'untracked.txt'), 'not committed, not tracked\n')

	const merged = await acceptWork(paths, NODE, { by: 'memoksin', base: 'main', scan: 'clean' })
	expect(merged.base).toBe('main')
	expect(statusOf(await loadBoard(paths), NODE)).toBe('done')
})

test('a tracked change still refuses a merge, because that one would be merged into', async () => {
	const paths = await board()
	await work(paths)
	writeFileSync(join(paths.root, 'README.md'), '# fixture, edited\n')

	await expect(
		acceptWork(paths, NODE, { by: 'memoksin', base: 'main', scan: 'clean' }),
	).rejects.toThrow(/uncommitted changes/)
})

test('a node with nothing committed cannot be accepted, and says what is waiting', async () => {
	const paths = await board()
	const { path } = await addWorktree(paths, NODE, 'main')
	writeFileSync(join(path, 'token.ts'), 'export const sign = () => "ok"\n')

	// The M1 gate produced exactly this: `git merge` on a branch the base already
	// contains succeeds by doing nothing, so the node read `done` over an
	// unchanged main and the work stayed in the worktree.
	await expect(
		acceptWork(paths, NODE, { by: 'memoksin', base: 'main', scan: 'clean' }),
	).rejects.toThrow(/nothing committed to merge.*token\.ts/s)

	// And nothing was recorded: the node is not done.
	expect(statusOf(await loadBoard(paths), NODE)).not.toBe('done')
	expect((await loadBoard(paths)).nodes.get(NODE)?.accepted).toBeNull()
})

test('accepting a node whose branch is gone says so, rather than reporting a git argument', async () => {
	const paths = await board()
	await work(paths)
	await acceptWork(paths, NODE, { by: 'memoksin', base: 'main', scan: 'clean' })

	// Reachable through a merge: `accepted` can come back null on a clone whose
	// branch accept already deleted (ADR 0013).
	const record = (await readNodes(paths)).records.get(NODE)
	if (record === undefined) throw new Error(`${NODE} vanished`)
	await writeNode(paths, NODE, { ...record, accepted: null })

	const refused = await acceptWork(paths, NODE, {
		by: 'memoksin',
		base: 'main',
		scan: 'clean',
	}).catch((error: Error) => error.message)
	expect(refused).toContain('no branch to merge')
	expect(refused).not.toContain('rev-list')
})

test('a review of an accepted node carries the acceptance, so a surface can say it is done', async () => {
	const paths = await board()
	await work(paths)
	await acceptWork(paths, NODE, { by: 'memoksin', base: 'main', scan: 'clean' })

	const found = await reviewNode(paths, NODE, 'main')
	expect(found?.accepted).toMatchObject({ by: 'memoksin', scan: 'clean' })
	// The branch is gone with the accept, so there is no diff left to read —
	// and an empty diff is zero lines, never one.
	expect(found?.diff).toBe('')
})

/**
 * DESIGN §2.8's sentence, end to end: the flag renders in the review, and if
 * the human accepts anyway the `accepted` record says so. That record is what
 * puts a finished node in §7.2's stale list rather than letting the flag end
 * at the accept.
 *
 * The path is a real one, not a fixture: `approveBrief` does not require a
 * node's decisions to be answered, so a brief approved while the node is `held`
 * and answered afterwards is flagged today — with no impact preview needed.
 */
test('a flag reaches the review, and survives being accepted anyway', async () => {
	const paths = await board()
	await writeBrief(paths, NODE, {
		approach: 'Endpoints first.',
		acceptance: [{ run: 'npm test', proves: 'They answer.' }],
	})
	await approveBrief(paths, NODE, { by: 'memoksin' })
	await work(paths)

	// Before the answer moves, there is nothing stale about it.
	expect((await reviewNode(paths, NODE, 'main'))?.flagged).toBe(false)

	await answerDecision(paths, DECISION, { option: 'redis', by: 'memoksin' })
	expect((await reviewNode(paths, NODE, 'main'))?.flagged).toBe(true)

	const found = await reviewNode(paths, NODE, 'main')
	await acceptWork(paths, NODE, {
		by: 'memoksin',
		base: 'main',
		scan: found?.scan.result ?? 'did-not-run',
		flagged: found?.flagged ?? false,
	})

	const record = (await loadBoard(paths)).nodes.get(NODE)
	expect(record?.accepted?.flagged).toBe(true)
	// Still flagged after the accept: that is what §7.2's list is made of.
	expect((await reviewNode(paths, NODE, 'main'))?.flagged).toBe(true)
})

test('dismissing a flag settles that answer, and the next change raises it again', async () => {
	const paths = await board()
	await writeBrief(paths, NODE, {
		approach: 'Endpoints first.',
		acceptance: [{ run: 'npm test', proves: 'They answer.' }],
	})
	await approveBrief(paths, NODE, { by: 'memoksin' })
	await answerDecision(paths, DECISION, { option: 'redis', by: 'memoksin' })
	expect((await reviewNode(paths, NODE, 'main'))?.flagged).toBe(true)

	await dismissFlag(paths, NODE, {
		by: 'memoksin',
		reason: 'The endpoints never read the session store.',
	})
	expect((await reviewNode(paths, NODE, 'main'))?.flagged).toBe(false)

	// A second change to the same decision is a change nobody has judged. Editing
	// an answered decision is still refused (ADR 0015), so the record is moved
	// the way an impact-previewed edit will move it.
	const record = (await loadBoard(paths)).decisions.get(DECISION)
	await writeDecision(paths, DECISION, {
		...(record as NonNullable<typeof record>),
		answer: {
			option: 'cookie',
			rationale: '',
			by: 'memoksin',
			at: new Date(Date.now() + 1000).toISOString(),
			derived: null,
		},
	})
	expect((await reviewNode(paths, NODE, 'main'))?.flagged).toBe(true)
})
