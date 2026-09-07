import { writeFile } from 'node:fs/promises'
import type { Node } from '@besober/schema'
import { beforeEach, describe, expect, test } from 'vitest'
import { initBoard } from './board.js'
import { addContributor, readContributors, removeContributor } from './contributors.js'
import type { Paths } from './paths.js'
import { aNode } from './records.fixture.js'
import { readNode, writeNode } from './records.js'
import { assignNode, claimChain, claimNode, overlaps, releaseChain, releaseNode } from './team.js'
import { tmpRoot } from './tmp.fixture.js'

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
			accepted: {
				by: 'alice',
				at: '2026-09-05T10:00:00.000Z',
				flagged: false,
				scan: 'clean',
				audit: 'passed',
			},
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
		const root = await tmpRoot('sober-team-')
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

	test('Bob is not a second person from bob', async () => {
		await addContributor(paths, { handle: 'bob', name: '', role: 'author', focus: '' })
		await addContributor(paths, { handle: 'Bob', name: 'Bob', role: 'author', focus: '' })

		expect(await readContributors(paths)).toEqual([
			{ handle: 'Bob', name: 'Bob', role: 'author', focus: '' },
		])
		expect(await removeContributor(paths, 'BOB')).toBe(true)
		expect(await readContributors(paths)).toEqual([])
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

/**
 * A run of linked nodes, taken and given back in one act (ADR 0050). The board
 * is the one the decision was taken against: a run hanging off a shared
 * foundation, with a second feature beside it that must never be swept in.
 */
describe('a run of linked nodes', () => {
	let paths: Paths

	beforeEach(async () => {
		const root = await tmpRoot('sober-chain-')
		paths = (await initBoard(root, { title: 'Acme', intent: '', constraints: [] })).paths
		await writeNode(paths, 'db-setup-4t7w', aNode({ title: 'The database' }))
		await writeNode(paths, 'auth-schema-m3q8', aNode({ dependsOn: ['db-setup-4t7w'] }))
		await writeNode(paths, 'auth-api-k7f2', aNode({ dependsOn: ['auth-schema-m3q8'] }))
		await writeNode(paths, 'auth-ui-9x1p', aNode({ dependsOn: ['auth-api-k7f2'] }))
		await writeNode(paths, 'billing-api-7h4d', aNode({ dependsOn: ['db-setup-4t7w'] }))
	})

	const claimOf = async (id: string) => {
		const record = await readNode(paths, id)
		return record.kind === 'ok' ? record.value.claim : null
	}

	test('taking the whole run is one act, and it stops at the ends it was given', async () => {
		const run = await claimChain(paths, 'auth-schema-m3q8', 'auth-ui-9x1p', 'alice')

		expect(run.changed).toEqual(['auth-schema-m3q8', 'auth-api-k7f2', 'auth-ui-9x1p'])
		expect((await claimOf('auth-ui-9x1p'))?.by).toBe('alice')
		expect(await claimOf('db-setup-4t7w')).toBeNull()
		expect(await claimOf('billing-api-7h4d')).toBeNull()
	})

	test('one act means one moment: every node in the run carries the same timestamp', async () => {
		await claimChain(paths, 'auth-schema-m3q8', 'auth-ui-9x1p', 'alice')

		const at = await Promise.all(
			['auth-schema-m3q8', 'auth-api-k7f2', 'auth-ui-9x1p'].map(
				async (id) => (await claimOf(id))?.at,
			),
		)
		expect(new Set(at).size).toBe(1)
	})

	test('a run whose middle is someone else’s is refused whole, and takes nothing', async () => {
		await claimNode(paths, 'auth-api-k7f2', 'bob')

		const run = await claimChain(paths, 'auth-schema-m3q8', 'auth-ui-9x1p', 'alice')

		expect(run.changed).toEqual([])
		expect(run.taken).toEqual([{ id: 'auth-api-k7f2', by: 'bob' }])
		expect(run.nodes).toEqual(['auth-schema-m3q8', 'auth-api-k7f2', 'auth-ui-9x1p'])
		expect(await claimOf('auth-schema-m3q8')).toBeNull()
	})

	test('the second command is the confirmation, and it says whose it was', async () => {
		await claimNode(paths, 'auth-api-k7f2', 'bob')

		const run = await claimChain(paths, 'auth-schema-m3q8', 'auth-ui-9x1p', 'alice', {
			anyway: true,
		})

		expect(run.changed).toEqual(['auth-schema-m3q8', 'auth-api-k7f2', 'auth-ui-9x1p'])
		expect(run.taken).toEqual([{ id: 'auth-api-k7f2', by: 'bob' }])
		expect((await claimOf('auth-api-k7f2'))?.by).toBe('alice')
	})

	test('my own node in the run is not somebody else’s, whatever case it was written in', async () => {
		await claimNode(paths, 'auth-api-k7f2', 'Alice')

		const run = await claimChain(paths, 'auth-schema-m3q8', 'auth-ui-9x1p', 'alice')

		expect(run.taken).toEqual([])
		expect(run.changed).toHaveLength(3)
	})

	test('a finished node in the middle is left alone — a claim on it says nothing', async () => {
		await writeNode(
			paths,
			'auth-api-k7f2',
			aNode({
				dependsOn: ['auth-schema-m3q8'],
				accepted: {
					by: 'bob',
					at: '2026-09-05T10:00:00.000Z',
					flagged: false,
					scan: 'clean',
					audit: 'passed',
				},
			}),
		)

		const run = await claimChain(paths, 'auth-schema-m3q8', 'auth-ui-9x1p', 'alice')

		expect(run.changed).toEqual(['auth-schema-m3q8', 'auth-ui-9x1p'])
		expect(run.done).toEqual(['auth-api-k7f2'])
		expect(await claimOf('auth-api-k7f2')).toBeNull()
	})

	test('giving the run back is one act too, and it leaves a teammate’s node alone', async () => {
		await claimChain(paths, 'auth-schema-m3q8', 'auth-ui-9x1p', 'alice')
		await claimNode(paths, 'auth-api-k7f2', 'bob')

		const run = await releaseChain(paths, 'auth-schema-m3q8', 'auth-ui-9x1p', 'alice')

		expect(run.changed).toEqual(['auth-schema-m3q8', 'auth-ui-9x1p'])
		expect(run.taken).toEqual([{ id: 'auth-api-k7f2', by: 'bob' }])
		expect((await claimOf('auth-api-k7f2'))?.by).toBe('bob')
		expect(await claimOf('auth-ui-9x1p')).toBeNull()
	})

	test('a claim is a snapshot: a node that lands in the run later is nobody’s', async () => {
		await claimChain(paths, 'auth-schema-m3q8', 'auth-ui-9x1p', 'alice')

		// What a teammate’s sync does — a new node inside the run they took.
		await writeNode(paths, 'auth-token-5r2v', aNode({ dependsOn: ['auth-schema-m3q8'] }))
		await writeNode(paths, 'auth-api-k7f2', aNode({ dependsOn: ['auth-token-5r2v'] }))

		expect(await claimOf('auth-token-5r2v')).toBeNull()
		expect((await claimChain(paths, 'auth-schema-m3q8', 'auth-ui-9x1p', 'alice')).changed).toEqual([
			'auth-schema-m3q8',
			'auth-token-5r2v',
			'auth-api-k7f2',
			'auth-ui-9x1p',
		])
	})

	test('two ends with nothing between them take nothing, and say so as an empty run', async () => {
		const run = await claimChain(paths, 'auth-api-k7f2', 'billing-api-7h4d', 'alice')

		expect(run.nodes).toEqual([])
		expect(run.changed).toEqual([])
		expect(await claimOf('auth-api-k7f2')).toBeNull()
	})

	test('an end the board does not hold is refused, the way one node is', async () => {
		await expect(claimChain(paths, 'auth-api-k7f2', 'gone-k7f2', 'alice')).rejects.toThrow(
			'not on this board',
		)
		await expect(releaseChain(paths, 'gone-k7f2', 'auth-ui-9x1p', 'alice')).rejects.toThrow(
			'not on this board',
		)
	})
})
