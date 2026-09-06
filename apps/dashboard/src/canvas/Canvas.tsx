import type { Projection } from '@besober/schema'
import cytoscape, { type Core, type NodeSingular } from 'cytoscape'
import { useEffect, useRef } from 'react'
import { drift, elementsOf, glow, type Point, pack, relax } from './graph.js'
import { type Resolve, sameShape, stylesheet } from './paint.js'

/**
 * The longest an edge is drawn before the far node follows (ADR 0039 §7).
 * Measured on the spike rather than reasoned about: past roughly this, an edge
 * has stopped saying anything about adjacency.
 */
const MAX_EDGE = 170

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

export const Canvas = ({ projection }: { readonly projection: Projection }): React.JSX.Element => {
	const box = useRef<HTMLDivElement>(null)
	const bloom = useRef<HTMLDivElement>(null)
	const cy = useRef<Core | null>(null)
	const drawn = useRef<Projection | null>(null)
	// Where each node lives. What is drawn is this plus a few pixels of drift,
	// so the float is presentation and the drag constraint still reasons about
	// one position per node rather than about a moving target.
	const rest = useRef<Map<string, Point>>(new Map())

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

		instance.on('mouseover', 'node', (event) => {
			const node = event.target as NodeSingular
			if (!still.matches) node.addClass('lit')
			light(node)

			// What this one touches, and everything else out of the way. On a
			// board of 200 the lines are only legible once the rest steps back.
			const near = node.closedNeighborhood()
			instance.elements().difference(near).addClass('faded')
			near.edges().addClass('traced')
		})
		instance.on('mouseout', 'node', (event) => {
			;(event.target as NodeSingular).removeClass('lit')
			instance.elements().removeClass('faded traced')
			dark()
		})
		instance.on('position', 'node.lit', (event) => light(event.target as NodeSingular))
		// A pan or a zoom moves every node at once; following them all would be a
		// frame budget spent on a halo nobody is looking at.
		instance.on('viewport', dark)

		// The float, as an offset over the resting places. Reduced motion turns
		// the amplitude off rather than turning the loop off, so a drag still
		// paints through exactly the same path.
		const float = () => ({ amplitude: still.matches ? 0 : AMPLITUDE, period: PERIOD })

		const settle = (now: number): void => {
			instance.batch(() => {
				for (const [id, at] of rest.current) {
					const by = drift(id, now, float())
					instance.getElementById(id).position({ x: at.x + by.x, y: at.y + by.y })
				}
			})
		}

		let frame = requestAnimationFrame(function tick(now) {
			frame = requestAnimationFrame(tick)
			if (!still.matches) settle(now)
		})

		instance.on('drag', 'node', (event) => {
			const node = event.target as NodeSingular
			const held = node.id()
			const now = performance.now()

			// The pointer owns the held node, so its resting place is read back
			// out of where the pointer put it — otherwise the next frame would
			// paint it back to where it was and the drag would fight the float.
			const by = drift(held, now, float())
			const at = node.position()
			rest.current.set(held, { x: at.x - by.x, y: at.y - by.y })

			const edges = instance
				.edges()
				.map((edge) => [edge.source().id(), edge.target().id()] as const)
			rest.current = relax(rest.current, edges, { max: MAX_EDGE, held })
			settle(now)
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
