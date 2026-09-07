import type { Answer } from '@besober/schema'
import { beforeEach, expect, test } from 'vitest'
import { archiveDecision, archiveNode, deleteDecision, deleteNode, restoreNode } from './archive.js'
import { initBoard } from './board.js'
import { AnsweredDecisionError, NotOnBoardError, StillReferencedError } from './errors.js'
import { loadBoard } from './graph.js'
import type { Paths } from './paths.js'
import { aDecision, aNode } from './records.fixture.js'
import { readArchivedNodes, writeDecision, writeNode } from './records.js'
import { statusOf } from './status.js'
import { tmpRoot } from './tmp.fixture.js'

const AT = '2026-09-04T00:00:00.000Z'
const answer: Answer = { option: 'redis', rationale: 'We run one.', by: 'memoksin', at: AT }

let paths: Paths

beforeEach(async () => {
	const root = await tmpRoot('sober-archive-')
	paths = (await initBoard(root, { title: 'Acme', intent: 'ship', constraints: [] })).paths
})

test('a node archives and comes back', async () => {
	await writeNode(paths, 'auth-api-k7f2', aNode({ title: 'Session endpoints' }))

	await archiveNode(paths, 'auth-api-k7f2')
	expect((await loadBoard(paths)).nodes.size).toBe(0)
	expect([...(await readArchivedNodes(paths)).records.keys()]).toEqual(['auth-api-k7f2'])

	await restoreNode(paths, 'auth-api-k7f2')
	expect((await loadBoard(paths)).nodes.get('auth-api-k7f2')?.title).toBe('Session endpoints')
})

test('archiving a referenced node is allowed — it is how a referenced node is removed', async () => {
	await writeNode(paths, 'db-schema-m3q8', aNode())
	await writeNode(paths, 'auth-api-k7f2', aNode({ dependsOn: ['db-schema-m3q8'] }))

	await expect(archiveNode(paths, 'db-schema-m3q8')).resolves.toBeUndefined()
})

test('deleting a referenced node is refused, and the referencing nodes are named', async () => {
	await writeNode(paths, 'db-schema-m3q8', aNode())
	await writeNode(paths, 'auth-api-k7f2', aNode({ dependsOn: ['db-schema-m3q8'] }))

	await expect(deleteNode(paths, 'db-schema-m3q8')).rejects.toBeInstanceOf(StillReferencedError)
	await expect(deleteNode(paths, 'db-schema-m3q8')).rejects.toThrow(/auth-api-k7f2/)

	await expect(deleteNode(paths, 'auth-api-k7f2')).resolves.toBeUndefined()
	await expect(deleteNode(paths, 'gone-node-x9y8')).rejects.toBeInstanceOf(NotOnBoardError)
})

test('an answered decision archives, never deletes, and its nodes keep reading it', async () => {
	await writeDecision(paths, 'auth-model-k7f2', aDecision({ answer }))
	await writeNode(paths, 'auth-api-k7f2', aNode({ decisions: ['auth-model-k7f2'], brief: null }))

	await expect(deleteDecision(paths, 'auth-model-k7f2')).rejects.toBeInstanceOf(
		AnsweredDecisionError,
	)

	await archiveDecision(paths, 'auth-model-k7f2')
	const board = await loadBoard(paths)

	expect(board.decisions.get('auth-model-k7f2')?.answer?.option).toBe('redis')
	// Archiving does not re-gate anything: the node stays answered (§8.3).
	expect(statusOf(board, 'auth-api-k7f2')).toBe('needs-brief')
})

test('an unanswered decision nothing binds is deletable, a bound one is not', async () => {
	await writeDecision(paths, 'draft-dec-a1b2', aDecision())
	await writeDecision(paths, 'bound-dec-c3d4', aDecision())
	await writeNode(paths, 'auth-api-k7f2', aNode({ decisions: ['bound-dec-c3d4'] }))

	await expect(deleteDecision(paths, 'draft-dec-a1b2')).resolves.toBeUndefined()
	await expect(deleteDecision(paths, 'bound-dec-c3d4')).rejects.toThrow(/auth-api-k7f2/)
})
