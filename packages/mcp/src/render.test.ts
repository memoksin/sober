import type { Board } from '@besober/core'
import type { Decision, Review } from '@besober/schema'
import { expect, test } from 'vitest'
import { PASTE, renderDecisions, renderReview } from './render.js'

test('a decision renders every option with its reason and later cost, then the paste line', () => {
	const options = ['a', 'b', 'c'].map((id) => ({
		id,
		label: `Label ${id}`,
		reason: `reason ${id}`,
		costLater: `cost ${id}`,
	}))
	const decision = { category: 'data', question: 'Which?', options, answer: null, suggested: 'b' }
	const board = {
		decisions: new Map([['d1', decision as unknown as Decision]]),
		archivedDecisions: new Set(),
	} as unknown as Board
	const out = renderDecisions(board)
	for (const { id } of options) {
		expect(out).toContain(`- ${id}: Label ${id}`)
		expect(out).toContain(`because: reason ${id}`)
		expect(out).toContain(`later:   cost ${id}`)
	}
	expect(out.endsWith(PASTE)).toBe(true)
})

test('a review renders its findings and criteria, then the paste line', () => {
	const review = {
		node: 'n1',
		scan: {
			result: 'findings',
			ruleSet: 'default',
			findings: [{ signal: 'secret', file: 'a.ts', line: 3, message: 'a key' }],
			didNotRun: [],
			files: ['a.ts'],
		},
		diff: '',
		files: ['a.ts'],
		run: null,
		exit: 'done',
		acceptance: [{ run: 'pnpm test', proves: 'it works', result: { exit: 0 } }],
		verify: null,
		ci: { kind: 'none' },
		pr: null,
		uncommitted: [],
		accepted: null,
	} as unknown as Review
	const out = renderReview(review, false)
	expect(out).toContain('a.ts:3  a key')
	expect(out).toContain('PASSED — it works  —  `pnpm test`')
	expect(out.endsWith(PASTE)).toBe(true)
})
