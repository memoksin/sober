import type { Answer } from '@besober/schema'
import { expect, test } from 'vitest'
import { renderBrief } from './brief.js'
import type { Board } from './graph.js'
import { aDecision, aNode } from './records.fixture.js'

const AT = '2026-09-04T00:00:00.000Z'
const answer: Answer = { option: 'redis', rationale: 'We already run one.', by: 'memoksin', at: AT }

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
				description: 'Login, logout, and the middleware that reads the session.',
				notes: 'The mobile client sends the token in a header, not a cookie.',
				dependsOn: ['db-schema-m3q8'],
				decisions: ['auth-model-k7f2'],
				files: ['src/auth/**', 'src/middleware/session.ts'],
				brief: {
					approach: 'Write the endpoints first, then the middleware that reads what they set.',
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

test('a node the board does not hold has no brief', () => {
	expect(renderBrief(board(), 'gone-node-x9y8')).toBe(null)
})
