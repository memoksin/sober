import { LogLine } from '@besober/schema'
import { expect, test } from 'vitest'
import { shown } from './work.js'

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI colour
const plain = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '')

test('a tool line written before detail existed prints as it always did', () => {
	expect(plain(shown(LogLine.parse({ kind: 'tool', text: 'Read', tool: 'Read' })))).toBe('  ◧ Read')
})

test('a tool line with detail prints Tool(detail), and its output sits under it', () => {
	expect(
		plain(shown(LogLine.parse({ kind: 'tool', text: 'Read', tool: 'Read', detail: 'a.ts' }))),
	).toBe('  ◧ Read(a.ts)')
	expect(
		plain(
			shown(LogLine.parse({ kind: 'output', text: '92 lines', tool: 'bash', body: 'never shown' })),
		),
	).toBe('    ⎿ 92 lines')
})
