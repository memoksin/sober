import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ElicitResultSchema } from '@modelcontextprotocol/sdk/types.js'

/**
 * A host that cannot ask the human cannot accept (ADR 0010, `PR-03-09`). The
 * refusal names the surface that can, rather than failing with a protocol
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

/**
 * The pick comes from the human, never from the agent that opened the question
 * (ADR 0010). One question, one answer, one call — a list would be the batch
 * accept the rule exists to prevent.
 *
 * Two protocol eras are alive at once. The 2026 revision splits the capability
 * into `elicitation.form` and `elicitation.url`, and the SDK refuses to send a
 * form request without the first; hosts written against the 2025 revision
 * declare a bare `elicitation` and would be refused for something they support.
 * So the capability is read, and the older shape goes out as a plain request.
 */
export const askChoice = async (
	server: Server,
	what: string,
	message: string,
	choices: readonly Choice[],
): Promise<string | null> => {
	// One line of question, one short label per option. Found in the M1 gate:
	// a host truncates rather than wraps, so anything long enough to matter is
	// exactly what gets cut. Whatever the human has to *read* to choose is put
	// in front of them in the conversation first; this prompt is where they
	// choose, and the choice is a message they send, not one the agent relays
	// (ADR 0010).

	const elicitation = server.getClientCapabilities()?.elicitation
	if (elicitation === undefined) throw new NoElicitationError(what)

	const params = {
		message,
		requestedSchema: {
			type: 'object' as const,
			properties: {
				choice: {
					type: 'string' as const,
					title: what,
					enum: choices.map((choice) => choice.id),
					enumNames: choices.map((choice) => choice.label),
				},
			},
			required: ['choice'],
		},
	}

	const result =
		'form' in elicitation
			? await server.elicitInput({ mode: 'form', ...params }, { timeout: WHILE_THEY_THINK })
			: await server.request({ method: 'elicitation/create', params }, ElicitResultSchema, {
					timeout: WHILE_THEY_THINK,
				})

	if (result.action !== 'accept') return null
	const choice = result.content?.choice
	return typeof choice === 'string' ? choice : null
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
