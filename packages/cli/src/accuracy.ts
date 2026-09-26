import { declaredFileAccuracy } from '@besober/core'
import { baseOf, openBoard, readBoard } from './board.js'
import { bold, columns, cyan, dim, green, red, say, yellow } from './out.js'

/**
 * Read-only: how often an accepted node's declared `files` matched what its
 * merged work actually touched. Measures the `undeclared-file` signal
 * (`signals.ts`); changes nothing about it (SCOPE.md rule 3).
 */
export const accuracy = async (base?: string): Promise<void> => {
	const paths = await openBoard()
	const board = await readBoard(paths)
	const ref = await baseOf(paths, base)
	const report = await declaredFileAccuracy(paths, board, ref)

	if (report.nodes.length === 0) {
		say(dim('No accepted nodes yet.'))
		return
	}

	const rows = report.nodes.map((node) =>
		node.measurable
			? [
					cyan(node.id),
					node.title,
					`${node.declaredGlobs} glob(s)`,
					`${node.touchedFiles} touched`,
					node.undeclaredFiles === 0
						? green('0 undeclared')
						: yellow(`${node.undeclaredFiles} undeclared`),
					node.unmatchedGlobs === 0
						? green('0 unmatched')
						: yellow(`${node.unmatchedGlobs} unmatched`),
				]
			: [cyan(node.id), node.title, dim('unmeasurable'), dim(node.reason ?? ''), '', ''],
	)
	say(columns(rows).join('\n'))

	say()
	const { totals } = report
	say(
		`${bold(String(totals.measurableNodes))} measurable node(s) · ${totals.touchedFiles} touched file(s) · ${totals.undeclaredFiles === 0 ? green('0 undeclared') : red(`${totals.undeclaredFiles} undeclared`)} · ${totals.unmatchedGlobs === 0 ? green('0 unmatched glob(s)') : red(`${totals.unmatchedGlobs} unmatched glob(s)`)}`,
	)

	const unmeasurable = report.nodes.length - report.totals.measurableNodes
	if (unmeasurable > 0)
		say(
			dim(
				`  ${unmeasurable} accepted node(s) are not attributable to one reachable local merge — excluded above`,
			),
		)
}
