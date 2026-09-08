import type { Approval, Node } from '@besober/schema'
import { expect, test } from 'vitest'
import type { Board } from './graph.js'
import { queued } from './queue.js'
import { aNode, aRun } from './records.fixture.js'

const AT = '2026-09-04T00:00:00.000Z'

const approved = (approval: Approval) => ({
	approach: 'Write the endpoints, then the middleware.',
	acceptance: [{ run: 'pnpm test', proves: 'The endpoints answer.' }],
	approval,
})

const ready = (queue: boolean, overrides: Partial<Node> = {}): Node =>
	aNode({ brief: approved({ by: 'memoksin', at: AT, queue }), ...overrides })

const board = (nodes: Record<string, Node>, runs: Record<string, ReturnType<typeof aRun>> = {}) =>
	({
		project: null,
		nodes: new Map(Object.entries(nodes)),
		decisions: new Map(),
		archivedDecisions: new Set(),
		runs: new Map(Object.entries(runs)),
		feedback: new Map(),
		broken: [],
	}) satisfies Board

/**
 * ADR 0056. `ready` already means approved, so the flag is not a second
 * permission — it is the difference between "start now", which a human is
 * watching, and "start later without asking", which nobody is. A node approved
 * with `queue: false` that never started was approved for attended work.
 */
test('an unattended dispatcher takes a queued ready node and leaves a flagless one for its approver', () => {
	expect(queued(board({ a: ready(true), b: ready(false) }))).toEqual(['a'])
})

/**
 * ADR 0056's third answer, which is the `lastRun === null` condition: a failed
 * run leaves the node ready, and so does one a human turned down. Retrying
 * either unattended repeats a failure or builds on a refused result.
 */
test('a node that has already run is never taken again, however it ended', () => {
	const runs = {
		r1: aRun('a', { endedAt: AT, exit: 'failed', error: 'the host died' }),
		r2: aRun('b', { endedAt: AT, exit: 'stopped' }),
		r3: aRun('c', { endedAt: AT, exit: 'finished' }),
	}

	expect(queued(board({ a: ready(true), b: ready(true), c: ready(true) }, runs))).toEqual([])
})

test('a node still waiting on a dependency or an unanswered decision is not ready, so it is not taken', () => {
	const waiting = ready(true, { dependsOn: ['upstream-node-x9y8'] })
	const held = ready(true, { decisions: ['auth-model-k7f2'] })

	expect(queued(board({ a: waiting, b: held }))).toEqual([])
})

test('an unapproved brief is needs-approval, not ready, so the flag cannot exist without the approval', () => {
	const unapproved = aNode({
		brief: { approach: 'Something.', acceptance: [], approval: null },
	})

	expect(queued(board({ a: unapproved, b: aNode({}) }))).toEqual([])
})
