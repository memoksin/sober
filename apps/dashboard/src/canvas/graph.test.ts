import type { Projection } from '@besober/schema'
import { expect, test } from 'vitest'
import { drift, elementsOf, glow, pack, tow, visible } from './graph.js'

const board: Projection = {
	nodes: [
		{ id: 'auth-api-k7f2', title: 'The auth API', status: 'ready', dependsOn: [], flagged: false },
		{
			id: 'schema-records-m3p1',
			title: 'Records',
			status: 'done',
			dependsOn: ['auth-api-k7f2'],
			flagged: false,
		},
		{
			id: 'invoice-total-abcd',
			title: 'Invoice total',
			status: 'blocked',
			dependsOn: ['auth-api-k7f2', 'schema-records-m3p1'],
			flagged: false,
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
		nodes: [
			{
				id: 'lonely-aaaa',
				title: 'Lonely',
				status: 'ready',
				dependsOn: ['gone-bbbb'],
				flagged: false,
			},
		],
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
		flagged: false,
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

/** The closest two nodes are allowed: a row, across the flow. */
const ROW = SPACING / 2

/**
 * A dense join: six layers of eight, every node waiting on three of the layer
 * before, picked by a fixed stride so the board is the same every run. Listed
 * backwards, so the breadth-first walk starts at the far end.
 */
const dense = linked(
	Array.from({ length: 48 }, (_, i) => {
		const layer = Math.floor(i / 8)
		const deps =
			layer === 0 ? [] : [0, 3, 5].map((k) => `d${(layer - 1) * 8 + ((i * 5 + k * 3) % 8)}`)
		return [`d${i}`, [...new Set(deps)]] as const
	}).reverse(),
)

const edgesOf = (projection: Projection) =>
	projection.nodes.flatMap((node) => node.dependsOn.map((from) => [from, node.id] as const))

/** How many pairs of straight edges cross. Shared ends are touching, not crossing. */
const crossings = (
	placed: ReadonlyMap<string, { x: number; y: number }>,
	projection: Projection,
) => {
	const segments = edgesOf(projection).flatMap(([a, b]) => {
		const p = placed.get(a)
		const q = placed.get(b)
		return p && q ? [{ a, b, p, q }] : []
	})
	const side = (
		o: { x: number; y: number },
		p: { x: number; y: number },
		q: { x: number; y: number },
	) => Math.sign((p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x))
	let count = 0
	for (let i = 0; i < segments.length; i++)
		for (let j = i + 1; j < segments.length; j++) {
			const s = segments[i]
			const t = segments[j]
			if (s === undefined || t === undefined) continue
			if (s.a === t.a || s.a === t.b || s.b === t.a || s.b === t.b) continue
			if (
				side(s.p, s.q, t.p) * side(s.p, s.q, t.q) < 0 &&
				side(t.p, t.q, s.p) * side(t.p, t.q, s.q) < 0
			)
				count++
		}
	return count
}

test('every node is placed', () => {
	expect(pack(islands(40), { spacing: SPACING }).size).toBe(40)
	expect(pack(dense, { spacing: SPACING }).size).toBe(48)
})

test('no two nodes are ever laid on top of each other', () => {
	// The whole reason this is placed rather than simulated (ADR 0040). Rows
	// and columns are integer steps, and pieces are packed with a gap between.
	const mixed = linked([
		...dense.nodes.map((node) => [node.id, node.dependsOn] as const),
		['a', []],
		['b', ['a']],
		['c', ['b']],
		['p', []],
		['q', ['p']],
		...Array.from({ length: 30 }, (_, i) => [`x${i}`, []] as const),
	])
	for (const board of [islands(1), islands(2), islands(7), islands(200), dense, mixed])
		for (const flow of ['right', 'down'] as const) {
			const placed = pack(board, { spacing: SPACING, flow })
			if (placed.size > 1)
				expect(apart(placed), `${placed.size} nodes, ${flow}`).toBeGreaterThanOrEqual(ROW - 0.001)
		}
})

test('a label never sits on the node beside it', () => {
	// A label is under its node and 96px wide. Side by side, two nodes need a
	// whole spacing; stacked, half of one is enough.
	for (const flow of ['right', 'down'] as const)
		for (const board of [dense, islands(40)]) {
			const all = [...pack(board, { spacing: SPACING, flow }).values()]
			for (const a of all)
				for (const b of all)
					if (a !== b && Math.abs(a.y - b.y) < ROW - 0.001)
						expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(SPACING - 0.001)
		}
})

test('it stays compact — 200 nodes fit in a square a screen could show', () => {
	// A force layout on a board of islands spreads until `fit` has to zoom out
	// past the point where a label can be read.
	const placed = [...pack(islands(200), { spacing: SPACING }).values()]
	const span = (axis: 'x' | 'y') =>
		Math.max(...placed.map((at) => at[axis])) - Math.min(...placed.map((at) => at[axis]))

	expect(span('x')).toBeLessThan(SPACING * 14)
	expect(span('y')).toBeLessThan(SPACING * 14)
})

test('every dependency points the same way', () => {
	// What waits on what is the thing a board is read for. With every edge
	// going the same way, the direction is on the screen before any arrow is.
	for (const flow of ['right', 'down'] as const) {
		const placed = pack(dense, { spacing: SPACING, flow })
		const axis = flow === 'right' ? 'x' : 'y'
		for (const [from, to] of edgesOf(dense))
			expect(placed.get(to)?.[axis] ?? 0, `${from}->${to}`).toBeGreaterThan(
				placed.get(from)?.[axis] ?? 0,
			)
	}
})

test('a dense join is untangled rather than drawn in the order it arrived', () => {
	// The same layers, seated in the order the walk found them, cross 435
	// times; swept, 316. A board this dense crosses somewhere whatever is done.
	expect(crossings(pack(dense, { spacing: SPACING }), dense)).toBeLessThan(350)
})

test('a root sits next to what waits on it, not at the far start', () => {
	const late = linked([
		['a', []],
		['b', ['a']],
		['c', ['b']],
		['d', ['c', 'r']],
		['r', []],
	])
	const placed = pack(late, { spacing: SPACING })

	expect(placed.get('r')?.x).toBe(placed.get('c')?.x)
})

test('a cycle is drawn rather than taking the board down', () => {
	// `core` can report one, and one bad record does not take down a board.
	const loop = linked([
		['a', ['c']],
		['b', ['a']],
		['c', ['b']],
	])

	expect(pack(loop, { spacing: SPACING }).size).toBe(3)
})

test('nodes that depend on each other land near each other', () => {
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

	expect(gap('a', 'b')).toBeLessThan(SPACING * 2)
	expect(gap('b', 'c')).toBeLessThan(SPACING * 2)
})

test('the same board is placed the same way twice', () => {
	// Positions are not board state (ADR 0016), so they are recomputed on every
	// open. Recomputed differently every time is a board that moves under you.
	expect(pack(dense, { spacing: SPACING })).toEqual(pack(dense, { spacing: SPACING }))
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

/**
 * §7.2's list is the canvas narrowed, not a sixth screen. Both filters are
 * views (ADR 0016): filtering on the server would make "show me everything" a
 * second request.
 */
test('the flagged view keeps finished work, because a flagged node is usually finished', () => {
	const board: Projection = {
		nodes: [
			{ id: 'done-aaaa', title: 'Done', status: 'done', dependsOn: [], flagged: true },
			{ id: 'ready-bbbb', title: 'Ready', status: 'ready', dependsOn: [], flagged: false },
		],
	}

	// Done is off by default, so the plain board hides the flagged node.
	expect(visible(board, { withDone: false, onlyFlagged: false }).nodes.map((n) => n.id)).toEqual([
		'ready-bbbb',
	])

	// Asking for the flagged ones has to show it anyway — §2.8's flag is mostly
	// a finished node's, and a list that hides them is an empty list.
	expect(visible(board, { withDone: false, onlyFlagged: true }).nodes.map((n) => n.id)).toEqual([
		'done-aaaa',
	])

	expect(visible(board, { withDone: true, onlyFlagged: false }).nodes).toHaveLength(2)
})
