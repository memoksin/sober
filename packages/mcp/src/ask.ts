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
			? await server.elicitInput({ mode: 'form', ...params })
			: await server.request({ method: 'elicitation/create', params }, ElicitResultSchema)

	if (result.action !== 'accept') return null
	const choice = result.content?.choice
	return typeof choice === 'string' ? choice : null
}

const YES = 'yes'

/**
 * The same mechanism for "are you sure", because approval is a human act too
 * (D26, ADR 0010). A checkbox defaulting to false would be one keystroke from
 * a rubber stamp; naming the thing being approved is not.
 */
export const askYes = async (
	server: Server,
	what: string,
	message: string,
	yes: string,
): Promise<boolean> =>
	(await askChoice(server, what, message, [
		{ id: YES, label: yes },
		{ id: 'no', label: 'No, not yet' },
	])) === YES
