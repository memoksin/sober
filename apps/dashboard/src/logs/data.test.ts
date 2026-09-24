import { LogLine } from '@besober/schema'
import { expect, test } from 'vitest'
import {
	atBottom,
	MARK,
	matchesLine,
	modelOf,
	providerForModel,
	TONE,
	TOOL,
	TOOL_FALLBACK,
	toolMark,
} from './data.js'

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

test('the model is read out of a host command line', () => {
	expect(modelOf('claude --model claude-opus-5-5 --resume')).toBe('claude-opus-5-5')
	expect(modelOf('claude --model=claude-opus-5-5')).toBe('claude-opus-5-5')
	expect(modelOf('some-cli -m gpt-5.4')).toBe('gpt-5.4')
	expect(modelOf('claude --resume')).toBeNull()
})

test('the provider comes from the model id, not the host', () => {
	expect(providerForModel('claude-opus-5-5')).toBe('anthropic')
	// openrouter routes through a host that names neither Anthropic nor Claude —
	// only the model id does, and it must still resolve to Anthropic.
	expect(providerForModel('anthropic/claude-opus-5-5')).toBe('anthropic')
	expect(providerForModel('openai/gpt-5.4')).toBe('openai')
	expect(providerForModel('o3-mini')).toBe('openai')
	expect(providerForModel('google/gemini-2.5-pro')).toBe('google')
	expect(providerForModel('mistralai/mistral-large')).toBe('mistral')
	expect(providerForModel('codestral-latest')).toBe('mistral')
	expect(providerForModel('local/custom-model')).toBe('other')
})

test('a find query checks text, detail and tool, and an empty query matches everything', () => {
	const line = { text: 'wrote the middleware', tool: 'Write', detail: null }
	expect(matchesLine(line, '')).toBe(true)
	expect(matchesLine(line, 'middleware')).toBe(true)
	expect(matchesLine(line, 'WRITE')).toBe(true)
	expect(matchesLine(line, 'nope')).toBe(false)
	// A line-detail hasn't reached yet still searches on text and tool alone.
	expect(matchesLine({ text: 'plain', tool: null }, 'plain')).toBe(true)
	expect(matchesLine({ text: 'plain', tool: null, detail: 'the extra bit' }, 'extra')).toBe(true)
})
