import { expect, test } from 'vitest'
import { Contributors } from './contributors.js'

const team = {
	contributors: [{ handle: 'memoksin', name: 'Mehmet', role: 'maintainer', focus: 'core, cli' }],
}

test('parses the team record', () => {
	expect(Contributors.parse(team)).toEqual(team)
})

test('a board with nobody on it yet is a valid team record', () => {
	expect(Contributors.parse({ contributors: [] }).contributors).toEqual([])
})

test('a contributor without a handle is nobody', () => {
	const nameless = { contributors: [{ handle: '', name: 'X', role: '', focus: '' }] }

	expect(Contributors.safeParse(nameless).success).toBe(false)
})

test('role and focus may be empty — a team is not always described', () => {
	const bare = { contributors: [{ handle: 'bob', name: '', role: '', focus: '' }] }

	expect(Contributors.parse(bare).contributors[0]?.handle).toBe('bob')
})

test('an unknown field fails loudly rather than being dropped on the next write', () => {
	const extra = { contributors: [{ handle: 'bob', name: '', role: '', focus: '', email: 'x@y.z' }] }

	expect(Contributors.safeParse(extra).success).toBe(false)
})
