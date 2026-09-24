import { expect, test } from 'vitest'
import type { BoardRead } from '../panel/data.js'
import { decisionRows } from './data.js'

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
