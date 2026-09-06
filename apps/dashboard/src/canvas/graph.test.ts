import type { Projection } from '@besober/schema'
import { expect, test } from 'vitest'
import { elementsOf, glow, relax } from './graph.js'

const board: Projection = {
	nodes: [
		{ id: 'auth-api-k7f2', title: 'The auth API', status: 'ready', dependsOn: [] },
		{ id: 'schema-records-m3p1', title: 'Records', status: 'done', dependsOn: ['auth-api-k7f2'] },
		{
			id: 'invoice-total-abcd',
			title: 'Invoice total',
			status: 'blocked',
			dependsOn: ['auth-api-k7f2', 'schema-records-m3p1'],
		},
	],
}

test('every projected node becomes a node, carrying what the canvas draws with', () => {
	const nodes = elementsOf(board).filter((e) => e.group === 'nodes')

	expect(nodes).toHaveLength(3)
	expect(nodes[0]?.data).toMatchObject({
		id: 'auth-api-k7f2',
		label: 'The auth API',
		status: 'ready',
	})
})

test('every dependency becomes one edge, pointing at the node that waits', () => {
	const edges = elementsOf(board).filter((e) => e.group === 'edges')

	expect(edges).toHaveLength(3)
	expect(edges.map((e) => e.data.id)).toEqual([...new Set(edges.map((e) => e.data.id))])
	// The arrow runs from what is finished to what is waiting, which is the
	// direction a person reads the board in.
	expect(edges[0]?.data).toMatchObject({ source: 'auth-api-k7f2', target: 'schema-records-m3p1' })
})

test('a dependency on a node that is not here is dropped rather than drawn into nothing', () => {
	// `core` can report a dangling edge (§8.4 keeps a broken board readable).
	// Cytoscape throws on an edge with no endpoint, so one bad record would
	// take down the whole canvas.
	const dangling: Projection = {
		nodes: [{ id: 'lonely-aaaa', title: 'Lonely', status: 'ready', dependsOn: ['gone-bbbb'] }],
	}

	expect(elementsOf(dangling).filter((e) => e.group === 'edges')).toEqual([])
})

test('an empty board is an empty canvas, not a failure', () => {
	expect(elementsOf({ nodes: [] })).toEqual([])
})

const at = (entries: readonly [string, number, number][]) =>
	new Map(entries.map(([id, x, y]) => [id, { x, y }]))

test('an edge inside the limit is left alone', () => {
	const before = at([
		['a', 0, 0],
		['b', 50, 0],
	])

	expect(relax(before, [['a', 'b']], { max: 100, held: 'a' })).toEqual(before)
})

test('an edge past the limit pulls the far node back to exactly the limit', () => {
	const after = relax(
		at([
			['a', 0, 0],
			['b', 300, 0],
		]),
		[['a', 'b']],
		{ max: 100, held: 'a' },
	)

	expect(after.get('b')?.x).toBeCloseTo(100)
	expect(after.get('b')?.y).toBeCloseTo(0)
})

test('the node under the pointer never moves — the person is holding it', () => {
	const after = relax(
		at([
			['a', 0, 0],
			['b', 300, 0],
		]),
		[['a', 'b']],
		{ max: 100, held: 'a' },
	)

	expect(after.get('a')).toEqual({ x: 0, y: 0 })
})

test('where neither end is held, both give half', () => {
	const after = relax(
		at([
			['a', 0, 0],
			['b', 300, 0],
		]),
		[['a', 'b']],
		{ max: 100, held: 'someone-else' },
	)

	expect(after.get('a')?.x).toBeCloseTo(100)
	expect(after.get('b')?.x).toBeCloseTo(200)
})

test('a pull travels past the first neighbour', () => {
	// a—b—c in a line. Dragging `a` far away must move `c` too, or the constraint
	// stops at one hop and the graph tears instead of following.
	const after = relax(
		at([
			['a', 0, 0],
			['b', 400, 0],
			['c', 800, 0],
		]),
		[
			['a', 'b'],
			['b', 'c'],
		],
		{ max: 100, held: 'a' },
	)

	expect(after.get('c')?.x).toBeLessThan(800)
})

test('it returns new positions and leaves the ones it was given alone', () => {
	const before = at([
		['a', 0, 0],
		['b', 300, 0],
	])
	const snapshot = new Map([...before].map(([id, p]) => [id, { ...p }]))

	relax(before, [['a', 'b']], { max: 100, held: 'a' })

	expect(before).toEqual(snapshot)
})

test('two nodes on top of each other do not divide by zero', () => {
	const after = relax(
		at([
			['a', 10, 10],
			['b', 10, 10],
		]),
		[['a', 'b']],
		{ max: 100, held: 'a' },
	)

	expect(after.get('b')).toEqual({ x: 10, y: 10 })
})

test('the glow scales with the node rather than with a pixel count', () => {
	const small = glow(8, 'var(--status-ready)', { extent: 0.45, power: 1 })
	const large = glow(16, 'var(--status-ready)', { extent: 0.45, power: 1 })

	expect(small).not.toEqual(large)
	// ADR 0039 §6: `done` renders smaller and the canvas zooms, so a fixed blur
	// is a glow that is right once.
	const blur = (s: string) => Number(/0 0 ([\d.]+)px/.exec(s)?.[1])
	expect(blur(large)).toBeCloseTo(blur(small) * 2)
})

test('the glow never fades towards transparent', () => {
	const shadow = glow(10, 'var(--status-held)', { extent: 0.45, power: 1 })

	// `transparent` is black at zero alpha: mixing towards it drags a colour
	// towards black, which is the grey smear this cost three attempts to find.
	expect(shadow).not.toContain('transparent')
	expect(shadow).toContain('oklch(from')
})

test('a power of zero is no light, not a black ring', () => {
	expect(glow(10, 'var(--status-ready)', { extent: 0.45, power: 0 })).toBe('none')
})
