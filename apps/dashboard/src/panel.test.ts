import { expect, test } from 'vitest'
import type { BoardRead } from './panel.js'
import { held, offer } from './panel.js'

const AT = '2026-09-06T00:00:00.000Z'

const node = (id: string, over: Partial<BoardRead['nodes'][number]> = {}) => ({
	id,
	title: `Title of ${id}`,
	description: '',
	notes: '',
	dependsOn: [],
	decisions: [],
	files: [],
	brief: null,
	outcome: null,
	assignee: null,
	claim: null,
	accepted: null,
	createdAt: AT,
	status: 'ready' as const,
	waitingOn: [],
	...over,
})

const decision = (id: string, over: Partial<BoardRead['decisions'][number]> = {}) => ({
	id,
	category: 'state' as const,
	question: `Question of ${id}`,
	options: [
		{ id: 'cookie', label: 'Cookie', reason: 'No server state', costLater: 'Size limits' },
		{ id: 'redis', label: 'Redis', reason: 'Revocable', costLater: 'A service to run' },
	],
	suggested: null,
	answer: null,
	createdAt: AT,
	archived: false,
	...over,
})

const board = (
	nodes: BoardRead['nodes'],
	decisions: BoardRead['decisions'] = [],
): BoardRead => ({ project: null, nodes, decisions, broken: [] })

test('a wait is resolved to what a person reads, not to the id they were given', () => {
	// A panel that renders `auth-model-k7f2` has handed the reader the lookup
	// the board exists to do for them.
	const one = board(
		[node('a', { waitingOn: [{ kind: 'decision', id: 'd1', archived: false }] })],
		[decision('d1', { question: 'Where does session state live?' })],
	)

	expect(held(one, 'a')).toEqual([
		{ kind: 'decision', id: 'd1', label: 'Where does session state live?', gone: false },
	])
})

test('a node it waits on is named by its title', () => {
	const one = board([
		node('a', { waitingOn: [{ kind: 'node', id: 'b', archived: false }] }),
		node('b', { title: 'Session endpoints' }),
	])

	expect(held(one, 'a')).toEqual([
		{ kind: 'node', id: 'b', label: 'Session endpoints', gone: false },
	])
})

test('a wait on something the board does not hold is marked gone, never dropped', () => {
	// §8.4: one bad record does not take down a board. A panel that silently
	// drops the wait renders a node that is held by nothing and still not ready.
	const one = board([node('a', { waitingOn: [{ kind: 'node', id: 'ghost', archived: false }] })])

	expect(held(one, 'a')).toEqual([{ kind: 'node', id: 'ghost', label: 'ghost', gone: true }])
})

test('an archived decision is gone too — nothing on the board offers to answer it', () => {
	const one = board(
		[node('a', { waitingOn: [{ kind: 'decision', id: 'd1', archived: true }] })],
		[decision('d1', { archived: true })],
	)

	expect(held(one, 'a')[0]?.gone).toBe(true)
})

test('an open decision offers its options', () => {
	const open = offer(decision('d1'))

	expect(open.kind).toBe('open')
	expect(open.options).toHaveLength(2)
	expect(open.refusal).toBeNull()
})

test('an answered decision offers no options, and says why in the words the CLI uses', () => {
	// The CLI refuses this with a reason (`every brief built on it would have to
	// be withdrawn`). A screen that just greys the button out has replaced a
	// reason with a shrug.
	const answered = offer(
		decision('d1', { answer: { option: 'redis', rationale: 'We run one.', by: 'me', at: AT } }),
	)

	expect(answered.kind).toBe('answered')
	expect(answered.options).toEqual([])
	expect(answered.refusal).toContain('withdrawn')
})

test('a decision nobody has opened has nothing to choose between, and says so', () => {
	const unopened = offer(decision('d1', { options: null }))

	expect(unopened.kind).toBe('unopened')
	expect(unopened.options).toEqual([])
	expect(unopened.refusal).toContain('session')
})

test('the suggested option is marked, and no other one is', () => {
	const open = offer(decision('d1', { suggested: 'redis' }))

	expect(open.options.map((option) => option.suggested)).toEqual([false, true])
})
