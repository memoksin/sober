import picomatch from 'picomatch'
import { git } from './git.js'
import { loadBoard } from './graph.js'
import type { Paths } from './paths.js'

/**
 * How well a node's declared `files` (§3.1) predicted what its accepted work
 * actually touched — the measurement SCOPE.md's scope rule 3 asks for before
 * `undeclared-file` (`signals.ts`) can become anything sharper than a flag.
 *
 * Read-only, and derived the way status is (§3.2): nothing here is stored, and
 * nothing here changes what a scan flags or what a review shows.
 */
export interface MeasuredNode {
	readonly id: string
	readonly measurable: true
	/** The `sober: <id>` merge commit the node's work is read from. */
	readonly merge: string
	readonly touched: number
	readonly undeclared: number
	readonly declaredGlobs: number
	readonly unmatchedGlobs: number
}

export interface UnmeasurableNode {
	readonly id: string
	readonly measurable: false
	/** Why this node's work cannot be attributed to one reachable local merge. */
	readonly reason: string
}

export type NodeAccuracy = MeasuredNode | UnmeasurableNode

export interface AccuracyTotals {
	readonly measurableNodes: number
	readonly touchedFiles: number
	readonly undeclaredFiles: number
	readonly unmatchedGlobs: number
}

export interface Accuracy {
	readonly rows: readonly NodeAccuracy[]
	readonly totals: AccuracyTotals
}

/**
 * Every accepted node, matched against the git history reachable from `base`.
 * A node whose work is not attributable to exactly one reachable `sober: <id>`
 * merge — a remote PR squash, a rewritten history — is marked unmeasurable and
 * left out of the totals, never counted as zero (a node accepted with no work
 * to compare would read no differently from one nobody could measure).
 */
export const declaredAccuracy = async (paths: Paths, base: string): Promise<Accuracy> => {
	const board = await loadBoard(paths)
	const accepted = [...board.nodes].filter(([, node]) => node.accepted !== null)

	const rows = await Promise.all(
		accepted.map(([id, node]) => rowFor(paths.root, base, id, node.files)),
	)

	const measured = rows.filter((row): row is MeasuredNode => row.measurable)
	const totals: AccuracyTotals = {
		measurableNodes: measured.length,
		touchedFiles: measured.reduce((sum, row) => sum + row.touched, 0),
		undeclaredFiles: measured.reduce((sum, row) => sum + row.undeclared, 0),
		unmatchedGlobs: measured.reduce((sum, row) => sum + row.unmatchedGlobs, 0),
	}
	return { rows, totals }
}

const rowFor = async (
	root: string,
	base: string,
	id: string,
	files: readonly string[],
): Promise<NodeAccuracy> => {
	const merges = await mergesFor(root, base, id)
	if (merges.length !== 1)
		return {
			id,
			measurable: false,
			reason:
				merges.length === 0
					? `no "sober: ${id}" merge commit is reachable from ${base}`
					: `${merges.length} "sober: ${id}" merge commits are reachable from ${base}`,
		}

	const merge = merges[0] as string
	const touched = await touchedPaths(root, merge)
	// Empty declarations are not "no restriction" here, the way `signals.ts`
	// reads them (§9's the review signal, not this measurement) — a node that
	// declared nothing predicted none of what it touched.
	const isDeclared = files.length === 0 ? () => false : picomatch(files as string[])
	const undeclared = touched.filter((path) => !isDeclared(path)).length
	const unmatchedGlobs = files.filter((glob) => {
		const matches = picomatch(glob)
		return !touched.some((path) => matches(path))
	}).length

	return {
		id,
		measurable: true,
		merge,
		touched: touched.length,
		undeclared,
		declaredGlobs: files.length,
		unmatchedGlobs,
	}
}

/** The `sober: <id>` merge commits reachable from `base` — one is exact, any other count is not. */
const mergesFor = async (root: string, base: string, id: string): Promise<string[]> => {
	const log = await git(root, 'log', base, `--grep=^sober: ${id}$`, '--format=%H %P')
	return log
		.split('\n')
		.filter((line) => line !== '')
		.filter((line) => line.trim().split(/\s+/).length >= 3)
		.map((line) => line.split(' ')[0] as string)
}

/**
 * The first-parent-to-merge diff (`<merge>^1 <merge>`): additions, deletions
 * and renames all count as touched, and the second parent — the node's own
 * branch, full of its own intermediate commits — never enters it.
 */
const touchedPaths = async (root: string, merge: string): Promise<string[]> => {
	const diff = await git(root, 'diff', '--name-only', '-z', `${merge}^1`, merge)
	return diff.split('\0').filter((path) => path !== '')
}
