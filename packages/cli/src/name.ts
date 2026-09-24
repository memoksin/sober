import { loadBoard, type Paths } from '@besober/core'
import { cyan, dim, fail, say } from './out.js'

/**
 * A node id carries a generated suffix — `invoice-total-using-currencies-module-kxgr`
 * — so nobody types one from memory. The M2 gate found what that costs: an
 * honest `sober run invoice-total` answered "is not on this board", which is
 * true and useless.
 *
 * So every command that names a record takes a prefix, and takes it only when
 * it names exactly one. Ambiguity is not resolved by picking: it is shown.
 */
export const widen = async (paths: Paths, given: readonly string[]): Promise<readonly string[]> => {
	const board = await loadBoard(paths).catch(() => null)
	if (board === null) return given
	const ids = [...board.nodes.keys(), ...board.decisions.keys()]
	return given.map((one) => only(ids, one))
}

const only = (ids: readonly string[], given: string): string => {
	if (ids.includes(given)) return given

	const matches = ids.filter((id) => id.startsWith(given))
	const found = matches.length > 0 ? matches : ids.filter((id) => id.includes(given))
	if (found.length === 1) return found[0] as string
	if (found.length === 0) return given

	say(`${cyan(given)} names ${found.length} records:`)
	for (const id of found) say(dim(`  ${id}`))
	return fail('say which one — a prefix is enough when it names only one')
}
