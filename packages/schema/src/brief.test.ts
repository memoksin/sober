import { expect, test } from 'vitest'
import { Brief, byWhom, Plain } from './brief.js'

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

test('an approval written before sober:auto existed still parses, and reads as a human', () => {
	const approval = { by: 'memoksin', at: '2026-08-27T10:00:00Z', queue: false }

	expect(Brief.parse({ ...brief, approval }).approval).not.toHaveProperty('autonomous')
})

test('an autonomous approval names the invocation and who ran it, and nothing else', () => {
	const autonomous = { invocation: 'sober:auto', invokedBy: 'memoksin' }
	const approval = { by: 'memoksin', at: '2026-08-27T10:00:00Z', queue: false, autonomous }

	expect(Brief.parse({ ...brief, approval }).approval?.autonomous).toEqual(autonomous)
	expect(
		Brief.safeParse({
			...brief,
			approval: { ...approval, autonomous: { ...autonomous, via: 'x' } },
		}).success,
	).toBe(false)
	expect(
		Brief.safeParse({
			...brief,
			approval: { ...approval, autonomous: { ...autonomous, invocation: 'sober:next' } },
		}).success,
	).toBe(false)
})

test('a brief written before `plain` existed still parses, with no plain block', () => {
	expect(Brief.parse(brief).plain).toBeUndefined()
})

test('a brief with a plain block round-trips it', () => {
	const plain = {
		what: 'Adds a status field.',
		why: 'So a rejected node retries faster.',
		check: 'pnpm test passes.',
		risk: 'none',
	}
	expect(Brief.parse({ ...brief, plain }).plain).toEqual(plain)
})

test('a plain field over 400 characters is refused, and an empty one too', () => {
	const plain = { what: 'x', why: 'x', check: 'x', risk: 'x' }
	expect(Plain.safeParse({ ...plain, what: 'x'.repeat(401) }).success).toBe(false)
	expect(Plain.safeParse({ ...plain, risk: '' }).success).toBe(false)
})

test('an autonomous record never reads as the invoker’s own act', () => {
	expect(byWhom({ by: 'memoksin' })).toBe('by memoksin')
	expect(
		byWhom({ by: 'memoksin', autonomous: { invocation: 'sober:auto', invokedBy: 'memoksin' } }),
	).toBe('autonomously under sober:auto (invoked by memoksin)')
})
