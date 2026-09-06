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

export interface RelaxOptions {
	/** The longest an edge may be drawn before the far node comes along. */
	readonly max: number
	/** The node under the pointer. It never moves. */
	readonly held: string
	/** How far a pull travels. Three hops is enough; more is motion nobody asked for. */
	readonly passes?: number
}

/**
 * An edge has a maximum length (ADR 0039 §7). An edge stretched across the
 * window has stopped saying anything about adjacency, which is the only thing
 * this picture encodes, so past the limit the far node follows.
 *
 * The pull starts at the hand and travels outward, one hop per pass. It is not
 * the limit enforced everywhere at once: that way the first drag of a session
 * tidies the whole board, and the far side rearranges itself while somebody is
 * looking at a node they never touched.
 *
 * Positions are not board state (ADR 0016) — they live for the session and are
 * placed again when the board opens — which is what makes moving other
 * people's nodes around free. Nothing here is saved.
 *
 * New positions out; the ones handed in are not touched.
 */
export const relax = (
	positions: ReadonlyMap<string, Point>,
	edges: readonly (readonly [string, string])[],
	{ max, held, passes = 3 }: RelaxOptions,
): Map<string, Point> => {
	const next = new Map([...positions].map(([id, at]) => [id, { ...at }]))
	// What the wave has reached. Anything in here is an anchor for the next hop
	// and never moves again, which is also what keeps the held node still.
	const reached = new Set([held])

	for (let pass = 0; pass < passes; pass++) {
		let moved = false

		for (const [from, to] of edges) {
			// One end anchored and one end loose, or this edge is not the wave's
			// business yet — edge order is whatever Cytoscape hands over, so the
			// hop it belongs to is decided by the passes, not by the list.
			const anchor = reached.has(from) ? from : reached.has(to) ? to : null
			if (anchor === null || (reached.has(from) && reached.has(to))) continue

			const follower = anchor === from ? to : from
			const still = next.get(anchor)
			const loose = next.get(follower)
			if (still === undefined || loose === undefined) continue

			const dx = loose.x - still.x
			const dy = loose.y - still.y
			const distance = Math.hypot(dx, dy)
			// Two nodes in the same place have no direction to be pulled along.
			if (distance === 0) continue

			if (distance > max) {
				const pull = (distance - max) / distance
				next.set(follower, { x: loose.x - dx * pull, y: loose.y - dy * pull })
				moved = true
			}
			reached.add(follower)
		}

		if (!moved && pass > 0) break
	}

	return next
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
