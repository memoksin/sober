import { z } from 'zod'
import { Handle, Timestamp } from './id.js'

/**
 * SOBER ships the categories and never the questions or the options (D17).
 * A fifth is added by ADR, never by an agent inventing one.
 */
export const CATEGORIES = ['state', 'module-boundaries', 'data-flow', 'error-handling'] as const

export const Category = z.enum(CATEGORIES)

export type Category = z.infer<typeof Category>

/**
 * Every option carries its reason and what it costs later. That pair is the
 * whole of the education pillar in v1 (ADR 0024).
 */
export const Option = z.strictObject({
	id: z.string().min(1),
	label: z.string().min(1),
	reason: z.string().min(1),
	costLater: z.string().min(1),
})

export type Option = z.infer<typeof Option>

/** The human's choice. `option` names an option id, never an index (ADR 0020). */
export const Answer = z.strictObject({
	option: z.string().min(1),
	rationale: z.string(),
	by: Handle,
	at: Timestamp,
})

export type Answer = z.infer<typeof Answer>

/**
 * `.sober/decisions/<id>.json`. State is derived, never stored: `options` null
 * means not yet opened, `answer` null means open, otherwise answered.
 */
export const Decision = z
	.strictObject({
		category: Category,
		question: z.string().min(1),
		options: z.array(Option).min(2).max(4).nullable(),
		suggested: z.string().nullable(),
		answer: Answer.nullable(),
		createdAt: Timestamp,
	})
	.check((ctx) => {
		const { options, suggested, answer } = ctx.value
		const ids = options?.map((option) => option.id) ?? []

		if (options && new Set(ids).size !== ids.length) {
			ctx.issues.push({ code: 'custom', input: options, message: 'option ids must be unique' })
		}
		if (!options && answer) {
			ctx.issues.push({
				code: 'custom',
				input: answer,
				message: 'a decision with no options cannot carry an answer',
			})
		}
		// A regenerated list that dropped the chosen option fails here rather
		// than pointing at the wrong choice (ADR 0020).
		if (answer && !ids.includes(answer.option)) {
			ctx.issues.push({
				code: 'custom',
				input: answer.option,
				message: 'answer.option does not name one of this decision’s options',
			})
		}
		if (suggested && !ids.includes(suggested)) {
			ctx.issues.push({
				code: 'custom',
				input: suggested,
				message: 'suggested does not name one of this decision’s options',
			})
		}
	})

export type Decision = z.infer<typeof Decision>

export type DecisionState = 'unopened' | 'open' | 'answered'

/** Derived, never read from a field — no invalid combination exists (ADR 0020). */
export function decisionState(decision: Decision): DecisionState {
	if (decision.options === null) return 'unopened'
	return decision.answer === null ? 'open' : 'answered'
}
