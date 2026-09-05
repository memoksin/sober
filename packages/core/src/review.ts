import type { Accepted, Handle, ScanResult } from '@besober/schema'
import { DEFAULT_CONFIG, readConfig } from './config.js'
import { git, refExists } from './git.js'
import { type Board, loadBoard } from './graph.js'
import { appendEvent, type Feedback, writeFeedback } from './local.js'
import { deleteBranch, type Merged, MergeRefusedError, mergeNode } from './merge.js'
import type { Paths } from './paths.js'
import { type Checks, checksOf, type PullRequest, pullRequestOf, readyAndMerge } from './pr.js'
import { acceptNode } from './run.js'
import { type ScanReport, scanNode } from './scan.js'
import { lastRun, statusOf } from './status.js'
import { branchOf, removeWorktree, resetToBase, worktreeOf } from './worktree.js'

/**
 * Review is checks, not reading (ADR 0022): what a surface shows is the scan,
 * the acceptance results and the diff — in that order, findings above the diff
 * and never beside it (§6.2). The same three surfaces call this one function,
 * so none of them can render a review the others cannot.
 */
export interface Review {
	readonly node: string
	readonly scan: ScanReport
	readonly diff: string
	readonly files: readonly string[]
	/** The run being reviewed, or null when nothing has run yet. */
	readonly run: string | null
	readonly exit: string | null
	readonly acceptance: readonly { readonly run: string; readonly proves: string }[]
	/** CI, when there is a pull request to read it from (§6.1). */
	readonly ci: Checks
	/** The node's draft pull request, when one was opened. */
	readonly pr: PullRequest | null
	/**
	 * Work sitting in the worktree that was never committed. A diff against the
	 * base cannot see it, so without this a review of an agent that wrote
	 * everything and committed nothing reads exactly like a review of an agent
	 * that did nothing (found in the M1 gate).
	 */
	readonly uncommitted: readonly string[]
	/**
	 * Set once the node is done. A review of accepted work is a record of what
	 * was accepted, not a decision waiting to be made — found in M2's gate, where
	 * a node accepted from a session still read as reviewable in the terminal and
	 * offered an accept that then had no branch to merge.
	 */
	readonly accepted: Accepted | null
}

export const reviewNode = async (
	paths: Paths,
	node: string,
	base: string,
): Promise<Review | null> => {
	const board = await loadBoard(paths)
	const record = board.nodes.get(node)
	if (record === undefined) return null

	// A node nobody has run has no branch, and `git diff` against a ref that is
	// not there is a fatal error rather than an empty diff. Nothing has run, so
	// there is nothing to review — which `exit` already says (§8.7: no message
	// here is a stack trace).
	const started = await refExists(paths.root, branchOf(node))
	const diff = started ? await git(paths.root, 'diff', `${base}...${branchOf(node)}`) : ''
	const scan = started
		? await scanNode(paths, node, { base, diff: await unified0(paths, base, node) })
		: await scanNode(paths, node, { base, diff: '' })
	const run = lastRun(board, node)

	return {
		node,
		scan,
		diff,
		files: scan.files,
		run: run?.id ?? null,
		exit: run?.run.exit ?? null,
		acceptance: record.brief?.acceptance ?? [],
		ci: await checksOf(paths, node),
		pr: await pullRequestOf(paths, node),
		uncommitted: await uncommittedIn(paths, node),
		accepted: record.accepted,
	}
}

const uncommittedIn = async (paths: Paths, node: string): Promise<string[]> => {
	const path = worktreeOf(paths, node)
	// `--untracked-files=all`, because the default collapses a new directory to
	// `src/` and the human needs the file names to know what is missing.
	return (await git(path, 'status', '--porcelain', '--untracked-files=all').catch(() => ''))
		.split('\n')
		.map((line) => line.slice(3).trim())
		.filter((file) => file !== '')
}

const unified0 = (paths: Paths, base: string, node: string): Promise<string> =>
	git(paths.root, 'diff', '--unified=0', `${base}...sober/${node}`)

export interface AcceptOptions {
	readonly by: Handle
	readonly base: string
	readonly scan: ScanResult
	readonly flagged?: boolean
}

/**
 * Accepting lands the work (§6.3): the `accepted` record is written — which is
 * what makes the node `done`, with no boolean to forget — then the branch is
 * merged locally and the worktree removed.
 *
 * The record is written **first**, on purpose. A merge that succeeds and a
 * record that never lands leaves work in the repository that the board says
 * nobody accepted; the other order leaves an accepted node whose merge the user
 * can retry.
 */
export type Landed =
	| ({ readonly kind: 'merged' } & Merged)
	| { readonly kind: 'pull-request'; readonly pr: PullRequest; readonly base: string }

export const acceptWork = async (
	paths: Paths,
	node: string,
	options: AcceptOptions,
): Promise<Landed> => {
	// Nothing to land is not something to accept. Found in the M1 gate: an agent
	// wrote its files and never committed them, the branch held no commit past
	// the base, and `git merge` on an ancestor succeeds by doing nothing — so
	// the node read `done` with an empty `main` behind it.
	//
	// This runs before the record is written, because the record is what makes
	// the node done: the safe order below only helps when there is a merge to
	// retry.
	//
	// The branch first, because `rev-list` on one that is not there is a git
	// error about an ambiguous argument, and §8.7 asks for a sentence. It is
	// reachable: accept deletes the branch, and a merge can put `accepted` back
	// to null on a clone where the branch is already gone.
	if (!(await refExists(paths.root, branchOf(node))))
		throw new MergeRefusedError(
			`${node} has no branch to merge — ${branchOf(node)} is not in this repository, so there is nothing here to land`,
		)
	const commits = await git(paths.root, 'rev-list', '--count', `${options.base}..${branchOf(node)}`)
	if (commits.trim() === '0') {
		const waiting = await uncommittedIn(paths, node)
		throw new MergeRefusedError(
			waiting.length > 0
				? `${node} has nothing committed to merge, and ${waiting.length} file(s) are sitting uncommitted in its worktree: ${waiting.join(', ')} — accepting now would land nothing and record it as done`
				: `${node} has nothing to merge: its branch holds no commit that ${options.base} does not`,
		)
	}

	// Which landing (D33) is the project's, not the run's: a protected main
	// cannot take a local merge, and a repository with no remote cannot take a
	// pull request. It governs neither how a run is prepared nor how it is
	// judged, so it is read normally rather than from the base (§5.2).
	const config = await readConfig(paths)
	const through =
		config.kind === 'ok' ? config.value.dispatch.accept : DEFAULT_CONFIG.dispatch.accept

	// The pull request has to be there before the record is written: the record
	// is what makes the node done, and a done node whose work never landed is
	// the one state this order exists to prevent.
	if (through === 'pull-request') await requirePullRequest(paths, node)

	await acceptNode(paths, node, {
		by: options.by,
		at: new Date().toISOString(),
		flagged: options.flagged ?? false,
		// Recorded as it was at the moment a human accepted, including "the scan
		// did not run" — `PR-09-06` exists so that case cannot be dropped.
		scan: options.scan,
	})

	if (through === 'pull-request') {
		const pr = await readyAndMerge(paths, node)
		await removeWorktree(paths, node)
		// The merge happened on the host, so this branch is not an ancestor of
		// anything here — `-d` would refuse work that is already landed.
		await deleteBranch(paths, node, { force: true })
		return { kind: 'pull-request', pr, base: options.base }
	}

	const merged = await mergeNode(paths, node, options.base)
	// Nothing removes a dirty worktree (§8.2), so this can refuse — and it
	// refuses after the work is safely merged, which is the harmless order.
	await removeWorktree(paths, node)
	await deleteBranch(paths, node)
	return { kind: 'merged', ...merged }
}

/** Refusing here beats writing an `accepted` record for work that cannot land. */
const requirePullRequest = async (paths: Paths, node: string): Promise<void> => {
	if ((await pullRequestOf(paths, node)) === null)
		throw new MergeRefusedError(
			`${node} has no pull request to merge — this project accepts through one (dispatch.accept), so let a run open it, or set dispatch.accept to "merge"`,
		)
}

export interface RejectOptions {
	readonly by: Handle
	readonly text: string
	/** The rejection surface's "start clean": the branch goes back to its base (§5.0). */
	readonly clean?: boolean
	readonly base?: string
}

/**
 * Rejecting is correcting, not discarding (§6.4). Nothing is deleted: the
 * branch, the worktree and the draft pull request all stay as they are, and the
 * next run carries this text alongside the brief.
 */
export const rejectWork = async (
	paths: Paths,
	node: string,
	options: RejectOptions,
): Promise<Feedback> => {
	const feedback: Feedback = {
		at: new Date().toISOString(),
		by: options.by,
		text: options.text,
		clean: options.clean ?? false,
	}
	await writeFeedback(paths, node, feedback)
	if (options.clean === true && options.base !== undefined)
		await resetToBase(paths, node, options.base)
	await appendEvent(paths, { action: 'node.rejected', node, by: options.by })
	return feedback
}

export interface Green {
	/** Every node in review whose checks are all clean, in id order. */
	readonly green: readonly string[]
	readonly held: readonly { readonly id: string; readonly why: string }[]
}

/**
 * Green is checks, not reading (ADR 0022): verification passed, every
 * acceptance command exited 0, the scan is clean, and CI is green (§6.0). Green
 * nodes are accepted together; a node that is not green takes the single-node
 * path, where a human reads what is wrong with it.
 *
 * "Did not run" is never "passed" — for the scan (`PR-09-06`), for an
 * acceptance command (ADR 0021), and for a git host that could not be reached.
 * A check nobody configured is a different thing from a check that failed to
 * answer, and only the first one is silence worth ignoring.
 */
export const greenNodes = async (paths: Paths, base: string): Promise<Green> => {
	const board = await loadBoard(paths)
	const green: string[] = []
	const held: { id: string; why: string }[] = []

	for (const id of [...board.nodes.keys()].sort()) {
		if (statusOf(board, id) !== 'in-review') continue
		const why = await notGreen(paths, board, id, base)
		if (why === null) green.push(id)
		else held.push({ id, why })
	}
	return { green, held }
}

const notGreen = async (
	paths: Paths,
	board: Board,
	id: string,
	base: string,
): Promise<string | null> => {
	const run = lastRun(board, id)?.run
	if (run === undefined || run.exit !== 'finished') return 'its last run did not finish'
	if (run.verify !== null && run.verify.exit !== 0) return 'verification failed'

	const criteria = board.nodes.get(id)?.brief?.acceptance ?? []
	for (const [at, criterion] of criteria.entries()) {
		const result = run.acceptance[at]
		if (result === undefined || result === null) return `\`${criterion.run}\` did not run`
		if (result.exit !== 0) return `\`${criterion.run}\` failed`
	}

	const found = await reviewNode(paths, id, base)
	if (found === null) return 'it is not on this board'
	if (found.scan.result !== 'clean')
		return found.scan.result === 'did-not-run' ? 'the scan did not run' : 'the scan has findings'
	if (found.uncommitted.length > 0) return 'its worktree holds work nobody committed'

	if (found.ci.kind === 'failing') return `CI failed: ${found.ci.failed.join(', ')}`
	if (found.ci.kind === 'pending') return 'CI has not finished'
	if (found.ci.kind === 'unavailable') return 'CI could not be read'
	return null
}
