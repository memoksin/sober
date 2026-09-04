import { basename } from 'node:path'
import { sync as syncBoard } from '@besober/core'
import { openBoard, settingsOf } from './board.js'
import { bold, dim, green, say, yellow } from './out.js'

const records = (count: number): string => `${count} record${count === 1 ? '' : 's'}`

/** A record path reads as its id — the file name is the id (ADR 0020). */
const named = (path: string): string => basename(path, '.json')

const listed = (label: string, ids: readonly string[]): void => {
	if (ids.length === 0) return
	say(`  ${label} ${ids.map(named).join(', ')}`)
}

/**
 * The board travels. One command does all of it, because the three steps are
 * never useful apart — a pull nobody pushes is a board only one person has.
 * `--no-push` is the exception the design names, for reading the team's board
 * without publishing your own edits yet.
 */
export const sync = async (noPush: boolean): Promise<void> => {
	const paths = await openBoard()
	const settings = await settingsOf(paths)
	const result = await syncBoard(paths, settings.board.branch, { push: !noPush })

	if (result.kind === 'conflicted') {
		say(
			`${yellow('·')} ${records(result.conflicts.length)} changed on both sides, so nothing was changed here.`,
		)
		listed(dim('both'), result.conflicts)
		say()
		say('  Choosing between them field by field is not written yet.')
		say(`  Your own edits are safe: they are committed on ${bold(settings.board.branch)}.`)
		say('  Until it is: make your copy of that record match theirs, or theirs')
		say('  match yours, and sync again.')
		// The board did not go out. A script that piped this must not read it
		// as a sync that worked (§4).
		process.exitCode = 1
		return
	}

	const { updated, removed } = result.pulled
	if (updated.length === 0 && removed.length === 0) {
		say(`${green('✓')} nothing came in`)
	} else {
		say(`${green('✓')} ${records(updated.length + removed.length)} came in`)
		listed(dim('updated'), updated)
		listed(dim('removed'), removed)
	}

	if (result.kind === 'no-remote') {
		say()
		say(`${yellow('·')} this repository has no remote, so the board was committed here and`)
		say(`  went nowhere. Add one and run ${bold('sober sync')} again.`)
		return
	}

	if (result.pushed) {
		say(
			result.committed
				? `${green('✓')} your board went out on ${bold(settings.board.branch)}`
				: dim('  nothing of yours had changed'),
		)
	} else {
		say(
			result.committed
				? `${yellow('·')} your board is committed but not pushed — ${bold('--no-push')}`
				: dim('  nothing of yours had changed'),
		)
	}
}
