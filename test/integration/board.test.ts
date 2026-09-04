import { execFileSync } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	adoptBoard,
	initBoard,
	type Paths,
	readNodes,
	paths as resolve,
	SoberError,
	sync,
	writeNode,
} from '@besober/core'
import { afterEach, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * The same two clones as `sync.test.ts`, one level down. That one proves what a
 * person sees; this one runs `core` in this process, so the refusals a CLI test
 * cannot reach — an unreachable remote, two unrelated boards — are exercised
 * where they are written.
 */
const BRANCH = 'sober-graph'

let repo: TempRepo | undefined
let clone: string | undefined

afterEach(() => {
	repo?.cleanup()
	repo = undefined
	if (clone !== undefined) rmSync(clone, { recursive: true, force: true })
	clone = undefined
})

const node = (title: string) => ({
	title,
	description: title,
	notes: '',
	dependsOn: [],
	decisions: [],
	files: [],
	brief: null,
	outcome: null,
	accepted: null,
	createdAt: '2026-09-05T00:00:00.000Z',
})

const git = (cwd: string, ...args: string[]): string =>
	execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** A repository with a board, its code branch pushed, ready to sync. */
const board = async (): Promise<{ created: TempRepo; paths: Paths }> => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# fixture\n')
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: first')
	const { paths } = await initBoard(created.dir, { title: 'Acme', intent: '', constraints: [] })
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: sober')
	created.git('push', '-u', 'origin', 'main')
	return { created, paths }
}

const second = async (remote: string): Promise<Paths> => {
	const dir = join(remote, '..', 'clone')
	clone = dir
	execFileSync('git', ['clone', '--quiet', remote, dir])
	git(dir, 'config', 'user.name', 'Bob')
	git(dir, 'config', 'user.email', 'bob@example.com')
	git(dir, 'config', 'commit.gpgsign', 'false')
	return resolve(dir)
}

test('the first sync makes the board branch on the remote', async () => {
	const { created, paths } = await board()
	await writeNode(paths, 'one-aaaa', node('One'))

	const result = await sync(paths, BRANCH)
	expect(result).toMatchObject({ kind: 'synced', committed: true, pushed: true })
	expect(git(created.dir, 'ls-remote', '--heads', 'origin', BRANCH)).toContain(BRANCH)
})

test('a second sync with nothing new commits nothing', async () => {
	const { paths } = await board()
	await writeNode(paths, 'one-aaaa', node('One'))
	await sync(paths, BRANCH)

	expect(await sync(paths, BRANCH)).toMatchObject({ committed: false, pushed: true })
})

test('adopting brings the board in, and the second clone reads the same records', async () => {
	const { created, paths } = await board()
	await writeNode(paths, 'one-aaaa', node('One'))
	await sync(paths, BRANCH)

	const theirs = await second(created.remote)
	expect(await adoptBoard(theirs, BRANCH)).toBe(2)
	const nodes = await readNodes(theirs)
	expect([...nodes.records.keys()]).toEqual(['one-aaaa'])
	// The directories a board has, whether or not the remote had anything in them.
	expect(existsSync(theirs.decisions)).toBe(true)
})

test('there is nothing to adopt when the remote has no board', async () => {
	const { created } = await board()
	const theirs = await second(created.remote)
	expect(await adoptBoard(theirs, BRANCH)).toBe(null)
})

test('there is nothing to adopt with no remote at all', async () => {
	const { created, paths } = await board()
	created.git('remote', 'remove', 'origin')
	expect(await adoptBoard(paths, BRANCH)).toBe(null)
})

test('different records on both sides merge, and both survive', async () => {
	const { created, paths } = await board()
	await writeNode(paths, 'shared-aaaa', node('Shared'))
	await sync(paths, BRANCH)

	const theirs = await second(created.remote)
	await adoptBoard(theirs, BRANCH)
	await writeNode(theirs, 'theirs-bbbb', node('Theirs'))
	await sync(theirs, BRANCH)

	await writeNode(paths, 'ours-aaaa', node('Ours'))
	const merged = await sync(paths, BRANCH)
	expect(merged.kind).toBe('synced')
	expect(merged.pulled.updated).toEqual(['.sober/nodes/theirs-bbbb.json'])
	expect([...(await readNodes(paths)).records.keys()].sort()).toEqual([
		'ours-aaaa',
		'shared-aaaa',
		'theirs-bbbb',
	])
})

test('one record changed on both sides is named, and the working tree is untouched', async () => {
	const { created, paths } = await board()
	await writeNode(paths, 'shared-aaaa', node('Shared'))
	await sync(paths, BRANCH)

	const theirs = await second(created.remote)
	await adoptBoard(theirs, BRANCH)
	await writeNode(theirs, 'shared-aaaa', node('Theirs'))
	await sync(theirs, BRANCH)

	await writeNode(paths, 'shared-aaaa', node('Ours'))
	const result = await sync(paths, BRANCH)
	expect(result).toMatchObject({ kind: 'conflicted', pushed: false })
	expect(result.conflicts).toEqual(['.sober/nodes/shared-aaaa.json'])
	expect((await readNodes(paths)).records.get('shared-aaaa')?.title).toBe('Ours')
})

test('--no-push takes what is there and sends nothing', async () => {
	const { created, paths } = await board()
	await sync(paths, BRANCH)
	const theirs = await second(created.remote)
	await adoptBoard(theirs, BRANCH)
	await writeNode(theirs, 'theirs-bbbb', node('Theirs'))
	await sync(theirs, BRANCH)

	await writeNode(paths, 'unsent-aaaa', node('Unsent'))
	const result = await sync(paths, BRANCH, { push: false })
	expect(result).toMatchObject({ kind: 'synced', committed: true, pushed: false })
	expect(result.pulled.updated).toEqual(['.sober/nodes/theirs-bbbb.json'])

	// What was never pushed is not on the remote, and is still here.
	await sync(theirs, BRANCH)
	expect((await readNodes(theirs)).records.has('unsent-aaaa')).toBe(false)
	expect((await readNodes(paths)).records.has('unsent-aaaa')).toBe(true)
})

test('a clone with nothing of its own fast-forwards onto the team’s board', async () => {
	const { created, paths } = await board()
	await sync(paths, BRANCH)
	const theirs = await second(created.remote)
	await adoptBoard(theirs, BRANCH)

	await writeNode(paths, 'later-aaaa', node('Later'))
	await sync(paths, BRANCH)

	const result = await sync(theirs, BRANCH)
	expect(result).toMatchObject({ kind: 'synced', committed: false })
	expect(result.pulled.updated).toEqual(['.sober/nodes/later-aaaa.json'])
	expect((await readNodes(theirs)).records.has('later-aaaa')).toBe(true)
})

test('a record deleted on one side is deleted on the other', async () => {
	const { created, paths } = await board()
	await writeNode(paths, 'doomed-aaaa', node('Doomed'))
	await sync(paths, BRANCH)
	const theirs = await second(created.remote)
	await adoptBoard(theirs, BRANCH)

	rmSync(join(paths.nodes, 'doomed-aaaa.json'))
	await sync(paths, BRANCH)

	const result = await sync(theirs, BRANCH)
	expect(result.pulled.removed).toEqual(['.sober/nodes/doomed-aaaa.json'])
	expect(existsSync(join(theirs.nodes, 'doomed-aaaa.json'))).toBe(false)
})

test('a board with a directory missing still syncs', async () => {
	const { paths } = await board()
	await writeNode(paths, 'one-aaaa', node('One'))
	rmSync(paths.decisions, { recursive: true })

	expect(await sync(paths, BRANCH)).toMatchObject({ kind: 'synced', committed: true })
})

test('a repository with no remote commits the board and goes no further', async () => {
	const { created, paths } = await board()
	created.git('remote', 'remove', 'origin')
	await writeNode(paths, 'solo-aaaa', node('Solo'))

	expect(await sync(paths, BRANCH)).toMatchObject({
		kind: 'no-remote',
		committed: true,
		pushed: false,
	})
	expect(git(created.dir, 'ls-tree', '-r', '--name-only', BRANCH)).toContain(
		'.sober/nodes/solo-aaaa.json',
	)
})

test('two boards that share no history are refused, not merged', async () => {
	const { created, paths } = await board()
	await writeNode(paths, 'ours-aaaa', node('Ours'))
	await sync(paths, BRANCH)

	// A second board made from nothing, pushed over the same branch name: the
	// one shape where a merge would be a guess.
	const theirs = await second(created.remote)
	await initBoard(theirs.root, { title: 'Other', intent: '', constraints: [] })
	await sync(theirs, BRANCH, { push: false }).catch(() => undefined)
	git(theirs.root, 'push', '--force', 'origin', `refs/heads/${BRANCH}:refs/heads/${BRANCH}`)

	await writeNode(paths, 'later-aaaa', node('Later'))
	await expect(sync(paths, BRANCH)).rejects.toThrow(SoberError)
	await expect(sync(paths, BRANCH)).rejects.toThrow('two different boards')
})

test('a remote that cannot be reached is said out loud, not read as an empty board', async () => {
	const { created, paths } = await board()
	created.git('remote', 'set-url', 'origin', join(created.remote, 'gone'))
	await writeNode(paths, 'one-aaaa', node('One'))
	await expect(sync(paths, BRANCH)).rejects.toThrow('could not be reached')
})

test('a record from outside the board is never written to disk', async () => {
	const { created, paths } = await board()
	await sync(paths, BRANCH)

	// A crafted board commit, pushed by hand: the one input SOBER takes from a
	// remote is a tree, so it is the one that has to be filtered.
	writeFileSync(join(created.dir, 'payload'), 'owned\n')
	const object = git(created.dir, 'hash-object', '-w', 'payload')
	// A path outside `.sober/` — git will carry it, SOBER must not write it.
	const tree = execFileSync('git', ['mktree'], {
		cwd: created.dir,
		encoding: 'utf8',
		input: `100644 blob ${object}\t.git-hooks-payload\n`,
	}).trim()
	const commit = git(created.dir, 'commit-tree', tree, '-p', BRANCH, '-m', 'crafted')
	git(created.dir, 'push', '--force', 'origin', `${commit}:refs/heads/${BRANCH}`)
	rmSync(join(created.dir, 'payload'))

	const theirs = await second(created.remote)
	await adoptBoard(theirs, BRANCH)
	expect(existsSync(join(theirs.root, '.git-hooks-payload'))).toBe(false)
})
