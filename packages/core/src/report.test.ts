import type { Answer } from '@besober/schema'
import { expect, test } from 'vitest'
import type { Board } from './graph.js'
import { aDecision, aNode } from './records.fixture.js'
import { renderDecisionReport } from './report.js'

const AT = '2026-09-04T00:00:00.000Z'
const LATER = '2026-09-05T00:00:00.000Z'

const answer = (overrides: Partial<Answer> = {}): Answer => ({
	option: 'cookie',
	rationale: 'Simplest',
	by: 'memoksin',
	at: AT,
	derived: null,
	...overrides,
})

const board = (overrides: Partial<Board> = {}): Board => ({
	project: null,
	nodes: new Map(),
	decisions: new Map(),
	archivedDecisions: new Set(),
	runs: new Map(),
	feedback: new Map(),
	broken: [],
	...overrides,
})

test('an empty board says nothing has been answered yet', () => {
	expect(renderDecisionReport(board())).toBe('# Decisions\n\nNo decision has been answered yet.\n')
})

test('an unanswered or unopened decision is left out — the report is answers only', () => {
	const report = renderDecisionReport(
		board({
			decisions: new Map([
				['open-k7f2', aDecision()],
				['unopened-k7f2', aDecision({ options: null })],
			]),
		}),
	)
	expect(report).toBe('# Decisions\n\nNo decision has been answered yet.\n')
})

test('answers order by when they were answered, id breaking a tie', () => {
	const report = renderDecisionReport(
		board({
			decisions: new Map([
				['second-k7f2', aDecision({ question: 'Second', answer: answer({ at: LATER }) })],
				['first-b-k7f2', aDecision({ question: 'First b', answer: answer({ at: AT }) })],
				['first-a-k7f2', aDecision({ question: 'First a', answer: answer({ at: AT }) })],
			]),
		}),
	)
	const order = ['First a', 'First b', 'Second'].map((q) => report.indexOf(q))
	expect(order).toEqual([...order].sort((a, b) => a - b))
	expect(order.every((i) => i >= 0)).toBe(true)
})

test('the chosen option, its reason and cost later are all in the report', () => {
	const report = renderDecisionReport(
		board({ decisions: new Map([['session-k7f2', aDecision({ answer: answer() })]]) }),
	)
	expect(report).toContain('Chosen: **Cookie** (`cookie`)')
	expect(report).toContain('Why: No server state')
	expect(report).toContain('Costs later: Size limits')
})

test('every unchosen option is listed with its reason and cost later', () => {
	const report = renderDecisionReport(
		board({ decisions: new Map([['session-k7f2', aDecision({ answer: answer() })]]) }),
	)
	expect(report).toContain('Redis')
	expect(report).toContain('Revocable')
	expect(report).toContain('A service to run')
})

test('derived provenance is shown when the answer was read off the code', () => {
	const report = renderDecisionReport(
		board({
			decisions: new Map([
				['session-k7f2', aDecision({ answer: answer({ derived: 'the import graph' }) })],
			]),
		}),
	)
	expect(report).toContain('Derived: the import graph')
})

test('a decision with no derived provenance names none', () => {
	const report = renderDecisionReport(
		board({ decisions: new Map([['session-k7f2', aDecision({ answer: answer() })]]) }),
	)
	expect(report).not.toContain('Derived:')
})

test('the nodes a decision released are named by title and id', () => {
	const report = renderDecisionReport(
		board({
			decisions: new Map([['session-k7f2', aDecision({ answer: answer() })]]),
			nodes: new Map([
				['auth-ui-m3q8', aNode({ title: 'The sign-in screen', decisions: ['session-k7f2'] })],
				['unrelated-9x1p', aNode({ title: 'Unrelated', decisions: [] })],
			]),
		}),
	)
	expect(report).toContain('The sign\\-in screen')
	expect(report).toContain('auth-ui-m3q8')
	expect(report).not.toContain('Unrelated')
})

test('a decision no node binds says so rather than an empty list', () => {
	const report = renderDecisionReport(
		board({ decisions: new Map([['session-k7f2', aDecision({ answer: answer() })]]) }),
	)
	expect(report).toContain('Released: no node binds it.')
})

test('markdown punctuation in a question, a label or a rationale cannot break report structure', () => {
	const report = renderDecisionReport(
		board({
			decisions: new Map([
				[
					'session-k7f2',
					aDecision({
						question: '# Fake heading\n* fake list',
						options: [
							{ id: 'cookie', label: '*bold* [link](evil)', reason: 'a_b', costLater: 'c-d' },
							{ id: 'redis', label: 'Redis', reason: 'Revocable', costLater: 'A service to run' },
						],
						answer: answer({ rationale: '`inline code`' }),
					}),
				],
			]),
		}),
	)
	expect(report).not.toMatch(/^# Fake heading/m)
	expect(report).not.toMatch(/^\* fake list/m)
	expect(report).toContain('\\*bold\\* \\[link\\]\\(evil\\)')
	expect(report).toContain('\\`inline code\\`')
})
