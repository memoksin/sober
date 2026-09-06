import { flagsOf, lastRun, openDecisions, statusOf, unbound, waitingOn } from '@besober/core'
import { decisionState } from '@besober/schema'
import { openBoard, readBoard } from './board.js'
import { blue, bold, columns, cyan, dim, green, magenta, red, say, yellow } from './out.js'

/**
 * One colour language across every command: magenta is a decision, cyan is a
 * node, blue is a file or a brief, yellow is something in motion, green is
 * done. A status takes the colour of whatever it is waiting for, so the column
 * answers "waiting on what" before the sentence beside it does.
 */
const COLOUR: Record<string, ((text: string) => string) | undefined> = {
	done: green,
	ready: bold,
	running: yellow,
	'in-review': yellow,
	blocked: dim,
	held: magenta,
	'needs-brief': blue,
	'needs-approval': blue,
}

/**
 * The board, and what it says can start now (§3.2). Status is never printed
 * from a field: it is derived here the same way every other surface derives it,
 * which is why the CLI is the contract test rather than the lesser twin
 * (`PR-09-08`).
 */
export const status = async (only?: string): Promise<void> => {
	const paths = await openBoard()
	const board = await readBoard(paths)

	if (board.project !== null) {
		say(bold(board.project.title))
		if (board.project.intent !== '') say(dim(board.project.intent))
		say()
	}

	const ids = [...board.nodes.keys()].filter((id) => only === undefined || id === only).sort()
	if (ids.length === 0) {
		say(only === undefined ? dim('No nodes yet.') : `${red('×')} ${only} is not on this board`)
		if (only === undefined) {
			say()
			say('Open a session with the SOBER plugin and say what you want built.')
		}
		return
	}

	const rows = ids.map((id) => {
		const node = board.nodes.get(id)
		const state = statusOf(board, id) ?? 'needs-brief'
		const flags = flagsOf(board, id)
		return [
			`  ${(COLOUR[state] ?? dim)(state)}`,
			cyan(id),
			node?.title ?? '',
			who(node),
			flags.lastRunFailed ? red('last run failed') : waiting(board, id),
		]
	})
	say(columns(rows).join('\n'))

	const loose = unbound(board)
	if (loose.length > 0) {
		say()
		say(bold(`${loose.length} decision${loose.length === 1 ? '' : 's'} bound to nothing`))
		say(dim(`  ${loose.join(', ')}`))
		// Answering one of these unblocks nothing, which is the failure the one
		// hard block exists to prevent (§2.3).
		say(dim('  each holds no node — bind it with `sober bind <node> --decisions <id,…>`'))
	}

	const open = openDecisions(board)
	if (open.length > 0) {
		say()
		say(bold(`${open.length} decision${open.length === 1 ? '' : 's'} waiting on you`))
		say(columns(open.map(([id, decision]) => [`  ${magenta(id)}`, decision.question])).join('\n'))
	}
}

/**
 * Who is on it. A claim is a fact and an assignment is a plan (§3.3), so the
 * two never read the same: one is a name, the other is a name it is heading to.
 */
const who = (
	node: { claim: { by: string } | null; assignee: string | null } | undefined,
): string => {
	if (node?.claim == null) return node?.assignee == null ? '' : dim(`→ ${node.assignee}`)
	// Someone else doing what was planned for another person is the one thing
	// here a reader has to see; hiding the plan behind the fact loses it.
	const plan =
		node.assignee != null && node.assignee !== node.claim.by ? ` (for ${node.assignee})` : ''
	return dim(`@${node.claim.by}${plan}`)
}

/**
 * The one thing a reader wants beside a held or blocked node: what it is
 * waiting for. `core` decides what that is (it is a fact about the board); this
 * decides how a terminal says it, which is one kind at a time — a column is not
 * a panel, and "waiting on a decision and two nodes" is not a column's sentence.
 */
const waiting = (board: Awaited<ReturnType<typeof readBoard>>, id: string): string => {
	const held = waitingOn(board, id)
	const first = held[0]

	if (first !== undefined) {
		const same = held.filter((one) => one.kind === first.kind)
		const names = same.map((one) => (one.archived ? `${one.id} (archived)` : one.id))
		return dim(`waiting on ${names.join(', ')}`)
	}

	const run = lastRun(board, id)
	return run !== null && run.run.exit === null ? dim(`run ${run.id}`) : ''
}
