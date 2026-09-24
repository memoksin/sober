import type { Delta, Digest } from '@besober/schema'
import { DEFAULT_CONFIG, readConfig } from './config.js'
import { git, refExists, remoteName, showFromRef } from './git.js'
import { type Board, loadBoard } from './graph.js'
import { fileId, type Paths, SOBER_DIR } from './paths.js'
import { flagsOf, statusOf } from './status.js'

/**
 * What the board branch carries that the digest reads. The archive is not
 * here: a node moved out of `nodes/` is a delete under this pathspec, and a
 * delete is not one of §7.1's five things.
 */
const WATCHED = [`${SOBER_DIR}/nodes`, `${SOBER_DIR}/decisions`] as const

/**
 * The snapshot half of DESIGN §7.1: what is true on this machine right now.
 * No fetch, no delta, no remote — which is why it is the half that still
 * answers for the single user whose three agents were running when the board
 * closed, and the reason the digest survives having no network at all.
 */
export const snapshot = (board: Board): Pick<Digest, 'inReview' | 'flagged'> => {
	const ids = [...board.nodes.keys()].sort()
	return {
		inReview: ids.filter((id) => statusOf(board, id) === 'in-review'),
		flagged: ids.filter((id) => flagsOf(board, id).flagged),
	}
}

/**
 * What changed since you last looked (§7.1, D38). No new record type and no
 * stored pointer: git already tracks where the last sync left the board, so
 * the delta is a diff between the local board branch and its remote-tracking
 * ref, and the snapshot is a read of the board on disk.
 *
 * `fetch` is the caller saying whether this call may touch the network. §1.2
 * permits an automatic fetch and forbids an automatic pull, so the distinction
 * is a parameter rather than a comment: the dashboard asks for one when the
 * board is opened, and for none on the poll that follows.
 */
export const digest = async (
	paths: Paths,
	options: { readonly fetch: boolean },
): Promise<Digest> => {
	const [board, since] = await Promise.all([loadBoard(paths), delta(paths, options.fetch)])
	return { ...since, ...snapshot(board) }
}

/**
 * Every way the delta half can be empty says which one it was (§8.7): a
 * message that names no cause turns "nothing changed" and "nothing was
 * checked" into the same sentence, and those are opposite facts.
 */
const unreachable = (reason: string): Pick<Digest, 'delta' | 'unreachable'> => ({
	delta: null,
	unreachable: reason,
})

const delta = async (
	paths: Paths,
	fetch: boolean,
): Promise<Pick<Digest, 'delta' | 'unreachable'>> => {
	const { root } = paths
	const config = await readConfig(paths)
	const branch = (config.kind === 'ok' ? config.value : DEFAULT_CONFIG).board.branch

	const remote = await remoteName(root)
	if (remote === null)
		return unreachable('this repository has no remote — the board is only on this machine')

	const theirs = `refs/remotes/${remote}/${branch}`

	if (fetch) {
		// A fetch writes nothing into the working tree and merges nothing, which
		// is exactly why §1.2 allows this one to be automatic where a pull may
		// never be. One ref moves; no file on disk does.
		const moved = await fetched(root, remote, branch)
		if (!moved)
			return unreachable(
				`${remote} could not be reached — open the board again when you have a connection`,
			)
	}

	if (!(await refExists(root, branch)) || !(await refExists(root, theirs)))
		return unreachable(`this board has not been shared yet — \`sober sync\` puts it on ${remote}`)

	try {
		return { delta: await compare(root, branch, theirs), unreachable: null }
	} catch (error) {
		// Both refs are there and git still refused. Whatever it is, it is the
		// delta half's problem alone: the snapshot half is a read of the board on
		// disk, and it does not get to fail because a ref points at a bad object.
		return unreachable(`the board branch could not be read — ${(error as Error).message}`)
	}
}

const fetched = async (root: string, remote: string, branch: string): Promise<boolean> => {
	try {
		await git(
			root,
			'fetch',
			'--quiet',
			remote,
			`+refs/heads/${branch}:refs/remotes/${remote}/${branch}`,
		)
		return true
	} catch (error) {
		// A remote that simply has no board yet is not an unreachable one, and
		// git says which in one sentence. The missing ref is reported by the
		// caller as "not shared yet", which is the sentence with something to do
		// in it.
		return /couldn't find remote ref/i.test(String(error))
	}
}

/**
 * `--no-renames` on purpose. A record file renamed inside `nodes/` is a delete
 * and an add, and the add is a new node — which is what the digest should say
 * about it. Handling `R` would be a second parse of the same fact.
 *
 * `-z` because the paths come off a directory a person may edit by hand: NUL
 * separation is the one form git never quotes.
 */
const compare = async (root: string, ours: string, theirs: string): Promise<Delta> => {
	const listing = await git(
		root,
		'diff',
		'--no-renames',
		'--name-status',
		'-z',
		ours,
		theirs,
		'--',
		...WATCHED,
	)

	const fields = listing.split('\0').filter((field) => field !== '')
	const nodes: string[] = []
	const answered: string[] = []
	const finished: string[] = []

	for (let at = 0; at + 1 < fields.length; at += 2) {
		const status = fields[at]
		const path = fields[at + 1]
		const id = path === undefined ? null : fileId(path)
		if (path === undefined || id === null) continue

		const decision = path.startsWith(`${SOBER_DIR}/decisions/`)
		if (status === 'A' && !decision) nodes.push(id)
		if (status !== 'M') continue

		// Null to a record, in both cases. A field that was already set and
		// changed is an edit, and an edit is not one of §7.1's five things.
		const field = decision ? 'answer' : 'accepted'
		if (!(await carries(root, ours, path, field)) && (await carries(root, theirs, path, field)))
			(decision ? answered : finished).push(id)
	}

	return { nodes: nodes.sort(), answered: answered.sort(), finished: finished.sort() }
}

/**
 * Whether one field of a record is set, at one ref. The record is read loosely
 * rather than parsed: a file a newer SOBER wrote, or one somebody broke by
 * hand, must not take the digest down with it (§8.4) — it simply has nothing
 * to report.
 */
const carries = async (
	root: string,
	ref: string,
	path: string,
	field: 'answer' | 'accepted',
): Promise<boolean> => {
	const text = await showFromRef(root, ref, path)
	if (text === null) return false
	try {
		return (JSON.parse(text) as Record<string, unknown>)[field] != null
	} catch {
		return false
	}
}
