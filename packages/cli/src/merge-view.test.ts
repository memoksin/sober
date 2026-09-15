import { expect, test } from 'vitest'
import { bodyOf, collapse, diff, linesOf, type Row, sideBySide, wrap } from './merge-view.js'

test('a timestamp reads as a date, not as ISO', () => {
	const [line] = linesOf('2026-09-15T07:46:18.956Z')
	expect(line).not.toMatch(/T\d{2}:|Z$/)
	expect(line).toMatch(/2026/)
})

test('side by side pairs a changed run and pads the left column', () => {
	const rows: Row[] = [
		{ kind: 'same', text: 'a' },
		{ kind: 'ours', text: 'b' },
		{ kind: 'theirs', text: 'x' },
		{ kind: 'theirs', text: 'y' },
	]
	expect(sideBySide(rows, 3)).toEqual([
		{ kind: 'same', left: 'a  ', right: 'a' },
		{ kind: 'changed', left: 'b  ', right: 'x' },
		{ kind: 'changed', left: '   ', right: 'y' },
	])
})

test('a brief reads as lines, not as escaped JSON', () => {
	expect(linesOf({ approach: 'one\ntwo', complexity: null, acceptance: [{ run: 'x' }] })).toEqual([
		'approach:',
		'  one',
		'  two',
		'complexity: null',
		'acceptance:',
		'  - run: x',
	])
})

test('the diff keeps shared lines and names the side of each changed one', () => {
	expect(diff(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([
		{ kind: 'same', text: 'a' },
		{ kind: 'ours', text: 'b' },
		{ kind: 'theirs', text: 'x' },
		{ kind: 'same', text: 'c' },
	])
})

test('a long shared run folds, with context kept next to the change', () => {
	const same = (text: string): Row => ({ kind: 'same', text })
	const rows = [...'abcdefgh'].map(same)
	rows.push({ kind: 'ours', text: 'z' })
	expect(collapse(rows).map((row) => row.text)).toEqual(['… 6 unchanged lines', 'g', 'h', 'z'])
})

test('wrapping breaks at a space and never loses a character', () => {
	expect(wrap('aaaa bbbb cccc', 10)).toEqual(['aaaa bbbb', 'cccc'])
	expect(wrap('x'.repeat(25), 10).join('')).toBe('x'.repeat(25))
})

test('a field both sides changed shows only what differs', () => {
	const ours = JSON.stringify({ approach: 'same', approval: null })
	const theirs = JSON.stringify({ approach: 'same', approval: { by: 'me' } })
	expect(bodyOf(ours, theirs).filter((row) => row.kind !== 'same')).toEqual([
		{ kind: 'ours', text: 'approval: null' },
		{ kind: 'theirs', text: 'approval:' },
		{ kind: 'theirs', text: '  by: me' },
	])
})
