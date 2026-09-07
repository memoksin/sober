import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	acceptWork,
	answerDecision,
	approveBrief,
	claimNode,
	dispatch,
	dispatchWave,
	initBoard,
	OverlapError,
	type Paths,
	rejectWork,
	runQueue,
	SoberError,
	setSetting,
	writeBrief,
	writeDecision,
	writeNode,
} from '@besober/core'
import { afterEach, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * The half of §3.4 and D26 that M1 left as a field nobody read: the same-files
 * warning at dispatch, and the queue that "approve and queue" was always
 * feeding. Real git, real child processes, the host faked (ADR 0014).
 */
const FAKE_HOST = `${process.execPath} ${fileURLToPath(new URL('./hosts/claude.mjs', import.meta.url))}`

let repo: TempRepo | undefined

afterEach(() => {
	repo?.cleanup()
	repo = undefined
	delete process.env.FAKE_HOST_COMMIT
	delete process.env.FAKE_HOST_FAIL
})

const aNode = (fields: Record<string, unknown>) => ({
	title: 'A node',
	description: 'Sign in and sign out.',
	notes: '',
	dependsOn: [],
	decisions: [],
	files: ['src/auth/**'],
	brief: null,
	outcome: null,
	assignee: null,
	claim: null,
	accepted: null,
	dismissal: null,
	createdAt: '2026-09-05T00:00:00.000Z',
	...fields,
})

const board = async (): Promise<Paths> => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# fixture\n')
	created.git('add', 'README.md')
	created.git('commit', '-m', 'chore: first')

	const { paths } = await initBoard(created.dir, { title: 'Acme', intent: 'ship', constraints: [] })
	writeFileSync(
		paths.config,
		setSetting(readFileSync(paths.config, 'utf8'), ['dispatch', 'host'], FAKE_HOST),
	)
	created.git('add', '.gitignore', '.sober/config.jsonc')
	created.git('commit', '-m', 'chore: sober')
	return paths
}

/** A node with an approved brief, so its only remaining question is whether it may start. */
const approved = async (
	paths: Paths,
	id: string,
	fields: Record<string, unknown> = {},
	queue = false,
): Promise<void> => {
	await writeNode(paths, id, aNode(fields))
	await writeBrief(paths, id, {
		approach: 'Write it.',
		acceptance: [{ run: 'true', proves: 'it works' }],
	})
	await approveBrief(paths, id, { by: 'Alice', queue })
}

// ---------------------------------------------------------------- at dispatch

test('a node heading for an active node’s files is not dispatched without a confirmation', async () => {
	const paths = await board()
	await approved(paths, 'auth-api-k7f2', { files: ['src/auth/**'] })
	await approved(paths, 'session-ui-m3q8', { files: ['src/auth/session.ts'] })
	await claimNode(paths, 'session-ui-m3q8', 'Bob')

	const refused = await dispatch(paths, 'auth-api-k7f2', { base: 'main' }).catch(
		(error: unknown) => error,
	)

	expect(refused).toBeInstanceOf(OverlapError)
	const error = refused as OverlapError
	expect(error.message).toContain('session-ui-m3q8')
	expect(error.overlaps).toEqual([
		expect.objectContaining({ id: 'session-ui-m3q8', by: 'Bob', files: ['src/auth/**'] }),
	])
})

test('the confirmation is not a block: told to go anyway, it goes', async () => {
	const paths = await board()
	await approved(paths, 'auth-api-k7f2', { files: ['src/auth/**'] })
	await approved(paths, 'session-ui-m3q8', { files: ['src/auth/session.ts'] })
	await claimNode(paths, 'session-ui-m3q8', 'Bob')

	const result = await dispatch(paths, 'auth-api-k7f2', { base: 'main', anyway: true })
	expect(result.exit).toBe('finished')
})

test('one person’s own parallel wave warns about itself, and starts nothing it warned about', async () => {
	const paths = await board()
	await approved(paths, 'auth-api-k7f2', { files: ['src/auth/**'] })
	await approved(paths, 'session-ui-m3q8', { files: ['src/auth/session.ts'] })
	await approved(paths, 'billing-x9c1', { files: ['src/billing/**'] })

	const results = await dispatchWave(
		paths,
		['auth-api-k7f2', 'billing-x9c1', 'session-ui-m3q8'].map((node) => ({
			node,
			options: { base: 'main' },
		})),
		'main',
	)

	// Neither of the two that meet may start; the third is nobody's business.
	expect(results[0]).toBeInstanceOf(OverlapError)
	expect(results[2]).toBeInstanceOf(OverlapError)
	expect(results[1]).toMatchObject({ exit: 'finished' })
})

test('a refused wave member does not stop the rest — a warning is not a failed result', async () => {
	const paths = await board()
	await approved(paths, 'auth-api-k7f2', { files: ['src/auth/**'] })
	await approved(paths, 'session-ui-m3q8', { files: ['src/auth/session.ts'] })
	await approved(paths, 'billing-x9c1', { files: ['src/billing/**'] })

	const results = await dispatchWave(
		paths,
		['auth-api-k7f2', 'session-ui-m3q8', 'billing-x9c1'].map((node) => ({
			node,
			options: { base: 'main' },
		})),
		'main',
	)
	expect(results).toHaveLength(3)
	expect(results[0]).toBeInstanceOf(OverlapError)
	expect(results[1]).toBeInstanceOf(OverlapError)
	expect(results[2]).toMatchObject({ exit: 'finished' })
})

// ------------------------------------------------------------------- the queue

/** `first` is accepted to make `second` ready; `second` is the one under test. */
const chain = async (paths: Paths, queue: boolean): Promise<void> => {
	await approved(paths, 'auth-api-k7f2', { files: ['src/auth/**'] })
	await approved(
		paths,
		'session-ui-m3q8',
		{ files: ['src/ui/**'], dependsOn: ['auth-api-k7f2'] },
		queue,
	)
	process.env.FAKE_HOST_COMMIT = 'src/auth/api.ts'
	await dispatch(paths, 'auth-api-k7f2', { base: 'main' })
}

test('accepting an upstream node starts the queued node it just made ready', async () => {
	const paths = await board()
	await chain(paths, true)

	await acceptWork(paths, 'auth-api-k7f2', { by: 'Alice', base: 'main', scan: 'clean' })
	const queued = await runQueue(paths, 'main')

	expect(queued.started).toEqual(['session-ui-m3q8'])
	expect(queued.dispatched[0]).toMatchObject({ exit: 'finished' })
	expect(queued.held).toEqual([])
})

test('a node approved without the queue is never started unattended', async () => {
	const paths = await board()
	await chain(paths, false)

	await acceptWork(paths, 'auth-api-k7f2', { by: 'Alice', base: 'main', scan: 'clean' })
	const queued = await runQueue(paths, 'main')

	expect(queued.started).toEqual([])
	expect(queued.dispatched).toEqual([])
})

test('answering a decision drains the queue too — it is the other thing that frees a node', async () => {
	const paths = await board()
	await writeDecision(paths, 'where-tokens-live-a1b2', {
		question: 'Where do tokens live?',
		category: 'state',
		options: [
			{ id: 'cookie', label: 'A cookie', reason: 'boring', costLater: 'none' },
			{ id: 'header', label: 'A header', reason: 'explicit', costLater: 'CORS' },
		],
		suggested: null,
		answer: null,
		createdAt: '2026-09-05T00:00:00.000Z',
	})
	await approved(paths, 'auth-api-k7f2', { decisions: ['where-tokens-live-a1b2'] }, true)

	expect((await runQueue(paths, 'main')).started).toEqual([])

	await answerDecision(paths, 'where-tokens-live-a1b2', {
		option: 'cookie',
		rationale: 'it is boring',
		by: 'Alice',
	})
	expect((await runQueue(paths, 'main')).started).toEqual(['auth-api-k7f2'])
})

test('a queued node heading for an active node’s files waits for a human instead', async () => {
	const paths = await board()
	await approved(paths, 'auth-api-k7f2', { files: ['src/auth/**'] }, true)
	await approved(paths, 'session-ui-m3q8', { files: ['src/auth/session.ts'] })
	await claimNode(paths, 'session-ui-m3q8', 'Bob')

	const queued = await runQueue(paths, 'main')

	expect(queued.started).toEqual([])
	expect(queued.held).toEqual([
		{ id: 'auth-api-k7f2', why: expect.stringContaining('session-ui-m3q8') },
	])
})

test('two queued nodes heading for each other’s files hold each other, and neither runs', async () => {
	const paths = await board()
	await approved(paths, 'auth-api-k7f2', { files: ['src/auth/**'] }, true)
	await approved(paths, 'session-ui-m3q8', { files: ['src/auth/session.ts'] }, true)

	const queued = await runQueue(paths, 'main')

	expect(queued.started).toEqual([])
	expect(queued.held.map((one) => one.id)).toEqual(['auth-api-k7f2', 'session-ui-m3q8'])
})

test('the chain stops at a rejection: a node turned down is not started again by the queue', async () => {
	const paths = await board()
	await approved(paths, 'auth-api-k7f2', { files: ['src/auth/**'] }, true)
	process.env.FAKE_HOST_COMMIT = 'src/auth/api.ts'

	expect((await runQueue(paths, 'main')).started).toEqual(['auth-api-k7f2'])
	await rejectWork(paths, 'auth-api-k7f2', { by: 'Alice', text: 'the middleware is missing' })

	// It is `ready` again and still queued, and the human is the one who runs it.
	expect((await runQueue(paths, 'main')).started).toEqual([])
})

test('the chain stops at a failure: a node whose run failed is not started again', async () => {
	const paths = await board()
	await approved(paths, 'auth-api-k7f2', { files: ['src/auth/**'] }, true)
	process.env.FAKE_HOST_FAIL = '1'

	const first = await runQueue(paths, 'main')
	expect(first.started).toEqual(['auth-api-k7f2'])
	expect(first.dispatched[0]).toMatchObject({ exit: 'failed' })

	delete process.env.FAKE_HOST_FAIL
	expect((await runQueue(paths, 'main')).started).toEqual([])
})

test('a queue with nothing in it costs nothing and says nothing', async () => {
	const paths = await board()
	await approved(paths, 'auth-api-k7f2', { files: ['src/auth/**'] })

	const queued = await runQueue(paths, 'main')
	expect(queued).toEqual({ started: [], dispatched: [], held: [] })
})

test('a queued node that cannot start is reported, not thrown', async () => {
	const paths = await board()
	await approved(paths, 'auth-api-k7f2', { files: ['src/auth/**'] }, true)
	writeFileSync(
		paths.config,
		setSetting(readFileSync(paths.config, 'utf8'), ['dispatch', 'host'], 'no-such-host-binary'),
	)
	repo?.git('commit', '-q', '-am', 'chore: a host that is not there')

	const queued = await runQueue(paths, 'main')
	expect(queued.started).toEqual(['auth-api-k7f2'])
	expect(queued.dispatched[0]).toBeInstanceOf(SoberError)
})

test('a node someone else has claimed is theirs to start, not the queue’s', async () => {
	const paths = await board()
	await approved(paths, 'auth-api-k7f2', { files: ['src/auth/**'] }, true)
	await claimNode(paths, 'auth-api-k7f2', 'Bob')

	const queued = await runQueue(paths, 'main')

	expect(queued.started).toEqual([])
	expect(queued.held).toEqual([{ id: 'auth-api-k7f2', why: expect.stringContaining('Bob') }])
})

test('your own claim on a queued node does not stop it — it is yours already', async () => {
	const paths = await board()
	await approved(paths, 'auth-api-k7f2', { files: ['src/auth/**'] }, true)
	// The fixture's git user.name, which is what every surface attributes with.
	await claimNode(paths, 'auth-api-k7f2', 'SOBER Test')

	expect((await runQueue(paths, 'main')).started).toEqual(['auth-api-k7f2'])
})
