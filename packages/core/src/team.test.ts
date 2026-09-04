import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Node } from '@besober/schema'
import { beforeEach, describe, expect, test } from 'vitest'
import { initBoard } from './board.js'
import { addContributor, readContributors, removeContributor } from './contributors.js'
import type { Paths } from './paths.js'
import { aNode } from './records.fixture.js'
import { readNode, writeNode } from './records.js'
import { assignNode, claimNode, overlaps, releaseNode } from './team.js'

const claimed = (by: string, files: string[], rest: Partial<Node> = {}): Node =>
	aNode({ claim: { by, at: '2026-09-05T09:00:00.000Z' }, files, ...rest })

const board = (entries: Record<string, Node>) => new Map(Object.entries(entries))

test('two claimed nodes whose globs meet are named, with who is on them', () => {
	const nodes = board({
		'auth-api-k7f2': claimed('alice', ['src/auth/**']),
		'session-ui-m3q8': claimed('bob', ['src/auth/session.ts'], { title: 'The session panel' }),
	})

	expect(overlaps(nodes, 'auth-api-k7f2')).toEqual([
		{
			id: 'session-ui-m3q8',
			title: 'The session panel',
			by: 'bob',
			files: ['src/auth/**'],
		},
	])
})

test('a node is never in its own way', () => {
	const nodes = board({ 'auth-api-k7f2': claimed('alice', ['src/auth/**']) })

	expect(overlaps(nodes, 'auth-api-k7f2')).toEqual([])
})

test('a node nobody has claimed is not in anyone’s way', () => {
	const nodes = board({
		'auth-api-k7f2': claimed('alice', ['src/auth/**']),
		'session-ui-m3q8': aNode({ files: ['src/auth/session.ts'] }),
	})

	expect(overlaps(nodes, 'auth-api-k7f2')).toEqual([])
})

test('a finished node is not in anyone’s way — its merge already happened', () => {
	const nodes = board({
		'auth-api-k7f2': claimed('alice', ['src/auth/**']),
		'session-ui-m3q8': claimed('bob', ['src/auth/session.ts'], {
			accepted: { by: 'alice', at: '2026-09-05T10:00:00.000Z', flagged: false, scan: 'clean' },
		}),
	})

	expect(overlaps(nodes, 'auth-api-k7f2')).toEqual([])
})

test('nodes that share no files are not warned about', () => {
	const nodes = board({
		'auth-api-k7f2': claimed('alice', ['src/auth/**']),
		'billing-p2x1': claimed('bob', ['src/billing/**']),
	})

	expect(overlaps(nodes, 'auth-api-k7f2')).toEqual([])
})

test('a node that predicts no files warns about nothing — the warning is only as good as the prediction', () => {
	const nodes = board({
		'auth-api-k7f2': claimed('alice', []),
		'session-ui-m3q8': claimed('bob', ['src/auth/session.ts']),
	})

	expect(overlaps(nodes, 'auth-api-k7f2')).toEqual([])
})

test('a node the board does not hold overlaps nothing', () => {
	expect(overlaps(board({}), 'gone-k7f2')).toEqual([])
})

// Writing needs a board on disk: the lock, the records and the team file are
// what these three functions are. The subprocess tests drive the same paths
// from outside, where nothing can see them being taken.
describe('on a board', () => {
	let paths: Paths

	beforeEach(async () => {
		const root = await mkdtemp(join(tmpdir(), 'sober-team-'))
		paths = (await initBoard(root, { title: 'Acme', intent: '', constraints: [] })).paths
		await writeNode(paths, 'auth-api-k7f2', aNode({ title: 'The auth API', files: ['src/**'] }))
	})

	test('a claim is a fact, and taking one someone else has is reported', async () => {
		expect((await claimNode(paths, 'auth-api-k7f2', 'alice')).previous).toBeNull()

		const taken = await claimNode(paths, 'auth-api-k7f2', 'bob')
		expect(taken.previous?.by).toBe('alice')
		expect(taken.claim.by).toBe('bob')
	})

	test('releasing gives it back, and there is nothing to give back twice', async () => {
		await claimNode(paths, 'auth-api-k7f2', 'alice')

		expect((await releaseNode(paths, 'auth-api-k7f2'))?.by).toBe('alice')
		expect(await releaseNode(paths, 'auth-api-k7f2')).toBeNull()
	})

	test('assignment refuses a handle the project does not hold', async () => {
		await expect(assignNode(paths, 'auth-api-k7f2', 'alcie')).rejects.toThrow('contributors add')

		await addContributor(paths, { handle: 'alice', name: '', role: '', focus: '' })
		await assignNode(paths, 'auth-api-k7f2', 'alice')
		expect((await readNode(paths, 'auth-api-k7f2')).kind).toBe('ok')
	})

	test('assigning to nobody needs no contributor at all', async () => {
		await assignNode(paths, 'auth-api-k7f2', null)

		const record = await readNode(paths, 'auth-api-k7f2')
		expect(record.kind === 'ok' && record.value.assignee).toBeNull()
	})

	test('a node the board does not hold is refused by all three', async () => {
		await expect(claimNode(paths, 'gone-k7f2', 'alice')).rejects.toThrow('not on this board')
		await expect(releaseNode(paths, 'gone-k7f2')).rejects.toThrow('not on this board')
		await expect(assignNode(paths, 'gone-k7f2', null)).rejects.toThrow('not on this board')
	})

	test('a project starts with nobody on it, and adding someone twice corrects them', async () => {
		expect(await readContributors(paths)).toEqual([])

		await addContributor(paths, { handle: 'alice', name: 'Alice', role: 'maintainer', focus: '' })
		await addContributor(paths, { handle: 'alice', name: 'Alice', role: 'reviewer', focus: '' })

		expect(await readContributors(paths)).toEqual([
			{ handle: 'alice', name: 'Alice', role: 'reviewer', focus: '' },
		])
	})

	test('taking off somebody who was never on says so rather than pretending', async () => {
		expect(await removeContributor(paths, 'alice')).toBe(false)

		await addContributor(paths, { handle: 'alice', name: '', role: '', focus: '' })
		expect(await removeContributor(paths, 'alice')).toBe(true)
		expect(await readContributors(paths)).toEqual([])
	})

	test('a team file that will not parse is loud, because the next write replaces it', async () => {
		await writeFile(paths.contributors, '{ not json')

		await expect(readContributors(paths)).rejects.toThrow('cannot be read')
	})
})
