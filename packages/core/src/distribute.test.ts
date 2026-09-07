import { writeFile } from 'node:fs/promises'
import type { Match, Node } from '@besober/schema'
import { beforeEach, expect, test } from 'vitest'
import { initBoard } from './board.js'
import { addContributor } from './contributors.js'
import {
	acceptDistribution,
	dropDistribution,
	proposeDistribution,
	readDistribution,
} from './distribute.js'
import type { Paths } from './paths.js'
import { aNode } from './records.fixture.js'
import { readNode, writeNode } from './records.js'
import { tmpRoot } from './tmp.fixture.js'

let paths: Paths

const match = (node: string, handle: string): Match => ({
	node,
	handle,
	because: `${handle} works on these files`,
})

const nodeAt = async (id: string): Promise<Node | null> => {
	const record = await readNode(paths, id)
	return record.kind === 'ok' ? record.value : null
}

const claimed = (by: string): Node['claim'] => ({ by, at: '2026-09-08T08:00:00.000Z' })

beforeEach(async () => {
	const root = await tmpRoot('sober-distribute-')
	paths = (await initBoard(root, { title: 'Acme', intent: '', constraints: [] })).paths
	await addContributor(paths, {
		handle: 'alice',
		name: 'Alice',
		role: 'maintainer',
		focus: ['packages/core/**'],
	})
	await addContributor(paths, {
		handle: 'bob',
		name: 'Bob',
		role: 'author',
		focus: ['apps/dashboard/**'],
	})
	await writeNode(paths, 'auth-api-k7f2', aNode({ title: 'The auth API' }))
	await writeNode(paths, 'auth-ui-9x1p', aNode({ title: 'The auth panel' }))
})

test('a proposal waits on the board, with the sentence that put each node where it is', async () => {
	await proposeDistribution(paths, 'alice', [match('auth-api-k7f2', 'alice')])

	const waiting = await readDistribution(paths)
	expect(waiting?.by).toBe('alice')
	expect(waiting?.matches).toEqual([
		{ node: 'auth-api-k7f2', handle: 'alice', because: 'alice works on these files' },
	])
	// Nothing is assigned yet. The proposal is the plan; accepting it is the act.
	expect((await nodeAt('auth-api-k7f2'))?.assignee).toBeNull()
})

test('a board with no proposal on it has none, rather than an empty one', async () => {
	expect(await readDistribution(paths)).toBeNull()
})

test('a node somebody is already on is passed over — a claim is a fact, a distribution is a plan', async () => {
	await writeNode(paths, 'auth-api-k7f2', aNode({ claim: claimed('bob') }))

	const proposed = await proposeDistribution(paths, 'alice', [
		match('auth-api-k7f2', 'alice'),
		match('auth-ui-9x1p', 'bob'),
	])

	expect(proposed.matches.map((one) => one.node)).toEqual(['auth-ui-9x1p'])
	expect(proposed.skipped).toEqual(['auth-api-k7f2'])
})

test('a finished node is passed over too — a plan for work that already landed says nothing', async () => {
	await writeNode(
		paths,
		'auth-api-k7f2',
		aNode({
			accepted: {
				by: 'bob',
				at: '2026-09-08T07:00:00.000Z',
				flagged: false,
				scan: 'clean',
				audit: 'passed',
			},
		}),
	)

	const proposed = await proposeDistribution(paths, 'alice', [match('auth-api-k7f2', 'alice')])

	expect(proposed.matches).toEqual([])
	expect(proposed.skipped).toEqual(['auth-api-k7f2'])
})

test('a handle nobody put on the project is refused, and nothing is written', async () => {
	await expect(
		proposeDistribution(paths, 'alice', [match('auth-api-k7f2', 'alcie')]),
	).rejects.toThrow('contributors add')

	expect(await readDistribution(paths)).toBeNull()
})

test('a node the board does not hold is refused, and nothing is written', async () => {
	await expect(proposeDistribution(paths, 'alice', [match('gone-k7f2', 'alice')])).rejects.toThrow(
		'not on this board',
	)

	expect(await readDistribution(paths)).toBeNull()
})

test('one node named twice is refused — a proposal that disagrees with itself is not a plan', async () => {
	await expect(
		proposeDistribution(paths, 'alice', [
			match('auth-api-k7f2', 'alice'),
			match('auth-api-k7f2', 'bob'),
		]),
	).rejects.toThrow('twice')
})

test('a second proposal replaces the first — there is one plan waiting, never a pile', async () => {
	await proposeDistribution(paths, 'alice', [match('auth-api-k7f2', 'alice')])
	await proposeDistribution(paths, 'bob', [match('auth-ui-9x1p', 'bob')])

	const waiting = await readDistribution(paths)
	expect(waiting?.by).toBe('bob')
	expect(waiting?.matches.map((one) => one.node)).toEqual(['auth-ui-9x1p'])
})

test('accepting writes the assignees and clears the plan it came from', async () => {
	await proposeDistribution(paths, 'alice', [
		match('auth-api-k7f2', 'alice'),
		match('auth-ui-9x1p', 'bob'),
	])

	const landed = await acceptDistribution(paths)

	expect(landed?.matches.map((one) => one.node)).toEqual(['auth-api-k7f2', 'auth-ui-9x1p'])
	expect((await nodeAt('auth-api-k7f2'))?.assignee).toBe('alice')
	expect((await nodeAt('auth-ui-9x1p'))?.assignee).toBe('bob')
	expect(await readDistribution(paths)).toBeNull()
})

test('a node claimed between the proposal and the acceptance is passed over then too', async () => {
	await proposeDistribution(paths, 'alice', [
		match('auth-api-k7f2', 'alice'),
		match('auth-ui-9x1p', 'bob'),
	])
	await writeNode(paths, 'auth-api-k7f2', aNode({ claim: claimed('bob') }))

	const landed = await acceptDistribution(paths)

	expect(landed?.matches.map((one) => one.node)).toEqual(['auth-ui-9x1p'])
	expect(landed?.skipped).toEqual(['auth-api-k7f2'])
	expect((await nodeAt('auth-api-k7f2'))?.assignee).toBeNull()
})

test('accepting with nothing waiting says so rather than pretending it did something', async () => {
	expect(await acceptDistribution(paths)).toBeNull()
})

test('dropping clears it, and there is nothing to drop twice', async () => {
	await proposeDistribution(paths, 'alice', [match('auth-api-k7f2', 'alice')])

	expect(await dropDistribution(paths)).toBe(true)
	expect(await readDistribution(paths)).toBeNull()
	expect(await dropDistribution(paths)).toBe(false)
	// Dropping is not assigning: the board is exactly where it was.
	expect((await nodeAt('auth-api-k7f2'))?.assignee).toBeNull()
})

test('the handle lands as the team file spells it — Bob is not a second person from bob', async () => {
	const proposed = await proposeDistribution(paths, 'alice', [match('auth-api-k7f2', 'ALICE')])

	expect(proposed.matches[0]?.handle).toBe('alice')

	await acceptDistribution(paths)
	expect((await nodeAt('auth-api-k7f2'))?.assignee).toBe('alice')
})

test('a plan nobody can parse is loud on the way in, and can still be dropped', async () => {
	await writeFile(paths.distribution, '{ not json')

	await expect(readDistribution(paths)).rejects.toThrow('cannot be read')
	expect(await dropDistribution(paths)).toBe(true)
	expect(await readDistribution(paths)).toBeNull()
})
