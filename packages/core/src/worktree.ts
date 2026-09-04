import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { git, isDirty, refExists } from './git.js'
import type { Paths } from './paths.js'

/**
 * A node has one branch and one worktree for its whole life, not one per run
 * (ADR 0012): two rejections would otherwise leave three branches, three
 * worktrees and three draft pull requests behind, with cleanup covering only
 * the worktrees.
 */
export const branchOf = (id: string): string => `sober/${id}`

/**
 * Worktrees live under `local/`, which is gitignored and disposable (DESIGN
 * §1.4) — a worktree is state a second machine must never inherit.
 */
export const worktreeOf = (paths: Paths, id: string): string => join(paths.local, 'worktrees', id)

export class DirtyWorktreeError extends Error {
	constructor(
		readonly node: string,
		readonly path: string,
	) {
		super(`${node} has uncommitted work in ${path} — commit it or remove it by hand`)
		this.name = 'DirtyWorktreeError'
	}
}

export interface Worktree {
	readonly path: string
	readonly branch: string
	/** False when the worktree was already there — a retry reuses it (§5.0). */
	readonly created: boolean
}

/**
 * Adds the node's worktree, cutting its branch from `base` the first time. A
 * retry reuses both, so the agent sees what it wrote last time and the feedback
 * — §6.4's "rejecting is correcting" in practice.
 */
export const addWorktree = async (paths: Paths, id: string, base: string): Promise<Worktree> => {
	const path = worktreeOf(paths, id)
	const branch = branchOf(id)

	if (await isWorktree(paths, path)) return { path, branch, created: false }

	const args = (await refExists(paths.root, branch))
		? ['worktree', 'add', path, branch]
		: ['worktree', 'add', '-b', branch, path, base]
	await git(paths.root, ...args)
	return { path, branch, created: true }
}

/**
 * Nothing removes a dirty worktree (§8.2). Never `--force`, and never a
 * directory delete as a fallback: that is how v0 deleted work nobody had
 * committed yet, silently. A refusal the user can act on beats a cleanup that
 * always succeeds.
 */
export const removeWorktree = async (paths: Paths, id: string): Promise<void> => {
	const path = worktreeOf(paths, id)
	if (!(await isWorktree(paths, path))) return
	if (await isDirty(path)) throw new DirtyWorktreeError(id, path)

	await git(paths.root, 'worktree', 'remove', path)
}

/** The worktrees git knows about, by path. `--porcelain` so no locale changes the parse. */
export const listWorktrees = async (paths: Paths): Promise<string[]> =>
	(await git(paths.root, 'worktree', 'list', '--porcelain'))
		.split('\n')
		.filter((line) => line.startsWith('worktree '))
		.map((line) => line.slice('worktree '.length))

/**
 * git reports resolved paths, and a temp directory on macOS reaches the same
 * worktree through a symlink. Comparing the strings would add a second worktree
 * for a node that already has one.
 */
const isWorktree = async (paths: Paths, path: string): Promise<boolean> => {
	const target = await resolved(path)
	if (target === null) return false
	const known = await Promise.all((await listWorktrees(paths)).map(resolved))
	return known.includes(target)
}

const resolved = async (path: string): Promise<string | null> => {
	try {
		return await realpath(path)
	} catch {
		return null
	}
}

/**
 * A worktree git no longer knows about — a directory left by an interrupted
 * `worktree add`, or one removed from git's side. Cleaning it is a delete, so
 * it is only ever called for a path git does not list.
 */
export const pruneWorktrees = async (paths: Paths): Promise<void> => {
	await git(paths.root, 'worktree', 'prune')
}

/** "Start clean" on the rejection surface (§5.0): the branch goes back to its base. */
export const resetToBase = async (paths: Paths, id: string, base: string): Promise<void> => {
	const path = worktreeOf(paths, id)
	if (!(await isWorktree(paths, path))) return
	await git(path, 'reset', '--hard', base)
	// No -x: ignored files stay, so `dispatch.setup`'s install is not thrown away.
	await git(path, 'clean', '-fd')
}
