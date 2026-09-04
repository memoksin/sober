import { expect, test } from 'vitest'
import { Decision, decisionState } from './decision.js'

const cookie = {
	id: 'cookie',
	label: 'Signed cookie',
	reason: 'Revocable',
	costLater: 'Sticky sessions',
}
const jwt = { id: 'jwt', label: 'Stateless JWT', reason: 'Scales flat', costLater: 'A denylist' }
const options = [cookie, jwt]

// Records here are deliberately invalid in places, so overrides are untyped.
function decision(overrides: Record<string, unknown> = {}): unknown {
	return {
		category: 'data-flow',
		question: 'How does a session reach a protected route?',
		options,
		suggested: 'cookie',
		answer: null,
		createdAt: '2026-08-27T09:00:00Z',
		...overrides,
	}
}

const answer = {
	option: 'cookie',
	rationale: 'Revocation matters more than scale-out.',
	by: 'memoksin',
	at: '2026-08-27T10:12:00Z',
}

test('no options means not yet opened', () => {
	const parsed = Decision.parse(decision({ options: null, suggested: null }))

	expect(decisionState(parsed)).toBe('unopened')
})

test('options with no answer means open', () => {
	expect(decisionState(Decision.parse(decision()))).toBe('open')
})

test('options with an answer means answered', () => {
	expect(decisionState(Decision.parse(decision({ answer })))).toBe('answered')
})

test('an answer naming an option that does not exist fails validation', () => {
	const result = Decision.safeParse(decision({ answer: { ...answer, option: 'session-store' } }))

	expect(result.success).toBe(false)
})

test('a decision that was never opened cannot carry an answer', () => {
	const result = Decision.safeParse(decision({ options: null, suggested: null, answer }))

	expect(result.success).toBe(false)
})

test('suggested must name one of the options', () => {
	expect(Decision.safeParse(decision({ suggested: 'session-store' })).success).toBe(false)
})

test('option ids are unique, so an answer can only mean one thing', () => {
	const duplicated = [cookie, { ...jwt, id: 'cookie' }]

	expect(Decision.safeParse(decision({ options: duplicated })).success).toBe(false)
})

test('the category comes from the fixed set SOBER ships', () => {
	expect(Decision.safeParse(decision({ category: 'performance' })).success).toBe(false)
})

test('a decision carries two to four options', () => {
	expect(Decision.safeParse(decision({ options: [cookie] })).success).toBe(false)
	expect(
		Decision.safeParse(decision({ options: [...options, ...options, ...options] })).success,
	).toBe(false)
})

test('there is no draft field to disagree with the answer', () => {
	expect(Decision.safeParse({ ...(decision() as object), draft: true }).success).toBe(false)
})
