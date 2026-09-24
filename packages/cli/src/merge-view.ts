import { when } from './out.js'

/** One line of a field's two versions: shared by both, only ours, only theirs, or a fold. */
export interface Row {
	readonly kind: 'same' | 'ours' | 'theirs' | 'gap'
	readonly text: string
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

const inline = (value: unknown): string | null => {
	if (value === null) return 'null'
	if (typeof value === 'string') {
		if (ISO.test(value)) return when(value)
		return value.includes('\n') ? null : value === '' ? '""' : value
	}
	if (typeof value !== 'object') return String(value)
	if (Array.isArray(value)) return value.length === 0 ? '[]' : null
	return Object.keys(value).length === 0 ? '{}' : null
}

/**
 * A value as a person reads it rather than as JSON: a brief's approach keeps its
 * line breaks instead of arriving as one line of `\n`, and nesting indents.
 */
export const linesOf = (value: unknown): string[] => {
	const one = inline(value)
	if (one !== null) return [one]
	if (typeof value === 'string') return value.split('\n')
	if (Array.isArray(value))
		return value.flatMap((item) =>
			linesOf(item).map((line, at) => `${at === 0 ? '- ' : '  '}${line}`),
		)
	return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
		const short = inline(item)
		return short !== null
			? [`${key}: ${short}`]
			: [`${key}:`, ...linesOf(item).map((line) => `  ${line}`)]
	})
}

export const diff = (ours: readonly string[], theirs: readonly string[]): Row[] => {
	// ponytail: O(n·m) LCS table — a field is tens of lines; switch to Myers if records reach thousands
	const width = theirs.length + 1
	const table = new Uint32Array((ours.length + 1) * width)
	const at = (i: number, j: number): number => table[i * width + j] ?? 0
	for (let i = ours.length - 1; i >= 0; i--)
		for (let j = theirs.length - 1; j >= 0; j--)
			table[i * width + j] =
				ours[i] === theirs[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))

	const rows: Row[] = []
	let i = 0
	let j = 0
	while (i < ours.length || j < theirs.length) {
		if (i < ours.length && j < theirs.length && ours[i] === theirs[j]) {
			rows.push({ kind: 'same', text: ours[i] as string })
			i++
			j++
		} else if (i < ours.length && (j === theirs.length || at(i + 1, j) >= at(i, j + 1))) {
			rows.push({ kind: 'ours', text: ours[i] as string })
			i++
		} else {
			rows.push({ kind: 'theirs', text: theirs[j] as string })
			j++
		}
	}
	return rows
}

const CONTEXT = 2

/** Long runs both sides share fold down to a line, keeping a little context around each change. */
export const collapse = (rows: readonly Row[]): Row[] => {
	const out: Row[] = []
	let at = 0
	while (at < rows.length) {
		if (rows[at]?.kind !== 'same') {
			out.push(rows[at] as Row)
			at++
			continue
		}
		let end = at
		while (rows[end]?.kind === 'same') end++
		const head = at === 0 ? 0 : CONTEXT
		const tail = end === rows.length ? 0 : CONTEXT
		const folded = end - at - head - tail
		if (folded > 1)
			out.push(
				...rows.slice(at, at + head),
				{ kind: 'gap', text: `… ${folded} unchanged lines` },
				...rows.slice(end - tail, end),
			)
		else out.push(...rows.slice(at, end))
		at = end
	}
	return out
}

/** Word-wraps one line to the screen, breaking mid-word only when a word is wider than it. */
export const wrap = (text: string, width: number): string[] => {
	const room = Math.max(width, 10)
	const lines: string[] = []
	let rest = Array.from(text)
	while (rest.length > room) {
		const space = rest.lastIndexOf(' ', room)
		const cut = space > 0 ? space : room
		lines.push(rest.slice(0, cut).join(''))
		rest = rest.slice(space > 0 ? cut + 1 : cut)
	}
	lines.push(rest.join(''))
	return lines
}

/** One screen line of the two versions next to each other, each side padded to its column. */
export interface Line {
	readonly kind: 'same' | 'changed' | 'gap'
	readonly left: string
	readonly right: string
}

export const pad = (text: string, width: number): string =>
	text + ' '.repeat(Math.max(width - Array.from(text).length, 0))

/**
 * A run of changed rows pairs ours against theirs line by line, so a replaced
 * paragraph sits beside its replacement and an added line faces a blank.
 */
export const sideBySide = (rows: readonly Row[], width: number): Line[] => {
	const lines: Line[] = []
	let at = 0
	while (at < rows.length) {
		const row = rows[at] as Row
		if (row.kind === 'same' || row.kind === 'gap') {
			for (const text of wrap(row.text, width))
				lines.push({
					kind: row.kind,
					left: pad(text, width),
					right: row.kind === 'gap' ? '' : text,
				})
			at++
			continue
		}
		const ours: string[] = []
		const theirs: string[] = []
		for (; rows[at]?.kind === 'ours' || rows[at]?.kind === 'theirs'; at++) {
			const next = rows[at] as Row
			;(next.kind === 'ours' ? ours : theirs).push(...wrap(next.text, width))
		}
		for (let i = 0; i < Math.max(ours.length, theirs.length); i++)
			lines.push({ kind: 'changed', left: pad(ours[i] ?? '', width), right: theirs[i] ?? '' })
	}
	return lines
}

/** `FieldConflict` carries each side as JSON; `(not set)` is the one value that is not. */
const parsed = (shown: string): unknown => {
	try {
		return JSON.parse(shown)
	} catch {
		return shown
	}
}

export const bodyOf = (ours: string, theirs: string): Row[] =>
	collapse(diff(linesOf(parsed(ours)), linesOf(parsed(theirs))))
