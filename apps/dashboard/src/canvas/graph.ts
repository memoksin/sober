import type { Projection } from '@besober/schema'

/** What Cytoscape is handed. Narrower than its own type, on purpose. */
export interface Element {
	readonly group: 'nodes' | 'edges'
	readonly data: Readonly<Record<string, string>>
}

export interface Point {
	readonly x: number
	readonly y: number
}

/** What the board is narrowed to before it is drawn. */
export interface View {
	/** Finished work is off by default — after a few weeks it is most of a board. */
	readonly withDone: boolean
	/** §7.2's list: the canvas narrowed to the nodes whose decision moved. */
	readonly onlyFlagged: boolean
}

/**
 * A view filter, not a server one (ADR 0016): filtering on the server would
 * make "show me everything" a second request.
 *
 * The flagged view ignores the done filter on purpose. A flagged node is
 * usually a finished one (§2.8), so hiding done work would empty the list the
 * reader just asked for.
 */
export const visible = (projection: Projection, view: View): Projection => ({
	nodes: projection.nodes.filter(
		(node) =>
			(view.onlyFlagged ? node.flagged : true) &&
			(view.withDone || view.onlyFlagged || node.status !== 'done'),
	),
})

/**
 * The slim projection (ADR 0008) as a graph. Edges are the `dependsOn` lists —
 * there is no separate edge list, because a graph that carries both can
 * disagree with itself.
 *
 * An edge whose other end is not here is dropped. `core` can report a dangling
 * edge and §8.4 is explicit that one bad record does not take down a board;
 * Cytoscape throws on an edge with a missing endpoint, so without this the one
 * bad record takes down the canvas instead.
 */
export const elementsOf = (projection: Projection): Element[] => {
	const present = new Set(projection.nodes.map((node) => node.id))

	return projection.nodes.flatMap((node): Element[] => [
		{
			group: 'nodes',
			data: { id: node.id, label: node.title, status: node.status },
		},
		...node.dependsOn
			.filter((from) => present.has(from))
			// From what is finished to what is waiting: the direction a person
			// reads the board in.
			.map(
				(from): Element => ({
					group: 'edges',
					data: { id: `${from}->${node.id}`, source: from, target: node.id },
				}),
			),
	])
}

export interface PackOptions {
	/** The room one label needs, centre to centre. Every gap is a share of it. */
	readonly spacing: number
	/**
	 * Which way dependencies run. The long axis of the board goes on the long
	 * axis of the screen: `right` for a wide one, `down` for a phone.
	 */
	readonly flow?: 'right' | 'down'
}

/**
 * Where every node sits when the board opens (ADR 0072): each connected piece
 * of the graph in columns by dependency depth, the pieces packed onto shelves,
 * and the nodes that touch nothing in a grid after them.
 *
 * Placed rather than simulated, for ADR 0040's reasons — no two nodes share a
 * point, the same board opens the same way, and nothing settles. What changed
 * is the shape: rings put a dense join on chords across the circle, and the
 * one thing a person reads a board for — what waits on what — had no
 * direction on screen. Here every edge points the same way.
 */
export const pack = (
	projection: Projection,
	{ spacing, flow = 'right' }: PackOptions,
): Map<string, Point> => {
	// Along the flow, and across it. A label sits under its node and is wide
	// and short, so the room it needs depends on which side the neighbour is.
	const along = flow === 'right' ? spacing * 1.5 : spacing * 0.75
	const across = flow === 'right' ? spacing / 2 : spacing

	const { before, after } = links(projection)
	const blocks: Block[] = []
	const islands: string[] = []
	for (const component of components(projection)) {
		if (component.length === 1) islands.push(...component)
		else blocks.push(layered(component, before, after, along, across))
	}
	// Islands last: the structure is what there is to read, and it goes where
	// reading starts.
	if (islands.length > 0) blocks.push(grid(islands, along, across))

	/// Shelves about as long as the screen is against its short side: a/n/t// monitor is 16:10, a phone is about 1:2.
	const area = blocks.reduce((sum, b) => sum + (b.long + along) * (b.wide + across * 2), 0)
	const reach = Math.max(
		...blocks.map((b) => b.long),
		Math.sqrt(area) * (flow === 'right' ? 1.25 : 2),
	)

	const placed = new Map<string, Point>()
	let a = 0
	let c = 0
	let shelf = 0
	for (const block of blocks) {
		if (a > 0 && a + block.long > reach) {
			a = 0
			c += shelf + across * 2
			shelf = 0
		}
		for (const [id, at] of block.at) {
			const x = a + at.a
			const y = c + at.c
			placed.set(id, flow === 'right' ? { x, y } : { x: y, y: x })
		}
		a += block.long + along
		shelf = Math.max(shelf, block.wide)
	}

	return placed
}

/** A piece of the board, in along/across coordinates starting at zero. */
interface Block {
	readonly at: ReadonlyMap<string, { readonly a: number; readonly c: number }>
	/** From the first node's centre to the last, along the flow. */
	readonly long: number
	readonly wide: number
}

/** Each node's dependencies and dependants, among the nodes that are here. */
const links = (projection: Projection) => {
	const before = new Map<string, string[]>(projection.nodes.map((node) => [node.id, []]))
	const after = new Map<string, string[]>(projection.nodes.map((node) => [node.id, []]))
	for (const node of projection.nodes)
		for (const from of node.dependsOn) {
			if (!before.has(from)) continue
			before.get(node.id)?.push(from)
			after.get(from)?.push(node.id)
		}
	return { before, after }
}

/**
 * One component in columns. A node's column is the longest chain of
 * dependencies under it, so every edge points forward; a root is then pulled
 * up next to the first thing that waits on it, so a late root is not a line
 * across the whole piece.
 *
 * The order down each column is the mean of the neighbours already placed,
 * swept forward and back — it is what takes the crossings out of a dense
 * join. The first order is the breadth-first walk and every sort is stable, so
 * the same board lands the same way twice.
 */
const layered = (
	component: readonly string[],
	before: ReadonlyMap<string, readonly string[]>,
	after: ReadonlyMap<string, readonly string[]>,
	along: number,
	across: number,
): Block => {
	const layer = new Map<string, number>()
	// `core` can report a cycle, and §8.4 says one bad record does not take
	// down a board: an edge back into the walk is not followed.
	const depth = (id: string, walking: Set<string>): number => {
		const known = layer.get(id)
		if (known !== undefined) return known
		walking.add(id)
		let at = 0
		for (const from of before.get(id) ?? [])
			if (!walking.has(from)) at = Math.max(at, depth(from, walking) + 1)
		walking.delete(id)
		layer.set(id, at)
		return at
	}
	for (const id of component) depth(id, new Set())
	for (const id of component)
		if ((before.get(id) ?? []).length === 0) {
			const next = Math.min(...(after.get(id) ?? []).map((to) => layer.get(to) ?? 1))
			if (Number.isFinite(next)) layer.set(id, Math.max(0, next - 1))
		}

	const rows: string[][] = []
	for (const id of component) {
		const at = layer.get(id) ?? 0
		rows[at] = [...(rows[at] ?? []), id]
	}
	const columns = rows.filter((row) => row !== undefined)

	const slot = new Map<string, number>()
	const seat = (row: readonly string[]): void =>
		row.forEach((id, i) => {
			slot.set(id, i - (row.length - 1) / 2)
		})
	columns.forEach(seat)

	const mean = (id: string, toward: ReadonlyMap<string, readonly string[]>): number => {
		const known = (toward.get(id) ?? []).flatMap((other) => slot.get(other) ?? [])
		return known.length === 0
			? (slot.get(id) ?? 0)
			: known.reduce((sum, at) => sum + at, 0) / known.length
	}
	for (let sweep = 0; sweep < 4; sweep++) {
		const forward = sweep % 2 === 0
		for (const row of forward ? columns : [...columns].reverse()) {
			const key = new Map(row.map((id) => [id, mean(id, forward ? before : after)]))
			row.sort((a, b) => (key.get(a) ?? 0) - (key.get(b) ?? 0))
			seat(row)
		}
	}

	// ponytail: a column is as tall as its layer, so a join of fifty is one tall
	// column that `fit` zooms out for. Wrap wide layers if real boards get there.
	const tallest = Math.max(...columns.map((row) => row.length))
	const at = new Map<string, { a: number; c: number }>()
	columns.forEach((row, i) => {
		for (const id of row)
			at.set(id, { a: i * along, c: ((slot.get(id) ?? 0) + (tallest - 1) / 2) * across })
	})

	return { at, long: (columns.length - 1) * along, wide: (tallest - 1) * across }
}

/** The nodes that touch nothing, in a grid about as long as it is wide. */
const grid = (ids: readonly string[], along: number, across: number): Block => {
	const count = Math.ceil(Math.sqrt((ids.length * across) / along))
	return {
		at: new Map(
			ids.map((id, i) => [id, { a: (i % count) * along, c: Math.floor(i / count) * across }]),
		),
		long: (Math.min(count, ids.length) - 1) * along,
		wide: (Math.ceil(ids.length / count) - 1) * across,
	}
}

/** Connected components, biggest first; within one, breadth-first. */
const components = (projection: Projection): string[][] => {
	const near = new Map<string, string[]>(projection.nodes.map((node) => [node.id, []]))
	for (const node of projection.nodes)
		for (const from of node.dependsOn) {
			// Undirected here: a component is what touches what, either way.
			near.get(from)?.push(node.id)
			near.get(node.id)?.push(from)
		}

	const seen = new Set<string>()
	const found: string[][] = []

	for (const root of projection.nodes) {
		if (seen.has(root.id)) continue
		const component: string[] = []
		const queue = [root.id]
		seen.add(root.id)

		for (let at = 0; at < queue.length; at++) {
			const id = queue[at]
			if (id === undefined) continue
			component.push(id)
			for (const next of near.get(id) ?? []) {
				if (seen.has(next)) continue
				seen.add(next)
				queue.push(next)
			}
		}
		found.push(component)
	}

	// Ties keep the order `core` reported, so the same board is placed the
	// same way twice.
	return found.sort((a, b) => b.length - a.length)
}

export interface DriftOptions {
	/** The furthest a node strays, on either axis, from where it was placed. */
	readonly amplitude: number
	/** Roughly one wander. Varied per node, so nothing on the board marches. */
	readonly period: number
}

/**
 * How far a node has floated from its resting place, at a moment.
 *
 * `pack` puts every node exactly where it belongs and leaves it there, which
 * reads as pinned: the board looks like a diagram, and dragging one feels like
 * pulling something off a nail. A few pixels of slow wander says the same
 * layout is a surface things are sitting on.
 *
 * It is bounded by the amplitude on each axis, which is what keeps ADR 0040's
 * no-overlap arithmetic true: the gap between two placed nodes is far wider
 * than twice this.
 *
 * Two waves at rates that do not divide each other. One rate and one phase is
 * a straight line through the resting place, and a line reads as a slide
 * rather than a float. Both are seeded from the node's id, so nothing is
 * random, nothing marches in step, and the same board floats the same way
 * every time it is opened (ADR 0016 — positions are not state, so they have to
 * be reproducible instead).
 */
export const drift = (id: string, at: number, { amplitude, period }: DriftOptions): Point => {
	if (amplitude <= 0) return { x: 0, y: 0 }

	const seed = hash(id)
	const own = period * (0.75 + seed * 0.5)
	const t = (2 * Math.PI * at) / own

	return {
		x: amplitude * Math.sin(t + seed * 2 * Math.PI),
		y: amplitude * Math.sin(t * 0.61 + seed * 4 * Math.PI),
	}
}

/** FNV-1a, folded to 0..1. A hash and not a counter: order is not identity. */
const hash = (id: string): number => {
	let h = 2_166_136_261
	for (let i = 0; i < id.length; i++) {
		h ^= id.charCodeAt(i)
		h = Math.imul(h, 16_777_619)
	}
	return (h >>> 0) / 2 ** 32
}

export interface TowOptions {
	/** Where every node was when the drag began. */
	readonly since: ReadonlyMap<string, Point>
	/** How far the hand moves before anything follows it. */
	readonly slack: number
	/** The node under the pointer. It is wherever the pointer put it. */
	readonly held: string
	/** How much of the hand's movement each further hop passes on. */
	readonly falloff?: number
	/** How far the tow travels. Three hops; more is motion nobody asked for. */
	readonly hops?: number
	/**
	 * How much of the remaining distance a follower closes in one call. 1 lands
	 * it on its mark at once, which is a rod; a fraction is a tow — the edge
	 * stretches while the hand moves and comes back after it stops.
	 */
	readonly ease?: number
}

/**
 * Where the followers go while a node is being dragged (ADR 0039 §7).
 *
 * Every follower's mark is a pure function of one thing: how far the hand has
 * moved since the drag began. Not of where anything currently is — which is
 * what makes a press safe by construction rather than by threshold, and what
 * makes dragging back put everything back.
 *
 * It replaces a maximum edge length enforced every frame. That constraint only
 * ever moved a follower closer and never let one out, so every frame it ran was
 * a ratchet: a long press with a pixel of jitter hauled the board inward and
 * kept it. The deeper fault was that the placed layout (ADR 0040) was never the
 * constraint's fixed point, so there was always something for it to correct.
 * `sober-v0` had no such problem because its resting state *was* the
 * equilibrium of the function that ran during a drag.
 *
 * The hand's first `slack` pixels move nothing, so a nudge is a nudge.
 *
 * Positions are not board state (ADR 0016) — they live for the session and are
 * placed again when the board opens — which is what makes moving other
 * people's nodes around free. Nothing here is saved.
 *
 * New positions out; the ones handed in are not touched.
 */
export const tow = (
	positions: ReadonlyMap<string, Point>,
	edges: readonly (readonly [string, string])[],
	{ since, slack, held, falloff = 0.55, hops = 3, ease = 1 }: TowOptions,
): Map<string, Point> => {
	const next = new Map([...positions].map(([id, at]) => [id, { ...at }]))

	const from = since.get(held)
	const to = positions.get(held)
	if (from === undefined || to === undefined) return next

	const dx = to.x - from.x
	const dy = to.y - from.y
	const reach = Math.hypot(dx, dy)
	// Inside the slack the hand asks nothing of anyone, and their mark is where
	// the layout put them. Not an early return: a drag that goes out and comes
	// back inside the slack has to bring the followers back with it, and a
	// function that stops reading the hand there is the ratchet again in
	// miniature.
	const carried = reach <= slack ? 0 : (reach - slack) / reach

	for (const [id, share] of shares(edges, held, hops, falloff)) {
		const rest = since.get(id)
		const now = next.get(id)
		if (rest === undefined || now === undefined) continue

		const mark = { x: rest.x + dx * carried * share, y: rest.y + dy * carried * share }
		next.set(id, {
			x: now.x + (mark.x - now.x) * ease,
			y: now.y + (mark.y - now.y) * ease,
		})
	}

	return next
}

/**
 * How much of the hand's movement each node answers, by how many hops it is
 * from the hand. Breadth-first and undirected: which way a dependency points
 * says nothing about which circle is pulled by which.
 */
const shares = (
	edges: readonly (readonly [string, string])[],
	held: string,
	hops: number,
	falloff: number,
): Map<string, number> => {
	const near = new Map<string, string[]>()
	for (const [a, b] of edges) {
		near.set(a, [...(near.get(a) ?? []), b])
		near.set(b, [...(near.get(b) ?? []), a])
	}

	const share = new Map<string, number>()
	let front = [held]
	const seen = new Set([held])

	for (let hop = 1; hop <= hops && front.length > 0; hop++) {
		const nextFront: string[] = []
		for (const id of front)
			for (const neighbour of near.get(id) ?? []) {
				if (seen.has(neighbour)) continue
				seen.add(neighbour)
				share.set(neighbour, falloff ** hop)
				nextFront.push(neighbour)
			}
		front = nextFront
	}

	return share
}

export interface GlowOptions {
	/** How far past the node's edge the light reaches, as a fraction of its radius. */
	readonly extent: number
	readonly power: number
	/** Selection is the same light, quieter. */
	readonly strength?: number
}

/**
 * The bloom, as a `box-shadow` (ADR 0039 §6). Two stacked blurs: a single blur
 * reads as fog, two read as light, and both live inside the reach.
 *
 * Alpha is in the colour rather than on the element. `opacity` on the element
 * scales both blurs together and composites them as one layer, which turns a
 * bright halo into a grey smear — and `color-mix(…, transparent)` is the same
 * trap, because `transparent` is black at zero alpha and mixing towards it
 * drags a colour towards black.
 *
 * The reach is a fraction of the radius because nodes are not one size: `done`
 * renders smaller and the canvas zooms, so a pixel value is a glow that is
 * right once.
 */
export const glow = (
	radius: number,
	colour: string,
	{ extent, power, strength = 1 }: GlowOptions,
): string => {
	const lit = power * strength
	if (lit <= 0) return 'none'

	const reach = radius * extent
	const alpha = (of: number) => `oklch(from ${colour} l c h / ${Math.min(1, of * lit).toFixed(3)})`

	return (
		`0 0 ${(reach * 1.1).toFixed(2)}px ${(reach * 0.3).toFixed(2)}px ${alpha(1)}, ` +
		`0 0 ${(reach * 2.2).toFixed(2)}px 0 ${alpha(0.55)}`
	)
}
