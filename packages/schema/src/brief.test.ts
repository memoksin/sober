import { expect, test } from 'vitest'
import { Brief } from './brief.js'

const criterion = {
	run: 'pnpm test packages/core/src/status',
	proves: 'a node whose only open decision is answered leaves blocked in the same write',
}

const brief = {
	approach: 'Derive status in one pass over the node and its decisions.',
	complexity: 4,
	acceptance: [criterion],
	approval: null,
}

test('a brief written before the score existed has none', () => {
	expect(Brief.parse({ ...brief, complexity: null }).complexity).toBeNull()
})

test('a score outside 1–10, or not a whole number, is refused', () => {
	for (const complexity of [0, 11, 7.5]) {
		expect(Brief.safeParse({ ...brief, complexity }).success).toBe(false)
	}
})

test('parses a brief with an unapproved acceptance list', () => {
	expect(Brief.parse(brief)).toEqual(brief)
})

test('a brief with no acceptance criteria is not a brief', () => {
	expect(Brief.safeParse({ ...brief, acceptance: [] }).success).toBe(false)
})

test('a criterion carries both the command and what passing it proves', () => {
	expect(Brief.safeParse({ ...brief, acceptance: [{ run: criterion.run }] }).success).toBe(false)
	expect(Brief.safeParse({ ...brief, acceptance: [{ proves: criterion.proves }] }).success).toBe(
		false,
	)
	expect(Brief.safeParse({ ...brief, acceptance: [{ ...criterion, proves: '' }] }).success).toBe(
		false,
	)
})

test('a bare command list is not an acceptance list', () => {
	expect(Brief.safeParse({ ...brief, acceptance: ['pnpm test'] }).success).toBe(false)
})

test('approve and queue is one field on the approval record', () => {
	const approval = { by: 'memoksin', at: '2026-08-27T10:00:00Z', queue: true }

	expect(Brief.parse({ ...brief, approval }).approval?.queue).toBe(true)
})

test('there is no approved boolean beside the approval record', () => {
	const approval = { by: 'memoksin', at: '2026-08-27T10:00:00Z', queue: false }

	expect(Brief.safeParse({ ...brief, approval, approved: true }).success).toBe(false)
})
