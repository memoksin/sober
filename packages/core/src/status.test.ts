import type { Answer, Approval, Node, Run } from '@besober/schema'
import { expect, test } from 'vitest'
import type { Board } from './graph.js'
import type { Feedback } from './local.js'
import { aDecision, aNode, aRun } from './records.fixture.js'
import { flagsOf, ready, statusOf, waitingOn } from './status.js'

const AT = '2026-09-04T00:00:00.000Z'
const answer: Answer = {
	option: 'cookie',
	rationale: 'Simplest',
	by: 'memoksin',
	at: AT,
	derived: null,
}
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
		accepted: { by: 'memoksin', at: AT, flagged: false, scan: 'clean', audit: 'passed' },
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
	expect(flagsOf(board({ a: node }, { r1: failed }), 'a')).toEqual({
		lastRunFailed: true,
		flagged: false,
	})
	expect(flagsOf(board({ a: node }, { r1: stopped }), 'a')).toEqual({
		lastRunFailed: false,
		flagged: false,
	})
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
	const done = aNode({
		accepted: { by: 'memoksin', at: AT, flagged: false, scan: 'clean', audit: 'passed' },
	})
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
	const done = aNode({
		accepted: { by: 'memoksin', at: AT, flagged: false, scan: 'clean', audit: 'passed' },
	})
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

/**
 * DESIGN §2.8: the flag is not "a finished node whose decision changed" but
 * "a node whose bound decision changed after its brief was approved". The
 * broader definition is what catches the `in-review` node whose brief approval
 * was withdrawn under it — the case §2.8 records as having gone unnoticed.
 */
test('a bound decision answered after the brief was approved flags the node', () => {
	const after = '2026-09-04T01:00:00.000Z'
	const flagged = (at: string): Board => ({
		...board({ a: aNode({ brief: approved, decisions: ['auth-model-k7f2'] }) }),
		decisions: new Map([['auth-model-k7f2', aDecision({ answer: { ...answer, at } })]]),
	})

	expect(flagsOf(flagged(after), 'a').flagged).toBe(true)
	// Answered at the same moment the brief was approved is the ordinary order,
	// not a change: a brief is approved against the answers it was rendered from.
	expect(flagsOf(flagged(AT), 'a').flagged).toBe(false)
})

test('an unapproved brief cannot be stale, and neither can an unbound decision', () => {
	const after = '2026-09-04T01:00:00.000Z'
	const moved = new Map([['auth-model-k7f2', aDecision({ answer: { ...answer, at: after } })]])

	// Nothing was approved against this answer, so nothing was invalidated by it.
	const unapproved = {
		...board({ a: aNode({ decisions: ['auth-model-k7f2'] }) }),
		decisions: moved,
	}
	expect(flagsOf(unapproved, 'a').flagged).toBe(false)

	// The decision moved, but this node never bound it.
	const unbound = { ...board({ a: aNode({ brief: approved }) }), decisions: moved }
	expect(flagsOf(unbound, 'a').flagged).toBe(false)
})

/**
 * DESIGN §7.2: a dismissal is a judgement about the change as it stood, not a
 * mute button. §2.8's whole argument is about a change nothing on the board
 * knew about — so a *later* answer to the same decision is a second such
 * change, and it flags again. A dismissal that cleared the flag outright would
 * make the second change the silent one §2.8 exists to prevent.
 */
test('a dismissal settles the answer it was written against, and not the next one', () => {
	const dismissed = '2026-09-04T02:00:00.000Z'
	const withAnswerAt = (at: string): Board => ({
		...board({
			a: aNode({
				brief: approved,
				decisions: ['auth-model-k7f2'],
				dismissal: { by: 'memoksin', at: dismissed, reason: 'The endpoints do not read it.' },
			}),
		}),
		decisions: new Map([['auth-model-k7f2', aDecision({ answer: { ...answer, at } })]]),
	})

	// The change that was dismissed.
	expect(flagsOf(withAnswerAt('2026-09-04T01:00:00.000Z'), 'a').flagged).toBe(false)
	// A change after the dismissal is a change nobody has judged yet.
	expect(flagsOf(withAnswerAt('2026-09-04T03:00:00.000Z'), 'a').flagged).toBe(true)
})

/**
 * The watermark is the later of the two, not the dismissal alone. §2.8's first
 * row withdraws brief approval and the brief is approved again; an approval
 * after a dismissal is the newer statement about what this node was built
 * against.
 */
test('a brief re-approved after a dismissal is what the flag is measured from', () => {
	const node = aNode({
		brief: { ...approved, approval: { ...approval, at: '2026-09-04T04:00:00.000Z' } },
		decisions: ['auth-model-k7f2'],
		dismissal: { by: 'memoksin', at: '2026-09-04T02:00:00.000Z', reason: 'Fine as it is.' },
	})
	const moved = (at: string): Board => ({
		...board({ a: node }),
		decisions: new Map([['auth-model-k7f2', aDecision({ answer: { ...answer, at } })]]),
	})

	expect(flagsOf(moved('2026-09-04T03:00:00.000Z'), 'a').flagged).toBe(false)
	expect(flagsOf(moved('2026-09-04T05:00:00.000Z'), 'a').flagged).toBe(true)
})
