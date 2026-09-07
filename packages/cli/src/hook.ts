import { findRoot, loadBoard, paths as resolve, statusOf } from '@besober/core'
import { decisionState } from '@besober/schema'

/**
 * Hook enforcement (ADR 0009, ADR 0047): the plugin's guard against the one
 * thing SOBER cannot refuse from the outside. `core` will not dispatch a held
 * node and every surface honours that — but a human in a host session can tell
 * the agent to build it anyway, and there the decision is only advice.
 *
 * The guard runs as `sober hook <event>`: one JSON object in on stdin, one out
 * on stdout. It is a `sober` subcommand rather than a script in the plugin so
 * that it derives nothing of its own — `statusOf` is the same function the
 * board, the CLI and the MCP server ask, and a second implementation of `held`
 * would drift and then be wrong in the one place being wrong is expensive.
 */
interface Payload {
	readonly cwd?: string
	readonly tool_name?: string
	readonly tool_input?: { readonly description?: string; readonly prompt?: string }
}

/**
 * What a host reads. `hookSpecificOutput` is the verdict; `systemMessage` is
 * said to the human whatever the verdict is, which is how a guard that could
 * not run says so instead of reading as clean (§8.1, and the scan's rule in
 * ADR 0011).
 */
interface Verdict {
	hookSpecificOutput?: Record<string, unknown>
	systemMessage?: string
}

const read = async (): Promise<Payload> => {
	const chunks: Buffer[] = []
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Payload
	} catch {
		return {}
	}
}

export const hook = async (event: string | undefined): Promise<void> => {
	const payload = await read()
	const verdict = await decide(event, payload)
	process.stdout.write(`${JSON.stringify(verdict)}\n`)
}

const decide = async (event: string | undefined, payload: Payload): Promise<Verdict> => {
	const root = findRoot(payload.cwd ?? process.cwd())
	// No board here is not a failure of the guard: there is nothing to enforce,
	// and a session in an unrelated repository must not hear from SOBER at all.
	if (root === null) return {}

	let board: Awaited<ReturnType<typeof loadBoard>>
	try {
		board = await loadBoard(resolve(root))
	} catch (error) {
		return { systemMessage: didNotRun([`the board: ${(error as Error).message}`]) }
	}

	const held = [...board.nodes.keys()]
		.filter((id) => statusOf(board, id) === 'held')
		.sort()
		.map((id) => ({ id, decisions: unanswered(board, id) }))

	const warning = board.broken.length === 0 ? {} : { systemMessage: didNotRun(broken(board)) }

	if (event === 'session') return { ...warning, ...live(held) }
	if (event === 'spawn') return { ...warning, ...denial(held, aimedAt(payload)) }
	return warning
}

/** Every unanswered decision a held node binds, with what each one asks. */
const unanswered = (
	board: Awaited<ReturnType<typeof loadBoard>>,
	id: string,
): { id: string; question: string }[] =>
	(board.nodes.get(id)?.decisions ?? [])
		.filter((decision) => {
			const record = board.decisions.get(decision)
			return record === undefined || decisionState(record) !== 'answered'
		})
		.map((decision) => ({
			id: decision,
			question: board.decisions.get(decision)?.question ?? 'the decision file cannot be read',
		}))

const broken = (board: Awaited<ReturnType<typeof loadBoard>>): string[] =>
	board.broken.map((one) => `${one.file}: ${one.reason}`)

/**
 * A broken file is a node or a decision the guard never saw, so what it holds
 * was never weighed. The scan's rule applies unchanged: never report clean
 * what did not run.
 */
const didNotRun = (reasons: readonly string[]): string =>
	`SOBER: ${reasons.join('; ')}. Hook enforcement did not run over that — treat the board as incomplete rather than clear.`

/**
 * Everything the spawn says about itself. The node id is the only handle a
 * host gives us: a spawn carries a description and a prompt, and nothing that
 * names the work as SOBER knows it. An id is a slug plus four characters
 * (ADR 0020), so it is distinctive enough to look for and specific enough that
 * finding one means the agent is being aimed at that node.
 */
const aimedAt = (payload: Payload): string =>
	`${payload.tool_input?.description ?? ''}\n${payload.tool_input?.prompt ?? ''}`

/** An id with a letter, a digit or a hyphen stuck to it is a different id. */
const names = (haystack: string, id: string): boolean =>
	new RegExp(`(?<![a-z0-9-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9-])`).test(
		haystack.toLowerCase(),
	)

type Held = { id: string; decisions: { id: string; question: string }[] }

const denial = (held: readonly Held[], text: string): Verdict => {
	const aimed = held.filter((node) => names(text, node.id))
	if (aimed.length === 0) return {}

	const lines = aimed.flatMap((node) => [
		`${node.id} is held.`,
		...node.decisions.map((decision) => `  ${decision.id} is unanswered: ${decision.question}`),
	])
	const first = aimed[0]?.decisions[0]?.id ?? '<id>'
	return {
		hookSpecificOutput: {
			hookEventName: 'PreToolUse',
			permissionDecision: 'deny',
			permissionDecisionReason: [
				...lines,
				'',
				// The reason a person reads at the moment they are stopped is the
				// only place this argument lands (§2.3): options are generated
				// against current context, and work built on a guess spreads.
				'A decision changes the shape of more than one node, so nothing routes around it — an agent guessing here means every file it writes inherits the guess.',
				`Answer it with /sober-decide, or \`sober decide ${first} <option>\` — \`sober decisions\` lists the options with what each costs later.`,
			].join('\n'),
		},
	}
}

/**
 * A guard that is not installed is silent, and silence reads as permission
 * (`DESIGN.md` §2.9). So the one that is installed says so once, at the start,
 * where a session can be believed rather than assumed.
 */
const live = (held: readonly Held[]): Verdict => ({
	hookSpecificOutput: {
		hookEventName: 'SessionStart',
		additionalContext: [
			'SOBER hook enforcement is live in this session: an agent spawn that names a held node is denied, and the only way through is answering the decision that holds it.',
			held.length === 0
				? 'Nothing is held right now.'
				: `Held now: ${held
						.map(
							(node) => `${node.id} (waiting on ${node.decisions.map((one) => one.id).join(', ')})`,
						)
						.join('; ')}.`,
		].join('\n'),
	},
})
