import { LogLine, type LogLineInput } from '@besober/schema'
import { expect, test } from 'vitest'
import {
	atBottom,
	buildChecklist,
	EKG_BASELINE,
	EKG_SHAPE_DOUBLE,
	EKG_SHAPE_LOG,
	EKG_SHAPE_REGULAR,
	type EkgBeat,
	ekgPath,
	elapsedLabel,
	foldBody,
	groupLines,
	MARK,
	matchesLine,
	mergeThinkingVerbs,
	modelOf,
	nextVerb,
	providerForModel,
	spike,
	THINKING_VERBS,
	TONE,
	TOOL,
	TOOL_FALLBACK,
	toolMark,
} from './data.js'

const line = (over: LogLineInput): LogLine => LogLine.parse(over)

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

test('a tool line and its later output pair into one block', () => {
	const lines = [
		line({ kind: 'tool', text: 'Read', tool: 'Read', call: 'c1', detail: 'Read(x.ts)' }),
		line({ kind: 'output', text: '92 lines', call: 'c1', body: 'a\nb' }),
	]
	const blocks = groupLines(lines)
	expect(blocks).toHaveLength(1)
	expect(blocks[0]).toMatchObject({ kind: 'tool', output: { text: '92 lines' } })
})

test('when a call has more than one output, the last one wins', () => {
	const lines = [
		line({ kind: 'tool', text: 'Bash', call: 'c1' }),
		line({ kind: 'output', text: 'first', call: 'c1' }),
		line({ kind: 'output', text: 'second', call: 'c1' }),
	]
	const blocks = groupLines(lines)
	expect(blocks).toHaveLength(1)
	expect(blocks[0]).toMatchObject({ kind: 'tool', output: { text: 'second' } })
})

test('a tool with no call, or none answered yet, stands alone as pending', () => {
	const lines = [
		line({ kind: 'tool', text: 'Read', call: null }),
		line({ kind: 'tool', text: 'Write', call: 'c1' }),
	]
	const blocks = groupLines(lines)
	expect(blocks).toHaveLength(2)
	for (const block of blocks) expect(block).toMatchObject({ kind: 'tool', output: null })
})

test('an output whose call has not been seen is its own block', () => {
	const blocks = groupLines([line({ kind: 'output', text: 'stray', call: 'unknown' })])
	expect(blocks).toEqual([
		{ kind: 'orphanOutput', output: expect.objectContaining({ text: 'stray' }), at: 0 },
	])
})

test('an old log with no call id groups nothing, one block per line', () => {
	const lines = [
		line({ kind: 'tool', text: 'Read', tool: null }),
		line({ kind: 'text', text: 'wrote something', tool: null }),
	]
	const blocks = groupLines(lines)
	expect(blocks).toHaveLength(2)
	expect(blocks[0]).toMatchObject({ kind: 'tool', output: null })
	expect(blocks[1]).toMatchObject({ kind: 'single' })
})

test('a short body shows whole, a long one folds to three lines plus a count', () => {
	expect(foldBody('a\nb\nc')).toEqual({ shown: 'a\nb\nc', hidden: 0 })
	const long = ['a', 'b', 'c', 'd', 'e', 'f'].join('\n')
	expect(foldBody(long)).toEqual({ shown: 'a\nb\nc', hidden: 3 })
})

test('elapsed is mm:ss since the run started, falling back to arrival time', () => {
	const start = '2026-01-01T00:00:00.000Z'
	expect(elapsedLabel('2026-01-01T00:01:05.000Z', start)).toBe('01:05')
	expect(elapsedLabel(null, start, '2026-01-01T00:00:09.000Z')).toBe('00:09')
	expect(elapsedLabel(null, start, null)).toBe('00:00')
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

/** A deterministic `Random`, cycling through fixed values instead of `Math.random`. */
const seqRandom = (values: readonly number[]) => {
	let index = 0
	return () => values[index++ % values.length] ?? 0
}

test('every EKG vertex stays inside the box at maximum amplitude', () => {
	const cases: readonly {
		readonly shape: readonly (readonly [number, number])[]
		readonly amp: number
	}[] = [
		{ shape: EKG_SHAPE_REGULAR, amp: 4.5 * 1.25 },
		{ shape: EKG_SHAPE_DOUBLE, amp: 4.5 * 1.25 },
		{ shape: EKG_SHAPE_LOG, amp: 5.5 },
	]
	for (const { shape, amp } of cases) {
		for (const [, height] of shape) {
			const y = EKG_BASELINE - amp * height
			expect(y).toBeGreaterThanOrEqual(0.5)
			expect(y).toBeLessThanOrEqual(17.5)
		}
	}
})

test('a spike drops every beat it overlaps, so beats never overlap', () => {
	const now = 1000
	// A regular beat sitting right where the spike lands.
	const overlapping: EkgBeat = { time: now - 50, amp: 4.5, shape: EKG_SHAPE_REGULAR }
	const { queue } = spike([overlapping], now, seqRandom([0.5]))
	expect(queue).toHaveLength(1)
	expect(queue[0]?.shape).toBe(EKG_SHAPE_LOG)
})

test('a beat’s R-peak y is identical across two frames 16ms apart', () => {
	const queue: readonly EkgBeat[] = [{ time: 1000, amp: 6, shape: EKG_SHAPE_REGULAR }]
	const rPeakY = (now: number): number => {
		const ys = [...ekgPath(queue, now).matchAll(/[ML]-?[\d.]+ (-?[\d.]+)/g)].map((match) =>
			Number(match[1]),
		)
		return Math.min(...ys)
	}
	expect(rPeakY(1200)).toBe(rPeakY(1216))
})

test('nextVerb never repeats the previous verb', () => {
	let index = nextVerb(-1, seqRandom([0]))
	for (let i = 0; i < THINKING_VERBS.length * 3; i += 1) {
		const previous = index
		index = nextVerb(index, seqRandom([Math.random()]))
		expect(index).not.toBe(previous)
	}
})

test('mergeThinkingVerbs falls back to the built-in pool with no config', () => {
	expect(mergeThinkingVerbs(['Sobering', 'Doodling'], null)).toEqual(['Sobering', 'Doodling'])
})

test('mergeThinkingVerbs extend appends new words, deduped case-insensitively', () => {
	expect(
		mergeThinkingVerbs(['Sobering', 'Doodling'], {
			mode: 'extend',
			words: ['doodling', 'Vibing'],
		}),
	).toEqual(['Sobering', 'Doodling', 'Vibing'])
})

test('mergeThinkingVerbs replace uses words only when non-empty', () => {
	expect(mergeThinkingVerbs(['Sobering'], { mode: 'replace', words: ['Vibing'] })).toEqual([
		'Vibing',
	])
	expect(mergeThinkingVerbs(['Sobering'], { mode: 'replace', words: [] })).toEqual(['Sobering'])
})

test('buildChecklist pairs each checked with its check, in order', () => {
	const lines = [
		LogLine.parse({ kind: 'check', text: 'pnpm test' }),
		LogLine.parse({ kind: 'raw', text: 'ok' }),
		LogLine.parse({ kind: 'checked', text: 'pnpm test (exit 0, 1.2s)' }),
		LogLine.parse({ kind: 'check', text: 'pnpm lint' }),
		LogLine.parse({ kind: 'checked', text: 'pnpm lint (exit 1, 0.4s)' }),
	]
	expect(buildChecklist(lines)).toEqual([
		{ label: 'pnpm test', passed: true },
		{ label: 'pnpm lint', passed: false },
	])
})
