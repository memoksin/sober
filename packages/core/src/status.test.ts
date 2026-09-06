import type { Answer, Approval, Node, Run } from '@besober/schema'
import { expect, test } from 'vitest'
import type { Board } from './graph.js'
import type { Feedback } from './local.js'
import { aDecision, aNode, aRun } from './records.fixture.js'
import { flagsOf, ready, statusOf, waitingOn } from './status.js'

const AT = '2026-09-04T00:00:00.000Z'
const answer: Answer = { option: 'cookie', rationale: 'Simplest', by: 'memoksin', at: AT }
const approval: Approval = { by: 'memoksin', at: AT, queue: false }
const approved = {
	approach: 'Write the endpoints, then the middleware.',
	acceptance: [{ run: 'pnpm test', proves: 'The endpoints answer.' }],
	approval,
}

const board = (
	nodes: Record<string, Node>,
	runs: Record<string, Run> = {},
	answered = true,
	feedback: Record<string, Feedback> = {},
): Board => ({
	project: null,
	nodes: new Map(Object.entries(nodes)),
	decisions: new Map([['auth-model-k7f2', aDecision(answered ? { answer } : {})]]),
	archivedDecisions: new Set(),
	runs: new Map(Object.entries(runs)),
	feedback: new Map(Object.entries(feedback)),
	broken: [],
})

test('accepted is done, and nothing outranks it', () => {
	const node = aNode({
		accepted: { by: 'memoksin', at: AT, flagged: false, scan: 'clean' },
		dependsOn: ['missing-node-x9y8'],
	})

	expect(statusOf(board({ a: node }), 'a')).toBe('done')
})

test('a run in flight is running, and a finished one waits for a human', () => {
	const node = aNode({ brief: approved })

	expect(statusOf(board({ a: node }, { r1: aRun('a') }), 'a')).toBe('running')
	expect(
		statusOf(board({ a: node }, { r1: aRun('a', { endedAt: AT, exit: 'finished' }) }), 'a'),
	).toBe('in-review')
})

test('a stopped or failed run does not enter the review queue', () => {
	const node = aNode({ brief: approved })
	const stopped = aRun('a', { endedAt: AT, exit: 'stopped' })
	const failed = aRun('a', { endedAt: AT, exit: 'failed', error: 'the host died' })

	expect(statusOf(board({ a: node }, { r1: stopped }), 'a')).toBe('ready')
	expect(statusOf(board({ a: node }, { r1: failed }), 'a')).toBe('ready')
	expect(flagsOf(board({ a: node }, { r1: failed }), 'a')).toEqual({ lastRunFailed: true })
	expect(flagsOf(board({ a: node }, { r1: stopped }), 'a')).toEqual({ lastRunFailed: false })
})

test('the last run started is the one that decides', () => {
	const node = aNode({ brief: approved })
	const runs = {
		r1: aRun('a', { endedAt: AT, exit: 'failed', error: 'crashed' }),
		r2: aRun('a', { startedAt: '2026-09-04T01:00:00.000Z' }),
	}

	expect(statusOf(board({ a: node }, runs), 'a')).toBe('running')
	expect(flagsOf(board({ a: node }, runs), 'a').lastRunFailed).toBe(false)
})

test('an unfinished dependency blocks, and blocked outranks held', () => {
	const nodes = {
		up: aNode(),
		down: aNode({ dependsOn: ['up'], decisions: ['auth-model-k7f2'] }),
	}

	expect(statusOf(board(nodes, {}, false), 'down')).toBe('blocked')
})

test('held is exactly when the upstream is finished and an answer is missing', () => {
	const done = aNode({ accepted: { by: 'memoksin', at: AT, flagged: false, scan: 'clean' } })
	const nodes = { up: done, down: aNode({ dependsOn: ['up'], decisions: ['auth-model-k7f2'] }) }

	expect(statusOf(board(nodes, {}, false), 'down')).toBe('held')
	expect(statusOf(board(nodes, {}, true), 'down')).toBe('needs-brief')
})

test('a decision the board does not hold cannot have been answered', () => {
	const node = aNode({ decisions: ['gone-dec-x9y8'] })

	expect(statusOf(board({ a: node }), 'a')).toBe('held')
})

test('a brief is not enough — an unapproved one still needs approval', () => {
	const unapproved = aNode({ brief: { ...approved, approval: null } })

	expect(statusOf(board({ a: unapproved }), 'a')).toBe('needs-approval')
	expect(statusOf(board({ a: aNode({ brief: approved }) }), 'a')).toBe('ready')
})

test('a written brief and no brief at all are two different waits', () => {
	const none = aNode({ brief: null })
	const written = aNode({ brief: { ...approved, approval: null } })

	expect(statusOf(board({ a: none }), 'a')).toBe('needs-brief')
	expect(statusOf(board({ a: written }), 'a')).toBe('needs-approval')
})

test('ready lists what can start now, and nothing else', () => {
	const nodes = {
		'a-node-a1b2': aNode({ brief: approved }),
		'b-node-b3c4': aNode({ brief: null }),
		'c-node-c5d6': aNode({ brief: approved, dependsOn: ['b-node-b3c4'] }),
	}

	expect(ready(board(nodes))).toEqual(['a-node-a1b2'])
})

test('a node the board does not hold has no status', () => {
	expect(statusOf(board({}), 'gone-node-x9y8')).toBe(null)
})

test('a rejection takes the node back out of the review queue', () => {
	// The run still says `finished`; what changed is that a human answered it.
	// No field on the run to forget to set (§6.4).
	const node = aNode({ decisions: ['auth-model-k7f2'], brief: approved })
	const run = aRun('auth-api-k7f2', { exit: 'finished', endedAt: AT })
	const feedback: Feedback = {
		at: '2026-09-04T01:00:00.000Z',
		by: 'memoksin',
		text: 'The endpoints answer, but nothing checks the session.',
		clean: false,
	}

	const reviewing = board({ 'auth-api-k7f2': node }, { 'auth-api-k7f2-r1': run })
	expect(statusOf(reviewing, 'auth-api-k7f2')).toBe('in-review')

	const rejected = board({ 'auth-api-k7f2': node }, { 'auth-api-k7f2-r1': run }, true, {
		'auth-api-k7f2': feedback,
	})
	expect(statusOf(rejected, 'auth-api-k7f2')).toBe('ready')
})

test('feedback older than the run answers an earlier attempt, not this one', () => {
	const node = aNode({ decisions: ['auth-model-k7f2'], brief: approved })
	const run = aRun('auth-api-k7f2', { exit: 'finished', endedAt: '2026-09-04T02:00:00.000Z' })
	const stale: Feedback = { at: AT, by: 'memoksin', text: 'the first attempt', clean: false }

	const reviewing = board({ 'auth-api-k7f2': node }, { 'auth-api-k7f2-r1': run }, true, {
		'auth-api-k7f2': stale,
	})
	expect(statusOf(reviewing, 'auth-api-k7f2')).toBe('in-review')
})

test('a held node is waiting on the decisions nobody has answered', () => {
	const node = aNode({ decisions: ['auth-model-k7f2'], brief: approved })

	expect(waitingOn(board({ a: node }, {}, false), 'a')).toEqual([
		{ kind: 'decision', id: 'auth-model-k7f2', archived: false },
	])
})

test('a decision that was archived is still what the node waits on, and says so', () => {
	// It is not in the open list, so without the flag the panel says "waiting on
	// auth-model-k7f2" and nothing on the board ever offers to answer it.
	const held = {
		...board({ a: aNode({ decisions: ['auth-model-k7f2'] }) }, {}, false),
		archivedDecisions: new Set(['auth-model-k7f2']),
	}

	expect(waitingOn(held, 'a')).toEqual([
		{ kind: 'decision', id: 'auth-model-k7f2', archived: true },
	])
})

test('a blocked node is waiting on the upstream nodes that are not accepted', () => {
	const done = aNode({ accepted: { by: 'memoksin', at: AT, flagged: false, scan: 'clean' } })
	const node = aNode({ dependsOn: ['b', 'c'] })

	expect(waitingOn(board({ a: node, b: done, c: aNode({}) }), 'a')).toEqual([
		{ kind: 'node', id: 'c', archived: false },
	])
})

test('decisions outrank dependencies, the way blocked outranks held does not', () => {
	// `statusOf` reports `blocked` first, but a node held by both is waiting on
	// both — and the decision is the one a human can act on right now.
	const node = aNode({ decisions: ['auth-model-k7f2'], dependsOn: ['b'] })

	expect(waitingOn(board({ a: node, b: aNode({}) }, {}, false), 'a')).toEqual([
		{ kind: 'decision', id: 'auth-model-k7f2', archived: false },
		{ kind: 'node', id: 'b', archived: false },
	])
})

test('a node waiting on nothing is waiting on nothing, and a missing one too', () => {
	expect(waitingOn(board({ a: aNode({ brief: approved }) }), 'a')).toEqual([])
	expect(waitingOn(board({}), 'nobody')).toEqual([])
})
