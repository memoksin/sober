import picomatch from 'picomatch'
import { git, gitVerbatim } from './git.js'
import type { Board } from './graph.js'
import type { Paths } from './paths.js'

/**
 * Whether an accepted node's declared `files` (ADR 0021) match the files its
 * merged work actually touched. Read-only and derived, the way status is
 * (§3.2): nothing here is stored, and nothing here changes what `undeclared-file`
 * (`signals.ts`) does — SCOPE.md's rule 3 asks only that the flag be measured.
 */
export interface NodeAccuracy {
	readonly id: string
	readonly title: string
	readonly measurable: boolean
	/** Why a node is not measurable — null when it is. */
	readonly reason: string | null
	readonly declaredGlobs: number
	readonly touchedFiles: number
	readonly undeclaredFiles: number
	readonly unmatchedGlobs: number
}

export interface AccuracyTotals {
	readonly measurableNodes: number
	readonly touchedFiles: number
	readonly undeclaredFiles: number
	readonly unmatchedGlobs: number
}

export interface AccuracyReport {
	readonly nodes: readonly NodeAccuracy[]
	readonly totals: AccuracyTotals
}

interface CommitEntry {
	readonly commit: string
	readonly parents: readonly string[]
}

/**
 * Every commit reachable from `base`, keyed by subject, with its parents —
 * read once regardless of how many accepted nodes there are. `findMergeCommit`
 * used to run a fresh `git log <base>` plus a parent lookup per node: 83
 * accepted nodes meant 83 full history walks for the same history.
 */
const loadMergeIndex = async (root: string, base: string): Promise<ReadonlyMap<string, CommitEntry[]>> => {
	const log = await git(root, 'log', base, '--format=%H%x09%P%x09%s')
	const bySubject = new Map<string, CommitEntry[]>()
	for (const line of log.split('\n')) {
		if (line.length === 0) continue
		const first = line.indexOf('\t')
		const second = line.indexOf('\t', first + 1)
		const commit = line.slice(0, first)
		const parents = line.slice(first + 1, second).split(/\s+/).filter((parent) => parent.length > 0)
		const subject = line.slice(second + 1)
		const list = bySubject.get(subject) ?? []
		list.push({ commit, parents })
		bySubject.set(subject, list)
	}
	return bySubject
}

/**
 * Every accepted node's exact `sober: <id>` merge commit, found on `base`
 * (`mergeNode` in `merge.ts` is the only place that writes one). Zero matches,
 * more than one, or one that turns out not to be a merge are all the same
 * fact: this node's work is not attributable to one reachable local merge, and
 * a caller must not guess which commit — or count it as zero — instead.
 */
const findMergeCommit = (
	index: ReadonlyMap<string, CommitEntry[]>,
	base: string,
	id: string,
): { readonly commit: string } | { readonly reason: string } => {
	const subject = `sober: ${id}`
	const matches = index.get(subject) ?? []

	if (matches.length === 0) return { reason: `no \`${subject}\` commit is reachable from ${base}` }
	if (matches.length > 1)
		return {
			reason: `${matches.length} commits read \`${subject}\` reachable from ${base} — not one merge to attribute this to`,
		}

	const match = matches[0] as CommitEntry
	if (match.parents.length < 2)
		return { reason: `the \`${subject}\` commit reachable from ${base} is not a merge commit` }

	return { commit: match.commit }
}

/**
 * First-parent-to-merge diff: what the merge brought in, additions, deletions
 * and renames alike. `--no-renames` matters here: without it, a move from an
 * undeclared directory into a declared one lists only the destination path,
 * so the source's own directory is never counted as touched — a rename would
 * silently read more "accurate" than the same change written as delete+add.
 */
const touchedPaths = async (root: string, merge: string): Promise<readonly string[]> =>
	(await gitVerbatim(root, 'diff', '--no-renames', '--name-only', '-z', `${merge}^1`, merge))
		.split('\0')
		.filter((path) => path.length > 0)

/**
 * One row per accepted node, plus totals across the measurable ones. A node
 * whose work cannot be traced to one reachable local merge is reported and
 * left out of both the numerator and the denominator (never treated as zero).
 */
export const declaredFileAccuracy = async (
	paths: Paths,
	board: Board,
	base: string,
): Promise<AccuracyReport> => {
	const accepted = [...board.nodes]
		.filter(([, node]) => node.accepted !== null)
		.sort(([a], [b]) => a.localeCompare(b))

	const index = await loadMergeIndex(paths.root, base)

	const nodes: NodeAccuracy[] = []
	for (const [id, node] of accepted) {
		const found = findMergeCommit(index, base, id)
		if ('reason' in found) {
			nodes.push({
				id,
				title: node.title,
				measurable: false,
				reason: found.reason,
				declaredGlobs: node.files.length,
				touchedFiles: 0,
				undeclaredFiles: 0,
				unmatchedGlobs: 0,
			})
			continue
		}

		const touched = await touchedPaths(paths.root, found.commit)
		const declared = node.files
		// Same picomatch behaviour as `signals.ts`, with one deliberate
		// difference: an empty declaration is not "nothing to check" here, it is
		// every touched path left undeclared — this measures the flag `signals.ts`
		// raises, and `signals.ts` raises none when there is nothing declared.
		const declaredMatch = declared.length > 0 ? picomatch(declared as string[]) : null
		const undeclaredFiles = touched.filter((path) => !(declaredMatch?.(path) ?? false)).length
		const unmatchedGlobs = declared.filter(
			(glob) => !touched.some((path) => picomatch(glob)(path)),
		).length

		nodes.push({
			id,
			title: node.title,
			measurable: true,
			reason: null,
			declaredGlobs: declared.length,
			touchedFiles: touched.length,
			undeclaredFiles,
			unmatchedGlobs,
		})
	}

	const measurable = nodes.filter((node) => node.measurable)
	return {
		nodes,
		totals: {
			measurableNodes: measurable.length,
			touchedFiles: measurable.reduce((sum, node) => sum + node.touchedFiles, 0),
			undeclaredFiles: measurable.reduce((sum, node) => sum + node.undeclaredFiles, 0),
			unmatchedGlobs: measurable.reduce((sum, node) => sum + node.unmatchedGlobs, 0),
		},
	}
}
