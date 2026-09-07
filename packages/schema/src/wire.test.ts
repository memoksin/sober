import { expect, test } from 'vitest'
import { Impact, ProjectedNode, Projection, WireError } from './wire.js'

const projected = {
	id: 'auth-api-k7f2',
	title: 'The auth API',
	status: 'ready',
	dependsOn: ['schema-records-m3p1'],
	flagged: false,
}

test('a projected node carries the five things the canvas draws', () => {
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

/**
 * §7.2's list is the canvas narrowed to the flagged nodes, so the canvas has to
 * be told which they are. Absent is not "false": a projection built by a build
 * that forgot the derivation would draw a board where nothing is ever flagged.
 */
test('a projected node says whether it is flagged, and never omits it', () => {
	expect(ProjectedNode.parse({ ...projected, flagged: true }).flagged).toBe(true)
	const { flagged: _, ...without } = projected
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

test('an impact entry says what the save does to that node, and which node it is', () => {
	const impact = {
		decision: 'auth-model-k7f2',
		nodes: [
			{ id: 'auth-api-k7f2', title: 'The auth API', status: 'in-review', effect: 'flag' },
			{ id: 'auth-ui-m3q8', title: 'The sign-in screen', status: 'ready', effect: 'rebrief' },
		],
	}

	expect(Impact.parse(impact)).toEqual(impact)
})

test('an impact that reaches nothing is an empty list, not an absent one', () => {
	expect(Impact.parse({ decision: 'auth-model-k7f2', nodes: [] }).nodes).toEqual([])
	expect(Impact.safeParse({ decision: 'auth-model-k7f2' }).success).toBe(false)
})

test('the effect is one of the two the save has — a third would be a case nobody wrote', () => {
	const entry = { id: 'auth-api-k7f2', title: 'The auth API', status: 'done', effect: 'reopen' }
	expect(Impact.safeParse({ decision: 'auth-model-k7f2', nodes: [entry] }).success).toBe(false)
})
