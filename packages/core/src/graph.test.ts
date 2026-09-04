import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Node } from '@besober/schema'
import { beforeEach, expect, test } from 'vitest'
import { initBoard } from './board.js'
import { cycleFrom, dangling, dependents, findCycle, loadBoard, topological } from './graph.js'
import { writeRun } from './local.js'
import type { Paths } from './paths.js'
import { aDecision, aNode, aRun } from './records.fixture.js'
import { writeDecision, writeNode } from './records.js'

const nodeMap = (entries: Record<string, string[]>): Map<string, Node> =>
	new Map(Object.entries(entries).map(([id, dependsOn]) => [id, aNode({ dependsOn })]))

let paths: Paths

beforeEach(async () => {
	const root = await mkdtemp(join(tmpdir(), 'sober-graph-'))
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
