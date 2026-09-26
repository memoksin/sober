import type { Answer } from '@besober/schema'
import { expect, test } from 'vitest'
import { renderBrief, renderPlain, searchDecisions } from './brief.js'
import type { Board } from './graph.js'
import { aDecision, aNode } from './records.fixture.js'

const AT = '2026-09-04T00:00:00.000Z'
const answer: Answer = {
	option: 'redis',
	rationale: 'We already run one.',
	by: 'memoksin',
	at: AT,
	derived: null,
}

const board = (): Board => ({
	project: {
		schemaVersion: 1,
		title: 'Acme API',
		intent: 'A billing API two teams can call.',
		constraints: ['No new services', 'Postgres only'],
	},
	nodes: new Map([
		[
			'db-schema-m3q8',
			aNode({
				title: 'Billing tables',
				outcome: 'Added invoices and line_items, with a unique index on (account, period).',
			}),
		],
		[
			'auth-api-k7f2',
			aNode({
				title: 'Session endpoints',
				name: 'Session endpoints',
				description: 'Login, logout, and the middleware that reads the session.',
				notes: 'The mobile client sends the token in a header, not a cookie.',
				dependsOn: ['db-schema-m3q8'],
				decisions: ['auth-model-k7f2'],
				files: ['src/auth/**', 'src/middleware/session.ts'],
				brief: {
					approach: 'Write the endpoints first, then the middleware that reads what they set.',
					complexity: null,
					acceptance: [
						{
							run: 'pnpm test src/auth',
							proves: 'Login and logout answer, and a bad password does not.',
						},
						{ run: 'pnpm typecheck', proves: 'The session type reaches every caller.' },
					],
					approval: { by: 'memoksin', at: AT, queue: false },
				},
			}),
		],
	]),
	decisions: new Map([['auth-model-k7f2', aDecision({ answer })]]),
	archivedDecisions: new Set(),
	runs: new Map(),
	feedback: new Map(),
	broken: [],
})

test('the brief renders the whole skeleton from the records, in the design order', () => {
	expect(renderBrief(board(), 'auth-api-k7f2')).toMatchSnapshot()
})

test('a brief carries the upstream outcome, so the agent never has to go looking', () => {
	const rendered = renderBrief(board(), 'auth-api-k7f2') ?? ''

	expect(rendered).toContain('Added invoices and line_items')
})

test('an answered decision cannot be left out — the skeleton is rendered, never stored', () => {
	const withoutDecision = board()
	const rendered = renderBrief(withoutDecision, 'auth-api-k7f2') ?? ''

	expect(rendered).toContain('Where does session state live?')
	expect(rendered).toContain('Chosen: Redis')
	expect(rendered).toContain('Costs later: A service to run')
	expect(rendered).toContain('Your reason: We already run one.')
})

test('an unanswered or missing decision says so rather than rendering a choice', () => {
	const unanswered = { ...board(), decisions: new Map([['auth-model-k7f2', aDecision()]]) }
	const missing = { ...board(), decisions: new Map() }

	expect(renderBrief(unanswered, 'auth-api-k7f2')).toContain('not answered yet')
	expect(renderBrief(missing, 'auth-api-k7f2')).toContain('not on this board')
})

test('a node with no brief renders the skeleton and says the approach is missing', () => {
	const fresh = {
		...board(),
		nodes: new Map([['auth-api-k7f2', aNode({ title: 'Session endpoints' })]]),
	}

	const rendered = renderBrief(fresh, 'auth-api-k7f2') ?? ''

	expect(rendered).toContain('No approach written yet')
	expect(rendered).toContain('A billing API two teams can call.')
})

test('a search over answered decisions returns the question, the option chosen, its rationale, cost and the node that bound it', () => {
	const [match] = searchDecisions(board(), 'session')
	expect(match).toBeDefined()
	expect(match?.question).toBe('Where does session state live?')
	expect(match?.option).toEqual({
		id: 'redis',
		label: 'Redis',
		reason: 'Revocable',
		costLater: 'A service to run',
	})
	expect(match?.rationale).toBe('We already run one.')
	expect(match?.nodes).toEqual([{ id: 'auth-api-k7f2', title: 'Session endpoints' }])
})

test('a search matches on the chosen option, its cost, and a bound node’s name — not only the question', () => {
	expect(searchDecisions(board(), 'redis')).toHaveLength(1)
	expect(searchDecisions(board(), 'service to run')).toHaveLength(1)
	expect(searchDecisions(board(), 'Session endpoints')).toHaveLength(1)
	expect(searchDecisions(board(), 'nothing matches this')).toHaveLength(0)
})

test('an unanswered or unopened decision never appears in a search, whatever the query', () => {
	const withUnanswered: Board = {
		...board(),
		decisions: new Map([
			...board().decisions,
			['unopened-x9y8', aDecision({ question: 'How does billing retry?', options: null })],
			['unanswered-a1b2', aDecision({ question: 'Where do webhooks land?' })],
		]),
	}

	expect(searchDecisions(withUnanswered, '')).toHaveLength(1)
	expect(searchDecisions(withUnanswered, 'billing retry')).toHaveLength(0)
	expect(searchDecisions(withUnanswered, 'webhooks')).toHaveLength(0)
})

test('a node the board does not hold has no brief', () => {
	expect(renderBrief(board(), 'gone-node-x9y8')).toBe(null)
})

test('the plain block renders the four fields under their own headings, and nothing else', () => {
	const rendered = renderPlain({
		what: 'Adds a status field to the run record.',
		why: 'So a rejected node can resume instead of paying for a fresh run.',
		check: 'pnpm test packages/core/src/status passes.',
		risk: 'none',
	})

	expect(rendered).toBe(
		[
			'## What changes\n\nAdds a status field to the run record.',
			'## Why\n\nSo a rejected node can resume instead of paying for a fresh run.',
			'## How it is checked\n\npnpm test packages/core/src/status passes.',
			'## Risk\n\nnone',
		].join('\n\n'),
	)
})
