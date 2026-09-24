import type { Decision, Handle, Impact, Node } from '@besober/schema'
import { decisionState } from '@besober/schema'
import { NoSuchOptionError } from './decide.js'
import { NotOnBoardError, SoberError } from './errors.js'
import type { Board } from './graph.js'
import { loadBoard } from './graph.js'
import { appendEvent } from './local.js'
import { withLock } from './lock.js'
import type { Paths } from './paths.js'
import { readDecision, writeDecision, writeNode } from './records.js'
import { statusOf } from './status.js'

type Impacted = Impact['nodes'][number]

/**
 * The statuses that mean there is work to protect — DESIGN §2.8's second and
 * third rows. They are read off the derived status (§3.2) rather than off a
 * second classification, because a second one is a second answer to "has this
 * started" and the board already has the first.
 */
const STARTED: ReadonlySet<string> = new Set(['running', 'in-review', 'done'])

/**
 * What changing this answer reaches (§2.8, D19), and the same function the save
 * uses to decide what to write. A preview computed one way and applied another
 * is the failure the preview exists to prevent.
 *
 * Only nodes with an **approved** brief are here. §2.8's three rows all begin
 * with one — a node still waiting to be briefed changes in no way when the
 * answer moves, and listing it would pad the fan-out a person has to read with
 * nodes nothing happens to.
 *
 * Null when the decision is not on this board, the way `renderBrief` and
 * `statusOf` are null for a node that is not: an empty fan-out and a decision
 * that does not exist are opposite facts.
 */
export const impactOf = (board: Board, decision: string): Impact | null => {
	if (!board.decisions.has(decision)) return null

	const nodes = [...board.nodes]
		.flatMap(([id, node]): Impacted[] => {
			if (!node.decisions.includes(decision) || node.brief?.approval == null) return []
			const status = statusOf(board, id)
			if (status === null) return []
			return [{ id, title: node.title, status, effect: STARTED.has(status) ? 'flag' : 'rebrief' }]
		})
		.sort((left, right) => left.id.localeCompare(right.id))

	return { decision, nodes }
}

/**
 * The refusal that carries the fan-out. ADR 0032's shape rather than a second
 * one: the first call prints what the change reaches and writes nothing, and
 * the confirmation is the second call. `OverlapError` is its twin, for the same
 * reason — a surface with no dialog still has to be able to ask.
 */
export class ImpactError extends SoberError {
	constructor(readonly impact: Impact) {
		super(
			'impact',
			`${impact.decision} is answered, and changing it reaches ${count(impact)} — nothing was written. ${what(impact)}`,
		)
	}
}

const count = (impact: Impact): string =>
	impact.nodes.length === 1 ? '1 node' : `${impact.nodes.length} nodes`

const what = (impact: Impact): string => {
	if (impact.nodes.length === 0)
		return 'No node was built against it yet, so the change costs nothing.'
	const rebrief = impact.nodes.filter((one) => one.effect === 'rebrief')
	const flag = impact.nodes.filter((one) => one.effect === 'flag')
	return [
		rebrief.length === 0
			? ''
			: `${rebrief.map((one) => one.id).join(', ')} would lose their briefs and be briefed again.`,
		flag.length === 0
			? ''
			: `${flag.map((one) => `${one.id} (${one.status})`).join(', ')} would be flagged; nothing stops and nothing reopens.`,
	]
		.filter((line) => line !== '')
		.join(' ')
}

export interface Editing {
	readonly option: string
	readonly rationale?: string
	readonly by: Handle
	/** The confirmation, as an argument: ADR 0032's second command (§2.8). */
	readonly anyway?: boolean
}

/**
 * Changing an answer already given (§2.8). Not `answerDecision` with a flag:
 * the first answer holds nothing back, and this one withdraws every brief
 * written against the answer it replaces.
 *
 * Two of §2.8's three rows are written by nothing. `flagsOf`'s `stale` compares
 * the new `answer.at` against the brief's approval and does not look at status,
 * so a running, in-review or finished node is flagged the moment this writes —
 * by derivation, with no field to set and none to forget (ADR 0042, ADR 0044).
 *
 * The first row is the one with a write, and it clears the brief rather than
 * only its approval. Approval is withdrawn either way; what the node returns to
 * is the difference, and §2.8 says `needs-brief` — the approach was written
 * against an answer that is now gone, and re-approving it would be approving a
 * paragraph nobody rewrote.
 */
export const editDecision = (paths: Paths, id: string, editing: Editing): Promise<Decision> =>
	withLock(paths, 'edit', async () => {
		const record = await readDecision(paths, id)
		if (record.kind !== 'ok') throw new NotOnBoardError('decision', id)
		if (decisionState(record.value) !== 'answered')
			throw new SoberError(
				'not-answered',
				`${id} has not been answered yet, so there is no answer to change — \`decide\` gives it its first one`,
			)

		// Before the fan-out: a typo in the option is not worth printing thirty
		// nodes over, and it is the one refusal that costs nobody a decision.
		const offered = record.value.options ?? []
		if (!offered.some((option) => option.id === editing.option))
			throw new NoSuchOptionError(
				id,
				editing.option,
				offered.map((option) => option.id),
			)

		const board = await loadBoard(paths)
		const impact = impactOf(board, id) ?? { decision: id, nodes: [] }
		if (editing.anyway !== true) throw new ImpactError(impact)

		const answered: Decision = {
			...record.value,
			answer: {
				option: editing.option,
				rationale: editing.rationale ?? '',
				by: editing.by,
				at: new Date().toISOString(),
				// An edit is a person changing their mind, whatever the first
				// answer was read off — so the provenance does not carry over
				// (ADR 0055).
				derived: null,
			},
		}
		await writeDecision(paths, id, answered)

		for (const touched of impact.nodes) {
			const node = board.nodes.get(touched.id)
			if (touched.effect !== 'rebrief' || node === undefined) continue
			const withdrawn: Node = { ...node, brief: null }
			await writeNode(paths, touched.id, withdrawn)
		}

		await appendEvent(paths, {
			action: 'decision.edited',
			decision: id,
			by: editing.by,
			// An irreversible fan-out says how far it went, so the log answers
			// "what did that touch" without the board having to be re-derived.
			reached: impact.nodes.map((one) => one.id),
		})
		return answered
	})
