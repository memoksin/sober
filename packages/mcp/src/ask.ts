import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ElicitResultSchema } from '@modelcontextprotocol/sdk/types.js'

/**
 * A host that cannot ask the human cannot confirm what these forms ask (ADR
 * 0010, `PR-03-09`). `decide`, `approve` and `accept` no longer come through
 * here: the host's own question tool asks, and the agent relays the pick (ADR
 * 0057). The refusal names the surface that can, rather than failing with a protocol
 * error nobody can act on — §2.9's rule: where SOBER cannot enforce, it says
 * so.
 */
export class NoElicitationError extends Error {
	constructor(what: string) {
		super(
			`this host cannot put a question to you, so it cannot ${what}. Answer it on the command line instead — the board is the same one.`,
		)
	}
}

/**
 * A person is at the other end of this, and the SDK's default is a minute.
 * Found in the M1 gate: a decision the human was still reading timed out, the
 * agent retried, and the same question was put twice. The one hard block exists
 * to make someone stop and think; timing out the thinking is the mechanism
 * working against its own reason.
 */
const WHILE_THEY_THINK = 30 * 60_000

export interface Choice {
	readonly id: string
	readonly label: string
}

/** One question inside a form: a field, and the two things it could be. */
export interface Field {
	readonly name: string
	readonly title: string
	readonly choices: readonly Choice[]
}

/**
 * One record, one form. A conflicted record is usually two or three fields, and
 * one elicitation window per field would turn a merge into a queue of prompts a
 * person clicks through — which is the batch accept in reverse: too many
 * windows and nobody reads any of them.
 *
 * Every choice in it is still the human's. Nothing is defaulted, so a form
 * dismissed without answering is not an answer (ADR 0010).
 */
export const askFields = async (
	server: Server,
	what: string,
	message: string,
	fields: readonly Field[],
): Promise<Record<string, string> | null> => {
	const elicitation = server.getClientCapabilities()?.elicitation
	if (elicitation === undefined) throw new NoElicitationError(what)

	const params = {
		message,
		requestedSchema: {
			type: 'object' as const,
			properties: Object.fromEntries(
				fields.map((field) => [
					field.name,
					{
						type: 'string' as const,
						title: field.title,
						enum: field.choices.map((choice) => choice.id),
						enumNames: field.choices.map((choice) => choice.label),
					},
				]),
			),
			required: fields.map((field) => field.name),
		},
	}

	const result =
		'form' in elicitation
			? await server.elicitInput({ mode: 'form', ...params }, { timeout: WHILE_THEY_THINK })
			: await server.request({ method: 'elicitation/create', params }, ElicitResultSchema, {
					timeout: WHILE_THEY_THINK,
				})

	if (result.action !== 'accept') return null
	const answers: Record<string, string> = {}
	for (const field of fields) {
		const answer = result.content?.[field.name]
		if (typeof answer !== 'string') return null
		answers[field.name] = answer
	}
	return answers
}

/**
 * "Are you sure" is a confirmation, not a choice between alternatives, and the
 * host renders the two differently: an enum arrives collapsed behind a `→ to
 * expand`, a boolean does not. Found in the M1 gate — every approval cost two
 * extra keystrokes before the question was even visible.
 *
 * There is no default. The user sets it or the prompt is not satisfied, which
 * is the property a checkbox defaulting to "yes" would give away.
 */
export const askYes = async (
	server: Server,
	what: string,
	message: string,
	yes: string,
): Promise<boolean> => {
	const elicitation = server.getClientCapabilities()?.elicitation
	if (elicitation === undefined) throw new NoElicitationError(what)

	const params = {
		message,
		requestedSchema: {
			type: 'object' as const,
			properties: {
				confirmed: { type: 'boolean' as const, title: yes },
			},
			required: ['confirmed'],
		},
	}

	const result =
		'form' in elicitation
			? await server.elicitInput({ mode: 'form', ...params }, { timeout: WHILE_THEY_THINK })
			: await server.request({ method: 'elicitation/create', params }, ElicitResultSchema, {
					timeout: WHILE_THEY_THINK,
				})

	return result.action === 'accept' && result.content?.confirmed === true
}
