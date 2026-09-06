import type { Answer, Approval, Node } from '@besober/schema'
import { expect, test } from 'vitest'
import { snapshot } from './digest.js'
import type { Board } from './graph.js'
import { aDecision, aNode, aRun } from './records.fixture.js'

const AT = '2026-09-04T00:00:00.000Z'
const LATER = '2026-09-04T01:00:00.000Z'
const answer: Answer = { option: 'cookie', rationale: 'Simplest', by: 'memoksin', at: AT }
const approval: Approval = { by: 'memoksin', at: AT, queue: false }
const approved = {
	approach: 'Write the endpoints, then the middleware.',
	acceptance: [{ run: 'pnpm test', proves: 'The endpoints answer.' }],
	approval,
}

const board = (nodes: Record<string, Node>, answeredAt = AT): Board => ({
	project: null,
	nodes: new Map(Object.entries(nodes)),
	decisions: new Map([['auth-model-k7f2', aDecision({ answer: { ...answer, at: answeredAt } })]]),
	archivedDecisions: new Set(),
	runs: new Map([['r1', aRun('a', { endedAt: AT, exit: 'finished' })]]),
	feedback: new Map(),
	broken: [],
})

/**
 * DESIGN §7.1: the snapshot half asks the board what is true right now. No
 * fetch, no delta, and no remote — which is why it is the half that answers for
 * the single user whose three agents were running when the board closed.
 */
test('the results waiting for review are the nodes in review', () => {
	const finished = aNode({ brief: approved })

	expect(snapshot(board({ a: finished, b: aNode({}) }))).toEqual({ inReview: ['a'], flagged: [] })
})

test('a node whose bound decision moved after approval is flagged', () => {
	const held = aNode({ brief: approved, decisions: ['auth-model-k7f2'] })

	expect(snapshot(board({ b: held }, LATER)).flagged).toEqual(['b'])
})

test('both halves are sorted, so two machines say the same sentence', () => {
	const stale = (): Node => aNode({ brief: approved, decisions: ['auth-model-k7f2'] })

	expect(snapshot(board({ c: stale(), b: stale(), a: stale() }, LATER)).flagged).toEqual([
		'a',
		'b',
		'c',
	])
})

test('an empty board says nothing rather than failing', () => {
	expect(snapshot(board({}))).toEqual({ inReview: [], flagged: [] })
})
