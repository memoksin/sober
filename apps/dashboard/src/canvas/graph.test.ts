import type { Projection } from '@besober/schema'
import { expect, test } from 'vitest'
import { drift, elementsOf, glow, pack, tow } from './graph.js'

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

const SPACING = 110

const linked = (nodes: readonly (readonly [string, readonly string[]])[]): Projection => ({
	nodes: nodes.map(([id, dependsOn]) => ({
		id,
		title: id.toUpperCase(),
		status: 'ready',
		dependsOn: [...dependsOn],
	})),
})

const islands = (count: number) =>
	linked(Array.from({ length: count }, (_, i) => [`n${i}`, []] as const))

const apart = (positions: ReadonlyMap<string, { x: number; y: number }>): number => {
	const all = [...positions.values()]
	let least = Number.POSITIVE_INFINITY
	for (let i = 0; i < all.length; i++)
		for (let j = i + 1; j < all.length; j++) {
			const a = all[i]
			const b = all[j]
			if (a === undefined || b === undefined) continue
			least = Math.min(least, Math.hypot(a.x - b.x, a.y - b.y))
		}
	return least
}

test('every node is placed', () => {
	expect(pack(islands(40), { spacing: SPACING }).size).toBe(40)
})

test('no two nodes are ever laid on top of each other', () => {
	// The whole reason this exists. A simulation settles into overlaps and only
	// separates them when something nudges it; rings cannot overlap, because
	// each one is given exactly as many places as it has room for.
	for (const count of [1, 2, 7, 40, 200]) {
		const placed = pack(islands(count), { spacing: SPACING })
		if (count > 1) expect(apart(placed), `${count} nodes`).toBeGreaterThanOrEqual(SPACING - 0.001)
	}
})

test('it stays compact — 200 nodes fit in a square a screen could show', () => {
	// A force layout on a board of islands spreads until `fit` has to zoom out
	// past the point where a label can be read.
	const placed = [...pack(islands(200), { spacing: SPACING }).values()]
	const reach = Math.max(...placed.map((at) => Math.hypot(at.x, at.y)))

	expect(reach).toBeLessThan(SPACING * 9)
})

test('nodes that depend on each other land near each other', () => {
	// Rings are the shape; the order around them is the graph. Without it a
	// chain becomes chords across the whole circle.
	const chain = linked([
		['a', []],
		['b', ['a']],
		['c', ['b']],
		...Array.from({ length: 30 }, (_, i) => [`x${i}`, []] as const),
	])
	const placed = pack(chain, { spacing: SPACING })
	const gap = (from: string, to: string) => {
		const a = placed.get(from)
		const b = placed.get(to)
		return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Number.POSITIVE_INFINITY
	}

	expect(gap('a', 'b')).toBeLessThan(SPACING * 2.2)
	expect(gap('b', 'c')).toBeLessThan(SPACING * 2.2)
})

test('the same board is placed the same way twice', () => {
	// Positions are not board state (ADR 0016), so they are recomputed on every
	// open. Recomputed differently every time is a board that moves under you.
	const twice = linked([
		['a', []],
		['b', ['a']],
		['c', []],
	])

	expect(pack(twice, { spacing: SPACING })).toEqual(pack(twice, { spacing: SPACING }))
})

test('an empty board is placed nowhere, not at the origin', () => {
	expect(pack({ nodes: [] }, { spacing: SPACING }).size).toBe(0)
})

const FLOAT = { amplitude: 3.5, period: 7000 }

test('a node never strays further than the amplitude it was given', () => {
	// `pack` guarantees no two nodes overlap, and it does that with arithmetic
	// (ADR 0040). A drift with no bound would give the guarantee back.
	for (const at of Array.from({ length: 400 }, (_, i) => i * 45)) {
		const { x, y } = drift('auth-api-k7f2', at, FLOAT)
		expect(Math.abs(x)).toBeLessThanOrEqual(FLOAT.amplitude)
		expect(Math.abs(y)).toBeLessThanOrEqual(FLOAT.amplitude)
	}
})

test('two nodes are never in lockstep', () => {
	// Everything moving together is not a board floating, it is a board being
	// dragged. The phase comes from the id, so the difference is per node.
	const a = drift('auth-api-k7f2', 1234, FLOAT)
	const b = drift('invoice-total-abcd', 1234, FLOAT)

	expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.5)
})

test('the same node at the same moment is always in the same place', () => {
	// No randomness anywhere: a board that floats differently on every frame
	// would jitter, and one that floats differently on every open would be a
	// different board each time (ADR 0016).
	expect(drift('auth-api-k7f2', 4321, FLOAT)).toEqual(drift('auth-api-k7f2', 4321, FLOAT))
})

test('it wanders rather than sliding along a line', () => {
	// One rate and one phase is a straight line through the resting place, and
	// a line reads as a slide. Two rates that do not divide each other is a
	// path with area.
	const path = Array.from({ length: 240 }, (_, i) => drift('auth-api-k7f2', i * 60, FLOAT))
	const peak = (of: 'x' | 'y') =>
		path.reduce((best, at, i) => ((path[best]?.[of] ?? 0) < at[of] ? i : best), 0)

	expect(Math.abs(peak('x') - peak('y'))).toBeGreaterThan(8)
})

test('it floats rather than vibrates — no frame moves a node a whole pixel', () => {
	const before = drift('auth-api-k7f2', 10_000, FLOAT)
	const after = drift('auth-api-k7f2', 10_016, FLOAT)

	expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1)
})

test('no amplitude is no motion, which is what reduced motion asks for', () => {
	expect(drift('auth-api-k7f2', 9999, { amplitude: 0, period: 7000 })).toEqual({ x: 0, y: 0 })
})

const chain = (): readonly (readonly [string, string])[] => [
	['a', 'b'],
	['b', 'c'],
	['c', 'd'],
	['d', 'e'],
]

const line = at([
	['a', 0, 0],
	['b', 100, 0],
	['c', 200, 0],
	['d', 300, 0],
	['e', 400, 0],
])

test('a hand that has not moved tows nothing, and no number of frames changes that', () => {
	// The defect this replaces was a one-way constraint: it only ever pulled a
	// follower closer, never let one back, and it ran on every frame the node was
	// held. A long press with a pixel of jitter ratcheted the board inward and
	// never gave it back. What replaces it has the resting layout as its fixed
	// point, so a press is still by construction.
	let positions = line
	for (let frame = 0; frame < 200; frame++)
		positions = tow(positions, chain(), { since: line, slack: 60, held: 'a' })

	expect(positions).toEqual(line)
})

test('a hand inside the slack tows nothing', () => {
	const nudged = new Map(line).set('a', { x: -40, y: 0 })

	expect(tow(nudged, chain(), { since: line, slack: 60, held: 'a' })).toEqual(nudged)
})

test('past the slack the neighbours follow, and further ones follow less', () => {
	const dragged = new Map(line).set('a', { x: -260, y: 0 })
	const after = tow(dragged, chain(), { since: line, slack: 60, held: 'a', ease: 1 })

	const moved = (id: string) => (line.get(id)?.x ?? 0) - (after.get(id)?.x ?? 0)

	expect(after.get('a')).toEqual({ x: -260, y: 0 })
	expect(moved('b')).toBeGreaterThan(0)
	expect(moved('b')).toBeGreaterThan(moved('c'))
	expect(moved('c')).toBeGreaterThan(moved('d'))
})

test('the tow reverses — dragging back puts the followers back', () => {
	// The property the ratchet did not have, and the one that makes a long press
	// safe: every position is a function of where the hand is now, so there is
	// no state to accumulate in.
	const out = tow(new Map(line).set('a', { x: -400, y: 0 }), chain(), {
		since: line,
		slack: 60,
		held: 'a',
		ease: 1,
	})
	expect(out.get('b')?.x).toBeLessThan(100)

	const back = tow(new Map(out).set('a', { x: 0, y: 0 }), chain(), {
		since: line,
		slack: 60,
		held: 'a',
		ease: 1,
	})
	expect(back.get('b')?.x).toBeCloseTo(100)
})

test('the tow lags, and arrives when the frames keep coming', () => {
	// A follower that lands on its mark in the frame the limit is crossed is a
	// rod. It closes a fraction per frame instead, so the edge stretches while
	// the hand moves and comes back after it stops.
	const dragged = new Map(line).set('a', { x: -400, y: 0 })

	const one = tow(dragged, chain(), { since: line, slack: 60, held: 'a', ease: 0.2 })
	const settled = tow(dragged, chain(), { since: line, slack: 60, held: 'a', ease: 1 })
	expect(one.get('b')?.x).toBeGreaterThan(settled.get('b')?.x ?? 0)

	let positions = dragged
	for (let frame = 0; frame < 80; frame++)
		positions = tow(positions, chain(), { since: line, slack: 60, held: 'a', ease: 0.2 })
	expect(positions.get('b')?.x).toBeCloseTo(settled.get('b')?.x ?? 0, 1)
})

test('a node the drag cannot reach is left exactly where it was', () => {
	const island = at([
		['a', 0, 0],
		['b', 100, 0],
		['far', 900, 900],
	])
	const after = tow(new Map(island).set('a', { x: -400, y: 0 }), [['a', 'b']], {
		since: island,
		slack: 60,
		held: 'a',
		ease: 1,
	})

	expect(after.get('far')).toEqual({ x: 900, y: 900 })
})

test('it returns new positions and leaves the ones it was given alone', () => {
	const before = new Map(line).set('a', { x: -400, y: 0 })
	const snapshot = new Map([...before].map(([id, p]) => [id, { ...p }]))

	tow(before, chain(), { since: line, slack: 60, held: 'a', ease: 1 })

	expect(before).toEqual(snapshot)
})
