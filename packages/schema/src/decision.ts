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

/**
 * The human's choice. `option` names an option id, never an index (ADR 0020).
 *
 * `derived` is copied off the decision when the answer is written. It says
 * "read off the code, confirmed by a person", which is a weaker claim than an
 * answer somebody arrived at, and a reader of the record is entitled to know
 * which of the two they are looking at (ADR 0055). It is not an escape from
 * the one hard rule: the pick is still the human's, one at a time.
 *
 * Missing on every board written before v1.1, so it defaults rather than
 * migrating: a decision has never had a migration hook, and adding the
 * machinery to write `null` into records that already read as `null` is more
 * moving parts than the field is worth.
 */
export const Answer = z.strictObject({
	option: z.string().min(1),
	rationale: z.string(),
	by: Handle,
	at: Timestamp,
	derived: z.string().min(1).nullable().default(null),
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
		/**
		 * Set when the options were read off a repository that had already made
		 * this choice — a path, a file, `the import graph` (ADR 0055). It names
		 * where, never what: the pick is still put to a human one at a time, and
		 * `answerDecision` copies this onto the answer when they make it.
		 */
		derived: z.string().min(1).nullable().default(null),
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
