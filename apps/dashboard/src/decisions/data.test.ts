import { expect, test } from 'vitest'
import type { BoardRead } from '../panel/data.js'
import { askingBody, bindable, decisionRows, waiting } from './data.js'

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

test('an unopened decision says it waits for options from a session, not for an answer', () => {
	const rows = decisionRows(
		board(
			[decision('u', { options: null }), decision('o', {})],
			[{ id: 'n1', title: 'N', decisions: ['u', 'o'] }],
		),
	)
	const said = Object.fromEntries(rows.map((row) => [row.id, waiting(row)]))
	expect(said.u).toContain('No options yet')
	expect(said.u).toContain('/sober:decide')
	expect(said.o).toBe('Unanswered · holds 1 node')
})

test('a done node is not offered to hold a new decision', () => {
	const read = board(
		[],
		[
			{ id: 'n1', title: 'Open', status: 'ready', decisions: [] },
			{ id: 'n2', title: 'Done', status: 'done', decisions: [] },
		],
	)
	expect(bindable(read)).toEqual([{ id: 'n1', title: 'Open' }])
})

test('the create_decision body is the trimmed question, its category and each node once', () => {
	expect(
		askingBody({ question: '  Where? ', category: 'data-flow', binds: ['n1', 'n2', 'n1'] }),
	).toEqual({ question: 'Where?', category: 'data-flow', binds: ['n1', 'n2'] })
})

test('the form sends nothing without a question or a node to hold', () => {
	expect(askingBody({ question: '   ', category: 'state', binds: ['n1'] })).toBeNull()
	expect(askingBody({ question: 'Where?', category: 'state', binds: [] })).toBeNull()
})
