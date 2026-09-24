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

test('by default, an answered decision is left out even with `all` unset', () => {
	const open = {
		category: 'data',
		question: 'Which open?',
		options: null,
		answer: null,
		suggested: null,
		createdAt: '2026-01-01T00:00:00.000Z',
	}
	const answered = {
		category: 'data',
		question: 'Which answered?',
		options: [
			{ id: 'a', label: 'A', reason: 'ra', costLater: 'ca' },
			{ id: 'b', label: 'B', reason: 'rb', costLater: 'cb' },
		],
		answer: { option: 'a', by: 'me', at: '2026-01-02T00:00:00.000Z', rationale: '', derived: null },
		suggested: null,
		createdAt: '2026-01-02T00:00:00.000Z',
	}
	const board = {
		decisions: new Map([
			['open1', open as unknown as Decision],
			['answered1', answered as unknown as Decision],
		]),
		archivedDecisions: new Set(),
	} as unknown as Board
	const out = renderDecisions(board)
	expect(out).toContain('Which open?')
	expect(out).not.toContain('Which answered?')
})

test('`all` includes answered decisions with provenance, alternatives, and open/unopened before answered ordering, excluding archived ones', () => {
	const open = {
		category: 'data',
		question: 'Which open?',
		options: null,
		answer: null,
		suggested: null,
		createdAt: '2026-01-03T00:00:00.000Z',
	}
	const answered = {
		category: 'security',
		question: 'Which answered?',
		options: [
			{ id: 'a', label: 'Chosen A', reason: 'ra', costLater: 'ca' },
			{ id: 'b', label: 'Other B', reason: 'rb', costLater: 'cb' },
		],
		answer: {
			option: 'a',
			by: 'me',
			at: '2026-01-02T00:00:00.000Z',
			rationale: '',
			derived: 'the import graph',
		},
		suggested: null,
		createdAt: '2026-01-01T00:00:00.000Z',
	}
	const archived = {
		category: 'data',
		question: 'Archived question',
		options: null,
		answer: null,
		suggested: null,
		createdAt: '2026-01-01T00:00:00.000Z',
	}
	const board = {
		decisions: new Map([
			['answered1', answered as unknown as Decision],
			['open1', open as unknown as Decision],
			['archived1', archived as unknown as Decision],
		]),
		archivedDecisions: new Set(['archived1']),
	} as unknown as Board
	const out = renderDecisions(board, true)
	expect(out).not.toContain('Archived question')
	expect(out).toContain('- a: Chosen A (answered)')
	expect(out).toContain('derived: the import graph')
	expect(out).toContain('- b: Other B')
	expect(out.indexOf('Which open?')).toBeLessThan(out.indexOf('Which answered?'))
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
