import { type Model, modelsFor } from './config.js'
import { SoberError } from './errors.js'

/**
 * Jev (TypeSafe's System One model) is the optional second opinion on how hard
 * a node is and which skills it needs. It is off unless `dispatch.jevMode` says
 * otherwise, and it is the only place in SOBER that reaches the network for a
 * decision — everything else shells out to a CLI the user already logged into.
 *
 * Router-agnostic on purpose: OpenRouter, TypeSafe direct and the Vercel AI
 * Gateway all speak the same wire format, so three env vars cover all three and
 * no SDK is needed.
 *
 *   JEV_API_KEY    required — absence is what makes jevMode a stated failure
 *   JEV_BASE_URL   default https://api.typesafe.ai/v1
 *   JEV_MODEL      default typesafe-ai/jev
 *
 * OpenRouter: JEV_BASE_URL=https://openrouter.ai/api/v1 JEV_MODEL=typesafe/jev-1.13
 */
export class JevError extends SoberError {
	constructor(message: string) {
		super('jev', message)
	}
}

export interface JevDecision {
	/** 1–10, the same scale a human writes into the brief. */
	readonly complexity: number
	readonly skills: readonly string[]
	/** The `dispatch.models` entry Jev chose, or null when none covers the score. */
	readonly model: string | null
}

export interface JevAsk {
	readonly skills: readonly string[]
	readonly models: readonly Model[]
}

/**
 * Ten rungs, lowest first, so the answer's index maps straight onto the 1–10
 * scale `tierFor` already reads. Spending the levels here rather than asking
 * for a tier keeps `dispatch.thresholds` the knob it is today.
 */
const LEVELS = [
	'Trivial: a one-line edit with an obvious right answer.',
	'Very easy: one file, no design choice.',
	'Easy: a couple of files following a pattern already in the repo.',
	'Straightforward: a small new function with its test.',
	'Moderate: several files that must land together.',
	'Involved: a new module, or a change crossing two packages.',
	'Hard: a design choice with real trade-offs, plus migration or schema work.',
	'Very hard: crosses many packages, or changes a contract other code depends on.',
	'Severe: subtle correctness or concurrency work that is easy to get quietly wrong.',
	'Extreme: the approach itself is uncertain and the blast radius is the whole system.',
] as const

const SKILL_PREFIX = 'skill:'

type JevQuestion =
	| { readonly type: 'score'; readonly instructions: string; readonly criteria: readonly string[] }
	// The wire name for a yes/no question; the AI SDK calls it `boolean`.
	| { readonly type: 'noul'; readonly instructions: string }
	| {
			readonly type: 'choice'
			readonly instructions: string
			readonly criteria: Readonly<Record<string, string>>
	  }

export const jevQuestions = (skills: readonly string[]): Record<string, JevQuestion> => ({
	complexity: {
		type: 'score' as const,
		instructions: 'How hard is this node for one agent in one run?',
		criteria: [...LEVELS],
	},
	...Object.fromEntries(
		skills.map((name) => [
			`${SKILL_PREFIX}${name}`,
			{
				type: 'noul' as const,
				instructions: `Does the agent working this node need the \`${name}\` skill?`,
			},
		]),
	),
})

const answerFor = (answers: Record<string, unknown>, key: string): Record<string, unknown> => {
	const answer = answers[key]
	if (typeof answer !== 'object' || answer === null)
		throw new JevError(`Jev returned no answer for \`${key}\``)
	return answer as Record<string, unknown>
}

/** Pure, so the mapping is testable without a socket. */
export const jevDecision = (body: unknown, skills: readonly string[]): JevDecision => {
	if (typeof body !== 'object' || body === null)
		throw new JevError('Jev returned a body that is not an object')
	const answers = (body as { answers?: unknown }).answers
	if (typeof answers !== 'object' || answers === null)
		throw new JevError('Jev returned no `answers`')
	const table = answers as Record<string, unknown>

	// The score is the expected 0-based rung — a probability-weighted average,
	// so 6.5 is an answer — and the brief's scale is integers from 1.
	const score = answerFor(table, 'complexity').score
	if (typeof score !== 'number' || score < 0 || score > LEVELS.length - 1)
		throw new JevError(`Jev returned an out-of-range complexity: ${String(score)}`)

	const chosen = skills.filter((name) => {
		const probability = answerFor(table, `${SKILL_PREFIX}${name}`).noul
		if (typeof probability !== 'number')
			throw new JevError(`Jev returned no probability for the \`${name}\` skill`)
		// 0.5 is Jev saying it does not know, and an undecided skill is not one
		// worth spending the agent's attention on.
		return probability > 0.5
	})

	return { complexity: Math.round(score) + 1, skills: chosen, model: null }
}

/**
 * The constraint reaches Jev as the set it is shown: only the entries covering
 * the score are on the list, so nothing it picks can be out of range. `about`
 * is what it reads; an entry with none is described by its command line.
 */
export const modelQuestion = (eligible: readonly Model[]): Record<string, JevQuestion> => ({
	model: {
		type: 'choice',
		instructions: 'Which of these models should do this node? Pick for fit, not for size.',
		criteria: Object.fromEntries(eligible.map((m) => [m.name, m.about === '' ? m.run : m.about])),
	},
})

/** Pure, like `jevDecision`: a name off the list is a failure, not a guess. */
export const jevChoice = (body: unknown, names: readonly string[]): string => {
	if (typeof body !== 'object' || body === null)
		throw new JevError('Jev returned a body that is not an object')
	const answers = (body as { answers?: unknown }).answers
	if (typeof answers !== 'object' || answers === null)
		throw new JevError('Jev returned no `answers`')
	const choice = answerFor(answers as Record<string, unknown>, 'model').choice
	if (typeof choice !== 'string' || !names.includes(choice))
		throw new JevError(`Jev chose a model that is not on the list: ${String(choice)}`)
	return choice
}

const post = async (state: string, questions: Record<string, JevQuestion>): Promise<unknown> => {
	const key = process.env.JEV_API_KEY
	if (key === undefined || key === '')
		throw new JevError('`dispatch.jevMode` is on but JEV_API_KEY is not set')
	const base = (process.env.JEV_BASE_URL ?? 'https://api.typesafe.ai/v1').replace(/\/+$/, '')
	const model = process.env.JEV_MODEL ?? 'typesafe-ai/jev'

	let response: Response
	try {
		response = await fetch(`${base}/systemone`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
			body: JSON.stringify({ model, state, questions }),
		})
	} catch (error) {
		throw new JevError(`Jev at ${base} could not be reached: ${(error as Error).message}`)
	}
	if (!response.ok)
		throw new JevError(`Jev at ${base} answered ${response.status}: ${await response.text()}`)
	return response.json()
}

/**
 * Two round trips at most: the score first, then — only when more than one
 * entry covers it — the choice among those. One entry needs no question, and
 * none leaves the model null for dispatch to fall back on `dispatch.host`.
 */
export const askJev = async (state: string, ask: JevAsk): Promise<JevDecision> => {
	const decision = jevDecision(await post(state, jevQuestions(ask.skills)), ask.skills)
	const eligible = modelsFor(ask.models, decision.complexity)
	if (eligible.length === 0) return decision
	if (eligible.length === 1) return { ...decision, model: eligible[0]?.name ?? null }
	const names = eligible.map((m) => m.name)
	return { ...decision, model: jevChoice(await post(state, modelQuestion(eligible)), names) }
}
