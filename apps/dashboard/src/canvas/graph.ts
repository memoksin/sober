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
	/** Centre-to-centre distance between two nodes that end up side by side. */
	readonly spacing: number
}

/**
 * Where every node sits when the board opens: rings, filled from the middle
 * out, ordered so that connected nodes are neighbours on the ring.
 *
 * Placed rather than simulated. A force layout has no term forbidding two
 * nodes from sharing a point, so a board opens with nodes on top of each other
 * and only separates them when something nudges the simulation — and given a
 * board of islands, which is what a young one is, it spreads until `fit` has
 * to zoom out past the size a label can be read at. Ring `k` is handed exactly
 * as many places as its circumference has room for, so nothing can overlap and
 * the whole thing is `O(n)`.
 *
 * The order around the rings is the graph: a breadth-first walk of each
 * component, biggest first. Without it a chain becomes chords across the whole
 * circle; with it a chain is an arc.
 */
export const pack = (projection: Projection, { spacing }: PackOptions): Map<string, Point> => {
	const placed = new Map<string, Point>()
	let ring = 0
	let seat = 0
	let seats = 1

	for (const id of order(projection)) {
		// Ring 0 is the middle and holds one. Ring k has room for as many as fit
		// at `spacing` apart around a circle of radius `k * spacing`, which is
		// `2πk` — and the chord between two of them is never under `spacing`.
		if (seat === seats) {
			ring += 1
			seat = 0
			seats = Math.floor(2 * Math.PI * ring)
		}

		const angle = (2 * Math.PI * seat) / seats
		const radius = ring * spacing
		placed.set(id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) })
		seat += 1
	}

	return placed
}

/** Components, biggest first; within one, breadth-first from its first node. */
const order = (projection: Projection): string[] => {
	const near = new Map<string, string[]>(projection.nodes.map((node) => [node.id, []]))
	for (const node of projection.nodes)
		for (const from of node.dependsOn) {
			// Undirected here: which way a dependency points says nothing about
			// which two circles want to be drawn next to each other.
			near.get(from)?.push(node.id)
			near.get(node.id)?.push(from)
		}

	const seen = new Set<string>()
	const components: string[][] = []

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
		components.push(component)
	}

	// Biggest in the middle: it is the part with structure to read, and the
	// middle is where the eye starts. Ties keep the order `core` reported, so
	// the same board is placed the same way twice.
	return components.sort((a, b) => b.length - a.length).flat()
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
