import { access, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createBoardBranch, ensureAttributes, ensureGitignore } from './board.js'
import { DEFAULT_CONFIG_TEXT, writeConfig } from './config.js'
import { SoberError } from './errors.js'
import { git, gitVerbatim, gitWithEnv, isAncestor, refExists, remoteName, whoami } from './git.js'
import { withLock } from './lock.js'
import type { Paths } from './paths.js'
import { SOBER_DIR } from './paths.js'
import { writeAtomic } from './write.js'

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
	 * `conflicted` — the same records changed on both sides; that is a
	 * field-by-field question and nothing was touched. `no-remote` — the board
	 * was committed locally and there is nowhere to send it.
	 */
	readonly kind: 'synced' | 'conflicted' | 'no-remote'
	/** A board commit was made from what is in the working tree right now. */
	readonly committed: boolean
	readonly pulled: SyncChange
	readonly pushed: boolean
	/** The records both sides changed. Only ever set when `kind` is `conflicted`. */
	readonly conflicts: readonly string[]
}

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
		if (remote === null)
			return { kind: 'no-remote', committed, pulled: NOTHING, pushed: false, conflicts: [] }

		const theirs = await fetchBoard(root, remote, branch)
		let pulled = NOTHING
		if (theirs !== null) {
			const ours = await git(root, 'rev-parse', branch)
			if (ours !== theirs && !(await isAncestor(root, theirs, ours))) {
				const landed = await pull(paths, branch, ours, theirs)
				if ('conflicts' in landed)
					return {
						kind: 'conflicted',
						committed,
						pulled: NOTHING,
						pushed: false,
						conflicts: landed.conflicts,
					}
				pulled = landed.pulled
			}
		}

		if (!options.push) return { kind: 'synced', committed, pulled, pushed: false, conflicts: [] }
		await pushBoard(root, remote, branch)
		return { kind: 'synced', committed, pulled, pushed: true, conflicts: [] }
	})

/**
 * Takes the remote's board into ours. One file per entity means most of what
 * two people do in a day touches different files, and git resolves that with no
 * question at all — so the question is asked only for records both sides
 * changed, which is the whole point of the layout (§1.2.1).
 *
 * A record both sides changed is where the field-level merge belongs, and it is
 * not written yet: those are named and nothing is touched.
 */
const pull = async (
	paths: Paths,
	branch: string,
	ours: string,
	theirs: string,
): Promise<{ pulled: SyncChange } | { conflicts: string[] }> => {
	const { root } = paths
	if (await isAncestor(root, ours, theirs)) {
		// Fast-forward: nothing of ours is left behind, so the remote tree
		// becomes the working tree and the branch follows it.
		const pulled = await materialize(paths, ours, theirs)
		await git(root, 'update-ref', `refs/heads/${branch}`, theirs)
		return { pulled }
	}

	const base = await git(root, 'merge-base', ours, theirs).catch(() => '')
	if (base === '')
		throw new SoberError(
			'git',
			`${branch} here and ${branch} on the remote share no history — they are two different boards, and merging them is not something SOBER can decide`,
		)

	const merged = await mergeTrees(paths, base, ours, theirs)
	if ('conflicts' in merged) return merged

	const commit = await git(
		root,
		'commit-tree',
		merged.tree,
		'-p',
		ours,
		'-p',
		theirs,
		'-m',
		'sober: board merge',
	)
	const pulled = await materialize(paths, ours, commit)
	await git(root, 'update-ref', `refs/heads/${branch}`, commit)
	return { pulled }
}

/**
 * Git's own three-way merge, in a throwaway index, on trees alone. `-i` keeps
 * it away from the working tree and `--aggressive` resolves the cases where
 * only one side moved — including an archive, which is one side deleting a
 * record and adding it back under `archive/`.
 *
 * What is left unmerged is exactly the set ADR 0013 says a human decides.
 */
const mergeTrees = async (
	paths: Paths,
	base: string,
	ours: string,
	theirs: string,
): Promise<{ tree: string } | { conflicts: string[] }> => {
	const { root } = paths
	const index = join(paths.local, 'merge-index')
	await mkdir(paths.local, { recursive: true })
	await rm(index, { force: true })
	try {
		const env = { GIT_INDEX_FILE: index }
		await gitWithEnv(root, env, ['read-tree', '-i', '-m', '--aggressive', base, ours, theirs])
		const unmerged = await gitWithEnv(root, env, ['ls-files', '--unmerged'])
		if (unmerged !== '') {
			const paths = unmerged.split('\n').map((line) => line.split('\t')[1] ?? '')
			return { conflicts: [...new Set(paths)].filter((path) => path !== '').sort() }
		}
		return { tree: await gitWithEnv(root, env, ['write-tree']) }
	} finally {
		await rm(index, { force: true })
	}
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
