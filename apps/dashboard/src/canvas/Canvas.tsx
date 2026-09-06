import type { Projection } from '@besober/schema'
import cytoscape, { type Core, type NodeSingular } from 'cytoscape'
import { useEffect, useRef } from 'react'
import { drift, elementsOf, glow, type Point, pack, relax } from './graph.js'
import { type Resolve, sameShape, stylesheet } from './paint.js'

/**
 * How much further apart than the drag found it an edge stretches before the
 * far node follows (ADR 0039 §7).
 *
 * Relative, not absolute. The absolute version was a length the placed layout
 * never satisfied — rings put connected nodes on chords, and on a real 39-node
 * board 38 of 45 edges opened longer than it — so every mousedown hauled two
 * thirds of the graph inward before the pointer had moved at all.
 *
 * Around half a node's spacing: far enough that a nudge is a nudge, close
 * enough that a real drag brings its neighbours.
 */
const SLACK = 60

/**
 * Centre to centre between two nodes that sit side by side. Set by the label,
 * not the circle: an 18px node under a 96px title needs the title's room.
 */
const SPACING = 112

/**
 * The float. Small enough that ADR 0040's no-overlap arithmetic still holds —
 * the gap between two placed nodes is around 94px and this closes at most ten
 * of them — and slow enough that no frame moves anything a whole pixel.
 */
const AMPLITUDE = 3.5
const PERIOD = 7000

/** How long the hovered node takes to come to rest, and to start again. */
const PIN_MS = 180

/**
 * How much of the remaining slack a follower takes up per frame, and how long
 * it goes on catching up after the hand lets go. A fifth a frame is settled
 * inside half a second, which is where these two meet.
 */
const TOW = 0.2
const COAST_FRAMES = 40

/**
 * The bridge between theme.css and a canvas. Cytoscape brings its own colour
 * parser and knows none of `var()`, `color-mix()` or `oklch()`; a 2D context
 * knows all three, because it is the browser's.
 *
 * The conversion is a painted pixel, read back. `ctx.fillStyle` hands back what
 * it was given — `oklch(…)` in, `oklch(…)` out — which Cytoscape rejects just
 * as loudly as the original. A bitmap has no colour space but sRGB, so what
 * comes out of `getImageData` is a number Cytoscape can read.
 *
 * The computed style is read live, so a theme that changes underneath is one
 * `cy.style()` call away rather than a reload.
 */
const resolver = (): Resolve => {
	const paint = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
	const root = getComputedStyle(document.documentElement)
	// A failed assignment leaves `fillStyle` untouched, so the only way to tell
	// that apart from success is to start from a colour nothing else uses.
	const UNPARSED = '#ff00ff'

	return (css) => {
		const filled = css.replace(/var\((--[\w-]+)\)/g, (_, name: string) =>
			root.getPropertyValue(name).trim(),
		)
		if (paint === null) return filled

		paint.fillStyle = UNPARSED
		paint.fillStyle = filled
		// Hand the raw expression on rather than a colour nobody chose: Cytoscape
		// names what it could not read, and a silent magenta node would be a
		// worse bug report than a warning.
		if (paint.fillStyle === UNPARSED) return filled

		paint.clearRect(0, 0, 1, 1)
		paint.fillRect(0, 0, 1, 1)
		const [r = 0, g = 0, b = 0, a = 255] = paint.getImageData(0, 0, 1, 1).data
		return `rgba(${r}, ${g}, ${b}, ${a / 255})`
	}
}

const number = (name: string): number =>
	Number(getComputedStyle(document.documentElement).getPropertyValue(name))

export const Canvas = ({
	projection,
	onPick,
}: {
	readonly projection: Projection
	/** A node was tapped, or the background was. Null is "nothing is selected". */
	readonly onPick?: (id: string | null) => void
}): React.JSX.Element => {
	const box = useRef<HTMLDivElement>(null)
	const bloom = useRef<HTMLDivElement>(null)
	const cy = useRef<Core | null>(null)
	const drawn = useRef<Projection | null>(null)
	// Where each node lives. What is drawn is this plus a few pixels of drift,
	// so the float is presentation and the drag constraint still reasons about
	// one position per node rather than about a moving target.
	const rest = useRef<Map<string, Point>>(new Map())
	// The edge list, kept rather than rebuilt: the drag constraint reads it on
	// every frame, and it only changes when the graph does.
	const wires = useRef<readonly (readonly [string, string])[]>([])
	// Through a ref, so a new callback on every render does not tear down the
	// instance and re-place every node on the board.
	const pick = useRef(onPick)
	pick.current = onPick

	useEffect(() => {
		const container = box.current
		if (container === null) return

		const resolve = resolver()
		const instance = cytoscape({
			container,
			style: stylesheet(resolve),
			layout: { name: 'preset' },
		})
		cy.current = instance

		// The glow is a DOM element above the graph, not a Cytoscape style.
		// `underlay` draws around the bounding box — a square on a circle — and
		// `underlay-shape` is silently ignored by a build that does not know it.
		const light = (node: NodeSingular): void => {
			const el = bloom.current
			if (el === null) return
			const at = node.renderedPosition()
			const radius = node.renderedWidth() / 2

			el.style.left = `${at.x - radius}px`
			el.style.top = `${at.y - radius}px`
			el.style.width = `${radius * 2}px`
			el.style.height = `${radius * 2}px`
			el.style.boxShadow = glow(radius, node.style('background-color') as string, {
				extent: number('--glow-extent'),
				power: number('--glow-power'),
			})
		}

		// Hidden by dropping the light, not by fading the element: `opacity`
		// composites both blurs as one layer and turns a halo into a grey smear
		// (ADR 0039 §6).
		const dark = (): void => {
			if (bloom.current !== null) bloom.current.style.boxShadow = 'none'
		}

		// `prefers-reduced-motion` keeps the bloom and drops the growth: the light
		// says which node this is, the 1.2× is the part that moves.
		const still = matchMedia('(prefers-reduced-motion: reduce)')

		// How much of its own drift a node is currently allowed, 0 to 1. The node
		// under the pointer goes to 0: a target that keeps moving is a target
		// that slips out from under the hand, and 3.5px is enough to feel on
		// something you are trying to hold. It eases rather than snaps, because a
		// 3.5px jump the moment the pointer arrives is the same problem in one
		// frame.
		const calm = new Map<string, number>()
		let under: string | null = null

		instance.on('mouseover', 'node', (event) => {
			const node = event.target as NodeSingular
			if (!still.matches) node.addClass('lit')
			under = node.id()
			light(node)

			// What this one touches, and everything else out of the way. On a
			// board of 200 the lines are only legible once the rest steps back.
			const near = node.closedNeighborhood()
			instance.elements().difference(near).addClass('faded')
			near.edges().addClass('traced')
		})
		instance.on('mouseout', 'node', (event) => {
			;(event.target as NodeSingular).removeClass('lit')
			under = null
			instance.elements().removeClass('faded traced')
			dark()
		})
		// A tap opens the panel; a tap on nothing closes it. `tap` rather than
		// Cytoscape's own `select`/`unselect`, because moving from one node to
		// another fires both and their order decides whether the panel ends up
		// showing the new node or nothing.
		instance.on('tap', 'node', (event) => pick.current?.((event.target as NodeSingular).id()))
		instance.on('tap', (event) => {
			if (event.target === instance) pick.current?.(null)
		})

		instance.on('position', 'node.lit', (event) => light(event.target as NodeSingular))
		// A pan or a zoom moves every node at once; following them all would be a
		// frame budget spent on a halo nobody is looking at.
		instance.on('viewport', dark)

		// The float, as an offset over the resting places. Reduced motion turns
		// the amplitude off rather than turning the loop off, so a drag still
		// paints through exactly the same path.
		const float = () => ({ amplitude: still.matches ? 0 : AMPLITUDE, period: PERIOD })

		const breathe = (elapsed: number): void => {
			const step = elapsed / PIN_MS
			for (const id of new Set([...calm.keys(), ...(under === null ? [] : [under])])) {
				const want = id === under ? 0 : 1
				const now = calm.get(id) ?? 1
				const next = now < want ? Math.min(want, now + step) : Math.max(want, now - step)
				if (next === 1) calm.delete(id)
				else calm.set(id, next)
			}
		}

		const settle = (now: number): void => {
			instance.batch(() => {
				for (const [id, at] of rest.current) {
					// The pointer owns the node it is holding, and owns it outright.
					// Cytoscape moves a dragged node by a delta from wherever it
					// currently is, so a position written underneath does not merely
					// displace it once — the next delta lands on the displaced value
					// and the node walks out from under the hand.
					if (grabbing && id === grabbed) continue

					const by = drift(id, now, float())
					const much = calm.get(id) ?? 1
					instance.getElementById(id).position({ x: at.x + by.x * much, y: at.y + by.y * much })
				}
			})
		}

		// The node the pointer has hold of, and how many frames of catching up
		// its followers still have coming. A follower that stops halfway because
		// the hand stopped moving leaves the edge over its limit.
		let grabbed: string | null = null
		let grabbing = false
		// The node whose drag the followers are answering, and where the board was
		// when that drag began. Both null until the pointer actually moves.
		let held: string | null = null
		let since: ReadonlyMap<string, Point> | null = null
		let coasting = 0

		instance.on('grab', 'node', (event) => {
			grabbed = (event.target as NodeSingular).id()
			grabbing = true
		})
		instance.on('free', 'node', () => {
			grabbing = false
			grabbed = null
			coasting = COAST_FRAMES
		})

		// Where the pointer put it, less whatever float it would have had there,
		// so that letting go leaves the node exactly where the hand did and the
		// drift resumes from that new resting place rather than snapping.
		instance.on('drag', 'node', (event) => {
			const node = event.target as NodeSingular
			const id = node.id()
			const by = drift(id, performance.now(), float())
			const much = calm.get(id) ?? 1
			const at = node.position()
			rest.current.set(id, { x: at.x - by.x * much, y: at.y - by.y * much })

			// The first frame of a real drag, and not a moment sooner. `grab` fires
			// on mousedown, so starting here is what keeps a plain click from
			// pulling anything: a click grabs and frees without ever passing
			// through this handler.
			if (held !== id) {
				held = id
				since = new Map([...rest.current].map(([at_, point]) => [at_, { ...point }]))
			}
			coasting = Number.POSITIVE_INFINITY
		})

		let last = performance.now()
		let frame = requestAnimationFrame(function tick(now) {
			frame = requestAnimationFrame(tick)

			// Relaxing here rather than on the drag event is what makes a
			// follower lag: it closes a fraction of the gap per frame, and the
			// frames keep coming after the hand has stopped.
			if (held !== null && since !== null) {
				rest.current = relax(rest.current, wires.current, {
					since,
					slack: SLACK,
					held,
					ease: TOW,
				})
				if (--coasting <= 0) {
					held = null
					since = null
				}
			}

			breathe(now - last)
			last = now
			// Nothing to paint when nothing is moving: with reduced motion and no
			// hand on the board, a frame has no work in it.
			if (!still.matches || held !== null || calm.size > 0) settle(now)
		})

		const theme = matchMedia('(prefers-color-scheme: light)')
		const repaint = (): void => {
			instance.style(stylesheet(resolve))
		}
		theme.addEventListener('change', repaint)

		return () => {
			cancelAnimationFrame(frame)
			theme.removeEventListener('change', repaint)
			instance.destroy()
			cy.current = null
			// What was drawn went with the instance. Without this the next mount
			// finds a record of a picture that no longer exists anywhere, decides
			// nothing changed, and repaints an empty graph in place.
			drawn.current = null
			rest.current = new Map()
		}
	}, [])

	useEffect(() => {
		const instance = cy.current
		if (instance === null) return

		const before = drawn.current
		drawn.current = projection

		// A poll every couple of seconds that rebuilt the graph would re-run the
		// layout, and every node on screen would jump while somebody read it.
		if (before !== null && sameShape(before, projection)) {
			instance.batch(() => {
				for (const node of projection.nodes) {
					const drawn = instance.getElementById(node.id)
					drawn.data('status', node.status)
					drawn.data('label', node.title)
				}
			})
			return
		}

		// Placed, not simulated (ADR 0040). Positions are not board state
		// (ADR 0016), so they are computed fresh every time the shape changes —
		// and computing them is a loop over the nodes, not a settling animation
		// nobody wanted to watch.
		const placed = pack(projection, { spacing: SPACING })
		rest.current = placed
		wires.current = projection.nodes.flatMap((node) =>
			node.dependsOn.filter((from) => placed.has(from)).map((from) => [from, node.id] as const),
		)

		instance.elements().remove()
		instance.add(
			elementsOf(projection).map((element) => {
				if (element.group !== 'nodes') return element
				const at = placed.get(element.data.id ?? '')
				// A copy, and the copy is the whole point. Cytoscape keeps the
				// object it is handed and `position()` gives that same object back
				// — so sharing one with `rest` would make every frame's drift an
				// offset from the last frame's drift rather than from the resting
				// place, and the board would slide off the screen in a smooth
				// accelerating arc with nothing in the code that says "move".
				return at === undefined ? element : { ...element, position: { ...at } }
			}),
		)

		instance.fit(undefined, 48)
		// `fit` will happily zoom in, and on a small board it zooms to 2× and
		// turns a dense picture into a poster. Out is useful; in is not.
		if (instance.zoom() > 1) {
			instance.zoom(1)
			instance.center()
		}
	}, [projection])

	return (
		<div className="relative h-full w-full">
			{/*
			  Sized, not positioned. Cytoscape puts a class on its container and
			  ships an unlayered rule setting `position: relative` for it — and an
			  unlayered rule beats every `@layer utilities` one, which is where
			  Tailwind v4 keeps `absolute`. The container came out 0px tall with
			  no error anywhere: the class was applied and simply outranked.
			*/}
			<div ref={box} className="h-full w-full" />
			<div
				ref={bloom}
				className="pointer-events-none absolute z-10 rounded-full"
				style={{ boxShadow: 'none' }}
			/>
		</div>
	)
}
