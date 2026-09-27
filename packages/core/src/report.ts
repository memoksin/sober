import type { Decision, Option } from '@besober/schema'
import { decisionState } from '@besober/schema'
import type { Board } from './graph.js'

/**
 * Markdown's structural punctuation, escaped so a question, a label or a
 * rationale can never fake a heading or a list item, or break out of the
 * inline code an id is wrapped in. A newline is the sharpest of these —
 * unescaped, it starts a new markdown line inside what should be one field —
 * so it collapses to a space rather than being escaped in place.
 */
const escapeMd = (text: string): string =>
	text.replace(/\r\n|\r|\n/g, ' ').replace(/[\\`*_{}[\]()#+\-.!|>~]/g, (char) => `\\${char}`)

const list = (lines: readonly string[]): string => lines.map((line) => `- ${line}`).join('\n')

interface Answered {
	readonly id: string
	readonly decision: Decision
}

/** Answered decisions, in the order they were answered — id breaks a tie (ADR 0020 ids sort stably). */
const answeredInOrder = (board: Board): Answered[] =>
	[...board.decisions]
		.filter(([, decision]) => decisionState(decision) === 'answered')
		.map(([id, decision]) => ({ id, decision }))
		.toSorted(
			(a, b) =>
				(a.decision.answer?.at ?? '').localeCompare(b.decision.answer?.at ?? '') ||
				a.id.localeCompare(b.id),
		)

const boundNodes = (
	board: Board,
	decisionId: string,
): { readonly id: string; readonly title: string }[] =>
	[...board.nodes]
		.filter(([, node]) => node.decisions.includes(decisionId))
		.map(([id, node]) => ({ id, title: node.title }))

const alternative = (option: Option): string =>
	`**${escapeMd(option.label)}** (\`${option.id}\`) — ${escapeMd(option.reason)}. Costs later: ${escapeMd(option.costLater)}`

const entry = (board: Board, { id, decision }: Answered): string => {
	const { answer, options } = decision
	const chosen = options?.find((option) => option.id === answer?.option)
	const others = (options ?? []).filter((option) => option.id !== answer?.option)
	const nodes = boundNodes(board, id)

	const lines = [
		`## ${escapeMd(decision.question)}`,
		`Chosen: **${escapeMd(chosen?.label ?? answer?.option ?? '')}** (\`${answer?.option ?? ''}\`)`,
		chosen === undefined ? '' : `Why: ${escapeMd(chosen.reason)}`,
		chosen === undefined ? '' : `Costs later: ${escapeMd(chosen.costLater)}`,
		answer?.rationale ? `Your reason: ${escapeMd(answer.rationale)}` : '',
		answer?.derived ? `Derived: ${escapeMd(answer.derived)}` : '',
		nodes.length === 0
			? 'Released: no node binds it.'
			: `Released: ${nodes.map((node) => `**${escapeMd(node.title)}** (\`${node.id}\`)`).join(', ')}`,
		others.length === 0 ? '' : `Alternatives:\n${list(others.map(alternative))}`,
	]
	return lines.filter((line) => line !== '').join('\n\n')
}

/**
 * Every answered decision, in the order it was answered, as one markdown
 * document: the question, what was chosen and why, every option not taken and
 * what it would have cost later, where the answer came from when it was read
 * off the code rather than decided, and the nodes it released. One renderer,
 * called by the command line, the server and the dashboard, so no surface
 * writes its own copy of the education pillar (ADR 0024).
 */
export const renderDecisionReport = (board: Board): string => {
	const answered = answeredInOrder(board)
	if (answered.length === 0) return '# Decisions\n\nNo decision has been answered yet.\n'

	return `# Decisions\n\n${answered.map((one) => entry(board, one)).join('\n\n')}\n`
}
