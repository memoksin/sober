import { declaredAccuracy } from '@besober/core'
import { baseOf, openBoard } from './board.js'
import { bold, columns, cyan, dim, green, red, say, yellow } from './out.js'

/**
 * Read-only: how well every accepted node's declared `files` predicted what
 * its merge actually touched. Measures the `undeclared-file` signal
 * (`signals.ts`) rather than acting on it — SCOPE.md's scope rule 3 keeps it a
 * flag until this is measured, and this is only the measuring.
 */
export const accuracy = async (base?: string): Promise<void> => {
	const paths = await openBoard()
	const ref = await baseOf(paths, base)
	const { rows, totals } = await declaredAccuracy(paths, ref)

	if (rows.length === 0) {
		say(dim('No accepted node yet.'))
		return
	}

	say(
		columns(
			rows.map((row) =>
				row.measurable
					? [
							`  ${cyan(row.id)}`,
							`${row.touched} touched`,
							row.undeclared === 0 ? dim('0 undeclared') : yellow(`${row.undeclared} undeclared`),
							row.unmatchedGlobs === 0
								? dim('0 unmatched globs')
								: yellow(`${row.unmatchedGlobs} unmatched globs`),
						]
					: [`  ${cyan(row.id)}`, red('unmeasurable'), dim(row.reason)],
			),
		).join('\n'),
	)

	say()
	say(bold('totals'))
	say(
		columns([
			['  measurable nodes', String(totals.measurableNodes)],
			['  touched files', String(totals.touchedFiles)],
			[
				'  undeclared files',
				totals.undeclaredFiles === 0 ? green('0') : String(totals.undeclaredFiles),
			],
			[
				'  unmatched globs',
				totals.unmatchedGlobs === 0 ? green('0') : String(totals.unmatchedGlobs),
			],
		]).join('\n'),
	)
}
