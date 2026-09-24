import type { Node } from '@besober/schema'
import { NotOnBoardError, SoberError } from './errors.js'
import { cycleFrom, loadBoard } from './graph.js'
import { appendEvent } from './local.js'
import { withLock } from './lock.js'
import type { Paths } from './paths.js'
import { writeNode } from './records.js'

/** A dependency that would close a cycle is refused, with the cycle shown (§3.6). */
export class CycleError extends SoberError {
	constructor(readonly cycle: readonly string[]) {
		super('cycle', `that dependency closes a cycle: ${cycle.join(' → ')}`)
	}
}

export interface Edges {
	/** The decisions this node binds. Every one holds it until it is answered. */
	readonly decisions?: readonly string[]
	readonly dependsOn?: readonly string[]
}

/**
 * A node's edges, corrected after the fact. The agent proposes them at
 * node-creation time and the human approves (§2.3) — but a proposal that
 * bound the wrong decision, or none, had no way back before this: the only
 * fix was opening the record by hand, which §2.3 claims is supported.
 *
 * The list replaces what was there, rather than adding to it. An edit that
 * only ever adds cannot remove a wrong edge, which is the case that made this
 * function necessary.
 */
export const bind = (paths: Paths, node: string, edges: Edges): Promise<Node> =>
	withLock(paths, 'bind', async () => {
		const board = await loadBoard(paths)
		const record = board.nodes.get(node)
		if (record === undefined) throw new NotOnBoardError('node', node)

		for (const decision of edges.decisions ?? [])
			if (!board.decisions.has(decision)) throw new NotOnBoardError('decision', decision)
		for (const dependency of edges.dependsOn ?? []) {
			if (!board.nodes.has(dependency)) throw new NotOnBoardError('node', dependency)
			const cycle = cycleFrom(board.nodes, node, dependency)
			if (cycle !== null) throw new CycleError(cycle)
		}

		const updated: Node = {
			...record,
			decisions: [...(edges.decisions ?? record.decisions)],
			dependsOn: [...(edges.dependsOn ?? record.dependsOn)],
		}
		await writeNode(paths, node, updated)
		await appendEvent(paths, { action: 'node.bound', node })
		return updated
	})

/**
 * The decisions nothing binds. A decision holds the nodes that bind it and
 * nothing else; one nobody bound blocks no work, and reads on every surface as
 * a question waiting on the human for no reason (found in the M1 gate).
 */
export const unbound = (board: Awaited<ReturnType<typeof loadBoard>>): string[] =>
	[...board.decisions.keys()].filter(
		(decision) =>
			!board.archivedDecisions.has(decision) &&
			![...board.nodes.values()].some((node) => node.decisions.includes(decision)),
	)
