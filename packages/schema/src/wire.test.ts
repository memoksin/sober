import { expect, test } from 'vitest'
import { ProjectedNode, Projection, WireError } from './wire.js'

const projected = {
	id: 'auth-api-k7f2',
	title: 'The auth API',
	status: 'ready',
	dependsOn: ['schema-records-m3p1'],
}

test('a projected node carries the four things the canvas draws', () => {
	expect(ProjectedNode.parse(projected)).toEqual(projected)
})

test('the projection is slim, so a full record cannot be sent in its place', () => {
	for (const heavy of ['files', 'brief', 'accepted', 'intent', 'claim']) {
		const result = ProjectedNode.safeParse({ ...projected, [heavy]: 'anything' })

		expect(result.success, heavy).toBe(false)
	}
})

test('status is one of the eight, because the canvas colours by it', () => {
	expect(ProjectedNode.safeParse({ ...projected, status: 'needs-approval' }).success).toBe(true)
	expect(ProjectedNode.safeParse({ ...projected, status: 'in-progress' }).success).toBe(false)
})

test('a node with no dependency sends an empty list, never a missing field', () => {
	expect(ProjectedNode.safeParse({ ...projected, dependsOn: [] }).success).toBe(true)
	const { dependsOn: _, ...without } = projected
	expect(ProjectedNode.safeParse(without).success).toBe(false)
})

test('a projection is a list of them and nothing else', () => {
	expect(Projection.parse({ nodes: [projected] })).toEqual({ nodes: [projected] })
	expect(Projection.safeParse({ nodes: [projected], decisions: [] }).success).toBe(false)
})

test('an empty board projects to an empty list, not to an error', () => {
	expect(Projection.parse({ nodes: [] })).toEqual({ nodes: [] })
})

test('a failure carries a message, because a blank one reads as no failure', () => {
	expect(WireError.parse({ error: 'auth-api-k7f2 is not on this board' })).toEqual({
		error: 'auth-api-k7f2 is not on this board',
	})
	expect(WireError.safeParse({ error: '' }).success).toBe(false)
})

test('the failure body carries nothing else — the status code says the rest', () => {
	expect(WireError.safeParse({ error: 'no', code: 404 }).success).toBe(false)
})
