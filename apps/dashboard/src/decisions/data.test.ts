import { expect, test } from 'vitest'
import type { BoardRead } from '../panel/data.js'
import { bindable, decisionRows, filterDecisionRows, questionBody, waitingLabel } from './data.js'

const options = [
	{ id: 'a', label: 'A', reason: 'ra', costLater: 'ca' },
	{ id: 'b', label: 'B', reason: 'rb', costLater: 'cb' },
]

const decision = (id: string, over: Record<string, unknown>) => ({
	id,
	archived: false,
	category: 'state' as const,
	question: `q ${id}`,
	options,
	suggested: null,
	derived: null,
	answer: null,
	createdAt: '2026-09-01T00:00:00.000Z',
	...over,
})

const answer = (option: string, derived: string | null = null) => ({
	option,
	rationale: 'because',
	by: 'alice',
	at: '2026-09-02T00:00:00.000Z',
	derived,
})

const board = (decisions: unknown[], nodes: unknown[] = []): BoardRead =>
	({ project: null, nodes, decisions, broken: [] }) as unknown as BoardRead

test('an archived decision is absent', () => {
	expect(decisionRows(board([decision('gone', { archived: true })]))).toEqual([])
})

test('an unopened decision is unopened, not open, and open ones sort first', () => {
	const rows = decisionRows(
		board([
			decision('u', { options: null }),
			decision('o', {}),
			decision('x', { answer: answer('a') }),
		]),
	)
	expect(rows.map((row) => [row.id, row.state])).toEqual([
		['o', 'open'],
		['u', 'unopened'],
		['x', 'answered'],
	])
})

test('the chosen option is found by id when the options are out of order, and derived survives', () => {
	const [row] = decisionRows(
		board([
			decision('d', { options: [options[1], options[0]], answer: answer('a', 'src/store.ts') }),
		]),
	)
	expect(row?.chosen?.label).toBe('A')
	expect(row?.notPicked.map((option) => option.id)).toEqual(['b'])
	expect(row?.answer?.derived).toBe('src/store.ts')
})

test('a decision no node binds still appears, with an empty node list', () => {
	const rows = decisionRows(
		board([decision('d', {})], [{ id: 'n1', title: 'N', decisions: ['other'] }]),
	)
	expect(rows[0]?.nodes).toEqual([])
})

test('filterDecisionRows selects the right rows for each filter', () => {
	const rows = decisionRows(
		board([
			decision('open', {}),
			decision('answered', { answer: answer('a') }),
			decision('derived', { answer: answer('a', 'src/store.ts') }),
		]),
	)

	expect(filterDecisionRows(rows, 'all').map((row) => row.id)).toEqual([
		'open',
		'answered',
		'derived',
	])
	expect(filterDecisionRows(rows, 'open').map((row) => row.id)).toEqual(['open'])
	expect(filterDecisionRows(rows, 'answered').map((row) => row.id)).toEqual(['answered', 'derived'])
	expect(filterDecisionRows(rows, 'derived').map((row) => row.id)).toEqual(['derived'])
})

test('filterDecisionRows keeps the answer source on derived rows', () => {
	const rows = decisionRows(board([decision('d', { answer: answer('a', 'src/store.ts') })]))
	const [row] = filterDecisionRows(rows, 'derived')
	expect(row?.answer?.derived).toBe('src/store.ts')
})

test('an unopened decision says it waits for options from a session, not for an answer', () => {
	const rows = decisionRows(
		board(
			[decision('u', { options: null }), decision('o', {})],
			[{ id: 'n1', title: 'N', decisions: ['u', 'o'] }],
		),
	)
	const label = Object.fromEntries(rows.map((row) => [row.id, waitingLabel(row)]))
	expect(label.u).toBe('No options yet — a session produces them (/sober:decide) · holds 1 node')
	expect(label.o).toBe('Unanswered · holds 1 node')
})

test('a new question can hold any node that is not done', () => {
	const nodes = [
		{ id: 'n1', title: 'One', status: 'ready', decisions: [] },
		{ id: 'n2', title: 'Two', status: 'done', decisions: [] },
		{ id: 'n3', title: 'Three', status: 'held', decisions: [] },
	]
	expect(bindable(board([], nodes)).map((node) => node.id)).toEqual(['n1', 'n3'])
})

test('the create_decision body is trimmed and deduplicated, and withheld until it can be sent', () => {
	expect(
		questionBody({ question: '  Where?  ', category: 'data-flow', binds: ['n1', 'n3', 'n1'] }),
	).toEqual({ question: 'Where?', category: 'data-flow', binds: ['n1', 'n3'] })
	expect(questionBody({ question: '   ', category: 'state', binds: ['n1'] })).toBeNull()
	expect(questionBody({ question: 'Where?', category: 'state', binds: [] })).toBeNull()
})
