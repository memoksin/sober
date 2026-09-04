import { access, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createBoardBranch, ensureAttributes, ensureGitignore } from './board.js'
import { DEFAULT_CONFIG_TEXT, writeConfig } from './config.js'
import {
	ARCHIVE_FIELD,
	archivePathOf,
	type Choices,
	type Conflict,
	conflictsOf,
	mergeRecord,
	settle,
	stagesOf,
} from './conflict.js'
import { SoberError } from './errors.js'
import { git, gitVerbatim, gitWithEnv, isAncestor, refExists, remoteName, whoami } from './git.js'
import { dangling, findCycle, loadBoard } from './graph.js'
import { withLock } from './lock.js'
import type { Paths } from './paths.js'
import { SOBER_DIR } from './paths.js'
import { writeAtomic, writeRecord } from './write.js'

/**
 * What the board branch carries, and nothing else. `config.jsonc` is machine
 * settings and stays on the code branch (DESIGN §1.3); `local/` is disposable
 * (§1.4). Paths are stored repo-relative so the patterns in `.gitattributes`
 * match, and so a person who checks the branch out sees the layout they know.
 */
const BOARD_DIRS = [
	`${SOBER_DIR}/nodes`,
	`${SOBER_DIR}/decisions`,
	`${SOBER_DIR}/archive/nodes`,
	`${SOBER_DIR}/archive/decisions`,
] as const

const BOARD_FILES = [`${SOBER_DIR}/project.json`, `${SOBER_DIR}/contributors.json`] as const

/** Files the working tree gained, changed or lost because of what came in. */
export interface SyncChange {
	readonly updated: readonly string[]
	readonly removed: readonly string[]
}

const NOTHING: SyncChange = { updated: [], removed: [] }

export interface SyncResult {
	/**
	 * `synced` — the board is level with the remote, as far as it was taken.
	 * `conflicted` — the same records changed on both sides, and a human has to
	 * choose; nothing was touched. `invalid` — the merge landed and left a board
	 * that does not hold together, so the push is blocked until it does
	 * (§1.2.1). `no-remote` — the board was committed locally and there is
	 * nowhere to send it.
	 */
	readonly kind: 'synced' | 'conflicted' | 'invalid' | 'no-remote'
	/** A board commit was made from what is in the working tree right now. */
	readonly committed: boolean
	readonly pulled: SyncChange
	readonly pushed: boolean
	/** The records both sides changed. Only ever set when `kind` is `conflicted`. */
	readonly conflicts: readonly Conflict[]
	/** What the merged board gets wrong. Only ever set when `kind` is `invalid`. */
	readonly findings: readonly string[]
	/**
	 * The board branch here was ahead of the remote's, so the push carried
	 * something. Not the same as `committed`: a merge you resolved is board
	 * state to send even though nothing in the working tree changed since.
	 */
	readonly outgoing: boolean
}

const EMPTY = {
	kind: 'synced',
	committed: false,
	pulled: NOTHING,
	pushed: false,
	conflicts: [],
	findings: [],
	outgoing: false,
} as const satisfies SyncResult

/**
 * One action, in this order: commit what is here, pull, push (D35). Never
 * automatic and never on open — §1.2 says why.
 *
 * The board branch is never checked out. Every step goes through plumbing
 * against a throwaway index, so a sync in the middle of a code branch leaves
 * that branch, its index and its HEAD exactly where they were.
 */
export const sync = async (
	paths: Paths,
	branch: string,
	options: { readonly push: boolean } = { push: true },
): Promise<SyncResult> =>
	withLock(paths, 'sync', async () => {
		const { root } = paths
		await createBoardBranch(root, branch)
		const committed = await snapshot(paths, branch)

		const remote = await remoteName(root)
		if (remote === null) return { ...EMPTY, kind: 'no-remote', committed }

		const theirs = await fetchBoard(root, remote, branch)
		let pulled = NOTHING
		let findings: readonly string[] = []
		if (theirs !== null) {
			const ours = await git(root, 'rev-parse', branch)
			if (ours !== theirs && !(await isAncestor(root, theirs, ours))) {
				const landed = await pull(paths, branch, ours, theirs)
				if ('conflicts' in landed)
					return { ...EMPTY, kind: 'conflicted', committed, conflicts: landed.conflicts }
				pulled = landed.pulled
				findings = landed.findings
			}
		}

		const outgoing =
			theirs === null || !(await isAncestor(root, await git(root, 'rev-parse', branch), theirs))

		// The push is blocked until the findings are resolved (§1.2.1) — which
		// is a state, not a moment. Checking only at the merge would block one
		// sync and wave the same broken board through on the next one, so what
		// is about to go out is what is checked.
		if (outgoing && findings.length === 0) findings = await validate(paths)
		// Nothing is undone: whatever came in is committed here. It just does
		// not leave until the board holds together.
		if (findings.length > 0) return { ...EMPTY, kind: 'invalid', committed, pulled, findings }

		if (!options.push) return { ...EMPTY, kind: 'synced', committed, pulled, outgoing }
		await pushBoard(root, remote, branch)
		return { ...EMPTY, kind: 'synced', committed, pulled, pushed: true, outgoing }
	})

/**
 * Takes the remote's board into ours. One file per entity means most of what
 * two people do in a day touches different files, and git resolves that with no
 * question at all — so the question is asked only for records both sides
 * changed, which is the whole point of the layout (§1.2.1).
 */
const pull = async (
	paths: Paths,
	branch: string,
	ours: string,
	theirs: string,
): Promise<
	{ pulled: SyncChange; findings: readonly string[] } | { conflicts: readonly Conflict[] }
> => {
	const { root } = paths
	if (await isAncestor(root, ours, theirs)) {
		// Fast-forward: nothing of ours is left behind, so the remote tree
		// becomes the working tree and the branch follows it. No validation
		// pass — this is not a merge, and blocking a push we are not making
		// would say nothing about a board the remote already holds.
		const pulled = await materialize(paths, ours, theirs)
		await git(root, 'update-ref', `refs/heads/${branch}`, theirs)
		return { pulled, findings: [] }
	}

	const attempt = await merge(paths, ours, theirs)
	try {
		const conflicts = await conflictsOf(paths, attempt.index, attempt.unmerged)
		if (conflicts.length > 0) return { conflicts }

		for (const path of attempt.unmerged) await settleUnasked(paths, attempt, path)
		return await complete(paths, branch, attempt)
	} finally {
		await rm(attempt.index, { force: true })
	}
}

interface Attempt {
	/** The throwaway index holding the merge. The caller removes it. */
	readonly index: string
	readonly base: string
	readonly ours: string
	readonly theirs: string
	/** Paths git left with three versions in the index — never with markers. */
	readonly unmerged: readonly string[]
}

/**
 * Git's own three-way merge, in a throwaway index, on trees alone. `-i` keeps
 * it away from the working tree and `--aggressive` resolves the cases where
 * only one side moved — including an archive, which is one side deleting a
 * record and adding it back under `archive/`.
 *
 * What is left unmerged is exactly the set ADR 0013 says a human decides.
 */
const merge = async (paths: Paths, ours: string, theirs: string): Promise<Attempt> => {
	const { root } = paths
	const base = await git(root, 'merge-base', ours, theirs).catch(() => '')
	if (base === '')
		throw new SoberError(
			'git',
			'this board and the one on the remote share no history — they are two different boards, and merging them is not something SOBER can decide',
		)

	const index = join(paths.local, 'merge-index')
	await mkdir(paths.local, { recursive: true })
	await rm(index, { force: true })
	const env = { GIT_INDEX_FILE: index }
	await gitWithEnv(root, env, ['read-tree', '-i', '-m', '--aggressive', base, ours, theirs])
	const listing = await gitWithEnv(root, env, ['ls-files', '--unmerged'])
	const unmerged =
		listing === ''
			? []
			: [...new Set(listing.split('\n').map((line) => line.split('\t')[1] ?? ''))]
					.filter((path) => path !== '')
					.sort()
	return { index, base, ours, theirs, unmerged }
}

/**
 * A record git could not settle but a person does not have to: they edited
 * different fields of it. This is the case that makes the whole layout worth
 * its cost — one file per entity, merged field by field, and the `notes`
 * against `dependsOn` example in §1.2.1 costs nobody a question.
 *
 * Taking ours here instead would be silent data loss, which §1.2 rules out by
 * name.
 */
const settleUnasked = async (paths: Paths, attempt: Attempt, path: string): Promise<void> => {
	const [base, ours, theirs] = await stagesOf(paths.root, attempt.index, path)
	if (ours === null || theirs === null)
		throw new SoberError('git', `${path} was archived on one side, and nobody was asked about it`)
	await settle(paths, attempt.index, path, mergeRecord(path, base, ours, theirs, {}))
}

/**
 * Everything after the last question is answered: the merge commit, the working
 * tree, and the pass that asks whether what came out still holds together.
 */
const complete = async (
	paths: Paths,
	branch: string,
	attempt: Attempt,
): Promise<{ pulled: SyncChange; findings: readonly string[] }> => {
	const { root } = paths
	const tree = await gitWithEnv(root, { GIT_INDEX_FILE: attempt.index }, ['write-tree'])
	const commit = await git(
		root,
		'commit-tree',
		tree,
		'-p',
		attempt.ours,
		'-p',
		attempt.theirs,
		'-m',
		'sober: board merge',
	)
	const pulled = await materialize(paths, attempt.ours, commit)
	await git(root, 'update-ref', `refs/heads/${branch}`, commit)
	await rm(paths.merge, { force: true })
	return { pulled, findings: await validate(paths) }
}

/**
 * Two records that merge cleanly can still make a board that does not hold: one
 * side deletes a node the other adds a dependency on, or two edges that are
 * each fine alone together close a cycle. §8.3 and §3.6 refuse both at edit
 * time; a merge is the other edge, and this is where it is checked (§1.2.1).
 */
const validate = async (paths: Paths): Promise<string[]> => {
	const board = await loadBoard(paths)
	const findings = dangling(board).map(
		(edge) =>
			`${edge.node} ${edge.kind === 'dependsOn' ? 'depends on' : 'binds'} ${edge.missing}, which is not on this board`,
	)
	const cycle = findCycle(board.nodes)
	if (cycle !== null) findings.push(`these depend on each other in a circle: ${cycle.join(' → ')}`)
	return findings
}

/** The choices made so far in a merge that is not finished, and what they are for. */
interface MergeState {
	readonly ours: string
	readonly theirs: string
	readonly choices: Readonly<Record<string, Choices>>
}

export interface Resolution {
	/** `done` — every question is answered and the merge landed. */
	readonly kind: 'recorded' | 'done'
	/** What is still waiting on a human. */
	readonly left: readonly Conflict[]
	readonly findings: readonly string[]
}

/**
 * One record's answer. The choices are kept under `local/` until the last one
 * arrives, because a merge with three conflicted records is three questions and
 * a person is allowed to answer them one at a time. Losing that file loses no
 * record — the questions are asked again (§1.4).
 */
export const resolveConflict = async (
	paths: Paths,
	branch: string,
	id: string,
	choices: Choices,
): Promise<Resolution> =>
	withLock(paths, 'resolve', async () => {
		const { root } = paths
		const remote = await remoteName(root)
		if (remote === null)
			throw new SoberError('git', 'there is nothing to resolve — this repository has no remote')

		const ours = await git(root, 'rev-parse', branch)
		const theirs = await git(root, 'rev-parse', `refs/remotes/${remote}/${branch}`).catch(() => '')
		if (theirs === '')
			throw new SoberError('git', 'there is nothing to resolve — run `sober sync` first')

		const attempt = await merge(paths, ours, theirs)
		try {
			const conflicts = await conflictsOf(paths, attempt.index, attempt.unmerged)
			const asked = conflicts.find((conflict) => conflict.id === id)
			if (asked === undefined)
				throw new SoberError('git', `${id} is not one of the records waiting on you`)

			const state = await readMergeState(paths, ours, theirs)
			const recorded = { ...state.choices, [asked.path]: choices }
			const left = conflicts.filter((conflict) => recorded[conflict.path] === undefined)
			if (left.length > 0) {
				await writeRecord(paths.merge, { ours, theirs, choices: recorded })
				return { kind: 'recorded', left, findings: [] }
			}

			for (const conflict of conflicts)
				await apply(paths, attempt, conflict, recorded[conflict.path] ?? {})
			for (const path of attempt.unmerged) {
				if (conflicts.some((conflict) => conflict.path === path)) continue
				await settleUnasked(paths, attempt, path)
			}
			const { findings } = await complete(paths, branch, attempt)
			return { kind: 'done', left: [], findings }
		} finally {
			await rm(attempt.index, { force: true })
		}
	})

/** A conflict, and whether this person has already said what they want. */
export type OpenConflict = Conflict & { readonly answered: boolean }

/**
 * Every record in the merge a human is in, with the two versions to choose
 * between and whether it is still waiting. An answered record stays in the
 * list, marked: a person is allowed to change their mind before the last
 * answer lands the merge.
 */
export const openConflicts = async (paths: Paths, branch: string): Promise<OpenConflict[]> => {
	const { root } = paths
	const remote = await remoteName(root)
	if (remote === null) return []
	const theirs = await git(root, 'rev-parse', `refs/remotes/${remote}/${branch}`).catch(() => '')
	if (theirs === '') return []
	const ours = await git(root, 'rev-parse', branch)
	if (ours === theirs || (await isAncestor(root, theirs, ours))) return []

	const attempt = await merge(paths, ours, theirs)
	try {
		const conflicts = await conflictsOf(paths, attempt.index, attempt.unmerged)
		const { choices } = await readMergeState(paths, ours, theirs)
		return conflicts.map((conflict) => ({
			...conflict,
			answered: choices[conflict.path] !== undefined,
		}))
	} finally {
		await rm(attempt.index, { force: true })
	}
}

const readMergeState = async (paths: Paths, ours: string, theirs: string): Promise<MergeState> => {
	try {
		const state = JSON.parse(await readFile(paths.merge, 'utf8')) as MergeState
		// Either side moved, so the answers were to a different question.
		if (state.ours !== ours || state.theirs !== theirs) return { ours, theirs, choices: {} }
		return state
	} catch {
		return { ours, theirs, choices: {} }
	}
}

/**
 * Puts one answered record into the merge index. An archived record is not a
 * field question: keeping the archive removes the live record, and restoring it
 * puts the other side's version back and takes the archive entry away again.
 */
const apply = async (
	paths: Paths,
	attempt: Attempt,
	conflict: Conflict,
	choices: Choices,
): Promise<void> => {
	const [base, ours, theirs] = await stagesOf(paths.root, attempt.index, conflict.path)

	if (conflict.kind === 'archived') {
		const chosen = choices[ARCHIVE_FIELD]
		if (chosen !== 'keep' && chosen !== 'restore')
			throw new SoberError(
				'git',
				`${conflict.id} was archived on one side and edited on the other — say \`keep\` or \`restore\``,
			)
		if (chosen === 'keep') {
			// The archive entry itself merged cleanly; only the live record has
			// to go, which is what archiving meant on the side that did it.
			await settle(paths, attempt.index, conflict.path, null)
			return
		}
		await settle(paths, attempt.index, conflict.path, conflict.by === 'ours' ? theirs : ours)
		await settle(paths, attempt.index, archivePathOf(conflict.path), null)
		return
	}

	if (ours === null || theirs === null) return
	await settle(
		paths,
		attempt.index,
		conflict.path,
		mergeRecord(conflict.path, base, ours, theirs, choices),
	)
}

/**
 * A clone has the code and `config.jsonc` — the board is on a branch nobody
 * asked for yet. `sober init` there adopts it rather than creating a second
 * board with a second project record, which is the one way two people end up
 * with two boards for one repository.
 *
 * Null means there was nothing to adopt, and the caller creates a board.
 */
export const adoptBoard = async (paths: Paths, branch: string): Promise<number | null> => {
	const { root } = paths
	const remote = await remoteName(root)
	if (remote === null) return null

	const theirs = await fetchBoard(root, remote, branch)
	if (theirs === null) return null

	await git(root, 'update-ref', `refs/heads/${branch}`, theirs)
	const pulled = await materialize(paths, null, theirs)
	// The same directories `initBoard` makes. A board whose remote held no
	// decisions yet would otherwise arrive without a `decisions/` at all, and
	// the layout a person opens would depend on what the team happened to have.
	for (const dir of [paths.nodes, paths.decisions, paths.archive, paths.runs]) {
		await mkdir(dir, { recursive: true })
	}
	await ensureGitignore(root)
	await ensureAttributes(root)
	if (!(await exists(paths.config))) await writeConfig(paths, DEFAULT_CONFIG_TEXT)
	return pulled.updated.length
}

/**
 * Writes what is in `.sober/` right now onto the board branch, and answers
 * whether that changed anything. The index lives under `local/`, is thrown away
 * after, and is never the repository's own — `update-index` hashes the files
 * straight out of the working tree, so no file is copied and no checkout runs.
 */
const snapshot = async (paths: Paths, branch: string): Promise<boolean> => {
	const { root } = paths
	const files = await boardFiles(paths)
	const index = join(paths.local, 'sync-index')
	await mkdir(paths.local, { recursive: true })
	await rm(index, { force: true })
	try {
		// Chunked because a board of a thousand nodes is a command line
		// Windows will not accept whole.
		for (let at = 0; at < files.length; at += 200) {
			await gitWithEnv(root, { GIT_INDEX_FILE: index }, [
				'update-index',
				'--add',
				'--',
				...files.slice(at, at + 200),
			])
		}
		const tree = await gitWithEnv(root, { GIT_INDEX_FILE: index }, ['write-tree'])
		if (tree === (await git(root, 'rev-parse', `${branch}^{tree}`))) return false

		const parent = await git(root, 'rev-parse', branch)
		const commit = await git(
			root,
			'commit-tree',
			tree,
			'-p',
			parent,
			'-m',
			`sober: board from ${await whoami(root)}`,
		)
		await git(root, 'update-ref', `refs/heads/${branch}`, commit)
		return true
	} finally {
		await rm(index, { force: true })
	}
}

/** Every board record on disk, repo-relative, in the order the tree wants them. */
const boardFiles = async (paths: Paths): Promise<string[]> => {
	const found: string[] = []
	for (const file of BOARD_FILES) if (await exists(join(paths.root, file))) found.push(file)
	for (const dir of BOARD_DIRS) {
		const names = await readdir(join(paths.root, dir)).catch(() => [] as string[])
		for (const name of names.sort()) if (name.endsWith('.json')) found.push(`${dir}/${name}`)
	}
	return found
}

/**
 * Brings the working tree from one board commit to another. Only paths the
 * trees disagree about are touched: a node created locally and never synced is
 * in neither tree and survives untouched, which is the property a pull has to
 * have before it can be run without asking.
 */
const materialize = async (paths: Paths, from: string | null, to: string): Promise<SyncChange> => {
	const before = from === null ? new Map<string, string>() : await treeOf(paths.root, from)
	const after = await treeOf(paths.root, to)
	const updated: string[] = []
	const removed: string[] = []

	for (const [path, blob] of after) {
		if (before.get(path) === blob) continue
		await writeAtomic(
			join(paths.root, ...path.split('/')),
			await gitVerbatim(paths.root, 'cat-file', 'blob', blob),
		)
		updated.push(path)
	}
	for (const path of before.keys()) {
		if (after.has(path)) continue
		await rm(join(paths.root, ...path.split('/')), { force: true })
		removed.push(path)
	}
	return { updated, removed }
}

/**
 * Path to blob for one board commit. Anything outside `.sober/` is dropped
 * rather than written: the tree came off a remote, and a board is the one thing
 * SOBER takes from one — a crafted commit does not get to write a git hook.
 */
const treeOf = async (root: string, commit: string): Promise<Map<string, string>> => {
	const listing = await git(root, 'ls-tree', '-r', commit)
	const tree = new Map<string, string>()
	for (const line of listing.split('\n')) {
		const [meta, path] = line.split('\t')
		const blob = meta?.split(' ')[2]
		if (path === undefined || blob === undefined) continue
		if (!path.startsWith(`${SOBER_DIR}/`) || path.split('/').includes('..')) continue
		tree.set(path, blob)
	}
	return tree
}

/** The remote's board, or null when it has none yet. An unreachable remote is said out loud. */
const fetchBoard = async (root: string, remote: string, branch: string): Promise<string | null> => {
	try {
		await git(
			root,
			'fetch',
			'--quiet',
			remote,
			`+refs/heads/${branch}:refs/remotes/${remote}/${branch}`,
		)
	} catch (error) {
		// A remote that simply has no board yet is the ordinary first sync, and
		// git says so in one sentence. Anything else — no network, no
		// permission, a remote that is not there — must not be read as one, or
		// the first sync of the day quietly pushes over a board it never saw.
		if (!/couldn't find remote ref/i.test(String(error)))
			throw new SoberError(
				'git',
				`${remote} could not be reached — sync again when you have a connection`,
			)
		return null
	}
	const ref = `refs/remotes/${remote}/${branch}`
	return (await refExists(root, ref)) ? await git(root, 'rev-parse', ref) : null
}

const pushBoard = async (root: string, remote: string, branch: string): Promise<void> => {
	try {
		await git(root, 'push', '--quiet', remote, `refs/heads/${branch}:refs/heads/${branch}`)
	} catch (error) {
		if (/non-fast-forward|fetch first|rejected/i.test(String(error)))
			throw new SoberError(
				'git',
				`the board moved on ${remote} while you were syncing — run \`sober sync\` again`,
			)
		throw error
	}
}

const exists = (file: string): Promise<boolean> =>
	access(file).then(
		() => true,
		() => false,
	)
