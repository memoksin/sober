import type { Decision, Run, Status } from '@besober/schema'
import { decisionState } from '@besober/schema'
import type { Board } from './graph.js'

/** The run that decides `running` and `in-review`: the last one started. */
export const lastRun = (
	board: Board,
	id: string,
): { readonly id: string; readonly run: Run } | null =>
	[...board.runs]
		.filter(([, run]) => run.node === id)
		.sort(([leftId, left], [rightId, right]) =>
			left.startedAt === right.startedAt
				? leftId.localeCompare(rightId)
				: left.startedAt.localeCompare(right.startedAt),
		)
		.map(([runId, run]) => ({ id: runId, run }))
		.at(-1) ?? null

const isRunning = (run: Run | null): boolean =>
	run !== null && run.exit === null && run.endedAt === null

/**
 * The seven statuses of DESIGN §3.2, in order — the first that matches wins. A
 * stored status is a field someone forgets to update; a derived one cannot
 * disagree with the graph.
 *
 * `blocked` outranks `held` on purpose: a node whose upstream is unfinished
 * should not be asking its human to decide yet, because options are generated
 * against current context and that context does not exist yet.
 */
export const statusOf = (board: Board, id: string): Status | null => {
	const node = board.nodes.get(id)
	if (node === undefined) return null

	const run = lastRun(board, id)?.run ?? null

	if (node.accepted !== null) return 'done'
	// A stopped or failed run does not wait for a human (§5.4, §8.1); only a
	// finished one does — until the human turns it down, which is what returns
	// the node to the queue with no field on the run to forget to set (§6.4).
	if (run?.exit === 'finished' && !rejected(board, id, run)) return 'in-review'
	if (isRunning(run)) return 'running'
	if (node.dependsOn.some((dependency) => !isDone(board, dependency))) return 'blocked'
	if (node.decisions.some((decision) => !isAnswered(board, decision))) return 'held'
	if (node.brief === null || node.brief.approval === null) return 'needs-brief'
	return 'ready'
}

const isDone = (board: Board, id: string): boolean => board.nodes.get(id)?.accepted != null

/** A rejection written after the run ended is the answer to that run. */
const rejected = (board: Board, id: string, run: Run): boolean => {
	const feedback = board.feedback.get(id)
	return feedback !== undefined && run.endedAt !== null && feedback.at >= run.endedAt
}

/** A decision the board does not hold cannot have been answered, so it holds the node. */
const isAnswered = (board: Board, id: string): boolean => {
	const decision = board.decisions.get(id)
	return decision !== undefined && decisionState(decision) === 'answered'
}

/**
 * What a status would lie about (§8.1, §2.8). "Never run" and "ran and crashed"
 * differ by one line in a panel; as statuses the distinction spreads into every
 * surface that renders a node.
 */
export interface Flags {
	/** Local, from the run record: a teammate needs to know the node is unfinished. */
	readonly lastRunFailed: boolean
}

export const flagsOf = (board: Board, id: string): Flags => ({
	lastRunFailed: lastRun(board, id)?.run.exit === 'failed',
})

/** What can start now (§3.2's whole point), in dependency order. */
/**
 * The decisions still waiting on a human: unanswered, and not archived. Every
 * surface asks the same question, so it is answered once — the CLI and the
 * session listing different sets is how two surfaces become two products
 * (`PR-09-08`).
 */
export const openDecisions = (board: Board): [string, Decision][] =>
	[...board.decisions].filter(
		([id, decision]) => decisionState(decision) !== 'answered' && !board.archivedDecisions.has(id),
	)

export const ready = (board: Board): string[] =>
	[...board.nodes.keys()].filter((id) => statusOf(board, id) === 'ready').sort()

export const statuses = (board: Board): Map<string, Status> => {
	const all = new Map<string, Status>()
	for (const id of board.nodes.keys()) {
		const status = statusOf(board, id)
		if (status !== null) all.set(id, status)
	}
	return all
}
