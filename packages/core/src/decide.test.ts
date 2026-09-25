import { decisionState } from '@besober/schema'
import { beforeEach, expect, test } from 'vitest'
import { initBoard } from './board.js'
import { answerDecision, approveBrief, createDecision } from './decide.js'
import { loadBoard } from './graph.js'
import { editDecision } from './impact.js'
import { readLog } from './local.js'
import type { Paths } from './paths.js'
import { aDecision, aNode } from './records.fixture.js'
import { readDecision, readNode, writeDecision, writeNode } from './records.js'
import { statusOf } from './status.js'
import { tmpRoot } from './tmp.fixture.js'

let paths: Paths

beforeEach(async () => {
	const root = await tmpRoot('sober-decide-')
	paths = (await initBoard(root, { title: 'Acme', intent: '', constraints: [] })).paths
})

const answerOf = async (id: string) => {
	const record = await readDecision(paths, id)
	return record.kind === 'ok' ? record.value.answer : null
}

/**
 * ADR 0055. The provenance is on the decision because whoever answers is
 * usually not whoever opened it — so it has to survive the gap between the two,
 * and the only thing that spans it is the record.
 */
test('an answer carries where the options were read from, when they were read off the repository', async () => {
	await writeDecision(paths, 'auth-model-k7f2', aDecision({ derived: 'docs/adr/0012-state.md' }))

	await answerDecision(paths, 'auth-model-k7f2', { option: 'redis', by: 'memoksin' })

	expect(await answerOf('auth-model-k7f2')).toMatchObject({
		option: 'redis',
		derived: 'docs/adr/0012-state.md',
	})
})

test('a decision nobody derived answers with no provenance rather than an empty one', async () => {
	await writeDecision(paths, 'auth-model-k7f2', aDecision({}))

	await answerDecision(paths, 'auth-model-k7f2', { option: 'redis', by: 'memoksin' })

	expect((await answerOf('auth-model-k7f2'))?.derived).toBeNull()
})

test('an edit drops the provenance — it is a person changing their mind, not a reading of the code', async () => {
	await writeDecision(paths, 'auth-model-k7f2', aDecision({ derived: 'docs/adr/0012-state.md' }))
	await answerDecision(paths, 'auth-model-k7f2', { option: 'redis', by: 'memoksin' })

	await editDecision(paths, 'auth-model-k7f2', {
		option: 'cookie',
		by: 'memoksin',
		anyway: true,
	})

	expect(await answerOf('auth-model-k7f2')).toMatchObject({ option: 'cookie', derived: null })
})

const briefed = aNode({
	brief: {
		approach: 'Endpoints first.',
		complexity: null,
		acceptance: [{ run: 'pnpm test', proves: 'They answer.' }],
		approval: null,
	},
})

const approvalOf = async (id: string) => {
	const record = await readNode(paths, id)
	return record.kind === 'ok' ? record.value.brief?.approval : null
}

test('an attended approval is written exactly as before: no provenance field at all', async () => {
	await writeNode(paths, 'auth-api-k7f2', briefed)

	await approveBrief(paths, 'auth-api-k7f2', { by: 'memoksin', queue: false })

	expect(await approvalOf('auth-api-k7f2')).toEqual({
		by: 'memoksin',
		at: expect.any(String),
		queue: false,
	})
})

test('a guard that refuses under the lock writes nothing', async () => {
	await writeNode(paths, 'auth-api-k7f2', briefed)

	await expect(
		approveBrief(paths, 'auth-api-k7f2', {
			by: 'memoksin',
			guard: () => Promise.reject(new Error('changed underneath')),
		}),
	).rejects.toThrow('changed underneath')
	expect(await approvalOf('auth-api-k7f2')).toBeNull()
})

test('a decision opened by hand arrives unopened, and every node it binds reads held', async () => {
	await writeNode(paths, 'auth-api-k7f2', aNode({ decisions: ['older-q-aaaa'] }))
	await writeNode(paths, 'auth-ui-m3p1', aNode())
	await writeNode(paths, 'bystander-x9x9', aNode())

	const { id } = await createDecision(paths, {
		question: '  Where does session state live?  ',
		category: 'state',
		binds: ['auth-api-k7f2', 'auth-ui-m3p1', 'auth-api-k7f2'],
		by: 'memoksin',
	})

	const board = await loadBoard(paths)
	const decision = board.decisions.get(id)
	expect(decision && decisionState(decision)).toBe('unopened')
	expect(decision?.question).toBe('Where does session state live?')
	expect(board.nodes.get('auth-api-k7f2')?.decisions).toEqual(['older-q-aaaa', id])
	expect(board.nodes.get('auth-ui-m3p1')?.decisions).toEqual([id])
	expect(statusOf(board, 'auth-ui-m3p1')).toBe('held')
	expect(statusOf(board, 'bystander-x9x9')).not.toBe('held')
	expect((await readLog(paths)).events.at(-1)).toMatchObject({
		action: 'decision.created',
		decision: id,
		by: 'memoksin',
		binds: ['auth-api-k7f2', 'auth-ui-m3p1'],
	})
})

test.each([
	['an empty question', { question: '   ', binds: ['auth-api-k7f2'] }, 'no-question'],
	['an empty bind list', { question: 'Where?', binds: [] }, 'binds-nothing'],
	[
		'an unknown node',
		{ question: 'Where?', binds: ['auth-api-k7f2', 'gone-zzzz'] },
		'not-on-board',
	],
])('%s is refused and writes nothing', async (_, input, code) => {
	await writeNode(paths, 'auth-api-k7f2', aNode())

	await expect(
		createDecision(paths, { ...input, category: 'state', by: 'memoksin' }),
	).rejects.toMatchObject({ code })

	const board = await loadBoard(paths)
	expect(board.decisions.size).toBe(0)
	expect(board.nodes.get('auth-api-k7f2')?.decisions).toEqual([])
})
