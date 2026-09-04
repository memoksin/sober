import { SoberError } from './errors.js'
import { git, hasUncommitted } from './git.js'
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

	try {
		await git(paths.root, 'merge', '--no-ff', '-m', `sober: ${id}`, branch)
	} catch {
		// A conflicted merge is left for the user to finish or abort: aborting it
		// here would throw away a resolution they may already have started.
		throw new MergeRefusedError(
			`${branch} does not merge into ${base} cleanly — resolve it in the repository, or reject the node`,
		)
	}

	return { branch, base, commit: await git(paths.root, 'rev-parse', 'HEAD') }
}

/** After an accepted merge the branch has no job left; a rejection keeps everything (§6.4). */
export const deleteBranch = async (paths: Paths, id: string): Promise<void> => {
	await git(paths.root, 'branch', '-d', branchOf(id))
}
