import { readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Node, SCHEMA_VERSION } from '@besober/schema'
import { beforeEach, expect, test } from 'vitest'
import { initBoard } from './board.js'
import { DEFAULT_CONFIG, parseConfig, readConfig, setSetting } from './config.js'
import { findRoot, paths, recordFile } from './paths.js'
import { readRecord, readRecords } from './read.js'
import { readNodes, readProject, writeNode } from './records.js'
import { tmpRoot } from './tmp.fixture.js'
import { writeRecord } from './write.js'

let root: string

const node = (title: string) => ({
	title,
	description: '',
	notes: '',
	dependsOn: [],
	decisions: [],
	files: [],
	brief: null,
	outcome: null,
	assignee: null,
	claim: null,
	accepted: null,
	dismissal: null,
	createdAt: '2026-09-04T00:00:00.000Z',
})

beforeEach(async () => {
	root = await tmpRoot('sober-storage-')
})

test('init creates a board, and running it again leaves it alone', async () => {
	const first = await initBoard(root, { title: 'SOBER', intent: 'ship', constraints: [] })
	expect(first.created).toBe(true)

	const project = await readProject(first.paths)
	expect(project).toMatchObject({
		kind: 'ok',
		value: { title: 'SOBER', schemaVersion: SCHEMA_VERSION },
	})

	const second = await initBoard(root, { title: 'Something else', intent: '', constraints: [] })
	expect(second.created).toBe(false)
	expect(await readProject(second.paths)).toMatchObject({ value: { title: 'SOBER' } })
})

test('init gitignores the board and keeps config.jsonc tracked', async () => {
	await writeFile(join(root, '.gitignore'), 'node_modules\n')
	await initBoard(root, { title: 'SOBER', intent: '', constraints: [] })

	const ignore = await readFile(join(root, '.gitignore'), 'utf8')
	expect(ignore).toContain('node_modules')
	expect(ignore).toContain('.sober/*')
	expect(ignore).toContain('!.sober/config.jsonc')
})

test('findRoot walks up from anywhere inside the repository', async () => {
	await initBoard(root, { title: 'SOBER', intent: '', constraints: [] })

	expect(findRoot(join(root, 'packages', 'core', 'src'))).toBe(root)
	expect(findRoot(tmpdir())).toBe(null)
})

test('a record that will not parse is named, and the rest of the board still loads', async () => {
	const { paths: p } = await initBoard(root, { title: 'SOBER', intent: '', constraints: [] })
	await writeNode(p, 'good-node-a1b2', node('Good'))
	await writeFile(recordFile(p.nodes, 'torn-node-c3d4'), '{ "title": ')
	await writeFile(recordFile(p.nodes, 'wrong-node-e5f6'), '{ "title": 42 }')

	const { records, broken } = await readNodes(p)

	expect([...records.keys()]).toEqual(['good-node-a1b2'])
	expect(broken.map((entry) => entry.file)).toEqual([
		recordFile(p.nodes, 'torn-node-c3d4'),
		recordFile(p.nodes, 'wrong-node-e5f6'),
	])
	expect(broken[1]?.reason).toContain('title')
})

/**
 * §8.4 covers a file that will not parse. These two are the step before it: a
 * path that cannot be read at all, and a directory that is not one.
 *
 * They are told apart on purpose. A record that is missing is a fact the board
 * lives with every day; a record that is there and unreadable is a finding. A
 * records directory that is a file is neither — it is a broken installation,
 * and reporting it as an empty board would put a person in front of a graph
 * with nothing on it and no reason given.
 */
test('a record path that cannot be read at all is a finding, not a missing record', async () => {
	const { paths: p } = await initBoard(root, { title: 'SOBER', intent: '', constraints: [] })

	const read = await readRecord(p.nodes, Node)

	expect(read.kind).toBe('broken')
	expect(read.kind === 'broken' && read.reason).toBeTruthy()
})

test('a records directory that is a file is loud, rather than an empty board', async () => {
	const { paths: p } = await initBoard(root, { title: 'SOBER', intent: '', constraints: [] })

	await expect(readRecords(p.project, Node)).rejects.toThrow()
})

test('a write leaves no temp file behind', async () => {
	const p = paths(root)
	await writeRecord(recordFile(p.nodes, 'a-node-a1b2'), node('A'))

	expect(await readdir(p.nodes)).toEqual(['a-node-a1b2.json'])
})

test('a missing config is the defaults', async () => {
	expect(await readConfig(paths(root))).toEqual({ kind: 'ok', value: DEFAULT_CONFIG })
})

test('the config init writes parses back to the defaults', async () => {
	const { paths: p } = await initBoard(root, { title: 'SOBER', intent: '', constraints: [] })

	expect(await readConfig(p)).toEqual({ kind: 'ok', value: DEFAULT_CONFIG })
})

test('a setting missing from the file is the default, and an unknown one is reported', async () => {
	expect(parseConfig('c', '{ "dispatch": { "concurrency": 1 } }')).toEqual({
		kind: 'ok',
		value: { ...DEFAULT_CONFIG, dispatch: { ...DEFAULT_CONFIG.dispatch, concurrency: 1 } },
	})
	expect(parseConfig('c', '{ "dispatch": { "conccurency": 1 } }')).toMatchObject({ kind: 'broken' })
	expect(parseConfig('c', '{ "dispatch": ')).toMatchObject({
		kind: 'broken',
		reason: 'not valid JSONC',
	})
})

// The trap in DESIGN §1.3: JSON.stringify would delete every comment.
test('editing a setting keeps the comments around it', async () => {
	const { paths: p } = await initBoard(root, { title: 'SOBER', intent: '', constraints: [] })
	const before = await readFile(p.config, 'utf8')

	const after = setSetting(before, ['dispatch', 'concurrency'], 1)

	expect(after).toContain('// How many runs may burn at once.')
	expect(after).toContain('"concurrency": 1')
	expect(parseConfig(p.config, after)).toMatchObject({ value: { dispatch: { concurrency: 1 } } })
})
