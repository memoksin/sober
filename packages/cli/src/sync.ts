import { basename } from 'node:path'
import { sync as syncBoard } from '@besober/core'
import { openBoard, settingsOf } from './board.js'
import { bold, columns, dim, green, say, yellow } from './out.js'

const records = (count: number): string => `${count} record${count === 1 ? '' : 's'}`

/**
 * A record path reads as its id — the file name is the id (ADR 0020). An
 * archive entry says so: archiving moves one record between two directories, so
 * without it one id turns up as both added and removed and neither line says
 * what happened.
 */
const named = (path: string): string =>
	`${basename(path, '.json')}${path.includes('/archive/') ? ' (archive)' : ''}`

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
			`${yellow('·')} ${records(result.conflicts.length)} changed on both sides, and only you can say which.`,
		)
		say()
		say(
			columns(
				result.conflicts.map((conflict) => [
					`  ${bold(conflict.id)}`,
					dim(
						conflict.kind === 'archived'
							? 'archived on one side, edited on the other'
							: conflict.fields.map((field) => field.field).join(', '),
					),
				]),
			).join('\n'),
		)
		say()
		say(`  ${bold('sober resolve')}              ${dim('the two versions, side by side')}`)
		say(
			`  ${bold(`sober resolve ${result.conflicts[0]?.id ?? '<record>'}`)}  ${dim('one record at a time')}`,
		)
		say()
		say(`Your own edits are safe: they are committed on ${bold(settings.board.branch)}.`)
		// The board did not go out. A script that piped this must not read it
		// as a sync that worked (§4).
		process.exitCode = 1
		return
	}

	if (result.kind === 'invalid') {
		const came = result.pulled.updated.length + result.pulled.removed.length
		if (came > 0) {
			say(`${green('✓')} ${records(came)} came in, and the merge landed here`)
			say()
		}
		say(`${yellow('·')} this board does not hold together, so nothing went out:`)
		for (const finding of result.findings) say(`  ${finding}`)
		say()
		say('  Fix those and sync again. Nothing is lost — everything that came in')
		say(`  is committed on ${bold(settings.board.branch)}.`)
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

	// What went out is what the board branch had that the remote did not — a
	// merge you resolved counts, even though nothing in the working tree moved.
	if (!result.outgoing) {
		say(dim('  nothing of yours had changed'))
		return
	}
	say(
		result.pushed
			? `${green('✓')} your board went out on ${bold(settings.board.branch)}`
			: `${yellow('·')} your board is committed but not pushed — ${bold('--no-push')}`,
	)
}
