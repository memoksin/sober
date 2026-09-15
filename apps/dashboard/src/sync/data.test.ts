import { expect, test } from 'vitest'
import { rowsOf, unanswered } from './data.js'

test('a fields conflict is one row per field, with both values', () => {
	const rows = rowsOf({
		kind: 'fields',
		path: 'n/a.json',
		id: 'a',
		fields: [
			{ field: 'title', ours: 'A', theirs: 'B' },
			{ field: 'status', ours: 'ready', theirs: 'done' },
		],
	})
	expect(rows.map((row) => row.field)).toEqual(['title', 'status'])
	expect(rows[0]?.picks.map((pick) => [pick.value, pick.shows])).toEqual([
		['ours', 'A'],
		['theirs', 'B'],
	])
})

test('an archived conflict is one row, keep or restore', () => {
	const rows = rowsOf({ kind: 'archived', path: 'n/a.json', id: 'a', by: 'theirs' })
	expect(rows).toHaveLength(1)
	expect(rows[0]?.field).toBe('record')
	expect(rows[0]?.picks.map((pick) => pick.value)).toEqual(['keep', 'restore'])
})

test('unanswered names the fields without a choice', () => {
	const rows = rowsOf({
		kind: 'fields',
		path: 'p',
		id: 'a',
		fields: [
			{ field: 'x', ours: '1', theirs: '2' },
			{ field: 'y', ours: '1', theirs: '2' },
		],
	})
	expect(unanswered(rows, { x: 'ours' })).toEqual(['y'])
	expect(unanswered(rows, { x: 'ours', y: 'theirs' })).toEqual([])
})
