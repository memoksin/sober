import { acceptDistribution, dropDistribution, loadBoard, readDistribution } from '@besober/core'
import { openBoard } from './board.js'
import { bold, columns, cyan, dim, green, refuse, say, yellow } from './out.js'

/**
 * The plan a session proposed, read and settled from a terminal (ADR 0051).
 * The matching is not here and never will be: a terminal has no agent, which is
 * the line ADR 0009 drew for planning and this is the same line.
 *
 * What is here is both ways out. Accepting assigns; dropping takes it off the
 * board — and without the second the only exit from a plan somebody disagrees
 * with is applying it.
 */
export const distribute = async (how: 'show' | 'accept' | 'drop'): Promise<void> => {
	const paths = await openBoard()

	if (how === 'drop') {
		const had = await dropDistribution(paths).catch(refuse)
		return say(
			had
				? `${green('✓')} the proposal is off the board — nothing was assigned`
				: `${yellow('·')} there was no proposal waiting`,
		)
	}

	if (how === 'accept') {
		const landed = await acceptDistribution(paths).catch(refuse)
		if (landed === null) return nothing()

		say(
			landed.matches.length === 0
				? `${yellow('·')} nothing was assigned`
				: `${green('✓')} ${landed.matches.length} node${landed.matches.length === 1 ? '' : 's'} assigned`,
		)
		if (landed.matches.length > 0)
			say(columns(landed.matches.map((one) => [`  ${cyan(one.node)}`, one.handle])).join('\n'))
		return passedOver(landed.skipped)
	}

	const waiting = await readDistribution(paths).catch(refuse)
	if (waiting === null) return nothing()

	const board = await loadBoard(paths).catch(refuse)
	say(dim(`proposed by ${waiting.by}, ${waiting.at}`))
	// The reason under the row it belongs to, rather than a second list keyed by
	// id. It is the only part of the session's reasoning that left the session,
	// and a reader should not have to join two tables to find it.
	for (const one of waiting.matches) {
		say()
		say(`  ${bold(one.handle)}  ${cyan(one.node)}  ${dim(board.nodes.get(one.node)?.title ?? '')}`)
		say(dim(`    ${one.because}`))
	}
	passedOver(waiting.skipped)
	say()
	say(dim(`Nothing is assigned yet. ${bold('sober distribute --accept')}, or ${bold('--drop')}.`))
}

const nothing = (): void => {
	say(`${yellow('·')} no proposal is waiting`)
	say()
	say(dim('  A distribution is proposed in an agent session, where the board can be read.'))
}

/** Decision 4 of ADR 0051, said out loud: a claim is a fact and this is a plan. */
const passedOver = (skipped: readonly string[]): void => {
	if (skipped.length === 0) return
	say()
	say(
		`${dim('·')} ${dim(
			`passed over ${skipped.length} node${skipped.length === 1 ? '' : 's'} — somebody is already on ${skipped.length === 1 ? 'it' : 'them'}, or ${skipped.length === 1 ? 'it is' : 'they are'} done: ${skipped.join(', ')}`,
		)}`,
	)
}
