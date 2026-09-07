import type { Claim, Node } from '@besober/schema'
import picomatch from 'picomatch'
import { readContributors, sameHandle } from './contributors.js'
import { NotOnBoardError, SoberError } from './errors.js'
import { between } from './graph.js'
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

/**
 * A run of linked nodes, taken or given back in one act (ADR 0050). It is a
 * claim on each node rather than a record of its own: nothing on the board says
 * "these five were a run", which is what makes the run a snapshot of the nodes
 * that were there when it was named.
 */
export interface Chained {
	/** The run itself, in dependency order. Empty when no path joins the ends. */
	readonly nodes: readonly string[]
	/** What this call took, or gave back. Empty when it refused. */
	readonly changed: readonly string[]
	/** Somebody else's, and who. What a refusal is about, and what a release leaves alone. */
	readonly taken: readonly { readonly id: string; readonly by: string }[]
	/** Finished, so passed over: a claim on work that already landed says nothing. */
	readonly done: readonly string[]
}

/** The two ends checked, and the run they name with its records already in hand. */
const ends = async (paths: Paths, from: string, to: string) => {
	const { records } = await readNodes(paths)
	for (const id of [from, to]) if (!records.has(id)) throw new NotOnBoardError('node', id)

	const run = between(records, from, to)
	// `between` only ever returns keys of `records`, so nothing is dropped here.
	// Carrying the record beside the id is what keeps the writes below off a
	// second lookup that the types would have to be told cannot fail.
	const nodes = run.flatMap((id) => {
		const record = records.get(id)
		return record === undefined ? [] : [[id, record] as const]
	})
	return { run, nodes }
}

type Held = readonly (readonly [string, Node])[]

const held = (nodes: Held, by: string): { id: string; by: string }[] =>
	nodes.flatMap(([id, node]) =>
		node.claim !== null && !sameHandle(node.claim.by, by) ? [{ id, by: node.claim.by }] : [],
	)

const ids = (nodes: Held): string[] => nodes.map(([id]) => id)

/**
 * Taking the whole run. A single claim never refuses (D23, ADR 0005) because
 * there is one node and one person to report; a run can cross several people at
 * once, so it borrows ADR 0032's shape instead — refused once with the names,
 * and the second call carrying `anyway` is the confirmation. The claim itself
 * is still a signal and still not a lock: the second call always goes through.
 *
 * All of it under one lock, because ADR 0025's lock covers an action rather
 * than a file — half a run visible to the other writer is exactly what it is
 * for.
 */
export const claimChain = (
	paths: Paths,
	from: string,
	to: string,
	by: string,
	options: { readonly anyway?: boolean } = {},
): Promise<Chained> =>
	withLock(paths, 'claim', async () => {
		const { run, nodes } = await ends(paths, from, to)
		const done = nodes.filter(([, node]) => node.accepted !== null)
		const mine = nodes.filter(([, node]) => node.accepted === null)
		const taken = held(mine, by)
		if (taken.length > 0 && options.anyway !== true)
			return { nodes: run, changed: [], taken, done: ids(done) }

		// One timestamp for the whole run: they were taken in one act, and a
		// spread of them would read as somebody working down the list.
		const claim: Claim = { by, at: new Date().toISOString() }
		for (const [id, node] of mine) await writeNode(paths, id, { ...node, claim })
		return { nodes: run, changed: ids(mine), taken, done: ids(done) }
	})

/**
 * Giving the whole run back. It never touches a node somebody else holds and
 * never asks to: taking a teammate's claim off as a side effect of tidying up
 * my own is the silent stomp the same-files warning exists to prevent.
 */
export const releaseChain = (
	paths: Paths,
	from: string,
	to: string,
	by: string,
): Promise<Chained> =>
	withLock(paths, 'claim', async () => {
		const { run, nodes } = await ends(paths, from, to)
		const mine = nodes.filter(([, node]) => node.claim !== null && sameHandle(node.claim.by, by))
		for (const [id, node] of mine) await writeNode(paths, id, { ...node, claim: null })
		return { nodes: run, changed: ids(mine), taken: held(nodes, by), done: [] }
	})
