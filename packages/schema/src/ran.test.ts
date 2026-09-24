import { describe, expect, it } from 'vitest'
import { ranLabel } from './ran.js'

describe('ranLabel', () => {
	it('says unscored when nothing scored the node', () => {
		expect(ranLabel({ tier: null, fallback: false })).toBe('unscored')
	})

	it('says the score had no covering model when it fell back', () => {
		expect(ranLabel({ tier: null, fallback: true })).toBe(
			'no model covers this score, fallback to dispatch.host',
		)
	})

	it('says the tier named no host when it fell back', () => {
		expect(ranLabel({ tier: 'high', fallback: true })).toBe(
			'high named no host, fallback to dispatch.host',
		)
	})

	it('says the tier when it named a host', () => {
		expect(ranLabel({ tier: 'high', fallback: false })).toBe('high')
	})
})
