import type { Node } from '@besober/schema'
import { beforeEach, expect, test } from 'vitest'
import { initBoard } from './board.js'
import {
	between,
	cycleFrom,
	dangling,
	dependents,
	findCycle,
	loadBoard,
	topological,
} from './graph.js'
import { writeRun } from './local.js'
import type { Paths } from './paths.js'
import { aDecision, aNode, aRun } from './records.fixture.js'
import { writeDecision, writeNode } from './records.js'
import { tmpRoot } from './tmp.fixture.js'

const nodeMap = (entries: Record<string, string[]>): Map<string, Node> =>
	new Map(Object.entries(entries).map(([id, dependsOn]) => [id, aNode({ dependsOn })]))

let paths: Paths

beforeEach(async () => {
	const root = await tmpRoot('sober-graph-')
	paths = (await initBoard(root, { title: 'Acme', intent: 'ship', constraints: [] })).paths
})

test('the board loads whole, and a broken record is named beside it', async () => {
	await writeNode(paths, 'db-schema-m3q8', aNode({ title: 'Schema' }))
	await writeNode(paths, 'auth-api-k7f2', aNode({ dependsOn: ['db-schema-m3q8'] }))
	await writeDecision(paths, 'auth-model-k7f2', aDecision())
	await writeRun(paths, 'auth-api-k7f2-r1a2', aRun('auth-api-k7f2'))

	const board = await loadBoard(paths)

	expect(board.project?.title).toBe('Acme')
	expect([...board.nodes.keys()]).toEqual(['auth-api-k7f2', 'db-schema-m3q8'])
	expect(board.decisions.size).toBe(1)
	expect(board.runs.size).toBe(1)
	expect(board.broken).toEqual([])
})

test('a dependency that would close a cycle is refused, with the cycle shown', () => {
	const nodes = nodeMap({ a: [], b: ['a'], c: ['b'] })

	expect(cycleFrom(nodes, 'a', 'c')).toEqual(['a', 'c', 'b', 'a'])
	expect(cycleFrom(nodes, 'a', 'a')).toEqual(['a', 'a'])
	expect(cycleFrom(nodes, 'c', 'a')).toBe(null)
})

test('a cycle already on the board is found, and a clean board reports none', () => {
	expect(findCycle(nodeMap({ a: ['c'], b: ['a'], c: ['b'] }))).not.toBe(null)
	expect(findCycle(nodeMap({ a: [], b: ['a'] }))).toBe(null)
})

test('topological order puts dependencies first and is stable across machines', () => {
	expect(topological(nodeMap({ c: ['a'], a: [], b: ['a'], d: ['b', 'c'] }))).toEqual([
		'a',
		'b',
		'c',
		'd',
	])
})

test('a cycle leaves its nodes out of the order rather than looping', () => {
	expect(topological(nodeMap({ a: [], b: ['c'], c: ['b'] }))).toEqual(['a'])
})

test('dependents are the edge the records do not store', () => {
	expect(dependents(nodeMap({ a: [], b: ['a'], c: ['a'] }), 'a')).toEqual(['b', 'c'])
})

test('an edge naming a record the board does not hold is reported', async () => {
	await writeNode(
		paths,
		'auth-api-k7f2',
		aNode({ dependsOn: ['gone-node-x9y8'], decisions: ['gone-dec-x9y8'] }),
	)

	expect(dangling(await loadBoard(paths))).toEqual([
		{ node: 'auth-api-k7f2', kind: 'dependsOn', missing: 'gone-node-x9y8' },
		{ node: 'auth-api-k7f2', kind: 'decisions', missing: 'gone-dec-x9y8' },
	])
})

/**
 * The chain a person names by its two ends (ADR 0050). The board underneath is
 * the one the decision was taken against: two features hanging off one shared
 * foundation, which is the shape that makes an undirected walk swallow the
 * whole board.
 */
const twoFeatures = () =>
	nodeMap({
		'db-setup-4t7w': [],
		'auth-schema-m3q8': ['db-setup-4t7w'],
		'auth-api-k7f2': ['auth-schema-m3q8'],
		'auth-ui-9x1p': ['auth-api-k7f2'],
		'billing-schema-2p8k': ['db-setup-4t7w'],
		'billing-api-7h4d': ['billing-schema-2p8k'],
	})

test('the run between two nodes is what lies between them, and nothing either end merely touches', () => {
	expect(between(twoFeatures(), 'auth-schema-m3q8', 'auth-ui-9x1p')).toEqual([
		'auth-schema-m3q8',
		'auth-api-k7f2',
		'auth-ui-9x1p',
	])
})

test('every path is the run, not one of them — a diamond leaves neither side out', () => {
	const nodes = nodeMap({ a: [], b: ['a'], c: ['a'], d: ['b', 'c'], aside: ['a'] })

	expect(between(nodes, 'a', 'd')).toEqual(['a', 'b', 'c', 'd'])
})

test('the run reads in dependency order, so it is the order the work happens in', () => {
	expect(between(nodeMap({ d: ['b'], b: ['a'], a: [] }), 'a', 'd')).toEqual(['a', 'b', 'd'])
})

test('a run of one is a run — the two ends are allowed to be the same node', () => {
	expect(between(nodeMap({ a: [], b: ['a'] }), 'a', 'a')).toEqual(['a'])
})

test('the ends are given in dependency order, and backwards is no run at all', () => {
	expect(between(nodeMap({ a: [], b: ['a'] }), 'b', 'a')).toEqual([])
})

test('two nodes with nothing between them are no run, and neither is an end off the board', () => {
	expect(between(twoFeatures(), 'auth-api-k7f2', 'billing-api-7h4d')).toEqual([])
	expect(between(twoFeatures(), 'auth-api-k7f2', 'gone-node-x9y8')).toEqual([])
})
