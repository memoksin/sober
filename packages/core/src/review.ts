import type { Handle, ScanResult } from '@besober/schema'
import { git } from './git.js'
import { loadBoard } from './graph.js'
import { appendEvent, type Feedback, writeFeedback } from './local.js'
import { deleteBranch, mergeNode } from './merge.js'
import type { Paths } from './paths.js'
import { acceptNode } from './run.js'
import { type ScanReport, scanNode } from './scan.js'
import { lastRun } from './status.js'
import { removeWorktree, resetToBase } from './worktree.js'

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
}

export const reviewNode = async (
	paths: Paths,
	node: string,
	base: string,
): Promise<Review | null> => {
	const board = await loadBoard(paths)
	const record = board.nodes.get(node)
	if (record === undefined) return null

	const diff = await git(paths.root, 'diff', `${base}...sober/${node}`)
	const scan = await scanNode(paths, node, { base, diff: await unified0(paths, base, node) })
	const run = lastRun(board, node)

	return {
		node,
		scan,
		diff,
		files: scan.files,
		run: run?.id ?? null,
		exit: run?.run.exit ?? null,
		acceptance: record.brief?.acceptance ?? [],
	}
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
export const acceptWork = async (paths: Paths, node: string, options: AcceptOptions) => {
	await acceptNode(paths, node, {
		by: options.by,
		at: new Date().toISOString(),
		flagged: options.flagged ?? false,
		// Recorded as it was at the moment a human accepted, including "the scan
		// did not run" — `PR-09-06` exists so that case cannot be dropped.
		scan: options.scan,
	})
	const merged = await mergeNode(paths, node, options.base)
	// Nothing removes a dirty worktree (§8.2), so this can refuse — and it
	// refuses after the work is safely merged, which is the harmless order.
	await removeWorktree(paths, node)
	await deleteBranch(paths, node)
	return merged
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
