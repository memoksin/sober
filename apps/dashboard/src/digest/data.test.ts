import type { Digest } from '@besober/schema'
import { expect, test } from 'vitest'
import { lines, worthShowing } from './data.js'

const nothing: Digest = {
	delta: { nodes: [], answered: [], finished: [] },
	unreachable: null,
	inReview: [],
	flagged: [],
}

test('a line is written for each thing that happened, and for nothing that did not', () => {
	const seen: Digest = {
		...nothing,
		delta: { nodes: ['a-aaaa', 'b-bbbb'], answered: [], finished: ['c-cccc'] },
		inReview: ['c-cccc'],
	}

	expect(lines(seen).map((line) => line.text)).toEqual([
		'2 new nodes',
		'1 node finished',
		'1 result waiting for review',
	])
})

test('one of a thing reads as one of that thing', () => {
	const seen: Digest = {
		...nothing,
		delta: { nodes: ['a-aaaa'], answered: ['d-dddd'], finished: [] },
		flagged: ['b-bbbb'],
	}

	expect(lines(seen).map((line) => line.text)).toEqual([
		'1 new node',
		'1 decision answered',
		'1 node flagged',
	])
})

/**
 * DESIGN §7.1: with no remote the delta half is empty and the snapshot half
 * still works. The two are separate lists on screen for the same reason they
 * are separate fields on the wire — one failing is not the other failing.
 */
test('the snapshot half is written even when the delta half could not be read', () => {
	const seen: Digest = {
		delta: null,
		unreachable: 'this repository has no remote — the board is only on this machine',
		inReview: ['a-aaaa', 'b-bbbb', 'c-cccc'],
		flagged: [],
	}

	expect(lines(seen).map((line) => line.text)).toEqual(['3 results waiting for review'])
	expect(worthShowing(seen)).toBe(true)
})

test('a board where nothing happened says nothing at all', () => {
	expect(lines(nothing)).toEqual([])
	expect(worthShowing(nothing)).toBe(false)
})

/**
 * "Nothing changed" and "nothing was checked" are opposite facts, so a digest
 * that could not reach the remote is shown even when it has no counts — the
 * sentence is the whole of what it has to say.
 */
test('a delta that could not be read is worth showing on its own', () => {
	expect(
		worthShowing({ ...nothing, delta: null, unreachable: 'origin could not be reached' }),
	).toBe(true)
})
