import type { Decision, Run, Status, Waiting } from '@besober/schema'
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
	if (node.brief === null) return 'needs-brief'
	if (node.brief.approval === null) return 'needs-approval'
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
	/**
	 * A bound decision moved after this node's brief was approved (§2.8). Not
	 * "a finished node whose decision changed": the narrower reading let an
	 * `in-review` node be accepted against an answer that had just changed, and
	 * nothing on the board knew.
	 */
	readonly flagged: boolean
}

export const flagsOf = (board: Board, id: string): Flags => ({
	lastRunFailed: lastRun(board, id)?.run.exit === 'failed',
	flagged: stale(board, id),
})

/**
 * Timestamps compare as strings because they are ISO-8601 and UTC (`Timestamp`),
 * which is the property that makes them sortable without being parsed.
 *
 * An answer written at the same instant as the approval is not a change: a
 * brief is rendered from the answers it was approved against.
 *
 * A dismissal moves the mark forward rather than clearing the flag (§7.2): the
 * change it judged is settled, and the next one is a change nobody has judged.
 * The later of the two is the mark, because §2.8's first row withdraws brief
 * approval and it is approved again — an approval after a dismissal is the
 * newer statement about what this node was built against.
 */
const stale = (board: Board, id: string): boolean => {
	const node = board.nodes.get(id)
	const approved = node?.brief?.approval
	if (node === undefined || approved == null) return false

	const judged =
		node.dismissal !== null && node.dismissal.at > approved.at ? node.dismissal.at : approved.at

	return node.decisions.some((decision) => {
		const answered = board.decisions.get(decision)?.answer?.at
		return answered !== undefined && answered > judged
	})
}

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

/**
 * What a node is waiting for — the one thing a reader wants beside a held or
 * blocked node, and the question the panel exists to answer.
 *
 * Not the same ordering as `statusOf`. That reports `blocked` before `held`,
 * because options generated against context that does not exist yet are worse
 * than no options. This lists both, decisions first, because a decision is the
 * one a human can act on right now.
 */
export const waitingOn = (board: Board, id: string): Waiting[] => {
	const node = board.nodes.get(id)
	if (node === undefined) return []

	return [
		...node.decisions
			.filter((decision) => !isAnswered(board, decision))
			.map(
				(decision): Waiting => ({
					kind: 'decision',
					id: decision,
					archived: board.archivedDecisions.has(decision),
				}),
			),
		...node.dependsOn
			.filter((dependency) => !isDone(board, dependency))
			.map((dependency): Waiting => ({ kind: 'node', id: dependency, archived: false })),
	]
}

export const ready = (board: Board): string[] =>
	[...board.nodes.keys()].filter((id) => statusOf(board, id) === 'ready').sort()
