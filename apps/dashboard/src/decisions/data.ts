import type { Answer, Category, DecisionState, Option } from '@besober/schema'
import { decisionState } from '@besober/schema'
import type { BoardRead } from '../panel/data.js'

export interface DecisionRow {
	readonly id: string
	readonly question: string
	readonly category: Category
	readonly state: DecisionState
	/** The picked option, looked up by id (ADR 0020). Null unless answered. */
	readonly chosen: Option | null
	readonly answer: Answer | null
	readonly notPicked: readonly Option[]
	readonly nodes: readonly { readonly id: string; readonly title: string }[]
}

// Open first: the list answers "what is still holding things" before "what was decided".
const ORDER: Record<DecisionState, number> = { open: 0, unopened: 1, answered: 2 }

export type DecisionFilter = 'all' | 'open' | 'answered' | 'derived'

export const filterDecisionRows = (rows: DecisionRow[], filter: DecisionFilter): DecisionRow[] => {
	switch (filter) {
		case 'all':
			return rows
		case 'open':
			return rows.filter((row) => row.state === 'open')
		case 'answered':
			return rows.filter((row) => row.state === 'answered')
		case 'derived':
			return rows.filter((row) => row.state === 'answered' && row.answer?.derived != null)
	}
}

export const decisionRows = (board: BoardRead): DecisionRow[] =>
	board.decisions
		.filter((decision) => !decision.archived)
		.toSorted(
			(a, b) =>
				ORDER[decisionState(a)] - ORDER[decisionState(b)] || a.createdAt.localeCompare(b.createdAt),
		)
		.map((decision): DecisionRow => {
			const state = decisionState(decision)
			const answer = state === 'answered' ? decision.answer : null
			const options = decision.options ?? []
			return {
				id: decision.id,
				question: decision.question,
				category: decision.category,
				state,
				chosen: options.find((option) => option.id === answer?.option) ?? null,
				answer,
				notPicked: options.filter((option) => option.id !== answer?.option),
				nodes: board.nodes
					.filter((node) => node.decisions.includes(decision.id))
					.map((node) => ({ id: node.id, title: node.title })),
			}
		})

/** What the row says while nothing has been picked. An unopened one has nothing to pick from yet. */
export const waitingLabel = (row: DecisionRow): string => {
	const holds = `holds ${row.nodes.length} ${row.nodes.length === 1 ? 'node' : 'nodes'}`
	return row.state === 'unopened'
		? `No options yet — a session produces them (/sober:decide) · ${holds}`
		: `Unanswered · ${holds}`
}

/** The nodes a new question can hold. A done node has nothing left to hold back. */
export const bindable = (
	board: BoardRead,
): readonly { readonly id: string; readonly title: string }[] =>
	board.nodes
		.filter((node) => node.status !== 'done')
		.map((node) => ({ id: node.id, title: node.title }))

export interface QuestionForm {
	readonly question: string
	readonly category: Category
	readonly binds: readonly string[]
}

/**
 * The `create_decision` body, or null while the form cannot be sent: a question
 * with no words has nothing to answer, and one that holds no node blocks nothing.
 */
export const questionBody = (form: QuestionForm): QuestionForm | null => {
	const question = form.question.trim()
	return question === '' || form.binds.length === 0
		? null
		: { question, category: form.category, binds: [...new Set(form.binds)] }
}
