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
 * Positions are not board state (ADR 0016) — they live for the session and the
 * layout re-simulates when the board opens — which is what makes moving other
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

	for (let pass = 0; pass < passes; pass++) {
		let moved = false

		for (const [from, to] of edges) {
			const a = next.get(from)
			const b = next.get(to)
			if (a === undefined || b === undefined) continue

			const dx = b.x - a.x
			const dy = b.y - a.y
			const distance = Math.hypot(dx, dy)
			// Two nodes in the same place have no direction to be pulled along.
			if (distance <= max || distance === 0) continue

			const pull = (distance - max) / distance
			if (from === held) next.set(to, { x: b.x - dx * pull, y: b.y - dy * pull })
			else if (to === held) next.set(from, { x: a.x + dx * pull, y: a.y + dy * pull })
			else {
				next.set(from, { x: a.x + (dx * pull) / 2, y: a.y + (dy * pull) / 2 })
				next.set(to, { x: b.x - (dx * pull) / 2, y: b.y - (dy * pull) / 2 })
			}
			moved = true
		}

		if (!moved) break
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
