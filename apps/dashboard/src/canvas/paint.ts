import type { Projection } from '@besober/schema'
import { STATUSES } from '@besober/schema'

/**
 * A CSS colour expression, resolved to something Cytoscape can parse.
 *
 * Cytoscape draws to a canvas and brings its own colour parser, so it never
 * sees theme.css and does not know `var()`, `color-mix()` or `oklch()`. The
 * browser knows all three: the caller hands over a function that asks it.
 */
export type Resolve = (css: string) => string

export interface Rule {
	readonly selector: string
	readonly style: Readonly<Record<string, string | number>>
}

/** Diameter. `done` is smaller because it is over (ADR 0039 §1). */
const SIZE = 18
const DONE_SIZE = 12

/**
 * The canvas, in Cytoscape's terms. Colour means status and nothing else
 * (ADR 0039 §2), so every rule that carries a colour is keyed by one.
 */
export const stylesheet = (resolve: Resolve): Rule[] => [
	{
		selector: 'node',
		style: {
			width: SIZE,
			height: SIZE,
			// The rim is on every node, not only the lit one: without it a dark
			// node on a dark ground has no edge at all.
			'border-width': 1.5,
			label: 'data(label)',
			'font-size': 10,
			'font-family': 'ui-sans-serif, system-ui, sans-serif',
			color: resolve('var(--ink-dim)'),
			'text-valign': 'bottom',
			'text-margin-y': 5,
			'text-max-width': '96px',
			'text-wrap': 'ellipsis',
			// Zoomed out far enough, every label is illegible and all of them
			// together are a grey wash over the shape — which is the thing you
			// zoomed out to see.
			'min-zoomed-font-size': 7,
			// Only the node under the pointer grows, and it grows on its own
			// clock: transitions live on the states that animate (ADR 0039 §6).
			'transition-duration': 0,
		},
	},
	...STATUSES.map(
		(status): Rule => ({
			selector: `node[status="${status}"]`,
			style: {
				'background-color': resolve(`var(--status-${status})`),
				'border-color': resolve(
					`color-mix(in oklch, var(--rim-to) var(--rim-mix), var(--status-${status}))`,
				),
			},
		}),
	),
	{
		selector: 'node[status="done"]',
		style: { width: DONE_SIZE, height: DONE_SIZE, 'font-size': 9 },
	},
	{
		selector: 'node.lit',
		style: {
			width: SIZE * 1.2,
			height: SIZE * 1.2,
			'transition-property': 'width height',
			'transition-duration': 130,
			'transition-timing-function': 'ease-out',
		},
	},
	{
		selector: 'node[status="done"].lit',
		style: { width: DONE_SIZE * 1.2, height: DONE_SIZE * 1.2 },
	},
	{
		selector: 'node:selected',
		// Quieter than hover: selection persists, and something that persists
		// should not shout (ADR 0039 §6).
		style: { 'border-width': 2.5 },
	},
	{
		selector: 'edge',
		style: {
			width: 1,
			'line-color': resolve('var(--line)'),
			'curve-style': 'straight',
			'target-arrow-shape': 'triangle',
			'target-arrow-color': resolve('var(--line)'),
			'arrow-scale': 0.6,
		},
	},
	// Everything below is a state, and states come last. Cytoscape resolves by
	// order and not by specificity — the last matching rule wins — so a rule
	// for `edge.traced` written above `edge` sets a colour that `edge` takes
	// straight back, and nothing anywhere reports it.
	{
		// Cytoscape ships a black rounded-rectangle overlay on `:active`. It is
		// drawn around the bounding box, which on a circle is a square, and it
		// was the third square found while chasing one artefact.
		//
		// It sits above the base rules and below `edge.traced`, whose halo is an
		// overlay of its own: killing the default must not kill that.
		selector: ':active',
		style: { 'overlay-opacity': 0 },
	},
	{
		// Everything that is not the hovered node or one of its neighbours. The
		// question a board answers is "what does this one touch?", and on a
		// dense canvas that is unreadable until the rest steps back.
		selector: '.faded',
		style: {
			opacity: 0.12,
			'transition-property': 'opacity',
			'transition-duration': 130,
			'transition-timing-function': 'ease-out',
		},
	},
	{
		// The edges into and out of the hovered node. Dimming alone leaves the
		// lines the same grey they always were, and the lines are the answer.
		//
		// They go to the brightest ink rather than a status colour: an edge
		// belongs to two nodes and has no status of its own, so colouring it
		// would be the first thing on this canvas to mean nothing (§2).
		//
		// The halo is two bands, not a blur. Cytoscape has no shadow property at
		// all — nothing in 3.34's style set blurs anything — and `underlay` and
		// `overlay` are the only things that draw outside an element's own
		// shape. ADR 0039 §6 ruled `underlay` out for nodes because there it is
		// the bounding box, which on a circle is a square; on a line there is no
		// bounding box to get wrong, it follows the path.
		//
		// One band, and it hugs the line. A second wider one under it was tried
		// and read as a border: an unblurred band has a hard outer edge, and a
		// long straight one is exactly what an eye picks out. Kept narrow enough
		// that its edge reads as the thickness of the line rather than as an
		// outline around it.
		selector: 'edge.traced',
		style: {
			width: 1.6,
			'line-color': resolve('var(--ink)'),
			'target-arrow-color': resolve('var(--ink)'),
			'arrow-scale': 0.85,
			'overlay-color': resolve('var(--ink)'),
			'overlay-opacity': 0.07,
			'overlay-padding': 4,
			'transition-property': 'width line-color target-arrow-color overlay-opacity',
			'transition-duration': 130,
			'transition-timing-function': 'ease-out',
		},
	},
]

/**
 * Whether two projections draw the same picture — same nodes, same edges.
 *
 * ADR 0036 chose polling, and a poll that rebuilt the graph would re-run the
 * layout every couple of seconds, moving every node on screen while somebody
 * was reading it. When the shape holds, the canvas repaints in place; when it
 * does not, the picture genuinely changed and a new layout is the honest
 * answer.
 *
 * Order is not shape: `core` promises nothing about the order it reports nodes
 * in, and a re-layout would be a poor way to discover that.
 */
export const sameShape = (before: Projection, after: Projection): boolean =>
	shapeOf(before) === shapeOf(after)

const shapeOf = (projection: Projection): string =>
	projection.nodes
		.map((node) => `${node.id}<${[...node.dependsOn].sort().join(',')}`)
		.sort()
		.join('|')
