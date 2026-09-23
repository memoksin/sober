import { LogLine } from '@besober/schema'
import { expect, test } from 'vitest'
import { atBottom, MARK, TONE, TOOL, TOOL_FALLBACK, toolMark } from './data.js'

test('every kind a log line can be has a mark and a colour', () => {
	// The shape is the wire's, so a host adding an event type that `tail` learns
	// to render cannot reach the screen as an undefined mark.
	for (const kind of LogLine.shape.kind.options) {
		expect(MARK[kind], kind).toBeTruthy()
		expect(TONE[kind], kind).toMatch(/^var\(--/)
	}
})

test('the host’s own stderr does not read like ordinary output', () => {
	expect(TONE.raw).not.toBe(TONE.text)
})

test('no tone borrows a status colour', () => {
	for (const [kind, colour] of Object.entries(TONE)) expect(colour, kind).not.toMatch(/--status-/)
})

test('a box scrolled to the bottom is following, and one scrolled up is not', () => {
	expect(atBottom({ scrollTop: 800, clientHeight: 200, scrollHeight: 1000 })).toBe(true)
	expect(atBottom({ scrollTop: 100, clientHeight: 200, scrollHeight: 1000 })).toBe(false)
})

test('a fraction of a pixel off the bottom is still the bottom', () => {
	// A device pixel ratio that is not 1 puts a fraction into every one of these
	// numbers. Compared exactly, a screen nobody has touched reads as scrolled
	// up, and the tail stops following without anyone asking it to.
	expect(atBottom({ scrollTop: 799.6, clientHeight: 200, scrollHeight: 1000 })).toBe(true)
})

test('every listed tool has its own glyph, and none of them is a colour', () => {
	const glyphs = Object.values(TOOL)
	expect(new Set([...glyphs, TOOL_FALLBACK]).size).toBe(glyphs.length + 1)
	for (const name of ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'Task', 'WebFetch'])
		expect(TOOL[name.toLowerCase()], name).toBeTruthy()
	for (const glyph of glyphs) expect(glyph).not.toMatch(/var\(--|#[0-9a-f]{3}/i)
})

test('a tool is found whatever its case, and one nobody listed still gets a mark', () => {
	expect(toolMark(' Bash ')).toBe(toolMark('bash'))
	expect(toolMark('command')).toBe(TOOL_FALLBACK)
})
