import type { Handle, Node } from '@besober/schema'
import { NotOnBoardError, SoberError } from './errors.js'
import { loadBoard } from './graph.js'
import { newId } from './id.js'
import { appendEvent } from './local.js'
import { withLock } from './lock.js'
import type { Paths } from './paths.js'
import { readNode, writeNode } from './records.js'

/**
 * DESIGN §7.2's three actions on a flagged node. Nothing here happens
 * automatically and nothing here touches a second node: one decision change can
 * reach thirty nodes, and re-running them unasked is precisely what the impact
 * preview exists to prevent (D37).
 *
 * They are three operations rather than one because they are three different
 * acts. Dismissing writes a judgement; reopening un-finishes a node; opening a
 * node creates work. Folding them together would give the surfaces one button
 * whose meaning depends on which branch it took.
 */

export interface Dismissing {
	readonly by: Handle
	/** Why this node is fine anyway. §7.2 keeps it, so there has to be one. */
	readonly reason: string
}

/**
 * The flag, judged and set aside. The reason is the record — a dismissal with
 * nothing in it is a mute button, and §7.2 asks for a judgement.
 *
 * It does not clear the flag; it moves the mark (`statusOf`'s `stale`). A later
 * answer to the same decision is a change nobody has judged yet, and §2.8's
 * whole argument is about a change nothing on the board knew about.
 */
export const dismissFlag = (paths: Paths, node: string, dismissing: Dismissing): Promise<Node> =>
	withLock(paths, 'dismiss', async () => {
		const reason = dismissing.reason.trim()
		if (reason === '')
			throw new SoberError(
				'no-reason',
				`say why ${node} is fine anyway — the reason is what is kept, and a dismissal without one is indistinguishable from ignoring the flag`,
			)

		const record = await readNode(paths, node)
		if (record.kind !== 'ok') throw new NotOnBoardError('node', node)

		const updated: Node = {
			...record.value,
			dismissal: { by: dismissing.by, at: new Date().toISOString(), reason },
		}
		await writeNode(paths, node, updated)
		await appendEvent(paths, { action: 'node.dismissed', node, by: dismissing.by, reason })
		return updated
	})

/**
 * §7.2's second action: the node returns to `ready`. Status is derived, and
 * `accepted` is what makes a node done (ADR 0021) — so un-finishing it is
 * clearing that record and nothing else. The brief stays approved, which is why
 * `ready` is where it lands.
 *
 * Running it is still `run`. Approving and starting have never been one step
 * (the panel's rule), and a reopen that dispatched would be the automatic
 * re-run §7.2 refuses, with one extra click in front of it.
 */
export const reopenNode = (paths: Paths, node: string, by: Handle): Promise<Node> =>
	withLock(paths, 'reopen', async () => {
		const record = await readNode(paths, node)
		if (record.kind !== 'ok') throw new NotOnBoardError('node', node)
		if (record.value.accepted === null)
			throw new SoberError(
				'not-finished',
				`${node} is not finished, so there is nothing to reopen — it is already back in the loop`,
			)

		const updated: Node = { ...record.value, accepted: null }
		await writeNode(paths, node, updated)
		await appendEvent(paths, { action: 'node.reopened', node, by })
		return updated
	})

export interface Opening {
	readonly title: string
	readonly by: Handle
	readonly description?: string
	readonly dependsOn?: readonly string[]
	readonly decisions?: readonly string[]
	readonly files?: readonly string[]
}

/**
 * §7.2's third action: the correction is its own piece of work. One node with a
 * title and its edges — not `propose`, which returns a set of nodes, the edges
 * between them and the decisions each introduces, against the code as it is
 * now. That needs a model and stays in the session (ADR 0009); this needs a
 * person who already knows what they want.
 *
 * It arrives with no brief, so it lands on `needs-brief` rather than anywhere
 * near running. Nothing runs without an approved brief (§3.2), and a node
 * opened to fix a mistake is the last one that should skip being read.
 */
export const createNode = (
	paths: Paths,
	opening: Opening,
): Promise<{ readonly id: string; readonly node: Node }> =>
	withLock(paths, 'create', async () => {
		const title = opening.title.trim()
		if (title === '')
			throw new SoberError('no-title', 'a node needs a title — it is how it is read')

		const board = await loadBoard(paths)
		for (const dependency of opening.dependsOn ?? [])
			if (!board.nodes.has(dependency)) throw new NotOnBoardError('node', dependency)
		for (const decision of opening.decisions ?? [])
			if (!board.decisions.has(decision)) throw new NotOnBoardError('decision', decision)

		const id = newId(title)
		const node: Node = {
			title,
			description: opening.description ?? '',
			notes: '',
			dependsOn: [...(opening.dependsOn ?? [])],
			decisions: [...(opening.decisions ?? [])],
			files: [...(opening.files ?? [])],
			brief: null,
			outcome: null,
			assignee: null,
			claim: null,
			accepted: null,
			dismissal: null,
			createdAt: new Date().toISOString(),
		}
		await writeNode(paths, id, node)
		await appendEvent(paths, { action: 'node.created', node: id, by: opening.by })
		return { id, node }
	})
