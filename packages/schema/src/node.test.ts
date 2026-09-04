import { expect, test } from 'vitest'
import { Node } from './node.js'

const node = {
	title: 'Session endpoints',
	description: 'Login, logout, and the middleware that reads the session.',
	notes: '',
	dependsOn: ['db-schema-m3q8'],
	decisions: ['auth-model-k7f2'],
	files: ['src/auth/**', 'src/middleware/session.ts'],
	brief: null,
	outcome: null,
	accepted: null,
	createdAt: '2026-08-27T09:00:00Z',
}

test('parses the M1 node record', () => {
	expect(Node.parse(node)).toEqual(node)
})

test('assignee is not an M1 field', () => {
	expect(Node.safeParse({ ...node, assignee: 'memoksin' }).success).toBe(false)
})

test('claim is not an M1 field', () => {
	const claim = { by: 'memoksin', at: '2026-08-27T11:00:00Z' }

	expect(Node.safeParse({ ...node, claim }).success).toBe(false)
})

test('there is no updatedAt — git log answers when this changed', () => {
	expect(Node.safeParse({ ...node, updatedAt: '2026-08-27T11:00:00Z' }).success).toBe(false)
})

test('status is derived, so it is not stored on the node', () => {
	expect(Node.safeParse({ ...node, status: 'ready' }).success).toBe(false)
})

test('dependsOn and decisions hold ids, not titles', () => {
	expect(Node.safeParse({ ...node, dependsOn: ['db schema'] }).success).toBe(false)
	expect(Node.safeParse({ ...node, decisions: ['auth-model'] }).success).toBe(false)
})

test('accepted records the scan result, so a scan that did not run is never dropped', () => {
	const accepted = {
		by: 'memoksin',
		at: '2026-08-27T12:00:00Z',
		flagged: false,
		scan: 'did-not-run',
	}

	expect(Node.parse({ ...node, accepted }).accepted?.scan).toBe('did-not-run')
	expect(Node.safeParse({ ...node, accepted: { ...accepted, scan: 'ok' } }).success).toBe(false)
})
