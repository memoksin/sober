import type { Projection } from '@besober/schema'
import { STATUSES } from '@besober/schema'
import { expect, test } from 'vitest'
import { sameShape, stylesheet } from './paint.js'

/** Stands in for the browser, which is the only thing that can do this. */
const token = (css: string) => `resolved(${css})`

test('every status the schema has is a colour on the canvas', () => {
	// Cytoscape paints to a canvas, so it never sees theme.css — the colours
	// have to be read out and handed over. A ninth status would arrive here
	// with no colour and be drawn as whatever the default is.
	const painted = JSON.stringify(stylesheet(token))

	for (const status of STATUSES) expect(painted, status).toContain(`--status-${status})`)
})

test('it asks for no status colour the theme does not define', () => {
	const asked: string[] = []
	stylesheet((css) => {
		asked.push(css)
		return '#000'
	})

	for (const name of asked.flatMap((css) => [...css.matchAll(/--status-([a-z-]+)/g)]))
		expect(STATUSES, name[0] ?? '').toContain(name[1])
})

test('a state rule comes after the rule it overrides', () => {
	// Cytoscape resolves by order, not specificity: the last matching rule
	// wins. `edge.traced` written above `edge` sets a colour that `edge` takes
	// straight back, and nothing anywhere reports it — the halo appeared, the
	// white line did not, and both were in the same rule.
	const order = stylesheet(token).map((rule) => rule.selector)
	const after = (state: string, base: string) =>
		expect(order.indexOf(state), `${state} must come after ${base}`).toBeGreaterThan(
			order.indexOf(base),
		)

	after('node.lit', 'node')
	after('edge.traced', 'edge')
	after('.faded', 'edge')
	after('.faded', 'node')
	// The traced halo is an overlay, and `:active` sets `overlay-opacity: 0`.
	// Killing Cytoscape's default overlay must not kill ours.
	after('edge.traced', ':active')
})

test('a traced edge is ink, never a status colour', () => {
	// An edge belongs to two nodes and has no status of its own (ADR 0039 §2).
	// Painting it in one end's colour would make it the first thing here that
	// carries a colour meaning nothing.
	const traced = stylesheet(token).find((rule) => rule.selector === 'edge.traced')

	expect(JSON.stringify(traced)).not.toMatch(/--status-/)
	expect(traced?.style['line-color']).toBe('resolved(var(--ink))')
	expect(traced?.style['overlay-opacity']).toBeGreaterThan(0)
})

test('the click overlay is turned off', () => {
	// Cytoscape ships a black rounded-rectangle overlay on `:active`. It is
	// drawn around the bounding box, which on a circle is a square, and it cost
	// an evening to find the third time it appeared.
	const active = stylesheet(token).find((rule) => rule.selector === ':active')

	expect(active?.style['overlay-opacity']).toBe(0)
})

test('the selected node marks its neighbours, and hovering elsewhere still wins', () => {
	// The mark lasts as long as the panel, so it must not hide what a hover
	// asks for: it sits under `.faded` and `edge.traced`, and over `edge`.
	const rules = stylesheet(token)
	const order = rules.map((rule) => rule.selector)
	const at = (selector: string) => order.indexOf(selector)

	expect(at('edge.near')).toBeGreaterThan(at('edge'))
	expect(at('node.near')).toBeGreaterThan(at('node'))
	expect(at('edge.near')).toBeLessThan(at('.faded'))
	expect(at('edge.near')).toBeLessThan(at('edge.traced'))

	const near = rules.find((rule) => rule.selector === 'edge.near')
	expect(JSON.stringify(near)).not.toMatch(/--status-/)
	expect(near?.style['line-color']).toBe('resolved(var(--ink-dim))')
})

test('an edge shows which way it points', () => {
	// A head in the line's own grey reads as a thickening, not a direction.
	const edge = stylesheet(token).find((rule) => rule.selector === 'edge')

	expect(edge?.style['target-arrow-shape']).toBe('triangle')
	expect(edge?.style['target-arrow-color']).not.toBe(edge?.style['line-color'])
})

const board = (
	nodes: readonly (readonly [string, string, string[]])[],
	status = 'ready',
): Projection => ({
	nodes: nodes.map(([id, title, dependsOn]) => ({
		id,
		title,
		status: status as Projection['nodes'][number]['status'],
		dependsOn,
		flagged: false,
	})),
})

const two = board([
	['a', 'A', []],
	['b', 'B', ['a']],
])

/** The same board with one node changed, which is what a poll usually finds. */
const with_ = (id: string, change: Partial<Projection['nodes'][number]>): Projection => ({
	nodes: two.nodes.map((node) => (node.id === id ? { ...node, ...change } : node)),
})

test('the same board twice is the same shape — nothing is rebuilt', () => {
	expect(sameShape(two, two)).toBe(true)
})

test('a status that moved is still the same shape', () => {
	// The reason this exists. A poll every couple of seconds that rebuilt the
	// graph would re-run the layout, and every node on screen would jump while
	// somebody was reading it.
	expect(sameShape(two, with_('b', { status: 'running' }))).toBe(true)
})

test('a title that changed is still the same shape', () => {
	expect(sameShape(two, with_('a', { title: 'A, renamed' }))).toBe(true)
})

test('a node that arrived is a different shape', () => {
	const after = board([
		['a', 'A', []],
		['b', 'B', ['a']],
		['c', 'C', ['b']],
	])

	expect(sameShape(two, after)).toBe(false)
})

test('a node that went is a different shape', () => {
	expect(sameShape(two, board([['a', 'A', []]]))).toBe(false)
})

test('a dependency that changed is a different shape, even with the same nodes', () => {
	const after = board([
		['a', 'A', ['b']],
		['b', 'B', []],
	])

	expect(sameShape(two, after)).toBe(false)
})

test('the same nodes in a different order are the same shape', () => {
	// `core` makes no promise about the order it reports nodes in, and a
	// re-layout on every poll would be a bad way to find that out.
	const after = board([
		['b', 'B', ['a']],
		['a', 'A', []],
	])

	expect(sameShape(two, after)).toBe(true)
})
