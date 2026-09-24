import { expect, test } from 'vitest'
import { addedLines } from './diff.js'

test('only added lines are read, and each keeps its number in the new file', () => {
	const patch = [
		'diff --git a/src/auth.ts b/src/auth.ts',
		'--- a/src/auth.ts',
		'+++ b/src/auth.ts',
		'@@ -10,3 +10,4 @@',
		' const before = 1',
		'-const removed = 2',
		'+const added = 2',
		'+const also = 3',
		' const after = 4',
	].join('\n')

	expect(addedLines(patch)).toEqual([
		{
			path: 'src/auth.ts',
			lines: [
				{ number: 11, text: 'const added = 2' },
				{ number: 12, text: 'const also = 3' },
			],
		},
	])
})

test('a deleted file has no added lines and no path to open', () => {
	const patch = ['--- a/gone.ts', '+++ /dev/null', '@@ -1 +0,0 @@', '-const x = 1'].join('\n')
	expect(addedLines(patch)).toEqual([])
})

test('several files in one diff stay separate', () => {
	const patch = [
		'--- a/a.ts',
		'+++ b/a.ts',
		'@@ -0,0 +1 @@',
		'+const a = 1',
		'--- a/b.ts',
		'+++ b/b.ts',
		'@@ -0,0 +1 @@',
		'+const b = 2',
	].join('\n')

	expect(addedLines(patch).map((file) => file.path)).toEqual(['a.ts', 'b.ts'])
})

test('a diff with nothing added reads as nothing, not as an empty file entry', () => {
	expect(addedLines('')).toEqual([])
	expect(addedLines('--- a/a.ts\n+++ b/a.ts\n@@ -1 +0,0 @@\n-const a = 1\n')).toEqual([])
})
