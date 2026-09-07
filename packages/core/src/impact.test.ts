import type { Answer, Approval, Node, Run } from '@besober/schema'
import { beforeEach, describe, expect, test } from 'vitest'
import { initBoard } from './board.js'
import { NotOnBoardError } from './errors.js'
import type { Board } from './graph.js'
import { loadBoard } from './graph.js'
import { editDecision, ImpactError, impactOf } from './impact.js'
import { readLog } from './local.js'
import type { Paths } from './paths.js'
import { aDecision, aNode, aRun } from './records.fixture.js'
import { readDecision, readNode, writeDecision, writeNode } from './records.js'
import { flagsOf, statusOf } from './status.js'
import { tmpRoot } from './tmp.fixture.js'

const AT = '2026-09-04T00:00:00.000Z'
const answer: Answer = { option: 'cookie', rationale: 'Simplest', by: 'memoksin', at: AT }
const approval: Approval = { by: 'memoksin', at: AT, queue: false }
const approved = {
	approach: 'Write the endpoints, then the middleware.',
	acceptance: [{ run: 'pnpm test', proves: 'The endpoints answer.' }],
	approval,
}
const bound = (overrides: Partial<Node> = {}): Node =>
	aNode({ decisions: ['auth-model-k7f2'], brief: approved, ...overrides })

const board = (nodes: Record<string, Node>, runs: Record<string, Run> = {}): Board => ({
	project: null,
	nodes: new Map(Object.entries(nodes)),
	decisions: new Map([['auth-model-k7f2', aDecision({ answer })]]),
	archivedDecisions: new Set(),
	runs: new Map(Object.entries(runs)),
	feedback: new Map(),
	broken: [],
})

/**
 * DESIGN §2.8's three rows, read off the derived status rather than off a
 * second classification nobody else uses. The preview is what the save will do,
 * so the two are computed from one function — a preview that disagreed with the
 * save is the failure D19 exists to prevent.
 */
describe('what changing an answer reaches', () => {
	test('a node that has not started is re-briefed, and it is the only row that is written', () => {
		const impact = impactOf(
			board({ 'auth-ui-m3q8': bound({ title: 'The sign-in screen' }) }),
			'auth-model-k7f2',
		)

		expect(impact?.nodes).toEqual([
			{ id: 'auth-ui-m3q8', title: 'The sign-in screen', status: 'ready', effect: 'rebrief' },
		])
	})

	test('a running node is flagged and nothing stops — the preview is what lets a person stop it', () => {
		const running = board({ 'auth-api-k7f2': bound() }, { 'run-1': aRun('auth-api-k7f2') })

		expect(impactOf(running, 'auth-model-k7f2')?.nodes[0]).toMatchObject({
			status: 'running',
			effect: 'flag',
		})
	})

	test('an in-review node is flagged: the row whose absence let a changed answer be accepted', () => {
		const reviewing = board(
			{ 'auth-api-k7f2': bound() },
			{ 'run-1': aRun('auth-api-k7f2', { endedAt: AT, exit: 'finished' }) },
		)

		expect(impactOf(reviewing, 'auth-model-k7f2')?.nodes[0]).toMatchObject({
			status: 'in-review',
			effect: 'flag',
		})
	})

	test('a finished node is flagged and is not reopened', () => {
		const done = board({
			'auth-api-k7f2': bound({
				accepted: { by: 'memoksin', at: AT, flagged: false, scan: 'clean', audit: 'passed' },
			}),
		})

		expect(impactOf(done, 'auth-model-k7f2')?.nodes[0]).toMatchObject({
			status: 'done',
			effect: 'flag',
		})
	})

	test('a node whose brief was never approved is not in the preview — nothing about it changes', () => {
		const unapproved = board({
			'auth-ui-m3q8': aNode({ decisions: ['auth-model-k7f2'], brief: null }),
			'auth-cli-p4r7': aNode({
				decisions: ['auth-model-k7f2'],
				brief: { ...approved, approval: null },
			}),
		})

		expect(impactOf(unapproved, 'auth-model-k7f2')?.nodes).toEqual([])
	})

	test('a node bound to some other decision is not reached', () => {
		const elsewhere = board({ 'billing-x9y8': bound({ decisions: ['billing-model-x9y8'] }) })

		expect(impactOf(elsewhere, 'auth-model-k7f2')?.nodes).toEqual([])
	})

	test('a decision that is not on this board previews nothing, rather than an empty fan-out', () => {
		expect(impactOf(board({}), 'gone-x9y8')).toBeNull()
	})
})

describe('saving the change', () => {
	let paths: Paths

	beforeEach(async () => {
		const root = await tmpRoot('sober-impact-')
		paths = (await initBoard(root, { title: 'Acme', intent: '', constraints: [] })).paths
		await writeDecision(paths, 'auth-model-k7f2', aDecision({ answer }))
		await writeNode(paths, 'auth-ui-m3q8', bound({ title: 'The sign-in screen' }))
		await writeNode(
			paths,
			'auth-api-k7f2',
			bound({
				title: 'The auth API',
				accepted: { by: 'memoksin', at: AT, flagged: false, scan: 'clean', audit: 'passed' },
			}),
		)
	})

	const edit = (extra: Record<string, unknown> = {}) =>
		editDecision(paths, 'auth-model-k7f2', { option: 'redis', by: 'memoksin', ...extra })

	test('an edit with no confirmation refuses, carries the fan-out, and writes nothing', async () => {
		await expect(edit()).rejects.toThrow(ImpactError)

		const still = await readDecision(paths, 'auth-model-k7f2')
		expect(still.kind === 'ok' && still.value.answer?.option).toBe('cookie')
		const untouched = await readNode(paths, 'auth-ui-m3q8')
		expect(untouched.kind === 'ok' && untouched.value.brief?.approval).not.toBeNull()
	})

	test('the refusal carries what the second command will do, so it can be printed', async () => {
		const refused = await edit().catch((error: unknown) => error)

		expect(refused).toBeInstanceOf(ImpactError)
		expect((refused as ImpactError).impact.nodes).toHaveLength(2)
	})

	test('the confirmation is the flag, and then the answer moves', async () => {
		const decision = await edit({ anyway: true, rationale: 'Revocation turned out to matter.' })

		expect(decision.answer?.option).toBe('redis')
		expect(decision.answer?.rationale).toBe('Revocation turned out to matter.')
		expect(decision.answer?.at.localeCompare(AT)).toBe(1)
	})

	test('the node that had not started loses its brief and lands on needs-brief', async () => {
		await edit({ anyway: true })

		const node = await readNode(paths, 'auth-ui-m3q8')
		expect(node.kind === 'ok' && node.value.brief).toBeNull()
		expect(statusOf(await loadBoard(paths), 'auth-ui-m3q8')).toBe('needs-brief')
	})

	test('the finished node is written to by nothing, and its flag is derived', async () => {
		await edit({ anyway: true })

		const node = await readNode(paths, 'auth-api-k7f2')
		expect(node.kind === 'ok' && node.value.accepted).not.toBeNull()
		expect(node.kind === 'ok' && node.value.brief?.approval).not.toBeNull()
		expect(flagsOf(await loadBoard(paths), 'auth-api-k7f2').flagged).toBe(true)
	})

	test('a decision nobody has answered is not edited here — the first answer is `decide`', async () => {
		await writeDecision(paths, 'billing-model-x9y8', aDecision({}))

		await expect(
			editDecision(paths, 'billing-model-x9y8', {
				option: 'redis',
				by: 'memoksin',
				anyway: true,
			}),
		).rejects.toThrow('not been answered')
	})

	test('an option the decision does not offer is refused before anything is written', async () => {
		await expect(edit({ anyway: true, option: 'postgres' })).rejects.toThrow('no option')
	})

	test('a decision that is not on this board is refused', async () => {
		await expect(
			editDecision(paths, 'gone-x9y8', { option: 'redis', by: 'memoksin', anyway: true }),
		).rejects.toThrow(NotOnBoardError)
	})

	test('the edit is on the audit log — an irreversible fan-out says who asked for it', async () => {
		await edit({ anyway: true })

		expect((await readLog(paths)).events.map((event) => event.action)).toContain('decision.edited')
	})
})
