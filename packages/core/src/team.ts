import type { Claim, Node } from '@besober/schema'
import picomatch from 'picomatch'
import { readContributors } from './contributors.js'
import { NotOnBoardError, SoberError } from './errors.js'
import { withLock } from './lock.js'
import type { Paths } from './paths.js'
import { readNode, readNodes, writeNode } from './records.js'

/** Another node heading for the same files, and who is on it. */
export interface Overlap {
	readonly id: string
	readonly title: string
	/** Null when nobody has started it: it is going out in the same breath as this one. */
	readonly by: string | null
	/** The globs of *this* node that meet the other one's. */
	readonly files: readonly string[]
}

// ponytail: two globs overlap when either one matches the other read as a path.
// That catches what the prediction actually contains — `src/auth/**` against
// `src/auth/session.ts`, and two identical globs — and misses pairs no
// prediction is precise enough to need, like `src/**` against `**/session.ts`.
// The warning is a signal, not a proof (§3.4); tighten it when a real board
// produces a miss worth the machinery.
const touches = (left: string, right: string): boolean =>
	left === right || picomatch(left)(right) || picomatch(right)(left)

/**
 * Two active nodes whose `files` overlap are heading for the same merge, and
 * SOBER says so without stopping either one (DESIGN §3.4). The warning is
 * about nodes, not people: two of one person's own parallel nodes are the
 * ordinary case, not the exotic one.
 *
 * A claim is what makes a node active. `alsoStarting` is the second way, and it
 * is what makes the warning fire on one person's own wave: those nodes are not
 * claimed yet because nothing has started them — they are about to be, in the
 * same command (`PR-05-06`).
 */
export const overlaps = (
	nodes: ReadonlyMap<string, Node>,
	id: string,
	alsoStarting: readonly string[] = [],
): Overlap[] => {
	const mine = nodes.get(id)
	if (mine === undefined) return []

	const found: Overlap[] = []
	for (const [other, node] of nodes) {
		const active = node.claim !== null || alsoStarting.includes(other)
		if (other === id || !active || node.accepted !== null) continue
		const shared = mine.files.filter((glob) => node.files.some((theirs) => touches(glob, theirs)))
		if (shared.length > 0)
			found.push({ id: other, title: node.title, by: node.claim?.by ?? null, files: shared })
	}
	return found.sort((left, right) => left.id.localeCompare(right.id))
}

/**
 * The confirmation §3.4 asks for, in the only shape a surface that never prompts
 * has: the run is refused once, with the overlap named, and the human says go.
 * It is not a block — it is the same thing a dialog would be, spread over two
 * commands. The automatic consequence is the queue's (§5.3, ADR 0017): nothing
 * carrying this ever starts unattended.
 */
export class OverlapError extends SoberError {
	constructor(
		readonly node: string,
		readonly overlaps: readonly Overlap[],
	) {
		super(
			'overlap',
			`${node} is heading for files ${overlaps
				.map((one) => `${one.id}${one.by === null ? '' : ` (${one.by})`}`)
				.join(', ')} ${overlaps.length === 1 ? 'is' : 'are'} also heading for: ${[
				...new Set(overlaps.flatMap((one) => one.files)),
			].join(', ')} — start it anyway if you meant to`,
		)
	}
}

export interface Claimed {
	readonly claim: Claim
	/** Set when the node was already someone's — taking one over is never silent. */
	readonly previous: Claim | null
	readonly overlaps: readonly Overlap[]
}

/**
 * A claim is a signal, not a lock (D23, ADR 0005): it never refuses. Enforcing
 * exclusivity would need an authority SOBER does not have — the git host
 * already decides who can push to the board branch.
 */
export const claimNode = (paths: Paths, id: string, by: string): Promise<Claimed> =>
	withLock(paths, 'claim', async () => {
		const record = await readNode(paths, id)
		if (record.kind !== 'ok') throw new NotOnBoardError('node', id)

		const claim: Claim = { by, at: new Date().toISOString() }
		await writeNode(paths, id, { ...record.value, claim })

		const { records } = await readNodes(paths)
		return { claim, previous: record.value.claim, overlaps: overlaps(records, id) }
	})

export const releaseNode = (paths: Paths, id: string): Promise<Claim | null> =>
	withLock(paths, 'claim', async () => {
		const record = await readNode(paths, id)
		if (record.kind !== 'ok') throw new NotOnBoardError('node', id)
		if (record.value.claim === null) return null
		await writeNode(paths, id, { ...record.value, claim: null })
		return record.value.claim
	})

/**
 * Assignment is a plan: a human handing a node to a contributor ahead of time.
 * An unknown handle is refused, because it is a typo far more often than it is
 * a teammate nobody wrote down — and writing them down is one command.
 */
export const assignNode = (paths: Paths, id: string, handle: string | null): Promise<void> =>
	withLock(paths, 'assign', async () => {
		const record = await readNode(paths, id)
		if (record.kind !== 'ok') throw new NotOnBoardError('node', id)

		if (handle !== null) {
			const team = await readContributors(paths)
			if (!team.some((person) => person.handle === handle))
				throw new SoberError(
					'not-on-board',
					`${handle} is not on this project — \`sober contributors add ${handle}\` first`,
				)
		}
		await writeNode(paths, id, { ...record.value, assignee: handle })
	})
