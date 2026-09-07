import type { Brief, Decision, Handle, Node } from '@besober/schema'
import { decisionState } from '@besober/schema'
import { NotOnBoardError, SoberError } from './errors.js'
import { appendEvent } from './local.js'
import { withLock } from './lock.js'
import type { Paths } from './paths.js'
import { readDecision, readNode, writeDecision, writeNode } from './records.js'

/**
 * Answering is for a decision with no answer. Changing one that has an answer is
 * a fan-out, so it is a different operation with a preview in front of it
 * (`editDecision`, §2.8) — this refusal is what sends a caller there rather
 * than letting `decide` quietly become an edit.
 */
export class AnswerLockedError extends SoberError {
	constructor(readonly id: string) {
		super(
			'answer-locked',
			`${id} is already answered — changing it withdraws every brief built on it, so it goes through the impact preview: \`sober edit ${id} <option>\` shows you what it reaches before anything is written`,
		)
	}
}

export class NoSuchOptionError extends SoberError {
	constructor(
		readonly id: string,
		readonly option: string,
		readonly offered: readonly string[],
	) {
		super(
			'no-such-option',
			`${id} has no option called ${option} — it offers ${offered.join(', ')}`,
		)
	}
}

export interface AnswerOptions {
	readonly option: string
	readonly rationale?: string
	readonly by: Handle
}

/**
 * The choice comes from the human, never from the agent that opened the
 * decision (`PR-03-09`). Answering unblocks every node bound by it with no
 * further action — nothing is copied onto those nodes, because status is
 * derived from this record (§3.2).
 */
export const answerDecision = (
	paths: Paths,
	id: string,
	options: AnswerOptions,
): Promise<Decision> =>
	withLock(paths, 'decide', async () => {
		const record = await readDecision(paths, id)
		if (record.kind !== 'ok') throw new NotOnBoardError('decision', id)
		if (decisionState(record.value) === 'answered') throw new AnswerLockedError(id)

		const offered = record.value.options ?? []
		if (!offered.some((option) => option.id === options.option))
			throw new NoSuchOptionError(
				id,
				options.option,
				offered.map((option) => option.id),
			)

		const answered: Decision = {
			...record.value,
			answer: {
				option: options.option,
				rationale: options.rationale ?? '',
				by: options.by,
				at: new Date().toISOString(),
			},
		}
		await writeDecision(paths, id, answered)
		await appendEvent(paths, { action: 'decision.answered', decision: id, by: options.by })
		return answered
	})

export class NoBriefError extends SoberError {
	constructor(readonly id: string) {
		super('no-brief', `${id} has no brief yet — one is written for a node when you ask for it`)
	}
}

export class AcceptedAlreadyError extends SoberError {
	constructor(readonly id: string) {
		super(
			'accepted-already',
			`${id} is done, so there is nothing left to approve — its work was accepted and merged`,
		)
	}
}

/**
 * Approval is human, per node, and never a batch (D26). Reading twenty full
 * briefs is how a per-node approval becomes a rubber stamp through fatigue,
 * which is the failure that rule exists to prevent.
 */
export const approveBrief = (
	paths: Paths,
	id: string,
	options: { readonly by: Handle; readonly queue?: boolean },
): Promise<Node> =>
	withLock(paths, 'approve', async () => {
		const record = await readNode(paths, id)
		if (record.kind !== 'ok') throw new NotOnBoardError('node', id)
		if (record.value.brief === null) throw new NoBriefError(id)
		// Found in the M2 gate: approving an accepted node rewrote the approval
		// with a fresh timestamp, so the record read as approved *after* it was
		// accepted. `run` refuses a done node; this is the same refusal, one
		// command earlier, before the record can say something untrue.
		if (record.value.accepted !== null) throw new AcceptedAlreadyError(id)

		const brief: Brief = {
			...record.value.brief,
			// ADR 0017: the same human approval, plus the instruction to dispatch
			// when the node becomes ready, without asking again.
			approval: { by: options.by, at: new Date().toISOString(), queue: options.queue ?? false },
		}
		const node: Node = { ...record.value, brief }
		await writeNode(paths, id, node)
		await appendEvent(paths, { action: 'brief.approved', node: id, by: options.by })
		return node
	})

/**
 * The written half of a brief: the approach, and the acceptance list approved
 * with it (ADR 0022, ADR 0027). Written by an agent — through the MCP server in
 * a host session, or through the CLI in a host that has none (`PR-00-08`).
 *
 * Writing a brief clears any approval on it. The approved thing was the old
 * approach, and an approval that survives a rewrite is a rubber stamp with
 * extra steps.
 */
export const writeBrief = (
	paths: Paths,
	id: string,
	brief: Omit<Brief, 'approval'>,
): Promise<Node> =>
	withLock(paths, 'brief', async () => {
		const record = await readNode(paths, id)
		if (record.kind !== 'ok') throw new NotOnBoardError('node', id)

		const node: Node = { ...record.value, brief: { ...brief, approval: null } }
		await writeNode(paths, id, node)
		await appendEvent(paths, { action: 'brief.written', node: id })
		return node
	})
