import { rm } from 'node:fs/promises'
import type { Match, Node } from '@besober/schema'
import { Distribution } from '@besober/schema'
import { readContributors, sameHandle } from './contributors.js'
import { NotOnBoardError, SoberError } from './errors.js'
import { withLock } from './lock.js'
import type { Paths } from './paths.js'
import { readRecord } from './read.js'
import { readNodes, writeNode } from './records.js'
import { writeRecord } from './write.js'

/**
 * The plan waiting on the board, or none (DESIGN §3.3). Null rather than an
 * empty distribution: "nobody has proposed anything" and "somebody proposed
 * nothing" are different sentences, and only the second is worth showing.
 *
 * A file that will not parse is loud, for the reason the team file's is — the
 * next write would replace whatever it holds.
 */
export const readDistribution = async (paths: Paths): Promise<Distribution | null> => {
	const record = await readRecord(paths.distribution, Distribution)
	if (record.kind === 'missing') return null
	if (record.kind === 'broken')
		throw new SoberError('schema', `${record.file} cannot be read: ${record.reason}`)
	return record.value
}

/**
 * A node a distribution may not touch, and why. A claim is a fact and an
 * assignment is a plan (§3.3): writing a plan over somebody who is already on
 * the node overwrites the fact with the plan, and a plan for work that has
 * already landed says nothing at all.
 *
 * Enforced here rather than asked of the session that proposes, because the
 * session is where the reasoning is and this is the one rule no reasoning gets
 * to overrule.
 */
const passedOver = (node: Node): boolean => node.claim !== null || node.accepted !== null

/**
 * What a host session's matching comes back as (ADR 0051). It is written to
 * the board and applied to nothing: every node stays exactly as it was until a
 * human accepts, which is ADR 0004's rule in its second setting.
 *
 * The whole proposal is refused rather than trimmed when a handle or a node is
 * wrong, because a match naming somebody who is not on the project is a typo
 * far more often than it is a teammate nobody wrote down — the same reading
 * `assignNode` takes.
 */
export const proposeDistribution = (
	paths: Paths,
	by: string,
	matches: readonly Match[],
): Promise<Distribution> =>
	withLock(paths, 'distribute', async () => {
		const { records } = await readNodes(paths)
		const team = await readContributors(paths)

		const named = new Set<string>()
		const taking: Match[] = []
		const skipped: string[] = []
		for (const one of matches) {
			if (named.has(one.node))
				throw new SoberError(
					'schema',
					`${one.node} is named twice in this distribution — a plan that disagrees with itself is not a plan`,
				)
			named.add(one.node)

			const node = records.get(one.node)
			if (node === undefined) throw new NotOnBoardError('node', one.node)

			// The handle as the team file spells it, not as the proposal spells it.
			// `Bob` is not a second person from `bob` (M2 gate), and a plan that
			// wrote its own casing would put a second one on the board the moment
			// it landed.
			const person = team.find((one_) => sameHandle(one_.handle, one.handle))
			if (person === undefined)
				throw new SoberError(
					'not-on-board',
					`${one.handle} is not on this project — \`sober contributors add ${one.handle}\` first`,
				)

			if (passedOver(node)) skipped.push(one.node)
			else taking.push({ ...one, handle: person.handle })
		}

		const record: Distribution = {
			by,
			at: new Date().toISOString(),
			matches: taking,
			skipped,
		}
		await writeRecord(paths.distribution, record)
		return record
	})

/**
 * Taking the plan, whole. Whole rather than node by node for the reason ADR
 * 0004 gives about proposed nodes: the risk on an assignment is that it is
 * wrong, which is visible on the board and undone by one `assign`. Somebody who
 * wants seven of eight accepts the eight and reassigns one.
 *
 * The skip is checked again here rather than trusted from the proposal. Between
 * a session proposing on Tuesday and somebody accepting on Thursday a teammate
 * can claim any of it, and the plan must not land on top of that.
 */
export const acceptDistribution = (paths: Paths): Promise<Distribution | null> =>
	withLock(paths, 'distribute', async () => {
		const waiting = await readDistribution(paths)
		if (waiting === null) return null

		const { records } = await readNodes(paths)
		const landed: Match[] = []
		const skipped = [...waiting.skipped]
		for (const one of waiting.matches) {
			const node = records.get(one.node)
			// A node that left the board between the proposal and now is passed
			// over rather than refused: the rest of the plan is still good, and a
			// whole allocation lost to one archived node is a worse answer.
			if (node === undefined || passedOver(node)) {
				skipped.push(one.node)
				continue
			}
			await writeNode(paths, one.node, { ...node, assignee: one.handle })
			landed.push(one)
		}

		await rm(paths.distribution, { force: true })
		return { ...waiting, matches: landed, skipped }
	})

/**
 * Taking the plan off the board. The other way out, and the reason there are
 * two operations rather than one: without it the only exit from a proposal
 * somebody disagrees with is applying it.
 */
export const dropDistribution = (paths: Paths): Promise<boolean> =>
	withLock(paths, 'distribute', async () => {
		// Not through `readDistribution`: a plan nobody can parse is exactly the
		// one somebody needs off the board, and refusing to drop it would put the
		// only way out behind the thing that is broken.
		const record = await readRecord(paths.distribution, Distribution)
		if (record.kind === 'missing') return false
		await rm(paths.distribution, { force: true })
		return true
	})
