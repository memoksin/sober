import { decisionState } from '@besober/schema'
import type { Board } from './graph.js'

/**
 * The fixed skeleton of DESIGN §3.7. Only the approach and its acceptance list
 * are stored on the node; everything below them is rendered from the records at
 * read time, so the skeleton cannot omit an answered decision and cannot go
 * stale — there is no copy to fall behind.
 *
 * The order is the design's, which is the order every surface shows: the
 * agent-written approach first, because it is the only part that is new and the
 * only part approval is really about.
 */
export const renderBrief = (board: Board, id: string): string | null => {
	const node = board.nodes.get(id)
	if (node === undefined) return null

	const parts = [
		`# ${node.title}`,
		section('How to approach this', node.brief?.approach ?? '_No approach written yet._'),
		section('What must be true when this is done', acceptance(board, id)),
		section('The project', project(board)),
		section('This node', description(board, id)),
		section('Decisions', decisions(board, id)),
		section('Declared files', files(board, id)),
		section('What upstream nodes produced', upstream(board, id)),
	]
	return `${parts.filter((part) => part !== '').join('\n\n')}\n`
}

const section = (heading: string, body: string): string =>
	body === '' ? '' : `## ${heading}\n\n${body}`

const list = (lines: readonly string[]): string => lines.map((line) => `- ${line}`).join('\n')

const acceptance = (board: Board, id: string): string => {
	const criteria = board.nodes.get(id)?.brief?.acceptance ?? []
	// A command plus the one sentence it proves (ADR 0027): `run` is the
	// machine's half, `proves` is the half the human approved.
	return list(criteria.map((criterion) => `${criterion.proves}\n  \`${criterion.run}\``))
}

const project = (board: Board): string => {
	if (board.project === null) return ''
	const { intent, constraints } = board.project
	const lines = [intent, constraints.length > 0 ? `Constraints:\n${list(constraints)}` : '']
	return lines.filter((line) => line !== '').join('\n\n')
}

const description = (board: Board, id: string): string => {
	const node = board.nodes.get(id)
	if (node === undefined) return ''
	return [node.description, node.notes].filter((text) => text !== '').join('\n\n')
}

const decisions = (board: Board, id: string): string => {
	const bound = board.nodes.get(id)?.decisions ?? []
	return bound
		.map((decisionId) => {
			const decision = board.decisions.get(decisionId)
			if (decision === undefined) return `**${decisionId}** — not on this board.`
			if (decisionState(decision) !== 'answered') {
				return `**${decision.question}** — not answered yet.`
			}
			const chosen = decision.options?.find((option) => option.id === decision.answer?.option)
			const rationale = decision.answer?.rationale
			// A list, not four lines: consecutive lines collapse into one
			// paragraph wherever this is rendered as markdown.
			return `**${decision.question}**\n${list(
				[
					`Chosen: ${chosen?.label ?? decision.answer?.option}`,
					chosen === undefined ? '' : `Why: ${chosen.reason}`,
					chosen === undefined ? '' : `Costs later: ${chosen.costLater}`,
					rationale ? `Your reason: ${rationale}` : '',
				].filter((line) => line !== ''),
			)}`
		})
		.join('\n\n')
}

const files = (board: Board, id: string): string => {
	const globs = board.nodes.get(id)?.files ?? []
	if (globs.length === 0) return ''
	// A prediction refined here, not a contract enforced before the work runs (§3.1).
	return `${list(globs)}\n\nThis list is a prediction. Work outside it is shown in review, not refused.`
}

const upstream = (board: Board, id: string): string =>
	list(
		(board.nodes.get(id)?.dependsOn ?? []).flatMap((dependency) => {
			const node = board.nodes.get(dependency)
			if (node === undefined) return [`**${dependency}** — not on this board.`]
			return node.outcome === null ? [] : [`**${node.title}**: ${node.outcome}`]
		}),
	)
