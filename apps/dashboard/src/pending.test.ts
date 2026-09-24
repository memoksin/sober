import { expect, test } from 'vitest'
import { FLAG_ACTIONS } from './panel/data.js'
import { PENDING, pending } from './pending.js'

/**
 * Every operation a click can start, in one list. The gate found the review
 * button silent; the answer is not one spinner but one vocabulary, which is
 * only worth anything if nothing is missing from it.
 */
const CLICKABLE = [
	'approve',
	'run',
	'stop',
	'review',
	'accept',
	'reject',
	'decide',
	'edit_decision',
	'impact',
	...FLAG_ACTIONS.map((action) => action.does),
] as const

test('every operation a click can start says what it is doing', () => {
	for (const does of CLICKABLE) {
		expect(PENDING[does], does).toBeTypeOf('string')
	}
})

test('each sentence names its own operation rather than repeating a neighbour', () => {
	const said = CLICKABLE.map((does) => pending(does))

	expect(new Set(said).size).toBe(said.length)
})

/**
 * The ellipsis is the convention: it is what says the sentence is a state and
 * not a result. A label without one reads as a finished claim.
 */
test('every sentence is unfinished', () => {
	for (const does of CLICKABLE) {
		expect(pending(does).endsWith('…'), does).toBe(true)
	}
})

test('the review button narrates the scan rather than an ellipsis on its own', () => {
	expect(pending('review')).toMatch(/scan/i)
})

/**
 * A new operation reaching a button before it reaches this list still says
 * something. Silence is the failure; a generic sentence is not.
 */
test('an operation nobody listed still says it is working', () => {
	expect(pending('a-verb-nobody-wrote-yet')).toBe('Working…')
})
