import { access, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Project } from '@besober/schema'
import { SCHEMA_VERSION } from '@besober/schema'
import { DEFAULT_CONFIG_TEXT, writeConfig } from './config.js'
import { git, gitWithEnv, refExists } from './git.js'
import type { Paths } from './paths.js'
import { paths as resolvePaths, SOBER_DIR } from './paths.js'
import { readProject, writeProject } from './records.js'
import { writeAtomic } from './write.js'

/**
 * The board is gitignored on the code branch and reaches teammates through the
 * board branch (DESIGN §1.2). config.jsonc is the exception: it is machine
 * settings for this repository, so it is tracked here.
 */
export const GITIGNORE_BLOCK = `# SOBER: the board travels on its own branch, and local/ is disposable.
.sober/*
!.sober/config.jsonc
`

export interface InitResult {
	readonly paths: Paths
	/** False when a board was already here — init never overwrites one. */
	readonly created: boolean
}

/**
 * Creates `.sober/` in a repository that has none. Idempotent: run twice, the
 * second run reports the board it found and changes nothing.
 */
export const initBoard = async (
	root: string,
	project: Omit<Project, 'schemaVersion'>,
): Promise<InitResult> => {
	const paths = resolvePaths(root)
	const existing = await readProject(paths)
	if (existing.kind !== 'missing') return { paths, created: false }

	for (const dir of [paths.nodes, paths.decisions, paths.archive, paths.runs]) {
		await mkdir(dir, { recursive: true })
	}
	await writeConfig(paths, DEFAULT_CONFIG_TEXT)
	await writeProject(paths, { schemaVersion: SCHEMA_VERSION, ...project })
	await ensureGitignore(root)
	return { paths, created: true }
}

/** Nothing else in the design works without these entries (DESIGN §1.2). */
export const ensureGitignore = async (root: string): Promise<void> => {
	const file = join(root, '.gitignore')
	let current = ''
	try {
		current = await readFile(file, 'utf8')
	} catch (error) {
		if ((error as { code?: string }).code !== 'ENOENT') throw error
	}
	if (current.includes('.sober/*')) return
	const separator = current.length === 0 || current.endsWith('\n') ? '' : '\n'
	await writeAtomic(
		file,
		`${current}${separator}${current.length === 0 ? '' : '\n'}${GITIGNORE_BLOCK}`,
	)
}

/**
 * The board branch is an **orphan** (`PR-00-05`): it shares no history with the
 * code, so a board merge never touches source and `git log` on main is not half
 * board commits. It is created empty and never checked out in the working copy
 * — M2's sync reads and writes it through plumbing.
 */
export const createBoardBranch = async (root: string, branch: string): Promise<boolean> => {
	if (await refExists(root, branch)) return false
	// An empty commit rather than a first file: the branch has to exist before
	// there is anything to put on it, and a tree written now would be wrong by
	// the time sync writes one. The tree is written through a throwaway index,
	// so no working copy is touched and no path is hardcoded (§9).
	const index = join(root, SOBER_DIR, 'local', 'empty-index')
	const tree = await gitWithEnv(root, { GIT_INDEX_FILE: index }, ['write-tree'])
	await rm(index, { force: true })
	const commit = await git(root, 'commit-tree', tree, '-m', 'sober: the board branch')
	await git(root, 'branch', branch, commit)
	return true
}

/**
 * `sober init` writes a concrete value into `dispatch.setup` rather than
 * leaving it blank (`PR-00-06`): a lockfile says what the install command is,
 * and the user corrects one line instead of writing one from nothing. This is
 * D1's shape applied to configuration — the tool fills it in, the human
 * approves. There is no detection at dispatch time.
 */
const INSTALLERS: readonly (readonly [string, string])[] = [
	['pnpm-lock.yaml', 'pnpm install --frozen-lockfile'],
	['yarn.lock', 'yarn install --immutable'],
	['bun.lock', 'bun install --frozen-lockfile'],
	['bun.lockb', 'bun install --frozen-lockfile'],
	['package-lock.json', 'npm ci'],
	['uv.lock', 'uv sync --frozen'],
	['poetry.lock', 'poetry install'],
	['Pipfile.lock', 'pipenv install --deploy'],
	['requirements.txt', 'pip install -r requirements.txt'],
	['Cargo.lock', 'cargo fetch'],
	['go.sum', 'go mod download'],
	['Gemfile.lock', 'bundle install'],
	['composer.lock', 'composer install'],
]

export const detectSetup = async (root: string): Promise<string | null> => {
	for (const [file, command] of INSTALLERS) {
		try {
			await access(join(root, file))
			return command
		} catch {
			// Not this one.
		}
	}
	return null
}
