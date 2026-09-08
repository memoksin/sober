import { type Dispatched, dispatchWave } from './dispatch.js'
import type { SoberError } from './errors.js'
import { whoami } from './git.js'
import { type Board, loadBoard } from './graph.js'
import type { Paths } from './paths.js'
import { lastRun, statusOf } from './status.js'
import { overlaps } from './team.js'

export interface Queued {
	/** What the queue chose to start, in id order. */
	readonly started: readonly string[]
	/** One per started node, in the same order — shorter when the chain stopped. */
	readonly dispatched: readonly (Dispatched | SoberError)[]
	/** Queued and ready, and waiting for a human anyway, with the reason. */
	readonly held: readonly { readonly id: string; readonly why: string }[]
}

/**
 * "Approve and queue" is the second approval action (D26, ADR 0017): the same
 * human approval of the same brief, plus the instruction to start the node when
 * it becomes ready, without asking again. This is what reads that instruction —
 * without it the flag was a field nobody consumed, and the planning time it
 * exists to pay back was never paid back.
 *
 * There is no daemon and no watcher. A node becomes ready when a dependency is
 * accepted or a decision is answered, so this runs after those two: the graph
 * moved, and something may have been waiting for exactly that.
 */
export const runQueue = async (
	paths: Paths,
	base: string,
	options: {
		/** Called once, before anything starts: this spends money nobody asked for twice. */
		readonly onStart?: (nodes: readonly string[]) => void
	} = {},
): Promise<Queued> => {
	const board = await loadBoard(paths)
	const me = await whoami(paths.root)
	const waiting = queued(board)
	if (waiting.length === 0) return { started: [], dispatched: [], held: [] }

	const held: { id: string; why: string }[] = []
	const started: string[] = []
	for (const id of waiting) {
		// Someone else's claim, on a node nobody has run: they are on it, and this
		// would cut the worktree and spend the money at the wrong machine. Found by
		// driving it: a teammate's claimed node started from the other clone.
		const claim = board.nodes.get(id)?.claim
		if (claim !== null && claim !== undefined && claim.by !== me) {
			held.push({ id, why: `${claim.by} has claimed it — it is theirs to start` })
			continue
		}
		// The whole queue counts as active against itself: none of these is
		// claimed, and all of them are about to go out together.
		const found = overlaps(board.nodes, id, waiting)
		if (found.length === 0) started.push(id)
		else
			held.push({
				id,
				why: `${found.map((one) => one.id).join(', ')} ${found.length === 1 ? 'is' : 'are'} heading for the same files — an overlapping node is never started unattended`,
			})
	}
	if (started.length === 0) return { started: [], dispatched: [], held }
	options.onStart?.(started)

	// Already checked above, so the wave does not ask again — and the concurrency
	// limit and the stop-at-the-first-failure rule are its, unchanged (§5.3).
	const dispatched = await dispatchWave(
		paths,
		started.map((node) => ({ node, options: { base, anyway: true } })),
		base,
	)
	return { started, dispatched, held }
}

/**
 * Ready, queued, and never run. That last condition is both halves of ADR
 * 0017's first rule: a run that failed leaves the node `ready` again, and a run
 * a human turned down does too, and neither may be started a second time by
 * something the human is not watching. From then on it is theirs.
 *
 * ADR 0056 settled all three conditions and left them where they are. `ready`
 * already means approved (`status.ts`), so the flag is not a second permission:
 * it is the difference between "start now", which a human is watching, and
 * "start later without asking", which nobody is. A node approved with
 * `queue: false` that never started was approved for attended work, and taking
 * it here would hand it a trade its approver declined. What 0056 moved instead
 * is which action a surface offers by default (`dispatch.queueByDefault`).
 *
 * Exported for the test that holds those three conditions in place.
 */
export const queued = (board: Board): string[] =>
	[...board.nodes.keys()]
		.filter(
			(id) =>
				board.nodes.get(id)?.brief?.approval?.queue === true &&
				statusOf(board, id) === 'ready' &&
				lastRun(board, id) === null,
		)
		.sort()
