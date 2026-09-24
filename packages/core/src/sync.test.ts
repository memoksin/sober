import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { SoberError } from './errors.js'
import { git } from './git.js'
import { paths } from './paths.js'
import { boardDistance, resolveConflict, sync } from './sync.js'
import { tmpRoot } from './tmp.fixture.js'

const BRANCH = 'sober/board'

/** A bare remote, a seed clone that writes board commits, and a work repo whose main commit tracks `.sober/`. */
const world = async () => {
	const bare = await tmpRoot('sober-dist-bare-')
	const seed = await tmpRoot('sober-dist-seed-')
	const work = await tmpRoot('sober-dist-work-')
	await git(bare, 'init', '--bare')
	for (const dir of [seed, work]) {
		await git(dir, 'init', '-b', 'main')
		await git(dir, 'config', 'user.name', 't')
		await git(dir, 'config', 'user.email', 't@t')
		await git(dir, 'remote', 'add', 'origin', bare)
	}
	await git(seed, 'checkout', '-b', BRANCH)
	const commit = async (dir: string, id: string) => {
		await mkdir(join(dir, '.sober', 'nodes'), { recursive: true })
		await writeFile(join(dir, '.sober', 'nodes', `${id}.json`), `{"id":"${id}"}\n`)
		await git(dir, 'add', '.')
		await git(dir, 'commit', '-m', id)
	}
	await commit(seed, 'a')
	await git(seed, 'push', 'origin', BRANCH)
	await commit(work, 'a')
	await git(work, 'fetch', 'origin', `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`)
	await git(work, 'update-ref', `refs/heads/${BRANCH}`, `refs/remotes/origin/${BRANCH}`)
	const seedAhead = async (id: string) => {
		await commit(seed, id)
		await git(seed, 'push', 'origin', BRANCH)
	}
	const localAhead = async (id: string) => {
		const tree = await git(work, 'rev-parse', `${BRANCH}^{tree}`)
		const next = await git(work, 'commit-tree', tree, '-p', BRANCH, '-m', id)
		await git(work, 'update-ref', `refs/heads/${BRANCH}`, next)
	}
	return { work, seedAhead, localAhead }
}

test('the remote ahead with nothing local unsent is counted, and pull brings the records', async () => {
	const w = await world()
	await w.seedAhead('b')
	expect(await boardDistance(paths(w.work), BRANCH)).toMatchObject({
		ahead: 0,
		behind: 1,
		pulled: null,
	})
	const pulled = await boardDistance(paths(w.work), BRANCH, { pull: true })
	expect(pulled).toMatchObject({ kind: 'ok', ahead: 0, behind: 1, remote: 'origin' })
	expect(pulled.kind === 'ok' && pulled.pulled?.updated).toEqual(['.sober/nodes/b.json'])
	expect(await readFile(join(w.work, '.sober', 'nodes', 'b.json'), 'utf8')).toContain('"b"')
	expect(await boardDistance(paths(w.work), BRANCH)).toMatchObject({ ahead: 0, behind: 0 })
})

test('a local branch ahead is counted and pull moves nothing, so push stays human', async () => {
	const w = await world()
	await w.localAhead('x')
	const before = await git(w.work, 'rev-parse', BRANCH)
	expect(await boardDistance(paths(w.work), BRANCH, { pull: true })).toMatchObject({
		ahead: 1,
		behind: 0,
		pulled: null,
	})
	expect(await git(w.work, 'rev-parse', BRANCH)).toBe(before)
})

test('a diverged branch reports both counts and never pulls', async () => {
	const w = await world()
	await w.localAhead('x')
	await w.seedAhead('b')
	expect(await boardDistance(paths(w.work), BRANCH, { pull: true })).toMatchObject({
		ahead: 1,
		behind: 1,
		pulled: null,
	})
})

test('a repository with no remote says so', async () => {
	const w = await world()
	await git(w.work, 'remote', 'remove', 'origin')
	expect(await boardDistance(paths(w.work), BRANCH)).toEqual({ kind: 'no-remote' })
})

test('an unreachable remote answers offline instead of throwing', async () => {
	const w = await world()
	await git(w.work, 'remote', 'set-url', 'origin', join(w.work, 'nowhere'))
	expect(await boardDistance(paths(w.work), BRANCH, { timeoutMs: 2000 })).toEqual({
		kind: 'offline',
	})
})

test('sync refuses the branch checked out here, and leaves it untouched', async () => {
	const w = await world()
	const before = await git(w.work, 'rev-parse', 'main')
	const tree = await git(w.work, 'rev-parse', 'main^{tree}')
	await expect(sync(paths(w.work), 'main')).rejects.toThrow(SoberError)
	expect(await git(w.work, 'rev-parse', 'main')).toBe(before)
	expect(await git(w.work, 'rev-parse', 'main^{tree}')).toBe(tree)
	expect(await git(w.work, 'log', '--all', '--grep', 'sober: board from')).toBe('')
})

test('resolveConflict refuses the branch checked out here', async () => {
	const w = await world()
	const before = await git(w.work, 'rev-parse', 'main')
	await expect(resolveConflict(paths(w.work), 'main', 'a', {})).rejects.toThrow(SoberError)
	expect(await git(w.work, 'rev-parse', 'main')).toBe(before)
})

test('local work under .sober/ refuses the fast-forward but keeps the counts', async () => {
	const w = await world()
	await w.seedAhead('b')
	await writeFile(join(w.work, '.sober', 'nodes', 'a.json'), '{"id":"edited"}\n')
	expect(await boardDistance(paths(w.work), BRANCH, { pull: true })).toMatchObject({
		ahead: 0,
		behind: 1,
		pulled: null,
	})
	expect(await readFile(join(w.work, '.sober', 'nodes', 'a.json'), 'utf8')).toContain('edited')
})

test('boardDistance for a repository that never fetched the board counts against the remote alone', async () => {
	const bare = await tmpRoot('sober-dist-bare-')
	const seed = await tmpRoot('sober-dist-seed-')
	const work = await tmpRoot('sober-dist-work-')
	await git(bare, 'init', '--bare')
	for (const dir of [seed, work]) {
		await git(dir, 'init', '-b', 'main')
		await git(dir, 'config', 'user.name', 't')
		await git(dir, 'config', 'user.email', 't@t')
		await git(dir, 'remote', 'add', 'origin', bare)
	}
	await git(seed, 'checkout', '-b', BRANCH)
	await mkdir(join(seed, '.sober', 'nodes'), { recursive: true })
	await writeFile(join(seed, '.sober', 'nodes', 'a.json'), '{"id":"a"}\n')
	await git(seed, 'add', '.')
	await git(seed, 'commit', '-m', 'a')
	await git(seed, 'push', 'origin', BRANCH)

	// `work` never fetched or created the branch: `boardDistance` has to fetch
	// it itself and count against the remote ref alone, with no local `ours`.
	expect(await boardDistance(paths(work), BRANCH)).toMatchObject({
		kind: 'ok',
		ahead: 0,
		behind: 1,
		remote: 'origin',
		pulled: null,
	})
})

test('boardDistance says no-remote for a board neither side ever made', async () => {
	const bare = await tmpRoot('sober-dist-bare-')
	const work = await tmpRoot('sober-dist-work-')
	await git(bare, 'init', '--bare')
	await git(work, 'init', '-b', 'main')
	await git(work, 'config', 'user.name', 't')
	await git(work, 'config', 'user.email', 't@t')
	await git(work, 'remote', 'add', 'origin', bare)

	expect(await boardDistance(paths(work), BRANCH)).toEqual({ kind: 'no-remote' })
})
