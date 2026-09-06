import type { Decision, Node, Option, Project, Status, Waiting } from '@besober/schema'
import { decisionState } from '@besober/schema'

/**
 * `GET /read/board`. The whole board in one answer — the panel needs a node's
 * record, the decisions bound to it, and the titles of what it waits on, and
 * three requests to draw one drawer is three loading states to render.
 *
 * `status` and `waitingOn` are derived on the server by `core` (ADR 0035): the
 * browser cannot import `core`, and a second derivation is a second answer.
 */
export interface BoardRead {
	readonly project: Project | null
	readonly nodes: readonly (Node & {
		readonly id: string
		readonly status: Status | null
		readonly waitingOn: readonly Waiting[]
	})[]
	readonly decisions: readonly (Decision & {
		readonly id: string
		readonly archived: boolean
	})[]
	readonly broken: readonly string[]
}

export interface Held {
	readonly kind: Waiting['kind']
	readonly id: string
	/** The question, or the title. What the reader was going to look up anyway. */
	readonly label: string
	/**
	 * Nothing on this board offers to answer it: archived, or not here at all.
	 * Kept in the list rather than filtered out — a node held by nothing and
	 * still not ready is the worse of the two things to render (§8.4).
	 */
	readonly gone: boolean
}

/** What is standing between a node and starting, in words rather than in ids. */
export const held = (board: BoardRead, id: string): Held[] => {
	const node = board.nodes.find((one) => one.id === id)
	if (node === undefined) return []

	return node.waitingOn.map((wait): Held => {
		if (wait.kind === 'decision') {
			const decision = board.decisions.find((one) => one.id === wait.id)
			return {
				kind: 'decision',
				id: wait.id,
				label: decision?.question ?? wait.id,
				gone: decision === undefined || wait.archived,
			}
		}

		const other = board.nodes.find((one) => one.id === wait.id)
		return { kind: 'node', id: wait.id, label: other?.title ?? wait.id, gone: other === undefined }
	})
}

export interface Choice extends Option {
	readonly suggested: boolean
}

export interface Offer {
	readonly kind: 'unopened' | 'open' | 'answered'
	readonly options: readonly Choice[]
	/** Why there is nothing to choose. Null when there is. */
	readonly refusal: string | null
}

/**
 * What the decision screen puts in front of a person.
 *
 * The two refusals carry a reason rather than a greyed-out button. Answering
 * again is refused in this version because every brief built on the answer
 * would have to be withdrawn and the preview that shows which ones is M3's
 * later work — the same sentence `core` refuses with, so the two surfaces do
 * not explain the same rule two ways.
 */
export const offer = (decision: Decision): Offer => {
	const state = decisionState(decision)

	if (state === 'unopened')
		return {
			kind: 'unopened',
			options: [],
			refusal:
				'Nothing has proposed options for this yet. Options are generated in a session, against the code as it is now.',
		}

	if (state === 'answered')
		return {
			kind: 'answered',
			options: [],
			refusal:
				'Changing an answer is not in this version — every brief built on it would have to be withdrawn, and the preview that shows you which ones is not built yet.',
		}

	return {
		kind: 'open',
		options: (decision.options ?? []).map((option) => ({
			...option,
			suggested: option.id === decision.suggested,
		})),
		refusal: null,
	}
}
