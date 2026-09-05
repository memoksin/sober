import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SCHEMA_VERSION } from '@besober/schema'
import { beforeEach, expect, test } from 'vitest'
import { migrateBoard } from './migrate.js'
import { type Paths, paths } from './paths.js'
import { readNodes } from './records.js'
import { tmpRoot } from './tmp.fixture.js'

let root: string
let board: Paths

/** A node exactly as M1 wrote it: no assignee, no claim. */
const v1Node = {
	title: 'Session endpoints',
	description: 'Login and logout',
	notes: '',
	dependsOn: [],
	decisions: [],
	files: ['src/auth/**'],
	brief: null,
	outcome: null,
	accepted: null,
	createdAt: '2026-08-27T09:00:00Z',
}

beforeEach(async () => {
	root = await tmpRoot('sober-migrate-')
	board = paths(root)
	await mkdir(board.nodes, { recursive: true })
	await mkdir(board.archivedNodes, { recursive: true })
})

const writeV1 = async (version = 1): Promise<void> => {
	await writeFile(
		board.project,
		`${JSON.stringify({ schemaVersion: version, title: 'Acme', intent: '', constraints: [] })}\n`,
	)
	await writeFile(join(board.nodes, 'auth-api-k7f2.json'), `${JSON.stringify(v1Node)}\n`)
	await writeFile(
		join(board.archivedNodes, 'old-idea-m3q8.json'),
		`${JSON.stringify({ ...v1Node, title: 'Dropped' })}\n`,
	)
}

test('a board written by an older SOBER is brought forward, and says which records moved', async () => {
	await writeV1()

	const result = await migrateBoard(board)

	expect(result).toEqual({ kind: 'migrated', from: 1, to: SCHEMA_VERSION, records: 2 })
	expect(JSON.parse(await readFile(board.project, 'utf8')).schemaVersion).toBe(SCHEMA_VERSION)
})

test('every field a migrated record already had survives the move', async () => {
	await writeV1()

	await migrateBoard(board)

	const { records, broken } = await readNodes(board)
	expect(broken).toEqual([])
	expect(records.get('auth-api-k7f2')).toEqual({ ...v1Node, assignee: null, claim: null })
})

test('archived records are migrated too — one restored must still parse', async () => {
	await writeV1()

	await migrateBoard(board)

	const archived = JSON.parse(
		await readFile(join(board.archivedNodes, 'old-idea-m3q8.json'), 'utf8'),
	)
	expect(archived).toMatchObject({ assignee: null, claim: null })
})

test('a board already at this version is left alone', async () => {
	await writeV1(SCHEMA_VERSION)

	expect(await migrateBoard(board)).toEqual({ kind: 'current' })
})

test('a board from a newer SOBER is refused, because writing it would drop what it holds', async () => {
	await writeV1(SCHEMA_VERSION + 1)

	await expect(migrateBoard(board)).rejects.toThrow(/upgrade/i)
})

test('a repository with no board is nothing to migrate', async () => {
	expect(await migrateBoard(paths(await tmpRoot('sober-empty-')))).toEqual({
		kind: 'no-board',
	})
})

test('a migrated record is written in schema order, so it is not a whole-file diff later', async () => {
	await writeV1()

	await migrateBoard(board)

	const written = Object.keys(
		JSON.parse(await readFile(join(board.nodes, 'auth-api-k7f2.json'), 'utf8')),
	)
	expect(written).toEqual([
		...Object.keys(v1Node).slice(0, -2),
		'assignee',
		'claim',
		'accepted',
		'createdAt',
	])
})

test('a record the migration cannot make valid is written back as it is, and reported by the reader', async () => {
	await writeV1()
	await writeFile(join(board.nodes, 'broken-m3q8.json'), JSON.stringify({ title: 42 }))

	expect(await migrateBoard(board)).toMatchObject({ kind: 'migrated', records: 3 })

	const { records, broken } = await readNodes(board)
	expect(records.has('auth-api-k7f2')).toBe(true)
	expect(broken).toHaveLength(1)
})

test('a board with no archive directory is migrated all the same', async () => {
	await writeV1()
	await rm(board.archivedNodes, { recursive: true })

	expect(await migrateBoard(board)).toMatchObject({ kind: 'migrated', records: 1 })
})

test('a project record that will not parse is not a board to migrate', async () => {
	await writeFile(board.project, '{ not json')

	expect(await migrateBoard(board)).toEqual({ kind: 'no-board' })
})
