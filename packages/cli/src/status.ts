import {
	flagsOf,
	lastRun,
	openDecisions,
	spendByEffort,
	statusOf,
	unbound,
	waitingOn,
} from '@besober/core'
import { type Run, ranLabel } from '@besober/schema'
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

	if (only !== undefined) {
		const last = lastRun(board, only)
		if (last !== null) say(dim(`  last run ${last.id} · ${spent(last.run)}`))
	} else {
		const efforts = spendByEffort(board.runs.values()).filter((group) => group.measured > 0)
		if (efforts.length > 0) {
			say()
			say(bold('spend by effort'))
			say(
				columns(
					efforts.map((g) => [
						`  ${g.effort ?? 'none'}`,
						`${g.runs} run${g.runs === 1 ? '' : 's'}`,
						dim(`${g.measured} measured`),
						`${Math.round(g.turns)} turns`,
						`${Math.round(g.contextPeak / 1000)}k peak`,
						`$${g.cost.toFixed(2)}`,
					]),
				).join('\n'),
			)
		}
	}

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

/** A run's host, effort, what it said it spent, and the session a retry resumes (ADR 0068, 0069). */
const spent = (run: Run): string =>
	[
		run.host,
		run.effort === null ? null : `effort ${run.effort}`,
		run.usage?.turns == null ? null : `${run.usage.turns} turns`,
		run.usage?.contextPeak == null ? null : `${Math.round(run.usage.contextPeak / 1000)}k peak`,
		run.usage?.cost == null ? null : `$${run.usage.cost.toFixed(2)}`,
		run.session === null ? null : `session ${run.session}`,
	]
		.filter((part) => part !== null)
		.join(' · ')

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
	if (run === null) return ''
	const ran = `${cyan(run.run.host)} (${ranLabel(run.run)})`
	if (run.run.exit === null) return dim(`run ${run.id} · ${ran}`)
	return statusOf(board, id) === 'in-review' ? dim(ran) : ''
}
