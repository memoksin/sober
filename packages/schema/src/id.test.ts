import { expect, test } from 'vitest'
import { chainEnds, Id, Timestamp } from './id.js'
import { Node } from './node.js'

test('accepts a slug with a four-character suffix', () => {
	expect(Id.safeParse('auth-api-k7f2').success).toBe(true)
	expect(Id.safeParse('db-m3q8').success).toBe(true)
})

test('rejects a bare slug, so two machines cannot produce the same file', () => {
	expect(Id.safeParse('session-endpoints').success).toBe(false)
	expect(Id.safeParse('auth').success).toBe(false)
})

test('rejects ids that are not lowercase, dashed and alphanumeric', () => {
	for (const bad of ['Auth-API-k7f2', 'auth api k7f2', 'auth--k7f2', 'auth-k7f2-', '']) {
		expect(Id.safeParse(bad).success, bad).toBe(false)
	}
})

test('the id is the file name, never a field on the record', () => {
	const node = {
		id: 'auth-api-k7f2',
		title: 'Session endpoints',
		description: '',
		notes: '',
		dependsOn: [],
		decisions: [],
		files: [],
		brief: null,
		outcome: null,
		assignee: null,
		claim: null,
		accepted: null,
		createdAt: '2026-08-27T09:00:00Z',
	}

	expect(Node.safeParse(node).success).toBe(false)
})

test('a timestamp must be ISO 8601', () => {
	expect(Timestamp.safeParse('2026-08-27T09:00:00Z').success).toBe(true)
	expect(Timestamp.safeParse('2026-08-27').success).toBe(false)
})

test('a run is two ids with two dots between them, which no id can be mistaken for', () => {
	expect(chainEnds('auth-api-k7f2..auth-ui-9x1p')).toEqual(['auth-api-k7f2', 'auth-ui-9x1p'])
	expect(chainEnds('auth-api-k7f2')).toBeNull()
})

test('half a run is not a run, and neither is a third end', () => {
	for (const bad of ['auth-api-k7f2..', '..auth-ui-9x1p', '..', 'a-k7f2..b-9x1p..c-3m5t']) {
		expect(chainEnds(bad), bad).toBeNull()
	}
})

test('an end that is not an id is not an end', () => {
	expect(chainEnds('auth-api..auth-ui')).toBeNull()
	expect(chainEnds('Auth-API-k7f2..auth-ui-9x1p')).toBeNull()
})
