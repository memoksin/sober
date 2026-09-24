import { SoberError } from './errors.js'
import { git, hasUncommitted, refExists } from './git.js'
import type { Paths } from './paths.js'
import { branchOf } from './worktree.js'

/**
 * M1 accepts locally: there is no remote in the nine-step script, and a repo
 * with no remote cannot take a pull request (§6.3). The pull request path is
 * M2's, and it is a second implementation of this decision, not a change to it.
 */
export class MergeRefusedError extends SoberError {
	constructor(reason: string) {
		super('merge-refused', reason)
	}
}

export interface Merged {
	readonly branch: string
	readonly base: string
	readonly commit: string
}

/**
 * The local merge behind accept. `--no-ff` on purpose: the node's commits stay
 * grouped under one merge commit, so `git log` still shows which node produced
 * which work after the branch is gone.
 */
export const mergeNode = async (paths: Paths, id: string, base: string): Promise<Merged> => {
	const branch = branchOf(id)

	if (await hasUncommitted(paths.root)) {
		throw new MergeRefusedError(
			`the working tree has uncommitted changes — accept would merge into them`,
		)
	}
	const onBase = (await git(paths.root, 'rev-parse', '--abbrev-ref', 'HEAD')) === base
	if (!onBase) {
		throw new MergeRefusedError(
			`the working tree is not on ${base} — switch to it and accept again`,
		)
	}

	const before = await git(paths.root, 'rev-parse', 'HEAD')
	try {
		await git(paths.root, 'merge', '--no-ff', '-m', `sober: ${id}`, branch)
	} catch {
		// The merge is ours, started a moment ago on a clean checkout, so aborting
		// it throws away nothing a human did. Leaving it half-done would leave the
		// main checkout conflicted over work nobody accepted.
		if (!(await restored(paths.root, before)))
			throw new MergeRefusedError(
				`${branch} does not merge into ${base} cleanly, and ${base} could not be put back at ${before} — the repository may still be mid-merge: run \`git merge --abort\` there and check that ${base} is back at ${before}, then resolve ${branch} or reject the node`,
			)
		throw new MergeRefusedError(
			`${branch} does not merge into ${base} cleanly — ${base} is left as it was; resolve the conflict on ${branch}, or reject the node`,
		)
	}

	return { branch, base, commit: await git(paths.root, 'rev-parse', 'HEAD') }
}

/** Aborts a merge in progress, and says whether the checkout is back at `head` and clean. */
const restored = async (root: string, head: string): Promise<boolean> => {
	// A merge git refused to start (an untracked file in the way) leaves no
	// MERGE_HEAD, and `--abort` on it is an error of its own.
	if (await refExists(root, 'MERGE_HEAD')) await git(root, 'merge', '--abort').catch(() => '')
	return (
		!(await refExists(root, 'MERGE_HEAD')) &&
		(await git(root, 'rev-parse', 'HEAD')) === head &&
		!(await hasUncommitted(root))
	)
}

/**
 * Takes back the merge `mergeNode` just made, when the checkout still stands
 * exactly on it. Anything else means someone moved on from it, and resetting
 * then would throw their work away — so it says no rather than guessing.
 */
export const unmergeNode = async (paths: Paths, merged: Merged): Promise<boolean> => {
	const head = await git(paths.root, 'rev-parse', 'HEAD').catch(() => '')
	if (head !== merged.commit || (await hasUncommitted(paths.root))) return false
	await git(paths.root, 'reset', '--keep', `${merged.commit}^1`)
	return true
}

/**
 * After an accepted merge the branch has no job left; a rejection keeps
 * everything (§6.4). `force` is the pull-request landing: the merge happened on
 * the host, so the branch is not an ancestor of anything here and `-d` would
 * refuse to delete work that is already landed.
 */
export const deleteBranch = async (
	paths: Paths,
	id: string,
	options: { readonly force?: boolean } = {},
): Promise<void> => {
	await git(paths.root, 'branch', options.force === true ? '-D' : '-d', branchOf(id))
}
